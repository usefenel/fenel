// A2/B3 acquisition bookkeeping shared by server storage codecs and runtime
// codecs. Callers retain their authorized fresh reads and reject storage issues
// before entering this boundary; no reader frame or projection is cached here.
import { createAccountRegistry } from "./repository-registry";
import { projectAccountFieldRegistrySnapshot } from "./account-field-registry";
import { modulesFor } from "./module-manifest";
import { dispatchRegistry } from "./system-entities";
import { prepareSourceModulesFromRows, sourceModuleDispatchRegistry, sourceModuleRowsFingerprint } from "./authoring/source-module";
import type { FieldPersistenceSnapshot } from "./field-authoring";
import type { ModuleRegistry } from "./registry";

type SourceRows = Parameters<typeof prepareSourceModulesFromRows>[0];
type CacheDependencies = {
  readonly dispatchVersion: () => number;
  readonly build: (accountId: string, snapshot: FieldPersistenceSnapshot, rows: SourceRows) => ModuleRegistry;
};

const DEFAULT_DEPENDENCIES: CacheDependencies = {
  dispatchVersion: () => dispatchRegistry.version(),
  build: (accountId, snapshot, rows) => {
    const projection = projectAccountFieldRegistrySnapshot(accountId, snapshot);
    const sources = prepareSourceModulesFromRows(rows);
    const sourceDispatch = sources.length ? sourceModuleDispatchRegistry(sources, dispatchRegistry) : undefined;
    const registry = createAccountRegistry(modulesFor("seed"), [...projection.ownerModules, ...sources.map(entry => entry.module)], {
      dispatchRegistry: sourceDispatch ?? dispatchRegistry,
      bodySpellingPolicy: "defer-legacy-db",
      externalFields: [...projection.externalFields, ...sources.flatMap(entry => entry.fields)],
      identityKinds: new Map([...projection.identityKinds, ...sources.flatMap(entry => entry.fields.map(field => [field.id, "field"] as const))]),
      fieldRepresentations: projection.fieldRepresentations,
    });
    sourceDispatch?.bindSourceMethods(registry);
    return registry;
  },
};

/** One exact snapshot per account, capped to the previous codec-cache limit.
 * Ordering changes conservatively rebuild; no semantic normalization occurs.
 * The dependency seam creates an isolated cache for deterministic host tests. */
export function createCommittedAccountRegistryCache(dependencies: CacheDependencies = DEFAULT_DEPENDENCIES) {
  const registries = new Map<string, { fingerprint: string; registry: ModuleRegistry }>();
  return {
    get(accountId: string, snapshot: FieldPersistenceSnapshot, rows: SourceRows): ModuleRegistry {
      const fingerprint = JSON.stringify({ snapshot, source: sourceModuleRowsFingerprint(rows),
        sourceBytes: rows.map(({ registry }) => registry.source), dispatchVersion: dependencies.dispatchVersion() });
      const cached = registries.get(accountId);
      if (cached?.fingerprint === fingerprint) {
        registries.delete(accountId); registries.set(accountId, cached);
        return cached.registry;
      }
      const registry = dependencies.build(accountId, snapshot, rows);
      registries.set(accountId, { fingerprint, registry });
      while (registries.size > 32) registries.delete(registries.keys().next().value!);
      return registry;
    },
    clear(accountId?: string): void {
      if (accountId === undefined) registries.clear();
      else registries.delete(accountId);
    },
  };
}

const committedAccountRegistries = createCommittedAccountRegistryCache();
export const getCommittedAccountRegistry = committedAccountRegistries.get;
export const clearCommittedAccountRegistry = committedAccountRegistries.clear;
