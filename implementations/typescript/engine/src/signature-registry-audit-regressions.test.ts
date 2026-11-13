import { describe, expect, test } from "bun:test";

import {
  buildAuthoringCatalogSnapshot,
  createAuthoringEnvironment,
  resolveAuthoringTypeRef,
} from "./authoring/environment";
import {
  inferAuthoringExpression,
  peelToRecordType,
} from "./authoring/expression-authoring";
import { createDispatchRegistry } from "./dispatch-registry";
import { seedFromType } from "./effect-dispatch";
import { loadFenelModule } from "./fenel-module";
import { createRegistry } from "./registry";
import { __catalogHasRegisteredEntityForTests } from "./type-catalog";
import { Nothing } from "./type-foundation";
import type {
  FenelModule,
  FenelType,
  FieldDef,
  Instance,
  Interface,
  TypeScheme,
} from "./types";

const ref = (name: string): FenelType => ({ $ref: name });

function namedField(
  name: string,
  ordinal: number,
  type: FenelType,
): FieldDef {
  return {
    name,
    key: {
      $tag: "NamedField",
      ref: {
        $ref: `91000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
      },
    },
    label: Nothing,
    type,
    meta: {},
    ui: Nothing,
  };
}

function emptyEntity(id: string, module: string) {
  const type: FenelType = { $record: { fields: [] } };
  return {
    id,
    module,
    type,
    typeScheme: { quantified: [], body: type } satisfies TypeScheme,
  };
}

function recordScheme(fields: readonly FieldDef[]): TypeScheme {
  return {
    quantified: [],
    body: { $record: { fields: [...fields] } },
  };
}

describe("registry capability inference audit regressions", () => {
  test("an absent declaration infers its SMethod call from the exact capability scheme", () => {
    const input = emptyEntity("AuditMethodInput", "audit-method-contract");
    const output = emptyEntity("AuditMethodOutput", "audit-method-contract");
    const transformType: FenelType = {
      $arrow: {
        params: [namedField("value", 1, ref(input.id))],
        returns: ref(output.id),
      },
    };
    const probeScheme = recordScheme([
      namedField("transform", 2, transformType),
    ]);
    const contractModule: FenelModule = {
      name: "audit-method-contract",
      label: "Audit method contract",
      entities: [
        input,
        output,
        {
          id: "AuditMethodProbe",
          module: "audit-method-contract",
          type: probeScheme.body,
          typeScheme: probeScheme,
        },
      ],
      functions: [],
      instances: [],
    };
    const probe = seedFromType(
      "AuditMethodProbe",
      probeScheme.body,
      "a",
      { typeScheme: probeScheme, sourceModule: contractModule },
    );
    const dispatch = createDispatchRegistry();
    dispatch.defineClass(probe);

    const consumerModule = loadFenelModule(
      "invoke value = AuditMethodProbe.transform value",
      "audit-method-consumer",
    );
    const sourceFunction = consumerModule.functions?.find(
      ({ id }) => id === "audit-method-consumer:invoke",
    );
    const declaration = consumerModule.functionSignatureDeclarations?.find(
      ({ functionId }) => functionId === sourceFunction?.id,
    );
    expect(sourceFunction?.body).toEqual({
      method: ["AuditMethodProbe", "transform", { var: "value" }],
    });
    expect(declaration?.params).toEqual([{ $tag: "Absent" }]);
    expect(declaration?.returns).toEqual({ $tag: "Absent" });

    const registry = createRegistry([contractModule, consumerModule], {
      dispatchRegistry: dispatch,
      publishCatalogEntities: false,
    });
    const effective = registry.getFunction("audit-method-consumer:invoke");
    const info = registry.getFunctionSignatureInfo("audit-method-consumer:invoke");

    expect(info?.outcome.$tag).toBe("Solved");
    expect(info?.params.map(({ $tag }) => $tag)).toEqual(["Inferred"]);
    expect(info?.returns.$tag).toBe("Inferred");
    expect(effective?.params[0]?.type).toEqual(ref(input.id));
    expect(effective?.returns).toEqual(ref(output.id));
    expect(info?.scheme.nominals).toContainEqual({
      path: ["$arrow", "params", "0", "type"],
      identity: '["audit-method-contract","AuditMethodInput"]',
      publicName: "AuditMethodInput",
    });
    expect(info?.scheme.nominals).toContainEqual({
      path: ["$arrow", "returns"],
      identity: '["audit-method-contract","AuditMethodOutput"]',
      publicName: "AuditMethodOutput",
    });
  }, 180_000);

  test("a same-spelled entity cannot lend scheme authority to an unlinked Interface", () => {
    const left = emptyEntity("AuditFallbackShared", "audit-fallback-left");
    const right = emptyEntity("AuditFallbackShared", "audit-fallback-right");
    const leftModule: FenelModule = {
      name: "audit-fallback-left",
      label: "Audit fallback left",
      entities: [left],
      functions: [],
      instances: [],
    };
    const rightModule: FenelModule = {
      name: "audit-fallback-right",
      label: "Audit fallback right",
      entities: [right],
      functions: [],
      instances: [],
    };
    const probeScheme = recordScheme([
      namedField("read", 3, ref("AuditFallbackShared")),
    ]);
    const contractModule: FenelModule = {
      name: "audit-fallback-contract",
      label: "Audit fallback contract",
      imports: [{
        module: "audit-fallback-left",
        names: ["AuditFallbackShared"],
      }],
      entities: [{
        id: "AuditFallbackProbe",
        module: "audit-fallback-contract",
        type: probeScheme.body,
        typeScheme: probeScheme,
      }],
      functions: [],
      instances: [],
    };
    // This literal intentionally has no parser-owned Interface scheme sidecar.
    // The unique AuditFallbackProbe entity above is the only authority available.
    const probe: Interface = {
      name: "AuditFallbackProbe",
      methods: [{
        name: "read",
        params: [],
        returns: ref("AuditFallbackShared"),
      }],
    };
    const dispatch = createDispatchRegistry();
    dispatch.defineClass(probe);

    const registry = createRegistry([
      rightModule,
      contractModule,
      leftModule,
    ], {
      dispatchRegistry: dispatch,
      publishCatalogEntities: false,
    });
    const signature = registry.getCapabilityMethodSignature(
      "AuditFallbackProbe.read",
    );

    expect(signature?.outcome.$tag).toBe("AnnotationRequired");
    expect(signature?.returns).toEqual(ref("AuditFallbackShared"));
    expect(signature?.scheme).toBeUndefined();
    expect(signature?.outcome).toHaveProperty(
      "diagnostics.0.code",
      "inference.capability-method-scheme-required",
    );
  }, 180_000);

  test("registry authoring uses its frozen method roster and preserves a method fence", () => {
    const probe: Interface = {
      name: "AuditFencedMethodProbe",
      methods: [{
        name: "read",
        params: [],
        returns: ref("String"),
      }],
    };
    const dispatch = createDispatchRegistry();
    dispatch.defineClass(probe);
    const registry = createRegistry([], {
      dispatchRegistry: dispatch,
      publishCatalogEntities: false,
    });
    const registrySignature = registry.getCapabilityMethodSignature(
      "AuditFencedMethodProbe.read",
    );
    if (registrySignature === undefined) {
      throw new Error("missing fenced registry method signature");
    }
    expect(registrySignature?.outcome.$tag).toBe("AnnotationRequired");
    expect(registrySignature?.scheme).toBeUndefined();

    // A registry-backed authoring snapshot must not reread this caller-owned
    // interface or let the late phantom method replace the frozen roster.
    probe.methods.splice(0, probe.methods.length, {
      name: "phantom",
      params: [namedField("poison", 5, ref("Number"))],
      returns: ref("Boolean"),
    });
    const snapshot = buildAuthoringCatalogSnapshot([], {
      registry,
      interfaces: [probe],
      capabilityMethodOwners: ["AuditFencedMethodProbe"],
    });
    const sameNameNominal: FenelType = {
      $record: { fields: [namedField("value", 6, ref("String"))] },
    };
    snapshot.types.push({
      id: "entity:audit-fenced-method-same-name",
      name: "AuditFencedMethodProbe.read",
      description: "same-spelled nominal must not bypass the callable fence",
      category: "entity",
      entityId: "AuditFencedMethodProbe.read",
      type: sameNameNominal,
    });
    const methods = snapshot.functions.filter(({ kind }) => kind === "method");
    expect(methods.map(({ id }) => id)).toEqual([
      "AuditFencedMethodProbe.read",
    ]);
    const method = methods[0];
    expect(method?.scheme).toBeUndefined();
    expect(method?.signatureOutcome).toEqual(registrySignature.outcome);

    const env = createAuthoringEnvironment(snapshot, {
      getFunction: () => ({
        id: "poison:compatibility-fallback",
        params: [],
        returns: ref("Boolean"),
      }),
    });
    const inferred = inferAuthoringExpression({
      kind: "call",
      fnId: "AuditFencedMethodProbe.read",
      args: [],
    }, env);
    expect(inferred.outcome).toEqual(registrySignature.outcome);
    expect(inferred.outcome.$tag).toBe("AnnotationRequired");
    expect(env.functionForRefLiteral("AuditFencedMethodProbe.read")).toBeUndefined();
    expect(env.resolveTypeRef?.(ref("AuditFencedMethodProbe.read"))).toBeUndefined();
    expect(env.resolveNamedType?.("AuditFencedMethodProbe.read")).toEqual(sameNameNominal);
    expect(resolveAuthoringTypeRef(env, ref("AuditFencedMethodProbe.read"))).toBeUndefined();
    expect(peelToRecordType(ref("AuditFencedMethodProbe.read"), env)).toBeUndefined();
  }, 180_000);

  test("rejects nested capability compatibility accessors without invoking them", () => {
    const hostileParam = namedField("value", 7, ref("String"));
    let reads = 0;
    Object.defineProperty(hostileParam, "type", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        throw new Error("nested capability type accessor was invoked");
      },
    });
    const hostile: Interface = {
      name: "AuditHostileCapabilityDto",
      methods: [{
        name: "read",
        params: [hostileParam],
        returns: ref("String"),
      }],
    };
    const dispatch = createDispatchRegistry();
    dispatch.defineClass(hostile);

    expect(() => createRegistry([], {
      dispatchRegistry: dispatch,
      publishCatalogEntities: false,
    })).toThrow("accessor property");
    expect(reads).toBe(0);
  }, 180_000);
});

describe("registry constructor exact provenance and qualifier routing", () => {
  test("public constructor signatures resolve payload nominals in the owner import frame", () => {
    const left = emptyEntity("AuditConstructorShared", "audit-constructor-left");
    const right = emptyEntity("AuditConstructorShared", "audit-constructor-right");
    const leftModule: FenelModule = {
      name: "audit-constructor-left",
      label: "Audit constructor left",
      entities: [left],
      functions: [],
      instances: [],
    };
    const rightModule: FenelModule = {
      name: "audit-constructor-right",
      label: "Audit constructor right",
      entities: [right],
      functions: [],
      instances: [],
    };
    const boxType: FenelType = {
      $variant: {
        cases: [{
          name: "AuditConstructorBox",
          label: Nothing,
          fields: [namedField("value", 30, ref("AuditConstructorShared"))],
        }],
      },
    };
    const contractModule: FenelModule = {
      name: "audit-constructor-contract",
      label: "Audit constructor contract",
      imports: [{
        module: "audit-constructor-left",
        names: ["AuditConstructorShared"],
      }],
      entities: [{
        id: "AuditConstructorOwner",
        module: "audit-constructor-contract",
        type: boxType,
        typeScheme: { quantified: [], body: boxType },
      }],
      functions: [],
      instances: [],
    };
    const registry = createRegistry([
      rightModule,
      contractModule,
      leftModule,
    ], {
      dispatchRegistry: createDispatchRegistry(),
      publishCatalogEntities: false,
    });
    const signature = registry.listConstructorSignatures().find(
      ({ ownerName, name }) =>
        ownerName === "AuditConstructorOwner" && name === "AuditConstructorBox",
    );

    expect(signature?.outcome.$tag).toBe("Solved");
    expect(signature?.scheme?.nominals).toContainEqual({
      path: ["$arrow", "params", "0", "type"],
      identity: '["audit-constructor-left","AuditConstructorShared"]',
      publicName: "AuditConstructorShared",
    });
  }, 180_000);

  test("a real constructor module head wins over a same-spelled import alias", () => {
    const constructorEntity = (
      module: string,
      id: string,
    ) => {
      const type: FenelType = {
        $variant: {
          cases: [{ name: "Pick", label: Nothing, fields: [] }],
        },
      };
      return {
        id,
        module,
        type,
        typeScheme: { quantified: [], body: type } satisfies TypeScheme,
      };
    };
    const realModule: FenelModule = {
      name: "AuditCtorHead",
      label: "Real constructor head",
      entities: [constructorEntity("AuditCtorHead", "AuditRealCtorOwner")],
      functions: [],
      instances: [],
    };
    const aliasTarget: FenelModule = {
      name: "audit-ctor-alias-target",
      label: "Alias constructor target",
      entities: [constructorEntity(
        "audit-ctor-alias-target",
        "AuditAliasCtorOwner",
      )],
      functions: [],
      instances: [],
    };
    const consumerFn = {
      id: "audit-ctor-consumer:make",
      params: [],
      returns: { $var: "compat-return" } as FenelType,
      body: { construct: ["AuditCtorHead.Pick"] },
    };
    const consumerModule: FenelModule = {
      name: "audit-ctor-consumer",
      label: "Constructor qualifier consumer",
      imports: [{ module: "audit-ctor-alias-target", as: "AuditCtorHead" }],
      entities: [],
      functions: [consumerFn],
      functionSignatureDeclarations: [{
        functionId: consumerFn.id,
        declarationName: "make",
        codeName: "make",
        params: [],
        returns: { $tag: "Absent" },
      }],
      instances: [],
    };
    const registry = createRegistry([
      aliasTarget,
      consumerModule,
      realModule,
    ], {
      dispatchRegistry: createDispatchRegistry(),
      publishCatalogEntities: false,
    });
    const info = registry.getFunctionSignatureInfo(consumerFn.id);

    expect(info?.outcome.$tag).toBe("Solved");
    expect(registry.getFunction(consumerFn.id)?.returns).toEqual(
      ref("AuditRealCtorOwner"),
    );
    expect(info?.scheme.nominals).toContainEqual({
      path: ["$arrow", "returns"],
      identity: '["AuditCtorHead","AuditRealCtorOwner"]',
      publicName: "AuditRealCtorOwner",
    });
  }, 180_000);
});

type EvaluationSnapshotFixture = {
  module: FenelModule;
  instances: Instance[];
  instance: Instance;
  args: string[];
  methods: Record<string, unknown>;
  caseName: string;
  sampleTarget: string;
};

function evaluationSnapshotFixture(suffix: string): EvaluationSnapshotFixture {
  const entityName = `AuditSnapshotShape${suffix}`;
  const caseName = `AuditSnapshotCase${suffix}`;
  const sampleTarget = `audit-snapshot:${suffix}`;
  const args = [entityName];
  const methods: Record<string, unknown> = {
    sample: { $ref: sampleTarget },
  };
  const instance: Instance = {
    typeName: "Sampleable",
    args,
    methods,
  };
  const instances = [instance];
  return {
    module: {
      name: `audit-snapshot-${suffix}`,
      label: `Audit snapshot ${suffix}`,
      entities: [{
        id: entityName,
        type: {
          $variant: {
            cases: [{ name: caseName, label: Nothing, fields: [] }],
          },
        },
      }],
      functions: [],
      instances,
    },
    instances,
    instance,
    args,
    methods,
    caseName,
    sampleTarget,
  };
}

function snapshotRegistry(fixture: EvaluationSnapshotFixture) {
  return createRegistry([fixture.module], {
    dispatchRegistry: createDispatchRegistry(),
    publishCatalogEntities: false,
  });
}

function expectSnapshotSample(
  fixture: EvaluationSnapshotFixture,
  registry: ReturnType<typeof snapshotRegistry>,
) {
  expect(registry.evaluateContext()._sampleByTag?.[fixture.caseName]).toBe(
    fixture.sampleTarget,
  );
}

describe("evaluateContext registry-local instance snapshots", () => {
  test("later mutation of the caller-owned instances array is ignored", () => {
    const fixture = evaluationSnapshotFixture("array");
    const registry = snapshotRegistry(fixture);
    fixture.instances.splice(0, fixture.instances.length);

    expectSnapshotSample(fixture, registry);
  }, 180_000);

  test("a later module.instances accessor is neither invoked nor observed", () => {
    const fixture = evaluationSnapshotFixture("envelope");
    const registry = snapshotRegistry(fixture);
    let reads = 0;
    Object.defineProperty(fixture.module, "instances", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        throw new Error("late module.instances getter was invoked");
      },
    });

    expectSnapshotSample(fixture, registry);
    expect(reads).toBe(0);
  }, 180_000);

  test("later instance-argument accessors are neither invoked nor observed", () => {
    const fixture = evaluationSnapshotFixture("args");
    const registry = snapshotRegistry(fixture);
    let reads = 0;
    Object.defineProperty(fixture.args, "0", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        throw new Error("late instance argument getter was invoked");
      },
    });

    expectSnapshotSample(fixture, registry);
    expect(reads).toBe(0);
  }, 180_000);

  test("later instance-method accessors are neither invoked nor observed", () => {
    const fixture = evaluationSnapshotFixture("methods");
    const registry = snapshotRegistry(fixture);
    let reads = 0;
    Object.defineProperty(fixture.methods, "sample", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        throw new Error("late instance method getter was invoked");
      },
    });

    expectSnapshotSample(fixture, registry);
    expect(reads).toBe(0);
  }, 180_000);
});

describe("listEntities registry-local publication", () => {
  test("freezes registry-local entity/module views and isolates all caller-owned inputs", () => {
    const entityId = "AuditImmutableListEntity_RegistryPhase2";
    const moduleName = "audit-immutable-list-entity";
    const rawType: FenelType = { $record: { fields: [] } };
    const rawInterface: Interface = { name: entityId, methods: [] };
    const rawEntity = {
      id: entityId,
      type: rawType,
      params: ["a"],
      interface: rawInterface,
    };
    const rawEntities = [rawEntity];
    const rawInstances: Instance[] = [];
    const rawModule: FenelModule = {
      name: moduleName,
      label: "Audit immutable list entity",
      entities: rawEntities,
      functions: [],
      instances: rawInstances,
    };
    const registry = createRegistry([rawModule], {
      dispatchRegistry: createDispatchRegistry(),
    });

    const listed = registry.listEntities();
    const listedEntity = listed.find(({ id, module }) =>
      id === entityId && module === moduleName
    );
    if (listedEntity === undefined) throw new Error("missing focused listed entity");
    if (!("$record" in listedEntity.type)) {
      throw new Error("focused listed entity lost its record type");
    }
    const listedRecord = listedEntity.type.$record;
    const constructorBefore = registry.listConstructorSignatures().find(
      ({ ownerName, ownerModule }) =>
        ownerName === entityId && ownerModule === moduleName,
    );
    const runtimeConstructorBefore = registry.evaluateContext()._constructors?.[entityId];
    const moduleView = registry.modules[0];
    if (moduleView === undefined) throw new Error("missing focused module view");

    expect(listedEntity).not.toBe(rawEntity);
    expect(listedEntity.type).not.toBe(rawType);
    expect(Object.isFrozen(listed)).toBeTrue();
    expect(Object.isFrozen(listedEntity)).toBeTrue();
    expect(Object.isFrozen(listedEntity.type)).toBeTrue();
    expect(Object.isFrozen(listedRecord.fields)).toBeTrue();
    expect(constructorBefore).toBeDefined();
    expect(runtimeConstructorBefore).toEqual([]);
    expect(__catalogHasRegisteredEntityForTests(entityId, moduleName)).toBeTrue();

    expect(() => {
      (listed as unknown as Array<{ id: string }>).splice(0, 1);
    }).toThrow();
    expect(() => {
      listedEntity.id = "AuditImmutableListEntity_Poisoned";
    }).toThrow();
    expect(() => {
      listedRecord.fields.push(
        namedField("poison", 4, ref("String")),
      );
    }).toThrow();

    rawType.$record.fields.push(namedField("late", 6, ref("Number")));
    rawEntity.params.push("b");
    rawInterface.methods.push({
      name: "late",
      params: [],
      returns: ref("Boolean"),
    });
    rawModule.label = "Poisoned late label";
    rawEntities.splice(0, rawEntities.length);
    rawInstances.push({
      typeName: "Codeable",
      args: ["late:poison"],
      methods: { codeName: "poison" },
    });
    let lateAccessorReads = 0;
    Object.defineProperty(rawModule, "lateAccessor", {
      enumerable: true,
      configurable: true,
      get() {
        lateAccessorReads += 1;
        throw new Error("late module accessor was invoked");
      },
    });

    expect(registry.getEntity(entityId)?.type).toEqual({
      $record: { fields: [] },
    });
    expect(registry.getEntity(entityId)?.params).toEqual(["a"]);
    expect(registry.getEntity(entityId)?.interface?.methods).toEqual([]);
    expect(registry.listEntities().some(({ id, module }) =>
      id === entityId && module === moduleName
    )).toBeTrue();
    expect(registry.listConstructorSignatures().find(
      ({ ownerName, ownerModule }) =>
        ownerName === entityId && ownerModule === moduleName,
    )).toEqual(constructorBefore);
    expect(registry.evaluateContext()._constructors?.[entityId]).toEqual(
      runtimeConstructorBefore,
    );
    expect(moduleView.label).toBe("Audit immutable list entity");
    expect(moduleView.entities?.map(({ id }) => id)).toEqual([entityId]);
    expect(moduleView.instances).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(moduleView, "lateAccessor")).toBeFalse();
    expect(lateAccessorReads).toBe(0);
    expect(__catalogHasRegisteredEntityForTests(entityId, moduleName)).toBeTrue();
  }, 180_000);
});

/** A published top-level scheme as a readable shape: type variables are renamed
 * in order of appearance and named parameter keys keep only their spelling, so
 * an inferred scheme and its annotated twin compare without their identities. */
function publishedArrowShape(type: FenelType): string {
  const variables = new Map<string, string>();
  const walk = (current: FenelType): string => {
    if ("$var" in current) {
      const name = current.$var;
      if (!variables.has(name)) variables.set(name, `v${variables.size}`);
      return variables.get(name)!;
    }
    if ("$arrow" in current) {
      const params = current.$arrow.params.map((param) => {
        const fieldKey = param.key;
        const key = fieldKey?.$tag === "PositionalField"
          ? `${param.name}@${fieldKey.index}`
          : `named:${param.name}`;
        return `${key}: ${walk(param.type)}`;
      });
      return `(${params.join(", ")}) -> ${walk(current.$arrow.returns)}`;
    }
    return JSON.stringify(current);
  };
  return walk(type);
}

describe("un-annotated functions returning functions publish at their own parameter width", () => {
  test("every returned-function shape builds; the remainder is a nested positional arrow equal to the annotated twin", () => {
    const inferred = loadFenelModule([
      "module retfn where",
      "id2 x = x",
      "readB x = id2",
      "id3 y = y",
      "readC x = id3",
      "readD x = \\z -> z",
      "k2 a b = a",
      "readE x = k2",
      "id6 y = y",
      "readF = id6",
      "useB n = readB n n",
    ].join("\n"), "retfn");
    const annotated = loadFenelModule([
      "module retfntwin where",
      "id2 : a -> a",
      "id2 x = x",
      "readB : a -> (b -> b)",
      "readB x = id2",
    ].join("\n"), "retfntwin");
    // Before the fix the whole build threw: `duplicate wire field name x` for
    // readB, `effective parameter width changed` for readC/readD/readE/readF.
    const registry = createRegistry([inferred, annotated]);
    const shape = (id: string): string => {
      const info = registry.getFunctionSignatureInfo(id);
      if (info === undefined) throw new Error(`missing signature info for ${id}`);
      return publishedArrowShape(info.scheme.body);
    };

    const returnsUnary = "(named:x: v0) -> (_0@0: v1) -> v1";
    expect(shape("retfn:readB")).toBe(returnsUnary);
    expect(shape("retfntwin:readB")).toBe(returnsUnary);
    expect(shape("retfn:readC")).toBe(returnsUnary);
    expect(shape("retfn:readD")).toBe(returnsUnary);
    expect(shape("retfn:readE")).toBe("(named:x: v0) -> (_0@0: v1, _1@1: v2) -> v1");
    expect(shape("retfn:readF")).toBe("() -> (_0@0: v0) -> v0");
    expect(registry.getFunction("retfn:readB")?.params.map(({ name }) => name)).toEqual(["x"]);
    expect(registry.getFunction("retfn:readF")?.params).toEqual([]);
    // An over-applying caller sees the nested arrow through call flattening.
    expect(shape("retfn:useB")).toBe("(named:n: v0) -> v0");
  }, 900_000);
});
