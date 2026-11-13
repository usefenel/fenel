// @ts-nocheck -- Run with Bun browser conditions to exercise actual Solid proxies:
//   bun --conditions=browser --conditions=development test <this file>
// Without them Bun resolves solid-js's server entry, where store writes are inert.
import { describe, expect, test } from "bun:test";
import { Loading, NotReadyError, createRoot, createMemo, createSignal, createEffect, resolve, refresh, flush, untrack } from "solid-js";
import { createStore } from "solid-js";
import { checkpointDraftFingerprint, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { cloneDraftValue, draftValueFingerprint } from "./native-draft";
import { shareSavedExpressionMap } from "./saved-expression-map";

describe("native editor drafts", () => {
  test("snapshotting Solid data preserves native values and detaches nested edits", () => {
    const [state, setState] = createStore({ nested: { bound: Infinity }, bytes: new Uint8Array([1, 2]), buffer: new Uint8Array([3]).buffer, signed: -0 });
    const saved = cloneDraftValue(state);
    // Solid 2: store setters take a draft callback; the path form is gone.
    setState((draft) => { draft.nested.bound = 0; });
    flush();
    expect(state.nested.bound).toBe(0);
    expect(saved.nested.bound).toBe(Infinity);
    expect(saved.bytes).toEqual(Uint8Array.of(1, 2));
    expect(saved.bytes).not.toBe(state.bytes);
    expect(saved.buffer).toBeInstanceOf(ArrayBuffer);
    expect(Object.is(saved.signed, -0)).toBe(true);
  });
  test("fingerprints distinguish native values and retain deep reactive subscriptions", () => {
    createRoot((dispose) => {
      const [state, setState] = createStore({ value: { bound: Infinity } });
      const fingerprint = createMemo(() => draftValueFingerprint(state));
      const before = fingerprint();
      setState((draft) => { draft.value.bound = null; });
      // Solid 2 stages writes to the microtask queue; flush to observe them.
      flush();
      expect(fingerprint()).not.toBe(before);
      expect(draftValueFingerprint(-0)).not.toBe(draftValueFingerprint(0));
      expect(draftValueFingerprint(NaN)).not.toBe(draftValueFingerprint(null));
      dispose();
    });
  });
});

describe("unfinished native editor drafts", () => {
  test("a dense unfinished List item remains reactive through edit and removal", () => {
    createRoot(dispose => {
      try {
        const [state, setState] = createStore({ expression: { kind: "literal", value: [] as unknown[] } });
        const fingerprint = createMemo(() => draftValueFingerprint(state.expression));
        const empty = fingerprint();
        // FieldRenderer's Add item uses undefined when the type has no default.
        setState(draft => { draft.expression.value.push(undefined); });
        flush();
        const unfinished = fingerprint();
        expect(unfinished).not.toBe(empty);
        const captured = cloneDraftValue(state.expression);
        expect(captured.value).toEqual([undefined]);
        expect(Object.hasOwn(captured.value, 0)).toBe(true);
        expect(unfinished).not.toBe(draftValueFingerprint({ kind: "literal", value: [null] }));
        setState(draft => { draft.expression.value[0] = "First item"; });
        flush();
        expect(fingerprint()).not.toBe(unfinished);
        expect(fingerprint()).toBe(draftValueFingerprint({ kind: "literal", value: ["First item"] }));
        setState(draft => { draft.expression.value.splice(0, 1); });
        flush();
        expect(fingerprint()).toBe(empty);
      } finally { dispose(); }
    });
  });

  test("unfinished root and list slots do not collide with null or authored atoms", () => {
    const marker = { $fenelCheckpoint: ["draft-undefined", null] };
    const values = [undefined, null, [], [undefined], [null], marker, [marker]];
    expect(new Set(values.map(draftValueFingerprint)).size).toBe(values.length);
  });

  test("admitted values retain their exact checkpoint fingerprint and equivalence", () => {
    const item = { value: 1 };
    const date = new Date("2026-11-05T00:00:00.000Z");
    const values = [null, {}, { item: undefined }, [item, item], [{ value: 1 }, { value: 1 }],
      date, date.toISOString(), 0, -0, NaN, Infinity, -Infinity,
      Uint8Array.of(1, 2), Uint8Array.of(1, 3), Uint8Array.of(1, 2).buffer,
      { $fenelCheckpoint: ["number", "nan"] }, { $fenelCheckpoint: undefined }];
    for (const value of values) {
      expect(draftValueFingerprint(value)).toBe(JSON.stringify(encodeCheckpointValue(cloneDraftValue(value))));
    }
    expect(draftValueFingerprint([item, item])).toBe(draftValueFingerprint([{ value: 1 }, { value: 1 }]));
    expect(draftValueFingerprint({ item: undefined })).toBe(draftValueFingerprint({}));
    expect(draftValueFingerprint(date)).toBe(draftValueFingerprint(date.toISOString()));
    const distinct = [0, -0, NaN, null, Uint8Array.of(1, 2), Uint8Array.of(1, 3), Uint8Array.of(1, 2).buffer];
    expect(new Set(distinct.map(draftValueFingerprint)).size).toBe(distinct.length);
  });

  test("unfinished slots do not admit cycles, holes or unsupported native values", () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    for (const value of [cycle, Array(1), 1n, new Uint16Array([1])]) {
      expect(() => draftValueFingerprint(value)).toThrow();
      expect(() => draftValueFingerprint([undefined, value])).toThrow();
      expect(() => draftValueFingerprint([value, undefined])).toThrow();
    }
  });
});

// Demo 2 (pasted images): Suggestions fingerprints the selected data and the
// saved expressions several times per capture; for a 402 x 372 paste each one
// walked, cloned and re-encoded 149,544 pixel records on the main thread.
describe("large plain draft data", () => {
  const pastedImage = (width, height) => ({ width, height,
    pixels: Array.from({ length: width * height }, (_, index) => ({ r: index % 256, g: (index * 7) % 256, b: (index * 13) % 256, a: 255 })) });
  const reference = value => checkpointDraftFingerprint(cloneDraftValue(value));

  test("plain image data is fingerprinted without a structured clone", () => {
    const image = { kind: "literal", value: pastedImage(96, 64) };
    const expected = reference(image);
    const original = globalThis.structuredClone;
    let clones = 0;
    globalThis.structuredClone = (value, options) => { clones++; return original(value, options); };
    try { expect(draftValueFingerprint(image)).toBe(expected); }
    finally { globalThis.structuredClone = original; }
    expect(clones).toBe(0);
  });

  test("shapes outside plain data keep the clone and checkpoint text, including its refusals", () => {
    class Point { constructor(x, y) { this.x = x; this.y = y; } }
    const shared = { k: 1 };
    const getter = Object.defineProperty({ a: 1 }, "b", { get: () => 3, enumerable: true });
    const hidden = Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false });
    const values = [{ a: 1, [Symbol("bookkeeping")]: 2 }, hidden, getter, Object.assign(Object.create(null), { z: 1, a: [true, false] }),
      new Point(1, 2), { at: new Date(0) }, { bytes: Uint8Array.of(1, 2, 3) }, { pair: [shared, shared] },
      { 2: "two", 1: "one", b: 1, a: 2 }, [undefined, null, -0, NaN, 1e21, "a\"b\\c "], { kind: "literal", value: pastedImage(3, 2) }];
    for (const value of values) expect(draftValueFingerprint(value)).toBe(reference(value));
    expect(() => draftValueFingerprint(Object.assign([1, 2], { note: "x" }))).toThrow();
    expect(() => draftValueFingerprint({ list: [, 1] })).toThrow();
    expect(() => draftValueFingerprint({ map: new Map([[1, 2]]) })).toThrow();
    expect(() => draftValueFingerprint({ run: () => 1 })).toThrow();
  });

  test("plain data wrapping store data still subscribes to nested edits", () => {
    createRoot(dispose => {
      try {
        const [state, setState] = createStore({ list: [{ r: 1 }, { r: 2 }] });
        const fingerprint = createMemo(() => draftValueFingerprint({ wrapped: state }));
        expect(fingerprint()).toBe('{"wrapped":{"list":[{"r":1},{"r":2}]}}');
        setState(draft => { draft.list[1].r = 9; });
        flush();
        expect(fingerprint()).toBe('{"wrapped":{"list":[{"r":1},{"r":9}]}}');
        expect(draftValueFingerprint(state)).toBe(reference(state));
      } finally { dispose(); }
    });
  });
});

// C1: exercise Home's actual browser draft lifetime without preparing a registry.
// The existing saved-editor source override also permits frozen-source controls.
{
  const home = (await Bun.file(process.env.FENEL_SAVED_EDITOR_SOURCE ?? new URL("../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n?/g, "\n");
  const seed = (await Bun.file(new URL("./expression-runner/creation-seed.ts", import.meta.url)).text()).replace(/\r\n?/g, "\n");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const slice = (text, start, end, after = 0) => {
    const first = text.indexOf(start, after);
    const last = text.indexOf(end, first);
    if (first < 0 || last <= first) throw Error(`Actual-source boundary changed: ${start}`);
    return text.slice(first, last);
  };
  const compile = (text, dependencies) => new Function(...Object.keys(dependencies), transpiler.transformSync(text))(...Object.values(dependencies));
  const resolveExpr = compile(`${slice(home, "function resolveExpr(", "function rendersPicture(")}; return resolveExpr;`, {});
  const emptyExpressionSlot = compile(`${slice(seed, "export function emptyExpressionSlot(", "function constructorsForType(").replace("export ", "")}; return emptyExpressionSlot;`, {});
  const modalAt = home.indexOf("function EditModalContent(");
  const initialCode = slice(home, "  const initial = createMemo", "  // Display typed constructor", modalAt);
  const baselineCode = slice(home, "  const [savedBaseline", "  const [saving", modalAt);
  const loadingCode = slice(home, "  const savedAll = createMemo", "  const root = () => all().root;");
  const mapCode = slice(home, "  const savedExprById = createMemo", "  // Inline editing");
  const retryCode = slice(home, "  async function retryHomeData()", "  async function activateHome(");
  const openCode = slice(home, "  function savedQueryForItem(", "  const [calling");
  const literal = value => ({ kind: "literal", value });
  const ref = id => ({ id, source: { kind: "ref", ref: { id } } });
  const row = (id, value) => ({ id, query: { kind: "expression", expr: literal(value) } });

  function graph(expressions = {}) {
    const requests = [];
    const revalidations = [];
    let dispose;
    let owner, visible, renderRead;
    createRoot(stop => {
      dispose = stop;
      const root = () => ({ expressions });
      const all = createMemo(() => ({ root: root(), failed: false }));
      const prepare = () => compile(`${loadingCode}\n${mapCode}\n${retryCode}\nreturn { savedAll, savedExprById, retryHomeData, retryingData };`, {
        createMemo, createSignal, refresh, root, all, reader: undefined, client: {}, props: { publicData: false },
        redirectToPublic: () => false, shareSavedExpressionMap,
        revalidate: keys => revalidations.push(keys),
        getSavedQueries: () => {
          let yes, no;
          const promise = new Promise((accept, reject) => { yes = accept; no = reject; });
          requests.push({ resolve: queries => yes({ queries, categories: [] }), reject: no });
          return promise;
        },
      });
      // Production keeps Home under Loading, with live saved-map and failure
      // consumers. A completed resolve() alone disposes its consumer and does
      // not reproduce that ownership when Retry starts a new asynchronous read.
      const boundary = Loading({ fallback: null, get children() {
        if (!owner) {
          owner = untrack(prepare);
          renderRead = createMemo(() => ({ failed: owner.savedAll().failed, saved: owner.savedExprById() }));
        }
        return renderRead;
      } });
      createEffect(() => boundary(), value => { visible = value; });
    });
    return { ...owner, requests, revalidations, dispose, visible: () => visible };
  }

  function editor(data, item) {
    let dispose;
    const props = { item, get savedExprById() { return data.savedExprById(); } };
    let state;
    try {
      state = createRoot(stop => {
        dispose = stop;
        return compile(`${initialCode}\n${baselineCode}\nreturn { draft, setDraft, initial, savedBaseline, savedExpressionChanged };`, {
          props, createSignal, createMemo, createEffect, resolveExpr, emptyExpressionSlot, cloneDraftValue, draftValueFingerprint,
        });
      });
    } catch (error) { dispose?.(); throw error; }
    return { ...state, dispose };
  }

  async function settle(data, values = [], failure = false) {
    const ready = resolve(() => data.savedExprById());
    const request = data.requests.at(-1);
    if (failure) request.reject(Error("Controlled first read failure"));
    else request.resolve(values);
    await ready;
    flush();
    // A user can click Retry only from a later event-loop turn, after the
    // initial Loading reveal has settled, rather than inside its promise flush.
    await new Promise(done => setImmediate(done));
  }

  // Since 326ded64 Retry first awaits the reader's presentation retry, so the
  // new saved read starts on a later turn; answer that request, not the last one.
  async function startRetry(data) {
    const before = data.requests.length;
    const retry = data.retryHomeData(); flush();
    await new Promise(done => setImmediate(done));
    expect(data.requests).toHaveLength(before + 1);
    return { retry };
  }

  describe("Home first saved baseline", () => {
    test("ordinary first loading suspends instead of returning an empty source", async () => {
      const data = graph();
      try {
        let revealed = false;
        const first = resolve(() => data.savedExprById()).then(value => { revealed = true; return value; });
        flush();
        expect(data.requests).toHaveLength(1);
        expect(revealed).toBe(false);
        data.requests[0].resolve([row("saved", "server")]);
        expect((await first).get("saved")).toEqual(literal("server"));
      } finally { data.dispose(); }
    });

    test("the open callback can retain failure while a new editor consumer suspends during quiet Retry", async () => {
      const data = graph();
      let current;
      try {
        const opened = [];
        const sourceTicket = {};
        const open = compile(`${openCode}\nreturn openItemEditor;`, {
          savedAll: data.savedAll, rootSourceTicket: () => sourceTicket,
          setEditing: value => opened.push(value), cloneDraftValue,
        });
        await settle(data, [], true);
        const retry = data.retryHomeData();
        // Retry and opening a card are separate UI events. Let refresh's own
        // deferred waiter start the request before the second event reads it.
        await new Promise(done => setImmediate(done));
        expect(data.requests).toHaveLength(2);
        expect(data.visible().failed).toBe(true);
        expect(data.visible().saved.size).toBe(0);
        open({ item: ref("saved"), homeId: "fixture" });
        expect(opened).toHaveLength(1);
        expect(opened[0].expectedSavedQuery).toBeUndefined();
        expect(() => editor(data, ref("saved"))).toThrow(NotReadyError);
        data.requests[1].resolve([row("saved", "recovered")]);
        await retry;
        await new Promise(done => setImmediate(done));
        open({ item: ref("saved"), homeId: "fixture" });
        expect(opened).toHaveLength(2);
        expect(opened[1].expectedSavedQuery).toEqual(row("saved", "recovered").query);
        expect(opened[1].sourceTicket).toBe(sourceTicket);
        current = editor(data, ref("saved")); flush();
        expect(current.draft()).toEqual(literal("recovered"));
        expect(current.savedBaseline()).toEqual({ id: "saved", fingerprint: draftValueFingerprint(literal("recovered")) });
        expect(data.revalidations).toEqual([["locusRoot", "locusViews", "activeLocusView", "savedQueries"]]);
      } finally { current?.dispose(); data.dispose(); }
    });

    test("same-owner failed refresh preserves admitted edits and baseline", async () => {
      const data = graph();
      let current;
      try {
        await settle(data, [row("saved", "first")]);
        current = editor(data, ref("saved")); flush();
        const baseline = cloneDraftValue(current.savedBaseline());
        current.setDraft(literal("local edit")); flush();
        const { retry } = await startRetry(data);
        data.requests.at(-1).reject(Error("Controlled later read failure"));
        await retry; flush();
        expect(current.draft()).toEqual(literal("local edit"));
        expect(current.savedBaseline()).toEqual(baseline);
        expect(current.savedExpressionChanged()).toBe(true);
        const { retry: recovered } = await startRetry(data);
        data.requests.at(-1).resolve([row("saved", "other tab")]);
        await recovered; flush();
        expect(current.draft()).toEqual(literal("local edit"));
        expect(current.savedBaseline()).toEqual(baseline);
        expect(current.savedExpressionChanged()).toBe(true);
      } finally { current?.dispose(); data.dispose(); }
    });

    test("Cancel disposal and a different keyed owner cannot inherit a late baseline", async () => {
      const data = graph();
      let first, next;
      try {
        await settle(data, [], true);
        first = editor(data, ref("a")); flush();
        first.dispose();
        next = editor(data, ref("b")); flush();
        expect(next.savedBaseline()).toBeNull();
        const { retry } = await startRetry(data);
        data.requests.at(-1).resolve([row("a", "outgoing")]);
        await retry; flush();
        expect(next.draft()).toEqual(emptyExpressionSlot());
        expect(next.savedBaseline()).toBeNull();
        const { retry: again } = await startRetry(data);
        data.requests.at(-1).resolve([row("a", "outgoing"), row("b", "incoming")]);
        await again; flush();
        expect(next.savedBaseline().id).toBe("b");
        expect(next.draft()).toEqual(literal("incoming"));
        next.dispose(); next = editor(data, ref("b")); flush();
        expect(next.draft()).toEqual(literal("incoming"));
      } finally { first?.dispose(); next?.dispose(); data.dispose(); }
    });

    test("inline and already resolved root sources do not wait for unrelated saved rows", async () => {
      const data = graph({ local: literal("root value") });
      let inline, current;
      try {
        await settle(data, [], true);
        inline = editor(data, { id: "inline", source: { kind: "expr", expr: literal("inline") } });
        current = editor(data, ref("local")); flush();
        expect(inline.savedBaseline()).toBeNull();
        expect(inline.draft()).toEqual(literal("inline"));
        expect(current.savedBaseline().id).toBe("local");
        expect(current.draft()).toEqual(literal("root value"));
      } finally { inline?.dispose(); current?.dispose(); data.dispose(); }
    });

    test("the real editor wrapper owns new-consumer suspension through Loading", () => {
      const wrapper = slice(home, "function EditModal(", "function EditModalContent(");
      expect(wrapper).toContain("<EditorPreparation");
      expect(wrapper).toContain("<EditModalContent {...props} />");
      const preparation = slice(home, "function EditorPreparation(", "function FunctionCallModal(");
      expect(preparation).toContain("<Loading fallback={placeholder()}>{props.children}</Loading>");
    });

    // Diagnostic only: this deliberately invokes Retry while an empty editor is
    // already mounted. It does not demonstrate that a normal UI can cause that
    // refresh through the modal, so it is not an open user-facing bug assertion.
    if (process.env.FENEL_SAVED_BASELINE_CONDITIONAL === "1") test("conditional already-open empty draft hydrates after an externally invoked refresh", async () => {
      const data = graph();
      let current;
      try {
        await settle(data, [], true);
        current = editor(data, ref("saved")); flush();
        expect(current.savedBaseline()).toBeNull();
        expect(current.draft()).toEqual(emptyExpressionSlot());
        current.setDraft(literal("local edit")); flush();
        const retry = data.retryHomeData();
        await new Promise(done => setImmediate(done));
        expect(current.draft()).toEqual(literal("local edit"));
        data.requests.at(-1).resolve([row("saved", "recovered")]);
        await retry; flush();
        expect(current.draft()).toEqual(literal("recovered"));
        console.log("CONDITIONAL source observation only: no reachable UI refresh trigger demonstrated.");
      } finally { current?.dispose(); data.dispose(); }
    });
  });
}
