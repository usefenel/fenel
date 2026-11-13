// ---------------------------------------------------------------------------
// identifier-search — the identifier half of Browse search, in steps.
//
// A type or signature query asks the subset decider about thousands of item
// types (seconds of decider work for `recipe` on the seed catalogue). The page
// has always searched its items universe in result windows of 250 items, one
// `search` call per window, and yielded between windows; a cold window still
// held the main thread for up to about 3 s. This runs the same windows one
// item per step, so the caller can yield between any two items: no
// synchronous stretch needs to be longer than its slowest single item.
//
// The results are the windows' results, unchanged: each window keeps exactly
// the answer its single `search` call gave (its best `MAX_RESULTS` by score,
// stably sorted, the whole window lost if one of its items throws), and the
// accumulated windows are sorted stably by score after each one closes.
//
// Page-state free: no signals, no registry, no clock. `search` makes every
// decision; this only decides how much of it runs per call.
// ---------------------------------------------------------------------------

import { MAX_RESULTS, search, type DataItem, type Match, type ParsedQuery } from "../data-search";

/** Items per result window: one `search` call's universe slice, as the page
 *  has always searched. A window keeps that call's capped answer. */
export const IDENTIFIER_WINDOW = 250;
/** Items per step: one, the smallest unit the matcher offers. Fewer items
 *  than the result cap per call, so a step never drops a match; a window's
 *  steps, stably sorted by score, are its single call's answer. */
export const IDENTIFIER_STEP = 1;
/** Rows Browse shows. */
export const IDENTIFIER_ROWS = 40;

/** One query over one universe, in steps. `windows` counts the closed result
 *  windows: `top` changes only when it does. */
export type IdentifierSearch = {
  readonly done: () => boolean;
  readonly step: () => void;
  readonly top: () => Match[];
  readonly windows: () => number;
};

const byScore = (a: Match, b: Match) => b.score - a.score;

export function createIdentifierSearch(items: readonly DataItem[], parsed: ParsedQuery): IdentifierSearch {
  const universe = items as DataItem[];
  const matches: Match[] = [];
  let index = 0, closed = 0;
  let window: Match[] = [];
  let failed = false;
  return Object.freeze({
    done: () => index >= items.length,
    step: () => {
      if (index >= items.length) return;
      const windowEnd = Math.min(items.length, (Math.floor(index / IDENTIFIER_WINDOW) + 1) * IDENTIFIER_WINDOW);
      const end = Math.min(windowEnd, index + IDENTIFIER_STEP);
      if (!failed) {
        try {
          // The whole universe goes along: it decides whether a bare name
          // denotes a type, and keys the matcher's per-query decision memo.
          window.push(...search(universe.slice(index, end), parsed, universe));
        } catch {
          // One bad item's type must not cost the rest of the universe its
          // search; it costs its window, as one search call over it did.
          failed = true;
        }
      }
      index = end;
      if (index < windowEnd) return;
      if (!failed) matches.push(...window.sort(byScore).slice(0, MAX_RESULTS));
      window = [];
      failed = false;
      closed++;
      matches.sort(byScore);
    },
    top: () => matches.slice(0, IDENTIFIER_ROWS),
    windows: () => closed,
  });
}
