// =============================================================================
// SLAB PREFERENCES UI
// =============================================================================
// GTK4/Adw preferences window for SLAB extension settings.
// Provides controls for keybindings, master ratio, and window gap.

import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";

import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// =============================================================================
// PREFERENCES CLASS
// =============================================================================

export default class SlabPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): void {
    const settings = this.getSettings();

    // Create main preferences page
    const page = new Adw.PreferencesPage({
      title: _("Settings"),
      icon_name: "preferences-system-symbolic",
    });
    window.add(page);

    // Layout
    this._addLayoutGroup(page, settings);

    // Main Keybinding
    this._addMainKeybindingGroup(page, settings);

    // Navigation
    this._addNavigationGroup(page, settings);

    // Swap
    this._addSwapGroup(page, settings);

    // Master Size
    this._addMasterSizeGroup(page, settings);
  }

  // ===========================================================================
  // LAYOUT SETTINGS
  // ===========================================================================

  private _addLayoutGroup(
    page: Adw.PreferencesPage,
    settings: Gio.Settings,
  ): void {
    const group = new Adw.PreferencesGroup({
      title: _("Layout"),
      description: _("Configure the tiled window layout appearance"),
    });
    page.add(group);

    // Master Ratio
    const masterRatioRow = new Adw.SpinRow({
      title: _("Master Area Ratio"),
      subtitle: _(
        "Proportion of screen width for the master window (0.2 - 0.8)",
      ),
      adjustment: new Gtk.Adjustment({
        lower: 0.2,
        upper: 0.8,
        step_increment: 0.05,
        page_increment: 0.1,
      }),
      digits: 2,
    });
    settings.bind(
      "master-ratio",
      masterRatioRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(masterRatioRow);

    // Window Gap
    const gapRow = new Adw.SpinRow({
      title: _("Window Gap"),
      subtitle: _("Spacing in pixels between tiled windows"),
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 64,
        step_increment: 1,
        page_increment: 4,
      }),
      digits: 0,
    });
    settings.bind("window-gap", gapRow, "value", Gio.SettingsBindFlags.DEFAULT);
    group.add(gapRow);
  }

  // ===========================================================================
  // MAIN KEYBINDING
  // ===========================================================================

  private _addMainKeybindingGroup(
    page: Adw.PreferencesPage,
    settings: Gio.Settings,
  ): void {
    const group = new Adw.PreferencesGroup({
      title: _("Toggle Tiling"),
      description: _("Shortcut to enable or disable tiled window management"),
    });
    page.add(group);

    this._addKeybindingRow(
      group,
      settings,
      "toggle-tiling",
      _("Toggle Tiling Mode"),
      _("Activate or deactivate the master-stack layout"),
    );
  }

  // ===========================================================================
  // NAVIGATION KEYBINDINGS
  // ===========================================================================

  private _addNavigationGroup(
    page: Adw.PreferencesPage,
    settings: Gio.Settings,
  ): void {
    const group = new Adw.PreferencesGroup({
      title: _("Focus Navigation"),
      description: _("Move keyboard focus between tiled windows"),
    });
    page.add(group);

    this._addKeybindingRow(
      group,
      settings,
      "focus-left",
      _("Focus Left"),
      _("Move focus to the window on the left"),
    );
    this._addKeybindingRow(
      group,
      settings,
      "focus-right",
      _("Focus Right"),
      _("Move focus to the window on the right"),
    );
    this._addKeybindingRow(
      group,
      settings,
      "focus-up",
      _("Focus Up"),
      _("Move focus to the window above"),
    );
    this._addKeybindingRow(
      group,
      settings,
      "focus-down",
      _("Focus Down"),
      _("Move focus to the window below"),
    );
  }

  // ===========================================================================
  // SWAP KEYBINDINGS
  // ===========================================================================

  private _addSwapGroup(
    page: Adw.PreferencesPage,
    settings: Gio.Settings,
  ): void {
    const group = new Adw.PreferencesGroup({
      title: _("Window Swapping"),
      description: _("Exchange the focused window with a neighbor"),
    });
    page.add(group);

    this._addKeybindingRow(
      group,
      settings,
      "swap-left",
      _("Swap Left"),
      _("Swap with the window on the left"),
    );
    this._addKeybindingRow(
      group,
      settings,
      "swap-right",
      _("Swap Right"),
      _("Swap with the window on the right"),
    );
    this._addKeybindingRow(
      group,
      settings,
      "swap-up",
      _("Swap Up"),
      _("Swap with the window above"),
    );
    this._addKeybindingRow(
      group,
      settings,
      "swap-down",
      _("Swap Down"),
      _("Swap with the window below"),
    );
  }

  // ===========================================================================
  // MASTER SIZE KEYBINDINGS
  // ===========================================================================

  private _addMasterSizeGroup(
    page: Adw.PreferencesPage,
    settings: Gio.Settings,
  ): void {
    const group = new Adw.PreferencesGroup({
      title: _("Master Size"),
      description: _("Adjust the master area width with keyboard"),
    });
    page.add(group);

    this._addKeybindingRow(
      group,
      settings,
      "increase-master-ratio",
      _("Increase Master Size"),
      _("Expand the master window area by 5%"),
    );
    this._addKeybindingRow(
      group,
      settings,
      "decrease-master-ratio",
      _("Decrease Master Size"),
      _("Shrink the master window area by 5%"),
    );
  }

  // ===========================================================================
  // KEYBINDING ROW HELPER
  // ===========================================================================

  private _addKeybindingRow(
    group: Adw.PreferencesGroup,
    settings: Gio.Settings,
    key: string,
    title: string,
    subtitle: string,
  ): void {
    const row = new Adw.ActionRow({
      title: title,
      subtitle: subtitle,
    });

    // current keybinding
    const keybindings = settings.get_strv(key);
    const accelerator = keybindings.length > 0 ? keybindings[0] : "";

    const shortcutLabel = new Gtk.ShortcutLabel({
      accelerator: accelerator,
      disabled_text: _("Disabled"),
      valign: Gtk.Align.CENTER,
    });

    const editButton = new Gtk.Button({
      icon_name: "document-edit-symbolic",
      valign: Gtk.Align.CENTER,
      tooltip_text: _("Edit shortcut"),
      css_classes: ["flat"],
    });

    editButton.connect("clicked", () => {
      this._showKeybindingDialog(
        row.get_root() as Gtk.Window,
        settings,
        key,
        title,
        shortcutLabel,
      );
    });

    row.add_suffix(shortcutLabel);
    row.add_suffix(editButton);
    group.add(row);
  }

  // ===========================================================================
  // KEYBINDING DIALOG
  // ===========================================================================

  private _showKeybindingDialog(
    parent: Gtk.Window,
    settings: Gio.Settings,
    key: string,
    title: string,
    shortcutLabel: Gtk.ShortcutLabel,
  ): void {
    const dialog = new Adw.MessageDialog({
      transient_for: parent,
      modal: true,
      heading: _("Set Shortcut"),
      body: _(
        `Press a key combination for "${title}", or Escape to cancel, or Backspace to disable.`,
      ),
    });

    dialog.add_response("cancel", _("Cancel"));

    const controller = new Gtk.EventControllerKey();
    controller.connect(
      "key-pressed",
      (
        _controller: Gtk.EventControllerKey,
        keyval: number,
        _keycode: number,
        state: number,
      ) => {
        // Escape cancels
        if (keyval === Gtk.accelerator_parse("Escape")[0]) {
          dialog.close();
          return true;
        }

        // Backspace disables
        if (keyval === Gtk.accelerator_parse("BackSpace")[0]) {
          settings.set_strv(key, []);
          shortcutLabel.set_accelerator("");
          dialog.close();
          return true;
        }

        // Filter out modifier-only presses
        const mask =
          state & (Gtk.accelerator_get_default_mod_mask() as unknown as number);
        if (
          keyval === Gtk.accelerator_parse("Control_L")[0] ||
          keyval === Gtk.accelerator_parse("Control_R")[0] ||
          keyval === Gtk.accelerator_parse("Alt_L")[0] ||
          keyval === Gtk.accelerator_parse("Alt_R")[0] ||
          keyval === Gtk.accelerator_parse("Shift_L")[0] ||
          keyval === Gtk.accelerator_parse("Shift_R")[0] ||
          keyval === Gtk.accelerator_parse("Super_L")[0] ||
          keyval === Gtk.accelerator_parse("Super_R")[0]
        ) {
          return false;
        }

        // if valid accelerator
        if (!Gtk.accelerator_valid(keyval, mask)) {
          return false;
        }

        // new accelerator
        const accelerator = Gtk.accelerator_name(keyval, mask);
        if (accelerator) {
          settings.set_strv(key, [accelerator]);
          shortcutLabel.set_accelerator(accelerator);
        }

        dialog.close();
        return true;
      },
    );

    dialog.add_controller(controller);
    dialog.present();
  }
}
