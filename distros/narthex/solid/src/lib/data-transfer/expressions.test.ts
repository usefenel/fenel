import { beforeAll, describe, expect, test } from "bun:test";
import { createAuthoringEnvironment, expectedSchemeForType, type AuthoringCatalogFunctionEntry } from "@fenel/engine/authoring/environment";
import { exprNodeToLogic, inferAuthoringExpression } from "@fenel/engine/authoring/expression";
import { evaluate, type EvaluateContext } from "@fenel/engine/expressions";
import { List, Maybe, Nothing } from "@fenel/engine/type-foundation";
import { validateValue } from "@fenel/engine/validation";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { adaptTransferToTarget, expressionForTransfer, inferTransferExpression, prepareTransferItem, scopedConcreteType, typeForTransfer } from "./expressions";
import { itemFromText } from "./data";
import { encodeTransferItem, decodeTransferItem } from "./index";
import { createDetachedAuthoringEnvironment } from "../expression-runner/detached-authoring-environment";
import type { TransferItem } from "./types";

const number: FenelType = { $ref: "Number" };
const string: FenelType = { $ref: "String" };
const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const constructors: AuthoringCatalogFunctionEntry[] = ["Nothing", "Just"].map((tag) => {
  const params = tag === "Just" ? [field("_0", number)] : [];
  return { id: tag, targetId: `@ctor/test/Maybe/${tag}`, codeName: tag, label: tag, description: "", kind: "constructor", parentModule: "test", parentEntity: "Maybe",
    params, returns: Maybe(number), scheme: { quantified: [], body: { $arrow: { params, returns: Maybe(number) } } }, signatureOutcome: { $tag: "Solved" } };
});
const params = [field("pairs", List({ $record: { fields: [field("key", string), field("value", { $var: "a" })] } }))];
const listApplication: FenelType = { $el: { call: ["List", { $var: "a" }] } };
const appendParams = [field("item", { $var: "a" }), field("arr", listApplication)]
  .map((entry, index) => ({ ...entry, key: { $tag: "PositionalField" as const, index } }));
const listKind = { $tag: "KArrow" as const, input: { $tag: "KType" as const }, output: { $tag: "KType" as const } };
const environment = createAuthoringEnvironment({
  types: [{ id: "Maybe", entityId: "Maybe", name: "Maybe", description: "", category: "type", type: Maybe(number) }],
  functions: [
    ...constructors,
    { id: "std:appendItem", targetId: "std:appendItem", codeName: "appendItem", label: "Append item", kind: "function", parentModule: "std", description: "", params: appendParams, returns: listApplication,
      scheme: { quantified: [{ id: "a", sourceName: "a", kind: { $tag: "KType" } }], body: { $arrow: { params: appendParams, returns: listApplication } },
        applications: [
          { path: ["$arrow", "params", "1", "type"], headRef: "List", kind: listKind, args: [{ $var: "a" }] },
          { path: ["$arrow", "returns"], headRef: "List", kind: listKind, args: [{ $var: "a" }] },
        ],
        nominals: [
          { path: ["$arrow", "params", "1", "type"], identity: '["system","List"]', publicName: "List" },
          { path: ["$arrow", "returns"], identity: '["system","List"]', publicName: "List" },
        ],
      }, signatureOutcome: { $tag: "Solved" } },
    { id: "std:fromEntries", targetId: "std:fromEntries", codeName: "fromEntries", label: "From entries", kind: "function", parentModule: "std", description: "", params, returns: { $record: { fields: [] } },
      scheme: { quantified: [{ id: "a", sourceName: "a", kind: { $tag: "KType" } }], body: { $arrow: { params, returns: { $record: { fields: [] } } } } }, signatureOutcome: { $tag: "Solved" } },
  ], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
});
let dangerousCalls = 0;
const evaluateContext: EvaluateContext = {
  natives: {
    List: (type) => List(type as FenelType),
    Maybe: (type) => Maybe(type as FenelType),
    "std:fromEntries": (pairs) => Object.fromEntries((pairs as { key: string; value: unknown }[]).map(({ key, value }) => [key, value])),
    danger: () => { dangerousCalls++; return 999; },
  },
  _constructors: Object.fromEntries(constructors.map((entry) => [entry.targetId!, entry.params.map((param) => param.name)])),
  _constructorWireNames: Object.fromEntries(constructors.map((entry) => [entry.targetId!, entry.codeName!])),
};
const item = (value: unknown, typeName = "Record"): TransferItem => ({ value, typeName, source: "fenel" });
const evalItem = (value: TransferItem) => evaluate(exprNodeToLogic(expressionForTransfer(value, environment), {
  fnCodeName: (id) => id, constructorName: environment.constructorCodeName,
}), {}, evaluateContext);

beforeAll(() => {
  // Registry boot is shared with the other authoring suites; these behavioral
  // checks do not use the cold process initialization as a UI timing claim.
  validateValue(List(number), [], null, { functions: evaluateContext, coerce: false });
}, 180_000);

describe("data transfer expression and destination adaptation", () => {
  test("dependent type projection uses current sibling data, captured function scope and the existing IO fence", () => {
    const dependent: FenelType = { $el: { call: ["reader-type", { var: "inputType" }] } };
    const captured: EvaluateContext = { getFunction: id => id === "reader-type" ? {
      id, params: [field("type", { $type: true })], returns: { $type: true }, body: { var: "type" },
    } : undefined };
    expect(scopedConcreteType(dependent, captured, undefined, undefined, { inputType: string })).toBe(string);
    expect(scopedConcreteType(dependent, captured, undefined, undefined, { inputType: number })).toBe(number);
    expect(scopedConcreteType(dependent, captured, undefined, undefined, {})).toBeUndefined();
    expect(scopedConcreteType(dependent, { getFunction: () => undefined }, undefined, undefined, { inputType: string })).toBeUndefined();
    let ioCalls = 0;
    const effectful: EvaluateContext = {
      getFunction: id => ({ id, params: [], returns: { $type: true } }),
      nativesCtx: { "effectful-type": () => { ioCalls++; return string; } },
    };
    expect(evaluate({ call: ["effectful-type"] }, {}, effectful)).toBe(string);
    expect(ioCalls).toBe(1);
    ioCalls = 0;
    expect(scopedConcreteType({ $el: { call: ["effectful-type"] } }, effectful)).toBeUndefined();
    expect(ioCalls).toBe(0);
  });

  test("pasted single-key calls, reserved editor markers and prototype keys remain data", () => {
    dangerousCalls = 0;
    const values = [
      { call: ["danger"] }, { var: "password" }, { danger: [] },
      { __lambda: { params: [], body: { call: ["danger"] } } },
      JSON.parse('{"__proto__":{"polluted":true}}'),
      { outer: { call: ["danger"] }, other: [{ var: "password" }] },
    ];
    for (const value of values) expect(evalItem(item(value))).toEqual(value);
    expect(dangerousCalls).toBe(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  }, 30_000);

  test("native image data remains one compact literal and preserves every pixel", () => {
    const value = { width: 2, height: 1, pixels: [{ r: 1, g: 2, b: 3, a: 255 }, { r: 4, g: 5, b: 6, a: 7 }] };
    const expression = expressionForTransfer(item(value, "Image"), environment);
    expect(expression).toEqual({ kind: "literal", value });
    expect(expression.kind === "literal" && expression.value).toBe(value);
    expect(evalItem(item(value, "Image"))).toEqual(value);
  });

  test("List Number append flattens incoming lists and keeps previous items", () => {
    const current = [1];
    const result = adaptTransferToTarget([itemFromText("[2,3]"), itemFromText("4")], {
      type: List(number), currentValue: current, environment, evaluateContext,
    });
    expect(result.value).toEqual([1, 2, 3, 4]);
    expect(current).toEqual([1]);
    expect(result.type).toEqual(List(number));
  }, 30_000);

  test("Maybe wraps a fitting value in Just and maps JSON null to Nothing", () => {
    const options = { type: Maybe(number), currentValue: { $tag: "Nothing" }, environment, evaluateContext };
    const result = adaptTransferToTarget([itemFromText("42")], options);
    expect(result.value).toEqual({ $tag: "Just", _0: 42 });
    expect(evalItem(item(result.value, "Maybe"))).toEqual(result.value);
    expect(adaptTransferToTarget([itemFromText("null")], options).value).toEqual({ $tag: "Nothing" });
  }, 30_000);

  test("nested Maybe list items are adapted through their payload type", () => {
    const result = adaptTransferToTarget([itemFromText("[1,2]")], {
      type: List(Maybe(number)), currentValue: [{ $tag: "Nothing" }], environment, evaluateContext,
    });
    expect(result.value).toEqual([{ $tag: "Nothing" }, { $tag: "Just", _0: 1 }, { $tag: "Just", _0: 2 }]);
  }, 30_000);

  test("pasting on a populated Maybe list appends inside Just without losing its existing contents", () => {
    const value = { $tag: "Just", _0: [1, 2] };
    const result = adaptTransferToTarget([itemFromText("3")], { type: Maybe(List(number)), currentValue: value, environment, evaluateContext });
    expect(result.value).toEqual({ $tag: "Just", _0: [1, 2, 3] });
    expect(value).toEqual({ $tag: "Just", _0: [1, 2] });
    expect(adaptTransferToTarget([itemFromText("null")], { type: Maybe(List(number)), currentValue: value, environment, evaluateContext }).value).toEqual({ $tag: "Nothing" });
  });

  test("incompatible scalar and whole-list validation refuse without modifying current data", () => {
    const current = [1];
    expect(() => adaptTransferToTarget([itemFromText("hello")], { type: List(number), currentValue: current, environment, evaluateContext })).toThrow("does not fit");
    expect(() => adaptTransferToTarget([itemFromText("false")], { type: Maybe(number), environment, evaluateContext })).toThrow("does not fit");
    expect(current).toEqual([1]);
  });

  test("text destinations retain textual spelling while internal numbers are not coerced", () => {
    const options = { type: string, environment, evaluateContext };
    expect(adaptTransferToTarget([itemFromText("42")], options).value).toBe("42");
    expect(() => adaptTransferToTarget([item(42, "Number")], options)).toThrow("does not fit");
  });

  test("root list element type is inferred by the existing authoring kernel", () => {
    const inferred = typeForTransfer(itemFromText("[1,2]"), environment);
    if (!inferred) throw new Error(JSON.stringify(inferAuthoringExpression(expressionForTransfer(itemFromText("[1,2]"), environment), environment)));
    expect(inferred).toBeDefined();
    const appended = adaptTransferToTarget([itemFromText("3")], { type: inferred, currentValue: [1, 2], environment, evaluateContext });
    expect(appended.value).toEqual([1, 2, 3]);
  }, 30_000);

  test("detached account data inference retains the exact intrinsic list helper", () => {
    const detached = createDetachedAuthoringEnvironment(environment);
    expect(detached.getFunctionEntry?.("appendItem")).toBeUndefined();
    const type = typeForTransfer(itemFromText("[1,2]"), detached, { evaluateContext });
    expect(type).toBeDefined();
    expect(adaptTransferToTarget([itemFromText("3")], { type, currentValue: [1, 2], environment: detached, evaluateContext }).value).toEqual([1, 2, 3]);
  });

  test("detached inference types tagged data through its one constructor, and abstains on a shared wire name", () => {
    const keyed = (tag: string, target: string, returns: FenelType): AuthoringCatalogFunctionEntry => {
      const params = tag === "Just" ? [{ ...field("_0", number), key: { $tag: "PositionalField" as const, index: 0 } }] : [];
      return { id: tag, targetId: target, codeName: tag, label: tag, description: "", kind: "constructor", parentModule: "test", parentEntity: "Maybe",
        params, returns, scheme: { quantified: [], body: { $arrow: { params, returns } } }, signatureOutcome: { $tag: "Solved" } };
    };
    const catalog = (functions: AuthoringCatalogFunctionEntry[]) => createDetachedAuthoringEnvironment(createAuthoringEnvironment({
      types: [{ id: "Maybe", entityId: "Maybe", name: "Maybe", description: "", category: "type", type: Maybe(number) }],
      functions, capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
    }));
    const maybe = [keyed("Nothing", "@ctor/test/Maybe/Nothing", Maybe(number)), keyed("Just", "@ctor/test/Maybe/Just", Maybe(number))];
    const data = (value: unknown) => ({ kind: "literal" as const, value });
    const solved = inferTransferExpression(data({ $tag: "Just", _0: 1 }), catalog(maybe));
    expect(solved.outcome.$tag).toBe("Solved");
    expect((solved.type as { $variant?: { cases: { name: string }[] } }).$variant?.cases.map((entry) => entry.name).sort()).toEqual(["Just", "Nothing"]);
    // Data that does not fit the constructor is still not typed by its tag.
    expect(inferTransferExpression(data({ $tag: "Just", _0: "wrong" }), catalog(maybe)).outcome.$tag).not.toBe("Solved");
    // Two constructors with the wire name `Just`: the tag names neither.
    const shared = [...maybe, keyed("Just", "@ctor/other/Choice/Just", { $ref: "Choice" })];
    expect(inferTransferExpression(data({ $tag: "Just", _0: 1 }), catalog(shared)).outcome.$tag).not.toBe("Solved");
  });

  test("untrusted internal type hints do not relabel values", () => {
    expect(typeForTransfer(item("text", "Number"), environment)).toEqual({ $ref: "String" });
    expect(typeForTransfer(item(42, "String"), environment)).toEqual({ $ref: "Number" });
  });

  test("malformed ADT data does not acquire a constructor type from its tag", () => {
    for (const [value, name] of [
      [{ $tag: "Just" }, "Maybe"], [{ $tag: "Just", _0: "wrong" }, "Maybe"],
      [{ $tag: "Text", content: 1 }, "Markup"], [{ $tag: "JsonNumber", value: "wrong" }, "JsonValue"],
    ] as const) expect(typeForTransfer(item(value, name), environment, { evaluateContext })).toBeUndefined();
  });

  test("a bare generic Maybe specializes through its constructor's real scheme", () => {
    const payload: FenelType = { $var: "a" };
    const applied: FenelType = { $el: { call: ["Maybe", payload] } };
    const genericConstructors = constructors.map((entry) => {
      const params = entry.codeName === "Just" ? [{ ...field("_0", payload), key: { $tag: "PositionalField" as const, index: 0 } }] : [];
      return { ...entry, params, returns: applied, scheme: {
        quantified: [{ id: "a", sourceName: "a", kind: { $tag: "KType" as const } }],
        body: { $arrow: { params, returns: applied } },
        applications: [{ path: ["$arrow", "returns"], headRef: "Maybe", kind: listKind, args: [payload] }],
        nominals: [{ path: ["$arrow", "returns"], identity: '["system","Maybe"]', publicName: "Maybe" }],
      } };
    });
    const genericEnvironment = createAuthoringEnvironment({
      ...environment.catalog,
      operatorCodeNameByNotation: new Map(),
      types: [{ id: "Maybe", entityId: "Maybe", name: "Maybe", description: "", category: "type", type: Maybe(payload) }],
      functions: [...environment.catalog.functions.filter((entry) => entry.kind !== "constructor"), ...genericConstructors],
    });
    const result = adaptTransferToTarget([itemFromText("42")], {
      type: { $ref: "Maybe" }, currentValue: { $tag: "Nothing" }, environment: genericEnvironment, evaluateContext,
    });
    expect(result.value).toEqual({ $tag: "Just", _0: 42 });
    const goal = expectedSchemeForType({ $ref: "Maybe" }, genericEnvironment)!;
    const withoutMaybeNative: EvaluateContext = { ...evaluateContext,
      natives: Object.fromEntries(Object.entries(evaluateContext.natives!).filter(([name]) => name !== "Maybe")),
    };
    for (const type of [{ $ref: "Maybe" } as FenelType, goal.body]) {
      const pasted = adaptTransferToTarget([itemFromText("7")], {
        type, expectedScheme: goal, currentValue: { $tag: "Nothing" }, environment: genericEnvironment, evaluateContext: withoutMaybeNative,
      });
      expect(pasted.value).toEqual({ $tag: "Just", _0: 7 });
      expect(pasted.expr).toMatchObject({ kind: "call", fnId: "@ctor/test/Maybe/Just" });
    }
  }, 30_000);

  test("clipboard preserves a user ADT owner and refuses a same-named foreign definition", () => {
    const state: FenelType = { $ref: "State" };
    const scoped = (owner: string) => createAuthoringEnvironment({
      types: [{ id: "State", entityId: "State", name: "State", description: "", category: "type",
        type: { $variant: { cases: [{ name: "Shared", label: Nothing }] } } }],
      functions: [{ id: "Shared", targetId: `@ctor/${owner}/State/Shared`, codeName: "Shared", label: "Shared", description: "", kind: "constructor",
        parentModule: owner, parentEntity: "State", ownerIdentity: owner, params: [], returns: state,
        scheme: { quantified: [], body: { $arrow: { params: [], returns: state } },
          nominals: [{ path: ["$arrow", "returns"], identity: owner, publicName: "State" }] }, signatureOutcome: { $tag: "Solved" } }],
      capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
    });
    const original = scoped("original-owner");
    const foreign = scoped("different-owner");
    const source = prepareTransferItem({ ...item({ $tag: "Shared" }, "State"), type: state }, original);
    const copied = decodeTransferItem(encodeTransferItem(source));
    expect(copied.type).toBeUndefined();
    expect(copied.typeCandidate?.type).toEqual(state);
    expect(typeForTransfer(copied, original, { evaluateContext })).toEqual(state);
    expect(expressionForTransfer(copied, original, { evaluateContext })).toMatchObject({ kind: "call", fnId: "@ctor/original-owner/State/Shared", args: [] });
    expect(() => typeForTransfer(copied, foreign, { evaluateContext })).toThrow("another definition");
    expect(typeForTransfer(item({ $tag: "Shared" }, "State"), foreign, { evaluateContext })).toBeUndefined();
  });

  test("forged type candidates cannot label a string Number or execute a computed type", () => {
    const forged = decodeTransferItem(encodeTransferItem(prepareTransferItem({ ...item("text", "Number"), type: number }, environment)));
    expect(() => typeForTransfer(forged, environment, { evaluateContext })).toThrow("original type");
    dangerousCalls = 0;
    const computed = decodeTransferItem(encodeTransferItem({ ...item(1, "Number"), typeCandidate: {
      type: { $el: { call: ["danger"] } }, identities: [{ path: "/$el/call/0", reference: "danger" }],
    } }));
    expect(() => typeForTransfer(computed, environment, { evaluateContext })).toThrow("cannot be verified");
    expect(dangerousCalls).toBe(0);
  });

  test("large-list inference validates the full list after its bounded candidate", () => {
    const value: unknown[] = Array.from({ length: 1000 }, (_, index) => index);
    const start = performance.now();
    expect(typeForTransfer(item(value, "List"), environment, { evaluateContext })).toBeDefined();
    console.log(`1000-item transfer type: ${Math.round(performance.now() - start)} ms`);
    value[999] = "not a number";
    expect(typeForTransfer(item(value, "List"), environment, { evaluateContext })).toBeUndefined();
  }, 30_000);
});
