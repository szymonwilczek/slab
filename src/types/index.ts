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

/**
 * State for tracking active drag-and-drop operation
 */
export interface DragState {
  /** Window being dragged */
  draggedWindow: Meta.Window;
  /** Original index in the tiled windows array */
  originalIndex: number;
  /** Signal IDs connected during drag */
  signalIds: number[];
}

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
  /** Current drag state (null if not dragging) */
  dragState: DragState | null;
  /** Set of window stable_sequence IDs that are "popped out" (floating above layout) */
  poppedOutWindows: Set<number>;
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
    workspace_manager: Meta.WorkspaceManager;
    get_window_actors(): WindowActor[];
    compositor?: {
      get_laters(): {
        add(type: number, callback: () => boolean): number;
        remove(id: number): void;
      };
    };
  };
}
