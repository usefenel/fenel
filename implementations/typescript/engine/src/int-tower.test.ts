// ---------------------------------------------------------------------------
// int-tower.test.ts — numeric-tower Phase 2. The D7 round-trip law (pure ≡
// native) for the sign-magnitude Int ops + the two Number bridges + the D8
// Int↔ℤ iso, sample-tested over a SIGNED grid (−7..7), plus the negative-zero
// pins (the central sign-magnitude hazard) and the `Reprable JsRuntime Int`
// round-trip.
//
// This is the Phase-2 discharge of the pure≡native arm of the D7 law
// (notes/phase-0-audit.md §3 D7). The native≡DirectOp arm is covered by the
// existing self-host matrix + compile oracles (the Int ops are NOT
// DirectOp-lowered, so that arm is untouched and stays green). The principled
// `$el` law-field home is Phase 5 (the `Numeric Int` instance) — at Phase 2
// there is no class/type slot to hang the predicate field on, so this sample
// test is the honest Phase-2 discharge. Ledgered test-tooling (the
// nat-peano.test.ts / foundation-load.test.ts precedent).
//
// MECHANISM: the bodies use the NAMED-record surface (`Int { magnitude = m,
// negative = n }` / `case a of Int { magnitude = m, negative = n } -> …`) over
// real materialized Peano magnitudes. The construct gap is dissolved (Int is a
// registered catalog entity via foundation.fenel `@directives`), so the named
// surface builds the canonical `{$tag:"Int", magnitude, negative}` value.
//
// NEGATIVE ZERO (§1 of the brief): sign-magnitude has two zeros (+0 / −0). The
// `mkInt` smart constructor forces +0 (a Zero magnitude ⇒ negative = False), so
// −0 is unrepresentable post-construction. The pins below assert no op ever
// emits `{magnitude: Zero, negative: true}`, which is what makes intEq
// structural and the D7 law total.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import intArithSrc from "../../../../fenel/modules/std/int/int-arith.fenel?raw";
import intBridgeSrc from "../../../../fenel/modules/std/int/int-bridge.fenel?raw";
import { loadFenelModuleUnion } from "./fenel-module";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import { dispatchRegistry } from "./system-entities";

const ARITH_IDS = [
  "std:sameSign", "std:xorSign", "std:mkInt", "std:intNegate",
  "std:intAdd", "std:intSub", "std:intMul", "std:intLt", "std:intEq",
];
const BRIDGE_IDS = ["std:numberToInt", "std:intToNumber", "std:intToRefined", "std:intFromRefined"];

test("int-arith.fenel + int-bridge.fenel parse to exactly the 13 expected fnIds", () => {
  const mod = loadFenelModuleUnion([intArithSrc, intBridgeSrc].map((src) => ({ src, name: "std" }))).find((m) => m.name === "std")!;
  const ids = (mod.functions ?? []).map((f) => f.id).sort();
  expect(ids).toEqual([...ARITH_IDS, ...BRIDGE_IDS].sort());
  for (const f of mod.functions ?? []) expect(f.body).toBeDefined();
});

test("the Int ops + the two bridges are wired into stdModule with Fenel bodies", () => {
  for (const id of [...ARITH_IDS, ...BRIDGE_IDS]) {
    const fn = (stdModule.functions ?? []).find((f) => f.id === id);
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  }
});

// The registry + evaluator harness (the nat-peano.test.ts pattern). systemEntities
// (incl. Int — registered as a catalog entity in numeric-tower Phase 2) are pulled
// into the registry automatically, so the `$opaque`-peel indexes the `Int`
// constructor and the named-record surface builds/matches correctly.
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
const body = (id: string) => (stdModule.functions ?? []).find((f) => f.id === id)!.body;
const run = (id: string, data: Record<string, unknown>) => evaluate(body(id), data, ctx);
// single-arg bridges differ in param name (numberToInt:`n`, intToNumber:`i`); pass
// both keys — the body resolves only the var it references, ignoring the extra.
const call1 = (id: string, v: unknown) => run(id, { n: v, i: v });
const toInt = (x: number) => run("std:numberToInt", { n: x });
const fromInt = (i: unknown) => run("std:intToNumber", { i });
const toNat = (x: number) => run("std:numberToNat", { n: x });

const GRID = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
// JS arithmetic produces −0 (e.g. 0 * −7, −(0)); the pure Int body canonicalizes
// to +0 (mkInt), so normalize the EXPECTED value's −0 → +0 (Object.is(0,−0) is
// false, so `.toBe(−0)` would spuriously fail against the body's correct +0).
const norm = (z: number) => (z === 0 ? 0 : z);

test("numberToInt / intToNumber round-trip over the signed grid −7..7", () => {
  for (const x of GRID) expect(fromInt(toInt(x))).toBe(x);
  // +0 is canonical: numberToInt 0 has a Zero magnitude and negative === false.
  const zero = toInt(0) as { $tag: string; magnitude: { $tag: string }; negative: boolean };
  expect(zero.$tag).toBe("Int");
  expect(zero.magnitude.$tag).toBe("Zero");
  expect(zero.negative).toBe(false);
});

test("D7 pure≡native — intAdd / intSub / intMul over the signed grid", () => {
  for (const x of GRID) {
    for (const y of GRID) {
      expect(fromInt(run("std:intAdd", { a: toInt(x), b: toInt(y) }))).toBe(norm(x + y));
      expect(fromInt(run("std:intSub", { a: toInt(x), b: toInt(y) }))).toBe(norm(x - y));
      expect(fromInt(run("std:intMul", { a: toInt(x), b: toInt(y) }))).toBe(norm(x * y));
    }
  }
});

test("D7 pure≡native — intLt / intEq over the signed grid", () => {
  for (const x of GRID) {
    for (const y of GRID) {
      expect(run("std:intLt", { a: toInt(x), b: toInt(y) })).toBe(x < y);
      expect(run("std:intEq", { a: toInt(x), b: toInt(y) })).toBe(x === y);
    }
  }
});

test("D7 pure≡native — intNegate agrees with unary minus over the signed grid", () => {
  for (const x of GRID) {
    // -0 === 0 in JS, so the numeric equality is trivially true at x=0; the
    // raw-shape pin below is the real negative-zero assertion.
    expect(fromInt(run("std:intNegate", { a: toInt(x) }))).toBe(norm(-x));
  }
});

// ---------------------------------------------------------------------------
// Negative-zero pins — the §1 hazard. mkInt forces +0; no op may emit
// {magnitude: Zero, negative: true}.
// ---------------------------------------------------------------------------

const rawInt = (v: unknown) => v as { $tag: string; magnitude: { $tag: string }; negative: boolean };
const isCanonical = (v: unknown) => {
  const r = rawInt(v);
  // the ONLY forbidden shape is a Zero magnitude with negative === true (−0).
  return !(r.magnitude.$tag === "Zero" && r.negative === true);
};

test("mkInt forces +0 — a Zero magnitude always yields negative === false", () => {
  // mkInt Zero True must NOT produce −0.
  const r = rawInt(run("std:mkInt", { m: toNat(0), neg: true }));
  expect(r.magnitude.$tag).toBe("Zero");
  expect(r.negative).toBe(false);
  // mkInt of a non-zero magnitude passes the sign through.
  const neg3 = rawInt(run("std:mkInt", { m: toNat(3), neg: true }));
  expect(neg3.negative).toBe(true);
  expect(fromInt(neg3)).toBe(-3);
});

test("intNegate (numberToInt 0) is +0 (negative === false), not −0", () => {
  const r = rawInt(run("std:intNegate", { a: toInt(0) }));
  expect(r.magnitude.$tag).toBe("Zero");
  expect(r.negative).toBe(false);
});

test("intSub 5 5 is +0; intMul 0 −3 is +0", () => {
  const sub = rawInt(run("std:intSub", { a: toInt(5), b: toInt(5) }));
  expect(sub.magnitude.$tag).toBe("Zero");
  expect(sub.negative).toBe(false);
  const mul = rawInt(run("std:intMul", { a: toInt(0), b: toInt(-3) }));
  expect(mul.magnitude.$tag).toBe("Zero");
  expect(mul.negative).toBe(false);
});

test("intEq of any two zeros is True (sound only because −0 is unrepresentable)", () => {
  expect(run("std:intEq", { a: toInt(0), b: toInt(0) })).toBe(true);
  expect(run("std:intEq", { a: run("std:intNegate", { a: toInt(0) }), b: toInt(0) })).toBe(true);
  expect(run("std:intEq", { a: run("std:intSub", { a: toInt(4), b: toInt(4) }), b: toInt(0) })).toBe(true);
});

test("NO body ever returns a {magnitude: Zero, negative: true} value (the −0 leak spot-check)", () => {
  for (const x of GRID) {
    expect(isCanonical(run("std:intNegate", { a: toInt(x) }))).toBe(true);
    for (const y of GRID) {
      expect(isCanonical(run("std:intAdd", { a: toInt(x), b: toInt(y) }))).toBe(true);
      expect(isCanonical(run("std:intSub", { a: toInt(x), b: toInt(y) }))).toBe(true);
      expect(isCanonical(run("std:intMul", { a: toInt(x), b: toInt(y) }))).toBe(true);
    }
  }
});

// ---------------------------------------------------------------------------
// D8 iso — Int ↔ ℤ refinement view. The witnesses are re-typed bridges (the
// codomain is stated as `Number` — flagged: no integer-refinement alias exists
// today, brief §2e / D8c). Round-trips to the identity on both sides.
// ---------------------------------------------------------------------------

test("D8 iso — intFromRefined ∘ intToRefined ≡ id (Int side) and intToRefined ∘ intFromRefined ≡ id (refinement side)", () => {
  for (const x of GRID) {
    // Int side: start from a sign-magnitude value, round-trip through the refinement view.
    expect(fromInt(run("std:intFromRefined", { n: run("std:intToRefined", { i: toInt(x) }) }))).toBe(x);
    // refinement side: start from the (integer) refined Number, round-trip through Int.
    expect(run("std:intToRefined", { i: run("std:intFromRefined", { n: x }) })).toBe(x);
  }
});

// ---------------------------------------------------------------------------
// numeric-tower Phase 2 — the `Reprable JsRuntime Int` instance (the
// representation-substrate hand-off; Int is the substrate's first NEW client).
// The DIRECT SIBLING of the Nat instance: native `number` ≠ the sign-magnitude
// ADT. `lift`/`lower` are the existing tower bridges (intToNumber / numberToInt)
// — the instance is the source of truth pointing at them; here we discharge its
// round-trip laws over the signed grid, keyed off the instance's DECLARED method
// fnIds (binding the law to the .fenel instance — the nat-peano precedent).
// ---------------------------------------------------------------------------

const reprableInt = () => {
  const i = [...dispatchRegistry.listInstances("Reprable")].find(
    (x) => x.args[0] === "JsRuntime" && x.args[1] === "Int",
  );
  if (!i) throw new Error("Reprable JsRuntime Int instance not registered");
  return i;
};

test("Reprable JsRuntime Int — instance projected with native type-ref + bridge lift/lower", () => {
  const int = reprableInt();
  expect(int.typeName).toBe("Reprable");
  expect(int.args).toEqual(["JsRuntime", "Int"]);
  // Exact carriers retain small Numbers and admit typed digit data; method
  // references follow the current source declaration's checked crossings.
  expect(int.methods.native).toEqual({ $ref: "IntNativeRepresentation" });
  expect(int.methods.lift).toEqual({ $ref: "std.intRepresentationLift" });
  expect(int.methods.lower).toEqual({ $ref: "std.intRepresentationLower" });
});

test("Reprable JsRuntime Int — round-trip laws via the instance's declared lift/lower, signed grid", () => {
  const int = reprableInt();
  const liftFn = declaredId(int.methods.lift);
  const lowerFn = declaredId(int.methods.lower);
  for (const x of GRID) {
    // reprLiftLowerRoundtrip: lift (lower n) ≡ n   (on the native Number side)
    expect(call1(liftFn, call1(lowerFn, x))).toBe(x);
    // reprLowerLiftRoundtrip: lower (lift i) ≡ i   (on the Int side) — compare the
    // materialised sign-magnitude values via intToNumber (both ⇒ x).
    const p = toInt(x);
    const back = call1(lowerFn, call1(liftFn, p));
    expect(fromInt(back)).toBe(fromInt(p));
    expect(fromInt(back)).toBe(x);
  }
});
