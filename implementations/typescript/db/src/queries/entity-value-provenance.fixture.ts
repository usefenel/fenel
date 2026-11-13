// Process-isolated DB writer contract. The production validator and codecs run
// unchanged; only the database IO leaf records inserts/updates in memory.
import { mock } from "bun:test";
import assert from "node:assert/strict";

const written: Record<string, unknown>[] = [];
const rows: Record<string, unknown>[] = [];
const database = {
  insert: () => ({ values: (data: Record<string, unknown>) => ({ returning: async () => { written.push(data); rows.push(data); return [data]; } }) }),
  update: () => ({ set: (data: Record<string, unknown>) => ({ where: () => ({ returning: async () => { written.push(data); Object.assign(rows[0]!, data); return [rows[0]]; } }) }) }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
};
mock.module("../client", () => ({ getDb: () => database, closeDb: async () => {} }));

const { createEntityInstance, updateEntityInstance, getEntityInstance } = await import("./entity-instances");
const { createRegistry } = await import("@fenel/engine/registry");
const { Maybe } = await import("@fenel/engine/type-foundation");
const { valueFromJsonWire, VALUE_JSON_ENCODING } = await import("@fenel/engine/authoring/type");
const { evaluate } = await import("@fenel/engine");
const { SQL } = await import("drizzle-orm");
const callableType = { $arrow: { params: [], returns: { $ref: "Bytes" } } } as const;
const registry = createRegistry([{ name: "value-test", label: "Value test", entities: [{ id: "StoredTypeValue", type: { $type: true } }, { id: "StoredMaybe", type: Maybe({ $ref: "String" }) }, { id: "StoredCallable", type: callableType as never }] }]);
const typeValue = { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "match", pred: { $tag: "SeAll" } }, min: 0, max: Infinity } } } };
await createEntityInstance("value-account", "StoredTypeValue", typeValue, "type-row", registry);
assert.equal(written[0]!.dataEncoding, VALUE_JSON_ENCODING);
assert.equal((written[0]!.data as any).$refined.set.pattern.max, "unbounded");
const jsonData = JSON.parse(JSON.stringify(written[0]!.data));
assert.deepEqual(valueFromJsonWire({ $type: true }, jsonData, registry, VALUE_JSON_ENCODING), typeValue);
await updateEntityInstance("value-account", "type-row", { $ref: "Number" }, registry);
assert.equal(written[1]!.dataEncoding, VALUE_JSON_ENCODING);
assert.deepEqual(written[1]!.data, { $ref: "Number" });
await createEntityInstance("value-account", "StoredMaybe", null, "null-row", registry);
assert.equal(written[2]!.dataEncoding, VALUE_JSON_ENCODING);
assert.equal(written[2]!.data instanceof SQL, true, "JSON null must use an explicit JSONB literal, not SQL NULL");
rows[0]!.dataEncoding = "fenel-instance-json-v1";
const beforeDedicatedWrite = written.length;
await assert.rejects(
  updateEntityInstance("value-account", "type-row", { $ref: "String" }, registry),
  /dispatch-instance editor/,
);
assert.equal(written.length, beforeDedicatedWrite, "a generic write must not overwrite a dedicated instance envelope");
rows[0]!.dataEncoding = "fenel-instance-json-v2";
await assert.rejects(updateEntityInstance("value-account", "type-row", { $ref: "String" }, registry), /dispatch-instance editor/);
const bytes = Uint8Array.of(8, 9);
const captured = { bytes, limit: Infinity, business: { $fenelCheckpoint: ["number", "+infinity"] } };
const closure = evaluate({ fn: [[], { var: ["missing", bytes] }] }, { captured });
const saved = await createEntityInstance("value-account", "StoredCallable", closure, "callable-row", registry);
rows.splice(0, rows.length, saved);
const loaded = (await getEntityInstance("value-account", "callable-row"))!;
assert.equal(loaded.dataEncoding, VALUE_JSON_ENCODING);
const restored = valueFromJsonWire(callableType as never, JSON.parse(JSON.stringify(loaded.data)), registry, VALUE_JSON_ENCODING);
assert.deepEqual(restored, closure);
assert.deepEqual(evaluate({ call: [{ var: "saved" }] }, { saved: restored }), bytes);
console.log("PASS typed DB writer provenance, Type JSON roundtrip, replacement, JSON null");
