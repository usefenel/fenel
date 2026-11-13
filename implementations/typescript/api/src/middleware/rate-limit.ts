// ---------------------------------------------------------------------------
// Rate and payload limits (GP-25) — host middleware, approved TypeScript
// category GP-7 (b): "rate limiting on anonymous, login, signup and API
// routes". Design: docs/gopublic-server-safety-design.md § "GP-25".
//
// A hand-written token bucket per key. No npm package: `bun.lock` is
// compiled-artifact epoch input, so a dependency would cost a regeneration.
//
// Buckets, all of which must have a token for a request to pass:
//   - `(route class, client address)` on every request except webhooks. The
//     address rules (when `CF-Connecting-IP` is believed, IPv6 by /64) live in
//     `./client-ip`;
//   - `(route class, session-token hash)` for EACH token the auth middleware
//     might authenticate the request with (bearer header and session cookie,
//     read by the shared `./session-token`). A decoy token only adds a bucket;
//     it never replaces the real one. Tokens are hashed unverified: they are
//     only bucket keys, and a forged token still pays the address bucket;
//   - webhooks: `(webhook, path)`, i.e. per integration or bot, because every
//     tenant's webhooks arrive from a handful of provider addresses; plus a
//     much looser `(webhook-ip, address)` ceiling so a flood of made-up
//     webhook paths from one address stays bounded;
//   - password logins: `(login-email-ip, email, address)` and a looser
//     `(login-email, email)` ceiling, charged only for FAILED attempts (the
//     token is taken before the route and given back unless it answers 401).
//     An address that has signed in to that email before skips the email-wide
//     ceiling, so strangers' failures cannot lock the owner out from their
//     usual address.
//
// Evaluation routes (`api` class) also run at most N at a time per address
// (default 2); further requests wait in a short queue, then get 429.
//
// The limiter runs BEFORE the auth middleware, so a flood never reaches the
// session lookup in the database.
//
// Limits are counted per process. Cloudflare is the first line of defence;
// this is the second.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { clientIp, readTrustedProxies } from "./client-ip";
import { classifyRoute, ROUTE_CLASSES, type RouteClass } from "./route-classes";
import { SESSION_COOKIE, sessionTokenCandidates } from "./session-token";

/** The session cookie name, from the reader the auth middleware uses. */
export const RATE_LIMIT_SESSION_COOKIE = SESSION_COOKIE;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** A bucket: `capacity` tokens, refilled evenly over `windowMs`. */
export type BucketRule = { readonly capacity: number; readonly windowMs: number };

export type LimitName = RouteClass | "login-email" | "login-email-ip" | "webhook-ip";

/** Defaults, overridable per name through `FENEL_RATE_LIMIT_<NAME>` (upper
 *  case, `-` as `_`), in the form `<count>/<window>`: `120/min`, `10/15min`,
 *  `5/h`, `30/10s`. The GP-38 load test sets the production values. */
export const DEFAULT_LIMITS: Readonly<Record<LimitName, string>> = {
  "anon-read": "120/min",
  "anon-submit": "20/min",
  login: "20/min",
  "login-email-ip": "10/15min",
  "login-email": "100/h",
  signup: "10/h",
  api: "300/min",
  webhook: "600/min",
  "webhook-ip": "6000/min",
  account: "600/min",
};

const LIMIT_NAMES: readonly LimitName[] = [...ROUTE_CLASSES, "login-email", "login-email-ip", "webhook-ip"];

const UNIT_MS: Record<string, number> = { s: 1_000, min: 60_000, h: 3_600_000 };

/** Parse `<count>/<window>`; `undefined` when malformed. */
export function parseBucketRule(raw: string): BucketRule | undefined {
  const m = /^\s*(\d+)\s*\/\s*(\d*)\s*(s|min|h)\s*$/.exec(raw);
  if (!m) return undefined;
  const capacity = Number(m[1]);
  const multiplier = m[2] ? Number(m[2]) : 1;
  if (!(capacity > 0) || !(multiplier > 0)) return undefined;
  return { capacity, windowMs: multiplier * UNIT_MS[m[3]!]! };
}

export function limitEnvName(name: LimitName): string {
  return `FENEL_RATE_LIMIT_${name.toUpperCase().replace(/-/g, "_")}`;
}

/** Read every limit from the environment, falling back to the default (with a
 *  warning) when a value is malformed, as `FENEL_MANAGED_HOURLY_LIMIT` does. */
export function readLimits(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<LimitName, BucketRule> {
  const out = {} as Record<LimitName, BucketRule>;
  for (const name of LIMIT_NAMES) {
    const key = limitEnvName(name);
    const raw = env[key];
    const parsed = raw !== undefined && raw !== "" ? parseBucketRule(raw) : undefined;
    if (raw !== undefined && raw !== "" && !parsed) {
      console.warn(`[api] ${key}="${raw}" is not <count>/<window>; using ${DEFAULT_LIMITS[name]}`);
    }
    out[name] = parsed ?? parseBucketRule(DEFAULT_LIMITS[name])!;
  }
  return out;
}

function readPositiveInt(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = /^\s*\d+\s*$/.test(raw) ? Number(raw) : NaN;
  if (Number.isSafeInteger(n) && n > 0) return n;
  console.warn(`[api] ${key}="${raw}" is not a positive integer; using ${fallback}`);
  return fallback;
}

// ---------------------------------------------------------------------------
// Body caps
// ---------------------------------------------------------------------------

/** A request-body cap, below the server-wide `maxRequestBodySize`. */
export type BodyCapName =
  | "anon-read"
  | "anon-submit"
  | "login"
  | "signup"
  | "api-expression"
  | "api-arguments"
  | "webhook"
  | "account";

const KB = 1024;
const MB = 1024 * KB;

/** Defaults, overridable through `FENEL_BODY_LIMIT_<NAME>` as bytes or with a
 *  `KB` / `MB` suffix. */
export const DEFAULT_BODY_LIMITS: Readonly<Record<BodyCapName, number>> = {
  "anon-read": 64 * KB,
  "anon-submit": 1 * MB,
  login: 4 * KB,
  signup: 8 * KB,
  "api-expression": 64 * KB,
  "api-arguments": 256 * KB,
  webhook: 1 * MB,
  account: 8 * MB,
};

const BODY_CAP_NAMES = Object.keys(DEFAULT_BODY_LIMITS) as BodyCapName[];

export function bodyLimitEnvName(name: BodyCapName): string {
  return `FENEL_BODY_LIMIT_${name.toUpperCase().replace(/-/g, "_")}`;
}

/** Parse `<n>`, `<n>KB` or `<n>MB`; `undefined` when malformed. */
export function parseByteSize(raw: string): number | undefined {
  const m = /^\s*(\d+)\s*(kb|mb)?\s*$/i.exec(raw);
  if (!m) return undefined;
  const unit = m[2]?.toLowerCase();
  const n = Number(m[1]) * (unit === "mb" ? MB : unit === "kb" ? KB : 1);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

export function readBodyLimits(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<BodyCapName, number> {
  const out = {} as Record<BodyCapName, number>;
  for (const name of BODY_CAP_NAMES) {
    const key = bodyLimitEnvName(name);
    const raw = env[key];
    const parsed = raw !== undefined && raw !== "" ? parseByteSize(raw) : undefined;
    if (raw !== undefined && raw !== "" && parsed === undefined) {
      console.warn(`[api] ${key}="${raw}" is not a size; using ${DEFAULT_BODY_LIMITS[name]} bytes`);
    }
    out[name] = parsed ?? DEFAULT_BODY_LIMITS[name];
  }
  return out;
}

function pathSegments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

/** The body cap a request pays, or `"server"` for routes held only by the
 *  server-wide `maxRequestBodySize`:
 *   - inbound mail (Postmark, Mailgun): attachments ride in the body;
 *   - SES: its route sets its own 2 MB cap;
 *   - `/api/imports`: a whole CSV or JSON export in one body. */
export function bodyCapOf(cls: RouteClass, path: string): BodyCapName | "server" {
  const parts = pathSegments(path);
  const hook = parts[0] === "webhooks" ? parts.slice(1) : parts[0] === "api" && parts[1] === "webhooks" ? parts.slice(2) : undefined;
  if (hook) {
    if ((hook[0] === "postmark" || hook[0] === "mailgun") && hook.length === 3 && hook[2] === "inbound") return "server";
    if (hook[0] === "ses") return "server";
  }
  if (parts[0] === "api" && parts[1] === "imports") return "server";
  if (cls === "api") return parts[0] === "api" && parts[1] === "query" ? "api-expression" : "api-arguments";
  return cls;
}

// ---------------------------------------------------------------------------
// Token buckets
// ---------------------------------------------------------------------------

type Bucket = { tokens: number; at: number; rule: BucketRule };

/** One bucket to charge: its key and its rule. */
export type Charge = { readonly key: string; readonly rule: BucketRule };

export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();
  private takesSinceSweep = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 100_000,
  ) {}

  get size(): number {
    return this.buckets.size;
  }

  /** Take one token from every bucket, or from none. Returns 0 when taken,
   *  otherwise the milliseconds until every bucket has a token. */
  take(charges: readonly Charge[]): number {
    const t = this.now();
    const states = charges.map((ch) => this.refilled(ch.key, ch.rule, t));
    let waitMs = 0;
    for (const s of states) {
      if (s.tokens < 1) waitMs = Math.max(waitMs, ((1 - s.tokens) * s.rule.windowMs) / s.rule.capacity);
    }
    if (waitMs > 0) {
      // A full, uncharged bucket equals an absent fresh key. Forget only this
      // request's full keys so refused token/path rotation cannot grow the map
      // or force a sweep through other callers' depleted buckets.
      for (const charge of charges) {
        const state = this.buckets.get(charge.key);
        if (state && state.tokens >= state.rule.capacity) this.buckets.delete(charge.key);
      }
      return Math.ceil(waitMs);
    }
    for (const s of states) s.tokens -= 1;
    if (++this.takesSinceSweep >= 10_000 || this.buckets.size > this.maxKeys) this.sweep(t);
    return 0;
  }

  /** Give back the token `take` took, capped at capacity. */
  refund(charges: readonly Charge[]): void {
    const t = this.now();
    for (const ch of charges) {
      const b = this.buckets.get(ch.key);
      if (!b) continue;
      const s = this.refilled(ch.key, ch.rule, t);
      s.tokens = Math.min(ch.rule.capacity, s.tokens + 1);
    }
  }

  private refilled(key: string, rule: BucketRule, t: number): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: rule.capacity, at: t, rule };
      this.buckets.set(key, b);
      return b;
    }
    const elapsed = Math.max(0, t - b.at);
    b.tokens = Math.min(rule.capacity, b.tokens + (elapsed * rule.capacity) / rule.windowMs);
    b.at = t;
    b.rule = rule;
    return b;
  }

  /** Forget buckets that have refilled completely: they equal a fresh one.
   *  If the map is still over its cap, drop the oldest keys. */
  private sweep(t: number): void {
    this.takesSinceSweep = 0;
    for (const [key, b] of this.buckets) {
      const full = b.tokens + ((t - b.at) * b.rule.capacity) / b.rule.windowMs;
      if (full >= b.rule.capacity) this.buckets.delete(key);
    }
    for (const key of this.buckets.keys()) {
      if (this.buckets.size <= this.maxKeys) break;
      this.buckets.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Concurrency per address (the `api` class)
// ---------------------------------------------------------------------------

/** At most `limit` requests run per key; up to `queue` more wait in order for
 *  at most `waitMs`. `acquire` resolves `false` when the queue is full or the
 *  wait runs out. */
export class InFlightLimiter {
  private readonly running = new Map<string, number>();
  private readonly waiting = new Map<string, Array<() => void>>();

  constructor(
    private readonly limit: number,
    private readonly queue: number,
    private readonly waitMs: number,
  ) {}

  runningFor(key: string): number {
    return this.running.get(key) ?? 0;
  }

  acquire(key: string): Promise<boolean> {
    const n = this.running.get(key) ?? 0;
    if (n < this.limit) {
      this.running.set(key, n + 1);
      return Promise.resolve(true);
    }
    const q = this.waiting.get(key) ?? [];
    if (q.length >= this.queue) return Promise.resolve(false);
    this.waiting.set(key, q);
    return new Promise((resolve) => {
      const grant = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const i = q.indexOf(grant);
        if (i >= 0) q.splice(i, 1);
        if (q.length === 0 && this.waiting.get(key) === q) this.waiting.delete(key);
        resolve(false);
      }, this.waitMs);
      q.push(grant);
    });
  }

  /** Free a slot, handing it straight to the next waiter when there is one. */
  release(key: string): void {
    const q = this.waiting.get(key);
    const next = q?.shift();
    if (q && q.length === 0) this.waiting.delete(key);
    if (next) {
      next();
      return;
    }
    const n = (this.running.get(key) ?? 1) - 1;
    if (n <= 0) this.running.delete(key);
    else this.running.set(key, n);
  }
}

// ---------------------------------------------------------------------------
// Addresses that signed in before
// ---------------------------------------------------------------------------

/** `(email, address)` pairs that completed a password login recently. They
 *  skip the email-wide failure ceiling. Bounded; the oldest pairs go first. */
class KnownLogins {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly now: () => number,
    private readonly ttlMs = 30 * 24 * 3_600_000,
    private readonly maxKeys = 10_000,
  ) {}

  has(key: string): boolean {
    const until = this.seen.get(key);
    if (until === undefined) return false;
    if (until > this.now()) return true;
    this.seen.delete(key);
    return false;
  }

  add(key: string): void {
    this.seen.delete(key);
    this.seen.set(key, this.now() + this.ttlMs);
    for (const k of this.seen.keys()) {
      if (this.seen.size <= this.maxKeys) break;
      this.seen.delete(k);
    }
  }
}

// ---------------------------------------------------------------------------
// Request reading
// ---------------------------------------------------------------------------

type SocketServer = { requestIP?: (req: Request) => { address?: string } | null };

function socketAddressOf(c: Context): string | undefined {
  // Hono on Bun passes the server as the fetch's second argument (`c.env`);
  // `app.request()` in tests passes nothing.
  const env = c.env as SocketServer | { server?: SocketServer } | undefined;
  if (!env || typeof env !== "object") return undefined;
  const server = "server" in env && env.server ? env.server : (env as SocketServer);
  if (typeof server.requestIP !== "function") return undefined;
  try {
    return server.requestIP(c.req.raw)?.address ?? undefined;
  } catch {
    return undefined;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function loginEmailOf(c: Context): Promise<string | undefined> {
  try {
    const body = (await c.req.json()) as { email?: unknown } | null;
    const email = body && typeof body === "object" ? body.email : undefined;
    return typeof email === "string" && email.trim() ? email.trim().toLowerCase().slice(0, 320) : undefined;
  } catch {
    // A malformed body is the route's to reject; the bucket just has no email.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function tooManyRequests(c: Context, waitMs: number): Response {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  c.header("Retry-After", String(seconds));
  c.header("Cache-Control", "no-store");
  return c.json({ error: "Too many requests. Try again shortly.", code: "rate-limited", retryAfter: seconds }, 429);
}

export type RequestLimitOptions = {
  now?: () => number;
  env?: Readonly<Record<string, string | undefined>>;
  maxKeys?: number;
  /** How long an `api` request may wait for a slot (default 30 s). */
  queueWaitMs?: number;
};

const LOGIN_PATH = "/api/auth/login";

/** Rate limits, the `api` concurrency slot, the body cap, then the login
 *  failure buckets. */
export function requestLimits(options: RequestLimitOptions = {}): MiddlewareHandler {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const limits = readLimits(env);
  const bodyLimits = readBodyLimits(env);
  const trustedProxies = readTrustedProxies(env);
  const buckets = new TokenBuckets(now, options.maxKeys);
  const inFlight = new InFlightLimiter(
    readPositiveInt(env, "FENEL_API_CONCURRENCY_PER_IP", 2),
    readPositiveInt(env, "FENEL_API_QUEUE_PER_IP", 16),
    options.queueWaitMs ?? 30_000,
  );
  const knownLogins = new KnownLogins(now);

  return async (c, next) => {
    const cls = classifyRoute(c.req.method, c.req.path) ?? "anon-read";
    const ip = clientIp(c.req.header("cf-connecting-ip"), socketAddressOf(c), trustedProxies);

    const charges: Charge[] = cls === "webhook"
      ? [
          { key: `webhook|path|${c.req.path.slice(0, 256)}`, rule: limits.webhook },
          { key: `webhook-ip|ip|${ip}`, rule: limits["webhook-ip"] },
        ]
      : [{ key: `${cls}|ip|${ip}`, rule: limits[cls] }];
    for (const token of sessionTokenCandidates(c.req.header("authorization"), c.req.header("cookie"))) {
      charges.push({ key: `${cls}|session|${sha256(token)}`, rule: limits[cls] });
    }
    const waitMs = buckets.take(charges);
    if (waitMs > 0) return tooManyRequests(c, waitMs);

    const inner = async (): Promise<Response | void> => {
      if (cls !== "login" || c.req.method !== "POST" || c.req.path !== LOGIN_PATH) {
        await next();
        return;
      }
      const email = await loginEmailOf(c);
      if (!email) {
        await next();
        return;
      }
      const pair = `${email}|${ip}`;
      const failureCharges: Charge[] = [{ key: `login-email-ip|${pair}`, rule: limits["login-email-ip"] }];
      if (!knownLogins.has(pair)) failureCharges.push({ key: `login-email|${email}`, rule: limits["login-email"] });
      const failWaitMs = buckets.take(failureCharges);
      if (failWaitMs > 0) return tooManyRequests(c, failWaitMs);
      await next();
      const status = c.res.status;
      if (status !== 401) buckets.refund(failureCharges);
      if (status >= 200 && status < 300) knownLogins.add(pair);
    };

    const cap = bodyCapOf(cls, c.req.path);
    const capped = (): Promise<Response | void> =>
      cap === "server"
        ? inner()
        : bodyLimit({
            maxSize: bodyLimits[cap],
            onError: (ctx) => ctx.json({ error: "Request body too large.", code: "payload-too-large" }, 413),
          })(c, inner as () => Promise<void>) as Promise<Response | void>;

    if (cls !== "api") return capped();
    if (!(await inFlight.acquire(ip))) return tooManyRequests(c, 1_000);
    try {
      return await capped();
    } finally {
      inFlight.release(ip);
    }
  };
}
