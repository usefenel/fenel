// Run with --conditions=browser --conditions=development (Solid staged writes).
//
// Browse's identifier search stays on the page, but runs one item per step
// inside the same 250-item result windows and yields on time spent: results
// (and every intermediate publication) are exactly today's per-window loop,
// no synchronous stretch exceeds the frame budget plus one item, and a newer
// query still drops the older run's rows.
import { beforeEach, describe, expect, mock, test } from "bun:test";

// A virtual clock: each subset decision costs `decisionCost` virtual ms (and,
// when `busyMs` is set, that many real ms, for the Solid-mounted tests).
let virtualNow = 0;
let decisionCost = 0;
let busyMs = 0;
let decisions = 0;
const refines = new Map<string, string>([["Email", "String"], ["Slug", "String"]]);
const refName = (t: unknown): string | undefined => {
  const r = (t as { $ref?: unknown } | null)?.$ref;
  return typeof r === "string" ? r : undefined;
};
const decide = (a: unknown, b: unknown): boolean => {
  const refined = (a as { $refined?: { base: unknown } }).$refined;
  if (refined !== undefined) return decide(refined.base, b);
  const left = refName(a), right = refName(b);
  if (left === undefined || right === undefined) return false;
  for (let at: string | undefined = left; at !== undefined; at = refines.get(at)) if (at === right) return true;
  return false;
};
mock.module("@fenel/engine", () => ({
  isSubtype: (a: unknown, b: unknown) => {
    decisions += 1;
    virtualNow += decisionCost;
    if (busyMs > 0) { const end = performance.now() + busyMs; while (performance.now() < end) { /* busy */ } }
    return decide(a, b);
  },
  peelList: () => undefined,
  peelMaybe: () => undefined,
  peelResult: () => undefined,
  List: (elem: unknown) => ({ $list: elem }),
  Maybe: (value: unknown) => ({ $maybe: value }),
  canonical: (value: unknown) => typeof value === "string" ? value : JSON.stringify(value),
}));
// Value candidates are the other half of a run; out of scope here.
mock.module("./value-suggestions", () => ({
  buildValueCandidates: () => [],
  rankSuggestions: <T,>(values: T[]) => values,
  suggestForCandidate: () => undefined,
}));

const { createRoot, createSignal, flush } = await import("solid-js");
const { createSlicedSearch, runSlicedSearch, SLICE_BUDGET_MS } = await import("./sliced-search");
const { parseQuery, search } = await import("../data-search");
type DataItem = import("../data-search").DataItem;
type Match = import("../data-search").Match;
type SlicedSearchResult = import("./sliced-search").SlicedSearchResult;
type SearchClock = import("./sliced-search").SearchClock;

// --- fixture universe ----------------------------------------------------------
const ref = (name: string) => ({ $ref: name }) as never;
const field = (name: string, type: unknown) => ({ name, label: { $tag: "Nothing" }, type, meta: {} });
const typeItem = (routeId: string, label: string, type: unknown, extra: Partial<DataItem> = {}): DataItem => ({
  kind: "type", routeId, routeBase: "/app/types/", label, description: "", source: "system", type: type as never, ...extra,
});
const entityItem = (id: string, fields: unknown[]): DataItem => ({
  kind: "entity", routeId: `entity:${id}`, routeBase: "/app/types/", label: id, description: `A ${id.toLowerCase()}`,
  source: "system", type: { $record: { fields } } as never, ref: ref(id),
});
const fnItem = (routeId: string, label: string, params: unknown[], returns: unknown, source: DataItem["source"] = "system"): DataItem => ({
  kind: "function", routeId, routeBase: "/app/types/", label, codeName: routeId.split(":")[1], description: "",
  signature: { params: params.map((type, index) => ({ name: `p${index}`, type: type as never })), returns: returns as never },
  source,
});
const items: DataItem[] = [
  typeItem("atom:String", "String", ref("String")),
  typeItem("format:email", "Email", { $refined: { base: ref("String"), set: { $tag: "SeRef", handle: "Email" } } }, { ref: ref("Email") }),
  entityItem("Recipe", [field("title", ref("String")), field("author", ref("Email"))]),
  entityItem("Contact", [field("email", ref("Email"))]),
  fnItem("std:shout", "shout", [ref("String")], ref("String")),
  fnItem("std:normalizeEmail", "normalizeEmail", [ref("Email")], ref("Email")),
  fnItem("std:identity", "identity", [ref("a")], ref("a")),
  fnItem("image:grayscale", "grayscale", [ref("Image")], ref("Image")),
  fnItem("std:recipeTitle", "recipeTitle", [ref("Recipe")], ref("String")),
  fnItem("std:probe42", "probe42", [ref("Number")], ref("Number")),
  typeItem("entity:Slug", "Slug", { $refined: { base: ref("String"), set: { $tag: "SeRef", handle: "slug" } } }, { source: "user", ref: ref("Slug") }),
  fnItem("user:makeSlug", "makeSlug", [ref("String")], ref("Slug"), "user"),
];
// Enough String/Number functions that one 250-item window holds more than the
// matcher's 200-result cap, and matches spread over several windows.
for (let index = 0; index < 620; index++) {
  items.push(index % 31 === 0
    ? fnItem(`gen:s${index}`, `stringy${index}`, [ref("String")], ref("Email"))
    : fnItem(`gen:f${index}`, `filler${index}`, [ref("Number")], ref("Number")));
}
/** 800 items with a type each of their own: no decision is shared. */
const distinctItems = () => Array.from({ length: 800 }, (_, index) => typeItem(`t${index}`, `T${index}`, ref(`T${index}`)));
const QUERIES = ["recipe", "email", "String", "String -> String", "a -> a", "grayscale", "probe42", "Number -> Number", "Slug"];

// --- today's loop, verbatim (dev 3ea40d7b): one search call per 250 items ------
function todaysPublications(universe: DataItem[], text: string): Match[][] {
  const parsed = parseQuery(text);
  const identifiers: Match[] = [];
  const shown: Match[][] = [];
  for (let index = 0; index < universe.length; index += 250) {
    try {
      identifiers.push(...search(universe.slice(index, index + 250), parsed, universe));
    } catch {
      // One bad item's type must not cost the rest of the universe its search.
    }
    identifiers.sort((a, b) => b.score - a.score);
    shown.push(identifiers.slice(0, 40));
  }
  shown.push(identifiers.slice(0, 40));
  return shown;
}

const rows = (matches: readonly Match[]) => matches.map((m) => [m.item.routeId, m.score, m.reason, m.reasonText]);

/** A clock whose time moves only with decisions; `onYield` sees each yield. */
function virtualClock(onYield?: () => void): SearchClock {
  return { now: () => virtualNow, yieldNow: async () => { onYield?.(); } };
}

/** The identifier publications of one run (values are mocked away). */
async function publications(universe: DataItem[], text: string, clock = virtualClock()): Promise<SlicedSearchResult[]> {
  const published: SlicedSearchResult[] = [];
  await runSlicedSearch(text, universe, undefined, () => false, (result) => published.push(result), clock);
  return published;
}

async function settle(until: () => boolean, rounds = 4000): Promise<void> {
  for (let i = 0; i < rounds && !until(); i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    flush();
  }
  flush();
}

beforeEach(() => { virtualNow = 0; decisionCost = 0; busyMs = 0; decisions = 0; });

describe("Browse identifier search on the page, stepped", () => {
  test("results and every publication equal today's per-window loop", async () => {
    const reasons = new Set<string>();
    for (const text of QUERIES) {
      const expected = todaysPublications(items, text);
      const published = await publications(items, text);
      // The first publication is the empty pending row; then one per window.
      expect(published[0]).toEqual({ query: text, values: [], identifiers: [], running: true });
      const identifierRows = published.slice(1);
      expect([text, identifierRows.map((r) => rows(r.identifiers))]).toEqual([text, expected.map(rows)]);
      // The rows are the page's own items.
      for (const match of identifierRows.at(-1)!.identifiers) expect(items).toContain(match.item);
      expect(identifierRows.map((r) => r.running)).toEqual([...expected.slice(1).map(() => true), false]);
      for (const match of identifierRows.at(-1)!.identifiers) reasons.add(match.reason);
    }
    // Not vacuous: names, type-self, refinement, mentions and signatures occur.
    for (const reason of ["name", "type-self", "type-refinement", "field-mention", "signature-match", "signature-uses"]) {
      expect([reason, reasons.has(reason)]).toEqual([reason, true]);
    }
    expect(rows((await publications(items, "probe42")).at(-1)!.identifiers)[0]).toEqual(["std:probe42", 100, "name", "Exact name: probe42"]);
    expect((await publications(items, "Number -> Number")).at(-1)!.identifiers.length).toBe(40);
  });

  test("a throwing item costs its whole window, as one search call over it did", async () => {
    // A reference that cannot be serialised (a BigInt) makes its search call throw.
    const poisoned = { ...items[300]!, routeId: "poisoned", type: { $ref: "String", n: 1n } as never };
    for (const universe of [[...items.slice(0, 260), poisoned, ...items.slice(260)], [...items.slice(0, 5), poisoned, ...items.slice(5)]]) {
      for (const text of ["String", "Number -> Number", "recipe", "email"]) {
        const published = await publications(universe, text);
        expect([text, published.slice(1).map((r) => rows(r.identifiers))]).toEqual([text, todaysPublications(universe, text).map(rows)]);
      }
    }
    // The poisoned first window really is lost (it holds the best String rows).
    const early = [...items.slice(0, 5), poisoned, ...items.slice(5)];
    expect(rows((await publications(early, "String")).at(-1)!.identifiers))
      .not.toEqual(rows((await publications(items, "String")).at(-1)!.identifiers));
  });

  test("no synchronous stretch exceeds the frame budget plus one item", async () => {
    // 800 items, each with its own type: every decision costs 1 ms, so a
    // stretch holds a few items before it reaches the 8 ms budget.
    const distinct = distinctItems();
    decisionCost = 1;
    // The cost of the slowest single item, measured alone (its own universe,
    // so no decision is shared through the memo).
    let slowestItem = 0;
    for (const item of distinct.slice(0, 20)) {
      const before = virtualNow;
      search([item], parseQuery("String"), [item]);
      slowestItem = Math.max(slowestItem, virtualNow - before);
    }
    expect(slowestItem).toBeGreaterThan(0);
    virtualNow = 0; decisions = 0;
    let resumed = 0, longest = 0, yields = 0;
    const clock: SearchClock = {
      now: () => virtualNow,
      yieldNow: async () => { longest = Math.max(longest, virtualNow - resumed); yields++; await Promise.resolve(); resumed = virtualNow; },
    };
    const published = await publications(distinct, "String", clock);
    longest = Math.max(longest, virtualNow - resumed);
    expect(published.at(-1)!.running).toBe(false);
    expect(decisions).toBeGreaterThanOrEqual(800);
    expect({ longest, bound: SLICE_BUDGET_MS + slowestItem, withinBound: longest <= SLICE_BUDGET_MS + slowestItem })
      .toMatchObject({ withinBound: true });
    // And it does not yield per step: a stretch fills the budget first.
    expect(slowestItem).toBeLessThan(SLICE_BUDGET_MS);
    expect(yields).toBeLessThan(800 / 2);
  });

  test("a cancelled run publishes nothing more, even mid-window", async () => {
    const distinct = distinctItems();
    decisionCost = 5;
    let cancelled = false;
    const published: SlicedSearchResult[] = [];
    const clock: SearchClock = { now: () => virtualNow, yieldNow: async () => { if (virtualNow >= 300) cancelled = true; } };
    await runSlicedSearch("String", distinct, undefined, () => cancelled, (result) => {
      expect(cancelled).toBe(false);
      published.push(result);
    }, clock);
    expect(cancelled).toBe(true);
    // Cancelled within the first window: only the pending row was published,
    // and the run stopped within a budget of the cancel, not at the window end.
    expect(published).toEqual([{ query: "String", values: [], identifiers: [], running: true }]);
    expect(virtualNow).toBeLessThan(300 + SLICE_BUDGET_MS + 5 * 4);
  });

  test("a newer query replaces an older run, whose rows never come back", async () => {
    // Distinct types, 1 real ms per decision: the String run takes seconds.
    busyMs = 1;
    const universe = [...items, ...distinctItems()];
    const [query, setQuery] = createSignal("String");
    const seen: string[] = [];
    const root = createRoot((dispose) => ({ result: createSlicedSearch({ query, items: () => universe, registry: () => undefined }), dispose }));
    try {
      // Let the String run get under way (some identifier rows shown, not done).
      await settle(() => root.result().query === "String" && root.result().identifiers.length > 0);
      expect(root.result()).toMatchObject({ query: "String", running: true });
      setQuery("email");
      for (let i = 0; i < 4000 && !(root.result().query === "email" && !root.result().running); i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        flush();
        seen.push(root.result().query);
      }
      expect(root.result()).toMatchObject({ query: "email", running: false });
      const settledRows = rows(root.result().identifiers);
      expect(settledRows).toEqual(rows(todaysPublications(universe, "email").at(-1)!));
      // Once the newer query showed, the older one never came back.
      expect(seen.slice(seen.indexOf("email"))).not.toContain("String");
      await settle(() => false, 50);
      expect(rows(root.result().identifiers)).toEqual(settledRows);
      expect(root.result().query).toBe("email");
    } finally { root.dispose(); }
  }, 60_000);
});

// B4 wave 4 lane H: a Local reader's value half is asked of its worker. The
// identifier half and its publications are unchanged; the asked values show
// once answered (the same query's earlier rows meanwhile); the registry is
// never read; a failed answer shows no values.
describe("Browse's asked value half (a Local reader's worker)", () => {
  const throwingRegistry = new Proxy({}, { get() { throw new Error("Page registry read"); } }) as never;
  const value = (id: string) => ({ id, typeName: id, label: id, type: ref(id), detail: id, score: 1, status: "complete" as const, value: id });
  test("identifier publications as today; values carried, then answered; the run settles after both", async () => {
    let answer!: (values: unknown[]) => void;
    const asked: Array<{ query: string; items: number }> = [];
    const published: SlicedSearchResult[] = [];
    const run = runSlicedSearch("email", items, throwingRegistry, () => false, (result) => published.push(result), virtualClock(), {
      values: (query, sent) => { asked.push({ query, items: sent.length }); return new Promise(resolve => { answer = resolve as never; }); },
      signal: new AbortController().signal, carried: [value("Old")] as never });
    for (let i = 0; i < 50 && !answer; i++) await Promise.resolve();
    expect(asked).toEqual([{ query: "email", items: items.length }]);
    for (let i = 0; i < 2000 && !published.some(result => result.identifiers.length > 0 && result.running); i++) await Promise.resolve();
    expect(published[0]).toEqual({ query: "email", values: [value("Old")], identifiers: [], running: true });
    expect(published.every(result => result.values.length === 1 && result.values[0]!.id === "Old")).toBe(true);
    answer([value("Email")]);
    await run;
    const final = published.at(-1)!;
    expect(final).toMatchObject({ query: "email", running: false, values: [value("Email")] });
    expect(rows(final.identifiers)).toEqual(rows(todaysPublications(items, "email").at(-1)!));
  });
  test("a failed answer shows no values; a cancelled run publishes nothing more", async () => {
    const published: SlicedSearchResult[] = [];
    await runSlicedSearch("email", items, throwingRegistry, () => false, (result) => published.push(result), virtualClock(), {
      values: () => Promise.reject(new Error("tools")), signal: new AbortController().signal, carried: [] });
    expect(published.at(-1)).toMatchObject({ running: false, values: [] });
    let cancelled = false;
    const later: SlicedSearchResult[] = [];
    const run = runSlicedSearch("email", items, throwingRegistry, () => cancelled, (result) => later.push(result), virtualClock(), {
      values: () => new Promise(() => {}), signal: new AbortController().signal, carried: [] });
    await Promise.resolve(); await Promise.resolve();
    cancelled = true;
    const count = later.length;
    await Promise.race([run, new Promise(resolve => setTimeout(resolve, 50))]);
    expect(later.length).toBe(count);
  });
});
