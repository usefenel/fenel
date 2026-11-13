import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, createMemo, createEffect, flush, latest } from "../../../node_modules/solid-js/dist/solid.dev.js";

// Production record/variant adapters with the shared controller as a controlled
// port. Source slot/edit semantics have separate actual-owner parity tests.
const source = await Bun.file(new URL("./VariantValueEditor.tsx", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
function component(name) {
  const begin = source.indexOf("  const authoring =", source.indexOf(`function ${name}(`));
  const end = source.indexOf("  return (", begin);
  if (begin < 0 || end < begin) throw new Error(`Record component fixture moved: ${name}`);
  return source.slice(begin, end);
}
const ok = (wire, value) => ({ $tag: "Ok", _0: { wire, value: { $tag: "Just", _0: value } } });
const missing = wire => ({ $tag: "Ok", _0: { wire, value: { $tag: "Nothing" } } });
function fixture(name, options = {}) {
  let dispose;
  const h = createRoot(close => {
    dispose = close;
    const baseFrame = { label: "reader frame" }, customFrame = { label: "provided frame" };
    const supplied = options.localNative ? options.supplied : options.native ? customFrame : options.custom ? customFrame : undefined;
    const privateFrame = options.mismatched ? { label: "other derived context" } : customFrame;
    const [value, setValue] = createSignal(options.value ?? { $tag: "First", _0: "old" });
    const [path, setPath] = createSignal(["first", "_0"]);
    const [ready, setReady] = createSignal(true);
    const fields = [{ name: "title", type: { $ref: "String" }, isRecursive: false }];
    const view = { selfRef: { $mu: { var: "X", body: { $unit: true } } }, cases: [
      { name: "First", fields }, { name: "Second", fields: [...fields, { name: "count", type: { $ref: "Nat" }, isRecursive: false }] },
    ] };
    const calls = [], writes = [], defaults = [];
    const props = { get value() { return value(); }, onChange: changed => writes.push(changed), fields, view,
      type: { $variant: { discriminator: "kind", cases: [] } }, get path() { return path(); }, evaluateContext: supplied,
      nativeRecordContext: options.localNative ? { representationTypeName: "Rational" }
        : options.native ? { representationTypeName: "Rational", evaluateContext: privateFrame } : undefined };
    let captured;
    const createReaderRecordOperations = (request, owner) => {
      const currentRequest = createMemo(request), coordinate = createMemo(owner.coordinate);
      captured = { request: currentRequest, owner };
      return { paint: () => ({ value: currentRequest().value, coordinate: coordinate(), recordSlots: options.slots ?? [
        { field: "kind", slot: ok("kind", "First") }, { field: "title", slot: ok("_0", "source title") }, { field: "count", slot: missing("count") },
      ] }), ready, error: () => undefined,
      edit: (...args) => calls.push(args) };
    };
    const session = options.localNative ? { get evaluateContext() { if (options.poisoned) throw new Error("Page evaluator read for a Local reader"); return baseFrame; } }
      : { evaluateContext: baseFrame };
    const imports = { props, createMemo, createSignal, latest, createReaderRecordOperations,
      useReaderRuntime: () => ({ session: () => session }), useAuthoringSession: () => session,
      variantValueDiscriminator: () => "kind", pathEquals: () => false,
      defaultValueFor: type => { defaults.push(type); return "legacy default"; } };
    const code = name === "RecordEditor" ? "return { setField, record, paintedFields, paintedValue };"
      : "return { setField, onPickCase, currentCase, tagSlot, record };";
    const api = new Function(...Object.keys(imports), transpiler.transformSync(`${component(name)}\n${code}`))(...Object.values(imports));
    createEffect(() => captured.request(), () => {});
    return { api, calls, writes, defaults, captured, props, fields, view, baseFrame, customFrame, setValue, setReady, setPath };
  });
  flush(); return { ...h, dispose: () => { dispose(); flush(); } };
}

describe("VVE shared structural record operations", () => {
  test("record fields request one batch and delegate edits without page slot/edit semantics", () => {
    const h = fixture("RecordEditor");
    try {
      expect(h.captured.request()).toEqual({ value: h.props.value, fields: ["title"] });
      expect(h.api.paintedFields()).toBe(h.fields);
      const edited = { exact: "returned numeric carrier" }, publish = () => {};
      h.api.setField("title", edited, publish);
      expect(h.calls).toEqual([["title", edited, publish]]);
      expect(h.writes).toEqual([]); expect(h.defaults).toEqual([]);
    } finally { h.dispose(); }
  });

  test("variant discriminator and all case fields share the same source batch", () => {
    const h = fixture("VariantBody");
    try {
      expect(h.captured.request().fields).toEqual(["kind", "title", "title", "count"]);
      expect(h.api.currentCase()).toBe("First");
      expect(h.api.tagSlot()).toEqual(ok("kind", "First"));
      const publish = () => {}; h.api.setField("title", 3, publish);
      expect(h.calls).toEqual([["title", 3, publish]]);
    } finally { h.dispose(); }
  });

  test("case creation retains the existing named carry/default path and blocks pending gestures", () => {
    const h = fixture("VariantBody");
    try {
      h.setReady(false); flush(); h.api.onPickCase("Second"); expect(h.writes).toEqual([]); expect(h.defaults).toEqual([]);
      h.setReady(true); flush(); h.api.onPickCase("Second");
      expect(h.writes).toEqual([{ kind: "Second", title: "source title", count: "legacy default" }]);
      expect(h.defaults).toEqual([{ $ref: "Nat" }]);
    } finally { h.dispose(); }
  });

  for (const name of ["RecordEditor", "VariantBody"]) {
    test(`${name} carries physical occurrence path only in its private publication coordinate`, () => {
      const h = fixture(name);
      try {
        const before = h.captured.owner.coordinate();
        expect(before.path).toEqual(["first", "_0"]);
        expect(Object.hasOwn(h.captured.request(), "path")).toBe(false);
        h.setPath(["second", "_0"]); flush();
        const after = h.captured.owner.coordinate();
        expect(after.path).toEqual(["second", "_0"]); expect(after.path).not.toBe(before.path);
      } finally { h.dispose(); }
    });
    test(`${name} emits only a matching native context's inert selector`, () => {
      const h = fixture(name, { native: true });
      try {
        expect(h.captured.request().representationTypeName).toBe("Rational");
        expect(Object.hasOwn(h.captured.request(), "evaluateContext")).toBe(false);
        expect(h.captured.owner.evaluateContext()).toBe(h.customFrame);
        expect(typeof h.captured.owner.publication().callback).toBe("function");
      } finally { h.dispose(); }
    });
    test(`${name} leaves an unrecognized explicit context with its in-process owner`, () => {
      const h = fixture(name, { native: true, mismatched: true });
      try {
        expect(Object.hasOwn(h.captured.request(), "representationTypeName")).toBe(false);
        expect(h.captured.owner.evaluateContext()).toBe(h.customFrame);
      } finally { h.dispose(); }
    });
  }

  test("native lexical context identity is independent of a value echo", () => {
    const componentStart = source.indexOf("function NativeRepresentationEditor(");
    const begin = source.indexOf("  const nativeRecordContext =", componentStart), end = source.indexOf("  const projection =", begin);
    if (begin < 0 || end < begin) throw new Error("Native record context fixture moved.");
    let dispose;
    const h = createRoot(close => {
      dispose = close;
      const [session, setSession] = createSignal({ evaluateContext: { label: "first frame" } });
      const [value, setValue] = createSignal(1), [typeName, setTypeName] = createSignal("Rational");
      const props = { get typeName() { return typeName(); }, get value() { return value(); } }, calls = [];
      const memo = new Function("props", "frame", "createMemo", "runtimeRepresentationNativeContext", "local",
        transpiler.transformSync(`${source.slice(begin, end)}; return nativeRecordContext;`))(
        props, session, createMemo, (frame, owner) => { const context = { frame, owner }; calls.push(context); return context; }, () => false);
      createEffect(memo, () => {});
      return { memo, calls, setValue, setTypeName, setSession };
    });
    try {
      flush(); const first = h.memo(); h.setValue(2); flush(); expect(h.memo()).toBe(first); expect(h.calls).toHaveLength(1);
      h.setTypeName("Int"); flush(); expect(h.memo()).not.toBe(first); expect(h.calls).toHaveLength(2);
      h.setSession({ evaluateContext: { label: "replacement frame" } }); flush(); expect(h.calls).toHaveLength(3);
    } finally { dispose(); flush(); }
  });

  // B4 wave 1 lane B: a Local reader's representation frame is selected by
  // name in its worker; the page derives no native context for it.
  test("a Local native record context carries only the inert name and reads no page frame", () => {
    const componentStart = source.indexOf("function NativeRepresentationEditor(");
    const begin = source.indexOf("  const nativeRecordContext =", componentStart), end = source.indexOf("  const projection =", begin);
    let dispose;
    const h = createRoot(close => {
      dispose = close;
      const frame = () => { throw new Error("Page session read for a Local reader"); };
      const [typeName, setTypeName] = createSignal("Rational"), calls = [];
      const props = { get typeName() { return typeName(); } };
      const memo = new Function("props", "frame", "createMemo", "runtimeRepresentationNativeContext", "local",
        transpiler.transformSync(`${source.slice(begin, end)}; return nativeRecordContext;`))(
        props, frame, createMemo, (...args) => { calls.push(args); return {}; }, () => true);
      createEffect(memo, () => {});
      return { memo, calls, setTypeName };
    });
    try {
      flush(); expect(h.memo()).toEqual({ representationTypeName: "Rational" }); expect(h.calls).toEqual([]);
      h.setTypeName("Int"); flush(); expect(h.memo()).toEqual({ representationTypeName: "Int" }); expect(h.calls).toEqual([]);
    } finally { dispose(); flush(); }
  });
  // The union branch admission below a representation stays a page consumer:
  // under a Local name-only native context it judges in that same native frame.
  for (const [label, options, expected] of [
    ["a Local name-only native context", { native: { representationTypeName: "Nat" } }, "native"],
    ["no native context", {}, "base"],
    ["an explicit frame", { native: { representationTypeName: "Nat" }, supplied: { label: "explicit" } }, "explicit"],
  ]) test(`UnionValueEditor judges its branches in the native frame of ${label}`, () => {
    const componentStart = source.indexOf("function UnionValueEditor(");
    const begin = source.indexOf("  const authoring =", componentStart), end = source.indexOf("  return <div class=\"vve-union\">", begin);
    if (begin < 0 || end < begin) throw new Error("Union editor fixture moved.");
    let dispose;
    const h = createRoot(close => {
      dispose = close;
      const base = { label: "base" }, native = { label: "native" }, judged = [], derived = [];
      const session = { evaluateContext: base, registry: { label: "registry" } };
      const props = { branches: [{ $ref: "A" }, { $ref: "B" }], value: 1, evaluateContext: options.supplied,
        nativeRecordContext: options.native };
      const api = new Function("props", "createMemo", "createSignal", "useAuthoringSession", "useReaderRuntime", "frameAccount",
        "validateValue", "fieldUnionBranchSelectionPlan", "runtimeRepresentationNativeContext",
        transpiler.transformSync(`${source.slice(begin, end)}; return { context, initial };`))(
        props, createMemo, createSignal, () => session, () => ({ session: () => session }), () => undefined,
        (_branch, _value, _account, settings) => { judged.push(settings.functions); return { valid: true }; },
        admitted => admitted.indexOf(true),
        (frame, name) => { derived.push([frame, name]); return native; });
      createEffect(api.initial, () => {});
      return { api, judged, derived, base, native };
    });
    try {
      flush();
      const frames = { native: h.native, base: h.base, explicit: options.supplied };
      expect(h.api.context()).toBe(frames[expected]);
      expect(h.judged.every(frame => frame === frames[expected])).toBe(true);
      expect(h.derived).toEqual(expected === "native" ? [[h.base, "Nat"]] : []);
    } finally { dispose(); flush(); }
  });
  for (const name of ["RecordEditor", "VariantBody"]) {
    test(`${name} sends a Local name-only native selector without reading the page evaluator`, () => {
      const h = fixture(name, { localNative: true, poisoned: true });
      try {
        expect(h.captured.request().representationTypeName).toBe("Rational");
        expect(Object.hasOwn(h.captured.request(), "evaluateContext")).toBe(false);
      } finally { h.dispose(); }
    });
    test(`${name} drops a Local name-only selector under an explicit frame`, () => {
      const supplied = { label: "explicit frame" };
      const h = fixture(name, { localNative: true, supplied });
      try {
        expect(Object.hasOwn(h.captured.request(), "representationTypeName")).toBe(false);
        expect(h.captured.owner.evaluateContext()).toBe(supplied);
      } finally { h.dispose(); }
    });
  }
});
