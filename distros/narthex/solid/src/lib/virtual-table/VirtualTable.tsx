import { For, Show, createMemo, createSignal, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import { rowOffsets, visibleRows } from "./virtual-table-model";
import "./virtual-table.css";

export type VirtualTableColumn = {
  id: string;
  label: string;
  /** Tooltip for the header, e.g. the column's type. */
  title?: string;
  /** CSS width of the column; the rest share what is left. */
  width?: string;
};

/** A read-only table over an in-memory list that renders only the rows in
 *  view. Each row's cells come from `renderRow`, which returns the row's
 *  `<td>` elements; rows may have any height, measured once drawn.
 *
 *  Used by the Locus's table layout and by the reference-data table on a
 *  type's page. `DataTable` stays the table for entity rows paged by
 *  `/api/query`: it owns its fetching and paging, which a value in memory
 *  does not need. */
export function VirtualTable(props: {
  label: string;
  columns: readonly VirtualTableColumn[];
  rowCount: number;
  /** Identity of a row, so a measured height follows the row when the rows
   *  are filtered or reordered. Defaults to the index. */
  rowKey?: (index: number) => unknown;
  renderRow: (index: number) => JSX.Element;
  /** Height assumed for a row not drawn yet, in pixels. */
  estimatedRowHeight?: number;
  /** Rows drawn beyond each edge of the viewport. */
  overscan?: number;
  /** CSS max-height of the scrolling area. */
  maxHeight?: string;
}) {
  let scroller: HTMLDivElement | undefined;
  let head: HTMLTableSectionElement | undefined;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);
  const [headHeight, setHeadHeight] = createSignal(0);
  // Measured heights are plain data; the version signal says they changed.
  const heights = new Map<unknown, number>();
  const [measured, setMeasured] = createSignal(0);
  const keyOf = (index: number) => props.rowKey ? props.rowKey(index) : index;
  const estimate = () => props.estimatedRowHeight ?? 40;

  const offsets = createMemo(() => {
    measured();
    const fallback = estimate();
    return rowOffsets(props.rowCount, (index) => heights.get(keyOf(index)) ?? fallback);
  });
  const rowWindow = createMemo(() => visibleRows(offsets(), {
    scrollTop: scrollTop() - headHeight(),
    // Before the first measurement, draw enough rows to fill a screen.
    viewportHeight: viewportHeight() || 800,
    overscan: props.overscan ?? 6,
  }));
  const indices = createMemo(() => {
    const { start, end } = rowWindow();
    const out: number[] = [];
    for (let index = start; index < end; index++) out.push(index);
    return out;
  });

  let rows: ResizeObserver | undefined;
  const observed = new Set<HTMLTableRowElement>();
  function measureRows(entries: ResizeObserverEntry[]) {
    let changed = false;
    for (const entry of entries) {
      const row = entry.target as HTMLTableRowElement;
      const index = Number(row.dataset.index);
      if (!Number.isInteger(index) || index >= props.rowCount) continue;
      const height = entry.borderBoxSize?.[0]?.blockSize ?? row.getBoundingClientRect().height;
      if (!(height > 0)) continue;
      const key = keyOf(index);
      if (Math.abs((heights.get(key) ?? -1) - height) > 0.5) { heights.set(key, height); changed = true; }
    }
    if (changed) setMeasured((version) => version + 1);
  }

  onSettled(() => {
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const view = new ResizeObserver(() => {
      setViewportHeight(scroller!.clientHeight);
      setHeadHeight(head?.getBoundingClientRect().height ?? 0);
    });
    view.observe(scroller);
    if (head) view.observe(head);
    rows = new ResizeObserver(measureRows);
    for (const row of observed) rows.observe(row);
    return () => { view.disconnect(); rows?.disconnect(); rows = undefined; observed.clear(); };
  });

  function Row(rowProps: { index: number }) {
    let element: HTMLTableRowElement | undefined;
    onSettled(() => {
      if (!element) return;
      const row = element;
      observed.add(row);
      rows?.observe(row);
      return () => { observed.delete(row); rows?.unobserve(row); };
    });
    return <tr ref={(el) => (element = el)} class="virtual-table__row" data-index={rowProps.index}
      aria-rowindex={rowProps.index + 2}>
      {props.renderRow(rowProps.index)}
    </tr>;
  }

  return <div class="virtual-table" role="region" aria-label={props.label} tabindex="0"
    ref={(el) => (scroller = el)}
    style={{ "max-height": props.maxHeight ?? "min(70vh, 48rem)" }}
    onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    <table class="virtual-table__table" aria-rowcount={props.rowCount + 1}>
      <colgroup>
        <For each={props.columns}>{(column) => <col style={column.width ? { width: column.width } : undefined} />}</For>
      </colgroup>
      <thead ref={(el) => (head = el)}>
        <tr>
          <For each={props.columns}>{(column) =>
            <th scope="col" data-tooltip={column.title}>{column.label}</th>}</For>
        </tr>
      </thead>
      <tbody>
        <Show when={rowWindow().padTop > 0}>
          <tr class="virtual-table__spacer" aria-hidden="true" style={{ height: `${rowWindow().padTop}px` }}>
            <td colspan={Math.max(props.columns.length, 1)} />
          </tr>
        </Show>
        <For each={indices()}>{(index) => <Row index={index} />}</For>
        <Show when={rowWindow().padBottom > 0}>
          <tr class="virtual-table__spacer" aria-hidden="true" style={{ height: `${rowWindow().padBottom}px` }}>
            <td colspan={Math.max(props.columns.length, 1)} />
          </tr>
        </Show>
      </tbody>
    </table>
  </div>;
}
