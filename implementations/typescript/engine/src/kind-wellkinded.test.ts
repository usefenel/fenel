// ---------------------------------------------------------------------------
// unified-static-analysis Phase 5b — well-kindedness is SOUND: `Functor Int`
// REJECTS at a real site (the soundness payload kinds buys).
//
// 5a authored the kind-arity predicates (`engine:isUnaryConstructor` etc.,
// `fenel/modules/engine/kinds.fenel`) ADVISORY — checkable, not checked. 5b
// wires them: `effect-dispatch.ts:checkKindBound` checks a class application
// `C T` against `C`'s class-param kind and RAISES on an ill-kinded arg.
//
// The DECISION is the SHIPPED `.fenel` `checkPredicateBounds` fold (marshal-
// agnostic) over the 5a predicates; the seam derives the required arity from the
// class's own method signatures (the `dispatchPositionForSeed` precedent — NOT
// an authored field nor a TS table) and marshals the type-arg via
// `marshalKindType` (THE CRUX — arity-carrying). SITE = the dedicated entry (the
// brief's recommended primary); instance-registration is an unsound site (a
// `Functor (Result e)` instance keyed by the bare `"Result"` would false-reject)
// and deliberately NOT wired.
//
// Runs in-process via createRegistry + the boot dispatchRegistry (the
// structural-dispatch.test.ts pattern, no DB). type-to-set runs FIRST in the
// gate command to prime engine-body dispatch and dodge the type-catalog TDZ.
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { stdModule } from "./modules/std";
import { engineModule } from "./modules/engine";
import { createRegistry } from "./registry";
import { dispatchRegistry } from "./system-entities";
import { checkKindBound, classParamArity } from "./effect-dispatch";
import type { EvaluateContext } from "./json-logic";
import type { FenelType } from "./types";

let ctx: EvaluateContext;
let reg: ReturnType<typeof createRegistry>;

beforeAll(() => {
  reg = createRegistry([stdModule, engineModule], { dispatchRegistry });
  ctx = reg.evaluateContext();
});

const ref = (n: string): FenelType => ({ $ref: n } as unknown as FenelType);
// A fully-applied type `Maybe Int` — the deferred type-application shape.
const applied = (head: string, ...args: FenelType[]): FenelType =>
  ({ $el: { call: [head, ...args] } } as unknown as FenelType);

// ===========================================================================
// (1) classParamArity — the required kind is DERIVED from the class signature
//     (no authored field, no TS table). `Functor f` / `Monad m` apply their
//     param to one arg ⇒ arity 1 (`* -> *`); `Monoid a` never applies it ⇒ 0.
// ===========================================================================

describe("classParamArity — kind derived from the class's own method signatures", () => {
  test("Functor / Monad are `* -> *` (the class param is applied to one arg)", () => {
    expect(classParamArity(dispatchRegistry.getClass("Functor")!)).toBe(1);
    expect(classParamArity(dispatchRegistry.getClass("Monad")!)).toBe(1);
  });

  test("Monoid is `*` (the class param is never applied)", () => {
    expect(classParamArity(dispatchRegistry.getClass("Monoid")!)).toBe(0);
  });
});

// ===========================================================================
// (2) THE HEADLINE — `Functor Int` REJECTS; a well-kinded application ACCEPTS.
// ===========================================================================

describe("checkKindBound — ill-kinded class applications REJECT (the soundness payload)", () => {
  test("THE Functor Int rejection — a nullary type is not a `* -> *` constructor", () => {
    expect(() => checkKindBound(ctx, dispatchRegistry, "Functor", ref("Int"))).toThrow(
      /ill-kinded application/,
    );
    // The message names the class, the required kind, and the offending arg.
    expect(() => checkKindBound(ctx, dispatchRegistry, "Functor", ref("Int"))).toThrow(
      /Functor.*\* -> \*.*Int/s,
    );
  });

  test("Functor (Maybe Int) rejects — an applied / proper type is not a constructor", () => {
    expect(() =>
      checkKindBound(ctx, dispatchRegistry, "Functor", applied("Maybe", ref("Int"))),
    ).toThrow(/ill-kinded application/);
  });

  test("Functor Either rejects — a binary constructor (`* -> * -> *`) is the wrong arity", () => {
    // Either has no Functor instance; the bare binary constructor genuinely
    // is not `* -> *` (only the partial application `Either e` would be).
    expect(() => checkKindBound(ctx, dispatchRegistry, "Functor", ref("Either"))).toThrow(
      /ill-kinded application/,
    );
  });

  test("Monad Int rejects too (`* -> *` class, nullary arg)", () => {
    expect(() => checkKindBound(ctx, dispatchRegistry, "Monad", ref("Int"))).toThrow(
      /ill-kinded application/,
    );
  });

  test("a well-kinded application ACCEPTS — Functor Maybe / Monad Maybe (real arity-1 constructors)", () => {
    expect(checkKindBound(ctx, dispatchRegistry, "Functor", ref("Maybe")).checked).toEqual([
      "engine:isUnaryConstructor",
    ]);
    expect(checkKindBound(ctx, dispatchRegistry, "Monad", ref("Maybe")).checked).toEqual([
      "engine:isUnaryConstructor",
    ]);
  });
});

// ===========================================================================
// (3) No false rejection — the kind-`*` class + the unknown-class + the
//     ctx-less paths are all vacuous (the no-false-reject guard).
// ===========================================================================

describe("checkKindBound — vacuous / no-false-reject paths", () => {
  test("Monoid (kind `*`) accepts any type — no CONSTRUCTOR check", () => {
    // arity 0 ⇒ no predicate ⇒ nothing checked, never throws (the Monoid
    // near-vacuous case the brief calls out, D-5b-4).
    expect(checkKindBound(ctx, dispatchRegistry, "Monoid", ref("Int")).checked).toEqual([]);
    expect(checkKindBound(ctx, dispatchRegistry, "Monoid", ref("Maybe")).checked).toEqual([]);
  });

  test("an unknown class is vacuous (no seed to derive a kind from)", () => {
    expect(checkKindBound(ctx, dispatchRegistry, "NoSuchClass", ref("Int")).checked).toEqual([]);
  });

  test("a ctx-less call checks nothing (cannot invoke the .fenel fold)", () => {
    expect(checkKindBound(undefined, dispatchRegistry, "Functor", ref("Int")).checked).toEqual(
      [],
    );
  });
});

// ===========================================================================
// Phase 6a — the CARRIED 5a/5b advisory gap is CLOSED. `List` is a foundation
// opaque with NO catalog `ctor:` / `entity:` entry, so `marshalKindType` USED to
// read it as arity 0 ⇒ `checkKindBound("Functor", List)` false-REJECTED a real
// functor. 6a sources its arity from the FOUNDATION declaration
// (`foundationEntityRegs`, `List a` ⇒ params `["a"]` ⇒ 1) so `marshalKindType(
// {$ref:"List"})` ⇒ `KtCon "List" 1` ⇒ `isUnaryConstructor` True. `Map` (a
// parser-inlined `$map` former with no entity) reads arity 2 from the flagged
// `BUILTIN_STRUCTURAL_ARITY` ⇒ a binary constructor, the WRONG arity for Functor.
// (flip: was reject→now accept for List; Map stays a correct reject as binary.)
// ===========================================================================

describe("checkKindBound — the foundation parametric arity gap is closed (Phase 6a)", () => {
  test("Functor List ACCEPTS — `List a` is a real `* -> *` constructor (the D-5b flip)", () => {
    expect(checkKindBound(ctx, dispatchRegistry, "Functor", ref("List")).checked).toEqual([
      "engine:isUnaryConstructor",
    ]);
  });

  test("Monad List ACCEPTS too (`* -> *` class, arity-1 arg)", () => {
    expect(checkKindBound(ctx, dispatchRegistry, "Monad", ref("List")).checked).toEqual([
      "engine:isUnaryConstructor",
    ]);
  });

  test("Functor Map rejects — `Map k v` is binary (`* -> * -> *`), the wrong arity", () => {
    expect(() => checkKindBound(ctx, dispatchRegistry, "Functor", ref("Map"))).toThrow(
      /ill-kinded application/,
    );
  });
});
