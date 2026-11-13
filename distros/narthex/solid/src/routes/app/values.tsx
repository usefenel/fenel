// ---------------------------------------------------------------------------
// /app/values — interactive expression composer.
//
// Pick a function, fill in arguments (literal / Exemplifiable example /
// nested function call), see every intermediate value live as you edit.
// Save the composed expression as a named "value" — persisted via the
// shared savedQueries table with `kind: "expression"`, so it surfaces on
// the Data page presets too. Values are lazy: the expression is what's
// stored, not just the computed result, so the trace stays observable
// every time you open it.
// ---------------------------------------------------------------------------

import { For, Show, createMemo, createSignal, createEffect } from "solid-js";
import { revalidate, useSearchParams } from "@solidjs/router";
import { useApiClient } from "~/lib/api";
import { locusExpressionSources, expressionSourceIndex } from "~/lib/locus-expression-sources";
import {
  evaluateAuthoringExpression,
  ExpressionEditor,
  ExpressionTrace,
  SavedValuesContext,
  type ExprNode,
  type ExprViewMode,
  type SavedValueOption,
  type SavedValuesProvider,
} from "~/lib/expression-runner";
import { SEED_VALUES } from "~/lib/expression-runner/seed-values";
import { emptyImageValue } from "~/lib/expression-runner/image-canvas-data";
import { draftSaveIssue } from "~/lib/expression-runner/creation-validation";
import { accountAuthoringSession, DETACHED_AUTHORING_SESSION } from "~/lib/expression-runner/authoring-session";
import { subject } from "~/lib/auth";
import { userFunctions } from "~/lib/user-registries";
import { ValueDisplay } from "~/lib/storybook";
import { AddToLocusButton } from "~/lib/add-to-locus";
import { addToLocus } from "./home";
import { persistRepresentation } from "~/lib/representations/persist";
import { assertCurrentSession, sessionEpoch } from "~/lib/browser-session";

const KIND = "expression";

type SavedExpression = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  query: { kind: string; expr: ExprNode };
};

const SEED_EXPR: ExprNode = {
  kind: "call",
  fnId: "std:imagePosterize",
  args: [
    { kind: "literal", value: emptyImageValue() },
    { kind: "literal", value: 4 },
  ],
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `v-${Date.now()}`;
}

export default function ValuesPage() {
  const client = useApiClient();
  const { getSavedQueries, getLocusRoot, api } = client;
  const savedRaw = createMemo(() => getSavedQueries().catch(() => ({ queries: [], categories: [] })));
  const rootData = createMemo(() => getLocusRoot());
  const authoringSession = createMemo(() => {
    const current = subject();
    return current?.$tag === "User" || current?.$tag === "Bot"
      ? accountAuthoringSession({ accountId: current.accountId, functions: userFunctions() })
      : DETACHED_AUTHORING_SESSION;
  });

  const [expr, setExpr] = createSignal<ExprNode>(SEED_EXPR);
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<ExprViewMode>("nested");

  const saved = createMemo<SavedExpression[]>(() => {
    const list = ((savedRaw() as any)?.queries ?? []) as any[];
    return list
      .filter((sq) => (sq.query as any)?.kind === KIND && (sq.query as any)?.expr)
      .map(
        (sq): SavedExpression => ({
          id: sq.id,
          slug: sq.slug,
          name: sq.name,
          description: sq.description,
          query: sq.query as { kind: string; expr: ExprNode },
        }),
      );
  });

  // Per-visit additive seeding — runs once per session. For each entry in
  // SEED_VALUES, persist it iff no existing expression save shares its
  // exact current or explicitly recorded previous name. Renames keep the
  // existing identity and authored expression. This lets new demos appear
  // have them show up on existing accounts without manual re-seeding,
  // while never duplicating an entry the user already has.
  const [seeded, setSeeded] = createSignal(false);
  createEffect(
    () => savedRaw(),
    (raw) => {
      // seeded() is read in the untracked apply on purpose: seeding must not
      // re-trigger this effect on its own write.
      if (!raw || seeded()) return;
      setSeeded(true);
      void seedShowcase();
    },
  );

  async function seedShowcase() {
    const epoch = client.epoch ?? sessionEpoch();
    const raw = savedRaw();
    const existing = ((raw as any)?.queries ?? []) as Array<{ id: string; name: string; query: { kind?: string } }>;
    const existingRows = existing.filter((sq) => sq.query?.kind === KIND).map(row => ({ ...row }));
    type LabelRow = { args?: unknown[]; instance?: { args?: unknown[]; methods?: Record<string, unknown> } };
    let labelRows: Promise<{ dispatchInstances?: LabelRow[]; specInstances?: LabelRow[] }> | undefined;
    let added = 0;
    let changed = false;
    for (const v of SEED_VALUES) {
      try {
        assertCurrentSession(epoch);
        const foundRows = existingRows.filter(row => row.name === v.name || v.previousName && row.name === v.previousName);
        if (foundRows.length) {
          for (const found of foundRows) {
            try {
              if (found.name !== v.name) {
                await api.savedQueryUpdate(found.id, { name: v.name });
                assertCurrentSession(epoch);
                found.name = v.name;
                changed = true;
              }
              if (v.previousName) {
                const labels = await (labelRows ??= client.apiFetch<{ dispatchInstances?: LabelRow[]; specInstances?: LabelRow[] }>(
                  "/dispatch-instances?typeName=Labelable"));
                assertCurrentSession(epoch);
                const label = (labels.dispatchInstances ?? labels.specInstances ?? []).find(row => (row.args ?? row.instance?.args)?.[0] === found.id);
                const previous = label?.instance?.methods?.label;
                const oldLabel = typeof previous === "string" ? previous === v.previousName
                  : previous && typeof previous === "object" && !Array.isArray(previous)
                    && Object.values(previous).some(text => text === v.previousName);
                if (oldLabel) {
                  const next = typeof previous === "string" ? v.name : Object.fromEntries(Object.entries(previous as Record<string, unknown>)
                    .map(([key, text]) => [key, text === v.previousName ? v.name : text]));
                  await persistRepresentation("Labelable", found.id, { ...label?.instance?.methods, label: next }, undefined, client);
                  assertCurrentSession(epoch);
                  changed = true;
                }
              }
            } catch {
              if (sessionEpoch() !== epoch) return;
              // Keep each saved identity independent when one update fails.
            }
          }
          continue;
        }
        const created = await api.savedQueryCreate({
          name: v.name,
          slug: `${KIND}-${slugify(v.name)}-${Date.now().toString(36)}-${added}`,
          description: v.description,
          query: { kind: KIND, expr: v.expr } as Record<string, unknown>,
        });
        assertCurrentSession(epoch);
        const id = (created as { query?: { id?: string } }).query?.id;
        if (id) existingRows.push({ id, name: v.name, query: { kind: KIND } });
        added++;
        changed = true;
      } catch {
        if (sessionEpoch() !== epoch) return;
        // Slug collision or other transient — skip; seeding is best-effort.
      }
    }
    if (changed) void client.revalidate("savedQueries");
  }

  // List + index of saved values, used to resolve `ref` nodes inside any
  // expression — both the user's currently-edited draft and the live trace
  // rendered by ExpressionTrace via SavedValuesContext.
  const savedValues = createMemo<SavedValueOption[]>(() =>
    [...locusExpressionSources(rootData().root), ...saved().map((s) => ({ id: s.id, name: s.name, expr: s.query.expr }))],
  );
  const savedById = createMemo(() => {
    return expressionSourceIndex(savedValues());
  });
  const savedProvider: SavedValuesProvider = {
    list: () => savedValues(),
    byId: (id: string) => savedById().get(id),
  };
  const refResolver = (id: string) => savedById().get(id)?.expr;

  // The current evaluation — final result + trace, computed live.
  const evaluated = createMemo(() => {
    try {
      return evaluateAuthoringExpression(expr(), refResolver, authoringSession());
    } catch (e: any) {
      return { result: undefined, trace: [], error: e?.message ?? String(e) };
    }
  });
  const draftIssue = createMemo(() => draftSaveIssue(expr(), authoringSession().environment, {
    registry: authoringSession().registry,
    resolveSavedExpr: refResolver,
  }));

  function loadSaved(s: SavedExpression) {
    setExpr(s.query.expr);
    setActiveId(s.id);
    setName(s.name);
    setDescription(s.description ?? "");
    setError(null);
  }

  // Unified search links directly to a saved expression. Consume each URL
  // selection once so later list refreshes do not overwrite an edited draft.
  const [searchParams] = useSearchParams();
  let openedSearchId: string | undefined;
  createEffect(
    () => ({ id: typeof searchParams.id === "string" ? searchParams.id : undefined, rows: saved() }),
    ({ id, rows }) => {
      if (!id || id === openedSearchId) return;
      const selected = rows.find((row) => row.id === id);
      if (selected) { openedSearchId = id; loadSaved(selected); }
    },
  );

  function newExpression() {
    setExpr(SEED_EXPR);
    setActiveId(null);
    setName("");
    setDescription("");
    setError(null);
  }

  // When the user edits the expression of a loaded saved value, drop the
  // active marker so a Save creates a new entry rather than silently
  // overwriting nothing (the API has no update for the body via the
  // helper we use here).
  createEffect(
    () => ({ id: activeId(), rows: saved(), current: expr() }),
    ({ id, rows, current }) => {
      if (!id) return;
      const s = rows.find((x) => x.id === id);
      if (!s) return;
      if (JSON.stringify(s.query.expr) !== JSON.stringify(current)) {
        setActiveId(null);
      }
    },
  );

  async function save() {
    const issue = draftIssue();
    if (issue) { setError(issue); return; }
    const n = name().trim();
    if (!n) {
      setError("Name required");
      return;
    }
    try {
      const result = await api.savedQueryCreate({
        name: n,
        slug: `${KIND}-${slugify(n)}-${Date.now().toString(36)}`,
        description: description().trim() || undefined,
        query: { kind: KIND, expr: expr() } as Record<string, unknown>,
      });
      const id = (result as { query?: { id?: string } }).query?.id;
      if (id && !await addToLocus({ savedExprId: id }, n)) throw new Error("The expression was saved, but could not be added to your data.");
      void revalidate(["savedQueries", "locusRoot"]);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function deleteSaved(id: string) {
    try {
      await api.savedQueryDelete(id);
      void revalidate("savedQueries");
      if (activeId() === id) newExpression();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function pinSavedToHome(id: string, caption: string) {
    await addToLocus({ savedExprId: id }, caption);
  }

  return (
    <SavedValuesContext value={savedProvider}>
      <h1 class="page-title">Data playground</h1>
      <p class="text-muted" style="margin-bottom: 1rem; font-size: 0.85rem">
        Compose a Fenel expression from function calls and literal data. Every intermediate stage shows live as you edit. Save a composition as named data — the expression is what's stored, so the trace stays browsable every time.
      </p>

      <Show when={saved().length > 0}>
        <div class="data-presets">
          <For each={saved()}>
            {(s) => (
              <span class={`data-preset ${activeId() === s.id ? "data-preset--active" : ""}`}>
                <button
                  type="button"
                  class="data-preset__run"
                  onClick={() => loadSaved(s)}
                  data-tooltip={s.description ?? s.name}
                >
                  {s.name}
                </button>
                <AddToLocusButton
                  getSavedExprId={() => s.id}
                  getCaption={() => s.name}
                  label="+"
                  compact
                />
                <button
                  type="button"
                  class="data-preset__del"
                  onClick={() => void deleteSaved(s.id)}
                  aria-label={`Delete ${s.name}`}
                  data-tooltip="Remove"
                >
                  ×
                </button>
              </span>
            )}
          </For>
          <button type="button" class="data-preset data-preset--save" onClick={newExpression}>
            + New
          </button>
        </div>
      </Show>

      <div class="values-grid">
        <section class="values-grid__editor">
          <div class="values-editor__header">
            <h2 class="data-group-title">Expression</h2>
            <div class="expr-view-toggle" role="tablist" aria-label="Expression lens">
              <button
                type="button"

                class={["expr-view-toggle__btn", { "expr-view-toggle__btn--active": !!(viewMode() === "nested") }]}
                onClick={() => setViewMode("nested")}
                aria-pressed={viewMode() === "nested" ? "true" : "false"}
                data-tooltip="Show as nested function calls"
              >
                nested
              </button>
              <button
                type="button"

                class={["expr-view-toggle__btn", { "expr-view-toggle__btn--active": !!(viewMode() === "pipe") }]}
                onClick={() => setViewMode("pipe")}
                aria-pressed={viewMode() === "pipe" ? "true" : "false"}
                data-tooltip="Show as a pipe chain (x |> f |> g)"
              >
                pipe
              </button>
            </div>
          </div>
          <ExpressionEditor expr={expr()} onChange={setExpr} viewMode={viewMode()} authoringSession={authoringSession()} />

          <div class="values-save">
            <input
              class="values-save__input"
              placeholder="Name (e.g. 'jojo posterized')"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
            <input
              class="values-save__input"
              placeholder="Description (optional)"
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
            />
            <button type="button" class="btn btn-primary" disabled={!!draftIssue()} data-tooltip={draftIssue()} onClick={() => void save()}>
              Save value
            </button>
            <AddToLocusButton
              getExpr={() => expr()}
              getSavedExprId={() => activeId()}
              getCaption={() => {
                const aid = activeId();
                if (aid) {
                  return saved().find((s) => s.id === aid)?.name;
                }
                return name().trim() || undefined;
              }}
            />
          </div>
          <Show when={error()}>
            <div class="data-error">{error()}</div>
          </Show>
          <Show when={draftIssue() && !error()}>
            <div class="data-error">{draftIssue()}</div>
          </Show>
        </section>

        <section class="values-grid__trace">
          <h2 class="data-group-title">Live trace</h2>
          <Show when={(evaluated() as any).error}>
            <div class="data-error">{(evaluated() as any).error}</div>
          </Show>
          <ExpressionTrace expr={expr()} viewMode={viewMode()} authoringSession={authoringSession()} />
          <div class="values-final">
            <div class="storybook-trace__cell-label mono">result</div>
            <ValueDisplay value={evaluated().result} />
          </div>
        </section>
      </div>
    </SavedValuesContext>
  );
}
