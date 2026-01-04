import Meta from "gi://Meta";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { SlabState, WindowSnapshot, FloatingSnapshot } from "../types/index.js";
import {
  scheduleBeforeRedraw,
  scheduleAfterFrames,
  suspendAnimations,
  resumeAnimations,
} from "../utils/compositor.js";
import {
  getWindowMaximizeState,
  getTileableWindows,
} from "../utils/windows.js";
import { calculateMasterStackLayout } from "../logic/layout.js";
import { initDragManager, cleanupDragManager } from "./drag.js";

// =============================================================================
// DEBUG CONFIGURATION
// =============================================================================
// TODO: Set to false for production to eliminate logging overhead
const DEBUG = true;

// Constants for timing and tuning
const NEW_WINDOW_DELAY_MS = 100;
const ANIMATION_FRAME_SHOW = 1;
const ANIMATION_FRAME_RESTORE = 2;

function log(...args: any[]): void {
  if (DEBUG) console.log("[SLAB]", ...args);
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
      wasMaximized:
        maxState === Meta.MaximizeFlags.HORIZONTAL
          ? 1
          : maxState === Meta.MaximizeFlags.VERTICAL
            ? 2
            : maxState === Meta.MaximizeFlags.BOTH
              ? 3
              : 0,
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
  targetH?: number,
): void {
  const frame = window.get_frame_rect();
  const maxState = getWindowMaximizeState(window);

  // Calculate a safe stack index (append to end)
  let maxStackIndex = 0;
  for (const s of state.floatingSnapshot.values()) {
    if (s.stackIndex > maxStackIndex) maxStackIndex = s.stackIndex;
  }

  // Use target position if provided, otherwise use current frame
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
    wasMaximized:
      maxState === Meta.MaximizeFlags.HORIZONTAL
        ? 1
        : maxState === Meta.MaximizeFlags.VERTICAL
          ? 2
          : maxState === Meta.MaximizeFlags.BOTH
            ? 3
            : 0,
    stackIndex: maxStackIndex + 1,
  });
  console.log(
    "[SLAB] Captured single snapshot for:",
    window.title,
    "at",
    x,
    y,
    width,
    "x",
    height,
  );
}

/**
 * Restore windows to their floating positions, fullscreen state, and z-order.
 * Called when tiling is DISABLED.
 *
 * Uses actor hiding to prevent compositor animations during transition.
 */
export function restoreFloatingPositions(
  state: SlabState,
  windows: Meta.Window[],
): void {
  const windowsWithSnapshot: Array<{
    window: Meta.Window;
    snapshot: WindowSnapshot;
  }> = [];

  for (const window of windows) {
    const snapshot = state.floatingSnapshot.get(window.get_stable_sequence());
    if (snapshot) {
      windowsWithSnapshot.push({ window, snapshot });
      console.log(
        `[SLAB] Found snapshot for ${window.title}: ${snapshot.x},${snapshot.y} ${snapshot.width}x${snapshot.height}`,
      );
    } else {
      console.log(
        `[SLAB] NO snapshot for ${window.title} (ID: ${window.get_stable_sequence()})`,
      );
    }
  }

  console.log(
    `[SLAB] Snapshot map has ${state.floatingSnapshot.size} entries, matched ${windowsWithSnapshot.length} windows`,
  );
  if (windowsWithSnapshot.length === 0) return;

  // Sort by stackIndex (bottom to top) to restore in correct z-order
  windowsWithSnapshot.sort(
    (a, b) => a.snapshot.stackIndex - b.snapshot.stackIndex,
  );

  console.log(
    "[SLAB] Restoring",
    windowsWithSnapshot.length,
    "windows in stacking order",
  );

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
    if (
      snapshot.wasFullscreen &&
      snapshot.stackIndex > maxFullscreenStackIndex
    ) {
      maxFullscreenStackIndex = snapshot.stackIndex;
    }
  }

  // Use GNOME Shells native mechanism to skip animations inside the callback
  // This atomic transaction ensures we catch the exact frame where geometry changes
  scheduleBeforeRedraw(() => {
    console.log("[SLAB] Restore callback executing - Suppressing animations");

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
        console.error("[SLAB] Error inhibiting animations:", e);
      }
    }

    // === Restore all windows in stacking order ===
    for (const { window, snapshot } of windowsWithSnapshot) {
      try {
        console.log(
          `[SLAB] Restoring ${window.title} to ${snapshot.x},${snapshot.y} ${snapshot.width}x${snapshot.height}`,
        );

        // Restore geometry
        window.move_resize_frame(
          true,
          snapshot.x,
          snapshot.y,
          snapshot.width,
          snapshot.height,
        );

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
        console.log("[SLAB] Error restoring window:", window.title);
      }
    }

    // === Re-raise windows that were ABOVE fullscreen windows ===
    if (maxFullscreenStackIndex >= 0) {
      for (const { window, snapshot } of windowsWithSnapshot) {
        if (
          !snapshot.wasFullscreen &&
          snapshot.stackIndex > maxFullscreenStackIndex
        ) {
          try {
            if (!window.is_hidden()) {
              window.raise();
            }
          } catch (e) {}
        }
      }
    }

    // === Restore actor state & Resume animations ===
    scheduleBeforeRedraw(() => {
      console.log("[SLAB] Restore complete, restoring actor state");
      for (const { actor } of windowActors) {
        try {
          actor.restore_easing_state();
          actor.show();
        } catch (e) {}
      }
    });
  });
}

/**
 * Apply Master-Stack layout to all tileable windows.
 * @param newWindow - If provided, this window is being ADDED to the layout. We snapshot it but preserve others.
 */
export function applyMasterStackToWorkspace(
  state: SlabState,
  captureSnapshot: boolean = false,
  newWindow?: Meta.Window,
): void {
  console.log(
    "[SLAB] applyMasterStackToWorkspace called, captureSnapshot:",
    captureSnapshot,
    "newWindow:",
    newWindow?.title,
  );

  if (!state.settings) {
    console.error("[SLAB] No settings available!");
    resumeAnimations();
    return;
  }

  const display = global.display;
  const workspace = display.get_workspace_manager().get_active_workspace();
  const monitor = state.currentMonitor;

  console.log("[SLAB] Current monitor:", monitor);

  // Get ALL normal windows...
  const allWindows = workspace.list_windows().filter((window: Meta.Window) => {
    if (window.window_type !== Meta.WindowType.NORMAL) return false;
    if (window.is_on_all_workspaces()) return false;
    if (window.get_monitor() !== monitor) return false;
    return true;
  });

  // Snapshot Logic
  if (newWindow) {
    // Prevent cross-monitor disturbance EARLY
    // If the new window is NOT on this monitor, do not re-tile this monitor
    if (newWindow.get_monitor() !== monitor) {
      console.log(
        `[SLAB] New window is on monitor ${newWindow.get_monitor()}, skipping layout update for monitor ${monitor}`,
      );
      resumeAnimations();
      return;
    }
    // Snapshot for newWindow will be captured AFTER layout calculation
    // so we use the TARGET position, not the current (wrong) position
    console.log(
      "[SLAB] New window detected, will capture snapshot after layout calc",
    );
  } else if (captureSnapshot) {
    // CASE B: Enabling tiling -> Snapshot EVERYONE
    log("Enabling tiling, clearing old snapshots and capturing full snapshot");
    state.floatingSnapshot.clear(); // prevent memory leak
    state.floatingSnapshot = captureFloatingSnapshot(allWindows);
  }

  console.log("[SLAB] Preparing atomic transition");

  // Collect actors for all windows we'll modify
  const windowActors: Array<{ window: Meta.Window; actor: any }> = [];
  for (const window of allWindows) {
    const actor = window.get_compositor_private();
    if (actor) {
      windowActors.push({ window, actor });
    }
    if (window.is_fullscreen()) {
      console.log("[SLAB] Window is fullscreen:", window.title);
    }
  }

  console.log("[SLAB] Preparing atomic transition");

  // Apply layout atomically
  scheduleBeforeRedraw(() => {
    console.log("[SLAB] === Atomic transition executing ===");

    // Suppress animations for all windows involved
    for (const { window, actor } of windowActors) {
      try {
        // 1. Skip Shell-level effects (Minimize/Maximize/Map)
        Main.wm.skipNextEffect(actor);

        // 2. Kill Clutter-level implicit animations (Easing)
        actor.save_easing_state();
        actor.set_easing_duration(0);
        (actor as any).remove_all_transitions();

        // 3. FORCE HIDE to treat this visual update as atomic
        if (
          !newWindow ||
          window.get_stable_sequence() !== newWindow.get_stable_sequence()
        ) {
          actor.hide();
        }
      } catch (e) {
        console.error("[SLAB] Error inhibiting animations:", e);
      }
    }

    // First: unfullscreen and unmaximize all windows
    // CRITICAL: Handle newWindow EXPLICITLY first - it might not be in allWindows yet (race condition)
    // or might have been fullscreen/maximized in previous session
    if (newWindow) {
      try {
        if (newWindow.is_fullscreen()) {
          console.log("[SLAB] Unfullscreening NEW WINDOW:", newWindow.title);
          newWindow.unmake_fullscreen();
        }
        const newMaxState = getWindowMaximizeState(newWindow);
        if (newMaxState !== 0) {
          console.log("[SLAB] Unmaximizing NEW WINDOW:", newWindow.title);
          newWindow.unmaximize(Meta.MaximizeFlags.BOTH);
        }
      } catch (e) {
        console.error("[SLAB] Error unfullscreening new window:", e);
      }
    }

    // Then handle all other windows
    for (const window of allWindows) {
      try {
        // Skip newWindow - already handled above
        if (
          newWindow &&
          window.get_stable_sequence() === newWindow.get_stable_sequence()
        )
          continue;
        if (window.is_hidden()) continue;

        if (window.is_fullscreen()) {
          console.log("[SLAB] Unfullscreening:", window.title);
          window.unmake_fullscreen();
        }

        const maxState = getWindowMaximizeState(window);
        if (maxState !== 0) {
          console.log("[SLAB] Unmaximizing:", window.title);
          window.unmaximize(Meta.MaximizeFlags.BOTH);
        }
      } catch (e) {
        console.error("[SLAB] Error unfullscreening:", e);
      }
    }

    // Get tileable windows and calculate layout
    const windows = getTileableWindows(
      monitor,
      newWindow,
      state.currentMasterWindowId,
    );
    console.log("[SLAB] Tileable windows:", windows.length);

    // REVERSE STACK ORDER for UX
    // getTileableWindows returns [Master, ...Stack(Bottom->Top)]
    // We want [Master, Stack(Top), Stack(Bottom)...]
    // So we reverse the stack portion (index 1 to end)
    if (windows.length > 2) {
      const stack = windows.splice(1).reverse();
      windows.push(...stack);
    }

    // If no windows (shouldnt happen if we have newWindow), resume
    if (windows.length === 0) {
      console.log("[SLAB] No tileable windows, resuming animations");
      // Show actors back if we hid them!
      for (const { actor } of windowActors) actor.show();
      resumeAnimations();
      return;
    }

    const workArea = workspace.get_work_area_for_monitor(monitor);
    console.log(
      "[SLAB] Work area:",
      workArea.x,
      workArea.y,
      workArea.width,
      "x",
      workArea.height,
    );

    const masterRatio = state.settings!.get_double("master-ratio");
    const gap = state.settings!.get_int("window-gap");

    const layoutResult = calculateMasterStackLayout(
      windows,
      workArea,
      masterRatio,
      gap,
    );
    const layout = layoutResult.entries;

    // Minimize skipped windows so they're out of the way
    if (layoutResult.skippedWindows.length > 0) {
      console.log(
        `[SLAB] Minimizing ${layoutResult.skippedWindows.length} skipped windows:`,
        layoutResult.skippedWindows.map((w) => w.title).join(", "),
      );
      for (const skippedWindow of layoutResult.skippedWindows) {
        try {
          skippedWindow.minimize();
        } catch (e) {
          console.error(
            `[SLAB] Error minimizing window ${skippedWindow.title}:`,
            e,
          );
        }
      }
    }

    console.log("[SLAB] Calculated layout for", layout.length, "windows");

    // Update current tiled windows order for drag manager
    const tiledWindowsOrder = layout.map((entry) => entry.window);
    setCurrentTiledWindows(tiledWindowsOrder);

    // Update layout positions for drag swap optimization
    const layoutPositions = layout.map((entry) => ({
      x: entry.x,
      y: entry.y,
      width: entry.w,
      height: entry.h,
    }));
    setCurrentLayoutPositions(layoutPositions);

    // Track Master window (first in layout is Master)
    if (layout.length > 0) {
      state.currentMasterWindowId = layout[0].window.get_stable_sequence();
      console.log("[SLAB] Current Master:", layout[0].window.title);
    }

    // Connect unmanaging signals to all windows in layout (but NOT skipped ones)
    for (const { window } of layout) {
      connectWindowSignal(state, window);
    }

    // Apply geometry to all windows
    for (const { window, x, y, w, h } of layout) {
      try {
        // BYPASS HIDDEN CHECK FOR NEW WINDOW
        // The new window might act hidden because we just hid its actor above!
        if (window.is_hidden() && window !== newWindow) {
          console.log(
            `[SLAB-DEBUG] Skipping invisible window: ${window.title}`,
          );
          continue;
        }

        // CAPTURE SNAPSHOT FOR NEW WINDOW WITH TARGET POSITION
        if (
          newWindow &&
          window.get_stable_sequence() === newWindow.get_stable_sequence()
        ) {
          console.log(
            "[SLAB] Capturing snapshot for new window with target position",
          );
          captureSingleWindowSnapshot(state, window, x, y, w, h);

          // DELAYED MOVE FOR NEW WINDOW
          // New windows might not be fully mapped yet, so move_resize_frame fails.
          // GLib.timeout_add for a reliable time-based 100ms delay
          // This ensures the window is fully visible and initialized before resize.
          const targetX = x,
            targetY = y,
            targetW = w,
            targetH = h;
          const targetWindow = window;
          // Cancel any previous pending timeout
          if (state.pendingNewWindowTimeoutId !== null) {
            GLib.source_remove(state.pendingNewWindowTimeoutId);
          }

          state.pendingNewWindowTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            NEW_WINDOW_DELAY_MS,
            () => {
              state.pendingNewWindowTimeoutId = null; // Clear on execution

              // Safety check: ensure tiling is still enabled
              if (!state.tilingEnabled) {
                log("Tiling disabled, skipping delayed move");
                return GLib.SOURCE_REMOVE;
              }

              // Safety check: ensure window still exists (wasnt closed)
              // by verifying the window is still in the current workspace
              try {
                const workspace =
                  global.workspace_manager.get_active_workspace();
                const currentWindows = workspace.list_windows();
                const windowStillExists = currentWindows.some(
                  (w: Meta.Window) =>
                    w.get_stable_sequence() ===
                    targetWindow.get_stable_sequence(),
                );

                if (!windowStillExists) {
                  log("Window was closed, skipping delayed move");
                  return GLib.SOURCE_REMOVE;
                }
              } catch (e) {
                log("Error checking window existence, skipping delayed move");
                return GLib.SOURCE_REMOVE;
              }

              log(
                `Delayed move (${NEW_WINDOW_DELAY_MS}ms) for new window:`,
                targetWindow.title,
                "to",
                targetX,
                targetY,
                targetW,
                targetH,
              );
              try {
                targetWindow.move_resize_frame(
                  true,
                  targetX,
                  targetY,
                  targetW,
                  targetH,
                );
              } catch (e) {
                console.error("[SLAB] Delayed move failed:", e);
              }
              return GLib.SOURCE_REMOVE;
            },
          );
          // Dont skip immediate move - do both!
        }

        console.log(
          "[SLAB] Moving:",
          window.title,
          `(ID:${window.get_stable_sequence()})`,
          "to",
          x,
          y,
          w,
          h,
        );
        window.move_resize_frame(true, x, y, w, h);
      } catch (e) {
        console.error("[SLAB] Error tiling window:", window.title, e);
      }
    }

    // Restore Visibility (Frame 2)
    scheduleAfterFrames(ANIMATION_FRAME_SHOW, () => {
      log("Frame 2: Showing actors (easing still disabled)");
      for (const { actor } of windowActors) {
        try {
          // Show immediately, but keep easing disabled to swallow client-side adjustments
          actor.show();
          (actor as any).remove_all_transitions();
        } catch (e) {}
      }
    });

    // Restore Easing & Resume Animations (Frame 3)
    scheduleAfterFrames(ANIMATION_FRAME_RESTORE, () => {
      log("Frame 3: Restoring easing state");
      for (const { actor } of windowActors) {
        try {
          actor.restore_easing_state();
        } catch (e) {}
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
  console.log(
    "[SLAB] === toggleSlab called, tilingEnabled:",
    state.tilingEnabled,
    "===",
  );

  // Suspend animations for instant transitions
  suspendAnimations();

  if (state.tilingEnabled) {
    // === DISABLE TILING ===
    console.log("[SLAB] Disabling tiling on monitor:", state.currentMonitor);

    // Clean up drag manager first
    cleanupDragManager(state);

    // Disconnect all window signals
    disconnectAllWindowSignals(state);

    // Get ALL normal windows on this monitor for proper restore
    const workspace = global.workspace_manager.get_active_workspace();
    const allWindows = workspace
      .list_windows()
      .filter(
        (w: Meta.Window) =>
          w.window_type === Meta.WindowType.NORMAL &&
          !w.is_on_all_workspaces() &&
          w.get_monitor() === state.currentMonitor,
      );

    // Unminimize any windows that were minimized (skipped windows)
    for (const window of allWindows) {
      if (window.minimized) {
        console.log(`[SLAB] Unminimizing skipped window: ${window.title}`);
        window.unminimize();
      }
    }

    console.log("[SLAB] Found", allWindows.length, "windows to restore");
    restoreFloatingPositions(state, allWindows);
    state.tilingEnabled = false;
    state.floatingSnapshot.clear();

    // Resume animations after restore completes
    console.log("[SLAB] Scheduling animation resume via scheduleBeforeRedraw");
    scheduleBeforeRedraw(() => {
      console.log("[SLAB] Animation resume callback executing");
      resumeAnimations();
    });
  } else {
    // === ENABLE TILING ===
    // Store the current monitor (where focused window is)
    state.currentMonitor = global.display.get_current_monitor();
    console.log("[SLAB] Enabling tiling on monitor:", state.currentMonitor);
    state.tilingEnabled = true;
    state.dragState = null; // Initialize drag state
    applyMasterStackToWorkspace(state, true);

    // Initialize drag manager (after layout is applied)
    initDragManager(
      state,
      getCurrentTiledWindows,
      (indexA: number, indexB: number) =>
        swapWindowPositions(state, indexA, indexB),
    );
  }

  console.log("[SLAB] === toggleSlab completed ===");
}

// =============================================================================
// WINDOW CLOSE HANDLING
// =============================================================================

/**
 * Handle window close event - recalculate layout with Master succession logic.
 *
 * Rules:
 * - If Master is closed: top-right stack window becomes new Master (counter-clockwise)
 * - If other window is closed: recalculate layout, Master stays same (clockwise fill)
 */
export function handleWindowClose(
  state: SlabState,
  closedWindow: Meta.Window,
): void {
  console.log("[SLAB] handleWindowClose called for:", closedWindow.title);

  if (!state.tilingEnabled) {
    console.log("[SLAB] Tiling not enabled, ignoring window close");
    return;
  }

  const closedId = closedWindow.get_stable_sequence();

  // Remove from snapshot
  state.floatingSnapshot.delete(closedId);

  // Disconnect signals for this window
  const signals = state.windowSignals.get(closedId);
  if (signals) {
    for (const sigId of signals) {
      try {
        closedWindow.disconnect(sigId);
      } catch (e) {
        // Window might already be destroyed
      }
    }
    state.windowSignals.delete(closedId);
  }

  // Check if closed window was the Master
  const wasMaster = state.currentMasterWindowId === closedId;
  console.log("[SLAB] Was Master?", wasMaster);

  if (wasMaster) {
    // Master closed: clear the Master ID, applyMasterStackToWorkspace will pick new one
    // based on focus/stacking order (top-right becomes new Master via reversed stack logic)
    state.currentMasterWindowId = null;
    console.log("[SLAB] Master closed, will promote new Master from stack");
  }

  // Recalculate layout
  scheduleBeforeRedraw(() => {
    if (state.tilingEnabled) {
      console.log("[SLAB] Recalculating layout after window close");
      applyMasterStackToWorkspace(state, false);
    }
  });
}

/**
 * Connect 'unmanaging' signal to a window for close handling.
 */
export function connectWindowSignal(
  state: SlabState,
  window: Meta.Window,
): void {
  const windowId = window.get_stable_sequence();

  // Skip if already connected
  if (state.windowSignals.has(windowId)) {
    return;
  }

  try {
    const sigId = window.connect("unmanaging", () => {
      handleWindowClose(state, window);
    });
    state.windowSignals.set(windowId, [sigId]);
    console.log("[SLAB] Connected unmanaging signal for:", window.title);
  } catch (e) {
    console.error("[SLAB] Failed to connect unmanaging signal:", e);
  }
}

/**
 * Disconnect all window signals (called when tiling is disabled).
 *
 * SAFETY: Copy windowSignals keys to an array BEFORE iterating.
 * This prevents the "hash table modified during iteration" crash that
 * can occur if signal callbacks modify the map.
 */
export function disconnectAllWindowSignals(state: SlabState): void {
  log("Disconnecting all window signals");

  // Build a lookup map of current windows
  const display = global.display;
  const workspace = display.get_workspace_manager().get_active_workspace();
  const allWindows = workspace.list_windows();
  const windowById = new Map<number, Meta.Window>();
  for (const w of allWindows) {
    windowById.set(w.get_stable_sequence(), w);
  }

  // Copy keys to array before iterating
  const windowIds = Array.from(state.windowSignals.keys());

  for (const windowId of windowIds) {
    const signals = state.windowSignals.get(windowId);
    const window = windowById.get(windowId);

    if (signals && window) {
      for (const sigId of signals) {
        try {
          window.disconnect(sigId);
        } catch (e) {
          // Window might have been destroyed
        }
      }
    }
    // If window doesnt exist, signals are already invalid - just skip
  }

  state.windowSignals.clear();
  state.currentMasterWindowId = null;

  // CANCEL PENDING TIMEOUT
  if (state.pendingNewWindowTimeoutId !== null) {
    GLib.source_remove(state.pendingNewWindowTimeoutId);
    state.pendingNewWindowTimeoutId = null;
    log("Cancelled pending new window timeout");
  }
}

// =============================================================================
// DRAG-AND-DROP HELPER FUNCTIONS
// =============================================================================

/** Current tracked order of tiled windows (updated on each layout) */
let currentTiledWindows: Meta.Window[] = [];

/** Layout positions for each window index (x, y, width, height) */
let currentLayoutPositions: Array<{
  x: number;
  y: number;
  width: number;
  height: number;
}> = [];

/**
 * Get the current ordered list of tiled windows.
 * Used by drag manager to determine swap positions.
 */
export function getCurrentTiledWindows(): Meta.Window[] {
  return currentTiledWindows;
}

/**
 * Update the stored tiled windows order.
 * Called after layout calculation.
 */
export function setCurrentTiledWindows(windows: Meta.Window[]): void {
  currentTiledWindows = windows;
}

/**
 * Update the stored layout positions.
 * Called after layout calculation.
 */
export function setCurrentLayoutPositions(
  positions: Array<{ x: number; y: number; width: number; height: number }>,
): void {
  currentLayoutPositions = positions;
}

/**
 * Swap two windows in the tiled layout.
 * Called by drag manager on drop.
 * OPTIMIZED: Directly swaps positions of only 2 windows without full re-tile.
 */
export function swapWindowPositions(
  state: SlabState,
  indexA: number,
  indexB: number,
): void {
  console.log(`[SLAB] Swapping window positions: ${indexA} <-> ${indexB}`);

  if (indexA === indexB) return;
  if (indexA < 0 || indexB < 0) return;
  if (
    indexA >= currentTiledWindows.length ||
    indexB >= currentTiledWindows.length
  )
    return;
  if (
    indexA >= currentLayoutPositions.length ||
    indexB >= currentLayoutPositions.length
  ) {
    console.error(
      "[SLAB] Layout positions not available, falling back to full re-tile",
    );
    suspendAnimations();
    applyMasterStackToWorkspace(state, false);
    return;
  }

  const windowA = currentTiledWindows[indexA];
  const windowB = currentTiledWindows[indexB];

  // LAYOUT positions, not current window positions (which may be dragged)
  const posA = currentLayoutPositions[indexA];
  const posB = currentLayoutPositions[indexB];

  console.log(
    `[SLAB] Layout pos A (index ${indexA}): ${posA.x},${posA.y} ${posA.width}x${posA.height}`,
  );
  console.log(
    `[SLAB] Layout pos B (index ${indexB}): ${posB.x},${posB.y} ${posB.width}x${posB.height}`,
  );

  // Swap windows in the array (update internal state)
  currentTiledWindows[indexA] = windowB;
  currentTiledWindows[indexB] = windowA;

  // Positions stay the same - we just move windows to swapped positions

  // Update master ID if affected
  if (indexA === 0 || indexB === 0) {
    state.currentMasterWindowId = currentTiledWindows[0].get_stable_sequence();
    console.log("[SLAB] New Master after swap:", currentTiledWindows[0].title);
  }

  // Directly move only these 2 windows to each other's layout positions
  suspendAnimations();

  scheduleBeforeRedraw(() => {
    // Suppress animations for both windows
    const actorA = windowA.get_compositor_private();
    const actorB = windowB.get_compositor_private();

    if (actorA) {
      actorA.save_easing_state();
      actorA.set_easing_duration(0);
      (actorA as any).remove_all_transitions();
    }
    if (actorB) {
      actorB.save_easing_state();
      actorB.set_easing_duration(0);
      (actorB as any).remove_all_transitions();
    }

    // Move window A to layout position B (where B WAS)
    windowA.move_resize_frame(true, posB.x, posB.y, posB.width, posB.height);
    // Move window B to layout position A (where A WAS)
    windowB.move_resize_frame(true, posA.x, posA.y, posA.width, posA.height);

    console.log(
      `[SLAB] Swapped: ${windowA.title} -> ${posB.x},${posB.y}, ${windowB.title} -> ${posA.x},${posA.y}`,
    );

    // Restore easing state after a short delay
    scheduleAfterFrames(1, () => {
      if (actorA) actorA.restore_easing_state();
      if (actorB) actorB.restore_easing_state();
      resumeAnimations();
    });
  });
}
