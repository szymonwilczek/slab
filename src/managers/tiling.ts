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

// TODO: false for production
const DEBUG = true;
const ANIMATION_FRAME_SHOW = 1;
const ANIMATION_FRAME_RESTORE = 2;

function log(...args: any[]): void {
  if (DEBUG) console.log("[SLAB]", ...args);
}

/**
 * Capture current window state including position, fullscreen, and stacking order.
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

  let maxStackIndex = 0;
  for (const s of state.floatingSnapshot.values()) {
    if (s.stackIndex > maxStackIndex) maxStackIndex = s.stackIndex;
  }

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

  windowsWithSnapshot.sort(
    (a, b) => a.snapshot.stackIndex - b.snapshot.stackIndex,
  );

  console.log(
    "[SLAB] Restoring",
    windowsWithSnapshot.length,
    "windows in stacking order",
  );

  const windowActors: Array<{ window: Meta.Window; actor: any }> = [];
  for (const { window } of windowsWithSnapshot) {
    const actor = window.get_compositor_private();
    if (actor) {
      windowActors.push({ window, actor });
    }
  }

  let maxFullscreenStackIndex = -1;
  for (const { snapshot } of windowsWithSnapshot) {
    if (
      snapshot.wasFullscreen &&
      snapshot.stackIndex > maxFullscreenStackIndex
    ) {
      maxFullscreenStackIndex = snapshot.stackIndex;
    }
  }

  scheduleBeforeRedraw(() => {
    console.log("[SLAB] Restore callback executing - Suppressing animations");

    // suppress animations for all windows involved
    for (const { actor } of windowActors) {
      try {
        // minimize/maximize/map
        Main.wm.skipNextEffect(actor);

        // easing
        actor.save_easing_state();
        actor.set_easing_duration(0);
        (actor as any).remove_all_transitions();
        actor.hide();
      } catch (e) {
        console.error("[SLAB] Error inhibiting animations:", e);
      }
    }

    // restore all windows in stacking order
    for (const { window, snapshot } of windowsWithSnapshot) {
      try {
        console.log(
          `[SLAB] Restoring ${window.title} to ${snapshot.x},${snapshot.y} ${snapshot.width}x${snapshot.height}`,
        );

        // restore geometry
        window.move_resize_frame(
          true,
          snapshot.x,
          snapshot.y,
          snapshot.width,
          snapshot.height,
        );

        // restore maximize state
        if (snapshot.wasMaximized === 3) {
          window.maximize(Meta.MaximizeFlags.BOTH);
        } else if (snapshot.wasMaximized === 1) {
          window.maximize(Meta.MaximizeFlags.HORIZONTAL);
        } else if (snapshot.wasMaximized === 2) {
          window.maximize(Meta.MaximizeFlags.VERTICAL);
        }

        // restore fullscreen state
        if (snapshot.wasFullscreen) {
          window.make_fullscreen();
        }
      } catch (e) {
        console.log("[SLAB] Error restoring window:", window.title);
      }
    }

    // re-raise windows that were ABOVE fullscreen windows
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

    // restore actor state & resume animations
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
 */
export function applyMasterStackToWorkspace(
  state: SlabState,
  captureSnapshot: boolean = false,
): void {
  console.log(
    "[SLAB] applyMasterStackToWorkspace called, captureSnapshot:",
    captureSnapshot,
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

  const allWindows = workspace.list_windows().filter((window: Meta.Window) => {
    if (window.window_type !== Meta.WindowType.NORMAL) return false;
    if (window.is_on_all_workspaces()) return false;
    if (window.get_monitor() !== monitor) return false;
    return true;
  });

  if (captureSnapshot) {
    log("Enabling tiling, clearing old snapshots and capturing full snapshot");
    state.floatingSnapshot.clear();
    state.floatingSnapshot = captureFloatingSnapshot(allWindows);
  }

  console.log("[SLAB] Preparing atomic transition");

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

  scheduleBeforeRedraw(() => {
    console.log("[SLAB] === Atomic transition executing ===");

    const windows = getTileableWindows(
      monitor,
      undefined,
      state.currentMasterWindowId,
      state.poppedOutWindows,
    );
    console.log("[SLAB] Tileable windows:", windows.length);

    if (windows.length > 2) {
      const stack = windows.splice(1).reverse();
      windows.push(...stack);
    }

    // capture the set of windows that are part of the layout
    state.tiledWindows.clear();
    for (const w of windows) {
      state.tiledWindows.add(w.get_stable_sequence());
    }

    // if no windows, resume
    if (windows.length === 0) {
      console.log("[SLAB] No tileable windows, resuming animations");
      for (const { actor } of windowActors) actor.show();
      resumeAnimations();
      return;
    }

    // suppress animations for all windows involved
    for (const { actor } of windowActors) {
      try {
        // minimize/maximize/map
        Main.wm.skipNextEffect(actor);

        // easing
        actor.save_easing_state();
        actor.set_easing_duration(0);
        (actor as any).remove_all_transitions();

        // FORCE HIDE
        actor.hide();
      } catch (e) {
        console.error("[SLAB] Error inhibiting animations:", e);
      }
    }

    // 3. unfullscreen and unmaximize all windows
    for (const window of allWindows) {
      try {
        if (window.is_hidden()) continue;

        if (window.is_fullscreen()) {
          console.log("[SLAB] Unfullscreening:", window.title);
          window.unmake_fullscreen();
        }

        const maxState = getWindowMaximizeState(window);
        if (maxState !== 0) {
          console.log("[SLAB] Unmaximizing:", window.title);
          // @ts-ignore
          window.unmaximize();
        }
      } catch (e) {
        console.error("[SLAB] Error unfullscreening:", e);
      }
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

    const tiledWindowsOrder = layout.map((entry) => entry.window);
    setCurrentTiledWindows(tiledWindowsOrder);

    const layoutPositions = layout.map((entry) => ({
      x: entry.x,
      y: entry.y,
      width: entry.w,
      height: entry.h,
    }));
    setCurrentLayoutPositions(layoutPositions);

    if (layout.length > 0) {
      state.currentMasterWindowId = layout[0].window.get_stable_sequence();
      console.log("[SLAB] Current Master:", layout[0].window.title);
    }

    for (const { window } of layout) {
      connectWindowSignal(state, window);
    }

    for (const { window, x, y, w, h } of layout) {
      try {
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

    scheduleAfterFrames(ANIMATION_FRAME_SHOW, () => {
      log("Frame 2: Showing actors (easing still disabled)");
      for (const { actor } of windowActors) {
        try {
          actor.show();
          (actor as any).remove_all_transitions();
        } catch (e) {}
      }
    });

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

/**
 * Main entry point triggered by keybinding.
 */
export function toggleSlab(state: SlabState): void {
  console.log(
    "[SLAB] === toggleSlab called, tilingEnabled:",
    state.tilingEnabled,
    "===",
  );

  suspendAnimations();

  if (state.tilingEnabled) {
    console.log("[SLAB] Disabling tiling on monitor:", state.currentMonitor);
    cleanupDragManager(state);
    disconnectAllWindowSignals(state);

    const workspace = global.workspace_manager.get_active_workspace();
    const allWindows = workspace
      .list_windows()
      .filter(
        (w: Meta.Window) =>
          w.window_type === Meta.WindowType.NORMAL &&
          !w.is_on_all_workspaces() &&
          w.get_monitor() === state.currentMonitor,
      );

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

    console.log("[SLAB] Scheduling animation resume via scheduleBeforeRedraw");
    scheduleBeforeRedraw(() => {
      console.log("[SLAB] Animation resume callback executing");
      resumeAnimations();
    });
  } else {
    state.currentMonitor = global.display.get_current_monitor();
    console.log("[SLAB] Enabling tiling on monitor:", state.currentMonitor);
    state.tilingEnabled = true;
    state.dragState = null;
    applyMasterStackToWorkspace(state, true);

    initDragManager(
      state,
      getCurrentTiledWindows,
      (indexA: number, indexB: number) =>
        swapWindowPositions(state, indexA, indexB),
    );
  }

  console.log("[SLAB] === toggleSlab completed ===");
}

/**
 * Recalculate layout with Master succession logic.
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

  // was this window part of the tiled layout?
  if (!state.tiledWindows.has(closedId)) {
    console.log(
      "[SLAB] Closed window was NOT part of tiled layout, ignoring reflow",
    );
    return;
  }

  // remove from state
  state.tiledWindows.delete(closedId);
  state.floatingSnapshot.delete(closedId);

  const signals = state.windowSignals.get(closedId);
  if (signals) {
    for (const sigId of signals) {
      try {
        closedWindow.disconnect(sigId);
      } catch (e) {
        // window might already be destroyed
      }
    }
    state.windowSignals.delete(closedId);
  }

  const wasMaster = state.currentMasterWindowId === closedId;
  console.log("[SLAB] Was Master?", wasMaster);

  if (wasMaster) {
    state.currentMasterWindowId = null;
    console.log("[SLAB] Master closed, will promote new Master from stack");
  }

  scheduleBeforeRedraw(() => {
    if (state.tilingEnabled) {
      console.log("[SLAB] Recalculating layout after window close");
      applyMasterStackToWorkspace(state, false);
    }
  });
}

/**
 * Recalculate master ratio based on new dimensions.
 */
export function handleResizeEnd(state: SlabState, window: Meta.Window): void {
  if (!state.tilingEnabled) return;

  const tiledWindows = getCurrentTiledWindows();
  const windowIndex = tiledWindows.indexOf(window);
  if (windowIndex === -1) return; // not a tiled window

  const frame = window.get_frame_rect();
  const layout = currentLayoutPositions[windowIndex];
  if (!layout) return;

  const workspace = global.workspace_manager.get_active_workspace();
  const workArea = workspace.get_work_area_for_monitor(state.currentMonitor);
  const gap = state.settings!.get_int("window-gap");

  const isMaster = windowIndex === 0 && tiledWindows.length > 1;

  if (isMaster) {
    // master width changed - new ratio
    const availableWidth = workArea.width - 3 * gap;
    const newRatio = Math.max(0.2, Math.min(0.8, frame.width / availableWidth));

    const currentRatio = state.settings!.get_double("master-ratio");
    if (Math.abs(newRatio - currentRatio) > 0.01) {
      log(
        `Resize end: master width changed, new ratio: ${newRatio.toFixed(2)}`,
      );
      state.settings!.set_double("master-ratio", newRatio);
      applyMasterStackToWorkspace(state, false);
    } else {
      // snap back if ratio didnt change significantly
      applyMasterStackToWorkspace(state, false);
    }
  } else if (tiledWindows.length > 1) {
    // stack window - check if left edge moved
    const expectedX = layout.x;
    if (Math.abs(frame.x - expectedX) > 10) {
      // left edge moved = new master width
      const masterWidth = frame.x - workArea.x - 2 * gap;
      const availableWidth = workArea.width - 3 * gap;
      const newRatio = Math.max(
        0.2,
        Math.min(0.8, masterWidth / availableWidth),
      );

      const currentRatio = state.settings!.get_double("master-ratio");
      if (Math.abs(newRatio - currentRatio) > 0.01) {
        log(
          `Resize end: stack left edge moved, new ratio: ${newRatio.toFixed(2)}`,
        );
        state.settings!.set_double("master-ratio", newRatio);
      }
    }
    // snap back to tiled position
    applyMasterStackToWorkspace(state, false);
  }
}
/**
 * Connect 'unmanaging' signal to a window for close handling.
 */
export function connectWindowSignal(
  state: SlabState,
  window: Meta.Window,
): void {
  const windowId = window.get_stable_sequence();

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
    console.error("[SLAB] Failed to connect window signal:", e);
  }
}

/**
 * Disconnect all window signals.
 */
export function disconnectAllWindowSignals(state: SlabState): void {
  log("Disconnecting all window signals");

  // lookup map of current windows
  const display = global.display;
  const workspace = display.get_workspace_manager().get_active_workspace();
  const allWindows = workspace.list_windows();
  const windowById = new Map<number, Meta.Window>();
  for (const w of allWindows) {
    windowById.set(w.get_stable_sequence(), w);
  }

  const windowIds = Array.from(state.windowSignals.keys());

  for (const windowId of windowIds) {
    const signals = state.windowSignals.get(windowId);
    const window = windowById.get(windowId);

    if (signals && window) {
      for (const sigId of signals) {
        try {
          window.disconnect(sigId);
        } catch (e) {
          // window might have been destroyed
        }
      }
    }
    // signals are already invalid - just skip
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
 */
export function getCurrentTiledWindows(): Meta.Window[] {
  return currentTiledWindows;
}

/**
 * Update the stored tiled windows order.
 */
export function setCurrentTiledWindows(windows: Meta.Window[]): void {
  currentTiledWindows = windows;
}

/**
 * Get the current layout positions.
 */
export function getCurrentLayoutPositions(): Array<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  return currentLayoutPositions;
}

/**
 * Update the stored layout positions.
 */
export function setCurrentLayoutPositions(
  positions: Array<{ x: number; y: number; width: number; height: number }>,
): void {
  currentLayoutPositions = positions;
}

/**
 * Swap two windows in the tiled layout.
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

  // LAYOUT positions
  const posA = currentLayoutPositions[indexA];
  const posB = currentLayoutPositions[indexB];

  console.log(
    `[SLAB] Layout pos A (index ${indexA}): ${posA.x},${posA.y} ${posA.width}x${posA.height}`,
  );
  console.log(
    `[SLAB] Layout pos B (index ${indexB}): ${posB.x},${posB.y} ${posB.width}x${posB.height}`,
  );

  currentTiledWindows[indexA] = windowB;
  currentTiledWindows[indexB] = windowA;

  if (indexA === 0 || indexB === 0) {
    state.currentMasterWindowId = currentTiledWindows[0].get_stable_sequence();
    console.log("[SLAB] New Master after swap:", currentTiledWindows[0].title);
  }

  suspendAnimations();

  scheduleBeforeRedraw(() => {
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

    // A to layout position B (where B WAS)
    windowA.move_resize_frame(true, posB.x, posB.y, posB.width, posB.height);
    // B to layout position A (where A WAS)
    windowB.move_resize_frame(true, posA.x, posA.y, posA.width, posA.height);

    console.log(
      `[SLAB] Swapped: ${windowA.title} -> ${posB.x},${posB.y}, ${windowB.title} -> ${posA.x},${posA.y}`,
    );

    scheduleAfterFrames(1, () => {
      if (actorA) actorA.restore_easing_state();
      if (actorB) actorB.restore_easing_state();
      resumeAnimations();
    });
  });
}

/**
 * Pop a window OUT of the tiled layout.
 */
export function popOutWindow(state: SlabState): void {
  if (!state.tilingEnabled) {
    console.log("[SLAB] Cannot pop-out: tiling is disabled");
    return;
  }

  const focusedWindow = global.display.get_focus_window();
  if (!focusedWindow) {
    console.log("[SLAB] Cannot pop-out: no focused window");
    return;
  }

  const windowId = focusedWindow.get_stable_sequence();

  if (state.poppedOutWindows.has(windowId)) {
    console.log("[SLAB] Window already popped out:", focusedWindow.title);
    return;
  }

  const snapshot = state.floatingSnapshot.get(windowId);
  if (!snapshot) {
    console.log("[SLAB] No snapshot for window, using current size");
  }

  const monitor = global.display.get_current_monitor();
  const workArea = global.display.get_monitor_geometry(monitor);

  const width = snapshot?.width ?? focusedWindow.get_frame_rect().width;
  const height = snapshot?.height ?? focusedWindow.get_frame_rect().height;
  const x = workArea.x + Math.floor((workArea.width - width) / 2);
  const y = workArea.y + Math.floor((workArea.height - height) / 2);

  console.log(
    `[SLAB] Popping out window: ${focusedWindow.title} -> centered at ${x},${y} ${width}x${height}`,
  );

  state.poppedOutWindows.add(windowId);
  focusedWindow.move_resize_frame(false, x, y, width, height);
  focusedWindow.raise();

  applyMasterStackToWorkspace(state, false);
}

/**
 * Pop a window back IN to the tiled layout.
 */
export function popInWindow(state: SlabState): void {
  if (!state.tilingEnabled) {
    console.log("[SLAB] Cannot pop-in: tiling is disabled");
    return;
  }

  const focusedWindow = global.display.get_focus_window();
  if (!focusedWindow) {
    console.log("[SLAB] Cannot pop-in: no focused window");
    return;
  }

  const windowId = focusedWindow.get_stable_sequence();

  if (!state.poppedOutWindows.has(windowId)) {
    console.log("[SLAB] Window is not popped out:", focusedWindow.title);
    return;
  }

  console.log(`[SLAB] Popping in window: ${focusedWindow.title}`);

  state.poppedOutWindows.delete(windowId);
  state.currentMasterWindowId = windowId;

  applyMasterStackToWorkspace(state, false);
}
