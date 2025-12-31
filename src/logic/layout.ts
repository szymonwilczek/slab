import Meta from 'gi://Meta';

// =============================================================================
// MASTER-STACK LAYOUT (O(1) Complexity)
// =============================================================================
/**
 * Calculate Master-Stack layout for N windows.
 * 
 * Layout:
 * +--------+--------+
 * |        | Stack1 |
 * | Master +--------+
 * |        | Stack2 |
 * +--------+--------+
 * 
 * COMPLEXITY: O(1) per window
 * - Master: full height, ratio * width
 * - Stack: evenly divided (height/n), (1-ratio) * width
 * 
 * No tree traversal, no recursion. Just arithmetic.
 * 
 * @param windows - Array of windows to tile
 * @param workArea - Available work area (excluding panels)
 * @param masterRatio - Ratio of width for master (0.2 - 0.8)
 * @param gap - Gap between windows in pixels
 */
export function calculateMasterStackLayout(
    windows: Meta.Window[],
    workArea: Meta.Rectangle,
    masterRatio: number,
    gap: number
): Array<{ window: Meta.Window; x: number; y: number; w: number; h: number }> {
    const n = windows.length;
    if (n === 0) return [];

    const result: Array<{ window: Meta.Window; x: number; y: number; w: number; h: number }> = [];

    // Single window: full work area minus gaps
    if (n === 1) {
        result.push({
            window: windows[0],
            x: workArea.x + gap,
            y: workArea.y + gap,
            w: workArea.width - gap * 2,
            h: workArea.height - gap * 2,
        });
        return result;
    }

    // Multiple windows: Master-Stack layout
    const masterWidth = Math.floor((workArea.width - gap * 3) * masterRatio);
    const stackWidth = workArea.width - gap * 3 - masterWidth;
    const stackCount = n - 1;
    const stackHeight = Math.floor((workArea.height - gap * (stackCount + 1)) / stackCount);

    // Master window (first in list)
    result.push({
        window: windows[0],
        x: workArea.x + gap,
        y: workArea.y + gap,
        w: masterWidth,
        h: workArea.height - gap * 2,
    });

    // Stack windows (rest of list)
    for (let i = 1; i < n; i++) {
        const stackIndex = i - 1;
        result.push({
            window: windows[i],
            x: workArea.x + gap * 2 + masterWidth,
            y: workArea.y + gap + stackIndex * (stackHeight + gap),
            w: stackWidth,
            h: stackHeight,
        });
    }

    return result;
}
