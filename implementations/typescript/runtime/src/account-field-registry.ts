// Runtime account field-registry hydration for product channels (Telegram,
// validation, widgets hosted server-side). The DB graph is already canonical;
// this module only snapshots it and delegates registry construction to the
// engine's committed-snapshot adapter.

import {
  dispatchRegistry,
  type FieldPersistenceSnapshot,
} from "@fenel/engine";
import type { AccountFieldDefinitionGraph } from "@fenel/engine/field-authoring";
import { getCommittedAccountRegistry, clearCommittedAccountRegistry } from "@fenel/engine/committed-account-registry-cache";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { loadAccountFieldDefinitionGraphState } from "./state-field-definitions";
import { loadAccountSourceModulesState } from "./state-source-modules";
import { prepareSourceModulesFromRows, sourceModuleRowsFingerprint, type PreparedSourceModule } from "@fenel/engine/authoring/source-module";

type SourceRows = Parameters<typeof prepareSourceModulesFromRows>[0];

export type RuntimeAccountFieldRegistryDependencies = {
  readonly load: (accountId: string) => Promise<AccountFieldDefinitionGraph>;
  readonly loadSources?: (accountId: string) => Promise<SourceRows>;
  readonly build: (
    accountId: string,
    snapshot: FieldPersistenceSnapshot,
    sources?: readonly PreparedSourceModule[],
  ) => ModuleRegistry;
};

const cache = new Map<string, { dependencies: RuntimeAccountFieldRegistryDependencies; fingerprint: string; registry: ModuleRegistry }>();
const MAX_CACHED_ACCOUNTS = 32;

const DEFAULT_READS = {
  load: loadAccountFieldDefinitionGraphState,
  loadSources: loadAccountSourceModulesState,
};

/** Load the current graph on every channel boundary, but rebuild the expensive
 * registry only when its canonical committed fingerprint changed. */
export async function getRuntimeAccountFieldRegistry(
  accountId: string,
  dependencies?: RuntimeAccountFieldRegistryDependencies,
): Promise<ModuleRegistry> {
  const reads = dependencies ?? DEFAULT_READS;
  const [graph, sourceRows] = await Promise.all([reads.load(accountId), reads.loadSources?.(accountId) ?? Promise.resolve([])]);
  if (graph.storageIssues.length > 0) {
    throw new Error(
      "runtime account field registry: ambiguous current owner definitions",
      { cause: graph.storageIssues },
    );
  }
  const snapshot: FieldPersistenceSnapshot = {
    owners: graph.currentOwners,
    fields: graph.currentFields,
    facets: graph.currentFacets,
  };
  if (dependencies === undefined) return getCommittedAccountRegistry(accountId, snapshot, sourceRows);
  // Custom host builders are isolated from the shared production acquisition.
  const fingerprint = JSON.stringify([snapshot, sourceModuleRowsFingerprint(sourceRows), sourceRows.map(({ registry }) => registry.source), dispatchRegistry.version()]);
  const prior = cache.get(accountId);
  if (prior?.dependencies === dependencies && prior.fingerprint === fingerprint) {
    cache.delete(accountId); cache.set(accountId, prior);
    return prior.registry;
  }
  const registry = dependencies.build(accountId, snapshot, prepareSourceModulesFromRows(sourceRows));
  cache.set(accountId, { dependencies, fingerprint, registry });
  while (cache.size > MAX_CACHED_ACCOUNTS) cache.delete(cache.keys().next().value!);
  return registry;
}

export function clearRuntimeAccountFieldRegistry(accountId?: string): void {
  clearCommittedAccountRegistry(accountId);
  if (accountId === undefined) cache.clear();
  else cache.delete(accountId);
}
