export type ApiReadiness = "connecting" | "loading" | "ready" | "failed" | "unavailable";

/** How long the API may stay silent (no sign of life) before a wait stops and
 *  says so. A refused connection, a failed request and the dev proxy's
 *  `{status: "unavailable"}` count as silence. A server that accepted the
 *  request but did not answer in time (the dev proxy's `{status: "busy"}`, or a
 *  probe of ours held past `API_PROBE_LIMIT_MS`) is alive, busy evaluating its
 *  imports during a cold boot: that counts toward `API_BOOT_LIMIT_MS` instead. */
export const API_UNANSWERED_LIMIT_MS = 120_000;
/** How long the API may keep reporting "loading" (or stay busy) before a wait
 *  stops. The API answers while it boots, so this bound is generous: it only
 *  catches a boot that never ends. */
export const API_BOOT_LIMIT_MS = 600_000;
/** The longest one probe may be held. Above the server's 25-second long-poll
 *  heartbeat and the dev proxy's 30-second wait, so only a server that accepted
 *  the request and then did not answer at all reaches it. */
export const API_PROBE_LIMIT_MS = 35_000;

export type ApiReadinessOptions = {
  signal: AbortSignal;
  onStatus?: (status: ApiReadiness) => void;
  /** Override of `API_UNANSWERED_LIMIT_MS`. */
  unansweredLimitMs?: number;
  /** Override of `API_PROBE_LIMIT_MS`. */
  probeLimitMs?: number;
  /** Absolute time (`Date.now()` scale) after which the wait gives up even
   *  while the API reports loading. Defaults to now + `API_BOOT_LIMIT_MS`;
   *  callers that wait more than once pass one shared deadline. */
  deadline?: number;
};

/** A readiness wait passed its deadline. The message says what failed and
 *  what to do, so surfaces can show it as it stands, next to a retry. */
export class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiUnavailableError";
  }
}

function describeDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 120) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  return `${Math.round(seconds / 60)} minutes`;
}

/** Resolve after `milliseconds`, or reject with the signal's reason when it
 *  aborts first (no timer is left behind). */
export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Wait on the API's boot signal, without sending or storing credentials.
 *  A disconnected API is not evidence that it is loading or that it crashed.
 *  Only connection probes retry; authentication requests are never replayed.
 *  Both waits are bounded: silence for `unansweredLimitMs`, or a boot (or a
 *  busy server) that has not finished by `deadline`, reports "unavailable" and
 *  throws `ApiUnavailableError`, whose message names the limit that fired. */
export async function waitForApiReady({
  signal,
  onStatus,
  unansweredLimitMs = API_UNANSWERED_LIMIT_MS,
  probeLimitMs = API_PROBE_LIMIT_MS,
  deadline = Date.now() + API_BOOT_LIMIT_MS,
}: ApiReadinessOptions): Promise<void> {
  let status: ApiReadiness = "connecting";
  let retryDelay = 1_000;
  const startedAt = Date.now();
  // Silence is measured from the last sign of life: an answer of the API's
  // own, or a request it accepted and held. `lastReplyAt` counts answers only.
  let lastAliveAt = startedAt;
  let lastReplyAt = startedAt;
  // What the server last said about itself, so the message matches the limit.
  let lastSign: "loading" | "busy" | undefined;
  const giveUp = (): never => {
    onStatus?.("unavailable");
    const now = Date.now();
    // The budget is spent, so the earlier of the two limits is the one that
    // fired (compared as limits, not against a clock read a tick early).
    const silenceFired = lastAliveAt + unansweredLimitMs <= deadline;
    if (!silenceFired && lastSign === "loading") {
      throw new ApiUnavailableError(`The server is still starting after ${describeDuration(now - startedAt)}. `
        + "Check the API's log, then retry.");
    }
    if (!silenceFired && lastSign === "busy") {
      throw new ApiUnavailableError(`The server is running but has not answered for ${describeDuration(now - lastReplyAt)}. `
        + "Check the API's log, then retry.");
    }
    throw new ApiUnavailableError(`The server has not answered for ${describeDuration(now - lastAliveAt)}. `
      + "Check that the API is running, then retry.");
  };
  const remaining = () => Math.min(deadline, lastAliveAt + unansweredLimitMs) - Date.now();
  onStatus?.(status);
  while (true) {
    signal.throwIfAborted();
    if (remaining() <= 0) giveUp();
    let next: unknown;
    // One probe may not outlast the remaining budget. An explicit timer rather
    // than AbortSignal.timeout: that one need not fire on every host (Bun's
    // does not keep its loop alive), and this bound must hold everywhere.
    const probe = new AbortController();
    const probeLimit = Math.max(1, Math.min(probeLimitMs, remaining()));
    const budgetLimited = probeLimit < probeLimitMs;
    let probeCut = false;
    const probeTimer = setTimeout(() => { probeCut = true; probe.abort(); }, probeLimit);
    try {
      // The first read reports loading immediately. Subsequent reads are held
      // by the server until boot completes (or its 25-second heartbeat).
      const response = await fetch(`/api/readiness${status === "loading" ? "?wait=1" : ""}`, {
        cache: "no-store",
        signal: AbortSignal.any([signal, probe.signal]),
      });
      if (response.ok) next = (await response.json())?.status;
    } catch {
      signal.throwIfAborted();
    } finally {
      clearTimeout(probeTimer);
    }
    signal.throwIfAborted();
    // The budget ran out during this probe: report the limit that fired now,
    // before the status could flash "connecting".
    if (probeCut && budgetLimited) giveUp();
    // A probe held to its own limit was accepted by a server that is alive but
    // not answering, like the dev proxy's "busy".
    if (probeCut) next = "busy";
    if (next === "ready") {
      onStatus?.("ready");
      return;
    }
    if (next === "failed") {
      onStatus?.("failed");
      throw new Error("The API could not start. Please try again after it restarts.");
    }
    if (next === "loading" || next === "busy") {
      // Busy: the server accepted the request but its event loop is blocked,
      // as when a cold boot evaluates its imports. That is a boot in progress.
      lastSign = next;
      lastAliveAt = Date.now();
      if (next === "loading") lastReplyAt = lastAliveAt;
      status = "loading";
      retryDelay = 1_000;
      onStatus?.(status);
      continue;
    }
    // No sign of life, including the dev proxy's "unavailable".
    const left = remaining();
    if (left <= 0) giveUp();
    status = "connecting";
    onStatus?.(status);
    await abortableDelay(Math.min(retryDelay, left), signal);
    retryDelay = Math.min(retryDelay * 2, 5_000);
  }
}
