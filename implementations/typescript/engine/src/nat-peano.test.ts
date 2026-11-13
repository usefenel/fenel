// ---------------------------------------------------------------------------
// nat-peano.test.ts — numeric-tower Phase 1. The D7 round-trip law (pure ≡
// native) for the seven Peano Nat ops + the two Number bridges + the D8
// Nat↔NonNegInt iso, sample-tested over a small grid.
//
// This is the Phase-1 discharge of the pure≡native arm of the D7 law
// (notes/phase-0-audit.md §3 D7). The native≡DirectOp arm is covered by the
// existing self-host matrix + compile oracles (the Nat ops are NOT
// DirectOp-lowered, so that arm is untouched and stays green). The principled
// `$el` law-field home is Phase 5 (the `Numeric Nat` instance) — at Phase 1
// there is no class/type slot to hang the predicate field on (D5 mints the
// classes at Phase 5, bodies-first 1–4), so this sample test is the honest
// Phase-1 discharge. Ledgered test-tooling (the foundation-load.test.ts /
// bool-opaque.test.ts precedent).
//
// MECHANISM (representation-substrate Phase 2 — UPDATED): the bodies now use the
// POSITIONAL surface (`Succ x` / `case n of Succ p -> …`), retiring the
// numeric-tower Phase-1 named-field workaround. The construct gap is DISSOLVED:
// Phase 1 taught the registry `$opaque`-peel to index an opaque type's pure
// `$variant` cases, and Phase 2 registers `Nat` as a catalog entity (the
// `@label`/`@description` on its foundation.fenel decl), so `_constructors.Succ`
// is populated and positional `Succ x` builds the canonical `{$tag:"Succ", _0:x}`
// (positional binds by ORDER to `_0`, NOT the declared field — json-logic.ts:1019).
// No new TS — the dissolution is pure `.fenel`. This file also discharges the
// `Reprable JsRuntime Nat` round-trip law (the first non-trivial Reprable instance).
//
// Carve-outs (D7): div/mod hold over the NON-ZERO divisor domain; at a zero
// divisor natDiv = Zero (matches the native zero-guard-to-0) and natMod = a
// (keeps the div/mod identity; DIVERGES from the native's 0 — the documented
// boundary). eq is structural same-rung.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import natArithSrc from "../../../../fenel/modules/std/nat/nat-arith.fenel?raw";
import natBridgeSrc from "../../../../fenel/modules/std/nat/nat-bridge.fenel?raw";
import { loadFenelModuleUnion } from "./fenel-module";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import { dispatchRegistry } from "./system-entities";

const ARITH_IDS = ["std:natAdd", "std:natMul", "std:natMonus", "std:natDiv", "std:natMod", "std:natLt", "std:natEq"];
const BRIDGE_IDS = ["std:numberToNat", "std:natToNumber", "std:natToRefined", "std:natFromRefined"];

test("nat-arith.fenel + nat-bridge.fenel parse to exactly the 11 expected fnIds", () => {
  const mod = loadFenelModuleUnion([natArithSrc, natBridgeSrc].map((src) => ({ src, name: "std" }))).find((m) => m.name === "std")!;
  const ids = (mod.functions ?? []).map((f) => f.id).sort();
  expect(ids).toEqual([...ARITH_IDS, ...BRIDGE_IDS].sort());
  for (const f of mod.functions ?? []) expect(f.body).toBeDefined();
});

test("the seven Nat ops + the two bridges are wired into stdModule with Fenel bodies", () => {
  for (const id of [...ARITH_IDS, ...BRIDGE_IDS]) {
    const fn = (stdModule.functions ?? []).find((f) => f.id === id);
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  }
});

// The registry + evaluator harness (the std-load.test.ts pattern). systemEntities
// (incl. Nat — registered as a catalog entity in representation-substrate Phase 2)
// are pulled into the registry automatically, so the `$opaque`-peel indexes
// `Zero`/`Succ` and the positional surface builds/matches correctly.
const reg = createRegistry([stdModule]);
const ctx = reg.evaluateContext();
// modules-as-values Phase 2b: an instance's lift / lower is a qualified function
// reference; this registry resolves it to the id of
// the function the harness runs.
const declaredId = (ref: unknown): string => {
  const handle = (ref as { $ref?: unknown } | undefined)?.$ref;
  const id = typeof handle === "string" ? reg.getFunction(handle)?.id : undefined;
  if (id === undefined) throw new Error(`unresolvable lift/lower reference ${JSON.stringify(ref)}`);
  return id;
};
const body = (id: string) => (stdModule.functions ?? []).find((f) => f.id === id)!.body;
const run = (id: string, data: Record<string, unknown>) => evaluate(body(id), data, ctx);
const call1 = (id: string, value: unknown) => evaluate({ call: [id, { var: "value" }] }, { value }, ctx);
const toNat = (x: number) => run("std:numberToNat", { n: x });
const fromNat = (n: unknown) => run("std:natToNumber", { n });

test("positional construct/match materialized Peano + numberToNat/natToNumber round-trip 0..12", () => {
  // numberToNat builds the POSITIONAL Peano spine (`Succ x` → `{$tag:"Succ",_0:x}`);
  // natToNumber counts it via the positional pattern `Succ p`. The construct gap
  // is dissolved — `_0` is the canonical positional slot (NOT the declared `pred`).
  expect(fromNat(toNat(3))).toBe(3);
  const three = toNat(3) as { $tag: string; _0: { $tag: string } };
  expect(three.$tag).toBe("Succ");
  expect(three._0.$tag).toBe("Succ");
  expect((three as Record<string, unknown>).pred).toBeUndefined(); // positional ⇒ `_0`, not the named field
  for (let i = 0; i <= 12; i++) expect(fromNat(toNat(i))).toBe(i);
});

test("D7 pure≡native — natAdd / natMul / natMonus over a 0..7 grid", () => {
  for (let x = 0; x <= 7; x++) {
    for (let y = 0; y <= 7; y++) {
      expect(fromNat(run("std:natAdd", { a: toNat(x), b: toNat(y) }))).toBe(x + y);
      expect(fromNat(run("std:natMul", { a: toNat(x), b: toNat(y) }))).toBe(x * y);
      expect(fromNat(run("std:natMonus", { a: toNat(x), b: toNat(y) }))).toBe(Math.max(0, x - y));
    }
  }
});

test("D7 pure≡native — natLt / natEq over a 0..7 grid", () => {
  for (let x = 0; x <= 7; x++) {
    for (let y = 0; y <= 7; y++) {
      expect(run("std:natLt", { a: toNat(x), b: toNat(y) })).toBe(x < y);
      expect(run("std:natEq", { a: toNat(x), b: toNat(y) })).toBe(x === y);
    }
  }
});

test("D7 pure≡native — natDiv / natMod over the NON-ZERO divisor domain (carve-out)", () => {
  for (let x = 0; x <= 7; x++) {
    for (let y = 1; y <= 7; y++) {
      expect(fromNat(run("std:natDiv", { a: toNat(x), b: toNat(y) }))).toBe(Math.floor(x / y));
      expect(fromNat(run("std:natMod", { a: toNat(x), b: toNat(y) }))).toBe(x % y);
    }
  }
});

test("D7 zero-divisor boundary — natDiv a 0 = 0 (matches native); natMod a 0 = a (documented divergence)", () => {
  for (let x = 0; x <= 5; x++) {
    expect(fromNat(run("std:natDiv", { a: toNat(x), b: toNat(0) }))).toBe(0); // == native zero-guard
    expect(fromNat(run("std:natMod", { a: toNat(x), b: toNat(0) }))).toBe(x); // pure=a; native would be 0
  }
});

test("the div/mod identity a = b*(a/b) + a%b holds at every sampled (a,b), including b=0", () => {
  for (let x = 0; x <= 7; x++) {
    for (let y = 0; y <= 7; y++) {
      const q = fromNat(run("std:natDiv", { a: toNat(x), b: toNat(y) })) as number;
      const r = fromNat(run("std:natMod", { a: toNat(x), b: toNat(y) })) as number;
      expect(y * q + r).toBe(x);
    }
  }
});

test("D8 iso — natFromRefined ∘ natToRefined ≡ id (Nat side) and natToRefined ∘ natFromRefined ≡ id (NonNegInt side), 0..12", () => {
  for (let i = 0; i <= 12; i++) {
    // Nat side: start from a Peano value, round-trip through the refinement view.
    expect(fromNat(run("std:natFromRefined", { n: run("std:natToRefined", { n: toNat(i) }) }))).toBe(i);
    // NonNegInt side: start from the refined Number, round-trip through Nat.
    expect(run("std:natToRefined", { n: run("std:natFromRefined", { n: i }) })).toBe(i);
  }
});

// ---------------------------------------------------------------------------
// representation-substrate Phase 2 — the `Reprable JsRuntime Nat` instance.
// The first NON-TRIVIAL Reprable: native `number` ≠ the Peano `Zero`/`Succ` pure
// ADT (vs Bool's degenerate identity). `lift`/`lower` are the existing tower
// bridges (natToNumber / numberToNat) — the instance is the source of truth
// pointing at them; here we discharge its round-trip laws over a 0..12 grid,
// keyed off the instance's DECLARED method fnIds (so the test binds the law to
// the .fenel instance, not hardcoded names — the bool-opaque.test.ts precedent).
// ---------------------------------------------------------------------------
const reprableNat = () => {
  const i = [...dispatchRegistry.listInstances("Reprable")].find(
    (x) => x.args[0] === "JsRuntime" && x.args[1] === "Nat",
  );
  if (!i) throw new Error("Reprable JsRuntime Nat instance not registered");
  return i;
};

test("Reprable JsRuntime Nat — instance projected with native type-ref + bridge lift/lower", () => {
  const nat = reprableNat();
  expect(nat.typeName).toBe("Reprable");
  expect(nat.args).toEqual(["JsRuntime", "Nat"]);
  // Exact carriers retain small Numbers and admit typed digit data; method
  // references follow the current source declaration's checked crossings.
  expect(nat.methods.native).toEqual({ $ref: "NatNativeRepresentation" });
  expect(nat.methods.lift).toEqual({ $ref: "std.natRepresentationLift" });
  expect(nat.methods.lower).toEqual({ $ref: "std.natRepresentationLower" });
});

test("Reprable JsRuntime Nat — round-trip laws via the instance's declared lift/lower, 0..12", () => {
  const nat = reprableNat();
  const liftFn = declaredId(nat.methods.lift);
  const lowerFn = declaredId(nat.methods.lower);
  for (let i = 0; i <= 12; i++) {
    // reprLiftLowerRoundtrip: lift (lower n) ≡ n   (on the native Number side)
    expect(call1(liftFn, call1(lowerFn, i))).toBe(i);
    // reprLowerLiftRoundtrip: lower (lift p) ≡ p   (on the Nat side) — compare the
    // materialised Peano values structurally via natToNumber (both ⇒ i).
    const p = toNat(i);
    const back = call1(lowerFn, call1(liftFn, p));
    expect(fromNat(back)).toBe(fromNat(p));
    expect(fromNat(back)).toBe(i);
  }
});
