import { expect, test } from "bun:test";
import { tryPlanFieldPersistence, type AccountFieldDefinitionGraph } from "@fenel/engine/field-authoring";
import { executeFieldDefinitionCommand } from "./field-definition-command";

test("a valid legacy edit plus invalid fresh account create refuses before any transaction write", async () => {
  const current: AccountFieldDefinitionGraph = {
    currentOwners: [{
      ownerKey: "type:Legacy", kind: "type", storageName: "Legacy",
      storageId: "c252bb6f-fbba-47ed-8d38-f21995ad0353",
      definition: { id: "Legacy", type: { $ref: "String" } },
    }], currentFields: [], currentFacets: [], storageIssues: [],
  };
  const before = structuredClone(current);
  let transactions = 0;
  let writes = 0;
  let validations = 0;
  let plannedFromLockedGraph = false;
  const result = await executeFieldDefinitionCommand("d54563d3-6f38-4f3e-91cd-876094ed511b", {
    ownerMutations: [
      { kind: "upsert", owner: {
        ownerKey: "type:Legacy", kind: "type", storageName: "Legacy",
        definition: { id: "Legacy", type: { $ref: "Number" } },
      } },
      { kind: "upsert", owner: {
        ownerKey: "function:freshText", kind: "function", storageName: "freshText",
        definition: { id: "freshText", params: [], returns: { $ref: "String" }, body: "new" },
      } },
    ],
  }, {
    plan: (input) => {
      plannedFromLockedGraph = input.currentOwners === current.currentOwners;
      return tryPlanFieldPersistence(input);
    },
    validateSnapshot: () => { validations++; },
    executeTransaction: async (_accountId, planCurrent) => {
      transactions++;
      const planned = await planCurrent(current);
      writes++;
      return planned.snapshot;
    },
  });
  expect(result).toMatchObject({ ok: false, error: {
    $tag: "InvalidOwnerStorageIdentity", ownerKey: "function:freshText", reason: "new-owner-id-not-uuid",
  } });
  expect(transactions).toBe(1);
  expect(plannedFromLockedGraph).toBe(true);
  expect(writes).toBe(0);
  expect(validations).toBe(0);
  expect(current).toEqual(before);
});
