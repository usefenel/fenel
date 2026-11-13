import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadFenelModule } from "../src/fenel-module";
import { dynamicConstructorTableInForce, evaluatorHookGenerationForMemo, installServedDispatcher,
  invokeRuntimeRepresentationMethod, ownDataRead, servedDispatcherMatches, withRuntimeRepresentationProjection,
  type EvaluateContext, type ServedBareNameResolver, type ServedCompleteResolver,
  type ServedDispatchResolver } from "../src/json-logic";
import { invokeSelfHostSourceBody } from "../src/self-host-body-oracle";
import { dispatchCompiledResolver, dispatchCompiledResolveDispatch, dispatchCompiledResolveComplete }
  from "../src/engine-bodies-dispatch";
import { stdNatives, stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";

// C1 source-extracted invocation/admission controls. The unchanged actual Fenel
// helper/dependencies execute in the real evaluator; fixture registry/proof
// identities below are not actual publisher/copy provenance or bootstrap proof.
const stdRoot = new URL("../../../../fenel/modules/std/", import.meta.url);
const modules = ["representation-value.fenel", "hof.fenel", "fromMaybe.fenel"].map(file =>
  loadFenelModule(readFileSync(new URL(file, stdRoot), "utf8"), `owner-facts-${file}`));
const functions = modules.flatMap(module => module.functions ?? []);
const byName = new Map(functions.flatMap(fn => [[fn.id, fn], [fn.id.split(":").at(-1)!, fn]] as const));
const helper = byName.get("std:representationProjectionOwnerFacts")!;
const sourceContext: EvaluateContext = {
  getFunction: name => byName.get(name),
  natives: stdNatives,
  nativesCtx: stdNativesCtx,
  _constructors: { Nothing: [], Just: ["_0"], RepresentationProjectionOwnerFacts: ["all", "owners"] },
};

const dispatchSource = readFileSync(new URL("../src/engine-bodies-dispatch.ts", import.meta.url), "utf8");
const wrapperSource = dispatchSource.slice(dispatchSource.indexOf("export function representationProjectionOwnerFactsFromSource("),
  dispatchSource.indexOf("let engineDeterministicLeaves:"));
const evaluatorSource = readFileSync(new URL("../src/json-logic.ts", import.meta.url), "utf8");
const candidateSource = evaluatorSource.slice(evaluatorSource.indexOf("function runtimeRepresentationOwnerCandidate("),
  evaluatorSource.indexOf("function runtimeRepresentationInspectionPlan("));
const transpile = (source: string) => new Bun.Transpiler({ loader: "ts" }).transformSync(source.replaceAll("export function", "function"));

function fixture() {
  let sourceCalls = 0;
  let snapshotCalls = 0;
  let missingSource = false;
  let constructing = false;
  let fixtureGeneration = 0;
  let fixtures = false;
  let dynamic = false;
  let duringSource: (() => void) | undefined;
  const frames: EvaluateContext[] = [];
  const table = { routeIdx: {}, instanceIdx: {}, generalScopeIdx: {} };
  const canonical = {
    resolveBareName: (() => ({ $tag: "Direct" })) as ServedBareNameResolver,
    resolveDispatch: (() => ({ $tag: "NoInstance" })) as ServedDispatchResolver,
    resolveComplete: (() => ({ $tag: "NoInstance" })) as ServedCompleteResolver,
  };
  installServedDispatcher(canonical);
  const context: EvaluateContext = { ...sourceContext,
    _routingTable: () => table,
    _performTable: {} as never,
    _ioHandlerContext: {} as never,
  };
  const scope = {
    getHarness: () => {
      if (constructing) throw new Error("re-entered while the harness itself is being constructed");
      return { ctx: context, reg: { getFunction: () => missingSource ? undefined : helper } };
    },
    dynamicConstructorTableInForce: (ctx: EvaluateContext) => dynamic || dynamicConstructorTableInForce(ctx),
    withCompiledArtifactEvaluationSnapshot: (_reg: unknown, operation: () => unknown) => { snapshotCalls++; return operation(); },
    withRuntimeRepresentationProjection,
    invokeSelfHostSourceBody: (fn: typeof helper, args: unknown[], ctx: EvaluateContext) => {
      sourceCalls++; frames.push(ctx); duringSource?.();
      return invokeSelfHostSourceBody(fn, args, ctx);
    },
    engineBodyFixturesPresent: () => fixtures,
    servedDispatcherMatches,
    dispatchCompiledResolver: canonical.resolveBareName,
    dispatchCompiledResolveDispatch: canonical.resolveDispatch,
    dispatchCompiledResolveComplete: canonical.resolveComplete,
    get engineFixtureGeneration() { return fixtureGeneration; },
  };
  const wrappers = new Function("scope", `with(scope) { ${transpile(wrapperSource)}; return {
    representationProjectionOwnerFactsFromSource, representationProjectionOwnerFactsMemoGeneration }; }`)(scope);
  const originals = new WeakSet<object>();
  const copies = new WeakSet<object>();
  const candidateScope = {
    routingTableForEvaluation: (ctx: EvaluateContext) => ctx._routingTable!(),
    ownDataRead, evaluatorHookGenerationForMemo, invokeRuntimeRepresentationMethod,
    isVersionedRoutingTableCopy: (root: object) => copies.has(root),
    runtimeRepresentationOwnerFacts: new WeakMap(),
    toLength: (length: number) => length,
    framesForResolver: (ctx: EvaluateContext) => ctx._dictStack ?? [],
    engineRequire: (id: string) => id === "registry"
      ? { isRegistryRoutingTableSnapshot: (root: object) => originals.has(root) }
      : id === "engine-bodies-dispatch" ? wrappers : (() => { throw new Error(`unexpected module ${id}`); })(),
  };
  const candidate = new Function("scope", `with(scope) { ${transpile(candidateSource)}; return runtimeRepresentationOwnerCandidate; }`)(candidateScope) as
    (ctx: EvaluateContext, owner: string) => boolean;
  return {
    context, candidate, wrappers, canonical, originals, copies, frames,
    get sourceCalls() { return sourceCalls; }, get snapshotCalls() { return snapshotCalls; },
    set missingSource(value: boolean) { missingSource = value; }, set constructing(value: boolean) { constructing = value; },
    set fixtures(value: boolean) { fixtures = value; fixtureGeneration++; },
    set dynamic(value: boolean) { dynamic = value; }, set duringSource(value: (() => void) | undefined) { duringSource = value; },
    restore() { installServedDispatcher({ resolveBareName: dispatchCompiledResolver as ServedBareNameResolver,
      resolveDispatch: dispatchCompiledResolveDispatch as ServedDispatchResolver,
      resolveComplete: dispatchCompiledResolveComplete as ServedCompleteResolver }); },
  };
}

function reader(root: object, extra: EvaluateContext = {}): EvaluateContext {
  return { ...sourceContext, ...extra, _routingTable: () => root };
}

function pool(owners: string[] = []) {
  return { instanceIdx: { Reprable: { JsRuntime: owners.map(owner => ({ args: { $tag: "Just", _0: ["JsRuntime", owner] } })) } },
    generalScopeIdx: {} };
}

test("actual Fenel source aggregates only matching complete owner tuples", () => {
  const rows = [
    { args: { $tag: "Just", _0: ["JsRuntime", "Person"] } },
    { args: { $tag: "Just", _0: ["Elsewhere", "Ignored"] } },
    { args: { $tag: "Just", _0: ["JsRuntime"] } },
    { args: { $tag: "Just", _0: ["JsRuntime", "Person"] } },
  ];
  expect(invokeSelfHostSourceBody(helper, [rows], sourceContext)).toMatchObject({ all: false, owners: ["Person", "Person"] });
  expect(invokeSelfHostSourceBody(helper, [[...rows, { args: { $tag: "Nothing" } }]], sourceContext))
    .toMatchObject({ all: true, owners: ["Person", "Person"] });
});

describe("source-extracted internal source invocation and existing memo choreography", () => {
  test("original and copied roots reuse independently across callers; unqualified roots stay live", () => {
    const control = fixture();
    try {
      const original = pool(["Person"]); const copy = pool(["Person"]); const custom = pool(["Person"]);
      control.originals.add(original); control.copies.add(copy);
      for (const root of [original, copy, custom]) {
        expect(control.candidate(reader(root), "Person")).toBe(true);
        expect(control.candidate(reader(root), "Other")).toBe(false);
      }
      expect(control.sourceCalls).toBe(4);
      expect(control.snapshotCalls).toBe(4);
      expect(control.frames.every(frame => frame._performTable === undefined && frame._ioHandlerContext === undefined)).toBe(true);
    } finally { control.restore(); }
  });

  test("caller helper/dependency/lookup/constructor/invocation overrides do not enter private source; authored helper remains ordinary", () => {
    const control = fixture();
    try {
      const root = pool(); control.originals.add(root);
      let rootCalls = 0; let dependencyCalls = 0; let invocationCalls = 0;
      let current = false;
      const custom = reader(root, { ...sourceContext,
        _constructors: { Nothing: ["changed"], RepresentationProjectionOwnerFacts: ["different"] },
        natives: { ...stdNatives, "std:representationProjectionOwnerFacts": () => ({ all: ++rootCalls > 1, owners: [] }),
          head: () => { dependencyCalls++; throw new Error("reader dependency"); } },
        _authoringInvocation: { valueContract: () => { invocationCalls++; return undefined; } } as never,
      });
      expect(control.candidate(custom, "Person")).toBe(false);
      expect(control.candidate(reader(root, { getFunction: () => { throw new Error("reader lookup"); } }), "Person")).toBe(false);
      expect({ rootCalls, dependencyCalls, invocationCalls }).toEqual({ rootCalls: 0, dependencyCalls: 0, invocationCalls: 0 });
      const publicReader = reader(root, { ...sourceContext,
        natives: { ...stdNatives, "std:representationProjectionOwnerFacts": () => ({ all: current, owners: [] }) } });
      expect(invokeRuntimeRepresentationMethod({ $ref: helper.id }, [[]], publicReader)).toEqual({ all: false, owners: [] });
      current = true;
      expect(invokeRuntimeRepresentationMethod({ $ref: helper.id }, [[]], publicReader)).toEqual({ all: true, owners: [] });
    } finally { control.restore(); }
  });

  test("unchanged custom served callback remains live after a warmed canonical hit and canonical restoration", () => {
    const control = fixture();
    try {
      const root = pool(); control.originals.add(root);
      expect(control.candidate(reader(root), "Person")).toBe(false);
      let current = true; let hookCalls = 0;
      const custom: ServedBareNameResolver = (_table, name) => {
        hookCalls++;
        return name === "fold" || name === "std:fold"
          ? { $tag: "Resolved", _0: { __fenelFn: true, params: ["fn", "init", "rows"],
              body: { all: current, owners: [] }, closure: {} } }
          : { $tag: "Direct" };
      };
      installServedDispatcher({ ...control.canonical, resolveBareName: custom });
      expect(control.candidate(reader(root), "Person")).toBe(true);
      current = false;
      expect(control.candidate(reader(root), "Person")).toBe(false);
      expect(hookCalls).toBeGreaterThanOrEqual(2);
      expect(control.sourceCalls).toBe(3);
      installServedDispatcher(control.canonical);
      expect(control.candidate(reader(root), "Person")).toBe(false);
      expect(control.sourceCalls).toBe(3);
    } finally { control.restore(); }
  });

  test("hook and fixture ABA cannot store an answer; unsupported fixture posture computes uncached", () => {
    for (const kind of ["hooks", "fixtures"] as const) {
      const control = fixture();
      try {
        const root = pool(); control.originals.add(root);
        control.duringSource = () => {
          if (kind === "hooks") {
            installServedDispatcher({ ...control.canonical, resolveBareName: () => ({ $tag: "Direct" }) });
            installServedDispatcher(control.canonical);
          } else { control.fixtures = true; control.fixtures = false; }
        };
        expect(control.candidate(reader(root), "Person")).toBe(false);
        control.duringSource = undefined;
        expect(control.candidate(reader(root), "Person")).toBe(false);
        expect(control.sourceCalls).toBe(2);
        control.fixtures = true;
        expect(control.candidate(reader(root), "Person")).toBe(false);
        expect(control.candidate(reader(root), "Person")).toBe(false);
        expect(control.sourceCalls).toBe(4);
      } finally { control.restore(); }
    }
  });

  test("frame/general checks stay live and source/constructor/bootstrap refusal never uses caller fallback", () => {
    const control = fixture();
    try {
      const root = pool(); control.originals.add(root);
      let frameCalls = 0; let present = false;
      const context = reader(root, { _dictStack: [{ typeName: "Reprable", args: [], methods: {} }],
        natives: { ...stdNatives, "std:representationProjectionFrameCandidate": () => { frameCalls++; return present; } } });
      expect(control.candidate(context, "Person")).toBe(false);
      present = true;
      expect(control.candidate(context, "Person")).toBe(true);
      expect(frameCalls).toBe(2); expect(control.sourceCalls).toBe(1);
      expect(control.candidate(reader({ ...pool(), generalScopeIdx: { Reprable: [{}] } }), "Person")).toBe(true);
      control.missingSource = true;
      expect(() => control.candidate(reader(pool()), "Person")).toThrow("source is unavailable");
      control.missingSource = false; control.dynamic = true;
      expect(() => control.candidate(reader(pool()), "Person")).toThrow("dynamic constructors");
      control.dynamic = false; control.constructing = true;
      expect(() => control.candidate(reader(pool()), "Person")).toThrow("re-entered");
    } finally { control.restore(); }
  });
});
