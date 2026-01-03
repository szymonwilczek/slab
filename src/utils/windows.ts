import Meta from 'gi://Meta';
import GObject from 'gi://GObject';
import { SlabState } from '../types/index.js';

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
export function getWindowMaximizeState(window: Meta.Window): number {
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
 * @param newWindow - Optional new window to force-include (bypass hidden check) and force-master
 */
export function getTileableWindows(monitor: number, newWindow?: Meta.Window): Meta.Window[] {
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

        // SKIP LOG FILTER: Just verify logic
        if (window.window_type !== Meta.WindowType.NORMAL) continue;
        if (window.get_workspace() !== workspace) continue;

        // Debug specific window if needed
        const isDebug = true;
        const isNew = newWindow && window.get_stable_sequence() === newWindow.get_stable_sequence();

        // Must be on the specified monitor
        if (window.get_monitor() !== monitor) {
            if (isDebug) console.log(`[SLAB-DEBUG] Skipping ${window.title}: Wrong monitor (${window.get_monitor()} vs ${monitor})`);
            continue;
        }

        // Special handling for new window:
        // 1. Bypass hidden check (it might not be mapped yet)
        if (!isNew && window.is_hidden()) {
            if (isDebug) console.log(`[SLAB-DEBUG] Skipping ${window.title}: Hidden`);
            continue;
        }

        if (!window.allows_move() || !window.allows_resize()) {
            if (isDebug) console.log(`[SLAB-DEBUG] Skipping ${window.title}: No move/resize`);
            continue;
        }

        // Skip windows on all workspaces (sticky notes, etc)
        if (window.is_on_all_workspaces()) continue;

        tileableWindows.push(window);
    }

    console.log(`[SLAB-DEBUG] Found ${tileableWindows.length} candidates. Focused: ${focusedWindow?.title} New: ${newWindow?.title}`);

    // LOGIC: Determine Master Window
    // Priority 1: newWindow (if provided) - User just opened it, they want it here.
    // Priority 2: focusedWindow - Existing behavior.

    let masterWindow = focusedWindow;
    if (newWindow) {
        masterWindow = newWindow;
    }

    if (masterWindow) {
        const masterIndex = tileableWindows.findIndex(w =>
            w.get_stable_sequence() === masterWindow.get_stable_sequence());

        if (masterIndex >= 0) {
            console.log(`[SLAB-DEBUG] Master window ${masterWindow.title} found at index ${masterIndex}, moving to front`);
            const [master] = tileableWindows.splice(masterIndex, 1);
            tileableWindows.unshift(master);
        } else {
            console.log(`[SLAB-DEBUG] Master window ${masterWindow.title} NOT found in candidates!`);
        }
    }

    return tileableWindows;
}
