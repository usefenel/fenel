import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "../fenel-parser";
import { invokeCallable, type EvaluateContext } from "../json-logic";
import type { Expression, FenelFunction, FieldDef } from "../types";
import { stdNatives, stdNativesCtx } from "../../../../../fenel/modules/std/ffi/std-ffi";
import { wrapJsonValue } from "../../../../../fenel/modules/codec/ffi/codec-ffi";

// Execute the production Fenel bodies with their real list/codec leaves. This
// fixture checks containment semantics without constructing a repository
// registry or depending on newly generated signature/field identities.
type ParsedDefinition = { name: string; params: string[]; body: Expression };
const functions = new Map<string, FenelFunction>();
const ctx: EvaluateContext = {
  getFunction: (name) => functions.get(name),
  natives: stdNatives,
  nativesCtx: stdNativesCtx,
  _constructors: { Just: ["_0"], Nothing: [] },
};

function loadBodies(relativePath: string, namespace: string, select = (_name: string) => true) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const parsed = parse(source) as { program: Array<{ def?: ParsedDefinition }> };
  for (const statement of parsed.program) {
    const definition = statement.def;
    if (!definition || !select(definition.name)) continue;
    const fn: FenelFunction = {
      id: `${namespace}:${definition.name}`,
      params: definition.params.map((name): FieldDef => ({
        name,
        type: { $record: { fields: [] } },
        label: { $tag: "Nothing" },
        ui: { $tag: "Nothing" },
        meta: {},
      })),
      returns: { $record: { fields: [] } },
      body: definition.body,
    };
    functions.set(definition.name, fn);
    functions.set(fn.id, fn);
  }
}

beforeAll(() => {
  loadBodies("../../../../../fenel/modules/storage/queries.fenel", "storage");
  loadBodies("../../../../../fenel/modules/codec/codec.fenel", "codec", (name) => name === "findPair");
  expect(functions.get("storage:jsonContains")?.body).toBeDefined();
  expect(functions.get("codec:findPair")?.body).toBeDefined();
});

const containsJson = (actual: unknown, expected: unknown): unknown =>
  invokeCallable("storage:jsonContains", [wrapJsonValue(actual), wrapJsonValue(expected)], ctx);

// Expected values come from PostgreSQL's documented @> relation, independently
// of the Fenel implementation:
// https://www.postgresql.org/docs/18/datatype-json.html#JSON-CONTAINMENT
// The nested scalar/container distinction is explicit in JsonbDeepContains:
// https://doxygen.postgresql.org/jsonb__util_8c.html
// Object values compare their scalar/container kind first; array scalar items
// search only immediate scalar members, and nested containers recurse together.
const cases: Array<[string, unknown, unknown, boolean]> = [
  ["identical scalar", "foo", "foo", true],
  ["different scalar", "foo", "bar", false],
  ["array subset", [1, 2, 3], [1, 3], true],
  ["array order is irrelevant", [1, 2, 3], [3, 1], true],
  ["duplicate expected members do not consume separate values", [1], [1, 1], true],
  ["object subset", { product: "PostgreSQL", version: 9.4, jsonb: true }, { version: 9.4 }, true],
  ["a nested array cannot supply a missing scalar at the outer level", [1, 2, [1, 3]], [1, 3], false],
  ["matching array nesting is contained", [1, 2, [1, 3]], [[1, 3]], true],
  ["object keys cannot move up a nesting level", { foo: { bar: "baz" } }, { bar: "baz" }, false],
  ["a nested empty object matches an object value", { foo: { bar: "baz" } }, { foo: {} }, true],
  ["root array contains an immediate primitive", ["foo", "bar"], "bar", true],
  ["root primitive does not contain an array", "bar", ["bar"], false],
  ["nested array cannot match an outer scalar array element", [[1, 2]], [1], false],
  ["nested array still contains a nested subarray", [[1, 2]], [[1]], true],
  ["root scalar exception does not search deeper arrays", [[1, 2]], 1, false],
  ["object array value cannot match a scalar value", { a: [1] }, { a: 1 }, false],
  ["object scalar value cannot match an array value", { a: 1 }, { a: [1] }, false],
  ["matching object array values retain subset semantics", { a: [1, 2] }, { a: [1] }, true],
  ["a single object member can satisfy separate contained object members", [{ a: 1, b: 2 }], [{ a: 1 }, { b: 2 }], true],
  ["separate stored objects cannot combine into one contained object", [{ a: 1 }, { b: 2 }], [{ a: 1, b: 2 }], false],
  ["array container is required around object members", [{ a: 1 }], { a: 1 }, false],
  ["empty expected array matches an array", [1, 2], [], true],
  ["empty expected object matches an object", { a: 1 }, {}, true],
  ["empty object does not match an array", [], {}, false],
  ["empty array does not match an object", {}, [], false],
  ["nested empty object does not match a scalar", { a: 1 }, { a: {} }, false],
  ["root array contains an immediate JSON null", [null], null, true],
  ["an empty root array contains no JSON null", [], null, false],
  ["missing object member differs from JSON null", {}, { a: null }, false],
  ["present JSON null matches", { a: null }, { a: null }, true],
  ["numeric and string scalars differ", 1, "1", false],
  ["boolean and numeric scalars differ", false, 0, false],
  ["nested null does not bypass an array layer", { a: [null] }, { a: null }, false],
];

describe("Memory storage containment follows PostgreSQL JSONB structure", () => {
  for (const [name, actual, expected, result] of cases) {
    test(name, () => {
      expect(containsJson(actual, expected)).toBe(result);
    });
  }
});
