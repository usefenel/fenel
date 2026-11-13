// resolution-substrate Phase 5.1 — the conformance ORACLE (KEPT).
//
// Phase 5.1 ports the bare-name dispatch resolver to `.fenel`
// (`fenel/modules/engine/dispatch.fenel:rsvResolveBareName`), fed by the
// build-projected `RoutingTable` value (`registry.ts:routingTable()`). This test
// proves the live Fenel resolver BYTE-IDENTICAL to its TS oracle/fallback
// (`effect-dispatch.ts:resolveMethod` + `registry.ts:classifyBareName`, consulted
// via `_resolveBareName`) over the dispatch corpus. The compiled Fenel artifact
// is the normal live path; the interpreted Fenel body and TS fallback stay in
// this three-way oracle so an optimization cannot silently change semantics.
//
// The comparison is SEMANTIC (the load-bearing projection the 5.3 call-site fork
// forks on): `Resolved fnId` (the field `applyResolvedMethod` acts on),
// `Direct` (the fast-path fall-through), `Ambiguous` (the kind + name the
// `formatBareAmbiguity` throw reads), `Conflicted key`, `UnderApplied pos` (the
// eta-defer signal), `NoInstance`. The TS `MethodResolution` carries extra
// fields (`source`/`reason`/`candidates`/`dispatchPos` on Unique) the call path
// ignores — those are NOT compared.
//
// Corpus: the `Sequential` List-vs-Vec dispatch (phase2) + the `Containable`
// String-vs-List (phase1b) over the real system modules, PLUS a controlled spec
// registry mirroring phase1's fixtures (dispatch / ambiguousClass /
// ambiguousModule / bare-method / Conflict / eta-defer / block-scope override /
// Direct). This is the parser-substrate FenelModule-deep-eq oracle applied to
// resolution.
import { beforeAll, test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { algebraModule } from "./modules/algebra";
import { decidableMembershipModule } from "./modules/decidable-membership";
import {
  deriveFunctorModule,
  getResolverNamespace,
  resolverArtifactFresh,
  setResolverInterpreted,
} from "./engine-bodies-dispatch";
import type { ModuleRegistry, RoutingTableValue } from "./registry";
import { createDispatchRegistry, type DispatchRegistry } from "./dispatch-registry";
import { resolveMethod } from "./effect-dispatch";
import { evaluate } from "./json-logic";
import type { EvaluateContext, BareNameResolution, MethodResolution } from "./json-logic";
import type { FenelModule, FenelFunction, FieldDef } from "./types";

// rights R3a — the owner of the transient fixture rows this file adds and
// removes. Removal names an owner now; a global row is not removable.
const R3A_TRANSIENT_OWNER = "r3a-phase5-transient-owner";

let createRegistry: typeof import("./registry").createRegistry;
let dispatchModule: FenelModule;
let dispatchRegistry: DispatchRegistry;
beforeAll(async () => {
  ({ createRegistry } = await import("./registry"));
  ({ dispatchModule } = await import("./modules/dispatch"));
  ({ dispatchRegistry } = await import("./system-entities"));
});

const fld = (name: string, type: unknown): FieldDef => ({ name, type } as unknown as FieldDef);

// ===========================================================================
// The semantic projection — collapse BOTH the TS pipeline and the Fenel
// `ResolveOutcome` to one comparable shape (the load-bearing fields only).
// ===========================================================================
type Outcome =
  | { tag: "Resolved"; fnId: unknown }
  | { tag: "Direct" }
  | { tag: "Ambiguous"; kind: string; name: string }
  | { tag: "Conflicted"; key: string }
  | { tag: "UnderApplied"; pos: number }
  | { tag: "NoInstance" };

/** TS side — classify, then (for a dispatch route) resolveMethod, projected. */
function tsOutcome(
  ctx: EvaluateContext,
  spec: DispatchRegistry,
  name: string,
  args: unknown[],
  frames: unknown[],
  tags: string[],
): Outcome {
  const verdict = ctx._resolveBareName!(name) as BareNameResolution;
  if (verdict.kind === "direct") return { tag: "Direct" };
  if (verdict.kind === "ambiguousClass" || verdict.kind === "ambiguousModule") {
    return { tag: "Ambiguous", kind: verdict.kind, name: verdict.name };
  }
  const scoped: EvaluateContext = { ...ctx, _dictStack: frames as never, _activeTags: tags };
  const r: MethodResolution = resolveMethod(verdict.typeName, name, args, scoped, spec);
  if (r.$tag === "Unique") return { tag: "Resolved", fnId: r.method };
  if (r.$tag === "Conflict") return { tag: "Conflicted", key: r.key };
  if (r.underApplied) return { tag: "UnderApplied", pos: r.dispatchPos! };
  return { tag: "NoInstance" };
}

/** Fenel side — call `dispatch:rsvResolveBareName` over the projected table,
 *  project its `ResolveOutcome` value. Frames are passed innermost-FIRST (the
 *  resolver walks them head-first); the TS `_dictStack` is innermost-LAST, so
 *  the caller reverses. */
function fenelOutcome(
  ctx: EvaluateContext,
  table: RoutingTableValue,
  name: string,
  args: unknown[],
  fenelFrames: unknown[],
  tags: string[],
): Outcome {
  // Pass the pre-computed JS values as DATA vars so the `call` op returns them
  // verbatim (a raw object/array arg would be re-evaluated by `evaluate`).
  //
  // resolution-substrate Phase 5.4 — evaluate the resolver body IN ISOLATION: strip
  // `_routingTable` so the LIVE flip does NOT fire for the resolver's OWN internal
  // bare calls (`mapGet`/`head`/`rsvInstancesFor`/…). This is exactly how the
  // resolver runs in production — the compiled path is self-contained JS (no flip),
  // and the interpreted fallback runs GUARDED (the flip's re-entry guard forces its
  // internals onto the direct path). Without the strip, even the bounded scans of an
  // already-indexed instance bucket would re-enter the flip per helper call — a test
  // artifact, not a production path.
  const isoCtx: EvaluateContext = { ...ctx, _routingTable: undefined };
  const out = evaluate(
    {
      call: [
        "dispatch:rsvResolveBareName",
        { var: "table" },
        { var: "name" },
        { var: "args" },
        { var: "frames" },
        { var: "tags" },
        // ⚠ rights R3a — THE SIXTH ARGUMENT. `rsvResolveBareName` threads the
        // frame's own account beside the tags, as a Fenel `Maybe String`. A
        // five-argument call does not error: a Fenel body applied to too few
        // arguments returns a CURRIED PARTIAL, so every outcome projected as
        // `$tag: undefined` and the whole oracle read "unexpected
        // ResolveOutcome tag". `Nothing` here is the no-account frame, which is
        // what these fixtures model.
        { var: "account" },
      ],
    } as never,
    { table, name, args, frames: fenelFrames, tags, account: { $tag: "Nothing" } },
    isoCtx,
  ) as Record<string, unknown>;
  return projectOutcome(out);
}

/** resolution-substrate Phase 5.2 — the COMPILED side: call the generated
 *  `rsvResolveBareName` JS closure (the manifest-hash-gated artifact, via
 *  `getResolverNamespace`) over the SAME projected table, project its
 *  `ResolveOutcome`. This is the live fast path, proven byte-identical to the
 *  interpreted body (and transitively to TS). */
function compiledOutcome(
  reg: ModuleRegistry,
  table: RoutingTableValue,
  name: string,
  args: unknown[],
  fenelFrames: unknown[],
  tags: string[],
): Outcome {
  const ns = getResolverNamespace(reg);
  if (ns === null) throw new Error("compiled-resolver namespace unavailable (stale artifact?)");
  const fn = ns["rsvResolveBareName"] as (...a: unknown[]) => Record<string, unknown>;
  // rights R3a — the compiled closure takes the same six arguments as the
  // interpreted body; see the note on the interpreted side.
  const out = fn(table, name, args, fenelFrames, tags, { $tag: "Nothing" });
  return projectOutcome(out);
}

/** Project a `ResolveOutcome` value (BOTH the interpreted + compiled paths emit
 *  the SAME shape) to the comparable semantic outcome. ResolveOutcome /
 *  BareResolution payloads ride POSITIONAL (`_0`/`_1`) — the body constructs
 *  them positionally (`Resolved m`, `Ambiguous res`), the engine's construct
 *  convention (json-logic.ts:1182). */
function projectOutcome(out: Record<string, unknown>): Outcome {
  switch (out.$tag) {
    case "Resolved":
      return { tag: "Resolved", fnId: out._0 };
    case "Direct":
      return { tag: "Direct" };
    case "Conflicted":
      return { tag: "Conflicted", key: out._0 as string };
    case "UnderApplied":
      return { tag: "UnderApplied", pos: out._0 as number };
    case "NoInstance":
      return { tag: "NoInstance" };
    case "Ambiguous": {
      const v = out._0 as Record<string, unknown>;
      const kind = v.$tag === "RAmbiguousClass" ? "ambiguousClass" : "ambiguousModule";
      return { tag: "Ambiguous", kind, name: v._0 as string };
    }
    default:
      throw new Error(`unexpected ResolveOutcome tag: ${String(out.$tag)}`);
  }
}

type Frame = { typeName: string; key: string; methods: Record<string, unknown> };
/** A block-scope frame in BOTH shapes — TS `TypeclassDictFrame` ({typeName,
 *  args:[key], methods}) and the Fenel `DictFrame` ({typeName, key, methods}). */
function frame(typeName: string, key: string, methods: Record<string, unknown>): {
  ts: { typeName: string; args: string[]; methods: Record<string, unknown> };
  fenel: Frame;
} {
  return {
    ts: { typeName, args: [key], methods },
    fenel: { typeName, key, methods },
  };
}

/** Run the oracle for one input over one registry — asserts Fenel === TS. */
function assertParity(
  reg: ModuleRegistry,
  spec: DispatchRegistry,
  name: string,
  args: unknown[],
  frames: ReturnType<typeof frame>[] = [],
  tags: string[] = [],
): Outcome {
  const ctx = reg.evaluateContext();
  const table = reg.routingTable();
  const tsFrames = frames.map((f) => f.ts);
  const fenelFrames = frames.map((f) => f.fenel).reverse(); // innermost-first
  const ts = tsOutcome(ctx, spec, name, args, tsFrames, tags);
  const fenel = fenelOutcome(ctx, table, name, args, fenelFrames, tags);
  expect(fenel).toEqual(ts);
  // Phase 5.2 — the compiled artifact runs over the SAME inputs; assert the full
  // parity chain compiled ≡ interpreted ≡ TS (5.1 proved interpreted ≡ TS, so
  // compiled ≡ TS is the byte-identity this phase adds).
  const compiled = compiledOutcome(reg, table, name, args, fenelFrames, tags);
  expect(compiled).toEqual(ts);
  return ts;
}

/** A class containing any zero-arg/non-string pattern deliberately yields
 * NoInstance from both Fenel exact representations; the live evaluator then
 * invokes the TS general matcher. Assert that surrender contract plus the final
 * fallback result, rather than pretending the exact resolver owns patterns. */
function assertGeneralFallbackParity(
  reg: ModuleRegistry,
  spec: DispatchRegistry,
  name: string,
  args: unknown[],
  tags: string[] = [],
): Outcome {
  const ctx = reg.evaluateContext();
  const table = reg.routingTable();
  const scoped: EvaluateContext = { ...ctx, _activeTags: tags };
  const ts = tsOutcome(ctx, spec, name, args, [], tags);
  const fenel = fenelOutcome(scoped, table, name, args, [], tags);
  const compiled = compiledOutcome(reg, table, name, args, [], tags);
  expect(fenel).toEqual({ tag: "NoInstance" });
  expect(compiled).toEqual({ tag: "NoInstance" });
  return ts;
}

// ===========================================================================
// (A) The controlled registry — every classify + resolveMethod outcome.
// Mirrors `resolution-substrate-phase1.test.ts`'s fixtures, extended with a
// same-priority Conflict class + a tag-scoped instance.
// ===========================================================================
function mkFn(id: string, returns: string): FenelFunction {
  return {
    id,
    params: [fld("n", { $ref: "Number" }), fld("xs", { $ref: returns })],
    returns: { $ref: returns },
  };
}

function controlled(): { reg: ModuleRegistry; spec: DispatchRegistry } {
  const spec = createDispatchRegistry();
  // Sliceable s — `slice : Number -> s a -> s a`, dispatch position 1; List +
  // String instances + two codeName bindings ⇒ a genuine dispatch collision.
  spec.defineClass({
    name: "Sliceable",
    params: [{ name: "s" }],
    methods: [
      { name: "slice", params: [fld("_0", { $ref: "Number" }), fld("_1", { $var: "s" })], returns: { $var: "s" } },
    ],
  });
  spec.addInstance({ typeName: "Sliceable", args: ["List"], methods: { slice: "m:sliceList" } });
  spec.addInstance({ typeName: "Sliceable", args: ["String"], methods: { slice: "m:sliceStr" } });
  // Clippable + Croppable both own `clip` ⇒ ambiguousClass.
  spec.defineClass({
    name: "Clippable",
    params: [{ name: "s" }],
    methods: [{ name: "clip", params: [fld("_0", { $ref: "Number" }), fld("_1", { $var: "s" })], returns: { $var: "s" } }],
  });
  spec.defineClass({
    name: "Croppable",
    params: [{ name: "s" }],
    methods: [{ name: "clip", params: [fld("_0", { $ref: "Number" }), fld("_1", { $var: "s" })], returns: { $var: "s" } }],
  });
  // Choppable.chop — a bare-method (nB===0): one arg-dispatched class, one List
  // instance, NO codeName binding. Dispatches HARD (List → Resolved; String →
  // NoInstance).
  spec.defineClass({
    name: "Choppable",
    params: [{ name: "s" }],
    methods: [{ name: "chop", params: [fld("_0", { $ref: "Number" }), fld("_1", { $var: "s" })], returns: { $var: "s" } }],
  });
  spec.addInstance({ typeName: "Choppable", args: ["List"], methods: { chop: "m:chopList" } });
  // Dupable.dup — a bare-method with TWO List instances at the SAME priority ⇒
  // Conflict.
  spec.defineClass({
    name: "Dupable",
    params: [{ name: "s" }],
    methods: [{ name: "dup", params: [fld("_0", { $var: "s" })], returns: { $var: "s" } }],
  });
  spec.addInstance({ typeName: "Dupable", args: ["List"], methods: { dup: "m:dupA" } });
  spec.addInstance({ typeName: "Dupable", args: ["List"], methods: { dup: "m:dupB" } });
  // Tagable.tg — adversarial registry order/priority: two tag-scoped List
  // instances come first at priority 10; the global fallback comes last at 0.
  // An inactive tag must be excluded from BOTH conflict detection and selection.
  spec.defineClass({
    name: "Tagable",
    params: [{ name: "s" }],
    methods: [{ name: "tg", params: [fld("_0", { $var: "s" })], returns: { $var: "s" } }],
  });
  spec.addInstance({
    typeName: "Tagable",
    args: ["List"],
    methods: { tg: "m:tgTaggedExp" },
    scope: { kind: "tag", tag: "exp" },
    priority: 10,
  });
  spec.addInstance({
    typeName: "Tagable",
    args: ["List"],
    methods: { tg: "m:tgTaggedOther" },
    scope: { kind: "tag", tag: "other" },
    priority: 10,
  });
  spec.addInstance({
    typeName: "Tagable",
    args: ["List"],
    methods: { tg: "m:tgGlobal" },
    priority: 0,
  });
  // Exact routing must not alias a non-string type pattern into a reflected
  // string key (`String(42) === "42"`). The non-string row is deliberately
  // first and higher priority so any coercion is observable.
  spec.defineClass({
    name: "NonStringRoutable",
    params: [{ name: "s" }],
    methods: [{ name: "nonStringProbe", params: [fld("_0", { $var: "s" })], returns: { $var: "s" } }],
  });
  spec.addInstance({
    typeName: "NonStringRoutable",
    args: [42 as never],
    methods: { nonStringProbe: "m:coercedWrong" },
    priority: 100,
  });
  spec.addInstance({
    typeName: "NonStringRoutable",
    args: ["42"],
    methods: { nonStringProbe: "m:exact42" },
  });
  // All priorities are below the old -1 sentinel. The real maximum (-3) must
  // still win.
  spec.defineClass({
    name: "DeepPriority",
    params: [{ name: "s" }],
    methods: [{ name: "deepPriority", params: [fld("_0", { $var: "s" })], returns: { $var: "s" } }],
  });
  spec.addInstance({ typeName: "DeepPriority", args: ["List"], methods: { deepPriority: "m:priorityMinus7" }, priority: -7 });
  spec.addInstance({ typeName: "DeepPriority", args: ["List"], methods: { deepPriority: "m:priorityMinus3" }, priority: -3 });
  // A tag named `global` is still a tag, not global scope.
  spec.defineClass({
    name: "GlobalNamedTag",
    params: [{ name: "s" }],
    methods: [{ name: "globalTagProbe", params: [fld("_0", { $var: "s" })], returns: { $var: "s" } }],
  });
  spec.addInstance({
    typeName: "GlobalNamedTag",
    args: ["List"],
    methods: { globalTagProbe: "m:tagNamedGlobal" },
    scope: { kind: "tag", tag: "global" },
    priority: 10,
  });
  spec.addInstance({
    typeName: "GlobalNamedTag",
    args: ["List"],
    methods: { globalTagProbe: "m:actuallyGlobal" },
  });
  // Mixed exact + general rows share the registry matcher's one visible
  // priority ordering. The exact Fenel index must surrender this entire class
  // to the general TS fallback rather than preempting the wildcard.
  spec.defineClass({
    name: "MixedRoutable",
    params: [{ name: "s" }],
    methods: [{ name: "mixedProbe", params: [fld("_0", { $var: "s" })], returns: { $var: "s" } }],
  });
  spec.addInstance({
    typeName: "MixedRoutable",
    args: ["List"],
    methods: { mixedProbe: "m:mixedList" },
    priority: 0,
  });
  spec.addInstance({
    typeName: "MixedRoutable",
    args: ["String"],
    methods: { mixedProbe: "m:mixedStringTagged" },
    scope: { kind: "tag", tag: "exp" },
    priority: 20,
  });
  spec.addInstance({
    typeName: "MixedRoutable",
    args: [{ $var: "s" }],
    methods: { mixedProbe: "m:mixedWildcard" },
    priority: 10,
  });
  // Both index dimensions are prototype-hostile semantic names. They must be
  // ordinary own keys, and reflection of the constructor-like tag must not
  // consult Object.prototype.
  spec.defineClass({
    name: "__proto__",
    params: [{ name: "s" }],
    methods: [{ name: "__proto__", params: [fld("_0", { $var: "s" })], returns: { $var: "s" } }],
  });
  spec.addInstance({
    typeName: "__proto__",
    args: ["constructor"],
    methods: { ["__proto__"]: "m:prototypeSafe" },
  });

  const mod: FenelModule = {
    name: "m",
    label: { $tag: "Nothing" } as never,
    functions: [
      mkFn("m:sliceList", "List"),
      mkFn("m:sliceStr", "String"),
      { id: "m:soloFn", params: [fld("n", { $ref: "Number" })], returns: { $ref: "Number" } },
      mkFn("m:mashA", "Number"),
      mkFn("m:mashB", "Number"),
      mkFn("m:clipA", "Number"),
      mkFn("m:clipB", "Number"),
      mkFn("m:chopList", "List"),
      { id: "m:mixedList", params: [fld("value", { $ref: "List" })], returns: { $ref: "String" } },
      { id: "m:mixedStringTagged", params: [fld("value", { $ref: "String" })], returns: { $ref: "String" } },
      { id: "m:mixedWildcard", params: [fld("value", { $ref: "String" })], returns: { $ref: "String" } },
    ],
    instances: [
      { typeName: "Codeable", args: ["m:sliceList"], methods: { codeName: "slice" } },
      { typeName: "Codeable", args: ["m:sliceStr"], methods: { codeName: "slice" } },
      { typeName: "Codeable", args: ["m:soloFn"], methods: { codeName: "solo" } },
      { typeName: "Codeable", args: ["m:mashA"], methods: { codeName: "mash" } },
      { typeName: "Codeable", args: ["m:mashB"], methods: { codeName: "mash" } },
      { typeName: "Codeable", args: ["m:clipA"], methods: { codeName: "clip" } },
      { typeName: "Codeable", args: ["m:clipB"], methods: { codeName: "clip" } },
    ],
    nativeImpls: {
      "m:sliceList": (n, xs) => (xs as unknown[]).slice(0, n as number),
      "m:sliceStr": (n, s) => (s as string).slice(0, n as number),
      "m:soloFn": (n) => (n as number) * 10,
      "m:mashA": (n) => n,
      "m:mashB": (n) => n,
      "m:clipA": (n) => n,
      "m:clipB": (n) => n,
      "m:chopList": (n, xs) => (xs as unknown[]).slice(0, n as number),
      "m:mixedList": () => "list-exact",
      "m:mixedStringTagged": () => "tagged-exact",
      "m:mixedWildcard": () => "wildcard",
    },
  };
  // The resolver certificate covers its lowering pipeline. Include the engine
  // declarations so this custom routing registry can certify the shard; the
  // shard-local roster deliberately excludes unrelated `mod` declarations.
  const reg = createRegistry([stdModule, engineModule, dispatchModule, mod], { dispatchRegistry: spec });
  return { reg, spec };
}

describe("Phase 5.1 oracle — controlled registry (every outcome)", () => {
  let reg: ModuleRegistry;
  let spec: DispatchRegistry;
  beforeAll(() => {
    ({ reg, spec } = controlled());
  }, 180_000);
  const LIST = [5, 6, 7, 8];

  test("dispatch → Resolved by the reflected type (List native vs String native)", () => {
    expect(assertParity(reg, spec, "slice", [2, LIST])).toEqual({ tag: "Resolved", fnId: "m:sliceList" });
    expect(assertParity(reg, spec, "slice", [2, "abcdef"])).toEqual({ tag: "Resolved", fnId: "m:sliceStr" });
  });

  test("Direct — a single-binding name (route miss = the fast path)", () => {
    expect(assertParity(reg, spec, "solo", [3])).toEqual({ tag: "Direct" });
    expect(assertParity(reg, spec, "neverHeardOf", [1])).toEqual({ tag: "Direct" });
  });

  test("Ambiguous — ambiguousModule (mash: 2 unrelated bindings, no class)", () => {
    expect(assertParity(reg, spec, "mash", [1])).toEqual({ tag: "Ambiguous", kind: "ambiguousModule", name: "mash" });
  });

  test("Ambiguous — ambiguousClass (clip: declared by Clippable + Croppable)", () => {
    expect(assertParity(reg, spec, "clip", [1, LIST])).toEqual({ tag: "Ambiguous", kind: "ambiguousClass", name: "clip" });
  });

  test("bare-method (chop) — List → Resolved; String → NoInstance (no String instance)", () => {
    expect(assertParity(reg, spec, "chop", [2, LIST])).toEqual({ tag: "Resolved", fnId: "m:chopList" });
    expect(assertParity(reg, spec, "chop", [2, "abc"])).toEqual({ tag: "NoInstance" });
  });

  test("UnderApplied — the eta wrinkle (`slice 2` with the sequence absent)", () => {
    expect(assertParity(reg, spec, "slice", [2])).toEqual({ tag: "UnderApplied", pos: 1 });
  });

  test("Conflict — two List instances tied at the top priority (`dup`)", () => {
    expect(assertParity(reg, spec, "dup", [LIST])).toEqual({ tag: "Conflicted", key: "List" });
  });

  test("scope visibility fences selection and conflicts before priority", () => {
    // Both high-priority tagged rows are physically before the global row.
    // Neither may influence an untagged call; one active tag selects its row;
    // both active tags conflict because they tie at the visible top priority.
    expect(assertParity(reg, spec, "tg", [LIST], [], [])).toEqual({ tag: "Resolved", fnId: "m:tgGlobal" });
    expect(assertParity(reg, spec, "tg", [LIST], [], ["exp"])).toEqual({ tag: "Resolved", fnId: "m:tgTaggedExp" });
    expect(assertParity(reg, spec, "tg", [LIST], [], ["exp", "other"])).toEqual({ tag: "Conflicted", key: "List" });
  });

  test("non-string first arguments never collide with exact string buckets", () => {
    const table = reg.routingTable();
    expect(table.instanceIdx.NonStringRoutable?.["42"]?.map((entry) => entry.methods.nonStringProbe)).toEqual([
      "m:exact42",
    ]);
    expect("instances" in table).toBe(false);
    expect(assertGeneralFallbackParity(reg, spec, "nonStringProbe", [{ $tag: "42" }])).toEqual({
      tag: "Resolved",
      fnId: "m:exact42",
    });
  });

  test("mixed exact/general classes surrender to one visible priority matcher", () => {
    const table = reg.routingTable();
    expect(Object.getPrototypeOf(table.generalIdx)).toBeNull();
    expect(table.generalIdx.MixedRoutable).toBe(true);
    expect(table.instanceIdx.MixedRoutable?.List?.map((entry) => entry.methods.mixedProbe)).toEqual([
      "m:mixedList",
    ]);
    expect(assertGeneralFallbackParity(reg, spec, "mixedProbe", [LIST])).toEqual({
      tag: "Resolved",
      fnId: "m:mixedWildcard",
    });
    expect(assertGeneralFallbackParity(reg, spec, "mixedProbe", ["value"])).toEqual({
      tag: "Resolved",
      fnId: "m:mixedWildcard",
    });
    expect(assertGeneralFallbackParity(reg, spec, "mixedProbe", ["value"], ["exp"])).toEqual({
      tag: "Resolved",
      fnId: "m:mixedStringTagged",
    });
  });

  test("the live evaluator hands mixed classes from Fenel exact routing to the general matcher", () => {
    const run = (value: unknown, tags: string[] = []): unknown => {
      const ctx = reg.evaluateContext();
      ctx._activeTags = tags;
      return evaluate(
        { call: ["mixedProbe", { var: "value" }] } as never,
        { value },
        ctx,
      );
    };
    for (const mode of [null, true] as const) {
      setResolverInterpreted(mode);
      try {
        expect(run(LIST)).toBe("wildcard");
        expect(run("value")).toBe("wildcard");
        expect(run("value", ["exp"])).toBe("tagged-exact");
      } finally {
        setResolverInterpreted(null);
      }
    }
  });

  test("maximum priority supports values below -1", () => {
    expect(assertParity(reg, spec, "deepPriority", [LIST])).toEqual({
      tag: "Resolved",
      fnId: "m:priorityMinus3",
    });
  });

  test("a tag literally named global remains gated", () => {
    expect(assertParity(reg, spec, "globalTagProbe", [LIST], [], [])).toEqual({
      tag: "Resolved",
      fnId: "m:actuallyGlobal",
    });
    expect(assertParity(reg, spec, "globalTagProbe", [LIST], [], ["global"])).toEqual({
      tag: "Resolved",
      fnId: "m:tagNamedGlobal",
    });
  });

  test("prototype-hostile class and reflected-key names remain own index keys", () => {
    const table = reg.routingTable();
    expect(Object.prototype.hasOwnProperty.call(table.instanceIdx, "__proto__")).toBe(true);
    const byKey = table.instanceIdx["__proto__"]!;
    expect(Object.getPrototypeOf(byKey)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(byKey, "constructor")).toBe(true);
    expect(byKey["constructor"]?.map((entry) => entry.methods["__proto__"])).toEqual([
      "m:prototypeSafe",
    ]);
    expect(assertParity(reg, spec, "__proto__", [{ $tag: "constructor" }])).toEqual({
      tag: "Resolved",
      fnId: "m:prototypeSafe",
    });
  });

  test("routing table carries an exact, ordered, prototype-safe instance index", () => {
    const table = reg.routingTable();
    expect(Object.getPrototypeOf(table.instanceIdx)).toBeNull();
    expect(Object.getPrototypeOf(table.instanceIdx.Tagable)).toBeNull();
    expect(table.instanceIdx.Tagable?.List?.map((entry) => entry.methods.tg)).toEqual([
      "m:tgTaggedExp",
      "m:tgTaggedOther",
      "m:tgGlobal",
    ]);
    expect(table.instanceIdx.Tagable?.String).toBeUndefined();
  });

  test("routing projection has no duplicate flat persisted-instance roster", () => {
    const table = reg.routingTable();
    expect("instances" in table).toBe(false);
    const ctx = reg.evaluateContext();
    const cases = [
      { tags: [] as string[], expected: { tag: "Resolved", fnId: "m:tgGlobal" } as Outcome },
      { tags: ["exp"], expected: { tag: "Resolved", fnId: "m:tgTaggedExp" } as Outcome },
      { tags: ["exp", "other"], expected: { tag: "Conflicted", key: "List" } as Outcome },
    ];
    for (const { tags, expected } of cases) {
      expect(tsOutcome(ctx, spec, "tg", [LIST], [], tags)).toEqual(expected);
      expect(fenelOutcome(ctx, table, "tg", [LIST], [], tags)).toEqual(expected);
    }
  });

  test("routing-table cache rebuilds on add/remove and preserves bucket order", () => {
    const isolated = controlled();
    const t0 = isolated.reg.routingTable();
    expect(isolated.reg.routingTable()).toBe(t0);

    // rights R3a — removal is OWNER-SCOPED, so the two rows this step later
    // removes have to be OWNED. A global row is not removable through the API
    // at all (§4.7: no production path removes a boot row), which is the point.
    isolated.spec.addInstance({
      typeName: "Tagable",
      args: ["Transient"],
      methods: { tg: "m:transientFirst" },
      scope: { kind: "account", accountId: R3A_TRANSIENT_OWNER },
    });
    isolated.spec.addInstance({
      typeName: "Tagable",
      args: ["Transient"],
      methods: { tg: "m:transientSecond" },
      scope: { kind: "account", accountId: R3A_TRANSIENT_OWNER },
    });
    const t1 = isolated.reg.routingTable();
    expect(t1).not.toBe(t0);
    expect(isolated.reg.routingTable()).toBe(t1);
    expect(t1.instanceIdx.Tagable?.Transient?.map((entry) => entry.methods.tg)).toEqual([
      "m:transientFirst",
      "m:transientSecond",
    ]);

    isolated.spec.removeInstance("Tagable", "Transient", R3A_TRANSIENT_OWNER);
    const t2 = isolated.reg.routingTable();
    expect(t2).not.toBe(t1);
    expect(t2.instanceIdx.Tagable?.Transient).toBeUndefined();
    expect(t2.instanceIdx.Tagable?.List?.map((entry) => entry.methods.tg)).toEqual([
      "m:tgTaggedExp",
      "m:tgTaggedOther",
      "m:tgGlobal",
    ]);
    isolated.spec.removeInstance("Tagable", "Transient", R3A_TRANSIENT_OWNER);
    expect(isolated.reg.routingTable()).toBe(t2);

    isolated.spec.addInstance({
      typeName: "Tagable",
      args: [{ $var: "scope" }],
      methods: { tg: "m:cacheWildcard" },
      scope: { kind: "tag", tag: "cache-general" },
    });
    const t3 = isolated.reg.routingTable();
    expect(t3).not.toBe(t2);
    expect(isolated.reg.routingTable()).toBe(t3);
    expect(t3.generalIdx.Tagable).toBe(true);
    expect(t3.instanceIdx.Tagable?.List?.map((entry) => entry.methods.tg)).toEqual([
      "m:tgTaggedExp",
      "m:tgTaggedOther",
      "m:tgGlobal",
    ]);

    // rights R3a — the coarse `removeInstancesByScope("account")` bucket is
    // GONE. The rows this step used to sweep are TAG rows, and a tag row is not
    // owned by anybody, so the ownership API deliberately cannot touch them:
    // `removeInstancesOwnedBy` on a fresh account removes nothing and the table
    // IDENTITY is therefore unchanged (no mutation, no rebuild). Removing the
    // wildcard row by target is what actually retires the general lane now.
    isolated.spec.removeInstancesOwnedBy("acct-nobody");
    expect(isolated.reg.routingTable()).toBe(t3);

    isolated.spec.removeInstance("Tagable", "cache-exp", "acct-nobody");
    expect(isolated.reg.routingTable()).toBe(t3);
  }, 180_000);

  test("block-scope override — a `withInstance`-style frame wins over the persisted instance", () => {
    const f = frame("Sliceable", "List", { slice: "m:blockSlice" });
    expect(assertParity(reg, spec, "slice", [2, LIST], [f])).toEqual({ tag: "Resolved", fnId: "m:blockSlice" });
    // a frame for a DIFFERENT key does NOT intercept — falls through to persisted.
    const fStr = frame("Sliceable", "String", { slice: "m:blockSlice" });
    expect(assertParity(reg, spec, "slice", [2, LIST], [fStr])).toEqual({ tag: "Resolved", fnId: "m:sliceList" });
  });
});

// ===========================================================================
// (B) The real system modules — the Sequential List-vs-Vec payoff + Containable.
// ===========================================================================
function systemish(): { reg: ModuleRegistry; spec: DispatchRegistry } {
  // The SHARED `dispatchRegistry` (preloaded with the system class seeds — Sequential
  // / Containable / Functor — like `resolution-substrate-phase2.test.ts`); a
  // fresh spec lacks them, so `take` would classify ambiguousModule instead of
  // dispatch Sequential. `decidable-membership` supplies the `set:contains`
  // sibling binding that makes bare `contains` multi-binding ⇒ Containable
  // dispatch (the phase1b corpus). The resolver runs in this registry's ctx
  // (dispatchModule ⇒ `dispatch:rsv*` registered).
  const reg = createRegistry(
    [stdModule, engineModule, algebraModule, deriveFunctorModule, decidableMembershipModule, dispatchModule],
    { dispatchRegistry },
  );
  return { reg, spec: dispatchRegistry };
}

describe("Phase 5.1 oracle — real modules (Sequential + Containable)", () => {
  let reg: ModuleRegistry;
  let spec: DispatchRegistry;
  beforeAll(() => {
    ({ reg, spec } = systemish());
  }, 180_000);
  const LIST4 = [10, 20, 30, 40];
  const VEC4 = { $tag: "Vec", "0": 10, "1": 20, "2": 30, "3": 40 };

  // modules-as-values Phase 2b: the resolved method is the instance's method
  // value, now a qualified reference to the same function (`{$ref: "std.take"}`).
  test("`take` dispatches List → std:take, Vec → algebra:take (the reflected-type payoff)", () => {
    expect(assertParity(reg, spec, "take", [2, LIST4])).toEqual({ tag: "Resolved", fnId: { $ref: "std.take" } });
    expect(assertParity(reg, spec, "take", [2, VEC4])).toEqual({ tag: "Resolved", fnId: { $ref: "algebra.take" } });
  });

  test("`drop` dispatches List → std:drop, Vec → algebra:drop", () => {
    expect(assertParity(reg, spec, "drop", [2, LIST4])).toEqual({ tag: "Resolved", fnId: { $ref: "std.drop" } });
    expect(assertParity(reg, spec, "drop", [2, VEC4])).toEqual({ tag: "Resolved", fnId: { $ref: "algebra.drop" } });
  });

  test("`take 2` (sequence absent) → UnderApplied (the eta-defer, real registry)", () => {
    expect(assertParity(reg, spec, "take", [2])).toEqual({ tag: "UnderApplied", pos: 1 });
  });

  test("`contains` dispatches String → std:contains, List → std:includes (Containable)", () => {
    expect(assertParity(reg, spec, "contains", ["abcdef", "cd"])).toEqual({ tag: "Resolved", fnId: { $ref: "std.contains" } });
    expect(assertParity(reg, spec, "contains", [[1, 2, 3], 2])).toEqual({ tag: "Resolved", fnId: { $ref: "std.includes" } });
  });

  test("the FP-trinity classify dispatch; bare `fmap` over a List → derived Functor (Resolved)", () => {
    // fmap/foldr/traverse are arg-dispatched bare methods; over a List they
    // resolve to the authored List instance. Functor also contains structural
    // pattern instances, so the exact Fenel resolver deliberately surrenders
    // the whole class to the TS general matcher (the same contract pinned for
    // MixedRoutable above).
    expect(assertGeneralFallbackParity(reg, spec, "fmap", [(x: number) => x, LIST4]))
      .toEqual({ tag: "Resolved", fnId: { $ref: "std.map" } });
  });

  test("the hot single-binding operators stay Direct (no regression)", () => {
    for (const name of ["add", "eq", "lt", "map", "length"]) {
      expect(assertParity(reg, spec, name, [1, 2]).tag).toBe("Direct");
    }
  });
});

// ===========================================================================
// (C) Phase 5.2 — the manifest-hash gate (the staleness-safety the artifact
// carries). A fresh artifact serves the compiled namespace; a body that no
// longer matches the embedded hash falls back to interpreted (null namespace),
// never silently serving a stale closure.
// ===========================================================================
describe("Phase 5.2 — the compiled-resolver manifest-hash gate", () => {
  test("a partial registry is uncertifiable and fails closed without throwing", () => {
    const reg = createRegistry([stdModule, dispatchModule], {});
    expect(resolverArtifactFresh(reg)).toBe(false);
    expect(getResolverNamespace(reg)).toBeNull();
  }, 900_000);

  test("the committed artifact matches the live resolver bodies (fresh ⇒ served)", () => {
    const reg = createRegistry([stdModule, engineModule, dispatchModule], {});
    expect(resolverArtifactFresh(reg)).toBe(true);
    const ns = getResolverNamespace(reg);
    expect(ns).not.toBeNull();
    expect(typeof ns!["rsvResolveBareName"]).toBe("function");
    expect(ns!["dispatch:rsvResolveBareName"]).toBe(ns!["rsvResolveBareName"]);
  }, 900_000);

  test("a mutated resolver body ⇒ hash mismatch ⇒ interpreted fallback (null namespace, no crash)", () => {
    const reg = createRegistry([stdModule, engineModule, dispatchModule], {});
    const fn = reg.getFunction("dispatch:rsvRestOf")!;
    const orig = fn.body;
    try {
      // Mutate the body so the live manifest hash no longer matches the artifact.
      (fn as { body?: unknown }).body = { do: [orig] };
      expect(resolverArtifactFresh(reg)).toBe(false);
      // The gate returns null (⇒ the live path would fall back to interpreted) —
      // it does NOT throw and does NOT serve the stale compiled closure.
      expect(getResolverNamespace(reg)).toBeNull();
    } finally {
      (fn as { body?: unknown }).body = orig; // restore the shared module body
    }
  }, 900_000);
});

// ===========================================================================
// (D) Phase 5.4 — the LIVE interpreted-path flip (the dual-path differential).
// The dispatch oracles (phase1/1b/2, effect-dispatch, the derive trinity, the
// array suite) ALREADY run their bare/qualified dispatch through the flipped
// `invokeFunction` end-to-end — their green IS the primary proof. This block
// adds the explicit DUAL-PATH assertion the brief names: the SAME live calls
// resolve identically with the COMPILED resolver (default) and the INTERPRETED
// resolver (`setResolverInterpreted(true)`) — one `.fenel` source, two execution
// modes, byte-identical on the hot seam.
// ===========================================================================
describe("Phase 5.4 — the live flip, dual-path (compiled ≡ interpreted resolver)", () => {
  let reg: ModuleRegistry;
  let ctx: EvaluateContext;
  beforeAll(() => {
    ({ reg } = systemish());
    ctx = reg.evaluateContext();
  }, 180_000);
  const ev = (rule: unknown): unknown => evaluate(rule as never, {}, ctx);
  const LIST = [10, 20, 30, 40];

  /** Run `f` with the COMPILED resolver (default) then the INTERPRETED resolver
   *  (forced), assert identical, and return the (compiled) result. The flip routes
   *  through `dispatchCompiledResolver`, which honors `setResolverInterpreted`. */
  function bothModes(f: () => unknown): unknown {
    setResolverInterpreted(null); // default ⇒ the fresh compiled artifact
    const compiled = f();
    setResolverInterpreted(true); // force the interpreted `.fenel` body
    let interpreted: unknown;
    try {
      interpreted = f();
    } finally {
      setResolverInterpreted(null);
    }
    expect(interpreted).toEqual(compiled);
    return compiled;
  }

  test("bare `take 2` dispatches List → std:take ([10,20]) through the live flip", () => {
    expect(bothModes(() => ev({ call: ["take", 2, LIST] }))).toEqual([10, 20]);
  });

  test("bare `contains` dispatches String → substring, List → element", () => {
    expect(bothModes(() => ev({ call: ["contains", "abcdef", "cd"] }))).toBeTruthy();
    expect(bothModes(() => ev({ call: ["contains", [1, 2, 3], 2] }))).toBeTruthy();
    expect(bothModes(() => ev({ call: ["contains", [1, 2, 3], 9] }))).toBeFalsy();
  });

  test("single-binding `add` stays Direct — no regression on the hot path", () => {
    expect(bothModes(() => ev({ call: ["add", 2, 3] }))).toBe(5);
  });

  test("a no-instance bare dispatch HARD-errors identically in both modes", () => {
    // `take` over a Number reflects key "Number" — no Sequential Number instance
    // (and no derived one) ⇒ the byte-identical `unresolved bare dispatch … via
    // Sequential` throw, via the TS-fallback tail, in both resolver modes.
    for (const interp of [null, true] as const) {
      setResolverInterpreted(interp);
      try {
        expect(() => ev({ call: ["take", 2, 99] })).toThrow(/unresolved bare dispatch "take" via Sequential/);
      } finally {
        setResolverInterpreted(null);
      }
    }
  });
});
