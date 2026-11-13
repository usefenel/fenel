/** How long a write's display catch-up (a `refresh` of Home's root read) may
 * hold the action that made the write. The write itself is already committed
 * and acknowledged; past this wait the action completes and the display
 * follows when its read lands. */
export const DISPLAY_CATCH_UP_WAIT_MS = 10_000;

/** Waits for `pending` to settle, but never longer than `ms`. Resolves true
 * when it settled in time, false when the wait ran out (the work keeps
 * running; its later failure is not reported here). A rejection within the
 * wait is rethrown, as an `await pending` would. */
export function settleWithin(pending: PromiseLike<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, ms);
    Promise.resolve(pending).then(
      () => { if (!done) { done = true; clearTimeout(timer); resolve(true); } },
      (error) => { if (!done) { done = true; clearTimeout(timer); reject(error); } },
    );
  });
}
