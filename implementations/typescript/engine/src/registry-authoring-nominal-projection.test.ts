import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import { loadFenelModule } from "./fenel-module";
import { repositoryIdentityLock } from "./repository-identity-manifest";
import { createDispatchRegistry } from "./dispatch-registry";
import {
  __fieldIdentityDeltaForTests,
  createEngineBootstrapRegistry,
  createIdentityProjectionRegistry,
  createRegistry,
  registryAuthoringNominalHandle,
  type ModuleRegistry,
} from "./registry";
import { inferJsonLogicType, type ModuleMemberInferenceFacts } from "./signature-inference";
import type { FenelModule, FenelType, Instance, TypeScheme } from "./types";

const FIRST = "613504fe-0000-4000-8000-000000000001";
const SECOND = "613504fe-0000-4000-8000-000000000002";
const THIRD = "613504fe-0000-4000-8000-000000000003";
const codeNameLock = new Map([
  ["type/module/ProjectionFirst/Packet", FIRST],
  ["type/module/ProjectionSecond/Packet", SECOND],
  ["type/module/ProjectionFirst/Parcel", THIRD],
]);
let modules: FenelModule[];
let registry: ModuleRegistry;
let nominalIdentities: Map<string, string>;

beforeAll(() => {
  modules = [
    loadFenelModule("module ProjectionFirst where\nPacket = Packet count: Number\nParcel = Parcel value: Number\n", "ProjectionFirst"),
    loadFenelModule("module ProjectionSecond where\nPacket = Packet count: String\n", "ProjectionSecond"),
  ];
  registry = createRegistry(modules, { codeNameLock, publishCatalogEntities: false });
  nominalIdentities = new Map([FIRST, SECOND, THIRD].map(id => [id, registry.getEntityNominalIdentity(id)!]));
}, 180_000);

function infer(facts: ModuleMemberInferenceFacts, identity = FIRST) {
  const packet: TypeScheme = {
    quantified: [], body: { $ref: "Packet" },
    nominals: [{ path: [], identity: nominalIdentities.get(identity)!, publicName: "Packet" }],
  };
  return inferJsonLogicType({ var: "item.count" }, { bindings: { item: packet }, moduleMembers: facts });
}

// Count actual context construction without replacing its factory (which would
// deliberately disqualify the optimized path). Restore the intrinsic each time.
function countContexts<T>(run: () => T): { result: T; contexts: number } {
  const freeze = Object.freeze;
  let contexts = 0;
  const spy = spyOn(Object, "freeze").mockImplementation(<Value>(value: Value) => {
    if (value !== null && typeof value === "object"
      && Object.hasOwn(value, "_typeFamilyNominalHandle") && Object.hasOwn(value, "_callSiteTyping")) contexts++;
    return freeze(value);
  });
  try { return { result: run(), contexts }; }
  finally { spy.mockRestore(); }
}

describe("producer-owned authoring nominal projection", () => {
  test("unknown producers and absent factories are unbranded", () => {
    expect(registryAuthoringNominalHandle({}, undefined)).toBeUndefined();
  });

  test("first acquisition initializes the default context; later inference preserves output without rebuilding", () => {
    expect(registryAuthoringNominalHandle(registry, registry.evaluateContext)).toBeUndefined();
    const first = countContexts(() => infer(registry));
    expect(first.contexts).toBe(1);
    expect(first.result.outcome.$tag).toBe("Solved");
    expect(first.result.type).toEqual({ $ref: "Number" });
    expect(registryAuthoringNominalHandle(registry, registry.evaluateContext)).toBeDefined();
    const next = countContexts(() => infer(registry));
    expect(next.contexts).toBe(0);
    expect(next.result).toEqual(first.result);
  }, 180_000);

  test("copies and proxies take the original factory path and preserve full output", () => {
    const expected = infer(registry);
    for (const facts of [{ ...registry }, new Proxy(registry, {})]) {
      expect(registryAuthoringNominalHandle(facts, registry.evaluateContext)).toBeUndefined();
      const actual = countContexts(() => infer(facts));
      expect(actual.contexts).toBe(1);
      expect(actual.result).toEqual(expected);
    }
  }, 180_000);

  test("exact nominal owners survive a shadowed public name on both paths", () => {
    expect(registry.getIdentifiedEntity("Packet")?.module).toBe("ProjectionSecond");
    for (const [identity, type] of [[FIRST, "Number"], [SECOND, "String"]] as const) {
      const actual = infer(registry, identity);
      expect(actual.outcome.$tag).toBe("Solved");
      expect(actual.type).toEqual({ $ref: type });
      expect(actual).toEqual(infer({ ...registry }, identity));
    }
  }, 180_000);

  test("a replaced factory retains its call order, receiver and hook receiver", () => {
    const original = registry.evaluateContext;
    const events: string[] = [];
    const evaluation = original();
    const customEvaluation = {
      _typeFamilyNominalHandle(this: unknown, ...args: Parameters<NonNullable<typeof evaluation._typeFamilyNominalHandle>>) {
        expect(this).toBe(customEvaluation);
        events.push("handle");
        return evaluation._typeFamilyNominalHandle!(...args);
      },
    };
    registry.evaluateContext = function(this: unknown) {
      expect(this).toBe(registry);
      events.push("factory");
      return customEvaluation as ReturnType<ModuleRegistry["evaluateContext"]>;
    };
    try {
      expect(registryAuthoringNominalHandle(registry, registry.evaluateContext)).toBeUndefined();
      expect(infer(registry).outcome.$tag).toBe("Solved");
      expect(events[0]).toBe("factory");
      expect(events.slice(1).length).toBeGreaterThan(0);
      expect(events.slice(1).every(event => event === "handle")).toBe(true);
    } finally { registry.evaluateContext = original; }
  }, 180_000);

  test("custom factory and hook failures keep their original boundary messages", () => {
    const expected = infer({ ...registry, evaluateContext() { throw new Error("custom context failure"); } });
    expect(JSON.stringify(expected)).toContain("custom context failure");
    for (const value of [false, { _typeFamilyNominalHandle: false }]) {
      const facts = typeof value === "boolean"
        ? { ...registry, evaluateContext: value }
        : { ...registry, evaluateContext: () => value };
      const actual = infer(facts as unknown as ModuleMemberInferenceFacts);
      expect(actual.outcome.$tag).toBe("Invalid");
      expect(JSON.stringify(actual)).toContain(typeof value === "boolean"
        ? "evaluateContext is not callable" : "exact owner projection is not callable");
    }
    let reads = 0;
    for (const key of ["evaluateContext", "_typeFamilyNominalHandle"]) {
      const accessor = Object.defineProperty({}, key, { get() { reads++; throw new Error("must not run"); } });
      const facts = key === "evaluateContext"
        ? Object.defineProperty({ ...registry }, key, Object.getOwnPropertyDescriptor(accessor, key)!)
        : { ...registry, evaluateContext: () => accessor };
      expect(JSON.stringify(infer(facts as ModuleMemberInferenceFacts))).toContain(`accessor property ${key}`);
    }
    expect(reads).toBe(0);
  }, 180_000);

  test("a warmed exact producer still observes replacement errors and accessor refusal", () => {
    const original = Object.getOwnPropertyDescriptor(registry, "evaluateContext")!;
    let reads = 0;
    try {
      registry.evaluateContext = () => { throw new Error("replaced context failure"); };
      expect(JSON.stringify(infer(registry))).toContain("replaced context failure");
      Object.defineProperty(registry, "evaluateContext", { value: false, configurable: true });
      expect(JSON.stringify(infer(registry))).toContain("evaluateContext is not callable");
      Object.defineProperty(registry, "evaluateContext", { configurable: true, get() { reads++; } });
      expect(JSON.stringify(infer(registry))).toContain("accessor property evaluateContext");
      expect(reads).toBe(0);
    } finally { Object.defineProperty(registry, "evaluateContext", original); }
  }, 180_000);

  test("the optional factory is read once and empty nominal requests do not inspect it", () => {
    let descriptors = 0;
    let calls = 0;
    const facts = new Proxy({ ...registry, evaluateContext() { calls++; return registry.evaluateContext(); } }, {
      getOwnPropertyDescriptor(target, key) {
        if (key === "evaluateContext") descriptors++;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(infer(facts).outcome.$tag).toBe("Solved");
    expect(descriptors).toBe(1);
    expect(calls).toBe(1);
    descriptors = 0;
    calls = 0;
    expect(inferJsonLogicType(1, { moduleMembers: facts }).outcome.$tag).toBe("Solved");
    expect(descriptors).toBe(0);
    expect(calls).toBe(0);
  }, 180_000);

  test("owner confirmation and declaration reads remain live after projection admission", () => {
    const identity = registry.getEntityNominalIdentity;
    const entity = registry.getIdentifiedEntity;
    let reads = 0;
    registry.getIdentifiedEntity = name => { reads++; return entity(name); };
    try {
      expect(infer(registry).outcome.$tag).toBe("Solved");
      expect(reads).toBeGreaterThan(0);
      registry.getEntityNominalIdentity = () => "wrong-owner";
      expect(infer(registry).outcome.$tag).toBe("AnnotationRequired");
    } finally {
      registry.getEntityNominalIdentity = identity;
      registry.getIdentifiedEntity = entity;
    }
  }, 180_000);

  test("bootstrap and deferred identity-projection profiles never acquire the direct handle", () => {
    const lock = repositoryIdentityLock();
    const profiles = [
      createEngineBootstrapRegistry(modules, { publishCatalogEntities: false }),
      createRegistry(modules, { publishCatalogEntities: false,
        fieldIdentity: { mode: "collect-requirements", defaultRealm: "repository-source" } }),
      createIdentityProjectionRegistry([], { publishCatalogEntities: false, codeNameLock: lock,
        fieldIdentity: { mode: "strict-embedded", defaultRealm: "repository-source", lock } }),
    ];
    for (const profile of profiles) {
      expect(registryAuthoringNominalHandle(profile, profile.evaluateContext)).toBeUndefined();
      expect(profile.evaluateContext()._typeFamilyNominalHandle).toBeUndefined();
      expect(registryAuthoringNominalHandle(profile, profile.evaluateContext)).toBeUndefined();
    }
  }, 180_000);

  test("factory call shape changes retain data, getter and inherited call behavior", () => {
    registry.evaluateContext();
    const factory = registry.evaluateContext;
    const prototype = Object.getPrototypeOf(factory);
    const expected = infer(registry);
    for (const shape of ["data", "getter", "prototype"] as const) {
      let reads = 0;
      let calls = 0;
      const call = function(this: unknown, receiver: unknown) {
        expect(this).toBe(factory);
        expect(receiver).toBe(registry);
        calls++;
        return Reflect.apply(factory, receiver, []);
      };
      if (shape === "prototype") Object.setPrototypeOf(factory, Object.create(prototype, {
        call: { value: call, configurable: true },
      }));
      else Object.defineProperty(factory, "call", shape === "getter"
        ? { configurable: true, get() { reads++; return call; } }
        : { configurable: true, value: call });
      try {
        const direct = registryAuthoringNominalHandle(registry, factory);
        expect(reads).toBe(0);
        expect(infer(registry)).toEqual(expected);
        expect(calls).toBe(1);
        expect(reads).toBe(shape === "getter" ? 1 : 0);
        expect(direct).toBeUndefined();
      } finally {
        delete (factory as { call?: unknown }).call;
        Object.setPrototypeOf(factory, prototype);
      }
    }
  }, 180_000);

  test("hook call shape changes preserve the original context receiver", () => {
    const context = registry.evaluateContext();
    const hook = context._typeFamilyNominalHandle!;
    const expected = infer(registry);
    const prototype = Object.getPrototypeOf(hook);
    for (const shape of ["data", "getter", "prototype"] as const) {
      let reads = 0;
      const receivers: unknown[] = [];
      const call = function(this: unknown, receiver: unknown, ...args: Parameters<typeof hook>) {
        expect(this).toBe(hook);
        receivers.push(receiver);
        return Reflect.apply(hook, receiver, args);
      };
      if (shape === "prototype") Object.setPrototypeOf(hook, Object.create(prototype, {
        call: { value: call, configurable: true },
      }));
      else Object.defineProperty(hook, "call", shape === "getter"
        ? { configurable: true, get() { reads++; return call; } }
        : { configurable: true, value: call });
      try {
        const direct = registryAuthoringNominalHandle(registry, registry.evaluateContext);
        expect(reads).toBe(0);
        expect(infer(registry)).toEqual(expected);
        expect(receivers.length).toBeGreaterThan(0);
        for (const receiver of receivers) {
          expect(receiver).toBeDefined();
          expect((receiver as typeof context)._constructors).toEqual(context._constructors);
        }
        expect(reads).toBe(shape === "getter" ? receivers.length : 0);
        expect(direct).toBeUndefined();
      } finally {
        delete (hook as { call?: unknown }).call;
        Object.setPrototypeOf(hook, prototype);
      }
    }
  }, 180_000);

  test("the captured Function prototype call primitive is checked without getter reads", () => {
    registry.evaluateContext();
    const descriptor = Object.getOwnPropertyDescriptor(Function.prototype, "call")!;
    for (const accessor of [false, true]) {
      let reads = 0;
      let direct: ReturnType<typeof registryAuthoringNominalHandle>;
      Object.defineProperty(Function.prototype, "call", accessor
        ? { configurable: true, get() { reads++; return descriptor.value; } }
        : { configurable: true, value: function() {} });
      try { direct = registryAuthoringNominalHandle(registry, registry.evaluateContext); }
      finally { Object.defineProperty(Function.prototype, "call", descriptor); }
      expect(reads).toBe(0);
      expect(direct).toBeUndefined();
    }
  });

  test("mid-query call changes materialize one stable receiver without retroactive factory call", () => {
    registry.evaluateContext();
    const factory = registry.evaluateContext;
    const hook = factory()._typeFamilyNominalHandle!;
    const getEntity = registry.getIdentifiedEntity;
    const scheme = (identity: string): TypeScheme => ({ quantified: [], body: { $ref: "Packet" },
      nominals: [{ path: [], identity: nominalIdentities.get(identity)!, publicName: "Packet" }] });
    const query = () => inferJsonLogicType({ do: [{ var: "item.count" }, { var: "other.count" }] }, {
      bindings: { item: scheme(FIRST), other: scheme(SECOND), extra: {
        quantified: [], body: { $ref: "Parcel" },
        nominals: [{ path: [], identity: nominalIdentities.get(THIRD)!, publicName: "Parcel" }],
      } }, moduleMembers: registry,
    });
    const expected = query();
    const queryReceivers: unknown[] = [];
    try {
      for (let round = 0; round < 2; round++) {
        let installed = false;
        let factoryCalls = 0;
        const receivers: unknown[] = [];
        registry.getIdentifiedEntity = name => {
          if (!installed) {
            installed = true;
            Object.defineProperty(factory, "call", { configurable: true, value() {
              factoryCalls++;
              throw new Error("factory call must not run retroactively");
            } });
            Object.defineProperty(hook, "call", { configurable: true,
              value(this: unknown, receiver: unknown, ...args: Parameters<typeof hook>) {
                expect(this).toBe(hook);
                receivers.push(receiver);
                return Reflect.apply(hook, receiver, args);
              } });
          }
          return getEntity(name);
        };
        const actual = countContexts(query);
        expect(actual.result).toEqual(expected);
        expect(installed).toBe(true);
        expect(factoryCalls).toBe(0);
        expect(actual.contexts).toBe(1);
        expect(receivers.length).toBeGreaterThan(1);
        expect(receivers[0]).toBeDefined();
        expect(receivers.every(receiver => receiver === receivers[0])).toBe(true);
        queryReceivers.push(receivers[0]);
        delete (factory as { call?: unknown }).call;
        delete (hook as { call?: unknown }).call;
      }
      expect(queryReceivers[0]).not.toBe(queryReceivers[1]);
    } finally {
      registry.getIdentifiedEntity = getEntity;
      delete (factory as { call?: unknown }).call;
      delete (hook as { call?: unknown }).call;
    }
  }, 180_000);

  test("pool and original module mutations leave late receiver snapshots unchanged", () => {
    const declaration = loadFenelModule("module ProjectionSnapshots where\nColor = SnapshotRed | SnapshotBlue\nBox = Box count: Number\n", "ProjectionSnapshots");
    const instances: Instance[] = [
      { typeName: "Sampleable", args: ["Color"], methods: { sample: "snapshot-sample" } },
      { typeName: "Renderable", args: ["Color"], methods: { render: "snapshot-render" } },
    ];
    const original = { ...declaration, instances: [...(declaration.instances ?? []), ...instances] };
    const pool = createDispatchRegistry();
    for (const instance of instances) pool.addInstance(instance);
    const pooledSamples = pool.listInstances("Sampleable");
    const pooledRenders = pool.listInstances("Renderable");
    expect(pooledSamples).toHaveLength(1);
    expect(pooledRenders).toHaveLength(1);
    expect(pooledSamples[0]!.methods.sample).toBe("snapshot-sample");
    expect(pooledRenders[0]!.methods.render).toBe("snapshot-render");
    const reader = createRegistry([original], { dispatchRegistry: pool, publishCatalogEntities: false });
    const before = reader.evaluateContext();
    const bridge = registryAuthoringNominalHandle(reader, reader.evaluateContext)!;
    const hook = before._typeFamilyNominalHandle!;
    let receiver: typeof before | undefined;
    Object.defineProperty(hook, "call", { configurable: true,
      value(this: unknown, context: typeof before, ...args: Parameters<typeof hook>) {
        receiver = context;
        return Reflect.apply(hook, context, args);
      } });
    try {
      for (const instance of [...instances, ...pooledSamples, ...pooledRenders]) {
        instance.args[0] = "mutated-target";
        instance.methods.sample = "mutated-sample";
        instance.methods.render = "mutated-render";
      }
      expect(pool.listInstances("Sampleable")[0]!.methods.sample).toBe("mutated-sample");
      expect(pool.listInstances("Renderable")[0]!.methods.render).toBe("mutated-render");
      expect(pool.listInstances("Sampleable")[0]!.args[0]).toBe("mutated-target");
      expect(pool.listInstances("Renderable")[0]!.args[0]).toBe("mutated-target");
      const box = original.entities?.find(entity => entity.id === "Box");
      if (box && "$record" in box.type) box.type.$record.fields[0]!.name = "mutated-field";
      bridge("", "Box", reader.getEntityNominalIdentity("Box")!);
      expect(receiver).toBeDefined();
      for (const key of ["_constructors", "_constructorWireNames", "_ctorFieldKeys", "_fieldCurrentWire",
        "_sampleByTag", "_renderByTag", "_caseOwner"] as const) expect(receiver![key]).toEqual(before[key]);
      expect(before._sampleByTag?.SnapshotRed).toBe("snapshot-sample");
      expect(before._renderByTag?.SnapshotRed).toBe("snapshot-render");
    } finally { delete (hook as { call?: unknown }).call; }
  }, 180_000);

  test("captured field collections permanently disqualify their own registry", () => {
    const declaration = loadFenelModule("module ProjectionCapturedFields where\nCapturedPacket = CapturedPacket capturedCount: Number\n", "ProjectionCapturedFields");
    let captured: ModuleRegistry;
    try {
      __fieldIdentityDeltaForTests.capture(true);
      captured = createRegistry([declaration], { publishCatalogEntities: false });
      const exposed = __fieldIdentityDeltaForTests.lastCollection();
      expect(exposed).toBeDefined();
      __fieldIdentityDeltaForTests.capture(false);
      const before = captured.evaluateContext();
      const field = exposed!.entities.find(entity => entity.currentCodeName === "capturedCount")!;
      expect(field).toBeDefined();
      Object.defineProperty(field, "currentCodeName", { value: "changedAfterExposure" });
      expect(captured.evaluateContext()._fieldCurrentWire).not.toEqual(before._fieldCurrentWire);
      expect(registryAuthoringNominalHandle(captured, captured.evaluateContext)).toBeUndefined();
      expect(registryAuthoringNominalHandle(registry, registry.evaluateContext)).toBeDefined();
    } finally { __fieldIdentityDeltaForTests.capture(false); }
  }, 180_000);
});

describe("captured declaration owner evidence", () => {
  const TRANSACTION = "3a5887cf-f2ef-483d-a9e2-0e21c44b7eb2";
  const PERSON = "99185fac-6bf2-4dd4-b6c9-7a01cf482f8a";
  const DATE = "4a6fd49d-82cb-4446-99f5-49afe6c07d09";
  const PRIVATE_RECORD = "613504fe-0000-4000-8000-000000000004";
  const PRIVATE_FIRST = "613504fe-0000-4000-8000-000000000005";
  const PRIVATE_SECOND = "613504fe-0000-4000-8000-000000000006";
  const localModule = (id: string) => `local-owner-${encodeURIComponent(JSON.stringify([
    "fenel-browser-local", `type:${id}`,
  ]))}`;
  const transactionOwner = JSON.stringify([localModule(TRANSACTION), TRANSACTION]);
  const personOwner = JSON.stringify([localModule(PERSON), PERSON]);
  const dateOwner = JSON.stringify(["time", "CalendarDate"]);
  const datePath = ["$record", "fields", "2", "type"];
  const typeKind = { $tag: "KType" } as const;
  const unaryKind = { $tag: "KArrow", input: typeKind, output: typeKind } as const;

  // The committed Local Transaction's actual typeScheme shape: no nominal or
  // application sidecars, exact stored field identities and physical type refs.
  // Only declaration data is copied; this fixture contains no saved values.
  const transaction: TypeScheme = {
    quantified: [],
    body: { $record: { fields: [
      { name: "amount", key: { $tag: "NamedField", ref: { $ref: "55251e48-9875-4f7c-868c-b04360bd4e23" } },
        type: { $ref: "Number" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} },
      { name: "person", key: { $tag: "NamedField", ref: { $ref: "929ef44d-2d50-40b9-98d0-6dabe64b282b" } },
        type: { $ref: PERSON }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} },
      { name: "date", key: { $tag: "NamedField", ref: { $ref: "e808a887-bbf2-4af2-b936-a2d04ccae455" } },
        type: { $ref: DATE }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} },
    ] } },
  };
  let reader: ModuleRegistry;
  const receiver: TypeScheme = {
    quantified: [], body: { $ref: TRANSACTION },
    nominals: [{ path: [], identity: transactionOwner, publicName: TRANSACTION }],
  };
  const project = (facts: ModuleMemberInferenceFacts, field = "date", item = receiver) =>
    inferJsonLogicType({ var: `item.${field}` }, { bindings: { item }, moduleMembers: facts });
  const withoutResolution = (facts: ModuleMemberInferenceFacts): ModuleMemberInferenceFacts => {
    const { resolveTypeInDeclaration: _resolve, ...typing } = facts.callSiteTyping;
    return { ...facts, callSiteTyping: typing };
  };
  const withScheme = (scheme: TypeScheme): ModuleMemberInferenceFacts => ({
    ...reader,
    getIdentifiedEntity(name) {
      const entity = reader.getIdentifiedEntity(name);
      return entity?.id === TRANSACTION ? { ...entity, type: scheme.body, typeScheme: scheme } : entity;
    },
  });
  const withDateType = (type: FenelType): TypeScheme => {
    if (!("$record" in transaction.body)) throw new Error("expected the committed record");
    return { quantified: [], body: { $record: { ...transaction.body.$record,
      fields: transaction.body.$record.fields.map(field => field.name === "date" ? { ...field, type } : field),
    } } };
  };

  beforeAll(() => {
    const privateSource = loadFenelModule(
      "module ProjectionPrivateFirst where\nPrivatePerson = PrivatePerson\nPrivateRecord = PrivateRecord person: PrivatePerson\n",
      "ProjectionPrivateFirst",
    );
    const privateFirst: FenelModule = { ...privateSource, entities: privateSource.entities?.map(entity =>
      entity.id === "PrivateRecord"
        ? { ...entity, typeScheme: { quantified: [], body: entity.type } }
        : entity) };
    const emptyRecord: FenelType = { $record: { fields: [] } };
    const localTransaction: FenelModule = { name: localModule(TRANSACTION), label: "Captured Local Transaction", entities: [
      { id: TRANSACTION, params: [], type: transaction.body, typeScheme: transaction },
    ] };
    const localPerson: FenelModule = { name: localModule(PERSON), label: "Captured Local Person", entities: [
      { id: PERSON, params: [], type: emptyRecord, typeScheme: { quantified: [], body: emptyRecord } },
    ] };
    // These are the three original committed Field descriptors, including
    // their constructor provenance. The fixture does not mint replacement keys.
    const capturedFields = [
      ["55251e48-9875-4f7c-868c-b04360bd4e23", "amount"],
      ["929ef44d-2d50-40b9-98d0-6dabe64b282b", "person"],
      ["e808a887-bbf2-4af2-b936-a2d04ccae455", "date"],
    ] as const;
    reader = createRegistry([
      localTransaction,
      localPerson,
      loadFenelModule("module time where\nCalendarDate = CalendarDate\n", "time"),
      privateFirst,
      loadFenelModule("module ProjectionPrivateSecond where\nPrivatePerson = PrivatePerson\nGlobalOnly = GlobalOnly\n", "ProjectionPrivateSecond"),
    ], {
      publishCatalogEntities: false,
      codeNameLock: new Map([
        ["type/module/time/CalendarDate", DATE],
        ["type/module/ProjectionPrivateFirst/PrivateRecord", PRIVATE_RECORD],
        ["type/module/ProjectionPrivateFirst/PrivatePerson", PRIVATE_FIRST],
        ["type/module/ProjectionPrivateSecond/PrivatePerson", PRIVATE_SECOND],
      ]),
      fieldIdentity: {
        // Keep this owner's source-fixture profile; the committed Local reader
        // is separately exercised by the saved-record integration diagnostic.
        mode: "source-handles", defaultRealm: "repository-source",
        identityKinds: new Map<string, string>([[TRANSACTION, "type"], [PERSON, "type"],
          ...capturedFields.map(([id]) => [id, "field"] as const)]),
        externalFields: capturedFields.map(([id, currentCodeName]) => ({ id, currentCodeName,
          origin: { owner: { $tag: "FunctionFieldOwner", id: "aef212ca-589e-4054-9e79-813a2a8ae102" },
            path: [{ $tag: "FieldNamed", name: currentCodeName }] },
        })),
      },
    });
  }, 180_000);

  test("committed sidecar-free fields retain Number, the Local Person owner and CalendarDate", () => {
    const before = reader.getIdentifiedEntity(TRANSACTION)!.typeScheme!;
    expect(before.quantified).toEqual([]);
    expect(before.nominals ?? []).toEqual([]);
    expect(reader.getEntityNominalIdentity(TRANSACTION)).toBe(transactionOwner);
    expect(reader.getEntityNominalIdentity(PERSON)).toBe(personOwner);
    const source = JSON.stringify(before);
    for (const [field, publicName, identity] of [
      ["amount", "Number", '["system","Number"]'],
      ["person", PERSON, personOwner],
      ["date", DATE, dateOwner],
    ] as const) {
      const actual = project(reader, field);
      expect(actual.outcome.$tag).toBe("Solved");
      expect(actual.type).toEqual({ $ref: publicName });
      expect(actual.scheme?.nominals).toEqual([{ path: [], identity, publicName }]);
    }
    expect(project({ ...reader })).toEqual(project(reader));
    expect(JSON.stringify(reader.getIdentifiedEntity(TRANSACTION)!.typeScheme)).toBe(source);
    expect(transaction.nominals).toBeUndefined();
  }, 180_000);

  test("a shadowed private spelling is resolved in the selected declaration's frame", () => {
    expect(reader.getIdentifiedEntity("PrivatePerson")?.module).toBe("ProjectionPrivateSecond");
    const item: TypeScheme = {
      quantified: [], body: { $ref: "PrivateRecord" },
      nominals: [{ path: [], identity: reader.getEntityNominalIdentity(PRIVATE_RECORD)!, publicName: "PrivateRecord" }],
    };
    const actual = project(reader, "person", item);
    expect(actual.outcome.$tag).toBe("Solved");
    expect(actual.scheme?.nominals).toEqual([{ path: [],
      identity: reader.getEntityNominalIdentity(PRIVATE_FIRST)!, publicName: "PrivatePerson" }]);
    expect(actual.scheme?.nominals?.[0]?.identity).not.toBe(reader.getEntityNominalIdentity(PRIVATE_SECOND));
    expect(reader.getIdentifiedEntity("GlobalOnly")).toBeDefined();
    const unavailable = withDateType({ $ref: "GlobalOnly" });
    expect(reader.callSiteTyping.resolveTypeInDeclaration!(unavailable.body, transactionOwner).ok).toBe(false);
    const fenced = project(withScheme(unavailable));
    expect(fenced.outcome.$tag).toBe("AnnotationRequired");
    expect(fenced).toEqual(project(withoutResolution(withScheme(unavailable))));
  }, 180_000);

  test("missing, refusing and unreadable optional hooks preserve the original owner fence", () => {
    const baseline = project(withoutResolution(reader));
    expect(baseline.outcome.$tag).toBe("AnnotationRequired");
    expect(JSON.stringify(baseline)).toContain(`${DATE} without an owner identity`);
    let accessorReads = 0;
    const hooks = [
      undefined,
      false,
      () => ({ ok: false, reason: "missing", message: "no captured owner" }),
      () => { throw new Error("unavailable captured resolver"); },
    ];
    for (const resolveTypeInDeclaration of hooks) {
      const facts = { ...reader, callSiteTyping: { ...reader.callSiteTyping, resolveTypeInDeclaration } };
      expect(project(facts as unknown as ModuleMemberInferenceFacts)).toEqual(baseline);
    }
    const typing = Object.defineProperty({ ...reader.callSiteTyping }, "resolveTypeInDeclaration", {
      get() { accessorReads++; throw new Error("must not read"); },
    });
    expect(project({ ...reader, callSiteTyping: typing })).toEqual(baseline);
    expect(accessorReads).toBe(0);
  }, 180_000);

  test("a successful hook must carry the unchanged ground body and matching nominal paths", () => {
    const resolution = reader.callSiteTyping.resolveTypeInDeclaration!(transaction.body, transactionOwner);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error(resolution.message);
    const baseline = project(withoutResolution(reader));
    let sidecarReads = 0;
    const invalid: TypeScheme[] = [
      { quantified: [], body: { $ref: DATE }, nominals: [{ path: [], identity: dateOwner, publicName: DATE }] },
      { ...resolution.type, quantified: [{ id: "q0", sourceName: "a", kind: typeKind }] },
      { ...resolution.type, nominals: [{ path: datePath, identity: dateOwner, publicName: "CalendarDate" }] },
      { ...resolution.type, nominals: [{ path: ["absent"], identity: dateOwner, publicName: DATE }] },
      Object.defineProperty({ ...resolution.type }, "nominals", {
        get() { sidecarReads++; throw new Error("must not read returned sidecar"); },
      }),
    ];
    for (const type of invalid) {
      expect(project({ ...reader, callSiteTyping: { ...reader.callSiteTyping,
        resolveTypeInDeclaration: () => ({ ok: true, type } as const),
      } })).toEqual(baseline);
    }
    expect(sidecarReads).toBe(0);
    let calls = 0;
    const typing = { ...reader.callSiteTyping,
      resolveTypeInDeclaration(this: unknown, type: FenelType, owner: string) {
        expect(this).toBe(typing);
        if (owner === transactionOwner) calls++;
        return reader.callSiteTyping.resolveTypeInDeclaration!(type, owner);
      },
    };
    expect(project({ ...reader, callSiteTyping: typing }).outcome.$tag).toBe("Solved");
    expect(calls).toBe(1);
  }, 180_000);

  test("partial, explicit foreign and conflicting carried identities are never replaced", () => {
    const foreign = '["different-reader","CalendarDate"]';
    const dateNominal = { path: datePath, identity: foreign, publicName: DATE };
    const schemes: TypeScheme[] = [
      { ...transaction, nominals: [{ path: ["$record", "fields", "0", "type"],
        identity: '["system","Number"]', publicName: "Number" }] },
      { ...transaction, nominals: [dateNominal] },
      { ...transaction, nominals: [dateNominal, { ...dateNominal, identity: dateOwner }] },
    ];
    for (const [index, scheme] of schemes.entries()) {
      let selectedOwnerCalls = 0;
      const facts = withScheme(scheme);
      const actual = project({ ...facts, callSiteTyping: { ...reader.callSiteTyping,
        resolveTypeInDeclaration(type, owner) {
          if (owner === transactionOwner) selectedOwnerCalls++;
          return reader.callSiteTyping.resolveTypeInDeclaration!(type, owner);
        },
      } });
      expect(actual).toEqual(project(withoutResolution(facts)));
      expect(selectedOwnerCalls).toBe(0);
      expect(actual.outcome.$tag).toBe(index === 1 ? "Solved" : "AnnotationRequired");
      if (index === 1) expect(actual.scheme?.nominals).toEqual([{ path: [], identity: foreign, publicName: DATE }]);
    }
  }, 180_000);

  test("quantified application evidence keeps its original outcome without calling the ground hook", () => {
    const type: FenelType = { $el: { call: ["Maybe", { $var: "a" }] } };
    const scheme: TypeScheme = { ...withDateType(type),
      quantified: [{ id: "q0", sourceName: "a", kind: typeKind }],
      applications: [{ path: datePath, headRef: "Maybe", args: [{ $var: "a" }], kind: unaryKind }],
      nominals: [{ path: datePath, identity: '["system","Maybe"]', publicName: "Maybe" }],
    };
    const item: TypeScheme = { ...receiver, body: { $el: { call: [TRANSACTION, { $ref: "Number" }] } },
      applications: [{ path: [], headRef: TRANSACTION, args: [{ $ref: "Number" }], kind: unaryKind }],
    };
    for (const [index, declaration] of [scheme, { ...scheme, nominals: [] }].entries()) {
      const facts = withScheme(declaration);
      const baseline = project(withoutResolution(facts), "date", item);
      let selectedOwnerCalls = 0;
      const actual = project({ ...facts, callSiteTyping: { ...reader.callSiteTyping,
        resolveTypeInDeclaration(type, owner) {
          if (owner === transactionOwner) selectedOwnerCalls++;
          return reader.callSiteTyping.resolveTypeInDeclaration!(type, owner);
        },
      } }, "date", item);
      expect(actual).toEqual(baseline);
      expect(actual.outcome.$tag).toBe(index === 0 ? "Solved" : "AnnotationRequired");
      if (index === 0) expect(actual.type).toEqual({ $el: { call: ["Maybe", { $ref: "Number" }] } });
      expect(selectedOwnerCalls).toBe(0);
    }
  }, 180_000);

  test("ground resolution does not invent missing application sidecars or erase source diagnostics", () => {
    const application = withDateType({ $el: { call: ["Maybe", { $ref: "Number" }] } });
    const missingApplication = project(withScheme(application));
    expect(missingApplication.outcome.$tag).toBe("AnnotationRequired");
    expect(missingApplication).toEqual(project(withoutResolution(withScheme(application))));
    const diagnosed: TypeScheme = { ...transaction, diagnostics: [{ code: "source.unresolved",
      declaration: TRANSACTION, path: datePath, spelling: DATE, message: "retained source diagnostic" }] };
    const result = project(withScheme(diagnosed));
    expect(result.outcome.$tag).toBe("AnnotationRequired");
    expect(result).toEqual(project(withoutResolution(withScheme(diagnosed))));
    expect(JSON.stringify(result)).toContain("has unresolved source binding diagnostics");
  }, 180_000);
});
