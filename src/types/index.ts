// Window actor interface for stacking order access
export interface WindowActor {
  get_meta_window(): Meta.Window | null;
}

/**
 * WindowSnapshot - Stores complete window state before tiling was enabled.
 *
 * We use stable_sequence (not object reference) because:
 * 1. It persists across GNOME Shell restarts
 * 2. Avoids holding object references that prevent GC of destroyed windows
 */
export interface WindowSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Was window fullscreen before tiling? */
  wasFullscreen: boolean;
  /** Was window maximized before tiling? Stores MaximizeFlags value */
  wasMaximized: number;
  /** Stacking order index (higher = on top). Used to restore z-order. */
  stackIndex: number;
}

export type FloatingSnapshot = Map<number, WindowSnapshot>;

export interface SlabState {
  /** Is tiling currently active? */
  tilingEnabled: boolean;
  /** Snapshot of window positions before tiling was enabled */
  floatingSnapshot: FloatingSnapshot;
  /** GSettings instance */
  settings: Gio.Settings | null;
  /** Connected signal IDs for cleanup (display-level signals) */
  signalIds: number[];
  /** Map of window ID -> blocked signal handler IDs */
  blockedSignals: Map<number, number[]>;
  /** Pending later_add callback ID */
  pendingLaterId: number | null;
  /** Monitor index where tiling is active */
  currentMonitor: number;
  /** Current Master window stable_sequence (for promotion on close) */
  currentMasterWindowId: number | null;
  /** Map of window stable_sequence -> connected signal handler IDs */
  windowSignals: Map<number, number[]>;
  /** Pending GLib.timeout_add source ID for new window positioning (for cancellation) */
  pendingNewWindowTimeoutId: number | null;
}

// Global declaration for TypeScript
declare global {
  var console: {
    log(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
  };
  var global: {
    display: Meta.Display;
    stage: any;
    get_window_actors(): WindowActor[];
    compositor?: {
      get_laters(): {
        add(type: number, callback: () => boolean): number;
        remove(id: number): void;
      };
    };
  };
}
