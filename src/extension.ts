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
import Meta from "gi://Meta";

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
import { SlabIndicator, SlabIndicatorInstance } from "./ui/indicator.js";

// =============================================================================
// EXTENSION LIFECYCLE
// =============================================================================
export default class SlabExtension extends Extension {
  private _state: SlabState | null = null;
  private _indicator: SlabIndicatorInstance | null = null;

  enable(): void {
    console.log("[SLAB] Extension enable() called");

    // Initialize state
    this._state = {
      tilingEnabled: false,
      floatingSnapshot: new Map(),
      currentMasterWindowId: null,
      windowSignals: new Map(),
      poppedOutWindows: new Set(),
      workspaceStates: new Map(),
      activeWorkspaceIndex: global.workspace_manager
        .get_active_workspace()
        .index(),
      settings: this.getSettings(),
      signalIds: [],
      blockedSignals: new Map(),
      pendingLaterId: null,
      currentMonitor: 0,
      pendingNewWindowTimeoutId: null,
      dragState: null,
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
            // Update indicator and show OSD
            this._indicator?.updateState(this._state.tilingEnabled);
            SlabIndicator.showOSD(this._state.tilingEnabled);
          }
        },
      );
      console.log("[SLAB] Toggle keybinding registered");
    } catch (e) {
      console.error("[SLAB] Failed to register toggle keybinding:", e);
    }

    // panel indicator
    const stateForIndicator = this._state;
    const extensionRef = this;
    const indicator = new (SlabIndicator as any)();
    this._indicator = indicator;

    if (this._indicator) {
      (this._indicator as any).setup(
        this._state,
        () => {
          // toggle callback
          console.log("[SLAB-EXT] Indicator toggle callback fired");
          console.log("[SLAB-EXT] State exists:", !!stateForIndicator);
          if (stateForIndicator) {
            console.log("[SLAB-EXT] Calling toggleSlab");
            toggleSlab(stateForIndicator);
            console.log(
              "[SLAB-EXT] toggleSlab completed, tilingEnabled:",
              stateForIndicator.tilingEnabled,
            );
            extensionRef._indicator?.updateState(
              stateForIndicator.tilingEnabled,
            );
            SlabIndicator.showOSD(stateForIndicator.tilingEnabled);
          }
        },
        () => {
          // open prefs callback
          console.log("[SLAB-EXT] Indicator openPrefs callback fired");
          extensionRef.openPreferences();
          console.log("[SLAB-EXT] openPreferences called");
        },
      );
    }
    Main.panel.addToStatusArea("slab-indicator", this._indicator);

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
        try {
          // Ignore non-normal windows (tooltips, popups, menus, ...)
          if (window.window_type !== Meta.WindowType.NORMAL) {
            return;
          }

          if (this._state?.tilingEnabled) {
            scheduleBeforeRedraw(() => {
              // Ignore transient windows (dialogs with parent windows)
              if (window.get_transient_for()) {
                return;
              }

              if (this._state?.tilingEnabled) {
                applyMasterStackToWorkspace(this._state, false, window);
              }
            });
          }
        } catch (e) {
          console.error("[SLAB] window-created error:", e);
        }
      },
    );
    this._state.signalIds.push(sigId);

    // listen for workspace switches to save/load per-workspace state
    const workspaceManager = global.workspace_manager;
    const wsSigId = workspaceManager.connect("active-workspace-changed", () => {
      if (!this._state) return;

      const newIndex = workspaceManager.get_active_workspace().index();
      const oldIndex = this._state.activeWorkspaceIndex;

      if (newIndex === oldIndex) return;

      console.log(`[SLAB] Workspace switch: ${oldIndex} -> ${newIndex}`);

      // save current workspace state (only if tiling was enabled)
      if (this._state.tilingEnabled) {
        this._state.workspaceStates.set(oldIndex, {
          tilingEnabled: this._state.tilingEnabled,
          floatingSnapshot: new Map(this._state.floatingSnapshot),
          currentMasterWindowId: this._state.currentMasterWindowId,
          windowSignals: new Map(this._state.windowSignals),
          poppedOutWindows: new Set(this._state.poppedOutWindows),
        });
      }

      // load new workspace state (or defaults if not stored)
      const savedState = this._state.workspaceStates.get(newIndex);
      if (savedState) {
        this._state.tilingEnabled = savedState.tilingEnabled;
        this._state.floatingSnapshot = new Map(savedState.floatingSnapshot);
        this._state.currentMasterWindowId = savedState.currentMasterWindowId;
        this._state.windowSignals = new Map(savedState.windowSignals);
        this._state.poppedOutWindows = new Set(savedState.poppedOutWindows);
        console.log(
          `[SLAB] Loaded saved state for workspace ${newIndex}, tiling: ${savedState.tilingEnabled}`,
        );
      } else {
        // reset to defaults (OFF)
        this._state.tilingEnabled = false;
        this._state.floatingSnapshot = new Map();
        this._state.currentMasterWindowId = null;
        this._state.windowSignals = new Map();
        this._state.poppedOutWindows = new Set();
        console.log(
          `[SLAB] No saved state for workspace ${newIndex}, tiling: OFF`,
        );
      }

      this._state.activeWorkspaceIndex = newIndex;

      this._indicator?.updateState(this._state.tilingEnabled);
    });
    this._state.signalIds.push(wsSigId);

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

      // Destroy panel indicator
      if (this._indicator) {
        this._indicator.destroy();
        this._indicator = null;
      }

      // Clear state
      this._state = null;
    }

    console.log("[SLAB] Extension disabled");
  }
}
