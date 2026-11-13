// ---------------------------------------------------------------------------
// signature-form-decomposition.test.ts — the Phase 4+4b SHARED raw-form
// decomposition (slice 3e).
//
// THE BATTERY IS IN THREE LAYERS, AND IT IS DELIBERATELY NOT "DRIVE BOTH
// WALKERS OVER ONE CORPUS AND ASSERT THEY AGREE". That does not work here for
// two reasons. The walkers compute DIFFERENT facts — a pattern difference can
// produce no ledger row at all while the observation analysis records an
// effect — and, decisively, they can AGREE ON THE SAME WRONG DECOMPOSITION, as
// they did for the flat lambda's array parameter until this slice. Instead:
//
//   1. `fdc*` fixtures whose expected structural output is read off an
//      EXECUTABLE probe of `evaluate` / `matchPattern` IN THIS FILE. The
//      oracle is the runtime, not a reading of the runtime's source.
//   2. per-consumer expectations off the SAME fixture records — ledger rows for
//      `vlg*`, observation outcomes for `vob*`.
//   3. a STATIC architectural gate: the selected raw-form decisions must
//      DELEGATE to `fdc*`, and local reimplementation is prohibited. This is
//      the ONLY layer that can enforce "delegate instead of re-derive" — a
//      future walker that reimplements the rules CORRECTLY passes every
//      behavioural fixture in layers 1 and 2.
//
// Layer 3 reads the PARSED bodies rather than the source text, so a forbidden
// spelling inside a comment or a doc annotation cannot trip it and a rename
// cannot evade it by whitespace.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, matchPattern } from "./json-logic";
import {
  dispatchEngineBody,
  marshalStoredBodyForValidation,
  dispatchedValidationUseLedger,
  type ValidationLedgerRouteInput,
} from "./engine-bodies-dispatch";
import { loadFenelModule } from "./fenel-module";
import { engineModule } from "./modules/engine";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const read = (relative: string): string => readFileSync(join(REPO, relative), "utf8");

const call = (fn: string, args: unknown[]): any => dispatchEngineBody(`engine:${fn}`, args) as any;

/** A whole marshalled node. */
const M = (x: unknown): any => marshalStoredBodyForValidation(x);
/** A marshalled ARGUMENT LIST — what the plan hands its focused layouts. */
const AL = (x: unknown[]): any[] => (marshalStoredBodyForValidation(x) as any).items;

// ===========================================================================
// LAYER 1 — the plan, pinned by an EXECUTABLE probe of the runtime
// ===========================================================================

/** The binder names `fnOp` + `invokeFunction` actually INSTALL for a `fn` form.
 *
 *  Not a reading of `fnOp`: the closure is really built by `evaluate`, and each
 *  raw parameter entry is really passed through `Object.defineProperty`, which
 *  is exactly what `defineDataContextBinding` does. The resulting own-key IS
 *  the installed spelling, ToPropertyKey and all. */
const installedBinders = (fnArgs: unknown[]): string[] => {
  const closure = evaluate({ fn: fnArgs }, {}, {} as never) as { params: unknown[] };
  return closure.params.map((p) => {
    const probe = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(probe, p as string, {
      value: 1, enumerable: true, configurable: true, writable: true,
    });
    return Object.keys(probe)[0]!;
  });
};

/** The binder names `matchPattern` actually WRITES for a pattern + scrutinee. */
const runtimeBinders = (scrutinee: unknown, pattern: unknown): string[] | null => {
  const out = matchPattern(scrutinee, pattern, {} as never);
  return out === null ? null : Object.keys(out);
};

const layoutNames = (fnArgs: unknown[]): string[] =>
  call("fdcParamSpellings", [call("fdcLambdaLayout", [AL(fnArgs)]).params, []]);
const layoutTotal = (fnArgs: unknown[]): boolean =>
  call("fdcLambdaLayout", [AL(fnArgs)]).namesTotal;

describe("slice 3e layer 1 — the lambda layout against the RUNTIME's own binders", () => {
  // Every entry here is asserted against `installedBinders`, i.e. against
  // `evaluate` + `Object.defineProperty`, never against a reading of the source.
  const EXACT: [string, unknown[]][] = [
    ["canonical", [["x", "y"], { var: "x" }]],
    ["canonical + ignored trailing item", [["x", "y"], { var: "x" }, "TRAILING"]],
    ["canonical, NESTED-ARRAY entry", [[["x"]], { var: "x" }]],
    ["canonical, empty parameter vector", [[], { var: "x" }]],
    ["flat", ["x", { var: "x" }]],
    ["flat, LATER ARRAY parameter", ["x", ["y", "z"], { var: "x" }]],
    ["flat, nested array parameter", ["x", [["y", "z"], "w"], { var: "x" }]],
    ["flat, EMPTY array parameter", ["x", [], { var: "x" }]],
    ["flat, array with an empty hole", ["x", ["a", [], "b"], { var: "x" }]],
    ["flat, body only (a thunk)", [{ var: "x" }]],
    ["empty", []],
  ];

  for (const [label, args] of EXACT) {
    it(`${label}: the plan's binder spellings ARE the runtime's`, () => {
      const runtime = installedBinders(args);
      expect(layoutTotal(args)).toBe(true);
      expect(layoutNames(args)).toEqual(runtime);
      // ... and the ARITY agrees, which is what drives partial application
      expect(call("fdcLambdaLayout", [AL(args)]).params.length).toBe(runtime.length);
    });
  }

  it("THE DEFECT BOTH WALKERS SHARED: a flat array parameter is ONE binder", () => {
    // The runtime `String()`-coerces each leading argument, so the ARRAY is one
    // parameter named "y,z". Both analyses expanded it into two, AGREED with
    // each other, and were both wrong — which is precisely why walker agreement
    // is not the safety net this battery is built on.
    expect(installedBinders(["x", ["y", "z"], { var: "x" }])).toEqual(["x", "y,z"]);
    expect(layoutNames(["x", ["y", "z"], { var: "x" }])).toEqual(["x", "y,z"]);
  });

  it("the join happens at EVERY array level, so an empty hole keeps its separator", () => {
    // `String(["a",[],"b"])` is "a,,b", not "a,b" — flatten-then-join is wrong.
    expect(installedBinders(["x", ["a", [], "b"], { var: "x" }])).toEqual(["x", "a,,b"]);
    expect(layoutNames(["x", ["a", [], "b"], { var: "x" }])).toEqual(["x", "a,,b"]);
  });

  it("an unreproducible entry is OPAQUE, not silently dropped and not guessed", () => {
    // The runtime installs "1" / "[object Object]" / "null" / "true". The plan
    // refuses to manufacture those spellings — a marshalled `JlNull` conflates
    // host null, undefined and unsupported host shapes, whose coercions differ,
    // and rendering a host number from a cloned analysis context is the recorded
    // `[object Object]` landmine. It reports OPAQUE and the consumer fences.
    const args = [[1, { a: 1 }, null, true], { var: "x" }];
    expect(installedBinders(args)).toEqual(["1", "[object Object]", "null", "true"]);
    expect(layoutTotal(args)).toBe(false);
    const params = call("fdcLambdaLayout", [AL(args)]).params;
    expect(params.map((p: any) => p.name.$tag)).toEqual(
      ["FdcNameOpaque", "FdcNameOpaque", "FdcNameOpaque", "FdcNameOpaque"],
    );
  });

  it("the LITERAL/COERCED distinction is kept, and it is load-bearing", () => {
    // `maybeReorderNamedArgs` tests the RAW parameter entries, so a canonical
    // `[["x"]]` installs the binder `x` yet does NOT accept `{x = …}` as a named
    // argument, while a flat `"x"` does. Collapsing the two cases would erase a
    // difference a consumer can legitimately act on.
    const literal = call("fdcLambdaLayout", [AL(["x", { var: "x" }])]).params[0].name.$tag;
    const coerced = call("fdcLambdaLayout", [AL([[["x"]], { var: "x" }])]).params[0].name.$tag;
    expect(literal).toBe("FdcNameLiteral");
    expect(coerced).toBe("FdcNameCoerced");
    expect(read("implementations/typescript/engine/src/json-logic.ts"))
      .toContain("paramNames.includes(k)");
  });

  it("the canonical grammar's trailing items are IGNORED, and the plan says which", () => {
    const layout = call("fdcLambdaLayout", [AL([["x"], { var: "x" }, "TRAILING", 9])]);
    expect(layout.grammar).toBe("canonical");
    expect(layout.ignored.length).toBe(2);
    expect(layout.bodyPresent).toBe(true);
    // the runtime really does drop them: the closure's body is args[1]
    expect((evaluate({ fn: [["x"], { var: "x" }, "TRAILING", 9] }, {}, {} as never) as any).body)
      .toEqual({ var: "x" });
  });
});

describe("slice 3e layer 1 — pattern binder writes against `matchPattern` itself", () => {
  const writes = (pattern: unknown) =>
    call("fdcPatternBindWrites", [M(pattern)]).map((w: any) => ({
      name: w.name.$tag === "FdcNameOpaque" ? null : w.name.name,
      conditional: w.conditional,
    }));
  const total = (pattern: unknown): boolean => call("fdcPatternBindsTotal", [M(pattern)]);

  it("`$bind` is TERMINAL — a sibling binder is never written", () => {
    const pattern = { $tag: "Just", $bind: "whole", _0: { $bind: "v" } };
    expect(runtimeBinders({ $tag: "Just", _0: 3 }, pattern)).toEqual(["whole"]);
    expect(writes(pattern).map((w: any) => w.name)).toEqual(["whole"]);
    expect(total(pattern)).toBe(true);
  });

  it("a nested `$bind` under a constructor writes exactly its own name", () => {
    const pattern = { $tag: "Just", _0: { $bind: "v" } };
    expect(runtimeBinders({ $tag: "Just", _0: 3 }, pattern)).toEqual(["v"]);
    expect(writes(pattern).map((w: any) => w.name)).toEqual(["v"]);
  });

  it("an array pattern writes its items in index order", () => {
    const pattern = [{ $bind: "a" }, { $bind: "b" }];
    expect(runtimeBinders([1, 2], pattern)).toEqual(["a", "b"]);
    expect(writes(pattern).map((w: any) => w.name)).toEqual(["a", "b"]);
  });

  it("duplicate spellings at two depths: the LATER write wins, and the RULE is what is shared", () => {
    // "a later successful write overwrites an earlier one" is state-free and IS
    // published, in runtime write order. "which one wins on THIS scrutinee" is
    // not, and is deliberately not offered.
    const pattern = { a: { $bind: "x" }, b: { $bind: "x" } };
    expect(runtimeBinders({ a: 1, b: 2 }, pattern)).toEqual(["x"]);
    expect(matchPattern({ a: 1, b: 2 }, pattern, {} as never)!["x"]).toBe(2);
    const order = writes(pattern);
    expect(order.map((w: any) => w.name)).toEqual(["x", "x"]);
  });

  it("a non-literal `$bind` is OPAQUE, and the pattern is therefore not total", () => {
    // The runtime binds `String(0)` = "0"; the plan refuses to manufacture it.
    expect(runtimeBinders(7, { $bind: 0 })).toEqual(["0"]);
    expect(writes({ $bind: 0 }).map((w: any) => w.name)).toEqual([null]);
    expect(total({ $bind: 0 })).toBe(false);
    // ... while an ARRAY payload IS reproducible, so it stays total
    expect(runtimeBinders(7, { $bind: ["a", "b"] })).toEqual(["a,b"]);
    expect(writes({ $bind: ["a", "b"] }).map((w: any) => w.name)).toEqual(["a,b"]);
    expect(total({ $bind: ["a", "b"] })).toBe(true);
  });

  it("CRITICAL: a binder under a Boolean-REPRESENTATION pattern is CONDITIONAL", () => {
    // The Boolean fast path matches a `True`/`False` tag pattern against a NATIVE
    // boolean scrutinee and returns an EMPTY binding set BEFORE the structural
    // arm runs. So the nested binder is written for an OBJECT scrutinee and NOT
    // written for a boolean one — an unconditional write list would invent it.
    const pattern = { $tag: "True", payload: { $bind: "f" } };
    expect(runtimeBinders(true, pattern)).toEqual([]);            // matched, no binder
    expect(runtimeBinders({ $tag: "True", payload: 1 }, pattern)).toEqual(["f"]);
    expect(call("fdcPatternPlan", [M(pattern)]).boolReprPossible).toBe(true);
    expect(writes(pattern)).toEqual([{ name: "f", conditional: true }]);
    expect(total(pattern)).toBe(false);
    // an ORDINARY constructor pattern is unaffected — this is not a blanket fence
    expect(call("fdcPatternPlan", [M({ $tag: "Just", _0: { $bind: "v" } })]).boolReprPossible)
      .toBe(false);
    expect(total({ $tag: "Just", _0: { $bind: "v" } })).toBe(true);
  });

  it("the step ORDER is `matchPattern`'s, and the terminal arms are terminal", () => {
    const steps = (p: unknown) => call("fdcPatternPlan", [M(p)]).steps.map((s: any) => s.$tag);
    expect(steps("_")).toEqual(["FdcPatWildcard"]);
    expect(steps({ $bind: "n" })).toEqual(["FdcPatBind"]);
    expect(steps(7)).toEqual(["FdcPatIdentity", "FdcPatFail"]);
    expect(steps([1, 2])).toEqual(["FdcPatIdentity", "FdcPatItems", "FdcPatFail"]);
    expect(steps({ $tag: "True" }))
      .toEqual(["FdcPatIdentity", "FdcPatBoolRepr", "FdcPatFields", "FdcPatFail"]);
    // a NON-Boolean literal tag cannot be ruled out of the wire projection, so
    // the plan surfaces an explicit unresolved marker rather than deciding.
    expect(steps({ $tag: "Just", _0: 1 }))
      .toEqual(["FdcPatIdentity", "FdcPatWireRoute", "FdcPatFields", "FdcPatFail"]);
    // the wildcard really is total, and really binds nothing
    expect(runtimeBinders({ anything: 1 }, "_")).toEqual([]);
  });

  it("a TAGGED carrier's stripped `$tag` is RECONSTRUCTED as a matched key", () => {
    // `Object.keys(pattern)` sees `$tag`; the marshaller does not keep it in
    // `fields`. A decomposition that omitted it would under-report the
    // key-presence requirement the matcher imposes.
    const fields = call("fdcPatternFields", [M({ $tag: "Just", _0: 1 }).fields, "Just", true]);
    expect(fields.map((f: any) => f.key)).toEqual(["$tag", "_0"]);
    expect(fields[0].role.$tag).toBe("FdcPatRoleWireTag");
    // and the matcher really does require the key
    expect(matchPattern({ _0: 1 }, { $tag: "Just", _0: 1 }, {} as never)).toBeNull();
  });

  it("a `$guard` inside a pattern is an ordinary MATCHED field, not a split", () => {
    // `matchOp` strips only a TOP-LEVEL, ARRAY-valued `$guard`.
    expect(matchPattern({ $tag: "Just", _0: 1 }, { $tag: "Just", $guard: [{}, {}] }, {} as never))
      .toBeNull();
    expect(call("fdcGuardSplit", [M({ $tag: "Just", $guard: "not-an-array" })]).guarded).toBe(false);
  });
});

describe("slice 3e layer 1 — the match layout, the call layout, the slot schedules", () => {
  it("a match with FEWER THAN TWO arguments does not evaluate its scrutinee", () => {
    // Probed, not read: a registered probe function records whether it ran.
    const calls: string[] = [];
    const ctx: any = {
      getFunction: (id: string) =>
        id === "probeFn" ? { id: "probeFn", params: [], returns: {} } : undefined,
      natives: { probeFn: () => { calls.push("probeFn"); return 1; } },
    };
    evaluate({ match: [{ call: ["probeFn"] }] }, {}, ctx);
    expect(calls.length).toBe(0);
    calls.length = 0;
    evaluate({ match: [{ call: ["probeFn"] }, "_", 1] }, {}, ctx);
    expect(calls.length).toBe(1);

    expect(call("fdcMatchLayout", [AL([{ call: ["probeFn"] }])]).scrutineePresent).toBe(false);
    expect(call("fdcMatchLayout", [AL([{ call: ["probeFn"] }, "_", 1])]).scrutineePresent).toBe(true);
  });

  it("arms pair from raw index 1 and a lone trailing element is the DEFAULT body", () => {
    const layout = call("fdcMatchLayout", [AL([1, 2, "miss", "dflt"])]);
    expect(layout.arms.length).toBe(1);
    expect(layout.fallbackPresent).toBe(true);
    expect(evaluate({ match: [1, 2, "miss", "dflt"] }, {}, {} as never)).toBe("dflt");
    // a failing GUARD continues to the next arm rather than failing the match
    expect(evaluate({ match: [1, { $guard: [{ $bind: "n" }, false] }, "g", "d"] }, {}, {} as never))
      .toBe("d");
  });

  it("the guard split reads `$guard` off EITHER carrier", () => {
    const plain = call("fdcGuardSplit", [M({ $guard: [{ $bind: "y" }, { var: "y" }] })]);
    const tagged = call("fdcGuardSplit", [M({ $tag: "Just", $guard: [{ $bind: "y" }, { var: "y" }] })]);
    expect(plain.guarded).toBe(true);
    expect(tagged.guarded).toBe(true);
    expect(read("implementations/typescript/engine/src/json-logic.ts"))
      .toContain('ownDataRead(pat, "$guard")');
  });

  it("the `$` application vehicle puts the callee at raw slot 1", () => {
    // Probed: the callee VALUE is applied and the registry is bypassed.
    expect(evaluate({ call: ["$", { fn: [["x"], { var: "x" }] }, 9] }, {}, {} as never)).toBe(9);
    const layout = call("fdcCallLayout", ["call", AL(["$", { fn: [["x"], { var: "x" }] }, 9])]);
    expect(layout.callee.$tag).toBe("FdcCalleeDollar");
    expect(layout.calleePresent).toBe(true);
    expect(layout.slots.map((s: any) => [s.rawIndex, s.logicalIndex])).toEqual([[2, 0]]);
    expect(layout.actualCount).toBe(1);
  });

  it("BOTH index systems are exposed, because the two consumers disagree", () => {
    const layout = call("fdcCallLayout", ["call", AL(["f", 1, 2])]);
    expect(layout.slots.map((s: any) => s.rawIndex)).toEqual([1, 2]);
    expect(layout.slots.map((s: any) => s.logicalIndex)).toEqual([0, 1]);
    // the method form's two leading slots are RAW names the runtime never evaluates
    const method = call("fdcCallLayout", ["method", AL(["C", "m", 1])]);
    expect(method.slots.map((s: any) => [s.role.$tag, s.evaluated])).toEqual([
      ["FdcRoleRawName", false], ["FdcRoleRawName", false], ["FdcRoleActual", true],
    ]);
  });

  it("the eager schedules match what the runtime actually evaluates", () => {
    // Probed with a call-bearing trailing child: if the runtime evaluated it,
    // the probe would fire.
    const calls: string[] = [];
    const ctx: any = {
      getFunction: (id: string) =>
        id === "probeFn" ? { id: "probeFn", params: [], returns: {} } : undefined,
      natives: { probeFn: () => { calls.push("probeFn"); return 1; } },
    };
    const P = { call: ["probeFn"] };
    const fired = (rule: unknown) => { calls.length = 0; evaluate(rule, {}, ctx); return calls.length; };

    expect(fired({ length: [[1], P] })).toBe(0);        // only slot 0
    expect(fired({ in: [1, [1], P] })).toBe(0);         // only slots 0,1
    expect(fired({ deepEq: [1, 1, P] })).toBe(0);       // NOTHING at arity != 2
    expect(fired({ min: [1, 2, P] })).toBe(1);          // every slot
    expect(fired({ ann: [1, P] })).toBe(0);             // only slot 0
    expect(fired({ withInstance: [1, 2, P] })).toBe(0); // NOTHING at arity != 2

    const sched = (op: string) => call("fdcOpSchedule", [op])._0.slots;
    const idx = (op: string, args: unknown[]) =>
      call("fdcScheduledSlots", [sched(op), AL(args)]).map((s: any) => s.rawIndex);
    expect(idx("length", [[1], P])).toEqual([0]);
    expect(idx("in", [1, [1], P])).toEqual([0, 1]);
    expect(idx("deepEq", [1, 1, P])).toEqual([]);
    expect(idx("deepEq", [1, 1])).toEqual([0, 1]);
    expect(idx("min", [1, 2, P])).toEqual([0, 1, 2]);
    expect(idx("withInstance", [1, 2, P])).toEqual([]);
    expect(idx("withInstance", [1, 2])).toEqual([0, 1]);
    // `|>` and `apply` evaluate nothing below arity two, then only the first two
    expect(idx("|>", [1])).toEqual([]);
    expect(idx("|>", [1, 2, 3])).toEqual([0, 1]);
    // the RULE slot is excluded from the evaluated schedule and reached through
    // the form's own ruleIndex; `reduce` evaluates the slots on BOTH sides of it
    expect(idx("map", [1, P, 3])).toEqual([0]);
    expect(idx("reduce", [1, P, 3])).toEqual([0, 2]);
    expect(call("fdcOpSchedule", ["reduce"])._0.form.ruleIndex).toBe(1);
  });

  it("`missing` / `missing_some` evaluate NOTHING — their arguments are raw paths", () => {
    const calls: string[] = [];
    const ctx: any = {
      getFunction: (id: string) =>
        id === "probeFn" ? { id: "probeFn", params: [], returns: {} } : undefined,
      natives: { probeFn: () => { calls.push("probeFn"); return 1; } },
    };
    evaluate({ missing: [{ call: ["probeFn"] }] }, {}, ctx);
    expect(calls.length).toBe(0);
    expect(call("fdcOpSchedule", ["missing"])._0.slots.$tag).toBe("FdcSlotsNone");
    expect(call("fdcOpSchedule", ["missing_some"])._0.form.kind).toBe("missing_some");
  });

  it("the binding layout preserves PRESENCE, and fences an unrecoverable carrier", () => {
    // presence versus emptiness
    expect(call("fdcInlineLet", [M(1)]).present).toBe(false);
    expect(call("fdcInlineLet", [M({ let: {} })]).present).toBe(true);
    // the runtime detects the key by PRESENCE and ignores the siblings
    expect(evaluate({ do: [{ let: { a: 1 }, ignored: 2 }, { var: "a" }] }, {}, {} as never)).toBe(1);
    expect(evaluate({ do: [{ let: { a: 1 }, ignored: 2 }, { var: "ignored" }] }, {}, {} as never))
      .toBeNull();
    expect(call("fdcInlineLet", [M({ let: { a: 1 }, ignored: 2 })]).entries.map((e: any) => e.name))
      .toEqual(["a"]);
    // an item's OWN `$tag` is irrelevant: only `expr.let`'s entries are read
    expect(evaluate({ do: [{ $tag: "X", let: { a: 1 } }, { var: "a" }] }, {}, {} as never)).toBe(1);
    expect(evaluate({ do: [{ $tag: "X", let: { a: 1 } }, { var: "$tag" }] }, {}, {} as never))
      .toBeNull();
    expect(call("fdcInlineLet", [M({ $tag: "X", let: { a: 1 } })]).total).toBe(true);
    // a TAGGED BINDINGS RECORD is the unrecoverable case: `Object.entries`
    // enumerates the discriminator too, and the marshal dropped its position.
    expect(evaluate({ do: [{ let: { $tag: "X", a: 1 } }, { var: "$tag" }] }, {}, {} as never))
      .toBe("X");
    expect(call("fdcInlineLet", [M({ let: { $tag: "X", a: 1 } })]).total).toBe(false);
    expect(call("fdcBindingLayout", ["let", AL([{ $tag: "X", a: 1 }])]).total).toBe(false);
    // `where` evaluates its bindings FIRST, then the body
    const w = call("fdcBindingLayout", ["where", AL([{ var: "a" }, { a: 42 }])]);
    expect(w.entries.map((e: any) => e.name)).toEqual(["a"]);
    expect(w.bodyPresent).toBe(true);
    expect(evaluate({ where: [{ var: "a" }, { a: 42 }] }, {}, {} as never)).toBe(42);
  });

  it("the node plan mirrors `evaluate`'s tiers, `$tag` inertness included", () => {
    const tag = (node: unknown) => call("fdcNodePlan", [M(node)]).$tag;
    expect(tag(5)).toBe("FdcPlanInert");
    expect(tag([1, 2])).toBe("FdcPlanSeq");
    expect(tag({ var: "x" })).toBe("FdcPlanOp");
    expect(tag({ a: 1, b: 2 })).toBe("FdcPlanRecord");
    expect(tag({ foo: [1] })).toBe("FdcPlanKeyed");
    // a NON-string `$tag` marshals as a plain object yet is still inert: the
    // runtime's `"$tag" in rule` test runs BEFORE the key count is examined.
    expect(M({ $tag: 0 }).$tag).toBe("JlObject");
    expect(evaluate({ $tag: 0 }, {}, {} as never)).toEqual({ $tag: 0 });
    expect(tag({ $tag: 0 })).toBe("FdcPlanInert");
    // the unresolved fallback rides on the plan rather than being applied eagerly
    expect(call("fdcNodePlan", [M({ $named: "X" })]).unresolved.$tag).toBe("FdcKeyedInert");
    expect(call("fdcNodePlan", [M({ foo: [1] })]).unresolved.$tag).toBe("FdcKeyedField");
  });

  it("the op roster is CLOSED and single: every name has a schedule, and vice versa", () => {
    const src = read("implementations/typescript/engine/src/json-logic.ts");
    const block = src.slice(src.indexOf("const KNOWN_OPS"));
    const body = block.slice(block.indexOf("["), block.indexOf("]);") + 1);
    const sourceOps = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
    expect(sourceOps.length).toBe(40);

    const roster: string[] = call("fdcOpNames", [0]);
    expect([...roster].sort()).toEqual([...sourceOps].sort());
    for (const op of roster) {
      expect(call("fdcOpSchedule", [op]).$tag, `${op} has no schedule`).toBe("Just");
      expect(call("fdcIsKnownOp", [op]), `${op} is not known`).toBe(true);
    }
    for (const bogus of ["zzz", "", "cat", "eq", "$notAnOp"]) {
      expect(call("fdcOpSchedule", [bogus]).$tag).toBe("Nothing");
      expect(call("fdcIsKnownOp", [bogus])).toBe(false);
    }
    // the OBSERVATION analysis reads this roster rather than keeping a copy
    expect(call("vobOpNames", [0])).toEqual(roster);
  });

  it("the exit inventory names `evaluate`'s twelve return arms (a DRIFT sentinel)", () => {
    const arms: any[] = call("fdcExitInventory", [0]);
    expect(arms.length).toBe(12);
    expect(arms.filter((a) => !a.reachable).map((a) => a.id))
      .toEqual(["callable-passthrough", "buffer-passthrough"]);
    // the two unreachable arms are unreachable because the MARSHALLED carrier
    // has no case for a live host closure or a typed-array view.
    expect(M(new Uint8Array([1])).$tag).not.toBe("JlArray");
  });
});

// ===========================================================================
// LAYER 2 — per-consumer expectations off the SAME fixture records
// ===========================================================================

const ROUTES: readonly ValidationLedgerRouteInput[] = [
  { name: "f", status: "resolved", targetId: "m:f", kind: "function", candidates: [], diagnostics: [] },
  { name: "g", status: "resolved", targetId: "m:g", kind: "function", candidates: [], diagnostics: [] },
];
const ARITIES = [{ targetId: "m:f", arity: 1 }, { targetId: "m:g", arity: 1 }];

const ledgerRows = (body: unknown, paramNames: readonly string[] = []): any[] => {
  const out: any = dispatchedValidationUseLedger({
    callerId: "m:caller", body, paramNames, routes: ROUTES, arities: ARITIES,
    provenance: { bodyHash: "h", astAbi: "a", parser: "authoritative" },
  });
  return (out._0?.rows ?? []) as any[];
};
const statuses = (rows: any[]): string[] => rows.map((r) => r.status.$tag);
const rawKeys = (rows: any[]): string[] => rows.map((r) => r.rawKey);

describe("slice 3e layer 2 — the USE LEDGER over the same adversarial corpus", () => {
  it("a flat array parameter SHADOWS under its coerced spelling", () => {
    // The lambda binds `y,z`, NOT `y` and `z`. A body reading `g` (a registered
    // name) must therefore still resolve to the registry, while a body reading
    // the coerced spelling is LEXICAL.
    const body = { fn: ["x", ["y", "z"], { call: ["g", { var: "y,z" }] }] };
    const rows = ledgerRows(body);
    expect(rawKeys(rows)).toEqual(["g", "y,z"]);
    expect(statuses(rows)).toEqual(["UlsResolved", "UlsLexical"]);
  });

  it("a canonical NESTED-ARRAY parameter shadows a registered spelling", () => {
    // Before 3e the entry was DROPPED, so `{var:"g"}` resolved to the registered
    // `m:g` while execution read the lambda's own binder — the exact
    // missed-shadowing direction that makes this soundness-critical at D3.
    const body = { fn: [[["g"]], { var: "g" }] };
    const rows = ledgerRows(body);
    expect(statuses(rows)).toEqual(["UlsLexical"]);
    expect(installedBinders([[["g"]], { var: "g" }])).toEqual(["g"]);
  });

  it("an unreproducible parameter spelling FENCES rather than under-binding", () => {
    const rows = ledgerRows({ fn: [[7], { call: ["f", 1] }] });
    expect(statuses(rows)).toEqual(["UlsDynamicOrReflective"]);
  });

  it("a non-literal `$bind` fences the arm instead of dropping the binder", () => {
    const rows = ledgerRows({ match: [{ var: "s" }, { $bind: 0 }, { call: ["f", 1] }] });
    expect(statuses(rows)).toContain("UlsDynamicOrReflective");
  });

  it("a `$guard` on a TAGGED arm is split, so its calls are ledgered", () => {
    // The ledger previously omitted the tagged carrier entirely, leaving the
    // guard's calls unwalked.
    const guarded = { $tag: "Just", $guard: [{ $bind: "y" }, { call: ["f", { var: "y" }] }] };
    const rows = ledgerRows({ match: [{ var: "s" }, guarded, 1] });
    expect(rawKeys(rows)).toContain("f");
  });

  it("the `$` application vehicle is DYNAMIC, not a resolution of the spelling `$`", () => {
    const rows = ledgerRows({ call: ["$", { var: "h" }, 1] });
    expect(rows[0].rawKey).toBe("$");
    expect(rows[0].status.$tag).toBe("UlsDynamicOrReflective");
  });

  it("a zero-parameter lambda with trailing arguments walks the RIGHT body", () => {
    const rows = ledgerRows({ fn: [[], { call: ["f", 1] }, { call: ["g", 1] }] });
    expect(rawKeys(rows)).toEqual(["f"]);
  });

  it("an inline-`let` do item binds sequentially and its siblings are not walked", () => {
    const body = { do: [{ let: { a: { call: ["f", 1] } }, ignored: { call: ["g", 1] } }, { var: "a" }] };
    const rows = ledgerRows(body);
    expect(rawKeys(rows)).toEqual(["f", "a"]);
    expect(statuses(rows)).toEqual(["UlsResolved", "UlsLexical"]);
  });

  it("a tagged bindings record FENCES rather than silently binding nothing", () => {
    expect(statuses(ledgerRows({ let: { $tag: "X", a: 1 } }))).toEqual(["UlsDynamicOrReflective"]);
  });

  it("a guaranteed-dead trailing child of an eager op mints NO row", () => {
    // `length` reads slot 0 only; the ledger used to walk every slot and demand
    // a certificate for a call the runtime never performs.
    const rows = ledgerRows({ length: [[1], { call: ["f", 1] }] });
    expect(rawKeys(rows)).toEqual(["length"]);
  });

  it("`missing` keeps its INTRINSIC row but mints none from its raw path names", () => {
    // The runtime really performs the operation, so the language-rule row stays.
    // What goes is the argument walk: the arguments are raw path names the
    // runtime never evaluates, so a row minted from one describes an edge that
    // does not execute.
    const rows = ledgerRows({ missing: [{ call: ["f", 1] }] });
    expect(rawKeys(rows)).toEqual(["missing"]);
    expect(rows[0].status.$tag).toBe("UlsResolved");
    expect(rows[0].status.kind).toBe("intrinsic");
  });

  it("a one-argument `match` mints no rows — the runtime returns before the scrutinee", () => {
    expect(ledgerRows({ match: [{ call: ["f", 1] }] })).toEqual([]);
  });
});

describe("slice 3e layer 2 — the OBSERVATION analysis over the same corpus", () => {
  const opaque = (...rigids: number[]) => ({ $tag: "PvOpaque", rigids });
  const bindP = (name: string, prov: unknown) => ({ $tag: "ObsBind", name, prov });
  const analyze = (body: unknown, params: unknown[] = [], ordinals: number[] = [0]): any =>
    call("vobAnalyzeFromProvenance", [
      "caller", M(body), params, ordinals, [], ["interpreted"], ["interpreted"],
    ]);
  const details = (out: any): string =>
    (out.reasons ?? []).map((r: any) => r.detail ?? r.observed ?? "").join(" ");

  it("a flat array parameter binds the COERCED spelling, so a read of it is the PARAMETER", () => {
    // `y,z` is the lambda's own binder (opaque over the quantified ordinal), so
    // a shape observation of it fences — where reading `y` finds the OUTER one.
    const body = { fn: ["x", ["y", "z"], { length: [{ var: "y,z" }] }] };
    const out = analyze(body, [bindP("y,z", { $tag: "PvClean" })], [0]);
    expect(out.$tag).toBe("ObsFenced");
    expect(details(out)).not.toContain("not reproducible");
  });

  it("a canonical nested-array parameter no longer ABSTAINS — the spelling is exact", () => {
    const body = { fn: [[["x"]], { length: [{ var: "x" }] }] };
    expect(details(analyze(body, [], [0]))).not.toContain("not reproducible");
    // with nothing quantified it admits outright
    expect(analyze(body, [], []).$tag).toBe("ObsAdmitted");
  });

  it("an unreproducible parameter spelling still abstains", () => {
    expect(details(analyze({ fn: [[7], { length: [{ var: "x" }] }] }, [], [0])))
      .toContain("not reproducible");
  });

  it("a guaranteed-dead trailing child charges NO observation", () => {
    // `deepEq` at arity three evaluates nothing at all.
    const out = analyze({ deepEq: [1, 1, { length: [{ var: "k" }] }] }, [bindP("k", opaque(0))], [0]);
    expect(out.$tag).toBe("ObsAdmitted");
  });

  it("a clean `missing_some` no longer abstains on its numeric threshold", () => {
    // Raw slot 0 is the THRESHOLD, not a path. Reading it as one made every
    // well-formed `missing_some` abstain on a number.
    const out = analyze({ missing_some: [1, ["x"]] }, [bindP("x", { $tag: "PvClean" })], [0]);
    expect(out.$tag).toBe("ObsAdmitted");
    // ... and a κ-typed path is still observed
    expect(analyze({ missing_some: [1, ["x"]] }, [bindP("x", opaque(0))], [0]).$tag)
      .toBe("ObsFenced");
  });
});

// ===========================================================================
// LAYER 3 — the STATIC architectural gate: delegate, do not re-derive
// ===========================================================================

/** Collect every identifier-shaped token a parsed JSON-Logic body references.
 *  Reading the PARSED body rather than the source text means a spelling inside
 *  a comment or a doc annotation cannot trip the gate. */
function referencedNames(node: unknown, out: Set<string>): Set<string> {
  if (typeof node === "string") { out.add(node); return out; }
  if (Array.isArray(node)) { for (const x of node) referencedNames(x, out); return out; }
  if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out.add(k);
      referencedNames(v, out);
    }
  }
  return out;
}

/** Only the string VALUES a body carries — never its object KEYS.
 *
 *  The distinction is load-bearing: `$bind` is the JSON-Logic pattern-binder
 *  marker, so it appears as a KEY in every compiled `case` arm in the corpus. A
 *  local raw-node lookup is `lookupFieldInList "$bind" fs`, where the spelling
 *  is an ARGUMENT — a string value. Banning the key would ban the language. */
function stringLiterals(node: unknown, out: Set<string>): Set<string> {
  if (typeof node === "string") { out.add(node); return out; }
  if (Array.isArray(node)) { for (const x of node) stringLiterals(x, out); return out; }
  if (node !== null && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) stringLiterals(v, out);
  }
  return out;
}

type Fn = { id: string; body: unknown };

function moduleFns(relative: string): Map<string, Fn> {
  const mod: any = loadFenelModule(read(relative), "engine");
  const map = new Map<string, Fn>();
  for (const f of (mod.functions ?? []) as any[]) {
    map.set(String(f.id).replace(/^engine:/, ""), { id: f.id, body: f.body });
  }
  return map;
}

/** EVERY function of the merged `module engine where` union, keyed by bare name.
 *
 *  Reading one FILE at a time is evadable in one move — put the forbidden lookup
 *  in a third engine file and call it, and a single-file map records the name
 *  but never traverses its body. Cross-file names resolve by bare name through
 *  this union at runtime, so the gate resolves them the same way. */
function unionFns(): Map<string, Fn> {
  const map = new Map<string, Fn>();
  for (const f of ((engineModule as any).functions ?? []) as any[]) {
    map.set(String(f.id).replace(/^engine:/, ""), { id: f.id, body: f.body });
  }
  return map;
}

const LEDGER_SRC = "fenel/modules/engine/validation-ledger.fenel";
const OBSERVE_SRC = "fenel/modules/engine/validation-observe.fenel";
const DECOMP_SRC = "fenel/modules/engine/form-decomposition.fenel";

/** The transitive structural subgraph reachable from `roots`. */
function reachable(fns: Map<string, Fn>, roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const fn = fns.get(name);
    if (fn === undefined) continue;
    for (const ref of referencedNames(fn.body, new Set())) {
      if (fns.has(ref) && !seen.has(ref)) queue.push(ref);
    }
  }
  return seen;
}

/** Every name the reachable subgraph of `roots` mentions, including names that
 *  live in another file of the union (which is how `fdc*` is reached). */
function reachableRefs(fns: Map<string, Fn>, roots: string[]): Set<string> {
  const out = new Set<string>();
  for (const name of reachable(fns, roots)) {
    const fn = fns.get(name);
    if (fn === undefined) continue;
    for (const ref of referencedNames(fn.body, new Set())) out.add(ref);
  }
  return out;
}

describe("slice 3e layer 3 — the delegation gate (the only layer that can enforce it)", () => {
  // A future walker that reimplements these rules CORRECTLY passes every
  // behavioural fixture above. Only this layer notices.

  const REQUIRED_BY_BOTH = [
    "fdcNodePlan", "fdcLambdaLayout", "fdcMatchLayout",
    "fdcCallLayout", "fdcBindingLayout", "fdcInlineLet", "fdcCtorLayout",
    "fdcScheduledSlots",
  ];

  it("the LEDGER walker reaches every delegated decision", () => {
    const refs = reachableRefs(moduleFns(LEDGER_SRC), ["vlgWalk"]);
    for (const required of [...REQUIRED_BY_BOTH, "fdcPatternBindsTotal", "fdcBindWriteSpellings", "fdcParamSpellings"]) {
      expect(refs.has(required), `vlgWalk does not reach ${required}`).toBe(true);
    }
  });

  it("the OBSERVATION walker reaches every delegated decision", () => {
    const refs = reachableRefs(moduleFns(OBSERVE_SRC), ["vobWalk"]);
    for (const required of [...REQUIRED_BY_BOTH, "fdcPatternPlan", "fdcPatternBindsTotal", "fdcParamSpellings"]) {
      expect(refs.has(required), `vobWalk does not reach ${required}`).toBe(true);
    }
  });

  it("NOTHING in the walkers' REACHABLE SUBGRAPH re-derives a delegated decision", () => {
    // The spellings `$guard` and `$bind`, and the argument-list normalization,
    // are RESERVED to the decomposition. This is an ownership policy, stated as
    // such: it is not a semantic detector of a local lookup, and a legitimate
    // future use of those spellings as data inside a reachable walker helper
    // would trip it. Two engine files outside the contract DO use them
    // legitimately (`fenel-printer.fenel` prints them, `json-logic-to-syntax
    // .fenel` re-lifts them) — the scope is the reachable subgraph, not the repo.
    //
    // CROSS-FILE, because a single-file scan is evadable in one move: put the
    // lookup in a third engine file and call it. Names resolve by bare name
    // through the merged union at runtime, and this walk resolves them the same
    // way, so the helper's own body is traversed too.
    const fns = unionFns();
    const subgraph = reachable(fns, ["vlgWalk", "vobWalk"]);
    // A real floor, not a smoke check: the subgraph is ~450 functions today, so
    // anything under a few hundred means the walk collapsed and the ban below
    // is vacuously passing.
    expect(subgraph.size).toBeGreaterThan(250);
    // The exemption is the OWNER MODULE's own function set, NOT a name prefix —
    // `startsWith("fdc")` would exempt any reachable helper in any file that
    // happens to be called `fdcWhatever`, which is a one-rename evasion.
    const owner = new Set(moduleFns(DECOMP_SRC).keys());
    for (const name of subgraph) {
      if (owner.has(name)) continue;
      const fn = fns.get(name);
      if (fn === undefined) continue;
      const lits = stringLiterals(fn.body, new Set());
      for (const banned of ["$guard", "$bind"]) {
        expect(lits.has(banned), `${name} re-derives the ${banned} lookup`).toBe(false);
      }
      expect(
        referencedNames(fn.body, new Set()).has("normalizeToArgList"),
        `${name} re-normalizes the argument list`,
      ).toBe(false);
    }
    // ... and the decomposition DOES own all three.
    const decomp = moduleFns(DECOMP_SRC);
    const ownedLits = new Set<string>();
    const ownedRefs = new Set<string>();
    for (const fn of decomp.values()) {
      for (const r of stringLiterals(fn.body, new Set())) ownedLits.add(r);
      for (const r of referencedNames(fn.body, new Set())) ownedRefs.add(r);
    }
    expect(ownedLits.has("$guard")).toBe(true);
    expect(ownedLits.has("$bind")).toBe(true);
    expect(ownedRefs.has("normalizeToArgList")).toBe(true);
    // ... and the `fdc` NAME is owned by that module alone, so the exemption
    // above cannot be claimed by a helper somewhere else.
    for (const name of fns.keys()) {
      if (!name.startsWith("fdc")) continue;
      expect(owner.has(name), `${name} uses the fdc prefix but is not in the decomposition module`)
        .toBe(true);
    }
  });

  it("there is exactly ONE op roster, and the observation analysis reads it", () => {
    const observe = moduleFns(OBSERVE_SRC);
    expect(referencedNames(observe.get("vobOpNames")!.body, new Set()).has("fdcOpNames")).toBe(true);
    expect(referencedNames(observe.get("vobIsKnownOp")!.body, new Set()).has("fdcIsKnownOp")).toBe(true);
    // the SEMANTIC transfer table is legitimately consumer-specific and stays:
    // it maps an already-decomposed op identity onto an observation effect.
    expect(observe.has("vobClassifyForm")).toBe(true);
  });

  it("MUTATION TEST: the gate fires on a CROSS-FILE reimplementation too", () => {
    // The exact evasion the single-file version missed: a helper in some other
    // engine file that does the lookup, called from a walker. The union map
    // contains it, so the reachable walk traverses its body.
    const fns = unionFns();
    const evasion = new Map(fns);
    evasion.set("vxxGuardParts", {
      id: "engine:vxxGuardParts",
      body: { call: ["lookupFieldInList", "$guard", { var: "fs" }] },
    });
    const walker = evasion.get("vobWalk")!;
    evasion.set("vobWalk", {
      id: walker.id,
      body: { do: [walker.body, { call: ["vxxGuardParts", { var: "fs" }] }] },
    });
    const subgraph = reachable(evasion, ["vobWalk"]);
    expect(subgraph.has("vxxGuardParts")).toBe(true);
    expect(stringLiterals(evasion.get("vxxGuardParts")!.body, new Set()).has("$guard")).toBe(true);
  });

  it("MUTATION TEST: the gate actually fires on a reimplementation", () => {
    // A synthetic walker that looks up `$guard` locally must be REJECTED, and a
    // comment mentioning it must NOT be — which is why the gate reads parsed
    // bodies rather than source text.
    const reimplementation = { call: ["lookupFieldInList", "$guard", { var: "fs" }] };
    expect(stringLiterals(reimplementation, new Set()).has("$guard")).toBe(true);
    const indirected = { call: ["helper", { call: ["lookupFieldInList", "$bind", { var: "fs" }] }] };
    expect(stringLiterals(indirected, new Set()).has("$bind")).toBe(true);
    // an `fdc*` call whose result is ignored does not by itself satisfy the
    // POSITIVE requirement of a different rule — reachability is per-decision.
    const refs = reachableRefs(moduleFns(LEDGER_SRC), ["vlgIsOperatorNotation"]);
    expect(refs.has("fdcNodePlan")).toBe(false);
  });

  it("the NAME COERCION is absorbed too — no consumer manufactures a spelling", () => {
    // `fdcCoerceName` is reached through the lambda layout and the pattern plan,
    // never called by a consumer: the whole point is that a walker may not
    // decide for itself what spelling the runtime installs.
    const decomp = moduleFns(DECOMP_SRC);
    expect(reachable(decomp, ["fdcLambdaLayout"]).has("fdcCoerceName")).toBe(true);
    expect(reachable(decomp, ["fdcPatternPlan"]).has("fdcCoerceName")).toBe(true);
    for (const src of [LEDGER_SRC, OBSERVE_SRC]) {
      for (const [name, fn] of moduleFns(src)) {
        expect(
          referencedNames(fn.body, new Set()).has("fdcCoerceName"),
          `${src}:${name} coerces a binder spelling itself`,
        ).toBe(false);
      }
    }
  });

  it("the guard split is ABSORBED by the match layout, so neither walker splits locally", () => {
    // The review folded `fdcGuardSplit` into `fdcMatchLayout` rather than
    // leaving it a second public entry two consumers could call inconsistently.
    // It must therefore be reached THROUGH the layout, not directly.
    const decomp = moduleFns(DECOMP_SRC);
    expect(reachable(decomp, ["fdcMatchLayout"]).has("fdcGuardSplit")).toBe(true);
  });

  it("HONESTY: this gate is a reachability + reimplementation TRIPWIRE, not a proof", () => {
    // Reachability is computed over the parsed body's identifier tokens, which
    // over-approximates a call graph: a computed dispatch target is not a
    // literal token and would evade it, and a name mentioned but never applied
    // counts as reached. The result review enumerated the evasions that survive
    // and they are recorded here rather than papered over:
    //
    //   * a computed spelling — `lookupFieldInList (concat "$gu" "ard") fs`;
    //   * calling an `fdc*` layout and then IGNORING its result while deciding
    //     locally (reachability is per-decision, not per-use);
    //   * a second private op roster alongside a mention of the shared one.
    //
    // What it does catch is the failure mode that has actually occurred four
    // slices running — a walker quietly growing its own copy of a rule, in its
    // own file or in a helper next door — and it does not claim more than that.
    // The reserved-spelling ban is an OWNERSHIP policy, not a semantic detector.
    expect(true).toBe(true);
  });
});

// ===========================================================================
// THE RESULT REVIEW — defects the `gpt-5.6-sol` ultra pass found in this
// slice's own work, each pinned so it cannot come back.
// ===========================================================================

describe("slice 3e result review — the two false admissions, closed", () => {
  const opaqueP = (...rigids: number[]) => ({ $tag: "PvOpaque", rigids });
  const bindP = (name: string, prov: unknown) => ({ $tag: "ObsBind", name, prov });
  const analyzeP = (body: unknown, params: unknown[] = [], ordinals: number[] = [0]): any =>
    call("vobAnalyzeFromProvenance", [
      "caller", M(body), params, ordinals, [], ["interpreted"], ["interpreted"],
    ]);
  const detailsP = (out: any): string =>
    (out.reasons ?? []).map((r: any) => r.detail ?? r.observed ?? "").join(" ");
  const rows = (body: unknown): any[] => {
    const out: any = dispatchedValidationUseLedger({
      callerId: "m:caller", body, paramNames: [], routes: ROUTES, arities: ARITIES,
      provenance: { bodyHash: "h", astAbi: "a", parser: "authoritative" },
    });
    return (out._0?.rows ?? []) as any[];
  };

  it("BLOCKER 1: the OBSERVATION analysis applies the conditional-binder fence", () => {
    // I built `fdcPatternBindsTotal`, wired it into the ledger, and forgot the
    // fence. The runtime's Boolean arm matches with an EMPTY binding set, so the
    // body reads the OUTER `x`; installing a clean inner `x` admitted a read of
    // a κ-typed value.
    expect(runtimeBinders(true, { $tag: "True", payload: { $bind: "x" } })).toEqual([]);
    const body = { match: [{ var: "s" }, { $tag: "True", payload: { $bind: "x" } }, { length: [{ var: "x" }] }] };
    const out = analyzeP(body, [bindP("s", { $tag: "PvClean" }), bindP("x", opaqueP(0))], [0]);
    expect(out.$tag).toBe("ObsFenced");
    expect(detailsP(out)).toContain("CONDITIONAL on the scrutinee");
    // an ORDINARY constructor arm is untouched — this is not a blanket fence
    const ordinary = { match: [{ var: "s" }, { $tag: "Just", _0: { $bind: "v" } }, { var: "v" }] };
    expect(detailsP(analyzeP(ordinary, [bindP("s", { $tag: "PvClean" })], [0])))
      .not.toContain("CONDITIONAL on the scrutinee");
  });

  it("BLOCKER 2: the ledger walks the UNION of both constructor payload readings", () => {
    // A one-field op-shaped payload: the positional reading sees an `ann` form
    // and walks argument 0 only, while the runtime's NAMED branch evaluates the
    // whole field value and reaches `g`. Choosing positional lost the edge.
    const body = { construct: ["R", { ann: [0, { call: ["g", 1] }] }] };
    expect(rows(body).map((r) => r.rawKey)).toContain("g");
    // ... and the named reading now covers a TAGGED payload too, because
    // `applyOp`'s named test is any non-null non-array object.
    const tagged = call("fdcCtorLayout", [AL(["R", { $tag: "X", a: 1 }])]);
    expect(tagged.namedPossible).toBe(true);
    expect(tagged.namedFields.map((f: any) => f.name)).toEqual(["$tag", "a"]);
  });

  it("an ABSENT or null bindings carrier is NOT total — the host enumeration throws", () => {
    // `Object.entries(null)` throws, so the form produces no value at all.
    // Reporting it total-and-clean was an admission this slice introduced.
    expect(() => evaluate({ let: [] }, {}, {} as never)).toThrow();
    expect(() => evaluate({ where: [1] }, {}, {} as never)).toThrow();
    expect(call("fdcBindingLayout", ["let", AL([])]).total).toBe(false);
    expect(call("fdcBindingLayout", ["let", AL([])]).present).toBe(false);
    expect(call("fdcBindingLayout", ["where", AL([1])]).total).toBe(false);
    expect(detailsP(analyzeP({ let: [] }))).toContain("THROW");
  });

  it("an EMPTY-STRING tag is a real tag, not the absent-tag sentinel", () => {
    // The marshaller admits `{$tag: ""}` as a tagged carrier, so a sentinel-based
    // presence test silently dropped its reconstructed key.
    expect(M({ $tag: "", a: 1 }).$tag).toBe("JlTagged");
    const fields = call("fdcPatternFields", [M({ $tag: "", a: 1 }).fields, "", true]);
    expect(fields.map((f: any) => f.key)).toEqual(["$tag", "a"]);
    expect(fields[0].role.$tag).toBe("FdcPatRoleWireTag");
    // a plain object with no tag still gets no reconstructed key
    expect(call("fdcPatternFields", [M({ a: 1 }).fields, "", false]).map((f: any) => f.key))
      .toEqual(["a"]);
  });

  it("a ONE-ELEMENT `$guard` array is stripped but NOT guarded", () => {
    // `guard = value[1]` is undefined and the runtime's test is
    // `guard !== undefined && …`, so the arm proceeds with nothing evaluated.
    expect(evaluate({ match: [1, { $guard: [{ $bind: "n" }] }, "hit", "dflt"] }, {}, {} as never))
      .toBe("hit");
    const split = call("fdcGuardSplit", [M({ $guard: [{ $bind: "n" }] })]);
    expect(split.guarded).toBe(false);
    expect(split.pattern.fields.map((f: any) => f.name)).toEqual(["$bind"]);
    // two elements IS a guard
    expect(call("fdcGuardSplit", [M({ $guard: [{ $bind: "n" }, { var: "n" }] })]).guarded).toBe(true);
  });

  it("an EMPTY-STRING tag takes the unresolved WIRE-ROUTE step, not the no-tag step", () => {
    // Presence decides, not an empty-string sentinel. The runtime projects `""`
    // to the invalid-wire marker, so the match fails — but that is a MATCH
    // outcome, and the plan must still say a projection was consulted.
    const steps = (p: unknown) => call("fdcPatternPlan", [M(p)]).steps.map((s: any) => s.$tag);
    expect(steps({ $tag: "", a: 1 }))
      .toEqual(["FdcPatIdentity", "FdcPatWireRoute", "FdcPatFields", "FdcPatFail"]);
    // an UNTAGGED object has no wire route at all
    expect(steps({ a: 1 })).toEqual(["FdcPatIdentity", "FdcPatFields", "FdcPatFail"]);
  });

  it("a TAGGED constructor payload's `$tag` is a named entry that OVERWRITES the tag", () => {
    // The runtime writes the constructor tag first and then enumerates the
    // payload, so a payload carrying its own `$tag` replaces it. The marshaller
    // strips that key, so the named reading has to reconstruct it.
    const built = evaluate({ construct: ["R", { $tag: "X", a: 1 }] }, {}, {} as never) as any;
    expect(built.$tag).toBe("X");
    const layout = call("fdcCtorLayout", [AL(["R", { $tag: "X", a: 1 }])]);
    expect(layout.namedFields.map((f: any) => f.name)).toEqual(["$tag", "a"]);
  });

  it("an EMPTY `$guard` array: the plan and the runtime pattern agree on NEVER-MATCHES", () => {
    // The runtime replaces the arm with `value[0]`, which is host `undefined`;
    // the marshalled carrier has no `undefined` and reports `JlNull`. The two
    // are not the same VALUE, but they produce the same PLAN — identity then
    // fail — and neither matches any value a stored body can carry. Recorded as
    // a stated equivalence rather than a fence, because there is nothing
    // observable between them.
    const split = call("fdcGuardSplit", [M({ $guard: [] })]);
    expect(split.guarded).toBe(false);
    expect(split.pattern.$tag).toBe("JlNull");
    expect(call("fdcPatternPlan", [split.pattern]).steps.map((s: any) => s.$tag))
      .toEqual(["FdcPatIdentity", "FdcPatFail"]);
    expect(matchPattern({ a: 1 }, undefined, {} as never)).toBeNull();
    expect(matchPattern({ a: 1 }, null, {} as never)).toBeNull();
  });

  it("an ABSENT `where` bindings carrier does not walk the body — the runtime throws first", () => {
    expect(() => evaluate({ where: [{ var: "x" }] }, {}, {} as never)).toThrow();
    const out = analyzeP({ where: [{ length: [{ var: "k" }] }] }, [bindP("k", opaqueP(0))], [0]);
    expect(out.$tag).toBe("ObsFenced");
    // the body's own observation is NOT charged: it is unreachable code
    expect(detailsP(out)).toContain("THROW");
  });

  it("a non-total match arm's FENCE row carries its arm index, so two are distinct", () => {
    const body = {
      match: [
        { var: "s" },
        { $bind: 0 }, 1,
        { $bind: 1 }, 2,
      ],
    };
    const paths = rows(body)
      .filter((r) => r.status.$tag === "UlsDynamicOrReflective")
      .map((r) => JSON.stringify(r.site.path));
    expect(paths.length).toBe(2);
    expect(new Set(paths).size).toBe(2);
  });
});
