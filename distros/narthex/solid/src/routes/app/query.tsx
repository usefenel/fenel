import { For, Show, createSignal, createMemo, createEffect, flush, refresh } from "solid-js";
import { revalidate } from "@solidjs/router";
import { SetExprEditor } from "~/lib/expression-builder/SetExprEditor";
import type { SetExpr, FenelType } from "@fenel/engine/types";
import { inferShape, validCharts, recommendChart, deriveInsights, deriveFunnelInsights, valueDomain } from "@fenel/engine";
import type { ChartKind, ResultShape, Insight } from "@fenel/engine";
import { getQuerySchema, getSavedQueries, api } from "~/lib/api";
import { formatRuntimeValue } from "~/lib/runtime-value-display";
import { sessionEpoch } from "~/lib/browser-session";
import { confirmDialog } from "~/lib/confirm-modal";
import { LocusSelect } from "~/lib/locus-select";
import {
  FunnelChart,
  renderChart,
  CHART_ICONS,
  type FunnelData,
} from "~/lib/charts";

type QueryResult = {
  rows: Record<string, unknown>[];
  total?: number;
  meta?: { entity?: string };
};

type SchemaField = { name: string; type: FenelType };
type SchemaInfo = Record<string, { fields: SchemaField[]; relations?: Record<string, string[]> }>;

async function fetchSchema(): Promise<SchemaInfo> {
  const data = await getQuerySchema();
  return data.entities ?? {};
}

async function runQuery(body: Record<string, unknown>): Promise<QueryResult> {
  return api.runRecordQuery(body);
}

type FilterEntry = { field: string; expr: SetExpr | undefined };

type SavedQuery = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  query: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type QueryCategory = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  queryIds: string[];
};

// ---------------------------------------------------------------------------
// InsightsPanel — display derived recommendations from query results
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<string, { bg: string; border: string; icon: string }> = {
  info:     { bg: "#eff6ff", border: "#bfdbfe", icon: "ℹ" },
  warning:  { bg: "#fffbeb", border: "#fde68a", icon: "⚠" },
  critical: { bg: "#fef2f2", border: "#fecaca", icon: "🔴" },
};

function InsightsPanel(props: { insights: Insight[] }) {
  return (
    <Show when={props.insights.length > 0}>
      <div class="card" style="padding: 0.75rem; margin-bottom: 1rem">
        <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.5rem">Insights</div>
        <For each={props.insights}>
          {(insight) => {
            const s = SEVERITY_STYLES[insight.severity] ?? SEVERITY_STYLES.info!;
            return (
              <div style={`padding: 0.5rem 0.75rem; margin-bottom: 0.4rem; border-radius: 6px; border: 1px solid ${s.border}; background: ${s.bg}; font-size: 0.8rem`}>
                <div style="font-weight: 600">{s.icon} {insight.title}</div>
                <div style="color: #555; margin-top: 0.15rem">{insight.detail}</div>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

export default function QueryExplorer() {
  const [schemaError, setSchemaError] = createSignal<string>();
  const [savedError, setSavedError] = createSignal<string>();
  const schema = createMemo(() => {
    const epoch = sessionEpoch();
    return fetchSchema().then((value) => { if (epoch === sessionEpoch()) setSchemaError(undefined); return value; }).catch((reason) => { if (epoch === sessionEpoch()) setSchemaError(String(reason)); return undefined; });
  });
  const [filterCategory, setFilterCategory] = createSignal<string | undefined>(undefined);
  const [searchText, setSearchText] = createSignal<string | undefined>(undefined);
  const savedData = createMemo(() => {
    const epoch = sessionEpoch();
    return getSavedQueries(filterCategory(), searchText()).then((value) => { if (epoch === sessionEpoch()) setSavedError(undefined); return value; }).catch((reason) => { if (epoch === sessionEpoch()) setSavedError(String(reason)); return undefined; });
  });

  const [entity, setEntity] = createSignal("profile");
  const [limit, setLimit] = createSignal(25);
  const [filters, setFilters] = createSignal<FilterEntry[]>([]);
  const [result, setResult] = createSignal<QueryResult | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [showJson, setShowJson] = createSignal(false);
  const [activeQueryId, setActiveQueryId] = createSignal<string | null>(null);
  const [activeQueryObj, setActiveQueryObj] = createSignal<SavedQuery | null>(null);
  const [queryMode, setQueryMode] = createSignal<"builder" | "preset">("preset");
  const [funnelData, setFunnelData] = createSignal<FunnelData | null>(null);
  const [chartKind, setChartKind] = createSignal<ChartKind | null>(null);

  const [showSaveDialog, setShowSaveDialog] = createSignal(false);
  const [saveName, setSaveName] = createSignal("");
  const [saveSlug, setSaveSlug] = createSignal("");
  const [saveDesc, setSaveDesc] = createSignal("");
  const [saveCategoryId, setSaveCategoryId] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const [showRefPicker, setShowRefPicker] = createSignal(false);
  let executionEpoch = 0;
  let accountEpoch = sessionEpoch();

  createEffect(
    () => sessionEpoch(),
    (next) => {
      if (next === accountEpoch) return;
      accountEpoch = next;
      executionEpoch++;
    setResult(null); setFunnelData(null); setActiveQueryId(null); setActiveQueryObj(null); setFilters([]); setLoading(false); setError(null); setShowSaveDialog(false); setSaving(false); setSaveError(null);
  });

  const queries = createMemo(() => (savedData()?.queries ?? []) as SavedQuery[]);
  const categories = createMemo(() => (savedData()?.categories ?? []) as QueryCategory[]);
  const rootCategories = createMemo(() => categories().filter((c) => !c.parentId));
  const childCategories = createMemo(() => {
    const fc = filterCategory();
    if (!fc) return [];
    const parent = categories().find((c) => c.slug === fc);
    if (!parent) return [];
    return categories().filter((c) => c.parentId === parent.id);
  });

  async function reloadQueries() {
    revalidate("savedQueries");
    await getSavedQueries(filterCategory(), searchText());
    await refresh(savedData);
  }

  const entityFields = createMemo(() => {
    const s = schema();
    if (!s) return [] as SchemaField[];
    return s[entity()]?.fields ?? [];
  });

  const fieldTypeMap = createMemo(() => {
    const map = new Map<string, FenelType>();
    for (const f of entityFields()) map.set(f.name, f.type);
    return map;
  });

  const entityRelations = createMemo(() => {
    const s = schema();
    if (!s) return {} as Record<string, string[]>;
    return s[entity()]?.relations ?? {};
  });

  const entityNames = createMemo(() => {
    const s = schema();
    if (!s) return [];
    return Object.keys(s);
  });

  createEffect(
    () => entity(),
    () => {
      executionEpoch++;
      setFilters([]);
      setResult(null);
      setLoading(false);
      setError(null);
    },
  );

  function addFilter() {
    const fields = entityFields();
    if (fields.length === 0) return;
    setFilters((prev) => [...prev, { field: fields[0]!.name, expr: undefined }]);
  }

  function removeFilter(idx: number) {
    setFilters((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateFilterField(idx: number, field: string) {
    setFilters((prev) => prev.map((f, i) => (i === idx ? { ...f, field } : f)));
  }

  function updateFilterExpr(idx: number, expr: SetExpr | undefined) {
    setFilters((prev) => prev.map((f, i) => (i === idx ? { ...f, expr } : f)));
  }

  function buildQuery(): Record<string, unknown> {
    const q: Record<string, unknown> = {
      entity: entity(),
      limit: limit(),
      includeTotal: true,
    };
    const activeFilters = filters().filter((f) => f.expr !== undefined);
    if (activeFilters.length > 0) {
      const filter: Record<string, SetExpr> = {};
      for (const f of activeFilters) filter[f.field] = f.expr!;
      q.filter = filter;
    }
    return q;
  }

  async function executeQuery() {
    const run = ++executionEpoch;
    setActiveQueryId(null); setActiveQueryObj(null); setChartKind(null); setFunnelData(null); setResult(null);
    setLoading(true);
    setError(null);
    try {
      const q = buildQuery();
      const r = await runQuery(q);
      if (run === executionEpoch) setResult(r);
    } catch (e: any) {
      if (run === executionEpoch) setError(e.message);
    } finally {
      if (run === executionEpoch) setLoading(false);
    }
  }

  async function runSavedQuery(sq: SavedQuery) {
    if (!sq.query || typeof sq.query !== "object" || Array.isArray(sq.query)
      || (typeof sq.query.entity !== "string" && !Array.isArray(sq.query.steps))) {
      setError("This saved value is not an entity or funnel query. Open it in Data or Values.");
      return;
    }
    if (typeof sq.query.entity === "string") {
      setEntity(sq.query.entity);
      // Commit the entity reset before assigning this execution's epoch.
      flush();
    }
    setActiveQueryId(sq.id);
    setActiveQueryObj(sq);
    setChartKind(null);
    setError(null);
    setFunnelData(null);
    setResult(null);
    const run = ++executionEpoch;
    setLoading(true);
    try {
      const isFunnel = !!(sq.query as any).steps;
      if (isFunnel) {
        const data = await api.runFunnelQuery(sq.query);
        if (run === executionEpoch) setFunnelData(data);
      } else {
        const r = await runQuery(sq.query);
        if (run === executionEpoch) setResult(r);
      }
    } catch (e: any) {
      if (run === executionEpoch) setError(e.message);
    } finally {
      if (run === executionEpoch) setLoading(false);
    }
  }

  async function deleteSavedQuery(sq: SavedQuery) {
    const epoch = sessionEpoch();
    if (
      !(await confirmDialog({
        message: `Delete query "${sq.name}"?`,
        variant: "danger",
        confirmLabel: "Delete",
      }))
    )
      return;
    if (epoch !== sessionEpoch()) return;
    try {
      await api.savedQueryDelete(sq.id);
      if (epoch !== sessionEpoch()) return;
      if (activeQueryId() === sq.id) {
        setActiveQueryId(null);
        setActiveQueryObj(null);
        setResult(null);
        setFunnelData(null);
      }
      await reloadQueries();
    } catch (e: any) {
      if (epoch === sessionEpoch()) setError(e.message);
    }
  }

  function openSaveDialog() {
    setSaveName("");
    setSaveSlug("");
    setSaveDesc("");
    setSaveCategoryId("");
    setSaveError(null);
    setShowSaveDialog(true);
  }

  function openSaveFromActive() {
    const sq = activeQueryObj();
    if (!sq) return;
    setSaveName(sq.name + " (copy)");
    setSaveSlug(sq.slug + "-copy");
    setSaveDesc(sq.description ?? "");
    setSaveCategoryId("");
    setSaveError(null);
    setShowSaveDialog(true);
  }

  async function submitSaveQuery() {
    const epoch = sessionEpoch();
    const name = saveName().trim();
    const slug = saveSlug().trim().replace(/\s+/g, "-").toLowerCase();
    if (!name || !slug) {
      setSaveError("Name and slug required");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const catId = saveCategoryId();
      const queryToSave = queryMode() === "builder" ? buildQuery() : activeQueryObj()?.query ?? buildQuery();
      const res = await api.savedQueryCreate({
        name,
        slug,
        description: saveDesc().trim() || undefined,
        query: queryToSave,
      });
      if (epoch !== sessionEpoch()) return;
      if (catId && res.query?.id) {
        await api.queryCategoryAddQuery(catId, res.query.id);
      }
      if (epoch !== sessionEpoch()) return;
      setShowSaveDialog(false);
      await reloadQueries();
    } catch (e: any) {
      if (epoch === sessionEpoch()) setSaveError(e.message);
    } finally {
      if (epoch === sessionEpoch()) setSaving(false);
    }
  }

  function addRefFilter(refSlug: string) {
    const sq = activeQueryObj();
    if (!sq) return;
    const merged = {
      ...sq.query,
      filter: {
        ...((sq.query.filter as Record<string, unknown>) ?? {}),
        $ref: `query:${refSlug}`,
      },
    };
    const composed: SavedQuery = { ...sq, query: merged, name: `${sq.name} + ${refSlug}` };
    runSavedQuery(composed);
    setShowRefPicker(false);
  }

  const queryShape = createMemo((): ResultShape => {
    const sq = activeQueryObj();
    if (!sq || (sq.query as any).steps) return "rows";
    return inferShape(sq.query as any);
  });

  const availableCharts = createMemo(() => validCharts(queryShape()));

  const activeChart = createMemo((): ChartKind => {
    const manual = chartKind();
    if (manual && availableCharts().includes(manual)) return manual;
    const r = result();
    return recommendChart(queryShape(), r?.rows?.length ?? 0);
  });

  const chartData = createMemo(() => {
    const r = result();
    if (!r?.rows?.length) return null;
    const shape = queryShape();
    if (shape === "rows") return null;

    const sq = activeQueryObj();
    if (!sq) return null;

    const bucket = sq.query.bucket as { field: string; interval: string; as?: string } | undefined;
    const groupBy = sq.query.groupBy as string[] | undefined;
    const aggs = sq.query.aggregate as { fn: string; as: string }[] | undefined;
    const labelKey = bucket?.as ?? bucket?.field ?? groupBy?.[0];
    const valueKey = aggs?.find((a) => a.as)?.as ?? "total";

    if (shape === "scalar") {
      const val = Number(r.rows[0]?.[valueKey] ?? 0);
      return [{ label: valueKey ?? "total", value: val }];
    }

    if (!labelKey) return null;
    return r.rows.map((row) => {
      let label = String(row[labelKey] ?? "—");
      if (bucket && label.includes("T")) label = label.split("T")[0]!;
      return { label, value: Number(row[valueKey] ?? 0) };
    });
  });

  const insights = createMemo((): Insight[] => {
    const r = result();
    const sq = activeQueryObj();
    if (r?.rows?.length && sq && !(sq.query as any).steps) {
      return deriveInsights(sq.query as any, r.rows);
    }
    const fd = funnelData();
    if (fd?.steps) {
      return deriveFunnelInsights(fd.steps);
    }
    return [];
  });

  const columns = createMemo(() => {
    const r = result();
    if (!r?.rows?.length) return [];
    const keys = new Set<string>();
    for (const row of r.rows) {
      for (const k of Object.keys(row)) keys.add(k);
    }
    return [...keys];
  });

  function downloadCsv() {
    const r = result();
    if (!r?.rows?.length) return;
    const cols = columns();
    const escape = (v: string) => (/[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = cols.map(escape).join(",");
    const body = r.rows.map((row) => cols.map((c) => escape(formatCell(row[c]))).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeQueryObj()?.slug ?? entity()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatCell(val: unknown): string {
    return formatRuntimeValue(val);
  }

  function truncate(s: string, len = 60): string {
    return s.length > len ? s.slice(0, len) + "..." : s;
  }

  return (
    <>
      <h1 class="page-title">Query Explorer</h1>
      <Show when={schemaError()}><div role="alert" class="card">Could not load query fields: {schemaError()} <button type="button" class="btn" onClick={() => void revalidate("querySchema")}>Retry</button></div></Show>
      <Show when={savedError()}><div role="alert" class="card">Could not load saved queries: {savedError()} <button type="button" class="btn" onClick={() => void reloadQueries()}>Retry</button></div></Show>

      {/* Mode toggle and saved-query creation */}
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem; align-items: center">
        <button
          class={`btn ${queryMode() === "preset" ? "btn-primary" : ""}`}
          onClick={() => setQueryMode("preset")}
          style="padding: 0.35rem 0.75rem; font-size: 0.8rem"
        >
          Saved Queries
        </button>
        <button
          class={`btn ${queryMode() === "builder" ? "btn-primary" : ""}`}
          onClick={() => setQueryMode("builder")}
          style="padding: 0.35rem 0.75rem; font-size: 0.8rem"
        >
          Builder
        </button>
        <div style="margin-left: auto; display: flex; gap: 0.4rem; align-items: center">
          <button
            class="btn"
            onClick={openSaveDialog}
            style="padding: 0.3rem 0.6rem; font-size: 0.7rem"
          >
            + Save Query
          </button>

        </div>
      </div>

      {/* Save query dialog */}
      <Show when={showSaveDialog()}>
        <div class="card" style="padding: 1rem; margin-bottom: 1rem; border: 2px solid #4f46e5">
          <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.75rem">Save Query</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.5rem">
            <div>
              <label class="query-label">Name</label>
              <input class="query-input" style="width: 100%" value={saveName()} onInput={(e) => setSaveName(e.currentTarget.value)} placeholder="My query" />
            </div>
            <div>
              <label class="query-label">Slug</label>
              <input class="query-input" style="width: 100%" value={saveSlug()} onInput={(e) => setSaveSlug(e.currentTarget.value)} placeholder="my-query" />
            </div>
          </div>
          <div style="margin-bottom: 0.5rem">
            <label class="query-label">Description</label>
            <input class="query-input" style="width: 100%" value={saveDesc()} onInput={(e) => setSaveDesc(e.currentTarget.value)} placeholder="Optional description" />
          </div>
          <div style="margin-bottom: 0.75rem">
            <label class="query-label">Category</label>
            <LocusSelect class="query-input" minWidth="100%" label="Category" value={saveCategoryId()}
              options={[{ value: "", label: "— none —" }, ...categories().map((cat) => ({ value: cat.id, label: cat.name }))]}
              onChange={(value) => { if (value !== saveCategoryId()) setSaveCategoryId(value); }} />
          </div>
          <Show when={saveError()}>
            <div style="font-size: 0.75rem; color: #dc2626; margin-bottom: 0.5rem">{saveError()}</div>
          </Show>
          <div style="display: flex; gap: 0.5rem">
            <button class="btn btn-primary" onClick={submitSaveQuery} disabled={saving()} style="padding: 0.35rem 0.75rem; font-size: 0.8rem">
              {saving() ? "Saving..." : "Save"}
            </button>
            <button class="btn" onClick={() => setShowSaveDialog(false)} style="padding: 0.35rem 0.75rem; font-size: 0.8rem">Cancel</button>
          </div>
        </div>
      </Show>

      {/* Saved queries mode */}
      <Show when={queryMode() === "preset"}>
        {/* Category filter bar + search */}
        <div style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem; align-items: center; flex-wrap: wrap">
          <input
            class="query-input"
            style="width: 200px; font-size: 0.75rem"
            placeholder="Search queries..."
            value={searchText() ?? ""}
            onInput={(e) => {
              const v = e.currentTarget.value.trim();
              setSearchText(v || undefined);
            }}
          />
          <button
            class={`btn ${!filterCategory() ? "btn-primary" : ""}`}
            onClick={() => setFilterCategory(undefined)}
            style="padding: 0.2rem 0.5rem; font-size: 0.7rem"
          >
            All
          </button>
          <For each={rootCategories()}>
            {(cat) => (
              <button
                class={`btn ${filterCategory() === cat.slug ? "btn-primary" : ""}`}
                onClick={() => setFilterCategory(filterCategory() === cat.slug ? undefined : cat.slug)}
                style="padding: 0.2rem 0.5rem; font-size: 0.7rem"
              >
                {cat.name}
                <Show when={cat.queryIds.length > 0}>
                  <span style="opacity: 0.5; margin-left: 0.2rem">{cat.queryIds.length}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
        {/* Child categories */}
        <Show when={childCategories().length > 0}>
          <div style="display: flex; gap: 0.35rem; margin-bottom: 0.75rem; margin-left: 1rem; align-items: center; flex-wrap: wrap">
            <span style="font-size: 0.65rem; color: #999">sub:</span>
            <For each={childCategories()}>
              {(cat) => (
                <button
                  class={`btn ${filterCategory() === cat.slug ? "btn-primary" : ""}`}
                  onClick={() => setFilterCategory(filterCategory() === cat.slug ? undefined : cat.slug)}
                  style="padding: 0.15rem 0.4rem; font-size: 0.65rem"
                >
                  {cat.name} <span style="opacity: 0.5">{cat.queryIds.length}</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Query cards */}
        <Show when={queries().length > 0} fallback={<p class="text-muted" style="font-size: 0.8rem">No saved queries found. Use "Save Query" to create one.</p>}>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.75rem; margin-bottom: 1rem">
            <For each={queries()}>
              {(sq) => (
                <div
                  class="card"
                  style={`padding: 0.75rem; text-align: left; border: 2px solid ${activeQueryId() === sq.id ? "#4f46e5" : "transparent"}; transition: border-color 0.15s`}
                >
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem">
                    <button
                      style="all: unset; cursor: pointer; flex: 1; min-width: 0"
                      onClick={() => runSavedQuery(sq)}
                      disabled={loading()}
                    >
                      <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.25rem">{sq.name}</div>
                      <Show when={sq.description}>
                        <div style="font-size: 0.7rem; color: #888">{sq.description}</div>
                      </Show>
                    </button>
                    <div style="display: flex; gap: 0.25rem; flex-shrink: 0">
                      <Show when={activeQueryId() === sq.id}>
                        <button
                          class="btn"
                          onClick={() => { setShowRefPicker(!showRefPicker()); }}
                          style="padding: 0.15rem 0.35rem; font-size: 0.6rem"
                          data-tooltip="Compose with another query ($ref)"
                        >
                          +ref
                        </button>
                        <button
                          class="btn"
                          onClick={() => openSaveFromActive()}
                          style="padding: 0.15rem 0.35rem; font-size: 0.6rem"
                          data-tooltip="Duplicate this query"
                        >
                          dup
                        </button>
                      </Show>
                      <button
                        class="btn btn-danger"
                        onClick={() => deleteSavedQuery(sq)}
                        style="padding: 0.15rem 0.35rem; font-size: 0.6rem"
                        data-tooltip="Delete"
                      >
                        x
                      </button>
                    </div>
                  </div>
                  <div style="display: flex; gap: 0.25rem; margin-top: 0.35rem; flex-wrap: wrap">
                    <Show when={(sq.query as any).entity}>
                      <span style="font-size: 0.6rem; color: #bbb">{(sq.query as any).entity}</span>
                    </Show>
                    <Show when={(sq.query as any).steps}>
                      <span style="font-size: 0.6rem; color: #bbb">funnel</span>
                    </Show>
                    <For each={categories().filter((c) => c.queryIds.includes(sq.id))}>
                      {(cat) => (
                        <span style="font-size: 0.6rem; background: #f0f0f0; color: #666; padding: 0.1rem 0.3rem; border-radius: 3px">{cat.name}</span>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* $ref picker */}
        <Show when={showRefPicker() && activeQueryObj()}>
          <div class="card" style="padding: 0.75rem; margin-bottom: 1rem; border: 2px solid #f59e0b">
            <div style="font-weight: 600; font-size: 0.8rem; margin-bottom: 0.5rem">Compose with query ($ref)</div>
            <div style="font-size: 0.7rem; color: #888; margin-bottom: 0.5rem">Select a query to merge its filters into the current results:</div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap">
              <For each={queries().filter((sq) => sq.id !== activeQueryId() && !(sq.query as any).steps)}>
                {(sq) => (
                  <button
                    class="btn"
                    onClick={() => addRefFilter(sq.slug)}
                    style="padding: 0.25rem 0.5rem; font-size: 0.7rem"
                  >
                    {sq.name}
                  </button>
                )}
              </For>
            </div>
            <button class="btn" onClick={() => setShowRefPicker(false)} style="margin-top: 0.5rem; padding: 0.2rem 0.5rem; font-size: 0.7rem">Cancel</button>
          </div>
        </Show>
      </Show>

      {/* Builder mode */}
      <Show when={queryMode() === "builder"}>
      <div class="card" style="padding: 1rem; margin-bottom: 1rem">
        {/* Entity + Limit row */}
        <div style="display: flex; gap: 0.75rem; align-items: flex-end; flex-wrap: wrap; margin-bottom: 0.75rem">
          <div>
            <label class="query-label">Entity</label>
            <LocusSelect
              label="Entity"
              value={entity()}
              options={entityNames().map((name) => ({ value: name, label: name }))}
              onChange={(value) => { if (value !== entity()) setEntity(value); }}
              class="query-input"
            />
          </div>
          <div>
            <label class="query-label">Limit</label>
            <input
              type="number"
              value={limit()}
              onInput={(e) => setLimit(parseInt(e.currentTarget.value) || 25)}
              min={1}
              max={1000}
              class="query-input"
              style="width: 80px"
            />
          </div>
          <button class="btn btn-primary" onClick={executeQuery} disabled={loading()} style="padding: 0.4rem 1rem">
            {loading() ? "Running..." : "Run Query"}
          </button>
          <button class="btn" onClick={() => setShowJson(!showJson())} style="padding: 0.4rem 0.6rem; font-size: 0.75rem">
            {showJson() ? "Hide query" : "Show query"}
          </button>
        </div>

        {/* Filters */}
        <div style="border-top: 1px solid #eee; padding-top: 0.75rem">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem">
            <span class="query-label" style="margin-bottom: 0">Filters</span>
            <button class="btn" onClick={addFilter} style="padding: 0.2rem 0.5rem; font-size: 0.75rem">+ Add Filter</button>
          </div>
          <For each={filters()}>
            {(filter, idx) => (
              <div style="display: flex; gap: 0.5rem; align-items: flex-start; margin-bottom: 0.5rem; padding: 0.5rem; background: #f8f9fa; border-radius: 6px">
                <LocusSelect
                  label="Filter field"
                  value={filter.field}
                  options={entityFields().map((field) => ({ value: field.name, label: field.name }))}
                  onChange={(value) => { if (value !== filter.field) updateFilterField(idx(), value); }}
                  class="query-input"
                  minWidth="120px"
                />
                <div style="flex: 1">
                  <SetExprEditor
                    value={filter.expr}
                    onChange={(expr) => updateFilterExpr(idx(), expr)}
                    valueType={(() => {
                      const t = fieldTypeMap().get(filter.field);
                      return t ? valueDomain(t) : "any";
                    })()}
                    compact
                  />
                </div>
                <button
                  class="btn btn-danger"
                  onClick={() => removeFilter(idx())}
                  style="padding: 0.2rem 0.4rem; font-size: 0.7rem; flex-shrink: 0"
                >
                  x
                </button>
              </div>
            )}
          </For>
          <Show when={filters().length === 0}>
            <p style="font-size: 0.75rem; color: #999; margin: 0">No filters — returns all rows</p>
          </Show>
        </div>

        {/* Readable query preview */}
        <Show when={showJson()}>
          <div style="margin-top: 0.75rem; border-top: 1px solid #eee; padding-top: 0.5rem">
            <pre style="font-size: 0.7rem; background: #1a1a2e; color: #e0e0e0; padding: 0.75rem; border-radius: 6px; overflow-x: auto; margin: 0">
                  {formatRuntimeValue(buildQuery(), 2)}
            </pre>
          </div>
        </Show>
      </div>
      </Show>

      {/* Relations info */}
      <Show when={Object.keys(entityRelations()).length > 0}>
        <div style="font-size: 0.75rem; color: #888; margin-bottom: 0.75rem">
          Relations: {Object.entries(entityRelations()).map(([k, v]) => `${k} (${(v as string[]).join(", ")})`).join(" | ")}
        </div>
      </Show>

      {/* Funnel chart */}
      <Show when={funnelData()}>
        {(data) => (
          <div class="card" style="padding: 1rem; margin-bottom: 1rem">
            <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.75rem">
              {activeQueryObj()?.name ?? "Funnel"}
            </div>
            <FunnelChart data={data()} />
          </div>
        )}
      </Show>

      {/* Chart with picker */}
      <Show when={chartData()}>
        {(data) => (
          <div class="card" style="padding: 1rem; margin-bottom: 1rem">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem">
              <span style="font-weight: 600; font-size: 0.85rem">{activeQueryObj()?.name ?? "Results"}</span>
              <div style="display: flex; gap: 0.25rem">
                <For each={availableCharts()}>
                  {(kind) => (
                    <button
                      class={`btn ${activeChart() === kind ? "btn-primary" : ""}`}
                      onClick={() => setChartKind(kind)}
                      style="padding: 0.15rem 0.4rem; font-size: 0.65rem; min-width: 0"
                      data-tooltip={kind}
                    >
                      {CHART_ICONS[kind] ?? kind}
                    </button>
                  )}
                </For>
              </div>
            </div>
            {renderChart(activeChart(), data(), result()?.rows ?? [])}
          </div>
        )}
      </Show>

      {/* Insights */}
      <InsightsPanel insights={insights()} />

      {/* Error */}
      <Show when={error()}>
        <div class="card" style="padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; font-size: 0.85rem">
          {error()}
        </div>
      </Show>

      {/* Results */}
      <Show when={result()}>
        {(r) => (
          <>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem">
              <span class="text-muted" style="font-size: 0.8rem">
                {r().rows.length} rows
                <Show when={r().total !== undefined}> of {r().total} total</Show>
              </span>
              <button class="btn" onClick={downloadCsv} style="padding: 0.2rem 0.5rem; font-size: 0.7rem" data-tooltip="Download CSV">
                ⬇ CSV
              </button>
            </div>

            <Show when={r().rows.length > 0} fallback={<p class="text-muted">No results</p>}>
              <div class="table-wrap" style="overflow-x: auto">
                <table>
                  <thead>
                    <tr>
                      <For each={columns()}>
                        {(col) => <th style="white-space: nowrap; font-size: 0.75rem">{col}</th>}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={r().rows}>
                      {(row) => (
                        <tr>
                          <For each={columns()}>
                            {(col) => (
                              <td
                                class="mono"
                                style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem"
                                data-tooltip={formatCell(row[col])}
                              >
                                {truncate(formatCell(row[col]))}
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </>
        )}
      </Show>
    </>
  );
}
