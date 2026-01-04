/**
 * SLAB - Ambient Type Definitions for GJS/GNOME Shell 45+
 */

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

  /**
   * Meta.LaterType - controls when deferred callbacks run
   * BEFORE_REDRAW is critical: runs after layout but before compositing
   */
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

  /**
   * Rectangle structure - used for geometry calculations
   * CRITICAL: pre-allocate these to avoid GC in hot paths
   */
  export class Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;

    constructor();
    copy(): Rectangle;
    equal(other: Rectangle): boolean;
  }

  /**
   * Meta.Window - the logical window state
   * This is what the WM protocol sees, NOT the visual actor
   */
  export class Window {
    readonly window_type: WindowType;
    readonly title: string;

    /**
     * Stable sequence number - unique ID that persists across restarts
     * Used as key in our FloatingSnapshot map
     */
    get_stable_sequence(): number;

    get_wm_class(): string | null;
    get_compositor_private(): Clutter.Actor | null;
    get_workspace(): Workspace | null;
    get_monitor(): number;

    /**
     * get_frame_rect() - Returns the VISIBLE window geometry
     * This EXCLUDES CSD shadows. For layout calculations.
     */
    get_frame_rect(): Rectangle;

    /**
     * get_buffer_rect() - Returns the FULL buffer including CSD shadows
     * Delta between frame_rect and buffer_rect = shadow compensation
     */
    get_buffer_rect(): Rectangle;

    is_on_all_workspaces(): boolean;
    is_skip_taskbar(): boolean;
    is_hidden(): boolean;
    is_fullscreen(): boolean;
    allows_move(): boolean;
    allows_resize(): boolean;

    /**
     * Minimize/unminimize the window
     */
    readonly minimized: boolean;
    minimize(): void;
    unminimize(): void;

    /**
     * Unfullscreen the window
     */
    unmake_fullscreen(): void;

    /**
     * move_resize_frame() - The PROTOCOL-LEVEL resize
     * This negotiates with Wayland/X11. SLOW. For sync only.
     * @param userOp - true if user-initiated (affects constraints)
     * @param x - frame x position
     * @param y - frame y position
     * @param w - frame width
     * @param h - frame height
     */
    move_resize_frame(
      userOp: boolean,
      x: number,
      y: number,
      w: number,
      h: number,
    ): void;

    /**
     * Maximize the window
     */
    maximize(flags: MaximizeFlags): void;
    unmaximize(flags: MaximizeFlags): void;
    get_maximized(): MaximizeFlags;

    /**
     * Make window fullscreen
     */
    make_fullscreen(): void;

    /**
     * Raise window to top of stacking order
     */
    raise(): void;

    /**
     * Focus this window
     */
    focus(timestamp: number): void;

    activate(timestamp: number): void;

    /**
     * Signal connection for window geometry changes
     * We BLOCK these when enforcing geometry to prevent loops
     */
    connect(
      signal: "position-changed" | "size-changed" | "unmanaging",
      callback: () => void,
    ): number;
    disconnect(id: number): void;
  }

  export class Workspace {
    index(): number;
    list_windows(): Window[];

    /**
     * Get work area for a specific monitor, excluding panels and docks.
     */
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

    /**
     * Returns work area excluding panels/docks
     */
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

  /**
   * Grab operation type - what kind of grab is happening
   * Values from GNOME Mutter source
   */
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

  /**
   * later_add() - Schedule callback for next frame
   * CRITICAL: how we defer protocol sync without blocking visuals
   */
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

  /**
   * Clutter.Actor - the VISUAL representation of a window
   * This is what the compositor draws. Manipulating this = instant feedback.
   */
  export class Actor {
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;

    /**
     * set_position() - Instant visual update, NO protocol negotiation
     */
    set_position(x: number, y: number): void;

    /**
     * set_size() - Instant visual update, NO protocol negotiation
     * WARNING: This may cause visual glitches if the app hasnt
     * rendered to the new size yet. Thats acceptable for perceived
     * responsiveness.
     */
    set_size(width: number, height: number): void;

    get_position(): [number, number];
    get_size(): [number, number];

    show(): void;
    hide(): void;

    // Easing state methods
    save_easing_state(): void;
    restore_easing_state(): void;
    set_easing_duration(msecs: number): void;
    set_easing_mode(mode: number): void;
    remove_all_transitions(): void;

    // Child management
    add_child(child: Actor): void;
    remove_child(child: Actor): void;
    destroy(): void;
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

    /**
     * Sync settings to disk - ensures changes are applied immediately
     */
    static sync(): void;
  }
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

// Re-export for convenient importing
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

// Main extension interface for keybindings
declare module "resource:///org/gnome/shell/ui/main.js" {
  export const wm: {
    addKeybinding(
      name: string,
      settings: Gio.Settings,
      flags: number, // Meta.KeyBindingFlags
      mode: Shell.ActionMode,
      callback: () => void,
    ): void;
    removeKeybinding(name: string): void;
    /**
     * Skip the next effect on the given actor.
     * Used to bypass unfullscreen/unmaximize animations.
     */
    skipNextEffect(actor: Clutter.Actor): void;
  };

  export const layoutManager: {
    monitors: Array<{ x: number; y: number; width: number; height: number }>;
    primaryIndex: number;
    /** The main UI group - add overlays here */
    uiGroup: Clutter.Actor;
    addChrome(actor: Clutter.Actor): void;
    removeChrome(actor: Clutter.Actor): void;
  };

  export function notify(title: string, body: string): void;
}

// St (Shell Toolkit) - GNOME Shell's widget toolkit
declare module "gi://St" {
  import type Clutter from "gi://Clutter";

  namespace St {
    /**
     * St.Settings - Shell Toolkit settings, includes animation control
     */
    class Settings {
      static get(): Settings;
      inhibit_animations(): void;
      uninhibit_animations(): void;
    }

    /**
     * St.Widget - Base class for Shell Toolkit widgets
     */
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

      add_style_class_name(className: string): void;
      remove_style_class_name(className: string): void;
      has_style_class_name(className: string): boolean;

      destroy(): void;
    }

    /**
     * St.BoxLayout - Container with horizontal or vertical layout
     */
    class BoxLayout extends Widget {
      constructor(params?: {
        style_class?: string;
        vertical?: boolean;
        x_expand?: boolean;
        y_expand?: boolean;
      });

      vertical: boolean;
    }

    /**
     * St.Bin - Single-child container widget
     */
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

    /**
     * St.Label - Text label widget
     */
    class Label extends Widget {
      constructor(params?: { text?: string; style_class?: string });

      text: string;
    }
  }

  export default St;
}

// =============================================================================
// GTK4 - For preferences UI
// =============================================================================

declare module "gi://Gtk" {
  namespace Gtk {
    enum Align {
      FILL = 0,
      START = 1,
      END = 2,
      CENTER = 3,
      BASELINE = 4,
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

    class EventController {}

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
    }

    function accelerator_parse(accelerator: string): [number, number];
    function accelerator_valid(keyval: number, modifiers: number): boolean;
    function accelerator_name(keyval: number, modifiers: number): string | null;
    function accelerator_get_default_mod_mask(): number;
  }

  export default Gtk;
}

// =============================================================================
// ADW (Libadwaita) - For modern GNOME preferences UI
// =============================================================================

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

// =============================================================================
// Extension Preferences Module
// =============================================================================

declare module "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js" {
  import Adw from "gi://Adw";
  import Gio from "gi://Gio";

  export class ExtensionPreferences {
    getSettings(): Gio.Settings;
    fillPreferencesWindow(window: Adw.PreferencesWindow): void;
  }

  export function gettext(str: string): string;
}
