import { describe, expect, test } from "bun:test";

import type { CatalogSection } from "./type-catalog";
import { createRegistry, type ModuleRegistry } from "./registry";
import { createDispatchRegistry } from "./dispatch-registry";
import { aiCapabilities, aiProviders } from "./modules/ai";
import {
  authoringScopeForLetBinding,
  buildAuthoringCatalogSnapshot,
  createAuthoringEnvironment,
  effectiveLetBinding,
  type LetBindingDraft,
} from "./authoring/environment";
import {
  exprNodeToLogic,
  inferAuthoringExpression,
  type AuthoringFunctionEntry,
  type AuthoringKernelContext,
} from "./authoring/expression-authoring";
import {
  inferJsonLogicPatternBindings,
  inferJsonLogicType,
  type JsonLogicInferenceOptions,
  type PatternConstructorResolution,
} from "./signature-inference";
import { Maybe, Nothing, Result } from "./type-foundation";
import type {
  FenelFunction,
  FenelType,
  FieldDef,
  TypeScheme,
} from "./types";

const ref = (name: string): FenelType => ({ $ref: name });
const variable = (name: string): FenelType => ({ $var: name });

function positionalField(name: string, index: number, type: FenelType): FieldDef {
  return {
    name,
    key: { $tag: "PositionalField", index },
    type,
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
}

function arrowBody(scheme: TypeScheme): Extract<FenelType, { $arrow: unknown }>["$arrow"] {
  if (!("$arrow" in scheme.body)) {
    throw new Error(`expected arrow scheme, received ${JSON.stringify(scheme.body)}`);
  }
  return scheme.body.$arrow;
}

function monomorphicScheme(
  params: readonly FieldDef[],
  returns: FenelType,
): TypeScheme {
  return {
    quantified: [],
    body: { $arrow: { params: [...params], returns } },
  };
}

function resolvedConstructor(
  targetId: string,
  scheme: TypeScheme,
): PatternConstructorResolution {
  const signature = arrowBody(scheme);
  return {
    status: "resolved",
    targetId,
    params: signature.params,
    returns: signature.returns,
    scheme,
  };
}

function diagnosticCodes(result: ReturnType<typeof inferJsonLogicType>): string[] {
  return result.outcome.$tag === "Solved"
    ? []
    : result.outcome.diagnostics.map(({ code }) => code);
}

describe("authoring signature adversarial regressions", () => {
  test("full constructor-expression inference uses the exact constructor resolver", () => {
    const payload = positionalField("_0", 0, ref("Number"));
    const scheme = monomorphicScheme([payload], ref("Box"));
    const selected: Array<{ name: string; owner: string | undefined }> = [];

    const result = inferJsonLogicType(
      { construct: ["Wrap", 7] },
      {
        resolveFunction: (name) => {
          if (name.startsWith("$ctor:")) {
            throw new Error("constructor reference leaked through resolveFunction");
          }
          return undefined;
        },
        resolvePatternConstructor: (name, owner) => {
          selected.push({ name, owner });
          return name === "Wrap"
            ? resolvedConstructor("box:Box:Wrap", scheme)
            : { status: "missing" };
        },
      },
    );

    expect(result.outcome.$tag).toBe("Solved");
    expect(result.type).toEqual(ref("Box"));
    expect(selected).toEqual([{ name: "Wrap", owner: undefined }]);
  }, 180_000);

  test("full match-expression inference routes constructor patterns exactly", () => {
    const payload = positionalField("_0", 0, ref("String"));
    const scheme = monomorphicScheme([payload], ref("Box"));
    const selected: Array<{ name: string; owner: string | undefined }> = [];

    const result = inferJsonLogicType(
      {
        match: [
          { construct: ["Wrap", "payload"] },
          { $tag: "Wrap", _0: { $bind: "value" } },
          { var: "value" },
        ],
      },
      {
        resolveFunction: (name) => {
          if (name.startsWith("$ctor:")) {
            throw new Error("constructor pattern leaked through resolveFunction");
          }
          return undefined;
        },
        resolvePatternConstructor: (name, owner) => {
          selected.push({ name, owner });
          return name === "Wrap"
            ? resolvedConstructor("box:Box:Wrap", scheme)
            : { status: "missing" };
        },
      },
    );

    expect(result.outcome.$tag).toBe("Solved");
    expect(result.type).toEqual(ref("String"));
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every(({ name, owner }) => name === "Wrap" && owner === undefined)).toBeTrue();
  }, 180_000);

  test("full match-expression routing uses the scrutinee's exact nominal owner", () => {
    const constructorScheme = (identity: string): TypeScheme => ({
      quantified: [],
      body: { $arrow: { params: [], returns: ref("Shared") } },
      nominals: [{
        path: ["$arrow", "returns"],
        identity,
        publicName: "Shared",
      }],
    });
    const left = constructorScheme("left::Shared");
    const right = constructorScheme("right::Shared");
    const subject: TypeScheme = {
      quantified: [],
      body: ref("Shared"),
      nominals: [{ path: [], identity: "left::Shared", publicName: "Shared" }],
    };
    const selected: Array<{
      name: string;
      owner: string | undefined;
      ownerIdentity: string | undefined;
    }> = [];

    const result = inferJsonLogicType(
      {
        match: [
          { var: "subject" },
          { $tag: "Dup" },
          "matched",
        ],
      },
      {
        bindings: { subject },
        resolvePatternConstructor: (name, owner, ownerIdentity) => {
          selected.push({ name, owner, ownerIdentity });
          if (name !== "Dup") return { status: "missing" };
          if (ownerIdentity === "left::Shared") {
            return resolvedConstructor("left:Shared:Dup", left);
          }
          if (ownerIdentity === "right::Shared") {
            return resolvedConstructor("right:Shared:Dup", right);
          }
          return { status: "ambiguous" };
        },
      },
    );

    expect(result.outcome.$tag).toBe("Solved");
    expect(result.type).toEqual(ref("String"));
    expect(selected).toEqual([{
      name: "Dup",
      owner: "Shared",
      ownerIdentity: "left::Shared",
    }]);
  }, 180_000);

  test("operator aliases retain the authoritative scheme and underlying target", () => {
    const params = [
      positionalField("left", 0, ref("Number")),
      positionalField("right", 1, ref("Number")),
    ];
    const scheme = monomorphicScheme(params, ref("Number"));
    const fn: FenelFunction = {
      id: "math:add",
      params,
      returns: ref("Number"),
    };
    const sections: CatalogSection[] = [{
      id: "function",
      label: "Functions",
      description: "operator regression fixtures",
      entries: [{
        id: fn.id,
        name: "Add",
        description: "Add two numbers",
        category: "function",
        fn,
        scheme,
      }],
    }];
    const snapshot = buildAuthoringCatalogSnapshot(sections, {
      codeNameFor: () => "add",
      operatorInstances: [{ args: [fn.id], methods: { notation: "+" } }],
    });
    const operator = snapshot.functions.find(({ id }) => id === "op:+");

    expect(operator?.scheme).toEqual(scheme);
    expect(operator?.targetId).toBe(fn.id);

    const inferred = inferAuthoringExpression(
      {
        kind: "call",
        fnId: "op:+",
        args: [
          { kind: "literal", value: 2 },
          { kind: "literal", value: 3 },
        ],
      },
      createAuthoringEnvironment(snapshot),
    );
    expect(inferred.outcome.$tag).toBe("Solved");
    expect(inferred.type).toEqual(ref("Number"));
  }, 180_000);

  test("production-shaped capability providers use the Fenel interface scheme", () => {
    const dispatch = createDispatchRegistry();
    const ai = aiCapabilities[0]!;
    dispatch.defineClass(ai);
    for (const provider of aiProviders) dispatch.addInstance(provider);
    const registry = createRegistry([{
      name: "capability-authoring-probe",
      label: "Capability authoring probe",
      entities: [],
      functions: [],
      instances: [],
    }], { dispatchRegistry: dispatch });

    // The selected OpenAI provider is intentionally a handler-key string, not
    // a registered FenelFunction. Method typing must therefore come from the
    // interface record scheme and must not depend on function-map resolution.
    expect(registry.resolveCapabilityMethod("AI.complete")?.spec).toBe(
      "AI.openai.complete",
    );
    expect(registry.getIdentifiedFunction("AI.complete")).toBeUndefined();
    const signature = registry.getCapabilityMethodSignature("AI.complete");
    expect(signature?.outcome.$tag).toBe("Solved");
    expect(signature?.scheme).toBeDefined();
    expect(signature?.params).toHaveLength(4);

    const snapshot = buildAuthoringCatalogSnapshot([], {
      registry,
      interfaces: [ai],
      capabilityMethodOwners: [ai.name],
    });
    const entry = snapshot.functions.find(({ id }) => id === "AI.complete");
    expect(entry?.scheme).toBe(signature?.scheme);
    const inferred = inferAuthoringExpression({
      kind: "call",
      fnId: "AI.complete",
      args: [{ kind: "literal", value: "hello" }],
    }, createAuthoringEnvironment(snapshot));
    expect(inferred.outcome.$tag).toBe("Solved");
    expect(inferred.type && "$arrow" in inferred.type).toBe(true);
    if (inferred.type && "$arrow" in inferred.type) {
      expect(inferred.type.$arrow.params).toHaveLength(3);
    }
  }, 600_000);

  test("solved higher-kinded schemes survive bindings and authoring let scopes", () => {
    const kType = { $tag: "KType" } as const;
    const k1 = { $tag: "KArrow", input: kType, output: kType } as const;
    const applied: FenelType = { $el: { call: ["f", variable("a")] } };
    const scheme: TypeScheme = {
      quantified: [
        { id: "qf", sourceName: "f", kind: k1 },
        { id: "qa", sourceName: "a", kind: kType },
      ],
      body: { $arrow: { params: [], returns: applied } },
      applications: [{
        path: ["$arrow", "returns"],
        headVarId: "qf",
        args: [variable("a")],
        kind: k1,
      }],
    };
    const entry: AuthoringFunctionEntry = {
      id: "poly:makeApplied",
      targetId: "poly:makeApplied",
      params: [],
      returns: applied,
      scheme,
      kind: "function",
    };
    const ctx: AuthoringKernelContext = {
      getFunctionEntry: (id) => id === entry.id ? entry : undefined,
    };
    const expression = {
      kind: "call" as const,
      fnId: entry.id,
      args: [],
    };
    const inferred = inferAuthoringExpression(expression, ctx);

    expect(inferred.outcome.$tag).toBe("Solved");
    expect(inferred.scheme?.applications?.[0]?.path).toEqual([]);
    expect(inferred.scheme?.applications?.[0]?.kind).toEqual(k1);

    const reused = inferJsonLogicType(
      { var: "higher" },
      { bindings: { higher: inferred.scheme! } },
    );
    expect(reused.outcome.$tag).toBe("Solved");
    expect(reused.scheme?.applications?.[0]?.kind).toEqual(k1);

    const bindings: LetBindingDraft[] = [
      { name: "higher", expr: expression },
      { name: "after", expr: { kind: "literal", value: null } },
    ];
    const effective = effectiveLetBinding(bindings, 0, [], ctx);
    expect(effective?.scheme?.applications?.[0]?.kind).toEqual(k1);
    const scope = authoringScopeForLetBinding(bindings, 1, [], ctx);
    const transported = scope.find(({ name }) => name === "higher");
    expect(transported?.scheme?.applications?.[0]?.path).toEqual([]);
    expect(transported?.scheme?.applications?.[0]?.kind).toEqual(k1);
  }, 180_000);

  test("pattern binding schemes survive the public result and can be reused", () => {
    const kType = { $tag: "KType" } as const;
    const k1 = { $tag: "KArrow", input: kType, output: kType } as const;
    const boxOfString: FenelType = { $el: { call: ["Box", ref("String")] } };
    const scrutinee: TypeScheme = {
      quantified: [],
      body: boxOfString,
      applications: [{
        path: [],
        headRef: "Box",
        args: [ref("String")],
        kind: k1,
      }],
    };

    const pattern = inferJsonLogicPatternBindings({ $bind: "boxed" }, scrutinee);
    expect(pattern.outcome.$tag).toBe("Solved");
    expect(pattern.bindings?.[0]?.scheme.applications?.[0]?.kind).toEqual(k1);

    const binding = pattern.bindings?.[0];
    if (binding === undefined) throw new Error("expected boxed pattern binding");
    const reused = inferJsonLogicType(
      { var: "boxed" },
      { bindings: { boxed: binding.scheme } },
    );
    expect(reused.outcome.$tag).toBe("Solved");
    expect(reused.type).toEqual(boxOfString);
    expect(reused.scheme?.applications?.[0]?.kind).toEqual(k1);
  }, 180_000);

  test("system Maybe/Result constructor applications bridge their canonical structural schemes only", () => {
    const kType = { $tag: "KType" } as const;
    const k1 = { $tag: "KArrow", input: kType, output: kType } as const;
    const k2 = { $tag: "KArrow", input: kType, output: k1 } as const;
    const applied = (head: string, args: readonly FenelType[]): FenelType => ({
      $el: { call: [head, ...args] },
    });
    const maybeA = applied("Maybe", [variable("a")]);
    const resultEA = applied("Result", [variable("e"), variable("a")]);
    const justPayload = positionalField("_0", 0, variable("a"));
    const okPayload = positionalField("_0", 0, variable("a"));
    const maybeScheme = (identity: string): TypeScheme => ({
      quantified: [{ id: "maybe:q0", sourceName: "a", kind: kType }],
      body: { $arrow: { params: [justPayload], returns: maybeA } },
      applications: [{
        path: ["$arrow", "returns"],
        headRef: "Maybe",
        args: [variable("a")],
        kind: k1,
      }],
      nominals: [{
        path: ["$arrow", "returns"],
        identity,
        publicName: "Maybe",
      }],
    });
    const resultScheme: TypeScheme = {
      quantified: [
        { id: "result:q0", sourceName: "e", kind: kType },
        { id: "result:q1", sourceName: "a", kind: kType },
      ],
      body: { $arrow: { params: [okPayload], returns: resultEA } },
      applications: [{
        path: ["$arrow", "returns"],
        headRef: "Result",
        args: [variable("e"), variable("a")],
        kind: k2,
      }],
      nominals: [{
        path: ["$arrow", "returns"],
        identity: '["system","Result"]',
        publicName: "Result",
      }],
    };
    const systemMaybeScheme = maybeScheme('["system","Maybe"]');
    const customMaybeScheme = maybeScheme('["custom","Maybe"]');
    const acceptMaybeParam = positionalField("_0", 0, Maybe(ref("Number")));
    const acceptResultParam = positionalField(
      "_0",
      0,
      Result(ref("String"), ref("Number")),
    );
    const acceptMaybe = monomorphicScheme([acceptMaybeParam], ref("String"));
    const acceptResult = monomorphicScheme([acceptResultParam], ref("String"));
    const options: JsonLogicInferenceOptions = {
      resolvePatternConstructor: (name) => name === "Just"
        ? resolvedConstructor("system:Maybe:Just", systemMaybeScheme)
        : name === "Ok"
        ? resolvedConstructor("system:Result:Ok", resultScheme)
        : name === "CustomJust"
        ? resolvedConstructor("custom:Maybe:CustomJust", customMaybeScheme)
        : { status: "missing" },
      resolveFunction: (name) => name === "acceptMaybe"
        ? {
            params: [acceptMaybeParam],
            returns: ref("String"),
            scheme: acceptMaybe,
            targetId: "consumer:acceptMaybe",
          }
        : name === "acceptResult"
        ? {
            params: [acceptResultParam],
            returns: ref("String"),
            scheme: acceptResult,
            targetId: "consumer:acceptResult",
          }
        : undefined,
    };

    const just = inferJsonLogicType({ construct: ["Just", 1] }, options);
    expect(just.outcome.$tag).toBe("Solved");
    expect(just.type).toEqual(applied("Maybe", [ref("Number")]));
    expect(just.scheme?.nominals).toEqual([{
      path: ["$el", "call", "1"],
      identity: '["system","Number"]',
      publicName: "Number",
    }, {
      path: [],
      identity: '["system","Maybe"]',
      publicName: "Maybe",
    }]);
    expect(inferJsonLogicType({
      call: ["acceptMaybe", { construct: ["Just", 1] }],
    }, options).outcome.$tag).toBe("Solved");
    expect(inferJsonLogicType({
      call: ["acceptResult", { construct: ["Ok", 1] }],
    }, options).outcome.$tag).toBe("Solved");

    const custom = inferJsonLogicType({
      call: ["acceptMaybe", { construct: ["CustomJust", 1] }],
    }, options);
    expect(custom.outcome.$tag).toBe("Invalid");
    expect(diagnosticCodes(custom)).toContain("inference.constructor-mismatch");
  }, 180_000);

  test("duplicate constructor authoring uses qualified or target identity and never a bare first hit", () => {
    const constructorScheme = (identity: string): TypeScheme => ({
      quantified: [],
      body: { $arrow: { params: [], returns: ref("Shared") } },
      nominals: [{
        path: ["$arrow", "returns"],
        identity,
        publicName: "Shared",
      }],
    });
    const leftTarget = "@ctor/left/Shared/Dup";
    const rightTarget = "@ctor/right/Shared/Dup";
    const leftScheme = constructorScheme("left::Shared");
    const rightScheme = constructorScheme("right::Shared");
    const registry = {
      listConstructorSignatures: () => [{
        name: "Dup",
        targetId: leftTarget,
        ownerIdentity: "left::Shared",
        ownerName: "Shared",
        ownerModule: "left",
        params: [],
        returns: ref("Shared"),
        scheme: leftScheme,
        outcome: { $tag: "Solved" as const },
      }, {
        name: "Dup",
        targetId: rightTarget,
        ownerIdentity: "right::Shared",
        ownerName: "Shared",
        ownerModule: "right",
        params: [],
        returns: ref("Shared"),
        scheme: rightScheme,
        outcome: { $tag: "Solved" as const },
      }],
    } as unknown as ModuleRegistry;
    const snapshot = buildAuthoringCatalogSnapshot([], { registry });

    const constructorEntries = snapshot.functions.filter(({ kind }) => kind === "constructor");
    expect(constructorEntries.map(({ id }) => id).sort()).toEqual([
      leftTarget,
      rightTarget,
    ]);
    expect(snapshot.patternConstructors?.map(({ id }) => id)).toEqual(["Dup", "Dup"]);

    const acceptParam = positionalField("value", 0, ref("Shared"));
    const acceptLeftScheme: TypeScheme = {
      quantified: [],
      body: { $arrow: { params: [acceptParam], returns: ref("String") } },
      nominals: [{
        path: ["$arrow", "params", "0", "type"],
        identity: "left::Shared",
        publicName: "Shared",
      }],
    };
    snapshot.functions.push({
      id: "acceptLeft",
      label: "acceptLeft",
      description: "accept the left nominal owner only",
      params: [acceptParam],
      returns: ref("String"),
      scheme: acceptLeftScheme,
      kind: "function",
    });
    const env = createAuthoringEnvironment(snapshot);

    expect(env.resolveFunctionId("Dup")).toBeUndefined();
    expect(env.resolveFunctionId("left.Dup")).toBe(leftTarget);
    expect(env.resolveFunctionId("right:Dup")).toBe(rightTarget);
    expect(env.getFunctionEntry?.(leftTarget)?.scheme).toEqual(leftScheme);
    expect(env.getFunctionEntry?.(rightTarget)?.scheme).toEqual(rightScheme);
    expect(env.constructorCodeName(leftTarget)).toBe(leftTarget);
    expect(exprNodeToLogic(
      { kind: "call", fnId: leftTarget, args: [] },
      { constructorName: env.constructorCodeName },
    )).toEqual({ construct: [leftTarget] });
    // A `__construct` literal is the explicit record spelling `T {}`; the
    // nullary construction is the construct-syntax call with no arguments.
    expect(exprNodeToLogic({
      kind: "literal",
      value: { __construct: { tag: rightTarget, fields: [] } },
    }, {
      constructorName: env.constructorCodeName,
    })).toEqual({ construct: [rightTarget, {}] });
    expect(exprNodeToLogic(
      { kind: "call", fnId: rightTarget, callSyntax: "construct", args: [] },
      { constructorName: env.constructorCodeName },
    )).toEqual({ construct: [rightTarget] });

    const ambiguous = inferAuthoringExpression(
      {
        kind: "literal",
        value: { __construct: { tag: "Dup", fields: [] } },
      },
      env,
    );
    expect(ambiguous.outcome.$tag).toBe("AnnotationRequired");
    if (ambiguous.outcome.$tag === "AnnotationRequired") {
      expect(ambiguous.outcome.diagnostics.map(({ code }) => code)).toContain(
        "inference.ambiguous-call",
      );
    }

    const qualified = inferAuthoringExpression(
      { kind: "call", fnId: "left.Dup", args: [] },
      env,
    );
    expect(qualified.outcome.$tag).toBe("Solved");
    expect(qualified.scheme?.nominals).toEqual([{
      path: [],
      identity: "left::Shared",
      publicName: "Shared",
    }]);

    const exactTarget = inferAuthoringExpression(
      { kind: "call", fnId: rightTarget, callSyntax: "construct", args: [] },
      env,
    );
    expect(exactTarget.outcome.$tag).toBe("Solved");
    expect(exactTarget.scheme?.nominals).toEqual([{
      path: [],
      identity: "right::Shared",
      publicName: "Shared",
    }]);

    const mismatch = inferAuthoringExpression({
      kind: "call",
      fnId: "acceptLeft",
      args: [{ kind: "call", fnId: rightTarget, args: [] }],
    }, env);
    expect(mismatch.outcome.$tag).toBe("Invalid");
    expect(diagnosticCodes(mismatch)).toContain("inference.nominal-mismatch");
  }, 180_000);

  test("duplicate public constructor owners retain distinct nominal identities", () => {
    const constructorScheme = (identity: string): TypeScheme => ({
      quantified: [],
      body: { $arrow: { params: [], returns: ref("Shared") } },
      nominals: [{
        path: ["$arrow", "returns"],
        identity,
        publicName: "Shared",
      }],
    });
    const leftScheme = constructorScheme("left::Shared");
    const rightScheme = constructorScheme("right::Shared");
    const resolvePatternConstructor: JsonLogicInferenceOptions["resolvePatternConstructor"] =
      (name) => name === "LeftShared"
        ? resolvedConstructor("left:Shared:LeftShared", leftScheme)
        : name === "RightShared"
        ? resolvedConstructor("right:Shared:RightShared", rightScheme)
        : { status: "missing" };

    const left = inferJsonLogicType(
      { construct: ["LeftShared"] },
      { resolvePatternConstructor },
    );
    const right = inferJsonLogicType(
      { construct: ["RightShared"] },
      { resolvePatternConstructor },
    );
    expect(left.outcome.$tag).toBe("Solved");
    expect(right.outcome.$tag).toBe("Solved");
    expect(left.type).toEqual(ref("Shared"));
    expect(right.type).toEqual(ref("Shared"));
    expect(left.scheme?.nominals).toEqual([{
      path: [],
      identity: "left::Shared",
      publicName: "Shared",
    }]);
    expect(right.scheme?.nominals).toEqual([{
      path: [],
      identity: "right::Shared",
      publicName: "Shared",
    }]);

    const value = positionalField("value", 0, ref("Shared"));
    const acceptLeft: TypeScheme = {
      quantified: [],
      body: { $arrow: { params: [value], returns: ref("String") } },
      nominals: [{
        path: ["$arrow", "params", "0", "type"],
        identity: "left::Shared",
        publicName: "Shared",
      }],
    };
    const mismatch = inferJsonLogicType(
      { call: ["acceptLeft", { construct: ["RightShared"] }] },
      {
        resolvePatternConstructor,
        resolveFunction: (name) => name === "acceptLeft"
          ? {
              params: [value],
              returns: ref("String"),
              scheme: acceptLeft,
              targetId: "consumer:acceptLeft",
            }
          : undefined,
      },
    );
    expect(mismatch.outcome.$tag).toBe("Invalid");
    expect(diagnosticCodes(mismatch)).toContain("inference.nominal-mismatch");
  }, 180_000);
});
