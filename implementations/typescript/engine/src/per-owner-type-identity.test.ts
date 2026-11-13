// ---------------------------------------------------------------------------
// Per-owner type identity on the real repository registries
// (modules-as-values Phase 5, slices S1 and S2;
// workstreams/modules-as-values/briefs/phase-5-per-owner-type-identity.md).
//
// S1 merges the copies that were one set declared twice (ItemType, Handle) and
// gives std's page its own registered PageBlock, so exactly three names keep
// two genuinely different owners: Animation, File and Game.
//
// S2 keys every type row of `.fenel.lock` by its owner and gives each owner of
// those names its own UUID in the registry. It is plumbing only: bare lookups
// keep today's referents and `telegram.Animation` stays refused (amendment A1).
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, test } from "bun:test";
import { modulesFor } from "./module-manifest";
import type { ModuleRegistry } from "./registry";
import { createRepositoryRegistry } from "./repository-registry";
import { getSystemRegistry } from "./system-registry";
import type { FenelType } from "./types";
import { validateValue } from "./validate";

const LONG = 900_000;

let system: ModuleRegistry;
let seed: ModuleRegistry;

beforeAll(() => {
  system = getSystemRegistry();
  seed = createRepositoryRegistry(modulesFor("seed"));
}, LONG);

/** Names declared by two owners across the given registries. Parametric
 * types are outside per-owner identity for now (the LookupResult copies have
 * different field identities; their merge is filed separately). */
function twoOwnerNames(...registries: ModuleRegistry[]): string[] {
  const owners = new Map<string, Set<string>>();
  for (const registry of registries) {
    for (const entity of registry.listIdentifiedEntities()) {
      if (Array.isArray(entity.params) && entity.params.length > 0) continue;
      const set = owners.get(entity.id) ?? new Set<string>();
      set.add(entity.module ?? "(unowned)");
      owners.set(entity.id, set);
    }
  }
  return [...owners]
    .filter(([, set]) => set.size > 1)
    .map(([name, set]) => `${name}: ${[...set].sort().join(", ")}`)
    .sort();
}

function fieldType(type: FenelType | undefined, name: string): unknown {
  const fields = (type as { $record?: { fields?: Array<{ name: string; type: unknown }> } } | undefined)
    ?.$record?.fields;
  return fields?.find((field) => field.name === name)?.type;
}

describe("S1 — one set, one declaration", () => {
  test("the identity census reports exactly Animation, File and Game with two owners", () => {
    expect(twoOwnerNames(system, seed)).toEqual([
      "Animation: animation, telegram",
      "File: std, telegram",
      "Game: games, telegram",
    ]);
  }, LONG);

  test("a std page with a form block validates against std's own PageBlock", () => {
    const page = seed.getIdentifiedEntity("page");
    expect(page?.module).toBe("system");
    expect(JSON.stringify(fieldType(page?.type, "blocks"))).toContain("PageBlock");
    expect(seed.getEntity("PageBlock")?.module).toBe("system");
    const value = {
      slug: "my-page",
      name: "P",
      type: "00000000-0000-4000-8000-000000000000",
      blocks: [{
        type: "form",
        typeRef: "00000000-0000-4000-8000-000000000001",
        functionId: "00000000-0000-4000-8000-000000000002",
        submitLabel: "Go",
      }],
      config: { brandColor: "#000", logo: "logo.png", thankYouMessage: "Thanks", redirectUrl: "https://example.com" },
      published: true,
    };
    // Before S1 the block was checked against Notion's Block ("blocks.0.id Id
    // is required"). Only the block errors are this slice's concern.
    const blockErrors = (input: unknown) => validateValue(page!.type, input, null, { registry: seed })
      .errors.filter((error) => error.path.startsWith("blocks"));
    expect(blockErrors(value)).toEqual([]);
    expect(validateValue({ $ref: "PageBlock" } as FenelType, value.blocks[0], null, { registry: seed }))
      .toMatchObject({ valid: true, errors: [] });
    // The discriminator still reads the persisted "type" slot (api/src/routes/pages.ts).
    expect(blockErrors({ ...value, blocks: [{ ...value.blocks[0], type: "video" }] })).not.toEqual([]);
  }, LONG);

  test("items:createItem keeps its signature, and its ItemType is the system type", () => {
    const fn = seed.getFunction("items:createItem");
    expect(fn?.params.map((param) => param.name)).toEqual(["slug", "name", "type", "config", "adapter"]);
    expect(fn?.params[2]?.type).toEqual({ $ref: "ItemType" });
    expect(fn?.returns).toEqual({ $ref: "ActionResult" });
    expect(seed.getEntity("ItemType")?.module).toBe("system");
    expect(seed.getEntity("ItemType")?.type).toEqual(system.getEntity("ItemType")?.type);
    expect(seed.getEntityNominalIdentity("ItemType")).toBe(JSON.stringify(["system", "ItemType"]));
    const nominals = seed.getFunctionScheme("items:createItem")?.nominals ?? [];
    expect(nominals.filter((nominal) => nominal.publicName === "ItemType")).toEqual([]);
  }, LONG);

  test("telegram:deepLink keeps its signature, and its Handle is the system type", () => {
    const fn = seed.getFunction("telegram:deepLink");
    expect(fn?.params.map((param) => [param.name, param.type])).toEqual([
      ["handle", { $ref: "Handle" }],
      ["kind", { $ref: "TgLinkKind" }],
      ["payload", { $ref: "String" }],
    ]);
    expect(fn?.returns).toEqual({ $ref: "Url" });
    expect(seed.getEntity("Handle")?.module).toBe("system");
    expect(seed.getEntity("Handle")?.type).toEqual(system.getEntity("Handle")?.type);
    // The scheme records a nominal only for a bundle-owned type; the system
    // Handle is the prelude identity, so no telegram-owned Handle remains.
    expect(seed.getFunctionScheme("telegram:deepLink")).toBeDefined();
    const nominals = seed.getFunctionScheme("telegram:deepLink")?.nominals ?? [];
    expect(nominals.map((nominal) => nominal.identity)).toEqual([
      JSON.stringify(["telegram", "TgLinkKind"]),
      JSON.stringify(["telegram", "Url"]),
    ]);
  }, LONG);
});

// ---------------------------------------------------------------------------
// S2 — owner-keyed lock rows and per-owner registry identities.
// ---------------------------------------------------------------------------

const TWO_OWNER = [
  // name, keeper owner, the UUID the bare row pinned (kept), other owner
  ["Animation", "animation", "8d5e3398-7464-4a83-9157-2a80d24fc40a", "telegram"],
  ["File", "telegram", "a1c8799a-dfdb-480f-b6ca-7c75c9ec3349", "std"],
  ["Game", "games", "5c40deb3-8398-447d-8b6a-707818e7a294", "telegram"],
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ownerKey = (owner: string, name: string): string => JSON.stringify([owner, name]);

describe("S2 — per-owner type identity", () => {
  test("each two-owner name has two distinct UUIDs, each resolving back to its own owner", () => {
    for (const [name, keeper, kept, other] of TWO_OWNER) {
      const keeperUuid = seed.getTypeUuid(keeper, name);
      const otherUuid = seed.getTypeUuid(other, name);
      expect(keeperUuid).toBe(kept);
      expect(otherUuid).toMatch(UUID);
      expect(otherUuid).not.toBe(kept);
      expect(seed.getEntity(keeperUuid!)?.module).toBe(keeper);
      expect(seed.getEntity(otherUuid!)?.module).toBe(other);
      expect(seed.getEntityNominalIdentity(keeperUuid!)).toBe(ownerKey(keeper, name));
      expect(seed.getEntityNominalIdentity(otherUuid!)).toBe(ownerKey(other, name));
      // getUuid(uuid) stays exact for both owners; the shared bare spelling
      // names no identity.
      expect(seed.getUuid(keeperUuid!)).toBe(keeperUuid);
      expect(seed.getUuid(otherUuid!)).toBe(otherUuid);
      expect(seed.getUuid(name)).toBeUndefined();
      // Bare lookups are unchanged in S2: the keeper UUID keeps the referent
      // the bare name resolved to before (the last registered owner).
      expect(seed.getEntity(name)?.module).toBe(keeper);
    }
  }, LONG);

  test("their field identities are unchanged by the re-key", () => {
    const fieldRef = (owner: string, type: string, field: string): string | undefined => {
      const identity = seed.getFieldIdentity(
        { $tag: "TypeFieldOwner", module: { $tag: "Just", _0: owner }, localId: type },
        [{ $tag: "FieldNamed", name: field }],
      );
      const key = identity?.field.key;
      return key?.$tag === "NamedField" ? key.ref.$ref : undefined;
    };
    expect(fieldRef("telegram", "Animation", "fileId")).toBe("3c848a24-9033-4caa-a99e-1bff748d42ad");
    expect(fieldRef("telegram", "File", "fileId")).toBe("e4539d19-d5d0-4ba3-808d-054fbe56477f");
    expect(fieldRef("std", "File", "url")).toBe("9ee30d5d-f717-4eb3-b286-d3ca12ccfe26");
    expect(fieldRef("telegram", "Game", "animation")).toBe("31bab4b2-1be9-4aba-9de9-f61d8e9323eb");
    expect(fieldRef("games", "Game", "view")).toBe("ce475492-390b-4ac7-bf87-dd204dd71610");
    // The owner-keyed type rows sit beside, never on, those field rows.
    expect(seed.getTypeUuid("telegram", "Animation")).not.toBe("3c848a24-9033-4caa-a99e-1bff748d42ad");
  }, LONG);

  test("keeper preservation in the lock, matching the Fenel keeper table", async () => {
    const { repositoryIdentityLock } = await import("./repository-identity-manifest");
    const { dispatchEngineBody } = await import("./engine-bodies-dispatch");
    const lock = repositoryIdentityLock();
    const table = dispatchEngineBody("engine:typeIdentityKeepers", []) as Array<{
      name: string; oldId: string; keeper: string; others: string[];
    }>;
    expect(table.map((row) => [row.name, row.keeper, row.oldId, row.others[0]]))
      .toEqual(TWO_OWNER.map((row) => [...row]));
    for (const [name, keeper, kept, other] of TWO_OWNER) {
      expect(lock.get(`type/module/${keeper}/${name}`)).toBe(kept);
      expect(lock.get(`type/module/${other}/${name}`)).toMatch(UUID);
      expect(lock.get(`type/module/${other}/${name}`)).not.toBe(kept);
      expect(lock.has(name)).toBe(false);
    }
  }, LONG);

  test("every live type row is owner-keyed, each UUID sits under exactly one key, and no bare type key is left", async () => {
    const { REPOSITORY_IDENTITY_MANIFEST } = await import("./repository-identity-manifest");
    const rows = REPOSITORY_IDENTITY_MANIFEST.entries;
    const typeRows = rows.filter(([, , kind]) => kind === "type");
    expect(typeRows.length).toBeGreaterThan(840);
    expect(typeRows.filter(([key]) => !key.startsWith("type/module/"))).toEqual([]);
    const ids = rows.map(([, id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    const declared = new Set([
      ...system.listIdentifiedEntities(),
      ...seed.listIdentifiedEntities(),
    ].map((entity) => entity.id));
    expect(rows.filter(([key]) => declared.has(key)).map(([key]) => key)).toEqual([]);
    // Each identity of these registries is the manifest row under its owner
    // key (keys from the Fenel codec, one bulk call).
    const { dispatchEngineBody } = await import("./engine-bodies-dispatch");
    const byKey = new Map(rows.map(([key, id]) => [key, id]));
    for (const registry of [system, seed]) {
      const located = registry.listIdentifiedEntities()
        .map((entity) => ({ entity, uuid: registry.getTypeUuid(entity.module ?? "", entity.id) }))
        .filter((row) => row.uuid !== undefined);
      const keys = dispatchEngineBody("engine:typeIdentityLockKeys", [
        located.map(({ entity }) => ({ $tag: "Just", _0: entity.module ?? "" })),
        located.map(({ entity }) => entity.id),
      ]) as string[];
      expect(keys.length).toBe(located.length);
      located.forEach(({ uuid }, index) => expect(byKey.get(keys[index]!)).toBe(uuid));
    }
  }, LONG);

  test("one key, one UUID, in every product profile", () => {
    for (const registry of [system, seed]) {
      const seen = new Map<string, string>();
      for (const entity of registry.listIdentifiedEntities()) {
        const uuid = registry.getTypeUuid(entity.module ?? "", entity.id);
        if (uuid === undefined) continue;
        const owner = ownerKey(entity.module ?? "", entity.id);
        expect(seen.get(uuid) ?? owner).toBe(owner);
        seen.set(uuid, owner);
        expect(registry.getEntityNominalIdentity(uuid)).toBe(owner);
        expect(registry.getUuid(uuid)).toBe(uuid);
      }
      expect(seen.size).toBeGreaterThan(300);
    }
  }, LONG);

  test("the four reserved rows that resolved keep resolving, now under their owner key", () => {
    for (const [name, id] of [
      ["Expr", "cdcf4889-842d-4f7e-886d-0e064589a3d7"],
      ["Pattern", "9969f803-5cb0-451e-bbf6-f9d80d0a31c6"],
      ["Syntax", "be43ffd6-9787-4dae-bad2-65c0102acbef"],
      ["Verified", "c1093d49-34d0-4ca2-8261-2eab7478be6b"],
    ] as const) {
      expect(system.getTypeUuid("system", name)).toBe(id);
      expect(system.getEntity(id)?.id).toBe(name);
      expect(system.getUuid(name)).toBe(id);
    }
  }, LONG);

  test("Phase 5a still refuses telegram.Animation and animation.Animation, naming both owners' identities", () => {
    const telegramUuid = seed.getTypeUuid("telegram", "Animation")!;
    const animationUuid = seed.getTypeUuid("animation", "Animation")!;
    for (const bundle of ["telegram", "animation"]) {
      const resolved = seed.resolveModuleMember(bundle, "Animation");
      expect(resolved.kind).toBe("ambiguous");
      const message = (resolved as { message: string }).message;
      expect(message).toContain(`${bundle}.Animation is ambiguous`);
      expect(message).toContain(telegramUuid);
      expect(message).toContain(animationUuid);
    }
  }, LONG);
});

// The two dispatch classes whose bare rows resolved at the base through the
// spec-registration loop. They are registered in every registry but are no
// bundle's identified entity, so a census over listIdentifiedEntities misses
// them.
const SPEC_ONLY_LOCKED = [
  ["FieldRepresentational", "357688d0-7ddc-4852-a175-8dfeb748df42"],
  ["Submittable", "dee6f290-7e02-4cd3-b195-b49fb610f47f"],
] as const;

describe("S2 — compatibility census: every identity that resolved keeps resolving", () => {
  test("the locked spec-only classes resolve to their old UUIDs under their system owner key", async () => {
    const { repositoryIdentityLock } = await import("./repository-identity-manifest");
    const lock = repositoryIdentityLock();
    for (const registry of [system, seed]) {
      for (const [name, id] of SPEC_ONLY_LOCKED) {
        expect(registry.getEntity(name)?.interface).toBeDefined();
        expect(lock.get(`type/module/system/${name}`)).toBe(id);
        expect(lock.has(name)).toBe(false);
        expect(registry.getTypeUuid("system", name)).toBe(id);
        expect(registry.getUuid(name)).toBe(id);
        expect(registry.getUuid(id)).toBe(id);
        expect(registry.getEntity(id)?.id).toBe(name);
        expect(registry.getEntityNominalIdentity(id)).toBe(ownerKey("system", name));
      }
    }
  }, LONG);

  test("the Fenel roster retains exactly those two dispatch classes", async () => {
    const { dispatchEngineBody } = await import("./engine-bodies-dispatch");
    const candidate = (name: string) => ({
      $tag: "TypeIdentityCandidate",
      owner: "system",
      name,
      parametric: false,
      dispatchClass: true,
      systemDeclared: false,
      bareId: { $tag: "Nothing" },
      keyedId: { $tag: "Nothing" },
    });
    expect(dispatchEngineBody("engine:typeIdentityRetainedSystemClasses", []))
      .toEqual(SPEC_ONLY_LOCKED.map(([name]) => name));
    for (const [name] of SPEC_ONLY_LOCKED) {
      expect(dispatchEngineBody("engine:typeIdentityRequired", [candidate(name)])).toBe(true);
    }
    expect(dispatchEngineBody("engine:typeIdentityRequired", [candidate("Labelable")])).toBe(false);
  }, LONG);

  test("in every identity profile, no declared name keeps a bare row and every owner-keyed type row resolves to its declaration", async () => {
    const { repositoryIdentityLock, REPOSITORY_IDENTITY_MANIFEST } = await import("./repository-identity-manifest");
    const { repositoryIdentityProfiles } = await import("./repository-identity-modules");
    const { createRegistry } = await import("./registry");
    const { specEntities } = await import("./system-entities");
    const { dispatchEngineBody } = await import("./engine-bodies-dispatch");
    const lock = repositoryIdentityLock();
    const declaredNames = new Set<string>();
    const resolvedKeys = new Set<string>();
    for (const profile of repositoryIdentityProfiles()) {
      const lockCopy = new Map(lock);
      const registry = createRegistry([...profile.modules], {
        codeNameLock: lockCopy,
        fieldIdentity: { mode: "collect-requirements", defaultRealm: "repository-source", lock: lockCopy },
      });
      // Every registration that reads a type row: the identified entities
      // (bundle and system declarations) and the spec-only registrations.
      const declared = registry.listIdentifiedEntities()
        .map((entity) => ({ owner: entity.module ?? "", name: entity.id }));
      const identified = new Set(declared.map(({ name }) => name));
      for (const spec of specEntities) {
        if (spec.type !== undefined && !identified.has(spec.id)) declared.push({ owner: "system", name: spec.id });
      }
      for (const { name } of declared) declaredNames.add(name);
      const keys = dispatchEngineBody("engine:typeIdentityLockKeys", [
        declared.map(({ owner }) => ({ $tag: "Just", _0: owner })),
        declared.map(({ name }) => name),
      ]) as string[];
      expect(keys.length).toBe(declared.length);
      declared.forEach(({ owner, name }, index) => {
        const key = keys[index]!;
        const id = lock.get(key);
        if (id === undefined) return;
        expect([key, registry.getTypeUuid(owner, name)]).toEqual([key, id]);
        expect([key, registry.getEntity(id)?.id]).toEqual([key, name]);
        expect([key, registry.getUuid(id)]).toEqual([key, id]);
        resolvedKeys.add(key);
      });
    }
    // A bare row named after a registered type or class is an identity no
    // registration reads any more (it resolved through the bare read before
    // S2). Renames keep UUIDs, so with no such row left and every owner-keyed
    // row resolving, every identity that resolved at the base still does.
    expect([...declaredNames].filter((name) => lock.has(name)).sort()).toEqual([]);
    const typeKeys = REPOSITORY_IDENTITY_MANIFEST.entries
      .filter(([key]) => key.startsWith("type/module/"))
      .map(([key]) => key);
    expect(typeKeys.filter((key) => !resolvedKeys.has(key))).toEqual([]);
    // 849 identities resolved at the base (847 type rows + the 2 spec-only
    // classes) plus the 8 type rows minted since (PageBlock, the four
    // TypeIdentity* types, telegram.Animation, std.File, telegram.Game).
    expect(typeKeys.length).toBeGreaterThanOrEqual(857);
  }, LONG);
});

describe("S2 — an account's own type adopts no repository UUID", () => {
  test("an account Animation beside the animation bundle has no identity; the bundle's keeps its own", async () => {
    const { createAccountRegistry } = await import("./repository-registry");
    const { stdModule } = await import("./modules/std");
    const { pictureModule } = await import("./modules/picture");
    const { animationModule } = await import("./modules/animation");
    const still: FenelType = { $variant: { cases: [{ name: "Still", fields: [], label: { $tag: "Nothing" } }] } };
    const account = {
      name: "acctanim",
      label: "acctanim",
      entities: [{ id: "Animation", type: still }],
      functions: [],
    };
    const registry = createAccountRegistry([stdModule, pictureModule, animationModule], [account]);
    const kept = TWO_OWNER[0][2];
    expect(registry.getEntity("Animation")?.module).toBe("acctanim");
    expect(registry.getUuid("Animation")).toBeUndefined();
    expect(registry.getTypeUuid("acctanim", "Animation")).toBeUndefined();
    expect(registry.getTypeUuid("animation", "Animation")).toBe(kept);
    expect(registry.getEntity(kept)?.module).toBe("animation");
    expect(registry.getUuid(kept)).toBe(kept);
  }, LONG);
});
