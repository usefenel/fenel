// ---------------------------------------------------------------------------
// /app/data — universal browser, search, and record-query surface.
//
// Everything in Fenel is data: types, functions, typeclasses, entity rows,
// running instances. This page is the one slot that lets you query across
// all of it. The query language is Fenel type syntax extended with arrows,
// pattern variables, and `entity:X` for record queries — dispatched by
// the parser in `~/lib/data-search`:
//
//   trim                     text search across name/description
//   String                   type lookup, subtype-aware
//   List(Email)              composite types
//   String -> String         function signatures (variance-aware)
//   a -> a                   polymorphic patterns
//   entity:Profile           record query (rows + auto-chart + insights)
//   entity:Profile limit 50  with row limit
//
// Presets are persisted server-side via the savedQueries API (the same
// table Query Explorer writes into). A saved Data preset has the body
// `{kind: "data-search", text: "..."}`; record-query saves from the Query
// Explorer surface here too, listed under "From Query Explorer."
// ---------------------------------------------------------------------------

import { For, Show, createMemo, createSignal, createEffect, Loading } from "solid-js";
import { createAsyncValue } from "~/lib/async-value";
import { revalidate } from "@solidjs/router";
import {
  getCatalog,
  inferShape,
  recommendChart,
  validCharts,
  deriveInsights,
  peelList,
  peelMaybe,
  type FenelType,
  type FenelFunction,
  type ChartKind,
  type ResultShape,
  type Insight,
} from "@fenel/engine";
import { getTypes, getFunctions, getSavedQueries, api } from "~/lib/api";
import { formatRuntimeValue } from "~/lib/runtime-value-display";
import { sessionEpoch } from "~/lib/browser-session";
import { parseQuery, search, type ParsedQuery, type DataItem, type DataKind, type Match } from "~/lib/data-search";
import { renderChart } from "~/lib/charts";
import { AddToLocusButton } from "~/lib/add-to-locus";
import { locusCatalogReferenceValue } from "~/lib/locus-catalog-reference";
import { accountCatalogLookups, entryToItem } from "~/lib/data-items";
import { addToLocus } from "./home";

// All Fenel functions are equal — there's no "user-function" vs
// "function" distinction. Std is just functions written by us
// admins. Same for types: "user-type" was a UI-only label, the
// underlying records are just types.
const KIND_LABELS: Record<DataKind, string> = {
  type: "Types",
  entity: "Entities",
  typeclass: "Typeclasses",
  constructor: "Generics",
  function: "Functions",
};

const KIND_BADGE: Record<DataKind, string> = {
  type: "badge-blue",
  entity: "badge-gray",
  typeclass: "badge-red",
  constructor: "badge-purple",
  function: "badge-cyan",
};

const KIND_ORDER: DataKind[] = [
  "type",
  "entity",
  "typeclass",
  "constructor",
  "function",
];

// Tutorial examples — clickable, each runs immediately.
const TUTORIAL_EXAMPLES: { query: string; description: string }[] = [
  { query: "trim", description: "Text across all names and descriptions." },
  { query: "String", description: "Every refinement of String (Email, URL, Phone…), every type that contains it, every function that touches it. Subtype-aware." },
  { query: "List(Email)", description: "Composite type lookup. Same subtype-awareness inside the wrapper." },
  { query: "String -> String", description: "Function signatures. Variance-aware — also matches Email → Email." },
  { query: "(String, Number) -> Boolean", description: "Multi-argument signatures." },
  { query: "a -> a", description: "Pattern variables. Lowercase identifiers unify; finds every identity-shaped function." },
  { query: "(a -> b) -> List(a) -> List(b)", description: "Higher-order patterns; vars unify across positions." },
  { query: "entity:profile", description: "Record query — actual rows of the Profile entity, with an auto-chart and insights." },
  { query: "String{email}", description: "Refined type with named-set constraint." },
  { query: "Number[0..100]", description: "Refined type with interval constraint." },
];

// Seeded data-search presets — written to the server on first visit if no
// data-search saves exist yet. The user owns these once written.
const SEED_DATA_PRESETS: string[] = [
  "a -> a",
  "String -> String",
  "(a, a) -> Boolean",
  "List(a) -> a",
  "Email",
  "Number -> Number",
  "entity:profile",
];

const DATA_SEARCH_KIND = "data-search";

// A saved query as returned by getSavedQueries.
type SavedQuery = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  query: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

// Slugify the query text for the saved-query slug field.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `q-${Date.now()}`;
}

export default function DataPage() {
  const userTypes = createMemo(() => getTypes().catch(() => null));
  const userFns = createMemo(() => getFunctions().catch(() => null));
  const [savedError, setSavedError] = createSignal<string>();
  const [savedLoadedEpoch, setSavedLoadedEpoch] = createSignal<number>();
  const savedRaw = createMemo(() => {
    const epoch = sessionEpoch();
    return getSavedQueries().then((value) => { if (epoch === sessionEpoch()) { setSavedError(undefined); setSavedLoadedEpoch(epoch); } return value; })
      .catch((reason) => { if (epoch === sessionEpoch()) setSavedError(String(reason)); return undefined; });
  });

  const [queryText, setQueryText] = createSignal("");
  const [recordError, setRecordError] = createSignal<string | null>(null);

  // Data-search presets (kind === "data-search"). Display by query text;
  // the slug/name are bookkeeping.
  const dataPresets = createMemo<{ id: string; text: string; saved: SavedQuery }[]>(() => {
    const list = ((savedRaw() as any)?.queries ?? []) as SavedQuery[];
    return list
      .filter((sq) => (sq.query as any)?.kind === DATA_SEARCH_KIND && typeof (sq.query as any).text === "string")
      .map((sq) => ({ id: sq.id, text: (sq.query as any).text as string, saved: sq }));
  });

  // Record-query saves (anything that isn't data-search and isn't a funnel
  // — we'll surface those too once funnels render inline).
  const recordPresets = createMemo<SavedQuery[]>(() => {
    const list = ((savedRaw() as any)?.queries ?? []) as SavedQuery[];
    return list.filter((sq) => {
      const k = (sq.query as any)?.kind;
      const hasEntity = typeof (sq.query as any)?.entity === "string";
      return k !== DATA_SEARCH_KIND && k !== "expression" && hasEntity;
    });
  });

  // Expression saves from /app/values — show as a separate row so
  // the user can jump from here to any of their saved values.
  const expressionPresets = createMemo<SavedQuery[]>(() => {
    const list = ((savedRaw() as any)?.queries ?? []) as SavedQuery[];
    return list.filter((sq) => (sq.query as any)?.kind === "expression");
  });

  // First-visit seeding — if the account has zero data-search saves, write
  // the defaults. Idempotent: subsequent visits skip.
  const [seeded, setSeeded] = createSignal(false);
  createEffect(
    () => ({ raw: savedRaw(), loadedEpoch: savedLoadedEpoch(), epoch: sessionEpoch() }),
    ({ raw, loadedEpoch, epoch }) => {
      if (!raw || seeded() || loadedEpoch !== epoch) return;
      const existing = ((raw as any).queries ?? []) as SavedQuery[];
      const hasAny = existing.some((sq) => (sq.query as any)?.kind === DATA_SEARCH_KIND);
      setSeeded(true);
      if (hasAny) return;
      void seedDefaults();
    },
  );

  async function seedDefaults() {
    const epoch = sessionEpoch();
    for (const text of SEED_DATA_PRESETS) {
      if (epoch !== sessionEpoch()) return;
      try {
        await api.savedQueryCreate({
          name: text,
          slug: `data-${slugify(text)}`,
          query: { kind: DATA_SEARCH_KIND, text },
        });
      } catch {
        // Slug collision or other — ignore; don't bail on the rest.
      }
    }
    if (epoch === sessionEpoch()) void revalidate("savedQueries");
  }

  const trimmedQuery = () => queryText().trim();
  const isQuerySaved = () =>
    trimmedQuery().length > 0 && dataPresets().some((p) => p.text === trimmedQuery());

  async function savePreset() {
    const epoch = sessionEpoch();
    const q = trimmedQuery();
    if (!q || isQuerySaved()) return;
    try {
      await api.savedQueryCreate({
        name: q,
        slug: `data-${slugify(q)}-${Date.now().toString(36)}`,
        query: { kind: DATA_SEARCH_KIND, text: q },
      });
      if (epoch === sessionEpoch()) void revalidate("savedQueries");
    } catch (e: any) {
      if (epoch === sessionEpoch()) setRecordError(`Save failed: ${e?.message ?? String(e)}`);
    }
  }

  async function deletePreset(id: string) {
    const epoch = sessionEpoch();
    try {
      await api.savedQueryDelete(id);
      if (epoch === sessionEpoch()) void revalidate("savedQueries");
    } catch (e: any) {
      if (epoch === sessionEpoch()) setRecordError(`Delete failed: ${e?.message ?? String(e)}`);
    }
  }

  function runQuery(q: string) {
    setRecordError(null);
    setQueryText(q);
  }

  // Inline record-query saves: clicking a record preset sets the query to
  // `entity:<name>` so the input shows where you are; the dispatch then
  // hits /api/query with the saved query's full body so any filter /
  // aggregate / bucket carries over.
  function runRecordPreset(sq: SavedQuery) {
    const entity = (sq.query as any).entity as string;
    setRecordError(null);
    setQueryText(`entity:${entity}`);
    setActiveSavedQuery(sq);
  }

  // When the user types something different, clear the saved-query override
  // so the parser-built body wins again.
  const [activeSavedQuery, setActiveSavedQuery] = createSignal<SavedQuery | null>(null);
  let activeAccountEpoch = sessionEpoch();
  createEffect(
    () => sessionEpoch(),
    (next) => {
      if (next === activeAccountEpoch) return;
      activeAccountEpoch = next;
      setActiveSavedQuery(null); setQueryText(""); setRecordError(null); setSeeded(false);
    },
  );
  createEffect(
    () => ({ text: queryText(), saved: activeSavedQuery() }),
    ({ text, saved: sq }) => {
      if (!sq) return;
      const expectedText = `entity:${(sq.query as any).entity}`;
      if (text !== expectedText) setActiveSavedQuery(null);
    },
  );

  // Build the in-memory catalog index for type/text/signature search.
  const items = createMemo<DataItem[]>(() => {
    const out: DataItem[] = [];
    for (const section of getCatalog()) {
      for (const entry of section.entries) {
        const item = entryToItem(entry);
        if (item) out.push(item);
      }
    }
    const ut = ((userTypes() as any)?.types ?? []) as { name: string; type?: FenelType; label?: string; description?: string; icon?: string; isSystem?: boolean }[];
    for (const t of ut) {
      if (t.isSystem) continue;
      if (!t.type) continue;
      out.push({
        kind: "type",
        routeId: `entity:${t.name}`,
        routeBase: "/app/types/",
        label: t.label ?? t.name,
        description: t.description ?? "",
        icon: t.icon,
        type: t.type,
        // Judged by its registry reference: `type` is the wire copy.
        ref: { $ref: t.name } as FenelType,
        source: "user",
      });
    }
    const uf = ((userFns() as any)?.functions ?? []) as { id: string; name: string; function: FenelFunction; description?: string }[];
    for (const f of uf) {
      if (!f.function) continue;
      out.push({
        kind: "function",
        routeId: f.name,
        routeBase: "/app/functions/",
        label: f.name,
        codeName: f.name,
        description: f.description ?? "",
        signature: { params: f.function.params ?? [], returns: f.function.returns ?? ({ $ref: "Unit" } as FenelType) },
        source: "user",
      });
    }
    return out;
  });

  const parsed = createMemo(() => parseQuery(queryText()));

  const matches = createMemo<Match[]>(() => {
    const q = parsed();
    if (q.kind === "empty") return [];
    return search(items(), q);
  });

  const grouped = createMemo(() => {
    const groups = new Map<DataKind, Match[]>();
    for (const m of matches()) {
      const arr = groups.get(m.item.kind) ?? [];
      arr.push(m);
      groups.set(m.item.kind, arr);
    }
    return KIND_ORDER
      .map((kind) => ({ kind, matches: groups.get(kind) ?? [] }))
      .filter((g) => g.matches.length > 0);
  });

  // Record-query dispatch: when the parser identifies a record query, hit
  // the /api/query endpoint. createResource depends on the query body so
  // it re-runs whenever the query changes.
  const recordBody = createMemo(() => {
    const p = parsed();
    if (p.kind !== "record") return null;
    const sq = activeSavedQuery();
    // If a saved-query body is active for this entity, use its full shape
    // (preserves filters/aggregates/bucket); otherwise the parser-built
    // body is just the bare entity + limit.
    if (sq && (sq.query as any).entity === p.entity) return sq.query;
    return p.query;
  });

  const recordResult = createAsyncValue(recordBody, async (body) => {
    const epoch = sessionEpoch();
    if (!body) return null;
    try {
      return await api.runRecordQuery(body);
    } catch (e: any) {
      if (epoch === sessionEpoch()) setRecordError(e?.message ?? String(e));
      return null;
    }
  });

  // Stats summary over the current matches — gives the page a sense of
  // *how much* the query touches, which the bare list doesn't show.
  const stats = createMemo(() => {
    const p = parsed();
    if (p.kind === "empty" || p.kind === "text") return null;
    const counts: Partial<Record<DataKind, number>> = {};
    let total = 0;
    for (const m of matches()) {
      counts[m.item.kind] = (counts[m.item.kind] ?? 0) + 1;
      total += 1;
    }
    if (total === 0) return null;
    return { counts, total };
  });

  return (
    <>
      <h1 class="page-title">Data</h1>
      <Show when={savedError()}><div role="alert" class="data-error">Could not load saved queries: {savedError()} <button type="button" class="btn" onClick={() => void revalidate("savedQueries")}>Retry</button></div></Show>
      <p class="text-muted" style="margin-bottom: 1rem; font-size: 0.85rem">
        Everything in Fenel is data. One slot, one query language — definitions and records both. Search by name, by type, by signature, by pattern, or run an entity query inline.
      </p>

      <div class="data-search">
        <input
          type="text"
          class="data-search__input"
          placeholder="trim · String · String → String · a → a · entity:profile"
          value={queryText()}
          onInput={(e) => setQueryText(e.currentTarget.value)}
          autofocus
        />
        <Show when={queryText().length > 0}>
          <button
            class="data-search__clear"
            onClick={() => setQueryText("")}
            aria-label="Clear search"
          >
            ×
          </button>
        </Show>
      </div>

      <div class="data-presets">
        <For each={dataPresets()}>
          {(p) => (
            <span class={`data-preset ${queryText() === p.text ? "data-preset--active" : ""}`}>
              <button
                type="button"
                class="data-preset__run mono"
                onClick={() => runQuery(p.text)}
                data-tooltip={`Run: ${p.text}`}
              >
                {p.text}
              </button>
              <button
                type="button"
                class="data-preset__del"
                onClick={(e) => { e.stopPropagation(); void deletePreset(p.id); }}
                aria-label={`Delete preset ${p.text}`}
                data-tooltip="Remove"
              >
                ×
              </button>
            </span>
          )}
        </For>
        <Show when={trimmedQuery().length > 0 && !isQuerySaved()}>
          <button
            type="button"
            class="data-preset data-preset--save"
            onClick={() => void savePreset()}
            data-tooltip="Save current query as a preset"
          >
            + Save
          </button>
        </Show>
      </div>

      <Show when={recordPresets().length > 0}>
        <div class="data-record-presets">
          <span class="data-record-presets__label">From Query Explorer:</span>
          <For each={recordPresets()}>
            {(sq) => (
              <button
                type="button"
                class="data-preset data-preset--record"
                onClick={() => runRecordPreset(sq)}
                data-tooltip={sq.description ?? sq.name}
              >
                <span style="font-weight: 600">{sq.name || "Untitled"}</span>
                <span class="text-muted mono" style="font-size: 0.7rem; margin-left: 0.4rem">
                  entity:{String((sq.query as any).entity)}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={expressionPresets().length > 0}>
        <div class="data-record-presets">
          <span class="data-record-presets__label">Your data:</span>
          <For each={expressionPresets()}>
            {(sq) => (
              <span class="data-preset data-preset--record" style="display: inline-flex; align-items: center; padding: 0">
                <a
                  href="/app/values"
                  class="data-preset__run"
                  style="padding: 0.25rem 0.55rem"
                  data-tooltip={sq.description ?? sq.name}
                >
                  <span style="font-weight: 600">{sq.name || "Untitled"}</span>
                  <span class="text-muted mono" style="font-size: 0.7rem; margin-left: 0.4rem">expression</span>
                </a>
                <AddToLocusButton
                  getSavedExprId={() => sq.id}
                  getCaption={() => sq.name || "Untitled"}
                  label="+"
                  compact
                />
              </span>
            )}
          </For>
        </div>
      </Show>

      <QueryHint parsed={parsed()} />

      <Show when={recordError()}>
        <div class="data-error">{recordError()}</div>
      </Show>

      <Show when={queryText().length === 0}>
        <Tutorial onPick={runQuery} />
      </Show>

      <Show when={stats()}>
        {(s) => <StatsPanel stats={s()} parsed={parsed()} />}
      </Show>

      {/* Record-query result — rows + auto chart + insights */}
      <Show when={parsed().kind === "record"}>
        <RecordResultPanel
          result={recordResult()}
          loading={recordResult.loading}
          query={recordBody()}
          entity={parsed().kind === "record" ? (parsed() as any).entity : ""}
        />
      </Show>

      {/* Definitions: in-catalog matches grouped by kind */}
      <Show when={queryText().length > 0 && parsed().kind !== "record" && matches().length === 0}>
        <p class="text-muted" style="font-size: 0.9rem; margin-top: 1rem">
          Nothing found for this search. Try a type name (<code class="mono">String</code>), a signature (<code class="mono">String -&gt; String</code>), a pattern (<code class="mono">a -&gt; a</code>), or a record query (<code class="mono">entity:profile</code>).
        </p>
      </Show>

      <For each={grouped()}>
        {(group) => (
          <section style="margin-top: 1.5rem">
            <h2 class="data-group-title">
              {KIND_LABELS[group.kind]}
              <span class="badge badge-gray" style="margin-left: 0.5rem; font-size: 0.7rem">{group.matches.length}</span>
            </h2>
            <div class="data-results">
              <For each={group.matches}>
                {(m) => <ResultRow match={m} onRunQuery={runQuery} />}
              </For>
            </div>
          </section>
        )}
      </For>
    </>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function ResultRow(props: { match: Match; onRunQuery: (q: string) => void }) {
  const it = props.match.item;
  // Cross-link: for entity & type results, expose a "show records →"
  // shortcut that re-runs the query as `entity:X` inline. Saves a hop
  // through the type detail page when the user really just wants rows.
  const recordsQuery = () => {
    if (it.kind !== "entity" && it.kind !== "type") return null;
    const entityName = it.routeId.replace(/^entity:/, "");
    return `entity:${entityName}`;
  };
  return (
    <div class="data-result">
      <a href={`${it.routeBase}${it.routeId}`} class="data-result__main">
        <div class="data-result__head">
          <Show when={it.icon}>
            <span class="data-result__icon">{it.icon}</span>
          </Show>
          <span class="data-result__label">{it.label}</span>
          <span class={`badge ${KIND_BADGE[it.kind]}`} style="font-size: 0.65rem">{KIND_LABELS[it.kind]}</span>
          <span class="data-result__why mono">{props.match.reasonText}</span>
        </div>
        <Show when={it.signature}>
          <div class="data-result__sig mono">{formatSig(it.signature!)}</div>
        </Show>
        <Show when={it.description}>
          <div class="data-result__desc">{it.description}</div>
        </Show>
      </a>
      <div style="display: flex; align-items: center; gap: 0.25rem">
        <AddToLocusButton
          getExpr={() => ({ kind: "literal", value: locusCatalogReferenceValue({ kind: it.kind, id: it.routeId, name: it.label }, accountCatalogLookups) })}
          getCaption={() => it.label}
          label="+"
          compact
        />
        <Show when={recordsQuery()}>
          <button
            type="button"
            class="data-result__action"
            onClick={(e) => { e.stopPropagation(); props.onRunQuery(recordsQuery()!); }}
            data-tooltip="Run a record query for this entity inline"
          >
            show records →
          </button>
        </Show>
      </div>
    </div>
  );
}

function QueryHint(props: { parsed: ParsedQuery }) {
  const p = props.parsed;
  if (p.kind === "empty") return null;
  if (p.kind === "text") {
    return (
      <div class="data-hint">
        <span class="data-hint__label">text</span>
        Searching name, code name, and description for "{p.text}".
      </div>
    );
  }
  if (p.kind === "type") {
    const summary = p.vars.length > 0 ? `pattern with vars: ${p.vars.join(", ")}` : `type: ${p.rawText}`;
    return (
      <div class="data-hint">
        <span class="data-hint__label">type</span>
        {summary} — including refinements (subtypes), generalizations (supertypes), and structural mentions.
      </div>
    );
  }
  if (p.kind === "signature") {
    const ar = p.params.length === 1 ? "1 arg" : `${p.params.length} args`;
    const polymorphic = p.vars.length > 0 ? ` · pattern: ${p.vars.join(", ")}` : "";
    return (
      <div class="data-hint">
        <span class="data-hint__label">signature</span>
        {ar} → return — variance-aware{polymorphic}.
      </div>
    );
  }
  if (p.kind === "record") {
    return (
      <div class="data-hint">
        <span class="data-hint__label">record</span>
        Rows of <code class="mono">{p.entity}</code> — running against the live data, charted automatically when shape allows.
      </div>
    );
  }
  return null;
}

function StatsPanel(props: { stats: { counts: Partial<Record<DataKind, number>>; total: number }; parsed: ParsedQuery }) {
  return (
    <div class="data-stats">
      <span class="data-stats__total">
        <strong>{props.stats.total}</strong> match{props.stats.total === 1 ? "" : "es"} across the catalog
      </span>
      <For each={KIND_ORDER}>
        {(kind) => (
          <Show when={props.stats.counts[kind]}>
            {(count) => (
              <span class="data-stats__item">
                <span class={`badge ${KIND_BADGE[kind]}`} style="font-size: 0.65rem">{KIND_LABELS[kind]}</span>
                <strong>{count()}</strong>
              </span>
            )}
          </Show>
        )}
      </For>
    </div>
  );
}

function RecordResultPanel(props: {
  result: { rows: Record<string, unknown>[]; total?: number; meta?: { entity?: string } } | null | undefined;
  loading: boolean;
  query: Record<string, unknown> | null;
  entity: string;
}) {
  const rows = () => props.result?.rows ?? [];
  const total = () => props.result?.total;

  const shape = createMemo<ResultShape>(() => {
    const q = props.query;
    if (!q) return "rows";
    try {
      return inferShape(q as any);
    } catch {
      return "rows";
    }
  });

  const [chartKind, setChartKind] = createSignal<ChartKind | null>(null);
  const charts = createMemo(() => validCharts(shape()));
  const activeChart = createMemo<ChartKind>(() => {
    const manual = chartKind();
    if (manual && charts().includes(manual)) return manual;
    return recommendChart(shape(), rows().length);
  });

  const chartData = createMemo(() => {
    const r = rows();
    if (!r.length) return null;
    const s = shape();
    if (s === "rows") return null;
    const q = props.query as any;
    const bucket = q?.bucket as { field: string; interval: string; as?: string } | undefined;
    const groupBy = q?.groupBy as string[] | undefined;
    const aggs = q?.aggregate as { fn: string; as: string }[] | undefined;
    const labelKey = bucket?.as ?? bucket?.field ?? groupBy?.[0];
    const valueKey = aggs?.find((a) => a.as)?.as ?? "total";
    if (s === "scalar") {
      const val = Number(r[0]?.[valueKey] ?? 0);
      return [{ label: valueKey ?? "total", value: val }];
    }
    if (!labelKey) return null;
    return r.map((row) => {
      let label = String(row[labelKey] ?? "—");
      if (bucket && label.includes("T")) label = label.split("T")[0]!;
      return { label, value: Number(row[valueKey] ?? 0) };
    });
  });

  const insights = createMemo<Insight[]>(() => {
    const r = rows();
    const q = props.query;
    if (!r.length || !q) return [];
    try {
      return deriveInsights(q as any, r);
    } catch {
      return [];
    }
  });

  const columns = createMemo(() => {
    const r = rows();
    if (!r.length) return [];
    const keys = new Set<string>();
    for (const row of r) for (const k of Object.keys(row)) keys.add(k);
    return [...keys];
  });

  return (
    <section class="data-record-result">
      <div class="data-record-result__head">
        <h2 class="data-group-title" style="margin: 0">
          Records · {props.entity}
          <Show when={typeof total() === "number"}>
            <span class="badge badge-gray" style="margin-left: 0.5rem; font-size: 0.7rem">{total()}</span>
          </Show>
        </h2>
        <a href="/app/query" class="data-record-result__open" data-tooltip="Open in Query Explorer for the full builder UI">
          open in builder →
        </a>
      </div>

      <Show when={props.loading}>
        <p class="text-muted" style="font-size: 0.85rem">Loading rows…</p>
      </Show>

      <Show when={!props.loading && rows().length === 0}>
        <p class="text-muted" style="font-size: 0.85rem">Nothing found for this query.</p>
      </Show>

      <Show when={chartData() && chartData()!.length > 0}>
        <div class="data-record-result__chart">
          <Show when={charts().length > 1}>
            <div style="display: flex; gap: 0.3rem; margin-bottom: 0.5rem">
              <For each={charts()}>
                {(c) => (
                  <button
                    type="button"
                    class={`btn ${activeChart() === c ? "btn-primary" : ""}`}
                    style="padding: 0.2rem 0.5rem; font-size: 0.7rem"
                    onClick={() => setChartKind(c)}
                  >
                    {c}
                  </button>
                )}
              </For>
            </div>
          </Show>
          {renderChart(activeChart(), chartData()!)}
        </div>
      </Show>

      <Show when={insights().length > 0}>
        <div class="data-insights">
          <For each={insights()}>
            {(ins) => (
              <div class={`data-insight data-insight--${ins.severity}`}>
                <div class="data-insight__title">{ins.title}</div>
                <div class="data-insight__detail">{ins.detail}</div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={rows().length > 0}>
        <div class="table-wrap" style="margin-top: 0.5rem">
          <table>
            <thead>
              <tr>
                <For each={columns()}>{(c) => <th>{c}</th>}</For>
              </tr>
            </thead>
            <tbody>
              <For each={rows().slice(0, 50)}>
                {(row) => (
                  <tr>
                    <For each={columns()}>
                      {(c) => <td class="mono" style="font-size: 0.78rem">{formatCell(row[c])}</td>}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  );
}

function Tutorial(props: { onPick: (q: string) => void }) {
  return (
    <div class="data-tutorial">
      <h3 class="data-tutorial__title">Query language</h3>
      <p class="data-tutorial__hint">Tap any example to run it.</p>
      <ul class="data-tutorial__list">
        <For each={TUTORIAL_EXAMPLES}>
          {(ex) => (
            <li>
              <button
                type="button"
                class="mono data-tutorial__example"
                onClick={() => props.onPick(ex.query)}
              >
                {ex.query}
              </button>
              <span> — {ex.description}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

function formatSig(sig: { params: { name: string; type: FenelType }[]; returns: FenelType }): string {
  const ps = sig.params.map((p) => `${p.name}: ${typeShort(p.type)}`).join(", ");
  return `(${ps}) → ${typeShort(sig.returns)}`;
}

function typeShort(t: FenelType): string {
  const o = t as Record<string, unknown>;
  if ("$ref" in o) return String(o.$ref);
  if ("$var" in o) return String(o.$var);
  {
    const list = peelList(t);
    if (list) return `List(${typeShort(list.elem)})`;
    const maybe = peelMaybe(t);
    if (maybe) return `Maybe(${typeShort(maybe.value)})`;
  }
  if ("$tagged" in o) {
    const tg = o.$tagged as { phantom?: FenelType; value?: FenelType };
    if (tg.phantom) return `Ref(${typeShort(tg.phantom)})`;
    if (tg.value) return typeShort(tg.value);
    return "Ref";
  }
  if ("$refined" in o) return typeShort((o.$refined as { base: FenelType }).base);
  if ("$record" in o) return "{…}";
  if ("$variant" in o) return "|…|";
  return Object.keys(o)[0] ?? "?";
}

function formatCell(v: unknown): string {
  return formatRuntimeValue(v);
}
