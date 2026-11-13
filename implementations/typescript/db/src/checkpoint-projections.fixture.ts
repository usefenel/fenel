// @ts-nocheck -- Isolated real Drizzle queries; only the PostgreSQL driver is simulated.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as orm from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { functionInstances, functions, functionTraces } from "./schema/functions";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, encodeCheckpointVariables, decodeCheckpointRow } from "@fenel/engine/checkpoint-json";

const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const instant = "2026-09-08T00:00:00.000Z";
const marker = encodeCheckpointValue(Infinity);
const native = { type: { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", min: 0, max: Infinity, child: { t: "eps" } } } } }, bytes: Uint8Array.of(0, 255), business: marker };
const variables = { _lastResult: native, _checkpoints: ["opened"], _lastCheckpoint: "opened" };
const instanceRows = [
  { id: "encoded-instance", account_id: account, function_id: "function", profile_id: "profile", status: "completed", variables: encodeCheckpointVariables(variables), variables_encoding: CHECKPOINT_VALUE_ENCODING, trigger_event: encodeCheckpointValue(native), trigger_event_encoding: CHECKPOINT_VALUE_ENCODING, started_at: instant, completed_at: instant },
  { id: "legacy-instance", account_id: account, function_id: "function", profile_id: "profile", status: "completed", variables: { _lastResult: marker }, variables_encoding: null, trigger_event: marker, trigger_event_encoding: null, started_at: instant, completed_at: instant },
];
const traceRows = [];
const sqlCalls = [];
const dialect = new PgDialect();

function selectedRows(sql, params) {
  const traces = /from "traces"/i.test(sql);
  let rows = traces ? traceRows : instanceRows;
  if (!traces) {
    // ⚠ THE WHERE CLAUSE, not the whole statement (review round 7). Selecting
    // `account_id` is not filtering by it, and `getTracesByInstance`'s ownership
    // lookup selects that column while filtering on `id` — which this simulator
    // read as an account filter with no account in `params`, returning nothing.
    const where = sql.slice(sql.search(/\swhere\s/i) + 1);
    if (/\swhere\s/i.test(sql) && /"account_id"/.test(where)) {
      rows = rows.filter((row) => params.includes(row.account_id));
    }
    const id = params.find((value) => instanceRows.some((row) => row.id === value));
    if (id) rows = rows.filter((row) => row.id === id);
  } else if (!/inner join/.test(sql)) rows = rows.filter((row) => row.instance_id === params[0]);
  return rows;
}
function selection(sql) { return sql.match(/^\s*select\s+([\s\S]*?)\s+from\s/i)[1].split(/,\s*/); }
function columnValue(expression, row) {
  if (expression === '"functions"."name"') return "Fixture function";
  if (expression === '"functions"."id"') return "function";
  if (expression === '"function_instances"."profile_id"') return "profile";
  const names = [...expression.matchAll(/"([^"]+)"/g)];
  return row[names.at(-1)?.[1]] ?? null;
}
function insertTraceRows(sql, params) {
  const columns = sql.match(/^insert into "traces" \(([^)]+)\)/)[1].split(/,\s*/).map((name) => name.replaceAll('"', ""));
  const values = sql.slice(sql.indexOf(" values ") + 8);
  for (const group of values.matchAll(/\(([^()]+)\)/g)) {
    const row = {};
    group[1].split(/,\s*/).forEach((expression, index) => {
      const parameter = expression.match(/^\$(\d+)/);
      let value = parameter ? params[Number(parameter[1]) - 1] : null;
      if (["input", "output", "meta", "value_types"].includes(columns[index]) && typeof value === "string") value = JSON.parse(value);
      row[columns[index]] = value;
    });
    traceRows.push(row);
  }
}
const driver = drizzle(async (sql, params) => {
  sqlCalls.push({ sql, params });
  if (sql.startsWith('insert into "traces"')) { insertTraceRows(sql, params); return { rows: [] }; }
  const rows = selectedRows(sql, params);
  if (/COUNT\(\*\)/i.test(sql)) return { rows: [["completed", rows.length]] };
  const columns = selection(sql);
  return { rows: rows.map((row) => columns.map((expression) => columnValue(expression, row))) };
});
const db = new Proxy(driver, { get(target, key) {
  if (key === "execute") return async (query) => {
    const { sql, params } = dialect.sqlToQuery(query); sqlCalls.push({ sql, params });
    const columns = selection(sql);
    return selectedRows(sql, params).map((row) => columns[0] === "*" ? { ...row }
      : Object.fromEntries(columns.map((column) => [column.replaceAll('"', ""), columnValue(column, row)])));
  };
  const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
} });
mock.module("./client", () => ({ getDb: () => db }));
const { getProfileFunctions, getFunctionInstances, getFunctionStats } = await import("./queries/function-tracking");
const { executeQuery } = await import("./queries/entity-query");
const { insertTraces, getTracesByInstance, getRecentTracesByType } = await import("./queries/traces");

assert.deepEqual((await getProfileFunctions(account, "profile"))[0].checkpoints, ["opened"]);
assert.deepEqual((await getFunctionInstances(account, "function"))[0].checkpoints, ["opened"]);
assert.deepEqual((await getFunctionStats(account, "function")).byCheckpoint, { opened: 1 });
for (const select of [undefined, ["variables"], ["triggerEvent"], ["id"]]) {
  const result = await executeQuery(account, { entity: "functionInstance", select });
  assert(result.rows.every((row) => !Object.hasOwn(row, "variables_encoding") && !Object.hasOwn(row, "variablesEncoding")));
  assert(result.rows.every((row) => !Object.hasOwn(row, "trigger_event_encoding") && !Object.hasOwn(row, "triggerEventEncoding")));
  if (!select || select[0] === "variables") {
    assert.deepEqual(result.rows[0].variables._lastResult, native);
    assert.deepEqual(result.rows[1].variables._lastResult, marker);
    assert.deepEqual(decodeCheckpointRow(result.rows[0]).variables._lastResult, native);
  }
  if (!select || select[0] === "triggerEvent") {
    assert.deepEqual(result.rows[0].triggerEvent, native);
    assert.deepEqual(result.rows[1].triggerEvent, marker);
  }
}
assert(sqlCalls.some(({ sql }) => /SELECT "variables", "variables_encoding"/.test(sql)));
assert(sqlCalls.some(({ sql }) => /SELECT "trigger_event", "trigger_event_encoding"/.test(sql)));

// Invoke the actual state handler closures without importing the complete
// runtime registry. This pins explicit SELECT provenance and DTO stripping.
const stateSource = await Bun.file(new URL("../../runtime/src/handlers/state.ts", import.meta.url)).text();
const dbExports = { getDb: () => db, functionInstances, functions };
for (const name of ["list_function_instances", "get_function_instance", "find_last_completed_instance", "list_function_instances_by_account"]) {
  const start = stateSource.indexOf(`reg.registerIOHandler("state.${name}", async (`);
  assert(start >= 0, name);
  const bodyStart = stateSource.indexOf("async (", start);
  const bodyEnd = stateSource.indexOf("\n  });", bodyStart);
  const body = (stateSource.slice(bodyStart, bodyEnd) + "\n}")
    .replaceAll('await import("@fenel/db")', "dbExports").replaceAll('await import("drizzle-orm")', "orm");
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(`const handler = ${body};`);
  const handler = new Function("dbExports", "orm", "decodeCheckpointRow", `${code}; return handler;`)(dbExports, orm, decodeCheckpointRow);
  const result = await handler({ instanceId: "encoded-instance", fnDbId: "function" }, { accountId: account });
  const rows = Array.isArray(result.value) ? result.value : [result.value._0];
  assert.deepEqual(rows[0].variables._lastResult, native, name);
  assert(rows.every((row) => !Object.hasOwn(row, "variablesEncoding")), name);
  assert(rows.every((row) => !Object.hasOwn(row, "triggerEventEncoding")), name);
  if (rows[0].triggerEvent !== undefined) assert.deepEqual(rows[0].triggerEvent, native, name);
}

const Nothing = { $tag: "Nothing" };
const Just = (_0) => ({ $tag: "Just", _0 });
const trace = { id: "native-trace", instanceId: "encoded-instance", parentId: Nothing, name: "typed result", kind: "call", status: "completed", startedAt: instant, completedAt: Just(instant), durationMs: Just(1), input: Just({ native }), output: Just(native), error: Nothing, capability: Nothing, provider: Nothing, meta: Just({ native }), valueTypes: Just(["Type"]), stepPath: Nothing };
await insertTraces([trace, { ...trace, id: "null-trace", output: Just(null) }, { ...trace, id: "empty-trace", input: Nothing, output: Nothing, meta: Nothing }]);
assert(traceRows.every((row) => row.values_encoding === CHECKPOINT_VALUE_ENCODING));
traceRows.push({ ...traceRows[0], id: "legacy-trace", values_encoding: null, input: marker, output: null, meta: null });
// rights R2b review round 7 — the ACCOUNT. `getTracesByInstance` became
// account-scoped in round 6 and this caller was missed: the file carries
// `@ts-nocheck`, so the typecheck could not see the arity change and the break
// only showed as a red test.
const traces = await getTracesByInstance(account, "encoded-instance");
assert.deepEqual(traces[0], trace);
assert.deepEqual(traces[1].output, Just(null));
assert.deepEqual(traces[2].input, Nothing);
assert.deepEqual(traces[2].output, Nothing);
assert.deepEqual(traces[3].input, Just(marker));
assert.deepEqual(traces[3].output, Nothing);
assert(traces.every((row) => !Object.hasOwn(row, "valuesEncoding")));
assert.deepEqual((await getRecentTracesByType(account, "Type"))[0].output, trace.output);
console.log("checkpoint projections preserve native values and legacy markers through SQL, state rows, and traces");
