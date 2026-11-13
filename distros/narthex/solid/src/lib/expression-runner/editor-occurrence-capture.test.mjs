import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// C1: exercise the production browser capture/action adapter with explicit
// declaration and occurrence receipts. The Fenel inference/rewrite owners are
// ports here; their semantic behavior is covered by their existing tests.
const source = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const suggestionCheckScope: SuggestionCheckScope = {");
const end = source.indexOf("  const suggestionOwner =", start);
if (start < 0 || end <= start) throw new Error("Editor occurrence capture markers changed");
const body = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));

function harness() {
  const selected = { kind: "literal", value: "live child" };
  const sibling = { kind: "ref", savedExprId: "keep-this-source" };
  const root = { kind: "literal", value: { __list: [selected, sibling] } };
  const path = ["value", "__list", 0];
  const type = { $ref: "String" }, scheme = { quantified: [], body: type };
  let epoch = 1, session = { evaluateContext: {} }, destination = { expected: type, outcome: { $tag: "Solved" } };
  let bindings = [{ name: "outer", type, scheme }], writes = [], rewrites = [];
  const props = { node: root, onChange: next => writes.push(next) };
  const inspect = (container, node) => container !== root ? { ok: false, diagnostics: [] }
    : { ok: true, value: { path: node === root ? [] : node === selected ? path : ["missing"],
      detached: node !== root && node !== selected, annotations: [] } };
  const ports = {
    props, parentSuggestionCheck: null,
    suggestionDestination: () => destination, suggestionLexicalBindings: () => bindings,
    session, inspectAuthoringExpressionOccurrence: inspect, transferSaved: { list: () => [{ id: "saved", expr: sibling }] },
    resultBindingContinuation: () => ({ root: () => props.node, path: () => [] }),
    draftValueFingerprint: value => JSON.stringify(value), suggestionDraft: () => props.node, recordValues: () => ({}),
    concreteAuthoringSession: () => session, sessionEpoch: () => epoch, inferenceContext: () => ({}),
    inferAuthoringExpressionWithLiteralWitnesses: (node, context) => {
      expect(context.bindings.outer).toBe(scheme);
      expect(node === selected || node === root).toBe(true);
      return { type, scheme };
    },
    replaceAuthoringExpressionOccurrence: (container, occurrence, next) => {
      rewrites.push({ container, occurrence, next });
      return { ok: true, value: { kind: "literal", value: { __list: [next, sibling] } } };
    },
    closePicker() {}, setCallEditIssue() {},
    // B4 F2: an Account session's draft analyses keep its own frame.
    editorFrame: supplied => supplied.evaluateContext,
  };
  const adapter = new Function(...Object.keys(ports), `${body}; return { captureSuggestion, suggestionSnapshot };`)(...Object.values(ports));
  return { adapter, props, root, selected, sibling, path, type, scheme,
    writes, rewrites, setEpoch: value => { epoch = value; }, setSession: value => { session = value; },
    setDestination: value => { destination = value; }, setBindings: value => { bindings = value; } };
}

test("an authored graph child retains its producer, enclosing contract and existing sibling-preserving action", () => {
  const h = harness(), capture = h.adapter.captureSuggestion(h.selected);
  expect(capture.input.expression).toBe(h.selected);
  expect(capture.input.scheme).toBe(h.scheme);
  expect(capture.input.sourceScheme).toBe(h.scheme);
  expect(capture.input.sourceType).toBe(h.type);
  expect(capture.input.destination).toBeUndefined();
  expect(capture.input.enclosing.expression).toBe(h.root);
  expect(capture.input.enclosing.path).toBe(h.path);
  expect(capture.input.enclosing.destination.expected).toBe(h.type);
  expect(capture.input.savedExpressions).toEqual([["saved", h.sibling]]);
  expect(capture.current()).toBe(true);
  const next = { kind: "call", fnId: "fixture:operation", args: [h.selected] };
  capture.select(next);
  expect(h.rewrites).toEqual([{ container: h.root, occurrence: h.path, next }]);
  expect(h.writes[0].value.__list[1]).toBe(h.sibling);
});

test("root capture keeps the slot destination without making an enclosing child contract", () => {
  const h = harness(), capture = h.adapter.captureSuggestion(h.root);
  expect(capture.input.expression).toBe(h.root);
  expect(capture.input.destination.expected).toBe(h.type);
  expect(capture.input.enclosing).toBeUndefined();
});

test("a detached graph child refuses capture instead of using its parent's source", () => {
  const h = harness();
  expect(() => h.adapter.captureSuggestion({ kind: "literal", value: "unrelated observed data" }))
    .toThrow("This data's authored occurrence is unavailable");
  expect(h.writes).toEqual([]);
});

for (const change of ["source", "draft", "scope", "destination", "epoch", "reader"]) {
  test(`${change} replacement invalidates the original graph child capture`, () => {
    const h = harness(), capture = h.adapter.captureSuggestion(h.selected);
    if (change === "source") h.props.node = { ...h.root };
    if (change === "draft") h.sibling.savedExprId = "changed-live-source";
    if (change === "scope") h.setBindings([{ name: "other", type: h.type }]);
    if (change === "destination") h.setDestination(undefined);
    if (change === "epoch") h.setEpoch(2);
    if (change === "reader") h.setSession({ evaluateContext: {} });
    expect(capture.current()).toBe(false);
    expect(h.writes).toEqual([]);
  });
}

test("expanded graph context ports append the origin path once and retain the actual nested data", () => {
  const surfaces = readFileSync(new URL("./expression-surfaces.tsx", import.meta.url), "utf8");
  const control = surfaces.indexOf("export function ExpressionGraphCollectionItemControl(");
  const first = surfaces.indexOf("  const occurrence = createMemo<", control);
  const last = surfaces.indexOf("  createEffect(", first);
  expect(first).toBeGreaterThan(control); expect(last).toBeGreaterThan(first);
  let captures = 0, forwarded, refresh;
  const origin = { state: "source", capture() { captures++; throw new Error("Context opening must not prepare a reader"); },
    openContext: (event, selection) => { forwarded = { event, selection }; } };
  const props = { occurrence: { source: origin, path: [2, "details"] }, data: { value: "parent", path: [2], getType: () => ({ $ref: "Record" }), label: "Item 3" } };
  const createMemo = fn => { let value; refresh = () => { value = fn(); }; return () => value ?? (value = fn()); };
  const getSource = new Function("props", "createMemo", "captureDataOccurrence",
    `${new Bun.Transpiler({ loader: "tsx" }).transformSync(surfaces.slice(first, last))}; return occurrence;`)(props, createMemo, () => { captures++; });
  const source = getSource();
  const type = { $ref: "String" }, getType = () => type, event = { preventDefault() {}, stopPropagation() {} };
  const nested = { value: "actual selected data", caption: "Selected", label: "Child", path: [0, "name"], getType };
  source.openContext(event, nested);
  expect(forwarded.event).toBe(event);
  expect(forwarded.selection).toEqual({ ...nested, path: [2, "details", 0, "name"] });
  expect(forwarded.selection.getType).toBe(getType);
  expect(captures).toBe(0);
  forwarded = undefined;
  props.occurrence = { source: { state: "unavailable", issue: "Replaced source" }, path: [] }; refresh();
  source.openContext(event, nested);
  expect(forwarded).toBeUndefined();
  expect(captures).toBe(0);
});

function graphCaptureHarness() {
  const captureStart = source.indexOf("  const captureCurrent = () => {"), captureEnd = source.indexOf("  const completeExpression =", captureStart);
  const start = source.indexOf("  function startCapture() {"), end = source.indexOf("  createEffect(", start);
  const valueStart = source.indexOf("  const graphValue = (node: ExprNode):"), valueEnd = source.indexOf("  const [modal,", valueStart);
  const consumerStart = source.indexOf("  const capture = isRoot ? createLocusCardEvaluation("), consumerEnd = source.indexOf("  function startCapture()", consumerStart);
  for (const [first, last] of [[captureStart, captureEnd], [start, end], [valueStart, valueEnd], [consumerStart, consumerEnd]]) {
    expect(first).toBeGreaterThan(0); expect(last).toBeGreaterThan(first);
  }
  const root = { kind: "call", fnId: "fixture:metadata", args: [] }, saved = new Map(), base = { evaluateContext: {} }, worker = {};
  let owner, packetCurrent = true, metadata, request;
  const events = [];
  const newMetadata = () => ({ session: base, packet: { generation: "display-generation" }, generationToken: {}, current: () => packetCurrent });
  metadata = newMetadata();
  owner = { captureSourceMetadata: () => metadata };
  const observed = () => ({ result: "current result", trace: [], sourceMetadata: request?.sourceMetadata });
  const ports = {
    props: { expr: root }, session: () => owner, savedExpressions: () => saved,
    graphActive: () => true, graphSelection: () => ({ node: root, allowed: true }), mayCapture: () => true, externalCapture: () => false,
    captureRequest: () => request, setCaptureRequest: value => { request = value; },
    currentGraphWorker: () => worker, sessionEpoch: () => 1, untrack: fn => fn(),
    concreteAuthoringSession: supplied => { events.push(["unwrap", supplied]); return base; },
    authoringWorkerSnapshot: supplied => { expect(supplied).toBe(base); return worker; },
    assertReaderSourceMetadata: (captured, supplied) => {
      if (supplied !== owner || captured.session !== base || !captured.current()) throw new Error("Stale source");
    },
    captureReaderSourceMetadata: supplied => {
      events.push(["metadata", supplied]);
      const captured = supplied.captureSourceMetadata?.();
      if (captured && !captured.current()) throw new Error("Stale source");
      return captured;
    },
    currentGraphSourceMetadata: () => owner.captureSourceMetadata?.(),
    authoringExpressionSites: (_root, _resolver, supplied) => { expect(supplied).toBe(owner); return { sites: [{ node: root }] }; },
    readLocusCardResult: (_root, _saved, supplied, options) => {
      expect(supplied).toBe(owner); expect(options.sourceMetadata).toBe(metadata);
      events.push(["read", supplied, options.sourceMetadata]); return observed();
    },
    isRoot: true, createLocusCardEvaluation: getInput => ({ input: getInput, loading: () => false, value: observed }),
    readLocusCapturedValue: (_root, _saved, supplied, _node, _observed, provided) => {
      events.push(["captured-value", supplied, provided]); return { value: "current result" };
    },
    inheritedGraphValues: undefined,
  };
  const code = [source.slice(captureStart, captureEnd), source.slice(consumerStart, consumerEnd), source.slice(start, end), source.slice(valueStart, valueEnd)].join("\n");
  const adapter = new Function(...Object.keys(ports), `${new Bun.Transpiler({ loader: "tsx" }).transformSync(code)}; return {startCapture,captureCurrent,graphValue,capture};`)(...Object.values(ports));
  return { adapter, root, base, events, metadata: () => metadata, request: () => request, owner: () => owner,
    changeGeneration: () => { metadata = newMetadata(); }, retire: () => { packetCurrent = false; },
    replaceOwner: () => { owner = { captureSourceMetadata: () => metadata }; },
    removeMetadata: () => { metadata = undefined; owner = {}; } };
}

test("prepared graph captures facade metadata before unwrap and retains it through result display", () => {
  const h = graphCaptureHarness(); h.adapter.startCapture();
  expect(h.events[0]).toEqual(["metadata", h.owner()]);
  expect(h.events[1]).toEqual(["unwrap", h.owner()]);
  expect(h.request().owner).toBe(h.owner()); expect(h.request().session).toBe(h.base);
  expect(h.request().sourceMetadata).toBe(h.metadata()); expect(h.adapter.captureCurrent()).toBe(true);
  expect(h.adapter.capture.input().session).toBe(h.owner()); expect(h.adapter.capture.input().sourceMetadata).toBe(h.metadata());
  expect(h.adapter.graphValue(h.root)).toEqual({ value: "current result" });
  expect(h.events.at(-1)).toEqual(["captured-value", h.owner(), h.metadata()]);
});

for (const replacement of ["generation", "owner", "retirement", "absence"]) {
  test(`prepared graph ${replacement} retires an earlier result with the same concrete session and worker`, () => {
    const h = graphCaptureHarness(); h.adapter.startCapture();
    if (replacement === "generation") h.changeGeneration();
    if (replacement === "owner") h.replaceOwner();
    if (replacement === "retirement") h.retire();
    if (replacement === "absence") h.removeMetadata();
    expect(h.adapter.captureCurrent()).toBe(false);
    expect(h.adapter.graphValue(h.root)).toBeUndefined();
    expect(h.events.some(event => event[0] === "captured-value")).toBe(false);
    if (replacement === "absence") {
      h.adapter.startCapture();
      expect(h.request().sourceMetadata).toBeUndefined();
      expect(h.adapter.capture.input().sourceMetadata).toBeUndefined();
    }
  });
}
