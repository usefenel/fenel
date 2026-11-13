import { describe, expect, test } from "bun:test";
import { parse as parseFenel } from "../fenel-parser";
import {
  ALGEBRAIC_PATTERN_MODES,
  annotationExpression,
  baseTypeDisplayName,
  callSlotMetadata,
  catExpression,
  constructorFieldsForTag,
  defaultPatternForMode,
  evaluatorStrategyExpression,
  evaluatorStrategyFromFrame,
  exprNodeToLogic,
  expandAuthoringParamPaths,
  fillAllCallArgs,
  fillNextCallArg,
  inferAuthoringExpression,
  inferAuthoringExpressionType,
  inferAuthoringPatternBindings,
  logicToExprNode,
  matchLogicToAuthoringArms,
  normalizeAlgebraicPatternForAuthoring,
  partialCallNode,
  peelToRecordType,
  peelToVariantType,
  patternMode,
  readExpression,
  recordFieldsForType,
  seedCallArgs,
  seedConstructValue,
  seedExprArg,
  seedLambdaNode,
  seedRecordFields,
  summarizeAuthoringPattern,
  summarizeExprNode,
  typeCode,
  typeDisplayName,
  typePhrase,
  whereExpression,
  type AuthoringFunctionEntry,
  type AuthoringInferenceContext,
  type AuthoringKernelContext,
  type ExprNode,
} from "./expression-authoring";
import type { FieldDef, FenelType, TypeScheme } from "../types";
import { Anything, List, Nothing } from "../type-foundation";
import { dispatchEngineBody } from "../engine-bodies-dispatch";

function lowerFenel(src: string): unknown {
  return exprNodeToLogic(logicToExprNode(parseFenel(src)));
}

const str = { $ref: "String" } as FenelType;
const num = { $ref: "Number" } as FenelType;
const bool = { $ref: "Boolean" } as FenelType;
const userType = {
  $record: {
    fields: [
      { name: "name", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: str, meta: {}, ui: Nothing },
      { name: "age", key: { $tag: "PositionalField", index: 1 }, label: Nothing, type: num, meta: {}, ui: Nothing },
    ],
  },
} as FenelType;
const maybeNumber = {
  $variant: {
    cases: [
      { name: "Nothing", label: Nothing },
      {
        name: "Just",
        label: Nothing,
        fields: [{ name: "value", key: { $tag: "PositionalField", index: 0 }, label: Nothing, type: num, meta: {}, ui: Nothing }],
      },
    ],
  },
} as FenelType;

function field(name: string, type: FenelType, index = 0): FieldDef {
  return {
    name,
    key: { $tag: "PositionalField", index },
    label: Nothing,
    type,
    meta: {},
    ui: Nothing,
  };
}

function monomorphicScheme(
  params: readonly FieldDef[],
  returns: FenelType,
): TypeScheme {
  return { quantified: [], body: { $arrow: { params: [...params], returns } } };
}

const fns = new Map<string, AuthoringFunctionEntry>([
  ["add", {
    id: "add",
    params: [field("a", num), field("b", num, 1)],
    returns: num,
    scheme: monomorphicScheme([field("a", num), field("b", num, 1)], num),
    kind: "function",
  }],
  ["isAdult", {
    id: "isAdult",
    params: [field("user", { $ref: "User" })],
    returns: bool,
    scheme: monomorphicScheme([field("user", { $ref: "User" })], bool),
    kind: "function",
  }],
  ["Just", {
    id: "Just",
    params: [field("value", num)],
    returns: { $ref: "MaybeNumber" },
    scheme: monomorphicScheme([field("value", num)], { $ref: "MaybeNumber" }),
    kind: "constructor",
    parentEntity: "MaybeNumber",
  }],
  ["withSchema", {
    id: "withSchema",
    params: [
      field("typeId", str),
      field("value", { $el: { call: ["schemaOf", { var: "typeId" }] } } as FenelType, 1),
    ],
    returns: bool,
    kind: "function",
  }],
]);

const ctx: AuthoringKernelContext = {
  getFunctionEntry: (id) => fns.get(id),
  resolvePatternConstructor: (name, scrutineeTypeName) => {
    const entry = fns.get(name);
    if (entry?.kind !== "constructor") return { status: "missing" };
    if (
      scrutineeTypeName !== undefined
      && entry.parentEntity !== scrutineeTypeName
    ) return { status: "missing" };
    return {
      status: "resolved",
      targetId: JSON.stringify([entry.parentEntity ?? null, entry.id]),
      params: entry.params,
      returns: entry.returns,
      ...(entry.scheme === undefined ? {} : { scheme: entry.scheme }),
    };
  },
  resolveNamedType: (name) => {
    if (name === "User") return userType;
    if (name === "MaybeNumber") return maybeNumber;
    return undefined;
  },
  resolveTypeRef: (type) =>
    type && typeof type === "object" && "$ref" in type
      ? ctx.resolveNamedType?.(String(type.$ref))
      : undefined,
  examplesForTypeName: (name) => name === "Number" ? [7] : undefined,
  resolveSchemaType: (name) => name === "User" ? ({ $ref: "User" } as FenelType) : undefined,
  catalogTypes: () => [maybeNumber],
};

describe("expression authoring bridge", () => {
  test("round-trips do blocks through marker-backed editor nodes", () => {
    expect(lowerFenel("1\n2")).toEqual({ do: [1, 2] });
  });

  test("round-trips let bindings through marker-backed editor nodes", () => {
    expect(lowerFenel("let x = 1\nx")).toEqual({
      do: [{ let: { x: 1 } }, { var: "x" }],
    });
  });

  test("round-trips match arms through marker-backed editor nodes", () => {
    expect(lowerFenel("case x of\n  _ -> 1")).toEqual({
      match: [{ var: "x" }, 1],
    });
  });

  test("round-trips anonymous records and named-field constructors", () => {
    expect(lowerFenel('{ name = "Ada" }')).toEqual({ name: "Ada" });
    expect(lowerFenel("Just { value = 1 }")).toEqual({
      construct: ["Just", { value: 1 }],
    });
  });

  test("an authoritative negative constructor route keeps uppercase exact ids callable", () => {
    const node: ExprNode = {
      kind: "call",
      fnId: "AuthoringRouteProbe:run",
      args: [],
    };
    expect(exprNodeToLogic(node, {
      fnCodeName: (id) => id,
      constructorName: () => undefined,
    })).toEqual({ call: ["AuthoringRouteProbe:run"] });

    // Registry-less compatibility callers retain the legacy source-shape
    // heuristic used for unindexed constructor tags.
    expect(exprNodeToLogic(node, { fnCodeName: (id) => id })).toEqual({
      construct: ["AuthoringRouteProbe:run"],
    });
  });

  test("round-trips lambdas through the same structural marker path", () => {
    expect(lowerFenel("\\x -> x")).toEqual({ fn: ["x", { var: "x" }] });
  });

  test("round-trips qualified method references through the engine method shape", () => {
    const node = logicToExprNode({
      method: ["Foldable", "foldr", { var: "f" }, 0, { var: "xs" }],
    });
    expect(node).toEqual({
      kind: "call",
      fnId: "Foldable.foldr",
      callSyntax: "method",
      args: [
        { kind: "param", name: "f" },
        { kind: "literal", value: 0 },
        { kind: "param", name: "xs" },
      ],
    });
    expect(exprNodeToLogic(node)).toEqual({
      method: ["Foldable", "foldr", { var: "f" }, 0, { var: "xs" }],
    });
  });

  test("round-trips Fenel-native expression sugar through engine-owned helpers", () => {
    expect(lowerFenel("x + y where y = 1")).toEqual(whereExpression(
      { call: ["add", { var: "x" }, { var: "y" }] },
      [{ name: "y", expr: 1 }],
    ));

    const annotated = parseFenel("(x : List String)") as { ann: [unknown, unknown] };
    expect(exprNodeToLogic(logicToExprNode(annotated))).toEqual(
      annotationExpression({ var: "x" }, annotated.ann[1]),
    );

    expect(lowerFenel("`a ${x} b`")).toEqual(catExpression([
      "a ",
      { var: "x" },
      " b",
    ]));

    expect(lowerFenel("read(String)")).toEqual(readExpression({ type: "string" }));
    expect(lowerFenel('read(Number at "telegram")')).toEqual(
      readExpression({ type: "number" }, "telegram"),
    );

    expect(lowerFenel("lazy { x }")).toEqual(
      evaluatorStrategyExpression("lazy", { var: "x" }),
    );
  });

  test("reads an Evaluator frame whose eval is a function reference as its strategy block", () => {
    // modules-as-values — an instance's `eval` may be a `{$ref: handle}`
    // reference. The strategy is recognised by the canonical id the handle
    // names, so the frame still reads as `lazy {}`.
    const body = { var: "x" };
    const frame = (evalValue: unknown) => ({ typeName: "Evaluator", args: ["LazyStrategy"], methods: { eval: evalValue } });
    const withFrame = (evalValue: unknown) => ({ withInstance: [frame(evalValue), body] });
    const lazyId = "evaluator-strategies:lazyEval";
    const resolve = (name: string): string | undefined =>
      name === "evaluatorStrategies.lazyEval" || name === lazyId ? lazyId : undefined;

    const lazyBlock = logicToExprNode(evaluatorStrategyExpression("lazy", body));
    expect(lazyBlock).toEqual({ kind: "literal", value: { __evaluator: { strategy: "lazy", body: { kind: "param", name: "x" } } } });

    // A reference by the canonical id reads as the block, with or without a resolver.
    expect(evaluatorStrategyFromFrame(frame({ $ref: lazyId }))).toBe("lazy");
    expect(logicToExprNode(withFrame({ $ref: lazyId }))).toEqual(lazyBlock);
    expect(logicToExprNode(withFrame({ $ref: lazyId }), [], resolve)).toEqual(lazyBlock);
    // A dotted handle is compared by the canonical id the resolver gives it.
    expect(evaluatorStrategyFromFrame(frame({ $ref: "evaluatorStrategies.lazyEval" }), resolve)).toBe("lazy");
    expect(logicToExprNode(withFrame({ $ref: "evaluatorStrategies.lazyEval" }), [], resolve)).toEqual(lazyBlock);
    // Round trip: the block lowers back to the strategy frame.
    expect(exprNodeToLogic(logicToExprNode(withFrame({ $ref: lazyId })))).toEqual(
      evaluatorStrategyExpression("lazy", body),
    );

    // Not the lazy block: a handle nobody resolves, a reference to another
    // strategy's function, an inherited `$ref`, and a frame with extra data.
    const generic = (node: ExprNode): boolean =>
      node.kind === "literal" && typeof node.value === "object" && node.value !== null && "__withInstance" in node.value;
    expect(evaluatorStrategyFromFrame(frame({ $ref: "evaluatorStrategies.lazyEval" }))).toBeUndefined();
    expect(generic(logicToExprNode(withFrame({ $ref: "evaluatorStrategies.lazyEval" })))).toBe(true);
    expect(generic(logicToExprNode(withFrame({ $ref: "evaluator-strategies:partialEval" }), [], resolve))).toBe(true);
    expect(evaluatorStrategyFromFrame(frame(Object.create({ $ref: lazyId })))).toBeUndefined();
    expect(generic(logicToExprNode({
      withInstance: [{ ...frame({ $ref: lazyId }), priority: 5 }, body],
    }))).toBe(true);
  });

  test("authors partial application by leaving trailing call slots open", () => {
    const partial = partialCallNode(
      {
        kind: "call",
        fnId: "add",
        args: [
          { kind: "literal", value: 1 },
          { kind: "literal", value: 2 },
        ],
      },
      1,
    );
    expect(partial).toEqual({
      kind: "call",
      fnId: "add",
      args: [{ kind: "literal", value: 1 }],
    });
    expect(exprNodeToLogic(partial)).toEqual({ call: ["add", 1] });
  });

  test("normalizes parser-side Pat* pattern values into match-arm wire patterns", () => {
    expect(normalizeAlgebraicPatternForAuthoring({
      $tag: "PatConstruct",
      ctor: "Just",
      args: [{ $tag: "PatVar", name: "value" }],
      fields: ["_0"],
    }, "adt")).toEqual({ $tag: "Just", _0: { $bind: "value" } });
    expect(normalizeAlgebraicPatternForAuthoring({
      $tag: "PatGuard",
      pat: { $tag: "PatVar", name: "n" },
      cond: { call: ["gt", { var: "n" }, 0] },
    }, "adt")).toEqual({
      $guard: [{ $bind: "n" }, { call: ["gt", { var: "n" }, 0] }],
    });
  });

  test("owns algebraic pattern modes and guard condition conversion", () => {
    expect(ALGEBRAIC_PATTERN_MODES.map((m) => m.mode)).toEqual([
      "wildcard",
      "bind",
      "literal",
      "ctor",
      "record",
      "guard",
    ]);
    expect(patternMode(defaultPatternForMode("wildcard"))).toBe("wildcard");
    expect(patternMode(defaultPatternForMode("bind"))).toBe("bind");
    expect(patternMode(defaultPatternForMode("literal"))).toBe("literal");
    expect(patternMode(defaultPatternForMode("ctor"))).toBe("ctor");
    expect(patternMode(defaultPatternForMode("record"))).toBe("record");
    expect(patternMode(defaultPatternForMode("guard"))).toBe("guard");

    const guarded = parseFenel("case m of\n  Just x | x > 0 -> x");
    expect(exprNodeToLogic(logicToExprNode(guarded))).toEqual(guarded);
  });

  test("single-body match arrays reopen as an explicit wildcard arm", () => {
    const match = matchLogicToAuthoringArms(
      [{ var: "x" }, 1],
      (body) => logicToExprNode(body),
    );
    expect(match).toEqual({
      scrutinee: { var: "x" },
      arms: [{ pattern: "_", body: { kind: "literal", value: 1 }, isDefault: true }],
    });
  });

  test("owns type display, peeling, and record-path expansion with resolver leaves", () => {
    expect(typeDisplayName(List(str))).toBe("List(String)");
    expect(typeDisplayName({ $refined: { base: str, set: { $tag: "SeAll" } } })).toBe("String");
    expect(baseTypeDisplayName({ $opaque: { name: "Email", pure: str } })).toBe("String");
    expect(recordFieldsForType({ $ref: "User" }, ctx)?.map((f) => f.name)).toEqual(["name", "age"]);
    expect(peelToRecordType({ $ref: "User" }, ctx)).toEqual(userType);
    expect(peelToVariantType({ $ref: "MaybeNumber" }, ctx)?.cases.map((c) => c.name)).toEqual([
      "Nothing",
      "Just",
    ]);
    expect(typePhrase(List(Anything))).toBe("A list of anything");
    expect(typeCode(List(Anything))).toBe("List Anything");
    // The Type of Types is a type, never an unspoken (Anything) fallback.
    expect(typePhrase({ $type: true } as FenelType)).toBe("A type");
    expect(typeCode({ $type: true } as FenelType)).toBe("Type");
    expect(typePhrase(List({ $type: true } as FenelType))).toBe("A list of types");
    const placedImages = {
      $el: { call: ["List", { $el: { call: ["Placed", { $ref: "Image" }] } }] },
    } as FenelType;
    expect(typePhrase(placedImages, (name) => name)).toBe("A list of placed images");
    expect(typeCode(placedImages, (name) => name)).toBe("List (Placed Image)");
    expect(typePhrase({ $ref: "Image" }, () => "Image")).toBe("An image");
    expect(typeCode({ $arrow: { params: [{ name: "x", type: num }], returns: { $ref: "Image" } } } as FenelType, (name) => name))
      .toBe("Number -> Image");
    expect(typePhrase({ $arrow: { params: [{ name: "x", type: num }], returns: { $ref: "Image" } } } as FenelType, (name) => name === "Image" ? "Image" : "number"))
      .toBe("A function from a number to an image");
    expect(typePhrase({
      $record: { fields: [
        { name: "sampleRate", type: num, label: Nothing, meta: {}, ui: Nothing },
        { name: "channels", type: num, label: Nothing, meta: {}, ui: Nothing },
        { name: "samples", type: List(num), label: Nothing, meta: {}, ui: Nothing },
      ] },
    } as FenelType)).toBe("An audio buffer");
    expect(expandAuthoringParamPaths([{ name: "user", type: { $ref: "User" } }], ctx)).toEqual([
      { name: "user", type: { $ref: "User" } },
      { name: "user.name", type: str },
      { name: "user.age", type: num },
    ]);
  });

  test("source name grammar preserves normalization, articles and mass nouns", () => {
    const examples = [
      ["", "data", "data", "a data"],
      ["  Entry  ", "entry", "entries", "an entry"],
      ["TaskEntry", "task entry", "task entries", "a task entry"],
      ["task__--entry", "task entry", "task entries", "a task entry"],
      ["Entry2Image", "entry2 image", "entry2 images", "an entry2 image"],
      ["URLValue", "urlvalue", "urlvalues", "an urlvalue"],
      ["new  Entry", "new  entry", "new  entries", "a new  entry"],
      ["_Entry_", " entry ", " entry s", "a  entry "],
      ["Key", "key", "keys", "a key"],
      ["Day", "day", "days", "a day"],
      ["Audio", "audio", "audio", "an audio"],
      ["SoundAudio", "sound audio", "sound audio", "a sound audio"],
      ["DATA", "data", "data", "a data"],
      ["Any", "anything", "anything", "anything"],
      ["Anything", "anything", "anything", "anything"],
      ["Status", "status", "status", "a status"],
      ["ÉchoImage", "écho image", "écho images", "a écho image"],
      ["😀Entry", "😀entry", "😀entries", "a 😀entry"],
      ["Entry😀Name", "entry😀name", "entry😀names", "an entry😀name"],
    ] as const;
    for (const [name, bare, plural, sentence] of examples) {
      expect(dispatchEngineBody("engine:spokenTypeName", [name])).toEqual({ bare, plural, sentence });
    }
  }, 60_000);

  test("shared type phrases pluralize final consonant-y words through nested and compound types", () => {
    for (const [name, expected] of [
      ["Entry", "entries"], ["TaskEntry", "task entries"],
      ["Category", "categories"], ["Key", "keys"], ["Day", "days"],
      ["Audio", "audio"], ["Data", "data"],
    ] as const) {
      expect(typePhrase(List({ $ref: name }))).toBe(`A list of ${expected}`);
    }
    expect(typePhrase(List(List({ $ref: "Entry" })))).toBe("A list of lists of entries");
    expect(typePhrase(List({ $ref: "entry-owner" }), () => "LedgerEntry")).toBe("A list of ledger entries");
    expect(typePhrase({ $ref: "Entry" })).toBe("An entry");
    expect(typePhrase({ $ref: "TaskEntry" })).toBe("A task entry");
  }, 60_000);

  test("owns call-slot metadata and typed seed decisions", () => {
    const partial: Extract<ExprNode, { kind: "call" }> = {
      kind: "call",
      fnId: "add",
      args: [{ kind: "literal", value: 1 }],
    };
    const params = fns.get("add")!.params;
    expect(callSlotMetadata(partial, params)).toEqual({
      activeParamCount: 1,
      openParamCount: 1,
      renderedParams: params.slice(0, 1),
      renderedArgs: [{ index: 0, param: params[0] }],
    });
    expect(seedExprArg(num, ctx)).toEqual({ kind: "literal", value: 7 });
    expect(seedCallArgs(params, ctx)).toEqual([
      { kind: "literal", value: 7 },
      { kind: "literal", value: 7 },
    ]);
    expect(fillNextCallArg(partial, params, ctx)).toEqual({
      kind: "call",
      fnId: "add",
      args: [{ kind: "literal", value: 1 }, { kind: "literal", value: 7 }],
    });
    expect(fillAllCallArgs({ ...partial, args: [] }, params, ctx)).toEqual({
      kind: "call",
      fnId: "add",
      args: [{ kind: "literal", value: 7 }, { kind: "literal", value: 7 }],
    });
    expect(seedRecordFields({ kind: "literal", value: "x" }, [field("age", num)], ctx)).toEqual([
      { name: "age", value: { kind: "literal", value: 7 } },
    ]);
    expect(seedConstructValue({ kind: "literal", value: 1 }, { $ref: "MaybeNumber" }, ctx)).toEqual({
      tag: "Just",
      fields: [{ name: "value", value: { kind: "literal", value: 7 } }],
    });
    expect(seedLambdaNode({ $arrow: { params: [field("x", num)], returns: num } }, ctx)).toEqual({
      kind: "literal",
      value: { __lambda: { params: ["x"], body: { kind: "literal", value: 7 } } },
    });
  });

  test("routes authoring expressions and lexical bindings through Fenel inference", () => {
    const literal = inferAuthoringExpression({ kind: "literal", value: "hello" }, ctx);
    expect(literal.outcome.$tag).toBe("Solved");
    expect(literal.type).toEqual(str);

    expect(inferAuthoringExpressionType(
      { kind: "param", name: "x" },
      { ...ctx, bindings: { x: num } },
    )).toEqual(num);

    expect(inferAuthoringExpressionType({
      kind: "call",
      fnId: "add",
      args: [
        { kind: "literal", value: 1 },
        { kind: "literal", value: 2 },
      ],
    }, ctx)).toEqual(num);
  });

  test("keeps empty-record results identical across direct and let inference", () => {
    const emptyRecord = { $record: { fields: [] } } as FenelType;
    const emptyNode = logicToExprNode({});
    const direct = inferAuthoringExpression(emptyNode, ctx);
    const throughLet = inferAuthoringExpression(logicToExprNode({
      let: { empty: {} },
    }), ctx);

    expect(exprNodeToLogic(emptyNode)).toEqual({});
    expect(direct.outcome.$tag).toBe("Solved");
    expect(throughLet.outcome.$tag).toBe("Solved");
    expect(direct.type).toEqual(emptyRecord);
    expect(throughLet.type).toEqual(direct.type);
    expect(throughLet.scheme?.body).toEqual(direct.scheme?.body);
  }, 180_000);

  test("fences hostile authoring values without executing accessors", () => {
    let getterRuns = 0;
    const hostile = {} as ExprNode;
    Object.defineProperty(hostile, "kind", {
      enumerable: true,
      get() {
        getterRuns++;
        return "literal";
      },
    });

    const result = inferAuthoringExpression(hostile, ctx);
    expect(result.outcome.$tag).toBe("Invalid");
    expect(getterRuns).toBe(0);

    const signature = { params: [] } as unknown as AuthoringFunctionEntry;
    Object.defineProperty(signature, "returns", {
      enumerable: true,
      get() {
        getterRuns++;
        return num;
      },
    });
    const hostileSignature = inferAuthoringExpression(
      { kind: "call", fnId: "hostile", args: [] },
      { getFunctionEntry: () => signature },
    );
    expect(hostileSignature.outcome.$tag).toBe("Invalid");
    expect(getterRuns).toBe(0);

    const cycle: ExprNode = { kind: "ref", savedExprId: "cycle" };
    const cyclicRef = inferAuthoringExpression(cycle, {
      resolveSavedExpr: () => cycle,
    });
    expect(cyclicRef.outcome.$tag).toBe("Invalid");
  });

  test("returns typed Invalid when malformed authoring calls cannot be lowered", () => {
    const malformed: unknown[] = [
      { kind: "call", fnId: "add" },
      { kind: "call", fnId: "add", args: null },
      { kind: "call", fnId: "add", args: {} },
      { kind: "call", fnId: 123, args: [] },
      { kind: "call", fnId: "add", args: [null] },
      { kind: "call", fnId: "add", args: [{ kind: "call", fnId: "add" }] },
      { kind: "literal", value: { __apply: { target: { kind: "param", name: "f" }, args: null } } },
      { kind: "literal", value: { __operator: { op: "if", args: null } } },
    ];
    for (const node of malformed) {
      const result = inferAuthoringExpression(node as ExprNode, ctx);
      expect(result.outcome).toMatchObject({
        $tag: "Invalid",
        diagnostics: [{
          code: "authoring-boundary-invalid",
          functionId: "<authoring-expression>",
          message: "$expression: expression could not be lowered safely",
        }],
      });
      expect(result.type).toBeUndefined();
      expect(result.scheme).toBeUndefined();
    }
  });

  test("fences malformed saved targets and throwing operator resolvers at lowering", () => {
    const malformedSaved = inferAuthoringExpression(
      { kind: "ref", savedExprId: "broken" },
      { ...ctx, resolveSavedExpr: () => ({ kind: "call", fnId: "add" } as ExprNode) },
    );
    expect(malformedSaved.outcome.$tag).toBe("Invalid");
    expect(malformedSaved.type).toBeUndefined();

    const throwingOperator = inferAuthoringExpression(
      { kind: "call", fnId: "op:+", args: [] },
      { ...ctx, resolveOperatorAlias: () => { throw new Error("unavailable operator"); } },
    );
    expect(throwingOperator.outcome.$tag).toBe("Invalid");
    expect(throwingOperator.type).toBeUndefined();
  });

  test("refuses unsupported expression carriers instead of silently lowering them to null", () => {
    for (const carrier of [{}, { kind: "unknown" }, { kind: 123 }]) {
      expect(() => exprNodeToLogic(carrier as ExprNode)).toThrow("Invalid authoring expression kind");
      expect(inferAuthoringExpression(carrier as ExprNode, ctx).outcome).toMatchObject({
        $tag: "Invalid",
        diagnostics: [{ code: "authoring-boundary-invalid" }],
      });
    }
    for (const carrier of [null, undefined]) {
      expect(() => exprNodeToLogic(carrier as unknown as ExprNode)).toThrow(TypeError);
      expect(inferAuthoringExpression(carrier as unknown as ExprNode, ctx).outcome.$tag).toBe("Invalid");
    }
    for (const carrier of [{ kind: "unknown" }, null, undefined]) {
      const nested: ExprNode = { kind: "literal", value: { __list: [carrier] } };
      expect(() => exprNodeToLogic(nested)).toThrow(TypeError);
      expect(inferAuthoringExpression(nested, ctx).outcome.$tag).toBe("Invalid");
    }
    const reference: ExprNode = { kind: "ref", savedExprId: "unknown" };
    const resolver = () => ({ kind: "unknown" } as unknown as ExprNode);
    expect(() => exprNodeToLogic(reference, { resolver })).toThrow("Invalid authoring expression kind");
    expect(inferAuthoringExpression(reference, { ...ctx, resolveSavedExpr: resolver }).outcome.$tag).toBe("Invalid");
  });

  test("preserves literal absence and explicit missing-reference codec outcomes", () => {
    expect(exprNodeToLogic({ kind: "literal", value: undefined })).toBeUndefined();
    expect(exprNodeToLogic({ kind: "literal", value: null })).toBeNull();
    const rawData = { kind: "unknown", value: 7 };
    expect(exprNodeToLogic({ kind: "literal", value: rawData })).toBe(rawData);

    const reference: ExprNode = { kind: "ref", savedExprId: "source" };
    const missing: string[] = [];
    expect(exprNodeToLogic(reference, { onMissingRef: id => missing.push(id) })).toBeNull();
    expect(exprNodeToLogic(reference, { resolver: () => reference, onMissingRef: id => missing.push(id) })).toBeNull();
    expect(missing).toEqual(["source", "source"]);
  });

  test("retains snapshot refusal for cyclic and inherited authoring carriers", () => {
    const cycle: { kind: "call"; fnId: string; args: unknown[] } = { kind: "call", fnId: "add", args: [] };
    cycle.args.push(cycle);
    const cyclic = inferAuthoringExpression(cycle as ExprNode, ctx);
    expect(cyclic.outcome).toMatchObject({
      $tag: "Invalid",
      diagnostics: [{ code: "authoring-boundary-invalid", message: "$expression.args[0]: cyclic value" }],
    });

    let getterRuns = 0;
    const inherited = Object.create({
      get kind() { getterRuns++; return "literal"; },
    });
    inherited.value = 1;
    const result = inferAuthoringExpression(inherited as ExprNode, ctx);
    expect(result.outcome).toMatchObject({
      $tag: "Invalid",
      diagnostics: [{ code: "authoring-boundary-invalid", message: "$expression: non-plain object" }],
    });
    expect(getterRuns).toBe(0);
  });

  test("admits a pasted image literal far above the old 20,000-node snapshot budget", () => {
    // Demo 2: the Expression panel of a pasted image infers its literal. A
    // 100 by 100 RGBA image is 50,000 snapshot nodes (five per pixel).
    const pixels = Array.from({ length: 100 * 100 }, (_, index) => ({
      r: index % 256, g: (index * 7) % 256, b: (index * 13) % 256, a: 255,
    }));
    const image: ExprNode = { kind: "literal", value: { width: 100, height: 100, pixels } };
    const result = inferAuthoringExpression(image, ctx);
    const diagnostics = result.outcome.$tag === "Invalid" ? result.outcome.diagnostics : [];
    // The boundary copies the literal; whatever the Fenel inference kernel
    // then answers for a 10,000-element list literal is its own verdict.
    expect(diagnostics.filter((diagnostic) => diagnostic.code === "authoring-boundary-invalid")).toEqual([]);
    expect(diagnostics.filter((diagnostic) => diagnostic.message.includes("too large"))).toEqual([]);
  }, 600_000);

  test("still refuses a value above the snapshot node budget, naming its path", () => {
    // 3,000 rows of 2,000 numbers: 6,003,001 nodes, over the 6,000,000 budget.
    const rows = Array.from({ length: 3_000 }, () => new Array<number>(2_000).fill(0));
    const result = inferAuthoringExpression({ kind: "literal", value: { rows } }, ctx);
    expect(result.outcome).toMatchObject({
      $tag: "Invalid",
      diagnostics: [{ code: "authoring-boundary-invalid" }],
    });
    const message = result.outcome.$tag === "Invalid" ? result.outcome.diagnostics[0]!.message : "";
    expect(message).toMatch(/^\$expression\.value\.rows\[2\d{3}\]\[\d+\]: value is too large$/);
  }, 600_000);

  test("refuses a value nested deeper than the host stack instead of throwing", () => {
    let deep: unknown = 0;
    for (let depth = 0; depth < 200_000; depth++) deep = [deep];
    const result = inferAuthoringExpression({ kind: "literal", value: deep }, ctx);
    expect(result.outcome).toMatchObject({
      $tag: "Invalid",
      diagnostics: [{ code: "authoring-boundary-invalid", message: "$expression: value is too deeply nested" }],
    });
  });

  test("preserves valid saved and structural authoring inference across lowering", () => {
    const saved = { kind: "literal", value: 2 } as const;
    const call: ExprNode = {
      kind: "call", fnId: "add",
      args: [{ kind: "literal", value: 1 }, { kind: "ref", savedExprId: "two" }],
    };
    expect(inferAuthoringExpressionType(call, {
      ...ctx, resolveSavedExpr: (id) => id === "two" ? saved : undefined,
    })).toEqual(num);

    const structural = logicToExprNode({ do: [{ let: { x: 1 } }, { call: ["add", { var: "x" }, 2] }] });
    const result = inferAuthoringExpression(structural, ctx);
    expect(result.outcome.$tag).toBe("Solved");
    expect(result.type).toEqual(num);
  });

  test("does not read authoring context accessors", () => {
    const contextSlots = [
      "bindings",
      "resolveConstructorTarget",
      "resolveOperatorAlias",
      "resolvePatternConstructor",
      "resolveSavedExpr",
      "getFunctionEntry",
    ] as const satisfies readonly (keyof AuthoringInferenceContext)[];
    for (const slot of contextSlots) {
      let contextGetterRuns = 0;
      const hostileContext = {};
      Object.defineProperty(hostileContext, slot, {
        enumerable: true,
        get() {
          contextGetterRuns++;
          throw new Error(`unexpected ${slot} getter read`);
        },
      });
      const hostileContextResult = inferAuthoringExpression(
        { kind: "literal", value: null },
        hostileContext as AuthoringInferenceContext,
      );
      expect(hostileContextResult.outcome.$tag).toBe("Invalid");
      expect(contextGetterRuns).toBe(0);
    }
  });

  test("routes pattern binding typing through the Fenel inference outcome", () => {
    expect(constructorFieldsForTag("Just", { ...ctx, scrutineeType: { $ref: "MaybeNumber" } })).toEqual([
      field("value", num),
    ]);
    const constructor = inferAuthoringPatternBindings(
      { $tag: "Just", value: { $bind: "n" } },
      { $ref: "MaybeNumber" },
      ctx,
    );
    expect(constructor.outcome.$tag).toBe("Solved");
    expect(constructor.bindings?.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: "n", type: num },
    ]);

    const record = inferAuthoringPatternBindings(
      { name: { $bind: "n" } },
      { $ref: "User" },
      ctx,
    );
    expect(record.outcome.$tag).toBe("AnnotationRequired");
    expect(record.bindings).toBeUndefined();
  });

  test("owns compact expression and pattern summaries", () => {
    expect(summarizeExprNode(
      { kind: "call", fnId: "fn:std:add", args: [{ kind: "literal", value: 1 }] },
      () => "add",
    )).toBe("add(...)");
    expect(summarizeExprNode({
      kind: "literal",
      value: { __record: { fields: [{ name: "a", value: { kind: "literal", value: 1 } }] } },
    })).toBe("{ a }");
    expect(summarizeAuthoringPattern({ $tag: "Just", value: { $bind: "x" } })).toBe("Just { value }");
    expect(summarizeAuthoringPattern({ $guard: ["_", { kind: "literal", value: true }] })).toBe("guard");
  });

  test("collapsed constructor summaries use captured Function names without changing targets", () => {
    const targetId = "@ctor/std/DocInline/DocText";
    const functionId = "12345678-1234-4234-8234-123456789abc";
    const node: ExprNode = { kind: "literal", value: { __construct: {
      tag: targetId, fields: [{ name: "text", value: { kind: "literal", value: "hello" } }],
    } } };
    const retained = structuredClone(node);
    for (const sourceName of ["std.DocInline.DocText", "documents.Inline.Text"]) {
      expect(summarizeExprNode(node, undefined, {
        constructorRoutes: [{ sourceName, targetId, functionId, status: "resolved" }],
        constructorTargets: [{ id: "DocText", targetId, functionId }],
        referenceRoutes: [{ sourceName, targetId: functionId, status: "resolved" }],
      })).toBe(`${sourceName} { ... }`);
    }
    expect(node).toEqual(retained);
  }, 60_000);

  test("collapsed constructor summaries retain real UUID fallback for unnamed or shadowed Functions", () => {
    const targetId = "@ctor/std/DocInline/DocText";
    const functionId = "12345678-1234-4234-8234-123456789abc";
    const node: ExprNode = { kind: "literal", value: { __construct: { tag: targetId, fields: [] } } };
    const constructorTargets = [{ id: "DocText", targetId, functionId }];
    expect(summarizeExprNode(node, undefined, { constructorTargets })).toBe(`@{${functionId}} { ... }`);
    expect(summarizeExprNode(node, undefined, {
      constructorRoutes: [{ sourceName: "std.DocInline.DocText", targetId, functionId, status: "resolved" }],
      constructorTargets,
      referenceRoutes: [{ sourceName: "std.DocInline.DocText", targetId: functionId, status: "resolved" }],
      boundNames: ["std"],
    })).toBe(`@{${functionId}} { ... }`);
  }, 60_000);

  test("collapsed constructor summaries refuse missing ownership and ambiguous source spellings", () => {
    const targetId = "@ctor/std/DocInline/DocText";
    const functionId = "12345678-1234-4234-8234-123456789abc";
    const otherFunctionId = "22345678-1234-4234-8234-123456789abc";
    const node: ExprNode = { kind: "literal", value: { __construct: { tag: targetId, fields: [] } } };
    const diagnostic = "<no surface syntax: constructor unavailable in this scope> { ... }";
    expect(summarizeExprNode(node)).toBe(diagnostic);
    expect(summarizeExprNode(node, undefined, {
      constructorRoutes: [{ sourceName: "std.DocInline.DocText", targetId, status: "resolved" }],
      constructorTargets: [{ id: "DocText", targetId }],
    })).toBe(diagnostic);
    expect(summarizeExprNode(node, undefined, {
      constructorTargets: [{ id: "DocText", targetId, functionId }],
      constructorRoutes: [
        { sourceName: "std.DocInline.DocText", targetId, functionId, status: "resolved" },
        { sourceName: "std.DocInline.DocText", targetId: "@ctor/other/Inline/DocText", functionId: otherFunctionId, status: "resolved" },
      ],
      referenceRoutes: [
        { sourceName: "std.DocInline.DocText", targetId: functionId, status: "resolved" },
        { sourceName: "std.DocInline.DocText", targetId: otherFunctionId, status: "resolved" },
      ],
    })).toBe(`@{${functionId}} { ... }`);
  }, 60_000);

  test("collapsed positional and nullary constructor calls share the named-field summary's scoped name", () => {
    const targetId = "@ctor/std/DocInline/DocText";
    const functionId = "12345678-1234-4234-8234-123456789abc";
    const source = {
      constructorRoutes: [{ sourceName: "std.DocInline.DocText", targetId, functionId, status: "resolved" as const }],
      constructorTargets: [{ id: "DocText", targetId, functionId }],
      referenceRoutes: [{ sourceName: "std.DocInline.DocText", targetId: functionId, status: "resolved" as const }],
    };
    for (const fnId of [targetId, functionId]) {
      const positional: ExprNode = { kind: "call", fnId, args: [{ kind: "literal", value: "hello" }] };
      const nullary: ExprNode = { kind: "call", fnId, args: [] };
      const retained = structuredClone([positional, nullary]);
      expect(summarizeExprNode(positional, () => "unrelated cosmetic name", source)).toBe("std.DocInline.DocText(...)");
      expect(summarizeExprNode(nullary, () => "unrelated cosmetic name", source)).toBe("std.DocInline.DocText()");
      expect(summarizeExprNode(positional, undefined, { ...source, boundNames: ["std"] })).toBe(`@{${functionId}}(...)`);
      expect([positional, nullary]).toEqual(retained);
    }
    expect(summarizeExprNode({ kind: "call", fnId: "std:add", args: [] }, () => "addition", source)).toBe("addition()");
  }, 60_000);

  test("collapsed constructor calls refuse unavailable ownership instead of deriving dot paths", () => {
    const targetId = "@ctor/std/DocInline/DocText";
    const functionId = "12345678-1234-4234-8234-123456789abc";
    const diagnostic = "<no surface syntax: constructor unavailable in this scope>()";
    expect(summarizeExprNode({ kind: "call", fnId: targetId, args: [] }, () => "std.DocInline.DocText")).toBe(diagnostic);
    expect(summarizeExprNode({ kind: "call", fnId: functionId, callSyntax: "construct", args: [] }, () => "std.DocInline.DocText")).toBe(diagnostic);
    expect(summarizeExprNode({ kind: "call", fnId: targetId, args: [] }, undefined, {
      constructorTargets: [{ id: "DocText", targetId, functionId }],
    })).toBe(`@{${functionId}}()`);
  }, 60_000);
});
