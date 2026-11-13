// ---------------------------------------------------------------------------
// typed-ref-prim-consumers.test.ts — typed-function-references Phase 7f-remainder.
//
// 7f-remainder folds the FP-PRIM consumers — the readers that take an ATOM
// code-name (`String` / `Number` / `Int` / `Nat` / `Bool` / `Date` / the number
// tower `ℕ`/`ℤ`/`ℚ`/`ℝ`) and dispatch a primitive validator / arithmetic rule
// off it — so each treats a type-position `{$ref}` IDENTICALLY to the `{$ref}`
// it folds. Atoms are NOT catalog entities (`refType` VOIDs); the primitive
// validator IS the leaf. So the fold is rewrite-to-NAME: recognize `{$ref:atom}`,
// rewrite to `{$ref:atom}`, run the unchanged primitive switch / arithmetic
// rule. Byte-identical to the `{$ref}` path for ANY handle BY CONSTRUCTION.
//
// Two genuine new surfaces (the rest were already folded in 7e — see the
// "already-folded" block, which only PINS the existing behavior):
//   • validate.ts — the `switch(base.$ref)` primitive dispatch + the unified
//     top/post-peel `{$ref}` arms (7c's `{$void}`→"Unknown $ref type" error now
//     folds into rewrite-to-named, so `{$ref:H}` === `{$ref:H}` for ALL H —
//     entity, atom, AND unknown).
//   • propagate.ts — `namedArith` / the negate arm read the number-tower
//     `$ref` set-name; a `{$ref:"ℤ"}` operand widens / negates identically.
//
// Purely additive: no producer emits a type `{$ref}` until 7g, so every folded
// branch is dead code for the current corpus — it lights up only here.
//
// CONTROLLED — no global catalog dependency: atoms ARE global identities, so the
// tests just use the literal atom names (the contrast with 7e's entity test,
// which had to register a controlled entity).
//
// Canonical spec: design/typed-function-references.md § "The type-layer merge".
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { Ref, List } from "./type-foundation";
import { validate } from "./validate";
import { propagate } from "./propagate";
import { fenelTypeToJsonSchema } from "./json-schema";
import { widgetForType } from "./widget-hint";
import { defaultValueFor } from "./field-meta";
import type { FenelType, SetExpr } from "./types";
import { isSetExpr } from "./types";
import { setExprToDollarKey } from "./set-marker";

// set-algebra-to-fenel Phase 3b-2 — the producer flip changed the OUTPUT FORM
// (`$`-key → `$tag`) of the arithmetic SetExpr `propagate` emits. `cf` deeply
// lowers ANY-form SetExpr back to `$`-key so the byte-parity assertion vs the
// `$`-key expected literal stays a STRUCTURE/VALUE check (setExprToDollarKey
// rewrites only the discriminator).
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

const named = (n: string) => ({ $ref: n }) as unknown as FenelType;
const ref = (n: string) => Ref(n) as unknown as FenelType;

// ---------------------------------------------------------------------------
// validate — the primitive switch (the core new surface)
// ---------------------------------------------------------------------------

describe("Phase 7f-remainder — validate(atom): {$ref} === {$ref}", () => {
  // For each atom the primitive switch dispatches, a VALID and an INVALID value
  // must validate IDENTICALLY through the {$ref} and {$ref} forms.
  const cases: Array<{ atom: string; good: unknown; bad: unknown }> = [
    { atom: "String", good: "hello", bad: 123 },
    { atom: "Number", good: 42, bad: "not-a-number" },
    { atom: "Int", good: 7, bad: "nope" },
    { atom: "Nat", good: 3, bad: "nope" },
    { atom: "Date", good: "2026-06-03", bad: "definitely-not-a-date" },
    { atom: "Bool", good: true, bad: "x" },
  ];

  for (const { atom, good, bad } of cases) {
    test(`${atom}: a valid value validates via {$ref} IDENTICALLY to {$ref}`, () => {
      expect(validate(ref(atom), good, null)).toEqual(validate(named(atom), good, null));
    });
    test(`${atom}: an INVALID value fails identically`, () => {
      expect(validate(ref(atom), bad, null)).toEqual(validate(named(atom), bad, null));
    });
  }
});

describe("Phase 7f-remainder — validate composites / post-peel over an atom ref", () => {
  test("post-peel: $refined{ base: {$ref:Number}, set } === the {$ref} twin (valid)", () => {
    const set: SetExpr = { $interval: { lo: { $tag: "Just", _0: { value: 0, inclusive: true } }, hi: { $tag: "Nothing" } } } as unknown as SetExpr;
    const refined = (b: FenelType): FenelType =>
      ({ $refined: { base: b, set } }) as unknown as FenelType;
    expect(validate(refined(ref("Number")), 5, null)).toEqual(validate(refined(named("Number")), 5, null));
  });

  test("post-peel: $refined{ base: {$ref:Number}, set } === the {$ref} twin (set violated)", () => {
    const set: SetExpr = { $interval: { lo: { $tag: "Just", _0: { value: 0, inclusive: true } }, hi: { $tag: "Nothing" } } } as unknown as SetExpr;
    const refined = (b: FenelType): FenelType =>
      ({ $refined: { base: b, set } }) as unknown as FenelType;
    expect(validate(refined(ref("Number")), -5, null)).toEqual(validate(refined(named("Number")), -5, null));
  });

  test("composite: List({$ref:String}) === List({$ref:String})", () => {
    const items = ["a", "b", "c"];
    expect(validate(List(ref("String")), items, null)).toEqual(validate(List(named("String")), items, null));
  });

  test("composite with a bad element: List({$ref:Number}) === List({$ref:Number})", () => {
    const items = [1, "two", 3];
    expect(validate(List(ref("Number")), items, null)).toEqual(validate(List(named("Number")), items, null));
  });
});

describe("Phase 7f-remainder — validate unknown handle folds into the {$ref} miss", () => {
  test("{$ref:NotAType} === {$ref:NotAType} (both 'Unknown field type')", () => {
    // The 7c top-arm 'Unknown $ref type' message now folds into rewrite-to-named,
    // so an unresolvable {$ref} produces the SAME 'Unknown field type' as its
    // {$ref} twin (full byte identity — the brief's intentional message fold).
    const viaRef = validate(ref("NotAType7fr"), "x", null);
    const viaNamed = validate(named("NotAType7fr"), "x", null);
    expect(() => validate(ref("NotAType7fr"), "x", null)).not.toThrow();
    expect(viaRef).toEqual(viaNamed);
    expect(viaRef.valid).toBe(false);
    expect(viaRef.errors[0]!.message).toContain("Unknown");
  });
});

// ---------------------------------------------------------------------------
// propagate — the number-tower type arithmetic
// ---------------------------------------------------------------------------

describe("Phase 7f-remainder — propagate(number-tower): {$ref} === {$ref}", () => {
  const tower = ["ℕ", "ℤ", "ℚ", "ℝ", "Nat", "Int", "Rational", "Real"];

  for (const op of ["+", "-", "*", "/", "%"]) {
    test(`binary "${op}": {$ref} operands widen identically to {$ref}`, () => {
      for (const a of tower)
        for (const b of tower) {
          const viaRef = propagate(op, ref(a) as unknown as SetExpr, ref(b) as unknown as SetExpr);
          const viaNamed = propagate(op, named(a) as unknown as SetExpr, named(b) as unknown as SetExpr);
          expect(viaRef).toEqual(viaNamed);
        }
    });
  }

  test("mixed: one ref operand, one named operand both === the all-named form", () => {
    expect(propagate("+", ref("ℤ") as unknown as SetExpr, named("ℕ") as unknown as SetExpr))
      .toEqual(propagate("+", named("ℤ") as unknown as SetExpr, named("ℕ") as unknown as SetExpr));
  });

  for (const op of ["-", "negate", "not", "!"]) {
    test(`unary "${op}": {$ref} operand === {$ref}`, () => {
      for (const a of tower) {
        expect(propagate(op, ref(a) as unknown as SetExpr))
          .toEqual(propagate(op, named(a) as unknown as SetExpr));
      }
    });
  }

  test("nested in a union: {$ref} member widens identically to {$ref}", () => {
    const u = (m: FenelType): SetExpr => ({ $union: [m, { $ref: "ℤ" }] }) as unknown as SetExpr;
    expect(propagate("+", u(ref("ℕ")), named("ℤ") as unknown as SetExpr))
      .toEqual(propagate("+", u(named("ℕ")), named("ℤ") as unknown as SetExpr));
  });
});

// ---------------------------------------------------------------------------
// Already-folded 7e consumers (Hard fact 3) — atom handle, PIN-only
// ---------------------------------------------------------------------------

describe("Phase 7f-remainder — 7e consumers already fold an ATOM {$ref} (pin)", () => {
  test("fenelTypeToJsonSchema({$ref:String}) === ({$ref:String})", () => {
    expect(fenelTypeToJsonSchema(ref("String"))).toEqual(fenelTypeToJsonSchema(named("String")));
  });
  test("fenelTypeToJsonSchema({$ref:Number}) === ({$ref:Number})", () => {
    expect(fenelTypeToJsonSchema(ref("Number"))).toEqual(fenelTypeToJsonSchema(named("Number")));
  });
  test("widgetForType({$ref:Number}) === ({$ref:Number})", () => {
    expect(widgetForType(ref("Number"))).toEqual(widgetForType(named("Number")));
  });
  test("defaultValueFor({$ref:String}) === ({$ref:String})", () => {
    expect(defaultValueFor(ref("String"))).toEqual(defaultValueFor(named("String")));
  });
});

// ---------------------------------------------------------------------------
// {$ref} back-compat unchanged by the new arms
// ---------------------------------------------------------------------------

describe("Phase 7f-remainder — {$ref} back-compat unchanged", () => {
  test("plain {$ref} atoms still validate as before", () => {
    expect(validate(named("String"), "hi", null).valid).toBe(true);
    expect(validate(named("Number"), 1, null).valid).toBe(true);
    expect(validate(named("Number"), "x", null).valid).toBe(false);
  });
  test("plain {$ref} number-tower arithmetic: input back-compat, output flips to {$ref} (-4b)", () => {
    // 7g-retire-4b: `{$ref}` INPUT still widens (refHandle reads it), but the
    // SetExpr-position arithmetic OUTPUT now emits the canonical {$ref} (the
    // producer flip — see `Phase 7f-remainder — propagate` for ref≡named parity).
    expect(cf(propagate("+", named("ℤ") as unknown as SetExpr, named("ℤ") as unknown as SetExpr)))
      .toEqual({ $ref: "ℤ" } as unknown as SetExpr);
    expect(cf(propagate("/", named("ℤ") as unknown as SetExpr, named("ℤ") as unknown as SetExpr)))
      .toEqual({ $ref: "ℚ" } as unknown as SetExpr);
  });
});
