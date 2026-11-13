import { describe, expect, test } from "bun:test";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import type { FieldDef } from "@fenel/engine/types";
import { queryLocalFieldAuthoringCatalog, queryLocalFieldAuthoringIdentity, queryLocalFieldResurrectionCatalog } from "./reader-registry";

const ownerId = "3575b241-4753-4ca1-a4a8-cd876df88ca2";
const liveId = "f9fb6f96-26e8-4d56-bb7a-cf8741f5ee2b";
const privateId = "86cb9cc6-065a-44cc-976e-3e322215f91e";
const deadId = "fa18fbd5-5f51-4678-979b-4779b86659f2";
const otherDeadId = "b19cf44d-d4b5-42aa-a6ee-c2c80b27dc42";
const Nothing = { $tag: "Nothing" } as const;
const field = (id: string, name: string): FieldDef => ({ name, key: { $tag: "NamedField", ref: { $ref: id } },
  type: { $ref: "String" }, label: Nothing, ui: Nothing, meta: {} });
function snapshot(): FieldPersistenceSnapshot {
  return {
    owners: [{ kind: "type", ownerKey: `type:${ownerId}`, storageName: ownerId,
      definition: { id: ownerId, type: { $record: { fields: [field(liveId, "LocalFieldCatalogLive"), field(privateId, "LocalFieldCatalogPrivate")] } } } }],
    fields: [
      { id: liveId, currentCodeName: "LocalFieldCatalogLive", status: "live", realm: "account", reuseVisibility: "account" },
      { id: privateId, currentCodeName: "LocalFieldCatalogPrivate", status: "live", realm: "account", reuseVisibility: "owner" },
      { id: deadId, currentCodeName: "LocalFieldCatalogRetired", status: "tombstoned", realm: "account", reuseVisibility: "account",
        origin: { owner: { $tag: "TypeFieldOwner", module: Nothing, localId: ownerId }, path: [{ $tag: "FieldNamed", name: "LocalFieldCatalogRetired" }] } },
      { id: otherDeadId, currentCodeName: "LocalFieldCatalogOtherRetired", status: "tombstoned", realm: "account", reuseVisibility: "account",
        origin: { owner: { $tag: "FunctionFieldOwner", id: "another-local-function" }, path: [] } },
    ],
    facets: [{ fieldId: liveId, typeName: "Labelable", methods: { label: "Visible local field" }, scope: "account", priority: 100 }],
  };
}

describe("local field source catalogue", () => {
  test("searches actual reusable fields while retaining local identity, facets and repository provenance", async () => {
    const current = snapshot();
    const page = await queryLocalFieldAuthoringCatalog("tab-source", current, { search: "LocalFieldCatalog" });
    expect(page.fields.map(row => row.fieldId)).toEqual([liveId]);
    expect(page.fields[0]).toMatchObject({ realm: "local", sourceId: "tab-source", reuseVisibility: "local", label: "Visible local field" });
    expect(page.fields[0]!.owners).toHaveLength(1);
    expect(page.fields[0]!.occurrenceTypes).toEqual(["String"]);
    expect(page.facetInterfaceNames).toContain("Labelable");
    const privateIdentity = await queryLocalFieldAuthoringIdentity("tab-source", current, privateId);
    expect(privateIdentity.field).toMatchObject({ fieldId: privateId, realm: "local", sourceId: "tab-source", reuseVisibility: "owner" });
    expect((await queryLocalFieldAuthoringIdentity("tab-source", current, "not-a-field")).field).toBeNull();
    const repository = await queryLocalFieldAuthoringCatalog("tab-source", current, { limit: 1 });
    expect(repository.fields).toHaveLength(1);
    expect(repository.nextCursor).toBeDefined();
    const { repositoryFieldCatalog } = await import("@fenel/engine/repository-field-catalog");
    const reusable = repositoryFieldCatalog().fields.find(row => row.reuseVisibility === "repository");
    if (!reusable) throw new Error("Expected the source-owned reusable repository field");
    const repositoryPage = await queryLocalFieldAuthoringCatalog("tab-source", current, { search: reusable.codeName });
    expect(repositoryPage.fields).toContainEqual(expect.objectContaining({ fieldId: reusable.fieldId, realm: "repository" }));
    const repositoryIdentity = await queryLocalFieldAuthoringIdentity("tab-source", current, reusable.fieldId);
    expect(repositoryIdentity.field?.realm).toBe("repository");
    expect(repositoryIdentity.field?.sourceId).toBeUndefined();
  }, 180_000);

  test("only offers the selected owner's tombstones, including after deleting the owner", async () => {
    const current = snapshot();
    const target = { ownerKey: `type:${ownerId}`, ownerKind: "type" as const, storageName: ownerId };
    expect((await queryLocalFieldResurrectionCatalog("tab-source", current, target)).fields).toEqual([
      { fieldId: deadId, codeName: "LocalFieldCatalogRetired" },
    ]);
    expect((await queryLocalFieldResurrectionCatalog("tab-source", { ...current, owners: [] }, target)).fields)
      .toEqual([{ fieldId: deadId, codeName: "LocalFieldCatalogRetired" }]);
    await expect(queryLocalFieldResurrectionCatalog("tab-source", current, { ...target, storageName: "another-owner" }))
      .rejects.toThrow(/coordinates/);
  }, 180_000);
});
