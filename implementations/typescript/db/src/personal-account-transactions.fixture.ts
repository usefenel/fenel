// @ts-nocheck -- Real Drizzle query builders; only PostgreSQL is simulated.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
let link = null;
let members = [];
let inTransaction = false;
let calls = [];
const driver = drizzle(async (sql, params) => {
  calls.push({ sql, params, inTransaction });
  if (/^select "id", "personal_account_id" from "users"/i.test(sql)) return { rows: [[USER, link]] };
  if (/^select "id" from "users"/i.test(sql)) return { rows: link === ACCOUNT ? [[USER]] : [] };
  if (/^select .* from "accounts"/i.test(sql)) return { rows: link === ACCOUNT ? [[ACCOUNT]] : [] };
  if (/^select .* from "account_memberships"/i.test(sql)) return { rows: members.map((member) => [member.id, member.userId, member.accountId, member.role]) };
  if (/^insert into "accounts"/i.test(sql)) return { rows: [] };
  if (/^insert into "account_memberships"/i.test(sql)) {
    members = [{ id: MEMBER, userId: USER, accountId: ACCOUNT, role: "personal" }];
    return { rows: [] };
  }
  if (/^update "users"/i.test(sql)) { link = ACCOUNT; return { rows: [[USER]] }; }
  if (/^(?:update|delete from) "account_memberships"/i.test(sql)) return { rows: [] };
  throw new Error(`Unexpected identity query: ${sql}`);
});
const db = new Proxy(driver, {
  get(target, key) {
    if (key === "transaction") return async (work) => {
      assert.equal(inTransaction, false);
      const before = { link, members: [...members] };
      inTransaction = true;
      try { return await work(db); }
      catch (error) { link = before.link; members = before.members; throw error; }
      finally { inTransaction = false; }
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
mock.module("./client", () => ({ getDb: () => db }));
const { ensurePersonalAccount, createMembership, setMembershipRole, deleteMembership } = await import("./queries/users");
const creation = { $tag: "CreatePersonalAccount", account: { id: ACCOUNT, slug: "private-fixture", name: "Personal" },
  membership: { id: MEMBER, userId: USER, accountId: ACCOUNT, role: "personal" } };
let decisions = 0;
const first = await ensurePersonalAccount(USER, (snapshot) => {
  decisions++;
  assert.equal(inTransaction, true);
  assert.deepEqual(snapshot, { users: [{ id: USER, personalAccountId: { $tag: "Nothing" } }], members: [] });
  assert(calls.some((call) => /from "users".*for update/i.test(call.sql)));
  assert(calls.some((call) => /from "accounts".*for update/i.test(call.sql)));
  assert.equal(calls.filter((call) => /^(insert|update|delete)/i.test(call.sql)).length, 0);
  return { $tag: "Ok", _0: creation };
});
assert.deepEqual(first, { $tag: "Ok", _0: ACCOUNT });
const writes = calls.filter((call) => /^(insert|update|delete)/i.test(call.sql));
assert.equal(writes.length, 3);
assert(writes.every((call) => call.inTransaction));
assert.match(writes.at(-1).sql, /"personal_account_id" is null/i);
assert(writes.at(-1).params.includes(USER));

calls = [];
assert.deepEqual(await ensurePersonalAccount(USER, (snapshot) => {
  decisions++;
  assert.equal(inTransaction, true);
  assert.equal(snapshot.users[0].personalAccountId._0, ACCOUNT);
  assert.equal(snapshot.members[0].userId, USER);
  assert.equal(snapshot.members[0].role, "personal");
  return { $tag: "Ok", _0: { $tag: "UsePersonalAccount", accountId: ACCOUNT } };
}), { $tag: "Ok", _0: ACCOUNT });
assert.equal(calls.filter((call) => /^(insert|update|delete)/i.test(call.sql)).length, 0);
assert.equal(decisions, 2);

for (const operation of [
  (guard) => createMembership({ userId: OTHER, accountId: ACCOUNT, role: "member" }, guard),
  (guard) => setMembershipRole(USER, ACCOUNT, "owner", guard),
  (guard) => deleteMembership(USER, ACCOUNT, guard),
]) {
  calls = [];
  await assert.rejects(operation((snapshot) => {
    assert.equal(inTransaction, true);
    assert.deepEqual(snapshot.owners, [USER]);
    assert.equal(snapshot.members.length, 1);
    assert(calls.some((call) => /from "accounts".*for update/i.test(call.sql)));
    assert(calls.some((call) => /from "account_memberships".*for update/i.test(call.sql)));
    return { $tag: "Err", _0: "refused by repository decision" };
  }), /refused by repository decision/);
  assert.equal(calls.filter((call) => /^(insert|update|delete)/i.test(call.sql)).length, 0);
}
members = [];
calls = [];
assert.deepEqual(await ensurePersonalAccount(USER, () => ({ $tag: "Err", _0: "membership missing" })),
  { $tag: "Err", _0: "membership missing" });
assert.equal(calls.filter((call) => /^(insert|update|delete)/i.test(call.sql)).length, 0);
assert.equal(link, ACCOUNT);
console.log("personal identity transactions preserve the private partition");
