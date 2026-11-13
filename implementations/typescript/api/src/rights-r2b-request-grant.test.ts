// ---------------------------------------------------------------------------
// rights R2b — the REQUEST DOOR reads the grant, and the envelope is the
// ROLE'S, end to end.
//
// Brief: `workstreams/rights/briefs/r2b-authority-spine-ii.md` §6.17–§6.20.
//
// THE SHAPE RULE (R1 note §2): a pin at the layer where the role is an INPUT
// observes nothing about whether the door READ it. Every pin here enters
// through `getAuthority(c)` — the real middleware function — with a real Hono
// context, so the role has to survive the session lookup, the marshal, and the
// mint to be observed.
//
// ⚠ EVERY PIN HERE WAS OBSERVED RED BEFORE IT WAS TRUSTED, one neuter at a
// time, with the red text recorded in the phase completion note.
// ---------------------------------------------------------------------------

import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";

const REMOVED: Record<string, string | undefined> = {
  DATABASE_URL: process.env["DATABASE_URL"],
  FENEL_STORAGE_DB_FIRST: process.env["FENEL_STORAGE_DB_FIRST"],
};
delete process.env["DATABASE_URL"];
delete process.env["FENEL_STORAGE_DB_FIRST"];

const dbModule = await import("@fenel/db");
spyOn(dbModule, "insertTraces").mockImplementation((async () => {}) as never);

const { authMiddleware, getAuthority, getSession, getUserProfile } = await import("./middleware/auth");
const { authorityRefusalOf } = await import("./authority-refusal.js");
const { authenticateAuthority } = await import("@fenel/engine/authority");
const { loadRegistry } = await import("@fenel/runtime");
const { AuthorityRefused } = await import("@fenel/engine");

afterAll(() => {
  for (const [name, value] of Object.entries(REMOVED)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MEMBERSHIP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TOKEN = "a".repeat(64);
const LONG = 1_200_000;

/** The LIVE membership row, mutated between requests by pin 19. */
let liveRole: string | null = "member";

const sessionRow = {
  id: SESSION, userId: USER, accountId: ACCOUNT, tokenHash: "hashed",
  label: null, expiresAt: null, createdAt: new Date(0), lastUsedAt: null,
};

// ⚠ THE SPY IS ON THE DB LEAF, NOT ON THE DOOR. The Fenel `resolveFromRow`, the
// `core/src/auth.ts` marshal and the middleware mint all run for real; only the
// row comes from here. A pin that stubbed `resolveToken` would observe nothing
// about whether the role survived that chain — which is exactly the shape R1's
// first slice got wrong.
//
// ⚠ AND THE JOIN DOES NOT RUN — an earlier version of this comment said it did,
// and that was false (review round 12). `spyOn` REPLACES `getSessionByHash`, and
// the state handler resolves `@fenel/db` at call time, so it gets the spy; this
// file also deletes `DATABASE_URL` at module top, so the real query could not
// execute here in any case. The consequence mattered: the two columns R2b added
// to that select — `membershipId` and `role`, which ARE the grant — were then
// asserted nowhere in the repository, and reverting the select would have minted
// an empty envelope for every authenticated request while every gate stayed
// green. The join and its two columns are pinned in
// `db/src/account-isolation.fixture.ts`, which drives the real builder.
spyOn(dbModule, "getSessionByHash").mockImplementation((async () => {
  if (liveRole === null) return null;
  return { ...sessionRow, membershipId: MEMBERSHIP, role: liveRole, email: "person@example.test", name: "Person" };
}) as never);
spyOn(dbModule, "touchSession").mockImplementation((async () => undefined) as never);
// `getAuthority` resolves the ACCOUNT'S execution registry, which reads the
// account's installed source modules before its own fingerprint cache. No
// modules ⇒ the base registry, which is what every pin here judges against.
spyOn(dbModule, "listAccountImports").mockImplementation((async () => []) as never);

beforeEach(() => { liveRole = "member"; });

/** A request through the REAL middleware, returning what `getAuthority` minted. */
async function authorityForRequest(): Promise<{
  record: ReturnType<typeof authenticateAuthority>;
  session: ReturnType<typeof getSession>;
  profile: ReturnType<typeof getUserProfile>;
}> {
  const app = new Hono();
  app.use("*", authMiddleware);
  let captured: { record: unknown; session: unknown; profile: unknown } = { record: undefined, session: undefined, profile: undefined };
  app.get("/probe", async (c) => {
    const handle = await getAuthority(c);
    captured = { record: authenticateAuthority(handle), session: getSession(c), profile: getUserProfile(c) };
    return c.json({ ok: true });
  });
  const response = await app.fetch(new Request("http://local/probe", {
    headers: { authorization: `Bearer ${TOKEN}` },
  }));
  expect(response.status).toBe(200);
  return captured as never;
}

describe("rights R2b — the request door reads the LIVE grant", () => {
  test("17/20 — the session carries the role and the membership id, and the mint carries the grant", async () => {
    // Neuter: `getSessionByHash` selects `sessions` only (drop the two joined
    // columns). RED reads: `role` undefined, and the mint throws on the missing
    // property.
    const { record, session, profile } = await authorityForRequest();
    expect(profile).toEqual({ $tag: "UserProfile", email: "person@example.test", name: { $tag: "Just", _0: "Person" } });
    expect(session?.role).toBe("member");
    expect(session?.membershipId).toBe(MEMBERSHIP);
    expect(record?.issuer).toBe("request-session");
    expect(record?.accountId).toBe(ACCOUNT);
    // Neuter: drop `grant` from `mintRequestAuthority`. RED reads: undefined.
    expect(record?.grant).toBe(MEMBERSHIP);
  }, LONG);

  test("18 — the envelope is the ROLE's: a viewer holds no storage writes", async () => {
    const registry = loadRegistry();
    const permits = (envelope: unknown, descriptor: string, args: unknown[] = []) =>
      registry.evaluateAuthorityFunction("authority:permits", [
        envelope,
        { $tag: "Act", descriptor, args, fields: [] },
      ]);

    liveRole = "member";
    const asMember = (await authorityForRequest()).record!;
    expect(permits(asMember.envelope, "storage:memoryStore", [ACCOUNT, "T", {}, "id"]))
      .toEqual({ $tag: "Just", _0: true });

    // Neuter: mint the fixed member envelope ignoring `session.role`. RED
    // reads: the viewer's store answers `Just true`.
    liveRole = "viewer";
    const asViewer = (await authorityForRequest()).record!;
    expect(permits(asViewer.envelope, "storage:memoryStore", [ACCOUNT, "T", {}, "id"]))
      .toEqual({ $tag: "Just", _0: false });
    // …and the viewer still READS, so the pin is a role restriction rather
    // than an empty envelope.
    expect(permits(asViewer.envelope, "storage:memoryList", [ACCOUNT, "T", { $tag: "Nothing" }, { $tag: "Nothing" }]))
      .toEqual({ $tag: "Just", _0: true });
  }, LONG);

  test("19 — a role change is LIVE on the next request, with no cache to invalidate", async () => {
    const registry = loadRegistry();
    const permits = (envelope: unknown) =>
      registry.evaluateAuthorityFunction("authority:permits", [
        envelope,
        {
          $tag: "Act",
          descriptor: "state:createMembership",
          args: [{ accountId: ACCOUNT, role: "member" }],
          fields: [
            { $tag: "ActField", name: "accountId", value: ACCOUNT },
            { $tag: "ActField", name: "role", value: "member" },
          ],
        },
      ]);

    liveRole = "member";
    const first = (await authorityForRequest()).record!;
    expect(permits(first.envelope)).toEqual({ $tag: "Just", _0: false });

    // The SAME session token; only the membership row changed.
    // Neuter: memoise the envelope per SESSION or per PRINCIPAL. RED reads:
    // the second request still answers `Just false`.
    liveRole = "owner";
    const second = (await authorityForRequest()).record!;
    expect(permits(second.envelope)).toEqual({ $tag: "Just", _0: true });

    // And a DELETED membership makes the same token resolve to nothing at all —
    // the inner join IS the revocation mechanism (rights R1 defect A).
    liveRole = null;
    const anonymous = (await authorityForRequest()).record!;
    expect(anonymous.issuer).toBe("anonymous");
    expect(anonymous.envelope).toEqual({ $tag: "EvRows", rows: [] });
  }, LONG);

  test("the 403 door maps a refusal by CLASS, through the cause chain", () => {
    const refusal = new AuthorityRefused("storage:memoryStore", "refused");
    const wrapped = new Error("Function 'probe' failed");
    (wrapped as { cause?: unknown }).cause = refusal;
    expect(authorityRefusalOf(wrapped))
      .toEqual({ descriptor: "storage:memoryStore", reason: "refused" });
    expect(authorityRefusalOf(new Error("something else"))).toBeUndefined();
  }, LONG);
});

// ---------------------------------------------------------------------------
// §6.18's END-TO-END HALF — a refusal is a 403 through `app.fetch`, on the
// PRODUCTION handler.
//
// ⚠ WHY IT IS SHAPED THIS WAY. The brief's pin 18 asks for a request that
// creates an instance answering 403 as a `viewer` and 200 as a `member`. That
// composition is not available in this process: `invokeIOActionAs` takes the
// DURABLE path, whose first line is `getDb()`, and `DATABASE_URL` is deleted
// here precisely so nothing can write. So the chain is pinned in two halves on
// PRODUCTION objects rather than one composed half on a twin:
//
//   · the envelope IS the role's, through the real middleware — the tests above;
//   · a refusal raised anywhere under a route becomes a 403 naming the
//     descriptor — this test, mounting `authorityAwareErrorHandler` itself.
//
// `api/src/index.ts` exports that handler for exactly this reason: it used to be
// an inline closure, and the only way to "pin" it was to write a second one of
// the same shape, which cannot catch the first drifting.
// ---------------------------------------------------------------------------

describe("rights R2b — a refusal answers 403 through the production error handler", () => {
  test("wrapped, unwrapped, and NOT an ordinary error", async () => {
    const { authorityAwareErrorHandler } = await import("./index");
    const app = new Hono();
    app.onError(authorityAwareErrorHandler);
    app.get("/refused", () => {
      const refusal = new AuthorityRefused("storage:memoryStore", "refused");
      const wrapped = new Error("Function 'probe:writes' failed");
      (wrapped as { cause?: unknown }).cause = refusal;
      throw wrapped;
    });
    app.get("/boom", () => { throw new Error("ordinary"); });

    // Neuter: drop the `authorityRefusalOf` branch from the handler.
    // RED reads: status 500 and the body is the stack, not the descriptor.
    const refused = await app.fetch(new Request("http://local/refused"));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: "authority refused",
      descriptor: "storage:memoryStore",
      reason: "refused",
    });

    // THE CONTROL, one input apart: an ordinary error is still a 500.
    const boom = await app.fetch(new Request("http://local/boom"));
    expect(boom.status).toBe(500);
  }, LONG);
});
