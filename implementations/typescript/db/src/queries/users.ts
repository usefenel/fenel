import { eq, and, isNull } from "drizzle-orm";
import type { Maybe } from "@fenel/engine/type-foundation";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import type { Database } from "../client";
import { getDb } from "../client";
import { users, accountMemberships } from "../schema/auth";
import { accounts } from "../schema/accounts";

// ---------------------------------------------------------------------------
// Users + memberships — the identity layer.
// ---------------------------------------------------------------------------

export async function getUserById(id: string) {
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function getUserByEmail(email: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row ?? null;
}

export async function createUser(input: { email: string; name?: string | null }) {
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({ email: input.email, name: input.name ?? null })
    .returning();
  return row!;
}

export async function getOrCreateUserByEmail(input: {
  email: string;
  name?: string | null;
}) {
  const existing = await getUserByEmail(input.email);
  if (existing) return existing;
  return createUser(input);
}

export async function setUserPasswordHash(userId: string, passwordHash: string | null) {
  const db = getDb();
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

export async function listUserAccounts(userId: string) {
  const db = getDb();
  return db
    .select()
    .from(accountMemberships)
    .where(eq(accountMemberships.userId, userId));
}

/** Account selector projection: only roots with a live membership for this
 * authenticated principal, with no account config or unrelated membership IO. */
export async function listUserAccountRoots(userId: string) {
  return getDb().select({ accountId: accounts.id, name: accounts.name, slug: accounts.slug,
    role: accountMemberships.role })
    .from(accountMemberships)
    .innerJoin(accounts, eq(accounts.id, accountMemberships.accountId))
    .where(eq(accountMemberships.userId, userId))
    .orderBy(accounts.name, accounts.id);
}

export async function listAccountMembers(accountId: string) {
  const db = getDb();
  return db
    .select()
    .from(accountMemberships)
    .where(eq(accountMemberships.accountId, accountId));
}

export async function getMembership(userId: string, accountId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(accountMemberships)
    .where(
      and(
        eq(accountMemberships.userId, userId),
        eq(accountMemberships.accountId, accountId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Transport of the Fenel Result returned by the repository identity rules. */
export type PersonalIdentityDecision<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
export type PersonalMembershipRow = { id: string; userId: string; accountId: string; role: string };
export type MembershipMutation =
  | { $tag: "AddMembership" | "SetMembershipRole"; userId: string; role: string }
  | { $tag: "RemoveMembership"; userId: string };
export type PersonalMembershipSnapshot = {
  owners: string[];
  members: PersonalMembershipRow[];
  mutation: MembershipMutation;
};
export type PersonalMembershipGuard = (snapshot: PersonalMembershipSnapshot) => PersonalIdentityDecision<boolean> | Promise<PersonalIdentityDecision<boolean>>;
export type PersonalAccountSnapshot = {
  users: { id: string; personalAccountId: Maybe<string> }[];
  members: PersonalMembershipRow[];
};
export type PersonalAccountPlan =
  | { $tag: "UsePersonalAccount"; accountId: string }
  | { $tag: "CreatePersonalAccount"; account: { id: string; slug: string; name: string }; membership: PersonalMembershipRow };
export type PersonalAccountPlanner = (snapshot: PersonalAccountSnapshot) => PersonalIdentityDecision<PersonalAccountPlan> | Promise<PersonalIdentityDecision<PersonalAccountPlan>>;
type IdentityTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** This is the transaction boundary, not a second policy implementation.
 * The repository Fenel decision is evaluated over rows read under this lock.
 * Every exported membership mutation requires it, including direct state calls. */
async function withMembershipMutation<T>(accountId: string, mutation: MembershipMutation,
  guard: PersonalMembershipGuard, write: (tx: IdentityTransaction) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).for("update");
    const owners = await tx.select({ id: users.id }).from(users).where(eq(users.personalAccountId, accountId));
    const members = await tx.select({ id: accountMemberships.id, userId: accountMemberships.userId,
      accountId: accountMemberships.accountId, role: accountMemberships.role })
      .from(accountMemberships).where(eq(accountMemberships.accountId, accountId)).for("update");
    const decision = await guard({ owners: owners.map((owner) => owner.id), members, mutation });
    if (decision?.$tag !== "Ok" || decision._0 !== true) {
      throw new Error(decision?.$tag === "Err" ? decision._0 : "The membership transaction was refused.");
    }
    return write(tx);
  });
}

export async function createMembership(input: { userId: string; accountId: string; role: string }, guard: PersonalMembershipGuard) {
  return withMembershipMutation(input.accountId, { $tag: "AddMembership", userId: input.userId, role: input.role }, guard, async (tx) => {
    const [row] = await tx.insert(accountMemberships).values(input).returning();
    return row!;
  });
}

export async function setMembershipRole(userId: string, accountId: string, role: string, guard: PersonalMembershipGuard) {
  return withMembershipMutation(accountId, { $tag: "SetMembershipRole", userId, role }, guard, async (tx) => {
    const [row] = await tx.update(accountMemberships).set({ role })
      .where(and(eq(accountMemberships.userId, userId), eq(accountMemberships.accountId, accountId))).returning();
    return row ?? null;
  });
}

export async function deleteMembership(userId: string, accountId: string, guard: PersonalMembershipGuard) {
  return withMembershipMutation(accountId, { $tag: "RemoveMembership", userId }, guard, async (tx) =>
    tx.delete(accountMemberships).where(and(eq(accountMemberships.userId, userId), eq(accountMemberships.accountId, accountId))));
}

/** Identity-only, atomic creation of the private partition and its permanent
 * user link. Existing links are never changed and broken memberships are not
 * repaired by guessing. All creation/reuse rules belong to the Fenel planner. */
export async function ensurePersonalAccount(userId: string, plan: PersonalAccountPlanner): Promise<PersonalIdentityDecision<string>> {
  return getDb().transaction(async (tx) => {
    const locked = await tx.select({ id: users.id, personalAccountId: users.personalAccountId })
      .from(users).where(eq(users.id, userId)).for("update");
    // The account lock also serializes membership mutations. At creation this
    // joins no row; the new account/link/membership become visible together.
    await tx.select({ id: accounts.id }).from(accounts)
      .innerJoin(users, eq(users.personalAccountId, accounts.id)).where(eq(users.id, userId)).for("update");
    const members = await tx.select({ id: accountMemberships.id, userId: accountMemberships.userId,
      accountId: accountMemberships.accountId, role: accountMemberships.role }).from(accountMemberships)
      .innerJoin(users, eq(users.personalAccountId, accountMemberships.accountId)).where(eq(users.id, userId));
    const decision = await plan({ users: locked.map((user) => ({ id: user.id,
      personalAccountId: user.personalAccountId === null ? Nothing : Just(user.personalAccountId) })), members });
    if (decision?.$tag === "Err") return decision;
    if (decision?.$tag !== "Ok") throw new Error("The personal account planner returned no decision.");
    const next = decision._0;
    if (next.$tag === "UsePersonalAccount") return { $tag: "Ok", _0: next.accountId };
    if (next.$tag !== "CreatePersonalAccount") throw new Error("The personal account planner returned an unknown operation.");
    await tx.insert(accounts).values(next.account);
    await tx.insert(accountMemberships).values(next.membership);
    const linked = await tx.update(users).set({ personalAccountId: next.account.id })
      .where(and(eq(users.id, userId), isNull(users.personalAccountId))).returning({ id: users.id });
    if (linked.length !== 1) throw new Error("The personal account identity changed during creation.");
    return { $tag: "Ok", _0: next.account.id };
  });
}
