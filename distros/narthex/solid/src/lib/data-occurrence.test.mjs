import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  createContext, createEffect, createMemo, createRoot, createSignal, getOwner,
  latest, onSettled, runWithOwner, Show, untrack, useContext, flush,
} from "../../node_modules/solid-js/dist/solid.dev.js";

// Browser capture transport, without a repository registry or checker stub.
const source = await readFile(new URL("./data-occurrence.tsx", import.meta.url), "utf8");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const from = source.indexOf("export function captureDataOccurrence(");
const to = source.indexOf("type DataOccurrenceOutlet", from);
const install = new Function("createDataInspectionSuggestions", "draftValueFingerprint",
  `${transpiler.transformSync(source.slice(from, to)).replaceAll("export ", "")}; return { captureDataOccurrence, createDataOccurrenceSuggestions };`);
const created = [];
const api = install(capture => {
  const owner = { capture, opens: 0, closes: 0, items: () => [], pending: () => false, issue: () => undefined, read: () => undefined,
    open() { this.opens++; this.captured = capture(); }, close() { this.closes++; }, invalidate() {}, hold: () => () => {}, warm() {}, select() {} };
  created.push(owner); return owner;
}, JSON.stringify);

function fixture(input = {}) {
  const expression = { kind: "call", fnId: "actual-producer", args: [] };
  const type = { $ref: "List", args: [{ $ref: "String" }] };
  const scheme = { quantified: [], body: type };
  const capture = { session: {}, input: { expression, type, scheme, revision: "root:1", ...input }, current: () => true, select() {} };
  const source = { state: "source", capture: () => capture };
  return { expression, type, scheme, capture, source };
}

describe("source-scoped data occurrence transport", () => {
  test("the whole root retains its existing producer and declaration capture", () => {
    const h = fixture();
    expect(api.captureDataOccurrence(h.source)).toBe(h.capture);
    expect(api.captureDataOccurrence(h.source, { path: [], value: "observation", getType: () => ({ $ref: "Any" }) })).toBe(h.capture);
  });

  test("a selected child appends its path once and retains the original producer declarations", () => {
    const h = fixture(); const childType = { $ref: "String" };
    const next = api.captureDataOccurrence(h.source, { path: [1, "name"], value: "current child", getType: () => childType });
    expect(next.input.expression).toBe(h.expression);
    expect(next.input.sourcePath).toEqual([1, "name"]);
    expect(next.input.type).toBe(childType);
    expect(next.input.scheme).toBeUndefined();
    expect(next.input.sourceType).toBe(h.type);
    expect(next.input.sourceScheme).toBe(h.scheme);
    expect(next.input.value).toBe("current child");
    expect(next.select).toBe(h.capture.select);
  });

  test("an already projected producer never receives the selected parent declaration as its producer type", () => {
    const h = fixture({ sourcePath: [2] });
    const next = api.captureDataOccurrence(h.source, { path: ["name"], value: "child", getType: () => undefined });
    expect(next.input.sourcePath).toEqual([2, "name"]);
    expect(next.input.sourceType).toBeUndefined();
    expect(next.input.sourceScheme).toBeUndefined();
    expect(next.input.type).toBeUndefined();
  });

  test("previous producer declarations survive deeper selection unchanged", () => {
    const producerType = { $ref: "Outer" }, producerScheme = { quantified: ["a"], body: producerType };
    const h = fixture({ sourcePath: [2], sourceType: producerType, sourceScheme: producerScheme });
    const next = api.captureDataOccurrence(h.source, { path: ["name"], value: "child", getType: () => undefined });
    expect(next.input.sourceType).toBe(producerType);
    expect(next.input.sourceScheme).toBe(producerScheme);
  });

  test("numeric strings remain fields and invalid indices remain unmodified for the Fenel owner to refuse", () => {
    const h = fixture();
    const field = api.captureDataOccurrence(h.source, { path: ["0"], getType: () => undefined });
    const index = api.captureDataOccurrence(h.source, { path: [0], getType: () => undefined });
    expect(field.input.sourcePath).toEqual(["0"]);
    expect(index.input.sourcePath).toEqual([0]);
    expect(field.input.revision).not.toBe(index.input.revision);
    const invalid = api.captureDataOccurrence(h.source, { path: [-1, 1.5, NaN], getType: () => undefined });
    expect(invalid.input.sourcePath).toEqual([-1, 1.5, NaN]);
  });

  test("an unavailable query result reports its own reason without capturing a parent", () => {
    expect(() => api.captureDataOccurrence({ state: "unavailable", issue: "No presentation producer" })).toThrow("No presentation producer");
  });
});

describe("existing Suggestions owner adaptation", () => {
  test("whole-root menus reuse the supplied owner while child menus use the same canonical service", () => {
    const h = fixture();
    const supplied = { opens: 0, closes: 0, open() { this.opens++; }, close() { this.closes++; } };
    h.source.suggestions = supplied;
    let selection;
    const owner = api.createDataOccurrenceSuggestions(() => h.source, () => selection);
    const local = created.at(-1);
    owner.open();
    expect(supplied.opens).toBe(1);
    expect(local.opens).toBe(0);
    selection = { path: [0], value: "child", getType: () => ({ $ref: "String" }) };
    owner.open();
    expect(supplied.closes).toBe(1);
    expect(local.opens).toBe(1);
    expect(local.captured.input.sourcePath).toEqual([0]);
  });

  test("a same-tick source, selected occurrence or captured reader replacement retires the question", () => {
    const h = fixture(); let source = h.source;
    let selection = { path: [0], value: "child", getType: () => undefined };
    let valid = true; h.capture.current = () => valid;
    const owner = api.createDataOccurrenceSuggestions(() => source, () => selection);
    owner.open(); const captured = created.at(-1).captured;
    expect(captured.current()).toBe(true);
    source = { ...h.source };
    expect(captured.current()).toBe(false);
    source = h.source; const original = selection;
    selection = { ...selection };
    expect(captured.current()).toBe(false);
    selection = original; valid = false;
    expect(captured.current()).toBe(false);
  });

  test("a retired menu row cannot activate a reused whole-source owner after source replacement", () => {
    const h = fixture(); let selected = 0;
    h.source.suggestions = { open() {}, close() {}, items: () => [{ id: "proposal", label: "Proposal", onSelect: () => selected++ }],
      read: () => ({ session: {}, batch: {} }) };
    let source = h.source;
    const owner = api.createDataOccurrenceSuggestions(() => source);
    owner.open(); const row = owner.items()[0];
    source = { ...source };
    row.onSelect();
    expect(selected).toBe(0);
    expect(owner.read()).toBeUndefined();
    expect(owner.items()[0].label).toContain("This data changed");
  });
});

// Compile the actual boundary and context with Solid's installed compiler.
// The graph/context/lifecycle are real; DOM insertion and the Suggestions
// service's IO ports are controlled, without booting a registry or browser.
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const pluginPath = Bun.resolveSync("@solidjs/vite-plugin", packageRoot);
const compilerPath = Bun.resolveSync("@solidjs/compiler", pluginPath.slice(0, Math.max(pluginPath.lastIndexOf("/"), pluginPath.lastIndexOf("\\"))));
const compiler = createRequire(import.meta.url)(compilerPath);
const boundaryStart = source.indexOf("type DataOccurrenceOutlet");
if (boundaryStart < 0) throw new Error("The data occurrence boundary extraction moved");
const boundaryResult = await compiler.transformAsync(source.slice(boundaryStart), {
  filename: "data-occurrence.fixture.tsx", generate: "universal", hydratable: false, dev: true,
});
const boundaryCode = transpiler.transformSync(boundaryResult.code.replace(
  /^import \{([^}]+)\} from "@solidjs\/web";\r?\n/gm,
  (_, imports) => `const {${imports.replaceAll(" as ", ": ")}} = web;\n`,
)).replace(/^export /gm, "");
class OccurrenceTarget {
  constructor(modal = false) { this.modal = modal; }
  closest(selector) { return this.modal && selector.includes("modal-overlay") ? this : null; }
}
function occurrenceEvent() {
  return { target: new OccurrenceTarget(), clientX: 20, clientY: 30,
    defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; } };
}
function normalizeBoundary(value) {
  if (typeof value === "function") return normalizeBoundary(value());
  if (Array.isArray(value)) return value.flatMap(normalizeBoundary);
  if (value?.kind === "element") return { ...value, children: normalizeBoundary(value.children) };
  if (value?.kind === "menu") return { kind: "menu", items: value.props.items, close: value.props.onClose };
  return value;
}
function boundaryNodes(value, kind) {
  if (Array.isArray(value)) return value.flatMap(item => boundaryNodes(item, kind));
  return value && typeof value === "object"
    ? [...(value.kind === kind ? [value] : []), ...boundaryNodes(value.children, kind)] : [];
}
async function settleBoundary() { for (let tick = 0; tick < 4; tick++) { await Promise.resolve(); flush(); } }
function boundaryFixture(initial = {}, options = {}) {
  const original = fixture(), captures = [], owners = [], calls = [], maps = [];
  const source = { ...original.source, capture(selection) { captures.push(selection); return original.capture; },
    ...(options.openContext ? { openContext: options.openContext } : {}) };
  let dispose, outlet, childOutlet, exposed, childExposed, observed, supplied;
  const h = createRoot(close => {
    dispose = close;
    const [lease, setLease] = createSignal(true), defaultCurrent = () => lease();
    supplied = { value: "painted value", type: original.type, dataPath: [], occurrence: source,
      current: defaultCurrent, ...initial };
    const [frame, setFrame] = createSignal(supplied);
    const defaults = { onOutlet: open => { outlet = open; }, children: () => {
      exposed = useContext(component.DataOccurrenceContext);
      if (!options.nestedChild) return null;
      return childTree ??= component.DataOccurrenceBoundary({ value: "child paint", occurrence: source,
        mapSelection: options.childMapper,
        onOutlet: open => { childOutlet = open; }, children: () => {
          childExposed = useContext(component.DataOccurrenceContext); return null;
        } });
    } };
    const props = new Proxy({}, { get: (_, key) => Object.hasOwn(defaults, key) ? defaults[key] : frame()[key] });
    const semantic = install(capture => {
      const owner = { opens: 0, closes: 0, captured: undefined, items: () => [], pending: () => false,
        issue: () => undefined, read: () => undefined,
        open() { this.opens++; this.captured = capture(); }, close() { this.closes++; },
        invalidate() {}, hold: () => () => {}, warm() {}, select() {} };
      owners.push(owner); return owner;
    }, JSON.stringify);
    const web = { Show, createComponent: (Comp, passed) => untrack(() => Comp(passed)),
      createElement: (tag, attributes = {}) => ({ kind: "element", tag, attributes, children: [] }),
      insert(element, child) { const owner = getOwner(); element.children.push(() => runWithOwner(owner, () => {
        let result = child;
        while (typeof result === "function") result = result();
        return result;
      })); } };
    const ports = { web, createContext, createEffect, createMemo, createSignal, latest, onSettled, Show, untrack, useContext,
      Element: OccurrenceTarget, createDataOccurrenceSuggestions: semantic.createDataOccurrenceSuggestions,
      ownsLocusContextMenu: event => !event.defaultPrevented && !event.nativeEditing,
      locusContextPosition: event => ({ x: event.clientX, y: event.clientY }),
      LocusContextMenu: passed => ({ kind: "menu", props: passed }) };
    const component = new Function(...Object.keys(ports), `${boundaryCode}; return { DataOccurrenceBoundary, DataOccurrenceContext };`)(...Object.values(ports));
    let childTree;
    const tree = options.inherited
      ? component.DataOccurrenceContext({ value: options.inherited, get children() { return component.DataOccurrenceBoundary(props); } })
      : component.DataOccurrenceBoundary(props);
    createEffect(() => normalizeBoundary(tree), next => { observed = next; });
    return { setLease, peekLeaseCurrent: () => latest(lease), replace(delta) { supplied = { ...supplied, ...delta }; setFrame(supplied); },
      source, captures, owners, calls, maps, get output() { return observed; },
      open: (event, selection) => outlet(event, selection),
      openChild: (event, selection) => childOutlet(event, selection),
      context: () => exposed, childContext: () => childExposed,
      savedOutlet: () => outlet, savedChildOutlet: () => childOutlet };
  });
  if (!options.deferInitialFlush) flush();
  return { ...h, output: () => observed, dispose() { dispose(); flush(); } };
}
const boundarySelection = value => ({ value, label: "Selected data", path: [1], getType: () => ({ $ref: "String" }) });
function routedBoundary(route, extra = {}, fixtureOptions = {}) {
  const delegates = [], base = fixture(), occurrence = { ...base.source };
  const inherited = { source: () => occurrence, occurrence: () => occurrence,
    open: (event, selection) => delegates.push({ route: "inherited", event, selection }) };
  if (route === "source") occurrence.openContext = (event, selection) => delegates.push({ route, event, selection });
  const props = { occurrence, ...extra,
    ...(route === "handler" ? { onDataContext: (event, selection) => delegates.push({ route, event, selection }) } : {}) };
  const h = boundaryFixture(props, route === "inherited" ? { ...fixtureOptions, inherited } : fixtureOptions);
  return { ...h, occurrence, delegates };
}

describe("actual occurrence boundary forwarding", () => {
  for (const [name, gate] of [["undefined", () => undefined], ["throws", () => { throw new Error("Unreadable lease"); }]]) {
    test(`a present current gate that ${name === "undefined" ? "returns undefined" : name} refuses forwarding`, () => {
      const h = routedBoundary("source", { current: gate }), event = occurrenceEvent();
      try {
        h.open(event, boundarySelection("paint"));
        expect(h.delegates).toEqual([]); expect(h.owners.every(owner => owner.opens === 0)).toBe(true);
        expect(event.defaultPrevented).toBe(true); expect(event.propagationStopped).toBe(true);
        expect(h.context().source()).toBeUndefined();
      } finally { h.dispose(); }
    });
  }
  test("an omitted current gate preserves ordinary source forwarding", () => {
    const h = routedBoundary("source", { current: undefined }), selected = boundarySelection("source");
    try {
      h.open(occurrenceEvent(), selected); expect(h.delegates).toHaveLength(1);
      expect(h.delegates[0].selection).toBe(selected); expect(h.context().source()).toBe(h.occurrence);
    } finally { h.dispose(); }
  });
  for (const route of ["source", "handler", "inherited", "suggestions"]) {
    test(`current=false fences the ${route} route and consumes its owned context event`, () => {
      const h = routedBoundary(route, { current: () => false }), event = occurrenceEvent(); let ancestor = 0;
      try {
        h.open(event, boundarySelection("paint"));
        if (!event.propagationStopped) ancestor++;
        expect(h.delegates).toEqual([]); expect(h.owners.every(owner => owner.opens === 0)).toBe(true);
        expect(ancestor).toBe(0); expect(event.defaultPrevented).toBe(true);
        expect(h.context().source()).toBeUndefined();
      } finally { h.dispose(); }
    });
    test(`selection mapping precedes the ${route} route and preserves the original source reference`, () => {
      const order = [], painted = boundarySelection("paint"), mapped = boundarySelection({ raw: "source data" });
      const h = routedBoundary(route, { mapSelection: selected => { expect(selected).toBe(painted); order.push("mapped"); return mapped; } });
      try {
        expect(h.context().source()).toBe(h.occurrence);
        h.open(occurrenceEvent(), painted);
        expect(order).toEqual(["mapped"]);
        if (route === "suggestions") {
          expect(h.owners[0].opens).toBe(1); expect(h.owners[0].captured.input.value).toBe(mapped.value);
          expect(h.owners[0].captured.input.sourcePath).toEqual(mapped.path);
        } else { expect(h.delegates).toHaveLength(1); expect(h.delegates[0].selection).toBe(mapped); }
        expect(h.context().source()).toBe(h.occurrence);
      } finally { h.dispose(); }
    });
    test(`an undefined mapped selection refuses the ${route} route without leaking to an ancestor`, () => {
      const h = routedBoundary(route, { mapSelection: () => undefined }), event = occurrenceEvent(); let ancestor = 0;
      try {
        h.open(event, boundarySelection("paint")); if (!event.propagationStopped) ancestor++;
        expect(h.delegates).toEqual([]); expect(h.owners.every(owner => owner.opens === 0)).toBe(true);
        expect(ancestor).toBe(0); expect(event.defaultPrevented).toBe(true);
      } finally { h.dispose(); }
    });
  }
  test("a queued current callback replacement fences a saved outlet before flush", () => {
    const h = routedBoundary("source"), event = occurrenceEvent();
    try {
      const open = h.savedOutlet(); h.replace({ current: () => false }); open(event, boundarySelection("paint"));
      expect(h.delegates).toEqual([]); expect(event.propagationStopped).toBe(true);
    } finally { h.dispose(); }
  });
  test("the caller's explicit latest lease predicate fences a saved outlet before flush", () => {
    const h = routedBoundary("source"), event = occurrenceEvent();
    try {
      h.replace({ current: h.peekLeaseCurrent }); flush();
      const open = h.savedOutlet(); h.setLease(false); open(event, boundarySelection("paint"));
      expect(h.delegates).toEqual([]); expect(event.propagationStopped).toBe(true);
    } finally { h.dispose(); }
  });
  test("a normal caller predicate retains its own committed-positive ordering before flush", () => {
    const h = routedBoundary("source");
    try {
      h.setLease(false);
      h.open(occurrenceEvent(), boundarySelection("still committed"));
      expect(h.delegates).toHaveLength(1);
      expect(h.context().source()).toBe(h.occurrence);
      flush();
      h.open(occurrenceEvent(), boundarySelection("now retired"));
      expect(h.delegates).toHaveLength(1); expect(h.context().source()).toBeUndefined();
    } finally { h.dispose(); }
  });
  test("a queued mapper replacement supplies the new source selection before flush", () => {
    const old = boundarySelection("old source"), next = boundarySelection("new source");
    const h = routedBoundary("source", { mapSelection: () => old });
    try {
      h.replace({ mapSelection: () => next }); h.open(occurrenceEvent(), boundarySelection("paint"));
      expect(h.delegates).toHaveLength(1); expect(h.delegates[0].selection).toBe(next);
    } finally { h.dispose(); }
  });
  test("a queued occurrence replacement delegates through the new source and retains its identity", () => {
    const h = routedBoundary("source"), nextCalls = [], next = { ...fixture().source,
      openContext: (event, selection) => nextCalls.push(selection) };
    try {
      const selected = boundarySelection("source data"); h.replace({ occurrence: next });
      h.open(occurrenceEvent(), selected);
      expect(h.delegates).toEqual([]); expect(nextCalls).toEqual([selected]); expect(h.context().source()).toBe(next);
    } finally { h.dispose(); }
  });
  test("the mounted native handler captures queued root data and source together before flush", () => {
    const oldType = { $ref: "OldType" }, nextType = { $ref: "NextType" }, nextValue = { original: "next source value" };
    const nextPath = [3, "body"], delivered = [], nextSource = { ...fixture().source,
      openContext: (event, selection) => delivered.push({ event, selection }) };
    const h = routedBoundary("source", { value: "old value", type: oldType,
      dataPath: [0], label: "Old label", caption: "Old caption" });
    try {
      const native = boundaryNodes(h.output(), "element").find(node => node.tag === "span").attributes.onContextMenu;
      expect(native).toBeTypeOf("function");
      h.replace({ value: nextValue, type: nextType, dataPath: nextPath, occurrence: nextSource,
        label: "Next label", caption: "Next caption" });
      const event = occurrenceEvent(); native(event);
      expect(h.delegates).toEqual([]); expect(delivered).toHaveLength(1);
      const selected = delivered[0].selection;
      expect(delivered[0].event).toBe(event); expect(selected.value).toBe(nextValue);
      expect(selected.path).toBe(nextPath); expect(selected.label).toBe("Next label"); expect(selected.caption).toBe("Next caption");
      expect(h.context().source()).toBe(nextSource); expect(event.propagationStopped).toBe(true);
      h.replace({ type: { $ref: "LaterType" } }); expect(selected.getType()).toBe(nextType);
    } finally { h.dispose(); }
  });
  test("a queued onDataContext replacement uses the new handler before flush", () => {
    const h = routedBoundary("handler"), nextCalls = [];
    try {
      const selected = boundarySelection("source data"); h.replace({ onDataContext: (event, data) => nextCalls.push(data) });
      h.open(occurrenceEvent(), selected); expect(h.delegates).toEqual([]); expect(nextCalls).toEqual([selected]);
    } finally { h.dispose(); }
  });
  test("a child with the same explicit source cannot escape its inactive parent's outlet", () => {
    let mappings = 0;
    const h = boundaryFixture({ current: () => false }, { nestedChild: true,
      childMapper: selection => { mappings++; return selection; } }), event = occurrenceEvent();
    try {
      expect(h.context().source()).toBeUndefined(); expect(h.savedChildOutlet()).toBeTypeOf("function");
      h.openChild(event, boundarySelection("child"));
      expect(h.owners).toHaveLength(2); expect(h.owners.every(owner => owner.opens === 0)).toBe(true);
      expect(mappings).toBe(0);
      expect(event.defaultPrevented).toBe(true); expect(event.propagationStopped).toBe(true);
    } finally { h.dispose(); }
  });
  test("an active same-source child uses its parent mapper before the direct source delegate", () => {
    const painted = boundarySelection("child paint"), mapped = boundarySelection({ original: "parent source value" });
    const mappings = [], delivered = [];
    const h = boundaryFixture({ mapSelection: selected => { mappings.push(selected); return mapped; } }, {
      nestedChild: true, openContext: (event, selection) => delivered.push(selection),
    });
    try {
      expect(h.context().source()).toBe(h.source); expect(h.childContext().source()).toBe(h.source);
      h.openChild(occurrenceEvent(), painted);
      expect(mappings).toEqual([painted]); expect(delivered).toEqual([mapped]); expect(delivered[0]).toBe(mapped);
      expect(h.owners.every(owner => owner.opens === 0)).toBe(true);
      expect(h.context().source()).toBe(h.source); expect(h.childContext().source()).toBe(h.source);
    } finally { h.dispose(); }
  });
  test("mapper replacement retires an already captured Suggestions selection", () => {
    const h = routedBoundary("suggestions", { mapSelection: selected => selected });
    try {
      h.open(occurrenceEvent(), boundarySelection("first source")); flush();
      const captured = h.owners[0].captured; expect(captured.current()).toBe(true);
      h.replace({ mapSelection: () => boundarySelection("replacement source") });
      expect(captured.current()).toBe(false); flush();
      expect(boundaryNodes(h.output(), "menu")).toEqual([]);
    } finally { h.dispose(); }
  });
  test("current signal changes close an open menu through the ordinary reactive graph", () => {
    const h = routedBoundary("suggestions");
    try {
      h.open(occurrenceEvent(), boundarySelection("source")); flush();
      expect(boundaryNodes(h.output(), "menu")).toHaveLength(1);
      h.setLease(false); flush(); expect(boundaryNodes(h.output(), "menu")).toEqual([]);
      expect(h.owners[0].captured.current()).toBe(false);
    } finally { h.dispose(); }
  });
  test("disposal retires a saved outlet without touching disposed graph nodes", async () => {
    const h = routedBoundary("source"); await settleBoundary();
    const open = h.savedOutlet(); h.dispose(); const event = occurrenceEvent();
    expect(() => open(event, boundarySelection("retired"))).not.toThrow();
    expect(h.delegates).toEqual([]); expect(event.defaultPrevented).toBe(true); expect(event.propagationStopped).toBe(true);
  });
  test("a context event owned by native editing remains untouched", () => {
    const h = routedBoundary("source", { current: () => false }), event = occurrenceEvent(); event.nativeEditing = true;
    try {
      h.open(event, boundarySelection("paint")); expect(event.defaultPrevented).toBe(false);
      expect(event.propagationStopped).toBe(false); expect(h.delegates).toEqual([]);
    } finally { h.dispose(); }
  });
  test("a current callback does not promote the caller's owned request signal into a forbidden write companion", () => {
    let disposeCaller;
    const caller = createRoot(close => {
      disposeCaller = close;
      const [input, setInput] = createSignal(0);
      const [request, setRequest] = createSignal({ input: 0, state: "ready" }, { ownedWrite: true });
      const pending = createMemo(() => {
        const next = input();
        if (next > 0) setRequest({ input: next, state: "pending" });
        return next;
      });
      createEffect(pending, () => {});
      const boundary = routedBoundary("source", { current: () => {
        const captured = request();
        const prepared = latest(pending);
        return captured.state === "ready" && captured.input === prepared;
      } }, { deferInitialFlush: true });
      return { request, setInput, boundary };
    });
    try {
      flush();
      caller.boundary.open(occurrenceEvent(), boundarySelection("source"));
      expect(caller.boundary.delegates).toHaveLength(1);
      caller.setInput(1);
      expect(() => caller.boundary.open(occurrenceEvent(), boundarySelection("retired source"))).not.toThrow();
      expect(caller.boundary.delegates).toHaveLength(1);
      expect(() => flush()).not.toThrow();
      expect(caller.request()).toEqual({ input: 1, state: "pending" });
      caller.boundary.open(occurrenceEvent(), boundarySelection("now pending"));
      expect(caller.boundary.delegates).toHaveLength(1);
    } finally { disposeCaller(); flush(); }
  });
});
