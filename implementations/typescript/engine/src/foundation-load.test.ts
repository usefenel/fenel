// ---------------------------------------------------------------------------
// foundation-load.test.ts — conformance test for `fenel/std/foundation.fenel`
//
// Phase 1 of `workstreams/ts-elimination` migrated Maybe / Result / Either
// to a single canonical Fenel source (`fenel/std/foundation.fenel`); Phase
// 1.5 then broke the parser → builtin-classes cycle that had blocked
// runtime loading, and as part of that same phase `type-foundation.ts`
// rewired its `Maybe(...)` / `Result(...)` / `Either(...)` helpers to
// resolve the parametric templates from the .fenel source lazily on first
// call. The TS helpers no longer hold inline literals.
//
// This test asserts that:
//
//   1. The .fenel source PARSES to a known shape (smoke tests below) — the
//      hard-coded variant-AST expectations remain the primary correctness
//      check; if either side drifts, the smoke tests catch it.
//   2. The conformance pair — TS `Maybe(...)` output vs. parser-loaded
//      template substituted independently in the test — still agree. Both
//      paths now derive from the same `.fenel` source, so a divergence
//      would signal a bug in `substituteTypeVars` or
//      `stripEmptyVariantFields` rather than spec/impl drift, which is
//      still meaningful.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import foundationSrc from "../../../../fenel/std/foundation.fenel?raw";
import langNumbersSrc from "../../../../fenel/std/lang-numbers.fenel?raw";
import pathsSrc from "../../../../fenel/std/paths.fenel?raw";
import { loadFenelModule } from "./fenel-module";
import { Maybe as _Maybe, Result as _Result, Either as _Either, Bool as _Bool, Nat as _Nat, Int as _Int, List as _List, Char as _Char, PositiveNat as _PositiveNat, NonNegInt as _NonNegInt, Integer as _Integer, RationalNumber as _RationalNumber, RealNumber as _RealNumber, Rational as _Rational, Str as _Str, NonEmptyStr as _NonEmptyStr, PathSegment as _PathSegment, PathRoot as _PathRoot, Path as _Path, EmojiString as _EmojiString, DriveLetter as _DriveLetter, PathStr as _PathStr, foundationTemplates, foundationEntityRegs, stripEmptyVariantFields, substituteTypeVars, Just, Nothing } from "./type-foundation";
import { langNumberTypes } from "./lang-numbers";
import { parseSetExpr } from "./set-syntax";
import { setExprToDollarKey } from "./set-marker";
import { isSetExpr } from "./types";
import type { FenelType } from "./types";

// These characterization assertions deliberately lower canonical SetExpr
// children to the legacy wire spelling. Keep that raw comparison outside the
// canonical FenelType surface instead of casting legacy values back to it.
const expectLegacyBoundary = (received: unknown) => expect(received);

const FOUNDATION = loadFenelModule(foundationSrc, "std");
const LANG_NUMBERS = loadFenelModule(langNumbersSrc, "std");
const PATHS = loadFenelModule(pathsSrc, "std");

// 7g-parser: the parser emits a user-written type-name ref as `{$ref:H}` (was
// `{$ref:H}`). These conformance tests compare the parsed foundation templates
// to the hand-written TS canonical literals (which stay `{$ref}` until
// 7g-retire). Fold `{$ref:H}`→`{$ref:H}` so the comparison is "conformant
// modulo the reference's value form" ({$ref}≡{$ref}); the producer form is
// pinned in typed-ref-parser-producer.test.ts.
// 3b-2 Step 4 — the parser + the TS refined-atom helpers now emit SetExprs in
// the canonical `$tag` Se* form. Fold any `$tag` SetExpr back to the legacy
// `$`-key shape (setExprToDollarKey, deep) so both the conformance (parsed vs
// TS) AND the smoke (TS vs hand-written `$`-key literal) comparisons stay on the
// pre-flip `$`-key form. Same sanctioned mechanical re-pin as the `$ref`-fold.
function foldRefs(t: FenelType): FenelType {
  if (Array.isArray(t)) return t.map(foldRefs) as unknown as FenelType;
  if (t && typeof t === "object") {
    const o = (isSetExpr(t)
      ? setExprToDollarKey(t)
      : t) as Record<string, unknown>;
    if ("$ref" in o && typeof o.$ref === "string" && Object.keys(o).length === 1) {
      return { $ref: o.$ref } as FenelType;
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = foldRefs(o[k] as FenelType);
    return out as FenelType;
  }
  return t;
}

function templateFor(id: string): FenelType {
  const entity = (FOUNDATION.entities ?? []).find((e) => e.id === id);
  if (!entity) throw new Error(`foundation.fenel missing entity "${id}"`);
  return foldRefs(stripEmptyVariantFields(entity.type));
}

// 7g-retire-2b: the TS canonical helpers now emit `{$ref}` name-refs (producers
// flipped). These conformance literals are pinned in the pre-retire `{$ref}` form,
// so fold each helper's output `{$ref}`→`{$ref}` ({$ref}≡{$ref}, same name-handle)
// — exactly what `templateFor` already does for the parsed side.
const Maybe = (a: FenelType) => foldRefs(_Maybe(a));
const Result = (e: FenelType, a: FenelType) => foldRefs(_Result(e, a));
const Either = (a: FenelType, b: FenelType) => foldRefs(_Either(a, b));
const List = (a: FenelType) => foldRefs(_List(a));
const Bool = foldRefs(_Bool);
const Nat = foldRefs(_Nat);
const Int = foldRefs(_Int);
const Char = foldRefs(_Char);
const Rational = foldRefs(_Rational);
const PositiveNat = foldRefs(_PositiveNat);
const NonNegInt = foldRefs(_NonNegInt);
const Integer = foldRefs(_Integer);
const RationalNumber = foldRefs(_RationalNumber);
const RealNumber = foldRefs(_RealNumber);
const Str = foldRefs(_Str);
const NonEmptyStr = foldRefs(_NonEmptyStr);
const PathSegment = foldRefs(_PathSegment);
const PathRoot = foldRefs(_PathRoot);
const Path = foldRefs(_Path);
const EmojiString = foldRefs(_EmojiString);
const DriveLetter = foldRefs(_DriveLetter);
const PathStr = foldRefs(_PathStr);

// ---------------------------------------------------------------------------
// Smoke — TS helpers produce the expected pre-migration AST shape
// ---------------------------------------------------------------------------

test("Maybe(String) matches the canonical FenelType AST", () => {
  const StringType = { $ref: "String" } as const;
  expect(Maybe(StringType)).toEqual({
    $variant: {
      cases: [
        { name: "Nothing", label: Nothing },
        { name: "Just", label: Nothing, fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: StringType, meta: {}, ui: Nothing }] },
      ],
    },
  });
});

test("Result(String, Number) matches the canonical FenelType AST", () => {
  expect(Result({ $ref: "String" }, { $ref: "Number" })).toEqual({
    $variant: {
      cases: [
        { name: "Err", label: Nothing, fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }] },
        { name: "Ok", label: Nothing, fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }] },
      ],
    },
  });
});

test("Either(Number, String) matches the canonical FenelType AST", () => {
  expect(Either({ $ref: "Number" }, { $ref: "String" })).toEqual({
    $variant: {
      cases: [
        { name: "Left", label: Nothing, fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }] },
        { name: "Right", label: Nothing, fields: [{ name: "_0", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }] },
      ],
    },
  });
});

test("field normalizers preserve explicit positional keys", () => {
  const keyed = {
    $variant: {
      cases: [{
        name: "Only",
        fields: [{
          name: "_0",
          key: { $tag: "PositionalField" as const, index: 0 },
          type: { $ref: "String" } as FenelType,
        }],
      }],
    },
  } as FenelType;
  const stripped = stripEmptyVariantFields(keyed);
  expect((stripped as any).$variant.cases[0].fields[0].key).toEqual({
    $tag: "PositionalField",
    index: 0,
  });
});

// ---------------------------------------------------------------------------
// Conformance — the parsed .fenel source agrees with the TS shims
// ---------------------------------------------------------------------------

test("foundation.fenel parses to the Phase 2.11 entity roster", () => {
  const ids = (FOUNDATION.entities ?? []).map((e) => e.id).sort();
  expect(ids).toEqual([
    "Bool",
    "Byte",
    "Bytes",
    // numeric-tower Phase 4 — Cauchy (the Real convergence-proof stub type) + Real
    // (the LAST tower rung, the Cauchy-with-modulus Σ-type) join the roster. The
    // structural shape assertions below are untouched (the existing atoms' $opaque/
    // record shapes do not change); only the roster grows (the Nat/Int/Rational
    // precedent — adding a tower rung is a roster addition, not a shape re-pin).
    "Cauchy",
    "Char",
    "Either",
    "Int",
    // containment-substrate Phase 3 — the Int/Rational/Real refinement-presentation
    // aliases join the roster (the NonNegInt/PositiveNat bare-refinement-alias
    // precedent — a roster addition, not a shape re-pin). They close the numeric
    // tower's int/rat/real ToRefined codomain-`Number` stubs (see the
    // *-bridge.fenel comment ladders).
    "Integer",
    "List",
    "Maybe",
    "Nat",
    "NonNegInt",
    // numeric-tower Phase 5 — Number joins the roster as the TAGGED $variant over
    // the tower (NatN Nat | IntN Int | RatN Rational | RealN Real). At HEAD it was
    // a bare leaf with NO registered FenelType; the Phase-5 capstone flip registers
    // it (the Nat/Int/Rational/Real roster-addition precedent — a new entity, not a
    // shape re-pin of the existing atoms).
    "Number",
    "PositiveNat",
    "Rational",
    "RationalNumber",
    "Real",
    "RealNumber",
    "Result",
    "String",
  ]);
});

test("Maybe template substitution matches TS Maybe(String)", () => {
  const template = templateFor("Maybe");
  const substituted = substituteTypeVars(template, { a: { $ref: "String" } });
  expect(substituted).toEqual(Maybe({ $ref: "String" }));
});

test("Result template substitution matches TS Result(String, Number)", () => {
  const template = templateFor("Result");
  const substituted = substituteTypeVars(template, {
    e: { $ref: "String" },
    a: { $ref: "Number" },
  });
  expect(substituted).toEqual(Result({ $ref: "String" }, { $ref: "Number" }));
});

test("Either template substitution matches TS Either(Number, String)", () => {
  const template = templateFor("Either");
  const substituted = substituteTypeVars(template, {
    a: { $ref: "Number" },
    b: { $ref: "String" },
  });
  expect(substituted).toEqual(Either({ $ref: "Number" }, { $ref: "String" }));
});

// ---------------------------------------------------------------------------
// Opaque atoms — Bool / Nat / Int / List
//
// Phase 2 of ts-elimination adds the `opaque "<repr>" Name = ...` syntax to
// the parser and migrates the non-parametric atoms (Bool, Nat, Int) to a
// canonical .fenel spec. The TS literals stay as the production source (non-
// parametric atoms can't lazy-load on first call), and these tests assert
// the two paths agree.
//
// Phase 2.5 closes the loop on List: a parser self-reference fix lets
// `opaque "array" List a = Nil | Cons head: a tail: List a` parse cleanly
// with `{$ref: "List"}` for the recursive tail. The TS `List(a)` helper
// is now lazy — it resolves the template from foundation.fenel + parametric
// substitution, matching the Maybe / Result / Either pattern.
// ---------------------------------------------------------------------------

test("Bool matches canonical opaque-wrapped variant", () => {
  expect(Bool).toEqual({
    $opaque: {
      name: "Boolean",
      pure: {
        $variant: {
          cases: [
            { name: "True", label: Nothing },
            { name: "False", label: Nothing },
          ],
        },
      },
    },
  });
});

test("Nat matches canonical opaque-wrapped variant with $ref self-ref", () => {
  expect(Nat).toEqual({
    $opaque: {
      name: "Nat",
      pure: {
        $variant: {
          cases: [
            { name: "Zero", label: Nothing },
            { name: "Succ", label: Nothing, fields: [{ name: "pred", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing }] },
          ],
        },
      },
    },
  });
});

test("Int matches canonical opaque-wrapped record", () => {
  expect(Int).toEqual({
    $opaque: {
      name: "Int",
      pure: {
        $record: {
          fields: [
            { name: "magnitude", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing },
            { name: "negative", label: Nothing, type: { $ref: "Bool" }, meta: {}, ui: Nothing },
          ],
        },
      },
    },
  });
});

// Conformance — TS literal == parsed-from-foundation.fenel (after empty-
// fields stripping). The parsed Bool name is "Bool" while the TS literal
// names it "Boolean" — historical naming; the test normalises by name so
// the conformance focuses on the structural shape (repr + pure body) that
// callers actually see.

function pureOpaque(t: FenelType): FenelType {
  if (!t || typeof t !== "object" || !("$opaque" in t)) return t;
  // representation-substrate Phase 5a — `repr` retired; normalise name to "_"
  // and compare the pure body (the structural shape callers actually see).
  const o = (t as { $opaque: { pure: FenelType } }).$opaque;
  return { $opaque: { name: "_", pure: o.pure } } as FenelType;
}

test("Bool parsed template matches TS Bool (structural)", () => {
  const template = templateFor("Bool");
  expect(pureOpaque(template)).toEqual(pureOpaque(Bool));
});

test("Nat parsed template matches TS Nat", () => {
  const template = templateFor("Nat");
  expect(template).toEqual(Nat);
});

test("Int parsed template matches TS Int", () => {
  const template = templateFor("Int");
  expect(template).toEqual(Int);
});

test("List(Number) matches canonical opaque-wrapped variant with $ref self-ref", () => {
  expect(List({ $ref: "Number" })).toEqual({
    $opaque: {
      name: "List",
      pure: {
        $variant: {
          cases: [
            { name: "Nil", label: Nothing },
            {
              name: "Cons",
              label: Nothing,
              fields: [
                { name: "head", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
                { name: "tail", label: Nothing, type: { $ref: "List" }, meta: {}, ui: Nothing },
              ],
            },
          ],
        },
      },
    },
  });
});

test("List parsed template (unsubstituted) carries `a` as the head type-var", () => {
  const template = templateFor("List");
  expect(template).toEqual({
    $opaque: {
      name: "List",
      pure: {
        $variant: {
          cases: [
            { name: "Nil", label: Nothing },
            {
              name: "Cons",
              label: Nothing,
              fields: [
                { name: "head", label: Nothing, type: { $var: "a" }, meta: {}, ui: Nothing },
                { name: "tail", label: Nothing, type: { $ref: "List" }, meta: {}, ui: Nothing },
              ],
            },
          ],
        },
      },
    },
  });
});

test("raw List template substitution exactly matches the keyless TS factory", () => {
  const template = templateFor("List");
  const substituted = substituteTypeVars(template, { a: { $ref: "Number" } });
  expect(substituted).toEqual(List({ $ref: "Number" }));
});

test("foundation registration retains Maybe's kinded scheme with its normalized body", () => {
  foundationTemplates();
  const registration = foundationEntityRegs.find((entry) => entry.codeName === "Maybe");
  expect(registration).toBeDefined();
  expect(registration!.typeScheme?.body).toEqual(registration!.type);
  expect(registration!.typeScheme?.quantified).toEqual([
    { id: "q0", sourceName: "a", kind: { $tag: "KType" } },
  ]);
});

// ---------------------------------------------------------------------------
// Char — opaque-wrapped refinement of Nat (Phase 2.6)
//
// First atom whose pure form is a refinement carrying a structured SetExpr
// (union of two codepoint intervals minus the UTF-16 surrogate range). The
// `value ∈ <set>` refinement-decl syntax — added in Phase 2.6 — lowers
// directly to `{$refined: {base, set}}` with the SetExpr stored verbatim,
// so set-algebra (subset/disjoint/contains) reasons structurally rather
// than evaluating a `$where` predicate value-by-value.
// ---------------------------------------------------------------------------

test("Char matches canonical opaque-wrapped refinement of Nat", () => {
  expectLegacyBoundary(Char).toEqual({
    $opaque: {
      name: "Char",
      pure: {
        $refined: {
          base: { $ref: "Nat" },
          set: {
            $union: [
              { $interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 55295, inclusive: true }) } },
              { $interval: { lo: Just({ value: 57344, inclusive: true }), hi: Just({ value: 1114111, inclusive: true }) } },
            ],
          },
        },
      },
    },
  });
});

test("Char parsed template matches TS Char (structural)", () => {
  const template = templateFor("Char");
  expect(template).toEqual(Char);
});

test("parseSetExpr accepts an interval literal", () => {
  expect(setExprToDollarKey(parseSetExpr("[0..255]"))).toEqual({
    $interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 255, inclusive: true }) },
  });
});

// ---------------------------------------------------------------------------
// Phase 2.7 — Rational + refined-numeric atoms
//
// PositiveNat and NonNegInt are direct applications of the Phase 2.6
// SetExpr-bearing refinement syntax: `Nat | value ∈ [1..)` and `Int |
// value ∈ [0..)`. The TS literals carry `{$ref: "Nat"}` / `{$ref:
// "Int"}` as the refinement base — same named-ref move the Phase 2 /
// 2.5 / 2.6 self-refs made for Nat / List / Char.
//
// Rational is the compound test case — an opaque-wrapped record whose
// `den` field references the named `PositiveNat` alias (sidestepping
// the parser's unsupported parenthesised-refinement-in-field-position).
//
// `parseSetExpr` also gains hex / oct / bin literal support so Char's
// codepoint bounds and any future codepoint-natural constraint reads
// naturally as `[0..0xD7FF]` instead of decimal `[0..55295]`.
// ---------------------------------------------------------------------------

test("PositiveNat matches canonical refinement of $ref Nat", () => {
  expectLegacyBoundary(PositiveNat).toEqual({
    $refined: {
      base: { $ref: "Nat" },
      set: { $interval: { lo: Just({ value: 1, inclusive: true }), hi: Nothing } },
    },
  });
});

test("NonNegInt matches canonical refinement of $ref Int", () => {
  expectLegacyBoundary(NonNegInt).toEqual({
    $refined: {
      base: { $ref: "Int" },
      set: { $interval: { lo: Just({ value: 0, inclusive: true }), hi: Nothing } },
    },
  });
});

// containment-substrate Phase 3 — the Int/Rational/Real refinement-presentation
// aliases. Integer refines Int; RationalNumber refines Rational; RealNumber
// refines Number. The glyph is the registered numeric named-set ref (folded
// `$tag SeRef` → `$ref` by foldRefs). The TS twin
// + the parsed template must agree byte-for-byte (the NonNegInt twin precedent).
test("Integer matches canonical refinement of exact $ref Int ∈ ℤ", () => {
  expectLegacyBoundary(Integer).toEqual({
    $refined: { base: { $ref: "Int" }, set: { $ref: "ℤ" } },
  });
});

test("RationalNumber matches canonical refinement of exact $ref Rational ∈ ℚ", () => {
  expectLegacyBoundary(RationalNumber).toEqual({
    $refined: { base: { $ref: "Rational" }, set: { $ref: "ℚ" } },
  });
});

test("RealNumber matches canonical refinement of $ref Number ∈ ℝ", () => {
  expectLegacyBoundary(RealNumber).toEqual({
    $refined: { base: { $ref: "Number" }, set: { $ref: "ℝ" } },
  });
});

test("Integer parsed template matches TS Integer", () => {
  expect(templateFor("Integer")).toEqual(Integer);
});

test("RationalNumber parsed template matches TS RationalNumber", () => {
  expect(templateFor("RationalNumber")).toEqual(RationalNumber);
});

test("RealNumber parsed template matches TS RealNumber", () => {
  expect(templateFor("RealNumber")).toEqual(RealNumber);
});

test("Rational matches canonical opaque-wrapped record with $ref den", () => {
  expect(Rational).toEqual({
    $opaque: {
      name: "Rational",
      pure: {
        $record: {
          fields: [
            { name: "num", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing },
            { name: "den", label: Nothing, type: { $ref: "PositiveNat" }, meta: {}, ui: Nothing },
          ],
        },
      },
    },
  });
});

test("PositiveNat parsed template matches TS PositiveNat", () => {
  const template = templateFor("PositiveNat");
  expect(template).toEqual(PositiveNat);
});

test("NonNegInt parsed template matches TS NonNegInt", () => {
  const template = templateFor("NonNegInt");
  expect(template).toEqual(NonNegInt);
});

test("Rational parsed template matches TS Rational", () => {
  const template = templateFor("Rational");
  expect(template).toEqual(Rational);
});

// ---------------------------------------------------------------------------
// Phase 2.11 — Str opaque migration + opaque-decl type-expr RHS
//
// `String` is the first atom whose pure side is a parametric type-
// application (`List Char`), not a constructor list. Phase 2.11 added the
// opaque-decl type-expr RHS arm — `opaque "<repr>" Name [params] = <type-
// expr>` parses when the body has no `|` and no `<ident>:` field marker
// at depth 0 — and migrates Str to foundation.fenel. The TS literal flips
// to a Proxy that lazy-resolves through `foundationTemplates().Str`,
// matching the parsed template byte-for-byte. Foundation roster grows
// 11 → 12.
// ---------------------------------------------------------------------------

test("Str matches canonical opaque-wrapped List(Char) with $ref refs", () => {
  // `Str` is template-DERIVED (built over the parsed foundation List/Char), so
  // its element/self-refs are now `{$ref}` (7g-parser) — fold to the `{$ref}`
  // canonical literal ({$ref}≡{$ref}; pinned in typed-ref-parser-producer).
  expectLegacyBoundary(foldRefs(stripEmptyVariantFields(Str))).toEqual({
    $opaque: {
      name: "String",
      pure: {
        $opaque: {
          name: "List",
          pure: {
            $variant: {
              cases: [
                { name: "Nil", label: Nothing },
                {
                  name: "Cons",
                  label: Nothing,
                  fields: [
                    { name: "head", label: Nothing, type: { $ref: "Char" }, meta: {}, ui: Nothing },
                    { name: "tail", label: Nothing, type: { $ref: "List" }, meta: {}, ui: Nothing },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  });
});

test("Str parsed template matches TS Str (Proxy lazy-resolve conformance)", () => {
  const template = templateFor("String");
  expect(template).toEqual(foldRefs(stripEmptyVariantFields(Str)));
});

test("parseSetExpr accepts hex literals (0x prefix)", () => {
  expect(setExprToDollarKey(parseSetExpr("[0..0xFF]"))).toEqual({
    $interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 255, inclusive: true }) },
  });
});

test("parseSetExpr accepts the codepoint-natural Char bounds in hex", () => {
  expect(setExprToDollarKey(parseSetExpr("[0..0xD7FF] u [0xE000..0x10FFFF]"))).toEqual({
    $union: [
      { $interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 55295, inclusive: true }) } },
      { $interval: { lo: Just({ value: 57344, inclusive: true }), hi: Just({ value: 1114111, inclusive: true }) } },
    ],
  });
});

test("parseSetExpr accepts octal (0o) and binary (0b) literals", () => {
  expect(setExprToDollarKey(parseSetExpr("[0o10..0o17]"))).toEqual({
    $interval: { lo: Just({ value: 8, inclusive: true }), hi: Just({ value: 15, inclusive: true }) },
  });
  expect(setExprToDollarKey(parseSetExpr("[0b10..0b1111]"))).toEqual({
    $interval: { lo: Just({ value: 2, inclusive: true }), hi: Just({ value: 15, inclusive: true }) },
  });
});

// ---------------------------------------------------------------------------
// substituteTypeVars — nominal references never acquire binder semantics
// ---------------------------------------------------------------------------

test("substituteTypeVars leaves a nominal $ref alone even when its spelling is bound", () => {
  const t: FenelType = {
    $variant: {
      cases: [
        { name: "Wrap", label: Nothing, fields: [{ name: "value", label: Nothing, type: { $ref: "a" }, meta: {}, ui: Nothing }] },
      ],
    },
  };
  expect(substituteTypeVars(t, { a: { $ref: "Int" } })).toEqual(t);
});

test("substituteTypeVars requires an own binding key", () => {
  const t = { $var: "toString" } as FenelType;
  expect(substituteTypeVars(t, {})).toEqual(t);
});

// ---------------------------------------------------------------------------
// Phase 2.8 — lang-numbers family
//
// 38 per-language refined-numeric atoms migrated to
// `fenel/std/lang-numbers.fenel`. Each entry is `Int | value ∈ [min..max]`
// or `Rational | value ∈ [-fmax..fmax]`; the two unrefined aliases
// (`JsBigInt`, `PyInt`) use a vacuous `value ∈ ℤ` refinement because the
// parser doesn't admit a bare `X = Y` alias decl.
//
// `parseSetExpr` already handled scientific notation; the Fenel lexer
// (`fenel-parser.ts:tokenize`) gained the matching exponent-suffix
// consumer in Phase 2.8 so float-type bounds (`1.7976931348623157e308`)
// lex as a single `num` token.
//
// The parametric conformance loop iterates every TS literal in
// `langNumberTypes` and asserts it equals the parsed-from-fenel template
// byte-for-byte. Smoke tests below give 3 sample atoms explicit AST
// expectations so a regression surfaces in a named test rather than a
// loop iteration.
// ---------------------------------------------------------------------------

test("lang-numbers.fenel parses to the Phase 2.8 entity roster", () => {
  const ids = (LANG_NUMBERS.entities ?? []).map((e) => e.id).sort();
  expect(ids).toEqual([
    "GoFloat32", "GoFloat64",
    "GoInt16", "GoInt32", "GoInt64", "GoInt8",
    "GoUint16", "GoUint32", "GoUint64", "GoUint8",
    "JavaByte", "JavaDouble", "JavaFloat", "JavaInt", "JavaLong", "JavaShort",
    "JsBigInt", "JsNumber", "JsSafeInt",
    "PyFloat", "PyInt",
    "RustF32", "RustF64",
    "RustI128", "RustI16", "RustI32", "RustI64", "RustI8",
    "RustU128", "RustU16", "RustU32", "RustU64", "RustU8",
    "SqlBigInt", "SqlDouble", "SqlInteger", "SqlReal", "SqlSmallInt",
  ]);
});

test("JsSafeInt matches canonical refinement over $ref Int", () => {
  expectLegacyBoundary(foldRefs(langNumberTypes.JsSafeInt as FenelType)).toEqual({
    $refined: {
      base: { $ref: "Int" },
      set: {
        $interval: {
          lo: Just({ value: -9007199254740991, inclusive: true }),
          hi: Just({ value: 9007199254740991, inclusive: true }),
        },
      },
    },
  });
});

test("RustI32 matches canonical signed-32 refinement", () => {
  expectLegacyBoundary(foldRefs(langNumberTypes.RustI32 as FenelType)).toEqual({
    $refined: {
      base: { $ref: "Int" },
      set: {
        $interval: {
          lo: Just({ value: -2147483648, inclusive: true }),
          hi: Just({ value: 2147483647, inclusive: true }),
        },
      },
    },
  });
});

test("RustF64 matches canonical float refinement over $ref Rational", () => {
  expectLegacyBoundary(foldRefs(langNumberTypes.RustF64 as FenelType)).toEqual({
    $refined: {
      base: { $ref: "Rational" },
      set: {
        $interval: {
          lo: Just({ value: -1.7976931348623157e308, inclusive: true }),
          hi: Just({ value: 1.7976931348623157e308, inclusive: true }),
        },
      },
    },
  });
});

test("JsBigInt / PyInt match vacuous-refinement alias shape", () => {
  const aliasShape = {
    $refined: { base: { $ref: "Int" }, set: { $ref: "ℤ" } },
  };
  expectLegacyBoundary(foldRefs(langNumberTypes.JsBigInt as FenelType)).toEqual(aliasShape);
  expectLegacyBoundary(foldRefs(langNumberTypes.PyInt as FenelType)).toEqual(aliasShape);
});

test("every lang-number TS literal matches its parsed-template byte-for-byte", () => {
  const tpl = foundationTemplates().langNumbers;
  const ids = Object.keys(langNumberTypes);
  for (const id of ids) {
    const tsLit = foldRefs(stripEmptyVariantFields(langNumberTypes[id] as FenelType));
    const parsed = foldRefs(tpl[id] as FenelType); // 7g-parser: {$ref}≡{$ref}
    expect({ id, type: parsed }).toEqual({ id, type: tsLit });
  }
});

// ---------------------------------------------------------------------------
// Phase 2.9 — Path family + NonEmptyStr
//
// 4 variant + refinement atoms migrated to `fenel/std/paths.fenel`.
// NonEmptyStr is the first migration touching the predicate-refinement
// codepath (Phase 1 syntax `T | <predicate>`); the TS literal flips from
// the legacy operator-form (`{">": [...]}`) to the canonical call-form
// (`{call: ["gt", ...]}`) so the conformance assertions match byte-for-
// byte. Same shape migration `0040_operator_form_to_call.sql` applied
// at the storage layer; the in-memory TS literal finally catches up.
//
// PathSegment / PathRoot / Path reference each other and NonEmptyStr via
// `{$ref: ...}` refs; PathRoot.DriveRoot references DriveLetter, which
// stays in TS as an inline literal (regex-refinement, awaiting the
// Phase 2.10 `/regex/` lexer extension). The registry resolves named
// refs at lookup time — `{$ref: "DriveLetter"}` works the same as
// `{$ref: "Bool"}` did before Bool's migration completed in Phase 2.
// ---------------------------------------------------------------------------

test("paths.fenel parses to the Phase 2.10 entity roster", () => {
  const ids = (PATHS.entities ?? []).map((e) => e.id).sort();
  expect(ids).toEqual([
    "DriveLetter",
    "EmojiString",
    "NonEmptyStr",
    "Path",
    "PathRoot",
    "PathSegment",
    "PathStr",
  ]);
});

test("NonEmptyStr matches canonical predicate refinement of $ref String", () => {
  expectLegacyBoundary(NonEmptyStr).toEqual({
    $refined: {
      base: { $ref: "String" },
      set: { $where: { call: ["gt", { var: "value.length" }, 0] } },
    },
  });
});

test("PathSegment matches canonical variant with $ref NonEmptyStr field", () => {
  expect(stripEmptyVariantFields(PathSegment)).toEqual({
    $variant: {
      cases: [
        { name: "NameSeg", label: Nothing, fields: [{ name: "value", label: Nothing, type: { $ref: "NonEmptyStr" }, meta: {}, ui: Nothing }] },
        { name: "ParentSeg", label: Nothing },
        { name: "CurrentSeg", label: Nothing },
      ],
    },
  });
});

test("Path matches canonical compound variant with List PathSegment", () => {
  expect(stripEmptyVariantFields(Path)).toEqual({
    $variant: {
      cases: [
        {
          name: "AbsolutePath",
          label: Nothing,
          fields: [
            { name: "root", label: Nothing, type: { $ref: "PathRoot" }, meta: {}, ui: Nothing },
            { name: "segments", label: Nothing, type: List({ $ref: "PathSegment" }), meta: {}, ui: Nothing },
          ],
        },
        {
          name: "RelativePath",
          label: Nothing,
          fields: [
            { name: "segments", label: Nothing, type: List({ $ref: "PathSegment" }), meta: {}, ui: Nothing },
          ],
        },
      ],
    },
  });
});

// ---------------------------------------------------------------------------
// Phase 2.10 — refined-string atoms (EmojiString, DriveLetter, PathStr)
//
// Unblocked by the `parseSetForm` source-slice rewrite in `fenel-parser.ts`.
// The legacy `parts.join(" ")` reassembly clobbered SetExpr-body whitespace,
// so `value ∈ str:emoji` (where `str`, `:`, `emoji` lex as 3 tokens) and
// `value ∈ /^[A-Za-z]$/` (regex chars lex as ops) both round-tripped through
// `parseSetExpr` with stray spaces in the wrong slots. Threading the source
// string into `Parser` and slicing verbatim between the `∈`-after position
// and the SetExpr terminator dissolves both issues at once.
//
// Each TS literal flips to inline `{$refined: {base: {$ref: "String"}, set:
// …}}` matching the parsed-template byte-for-byte. `regexSet("^[A-Za-z]$")`
// stays on DriveLetter — both call paths reach `regexStringToPattern`, so
// the regex-derivative AST is identical.
// ---------------------------------------------------------------------------

test("EmojiString matches canonical refinement of $ref String with str:emoji", () => {
  expectLegacyBoundary(EmojiString).toEqual({
    $refined: {
      base: { $ref: "String" },
      set: { $ref: "str:emoji" },
    },
  });
});

test("PathStr matches canonical refinement of $ref String with format:path", () => {
  expectLegacyBoundary(PathStr).toEqual({
    $refined: {
      base: { $ref: "String" },
      set: { $ref: "format:path" },
    },
  });
});

test("DriveLetter matches canonical refinement of $ref String with /^[A-Za-z]$/ pattern", () => {
  expectLegacyBoundary(DriveLetter).toEqual({
    $refined: {
      base: { $ref: "String" },
      set: {
        $pattern: {
          t: "match",
          pred: {
            $union: [
              { $interval: { lo: Just({ value: "A", inclusive: true }), hi: Just({ value: "Z", inclusive: true }) } },
              { $interval: { lo: Just({ value: "a", inclusive: true }), hi: Just({ value: "z", inclusive: true }) } },
            ],
          },
        },
      },
    },
  });
});

test("every paths.fenel TS literal matches its parsed-template byte-for-byte", () => {
  const tpl = foundationTemplates().paths;
  const tsLiterals: Record<string, FenelType> = {
    NonEmptyStr,
    PathSegment,
    PathRoot,
    Path,
    EmojiString,
    DriveLetter,
    PathStr,
  };
  for (const id of Object.keys(tsLiterals)) {
    // 7g-parser: fold {$ref}≡{$ref} on BOTH sides (a TS literal may itself be
    // template-derived). The producer form is pinned in the focused producer test.
    const tsLit = foldRefs(stripEmptyVariantFields(tsLiterals[id] as FenelType));
    const parsed = foldRefs(tpl[id] as FenelType);
    expect({ id, type: parsed }).toEqual({ id, type: tsLit });
  }
});

test("substituteTypeVars rewrites nested authoritative $var nodes", () => {
  const t: FenelType = {
    $record: {
      fields: [
        { name: "outer", label: Nothing, type: { $var: "a" }, meta: {}, ui: Nothing },
        {
          name: "inner",
          label: Nothing,
          type: {
            $record: { fields: [{ name: "deep", label: Nothing, type: { $var: "a" }, meta: {}, ui: Nothing }] },
          },
          meta: {},
          ui: Nothing,
        },
      ],
    },
  };
  const out = substituteTypeVars(t, { a: { $ref: "String" } });
  expect(out).toEqual({
    $record: {
      fields: [
        { name: "outer", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
        {
          name: "inner",
          label: Nothing,
          type: {
            $record: { fields: [{ name: "deep", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }] },
          },
          meta: {},
          ui: Nothing,
        },
      ],
    },
  });
});
