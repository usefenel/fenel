// ---------------------------------------------------------------------------
// Account member routes — the product surface of rights R2b's first grant.
//
// A membership row IS a grant: a principal, a partition, a policy name (`role`)
// and an id. These four endpoints are how one is listed, introduced, re-roled
// and removed.
//
// ⚠ THERE IS NO AUTHORIZATION CHECK IN THIS FILE, AND THAT IS THE DESIGN. Each
// handler is one `invokeIOActionAs` under the CALLER'S OWN request authority.
// The Fenel body runs; the acts it reaches are judged by the gate; a member who
// calls POST /members runs `auth:inviteMember` and is refused at
// `state:createMembership`, which lives only in the owner envelope and is argued
// there on the account and the role. Writing an `if (role !== "owner")` here
// would be a second policy engine to keep in agreement with the first — the one
// rights R2a deleted.
//
// The 403 comes from `api/src/index.ts`'s refusal mapping, by CLASS, walking the
// `cause` chain. The account is never read from the request: it comes from the
// authenticated session, so a caller-asserted partition confers nothing.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { invokeIOActionAs } from "@fenel/runtime";
import { getAuthority, getAuthenticatedUserAccountId } from "../middleware/auth";

const accountMemberRoutes = new Hono();

/** A Fenel `Result String a` at the `$`-key boundary. `Err` is the body's own
 *  refusal — the last-owner rule — and is a 409, not a 403: the caller was
 *  ENTITLED to make the request and the account's state refused it. */
function resultResponse(value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (value !== null && typeof value === "object") {
    const tag = (value as { $tag?: unknown }).$tag;
    if (tag === "Ok") return { ok: true, value: (value as { _0?: unknown })._0 };
    if (tag === "Err") {
      const reason = (value as { _0?: unknown })._0;
      return { ok: false, error: typeof reason === "string" ? reason : "refused" };
    }
  }
  return { ok: false, error: "unexpected result shape" };
}

accountMemberRoutes.get("/", async (c) => {
  const accountId = getAuthenticatedUserAccountId(c);
  if (!accountId) return c.json({ error: "Authentication required" }, 401);
  const members = await invokeIOActionAs(
    await getAuthority(c),
    null,
    "auth:listMembers",
    { input: { accountId } },
  );
  return c.json({ members });
});

accountMemberRoutes.post("/", async (c) => {
  const accountId = getAuthenticatedUserAccountId(c);
  if (!accountId) return c.json({ error: "Authentication required" }, 401);
  const body = await c.req.json().catch(() => undefined) as
    | { userId?: unknown; role?: unknown }
    | undefined;
  if (typeof body?.userId !== "string" || typeof body?.role !== "string") {
    return c.json({ error: "userId and role are required" }, 400);
  }
  const outcome = resultResponse(await invokeIOActionAs(
    await getAuthority(c),
    null,
    "auth:inviteMember",
    { input: { accountId, userId: body.userId, role: body.role } },
  ));
  if (!outcome.ok) return c.json({ error: outcome.error }, 409);
  return c.json(outcome.value);
});

accountMemberRoutes.patch("/:userId", async (c) => {
  const accountId = getAuthenticatedUserAccountId(c);
  if (!accountId) return c.json({ error: "Authentication required" }, 401);
  const body = await c.req.json().catch(() => undefined) as { role?: unknown } | undefined;
  if (typeof body?.role !== "string") return c.json({ error: "role is required" }, 400);
  const outcome = resultResponse(await invokeIOActionAs(
    await getAuthority(c),
    null,
    "auth:changeMemberRole",
    { input: { accountId, userId: c.req.param("userId"), role: body.role } },
  ));
  if (!outcome.ok) return c.json({ error: outcome.error }, 409);
  return c.json(outcome.value);
});

accountMemberRoutes.delete("/:userId", async (c) => {
  const accountId = getAuthenticatedUserAccountId(c);
  if (!accountId) return c.json({ error: "Authentication required" }, 401);
  const outcome = resultResponse(await invokeIOActionAs(
    await getAuthority(c),
    null,
    "auth:removeMember",
    { input: { accountId, userId: c.req.param("userId") } },
  ));
  if (!outcome.ok) return c.json({ error: outcome.error }, 409);
  return c.json(outcome.value);
});

export { accountMemberRoutes };
