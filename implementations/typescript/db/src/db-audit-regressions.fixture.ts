// @ts-nocheck -- Isolated DB-free test process; no production client is created.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleQueryError, getTableColumns } from "drizzle-orm";
import { sessions } from "./schema/auth";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const HASH = "opaque-token-hash";
const dialect = new PgDialect();
let calls = [];
let transactionOpen = false;
let membership = true;
let sessionResult = [];
let functionResult = true;
let physical = [];
let nextActive = false;
let queryFailure;

const sessionData = { id: SESSION, user_id: USER, account_id: ACCOUNT, token_hash: HASH,
  label: null, expires_at: null, created_at: "2026-09-07T00:00:00.000Z", last_used_at: null };
const sessionValues = () => Object.values(getTableColumns(sessions)).map((col) => sessionData[col.name]);
const db = drizzle(async (sql, params, method) => {
  calls.push({ sql, params, method, transactionOpen });
  if (/^select .* from "sessions"/.test(sql)) return { rows: sessionResult };
  if (/^select .* from "account_memberships"/.test(sql)) return { rows: membership ? [["membership-id"]] : [] };
  if (/^insert into "sessions"/.test(sql)) return { rows: [sessionValues()] };
  if (/^update "functions"/.test(sql)) {
    if (queryFailure !== undefined) throw queryFailure;
    return { rows: functionResult ? [/returning "id", "active"/.test(sql) ? [FN, nextActive] : [FN]] : [] };
  }
  throw new Error(`Unexpected query: ${sql}`);
});
db.execute = async (expression) => {
  const query = dialect.sqlToQuery(expression);
  calls.push({ ...query, method: "execute", transactionOpen });
  if (/with physical as/i.test(query.sql)) return [{ physicalRowTexts: physical.map((row) => JSON.stringify(row)) }];
  if (/pg_advisory_xact_lock/.test(query.sql)) return [];
  if (/date_trunc/.test(query.sql)) return [];
  throw new Error(`Unexpected execute: ${query.sql}`);
};
db.transaction = async (operation) => {
  assert.equal(transactionOpen, false, "test does not simulate nested transactions");
  transactionOpen = true;
  calls.push({ event: "begin" });
  try { const value = await operation(db); calls.push({ event: "commit" }); return value; }
  catch (error) { calls.push({ event: "rollback" }); throw error; }
  finally { transactionOpen = false; }
};
mock.module("./client", () => ({ getDb: () => db, closeDb: async () => {} }));

const { getSessionByHash, createSession } = await import("./queries/sessions");
const { listUserAccountRoots } = await import("./queries/users");
const { setFunctionActive } = await import("./queries/functions");
const { executeQuery } = await import("./queries/entity-query");
const { loadAccountFieldDefinitionGraph, executeFieldDefinitionCommandTransaction, FieldDefinitionPersistenceConflict } =
  await import("./queries/field-definition-bundles");
const { planFieldPersistence } = await import("@fenel/engine/field-authoring");

const cases = [];
async function check(name, work) {
  calls = []; membership = true; sessionResult = []; functionResult = true; physical = [];
  queryFailure = undefined;
  try { await work(); cases.push({ name, ok: true }); }
  catch (error) { cases.push({ name, ok: false, error: String(error), stack: error.stack }); }
}
const statement = (match) => calls.find((call) => call.sql && match.test(call.sql));
const fnRow = (overrides = {}) => ({ _table: "functions", row: {
  id: FN, account_id: ACCOUNT, name: "auditFn", version: 1, active: false, is_system: false,
  function: { id: "auditFn", params: [], returns: { $ref: "Number" }, body: 49 }, ...overrides,
} });
const planEdit = (graph) => planFieldPersistence({
  ...graph, ownerMutations: [{ kind: "upsert", owner: {
    ownerKey: "function:auditFn", kind: "function", storageName: "auditFn", storageId: FN,
    definition: { id: "auditFn", params: [], returns: { $ref: "Number" }, body: 50 },
  } }],
});

await check("session lookup joins both membership axes and a current expiry boundary", async () => {
  sessionResult = [sessionValues()];
  const before = Date.now();
  const result = await getSessionByHash(HASH);
  const after = Date.now();
  assert.equal(result.id, SESSION);
  assert.equal(result.userId, USER);
  assert.equal(result.accountId, ACCOUNT);
  const query = statement(/^select .* from "sessions"/);
  assert.match(query.sql, /inner join "account_memberships" on \("account_memberships"\."user_id" = "sessions"\."user_id" and "account_memberships"\."account_id" = "sessions"\."account_id"\)/);
  assert.match(query.sql, /"sessions"\."token_hash" = \$1/);
  assert.match(query.sql, /\("sessions"\."expires_at" is null or "sessions"\."expires_at" > \$2\)/);
  assert.equal(query.params[0], HASH);
  assert(new Date(query.params[1]).getTime() >= before && new Date(query.params[1]).getTime() <= after);
});

await check("an absent membership/expired lookup result exposes no session", async () => {
  assert.equal(await getSessionByHash(HASH), null);
});

await check("account selector labels are joined only through the authenticated user's memberships", async () => {
  await listUserAccountRoots(USER);
  const query = statement(/^select .* from "account_memberships"/);
  assert.match(query.sql, /inner join "accounts" on "accounts"\."id" = "account_memberships"\."account_id"/);
  assert.match(query.sql, /where "account_memberships"\."user_id" = \$1/);
  assert.deepEqual(query.params, [USER]);
  assert(!query.sql.includes('"config"'));
});

await check("session issuance refuses a missing exact-account membership before insertion", async () => {
  membership = false;
  await assert.rejects(createSession({ userId: USER, accountId: ACCOUNT, tokenHash: HASH }), /Account membership required/);
  assert.equal(statement(/^insert/), undefined);
  const query = statement(/^select/);
  assert.match(query.sql, /"account_memberships"\."user_id" = \$1 and "account_memberships"\."account_id" = \$2/);
  assert.deepEqual(query.params.slice(0, 2), [USER, ACCOUNT]);
  assert.equal(calls.at(-1).event, "rollback");
});

await check("membership key-share and session insertion share one open transaction", async () => {
  const result = await createSession({ userId: USER, accountId: ACCOUNT, tokenHash: HASH });
  assert.equal(result.id, SESSION);
  const query = statement(/^select/);
  assert.match(query.sql, /for key share$/);
  assert.equal(query.transactionOpen, true);
  assert.equal(statement(/^insert/).transactionOpen, true);
  assert.deepEqual(calls.map((call) => call.event ?? (/^select/.test(call.sql) ? "membership" : "insert")),
    ["begin", "membership", "insert", "commit"]);
});

await check("activation targets account, stable ID, unique v1 and non-system definition under lock", async () => {
  assert.deepEqual(await setFunctionActive(ACCOUNT, FN, false), { id: FN, active: false });
  const lock = statement(/pg_advisory_xact_lock/);
  const update = statement(/^update/);
  assert.equal(lock.transactionOpen, true);
  assert.equal(update.transactionOpen, true);
  assert(calls.indexOf(lock) < calls.indexOf(update));
  assert.match(update.sql, /"functions"\."account_id" = \$\d+/);
  assert.match(update.sql, /"functions"\."id" = \$\d+/);
  assert.match(update.sql, /"functions"\."version" = \$\d+/);
  assert.match(update.sql, /"functions"\."version" = \$\d+/);
  assert.match(update.sql, /"functions"\."is_system" = \$\d+/);
  assert.match(update.sql, /not exists \(select 1 from "functions" other_function/);
  assert.match(update.sql, /other_function\.account_id = "functions"\."account_id"/);
  assert.match(update.sql, /other_function\.name = "functions"\."name"/);
  assert.match(update.sql, /other_function\.id <> "functions"\."id"/);
  assert.deepEqual(update.params.slice(2), [ACCOUNT, FN, 1, false]);
});

await check("an activation query matching no eligible row returns null", async () => {
  functionResult = false;
  assert.equal(await setFunctionActive(ACCOUNT, FN, false), null);
});

await check("a sole inactive v1 owner loads without a storage ambiguity", async () => {
  physical = [fnRow()];
  const graph = await loadAccountFieldDefinitionGraph(ACCOUNT);
  assert.equal(graph.currentOwners[0].storageId, FN);
  assert.deepEqual(graph.storageIssues, []);
  assert.equal(graph.currentOwners[0].definition.body, 49);
});

await check("the real planner and writer edit an inactive owner without requiring active=true", async () => {
  physical = [fnRow()];
  await executeFieldDefinitionCommandTransaction(ACCOUNT, planEdit);
  const update = statement(/^update "functions"/);
  assert(update, "planned owner update must reach persistence");
  assert.equal(update.transactionOpen, true);
  assert.match(update.sql, /"functions"\."account_id" = \$\d+/);
  assert.match(update.sql, /"functions"\."id" = \$\d+/);
  assert(!update.sql.includes('"functions"."active"'), "pausing execution must not disable definition authoring");
  assert.equal(calls.at(-1).event, "commit");
});

for (const code of ["23505", "40001"]) {
  await check(`raw PostgreSQL ${code} rolls back as a definition conflict`, async () => {
    const failure = Object.assign(new Error("driver failure"), { code });
    await assert.rejects(
      executeFieldDefinitionCommandTransaction(ACCOUNT, () => { throw failure; }),
      FieldDefinitionPersistenceConflict,
    );
    assert.equal(calls.at(-1).event, "rollback");
  });

  await check(`Drizzle-wrapped PostgreSQL ${code} rolls back as a definition conflict`, async () => {
    physical = [fnRow()];
    // The actual Drizzle query executor wraps this simulated driver failure.
    queryFailure = Object.assign(new Error("driver failure"), { code });
    await assert.rejects(
      executeFieldDefinitionCommandTransaction(ACCOUNT, planEdit),
      FieldDefinitionPersistenceConflict,
    );
    assert(statement(/^update "functions"/));
    assert.equal(calls.at(-1).event, "rollback");
  });
}

await check("definition transactions preserve non-conflict failures and existing domain errors", async () => {
  for (const failure of [
    new Error("planner failure"),
    new DrizzleQueryError("select 1", [], Object.assign(new Error("foreign key"), { code: "23503" })),
    new FieldDefinitionPersistenceConflict("already classified"),
    null,
  ]) {
    await assert.rejects(
      executeFieldDefinitionCommandTransaction(ACCOUNT, () => { throw failure; }),
      (error) => error === failure,
    );
    assert.equal(calls.at(-1).event, "rollback");
  }
});

for (const rows of [
  [fnRow({ version: 2, active: true })],
  [fnRow({ active: true }), fnRow({ id: USER, version: 2, active: true })],
  [fnRow(), fnRow({ id: USER, version: 2, active: true })],
  [fnRow(), fnRow({ id: USER, version: 2, active: false })],
]) {
  await check(`historical ambiguity still refuses authoring: ${rows.map((x) => `${x.row.version}/${x.row.active}`).join(",")}`, async () => {
    physical = rows;
    const graph = await loadAccountFieldDefinitionGraph(ACCOUNT);
    assert(graph.storageIssues.length > 0);
    assert.throws(() => planEdit(graph));
    assert.equal(statement(/^update/), undefined);
  });
}

await check("aggregate bucket interval remains a value parameter with hostile input", async () => {
  const interval = "day'); select pg_sleep(10); --";
  await executeQuery(ACCOUNT, { entity: "function", aggregate: [{ fn: "count", as: "count" }],
    bucket: { field: "createdAt", interval, as: "bucket" } });
  const query = statement(/date_trunc/);
  assert(!query.sql.includes(interval));
  assert.equal(query.params.filter((value) => value === interval).length, 1);
  assert.match(query.sql, /date_trunc\(\$\d+, "created_at"\)/);
  assert.match(query.sql, /group by 1(?:\s|$)/i);
  assert(query.params.includes(ACCOUNT));
});

await check("aggregate bucket aliases escape embedded double quotes as one identifier", async () => {
  const alias = 'bucket"; select pg_sleep(10); --';
  await executeQuery(ACCOUNT, { entity: "function", aggregate: [{ fn: "count", as: "count" }],
    bucket: { field: "createdAt", interval: "day", as: alias } });
  const query = statement(/date_trunc/);
  assert(query.sql.includes('AS "bucket""; select pg_sleep(10); --"'), query.sql);
  assert(!query.sql.includes('AS "bucket"; select pg_sleep'));
});

await check("bucket grouping uses the selected expression even when its alias names an input column", async () => {
  await executeQuery(ACCOUNT, { entity: "function", aggregate: [{ fn: "count", as: "count" }],
    bucket: { field: "createdAt", interval: "day", as: "created_at" }, groupBy: ["active"] });
  const query = statement(/date_trunc/);
  assert.equal(query.params.filter((value) => value === "day").length, 1);
  assert.equal((query.sql.match(/date_trunc\(/g) ?? []).length, 1);
  assert.match(query.sql, /select\s+date_trunc\(\$\d+, "created_at"\) as "created_at"/i);
  assert.match(query.sql, /group by 1, "functions"\."active"/i);
});

console.log(JSON.stringify({ cases, passed: cases.filter((entry) => entry.ok).length, total: cases.length }, null, 2));
if (cases.some((entry) => !entry.ok)) process.exitCode = 1;
