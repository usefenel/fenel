import type { Connect, Plugin } from "vite";

type ReadinessStatus = "loading" | "ready" | "failed" | "busy" | "unavailable";

interface ReadinessProxyOptions {
  origin?: string;
  timeoutMs?: number;
  waitTimeoutMs?: number;
}

// The API may have no listener yet, or be busy evaluating its initial imports.
// Only its own readiness response can distinguish loading from a failed boot.
// Neither case is a gateway error: the browser polls this endpoint while the API
// boots, and a 502 per poll would fill the console during an ordinary start. So
// both are a 200, told apart because the client bounds them differently:
// - `{status: "unavailable"}`: the request failed, as when nothing listens on
//   the port (the connection is refused at once). `waitForApiReady` counts this
//   as silence and stops after `API_UNANSWERED_LIMIT_MS`.
// - `{status: "busy"}`: the request was sent but not answered in time. On the
//   loopback origin the kernel accepts a connection to a listening port even
//   while the process is blocked, so a timeout means the API exists but its
//   event loop is busy (a cold boot evaluating the engine and registry). The
//   client counts this toward its boot deadline (`API_BOOT_LIMIT_MS`) instead.
// Explicit deployment probes opt into HTTP 503 for every non-ready outcome;
// only a coherent upstream ready reply permits HTTP 200.
export function apiReadinessMiddleware(options: ReadinessProxyOptions = {}): Connect.NextHandleFunction {
  const origin = options.origin ?? "http://127.0.0.1:3001";
  return (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const probe = url.searchParams.get("probe") === "1";
    if ((req.method !== "GET" && !(probe && req.method === "HEAD"))
      || url.pathname !== "/api/readiness") return next();

    const waiting = !probe && url.searchParams.get("wait") === "1";
    const controller = new AbortController();
    let timedOut = false;
    const disconnect = () => controller.abort();
    req.once("aborted", disconnect);
    res.once("close", disconnect);
    const timeout = setTimeout(
      () => { timedOut = true; controller.abort(); },
      waiting ? (options.waitTimeoutMs ?? 30_000) : (options.timeoutMs ?? 2_000),
    );
    timeout.unref();

    void (async () => {
      let status: ReadinessStatus = "unavailable";
      try {
        const response = await fetch(new URL(`/api/readiness${probe ? "?probe=1" : waiting ? "?wait=1" : ""}`, origin), {
          headers: { Accept: "application/json" },
          signal: controller.signal,
          redirect: "error",
        });
        if (response.status === 200 || (probe && response.status === 503)) {
          const body: unknown = await response.json();
          if (body && typeof body === "object" && "status" in body
            && (body.status === "loading" || body.status === "ready" || body.status === "failed")
            && (!probe || (body.status === "ready" ? response.status === 200 : response.status === 503))) {
            status = body.status;
          }
        } else {
          await response.body?.cancel();
        }
      } catch {
        // A stopped or unresponsive API is not evidence that it is loading.
        // Only our own timeout says the request reached a listener that did
        // not answer; any other failure (a refused connection) is silence.
        if (timedOut) status = "busy";
      } finally {
        clearTimeout(timeout);
        req.removeListener("aborted", disconnect);
        res.removeListener("close", disconnect);
      }

      if (res.destroyed || res.writableEnded) return;
      res.writeHead(probe && status !== "ready" ? 503 : 200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ status }));
    })();
  };
}

export function apiReadinessPlugin(): Plugin {
  return {
    name: "api-readiness",
    apply: "serve",
    configureServer(server) {
      // Run before Vite's general /api proxy so an absent listener does not
      // turn readiness checks into a stream of browser-visible 502 errors.
      server.middlewares.use(apiReadinessMiddleware());
    },
  };
}
