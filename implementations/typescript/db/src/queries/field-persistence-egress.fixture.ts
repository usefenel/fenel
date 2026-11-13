// @ts-nocheck -- Isolated Drizzle-builder harness; no production DB is opened.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { entityInstances } from "../schema/entity-instances";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const fieldId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const field = { id: fieldId, currentCodeName: "payload", status: "live",
  realm: "account", reuseVisibility: "account" };
const nested = Object.create(null);
nested.keep = 7;
const protoValue = { retained: true };
const carrier = Object.create(null);
Object.defineProperties(carrier, {
  currentCodeName: { value: "payload", enumerable: true },
  nested: { value: nested, enumerable: true },
});
// Object-literal __proto__ is syntax; define this own data descriptor explicitly.
Object.defineProperty(carrier, "__proto__", { value: protoValue, enumerable: true });

let existing = false;
let boundData;
const writes = [];
const builder = drizzle(async (sql, params) => {
  if (sql.startsWith("select ")) return { rows: existing ? [[fieldId, accountId, "Field"]] : [] };
  writes.push({ sql, params });
  return { rows: [] };
});
const connection = {
  select: builder.select.bind(builder),
  insert: table => ({ values: values => {
    boundData = values.data;
    return builder.insert(table).values(values);
  } }),
  update: table => ({ set: values => {
    boundData = values.data;
    return builder.update(table).set(values);
  } }),
  execute: async () => [{ physicalRowTexts: [] }],
  transaction: async operation => operation(connection),
};
mock.module("../client", () => ({ getDb: () => connection }));
const actualAuthoring = await import("@fenel/engine/field-authoring");
mock.module("@fenel/engine/field-authoring", () => ({ ...actualAuthoring,
  durableFieldToStorageData: () => carrier,
}));
const { executeFieldDefinitionPersistencePlan } = await import("./field-definition-bundles");
const plan = { ownerUpserts: [], ownerDeletes: [], fieldUpserts: [field],
  fieldTombstones: [], facetUpserts: [], facetDeletes: [], retainedFacets: [],
  snapshot: { owners: [], fields: [], facets: [] } };

// Control: both real builders reject the original null-prototype column value.
assert.throws(() => builder.insert(entityInstances).values({ id: fieldId, accountId,
  entityType: "Field", data: carrier }), TypeError);
assert.throws(() => builder.update(entityInstances).set({ data: carrier }), TypeError);

for (const update of [false, true]) {
  existing = update;
  await executeFieldDefinitionPersistencePlan(accountId, plan);
  assert.equal(Object.getPrototypeOf(boundData), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(boundData, "__proto__").value, protoValue);
  assert.equal(boundData.nested, nested, "terminal conversion is shallow");
  assert.equal(Object.getPrototypeOf(carrier), null, "internal carrier remains null-prototype");
  assert.equal(Object.getPrototypeOf(nested), null);
  assert.equal(boundData.retained, undefined, "own __proto__ never changes the prototype");
  const written = writes.at(-1);
  assert.match(written.sql, update ? /^update "entity_instances"/ : /^insert into "entity_instances"/);
  const json = written.params.find(value => typeof value === "string" && value.startsWith("{"));
  const landed = JSON.parse(json);
  assert.deepEqual(Object.getOwnPropertyDescriptor(landed, "__proto__").value, protoValue);
  assert.deepEqual(landed.nested, { keep: 7 });
  assert.equal(landed.currentCodeName, "payload");
}
console.log("PASS production Field insert/update Drizzle binding preserves own data");
