import Meta from "gi://Meta";
import { SlabState } from "../types/index.js";
import { DropZoneOverlay, DropZone, getDropZoneAtPosition } from "./overlay.js";

let overlay: DropZoneOverlay | null = null;
let grabBeginSignalId: number | null = null;
let grabEndSignalId: number | null = null;
let positionChangedSignalId: number | null = null;

/** current layout zones (updated when tiling is recalculated) */
let currentZones: DropZone[] = [];

/** callback to get current tiled windows order */
let getTiledWindowsCallback: (() => Meta.Window[]) | null = null;

/** callback to swap window positions and re-tile */
let swapWindowsCallback: ((indexA: number, indexB: number) => void) | null =
  null;

/**
 * Initialize the drag manager.
 */
export function initDragManager(
  state: SlabState,
  getTiledWindows: () => Meta.Window[],
  swapWindows: (indexA: number, indexB: number) => void,
): void {
  console.log("[SLAB-DRAG] Initializing drag manager");

  getTiledWindowsCallback = getTiledWindows;
  swapWindowsCallback = swapWindows;
  overlay = new DropZoneOverlay();

  const display = global.display;

  grabBeginSignalId = display.connect(
    "grab-op-begin",
    (display: Meta.Display, window: Meta.Window, grabOp: Meta.GrabOp) => {
      handleGrabBegin(state, window, grabOp);
    },
  );

  grabEndSignalId = display.connect(
    "grab-op-end",
    (display: Meta.Display, window: Meta.Window, grabOp: Meta.GrabOp) => {
      handleGrabEnd(state, window);
    },
  );

  console.log("[SLAB-DRAG] Drag manager initialized");
}

/**
 * Clean up the drag manager.
 */
export function cleanupDragManager(state: SlabState): void {
  console.log("[SLAB-DRAG] Cleaning up drag manager");

  const display = global.display;

  if (grabBeginSignalId !== null) {
    display.disconnect(grabBeginSignalId);
    grabBeginSignalId = null;
  }

  if (grabEndSignalId !== null) {
    display.disconnect(grabEndSignalId);
    grabEndSignalId = null;
  }

  cancelDrag(state);

  if (overlay) {
    overlay.destroy();
    overlay = null;
  }

  getTiledWindowsCallback = null;
  swapWindowsCallback = null;
  currentZones = [];

  console.log("[SLAB-DRAG] Drag manager cleaned up");
}

/**
 * Update the available drop zones based on current layout.
 */
export function updateDropZones(zones: DropZone[]): void {
  currentZones = zones;
  console.log(`[SLAB-DRAG] Updated ${zones.length} drop zones`);
}

/**
 * Build drop zones from tiled windows.
 * Each window's current position becomes a drop zone.
 */
export function buildDropZonesFromWindows(windows: Meta.Window[]): DropZone[] {
  const zones: DropZone[] = [];

  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];
    const frame = window.get_frame_rect();

    zones.push({
      index: i,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      windowId: window.get_stable_sequence(),
    });
  }

  return zones;
}

/**
 * Handle grab begin - start tracking if moving a tiled window.
 */
function handleGrabBegin(
  state: SlabState,
  window: Meta.Window,
  grabOp: Meta.GrabOp,
): void {
  if (!state.tilingEnabled) {
    return;
  }

  const isMovingOp =
    grabOp === Meta.GrabOp.MOVING ||
    grabOp === Meta.GrabOp.KEYBOARD_MOVING ||
    grabOp === Meta.GrabOp.MOVING_UNCONSTRAINED;

  if (!isMovingOp) {
    console.log("[SLAB-DRAG] Ignoring non-move grab op:", grabOp);
    return;
  }

  if (!getTiledWindowsCallback) {
    return;
  }

  const tiledWindows = getTiledWindowsCallback();
  const windowId = window.get_stable_sequence();
  const index = tiledWindows.findIndex(
    (w) => w.get_stable_sequence() === windowId,
  );

  if (index === -1) {
    console.log("[SLAB-DRAG] Window not in tiled set, ignoring:", window.title);
    return;
  }

  console.log(`[SLAB-DRAG] Drag started for: ${window.title} (index ${index})`);

  const zones = buildDropZonesFromWindows(tiledWindows);
  updateDropZones(zones);

  state.dragState = {
    draggedWindow: window,
    originalIndex: index,
    signalIds: [],
  };

  positionChangedSignalId = window.connect("position-changed", () => {
    handlePositionChanged(state, window);
  });
  state.dragState.signalIds.push(positionChangedSignalId);
}

/**
 * Handle position changed - update drop zone preview.
 */
function handlePositionChanged(state: SlabState, window: Meta.Window): void {
  if (!state.dragState || !overlay) {
    return;
  }

  // mouse pointer position
  const [x, y] = global.get_pointer();
  const zone = getDropZoneAtPosition(x, y, currentZones);

  if (zone && zone.index !== state.dragState.originalIndex) {
    overlay.show(zone);
  } else {
    overlay.hide();
  }
}

/**
 * Handle grab end - perform swap if dropped on valid zone.
 */
function handleGrabEnd(state: SlabState, window: Meta.Window): void {
  if (!state.dragState || !overlay) {
    return;
  }

  const currentZone = overlay.getCurrentZone();
  const originalIndex = state.dragState.originalIndex;
  const draggedWindow = state.dragState.draggedWindow;

  overlay.hide();

  if (currentZone && currentZone.index !== originalIndex) {
    console.log(
      `[SLAB-DRAG] Swapping index ${originalIndex} <-> ${currentZone.index}`,
    );

    if (swapWindowsCallback) {
      swapWindowsCallback(originalIndex, currentZone.index);
    }
  } else {
    console.log("[SLAB-DRAG] Drag ended without swap - restoring position");

    const originalZone = currentZones.find((z) => z.index === originalIndex);
    if (originalZone) {
      console.log(
        `[SLAB-DRAG] Restoring to: ${originalZone.x},${originalZone.y} ${originalZone.width}x${originalZone.height}`,
      );
      draggedWindow.move_resize_frame(
        true,
        originalZone.x,
        originalZone.y,
        originalZone.width,
        originalZone.height,
      );
    }
  }

  cancelDrag(state);
}

/**
 * Cancel active drag and clean up.
 */
function cancelDrag(state: SlabState): void {
  if (state.dragState) {
    if (positionChangedSignalId !== null) {
      try {
        state.dragState.draggedWindow.disconnect(positionChangedSignalId);
      } catch (e) {
        // window might be destroyed
      }
      positionChangedSignalId = null;
    }

    state.dragState = null;
  }

  overlay?.hide();
}
