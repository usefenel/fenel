// fix-engine 2026-10-31: `view:suggestionSortWithEffort` (suggestions.fenel)
// sorts in stable scalar passes, and std `sort` treats keys `lt` cannot
// compare (NaN) as a tie. One NaN net relevance therefore left the other
// candidates partly unsorted. An infinite effort penalty made every
// zero-missing candidate's net relevance NaN (0 * Infinity). The Fenel
// source now gives no effort to a candidate without missing arguments (or
// under a zero penalty) and ranks a number pass's non-numbers (NaN) after
// every number, keeping the other entries sorted.
import { describe, expect, test } from "bun:test";
import { evaluate } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { pictureModule } from "./modules/picture";
import { viewModule } from "./modules/view";

const ctx = createRegistry([stdModule, pictureModule, viewModule]).evaluateContext();

type Row = { identity: string; relevance: number; missing?: number; cost?: number; confirmed?: boolean };
function candidate(row: Row) {
  return {
    $tag: "SuggestionCandidate", identity: row.identity, family: "f", label: row.identity, expression: row.identity,
    resultType: "Number", inputIndex: 0, missingArguments: row.missing ?? 0,
    applicability: { $tag: "Just", _0: row.confirmed ?? true }, relevance: row.relevance,
    compositionCost: row.cost ?? 0, pin: { $tag: "Nothing" }, lenses: [], reasons: [], plan: null,
  };
}
function order(penalty: number, rows: Row[]): string[] {
  const sorted = evaluate({ call: ["view:suggestionSortWithEffort", { var: "penalty" }, { var: "candidates" }] } as never,
    { penalty, candidates: rows.map(candidate) }, ctx) as Array<{ identity: string }>;
  return sorted.map((entry) => entry.identity);
}

describe("suggestion ranking is total over its numbers", () => {
  test("an infinite effort penalty ranks candidates without missing arguments by relevance", () => {
    const rows = [{ identity: "a", relevance: 1 }, { identity: "b", relevance: 5 }, { identity: "c", relevance: 3 }];
    expect(order(Number.POSITIVE_INFINITY, rows)).toEqual(["b", "c", "a"]);
    // Under an infinite penalty a candidate with missing arguments goes last.
    expect(order(Number.POSITIVE_INFINITY, [...rows, { identity: "d", relevance: 9, missing: 1 }]))
      .toEqual(["b", "c", "a", "d"]);
    // A finite penalty is unchanged: relevance minus missing * penalty.
    expect(order(12, [...rows, { identity: "d", relevance: 20, missing: 1 }])).toEqual(["d", "b", "c", "a"]);
    expect(order(0, [...rows, { identity: "d", relevance: 4, missing: 3 }])).toEqual(["b", "d", "c", "a"]);
  });

  test("one undefined net relevance ranks last and leaves the others sorted", () => {
    // Infinity - Infinity: an infinitely relevant candidate under an infinite penalty.
    const rows = [{ identity: "a", relevance: 2 }, { identity: "b", relevance: 7 },
      { identity: "x", relevance: Number.POSITIVE_INFINITY, missing: 1 }, { identity: "c", relevance: 4 }, { identity: "d", relevance: 9 }];
    expect(order(Number.POSITIVE_INFINITY, rows)).toEqual(["d", "b", "c", "a", "x"]);
    const withNaN = [{ identity: "a", relevance: 2 }, { identity: "n", relevance: Number.NaN },
      { identity: "b", relevance: 7 }, { identity: "c", relevance: 4 }];
    expect(order(12, withNaN)).toEqual(["b", "c", "a", "n"]);
    // A NaN cost likewise sorts after every number in its pass.
    expect(order(12, [{ identity: "p", relevance: 1, cost: Number.NaN }, { identity: "q", relevance: 1, cost: 3 },
      { identity: "r", relevance: 1, cost: 1 }])).toEqual(["r", "q", "p"]);
  });
});
