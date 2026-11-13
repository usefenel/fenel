import { For, Show, createSignal, createMemo, createEffect, Loading } from "solid-js";
import { formatRuntimeValue } from "~/lib/runtime-value-display";
import "./data-table.css";
import { booleanText } from "../boolean-text";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColumnDef<T = Record<string, unknown>> = {
  key: string;
  label: string;
  sortable?: boolean;
  /** Render callback. Receives an `onEdit` for cells where the column wants
   *  inline editing — call it with the new value to trigger
   *  DataTableProps.onCellEdit. Receives `undefined` when the table has no
   *  cell-edit handler wired. */
  render?: (
    value: unknown,
    row: T,
    onEdit: ((newValue: unknown) => void) | undefined,
  ) => any;
  class?: string;
  headerClass?: string;
  width?: string;
};

export type RowAction<T = Record<string, unknown>> = {
  label: string;
  icon?: string;
  variant?: "default" | "danger";
  action: (row: T) => void | Promise<void>;
  confirm?: string;
};

export type DataTableProps<T = Record<string, unknown>> = {
  entity: string;
  columns: ColumnDef<T>[];
  searchPlaceholder?: string;
  rowHref?: (row: T) => string;
  rowActions?: RowAction<T>[];
  onSelectionChange?: (ids: string[]) => void;
  /** Called when a column's render function invokes its `onEdit` callback.
   *  Should persist the change; the table re-fetches on success. */
  onCellEdit?: (row: T, field: string, newValue: unknown) => Promise<void> | void;
  emptyMessage?: string;
  pageSize?: number;
  defaultSort?: { field: string; dir: "asc" | "desc" };
  headerSlot?: any;
};

type SortState = { field: string; dir: "asc" | "desc" } | null;

type QueryResult = {
  rows: Record<string, unknown>[];
  total?: number;
  meta?: { entity: string; executionMs: number };
};

// ---------------------------------------------------------------------------
// API helper — direct fetch to query endpoint
// ---------------------------------------------------------------------------

const API_BASE = "/api";

async function queryEntity(params: {
  entity: string;
  search?: string;
  orderBy?: { field: string; dir: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
  includeTotal?: boolean;
}): Promise<QueryResult> {
  const res = await fetch(`${API_BASE}/query`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Query failed: ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// DataTable component
// ---------------------------------------------------------------------------

export function DataTable<T extends Record<string, unknown>>(props: DataTableProps<T>) {
  const pageSize = () => props.pageSize ?? 50;
  const [sort, setSort] = createSignal<SortState>(props.defaultSort ?? null);
  const [search, setSearch] = createSignal("");
  const [page, setPage] = createSignal(0);
  const [data, setData] = createSignal<QueryResult | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal<{ row: T; action: RowAction<T> } | null>(null);

  let searchTimer: ReturnType<typeof setTimeout>;

  function handleSearch(value: string) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      setSearch(value);
      setPage(0);
    }, 250);
  }

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const s = sort();
      const result = await queryEntity({
        entity: props.entity,
        search: search() || undefined,
        orderBy: s ? [{ field: s.field, dir: s.dir }] : undefined,
        limit: pageSize(),
        offset: page() * pageSize(),
        includeTotal: true,
      });
      setData(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  createEffect(
    () => [sort()?.field, sort()?.dir, search(), page(), props.entity],
    () => { void fetchData(); },
  );

  function toggleSort(field: string) {
    const current = sort();
    if (current?.field === field) {
      if (current.dir === "asc") setSort({ field, dir: "desc" });
      else setSort(null);
    } else {
      setSort({ field, dir: "asc" });
    }
    setPage(0);
  }

  const rows = createMemo(() => (data()?.rows ?? []) as T[]);
  const total = createMemo(() => data()?.total ?? 0);
  const totalPages = createMemo(() => Math.max(1, Math.ceil(total() / pageSize())));
  const allSelected = createMemo(() => rows().length > 0 && rows().every((r) => selected().has(r.id as string)));

  function toggleSelectAll() {
    const next = allSelected()
      ? new Set<string>()
      : new Set<string>(rows().map((r) => r.id as string));
    setSelected(next);
    props.onSelectionChange?.(Array.from(next));
  }

  function toggleSelect(id: string) {
    const next = new Set<string>(selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    props.onSelectionChange?.(Array.from(next));
  }

  async function executeAction(row: T, action: RowAction<T>) {
    if (action.confirm) {
      setConfirmDelete({ row, action });
      return;
    }
    await runAction(row, action);
  }

  async function runAction(row: T, action: RowAction<T>) {
    const id = row.id as string;
    setActionLoading(id);
    try {
      await action.action(row);
      await fetchData();
    } finally {
      setActionLoading(null);
      setConfirmDelete(null);
    }
  }

  async function editCell(row: T, field: string, newValue: unknown) {
    if (!props.onCellEdit) return;
    setError(null);
    try {
      await props.onCellEdit(row, field, newValue);
      await fetchData();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    }
  }

  function sortIndicator(field: string) {
    const s = sort();
    if (s?.field !== field) return "";
    return s.dir === "asc" ? " ↑" : " ↓";
  }

  return (
    <div class="dt">
      {/* Toolbar */}
      <div class="dt-toolbar">
        <div class="dt-toolbar-left">
          <input
            class="dt-search"
            type="text"
            placeholder={props.searchPlaceholder ?? "Search..."}
            onInput={(e) => handleSearch(e.currentTarget.value)}
          />
          <Show when={selected().size > 0}>
            <span class="dt-selection-count">{selected().size} selected</span>
          </Show>
        </div>
        <div class="dt-toolbar-right">
          {props.headerSlot}
          <Show when={total() > 0}>
            <span class="dt-total">{total()} total</span>
          </Show>
        </div>
      </div>

      {/* Error */}
      <Show when={error()}>
        <div class="dt-error">{error()}</div>
      </Show>

      {/* Confirm dialog */}
      <Show when={confirmDelete()}>
        {(cd) => (
          <div class="dt-confirm">
            <span>{cd().action.confirm}</span>
            <button class="btn btn-danger" onClick={() => runAction(cd().row, cd().action)}>
              Confirm
            </button>
            <button class="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
          </div>
        )}
      </Show>

      {/* Table */}
      <div class="table-wrap">
        <Show
          when={!loading() || rows().length > 0}
          fallback={<div class="dt-loading">Loading...</div>}
        >
          <Show when={rows().length > 0} fallback={<p class="dt-empty">{props.emptyMessage ?? "No data"}</p>}>
            <table class={loading() ? "dt-loading-overlay" : ""}>
              <thead>
                <tr>
                  <Show when={props.onSelectionChange || (props.rowActions && props.rowActions.length > 0)}>
                    <th class="dt-checkbox-col">
                      <input
                        type="checkbox"
                        checked={allSelected()}
                        onChange={toggleSelectAll}
                      />
                    </th>
                  </Show>
                  <For each={props.columns}>
                    {(col) => (
                      <th
                        class={`${col.headerClass ?? ""} ${col.sortable ? "dt-sortable" : ""}`}
                        style={col.width ? { width: col.width } : undefined}
                        onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                      >
                        {col.label}{col.sortable ? sortIndicator(col.key) : ""}
                      </th>
                    )}
                  </For>
                  <Show when={props.rowActions && props.rowActions.length > 0}>
                    <th class="dt-actions-col" />
                  </Show>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(row) => (
                    <tr class={selected().has(row.id as string) ? "dt-row-selected" : ""}>
                      <Show when={props.onSelectionChange || (props.rowActions && props.rowActions.length > 0)}>
                        <td class="dt-checkbox-col">
                          <input
                            type="checkbox"
                            checked={selected().has(row.id as string)}
                            onChange={() => toggleSelect(row.id as string)}
                          />
                        </td>
                      </Show>
                      <For each={props.columns}>
                        {(col) => (
                          <td class={col.class ?? ""}>
                            <Show
                              when={col.render}
                              fallback={
                                <Show
                                  when={props.rowHref && col === props.columns[0]}
                                  fallback={formatValue(row[col.key])}
                                >
                                  <a href={props.rowHref!(row)} class="link">
                                    {formatValue(row[col.key])}
                                  </a>
                                </Show>
                              }
                            >
                              {col.render!(
                                row[col.key],
                                row,
                                props.onCellEdit
                                  ? (newValue) => editCell(row, col.key, newValue)
                                  : undefined,
                              )}
                            </Show>
                          </td>
                        )}
                      </For>
                      <Show when={props.rowActions && props.rowActions.length > 0}>
                        <td class="dt-actions-col">
                          <div class="dt-row-actions">
                            <For each={props.rowActions}>
                              {(action) => (
                                <button
                                  class={`dt-action-btn ${action.variant === "danger" ? "dt-action-danger" : ""}`}
                                  onClick={(e) => { e.stopPropagation(); executeAction(row, action); }}
                                  disabled={actionLoading() === (row.id as string)}
                                  data-tooltip={action.label}
                                >
                                  {action.icon ?? action.label}
                                </button>
                              )}
                            </For>
                          </div>
                        </td>
                      </Show>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </Show>
      </div>

      {/* Pagination */}
      <Show when={totalPages() > 1}>
        <div class="dt-pagination">
          <button class="btn" disabled={page() === 0} onClick={() => setPage(page() - 1)}>
            Prev
          </button>
          <span class="dt-page-info">
            Page {page() + 1} of {totalPages()}
          </span>
          <button class="btn" disabled={page() >= totalPages() - 1} onClick={() => setPage(page() + 1)}>
            Next
          </button>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatValue(v: unknown): string {
  if (v == null) return "-";
  if (v instanceof Date) return v.toLocaleDateString();
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    return new Date(v).toLocaleDateString();
  }
  if (typeof v === "boolean") return booleanText(v)!;
  if (typeof v === "object" || typeof v === "number") return formatRuntimeValue(v);
  return String(v);
}
