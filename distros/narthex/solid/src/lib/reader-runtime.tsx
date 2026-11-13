import { createContext, createSignal, lazy, useContext, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { CatalogEntry, CatalogSection, FenelFunction, FenelType, TypeView } from "@fenel/engine";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import type { FieldOwnerEntity } from "@fenel/engine/field-identity";
import type { Instance } from "@fenel/engine";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { TemplateRegistry } from "@fenel/engine/template-registry";
import type { SourceModuleDocument } from "@fenel/engine/authoring/source-module";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import type { LocusCatalogLookups } from "./locus-catalog-reference";
import type { PublicLocusData } from "./public-locus-data";
import { ApiClientContext, createAccountApiClient, createPublicApiClient, type ApiClient } from "./api";
import { assertCurrentSession, onBrowserSessionChange, sessionEpoch } from "./browser-session";
import { buildLocalAccountFieldRegistry } from "./account-field-registry";
import { FieldPresentationRegistryProvider } from "./field-renderer/field-presentation-context";
import { accountFunctionRows, repositoryFunctionIdsForAuthoring, type AccountFunctionRow } from "./user-function-roster";
import { buildReaderFieldRegistry } from "./reader-registry";
import type { ReaderPresentation } from "./reader-presentation";
import type { PreparedReaderWorker } from "./expression-runner/authoring-catalog-worker";
import type { FunctionCardType } from "./function-card-body";
import type { LocalPresentationState } from "./local-reader-presentation";
import type { SourceReaderValueReadInput, SourceReaderValueReadPacket } from "./reader-presentation";
import { localTabDataSource, createLocalApiClient, catalogCallableLabels } from "./local-locus-data";
import type { LocalTabData, LocalTabSource } from "./local-locus-data";
import type { InstanceDraft, InstanceApiRow } from "./instances/instance-draft";
import type { LocusSynchronization } from "./locus-synchronization";
import type { ReaderSourceMetadataCapture } from "./reader-source-metadata";
import { createReaderDraftClient } from "./reader-draft-client";
import { authoringRealmOwnerFor, bindCoreAuthoringOwner, inheritCoreAuthoringOwner } from "./expression-runner/authoring-catalog-early-realm";
export type { ReaderPresentation } from "./reader-presentation";

export type ReaderTypeRow = ReaderPresentation & Pick<FieldOwnerEntity, "params" | "typeScheme" | "constructorFunction"> & {
  id?: string; name: string; type?: FenelType; module?: string; isSystem?: boolean;
  /** Raw account storage DTO, when present. The flattened owner fields above
   * are the canonical reader ingress and replace this copy on local edits. */
  declaration?: Pick<FieldOwnerEntity, "params" | "typeScheme"> | null;
};
export type ReaderFunctionRow = AccountFunctionRow & ReaderPresentation & { id?: string; name: string };

type ReaderSnapshot = {
  definitions: FieldPersistenceSnapshot;
  registry: ModuleRegistry;
  session: AuthoringSession;
  functions: readonly FenelFunction[];
  types: readonly ReaderTypeRow[];
  functionRows: readonly ReaderFunctionRow[];
  modules: readonly SourceModuleDocument[];
  views: readonly TypeView[];
  templates: TemplateRegistry;
  catalog: readonly CatalogSection[];
  metadata: ReadonlyMap<string, ReadonlyMap<string, Record<string, unknown>>>;
  ownPresentations: ReadonlyMap<string, ReaderPresentation>;
};

/** One reader owns one coherent snapshot. Selecting a sibling changes only
 * which runtime a pane consumes; it never publishes a global account/registry. */
export type ReaderRuntime = {
  readonly kind: "account" | "public" | "local";
  readonly accountId?: string;
  readonly epoch: number;
  readonly client: ApiClient;
  readonly publicData?: PublicLocusData;
  readonly registry: () => ModuleRegistry;
  readonly session: () => AuthoringSession;
  readonly captureSourceMetadata?: () => ReaderSourceMetadataCapture | undefined;
  readonly functions: () => readonly FenelFunction[];
  readonly types: () => readonly ReaderTypeRow[];
  readonly functionRows: () => readonly ReaderFunctionRow[];
  readonly modules: () => readonly SourceModuleDocument[];
  readonly views: () => readonly TypeView[];
  readonly templates: () => TemplateRegistry;
  readonly catalog: () => readonly CatalogSection[];
  readonly revision: () => number;
  readonly loading: () => boolean;
  readonly catalogLookups: LocusCatalogLookups;
  catalogEntry(id: string): CatalogEntry | undefined;
  presentation(id: string): ReaderPresentation | undefined;
  ownIcon(id: string): string | undefined;
  representation(typeName: string, id: string): Record<string, unknown> | undefined;
  /** B3 (Local): the snapshot's worker, which owns every read presentation. */
  readonly readerWorker?: () => PreparedReaderWorker;
  /** B3 (Local): true while the worker has not answered this id yet. */
  presentationPending?(id: string): boolean;
  referencePending?(id: string): boolean;
  /** B3 (Local): whether `compute` read an entry the worker has not answered. */
  observePending?<T>(compute: () => T): { value: T; pending: boolean; failed: boolean };
  /** B3 (Local): a type caption computed in the worker frame. */
  typePresentation?(type: FenelType): FunctionCardType<FenelType> | undefined;
  typePresentationPending?(type: FenelType): boolean;
  /** B3 (Local): the worker's read packet for a value (reflection, view, caption). */
  valueState?(value: unknown, type?: FenelType, read?: { thumbnail?: boolean }): LocalPresentationState<SourceReaderValueReadPacket>;
  /** (Local) One shared, cached `project-reader-values` read for a typed read
   * surface, keyed by worker incarnation, template roster and captured wire.
   * `undefined`: this reader's cache does not serve the read (another worker
   * context or template registry, a value too large to key); ask the worker. */
  readValue?(worker: PreparedReaderWorker, input: SourceReaderValueReadInput, templates: TemplateRegistry,
    signal?: AbortSignal): Promise<{ valueReads: SourceReaderValueReadPacket[] }> | undefined;
  /** B3 (Local): the handle Fenel resolves for a function id, from the worker. */
  referenceHandle?(id: string): string | undefined;
  /** B3 (Local): inert lookup of a declared type by name, over the tab's own
   * definitions and the worker-published catalogue (no dispatch). */
  resolveTypeName?(name: string): FenelType | undefined;
  retryPresentation?(): void | Promise<boolean>;
  reload(): Promise<void>;
  prepareFunction(functionId: string, draft?: FenelFunction, signal?: AbortSignal): Promise<AuthoringSession>;
  draftSession(draft: FenelFunction): AuthoringSession;
  dispose(): void;
};

// Solid 2 treats an undefined default as a required context. A read surface
// outside a lens (for example the profile) deliberately has no reader.
export const ReaderRuntimeContext = createContext<ReaderRuntime | null>(null);
export function useReaderRuntime(): ReaderRuntime | undefined { return useContext(ReaderRuntimeContext) ?? undefined; }
const ReaderAuthoringProvider = lazy(async () => ({
  default: (await import("./workspace-authoring-provider")).ReaderAuthoringProvider,
}));

export function ReaderRuntimeProvider(props: { runtime: ReaderRuntime; children: JSX.Element }) {
  const runtime = untrack(() => props.runtime);
  return <ReaderRuntimeContext value={runtime}>
    <ApiClientContext value={runtime.client}>
      <ReaderAuthoringProvider session={() => runtime.session()} captureSourceMetadata={() => runtime.captureSourceMetadata?.()}>
        <FieldPresentationRegistryProvider registry={runtime.registry()}>{props.children}</FieldPresentationRegistryProvider>
      </ReaderAuthoringProvider>
    </ApiClientContext>
  </ReaderRuntimeContext>;
}

export type AccountReaderPreparation = {
  epoch?: number;
  signal?: AbortSignal;
  onStage?: (stage: string) => void;
  prepareAfter?: () => Promise<unknown>;
  synchronization?: LocusSynchronization;
};

/** The captured HTTP reader is usable immediately. Its first root read and
 * the checked authoring snapshot share the client, cache and session fence. */
export function startAccountReaderRuntime(accountId: string,
  options: AccountReaderPreparation = {},
): { client: ApiClient; ready: Promise<ReaderRuntime> } {
  const epoch = options.epoch ?? untrack(sessionEpoch);
  let active = true;
  let firstRootReady = false;
  let runtime: ReaderRuntime | undefined;
  const pendingRegistries = new Set<ModuleRegistry>();
  let committedSnapshot: ReaderSnapshot | undefined;
  let repositoryIds: ReadonlySet<string>;
  let draftSource: LocalTabSource | undefined;
  const borrowedRegistries = new Set<ModuleRegistry>();
  const retiredCommittedRegistries = new Set<ModuleRegistry>();
  let draftChanged = () => {};
  let canStageRepresentations = () => false;
  const pendingPreparations = new Set<AbortController>();
  let authoring: typeof import("./expression-runner/authoring-session");
  let workers: typeof import("./expression-runner/authoring-catalog-worker") | undefined;
  let templates: typeof import("./web-template-registry");
  let metadataGeneration = 0;
  let refreshMetadata = async () => {};
  const remote = createAccountApiClient(accountId, { epoch,
    onDefinitionsChanged: () => {
      assertActive();
      if (!runtime) return Promise.reject(new Error("This reader's editing tools are not ready."));
      return runtime.reload();
    },
    onMetadataChanged: () => refreshMetadata() });
  const realmOwner = authoringRealmOwnerFor(remote);
  const client = createReaderDraftClient(remote, {
    synchronization: options.synchronization,
    createSource: () => createDraftSource(),
    modules: () => committedSnapshot?.modules ?? [],
    canStageRepresentations: () => canStageRepresentations(),
    onChanged: () => draftChanged(),
    onDefinitionsChanged: async () => {
      assertActive();
      if (!runtime) throw new Error("This reader's editing tools are not ready.");
      await runtime.reload();
      remote.revalidate(["locusRoot", "locusViews", "savedQueries", "types", "functions", "dispatchInstances"]);
    },
  });
  inheritCoreAuthoringOwner(client, remote, client.signal);
  const assertActive = () => {
    assertCurrentSession(epoch);
    options.signal?.throwIfAborted();
    if (!active) throw new Error("This reader was closed.");
  };
  const abort = () => {
    active = false;
    for (const preparation of pendingPreparations) preparation.abort(options.signal?.reason);
    client.dispose();
    for (const registry of pendingRegistries) workers?.discardPreparedAuthoringWorker(registry);
    runtime?.dispose();
  };
  options.signal?.addEventListener("abort", abort, { once: true });

  async function loadMetadata(previousTargets: Iterable<string> = []): Promise<Pick<ReaderSnapshot, "metadata" | "ownPresentations">> {
    const response = await remote.apiRead<{ targets: string[] }>("/reader-metadata/targets");
    assertActive();
    // Only account-row targets need server projection. Repository metadata
    // stays bundled; old targets are re-read so deletion cannot retain an old
    // override. Rows enumerate ids only; the server chooses every winner.
    const targets = new Set(previousTargets);
    for (const target of response.targets) targets.add(target);
    const ids = [...targets];
    const projected = new Map<string, ReadonlyMap<string, Record<string, unknown>>>();
    const ownPresentations = new Map<string, ReaderPresentation>();
    for (let start = 0; start < ids.length; start += 128) {
      const result = await remote.api.readerMetadata(ids.slice(start, start + 128));
      assertActive();
      for (const entry of result.entries) {
        const methods = new Map(entry.representations.map((instance) => [instance.typeName, instance.methods] as const));
        if (entry.ioInvokable) methods.set("IOInvokable", entry.ioInvokable);
        projected.set(entry.target, methods);
        if (entry.ownPresentation !== undefined) ownPresentations.set(entry.target, entry.ownPresentation);
      }
    }
    return { metadata: projected, ownPresentations };
  }

  async function prepareAccountSnapshot(acquiredSnapshot: FieldPersistenceSnapshot,
    input: Pick<ReaderSnapshot, "types" | "functionRows" | "modules" | "views" | "metadata" | "ownPresentations">,
    signal?: AbortSignal): Promise<ReaderSnapshot> {
    assertActive();
    const preparation = new AbortController();
    pendingPreparations.add(preparation);
    const abortPreparation = () => preparation.abort(signal?.reason);
    signal?.addEventListener("abort", abortPreparation, { once: true });
    if (signal?.aborted) abortPreparation();
    let candidateRegistry: ModuleRegistry | undefined;
    try {
    preparation.signal.throwIfAborted();
    const { types, functionRows, views, metadata, ownPresentations } = input;
    const acquiredFunctions = accountFunctionRows(functionRows, repositoryIds).map((row) => row.function);
    const acquiredModules = input.modules;
    options.onStage?.("Preparing data…");
    const acquiredEntities = types.flatMap((row) => row.type ? [{ id: row.name, type: row.type, module: row.module }] : []);
    const acquired = { snapshot: acquiredSnapshot, entities: acquiredEntities, functions: acquiredFunctions, modules: acquiredModules };
    // Keep both checked builds and the resulting session on one captured input
    // while a source-bearing reader awaits the worker's namespace projection.
    const { snapshot, entities, functions, modules } = acquiredModules.length ? structuredClone(acquired) : acquired;
    // The worker rebuilds the same registry. After its checked namespace
    // projection, the account catalog and page build continue together.
    let resolveNamespaces!: (names: ReadonlySet<string>) => void;
    let rejectNamespaces!: (error: unknown) => void;
    const namespaceProjection = modules.length === 0 ? undefined : new Promise<ReadonlySet<string>>((resolve, reject) => {
      resolveNamespaces = resolve; rejectNamespaces = reject;
    });
    const preparedCatalog = workers!.prepareCatalogInWorker(accountId, snapshot, entities, functions,
      { independent: true, lineage: realmOwner, sourceModules: modules, signal: preparation.signal,
        ...(namespaceProjection ? { onRepositoryNamespaces: resolveNamespaces } : {}) });
    void preparedCatalog.catch(error => { if (namespaceProjection) rejectNamespaces(error); });
    const repositoryNamespaces = namespaceProjection ? await namespaceProjection : undefined;
    assertActive();
    preparation.signal.throwIfAborted();
    const registry = await buildLocalAccountFieldRegistry(accountId, snapshot,
      (id, committed) => buildReaderFieldRegistry(id, committed, modules,
        repositoryNamespaces === undefined ? {} : { repositoryNamespaces }));
    candidateRegistry = registry;
    pendingRegistries.add(registry);
    assertActive();
    preparation.signal.throwIfAborted();
    options.onStage?.("Preparing editing tools…");
    const session = await authoring.prepareReaderAuthoringSession(registry, accountId, snapshot, entities, functions, modules, preparedCatalog);
    assertActive();
    preparation.signal.throwIfAborted();
    const catalog = workers!.preparedAuthoringDisplayCatalog(registry);
    if (!catalog) throw new Error("This reader's checked catalog is unavailable.");
    pendingRegistries.delete(registry);
    return { definitions: acquiredSnapshot, registry, session, functions, types, functionRows, modules,
      views, templates: templates.createReaderTemplateRegistry(views), catalog, metadata, ownPresentations };
    } catch (error) {
      preparation.abort(error);
      if (candidateRegistry) {
        workers!.discardPreparedAuthoringWorker(candidateRegistry);
        pendingRegistries.delete(candidateRegistry);
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abortPreparation);
      pendingPreparations.delete(preparation);
    }
  }

  async function load(): Promise<ReaderSnapshot> {
    assertActive();
    options.onStage?.("Loading data…");
    const [typesResponse, functionsResponse, viewsResponse, modulesResponse, snapshotResponse, codec, ids, metadata] = await Promise.all([
      remote.getTypes.uncached(), remote.getFunctions.uncached(), remote.getViews.uncached(),
      remote.apiRead<{ modules: SourceModuleDocument[] }>("/modules/installed"),
      remote.apiRead<{ snapshot: FieldPersistenceSnapshot }>("/definition-bundles"),
      import("./authoring-json"), repositoryFunctionIdsForAuthoring(), loadMetadata(),
    ]);
    assertActive();
    repositoryIds = ids;
    const definitions = codec.fieldDefinitionSnapshotFromJsonWire(snapshotResponse.snapshot);
    const prepared = await prepareAccountSnapshot(definitions, {
      types: typesResponse.types ?? [], functionRows: functionsResponse.functions ?? [], modules: modulesResponse.modules ?? [],
      views: (viewsResponse.views ?? []).map((row: { view: TypeView }) => row.view), ...metadata,
    });
    return prepared;
  }

  async function createDraftSource(): Promise<LocalTabSource> {
    assertActive();
    // Tools preparation owns the account identity and captured frame. Pausing
    // HTTP writes cannot turn the account into an anonymous tab reader.
    await ready;
    assertActive();
    const captured = committedSnapshot!;
    const [rootResponse, savedResponse, dispatchResponse, definitionResponse, sourceTools, engine, codec, instances, instanceCodec, foundation, fields, fieldCatalog, identities, presentationTools, authority] = await Promise.all([
      remote.getLocusRoot.uncached(), remote.getSavedQueries.uncached(), remote.getDispatchInstances.uncached(),
      remote.apiRead<{ snapshot: FieldPersistenceSnapshot }>("/definition-bundles"),
      import("./local-locus-data"), import("@fenel/engine"), import("./authoring-json"),
      import("./instances/instance-draft"), import("@fenel/engine/authoring/type"), import("@fenel/engine/type-foundation"), import("@fenel/engine/field-authoring"),
      import("@fenel/engine/repository-field-catalog"), import("@fenel/engine/repository-identity-manifest"),
      import("./reader-presentation"),
      import("@fenel/engine/authority"),
    ]);
    assertActive();
    const definitions = codec.fieldDefinitionSnapshotFromJsonWire(definitionResponse.snapshot);
    if (!fields.fieldPersistenceSnapshotMatches(definitions, captured.definitions)) {
      throw new Error("Definitions changed since this reader was opened. Reload before editing them.");
    }
    // Source ingress remains the existing typed wire boundary. The canonical
    // account loader derives ownership from this authorized captured client.
    const representations = (dispatchResponse.dispatchInstances ?? []).map((row: InstanceApiRow) => {
      if (!row.id) throw new Error("A stored representation has no identity.");
      const valueEncoding = row.valueEncoding;
      if (valueEncoding !== undefined && !instanceCodec.isInstanceJsonEncoding(valueEncoding)) {
        throw new Error("This stored representation has an unsupported value encoding.");
      }
      const instance = instanceCodec.instanceFromJsonWire(instances.apiRowToDraft(row), captured.registry,
        undefined, valueEncoding) as InstanceDraft;
      return { id: row.id, typeName: instance.typeName, args: instance.args, instance,
        ...(valueEncoding === undefined ? {} : { valueEncoding }) };
    });
    const call = <T,>(name: string, ...args: unknown[]) => engine.invokeCallable(foundation.Ref(`view:${name}`), args,
      captured.session.evaluateContext) as T;
    const seeded = call<LocalTabData>("browserDataFromRoot", rootResponse.root,
      savedResponse.queries ?? [], representations, definitions);
    const placeAll = captured.registry.getUuid("view:placeAll");
    const initial = placeAll ? call<LocalTabData>("browserDataWithExpressionHeads", seeded, { placeAll }) : seeded;
    const projectRoot = (state: LocalTabData, rootType: FenelType) => call<import("./locus-root-data").LocusRootData>("browserDataRoot", state, rootType);
    let firstPreparation = true;
    const source = sourceTools.createBrowserDataSource({ id: rootResponse.root.id, epoch,
      metadataSource: { $tag: "AccountSource", accountId },
      initial, rootType: rootResponse.root.type, signal: remote.signal,
      projectRoot,
      planDefinitions: (current, bundle) => Promise.resolve(fields.planFieldPersistence({
        currentOwners: current.owners, currentFields: current.fields, currentFacets: current.facets,
        ...bundle, repositoryFields: fieldCatalog.REPOSITORY_REUSABLE_DURABLE_FIELDS,
        identityKinds: identities.repositoryIdentityKinds(),
      }).snapshot),
      prepareSnapshot: async (nextDefinitions, rows, signal) => {
        assertActive(); signal.throwIfAborted();
        let prepared: ReaderSnapshot;
        // The initially admitted registry is shared with its account reader so
        // an encoding captured just before the first paused edit stays valid.
        if (firstPreparation) {
          firstPreparation = false;
          borrowedRegistries.add(captured.registry);
          prepared = captured;
        } else {
          firstPreparation = false;
          const priorTypeNames = new Set(definitions.owners.flatMap(owner => owner.kind === "type" ? [owner.storageName] : []));
          const priorFunctionIds = new Set(definitions.owners.flatMap(owner => owner.kind === "function" ? [owner.definition.id] : []));
          const types = captured.types.filter(row => !priorTypeNames.has(row.name));
          const functionRows = captured.functionRows.filter(row => !priorFunctionIds.has(row.function.id));
          for (const owner of nextDefinitions.owners) {
            if (owner.kind === "type") {
              const prior = captured.types.find(row => row.name === owner.storageName);
              const { params: _priorParams, typeScheme: _priorScheme, declaration: _priorDeclaration, ...priorRow } = prior ?? {};
              types.push({ ...priorRow, ...owner.definition, id: owner.storageId ?? prior?.id ?? owner.definition.id,
                name: owner.storageName, isSystem: false });
            } else {
              const prior = captured.functionRows.find(row => row.function.id === owner.definition.id);
              functionRows.push({ ...prior, id: owner.storageId ?? prior?.id ?? owner.definition.id,
                name: owner.storageName, function: owner.definition, isSystem: false });
            }
          }
          prepared = await prepareAccountSnapshot(nextDefinitions, { ...captured, types, functionRows }, signal);
        }
        try {
          signal.throwIfAborted(); assertActive();
          const frame = prepared.session.evaluateContext;
          const dispatch = engine.createDispatchRegistry();
          if (!frame._specRegistry) throw new Error("This account reader has no captured dispatch registry.");
          for (const cls of frame._specRegistry.listClasses()) dispatch.defineClass(cls);
          for (const row of frame._specRegistry.listInstances()) dispatch.addInstance(row);
          engine.refreshAccountInstances(dispatch, accountId, rows as readonly Instance[]);
          const evaluateContext = authoring.mergeBrowserEvaluateContext({ ...frame,
            _authority: captured.session.evaluateContext._authority, _specRegistry: dispatch }, {}, {});
          const metadata = new Map(captured.metadata);
          const ownPresentations = new Map(captured.ownPresentations);
          // Current browser account sessions retain the bootstrap frame. Its
          // account is null, so only the server's authorized metadata projection
          // can retain account presentation until a reader frame is provided.
          if (authority.frameAccount(evaluateContext) === accountId) {
            const targets = new Set(captured.metadata.keys());
            for (const row of rows) if (typeof row.args[0] === "string") targets.add(row.args[0]);
            for (const target of targets) {
              const methods = new Map(presentationTools.representationsFromReaderSnapshot(prepared.registry, evaluateContext, target)
                .map(row => [row.typeName, row.methods] as const));
              metadata.set(target, methods);
              const selected = engine.resolveEffect(evaluateContext, dispatch, "Iconable", target);
              const key: unknown = selected?.source.kind === "instance" ? selected.source.instance.args[0] : selected?.source.frame.args[0];
              ownPresentations.set(target, presentationTools.ownPresentationFromReaderSnapshot(evaluateContext, methods, key));
            }
          }
          // Keep the actual authority and all evaluation hooks. Only the private
          // pool changes; dispatch still uses the canonical scoped resolver.
          const session = authoring.readerDraftAuthoringSession(Object.freeze({ ...prepared.session, evaluateContext }),
            { accountId, functions: prepared.functions });
          const draftSnapshot = { ...prepared, session,
            types: prepared.types.map(row => ({ ...row, id: row.id ?? prepared.registry.getIdentifiedEntity(row.name)?.id ?? row.name })),
            functionRows: prepared.functionRows.map(row => ({ ...row, id: row.id ?? row.function.id })),
            metadata, ownPresentations,
          };
          // The account backend retains its captured in-process projection.
          // Local snapshots implement this same operation through their worker.
          const presentation = presentationTools.createReaderPresentation(() => draftSnapshot);
          return { ...draftSnapshot, kind: "account" as const,
            readPresentations: async (targets: readonly string[], requestSignal?: AbortSignal) => {
              requestSignal?.throwIfAborted(); assertActive();
              return targets.map(target => ({ target, presentation: presentation.presentation(target) }));
            },
            readMetadata: async (targets: readonly string[], requestSignal?: AbortSignal) => {
            requestSignal?.throwIfAborted(); assertActive();
            return { entries: targets.map(target => ({ target,
              representations: presentationTools.representationsFromReaderSnapshot(prepared.registry, evaluateContext, target),
              ownPresentation: presentation.presentation(target),
            })) };
          } };
        } catch (error) {
          borrowedRegistries.delete(prepared.registry);
          if (prepared.registry !== committedSnapshot?.registry) workers!.discardPreparedAuthoringWorker(prepared.registry);
          throw error;
        }
      },
      onPublish: () => draftChanged(),
      retireSnapshot: (snapshot) => {
        borrowedRegistries.delete(snapshot.registry);
        const retired = retiredCommittedRegistries.delete(snapshot.registry);
        if (snapshot.registry !== committedSnapshot?.registry || retired) {
          workers!.discardPreparedAuthoringWorker(snapshot.registry);
        }
      },
    });
    bindCoreAuthoringOwner(source, realmOwner, epoch, client.signal);
    try { await source.ready(); assertActive(); }
    catch (error) { source.dispose(); throw error; }
    draftSource = source;
    return source;
  }

  // Fetch the first visible data before authoring starts its heavier reads.
  // HomeEntry observes this same query, so the typed handoff does not throw
  // away an access check and issue another identical root request.
  const ready = (async () => { try {
    assertActive();
    remote.revalidate("locusRoot");
    const firstRoot = remote.getLocusRoot();
    // Let the response-backed lightweight surface paint before imports can
    // occupy the browser thread. This does not install a provisional registry.
    await firstRoot;
    assertActive();
    firstRootReady = true;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    assertActive();
    options.onStage?.("Loading editing tools…");
    await options.prepareAfter?.();
    assertActive();
    const modules = await Promise.all([
      import("./expression-runner/authoring-session"), import("./expression-runner/authoring-catalog-worker"),
      import("./web-template-registry"), import("./reader-presentation"),
      import("@fenel/engine/authority"),
    ]);
    [authoring, workers, templates] = modules;
    assertActive();
    const initial = await load();
    committedSnapshot = initial;
    const [state, setState] = createSignal(initial);
    const [revision, setRevision] = createSignal(0);
    const [loading, setLoading] = createSignal(false);
    let refreshing: Promise<void> | undefined;
    let refreshGeneration = 0;
    let releaseSession = () => {};
    draftChanged = () => { if (active) setRevision(value => value + 1); };
    const read = () => {
      assertActive();
      const committed = state();
      const draft = client.drafts.snapshot();
      return draft ? { ...committed, ...draft } as ReaderSnapshot : committed;
    };
    canStageRepresentations = () => modules[4].frameAccount(
      client.drafts.source()?.snapshot().session.evaluateContext ?? read().session.evaluateContext) === accountId;
    let metadataRefreshing: Promise<void> | undefined;
    refreshMetadata = () => {
      assertActive();
      metadataGeneration++;
      if (metadataRefreshing) return metadataRefreshing;
      metadataRefreshing = (async () => {
        try {
          let requested: number;
          do {
            requested = metadataGeneration;
            const metadata = await loadMetadata(untrack(state).metadata.keys());
            assertActive();
            if (requested === metadataGeneration) {
              setState((current) => ({ ...current, ...metadata }));
              committedSnapshot = { ...committedSnapshot!, ...metadata };
              setRevision((value) => value + 1);
            }
          } while (requested !== metadataGeneration);
        } finally { metadataRefreshing = undefined; }
      })();
      return metadataRefreshing;
    };
    const presentation = modules[3].createReaderPresentation(read);
    runtime = {
      kind: "account", accountId, epoch, client,
      registry: () => read().registry, session: () => read().session,
      captureSourceMetadata: () => {
        assertActive();
        const source = client.drafts.source();
        const capture = source?.captureSourceMetadata();
        if (!capture || capture.session !== read().session) return undefined;
        return { ...capture, current: () => active && epoch === untrack(sessionEpoch)
          && !options.signal?.aborted && !client.signal?.aborted && client.drafts.source() === source
          && capture.current() && read().session === capture.session };
      },
      functions: () => read().functions, types: () => read().types,
      functionRows: () => read().functionRows, modules: () => read().modules,
      views: () => read().views, templates: () => read().templates, catalog: () => read().catalog, revision, loading,
      ...presentation,
      catalogLookups: {
        fn: (id) => read().session.evaluateContext.getFunction?.(id),
        typeFamilyOwner: (id) => read().session.evaluateContext._typeFamilyOwner?.(id),
        entry: presentation.catalogEntry,
        entityType: (id) => read().registry.getIdentifiedEntity(id)?.type,
      },
      reload: () => {
        assertActive();
        refreshGeneration++;
        if (refreshing) return refreshing;
        setLoading(true);
        refreshing = (async () => {
          let candidate: ReaderSnapshot | undefined;
          try {
            let requested: number;
            do {
              requested = refreshGeneration;
              const generation = metadataGeneration;
              candidate = await load();
              assertActive();
              if (generation !== metadataGeneration) Object.assign(candidate, await loadMetadata(untrack(state).metadata.keys()));
              assertActive();
              // A later committed definition arrived while this snapshot was
              // preparing. All waiting saves need its post-commit read before
              // they can acknowledge one completed reader refresh.
              if (requested !== refreshGeneration) {
                workers!.discardPreparedAuthoringWorker(candidate.registry);
                candidate = undefined;
                continue;
              }
              const prior = untrack(state);
              committedSnapshot = candidate;
              setState(candidate);
              candidate = undefined;
              setRevision((value) => value + 1);
              if (borrowedRegistries.has(prior.registry)) retiredCommittedRegistries.add(prior.registry);
              else workers!.discardPreparedAuthoringWorker(prior.registry);
              remote.revalidate(["types", "functions", "views", "dispatchInstances"]);
            } while (requested !== refreshGeneration);
          } catch (error) {
            if (candidate) workers!.discardPreparedAuthoringWorker(candidate.registry);
            throw error;
          } finally { refreshing = undefined; setLoading(false); }
        })();
        return refreshing;
      },
      prepareFunction: (id, draft, signal) => authoring.prepareReaderAuthoringSessionForFunction(id, read().session,
        { accountId, functions: read().functions, ...(draft ? { draft } : {}) }, signal),
      draftSession: (draft) => authoring.readerDraftAuthoringSession(read().session, { accountId, functions: read().functions, draft }),
      dispose: () => {
        active = false;
        for (const preparation of pendingPreparations) preparation.abort(new Error("This reader was closed."));
        releaseSession();
        options.signal?.removeEventListener("abort", abort);
        client.dispose();
        draftSource?.dispose();
        workers!.discardPreparedAuthoringWorker(untrack(state).registry);
        for (const registry of retiredCommittedRegistries) workers!.discardPreparedAuthoringWorker(registry);
        retiredCommittedRegistries.clear();
        for (const registry of pendingRegistries) workers!.discardPreparedAuthoringWorker(registry);
        pendingRegistries.clear();
      },
    };
    releaseSession = onBrowserSessionChange(runtime.dispose);
    return runtime;
  } catch (error) {
    active = false;
    for (const registry of pendingRegistries) workers?.discardPreparedAuthoringWorker(registry);
    pendingRegistries.clear();
    // HomeEntry already owns this client's authorized root response. Failing
    // to prepare authoring must not close its still-visible data reader. Keep
    // the owner abort listener so retry, logout and teardown still retire it.
    if (!firstRootReady || options.signal?.aborted || epoch !== untrack(sessionEpoch)) {
      options.signal?.removeEventListener("abort", abort);
      client.dispose();
    }
    throw error;
  } })();
  return { client, ready };
}

export async function createAccountReaderRuntime(accountId: string,
  options: AccountReaderPreparation = {},
): Promise<ReaderRuntime> {
  const preparation = startAccountReaderRuntime(accountId, options);
  try { return await preparation.ready; }
  catch (error) {
    // This convenience caller never received the progressive HTTP client.
    preparation.client.dispose();
    throw error;
  }
}

/** The public read session is checked independently of picker/editor
 * presentation. Its catalogue is projected only when a consumer asks for it;
 * read cards keep the same session that the later editor will consume. */
export async function createPublicReaderRuntime(options: AccountReaderPreparation = {}): Promise<ReaderRuntime> {
  const epoch = options.epoch ?? untrack(sessionEpoch);
  let active = true;
  let client: ApiClient | undefined;
  let releaseSession = () => {};
  const assertActive = () => {
    assertCurrentSession(epoch); options.signal?.throwIfAborted();
    if (!active) throw new Error("This public reader was closed.");
    client?.signal?.throwIfAborted();
  };
  const dispose = () => {
    if (!active) return;
    active = false;
    releaseSession();
    options.signal?.removeEventListener("abort", dispose);
    client?.dispose();
  };
  options.signal?.addEventListener("abort", dispose, { once: true });
  releaseSession = onBrowserSessionChange(dispose);
  try {
    // Stage callbacks can write Solid signals; leave their owned setup first.
    await Promise.resolve();
    assertActive();
    await options.prepareAfter?.();
    assertActive();
    options.onStage?.("Loading data tools…");
    const [{ preparePublicLocusData, publicSourceMetadataForSession }, { sessionCatalogSections }, { createReaderTemplateRegistry }, { createReaderPresentation }, workers] = await Promise.all([
      import("./public-locus-data"), import("./expression-runner/authoring-catalog"),
      import("./web-template-registry"), import("./reader-presentation"), import("./expression-runner/authoring-catalog-worker"),
    ]);
    assertActive();
    options.onStage?.("Preparing data…");
    const publicData = await preparePublicLocusData();
    assertActive();
    const [{ assertPublicBootstrapMatches }, { REPOSITORY_IDENTITY_MANIFEST }] = await Promise.all([
      import("./public-bootstrap"), import("@fenel/engine/repository-identity-manifest"),
    ]);
    await assertPublicBootstrapMatches(publicData.root, REPOSITORY_IDENTITY_MANIFEST.digest);
    assertActive();
    let catalog: readonly CatalogSection[] | undefined;
    // The exact public registry already owns the worker's checked display
    // catalogue. Keep entity scoping without rebuilding it on a caption read.
    const readCatalog = () => { assertActive(); return catalog ??= sessionCatalogSections(publicData.registry,
      workers.preparedAuthoringDisplayCatalog(publicData.registry)); };
    client = createPublicApiClient();
    const templates = createReaderTemplateRegistry([]);
    const read = () => { assertActive(); return publicData; };
    const presentation = createReaderPresentation(() => ({ registry: read().registry, session: read().session, catalog: readCatalog() }));
    let sourceMetadata: ReaderSourceMetadataCapture | undefined;
    const captureSourceMetadata = () => {
      assertActive();
      if (sourceMetadata) return sourceMetadata;
      const captured = read();
      const root = captured.root;
      const session = captured.session;
      const current = () => {
        try { assertActive(); return read() === captured && captured.root === root && read().session === session; }
        catch { return false; }
      };
      return sourceMetadata = publicSourceMetadataForSession(captured, `${REPOSITORY_IDENTITY_MANIFEST.digest}:${root.revision}`,
        catalogCallableLabels(session.catalog), current);
    };
    return {
      kind: "public", epoch, client, publicData,
      registry: () => read().registry, session: () => read().session,
      captureSourceMetadata,
      functions: () => [], types: () => [], functionRows: () => [], modules: () => [], views: () => [], templates: () => templates,
      catalog: readCatalog, revision: () => 0, loading: () => false,
      ...presentation, catalogLookups: {
        fn: id => read().catalogLookups.fn(id),
        typeFamilyOwner: id => read().catalogLookups.typeFamilyOwner?.(id),
        entityType: id => read().catalogLookups.entityType(id),
        entry: presentation.catalogEntry,
      },
      reload: async () => { assertActive(); }, prepareFunction: async () => read().session,
      draftSession: () => read().session, dispose,
    };
  } catch (error) { dispose(); throw error; }
}

/** A local reader owns projections/lifecycle; all its lenses share the tab's
 * admitted source. Closing a reader cannot delete that source's ordinary data. */
export function startLocalReaderRuntime(options: AccountReaderPreparation & {
  reader?: { source: LocalTabSource; client: ApiClient };
} = {}): {
  client: ApiClient; ready: Promise<ReaderRuntime>;
} {
  // Source transport has no network fallback and no account credentials.
  const epoch = options.epoch ?? untrack(sessionEpoch);
  assertCurrentSession(epoch);
  const source = options.reader?.source ?? localTabDataSource();
  const client = options.reader?.client ?? createLocalApiClient(source);
  let active = true;
  let releaseSession = () => {};
  const assertActive = () => {
    assertCurrentSession(epoch); options.signal?.throwIfAborted();
    if (!active) throw new Error("This local reader was closed.");
    client.signal?.throwIfAborted();
  };
  const dispose = () => {
    active = false;
    releaseSession();
    options.signal?.removeEventListener("abort", dispose);
    client.dispose();
  };
  options.signal?.addEventListener("abort", dispose, { once: true });
  releaseSession = onBrowserSessionChange(dispose);
  const ready = (async () => {
    try {
      // Solid 2 may create a reader inside an owned root. Progress callbacks
      // write signals, so start them after that synchronous setup has ended.
      await Promise.resolve();
      assertActive();
      options.onStage?.("Opening local data…");
      await options.prepareAfter?.();
      await source.ready();
      assertActive();
      const [{ createReaderTemplateRegistry }, { createLocalReaderPresentation }, authoring, workers, { LUCIDE_BY_NAME }] = await Promise.all([
        import("./web-template-registry"), import("./local-reader-presentation"), import("./expression-runner/authoring-session"),
        import("./expression-runner/authoring-catalog-worker"), import("./icons"),
      ]);
      assertActive();
      const templates = createReaderTemplateRegistry([]);
      const read = () => { assertActive(); return source.snapshot(); };
      const readerWorker = () => {
        const snapshot = read();
        if (snapshot.kind !== "local") throw new Error("This local reader has no worker-owned snapshot.");
        return snapshot.worker;
      };
      // B3: the snapshot's worker owns every presentation (labels, icons, code
      // names, catalogue references), resolved in its own frame. The page
      // holds a cache of its answers; a pending answer is never a guessed name.
      const presentation = createLocalReaderPresentation({ worker: readerWorker, catalog: () => read().catalog,
        run: workers.runPreparedReaderWorker, knownIcons: () => Object.keys(LUCIDE_BY_NAME),
        views: () => {
          const componentNames = templates.listComponentNames?.();
          return componentNames ? { views: templates.list(), componentNames } : undefined;
        } });
      // Prefill before publication: the tab's own definitions and the targets
      // its data names, so the first paint of its own cards does not pend.
      const prefilled = read();
      await presentation.prefill([...prefilled.types.map(row => row.id), ...prefilled.functionRows.map(row => row.id),
        ...source.metadataTargets()]);
      assertActive();
      return {
        kind: "local", epoch, client,
        registry: () => read().registry, session: () => read().session,
        captureSourceMetadata: () => {
          assertActive();
          const capture = source.captureSourceMetadata();
          return capture && { ...capture, current: () => active && epoch === untrack(sessionEpoch)
            && !options.signal?.aborted && !client.signal?.aborted && capture.current() };
        },
        functions: () => read().functions, types: () => read().types,
        functionRows: () => read().functionRows, modules: () => [], views: () => [], templates: () => templates,
        catalog: () => read().catalog, revision: () => { assertActive(); return source.revision(); }, loading: () => false,
        catalogEntry: presentation.catalogEntry, presentation: presentation.presentation,
        ownIcon: presentation.ownIcon, representation: presentation.representation,
        catalogLookups: presentation.catalogLookups, readerWorker,
        presentationPending: presentation.presentationPending, referencePending: presentation.referencePending,
        observePending: presentation.observePending, typePresentation: presentation.typePresentation,
        typePresentationPending: presentation.typePresentationPending, valueState: presentation.valueState,
        // The cache's roster is this reader's own template registry.
        readValue: (worker, input, registry, signal) => registry === templates ? presentation.readValue(worker, input, signal) : undefined,
        referenceHandle: (id: string) => {
          const state = presentation.referenceState(id);
          return state.kind === "known" ? state.value?.handle ?? state.value?.identifiedHandle : undefined;
        },
        resolveTypeName: (name: string) => {
          const snapshot = read();
          const row = snapshot.types.find(entry => entry.id === name || entry.name === name);
          if (row?.type) return row.type;
          const entry = snapshot.catalog.flatMap(section => section.entries)
            .find(candidate => candidate.id === `entity:${name}` || candidate.entity?.id === name);
          return entry?.entity?.type;
        },
        retryPresentation: () => source.retryTools().then(() => {
          if (!active || epoch !== untrack(sessionEpoch) || options.signal?.aborted || client.signal?.aborted) return false;
          if (workers.preparedReaderWorkerClosed(readerWorker())) return false;
          presentation.retry();
          return true;
        }).catch(() => {
          // Failure stays visible and retryable; native click callers need no
          // rejection handler and must not refetch a closed/stale worker.
          return false;
        }),
        reload: async () => { assertActive(); await source.ready(); },
        prepareFunction: (id: string, draft?: FenelFunction, signal?: AbortSignal) =>
          authoring.prepareLocalReaderAuthoringSessionForFunction(id, read().session, source.id, read().functions, draft, signal),
        draftSession: (draft: FenelFunction) =>
          authoring.localReaderDraftAuthoringSession(read().session, source.id, read().functions, draft),
        dispose,
      } satisfies ReaderRuntime;
    } catch (error) {
      // A progressive reader already owns this client's checked root. A tools
      // failure must leave that data readable until its owner retries/closes.
      if (!options.reader || options.signal?.aborted || epoch !== untrack(sessionEpoch)) dispose();
      throw error;
    }
  })();
  return { client, ready };
}

export async function createLocalReaderRuntime(options: AccountReaderPreparation = {}): Promise<ReaderRuntime> {
  return startLocalReaderRuntime(options).ready;
}
