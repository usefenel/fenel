import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { ApiConnectionError, ApiResponseError, recoverApiRead } from "./api-read-recovery";
import { ApiUnavailableError, waitForApiReady } from "./api-readiness";

const fetchSpy = spyOn(globalThis, "fetch");
// Bun adds fetch.preconnect to its function type; these browser read tests do
// not use that host extension.
const mockFetch = (implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => {
  fetchSpy.mockImplementation(implementation as typeof fetch);
};
afterEach(() => fetchSpy.mockReset());
afterAll(() => fetchSpy.mockRestore());

test("a safe read waits for confirmed startup, then resumes without becoming an error", async () => {
  const statuses: string[] = [];
  const paths: string[] = [];
  let finishBoot!: (response: Response) => void;
  let bootObserved!: () => void;
  const observingBoot = new Promise<void>((resolve) => { bootObserved = resolve; });
  mockFetch(async (url) => {
    paths.push(String(url));
    if (String(url).endsWith("?wait=1")) {
      bootObserved();
      return new Promise<Response>((resolve) => { finishBoot = resolve; });
    }
    return Response.json({ status: "loading" });
  });
  let reads = 0;
  const pending = recoverApiRead(async () => {
    if (++reads === 1) throw new ApiConnectionError("offline");
    return ["recovered"];
  }, { signal: new AbortController().signal, onStatus: (status) => statuses.push(status) });
  await observingBoot;
  expect(reads).toBe(1);
  expect(statuses).toEqual(["connecting", "loading"]);
  finishBoot(Response.json({ status: "ready" }));
  expect(await pending).toEqual(["recovered"]);
  expect(reads).toBe(2);
  expect(paths).toEqual(["/api/readiness", "/api/readiness?wait=1"]);
});

test("access denial and malformed data are terminal and are never retried", async () => {
  for (const failure of [new ApiResponseError(403, "Denied"), new SyntaxError("Invalid payload")]) {
    let reads = 0;
    await expect(recoverApiRead(async () => { reads++; throw failure; }, {
      signal: new AbortController().signal,
    })).rejects.toBe(failure);
    expect(reads).toBe(1);
  }
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a server which reports ready but keeps failing a read has a bounded recovery budget", async () => {
  mockFetch(async () => Response.json({ status: "ready" }));
  let reads = 0;
  const failure = new ApiResponseError(503, "Unavailable");
  await expect(recoverApiRead(async () => { reads++; throw failure; }, {
    signal: new AbortController().signal,
  })).rejects.toBe(failure);
  expect(reads).toBe(3);
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test("confirmed startup failure stops recovery immediately", async () => {
  mockFetch(async () => Response.json({ status: "failed" }));
  let reads = 0;
  await expect(recoverApiRead(async () => { reads++; throw new ApiConnectionError("offline"); }, {
    signal: new AbortController().signal,
  })).rejects.toThrow("The API could not start");
  expect(reads).toBe(1);
});

test("a cancelled session cannot replay a read after a late readiness response", async () => {
  let finishProbe!: (response: Response) => void;
  let probeObserved!: () => void;
  const observingProbe = new Promise<void>((resolve) => { probeObserved = resolve; });
  mockFetch(() => new Promise<Response>((resolve) => { finishProbe = resolve; probeObserved(); }));
  const controller = new AbortController();
  let reads = 0;
  const pending = recoverApiRead(async () => { reads++; throw new ApiConnectionError("offline"); }, { signal: controller.signal });
  await observingProbe;
  controller.abort();
  finishProbe(Response.json({ status: "ready" }));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(reads).toBe(1);
});

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

test("an API that never answers for itself ends the wait with an actionable error", async () => {
  // The dev proxy answers a refused connection with 200 {status: "unavailable"}.
  mockFetch(async () => Response.json({ status: "unavailable" }));
  const statuses: string[] = [];
  const started = Date.now();
  const error = await waitForApiReady({
    signal: new AbortController().signal, unansweredLimitMs: 60, onStatus: (status) => statuses.push(status),
  }).then(() => undefined, (failure: unknown) => failure);
  expect(error).toBeInstanceOf(ApiUnavailableError);
  expect((error as Error).message).toContain("has not answered");
  expect((error as Error).message).toContain("retry");
  expect(statuses.at(-1)).toBe("unavailable");
  expect(Date.now() - started).toBeLessThan(2_000);
});

test("a readiness request the server holds open is cut at the silence limit", async () => {
  mockFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  }));
  const started = Date.now();
  await expect(waitForApiReady({ signal: new AbortController().signal, unansweredLimitMs: 60 }))
    .rejects.toBeInstanceOf(ApiUnavailableError);
  expect(Date.now() - started).toBeLessThan(2_000);
});

test("genuine boot answers keep the wait alive past the silence limit", async () => {
  let answers = 0;
  mockFetch(async () => {
    await delay(25);
    return Response.json({ status: ++answers < 6 ? "loading" : "ready" });
  });
  const statuses: string[] = [];
  await waitForApiReady({ signal: new AbortController().signal, unansweredLimitMs: 60,
    onStatus: (status) => statuses.push(status) });
  expect(answers).toBe(6);
  expect(statuses.at(-1)).toBe("ready");
  expect(statuses).not.toContain("unavailable");
});

// Like the real server: the first read answers at once, each long poll is held
// until the heartbeat (here 50 ms), and a probe cut early rejects.
const heldLongPoll = (status: string, heartbeatMs = 50) => mockFetch((url, init) => {
  if (!String(url).endsWith("?wait=1")) return Promise.resolve(Response.json({ status }));
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(Response.json({ status })), heartbeatMs);
    init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal!.reason); }, { once: true });
  });
});

test("a boot that never finishes stops at the deadline and says the server is still starting", async () => {
  // The deadline cuts a held long poll: that is still a boot, not silence.
  heldLongPoll("loading");
  const statuses: string[] = [];
  const error = await waitForApiReady({ signal: new AbortController().signal, deadline: Date.now() + 80,
    onStatus: (status) => statuses.push(status) }).then(() => undefined, (failure: unknown) => failure);
  expect(error).toBeInstanceOf(ApiUnavailableError);
  expect((error as Error).message).toContain("still starting");
  // No "connecting" flash between the boot answers and the final report.
  expect(statuses).toEqual(["connecting", "loading", "loading", "unavailable"]);
});

test("an API that answered loading and then fell silent is reported as not answering", async () => {
  let answered = false;
  mockFetch(async () => {
    if (answered) return Response.json({ status: "unavailable" });
    answered = true;
    return Response.json({ status: "loading" });
  });
  const error = await waitForApiReady({ signal: new AbortController().signal, unansweredLimitMs: 60 })
    .then(() => undefined, (failure: unknown) => failure);
  expect(error).toBeInstanceOf(ApiUnavailableError);
  expect((error as Error).message).toContain("has not answered");
});

test("a busy API (accepted, not answered) outlasts the silence limit and is bounded by the boot deadline", async () => {
  let answers = 0;
  mockFetch(async () => {
    await delay(25);
    return Response.json({ status: ++answers < 6 ? "busy" : "ready" });
  });
  const statuses: string[] = [];
  await waitForApiReady({ signal: new AbortController().signal, unansweredLimitMs: 60,
    onStatus: (status) => statuses.push(status) });
  expect(answers).toBe(6);
  expect(statuses).not.toContain("unavailable");

  heldLongPoll("busy");
  const error = await waitForApiReady({ signal: new AbortController().signal, unansweredLimitMs: 60,
    deadline: Date.now() + 150 }).then(() => undefined, (failure: unknown) => failure);
  expect(error).toBeInstanceOf(ApiUnavailableError);
  expect((error as Error).message).toContain("running but has not answered");
});

test("a probe held past its own limit counts as a busy server, not silence", async () => {
  // Without the dev proxy, a server that accepted the request and never
  // answers is only visible as a probe reaching its own limit.
  let probes = 0;
  mockFetch((_url, init) => {
    if (++probes >= 4) return Promise.resolve(Response.json({ status: "ready" }));
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
  });
  const statuses: string[] = [];
  await waitForApiReady({ signal: new AbortController().signal, unansweredLimitMs: 60, probeLimitMs: 40,
    onStatus: (status) => statuses.push(status) });
  expect(probes).toBe(4);
  expect(statuses).toEqual(["connecting", "loading", "loading", "loading", "ready"]);
});

test("a safe read against a silent API fails once, bounded, instead of spinning", async () => {
  mockFetch(async () => Response.json({ status: "unavailable" }));
  let reads = 0;
  await expect(recoverApiRead(async () => { reads++; throw new ApiConnectionError("offline"); }, {
    signal: new AbortController().signal, unansweredLimitMs: 60,
  })).rejects.toBeInstanceOf(ApiUnavailableError);
  expect(reads).toBe(1);
});

test("the retries of one read share one boot deadline", async () => {
  mockFetch(async () => { await delay(10); return Response.json({ status: "loading" }); });
  let reads = 0;
  const started = Date.now();
  await expect(recoverApiRead(async () => { reads++; throw new ApiConnectionError("offline"); }, {
    signal: new AbortController().signal, deadline: Date.now() + 80,
  })).rejects.toBeInstanceOf(ApiUnavailableError);
  expect(reads).toBe(1);
  expect(Date.now() - started).toBeLessThan(2_000);
});
