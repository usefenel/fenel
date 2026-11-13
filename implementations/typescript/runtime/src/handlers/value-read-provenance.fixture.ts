// @ts-nocheck -- Isolated production queries/FFI/state handlers; PostgreSQL is simulated.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { valueToJsonWire, valueFromJsonWire, VALUE_JSON_ENCODING } from "@fenel/engine/authoring/type";
import { evaluate } from "@fenel/engine/expressions";
import { Nothing, List } from "@fenel/engine/type-foundation";

const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreignAccount = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const instant = "2026-09-08T00:00:00.000Z";
const recordName = "ReadFixtureRecord";
const scalarName = "ReadFixtureBytes";
const field = (name, type, index) => ({ name, type, key: { $tag: "PositionalField", index }, label: Nothing, ui: Nothing, meta: {} });
const arrow = { $arrow: { params: [], returns: { $ref: "String" } } };
const recordType = { $record: { fields: [
  field("bytes", { $ref: "Bytes" }, 0),
  field("schema", { $type: true }, 1),
  field("callable", arrow, 2),
  field("business", { $record: { fields: [field("$fenelCheckpoint", List({ $ref: "String" }), 0)] } }, 3),
] } };
const typeValue = { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", min: 0, max: Infinity, child: { t: "eps" } } } } };
const businessMarker = { $fenelCheckpoint: ["number", "+infinity"] };
const nativeV1 = { bytes: Uint8Array.of(0, 255), schema: typeValue, callable: evaluate({ fn: [[], "ready"] }), business: businessMarker };
const nativeV2 = { ...nativeV1, callable: evaluate({ fn: [[], "ready"] }, { captured: { bytes: Uint8Array.of(3, 4), limit: Infinity, business: businessMarker } }) };
const legacyRecord = { bytes: [7, 8], schema: { $fenelCheckpoint: ["number", "+infinity"] }, callable: { $fenelUnion: { version: 1, branch: arrow, value: "raw" } }, business: businessMarker };
const expected = new Map();
const rows = [];
const codeables = [];
const json = (value) => JSON.parse(JSON.stringify(value));
function add(id, entityType, original, encoding, owner = account) {
  const schema = entityType === recordName ? recordType : { $ref: "Bytes" };
  const data = encoding === null ? json(original) : json(valueToJsonWire(schema, original, null, encoding));
  rows.push({ id, account_id: owner, entity_type: entityType, data, data_encoding: encoding, created_at: instant, updated_at: instant });
  codeables.push({ accountId: owner, target: id, codeName: id.replace("foreign-", "") });
  expected.set(id, original);
}
add("record-v1", recordName, nativeV1, "fenel-value-json-v1");
add("record-v2", recordName, nativeV2, VALUE_JSON_ENCODING);
add("record-legacy", recordName, legacyRecord, null);
add("scalar-v1", scalarName, Uint8Array.of(1, 2), "fenel-value-json-v1");
add("scalar-v2", scalarName, Uint8Array.of(5, 6), VALUE_JSON_ENCODING);
add("scalar-legacy", scalarName, businessMarker, null);
add("foreign-record-v2", recordName, nativeV2, VALUE_JSON_ENCODING, foreignAccount);

const sqlCalls = [];
const db = drizzle(async (sql, params) => {
  sqlCalls.push({ sql, params });
  assert.match(sql, /^select /i, "read fixture must never write");
  assert.match(sql, /"account_id" = \$\d+/, "production SQL remains account scoped");
  let selected = rows.filter((row) => row.account_id === account && params.includes(account));
  const entityType = params.find((value) => value === recordName || value === scalarName);
  if (entityType) selected = selected.filter((row) => row.entity_type === entityType);
  if (/inner join/i.test(sql)) {
    assert.match(sql, /"c"\."account_id" = \$\d+/);
    assert.match(sql, /->'methods'->>'codeName'/);
    const codeName = params.find((value) => codeables.some((facet) => facet.codeName === value));
    const targets = codeables.filter((facet) => facet.accountId === account && facet.codeName === codeName).map((facet) => facet.target);
    selected = selected.filter((row) => targets.includes(row.id));
  } else {
    const id = params.find((value) => rows.some((row) => row.id === value));
    if (id) selected = selected.filter((row) => row.id === id);
  }
  const expressions = sql.match(/^select ([\s\S]*?) from /i)[1].split(/,\s*/);
  return { rows: selected.map((row) => expressions.map((expression) => {
    const names = [...expression.matchAll(/"([^"]+)"/g)];
    return row[names.at(-1)[1]] ?? null;
  })) };
});
mock.module("../../../db/src/client", () => ({ getDb: () => db, closeDb: async () => {} }));
const queries = await import("../../../db/src/queries/entity-instances");
const dbExports = {
  ...queries,
  getType: async () => null, getTypeById: async () => null,
  appendEvent: async () => { throw new Error("Unexpected write"); },
};
mock.module("../../../db/src/index", () => dbExports);
const { storageNatives } = await import("../../../../../fenel/modules/storage/ffi/storage-ffi");
const maybe = (value) => value === undefined ? Nothing : { $tag: "Just", _0: value };
const storageCalls = [];
// Backend choice is the only simulated runtime seam. The canonical FFI Maybe
// adapters, host leaves, and actual Drizzle query builders below are unchanged.
mock.module("./storage-backends", () => ({
  mintUuid: () => { throw new Error("Unexpected write"); },
  performStorageMethod: async (_registry, _ctx, method, args) => {
    storageCalls.push(method);
    if (method === "list") return storageNatives["storage:dbList"](args[0], args[1], maybe(args[2]), maybe(args[3]));
    if (method === "load") {
      const value = await storageNatives["storage:dbLoad"](...args);
      return value.$tag === "Just" ? value._0 : null;
    }
    throw new Error(`Unexpected storage method ${method}`);
  },
}));
const { registerStateHandlers } = await import("./state");
const handlers = new Map();
const entities = new Map([[recordName, { id: recordName, type: recordType }], [scalarName, { id: scalarName, type: { $ref: "Bytes" } }]]);
const registry = {
  registerIOHandler: (name, handler) => handlers.set(name, handler),
  getEntity: (name) => entities.get(name),
  getIdentifiedEntity: (name) => entities.get(name),
};
registerStateHandlers(registry, { getAccountFieldRegistry: async () => registry });
const ctx = { accountId: account };
const call = async (name, params) => (await handlers.get(`state.${name}`)(params, ctx)).value;

for (const entityType of [recordName, scalarName]) {
  const raw = await storageNatives["storage:dbList"](account, entityType, maybe(1000), Nothing);
  assert.equal(raw.length, 3);
  for (const row of raw) {
    const physical = rows.find((candidate) => candidate.id === row.id);
    assert.deepEqual(row.data, physical.data, "storage FFI must not decode value payloads");
    assert.equal(row.dataEncoding, physical.data_encoding);
    const byName = await queries.findEntityInstancesByCodeName(account, row.id, entityType);
    assert.equal(byName.length, 1);
    assert.equal(byName[0].dataEncoding, row.dataEncoding, "named SELECT must retain exact physical provenance");
    assert.deepEqual(byName[0].data, row.data);
    for (const name of ["get_instance_by_name", "resolve_instance_by_name"]) {
      const result = await call(name, { codeName: row.id, entityType });
      const named = result.$tag === "Just" ? result._0 : result.value;
      assert.deepEqual(named, byName[0], "name lookup matches raw by-ID envelope convention");
      const decoded = named.dataEncoding === null ? named.data : valueFromJsonWire(entityType === recordName ? recordType : { $ref: "Bytes" }, named.data, registry, named.dataEncoding);
      assert.deepEqual(decoded, expected.get(row.id), "the retained flag enables exactly one typed decode");
    }
    const loaded = await call("get_instance", { typeId: entityType, instanceId: row.id });
    assert.deepEqual(loaded._0, entityType === recordName ? { id: row.id, ...expected.get(row.id) } : expected.get(row.id));
  }
  const envelope = await call("list_instances_by_name", { typeName: entityType, envelope: true });
  assert.deepEqual(envelope, raw, "HTTP envelope mode retains raw payload and physical flag");
  for (const name of ["list_instances", "list_instances_by_name"]) {
    const languageRows = await call(name, { typeId: entityType, typeName: entityType });
    assert.equal(languageRows.length, 3);
    for (const row of languageRows) {
      assert.equal(Object.hasOwn(row, "dataEncoding"), false, "decoded language data must not advertise a wire encoding");
      if (entityType === recordName) {
        const { id, accountId, createdAt, updatedAt, ...value } = row;
        assert.equal(accountId, account);
        assert(createdAt instanceof Date && updatedAt instanceof Date);
        assert.deepEqual(value, expected.get(id), `${name} decodes only flagged record data`);
      } else assert.deepEqual(row.data, expected.get(row.id), `${name} preserves native scalar data and legacy markers`);
    }
  }
}
assert(sqlCalls.some(({ sql }) => /inner join/i.test(sql) && /"entity_instances"\."data_encoding"/.test(sql)));
assert(storageCalls.includes("list") && storageCalls.includes("load"));
console.log("PASS value read provenance: real SQL, storage FFI, named rows, decoded lists, and raw HTTP envelopes");
