// =============================================================================
// DRAG & DROP MANAGER
// =============================================================================
// Handles drag-and-drop window rearrangement for SLAB tiling.
// Detects when a tiled window is grabbed, shows visual preview of drop zones,
// and performs window swap on drop.

import Meta from "gi://Meta";
import { SlabState } from "../types/index.js";
import { DropZoneOverlay, DropZone, getDropZoneAtPosition } from "./overlay.js";

// =============================================================================
// MODULE STATE
// =============================================================================

let overlay: DropZoneOverlay | null = null;
let grabBeginSignalId: number | null = null;
let grabEndSignalId: number | null = null;
let positionChangedSignalId: number | null = null;

/** Current layout zones (updated when tiling is recalculated) */
let currentZones: DropZone[] = [];

/** Callback to get current tiled windows order */
let getTiledWindowsCallback: (() => Meta.Window[]) | null = null;

/** Callback to swap window positions and re-tile */
let swapWindowsCallback: ((indexA: number, indexB: number) => void) | null =
  null;

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize the drag manager.
 * Call this when tiling is enabled.
 */
export function initDragManager(
  state: SlabState,
  getTiledWindows: () => Meta.Window[],
  swapWindows: (indexA: number, indexB: number) => void,
): void {
  console.log("[SLAB-DRAG] Initializing drag manager");

  // Store callbacks
  getTiledWindowsCallback = getTiledWindows;
  swapWindowsCallback = swapWindows;

  // Create overlay
  overlay = new DropZoneOverlay();

  // Connect to display signals
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
 * When tiling is disabled or extension is destroyed.
 */
export function cleanupDragManager(state: SlabState): void {
  console.log("[SLAB-DRAG] Cleaning up drag manager");

  // Disconnect display signals
  const display = global.display;

  if (grabBeginSignalId !== null) {
    display.disconnect(grabBeginSignalId);
    grabBeginSignalId = null;
  }

  if (grabEndSignalId !== null) {
    display.disconnect(grabEndSignalId);
    grabEndSignalId = null;
  }

  // Clean up any active drag
  cancelDrag(state);

  // Destroy overlay
  if (overlay) {
    overlay.destroy();
    overlay = null;
  }

  // Clear callbacks
  getTiledWindowsCallback = null;
  swapWindowsCallback = null;
  currentZones = [];

  console.log("[SLAB-DRAG] Drag manager cleaned up");
}

// =============================================================================
// DROP ZONE MANAGEMENT
// =============================================================================

/**
 * Update the available drop zones based on current layout.
 * After layout is calculated.
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

// =============================================================================
// DRAG EVENT HANDLERS
// =============================================================================

/**
 * Handle grab begin - start tracking if moving a tiled window.
 */
function handleGrabBegin(
  state: SlabState,
  window: Meta.Window,
  grabOp: Meta.GrabOp,
): void {
  // Only handle when tiling is enabled
  if (!state.tilingEnabled) {
    return;
  }

  // Only handle MOVING operations (not resize)
  // Accept regular MOVING, KEYBOARD_MOVING, and MOVING_UNCONSTRAINED (Meta+drag)
  const isMovingOp =
    grabOp === Meta.GrabOp.MOVING ||
    grabOp === Meta.GrabOp.KEYBOARD_MOVING ||
    grabOp === Meta.GrabOp.MOVING_UNCONSTRAINED;

  if (!isMovingOp) {
    console.log("[SLAB-DRAG] Ignoring non-move grab op:", grabOp);
    return;
  }

  // Check if this window is in our tiled set
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

  // Build drop zones from current layout
  const zones = buildDropZonesFromWindows(tiledWindows);
  updateDropZones(zones);

  // Set up drag state
  state.dragState = {
    draggedWindow: window,
    originalIndex: index,
    signalIds: [],
  };

  // Connect to position changes during drag
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

  // Get current pointer position (use window center as approximation)
  const frame = window.get_frame_rect();
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;

  // Find drop zone under pointer
  const zone = getDropZoneAtPosition(centerX, centerY, currentZones);

  if (zone && zone.index !== state.dragState.originalIndex) {
    // Show overlay on target zone (not dragged window's original zone)
    overlay.show(zone);
  } else {
    // Hide overlay if over original position or outside zones
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

  // Hide overlay
  overlay.hide();

  // Perform swap if dropped on different zone
  if (currentZone && currentZone.index !== originalIndex) {
    console.log(
      `[SLAB-DRAG] Swapping index ${originalIndex} <-> ${currentZone.index}`,
    );

    if (swapWindowsCallback) {
      swapWindowsCallback(originalIndex, currentZone.index);
    }
  } else {
    console.log("[SLAB-DRAG] Drag ended without swap");
  }

  // Clean up drag state
  cancelDrag(state);
}

/**
 * Cancel active drag and clean up.
 */
function cancelDrag(state: SlabState): void {
  if (state.dragState) {
    // Disconnect position signal
    if (positionChangedSignalId !== null) {
      try {
        state.dragState.draggedWindow.disconnect(positionChangedSignalId);
      } catch (e) {
        // Window might be destroyed
      }
      positionChangedSignalId = null;
    }

    state.dragState = null;
  }

  overlay?.hide();
}
