// =============================================================================
// KEYBOARD NAVIGATION MANAGER
// =============================================================================
// Handles keyboard shortcuts for navigating focus and swapping windows.
// Uses vim-style h/j/k/l bindings for directional navigation.

import Meta from "gi://Meta";
import { SlabState } from "../types/index.js";
import {
  getCurrentTiledWindows,
  getCurrentLayoutPositions,
  swapWindowPositions,
} from "./tiling.js";

// =============================================================================
// TYPES
// =============================================================================

type Direction = "left" | "right" | "up" | "down";

// =============================================================================
// MODULE STATE
// =============================================================================

let state: SlabState | null = null;

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize the keyboard manager with extension state.
 */
export function initKeyboardManager(extensionState: SlabState): void {
  state = extensionState;
  console.log("[SLAB-KEYBOARD] Keyboard manager initialized");
}

/**
 * Clean up keyboard manager.
 */
export function cleanupKeyboardManager(): void {
  state = null;
  console.log("[SLAB-KEYBOARD] Keyboard manager cleaned up");
}

// =============================================================================
// FOCUS NAVIGATION
// =============================================================================

/**
 * Move focus to window in the given direction.
 */
export function focusDirection(direction: Direction): void {
  if (!state || !state.tilingEnabled) {
    console.log("[SLAB-KEYBOARD] Tiling not enabled, ignoring focus");
    return;
  }

  const windows = getCurrentTiledWindows();
  if (windows.length === 0) {
    return;
  }

  const focusedWindow = global.display.get_focus_window();
  if (!focusedWindow) {
    // Focus first window if none focused
    windows[0].focus(Meta.CURRENT_TIME);
    return;
  }

  const currentIndex = windows.findIndex(
    (w) => w.get_stable_sequence() === focusedWindow.get_stable_sequence(),
  );

  if (currentIndex === -1) {
    // Focused window not in tiled set, focus first
    windows[0].focus(Meta.CURRENT_TIME);
    return;
  }

  const targetIndex = getNeighborIndex(windows, currentIndex, direction);
  if (targetIndex !== currentIndex && targetIndex >= 0) {
    console.log(
      `[SLAB-KEYBOARD] Focus ${direction}: ${currentIndex} -> ${targetIndex}`,
    );
    windows[targetIndex].focus(Meta.CURRENT_TIME);
  }
}

// =============================================================================
// SWAP OPERATIONS
// =============================================================================

/**
 * Swap focused window with neighbor in the given direction.
 */
export function swapDirection(direction: Direction): void {
  if (!state || !state.tilingEnabled) {
    console.log("[SLAB-KEYBOARD] Tiling not enabled, ignoring swap");
    return;
  }

  const windows = getCurrentTiledWindows();
  if (windows.length < 2) {
    return;
  }

  const focusedWindow = global.display.get_focus_window();
  if (!focusedWindow) {
    return;
  }

  const currentIndex = windows.findIndex(
    (w) => w.get_stable_sequence() === focusedWindow.get_stable_sequence(),
  );

  if (currentIndex === -1) {
    return;
  }

  const targetIndex = getNeighborIndex(windows, currentIndex, direction);
  if (targetIndex !== currentIndex && targetIndex >= 0) {
    console.log(
      `[SLAB-KEYBOARD] Swap ${direction}: ${currentIndex} <-> ${targetIndex}`,
    );
    swapWindowPositions(state, currentIndex, targetIndex);
  }
}

// =============================================================================
// MASTER RATIO ADJUSTMENT
// =============================================================================

/**
 * Increase or decrease the master ratio and re-tile.
 * @param increase If true, increase ratio by 5%; otherwise decrease.
 */
export function adjustMasterRatio(
  increase: boolean,
  settings: {
    get_double: (key: string) => number;
    set_double: (key: string, value: number) => boolean;
  },
): void {
  if (!state || !state.tilingEnabled) {
    console.log(
      "[SLAB-KEYBOARD] Tiling not enabled, ignoring ratio adjustment",
    );
    return;
  }

  const currentRatio = settings.get_double("master-ratio");
  const step = 0.05;
  const minRatio = 0.2;
  const maxRatio = 0.8;

  let newRatio: number;
  if (increase) {
    newRatio = Math.min(maxRatio, currentRatio + step);
  } else {
    newRatio = Math.max(minRatio, currentRatio - step);
  }

  if (newRatio !== currentRatio) {
    console.log(
      `[SLAB-KEYBOARD] Master ratio: ${currentRatio.toFixed(2)} -> ${newRatio.toFixed(2)}`,
    );
    settings.set_double("master-ratio", newRatio);
    // Settings change will trigger re-tile via signal connection
  }
}

// =============================================================================
// NEIGHBOR CALCULATION
// =============================================================================

/**
 * Get the index of the neighbor window in a direction.
 * Uses spatial position to determine neighbors.
 */
function getNeighborIndex(
  windows: Meta.Window[],
  currentIndex: number,
  direction: Direction,
): number {
  const positions = getCurrentLayoutPositions();
  if (positions.length !== windows.length) {
    // Fallback: simple index-based navigation
    return getSimpleNeighborIndex(windows.length, currentIndex, direction);
  }

  const current = positions[currentIndex];
  let bestIndex = currentIndex;
  let bestDistance = Infinity;

  for (let i = 0; i < positions.length; i++) {
    if (i === currentIndex) continue;

    const candidate = positions[i];
    const isCandidate = isInDirection(current, candidate, direction);

    if (isCandidate) {
      const distance = getDistance(current, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
  }

  return bestIndex;
}

/**
 * Simple index-based neighbor (fallback).
 */
function getSimpleNeighborIndex(
  count: number,
  currentIndex: number,
  direction: Direction,
): number {
  switch (direction) {
    case "left":
      // Master is index 0, stack starts at 1
      if (currentIndex === 0) {
        return count > 1 ? 1 : 0; // Go to first stack window
      }
      return 0; // Go to master
    case "right":
      if (currentIndex === 0 && count > 1) {
        return 1; // Master -> first stack
      }
      return currentIndex; // Stay
    case "up":
      if (currentIndex > 1) {
        return currentIndex - 1;
      }
      return currentIndex;
    case "down":
      if (currentIndex < count - 1 && currentIndex > 0) {
        return currentIndex + 1;
      } else if (currentIndex === 0 && count > 1) {
        return 1;
      }
      return currentIndex;
  }
}

/**
 * Check if candidate is in the specified direction from current.
 */
function isInDirection(
  current: { x: number; y: number; width: number; height: number },
  candidate: { x: number; y: number; width: number; height: number },
  direction: Direction,
): boolean {
  const currentCenterX = current.x + current.width / 2;
  const currentCenterY = current.y + current.height / 2;
  const candidateCenterX = candidate.x + candidate.width / 2;
  const candidateCenterY = candidate.y + candidate.height / 2;

  const dx = candidateCenterX - currentCenterX;
  const dy = candidateCenterY - currentCenterY;

  // Use a threshold angle to determine direction
  const threshold = 0.7; // ~45 degrees

  switch (direction) {
    case "left":
      return dx < 0 && Math.abs(dx) > Math.abs(dy) * threshold;
    case "right":
      return dx > 0 && Math.abs(dx) > Math.abs(dy) * threshold;
    case "up":
      return dy < 0 && Math.abs(dy) > Math.abs(dx) * threshold;
    case "down":
      return dy > 0 && Math.abs(dy) > Math.abs(dx) * threshold;
  }
}

/**
 * Get distance between two positions.
 */
function getDistance(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}
