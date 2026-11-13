// ---------------------------------------------------------------------------
// set-algebra-to-fenel Phase 2c — differential harness for the Fenel
// `setAlgebraNormalize` body.
//
// Runs `dispatchedNormalize` (the new Fenel-bodied path, via the NormSetExpr
// marshaller + the `set:norm*` re-entry natives) against the live TS
// `normalize` oracle over a broad SetExpr corpus, asserting deep-equality.
// This is the gate the brief mandates GREEN before the B4 shim flip — the
// Fenel body is dormant (the `normalize` export still points at the TS body)
// until that flip, so this harness is what proves the port byte-for-byte.
//
// Corpus covers every arm: $enum (incl. empty), $interval, $ref / $ref
// (incl. the `multiple:N` mint), $pattern, $where (extractable + opaque),
// $union (nested / interval-merge / enum-dedup / drop-covered), $intersect
// (disjoint / overlap / DNF / interval∩ / value-only filter / named dedup /
// pairwise-disjoint / superset-minimize), $complement (¬⊤ / ¬∅ / ¬¬ / ¬x),
// $diff (all sub-rules + interval splay).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { normalize } from "./set-algebra";
import { dispatchedNormalize } from "./engine-bodies-dispatch";
import { Just } from "./type-foundation";
import { regexStringToPattern } from "./regex-shim";
import type { SetExpr } from "./types";

import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a) — bun's 5 s per-test default is wrong for this file: it
// drives the INTERPRETED Fenel deciders, and on a slow Windows host individual
// assertions measured 5-75 s BEFORE this phase and after it (verdicts identical
// either side). A suite that reports clock as failure is a gate nobody can read,
// which is how a real red in the sibling tcb-recheck suite went unnoticed. Raise
// the budget; never weaken an assertion to fit it.
setDefaultTimeout(300_000);

const pat = (p: string): SetExpr => {
  const parsed = regexStringToPattern(p);
  if (!parsed) throw new Error(`pat: invalid regex /${p}/`);
  return { $tag: "SePattern", pattern: parsed };
};

const iv = (lo: number | null, hi: number | null, loInc = true, hiInc = true): SetExpr => ({ $tag: "SeInterval", interval: {
    lo: lo === null ? { $tag: "Nothing" } : Just({ value: lo, inclusive: loInc }),
    hi: hi === null ? { $tag: "Nothing" } : Just({ value: hi, inclusive: hiInc }),
  } });

const corpus: SetExpr[] = [
  // leaves
  { $tag: "SeAll" },
  { $tag: "SeNone" },
  { $tag: "SeEnum", values: [] },
  { $tag: "SeEnum", values: [1, 2, 3] },
  { $tag: "SeEnum", values: ["a", "b"] },
  { $tag: "SeRef", handle: "Nat" },
  { $tag: "SeRef", handle: "Int" },
  { $ref: "multiple:2" } as unknown as SetExpr,
  iv(0, 10),
  iv(null, 10),
  iv(0, null),
  iv(5, 0), // invalid interval
  pat("^[0-9]+$"),
  { $where: { "==": [{ "%": [{ var: "value" }, 2] }, 0] } } as unknown as SetExpr, // → $ref multiple:2
  { $where: { ">=": [{ var: "value" }, 5] } } as unknown as SetExpr, // extractable → interval
  { $where: { ">=": [{ var: "value" }, { var: "min" }] } } as unknown as SetExpr, // opaque (cross-field)

  // $complement
  { $tag: "SeComplement", inner: { $tag: "SeAll" } },
  { $tag: "SeComplement", inner: { $tag: "SeNone" } },
  { $tag: "SeComplement", inner: { $tag: "SeComplement", inner: { $tag: "SeEnum", values: [1, 2] } } },
  { $tag: "SeComplement", inner: { $tag: "SeEnum", values: [1, 2, 3] } },

  // $union
  { $tag: "SeUnion", branches: [{ $tag: "SeNone" }, { $tag: "SeEnum", values: [1, 2] }] },
  { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeAll" }] },
  { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [2, 3] }] },
  { $tag: "SeUnion", branches: [iv(0, 5), iv(4, 10)] }, // overlapping intervals merge
  { $tag: "SeUnion", branches: [iv(0, 5), iv(20, 30)] }, // disjoint intervals stay
  { $tag: "SeUnion", branches: [{ $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1] }, { $tag: "SeEnum", values: [2] }] }, { $tag: "SeEnum", values: [3] }] }, // nested flatten
  { $tag: "SeUnion", branches: [iv(0, 10), { $tag: "SeEnum", values: [5, 15] }] }, // 5 covered by interval, 15 not
  { $tag: "SeUnion", branches: [{ $tag: "SeNone" }] }, // collapse to none
  { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [7] }] }, // singleton collapse

  // $intersect
  { $tag: "SeIntersect", branches: [{ $tag: "SeAll" }, { $tag: "SeEnum", values: [1, 2] }] },
  { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeNone" }] },
  { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [3, 4] }] }, // disjoint → none
  { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [1, 2, 3] }, { $tag: "SeEnum", values: [2, 3, 4] }] }, // overlap
  { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [50, 25, 250] }, iv(0, 100)] }, // enum filtered by interval
  { $tag: "SeIntersect", branches: [iv(0, 100), iv(50, 200)] }, // interval intersect
  { $tag: "SeIntersect", branches: [iv(0, 10), iv(50, 60)] }, // disjoint intervals → none
  { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "Nat" }, { $tag: "SeRef", handle: "Int" }] }, // superset minimize (Nat ⊆ Int)
  { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "Nat" }, { $tag: "SeRef", handle: "Nat" }] }, // dedup named
  { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: ["abc", "123", "456"] }, pat("^[0-9]+$")] }, // enum filtered by pattern
  { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [1, 2, 3] }, { $tag: "SeWhere", pred: { ">=": [{ var: "value" }, { var: "min" }] } } as unknown as SetExpr] }, // opaque preserved
  { $tag: "SeIntersect", branches: [{ $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [3, 4] }] }, { $tag: "SeEnum", values: [2, 3] }] }, // DNF distribute
  { $tag: "SeIntersect", branches: [{ $tag: "SeAll" }, { $tag: "SeAll" }] }, // collapse to all

  // $diff
  { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3] }, right: { $tag: "SeEnum", values: [2, 4] } },
  { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3] }, right: { $tag: "SeEnum", values: [4, 5] } }, // no overlap → a
  { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1] }, right: { $tag: "SeEnum", values: [1, 2] } }, // → none
  { $tag: "SeDiff", left: { $tag: "SeNone" }, right: { $tag: "SeEnum", values: [1] } }, // ∅ \ _ → none
  { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1] }, right: { $tag: "SeNone" } }, // a \ ∅ → a
  { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1] }, right: { $tag: "SeAll" } }, // a \ ⊤ → none
  { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2] }, right: { $tag: "SeEnum", values: [1, 2] } }, // a \ a → none
  { $tag: "SeDiff", left: iv(0, 100), right: { $tag: "SeEnum", values: [42] } }, // interval splay
  { $tag: "SeDiff", left: iv(0, 100), right: { $tag: "SeEnum", values: [30, 60] } }, // interval splay multi
  { $tag: "SeDiff", left: iv(0, 100), right: iv(40, 60) }, // interval \ interval
  { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3] }, right: { $tag: "SeComplement", inner: { $tag: "SeEnum", values: [2] } } }, // a \ ¬c = a ∩ c
  { $tag: "SeDiff", left: { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [3, 4] }] }, right: { $tag: "SeEnum", values: [2] } }, // left union distribute
  { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3, 4] }, right: { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [2] }, { $tag: "SeEnum", values: [4] }] } }, // a \ (b1 ∪ b2)
  { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3] }, right: { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [2, 3] }, { $tag: "SeEnum", values: [3, 4] }] } }, // a \ (b1 ∩ b2)

  // extra coverage — strings, multiple:N fidelity, deeper nesting, value-only diff
  { $tag: "SeEnum", values: ["123", "456"] },
  { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: ["abc", "123", "456"] }, pat("^[0-9]+$")] },
  { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: ["not-an-email"] }, { $tag: "SeRef", handle: "format:email" }] },
  { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: ["a@b.com", "not-email"] }, { $tag: "SeRef", handle: "format:email" }] },
  { $where: { "===": [{ "%": [{ var: "value" }, 5] }, 0] } } as unknown as SetExpr, // → multiple:5
  { $where: { "==": [0, { "%": [{ var: "value" }, 3] }] } } as unknown as SetExpr, // → multiple:3
  { $tag: "SeUnion", branches: [{ $tag: "SeWhere", pred: { "==": [{ "%": [{ var: "value" }, 2] }, 0] } } as unknown as SetExpr, { $tag: "SeEnum", values: [1, 3] }] },
  { $tag: "SeIntersect", branches: [{ $tag: "SeWhere", pred: { "==": [{ "%": [{ var: "value" }, 2] }, 0] } } as unknown as SetExpr, { $tag: "SeEnum", values: [2, 3, 4] }] },
  { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3, 4] }, right: { $tag: "SeWhere", pred: { "==": [{ "%": [{ var: "value" }, 2] }, 0] } } as unknown as SetExpr }, // enum \ value-only
  { $tag: "SeComplement", inner: { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1] }, { $tag: "SeEnum", values: [2] }] } },
  { $tag: "SeUnion", branches: [iv(null, 5), iv(3, null)] }, // unbounded merge → all
  { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "Nat" }, { $tag: "SeRef", handle: "Int" }, { $tag: "SeRef", handle: "Real" }] }, // chain minimize
  { $tag: "SeIntersect", branches: [{ $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [1, 2, 3] }, { $tag: "SeEnum", values: [2, 3] }] }, { $tag: "SeEnum", values: [3, 4] }] }, // nested intersect
  { $tag: "SeUnion", branches: [{ $tag: "SeUnion", branches: [iv(0, 5), { $tag: "SeEnum", values: [10] }] }, { $tag: "SeUnion", branches: [iv(4, 8), { $tag: "SeEnum", values: [5] }] }] }, // deep union merge
  { $tag: "SeDiff", left: iv(0, 100), right: { $tag: "SeEnum", values: [30, 60, 90] } },
  { $tag: "SeDiff", left: { $tag: "SeEnum", values: ["a", "b", "c"] }, right: { $tag: "SeEnum", values: ["b"] } },
  { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [1, 2, 3] }, pat("^[0-9]+$"), { $tag: "SeEnum", values: [2, 3, 4] }] },
];

describe("set-algebra-to-fenel Phase 2c — dispatchedNormalize ≡ normalize (differential)", () => {
  for (let i = 0; i < corpus.length; i++) {
    const set = corpus[i]!;
    it(`corpus[${i}] = ${JSON.stringify(set).slice(0, 80)}`, () => {
      const tsResult = normalize(set);
      const fenelResult = dispatchedNormalize(set);
      expect(fenelResult).toEqual(tsResult);
    });
  }
});

// ---------------------------------------------------------------------------
// decide-substrate (normalize enum-filter honesty) — UNDECIDED membership no
// longer shrinks (∩) or grows (\) the set. An enum value whose membership in a
// value-only member is Nothing (e.g. an unknown registry name like ⟦Bot⟧) is
// KEPT and the compound structure is PRESERVED (denotation-preserving); only
// provably-out values drop. Known-name verdicts stay byte-identical (exact
// filters still collapse). The old behavior — normalize({1} ∩ ⟦Bot⟧) = SeNone,
// normalize({1} \ ⟦Bot⟧) = {1} — was flagged as the honesty-tail surprise.
// ---------------------------------------------------------------------------
describe("decide-substrate — normalize enum-filter honesty (undecided membership preserves structure)", () => {
  it("∩ unknown-named: normalize({1} ∩ ⟦Bot⟧) KEEPS the intersect (was the unsound SeNone shrink)", () => {
    const out = normalize({ $intersect: [{ $enum: [1] }, { $ref: "Bot" }] } as unknown as SetExpr);
    expect(out).toEqual({
      $tag: "SeIntersect",
      branches: [
        { $tag: "SeEnum", values: [1] },
        { $tag: "SeRef", handle: "Bot" },
      ],
    });
  });

  it("∩ known-named stays EXACT: normalize({1,-1} ∩ ⟦Nat⟧) = {1} (byte-identical to the pre-fix verdict)", () => {
    const out = normalize({ $intersect: [{ $enum: [1, -1] }, { $ref: "Nat" }] } as unknown as SetExpr);
    expect(out).toEqual({ $tag: "SeEnum", values: [1] });
  });

  it("∩ provably-out still collapses: normalize({-1} ∩ ⟦Nat⟧) = ∅ (sound)", () => {
    const out = normalize({ $intersect: [{ $enum: [-1] }, { $ref: "Nat" }] } as unknown as SetExpr);
    expect(out).toEqual({ $tag: "SeNone" });
  });

  it("\ unknown-named: normalize({1} \ ⟦Bot⟧) KEEPS the diff (was the unsound SeEnum grow — claiming 1 ∉ Bot)", () => {
    const out = normalize({ $diff: [{ $enum: [1] }, { $ref: "Bot" }] } as unknown as SetExpr);
    expect(out).toEqual({
      $tag: "SeDiff",
      left: { $tag: "SeEnum", values: [1] },
      right: { $tag: "SeRef", handle: "Bot" },
    });
  });

  it("\ known-named stays EXACT: normalize({1,-1} \ ⟦Nat⟧) = {-1} (byte-identical)", () => {
    const out = normalize({ $diff: [{ $enum: [1, -1] }, { $ref: "Nat" }] } as unknown as SetExpr);
    expect(out).toEqual({ $tag: "SeEnum", values: [-1] });
  });

  it("idempotence: the kept intersect + kept diff both re-normalize to themselves", () => {
    const keptI = normalize({ $intersect: [{ $enum: [1] }, { $ref: "Bot" }] } as unknown as SetExpr);
    expect(normalize(keptI)).toEqual(keptI);
    const keptD = normalize({ $diff: [{ $enum: [1] }, { $ref: "Bot" }] } as unknown as SetExpr);
    expect(normalize(keptD)).toEqual(keptD);
  });
});
