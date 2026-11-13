import { describe, expect, test } from "bun:test";

import { marshalParsedFrames } from "./engine-bodies-dispatch";
import {
  finalizeRegistryFunctionSignatures,
  inferJsonLogicType,
  type JsonLogicInferenceOptions,
  type RegistryFunctionSignatureCandidate,
} from "./signature-inference";
import type { FenelFunction, FenelType, TypeScheme } from "./types";

const KTYPE = { tag: "KType" } as const;
const K1 = { tag: "KArrow", input: KTYPE, output: KTYPE } as const;
const PROFILE_ENTITY_REF = {
  $tagged: {
    value: { $ref: "Id" },
    phantom: {
      $refined: {
        base: { $ref: "String" },
        set: { $tag: "SeEnum", values: ["profile"] },
      },
    },
  },
} as const;

const DESCRIPTOR_PROTOTYPE_MODES = ["none", "data", "getter", "throwing-getter"] as const;

// Restore the shared prototype before assertions or another test can observe it.
// A null-prototype descriptor avoids making the fixture itself read inherited
// descriptor fields while the hostile value is installed.
function withDescriptorPrototypeValue<T>(
  mode: typeof DESCRIPTOR_PROTOTYPE_MODES[number],
  value: unknown,
  run: () => T,
): { readonly result: T; readonly inheritedReads: number } {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let inheritedReads = 0;
  const descriptor: PropertyDescriptor = Object.create(null);
  descriptor.configurable = true;
  if (mode === "data") {
    descriptor.value = value;
    descriptor.writable = true;
  } else {
    descriptor.get = () => {
      inheritedReads += 1;
      if (mode === "throwing-getter") throw new Error("inherited descriptor getter ran");
      return value;
    };
  }
  let result: T;
  try {
    if (mode !== "none") Object.defineProperty(Object.prototype, "value", descriptor);
    result = run();
  } finally {
    Reflect.deleteProperty(Object.prototype, "value");
    if (previous !== undefined) Object.defineProperty(Object.prototype, "value", previous);
  }
  return { result, inheritedReads };
}

function validSourceSchemeFrame(permuted = false): Record<string, unknown> {
  const body = { mk: "app", head: "f", args: [{ mk: "var", name: "a" }] };
  const variableF = { id: "q0", sourceName: "f", kind: K1 };
  const variableA = { id: "q1", sourceName: "a", kind: KTYPE };
  const application = permuted
    ? {
        kind: K1,
        args: [{ name: "a", mk: "var" }],
        headVarId: "q0",
        path: [],
      }
    : {
        path: [],
        headVarId: "q0",
        args: [{ mk: "var", name: "a" }],
        kind: K1,
      };
  const scheme = permuted
    ? {
        diagnostics: [],
        applications: [application],
        body: { args: [{ name: "a", mk: "var" }], head: "f", mk: "app" },
        quantified: [variableF, variableA],
      }
    : {
        quantified: [variableF, variableA],
        body,
        applications: [application],
        diagnostics: [],
      };
  return {
    type_sig: permuted
      ? { scheme, type: body, name: "higher" }
      : { name: "higher", type: body, scheme },
  };
}

function entityRefSourceSchemeFrame(arg: unknown): Record<string, unknown> {
  const body = {
    mk: "app",
    head: "EntityRef",
    args: [arg],
    role: "scheme",
  };
  return {
    type_sig: {
      name: "entity",
      type: body,
      scheme: {
        quantified: [],
        body,
        applications: [],
        diagnostics: [],
      },
    },
  };
}

function sourceScheme(frame: Record<string, unknown>): Record<string, unknown> {
  return (frame.type_sig as Record<string, unknown>).scheme as Record<string, unknown>;
}

function directSchemeBoundaryMessage(scheme: TypeScheme): string {
  const returns = (scheme.body as { $arrow: { returns: FenelType } }).$arrow.returns;
  const result = inferJsonLogicType({ call: ["higher"] }, {
    resolveFunction: (name) => name === "higher"
      ? { params: [], returns, scheme }
      : undefined,
  });
  expect(result.outcome.$tag).toBe("Invalid");
  if (result.outcome.$tag !== "Invalid") return "";
  return result.outcome.diagnostics[0]?.message ?? "";
}

describe("source-scheme hostile boundary", () => {
  test("canonicalizes kind, variable, application, and frame field insertion order", () => {
    const regular = marshalParsedFrames([validSourceSchemeFrame()]);
    const permuted = marshalParsedFrames([validSourceSchemeFrame(true)]);

    expect(permuted).toEqual(regular);
    expect(JSON.stringify(permuted)).toBe(JSON.stringify(regular));
    expect(regular).toEqual([{
      type_sig: expect.objectContaining({
        name: "higher",
        type: { $el: { call: ["f", { $var: "a" }] } },
        scheme: {
          quantified: [
            { id: "q0", sourceName: "f", kind: {
              $tag: "KArrow",
              input: { $tag: "KType" },
              output: { $tag: "KType" },
            } },
            { id: "q1", sourceName: "a", kind: { $tag: "KType" } },
          ],
          body: { $el: { call: ["f", { $var: "a" }] } },
          applications: [{
            path: [],
            headVarId: "q0",
            args: [{ $var: "a" }],
            kind: {
              $tag: "KArrow",
              input: { $tag: "KType" },
              output: { $tag: "KType" },
            },
          }],
          diagnostics: [],
        },
      }),
    }]);
  });

  test("expands both EntityRef string marker forms and rejects a non-string argument", () => {
    const rawString = marshalParsedFrames([
      entityRefSourceSchemeFrame("profile"),
    ]);
    const stringLiteral = marshalParsedFrames([
      entityRefSourceSchemeFrame({ mk: "strlit", value: "profile" }),
    ]);

    expect(rawString).toEqual(stringLiteral);
    const signature = (rawString[0] as {
      type_sig: {
        type: unknown;
        scheme: Record<string, unknown>;
      };
    }).type_sig;
    expect(signature.type).toEqual(PROFILE_ENTITY_REF);
    expect(signature.scheme).toEqual({
      quantified: [],
      body: PROFILE_ENTITY_REF,
      applications: [],
      diagnostics: [],
    });

    expect(() => marshalParsedFrames([
      entityRefSourceSchemeFrame({ mk: "ref", name: "a" }),
    ])).toThrow(/EntityRef expects exactly one string-literal type argument/);
  });

  test("pins directive and source-application JSON wire order", () => {
    const variableFrame = validSourceSchemeFrame(true);
    const variableSignature = variableFrame.type_sig as Record<string, unknown>;
    variableSignature.directives = [{ args: ["Higher"], name: "label" }];

    const [variableResult] = marshalParsedFrames([variableFrame]) as Array<{
      type_sig: {
        directives: unknown[];
        scheme: { applications: unknown[] };
      };
    }>;
    expect(JSON.stringify(variableResult!.type_sig.directives[0])).toBe(
      '{"name":"label","args":["Higher"]}',
    );
    expect(JSON.stringify(variableResult!.type_sig.scheme.applications[0])).toBe(
      '{"path":[],"headVarId":"q0","args":[{"$var":"a"}],"kind":{"$tag":"KArrow","input":{"$tag":"KType"},"output":{"$tag":"KType"}}}',
    );

    const nominalFrame = validSourceSchemeFrame(true);
    const nominalSignature = nominalFrame.type_sig as Record<string, unknown>;
    const nominalScheme = nominalSignature.scheme as Record<string, unknown>;
    const nominalBody = {
      args: [{ name: "a", mk: "var" }],
      head: "Box",
      mk: "app",
    };
    nominalSignature.type = nominalBody;
    nominalScheme.body = nominalBody;
    nominalScheme.quantified = [{ kind: KTYPE, sourceName: "a", id: "q1" }];
    nominalScheme.applications = [{
      kind: K1,
      args: [{ name: "a", mk: "var" }],
      headRef: "Box",
      path: [],
    }];

    const [nominalResult] = marshalParsedFrames([nominalFrame]) as Array<{
      type_sig: { scheme: { applications: unknown[] } };
    }>;
    expect(JSON.stringify(nominalResult!.type_sig.scheme.applications[0])).toBe(
      '{"path":[],"headRef":"Box","args":[{"$var":"a"}],"kind":{"$tag":"KArrow","input":{"$tag":"KType"},"output":{"$tag":"KType"}}}',
    );
  });

  test("snapshots nested dependent JSON-Logic value arguments without changing them", () => {
    const dependentValue = { call: ["add", { var: "n" }, 1] };
    const body = {
      mk: "app",
      head: "Vec",
      args: [{ mk: "var", name: "a" }, dependentValue],
    };
    const frame = {
      type_sig: {
        name: "dependent",
        type: body,
        scheme: {
          quantified: [{ id: "q0", sourceName: "a", kind: KTYPE }],
          body,
          applications: [],
          diagnostics: [],
        },
      },
    };

    expect(marshalParsedFrames([frame])).toEqual([{
      type_sig: expect.objectContaining({
        type: {
          $el: {
            call: ["Vec", { $var: "a" }, dependentValue],
          },
        },
      }),
    }]);
  });

  test("rejects source-scheme accessors and sparse/accessor arrays without invoking them", () => {
    {
      let calls = 0;
      const frame = validSourceSchemeFrame();
      Object.defineProperty(sourceScheme(frame), "quantified", {
        enumerable: true,
        get() {
          calls += 1;
          return [];
        },
      });
      expect(() => marshalParsedFrames([frame])).toThrow(/quantified.*accessor/i);
      expect(calls).toBe(0);
    }

    {
      let calls = 0;
      const frame = validSourceSchemeFrame();
      const applications = sourceScheme(frame).applications as unknown[];
      Object.defineProperty(applications, "0", {
        enumerable: true,
        get() {
          calls += 1;
          return {};
        },
      });
      expect(() => marshalParsedFrames([frame])).toThrow(/dense array of own data/i);
      expect(calls).toBe(0);
    }

    {
      const frame = validSourceSchemeFrame();
      const quantified = sourceScheme(frame).quantified as unknown[];
      delete quantified[0];
      expect(() => marshalParsedFrames([frame])).toThrow(/dense array of own data/i);
    }

    {
      let calls = 0;
      const frame = validSourceSchemeFrame();
      const signature = frame.type_sig as Record<string, unknown>;
      signature.directives = [{ args: ["Higher"], name: "label" }];
      Object.defineProperty((signature.directives as object[])[0]!, "name", {
        enumerable: true,
        get() {
          calls += 1;
          return "label";
        },
      });
      expect(() => marshalParsedFrames([frame])).toThrow(/directives\[0\]\.name.*accessor/i);
      expect(calls).toBe(0);
    }

    {
      let calls = 0;
      const frame = validSourceSchemeFrame();
      const application = (sourceScheme(frame).applications as object[])[0]!;
      Object.defineProperty(application, "headVarId", {
        enumerable: true,
        get() {
          calls += 1;
          return "q0";
        },
      });
      expect(() => marshalParsedFrames([frame])).toThrow(/applications\[0\]\.headVarId.*accessor/i);
      expect(calls).toBe(0);
    }
  });

  test("rejects malformed heads, fields, and path segments instead of defaulting or coercing", () => {
    {
      const frame = validSourceSchemeFrame();
      delete sourceScheme(frame).diagnostics;
      expect(() => marshalParsedFrames([frame])).toThrow(/diagnostics.*missing/i);
    }

    {
      const frame = validSourceSchemeFrame();
      const application = (sourceScheme(frame).applications as Record<string, unknown>[])[0]!;
      application.headRef = "Foo";
      expect(() => marshalParsedFrames([frame])).toThrow(/exactly one of headVarId or headRef/i);
    }

    {
      let coercionCalls = 0;
      const segment = {
        [Symbol.toPrimitive]() {
          coercionCalls += 1;
          return "0";
        },
        toString() {
          coercionCalls += 1;
          return "0";
        },
      };
      const frame = validSourceSchemeFrame();
      const application = (sourceScheme(frame).applications as Record<string, unknown>[])[0]!;
      application.path = [segment];
      expect(() => marshalParsedFrames([frame])).toThrow(/path\[0\].*string/i);
      expect(coercionCalls).toBe(0);
    }
  });

  test("rejects duplicate binder identities/names and application targets under either list order", () => {
    for (const reverse of [false, true]) {
      {
        const frame = validSourceSchemeFrame();
        const quantified = sourceScheme(frame).quantified as Record<string, unknown>[];
        quantified[1]!.id = quantified[0]!.id;
        if (reverse) quantified.reverse();
        expect(() => marshalParsedFrames([frame])).toThrow(/duplicate quantified id.*q0/i);
      }

      {
        const frame = validSourceSchemeFrame();
        const quantified = sourceScheme(frame).quantified as Record<string, unknown>[];
        quantified[1]!.sourceName = quantified[0]!.sourceName;
        if (reverse) quantified.reverse();
        expect(() => marshalParsedFrames([frame])).toThrow(
          /duplicate quantified sourceName.*f/i,
        );
      }

      {
        const frame = validSourceSchemeFrame();
        const applications = sourceScheme(frame).applications as Record<string, unknown>[];
        applications.push({
          path: [],
          headRef: "f",
          args: [{ mk: "var", name: "a" }],
          kind: K1,
        });
        if (reverse) applications.reverse();
        expect(() => marshalParsedFrames([frame])).toThrow(
          /duplicate application target path.*\[\]/i,
        );
      }
    }
  });

  test("rejects cyclic nested kinds and type markers deterministically", () => {
    {
      const frame = validSourceSchemeFrame();
      const variable = (sourceScheme(frame).quantified as Record<string, unknown>[])[0]!;
      const kind: Record<string, unknown> = { tag: "KArrow" };
      kind.input = kind;
      kind.output = KTYPE;
      variable.kind = kind;
      expect(() => marshalParsedFrames([frame])).toThrow(/cyclic kind/i);
    }

    {
      const frame = validSourceSchemeFrame();
      const body: Record<string, unknown> = { mk: "app", head: "Foo", args: [] };
      (body.args as unknown[]).push(body);
      sourceScheme(frame).body = body;
      expect(() => marshalParsedFrames([frame])).toThrow(/cyclic type marker/i);
    }
  });

  test("rejects a valid but divergent scheme body and compatibility type", () => {
    const frame = validSourceSchemeFrame();
    sourceScheme(frame).body = {
      mk: "app",
      head: "f",
      args: [{ mk: "ref", name: "Number" }],
    };

    expect(() => marshalParsedFrames([frame])).toThrow(
      /scheme body and compatibility type disagree/i,
    );
  });

  test("turns a throwing proxy descriptor into a boundary rejection without property reads", () => {
    let getCalls = 0;
    let descriptorCalls = 0;
    const frame = validSourceSchemeFrame();
    const target = sourceScheme(frame);
    (frame.type_sig as Record<string, unknown>).scheme = new Proxy(target, {
      get() {
        getCalls += 1;
        throw new Error("property read should not run");
      },
      getOwnPropertyDescriptor(inner, key) {
        descriptorCalls += 1;
        if (key === "quantified") throw new Error("hostile descriptor trap");
        return Reflect.getOwnPropertyDescriptor(inner, key);
      },
    });

    expect(() => marshalParsedFrames([frame])).toThrow(/cannot be inspected safely/i);
    expect(descriptorCalls).toBeGreaterThan(0);
    expect(getCalls).toBe(0);
  });
});

describe("authoring inference caught-value boundary", () => {
  test("rejects opaque result accessors and cycles without invoking them", () => {
    let accessorCalls = 0;
    const accessorPoint: Record<string, unknown> = { stable: true };
    Object.defineProperty(accessorPoint, "secret", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return "not-data";
      },
    });
    const mapType = {
      $map: {
        keys: { $tag: "SeEnum", values: [accessorPoint] },
        values: { $ref: "String" },
      },
    } as FenelType;
    const accessorResult = inferJsonLogicType({ var: "mapped" }, {
      bindings: { mapped: mapType },
    });
    expect(accessorResult.outcome.$tag).toBe("Invalid");
    if (accessorResult.outcome.$tag === "Invalid") {
      expect(accessorResult.outcome.diagnostics).toEqual([
        expect.objectContaining({
          code: "INFERENCE_RESULT_BOUNDARY",
          message: expect.stringContaining('accessor property "secret" is not allowed'),
        }),
      ]);
    }
    expect(accessorCalls).toBe(0);

    const cyclicPoint: Record<string, unknown> = {};
    cyclicPoint.self = cyclicPoint;
    const refinedType = {
      $refined: {
        base: { $ref: "String" },
        set: { $tag: "SeEnum", values: [cyclicPoint] },
      },
    } as FenelType;
    const cyclicResult = inferJsonLogicType({ var: "refined" }, {
      bindings: { refined: refinedType },
    });
    expect(cyclicResult.outcome.$tag).toBe("Invalid");
    if (cyclicResult.outcome.$tag === "Invalid") {
      expect(cyclicResult.outcome.diagnostics).toEqual([
        expect.objectContaining({
          code: "INFERENCE_RESULT_BOUNDARY",
          message: expect.stringContaining("cyclic inference transport data is not allowed"),
        }),
      ]);
    }
  }, 180_000);

  test("canonicalizes and freezes opaque result payloads", () => {
    const inferMap = (point: Record<string, unknown>) => inferJsonLogicType(
      { var: "mapped" },
      {
        bindings: {
          mapped: {
            $map: {
              keys: { $tag: "SeEnum", values: [point] },
              values: { $ref: "String" },
            },
          },
        },
      },
    );
    const regular = inferMap({ alpha: 1, beta: 2 });
    const permuted = inferMap({ beta: 2, alpha: 1 });
    expect(regular.outcome.$tag).toBe("Solved");
    expect(permuted.outcome.$tag).toBe("Solved");
    expect(JSON.stringify(permuted.type)).toBe(JSON.stringify(regular.type));

    const keys = (regular.type as { $map: { keys: { values: unknown[] } } }).$map.keys;
    expect(Object.isFrozen(keys)).toBe(true);
    expect(Object.isFrozen(keys.values)).toBe(true);
    expect(Object.isFrozen(keys.values[0])).toBe(true);
  }, 180_000);

  test("rejects an application sidecar whose argument disagrees with its body path", () => {
    const kType = { $tag: "KType" } as const;
    const k1 = { $tag: "KArrow", input: kType, output: kType } as const;
    const applied = { $el: { call: ["Box", { $ref: "String" }] } } as FenelType;
    const scheme: TypeScheme = {
      quantified: [],
      body: { $arrow: { params: [], returns: applied } },
      applications: [{
        path: ["$arrow", "returns"],
        headRef: "Box",
        args: [{ $ref: "Number" }],
        kind: k1,
      }],
    };

    expect(directSchemeBoundaryMessage(scheme)).toMatch(
      /application arguments disagree/i,
    );
  }, 180_000);

  test("attaches sidecars by occurrence path when two positions share one raw object", () => {
    const kType = { $tag: "KType" } as const;
    const k1 = { $tag: "KArrow", input: kType, output: kType } as const;
    const shared = { $el: { call: ["Box", { $ref: "String" }] } } as FenelType;
    const field = (name: string, index: number) => ({
      name,
      key: { $tag: "PositionalField" as const, index },
      type: shared,
      label: { $tag: "Nothing" as const },
      ui: { $tag: "Nothing" as const },
      meta: {},
    });
    const resultType = {
      $record: { fields: [field("left", 0), field("right", 1)] },
    } as FenelType;
    const leftPath = ["$arrow", "returns", "$record", "fields", "0", "type"];
    const rightPath = ["$arrow", "returns", "$record", "fields", "1", "type"];
    const scheme: TypeScheme = {
      quantified: [],
      body: { $arrow: { params: [], returns: resultType } },
      applications: [leftPath, rightPath].map((path) => ({
        path,
        headRef: "Box",
        args: [{ $ref: "String" } as FenelType],
        kind: k1,
      })),
      nominals: [{
        path: leftPath,
        identity: '["left","Box"]',
        publicName: "Box",
      }, {
        path: rightPath,
        identity: '["right","Box"]',
        publicName: "Box",
      }],
    };

    const returns = (scheme.body as { $arrow: { returns: FenelType } }).$arrow.returns;
    const inferred = inferJsonLogicType({ call: ["shared"] }, {
      resolveFunction: (name) => name === "shared"
        ? { params: [], returns, scheme }
        : undefined,
    });
    expect(inferred.outcome.$tag).toBe("Solved");
    expect(inferred.scheme?.nominals).toEqual([{
      path: ["$record", "fields", "0", "type"],
      identity: '["left","Box"]',
      publicName: "Box",
    }, {
      path: ["$record", "fields", "1", "type"],
      identity: '["right","Box"]',
      publicName: "Box",
    }]);
  }, 180_000);

  test("rejects ambiguous scheme binders and application targets independent of list order", () => {
    const kType = { $tag: "KType" } as const;
    const k1 = { $tag: "KArrow", input: kType, output: kType } as const;
    const applied = { $el: { call: ["f", { $var: "a" }] } } as FenelType;
    const body = { $arrow: { params: [], returns: applied } } as FenelType;
    const variables = [
      { id: "q0", sourceName: "f", kind: k1 },
      { id: "q1", sourceName: "a", kind: kType },
    ] as const;
    const application = {
      path: ["$arrow", "returns"],
      headVarId: "q0",
      args: [{ $var: "a" } as FenelType],
      kind: k1,
    } as const;

    for (const reverse of [false, true]) {
      const duplicateId = variables.map((variable, index) => ({
        ...variable,
        id: index === 1 ? "q0" : variable.id,
      }));
      if (reverse) duplicateId.reverse();
      expect(directSchemeBoundaryMessage({
        quantified: duplicateId,
        body,
        applications: [application],
      })).toMatch(/duplicate quantified id.*q0/i);

      const duplicateSourceName = variables.map((variable, index) => ({
        ...variable,
        sourceName: index === 1 ? "f" : variable.sourceName,
      }));
      if (reverse) duplicateSourceName.reverse();
      expect(directSchemeBoundaryMessage({
        quantified: duplicateSourceName,
        body,
        applications: [application],
      })).toMatch(/duplicate quantified sourceName.*f/i);

      const applications = [
        application,
        {
          path: ["$arrow", "returns"],
          headRef: "f",
          args: [{ $var: "a" } as FenelType],
          kind: k1,
        } as const,
      ];
      if (reverse) applications.reverse();
      expect(directSchemeBoundaryMessage({
        quantified: [...variables],
        body,
        applications,
      })).toMatch(/duplicate application target path/i);
    }
  }, 180_000);

  test("rejects own option accessors under inherited descriptor values", () => {
    const optionValues = {
      bindings: {},
      moduleMembers: {
        resolveModuleMemberScheme: () => ({ kind: "missing" }),
        resolveModuleMember: () => ({ kind: "missing" }),
        getIdentifiedEntity: () => undefined,
        getEntityNominalIdentity: () => undefined,
        getCapability: () => undefined,
        callSiteTyping: { legacyKey: () => ({ ok: false, message: "no fixture owner" }) },
      },
      resolveFunction: () => undefined,
      resolveNamedType: () => undefined,
      resolveFunctionId: () => undefined,
      resolvePatternConstructor: () => ({ status: "missing" }),
    } satisfies Required<JsonLogicInferenceOptions>;
    for (const mode of DESCRIPTOR_PROTOTYPE_MODES) {
      for (const [key, inheritedValue] of Object.entries(optionValues)) {
        let sourceReads = 0;
        const options = {};
        Object.defineProperty(options, key, {
          enumerable: true,
          get() { sourceReads += 1; return inheritedValue; },
        });
        const { result, inheritedReads } = withDescriptorPrototypeValue(
          mode, inheritedValue, () => inferJsonLogicType(0, options),
        );
        expect(result.outcome.$tag, `${mode}/${key}`).toBe("Invalid");
        if (result.outcome.$tag === "Invalid") {
          expect(result.outcome.diagnostics[0]?.code, `${mode}/${key}`)
            .toBe("INFERENCE_OPTIONS_BOUNDARY");
        }
        expect(sourceReads, `${mode}/${key}`).toBe(0);
        expect(inheritedReads, `${mode}/${key}`).toBe(0);
      }
    }
  }, 180_000);

  test("rejects own binding accessors before reading inherited descriptor data", () => {
    for (const mode of DESCRIPTOR_PROTOTYPE_MODES) {
      let sourceReads = 0;
      const bindings = {};
      const inheritedValue: FenelType = { $ref: "Number" };
      Object.defineProperty(bindings, "entry", {
        enumerable: true,
        get() { sourceReads += 1; return inheritedValue; },
      });
      const { result, inheritedReads } = withDescriptorPrototypeValue(
        mode, inheritedValue, () => inferJsonLogicType({ var: "entry" }, { bindings }),
      );
      expect(result.outcome.$tag, mode).toBe("Invalid");
      if (result.outcome.$tag === "Invalid") {
        expect(result.outcome.diagnostics[0]?.code, mode).toBe("INFERENCE_BINDING_ACCESSOR");
      }
      expect(sourceReads, mode).toBe(0);
      expect(inheritedReads, mode).toBe(0);
    }
  }, 180_000);

  for (const prototypeMode of DESCRIPTOR_PROTOTYPE_MODES) test(
    `does not invoke coercion hooks on a hostile value thrown by the resolver (${prototypeMode})`, () => {
    let coercionCalls = 0;
    const hostile: Record<PropertyKey, unknown> = {
      [Symbol.toPrimitive]() {
        coercionCalls += 1;
        return "hostile";
      },
      toString() {
        coercionCalls += 1;
        return "hostile";
      },
      valueOf() {
        coercionCalls += 1;
        return "hostile";
      },
    };
    Object.defineProperty(hostile, "message", {
      enumerable: true,
      get() {
        coercionCalls += 1;
        return "hostile";
      },
    });

    const { result, inheritedReads } = withDescriptorPrototypeValue(
      prototypeMode, "fabricated inherited message", () => inferJsonLogicType(
        { call: ["hostileResolver"] },
        {
          resolveFunction() {
            throw hostile;
          },
        },
      ),
    );

    expect(result.outcome.$tag).toBe("Invalid");
    if (result.outcome.$tag !== "Invalid") return;
    expect(result.outcome.diagnostics).toEqual([
      expect.objectContaining({
        code: "INFERENCE_RESOLVER_BOUNDARY",
        message: expect.stringContaining(
          "resolver threw a value without an own string message",
        ),
      }),
    ]);
    expect(coercionCalls).toBe(0);
    expect(inheritedReads).toBe(0);
  }, 180_000);
});

describe("registry signature finalizer hostile boundary", () => {
  const authoredReturn = {
    $tag: "Authored",
    source: { $tag: "HostSpec", module: "hostile-finalizer" },
  } as const;

  function candidate(
    returns: FenelType = { $ref: "String" },
  ): RegistryFunctionSignatureCandidate {
    const fn: FenelFunction = {
      id: "hostile-finalizer:entry",
      params: [],
      returns,
      body: "ok",
    };
    return {
      fn,
      declaration: {
        functionId: fn.id,
        declarationName: "entry",
        codeName: "entry",
        params: [],
        returns: authoredReturn,
      },
      implementationOrigin: { $tag: "FenelBody" },
    };
  }

  test("snapshots candidate declarations before reading slots and rejects cycles", () => {
    let getterReads = 0;
    const accessorCandidate = candidate();
    Object.defineProperty(accessorCandidate.declaration, "params", {
      enumerable: true,
      get() {
        getterReads += 1;
        return [];
      },
    });

    expect(() => finalizeRegistryFunctionSignatures([accessorCandidate], {
      resolutions: [],
    })).toThrow(/accessor property "params"/);
    expect(getterReads).toBe(0);

    const cyclicCandidate = candidate();
    const cyclicBody: Record<string, unknown> = {};
    cyclicBody.self = cyclicBody;
    (cyclicCandidate.fn as { body?: unknown }).body = cyclicBody;
    expect(() => finalizeRegistryFunctionSignatures([cyclicCandidate], {
      resolutions: [],
    })).toThrow(/cyclic inference transport data/);
  });

  test("rejects duplicate canonical candidate ids before plan partitioning", () => {
    expect(() => finalizeRegistryFunctionSignatures([candidate(), candidate()], {
      resolutions: [],
    })).toThrow(
      "registry signature finalization: duplicate canonical function id hostile-finalizer:entry",
    );
  });

  test("descriptor-reads every finalizer option without invoking accessors", () => {
    for (const key of [
      "resolutions",
      "externalCallables",
      "constructorEntities",
      "resolveCandidateReferences",
      "resolveCandidateNominalReferences",
      "resolveConstructorEntityNominalReferences",
      "constructorSlotsForCandidate",
      "totalityById",
    ] as const) {
      let getterReads = 0;
      const options: Record<string, unknown> = key === "resolutions"
        ? {}
        : { resolutions: [] };
      Object.defineProperty(options, key, {
        enumerable: true,
        get() {
          getterReads += 1;
          return [];
        },
      });
      expect(() => finalizeRegistryFunctionSignatures(
        [candidate()],
        options as never,
      ), key).toThrow(new RegExp(`accessor property ${key}|missing/accessor property ${key}`));
      expect(getterReads, key).toBe(0);
    }
  });

  test("keeps exact-missing nominals spelling-only and excludes lexical mu variables", () => {
    const returns: FenelType = {
      $tuple: [
        { $ref: "ExternalDomain" },
        { $mu: { var: "Loop", body: { $var: "Loop" } } },
      ],
    };
    const nominalCandidate = candidate(returns);
    const requests: { readonly scopeId: string; readonly names: readonly string[] }[] = [];
    const [finalized] = finalizeRegistryFunctionSignatures([nominalCandidate], {
      resolutions: [],
      resolveCandidateNominalReferences(scopeId, names) {
        requests.push({ scopeId, names: [...names] });
        return names.map((name) => ({ name, status: "missing" as const, targetId: "" }));
      },
    });

    expect(requests).toEqual([{
      scopeId: nominalCandidate.fn.id,
      names: ["ExternalDomain"],
    }]);
    expect(finalized?.info.scheme.nominals).toBeUndefined();
    expect(finalized?.info.scheme.body).toEqual({
      $arrow: { params: [], returns },
    });

    expect(() => finalizeRegistryFunctionSignatures([nominalCandidate], {
      resolutions: [],
      resolveCandidateNominalReferences: (_scopeId, names) =>
        names.map((name) => ({ name, status: "ambiguous", targetId: "" })),
    })).toThrow('nominal reference "ExternalDomain" is ambiguous');
  }, 180_000);
});
