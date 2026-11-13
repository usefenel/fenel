import assert from "node:assert/strict";
import { mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { functions, functionInstances } from "../schema/functions";
import { registryImports } from "../schema/registries";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointRow } from "@fenel/engine/checkpoint-json";

type Row = Record<string, unknown>;
const definitions: Row[] = [
  { id: "old", accountId: "account", name: "Source:run", active: false, sourceRegistryId: "v1" },
  { id: "current", accountId: "account", name: "Source:run", active: true, sourceRegistryId: "v2" },
  { id: "foreign", accountId: "other", name: "Foreign:run", active: true, sourceRegistryId: null },
  { id: "ordinary", accountId: "account", name: "ordinary", active: true, sourceRegistryId: null },
];
let imports: Row[] = [{ id: "import", accountId: "account", registryId: "v2" }];
const inserted: Row[] = [];
const locks: string[] = [];
const dialect = new PgDialect();
let locked = false;
let onLock: (() => void) | undefined;
const db = {
  async transaction<T>(operation: (transaction: typeof tx) => Promise<T>): Promise<T> {
    assert.equal(locked, false);
    try { return await operation(tx); } finally { locked = false; }
  },
};
const tx = {
  async execute(query: SQL) {
    const compiled = dialect.sqlToQuery(query);
    assert(compiled.sql.includes("pg_advisory_xact_lock"));
    assert.deepEqual(compiled.params, ["account"]);
    locks.push(compiled.sql); locked = true; onLock?.();
  },
  select: () => ({ from: (table: unknown) => ({ where: (condition: SQL) => ({ limit: async (limit: number) => {
    assert(locked, "read must occur after acquiring the account install lock");
    const query = dialect.sqlToQuery(condition);
    const equalities = [...query.sql.matchAll(/"(?:functions|registry_imports)"\."([a-z_]+)" = \$(\d+)/g)];
    assert.equal(equalities.length, query.params.length, "every bound predicate must be checked by this storage double");
    const data = table === functions ? definitions : table === registryImports ? imports : undefined;
    assert(data, "unexpected table");
    return data.filter((row) => equalities.every(([, column, parameter]) => {
      const key = column!.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      return row[key] === query.params[Number(parameter) - 1];
    })).slice(0, limit);
  } }) }) }),
  insert: (table: unknown) => ({ values: (row: Row) => ({ returning: async () => {
    assert.equal(table, functionInstances); assert(locked, "insert must share the selection transaction");
    const saved = { id: `instance-${inserted.length}`, ...row }; inserted.push(saved); return [saved];
  } }) }),
};
mock.module("../client", () => ({ getDb: () => db }));
const { createActiveFunctionInstance, FunctionStartUnavailable } = await import("./functions");
const input = { profileId: null, variables: { value: 4 }, triggerEvent: { type: "_manual_run" } };
for (const id of ["old", "foreign", "missing"]) {
  await assert.rejects(createActiveFunctionInstance("account", { id }, input), FunctionStartUnavailable);
}
assert.equal(inserted.length, 0);
imports = [];
await assert.rejects(createActiveFunctionInstance("account", { id: "current" }, input), FunctionStartUnavailable);
assert.equal(inserted.length, 0);
imports = [{ id: "import", accountId: "account", registryId: "v2" }];
assert.equal((await createActiveFunctionInstance("account", { name: "Source:run" }, input)).functionId, "current");
onLock = () => {
  definitions[1]!.active = false;
  definitions.push({ id: "next", accountId: "account", name: "Source:run", active: true, sourceRegistryId: "v3" });
  imports = [{ id: "next-import", accountId: "account", registryId: "v3" }];
  onLock = undefined;
};
assert.equal((await createActiveFunctionInstance("account", { name: "Source:run" }, input)).functionId, "next");
assert.equal((await createActiveFunctionInstance("account", { id: "ordinary" }, input)).functionId, "ordinary");
definitions.push({ id: "duplicate", accountId: "account", name: "ordinary", active: true, sourceRegistryId: null });
await assert.rejects(createActiveFunctionInstance("account", { name: "ordinary" }, input), FunctionStartUnavailable);
assert.equal(inserted.length, 3);
const native = { number: Infinity, bytes: new Uint8Array([1, 2]), literal: { $fenelCheckpoint: ["number", "+infinity"] } };
const nativeRow = await createActiveFunctionInstance("account", { id: "ordinary" }, {
  profileId: null, variables: { native }, triggerEvent: { type: "manual", native },
});
assert.equal(nativeRow.variablesEncoding, CHECKPOINT_VALUE_ENCODING);
assert.equal(nativeRow.triggerEventEncoding, CHECKPOINT_VALUE_ENCODING);
const decoded = decodeCheckpointRow(JSON.parse(JSON.stringify(nativeRow)));
assert.deepEqual(decoded.variables, { native });
assert.deepEqual(decoded.triggerEvent, { type: "manual", native });
const beforeInvalid = inserted.length;
await assert.rejects(createActiveFunctionInstance("account", { id: "ordinary" }, {
  profileId: null, variables: { host: () => 1 }, triggerEvent: {},
}), /Unsupported checkpoint function/);
assert.equal(inserted.length, beforeInvalid);
assert(locks.length >= 8);
console.log("PASS active/install/account selection and invocation share one lock; upgrades select the current version");
