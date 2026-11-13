import { describe, it, expect } from "vitest";
import {
  dispatchedNamedSubset,
  dispatchedNamedDomain,
  dispatchedDisjointType,
} from "./engine-bodies-dispatch";

// ===========================================================================
// containment-substrate Phase 4 — the RESIDUAL char/str/Bool NAMED_HIERARCHY
// rows port PARITY GATE.
//
// Phase 4 completes the NAMED_HIERARCHY retirement Step 2 began: the char:* /
// str:* codespace-inclusion hierarchy + Bool / String / NonEmpty (the last rows
// in the TS const) moved into `.fenel` `Subsumable` instances, and the const is
// DELETED entirely. This test is the codec-delete discipline: prove the NEW
// `.fenel`-relation path is byte-identical to the OLD TS-table path over EVERY
// char/str/Bool pair + the domain dispatch, THEN the const is removed.
//
// The OLD verdicts are captured here as a SELF-CONTAINED reference: the verbatim
// residual rows (a snapshot of the deleted NAMED_HIERARCHY char/str/Bool entries)
// + the exact `namedSubset` semantics (`a == b OR b ∈ supers(a)`, the
// set-algebra-deciders.fenel:namedSubset body, supers being the full transitive
// closure). Asserting the live `dispatchedNamedSubset` (which now sources its
// data from the `.fenel` instances via `subsumableRows()`) equals this reference
// proves the port preserves every decision.
//
// floor-kernel Phase 3c repairs the DOMAIN classification that this migration
// accidentally froze. A hierarchy-key flag is not a value-domain theorem:
// str:* accepts strings and must stay in the string domain; char:* deliberately
// accepts both numeric codepoints and one-character strings, so it has no single
// domain. Prefix facts now run before the numeric-hierarchy fallback. The
// Subsumable relation itself remains byte-parity-pinned below.
// ===========================================================================

// The OLD NAMED_HIERARCHY residual rows — VERBATIM (the pre-delete snapshot).
const RESIDUAL_ROWS: Record<string, string[]> = {
  Bool: [],
  String: [],
  NonEmpty: ["String"],
  // Char-class hierarchy (codespace inclusion)
  "char:ascii": ["char:latin1", "char:bmp"],
  "char:ascii-printable": ["char:ascii", "char:latin1", "char:bmp"],
  "char:ascii-letter": ["char:letter", "char:ascii", "char:latin1", "char:bmp"],
  "char:ascii-lower": ["char:ascii-letter", "char:lowercase", "char:letter", "char:ascii", "char:latin1", "char:bmp"],
  "char:ascii-upper": ["char:ascii-letter", "char:uppercase", "char:letter", "char:ascii", "char:latin1", "char:bmp"],
  "char:ascii-digit": ["char:digit", "char:decimal-digit", "char:ascii", "char:latin1", "char:bmp"],
  "char:ascii-alnum": ["char:alnum", "char:word", "char:ascii", "char:latin1", "char:bmp"],
  "char:ascii-punct": ["char:punct", "char:ascii", "char:latin1", "char:bmp"],
  "char:latin1": ["char:bmp"],
  "char:lowercase": ["char:letter"],
  "char:uppercase": ["char:letter"],
  "char:titlecase": ["char:letter"],
  "char:modifier-letter": ["char:letter"],
  "char:other-letter": ["char:letter"],
  "char:decimal-digit": ["char:digit"],
  "char:letter-number": ["char:digit"],
  "char:other-number": ["char:digit"],
  "char:currency": ["char:symbol"],
  "char:math": ["char:symbol"],
  "char:modifier-symbol": ["char:symbol"],
  "char:other-symbol": ["char:symbol"],
  "char:alnum": ["char:word"],
  // String-class hierarchy mirrors char-class
  "str:ascii": ["str:latin1", "str:bmp", "String"],
  "str:ascii-printable": ["str:ascii", "str:latin1", "str:bmp", "String"],
  "str:ascii-letter": ["str:letter", "str:ascii", "String"],
  "str:ascii-lower": ["str:ascii-letter", "str:lowercase", "str:letter", "str:ascii", "String"],
  "str:ascii-upper": ["str:ascii-letter", "str:uppercase", "str:letter", "str:ascii", "String"],
  "str:ascii-digit": ["str:digit", "str:ascii", "String"],
  "str:ascii-alnum": ["str:alnum", "str:word", "str:ascii", "String"],
  "str:latin1": ["str:bmp", "String"],
  "str:bmp": ["String"],
  "str:lowercase": ["str:letter", "String"],
  "str:uppercase": ["str:letter", "String"],
  "str:letter": ["String"],
  "str:digit": ["String"],
  "str:alnum": ["str:word", "String"],
  "str:word": ["String"],
  "str:emoji": ["String"],
};

const RESIDUAL_NAMES = Object.keys(RESIDUAL_ROWS);
const CHAR_NAMES = RESIDUAL_NAMES.filter((n) => n.startsWith("char:"));
const STR_NAMES = RESIDUAL_NAMES.filter((n) => n.startsWith("str:"));

// The OLD-path decision, recomputed from the snapshot (the namedSubset semantics:
// a == b OR b ∈ supers(a) — supers are the full transitive closure already).
function oldNamedSubset(a: string, b: string): boolean {
  if (a === b) return true;
  return (RESIDUAL_ROWS[a] ?? []).includes(b);
}

function soundNamedDomain(name: string): "string" | "boolean" | undefined {
  if (name === "Bool") return "boolean";
  if (name === "String" || name === "NonEmpty" || name.startsWith("str:")) return "string";
  return undefined;
}

describe("Phase 4 — residual char/str/Bool Subsumable parity gate", () => {
  it("dispatchedNamedSubset byte-identical over every residual pair (41 × 41 = 1681 pairs)", () => {
    const divergences: string[] = [];
    let pairs = 0;
    for (const a of RESIDUAL_NAMES) {
      for (const b of RESIDUAL_NAMES) {
        pairs++;
        const expected = oldNamedSubset(a, b);
        const actual = dispatchedNamedSubset(a, b);
        if (actual !== expected) {
          divergences.push(`(${a}, ${b}): expected ${expected}, got ${actual}`);
        }
      }
    }
    expect(pairs).toBe(1681);
    expect(divergences).toEqual([]);
  });

  it("the char-class codespace-inclusion chain (spot checks on the live `.fenel` path)", () => {
    // Reflexive
    for (const n of CHAR_NAMES) expect(dispatchedNamedSubset(n, n)).toBe(true);
    // ascii ⊂ latin1 ⊂ bmp (bmp is a leaf-super with no own row)
    expect(dispatchedNamedSubset("char:ascii", "char:latin1")).toBe(true);
    expect(dispatchedNamedSubset("char:ascii", "char:bmp")).toBe(true);
    expect(dispatchedNamedSubset("char:latin1", "char:bmp")).toBe(true);
    // ascii-printable ⊂ ascii ⊂ latin1 ⊂ bmp
    expect(dispatchedNamedSubset("char:ascii-printable", "char:ascii")).toBe(true);
    expect(dispatchedNamedSubset("char:ascii-printable", "char:bmp")).toBe(true);
    // ascii-lower ⊂ ascii-letter ⊂ letter (letter = leaf-super)
    expect(dispatchedNamedSubset("char:ascii-lower", "char:ascii-letter")).toBe(true);
    expect(dispatchedNamedSubset("char:ascii-lower", "char:letter")).toBe(true);
    expect(dispatchedNamedSubset("char:lowercase", "char:letter")).toBe(true);
    // NOT subsets (no ascending claim downward / across siblings)
    expect(dispatchedNamedSubset("char:bmp", "char:ascii")).toBe(false);
    expect(dispatchedNamedSubset("char:latin1", "char:ascii")).toBe(false);
    expect(dispatchedNamedSubset("char:lowercase", "char:uppercase")).toBe(false);
  });

  it("the str-class codespace-inclusion chain + the str:* ⊂ String top (spot checks)", () => {
    for (const n of STR_NAMES) expect(dispatchedNamedSubset(n, n)).toBe(true);
    // every str:* ⊂ String (String is in each str: row's supers)
    for (const n of STR_NAMES) expect(dispatchedNamedSubset(n, "String")).toBe(true);
    // ascii ⊂ latin1 ⊂ bmp ⊂ String
    expect(dispatchedNamedSubset("str:ascii", "str:latin1")).toBe(true);
    expect(dispatchedNamedSubset("str:ascii", "str:bmp")).toBe(true);
    expect(dispatchedNamedSubset("str:latin1", "str:bmp")).toBe(true);
    // ascii-lower ⊂ ascii-letter ⊂ letter ⊂ String
    expect(dispatchedNamedSubset("str:ascii-lower", "str:ascii-letter")).toBe(true);
    expect(dispatchedNamedSubset("str:ascii-letter", "str:letter")).toBe(true);
    // NonEmpty ⊂ String; descending NOT a subset
    expect(dispatchedNamedSubset("NonEmpty", "String")).toBe(true);
    expect(dispatchedNamedSubset("String", "NonEmpty")).toBe(false);
    expect(dispatchedNamedSubset("str:bmp", "str:ascii")).toBe(false);
  });

  it("sound domain dispatch: str:* is string and mixed-representation char:* is unknown", () => {
    const divergences: string[] = [];
    for (const n of RESIDUAL_NAMES) {
      const expected = soundNamedDomain(n);
      const actual = dispatchedNamedDomain(n);
      if (actual !== expected) {
        divergences.push(`${n}: expected ${expected}, got ${actual}`);
      }
    }
    expect(divergences).toEqual([]);
    // Explicit pins of the repaired classes.
    expect(dispatchedNamedDomain("Bool")).toBe("boolean");
    expect(dispatchedNamedDomain("String")).toBe("string");
    expect(dispatchedNamedDomain("NonEmpty")).toBe("string");
    expect(dispatchedNamedDomain("char:ascii")).toBeUndefined();
    expect(dispatchedNamedDomain("str:ascii")).toBe("string");
  });

  it("the Tt disjoint face consumes the repaired domains without false proofs", () => {
    const NO = { $tag: "Nothing" };
    const JT = { $tag: "Just", _0: true };
    expect(dispatchedDisjointType({ $ref: "str:ascii" }, { $ref: "String" })).toEqual(NO);
    expect(dispatchedDisjointType({ $ref: "str:ascii" }, { $ref: "Number" })).toEqual(JT);
    // char:ascii contains both 65 and "A", so neither scalar domain is disjoint.
    expect(dispatchedDisjointType({ $ref: "char:ascii" }, { $ref: "Number" })).toEqual(NO);
    expect(dispatchedDisjointType({ $ref: "char:ascii" }, { $ref: "String" })).toEqual(NO);
  });
});
