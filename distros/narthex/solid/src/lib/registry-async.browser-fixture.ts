import "@fenel/engine";
import { createAccountFieldRegistryAsync } from "@fenel/engine/account-field-registry";

export async function checkIsolatedWorker() {
  const fieldId = "b225f6a1-d50d-4bdd-b3ee-b142e9226fae";
  const registry = await createAccountFieldRegistryAsync([], "isolated-browser", {
    owners: [{ ownerKey: "type:BrowserRecord", kind: "type", storageName: "BrowserRecord",
      definition: { id: "BrowserRecord", type: { $record: { fields: [{ name: "title",
        key: { $tag: "NamedField", ref: { $ref: fieldId } }, type: { $ref: "String" },
        label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {},
      }] } } } }],
    fields: [{ id: fieldId, currentCodeName: "title", status: "live", realm: "account", reuseVisibility: "account" }],
    facets: [],
  });
  return registry.getIdentifiedEntity("BrowserRecord")?.type;
}
