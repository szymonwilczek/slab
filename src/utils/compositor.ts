import Meta from "gi://Meta";
import GLib from "gi://GLib";
import St from "gi://St";

export function scheduleBeforeRedraw(callback: () => void): void {
  if (global.compositor && typeof global.compositor.get_laters === "function") {
    try {
      const laters = global.compositor.get_laters();
      console.log("[SLAB] Using global.compositor.get_laters() API");
      laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
        callback();
        return false;
      });
      return;
    } catch (e) {
      console.error("[SLAB] global.compositor.get_laters() failed:", e);
    }
  }

  if (typeof Meta.later_add === "function") {
    try {
      console.log("[SLAB] Using Meta.later_add() API");
      Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
        callback();
        return false;
      });
      return;
    } catch (e) {
      console.error("[SLAB] Meta.later_add() failed:", e);
    }
  }

  // fallback
  console.warn("[SLAB] No laters API available, using GLib.idle_add fallback");
  GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    callback();
    return GLib.SOURCE_REMOVE;
  });
}

export function scheduleAfterFrames(
  frames: number,
  callback: () => void,
): void {
  if (frames <= 0) {
    callback();
    return;
  }

  scheduleBeforeRedraw(() => {
    scheduleAfterFrames(frames - 1, callback);
  });
}

let _animationInhibitCount = 0;

export function suspendAnimations(): void {
  try {
    const settings = St.Settings.get();
    settings.inhibit_animations();
    _animationInhibitCount++;
    console.log(
      "[SLAB] Animations inhibited (count:",
      _animationInhibitCount + ")",
    );
  } catch (e) {
    console.log("[SLAB] Failed to inhibit animations:", e);
  }
}

export function resumeAnimations(): void {
  try {
    if (_animationInhibitCount > 0) {
      const settings = St.Settings.get();
      settings.uninhibit_animations();
      _animationInhibitCount--;
      console.log(
        "[SLAB] Animations uninhibited (count:",
        _animationInhibitCount + ")",
      );
    }
  } catch (e) {
    console.log("[SLAB] Failed to uninhibit animations:", e);
  }
}
