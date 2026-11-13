import { describe, expect, test } from "bun:test";
import { tryPlanFieldPersistence, type FieldOwnerDefinition, type FieldPersistenceInput } from "./field-authoring";
import { repositoryIdentityKinds } from "./repository-identity-manifest";
import { REPOSITORY_REUSABLE_DURABLE_FIELDS } from "./repository-field-catalog";
import { Nothing } from "./type-foundation";
import type { FenelType } from "./types";

const reservations = repositoryIdentityKinds();
const GOOD = "f0f0f0f0-0000-4000-8000-000000000011";
const NEXT = "f0f0f0f0-0000-4000-8000-000000000012";
const reservedId = (kind: "function" | "type" | "field" | "reserved") => {
  const row = [...reservations].find(([, actual]) => actual === kind);
  if (!row) throw new Error(`The repository fixture has no ${kind} reservation`);
  return row[0];
};
const typeOwner = (id: string, type: FenelType = { $ref: "Number" }): FieldOwnerDefinition => ({
  ownerKey: `type:${id}`, storageName: id, kind: "type", definition: { id, type },
});
const functionOwner = (id: string): FieldOwnerDefinition => ({
  ownerKey: `function:${id}`, storageName: id, kind: "function",
  definition: { id, params: [], returns: { $ref: "Number" }, body: 1 },
});
const inputFor = (owners: FieldOwnerDefinition[], currentOwners: FieldOwnerDefinition[] = []): FieldPersistenceInput => ({
  currentOwners, ownerMutations: owners.map(owner => ({ kind: "upsert", owner })), currentFields: [], currentFacets: [],
});

describe("definition persistence preserves repository reservations", () => {
  for (const kind of ["function", "type", "field", "reserved"] as const) {
    test(`a proposed function cannot claim a ${kind} reservation`, () => {
      const id = reservedId(kind), input = inputFor([functionOwner(id)]), before = structuredClone(input);
      expect(tryPlanFieldPersistence(input)).toMatchObject({ ok: false, error: {
        $tag: "ReservedDefinitionIdentity", handle: id, repositoryKind: kind, message: expect.stringContaining(id),
      } });
      expect(input).toEqual(before);
    }, 60_000);
  }

  test("a proposed type cannot claim a same-kind repository identity", () => {
    const id = reservedId("type");
    expect(tryPlanFieldPersistence(inputFor([typeOwner(id)]))).toMatchObject({ ok: false,
      error: { $tag: "ReservedDefinitionIdentity", handle: id, repositoryKind: "type" } });
  }, 60_000);

  test("a valid legacy edit plus invalid creation refuses atomically, then a valid UUID retry preserves identity", () => {
    const legacy = { ...typeOwner("LegacySizing"), storageId: "f0f0f0f0-0000-4000-8000-000000000013" };
    const edited = typeOwner("LegacySizing", { $ref: "String" });
    const id = reservedId("function"), input = inputFor([edited, functionOwner(id)], [legacy]);
    const before = structuredClone(input);
    expect(tryPlanFieldPersistence(input)).toMatchObject({ ok: false,
      error: { $tag: "ReservedDefinitionIdentity", handle: id, repositoryKind: "function" } });
    expect(input).toEqual(before);

    const retried = tryPlanFieldPersistence(inputFor([edited, functionOwner(GOOD)], [legacy]));
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.value.snapshot.owners.map(owner => owner.definition.id).sort()).toEqual(["LegacySizing", GOOD].sort());
    expect(retried.value.snapshot.owners.find(owner => owner.definition.id === "LegacySizing")?.storageId).toBe(legacy.storageId);
    const changed = { ...functionOwner(GOOD), definition: { ...functionOwner(GOOD).definition, body: 2 } } as FieldOwnerDefinition;
    const kept = tryPlanFieldPersistence(inputFor([changed], [...retried.value.snapshot.owners]));
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.value.snapshot.owners.find(owner => owner.definition.id === GOOD)?.ownerKey).toBe(`function:${GOOD}`);
      expect(kept.value.snapshot.owners).toHaveLength(2);
    }
  }, 60_000);

  test("the first colliding owner determines the diagnostic", () => {
    const a = reservedId("type"), b = reservedId("function");
    expect(tryPlanFieldPersistence(inputFor([typeOwner(a), functionOwner(b)]))).toMatchObject({ ok: false,
      error: { $tag: "ReservedDefinitionIdentity", handle: a, repositoryKind: "type" } });
    expect(tryPlanFieldPersistence(inputFor([functionOwner(b), typeOwner(a)]))).toMatchObject({ ok: false,
      error: { $tag: "ReservedDefinitionIdentity", handle: b, repositoryKind: "function" } });
  }, 60_000);

  test("deleting a corrupt colliding old owner can repair the proposed graph", () => {
    const id = reservedId("function"), corrupt = functionOwner(id);
    const result = tryPlanFieldPersistence({ currentOwners: [corrupt], currentFields: [], currentFacets: [],
      identityKinds: repositoryIdentityKinds(),
      ownerMutations: [{ kind: "delete", ownerKey: corrupt.ownerKey, ownerKind: "function", storageName: id },
        { kind: "upsert", owner: functionOwner(GOOD) }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ownerDeletes).toHaveLength(1);
      expect(result.value.ownerDeletes[0]?.definition.id).toBe(id);
      expect(result.value.snapshot.owners.map(owner => owner.definition.id)).toEqual([GOOD]);
    }
  }, 60_000);

  test("repository definition references and reusable Field occurrences are not ownership claims", () => {
    const field = REPOSITORY_REUSABLE_DURABLE_FIELDS[0];
    if (!field) throw new Error("Expected a repository-visible reusable Field");
    expect(reservations.get(field.id)).toBe("field");
    const owner = typeOwner(NEXT, { $record: { fields: [{ name: field.currentCodeName,
      key: { $tag: "NamedField", ref: { $ref: field.id } }, type: { $ref: reservedId("type") },
      label: Nothing, ui: Nothing, meta: {},
    }] } });
    const result = tryPlanFieldPersistence({ ...inputFor([owner]), repositoryFields: [field], identityKinds: reservations });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.snapshot.owners[0]?.definition.id).toBe(NEXT);
      expect(result.value.fieldUpserts).toEqual([]);
      expect(result.value.fieldTombstones).toEqual([]);
      expect(result.value.facetUpserts).toEqual([]);
      expect(result.value.facetDeletes).toEqual([]);
    }
  }, 60_000);
});
