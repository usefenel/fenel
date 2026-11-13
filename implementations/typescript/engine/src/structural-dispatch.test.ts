// ---------------------------------------------------------------------------
// structural-dispatch Phase 1 — the CORE dispatch change.
//
// A typeclass/effect instance registered with a `ByPattern { predicate }` key
// resolves at dispatch for every type the predicate accepts, scanned AFTER the
// nominal block→tag→global cascade misses (nominal exact-match always wins).
//
// Headline (roadmap Phase 1 / brief §0): register a structural rule bounded by
// `engine:isRecordType`, dispatch it for a record type that has NO nominal
// instance, and the methods resolve. The scan + first-match DECISION lives in
// the `engine:matchStructural` `.fenel` body; effect-dispatch.ts is the seam
// (resolve type → marshal across the `$`-barrier → invoke the matcher → memo).
//
// Runs in-process via createRegistry + resolveEffect (the types-funnel-behavior
// pattern, no DB). The structural rules are registered on the shared
// `dispatchRegistry` under uniquely-named throwaway classes so the global state is
// not polluted for other suites.
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { createRegistry } from "./registry";
import { dispatchRegistry, systemEntities } from "./system-entities";
import { resolveEffect, checkPredicateBounds } from "./effect-dispatch";
import {
  universeFunctionsReturning,
  universeApplicableOperationsFor,
  universeEffectfulFunctionsWith,
  universeFunctionsMatchingReturn,
  universeStructuralInstancesFor,
} from "./engine-bodies-dispatch";
import type { FenelFunction } from "./types";
import type { EvaluateContext } from "./json-logic";

// A brand-new record type with NO nominal instance for the test class — the
// structural rule must reach it purely through its predicate.
const REC_TYPE = "StructuralPhase1Rec";

let ctx: EvaluateContext;
let reg: ReturnType<typeof createRegistry>;

beforeAll(() => {
  // Register the target record type into the catalog so the seam's
  // `getEntityTypeByName` resolves it to a `$record` the predicate can inspect.
  if (!systemEntities.some((e) => e.id === REC_TYPE)) {
    systemEntities.push({
      id: REC_TYPE,
      type: {
        $record: {
          fields: [
            { name: "id", type: { $ref: "String" } },
            { name: "label", type: { $ref: "String" } },
          ],
        },
      },
    } as never);
  }
  reg = createRegistry([stdModule, engineModule], { dispatchRegistry });
  ctx = reg.evaluateContext();
});

describe("structural-dispatch Phase 1 — ByPattern rules match at dispatch", () => {
  test("a structural rule bounded by isRecordType matches a record type with no nominal instance", () => {
    const typeName = "StructPhase1HeadlineClass";
    dispatchRegistry.defineClass({
      name: typeName,
      params: [{ name: "t" }],
      methods: [{ name: "describe", params: [], returns: { $ref: "String" } }],
    });
    dispatchRegistry.addInstance({
      typeName,
      args: [{ $pattern: "engine:isRecordType" } as never],
      methods: { describe: "test:structPhase1HeadlineDescribe" },
    });

    const resolved = resolveEffect(ctx, dispatchRegistry, typeName, {
      $tag: "ByType",
      target: REC_TYPE,
    });
    expect(resolved).toBeDefined();
    expect(resolved!.methods.describe).toBe("test:structPhase1HeadlineDescribe");
  });

  test("nominal exact-match still wins over a structural rule for the same type", () => {
    const typeName = "StructPhase1PrecedenceClass";
    dispatchRegistry.defineClass({
      name: typeName,
      params: [{ name: "t" }],
      methods: [{ name: "describe", params: [], returns: { $ref: "String" } }],
    });
    // Structural rule (accepts every record) + a NOMINAL rule for REC_TYPE.
    dispatchRegistry.addInstance({
      typeName,
      args: [{ $pattern: "engine:isRecordType" } as never],
      methods: { describe: "test:structPhase1PrecedenceStructuralDescribe" },
    });
    dispatchRegistry.addInstance({
      typeName,
      args: [REC_TYPE],
      methods: { describe: "test:structPhase1PrecedenceNominalDescribe" },
    });

    const resolved = resolveEffect(ctx, dispatchRegistry, typeName, REC_TYPE);
    expect(resolved).toBeDefined();
    expect(resolved!.methods.describe).toBe("test:structPhase1PrecedenceNominalDescribe");
  });

  test("falls through to undefined when no structural rule accepts the type", () => {
    const typeName = "StructPhase1MissClass";
    dispatchRegistry.defineClass({
      name: typeName,
      params: [{ name: "t" }],
      methods: [{ name: "describe", params: [], returns: { $ref: "String" } }],
    });
    // isRecordType rejects `String` (a `$opaque`, not a `$record`).
    dispatchRegistry.addInstance({
      typeName,
      args: [{ $pattern: "engine:isRecordType" } as never],
      methods: { describe: "test:structPhase1MissDescribe" },
    });

    const resolved = resolveEffect(ctx, dispatchRegistry, typeName, {
      $tag: "ByType",
      target: "String",
    });
    expect(resolved).toBeUndefined();
  });

  test("a class with NO structural rules is untouched (fast nominal path)", () => {
    const typeName = "StructPhase1NominalOnlyClass";
    dispatchRegistry.defineClass({
      name: typeName,
      params: [{ name: "t" }],
      methods: [{ name: "describe", params: [], returns: { $ref: "String" } }],
    });
    dispatchRegistry.addInstance({
      typeName,
      args: [REC_TYPE],
      methods: { describe: "test:structPhase1NominalOnlyDescribe" },
    });
    const hit = resolveEffect(ctx, dispatchRegistry, typeName, REC_TYPE);
    expect(hit!.methods.describe).toBe("test:structPhase1NominalOnlyDescribe");
    // A non-registered type still misses cleanly (no structural rule to scan).
    const miss = resolveEffect(ctx, dispatchRegistry, typeName, "NotARegisteredType");
    expect(miss).toBeUndefined();
  });
});

describe("structural-dispatch Phase 2 — monomorphic predicate-bounds on signatures", () => {
  // A signature `f : isRecordType a => a -> b` carries a predicate-bound riding
  // the `requires`/`=>` constraint machinery: a `Constraint` whose `class.entityId`
  // is the predicate fn-id `engine:isRecordType` (NOT a class) over the type-param
  // `a`. `checkPredicateBounds` resolves `a` to the call-site type and runs the
  // predicate — a record passes, a `String` is a bound violation.
  const boundFn = (): FenelFunction =>
    ({
      id: "test:requiresRecord",
      params: [{ name: "x", type: { $var: "a" } }],
      returns: { $var: "b" },
      requires: [
        { class: { $tag: "Id", entityId: "engine:isRecordType" }, args: [{ $var: "a" }] },
      ],
    }) as unknown as FenelFunction;

  test("a record-typed call satisfies an isRecordType bound", () => {
    const fn = boundFn();
    const out = checkPredicateBounds(ctx, dispatchRegistry, fn, (p) =>
      p === "a" ? REC_TYPE : undefined,
    );
    expect(out.checked).toEqual(["engine:isRecordType"]);
  });

  test("a non-record (Boolean) call violates an isRecordType bound with a clear error", () => {
    // `Boolean` is a registered `$opaque` (not a `$record`), so `isRecordType`
    // rejects it — the monomorphic bound check raises a clear violation.
    const fn = boundFn();
    expect(() =>
      checkPredicateBounds(ctx, dispatchRegistry, fn, (p) => (p === "a" ? "Boolean" : undefined)),
    ).toThrow(/predicate-bound "engine:isRecordType" is not satisfied/);
  });

  test("a function with no predicate-bound is unaffected (nothing checked)", () => {
    const fn = {
      id: "test:noBound",
      params: [{ name: "x", type: { $var: "a" } }],
      returns: { $var: "a" },
    } as unknown as FenelFunction;
    const out = checkPredicateBounds(ctx, dispatchRegistry, fn, () => REC_TYPE);
    expect(out.checked).toEqual([]);
  });

  test("a class/super constraint in requires is NOT treated as a predicate-bound", () => {
    // `StructPhase1NominalOnlyClass` is a registered class (defined in Phase 1
    // tests) — a constraint naming it is a class constraint, skipped by the
    // predicate-bound walk even though `a` resolves to a concrete type.
    dispatchRegistry.defineClass({
      name: "StructPhase2ClassConstraint",
      params: [{ name: "t" }],
      methods: [{ name: "m", params: [], returns: { $ref: "String" } }],
    });
    const fn = {
      id: "test:classConstraint",
      params: [{ name: "x", type: { $var: "a" } }],
      returns: { $var: "a" },
      requires: [
        { class: { $tag: "Id", entityId: "StructPhase2ClassConstraint" }, args: [{ $var: "a" }] },
      ],
    } as unknown as FenelFunction;
    const out = checkPredicateBounds(ctx, dispatchRegistry, fn, () => REC_TYPE);
    expect(out.checked).toEqual([]);
  });
});

describe("structural-dispatch Phase 3 — universe-views over the registry", () => {
  // `functionsReturning(T)` / `applicableOperationsFor(value)` /
  // `effectfulFunctionsWith(C)` are introspection queries over the in-memory
  // function registry, computed as PURE FOLDS in `universe-views.fenel`. The TS
  // seam (engine-bodies-dispatch.ts) reflects the caller's function list +
  // marshals each fn across the `$`-barrier; the DECISION is the `.fenel` body.

  test("functionsReturning('Number') surfaces the arithmetic family (named-ref return)", () => {
    const ids = universeFunctionsReturning(reg.listFunctions(), "Number");
    expect(ids).toContain("std:negate");
    expect(ids).toContain("std:abs");
    // A Maybe-returning fn is NOT a Number-returner.
    expect(ids).not.toContain("std:head");
  });

  test("functionsReturning('Maybe') surfaces the Maybe-shape returners (inline variant)", () => {
    // Maybe-returns are stored EXPANDED (`{$variant:{Nothing|Just}}`), not as a
    // named `Maybe` ref — the `.fenel` recognizer reads the case SHAPE.
    const ids = universeFunctionsReturning(reg.listFunctions(), "Maybe");
    expect(ids).toContain("std:head");
    expect(ids).toContain("std:tail");
    expect(ids).toContain("std:lookup");
  });

  test("functionsReturning of an unknown type is empty (not an error)", () => {
    expect(universeFunctionsReturning(reg.listFunctions(), "NoSuchType")).toEqual([]);
  });

  test("applicableOperationsFor('Number') includes a Number-first-param op", () => {
    const ids = universeApplicableOperationsFor(reg.listFunctions(), "Number");
    expect(ids).toContain("std:negate");
  });

  test("applicableOperationsFor accepts a polymorphic (type-variable) first param", () => {
    // A synthetic fn `id : a -> a` (first param a type-var) accepts ANY value
    // type — the polymorphic-accept arm.
    const idFn = {
      id: "test:id",
      params: [{ name: "x", type: { $var: "a" } }],
      returns: { $var: "a" },
    } as unknown as FenelFunction;
    const nullary = {
      id: "test:nullary",
      params: [],
      returns: { $ref: "Number" },
    } as unknown as FenelFunction;
    const ids = universeApplicableOperationsFor([idFn, nullary], "Bot");
    expect(ids).toEqual(["test:id"]); // type-var accepts; nullary accepts nothing
  });

  test("effectfulFunctionsWith('HasStateIO') surfaces a fn whose requires carries it", () => {
    const effFn = {
      id: "test:effectful",
      params: [{ name: "x", type: { $ref: "String" } }],
      returns: { $ref: "String" },
      requires: [{ class: { $tag: "Id", entityId: "HasStateIO" }, args: [{ $var: "s" }] }],
    } as unknown as FenelFunction;
    const pureFn = {
      id: "test:pure",
      params: [{ name: "x", type: { $ref: "String" } }],
      returns: { $ref: "String" },
    } as unknown as FenelFunction;
    expect(universeEffectfulFunctionsWith([effFn, pureFn], "HasStateIO")).toEqual([
      "test:effectful",
    ]);
    // A class no function requires ⇒ empty (not an error).
    expect(universeEffectfulFunctionsWith([effFn, pureFn], "HasNetwork")).toEqual([]);
  });
});

describe("structural-dispatch Phase 4a — ⊆ subtype match (typeSubsumes + decideSubset)", () => {
  // `universeFunctionsMatchingReturn(fns, expected)` filters by GENUINE subtype
  // precision: the `.fenel` `engine:typeSubsumes` body recurses structurally and,
  // at a `$refined`-vs-`$refined` leaf, bottoms out in the SHIPPED
  // `set:decideSubset` (the first real D3 consumer). The seam marshals each
  // fn's `returns` + the expected type (the `.set`-carrying `marshalTraversalType`)
  // and runs the pure fold. NO type-matching logic in TS — `typeMatches` is deleted.
  //
  // The editor's FunctionPicker `typeFiltered` memo calls this same view and keeps
  // `FN_INDEX` entries whose id ∈ the returned set, so the picker's candidate set
  // == this view's output BY CONSTRUCTION; these assertions pin the view.

  const fn = (id: string, returns: unknown) => ({ id, returns });
  const Num = { $ref: "Number" };
  const Str = { $ref: "String" };
  const refinedNum = (set: unknown) => ({ $refined: { base: Num, set } });

  test("nominal name match — a Number-returner matches expected Number; a String-returner does not", () => {
    const fns = [fn("a:num", Num), fn("a:str", Str)];
    const ids = universeFunctionsMatchingReturn(fns, Num);
    expect(ids).toContain("a:num");
    expect(ids).not.toContain("a:str");
  });

  test("type-variable in the EXPECTED type accepts ANY return type (the polymorphic-slot accept)", () => {
    const fns = [fn("a:num", Num), fn("a:str", Str)];
    // expected is a bare type-var — every candidate is accepted.
    expect(universeFunctionsMatchingReturn(fns, { $var: "a" }).sort()).toEqual([
      "a:num",
      "a:str",
    ]);
  });

  test("refined transparency — a refined-Number returner matches an UNREFINED Number (Nat<:Int style, strip)", () => {
    const fns = [fn("a:pos", refinedNum({ $enum: [1, 2, 3] }))];
    // want unrefined Number ⇒ have's refinement is stripped ⇒ Number<:Number.
    expect(universeFunctionsMatchingReturn(fns, Num)).toEqual(["a:pos"]);
  });

  test("refined ⊆ — decideSubset FIRES: a subset-enum returner is INCLUDED, a superset-enum returner is EXCLUDED", () => {
    // The D3 proof. Expected = {1,2,3}; the {1,2,3,4} returner can ONLY be excluded
    // by a real ⊆ refutation (the deleted strip-both `typeMatches` would include it).
    const want = refinedNum({ $enum: [1, 2, 3] });
    const fns = [
      fn("a:sub", refinedNum({ $enum: [1, 2] })), // {1,2} ⊆ {1,2,3} ⇒ Just true ⇒ in
      fn("a:eq", refinedNum({ $enum: [1, 2, 3] })), // equal ⇒ Just true ⇒ in
      fn("a:super", refinedNum({ $enum: [1, 2, 3, 4] })), // ⊄ ⇒ Just false ⇒ OUT
    ];
    const ids = universeFunctionsMatchingReturn(fns, want);
    expect(ids).toContain("a:sub");
    expect(ids).toContain("a:eq");
    expect(ids).not.toContain("a:super"); // decideSubset = Just false ⇒ excluded
  });

  test("undecided / solver fence ⇒ KEPT (include-with-no-claim, the picker's UX-honest default)", () => {
    // An unrecognised SetExpr shape ({}) ⇒ set:decideSubset returns Nothing ⇒ the
    // body falls through to base congruence (Number<:Number) ⇒ the candidate is
    // KEPT (no false exclusion ⇒ no solver-extension obligation forced).
    const want = refinedNum({});
    const ids = universeFunctionsMatchingReturn([fn("a:fence", refinedNum({}))], want);
    expect(ids).toEqual(["a:fence"]);
  });

  test("Maybe congruence — Maybe<Number> matches Maybe<Number>; Maybe<String> does not match Maybe<Number>", () => {
    const maybeOf = (inner: unknown) => ({
      $variant: {
        cases: [
          { name: "Nothing", fields: [] },
          { name: "Just", fields: [{ name: "_0", type: inner }] },
        ],
      },
    });
    const fns = [fn("a:mNum", maybeOf(Num)), fn("a:mStr", maybeOf(Str))];
    const ids = universeFunctionsMatchingReturn(fns, maybeOf(Num));
    expect(ids).toContain("a:mNum");
    expect(ids).not.toContain("a:mStr"); // inner Number vs String ⇒ no match
  });

  test("constructor-level congruence — two records match; a record does not match a Number", () => {
    const recA = { $record: { fields: [{ name: "x", type: Num }] } };
    const recB = { $record: { fields: [{ name: "y", type: Str }] } };
    const fns = [fn("a:recB", recB), fn("a:num", Num)];
    // record↔record matches at constructor level (the picker can't know fields);
    // a Number-returner does not match an expected record.
    const ids = universeFunctionsMatchingReturn(fns, recA);
    expect(ids).toContain("a:recB");
    expect(ids).not.toContain("a:num");
  });
});

describe("structural-dispatch Phase 4b — structuralInstancesFor (the inverse view) + the derive round-trip", () => {
  // `universeStructuralInstancesFor(typeName)` is the TRANSPOSE of Phase-1's
  // `resolveStructural`: instead of `(class, type) → methods` (one class), it
  // answers `type → [{class, predicate}]` (every class) — the classes a type
  // gets STRUCTURALLY because its shape matches a `ByPattern` rule's predicate.
  // The editor's RepresentationsPanel surfaces these READ-ONLY next to a type's
  // nominal instances. The decision (run each predicate over the marshalled
  // type) is the `engine:structuralInstancesFor` `.fenel` fold; the seam
  // reflects the `dispatchRegistry` ByPattern rules + marshals the type.

  const typeName = "StructPhase4bDeriveClass";

  beforeAll(() => {
    // The `derive` write — a `ByPattern` instance authored through the editor:
    // args[0] = `{$pattern: predicateFnId}` (the same shape the live UI persists
    // via the generic `/spec-instances` POST + the `dispatch:register` mirror).
    dispatchRegistry.defineClass({
      name: typeName,
      params: [{ name: "t" }],
      methods: [{ name: "describe", params: [], returns: { $ref: "String" } }],
    });
    dispatchRegistry.addInstance({
      typeName,
      args: [{ $pattern: "engine:isRecordType" } as never],
      methods: { describe: "test:structPhase4DerivedDescribe" },
    });
  });

  test("a record type surfaces the isRecordType-bounded derived class", () => {
    const rows = universeStructuralInstancesFor(REC_TYPE);
    const mine = rows.find((r) => r.typeName === typeName);
    expect(mine).toBeDefined();
    expect(mine!.predicate).toBe("engine:isRecordType");
  });

  test("a non-record type (Boolean, a $opaque) surfaces NO isRecordType-bounded class", () => {
    const rows = universeStructuralInstancesFor("Boolean");
    expect(rows.some((r) => r.typeName === typeName)).toBe(false);
  });

  test("the derive round-trip — the SAME rule resolves at dispatch AND surfaces via the view (the two halves agree)", () => {
    // Half 1: the view surfaces it for the record type.
    const surfaced = universeStructuralInstancesFor(REC_TYPE).some(
      (r) => r.typeName === typeName,
    );
    expect(surfaced).toBe(true);
    // Half 2: the SAME rule resolves at dispatch (Phase-1 resolveStructural).
    const resolved = resolveEffect(ctx, dispatchRegistry, typeName, {
      $tag: "ByType",
      target: REC_TYPE,
    });
    expect(resolved).toBeDefined();
    expect(resolved!.methods.describe).toBe("test:structPhase4DerivedDescribe");
  });
});
