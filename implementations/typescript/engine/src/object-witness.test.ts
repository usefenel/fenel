// ---------------------------------------------------------------------------
// object-witness.test.ts — decide-substrate Phase 3 Step D (Rom-green-lit
// 2026-07-03): the enum-trio element-equality upgrade shallow `std eq` →
// STRUCTURAL `deepEqValue`, completing the kernel's witness rule for OBJECT
// witnesses.
//
// The BEFORE state (captured by the pre-edit differential probe) was not just
// incomplete — it was UNSOUND on object-element enums: shallow `eq` is
// reference-shallow on records/arrays, so structurally-equal but
// distinct-reference elements (exactly what a marshal round-trip produces)
// gave WRONG proven answers:
//   contains(E[row], rowCopy)          = Just false   (a lie — it IS a member)
//   subset(E[rowCopy] ⊆ E[row, other]) = Just false   (a lie)
//   disjoint(E[rowCopy], E[row])       = Just true    (a lie — they share it)
//   kernel witness(objRowCopy)         = Err WitnessRejected (valid witness
//                                        actively rejected, not undecided)
// and `set:witnessSound` held only by same-reference aliasing (inhabit returns
// the head BY REFERENCE). After the upgrade every flip is the intended
// object-eq gain; scalars are byte-identical BY CONSTRUCTION (deepEqValue
// bottoms out in the same std `eq` for Number/String/Bool/Char/null).
//
// This file LOCKS the completed behavior: the enum trio decides object
// elements structurally, the kernel's `{w} ⊆ s` witness-membership rule
// (verifyWitnessMembership, K3-wired) accepts a structurally-equal object
// witness — the certificate currency Phase-4 search emits — and enumerate
// dedupes object elements as ONE set element.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { contains, isSubset, isDisjoint } from "./set-algebra";
import { decidableSetProof } from "./prover";
import { verify } from "./kernel";
import { dispatchedEnumerateSet, dispatchEngineBody } from "./engine-bodies-dispatch";
import type { SetExpr } from "./types";

// Structurally-equal but DISTINCT-REFERENCE binding rows — the rel-solve
// `SeEnum`-of-binding-records shape (each call builds fresh objects, exactly
// what a marshalled witness looks like after a round-trip).
const row = () => [
  { name: "x", value: 1 },
  { name: "y", value: { $tag: "Just", _0: 5 } },
];
const other = () => [
  { name: "x", value: 2 },
  { name: "y", value: { $tag: "Nothing" } },
];
const E = (vs: unknown[]) => ({ $tag: "SeEnum", values: vs }) as unknown as SetExpr;
const jInhabited = (s: unknown) => ({ $tag: "JInhabited", _0: s }) as never;

describe("Step D — the enum trio decides OBJECT elements structurally (deepEqValue)", () => {
  it("contains: a structurally-equal distinct-reference row IS a member (was Just false)", () => {
    expect(contains(E([row(), other()]), row(), null)).toEqual({ $tag: "Just", _0: true });
  });

  it("contains: a structurally-DIFFERENT row is still out (Just false unchanged)", () => {
    expect(contains(E([row()]), other(), null)).toEqual({ $tag: "Just", _0: false });
  });

  it("subset: E[rowCopy] ⊆ E[row, other] decides Just true (was the Just-false lie)", () => {
    expect(isSubset(E([row()]), E([row(), other()]))).toEqual({ $tag: "Just", _0: true });
  });

  it("disjoint: enums sharing a structurally-equal row are NOT disjoint (was the Just-true lie)", () => {
    expect(isDisjoint(E([row()]), E([row()]))).toEqual({ $tag: "Just", _0: false });
  });

  it("disjoint: structurally-different object enums stay disjoint (Just true unchanged)", () => {
    expect(isDisjoint(E([row()]), E([other()]))).toEqual({ $tag: "Just", _0: true });
  });

  it("scalars are byte-identical (deepEqValue bottoms out in std eq)", () => {
    expect(contains(E([1, 2, 3]), 2, null)).toEqual({ $tag: "Just", _0: true });
    expect(contains(E([1, 2, 3]), 9, null)).toEqual({ $tag: "Just", _0: false });
    expect(isSubset(E([1]), E([1, 2]))).toEqual({ $tag: "Just", _0: true });
    expect(isDisjoint(E([1]), E([2]))).toEqual({ $tag: "Just", _0: true });
  });
});

describe("Step D — the kernel witness rule decides OBJECT witnesses (the Phase-4 certificate currency)", () => {
  it("a structurally-equal object witness proves JInhabited (was Err WitnessRejected)", () => {
    const claim = jInhabited(E([row(), other()]));
    const vr = verify(claim, decidableSetProof("witness", { left: row() }));
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect(vr._0.$tag).toBe("SolverChecked");
  });

  it("a structurally-DIFFERENT object witness is still rejected", () => {
    const claim = jInhabited(E([row()]));
    const vr = verify(claim, decidableSetProof("witness", { left: other() }));
    expect(vr.$tag).toBe("Err");
    if (vr.$tag === "Err") expect(vr._0.$tag).toBe("WitnessRejected");
  });

  it("witnessSound holds over an object-row enum WITHOUT reference aliasing (the copy re-check)", () => {
    // inhabit returns the head row; the harness's `decideSubset (SeEnum [w]) s`
    // must hold even when w is a structural COPY (the marshalled-witness
    // reality) — the pre-D harness passed only via same-reference luck.
    const w = dispatchEngineBody("engine:inhabit", [E([row(), other()])]) as {
      $tag: string;
      _0?: unknown;
    };
    expect(w.$tag).toBe("Just");
    expect(isSubset(E([JSON.parse(JSON.stringify(w._0))]), E([row(), other()]))).toEqual({
      $tag: "Just",
      _0: true,
    });
  });
});

describe("Step D — enumerate dedupes object elements structurally (set semantics)", () => {
  it("structurally-duplicate rows collapse to ONE set element", () => {
    const r = dispatchedEnumerateSet(E([row(), row(), other()])) as {
      $tag: string;
      _0?: unknown[];
    };
    expect(r.$tag).toBe("Just");
    expect(r._0!.length).toBe(2);
  });

  it("exact enum-intersection now matches object elements", () => {
    const iv = {
      $tag: "SeIntersect",
      branches: [E([row(), other()]), E([row()])],
    } as unknown as SetExpr;
    const r = dispatchedEnumerateSet(iv) as { $tag: string; _0?: unknown[] };
    expect(r.$tag).toBe("Just");
    expect(r._0!.length).toBe(1);
  });
});
