// =============================================================================
// MASTER-STACK LAYOUT WITH DYNAMIC SIZING AND OVERFLOW HANDLING
// =============================================================================

const MIN_WINDOW_WIDTH = 500; // firefox needs ~450-500px
const MIN_WINDOW_HEIGHT = 350;
const MIN_MASTER_WIDTH = 500;

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

  // Single window: full work area minus gaps
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

  // Try different master widths until we find one that works
  let masterWidth = Math.floor((workArea.width - gap * 3) * masterRatio);
  let stackWidth = workArea.width - gap * 3 - masterWidth;

  // Calculate layout metrics
  let maxColumnsPerRow = Math.max(
    1,
    Math.floor((stackWidth + gap) / (MIN_WINDOW_WIDTH + gap)),
  );
  let numRows = Math.ceil(stackCount / maxColumnsPerRow);
  let rowHeight = Math.floor((workArea.height - gap * (numRows + 1)) / numRows);
  let colWidth = Math.floor(
    (stackWidth - gap * (maxColumnsPerRow - 1)) / maxColumnsPerRow,
  );

  console.log(
    `[SLAB-LAYOUT] Initial: master=${masterWidth}, stack=${stackWidth}, cols=${maxColumnsPerRow}, rows=${numRows}, rowH=${rowHeight}, colW=${colWidth}`,
  );

  // Reduce master width if we need more space (rowHeight OR colWidth below minimum)
  let iterations = 0;
  while (
    (rowHeight < MIN_WINDOW_HEIGHT || colWidth < MIN_WINDOW_WIDTH) &&
    masterWidth > MIN_MASTER_WIDTH &&
    iterations < 20
  ) {
    masterWidth = Math.max(MIN_MASTER_WIDTH, masterWidth - 50);
    stackWidth = workArea.width - gap * 3 - masterWidth;
    maxColumnsPerRow = Math.max(
      1,
      Math.floor((stackWidth + gap) / (MIN_WINDOW_WIDTH + gap)),
    );
    numRows = Math.ceil(stackCount / maxColumnsPerRow);
    rowHeight = Math.floor((workArea.height - gap * (numRows + 1)) / numRows);
    colWidth = Math.floor(
      (stackWidth - gap * (maxColumnsPerRow - 1)) / maxColumnsPerRow,
    );
    iterations++;

    console.log(
      `[SLAB-LAYOUT] Reduced[${iterations}]: master=${masterWidth}, stack=${stackWidth}, cols=${maxColumnsPerRow}, rows=${numRows}, rowH=${rowHeight}, colW=${colWidth}`,
    );
  }

  // Calculate max capacity with current constraints
  const maxRows = Math.floor(
    (workArea.height - gap + gap) / (MIN_WINDOW_HEIGHT + gap),
  );
  const maxStackWindows = maxRows * maxColumnsPerRow;

  console.log(
    `[SLAB-LAYOUT] Capacity: maxRows=${maxRows}, maxCols=${maxColumnsPerRow}, maxStack=${maxStackWindows}, actualStack=${stackCount}`,
  );

  // Determine which windows we can tile - skip oldest (from end of array)
  let tileableStackWindows: Meta.Window[];
  let skippedWindows: Meta.Window[] = [];

  if (stackCount > maxStackWindows) {
    tileableStackWindows = stackWindows.slice(0, maxStackWindows);
    skippedWindows = stackWindows.slice(maxStackWindows);
    console.log(
      `[SLAB-LAYOUT] Skipping ${skippedWindows.length} oldest windows`,
    );
  } else {
    tileableStackWindows = stackWindows;
  }

  const tileableStackCount = tileableStackWindows.length;
  const stackX = workArea.x + gap * 2 + masterWidth;

  // Master window
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

  // Recalculate for actual tileable count
  numRows = Math.ceil(tileableStackCount / maxColumnsPerRow);
  rowHeight = Math.floor((workArea.height - gap * (numRows + 1)) / numRows);

  // Distribute windows across rows
  const windowsPerRow: number[] = [];
  let remaining = tileableStackCount;

  for (let row = 0; row < numRows; row++) {
    const rowsLeft = numRows - row;
    const windowsInThisRow = Math.ceil(remaining / rowsLeft);
    windowsPerRow.push(windowsInThisRow);
    remaining -= windowsInThisRow;
  }

  console.log(
    `[SLAB-LAYOUT] Final: ${tileableStackCount} windows, ${numRows} rows [${windowsPerRow.join(",")}], rowH=${rowHeight}`,
  );

  let windowIndex = 0;

  for (let row = 0; row < numRows; row++) {
    const windowsInRow = windowsPerRow[row];
    const rowY = workArea.y + gap + row * (rowHeight + gap);

    // Calculate column width for this row
    const totalGapsHorizontal = (windowsInRow - 1) * gap;
    const availableRowWidth = stackWidth - totalGapsHorizontal;
    const actualColWidth = Math.floor(availableRowWidth / windowsInRow);

    for (let col = 0; col < windowsInRow; col++) {
      if (windowIndex >= tileableStackCount) break;

      const window = tileableStackWindows[windowIndex];
      const isLastInRow = col === windowsInRow - 1;
      const windowX = stackX + col * (actualColWidth + gap);
      const windowW = isLastInRow
        ? stackX + stackWidth - windowX
        : actualColWidth;

      result.push({
        window,
        x: windowX,
        y: rowY,
        w: windowW,
        h: rowHeight,
      });

      windowIndex++;
    }
  }

  return { entries: result, skippedWindows };
}
