// A2/B3 host transport extracted from authoring-catalog-worker.ts. Runtime
// imports must stay engine-free; the protocol is erased at this boundary.
import type { AuthoringStorageOutcome, AuthoringWorkerCommand, AuthoringWorkerMessage, AuthoringWorkerRequest, AuthoringWorkerResult } from "./authoring-worker-protocol";
import type { BrowserDataRecord } from "../browser-data-storage";

/** Closed host record envelope shared by load and durable receipt adapters.
 * The worker's Fenel storage policy owns admission of the ordinary data. */
export function isAuthoringStorageRecord(value: unknown): value is BrowserDataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as BrowserDataRecord;
  return typeof record.schema === "string" && Number.isSafeInteger(record.generation) && record.generation > 0
    && !!record.data && typeof record.data === "object" && !Array.isArray(record.data);
}

export class WorkerRequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}
type Pending = { resolve: (value: AuthoringWorkerResult) => void; reject: (error: unknown) => void; cleanup: () => void };
type JobLifetime = { method: AuthoringWorkerCommand["method"]; started: boolean; posted: boolean;
  initializationDeadline?: number; executionDeadline?: number; timeout?: ReturnType<typeof setTimeout>;
  /** Private admission identity supplied only by the prepared-reader boundary. */
  readerOwner?: object;
  /** borrow-deadline: the requester's observer of this job's start ACK. */
  onStart?: () => void;
  /** Opt-in diagnostics only (`__fenelAuthoringTimings`): when this job was posted. */
  postedAt?: number;
  /** The requester's own execution allowance, when it asked for a longer one
   * (AUTHORING_EVALUATION_ALLOWANCE_MS); otherwise AUTHORING_JOB_ALLOWANCE_MS. */
  allowanceMs?: number };
export type AuthoringStorageSettlement = AuthoringStorageOutcome | { status: "uncertain"; error: string };
type StorageOwner = { notify: (outcome: AuthoringStorageSettlement) => void;
  resolve: (outcome: AuthoringStorageSettlement) => void };
type Retirement = { reason: string; release?: () => boolean; finishing: boolean;
  drained: Promise<void>; resolve: () => void;
  reader?: { deadline: number; timer?: ReturnType<typeof setTimeout> } };

export type AuthoringWorkerTransport = {
  readonly worker: Worker; readonly epoch: number;
  closed: boolean; reason?: string; nextId: number;
  pending: Map<number, Pending>; jobs: Map<number, JobLifetime>;
  readonly storage: Map<number, StorageOwner>;
  retirement?: Retirement;
  dispatchTimeout?: ReturnType<typeof setTimeout>;
  dispatchDeadline?: number;
  readonly changes: Set<() => void>;
};
export type InitializationReservation = {
  readonly id: number;
  readonly result: Promise<AuthoringWorkerResult>;
  post(): void;
};

export const AUTHORING_JOB_ALLOWANCE_MS = 180_000;
export const AUTHORING_INITIALIZATION_ALLOWANCE_MS = 600_000;
/** A data card's own evaluation (a requester opts in): one real computation,
 * such as a recipe card's first analysis, may legitimately run minutes. It
 * keeps the initialization bound; queue waits keep the ordinary allowance. */
export const AUTHORING_EVALUATION_ALLOWANCE_MS = 600_000;
const AUTHORING_START_CLOCK_SKEW_ALLOWANCE_MS = 1;
const clock = () => performance.timeOrigin + performance.now();
const timeoutReason = "The operation took too long. Try again with less data.";

/** Absolute clocks also fence messages delivered before overdue timer callbacks. */
function expired(transport: AuthoringWorkerTransport): boolean {
  if (transport.closed) return true;
  const now = clock();
  if (!Number.isFinite(now) || (transport.dispatchDeadline !== undefined && now >= transport.dispatchDeadline)
    || [...transport.jobs.values()].some(job => job.executionDeadline !== undefined && now >= job.executionDeadline)
    || (transport.retirement?.reader && (!Number.isFinite(transport.retirement.reader.deadline)
      || now >= transport.retirement.reader.deadline))) {
    closeAuthoringTransport(transport, timeoutReason);
    return true;
  }
  return false;
}

function changed(transport: AuthoringWorkerTransport): void {
  let failed = false;
  for (const listener of [...transport.changes]) {
    try { listener(); }
    catch { failed = true; }
  }
  // Lifetime observers may retire this owner synchronously. An observer fault
  // must neither skip its peers nor strand jobs without a remaining watchdog.
  if (failed && !transport.closed)
    closeAuthoringTransport(transport, "The editing tools could not finish their update. Try again.");
  finishRetirement(transport);
}
export function observeAuthoringTransport(transport: AuthoringWorkerTransport, listener: () => void): () => void {
  transport.changes.add(listener);
  return () => transport.changes.delete(listener);
}

export function closeAuthoringTransport(transport: AuthoringWorkerTransport, reason: string): void {
  if (transport.closed) return;
  transport.closed = true;
  transport.reason = reason;
  transport.worker.terminate();
  clearTimeout(transport.dispatchTimeout);
  transport.dispatchTimeout = undefined;
  transport.dispatchDeadline = undefined;
  // A missing receipt after posting cannot establish whether IndexedDB wrote.
  // Notify durable owners before either reader settlement or lifetime observers.
  for (const id of [...transport.storage.keys()]) settleStorage(transport, id,
    { status: transport.jobs.get(id)?.posted ? "uncertain" : "not-committed", error: reason });
  for (const job of transport.jobs.values()) clearTimeout(job.timeout);
  transport.jobs.clear();
  for (const pending of transport.pending.values()) { pending.cleanup(); pending.reject(new Error(reason)); }
  transport.pending.clear();
  const retirement = transport.retirement;
  clearTimeout(retirement?.reader?.timer);
  transport.retirement = undefined;
  retirement?.resolve();
  changed(transport);
  transport.changes.clear();
}

function settleStorage(transport: AuthoringWorkerTransport, id: number, outcome: AuthoringStorageSettlement): void {
  const owner = transport.storage.get(id);
  if (!owner) return;
  transport.storage.delete(id);
  let failed = false;
  try { owner.notify(outcome); } catch { failed = true; }
  finally { owner.resolve(outcome); }
  if (failed) closeAuthoringTransport(transport, "The saved data acknowledgement could not be retained.");
}

function finishRetirement(transport: AuthoringWorkerTransport): void {
  const retirement = transport.retirement;
  if (!retirement || retirement.finishing || transport.closed || transport.storage.size) return;
  if (retirement.reader && (expired(transport) || transport.jobs.size || transport.pending.size)) return;
  retirement.finishing = true;
  let released = false;
  const release = retirement.release;
  try { released = release?.() === true && retirement.release === release; } catch { /* Terminate below. */ }
  if (!released) closeAuthoringTransport(transport, retirement.reason);
  else if (transport.retirement === retirement) {
    // The drained incarnation is over. A warm successor may admit fresh work;
    // the previous callback never survives into that next incarnation.
    transport.retirement = undefined;
    clearTimeout(retirement.reader?.timer);
    retirement.resolve();
  }
}

/** Graceful owner retirement preserves durable writes and optionally gives only
 * exact reader-owned physical work a bounded cancellation interval. Repeated
 * retirement can strengthen release to termination, never weaken it. */
export function retireAuthoringTransport(transport: AuthoringWorkerTransport, reason: string,
  release?: () => boolean, reader?: { owner: object; allowanceMs: number }): Promise<void> {
  if (transport.closed) return Promise.resolve();
  if (transport.retirement) {
    const retirement = transport.retirement;
    if (!release) {
      retirement.release = undefined; retirement.reason = reason;
      clearTimeout(retirement.reader?.timer); retirement.reader = undefined;
      finishRetirement(transport);
    }
    return retirement.drained;
  }
  let resolve!: () => void;
  const drained = new Promise<void>(done => { resolve = done; });
  transport.retirement = { reason, release, drained, resolve, finishing: false };
  if (release && reader && reader.allowanceMs > 0 && Number.isFinite(reader.allowanceMs)
    && !transport.storage.size && transport.jobs.size
    && [...transport.jobs.values()].every(job => job.posted && job.readerOwner === reader.owner)
    && [...transport.pending.keys()].every(id => transport.jobs.get(id)?.readerOwner === reader.owner)) {
    const deadlines = [...transport.jobs.values()].map(job => job.executionDeadline ?? Infinity);
    const deadline = Math.min(clock() + reader.allowanceMs, transport.dispatchDeadline ?? Infinity, ...deadlines);
    transport.retirement.reader = { deadline };
    if (expired(transport)) return drained;
    const retirement = transport.retirement;
    retirement.reader!.timer = setTimeout(() => {
      if (transport.retirement === retirement) closeAuthoringTransport(transport, reason);
    }, deadline - clock());
  }
  if (transport.storage.size || transport.retirement?.reader) {
    for (const [id, pending] of [...transport.pending]) {
      transport.pending.delete(id); pending.cleanup(); pending.reject(new Error(reason));
      const job = transport.jobs.get(id);
      if (!job?.posted) {
        settleStorage(transport, id, { status: "not-committed", error: reason });
        finishedJob(transport, id);
      } else {
        try { transport.worker.postMessage({ id, method: "cancel" } satisfies AuthoringWorkerRequest); }
        catch { closeAuthoringTransport(transport, "The authoring worker request could not be cancelled."); break; }
      }
    }
  }
  finishRetirement(transport);
  return drained;
}

/** The same dispatch/execution clocks as the original shared client. */
function watchDispatch(transport: AuthoringWorkerTransport): void {
  const jobs = [...transport.jobs.values()];
  const waiting = jobs.some(job => !job.started && job.method !== "initialize");
  const running = jobs.some(job => job.started);
  // Initialization already owns its one absolute 600s allowance, including
  // reservation/boot before a start ACK. A queued core request must not add
  // a shorter competing dispatch deadline. Actual core execution stays 180s.
  const initializing = jobs.some(job => job.method === "initialize" && job.initializationDeadline !== undefined);
  if (transport.closed || !waiting || running || initializing) {
    clearTimeout(transport.dispatchTimeout);
    transport.dispatchTimeout = undefined;
    transport.dispatchDeadline = undefined;
    return;
  }
  if (transport.dispatchTimeout !== undefined) return;
  transport.dispatchDeadline = clock() + AUTHORING_JOB_ALLOWANCE_MS;
  const timeout = setTimeout(() => {
    if (transport.dispatchTimeout !== timeout) return;
    closeAuthoringTransport(transport, "The operation took too long. Try again with less data.");
  }, AUTHORING_JOB_ALLOWANCE_MS);
  transport.dispatchTimeout = timeout;
}
function watchExecution(transport: AuthoringWorkerTransport, id: number, job: JobLifetime,
  remaining = AUTHORING_JOB_ALLOWANCE_MS, deadline = clock() + remaining): void {
  job.executionDeadline = deadline;
  job.timeout = setTimeout(() => {
    if (transport.jobs.get(id) !== job) return;
    closeAuthoringTransport(transport, "The operation took too long. Try again with less data.");
  }, Math.max(0, deadline - clock()));
}
function startedJob(transport: AuthoringWorkerTransport, id: number, startedAt: number): void {
  const job = transport.jobs.get(id);
  if (!job || job.started || !job.posted) return;
  if (expired(transport)) return;
  const now = performance.timeOrigin + performance.now();
  if (!Number.isFinite(now) || typeof startedAt !== "number" || !Number.isFinite(startedAt)
    || startedAt > now + AUTHORING_START_CLOCK_SKEW_ALLOWANCE_MS) {
    closeAuthoringTransport(transport, "The authoring worker response could not be read.");
    return;
  }
  job.started = true;
  // Opt-in responsiveness diagnostics: the queue wait from posting to the
  // worker's own start event. Labels carry the operation name only.
  if (job.postedAt !== undefined && Number.isFinite(startedAt) && startedAt >= job.postedAt) {
    try { performance.measure(`fenel:worker queue ${job.method}`, { start: job.postedAt - performance.timeOrigin, end: startedAt - performance.timeOrigin }); }
    catch { /* diagnostics never affect scheduling */ }
  }
  const remaining = job.method === "initialize" ? (job.initializationDeadline ?? -Infinity) - now
    : Math.min(startedAt, now) + (job.allowanceMs ?? AUTHORING_JOB_ALLOWANCE_MS) - now;
  if (remaining <= 0) {
    closeAuthoringTransport(transport, "The operation took too long. Try again with less data.");
    return;
  }
  if (job.method !== "initialize") watchExecution(transport, id, job, remaining, now + remaining);
  if (transport.retirement?.reader && job.executionDeadline !== undefined)
    transport.retirement.reader.deadline = Math.min(transport.retirement.reader.deadline, job.executionDeadline);
  watchDispatch(transport);
  // borrow-deadline: tell a still-waiting requester its job began (host
  // scheduling only; an observer fault never affects the transport).
  const onStart = job.onStart;
  job.onStart = undefined;
  if (onStart && transport.pending.has(id)) {
    try { onStart(); } catch { /* The requester's own bound still applies. */ }
  }
  changed(transport);
}
function finishedJob(transport: AuthoringWorkerTransport, id: number): void {
  const job = transport.jobs.get(id);
  if (!job) return;
  clearTimeout(job.timeout);
  transport.jobs.delete(id);
  watchDispatch(transport);
}

function reserve(transport: AuthoringWorkerTransport, payload: AuthoringWorkerCommand,
  signal?: AbortSignal, storage?: StorageOwner, onStart?: () => void, readerOwner?: object, allowance?: "evaluation"): InitializationReservation {
  if (transport.closed) throw new Error(transport.reason ?? "These editing tools were replaced by a newer account snapshot.");
  if (transport.retirement) throw new Error(transport.retirement.reason);
  if (payload.method === "commit-local-storage" && !storage)
    throw new Error("A storage commit requires its durable settlement owner.");
  signal?.throwIfAborted();
  const id = ++transport.nextId;
  const job: JobLifetime = { method: payload.method, started: false, posted: false,
    ...(onStart ? { onStart } : {}), ...(readerOwner ? { readerOwner } : {}),
    ...(payload.method !== "initialize" && allowance === "evaluation" ? { allowanceMs: AUTHORING_EVALUATION_ALLOWANCE_MS } : {}) };
  transport.jobs.set(id, job);
  if (storage) transport.storage.set(id, storage);
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<AuthoringWorkerResult>((resolve, reject) => {
    rejectResult = reject;
    const abort = () => {
      const pending = transport.pending.get(id);
      if (!pending) return;
      transport.pending.delete(id); pending.cleanup();
      reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
      // An unsent reservation has no physical job and cannot receive an ACK.
      if (!job.posted) {
        settleStorage(transport, id, { status: "not-committed", error: "The storage request was cancelled before posting." });
        finishedJob(transport, id);
      }
      else {
        try { transport.worker.postMessage({ id, method: "cancel" } satisfies AuthoringWorkerRequest); }
        catch { closeAuthoringTransport(transport, "The authoring worker request could not be cancelled."); }
      }
      changed(transport);
    };
    const cleanup = () => signal?.removeEventListener("abort", abort);
    transport.pending.set(id, { resolve, reject, cleanup });
    signal?.addEventListener("abort", abort, { once: true });
  });
  // A reservation may wait before its caller can await this promise.
  void result.catch(() => undefined);
  if (payload.method === "initialize") {
    // The existing single allowance now begins at reservation, so a held
    // early lease spends the same bounded budget. Never restart it at post.
    job.initializationDeadline = performance.timeOrigin + performance.now() + AUTHORING_INITIALIZATION_ALLOWANCE_MS;
    watchExecution(transport, id, job, AUTHORING_INITIALIZATION_ALLOWANCE_MS, job.initializationDeadline);
  }
  watchDispatch(transport);
  changed(transport);
  return Object.freeze({ id, result, post() {
    if (transport.closed || transport.jobs.get(id) !== job || job.posted) return;
    if (job.initializationDeadline !== undefined) {
      const now = performance.timeOrigin + performance.now();
      if (!Number.isFinite(now) || now >= job.initializationDeadline) {
        closeAuthoringTransport(transport, "The operation took too long. Try again with less data.");
        return;
      }
    }
    job.posted = true;
    if ((globalThis as { __fenelAuthoringTimings?: boolean }).__fenelAuthoringTimings) job.postedAt = performance.timeOrigin + performance.now();
    try { transport.worker.postMessage({ ...payload, id }); }
    catch (error) {
      settleStorage(transport, id, { status: "not-committed", error: error instanceof Error ? error.message : String(error) });
      const pending = transport.pending.get(id);
      transport.pending.delete(id); pending?.cleanup();
      finishedJob(transport, id); rejectResult(error);
      changed(transport);
    }
  } });
}
export function reserveAuthoringInitialization(transport: AuthoringWorkerTransport,
  payload: Extract<AuthoringWorkerCommand, { method: "initialize" }>, signal?: AbortSignal): InitializationReservation {
  return reserve(transport, payload, signal);
}
/** `onStart` (optional) is called once when the worker acknowledges that this
 * job began, while its requester still waits. `allowance` "evaluation" (a data
 * card's own evaluation) runs up to AUTHORING_EVALUATION_ALLOWANCE_MS. */
export function requestAuthoringTransport(transport: AuthoringWorkerTransport,
  payload: AuthoringWorkerCommand, signal?: AbortSignal, onStart?: () => void, readerOwner?: object,
  allowance?: "evaluation"): Promise<AuthoringWorkerResult> {
  try { const reservation = reserve(transport, payload, signal, undefined, onStart, readerOwner, allowance); reservation.post(); return reservation.result; }
  catch (error) { return Promise.reject(error); }
}
/** The result is reader-cancellable; settled always reports the physical write.
 * The synchronous observer must retain keeper metadata before retirement runs. */
export function requestAuthoringStorageCommit(transport: AuthoringWorkerTransport,
  payload: Extract<AuthoringWorkerCommand, { method: "commit-local-storage" }>,
  notify: (outcome: AuthoringStorageSettlement) => void, signal?: AbortSignal): {
    result: Promise<AuthoringWorkerResult>; settled: Promise<AuthoringStorageSettlement>;
  } {
  let resolve!: StorageOwner["resolve"];
  const settled = new Promise<AuthoringStorageSettlement>(done => { resolve = done; });
  try {
    const reservation = reserve(transport, payload, signal, { notify, resolve });
    reservation.post();
    return { result: reservation.result, settled };
  } catch (error) {
    const outcome: AuthoringStorageSettlement = { status: "not-committed", error: error instanceof Error ? error.message : String(error) };
    try { notify(outcome); } catch { closeAuthoringTransport(transport, "The saved data acknowledgement could not be retained."); }
    resolve(outcome);
    const result = Promise.reject(error);
    void result.catch(() => undefined);
    return { result, settled };
  }
}
/** One-way controls share the same physical ID counter and message owner. */
export function controlAuthoringTransport(transport: AuthoringWorkerTransport,
  payload: Extract<AuthoringWorkerCommand, { method: "release" | "seal-registry-preparation" }>): void {
  if (transport.closed) throw new Error(transport.reason ?? "The authoring worker is unavailable.");
  if (payload.method === "release" && transport.storage.size)
    throw new Error("The authoring worker still owns an unsettled storage commit.");
  transport.worker.postMessage({ ...payload, id: ++transport.nextId });
}
export function createAuthoringWorkerTransport(worker: Worker, epoch: number): AuthoringWorkerTransport {
  const transport: AuthoringWorkerTransport = { worker, epoch, closed: false, nextId: 0,
    pending: new Map(), jobs: new Map(), storage: new Map(), changes: new Set() };
  worker.onmessage = (event: MessageEvent<AuthoringWorkerMessage>) => {
    if (transport.closed) return;
    const data = event.data;
    // Native message payloads are data, but the envelope still needs checking.
    // Result contents retain their operation-specific adapters and validators.
    if (!data || typeof data !== "object" || Array.isArray(data)
      || !Object.hasOwn(data, "id") || !Number.isSafeInteger(data.id) || data.id <= 0) {
      closeAuthoringTransport(transport, "The authoring worker response could not be read.");
      return;
    }
    // Storage receipts precede reader cancellation/orphan filtering. A generic
    // response or finish ACK is never evidence that a write did not commit.
    if ("event" in data && data.event === "storage-settled") {
      if (!transport.storage.has(data.id) || !transport.jobs.get(data.id)?.posted) return;
      const outcome = data.outcome;
      if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)
        || (outcome.status === "committed"
          ? !isAuthoringStorageRecord(outcome.record)
          : outcome.status !== "not-committed" || typeof outcome.error !== "string")) {
        closeAuthoringTransport(transport, "The saved data acknowledgement could not be read.");
        return;
      }
      const pending = transport.pending.get(data.id);
      transport.pending.delete(data.id); pending?.cleanup();
      settleStorage(transport, data.id, outcome);
      finishedJob(transport, data.id);
      if (pending) {
        if (outcome.status === "committed") pending.resolve({ storageRecord: outcome.record });
        else pending.reject(new Error(outcome.error));
      }
      changed(transport);
      return;
    }
    // Ignore impossible responses to a reservation that was never sent, or an
    // already retired job. Neither can acknowledge a different physical job.
    const job = transport.jobs.get(data.id);
    if (!job?.posted) return;
    if (expired(transport)) return;
    if ("event" in data) {
      if (data.event === "started") startedJob(transport, data.id, data.startedAt);
      else if (data.event === "finished") {
        if (!transport.pending.has(data.id) && !transport.storage.has(data.id)) { finishedJob(transport, data.id); changed(transport); }
      } else closeAuthoringTransport(transport, "The authoring worker response could not be read.");
      return;
    }
    if (transport.storage.has(data.id)) return;
    if (data.ok !== true && data.ok !== false
      || (data.ok === true ? !Object.hasOwn(data, "result")
        : typeof data.error !== "string" || (data.code !== undefined && typeof data.code !== "string"))) {
      closeAuthoringTransport(transport, "The authoring worker response could not be read.");
      return;
    }
    const pending = transport.pending.get(data.id);
    transport.pending.delete(data.id); pending?.cleanup();
    finishedJob(transport, data.id);
    // Complete the reply before announcing idleness. A listener may close the
    // worker or abort the reader; higher-level reader fences still run on await.
    if (pending) {
      if (data.ok) pending.resolve(data.result);
      else pending.reject(new WorkerRequestError(data.error, data.code));
    }
    changed(transport);
  };
  worker.onerror = event => closeAuthoringTransport(transport, event.message || "The authoring worker failed.");
  worker.onmessageerror = () => closeAuthoringTransport(transport, "The authoring worker response could not be read.");
  return transport;
}
