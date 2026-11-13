import { describe, expect, test } from "bun:test";
import { print, printType, type PrintSourceContext } from "./engine-bodies-dispatch";

const typeId = "eeafda88-90e9-438e-9e79-fdcf9d2e87dd";
const functionId = "74553aa5-becb-4f19-82fd-f90899f1a4ce";
const constructorFunctionId = "c4327cf2-cc91-4057-97de-cd2e776db6b7";
const constructor = `@ctor/local/${typeId}/${typeId}`;
const source: PrintSourceContext = {
  constructorTargets: [{ id: typeId, targetId: constructor, functionId: constructorFunctionId }],
  constructorRoutes: [{ sourceName: typeId, targetId: constructor, status: "fenced" }],
};
const names: PrintSourceContext = {
  referenceRoutes: [
    { sourceName: "std.add", targetId: functionId, handles: ["std:add"], status: "resolved" },
    { sourceName: "system.Expr", targetId: typeId, status: "resolved" },
  ],
};

describe("identity source printing", () => {
  test("existing references remain reference data while explicit calls retain invocation", () => {
    expect(print({ $ref: functionId })).toBe(`@{${functionId}}`);
    expect(print([{ $ref: typeId }, { call: [functionId] }, 43], undefined, source))
      .toBe(`[@{${typeId}}, @{${functionId}} (), 43]`);
    expect(print({ call: [functionId, { $ref: typeId }] }, undefined, source))
      .toBe(`@{${functionId}} @{${typeId}}`);
  });

  test("unnamed constructors retain exact targets and nullary construction remains explicit", () => {
    expect(print({ construct: [constructor, { count: 7 }] }, undefined, source))
      .toBe(`@{${constructorFunctionId}} { count = 7 }`);
    expect(print({ construct: [constructor] }, undefined, source)).toBe(`@{${constructorFunctionId}} ()`);
    expect(print({ construct: [constructor] })).toContain("constructor unavailable in this scope");
    expect(print({ construct: [constructor] }, undefined, {
      constructorRoutes: [{ sourceName: "local.Counter", targetId: constructor, status: "resolved" }],
    })).toContain("constructor unavailable in this scope");
  });

  test("a faithful scoped constructor name remains preferable to its exact identity spelling", () => {
    expect(print({ construct: [constructor, { count: 7 }] }, undefined, {
      ...source,
      constructorRoutes: [{ sourceName: "Counter", targetId: constructor, functionId: constructorFunctionId, status: "resolved" }],
    })).toBe("Counter { count = 7 }");
    expect(print({ construct: [constructor] }, undefined, {
      ...source,
      constructorRoutes: [{ sourceName: "system.Expr.ELit", targetId: constructor, functionId: constructorFunctionId, status: "resolved" }],
    })).toBe("system.Expr.ELit ()");
  });

  test("legacy type and function pins preserve identity through canonical Ref source", () => {
    for (const kind of ["entity", "function"]) {
      expect(print({ $pin: kind, id: functionId, name: "Same label" })).toBe(`@{${functionId}}`);
    }
    expect(print([{ $ref: typeId }, { $ref: functionId }]))
      .toBe(`[@{${typeId}}, @{${functionId}}]`);
  });

  test("type-position UUIDs use the same identity spelling", () => {
    expect(printType({ $ref: typeId })).toBe(`@{${typeId}}`);
    expect(printType({ $ref: "Number" })).toBe("Number");
    expect(printType({ $el: { call: [typeId, { $ref: "Number" }] } }))
      .toContain("no surface syntax: an exact identity type application");
  });

  test("empty and decorated reference records keep explicit source refusal", () => {
    expect(print({ $ref: "" })).toContain("no surface syntax");
    expect(print([{ $ref: functionId, payload: 45 }])).toContain("no surface syntax");
  });

  test("inert expression payloads cannot become calls through constructor source re-entry", () => {
    expect(print({ $tag: "ELit", value: 42 })).toBe("ELit { value = 42 }");
    expect(print({ $tag: "ELit", value: { call: [functionId] } }))
      .toContain("no surface syntax: inert expression-shaped data");
    expect(print({ $tag: "ELit", value: { nested: { var: "input" } } }))
      .toContain("no surface syntax: inert expression-shaped data");
  });

  test("internal handles never become quoted identity source", () => {
    for (const handle of ["exact\"handle\\part", "std:add", constructor, "literal\\u0000", "a\u0000b", "a\bb", "a\fb", "a\ud800b"]) {
      expect(print({ $ref: handle })).toContain("no surface syntax");
    }
  });

  test("existing UUIDs retain their admitted Codeable names", () => {
    expect(print({ $ref: functionId }, undefined, names)).toBe("std.add");
    expect(print({ $ref: "std:add" }, undefined, names)).toBe("std.add");
    expect(print({ call: [functionId, 2, 3] }, undefined, names)).toBe("std.add 2 3");
    expect(print({ call: ["std:add", 2, 3] }, undefined, names)).toBe("std.add 2 3");
    expect(print({ $ref: typeId }, undefined, names)).toBe("system.Expr");
    expect(printType({ $ref: typeId }, names)).toBe("system.Expr");
  });

  test("lexical bindings and ambiguous names retain exact reference meanings", () => {
    expect(print({ fn: ["std", { $ref: functionId }] }, undefined, names)).toBe(`\\std -> @{${functionId}}`);
    expect(print({ $ref: functionId }, undefined, { ...names, boundNames: ["std"] })).toBe(`@{${functionId}}`);
    expect(print({ fn: ["std", { call: ["std.add", 2, 3] }] }, undefined, names)).toBe("\\std -> std.add 2 3");
    expect(print({ fn: ["add", { call: ["add", 2, 3] }] }, undefined, names)).toBe("\\add -> add 2 3");
    expect(print({ do: [{ $ref: functionId }, { let: { std: 45 } }, { $ref: functionId }] }, undefined, names))
      .toBe(`do\n  std.add\n  let std = 45\n  @{${functionId}}\nend`);
    expect(print({ where: [{ $ref: functionId }, { std: 45 }] }, undefined, names))
      .toBe(`@{${functionId}} where std = 45`);
    expect(print({ match: [45, { $bind: "std" }, { $ref: functionId }] }, undefined, names))
      .toContain(`-> @{${functionId}}`);
    expect(print({ $ref: functionId }, undefined, {
      referenceRoutes: [...names.referenceRoutes!, { sourceName: "std.add", targetId: constructorFunctionId, status: "resolved" }],
    })).toBe(`@{${functionId}}`);
  });

  test("invalid record keys refuse in function and constructor arguments as well as ordinary records", () => {
    for (const expression of [
      { call: [functionId, { "a-b": 45 }] },
      { construct: [constructor, { "a-b": 45 }] },
      { "a-b": 45 },
    ]) expect(print(expression, undefined, source)).toContain("no surface syntax: a record field name");
  });

  test("a large captured catalog filters unrelated routes before checking name ambiguity", () => {
    const unrelated = Array.from({ length: 4096 }, (_, index) => ({
      sourceName: `library.value${index}`, targetId: constructorFunctionId, status: "resolved" as const,
    }));
    const captured = { referenceRoutes: [...unrelated, ...names.referenceRoutes!] };
    expect(print({ $ref: functionId }, undefined, captured)).toBe("std.add");
    expect(print({ call: [functionId, 2, 3] }, undefined, captured)).toBe("std.add 2 3");
  }, 60_000);
});
