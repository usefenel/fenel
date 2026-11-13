import { describe, it, expect } from "vitest";
import {
  dispatchedNamedSubset,
  dispatchedNamedDomain,
} from "./engine-bodies-dispatch";

// ===========================================================================
// containment-substrate Phase 3 Step 2 — the NAMED_HIERARCHY numeric-rows port
// PARITY GATE.
//
// The numeric subtyping facts (ℕ⊂ℤ⊂ℚ⊂ℝ) moved from the TS const NAMED_HIERARCHY
// into `.fenel` `Subsumable` instances. This test is the codec-delete discipline:
// prove the NEW `.fenel`-relation path is byte-identical to the OLD TS-table path
// over EVERY numeric pair, THEN the const's numeric rows are deleted.
//
// The OLD verdicts are captured here as a SELF-CONTAINED reference: the verbatim
// numeric rows (a snapshot of the deleted NAMED_HIERARCHY numeric entries) + the
// exact `namedSubset` semantics (`a == b OR b ∈ supers(a)`, the
// set-algebra-deciders.fenel:namedSubset body). Asserting the live
// `dispatchedNamedSubset` (which now sources its data from the `.fenel` instances
// via `subsumableNumericRows()`) equals this reference proves the port preserves
// every decision.
// ===========================================================================

// The OLD NAMED_HIERARCHY numeric rows — VERBATIM (the pre-delete snapshot).
const NUMERIC_ROWS: Record<string, string[]> = {
  "ℕ": ["ℤ", "ℚ", "ℝ", "Int", "Rational", "Real", "Nat"],
  Nat: ["ℤ", "ℚ", "ℝ", "Int", "Rational", "Real", "ℕ"],
  "ℤ": ["ℚ", "ℝ", "Rational", "Real"],
  Int: ["ℚ", "ℝ", "Rational", "Real", "ℤ"],
  "ℚ": ["ℝ", "Real"],
  Rational: ["ℝ", "Real", "ℚ"],
  Real: ["ℝ"],
  "ℝ": ["Real"],
};

const NUMERIC_NAMES = Object.keys(NUMERIC_ROWS);

// The OLD-path decision, recomputed from the snapshot (the namedSubset semantics:
// a == b OR b ∈ supers(a) — supers are the full transitive closure already).
function oldNamedSubset(a: string, b: string): boolean {
  if (a === b) return true;
  return (NUMERIC_ROWS[a] ?? []).includes(b);
}

describe("Phase 3 Step 2 — Subsumable numeric-rows parity gate", () => {
  it("dispatchedNamedSubset byte-identical over every numeric pair (64 pairs)", () => {
    const divergences: string[] = [];
    let pairs = 0;
    for (const a of NUMERIC_NAMES) {
      for (const b of NUMERIC_NAMES) {
        pairs++;
        const expected = oldNamedSubset(a, b);
        const actual = dispatchedNamedSubset(a, b);
        if (actual !== expected) {
          divergences.push(`(${a}, ${b}): expected ${expected}, got ${actual}`);
        }
      }
    }
    expect(pairs).toBe(64);
    expect(divergences).toEqual([]);
  });

  it("reflexivity + the ℕ⊂ℤ⊂ℚ⊂ℝ chain (spot checks on the live `.fenel` path)", () => {
    // Reflexive (a == b)
    for (const n of NUMERIC_NAMES) expect(dispatchedNamedSubset(n, n)).toBe(true);
    // The ascending chain — every lower rung ⊆ every higher rung
    expect(dispatchedNamedSubset("Nat", "Int")).toBe(true);
    expect(dispatchedNamedSubset("ℕ", "ℤ")).toBe(true);
    expect(dispatchedNamedSubset("Int", "Rational")).toBe(true);
    expect(dispatchedNamedSubset("ℤ", "ℚ")).toBe(true);
    expect(dispatchedNamedSubset("Rational", "Real")).toBe(true);
    expect(dispatchedNamedSubset("ℚ", "ℝ")).toBe(true);
    expect(dispatchedNamedSubset("Nat", "Real")).toBe(true);
    expect(dispatchedNamedSubset("ℕ", "ℝ")).toBe(true);
    // ASCII ↔ glyph alias equivalence
    expect(dispatchedNamedSubset("Nat", "ℕ")).toBe(true);
    expect(dispatchedNamedSubset("Real", "ℝ")).toBe(true);
    // Descending is NOT a subset (Real ⊄ Nat)
    expect(dispatchedNamedSubset("Real", "Nat")).toBe(false);
    expect(dispatchedNamedSubset("ℝ", "ℕ")).toBe(false);
    expect(dispatchedNamedSubset("Int", "Nat")).toBe(false);
  });

  it("the key-membership sites resolve every numeric name (dispatchedNamedDomain ⇒ number)", () => {
    // dispatchedNamedDomain pre-receives `inHierarchy` from the merged key-set
    // (the same `mergedHierarchyKeys()` baseInHier / namedInHierarchy read). A
    // numeric name still being a hierarchy key ⇒ it resolves to the "number"
    // domain (the §7 Nat∩Int crash-preservation: numeric names must stay keys
    // after the const's numeric rows are deleted).
    for (const n of NUMERIC_NAMES) {
      expect(dispatchedNamedDomain(n)).toBe("number");
    }
  });
});
