// =============================================================================
// SLAB PANEL INDICATOR
// =============================================================================
// Tray icon in GNOME top panel showing tiling status with status dot.
// Click opens menu with toggle, settings, and about options.

import St from "gi://St";
import Gio from "gi://Gio";
import GObject from "gi://GObject";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { SlabState } from "../types/index.js";

// =============================================================================
// INDICATOR CLASS
// =============================================================================

// module-level references to bypass GObject 'this' binding issues
let _indicatorDot: St.Widget | null = null;
let _indicatorIcon: St.Icon | null = null;

export const SlabIndicator = GObject.registerClass(
  class SlabIndicator extends PanelMenu.Button {
    // all fields must use ! (no initializers work with GObject ;( )
    _state!: SlabState | null;
    _icon!: St.Icon;
    _dot!: St.Widget;
    _box!: St.BoxLayout;
    _toggleCallback!: (() => void) | null;
    _openPrefsCallback!: (() => void) | null;

    _init(): void {
      super._init(0.0, "SLAB Indicator", false);

      console.log("[SLAB-INDICATOR] _init() called");

      this._state = null;
      this._toggleCallback = null;
      this._openPrefsCallback = null;

      this._box = new St.BoxLayout({
        style_class: "panel-status-indicators-box",
      });

      // main icon
      this._icon = new St.Icon({
        icon_name: "view-grid-symbolic",
        style_class: "system-status-icon",
      });

      // disable clipping
      (this._icon as any).set_clip_to_allocation(false);

      // status dot
      this._dot = new St.Widget({
        style: `
                    background-color: #e01b24;
                    border-radius: 4px;
                    width: 8px;
                    height: 8px;
                `,
        visible: true,
        x: 10,
        y: 4,
      });

      this._icon.add_child(this._dot);

      // module-level references for updateState (GObject 'this' binding workaround)
      _indicatorDot = this._dot;
      _indicatorIcon = this._icon;

      this._box.add_child(this._icon);
      this.add_child(this._box);

      console.log(
        "[SLAB-INDICATOR] _init() complete, module refs set: dot=",
        !!_indicatorDot,
        "icon=",
        !!_indicatorIcon,
      );
    }

    /**
     * Setup the indicator with state and callbacks.
     * Must be called after construction due to GObject.registerClass limitations.
     */
    setup(
      state: SlabState,
      toggleCallback: () => void,
      openPrefsCallback: () => void,
    ): void {
      console.log("[SLAB-INDICATOR] setup() called");
      this._state = state;
      this._toggleCallback = toggleCallback;
      this._openPrefsCallback = openPrefsCallback;

      this._buildMenu();
      this._updateState();

      console.log("[SLAB-INDICATOR] setup() complete");
    }

    _buildMenu(): void {
      console.log("[SLAB-INDICATOR] Building menu");

      const toggleItem = new PopupMenu.PopupMenuItem("Toggle Tiling");
      toggleItem.connect("activate", () => {
        console.log("[SLAB-INDICATOR] Toggle Tiling menu item activated");
        if (this._toggleCallback) {
          console.log("[SLAB-INDICATOR] Calling toggle callback");
          this._toggleCallback();
        } else {
          console.error("[SLAB-INDICATOR] Toggle callback is null!");
        }
      });
      this.menu.addMenuItem(toggleItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const settingsItem = new PopupMenu.PopupMenuItem("Settings...");
      settingsItem.connect("activate", () => {
        console.log("[SLAB-INDICATOR] Settings menu item activated");
        if (this._openPrefsCallback) {
          console.log("[SLAB-INDICATOR] Calling openPrefs callback");
          this._openPrefsCallback();
        } else {
          console.error("[SLAB-INDICATOR] OpenPrefs callback is null!");
        }
      });
      this.menu.addMenuItem(settingsItem);

      // opens GitHub repo
      const aboutItem = new PopupMenu.PopupMenuItem("About SLAB");
      aboutItem.connect("activate", () => {
        console.log("[SLAB-INDICATOR] About clicked - opening GitHub");
        try {
          Gio.app_info_launch_default_for_uri(
            "https://github.com/szymonwilczek/slab",
            null,
          );
        } catch (e) {
          console.error("[SLAB-INDICATOR] Failed to open URL:", e);
          Main.notify("SLAB", "https://github.com/szymonwilczek/slab");
        }
      });
      this.menu.addMenuItem(aboutItem);

      console.log("[SLAB-INDICATOR] Menu built");
    }

    /**
     * Update indicator visual state based on tiling enabled/disabled.
     */
    updateState(tilingEnabled: boolean): void {
      console.log(
        "[SLAB-INDICATOR] updateState called, tilingEnabled:",
        tilingEnabled,
        "module refs: dot=",
        !!_indicatorDot,
        "icon=",
        !!_indicatorIcon,
      );

      if (_indicatorDot) {
        _indicatorDot.visible = true; // always visible
        const color = tilingEnabled ? "#2ec27e" : "#e01b24";
        console.log("[SLAB-INDICATOR] Setting dot color to:", color);
        _indicatorDot.style = `
                    background-color: ${color};
                    border-radius: 4px;
                    width: 8px;
                    height: 8px;
                `;
      }
      if (_indicatorIcon) {
        _indicatorIcon.opacity = tilingEnabled ? 255 : 200;
      }
    }

    _updateState(): void {
      if (this._state) {
        this.updateState(this._state.tilingEnabled);
      }
    }

    /**
     * Show OSD notification for tiling state change.
     */
    static showOSD(enabled: boolean): void {
      const iconName = enabled ? "view-grid-symbolic" : "view-restore-symbolic";
      const text = enabled ? "Tiling Enabled" : "Tiling Disabled";

      console.log("[SLAB-INDICATOR] Showing OSD:", text);

      try {
        const monitor = global.display.get_current_monitor();
        const gicon = Gio.Icon.new_for_string(iconName);
        console.log("[SLAB-INDICATOR] Created gicon:", gicon);

        (Main.osdWindowManager as any).showOne(
          monitor,
          gicon,
          text,
          null,
          null,
        );
        console.log("[SLAB-INDICATOR] OSD shown successfully via showOne()");
      } catch (e) {
        console.error("[SLAB-INDICATOR] Failed to show OSD:", e);
        // fallback to notification
        Main.notify("SLAB", text);
      }
    }

    destroy(): void {
      super.destroy();
    }
  },
);

export type SlabIndicatorInstance = InstanceType<typeof SlabIndicator>;
