import { describe, expect, test } from "bun:test";
import { SUGGESTION_PATIENCE_MS, nextPreviewIndex, presentationCandidate, settledRowCount, type RowWait } from "./suggestion-settle";

const patienceOverAfter = (elapsedMs: number) => elapsedMs >= SUGGESTION_PATIENCE_MS;

const S: RowWait = "settled", W: RowWait = "waiting";

// Rom, Nov 12: "Why are we showing something where it's still loading?" A row
// shows its final state or is not shown yet; rows appear top to bottom.
describe("which suggestion rows the panel shows", () => {
  test("only the leading rows whose result is final", () => {
    expect(settledRowCount([S, S, W, S], { patienceOver: false })).toBe(2);
    expect(settledRowCount([W, S, S], { patienceOver: false })).toBe(0);
    expect(settledRowCount([S, S, S], { patienceOver: false })).toBe(3);
    expect(settledRowCount([], { patienceOver: false })).toBe(0);
  });

  test("once the patience is over, every row shows (a late result is shown without a spinner)", () => {
    expect(settledRowCount([S, W, W], { patienceOver: true })).toBe(3);
  });

  // imgsuggest (Nov 13): a pasted picture's first preview (Invert colors over
  // every pixel) took minutes on a loaded host; the known, clickable rows must
  // not wait for it. Within a few seconds of the list, every row shows.
  test("a list whose first preview has not arrived is usable within 5 s", () => {
    expect(settledRowCount([W, W, S], { patienceOver: patienceOverAfter(5_000) })).toBe(3);
    expect(settledRowCount([W, W, S], { patienceOver: patienceOverAfter(500) })).toBe(0);
  });

  // imgsuggest (Nov 13): the rows' presentation (view.suggestionPresentation)
  // never reads a candidate's recipe; each recipe holds the whole picture.
  test("the rows' presentation input carries no recipe expression", () => {
    const pixels = Array.from({ length: 9216 }, () => ({ r: 1, g: 2, b: 3, a: 255 }));
    const candidate = { identity: "invert/argument:0", label: "Invert colors", missingArguments: 0,
      plan: { semanticPlan: { operation: "invert" }, expression: { kind: "call", args: [{ kind: "literal", value: { pixels } }] }, icon: "image" } };
    const shown = presentationCandidate(candidate);
    expect(shown.plan).toEqual({ semanticPlan: { operation: "invert" }, icon: "image" });
    expect(shown.identity).toBe("invert/argument:0");
    expect(shown.label).toBe("Invert colors");
    expect(candidate.plan.expression).toBeDefined();
  });

  // minichart (Nov 13): rows show before their previews; previews ran one at a
  // time in ranked order, so the grouped and counted rows (calendar, bars) came
  // last and a take never saw their pictures. They are computed first now.
  test("the calendar and chart rows' previews are computed first, each family in ranked order", () => {
    const queue = ["std", "std", "std", "grouping", "grouping", "aggregate", "aggregate"].map((family, rank) => ({ family, rank }));
    const order: number[] = [];
    while (queue.length) order.push(queue.splice(nextPreviewIndex(queue), 1)[0]!.rank);
    expect(order).toEqual([3, 4, 5, 6, 0, 1, 2]);
    expect(nextPreviewIndex([{ family: "std" }, { family: "projection" }])).toBe(0);
  });

  test("a row once shown stays shown for the same list", () => {
    expect(settledRowCount([S, W, W], { patienceOver: false, shownBefore: 2 })).toBe(2);
    expect(settledRowCount([S], { patienceOver: false, shownBefore: 3 })).toBe(1);
  });
});
