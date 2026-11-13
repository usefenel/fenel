import { expect, test } from "bun:test";
import { evaluate } from "../json-logic";
import type { FenelFunction, FenelType, FieldDef, FunctionBody, SelectOption, SetExpr } from "../types";
import { expressionFromJsonWire, expressionToJsonWire, functionDefinitionFromJsonWire, functionDefinitionToJsonWire, typeDefinitionFromJsonWire, typeDefinitionToJsonWire, typeFromJsonWire, typeToJsonWire, viewDefinitionFromJsonWire, viewDefinitionToJsonWire } from "./expression-json";
import { List, Nothing } from "../type-foundation";
import { normalizeTypeViewDraft } from "./surface";

const unbounded: SetExpr = { $tag: "SePattern", pattern: { t: "rep", child: { t: "match", pred: { $tag: "SeAll" } }, min: 0, max: Infinity } };
const refined: FenelType = { $refined: { base: { $ref: "String" }, set: unbounded } };
const transport = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: Nothing, ui: Nothing, meta: {} });

test("function body Type values retain unbounded semantics through save/read/execution", () => {
  const definition: FenelFunction = { id: "fixture:type", params: [], returns: { $type: true }, body: { do: [{ let: { chosen: refined } }, { var: "chosen" }] } };
  const save = transport({ function: functionDefinitionToJsonWire(definition) });
  expect(JSON.stringify(save)).toContain('"max":"unbounded"');
  const reopened = functionDefinitionFromJsonWire(save.function);
  expect(reopened).toEqual(definition);
  expect(evaluate(reopened.body)).toEqual(refined);
  expect(functionDefinitionFromJsonWire(reopened)).toEqual(reopened);
});

test("saved signature ingress retains complete schemes and absent result mode through JSON", () => {
  const definition: FenelFunction = { id: "fixture:generic", params: [field("input", { $var: "a" })],
    returns: refined, body: "result",
    signatureDeclaration: { functionId: "fixture:generic", declarationName: "generic", codeName: "generic",
      params: [{ $tag: "Authored", source: { $tag: "HostSpec", module: "fixture" } }], returns: { $tag: "Absent" },
      scheme: { quantified: [{ id: "fixture:generic:a", sourceName: "a", kind: { $tag: "KType" } },
        { id: "fixture:generic:f", sourceName: "f", kind: { $tag: "KArrow", input: { $tag: "KType" }, output: { $tag: "KType" } } }],
        body: { $arrow: { params: [field("input", { $var: "a" })], returns: { $el: { call: ["f", refined] } } } },
        applications: [{ path: ["$arrow", "returns"], headVarId: "fixture:generic:f", args: [refined], kind: { $tag: "KType" } }],
        nominals: [{ path: ["$arrow", "returns", "$el", "call", "1", "$refined", "base"], identity: "fixture:String", publicName: "String" }],
        diagnostics: [{ code: "fixture.diagnostic", declaration: "generic", path: [], spelling: "a", message: "Retained source diagnostic" }],
      },
    },
  };
  const wire = transport(functionDefinitionToJsonWire(definition));
  expect(JSON.stringify(wire)).not.toContain('"max":null');
  const reopened = functionDefinitionFromJsonWire(wire);
  expect(reopened).toEqual(definition);
  expect(reopened.signatureDeclaration?.returns).toEqual({ $tag: "Absent" });
});

test("saved signature JSON rejects accessor evidence before observing it", () => {
  let reads = 0;
  const definition: FenelFunction = { id: "fixture:hostile", params: [], returns: { $ref: "String" } };
  Object.defineProperty(definition, "signatureDeclaration", { enumerable: true, get() { reads++; return {}; } });
  expect(() => functionDefinitionToJsonWire(definition)).toThrow("Accessor");
  expect(reads).toBe(0);
});

test("type declaration metadata uses the same scheme codec with or without a shape", () => {
  const declaration = { params: ["a"], typeScheme: {
    quantified: [{ id: "SavedType:a", sourceName: "a", kind: { $tag: "KType" as const } }],
    body: refined,
    applications: [{ path: [], headRef: "SavedType", args: [refined], kind: { $tag: "KType" as const } }],
    nominals: [{ path: ["$refined", "base"], identity: "std:String", publicName: "String" }],
    diagnostics: [{ code: "retained", declaration: "SavedType", path: [], spelling: "a", message: "Retained" }],
  } };
  expect(typeDefinitionFromJsonWire(transport(typeDefinitionToJsonWire(declaration)))).toEqual(declaration);
  const definition = { id: "SavedType", type: refined, ...declaration };
  expect(typeDefinitionFromJsonWire(transport(typeDefinitionToJsonWire(definition)))).toEqual(definition);
});

test("raw defaults, patterns and captured values never acquire type roles", () => {
  const raw = { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: "unbounded" } } } };
  const expression = { do: [{ var: ["absent", raw] }, { match: [1, { payload: raw }, 2, 3] }, { __fenelFn: true, params: [], body: raw, closure: { captured: raw } }] };
  expect(expressionFromJsonWire(transport(expressionToJsonWire(expression)))).toEqual(expression);
  const tagged = { $tag: "UserPayload", $refined: raw.$refined };
  expect(expressionFromJsonWire(expressionToJsonWire(tagged))).toEqual(tagged);
  expect(() => expressionToJsonWire({ var: ["absent", refined] })).toThrow("non-finite");
  expect(() => expressionToJsonWire({ __fenelFn: true, params: [], body: 0, closure: { captured: refined } })).toThrow("non-finite");
});

test("typed SetExpr literals transport only through declared result or annotation roles", () => {
  const expected: FenelType = { $ref: "SetExpr" };
  const body = { if: [true, unbounded, { $tag: "SeAll" }] };
  expect(expressionFromJsonWire(transport(expressionToJsonWire(body, expected)), expected)).toEqual(body);
  const annotated = { ann: [unbounded, expected] };
  expect(expressionFromJsonWire(transport(expressionToJsonWire(annotated)))).toEqual(annotated);
  expect(() => expressionToJsonWire(unbounded)).toThrow("non-finite");
  expect(() => expressionToJsonWire({ map: unbounded }, { $record: { fields: [field("map", expected)] } })).toThrow("non-finite");
});

test("declared List, tuple and record result slots retain SetExpr value transport", () => {
  const set: FenelType = { $ref: "SetExpr" };
  const examples: [FenelType, FunctionBody][] = [
    [List(set), [unbounded]],
    [{ $tuple: [set, { $ref: "Number" }] }, [unbounded, 2]],
    [{ $record: { fields: [field("set", set)] } }, { set: unbounded }],
    [{ $refined: { base: { $record: { fields: [field("set", set)] } }, set: { $tag: "SeAll" } } }, { set: unbounded }],
  ];
  for (const [returns, body] of examples) {
    const fn: FenelFunction = { id: "fixture:structured", params: [], returns, body };
    const reopened = functionDefinitionFromJsonWire(transport(functionDefinitionToJsonWire(fn)));
    expect(reopened.body).toEqual(body);
    expect(evaluate(reopened.body)).toEqual(body);
  }
}, 15_000); // The canonical identified List lens initializes the engine on a cold process.

test("nested annotation, dependent-type and predicate expression slots share the same transport", () => {
  const expression = { match: [true, { $guard: ["_", { deepEq: [refined, refined] }] }, { ann: [refined, { $type: true }] }, refined] };
  expect(expressionFromJsonWire(transport(expressionToJsonWire(expression)))).toEqual(expression);
  const dependent: FenelType = { $el: { if: [true, refined, { $ref: "String" }] } };
  expect(typeFromJsonWire(transport(typeToJsonWire(dependent)))).toEqual(dependent);
  const predicate: FenelType = { $refined: { base: { $ref: "String" }, set: { $tag: "SeWhere", pred: { deepEq: [refined, refined] } } } };
  expect(typeFromJsonWire(transport(typeToJsonWire(predicate)))).toEqual(predicate);
});

test("JSON expression transport fails before reading accessors and rejects unsupported remainders", () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, "hidden", { get() { reads++; return refined; } });
  expect(() => expressionToJsonWire(accessor)).toThrow("Accessor");
  expect(reads).toBe(0);
  expect(() => expressionToJsonWire(new Date(0))).toThrow("host object");
  expect(() => expressionToJsonWire({ do: [NaN] })).toThrow("non-finite");
  expect(() => expressionToJsonWire({ var: ["absent", { field: undefined }] })).toThrow("undefined");
  expect(() => expressionToJsonWire({ $tag: "Payload", missing: undefined })).toThrow("undefined");
  const symbol = Symbol("hidden");
  expect(() => expressionToJsonWire({ [symbol]: 1 })).toThrow("symbol-keyed");
  expect(() => expressionToJsonWire(Object.defineProperty({}, symbol, { get() { reads++; return 1; } }))).toThrow("Accessor");
  expect(reads).toBe(0);
});

test("view expression roles include reference filters and responsive layout conditions", () => {
  const when = { deepEq: [refined, refined] };
  const rawOption = { pattern: { t: "rep", max: "unbounded" } };
  const sections = [{ when, rows: [{ when, slots: [{ field: "set", when }] }] }];
  const view = normalizeTypeViewDraft({ name: "conditions", targetType: refined, editDisplay: {
    // Choice inhabitants remain raw typed data, including expression-shaped
    // records. Presentation transport must not reinterpret them as an expression.
    refFilter: when, options: [{ value: rawOption, label: { en: "Raw" } }],
  }, layout: { sections, responsive: [{ maxWidth: 480, sections }] } });
  const reopened = viewDefinitionFromJsonWire(transport(viewDefinitionToJsonWire(view)));
  expect(reopened).toEqual(view);
  expect(evaluate(reopened.layout!.responsive![0]!.sections[0]!.rows[0]!.slots[0]!.when)).toBe(true);
  const rawUndefined = normalizeTypeViewDraft({ name: "raw", editDisplay: { options: [{ value: undefined as unknown as SelectOption["value"], label: { en: "Missing" } }] } });
  expect(() => viewDefinitionToJsonWire(rawUndefined)).toThrow("undefined");
});
