// ---------------------------------------------------------------------------
// unified-static-analysis Phase 5c — kinds are a live `ByPattern` structural-
// dispatch bound: a type's KIND dispatches via the SHIPPED `matchStructural`
// substrate, and surfaces via the SHIPPED `structuralInstancesFor` inverse view.
//
// 5a authored the kind-arity predicates (`engine:isUnaryConstructor` etc.,
// `fenel/modules/engine/kinds.fenel`); 5b wired them into a dedicated
// application-check (`checkKindBound`). 5c registers them onto the GENERAL
// structural-dispatch substrate (the `ByPattern` rule path everything else
// uses): a typeclass instance keyed by `{$pattern:"engine:isUnaryConstructor"}`
// resolves at dispatch for every constructor of the right kind.
//
// THE CRUX (D-5c-CRUX) — the per-rule marshal reconciliation. `resolveStructural`
// / `universeStructuralInstancesFor` marshal the dispatched type ONCE via
// `marshalTraversalType` (→ a `TtNamed`/`TtRecord` shape, NO arity) and run every
// rule's predicate over it. A kind predicate reads a `KtCon`-flavoured
// `marshalKindType` view — run AS-IS over a `TtNamed` its `t.tag == "KtCon"` /
// `"KtProper"` test is NEVER True ⇒ the rule is silently dead. 5c carries each
// rule its OWN marshalled `ty`, selected from the predicate's DECLARED param type
// (`KindType` ⇒ `marshalKindType`; else `marshalTraversalType`) — a Fenel-
// authored fact, a registry spec read at the seam. This test proves a kind-
// bounded rule now RESOLVES + SURFACES; structural-dispatch.test.ts proves the
// `isRecordType` (structural) path is byte-green (the marshal is additive).
//
// Phase 6a — kind resolution is NOMINAL ([[project_fenel_dispatch_is_nominal]]):
// a type's kind is its NAME's declared arity, read from the registry, NOT its
// expanded structure. `resolveStructural` / `universeStructuralInstancesFor`
// marshal a kind-flavoured rule from the type NAME (`marshalKindType({$ref:
// typeName})`), decoupled from `getEntityTypeByName`, and proceed past the
// `rawType === undefined` early-return when a kind rule is present and the name
// is a known constructor (`kindArityOf > 0`). So the REAL names dispatch by kind
// — `Maybe`/`List` ⇒ unary; `Either`/`Result`/`Map` ⇒ binary; `Int`/a record ⇒
// proper. The 5c TYPE-ALIAS workaround (`KindBypMaybeAlias.type = {$ref:"Maybe"}`)
// is RETIRED: with nominal marshalling an alias marshals to its OWN name's arity
// (`kindArityOf("KindBypMaybeAlias") = 0`), so it would (correctly) read as a
// proper type, not the referent's kind. The bare names now resolve directly.
//
// (D-5c-2 + the carried D-5b List/Map arity gap are CLOSED here: `kindArityOf`
// consults `foundationEntityRegs` for `List` ⇒ 1 and `BUILTIN_STRUCTURAL_ARITY`
// for `Map` ⇒ 2, so a real `List`/`Map` value marshals to its true `KtCon` arity.)
//
// Runs in-process via createRegistry + the boot dispatchRegistry (the
// structural-dispatch.test.ts pattern, no DB), under uniquely-named throwaway
// classes so global state is not polluted for other suites. type-to-set runs
// FIRST in the gate command to prime engine-body dispatch (dodge the
// type-catalog TDZ).
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { createRegistry } from "./registry";
import { dispatchRegistry, systemEntities } from "./system-entities";
import { resolveEffect } from "./effect-dispatch";
import {
  universeStructuralInstancesFor,
  predicateConsumesKindType,
} from "./engine-bodies-dispatch";
import type { EvaluateContext } from "./json-logic";

// THE REAL parametric / atom names — dispatched DIRECTLY (nominal), no alias.
const MAYBE = "Maybe"; // ctor: arity 1   (* -> *)
const LIST = "List"; //   foundation arity 1 (* -> *) — the carried D-5b gap
const EITHER = "Either"; // ctor: arity 2  (* -> * -> *)
const RESULT = "Result"; // ctor: arity 2  (* -> * -> *)
const MAP = "Map"; //     builtin arity 2 (* -> * -> *)
const INT = "Int"; //     foundation arity 0 (*) — NOT a constructor

// A real registered concrete entity (a `$record`, kind `*`) — `getEntityTypeByName`
// RESOLVES it, so it proceeds through the seam and marshals to `KtCon <name> 0`
// (proper). A nullary ATOM by bare name (`Int`) has NO `entity:` expansion AND
// arity 0, so it is (correctly) outside the kind-gated relaxation — proper-type
// dispatch rides registered entities, not bare atoms (a documented 6a boundary).
const REC = "KindBypRec"; // {$record} ⇒ KtCon arity 0 (proper, *)

const UNARY_CLASS = "KindBypUnaryClass"; // bounded by isUnaryConstructor (* -> *)
const PROPER_CLASS = "KindBypProperClass"; // bounded by isProperType (*)

let ctx: EvaluateContext;
let reg: ReturnType<typeof createRegistry>;

const pushEntity = (id: string, type: unknown): void => {
  if (!systemEntities.some((e) => e.id === id)) {
    systemEntities.push({ id, type } as never);
  }
};

beforeAll(() => {
  pushEntity(REC, {
    $record: {
      fields: [{ name: "id", type: { $ref: "String" } }],
    },
  });
  reg = createRegistry([stdModule, engineModule], { dispatchRegistry });
  ctx = reg.evaluateContext();

  // The kind-bounded `ByPattern` rules — a marker class keyed by a kind
  // predicate (D-5c-4: PROOF/SUBSTRATE, not a real Functor instance; the per-type
  // method bodies are the Phase-6 capstone).
  dispatchRegistry.defineClass({
    name: UNARY_CLASS,
    params: [{ name: "t" }],
    methods: [{ name: "describe", params: [], returns: { $ref: "String" } }],
  });
  dispatchRegistry.addInstance({
    typeName: UNARY_CLASS,
    args: [{ $pattern: "engine:isUnaryConstructor" } as never],
    methods: { describe: "test:kindByPatternUnaryDescribe" },
  });

  dispatchRegistry.defineClass({
    name: PROPER_CLASS,
    params: [{ name: "t" }],
    methods: [{ name: "describe", params: [], returns: { $ref: "String" } }],
  });
  dispatchRegistry.addInstance({
    typeName: PROPER_CLASS,
    args: [{ $pattern: "engine:isProperType" } as never],
    methods: { describe: "test:kindByPatternProperDescribe" },
  });
});

// ===========================================================================
// (0) THE CLASSIFIER — the kind predicates declare `(t: KindType)`, the
//     structural ones `(t: TraversalType)`; the seam selects the marshal from
//     that Fenel-authored param type (NOT a TS hardcode of fn-ids).
// ===========================================================================

describe("the marshal classifier reads the predicate's declared param type", () => {
  test("the kind predicates consume the KindType (marshalKindType) view", () => {
    expect(predicateConsumesKindType("engine:isUnaryConstructor")).toBe(true);
    expect(predicateConsumesKindType("engine:isProperType")).toBe(true);
    expect(predicateConsumesKindType("engine:isBinaryConstructor")).toBe(true);
  });

  test("a structural predicate (isRecordType : TraversalType) does NOT", () => {
    expect(predicateConsumesKindType("engine:isRecordType")).toBe(false);
  });

  test("an unknown predicate is structural by default (no crash)", () => {
    expect(predicateConsumesKindType("engine:noSuchPredicate")).toBe(false);
  });
});

// ===========================================================================
// (1) THE HEADLINE — a kind-bounded `ByPattern` rule RESOLVES at dispatch for a
//     constructor of the right arity, and NOT for the wrong arity / a proper
//     type. Without the per-rule `marshalKindType` view the predicate would get
//     a `TtNamed`/`TtRecord` and be silently dead — this is the new-path guard.
// ===========================================================================

describe("isUnaryConstructor ByPattern rule DISPATCHES by kind (resolveEffect)", () => {
  const resolve = (target: string) =>
    resolveEffect(ctx, dispatchRegistry, UNARY_CLASS, { $tag: "ByType", target });

  test("a REAL unary constructor (Maybe, `* -> *`) RESOLVES the rule nominally", () => {
    const r = resolve(MAYBE);
    expect(r).toBeDefined();
    expect(r!.methods.describe).toBe("test:kindByPatternUnaryDescribe");
  });

  test("a REAL foundation unary constructor (List, `* -> *`) RESOLVES — the carried D-5b gap", () => {
    const r = resolve(LIST);
    expect(r).toBeDefined();
    expect(r!.methods.describe).toBe("test:kindByPatternUnaryDescribe");
  });

  test("a binary constructor (Either / Result / Map, `* -> * -> *`) does NOT resolve", () => {
    expect(resolve(EITHER)).toBeUndefined();
    expect(resolve(RESULT)).toBeUndefined();
    expect(resolve(MAP)).toBeUndefined();
  });

  test("a nullary type (Int, kind `*`) does NOT resolve — not a constructor", () => {
    expect(resolve(INT)).toBeUndefined();
  });

  test("a proper type (a registered record, kind `*`) does NOT resolve", () => {
    expect(resolve(REC)).toBeUndefined();
  });
});

// ===========================================================================
// (2) THE INVERSE — `structuralInstancesFor` SURFACES the kind-bounded class
//     for the matching type only (the editor's read-only structural view).
// ===========================================================================

describe("isUnaryConstructor ByPattern rule SURFACES by kind (structuralInstancesFor)", () => {
  const surfaces = (typeName: string, expectedClass: string) =>
    universeStructuralInstancesFor(typeName).some((r) => r.typeName === expectedClass);

  test("the REAL unary constructor (Maybe) surfaces the isUnaryConstructor-bounded class", () => {
    const rows = universeStructuralInstancesFor(MAYBE);
    const mine = rows.find((r) => r.typeName === UNARY_CLASS);
    expect(mine).toBeDefined();
    expect(mine!.predicate).toBe("engine:isUnaryConstructor");
  });

  test("the REAL foundation unary constructor (List) surfaces it too", () => {
    expect(surfaces(LIST, UNARY_CLASS)).toBe(true);
  });

  test("the binary constructor (Either) does NOT surface the isUnaryConstructor class", () => {
    expect(surfaces(EITHER, UNARY_CLASS)).toBe(false);
  });

  test("the nullary type (Int) does NOT surface the isUnaryConstructor class", () => {
    expect(surfaces(INT, UNARY_CLASS)).toBe(false);
  });
});

// ===========================================================================
// (3) THE OTHER KIND — isProperType (`*`) is a live bound too: it ACCEPTS a
//     proper type (a nullary alias + a record) and REJECTS a constructor. This
//     proves the per-rule marshal isn't hardwired to one predicate — every
//     KindType predicate dispatches over the marshalKindType view.
// ===========================================================================

describe("isProperType ByPattern rule DISPATCHES + SURFACES by kind", () => {
  const resolve = (target: string) =>
    resolveEffect(ctx, dispatchRegistry, PROPER_CLASS, { $tag: "ByType", target });
  const surfaces = (typeName: string) =>
    universeStructuralInstancesFor(typeName).some((r) => r.typeName === PROPER_CLASS);

  test("a registered proper type (a record, kind `*`) RESOLVES + SURFACES the isProperType rule", () => {
    const r = resolve(REC);
    expect(r).toBeDefined();
    expect(r!.methods.describe).toBe("test:kindByPatternProperDescribe");
    expect(surfaces(REC)).toBe(true);
  });

  test("a unary constructor (Maybe, `* -> *`) does NOT resolve isProperType", () => {
    expect(resolve(MAYBE)).toBeUndefined();
    expect(surfaces(MAYBE)).toBe(false);
  });

  test("a binary constructor (Either, `* -> * -> *`) does NOT resolve isProperType", () => {
    expect(resolve(EITHER)).toBeUndefined();
    expect(surfaces(EITHER)).toBe(false);
  });
});
