import { describe, expect, test } from "bun:test";
import { createAccountSessionRoutes, type AccountSessionDependencies } from "./routes/account-sessions";

// The rules (session liveness, the account id's shape, the membership recheck,
// the source expiry, revoking the replaced session, the cookie max-age) are the
// Fenel actions' and are pinned in `runtime/src/account-selection.test.ts`
// through the real privileged door. This file pins only the HTTP framing.
const currentAccount = "10000000-0000-4000-8000-000000000001";
const nextAccount = "20000000-0000-4000-8000-000000000002";
const token = "raw-session-token";
const NOW = 1_790_000_000_000;

function fixture(overrides: Partial<AccountSessionDependencies> = {}) {
  const calls: Array<{ kind: string; args: unknown[] }> = [];
  const dependencies: AccountSessionDependencies = {
    sessionToken: () => token,
    listAccounts: async (...args) => {
      calls.push({ kind: "list", args });
      return { currentAccountId: currentAccount, accounts: [{ accountId: currentAccount, name: "Personal", slug: "personal", role: "owner" }] };
    },
    personalAccount: async (...args) => {
      calls.push({ kind: "personal", args });
      return { kind: "ready", accountId: nextAccount };
    },
    switchAccount: async (...args) => {
      calls.push({ kind: "switch", args });
      return { kind: "switched", token: "next-token", userId: "authenticated-user", accountId: nextAccount, maxAgeSeconds: 60 };
    },
    cookie: (...args) => { calls.push({ kind: "cookie", args }); return "fenel_session=next-token; HttpOnly; SameSite=Lax"; },
    now: () => NOW,
    ...overrides,
  };
  const app = createAccountSessionRoutes(dependencies);
  const switchTo = (body: unknown = { accountId: nextAccount }) => app.request("/switch-account", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { app, calls, switchTo };
}

describe("account selection: the HTTP framing", () => {
  test("a request without an authenticated user session reaches neither action", async () => {
    const f = fixture({ sessionToken: () => undefined });
    expect((await f.app.request("/accounts?userId=spoofed")).status).toBe(401);
    expect((await f.switchTo({ accountId: nextAccount, userId: "spoofed" })).status).toBe(401);
    expect(f.calls).toEqual([]);
  });

  test("the account list is read with the request's own token, never a query parameter", async () => {
    const f = fixture();
    const response = await f.app.request("/accounts?userId=spoofed");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ currentAccountId: currentAccount,
      accounts: [{ accountId: currentAccount, name: "Personal", slug: "personal", role: "owner" }] });
    expect(f.calls).toEqual([{ kind: "list", args: [token] }]);
  });

  test("a token that no longer names a live session lists nothing", async () => {
    const f = fixture({ listAccounts: async () => null });
    expect((await f.app.request("/accounts")).status).toBe(401);
  });

  test("a switch passes the token, the requested id and the clock, and sets the issued cookie", async () => {
    const f = fixture();
    const response = await f.switchTo({ accountId: nextAccount, userId: "spoofed", expiresAt: null });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ subject: { $tag: "User", userId: "authenticated-user", accountId: nextAccount } });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(f.calls).toEqual([
      { kind: "switch", args: [token, nextAccount, NOW] },
      { kind: "cookie", args: ["next-token", 60] },
    ]);
  });

  test("a session without an expiry gets the cookie's default lifetime", async () => {
    const f = fixture({ switchAccount: async () => ({ kind: "switched", token: "next-token", userId: "u", accountId: nextAccount }) });
    expect((await f.switchTo()).status).toBe(200);
    expect(f.calls).toEqual([{ kind: "cookie", args: ["next-token", undefined] }]);
  });

  test("a refusal keeps its status and message, and sets no cookie", async () => {
    for (const status of [400, 401, 403] as const) {
      const f = fixture({ switchAccount: async () => ({ kind: "refused", status, message: `refused ${status}` }) });
      const response = await f.switchTo();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: `refused ${status}` });
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(f.calls.some((call) => call.kind === "cookie")).toBe(false);
    }
  });

  test("a body without a string accountId is passed on as an empty id, for Fenel to refuse", async () => {
    for (const body of [null, [], {}, { accountId: 7 }]) {
      const f = fixture();
      await f.switchTo(body);
      expect(f.calls[0]).toEqual({ kind: "switch", args: [token, "", NOW] });
    }
  });
});

describe("a request states the account its tab was rendered for", () => {
  const user = (accountId: string) => ({ $tag: "User", accountId, userId: "authenticated-user" }) as const;
  test("a request stating another account than the session's is refused", async () => {
    const { statesOtherAccount } = await import("./middleware/auth");
    // Another tab switched the shared session cookie to `nextAccount`.
    expect(statesOtherAccount(user(nextAccount) as never, currentAccount)).toBe(true);
    expect(statesOtherAccount(user(currentAccount) as never, currentAccount)).toBe(false);
  });
  test("the statement never selects an account, and absent statements are not judged", async () => {
    const { statesOtherAccount } = await import("./middleware/auth");
    expect(statesOtherAccount(user(currentAccount) as never, undefined)).toBe(false);
    expect(statesOtherAccount({ $tag: "Anonymous" } as never, currentAccount)).toBe(false);
  });
});


describe("private workspace context framing", () => {
  test("only the authenticated token selects the personal account; no cookie changes", async () => {
    const f = fixture();
    const response = await f.app.request("/personal-account?userId=someone-else", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "someone-else", accountId: currentAccount }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accountId: nextAccount });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(f.calls).toEqual([{ kind: "personal", args: [token] }]);
  });
  test("anonymous or refused identity cannot get a personal storage context", async () => {
    const anonymous = fixture({ sessionToken: () => undefined });
    expect((await anonymous.app.request("/personal-account", { method: "POST" })).status).toBe(401);
    expect(anonymous.calls).toEqual([]);
    const refused = fixture({ personalAccount: async () => ({ kind: "refused", status: 409, message: "Membership changed" }) });
    const response = await refused.app.request("/personal-account", { method: "POST" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Membership changed" });
    expect(response.headers.has("set-cookie")).toBe(false);
  });
});
