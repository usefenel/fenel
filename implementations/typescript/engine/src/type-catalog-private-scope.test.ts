import { expect, test } from "bun:test";
import { modulesFor } from "./module-manifest";
import { createRegistry } from "./registry";
import { dispatchRegistry } from "./system-entities";
import { __catalogHasRegisteredEntityForTests, getCatalog, registerCatalogEntities, type CatalogSection } from "./type-catalog";

const entityIds = (sections: readonly CatalogSection[]) =>
  sections.find(section => section.id === "entity")?.entries.map(entry => entry.id) ?? [];

// A private registry (publishCatalogEntities: false) publishes none of its own
// types. Rows another registry publishes later must not enter its scoped
// catalogue either: a reader's type list cannot depend on realm history.
test("a private registry's scoped catalogue ignores module rows other registries published", () => {
  const privateRegistry = createRegistry(modulesFor("seed"), { dispatchRegistry, publishCatalogEntities: false });
  const before = entityIds(getCatalog(privateRegistry));
  registerCatalogEntities([{ id: "PublishedElsewhereProbe", module: "other_registry_probe",
    type: { $tuple: [{ $ref: "String" }] } }]);
  expect(__catalogHasRegisteredEntityForTests("PublishedElsewhereProbe")).toBe(true);
  const after = entityIds(getCatalog(privateRegistry));
  expect(after).not.toContain("entity:PublishedElsewhereProbe");
  expect(after).toEqual(before);
}, 600_000);
