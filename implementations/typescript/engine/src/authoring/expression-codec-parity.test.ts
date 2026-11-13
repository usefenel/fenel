import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "../fenel-parser";
import { evaluate, type EvaluateContext } from "../json-logic";
import { dispatchedCodeLensTextIsReadable, dispatchedExprToJsonLogic, print, printType, parseViaFenelParser, PARSE_VIA_FENEL_FAIL, withInterpretedCompiledArtifacts } from "../engine-bodies-dispatch";
import type { CompileFieldSlot } from "../compile-field-slots";
import { Nothing } from "../type-foundation";
import { createAuthoringEnvironment, type AuthoringCatalogFunctionEntry, type AuthoringCatalogSnapshot } from "./environment";
import {
  collectReferencedSavedExpressions,
  callSlotMetadata,
  fillAllCallArgs,
  exprNodeToLogic,
  observeExprNode,
  logicToExprNode,
  inferAuthoringExpression,
  normalizeAlgebraicPatternForAuthoring,
  RUNTIME_AUTHORING_OPERATORS,
  type ExprNode,
} from "./expression-authoring";

const roundtrip = (value: unknown) => exprNodeToLogic(logicToExprNode(value), { fnCodeName: (id) => id });

describe("current language expression codec parity", () => {
  test("authored records preserve dollar fields and evaluate their sibling producers through the exact reader target", () => {
    const node: ExprNode = { kind: "literal", value: { __record: { fields: [
      { name: "$", value: { kind: "literal", value: { $ref: "application-function" } } },
      { name: "contents", value: { kind: "call", fnId: "contents", args: [] } },
    ] } } };
    const calls: string[] = [];
    const logic = exprNodeToLogic(node, { constructorName: () => undefined, recordFromEntriesTarget: () => "reader-record" });
    const reader: EvaluateContext = { natives: {
      "reader-record": pairs => { calls.push("record"); return Object.fromEntries((pairs as Array<{ key: string; value: unknown }>).map(pair => [pair.key, pair.value])); },
      contents: () => { calls.push("contents"); return { livingThings: 1, countries: 2, writing: 3, emoji: 4 }; },
      "std:fromEntries": () => { throw new Error("A reader borrowed the compatibility target"); },
      "std.fromEntries": () => { throw new Error("A reader borrowed the compatibility target"); },
    } };
    expect(evaluate(logic, {}, reader)).toEqual({ $: { $ref: "application-function" }, contents: { livingThings: 1, countries: 2, writing: 3, emoji: 4 } });
    expect(calls).toEqual(["contents", "record"]);
    expect(() => exprNodeToLogic(node, { recordFromEntriesTarget: () => undefined })).toThrow("Record construction is unavailable");
    expect(() => exprNodeToLogic(node)).toThrow("Record construction is unavailable");
    const observed: ExprNode[] = [];
    expect(observeExprNode(node, { onExpression: expression => { observed.push(expression); } })).toBeUndefined();
    expect(observed).toContain(node);
    expect(observed.filter(expression => expression.kind === "call").map(expression => expression.fnId)).toEqual(["contents"]);
    expect(collectReferencedSavedExpressions(node)).toEqual([]);
    expect((node as { value: { __record: unknown } }).value.__record).toBeDefined();
    // Raw metadata remains opaque: only an authored __record is constructed.
    const raw = { $type: true, held: { call: ["contents"] } };
    expect(evaluate(exprNodeToLogic({ kind: "literal", value: raw }), {}, reader)).toBe(raw);
    expect(calls).toEqual(["contents", "record"]);
    const duplicate: ExprNode = { kind: "literal", value: { __record: { fields: [
      { name: "$", value: { kind: "literal", value: "kept" } },
      { name: "contents", value: { kind: "call", fnId: "discarded", args: [] } },
      { name: "contents", value: { kind: "call", fnId: "contents", args: [] } },
    ] } } };
    reader.natives!.discarded = () => { throw new Error("An overwritten field was evaluated"); };
    expect(evaluate(exprNodeToLogic(duplicate, { constructorName: () => undefined, recordFromEntriesTarget: () => "reader-record" }), {}, reader))
      .toEqual({ $: "kept", contents: { livingThings: 1, countries: 2, writing: 3, emoji: 4 } });
    expect(calls).toEqual(["contents", "record", "contents", "record"]);
  });

  // Source cases cover each expression production and its conveniences, rather
  // than relying on the workstream's completed-phase inventory.
  const sources = [
    "42", "1.5", '"text"', "true", "false", "()", "x", "user.name",
    "1 + 2 * 3", "not false", "-7", "true and false", "false or true",
    "if true then 1 else 2", "f 1 2", "f { b = 2, a = 1 }", "f { b = 2 }",
    "f 1", "\\x y -> x + y", "\\ -> []", "\\ -> [1, 2]",
    "(\\x -> x) 2", "f $ x + 1", "xs |> f", "xs |> f |> g",
    "let x = 1\nx + 2", "do\n  1\n  2\nend", "x where x = 3",
    "[]", "[x, f 2, [3]]", "{}", "{ name = x, value = f 2 }",
    "Just x", "Just { _0 = x }", "Nothing", "Just {}",
    "case x of\n  0 -> 1\n  _ -> 2",
    "case x of\n  Just y | y > 0 -> y\n  _ -> 0",
    "case x of\n  Cons (Just y) rest -> y",
    "case x of\n  { value = y } -> y",
    'case x of\n  { kind = "literal", value = v } -> v',
    "case p of\n  PatConstruct { ctor = c, args = subs } -> subs\n  PatLit { value = v } -> v\n  PatVar { name = n } -> n\n  PatWildcard -> 0",
    "(x : Number)", "`hello ${x}!`", "read(String)",
    "lazy { f x }", "eager { f x }", "partial { f x }", "jit { f x }",
    "Functor.fmap f xs",
  ];

  for (const source of sources) {
    test(`source preserves ${JSON.stringify(source)}`, () => {
      const logic = parse(source);
      expect(roundtrip(logic)).toEqual(logic);
    });
  }

  const runtimeForms: [string, unknown][] = [
    ["variable default", { var: ["missing", 7] }],
    ["raw expression-shaped default", { var: ["missing", { call: ["add", 1, 2] }] }],
    ["array variable without default", { var: ["x"] }],
    ["empty variable operand vector", { var: [] }],
    ["numeric variable path", { var: 0 }],
    ["null variable path", { var: null }],
    ["computed call target", { call: [{ fn: ["x", { var: "x" }] }, 3] }],
    ["dollar application", { call: ["$", { fn: ["x", { var: "x" }] }, 3] }],
    ["apply argument vector", { apply: [{ fn: [["x", "y"], { var: "y" }] }, [1, 2]] }],
    ["computed argument vector", { apply: [{ var: "f" }, { var: "args" }] }],
    ["vector lambda", { fn: [["x", "y"], { call: ["add", { var: "x" }, { var: "y" }] }] }],
    ["nullary vector lambda", { fn: [[], [1, 2]] }],
    ["explicit call uppercase head", { call: ["MyModule:run", 1] }],
    ["explicit call qualified head", { call: ["Module.member", 1] }],
    ["constructor exact id", { construct: ["@ctor/owner/case", 1] }],
    ["scoped instance", { withInstance: [{ typeName: "Show", args: ["String"], methods: { show: { fn: ["s", { var: "s" }] } }, blockId: "scope-1" }, { method: ["Show", "show", "hi"] }] }],
    ["computed instance", { withInstance: [{ var: "handler" }, { var: "x" }] }],
    ["strategy retains extra methods and scope metadata", { withInstance: [{ typeName: "Evaluator", args: ["EagerStrategy", "extra"], methods: { eval: "evaluator-strategies:eagerEval", other: "other" }, blockId: "scope" }, 3] }],
    ["multi-arm trailing default", { match: [{ var: "x" }, 1, "one", 2, "two", "other"] }],
    ["explicit wildcard", { match: [{ var: "x" }, "_", 3] }],
    ["legacy pipeline", { pipe: [1, ["add", 2], { fn: ["n", { var: "n" }] }] }],
    ["legacy scalar operands", { length: "hello" }],
    ["legacy operator operands", { "+": [1, 2, 3] }],
    ["contextual map", { map: [[1, 2], { var: "" }] }],
    ["record reserved names in multi-field context", { call: ["x"], do: [1], value: { var: "x" } }],
    ["tagged payload containing authoring marker spelling", { $tag: "Payload", __do: [{ var: "x" }] }],
  ];
  for (const [name, value] of runtimeForms) {
    test(`runtime shape preserves ${name}`, () => expect(roundtrip(value)).toEqual(value));
  }

  test("every host structural operation has an authoring metadata row", () => {
    const source = readFileSync(new URL("../json-logic.ts", import.meta.url), "utf8");
    const block = source.match(/const KNOWN_OPS = new Set<string>\(\[([\s\S]*?)\]\)/)?.[1];
    expect(block).toBeDefined();
    const known = [...block!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const authored = new Set(RUNTIME_AUTHORING_OPERATORS.map(({ op }) => op));
    expect(known.filter((op) => !authored.has(op!))).toEqual([]);
  });

  test("key-as-function-id calls receive editable operands only with authoritative resolution", () => {
    const input = { custom: [{ var: "x" }, 3] };
    const node = logicToExprNode(input, [], (name) => name === "custom" ? "module:custom" : undefined);
    expect((node as { value: { __operator: unknown } }).value.__operator).toBeDefined();
    expect(exprNodeToLogic(node)).toEqual(input);
    const record = logicToExprNode({ seconds: 0.25 });
    expect((record as { value: { __record: unknown } }).value.__record).toBeDefined();
  });

  test("resolved local and import aliases preserve source heads until the target changes", () => {
    for (const name of ["helper", "Tools.helper", "legacyAlias"]) {
      const node = logicToExprNode({ call: [name, 1] }, [], () => "library:helper") as Extract<ExprNode, { kind: "call" }>;
      const options = { fnCodeName: (id: string) => id === "library:helper" ? "helper" : "newHelper" };
      expect(node.fnId).toBe("library:helper");
      expect(exprNodeToLogic(node, options)).toEqual({ call: [name, 1] });
      expect(exprNodeToLogic({ ...node, args: [{ kind: "literal", value: 2 }] }, options)).toEqual({ call: [name, 2] });
      expect(exprNodeToLogic({ ...node, fnId: "other:helper" }, options)).toEqual({ call: ["newHelper", 1] });
    }
  });

  test("the shared Code printer round-trips tagged list data through constructors", () => {
    const purchases = [
      { $tag: "StatisticsPurchase", amountCents: 1200, customerId: "ada", id: "p1" },
      { $tag: "StatisticsPurchase", amountCents: 1500, customerId: "bo", id: "p2" },
    ];
    const code = print(exprNodeToLogic(logicToExprNode(purchases)));
    expect(code).toBe('[StatisticsPurchase { amountCents = 1200, customerId = "ada", id = "p1" }, StatisticsPurchase { amountCents = 1500, customerId = "bo", id = "p2" }]');
    expect(code).not.toContain("$tag");
    const parsed = parse(code);
    expect(evaluate(roundtrip(parsed))).toEqual(purchases);
    expect(evaluate(roundtrip(parse(code.replace("1200", "2200"))))).toEqual([
      { ...purchases[0]!, amountCents: 2200 }, purchases[1],
    ]);
    expect(purchases[0]!.amountCents).toBe(1200);
    expect(() => parse('[{ $tag = "StatisticsPurchase", amountCents = 2200, customerId = "ada", id = "p1" }]')).toThrow();
  }, 180_000);

  test("tagged data reuses nullary, positional, named and nested constructor formatting", () => {
    const cases: Array<[unknown, string]> = [
      [{ $tag: "Nothing" }, "Nothing"],
      [{ $tag: "Just", _0: 12 }, "Just 12"],
      [{ $tag: "Ok", _0: { $tag: "Just", _0: 12 } }, "Ok { _0 = Just 12 }"],
      [{ $tag: "Just", _0: { left: 1, right: 2 } }, "Just { _0 = { left = 1, right = 2 } }"],
      [{ $tag: "CustomerPurchaseSummary", customerName: { $tag: "Just", _0: "Ada" }, averageCents: { $tag: "Nothing" } }, 'CustomerPurchaseSummary { customerName = Just "Ada", averageCents = Nothing }'],
      [{ $tag: "Pair", _0: 1, label: "two" }, 'Pair { _0 = 1, label = "two" }'],
      [{ $tag: "Wrapper", value: [ { $tag: "Just", _0: 1 }, { $tag: "Nothing" } ], label: "nested" }, 'Wrapper { value = [Just 1, Nothing], label = "nested" }'],
    ];
    for (const [value, source] of cases) {
      expect(print(value)).toBe(source);
      expect(evaluate(roundtrip(parse(source)))).toEqual(value);
    }
    expect(print({ call: ["inspect", { $tag: "Just", _0: 12 }] })).toBe("inspect (Just 12)");
    expect(print({ construct: ["Wrapper", { $tag: "Just", _0: 12 }] })).toBe("Wrapper (Just 12)");
    expect(parse(print({ call: ["inspect", { $tag: "Just", _0: 12 }] }))).toEqual({ call: ["inspect", { construct: ["Just", 12] }] });
    expect(parse(print({ construct: ["Wrapper", { $tag: "Just", _0: 12 }] }))).toEqual({ construct: ["Wrapper", { construct: ["Just", 12] }] });
    const named = { $tag: "StatisticsPurchase", id: "p1", amountCents: 1200 };
    expect(print({ call: ["inspect", named] })).toBe('inspect (StatisticsPurchase { id = "p1", amountCents = 1200 })');
    expect(parse(print({ call: ["inspect", named] }))).toEqual({ call: ["inspect", { construct: ["StatisticsPurchase", { id: "p1", amountCents: 1200 }] }] });
    expect(print({ construct: ["Wrapper", named] })).toBe('Wrapper (StatisticsPurchase { id = "p1", amountCents = 1200 })');
    expect(parse(print({ construct: ["Wrapper", named] }))).toEqual({ construct: ["Wrapper", { construct: ["StatisticsPurchase", { id: "p1", amountCents: 1200 }] }] });
    expect(print({ construct: ["Wrapper", {}] })).toBe("Wrapper {  }");
  }, 180_000);

  test("printed tags retain source-frame constructor selection and ambiguous-name refusal", () => {
    // C1 scope controls use actual immutable authoring environments. Printing
    // carries the runtime tag only; it never selects an owner or a target.
    const targets = ["@ctor/owner-a/Shared", "@ctor/owner-b/Shared"];
    const constructors: AuthoringCatalogFunctionEntry[] = targets.map((targetId, index) => ({
      id: "Shared", targetId, ownerIdentity: `owner-${index}`, parentEntity: `Owner${index}`,
      parentModule: `Owner${index}`, kind: "constructor", label: "Shared", description: "",
      params: [
        { name: "left", type: { $ref: "Number" }, label: Nothing, ui: Nothing, meta: {} },
        { name: "right", type: { $ref: "Number" }, label: Nothing, ui: Nothing, meta: {} },
      ],
      returns: { $ref: `Owner${index}` },
    }));
    const snapshot: AuthoringCatalogSnapshot = {
      types: [], functions: constructors, patternConstructors: constructors,
      capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
    };
    const value = [{ $tag: "Shared", left: 1, right: 2 }];
    const code = print(value);
    expect(code).toBe("[Shared { left = 1, right = 2 }]");
    for (const targetId of targets) {
      const environment = createAuthoringEnvironment({ ...snapshot,
        exactConstructorRoutes: [{ sourceName: "Shared", targetId, status: "resolved" }],
      });
      const draft = logicToExprNode(parse(code), [], environment.resolveFunctionId);
      expect(exprNodeToLogic(draft, { constructorName: environment.resolveConstructorTarget }))
        .toEqual([{ construct: [targetId, { left: 1, right: 2 }] }]);
    }
    for (const status of ["ambiguous", "missing"] as const) {
      const environment = createAuthoringEnvironment({ ...snapshot,
        exactConstructorRoutes: [{ sourceName: "Shared", targetId: targets[0]!, status }],
      });
      expect(environment.resolveConstructorTarget?.("Shared")).toBeUndefined();
      expect(environment.resolveFunctionId("Shared")).toBeUndefined();
      expect(environment.resolveConstructorTarget?.(targets[1]!)).toBe(targets[1]);
      const draft = logicToExprNode(parse(code), [], environment.resolveFunctionId);
      expect(exprNodeToLogic(draft, { constructorName: environment.resolveConstructorTarget }))
        .toEqual([{ construct: ["Shared", { left: 1, right: 2 }] }]);
      expect(inferAuthoringExpression(draft, environment).outcome.$tag).not.toBe("Solved");
    }
    expect(value).toEqual([{ $tag: "Shared", left: 1, right: 2 }]);
  }, 180_000);

  test("constructor target projection visits actual pattern slots only", () => {
    const options = { constructorName: (name: string) => name === "SameName" ? "@ctor/owner/SameName" : undefined };
    const raw = { match: [1, { $tag: "SameName" }, 2] };
    const variable = { var: ["missing", raw] };
    expect(exprNodeToLogic(logicToExprNode(variable), options)).toEqual(variable);
    const tagged = { $tag: "Payload", value: raw };
    expect(exprNodeToLogic(logicToExprNode(tagged), options)).toEqual(tagged);
    expect(exprNodeToLogic(logicToExprNode(raw), options)).toEqual({ match: [1, { $tag: "@ctor/owner/SameName" }, 2] });
  });

  test("exact constructor targets print only round-trippable source-frame spellings", () => {
    const targetId = "@ctor/printer/Packet/Packet";
    const otherTarget = "@ctor/other/Packet/Packet";
    const functionId = "11a903a7-13cc-463e-89b7-8a61ba8a9320";
    const constructors: AuthoringCatalogFunctionEntry[] = [targetId, otherTarget].map((target, index) => ({
      id: "Packet", targetId: target, ownerIdentity: `owner-${index}`, parentEntity: `Packet${index}`,
      parentModule: index === 0 ? "Printer" : "Other", kind: "constructor", label: "Packet", description: "",
      params: [{ name: "message", type: { $ref: "String" }, label: Nothing, ui: Nothing, meta: {} }],
      returns: { $ref: `Packet${index}` },
    }));
    const routes = [
      { sourceName: targetId, targetId, status: "resolved" as const },
      { sourceName: "Packet", targetId, functionId, status: "resolved" as const },
      { sourceName: "Printer.Packet", targetId, status: "resolved" as const },
    ];
    const environment = createAuthoringEnvironment({
      types: [], functions: constructors, patternConstructors: constructors,
      capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(), exactConstructorRoutes: routes,
    });
    const source = { constructorRoutes: environment.catalog.exactConstructorRoutes };
    const resolveConstructor = (name: string) => {
      const resolved = environment.resolvePatternConstructor?.(name, undefined);
      return resolved?.status === "resolved" ? resolved.targetId : undefined;
    };
    const forms = [
      { construct: [targetId] },
      { construct: [targetId, "hello"] },
      { construct: [targetId, { message: "hello" }] },
      [{ construct: [targetId, { message: { construct: [targetId, "nested"] } }] }],
      { match: [{ construct: [targetId, "hello"] }, { $tag: targetId, message: { $bind: "message" } }, { var: "message" }] },
    ];
    for (const form of forms) {
      const printed = print(form, undefined, source);
      expect(printed).toContain("Packet");
      expect(printed).not.toContain("@ctor/");
      const draft = logicToExprNode(parse(printed), [], environment.resolveFunctionId, resolveConstructor);
      expect(exprNodeToLogic(draft, { constructorName: environment.constructorCodeName })).toEqual(form);
    }
    expect(print({ $tag: targetId, message: "hello" }, undefined, source)).toBe('Packet { message = "hello" }');
    expect(print({ call: ["inspect", targetId] }, undefined, source)).toBe(`inspect "${targetId}"`);
    // Exact source facts do not mutate the runtime encoder's identity choice.
    expect(environment.constructorCodeName(targetId)).toBe(targetId);

    const shadowedRoutes = routes.map((route) => route.sourceName === "Packet" ? { ...route, targetId: otherTarget } : route);
    const shadowed = createAuthoringEnvironment({ ...environment.catalog, operatorCodeNameByNotation: new Map(), exactConstructorRoutes: shadowedRoutes });
    const qualified = print(forms[2], undefined, { constructorRoutes: shadowed.catalog.exactConstructorRoutes });
    expect(qualified).toContain("<no surface syntax: constructor unavailable in this scope>");
    expect(() => parse(qualified)).toThrow();

    const functionShadow = createAuthoringEnvironment({ ...environment.catalog,
      operatorCodeNameByNotation: new Map(),
      functions: [...constructors, { id: "Packet", targetId: "function-packet", kind: "function",
        label: "Packet", description: "", codeName: "Packet", params: [], returns: { $ref: "String" } }],
      exactFunctionRoutes: [{ sourceName: "Packet", targetId: "function-packet", status: "resolved",
        entry: { id: "function-packet", kind: "function", label: "Packet", description: "",
          params: [], returns: { $ref: "String" } } }],
    });
    expect(functionShadow.resolveFunctionId("Packet")).toBe("function-packet");
    const shadowedConstructor = (name: string) => {
      const resolved = functionShadow.resolvePatternConstructor?.(name, undefined);
      return resolved?.status === "resolved" ? resolved.targetId : undefined;
    };
    const explicit = logicToExprNode(parse(print(forms[2], undefined, source)), [], functionShadow.resolveFunctionId, shadowedConstructor);
    expect(exprNodeToLogic(explicit, { constructorName: functionShadow.constructorCodeName })).toEqual(forms[2]);
  }, 180_000);

  test("exact constructor source projection refuses absent, ambiguous and unspellable routes", () => {
    const targetId = "@ctor/printer/Packet/Packet";
    const functionId = "11a903a7-13cc-463e-89b7-8a61ba8a9320";
    const form = { construct: [targetId, { message: "hello" }] };
    const diagnostic = "<no surface syntax: constructor unavailable in this scope>";
    for (const source of [
      undefined,
      { constructorRoutes: [] },
      { constructorRoutes: [{ sourceName: "Packet", targetId: "@ctor/other/Packet/Packet", status: "resolved" as const }] },
      ...(["missing", "ambiguous", "fenced"] as const).map((status) => ({ constructorRoutes: [{ sourceName: "Packet", targetId, status }] })),
      ...[targetId, "Printer.Packet", "Printer.Inner.Packet", "printer.Packet", "Printer.packet", "Packet:Packet", "Packet ()"].map((sourceName) => ({
        constructorRoutes: [{ sourceName, targetId, status: "resolved" as const }],
      })),
      { constructorRoutes: [
        { sourceName: "Packet", targetId, status: "resolved" as const },
        { sourceName: "Packet", targetId: "@ctor/other/Packet/Packet", status: "resolved" as const },
      ] },
    ]) {
      const printed = print(form, undefined, source);
      expect(printed).toContain(diagnostic);
      expect(printed).not.toContain("@ctor/");
      expect(() => parse(printed)).toThrow();
    }
    // A prior scoped invocation must not leak its naming context to another.
    expect(print(form, undefined, { constructorRoutes: [{ sourceName: "Packet", targetId, functionId, status: "resolved" }] }))
      .toBe('Packet { message = "hello" }');
    expect(printType({ $refined: { base: { $ref: "String" }, set: { $tag: "SeWhere", pred: { construct: [targetId] } } } })).toContain(diagnostic);
    const annotation = { ann: [form, { $el: { call: ["Box", { construct: [targetId] }] } }] };
    const annotated = print(annotation, undefined, { constructorRoutes: [{ sourceName: "Packet", targetId, functionId, status: "resolved" }] });
    expect(annotated).toContain('Packet { message = "hello" }');
    expect(annotated).toContain(diagnostic);
    expect(() => parse(annotated)).toThrow();
    expect(print(form)).toContain(diagnostic);
    expect(form).toEqual({ construct: [targetId, { message: "hello" }] });
  }, 180_000);

  test("constructor source projection declarations retain Fenel parser parity", () => {
    const source = readFileSync(new URL("../../../../../fenel/modules/engine/fenel-printer.fenel", import.meta.url), "utf8");
    for (const name of ["ppConstruct", "ppConstructorSourceName", "ppConstructorSourceRoute"]) {
      const start = source.indexOf(`${name} :`);
      const end = source.indexOf("\n\n", start);
      const declaration = source.slice(start, end).replace(/\r/g, "");
      const parsed = parseViaFenelParser(declaration);
      if (parsed === PARSE_VIA_FENEL_FAIL) throw new Error(`Fenel parser refused constructor projection declaration ${name}`);
      expect(parsed).not.toBe(PARSE_VIA_FENEL_FAIL);
      expect(parsed).toEqual(parse(declaration));
    }
  }, 600_000);

  test("edits execute inside lists, computed calls, argument vectors and trailing defaults", () => {
    const list = logicToExprNode([{ call: ["add", 1, 2] }]) as { kind: "literal"; value: { __list: ExprNode[] } };
    list.value.__list.push({ kind: "literal", value: 4 });
    expect(evaluate(exprNodeToLogic(list))).toEqual([3, 4]);
    const application = { apply: [{ fn: [["x", "y"], { var: "y" }] }, [1, 8]] };
    expect(evaluate(roundtrip(application))).toBe(8);
    expect(evaluate(roundtrip({ match: [4, 1, "one", "default"] }))).toBe("default");
    expect(evaluate(roundtrip({ var: ["absent", { call: ["add", 1, 2] }] }))).toEqual({ call: ["add", 1, 2] });
  });

  test("reference dependencies follow executable slots and exclude data-only slots", () => {
    const ref = (id: string): ExprNode => ({ kind: "ref", savedExprId: id });
    const node: ExprNode = { kind: "literal", value: { __do: [
      { kind: "literal", value: { __list: [ref("list-child")] } },
      { kind: "literal", value: { __withInstance: { frame: ref("frame"), body: ref("body") } } },
      { kind: "literal", value: { __match: { scrutinee: ref("scrutinee"), arms: [{ pattern: { $guard: ["_", ref("guard")] }, body: ref("body") }] } } },
      { kind: "literal", value: { __ann: { expr: ref("annotated"), type: ref("raw-type") } } },
      { kind: "literal", value: { __var: { path: "missing", fallback: ref("raw-default"), arrayForm: true } } },
    ] } };
    expect(collectReferencedSavedExpressions(node)).toEqual(["list-child", "frame", "body", "scrutinee", "guard", "annotated"]);
  });

  test("wire names are own properties, including JavaScript prototype spellings", () => {
    for (const value of [
      JSON.parse('{"__proto__":{"var":"x"},"constructor":2}'),
      JSON.parse('{"let":{"__proto__":1,"constructor":2}}'),
      JSON.parse('{"where":[3,{"__proto__":1}]}'),
      JSON.parse('{"construct":["Pair",{"__proto__":1,"constructor":2}]}'),
      JSON.parse('{"match":[{"var":"x"},{"__proto__":{"$bind":"p"}},1]}'),
    ]) {
      expect(JSON.stringify(roundtrip(value))).toBe(JSON.stringify(value));
    }
  });

  test("resolved pattern fields project through the existing field-identity boundary", () => {
    const key = { $tag: "NamedField", ref: { $ref: "b7e34f82-2503-4bf3-8c19-d63f21112611" } };
    const pattern = { $tag: "PatConstruct", ctor: "Pair", fields: [{ key, wireName: "currentName" }], args: [{ $tag: "PatVar", name: "value" }] };
    expect(normalizeAlgebraicPatternForAuthoring(pattern, "adt")).toEqual({ $tag: "Pair", currentName: { $bind: "value" } });
    expect(pattern.fields[0]!.key).toBe(key);
    expect(normalizeAlgebraicPatternForAuthoring({ $tag: "PatWildcard" }, "adt")).toBe("_");
    expect(normalizeAlgebraicPatternForAuthoring({ $tag: "PatWildcard" })).toEqual({ $tag: "PatWildcard" });
    expect(() => normalizeAlgebraicPatternForAuthoring({ ...pattern, fields: [{}] }, "adt")).toThrow("source name or CompileFieldSlot");
  });

  // C1: exercise the actual source egress before the shared authoring codec.
  // Raw wire {$tag:"PatWildcard"} remains a constructor pattern; only the
  // canonical Pattern ADT input is normalized into the operational wildcard.
  const coreLiteral = (value: unknown) => ({ $tag: "ELit", value });
  const expectCoreWildcardEgress = (core: unknown, wire: unknown, result: unknown) => withInterpretedCompiledArtifacts(() => {
    const original = structuredClone(core);
    const projected = dispatchedExprToJsonLogic(core);
    expect(projected).toEqual(wire);
    const authoring = logicToExprNode(projected);
    const restored = exprNodeToLogic(authoring, { fnCodeName: id => id });
    expect(restored).toEqual(wire);
    expect(evaluate(restored)).toEqual(result);
    expect(core).toEqual(original);
  });

  test("core wildcard egress retains a trailing wildcard as the default body", () => {
    expectCoreWildcardEgress({ $tag: "EMatch", scrutinee: coreLiteral(4), arms: [
      { pattern: { $tag: "PatLit", value: 3 }, body: coreLiteral("miss") },
      { pattern: { $tag: "PatWildcard" }, body: coreLiteral("default") },
    ] }, { match: [4, 3, "miss", "default"] }, "default");
  });

  test("core wildcard egress retains a nontrailing wildcard's first-match behavior", () => {
    expectCoreWildcardEgress({ $tag: "EMatch", scrutinee: coreLiteral(4), arms: [
      { pattern: { $tag: "PatWildcard" }, body: coreLiteral("first") },
      { pattern: { $tag: "PatLit", value: 4 }, body: coreLiteral("later") },
    ] }, { match: [4, "_", "first", 4, "later"] }, "first");
  });

  test("core wildcard egress recurses through constructor fields without changing their identities or wires", () => {
    const slots: CompileFieldSlot[] = [
      { key: { $tag: "NamedField", ref: { $ref: "1cd42d53-b174-49c5-9be3-bdf84b7383df" } }, wireName: "currentLeft" },
      { key: { $tag: "NamedField", ref: { $ref: "f559d86b-c3e5-4dce-a41e-01640b512430" } }, wireName: "currentRight" },
    ];
    const innerSlots: CompileFieldSlot[] = [
      { key: { $tag: "NamedField", ref: { $ref: "70989911-c496-4949-a76f-d9d8c6171b69" } }, wireName: "currentPayload" },
    ];
    const leftKey = slots[0]!.key, rightKey = slots[1]!.key;
    const payloadKey = innerSlots[0]!.key;
    const innerPattern = { $tag: "PatConstruct", ctor: "Inner", fields: innerSlots, args: [{ $tag: "PatWildcard" }] };
    const pattern = { $tag: "PatConstruct", ctor: "Pair", fields: slots,
      args: [innerPattern, { $tag: "PatVar", name: "answer" }] };
    const core = { $tag: "EMatch", scrutinee: { $tag: "EConstruct", ctor: "Pair", fields: slots,
      args: [{ $tag: "EConstruct", ctor: "Inner", fields: innerSlots, args: [coreLiteral(4)] }, coreLiteral(9)] }, arms: [
      { pattern, body: { $tag: "EVar", name: "answer" } },
      { pattern: { $tag: "PatWildcard" }, body: coreLiteral("miss") },
    ] };
    expectCoreWildcardEgress(core, { match: [
      { construct: ["Pair", { currentLeft: { construct: ["Inner", { currentPayload: 4 }] }, currentRight: 9 }] },
      { $tag: "Pair", currentLeft: { $tag: "Inner", currentPayload: "_" }, currentRight: { $bind: "answer" } }, { var: "answer" }, "miss",
    ] }, 9);
    expect(pattern.fields).toBe(slots);
    expect(pattern.fields[0]!.key).toBe(leftKey);
    expect(pattern.fields[1]!.key).toBe(rightKey);
    expect(pattern.fields.map(slot => slot.wireName)).toEqual(["currentLeft", "currentRight"]);
    expect(innerPattern.fields).toBe(innerSlots);
    expect(innerPattern.fields[0]!.key).toBe(payloadKey);
    expect(innerPattern.fields[0]!.wireName).toBe("currentPayload");
  });

  for (const guard of [true, false]) {
    test(`core wildcard egress keeps a guarded wildcard conditional (${guard})`, () => {
      expectCoreWildcardEgress({ $tag: "EMatch", scrutinee: coreLiteral(4), arms: [
        { pattern: { $tag: "PatWildcard" }, guard: coreLiteral(guard), body: coreLiteral("guarded") },
        { pattern: { $tag: "PatWildcard" }, body: coreLiteral("default") },
      ] }, { match: [4, { $guard: ["_", guard] }, "guarded", "default"] }, guard ? "guarded" : "default");
    });
  }

  test("unknown and overapplied argument slots remain editable and fill never drops them", () => {
    const node: Extract<ExprNode, { kind: "call" }> = { kind: "call", fnId: "external", args: [
      { kind: "literal", value: 1 }, { kind: "literal", value: 2 }, { kind: "literal", value: 3 },
    ] };
    expect(callSlotMetadata(node, undefined).renderedArgs).toEqual([{ index: 0 }, { index: 1 }, { index: 2 }]);
    expect(callSlotMetadata(node, []).activeParamCount).toBe(3);
    expect(fillAllCallArgs(node, [])).toEqual(node);
  });
});

describe("structural Boolean codec provenance under reader shadowing", () => {
  const shadowedReader = () => {
    const calls: string[] = [];
    const reader: EvaluateContext = {
      getFunction: () => undefined,
      _importStack: [{ names: { and: "shadow:and", or: "shadow:or", if: "shadow:if" }, aliases: {} }],
      natives: {
        touch: (value: unknown) => { calls.push("touch"); return value; },
        "shadow:if": (...args: unknown[]) => { calls.push("shadow:if"); return { shadow: "if", args }; },
        "shadow:and": (...args: unknown[]) => { calls.push("shadow:and"); return { shadow: "and", args }; },
        "shadow:or": (...args: unknown[]) => { calls.push("shadow:or"); return { shadow: "or", args }; },
      },
    };
    const resolveFnId = (name: string) => name === "and" || name === "or" || name === "if" ? `shadow:${name}` : undefined;
    const decode = (logic: unknown) => logicToExprNode(logic, [], resolveFnId);
    const encode = (node: ExprNode) => exprNodeToLogic(node, {
      fnCodeName: (id) => id,
      constructorName: () => undefined,
    });
    return { calls, reader, decode, encode };
  };

  test("raw IF codec provenance preserves reader-independent laziness through text re-entry", () => {
    const { calls, reader, decode, encode } = shadowedReader();
    const raw = { if: [false, { call: ["touch", 9] }, 29] };
    const restored = encode(decode(raw));
    expect(evaluate(restored, {}, reader)).toBe(29);
    expect(calls).toEqual([]);
    expect(restored).toEqual(raw);
    const text = print(restored);
    expect(dispatchedCodeLensTextIsReadable(text)).toBe(true);
    const reparsed = encode(decode(parse(text)));
    expect(reparsed).toEqual(raw);
    expect(evaluate(reparsed, {}, reader)).toBe(29);
    expect(calls).toEqual([]);
  }, 180_000);

  test("ordinary IF codec provenance retains the eager reader-owned call form", () => {
    const { calls, reader, decode, encode } = shadowedReader();
    const ordinary = { call: ["if", false, { call: ["touch", 9] }, 29] };
    const restored = encode(decode(ordinary));
    expect(restored).toEqual(ordinary);
    expect(evaluate(restored, {}, reader)).toEqual({ shadow: "if", args: [false, 9, 29] });
    expect(calls).toEqual(["touch", "shadow:if"]);
  });

  for (const { op, first } of [{ op: "and", first: "0" }, { op: "or", first: 7 }]) {
    test(`raw ${op} preserves the selected operand and skips shadowed calls through the codec`, () => {
      const { calls, reader, decode, encode } = shadowedReader();
      const logic = { [op]: [first, { call: ["touch", 9] }] };
      expect(evaluate(logic, {}, reader)).toBe(first);
      expect(calls).toEqual([]);
      const node = decode(logic);
      const restored = encode(node);
      expect(evaluate(restored, {}, reader)).toBe(first);
      expect(calls).toEqual([]);
      expect(restored).toEqual(logic);
      expect(node.kind).toBe("literal");
    });

    test(`raw ${op} refuses unsafe text substitution while ordinary ${op} re-enters eagerly under shadowing`, () => {
      const { calls, reader, decode, encode } = shadowedReader();
      const raw = { [op]: [first, { call: ["touch", 9] }] };
      const rawText = print(encode(decode(raw)));
      // Word operators name ordinary eager calls. The existing printer must
      // refuse this raw lazy form rather than offer text with different effects.
      expect(rawText).toBe(op === "or"
        ? "<no surface syntax: structural disjunctions>"
        : "<no surface syntax: structural conjunctions outside flat refinement predicates>");
      expect(dispatchedCodeLensTextIsReadable(rawText)).toBe(false);
      expect(calls).toEqual([]);

      // The spellable ordinary call still has a real text -> parser -> codec
      // round trip under the same reader, including its eager argument effects.
      const logic = { call: [op, first, { call: ["touch", 9] }] };
      const text = print(encode(decode(logic)));
      expect(dispatchedCodeLensTextIsReadable(text)).toBe(true);
      const parsed = parse(text);
      expect(parsed).toEqual(logic);
      const restored = encode(decode(parsed));
      expect(restored).toEqual(logic);
      expect(evaluate(restored, {}, reader)).toEqual({ shadow: op, args: [first, 9] });
      expect(calls).toEqual(["touch", `shadow:${op}`]);
    }, 180_000);

    test(`ordinary ${op} retains its eager shadowed reader target through the codec`, () => {
      const { calls, reader, decode, encode } = shadowedReader();
      const logic = { call: [op, first, { call: ["touch", 9] }] };
      expect(evaluate(logic, {}, reader)).toEqual({ shadow: op, args: [first, 9] });
      expect(calls).toEqual(["touch", `shadow:${op}`]);
      calls.length = 0;
      const node = decode(logic);
      expect(node.kind).toBe("call");
      if (node.kind !== "call") throw new Error("ordinary Boolean call lost its call carrier");
      expect(node.fnId).toBe(`shadow:${op}`);
      expect(node.callSyntax).toBe("call");
      const restored = encode(node);
      expect(restored).toEqual(logic);
      expect(evaluate(restored, {}, reader)).toEqual({ shadow: op, args: [first, 9] });
      expect(calls).toEqual(["touch", `shadow:${op}`]);
    });
  }
});
