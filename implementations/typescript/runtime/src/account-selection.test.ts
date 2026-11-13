// ---------------------------------------------------------------------------
// Account selection through the REAL privileged door: `auth:listAccounts` and
// `auth:switchAccount` (fenel/modules/auth/accounts.fenel), reached through the
// `@fenel/core` wrappers the API route calls. Every rule lives in those Fenel
// bodies; the HTTP framing is pinned separately in
// `api/src/account-sessions.test.ts`.
//
// The harness is `rights-r1-unpersisted-auth.test.ts`'s, for its reasons:
// `DATABASE_URL` is removed before anything that could read it is imported, so
// the durable path cannot run, and the identity leaves reach `@fenel/db`
// through `await import(...)` at call time, so a namespace spy is what they
// call. Each stub records its arguments; the assertions read those records.
// ---------------------------------------------------------------------------

import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";

const REMOVED: Record<string, string | undefined> = {
  DATABASE_URL: process.env["DATABASE_URL"],
  FENEL_STORAGE_DB_FIRST: process.env["FENEL_STORAGE_DB_FIRST"],
};
delete process.env["DATABASE_URL"];
delete process.env["FENEL_STORAGE_DB_FIRST"];

const dbModule = await import("@fenel/db");

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEXT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TOKEN = "f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f";
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

type LeafCall = { leaf: string; args: unknown[] };
let leafCalls: LeafCall[] = [];
let sessionExists = true;
let membershipExists = true;
let sourceExpiry: Date | null = new Date(NOW + 90_500);

const sessionRow = () => ({
  id: SESSION, userId: USER, accountId: ACCOUNT, tokenHash: "stored-hash", label: null,
  expiresAt: sourceExpiry, createdAt: new Date(0), lastUsedAt: null, membershipId: "membership-1", role: "owner",
  email: "person@example.test", name: "Person",
});
const recorded = <T>(leaf: string, value: () => T) => (async (...args: unknown[]) => {
  leafCalls.push({ leaf, args });
  return value();
}) as never;

spyOn(dbModule, "getSessionByHash").mockImplementation(recorded("getSessionByHash", () => sessionExists ? sessionRow() : null));
spyOn(dbModule, "getMembership").mockImplementation(recorded("getMembership", () =>
  membershipExists ? { id: "membership-2", userId: USER, accountId: NEXT, role: "member" } : null));
spyOn(dbModule, "createSession").mockImplementation(recorded("createSession", () => ({ ...sessionRow(), id: "issued-session", accountId: NEXT })));
spyOn(dbModule, "deleteSessionByHash").mockImplementation(recorded("deleteSessionByHash", () => undefined));
spyOn(dbModule, "touchSession").mockImplementation(recorded("touchSession", () => undefined));
spyOn(dbModule, "listUserAccountRoots").mockImplementation(recorded("listUserAccountRoots", () => [
  { accountId: ACCOUNT, name: "Personal", slug: "personal", role: "owner" },
  { accountId: NEXT, name: "Studio", slug: "studio", role: "member" },
]));

const { listAccounts, switchAccount } = await import("@fenel/core");
const { resetRegistryCache } = await import("./evaluator");

afterAll(() => {
  for (const [name, value] of Object.entries(REMOVED)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetRegistryCache();
});

beforeEach(() => {
  leafCalls = [];
  sessionExists = true;
  membershipExists = true;
  sourceExpiry = new Date(NOW + 90_500);
});

const calls = (leaf: string) => leafCalls.filter((entry) => entry.leaf === leaf);
const tokenHash = createHash("sha256").update(TOKEN).digest("hex");

describe("listing a user's accounts", () => {
  test("the user is the session's, never a caller-supplied id, and only the account projection returns", async () => {
    const choices = await listAccounts(TOKEN);
    expect(choices).toEqual({ currentAccountId: ACCOUNT, accounts: [
      { accountId: ACCOUNT, name: "Personal", slug: "personal", role: "owner" },
      { accountId: NEXT, name: "Studio", slug: "studio", role: "member" },
    ] });
    expect(calls("getSessionByHash").map((call) => call.args[0])).toEqual([tokenHash]);
    expect(calls("listUserAccountRoots").map((call) => call.args[0])).toEqual([USER]);
  }, 2_400_000);

  test("a token that names no live session lists nothing", async () => {
    sessionExists = false;
    expect(await listAccounts(TOKEN)).toBeNull();
    expect(calls("listUserAccountRoots")).toHaveLength(0);
  }, 600_000);
});

describe("switching the session to another account", () => {
  test("a switch issues a session for the target with the source's expiry, then revokes the source", async () => {
    const outcome = await switchAccount(TOKEN, NEXT, NOW);
    expect(outcome).toMatchObject({ kind: "switched", userId: USER, accountId: NEXT, maxAgeSeconds: 90 });
    const issued = outcome as { token: string };
    expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
    expect(calls("getMembership").map((call) => call.args)).toEqual([[USER, NEXT]]);
    const created = calls("createSession")[0]!.args[0] as { userId: string; accountId: string; label: string; expiresAt: Date };
    expect(created).toMatchObject({ userId: USER, accountId: NEXT, label: "Account selection" });
    expect(created.expiresAt.getTime()).toBe(sourceExpiry!.getTime());
    expect(calls("deleteSessionByHash").map((call) => call.args[0])).toEqual([tokenHash]);
    const order = leafCalls.map((call) => call.leaf);
    expect(order.indexOf("deleteSessionByHash")).toBeGreaterThan(order.indexOf("createSession"));
    // The raw token reached only the hash; neither it nor the new one was stored.
    const surface = JSON.stringify(leafCalls);
    expect(surface).not.toContain(TOKEN);
    expect(surface).not.toContain(issued.token);
  }, 2_400_000);

  test("a session without an expiry issues one without, and leaves the cookie its default lifetime", async () => {
    sourceExpiry = null;
    const outcome = await switchAccount(TOKEN, NEXT, NOW);
    expect(outcome.kind).toBe("switched");
    expect(outcome).not.toHaveProperty("maxAgeSeconds");
    expect((calls("createSession")[0]!.args[0] as { expiresAt: unknown }).expiresAt).toBeNull();
  }, 600_000);

  test("an expiry already past gives a zero Max-Age, never a negative one", async () => {
    sourceExpiry = new Date(NOW - 5_000);
    expect(await switchAccount(TOKEN, NEXT, NOW)).toMatchObject({ kind: "switched", maxAgeSeconds: 0 });
  }, 600_000);

  test("an id that is not a UUID is refused before any storage read", async () => {
    for (const id of ["", "bad-id", "cccccccc-cccc-4ccc-8ccc-ccccccccccc"]) {
      expect(await switchAccount(TOKEN, id, NOW)).toEqual({ kind: "refused", status: 400, message: "A valid accountId is required" });
    }
    expect(leafCalls).toEqual([]);
  }, 600_000);

  test("a session that is no longer live is refused, and nothing is issued or revoked", async () => {
    sessionExists = false;
    expect(await switchAccount(TOKEN, NEXT, NOW)).toMatchObject({ kind: "refused", status: 401 });
    expect(calls("createSession")).toHaveLength(0);
    expect(calls("deleteSessionByHash")).toHaveLength(0);
  }, 600_000);

  test("an account the user does not belong to is refused, and the source stays live", async () => {
    membershipExists = false;
    expect(await switchAccount(TOKEN, NEXT, NOW)).toEqual({ kind: "refused", status: 403, message: "You no longer have access to this account." });
    expect(calls("createSession")).toHaveLength(0);
    expect(calls("deleteSessionByHash")).toHaveLength(0);
  }, 600_000);
});
