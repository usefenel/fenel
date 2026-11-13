// Display/transport glue: how a surface holds a navigation, given the
// router's `useBeforeLeave` event. What is pending stays with the caller;
// this only sequences the router's and the browser's history calls.
import type { BeforeLeaveEventArgs } from "@solidjs/router";

export type LeaveGuardHost = {
  location: { pathname: string; search: string; hash: string };
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
};

/**
 * Lets a navigation through untouched when nothing is pending; otherwise
 * holds it, asks `prepare`, and retries it when `prepare` answers true.
 *
 * Back/Forward (`to` is a history delta) needs care: the router undoes the
 * traversal with `history.go(-delta)` as soon as the guard returns, and a
 * browser drops a second `history.go` issued while that undo is pending. A
 * retry issued at once was lost, and the router's one-shot "skip the guard"
 * flag stayed set, so every second Back did nothing (Nov 12). The retry
 * therefore waits for the undo to land (its popstate, or `settleMs` when no
 * popstate comes) and only runs from the page the visitor left: never after
 * they moved on meanwhile.
 */
export function guardLeave(event: BeforeLeaveEventArgs, guard: {
  /** Synchronous: nothing to save or ask, so `prepare` would answer true at once. */
  idle: () => boolean;
  /** Saves or refuses (and says why); true lets the navigation go on. */
  prepare: () => Promise<boolean>;
}, host: LeaveGuardHost = window as unknown as LeaveGuardHost, settleMs = 3000): void {
  if (guard.idle()) return;
  event.preventDefault();
  if (typeof event.to !== "number") {
    void (async () => { if (await guard.prepare()) event.retry(true); })();
    return;
  }
  // The router has not yet published the traversal: `from` is still the page left.
  const origin = event.from.pathname + event.from.search + event.from.hash;
  const undone = new Promise<void>(resolve => {
    // Added during the traversal's own popstate dispatch: it hears the next one, the undo.
    const landed = () => { host.removeEventListener("popstate", landed); host.clearTimeout(timer); resolve(); };
    const timer = host.setTimeout(landed, settleMs);
    host.addEventListener("popstate", landed);
  });
  void (async () => {
    const leave = await guard.prepare();
    await undone;
    const here = host.location.pathname + host.location.search + host.location.hash;
    if (leave && here === origin) event.retry(true);
  })();
}
