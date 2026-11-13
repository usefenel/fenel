// F0 (2026-11-01) — a Local definition's id is its identity: a canonical UUID.
//
// Review finding (workstreams/development-performance/notes/
// 2026-11-01-layered-registry-design.md §12, blocking 1): a Local function
// whose id is a plain word (`value`) and whose body reaches an effectful
// function was accepted, and every repository function whose body reads
// `{var: "value"}` gained that effect in its inferred `requires`. Effect
// inference reads a dotless variable as a possible callee by design (a false
// edge only adds requires), and the name resolved to the Local id. So
// `authority:permits` stopped being resolvable as the reader's judge
// (`registry.ts:authorityResolvableFunction` refuses a non-empty `requires`)
// and that reader refused every act.
//
// The Local snapshot admission now refuses a non-UUID definition id before any
// registry is built. A Codeable NAME is not an id: a Local function with a UUID
// id whose name is `value` must leave every repository `requires` unchanged.
import { describe, expect, test } from "bun:test";
import { createAccountFieldRegistry, createLocalFieldRegistry, projectAccountFieldRegistrySnapshot, projectLocalFieldRegistrySnapshot } from "./account-field-registry";
import { createLocalRegistry, createLocalRegistryAsync, createAccountRegistry, createAccountRegistryAsync } from "./repository-registry";
import { repositoryIdentityKinds } from "./repository-identity-manifest";
import { createDispatchRegistry, GLOBAL_ONLY, instanceVisible } from "./dispatch-registry";
import { dispatchRegistry as systemPool } from "./system-entities";
import { AUTHORITY_PERMITS_ID } from "./modules/authority";
import type { ModuleRegistry } from "./registry";
import type { FenelModule } from "./types";

type Snapshot = Parameters<typeof createLocalFieldRegistry>[2];
const SOURCE = "f0-local-identity";
const HAS_TIME = [{ class: { $tag: "Id", entityId: "HasTime" }, args: [{ $var: "scope" }] }];
// A repository function with a declared effect, standing in for `time:now`
// (the review's probe used the seed; this keeps the build small).
const repository: FenelModule = {
  name: "f0probe",
  functions: [
    { id: "f0probe:tick", params: [], returns: { $ref: "Number" }, requires: HAS_TIME, body: 0 },
  ],
} as unknown as FenelModule;

const LOCAL_ID = "f0f0f0f0-0000-4000-8000-000000000001";
const owner = (id: string, codeName: string) => ({
  ownerKey: `function:${id}`, storageName: id, kind: "function",
  definition: {
    id, params: [], returns: { $ref: "Number" },
    signatureDeclaration: { functionId: id, declarationName: codeName, codeName,
      params: [], returns: { $tag: "Absent" } },
    body: { call: ["f0probe:tick"] },
  },
});
const snapshot = (owners: unknown[]) => ({ owners, fields: [], facets: [] }) as unknown as Snapshot;
// The tag-scoped Codeable row the Local source gives a named function.
const codeable = (id: string, codeName: string) => ({ typeName: "Codeable", args: [id], methods: { codeName },
  priority: 1000, scope: { kind: "tag", tag: SOURCE } });

/** The worker's Local pool (`reader-registry.ts:buildLocalReaderFieldRegistry`):
 * system classes, GLOBAL_ONLY rows, then the source's representation rows. */
function pool(rows: readonly unknown[] = []) {
  const dispatch = createDispatchRegistry();
  for (const cls of systemPool.listClasses()) dispatch.defineClass(cls);
  for (const instance of systemPool.listInstances()) {
    if (instanceVisible(instance, GLOBAL_ONLY)) dispatch.addInstance(instance);
  }
  for (const row of rows) dispatch.addInstance(structuredClone(row) as never);
  return dispatch;
}

const requiresOf = (registry: ModuleRegistry) =>
  new Map(registry.listFunctions().map(fn => [fn.id, JSON.stringify(fn.requires ?? [])]));
const changedRepositoryRequires = (before: Map<string, string>, after: ModuleRegistry) => {
  const now = requiresOf(after);
  return [...before].filter(([id, value]) => now.get(id) !== value).map(([id]) => id);
};

describe("F0: Local definition ids are UUIDs", () => {
  test("the Local snapshot admission refuses a non-UUID function id, naming it", () => {
    expect(() => projectLocalFieldRegistrySnapshot(SOURCE, snapshot([owner("value", "value")])))
      .toThrow(/value/);
    expect(() => projectLocalFieldRegistrySnapshot(SOURCE, snapshot([owner("value", "value")])))
      .toThrow(/UUID/);
  }, 600_000);

  test("a Local build refuses the review's B4 snapshot (id `value`, an effectful body)", () => {
    expect(() => createLocalFieldRegistry([repository], SOURCE, snapshot([owner("value", "value")])))
      .toThrow(/not a UUID/);
  }, 600_000);

  test("a non-UUID Local type id is refused too", () => {
    const type = { ownerKey: "type:Sizing", storageName: "Sizing", kind: "type",
      definition: { id: "Sizing", type: { $record: { fields: [] } } } };
    expect(() => projectLocalFieldRegistrySnapshot(SOURCE, snapshot([type]))).toThrow(/Sizing/);
  }, 600_000);

  test("a UUID Local function NAMED `value` changes no repository requires", () => {
    const empty = createLocalFieldRegistry([repository], SOURCE, snapshot([]), { dispatchRegistry: pool() });
    const before = requiresOf(empty);
    // The channel exists: the authority judge reads `{var: "value"}` (the
    // review probe's `authority:authorityAxisMember`), and is pure.
    expect(before.get(AUTHORITY_PERMITS_ID)).toBe("[]");
    const named = createLocalFieldRegistry([repository], SOURCE, snapshot([owner(LOCAL_ID, "value")]),
      { dispatchRegistry: pool([codeable(LOCAL_ID, "value")]) });
    // The Local body was analysed: the function itself carries the effect.
    expect(JSON.parse(requiresOf(named).get(LOCAL_ID) ?? "[]").map((row: { class: { entityId: string } }) => row.class.entityId))
      .toEqual(["HasTime"]);
    expect(changedRepositoryRequires(before, named)).toEqual([]);
    expect(named.getFunction(AUTHORITY_PERMITS_ID)?.requires ?? []).toEqual([]);
  }, 600_000);
});

// The root cause (orchestrator answer 1, 2026-11-01): a repository function's
// inferred requires never depend on a Local or account definition, whatever
// its id. `registry.ts:lookupForInference` skips non-repository targets for a
// repository caller; a Local/account caller keeps every edge.
describe("F0: repository requires never depend on Local or account definitions", () => {
  const ACCOUNT = "f0-account";
  const effectNames = (requires: unknown) => (requires as { class: { entityId: string } }[] | undefined ?? [])
    .map(row => row.class.entityId);

  test("a Local owner module function with id `value`, built past the Local admission", () => {
    const before = requiresOf(createLocalFieldRegistry([repository], SOURCE, snapshot([]), { dispatchRegistry: pool() }));
    const raw = { name: "local-owner-f0-raw", functions: [owner("value", "value").definition] } as unknown as FenelModule;
    const local = createLocalRegistry([repository], [raw], { dispatchRegistry: pool(), bodySpellingPolicy: "reject" });
    expect(effectNames(local.getFunction("value")?.requires)).toEqual(["HasTime"]);
    expect(changedRepositoryRequires(before, local)).toEqual([]);
    expect(local.getFunction(AUTHORITY_PERMITS_ID)?.requires ?? []).toEqual([]);
  }, 600_000);

  test("an account function named `value` (its legacy name is its id) with an effectful body", () => {
    const before = requiresOf(createAccountFieldRegistry([repository], ACCOUNT, snapshot([]), { dispatchRegistry: pool() }));
    const account = createAccountFieldRegistry([repository], ACCOUNT, snapshot([owner("value", "value")]), { dispatchRegistry: pool() });
    expect(effectNames(account.getFunction("value")?.requires)).toEqual(["HasTime"]);
    expect(changedRepositoryRequires(before, account)).toEqual([]);
    expect(account.getFunction(AUTHORITY_PERMITS_ID)?.requires ?? []).toEqual([]);
  }, 600_000);

  test("an account caller of an account callee keeps its edge, through a call and through a variable", () => {
    const caller = (id: string, body: unknown) => ({ ...owner(id, id), definition: { ...owner(id, id).definition, body } });
    const account = createAccountFieldRegistry([repository], ACCOUNT, snapshot([owner("value", "value"),
      caller("callsValue", { call: ["value"] }), caller("readsValue", { if: [true, 1, { var: "value" }] })]), { dispatchRegistry: pool() });
    expect(effectNames(account.getFunction("callsValue")?.requires)).toEqual(["HasTime"]);
    expect(effectNames(account.getFunction("readsValue")?.requires)).toEqual(["HasTime"]);
  }, 600_000);
});

// F0 continuation: declarations cannot replace any physical repository
// reservation. References and scoped names remain ordinary authored data.
describe("authored definitions preserve repository identity reservations", () => {
  const reservations = repositoryIdentityKinds();
  const reservedId = (kind: "function" | "type" | "field" | "reserved") => {
    const row = [...reservations].find(([, actual]) => actual === kind);
    if (!row) throw new Error(`The repository fixture has no ${kind} reservation`);
    return row[0];
  };
  const typeOwner = (id: string) => ({ ownerKey: `type:${id}`, storageName: id, kind: "type",
    definition: { id, type: { $ref: "Number" } } });
  const functionOwner = (id: string) => ({ ownerKey: `function:${id}`, storageName: id, kind: "function",
    definition: { id, params: [], returns: { $ref: "Number" }, body: 1 } });
  const expectedDiagnostic = (id: string) => ({ $tag: "ReservedDefinitionIdentity",
    handle: id, repositoryKind: reservations.get(id), message: expect.stringContaining(id) });
  const refusal = (operation: () => unknown) => {
    let failure: unknown;
    try { operation(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    return (failure as { diagnostic?: unknown } | undefined)?.diagnostic;
  };
  const projectors = [
    ["Local", (value: Snapshot) => projectLocalFieldRegistrySnapshot(SOURCE, value)],
    ["account", (value: Snapshot) => projectAccountFieldRegistrySnapshot("identity-reservations", value)],
  ] as const;

  for (const [label, project] of projectors) {
    for (const kind of ["function", "type", "field", "reserved"] as const) {
      test(`${label} snapshot refuses a function id reserved as ${kind}`, () => {
        const id = reservedId(kind);
        const input = snapshot([functionOwner(LOCAL_ID), functionOwner(id)]);
        const original = structuredClone(input);
        expect(refusal(() => project(input))).toMatchObject(expectedDiagnostic(id));
        expect(input).toEqual(original);
      }, 60_000);
    }

    test(`${label} snapshot refuses a same-kind repository type id`, () => {
      const id = reservedId("type");
      expect(refusal(() => project(snapshot([typeOwner(id)])))).toMatchObject(expectedDiagnostic(id));
    }, 60_000);

    test(`${label} reports the first reserved definition in declaration order`, () => {
      const first = reservedId("function"), second = reservedId("type");
      expect(refusal(() => project(snapshot([functionOwner(first), typeOwner(second)]))))
        .toMatchObject(expectedDiagnostic(first));
      expect(refusal(() => project(snapshot([typeOwner(second), functionOwner(first)]))))
        .toMatchObject(expectedDiagnostic(second));
    }, 60_000);

    test(`${label} admits references to repository UUIDs without claiming them`, () => {
      const callableId = reservedId("function"), typeId = reservedId("type");
      const value = { ...functionOwner(LOCAL_ID), definition: {
        ...functionOwner(LOCAL_ID).definition,
        returns: { $ref: typeId }, body: { call: [callableId] },
      } };
      const projected = project(snapshot([value]));
      expect(projected.ownerModules.flatMap(module => module.functions ?? []).find(fn => fn.id === LOCAL_ID))
        .toMatchObject({ id: LOCAL_ID, returns: { $ref: typeId }, body: { call: [callableId] } });
    }, 60_000);
  }

  test("a scoped Codeable name may match a repository spelling", () => {
    const dispatch = pool([codeable(LOCAL_ID, "negate")]);
    const registry = createLocalFieldRegistry([repository], SOURCE, snapshot([owner(LOCAL_ID, "negate")]),
      { dispatchRegistry: dispatch });
    expect(registry.getFunction(LOCAL_ID)?.id).toBe(LOCAL_ID);
    expect(dispatch.listInstances("Codeable").some(row => row.args[0] === LOCAL_ID && row.methods.codeName === "negate"))
      .toBe(true);
  }, 600_000);

  const rawModule = (kind: "function" | "type", id: string): FenelModule => ({ name: "identity-reservation-raw",
    ...(kind === "function" ? { functions: [functionOwner(id).definition] } : { entities: [typeOwner(id).definition] }),
  }) as unknown as FenelModule;
  const syncConstructors = [["Local", createLocalRegistry], ["account", createAccountRegistry]] as const;
  const asyncConstructors = [["Local", createLocalRegistryAsync], ["account", createAccountRegistryAsync]] as const;
  const hostileOptions = (input: FenelModule) => [
    { fieldIdentity: { mode: "legacy", defaultRealm: "repository-source" } },
    { fieldIdentity: { baseIdentityKinds: new Map() }, baseIdentityKinds: new Map() },
    { fieldIdentity: { moduleRealms: new Map([[input, "repository-source"]]), defaultRealm: "repository-source" },
      moduleRealms: new Map([[input, "repository-source"]]) },
  ];

  for (const [label, create] of syncConstructors) {
    for (const kind of ["function", "type"] as const) test(`raw ${label} constructor refuses same-kind ${kind} takeover`, () => {
      const id = reservedId(kind), input = rawModule(kind, id), original = structuredClone(input);
      // Empty repositoryModules still reserves the complete physical manifest.
      expect(refusal(() => create([], [input]))).toMatchObject(expectedDiagnostic(id));
      expect(input).toEqual(original);
    }, 60_000);

    test(`raw ${label} constructor refuses an accessor id without invoking it`, () => {
      let reads = 0;
      const input = rawModule("function", LOCAL_ID);
      Object.defineProperty(input.functions![0]!, "id", { enumerable: true,
        get() { reads++; return reservedId("function"); } });
      expect(() => create([], [input])).toThrow(/accessor|own data/);
      expect(reads).toBe(0);
    }, 60_000);

    test(`raw ${label} constructor binds repository reservations despite caller policy overrides`, () => {
      const id = reservedId("function"), input = rawModule("function", id);
      for (const options of hostileOptions(input)) {
        expect(refusal(() => create([], [input], options as unknown as Parameters<typeof createLocalRegistry>[2])))
          .toMatchObject(expectedDiagnostic(id));
      }
    }, 60_000);
  }

  for (const [label, create] of asyncConstructors) {
    for (const kind of ["function", "type"] as const) test(`raw async ${label} constructor refuses same-kind ${kind} takeover`, async () => {
      const id = reservedId(kind), input = rawModule(kind, id), original = structuredClone(input);
      await expect(create([], [input])).rejects.toMatchObject({ diagnostic: expectedDiagnostic(id) });
      expect(input).toEqual(original);
    }, 60_000);

    test(`raw async ${label} constructor refuses an accessor id without invoking it`, async () => {
      let reads = 0;
      const input = rawModule("function", LOCAL_ID);
      Object.defineProperty(input.functions![0]!, "id", { enumerable: true,
        get() { reads++; return reservedId("function"); } });
      await expect(create([], [input])).rejects.toThrow(/accessor|own data/);
      expect(reads).toBe(0);
    }, 60_000);

    test(`raw async ${label} constructor binds repository reservations despite caller policy overrides`, async () => {
      const id = reservedId("function"), input = rawModule("function", id);
      for (const options of hostileOptions(input)) {
        await expect(create([], [input], options as unknown as Parameters<typeof createLocalRegistryAsync>[2]))
          .rejects.toMatchObject({ diagnostic: expectedDiagnostic(id) });
      }
    }, 60_000);
  }

  test("a cold process refuses a raw Local takeover, then builds a valid raw Local registry", () => {
    const probe = `
      import assert from "node:assert/strict";
      const { createLocalRegistry } = await import(${JSON.stringify(new URL("./repository-registry.ts", import.meta.url).href)});
      const { REPOSITORY_IDENTITY_MANIFEST } = await import(${JSON.stringify(new URL("./repository-identity-manifest.ts", import.meta.url).href)});
      const collision = REPOSITORY_IDENTITY_MANIFEST.entries.find(([name, , kind]) => name === "std:negate" && kind === "function")?.[1];
      assert.equal(typeof collision, "string", "Expected the canonical std:negate fixture identity");
      const declaration = id => ({ id, params: [], returns: { $ref: "Number" }, body: 123 });
      let rejected;
      try { createLocalRegistry([], [{ name: "cold-invalid-local", functions: [declaration(collision)] }]); }
      catch (error) { rejected = error; }
      assert.equal(rejected?.diagnostic?.$tag, "ReservedDefinitionIdentity");
      assert.equal(rejected.diagnostic.handle, collision);
      assert.equal(rejected.diagnostic.repositoryKind, "function");
      const validId = "f0f0f0f0-0000-4000-8000-000000000021";
      const recovered = createLocalRegistry([], [{ name: "cold-valid-local", functions: [{ ...declaration(validId), body: 7 }] }]);
      assert.equal(recovered.getFunction(validId)?.id, validId);
      assert.equal(recovered.getFunction(validId)?.body, 7);
      assert.equal(recovered.listFunctions().some(fn => fn.id === collision), false);
      console.log("IDENTITY_COLD_RECOVERY " + JSON.stringify({ refused: true, recoveredId: validId, recoveredBody: 7, takeoverPublished: false }));
    `;
    const run = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", probe], {
      env: { ...process.env, FENEL_PARSER_LEGACY: "1", FENEL_ENGINE_BODY_REPLAY: "" },
      stdout: "pipe", stderr: "pipe", timeout: 180_000,
    });
    if (run.exitCode !== 0) throw new Error(`Cold Local identity probe failed (${run.exitCode}): ${run.stderr.toString().slice(-4000)}`);
    const receipt = run.stdout.toString().split("\n").filter(line => line.startsWith("IDENTITY_COLD_RECOVERY ")).at(-1);
    expect(receipt).toBeDefined();
    expect(JSON.parse(receipt!.slice("IDENTITY_COLD_RECOVERY ".length))).toEqual({
      refused: true, recoveredId: "f0f0f0f0-0000-4000-8000-000000000021", recoveredBody: 7, takeoverPublished: false,
    });
  }, 240_000);
});
