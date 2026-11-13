// C1 regression harness for LA-15: authored field names stay own data properties
// through the sanctioned parser mirror, loader scope walk and authoring codec.
import { describe, expect, test } from "bun:test";
import { parse } from "./fenel-parser";
import { loadFenelModule, resolveLocalCallHeads } from "./fenel-module";
import { dispatchEngineBody, marshalPatterns } from "./engine-bodies-dispatch";
import { evaluate, matchPattern } from "./json-logic";
import { exprNodeToLogic, logicToExprNode } from "./authoring/expression-authoring";

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function ownField(value: unknown, name: string, expected: unknown): void {
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.getOwnPropertyDescriptor(value, name)).toEqual({
    value: expected, enumerable: true, configurable: true, writable: true,
  });
}

function fields(value: unknown, payload: unknown): void {
  ownField(value, "__proto__", payload);
  ownField(value, "constructor", 3);
  ownField(value, "toString", 4);
}

const roundtrip = (value: unknown): unknown =>
  exprNodeToLogic(logicToExprNode(value), { fnCodeName: (id) => id });

describe("authored source field properties", () => {
  test("repeated authored field names retain the last value", () => {
    ownField(parse("{ __proto__ = 1, __proto__ = 2, kept = 3 }"), "__proto__", 2);
    const where = record(parse("x where __proto__ = 1, __proto__ = 2, kept = 3")).where as unknown[];
    ownField(where[1], "__proto__", 2);
  });

  for (const sample of [
    { source: "1", value: 1 },
    { source: "{ deep = 1 }", value: { deep: 1 } },
  ]) {
    const body = `{ __proto__ = ${sample.source}, constructor = 3, toString = 4 }`;

    test(`top-level, nested and constructor records preserve ${sample.source}`, () => {
      const top = parse(body);
      const nested = record(parse(`{ nested = ${body}, kept = 2 }`)).nested;
      const constructed = record(parse(`Box ${body}`)).construct as unknown[];
      for (const value of [top, nested, constructed[1]]) fields(value, sample.value);
      expect(constructed[0]).toBe("Box");
      if (typeof sample.value === "object") {
        expect(Object.getPrototypeOf(record(top)["__proto__"])).toBe(Object.prototype);
      }
    });

    test(`where bindings preserve ${sample.source}`, () => {
      const parsed = record(parse(`x where __proto__ = ${sample.source}, constructor = 3, toString = 4`));
      fields((parsed.where as unknown[])[1], sample.value);
    });
  }

  test("the canonical Fenel record owner agrees with the parser mirror", () => {
    const syntax = {
      $tag: "SRecord",
      fields: [
        { name: "__proto__", value: { $tag: "SLit", value: { deep: 1 } } },
        { name: "constructor", value: { $tag: "SLit", value: 3 } },
        { name: "toString", value: { $tag: "SLit", value: 4 } },
      ],
    };
    const canonical = dispatchEngineBody("engine:syntaxToJsonLogic", [syntax]);
    fields(canonical, { deep: 1 });
    expect(canonical).toEqual(parse("{ __proto__ = { deep = 1 }, constructor = 3, toString = 4 }"));
  });
});

describe("scope rewrites preserve authored field properties", () => {
  test("plain record copies retain own fields while rewriting local call heads", () => {
    const parsed = parse("{ __proto__ = f 1, constructor = f 3, toString = f 4 }");
    const rewritten = resolveLocalCallHeads(parsed, ["f"]);
    ownField(rewritten, "__proto__", { call: [{ var: "f" }, 1] });
    ownField(rewritten, "constructor", { call: [{ var: "f" }, 3] });
    ownField(rewritten, "toString", { call: [{ var: "f" }, 4] });
    expect(record(parsed)["__proto__"]).toEqual({ call: ["f", 1] });
  });

  test("let copies retain the binder and later calls use its local binding", () => {
    const rewritten = record(resolveLocalCallHeads(parse(
      "do\n  let __proto__ = f 1\n  __proto__ 2\nend",
    ), ["f"]));
    const statements = rewritten.do as unknown[];
    ownField(record(statements[0]).let, "__proto__", { call: [{ var: "f" }, 1] });
    expect(statements[1]).toEqual({ call: [{ var: "__proto__" }, 2] });
  });

  test("where copies retain own fields and mutual binder scope", () => {
    const rewritten = record(resolveLocalCallHeads(parse(
      "__proto__ 2 where __proto__ = f 1, constructor = f 3, toString = f 4, f = g",
    ), []));
    const [body, bindings] = rewritten.where as unknown[];
    expect(body).toEqual({ call: [{ var: "__proto__" }, 2] });
    ownField(bindings, "__proto__", { call: [{ var: "f" }, 1] });
    ownField(bindings, "constructor", { call: [{ var: "f" }, 3] });
    ownField(bindings, "toString", { call: [{ var: "f" }, 4] });
  });

  for (const source of [
    "{ __proto__ = f 1, constructor = 3, toString = 4 }",
    "Box { __proto__ = { deep = f 1 }, constructor = 3, toString = 4 }",
    "__proto__ 2 where __proto__ = f 1, constructor = 3, toString = 4",
    "do\n  let __proto__ = f 1\n  __proto__ 2\nend",
    "case x of\n  Box { __proto__ = f, constructor = 3, toString = 4 } -> f 1\n  _ -> 0",
  ]) {
    test(`source, scope and ExprNode preserve JSON: ${source}`, () => {
      const rewritten = resolveLocalCallHeads(parse(source), ["f"]);
      const restored = roundtrip(rewritten);
      expect(restored).toEqual(rewritten);
      expect(JSON.stringify(restored)).toBe(JSON.stringify(rewritten));
      expect(JSON.stringify(restored)).toContain('"__proto__"');
    });
  }
});

describe("source pattern field properties", () => {
  const constrained = [
    { source: "Box { __proto__ = 1, constructor = 3, toString = 4 }", tagged: true, nested: false },
    { source: "Outer Inner { __proto__ = 1, constructor = 3, toString = 4 }", tagged: true, nested: true },
    { source: "{ __proto__ = 1, constructor = 3, toString = 4 }", tagged: false, nested: false },
  ];

  for (const sample of constrained) {
    test(`${sample.source} keeps its constraint and rejects a different own value`, () => {
      const logic = record(parse(`case x of\n  ${sample.source} -> 1\n  _ -> 0`));
      const pattern = (logic.match as unknown[])[1];
      fields(sample.nested ? record(pattern)._0 : pattern, 1);
      const value = (payload: number): unknown => {
        const row = Object.fromEntries([
          ["__proto__", payload], ["constructor", 3], ["toString", 4],
          ...(sample.tagged ? [["$tag", sample.nested ? "Inner" : "Box"]] : []),
        ]);
        return sample.nested ? { $tag: "Outer", _0: row } : row;
      };
      for (const candidate of [logic, roundtrip(logic)]) {
        const candidatePattern = (record(candidate).match as unknown[])[1];
        expect(matchPattern(value(1), candidatePattern)).not.toBeNull();
        expect(matchPattern(value(2), candidatePattern)).toBeNull();
      }
    });
  }

  for (const source of [
    "Box { __proto__, constructor, toString }",
    "Outer Inner { __proto__, constructor, toString }",
  ]) {
    test(`shorthand ${source} binds the authored own field`, () => {
      const nested = source.startsWith("Outer");
      const logic = record(parse(`case x of\n  ${source} -> __proto__`));
      const pattern = (logic.match as unknown[])[1];
      const rowPattern = nested ? record(pattern)._0 : pattern;
      ownField(rowPattern, "__proto__", { $bind: "__proto__" });
      ownField(rowPattern, "constructor", { $bind: "constructor" });
      ownField(rowPattern, "toString", { $bind: "toString" });
      const row = Object.fromEntries([
        ["$tag", nested ? "Inner" : "Box"], ["__proto__", 7],
        ["constructor", 3], ["toString", 4],
      ]);
      const bindings = matchPattern(nested ? { $tag: "Outer", _0: row } : row, pattern);
      expect(bindings).not.toBeNull();
      expect(Object.getOwnPropertyDescriptor(bindings, "__proto__")?.value).toBe(7);
      expect(Object.prototype.hasOwnProperty.call(bindings, "constructor")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(bindings, "toString")).toBe(true);
    });
  }

  test("canonical named-pattern marshalling agrees with parsed constraints", () => {
    const canonical = marshalPatterns({
      $tag: "PatConstruct", ctor: "Box", fields: ["__proto__", "constructor", "toString"],
      args: [1, 3, 4].map((value) => ({ $tag: "PatLit", value })),
    });
    const parsed = record(parse("case x of\n  Box { __proto__ = 1, constructor = 3, toString = 4 } -> 1"));
    fields(canonical, 1);
    expect(canonical).toEqual((parsed.match as unknown[])[1]);
  });
});

describe("loaded declaration field properties", () => {
  test("typed instance methods and nested constructor data retain authored own fields", () => {
    const loaded = loadFenelModule(
      "probe : Box\nprobe = Box { __proto__ = 1, constructor = Pair { __proto__ = 2, kept = 3 }, toString = 4 }",
      "SourceFieldProbe",
    );
    const instance = loaded.instances?.find((row) => row.typeName === "Box");
    expect(instance).toBeDefined();
    const methods = instance!.methods;
    ownField(methods, "__proto__", 1);
    ownField(methods, "toString", 4);
    const nested = record(methods)["constructor"];
    ownField(nested, "__proto__", 2);
    expect(record(nested).$tag).toBe("Pair");
    expect(record(nested).kept).toBe(3);
  });

  test("instance declaration snapshots preserve own fields in frozen private copies", () => {
    const loaded = loadFenelModule(
      "probe : Box\nprobe = Box { __proto__ = 1, constructor = Pair { __proto__ = 2, kept = 3 } }",
      "SourceFieldProbe",
      { dispatchInstanceFile: true },
    );
    const instance = loaded.instances?.find((row) => row.typeName === "Box");
    const authored = instance?.declaration?.value;
    expect(authored).toBeDefined();
    expect(Object.getPrototypeOf(authored)).toBe(Object.prototype);
    expect(Object.isFrozen(authored)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(authored, "__proto__")).toEqual({
      value: 1, enumerable: true, configurable: false, writable: false,
    });
    const nested = record(authored)["constructor"];
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(nested, "__proto__")).toEqual({
      value: 2, enumerable: true, configurable: false, writable: false,
    });
    expect(nested).not.toBe(record(instance!.methods)["constructor"]);
  });

  test("declared method defaults retain authored own fields", () => {
    const loaded = loadFenelModule(
      "Defaults = Defaults __proto__: Number = 1 constructor: Number = 3 toString: Number = 4",
      "SourceFieldProbe",
    );
    fields(loaded.methodDefaults?.Defaults, 1);
  });

  test("single-field records cannot inherit internal builtin call routes", () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      const source = Object.fromEntries([[name, { var: "selected" }]]);
      const result = evaluate(source, { selected: "Ada" }, {});
      ownField(result, name, "Ada");
      expect(Object.keys(record(result))).toEqual([name]);
    }
  });

  test("prototype-spelled nested source fields evaluate as data", () => {
    const source = parse("{ __proto__ = { constructor = selected }, kept = 2 }");
    const result = record(evaluate(source, { selected: "Ada" }, {}));
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    ownField(result["__proto__"], "constructor", "Ada");
    expect(result.kept).toBe(2);
  });

  test("explicit registry and native functions retain prototype-spelled names", () => {
    const module = loadFenelModule("constructor value = value", "SourceFieldProbe");
    const fn = module.functions!.find(candidate => candidate.id === "SourceFieldProbe:constructor")!;
    expect(fn).toBeDefined();
    expect(evaluate({ constructor: [41] }, {}, {
      getFunction: name => name === "constructor" ? fn : undefined,
    })).toBe(41);
    const natives = Object.assign(Object.create(null), { constructor: (value: unknown) => value });
    expect(evaluate({ call: ["constructor", 42] }, {}, { natives })).toBe(42);
  });

  test("own builtin routes retain both ordinary and legacy call forms", () => {
    expect(evaluate({ call: ["add", 20, 22] }, {}, {})).toBe(42);
    expect(evaluate({ add: [20, 22] }, {}, {})).toBe(42);
    expect(evaluate({ "+": [20, 22] }, {}, {})).toBe(42);
  });
});
