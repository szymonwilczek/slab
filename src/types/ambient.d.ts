declare module "resource:///org/gnome/shell/extensions/extension.js" {
  export class Extension {
    readonly uuid: string;
    readonly path: string;
    readonly metadata: {
      uuid: string;
      name: string;
      version: number;
      "settings-schema": string;
    };

    getSettings(): Gio.Settings;
    openPreferences(): void;
  }
}

declare module "gi://Meta" {
  const Meta: typeof import("gi://Meta");
  export default Meta;

  export const CURRENT_TIME: number;

  export enum LaterType {
    RESIZE = 0,
    BEFORE_REDRAW = 2, // for protocol sync
    IDLE = 3,
  }

  export enum WindowType {
    NORMAL = 0,
    DESKTOP = 1,
    DOCK = 2,
    DIALOG = 3,
    MODAL_DIALOG = 4,
    TOOLBAR = 5,
    MENU = 6,
    UTILITY = 7,
    SPLASHSCREEN = 8,
    DROPDOWN_MENU = 9,
    POPUP_MENU = 10,
    TOOLTIP = 11,
    NOTIFICATION = 12,
    COMBO = 13,
    DND = 14,
    OVERRIDE_OTHER = 15,
  }

  export enum MaximizeFlags {
    HORIZONTAL = 1,
    VERTICAL = 2,
    BOTH = 3,
  }

  export enum MoveResizeFlags {
    MOVE_ACTION = 1,
    RESIZE_ACTION = 2,
    USER_ACTION = 4,
  }

  export class Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;

    constructor();
    copy(): Rectangle;
    equal(other: Rectangle): boolean;
  }

  export class Window {
    readonly window_type: WindowType;
    readonly title: string;

    get_stable_sequence(): number;
    get_wm_class(): string | null;
    get_compositor_private(): Clutter.Actor | null;
    get_workspace(): Workspace | null;
    get_monitor(): number;
    get_transient_for(): Window | null;
    get_frame_rect(): Rectangle;
    get_buffer_rect(): Rectangle;

    is_on_all_workspaces(): boolean;
    is_skip_taskbar(): boolean;
    is_hidden(): boolean;
    is_fullscreen(): boolean;
    allows_move(): boolean;
    allows_resize(): boolean;

    readonly minimized: boolean;
    minimize(): void;
    unminimize(): void;
    unmake_fullscreen(): void;

    move_resize_frame(
      userOp: boolean,
      x: number,
      y: number,
      w: number,
      h: number,
    ): void;
    maximize(flags: MaximizeFlags): void;
    unmaximize(flags: MaximizeFlags): void;
    unmaximize(flags: MaximizeFlags): void;
    maximized_horizontally: boolean;
    maximized_vertically: boolean;
    make_fullscreen(): void;

    raise(): void;
    focus(timestamp: number): void;
    activate(timestamp: number): void;

    connect(
      signal: "position-changed" | "size-changed" | "unmanaging",
      callback: () => void,
    ): number;
    disconnect(id: number): void;
  }

  export class Workspace {
    index(): number;
    list_windows(): Window[];
    get_work_area_for_monitor(monitor: number): Rectangle;
  }

  export class WorkspaceManager {
    get_active_workspace(): Workspace;
    get_active_workspace_index(): number;
    get_n_workspaces(): number;
    get_workspace_by_index(index: number): Workspace | null;

    connect(
      signal:
        | "active-workspace-changed"
        | "workspace-added"
        | "workspace-removed",
      callback: () => void,
    ): number;
    disconnect(id: number): void;
  }

  export class Display {
    get_workspace_manager(): WorkspaceManager;
    get_focus_window(): Window | null;
    get_n_monitors(): number;
    get_primary_monitor(): number;
    get_current_monitor(): number;
    get_monitor_geometry(monitor: number): Rectangle;
    get_monitor_scale(monitor: number): number;

    connect(
      signal: "window-created",
      callback: (display: Display, window: Window) => void,
    ): number;
    connect(
      signal: "grab-op-begin" | "grab-op-end",
      callback: (display: Display, window: Window, grabOp: GrabOp) => void,
    ): number;
    disconnect(id: number): void;
  }

  export enum GrabOp {
    NONE = 0,
    MOVING = 1,
    KEYBOARD_MOVING = 257,
    MOVING_UNCONSTRAINED = 1025, // Meta+drag
    RESIZING_NW = 2,
    RESIZING_N = 3,
    RESIZING_NE = 4,
    RESIZING_E = 5,
    RESIZING_SE = 6,
    RESIZING_S = 7,
    RESIZING_SW = 8,
    RESIZING_W = 9,
  }

  export function later_add(type: LaterType, callback: () => boolean): number;
  export function later_remove(id: number): void;
}

declare module "gi://Shell" {
  const Shell: typeof import("gi://Shell");
  export default Shell;

  import type { Display } from "gi://Meta";

  export enum ActionMode {
    NONE = 0,
    NORMAL = 1,
    OVERVIEW = 2,
    LOCK_SCREEN = 4,
    UNLOCK_SCREEN = 8,
    LOGIN_SCREEN = 16,
    SYSTEM_MODAL = 32,
    LOOKING_GLASS = 64,
    POPUP = 128,
    ALL = 0xff,
  }

  export class Global {
    readonly display: Display;
    readonly stage: Clutter.Actor;

    get_window_actors(): WindowActor[];
  }

  export class WindowActor {
    get_meta_window(): Meta.Window;
  }

  export function get_global(): Global;
}

declare module "gi://Clutter" {
  const Clutter: typeof import("gi://Clutter");
  export default Clutter;

  export const BUTTON_PRESS: number;
  export const BUTTON_RELEASE: number;

  export const BUTTON_PRIMARY: number;
  export const BUTTON_MIDDLE: number;
  export const BUTTON_SECONDARY: number;

  export const EVENT_STOP: boolean;
  export const EVENT_PROPAGATE: boolean;

  export class Actor {
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;

    set_position(x: number, y: number): void;
    set_size(width: number, height: number): void;
    get_position(): [number, number];

    get_size(): [number, number];

    show(): void;
    hide(): void;

    save_easing_state(): void;
    restore_easing_state(): void;
    set_easing_duration(msecs: number): void;
    set_easing_mode(mode: number): void;
    remove_all_transitions(): void;

    add_child(child: Actor): void;
    remove_child(child: Actor): void;
    destroy(): void;
  }

  export const BUTTON_PRIMARY: number;
  export const BUTTON_SECONDARY: number;
  export const BUTTON_MIDDLE: number;

  export const EVENT_PROPAGATE: boolean;
  export const EVENT_STOP: boolean;

  export interface ButtonEvent {
    get_button(): number;
  }
}

declare module "gi://Gio" {
  const Gio: typeof import("gi://Gio");
  export default Gio;

  export enum SettingsBindFlags {
    DEFAULT = 0,
    GET = 1,
    SET = 2,
    NO_SENSITIVITY = 4,
    GET_NO_CHANGES = 8,
    INVERT_BOOLEAN = 16,
  }

  export class Settings {
    constructor(params: { schema_id: string; path?: string });

    get_strv(key: string): string[];
    get_double(key: string): number;
    get_int(key: string): number;
    get_boolean(key: string): boolean;

    set_strv(key: string, value: string[]): boolean;
    set_double(key: string, value: number): boolean;
    set_int(key: string, value: number): boolean;
    set_boolean(key: string, value: boolean): boolean;

    bind(
      key: string,
      object: object,
      property: string,
      flags: SettingsBindFlags,
    ): void;

    connect(signal: string, callback: () => void): number;
    disconnect(id: number): void;

    static sync(): void;
  }

  export interface GIcon {}

  export namespace Icon {
    function new_for_string(str: string): GIcon;
  }

  export class ThemedIcon implements GIcon {
    constructor(params: { name: string });
    static new(iconName: string): GIcon;
  }

  export function app_info_launch_default_for_uri(
    uri: string,
    context: null,
  ): boolean;
}

declare module "gi://GLib" {
  const GLib: typeof import("gi://GLib");
  export default GLib;

  export const PRIORITY_DEFAULT: number;
  export const SOURCE_REMOVE: boolean;
  export const SOURCE_CONTINUE: boolean;

  export function timeout_add(
    priority: number,
    interval: number,
    callback: () => boolean,
  ): number;
  export function source_remove(id: number): boolean;
  export function idle_add(priority: number, callback: () => boolean): number;
}

declare module "gi://GObject" {
  const GObject: typeof import("gi://GObject");
  export default GObject;

  export function registerClass<T extends new (...args: any[]) => any>(
    klass: T,
  ): T;
  export function registerClass<T extends new (...args: any[]) => any>(
    options: object,
    klass: T,
  ): T;

  export function signal_handler_block(
    instance: object,
    handlerId: number,
  ): void;
  export function signal_handler_unblock(
    instance: object,
    handlerId: number,
  ): void;
  export function signal_handler_is_connected(
    instance: object,
    handlerId: number,
  ): boolean;
}

declare namespace Meta {
  export * from "gi://Meta";
}

declare namespace Shell {
  export * from "gi://Shell";
}

declare namespace Clutter {
  export * from "gi://Clutter";
}

declare namespace Gio {
  export * from "gi://Gio";
}

declare namespace GLib {
  export * from "gi://GLib";
}

declare namespace GObject {
  export * from "gi://GObject";
}

declare module "resource:///org/gnome/shell/ui/main.js" {
  import * as Clutter from "gi://Clutter";
  import * as Gio from "gi://Gio";

  export const wm: {
    addKeybinding(
      name: string,
      settings: Gio.Settings,
      flags: number, // Meta.KeyBindingFlags
      mode: Shell.ActionMode,
      callback: () => void,
    ): void;
    removeKeybinding(name: string): void;
    skipNextEffect(actor: Clutter.Actor): void;
  };

  export const layoutManager: {
    monitors: Array<{ x: number; y: number; width: number; height: number }>;
    primaryIndex: number;
    uiGroup: Clutter.Actor;
    addChrome(actor: Clutter.Actor): void;
    removeChrome(actor: Clutter.Actor): void;
  };

  export const osdWindowManager: {
    show(
      monitor: number,
      icon: Gio.GIcon | string,
      label: string,
      level: number | null,
    ): void;
    showOne(
      monitor: number,
      icon: Gio.GIcon,
      label: string,
      level: number | null,
      maxLevel: number | null,
    ): void;
  };

  export const panel: {
    addToStatusArea(
      role: string,
      indicator: any,
      position?: number,
      box?: string,
    ): any;
  };

  export function notify(title: string, body: string): void;
}

declare module "gi://St" {
  import type Clutter from "gi://Clutter";

  namespace St {
    class Settings {
      static get(): Settings;
      inhibit_animations(): void;
      uninhibit_animations(): void;
    }

    class Widget extends Clutter.Actor {
      constructor(params?: {
        style_class?: string;
        style?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        reactive?: boolean;
        visible?: boolean;
        opacity?: number;
      });

      style_class: string;
      style: string;
      opacity: number;

      add_style_class_name(className: string): void;
      remove_style_class_name(className: string): void;
      has_style_class_name(className: string): boolean;

      destroy(): void;
    }

    class BoxLayout extends Widget {
      constructor(params?: {
        style_class?: string;
        vertical?: boolean;
        x_expand?: boolean;
        y_expand?: boolean;
      });

      vertical: boolean;
    }

    class Bin extends Widget {
      constructor(params?: {
        style_class?: string;
        child?: Clutter.Actor;
        x_fill?: boolean;
        y_fill?: boolean;
      });

      set_child(child: Clutter.Actor | null): void;
      get_child(): Clutter.Actor | null;
    }

    class Label extends Widget {
      constructor(params?: { text?: string; style_class?: string });

      text: string;
    }

    class Icon extends Widget {
      constructor(params?: {
        icon_name?: string;
        icon_size?: number;
        style_class?: string;
      });

      icon_name: string;
      icon_size: number;
    }
  }

  export default St;
}

declare module "gi://Gdk" {
  namespace Gdk {
    // special keys
    const KEY_Escape: number;
    const KEY_BackSpace: number;
    const KEY_Return: number;
    const KEY_Tab: number;
    const KEY_ISO_Left_Tab: number;
    const KEY_space: number;
    const KEY_KP_Enter: number;

    // arrow keys
    const KEY_Left: number;
    const KEY_Right: number;
    const KEY_Up: number;
    const KEY_Down: number;

    // navigation keys
    const KEY_Home: number;
    const KEY_End: number;
    const KEY_Page_Up: number;
    const KEY_Page_Down: number;

    // modifier keys
    const KEY_Shift_L: number;
    const KEY_Shift_R: number;
    const KEY_Control_L: number;
    const KEY_Control_R: number;
    const KEY_Alt_L: number;
    const KEY_Alt_R: number;
    const KEY_Super_L: number;
    const KEY_Super_R: number;
    const KEY_Meta_L: number;
    const KEY_Meta_R: number;
    const KEY_Hyper_L: number;
    const KEY_Hyper_R: number;
    const KEY_ISO_Level3_Shift: number;
    const KEY_ISO_Level5_Shift: number;

    // function keys
    const KEY_F1: number;
    const KEY_F2: number;
    const KEY_F3: number;
    const KEY_F4: number;
    const KEY_F5: number;
    const KEY_F6: number;
    const KEY_F7: number;
    const KEY_F8: number;
    const KEY_F9: number;
    const KEY_F10: number;
    const KEY_F11: number;
    const KEY_F12: number;
    const KEY_F35: number;

    // letter keys
    const KEY_h: number;
    const KEY_j: number;
    const KEY_k: number;
    const KEY_l: number;
    const KEY_H: number;
    const KEY_J: number;
    const KEY_K: number;
    const KEY_L: number;
  }

  export default Gdk;
}

declare module "gi://Gtk" {
  namespace Gtk {
    enum Align {
      FILL = 0,
      START = 1,
      END = 2,
      CENTER = 3,
      BASELINE = 4,
    }

    enum PropagationPhase {
      NONE = 0,
      CAPTURE = 1,
      BUBBLE = 2,
      TARGET = 3,
    }

    class Widget {
      get_root(): Window | null;
      add_controller(controller: EventController): void;
    }

    class Window extends Widget {
      add(child: Widget): void;
      close(): void;
      present(): void;
    }

    class Button extends Widget {
      constructor(params?: {
        label?: string;
        icon_name?: string;
        valign?: Align;
        tooltip_text?: string;
        css_classes?: string[];
      });
      connect(signal: string, callback: () => void): number;
    }

    class ShortcutLabel extends Widget {
      constructor(params?: {
        accelerator?: string;
        disabled_text?: string;
        valign?: Align;
      });
      set_accelerator(accelerator: string): void;
    }

    class Adjustment {
      constructor(params?: {
        value?: number;
        lower?: number;
        upper?: number;
        step_increment?: number;
        page_increment?: number;
        page_size?: number;
      });
    }

    class EventController {
      set_propagation_phase(phase: PropagationPhase): void;
    }

    class EventControllerKey extends EventController {
      connect(
        signal: "key-pressed",
        callback: (
          controller: EventControllerKey,
          keyval: number,
          keycode: number,
          state: number,
        ) => boolean,
      ): number;
      connect(
        signal: "key-released",
        callback: (
          controller: EventControllerKey,
          keyval: number,
          keycode: number,
          state: number,
        ) => void,
      ): number;
    }

    function accelerator_parse(accelerator: string): [number, number];
    function accelerator_valid(keyval: number, modifiers: number): boolean;
    function accelerator_name(keyval: number, modifiers: number): string | null;
    function accelerator_get_default_mod_mask(): number;
  }

  export default Gtk;
}

declare module "gi://Adw" {
  import Gtk from "gi://Gtk";

  namespace Adw {
    class PreferencesWindow extends Gtk.Window {
      add(page: PreferencesPage): void;
    }

    class PreferencesPage extends Gtk.Widget {
      constructor(params?: { title?: string; icon_name?: string });
      add(group: PreferencesGroup): void;
    }

    class PreferencesGroup extends Gtk.Widget {
      constructor(params?: { title?: string; description?: string });
      add(row: PreferencesRow | ActionRow | SpinRow): void;
    }

    class PreferencesRow extends Gtk.Widget {
      constructor(params?: { title?: string });
    }

    class ActionRow extends PreferencesRow {
      constructor(params?: { title?: string; subtitle?: string });
      add_suffix(widget: Gtk.Widget): void;
      add_prefix(widget: Gtk.Widget): void;
    }

    class SpinRow extends ActionRow {
      constructor(params?: {
        title?: string;
        subtitle?: string;
        adjustment?: Gtk.Adjustment;
        digits?: number;
      });
      value: number;
    }

    class MessageDialog extends Gtk.Window {
      constructor(params?: {
        transient_for?: Gtk.Window;
        modal?: boolean;
        heading?: string;
        body?: string;
      });
      add_response(id: string, label: string): void;
      set_response_appearance(id: string, appearance: number): void;
    }
  }

  export default Adw;
}

declare module "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js" {
  import Adw from "gi://Adw";
  import Gio from "gi://Gio";

  export class ExtensionPreferences {
    getSettings(): Gio.Settings;
    fillPreferencesWindow(window: Adw.PreferencesWindow): void;
  }

  export function gettext(str: string): string;
}

declare module "resource:///org/gnome/shell/ui/panelMenu.js" {
  import St from "gi://St";
  import Clutter from "gi://Clutter";

  export class Button extends St.Widget {
    constructor(
      menuAlignment: number,
      nameText: string,
      dontCreateMenu?: boolean,
    );
    _init(...args: any[]): void;

    menu: any; // PopupMenu.PopupMenu
    add_child(child: Clutter.Actor): void;
    connect(signal: string, callback: (...args: any[]) => any): number;
    destroy(): void;
  }
}

declare module "resource:///org/gnome/shell/ui/popupMenu.js" {
  import St from "gi://St";

  export class PopupMenuItem extends St.Widget {
    constructor(text: string, params?: object);
    connect(signal: string, callback: () => void): number;
  }

  export class PopupSeparatorMenuItem extends St.Widget {
    constructor();
  }
}
