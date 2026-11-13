import { expect, test } from "bun:test";
import { beginOwnerProducerInputScope, observeOwnerFullCatalogueRead } from "./owner-input-producer-state";

test("a swallowed full-catalogue attempt still refuses the narrow producer", () => {
  const scope = beginOwnerProducerInputScope("entity-envelope");
  expect(() => observeOwnerFullCatalogueRead("getCatalog")).toThrow("at getCatalog");
  expect(() => scope.finish()).toThrow("forbidden full-catalogue attempts: getCatalog");
  const next = beginOwnerProducerInputScope("entity-envelope");
  expect(next.finish()).toEqual({ contract: "entity-envelope", catalogueAttempts: 0, catalogueAttemptDoors: [] });
});
test("broad contract retains original catalogue access and has a separate observation", () => {
  observeOwnerFullCatalogueRead("getCatalog");
  const scope = beginOwnerProducerInputScope("all");
  observeOwnerFullCatalogueRead("buildCatalog");
  expect(scope.finish()).toEqual({ contract: "all", catalogueAttempts: 1, catalogueAttemptDoors: ["buildCatalog"] });
});
