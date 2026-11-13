export type ApiReadinessStatus = "loading" | "ready" | "failed";

/** The second argument is Bun's server, passed through so the app can read
 *  the socket address (`server.requestIP`) for its rate-limit keys. */
type ApiFetch = (request: Request, server?: object) => Response | Promise<Response>;

/** Keep startup status independent of the engine and database import graph.
 * The cap bounds this host listener's pending timers/abort subscriptions before
 * the application middleware can load; it is not an account or execution quota. */
export function createApiReadiness({ waitTimeoutMs = 25_000, maxWaiters = 64 } = {}) {
  if (!Number.isSafeInteger(maxWaiters) || maxWaiters < 0) {
    throw new RangeError("maxWaiters must be a non-negative safe integer");
  }
  let status: ApiReadinessStatus = "loading";
  let appFetch: ApiFetch | undefined;
  const waiters = new Set<() => void>();

  function finishWaiting(): void {
    for (const finish of waiters) finish();
  }

  function waitForStartup(signal: AbortSignal): Promise<void> | false {
    if (status !== "loading" || signal.aborted) return Promise.resolve();
    // Reserve the slot synchronously, before fetch yields. Rejected probes own
    // no timer or abort subscription, and do not queue behind admitted waits.
    if (waiters.size >= maxWaiters) return false;
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        waiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, waitTimeoutMs);
      waiters.add(finish);
      signal.addEventListener("abort", finish, { once: true });
    });
  }

  return {
    async fetch(request: Request, server?: object): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/api/readiness") {
        const headers = { "cache-control": "no-store" };
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response(null, {
            status: 405,
            headers: { ...headers, allow: "GET, HEAD" },
          });
        }
        const probe = url.searchParams.get("probe") === "1";
        if (!probe && request.method === "GET" && url.searchParams.get("wait") === "1") {
          const waiting = waitForStartup(request.signal);
          if (waiting === false) {
            // A successful immediate "loading" reply makes the existing client
            // poll again without delay. A refusal uses its reconnect backoff.
            return Response.json({ status, code: "API_READINESS_BUSY" }, {
              status: 429,
              headers: { ...headers, "retry-after": "1" },
            });
          }
          await waiting;
        }
        // Browser status reads keep their normal response during startup;
        // deployment probes must refuse routing until boot has completed.
        const responseStatus = probe && status !== "ready" ? 503 : 200;
        return request.method === "HEAD"
          ? new Response(null, { status: responseStatus, headers })
          : Response.json({ status }, { status: responseStatus, headers });
      }
      if (status === "ready" && appFetch) return appFetch(request, server);
      return Response.json(
        {
          error: status === "loading" ? "API is loading" : "API startup failed",
          code: status === "loading" ? "API_LOADING" : "API_STARTUP_FAILED",
        },
        {
          status: 503,
          headers: {
            "cache-control": "no-store",
            ...(status === "loading" ? { "retry-after": "1" } : {}),
          },
        },
      );
    },
    ready(fetch: ApiFetch): void {
      appFetch = fetch;
      status = "ready";
      finishWaiting();
    },
    fail(): void {
      appFetch = undefined;
      status = "failed";
      finishWaiting();
    },
  };
}
