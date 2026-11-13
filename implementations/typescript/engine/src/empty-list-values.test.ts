import { describe, expect, test } from "bun:test";
import { dispatchEngineBody, withInterpretedResolver } from "./engine-bodies-dispatch";
import { engineModule } from "./modules/engine";
import { parse } from "./fenel-parser";

// C1: inspect real Fenel results before boundary wrappers can replace a malformed
// non-array result with []. No production evaluator or list policy lives here.
const call = (name: string, args: unknown[]): unknown =>
  withInterpretedResolver(() => dispatchEngineBody(`engine:${name}`, args));
const nothing = { $tag: "Nothing" };
const just = (value: unknown) => ({ $tag: "Just", _0: value });

function patternBindings(pattern: unknown): string[] {
  if (Array.isArray(pattern)) return pattern.flatMap(patternBindings);
  if (pattern === null || typeof pattern !== "object") return [];
  const record = pattern as Record<string, unknown>;
  if (typeof record.$bind === "string") return [record.$bind];
  return Object.values(record).flatMap(patternBindings);
}

// The existing parsed IR carries bindings in function params, fn, sequential
// do/let, and match patterns. Count only value-position references; a predicate
// call head named emptyList is deliberately not a value-position reference.
function unboundEmptyListValues(node: unknown, bound = new Set<string>()): number {
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + unboundEmptyListValues(item, bound), 0);
  if (node === null || typeof node !== "object") return 0;
  const record = node as Record<string, unknown>;
  if (record.var === "emptyList") return bound.has("emptyList") ? 0 : 1;
  if (Array.isArray(record.fn)) {
    const params = record.fn.slice(0, -1).filter((item): item is string => typeof item === "string");
    return unboundEmptyListValues(record.fn.at(-1), new Set([...bound, ...params]));
  }
  if (Array.isArray(record.do)) {
    const scope = new Set(bound);
    let count = 0;
    for (const step of record.do) {
      if (step !== null && typeof step === "object" && !Array.isArray(step) && "let" in step) {
        const bindings = (step as { let: unknown }).let;
        const rows = Array.isArray(bindings) ? bindings : [bindings];
        for (const row of rows) {
          if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
          for (const [name, value] of Object.entries(row)) {
            count += unboundEmptyListValues(value, scope);
            scope.add(name);
          }
        }
      } else {
        count += unboundEmptyListValues(step, scope);
      }
    }
    return count;
  }
  if (Array.isArray(record.match)) {
    const [scrutinee, ...arms] = record.match;
    let count = unboundEmptyListValues(scrutinee, bound);
    for (let index = 0; index < arms.length; index += 2) {
      const pattern = arms[index];
      count += unboundEmptyListValues(arms[index + 1], new Set([...bound, ...patternBindings(pattern)]));
    }
    return count;
  }
  return Object.values(record).reduce<number>((sum, item) => sum + unboundEmptyListValues(item, bound), 0);
}

describe("empty list values in real engine bodies", () => {
  test("the corpus has no free emptyList predicate references used as list values", () => {
    const offenders = (engineModule.functions ?? []).flatMap(fn => {
      const count = unboundEmptyListValues(fn.body, new Set(fn.params.map(param => param.name)));
      return count === 0 ? [] : [{ id: fn.id, count }];
    });
    expect(offenders).toEqual([]);
  });

  test("the census respects lambda, sequential-let, and pattern shadowing", () => {
    expect(unboundEmptyListValues(parse("\\emptyList -> emptyList"))).toBe(0);
    expect(unboundEmptyListValues({ do: [{ let: { emptyList: [] } }, { var: "emptyList" }] })).toBe(0);
    expect(unboundEmptyListValues(parse("case xs of\n  Just emptyList -> emptyList\n  Nothing -> []"))).toBe(0);
    expect(unboundEmptyListValues({ do: [{ let: { other: { var: "emptyList" } } }, { var: "other" }] })).toBe(1);
    expect(unboundEmptyListValues(parse("emptyList xs"))).toBe(0);
  });

  test("absent entity, form, subfield, and variant fields are actual empty lists", () => {
    expect(call("entitySchemaFields", [{ $tag: "EsfNone" }])).toEqual([]);
    expect(call("formDefinitionFields", [{ $tag: "EsfNone" }])).toEqual([]);
    expect(call("subFieldDefs", [{ $tag: "SfdNone" }])).toEqual([]);
    expect(call("variantFieldDefs", [{ $tag: "VfdNone" }])).toEqual([]);
  });

  test("existing fields pass through and list/maybe subfields retain their real type", () => {
    const fields = [{ name: "amount", type: { $ref: "Number" }, auxiliary: "retained" }];
    expect(call("entitySchemaFields", [{ $tag: "EsfRecord", fields }])).toEqual(fields);
    for (const [shape, key, name, label] of [
      ["SfdList", "elemType", "item", "Item"],
      ["SfdMaybe", "valueType", "value", "Value"],
    ]) {
      expect(call("subFieldDefs", [{ $tag: shape, [key!]: { $ref: "Number" } }])).toEqual([
        { $tag: "FldField", name, label, type: { $ref: "Number" } },
      ]);
    }
  });

  test("valid scalar validators return actual empty error lists and retain coercions", () => {
    const cases: [string, unknown, unknown, unknown][] = [
      ["validateBoolean", { $tag: "VbsCoerceTrue" }, "true", true],
      ["validateNumber", { isSetExprValue: false, isNaN: false, numValue: 7, hasSet: false }, "7", 7],
      ["validateString", { isSetExprValue: false, hasSet: false, strValue: "7" }, 7, "7"],
      ["validateRef", { isValid: true, strValue: "reference" }, "reference", "reference"],
      ["validateDate", { isSetExprValue: false, isInvalidDate: false, hasSet: false, strValue: "2026-10-06" }, "2026-10-06", "2026-10-06"],
      ["validateMarkup", { notObject: false, badCase: false, subsetName: nothing }, { $tag: "Text", _0: "hello" }, { $tag: "Text", _0: "hello" }],
      ["validateLocaleString", { $tag: "VlsPlainStringOk" }, "hello", "hello"],
    ];
    for (const [name, schema, raw, value] of cases) {
      expect(call(name, [schema, raw, "field"])).toEqual({ $tag: "FieldResult", errors: [], value });
    }
  });

  test("invalid boolean input retains its value and returns one real error", () => {
    expect(call("validateBoolean", [{ $tag: "VbsInvalid" }, "maybe", "enabled"])).toEqual({
      $tag: "FieldResult",
      errors: [{ $tag: "FieldError", path: "enabled", message: "Must be a boolean" }],
      value: "maybe",
    });
  });

  test("every accepted SetExpr shape returns an actual empty error list", () => {
    for (const shape of ["SesEnumValid", "SesIntervalValid", "SesUnionValid", "SesIntersectValid", "SesDiffValid", "SesKnownNoCheck"]) {
      const value = { $tag: "SeAll" };
      expect(call("validateSetExprValue", [{ $tag: shape }, value, "set"])).toEqual({ $tag: "FieldResult", errors: [], value });
    }
  });

  test("empty list validation returns empty error and value accumulators", () => {
    expect(call("validateList", [{ notArray: false, itemResults: [] }, [], "items"])).toEqual({
      $tag: "FieldResult", errors: [], value: [],
    });
  });

  test("nonempty list validation preserves value and error encounter order", () => {
    const errors = [
      { $tag: "FieldError", path: "items.0", message: "first error" },
      { $tag: "FieldError", path: "items.1", message: "second error" },
    ];
    expect(call("validateList", [{ notArray: false, itemResults: errors.map((error, index) => ({ errors: [error], value: index + 1 })) }, [1, 2], "items"])).toEqual({
      $tag: "FieldResult", errors, value: [1, 2],
    });
  });

  test("unconstrained records and complete files have actual empty error lists", () => {
    const value = { url: "https://example.test/file", mimeType: "text/plain" };
    expect(call("validateRecord", [{ notObject: false, emptySchema: true }, value, "record"])).toEqual({ $tag: "FieldResult", errors: [], value });
    expect(call("validateFile", [{ notObject: false, missingUrl: false, missingMimeType: false }, value, "file"])).toEqual({ $tag: "FieldResult", errors: [], value });
  });

  test("enum, union, and intersection formatting preserve branch order", () => {
    expect(call("formatSetExpr", [{ $tag: "SeEnum", values: ["USD", "EUR"] }])).toBe('{"USD", "EUR"}');
    expect(call("setSyntaxFmtUnion", [[{ $tag: "SeAll" }, { $tag: "SeNone" }], "top"])).toBe("U ∪ ∅");
    expect(call("setSyntaxFmtIntersect", [[{ $tag: "SeAll" }, { $tag: "SeNone" }]])).toBe("U ∩ ∅");
  });

  test("validation labels and leaf hints retain their constraints", () => {
    expect(call("autoLabel", [{ $tag: "SeEnum", values: ["USD", "EUR"] }])).toBe("one of: USD, EUR");
    expect(call("autoLabelPathExt", ["png|jpg"])).toBe("extension in {.png, .jpg}");
    expect(call("autoLabelInterval", [{ lo: just({ value: 0, inclusive: true }), hi: just({ value: 5, inclusive: false }) }])).toBe("≥ 0 and < 5");
    const constraint = { id: "currency", label: "one of: USD, EUR", passed: true };
    expect(call("validateWithHints", [{ $tag: "VwhLeaf", constraint, cursorMaybe: nothing, fieldHintsListMaybe: nothing, suggestedNextMaybe: nothing, listHintMaybe: nothing }])).toEqual({
      valid: true, constraints: [constraint], cursor: nothing, fieldHints: nothing, suggestedNext: nothing, listHint: nothing,
    });
  });

  test("Wasm constructor closure domain lists remain single DomRef entries", () => {
    for (const ctor of ["Field", "Animate", "Wave"]) {
      expect(call("ctorClosureParamDomains", [ctor])).toEqual(just([{ $tag: "DomRef" }]));
    }
    expect(call("ctorClosureParamDomains", ["Just"])).toEqual(nothing);
  });

  test("the containment predicate and parameter-shadowed list arguments still work", () => {
    expect(call("emptyList", [[]])).toEqual(just(true));
    expect(call("emptyList", [[1]])).toEqual(just(false));
    expect(call("tupleSub", [false, [], [1]])).toEqual(just(false));
    expect(call("paramsSub", [false, [], []])).toEqual(just(true));
    expect(call("setAlgebraArrowParamsSub", [[], [1]])).toEqual(just(false));
    const sentinel = [{ $tag: "F64" }];
    expect(call("litStringFuncType", [sentinel])).toEqual({
      $tag: "WasmFuncType", params: [...sentinel, { $tag: "I32" }], results: [...sentinel, { $tag: "Externref" }],
    });
  });
});
