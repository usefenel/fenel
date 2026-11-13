import { describe, expect, test } from "bun:test";
import type { AuthoringCatalogFunctionEntry, AuthoringExactFunctionRoute } from "@fenel/engine/authoring/environment";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { constructorNameCounts, displayCallableHandle, displayCallableName, displayFunctionName, displayFunctionSignature, displayParameterName, functionDisplayName, parameterDisplayName, searchableFunctionSpellings } from "./call-display";

const constructor = (owner: string, tag: string, codeName?: string): AuthoringCatalogFunctionEntry => ({
  id: `@ctor/codec/${owner}/${tag}`, targetId: `@ctor/codec/${owner}/${tag}`,
  codeName, kind: "constructor", label: tag, description: "", params: [], returns: { $ref: owner },
  parentModule: "codec", parentEntity: owner,
});

describe("checked callable presentation", () => {
  test("the real standard Join parameters use existing field presentation labels", async () => {
    const [{ stdModule }, { createRegistry }] = await Promise.all([
      import("@fenel/engine/modules/std"), import("../../../../../../implementations/typescript/engine/src/registry"),
    ]);
    const registry = createRegistry([stdModule], { publishCatalogEntities: false });
    const parameters = registry.getFunction("std:join")!.params;
    expect(parameters.map(parameter => parameter.name)).toEqual(["arr", "separator"]);
    expect(parameters.map((parameter, index) => displayParameterName(parameter, index, registry)))
      .toEqual(["Items", "Separator"]);
    expect(displayParameterName(undefined, 2, registry)).toBe("Input 3");
    // A labelled parameter reads as its label; an unlabelled one keeps its
    // code name as written, marked as code (never a re-cased fake label).
    expect(parameterDisplayName(registry.getFunction("std:words")!.params[0], 0, registry)).toEqual({ text: "Text", code: false });
    const unlabelled = registry.getFunction("std:validateValue")!.params;
    expect(unlabelled.map((parameter, index) => parameterDisplayName(parameter, index, registry)))
      .toEqual([{ text: "type", code: true }, { text: "value", code: true }]);
    expect(parameterDisplayName(undefined, 2, registry)).toEqual({ text: "Input 3", code: false });
  });

  test("unidentified parameters: a declared label is human text, a bare name is code", () => {
    const named = (name: string, label?: string): FieldDef => ({ name, type: { $ref: "String" },
      label: label === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: label }, ui: { $tag: "Nothing" }, meta: {} } as FieldDef);
    expect(parameterDisplayName(named("s", "Text"), 0)).toEqual({ text: "Text", code: false });
    expect(parameterDisplayName(named("s"), 0)).toEqual({ text: "s", code: true });
    expect(displayParameterName(named("s"), 0)).toBe("s");
  });

  test("function names are code unless a human label was shown", () => {
    const fn = (label: string, codeName: string): AuthoringCatalogFunctionEntry => ({
      id: `std:${codeName}`, targetId: `std:${codeName}`, codeName, kind: "function", label, description: "", params: [], returns: { $ref: "String" },
    });
    expect(functionDisplayName(fn("Words", "words"))).toEqual({ text: "Words", code: false });
    expect(functionDisplayName(fn("words", "words"))).toEqual({ text: "words", code: true });
    expect(functionDisplayName(constructor("Shape", "Circle"))).toEqual({ text: "codec.Shape.Circle", code: true });
  });

  test("qualified names come only from resolved routes and remain attached to exact targets", () => {
    const routes: AuthoringExactFunctionRoute[] = [
      { sourceName: "Source.identity", targetId: "Source:identity", status: "resolved" },
      { sourceName: "Imported.identity", targetId: "Source:identity", status: "resolved" },
      { sourceName: "Other.identity", targetId: "Other:identity", status: "resolved" },
      { sourceName: "Ambiguous.identity", targetId: "Source:identity", status: "ambiguous" },
      { sourceName: "Missing.identity", targetId: "Source:identity", status: "missing" },
      { sourceName: "Fenced.identity", targetId: "Source:identity", status: "fenced" },
    ];
    const before = structuredClone(routes);
    const spellings = searchableFunctionSpellings(routes);
    expect(spellings.get("Source:identity")).toEqual(["Source.identity", "Imported.identity"]);
    expect(spellings.get("Other:identity")).toEqual(["Other.identity"]);
    expect(spellings.get("Source.identity")).toBeUndefined();
    expect(routes).toEqual(before);
  });

  const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} });
  const generic = (params: FieldDef[], returns: FenelType): AuthoringCatalogFunctionEntry => ({
    id: "Source:identity", targetId: "Source:identity", kind: "function", label: "Identity", description: "",
    params, returns, signatureOutcome: { $tag: "Solved" },
    scheme: { quantified: [{ id: "q0", sourceName: "a", kind: { $tag: "KType" } }],
      body: { $arrow: { params, returns } } },
  });

  test("generic labels preserve the checked variable across input and result", () => {
    const entry = generic([field("value", { $var: "a" })], { $var: "a" });
    const before = structuredClone(entry);
    expect(displayFunctionSignature(entry, () => undefined)).toBe("∀ a. (value:a) → a");
    expect(entry).toEqual(before);
  });

  test("checked scheme parts take precedence over compatibility display fields", () => {
    const entry = { ...generic([field("value", { $var: "a" })], { $var: "a" }),
      params: [field("stale", { $ref: "String" })], returns: { $ref: "Number" } } as AuthoringCatalogFunctionEntry;
    expect(displayFunctionSignature(entry, type => "$ref" in type ? type.$ref : undefined))
      .toBe("∀ a. (value:a) → a");
  });

  test("nested callback variables use the existing type printer", () => {
    const callback: FenelType = { $arrow: { params: [field("value", { $var: "a" })], returns: { $var: "a" } } };
    expect(displayFunctionSignature(generic([field("callback", callback)], callback), () => undefined))
      .toBe("∀ a. (callback:a -> a) → a -> a");
  });

  test("a checked returned callable uses the type printer when the short label has no name", () => {
    const callback: FenelType = { $arrow: { params: [field("value", { $ref: "Number" })], returns: { $ref: "Number" } } };
    const entry = generic([field("offset", { $ref: "Number" })], callback);
    entry.scheme = { ...entry.scheme!, quantified: [] };
    expect(displayFunctionSignature(entry, type => "$ref" in type ? type.$ref : undefined))
      .toBe("(offset:Number) → Number -> Number");
  });

  test("a fenced scheme does not appear to have a checked quantifier", () => {
    const entry = { ...generic([field("value", { $var: "a" })], { $var: "a" }),
      signatureOutcome: { $tag: "AnnotationRequired" } } as AuthoringCatalogFunctionEntry;
    expect(displayFunctionSignature(entry, () => undefined)).toBe("(value:?) → ?");
  });
});

describe("callable display names", () => {
  test("readable labels precede source spellings without changing callable identity", () => {
    const entry = { ...constructor("unused", "join", "join"), id: "std:join", targetId: "std:join", kind: "function", label: "Join text" } as AuthoringCatalogFunctionEntry;
    const original = structuredClone(entry);
    expect(displayFunctionName(entry)).toBe("Join text");
    expect(entry).toEqual(original);
    expect(displayFunctionName({ ...entry, label: "join" })).toBe("join");
    expect(displayFunctionName({ ...constructor("Order", "Order", "Order"), label: "New order" })).toBe("New order");
  });
  test("reader fallback names shorten legacy handles and preserve distinct labels", () => {
    const handle = "StatisticsDemo:numberStatistics";
    expect(displayCallableName(handle, handle)).toBe("numberStatistics");
    expect(displayCallableName(handle, handle, handle)).toBe("numberStatistics");
    expect(displayCallableName("physical-id", undefined, undefined, handle)).toBe("numberStatistics");
    expect(displayCallableName(handle, "Sales: total", handle)).toBe("Sales: total");
    expect(displayCallableName(handle, undefined, "Statistics.numberStatistics")).toBe("Statistics.numberStatistics");
    expect(displayCallableName("unlabelled-physical-id")).toBe("unlabelled-physical-id");
  });

  test("internal constructor handles display as decoded dot paths without changing identity", () => {
    const entry = constructor("JsonValue", "JsonNull");
    const before = structuredClone(entry);
    expect(displayFunctionName(entry)).toBe("codec.JsonValue.JsonNull");
    expect(displayCallableHandle("@ctor/my%2Dmodule/Tree/Leaf")).toBe("my-module.Tree.Leaf");
    expect(entry).toEqual(before);
  });

  test("duplicate constructors qualify both module and owner", () => {
    const entries = [constructor("First", "Same", "Same"), constructor("Second", "Same", "Same")];
    const counts = constructorNameCounts(entries);
    expect(entries.map((entry) => displayFunctionName(entry, counts))).toEqual(["codec.First.Same", "codec.Second.Same"]);
    expect(entries.map((entry) => displayFunctionName({ ...entry, label: "No value" }, counts)))
      .toEqual(["codec.First.No value", "codec.Second.No value"]);
  });

  test("unique source names stay concise and operator notation stays attached to its function", () => {
    expect(displayFunctionName(constructor("Maybe", "Nothing", "Nothing"))).toBe("Nothing");
    expect(displayFunctionName({ ...constructor("unused", "add"), id: "std:add", targetId: "std:add", kind: "function", notation: "+" })).toBe("add (+)");
    expect(displayCallableHandle("List.map")).toBe("List.map");
  });
});
