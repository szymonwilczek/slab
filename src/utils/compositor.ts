import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import St from 'gi://St';

// =============================================================================
// LATERS API HELPER (GNOME 45+ Compatibility)
// =============================================================================
/**
 * Schedule a callback to run before the next compositor redraw.
 * Handles API differences between GNOME versions.
 * 
 * GNOME 49+: Uses global.compositor.get_laters().add()
 * GNOME 45-48: Uses Meta.later_add()
 * Fallback: Execute directly if neither works
 */
export function scheduleBeforeRedraw(callback: () => void): void {
    // Try GNOME 49+ API first (global.compositor.get_laters())
    if (global.compositor && typeof global.compositor.get_laters === 'function') {
        try {
            const laters = global.compositor.get_laters();
            console.log('[SLAB] Using global.compositor.get_laters() API');
            laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
                callback();
                return false; // GLib.SOURCE_REMOVE equivalent
            });
            return;
        } catch (e) {
            console.error('[SLAB] global.compositor.get_laters() failed:', e);
        }
    }

    // Try Meta.later_add (GNOME 45-48)
    if (typeof Meta.later_add === 'function') {
        try {
            console.log('[SLAB] Using Meta.later_add() API');
            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
                callback();
                return false;
            });
            return;
        } catch (e) {
            console.error('[SLAB] Meta.later_add() failed:', e);
        }
    }

    // Fallback: Use GLib.idle_add
    console.warn('[SLAB] No laters API available, using GLib.idle_add fallback');
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        callback();
        return GLib.SOURCE_REMOVE;
    });
}

/**
 * Schedule a callback to run after N frames.
 * Uses recursive scheduleBeforeRedraw calls.
 * 
 * @param frames Number of frames to wait (1 = next frame, 2 = frame after next, etc.)
 * @param callback Function to execute
 */
export function scheduleAfterFrames(frames: number, callback: () => void): void {
    if (frames <= 0) {
        callback();
        return;
    }

    scheduleBeforeRedraw(() => {
        scheduleAfterFrames(frames - 1, callback);
    });
}

// =============================================================================
// ANIMATION SUSPENSION (Using GNOME Shell Internal API)
// =============================================================================
/**
 * Use St.Settings to properly inhibit animations.
 * This is GNOME Shell's internal mechanism - much more reliable than GSettings.
 */

let _animationInhibitCount = 0;

/**
 * Suspend ALL GNOME Shell animations using the internal API.
 * This is the proper way to do it - no race conditions, instant effect.
 */
export function suspendAnimations(): void {
    try {
        const settings = St.Settings.get();
        settings.inhibit_animations();
        _animationInhibitCount++;
        console.log('[SLAB] Animations inhibited (count:', _animationInhibitCount + ')');
    } catch (e) {
        console.log('[SLAB] Failed to inhibit animations:', e);
    }
}

/**
 * Resume GNOME Shell animations.
 */
export function resumeAnimations(): void {
    try {
        if (_animationInhibitCount > 0) {
            const settings = St.Settings.get();
            settings.uninhibit_animations();
            _animationInhibitCount--;
            console.log('[SLAB] Animations uninhibited (count:', _animationInhibitCount + ')');
        }
    } catch (e) {
        console.log('[SLAB] Failed to uninhibit animations:', e);
    }
}
