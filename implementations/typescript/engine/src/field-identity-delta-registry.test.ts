// S2 — registry-level differential test of the base + delta field path.
//
// Every leg builds the same registry twice: once through the retained-base
// delta path, once with the delta disabled (every build then runs the
// monolithic field step). The two must expose identical field identities,
// entities and lock requests, and use identical field collections (occurrences,
// entities, lock requests, attachments, view plans); or both must refuse with
// the same error.
import { afterAll, describe, expect, test } from "bun:test";
import {
  fieldIdentityDeltaOutcomes,
  fieldIdentityKernelRunCounts,
  fieldOwnerForEntity,
  fieldPath,
  qualifiedFieldName,
} from "./field-identity";
import { __fieldIdentityDeltaForTests as hooks, closeRegistryPreparationWorker, createRegistry, createRegistryAsync, type ModuleRegistry } from "./registry";
import { __registryPreparationWorkerForTests as preparation } from "./field-identity-worker-client";
import { repositoryIdentityKinds, repositoryIdentityLock } from "./repository-identity-manifest";
import { createLocalFieldRegistry, createLocalFieldRegistryAsync } from "./account-field-registry";
import { systemEntities } from "./system-entities";
import type { FenelModule, FenelType, FieldDef, FieldKey } from "./types";

const Nothing = { $tag: "Nothing" } as const;
const StringT: FenelType = { $ref: "String" };
const NumberT: FenelType = { $ref: "Number" };
const field = (name: string, type: FenelType = StringT, key?: FieldKey): FieldDef =>
  ({ name, type, ...(key === undefined ? {} : { key }), label: Nothing, ui: Nothing, meta: {} });
const named = (id: string): FieldKey => ({ $tag: "NamedField", ref: { $ref: id } });
const record = (...fields: FieldDef[]): FenelType => ({ $record: { fields } });
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LOCAL_A = uuid("41000000", 1);
const PX = uuid("61000000", 1);
const PY = uuid("61000000", 2);
const ADOPTED = uuid("61000000", 3);
const module = (name: string, entities: { id: string; type: FenelType }[]): FenelModule =>
  ({ name, entities, functions: [] }) as unknown as FenelModule;

const repoContent = () => [{ id: "S3Point", type: record(field("px"), field("py")) }];
const repoModule = module("s2reg", repoContent());
const baseLock = (): Map<string, string> => {
  const lock = repositoryIdentityLock();
  const owner = fieldOwnerForEntity({ id: "S3Point", module: "s2reg" });
  lock.set(qualifiedFieldName(owner, [fieldPath.named("px")]), PX);
  lock.set(qualifiedFieldName(owner, [fieldPath.named("py")]), PY);
  return lock;
};
const kindsWith = (extra: [string, string][]) => {
  const kinds = repositoryIdentityKinds();
  kinds.set(PX, "field"); kinds.set(PY, "field");
  for (const [h, k] of extra) kinds.set(h, k);
  return kinds;
};
type Inputs = { repos: FenelModule[]; local: FenelModule; lock: Map<string, string>; kinds: Map<string, string>;
  external: { id: string; currentCodeName: string }[] };
const optionsFor = (inputs: Inputs) => ({
  publishCatalogEntities: false,
  fieldIdentity: {
    mode: "strict-embedded" as const, defaultRealm: "repository-source" as const,
    moduleRealms: new Map([[inputs.local, "account-authored" as const]]),
    lock: inputs.lock, identityKinds: inputs.kinds, externalFields: inputs.external,
    // As the product's account/Local constructors set it (repository-registry.ts).
    emptyDeltaBase: true,
  },
});
const localCount = (name: string) => module(name, [{ id: `t-${name}`, type: record(field("count", NumberT, named(LOCAL_A)), field("px", StringT, named(PX))) }]);
const standard = (local: FenelModule, overrides: Partial<Inputs> = {}): Inputs => ({
  repos: [repoModule], local, lock: baseLock(), kinds: kindsWith([[LOCAL_A, "field"]]),
  external: [{ id: LOCAL_A, currentCodeName: "count" }], ...overrides,
});

const publicView = (registry: ModuleRegistry) => ({
  identities: registry.listFieldIdentities(),
  entities: registry.listFieldEntities(),
  requests: registry.listFieldLockRequests(),
});
const collectionView = () => {
  const collection = hooks.lastCollection();
  if (collection === undefined) throw new Error("no captured field collection");
  return {
    occurrences: collection.occurrences, entities: collection.entities, lockRequests: collection.lockRequests,
    needsMint: collection.needsMint, attachments: collection.attachments, viewPlans: collection.viewPlans,
  };
};
type Built = { registry?: ModuleRegistry; error?: string; collection?: ReturnType<typeof collectionView> };
async function buildOnce(run: () => ModuleRegistry | Promise<ModuleRegistry>): Promise<Built> {
  hooks.capture(true);
  try {
    const registry = await run();
    return { registry, collection: collectionView() };
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  } finally {
    hooks.capture(false);
  }
}
/** Build through the delta path, then with the delta disabled; compare. */
async function differential(inputs: Inputs, viaAsync = false): Promise<string | undefined> {
  const delta = await buildOnce(() => viaAsync
    ? createRegistryAsync([...inputs.repos, inputs.local], optionsFor(inputs))
    : createRegistry([...inputs.repos, inputs.local], optionsFor(inputs)));
  const outcome = fieldIdentityDeltaOutcomes().at(-1);
  hooks.setEnabled(false);
  let mono: Built;
  try {
    mono = await buildOnce(() => createRegistry([...inputs.repos, inputs.local], optionsFor(inputs)));
  } finally {
    hooks.setEnabled(true);
  }
  expect(delta.error).toBe(mono.error);
  if (mono.error === undefined) {
    expect(publicView(delta.registry!)).toEqual(publicView(mono.registry!));
    expect(delta.collection).toEqual(mono.collection);
  }
  return outcome;
}

describe("S2 registry differential: delta path vs monolithic field step", () => {
  test("cold, warm, and a new repository module object", async () => {
    hooks.clearBases();
    expect(await differential(standard(localCount("local-owner-c1")))).toBe("delta");
    expect(hooks.retainedBaseCount()).toBe(1);
    expect(await differential(standard(localCount("local-owner-c1")))).toBe("delta");
    // A fresh repository module object with the same content: another key,
    // so a fresh base for it.
    const before = fieldIdentityDeltaOutcomes().length;
    expect(await differential(standard(localCount("local-owner-c1"), { repos: [module("s2reg", repoContent())] }))).toBe("delta");
    expect(fieldIdentityDeltaOutcomes().length).toBe(before + 1);
  }, 600_000);

  test("a Local id shadowing a system entity changes the roster", async () => {
    const shadowed = systemEntities.find((entity) => entity.type !== undefined && !entity.id.includes(":") && entity.id !== "Maybe" && entity.id !== "Result")!;
    expect(shadowed).toBeDefined();
    hooks.clearBases();
    await differential(standard(localCount("local-owner-s1")));
    const shadowing = module("local-owner-s2", [{ id: shadowed.id, type: record(field("count", NumberT, named(LOCAL_A))) }]);
    await differential(standard(shadowing));
  }, 600_000);

  test("a remembered base refusal, and its retry under other kinds", async () => {
    hooks.clearBases();
    const adoptingRepo = module("s2adopt", [{ id: "S3Adopt", type: record(field("adopted", StringT, named(ADOPTED))) }]);
    const lock = baseLock();
    lock.set(qualifiedFieldName(fieldOwnerForEntity({ id: "S3Adopt", module: "s2adopt" }), [fieldPath.named("adopted")]), ADOPTED);
    const inputs = (kinds: Map<string, string>) => standard(localCount("local-owner-r1"), {
      repos: [repoModule, adoptingRepo], lock, kinds,
      external: [{ id: LOCAL_A, currentCodeName: "count" }, { id: ADOPTED, currentCodeName: "adopted" }],
    });
    const kinds = kindsWith([[LOCAL_A, "field"], [ADOPTED, "field"]]);
    expect(await differential(inputs(kinds))).toBe("base-error:UnresolvedFieldHandle");
    expect(await differential(inputs(kinds))).toBe("base-refused-earlier");
    const otherKinds = kindsWith([[LOCAL_A, "field"], [ADOPTED, "field"], [uuid("41000000", 9), "type"]]);
    expect(await differential(inputs(otherKinds))).toBe("base-error:UnresolvedFieldHandle");
  }, 600_000);

  test("a base made under another lock is dropped and rebuilt", async () => {
    hooks.clearBases();
    expect(await differential(standard(localCount("local-owner-l1")))).toBe("delta");
    const moved = baseLock();
    moved.set("field:s2-extra/named%3Arow", uuid("61000000", 99));
    expect(await differential(standard(localCount("local-owner-l1"), { lock: moved }))).toBe("DeltaLockChanged");
    expect(hooks.retainedBaseCount()).toBe(0);
    const again = baseLock();
    again.set("field:s2-extra/named%3Arow", uuid("61000000", 99));
    expect(await differential(standard(localCount("local-owner-l1"), { lock: again }))).toBe("delta");
    expect(hooks.retainedBaseCount()).toBe(1);
  }, 600_000);

  test("an asynchronous build extends a base a synchronous build retained", async () => {
    hooks.clearBases();
    expect(await differential(standard(localCount("local-owner-a1")))).toBe("delta");
    expect(await differential(standard(localCount("local-owner-a1")), true)).toBe("delta");
    expect(fieldIdentityDeltaOutcomes().at(-2)).not.toMatch(/^worker-base:/);
  }, 600_000);

  // W1: without a base on this thread, the persistent preparation worker
  // makes one on the first asynchronous build and extends it on the next.
  test("asynchronous builds extend the base their persistent preparation worker retains", async () => {
    hooks.clearBases();
    closeRegistryPreparationWorker();
    const spawned = preparation.spawned();
    expect(await differential(standard(localCount("local-owner-w1")), true)).toBe("delta");
    expect(fieldIdentityDeltaOutcomes().at(-2)).toBe("worker-base:made");
    expect(await differential(standard(localCount("local-owner-w2")), true)).toBe("delta");
    expect(fieldIdentityDeltaOutcomes().at(-2)).toBe("worker-base:reused");
    expect(preparation.spawned()).toBe(spawned + 1);
    // A session close ends the worker and its base; the next build makes one.
    closeRegistryPreparationWorker();
    expect(preparation.alive()).toBe(false);
    expect(await differential(standard(localCount("local-owner-w2")), true)).toBe("delta");
    expect(fieldIdentityDeltaOutcomes().at(-2)).toBe("worker-base:made");
    expect(preparation.spawned()).toBe(spawned + 2);
  }, 600_000);
});

// base-on-empty (2026-10-30): a Local/account build without Local roots goes
// through a base and an empty delta, so the next build that adds a Local root
// extends that base instead of running the monolithic kernel and then making
// the base.
describe("S2 registry: a base kept on an empty Local build", () => {
  const emptyLocal = (name: string) => module(name, []);
  const runs = () => fieldIdentityKernelRunCounts();
  test("an empty Local build keeps a base; the next build with a Local root extends it", async () => {
    hooks.clearBases();
    const before = runs();
    expect(await differential(standard(emptyLocal("local-owner-e1")))).toBe("delta");
    expect(hooks.retainedBaseCount()).toBe(1);
    expect(await differential(standard(localCount("local-owner-e1")))).toBe("delta");
    expect(hooks.retainedBaseCount()).toBe(1);
    const after = runs();
    // One base for both builds; the monolithic kernel ran only for the two
    // comparison builds of the differential, never on the delta path.
    expect(after.base - before.base).toBe(1);
    expect(after.kernel - before.kernel).toBe(2);
  }, 600_000);

  test("no Local module at all is an empty delta at the end of the module roots", async () => {
    hooks.clearBases();
    const inputs = standard(emptyLocal("local-owner-e2"));
    const options = optionsFor(inputs);
    const delta = await buildOnce(() => createRegistry([...inputs.repos], options));
    expect(fieldIdentityDeltaOutcomes().at(-1)).toBe("delta");
    hooks.setEnabled(false);
    let mono: Built;
    try { mono = await buildOnce(() => createRegistry([...inputs.repos], options)); } finally { hooks.setEnabled(true); }
    expect(delta.error).toBeUndefined();
    expect(publicView(delta.registry!)).toEqual(publicView(mono.registry!));
    expect(delta.collection).toEqual(mono.collection);
    // The Local module of the next build sits at that split.
    const before = runs();
    expect(await differential(standard(localCount("local-owner-e2")))).toBe("delta");
    expect(runs().base - before.base).toBe(0);
  }, 600_000);

  test("the product's Local constructors keep the base on an empty snapshot, inline and borrowed", async () => {
    hooks.clearBases();
    closeRegistryPreparationWorker();
    const repo = module("s2empty", [{ id: "S3Unit", type: record() }]);
    const empty = { owners: [], fields: [], facets: [] } as never;
    const fn = (id: string) => ({ owners: [{ ownerKey: `function:${id}`, kind: "function", storageName: id,
      definition: { id, params: [], returns: StringT, body: "probe" } }], fields: [], facets: [] }) as never;
    const before = runs();
    createLocalFieldRegistry([repo], "s2-empty-tab", empty);
    expect(fieldIdentityDeltaOutcomes().at(-1)).toBe("delta");
    expect(hooks.retainedBaseCount()).toBe(1);
    createLocalFieldRegistry([repo], "s2-empty-tab", fn(uuid("42000000", 1)));
    expect(fieldIdentityDeltaOutcomes().at(-1)).toBe("delta");
    expect(runs().base - before.base).toBe(1);
    expect(runs().kernel - before.kernel).toBe(0);
    // The page's asynchronous build borrows the step from its persistent
    // preparation worker: an empty reload makes that realm's base, and the
    // first create reuses it.
    hooks.clearBases();
    await createLocalFieldRegistryAsync([repo], "s2-empty-tab", empty);
    expect(fieldIdentityDeltaOutcomes().slice(-2)).toEqual(["worker-base:made", "delta"]);
    await createLocalFieldRegistryAsync([repo], "s2-empty-tab", fn(uuid("42000000", 2)));
    expect(fieldIdentityDeltaOutcomes().slice(-2)).toEqual(["worker-base:reused", "delta"]);
  }, 600_000);
});

afterAll(() => closeRegistryPreparationWorker());
