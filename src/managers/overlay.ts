import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export interface DropZone {
  /** Position in tiled windows array (0 = master) */
  index: number;
  /** Bounding rectangle for the drop zone */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Window currently in this zone (null if empty) */
  windowId: number | null;
}

/**
 * Visual overlay showing where a dragged window will be placed.
 */
export class DropZoneOverlay {
  private actor: St.Widget | null = null;
  private currentZone: DropZone | null = null;

  /**
   * Show the overlay at the specified drop zone.
   * Creates the actor if it doesnt exist.
   */
  show(zone: DropZone): void {
    if (
      this.currentZone &&
      this.currentZone.index === zone.index &&
      this.currentZone.x === zone.x &&
      this.currentZone.y === zone.y
    ) {
      return;
    }

    this.currentZone = zone;

    if (!this.actor) {
      this.actor = new St.Widget({
        style: `
          background-color: rgba(52, 152, 219, 0.35);
          border: 3px solid rgba(52, 152, 219, 0.8);
          border-radius: 12px;
        `,
        reactive: false,
        visible: true,
      });

      Main.layoutManager.uiGroup.add_child(this.actor);
    }

    this.actor.set_position(zone.x, zone.y);
    this.actor.set_size(zone.width, zone.height);
    this.actor.show();

    console.log(
      `[SLAB-DRAG] Overlay shown at zone ${zone.index}: ${zone.x},${zone.y} ${zone.width}x${zone.height}`,
    );
  }

  /**
   * Hide the overlay.
   */
  hide(): void {
    if (this.actor) {
      this.actor.hide();
    }
    this.currentZone = null;
    console.log("[SLAB-DRAG] Overlay hidden");
  }

  /**
   * Get the current drop zone being highlighted.
   */
  getCurrentZone(): DropZone | null {
    return this.currentZone;
  }

  /**
   * Clean up the overlay completely.
   */
  destroy(): void {
    if (this.actor) {
      try {
        Main.layoutManager.uiGroup.remove_child(this.actor);
        this.actor.destroy();
      } catch (e) {
        console.error("[SLAB-DRAG] Error destroying overlay:", e);
      }
      this.actor = null;
    }
    this.currentZone = null;
  }
}

/**
 * Determine which drop zone the pointer is currently over.
 * Returns null if not over any valid zone.
 */
export function getDropZoneAtPosition(
  x: number,
  y: number,
  zones: DropZone[],
): DropZone | null {
  for (const zone of zones) {
    if (
      x >= zone.x &&
      x < zone.x + zone.width &&
      y >= zone.y &&
      y < zone.y + zone.height
    ) {
      return zone;
    }
  }
  return null;
}
