// ---------------------------------------------------------------------------
// sliced-search — the locus search, run OFF the render path.
//
// The work behind one keystroke is not small. Every scalar-shaped type in the
// catalog is a candidate value; deciding whether the typed text IS one of them
// builds a full recursive validation plan per candidate, and the identifier
// half runs a subtype-aware match over the whole items universe. Done inside a
// memo that a keystroke invalidates, that is seconds of synchronous main-thread
// work per character — which is exactly what the browser reports as "Page
// unresponsive", and why the caret itself lagged behind the typing.
//
// So this runs the same two computations in SLICES, yielding to the event loop
// between them, and abandons a run the moment the query changes. Results are
// published progressively: the first slices are the highest-priority
// candidates, so the useful rows appear while the tail is still being decided.
//
// Nothing here is a heuristic about what to skip. The full candidate set and
// the full items universe are still visited — the only change is WHEN.
//
// The identifier half steps one item at a time (`identifier-search.ts`) inside
// the same 250-item result windows the page has always searched, and yields
// once a stretch has used its frame budget: a cold type query (`recipe`) no
// longer holds the main thread for a whole window (up to ~3 s on the seed
// catalogue), only for the budget plus its slowest single item. Results and
// their grouping are unchanged.
// ---------------------------------------------------------------------------

import { createEffect, createSignal, untrack } from "solid-js";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { parseQuery, type DataItem, type Match } from "../data-search";
import {
  buildValueCandidates, rankSuggestions, suggestForCandidate,
  type Candidate, type ValueSuggestion,
} from "./value-suggestions";
import { createIdentifierSearch } from "./identifier-search";

export type SlicedSearchResult = {
  /** The query these rows answer. A row set is only ever shown against the
   *  text it was computed for. */
  query: string;
  values: readonly ValueSuggestion[];
  identifiers: readonly Match[];
  /** Still slicing. The rows already published are real, just not final. */
  running: boolean;
};

const IDLE: SlicedSearchResult = { query: "", values: [], identifiers: [], running: false };

/** One slice of candidates, then breathe. Sized so a slice stays inside a
 *  frame budget on the slowest candidate (a refined string with a pattern
 *  constraint), not so the average one is fast. */
const CANDIDATE_SLICE = 6;
/** Long enough that the slicing overhead stays negligible, short enough that a
 *  keystroke never waits a visible amount of time for the loop to check in. */
export const SLICE_BUDGET_MS = 8;

const yieldToBrowser: () => Promise<void> =
  typeof (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler?.yield === "function"
    ? () => (globalThis as unknown as { scheduler: { yield: () => Promise<void> } }).scheduler.yield()
    : () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** `buildValueCandidates` walks the whole items universe through the registry.
 *  It answers the same thing for the same snapshot, so it is computed once per
 *  (items, registry) pair rather than once per query. */
let candidateCache: { items: unknown; registry: unknown; candidates: Candidate[] } | undefined;
function candidatesFor(items: DataItem[], registry?: ModuleRegistry): Candidate[] {
  if (candidateCache && candidateCache.items === items && candidateCache.registry === registry) {
    return candidateCache.candidates;
  }
  const candidates = buildValueCandidates(items, registry);
  candidateCache = { items, registry, candidates };
  return candidates;
}

/** B4 wave 4 lane H: the value half asked elsewhere (a Local reader's worker,
 *  `query-reader-value-search`): the same candidates, verdicts and ranking.
 *  A failure answers no values, as a failed candidate build did here. */
export type SearchValues = (query: string, items: DataItem[], signal: AbortSignal) => Promise<readonly ValueSuggestion[]>;

export function createSlicedSearch(input: {
  query: () => string;
  items: () => DataItem[];
  registry: () => ModuleRegistry | undefined;
  /** When set, the value half is asked here and `registry` is not read. */
  values?: SearchValues;
}): () => SlicedSearchResult {
  const [result, setResult] = createSignal<SlicedSearchResult>(IDLE);

  createEffect(
    () => ({ query: input.query().trim(), items: input.items(), registry: input.values ? undefined : input.registry() }),
    ({ query, items, registry }) => {
      if (!query) { setResult(IDLE); return; }
      let cancelled = false;
      const stop = () => cancelled;
      const controller = new AbortController();
      // While an asked value half is pending, the rows of the same query stay.
      const previous = untrack(result);
      const carried = input.values && previous.query === query ? previous.values : [];
      void runSlicedSearch(query, items, registry, stop, setResult, PAGE_CLOCK,
        input.values ? { values: input.values, signal: controller.signal, carried } : undefined);
      return () => { cancelled = true; controller.abort(); };
    },
  );

  return result;
}

/** When the loop reads the time and how it yields. Tests pass a virtual
 *  clock; the page uses the real one. */
export type SearchClock = { readonly now: () => number; readonly yieldNow: () => Promise<void> };
const PAGE_CLOCK: SearchClock = { now: () => performance.now(), yieldNow: yieldToBrowser };

/** One search run. Exported for its tests; `createSlicedSearch` owns it. */
export async function runSlicedSearch(
  query: string,
  items: DataItem[],
  registry: ModuleRegistry | undefined,
  cancelled: () => boolean,
  publish: (result: SlicedSearchResult) => void,
  clock: SearchClock = PAGE_CLOCK,
  asked?: { values: SearchValues; signal: AbortSignal; carried: readonly ValueSuggestion[] },
): Promise<void> {
  publish({ query, values: asked?.carried ?? [], identifiers: [], running: true });
  // One tick before any work at all: a burst of keystrokes must cost one run,
  // not one run per character, and the cancellation above is what collapses
  // them. This is the debounce — there is no separate timer.
  await clock.yieldNow();
  if (cancelled()) return;
  if (asked) return runAskedSearch(query, items, cancelled, publish, clock, asked);

  let candidates: Candidate[];
  try {
    candidates = candidatesFor(items, registry);
  } catch {
    candidates = [];
  }
  // Highest priority first, so the rows that will rank at the top are also the
  // rows that appear first. A partial list is then a prefix of the final one.
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority);
  const functions = (() => { try { return registry?.evaluateContext(); } catch { return undefined; } })();

  const values: ValueSuggestion[] = [];
  for (let index = 0; index < ordered.length; index += CANDIDATE_SLICE) {
    const started = clock.now();
    for (const candidate of ordered.slice(index, index + CANDIDATE_SLICE)) {
      const suggestion = suggestForCandidate(query, candidate, registry, functions);
      if (suggestion) values.push(suggestion);
    }
    if (cancelled()) return;
    publish({ query, values: rankSuggestions(values), identifiers: [], running: true });
    // A slice that undershot the budget does not need to pay for a yield.
    if (clock.now() - started >= SLICE_BUDGET_MS) {
      await clock.yieldNow();
      if (cancelled()) return;
    }
  }
  const finalValues = rankSuggestions(values);

  // Identifier matching is per-item cheap for text queries and expensive for
  // type/signature ones (one item can cost the decider a second or more), so
  // it runs one item per step and yields on time spent, not per step. Rows
  // are published as each 250-item result window closes, as before.
  const identifiers = createIdentifierSearch(items, parseQuery(query));
  let shown = 0;
  let stretchStarted = clock.now();
  while (!identifiers.done()) {
    identifiers.step();
    if (cancelled()) return;
    if (identifiers.windows() !== shown) {
      shown = identifiers.windows();
      publish({ query, values: finalValues, identifiers: identifiers.top(), running: true });
    }
    if (clock.now() - stretchStarted >= SLICE_BUDGET_MS) {
      await clock.yieldNow();
      if (cancelled()) return;
      stretchStarted = clock.now();
    }
  }
  publish({ query, values: finalValues, identifiers: identifiers.top(), running: false });
}

/** The identifier half as above, beside an asked value half: values appear
 *  when they are answered (the carried rows meanwhile), and the run settles
 *  once both halves have. */
async function runAskedSearch(query: string, items: DataItem[], cancelled: () => boolean,
  publish: (result: SlicedSearchResult) => void, clock: SearchClock,
  asked: { values: SearchValues; signal: AbortSignal; carried: readonly ValueSuggestion[] }): Promise<void> {
  let values: readonly ValueSuggestion[] | undefined;
  const identifiers = createIdentifierSearch(items, parseQuery(query));
  let searching = true;
  const answered = asked.values(query, items, asked.signal).then(found => found, () => [] as readonly ValueSuggestion[]).then(found => {
    values = found;
    if (!cancelled() && searching) publish({ query, values, identifiers: identifiers.top(), running: true });
  });
  let shown = 0;
  let stretchStarted = clock.now();
  while (!identifiers.done()) {
    identifiers.step();
    if (cancelled()) return;
    if (identifiers.windows() !== shown) {
      shown = identifiers.windows();
      publish({ query, values: values ?? asked.carried, identifiers: identifiers.top(), running: true });
    }
    if (clock.now() - stretchStarted >= SLICE_BUDGET_MS) {
      await clock.yieldNow();
      if (cancelled()) return;
      stretchStarted = clock.now();
    }
  }
  if (values === undefined) publish({ query, values: asked.carried, identifiers: identifiers.top(), running: true });
  searching = false;
  await answered;
  if (cancelled()) return;
  publish({ query, values: values ?? [], identifiers: identifiers.top(), running: false });
}
