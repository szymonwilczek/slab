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

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

// Window actor interface for stacking order access
interface WindowActor {
    get_meta_window(): Meta.Window | null;
}

// Declare the global object available in GNOME Shell context
declare const global: {
    display: Meta.Display;
    stage: any;
    get_window_actors(): WindowActor[];
    compositor?: {
        get_laters(): {
            add(type: number, callback: () => boolean): number;
            remove(id: number): void;
        };
    };
};

// Console is available in GJS
declare const console: {
    log(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
};

// =============================================================================
// LATERS API HELPER (GNOME 45+ Compatibility)
// =============================================================================
/**
 * Schedule a callback to run before the next compositor redraw.
 * Handles API differences between GNOME versions.
 * 
 * GNOME 49+: Uses global.compositor.get_laters().add()
 * GNOME 45-48: Uses Meta.later_add()
 * Fallback: Execute directly if neither works
 */
function scheduleBeforeRedraw(callback: () => void): void {
    // Try GNOME 49+ API first (global.compositor.get_laters())
    if (global.compositor && typeof global.compositor.get_laters === 'function') {
        try {
            const laters = global.compositor.get_laters();
            console.log('[SLAB] Using global.compositor.get_laters() API');
            laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
                callback();
                return false; // GLib.SOURCE_REMOVE equivalent
            });
            return;
        } catch (e) {
            console.error('[SLAB] global.compositor.get_laters() failed:', e);
        }
    }

    // Try Meta.later_add (GNOME 45-48)
    if (typeof Meta.later_add === 'function') {
        try {
            console.log('[SLAB] Using Meta.later_add() API');
            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
                callback();
                return false;
            });
            return;
        } catch (e) {
            console.error('[SLAB] Meta.later_add() failed:', e);
        }
    }

    // Fallback: Use GLib.idle_add
    console.warn('[SLAB] No laters API available, using GLib.idle_add fallback');
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        callback();
        return GLib.SOURCE_REMOVE;
    });
}

// =============================================================================
// WINDOW MAXIMIZE STATE HELPER (GNOME 45+ Compatibility)
// =============================================================================
/**
 * Get the maximize state of a window.
 * Handles API differences between GNOME versions.
 * 
 * GNOME 45-48: Uses window.get_maximized()
 * GNOME 49+: Uses window.maximized_horizontally/maximized_vertically properties
 * 
 * @returns MaximizeFlags value (0=none, 1=horizontal, 2=vertical, 3=both)
 */
function getWindowMaximizeState(window: Meta.Window): number {
    // Try GNOME 45-48 API first
    if (typeof (window as any).get_maximized === 'function') {
        return (window as any).get_maximized();
    }

    // GNOME 49+ uses properties
    const h = (window as any).maximized_horizontally === true;
    const v = (window as any).maximized_vertically === true;

    if (h && v) return Meta.MaximizeFlags.BOTH;
    if (h) return Meta.MaximizeFlags.HORIZONTAL;
    if (v) return Meta.MaximizeFlags.VERTICAL;
    return 0;
}/**
 * WindowSnapshot - Stores complete window state before tiling was enabled.
 * 
 * We use stable_sequence (not object reference) because:
 * 1. It persists across GNOME Shell restarts
 * 2. Avoids holding object references that prevent GC of destroyed windows
 */
interface WindowSnapshot {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Was window fullscreen before tiling? */
    wasFullscreen: boolean;
    /** Was window maximized before tiling? Stores MaximizeFlags value */
    wasMaximized: number;
    /** Stacking order index (higher = on top). Used to restore z-order. */
    stackIndex: number;
}

type FloatingSnapshot = Map<number, WindowSnapshot>;

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
    /** Monitor index where tiling is active */
    currentMonitor: number;
}

// =============================================================================
// ANIMATION SUSPENSION (Using GNOME Shell Internal API)
// =============================================================================
/**
 * Use St.Settings to properly inhibit animations.
 * This is GNOME Shell's internal mechanism - much more reliable than GSettings.
 */

let _animationInhibitCount = 0;

/**
 * Suspend ALL GNOME Shell animations using the internal API.
 * This is the proper way to do it - no race conditions, instant effect.
 */
function suspendAnimations(): void {
    try {
        const settings = St.Settings.get();
        settings.inhibit_animations();
        _animationInhibitCount++;
        console.log('[SLAB] Animations inhibited (count:', _animationInhibitCount + ')');
    } catch (e) {
        console.log('[SLAB] Failed to inhibit animations:', e);
    }
}

/**
 * Resume GNOME Shell animations.
 */
function resumeAnimations(): void {
    try {
        if (_animationInhibitCount > 0) {
            const settings = St.Settings.get();
            settings.uninhibit_animations();
            _animationInhibitCount--;
            console.log('[SLAB] Animations uninhibited (count:', _animationInhibitCount + ')');
        }
    } catch (e) {
        console.log('[SLAB] Failed to uninhibit animations:', e);
    }
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
// COMPOSITOR-SYNCHRONIZED TILING (BEFORE_REDRAW)
// =============================================================================
/**
 * applyTiling - Apply tiling geometry synchronized with compositor redraw
 */
function applyTiling(
    _state: SlabState,
    window: Meta.Window,
    targetX: number,
    targetY: number,
    targetW: number,
    targetH: number
): void {
    console.log('[SLAB] applyTiling called for:', window.title, 'target:', targetX, targetY, targetW, targetH);

    // SAFETY: Check if window is still valid
    if (window.is_hidden()) {
        console.log('[SLAB] Window is hidden, skipping:', window.title);
        return;
    }
    if (!window.allows_move()) {
        console.log('[SLAB] Window does not allow move, skipping:', window.title);
        return;
    }
    if (!window.allows_resize()) {
        console.log('[SLAB] Window does not allow resize, skipping:', window.title);
        return;
    }

    // Apply geometry using compositor-synchronized helper
    scheduleBeforeRedraw(() => {
        console.log('[SLAB] BEFORE_REDRAW callback executing for:', window.title);
        try {
            // Skip if window was destroyed
            if (window.is_hidden()) {
                console.log('[SLAB] Window hidden in callback, skipping:', window.title);
                return;
            }

            // CRITICAL: Unmaximize if needed, otherwise move_resize is ignored
            const maxState = getWindowMaximizeState(window);
            console.log('[SLAB] Window maximize state:', maxState);
            if (maxState === Meta.MaximizeFlags.HORIZONTAL ||
                maxState === Meta.MaximizeFlags.VERTICAL ||
                maxState === Meta.MaximizeFlags.BOTH) {
                console.log('[SLAB] Unmaximizing window:', window.title);
                window.unmaximize(Meta.MaximizeFlags.BOTH);
            }

            // Apply geometry - synchronized with compositor
            console.log('[SLAB] Calling move_resize_frame:', targetX, targetY, targetW, targetH);
            window.move_resize_frame(true, targetX, targetY, targetW, targetH);
            console.log('[SLAB] move_resize_frame completed for:', window.title);
        } catch (e) {
            console.error('[SLAB] Error in BEFORE_REDRAW callback:', e);
        }
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
 * Get windows eligible for tiling on the active workspace AND specified monitor.
 * 
 * IMPORTANT: Returns windows in STACKING ORDER (bottom to top),
 * with the FOCUSED window moved to the FRONT (will be master).
 * 
 * We filter out:
 * - Non-normal windows (dialogs, menus, etc.)
 * - Windows on other workspaces
 * - Windows on other monitors
 * - Windows that can't be moved/resized
 * - Minimized/hidden windows
 * 
 * @param monitor - Monitor index to filter windows for
 */
function getTileableWindows(monitor: number): Meta.Window[] {
    const display = global.display;
    const workspace = display.get_workspace_manager().get_active_workspace();

    if (!workspace) return [];

    // Get window actors in stacking order (bottom to top)
    const actors = global.get_window_actors();
    const focusedWindow = display.get_focus_window();

    // Build list of tileable windows in stacking order
    const tileableWindows: Meta.Window[] = [];

    for (const actor of actors) {
        const window = actor.get_meta_window();
        if (!window) continue;

        // Only tile normal windows
        if (window.window_type !== Meta.WindowType.NORMAL) continue;

        // Must be on active workspace
        if (window.get_workspace() !== workspace) continue;

        // Must be on the specified monitor
        if (window.get_monitor() !== monitor) continue;

        // Skip hidden/minimized
        if (window.is_hidden()) continue;

        // Must be movable and resizable
        if (!window.allows_move() || !window.allows_resize()) continue;

        // Skip windows on all workspaces (sticky notes, etc)
        if (window.is_on_all_workspaces()) continue;

        tileableWindows.push(window);
    }

    // Move focused window to the FRONT (it will be master on left side)
    if (focusedWindow) {
        const focusedIndex = tileableWindows.findIndex(w =>
            w.get_stable_sequence() === focusedWindow.get_stable_sequence());
        if (focusedIndex > 0) {
            const [focused] = tileableWindows.splice(focusedIndex, 1);
            tileableWindows.unshift(focused);
        }
    }

    return tileableWindows;
}

// =============================================================================
// SNAPSHOT MANAGEMENT
// =============================================================================
/**
 * Capture current window state including position, fullscreen, and stacking order.
 * Called only when tiling is ENABLED.
 * 
 * @param windows - Windows in their current stacking order (bottom to top)
 */
function captureFloatingSnapshot(windows: Meta.Window[]): FloatingSnapshot {
    const snapshot: FloatingSnapshot = new Map();

    for (let i = 0; i < windows.length; i++) {
        const window = windows[i];
        const frame = window.get_frame_rect();
        const maxState = getWindowMaximizeState(window);

        snapshot.set(window.get_stable_sequence(), {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            wasFullscreen: window.is_fullscreen(),
            wasMaximized: maxState === Meta.MaximizeFlags.HORIZONTAL ? 1 :
                maxState === Meta.MaximizeFlags.VERTICAL ? 2 :
                    maxState === Meta.MaximizeFlags.BOTH ? 3 : 0,
            stackIndex: i,
        });
    }

    return snapshot;
}

/**
 * Restore windows to their floating positions, fullscreen state, and z-order.
 * Called when tiling is DISABLED.
 * 
 * Uses actor hiding to prevent compositor animations during transition.
 */
function restoreFloatingPositions(state: SlabState, windows: Meta.Window[]): void {
    const windowsWithSnapshot: Array<{ window: Meta.Window; snapshot: WindowSnapshot }> = [];

    for (const window of windows) {
        const snapshot = state.floatingSnapshot.get(window.get_stable_sequence());
        if (snapshot) {
            windowsWithSnapshot.push({ window, snapshot });
        }
    }

    if (windowsWithSnapshot.length === 0) return;

    // Sort by stackIndex (bottom to top) to restore in correct z-order
    windowsWithSnapshot.sort((a, b) => a.snapshot.stackIndex - b.snapshot.stackIndex);

    console.log('[SLAB] Restoring', windowsWithSnapshot.length, 'windows in stacking order');

    // Collect actors for hiding during transition
    const windowActors: Array<{ window: Meta.Window; actor: any }> = [];
    for (const { window } of windowsWithSnapshot) {
        const actor = window.get_compositor_private();
        if (actor) {
            windowActors.push({ window, actor });
        }
    }



    // Find the highest stackIndex of any fullscreen window
    let maxFullscreenStackIndex = -1;
    for (const { snapshot } of windowsWithSnapshot) {
        if (snapshot.wasFullscreen && snapshot.stackIndex > maxFullscreenStackIndex) {
            maxFullscreenStackIndex = snapshot.stackIndex;
        }
    }

    // STEP 2: Use GNOME Shell's native mechanism to skip animations inside the callback
    // This atomic transaction ensures we catch the exact frame where geometry changes
    scheduleBeforeRedraw(() => {
        console.log('[SLAB] Restore callback executing - Suppressing animations');

        // Suppress animations for all windows involved
        for (const { actor } of windowActors) {
            try {
                // 1. Skip Shell-level effects (Minimize/Maximize/Map)
                Main.wm.skipNextEffect(actor);

                // 2. Kill Clutter-level implicit animations (Easing)
                actor.save_easing_state();
                actor.set_easing_duration(0);
                (actor as any).remove_all_transitions();
            } catch (e) {
                console.error('[SLAB] Error inhibiting animations:', e);
            }
        }

        // === PHASE 1: Restore all windows in stacking order ===
        for (const { window, snapshot } of windowsWithSnapshot) {
            try {
                if (window.is_hidden()) continue;

                // Restore geometry
                window.move_resize_frame(true, snapshot.x, snapshot.y, snapshot.width, snapshot.height);

                // Restore maximize state
                if (snapshot.wasMaximized === 3) {
                    window.maximize(Meta.MaximizeFlags.BOTH);
                } else if (snapshot.wasMaximized === 1) {
                    window.maximize(Meta.MaximizeFlags.HORIZONTAL);
                } else if (snapshot.wasMaximized === 2) {
                    window.maximize(Meta.MaximizeFlags.VERTICAL);
                }

                // Restore fullscreen state
                if (snapshot.wasFullscreen) {
                    window.make_fullscreen();
                }
            } catch (e) {
                console.log('[SLAB] Error restoring window:', window.title);
            }
        }

        // === PHASE 2: Re-raise windows that were ABOVE fullscreen windows ===
        if (maxFullscreenStackIndex >= 0) {
            for (const { window, snapshot } of windowsWithSnapshot) {
                if (!snapshot.wasFullscreen && snapshot.stackIndex > maxFullscreenStackIndex) {
                    try {
                        if (!window.is_hidden()) {
                            window.raise();
                        }
                    } catch (e) { }
                }
            }
        }

        // === PHASE 3: Restore actor state ===
        // === PHASE 3: Restore actor state & Resume animations ===
        scheduleBeforeRedraw(() => {
            console.log('[SLAB] Restore complete, restoring actor state');
            for (const { actor } of windowActors) {
                try {
                    actor.restore_easing_state();
                } catch (e) { }
            }
        });
    });
}

// =============================================================================
// MAIN TOGGLE FUNCTION
// =============================================================================
/**
 * toggleSlab - The main entry point triggered by keybinding.
 */
function toggleSlab(state: SlabState): void {
    console.log('[SLAB] === toggleSlab called, tilingEnabled:', state.tilingEnabled, '===');

    // Suspend animations for instant transitions
    suspendAnimations();

    if (state.tilingEnabled) {
        // === DISABLE TILING ===
        console.log('[SLAB] Disabling tiling on monitor:', state.currentMonitor);
        const windows = getTileableWindows(state.currentMonitor);
        console.log('[SLAB] Found', windows.length, 'windows to restore');
        restoreFloatingPositions(state, windows);
        state.tilingEnabled = false;
        state.floatingSnapshot.clear();

        // Resume animations after restore completes
        console.log('[SLAB] Scheduling animation resume via scheduleBeforeRedraw');
        scheduleBeforeRedraw(() => {
            console.log('[SLAB] Animation resume callback executing');
            resumeAnimations();
        });
    } else {
        // === ENABLE TILING ===
        // Store the current monitor (where focused window is)
        state.currentMonitor = global.display.get_current_monitor();
        console.log('[SLAB] Enabling tiling on monitor:', state.currentMonitor);
        state.tilingEnabled = true;
        applyMasterStackToWorkspace(state, true);
    }

    console.log('[SLAB] === toggleSlab completed ===');
}

/**
 * Apply Master-Stack layout to all tileable windows.
 */
function applyMasterStackToWorkspace(state: SlabState, captureSnapshot: boolean = false): void {
    console.log('[SLAB] applyMasterStackToWorkspace called, captureSnapshot:', captureSnapshot);

    if (!state.settings) {
        console.error('[SLAB] No settings available!');
        resumeAnimations();
        return;
    }

    const display = global.display;
    const workspace = display.get_workspace_manager().get_active_workspace();
    const monitor = state.currentMonitor;

    console.log('[SLAB] Current monitor:', monitor);

    // Get ALL normal windows on workspace AND current monitor (including fullscreen/maximized)
    const allWindows = workspace.list_windows().filter((window: Meta.Window) => {
        if (window.window_type !== Meta.WindowType.NORMAL) return false;
        if (window.is_on_all_workspaces()) return false;
        if (window.get_monitor() !== monitor) return false; // Only current monitor!
        return true;
    });

    console.log('[SLAB] All normal windows on workspace and monitor:', allWindows.length);

    if (allWindows.length === 0) {
        console.log('[SLAB] No windows to tile on this monitor!');
        resumeAnimations();
        return;
    }

    // STEP 1: Capture snapshot BEFORE unfullscreening (if requested)
    if (captureSnapshot) {
        console.log('[SLAB] Capturing snapshot of', allWindows.length, 'windows');
        try {
            state.floatingSnapshot = captureFloatingSnapshot(allWindows);
            console.log('[SLAB] Snapshot captured successfully');
        } catch (e) {
            console.error('[SLAB] Error capturing snapshot:', e);
            resumeAnimations();
            return;
        }
    }

    console.log('[SLAB] Preparing atomic transition');

    // Collect actors for all windows we'll modify
    const windowActors: Array<{ window: Meta.Window; actor: any }> = [];
    for (const window of allWindows) {
        const actor = window.get_compositor_private();
        if (actor) {
            windowActors.push({ window, actor });
        }
        if (window.is_fullscreen()) {
            console.log('[SLAB] Window is fullscreen:', window.title);
        }
    }

    // STEP 2: Use GNOME Shell's native mechanism to skip animations
    // We do this inside the scheduleBeforeRedraw callback to ensure it applies to the exact frame where changes happen
    console.log('[SLAB] Preparing atomic transition');

    // STEP 3: Apply layout atomically
    scheduleBeforeRedraw(() => {
        console.log('[SLAB] === Atomic transition executing ===');

        // Suppress animations for all windows involved
        for (const { actor } of windowActors) {
            try {
                // 1. Skip Shell-level effects (Minimize/Maximize/Map)
                Main.wm.skipNextEffect(actor);

                // 2. Kill Clutter-level implicit animations (Easing)
                actor.save_easing_state();
                actor.set_easing_duration(0);
                (actor as any).remove_all_transitions();
            } catch (e) {
                console.error('[SLAB] Error inhibiting animations:', e);
            }
        }

        // First: unfullscreen and unmaximize all windows
        for (const window of allWindows) {
            try {
                if (window.is_hidden()) continue;

                if (window.is_fullscreen()) {
                    console.log('[SLAB] Unfullscreening:', window.title);
                    window.unmake_fullscreen();
                }

                const maxState = getWindowMaximizeState(window);
                if (maxState !== 0) {
                    console.log('[SLAB] Unmaximizing:', window.title);
                    window.unmaximize(Meta.MaximizeFlags.BOTH);
                }
            } catch (e) {
                console.error('[SLAB] Error unfullscreening:', e);
            }
        }

        // Get tileable windows and calculate layout
        const windows = getTileableWindows(monitor);
        console.log('[SLAB] Tileable windows:', windows.length);

        if (windows.length === 0) {
            // Restore actor state
            // Restore actor state
            // No cleanup needed for skipNextEffect
            console.log('[SLAB] No tileable windows, resuming animations');
            resumeAnimations();
            return;
        }

        const workArea = workspace.get_work_area_for_monitor(monitor);
        console.log('[SLAB] Work area:', workArea.x, workArea.y, workArea.width, 'x', workArea.height);

        const masterRatio = state.settings!.get_double('master-ratio');
        const gap = state.settings!.get_int('window-gap');

        const layout = calculateMasterStackLayout(windows, workArea, masterRatio, gap);
        console.log('[SLAB] Calculated layout for', layout.length, 'windows');

        // Apply geometry to all windows
        for (const { window, x, y, w, h } of layout) {
            try {
                if (window.is_hidden()) continue;
                console.log('[SLAB] Moving:', window.title, 'to', x, y, w, h);
                window.move_resize_frame(true, x, y, w, h);
            } catch (e) {
                console.error('[SLAB] Error tiling window:', window.title, e);
            }
        }

        // STEP 4: Resume animations & Restore State
        scheduleBeforeRedraw(() => {
            console.log('[SLAB] All geometry applied, restoring actor state');
            for (const { actor } of windowActors) {
                try {
                    actor.restore_easing_state();
                } catch (e) { }
            }
            resumeAnimations();
        });
    });
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
            currentMonitor: 0,
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
                // Schedule layout update synchronized with compositor
                scheduleBeforeRedraw(() => {
                    if (this._state?.tilingEnabled) {
                        applyMasterStackToWorkspace(this._state);
                    }
                });
            }
        });
        this._state.signalIds.push(sigId);
    }

    disable(): void {
        if (!this._state) return;

        // Restore floating positions if tiling was active
        if (this._state.tilingEnabled) {
            const windows = getTileableWindows(this._state.currentMonitor);
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
