import { afterEach, expect, test } from "bun:test";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { apiReadinessMiddleware } from "./api-readiness-proxy";

const servers: Server[] = [];

async function listen(listener: RequestListener): Promise<string> {
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function proxy(origin: string, timeoutMs = 100, waitTimeoutMs = 500): Promise<string> {
  const middleware = apiReadinessMiddleware({ origin, timeoutMs, waitTimeoutMs });
  return listen((req, res) => middleware(req, res, () => {
    res.writeHead(418);
    res.end("next middleware");
  }));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

test("passes through only the API's explicit readiness status and disables caching", async () => {
  let status = "loading";
  const upstream = await listen((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status }));
  });
  const frontend = await proxy(upstream);
  for (status of ["loading", "ready", "failed"]) {
    const response = await fetch(`${frontend}/api/readiness`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ status });
  }
});

test("a missing listener reports unavailable without a gateway error", async () => {
  const upstream = await listen((_req, res) => res.end());
  await new Promise<void>((resolve) => servers.at(-1)!.close(() => resolve()));
  const frontend = await proxy(upstream);
  const response = await fetch(`${frontend}/api/readiness`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "unavailable" });
});

test("malformed replies and upstream errors cannot claim API readiness", async () => {
  let reply = { code: 200, body: "not json" };
  const upstream = await listen((_req, res) => {
    res.writeHead(reply.code);
    res.end(reply.body);
  });
  const frontend = await proxy(upstream);
  for (reply of [
    { code: 200, body: "not json" },
    { code: 200, body: '{"status":"ok"}' },
    { code: 503, body: '{"status":"loading"}' },
    { code: 404, body: '{"status":"ready"}' },
  ]) {
    const response = await fetch(`${frontend}/api/readiness`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "unavailable" });
  }
});

test("wait=1 allows a long poll and forwards no unrelated query parameters", async () => {
  let upstreamUrl = "";
  const upstream = await listen((req, res) => {
    upstreamUrl = req.url!;
    const timer = setTimeout(() => res.end('{"status":"ready"}'), 60);
    res.on("close", () => clearTimeout(timer));
  });
  const frontend = await proxy(upstream, 10, 500);
  const response = await fetch(`${frontend}/api/readiness?wait=1&other=ignored`);
  expect(await response.json()).toEqual({ status: "ready" });
  expect(upstreamUrl).toBe("/api/readiness?wait=1");
});

test("deployment probes retain their immediate readiness verdict through the development proxy", async () => {
  let status = "loading";
  const upstreamRequests: { url: string; method: string }[] = [];
  const upstream = await listen((req, res) => {
    upstreamRequests.push({ url: req.url!, method: req.method! });
    res.writeHead(status === "ready" ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status }));
  });
  const frontend = await proxy(upstream);
  for (status of ["loading", "ready", "failed", "ready"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(`${frontend}/api/readiness?probe=1&wait=1&other=ignored`, { method });
      expect(response.status).toBe(status === "ready" ? 200 : 503);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      if (method === "HEAD") expect(await response.text()).toBe("");
      else expect(await response.json()).toEqual({ status });
    }
  }
  // Read the same explicit upstream status for HEAD, then omit the body at
  // the downstream HTTP boundary; a HEAD upstream has no JSON to validate.
  expect(upstreamRequests).toEqual(Array.from({ length: 8 }, () => ({
    url: "/api/readiness?probe=1", method: "GET",
  })));
});

test("deployment probes refuse malformed and incoherent upstream status replies", async () => {
  let reply = { code: 200, body: "not json" };
  const upstream = await listen((_req, res) => {
    res.writeHead(reply.code);
    res.end(reply.body);
  });
  const frontend = await proxy(upstream);
  for (reply of [
    { code: 200, body: "not json" },
    { code: 200, body: '{"status":"ok"}' },
    { code: 200, body: '{"status":"loading"}' },
    { code: 200, body: '{"status":"failed"}' },
    { code: 503, body: '{"status":"ready"}' },
    { code: 404, body: '{"status":"ready"}' },
  ]) {
    const response = await fetch(`${frontend}/api/readiness?probe=1`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  }
});

test("deployment probes refuse an absent or unresponsive API and close upstream work", async () => {
  const missing = await listen((_req, res) => res.end());
  await new Promise<void>((resolve) => servers.at(-1)!.close(() => resolve()));
  const frontendMissing = await proxy(missing);
  for (const method of ["GET", "HEAD"]) {
    const response = await fetch(`${frontendMissing}/api/readiness?probe=1`, { method });
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    if (method === "GET") expect(await response.json()).toEqual({ status: "unavailable" });
    else expect(await response.text()).toBe("");
  }
  let closed!: () => void;
  const upstreamClosed = new Promise<void>((resolve) => { closed = resolve; });
  const upstream = await listen((req) => { req.socket.once("close", closed); });
  const frontend = await proxy(upstream, 25, 30_000);
  const response = await fetch(`${frontend}/api/readiness?probe=1&wait=1`);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "busy" });
  await upstreamClosed;
});

test("an API that accepts but does not answer is busy, and its upstream request is closed", async () => {
  let closed!: () => void;
  const upstreamClosed = new Promise<void>((resolve) => { closed = resolve; });
  const upstream = await listen((req) => { req.socket.once("close", closed); });
  const frontend = await proxy(upstream, 25);
  const response = await fetch(`${frontend}/api/readiness`);
  expect(response.status).toBe(200);
  // Busy, not unavailable: the client bounds it by the boot deadline, so a
  // cold boot that blocks the API's event loop is not reported as a dead API.
  expect(await response.json()).toEqual({ status: "busy" });
  await upstreamClosed;
});

test("closing the browser request cancels the upstream long poll", async () => {
  let started!: () => void;
  let closed!: () => void;
  const upstreamStarted = new Promise<void>((resolve) => { started = resolve; });
  const upstreamClosed = new Promise<void>((resolve) => { closed = resolve; });
  const upstream = await listen((req) => {
    req.socket.once("close", closed);
    started();
  });
  const frontend = await proxy(upstream, 100, 30_000);
  const controller = new AbortController();
  const request = fetch(`${frontend}/api/readiness?wait=1`, { signal: controller.signal });
  // Attach a rejection handler before aborting, then wait for the observable
  // upstream disconnect rather than relying on the proxy timeout.
  const result = request.catch((error: unknown) => error);
  await upstreamStarted;
  controller.abort();
  expect(await result).toMatchObject({ name: "AbortError" });
  await upstreamClosed;
});

test("other API paths and methods retain their ordinary proxy behavior", async () => {
  let upstreamCalls = 0;
  const upstream = await listen((_req, res) => {
    upstreamCalls += 1;
    res.end('{"status":"ready"}');
  });
  const frontend = await proxy(upstream);
  for (const [path, method] of [
    ["/api/auth/login", "POST"],
    ["/api/readiness/other", "GET"],
    ["/api/readiness", "POST"],
    ["/api/readiness", "HEAD"],
    ["/api/readiness?probe=1", "POST"],
    ["/api/readiness/other?probe=1", "GET"],
  ]) {
    const response = await fetch(`${frontend}${path}`, { method });
    expect(response.status).toBe(418);
    expect(await response.text()).toBe(method === "HEAD" ? "" : "next middleware");
  }
  expect(upstreamCalls).toBe(0);
});
