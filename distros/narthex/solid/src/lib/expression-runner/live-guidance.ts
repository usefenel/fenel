// B4 slice 2: "latest wins" scheduling of one editing surface's live guidance
// (inference, type judgments, evaluate-then-check pairs) in a Local reader's
// worker. Host transport plumbing only (the "Central reader worker transport"
// kind): no semantic rule lives here; the worker runs the existing code.
//
// - Nothing is sent before the surface is touched (no mount, no untouched draft).
// - Requests made in one animation frame are coalesced into one job.
// - At most one job runs and one waits per surface; a newer request replaces the
//   waiting one. A running job is never pre-empted (the worker cannot stop it);
//   its answers stay valid for the exact inputs they answered.
// - An answer counts only for the exact item fingerprint and capture (epoch,
//   reader revision, concrete session, worker snapshot, source metadata) it was
//   computed under. A stale answer is dropped and its items are asked again; a
//   failure is "checking" until the next edit asks again.
import { createContext, createEffect, createSignal } from "solid-js";
import { LIVE_INFERENCE_BATCH_LIMIT } from "./live-guidance-limits";

export type GuidanceFrame = (callback: () => void) => () => void;

const defaultFrame: GuidanceFrame = callback => {
  const host = globalThis as { requestAnimationFrame?: (callback: () => void) => number; cancelAnimationFrame?: (id: number) => void };
  if (host.requestAnimationFrame && host.cancelAnimationFrame) {
    const id = host.requestAnimationFrame(callback);
    return () => host.cancelAnimationFrame!(id);
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
};

export type GuidanceJob = (signal: AbortSignal) => Promise<void> | void;

/** One surface's scheduler: at most one job running and one waiting. */
export function createGuidanceLane(frame: GuidanceFrame = defaultFrame) {
  let requested: GuidanceJob | undefined;
  let cancelFrame: (() => void) | undefined;
  let waiting: GuidanceJob | undefined;
  let running: AbortController | undefined;
  let disposed = false;
  let sent = 0;
  function start(job: GuidanceJob) {
    const controller = new AbortController();
    running = controller;
    sent++;
    let done: Promise<void>;
    try { done = Promise.resolve(job(controller.signal)); }
    catch (error) { done = Promise.reject(error); }
    void done.catch(() => undefined).then(() => {
      if (running === controller) running = undefined;
      if (!running && waiting && !disposed) {
        const next = waiting;
        waiting = undefined;
        start(next);
      }
    });
  }
  function onFrame() {
    cancelFrame = undefined;
    const job = requested;
    requested = undefined;
    if (!job || disposed) return;
    if (running) waiting = job;
    else start(job);
  }
  return {
    /** Ask for guidance. Coalesced per frame; replaces a waiting job. */
    request(job: GuidanceJob) {
      if (disposed) return;
      requested = job;
      cancelFrame ??= frame(onFrame);
    },
    /** Save and dismissal: drop the waiting job and abort the running one. */
    cancel() {
      requested = undefined;
      cancelFrame?.();
      cancelFrame = undefined;
      waiting = undefined;
      running?.abort(new DOMException("Live guidance was cancelled.", "AbortError"));
      running = undefined;
    },
    dispose() { this.cancel(); disposed = true; },
    /** Diagnostics and tests: jobs started so far, and whether one waits. */
    get sent() { return sent; },
    get waiting() { return waiting !== undefined || requested !== undefined; },
    get running() { return running !== undefined; },
  };
}
export type GuidanceLane = ReturnType<typeof createGuidanceLane>;

/** The surface's live answers. `capture()` is read reactively; `undefined`
 * means no prepared worker (checking). `send` posts one request for up to
 * `batch` items and resolves with one answer per item. */
export function createLiveGuidance<Item, Answer, Capture>(options: {
  capture: () => Capture | undefined;
  sameCapture: (a: Capture, b: Capture) => boolean;
  /** Read after the reply: whether the capture still holds now. */
  current: (capture: Capture) => boolean;
  send: (items: readonly Item[], capture: Capture, signal: AbortSignal) => Promise<readonly Answer[]> | undefined;
  key: (item: Item) => string;
  batch?: number;
  frame?: GuidanceFrame;
  /** Opt-in diagnostics: post → reply of each answered request. */
  measured?: (milliseconds: number, items: number) => void;
  /** The object an item answers for (an editor node). An edit replaces the
   * edited node and its ancestors with new objects: items whose object was
   * never read before are the edited path, asked first in their own batch. */
  identity?: (item: Item) => object | undefined;
}) {
  const lane = createGuidanceLane(options.frame);
  const batch = Math.max(1, Math.min(options.batch ?? LIVE_INFERENCE_BATCH_LIMIT, LIVE_INFERENCE_BATCH_LIMIT));
  const answers = new Map<string, { capture: Capture; answer: Answer }>();
  const wanted = new Map<string, { item: Item; fresh: boolean }>();
  const seen = new WeakSet<object>();
  /** Items sent and not yet settled (B4 F2: `busy`). */
  let flying = 0;
  // Its own signal: settling a request never makes readers ask again.
  const [busyVersion, setBusyVersion] = createSignal(0);
  const settled = () => setBusyVersion(value => value + 1);
  const [version, setVersion] = createSignal(0);
  let touched = false;
  /** Edits so far: a partial reply re-queues its unanswered items only if no
   * edit came after its request (an older draft's items never go first). */
  let touches = 0;
  const bump = () => setVersion(value => value + 1);
  async function job(signal: AbortSignal) {
    const capture = options.capture();
    if (capture === undefined) { wanted.clear(); settled(); return; }
    // Items answered meanwhile (an earlier batch) are not asked again.
    for (const [key] of [...wanted]) {
      const known = answers.get(key);
      if (known && options.sameCapture(known.capture, capture)) wanted.delete(key);
    }
    // The edited path first, as its own batch; the rest follow.
    const fresh = [...wanted].filter(([, entry]) => entry.fresh);
    const entries = (fresh.length ? fresh : [...wanted]).slice(0, batch);
    if (!entries.length) { settled(); return; }
    for (const [key] of entries) wanted.delete(key);
    // Remaining items go in the next request, after this one.
    if (wanted.size) lane.request(job);
    const sentAfter = touches;
    const started = typeof performance === "undefined" ? 0 : performance.now();
    let replies: readonly Answer[];
    flying++;
    try {
      const flight = options.send(entries.map(([, entry]) => entry.item), capture, signal);
      if (!flight) return;
      replies = await flight;
    } catch { return; }
    finally { flying--; settled(); }
    if (signal.aborted) return;
    if (!options.current(capture) || replies.length > entries.length) {
      // Stale: drop, and let every reader of these items ask again.
      bump();
      return;
    }
    options.measured?.((typeof performance === "undefined" ? 0 : performance.now()) - started, replies.length);
    if (answers.size > 2048) answers.clear();
    entries.slice(0, replies.length).forEach(([key], index) => answers.set(key, { capture, answer: replies[index]! }));
    // A partial answer (the worker yielded to other work): keep what it
    // answered and ask only for the rest, ahead of anything newer.
    const unanswered = entries.slice(replies.length).filter(([key]) => !wanted.has(key));
    if (unanswered.length && touches === sentAfter) {
      const rest = [...wanted];
      wanted.clear();
      for (const [key, entry] of [...unanswered, ...rest]) wanted.set(key, entry);
      lane.request(job);
    }
    bump();
  }
  return {
    /** Read inside a memo: the current answer for exactly this item, or
     * `undefined` while checking. Asks for it once the surface is touched. */
    read(item: Item): Answer | undefined {
      version();
      const identity = options.identity?.(item);
      const fresh = identity !== undefined && !seen.has(identity);
      if (identity !== undefined) seen.add(identity);
      const capture = options.capture();
      if (capture === undefined) return undefined;
      const key = options.key(item);
      const known = answers.get(key);
      if (known && options.sameCapture(known.capture, capture)) return known.answer;
      if (!touched) return undefined;
      if (!wanted.has(key)) {
        wanted.set(key, { item, fresh });
        lane.request(job);
      }
      return undefined;
    },
    /** An edit: from now on readers ask, and every reader asks again. Items
     * wanted for the previous draft are replaced by what the readers of this
     * draft ask for (latest wins). */
    touch() {
      touched = true;
      touches++;
      wanted.clear();
      bump();
    },
    get touched() { return touched; },
    /** B4 F2 (display only): whether a request of this surface is waiting or
     * in flight. A failed, cancelled or never-sent request is not busy. */
    busy(): boolean {
      version(); busyVersion();
      return options.capture() !== undefined && (flying > 0 || wanted.size > 0 || lane.waiting);
    },
    /** Save cancels its surface's guidance first; dismissal disposes. */
    cancel() { wanted.clear(); lane.cancel(); settled(); },
    dispose() { wanted.clear(); lane.dispose(); },
    lane,
  };
}
/** B4 fix round 2: a draft check that cleared a value it will refill once
 * answered (a nested value). While one is pending, the Saves of its surface
 * refuse: they would persist the cleared slot. A check is held under its
 * editor's surface scope (`DraftCheckScopeContext`, set through an editor's
 * `draftCheckScope`), or, for an editor outside any scope, under its reader's
 * source (`draftCheckReaderKey`, the reader's client: the same for every
 * reader object of one source). */
const pendingDraftChecks = new WeakMap<object, Set<object>>();
export const DraftCheckScopeContext = createContext<object | null>(null);
export function draftCheckReaderKey(reader: { readonly client?: object } | undefined): object | undefined {
  return reader ? reader.client ?? reader : undefined;
}
/** A surface's Save: its own scope's checks, and any unscoped check of its
 * reader's source. Another surface's scoped check never blocks it. */
export function localDraftChecksPending(scope: object | undefined, reader: { readonly client?: object } | undefined): boolean {
  return draftChecksPending(scope) || draftChecksPending(draftCheckReaderKey(reader));
}
export function holdDraftCheck(owner: object | undefined, token: object): void {
  if (!owner) return;
  let held = pendingDraftChecks.get(owner);
  if (!held) pendingDraftChecks.set(owner, held = new Set());
  held.add(token);
}
export function releaseDraftCheck(owner: object | undefined, token: object): void {
  if (owner) pendingDraftChecks.get(owner)?.delete(token);
}
export function draftChecksPending(owner: object | undefined): boolean {
  return !!owner && (pendingDraftChecks.get(owner)?.size ?? 0) > 0;
}

/** Today's page showed a complete draft's guidance at open: ask once, at
 * open, when `complete()` first holds (an empty or incomplete draft asks
 * nothing). Later requests come from edits. Call inside the surface's owner. */
export function openLiveGuidance(guidance: { touch(): void; readonly touched: boolean } | undefined, complete: () => boolean) {
  if (!guidance) return;
  let opened = false;
  createEffect(() => !opened && complete(), ready => {
    if (!ready || opened) return;
    opened = true;
    if (!guidance.touched) guidance.touch();
  });
}

export type LiveGuidance<Item, Answer> = { read(item: Item): Answer | undefined; touch(): void; readonly touched: boolean; busy(): boolean;
  cancel(): void; dispose(): void; lane: GuidanceLane };
