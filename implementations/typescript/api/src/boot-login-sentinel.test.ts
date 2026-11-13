import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { LoginSelfCheckOutcome as Outcome } from "./boot-login-sentinel";

// Exercise the current sentinel body without importing the app/engine/DB graph.
// All HTTP, environment and console effects receive test-local substitutes.
const source = readFileSync(new URL("./boot-login-sentinel.ts", import.meta.url), "utf8");
const appImport = 'import { app } from "./index.js";';
if (source.split(appImport).length !== 2) throw new Error("App import seam changed");
const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(
  source.replace(appImport, "").replaceAll("export async function", "async function"),
);
if (/\bimport\b/.test(javascript)) throw new Error("Harness must not import the app or its graph");

type Sentinel = {
  runLoginSelfCheck(): Promise<Outcome>;
  reportLoginSelfCheck(): Promise<boolean>;
};
type Responder = (request: Request) => Response | Promise<Response>;
type Options = {
  env?: Record<string, string | undefined>;
  login?: Responder;
  me?: Responder;
  logout?: Responder;
};

const email = "FAKE_SENTINEL_EMAIL@example.invalid";
const password = "FAKE_SENTINEL_PASSWORD_20261029";
const token = "FAKE_SENTINEL_BEARER_20261029";
const accountId = "fake-account";
const sessionId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const credentials = { ADMIN_EMAIL: email, ADMIN_PASSWORD: password, DEFAULT_ACCOUNT_ID: accountId };
const factory = new Function("app", "process", "console", `${javascript}\nreturn { runLoginSelfCheck, reportLoginSelfCheck };`);

function setup(options: Options = {}) {
  const calls: Request[] = [];
  const logs: string[] = [];
  const app = {
    async fetch(request: Request) {
      calls.push(request);
      const path = new URL(request.url).pathname;
      if (path === "/api/auth/login") return (options.login ?? (() => Response.json({ token, sessionId, userId })))(request);
      if (path === "/api/auth/me") return (options.me ?? (() => Response.json({ subject: { $tag: "User", userId } })))(request);
      if (path === "/api/auth/logout") return (options.logout ?? (() => Response.json({ revoked: true })))(request);
      throw new Error("Unexpected mocked route");
    },
  };
  const capture = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  const sentinel = factory(app, { env: options.env ?? credentials }, { log: capture, warn: capture, error: capture }) as Sentinel;
  return { ...sentinel, calls, logs };
}

function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of [email, password, token]) expect(text).not.toContain(secret);
}

function expectFailed(outcome: Outcome, detail: string) {
  expect(outcome.status).toBe("failed");
  if (outcome.status === "failed") expect(outcome.detail).toContain(detail);
  expectNoSecrets(outcome);
}

describe("login sentinel", () => {
  test("the harness replaces only the actual app import and has no remaining imports", () => {
    expect(source.split(appImport)).toHaveLength(2);
    expect(javascript).not.toMatch(/\bimport\b/);
  });

  for (const missing of Object.keys(credentials)) {
    test(`unconfigured ${missing} skips loudly without any request`, async () => {
      const env: Record<string, string | undefined> = { ...credentials, [missing]: undefined };
      const sentinel = setup({ env });
      expect(await sentinel.runLoginSelfCheck()).toEqual({ status: "skipped", reason: missing });
      expect(await sentinel.reportLoginSelfCheck()).toBe(true);
      expect(sentinel.calls).toHaveLength(0);
      expect(sentinel.logs.join("\n")).toContain("LOGIN SELF-CHECK SKIPPED");
      expectNoSecrets(sentinel.logs);
    });
  }

  test("confirmed cleanup preserves success shape and exactly three existing requests", async () => {
    const sentinel = setup();
    expect(await sentinel.runLoginSelfCheck()).toEqual({ status: "ok", userId, sessionId });
    expect(sentinel.calls.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ["POST", "/api/auth/login"], ["GET", "/api/auth/me"], ["POST", "/api/auth/logout"],
    ]);
    expect(await sentinel.calls[0]!.json()).toEqual({ email, password, accountId });
    for (const request of sentinel.calls.slice(1)) expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
    expectNoSecrets(sentinel.logs);
  });

  test("only confirmed cleanup reports success and allows readiness", async () => {
    const sentinel = setup();
    expect(await sentinel.reportLoginSelfCheck()).toBe(true);
    expect(sentinel.logs.join("\n")).toContain("session revoked");
    expect(sentinel.logs.join("\n")).toContain(`user ${userId}`);
    expectNoSecrets(sentinel.logs);
    expect(sentinel.calls).toHaveLength(3);
  });

  test("non-200 login retains its route/status without echoing the response body", async () => {
    const sentinel = setup({ login: () => new Response(`${email} ${password} ${token}`, { status: 500 }) });
    expectFailed(await sentinel.runLoginSelfCheck(), "POST /api/auth/login -> 500");
    expect(sentinel.calls).toHaveLength(1);
    const reported = setup({ login: () => new Response(`${email} ${password} ${token}`, { status: 500 }) });
    expect(await reported.reportLoginSelfCheck()).toBe(false);
    expectNoSecrets(reported.logs);
  });

  test("login without a token fails without inventing a cleanup request", async () => {
    const sentinel = setup({ login: () => Response.json({ sessionId, userId }) });
    expectFailed(await sentinel.runLoginSelfCheck(), "POST /api/auth/login -> 200 with no token");
    expect(sentinel.calls).toHaveLength(1);
  });

  test("throwing login fails safely without exposing exception credentials", async () => {
    const login = () => { throw new Error(`${email} ${password} ${token}`); };
    const sentinel = setup({ login });
    expectFailed(await sentinel.runLoginSelfCheck(), "Login self-check request failed");
    expect(sentinel.calls).toHaveLength(1);
    const reported = setup({ login });
    expect(await reported.reportLoginSelfCheck()).toBe(false);
    expectNoSecrets(reported.logs);
  });

  test("non-200 me preserves primary status and still cleans up once", async () => {
    const sentinel = setup({ me: () => Response.json({}, { status: 401 }) });
    const outcome = await sentinel.runLoginSelfCheck();
    expectFailed(outcome, "GET /api/auth/me -> 401");
    expect(outcome).toMatchObject({ sessionId });
    expect(sentinel.calls).toHaveLength(3);
  });

  test("unresolved bearer still cleans up without echoing an untrusted subject tag", async () => {
    const sentinel = setup({ me: () => Response.json({ subject: { $tag: `${email} ${password} ${token}` } }) });
    expectFailed(await sentinel.runLoginSelfCheck(), "GET /api/auth/me");
    expect(sentinel.calls).toHaveLength(3);
  });

  test("unreadable me body fails and cleanup is still attempted once", async () => {
    const sentinel = setup({ me: () => new Response(`${email} ${password} ${token}`) });
    expectFailed(await sentinel.runLoginSelfCheck(), "Login self-check request failed");
    expect(sentinel.calls).toHaveLength(3);
  });

  const badCleanup: [string, Responder, string][] = [
    ["HTTP failure", () => Response.json({ revoked: true, secret: token }, { status: 503 }), "POST /api/auth/logout -> 503"],
    ["explicit revoked:false", () => Response.json({ revoked: false }), "without revoked: true"],
    ["missing revocation field", () => Response.json({}), "without revoked: true"],
    ["string true", () => Response.json({ revoked: "true" }), "without revoked: true"],
    ["numeric true", () => Response.json({ revoked: 1 }), "without revoked: true"],
    ["JSON null", () => Response.json(null), "without revoked: true"],
    ["array", () => Response.json([true]), "without revoked: true"],
    ["unreadable JSON", () => new Response(`${email} ${password} ${token}`), "POST /api/auth/logout failed"],
    ["throwing fetch", () => { throw new Error(`${email} ${password} ${token}`); }, "POST /api/auth/logout failed"],
  ];
  for (const [name, logout, detail] of badCleanup) {
    test(`unconfirmed cleanup: ${name} fails readiness without leaking secrets`, async () => {
      const sentinel = setup({ logout });
      const outcome = await sentinel.runLoginSelfCheck();
      expectFailed(outcome, detail);
      expectFailed(outcome, "session revocation not confirmed");
      expect(outcome).toMatchObject({ sessionId });
      expect(sentinel.calls).toHaveLength(3);
      expectNoSecrets(sentinel.logs);
      const reported = setup({ logout });
      expect(await reported.reportLoginSelfCheck()).toBe(false);
      expect(reported.logs.join("\n")).toContain("LOGIN SELF-CHECK FAILED");
      expect(reported.logs.join("\n")).toContain(`self-check session: ${sessionId}`);
      expect(reported.logs.join("\n")).not.toContain("session revoked");
      expectNoSecrets(reported.logs);
      expect(reported.calls).toHaveLength(3);
    });
  }

  test("primary me failure and failed cleanup retain both diagnostics", async () => {
    const sentinel = setup({
      me: () => Response.json({}, { status: 403 }),
      logout: () => Response.json({ revoked: false }),
    });
    const outcome = await sentinel.runLoginSelfCheck();
    expectFailed(outcome, "GET /api/auth/me -> 403");
    expectFailed(outcome, "POST /api/auth/logout -> 200 without revoked: true");
    expect(sentinel.calls).toHaveLength(3);
  });

  test("primary throw and cleanup throw retain both safe failure stages", async () => {
    const sentinel = setup({
      me: () => { throw new Error(`${password} ${token}`); },
      logout: () => { throw new Error(`${email} ${token}`); },
    });
    const outcome = await sentinel.runLoginSelfCheck();
    expectFailed(outcome, "Login self-check request failed");
    expectFailed(outcome, "POST /api/auth/logout failed");
    expect(sentinel.calls).toHaveLength(3);
    expectNoSecrets(sentinel.logs);
  });

  const unavailableIds: [string, unknown][] = [
    ["absent", undefined], ["empty", ""], ["bearer echo", token],
    ["credential echo", `${email} ${password}`], ["arbitrary text", "fake-session"],
    ["UUID with trailing newline", `${sessionId}\n`],
    ["oversized UUID prefix", `${sessionId}${"x".repeat(2000)}`],
  ];
  for (const [name, unsafeId] of unavailableIds) {
    test(`cleanup recovery log reports unavailable for ${name}`, async () => {
      const options = {
        login: () => Response.json({ token, sessionId: unsafeId, userId }),
        logout: () => Response.json({ revoked: false }),
      };
      const outcome = await setup(options).runLoginSelfCheck();
      expectFailed(outcome, "session revocation not confirmed");
      expect(outcome).toMatchObject({ sessionId: "" });
      const sentinel = setup(options);
      expect(await sentinel.reportLoginSelfCheck()).toBe(false);
      expect(sentinel.logs.join("\n")).toContain("self-check session: unavailable");
      expect(sentinel.logs.join("\n")).not.toContain("delete sessions");
      expect(sentinel.logs.join("\n")).not.toContain("session revoked");
      expectNoSecrets(sentinel.logs);
      expect(sentinel.logs.join("\n").length).toBeLessThan(400);
      expect(sentinel.calls).toHaveLength(3);
    });
  }

  test("a malformed user-id response cannot echo credentials or bearer into outcomes or logs", async () => {
    const options = { me: () => Response.json({ subject: { $tag: "User", userId: `${email} ${password} ${token}` } }) };
    const outcome = await setup(options).runLoginSelfCheck();
    expect(outcome).toEqual({ status: "ok", userId: "", sessionId });
    expectNoSecrets(outcome);
    const sentinel = setup(options);
    expect(await sentinel.reportLoginSelfCheck()).toBe(true);
    expect(sentinel.logs.join("\n")).toContain("user unavailable, session revoked");
    expectNoSecrets(sentinel.logs);
    expect(sentinel.calls).toHaveLength(3);
  });

  for (const secretKind of ["bearer", "password"] as const) {
    for (const revoked of [true, false]) {
      test(`UUID-shaped ${secretKind} echo stays out of outcomes/logs when cleanup ${revoked ? "confirms" : "refuses"}`, async () => {
        const secretUuid = "33333333-3333-4333-8333-333333333333";
        const activeToken = secretKind === "bearer" ? secretUuid : token;
        const activePassword = secretKind === "password" ? secretUuid : password;
        const options = {
          env: { ...credentials, ADMIN_PASSWORD: activePassword },
          login: () => Response.json({ token: activeToken, sessionId: secretUuid, userId }),
          me: () => Response.json({ subject: { $tag: "User", userId: secretUuid } }),
          logout: () => Response.json({ revoked }),
        };
        const checked = setup(options);
        const outcome = await checked.runLoginSelfCheck();
        expect(outcome).toMatchObject({ status: revoked ? "ok" : "failed", sessionId: "" });
        if (outcome.status === "ok") expect(outcome.userId).toBe("");
        expect(JSON.stringify(outcome)).not.toContain(secretUuid);
        expectNoSecrets(outcome);
        expect(checked.calls).toHaveLength(3);
        expect(checked.calls[2]!.headers.get("authorization")).toBe(`Bearer ${activeToken}`);
        const reported = setup(options);
        expect(await reported.reportLoginSelfCheck()).toBe(revoked);
        expect(reported.logs.join("\n")).not.toContain(secretUuid);
        expect(reported.logs.join("\n")).toContain(revoked ? "user unavailable, session revoked" : "self-check session: unavailable");
        expectNoSecrets(reported.logs);
        expect(reported.calls).toHaveLength(3);
      });
    }
  }

  for (const resolution of ["confirmed", "refused", "throwing"] as const) {
    test(`readiness waits for deferred ${resolution} cleanup before reporting any outcome`, async () => {
      let signalLogoutEntered!: () => void;
      let resolveLogout!: (response: Response) => void;
      let rejectLogout!: (reason: unknown) => void;
      const logoutEntered = new Promise<void>((resolve) => { signalLogoutEntered = resolve; });
      const pendingLogout = new Promise<Response>((resolve, reject) => { resolveLogout = resolve; rejectLogout = reject; });
      const sentinel = setup({ logout: () => { signalLogoutEntered(); return pendingLogout; } });
      let reported = false;
      const report = sentinel.reportLoginSelfCheck().then((result) => { reported = true; return result; });
      await logoutEntered;
      await Promise.resolve();
      expect(reported).toBe(false);
      expect(sentinel.logs).toEqual([]);
      expect(sentinel.calls).toHaveLength(3);
      if (resolution === "throwing") rejectLogout(new Error(`${email} ${password} ${token}`));
      else resolveLogout(Response.json({ revoked: resolution === "confirmed" }));
      expect(await report).toBe(resolution === "confirmed");
      expect(reported).toBe(true);
      if (resolution === "confirmed") expect(sentinel.logs.join("\n")).toContain("session revoked");
      else {
        expect(sentinel.logs.join("\n")).toContain("LOGIN SELF-CHECK FAILED");
        expect(sentinel.logs.join("\n")).toContain(`self-check session: ${sessionId}`);
        expect(sentinel.logs.join("\n")).not.toContain("session revoked");
      }
      expectNoSecrets(sentinel.logs);
      expect(sentinel.calls).toHaveLength(3);
    });
  }
});
