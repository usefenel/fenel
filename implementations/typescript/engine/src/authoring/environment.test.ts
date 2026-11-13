import { describe, expect, test } from "bun:test";
import type { CatalogSection } from "../type-catalog";
import type {
  FieldDef,
  FenelFunction,
  FenelModule,
  FenelType,
  Interface,
  TypeScheme,
} from "../types";
import { createRegistry, type ModuleRegistry } from "../registry";
import { createDispatchRegistry } from "../dispatch-registry";
import { seedFromType } from "../effect-dispatch";
import { Nothing, Ref } from "../type-foundation";
import {
  authoringScopeForDoBlock,
  authoringScopeForLetBinding,
  buildAuthoringCatalogSnapshot,
  createAuthoringEnvironment,
  dependentTypeForValuePath,
  effectiveLetBindingType,
  filterAuthoringFunctionsByReturn,
  filterAuthoringTypeEntries,
  refHandle,
  refLiteralKind,
  resolveRefToType,
  typePositionRefHandle,
  type AuthoringCatalogFunctionEntry,
  type AuthoringCatalogSnapshot,
  type AuthoringExactFunctionRoute,
  type LetBindingDraft,
} from "./environment";
import {
  exprNodeToLogic,
  inferAuthoringExpression,
  logicToExprNode,
  type ExprNode,
} from "./expression-authoring";

const str = { $ref: "String" } as FenelType;
const num = { $ref: "Number" } as FenelType;
const bool = { $ref: "Boolean" } as FenelType;
const unit = { $unit: true } as FenelType;
const inferredStringScheme: TypeScheme = {
  quantified: [],
  body: str,
  nominals: [{
    path: [],
    identity: "[\"system\",\"String\"]",
    publicName: "String",
  }],
};
const userType = {
  $record: {
    fields: [
      field("name", str),
      field("age", num),
    ],
  },
} as FenelType;
const maybeNumber = {
  $variant: {
    cases: [
      { name: "Nothing", label: Nothing },
      { name: "Just", label: Nothing, fields: [field("value", num)] },
    ],
  },
} as FenelType;

function field(name: string, type: FenelType): FieldDef {
  const handles: Record<string, string> = {
    name: "11111111-1111-4111-8111-111111111111",
    age: "22222222-2222-4222-8222-222222222222",
    value: "33333333-3333-4333-8333-333333333333",
    a: "44444444-4444-4444-8444-444444444444",
    b: "55555555-5555-4555-8555-555555555555",
    user: "66666666-6666-4666-8666-666666666666",
    run: "77777777-7777-4777-8777-777777777777",
    other: "88888888-8888-4888-8888-888888888888",
    length: "99999999-9999-4999-8999-999999999999",
  };
  return {
    name,
    key: { $tag: "NamedField", ref: { $ref: handles[name]! } },
    label: Nothing,
    type,
    meta: {},
    ui: Nothing,
  };
}

const catalogSections: CatalogSection[] = [
  {
    id: "function",
    label: "Functions",
    description: "functions",
    entries: [
      {
        id: "fn:std:add",
        name: "Add",
        description: "Add numbers",
        category: "function",
        fn: {
          id: "fn:std:add",
          params: [field("a", num), field("b", num)],
          returns: num,
        } as FenelFunction,
      },
      {
        id: "fn:app:isAdult",
        name: "Is adult",
        description: "Checks age",
        category: "function",
        fn: {
          id: "fn:app:isAdult",
          params: [field("user", { $ref: "User" } as FenelType)],
          returns: bool,
        } as FenelFunction,
      },
    ],
  },
  {
    id: "entity",
    label: "Entities",
    description: "entities",
    entries: [
      {
        id: "entity:User",
        name: "User",
        description: "A user record",
        category: "entity",
        entity: { id: "User", type: userType },
      },
      {
        id: "entity:MaybeNumber",
        name: "MaybeNumber",
        description: "Maybe number",
        category: "entity",
        entity: { id: "MaybeNumber", type: maybeNumber },
      },
    ],
  },
  {
    id: "interface",
    label: "Interfaces",
    description: "interfaces",
    entries: [
      {
        id: "interface:Labelable",
        name: "Labelable",
        description: "Display label",
        category: "interface",
      },
    ],
  },
];

const interfaces: Interface[] = [
  {
    name: "Labelable",
    params: [{ name: "a" }],
    methods: [
      {
        name: "label",
        params: [field("value", { $var: "a" } as FenelType)],
        returns: str,
        description: "Display label",
      },
    ],
  } as Interface,
];

const snapshot = buildAuthoringCatalogSnapshot(catalogSections, {
  codeNameFor: (id) => id.split(":").pop(),
  descriptionFor: (id) => `${id} description`,
  operatorInstances: [
    { args: ["fn:std:add"], methods: { notation: "+" } },
  ],
  interfaces,
});
const env = createAuthoringEnvironment(snapshot);

describe("authoring environment catalog", () => {
  test("enriches an earlier display-only type row with its later declaration", () => {
    const sections: CatalogSection[] = [
      {
        id: "foundation", label: "Foundation", description: "Presets",
        entries: [{ id: "user-preset", name: "User", category: "foundation", description: "Friendly description" }],
      },
      catalogSections[1]!,
    ];
    const catalog = buildAuthoringCatalogSnapshot(sections);
    expect(catalog.types.filter((entry) => entry.name === "User")).toHaveLength(1);
    expect(catalog.types.find((entry) => entry.name === "User")).toMatchObject({
      id: "user-preset", description: "Friendly description", category: "foundation",
      entityId: "User", type: userType,
    });
    const authoring = createAuthoringEnvironment(catalog);
    expect(authoring.resolveNamedType?.("User")).toEqual(userType);
    expect(authoring.resolveTypeRef?.({ $ref: "User" })).toEqual(userType);
  });

  test("builds type, function, constructor, method, and operator metadata from snapshots", () => {
    expect(snapshot.types.map((entry) => entry.name)).toContain("User");
    expect(new Set(snapshot.functions.map((entry) => entry.id))).toEqual(new Set([
      "fn:std:add",
      "fn:app:isAdult",
      "Just",
      "Nothing",
      "Labelable.label",
      "op:+",
    ]));
    expect(snapshot.functions.find((entry) => entry.id === "Just")?.kind).toBe("constructor");
    expect(snapshot.functions.find((entry) => entry.id === "Labelable.label")?.kind).toBe("method");
    expect(snapshot.functions.find((entry) => entry.id === "op:+")?.notation).toBe("+");
    expect(snapshot.capabilities.map((entry) => entry.name)).toEqual(["HasStateIO", "Labelable"]);
    expect(snapshot.operatorCodeNameByNotation.get("+")).toBe("add");
  });

  test("indexes code names and filters picker candidates in engine-owned helpers", () => {
    expect(env.resolveFunctionId("add")).toBe("fn:std:add");
    expect(env.resolveFunctionId("fn:app:isAdult")).toBe("fn:app:isAdult");
    expect(env.operatorCodeName("+")).toBe("add");
    expect(filterAuthoringTypeEntries(snapshot.types, "user").map((entry) => entry.name)).toEqual(["User"]);
    const matches = filterAuthoringFunctionsByReturn(snapshot.functions, num)
      .map((entry) => entry.id);
    expect(matches).toContain("fn:std:add");
  });

  test("type search ranks exact, prefix, word, other name and description matches, stable within a tier", () => {
    const entry = (name: string, description = "", id = name) => ({ id, name, description, category: "fixture" });
    const entries = [
      entry("Amplitude", "a number of decibels"), entry("Birthdate"), entry("CheckDateInput"), entry("Date Format"),
      entry("AxiomArrowCandidate", "picks a date"), entry("Date"), entry("Dated"), entry("Profile", "a date profile", "Date-profile"),
    ];
    expect(filterAuthoringTypeEntries(entries, "date").map((row) => row.name)).toEqual([
      "Date", "Date Format", "Dated", "Profile", "CheckDateInput", "Birthdate", "AxiomArrowCandidate",
    ]);
    expect(filterAuthoringTypeEntries(entries, "NUMBER").map((row) => row.name)).toEqual(["Amplitude"]);
    expect(filterAuthoringTypeEntries(entries, "").map((row) => row.name)).toEqual(entries.map((row) => row.name));
    // Ranked before the cut: an exact match after many weaker ones survives the limit.
    const crowded = [...Array.from({ length: 150 }, (_, index) => entry(`Updated${index}`, "has a date")), entry("Date")];
    expect(filterAuthoringTypeEntries(crowded, "date", 100)[0]!.name).toBe("Date");
  });

  test("snapshots and freezes callable authority instead of retaining caller maps and routes", () => {
    const solvedScheme: TypeScheme = {
      quantified: [],
      body: { $arrow: { params: [], returns: num } },
    };
    const fencedScheme: TypeScheme = {
      quantified: [],
      body: { $arrow: { params: [], returns: str } },
    };
    const solvedEntry: AuthoringCatalogFunctionEntry = {
      id: "snapshot:solved",
      targetId: "snapshot:solved",
      codeName: "solved",
      label: "solved",
      description: "solved",
      params: [],
      returns: num,
      scheme: solvedScheme,
      signatureOutcome: { $tag: "Solved" },
      kind: "function",
    };
    const fencedEntry: AuthoringCatalogFunctionEntry = {
      id: "snapshot:fenced",
      targetId: "snapshot:fenced",
      codeName: "fenced",
      label: "fenced",
      description: "fenced",
      params: [],
      returns: str,
      scheme: fencedScheme,
      signatureOutcome: { $tag: "AnnotationRequired", diagnostics: [] },
      kind: "function",
    };
    const fencedRoute: AuthoringExactFunctionRoute = {
      sourceName: "Alias.fenced",
      targetId: fencedEntry.id,
      status: "fenced",
      entry: fencedEntry,
    };
    const operatorNames = new Map([["+", "add"]]);
    const mutable: AuthoringCatalogSnapshot = {
      types: [],
      functions: [solvedEntry, fencedEntry],
      capabilities: [],
      catalogTypes: [],
      operatorCodeNameByNotation: operatorNames,
      exactFunctionRoutes: [fencedRoute],
    };
    const isolated = createAuthoringEnvironment(mutable);

    expect(isolated.functionForRefLiteral("solved")?.returns).toEqual(num);
    expect(isolated.hasFunctionRefLiteral("Alias.fenced")).toBeTrue();
    expect(isolated.functionForRefLiteral("Alias.fenced")).toBeUndefined();

    (solvedScheme.body as { $arrow: { returns: FenelType } }).$arrow.returns = str;
    fencedEntry.signatureOutcome = { $tag: "Solved" };
    fencedRoute.status = "resolved";
    operatorNames.set("+", "poisoned");
    mutable.functions.splice(0, mutable.functions.length);

    expect(isolated.functionForRefLiteral("solved")?.returns).toEqual(num);
    expect(isolated.functionForRefLiteral("Alias.fenced")).toBeUndefined();
    expect(isolated.operatorCodeName("+")).toBe("add");
    expect(isolated.functionById).not.toHaveProperty("set");
    expect(Object.isFrozen(isolated)).toBeTrue();
    expect(Object.isFrozen(isolated.catalog)).toBeTrue();
    expect(Object.isFrozen(isolated.catalog.functions)).toBeTrue();
    expect(Object.isFrozen(isolated.catalog.functions[0]!.scheme)).toBeTrue();
  });

  test("carries the registry's higher-kinded scheme sidecar byte-for-byte", () => {
    const kType = { $tag: "KType" } as const;
    const k1 = { $tag: "KArrow", input: kType, output: kType } as const;
    const applied: FenelType = { $el: { call: ["f", { $var: "a" }] } };
    const higher: FenelFunction = { id: "poly:higher", params: [], returns: applied };
    const scheme: TypeScheme = {
      quantified: [
        { id: "q0", sourceName: "f", kind: k1 },
        { id: "q1", sourceName: "a", kind: kType },
      ],
      body: { $arrow: { params: [], returns: applied } },
      applications: [{
        path: ["$arrow", "returns"],
        headVarId: "q0",
        args: [{ $var: "a" }],
        kind: k1,
      }],
    };
    const registry = {
      getIdentifiedFunction: (id: string) => id === higher.id ? higher : undefined,
      getFunctionScheme: (id: string) => id === higher.id ? scheme : undefined,
      getFunctionSignatureInfo: (id: string) => id === higher.id
        ? { outcome: { $tag: "Solved" } }
        : undefined,
      listConstructorSignatures: () => [],
    } as unknown as ModuleRegistry;
    const sections: CatalogSection[] = [{
      id: "function",
      label: "Functions",
      description: "functions",
      entries: [{
        id: higher.id,
        name: "Higher",
        description: "higher-kinded fixture",
        category: "function",
        fn: higher,
      }],
    }];
    const registrySnapshot = buildAuthoringCatalogSnapshot(sections, { registry });
    expect(registrySnapshot.functions[0]?.scheme).toEqual(scheme);
    expect(registrySnapshot.functions[0]?.scheme?.applications?.[0]?.headVarId).toBe("q0");
  });

  test("qualified methods use the registry class contract's authoritative scheme", () => {
    const contractParams = [{
      ...field("value", str),
      label: { $tag: "Just", _0: "Value" } as const,
    }];
    const contractReturns = str;
    const methodInterface: Interface = {
      name: "ProbeCapability",
      params: [],
      methods: [{
        name: "value",
        params: contractParams,
        returns: contractReturns,
        description: "Registered class contract",
      }],
    } as Interface;
    const scheme: TypeScheme = {
      quantified: [],
      body: { $arrow: { params: contractParams, returns: contractReturns } },
    };
    const contractSignature = {
      name: "value",
      targetId: "ProbeCapability.value",
      ownerName: "ProbeCapability",
      params: contractParams,
      returns: contractReturns,
      scheme,
      outcome: { $tag: "Solved" as const },
    };
    const registry = {
      resolveFieldPresentation: () => ({
        label: "Value",
        source: "uuid-field-facet",
      }),
      getCapabilityMethodSignature: (id: string) => id === "ProbeCapability.value"
        ? contractSignature
        : undefined,
      listCapabilityMethodSignatures: () => [contractSignature],
      listConstructorSignatures: () => [],
    } as unknown as ModuleRegistry;

    const selected = buildAuthoringCatalogSnapshot([], {
      interfaces: [methodInterface],
      capabilityMethodOwners: [methodInterface.name],
      registry,
    });
    const method = selected.functions.find((entry) => entry.id === "ProbeCapability.value")!;
    expect(method.params).toEqual(contractParams);
    expect(method.returns).toEqual(contractReturns);
    expect(method.scheme).toBe(scheme);
    expect(method.targetId).toBe("ProbeCapability.value");
    expect(method.signatureOutcome?.$tag).toBe("Solved");
    expect(inferAuthoringExpression({
      kind: "call",
      fnId: "ProbeCapability.value",
      args: [{ kind: "literal", value: "contract input" }],
    }, createAuthoringEnvironment(selected))).toMatchObject({
      outcome: { $tag: "Solved" },
      type: contractReturns,
    });

    const dispatch = createDispatchRegistry();
    dispatch.defineClass(methodInterface);
    const missingSchemeRegistry = createRegistry([], {
      dispatchRegistry: dispatch,
      publishCatalogEntities: false,
    });
    const missingSignature = missingSchemeRegistry.getCapabilityMethodSignature(
      "ProbeCapability.value",
    );
    expect(missingSignature?.outcome.$tag).toBe("AnnotationRequired");
    expect(missingSignature?.params).toEqual(contractParams);
    expect(missingSignature?.returns).toEqual(contractReturns);
    expect(missingSignature?.scheme).toBeUndefined();

    const unresolved = buildAuthoringCatalogSnapshot([], {
      interfaces: [methodInterface],
      capabilityMethodOwners: [methodInterface.name],
      registry: missingSchemeRegistry,
    });
    const unresolvedMethod = unresolved.functions.find(
      (entry) => entry.id === "ProbeCapability.value",
    );
    expect(unresolvedMethod?.params.map(({ name, key, type }) => ({ name, key, type })))
      .toEqual(contractParams.map(({ name, key, type }) => ({ name, key, type })));
    expect(unresolvedMethod?.returns).toEqual(contractReturns);
    expect(unresolvedMethod?.signatureOutcome?.$tag).toBe("AnnotationRequired");
    expect(unresolvedMethod?.scheme).toBeUndefined();
    expect(inferAuthoringExpression({
      kind: "call",
      fnId: "ProbeCapability.value",
      args: [{ kind: "literal", value: "must not reconstruct a scheme" }],
    }, createAuthoringEnvironment(unresolved)).outcome.$tag).toBe("AnnotationRequired");
  }, 180_000);

  test("qualified authoring mirrors runtime module-before-capability and alias routing", () => {
    const moduleParams = [field("a", num)];
    const capabilityRunParams = [field("a", bool)];
    const capabilityOtherParams = [field("a", bool)];
    const contractScheme: TypeScheme = {
      quantified: [],
      body: {
        $record: {
          fields: [
            field("run", {
              $arrow: { params: capabilityRunParams, returns: bool },
            }),
            field("other", {
              $arrow: { params: capabilityOtherParams, returns: num },
            }),
          ],
        },
      },
    };
    const hiddenCapability: Interface = {
      name: "AuthoringRouteHidden",
      methods: [{ name: "hidden", params: [], returns: unit }],
    };
    const contractModule: FenelModule = {
      name: "AuthoringRouteProbe",
      label: "Authoring route probe",
      entities: [
        {
          id: "AuthoringRouteProbe",
          module: "AuthoringRouteProbe",
          type: contractScheme.body,
          typeScheme: contractScheme,
        },
        {
          id: "AuthoringRouteConstructors",
          module: "AuthoringRouteProbe",
          type: {
            $variant: {
              cases: [
                { name: "run", label: Nothing, fields: [] },
                { name: "other", label: Nothing, fields: [] },
              ],
            },
          },
          typeScheme: {
            quantified: [],
            body: {
              $variant: {
                cases: [
                  { name: "run", label: Nothing, fields: [] },
                  { name: "other", label: Nothing, fields: [] },
                ],
              },
            },
          },
        },
      ],
      functions: [{
        id: "AuthoringRouteProbe:run",
        params: moduleParams,
        returns: str,
      }],
      instances: [],
    };
    const capability = seedFromType(
      "AuthoringRouteProbe",
      contractScheme.body,
      "a",
      { typeScheme: contractScheme, sourceModule: contractModule },
    );
    const dispatch = createDispatchRegistry();
    dispatch.defineClass(capability);
    dispatch.defineClass(hiddenCapability);
    const consumerModule: FenelModule = {
      name: "AuthoringRouteConsumer",
      label: "Authoring route consumer",
      imports: [{ module: "AuthoringRouteProbe", as: "ARP" }],
      entities: [],
      functions: [],
      instances: [],
    };
    const registry = createRegistry([contractModule, consumerModule], {
      dispatchRegistry: dispatch,
      publishCatalogEntities: false,
    });
    const routed = buildAuthoringCatalogSnapshot([], {
      registry,
      capabilityMethodOwners: [capability.name],
      sourceModule: consumerModule.name,
    });
    const routedEnv = createAuthoringEnvironment(routed);

    expect(routed.functions.filter(({ kind }) => kind === "method").map(({ id }) => id))
      .toEqual(["AuthoringRouteProbe.other", "AuthoringRouteProbe.run"]);
    expect(routedEnv.getFunctionEntry?.("AuthoringRouteProbe.run")?.targetId)
      .toBe("AuthoringRouteProbe:run");
    expect(routedEnv.getFunctionEntry?.("ARP.run")?.targetId)
      .toBe("AuthoringRouteProbe:run");
    expect(routedEnv.getFunctionEntry?.("AuthoringRouteProbe.other")?.targetId)
      .toBe("AuthoringRouteProbe.other");
    expect(routedEnv.resolveFunctionId("AuthoringRouteProbe.run"))
      .toBe("AuthoringRouteProbe:run");
    expect(routedEnv.resolveFunctionId("AuthoringRouteProbe.other"))
      .toBe("AuthoringRouteProbe.other");
    expect(routedEnv.resolveConstructorTarget?.("AuthoringRouteProbe.run"))
      .toBeUndefined();
    expect(routedEnv.resolveConstructorTarget?.("AuthoringRouteProbe.other"))
      .toBeUndefined();
    const exactRunConstructor = routed.patternConstructors?.find(({ id }) => id === "run");
    if (exactRunConstructor?.targetId === undefined) {
      throw new Error("missing exact colliding constructor target");
    }
    expect(routedEnv.resolveConstructorTarget?.(exactRunConstructor.targetId))
      .toBe(exactRunConstructor.targetId);
    expect(exprNodeToLogic({
      kind: "call",
      fnId: "AuthoringRouteProbe.run",
      args: [{ kind: "literal", value: 1 }],
    }, {
      fnCodeName: (id) => id,
      constructorName: routedEnv.resolveConstructorTarget,
    })).toEqual({ method: ["AuthoringRouteProbe", "run", 1] });
    const decodedQualifiedCall = logicToExprNode(
      { call: ["ARP.run", 1] },
      [],
      routedEnv.resolveFunctionId,
    );
    expect(decodedQualifiedCall.kind).toBe("call");
    if (decodedQualifiedCall.kind !== "call") {
      throw new Error("qualified call did not decode as a call");
    }
    expect(decodedQualifiedCall.fnId).toBe("AuthoringRouteProbe:run");
    // Ordinary authoring keeps the authored source head (`ARP.run`); with
    // source heads dropped, the decoded target re-encodes through its module
    // function (the module wins over the capability method).
    expect(exprNodeToLogic(decodedQualifiedCall, {
      fnCodeName: (id) => routedEnv.functionCodeName(id) ?? id,
      constructorName: routedEnv.resolveConstructorTarget,
    })).toEqual({ call: ["ARP.run", 1] });
    expect(exprNodeToLogic(decodedQualifiedCall, {
      fnCodeName: (id) => routedEnv.functionCodeName(id) ?? id,
      constructorName: routedEnv.resolveConstructorTarget,
      preserveSourceHeads: false,
    })).toEqual({ call: ["AuthoringRouteProbe.run", 1] });
    expect(exprNodeToLogic({
      kind: "call",
      fnId: exactRunConstructor.targetId,
      args: [],
    }, {
      fnCodeName: (id) => id,
      constructorName: routedEnv.resolveConstructorTarget,
    })).toEqual({ construct: [exactRunConstructor.targetId] });
    expect(inferAuthoringExpression({
      kind: "call",
      fnId: "AuthoringRouteProbe.run",
      args: [{ kind: "literal", value: 1 }],
    }, routedEnv)).toMatchObject({ outcome: { $tag: "Solved" }, type: str });
    expect(inferAuthoringExpression({
      kind: "call",
      fnId: "ARP.run",
      args: [{ kind: "literal", value: 1 }],
    }, routedEnv)).toMatchObject({ outcome: { $tag: "Solved" }, type: str });
    expect(inferAuthoringExpression({
      kind: "call",
      fnId: "AuthoringRouteProbe.other",
      args: [{ kind: "literal", value: true }],
    }, routedEnv)).toMatchObject({ outcome: { $tag: "Solved" }, type: num });
  }, 180_000);

  test("uses one registry-owned source frame for local, selective, hiding, alias, and last-wins routes", () => {
    const authored = {
      $tag: "Authored" as const,
      source: { $tag: "HostSpec" as const, module: "authoring-source-frame" },
    };
    const routeModule = (
      name: string,
      codeNames: readonly string[],
      imports: NonNullable<FenelModule["imports"]> = [],
    ): FenelModule => {
      const functions = codeNames.map((codeName): FenelFunction => ({
        id: `${name}:${codeName}`,
        params: [],
        returns: unit,
        body: null,
      }));
      return {
        name,
        label: name,
        imports,
        entities: [],
        functions,
        functionSignatureDeclarations: functions.map((fn, index) => ({
          functionId: fn.id,
          declarationName: codeNames[index]!,
          codeName: codeNames[index]!,
          scheme: {
            quantified: [],
            body: { $arrow: { params: [], returns: unit } },
          },
          params: [],
          returns: authored,
        })),
        instances: [],
      };
    };
    const foo = routeModule("AuthoringFrameFoo", [
      "aliasOnly",
      "selected",
      "visible",
      "hidden",
      "collide",
      "local",
    ]);
    const bar = routeModule("AuthoringFrameBar", ["collide", "ghost"]);
    const consumer = routeModule("AuthoringFrameConsumer", ["local"], [
      { module: foo.name, as: "F" },
      { module: foo.name, as: "D" },
      { module: bar.name, as: "D" },
      { module: foo.name, names: ["selected", "ghost"] },
      { module: foo.name, hiding: ["hidden"] },
      { module: bar.name, names: ["collide"] },
    ]);
    const registry = createRegistry([foo, bar, consumer], {
      dispatchRegistry: createDispatchRegistry(),
      publishCatalogEntities: false,
    });
    const rows = new Map(
      registry.listSourceFunctionResolutions(consumer.name)
        .map((row) => [row.name, row] as const),
    );
    expect(rows.get("local")).toMatchObject({
      status: "resolved",
      targetId: `${consumer.name}:local`,
    });
    expect(rows.get("F.aliasOnly")?.targetId).toBe(`${foo.name}:aliasOnly`);
    expect(rows.get("D.collide")?.targetId).toBe(`${bar.name}:collide`);
    expect(rows.get("selected")?.targetId).toBe(`${foo.name}:selected`);
    expect(rows.get("visible")?.targetId).toBe(`${foo.name}:visible`);
    expect(rows.get("collide")?.targetId).toBe(`${bar.name}:collide`);
    expect(rows.get("ghost")?.status).toBe("missing");

    const snapshot = buildAuthoringCatalogSnapshot([], {
      registry,
      sourceModule: consumer.name,
    });
    const env = createAuthoringEnvironment(snapshot);
    expect(env.resolveFunctionId("local")).toBe(`${consumer.name}:local`);
    expect(env.resolveFunctionId("F.aliasOnly")).toBe(`${foo.name}:aliasOnly`);
    expect(env.resolveFunctionId("D.collide")).toBe(`${bar.name}:collide`);
    expect(env.resolveFunctionId("selected")).toBe(`${foo.name}:selected`);
    expect(env.resolveFunctionId("visible")).toBe(`${foo.name}:visible`);
    expect(env.resolveFunctionId("collide")).toBe(`${bar.name}:collide`);
    expect(env.resolveFunctionId("ghost")).toBeUndefined();
  }, 180_000);

  test("routes a local declaration spelling independently of its Codeable presentation alias", () => {
    const authored = {
      $tag: "Authored" as const,
      source: { $tag: "HostSpec" as const, module: "authoring-declaration-route" },
    };
    const moduleWithDeclaration = (
      name: string,
      declarationName: string,
      codeName: string,
    ): FenelModule => {
      const id = `${name}:${declarationName}`;
      const fn: FenelFunction = {
        id,
        params: [],
        returns: unit,
        body: null,
      };
      return {
        name,
        label: name,
        entities: [],
        functions: [fn],
        functionSignatureDeclarations: [{
          functionId: id,
          declarationName,
          codeName,
          scheme: {
            quantified: [],
            body: { $arrow: { params: [], returns: unit } },
          },
          params: [],
          returns: authored,
        }],
        instances: [{
          typeName: "Codeable",
          args: [id],
          methods: { codeName },
        }],
      };
    };
    const source = moduleWithDeclaration(
      "AuthoringDeclarationSource",
      "sourceLocal",
      "presentedLocal",
    );
    const collision = moduleWithDeclaration(
      "AuthoringDeclarationCollision",
      "otherLocal",
      "presentedLocal",
    );
    const registry = createRegistry([source, collision], {
      dispatchRegistry: createDispatchRegistry(),
      publishCatalogEntities: false,
    });
    const rows = new Map(
      registry.listSourceFunctionResolutions(source.name)
        .map((row) => [row.name, row] as const),
    );
    expect(rows.get("sourceLocal")).toMatchObject({
      status: "resolved",
      targetId: `${source.name}:sourceLocal`,
    });
    expect(rows.get("presentedLocal")?.status).toBe("ambiguous");

    const local = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([], {
      registry,
      sourceModule: source.name,
    }));
    expect(local.resolveFunctionId("sourceLocal")).toBe(`${source.name}:sourceLocal`);
    expect(local.resolveFunctionId("presentedLocal")).toBeUndefined();
  }, 180_000);

  test("publishes final function fences through the frozen source frame", () => {
    const moduleName = "AuthoringFencedSource";
    const id = `${moduleName}:tabulate`;
    const length = field("length", num);
    const dependent: FenelType = {
      $el: { call: ["Vec", { var: "length" }] },
    };
    const source: FenelModule = {
      name: moduleName,
      label: moduleName,
      entities: [],
      functions: [{
        id,
        params: [length],
        returns: dependent,
        body: null,
      }],
      functionSignatureDeclarations: [{
        functionId: id,
        declarationName: "tabulate",
        codeName: "tabulate",
        scheme: {
          quantified: [],
          body: { $arrow: { params: [length], returns: dependent } },
          applications: [],
        },
        params: [{
          $tag: "Authored",
          source: { $tag: "HostSpec", module: moduleName },
        }],
        returns: {
          $tag: "Authored",
          source: { $tag: "HostSpec", module: moduleName },
        },
      }],
      instances: [{
        typeName: "Codeable",
        args: [id],
        methods: { codeName: "tabulate" },
      }],
    };
    const registry = createRegistry([source], {
      dispatchRegistry: createDispatchRegistry(),
      publishCatalogEntities: false,
    });
    expect(registry.getFunctionSignatureInfo(id)?.outcome.$tag).toBe("AnnotationRequired");
    const row = registry.listSourceFunctionResolutions(moduleName)
      .find(({ name }) => name === "tabulate");
    expect(row).toMatchObject({
      status: "fenced",
      targetId: id,
      verdict: "AnnotationRequired",
    });
    expect(row?.diagnostics?.map(({ code }) => code)).toContain(
      "inference.value-dependent-type",
    );

    const fenced = createAuthoringEnvironment(buildAuthoringCatalogSnapshot([], {
      registry,
      sourceModule: moduleName,
    }));
    expect(fenced.hasFunctionRefLiteral("tabulate")).toBeTrue();
    expect(fenced.functionForRefLiteral("tabulate")).toBeUndefined();
  }, 180_000);

  test("keeps declaring-module metadata when exact targets use other namespaces", () => {
    const declaringName = "AuthoringNamespaceContainer";
    const setTarget = "authoring-set:contains";
    const kernelTarget = "authoring-kernel:verify";
    const authored = {
      $tag: "Authored" as const,
      source: { $tag: "HostSpec" as const, module: declaringName },
    };
    const functionFor = (id: string): FenelFunction => ({
      id,
      params: [],
      returns: unit,
      body: null,
    });
    const declarationFor = (
      functionId: string,
      declarationName: string,
    ) => ({
      functionId,
      declarationName,
      codeName: declarationName,
      scheme: {
        quantified: [],
        body: { $arrow: { params: [], returns: unit } },
      },
      params: [],
      returns: authored,
    });
    const declaringModule: FenelModule = {
      name: declaringName,
      label: declaringName,
      functionNamespace: "authoring-set",
      functionNamespaceOverrides: [{
        functionId: kernelTarget,
        namespace: "authoring-kernel",
      }],
      entities: [],
      functions: [functionFor(setTarget), functionFor(kernelTarget)],
      functionSignatureDeclarations: [
        declarationFor(setTarget, "contains"),
        declarationFor(kernelTarget, "kernelVerify"),
      ],
      instances: [],
    };
    const consumerName = "AuthoringNamespaceConsumer";
    const consumerTarget = `${consumerName}:use`;
    const consumer: FenelModule = {
      name: consumerName,
      label: consumerName,
      imports: [
        { module: declaringName, as: "N" },
        { module: declaringName, names: ["kernelVerify"] },
      ],
      entities: [],
      functions: [functionFor(consumerTarget)],
      functionSignatureDeclarations: [declarationFor(consumerTarget, "use")],
      instances: [],
    };
    const registry = createRegistry([declaringModule, consumer], {
      dispatchRegistry: createDispatchRegistry(),
      publishCatalogEntities: false,
    });
    const snapshot = buildAuthoringCatalogSnapshot([], {
      registry,
      sourceModule: consumerName,
    });
    const routes = new Map(
      (snapshot.exactFunctionRoutes ?? []).map((route) => [route.sourceName, route] as const),
    );
    expect(routes.get(`${declaringName}.contains`)).toMatchObject({
      status: "resolved",
      targetId: setTarget,
      entry: { parentModule: declaringName },
    });
    expect(routes.get(`${declaringName}.kernelVerify`)).toMatchObject({
      status: "resolved",
      targetId: kernelTarget,
      entry: { parentModule: declaringName },
    });
    expect(routes.get("N.kernelVerify")).toMatchObject({
      status: "resolved",
      targetId: kernelTarget,
      entry: { parentModule: declaringName },
    });
    expect(routes.get("kernelVerify")?.targetId).toBe(kernelTarget);

    const env = createAuthoringEnvironment(snapshot);
    expect(env.resolveFunctionId("N.contains")).toBe(setTarget);
    expect(env.resolveFunctionId("kernelVerify")).toBe(kernelTarget);
    expect(env.functionCodeName(kernelTarget)).toBe(`${declaringName}.kernelVerify`);
  }, 180_000);

  test("rejects a non-unique authoring source-module alias frame", () => {
    const duplicateModule = (label: string): FenelModule => ({
      name: "AuthoringDuplicateSource",
      label,
      imports: [],
      entities: [],
      functions: [],
      instances: [],
    });
    const registry = createRegistry([
      duplicateModule("first"),
      duplicateModule("second"),
    ], {
      dispatchRegistry: createDispatchRegistry(),
      publishCatalogEntities: false,
    });

    expect(() => buildAuthoringCatalogSnapshot([], {
      registry,
      sourceModule: "AuthoringDuplicateSource",
    })).toThrow("must select exactly one registry module; received 2");
  }, 180_000);

  test("routes overloaded prefix/infix notation by exact alias identity", () => {
    const subParams = [field("a", num), field("b", num)];
    const negateParams = [field("a", num)];
    const subScheme: TypeScheme = {
      quantified: [],
      body: { $arrow: { params: subParams, returns: num } },
    };
    const negateScheme: TypeScheme = {
      quantified: [],
      body: { $arrow: { params: negateParams, returns: str } },
    };
    const operatorSections: CatalogSection[] = [{
      id: "function",
      label: "Functions",
      description: "overloaded operator fixtures",
      entries: [
        {
          id: "math:sub",
          name: "Subtract",
          description: "binary subtraction",
          category: "function",
          fn: { id: "math:sub", params: subParams, returns: num },
          scheme: subScheme,
        },
        {
          id: "math:negate",
          name: "Negate",
          description: "unary negation",
          category: "function",
          fn: { id: "math:negate", params: negateParams, returns: str },
          scheme: negateScheme,
        },
      ],
    }];
    const instances = [
      { args: ["math:sub"], methods: { notation: "-" }, fixity: "infix" as const },
      { args: ["math:negate"], methods: { notation: "-" }, fixity: "prefix" as const },
    ];
    const build = (operatorInstances: typeof instances) =>
      buildAuthoringCatalogSnapshot(operatorSections, {
        codeNameFor: (id) => id.split(":").pop(),
        operatorInstances,
      });
    const overloaded = build(instances);
    const permuted = build([...instances].reverse());
    const aliases = overloaded.functions.filter((entry) => entry.notation === "-");
    const aliasIds = aliases.map((entry) => entry.id).sort();

    expect(aliases).toHaveLength(2);
    expect(aliasIds).toEqual(
      permuted.functions.filter((entry) => entry.notation === "-").map((entry) => entry.id).sort(),
    );
    expect(new Set(aliasIds).size).toBe(2);
    expect(overloaded.operatorCodeNameByNotation.get("-")).toBeUndefined();

    const overloadedEnv = createAuthoringEnvironment(overloaded);
    const subAlias = aliases.find((entry) => entry.targetId === "math:sub")!;
    const negateAlias = aliases.find((entry) => entry.targetId === "math:negate")!;
    expect(subAlias.scheme).toEqual(subScheme);
    expect(negateAlias.scheme).toEqual(negateScheme);
    expect(overloadedEnv.operatorCodeName("-")).toBeUndefined();
    expect(overloadedEnv.operatorCodeName("-", 2)).toBe("sub");
    expect(overloadedEnv.operatorCodeName("-", 1)).toBe("negate");

    const lowerForEvaluation = (node: ExprNode) => exprNodeToLogic(node, {
      fnCodeName: (id) => id,
      operatorCodeName: (_notation, call) =>
        overloadedEnv.operatorCodeName(call.aliasId, call.arity),
    });
    expect(lowerForEvaluation({
      kind: "call",
      fnId: subAlias.id,
      args: [{ kind: "literal", value: 4 }],
    })).toEqual({ call: ["sub", 4] });
    expect(lowerForEvaluation({
      kind: "call",
      fnId: negateAlias.id,
      args: [{ kind: "literal", value: 4 }],
    })).toEqual({ call: ["negate", 4] });

    const inferredSub = inferAuthoringExpression({
      kind: "call",
      fnId: subAlias.id,
      args: [{ kind: "literal", value: 4 }, { kind: "literal", value: 1 }],
    }, overloadedEnv);
    const inferredNegate = inferAuthoringExpression({
      kind: "call",
      fnId: negateAlias.id,
      args: [{ kind: "literal", value: 4 }],
    }, overloadedEnv);
    expect(inferredSub.type).toEqual(num);
    expect(inferredNegate.type).toEqual(str);
  }, 180_000);
});

describe("authoring environment typed refs", () => {
  test("resolves type-position refs and value-position ref literal kind", () => {
    const userRef = Ref("User") as unknown as FenelType;
    expect(refHandle(userRef)).toBe("User");
    expect(refHandle({ $named: "User" } as unknown as FenelType)).toBe("User");
    expect(typePositionRefHandle(userRef)).toBe("User");
    expect(resolveRefToType(userRef, () => undefined, (name) => name === "User" ? userType : undefined)).toEqual(userType);
    expect(refLiteralKind(Ref("add"), (id) => env.hasFunctionRefLiteral(id))).toBe("function");
    expect(refLiteralKind(Ref("User"), (id) => env.hasFunctionRefLiteral(id))).toBe("type");
    expect(env.resolveTypeRef?.(userRef)).toEqual(userType);
  });
});

describe("authoring environment dependent type resolver", () => {
  test("resolves $el var, call, if, match, record-field paths, and unresolved fallbacks", () => {
    expect(dependentTypeForValuePath(env, { $el: { var: "chosen" } } as FenelType, {
      chosen: str,
    })).toEqual(str);

    const callType = dependentTypeForValuePath(
      env,
      { $el: { call: ["lengthBoundedStringOf", { var: "n" }] } } as FenelType,
      { n: 4 },
    );
    expect(callType && "$map" in callType).toBe(true);

    expect(dependentTypeForValuePath(env, {
      $el: { if: [{ "==": [{ var: "kind" }, "number"] }, num, str] },
    } as FenelType, { kind: "number" })).toEqual(num);
    expect(dependentTypeForValuePath(env, {
      $el: { match: [{ var: "kind" }, "number", num, "_", str] },
    } as FenelType, { kind: "other" })).toEqual(str);
    expect(dependentTypeForValuePath(env, { $el: { var: "config.type" } } as FenelType, {
      config: { type: bool },
    })).toEqual(bool);

    const unresolved = { $el: { var: "missing" } } as FenelType;
    expect(dependentTypeForValuePath(env, unresolved, {})).toEqual(unresolved);
  });
});

describe("authoring environment scope planning", () => {
  const typedCall: ExprNode = {
    kind: "call",
    fnId: "fn:app:isAdult",
    args: [{ kind: "param", name: "candidate" }],
  };
  const bindings: LetBindingDraft[] = [
    { name: "candidate", expr: { kind: "literal", value: "Ada" } },
    { name: "label", type: str, expr: { kind: "literal", value: "Ada" } },
  ];

  test("computes let types from values without downstream first-hit inference", () => {
    expect(effectiveLetBindingType(bindings, 0, [], env)).toEqual(str);
    expect(authoringScopeForLetBinding(bindings, 1, [], env)).toEqual([
      { name: "candidate", type: str, scheme: inferredStringScheme },
    ]);

    const missing: LetBindingDraft[] = [
      { name: "candidate", expr: { kind: "literal", value: null } },
    ];
    expect(effectiveLetBindingType(missing, 0, [], env)).toEqual(unit);

    const emptyRecord = { $record: { fields: [] } } as FenelType;
    const emptyBindings: LetBindingDraft[] = [
      {
        name: "empty",
        expr: { kind: "literal", value: { __record: { fields: [] } } },
      },
      { name: "alias", expr: { kind: "param", name: "empty" } },
    ];
    expect(effectiveLetBindingType(emptyBindings, 0, [], env)).toEqual(emptyRecord);
    expect(effectiveLetBindingType(emptyBindings, 1, [], env)).toEqual(emptyRecord);
    expect(authoringScopeForLetBinding(emptyBindings, 1, [], env)).toEqual([{
      name: "empty",
      type: emptyRecord,
      scheme: { quantified: [], body: emptyRecord },
    }]);
  });

  test("plans do-block scope at each statement boundary", () => {
    const body: ExprNode[] = [
      { kind: "literal", value: { __let: { bindings } } },
      typedCall,
    ];
    const scope = authoringScopeForDoBlock(body, [], env);
    expect(scope[0]).toEqual([]);
    expect(scope[1]).toEqual([
      { name: "candidate", type: str, scheme: inferredStringScheme },
      { name: "label", type: str, scheme: { quantified: [], body: str } },
    ]);

    const noBackPropagation = authoringScopeForDoBlock([
      {
        kind: "literal",
        value: {
          __let: {
            bindings: [{ name: "candidate", expr: { kind: "literal", value: null } }],
          },
        },
      },
      typedCall,
    ], [], env);
    expect(noBackPropagation[1]).toEqual([
      { name: "candidate", type: unit, scheme: { quantified: [], body: unit } },
    ]);
  });
});
