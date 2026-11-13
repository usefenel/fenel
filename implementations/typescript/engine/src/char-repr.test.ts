// ---------------------------------------------------------------------------
// char-repr.test.ts — representation-substrate Phase 4. The round-trip discharge
// for `Reprable JsRuntime Char` — the LAST opaque `Reprable` instance, which
// closes the Phase-3 String seam.
//
// THE LAYERED OPAQUE: Char = $opaque { repr:"codepoint", pure: Nat ∈
// unicode-scalars } — its PURE is a *refined Nat* (itself opaque over a JS
// number), its NATIVE a *1-char JS string*. So this instance bridges refined-Nat ↔
// 1-char-String, NOT a Peano-ADT ↔ native like Nat/Int.
//
// STEP-0 VERDICT = NUMBER-DIRECT (notes/phase-4-step0-probe.md): the
// Peano-materializing path (`charFromCode (natToNumber c)` / `numberToNat (charCode
// s)`) is PROVABLY INFEASIBLE — `numberToNat` is non-tail recursive, so a
// codepoint-magnitude argument (🦊 = 129418, max = 1114111) blows the JS stack. A
// refined Nat surfaces at the value level as its base number repr, so the instance
// points STRAIGHT at the existing `charFromCode` (lift) / `charCode` (lower) host
// leaves — no new bridge fn. These are `@native`, so this test dispatches them via
// the call-form `{call:["std:charCode",…]}` (the `evaluate(body,…)` path does NOT
// dispatch natives), NOT the Fenel-body path the list-string-repr.test.ts bridges
// used.
//
// The instance OMITS its two `Verified Boolean` round-trip law fields (the
// isoBase64 / Bool / Nat / Int / Rational / List / String precedent); this file is
// the honest sample discharge over a codespace grid, keyed off the instance's
// DECLARED method fnIds. Ledgered test-tooling (the list-string-repr / int-tower /
// bool-opaque precedent).
//
// SURROGATE EXCLUSION (R1 axis separation): the Char refinement excludes
// 0xD800..0xDFFF, but the bridge is the ENCODE/DECODE axis — it PASSES THROUGH
// (refinement *validation* is `validateValue`'s axis). The grid pins the VALID
// boundaries (0xD7FF / 0xE000 — the edges of the two valid ranges), not surrogate
// enforcement.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import { dispatchRegistry } from "./system-entities";

const reg = createRegistry([stdModule]);
const ctx = reg.evaluateContext();
// modules-as-values Phase 2b: an instance's lift / lower is a qualified function
// reference (`{$ref: "std.natToNumber"}`); this registry resolves it to the id of
// the function the harness runs.
const declaredId = (ref: unknown): string => {
  const handle = (ref as { $ref?: unknown } | undefined)?.$ref;
  const id = typeof handle === "string" ? reg.getFunction(handle)?.id : undefined;
  if (id === undefined) throw new Error(`unresolvable lift/lower reference ${JSON.stringify(ref)}`);
  return id;
};

// charFromCode / charCode are @native — dispatch via call-form (the body path does
// not route natives).
const lift = (code: number) =>
  evaluate({ call: ["std:charFromCode", { var: "code" }] }, { code }, ctx); // Number -> 1-char String
const lower = (c: string) =>
  evaluate({ call: ["std:charCode", { var: "c" }] }, { c }, ctx); // 1-char String -> Number

// ---------------------------------------------------------------------------
// Instance projection (the int-tower / list-string precedent).
// ---------------------------------------------------------------------------

const reprable = (typeName: string) => {
  const i = [...dispatchRegistry.listInstances("Reprable")].find(
    (x) => x.args[0] === "JsRuntime" && x.args[1] === typeName,
  );
  if (!i) throw new Error(`Reprable JsRuntime ${typeName} instance not registered`);
  return i;
};

test("Reprable JsRuntime Char — monomorphic head, native type-ref + the existing leaves as lift/lower", () => {
  const ch = reprable("Char");
  expect(ch.typeName).toBe("Reprable");
  // monomorphic head (Char is a registered atom, NOT a parametric type-app like
  // (List a)) ⇒ clean args, the String/Nat/Int/Rational precedent.
  expect(ch.args).toEqual(["JsRuntime", "Char"]);
  // `native = Char` lowered to a type ref via typeValuedFields ({$ref}, the
  // Phase-1 finding — Char is ONE type with two reprs, the List self-naming).
  expect(ch.methods.native).toEqual({ $ref: "Char" });
  // number-direct (Step-0): point straight at the existing host leaves.
  expect(ch.methods.lift).toEqual({ $ref: "std.charFromCode" });
  expect(ch.methods.lower).toEqual({ $ref: "std.charCode" });
});

test("Reprable family count = 18 (9 JsRuntime + 9 Jsonb, +Real Phase 4, +Number Phase 5)", () => {
  // 7 `Reprable JsRuntime` atoms (Bool/Nat/Int/Rational/List/String/Char) + the
  // 7 storage-target `Reprable Jsonb` siblings added by Phase 5c, PLUS numeric-
  // tower Phase 4's 8th atom Real under both targets (JsRuntime + Jsonb) = 16,
  // PLUS numeric-tower Phase 5's 9th type Number (the tagged $variant over the
  // tower) under both targets = 18. The count re-pins downstream as the family
  // grows; the per-instance projections pin the shapes.
  expect([...dispatchRegistry.listInstances("Reprable")].length).toBe(18);
});

test("Char is registered as a catalog entity (home-only — refined Nat, no own constructors)", () => {
  const e = (reg as unknown as { getEntity: (n: string) => unknown }).getEntity("Char");
  expect(e).toBeDefined();
});

// ---------------------------------------------------------------------------
// Char round-trip — via the instance's DECLARED lift/lower (charFromCode /
// charCode) over a codespace grid: ASCII, BMP accents, an astral-plane emoji
// (surrogate pair in UTF-16 — the codePointAt/fromCodePoint correctness pin), and
// the codespace boundaries.
// ---------------------------------------------------------------------------

const CHAR_SAMPLES: { c: string; code: number }[] = [
  { c: "a", code: 0x61 },
  { c: "0", code: 0x30 },
  { c: " ", code: 0x20 },
  { c: "é", code: 0xe9 },
  { c: "ü", code: 0xfc },
  { c: "🦊", code: 0x1f98a }, // U+1F98A — astral plane, surrogate pair, ONE Char
];

// the codespace boundaries (the edges of the two valid scalar ranges).
const BOUNDARY_CODES = [0x0, 0xd7ff, 0xe000, 0x10ffff];

test(
  "Reprable JsRuntime Char — round-trip on the native (1-char String) + pure (codepoint Number) sides",
  () => {
    const ch = reprable("Char");
    const liftId = declaredId(ch.methods.lift); // Number -> 1-char String
    const lowerId = declaredId(ch.methods.lower); // 1-char String -> Number
    expect(liftId).toBe("std:charFromCode");
    expect(lowerId).toBe("std:charCode");
    for (const { c, code } of CHAR_SAMPLES) {
      // reprLowerLiftRoundtrip: lift (lower c) ≡ c   (native 1-char-String side)
      expect(lift(lower(c) as number)).toBe(c);
      // reprLiftLowerRoundtrip: lower (lift code) ≡ code   (pure codepoint-Number side)
      expect(lower(lift(code) as string)).toBe(code);
      // the leaf yields the expected code point (the emoji is ONE code point).
      expect(lower(c)).toBe(code);
    }
  },
  10000, // SLOW guard (the rational/list precedent — grid is modest).
);

test("Reprable JsRuntime Char — codespace boundaries round-trip (valid-scalar edges)", () => {
  for (const code of BOUNDARY_CODES) {
    // lower (lift code) ≡ code over the valid boundaries (0x0 / 0xD7FF / 0xE000 /
    // 0x10FFFF). The surrogate range 0xD800..0xDFFF is EXCLUDED by the refinement,
    // but the bridge is encode/decode only (R1) — refinement validation is a
    // separate axis, so the bridge passes surrogates through (not pinned here).
    expect(lower(lift(code) as string)).toBe(code);
  }
});

test("Reprable JsRuntime Char — the emoji is ONE Char (code POINT, not UTF-16 code unit)", () => {
  // 🦊 = U+1F98A: a single Unicode scalar, a surrogate PAIR in UTF-16. charCode
  // (codePointAt) reads it as the ONE code point 129418, not the lead surrogate.
  expect(lower("🦊")).toBe(0x1f98a);
  expect(lift(0x1f98a)).toBe("🦊");
});
