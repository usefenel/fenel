import { describe, expect, test } from "bun:test";
import {
  tryPlanFieldPersistence,
  type FieldOwnerDefinition,
  type FieldOwnerMutation,
} from "./field-authoring";

const UUID = "19d26c40-7957-4b83-8149-c3c87d7f26a0";
const ROW_ID = "b5acbda2-2fa2-4758-b5fb-21cd453dd094";

function owner(kind: "type" | "function", id: string): FieldOwnerDefinition {
  const metadata = { ownerKey: `${kind}:${id}`, storageName: id };
  return kind === "type"
    ? { ...metadata, kind, definition: { id, type: { $ref: "String" } } }
    : { ...metadata, kind, definition: { id, params: [], returns: { $ref: "String" }, body: "before" } };
}

function plan(currentOwners: FieldOwnerDefinition[], ownerMutations: FieldOwnerMutation[]) {
  return tryPlanFieldPersistence({ currentOwners, ownerMutations, currentFields: [], currentFacets: [] });
}

describe("new account definition identity", () => {
  for (const kind of ["type", "function"] as const) {
    test(`refuses a new textual ${kind} identity`, () => {
      const fresh = owner(kind, "legacySpelling");
      expect(plan([], [{ kind: "upsert", owner: fresh }])).toMatchObject({
        ok: false,
        error: { $tag: "InvalidOwnerStorageIdentity", ownerKey: fresh.ownerKey, reason: "new-owner-id-not-uuid" },
      });
    });

    test(`accepts a new UUID ${kind} identity`, () => {
      const fresh = owner(kind, UUID);
      const result = plan([], [{ kind: "upsert", owner: fresh }]);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.ownerUpserts).toEqual([fresh]);
      expect(result.value.snapshot.owners).toEqual([fresh]);
    });

    test(`retains, edits and deletes a server-loaded textual ${kind} identity`, () => {
      const legacy = { ...owner(kind, "legacySpelling"), storageId: ROW_ID };
      const unchanged = plan([legacy], []);
      expect(unchanged.ok).toBe(true);
      if (!unchanged.ok) throw new Error(unchanged.error.message);
      expect(unchanged.value.snapshot.owners).toEqual([legacy]);
      expect(unchanged.value.ownerUpserts).toEqual([]);

      const updated: FieldOwnerDefinition = legacy.kind === "type"
        ? { ...legacy, definition: { ...legacy.definition, type: { $ref: "Number" } } }
        : { ...legacy, definition: { ...legacy.definition, body: "after" } };
      // An omitted storage id must inherit the transaction-loaded row identity.
      const { storageId: _omitted, ...requested } = updated;
      const edited = plan([legacy], [{ kind: "upsert", owner: requested }]);
      expect(edited.ok).toBe(true);
      if (!edited.ok) throw new Error(edited.error.message);
      expect(edited.value.ownerUpserts).toEqual([updated]);
      expect(edited.value.snapshot.owners).toEqual([updated]);

      const deleted = plan([legacy], [{ kind: "delete", ownerKey: legacy.ownerKey, ownerKind: kind, storageName: legacy.storageName }]);
      expect(deleted.ok).toBe(true);
      if (!deleted.ok) throw new Error(deleted.error.message);
      expect(deleted.value.ownerDeletes).toEqual([legacy]);
      expect(deleted.value.snapshot.owners).toEqual([]);
    });
  }

  test("preserves the existing refusal for a fresh owner supplying a storage row id", () => {
    expect(plan([], [{ kind: "upsert", owner: { ...owner("type", "text"), storageId: ROW_ID } }])).toMatchObject({
      ok: false, error: { $tag: "InvalidOwnerStorageIdentity", reason: "new-owner-storage-id" },
    });
  });
});
