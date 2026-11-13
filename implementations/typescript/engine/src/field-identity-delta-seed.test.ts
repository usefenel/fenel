// base-on-empty (2026-10-30) — seed-scale differential of the S2 empty delta.
//
// A Local tab over the seed with an empty snapshot builds through a field
// identity base and an empty delta; its registry surfaces and field collection
// must equal the monolithic field step's. The next build, which adds one Local
// function, must extend that base: the base is requested once for both builds
// and the monolithic kernel never runs on the delta path. Heavy: three seed
// registry builds (several minutes in Bun); run it alone.
import { afterAll, describe, expect, test } from "bun:test";
import { createLocalFieldRegistry } from "./account-field-registry";
import { fieldIdentityDeltaOutcomes, fieldIdentityKernelRunCounts } from "./field-identity";
import { modulesFor } from "./module-manifest";
import { __fieldIdentityDeltaForTests as hooks, closeRegistryPreparationWorker, type ModuleRegistry } from "./registry";

const emptySnapshot = { owners: [], fields: [], facets: [] };
const oneFunction = {
  // F0: a Local definition id is a UUID.
  owners: [{ ownerKey: "function:5eed0e17-0000-4000-8000-000000000001", kind: "function",
    storageName: "5eed0e17-0000-4000-8000-000000000001",
    definition: { id: "5eed0e17-0000-4000-8000-000000000001", params: [], returns: { $ref: "String" }, body: "probe" } }],
  fields: [], facets: [],
};

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
function build(snapshot: unknown, sourceId: string) {
  hooks.capture(true);
  try {
    const registry = createLocalFieldRegistry(modulesFor("seed"), sourceId, snapshot as never);
    return { registry, collection: collectionView() };
  } finally {
    hooks.capture(false);
  }
}

describe("S2 empty delta over the seed", () => {
  test("an empty Local build equals the monolithic step and keeps the base the next build extends", () => {
    hooks.clearBases();
    const before = fieldIdentityKernelRunCounts();
    const empty = build(emptySnapshot, "seed-delta-empty");
    expect(fieldIdentityDeltaOutcomes().at(-1)).toBe("delta");
    expect(hooks.retainedBaseCount()).toBe(1);
    build(oneFunction, "seed-delta-one");
    expect(fieldIdentityDeltaOutcomes().at(-1)).toBe("delta");
    const after = fieldIdentityKernelRunCounts();
    expect(after.base - before.base).toBe(1);
    expect(after.kernel - before.kernel).toBe(0);

    hooks.setEnabled(false);
    let mono: ReturnType<typeof build>;
    try { mono = build(emptySnapshot, "seed-delta-mono"); } finally { hooks.setEnabled(true); }
    expect(publicView(empty.registry)).toEqual(publicView(mono.registry));
    expect(empty.collection).toEqual(mono.collection);
  }, 1_800_000);
});

afterAll(() => closeRegistryPreparationWorker());
