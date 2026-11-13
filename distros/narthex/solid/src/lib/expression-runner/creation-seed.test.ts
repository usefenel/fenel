import { describe, expect, test } from "bun:test";
import { createAuthoringEnvironment, type AuthoringCatalogFunctionEntry } from "@fenel/engine/authoring/environment";
import { exprNodeToLogic } from "@fenel/engine/authoring/expression";
import { evaluate } from "@fenel/engine/expressions";
import { List, Maybe, Nothing } from "@fenel/engine/type-foundation";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { constructorExpression, expressionForLiteralValue, expectedTypeForName, seedExpressionForType } from "./creation-seed";

const text: FenelType = { $ref: "String" };
const number: FenelType = { $ref: "Number" };
const natural: FenelType = { $ref: "Nat" };
const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const maybe = Maybe(text);
const color: FenelType = { $record: { fields: ["r", "g", "b", "a"].map((name) => field(name, natural)) } };
const image: FenelType = { $record: { fields: [field("width", natural), field("height", natural), field("pixels", List(color))] } };

function constructor(owner: string, name: string, params: FieldDef[], returns: FenelType): AuthoringCatalogFunctionEntry {
  return {
    id: name,
    targetId: `@ctor/test/${owner}/${name}`,
    codeName: name,
    label: name,
    description: "",
    kind: "constructor",
    parentEntity: owner,
    parentModule: "test",
    params,
    returns,
    scheme: { quantified: [], body: { $arrow: { params, returns } } },
    signatureOutcome: { $tag: "Solved" },
  };
}

function environment(extra: AuthoringCatalogFunctionEntry[] = []) {
  return createAuthoringEnvironment({
    types: [
      { id: "maybe", name: "Maybe", description: "", category: "type", entityId: "Maybe", type: maybe },
      { id: "image", name: "Image", description: "", category: "type", entityId: "Image", type: image },
    ],
    functions: [
      // Payload constructor comes first intentionally: the empty constructor is
      // the useful default regardless of catalog presentation order.
      constructor("Maybe", "Just", [field("_0", text)], maybe),
      constructor("Maybe", "Nothing", [], maybe),
      ...extra,
    ],
    capabilities: [],
    catalogTypes: [maybe, image],
    operatorCodeNameByNotation: new Map(),
  });
}

describe("expression creation defaults", () => {
  test("refined tagged records use captured constructor metadata while their callable rows remain Functions", () => {
    const country: FenelType = { $ref: "ShippingCountry" };
    const params = [field("country", country), field("quantity", number)];
    const draft: FenelType = { $record: { fields: params } };
    const countries: FenelType = { $variant: { cases: [
      { name: "HomeCountry", label: Nothing }, { name: "OtherCountry", label: Nothing },
    ] } };
    const metadata = [
      { ...constructor("OrderDraft", "OrderDraft", params, { $ref: "OrderDraft" }),
        functionId: "934f9f39-44a1-4ce8-9a3c-bb812c85d013" },
      { ...constructor("ShippingCountry", "HomeCountry", [], country),
        functionId: "e73e9e48-19ab-49aa-8e80-bf924d584ab5" },
      { ...constructor("ShippingCountry", "OtherCountry", [], country),
        functionId: "c1bb266a-df68-42da-b10a-34b57939ee11" },
    ].map((entry) => ({ ...entry, codeName: undefined, label: "A label is not a constructor tag" }));
    const functions: AuthoringCatalogFunctionEntry[] = metadata.map((entry) => ({
      id: entry.functionId, targetId: entry.functionId,
      kind: "function", label: "A presentation label cannot select this constructor", description: "",
      params: entry.params, returns: entry.returns,
      scheme: entry.scheme, signatureOutcome: entry.signatureOutcome,
      constructorTarget: entry.targetId,
    }));
    const snapshot = {
      types: [
        { id: "checked-order", entityId: "CheckedOrder", name: "Checked order label", description: "", category: "type",
          type: { $refined: { base: { $ref: "OrderDraft" }, set: { $tag: "SeAll" } } } as FenelType },
        { id: "order-draft", entityId: "OrderDraft", name: "Order label", description: "", category: "type", type: draft },
        { id: "shipping-country", entityId: "ShippingCountry", name: "Country label", description: "", category: "type", type: countries },
      ],
      functions, patternConstructors: metadata,
      capabilities: [], catalogTypes: [draft, countries], operatorCodeNameByNotation: new Map<string, string>(),
    };
    const env = createAuthoringEnvironment(snapshot);
    const input: FenelType = { $ref: "CheckedOrder" };
    const value = Object.freeze({ $tag: "OrderDraft", country: Object.freeze({ $tag: "OtherCountry" }), quantity: 2 });
    const node = expressionForLiteralValue(value, input, env);
    const logic = exprNodeToLogic(node, { constructorName: (id) => env.constructorCodeName(id) });
    expect(logic).toEqual({ construct: [metadata[0]!.targetId, {
      country: { construct: [metadata[2]!.targetId] }, quantity: 2,
    }] });
    expect(evaluate(logic, {}, {
      _constructorWireNames: Object.fromEntries(metadata.map((entry) => [entry.targetId!, entry.id])),
      _constructors: Object.fromEntries(metadata.map((entry) => [entry.targetId!, entry.params.map((param) => param.name)])),
    })).toEqual(value);
    expect(seedExpressionForType(input, env)).toMatchObject({
      kind: "literal", value: { __construct: { tag: metadata[0]!.targetId } },
    });
    expect(env.catalog.functions.every((entry) => entry.kind === "function")).toBe(true);
    expect(value).toEqual({ $tag: "OrderDraft", country: { $tag: "OtherCountry" }, quantity: 2 });

    const extra = { ...value, extra: "keep this unsupported field" };
    expect(expressionForLiteralValue(extra, input, env)).toEqual({ kind: "literal", value: extra });
    for (const changedFunctions of [
      functions.slice(1),
      [{ ...functions[0]!, constructorTarget: "@ctor/another/OrderDraft/OrderDraft" }, ...functions.slice(1)],
      [{ ...functions[0]!, signatureOutcome: { $tag: "AnnotationRequired", diagnostics: [] } as const }, ...functions.slice(1)],
    ]) {
      const refused = createAuthoringEnvironment({ ...snapshot, functions: changedFunctions });
      expect(expressionForLiteralValue(value, input, refused)).toEqual({ kind: "literal", value });
      expect(seedExpressionForType(input, refused)).toEqual({ kind: "literal", value: undefined });
    }
  });

  test("Maybe uses its exact empty constructor rather than an inline null", () => {
    const env = environment();
    const node = seedExpressionForType(expectedTypeForName("Maybe", env), env, "Maybe");
    expect(node).toEqual({ kind: "call", fnId: "@ctor/test/Maybe/Nothing", args: [] });
    expect(exprNodeToLogic(node, { constructorName: (id) => env.constructorCodeName(id) })).toEqual({ construct: ["@ctor/test/Maybe/Nothing"] });
  }, 30_000);

  test("Maybe arguments receive the same constructor default without a display name", () => {
    const env = environment();
    expect(seedExpressionForType(Maybe(number), env)).toEqual({ kind: "call", fnId: "@ctor/test/Maybe/Nothing", args: [] });
  });

  test("Image starts as a real empty pixel matrix and each seed is independent", () => {
    const env = environment();
    const first = seedExpressionForType(expectedTypeForName("Image", env), env, "Image");
    const second = seedExpressionForType(expectedTypeForName("Image", env), env, "Image");
    expect(first).toEqual({ kind: "literal", value: { width: 0, height: 0, pixels: [] } });
    if (first.kind !== "literal" || second.kind !== "literal") throw new Error("Expected image literals");
    expect(first.value).not.toBe(second.value);
  }, 30_000);

  test("String and Number initialize their concrete input widgets", () => {
    const env = environment();
    expect(seedExpressionForType(text, env)).toEqual({ kind: "literal", value: "" });
    expect(seedExpressionForType(number, env)).toEqual({ kind: "literal", value: 0 });
  });

  test("selected nominal types preserve their native value reference", () => {
    const env = createAuthoringEnvironment({
      types: [{ id: "string", name: "String", description: "", category: "type", entityId: "String", type: {
        $opaque: { name: "String", pure: List({ $ref: "Char" }) },
      } }],
      functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
    });
    expect(expectedTypeForName("String", env)).toEqual({ $ref: "String" });
    expect(seedExpressionForType(expectedTypeForName("String", env), env)).toEqual({ kind: "literal", value: "" });
  });

  test("constructor-only types and payloads use the same policy", () => {
    const wrapped: FenelType = { $ref: "Wrapped" };
    const env = environment([constructor("Wrapped", "Wrap", [field("text", text), field("maybe", Maybe(number))], wrapped)]);
    const node = seedExpressionForType(wrapped, env);
    expect(node).toEqual({
      kind: "literal", value: { __construct: { tag: "@ctor/test/Wrapped/Wrap", fields: [
        { name: "text", value: { kind: "literal", value: "" } },
        { name: "maybe", value: { kind: "call", fnId: "@ctor/test/Maybe/Nothing", args: [] } },
      ] } },
    });
    expect(evaluate(exprNodeToLogic(node, { constructorName: (id) => env.constructorCodeName(id) }), {}, {
      _constructorWireNames: Object.fromEntries(env.catalog.functions.map((entry) => [entry.targetId!, entry.label])),
      _constructors: Object.fromEntries(env.catalog.functions.map((entry) => [entry.targetId!, entry.params.map((param) => param.name)])),
    })).toEqual({ $tag: "Wrap", text: "", maybe: { $tag: "Nothing" } });
  });

  test("fenced signatures and unavailable types leave an explicit incomplete slot", () => {
    const fenced = constructor("Hidden", "Hidden", [], { $ref: "Hidden" });
    fenced.signatureOutcome = { $tag: "AnnotationRequired", diagnostics: [] };
    const env = environment([fenced]);
    for (const type of [undefined, { $ref: "Missing" }, { $ref: "Hidden" }] as const) {
      const seed = seedExpressionForType(type, env);
      expect(seed).toEqual({ kind: "literal", value: undefined });
      expect(seed).not.toEqual({ kind: "literal", value: null });
    }
  });

  test("function defaults seed their declared result inside a lambda", () => {
    const env = environment();
    const arrow: FenelType = { $arrow: { params: [field("input", text)], returns: Maybe(number) } };
    expect(seedExpressionForType(arrow, env)).toEqual({
      kind: "literal",
      value: { __lambda: { params: ["input"], body: { kind: "call", fnId: "@ctor/test/Maybe/Nothing", args: [] } } },
    });
  });

  test("existing nested Maybe and Boolean values round-trip through constructor expressions", () => {
    const boolean: FenelType = { $ref: "Boolean" };
    const env = environment([
      constructor("Boolean", "False", [], boolean),
      constructor("Boolean", "True", [], boolean),
    ]);
    const type: FenelType = { $record: { fields: [field("nested", Maybe(Maybe(number))), field("enabled", boolean)] } };
    const value = { nested: { $tag: "Just", _0: { $tag: "Nothing" } }, enabled: false };
    const node = expressionForLiteralValue(value, type, env);
    const logic = exprNodeToLogic(node, { constructorName: (id) => env.constructorCodeName(id) });
    expect(logic).toEqual({
      nested: { construct: ["@ctor/test/Maybe/Just", { construct: ["@ctor/test/Maybe/Nothing"] }] },
      enabled: { construct: ["@ctor/test/Boolean/False"] },
    });
    expect(evaluate(logic, {}, {
      _constructorWireNames: Object.fromEntries(env.catalog.functions.map((entry) => [entry.targetId!, entry.label])),
      _constructors: Object.fromEntries(env.catalog.functions.map((entry) => [entry.targetId!, entry.params.map((param) => param.name)])),
    })).toEqual(value);
  });

  test("named constructor inputs preserve field names, empty text and line breaks without calling matching functions", () => {
    for (const name of ["text", "reverse"]) {
      const input: FenelType = { $ref: "TextInput" };
      const target = "@ctor/test/TextInput/TextInput";
      const env = environment([constructor("TextInput", "TextInput", [field(name, text)], input)]);
      const context = {
        _constructorWireNames: { [target]: "TextInput" },
        _constructors: { [target]: [name] },
        natives: { [name]: () => { throw new Error("A named constructor field invoked a function"); } },
      };
      for (const content of ["", "id,amountCents\np1,1200\np2,800", '{"id":"p1","amountCents":"1200"}']) {
        const value = { $tag: "TextInput", [name]: content };
        const node = expressionForLiteralValue(value, input, env);
        const logic = exprNodeToLogic(node, { constructorName: (id) => env.constructorCodeName(id) });
        expect(logic).toEqual({ construct: [target, { [name]: content }] });
        expect(evaluate(logic, {}, context)).toEqual(value);
        expect(value[name]).toBe(content);
      }
      const seed = seedExpressionForType(input, env);
      expect(evaluate(exprNodeToLogic(seed, { constructorName: (id) => env.constructorCodeName(id) }), {}, context))
        .toEqual({ $tag: "TextInput", [name]: "" });
      const extra = { $tag: "TextInput", [name]: "preserved", extra: "unrecognized" };
      expect(expressionForLiteralValue(extra, input, env)).toEqual({ kind: "literal", value: extra });
    }
  });

  test("value projection retains unsupported tags and unexpected payload fields", () => {
    const env = environment();
    const values = [{ $tag: "Unknown", value: 1 }, { $tag: "Just", _0: "hello", extra: 42 }];
    for (const value of values) {
      const node = expressionForLiteralValue(value, maybe, env);
      expect(node.kind).toBe("literal");
      if (node.kind !== "literal") throw new Error("Expected literal preservation");
      expect(node.value).toBe(value);
    }
  });

  test("selected named constructors retain exact owners and evaluate the wrapped expression in its field", () => {
    const params = [field("text", text), field("enabled", { $ref: "Boolean" })];
    const first = constructor("Input", "Input", params, { $ref: "Input" });
    const second = { ...first, targetId: "@ctor/other/Input/Input", parentModule: "other" };
    const env = environment([first, second]);
    const wrapped = { kind: "param" as const, name: "sourceText" };
    for (const entry of [first, second]) {
      const node = constructorExpression(entry.targetId!, params, [wrapped, { kind: "literal", value: false }]);
      const logic = exprNodeToLogic(node, { constructorName: (id) => env.constructorCodeName(id) });
      expect(logic).toEqual({ construct: [entry.targetId, { text: { var: "sourceText" }, enabled: false }] });
      expect(evaluate(logic, { sourceText: "first\nsecond" }, {
        _constructorWireNames: { [entry.targetId!]: "Input" },
        _constructors: { [entry.targetId!]: ["text", "enabled"] },
        natives: { Input: () => { throw new Error("The selected constructor lost its owner"); } },
      })).toEqual({ $tag: "Input", text: "first\nsecond", enabled: false });
    }
  });

  test("selected positional and empty constructors preserve their existing payload forms", () => {
    const env = environment();
    for (const entry of env.catalog.functions) {
      const args = entry.params.map(() => ({ kind: "literal" as const, value: "payload" }));
      const node = constructorExpression(entry.targetId!, entry.params, args);
      const logic = exprNodeToLogic(node, { constructorName: (id) => env.constructorCodeName(id) });
      expect(node.kind).toBe("call");
      expect(evaluate(logic, {}, {
        _constructorWireNames: { [entry.targetId!]: entry.label },
        _constructors: { [entry.targetId!]: entry.params.map((param) => param.name) },
      })).toEqual(entry.params.length ? { $tag: "Just", _0: "payload" } : { $tag: "Nothing" });
    }
  });

  test("same display-name constructor owners do not seed an arbitrary module", () => {
    const first = constructor("Duplicate", "First", [], { $ref: "Duplicate" });
    const second = { ...constructor("Duplicate", "Second", [], { $ref: "Duplicate" }), parentModule: "other" };
    const env = environment([first, second]);
    expect(seedExpressionForType({ $ref: "Duplicate" }, env)).toEqual({ kind: "literal", value: undefined });
  });
});
