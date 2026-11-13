// ---------------------------------------------------------------------------
// unified-static-analysis Phase 5a — the kind-arity predicates (advisory).
//
// `engine:isProperType` / `isUnaryConstructor` / `isBinaryConstructor`
// (`fenel/modules/engine/kinds.fenel`) decide well-kindedness over a marshalled
// `KindType` — the kinds `*`, `* -> *`, `* -> * -> *`. They ship ADVISORY this
// slice: authored + unit-pinned in isolation, NOT wired into the resolver (5b)
// and NOT registered as `ByPattern` rules (5c). The substrate they ride
// (`matchStructural` / `checkPredicateBound(s)` / `isRecordType`) is unchanged.
//
// Three layers, bottom-up:
//   (1) the PREDICATE logic over crafted `KindType` markers (the `.fenel` body,
//       dispatched directly — independent of the registry);
//   (2) the kind-marshal SEAM (`marshalKindType`) — the `$`-keyed FenelType →
//       `$`-free `KindType` lowering, incl. the real-entity arity smoke
//       (`Maybe` ⇒ 1, `Either`/`Result` ⇒ 2 — the registry-fact path);
//   (3) END-TO-END (`universeIs*`) — marshal + dispatch, incl. THE headline:
//       a nullary (`Int`) or fully-applied (`Maybe Int`) type is NOT a unary
//       constructor (the `Functor Int` rejection, proven at the predicate level
//       before 5b wires it).
//
// Runs through `dispatchEngineBody` (the type-to-set / structural-dispatch test
// precedent). No DB, no resolver.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import {
  dispatchEngineBody,
  marshalKindType,
  universeIsProperType,
  universeIsUnaryConstructor,
  universeIsBinaryConstructor,
} from "./engine-bodies-dispatch";
import type { FenelType } from "./types";

// The body returns the opaque-Bool `True`/`False` (coerced by the construct op
// to a JS boolean); tolerate a `{$tag:"True"}` shape defensively.
const kv = (v: unknown): boolean =>
  typeof v === "boolean"
    ? v
    : !!(v && typeof v === "object" && (v as { $tag?: unknown }).$tag === "True");

// Crafted marshalled `KindType` markers — exactly what `marshalKindType`
// produces (plain `tag`-records, NOT `$tag`/ADT). Pin the predicate logic
// independent of the registry.
const KtCon = (name: string, arity: number) => ({ tag: "KtCon", name, arity });
const KtProper = { tag: "KtProper" };
const KtVar = (name: string) => ({ tag: "KtVar", name });
const KtUnknown = { tag: "KtUnknown" };

const proper = (m: unknown): boolean => kv(dispatchEngineBody("engine:isProperType", [m]));
const unary = (m: unknown): boolean => kv(dispatchEngineBody("engine:isUnaryConstructor", [m]));
const binary = (m: unknown): boolean => kv(dispatchEngineBody("engine:isBinaryConstructor", [m]));

// ===========================================================================
// (1) The predicate logic over crafted KindType markers.
// ===========================================================================

describe("kind predicates — over crafted KindType markers (the .fenel logic)", () => {
  test("a unary constructor (arity 1) is unary, NOT proper, NOT binary", () => {
    for (const m of [KtCon("Maybe", 1), KtCon("List", 1)]) {
      expect(unary(m)).toBe(true);
      expect(proper(m)).toBe(false);
      expect(binary(m)).toBe(false);
    }
  });

  test("a nullary constructor (arity 0) is PROPER, NOT a constructor of any arity", () => {
    for (const m of [KtCon("Int", 0), KtCon("String", 0), KtCon("Bot", 0)]) {
      expect(proper(m)).toBe(true);
      expect(unary(m)).toBe(false);
      expect(binary(m)).toBe(false);
    }
  });

  test("a binary constructor (arity 2) is binary, NOT proper, NOT unary", () => {
    for (const m of [KtCon("Either", 2), KtCon("Result", 2), KtCon("Map", 2)]) {
      expect(binary(m)).toBe(true);
      expect(proper(m)).toBe(false);
      expect(unary(m)).toBe(false);
    }
  });

  test("a higher arity (ternary, arity 3) matches NONE of the three kinds", () => {
    const m = KtCon("Triple", 3);
    expect(proper(m)).toBe(false);
    expect(unary(m)).toBe(false);
    expect(binary(m)).toBe(false);
  });

  test("KtProper (a fully-applied / structural proper type) is proper only", () => {
    expect(proper(KtProper)).toBe(true);
    expect(unary(KtProper)).toBe(false);
    expect(binary(KtProper)).toBe(false);
  });

  test("KtVar (a type variable) gets the conservative verdict — all False", () => {
    const m = KtVar("a");
    expect(proper(m)).toBe(false);
    expect(unary(m)).toBe(false);
    expect(binary(m)).toBe(false);
  });

  test("KtUnknown gets the conservative verdict — all False", () => {
    expect(proper(KtUnknown)).toBe(false);
    expect(unary(KtUnknown)).toBe(false);
    expect(binary(KtUnknown)).toBe(false);
  });
});

// ===========================================================================
// (2) The kind-marshal seam — marshalKindType lowers a `$`-keyed FenelType in
//     constructor position to a `$`-free KindType, surfacing the registry arity.
// ===========================================================================

const ref = (n: string): FenelType => ({ $ref: n } as unknown as FenelType);

describe("marshalKindType — the category-B kind-marshal seam", () => {
  test("a REAL registered parametric entity surfaces its declared arity (the registry-fact path)", () => {
    // Maybe a ⇒ 1; Either a b / Result e a ⇒ 2. The arity read from the
    // catalog's parametric `ctor:` entry — not a hand-built marker.
    expect(marshalKindType(ref("Maybe"))).toEqual({ tag: "KtCon", name: "Maybe", arity: 1 });
    expect(marshalKindType(ref("Either"))).toEqual({ tag: "KtCon", name: "Either", arity: 2 });
    expect(marshalKindType(ref("Result"))).toEqual({ tag: "KtCon", name: "Result", arity: 2 });
  });

  test("a non-parametric name (atom / concrete entity / unregistered) ⇒ KtCon arity 0", () => {
    expect(marshalKindType(ref("Int"))).toEqual({ tag: "KtCon", name: "Int", arity: 0 });
    expect(marshalKindType(ref("String"))).toEqual({ tag: "KtCon", name: "String", arity: 0 });
    expect(marshalKindType(ref("Bot"))).toEqual({ tag: "KtCon", name: "Bot", arity: 0 });
  });

  test("a legacy `{$ref}` handle marshals identically to `{$ref}`", () => {
    expect(marshalKindType({ $ref: "Maybe" } as unknown)).toEqual({
      tag: "KtCon",
      name: "Maybe",
      arity: 1,
    });
  });

  test("a fully-applied type (`Maybe Int` as `{$el:{call}}`) ⇒ KtProper, NOT a constructor", () => {
    expect(marshalKindType({ $el: { call: ["Maybe", ref("Int")] } } as unknown)).toEqual(KtProper);
  });

  test("an expanded structural type former ⇒ KtProper (kind `*`)", () => {
    expect(marshalKindType({ $record: { fields: [] } } as unknown)).toEqual(KtProper);
    expect(marshalKindType({ $variant: { cases: [] } } as unknown)).toEqual(KtProper);
    expect(marshalKindType({ $arrow: { params: [], returns: { $void: true } } } as unknown)).toEqual(KtProper);
    expect(marshalKindType({ $void: true } as unknown)).toEqual(KtProper);
  });

  test("D-5a-2 NOMINAL — `$opaque` / `$refined` / `$tagged` are NOT peeled; the outer view is proper", () => {
    // The expanded String ($opaque over a List<Char>) is a proper type — the
    // kind reasons over the OUTER named view, never the inner pure-ADT arity.
    expect(marshalKindType({ $opaque: { name: "String", pure: ref("Char") } } as unknown)).toEqual(KtProper);
    expect(marshalKindType({ $refined: { base: ref("Int"), set: { $tag: "SeEnum", values: [1, 2] } } } as unknown)).toEqual(KtProper);
    expect(marshalKindType({ $tagged: { value: ref("Id"), phantom: ref("Bot") } } as unknown)).toEqual(KtProper);
  });

  test("a type variable ⇒ KtVar carrying its name", () => {
    expect(marshalKindType({ $var: "f" } as unknown)).toEqual({ tag: "KtVar", name: "f" });
  });

  test("a non-object / null ⇒ KtUnknown", () => {
    expect(marshalKindType(null)).toEqual(KtUnknown);
    expect(marshalKindType(undefined)).toEqual(KtUnknown);
    expect(marshalKindType("Maybe" as unknown)).toEqual(KtUnknown);
  });
});

// ===========================================================================
// (3) End-to-end — universeIs* (marshal + dispatch). The headline: a nullary or
//     fully-applied type is NOT a unary constructor (the Functor Int rejection).
// ===========================================================================

describe("kind predicates end-to-end (FenelType → marshal → dispatch)", () => {
  test("a unary constructor: Maybe ⇒ unary, not proper, not binary", () => {
    expect(universeIsUnaryConstructor(ref("Maybe"))).toBe(true);
    expect(universeIsProperType(ref("Maybe"))).toBe(false);
    expect(universeIsBinaryConstructor(ref("Maybe"))).toBe(false);
  });

  test("a binary constructor: Either / Result ⇒ binary, not unary", () => {
    expect(universeIsBinaryConstructor(ref("Either"))).toBe(true);
    expect(universeIsBinaryConstructor(ref("Result"))).toBe(true);
    expect(universeIsUnaryConstructor(ref("Either"))).toBe(false);
  });

  test("an atom: Int / String ⇒ proper, not a constructor", () => {
    expect(universeIsProperType(ref("Int"))).toBe(true);
    expect(universeIsProperType(ref("String"))).toBe(true);
    expect(universeIsUnaryConstructor(ref("Int"))).toBe(false);
    expect(universeIsBinaryConstructor(ref("Int"))).toBe(false);
  });

  test("THE Functor Int rejection — a nullary type is NOT a unary constructor", () => {
    // The soundness payload kinds buys (proven advisory, before 5b's wiring):
    // `Functor f` requires `isUnaryConstructor f`; `f = Int` fails it.
    expect(universeIsUnaryConstructor(ref("Int"))).toBe(false);
  });

  test("an applied type is NOT a unary constructor — `Functor (Maybe Int)` would reject", () => {
    const applied = { $el: { call: ["Maybe", ref("Int")] } } as unknown as FenelType;
    expect(universeIsUnaryConstructor(applied)).toBe(false);
    expect(universeIsProperType(applied)).toBe(true); // it IS a proper type (kind `*`)
  });
});
