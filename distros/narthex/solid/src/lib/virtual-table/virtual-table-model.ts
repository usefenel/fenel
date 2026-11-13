// ---------------------------------------------------------------------------
// virtual-table-model — which rows of a long table are on screen.
//
// A table over a list value must stay usable with thousands of rows, so it
// renders only the rows that intersect the scroll viewport (plus a few either
// side) and stands in for the rest with two spacers of the right height. Rows
// may differ in height (a cell shows its value through that value's own view),
// so the arithmetic works on measured heights, with an estimate for rows that
// have not been drawn yet.
//
// Pure: no DOM, no Solid. `VirtualTable.tsx` is the host glue.
// ---------------------------------------------------------------------------

/** `offsets[i]` is the top of row `i`; `offsets[count]` is the total height.
 *  A height that is not a positive finite number counts as zero. */
export function rowOffsets(count: number, heightOf: (index: number) => number): Float64Array {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const offsets = new Float64Array(n + 1);
  for (let index = 0; index < n; index++) {
    const height = heightOf(index);
    offsets[index + 1] = offsets[index]! + (Number.isFinite(height) && height > 0 ? height : 0);
  }
  return offsets;
}

export type RowWindow = {
  /** First rendered row. */
  start: number;
  /** One past the last rendered row. */
  end: number;
  /** Height of the spacer standing in for the rows before `start`. */
  padTop: number;
  /** Height of the spacer standing in for the rows from `end` on. */
  padBottom: number;
  total: number;
};

/** Smallest `k` in `[0, offsets.length)` with `offsets[k] > x`, or `offsets.length`. */
function firstAbove(offsets: Float64Array, x: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid]! > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Smallest `k` in `[0, offsets.length)` with `offsets[k] >= x`, or `offsets.length`. */
function firstAtOrAbove(offsets: Float64Array, x: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid]! >= x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The rows to render for a viewport `[scrollTop, scrollTop + viewportHeight)`
 *  measured from the top of the first row. `overscan` extra rows are rendered
 *  on each side so a small scroll never shows a blank strip. A non-empty table
 *  always renders at least one row. */
export function visibleRows(offsets: Float64Array, viewport: {
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}): RowWindow {
  const count = offsets.length - 1;
  const total = count > 0 ? offsets[count]! : 0;
  if (count <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0, total: 0 };
  const overscan = Number.isFinite(viewport.overscan) && viewport.overscan! > 0 ? Math.floor(viewport.overscan!) : 0;
  const top = Number.isFinite(viewport.scrollTop) ? Math.min(Math.max(viewport.scrollTop, 0), total) : 0;
  const height = Number.isFinite(viewport.viewportHeight) && viewport.viewportHeight > 0 ? viewport.viewportHeight : 0;
  // The row containing `top` is the last one whose top edge is at or above it.
  const first = Math.min(Math.max(firstAbove(offsets, top) - 1, 0), count - 1);
  // Rows whose top edge is above the viewport's bottom edge are visible.
  const last = Math.min(Math.max(firstAtOrAbove(offsets, top + height), first + 1), count);
  const start = Math.max(first - overscan, 0);
  const end = Math.min(last + overscan, count);
  return { start, end, padTop: offsets[start]!, padBottom: total - offsets[end]!, total };
}
