// The Suggestions panel's settle rule (Rom, Nov 12: "Why are we showing
// something where it's still loading? It's very improper."): a suggestion row
// shows its final state or is not shown yet. A row is final when its computed
// preview is ready or unavailable, or when it has none to wait for (a row that
// needs inputs). Rows appear in their ranked order, never one below a gap.
// Past a patience (a preview the shared worker has not reached in time), every
// row shows, the late ones without their result and without a spinner.
// Display policy only: the ranking and the previews are computed elsewhere.

export type RowWait = "settled" | "waiting";

/** How long the panel waits for previews before showing every row. Previews
 * run one at a time at the lowest priority of the shared worker (several
 * seconds each on a loaded host); a stuck one is refused by the worker after
 * 180 s, so the patience only bounds how long it can hold the rows below it.
 * Short (imgsuggest, Nov 13): a pasted picture's first preview evaluates every
 * pixel and its preparation rechecks the whole picture, minutes on a loaded
 * host; the rows are already checked and clickable, so they show after this
 * and their results fill in as they arrive. A click never needs its preview. */
export const SUGGESTION_PATIENCE_MS = 3_000;

/** A ranked candidate as the rows' presentation reads it: without its recipe
 * expression. `view.suggestionPresentation` reads the identity, label, inputs,
 * reasons and verdict, never the recipe payload; a recipe holds the subject
 * data (a pasted picture: every pixel, once per row), which the page would
 * fingerprint and send to the worker for nothing (imgsuggest, Nov 13). */
export function presentationCandidate<C extends { plan: object }>(candidate: C): C {
  const { expression: _recipe, ...plan } = candidate.plan as { expression?: unknown };
  return { ...candidate, plan: plan as C["plan"] };
}

/** Which queued preview to compute next. Rows show before their previews and
 * previews run one at a time, so the order is what a reader sees first: rows
 * whose result reads as a picture of the data (a grouping as a mini calendar,
 * a count or sum per key as mini bars) before the others; ranked order within
 * each (minichart, Nov 13: in ranked order they came last, after every list
 * and number preview, and a take never saw them). */
export function nextPreviewIndex(queue: readonly { family?: string }[]): number {
  const pictured = queue.findIndex(job => job.family === "grouping" || job.family === "aggregate");
  return pictured < 0 ? 0 : pictured;
}

/** The number of leading rows to show. `shownBefore` keeps a row shown once it
 * was shown for the same list (a preview that restarts never hides it). */
export function settledRowCount(waits: readonly RowWait[], options: { patienceOver: boolean; shownBefore?: number }): number {
  if (options.patienceOver) return waits.length;
  const firstWaiting = waits.indexOf("waiting");
  const settled = firstWaiting < 0 ? waits.length : firstWaiting;
  return Math.min(waits.length, Math.max(settled, options.shownBefore ?? 0));
}
