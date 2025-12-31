/**
 * SLAB - Ambient Type Definitions for GJS/GNOME Shell 45+
 * 
 * Minimal type stubs for the GNOME introspection APIs we use.
 * These are NOT complete bindings - only the APIs needed for SLAB.
 * 
 * For full bindings, see: https://gjs-docs.gnome.org/
 */

// =============================================================================
// GJS Module System (GNOME Shell 45+ ESM)
// =============================================================================

declare module 'resource:///org/gnome/shell/extensions/extension.js' {
    export class Extension {
        readonly uuid: string;
        readonly path: string;
        readonly metadata: {
            uuid: string;
            name: string;
            version: number;
            'settings-schema': string;
        };

        getSettings(): Gio.Settings;
        openPreferences(): void;
    }
}

declare module 'gi://Meta' {
    const Meta: typeof import('gi://Meta');
    export default Meta;

    export const CURRENT_TIME: number;

    /**
     * Meta.LaterType - controls when deferred callbacks run
     * BEFORE_REDRAW is critical: runs after layout but before compositing
     */
    export enum LaterType {
        RESIZE = 0,
        BEFORE_REDRAW = 2,   // <-- We use this for protocol sync
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
     * CRITICAL: We pre-allocate these to avoid GC in hot paths
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
         * This EXCLUDES CSD shadows. Use this for layout calculations.
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
        minimize(): void;
        unminimize(): void;

        /**
         * Unfullscreen the window
         */
        unmake_fullscreen(): void;

        /**
         * move_resize_frame() - The PROTOCOL-LEVEL resize
         * This negotiates with Wayland/X11. SLOW. Use for sync only.
         * @param userOp - true if user-initiated (affects constraints)
         * @param x - frame x position
         * @param y - frame y position  
         * @param w - frame width
         * @param h - frame height
         */
        move_resize_frame(userOp: boolean, x: number, y: number, w: number, h: number): void;

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

        activate(timestamp: number): void;

        /**
         * Signal connection for window geometry changes
         * We BLOCK these when enforcing geometry to prevent loops
         */
        connect(signal: 'position-changed' | 'size-changed' | 'unmanaging', callback: () => void): number;
        disconnect(id: number): void;
    }

    export class Workspace {
        index(): number;
        list_windows(): Window[];

        /**
         * Get work area for a specific monitor, excluding panels and docks.
         * CRITICAL: Use this instead of Display.get_monitor_geometry() for tiling.
         */
        get_work_area_for_monitor(monitor: number): Rectangle;
    }

    export class WorkspaceManager {
        get_active_workspace(): Workspace;
        get_active_workspace_index(): number;
        get_n_workspaces(): number;
        get_workspace_by_index(index: number): Workspace | null;

        connect(signal: 'active-workspace-changed' | 'workspace-added' | 'workspace-removed', callback: () => void): number;
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

        connect(signal: 'window-created' | 'grab-op-begin' | 'grab-op-end', callback: (display: Display, window: Window) => void): number;
        disconnect(id: number): void;
    }

    /**
     * later_add() - Schedule callback for next frame
     * CRITICAL: This is how we defer protocol sync without blocking visuals
     */
    export function later_add(type: LaterType, callback: () => boolean): number;
    export function later_remove(id: number): void;
}

declare module 'gi://Shell' {
    const Shell: typeof import('gi://Shell');
    export default Shell;

    import type { Display } from 'gi://Meta';

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
        ALL = 0xFF,
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

declare module 'gi://Clutter' {
    const Clutter: typeof import('gi://Clutter');
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
         * This is the core of the "Teleport Hack"
         */
        set_position(x: number, y: number): void;

        /**
         * set_size() - Instant visual update, NO protocol negotiation
         * WARNING: This may cause visual glitches if the app hasn't
         * rendered to the new size yet. That's acceptable for perceived
         * responsiveness.
         */
        set_size(width: number, height: number): void;

        get_position(): [number, number];
        get_size(): [number, number];

        show(): void;
        hide(): void;
    }
}

declare module 'gi://St' {
    const St: typeof import('gi://St');
    export default St;

    /**
     * St.Settings - Shell Toolkit settings, includes animation control
     */
    export class Settings {
        /**
         * Get the singleton Settings instance
         */
        static get(): Settings;

        /**
         * Inhibit animations - use this to disable ALL animations temporarily
         * Call uninhibit_animations() when done
         */
        inhibit_animations(): void;

        /**
         * Uninhibit animations - re-enable animations after inhibit
         */
        uninhibit_animations(): void;
    }
}

declare module 'gi://Gio' {
    const Gio: typeof import('gi://Gio');
    export default Gio;

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

        connect(signal: string, callback: () => void): number;
        disconnect(id: number): void;

        /**
         * Sync settings to disk - ensures changes are applied immediately
         */
        static sync(): void;
    }
}

declare module 'gi://GLib' {
    const GLib: typeof import('gi://GLib');
    export default GLib;

    export const PRIORITY_DEFAULT: number;
    export const SOURCE_REMOVE: boolean;
    export const SOURCE_CONTINUE: boolean;

    export function timeout_add(priority: number, interval: number, callback: () => boolean): number;
    export function source_remove(id: number): boolean;
    export function idle_add(priority: number, callback: () => boolean): number;
}

declare module 'gi://GObject' {
    const GObject: typeof import('gi://GObject');
    export default GObject;

    export function signal_handler_block(instance: object, handlerId: number): void;
    export function signal_handler_unblock(instance: object, handlerId: number): void;
    export function signal_handler_is_connected(instance: object, handlerId: number): boolean;
}

// Re-export for convenient importing
declare namespace Meta {
    export * from 'gi://Meta';
}

declare namespace Shell {
    export * from 'gi://Shell';
}

declare namespace Clutter {
    export * from 'gi://Clutter';
}

declare namespace Gio {
    export * from 'gi://Gio';
}

declare namespace GLib {
    export * from 'gi://GLib';
}

declare namespace GObject {
    export * from 'gi://GObject';
}

// Main extension interface for keybindings
declare module 'resource:///org/gnome/shell/ui/main.js' {
    export const wm: {
        addKeybinding(
            name: string,
            settings: Gio.Settings,
            flags: number, // Meta.KeyBindingFlags
            mode: Shell.ActionMode,
            callback: () => void
        ): void;
        removeKeybinding(name: string): void;
    };

    export const layoutManager: {
        monitors: Array<{ x: number; y: number; width: number; height: number }>;
        primaryIndex: number;
    };

    export function notify(title: string, body: string): void;
}
