import { describe, expect, test } from "bun:test";

import { createAuthoringEnvironment } from "./authoring/environment";
import {
  inferJsonLogicPatternBindings,
  type JsonLogicInferenceOptions,
  type PatternConstructorResolution,
} from "./signature-inference";
import { Nothing } from "./type-foundation";
import type { FieldDef, FenelType, TypeScheme } from "./types";

const ref = (name: string): FenelType => ({ $ref: name });

function namedField(name: string, handle: string, type: FenelType): FieldDef {
  return {
    name,
    key: { $tag: "NamedField", ref: { $ref: handle } },
    type,
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
}

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

function resolvedConstructor(
  targetId: string,
  params: readonly FieldDef[],
  returns: FenelType,
): PatternConstructorResolution {
  const scheme: TypeScheme = {
    quantified: [],
    body: { $arrow: { params: [...params], returns } },
  };
  return { status: "resolved", targetId, params, returns, scheme };
}

describe("Fenel-owned authoring pattern inference", () => {
  test("publishes top-level and guarded bindings, while wildcard binds nothing", () => {
    const direct = inferJsonLogicPatternBindings({ $bind: "value" }, ref("String"));
    expect(direct.outcome.$tag).toBe("Solved");
    expect(direct.bindings?.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: "value", type: ref("String") },
    ]);

    const guarded = inferJsonLogicPatternBindings(
      { $guard: [{ $bind: "value" }, true] },
      ref("Number"),
    );
    expect(guarded.outcome.$tag).toBe("Solved");
    expect(guarded.bindings?.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: "value", type: ref("Number") },
    ]);

    const wildcard = inferJsonLogicPatternBindings("_", ref("String"));
    expect(wildcard.outcome.$tag).toBe("Solved");
    expect(wildcard.bindings).toEqual([]);

    const underdetermined = inferJsonLogicPatternBindings({ $bind: "unknown" }, undefined);
    expect(underdetermined.outcome.$tag).toBe("AnnotationRequired");
    if (underdetermined.outcome.$tag === "AnnotationRequired") {
      expect(underdetermined.outcome.diagnostics.map(({ code }) => code)).toContain(
        "inference.pattern-underdetermined",
      );
    }
    expect(underdetermined.bindings).toBeUndefined();
  }, 30_000);

  test("aligns permuted named constructor patterns by FieldKey deterministically", () => {
    const leftKey = "11111111-1111-4111-8111-111111111111";
    const rightKey = "22222222-2222-4222-8222-222222222222";
    const params = [
      namedField("left", leftKey, ref("Number")),
      namedField("right", rightKey, ref("String")),
    ];
    const options: JsonLogicInferenceOptions = {
      resolvePatternConstructor: (name) => name === "Pair"
        ? resolvedConstructor("pair:Pair", params, ref("PairType"))
        : { status: "missing" },
    };

    const leftFirst = inferJsonLogicPatternBindings(
      { $tag: "Pair", left: { $bind: "number" }, right: { $bind: "string" } },
      ref("PairType"),
      options,
    );
    const rightFirst = inferJsonLogicPatternBindings(
      { $tag: "Pair", right: { $bind: "string" }, left: { $bind: "number" } },
      ref("PairType"),
      options,
    );

    expect(leftFirst.outcome.$tag).toBe("Solved");
    expect(rightFirst).toEqual(leftFirst);
    expect(leftFirst.bindings?.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: "number", type: ref("Number") },
      { name: "string", type: ref("String") },
    ]);
    expect(JSON.stringify(leftFirst)).not.toContain("ItMeta");
    expect(JSON.stringify(leftFirst)).not.toContain("?m:");
  });

  test("admits partial named constructor patterns while resolving every supplied FieldKey", () => {
    const leftKey = "11111111-1111-4111-8111-111111111111";
    const rightKey = "22222222-2222-4222-8222-222222222222";
    const returns = ref("PairType");
    const params = [
      namedField("left", leftKey, ref("Number")),
      namedField("right", rightKey, ref("String")),
    ];
    const result = inferJsonLogicPatternBindings(
      { $tag: "Pair", left: { $bind: "number" } },
      returns,
      {
        resolvePatternConstructor: (name) => name === "Pair"
          ? resolvedConstructor("pair:Pair", params, returns)
          : { status: "missing" },
      },
    );

    expect(result.outcome.$tag).toBe("Solved");
    expect(result.bindings?.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: "number", type: ref("Number") },
    ]);
    expect(JSON.stringify(result)).not.toContain("ItMeta");
    expect(JSON.stringify(result)).not.toContain("?m:");
  });

  test("admits validated lock-less SourceHandles for constructor pattern fields", () => {
    const valueType = ref("String");
    const returns = ref("SourcePair");
    const valid = namedField(
      "value",
      "field:type%3ASourcePair/named%3Avalue",
      valueType,
    );
    const solved = inferJsonLogicPatternBindings(
      { $tag: "SourcePair", value: { $bind: "value" } },
      returns,
      {
        resolvePatternConstructor: () => resolvedConstructor(
          "source:SourcePair",
          [valid],
          returns,
        ),
      },
    );
    expect(solved.outcome.$tag).toBe("Solved");
    expect(solved.bindings?.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: "value", type: valueType },
    ]);

    for (const malformed of [
      "field:owner//named%3Avalue",
      "field:owner/named%ZZvalue",
      "field:owner",
      "field:type:owner/named:value",
    ]) {
      const rejected = inferJsonLogicPatternBindings(
        { $tag: "SourcePair", value: { $bind: "value" } },
        returns,
        {
          resolvePatternConstructor: () => resolvedConstructor(
            "source:SourcePair",
            [namedField("value", malformed, valueType)],
            returns,
          ),
        },
      );
      expect(rejected.outcome.$tag).toBe("Invalid");
      expect(rejected.bindings).toBeUndefined();
    }
  }, 30_000);

  test("transports an authoritative higher-kinded pattern scrutinee scheme", () => {
    const kType = { $tag: "KType" } as const;
    const boxKind = { $tag: "KArrow", input: kType, output: kType } as const;
    const boxOf = (type: FenelType): FenelType => ({ $el: { call: ["Box", type] } });
    const payload = positionalField("_0", 0, { $var: "a" });
    const constructorScheme: TypeScheme = {
      quantified: [{ id: "q0", sourceName: "a", kind: kType }],
      body: {
        $arrow: {
          params: [payload],
          returns: boxOf({ $var: "a" }),
        },
      },
      applications: [{
        path: ["$arrow", "returns"],
        headRef: "Box",
        args: [{ $var: "a" }],
        kind: boxKind,
      }],
    };
    const scrutineeScheme: TypeScheme = {
      quantified: [],
      body: boxOf(ref("String")),
      applications: [{
        path: [],
        headRef: "Box",
        args: [ref("String")],
        kind: boxKind,
      }],
    };
    let selectedOwner: string | undefined;
    const result = inferJsonLogicPatternBindings(
      { $tag: "Wrap", _0: { $bind: "value" } },
      scrutineeScheme,
      {
        resolvePatternConstructor: (name, owner) => {
          selectedOwner = owner;
          return name === "Wrap" && owner === "Box"
            ? {
                status: "resolved",
                targetId: "box:Wrap",
                params: [payload],
                returns: boxOf({ $var: "a" }),
                scheme: constructorScheme,
              }
            : { status: "missing" };
        },
      },
    );
    expect(selectedOwner).toBe("Box");
    expect(result.outcome.$tag).toBe("Solved");
    expect(result.bindings?.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: "value", type: ref("String") },
    ]);
  });

  test("uses exact scrutinee ownership and fences an ambiguous bare constructor", () => {
    const payloadA = positionalField("_0", 0, ref("Number"));
    const payloadB = positionalField("_0", 0, ref("String"));
    const constructor = (
      id: string,
      parentEntity: string,
      payload: FieldDef,
      parentModule?: string,
      ownerIdentity?: string,
    ) => {
      const scheme: TypeScheme = {
        quantified: [],
        body: { $arrow: { params: [payload], returns: ref(parentEntity) } },
        ...(ownerIdentity === undefined
          ? {}
          : {
              nominals: [{
                path: ["$arrow", "returns"],
                identity: ownerIdentity,
                publicName: parentEntity,
              }],
            }),
      };
      return {
        id,
        label: id,
        description: "duplicate constructor fixture",
        params: [payload],
        returns: ref(parentEntity),
        scheme,
        kind: "constructor" as const,
        parentEntity,
        ...(parentModule === undefined ? {} : { parentModule }),
        ...(ownerIdentity === undefined ? {} : { ownerIdentity }),
      };
    };
    const env = createAuthoringEnvironment({
      types: [],
      functions: [],
      patternConstructors: [
        constructor("Dup", "OwnerA", payloadA),
        constructor("Dup", "OwnerB", payloadB),
        constructor("Outer", "OuterType", positionalField("_0", 0, ref("InnerType"))),
        constructor("Only", "InnerType", positionalField("_0", 0, ref("Number"))),
      ],
      capabilities: [],
      catalogTypes: [],
      operatorCodeNameByNotation: new Map(),
    });

    const exact = inferJsonLogicPatternBindings(
      { $tag: "Dup", _0: { $bind: "payload" } },
      ref("OwnerA"),
      env,
    );
    expect(exact.outcome.$tag).toBe("Solved");
    expect(exact.bindings?.[0]?.type).toEqual(ref("Number"));

    const ambiguous = inferJsonLogicPatternBindings(
      { $tag: "Dup", _0: { $bind: "payload" } },
      undefined,
      env,
    );
    expect(ambiguous.outcome.$tag).toBe("AnnotationRequired");
    if (ambiguous.outcome.$tag === "AnnotationRequired") {
      expect(ambiguous.outcome.diagnostics.map(({ code }) => code)).toContain(
        "inference.ambiguous-call",
      );
    }
    expect(ambiguous.bindings).toBeUndefined();

    const nested = inferJsonLogicPatternBindings(
      { $tag: "Outer", _0: { $tag: "Only", _0: { $bind: "nested" } } },
      ref("OuterType"),
      env,
    );
    expect(nested.outcome.$tag).toBe("Solved");
    expect(nested.bindings?.[0]?.type).toEqual(ref("Number"));

    const sameIdOwners = createAuthoringEnvironment({
      types: [],
      functions: [],
      patternConstructors: [
        constructor("Dup", "Shared", payloadA, "left", "left::Shared"),
        constructor("Dup", "Shared", payloadB, "right", "right::Shared"),
      ],
      capabilities: [],
      catalogTypes: [],
      operatorCodeNameByNotation: new Map(),
    });
    const sameIdExact = inferJsonLogicPatternBindings(
      { $tag: "Dup", _0: { $bind: "payload" } },
      {
        quantified: [],
        body: ref("Shared"),
        nominals: [{ path: [], identity: "left::Shared", publicName: "Shared" }],
      },
      sameIdOwners,
    );
    expect(sameIdExact.outcome.$tag).toBe("Solved");
    expect(sameIdExact.bindings?.[0]?.type).toEqual(ref("Number"));

    const sameIdAmbiguous = inferJsonLogicPatternBindings(
      { $tag: "Dup", _0: { $bind: "payload" } },
      ref("Shared"),
      sameIdOwners,
    );
    expect(sameIdAmbiguous.outcome.$tag).toBe("AnnotationRequired");
    if (sameIdAmbiguous.outcome.$tag === "AnnotationRequired") {
      expect(sameIdAmbiguous.outcome.diagnostics.map(({ code }) => code)).toContain(
        "inference.ambiguous-call",
      );
    }
  });

  test("fences plain record patterns instead of manufacturing field types", () => {
    const record = inferJsonLogicPatternBindings(
      { name: { $bind: "name" } },
      {
        $record: {
          fields: [namedField(
            "name",
            "33333333-3333-4333-8333-333333333333",
            ref("String"),
          )],
        },
      },
    );
    expect(record.outcome.$tag).toBe("AnnotationRequired");
    if (record.outcome.$tag === "AnnotationRequired") {
      expect(record.outcome.diagnostics.map(({ code }) => code)).toContain(
        "inference.pattern-shape",
      );
    }
    expect(record.bindings).toBeUndefined();
  });

  test("rejects constructor fields without semantic FieldKeys", () => {
    const keyless = {
      name: "_0",
      type: ref("String"),
      label: Nothing,
      ui: Nothing,
      meta: {},
    } as FieldDef;
    const result = inferJsonLogicPatternBindings(
      { $tag: "Keyless", _0: { $bind: "payload" } },
      ref("KeylessType"),
      {
        resolvePatternConstructor: () => resolvedConstructor(
          "keyless:Keyless",
          [keyless],
          ref("KeylessType"),
        ),
      },
    );
    expect(result.outcome.$tag).toBe("Invalid");
    expect(result.bindings).toBeUndefined();
  });

  test("rejects hostile patterns and constructor signatures without executing accessors", () => {
    let getterRuns = 0;
    const hostilePattern: Record<string, unknown> = {};
    Object.defineProperty(hostilePattern, "$bind", {
      enumerable: true,
      get() {
        getterRuns++;
        return "value";
      },
    });
    const hostilePatternResult = inferJsonLogicPatternBindings(
      hostilePattern,
      ref("String"),
    );
    expect(hostilePatternResult.outcome.$tag).toBe("Invalid");
    expect(getterRuns).toBe(0);

    const cycle: Record<string, unknown> = { $tag: "Loop" };
    cycle.self = cycle;
    expect(inferJsonLogicPatternBindings(cycle, undefined).outcome.$tag).toBe("Invalid");

    const hostileResolution: Record<string, unknown> = {
      status: "resolved",
      targetId: "hostile:Hostile",
      returns: ref("HostileType"),
    };
    Object.defineProperty(hostileResolution, "params", {
      enumerable: true,
      get() {
        getterRuns++;
        return [];
      },
    });
    const hostileResolver = inferJsonLogicPatternBindings(
      { $tag: "Hostile" },
      ref("HostileType"),
      {
        resolvePatternConstructor: () => hostileResolution as unknown as PatternConstructorResolution,
      },
    );
    expect(hostileResolver.outcome.$tag).toBe("Invalid");
    expect(getterRuns).toBe(0);

    const nonCallableConstructor = inferJsonLogicPatternBindings(
      { $tag: "Bad" },
      ref("Bad"),
      {
        resolvePatternConstructor: () => ({
          status: "resolved",
          targetId: "bad:Bad",
          params: [],
          returns: ref("Bad"),
          scheme: { quantified: [], body: ref("Bad") },
        }),
      },
    );
    expect(nonCallableConstructor.outcome.$tag).toBe("Invalid");
    if (nonCallableConstructor.outcome.$tag === "Invalid") {
      expect(nonCallableConstructor.outcome.diagnostics.map(({ code }) => code)).toContain(
        "inference.not-callable",
      );
    }
  });
});
