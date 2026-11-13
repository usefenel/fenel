import { expect, spyOn, test } from "bun:test";
import { createApiReadiness } from "./api-readiness";
import { waitForApiReady } from "../../../../distros/narthex/solid/src/lib/api-readiness";

const request = (path = "/api/readiness", init?: RequestInit) =>
  new Request(`http://localhost${path}`, init);

test("HTTP listener reports startup and releases a waiting sign-in only after readiness", async () => {
  const readiness = createApiReadiness();
  let notifyWaitStarted!: () => void;
  const waitStarted = new Promise<void>((resolve) => { notifyWaitStarted = resolve; });
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const response = readiness.fetch(req);
      if (new URL(req.url).searchParams.has("wait")) notifyWaitStarted();
      return response;
    },
  });
  try {
    const loading = await fetch(new URL("/api/readiness", server.url));
    expect(loading.status).toBe(200);
    expect(loading.headers.get("cache-control")).toBe("no-store");
    expect(await loading.json()).toEqual({ status: "loading" });

    const prematureLogin = await fetch(new URL("/api/auth/login", server.url), {
      method: "POST",
      body: "credentials must wait",
    });
    expect(prematureLogin.status).toBe(503);
    expect((await prematureLogin.json()).code).toBe("API_LOADING");

    let resolved = false;
    const waiting = fetch(new URL("/api/readiness?wait=1", server.url))
      .then((response) => { resolved = true; return response; });
    await waitStarted;
    expect(resolved).toBe(false);
    let logins = 0;
    readiness.ready(async (req) => {
      logins++;
      expect(req.method).toBe("POST");
      expect(await req.text()).toBe("credentials after readiness");
      return Response.json({ signedIn: true }, {
        headers: { "set-cookie": "session=test; HttpOnly" },
      });
    });
    expect(await (await waiting).json()).toEqual({ status: "ready" });
    expect(logins).toBe(0);
    const login = await fetch(new URL("/api/auth/login", server.url), {
      method: "POST",
      body: "credentials after readiness",
    });
    expect(await login.json()).toEqual({ signedIn: true });
    expect(login.headers.get("set-cookie")).toBe("session=test; HttpOnly");
    expect(logins).toBe(1);
  } finally {
    await server.stop(true);
  }
});

test("failed startup wakes all readiness waits and never dispatches application requests", async () => {
  const readiness = createApiReadiness();
  const waits = [1, 2].map(() => readiness.fetch(request("/api/readiness?wait=1")));
  readiness.fail();
  for (const response of await Promise.all(waits)) {
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "failed" });
  }
  const login = await readiness.fetch(request("/api/auth/login", { method: "POST" }));
  expect(login.status).toBe(503);
  expect(await login.json()).toEqual({
    error: "API startup failed",
    code: "API_STARTUP_FAILED",
  });
  expect(login.headers.get("retry-after")).toBeNull();
});

test("cancelling one readiness request releases its wait without cancelling other clients", async () => {
  const readiness = createApiReadiness();
  const controller = new AbortController();
  const cancelled = readiness.fetch(request("/api/readiness?wait=1", { signal: controller.signal }));
  let otherResolved = false;
  const other = readiness.fetch(request("/api/readiness?wait=1"))
    .then((response) => { otherResolved = true; return response; });
  controller.abort();
  expect(await (await cancelled).json()).toEqual({ status: "loading" });
  expect(otherResolved).toBe(false);
  readiness.ready(() => new Response("ready"));
  expect(await (await other).json()).toEqual({ status: "ready" });
});

test("readiness waits have a bounded response deadline and can wait again", async () => {
  const readiness = createApiReadiness({ waitTimeoutMs: 10 });
  const loading = await readiness.fetch(request("/api/readiness?wait=1"));
  expect(await loading.json()).toEqual({ status: "loading" });
  const nextWait = readiness.fetch(request("/api/readiness?wait=1"));
  readiness.ready(() => new Response("ready"));
  expect(await (await nextWait).json()).toEqual({ status: "ready" });
});

test("readiness is read-only and HEAD never waits for startup", async () => {
  const readiness = createApiReadiness();
  const post = await readiness.fetch(request("/api/readiness", { method: "POST" }));
  expect(post.status).toBe(405);
  expect(post.headers.get("allow")).toBe("GET, HEAD");
  const head = await readiness.fetch(request("/api/readiness?wait=1", { method: "HEAD" }));
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
});

test("deployment probes answer immediately and refuse non-ready boot states for GET and HEAD", async () => {
  const readiness = createApiReadiness({ maxWaiters: 0 });
  let appCalls = 0;
  for (const status of ["loading", "ready", "failed", "ready"] as const) {
    if (status === "ready") readiness.ready(() => { appCalls++; return new Response("app"); });
    else if (status === "failed") readiness.fail();
    for (const method of ["GET", "HEAD"]) {
      const response = await readiness.fetch(request("/api/readiness?probe=1&wait=1", { method }));
      expect(response.status).toBe(status === "ready" ? 200 : 503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      if (method === "HEAD") expect(await response.text()).toBe("");
      else expect(await response.json()).toEqual({ status });
    }
    const browser = await readiness.fetch(request());
    expect(browser.status).toBe(200);
    expect(await browser.json()).toEqual({ status });
  }
  expect(appCalls).toBe(0);
  expect((await readiness.fetch(request("/api/readiness?probe=1", { method: "POST" }))).status).toBe(405);
  readiness.fail();
  expect((await readiness.fetch(request("/api/readiness?probe=0"))).status).toBe(200);
});

test("the real startup listener exposes matching GET and HEAD deployment-probe verdicts", async () => {
  const readiness = createApiReadiness();
  const server = Bun.serve({ port: 0, fetch: readiness.fetch });
  try {
    for (const status of ["loading", "failed", "ready"] as const) {
      if (status === "failed") readiness.fail();
      else if (status === "ready") readiness.ready(() => new Response("app"));
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(new URL("/api/readiness?probe=1", server.url), { method });
        expect(response.status).toBe(status === "ready" ? 200 : 503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        if (method === "GET") expect(await response.json()).toEqual({ status });
        else expect(await response.text()).toBe("");
      }
    }
  } finally {
    readiness.fail();
    await server.stop(true);
  }
});

test("startup flood refuses excess waits while immediate status probes stay available", async () => {
  const readiness = createApiReadiness({ maxWaiters: 2 });
  const admitted = [1, 2].map(() => readiness.fetch(request("/api/readiness?wait=1")));
  try {
    const flood = await Promise.all(Array.from({ length: 200 }, () =>
      readiness.fetch(request("/api/readiness?wait=1"))));
    for (const response of flood) {
      expect(response.status).toBe(429);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe("1");
      expect(await response.json()).toEqual({ status: "loading", code: "API_READINESS_BUSY" });
    }
    const status = await readiness.fetch(request());
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ status: "loading" });
    const head = await readiness.fetch(request("/api/readiness?wait=1", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = await readiness.fetch(request("/api/readiness?wait=1", { method: "POST" }));
    expect(post.status).toBe(405);
    const business = await readiness.fetch(request("/api/auth/login", { method: "POST" }));
    expect(business.status).toBe(503);
    readiness.ready(() => new Response("ready"));
    for (const response of await Promise.all(admitted)) {
      expect(await response.json()).toEqual({ status: "ready" });
    }
  } finally {
    readiness.fail();
  }
});

test("aborted overflow probes cannot occupy or release another client's wait slot", async () => {
  const readiness = createApiReadiness({ maxWaiters: 1 });
  const acceptedController = new AbortController();
  const acceptedRequest = request("/api/readiness?wait=1", { signal: acceptedController.signal });
  const acceptedRemove = spyOn(acceptedRequest.signal, "removeEventListener");
  const timers = spyOn(globalThis, "setTimeout");
  const clear = spyOn(globalThis, "clearTimeout");
  const accepted = readiness.fetch(acceptedRequest);
  const acceptedTimer = timers.mock.results[0]!.value;
  const rejectedController = new AbortController();
  const rejectedRequest = request("/api/readiness?wait=1", { signal: rejectedController.signal });
  const rejectedAdd = spyOn(rejectedRequest.signal, "addEventListener");
  try {
    const rejected = readiness.fetch(rejectedRequest);
    rejectedController.abort();
    expect((await rejected).status).toBe(429);
    expect(rejectedAdd).not.toHaveBeenCalled();
    const preAborted = await readiness.fetch(request("/api/readiness?wait=1", {
      signal: rejectedController.signal,
    }));
    expect(preAborted.status).toBe(200);
    expect(await preAborted.json()).toEqual({ status: "loading" });
    expect((await readiness.fetch(request("/api/readiness?wait=1"))).status).toBe(429);
    expect(timers).toHaveBeenCalledTimes(1);
    acceptedController.abort();
    expect(await (await accepted).json()).toEqual({ status: "loading" });
    expect(acceptedRemove).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(acceptedTimer);
    const replacement = readiness.fetch(request("/api/readiness?wait=1"));
    expect((await readiness.fetch(request("/api/readiness?wait=1"))).status).toBe(429);
    readiness.ready(() => new Response("ready"));
    expect(await (await replacement).json()).toEqual({ status: "ready" });
    expect(acceptedRemove).toHaveBeenCalledTimes(1);
    expect(timers).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenCalledWith(timers.mock.results[1]!.value);
  } finally {
    readiness.fail();
    acceptedRemove.mockRestore();
    rejectedAdd.mockRestore();
    timers.mockRestore();
    clear.mockRestore();
  }
});

test("timeout releases both wait capacity and abort subscriptions", async () => {
  const readiness = createApiReadiness({ maxWaiters: 1, waitTimeoutMs: 10 });
  const controller = new AbortController();
  const timedRequest = request("/api/readiness?wait=1", { signal: controller.signal });
  const remove = spyOn(timedRequest.signal, "removeEventListener");
  try {
    const timed = readiness.fetch(timedRequest);
    expect((await readiness.fetch(request("/api/readiness?wait=1"))).status).toBe(429);
    expect(await (await timed).json()).toEqual({ status: "loading" });
    expect(remove).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(remove).toHaveBeenCalledTimes(1);
    const replacement = readiness.fetch(request("/api/readiness?wait=1"));
    expect((await readiness.fetch(request("/api/readiness?wait=1"))).status).toBe(429);
    readiness.ready(() => new Response("ready"));
    expect(await (await replacement).json()).toEqual({ status: "ready" });
  } finally {
    readiness.fail();
    remove.mockRestore();
  }
});

test("ready and failed transitions clear admitted wait resources and never reject terminal probes", async () => {
  for (const outcome of ["ready", "failed"] as const) {
    const readiness = createApiReadiness({ maxWaiters: 1 });
    const controller = new AbortController();
    const admittedRequest = request("/api/readiness?wait=1", { signal: controller.signal });
    const remove = spyOn(admittedRequest.signal, "removeEventListener");
    const timers = spyOn(globalThis, "setTimeout");
    const clear = spyOn(globalThis, "clearTimeout");
    const waiting = readiness.fetch(admittedRequest);
    const admittedTimer = timers.mock.results[0]!.value;
    try {
      expect((await readiness.fetch(request("/api/readiness?wait=1"))).status).toBe(429);
      if (outcome === "ready") readiness.ready(() => new Response("ready"));
      else readiness.fail();
      controller.abort();
      expect(await (await waiting).json()).toEqual({ status: outcome });
      expect(remove).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledWith(admittedTimer);
      const subsequent = await readiness.fetch(request("/api/readiness?wait=1"));
      expect(subsequent.status).toBe(200);
      expect(await subsequent.json()).toEqual({ status: outcome });
      readiness.ready(() => new Response("recovered"));
      expect(await (await readiness.fetch(request("/api/auth/me"))).text()).toBe("recovered");
    } finally {
      readiness.fail();
      remove.mockRestore();
      timers.mockRestore();
      clear.mockRestore();
    }
  }
});

test("default wait ceiling is finite and invalid ceilings cannot silently disable it", async () => {
  for (const maxWaiters of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => createApiReadiness({ maxWaiters })).toThrow(RangeError);
  }
  const noWaits = createApiReadiness({ maxWaiters: 0 });
  expect((await noWaits.fetch(request("/api/readiness?wait=1"))).status).toBe(429);
  expect((await noWaits.fetch(request())).status).toBe(200);
  const readiness = createApiReadiness();
  const admitted = Array.from({ length: 64 }, () => readiness.fetch(request("/api/readiness?wait=1")));
  try {
    expect((await readiness.fetch(request("/api/readiness?wait=1"))).status).toBe(429);
    readiness.ready(() => new Response("ready"));
    for (const response of await Promise.all(admitted)) {
      expect(await response.json()).toEqual({ status: "ready" });
    }
  } finally {
    readiness.fail();
  }
});

test("existing browser readiness caller backs off after wait overflow and recovers without credentials", async () => {
  const readiness = createApiReadiness({ maxWaiters: 1 });
  const occupying = readiness.fetch(request("/api/readiness?wait=1"));
  const paths: string[] = [];
  const statuses: string[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (
    input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1],
  ) => {
    const path = String(input);
    paths.push(path);
    return readiness.fetch(request(path, init));
  }, { preconnect: originalFetch.preconnect }));
  try {
    await waitForApiReady({
      signal: new AbortController().signal,
      deadline: Date.now() + 5_000,
      onStatus(status) {
        statuses.push(status);
        if (status === "connecting" && statuses.length > 1) {
          readiness.ready(() => new Response("ready"));
        }
      },
    });
    expect(statuses).toEqual(["connecting", "loading", "connecting", "ready"]);
    expect(paths).toEqual(["/api/readiness", "/api/readiness?wait=1", "/api/readiness"]);
    expect(await (await occupying).json()).toEqual({ status: "ready" });
  } finally {
    readiness.fail();
    fetchMock.mockRestore();
  }
});

test("real startup listener bounds concurrent long-polls and recovers after readiness", async () => {
  const readiness = createApiReadiness({ maxWaiters: 2 });
  let entered = 0;
  let notifyEntered!: () => void;
  const bothEntered = new Promise<void>((resolve) => { notifyEntered = resolve; });
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const response = readiness.fetch(req);
      if (new URL(req.url).searchParams.get("wait") === "1" && ++entered === 2) notifyEntered();
      return response;
    },
  });
  try {
    const waiting = [1, 2].map(() => fetch(new URL("/api/readiness?wait=1", server.url)));
    await bothEntered;
    const excess = await Promise.all(Array.from({ length: 40 }, () =>
      fetch(new URL("/api/readiness?wait=1", server.url))));
    for (const response of excess) {
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("1");
      expect(await response.json()).toEqual({ status: "loading", code: "API_READINESS_BUSY" });
    }
    const status = await fetch(new URL("/api/readiness", server.url));
    expect(await status.json()).toEqual({ status: "loading" });
    readiness.ready(() => new Response("ready"));
    for (const response of await Promise.all(waiting)) {
      expect(await response.json()).toEqual({ status: "ready" });
    }
    const recovered = await fetch(new URL("/api/readiness?wait=1", server.url));
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ status: "ready" });
  } finally {
    readiness.fail();
    await server.stop(true);
  }
});
