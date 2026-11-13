import { listAccountImports } from "./registries";

/** One account-scoped DB read; the engine rehydrates source and identity. */
export async function hydrateSourceModules(accountId: string) {
  const rows = await listAccountImports(accountId);
  const { prepareSourceModulesFromRows } = await import("@fenel/engine/authoring/source-module");
  return { rows, prepared: prepareSourceModulesFromRows(rows) };
}
