/**
 * SLAB - High-Performance Actor-First Tiling Extension for GNOME Shell
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

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import Shell from "gi://Shell";

import { SlabState } from "./types/index.js";
import { scheduleBeforeRedraw } from "./utils/compositor.js";
import {
  toggleSlab,
  applyMasterStackToWorkspace,
  popOutWindow,
  popInWindow,
} from "./managers/tiling.js";
import {
  initKeyboardManager,
  cleanupKeyboardManager,
  focusDirection,
  swapDirection,
  adjustMasterRatio,
} from "./managers/keyboard.js";

// =============================================================================
// EXTENSION LIFECYCLE
// =============================================================================
export default class SlabExtension extends Extension {
  private _state: SlabState | null = null;

  enable(): void {
    console.log("[SLAB] Extension enable() called");

    // Initialize state
    this._state = {
      tilingEnabled: false,
      floatingSnapshot: new Map(),
      settings: this.getSettings(),
      signalIds: [],
      blockedSignals: new Map(),
      pendingLaterId: null,
      currentMonitor: 0,
      currentMasterWindowId: null,
      windowSignals: new Map(),
      pendingNewWindowTimeoutId: null,
      dragState: null,
      poppedOutWindows: new Set(),
    };

    console.log("[SLAB] Settings loaded:", this._state.settings);

    // Register toggle-tiling keybinding
    try {
      Main.wm.addKeybinding(
        "toggle-tiling",
        this._state.settings!,
        0, // Meta.KeyBindingFlags.NONE
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
        () => {
          console.log("[SLAB] Keybinding triggered!");
          if (this._state) {
            toggleSlab(this._state);
          }
        },
      );
      console.log("[SLAB] Toggle keybinding registered");
    } catch (e) {
      console.error("[SLAB] Failed to register toggle keybinding:", e);
    }

    initKeyboardManager(this._state);

    // focus navigation keybindings
    const focusBindings = [
      "focus-left",
      "focus-right",
      "focus-up",
      "focus-down",
    ];
    for (const binding of focusBindings) {
      try {
        Main.wm.addKeybinding(
          binding,
          this._state.settings!,
          0,
          Shell.ActionMode.NORMAL,
          () => {
            const direction = binding.replace("focus-", "") as
              | "left"
              | "right"
              | "up"
              | "down";
            focusDirection(direction);
          },
        );
      } catch (e) {
        console.error(`[SLAB] Failed to register ${binding}:`, e);
      }
    }

    // swap keybindings
    const swapBindings = ["swap-left", "swap-right", "swap-up", "swap-down"];
    for (const binding of swapBindings) {
      try {
        Main.wm.addKeybinding(
          binding,
          this._state.settings!,
          0,
          Shell.ActionMode.NORMAL,
          () => {
            const direction = binding.replace("swap-", "") as
              | "left"
              | "right"
              | "up"
              | "down";
            swapDirection(direction);
          },
        );
      } catch (e) {
        console.error(`[SLAB] Failed to register ${binding}:`, e);
      }
    }

    // master ratio keybindings
    const settings = this._state.settings!;
    try {
      Main.wm.addKeybinding(
        "increase-master-ratio",
        settings,
        0,
        Shell.ActionMode.NORMAL,
        () => adjustMasterRatio(true, settings),
      );
      Main.wm.addKeybinding(
        "decrease-master-ratio",
        settings,
        0,
        Shell.ActionMode.NORMAL,
        () => adjustMasterRatio(false, settings),
      );
    } catch (e) {
      console.error("[SLAB] Failed to register master ratio keybindings:", e);
    }

    // pop-out / pop-in keybindings
    const stateRef = this._state;
    try {
      Main.wm.addKeybinding(
        "pop-out-window",
        settings,
        0,
        Shell.ActionMode.NORMAL,
        () => popOutWindow(stateRef),
      );
      Main.wm.addKeybinding(
        "pop-in-window",
        settings,
        0,
        Shell.ActionMode.NORMAL,
        () => popInWindow(stateRef),
      );
    } catch (e) {
      console.error("[SLAB] Failed to register pop-out/pop-in keybindings:", e);
    }

    console.log("[SLAB] All keybindings registered successfully");

    // Listen for new windows to maintain layout
    const display = global.display;
    const sigId = display.connect(
      "window-created",
      (_display: Meta.Display, window: Meta.Window) => {
        console.log("[SLAB] window-created fired for:", window.title);
        console.log("[SLAB] Has actor?", !!window.get_compositor_private());
        console.log(
          "[SLAB] Monitor:",
          window.get_monitor(),
          "Current Monitor:",
          this._state?.currentMonitor,
        );

        if (this._state?.tilingEnabled) {
          // Schedule layout update synchronized with compositor
          scheduleBeforeRedraw(() => {
            console.log(
              "[SLAB] window-created BEFORE_REDRAW exec for:",
              window.title,
            );
            console.log(
              "[SLAB] Has actor now?",
              !!window.get_compositor_private(),
            );
            if (this._state?.tilingEnabled) {
              applyMasterStackToWorkspace(this._state, false, window);
            }
          });
        }
      },
    );
    this._state.signalIds.push(sigId);

    console.log("[SLAB] Extension enabled successfully");
  }

  disable(): void {
    console.log("[SLAB] Extension disable() called");

    if (this._state) {
      // Restore all windows if tiling is active
      if (this._state.tilingEnabled) {
        // Force toggle off to restore windows
        toggleSlab(this._state);
      }

      // Disconnect generic signals
      const display = global.display;
      for (const id of this._state.signalIds) {
        display.disconnect(id);
      }

      // Remove all keybindings
      Main.wm.removeKeybinding("toggle-tiling");
      Main.wm.removeKeybinding("focus-left");
      Main.wm.removeKeybinding("focus-right");
      Main.wm.removeKeybinding("focus-up");
      Main.wm.removeKeybinding("focus-down");
      Main.wm.removeKeybinding("swap-left");
      Main.wm.removeKeybinding("swap-right");
      Main.wm.removeKeybinding("swap-up");
      Main.wm.removeKeybinding("swap-down");
      Main.wm.removeKeybinding("increase-master-ratio");
      Main.wm.removeKeybinding("decrease-master-ratio");
      Main.wm.removeKeybinding("pop-out-window");
      Main.wm.removeKeybinding("pop-in-window");

      // Clean up keyboard manager
      cleanupKeyboardManager();

      // Clear state
      this._state = null;
    }

    console.log("[SLAB] Extension disabled");
  }
}
