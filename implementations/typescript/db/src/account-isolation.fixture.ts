// @ts-nocheck -- Real Drizzle query builders; only the PostgreSQL driver is simulated.
//
// ---------------------------------------------------------------------------
// rights R2b review round 8 — BEHAVIOURAL account isolation for the queries that
// argue no account handle.
//
// ⚠ WHY THIS EXISTS, said plainly. Rounds 5-7 fixed seven acts that reach the
// database with a caller-supplied identifier and no account predicate, and
// guarded them with a SOURCE SCAN: the handler must mention `ctx.accountId`, the
// query must mention `accountId`. Round 7 showed the handler half was too weak
// (deleting the SQL predicate kept it green); round 8 showed the query half is
// too weak the same way — `accountId` survives in a `.select({ accountId: … })`,
// in the INSERT branch of an upsert, and in a comment, so three of the shipped
// fences could be deleted outright with every pin passing.
//
// A string is not a fence. This exercises the real Drizzle builders against a
// capture driver and asserts what actually reaches the database. Each assertion
// was observed RED under the deletion it defends.
//
// THE OBSERVATION: the driver records every statement and returns rows the test
// chooses, so "the account reached the WHERE clause" and "the foreign row was
// never read" are both directly measurable — no database, no network.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { mock } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { PgDialect } from "drizzle-orm/pg-core";

const OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const dialect = new PgDialect();

/** Every statement the builders emit, in order. */
let calls = [];
/** What each SELECT returns, in order. A QUEUE rather than one value, so that a
 *  statement the code should NEVER have issued gets an empty result instead of
 *  the previous case's rows — otherwise a removed guard fails with a decode
 *  TypeError from deep inside the row mapper, and a red that is not the
 *  assertion's red is not the assertion's evidence. */
let nextRows = [];

/** ⚠ THE SESSION JOIN IS ANSWERED FROM THE STATEMENT'S OWN SELECT LIST (review
 *  round 13). A hand-built row of "8 nulls then the two values" is green even when
 *  the production projection SWAPS them
 *  (`membershipId: accountMemberships.role, role: accountMemberships.id`), because
 *  the fixture would supply `"membership-1", "owner"` whatever the SQL selected —
 *  and both columns are strings, so no type edge catches it either. That mistake
 *  gives every authenticated user an unknown role and therefore an EMPTY envelope,
 *  which is the whole point of pinning this query. So the value goes where the
 *  column ACTUALLY landed. */
const MEMBERSHIP_VALUES = {
  '"account_memberships"."id"': "membership-1",
  '"account_memberships"."role"': "owner",
  '"users"."email"': "person@example.test",
  '"users"."name"': "Person",
};
function rowFromSelectList(sql) {
  const list = sql.slice(sql.search(/select\s/i) + 7, sql.search(/\sfrom\s/i)).split(/,\s*/);
  return list.map((expression) => MEMBERSHIP_VALUES[expression.trim()] ?? null);
}

const driver = drizzle(async (sql, params) => {
  calls.push({ sql, params });
  if (/inner join "account_memberships"/i.test(sql)) return { rows: [rowFromSelectList(sql)] };
  return { rows: nextRows.length > 0 ? nextRows.shift() : [] };
});
const db = new Proxy(driver, {
  get(target, key) {
    if (key === "transaction") return async (work) => work(db);
    if (key === "execute") {
      return async (query) => {
        const { sql, params } = dialect.sqlToQuery(query);
        calls.push({ sql, params });
        return [];
      };
    }
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
mock.module("./client", () => ({ getDb: () => db }));

const { cancelInFlightConversationsByBot } = await import("./queries/entity-instances");
const { getTracesByInstance } = await import("./queries/traces");
const { deleteSubscription, upsertSubscription } = await import("./queries/subscriptions");
const { setMembershipRole, deleteMembership, listAccountMembers } = await import("./queries/users");
const { getSessionByHash } = await import("./queries/sessions");

function reset(...results) {
  calls = [];
  nextRows = results;
}

/** The account must appear as a BOUND PARAMETER of the statement — not merely
 *  somewhere in the source that built it. */
function boundAccount(call) {
  return call.params.includes(OWN);
}

/** ⚠ AND THE PREDICATE MUST NARROW (review round 9). A predicate that is present
 *  and bound still lets `and` -> `or` through: `account_id =` appears, the
 *  parameter binds, and the statement then matches every row with that slug OR
 *  every row of the caller's own account — round 5's bug restored, plus a
 *  self-inflicted mass delete. This driver records statements rather than
 *  evaluating them, so the conjunction is asserted on the emitted SQL. */
function conjunctive(call) {
  return !/\sor\s/i.test(call.sql);
}

// ---------------------------------------------------------------------------
// 1. cancelInFlightConversationsByBot — one UPDATE, and it must carry the account.
//    Deletion defended: `AND account_id = ${accountId}`.
// ---------------------------------------------------------------------------
reset();
await cancelInFlightConversationsByBot(OWN, "bot-1");
assert.equal(calls.length, 1, "one statement");
assert.match(calls[0].sql, /update entity_instances/i);
assert.match(calls[0].sql, /account_id\s*=/i, "the UPDATE must filter on account_id");
assert(boundAccount(calls[0]), "the account must be a bound parameter");
assert(conjunctive(calls[0]), "the predicate must CONJOIN, not disjoin");
// ⚠ AND THE OTHER THREE CONJUNCTS (review round 11; the count was wrong until
// review round 12 — it asserted two and said three). With only the account left,
// this stamps `status: Cancelled` onto every in-flight Conversation in the
// account regardless of bot; with `entity_type` gone too, onto every
// `entity_instances` row the account owns; and with the STATUS filter gone, onto
// every already-completed Conversation of that bot, with a fresh `completedAt` —
// which corrupts the funnel's completion history and any `/start` logic keyed on
// it. That last one is a semantic filter rather than an isolation predicate, and
// it is asserted here anyway: the charter is what this statement must be, and a
// comment that claims a count it does not deliver is the drift this file exists
// to stop.
assert.match(calls[0].sql, /entity_type\s*=/i, "the UPDATE must filter on entity_type");
assert.match(calls[0].sql, /data->>'botId'\s*=/i, "the UPDATE must filter on the bot");
assert(calls[0].params.includes("bot-1"), "the bot must be a bound parameter");
assert.match(calls[0].sql, /'status'->>'\$tag' IN/i, "the UPDATE must filter on the in-flight statuses");

// ---------------------------------------------------------------------------
// 2. deleteSubscription — one DELETE, account in the predicate.
//    Deletion defended: `eq(subscriptions.accountId, accountId)`.
// ---------------------------------------------------------------------------
reset();
await deleteSubscription(OWN, "tg-bot-x");
assert.equal(calls.length, 1, "one statement");
assert.match(calls[0].sql, /^delete from "subscriptions"/i);
assert.match(calls[0].sql, /"account_id"\s*=/i, "the DELETE must filter on account_id");
assert(boundAccount(calls[0]), "the account must be a bound parameter");
assert(conjunctive(calls[0]), "the predicate must CONJOIN, not disjoin");
// ⚠ AND BOTH HALVES MUST BE THERE (review round 10). Asserting only the account
// leaves "delete every subscription of my own account" passing: the account is
// present, bound and conjoined, and the SLUG is simply gone.
assert.match(calls[0].sql, /"slug"\s*=/i, "the DELETE must also filter on the slug");
assert(calls[0].params.includes("tg-bot-x"), "the slug must be a bound parameter");

// ---------------------------------------------------------------------------
// 2b. THE MEMBERSHIP WRITES — this phase INTRODUCED these two, put them in the
//     owner envelope, and exposed them over HTTP at /api/account/members. The
//     gate constrains the ARGUED `accountId`; the only thing that binds that
//     argument to a row is the SQL conjunct, and until review round 12 nothing
//     in the repository observed it — the partition suite SPIES these functions,
//     so the real builder never ran in any test.
//
//     ⚠ THE SCENARIO, because it is not obvious that a missing conjunct here is
//     cross-account at all: drop `eq(accountMemberships.accountId, accountId)` on
//     the plausible ground that a user has one membership. Mallory is a VIEWER in
//     account B and — as every user is — OWNER of their own account A. Under A's
//     session Mallory re-roles their own userId to "owner": the route takes the
//     account from the session (A), the gate judges the act argued on A and
//     permits it, the last-owner guard does not fire for a promotion, and the
//     UPDATE then matches EVERY membership row of that userId, including B's.
//     Mallory is owner of B.
// ---------------------------------------------------------------------------
reset([]);
await setMembershipRole("user-1", OWN, "member", () => ({ $tag: "Ok", _0: true })).catch(() => undefined);
calls = calls.filter((call) => /^update "account_memberships"/i.test(call.sql));
assert.equal(calls.length, 1, "one statement");
assert.match(calls[0].sql, /^update "account_memberships"/i);
assert.match(calls[0].sql, /"account_id"\s*=/i, "the UPDATE must filter on account_id");
assert.match(calls[0].sql, /"user_id"\s*=/i, "the UPDATE must filter on user_id");
assert(boundAccount(calls[0]), "the account must be a bound parameter");
assert(calls[0].params.includes("user-1"), "the user must be a bound parameter");
assert(conjunctive(calls[0]), "the predicate must CONJOIN, not disjoin");

reset([]);
await deleteMembership("user-1", OWN, () => ({ $tag: "Ok", _0: true })).catch(() => undefined);
calls = calls.filter((call) => /^delete from "account_memberships"/i.test(call.sql));
assert.equal(calls.length, 1, "one statement");
assert.match(calls[0].sql, /^delete from "account_memberships"/i);
assert.match(calls[0].sql, /"account_id"\s*=/i, "the DELETE must filter on account_id");
assert.match(calls[0].sql, /"user_id"\s*=/i, "the DELETE must filter on user_id");
assert(boundAccount(calls[0]), "the account must be a bound parameter");
assert(calls[0].params.includes("user-1"), "the user must be a bound parameter");
assert(conjunctive(calls[0]), "the predicate must CONJOIN, not disjoin");

// ---------------------------------------------------------------------------
// 2c. THE GRANT READ — `getSessionByHash`'s two NEW columns, which are this
//     phase's headline mechanism and were asserted NOWHERE (review round 12).
//
//     ⚠ WHY NOTHING CAUGHT IT. `rights-r2b-request-grant.test.ts` SPIES this
//     function, so the join it claims runs "for real" does not run at all; and
//     `db-audit-regressions.fixture.ts` drives the real query but answers with
//     `Object.values(getTableColumns(sessions))` — EIGHT values for a TEN-column
//     select — so it is green while both new columns decode to `undefined`.
//
//     ⚠ THE SCENARIO. Revert the select to `{ session: sessions }` — a merge
//     resolution, or a "this spread is redundant" cleanup. `tsc` stays clean
//     (the row crosses into Fenel as `unknown` and `ResolvedSession.role` is a
//     cast), every named CI step stays green, and `login-self-check` prints OK
//     because `/api/auth/me` performs no act. Meanwhile `role` is `undefined`,
//     `roleEnvelope` takes its unknown-role arm, and EVERY authenticated request
//     mints an EMPTY envelope and 403s on every act, for every user. That is
//     R1's outage shape one layer above where the sentinel looks.
// ---------------------------------------------------------------------------
reset(); // the driver answers this one from its own select list — see above
const session = await getSessionByHash("hash-1");
assert.equal(calls.length, 1, "one statement");
assert.match(calls[0].sql, /inner join "account_memberships"/i, "the join IS the revocation mechanism");
assert.match(
  calls[0].sql,
  /"account_memberships"\."role"/i,
  "the select list must name the membership role",
);
assert.match(
  calls[0].sql,
  /"account_memberships"\."id"/i,
  "the select list must name the membership id",
);
assert(session !== null, "a joined row resolves");
assert.equal(session.role, "owner", "the ROLE must reach the caller — it is the whole grant");
assert.equal(session.membershipId, "membership-1", "the membership id must reach the caller");
assert.match(calls[0].sql, /inner join "users" on "users"\."id" = "sessions"\."user_id"/i);
assert.equal(session.email, "person@example.test");
assert.equal(session.name, "Person");
assert.doesNotMatch(calls[0].sql, /password_hash/i, "the self profile never reads a credential");

// ---------------------------------------------------------------------------
// 2d. THE ROSTER READ — `listAccountMembers`, whose account predicate was hidden
//     by a spy that implemented the filtering ITSELF (review round 13). Deleting
//     `.where(eq(accountMemberships.accountId, accountId))` from the real query
//     left the entire partition suite green at 35 pass / 494 assertions, and the
//     isolation fixture green too, because neither called it.
//
//     ⚠ IT IS NOT ONLY A READ LEAK. The roster is what the LAST-OWNER guard
//     counts: with one owner in A and another in B, an unscoped roster sees two
//     owners and permits demoting A's SOLE owner. Reproduced through the real
//     Fenel orchestrator — the mutation answered `Ok` with one demotion where HEAD
//     answers `Err` with zero writes. So this predicate holds up both the
//     partition AND the invariant `membership.fenel` exists to enforce.
// ---------------------------------------------------------------------------
reset([]);
await listAccountMembers(OWN).catch(() => undefined);
assert.equal(calls.length, 1, "one statement");
assert.match(calls[0].sql, /from "account_memberships"/i);
assert.match(calls[0].sql, /"account_id"\s*=/i, "the roster must filter on account_id");
assert(boundAccount(calls[0]), "the account must be a bound parameter");
assert(conjunctive(calls[0]), "the predicate must CONJOIN, not disjoin");

// ---------------------------------------------------------------------------
// 3. upsertSubscription — the EXISTING-ROW LOOKUP is the half that decides
//    whether a foreign slug is overwritten or inserted. It must be scoped.
//    Deletion defended: `eq(subscriptions.accountId, row.accountId)` in the lookup.
// ---------------------------------------------------------------------------
reset([]); // the lookup finds nothing -> INSERT branch
await upsertSubscription({
  accountId: OWN, slug: "tg-bot-x", source: "http_webhook", secret: "s",
}).catch(() => undefined);
const lookup = calls[0];
assert.match(lookup.sql, /^select/i, "the lookup comes first");
assert.match(lookup.sql, /"account_id"\s*=/i, "the lookup must be account-scoped");
assert(boundAccount(lookup), "the account must be a bound parameter of the lookup");
assert(conjunctive(lookup), "the lookup predicate must CONJOIN, not disjoin");
// ⚠ AND THE SLUG (review round 11). With only the account left, the lookup
// matches an ARBITRARY subscription of the caller's own account and the UPDATE
// branch rewrites that row's secret, source and handlerFunctionId.
assert.match(lookup.sql, /"slug"\s*=/i, "the lookup must filter on the slug");
assert(lookup.params.includes("tg-bot-x"), "the slug must be a bound parameter");
// And the row it would have updated is the one the lookup found — so a foreign
// slug reaches the INSERT, where the unique index refuses it.
assert.match(calls[1].sql, /^insert into "subscriptions"/i, "a miss INSERTs");

// ---------------------------------------------------------------------------
// 4. getTracesByInstance — the ownership check must REFUSE, not merely run.
//    Deletion defended: `|| owner.accountId !== accountId` in the guard.
// ---------------------------------------------------------------------------
reset([[OTHER]]); // the ownership lookup finds an instance owned by ANOTHER account
const foreign = await getTracesByInstance(OWN, "instance-1");
assert.deepEqual(foreign, [], "a foreign instance reads as no traces");
assert.equal(calls.length, 1, "the traces SELECT must never be issued");
assert.match(calls[0].sql, /from "function_instances"/i, "only the ownership lookup ran");
// ⚠ AND IT MUST BIND THE INSTANCE (review round 11 logged this one rather than
// filing it; closed here for the same money). Without the predicate the guard
// compares the caller's account against an ARBITRARY instance's.
assert.match(calls[0].sql, /"id"\s*=/i, "the ownership lookup must filter on the instance id");
assert(calls[0].params.includes("instance-1"), "the instance must be a bound parameter");

reset([[OWN]]); // the ownership lookup finds an instance owned by the caller
await getTracesByInstance(OWN, "instance-1").catch(() => undefined);
assert.equal(calls.length, 2, "the ownership lookup, then the traces SELECT");
assert.match(calls[1].sql, /from "traces"/i, "the own-account read proceeds");

console.log("account isolation holds for every act that argues no account handle");
