// @ts-nocheck -- The PostgreSQL driver is simulated in an isolated process.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { getTableColumns } from "drizzle-orm";
import { entityInstances } from "./schema/entity-instances";
import { List, Nothing } from "@fenel/engine/type-foundation";
import { INSTANCE_JSON_ENCODING } from "@fenel/engine/authoring/type";
import { evaluate } from "@fenel/engine";

const field = (name, type) => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const entries = {
  Eq: { id: "Eq", params: ["a"], type: { $record: { fields: [field("eq", { $arrow: { params: [], returns: { $ref: "Boolean" } } })] } }, interface: { name: "Eq", methods: [] } },
  Reprable: { id: "Reprable", params: ["target", "a"], type: { $record: { fields: [field("native", { $type: true })] } }, interface: { name: "Reprable", methods: [] } },
  Exemplifiable: { id: "Exemplifiable", params: ["a"], type: { $record: { fields: [field("examples", List({ $var: "a" }))] } }, interface: { name: "Exemplifiable", methods: [] } },
  SetCarrier: { id: "SetCarrier", type: { $record: { fields: [field("set", { $ref: "SetExpr" })] } }, interface: { name: "SetCarrier", methods: [] } },
  Callable: { id: "Callable", type: { $record: { fields: [field("run", { $arrow: { params: [], returns: { $ref: "Bytes" } } })] } }, interface: { name: "Callable", methods: [] } },
  PartialCallable: { id: "PartialCallable", type: { $record: { fields: [field("run", { $arrow: { params: [field("later", { $ref: "String" })], returns: { $ref: "Bytes" } } })] } }, interface: { name: "PartialCallable", methods: [] } },
};
const registry = { getEntity: (name) => entries[name], getIdentifiedEntity: (name) => entries[name], getFieldRepresentation: () => undefined, listEntities: () => Object.values(entries) };
const registryReads = [];
mock.module("./queries/account-value-registry", () => ({ getDbAccountValueRegistry: async (accountId) => {
  registryReads.push(accountId);
  return registry;
} }));

const rows = new Map();
const queries = [];
const columns = Object.values(getTableColumns(entityInstances));
const values = (row) => columns.map((column) => row[column.name] ?? null);
const db = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.startsWith('insert into "entity_instances"')) {
    const match = sql.match(/^insert into "entity_instances" \(([^)]+)\) values \(([^)]+)\)/);
    assert(match, sql);
    const names = match[1].split(", ").map((name) => name.replaceAll('"', ""));
    const expressions = match[2].split(", ");
    const row = { created_at: "2026-09-08T00:00:00.000Z", updated_at: "2026-09-08T00:00:00.000Z" };
    names.forEach((name, index) => {
      if (expressions[index].startsWith("$")) row[name] = params[Number(expressions[index].slice(1)) - 1];
    });
    if (rows.has(row.id) && sql.includes("on conflict do nothing")) return { rows: [] };
    row.data = JSON.parse(row.data); rows.set(row.id, row);
    return { rows: [values(row)] };
  }
  if (sql.startsWith('update "entity_instances"')) {
    const [accountId, id, entityType] = params.slice(-3);
    const row = rows.get(id);
    if (!row || row.account_id !== accountId || row.entity_type !== entityType) return { rows: [] };
    for (const match of sql.matchAll(/"(data|data_encoding|updated_at)" = \$(\d+)/g)) {
      const value = params[Number(match[2]) - 1];
      row[match[1]] = match[1] === "data" ? JSON.parse(value) : value;
    }
    return { rows: [values(row)] };
  }
  if (sql.startsWith("select ") && sql.includes('from "entity_instances"')) {
    const [accountId, id] = params;
    let selected = [...rows.values()].filter((row) => row.account_id === accountId);
    if (sql.includes('"entity_instances"."id" =')) selected = selected.filter((row) => row.id === id);
    if (sql.includes('"entity_instances"."entity_type" in')) selected = selected.filter((row) => params.slice(sql.includes('"entity_instances"."id" =') ? 2 : 1).includes(row.entity_type));
    if (sql.includes('"entity_instances"."entity_type" =')) selected = selected.filter((row) => row.entity_type === params[1]);
    if (sql.includes(" limit ")) selected = selected.slice(0, 1);
    const selectedNames = sql.slice(7, sql.indexOf(" from ")).split(", ").map((name) => [...name.matchAll(/"([^"]+)"/g)].at(-1)[1]);
    return { rows: selected.map((row) => selectedNames.map((name) => row[name] ?? null)) };
  }
  if (sql.startsWith('delete from "entity_instances"')) {
    const [accountId, id, ...types] = params;
    const row = rows.get(id);
    if (row?.account_id === accountId && types.includes(row.entity_type)) rows.delete(id);
    return { rows: [] };
  }
  throw new Error(`Unexpected query: ${sql}`);
});
// pg-proxy has no transaction driver. The production callback still emits
// the FOR UPDATE query; the fixture records its SQL and performs no host IO.
db.transaction = async (operation) => operation(db);
mock.module("./client", () => ({ getDb: () => db }));
const { createDispatchInstance, getDispatchInstance, updateDispatchInstance, deleteDispatchInstance, listInstances, DispatchInstancePersistenceConflict } = await import("./queries/dispatch-instances");
const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
assert.deepEqual(await listInstances(account), []);
assert.equal(registryReads.length, 0, "empty account enumeration must not acquire a codec registry");
const payload = {
  typeName: "Eq", args: ["String"], methods: { eq: { $ref: "std:eq" } },
  scope: { kind: "tag", tag: "preview" }, priority: 0,
  label: { en: "String equality" }, where: [{ class: { $tag: "Id", entityId: "Ord" }, args: ["String"] }],
};
const created = await createDispatchInstance(account, { typeName: "Eq", args: payload.args, instance: payload });
const stableId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const stable = await createDispatchInstance(account, { id: stableId, typeName: "Eq", args: payload.args, instance: payload });
assert.equal(stable.id, stableId);
await assert.rejects(createDispatchInstance(account, { id: stableId, typeName: "Eq", args: payload.args, instance: payload }), DispatchInstancePersistenceConflict);
await assert.rejects(createDispatchInstance(account, { id: "invalid", typeName: "Eq", args: payload.args, instance: payload }), TypeError);
assert.equal(rows.get(created.id).data_encoding, INSTANCE_JSON_ENCODING);
assert.deepEqual(created.instance, payload);
assert.deepEqual((await getDispatchInstance(account, created.id)).instance, payload);
const edited = { ...payload, args: [{ $var: "a" }], methods: { eq: { fn: ["x", true] } }, label: { en: "Generic equality" } };
await updateDispatchInstance(account, created.id, { instance: edited });
await assert.rejects(updateDispatchInstance(account, created.id, { instance: payload, expectedInstance: payload }), DispatchInstancePersistenceConflict);
assert.deepEqual((await getDispatchInstance(account, created.id)).instance, edited);
await updateDispatchInstance(account, created.id, { instance: edited, expectedInstance: { ...edited, methods: { ...edited.methods } } });
await assert.rejects(deleteDispatchInstance(account, created.id, { expectedInstance: payload }), DispatchInstancePersistenceConflict);
await assert.rejects(updateDispatchInstance("other-account", created.id, { instance: payload, expectedInstance: payload }), DispatchInstancePersistenceConflict);
await assert.rejects(deleteDispatchInstance("other-account", created.id, { expectedInstance: payload }), DispatchInstancePersistenceConflict);
await deleteDispatchInstance(account, stableId, { expectedInstance: stable.instance });
assert.equal(await getDispatchInstance(account, stableId), null);
await assert.rejects(updateDispatchInstance(account, stableId, { instance: payload, expectedInstance: stable.instance }), DispatchInstancePersistenceConflict);
await assert.rejects(deleteDispatchInstance(account, stableId, { expectedInstance: stable.instance }), DispatchInstancePersistenceConflict);
const reopened = await getDispatchInstance(account, created.id);
assert.deepEqual(reopened.instance, edited);
assert.equal(reopened.targetEntityType, null);
assert.deepEqual(rows.get(created.id).data.args, [{ $var: "a" }]);
assert.deepEqual(rows.get(created.id).data.where, payload.where);
assert.equal(await getDispatchInstance("other-account", created.id), null);
const explicit = await createDispatchInstance(account, { typeName: "Eq", args: ["String"], instance: payload, targetEntityType: "profile" });
await updateDispatchInstance(account, explicit.id, { instance: { ...payload, args: ["Int"] } });
assert.equal((await getDispatchInstance(account, explicit.id)).targetEntityType, "profile");
await updateDispatchInstance(account, explicit.id, { instance: { methods: { eq: "changed" } } });
const partial = await getDispatchInstance(account, explicit.id);
assert.deepEqual(partial.args, ["Int"]);
assert.deepEqual(partial.instance.label, payload.label);
assert.deepEqual(partial.instance.where, payload.where);
const pattern = { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } };
const type = { $refined: { base: { $ref: "String" }, set: pattern } };
const typed = await createDispatchInstance(account, { typeName: "Reprable", args: ["JsRuntime", "Custom"], instance: { methods: { native: type } } });
assert.equal(rows.get(typed.id).data.methods.native.$refined.set.pattern.max, "unbounded");
assert.deepEqual((await getDispatchInstance(account, typed.id)).instance.methods.native, type);
const updatedType = { $refined: { ...type.$refined, set: { ...pattern, pattern: { ...pattern.pattern, min: 1 } } } };
await updateDispatchInstance(account, typed.id, { instance: { methods: { native: updatedType } } });
assert.deepEqual((await getDispatchInstance(account, typed.id)).instance.methods.native, updatedType);
const binary = await createDispatchInstance(account, { typeName: "Exemplifiable", args: ["Bytes"], instance: { methods: { examples: [Uint8Array.of(0, 255)] } } });
assert.deepEqual(rows.get(binary.id).data.methods.examples, [[0, 255]]);
assert.deepEqual((await getDispatchInstance(account, binary.id)).instance.methods.examples, [Uint8Array.of(0, 255)]);
const setRow = await createDispatchInstance(account, { typeName: "SetCarrier", args: [], instance: { methods: { set: pattern } } });
assert.equal(rows.get(setRow.id).data.methods.set.pattern.max, "unbounded");
assert.deepEqual((await getDispatchInstance(account, setRow.id)).instance.methods.set, pattern);
const captured = { bytes: Uint8Array.of(4, 5), limit: Infinity, zero: -0, business: { $fenelCheckpoint: ["number", "+infinity"] } };
const closure = evaluate({ fn: [[], { var: ["missing", captured.bytes] }] }, { captured });
const callable = await createDispatchInstance(account, { typeName: "Callable", args: [], instance: { methods: { run: closure } } });
const storedCallable = (await getDispatchInstance(account, callable.id)).instance.methods.run;
assert.deepEqual(storedCallable, closure);
assert.deepEqual(evaluate({ call: [{ var: "saved" }] }, { saved: storedCallable }), captured.bytes);
const callableBaseline = (await getDispatchInstance(account, callable.id)).instance;
await updateDispatchInstance(account, callable.id, { instance: callableBaseline, expectedInstance: structuredClone(callableBaseline) });
const changedCallable = structuredClone(callableBaseline);
changedCallable.methods.run.captured = { different: true };
await assert.rejects(updateDispatchInstance(account, callable.id, { instance: callableBaseline, expectedInstance: changedCallable }), DispatchInstancePersistenceConflict);
for (const changedCapture of [
  { ...captured, zero: 0 },
  { ...captured, bytes: Uint8Array.of(4, 6) },
  { ...captured, business: Infinity },
]) {
  const changedClosure = evaluate({ fn: [[], { var: ["missing", captured.bytes] }] }, { captured: changedCapture });
  await assert.rejects(updateDispatchInstance(account, callable.id, {
    instance: callableBaseline, expectedInstance: { ...callableBaseline, methods: { run: changedClosure } },
  }), DispatchInstancePersistenceConflict, "native atoms and literal markers must retain distinct baselines");
}
const partialCallable = evaluate({ call: [{ fn: ["first", "later", { var: "first" }] }, { var: "bound" }] }, { bound: captured.bytes, captured });
const partialRow = await createDispatchInstance(account, { typeName: "PartialCallable", args: [], instance: { methods: { run: partialCallable } } });
await updateDispatchInstance(account, partialRow.id, { instance: { methods: { run: partialCallable } } });
const storedPartial = (await getDispatchInstance(account, partialRow.id)).instance.methods.run;
assert.deepEqual(evaluate({ call: [{ var: "saved" }, "unused"] }, { saved: storedPartial }), captured.bytes);
const unrelatedId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
rows.set(unrelatedId, { ...rows.get(created.id), id: unrelatedId, entity_type: "UnrelatedValue", data: { private: "not a dispatch instance" } });
const registryReadsBeforeList = registryReads.length;
const listed = await listInstances(account);
assert.equal(registryReads.length, registryReadsBeforeList + 1);
assert.equal(registryReads.at(-1), account);
assert.deepEqual(new Set(listed.map((row) => row.id)), new Set([...rows.keys()].filter((id) => id !== unrelatedId)));
assert.deepEqual(listed.find((row) => row.id === setRow.id).instance.methods.set, pattern, "account-defined classes keep typed decoding");
assert.deepEqual(listed.find((row) => row.id === binary.id).instance.methods.examples, [Uint8Array.of(0, 255)]);
const registryReadsBeforeForeign = registryReads.length;
assert.deepEqual(await listInstances("other-account"), []);
assert.equal(registryReads.length, registryReadsBeforeForeign, "foreign rows must not trigger registry acquisition");
assert(queries.filter((query) => query.sql.startsWith('update "entity_instances"')).every((query) => query.sql.includes('"entity_instances"."account_id"')));
assert(queries.some((query) => query.sql.endsWith(" for update")), "baseline reads lock the row until mutation");
console.log("create/read/update/read preserves typed args, callable methods, Type/SetExpr/Bytes methods, metadata, target and account scope");
console.log("empty account enumeration skips the codec registry; populated readers retain custom classes and typed values");
console.log("stable draft identities and locked native-preserving stale update/delete preconditions pass");
