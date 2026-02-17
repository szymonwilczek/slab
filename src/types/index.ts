export interface WindowActor {
  get_meta_window(): Meta.Window | null;
}

export interface WindowSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  wasFullscreen: boolean;
  wasMaximized: number;
  stackIndex: number;
}

export type FloatingSnapshot = Map<number, WindowSnapshot>;

export interface DragState {
  draggedWindow: Meta.Window;
  originalIndex: number;
  signalIds: number[];
}

export interface WorkspaceState {
  tilingEnabled: boolean;
  floatingSnapshot: FloatingSnapshot;
  currentMasterWindowId: number | null;
  windowSignals: Map<number, number[]>;
  poppedOutWindows: Set<number>;
  tiledWindows: Set<number>;
}

export interface SlabState {
  tilingEnabled: boolean;
  floatingSnapshot: FloatingSnapshot;
  currentMasterWindowId: number | null;
  windowSignals: Map<number, number[]>;
  poppedOutWindows: Set<number>;
  tiledWindows: Set<number>;

  workspaceStates: Map<number, WorkspaceState>;
  activeWorkspaceIndex: number;
  currentMonitor: number;

  settings: Gio.Settings | null;
  signalIds: number[];
  blockedSignals: Map<number, number[]>;
  pendingLaterId: number | null;
  pendingNewWindowTimeoutId: number | null;
  dragState: DragState | null;
}

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
    get_pointer(): [number, number, number];
    compositor?: {
      get_laters(): {
        add(type: number, callback: () => boolean): number;
        remove(id: number): void;
      };
    };
  };
}
