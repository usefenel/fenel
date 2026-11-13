// GP-25 — the token bucket, the 429 and 413 answers, and the key rules.
// Pure: mounts `requestLimits` on a bare Hono app with a fake clock and a fake
// Bun server (for the socket address); no registry, no database.

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { addressKey, canonicalIp, clientIp, readTrustedProxies } from "./client-ip";
import {
  bodyCapOf,
  DEFAULT_BODY_LIMITS,
  DEFAULT_LIMITS,
  InFlightLimiter,
  limitEnvName,
  parseBucketRule,
  parseByteSize,
  readBodyLimits,
  readLimits,
  requestLimits,
  TokenBuckets,
} from "./rate-limit";
import { classifyRoute } from "./route-classes";
import { sessionTokenCandidates } from "./session-token";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

/** Bun's server as Hono sees it in `c.env`: only `requestIP`. */
const serverFor = (address: string) => ({ requestIP: () => ({ address }) });

type Send = (path: string, init?: RequestInit & { peer?: string; cf?: string }) => Promise<Response>;

function appWith(
  env: Record<string, string>,
  now: () => number,
  extra?: (app: Hono) => void,
  queueWaitMs?: number,
): { app: Hono; send: Send } {
  const app = new Hono();
  app.use("*", requestLimits({ env, now, queueWaitMs }));
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/profiles", (c) => c.json({ ok: true }));
  app.post("/api/query", async (c) => c.json({ size: (await c.req.text()).length }));
  app.post("/api/actions/:name", async (c) => c.json({ size: (await c.req.text()).length }));
  app.post("/api/imports/profiles", async (c) => c.json({ size: (await c.req.text()).length }));
  app.post("/webhooks/telegram/:botId", (c) => c.json({ ok: true }));
  app.post("/webhooks/postmark/:id/inbound", async (c) => c.json({ size: (await c.req.text()).length }));
  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    if (body.password !== "right") return c.json({ error: "Invalid email or password" }, 401);
    return c.json({ email: body.email ?? null });
  });
  extra?.(app);
  // Default peer: loopback, as cloudflared or the local web front would be.
  const send: Send = (path, init = {}) => {
    const { peer = "127.0.0.1", cf, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (cf !== undefined) headers.set("cf-connecting-ip", cf);
    return Promise.resolve(app.fetch(new Request(`http://x${path}`, { ...rest, headers }), serverFor(peer)));
  };
  return { app, send };
}

describe("parseBucketRule / readLimits", () => {
  it("parses count/window forms", () => {
    expect(parseBucketRule("120/min")).toEqual({ capacity: 120, windowMs: 60_000 });
    expect(parseBucketRule("10/15min")).toEqual({ capacity: 10, windowMs: 900_000 });
    expect(parseBucketRule("5/h")).toEqual({ capacity: 5, windowMs: 3_600_000 });
    expect(parseBucketRule("30/10s")).toEqual({ capacity: 30, windowMs: 10_000 });
  });

  it("rejects malformed and zero values", () => {
    for (const bad of ["", "abc", "0/min", "10/0min", "10/day", "-1/min", "10"]) {
      expect(parseBucketRule(bad)).toBeUndefined();
    }
  });

  it("reads FENEL_RATE_LIMIT_<NAME> and falls back to the default on a bad value", () => {
    expect(limitEnvName("anon-read")).toBe("FENEL_RATE_LIMIT_ANON_READ");
    expect(limitEnvName("login-email-ip")).toBe("FENEL_RATE_LIMIT_LOGIN_EMAIL_IP");
    const limits = readLimits({ FENEL_RATE_LIMIT_ACCOUNT: "7/s", FENEL_RATE_LIMIT_API: "nonsense" });
    expect(limits.account).toEqual({ capacity: 7, windowMs: 1_000 });
    expect(limits.api).toEqual(parseBucketRule(DEFAULT_LIMITS.api)!);
    expect(limits["webhook-ip"]).toEqual(parseBucketRule(DEFAULT_LIMITS["webhook-ip"])!);
  });
});

describe("TokenBuckets", () => {
  const rule = (capacity: number, windowMs: number) => ({ capacity, windowMs });
  const on = (key: string, r: { capacity: number; windowMs: number }) => [{ key, rule: r }];

  it("allows the burst, refuses the next, and refills over time", () => {
    const c = clock();
    const buckets = new TokenBuckets(c.now);
    const r = rule(3, 3_000); // one token per second
    expect(buckets.take(on("k", r))).toBe(0);
    expect(buckets.take(on("k", r))).toBe(0);
    expect(buckets.take(on("k", r))).toBe(0);
    expect(buckets.take(on("k", r))).toBe(1_000);
    c.advance(500);
    expect(buckets.take(on("k", r))).toBe(500);
    c.advance(500);
    expect(buckets.take(on("k", r))).toBe(0);
    expect(buckets.take(on("k", r))).toBeGreaterThan(0);
    c.advance(10_000); // refill caps at capacity
    for (let i = 0; i < 3; i++) expect(buckets.take(on("k", r))).toBe(0);
    expect(buckets.take(on("k", r))).toBeGreaterThan(0);
  });

  it("takes from every bucket or from none, each with its own rule", () => {
    const buckets = new TokenBuckets(clock().now);
    const one = rule(1, 1_000);
    const many = rule(100, 1_000);
    expect(buckets.take(on("a", one))).toBe(0);
    // "a" is empty, so "b" must not be charged.
    expect(buckets.take([{ key: "a", rule: one }, { key: "b", rule: many }])).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) expect(buckets.take(on("b", many))).toBe(0);
    expect(buckets.take(on("b", many))).toBeGreaterThan(0);
  });

  it("gives a token back on refund, never past capacity", () => {
    const buckets = new TokenBuckets(clock().now);
    const r = rule(1, 60_000);
    expect(buckets.take(on("k", r))).toBe(0);
    buckets.refund(on("k", r));
    buckets.refund(on("k", r));
    expect(buckets.take(on("k", r))).toBe(0);
    expect(buckets.take(on("k", r))).toBeGreaterThan(0);
  });

  it("forgets refilled buckets when the key cap is reached", () => {
    const c = clock();
    const buckets = new TokenBuckets(c.now, 10);
    const r = rule(1, 1_000);
    for (let i = 0; i < 11; i++) buckets.take(on(`k${i}`, r));
    expect(buckets.size).toBeLessThanOrEqual(10);
    c.advance(2_000);
    buckets.take(on("fresh", r));
    for (let i = 0; i < 20; i++) buckets.take(on(`n${i}`, r));
    expect(buckets.size).toBeLessThanOrEqual(10);
  });

  it("bounds rotating keys on refused requests without charging or resetting their buckets", () => {
    const c = clock();
    const buckets = new TokenBuckets(c.now, 2);
    const r = rule(1, 1_000);
    expect(buckets.take(on("ip", r))).toBe(0);
    for (let i = 0; i < 20; i++) {
      expect(buckets.take([{ key: "ip", rule: r }, { key: `token${i}`, rule: r }])).toBe(1_000);
      expect(buckets.size).toBeLessThanOrEqual(2);
    }
    // A refused request has not consumed the fresh token's allowance.
    expect(buckets.take(on("token19", r))).toBe(0);
    expect(buckets.take(on("token19", r))).toBe(1_000);
    // Rejected requests have preserved the exhausted address bucket and its refill.
    expect(buckets.take(on("ip", r))).toBe(1_000);
    c.advance(1_000);
    expect(buckets.take([{ key: "ip", rule: r }, { key: "token19", rule: r }])).toBe(0);
    expect(buckets.size).toBeLessThanOrEqual(2);
  });

  it("preserves a full map of depleted callers while refusing new keys", () => {
    const c = clock();
    const buckets = new TokenBuckets(c.now, 2);
    const r = rule(1, 1_000);
    expect(buckets.take(on("ip", r))).toBe(0);
    expect(buckets.take(on("session", r))).toBe(0);
    for (let i = 0; i < 20; i++) {
      expect(buckets.take([{ key: "ip", rule: r }, { key: `token${i}`, rule: r }])).toBe(1_000);
      expect(buckets.size).toBe(2);
    }
    expect(buckets.take(on("session", r))).toBe(1_000);
    expect(buckets.take(on("ip", r))).toBe(1_000);
  });
});

describe("client address key", () => {
  it("spells addresses one way", () => {
    expect(canonicalIp(" 203.0.113.7 ")).toBe("203.0.113.7");
    expect(canonicalIp("2001:DB8::1")).toBe("2001:db8:0:0:0:0:0:1");
    expect(canonicalIp("[2001:db8::1]")).toBe("2001:db8:0:0:0:0:0:1");
    expect(canonicalIp("fe80::1%eth0")).toBe("fe80:0:0:0:0:0:0:1");
    expect(canonicalIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(canonicalIp("::ffff:c000:201")).toBe("192.0.2.1");
    expect(canonicalIp("::1")).toBe("0:0:0:0:0:0:0:1");
    for (const bad of ["", "not an ip; drop table", "1".repeat(60), "256.1.1.1", "1.2.3", "1::2::3", ":::", "12345::1", "1:2:3:4:5:6:7:8:9"]) {
      expect(canonicalIp(bad)).toBeUndefined();
    }
  });

  it("keys IPv6 on its /64 and IPv4-mapped addresses as IPv4", () => {
    expect(addressKey(canonicalIp("2001:db8:1:2:aaaa::1")!)).toBe("2001:db8:1:2::/64");
    expect(addressKey(canonicalIp("2001:db8:1:2:ffff:ffff:ffff:ffff")!)).toBe("2001:db8:1:2::/64");
    expect(clientIp(undefined, "::ffff:198.51.100.2")).toBe("198.51.100.2");
  });

  it("believes CF-Connecting-IP only from a loopback or trusted peer", () => {
    expect(clientIp("203.0.113.7", "127.0.0.1")).toBe("203.0.113.7");
    expect(clientIp("203.0.113.7", "::1")).toBe("203.0.113.7");
    expect(clientIp("203.0.113.7", "::ffff:127.0.0.1")).toBe("203.0.113.7");
    expect(clientIp("203.0.113.7", "198.51.100.2")).toBe("198.51.100.2");
    const trusted = readTrustedProxies({ FENEL_TRUSTED_PROXY_IPS: "10.0.0.5, bogus" });
    expect(clientIp("203.0.113.7", "10.0.0.5", trusted)).toBe("203.0.113.7");
    expect(clientIp("203.0.113.7", "10.0.0.6", trusted)).toBe("10.0.0.6");
  });

  it("falls back to the peer when the header is absent or malformed", () => {
    expect(clientIp(undefined, "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIp("not an ip", "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIp(undefined, undefined)).toBe("unknown");
    // No peer (only `app.request()` in tests): the header is not believed.
    expect(clientIp("203.0.113.7", undefined)).toBe("unknown");
  });

  it("a direct client cannot rotate the header to get fresh buckets", async () => {
    const { send } = appWith({ FENEL_RATE_LIMIT_ACCOUNT: "1/min" }, clock().now);
    expect((await send("/api/profiles", { peer: "198.51.100.9", cf: "192.0.2.1" })).status).toBe(200);
    expect((await send("/api/profiles", { peer: "198.51.100.9", cf: "192.0.2.2" })).status).toBe(429);
  });

  it("an IPv6 client cannot rotate within its /64", async () => {
    const { send } = appWith({ FENEL_RATE_LIMIT_ACCOUNT: "1/min" }, clock().now);
    expect((await send("/api/profiles", { cf: "2001:db8:5:6::1" })).status).toBe(200);
    expect((await send("/api/profiles", { cf: "2001:db8:5:6::2" })).status).toBe(429);
    expect((await send("/api/profiles", { cf: "2001:db8:5:7::1" })).status).toBe(200);
  });

  it("reads the socket address from Bun's server in c.env", async () => {
    const { send } = appWith({ FENEL_RATE_LIMIT_ACCOUNT: "1/min" }, clock().now);
    expect((await send("/api/profiles", { peer: "10.0.0.1" })).status).toBe(200);
    expect((await send("/api/profiles", { peer: "10.0.0.1" })).status).toBe(429);
    expect((await send("/api/profiles", { peer: "10.0.0.2" })).status).toBe(200);
  });
});

describe("session token key", () => {
  it("lists every token the auth middleware might accept, as it reads them", () => {
    expect(sessionTokenCandidates("Bearer abc", "fenel_session=def")).toEqual(["abc", "def"]);
    expect(sessionTokenCandidates(undefined, "a=1; fenel_session=def%3D; b=2")).toEqual(["def="]);
    // Duplicates: the auth middleware keeps the LAST cookie.
    expect(sessionTokenCandidates(undefined, "fenel_session=decoy; fenel_session=real")).toEqual(["real"]);
    expect(sessionTokenCandidates("Bearer same", "fenel_session=same")).toEqual(["same"]);
    expect(sessionTokenCandidates("Basic zzz", "other=1")).toEqual([]);
    expect(sessionTokenCandidates(undefined, "fenel_session=%E0%A4%A")).toEqual([]);
  });

  it("limits one session across addresses", async () => {
    const { send } = appWith({ FENEL_RATE_LIMIT_ACCOUNT: "2/min" }, clock().now);
    const from = (ip: string) => send("/api/profiles", { cf: ip, headers: { cookie: "fenel_session=tok" } });
    expect((await from("192.0.2.1")).status).toBe(200);
    expect((await from("192.0.2.2")).status).toBe(200);
    expect((await from("192.0.2.3")).status).toBe(429);
    // Without the session, a fresh address is not held back.
    expect((await send("/api/profiles", { cf: "192.0.2.4" })).status).toBe(200);
  });

  it("a decoy bearer token or a decoy cookie does not skip the real session's bucket", async () => {
    const { send } = appWith({ FENEL_RATE_LIMIT_ACCOUNT: "2/min" }, clock().now);
    const cookie = { cookie: "fenel_session=real" };
    expect((await send("/api/profiles", { cf: "192.0.2.1", headers: cookie })).status).toBe(200);
    expect((await send("/api/profiles", {
      cf: "192.0.2.2",
      headers: { ...cookie, authorization: `Bearer ${crypto.randomUUID()}` },
    })).status).toBe(200);
    expect((await send("/api/profiles", {
      cf: "192.0.2.3",
      headers: { authorization: `Bearer ${crypto.randomUUID()}`, ...cookie },
    })).status).toBe(429);
    expect((await send("/api/profiles", {
      cf: "192.0.2.4",
      headers: { cookie: `fenel_session=${crypto.randomUUID()}; fenel_session=real` },
    })).status).toBe(429);
  });
});

describe("requestLimits middleware", () => {
  it("answers 429 with Retry-After once a class bucket is empty, then recovers", async () => {
    const c = clock();
    const { send } = appWith({ FENEL_RATE_LIMIT_ANON_READ: "2/10s" }, c.now);
    const hit = () => send("/api/health", { cf: "192.0.2.10" });
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    const refused = await hit();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("5");
    expect(await refused.json()).toMatchObject({ code: "rate-limited", retryAfter: 5 });
    c.advance(5_000);
    expect((await hit()).status).toBe(200);
  });

  it("gives each route class its own bucket", async () => {
    const { send } = appWith({ FENEL_RATE_LIMIT_ANON_READ: "1/min", FENEL_RATE_LIMIT_ACCOUNT: "1/min" }, clock().now);
    expect((await send("/api/health", { cf: "192.0.2.11" })).status).toBe(200);
    expect((await send("/api/health", { cf: "192.0.2.11" })).status).toBe(429);
    expect((await send("/api/profiles", { cf: "192.0.2.11" })).status).toBe(200);
  });

  it("limits a 404 as anon-read", async () => {
    expect(classifyRoute("GET", "/no/such/route")).toBeUndefined();
    const { send } = appWith({ FENEL_RATE_LIMIT_ANON_READ: "1/min" }, clock().now);
    expect((await send("/no/such/route", { cf: "192.0.2.30" })).status).toBe(404);
    expect((await send("/api/health", { cf: "192.0.2.30" })).status).toBe(429);
  });
});

describe("login buckets", () => {
  const loginVia = (send: Send) => (ip: string, email: string, password = "wrong") =>
    send("/api/auth/login", {
      method: "POST",
      cf: ip,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

  it("charges failed attempts per (email, address), not successes", async () => {
    const { send } = appWith({ FENEL_RATE_LIMIT_LOGIN_EMAIL_IP: "2/15min" }, clock().now);
    const login = loginVia(send);
    for (let i = 0; i < 5; i++) expect((await login("192.0.2.20", "rom@example.com", "right")).status).toBe(200);
    expect((await login("192.0.2.20", "Rom@Example.com")).status).toBe(401);
    expect((await login("192.0.2.20", "rom@example.com ")).status).toBe(401);
    const refused = await login("192.0.2.20", "ROM@example.com");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another address guessing at the same email is not refused by this bucket.
    expect((await login("192.0.2.21", "rom@example.com")).status).toBe(401);
  });

  it("strangers' failures cannot lock the owner out from an address that signed in before", async () => {
    const { send } = appWith(
      { FENEL_RATE_LIMIT_LOGIN_EMAIL: "3/h", FENEL_RATE_LIMIT_LOGIN_EMAIL_IP: "100/h" },
      clock().now,
    );
    const login = loginVia(send);
    expect((await login("198.51.100.1", "owner@example.com", "right")).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await login(`203.0.113.${i}`, "owner@example.com")).status).toBe(401);
    // The email-wide ceiling is spent: a new address is refused...
    expect((await login("203.0.113.50", "owner@example.com", "right")).status).toBe(429);
    // ...but the owner's known address still signs in.
    expect((await login("198.51.100.1", "owner@example.com", "right")).status).toBe(200);
  });

  it("still hands the login body to the route after reading the email", async () => {
    const { send } = appWith({}, clock().now);
    const res = await loginVia(send)("192.0.2.1", "a@b.c", "right");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "a@b.c" });
  });
});

describe("body caps", () => {
  it("picks a cap per route, with whole-file routes left to the server ceiling", () => {
    expect(bodyCapOf("login", "/api/auth/login")).toBe("login");
    expect(bodyCapOf("api", "/api/query")).toBe("api-expression");
    expect(bodyCapOf("api", "/api/query/compare")).toBe("api-expression");
    expect(bodyCapOf("api", "/api/actions/save")).toBe("api-arguments");
    expect(bodyCapOf("api", "/api/functions/greet/run")).toBe("api-arguments");
    expect(bodyCapOf("webhook", "/webhooks/telegram/123")).toBe("webhook");
    expect(bodyCapOf("webhook", "/webhooks/postmark/abc/inbound")).toBe("server");
    expect(bodyCapOf("webhook", "/api/webhooks/mailgun/abc/inbound")).toBe("server");
    expect(bodyCapOf("webhook", "/webhooks/postmark/abc/events")).toBe("webhook");
    expect(bodyCapOf("webhook", "/webhooks/ses/abc/events")).toBe("server");
    expect(bodyCapOf("account", "/api/imports/profiles")).toBe("server");
    expect(bodyCapOf("account", "/api/profiles")).toBe("account");
  });

  it("reads FENEL_BODY_LIMIT_<NAME> as bytes, KB or MB", () => {
    expect(parseByteSize("512")).toBe(512);
    expect(parseByteSize("64KB")).toBe(65_536);
    expect(parseByteSize("2 mb")).toBe(2_097_152);
    expect(parseByteSize("0")).toBeUndefined();
    expect(parseByteSize("1.5MB")).toBeUndefined();
    const caps = readBodyLimits({ FENEL_BODY_LIMIT_API_ARGUMENTS: "1MB", FENEL_BODY_LIMIT_LOGIN: "lots" });
    expect(caps["api-arguments"]).toBe(1_048_576);
    expect(caps.login).toBe(DEFAULT_BODY_LIMITS.login);
  });

  it("answers 413 on a login body over the cap, with and without Content-Length", async () => {
    const { send } = appWith({}, clock().now);
    const big = JSON.stringify({ email: "a@b.c", password: "x".repeat(DEFAULT_BODY_LIMITS.login + 1) });
    const withLength = await send("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(big.length) },
      body: big,
    });
    expect(withLength.status).toBe(413);
    expect(await withLength.json()).toMatchObject({ code: "payload-too-large" });

    const bytes = new TextEncoder().encode(big);
    const streamed = await send("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 2_000));
          controller.enqueue(bytes.subarray(2_000));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(streamed.status).toBe(413);
  });

  it("caps an expression at 64 KB and arguments at 256 KB", async () => {
    const { send } = appWith({}, clock().now);
    const post = (path: string, size: number) =>
      send(path, { method: "POST", headers: { "content-length": String(size) }, body: "x".repeat(size) });
    expect((await post("/api/query", 64 * 1024)).status).toBe(200);
    expect((await post("/api/query", 64 * 1024 + 1)).status).toBe(413);
    expect((await post("/api/actions/save", 256 * 1024)).status).toBe(200);
    expect((await post("/api/actions/save", 256 * 1024 + 1)).status).toBe(413);
  });

  it("lets inbound mail and imports past the webhook and account caps", async () => {
    const { send } = appWith({}, clock().now);
    const size = 3 * 1024 * 1024;
    const post = (path: string) =>
      send(path, { method: "POST", headers: { "content-length": String(size) }, body: "x".repeat(size) });
    expect((await post("/webhooks/postmark/abc/inbound")).status).toBe(200);
    expect((await post("/api/imports/profiles")).status).toBe(200);
    expect((await post("/webhooks/telegram/123")).status).toBe(413);
  });
});

describe("webhook buckets", () => {
  it("keys on the integration path, not the provider's address", async () => {
    const { send } = appWith({ FENEL_RATE_LIMIT_WEBHOOK: "2/min" }, clock().now);
    const hook = (bot: string) => send(`/webhooks/telegram/${bot}`, { method: "POST", cf: "149.154.167.1" });
    expect((await hook("busy")).status).toBe(200);
    expect((await hook("busy")).status).toBe(200);
    expect((await hook("busy")).status).toBe(429);
    // Another tenant's bot, from the same provider address, is not starved.
    expect((await hook("quiet")).status).toBe(200);
  });

  it("still bounds made-up webhook paths from one address", async () => {
    const { send } = appWith({ FENEL_RATE_LIMIT_WEBHOOK_IP: "3/min" }, clock().now);
    for (let i = 0; i < 3; i++) {
      expect((await send(`/webhooks/telegram/fake${i}`, { method: "POST", cf: "192.0.2.77" })).status).toBe(200);
    }
    expect((await send("/webhooks/telegram/fake9", { method: "POST", cf: "192.0.2.77" })).status).toBe(429);
  });
});

describe("api concurrency per address", () => {
  it("runs at most N at once, queues the next, and refuses past the queue", async () => {
    const limiter = new InFlightLimiter(2, 1, 1_000);
    expect(await limiter.acquire("a")).toBe(true);
    expect(await limiter.acquire("a")).toBe(true);
    let third = false;
    const waiting = limiter.acquire("a").then((ok) => { third = ok; });
    expect(await limiter.acquire("a")).toBe(false); // the queue (1) is full
    expect(await limiter.acquire("b")).toBe(true); // other keys are separate
    expect(third).toBe(false);
    limiter.release("a"); // hands the slot to the waiter
    await waiting;
    expect(third).toBe(true);
    expect(limiter.runningFor("a")).toBe(2);
    limiter.release("a");
    limiter.release("a");
    expect(limiter.runningFor("a")).toBe(0);
  });

  it("gives up on a waiter after the wait limit", async () => {
    const limiter = new InFlightLimiter(1, 4, 20);
    expect(await limiter.acquire("a")).toBe(true);
    expect(await limiter.acquire("a")).toBe(false);
    limiter.release("a");
    expect(limiter.runningFor("a")).toBe(0);
  });

  it("holds the third concurrent evaluation from one address until a slot frees", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    let started = 0;
    const { send } = appWith(
      { FENEL_API_CONCURRENCY_PER_IP: "2", FENEL_API_QUEUE_PER_IP: "1" },
      clock().now,
      (app) => app.post("/api/io/invoke", async (c) => { started++; await gate; return c.json({ ok: true }); }),
      5_000,
    );
    const call = () => send("/api/io/invoke", { method: "POST", cf: "192.0.2.50" });
    const first = [call(), call(), call()];
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toBe(2);
    expect((await call()).status).toBe(429); // the queue is full
    open();
    const statuses = (await Promise.all(first)).map((r) => r.status);
    expect(statuses).toEqual([200, 200, 200]);
    expect(started).toBe(3);
  });
});

describe("classifyRoute", () => {
  it("sorts representative paths", () => {
    expect(classifyRoute("GET", "/p/acme/launch")).toBe("anon-read");
    expect(classifyRoute("POST", "/p/acme/launch/submit")).toBe("anon-submit");
    expect(classifyRoute("POST", "/api/embed/forms/signup/submit")).toBe("anon-submit");
    expect(classifyRoute("GET", "/api/@acme/tag1")).toBe("anon-read");
    expect(classifyRoute("POST", "/api/auth/login")).toBe("login");
    expect(classifyRoute("POST", "/api/auth/signup")).toBe("signup");
    expect(classifyRoute("GET", "/api/auth/me")).toBe("account");
    expect(classifyRoute("POST", "/api/functions/greet/run")).toBe("api");
    expect(classifyRoute("GET", "/api/functions/greet")).toBe("account");
    expect(classifyRoute("POST", "/webhooks/ses/abc/events")).toBe("webhook");
    expect(classifyRoute("POST", "/api/intake/events/inbound")).toBe("webhook");
    expect(classifyRoute("GET", "/api/accounts")).toBeUndefined();
  });
});
