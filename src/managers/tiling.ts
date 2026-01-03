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
 * Capture snapshot for a single window and add it to the state.
 * For NEW windows, we pass the TARGET position (where it will be restored to), 
 * not the current position (which might be wrong/uninitialized).
 */
function captureSingleWindowSnapshot(
    state: SlabState,
    window: Meta.Window,
    targetX?: number,
    targetY?: number,
    targetW?: number,
    targetH?: number
): void {
    const frame = window.get_frame_rect();
    const maxState = getWindowMaximizeState(window);

    // Calculate a safe stack index (append to end)
    let maxStackIndex = 0;
    for (const s of state.floatingSnapshot.values()) {
        if (s.stackIndex > maxStackIndex) maxStackIndex = s.stackIndex;
    }

    // Use target position if provided, otherwise use current frame
    // This fixes the "wrong monitor restore" bug for new windows
    const x = targetX ?? frame.x;
    const y = targetY ?? frame.y;
    const width = targetW ?? frame.width;
    const height = targetH ?? frame.height;

    state.floatingSnapshot.set(window.get_stable_sequence(), {
        x,
        y,
        width,
        height,
        wasFullscreen: window.is_fullscreen(),
        wasMaximized: maxState === Meta.MaximizeFlags.HORIZONTAL ? 1 :
            maxState === Meta.MaximizeFlags.VERTICAL ? 2 :
                maxState === Meta.MaximizeFlags.BOTH ? 3 : 0,
        stackIndex: maxStackIndex + 1,
    });
    console.log('[SLAB] Captured single snapshot for:', window.title, 'at', x, y, width, 'x', height);
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
                actor.hide();
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
                    actor.show();
                } catch (e) { }
            }
        });
    });
}

/**
 * Apply Master-Stack layout to all tileable windows.
 * @param newWindow - If provided, this window is being ADDED to the layout. We snapshot it but preserve others.
 */
export function applyMasterStackToWorkspace(state: SlabState, captureSnapshot: boolean = false, newWindow?: Meta.Window): void {
    console.log('[SLAB] applyMasterStackToWorkspace called, captureSnapshot:', captureSnapshot, 'newWindow:', newWindow?.title);

    if (!state.settings) {
        console.error('[SLAB] No settings available!');
        resumeAnimations();
        return;
    }

    const display = global.display;
    const workspace = display.get_workspace_manager().get_active_workspace();
    const monitor = state.currentMonitor;

    console.log('[SLAB] Current monitor:', monitor);

    // Get ALL normal windows...
    const allWindows = workspace.list_windows().filter((window: Meta.Window) => {
        if (window.window_type !== Meta.WindowType.NORMAL) return false;
        if (window.is_on_all_workspaces()) return false;
        if (window.get_monitor() !== monitor) return false;
        return true;
    });

    // STEP 1: Snapshot Logic
    if (newWindow) {
        // CRITICAL: Prevent cross-monitor disturbance EARLY
        // If the new window is NOT on this monitor, do not re-tile this monitor
        if (newWindow.get_monitor() !== monitor) {
            console.log(`[SLAB] New window is on monitor ${newWindow.get_monitor()}, skipping layout update for monitor ${monitor}`);
            resumeAnimations();
            return;
        }
        // NOTE: Snapshot for newWindow will be captured AFTER layout calculation
        // so we use the TARGET position, not the current (wrong) position
        console.log('[SLAB] New window detected, will capture snapshot after layout calc');
    } else if (captureSnapshot) {
        // CASE B: Enabling tiling -> Snapshot EVERYONE
        console.log('[SLAB] Enabling tiling, capturing full snapshot');
        state.floatingSnapshot = captureFloatingSnapshot(allWindows);
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

                // 3. FORCE HIDE to treat this visual update as atomic
                actor.hide();
            } catch (e) {
                console.error('[SLAB] Error inhibiting animations:', e);
            }
        }

        // First: unfullscreen and unmaximize all windows
        for (const window of allWindows) {
            try {
                if (window.is_hidden() && window !== newWindow) continue;

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
        const windows = getTileableWindows(monitor, newWindow);
        console.log('[SLAB] Tileable windows:', windows.length);

        // REVERSE STACK ORDER for UX
        // getTileableWindows returns [Master, ...Stack(Bottom->Top)]
        // We want [Master, Stack(Top), Stack(Bottom)...]
        // So we reverse the stack portion (index 1 to end)
        if (windows.length > 2) {
            const stack = windows.splice(1).reverse();
            windows.push(...stack);
        }

        // If no windows (shouldn't happen if we have newWindow), resume
        if (windows.length === 0) {
            console.log('[SLAB] No tileable windows, resuming animations');
            // Show actors back if we hid them!
            for (const { actor } of windowActors) actor.show();
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
                // BYPASS HIDDEN CHECK FOR NEW WINDOW
                // The new window might act hidden because we just hid its actor above!
                if (window.is_hidden() && window !== newWindow) {
                    console.log(`[SLAB-DEBUG] Skipping invisible window: ${window.title}`);
                    continue;
                }

                // CAPTURE SNAPSHOT FOR NEW WINDOW WITH TARGET POSITION
                // This fixes Bug 2: Window restores to wrong monitor
                if (newWindow && window.get_stable_sequence() === newWindow.get_stable_sequence()) {
                    console.log('[SLAB] Capturing snapshot for new window with target position');
                    captureSingleWindowSnapshot(state, window, x, y, w, h);

                    // DELAYED MOVE FOR NEW WINDOW (Bug 1 fix)
                    // New windows might not be fully mapped yet, so move_resize_frame fails.
                    // We do BOTH immediate (might fail) AND delayed (backup) moves.
                    const targetX = x, targetY = y, targetW = w, targetH = h;
                    const targetWindow = window;
                    scheduleBeforeRedraw(() => {
                        scheduleBeforeRedraw(() => {
                            scheduleBeforeRedraw(() => {
                                console.log('[SLAB] Delayed move (3 frames) for new window:', targetWindow.title, 'to', targetX, targetY, targetW, targetH);
                                try {
                                    targetWindow.move_resize_frame(true, targetX, targetY, targetW, targetH);
                                } catch (e) {
                                    console.error('[SLAB] Delayed move failed:', e);
                                }
                            });
                        });
                    });
                    // Don't skip immediate move - do both!
                }

                console.log('[SLAB] Moving:', window.title, 'to', x, y, w, h);
                window.move_resize_frame(true, x, y, w, h);
            } catch (e) {
                console.error('[SLAB] Error tiling window:', window.title, e);
            }
        }

        // STEP 4: Restore Visibility (Frame 2)
        scheduleBeforeRedraw(() => {
            console.log('[SLAB] Frame 2: Showing actors (easing still disabled)');
            for (const { actor } of windowActors) {
                try {
                    // Show immediately, but keep easing disabled to swallow client-side adjustments
                    actor.show();
                    (actor as any).remove_all_transitions();
                } catch (e) { }
            }

            // STEP 5: Restore Easing & Resume Animations (Frame 3)
            scheduleBeforeRedraw(() => {
                console.log('[SLAB] Frame 3: Restoring easing state');
                for (const { actor } of windowActors) {
                    try {
                        actor.restore_easing_state();
                    } catch (e) { }
                }
                resumeAnimations();
            });
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
