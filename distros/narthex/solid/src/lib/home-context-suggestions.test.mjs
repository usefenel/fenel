import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { displayNameItemFields } from "./display-name";
import { isEnterable, isReferenceValue, scopeKey as locusScopeKey } from "./locus-scope";
import { followLocusPath } from "./locus-reference";
import { locusOpenMenuItems } from "./locus-menu-actions";
import { workspaceSourceKey } from "./workspace-source-wire";
import { createRoot, createMemo, createSignal, createEffect, onSettled, flush } from "../../node_modules/solid-js/dist/solid.dev.js";

// Exercise the production handoff admission without mounting unrelated Home
// readers. Browser tests cover the actual originating right-click lifetime.
const source = (await readFile(new URL("../routes/app/home.tsx", import.meta.url), "utf8")).replace(/\r\n?/g, "\n");
const start = source.indexOf("  let initialSuggestionsConsumed = false;");
const end = source.indexOf("  const canvasSourceReference =", start);
if (start < 0 || end < 0) throw new Error("Suggestions handoff boundary moved");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const install = new Function("initialSuggestions", "createEffect", "root", "scopeSubject", "scope", "sessionEpoch", "props",
  "workspaceSourceKey", "findLocusItem", "draftValueFingerprint", "openDataSuggestionsFor", "setContextMenu", "setToolbarError", "current",
  "lensSuggestions", "lensExpressionSubject", "captureContainedOccurrence",
  transpiler.transformSync(source.slice(start, end)));
const selectedStart = source.indexOf("  function selectedSuggestionData(");
const childKeyStart = source.indexOf("function childItemKey(");
const childItemKey = new Function(`${transpiler.transformSync(source.slice(childKeyStart, source.indexOf("\n}\n", childKeyStart) + 3))}; return childItemKey;`)();
const selectDataFactory = new Function("homeData", "lensExpressionSubject", "savedExprById", "resolveExpr", "focusedType",
  "root", "scope", "valueScope", "childItemKey", "focusedExpressionController",
  `${transpiler.transformSync(source.slice(selectedStart, source.indexOf("  function suggestionSourceForTarget(", selectedStart)))}; return selectedSuggestionData;`);
// Demo 1 (2026-11-07): the current root, scope and value scope decide whether a
// card's own reference replaces an authored copy. Earlier fixtures see a root
// without published card references.
const selectData = (homeData, lensExpressionSubject, savedExprById, resolveExpr, focusedType, place = {}) =>
  selectDataFactory(homeData, lensExpressionSubject, savedExprById, resolveExpr, focusedType,
    place.root ?? (() => undefined), place.scope ?? (() => ({ kind: "root" })), place.valueScope ?? (() => undefined), childItemKey,
    place.focusedExpressionController ?? (() => undefined));
const captureStart = source.indexOf("  function captureContainedOccurrence(");
const captureData = new Function("sessionEpoch", "rootSourceTicket", "root", "homeData", "savedExprById", "resolveExpr",
  "projectAuthoredExpression", "expressionEditOptions", "scopeKey", "displayNameItemFields",
  "scope = () => ({ kind: 'root' })", "props = {}", "valueScopeLoading = () => false", "valueScope = () => undefined",
  "workspaceSourceKey = () => undefined", "client = {}", "enterScopeFor = () => undefined", "setLensMode = () => {}", "navigateScope = () => {}",
  `${transpiler.transformSync(source.slice(captureStart, source.indexOf("  function openContainedMenu(", captureStart)))}; return captureContainedOccurrence;`);
const metadataSource = await readFile(new URL("./reader-source-metadata.ts", import.meta.url), "utf8");
const metadataFrom = metadataSource.indexOf("export function assertReaderSourceMetadata(");
const metadataTo = metadataSource.indexOf("/** A frame overlay", metadataFrom);
if (metadataFrom < 0 || metadataTo < 0) throw new Error("Reader source assertion boundary moved");
const { assertReaderSourceMetadata, captureReaderSourceMetadata } = new Function("concreteAuthoringSession",
  `${transpiler.transformSync(metadataSource.slice(metadataFrom, metadataTo)).replaceAll("export ", "")}; return { assertReaderSourceMetadata, captureReaderSourceMetadata };`)
  (session => session);
const graphSource = await readFile(new URL("./dependency-graph-dialog.tsx", import.meta.url), "utf8");
const graphFrom = graphSource.indexOf("function localSourceDependencyGraph(");
const graphTo = graphSource.indexOf("/** SVG/DOM geometry", graphFrom);
if (graphFrom < 0 || graphTo < 0) throw new Error("Local dependency query lifetime boundary moved");
const installLocalDependency = new Function("assertReaderSourceMetadata", "evaluateExpressionInWorker", "runAuthoringWorker", "readLensPolicy", "draftValueFingerprint",
  `${transpiler.transformSync(graphSource.slice(graphFrom, graphTo))}; return localSourceDependencyGraph;`);

test("Home keeps the actual reader session fence while recapturing its metadata for each evaluation", () => {
  const from = source.indexOf("  const sourceSession = reader ? createMemo(");
  const to = source.indexOf("  const captureSourceTicket", from);
  const installSession = new Function("reader", "createMemo", "reactiveAuthoringSession", "homeAuthoringSession",
    `${transpiler.transformSync(source.slice(from, to))}; return authoringSession;`);
  const facades = new WeakMap();
  const registrations = [];
  const facade = (getBase, captureSourceMetadata) => {
    const value = { captureSourceMetadata };
    facades.set(value, getBase); registrations.push(value); return value;
  };
  let dispose;
  createRoot(stop => {
    dispose = stop;
    const first = Object.freeze({ id: "first" }), next = Object.freeze({ id: "next" });
    const [base, setBase] = createSignal(first);
    const state = { capture: { session: first, packet: { version: 1 } } };
    const reader = { session: base, captureSourceMetadata: () => state.capture };
    const current = installSession(reader, createMemo, facade, () => { throw new Error("No global source fallback"); });
    const selected = current();
    expect(facades.get(selected)()).toBe(first);
    expect(selected.captureSourceMetadata()).toBe(state.capture);
    state.capture = { session: first, packet: { version: 2 } };
    expect(current()).toBe(selected);
    expect(selected.captureSourceMetadata().packet.version).toBe(2);
    setBase(next); flush();
    const replaced = current();
    expect(replaced).not.toBe(selected);
    expect(facades.get(selected)()).toBe(first);
    expect(facades.get(replaced)()).toBe(next);
    expect(replaced.captureSourceMetadata()).toBeUndefined();
    state.capture = { session: next, packet: { version: 3 } };
    expect(replaced.captureSourceMetadata()).toBe(state.capture);
    expect(selected.captureSourceMetadata()).toBeUndefined();
    expect(registrations).toHaveLength(2);
  });
  dispose();
});

describe("Home dependency source capture", () => {
  const from = source.indexOf("  function dependencyData(item: LayoutItem, sourceReference: string | undefined, lens: { latest?: object })");
  const to = source.indexOf("  // A retained reference selects its admitted binding", from);
  if (from < 0 || to < 0) throw new Error("Home dependency capture boundary moved");
  const installDependency = new Function("homeAuthoringSession", "captureReaderSourceMetadata", "sessionEpoch",
    "draftValueFingerprint", "scope", "rootSourceTicket", "client", "createSourceDependencyGraphData", "createModalCtx",
    "setToolbarError", "setGraphProjection", "setGraphItem", "setGraphCapture",
    `${transpiler.transformSync(source.slice(from, to))}; return { dependencyData };`);

  function fixture() {
    const state = { session: {}, epoch: 7, scope: { kind: "root" }, ticket: {}, active: true, signal: new AbortController() };
    const packet = { source: { $tag: "LocalSource" }, rootId: "source-owned-root" };
    const capture = { session: state.session, packet, generationToken: {}, current: () => state.active };
    const calls = [], composed = [], issues = [], projections = [], items = [], captures = [];
    let queryIssue;
    const methods = installDependency(() => state.session, () => state.capture === false ? undefined : capture, () => state.epoch,
      JSON.stringify, () => state.scope, () => state.ticket, { signal: state.signal.signal },
      (...args) => { calls.push(args); if (queryIssue) throw new Error(queryIssue); return { source: args[2] }; },
      { composeSuggestion: node => composed.push(node) }, message => issues.push(message),
      value => projections.push(value), item => items.push(item), value => captures.push(value));
    return { state, packet, capture, calls, composed, issues, projections, items, captures, ...methods, fail: message => { queryIssue = message; } };
  }

  test("only the locator and actual source capture enter the existing closed-query owner", () => {
    const h = fixture(), item = { id: "actual-occurrence", source: { kind: "ref", ref: { id: "must-not-replace-occurrence" } } };
    const data = h.dependencyData(item, undefined, {});
    expect(h.calls[0][0]).toBe(h.state.session);
    expect(h.calls[0][1]).toEqual({ $tag: "DependencySourceLocator", source: h.packet.source,
      rootId: "source-owned-root", occurrenceId: item.id });
    expect(h.calls[0][2].packet).toBe(h.packet);
    expect(h.calls[0][2].generationToken).toBe(h.capture.generationToken);
    expect(data.capture).toBe(h.calls[0][2]);
    expect(data.capture).not.toBe(h.capture);
    const query = { kind: "call", fnId: "canonical-composed-query", args: [] };
    h.calls[0][3](query);
    expect(h.composed).toEqual([query]);
  });

  test("a retained source reference is forwarded to the same captured query owner", () => {
    const h = fixture();
    h.dependencyData({ id: "containing-card" }, "retained-binding", {});
    expect(h.calls[0][1].occurrenceId).toBe("containing-card");
    expect(h.calls[0][2].packet).toBe(h.packet);
    expect(h.calls[0][6]).toBe("retained-binding");
  });

  test("the lens graph of item B stays current while the committed focus outside the move still reads A", () => {
    // Seen in the build: open A, Dependencies, Go up, open B. The lens memo
    // asks B's graph inside the move's transition; the worker answer checks
    // currentness from outside it, where scope() still reads the previous
    // focus, and B's graph was refused for good. The lens owner instead
    // ties the capture to the latest graph the lens asked for.
    const h = fixture(), owner = {};
    h.state.scope = { kind: "value", viewId: "root", itemId: "b", path: [] };
    h.dependencyData({ id: "b" }, undefined, owner);
    const first = h.calls[0][2];
    h.state.scope = { kind: "root" };
    expect(first.current()).toBe(true);
    // A newer graph of the same lens retires the older one.
    h.dependencyData({ id: "c" }, undefined, owner);
    expect(first.current()).toBe(false);
    expect(h.calls[1][2].current()).toBe(true);
    // Leaving every data card (guidance) retires the lens graph too.
    owner.latest = undefined;
    expect(h.calls[1][2].current()).toBe(false);
    // The reader still owns its capture: a closed reader, a new epoch or an abort refuse.
    for (const change of [{ epoch: 8 }, { active: false }]) {
      const again = fixture(), lens = {}; again.dependencyData({ id: "b" }, undefined, lens);
      Object.assign(again.state, change);
      expect(again.calls[0][2].current()).toBe(false);
    }
    const aborted = fixture(), lens = {}; aborted.dependencyData({ id: "b" }, undefined, lens); aborted.state.signal.abort();
    expect(aborted.calls[0][2].current()).toBe(false);
  });

  test("unavailable source metadata and query refusal reach the panel without guessing another target", () => {
    const missing = fixture();
    missing.state.capture = false;
    expect(() => missing.dependencyData({ id: "root-synthetic" }, undefined, {})).toThrow("current source");
    expect(missing.calls).toEqual([]);
    const absent = fixture(); absent.fail("That occurrence is absent from this source.");
    expect(() => absent.dependencyData({ id: "$inspect:child" }, undefined, {})).toThrow("That occurrence is absent from this source.");
    expect(absent.calls[0][1].occurrenceId).toBe("$inspect:child");
  });

  function deferred() {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
  }

  // Actual Home capture/open/effect + actual Local asynchronous graph owner.
  // Worker promises and the already-decoded declaration reply are controlled;
  // no registry, graph policy, worker, app server or browser is started.
  function asyncGraphFixture() {
    let fixture;
    createRoot(dispose => {
      const [changed, setChanged] = createSignal(0);
      const [projection, setProjection] = createSignal();
      const [item, setItem] = createSignal();
      const [ownedCapture, setOwnedCapture] = createSignal();
      const state = { session: {}, epoch: 7, scope: { kind: "root" }, ticket: {}, active: true,
        signal: new AbortController(), closed: false, capture: undefined, lens: {} };
      const observe = value => { changed(); return value; };
      const makeCapture = (session, generationToken = {}) => ({ session, generationToken,
        packet: { source: { $tag: "LocalSource" }, rootId: "actual-root", generation: "generation" },
        current: () => observe(state.active && !state.closed && state.capture?.generationToken === generationToken) });
      const attachSession = session => Object.assign(session, { captureSourceMetadata: () => {
        changed(); if (state.closed) throw new Error("Source closed"); return state.capture;
      } });
      state.session = attachSession(state.session);
      state.capture = makeCapture(state.session);
      const evaluation = deferred(), declaration = deferred();
      const requests = [], retired = [], issues = [];
      const local = installLocalDependency(assertReaderSourceMetadata,
        (...args) => { requests.push(["evaluation", args]); return evaluation.promise; },
        (...args) => { requests.push(["declaration", args]); return declaration.promise; },
        reply => reply, JSON.stringify);
      const captureSetter = value => { if (!value) retired.push("capture"); setOwnedCapture(value); };
      const projectionSetter = value => { if (!value) retired.push("projection"); setProjection(value); };
      const itemSetter = value => { if (!value) retired.push("item"); setItem(value); };
      const session = () => observe(state.session);
      const methods = installDependency(session, captureReaderSourceMetadata, () => observe(state.epoch),
        JSON.stringify, () => observe(state.scope), () => observe(state.ticket), { signal: state.signal.signal },
        (reader, locator, capture, select, issue, links = 2) => local(reader, locator, capture, "view:dependencyQueryLinked",
          { quantified: [], body: { $ref: "ResultGraph" } }, select, issue, links),
        { composeSuggestion() {} }, message => issues.push(message));
      fixture = { state, evaluation, declaration, requests, retired, issues, projection, item, ownedCapture, dispose,
        // The lens panel's ask, as `lensDependencies` makes it.
        open: () => {
          const data = methods.dependencyData({ id: "actual-card" }, undefined, state.lens);
          captureSetter(data.capture); projectionSetter(data.projection); itemSetter({ id: "actual-card" });
          flush(); return projection();
        },
        invalidate(kind) {
          if (kind === "generation") state.capture = makeCapture(state.session);
          else if (kind === "missing") state.capture = undefined;
          else if (kind === "session") {
            state.session = attachSession({});
            state.capture = makeCapture(state.session, state.capture.generationToken);
            state.lens.latest = {};
          } else if (kind === "epoch") state.epoch++;
          // A new focus, ticket or session makes the lens memo ask again.
          else if (kind === "focus") { state.scope = { kind: "value", itemId: "other", path: [] }; state.lens.latest = {}; }
          else if (kind === "ticket") { state.ticket = {}; state.lens.latest = {}; }
          else if (kind === "abort") state.signal.abort();
          else if (kind === "closed") state.closed = true;
          else if (kind === "frame") state.active = false;
          else throw new Error("Unknown graph invalidation control");
          setChanged(value => value + 1); flush();
        },
      };
    });
    return fixture;
  }

  test("Home retains an actual pending Local graph until success while result capture still refuses", async () => {
    const h = asyncGraphFixture();
    try {
      const projection = h.open();
      expect(h.item()?.id).toBe("actual-card");
      expect(h.retired).toEqual([]);
      expect(h.ownedCapture()).toBe(h.requests[0][1][5].sourceMetadata);
      expect(() => projection.source.capture()).toThrow("still preparing");
      expect(h.requests.map(([kind]) => kind)).toEqual(["evaluation", "declaration"]);
      const graph = { $tag: "DependencyGraph", focus: "actual-card", nodes: [], edges: [], scope: "actual source" };
      h.evaluation.resolve({ result: { $tag: "Ok", _0: graph } });
      h.declaration.resolve({ $tag: "Ok", _0: { declarationId: "view.DependencyGraph" } });
      const settled = await projection.local.read;
      flush();
      expect(settled.value).toBe(graph);
      expect(h.projection()).toBe(projection);
      expect(h.item()?.id).toBe("actual-card");
      expect(h.retired).toEqual([]);
      expect(projection.source.capture().input.value).toBe(graph);
      expect(projection.source.capture().current()).toBe(true);
    } finally { h.dispose(); }
  });

  test("Home retains an actual Local query failure so the existing panel can show its error", async () => {
    const h = asyncGraphFixture();
    try {
      const projection = h.open();
      expect(() => projection.source.capture()).toThrow("still preparing");
      h.evaluation.reject(new Error("Dependency query failed"));
      h.declaration.resolve({ $tag: "Ok", _0: { declarationId: "view.DependencyGraph" } });
      await expect(projection.local.read).rejects.toThrow("Dependency query failed");
      flush();
      expect(h.projection()).toBe(projection);
      expect(h.item()?.id).toBe("actual-card");
      expect(h.retired).toEqual([]);
      expect(() => projection.source.capture()).toThrow("still preparing");
    } finally { h.dispose(); }
  });

  test("pending Local graphs refuse a late answer on source, reader, generation, focus, ticket or abort changes", async () => {
    for (const kind of ["generation", "missing", "session", "epoch", "focus", "ticket", "abort", "closed", "frame"]) {
      const h = asyncGraphFixture();
      try {
        const projection = h.open();
        expect(h.item()?.id).toBe("actual-card");
        h.invalidate(kind);
        h.evaluation.resolve({ result: { $tag: "Ok", _0: { $tag: "DependencyGraph" } } });
        h.declaration.resolve({ $tag: "Ok", _0: { declarationId: "view.DependencyGraph" } });
        await expect(projection.local.read).rejects.toThrow("no longer belongs");
        expect(() => projection.source.capture()).toThrow("no longer belongs");
      } finally { h.dispose(); }
    }
  });

  test("focused dependencies keep the real card, centre authored children and guide aggregate or held scopes", () => {
    const from = source.indexOf("  const lensDependencies = createMemo(");
    const install = new Function("createMemo", "scope", "props", "dependencyData", "root", "findLocusItem",
      "resolveExpr", "savedExprById", "projectAuthoredExpression", "expressionEditOptions", "sourceExecutableSlots", "displayNameText",
      `${transpiler.transformSync(source.slice(from, source.indexOf("  function openContextMenu", from)))}; return lensDependencies;`);
    const calls = [], projection = {}, expression = {}, childSource = {}, saved = new Map();
    const card = { id: "actual-card", caption: "Transaction" };
    const state = { scope: { kind: "value", viewId: "list", itemId: card.id, path: [] }, held: undefined,
      authored: { sourcePath: [], source: childSource } };
    const read = install(fn => fn, () => state.scope, { pane: { subject: () => state.held } },
      item => { calls.push(item); return { projection }; },
      () => ({ items: [card], lists: [{ id: "list", view: { items: [card] } }] }),
      (items, id) => items.find(item => item.id === id),
      (item, references) => { expect(item).toBe(card); expect(references).toBe(saved); return expression; },
      () => saved, (source, path) => { expect(source).toBe(expression); expect(path).toEqual(state.scope.path); return state.authored; },
      () => ({}), source => { expect(source).toBe(childSource); return [{ $tag: "SourceCall", identity: "date-constructor" },
        { $tag: "SourceLiteral" }, { $tag: "SourceCodeReference", identity: "std-add" }, { $tag: "SourceReference", identity: "live-person" }, { $tag: "SourceReference", identity: "live-person" }]; },
      caption => caption);
    expect(read()).toEqual({ projection }); expect(calls).toEqual([{ id: card.id }]);
    state.scope = { ...state.scope, path: [0] };
    expect(read()).toEqual({ projection, centre: ["live-person", "std-add", "date-constructor"], containedIn: "Transaction" });
    state.scope = { ...state.scope, rootItem: true };
    state.authored = { sourcePath: [0], source: childSource };
    expect(read()).toEqual({ projection, centre: [], containedIn: "Transaction" });
    state.scope = { kind: "root" };
    expect(read()).toEqual({ guidance: "Open a data card to inspect its dependencies." });
    state.scope = { kind: "view", viewId: "list" };
    expect(read()).toEqual({ guidance: "Open a data card to inspect its dependencies." });
    state.scope = { kind: "value", viewId: "list", itemId: card.id, path: [] }; state.held = {};
    expect(read()).toEqual({ guidance: "Open a data card to inspect its dependencies." });
    expect(calls).toEqual([{ id: card.id }, { id: card.id }, { id: card.id }]);
  });
});

describe("contained data event source marshalling", () => {
  function fixture() {
    const state = { epoch: 7, ticket: {}, revision: 3 };
    const projections = [];
    const capture = captureData(() => state.epoch, () => state.ticket, () => ({ revision: state.revision }),
      { evaluated: () => undefined }, () => new Map(), item => item.source?.expr,
      (source, path) => { projections.push({ source, path }); return { source, sourcePath: path }; }, () => ({}), JSON.stringify, displayNameItemFields);
    return { state, projections, capture };
  }
  const type = { $ref: "String" };
  const child = { value: "selected", label: "Context label", path: [1, "city"], getType: () => type };

  test("a saved parent remains a live reference and retains numeric and named path steps", () => {
    const h = fixture();
    const source = { kind: "call", fnId: "prior-parent-body", args: [] };
    const occurrence = h.capture({ id: "parent", caption: "Parent name", source: { kind: "ref", ref: { id: "saved-parent" } } }, child,
      { value: "parent observation", source, sourcePath: ["outer"] });
    expect(h.projections).toEqual([{ source: { kind: "ref", savedExprId: "saved-parent" }, path: ["outer", 1, "city"] }]);
    expect(occurrence.item.caption).toBeUndefined();
    expect(occurrence.item.valueType).toBe(type);
    expect(occurrence.evaluated.value).toBe("selected");
    expect(occurrence.current()).toBe(true);
  });

  test("missing provenance stays unresolved instead of freezing its observed data as a literal", () => {
    const h = fixture();
    const occurrence = h.capture({ id: "parent" }, child, { value: ["observed parent"] });
    expect(h.projections).toEqual([]);
    expect(occurrence.item.source).toBeUndefined();
    expect(occurrence.evaluated.source).toBeUndefined();
    expect(occurrence.evaluated.sourcePath).toEqual([1, "city"]);
  });

  test("the captured event retires on a changed source frame, epoch or root revision", () => {
    for (const change of [{ epoch: 8 }, { revision: 4 }, { ticket: {} }]) {
      const h = fixture();
      const occurrence = h.capture({ id: "parent" }, child);
      Object.assign(h.state, change);
      expect(occurrence.current()).toBe(false);
    }
  });
});

describe("contained data menu navigation", () => {
  const enterStart = source.indexOf("  function enterScopeFor(");
  const enterEnd = source.indexOf("  // ---- writing back", enterStart);
  const menuStart = source.indexOf("  function contextItems(menu: MenuTarget)");
  const menuEnd = source.indexOf("    const into = item ? enterScopeFor(item) : undefined;", menuStart);
  if (enterStart < 0 || enterEnd < 0 || menuStart < 0 || menuEnd < 0) throw new Error("Contained navigation boundaries moved");
  const installEnter = new Function("scope", "homes", "root", "homeData", "resolveExpr", "savedExprById", "readLocusCardResult",
    "transferSession", "isReferenceValue", "followLocusPath", "resolveCatalogReference", "isEnterable", "childItemKey",
    "valueScope", "scopeSubject", "isPlacedValue",
    `${transpiler.transformSync(source.slice(enterStart, enterEnd))}; return enterScopeFor;`);
  const installMenu = new Function("itemFunction", "savedExprById", "homeAuthoringSession", "reader", "homeData", "openInspection",
    "locusOpenMenuItems", "startMenuDataSuggestions", "contextDataSuggestionItems", "setCalling",
    `${transpiler.transformSync(source.slice(menuStart, menuEnd) + "return [];\n  }")}; return contextItems;`);

  function fixture({ parentId = "f.writing", childPath = ["greekAlphabet"], focusPath = [] } = {}) {
    const alphabet = [{ glyph: "Α" }, { glyph: "Β" }], writing = { greekAlphabet: alphabet };
    const container = parentId === "i#1" ? ["first", writing] : { writing };
    const ticket = {}, controller = new AbortController();
    const focus = { kind: "value", viewId: "root", itemId: "Encyclopedia", path: focusPath, rootItem: true };
    const state = { epoch: 7, revision: 3, ticket, focus, loading: false, subject: undefined, source: "public",
      focused: { ok: true, container, sourceTicket: ticket, rootRevision: 3 } };
    const value = parentId === "$self" ? container : writing;
    const parent = { id: parentId, source: { kind: "expr", expr: { kind: "literal", value } } };
    const rendered = { value, source: parent.source.expr, sourcePath: ["retained-producer-path"] };
    const moves = [], modes = [], inspections = [], enters = [];
    const homeData = { evaluated: item => item === parent ? rendered : undefined,
      enter: (...args) => enters.push(args) };
    const root = () => ({ id: "root", revision: state.revision });
    const scope = () => state.focus, valueScope = () => state.focused;
    const enter = installEnter(scope, () => [], root, homeData, item => item.source?.expr, () => new Map(),
      () => { throw new Error("Navigation must use the captured observation"); }, () => ({}),
      isReferenceValue, followLocusPath, () => undefined, isEnterable, childItemKey, valueScope,
      () => ({ row: { view: { kind: "table" } } }), () => false);
    const capture = captureData(() => state.epoch, () => state.ticket, root, homeData, () => new Map(), item => item.source?.expr,
      (source, path) => ({ source, sourcePath: path }), () => ({}), locusScopeKey, displayNameItemFields,
      scope, { pane: { source: () => state.source, subject: () => state.subject } }, () => state.loading, valueScope,
      source => source, { signal: controller.signal }, enter, mode => modes.push(mode), next => moves.push(next));
    const occurrence = capture(parent, { value: alphabet, label: "Greek alphabet", path: childPath, getType: () => undefined }, rendered);
    const contextItems = installMenu(() => undefined, () => new Map(), () => ({}), undefined, homeData,
      (...args) => inspections.push(args), locusOpenMenuItems, () => {}, () => [], () => {});
    const open = () => contextItems({ item: occurrence.item, occurrence }).find(item => item.id === "open");
    return { state, parent, rendered, occurrence, moves, modes, inspections, enters, open, enter, controller };
  }

  test("a compact child opens its actual parent path rather than its temporary inspector id", () => {
    const h = fixture();
    expect(h.occurrence.item.id.startsWith("$inspect:")).toBe(true);
    expect(h.enter(h.occurrence.item, h.occurrence.evaluated)).toBeUndefined();
    h.open().onSelect();
    expect(h.moves).toEqual([{ ...h.state.focus, path: ["writing", "greekAlphabet"] }]);
    expect(h.modes).toEqual([]);
    expect(h.inspections).toEqual([]);
    expect(h.enters).toEqual([]);
  });

  test("each explicit panel choice navigates to the same contained occurrence", () => {
    for (const mode of ["data", "expression", "code", "both"]) {
      const h = fixture();
      h.open().children.find(item => item.id === `open-${mode}`).onSelect();
      expect(h.moves).toEqual([{ ...h.state.focus, path: ["writing", "greekAlphabet"] }]);
      expect(h.modes).toEqual([mode]);
      expect(h.inspections).toEqual([]);
    }
  });

  test("focused and numeric parents retain their existing route and numeric path steps", () => {
    const focused = fixture({ parentId: "$self", childPath: ["writing", "greekAlphabet"], focusPath: ["section"] });
    focused.open().onSelect();
    expect(focused.moves).toEqual([{ ...focused.state.focus, path: ["section", "writing", "greekAlphabet"] }]);
    const indexed = fixture({ parentId: "i#1", childPath: ["greekAlphabet", 0] });
    indexed.open().onSelect();
    expect(indexed.moves).toEqual([{ ...indexed.state.focus, path: [1, "greekAlphabet", 0] }]);
  });

  test("stale captures refuse both navigation and panel changes", () => {
    const retirements = [
      h => { h.state.epoch++; }, h => { h.state.revision++; }, h => { h.state.ticket = {}; },
      h => { h.state.focus = { ...h.state.focus, path: ["elsewhere"] }; },
      h => { h.state.source = "replacement"; }, h => { h.state.subject = {}; }, h => { h.state.loading = true; },
      h => { h.state.focused = { ...h.state.focused, container: {} }; },
      h => { h.state.focused = { ...h.state.focused, sourceTicket: {} }; },
      h => { h.state.focused = { ...h.state.focused, rootRevision: 4 }; }, h => { h.controller.abort(); },
    ];
    for (const retire of retirements) {
      const h = fixture(), actions = [h.open(), ...h.open().children];
      retire(h);
      for (const action of actions) action.onSelect();
      expect(h.moves).toEqual([]);
      expect(h.modes).toEqual([]);
      expect(h.inspections).toEqual([]);
      expect(h.enters).toEqual([]);
    }
  });

  test("a contained occurrence without a real parent destination cannot change the enclosing panel", () => {
    const h = fixture({ parentId: "$inspect:unaddressed-parent" });
    expect(h.occurrence.openContained).toBeUndefined();
    for (const action of [h.open(), ...h.open().children]) action.onSelect();
    expect(h.moves).toEqual([]);
    expect(h.modes).toEqual([]);
    expect(h.inspections).toEqual([]);
    expect(h.enters).toEqual([]);
  });
});

describe("clicked authored child source capture", () => {
  const childType = { $ref: "String" };
  const expression = { kind: "literal", value: "Paris" };
  const child = { id: "$inspect:record:city", valueType: childType, source: { kind: "expr", expr: expression } };
  const selected = selectData({ type: item => item.valueType, evaluated() { throw new Error("The child must not look up its parent"); } },
    () => { throw new Error("The child must not become the focused subject"); }, () => new Map(),
    item => item.source?.expr, () => ({ $ref: "ParentRecord" }));

  test("an inspected child keeps its own exact authored source, observed value and type", () => {
    const occurrence = { item: child, evaluated: { value: "Paris", source: expression, sourcePath: [] }, current: () => true };
    const result = selected(child, occurrence);
    expect(result.expression).toBe(expression);
    expect(result.type).toBe(childType);
    expect(result.value).toBe("Paris");
  });

  test("replaced or cross-target child captures refuse instead of suggesting for a parent", () => {
    expect(() => selected(child, { item: child, evaluated: { value: "Paris" }, current: () => false })).toThrow("This data changed");
    expect(() => selected(child, { item: { ...child, id: "another-child" }, evaluated: { value: "Paris" }, current: () => true })).toThrow("This data changed");
  });
});

describe("Suggestions read a card through its own reference (demo 1, live derived data)", () => {
  const rows = { kind: "literal", value: { __list: [{ kind: "literal", value: 1 }, { kind: "literal", value: 2 }] } };
  const card = { id: "transactions", valueType: { $ref: "Rows" }, source: { kind: "expr", expr: rows } };
  const root = ({ published = true, canEdit = true } = {}) => () => ({ id: "tab", referenceId: "tab", canEdit, items: [card],
    expressions: published ? { "tab:transactions": rows } : {} });
  const homeData = { type: item => item.valueType, evaluated: () => undefined };
  const subject = { item: { id: "$self", valueType: { $ref: "Rows" }, source: { kind: "expr", expr: rows } }, evaluated: { value: [1, 2], source: rows, sourcePath: [] } };
  const focused = { kind: "value", viewId: "tab", itemId: "transactions", path: [], rootItem: true };
  const both = ["CreateDerivedData", "ApplyToDraft"];

  test("a root card is checked as its authored copy and read by reference for new data (B4)", () => {
    const selected = selectData(homeData, () => undefined, () => new Map(), item => item.source?.expr, () => undefined, { root: root() });
    const result = selected(card);
    expect(result.expression).toBe(rows);
    expect(result.reference).toEqual({ kind: "ref", savedExprId: "tab:transactions" });
    expect(result.type).toEqual({ $ref: "Rows" });
    expect(result.dispositions).toEqual(both);
  });

  test("an unpublished card or a read-only root keeps the authored copy only (B2)", () => {
    for (const place of [{ published: false }, { canEdit: false }]) {
      const selected = selectData(homeData, () => undefined, () => new Map(), item => item.source?.expr, () => undefined, { root: root(place) });
      const result = selected(card);
      expect(result.expression).toBe(rows);
      expect(result.reference).toBeUndefined();
      if (place.canEdit === false) expect(result.dispositions).toEqual(["CreateDerivedData"]);
    }
    const saved = { ...card, source: { kind: "ref", ref: { id: "saved-rows" } } };
    const linked = selectData(homeData, () => undefined, () => new Map([["saved-rows", rows]]), () => rows, () => undefined, { root: root() });
    expect(linked(saved).expression).toBe(rows);
    expect(linked(saved).reference).toEqual({ kind: "ref", savedExprId: "saved-rows" });
  });

  test("the focused card's own value is read by reference and may be rewritten in place; cards inside it stay copies (B5)", () => {
    const valueScope = () => ({ ok: true, followedReference: false });
    const place = { root: root(), scope: () => focused, valueScope };
    const lens = selectData(homeData, () => subject, () => new Map(), item => item.source?.expr, () => ({ $ref: "Rows" }), place);
    expect(lens().expression).toBe(rows);
    expect(lens().reference).toEqual({ kind: "ref", savedExprId: "tab:transactions" });
    expect(lens().dispositions).toEqual(both);
    // The lens subject itself stays the authored copy (B3): only the Suggestions input changes.
    expect(subject.item.source.expr).toBe(rows);
    const child = { id: "i#1", valueType: { $ref: "Row" }, source: { kind: "expr", expr: { kind: "literal", value: 2 } } };
    const inner = selectData({ type: item => item.valueType, evaluated: () => ({ value: 2, source: child.source.expr, sourcePath: [] }) },
      () => subject, () => new Map(), item => item.source?.expr, () => ({ $ref: "Rows" }), place);
    expect(inner(child).expression).toEqual(child.source.expr);
    expect(inner(child).reference).toBeUndefined();
    expect(inner(child).dispositions).toEqual(["CreateDerivedData"]);
    const followed = selectData(homeData, () => subject, () => new Map(), item => item.source?.expr, () => ({ $ref: "Rows" }),
      { ...place, valueScope: () => ({ ok: true, followedReference: true }) });
    expect(followed().reference).toBeUndefined();
  });

  test("a value shown inside a card makes new data from its authored copy", () => {
    const capture = captureData(() => 7, () => undefined, root(), { evaluated: () => undefined }, () => new Map(), item => item.source?.expr,
      () => ({ source: { kind: "literal", value: 2 }, sourcePath: [] }), () => ({}), JSON.stringify, displayNameItemFields);
    const occurrence = capture(card, { value: 2, label: "Item 2", path: [1], getType: () => ({ $ref: "Row" }) });
    expect(occurrence.contained).toBe(true);
    expect(occurrence.item.source).toEqual({ kind: "expr", expr: { kind: "literal", value: 2 } });
    const selected = selectData(homeData, () => undefined, () => new Map(), item => item.source?.expr, () => undefined, { root: root() });
    const read = selected(occurrence.item, occurrence);
    expect(read.expression).toEqual({ kind: "literal", value: 2 });
    expect(read.reference).toBeUndefined();
    expect(read.dispositions).toEqual(["CreateDerivedData"]);
  });
});

describe("computed child source transport after canonical admission", () => {
  const expression = { kind: "call", fnId: "actual-cities-producer", args: [] };
  const sourcePath = [0, "city"];
  const type = { $ref: "String" };
  const child = { id: "$inspect:computed-city", valueType: type, source: { kind: "expr", expr: expression } };
  const forbidParentType = () => { throw new Error("The producer type must not be used as its child type"); };
  const selected = selectData({ type: forbidParentType, evaluated: () => undefined }, () => undefined,
    () => new Map(), item => item.source?.expr, () => undefined);

  test("a computed field retains its producer and complete numeric/named path", () => {
    const occurrence = { item: child, evaluated: { value: "Paris", source: expression, sourcePath }, current: () => true };
    const result = selected(child, occurrence);
    expect(result).toEqual({ expression, sourcePath, type, value: "Paris", dispositions: ["CreateDerivedData"] });
    expect(result.sourcePath).toBe(sourcePath);
  });

  test("an unknown selected type stays unknown for the canonical producer checker", () => {
    const unknown = { ...child, valueType: undefined };
    const result = selected(unknown, { item: unknown, evaluated: { value: "Paris", source: expression, sourcePath }, current: () => true });
    expect(result.expression).toBe(expression);
    expect(result.sourcePath).toBe(sourcePath);
    expect(result.type).toBeUndefined();
  });

  test("the shared Home capture never promotes a selected leaf declaration to the producer", () => {
    const from = source.indexOf("  function suggestionSourceForTarget(");
    const to = source.indexOf("  const dataOccurrence =", from);
    const install = new Function("client", "homeAuthoringSession", "sessionEpoch", "reader", "root", "rootSourceTicket",
      "draftValueFingerprint", "scope", "props", "workspaceSourceKey", "selectedSuggestionData", "savedExprById", "createModalCtx", "setToolbarError",
      `${transpiler.transformSync(source.slice(from, to))}; return suggestionSourceForTarget;`);
    const session = {}, ticket = {}, saved = new Map();
    const selectedData = { expression, type, sourcePath, value: "Paris" };
    const factory = install({ signal: new AbortController().signal }, () => session, () => 7, { revision: () => 3 }, () => ({ revision: 2 }),
      () => ticket, JSON.stringify, () => ({ kind: "root" }), {}, () => "reader", () => selectedData, () => saved,
      { composeSuggestion() {} }, () => {});
    const target = factory(() => child).capture();
    expect(target.input.expression).toBe(expression);
    expect(target.input.sourcePath).toBe(sourcePath);
    expect(target.input.type).toBe(type);
    expect(target.input.sourceType).toBeUndefined();
    expect(target.current()).toBe(true);
    selectedData.sourcePath = [1, "city"];
    expect(target.current()).toBe(false);
  });

  test("the inspection dialog transports the same residual path without a parent type fallback", () => {
    const dialog = source.indexOf("function ItemExpressionDialog(");
    const from = source.indexOf("  const suggestions = createDataInspectionSuggestions(", dialog);
    const to = source.indexOf("  createEffect(", from);
    const install = new Function("createDataInspectionSuggestions", "homeAuthoringSession", "sessionEpoch", "reader", "draftValueFingerprint",
      "props", "resolveExpr", "homeData", "createModal", "expressionState", "expressionController",
      `${transpiler.transformSync(source.slice(from, to))}; return suggestions;`);
    const controller = source.indexOf("function createInspectionExpressionController(");
    const draftFrom = source.indexOf("  const draft = () =>", controller);
    if (controller < 0 || draftFrom < 0) throw new Error("Inspection draft source owner moved");
    const acquireDraft = new Function("state", "original",
      `${transpiler.transformSync(source.slice(draftFrom, source.indexOf("\n", draftFrom)))}; return draft;`);
    for (const declared of [type, undefined]) {
      const session = {};
      const expressionState = { draft: () => undefined, savedDraft: () => undefined, sourceReadPending: () => false,
        sourceError: () => undefined, savedValue: () => undefined };
      const dialogProps = { item: { ...child, valueType: declared }, evaluated: { value: "Paris", source: expression, sourcePath }, savedExprById: new Map() };
      const expressionController = { sourceReadPending: expressionState.sourceReadPending, fn: () => undefined,
        dirty: () => false, draft: acquireDraft(expressionState, () => dialogProps.evaluated.source) };
      const capture = install(fn => fn, () => session, () => 7, { revision: () => 3 }, JSON.stringify,
        dialogProps,
        () => expression, { type: forbidParentType }, undefined, expressionState, expressionController);
      const selected = capture();
      expect(selected.input.expression).toBe(expression);
      expect(selected.input.sourcePath).toBe(sourcePath);
      expect(selected.input.type).toBe(declared);
      expect(selected.input.sourceType).toBeUndefined();
      expect(selected.current()).toBe(true);
    }
  });
});

function handoff(changes = {}) {
  const item = { id: "clicked", source: { kind: "expr", expr: { kind: "literal", value: "current" } } };
  const action = { kind: "suggest-data", itemId: item.id, scope: { kind: "root" }, source: "reader", epoch: 7,
    rootId: "root", revision: 3, position: { x: 210, y: 180 }, ...changes };
  const state = { root: { id: "root", revision: 3 }, row: { view: { items: [item] } }, focus: { kind: "root" }, epoch: 7, source: "reader" };
  const opened = [], lensOpened = [], menus = [], issues = [], captures = [];
  let apply;
  install(action, (_read, update) => { apply = update; }, () => state.root, () => state.row, () => state.focus, () => state.epoch,
    { pane: {} }, () => state.source, (items, id) => items.find(item => item.id === id), JSON.stringify,
    item => opened.push(item), menu => menus.push(menu), message => issues.push(message), () => ({ id: "current-view" }), { open: () => lensOpened.push(true) },
    () => ({ item, evaluated: { value: "focused-parent" } }), (parent, child, evaluated) => {
      const occurrence = { item: { id: "captured-child", valueType: child.getType() }, evaluated: { value: child.value }, current: () => true };
      captures.push({ parent, child, evaluated, occurrence }); return occurrence;
    });
  return { action, state, item, opened, lensOpened, menus, issues, captures, apply };
}

describe("early Suggestions prepared-owner admission", () => {
  test("Solid settles initial invalidation before opening the retained Suggestions intent", () => {
    const from = source.indexOf("  onSettled(() => props.pane?.registerSuggestions?.(lensSuggestions));");
    const lifecycle = new Function("initialSuggestions", "createEffect", "onSettled", "root", "scopeSubject", "scope", "sessionEpoch", "props",
      "workspaceSourceKey", "findLocusItem", "draftValueFingerprint", "openDataSuggestionsFor", "setContextMenu", "setToolbarError", "current",
      "reader", "scopeKey", "dataSuggestions", "lensSuggestions", "focusedExpressionState", transpiler.transformSync(source.slice(from, end)));
    const h = handoff(), events = [];
    let dispose;
    createRoot(stop => {
      dispose = stop;
      lifecycle(h.action, createEffect, onSettled, () => h.state.root, () => ({ row: h.state.row }),
        () => h.state.focus, () => h.state.epoch, { pane: { source: () => "reader", registerSuggestions() {} } }, value => value,
        (items, id) => items.find(item => item.id === id), JSON.stringify, () => events.push("query opened"), () => {}, () => {},
        () => ({ id: "current-view" }), undefined, JSON.stringify,
        { invalidate: () => events.push("menu invalidated") }, { invalidate: () => events.push("lens invalidated") },
        () => ({ draft: () => undefined, savedDraft: () => undefined, sourceReadPending: () => false, sourceError: () => undefined }));
    });
    flush();
    expect(events).toEqual(["menu invalidated", "lens invalidated", "query opened"]);
    dispose();
  });

  test("initial reader invalidation settles before the retained menu opens its query", () => {
    const from = source.indexOf("  onSettled(() => props.pane?.registerSuggestions?.(lensSuggestions));");
    const lifecycle = new Function("initialSuggestions", "createEffect", "onSettled", "root", "scopeSubject", "scope", "sessionEpoch", "props",
      "workspaceSourceKey", "findLocusItem", "draftValueFingerprint", "openDataSuggestionsFor", "setContextMenu", "setToolbarError", "current",
      "reader", "scopeKey", "dataSuggestions", "lensSuggestions", "focusedExpressionState", transpiler.transformSync(source.slice(from, end)));
    const h = handoff();
    const events = [];
    lifecycle(h.action, (read, update) => update(read()), register => register(), () => h.state.root, () => ({ row: h.state.row }),
      () => h.state.focus, () => h.state.epoch, { pane: { source: () => "reader", registerSuggestions() {} } }, value => value,
      (items, id) => items.find(item => item.id === id), JSON.stringify, () => events.push("query opened"), () => {}, () => {},
      () => ({ id: "current-view" }), undefined, JSON.stringify,
      { invalidate: () => events.push("menu invalidated") }, { invalidate: () => events.push("lens invalidated") },
      () => ({ draft: () => undefined, savedDraft: () => undefined, sourceReadPending: () => false, sourceError: () => undefined }));
    expect(events).toEqual(["menu invalidated", "lens invalidated", "query opened"]);
  });

  test("the admitted clicked occurrence opens the existing owner at the original position once", () => {
    const h = handoff();
    h.apply(h.state); h.apply(h.state);
    expect(h.opened).toEqual([h.item]);
    expect(h.menus).toEqual([{ x: 210, y: 180, epoch: 7, viewId: "current-view", focus: h.state.focus,
      source: "reader", item: h.item, element: null, suggestions: true }]);
    expect(h.issues).toEqual([]);
  });

  test("a focused subject uses the existing lens query rather than an early temporary card id", () => {
    const h = handoff({ itemId: undefined });
    h.apply(h.state);
    expect(h.opened).toEqual([]);
    expect(h.lensOpened).toEqual([true]);
    expect(h.menus[0].suggestionsLens).toBe(true);
  });

  test("an early child selection reopens its own source path through the admitted parent", () => {
    const selection = { value: "Selected city", path: [1, "city"], type: { $ref: "String" }, caption: "city" };
    const h = handoff({ selection }); h.apply(h.state);
    expect(h.captures).toHaveLength(1);
    expect(h.captures[0].parent).toBe(h.item);
    expect(h.captures[0].child.path).toEqual([1, "city"]);
    expect(h.captures[0].child.getType()).toBe(selection.type);
    expect(h.opened).toEqual([h.captures[0].occurrence.item]);
    expect(h.menus[0].occurrence).toBe(h.captures[0].occurrence);
    expect(h.lensOpened).toEqual([]);
  });

  test("a focused child selection uses that subject's existing producer observation", () => {
    const h = handoff({ itemId: undefined, selection: { value: "Selected city", path: ["city"], type: { $ref: "String" } } });
    h.apply(h.state);
    expect(h.captures[0].evaluated).toEqual({ value: "focused-parent" });
    expect(h.opened).toEqual([h.captures[0].occurrence.item]);
    expect(h.lensOpened).toEqual([]);
  });

  test("a graph source handoff retains its actual producer without resolving an arbitrary row id", () => {
    const producer = { kind: "call", fnId: "actual-graph-call", args: [] };
    const h = handoff({ itemId: undefined, producer, producerType: { $ref: "String" } });
    h.apply({ ...h.state, row: undefined });
    expect(h.opened[0].source).toEqual({ kind: "expr", expr: producer });
    expect(h.opened[0].valueType).toEqual({ $ref: "String" });
    expect(h.lensOpened).toEqual([]);
  });

  test("pending reads retain the intent until its own root and occurrence are available", () => {
    const h = handoff();
    h.apply({ ...h.state, root: undefined });
    h.apply({ ...h.state, row: undefined });
    expect(h.opened).toEqual([]);
    h.apply(h.state);
    expect(h.opened).toEqual([h.item]);
  });

  test("a focused source that is still preparing does not consume its retained query", () => {
    const focus = { kind: "value", viewId: "root", itemId: "clicked", path: [], rootItem: true };
    const h = handoff({ itemId: undefined, scope: focus });
    const current = { ...h.state, focus };
    h.apply(current);
    expect(h.lensOpened).toEqual([]);
    expect(h.issues).toEqual([]);
    h.apply({ ...current, subject: { item: h.item } });
    expect(h.lensOpened).toEqual([true]);
  });

  test.each([
    ["epoch", { epoch: 8 }], ["source", { source: "other-reader" }],
    ["root identity", { root: { id: "replacement", revision: 3 } }],
    ["root revision", { root: { id: "root", revision: 4 } }],
    ["focus", { focus: { kind: "view", viewId: "other" } }],
    ["missing occurrence", { row: { view: { items: [] } } }],
  ])("replacement %s refuses the late target without querying another datum", (_label, change) => {
    const h = handoff();
    h.apply({ ...h.state, ...change }); h.apply(h.state);
    expect(h.opened).toEqual([]);
    expect(h.menus).toEqual([]);
    expect(h.issues).toEqual(["This data changed. Open Suggestions again."]);
  });

  test("numeric indices and numeric field names remain distinct across handoff", () => {
    const h = handoff({ scope: { kind: "value", viewId: "root", itemId: "container", path: [1], rootItem: true } });
    h.apply({ ...h.state, focus: { ...h.action.scope, path: ["1"] } });
    expect(h.opened).toEqual([]);
  });

  test("pass-through and root-occurrence coordinates remain part of the captured focus", () => {
    for (const change of [{ rootItem: false }, { passThrough: [0] }]) {
      const h = handoff({ scope: { kind: "value", viewId: "root", itemId: "container", path: [1], rootItem: true } });
      h.apply({ ...h.state, focus: { ...h.action.scope, ...change } });
      expect(h.opened).toEqual([]);
    }
  });
});

// Demo 1 (2026-11-07) New data composer: the location warning reads the chosen
// destination (a Suggestions draft starts at the root), the element requirement
// is the type's own phrase (the Local root's element reads "Anything", never a
// raw $complement), and Close remains the modal's accessible button (review M3, M4).
test("the New data composer warns only without a destination, phrases its requirement and exposes Close", () => {
  const warning = source.indexOf("This location cannot contain new data.");
  const condition = source.slice(source.lastIndexOf("<Show when={", warning), warning);
  expect(condition).toContain("!destination() && !preparingScope()");
  expect(condition).not.toContain("initialCreation");
  const required = source.indexOf("required={destinationElementType()");
  expect(source.slice(required, source.indexOf("onUseInferred=", required))).toContain("typePhrase(destinationElementType()!)");
  const close = source.indexOf('aria-label={initialCreation ? "Close new data" : "Close"}');
  expect(close).toBeGreaterThan(0);
  expect(source.slice(source.lastIndexOf("<button", close), close)).toContain('class="btn home-composer-modal__head-close"');
  const closeButton = source.slice(close, source.indexOf("</button>", close));
  expect(closeButton).toContain('onClick={close}');
  expect(closeButton).toContain('aria-hidden="true"');
  expect(closeButton).toContain('name="x"');
});


// Demo 1 (2026-11-07) Slice 2: an action applied at once by its destination.
describe("Suggestions apply at once: Apply here or New data from this", () => {
  const from = source.indexOf("  async function applySuggestion(");
  const insertion = source.indexOf("  async function insertRootCardAfter(", from);
  const to = source.indexOf("\n  }\n", insertion) + 4;
  if (from < 0 || insertion < 0 || to <= insertion) throw new Error("Suggestions application/insertion owner moved");
  const install = (stubs) => new Function(...Object.keys(stubs), `${transpiler.transformSync(source.slice(from, to))}; return applySuggestion;`)(...Object.values(stubs));
  const harness = (overrides = {}) => {
    const calls = [], notices = [];
    const stubs = { editingDraftOpen: () => false, setToolbarError: message => calls.push({ error: message }),
      homeData: { canWrite: () => true, revision: () => 4, replace: async (...args) => calls.push({ replace: args }),
        saveInspection: async (...args) => { calls.push({ save: args }); return "data"; } },
      lensExpressionSubject: () => ({ item: { id: "$self" } }), focusedExpressionState: () => ({ saveOrigin: { origin: true } }),
      root: () => ({ id: "tab", canEdit: true }), createModalCtx: { composeSuggestion: (...args) => calls.push({ compose: args }) },
      genId: () => "new-card", changeRoot: async command => calls.push({ root: command }),
      openCreatedSuggestion: async (...args) => calls.push({ open: args }),
      resolveExpr: item => item.source?.expr, savedExprById: () => new Map(),
      setAppliedNotice: notice => { notices.push(notice); }, scope: () => ({ kind: "root" }), untrack: read => read(),
      setSuggestionApplyError: message => { if (message !== undefined) calls.push({ inline: message }); }, ...overrides };
    return { calls, notices, apply: install(stubs) };
  };
  const node = { kind: "call", fnId: "group", args: [{ kind: "ref", savedExprId: "tab:transactions" }] };
  const suggestion = { label: "Group by date" };

  test("New data from this appends the action's live expression at the root and opens it", async () => {
    const h = harness();
    await h.apply(node, suggestion, "CreateDerivedData", { id: "transactions" });
    const card = { id: "new-card", caption: "Group by date", source: { kind: "expr", expr: node } };
    expect(h.calls).toEqual([{ root: { kind: "append", item: card } }, { open: [node, card, { kind: "root", rootId: "tab" }] }]);
  });

  // Polish lane B (Rom, Nov 8, Q7): from a root card in view, the result card is
  // placed right after its source, nothing navigates, and it keeps the checked
  // result type (its caption reads as its result, not "Maybe").
  test("New data from a root card in view is placed right after it, without navigating, typed as its result", async () => {
    const resultType = { $ref: "Maybe" };
    const items = [{ id: "clipboard" }, { id: "transactions" }, { id: "notes" }];
    const h = harness({ root: () => ({ id: "tab", canEdit: true, items }) });
    await h.apply(node, { ...suggestion, resultScheme: { quantified: [], body: resultType } }, "CreateDerivedData", { id: "transactions" });
    const card = { id: "new-card", caption: "Group by date", source: { kind: "expr", expr: node }, valueType: resultType };
    expect(h.calls).toEqual([{ root: { kind: "batch", commands: [{ kind: "append", item: card },
      { kind: "reorder", itemIds: ["clipboard", "transactions", "new-card", "notes"] }] } }]);
    // The last card: a plain append, still without navigating; a generic result keeps no type.
    const last = harness({ root: () => ({ id: "tab", canEdit: true, items: items.slice(0, 2) }) });
    await last.apply(node, { ...suggestion, resultScheme: { quantified: ["a"], body: resultType } }, "CreateDerivedData", { id: "transactions" });
    expect(last.calls).toEqual([{ root: { kind: "append", item: { id: "new-card", caption: "Group by date", source: { kind: "expr", expr: node } } } }]);
    // Inside a lens the root list is not in view: appended and opened, as before.
    const inLens = harness({ root: () => ({ id: "tab", canEdit: true, items }), scope: () => ({ kind: "value" }) });
    await inLens.apply(node, suggestion, "CreateDerivedData", { id: "transactions" });
    expect(inLens.calls.map(call => Object.keys(call)[0])).toEqual(["root", "open"]);
  });

  test("Apply here rewrites the selected card, or the focused data, through the editor's save (S5)", async () => {
    const h = harness();
    const item = { id: "bonjour", valueType: { $ref: "String" } };
    await h.apply(node, suggestion, "ApplyToDraft", item);
    expect(h.calls).toEqual([{ save: [item, node, undefined, undefined] }]);
    const dialog = harness();
    await dialog.apply(node, suggestion, "ApplyToDraft", item, { dialog: true });
    expect(dialog.calls).toEqual([{ save: [item, node, undefined, { dialog: true }] }]);
    const lens = harness();
    await lens.apply(node, suggestion, "ApplyToDraft", undefined);
    expect(lens.calls).toEqual([{ save: [{ id: "$self" }, node, undefined, { origin: true }] }]);
  });

  test("an in-place apply offers Undo, which writes the previous authored expression back", async () => {
    const h = harness();
    const previous = { kind: "literal", value: "Bonjour" };
    const item = { id: "bonjour", source: { kind: "expr", expr: previous } };
    await h.apply(node, { label: "Reverse" }, "ApplyToDraft", item);
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0].message).toBe("Applied Reverse");
    await h.notices[0].undo();
    expect(h.calls).toEqual([{ save: [item, node, undefined, undefined] }, { save: [item, previous, undefined, undefined] }]);
    expect(h.notices.at(-1)).toBeUndefined();
  });

  test("a read-only root keeps the New data composer; a refused in-place write is reported", async () => {
    const h = harness({ root: () => ({ id: "account", canEdit: false }) });
    await h.apply(node, suggestion, "CreateDerivedData", undefined);
    expect(h.calls).toEqual([{ compose: [node, { evaluate: true }] }]);
    const refused = harness({ homeData: { saveInspection: async () => { throw new Error("This data is read-only here."); } } });
    await refused.apply(node, suggestion, "ApplyToDraft", { id: "x" });
    // Fix lane A (Nov 8): said next to the Suggestions too, not only in the bell.
    expect(refused.calls).toEqual([{ error: "This data is read-only here." }, { inline: "This data is read-only here." }]);
  });

  test("the Home capture carries the reference and its destinations and routes a destination to the apply port", () => {
    const capFrom = source.indexOf("  function suggestionSourceForTarget(");
    const capTo = source.indexOf("  const dataOccurrence =", capFrom);
    const installCapture = new Function("client", "homeAuthoringSession", "sessionEpoch", "reader", "root", "rootSourceTicket",
      "draftValueFingerprint", "scope", "props", "workspaceSourceKey", "selectedSuggestionData", "savedExprById", "createModalCtx", "setToolbarError",
      `${transpiler.transformSync(source.slice(capFrom, capTo))}; return suggestionSourceForTarget;`);
    const own = { kind: "literal", value: { __list: [] } };
    const reference = { kind: "ref", savedExprId: "tab:transactions" };
    const applied = [];
    const card = { id: "transactions" };
    const session = {};
    const factory = installCapture({ signal: new AbortController().signal }, () => session, () => 7, { revision: () => 3 }, () => ({ revision: 2 }),
      () => undefined, JSON.stringify, () => ({ kind: "root" }), {}, () => "reader",
      () => ({ expression: own, reference, type: { $ref: "Rows" }, dispositions: ["CreateDerivedData", "ApplyToDraft"] }), () => new Map(),
      { composeSuggestion() { throw Error("no composer"); }, applySuggestion: (...args) => applied.push(args) }, () => {});
    const captured = factory(() => card).capture();
    expect(captured.input.expression).toBe(own);
    expect(captured.input.reference).toBe(reference);
    expect(captured.input.dispositions).toBeUndefined();
    expect(captured.dispositions).toEqual(["CreateDerivedData", "ApplyToDraft"]);
    expect(captured.current()).toBe(true);
    captured.select(node, suggestion, { evaluate: true, disposition: "CreateDerivedData" });
    expect(applied).toEqual([[node, suggestion, "CreateDerivedData", card]]);
  });

  test("a Suggestions draft starts at the root of its subject (B1)", () => {
    const compose = source.slice(source.indexOf("    composeSuggestion: (node, options) => {"), source.indexOf("    applySuggestion: (node, suggestion"));
    expect(compose).toContain("setComposeAtRoot(true)");
    const creation = source.slice(source.indexOf("creation={composeExpression()"), source.indexOf("evaluateOnRequest={composeEvaluateOnRequest()}"));
    expect(creation).toContain("current: composeAtRoot() ? rootCreationDestination()");
    const from = source.indexOf("  function rootCreationDestination(");
    const destination = source.slice(from, source.indexOf("\n  }\n", from));
    expect(destination).toContain('kind: "root" as const');
    expect(destination).toContain("add: addToLocus");
  });
});

// Fix lane A (Nov 8, item 6 + 4a + Undo): an in-place write in a value scope
// replaces the expression AT the scope's path. After Reverse the opened list's
// source is `reverse(list)`; the next in-place apply (Sort ascending), the graph
// editor's Apply and Undo must still reach the write, while a computed
// container ABOVE the edited spot keeps refusing.
describe("an in-place write into a value scope (saveInspection's value branch)", async () => {
  const { editableContainerAt, replaceExpressionAt, expressionAt } = await import("./locus-expression-edit.ts");
  const save = source.indexOf("    async saveInspection(");
  const from = source.indexOf('      if (here.kind === "value") {', save);
  const to = source.indexOf("      if (!homeData.canEditExpression())", from);
  const canWriteFrom = source.indexOf("    canWrite: () => {");
  const canWriteTo = source.indexOf("    canArrange: () => {", canWriteFrom);
  const projectFrom = source.indexOf("function projectAuthoredExpression(");
  const projectTo = source.indexOf("\nfunction itemExpression(", projectFrom);
  if ([from, to, canWriteFrom, canWriteTo, projectFrom, projectTo].some(at => at < 0) || to <= from) throw new Error("saveInspection value branch moved");
  const install = new Function("valueScope", "valueScopeLoading", "scope", "root", "expressionEditOptions", "editableContainerAt",
    "replaceExpressionAt", "expressionAt", "writeValueScopeExpression", "checkDestination",
    transpiler.transformSync(`${source.slice(projectFrom, projectTo)}
      const homeData = { ${source.slice(canWriteFrom, canWriteTo)} };
      return async (here, expr, origin, sourceTicket) => {
${source.slice(from, to)}
        return "unreached";
      };`));
  const list = { kind: "literal", value: { __list: [{ kind: "literal", value: 2 }, { kind: "literal", value: 1 }] } };
  const reversed = { kind: "call", fnId: "reverse", args: [list] };
  const sorted = { kind: "call", fnId: "sortAsc", args: [reversed] };
  const run = async (sourceExpression, here, expr, { leaf = false, canEdit = true } = {}) => {
    const writes = [];
    const state = { ok: true, followedReference: false, leaf, sourceExpression };
    const write = install(() => state, () => false, () => here, () => ({ canEdit }), () => ({}), editableContainerAt,
      replaceExpressionAt, expressionAt, async (_state, rewritten) => { writes.push(rewritten); }, () => {});
    try { return { result: await write(here, expr, undefined, undefined), writes }; }
    catch (error) { return { error: error.message, writes }; }
  };
  const opened = { kind: "value", path: [] };

  test("a computed source (after Reverse) is replaced whole by the next in-place apply", async () => {
    expect(await run(reversed, opened, sorted)).toEqual({ result: "data", writes: [sorted] });
    // Undo writes the previous authored expression back through the same write.
    expect(await run(sorted, opened, reversed)).toEqual({ result: "data", writes: [reversed] });
    // A computed scalar (Bonjour after Uppercase) as well.
    const upper = { kind: "call", fnId: "uppercase", args: [{ kind: "literal", value: "Bonjour" }] };
    const twice = { kind: "call", fnId: "reverse", args: [upper] };
    expect(await run(upper, opened, twice, { leaf: true })).toEqual({ result: "data", writes: [twice] });
  });

  test("an authored source keeps writing at the scope's path", async () => {
    const record = { kind: "literal", value: { __record: { fields: [{ name: "items", value: reversed }] } } };
    const next = { kind: "call", fnId: "sortAsc", args: [reversed] };
    const { result, writes } = await run(record, { kind: "value", path: ["items"] }, next);
    expect(result).toBe("data");
    expect(writes).toEqual([{ kind: "literal", value: { __record: { fields: [{ name: "items", value: next }] } } }]);
  });

  test("a nested computed result saves its authored producer and preserves sibling sources", async () => {
    const sibling = { kind: "ref", savedExprId: "untouched-sibling" };
    const record = { kind: "literal", value: { __record: { fields: [
      { name: "items", value: reversed }, { name: "sibling", value: sibling },
    ] } } };
    const { result, writes } = await run(record, { kind: "value", path: ["items", 0] }, sorted);
    expect(result).toBe("data");
    expect(writes).toHaveLength(1);
    expect(expressionAt(writes[0], ["items"])).toBe(sorted);
    expect(expressionAt(writes[0], ["sibling"])).toBe(sibling);
    expect(expressionAt(record, ["items"])).toBe(reversed);
  });

  test("a computed root's descendant cannot replace its root producer implicitly", async () => {
    expect(await run(reversed, { kind: "value", path: [0] }, list)).toEqual({ error: "This data is read-only here.", writes: [] });
  });

  test("a reference and a read-only root still refuse", async () => {
    expect(await run(list, opened, sorted, { canEdit: false })).toEqual({ error: "This data is read-only here.", writes: [] });
    const followed = install(() => ({ ok: true, followedReference: true, leaf: false, sourceExpression: list }), () => false,
      () => opened, () => ({ canEdit: true }), () => ({}), editableContainerAt, replaceExpressionAt, expressionAt,
      async () => { throw new Error("must not write"); }, () => {});
    await expect(followed(opened, sorted)).rejects.toThrow("This data is read-only here.");
  });
});


describe("typed creation beside an existing card", async () => {
  const helpersFrom = source.indexOf("  function openComposerAt(");
  const helpersTo = source.indexOf("  async function copyFromMenu(", helpersFrom);
  const guardFrom = source.indexOf("  function menuIsCurrent(");
  const guardTo = source.indexOf("\n  }\n", guardFrom) + 4;
  const instantiateFrom = source.indexOf("    instantiateType:", source.indexOf("const createModalCtx"));
  const instantiateTo = source.indexOf("    instantiateValueType:", instantiateFrom);
  const typeRowsFrom = source.indexOf("        const typeRef = item && writable ? itemTypeReference(");
  const typeRowsTo = source.indexOf("\n      })(),", typeRowsFrom);
  if ([helpersFrom, helpersTo, guardFrom, instantiateFrom, instantiateTo, typeRowsFrom, typeRowsTo].some(at => at < 0))
    throw new Error("The typed creation menu owner moved");
  const quickSource = (await readFile(new URL("./locus-quick-value.tsx", import.meta.url), "utf8")).replace(/\r\n?/g, "\n");
  const quickFrom = quickSource.indexOf("export function quickValueShape(");
  const quickTo = quickSource.indexOf("/** Parse what was typed", quickFrom);
  if (quickFrom < 0 || quickTo < 0) throw new Error("The existing scalar quick-shape owner moved");
  const quickValueShape = new Function(`${transpiler.transformSync(quickSource.slice(quickFrom, quickTo).replace("export function", "function"))}; return quickValueShape;`)();
  const installCreation = new Function("env", `with (env) {
    ${transpiler.transformSync(source.slice(guardFrom, guardTo))}
    ${transpiler.transformSync(`const createModalCtx = { ${source.slice(instantiateFrom, instantiateTo)} };`)}
    ${transpiler.transformSync(source.slice(helpersFrom, helpersTo))}
    return { creationCardAnchor, creationPlacement, openNewAt, openComposerAt, menuIsCurrent, creationMenuIsCurrent, createModalCtx };
  }`);
  const installTypeRows = new Function("env", `with (env) {
    ${transpiler.transformSync(`function typedCreationRows() { ${source.slice(typeRowsFrom, typeRowsTo)} }`)}
    return typedCreationRows();
  }`);

  function fixture() {
    const state = { epoch: 7, viewId: "root", scope: { kind: "root" }, editing: false, source: { $tag: "ThisTabSource" } };
    const calls = [], quick = [], selectors = [];
    const rect = { left: 260, top: 180, right: 620, bottom: 420 };
    const menu = { epoch: 7, viewId: "root", focus: state.scope, source: workspaceSourceKey(state.source), x: 550, y: 330, item: { id: "person-type" },
      hint: { x: 0.25, y: 0.6 }, element: { closest: selector => {
        selectors.push(selector); return { getBoundingClientRect: () => rect };
      } } };
    const remember = name => value => calls.push({ name, value });
    const env = { sessionEpoch: () => state.epoch, current: () => ({ id: state.viewId }), scope: () => state.scope,
      editingDraftOpen: () => state.editing,
      scopeKey: locusScopeKey, workspaceSourceKey, props: { pane: { source: () => state.source } },
      quickValueShape, setQuickValue: value => quick.push(value),
      setComposeCardAnchor: remember("anchor"), setComposePlacement: remember("placement"),
      setComposeExpression: remember("expression"), setComposePresetType: remember("type"),
      setComposePresetValueType: remember("valueType"), setComposePresetExpr: remember("draft"),
      setComposePresetReps: remember("reps"), setComposing: remember("composing"), setPicking: remember("picker"),
    };
    const methods = installCreation(env);
    const typeRows = () => installTypeRows({ ...env, ...methods, menu, item: menu.item, writable: true,
      itemTypeReference: () => ({ id: "owned.Person", name: "Person" }), savedExprById: () => new Map(),
      homeAuthoringSession: () => ({}), homeData: { evaluated: () => undefined }, reader: undefined,
      getLabel: () => "Person", locale: value => value, valueCardTypeLabel: value => value,
      typedReadTypeLabel: () => "Person",
    });
    return { state, calls, quick, selectors, rect, menu, typeRows, ...methods,
      last: name => calls.filter(call => call.name === name).at(-1)?.value };
  }

  test("a real root menu target supplies only its identity to insertion; other scopes keep their existing placement", () => {
    const h = fixture();
    expect(h.creationPlacement(h.menu)).toEqual({ afterId: "person-type" });
    h.state.scope = { kind: "view", viewId: "canvas" };
    expect(h.creationPlacement(h.menu)).toBe(h.menu.hint);
    h.state.scope = { kind: "value", viewId: "root", itemId: "container", path: [] };
    expect(h.creationPlacement(h.menu)).toBe(h.menu.hint);
    h.state.scope = { kind: "root" };
    expect(h.creationPlacement({ ...h.menu, item: undefined })).toBe(h.menu.hint);
    expect(h.calls).toEqual([]);
  });

  test("a typed card reuses the canonical composer and captures viewport geometry separately from normalized canvas placement", () => {
    const h = fixture(); h.state.scope = { kind: "view", viewId: "canvas" };
    h.state.viewId = h.menu.viewId = "canvas";
    h.menu.focus = h.state.scope;
    h.openNewAt(h.menu, "Person");
    expect(h.quick).toEqual([]);
    expect(h.last("type")).toBe("Person"); expect(h.last("composing")).toBe(true);
    expect(h.last("placement")).toBe(h.menu.hint);
    expect(h.last("anchor")).toEqual({ x: 550, y: 330, beside: h.rect });
    expect(h.selectors).toEqual(["[data-locus-item]"]);
    const anchor = h.last("anchor"); h.rect.left = 999;
    expect(anchor.beside.left).toBe(260);

    const scalar = fixture(); scalar.state.scope = { kind: "view", viewId: "canvas" };
    scalar.state.viewId = scalar.menu.viewId = "canvas";
    scalar.menu.focus = scalar.state.scope;
    scalar.openNewAt(scalar.menu, "Number");
    expect(scalar.quick).toEqual([{ typeName: "Number", shape: "number", x: 550, y: 330,
      hint: scalar.menu.hint, epoch: 7 }]);
    expect(scalar.calls.some(call => call.name === "composing" || call.name === "anchor")).toBe(false);
    expect(scalar.selectors).toEqual([]);
  });

  test("New Person uses the same typed creation owner with the actual root card's anchor and insertion target", () => {
    const h = fixture();
    const action = h.typeRows().find(row => row.id === "type-new");
    expect(action.label).toBe("New Person");
    action.onSelect();
    expect(h.last("placement")).toEqual({ afterId: "person-type" });
    expect(h.last("anchor")).toEqual({ x: 550, y: 330, beside: h.rect });
    expect(h.last("type")).toBe("owned.Person");
    expect(h.last("composing")).toBe(true); expect(h.quick).toEqual([]);
  });

  test("a stale menu or an existing draft cannot open either typed creation entry", () => {
    for (const retire of [h => { h.state.epoch++; }, h => { h.state.viewId = "replacement"; }, h => { h.state.editing = true; },
      h => { h.state.scope = { kind: "value", viewId: "root", itemId: "other", path: [], rootItem: true }; },
      h => { h.state.source = { $tag: "AccountSource", accountId: "replacement" }; }]) {
      const h = fixture(), action = h.typeRows().find(row => row.id === "type-new");
      retire(h); h.openNewAt(h.menu, "Person"); action.onSelect();
      expect(h.calls).toEqual([]); expect(h.quick).toEqual([]); expect(h.selectors).toEqual([]);
    }
  });
});
