// Migration shim for Solid 1's `createResource`, which Solid 2 removed.
//
// Solid 2's model is: async lives in the graph (a `createMemo` may return a
// promise), first-load readiness is owned by a `<Loading>` boundary, and errors
// flow to an `<Errored>` boundary. That is the right destination — but nine call
// sites in this app render their loading and error affordances INLINE (a
// "Loading…" row inside a picker, an undecided-realm guard in the field-occurrence
// editor, a per-panel error banner). Converting those to boundaries suspends or
// unmounts a whole subtree instead, which is a UX redesign, not a port.
//
// So this shim reproduces `createResource`'s three-state read on top of Solid 2
// primitives only:
//
//   * `createMemo(..., { loadingValue })` — commit #0. The memo is born with a
//     settled placeholder, so the FIRST flight suspends nothing and holds no
//     transition. That is exactly the old "render now, `.loading` is true".
//   * `isPending(...)` — true while a LATER change is in flight (the first
//     flight is covered by the placeholder, where `isPending` stays false).
//   * `refresh(...)` — the replacement for `refetch()`.
//
// Errors are caught into the state rather than thrown, again to keep the inline
// branch. A site that genuinely wants boundary semantics should drop this shim
// and return the promise from a plain `createMemo`.
//
// Follow-up (workstreams/solid-2-migration): revisit each consumer and decide
// per site whether the inline affordance or a `<Loading>` / `<Errored>` boundary
// is the better UX. That is a design decision, not a mechanical one.

import { createMemo, createSignal, isPending, refresh, type Accessor } from "solid-js";

type AsyncState<T> =
  /** The source is falsy: `createResource` never calls the fetcher for that. */
  | { readonly status: "idle" }
  /** Commit #0 — replaced as soon as the first real answer lands. */
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "failed"; readonly error: unknown };

export type AsyncValue<T> = Accessor<T | undefined> & {
  /** True during the first flight and during any later in-flight change. */
  readonly loading: boolean;
  /** The rejection value, or `undefined` when the last read settled. */
  readonly error: unknown;
  /** Re-run the fetcher and wait until its result is committed. */
  refetch(): Promise<void>;
};

const LOADING: AsyncState<never> = { status: "loading" };

export type AsyncValueOptions = {
  /** `false`: every flight is born with its own loading placeholder, so a
   * later change never holds a Solid transition (see `createFlightValue`). */
  readonly holdTransitions?: boolean;
};

export function createAsyncValue<S, T>(
  source: Accessor<S | false | null | undefined>,
  fetcher: (value: S) => T | Promise<T>,
  options: AsyncValueOptions = {},
): AsyncValue<T> {
  const [refreshing, setRefreshing] = createSignal(0);
  if (options.holdTransitions === false) return createFlightValue(source, fetcher, refreshing, setRefreshing);
  const state = createMemo<AsyncState<T>>(
    () => {
      const input = source();
      if (input === false || input === null || input === undefined) {
        return { status: "idle" };
      }
      try {
        // Invoke in compute so synchronous reactive reads inside the fetcher
        // remain dependencies. Deferring the invocation to `.then` loses them.
        return Promise.resolve(fetcher(input as S)).then<AsyncState<T>, AsyncState<T>>(
          (value) => ({ status: "ready", value }),
          (error) => ({ status: "failed", error }),
        );
      } catch (error) {
        return { status: "failed", error };
      }
    },
    { loadingValue: LOADING },
  );

  const read = (() => {
    const current = state();
    return current.status === "ready" ? current.value : undefined;
  }) as AsyncValue<T>;

  Object.defineProperties(read, {
    loading: {
      get: () => refreshing() > 0 || state().status === "loading" || isPending(state),
    },
    error: {
      get: () => {
        const current = state();
        return current.status === "failed" ? current.error : undefined;
      },
    },
    refetch: {
      value: async () => {
        // Bare refresh is deliberately silent to isPending. Track manual
        // requests independently, including overlapping refreshes.
        setRefreshing((count) => count + 1);
        try {
          await refresh(state);
        } finally {
          setRefreshing((count) => count - 1);
        }
      },
    },
  });

  return read;
}

type Flight<T> = { readonly state: Accessor<AsyncState<T>>; readonly answer: () => Promise<unknown> };
const IDLE: AsyncState<never> = { status: "idle" };
const IDLE_FLIGHT: Flight<never> = { state: () => IDLE, answer: () => Promise.resolve() };

/** The non-holding read (`holdTransitions: false`). A later change does not
 * re-run one async memo (which Solid 2 holds in a transition until every
 * entangled answer commits); it starts a FRESH memo born with the loading
 * placeholder, whose answer is its first commit and holds nothing. While a
 * flight runs, the last settled answer stays readable and `loading` is true,
 * as in the holding read. Why: a field plan nested in a record editor (a
 * CalendarDate part, demo 1, 2026-11-08) re-plans on every sibling edit; with
 * held flights Solid rc.7 parked one such transition for good after every
 * worker answer had landed, and the parts stayed "Preparing" with blocked
 * inputs. A Local field plan is per field and needs no cross-field commit. */
function createFlightValue<S, T>(source: Accessor<S | false | null | undefined>, fetcher: (value: S) => T | Promise<T>,
  refreshing: Accessor<number>, setRefreshing: (update: (count: number) => number) => unknown): AsyncValue<T> {
  const [retries, setRetries] = createSignal(0);
  let settled: AsyncState<T> = IDLE;
  const flight = createMemo<Flight<T>>(() => {
    const input = source();
    retries();
    if (input === false || input === null || input === undefined) return IDLE_FLIGHT;
    let answer: Promise<unknown> = Promise.resolve();
    const state = createMemo<AsyncState<T>>(() => {
      try {
        // Invoked in compute, as in the holding read: synchronous reactive
        // reads inside the fetcher stay this flight's dependencies.
        const pending = Promise.resolve(fetcher(input as S)).then<AsyncState<T>, AsyncState<T>>(
          (value) => ({ status: "ready", value }),
          (error) => ({ status: "failed", error }),
        );
        answer = pending;
        return pending;
      } catch (error) {
        return { status: "failed", error };
      }
    }, { loadingValue: LOADING });
    return { state, answer: () => answer };
  });
  const current = (): AsyncState<T> => {
    const state = flight().state();
    if (state.status !== "loading") settled = state;
    return state;
  };
  const shown = (): AsyncState<T> => { const state = current(); return state.status === "loading" ? settled : state; };
  const read = (() => {
    const state = shown();
    return state.status === "ready" ? state.value : undefined;
  }) as AsyncValue<T>;
  Object.defineProperties(read, {
    loading: { get: () => refreshing() > 0 || current().status === "loading" || isPending(current) },
    error: { get: () => { const state = shown(); return state.status === "failed" ? state.error : undefined; } },
    refetch: {
      value: async () => {
        setRefreshing((count) => count + 1);
        try {
          const before = flight();
          setRetries((count) => count + 1);
          let next = before;
          for (let tick = 0; tick < 100 && next === before; tick++) { await Promise.resolve(); next = flight(); }
          // The newest flight answers: a later retry or source change replaces it.
          for (;;) {
            next.state();
            await next.answer();
            await Promise.resolve();
            const latestFlight = flight();
            if (latestFlight === next) break;
            next = latestFlight;
          }
        } finally {
          setRefreshing((count) => count - 1);
        }
      },
    },
  });
  return read;
}
