// unified-static-analysis Phase 2 — conformance + PARITY tests for the
// assignability port (D-A). Brief:
// `workstreams/unified-static-analysis/briefs/phase-2-inference-unification-spike.md`.
//
// Two stages under test:
//   1. `engine:checkAssignable` — the Fenel GRADER over canonical SetExpr
//      values (a kernel Bool fact + the exact normalized gap + source/target ⇒
//      a ProofResult marker), plus the `engine:canAnalyze` predicate.
//   2. `checkAssignable` (fenel-check.ts) — the full thin delegate: marshal +
//      pre-compute (the kernel `PropSubset` round-trip + normalized gap) +
//      dispatch + map back. Asserted BYTE-EQUAL to a TS ORACLE reimplementing
//      the pre-port logic over a representative corpus — the port is a faithful
//      refactor (TS decision logic retired, Fenel grades), routed through the
//      kernel (part B).

import { describe, it, expect } from "vitest";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { checkAssignable, type ProofResult } from "./fenel-check";
import { isSubset, normalize, isJustTrue } from "./set-algebra";
import { Just, Nothing } from "./type-foundation";
import type { SetExpr } from "./types";
import { peelSetExpr } from "./set-marker";

// --- interval builder (the real Maybe-bound shape isSubset/normalize want) ---
const ivl = (lo: number | null, hi: number | null, loInc = true, hiInc = true): SetExpr => ({ $tag: "SeInterval", interval: {
    lo: lo === null ? Nothing : Just({ value: lo, inclusive: loInc }),
    hi: hi === null ? Nothing : Just({ value: hi, inclusive: hiInc }),
  } });

// ---------------------------------------------------------------------------
// Stage 1 — the Fenel grader + canAnalyze (over canonical SetExpr directly)
// ---------------------------------------------------------------------------

const grade = (subsetProven: boolean, gap: SetExpr, source: SetExpr, target: SetExpr) =>
  dispatchEngineBody("engine:checkAssignable", [subsetProven, gap, source, target]) as {
    ok: boolean;
    confidence: string;
  };

const can = (m: unknown) => dispatchEngineBody("engine:canAnalyze", [m]) as boolean;

describe("engine:checkAssignable — the Fenel grader (canonical SetExpr in)", () => {
  const leaf: SetExpr = { $tag: "SeEnum", values: [1] };
  const opaque: SetExpr = { $tag: "SeWhere", pred: { ">": [{ var: "value" }, 0] } };
  const emptyGap: SetExpr = { $tag: "SeNone" };
  const nonEmptyGap: SetExpr = { $tag: "SeEnum", values: [1] };

  it("subsetProven ⇒ proven (regardless of gap / analyzability)", () => {
    expect(grade(true, nonEmptyGap, opaque, opaque)).toEqual({ ok: true, confidence: "proven" });
  });

  it("SeNone gap ⇒ proven (the conservative second chance)", () => {
    expect(grade(false, emptyGap, leaf, leaf)).toEqual({ ok: true, confidence: "proven" });
  });

  it("gap exists, both sides analyzable ⇒ forward", () => {
    expect(grade(false, nonEmptyGap, leaf, leaf)).toEqual({ ok: false, confidence: "forward" });
  });

  it("gap exists, one side opaque ⇒ unknown", () => {
    expect(grade(false, nonEmptyGap, leaf, opaque)).toEqual({ ok: false, confidence: "unknown" });
    expect(grade(false, nonEmptyGap, opaque, leaf)).toEqual({ ok: false, confidence: "unknown" });
  });
});

describe("engine:canAnalyze — the canonical SetExpr predicate", () => {
  it("all / none / leaf ⇒ True", () => {
    expect(can({ $tag: "SeAll" })).toBe(true);
    expect(can({ $tag: "SeNone" })).toBe(true);
    expect(can({ $tag: "SeEnum", values: [1] })).toBe(true);
  });

  it("opaque ⇒ False", () => {
    expect(can({ $tag: "SeWhere", pred: { var: "value" } })).toBe(false);
  });

  it("union/intersect ⇒ every branch analyzable (empty ⇒ True)", () => {
    expect(can({ $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1] }, { $tag: "SeAll" }] })).toBe(true);
    expect(can({ $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1] }, { $tag: "SeWhere", pred: { var: "value" } }] })).toBe(false);
    expect(can({ $tag: "SeIntersect", branches: [] })).toBe(true);
  });

  it("diff ⇒ both sides analyzable", () => {
    expect(can({ $tag: "SeDiff", left: { $tag: "SeEnum", values: [1] }, right: { $tag: "SeEnum", values: [2] } })).toBe(true);
    expect(can({ $tag: "SeDiff", left: { $tag: "SeEnum", values: [1] }, right: { $tag: "SeWhere", pred: { var: "value" } } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stage 2 — PARITY: the full `checkAssignable` BYTE-EQUALS the pre-port oracle
// ---------------------------------------------------------------------------

// The pre-port TS logic, reproduced verbatim as the parity oracle.
function oracleCanAnalyze(set: SetExpr): boolean {
  const view = peelSetExpr(set);
  if (view?.kind === "SeAll" || view?.kind === "SeNone") return true;
  if (view?.kind === "SeInterval" || view?.kind === "SeEnum" || view?.kind === "SeRef") return true;
  if (view?.kind === "SeUnion" || view?.kind === "SeIntersect") return view.branches.every(oracleCanAnalyze);
  if (view?.kind === "SeDiff") return oracleCanAnalyze(view.left) && oracleCanAnalyze(view.right);
  return false;
}
function oracleCheckAssignable(source: SetExpr, target: SetExpr): ProofResult {
  if (isJustTrue(isSubset(source, target))) return { ok: true, confidence: "proven" };
  const gap = normalize({ $tag: "SeDiff", left: source, right: target });
  if (peelSetExpr(gap)?.kind === "SeNone") return { ok: true, confidence: "proven" };
  const confidence =
    oracleCanAnalyze(source) && oracleCanAnalyze(target) ? "forward" : "unknown";
  return { ok: false, gap, confidence };
}

// A representative corpus spanning every confidence arm + every SetExpr shape
// canAnalyze distinguishes.
const S = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs });
const C = (inner: SetExpr): SetExpr => ({ $tag: "SeComplement", inner });
const W: SetExpr = { $tag: "SeWhere", pred: { ">": [{ var: "value" }, 0] } };

const CORPUS: Array<[string, SetExpr, SetExpr]> = [
  ["identical enums", S(1, 2, 3), S(1, 2, 3)],
  ["enum ⊆ enum (proper)", S(1, 2), S(1, 2, 3)],
  ["enum ⊅ enum (proper superset)", S(1, 2, 3), S(1, 2)],
  ["disjoint enums", S(1, 2), S(8, 9)],
  ["enum ⊆ $all", S(1, 2), { $tag: "SeAll" }],
  ["$none ⊆ enum", { $tag: "SeNone" }, S(1, 2)],
  ["interval ⊆ interval", ivl(2, 5), ivl(0, 10)],
  ["interval ⊄ interval", ivl(0, 10), ivl(2, 5)],
  ["interval vs enum", ivl(0, 10), S(1, 2)],
  ["ref vs ref", { $tag: "SeRef", handle: "ℤ" }, { $tag: "SeRef", handle: "String" }],
  ["enum vs $where (opaque target ⇒ unknown)", S(1, 2), W],
  ["$where vs enum (opaque source ⇒ unknown)", W, S(1, 2)],
  ["union source vs enum", { $tag: "SeUnion", branches: [S(1), S(2)] }, S(1, 2, 3)],
  ["enum vs union target", S(1, 5), { $tag: "SeUnion", branches: [S(1), S(2)] }],
  ["union-with-opaque-branch vs enum", { $tag: "SeUnion", branches: [S(1), W] }, S(1, 2)],
  ["intersect vs enum", { $tag: "SeIntersect", branches: [S(1, 2, 3), S(2, 3, 4)] }, S(2, 3)],
  ["diff vs enum", { $tag: "SeDiff", left: S(1, 2, 3), right: S(3) }, S(1, 2)],
  ["all vs enum", { $tag: "SeAll" }, S(1, 2)],
  ["complement theorem (proven independently of marker opacity)", C(S(1, 2)), C(S(1))],
  ["complement false polarity keeps confidence unknown", C(S(1)), C(S(1, 2))],
];

describe("checkAssignable — BYTE-PARITY with the pre-port oracle over a corpus", () => {
  for (const [name, source, target] of CORPUS) {
    it(name, () => {
      expect(checkAssignable(source, target)).toEqual(oracleCheckAssignable(source, target));
    });
  }
});

describe("floor-kernel Phase 3c — explicit complement confidence decision", () => {
  it("keeps the marker opaque while allowing the containment theorem to prove true cases", () => {
    expect(can(C(S(1)))).toBe(false);
    expect(checkAssignable(C(S(1, 2)), C(S(1)))).toEqual({
      ok: true,
      confidence: "proven",
    });
    expect(checkAssignable(C(S(1)), C(S(1, 2)))).toMatchObject({
      ok: false,
      confidence: "unknown",
    });
  });
});
