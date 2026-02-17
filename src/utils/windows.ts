import Meta from "gi://Meta";
import GObject from "gi://GObject";
import { SlabState } from "../types/index.js";

export function getWindowMaximizeState(window: Meta.Window): number {
  const h = window.maximized_horizontally;
  const v = window.maximized_vertically;

  if (h && v) return Meta.MaximizeFlags.BOTH;
  if (h) return Meta.MaximizeFlags.HORIZONTAL;
  if (v) return Meta.MaximizeFlags.VERTICAL;
  return 0;
}

export function _blockWindowSignals(
  state: SlabState,
  window: Meta.Window,
  signalIds: number[],
): void {
  const windowId = window.get_stable_sequence();
  state.blockedSignals.set(windowId, signalIds);

  for (const id of signalIds) {
    if (GObject.signal_handler_is_connected(window, id)) {
      GObject.signal_handler_block(window, id);
    }
  }
}

export function _unblockWindowSignals(
  state: SlabState,
  window: Meta.Window,
): void {
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

export function getTileableWindows(
  monitor: number,
  newWindow?: Meta.Window,
  currentMasterId?: number | null,
  poppedOutWindows?: Set<number>,
): Meta.Window[] {
  const display = global.display;
  const workspace = display.get_workspace_manager().get_active_workspace();

  if (!workspace) return [];

  const actors = global.get_window_actors();
  const focusedWindow = display.get_focus_window();

  const tileableWindows: Meta.Window[] = [];

  for (const actor of actors) {
    const window = actor.get_meta_window();
    if (!window) continue;

    if (window.window_type !== Meta.WindowType.NORMAL) continue;
    if (window.get_workspace() !== workspace) continue;

    if (poppedOutWindows?.has(window.get_stable_sequence())) {
      console.log(
        `[SLAB-DEBUG] Skipping ${window.title}: Popped out (floating)`,
      );
      continue;
    }

    const isDebug = true;
    const isNew =
      newWindow &&
      window.get_stable_sequence() === newWindow.get_stable_sequence();

    if (window.get_monitor() !== monitor) {
      if (isDebug)
        console.log(
          `[SLAB-DEBUG] Skipping ${window.title}: Wrong monitor (${window.get_monitor()} vs ${monitor})`,
        );
      continue;
    }

    if (!isNew && window.is_hidden()) {
      if (isDebug) console.log(`[SLAB-DEBUG] Skipping ${window.title}: Hidden`);
      continue;
    }

    const maxState = getWindowMaximizeState(window);
    const isMaximizedOrFullscreen = maxState !== 0 || window.is_fullscreen();

    if (!window.allows_move() || !window.allows_resize()) {
      if (!isMaximizedOrFullscreen) {
        if (isDebug)
          console.log(`[SLAB-DEBUG] Skipping ${window.title}: No move/resize`);
        continue;
      }
    }

    if (window.is_on_all_workspaces()) continue;

    tileableWindows.push(window);
  }

  console.log(
    `[SLAB-DEBUG] Found ${tileableWindows.length} candidates. Focused: ${focusedWindow?.title} New: ${newWindow?.title} CurrentMaster: ${currentMasterId}`,
  );

  if (newWindow) {
    const newWindowId = newWindow.get_stable_sequence();
    const alreadyInList = tileableWindows.some(
      (w) => w.get_stable_sequence() === newWindowId,
    );
    if (!alreadyInList) {
      console.log(
        `[SLAB-DEBUG] newWindow not in actors yet, adding manually to front`,
      );
      tileableWindows.unshift(newWindow);
    }
  }

  let masterWindowId: number | null = null;

  if (newWindow) {
    masterWindowId = newWindow.get_stable_sequence();
    console.log(`[SLAB-DEBUG] Master priority 1: newWindow`);
  } else if (currentMasterId !== null && currentMasterId !== undefined) {
    const existingMaster = tileableWindows.find(
      (w) => w.get_stable_sequence() === currentMasterId,
    );
    if (existingMaster) {
      masterWindowId = currentMasterId;
      console.log(`[SLAB-DEBUG] Master priority 2: preserving currentMaster`);
    }
  }

  if (masterWindowId === null && focusedWindow) {
    masterWindowId = focusedWindow.get_stable_sequence();
    console.log(`[SLAB-DEBUG] Master priority 3: focusedWindow`);
  }

  if (masterWindowId !== null) {
    const masterIndex = tileableWindows.findIndex(
      (w) => w.get_stable_sequence() === masterWindowId,
    );

    if (masterIndex >= 0) {
      console.log(
        `[SLAB-DEBUG] Master window found at index ${masterIndex}, moving to front`,
      );
      const [master] = tileableWindows.splice(masterIndex, 1);
      tileableWindows.unshift(master);
    } else {
      console.log(`[SLAB-DEBUG] Master window NOT found in candidates!`);
    }
  }

  return tileableWindows;
}
