import { getCatalog as engineCatalog, getCatalogEntry as engineCatalogEntry, type CatalogSection } from "@fenel/engine";
import { accountFieldRegistry } from "./account-field-registry";
import type { ModuleRegistry } from "@fenel/engine/registry";

// Read the live committed registry on every call, including same-account
// snapshot swaps. The engine keeps these projections in a WeakMap keyed by
// registry; clearing a session cannot reuse another account's function views.
const emptyCatalog: CatalogSection[] = [];
const preparedCatalogs = new WeakMap<ModuleRegistry, CatalogSection[]>();

/** The background worker checks the same committed registry input and sends
 * its display projection with the authoring catalog. Reuse that projection so
 * the first type summary or Browse click cannot rebuild every function label. */
export function installPreparedWorkspaceCatalog(registry: ModuleRegistry, catalog: CatalogSection[]): void {
  preparedCatalogs.set(registry, catalog);
}

export function getCatalog() {
  const registry = accountFieldRegistry();
  return registry ? preparedCatalogs.get(registry) ?? engineCatalog(registry) : emptyCatalog;
}

export function getCatalogEntry(id: string) {
  const registry = accountFieldRegistry();
  if (!registry) return undefined;
  // Qualified entity addresses retain the engine's exact module-owner route.
  if (id.startsWith("entity:") && id.slice("entity:".length).includes(".")) return engineCatalogEntry(id, registry);
  const prepared = preparedCatalogs.get(registry);
  if (!prepared) return engineCatalogEntry(id, registry);
  for (const section of prepared) {
    const entry = section.entries.find((entry) => entry.id === id);
    if (entry) return entry;
  }
  return undefined;
}
