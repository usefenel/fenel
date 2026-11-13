import { mock } from "bun:test";
import assert from "node:assert/strict";
import type { FenelType, TypeConstructorParam, TypeScheme } from "@fenel/engine/types";

let stored: any;
let written: any;
const timestamp = new Date("2026-09-08T00:00:00Z");
const persist = (value: any) => {
  written = value;
  stored = { id: "stored-type", createdAt: timestamp, ...stored, ...value,
    type: value.type === undefined ? stored?.type ?? null : JSON.parse(JSON.stringify(value.type)),
  };
  return [stored];
};
const database = {
  select: () => ({ from: () => ({ where: () => ({
    limit: async () => stored ? [stored] : [],
    then: (resolve: (value: any[]) => void) => Promise.resolve(stored ? [stored] : []).then(resolve),
  }) }) }),
  insert: () => ({ values: (value: any) => ({ returning: async () => persist(value) }) }),
  update: () => ({ set: (value: any) => ({ where: () => ({ returning: async () => persist(value) }) }) }),
};
mock.module("../client", () => ({ getDb: () => database }));
const { upsertType, getType, getTypeById, listTypes } = await import("./types");
const type: FenelType = { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } } } };
const created = await upsertType("account", { name: "TransportType", type, isSystem: true });
assert.equal(written.type.$refined.set.pattern.max, "unbounded");
assert.deepEqual(created.type, type);
assert.equal(created.createdAt, timestamp, "only JSON type slots are projected, not host timestamps");
assert.deepEqual((await getType("account", "TransportType"))!.type, type);
assert.deepEqual((await getTypeById("account", "stored-type"))!.type, type);
assert.deepEqual((await listTypes("account"))[0]!.type, type);
await upsertType("account", { name: "TransportType", defaultTemplate: "table" });
assert.equal(written.type.$refined.set.pattern.max, "unbounded");
assert.equal((await getType("account", "TransportType"))!.defaultTemplate, "table");
const declaration: { params: TypeConstructorParam[]; typeScheme: TypeScheme } = {
  params: [{ name: "a", constraints: [] }],
  typeScheme: {
    quantified: [{ id: "stable-binder", sourceName: "a", kind: { $tag: "KType" } }],
    body: type,
    applications: [{ path: [], headRef: "stable-constructor", args: [type], kind: { $tag: "KType" } }],
    nominals: [{ path: [], identity: "stable-type", publicName: "TransportType" }],
    diagnostics: [],
  },
};
const { typeDefinitionToJsonWire } = await import("@fenel/engine/authoring/expression");
stored.declaration = JSON.parse(JSON.stringify(typeDefinitionToJsonWire(declaration)));
for (const row of [await getType("account", "TransportType"), await getTypeById("account", "stored-type"), (await listTypes("account"))[0]]) {
  assert.deepEqual(row!.declaration, declaration);
  assert.deepEqual(row!.params, declaration.params);
  assert.deepEqual(row!.typeScheme, declaration.typeScheme);
}
await upsertType("account", { name: "TransportType", defaultTemplate: "form" });
assert.deepEqual((await getType("account", "TransportType"))!.declaration, declaration,
  "legacy presentation update preserves the bundle-owned declaration");
stored.declaration = null;
assert.equal((await getType("account", "TransportType"))!.typeScheme, undefined);
console.log("PASS type query JSON persistence, canonical read and timestamp preservation");
