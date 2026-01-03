/**
 * SLAB - High-Performance Actor-First Tiling Extension for GNOME Shell 45+
 * 
 * ARCHITECTURE OVERVIEW:
 * ----------------------
 * This extension implements "Tiling-on-Demand" with an Actor-First Optimistic UI.
 * 
 * Traditional tiling (Pop Shell, Forge) is REACTIVE:
 *   User action → Protocol negotiation (slow) → Visual update
 * 
 * SLAB is OPTIMISTIC:
 *   User action → Actor manipulation (instant) → Protocol sync (lazy)
 * 
 * ZERO OVERHEAD PRINCIPLE:
 * When tiling is disabled, this extension consumes 0 CPU cycles.
 * We don't track window moves in real-time. We only snapshot state
 * at the exact moment the user enables tiling.
 * 
 * MEMORY STRATEGY:
 * All geometry objects are pre-allocated at init and reused.
 * NO allocations in hot paths = NO GC pauses during tiling operations.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import { SlabState } from './types/index.js';
import { scheduleBeforeRedraw } from './utils/compositor.js';
import { toggleSlab, applyMasterStackToWorkspace } from './managers/tiling.js';

// =============================================================================
// EXTENSION LIFECYCLE
// =============================================================================
export default class SlabExtension extends Extension {
    private _state: SlabState | null = null;

    enable(): void {
        console.log('[SLAB] Extension enable() called');

        // Initialize state
        this._state = {
            tilingEnabled: false,
            floatingSnapshot: new Map(),
            settings: this.getSettings(),
            signalIds: [],
            blockedSignals: new Map(),
            pendingLaterId: null,
            currentMonitor: 0,
            currentMasterWindowId: null,
            windowSignals: new Map(),
        };

        console.log('[SLAB] Settings loaded:', this._state.settings);

        // Register keybinding
        try {
            Main.wm.addKeybinding(
                'toggle-tiling',
                this._state.settings!,
                0, // Meta.KeyBindingFlags.NONE
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => {
                    console.log('[SLAB] Keybinding triggered!');
                    if (this._state) {
                        toggleSlab(this._state);
                    }
                }
            );
            console.log('[SLAB] Keybinding registered successfully');
        } catch (e) {
            console.error('[SLAB] Failed to register keybinding:', e);
        }

        // Listen for new windows to maintain layout
        const display = global.display;
        const sigId = display.connect('window-created', (_display: Meta.Display, window: Meta.Window) => {
            console.log('[SLAB] window-created fired for:', window.title);
            console.log('[SLAB] Has actor?', !!window.get_compositor_private());
            console.log('[SLAB] Monitor:', window.get_monitor(), 'Current Monitor:', this._state?.currentMonitor);

            if (this._state?.tilingEnabled) {
                // Schedule layout update synchronized with compositor
                scheduleBeforeRedraw(() => {
                    console.log('[SLAB] window-created BEFORE_REDRAW exec for:', window.title);
                    console.log('[SLAB] Has actor now?', !!window.get_compositor_private());
                    if (this._state?.tilingEnabled) {
                        applyMasterStackToWorkspace(this._state, false, window);
                    }
                });
            }
        });
        this._state.signalIds.push(sigId);

        console.log('[SLAB] Extension enabled successfully');
    }

    disable(): void {
        console.log('[SLAB] Extension disable() called');

        if (this._state) {
            // Restore all windows if tiling is active
            if (this._state.tilingEnabled) {
                // Force toggle off to restore windows
                toggleSlab(this._state);
            }

            // Disconnect generic signals
            const display = global.display;
            for (const id of this._state.signalIds) {
                display.disconnect(id);
            }

            // Unbind keybinding
            Main.wm.removeKeybinding('toggle-tiling');

            // Clear state
            this._state = null;
        }

        console.log('[SLAB] Extension disabled');
    }
}
