// Phase 7g-retire-2c (typed-function-references) — the SHIELDED ⚠️ marshaller /
// reader set folds `{$ref}` ≡ `{$ref}`.
//
// These are the consumers that read `{$ref}` today ONLY because the rewrite-to-
// named layer (`refToStructuralOrNamed` + the validate/propagate preludes) keeps
// synthesizing `{$ref}` for them — so in PRODUCTION they never see a raw
// `{$ref}` (the fold is dormant). This file makes the fold NON-dormant: it feeds
// a `{$ref:X}` name-handle DIRECTLY to each marshaller (via the exported
// `dispatched*` wrappers, which call the marshallers without the SetExpr
// entry-resolve `contains`/`isDisjoint` apply) and asserts it decides
// BYTE-IDENTICALLY to its `{$ref:X}` twin.
//
// Why a `{$ref}` here is a NAME handle, not a resolver lookup: these marshallers
// reason over the name-equality leaf (the number tower `ℝ`/`ℕ`, the `format:*`
// named sets, atom names like `String`) — exactly the values `refHandle` reads.
// No resolver is involved; the fold (`refLeafAsNamed`) re-forms the `{$ref}` leaf
// into the `{$ref}` shape the marshaller body already consumes.
//
// A BROKEN fold is observable: an un-folded `{$ref}` falls through every
// `"$ref" in set` arm to the marshaller's default (`SeOpaque{Nothing}` /
// `DcAny` / `Nothing`), so a `{$ref}` decision would DIVERGE from its `{$ref}`
// twin (the named-set names below give definite, asymmetric answers).

import { test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { loadLock } from "./codename-lock";
import {
  dispatchedContains,
  dispatchedDecideEmpty,
  dispatchedIsDisjoint,
  dispatchedIsSubset,
  dispatchedIsValueOnlyPredicate,
  dispatchedFormatSetExpr,
  dispatchedAutoLabel,
  dispatchedFormatSetError,
  dispatchedSetExprAtom,
  dispatchedResolveAtom,
  dispatchedMatchesShape,
  dispatchedCollectTypeNames,
  dispatchedPhantomGeoLevelOf,
  dispatchEngineBody,
  marshalTraversalType,
  withInterpretedCompiledArtifacts,
} from "./engine-bodies-dispatch";
import { parseInput, registerParseFn } from "./input-layer";
import type { ParseResult } from "./input-layer";
import "./input-parsers";
import { CurrencyTag, Id, Int, Integer, Maybe, Nat, Rational, RationalNumber } from "./type-foundation";
import { measureType } from "./units";
import { typeToSetExpr } from "./fenel-check";
import { expandNamed } from "./validation-hints";
import { inferDisplayField } from "./types";
import type { FenelType, SetExpr } from "./types";
import { isSetExpr } from "./types";
import { setExprToDollarKey } from "./set-marker";

// set-algebra-to-fenel Phase 3b-2 — the producer flip changed the OUTPUT FORM
// (`$`-key → `$tag`) of SetExprs the marshaller re-emits (here the `{$ref}`
// leaf re-emit). `cf` deeply lowers ANY-form SetExpr back to `$`-key so the
// byte-parity assertion vs the `$`-key expected literal stays a STRUCTURE/VALUE
// check (setExprToDollarKey rewrites only the discriminator).
function cf(x: unknown): unknown {
  if (x instanceof Map) return new Map([...x].map(([k, v]) => [cf(k), cf(v)]));
  if (Array.isArray(x)) return x.map(cf);
  if (x && typeof x === "object") {
    const sx = isSetExpr(x) ? setExprToDollarKey(x as SetExpr) : x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sx as object)) out[k] = cf(v);
    return out;
  }
  return x;
}

// Engine bodies (`engine:setAlgebraContains`, …) must be registered for the
// `dispatched*` wrappers to dispatch — mirror the setexpr-recognizers test.
createRegistry([stdModule], { codeNameLock: loadLock() });

const named = (n: string) => ({ $ref: n }) as unknown as SetExpr;
const ref = (n: string) => ({ $ref: n }) as unknown as SetExpr;
const namedT = (n: string) => ({ $ref: n }) as unknown as FenelType;
const refT = (n: string) => ({ $ref: n }) as unknown as FenelType;

describe("7g-retire-2c — engine-bodies-dispatch SetExpr deciders fold {$ref}≡{$ref}", () => {
  test("dispatchedContains: {$ref:ℕ} decides identically to {$ref:ℕ} (definite Just)", () => {
    for (const v of [5, -1, 0, "x", 3.5]) {
      expect(dispatchedContains(ref("ℕ"), v, null)).toEqual(dispatchedContains(named("ℕ"), v, null));
    }
    // Non-trivial: a broken fold would yield Nothing, not these definite answers.
    expect(dispatchedContains(ref("ℕ"), 5, null)).toEqual({ $tag: "Just", _0: true });
    expect(dispatchedContains(ref("ℕ"), -1, null)).toEqual({ $tag: "Just", _0: false });
  });

  test("dispatchedContains: {$ref:format:email} ≡ {$ref:format:email}", () => {
    for (const v of ["a@b.com", "notanemail", ""]) {
      expect(dispatchedContains(ref("format:email"), v, null)).toEqual(
        dispatchedContains(named("format:email"), v, null),
      );
    }
    expect(dispatchedContains(ref("format:email"), "a@b.com", null)).toEqual({ $tag: "Just", _0: true });
  });

  test("dispatchedDecideEmpty: {$ref:ℕ} ≡ {$ref:ℕ}", () => {
    expect(dispatchedDecideEmpty(ref("ℕ"))).toEqual(dispatchedDecideEmpty(named("ℕ")));
  });

  test("dispatchedIsDisjoint: {$ref:ℕ} as operand ≡ {$ref:ℕ} (both orderings)", () => {
    const other: SetExpr = { $tag: "SeEnum", values: [5, 10] };
    expect(dispatchedIsDisjoint(ref("ℕ"), other)).toEqual(dispatchedIsDisjoint(named("ℕ"), other));
    expect(dispatchedIsDisjoint(other, ref("ℕ"))).toEqual(dispatchedIsDisjoint(other, named("ℕ")));
  });

  test("dispatchedIsSubset: {$ref:ℕ} as operand ≡ {$ref:ℕ} (both orderings)", () => {
    const other: SetExpr = { $tag: "SeEnum", values: [5, 10] };
    expect(dispatchedIsSubset(ref("ℕ"), other)).toEqual(dispatchedIsSubset(named("ℕ"), other));
    expect(dispatchedIsSubset(other, ref("ℕ"))).toEqual(dispatchedIsSubset(other, named("ℕ")));
  });

  test("dispatchedIsValueOnlyPredicate: {$ref:ℕ} ≡ {$ref:ℕ}", () => {
    expect(dispatchedIsValueOnlyPredicate(ref("ℕ"))).toBe(
      dispatchedIsValueOnlyPredicate(named("ℕ")),
    );
  });

  test("dispatchedFormatSetExpr: {$ref:X} ≡ {$ref:X} (incl. named-range $intersect)", () => {
    expect(dispatchedFormatSetExpr(ref("ℕ"))).toBe(dispatchedFormatSetExpr(named("ℕ")));
    const iv = { $interval: { lo: { $tag: "Just", _0: { value: 0, inclusive: true } }, hi: { $tag: "Just", _0: { value: 9, inclusive: true } } } } as unknown as SetExpr;
    const rangeRef: SetExpr = { $intersect: [ref("ℝ"), iv] } as unknown as SetExpr;
    const rangeNamed: SetExpr = { $intersect: [named("ℝ"), iv] } as unknown as SetExpr;
    expect(dispatchedFormatSetExpr(rangeRef)).toBe(dispatchedFormatSetExpr(rangeNamed));
  });

  test("dispatchedAutoLabel / dispatchedFormatSetError: {$ref:X} ≡ {$ref:X}", () => {
    expect(dispatchedAutoLabel(ref("ℕ"))).toBe(dispatchedAutoLabel(named("ℕ")));
    expect(dispatchedFormatSetError(ref("ℕ"))).toBe(dispatchedFormatSetError(named("ℕ")));
  });

  test("dispatchedSetExprAtom: {$ref:format:email} ≡ {$ref:format:email}", () => {
    expect(dispatchedSetExprAtom(ref("format:email"))).toBe(
      dispatchedSetExprAtom(named("format:email")),
    );
    expect(dispatchedSetExprAtom(ref("String"))).toBe(dispatchedSetExprAtom(named("String")));
  });
});

describe("7g-retire-2c — engine-bodies-dispatch type marshallers fold {$ref}≡{$ref}", () => {
  test("dispatchedResolveAtom: {$ref:String} ≡ {$ref:String} (RaiNamed leaf)", () => {
    expect(dispatchedResolveAtom(refT("String"))).toBe(dispatchedResolveAtom(namedT("String")));
    // Nested under $refined.base — recursion edge folds too.
    const refinedRef = { $refined: { base: refT("String"), set: { $tag: "SeAll" } } } as unknown as FenelType;
    const refinedNamed = { $refined: { base: namedT("String"), set: { $tag: "SeAll" } } } as unknown as FenelType;
    expect(dispatchedResolveAtom(refinedRef)).toBe(dispatchedResolveAtom(refinedNamed));
  });

  test("dispatchedMatchesShape (TraversalType): {$ref:Foo} ≡ {$ref:Foo} (TtNamed → accept)", () => {
    for (const v of [1, "x", true, null, [], {}]) {
      expect(dispatchedMatchesShape(v, refT("Foo"))).toBe(dispatchedMatchesShape(v, namedT("Foo")));
    }
  });

  test("dispatchedCollectTypeNames (marshalTraversalType): {$ref:Foo} ≡ {$ref:Foo}", () => {
    expect(dispatchedCollectTypeNames(refT("Foo"))).toEqual(
      dispatchedCollectTypeNames(namedT("Foo")),
    );
    // Nested inside a record field type.
    const key = { $tag: "NamedField", ref: { $ref: "11111111-1111-4111-8111-111111111111" } };
    const recRef = { $record: { fields: [{ name: "f", key, type: refT("Foo") }] } } as unknown as FenelType;
    const recNamed = { $record: { fields: [{ name: "f", key, type: namedT("Foo") }] } } as unknown as FenelType;
    expect(dispatchedCollectTypeNames(recRef)).toEqual(dispatchedCollectTypeNames(recNamed));
  });

  test("dispatchedPhantomGeoLevelOf: $tagged.value {$ref:GeoPath} ≡ {$ref:GeoPath}", () => {
    const mk = (inner: FenelType): FenelType =>
      ({
        $tagged: {
          value: inner,
          phantom: { $refined: { base: namedT("GeoLevel"), set: { $tag: "SeEnum", values: [{ $tag: "City" }] } } },
        },
      }) as unknown as FenelType;
    expect(dispatchedPhantomGeoLevelOf(mk(refT("GeoPath")))).toEqual(
      dispatchedPhantomGeoLevelOf(mk(namedT("GeoPath"))),
    );
    // And the non-Place shape still short-circuits to null for both forms.
    expect(dispatchedPhantomGeoLevelOf(mk(refT("Id")))).toEqual(
      dispatchedPhantomGeoLevelOf(mk(namedT("Id"))),
    );
  });
});

describe("input parsing follows Tagged bases", () => {
  const tagged = (base: FenelType, phantom: FenelType): FenelType => ({
    $tagged: { value: base, phantom },
  });
  const currency = tagged(refT("Number"), CurrencyTag("USD"));
  const measure = measureType({ $tag: "MeasureOne" });
  const sourceAtom = (baseName: string, type: FenelType) =>
    withInterpretedCompiledArtifacts(() => dispatchEngineBody("engine:resolveAtom", [{
      $tag: "RaiTagged",
      base: { $tag: "RaiNamed", name: baseName },
      type: marshalTraversalType(type),
    }]));

  test("source selects Number rather than its currency phantom", () => {
    expect(withInterpretedCompiledArtifacts(() => dispatchEngineBody("engine:classifyResolvedAtomInput", [
      marshalTraversalType(currency),
    ]))).toMatchObject({ $tag: "RaiTagged", base: { $tag: "RaiNamed", name: "Number" } });
    expect(sourceAtom("Number", currency)).toEqual({ $tag: "Just", _0: "Number" });
    expect(dispatchedResolveAtom(currency)).toBe("Number");
    expect(parseInput(" 12.5 ", currency)).toEqual({ ok: true, value: 12.5 });
    expect(parseInput("not numeric", currency).ok).toBe(false);
  });

  test("typed measure phantoms select the exact Rational base parser", () => {
    expect(sourceAtom("Rational", measure)).toEqual({ $tag: "Just", _0: "Rational" });
    expect(dispatchedResolveAtom(measure)).toBe("Rational");
    expect(parseInput("0.1", measure)).toEqual({
      ok: true, value: { $tag: "Rational", num: "1", den: "10" },
    });
    expect(parseInput("9007199254740993/7", measure)).toEqual({
      ok: true, value: { $tag: "Rational", num: "9007199254740993", den: "7" },
    });
  });

  test("the ℚ parser registration and RationalNumber refinement stay exact", () => {
    const expected = { ok: true, value: { $tag: "Rational", num: "1", den: "3" } } satisfies ParseResult;
    expect(parseInput("1/3", refT("ℚ"))).toEqual(expected);
    expect(parseInput("1/3", RationalNumber)).toEqual(expected);
    expect(withInterpretedCompiledArtifacts(() => dispatchEngineBody("engine:parseExactRational", [{
      $tag: "ParseExactStr", text: "1/3",
    }]))).toEqual({ $tag: "POk", value: expected.value });
  });

  test("Nat/Int names and glyph aliases preserve small Number values and larger exact digits", () => {
    for (const name of ["Nat", "ℕ"]) {
      expect(parseInput("+00012", refT(name))).toEqual({ ok: true, value: 12 });
      expect(parseInput("9007199254740991", refT(name))).toEqual({ ok: true, value: 9007199254740991 });
      expect(parseInput("9007199254740993", refT(name))).toEqual({
        ok: true, value: { $tag: "Nat", digits: "9007199254740993" },
      });
    }
    for (const name of ["Int", "ℤ"]) {
      expect(parseInput("-00012", refT(name))).toEqual({ ok: true, value: -12 });
      expect(parseInput("-9007199254740991", refT(name))).toEqual({ ok: true, value: -9007199254740991 });
      expect(parseInput("-9007199254740993", refT(name))).toEqual({
        ok: true, value: { $tag: "Int", digits: "-9007199254740993" },
      });
    }
    expect(parseInput("-0000", refT("Nat"))).toEqual({ ok: true, value: 0 });
    expect(parseInput("-0000", Integer)).toEqual({ ok: true, value: 0 });
  });

  test("source Nat and Int parser adapters use the shared exact-input carrier", () => {
    for (const [name, text, value] of [
      ["Nat", "9007199254740993", { $tag: "Nat", digits: "9007199254740993" }],
      ["Int", "-9007199254740993", { $tag: "Int", digits: "-9007199254740993" }],
    ] as const) {
      expect(withInterpretedCompiledArtifacts(() => dispatchEngineBody(`engine:parseExact${name}`, [{
        $tag: "ParseExactStr", text,
      }]))).toEqual({ $tag: "POk", value });
    }
  });

  test("identified Nat/Int opaque bases and typed unit tags choose their exact parser", () => {
    for (const [base, name] of [[Nat, "Nat"], [Int, "Int"]] as const) {
      expect(dispatchedResolveAtom(base)).toBe(name);
      for (const type of [base, measureType({ $tag: "MeasureOne" }, base)]) {
        expect(parseInput("9007199254740993", type)).toEqual({
          ok: true, value: { $tag: name, digits: "9007199254740993" },
        });
      }
      const unrelated: FenelType = { $opaque: { name, pure: refT("String") } };
      expect(dispatchedResolveAtom(unrelated)).toBe("String");
      expect(parseInput("9007199254740993", unrelated)).toEqual({ ok: true, value: "9007199254740993" });
    }
  });

  test("typed exact integers and pure constructors pass without normalization", () => {
    const pureNat = { $tag: "Succ", _0: { $tag: "Zero" } };
    const pureInt = { $tag: "Int", magnitude: pureNat, negative: { $tag: "False" } };
    for (const [type, values] of [
      [Nat, [0, 12, { $tag: "Nat", digits: "9007199254740993" }, pureNat]],
      [Int, [0, -12, { $tag: "Int", digits: "-9007199254740993" }, pureInt]],
    ] as const) {
      for (const value of values) expect(parseInput(value, type)).toEqual({ ok: true, value });
    }
  });

  test("integer parsing refuses incompatible text, nonmembers and membership abstention", () => {
    for (const type of [Nat, Int]) {
      expect(parseInput("1.5", type).ok).toBe(false);
      expect(parseInput("1/2", type).ok).toBe(false);
      expect(parseInput(false, type).ok).toBe(false);
      const unsafe = parseInput(9007199254740992, type);
      expect(unsafe.ok).toBe(false);
      if (!unsafe.ok) expect(unsafe.error).toContain("bounded parser work");
      const tag = type === Nat ? "Nat" : "Int";
      expect(parseInput({ $tag: tag, digits: "12" }, type).ok).toBe(false);
      const oversized = parseInput({ $tag: tag, digits: "1".repeat(4097) }, type);
      expect(oversized.ok).toBe(false);
      if (!oversized.ok) expect(oversized.error).toContain("bounded parser work");
    }
    expect(parseInput("-1", Nat).ok).toBe(false);
  });

  test("integer input parsing preserves unreadable and cyclic membership abstention", () => {
    let reads = 0;
    const unreadable = { $tag: "Int" };
    Object.defineProperty(unreadable, "digits", { enumerable: true, get() {
      reads += 1;
      return "9007199254740993";
    } });
    const unreadableResult = parseInput(unreadable, Int);
    expect(unreadableResult.ok).toBe(false);
    if (!unreadableResult.ok) expect(unreadableResult.error).toContain("bounded parser work");
    expect(reads).toBe(0);
    const cyclic: { $tag: "Succ"; _0?: unknown } = { $tag: "Succ" };
    cyclic._0 = cyclic;
    const cyclicResult = parseInput(cyclic, Nat);
    expect(cyclicResult.ok).toBe(false);
    if (!cyclicResult.ok) expect(cyclicResult.error).toContain("bounded parser work");
  });

  test("typed Rational admission preserves fractions and refuses nonmembers or abstention", () => {
    const rational = { $tag: "Rational", num: "2", den: "4" };
    expect(parseInput(rational, measure)).toEqual({ ok: true, value: rational });
    expect(parseInput(0.5, measure).ok).toBe(false);
    expect(parseInput({ $tag: "Rational", num: "1", den: "0" }, measure).ok).toBe(false);
    expect(parseInput("1/0", measure).ok).toBe(false);
    const result = parseInput({ $tag: "Rational", num: "1".repeat(4097), den: "1" }, measure);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("bounded parser work");
  });

  test("existing Id and GeoPath reference routes keep their phantom parser", () => {
    const referent = "ParserFixtureReference";
    registerParseFn(referent, (raw) => ({ ok: true, value: { referent, raw } }));
    const id = Id(referent);
    const path = tagged(refT("GeoPath"), {
      $refined: { base: refT("String"), set: { $tag: "SeEnum", values: [referent] } },
    });
    for (const type of [id, path]) {
      expect(dispatchedResolveAtom(type)).toBe(referent);
      expect(parseInput("reference", type)).toEqual({ ok: true, value: { referent, raw: "reference" } });
    }
  });

  test("Maybe, refinements and opaque wrappers preserve tagged base selection", () => {
    const opaque: FenelType = { $opaque: { name: "Money", pure: currency } };
    const refined: FenelType = { $refined: { base: opaque, set: { $tag: "SeAll" } } };
    expect(parseInput("4.25", Maybe(refined))).toEqual({ ok: true, value: 4.25 });
  });

  test("refined format selection and outer Maybe peeling keep their existing precedence", () => {
    const email: FenelType = {
      $refined: { base: refT("String"), set: { $tag: "SeRef", handle: "format:email" } },
    };
    expect(parseInput(" USER@EXAMPLE.COM ", tagged(email, CurrencyTag("USD")))).toEqual({
      ok: true, value: "user@example.com",
    });
    const maybeEmail: FenelType = {
      $refined: { base: Maybe(refT("String")), set: { $tag: "SeRef", handle: "format:email" } },
    };
    expect(parseInput(" USER@EXAMPLE.COM ", maybeEmail)).toEqual({ ok: true, value: " USER@EXAMPLE.COM " });
  });

  test("only an identified canonical Rational opaque selects the nominal parser", () => {
    const canonical = Rational;
    expect(dispatchedResolveAtom(canonical)).toBe("Rational");
    expect(parseInput("0.125", canonical)).toEqual({
      ok: true, value: { $tag: "Rational", num: "1", den: "8" },
    });
    const unrelated: FenelType = { $opaque: { name: "Rational", pure: refT("String") } };
    expect(dispatchedResolveAtom(unrelated)).toBe("String");
    expect(parseInput("0.125", unrelated)).toEqual({ ok: true, value: "0.125" });
  });
});

describe("7g-retire-4b — fenel-check / validation-hints: consumer fold (re-emit FLIPS to {$ref})", () => {
  test("typeToSetExpr: folds {$ref} input identically to {$ref}; re-emit flips to {$ref}", () => {
    for (const n of ["Number", "Int", "Nat", "String", "Boolean", "Custom"]) {
      expect(typeToSetExpr(refT(n))).toEqual(typeToSetExpr(namedT(n)));
    }
    // 7g-retire-4b: the re-emit now FLIPS to {$ref} — -4a inverted the `contains`
    // entry-resolve (an unresolvable {$ref} is KEPT for the marshaller, not voided),
    // so the SetExpr-position producer is safe to flip (was {$ref} until -4b).
    expect(cf(typeToSetExpr(namedT("Number")))).toEqual({ $ref: "ℝ" });
    expect(cf(typeToSetExpr(refT("Nat")))).toEqual({ $ref: "ℕ" });
    expect(cf(typeToSetExpr(refT("Custom")))).toEqual({ $ref: "Custom" });
  });

  test("expandNamed: folds {$ref} input identically to {$ref}; re-emit flips to {$ref}", () => {
    const out = expandNamed(ref("x:a+b"));
    expect(out).toEqual(expandNamed(named("x:a+b")));
    expect(out).toEqual({ $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "x" }, { $tag: "SeRef", handle: "x:a" }, { $tag: "SeRef", handle: "x:b" }] });
    // No "+" → returned unchanged.
    expect(expandNamed(ref("plain"))).toEqual(ref("plain"));
  });

  test("inferDisplayField (types.ts): a {$ref:String} field is detected like {$ref:String}", () => {
    const fieldsRef = [{ name: "title", type: refT("String") }] as unknown as Parameters<typeof inferDisplayField>[0];
    const fieldsNamed = [{ name: "title", type: namedT("String") }] as unknown as Parameters<typeof inferDisplayField>[0];
    expect(inferDisplayField(fieldsRef)).toBe(inferDisplayField(fieldsNamed));
    expect(inferDisplayField(fieldsRef)).toBe("title");
  });
});
