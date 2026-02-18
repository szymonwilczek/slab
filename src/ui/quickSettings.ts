import GObject from "gi://GObject";
import St from "gi://St";
// @ts-ignore
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";

import { SlabState } from "../types/index.js";

const SlabToggle = GObject.registerClass(
  class SlabToggle extends QuickSettings.QuickToggle {
    _state: SlabState | null = null;
    _toggleCallback: (() => void) | null = null;
    _settingsCallback: (() => void) | null = null;

    _init() {
      super._init({
        title: "Tiling",
        iconName: "view-grid-symbolic",
        toggleMode: true,
      });

      console.log("[SLAB-QUICK] SlabToggle initialized");

      (this as any).connect("clicked", () => {
        if (this._toggleCallback) {
          (this._toggleCallback as any)();
        }
      });
    }
  },
);

export const SlabIndicator = GObject.registerClass(
  class SlabIndicator extends QuickSettings.SystemIndicator {
    _state: SlabState | null = null;
    _toggle: typeof SlabToggle | null = null;
    _indicator: St.Icon | null = null;

    _init() {
      super._init();
      console.log("[SLAB-QUICK] SlabIndicator _init called");

      try {
        this._indicator = new St.Icon({
          icon_name: "view-grid-symbolic",
          style_class: "system-status-icon",
        });
        (this._indicator as any).visible = true;
        (this as any).add_child(this._indicator);
        (this as any).visible = true;

        this._toggle = new (SlabToggle as any)();
        console.log("[SLAB-QUICK] SlabToggle created:", this._toggle);

        (this as any).quickSettingsItems.push(this._toggle);
        console.log("[SLAB-QUICK] SlabToggle added to quickSettingsItems");
      } catch (e) {
        console.error("[SLAB-QUICK] Error in SlabIndicator _init:", e);
      }
    }

    setup(
      state: SlabState,
      toggleCallback: () => void,
      settingsCallback: () => void,
    ) {
      console.log("[SLAB-QUICK] SlabIndicator setup called");
      this._state = state;
      (this as any).visible = true;

      if (!this._toggle) {
        console.error(
          "[SLAB-QUICK] this._toggle is undefined in setup! Re-attempting creation.",
        );
        try {
          this._toggle = new (SlabToggle as any)();
          (this as any).quickSettingsItems.push(this._toggle);
        } catch (e) {
          console.error("[SLAB-QUICK] Failed to recover toggle:", e);
          return;
        }
      }

      (this._toggle as any)._state = state;
      (this._toggle as any)._toggleCallback = toggleCallback;
      (this._toggle as any)._settingsCallback = settingsCallback;

      if (this._state) {
        (this._toggle as any).set_checked(this._state.tilingEnabled);
        this._updateIcon();
      }
    }

    updateState(tilingEnabled: boolean) {
      (this._toggle as any).set_checked(tilingEnabled);
      this._updateIcon();
    }

    _updateIcon() {
      if (this._indicator) {
        this._indicator.opacity = this._state?.tilingEnabled ? 255 : 128;
        (this as any).visible = true;
      }
    }

    destroy() {
      console.log("[SLAB-QUICK] SlabIndicator destroy called");
      if (this._toggle) {
        (this._toggle as any).destroy();
        this._toggle = null;
      }
      super.destroy();
    }
  },
);
