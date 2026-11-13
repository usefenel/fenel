import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dispatchedPartialEvalInCtx, harnessForTests } from "../src/engine-bodies-dispatch.ts";
import { ownDataRead, readerSourceMetadataEvaluateContext } from "../src/json-logic.ts";
import { viewModule } from "../src/modules/view.ts";
import { readerSourceMetadataNative } from "../../../../fenel/modules/view/ffi/source-metadata.ts";

// Two separate evidence scopes: actual production PE checks a direct native
// remains residual under the existing fold gate; the source-extracted entry
// below observes only transport into runPartialEvaluate, without pretending
// its controlled core result is partial-evaluation semantics. No global mock,
// product registry, native key, or foldable function is added by this fixture.
const source = readFileSync(new URL("../src/engine-bodies-dispatch.ts", import.meta.url), "utf8");
const selectorFrom = source.indexOf("function foldablePureFnIds(");
const selectorTo = source.indexOf("/** Marshal a known-inputs record", selectorFrom);
const entryFrom = source.indexOf("export function dispatchedPartialEvalInCtx(");
const entryTo = source.indexOf("/** A2/B3: carry the reader's exact constructor", entryFrom);
if ([selectorFrom, selectorTo, entryFrom, entryTo].some(index => index < 0)) throw new Error("PE transport source boundary moved");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const selectorCode = transpiler.transformSync(source.slice(selectorFrom, selectorTo));
const entryCode = transpiler.transformSync(source.slice(entryFrom, entryTo)).replace(/^export /gm, "");
const packet = generation => Object.freeze({ $tag: "ReaderSourceMetadata", generation,
  source: Object.freeze({ $tag: "ThisTabSource" }), rootId: "partial-evaluation-reader",
  expressions: Object.freeze([]), occurrences: Object.freeze([]), callableLabels: Object.freeze([]) });
const metadata = context => {
  const value = readerSourceMetadataNative(context);
  return value.$tag === "Just" ? value._0 : undefined;
};

function transportFixture(options = {}) {
  const marker = Object.freeze({ harness: true });
  function getFunction(name) { return name === "harness-owned" ? marker : undefined; }
  const natives = Object.freeze({ harnessNative: () => "harness native" });
  const nativesCtx = Object.freeze({ harnessContextNative: () => "harness context native" });
  const harness = { getFunction, natives, nativesCtx, _constructors: Object.freeze({ Kept: Object.freeze(["value"]) }) };
  if (Object.hasOwn(options, "packet")) harness._readerSourceMetadata = options.packet;
  if (options.freeze !== false) Object.freeze(harness);
  const functions = [{ id: "std:pure", params: [], requires: [] }, { id: "effectful", params: [], requires: [{}] }];
  const registry = { listFunctions: () => functions, functionOptions: () => functions.map(fn => ({ value: fn.id })),
    getFunction: name => functions.find(fn => fn.id === name) };
  const calls = [];
  let core = { kind: "concrete", value: "controlled transport result" };
  const ports = {
    getHarness: () => ({ ctx: harness, reg: registry }), ownDataRead, readerSourceMetadataEvaluateContext,
    runPartialEvaluate: (prog, known, budget, evalCtx, foldable) => {
      calls.push({ prog, known, budget, evalCtx, foldable, packet: metadata(evalCtx) });
      return core;
    },
    dispatchedExprToJsonLogic: expr => ({ egressed: expr }),
  };
  const invoke = new Function(...Object.keys(ports), `${selectorCode}\n${entryCode}\nreturn dispatchedPartialEvalInCtx;`)
    (...Object.values(ports));
  return { invoke, calls, harness, marker, setCore: value => { core = value; } };
}

describe("actual PE direct-native residual boundary", () => {
  test("the actual view readerSourceMetadata native stays residual without entering its native", () => {
    const native = viewModule.functions.find(fn => fn.id === "view:readerSourceMetadata");
    expect(native).toBeDefined();
    expect(native.body).toBeUndefined();
    const implementation = viewModule.nativeImplsCtx[native.id];
    expect(implementation).toBe(readerSourceMetadataNative);
    let entered = 0;
    const selected = packet("caller-only");
    const caller = { _readerSourceMetadata: selected,
      getFunction: name => name === native.id ? native : undefined,
      nativesCtx: { [native.id]: (...args) => { entered++; return implementation(...args); } } };
    expect(metadata(caller)).toBe(selected);
    const program = { call: [native.id] };
    expect(dispatchedPartialEvalInCtx(program, {}, 8, caller)).toEqual({ $tag: "Residual", expr: program });
    expect(entered).toBe(0);
    expect(caller.nativesCtx[native.id]).toBeDefined();
    expect(harnessForTests().ctx.getFunction?.(native.id)).toBeUndefined();
  });

  // Conservative PE repair (2026-10-16, tcb `pe.fold.safe-list`): a caller
  // frame other than the exact harness folds nothing, so peEval is never
  // entered and the call stays residual; with no caller or the harness itself
  // the safe fold still runs (and sees no caller packet).
  test("a pure arithmetic call under a caller packet frame stays residual; only the harness frame folds", () => {
    const harness = harnessForTests().ctx;
    const declaration = harness.getFunction?.("evaluator-strategies:peEval") ?? harness.getFunction?.("peEval");
    const entries = Object.entries(harness.nativesCtx ?? {}).filter(([name]) => name === "peEval"
      || name === declaration?.id || name.endsWith(":peEval"));
    expect(entries.length).toBeGreaterThan(0);
    for (const [name] of entries) expect(Object.getOwnPropertyDescriptor(harness.nativesCtx, name)?.writable).toBe(true);
    const keys = Object.keys(harness.nativesCtx);
    const seen = [];
    try {
      for (const [name, original] of entries) harness.nativesCtx[name] = (context, ...args) => {
        seen.push(metadata(context));
        return original(context, ...args);
      };
      const a = packet("A"), b = packet("B");
      for (const current of [a, b, a, undefined]) {
        const caller = current === undefined ? {} : { _readerSourceMetadata: current };
        expect(dispatchedPartialEvalInCtx({ call: ["std:add", 2, 3] }, {}, 8, caller))
          .toEqual({ $tag: "Residual", expr: { call: ["std:add", 2, 3] } });
      }
      expect(seen).toEqual([]);
      for (const frame of [undefined, harness]) {
        expect(dispatchedPartialEvalInCtx({ call: ["std:add", 2, 3] }, {}, 8, frame))
          .toEqual({ $tag: "Concrete", value: 5 });
      }
      expect(seen).toEqual([undefined, undefined]);
    } finally {
      for (const [name, original] of entries) harness.nativesCtx[name] = original;
    }
    expect(Object.keys(harness.nativesCtx)).toEqual(keys);
    for (const [name, original] of entries) expect(harness.nativesCtx[name]).toBe(original);
  });
});

describe("actual PE entry source transport at the controlled runPartialEvaluate port", () => {
  test("no caller passes the exact harness and forwards the original program, known inputs and budget", () => {
    const stale = packet("harness-owned"), fixture = transportFixture({ packet: stale });
    const program = { call: ["only-observed", 1] }, known = { value: 2 };
    expect(fixture.invoke(program, known, 3, undefined)).toEqual({ $tag: "Concrete", value: "controlled transport result" });
    expect(fixture.calls[0].evalCtx).toBe(fixture.harness);
    expect(fixture.calls[0].prog).toBe(program);
    expect(fixture.calls[0].known).toBe(known);
    expect(fixture.calls[0].budget).toBe(3);
    expect(fixture.calls[0].packet).toBe(stale);
    expect(fixture.calls[0].foldable).toEqual(["std:pure"]);
  });

  test("own caller A/B/A packets arrive only at the PE evaluation context without map merging or harness mutation", () => {
    const stale = packet("stale"), fixture = transportFixture({ packet: stale });
    const descriptors = Object.getOwnPropertyDescriptors(fixture.harness);
    const a = packet("A"), b = packet("B");
    let nativeMapReads = 0;
    for (const current of [a, b, a]) {
      const caller = Object.defineProperties({ _readerSourceMetadata: current }, {
        natives: { get() { nativeMapReads++; throw new Error("Caller natives must not merge"); } },
        nativesCtx: { get() { nativeMapReads++; throw new Error("Caller context natives must not merge"); } },
      });
      fixture.invoke(1, undefined, undefined, caller);
      const observed = fixture.calls.at(-1);
      expect(observed.packet).toBe(current);
      expect(observed.evalCtx.getFunction).toBe(fixture.harness.getFunction);
      expect(observed.evalCtx.natives).toBe(fixture.harness.natives);
      expect(observed.evalCtx.nativesCtx).toBe(fixture.harness.nativesCtx);
      expect(Object.isFrozen(observed.evalCtx)).toBe(true);
      // Conservative repair: a caller frame other than the harness folds nothing.
      expect(observed.foldable).toEqual([]);
      expect(caller._readerSourceMetadata).toBe(current);
    }
    expect(fixture.calls.map(call => call.packet)).toEqual([a, b, a]);
    expect(nativeMapReads).toBe(0);
    expect(Object.getOwnPropertyDescriptors(fixture.harness)).toEqual(descriptors);
    expect(fixture.harness._readerSourceMetadata).toBe(stale);
  });

  test("absence, inherited packets and accessors clear a prior harness packet without evaluating getters", () => {
    const fixture = transportFixture({ packet: packet("stale") });
    let reads = 0;
    const accessor = Object.defineProperty({}, "_readerSourceMetadata", { enumerable: true,
      get() { reads++; throw new Error("Packet getter was invoked"); } });
    for (const caller of [{}, { _readerSourceMetadata: undefined }, Object.create({ _readerSourceMetadata: packet("inherited") }), accessor]) {
      fixture.invoke(1, undefined, undefined, caller);
      const observed = fixture.calls.at(-1);
      expect(observed.packet).toBeUndefined();
      expect(Object.hasOwn(observed.evalCtx, "_readerSourceMetadata")).toBe(true);
      expect(observed.evalCtx.getFunction).toBe(fixture.harness.getFunction);
      expect(Object.isFrozen(observed.evalCtx)).toBe(true);
    }
    expect(reads).toBe(0);
  });

  test("an actual caller without function lookup or any packet retains the exact packet-free harness", () => {
    const fixture = transportFixture();
    fixture.invoke(1, undefined, undefined, {});
    expect(fixture.calls[0].evalCtx).toBe(fixture.harness);
    expect(fixture.calls[0].evalCtx.getFunction).toBe(fixture.harness.getFunction);
    expect(Object.hasOwn(fixture.harness, "_readerSourceMetadata")).toBe(false);
  });

  test("the existing caller function lookup precedence is retained while caller functions never widen the fold set", () => {
    const fixture = transportFixture();
    const selected = packet("caller");
    const own = { caller: true };
    const caller = { _readerSourceMetadata: selected, own,
      getFunction(name) { return name === "caller-owned" ? this.own : undefined; },
      natives: { callerNative: () => "unreachable" }, nativesCtx: { callerContextNative: () => "unreachable" } };
    fixture.invoke(1, {}, 8, caller);
    const observed = fixture.calls[0];
    expect(observed.packet).toBe(selected);
    expect(observed.evalCtx.getFunction("caller-owned")).toBe(own);
    expect(observed.evalCtx.getFunction("harness-owned")).toBe(fixture.marker);
    expect(observed.evalCtx.getFunction("unknown")).toBeUndefined();
    expect(observed.evalCtx.natives).toBe(fixture.harness.natives);
    expect(observed.evalCtx.nativesCtx).toBe(fixture.harness.nativesCtx);
    expect(observed.foldable).toEqual([]);
  });
});
