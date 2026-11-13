// DB validation owns a committed snapshot read; runtime callers keep their
// protected state-read gateway. No product registry is built from draft fields.
import { getCommittedAccountRegistry, clearCommittedAccountRegistry } from "@fenel/engine/committed-account-registry-cache";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { loadAccountFieldDefinitionGraph } from "./field-definition-bundles";
import { listAccountImports } from "./registries";

export function clearDbAccountValueRegistry(accountId?: string): void {
  clearCommittedAccountRegistry(accountId);
}

/** Read on each value boundary so edits to field Codeable/presentation/type
 * invalidate cached authority. Canonical committed ordering is supplied by the
 * field-definition snapshot query; any ordering change merely rebuilds. */
export async function getDbAccountValueRegistry(accountId: string): Promise<ModuleRegistry> {
  const [graph, sourceRows] = await Promise.all([loadAccountFieldDefinitionGraph(accountId), listAccountImports(accountId)]);
  if (graph.storageIssues.length) throw new Error("Cannot validate values against ambiguous account type definitions");
  const snapshot = { owners: graph.currentOwners, fields: graph.currentFields, facets: graph.currentFacets };
  return getCommittedAccountRegistry(accountId, snapshot, sourceRows);
}
