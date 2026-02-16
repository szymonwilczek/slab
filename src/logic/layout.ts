const MIN_WINDOW_HEIGHT = 350;

interface LayoutEntry {
  window: Meta.Window;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutResult {
  entries: LayoutEntry[];
  skippedWindows: Meta.Window[];
}

/**
 * Calculate Master-Stack layout with dynamic sizing.
 *
 * Algorithm:
 * 1. Start with default master ratio
 * 2. Calculate rows/columns needed
 * 3. If row height OR column width < minimum, reduce master to fit more space
 * 4. If still can't fit at MIN_MASTER_WIDTH, skip excess windows (oldest first)
 *
 * Returns both layout entries and skipped windows.
 * Skipped windows are from the END of the stack (oldest windows).
 */
export function calculateMasterStackLayout(
  windows: Meta.Window[],
  workArea: Meta.Rectangle,
  masterRatio: number,
  gap: number,
): LayoutResult {
  const n = windows.length;
  if (n === 0) return { entries: [], skippedWindows: [] };

  const result: LayoutEntry[] = [];

  // single window: full work area minus gaps
  if (n === 1) {
    result.push({
      window: windows[0],
      x: workArea.x + gap,
      y: workArea.y + gap,
      w: workArea.width - gap * 2,
      h: workArea.height - gap * 2,
    });
    return { entries: result, skippedWindows: [] };
  }

  const stackWindows = windows.slice(1);
  const stackCount = stackWindows.length;

  const masterWidth = Math.floor((workArea.width - gap * 3) * masterRatio);
  const stackWidth = workArea.width - gap * 3 - masterWidth;
  const stackX = workArea.x + gap * 2 + masterWidth;

  const maxRows = Math.floor(
    (workArea.height - gap) / (MIN_WINDOW_HEIGHT + gap),
  );

  console.log(
    `[SLAB-LAYOUT] Strict 2-col: master=${masterWidth}, stack=${stackWidth}, maxRows=${maxRows}, stackCount=${stackCount}`,
  );

  let tileableStackWindows: Meta.Window[];
  let skippedWindows: Meta.Window[] = [];

  if (stackCount > maxRows) {
    // too many windows -> keep first N, skip the rest (oldest/bottom of stack)
    tileableStackWindows = stackWindows.slice(0, maxRows);
    skippedWindows = stackWindows.slice(maxRows);
    console.log(
      `[SLAB-LAYOUT] Overflow! Keeping ${tileableStackWindows.length}, skipping ${skippedWindows.length} oldest windows`,
    );
  } else {
    tileableStackWindows = stackWindows;
  }

  const tileableStackCount = tileableStackWindows.length;

  // master window
  result.push({
    window: windows[0],
    x: workArea.x + gap,
    y: workArea.y + gap,
    w: masterWidth,
    h: workArea.height - gap * 2,
  });

  if (tileableStackCount === 0) {
    return { entries: result, skippedWindows };
  }

  const numRows = tileableStackCount;
  const rowHeight = Math.floor(
    (workArea.height - gap * (numRows + 1)) / numRows,
  );

  console.log(
    `[SLAB-LAYOUT] Final Stack: ${tileableStackCount} windows, rowH=${rowHeight}`,
  );

  for (let i = 0; i < tileableStackCount; i++) {
    const window = tileableStackWindows[i];
    const rowY = workArea.y + gap + i * (rowHeight + gap);

    // last item takes remaining height to be pixel-perfect
    const actualHeight =
      i === tileableStackCount - 1
        ? workArea.y + workArea.height - gap - rowY
        : rowHeight;

    result.push({
      window,
      x: stackX,
      y: rowY,
      w: stackWidth,
      h: actualHeight,
    });
  }

  return { entries: result, skippedWindows };
}
