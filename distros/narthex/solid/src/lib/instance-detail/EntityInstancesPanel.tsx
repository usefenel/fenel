// ---------------------------------------------------------------------------
// EntityInstancesPanel — compact list of recent instances of a Type.
//
// Used by the home edit modal's Type inspector (when the pinned literal is
// `{$pin: "entity"|"type", …}`) so browsing a Type's definition surfaces
// its actual stored values in the same view. Same role as
// `InstanceDetail` does for function runs, just for stored data.
//
// Intentionally minimal: id + a primary-field summary + createdAt, click
// to open the legacy `/app/types/:name/:id` detail page. Once the home
// modal grows in-place instance inspection (the equivalent of the
// trace-overlay for entities), the row's `onClick` should call into that
// instead of navigating.
// ---------------------------------------------------------------------------

import { For, Show, createMemo, createSignal } from "solid-js";

import { defaultApiClient, useApiClient } from "~/lib/api";
import type { FenelType, FieldDef } from "@fenel/engine";
import { ValueDisplay } from "~/lib/storybook";

type EntityInstanceRow = {
  id: string;
  data: Record<string, unknown>;
  createdAt?: string;
};

export function EntityInstancesPanel(props: {
  /** Type name as it appears on `entity_instances.entity_type` — same key
   *  the legacy `/app/types/:name` route uses. */
  name: string;
  /** The Type's FenelType, if known. Used to pick a primary-display field
   *  for the row summary (first non-id String/Number/Date field by
   *  declaration order). Falls back to "the first non-empty field" when
   *  no schema is available. */
  type?: FenelType | null;
  /** Max rows to render. The full list lives on the detail page. */
  limit?: number;
}) {
  const client = useApiClient();
  const [showAll, setShowAll] = createSignal(false);
  // A client without this endpoint (a Local tab's refusing client) throws
  // synchronously; inside the promise chain that becomes "no rows", never an
  // error that replaces the whole dialog.
  const resp = createMemo(() => Promise.resolve().then(() => client.getEntityInstances(props.name)).catch(() => null));
  const instances = createMemo<EntityInstanceRow[]>(() => {
    const list = (resp() as { instances?: unknown[] } | null)?.instances;
    return Array.isArray(list) ? (list as EntityInstanceRow[]) : [];
  });

  const fields = createMemo<FieldDef[]>(() => {
    const t = props.type;
    if (!t || typeof t !== "object" || !("$record" in t)) return [];
    const rec = (t as { $record?: { fields?: FieldDef[] } }).$record;
    return rec?.fields ?? [];
  });

  /** Field name whose value best summarises a row in one cell. Heuristic:
   *  the first scalar-typed declared field. Beats showing nothing for
   *  Types that don't have a `label` / `name` field by convention. */
  const summaryFieldName = createMemo<string | null>(() => {
    for (const f of fields()) {
      const t = f.type as { $ref?: string } | undefined;
      if (t && typeof t === "object" && "$ref" in t) {
        const named = t.$ref;
        if (named === "String" || named === "Number" || named === "Int" || named === "Date") {
          return f.name;
        }
      }
    }
    return fields()[0]?.name ?? null;
  });

  function summary(row: EntityInstanceRow): string {
    const key = summaryFieldName();
    if (key && row.data && key in row.data) {
      const v = row.data[key];
      if (typeof v === "string") return v;
      if (typeof v === "number" || typeof v === "boolean") return String(v);
    }
    // Fall back to the first non-empty string value in the row.
    if (row.data && typeof row.data === "object") {
      for (const v of Object.values(row.data)) {
        if (typeof v === "string" && v.length > 0) return v;
      }
    }
    return "(no preview)";
  }

  const visible = createMemo(() => showAll() ? instances() : instances().slice(0, props.limit ?? 20));

  return (
    <div class="entity-instances-panel">
      {/* An empty list says nothing: no empty-state claim about the data. */}
      <Show when={instances().length > 0}>
        <div class="entity-instances-panel__rows">
          <For each={visible()}>
            {(row) => (
              <Show when={client !== defaultApiClient} fallback={
              <a
                href={`/app/types/${encodeURIComponent("entity:" + props.name)}/${row.id}`}
                class="entity-instances-panel__row"
              >
                <span class="entity-instances-panel__id mono">{row.id.slice(0, 8)}</span>
                <span class="entity-instances-panel__summary">{summary(row)}</span>
                <Show when={row.createdAt}>
                  <span class="entity-instances-panel__ts mono">
                    {new Date(row.createdAt!).toLocaleString()}
                  </span>
                </Show>
              </a>
              }>
                <details>
                  <summary class="entity-instances-panel__row">
                    <span class="entity-instances-panel__id mono">{row.id.slice(0, 8)}</span>
                    <span class="entity-instances-panel__summary">{summary(row)}</span>
                    <Show when={row.createdAt}>
                      <span class="entity-instances-panel__ts mono">{new Date(row.createdAt!).toLocaleString()}</span>
                    </Show>
                  </summary>
                  <div style="padding: 0.65rem"><ValueDisplay value={row.data} typeName={props.name} /></div>
                </details>
              </Show>
            )}
          </For>
        </div>
        <Show when={instances().length > visible().length}>
          <div class="text-muted" style="font-size: 0.72rem; margin-top: 0.3rem">
            Showing {visible().length} of {instances().length}.
            {" "}
            <Show when={client !== defaultApiClient} fallback={<a
              href={`/app/types/${encodeURIComponent("entity:" + props.name)}`}
              class="text-muted"
            >
              See all →
            </a>}><button type="button" class="reps-panel__btn" onClick={() => setShowAll(true)}>Show all</button></Show>
          </div>
        </Show>
      </Show>
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.entity-instances-panel__rows {
  display: flex;
  flex-direction: column;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fafafa;
  overflow: hidden;
}

.entity-instances-panel__row {
  display: grid;
  grid-template-columns: 7rem 1fr auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid #e2e8f0;
  font-size: 0.78rem;
  text-decoration: none;
  color: #1a1a2e;
  cursor: pointer;
  background: #ffffff;
}

.entity-instances-panel__row:last-child {
  border-bottom: none;
}

.entity-instances-panel__row:hover {
  background: #f1f5f9;
}

.entity-instances-panel__id {
  color: #64748b;
  font-size: 0.72rem;
}

.entity-instances-panel__summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entity-instances-panel__ts {
  color: #94a3b8;
  font-size: 0.7rem;
}
`;
