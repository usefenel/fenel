import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { nextPreviewIndex } from "./suggestion-settle";
import { createRoot, createMemo, createSignal, createEffect, onSettled, flush } from "../../node_modules/solid-js/dist/solid.dev.js";

// Cancellation when the Suggestions panel closes (2026-11-11). The retained
// inspection panels are hidden, not unmounted, so the panel itself must give
// its query back. Production code under test: the shared Suggestions owner
// (`createDataInspectionSuggestions`) and the panel's hold (the part of
// `DataInspectionSuggestionsPanel` above its markup), in a real Solid graph.
// The worker API is controlled: every request is recorded with its signal.
const surface = await readFile(new URL("./DataInspectionDialog.tsx", import.meta.url), "utf8");
const factoryStart = surface.indexOf("export function createDataInspectionSuggestions("), factoryEnd = surface.indexOf("const panelOrder:", factoryStart);
const panelStart = surface.indexOf("export function DataInspectionSuggestionsPanel("), panelEnd = surface.indexOf("  return <Errored", panelStart);
if (factoryStart < 0 || factoryEnd < factoryStart || panelStart < 0 || panelEnd < panelStart) throw new Error("Suggestions owner or panel boundary moved");
const transpiler = new Bun.Transpiler({ loader: "tsx" });
const factoryCode = transpiler.transformSync(surface.slice(factoryStart, factoryEnd)).replace(/^export /gm, "")
  .replaceAll('import("./expression-runner/authoring-catalog-worker")', "loadWorker()");
const panelCode = transpiler.transformSync(`${surface.slice(panelStart, panelEnd)}}`).replace(/^export /gm, "");
async function settle() { for (let turn = 0; turn < 12; turn++) { await Promise.resolve(); flush(); } }

const suggestion = identity => ({ identity, label: identity, revision: undefined, missingArguments: 0,
  applicability: { $tag: "Just", _0: true }, plan: { $tag: "SuggestionPlan" } });

function fixture() {
  let stop, owner;
  let input = { revision: "all-transaction", value: [1, 2, 3] };
  const worker = {}, session = {};
  const requests = [];
  const ask = (kind, signal, extra = {}) => new Promise((resolve, reject) => {
    const request = { kind, signal, resolve, ...extra };
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    requests.push(request);
  });
  const workerApi = { authoringWorkerSnapshot: () => worker,
    discoverDataSuggestionsInWorker: (_session, discovered, _options, signal) => ask("discover", signal, { input: discovered }),
    prepareDataSuggestionInWorker: (_session, selected, _input, signal) => ask("prepare", signal, { identity: selected.identity }),
    evaluateExpressionInWorker: (_session, node, _saved, signal, _scope, options) => ask("evaluate", signal, { node, options }) };
  const [visible, setVisible] = createSignal(true);
  createRoot(dispose => {
    let stopped = false;
    stop = () => { if (!stopped) { stopped = true; dispose(); flush(); } };
    const create = new Function("createSignal", "createMemo", "onSettled", "loadWorker", "nextPreviewIndex", `${factoryCode}; return createDataInspectionSuggestions;`)(
      createSignal, createMemo, onSettled, async () => workerApi, nextPreviewIndex);
    owner = create(() => { const captured = input; return { session, input: captured, current: () => input === captured, select() {} }; });
    const panel = new Function("createEffect", `${panelCode}; return DataInspectionSuggestionsPanel;`)(createEffect);
    panel({ owner, get visible() { return visible(); } });
  });
  flush();
  const of = kind => requests.filter(request => request.kind === kind);
  return { owner, requests, of, stop, settle,
    show: () => { setVisible(true); flush(); }, hide: () => { setVisible(false); flush(); },
    changeSubject: revision => { input = { revision, value: [4] }; owner.invalidate(); },
    discovered: (request, identities) => request.resolve({ revision: request.input.revision, suggestions: identities.map(suggestion),
      undecided: [], coverage: { operationsChecked: 3, operationsSeen: 3, operationsAvailable: 3 } }) };
}

describe("a hidden Suggestions panel holds no query", () => {
  test("closing the panel cancels the running preview, starts none of the queued ones and publishes nothing", async () => {
    const h = fixture();
    try {
      await settle();
      expect(h.of("discover")).toHaveLength(1);
      h.discovered(h.of("discover")[0], ["sum", "count", "sort"]);
      await settle();
      const rows = h.owner.read().batch.suggestions;
      // The rows ask for their previews, as the panel's rows do.
      expect(rows.map(row => h.owner.preview(row))).toEqual([{ state: "pending" }, { state: "pending" }, { state: "pending" }]);
      await settle();
      expect(h.of("prepare").map(request => request.identity)).toEqual(["sum"]);
      h.of("prepare")[0].resolve({ ok: true, node: { kind: "literal", value: "sum of it" } });
      await settle();
      expect(h.of("evaluate")).toHaveLength(1);
      expect(h.of("evaluate")[0].options).toEqual({ pure: true, priority: "guidance", trace: false });

      h.hide();
      await settle();
      expect(h.of("evaluate")[0].signal.aborted).toBe(true);
      expect(h.of("discover")[0].signal.aborted).toBe(true);
      // A late reply reaches nobody, and the two queued previews never start.
      h.of("evaluate")[0].resolve({ result: 6, trace: [] });
      await settle();
      expect(h.of("prepare")).toHaveLength(1);
      expect(h.of("evaluate")).toHaveLength(1);
      expect(rows.map(row => h.owner.preview(row))).toEqual([undefined, undefined, undefined]);
      await settle();
      expect(h.requests).toHaveLength(3);
    } finally { h.stop(); }
  });

  test("a change of subject or data restarts nothing while the panel is hidden, and asks once when it is shown again", async () => {
    const h = fixture();
    try {
      await settle();
      h.discovered(h.of("discover")[0], ["sum"]);
      await settle();
      h.hide();
      await settle();
      // Go up, a publication, another subject: three invalidations.
      h.changeSubject("root list"); await settle();
      h.changeSubject("root list after a publication"); await settle();
      h.changeSubject("another item"); await settle();
      expect(h.of("discover")).toHaveLength(1);
      expect(h.owner.read()).toBeUndefined();
      h.show();
      await settle();
      expect(h.of("discover")).toHaveLength(2);
      expect(h.of("discover")[1].input.revision).toBe("another item");
      expect(h.of("discover")[1].signal.aborted).toBe(false);
    } finally { h.stop(); }
  });

  test("shown again with nothing changed, the retained rows get their previews back without a new discovery", async () => {
    const h = fixture();
    try {
      await settle();
      h.discovered(h.of("discover")[0], ["sum"]);
      await settle();
      // A retained row: mounted once, kept while the panel is hidden.
      const [row] = h.owner.read().batch.suggestions;
      let seen;
      createRoot(() => { const preview = createMemo(() => h.owner.preview(row)); createEffect(preview, value => { seen = value; }); });
      flush(); await settle();
      expect(seen).toEqual({ state: "pending" });
      expect(h.of("prepare")).toHaveLength(1);
      h.hide(); await settle();
      expect(seen).toBeUndefined();
      expect(h.of("prepare")[0].signal.aborted).toBe(true);
      h.show(); await settle();
      // The same batch is reused: no second discovery, and the row asks again.
      expect(h.of("discover")).toHaveLength(1);
      expect(seen).toEqual({ state: "pending" });
      expect(h.of("prepare")).toHaveLength(2);
      expect(h.of("prepare")[1].signal.aborted).toBe(false);
    } finally { h.stop(); }
  });

  test("a visible panel still follows its subject: the old query is cancelled and the new one asked", async () => {
    const h = fixture();
    try {
      await settle();
      expect(h.of("discover")).toHaveLength(1);
      h.changeSubject("root list");
      await settle();
      expect(h.of("discover")[0].signal.aborted).toBe(true);
      expect(h.of("discover")).toHaveLength(2);
      expect(h.of("discover")[1].input.revision).toBe("root list");
      // Unmounting the panel (the lens closes) releases the query too.
      h.stop();
      expect(h.of("discover")[1].signal.aborted).toBe(true);
    } finally { h.stop(); }
  });
});
