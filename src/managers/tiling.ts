import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SlabState, WindowSnapshot, FloatingSnapshot } from '../types/index.js';
import { scheduleBeforeRedraw, suspendAnimations, resumeAnimations } from '../utils/compositor.js';
import { getWindowMaximizeState, getTileableWindows } from '../utils/windows.js';
import { calculateMasterStackLayout } from '../logic/layout.js';

// =============================================================================
// COMPOSITOR-SYNCHRONIZED TILING (BEFORE_REDRAW)
// =============================================================================
/**
 * applyTiling - Apply tiling geometry synchronized with compositor redraw
 */
export function applyTiling(
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
export function restoreFloatingPositions(state: SlabState, windows: Meta.Window[]): void {
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

/**
 * Apply Master-Stack layout to all tileable windows.
 */
export function applyMasterStackToWorkspace(state: SlabState, captureSnapshot: boolean = false): void {
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
// MAIN TOGGLE FUNCTION
// =============================================================================
/**
 * toggleSlab - The main entry point triggered by keybinding.
 */
export function toggleSlab(state: SlabState): void {
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
