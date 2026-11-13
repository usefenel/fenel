// ---------------------------------------------------------------------------
// typed-ref-type-lock.test.ts — typed-function-references Phase 7d proof.
//
// 7d gives TYPES/ENTITIES the same code-name↔UUID lock Phase 6 gave functions:
// identity is an opaque v4 UUID; the code-name is a `Codeable` projection. The
// link lives in the machine-owned `.fenel.lock` sidecar — the SAME lockfile +
// mint path, an ENTITY analogue of `uuidBySlug` + `getUuid`, the SAME
// non-mutation discipline (Hard fact 1). This makes a UUID `{$ref}` in TYPE
// position resolve identically to a code-name `{$ref}`; the producers do NOT
// flip yet (still 7g), so a type `{$ref:uuid}` reaches a recognizer ONLY from a
// test like this — the change is purely additive.
//
// Non-brittle: CONTROLLED entities + a CONTROLLED `LockMap`, never the global
// lock (the Phase-6 leak / non-brittle-catalog lesson). The injected
// `getEntityType` is the registry's own `getEntity(h)?.type`, which the 7d
// wiring keys by BOTH the bare name and the UUID.
//
// Canonical spec: design/typed-function-references.md + design/codename-uuid-
// lockfile.md (five locked decisions, 2026-06-03).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { createRegistry } from "./registry";
import { Ref, refType, type RefValue } from "./type-foundation";
import { peelToVariant } from "./set-algebra";
import type { FenelModule, FenelType } from "./types";

// A controlled entity (a 2-case variant — `peelToVariant` recognizes it) and a
// controlled, fixed UUID. Real v4 shape (the mint path uses `randomUUID()`); the
// fixed value keeps the assertions deterministic.
const ENTITY_NAME = "TypeLockEntity7d";
const ENTITY_UUID = "7d000000-0000-4000-8000-000000000001";
const ENTITY_TYPE: FenelType = {
  $variant: { cases: [{ name: "Aa", fields: [] }, { name: "Bb", fields: [] }] },
} as unknown as FenelType;

const mod: FenelModule = {
  name: "typelock7d",
  entities: [{ id: ENTITY_NAME, type: ENTITY_TYPE }],
  functions: [],
} as unknown as FenelModule;

// The locked registry — built with a controlled `LockMap` pinning the entity's
// UUID. (Built first, so the no-leak test can build a sibling lock-less registry
// over the SAME `mod` afterwards — the Phase-6 leak shape.) Type rows are keyed
// by their owner (modules-as-values Phase 5, per-owner type identity):
// `type/module/<owner>/<Name>`; a bare-name row is no type identity.
const ENTITY_LOCK_KEY = `type/module/typelock7d/${ENTITY_NAME}`;
const lock = new Map<string, string>([[ENTITY_LOCK_KEY, ENTITY_UUID]]);
const reg = createRegistry([mod], { codeNameLock: lock });

// The injected type-position resolver — `getEntity` is keyed by BOTH name and
// UUID (the 7d wiring), so a UUID handle and a name handle land on the same
// registration. `refType` is function-first; the entity name is not a function,
// so it falls to `getEntityType`.
const getEntityType = (h: string): FenelType | undefined => reg.getEntity(h)?.type;
const resolve = (ref: RefValue): FenelType =>
  refType(ref, reg.getFunction ?? (() => undefined), getEntityType);

describe("Phase 7d — a UUID {$ref} resolves a TYPE identically to a code-name {$ref}", () => {
  test("peelToVariant(Ref(uuid)) === peelToVariant(Ref(codeName)) (end-to-end through a 7f recognizer)", () => {
    const viaUuid = peelToVariant(Ref(ENTITY_UUID) as unknown as FenelType, resolve);
    const viaName = peelToVariant(Ref(ENTITY_NAME) as unknown as FenelType, resolve);
    expect(viaUuid).not.toBeNull();
    expect(viaUuid).toEqual(viaName);
    // …and both equal peeling the structural type directly (no ref).
    expect(viaUuid).toEqual(peelToVariant(ENTITY_TYPE));
  });

  test("refType resolves the UUID handle and the name handle to the same kind", () => {
    expect(resolve(Ref(ENTITY_UUID))).toEqual(ENTITY_TYPE);
    expect(resolve(Ref(ENTITY_NAME))).toEqual(ENTITY_TYPE);
  });
});

describe("Phase 7d — getUuid is the unified type/entity lookup", () => {
  test("getUuid(typeName) returns the locked UUID", () => {
    expect(reg.getUuid(ENTITY_NAME)).toBe(ENTITY_UUID);
  });

  test("getUuid round-trips a UUID handle (mirrors the function arm)", () => {
    expect(reg.getUuid(ENTITY_UUID)).toBe(ENTITY_UUID);
  });

  test("getUuid of an unlocked name degrades to undefined (graceful)", () => {
    expect(reg.getUuid("DefinitelyUnlocked7d")).toBeUndefined();
  });

  test("the owner-exact accessor reads the same identity; a bare-name row is not read", () => {
    expect(reg.getTypeUuid("typelock7d", ENTITY_NAME)).toBe(ENTITY_UUID);
    const bare = createRegistry([mod], { codeNameLock: new Map([[ENTITY_NAME, ENTITY_UUID]]) });
    expect(bare.getUuid(ENTITY_NAME)).toBeUndefined();
    expect(bare.getEntity(ENTITY_UUID)).toBeUndefined();
    expect(bare.getEntity(ENTITY_NAME)?.type).toEqual(ENTITY_TYPE);
  });
});

describe("Phase 7d — the UUID path is additive (lock-less builds resolve by name)", () => {
  test("a lock-less registry resolves the entity ref BY NAME (no regression)", () => {
    const lockless = createRegistry([mod]); // no codeNameLock
    const llGetEntityType = (h: string): FenelType | undefined => lockless.getEntity(h)?.type;
    const llResolve = (ref: RefValue): FenelType =>
      refType(ref, lockless.getFunction ?? (() => undefined), llGetEntityType);
    // By NAME: still resolves with no lock.
    expect(llResolve(Ref(ENTITY_NAME))).toEqual(ENTITY_TYPE);
    expect(peelToVariant(Ref(ENTITY_NAME) as unknown as FenelType, llResolve)).not.toBeNull();
    // No UUID identity without a lock.
    expect(lockless.getUuid(ENTITY_NAME)).toBeUndefined();
  });
});

describe("Phase 7d — D2: the function/entity union stays collision-free (real registry)", () => {
  // The loader's duplicate-across-lockfiles throw (codename-lock.ts `loadLock`)
  // is namespace-AGNOSTIC — it already fires for any colliding code-name (Phase 6
  // exercised it for functions); 7d doesn't change that mechanism. What 7d adds
  // is a second source of names into the ONE namespace, so the invariant worth
  // freezing here is that real function slugs and real entity code-names never
  // collide (the D2 measurement: function slugs carry a `:`, entity names are
  // bare). Build the real system registry and assert the union is injective.
  // Type rows are keyed `type/module/<owner>/<Name>` (per-owner type identity),
  // so they cannot collide with a `module:name` slug; the bare entity names the
  // registry still resolves stay disjoint from function slugs too.
  test("no real function slug equals a real entity code-name", async () => {
    const { getSystemRegistry } = await import("./system-registry");
    const sys = getSystemRegistry();
    const fnSlugs = new Set(sys.listFunctions().map((f) => f.id));
    const entityNames = sys.listIdentifiedEntities().map((entity) => entity.id);
    expect(entityNames.length).toBeGreaterThan(300);
    const collisions = entityNames.filter((n) => fnSlugs.has(n));
    expect(collisions).toEqual([]);
  });
});

describe("Phase 7d — no leak (Hard fact 1: never mutate the shared entity)", () => {
  test("a lock-less registry over the SAME module sees no entity UUID key", () => {
    // Built AFTER the locked `reg` over the identical `mod` objects — the exact
    // Phase-6 leak shape. A mutated entity (`e.uuid = …`) would leak the UUID
    // into this sibling whose map has no UUID key → `{$ref:uuid}` unresolvable.
    const lockless = createRegistry([mod]);
    expect(lockless.getUuid(ENTITY_NAME)).toBeUndefined();
    // The UUID must NOT be a resolution key in the lock-less registry.
    expect(lockless.getEntity(ENTITY_UUID)).toBeUndefined();
    // …while the entity is still present by its bare name.
    expect(lockless.getEntity(ENTITY_NAME)?.type).toEqual(ENTITY_TYPE);
    // And the shared entity object was never stamped with a `uuid` field.
    expect("uuid" in (mod.entities![0] as object)).toBe(false);
  });
});
