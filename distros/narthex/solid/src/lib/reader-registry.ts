import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import type { SourceModuleDocument } from "@fenel/engine/authoring/source-module";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { Instance } from "@fenel/engine";
import type { FieldPersistenceInput } from "@fenel/engine/field-authoring";
import type { InstanceDraft } from "./instances/instance-draft";
import type { FieldAuthoringCatalogPage, FieldAuthoringCatalogRow, FieldResurrectionOwnerTarget } from "./api";
import type { FieldReuseCatalogCandidate, FieldReuseCatalogQuery } from "@fenel/engine/field-authoring";
import type { RegistryPreparationHost } from "../../../../../implementations/typescript/engine/src/field-identity-worker-client";

async function localFieldCatalogInputs(sourceId: string, snapshot: FieldPersistenceSnapshot) {
  if (!sourceId) throw new TypeError("Local field lookup requires its retained source identity.");
  const [fields, catalogue] = await Promise.all([
    import("@fenel/engine/field-authoring"), import("@fenel/engine/repository-field-catalog"),
  ]);
  const repository = catalogue.repositoryFieldCatalog();
  const local = fields.localFieldReuseCatalogCandidates({ owners: snapshot.owners, fields: snapshot.fields,
    facets: snapshot.facets, externalFields: catalogue.REPOSITORY_REUSABLE_DURABLE_FIELDS });
  const repositoryCandidates: FieldReuseCatalogCandidate[] = repository.fields.map(field => ({ ...field, status: "live" }));
  return { fields, local, repositoryCandidates, facetInterfaceNames: repository.facetInterfaceNames };
}

/** B3 presentation/provenance projection of already admitted catalogue facts.
 * Legacy persistence realm words do not turn the tab into an account. */
async function localFieldCatalogRow(sourceId: string, candidate: Omit<FieldReuseCatalogCandidate, "status">,
  localIds: ReadonlySet<string>): Promise<FieldAuthoringCatalogRow> {
  const [{ canonical }, { typeCode }] = await Promise.all([
    import("@fenel/engine/locale"), import("@fenel/engine/authoring/expression"),
  ]);
  const local = localIds.has(candidate.fieldId);
  return { fieldId: candidate.fieldId, codeName: candidate.codeName,
    ...(candidate.label === undefined ? {} : { label: canonical(candidate.label) }),
    owners: [...candidate.owners], occurrenceTypes: candidate.occurrenceTypes.map(type => typeCode(type)),
    realm: local ? "local" : candidate.realm,
    reuseVisibility: local && candidate.reuseVisibility === "account" ? "local" : candidate.reuseVisibility,
    ...(local ? { sourceId } : {}) };
}

export async function queryLocalFieldAuthoringCatalog(sourceId: string, snapshot: FieldPersistenceSnapshot,
  query: FieldReuseCatalogQuery = {}): Promise<FieldAuthoringCatalogPage> {
  const input = await localFieldCatalogInputs(sourceId, snapshot);
  const page = input.fields.queryFieldReuseCatalogCandidates([...input.local, ...input.repositoryCandidates], query);
  const localIds = new Set(input.local.map(field => field.fieldId));
  return { fields: await Promise.all(page.fields.map(field => localFieldCatalogRow(sourceId, field, localIds))),
    facetInterfaceNames: [...input.facetInterfaceNames], ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) };
}

export async function queryLocalFieldAuthoringIdentity(sourceId: string, snapshot: FieldPersistenceSnapshot,
  fieldId: string): Promise<{ field: FieldAuthoringCatalogRow | null }> {
  const input = await localFieldCatalogInputs(sourceId, snapshot);
  // Exact held identity is intentionally independent of reuse pagination and
  // visibility: owner-local identities remain discoverable by their source.
  const candidate = [...input.local, ...input.repositoryCandidates].find(field => field.fieldId === fieldId);
  return { field: candidate ? await localFieldCatalogRow(sourceId, candidate, new Set(input.local.map(field => field.fieldId))) : null };
}

export async function queryLocalFieldResurrectionCatalog(sourceId: string, snapshot: FieldPersistenceSnapshot,
  target: FieldResurrectionOwnerTarget): Promise<{ fields: Array<{ fieldId: string; codeName: string }> }> {
  if (!sourceId) throw new TypeError("Local field lookup requires its retained source identity.");
  const fields = await import("@fenel/engine/field-authoring");
  return { fields: [...fields.queryFieldResurrectionsByTarget(snapshot.owners, snapshot.fields, target)] };
}

export type ReaderSourceDeclarations = {
  readonly functions: readonly string[];
  readonly entities: readonly { readonly id: string; readonly module: string }[];
};
const sourceDeclarations = new WeakMap<ModuleRegistry, ReaderSourceDeclarations>();

/** Exact source ingress identities captured by this checked registry. A name
 * shared with a repository module does not erase installed declarations. */
export function readerSourceDeclarations(registry: ModuleRegistry): ReaderSourceDeclarations | undefined {
  return sourceDeclarations.get(registry);
}

/** Browser registry acquisition only: the existing engine projections own
 * field identity, source namespaces, dispatch and validation. Both the pane
 * and its worker receive this same committed account/source snapshot. */
export async function buildReaderFieldRegistry(
  accountId: string,
  snapshot: FieldPersistenceSnapshot,
  documents: readonly SourceModuleDocument[],
  options: { preparation?: "worker" | "inline"; repositoryNamespaces?: ReadonlySet<string> } = {},
): Promise<ModuleRegistry> {
  const [fields, source, registryBuilder, manifest, entities] = await Promise.all([
    import("@fenel/engine/account-field-registry"),
    import("@fenel/engine/authoring/source-module"),
    import("@fenel/engine/repository-registry"),
    import("@fenel/engine/module-manifest"),
    import("@fenel/engine/system-entities"),
  ]);
  // The catalog already runs in a terminable worker. Re-enter the same checked
  // synchronous constructor there instead of booting a second engine worker.
  // Main-thread readers retain asynchronous preparation and its input yields.
  if (documents.length === 0) {
    const create = options.preparation === "inline"
      ? fields.createAccountFieldRegistry : fields.createAccountFieldRegistryAsync;
    return create(manifest.modulesFor("seed"), accountId, snapshot,
      { dispatchRegistry: entities.dispatchRegistry });
  }
  const prepared = documents.map((document) => source.prepareSourceModule(document.source,
    document.namespace ?? source.sourceModuleFallbackName(document.slug), document.identity));
  // Simultaneous readers receive the exact preparation worker's checked
  // execute-profile projection, avoiding a namespace-only full build here.
  // A later standalone main-thread rebuild can reuse only the repository data
  // retained after that successful checked preparation. Inline workers keep
  // their existing checked engine memo and never import the browser client.
  const repositoryNamespaces = options.repositoryNamespaces ?? (options.preparation === "inline" ? undefined
    : (await import("./repository-namespaces")).checkedRepositoryNamespaces());
  source.assertSourceModuleNamespaces(prepared, repositoryNamespaces ?? source.reservedSourceModuleNamespaces());
  const projected = fields.projectAccountFieldRegistrySnapshot(accountId, snapshot);
  const sourceFields = prepared.flatMap((entry) => [...entry.fields]);
  const dispatch = source.sourceModuleDispatchRegistry(prepared);
  const create = options.preparation === "inline"
    ? registryBuilder.createAccountRegistry : registryBuilder.createAccountRegistryAsync;
  const registry = await create(manifest.modulesFor("seed"),
    [...projected.ownerModules, ...prepared.map((entry) => entry.module)], {
      externalFields: [...projected.externalFields, ...sourceFields],
      identityKinds: new Map([...projected.identityKinds, ...sourceFields.map((field) => [field.id, "field"] as const)]),
      fieldRepresentations: projected.fieldRepresentations,
      dispatchRegistry: dispatch,
      bodySpellingPolicy: "defer-legacy-db",
    });
  dispatch.bindSourceMethods(registry);
  sourceDeclarations.set(registry, Object.freeze({
    functions: Object.freeze(prepared.flatMap(entry => (entry.module.functions ?? []).map(fn => fn.id))),
    entities: Object.freeze(prepared.flatMap(entry => (entry.module.entities ?? []).map(entity =>
      Object.freeze({ id: entity.id, module: entry.module.name })))),
  }));
  return registry;
}

/** Tab preparation mirrors the same checked registry in its existing worker.
 * Field ownership remains transient, and no local declarations enter the
 * legacy process catalogue or an authenticated account's facet pool. */
export async function buildLocalReaderFieldRegistry(sourceId: string, snapshot: FieldPersistenceSnapshot,
  options: { preparation?: "worker" | "inline"; representations?: readonly InstanceDraft[]; signal?: AbortSignal;
    preparationHost?: RegistryPreparationHost } = {}): Promise<ModuleRegistry> {
  options.signal?.throwIfAborted();
  if (options.preparation === "inline" && options.preparationHost !== undefined)
    throw new TypeError("Inline registry preparation cannot wait on a worker transport.");
  const [fields, manifest, entities, dispatchTools] = await Promise.all([
    import("@fenel/engine/account-field-registry"), import("@fenel/engine/module-manifest"), import("@fenel/engine/system-entities"),
    import("@fenel/engine"),
  ]);
  options.signal?.throwIfAborted();
  const dispatch = dispatchTools.createDispatchRegistry();
  for (const cls of entities.dispatchRegistry.listClasses()) dispatch.defineClass(cls);
  // GLOBAL_ONLY: a tab reader has anonymous authority and imports repository
  // seed instances only. Previous account rows never enter its private pool.
  for (const instance of entities.dispatchRegistry.listInstances()) {
    if (dispatchTools.instanceVisible(instance, dispatchTools.GLOBAL_ONLY)) dispatch.addInstance(instance);
  }
  // Instance's legacy TypeExpr[] envelope is narrower than the ordinary
  // instance editor's data arguments. Registration owns descriptor/method
  // admission; this is its existing B3 wire projection, not a second matcher.
  for (const instance of options.representations ?? []) dispatch.addInstance(structuredClone(instance) as Instance);
  const create = options.preparation === "inline" ? fields.createLocalFieldRegistry : fields.createLocalFieldRegistryAsync;
  options.signal?.throwIfAborted();
  const registry = await create(manifest.modulesFor("seed"), sourceId, snapshot,
    { dispatchRegistry: dispatch, signal: options.signal, preparationHost: options.preparationHost });
  options.signal?.throwIfAborted();
  const modules = fields.projectLocalFieldRegistrySnapshot(sourceId, snapshot).ownerModules;
  sourceDeclarations.set(registry, Object.freeze({
    functions: Object.freeze(modules.flatMap(module => (module.functions ?? []).map(fn => fn.id))),
    entities: Object.freeze(modules.flatMap(module => (module.entities ?? []).map(entity => Object.freeze({ id: entity.id, module: module.name })))),
  }));
  return registry;
}

export type LocalDefinitionBundle = Pick<FieldPersistenceInput,
  "ownerMutations" | "desiredFacets" | "replaceFacetFieldIds" | "resurrectFieldIds">;

/** Invoke the existing Fenel planner; this result is not a published/checked
 * reader. The source must prepare the exact planned definitions and retained
 * instance rows before committing either state or snapshot. */
export async function planLocalDefinitionBundle(sourceId: string, current: FieldPersistenceSnapshot,
  bundle: LocalDefinitionBundle): Promise<FieldPersistenceSnapshot> {
  if (!sourceId) throw new TypeError("Local definition planning requires its retained source identity.");
  const [fields, catalog, identity] = await Promise.all([
    import("@fenel/engine/field-authoring"), import("@fenel/engine/repository-field-catalog"),
    import("@fenel/engine/repository-identity-manifest"),
  ]);
  const owners = fields.projectFieldOwnerMutations(current.owners, bundle.ownerMutations);
  const ownerMutations = fields.prepareLocalConstructorFunctionMutations(sourceId, current,
    { ...current, owners }, bundle.ownerMutations, () => crypto.randomUUID(), identity.repositoryIdentityKinds());
  return fields.planFieldPersistence({ currentOwners: current.owners, currentFields: current.fields,
    currentFacets: current.facets, ...bundle, ownerMutations,
    repositoryFields: catalog.REPOSITORY_REUSABLE_DURABLE_FIELDS,
    identityKinds: identity.repositoryIdentityKinds() }).snapshot;
}
