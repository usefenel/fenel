// Process-isolated storage boundary test: the real function query adapters and
// evaluator run; only the database IO leaf is replaced by JSON persistence.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import type { FenelFunction, FenelType } from "@fenel/engine/types";

let stored: any;
let written: any;
const database = {
  select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => stored ? [stored] : [] }) }) }) }),
  insert: () => ({ values: (value: any) => ({ returning: async () => {
    written = value;
    stored = JSON.parse(JSON.stringify({ id: "stored-function", version: 1, sourceRegistryId: null, active: true, ...value }));
    return [stored];
  } }) }),
  update: () => ({ set: (value: any) => ({ where: () => ({ returning: async () => {
    written = value; stored = JSON.parse(JSON.stringify({ ...stored, ...value })); return [stored];
  } }) }) }),
};
mock.module("../client", () => ({ getDb: () => database }));
const { upsertFunction, getFunction } = await import("./functions");
const { evaluate } = await import("@fenel/engine/expressions");
const refined: FenelType = { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } } } };
const original: FenelFunction = { id: "demo:patternType", params: [], returns: { $type: true }, body: { if: [true, refined, { $ref: "String" }] } };
const first = await upsertFunction("test-account", { name: original.id, function: original as unknown as Record<string, unknown> });
assert.equal(written.function.body.if[1].$refined.set.pattern.max, "unbounded");
assert.deepEqual(first.function, original);
const reopened = await getFunction("test-account", original.id);
assert.deepEqual(reopened!.function, original);
assert.deepEqual(evaluate(reopened!.function.body), refined);
await upsertFunction("test-account", { name: original.id, function: { ...original, body: refined } });
assert.equal(written.function.body.$refined.set.pattern.max, "unbounded");
assert.deepEqual((await getFunction("test-account", original.id))!.function.body, refined);
stored.sourceRegistryId = "immutable-source-version";
stored.function = { cache: "display only, never a function authority" };
assert.deepEqual((await getFunction("test-account", original.id))!.function, stored.function);
console.log("PASS function expression wire storage/read/execution and source-cache isolation");
