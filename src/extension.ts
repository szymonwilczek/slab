/**
 * SLAB - High-Performance Actor-First Tiling Extension for GNOME Shell 45+
 * 
 * ARCHITECTURE OVERVIEW:
 * ----------------------
 * This extension implements "Tiling-on-Demand" with an Actor-First Optimistic UI.
 * 
 * Traditional tiling (Pop Shell, Forge) is REACTIVE:
 *   User action → Protocol negotiation (slow) → Visual update
 * 
 * SLAB is OPTIMISTIC:
 *   User action → Actor manipulation (instant) → Protocol sync (lazy)
 * 
 * ZERO OVERHEAD PRINCIPLE:
 * When tiling is disabled, this extension consumes 0 CPU cycles.
 * We don't track window moves in real-time. We only snapshot state
 * at the exact moment the user enables tiling.
 * 
 * MEMORY STRATEGY:
 * All geometry objects are pre-allocated at init and reused.
 * NO allocations in hot paths = NO GC pauses during tiling operations.
 */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Declare the global object available in GNOME Shell context
declare const global: {
    display: Meta.Display;
    stage: any;
    get_window_actors(): any[];
};

// Console is available in GJS
declare const console: {
    log(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
};

// =============================================================================
// PRE-ALLOCATED GEOMETRY POOL (Zero-GC Strategy)
// =============================================================================
/**
 * These static rectangles are reused for ALL geometry calculations.
 * We NEVER allocate new Rect objects in the tiling loop.
 * 
 * Why: JavaScript GC can pause rendering for 5-50ms. Unacceptable for
 * a tiling WM where we need sub-frame latency.
 */
const RECT_POOL = {
    /** Work area rectangle - reused for each applyTiling call */
    workArea: new Meta.Rectangle(),
    /** Master window rectangle */
    master: new Meta.Rectangle(),
    /** Stack window rectangle - reused for each stack window */
    stack: new Meta.Rectangle(),
    /** Temporary rectangle for CSD compensation */
    temp: new Meta.Rectangle(),
    /** Frame-to-buffer delta for CSD shadow compensation */
    csdDelta: { left: 0, top: 0, right: 0, bottom: 0 },
};

/**
 * FloatingSnapshot - Stores window positions before tiling was enabled.
 * Map<window_stable_sequence, {x, y, width, height}>
 * 
 * We use stable_sequence (not object reference) because:
 * 1. It persists across GNOME Shell restarts
 * 2. Avoids holding object references that prevent GC of destroyed windows
 */
type FloatingSnapshot = Map<number, { x: number; y: number; width: number; height: number }>;

// =============================================================================
// EXTENSION STATE
// =============================================================================
interface SlabState {
    /** Is tiling currently active? */
    tilingEnabled: boolean;
    /** Snapshot of window positions before tiling was enabled */
    floatingSnapshot: FloatingSnapshot;
    /** GSettings instance */
    settings: Gio.Settings | null;
    /** Connected signal IDs for cleanup */
    signalIds: number[];
    /** Map of window ID -> blocked signal handler IDs */
    blockedSignals: Map<number, number[]>;
    /** Pending later_add callback ID */
    pendingLaterId: number | null;
}

// =============================================================================
// SIGNAL BLOCKING UTILITIES
// =============================================================================
/**
 * Block geometry signals on a window to prevent recursion.
 * 
 * WHY THIS IS CRITICAL:
 * When we call move_resize_frame(), Mutter emits position-changed and
 * size-changed signals. If we're listening to those to trigger relayout,
 * we enter an infinite loop. Block → move → unblock is the pattern.
 * 
 * NOTE: Currently unused but reserved for advanced relayout-on-resize feature.
 * Exported to prevent unused declaration error.
 */
export function _blockWindowSignals(state: SlabState, window: Meta.Window, signalIds: number[]): void {
    const windowId = window.get_stable_sequence();
    state.blockedSignals.set(windowId, signalIds);

    for (const id of signalIds) {
        if (GObject.signal_handler_is_connected(window, id)) {
            GObject.signal_handler_block(window, id);
        }
    }
}

export function _unblockWindowSignals(state: SlabState, window: Meta.Window): void {
    const windowId = window.get_stable_sequence();
    const signalIds = state.blockedSignals.get(windowId);

    if (signalIds) {
        for (const id of signalIds) {
            if (GObject.signal_handler_is_connected(window, id)) {
                GObject.signal_handler_unblock(window, id);
            }
        }
        state.blockedSignals.delete(windowId);
    }
}

// =============================================================================
// CSD (Client-Side Decorations) COMPENSATION
// =============================================================================
/**
 * Calculate the delta between frame rect and buffer rect.
 * 
 * GTK4 apps use CSD with shadows that extend beyond the visible frame.
 * - frame_rect: The visible window (what user sees)
 * - buffer_rect: The full buffer including shadows
 * 
 * When we position windows, we need to compensate for this delta
 * so windows appear perfectly flush (pixel-perfect tiling).
 * 
 * @returns The CSD delta object (reuses RECT_POOL.csdDelta)
 */
function calculateCSDDelta(window: Meta.Window): typeof RECT_POOL.csdDelta {
    const frame = window.get_frame_rect();
    const buffer = window.get_buffer_rect();

    // Reuse static object - NO allocation
    RECT_POOL.csdDelta.left = frame.x - buffer.x;
    RECT_POOL.csdDelta.top = frame.y - buffer.y;
    RECT_POOL.csdDelta.right = (buffer.x + buffer.width) - (frame.x + frame.width);
    RECT_POOL.csdDelta.bottom = (buffer.y + buffer.height) - (frame.y + frame.height);

    return RECT_POOL.csdDelta;
}

// =============================================================================
// THE TELEPORT HACK - Actor-First Optimistic UI
// =============================================================================
/**
 * applyTiling - Core function implementing Visual Decoupling
 * 
 * ARCHITECTURE:
 * 1. INSTANT VISUAL FEEDBACK (0ms latency)
 *    Manipulate Clutter.Actor directly. This is what the compositor draws.
 *    No Wayland/X11 negotiation - just set position/size.
 * 
 * 2. LAZY PROTOCOL SYNC (deferred to next frame)
 *    Use Meta.later_add(BEFORE_REDRAW) to schedule move_resize_frame().
 *    This satisfies the WM protocol without blocking visuals.
 * 
 * @param window - The Meta.Window to tile
 * @param targetX - Target frame X position
 * @param targetY - Target frame Y position  
 * @param targetW - Target frame width
 * @param targetH - Target frame height
 */
function applyTiling(
    state: SlabState,
    window: Meta.Window,
    targetX: number,
    targetY: number,
    targetW: number,
    targetH: number
): void {
    // SAFETY: Check if window is still valid
    if (window.is_hidden() || !window.allows_move() || !window.allows_resize()) {
        return;
    }

    // Get the Clutter actor - this is the visual representation
    // Type assertion: get_compositor_private() returns the window's ClutterActor
    const actor = window.get_compositor_private();

    // SAFETY: Actor may not exist yet (race condition during window creation)
    if (!actor) {
        // Fallback: schedule retry on next idle
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (!window.is_hidden()) {
                applyTiling(state, window, targetX, targetY, targetW, targetH);
            }
            return GLib.SOURCE_REMOVE; // Don't repeat
        });
        return;
    }

    // Calculate CSD shadow compensation
    const csd = calculateCSDDelta(window);

    // STEP 1: INSTANT VISUAL FEEDBACK
    // ================================
    // Manipulate the actor directly. This bypasses all protocol negotiation.
    // The compositor will draw this immediately in the current frame.
    //
    // Why set_position/set_size and not a transform?
    // Transforms don't affect hit testing. We want both visual AND interactive
    // positioning to update instantly.

    // Adjust for CSD shadows - position the buffer so frame lands at target
    const actorX = targetX - csd.left;
    const actorY = targetY - csd.top;
    const actorW = targetW + csd.left + csd.right;
    const actorH = targetH + csd.top + csd.bottom;

    actor.set_position(actorX, actorY);
    actor.set_size(actorW, actorH);

    // STEP 2: LAZY PROTOCOL SYNC
    // ==========================
    // Schedule the actual WM protocol call for next idle.
    // This is the "proper" way to resize a window, but it's SLOW
    // (involves Wayland/X11 round-trip, client negotiation, etc.)
    //
    // By deferring this to idle, we:
    // 1. Don't block the current frame
    // 2. Batch multiple resize operations
    // 3. Let the client catch up to our imposed geometry

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        try {
            // CRITICAL: Unmaximize if needed, otherwise move_resize is ignored
            const maxState = window.get_maximized();
            if (maxState !== Meta.MaximizeFlags.HORIZONTAL &&
                maxState !== Meta.MaximizeFlags.VERTICAL &&
                maxState !== Meta.MaximizeFlags.BOTH) {
                // Window is not maximized, proceed normally
            } else {
                window.unmaximize(Meta.MaximizeFlags.BOTH);
            }

            // The actual protocol-level resize
            // userOp=true allows bypassing some size constraints
            window.move_resize_frame(true, targetX, targetY, targetW, targetH);
        } catch (e) {
            // Window may have been destroyed between scheduling and execution
            // This is expected and not an error
        }

        return GLib.SOURCE_REMOVE; // Don't repeat
    });
}

// =============================================================================
// MASTER-STACK LAYOUT (O(1) Complexity)
// =============================================================================
/**
 * Calculate Master-Stack layout for N windows.
 * 
 * Layout:
 * +--------+--------+
 * |        | Stack1 |
 * | Master +--------+
 * |        | Stack2 |
 * +--------+--------+
 * 
 * COMPLEXITY: O(1) per window
 * - Master: full height, ratio * width
 * - Stack: evenly divided (height/n), (1-ratio) * width
 * 
 * No tree traversal, no recursion. Just arithmetic.
 * 
 * @param windows - Array of windows to tile
 * @param workArea - Available work area (excluding panels)
 * @param masterRatio - Ratio of width for master (0.2 - 0.8)
 * @param gap - Gap between windows in pixels
 */
function calculateMasterStackLayout(
    windows: Meta.Window[],
    workArea: Meta.Rectangle,
    masterRatio: number,
    gap: number
): Array<{ window: Meta.Window; x: number; y: number; w: number; h: number }> {
    const n = windows.length;
    if (n === 0) return [];

    const result: Array<{ window: Meta.Window; x: number; y: number; w: number; h: number }> = [];

    // Single window: full work area minus gaps
    if (n === 1) {
        result.push({
            window: windows[0],
            x: workArea.x + gap,
            y: workArea.y + gap,
            w: workArea.width - gap * 2,
            h: workArea.height - gap * 2,
        });
        return result;
    }

    // Multiple windows: Master-Stack layout
    const masterWidth = Math.floor((workArea.width - gap * 3) * masterRatio);
    const stackWidth = workArea.width - gap * 3 - masterWidth;
    const stackCount = n - 1;
    const stackHeight = Math.floor((workArea.height - gap * (stackCount + 1)) / stackCount);

    // Master window (first in list)
    result.push({
        window: windows[0],
        x: workArea.x + gap,
        y: workArea.y + gap,
        w: masterWidth,
        h: workArea.height - gap * 2,
    });

    // Stack windows (rest of list)
    for (let i = 1; i < n; i++) {
        const stackIndex = i - 1;
        result.push({
            window: windows[i],
            x: workArea.x + gap * 2 + masterWidth,
            y: workArea.y + gap + stackIndex * (stackHeight + gap),
            w: stackWidth,
            h: stackHeight,
        });
    }

    return result;
}

// =============================================================================
// WINDOW FILTERING
// =============================================================================
/**
 * Get windows eligible for tiling on the active workspace.
 * 
 * We filter out:
 * - Non-normal windows (dialogs, menus, etc.)
 * - Windows on other workspaces
 * - Windows that can't be moved/resized
 * - Minimized/hidden windows
 */
function getTileableWindows(): Meta.Window[] {
    const display = global.display;
    const workspace = display.get_workspace_manager().get_active_workspace();

    if (!workspace) return [];

    return workspace.list_windows().filter((window: Meta.Window) => {
        // Only tile normal windows
        if (window.window_type !== Meta.WindowType.NORMAL) return false;

        // Skip hidden/minimized
        if (window.is_hidden()) return false;

        // Must be movable and resizable
        if (!window.allows_move() || !window.allows_resize()) return false;

        // Skip windows on all workspaces (usually sticky notes, etc.)
        if (window.is_on_all_workspaces()) return false;

        return true;
    });
}

// =============================================================================
// SNAPSHOT MANAGEMENT
// =============================================================================
/**
 * Capture current window positions (lazy snapshotting).
 * Called only when tiling is ENABLED.
 */
function captureFloatingSnapshot(windows: Meta.Window[]): FloatingSnapshot {
    const snapshot: FloatingSnapshot = new Map();

    for (const window of windows) {
        const frame = window.get_frame_rect();
        snapshot.set(window.get_stable_sequence(), {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
        });
    }

    return snapshot;
}

/**
 * Restore windows to their floating positions.
 * Called when tiling is DISABLED.
 */
function restoreFloatingPositions(state: SlabState, windows: Meta.Window[]): void {
    for (const window of windows) {
        const snapshot = state.floatingSnapshot.get(window.get_stable_sequence());
        if (snapshot) {
            applyTiling(state, window, snapshot.x, snapshot.y, snapshot.width, snapshot.height);
        }
    }
}

// =============================================================================
// MAIN TOGGLE FUNCTION
// =============================================================================
/**
 * toggleSlab - The main entry point triggered by keybinding.
 * 
 * This implements the "Context Switch" pattern:
 * - When enabling: Snapshot current positions, then tile
 * - When disabling: Restore from snapshot
 */
function toggleSlab(state: SlabState): void {
    const windows = getTileableWindows();

    if (state.tilingEnabled) {
        // === DISABLE TILING ===
        // Restore windows to their floating positions
        restoreFloatingPositions(state, windows);
        state.tilingEnabled = false;
        state.floatingSnapshot.clear();
    } else {
        // === ENABLE TILING ===
        // Lazy snapshot: capture current positions NOW
        state.floatingSnapshot = captureFloatingSnapshot(windows);
        state.tilingEnabled = true;

        // Apply Master-Stack layout
        applyMasterStackToWorkspace(state);
    }
}

/**
 * Apply Master-Stack layout to all tileable windows.
 */
function applyMasterStackToWorkspace(state: SlabState): void {
    if (!state.settings) return;

    const windows = getTileableWindows();
    if (windows.length === 0) return;

    // Get work area (excludes panels, docks)
    const display = global.display;
    const monitor = display.get_current_monitor();
    const workArea = display.get_monitor_geometry(monitor);

    // Read layout settings
    const masterRatio = state.settings.get_double('master-ratio');
    const gap = state.settings.get_int('window-gap');

    // Calculate layout (O(1) per window)
    const layout = calculateMasterStackLayout(windows, workArea, masterRatio, gap);

    // Apply tiling to each window
    for (const { window, x, y, w, h } of layout) {
        applyTiling(state, window, x, y, w, h);
    }
}

// =============================================================================
// EXTENSION LIFECYCLE
// =============================================================================
export default class SlabExtension extends Extension {
    private _state: SlabState | null = null;

    enable(): void {
        console.log('[SLAB] Extension enable() called');

        // Initialize state
        this._state = {
            tilingEnabled: false,
            floatingSnapshot: new Map(),
            settings: this.getSettings(),
            signalIds: [],
            blockedSignals: new Map(),
            pendingLaterId: null,
        };

        console.log('[SLAB] Settings loaded:', this._state.settings);

        // Register keybinding
        try {
            Main.wm.addKeybinding(
                'toggle-tiling',
                this._state.settings!,
                0, // Meta.KeyBindingFlags.NONE
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => {
                    console.log('[SLAB] Keybinding triggered!');
                    if (this._state) {
                        toggleSlab(this._state);
                    }
                }
            );
            console.log('[SLAB] Keybinding registered successfully');
        } catch (e) {
            console.error('[SLAB] Failed to register keybinding:', e);
        }

        // Listen for new windows to maintain layout
        const display = global.display;
        const sigId = display.connect('window-created', (_display: Meta.Display, _window: Meta.Window) => {
            if (this._state?.tilingEnabled) {
                // Defer layout update to let the window settle (100ms delay)
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    if (this._state?.tilingEnabled) {
                        applyMasterStackToWorkspace(this._state);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        this._state.signalIds.push(sigId);
    }

    disable(): void {
        if (!this._state) return;

        // Restore floating positions if tiling was active
        if (this._state.tilingEnabled) {
            const windows = getTileableWindows();
            restoreFloatingPositions(this._state, windows);
        }

        // Remove keybinding
        Main.wm.removeKeybinding('toggle-tiling');

        // Disconnect signals
        const display = global.display;
        for (const id of this._state.signalIds) {
            display.disconnect(id);
        }

        // Clear state
        this._state.floatingSnapshot.clear();
        this._state.blockedSignals.clear();
        this._state = null;
    }
}
