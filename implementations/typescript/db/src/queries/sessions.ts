import { eq, and, gt, isNull, or } from "drizzle-orm";
import { getDb } from "../client";
import { accountMemberships, sessions, users } from "../schema/auth";

// ---------------------------------------------------------------------------
// Sessions — opaque bearer tokens.
//
// Tokens are stored hashed (SHA-256). Callers compute the hash and look
// up by hash; raw tokens never sit in the DB.
// ---------------------------------------------------------------------------

/** rights R2b — THE SESSION AND ITS GRANT, from the join this already performed.
 *
 *  The membership row IS the grant: a principal, a partition, a policy name
 *  (`role`) and an id. Selecting two more columns from a join that was already
 *  in the query costs ZERO additional round-trips and makes the request door
 *  read the LIVE role every request — so a role change or a deleted membership
 *  takes effect on the next one, with no cache to invalidate.
 *
 *  ⚠ THE INNER JOIN IS THE REVOCATION MECHANISM. A deleted membership makes a
 *  live token look like an unknown one (rights R1 defect A). That is the
 *  designed shape; do not "fix" it by returning the session without the join. */
export async function getSessionByHash(tokenHash: string) {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select({
      session: sessions,
      membershipId: accountMemberships.id,
      role: accountMemberships.role,
      email: users.email,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(accountMemberships, and(
      eq(accountMemberships.userId, sessions.userId),
      eq(accountMemberships.accountId, sessions.accountId),
    ))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        // Either no expiry, or expiry is in the future.
        or(isNull(sessions.expiresAt), gt(sessions.expiresAt, now)),
      ),
    )
    .limit(1);
  if (!row?.session) return null;
  return { ...row.session, membershipId: row.membershipId, role: row.role, email: row.email, name: row.name };
}

export async function listUserSessions(userId: string) {
  const db = getDb();
  return db.select().from(sessions).where(eq(sessions.userId, userId));
}

export async function createSession(input: {
  userId: string;
  accountId: string;
  tokenHash: string;
  label?: string | null;
  expiresAt?: Date | null;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    // Keep membership valid through the insert; resolution checks it again
    // on every request, so removing a membership revokes existing sessions.
    const [membership] = await tx.select({ id: accountMemberships.id })
      .from(accountMemberships)
      .where(and(
        eq(accountMemberships.userId, input.userId),
        eq(accountMemberships.accountId, input.accountId),
      ))
      .limit(1)
      .for("key share");
    if (!membership) throw new Error("Account membership required to issue a session");
    const [row] = await tx.insert(sessions).values({
      userId: input.userId,
      accountId: input.accountId,
      tokenHash: input.tokenHash,
      label: input.label ?? null,
      expiresAt: input.expiresAt ?? null,
    }).returning();
    return row!;
  });
}

export async function touchSession(id: string) {
  const db = getDb();
  await db
    .update(sessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(sessions.id, id));
}

export async function deleteSession(id: string) {
  const db = getDb();
  return db.delete(sessions).where(eq(sessions.id, id));
}

export async function deleteSessionByHash(tokenHash: string) {
  const db = getDb();
  return db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}
