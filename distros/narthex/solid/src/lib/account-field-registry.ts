// Authenticated account field-registry lifecycle.
//
// A product registry is always derived from one committed server snapshot. A
// draft or optimistic client mutation never enters this slot. Building happens
// before the single state update, so a failed build leaves the prior registry
// and snapshot intact.

import { createSignal } from "solid-js";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FenelType } from "@fenel/engine/types";
import type { SourceModuleDocument } from "@fenel/engine/authoring/source-module";
import { sourceModulesForAccount } from "./user-registries";

export type AccountFieldRegistryState = {
  readonly accountId: string;
  readonly snapshot: FieldPersistenceSnapshot;
  readonly registry: ModuleRegistry;
  readonly revision: number;
};

export type AccountFieldRegistryBuilder = (
  accountId: string,
  snapshot: FieldPersistenceSnapshot,
) => ModuleRegistry | Promise<ModuleRegistry>;

export type AccountFieldRegistryLoader = (
  accountId: string,
) => Promise<FieldPersistenceSnapshot>;

/** Minimal committed account snapshot returned by public product GETs. */
export type PublicFieldRegistryBundle = {
  readonly rootTypeName: string;
  readonly snapshot: FieldPersistenceSnapshot;
};

export type AccountFieldRegistryLifecycleDependencies = {
  readonly load?: AccountFieldRegistryLoader;
  readonly build?: AccountFieldRegistryBuilder;
};

export class StaleAccountFieldRegistryLoadError extends Error {
  constructor(accountId: string) {
    super(`Discarded stale account field-registry hydration for ${accountId}`);
    this.name = "StaleAccountFieldRegistryLoadError";
  }
}

const [state, setState] = createSignal<AccountFieldRegistryState>();
let loading:
  | { readonly accountId: string; readonly sources: readonly SourceModuleDocument[] | undefined; readonly promise: Promise<ModuleRegistry> }
  | undefined;
let loadEpoch = 0;
let desiredAccountId: string | undefined;

export const accountFieldRegistryState = state;
export const accountFieldRegistry = (): ModuleRegistry | undefined => state()?.registry;

const committedSourceModules = new WeakMap<ModuleRegistry, readonly SourceModuleDocument[]>();

/** The exact installed roster checked with this committed private registry.
 * Public/local builders never acquire the authenticated account's roster. */
export function committedAccountSourceModules(registry: ModuleRegistry): readonly SourceModuleDocument[] | undefined {
  return committedSourceModules.get(registry);
}

/** Browser-safe local builder shared by authenticated and anonymous product
 * surfaces. It consumes inert repository modules plus one server-scoped
 * committed account snapshot and never publishes into global lifecycle state. */
async function buildCompleteAccountFieldRegistry(
  accountId: string,
  snapshot: FieldPersistenceSnapshot,
): Promise<ModuleRegistry> {
  const [adapter, manifest, entities] = await Promise.all([
    import("@fenel/engine/account-field-registry"),
    import("@fenel/engine/module-manifest"),
    import("@fenel/engine/system-entities"),
  ]);
  return adapter.createAccountFieldRegistryAsync(
    manifest.modulesFor("seed"),
    accountId,
    snapshot,
    { dispatchRegistry: entities.dispatchRegistry },
  );
}

export async function buildLocalAccountFieldRegistry(
  accountId: string,
  snapshot: FieldPersistenceSnapshot,
  builder: AccountFieldRegistryBuilder = buildCompleteAccountFieldRegistry,
): Promise<ModuleRegistry> {
  return builder(accountId, snapshot);
}

/** Authenticated acquisition composes the existing reader build once. Its
 * captured source roster also belongs to the catalog worker; a replaced roster
 * cannot publish a registry for an older install/version. */
async function buildCommittedAccountFieldRegistry(accountId: string, snapshot: FieldPersistenceSnapshot): Promise<ModuleRegistry> {
  const reader = await import("./reader-registry");
  const documents = sourceModulesForAccount(accountId);
  const registry = await reader.buildReaderFieldRegistry(accountId, snapshot, documents);
  if (sourceModulesForAccount(accountId) !== documents) throw new StaleAccountFieldRegistryLoadError(accountId);
  committedSourceModules.set(registry, documents);
  return registry;
}

/** Select the fresh registry-local identified definition. Product consumers
 * must never plan against the raw wire type: repository declarations may be
 * keyless before this projection, and falling back would reintroduce names as
 * identity. */
export function resolveLocalIdentifiedType(
  registry: ModuleRegistry,
  bundle: PublicFieldRegistryBundle,
): FenelType {
  const type = registry.getIdentifiedEntity(bundle.rootTypeName)?.type;
  if (type === undefined) {
    throw new Error(
      `Public field registry cannot resolve identified type ${JSON.stringify(bundle.rootTypeName)}`,
    );
  }
  return type;
}

/** Atomically publish a successfully built committed snapshot. The optional
 * builder is a focused test seam; production always uses the complete seed
 * repository profile and registry-local account facets. */
export async function installCommittedAccountFieldSnapshot(
  accountId: string,
  snapshot: FieldPersistenceSnapshot,
  builder: AccountFieldRegistryBuilder = buildCommittedAccountFieldRegistry,
  canPublish: () => boolean = () => true,
): Promise<ModuleRegistry> {
  const nextRegistry = await builder(accountId, snapshot);
  const documents = committedSourceModules.get(nextRegistry);
  if (!canPublish() || documents !== undefined && documents !== sourceModulesForAccount(accountId)) throw new StaleAccountFieldRegistryLoadError(accountId);
  let preparedWorker: typeof import("./expression-runner/authoring-catalog-worker") | undefined;
  // A post-save snapshot swap must be as ready as initial workspace startup.
  // Prepare the new catalog before publication while the previous committed
  // registry and worker continue serving the visible editor. The first load is
  // prepared by the shell with its complete API type metadata instead.
  if (builder === buildCommittedAccountFieldRegistry && state()?.accountId === accountId) {
    const { prepareCommittedAuthoringSession } = await import("./expression-runner/authoring-session");
    preparedWorker = await import("./expression-runner/authoring-catalog-worker");
    const entities = snapshot.owners.flatMap((owner) => owner.kind === "type"
      ? [{ id: owner.definition.id, type: owner.definition.type }] : []);
    await prepareCommittedAuthoringSession(nextRegistry, accountId, snapshot, entities);
    if (!canPublish()) {
      preparedWorker.discardPreparedAuthoringWorker(nextRegistry);
      throw new StaleAccountFieldRegistryLoadError(accountId);
    }
  }
  if (documents !== undefined && documents !== sourceModulesForAccount(accountId)) {
    preparedWorker?.discardPreparedAuthoringWorker(nextRegistry);
    throw new StaleAccountFieldRegistryLoadError(accountId);
  }
  const revision = (state()?.revision ?? 0) + 1;
  setState({ accountId, snapshot, registry: nextRegistry, revision });
  preparedWorker?.activatePreparedAuthoringWorker(nextRegistry);
  return nextRegistry;
}

/** Fetch without building or publishing, so workspace startup can finish all
 * network reads together before entering the synchronous checked build. */
export async function fetchCommittedAccountFieldSnapshot(_accountId: string): Promise<FieldPersistenceSnapshot> {
  const { apiRead } = await import("./api");
  const { fieldDefinitionSnapshotFromJsonWire } = await import("@fenel/engine/authoring/expression");
  const response = await apiRead<{ snapshot: FieldPersistenceSnapshot }>(
    "/definition-bundles",
    45_000,
  );
  return fieldDefinitionSnapshotFromJsonWire(response.snapshot);
}

export async function reloadAccountFieldRegistry(
  accountId: string,
  dependencies: AccountFieldRegistryLifecycleDependencies = {},
): Promise<ModuleRegistry> {
  const epoch = ++loadEpoch;
  desiredAccountId = accountId;
  const snapshot = await (dependencies.load ?? fetchCommittedAccountFieldSnapshot)(accountId);
  if (epoch !== loadEpoch || desiredAccountId !== accountId) {
    throw new StaleAccountFieldRegistryLoadError(accountId);
  }
  return installCommittedAccountFieldSnapshot(
    accountId,
    snapshot,
    dependencies.build ?? buildCommittedAccountFieldRegistry,
    () => epoch === loadEpoch && desiredAccountId === accountId,
  );
}

/** Idempotent authenticated hydration. Switching accounts clears the previous
 * account before fetching, preventing even a transient cross-account read. */
export function ensureAccountFieldRegistryLoaded(
  accountId: string,
  dependencies: AccountFieldRegistryLifecycleDependencies = {},
): Promise<ModuleRegistry> {
  const current = state();
  const sources = dependencies.build === undefined ? sourceModulesForAccount(accountId) : undefined;
  if (current?.accountId === accountId) {
    const documents = committedSourceModules.get(current.registry);
    if (documents === undefined || documents === sources) return Promise.resolve(current.registry);
  }
  if (loading?.accountId === accountId && loading.sources === sources) return loading.promise;
  if (current !== undefined && current.accountId !== accountId) setState(undefined);

  const promise = reloadAccountFieldRegistry(accountId, dependencies).finally(() => {
    if (loading?.promise === promise) loading = undefined;
  });
  loading = { accountId, sources, promise };
  return promise;
}

export function clearAccountFieldRegistry(): void {
  loadEpoch++;
  desiredAccountId = undefined;
  setState(undefined);
  loading = undefined;
}
