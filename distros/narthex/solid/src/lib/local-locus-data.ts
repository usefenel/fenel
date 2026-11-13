// Tab-owned browser state/transport. Fenel owns its transitions and projections;
// this A2/B3/Solid boundary holds admitted state and retires reader lifetimes.
import { spawnEarlyAuthoringRealm, retryEarlyAuthoringRealm, discardEarlyAuthoringRealm, bindCoreAuthoringOwner, inheritCoreAuthoringOwner, type EarlyAuthoringRealm } from "./expression-runner/authoring-catalog-early-realm";
import { prepareAuthoringLocalOperation, type PreparedLocalOrdinaryResult } from "./expression-runner/authoring-worker-local-ordinary";
import { createAuthoringWorkerBrowserStorage } from "./expression-runner/authoring-worker-browser-storage";
import { runLocalOrdinaryOperation, type LocalOrdinaryOperation, type LocalOrdinaryResult, type LocalOrdinaryPublication } from "./local-ordinary-operations";
import { captureRegistryTransportKey, captureRegistryTransportObservation } from "../../../../../implementations/typescript/engine/src/registry-transport";
import { createSignal, untrack } from "solid-js";
import type { CatalogSection, FenelFunction } from "@fenel/engine";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FenelType } from "@fenel/engine/types";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import type { InstanceJsonEncoding } from "@fenel/engine/authoring/type";
import type { ApiClient, ReaderInstanceEncoding, ReaderMetadataProjection, RepresentationEncoding, RootPublicationOptions } from "./api";
import type { InstanceDraft } from "./instances/instance-draft";
import type { LayoutItem } from "./locus-view-model";
import type { LocusRootCommand, LocusRootData } from "./locus-root-data";
import { assertCurrentSession, onBrowserSessionChange, sessionEpoch } from "./browser-session";
import { planLocalDefinitionBundle, queryLocalFieldAuthoringCatalog,
  queryLocalFieldAuthoringIdentity, queryLocalFieldResurrectionCatalog } from "./reader-registry";
import type { FieldResurrectionOwnerTarget } from "./api";
import type { ReaderTypeRow, ReaderFunctionRow } from "./reader-runtime";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import type { AuthoringReaderPresentations, AuthoringReaderFieldQuery, AuthoringReaderFieldResults,
  AuthoringReaderReferences } from "./expression-runner/authoring-worker-protocol";
import type { AuthoringReaderInstances, ReaderInstanceWireItem, ReaderInstanceWireQuery } from "./expression-runner/authoring-worker-reader-extensions";
import type { TransferSnapshot } from "./data-transfer/types";
import type { PreparedReaderWorker, PreparedSnapshotOwner } from "./expression-runner/authoring-catalog-worker";
import { beginBrowserDataStorageCommit, LOCAL_BROWSER_SOURCE_ID, type BrowserDataRecord,
  type BrowserDataStorage } from "./browser-data-storage";
import { locusSynchronizationForSession, type LocusSynchronization } from "./locus-synchronization";
import type { WorkspaceSource } from "./workspace-source-wire";
import type { ReaderSourceMetadataCapture } from "./reader-source-metadata";
import type { AuthoringCatalogSnapshot } from "@fenel/engine/authoring/environment";

/** Dependency-graph labels for every exact identity a source can hold for a
 * catalogue callable: a call's code name, and the UUID a `{$ref}` value names
 * (the catalogue's resolved identity routes). Presentation data only; a
 * reference with no row here is drawn under its identity. */
export function catalogCallableLabels(catalog: Pick<AuthoringCatalogSnapshot, "functions" | "exactFunctionRoutes">):
  readonly { id: string; label: string }[] {
  const rows = catalog.functions.map(entry => ({ id: entry.targetId ?? entry.id, label: entry.label }));
  const seen = new Set(rows.map(row => row.id));
  for (const route of catalog.exactFunctionRoutes ?? []) {
    if (route.status !== "resolved" || route.entry === undefined || route.sourceName !== route.targetId || seen.has(route.targetId)) continue;
    rows.push({ id: route.targetId, label: route.entry.label });
    seen.add(route.targetId);
  }
  return rows;
}

/** What the shared browser holder reads from any reader snapshot. */
type ReaderSnapshotFields = {
  registry: ModuleRegistry;
  session: AuthoringSession;
  functions: readonly FenelFunction[];
  types: readonly (ReaderTypeRow & { id: string })[];
  functionRows: readonly (ReaderFunctionRow & { id: string })[];
  catalog: readonly CatalogSection[];
  readPresentations(targets: readonly string[], signal?: AbortSignal): Promise<AuthoringReaderPresentations["presentations"]>;
  readMetadata(targets: readonly string[], signal?: AbortSignal): Promise<ReaderMetadataProjection>;
};
/** An anonymous Local snapshot. `owner` routes its sessions to a worker (kept
 * across a worker restoration); `worker` is the worker this snapshot owns.
 * B4 wave 5: `registry` is a token (`createLocalRegistryToken`, an identity
 * whose member reads refuse) and `session` is frameless (its
 * `evaluateContext` refuses): every registry read runs in `worker`. */
export type LocalReaderSnapshot = ReaderSnapshotFields & {
  kind: "local"; owner: PreparedSnapshotOwner; worker: PreparedReaderWorker;
  /** B4 unit E: the worker-published catalogue's callable labels (its own
   * function rows, as data), for this source's publication roster. */
  callableLabels: readonly { id: string; label: string }[];
  /** B4 unit E: this snapshot's worker answers the Local API client's name
   * lookups (`project-reader-references` with `definitions`). */
  readReferences(targets: readonly string[], signal?: AbortSignal): Promise<AuthoringReaderReferences["references"]>;
  /** B4 unit E: this snapshot's worker decodes or encodes instance wire data. */
  convertInstances(method: ReaderInstanceWireQuery["method"], instances: readonly ReaderInstanceWireItem[],
    signal?: AbortSignal): Promise<AuthoringReaderInstances["instances"]>;
};
/** An account draft source's snapshot; its page registry owns its worker. */
export type AccountDraftReaderSnapshot = ReaderSnapshotFields & { kind?: "account" };
export type BrowserReaderSnapshot = LocalReaderSnapshot | AccountDraftReaderSnapshot;

// A failed preparation's abandoned catalogue request can finish after the
// refusal is reported. Keep its retirement barrier so Retry cannot overlap it.
const localPreparationRetirements = new Map<string, Promise<void>>();

/** Wait for required page tools without giving this source ownership of the
 * shared harness. Cancellation releases the source immediately; the shared
 * warm-up may still finish for another source or a later Retry. */
function waitForLocalPageHarness(work: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    void work.then(() => {
      signal.removeEventListener("abort", aborted);
      if (signal.aborted) aborted(); else resolve();
    }, error => {
      signal.removeEventListener("abort", aborted);
      reject(error);
    });
    if (signal.aborted) aborted();
  });
}

export async function prepareLocalReaderSnapshot(sourceId: string, snapshot: FieldPersistenceSnapshot,
  options: { signal?: AbortSignal; representations?: readonly InstanceDraft[]; localValueIds?: readonly string[];
    /** This source's published snapshot for exactly `snapshot`, whose worker
     * was retired: only a fresh catalogue worker and session are prepared,
     * on the same registry and owner. */
    restore?: Pick<LocalReaderSnapshot, "registry" | "owner">;
    /** W1: the holder whose released catalogue realm this preparation may reuse. */
    lineage?: object } = {}): Promise<LocalReaderSnapshot> {
  options.signal?.throwIfAborted();
  const previous = localPreparationRetirements.get(sourceId);
  let retire!: () => void;
  const retirement = new Promise<void>(resolve => { retire = resolve; });
  localPreparationRetirements.set(sourceId, retirement);
  const jobs: Promise<unknown>[] = [];
  const preparation = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, preparation.signal]) : preparation.signal;
  const preparationOptions = { signal, representations: options.representations, localValueIds: options.localValueIds && [...options.localValueIds] };
  const catalogueOptions = options.lineage ? { ...preparationOptions, lineage: options.lineage } : preparationOptions;
  let workers: typeof import("./expression-runner/authoring-catalog-worker") | undefined;
  let catalog: Awaited<ReturnType<NonNullable<typeof workers>["prepareLocalCatalogInWorker"]>> | undefined;
  try {
    if (previous) await previous;
    signal.throwIfAborted();
    const [authoring, workerTools] = await Promise.all([
      import("./expression-runner/authoring-session"), import("./expression-runner/authoring-catalog-worker"),
    ]);
    workers = workerTools;
    const owner = options.restore?.owner ?? workerTools.createPreparedSnapshotOwner();
    const types = snapshot.owners.flatMap(owner => owner.kind === "type"
      ? [{ ...owner.definition, id: owner.definition.id, name: owner.storageName, isSystem: false }] : []);
    const functionRows = snapshot.owners.flatMap(owner => owner.kind === "function"
      ? [{ id: owner.definition.id, name: owner.storageName, function: owner.definition, isSystem: false }] : []);
    const functions = functionRows.map(row => row.function);
    signal.throwIfAborted();
    // B4 wave 5: the worker's checked catalogue is this snapshot's only
    // preparation. No page registry is built: the snapshot's registry is a
    // token (an identity only) and its page session has no frame. The page
    // still runs a few engine bodies (codec, labels, printing); their harness
    // is warmed asynchronously beside the catalogue (scheduling only), so a
    // first use need not build it synchronously. Publication requires success,
    // but the shared warm-up stays outside this source's retirement barrier.
    const pageHarness = waitForLocalPageHarness(workerTools.prepareLocalPageHarness(), signal);
    // A synchronous catalogue refusal can bypass Promise.all below. Observe
    // the shared wait immediately; its actual refusal still reaches the await.
    void pageHarness.catch(() => {});
    const cataloguePreparation = workerTools.prepareLocalCatalogInWorker(sourceId, snapshot,
        types.map(row => ({ id: row.id, type: row.type })), functions, catalogueOptions).then(prepared => {
        if (signal.aborted) {
          workerTools.discardPreparedAuthoringCatalog(prepared);
          signal.throwIfAborted();
        }
        catalog = prepared;
        return prepared;
      });
    jobs.push(cataloguePreparation);
    // Synchronous page consumers must never enter the harness construction
    // window. Either owner's refusal rejects this attempt; elapsed time is
    // not readiness. Only the catalogue remains in the retirement barrier.
    await Promise.all([...jobs, pageHarness]);
    signal.throwIfAborted();
    if (!catalog) throw new Error("This tab's checked preparation is unavailable.");
    // A restoration keeps its snapshot's token: its sessions stay one identity.
    const registry = options.restore?.registry ?? workerTools.createLocalRegistryToken();
    const session = authoring.createLocalReaderAuthoringSession(registry, owner, sourceId, functions, catalog);
    signal.throwIfAborted();
    const display = workers.preparedAuthoringDisplayCatalog(owner);
    if (!display) throw new Error("This tab's checked catalogue is unavailable.");
    const handle = workers.prepareReaderWorkerHandle(catalog);
    const readPresentations = async (targets: readonly string[], requestSignal?: AbortSignal): Promise<AuthoringReaderPresentations["presentations"]> => {
      const result = await workerTools.runPreparedReaderWorker(handle, { method: "project-reader-presentations", targets }, requestSignal);
      if (!("presentations" in result)) throw new Error("This reader's presentation could not be read.");
      return result.presentations;
    };
    const readMetadata = async (targets: readonly string[], requestSignal?: AbortSignal): Promise<ReaderMetadataProjection> => {
      const result = await workerTools.runPreparedReaderWorker(handle, { method: "project-reader-metadata", targets }, requestSignal);
      if (Array.isArray(result) || !("entries" in result)) throw new Error("This reader's metadata could not be read.");
      return result;
    };
    // B4 unit E: the Local API client's lookups and instance wire run here,
    // in this snapshot's worker; the caller asserts its snapshot afterwards.
    const readReferences = async (targets: readonly string[], requestSignal?: AbortSignal) => {
      const result = await workerTools.runPreparedReaderWorker(handle,
        { method: "project-reader-references", targets, definitions: true }, requestSignal);
      const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
      const readable = (definition: unknown) => definition === undefined || record(definition)
        && (definition.entity === undefined || record(definition.entity) && typeof definition.entity.id === "string")
        && (definition.fn === undefined || record(definition.fn) && typeof definition.fn.id === "string");
      if (Array.isArray(result) || !("references" in result) || !Array.isArray(result.references)
        || result.references.length !== targets.length || result.references.some((entry, index) => !record(entry)
          || entry.target !== targets[index] || entry.reference !== undefined && (!record(entry.reference) || !readable(entry.reference.definition))))
        throw new Error("This reader's definitions could not be read.");
      return result.references;
    };
    const convertInstances = async (method: ReaderInstanceWireQuery["method"], instances: readonly ReaderInstanceWireItem[],
      requestSignal?: AbortSignal) => {
      const result = await workerTools.runPreparedReaderWorker(handle, { method, instances }, requestSignal);
      if (Array.isArray(result) || !("instances" in result) || !Array.isArray(result.instances) || result.instances.length !== instances.length
        || result.instances.some(instance => !instance || typeof instance !== "object" || Array.isArray(instance)))
        throw new Error("This reader's representation data could not be read.");
      return result.instances as AuthoringReaderInstances["instances"];
    };
    const callableLabels = catalogCallableLabels(catalog);
    const captured = { kind: "local" as const, owner, worker: handle,
      registry, session, functions, types, functionRows, catalog: display, readPresentations, readMetadata,
      callableLabels, readReferences, convertInstances };
    const projected = types.length || functionRows.length
      ? await readPresentations([...types.map(row => row.id), ...functionRows.map(row => row.id)], signal) : [];
    const presentations = new Map(projected.map(entry => [entry.target, entry.presentation]));
    signal.throwIfAborted();
    return { ...captured,
      types: types.map(row => ({ ...row, ...presentations.get(row.id) })),
      functionRows: functionRows.map(row => ({ ...row, ...presentations.get(row.id) })),
    };
  } catch (error) {
    preparation.abort(error);
    // The catalogue's client is the only worker this preparation attached.
    if (catalog) workers?.discardPreparedAuthoringCatalog(catalog);
    throw error;
  } finally {
    // Report refusal immediately, but let the abandoned acquisition finish
    // before another attempt for this source starts. No checked values escape.
    void Promise.allSettled([...(previous ? [previous] : []), ...jobs]).then(() => {
      retire();
      if (localPreparationRetirements.get(sourceId) === retirement) localPreparationRetirements.delete(sourceId);
    });
  }
}

export type LocalSavedValueRow = {
  id: string; slug: string; name?: string; description?: string;
  query: Record<string, unknown>;
};

/** A2/B3: project IDs from the captured admitted candidate without reading
 * payloads or inherited/accessor identities. Malformed data supplies the
 * empty-string sentinel so the Fenel catalogue admission refuses reuse. */
function localSavedValueIds(candidate: Pick<LocalTabData, "values"> | undefined): string[] {
  if (!candidate) return [];
  try {
    const values = Object.getOwnPropertyDescriptor(candidate, "values");
    if (!values || !Object.hasOwn(values, "value") || !Array.isArray(values.value)) return [""];
    const ids: string[] = [];
    for (let index = 0; index < values.value.length; index++) {
      const entry = Object.getOwnPropertyDescriptor(values.value, String(index));
      if (!entry || !Object.hasOwn(entry, "value") || !entry.value || typeof entry.value !== "object") return [""];
      const id = Object.getOwnPropertyDescriptor(entry.value, "id");
      if (!id || !Object.hasOwn(id, "value")) return [""];
      Object.defineProperty(ids, String(index), { value: id.value, enumerable: true, writable: true, configurable: true });
    }
    return ids;
  } catch { return [""]; }
}
export type LocalRepresentationRow = {
  id: string; typeName: string; args: unknown[]; instance: InstanceDraft;
  valueEncoding?: InstanceJsonEncoding;
};
export type LocalTabData = {
  tabId: string; revision: number;
  entries: Array<{ id: string; value: LayoutItem }>;
  values: Array<{ id: string; value: LocalSavedValueRow }>;
  representations: Array<{ id: string; value: LocalRepresentationRow }>;
  layout: LocusRootData["layout"];
  definitions: FieldPersistenceSnapshot;
  /** Authorized source projection retained beside its ordinary editable data. */
  rootProjection?: LocusRootData;
  expressionValueIds?: string[];
  expressionHeads?: { placeAll: string };
};
export type TabCommand = { $tag: string; [key: string]: unknown };
export type ClipboardCopy = { id: string; value: unknown; typeName: string; transfer: string; bytes: number; copiedAt: number; source: string };
export type LocalIngestResult = { root: LocusRootData; items: LayoutItem[]; notes: string[] };
export type DefinitionBundle = Parameters<typeof planLocalDefinitionBundle>[2];
type RepresentationWrites = Parameters<NonNullable<ApiClient["writeDispatchInstances"]>>[0];

export type LocalTabSource = {
  readonly id: string;
  readonly epoch: number;
  /** Read-only first render: like readReady, but an empty first visit may
   * settle earlier with the build-owned provisional packet (root and saved
   * values only). It admits no edit; the worker's publication replaces it. */
  firstPaint(): Promise<void>;
  readReady(): Promise<void>;
  ready(): Promise<void>;
  /** B4 unit E: like ready(), after any in-flight reader rebuild has settled
   * (published, or failed and restored). Its own preparation deadlines bound it. */
  toolsSettled(): Promise<void>;
  /** Explicit Retry may restore only a known closed Local realm. */
  retryTools(): Promise<void>;
  snapshot(): BrowserReaderSnapshot;
  /** Current source metadata is available only under this holder's admitted
   * owner coordinate; callers cannot select a source with a locator. */
  captureSourceMetadata(): ReaderSourceMetadataCapture | undefined;
  state(): LocalTabData;
  root(): LocusRootData;
  savedValues(): LocalSavedValueRow[];
  metadataTargets(): string[];
  metadata(targets?: readonly string[]): Promise<ReaderMetadataProjection>;
  revision(): number;
  /** Any `view` function under the full reader's frame. A progressive
   * (Local) source refuses: its view functions run in its worker (B4 unit D). */
  project<T>(name: string, ...args: unknown[]): T;
  /** Closed ordinary-data invocation; does not admit storage or start a reader. */
  ordinary<O extends LocalOrdinaryOperation>(operation: O, signal?: AbortSignal): Promise<LocalOrdinaryResult<O>>;
  transact(commands: readonly TabCommand[], expectedRevision?: number, signal?: AbortSignal,
    publication?: RootPublicationOptions, assertMutationCurrent?: () => void): Promise<LocusRootData>;
  saveDefinitions(bundle: DefinitionBundle, signal?: AbortSignal,
    mutation?: { expectedRevision: number; commands: readonly TabCommand[] },
    assertMutationCurrent?: () => void): Promise<{ snapshot: FieldPersistenceSnapshot; root: LocusRootData }>;
  replace(next: LocalTabData, expectedRevision?: number, signal?: AbortSignal): Promise<LocusRootData>;
  retainClipboard(copy: ClipboardCopy): Promise<void>;
  ingestExternal(snapshot: TransferSnapshot, options?: {
    signal?: AbortSignal;
    /** Acknowledge the retained host event in the same task as publication. */
    onPublished?: (result: LocalIngestResult) => void;
  }): Promise<LocalIngestResult | undefined>;
  dispose(): void;
};

/** B4 unit D: a Local source's page session is not a `view` evaluator. */
export const LOCAL_PROJECTION_IN_WORKER = "This source's view functions run in its editing worker.";

export type BrowserDataSourceOptions = {
  id: string;
  metadataSource?: WorkspaceSource;
  clipboard?: boolean;
  /** Local's inert root can use the checked pure lens model before editing
   * tools. Account draft sources retain their exact reader preparation. */
  progressiveRead?: boolean;
  /** L4 first paint: the build-owned publication of an empty tab, offered
   * only when this browser certainly stored nothing. Display-only: it never
   * becomes state, baseline, keeper data or a storage record. */
  provisional?: () => Promise<LocalOrdinaryPublication | undefined>;
  /** C2 host injection. Production Local uses its existing physical owner. */
  ordinary?: <O extends LocalOrdinaryOperation>(operation: O, options: { assertCurrent(): void; signal?: AbortSignal }) =>
    Promise<PreparedLocalOrdinaryResult<LocalOrdinaryResult<O>>>;
  epoch?: number;
  initial?: LocalTabData | (() => LocalTabData | undefined | Promise<LocalTabData | undefined>);
  rootType?: FenelType;
  signal?: AbortSignal;
  /** Account sources supply their checked account preparation unchanged. */
  prepareSnapshot?: (definitions: FieldPersistenceSnapshot, representations: readonly InstanceDraft[], signal: AbortSignal) => Promise<BrowserReaderSnapshot>;
  projectRoot?: (state: LocalTabData, rootType: FenelType) => LocusRootData;
  planDefinitions?: (current: FieldPersistenceSnapshot, bundle: DefinitionBundle) => Promise<FieldPersistenceSnapshot>;
  /** Progressive Local retention receives only the existing storage snapshot
   * fields; account readers retain their exact source-specific publication. */
  onPublish?: (state: LocalTabData) => void;
  /** The browser holder retains ordinary drafts and this durable baseline
   * across session epochs, while every checked reader is prepared afresh. */
  storage?: BrowserDataStorage;
  synchronization?: LocusSynchronization;
  initialStorage?: { record?: BrowserDataRecord; lastSynced: LocalTabData };
  initialStorageUncertainty?: string;
  /** Local's successor acquires its state/baseline pair after retired saves
   * settle. initial/initialStorage remain synchronous status/revision hints. */
  acquireRetained?: () => Promise<{ state?: LocalTabData; storage?: BrowserDataSourceOptions["initialStorage"];
    storageUncertainty?: string }>;
  /** Receipt settlement outlives the reader; called before lifetime abortion. */
  onRetire?: (storageSettlement: Promise<void>) => void;
  onStored?: (record: BrowserDataRecord | undefined, lastSynced: LocalTabData) => void;
  onStorageUncertainty?: (error: string | undefined) => void;
  /** Snapshot ownership may overlap a committed account reader. */
  retireSnapshot?: (snapshot: BrowserReaderSnapshot) => void;
};

// Only ordinary admitted data crosses a browser-session boundary. Reader
// registries, workers, frames and computed projections remain epoch-owned.
let tabKeeper: { state?: LocalTabData; storage?: BrowserDataSourceOptions["initialStorage"];
  storageUncertainty?: string; settlement: Promise<void> } | undefined;
let tabSource: LocalTabSource | undefined;
let retireTabSource: (() => void) | undefined;
onBrowserSessionChange(() => {
  retireTabSource?.();
  tabSource = undefined;
  retireTabSource = undefined;
});

/** One retained tab identity; each browser epoch gets a freshly checked reader. */
export function localTabSourceId(): string { return localTabDataSource().id; }

export function localTabDataSource(): LocalTabSource {
  const epoch = untrack(sessionEpoch);
  if (tabSource?.epoch === epoch) return tabSource;
  const keeper = tabKeeper ??= { settlement: Promise.resolve() };
  // Capture predecessors now: a save waiting for its own initial acquisition
  // must never join the barrier that its retirement will append later.
  const predecessors = keeper.settlement;
  // A first visit only: nothing was ever published or stored in this page.
  const firstVisit = keeper.state === undefined && keeper.storage === undefined && keeper.storageUncertainty === undefined;
  const source = createBrowserDataSource({ id: LOCAL_BROWSER_SOURCE_ID, metadataSource: { $tag: "ThisTabSource" }, epoch, initial: keeper.state, clipboard: true, progressiveRead: true,
    provisional: firstVisit ? () => import("./local-bootstrap").then(bootstrap => bootstrap.emptyLocalFirstPaint(LOCAL_BROWSER_SOURCE_ID)) : undefined,
    synchronization: locusSynchronizationForSession(epoch), initialStorage: keeper.storage,
    initialStorageUncertainty: keeper.storageUncertainty,
    acquireRetained: async () => {
      await predecessors;
      return { state: keeper.state, storage: keeper.storage, storageUncertainty: keeper.storageUncertainty };
    },
    onRetire: settlement => {
      // An unread intermediate source still carries its predecessors' drain.
      keeper.settlement = Promise.all([keeper.settlement, settlement]).then(() => undefined);
    },
    onPublish: next => { keeper.state = next; },
    onStorageUncertainty: error => { keeper.storageUncertainty = error; },
    onStored: (record, lastSynced) => {
      // A transaction may commit before an old epoch observes its cancellation.
      // Keep that acknowledged baseline without replacing a newer generation.
      if (record && keeper.storage?.record && record.generation < keeper.storage.record.generation) return;
      keeper.storage = { record, lastSynced };
    } });
  tabSource = source;
  retireTabSource = () => source.dispose();
  return tabSource;
}

/** Shared browser holder; source-specific readers own preparation and scope.
 * Fenel checks each transition before this boundary publishes data and reader. */
export function createBrowserDataSource(options: BrowserDataSourceOptions): LocalTabSource {
  const id = options.id;
  const epoch = options.epoch ?? untrack(sessionEpoch);
  const lifetime = new AbortController();
  let retiring = false;
  let initialState = typeof options.initial === "function" ? undefined : options.initial;
  // Publication can replace equal-revision data after another tab's save.
  // This notification counter is independent of both edit and disk revisions.
  const [version, setVersion] = createSignal(0, { ownedWrite: true });
  const [status, setStatus] = createSignal(0, { ownedWrite: true });
  let state: LocalTabData;
  let snapshot: BrowserReaderSnapshot;
  let publicationPacket: { state: LocalTabData; snapshot?: BrowserReaderSnapshot; value: LocalOrdinaryPublication } | undefined;
  // L4 first paint: shown only while no publication exists; closed for good
  // once the worker publishes or its first read fails.
  let provisional: LocalOrdinaryPublication | undefined;
  let provisionalOffer: Promise<boolean> | undefined;
  let provisionalClosed = false;
  // After a withdrawal, the latest failed first read until a publication.
  let withdrawnFailure: Promise<void> | undefined;
  let captureMetadataPacket: typeof import("./reader-source-metadata").readerSourceMetadataPacket | undefined;
  let metadataGeneration = 0;
  let metadataCapture: { state: LocalTabData; snapshot: BrowserReaderSnapshot; value: ReaderSourceMetadataCapture } | undefined;
  let rootType: FenelType;
  let call: <T>(name: string, ...args: unknown[]) => T;
  let initialCall: typeof call | undefined;
  let workerTools: typeof import("./expression-runner/authoring-catalog-worker");
  let preparing: Promise<void> | undefined;
  let reading: Promise<void> | undefined;
  let readModel: import("./workspace-model-loader").WorkspaceModel | undefined;
  let writes: Promise<unknown> = Promise.resolve();
  let releaseSession = () => {};
  let releaseSynchronization = () => {};
  let stored = options.initialStorage?.record;
  let lastSynced = options.initialStorage?.lastSynced;
  let storageUncertainty = options.initialStorageUncertainty;
  let storageInitialized = options.initialStorage !== undefined;
  let initialLoad: Promise<LocalTabData | undefined> | undefined;
  let saving: Promise<boolean> | undefined;
  let saveScheduled = false;
  let saveFrame: number | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let failure: string | undefined;
  const workerLineage = Object.freeze({});
  let earlyRealm: EarlyAuthoringRealm | undefined;
  const ownsLocalRealm = !options.prepareSnapshot && !options.retireSnapshot;
  const primeOrdinaryOwner = () => {
    assertActive();
    if (ownsLocalRealm) earlyRealm ??= spawnEarlyAuthoringRealm(workerLineage, epoch);
  };
  // This is a new public admission, never a retry inside a failed RPC. The
  // existing ticket predicate alone decides whether a closed initial realm
  // is settled and still belongs to this holder.
  const primeOrdinaryAdmission = () => {
    assertActive();
    if (!ownsLocalRealm) return;
    if (earlyRealm && !snapshot) earlyRealm = retryEarlyAuthoringRealm(earlyRealm) ?? earlyRealm;
    primeOrdinaryOwner();
  };
  type Prepared<T> = Extract<PreparedLocalOrdinaryResult<T>, { kind: "prepared" }>;
  const prepareOrdinary = async <O extends LocalOrdinaryOperation>(operation: O,
    guard: () => void = assertActive, signal?: AbortSignal,
    admit?: () => void): Promise<Prepared<LocalOrdinaryResult<O>>> => {
    const activeSignal = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
    const assertSource = () => { assertActive(); activeSignal.throwIfAborted(); guard(); };
    assertSource();
    // Observe at invocation, before even the transport module import can
    // yield. Compatibility Dates retain exact native/edge observations too.
    const observation = options.progressiveRead
      ? captureRegistryTransportObservation(operation, "Local ordinary invocation") : undefined;
    if (observation?.kind === "unsupported") throw new TypeError(observation.reason);
    const assertCurrent = () => { assertSource(); observation?.assertCurrent(); };
    let prepared: PreparedLocalOrdinaryResult<LocalOrdinaryResult<O>> | undefined;
    try {
      // Only public admission supplies this synchronous hook. Refuse an
      // unobservable input before it can prime or rearm a physical owner.
      admit?.();
      if (!options.progressiveRead) {
        prepared = { kind: "prepared", value: runLocalOrdinaryOperation({ workspaceCall: initialCall ?? project } as import("./workspace-model-loader").WorkspaceModel, operation),
          assertCurrent, release: () => {} };
      } else if (options.ordinary) prepared = await options.ordinary(operation, { assertCurrent, signal: activeSignal });
      else {
        primeOrdinaryOwner();
        const workers = await import("./expression-runner/authoring-catalog-worker");
        assertCurrent();
        workerTools = workers;
        const borrowed = workers.borrowLocalOrdinaryTransport(workerLineage, epoch);
        let delivered = false;
        prepared = await prepareAuthoringLocalOperation(borrowed.transport, operation, {
          signal: activeSignal, assertCurrent: () => { assertCurrent(); if (!delivered) borrowed.assertCurrent(); },
        });
        // An accepted result retains its graph proof across the intentional
        // reader release/rebuild, without following a replaced physical request.
        delivered = true;
      }
      if (prepared.kind === "unsupported") {
        // Only initial graph-capture refusal may acquire page compatibility.
        // Posted failures never reach this branch.
        const { loadWorkspaceModel } = await import("./workspace-model-loader");
        readModel ??= await loadWorkspaceModel({ projected: true });
        assertCurrent();
        prepared = { kind: "prepared", value: runLocalOrdinaryOperation(readModel, operation), assertCurrent, release: () => {} };
      }
      const accepted = prepared;
      accepted.assertCurrent();
      return { kind: "prepared", value: accepted.value,
        assertCurrent: () => { assertCurrent(); accepted.assertCurrent(); },
        release: () => { try { accepted.release(); } finally { observation?.release(); } } };
    } catch (problem) {
      if (prepared?.kind === "prepared") prepared.release();
      observation?.release();
      throw problem;
    }
  };
  const ordinary = async <O extends LocalOrdinaryOperation>(operation: O, signal?: AbortSignal): Promise<LocalOrdinaryResult<O>> => {
    assertActive(); signal?.throwIfAborted();
    const recovering = ownsLocalRealm && snapshot?.kind === "local" && workerTools.preparedReaderWorkerClosed(snapshot.worker);
    // Keep the submitted graph from entry through shared reader recovery.
    // Internal restoration operations never enter this public admission path.
    const observation = recovering ? captureRegistryTransportObservation(operation, "Local ordinary admission") : undefined;
    if (observation?.kind === "unsupported") throw new TypeError(observation.reason);
    const assertCurrent = () => { assertActive(); signal?.throwIfAborted(); observation?.assertCurrent(); };
    let prepared: Prepared<LocalOrdinaryResult<O>> | undefined;
    try {
      if (recovering) { await restoreClosedTools(); assertCurrent(); }
      prepared = await prepareOrdinary(operation, assertCurrent, signal, primeOrdinaryAdmission);
      prepared.assertCurrent();
      return prepared.value;
    } finally {
      try { prepared?.release(); } finally { observation?.release(); }
    }
  };
  type InvokeOrdinary = <O extends LocalOrdinaryOperation>(operation: O) => Promise<LocalOrdinaryResult<O>>;
  const usingOrdinary = async <T>(guard: () => void, signal: AbortSignal | undefined,
    work: (run: InvokeOrdinary, check: () => void) => Promise<T>): Promise<T> => {
    const leases: Prepared<unknown>[] = [];
    const run: InvokeOrdinary = async operation => {
      const lease = await prepareOrdinary(operation, guard, signal);
      leases.push(lease);
      return lease.value;
    };
    const check = () => { assertActive(); signal?.throwIfAborted(); guard(); for (const lease of leases) lease.assertCurrent(); };
    try { return await work(run, check); }
    finally { for (const lease of leases) lease.release(); }
  };
  const storage: BrowserDataStorage | undefined = options.storage ?? (options.progressiveRead && ownsLocalRealm ? {
    async load(signal) {
      primeOrdinaryOwner();
      const workers = await import("./expression-runner/authoring-catalog-worker");
      assertActive(); signal?.throwIfAborted();
      workerTools = workers;
      const borrowed = workers.borrowLocalOrdinaryTransport(workerLineage, epoch);
      borrowed.assertCurrent();
      const record = await createAuthoringWorkerBrowserStorage(borrowed.transport).load(signal);
      assertActive(); signal?.throwIfAborted(); borrowed.assertCurrent();
      return record;
    },
    commit(next, generation, signal) {
      const flight = this.beginCommit!(next, generation, () => {}, signal);
      return flight.settled.then(outcome => {
        if (outcome.status !== "committed") throw new Error(outcome.error);
        return outcome.record;
      });
    },
    beginCommit(next, generation, notify, signal) {
      // The owner is already primed by admission. Capture one exact adapter
      // synchronously and retain it until its durable settlement.
      if (!workerTools) throw new Error("This source's storage transport is not ready.");
      const borrowed = workerTools.borrowLocalOrdinaryTransport(workerLineage, epoch);
      borrowed.assertCurrent();
      return beginBrowserDataStorageCommit(createAuthoringWorkerBrowserStorage(borrowed.transport), next, generation, notify, signal);
    },
  } : undefined);
  const ordinaryStates = new WeakMap<LocalTabData, LocalTabData>();
  const retainedState = (captured: LocalTabData): LocalTabData => {
    if (!options.progressiveRead) return captured;
    const previous = ordinaryStates.get(captured);
    if (previous) return previous;
    throw new Error("This source's ordinary publication is not ready.");
  };
  const assertActive = () => { assertCurrentSession(epoch); lifetime.signal.throwIfAborted(); };
  const changed = () => {
    if (!lifetime.signal.aborted && epoch === untrack(sessionEpoch)) setStatus(value => value + 1);
  };
  const pending = () => { status(); return !!storage && (!!storageUncertainty
    || !!(state ?? initialState) && (state ?? initialState) !== lastSynced); };
  const enabled = () => options.synchronization?.enabledNow() ?? true;
  const scheduleAutomaticSave = () => {
    if (lifetime.signal.aborted || !storage || storageUncertainty || !enabled() || !pending() || saveScheduled) return;
    saveScheduled = true;
    const persist = () => {
      if (saveFrame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(saveFrame);
      saveFrame = undefined;
      saveTimer = undefined;
      saveScheduled = false;
      if (lifetime.signal.aborted || !enabled() || !pending()) return;
      void save(true).then(saved => {
        if (saved) scheduleAutomaticSave();
      });
    };
    const afterPaint = () => {
      if (!saveScheduled) return;
      saveFrame = undefined;
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 0);
    };
    if (typeof requestAnimationFrame === "function") {
      saveFrame = requestAnimationFrame(afterPaint);
      // Hidden documents can pause animation frames; durability still resumes.
      saveTimer = setTimeout(persist, 250);
    }
    else afterPaint();
  };
  const rememberStored = (record: BrowserDataRecord | undefined, captured: LocalTabData,
    ordinary?: LocalTabData) => {
    // Keeper retention must succeed before this reader marks its data clean.
    // Reentrant retirement still captures the active durable save barrier.
    options.onStored?.(record, ordinary ?? retainedState(captured));
    stored = record; lastSynced = captured;
    changed();
  };
  const loadInitial = () => {
    initialLoad ??= (async () => {
      let retained: LocalTabData | undefined;
      if (options.acquireRetained) {
        const acquired = await options.acquireRetained();
        assertActive();
        initialState = retained = acquired.state;
        stored = acquired.storage?.record;
        lastSynced = acquired.storage?.lastSynced;
        storageUncertainty = acquired.storageUncertainty;
        storageInitialized = acquired.storage !== undefined;
      } else retained = typeof options.initial === "function" ? await options.initial() : initialState;
      assertActive();
      if (storage && !storageInitialized) {
        const record = await storage.load(lifetime.signal);
        assertActive();
        stored = record; lastSynced = record?.data; storageInitialized = true;
      }
      return retained ?? stored?.data;
    })().catch(problem => { initialLoad = undefined; throw problem; });
    return initialLoad;
  };
  const read = () => { assertActive(); version(); return state; };
  const project = <T>(name: string, ...args: unknown[]): T => {
    assertActive();
    if (!snapshot) throw new Error("This source's editing tools are not ready.");
    return call<T>(name, ...args);
  };
  const cachedPublication = () => {
    const current = read();
    if (!publicationPacket || publicationPacket.state !== current || publicationPacket.snapshot !== snapshot)
      throw new Error("This source's data is not ready.");
    return publicationPacket.value;
  };
  /** Root and saved values only may read the provisional packet, and only
   * before this source has any state of its own. */
  const firstPaintPublication = () => read() === undefined && provisional ? provisional : cachedPublication();
  const root = () => firstPaintPublication().root;
  const savedValues = () => firstPaintPublication().savedValues;
  const metadataTargets = () => cachedPublication().metadataTargets;
  const captureSourceMetadata = (): ReaderSourceMetadataCapture | undefined => {
    assertActive();
    if (!options.metadataSource || !snapshot || !captureMetadataPacket) return undefined;
    const capturedState = read();
    const capturedSnapshot = snapshot;
    if (metadataCapture?.state === capturedState && metadataCapture.snapshot === capturedSnapshot) return metadataCapture.value;
    const publication = cachedPublication();
    if (!publication.dependencyRoster) throw new Error("This source's metadata publication is not ready.");
    const packet = captureMetadataPacket(options.metadataSource, publication.root.id, String(++metadataGeneration), publication.dependencyRoster);
    assertActive();
    if (state !== capturedState || snapshot !== capturedSnapshot) throw new Error("This source changed while its metadata was being captured. Try again.");
    const value: ReaderSourceMetadataCapture = { session: capturedSnapshot.session, packet, generationToken: Object.freeze({}),
      current: () => {
        try { assertActive(); return state === capturedState && snapshot === capturedSnapshot; }
        catch { return false; }
      } };
    metadataCapture = { state: capturedState, snapshot: capturedSnapshot, value };
    return value;
  };
  const prepareSnapshot = (definitions: FieldPersistenceSnapshot, representations: readonly InstanceDraft[], signal: AbortSignal, localValueIds: readonly string[]) =>
    options.prepareSnapshot?.(definitions, representations, signal) ?? prepareLocalReaderSnapshot(id, definitions, { signal, representations, localValueIds, lineage: workerLineage });
  const planDefinitions = (current: FieldPersistenceSnapshot, bundle: DefinitionBundle) =>
    options.planDefinitions?.(current, bundle) ?? planLocalDefinitionBundle(id, current, bundle);
  /** The worker a snapshot owns: a Local handle, or its page registry's worker. */
  const workerOf = (candidate: BrowserReaderSnapshot): object => candidate.kind === "local" ? candidate.worker : candidate.registry;
  const discardSnapshotWorker = (candidate: BrowserReaderSnapshot) => {
    if (candidate.kind === "local") workerTools.discardPreparedReaderWorker(candidate.worker);
    else workerTools.discardPreparedAuthoringWorker(candidate.registry);
  };
  const retireSnapshot = (candidate: BrowserReaderSnapshot) => {
    if (candidate === retiredTools) return;
    if (options.retireSnapshot) options.retireSnapshot(candidate);
    else discardSnapshotWorker(candidate);
  };
  // A Local rebuild retires the published snapshot's catalogue worker before
  // its replacement is prepared, so two worker registries never coexist. The
  // published snapshot (its registry token and frameless session) stays as
  // this source's identity; its checked transitions run as ordinary
  // operations, and worker features refuse through the closed client until
  // publication.
  // Account sources supply their own preparation and keep their retirement.
  const retiresToolsEarly = !options.prepareSnapshot && !options.retireSnapshot;
  /** W1: this holder's successive Local snapshots may reuse one catalogue
   * realm. The retired snapshot is released (its requests refuse) and its idle
   * realm is kept; a failed, cancelled or busy realm is terminated as before. */
  let retiredTools: BrowserReaderSnapshot | undefined;
  let rebuilds = 0;
  /** Settles when the last in-flight rebuild ends (B4 unit E: worker decoding waits on it). */
  let rebuildSettled: { promise: Promise<void>; resolve: () => void } | undefined;
  let releaseReplacement: (() => void) | undefined;
  let restoring: Promise<void> | undefined;
  let releaseRestoration: (() => void) | undefined;
  const beginRebuild = () => {
    rebuilds++;
    if (!rebuildSettled) {
      let resolve!: () => void;
      rebuildSettled = { promise: new Promise<void>(done => { resolve = done; }), resolve };
    }
    if (!retiresToolsEarly || !snapshot || retiredTools === snapshot) return;
    retiredTools = snapshot;
    if (snapshot.kind === "local") releaseReplacement = workerTools.beginPreparedReaderWorkerReplacement(snapshot.worker);
    if (snapshot.kind === "local") workerTools.discardPreparedReaderWorker(snapshot.worker, { keepRealm: true });
    else discardSnapshotWorker(snapshot);
  };
  /** A failed or cancelled rebuild leaves the published snapshot without a
   * worker: prepare one for that same registry, owner and data, then publish it. */
  const restoreTools = (): Promise<void> => {
    if (!snapshot || retiredTools !== snapshot || rebuilds > 0 || lifetime.signal.aborted) return Promise.resolve();
    restoring ??= (async () => {
      const captured = snapshot;
      const capturedState = state;
      const localValueIds = localSavedValueIds(capturedState);
      const release = captured.kind === "local" ? workerTools.beginPreparedReaderWorkerReplacement(captured.worker) : () => {};
      releaseRestoration = release;
      let candidate: BrowserReaderSnapshot | undefined;
      let observation: ReturnType<typeof captureRegistryTransportObservation> | undefined;
      try {
        // Only the default Local preparation retires its tools early.
        if (captured.kind !== "local") throw new Error("This source's editing tools cannot be restored.");
        const cached = cachedPublication();
        observation = captureRegistryTransportObservation(capturedState, "Local reader restoration");
        if (observation.kind === "unsupported") throw new TypeError(observation.reason);
        const observed = observation;
        await usingOrdinary(() => {
          assertActive();
          observed.assertCurrent();
          if (snapshot !== captured || state.definitions !== capturedState.definitions || state.representations !== capturedState.representations)
            throw new Error("This source's reader restoration was replaced.");
        }, undefined, async (run, check) => {
          // Restoration may follow a failed preparation with no physical
          // worker left. The exact published packet already owns this roster.
          candidate = await prepareLocalReaderSnapshot(id, capturedState.definitions,
            { signal: lifetime.signal, restore: captured, lineage: workerLineage,
              representations: cached.representations.map(row => row.instance), localValueIds });
          assertActive();
          // A newer rebuild owns publication; its own failure restores again.
          if (snapshot !== captured || retiredTools !== captured || rebuilds > 0
            || state.definitions !== capturedState.definitions || state.representations !== capturedState.representations) return;
          const latest = state;
          const packet = await preparePublication(latest, candidate, run);
          check();
          if (state !== latest) throw new Error("This source's data changed before reader restoration.");
          publish(latest, packet, candidate);
        });
        if (snapshot === candidate) { retiredTools = undefined; candidate = undefined; }
      } finally {
        if (observation?.kind === "captured") observation.release();
        restoring = undefined;
        release();
        if (releaseRestoration === release) releaseRestoration = undefined;
        // The unpublished candidate owns only its new worker.
        discardUnpublished(candidate);
      }
    })();
    return restoring;
  };
  const endRebuild = (candidate: BrowserReaderSnapshot | undefined) => {
    rebuilds--;
    discardUnpublished(candidate);
    if (rebuilds === 0) {
      if (snapshot && retiredTools === snapshot) void restoreTools().catch(() => {});
      releaseReplacement?.(); releaseReplacement = undefined;
      const settled = rebuildSettled;
      rebuildSettled = undefined;
      settled?.resolve();
    }
  };
  const enqueue = <T>(work: () => Promise<T>, synchronize = true): Promise<T> => {
    const next = writes.then(work);
    writes = next.catch(() => {});
    return next.then(async result => {
      // Saving waits for this queue from outside its jobs. An admitted edit
      // remains accepted when storage fails; its source retains the error.
      if (synchronize && storage && enabled()) {
        const saved = await save(true);
        if (saved && enabled() && pending()) await save(true);
      }
      return result;
    });
  };
  /** B4 unit E: a Local candidate's labels are its worker's published catalogue
   * data; an account draft snapshot keeps its page session's catalogue. */
  const callableLabelsOf = (candidate: BrowserReaderSnapshot): readonly { id: string; label: string }[] => candidate.kind === "local"
    ? candidate.callableLabels
    : candidate.session.catalog ? catalogCallableLabels(candidate.session.catalog) : [];
  const preparePublication = async (next: LocalTabData, candidate: BrowserReaderSnapshot | undefined,
    run: InvokeOrdinary): Promise<LocalOrdinaryPublication> => {
    const callableLabels = candidate && callableLabelsOf(candidate);
    const packet = await run({ kind: "publication", args: [next, rootType, {
      ...(callableLabels ? { callableLabels } : {}), earlyTypeDescriptions: !candidate,
    }] });
    if (options.projectRoot) {
      packet.root = options.projectRoot(next, rootType);
      if (callableLabels) packet.dependencyRoster = await run({ kind: "dependencyMetadataRoster",
        args: [packet.root, packet.savedValues, callableLabels] });
    }
    return packet;
  };
  const assertCandidate = (candidate: BrowserReaderSnapshot | undefined) => {
    if (ownsLocalRealm && candidate?.kind === "local" && workerTools.preparedReaderWorkerClosed(candidate.worker))
      throw new Error("This source's reader candidate was replaced.");
  };
  const publish = (next: LocalTabData, packet: LocalOrdinaryPublication, nextSnapshot = snapshot) => {
    assertActive();
    assertCandidate(nextSnapshot);
    if (packet.state !== next) throw new Error("This source's publication does not match its data.");
    const prior = snapshot;
    state = next;
    snapshot = nextSnapshot;
    // Reader-only replacement must retain the source's acknowledged ordinary
    // identity. A freshly projected wrapper must not turn a clean keeper dirty.
    const retained = ordinaryStates.get(next);
    if (retained) packet.ordinarySnapshot = retained;
    else ordinaryStates.set(next, packet.ordinarySnapshot);
    publicationPacket = { state: next, snapshot: nextSnapshot, value: packet };
    // The worker's answer wins over any first-paint packet, equal or not.
    provisional = undefined; provisionalClosed = true; withdrawnFailure = undefined;
    metadataCapture = undefined;
    if (prior && nextSnapshot && prior !== nextSnapshot) {
      if (workerOf(prior) !== workerOf(nextSnapshot)) retireSnapshot(prior);
      if (retiredTools === prior) retiredTools = undefined;
    }
    setVersion(value => value + 1);
    options.onPublish?.(retainedState(next));
    changed();
  };
  const discardUnpublished = (candidate: BrowserReaderSnapshot | undefined) => {
    if (candidate && (!snapshot || workerOf(candidate) !== workerOf(snapshot))) retireSnapshot(candidate);
  };
  const stateGuard = (capturedState = state, capturedSnapshot = snapshot) => () => {
    assertActive();
    if (state !== capturedState || snapshot !== capturedSnapshot) throw new Error("This tab data changed before this edit.");
  };
  const retainClipboard = async (submitted: ClipboardCopy) => {
    const copy = structuredClone(submitted);
    assertActive();
    if (!options.clipboard) throw new Error("Clipboard belongs to This tab.");
    await readReady();
    return enqueue(async () => usingOrdinary(stateGuard(), undefined, async (run, check) => {
      const result = await run({ kind: "tabClipboardCopy", args: [state,
        copy.id, copy.value, copy.typeName, copy.transfer, copy.bytes, copy.copiedAt, copy.source] });
      if (result.$tag !== "Ok") throw new Error(result._0);
      const packet = await preparePublication(result._0, snapshot, run);
      check();
      publish(result._0, packet);
    }));
  };
  const admitInitial = async (retained: LocalTabData | undefined, run: InvokeOrdinary): Promise<LocalTabData> => {
    const checked = retained && await run({ kind: "validateTabData", args: [retained] });
    if (checked && checked.$tag === "Err") throw new Error(checked._0);
    if (retained && (!checked || checked.$tag !== "Ok" || checked._0 === undefined || checked._0 === null))
      throw new Error("This tab's retained data could not be checked.");
    const initial = checked && checked.$tag === "Ok" ? checked._0 : await run({ kind: "defaultLocalTabData", args: [id] });
    const identity = await run({ kind: "tabDataCheckRoot", args: [initial, id] });
    if (identity.$tag !== "Ok" || identity._0 !== true)
      throw new Error(identity.$tag === "Err" ? identity._0 : "This source's retained identity could not be checked.");
    return options.clipboard ? run({ kind: "tabDataWithClipboard", args: [initial] }) : initial;
  };
  const readReady = (): Promise<void> => {
    assertActive();
    if (!options.progressiveRead) return ready();
    primeOrdinaryAdmission();
    reading ??= (async () => {
      const { List, Anything } = await import("@fenel/engine/type-foundation");
      assertActive();
      const retained = await loadInitial();
      rootType = options.rootType ?? List(Anything);
      await usingOrdinary(stateGuard(), undefined, async (run, check) => {
        const normalized = await admitInitial(retained, run);
        const packet = await preparePublication(normalized, undefined, run);
        check();
        ordinaryStates.set(normalized, packet.ordinarySnapshot);
        if (storage && (!lastSynced || lastSynced === retained)) rememberStored(stored, normalized);
        publish(normalized, packet);
      });
      scheduleAutomaticSave();
    })().catch(error => { reading = undefined; throw error; });
    return reading;
  };
  /** L4 first paint. The worker chain starts (or continues) exactly as in
   * readReady; meanwhile an empty first visit may show the provisional packet.
   * A failed first read withdraws it, so its readers see that failure. */
  const firstPaint = (): Promise<void> => {
    const confirmed = readReady();
    if (!options.provisional) return confirmed;
    if (withdrawnFailure && !publicationPacket) {
      // Readers that showed the withdrawn packet learn its failure at once,
      // never the stale packet while the next read runs. Only publication
      // notifies them again: a failure does not re-trigger any reader.
      void confirmed.catch(() => { if (withdrawnFailure) withdrawnFailure = confirmed; });
      return Promise.race([confirmed, withdrawnFailure]);
    }
    if (!provisionalOffer) {
      const offer = options.provisional().then(packet => {
        assertActive();
        if (!packet || provisionalClosed || publicationPacket) return false;
        provisional = packet;
        setVersion(value => value + 1);
        return true;
      }).catch(() => false);
      provisionalOffer = offer;
      void confirmed.catch(() => {
        if (provisionalClosed) return;
        provisionalClosed = true;
        if (!provisional) return;
        provisional = undefined; withdrawnFailure = confirmed;
        if (!lifetime.signal.aborted && epoch === untrack(sessionEpoch)) setVersion(value => value + 1);
      });
    }
    return Promise.race([confirmed, provisionalOffer.then(shown => shown && provisional ? undefined : confirmed)]);
  };
  const ready = (): Promise<void> => {
    assertActive();
    preparing ??= (async () => {
      if (options.progressiveRead) await readReady();
      const [{ invokeCallable }, { List, Anything, Ref }, workers, metadataTools] = await Promise.all([
        import("@fenel/engine"), import("@fenel/engine/type-foundation"), import("./expression-runner/authoring-catalog-worker"),
        options.metadataSource ? import("./reader-source-metadata") : undefined,
      ]);
      assertActive();
      workerTools = workers;
      captureMetadataPacket = metadataTools?.readerSourceMetadataPacket;
      let candidate: BrowserReaderSnapshot | undefined;
      let preparationObservation: Extract<ReturnType<typeof captureRegistryTransportObservation>, { kind: "captured" }> | undefined;
      try {
        const retained = options.progressiveRead ? state : await loadInitial();
        assertActive();
        if (options.progressiveRead) {
          const observed = captureRegistryTransportObservation(retained, "Local initial reader preparation");
          if (observed.kind === "unsupported") throw new TypeError(observed.reason);
          preparationObservation = observed;
        }
        const definitions = retained?.definitions ?? { owners: [], fields: [], facets: [] };
        const representations = retained?.representations ?? [];
        const localValueIds = localSavedValueIds(retained);
        candidate = await prepareSnapshot(definitions, representations.map(entry => entry.value.instance), lifetime.signal, localValueIds);
        assertActive();
        preparationObservation?.assertCurrent();
        rootType = options.rootType ?? List(Anything);
        if (!options.progressiveRead) {
          // B4 wave 5: a frameless (Local) session has no page `view` frame;
          // only account snapshots reach this path, and a frameless one refuses.
          const viewCall = (selected: BrowserReaderSnapshot) => <T>(name: string, ...args: unknown[]): T => {
            let frame: BrowserReaderSnapshot["session"]["evaluateContext"];
            try { frame = selected.session.evaluateContext; }
            catch { throw new Error(LOCAL_PROJECTION_IN_WORKER); }
            return invokeCallable(Ref(`view:${name}`), args, frame) as T;
          };
          initialCall = viewCall(candidate);
          await usingOrdinary(stateGuard(), undefined, async (run, check) => {
            const normalized = await admitInitial(retained, run);
            const packet = await preparePublication(normalized, candidate, run);
            check();
            ordinaryStates.set(normalized, packet.ordinarySnapshot);
            if (storage && (!lastSynced || lastSynced === retained)) rememberStored(stored, normalized);
            call = <T>(name: string, ...args: unknown[]) => viewCall(snapshot)<T>(name, ...args);
            publish(normalized, packet, candidate);
          });
        } else {
          // Only a successful inert projection may be superseded by Clipboard.
          // RPC errors, mutation and cancellation escape without any replay.
          while (true) {
            preparationObservation?.assertCurrent();
            const current = state;
            if (current.definitions !== definitions || current.representations !== representations)
              throw new Error("This source's definitions changed while its reader prepared.");
            const prepared = await prepareOrdinary({ kind: "publication", args: [current, rootType, {
              callableLabels: callableLabelsOf(candidate),
            }] }, () => {
              assertActive();
              preparationObservation?.assertCurrent();
              assertCandidate(candidate);
              if (snapshot || state.definitions !== definitions || state.representations !== representations)
                throw new Error("This source's reader candidate was replaced.");
            });
            try {
              prepared.assertCurrent();
              if (state !== current) continue;
              // B4 unit D: a progressive (Local) source's view functions run in
              // its worker (Home plans its starters with `plan-reader-linked-demo`);
              // its page session is never invoked. `project` refuses.
              call = () => { throw new Error(LOCAL_PROJECTION_IN_WORKER); };
              publish(current, prepared.value, candidate);
              break;
            } finally { prepared.release(); }
          }
        }
      } finally { preparationObservation?.release(); initialCall = undefined; discardUnpublished(candidate); }
    })().catch(error => { preparing = undefined; throw error; });
    return preparing;
  };
  const ingestExternal: LocalTabSource["ingestExternal"] = async (submitted, ingress = {}) => {
    assertActive(); ingress.signal?.throwIfAborted();
    if (!options.progressiveRead) return undefined;
    const captured = structuredClone(submitted);
    // The Fenel predicate is polymorphic in each file and reads only list
    // length. Native Files stay in this private decoder capture.
    const candidate = { internal: captured.internal, html: captured.html, savedExprId: captured.savedExprId,
      files: captured.files.map(() => 0) };
    if (!await ordinary({ kind: "tabExternalTransferCandidate", args: [candidate] }, ingress.signal)) return undefined;
    const { ingestTransfer } = await import("./data-transfer");
    const [items] = await Promise.all([ingestTransfer(captured, { signal: ingress.signal }), readReady()]);
    assertActive(); ingress.signal?.throwIfAborted();
    const names = await ordinary({ kind: "tabExternalTransferTypes", args: [items] }, ingress.signal);
    if (names.$tag !== "Just") return undefined;
    const types = await Promise.all(names._0.map(declaration => ordinary({ kind: "sourceTypeReference",
      args: [declaration.owner, declaration.name] }, ingress.signal)));
    const identities = items.map(() => crypto.randomUUID());
    return enqueue(async () => usingOrdinary(stateGuard(), ingress.signal, async (run, check) => {
      const planned = await run({ kind: "tabExternalTransferCommands", args: [items, identities, types] });
      const result = await run({ kind: "applyTabDataCommands", args: [state, state.revision, planned.commands] });
      if (result.$tag !== "Ok") throw new Error(result._0);
      const packet = await preparePublication(result._0, snapshot, run);
      check();
      publish(result._0, packet);
      const receipt = { root: root(), items: planned.items, notes: planned.notes };
      ingress.onPublished?.(receipt);
      return receipt;
    }), false).then(receipt => { scheduleAutomaticSave(); return receipt; });
  };
  function save(automatic = false): Promise<boolean> {
    if (!storage) return Promise.resolve(true);
    if (saving) return saving;
    try { assertActive(); } catch { return Promise.resolve(false); }
    const queued = writes;
    failure = undefined;
    const flight = Promise.resolve().then(async () => {
      try {
        await queued;
        if (automatic && !enabled()) return true;
        if (!state) await readReady();
        assertActive();
        if (automatic && !enabled()) return true;
        if (storageUncertainty) throw new Error(storageUncertainty);
        if (state === lastSynced) return true;
        // Resolve the current provider before capturing one durable adapter.
        // Recovery never clears or bypasses a pending uncertain receipt.
        primeOrdinaryAdmission();
        await restoreClosedTools();
        assertActive();
        if (storageUncertainty) throw new Error(storageUncertainty);
        if (state === lastSynced) return true;
        const captured = state;
        // Prepare the ordinary snapshot before any durable write. A reader
        // projection is neither storage input nor work to repeat after commit.
        const ordinary = retainedState(captured);
        const generation = stored?.generation;
        let acknowledgementFailure: string | undefined;
        const commit = beginBrowserDataStorageCommit(storage!, structuredClone(ordinary), generation, outcome => {
          // Retain durable metadata synchronously, before cancelled readers or
          // physical retirement can acquire the successor's ordinary baseline.
          try {
            if (outcome.status === "committed") rememberStored(outcome.record, captured, ordinary);
            else if (outcome.status === "uncertain") {
              storageUncertainty = "Local data's last save could not be confirmed. Discard to reload its saved copy before saving again.";
              options.onStorageUncertainty?.(storageUncertainty);
              changed();
            }
          } catch (problem) {
            // A committed transaction stays committed. Failed host retention is
            // a separate recovery requirement, even if its notification fails.
            acknowledgementFailure = "Local data's save acknowledgement could not be retained. Discard to reload its saved copy before saving again.";
            storageUncertainty = acknowledgementFailure;
            if (outcome.status === "committed") {
              try { options.onStorageUncertainty?.(storageUncertainty); } catch { /* Local recovery state remains retained. */ }
            }
            changed();
            throw problem;
          }
        }, lifetime.signal);
        // Cancellation may settle this reader first. Keep saving/onRetire tied
        // to the independent physical outcome, without an unhandled rejection.
        void commit.result.catch(() => undefined);
        const outcome = await commit.settled;
        if (acknowledgementFailure) throw new Error(acknowledgementFailure);
        if (outcome.status !== "committed") throw new Error(storageUncertainty ?? outcome.error);
        assertActive();
        return true;
      } catch (problem) {
        if (!lifetime.signal.aborted && epoch === untrack(sessionEpoch)) {
          failure = problem instanceof Error ? problem.message : String(problem);
        }
        return false;
      } finally {
        if (saving === flight) saving = undefined;
        changed();
      }
    });
    saving = flight;
    changed();
    return flight;
  }
  const transact = (submitted: readonly TabCommand[], expectedRevision?: number, signal?: AbortSignal,
    publication?: RootPublicationOptions, assertMutationCurrent?: () => void) => {
    const commands = structuredClone(submitted);
    return enqueue(async () => {
      assertMutationCurrent?.();
      await readyTools(); assertActive(); signal?.throwIfAborted();
      const assertState = stateGuard();
      return usingOrdinary(() => { assertState(); assertMutationCurrent?.(); }, signal, async (run, check) => {
        const result = await run({ kind: "applyTabDataCommands", args: [state, expectedRevision ?? state.revision, commands] });
        if (result.$tag === "Err") throw new Error(result._0);
        if (result._0.revision === state.revision) { check(); return root(); }
        const preparationSignal = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
        let candidate: BrowserReaderSnapshot | undefined;
        const rebuild = result._0.representations !== state.representations || result._0.definitions !== state.definitions;
        const localValueIds = rebuild ? localSavedValueIds(result._0) : [];
        const representations = rebuild ? await run({ kind: "tabDataRepresentationRows", args: [result._0, ""] }) : [];
        if (rebuild) beginRebuild();
        try {
          if (rebuild) candidate = await prepareSnapshot(result._0.definitions, representations.map(row => row.instance), preparationSignal, localValueIds);
          const packet = await preparePublication(result._0, candidate ?? snapshot, run);
          check();
          publish(result._0, packet, candidate ?? snapshot);
          const published = root();
          publication?.onPublished?.(published);
          return published;
        } finally { if (rebuild) endRebuild(candidate); else discardUnpublished(candidate); }
      });
    });
  };
  const saveDefinitions = (submitted: DefinitionBundle, signal?: AbortSignal,
    mutation?: { expectedRevision: number; commands: readonly TabCommand[] }, assertMutationCurrent?: () => void) => {
    const bundle = structuredClone(submitted);
    const capturedMutation = mutation && structuredClone(mutation);
    return enqueue(async () => {
      assertMutationCurrent?.();
      await readyTools(); assertActive(); signal?.throwIfAborted();
      const assertState = stateGuard();
      return usingOrdinary(() => { assertState(); assertMutationCurrent?.(); }, signal, async (run, check) => {
        const expectedRevision = capturedMutation?.expectedRevision ?? state.revision;
        const current = await run({ kind: "applyTabDataCommands", args: [state, expectedRevision, []] });
        if (current.$tag === "Err") throw new Error(current._0);
        const definitions = await planDefinitions(state.definitions, bundle);
        check();
        const result = await run({ kind: "applyTabDataCommands", args: [state, expectedRevision,
          [{ $tag: "TabSetDefinitions", definitions }, ...(capturedMutation?.commands ?? [])]] });
        if (result.$tag === "Err") throw new Error(result._0);
        const localValueIds = localSavedValueIds(result._0);
        const representations = await run({ kind: "tabDataRepresentationRows", args: [result._0, ""] });
        const preparationSignal = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
        let candidate: BrowserReaderSnapshot | undefined;
        beginRebuild();
        try {
          candidate = await prepareSnapshot(definitions, representations.map(row => row.instance), preparationSignal, localValueIds);
          const packet = await preparePublication(result._0, candidate, run);
          check();
          publish(result._0, packet, candidate);
          return { snapshot: definitions, root: root() };
        } finally { endRebuild(candidate); }
      });
    });
  };
  const replace = (submitted: LocalTabData, expectedRevision?: number, signal?: AbortSignal) => {
    const next = structuredClone(submitted);
    return enqueue(async () => {
      await readyTools(); assertActive(); signal?.throwIfAborted();
      return usingOrdinary(stateGuard(), signal, async (run, check) => {
        const revision = expectedRevision ?? state.revision;
        const before = await run({ kind: "applyTabDataCommands", args: [state, revision, []] });
        if (before.$tag === "Err") throw new Error(before._0);
        const identity = await run({ kind: "tabDataCheckRoot", args: [next, id] });
        if (identity.$tag === "Err") throw new Error(identity._0);
        const admitted = await run({ kind: "validateTabData", args: [next] });
        if (admitted.$tag !== "Ok" || admitted._0 === undefined || admitted._0 === null)
          throw new Error(admitted.$tag === "Err" ? admitted._0 : "This source's replacement data could not be checked.");
        const localValueIds = localSavedValueIds(admitted._0);
        if (options.clipboard && !await run({ kind: "tabClipboardPreserved", args: [state, admitted._0] }))
          throw new Error("Clipboard stays in This tab. Clear its entries instead.");
        const representations = await run({ kind: "tabDataRepresentationRows", args: [admitted._0, ""] });
        const preparationSignal = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
        let candidate: BrowserReaderSnapshot | undefined;
        beginRebuild();
        try {
          candidate = await prepareSnapshot(admitted._0.definitions, representations.map(row => row.instance), preparationSignal, localValueIds);
          const packet = await preparePublication(admitted._0, candidate, run);
          check();
          publish(admitted._0, packet, candidate);
          return root();
        } finally { endRebuild(candidate); }
      });
    });
  };
  const metadata = (requested: readonly string[] = []): Promise<ReaderMetadataProjection> => {
    read();
    const captured = snapshot;
    if (!captured) throw new Error("This source's editing tools are not ready.");
    const targets = requested.length ? [...requested] : metadataTargets();
    return captured.readMetadata(targets, lifetime.signal).then(result => {
      assertActive();
      if (snapshot !== captured) throw new Error("This reader's metadata snapshot was replaced. Retry with the current data.");
      return result;
    });
  };
  const discard = async (): Promise<boolean> => {
    if (!storage || saving) return !storage;
    try {
      return await enqueue(async () => {
        await readyTools(); assertActive();
        return usingOrdinary(stateGuard(), undefined, async (run, check) => {
          const record = await storage.load(lifetime.signal);
          check();
          const loaded = record?.data ?? await run({ kind: "defaultLocalTabData", args: [id] });
          const restored = options.clipboard ? await run({ kind: "tabDataWithClipboard", args: [loaded] }) : loaded;
          const identity = await run({ kind: "tabDataCheckRoot", args: [restored, id] });
          if (identity.$tag !== "Ok" || identity._0 !== true)
            throw new Error(identity.$tag === "Err" ? identity._0 : "This source's saved identity could not be checked.");
          const admitted = await run({ kind: "browserDataRestoreSnapshot", args: [state, restored] });
          if (admitted.$tag !== "Ok" || !admitted._0)
            throw new Error(admitted.$tag === "Err" ? admitted._0 : "This source's saved data could not be checked.");
          const restoredData = admitted._0;
          const settle = (packet: LocalOrdinaryPublication, published: BrowserReaderSnapshot) => {
            check();
            publish(restoredData, packet, published);
            rememberStored(record, restoredData);
            options.onStorageUncertainty?.(undefined);
            storageUncertainty = undefined;
            failure = undefined; changed();
            return true;
          };
          // The Fenel restoration keeps saved definitions and representations
          // that equal the current ones by identity. As after an ordinary edit,
          // the published reader checked from them stays exact: keep it while
          // it still owns live tools instead of rebuilding the same registry.
          const current = snapshot;
          if (current && restoredData.definitions === state.definitions && restoredData.representations === state.representations
            && retiredTools !== current && !(ownsLocalRealm && current.kind === "local" && workerTools.preparedReaderWorkerClosed(current.worker)))
            return settle(await preparePublication(restoredData, current, run), current);
          const localValueIds = localSavedValueIds(restoredData);
          const representations = await run({ kind: "tabDataRepresentationRows", args: [restoredData, ""] });
          let candidate: BrowserReaderSnapshot | undefined;
          beginRebuild();
          try {
            candidate = await prepareSnapshot(restoredData.definitions, representations.map(row => row.instance), lifetime.signal, localValueIds);
            return settle(await preparePublication(restoredData, candidate, run), candidate);
          } finally { endRebuild(candidate); }
        });
      }, false);
    } catch (problem) {
      if (!lifetime.signal.aborted && epoch === untrack(sessionEpoch)) {
        failure = problem instanceof Error ? problem.message : String(problem); changed();
      }
      return false;
    }
  };
  const dispose = () => {
    if (retiring || lifetime.signal.aborted) return;
    retiring = true;
    // The save flight awaits durable settlement even after its reader cancels.
    // Register it before abort listeners can acquire a successor.
    options.onRetire?.(saving?.then(() => undefined) ?? Promise.resolve());
    lifetime.abort(new DOMException("This browser data source was closed.", "AbortError"));
    releaseReplacement?.(); releaseReplacement = undefined;
    releaseRestoration?.(); releaseRestoration = undefined;
    discardEarlyAuthoringRealm(workerLineage);
    metadataCapture = undefined;
    if (saveFrame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(saveFrame);
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveScheduled = false;
    releaseSession();
    releaseSynchronization();
    options.signal?.removeEventListener("abort", dispose);
    if (snapshot) retireSnapshot(snapshot);
    retiredTools = undefined;
    workerTools?.discardWarmAuthoringRealm(workerLineage);
  };
  releaseSession = onBrowserSessionChange(dispose);
  if (storage && options.synchronization) releaseSynchronization = options.synchronization.register(`browser-data:${id}`, {
    pending, saving: () => { status(); return !!saving; }, error: () => { status(); return failure ?? storageUncertainty; }, save, discard,
  });
  options.signal?.addEventListener("abort", dispose, { once: true });
  if (options.signal?.aborted) dispose();
  // Every ready() caller (each Local client operation, the reader's reload and
  // Retry) also restores a worker that a failed rebuild left retired.
  const retryTools = () => enqueue(async () => {
    if (earlyRealm) earlyRealm = retryEarlyAuthoringRealm(earlyRealm) ?? earlyRealm;
    await ready(); assertActive();
    if (snapshot?.kind === "local" && workerTools.preparedReaderWorkerClosed(snapshot.worker)) retiredTools = snapshot;
    await restoreTools();
    assertActive();
  }, false);
  const restoreClosedTools = () => {
    assertActive();
    if (ownsLocalRealm && snapshot?.kind === "local" && workerTools.preparedReaderWorkerClosed(snapshot.worker)) retiredTools = snapshot;
    return restoreTools();
  };
  const readyTools = () => ready().then(() => restoreClosedTools());
  const toolsSettled = async () => {
    while (rebuildSettled) { await rebuildSettled.promise; assertActive(); }
    await readyTools();
    assertActive();
  };
  const sourceHandle: LocalTabSource = { id, epoch, firstPaint, readReady, ready: readyTools, toolsSettled, retryTools, snapshot: () => {
      read();
      if (!snapshot) throw new Error("This source's editing tools are not ready.");
      return snapshot;
    }, state: read, root, savedValues, metadataTargets, metadata, captureSourceMetadata,
    revision: () => { assertActive(); version(); return state?.revision ?? initialState?.revision ?? 0; }, project, ordinary, transact, saveDefinitions, replace, retainClipboard, ingestExternal, dispose };
  if (!options.prepareSnapshot && !options.retireSnapshot)
    bindCoreAuthoringOwner(sourceHandle, workerLineage, epoch, lifetime.signal);
  return sourceHandle;
}

/** Local endpoint transport: an unsupported request cannot fall through to HTTP. */
export function createLocalApiClient(source: LocalTabSource, options: { accountId?: string; readFallback?: ApiClient } = {}): ApiClient {
  const lifetime = new AbortController();
  const assertActive = () => { assertCurrentSession(source.epoch); lifetime.signal.throwIfAborted(); };
  const local = <T>(operation: () => T | Promise<T>, readOnly = false): Promise<T> => {
    assertActive(); source.revision();
    // Root and saved-value reads may paint the provisional empty tab first;
    // every other operation waits for the worker's tools as before.
    return (readOnly ? source.firstPaint() : source.ready()).then(() => { assertActive(); return operation(); }).then(result => { assertActive(); return result; });
  };
  const refused = (operation: string) => { assertActive(); throw new Error(`${operation} is unavailable in ${options.accountId ? "this data source" : "This tab"}.`); };
  const query = <A extends unknown[], T>(name: string, operation: (...args: A) => T | Promise<T>, readOnly = false) => {
    const fn = (...args: A) => local(() => operation(...args), readOnly);
    return Object.assign(fn, { uncached: fn, key: `local:${source.epoch}:${source.id}:${name}`,
      keyFor: (...args: A) => [`local:${source.epoch}:${source.id}:${name}`, args] });
  };
  const getLocusRoot = query("locusRoot", () => ({ root: source.root() }), true);
  const getSavedQueries = query("savedQueries", () => ({ queries: source.savedValues(), categories: [] }), true);
  const getDispatchInstances = query("dispatchInstances", async (typeName?: string) => ({
    dispatchInstances: await source.ordinary({ kind: "tabDataRepresentationRows", args: [source.state(), typeName ?? ""] }, lifetime.signal),
  }));
  const definitionDtos = async <T extends { id: string }>(rows: readonly T[], captured = source.snapshot()) => {
    const { readerPresentationDto } = await import("./reader-presentation");
    assertActive();
    const projected = rows.length ? await captured.readPresentations(rows.map(row => row.id), lifetime.signal) : [];
    assertActive();
    if (source.snapshot() !== captured) throw new Error("This reader's metadata snapshot was replaced. Retry with the current data.");
    const presentations = new Map(projected.map(entry => [entry.target, entry.presentation]));
    return rows.map(row => ({ ...row, ...readerPresentationDto(presentations.get(row.id) ?? {}) }));
  };
  const definitionDto = async <T extends { id: string }>(row: T, captured = source.snapshot()) =>
    (await definitionDtos([row], captured))[0]!;
  const getTypes = query("types", async () => {
    const captured = source.snapshot();
    return { types: await definitionDtos(captured.types, captured) };
  });
  const catalogRow = (row: Awaited<ReturnType<typeof queryLocalFieldAuthoringIdentity>>["field"]) => {
    if (!row || !options.accountId || row.realm !== "local") return row;
    const { sourceId: _sourceId, ...accountRow } = row;
    return { ...accountRow, realm: "account" as const,
      reuseVisibility: row.reuseVisibility === "local" ? "account" as const : row.reuseVisibility };
  };
  const queryReaderFields = async <P extends AuthoringReaderFieldQuery>(captured: BrowserReaderSnapshot,
    payload: P): Promise<AuthoringReaderFieldResults[P["method"]]> => {
    const workers = await import("./expression-runner/authoring-catalog-worker");
    const assertSnapshot = () => {
      assertActive();
      if (source.snapshot() !== captured) throw new Error("This reader's field snapshot was replaced. Retry with the current data.");
    };
    assertSnapshot();
    // B4 wave 4 lane S: a Local snapshot's own worker answers (never a
    // lookup through its page session); an account draft keeps its session's.
    const workerOf = () => captured.kind === "local"
      ? workers.preparedReaderWorkerClosed(captured.worker) ? undefined : captured.worker
      : workers.preparedReaderWorkerForSession(captured.session);
    const handle = workerOf();
    if (!handle) throw new Error("This reader's field catalogue worker is unavailable.");
    const result = await workers.runPreparedReaderWorker(handle, payload, lifetime.signal);
    assertSnapshot();
    if (workerOf() !== handle)
      throw new Error("This reader's field worker was replaced. Retry with the current data.");
    const packet = result as Record<string, unknown>;
    if (!result || typeof result !== "object" || Array.isArray(result)
      || (payload.method === "query-reader-field-facets"
        ? !Object.hasOwn(result, "dispatchInstances") || !Array.isArray(packet.dispatchInstances)
        : payload.method === "query-reader-field-identity"
        ? !Object.hasOwn(result, "field")
        : !Object.hasOwn(result, "fields") || !Array.isArray(packet.fields)
          || (payload.method === "query-reader-field-catalog"
            ? !Object.hasOwn(result, "facetInterfaceNames") || !Array.isArray(packet.facetInterfaceNames)
            : Object.hasOwn(result, "facetInterfaceNames"))))
      throw new Error("This reader's field catalogue result could not be read.");
    return result as AuthoringReaderFieldResults[P["method"]];
  };
  const getFieldAuthoringCatalog = (search = "", cursor?: string) => local(async () => {
    const result = options.accountId
      ? await queryLocalFieldAuthoringCatalog(source.id, source.state().definitions, { search, cursor })
      : await queryReaderFields(source.snapshot(), { method: "query-reader-field-catalog", query: { search, cursor } });
    assertActive();
    return { ...result, fields: result.fields.map(row => catalogRow(row)!) };
  });
  const getFieldAuthoringIdentity = (fieldId: string) => local(async () => {
    const result = options.accountId
      ? await queryLocalFieldAuthoringIdentity(source.id, source.state().definitions, fieldId)
      : await queryReaderFields(source.snapshot(), { method: "query-reader-field-identity", fieldId });
    assertActive();
    return { field: catalogRow(result.field) };
  });
  const getFieldResurrectionCatalog = (target: FieldResurrectionOwnerTarget) => local(() => options.accountId
    ? queryLocalFieldResurrectionCatalog(source.id, source.state().definitions, target)
    : queryReaderFields(source.snapshot(), { method: "query-reader-field-resurrections", target }));
  const getFieldFacetInstances = () => local(() => options.accountId
    ? { dispatchInstances: source.snapshot().registry.listFieldRepresentations()
      .map(instance => ({ typeName: instance.typeName, args: instance.args, instance })) }
    : queryReaderFields(source.snapshot(), { method: "query-reader-field-facets" }));
  const getFunctions = query("functions", async () => {
    const captured = source.snapshot();
    return { functions: await definitionDtos(captured.functionRows, captured) };
  });
  /** B4 unit E: a Local snapshot answers in its own worker. Its reply holds
   * only for the snapshot it was asked of (fail closed, no page fallback). */
  const assertCapturedSnapshot = (captured: BrowserReaderSnapshot) => {
    assertActive();
    if (source.snapshot() !== captured) throw new Error("This reader's definitions were replaced. Retry with the current data.");
  };
  const definitionLookup = async (captured: LocalReaderSnapshot, name: string) => {
    const [entry] = await captured.readReferences([name], lifetime.signal);
    assertCapturedSnapshot(captured);
    return entry?.reference?.definition;
  };
  const getTypeByName = query("definition", async (name: string) => {
    const snapshot = source.snapshot();
    const type = snapshot.kind === "local" ? (await definitionLookup(snapshot, name))?.entity : snapshot.registry.getIdentifiedEntity(name);
    if (!type) return { definition: null };
    // B3: retain the checked source row's owner coordinates for Home authoring.
    // Repository definitions are inspectable, but have no writable tab owner.
    const row = snapshot.types.find(candidate => candidate.id === type.id || candidate.name === type.id);
    return { definition: await definitionDto(row ? { ...row, id: options.accountId ? row.id : type.id } : { id: type.id, name: type.id, type: type.type, isSystem: true }, snapshot) };
  });
  const getFunctionByName = query("functionByName", async (name: string) => {
    const snapshot = source.snapshot();
    const fn = snapshot.kind === "local" ? (await definitionLookup(snapshot, name))?.fn : snapshot.registry.getFunction(name);
    if (!fn) return { definition: null };
    const row = snapshot.functionRows.find(candidate => candidate.function.id === fn.id);
    return { definition: await definitionDto(row ? { ...row, id: options.accountId ? row.id : fn.id } : { id: fn.id, name: fn.id, function: fn, isSystem: true }, snapshot) };
  });
  const entryCommand = (command: LocusRootCommand) => source.ordinary({ kind: "tabDataRootCommand", args: [command] }, lifetime.signal);
  const definitionsChanged = "This tab's definitions changed before this representation edit. Reload it and try again.";
  /** B4 unit E: one worker encoding per Local snapshot owner (a restored
   * worker keeps its owner and definitions); it is also the write's token. */
  const encodings = new WeakMap<PreparedSnapshotOwner, ReaderInstanceEncoding>();
  const instanceEncoding = (): ReaderInstanceEncoding => {
    assertActive();
    const captured = source.snapshot();
    if (captured.kind !== "local") throw new Error(`Instance encoding is unavailable in ${options.accountId ? "this data source" : "This tab"}.`);
    const owner = captured.owner;
    let encoding = encodings.get(owner);
    if (!encoding) {
      let created!: ReaderInstanceEncoding;
      created = encoding = Object.freeze({ encodeInstances: (instances: readonly Record<string, unknown>[], valueEncoding: InstanceJsonEncoding) => {
        const submitted = structuredClone(instances.map(instance => ({ instance, valueEncoding })));
        return local(async () => {
          await source.toolsSettled();
          assertActive();
          const current = source.snapshot();
          if (current.kind !== "local" || current.owner !== owner) throw new Error(definitionsChanged);
          const encoded = await current.convertInstances("encode-reader-instances", submitted, lifetime.signal);
          assertCapturedSnapshot(current);
          return encoded;
        });
      }, decodeInstances: (instances: readonly { instance: Record<string, unknown>; valueEncoding?: InstanceJsonEncoding }[]) => {
        const submitted = structuredClone(instances);
        // This encoding is the token: new definitions refuse, as for writes.
        return local(async () => await decodeInstances(submitted, created) as unknown as Record<string, unknown>[]);
      } });
      encodings.set(owner, encoding);
    }
    return encoding;
  };
  /** Decode submitted instance wire data with this source's definitions. */
  const decodeInstances = async (submitted: readonly { instance: Record<string, unknown>; valueEncoding?: InstanceJsonEncoding }[],
    encodingRegistry?: RepresentationEncoding): Promise<InstanceDraft[]> => {
    assertActive();
    let captured = source.snapshot();
    if (captured.kind === "local") {
      // An earlier edit's rebuild retires the published worker first: wait for
      // its publication (or restoration) and decode with that worker instead.
      await source.toolsSettled();
      assertActive();
      captured = source.snapshot();
    }
    if (captured.kind === "local") {
      if (encodingRegistry !== undefined && encodingRegistry !== encodings.get(captured.owner)) throw new Error(definitionsChanged);
      const decoded = await captured.convertInstances("decode-reader-instances", submitted.map(input => ({ instance: input.instance,
        ...(input.valueEncoding === undefined ? {} : { valueEncoding: input.valueEncoding }) })), lifetime.signal);
      assertCapturedSnapshot(captured);
      return decoded as unknown as InstanceDraft[];
    }
    const { instanceFromJsonWire } = await import("@fenel/engine/authoring/type");
    assertActive();
    const registry = source.snapshot().registry;
    if (encodingRegistry !== undefined && encodingRegistry !== registry) throw new Error(definitionsChanged);
    return submitted.map(input => instanceFromJsonWire(input.instance, registry, undefined, input.valueEncoding) as InstanceDraft);
  };
  /** Decode submitted representation writes into this source's one edit command. */
  const representationCommands = async (submitted: RepresentationWrites, encodingRegistry?: RepresentationEncoding): Promise<TabCommand[]> => {
    const decoded = await decodeInstances(submitted, encodingRegistry);
    const commands = submitted.map((input, index) => {
      const instance = options.accountId ? decoded[index]! : { ...decoded[index]!, scope: { kind: "tag" as const, tag: source.id } };
      const row: LocalRepresentationRow = { id: input.existingId ?? crypto.randomUUID(),
        typeName: instance.typeName, args: instance.args, instance };
      return input.existingId === undefined
        ? { $tag: "LocusAppend", entry: { id: row.id, value: row } }
        : { $tag: "LocusReplace", id: row.id, entry: { id: row.id, value: row } };
    });
    return commands.length ? [{ $tag: "TabEditRepresentations", commands }] : [];
  };
  const write = (commands: readonly TabCommand[], revision?: number, publication?: RootPublicationOptions) =>
    source.transact(commands, revision, lifetime.signal, publication);
  type SavedQueryKey = { $tag: "Ok"; _0: string } | { $tag: "Err"; _0: string };
  /** B3 only: reuse exact native transport admission/keying, never JSON storage
   * normalization. The immutable key is captured before any caller-data clone. */
  const savedQueryKey = (value: unknown): SavedQueryKey => {
    const context = "Local saved-query baseline";
    let observation: ReturnType<typeof captureRegistryTransportObservation> | undefined;
    try {
      observation = captureRegistryTransportObservation(value, context);
      if (observation.kind === "unsupported") return { $tag: "Err", _0: observation.reason };
      const captured = captureRegistryTransportKey(value, context, "value-read");
      observation.assertCurrent();
      return { $tag: "Ok", _0: captured.key };
    } catch (error) { return { $tag: "Err", _0: error instanceof Error ? error.message : String(error) }; }
    finally { if (observation?.kind === "captured") observation.release(); }
  };
  /** B3 receipt shape only; inherited fields and accessors carry no receipt. */
  const savedQueryReceiptSlot = (value: unknown, key: "$tag" | "_0") => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const slot = Object.getOwnPropertyDescriptor(value, key);
    return slot && Object.hasOwn(slot, "value") ? slot : undefined;
  };
  const withSavedQueryCurrent = async <T>(id: string, expected: SavedQueryKey | undefined,
    save: (assertMutationCurrent?: () => void) => Promise<T>): Promise<T> => {
    if (expected === undefined) return save();
    const capturedState = source.state(), capturedSnapshot = source.snapshot();
    const observation = captureRegistryTransportObservation(capturedState, "Local checked saved-query source");
    const assertCurrent = () => {
      assertActive();
      if (source.state() !== capturedState || source.snapshot() !== capturedSnapshot)
        throw new Error("This tab data changed before this edit. Reload it and try again.");
      if (observation.kind === "captured") observation.assertCurrent();
    };
    try {
      assertCurrent();
      let current: SavedQueryKey;
      if (observation.kind === "unsupported") current = { $tag: "Err", _0: observation.reason };
      else {
        const baseline = await source.ordinary({ kind: "tabDataSavedQueryBaseline", args: [capturedState, id] }, lifetime.signal);
        assertCurrent();
        // Ordinary transport reattaches this existing query to its ORIGINAL
        // source node; obtain its key here, before another native serialization.
        const tag = savedQueryReceiptSlot(baseline, "$tag"), payload = savedQueryReceiptSlot(baseline, "_0");
        current = tag?.value === "Err" && payload && typeof payload.value === "string"
          ? { $tag: "Err", _0: payload.value }
          : tag?.value === "Ok" && payload ? savedQueryKey(payload.value)
          : { $tag: "Err", _0: "This saved query baseline could not be read." };
      }
      const checked = await source.ordinary({ kind: "tabDataCheckSavedQueryKeys", args: [expected, current] }, lifetime.signal);
      assertCurrent();
      const checkedTag = savedQueryReceiptSlot(checked, "$tag"), checkedPayload = savedQueryReceiptSlot(checked, "_0");
      if (checkedTag?.value !== "Ok" || checkedPayload?.value !== true)
        throw new Error(checkedTag?.value === "Err" && typeof checkedPayload?.value === "string"
          ? checkedPayload.value : "This saved query baseline could not be checked.");
      // Same-revision replacement is possible. Retain exact state/snapshot and
      // graph observations through queued admission and final publication.
      return await save(assertCurrent);
    } finally { if (observation.kind === "captured") observation.release(); }
  };
  const writeSavedQuery = (id: string, commands: readonly TabCommand[], revision: number | undefined,
    expected: SavedQueryKey | undefined) => withSavedQueryCurrent(id, expected,
      assertMutationCurrent => source.transact(commands, revision, lifetime.signal, undefined, assertMutationCurrent));
  const api = new Proxy({
    savedQueryCreate: async (data: Omit<LocalSavedValueRow, "id">) => {
      assertActive(); await source.ready(); assertActive();
      const row = { ...data, id: crypto.randomUUID() };
      await write([{ $tag: "TabEditValues", commands: [{ $tag: "LocusAppend", entry: { id: row.id, value: row } }] }]);
      assertActive();
      return { query: row };
    },
    savedQueryUpdate: async (id: string, patch: Partial<Omit<LocalSavedValueRow, "id">> & { expectedQuery?: Record<string, unknown> }) => {
      const authoredRevision = source.revision();
      assertActive();
      const precondition = Object.getOwnPropertyDescriptor(patch, "expectedQuery");
      if (precondition && !Object.hasOwn(precondition, "value"))
        throw new Error("This saved query baseline could not be read.");
      const expected = precondition?.value === undefined ? undefined : savedQueryKey(precondition.value);
      // Preserve object-rest metadata reads, but never read the control itself.
      const authored: Record<string, unknown> = {};
      for (const key of Reflect.ownKeys(patch)) {
        if (key === "expectedQuery") continue;
        if (Object.getOwnPropertyDescriptor(patch, key)?.enumerable)
          Object.defineProperty(authored, key, Object.setPrototypeOf({ value: Reflect.get(patch, key), enumerable: true, writable: true, configurable: true }, null));
      }
      const submitted = structuredClone(authored);
      assertActive(); await source.ready(); assertActive();
      await writeSavedQuery(id, [{ $tag: "TabPatchValue", id, patch: submitted }], authoredRevision, expected);
      assertActive();
      const { peelMaybeValue } = await import("@fenel/engine/type-foundation");
      assertActive();
      return { query: peelMaybeValue(await source.ordinary({ kind: "tabDataValue", args: [source.state(), id] }, lifetime.signal)) ?? null };
    },
    savedQueryDelete: (id: string, expectedQuery?: Record<string, unknown>) => {
      assertActive();
      const authoredRevision = source.revision();
      const expected = expectedQuery === undefined ? undefined : savedQueryKey(expectedQuery);
      return local(async () => {
        await writeSavedQuery(id, [{ $tag: "TabEditValues", commands: [{ $tag: "LocusRemove", id }] }],
          expected === undefined ? undefined : authoredRevision, expected);
        return {};
      });
    },
    definitionBundleSave: (bundle: DefinitionBundle) => local(() => source.saveDefinitions(bundle, lifetime.signal)),
    locusViewUpdate: (id: string, patch: { name?: string; view?: Record<string, unknown>; active?: boolean; expectedRootRevision?: number }) => {
      const submitted = structuredClone(patch);
      return local(async () => {
      const command = await source.ordinary({ kind: "browserDataListCommand", args: [id, submitted] }, lifetime.signal);
      await write([command], submitted.expectedRootRevision);
      assertActive();
      const { peelMaybeValue } = await import("@fenel/engine/type-foundation");
      assertActive();
      return { locusView: peelMaybeValue(await source.ordinary({ kind: "browserDataList", args: [source.state(), id] }, lifetime.signal)) ?? null };
    }); },
    readerMetadata: (targets: readonly string[]) => local(() => source.metadata(targets)),
    dispatchInstanceCreate: async (input: { typeName: string; args: unknown[]; instance: Record<string, unknown>; valueEncoding?: InstanceJsonEncoding }) => {
      assertActive(); await source.ready(); assertActive();
      const decoded = (await decodeInstances([{ instance: input.instance, valueEncoding: input.valueEncoding }]))[0]!;
      assertActive();
      const instance = options.accountId ? decoded : { ...decoded, scope: { kind: "tag" as const, tag: source.id } };
      const row: LocalRepresentationRow = { id: crypto.randomUUID(), typeName: input.typeName, args: input.args, instance };
      await write([{ $tag: "TabEditRepresentations", commands: [{ $tag: "LocusAppend", entry: { id: row.id, value: row } }] }]);
      assertActive();
      return { dispatchInstance: row };
    },
    dispatchInstanceUpdate: async (id: string, input: Record<string, unknown>, valueEncoding?: InstanceJsonEncoding) => {
      assertActive(); await source.ready(); assertActive();
      const decoded = (await decodeInstances([{ instance: input, valueEncoding }]))[0]!;
      assertActive();
      const instance = options.accountId ? decoded : { ...decoded, scope: { kind: "tag" as const, tag: source.id } };
      const row: LocalRepresentationRow = { id, typeName: instance.typeName, args: instance.args, instance };
      await write([{ $tag: "TabEditRepresentations", commands: [{ $tag: "LocusReplace", id, entry: { id, value: row } }] }]);
      assertActive();
      return { dispatchInstance: row };
    },
    dispatchInstanceDelete: (id: string) => local(async () => {
      await write([{ $tag: "TabEditRepresentations", commands: [{ $tag: "LocusRemove", id }] }]);
      return {};
    }),
  }, { get: (target, name) => Reflect.has(target, name) ? Reflect.get(target, name)
    : typeof name !== "string" || name === "then" ? undefined : () => refused(name) });
  const readEndpoint = (path: string): Promise<unknown> => {
    const url = new URL(path, "https://this-tab.invalid");
    switch (url.pathname) {
      case "/locus-root": return getLocusRoot();
      case "/saved-queries": return getSavedQueries();
      case "/dispatch-instances": return getDispatchInstances(url.searchParams.get("typeName") ?? undefined);
      case "/definition-bundles": return local(() => ({ snapshot: source.state().definitions }));
      case "/definition-bundles/catalog": return getFieldAuthoringCatalog(url.searchParams.get("q") ?? "", url.searchParams.get("cursor") ?? undefined);
      case "/definition-bundles/resurrections": return getFieldResurrectionCatalog({ ownerKey: url.searchParams.get("ownerKey") ?? "",
        ownerKind: url.searchParams.get("ownerKind") as "type" | "function", storageName: url.searchParams.get("storageName") ?? "" });
      case "/modules/installed": return local(() => options.readFallback?.apiRead(path) ?? { modules: [] });
      case "/types": return getTypes();
      case "/functions": return getFunctions();
      case "/reader-metadata/targets": return local(() => ({ targets: source.metadataTargets() }));
      default:
        if (url.pathname.startsWith("/definition-bundles/catalog/")) return getFieldAuthoringIdentity(decodeURIComponent(url.pathname.slice("/definition-bundles/catalog/".length)));
        return Promise.reject(new Error(`${url.pathname} is unavailable in ${options.accountId ? "this data source" : "This tab"}.`));
    }
  };
  const client = {
    accountId: options.accountId, rootId: source.id, epoch: source.epoch, signal: lifetime.signal,
    dispose: () => lifetime.abort(new DOMException("This local reader was closed.", "AbortError")),
    revalidate: () => {}, clearFieldAuthoringCaches: () => {},
    writeDispatchInstances: (writes: RepresentationWrites, expectedRevision: number,
      encodingRegistry?: RepresentationEncoding) => {
      assertActive();
      const submitted = structuredClone(writes);
      return local(async () => {
        const commands = await representationCommands(submitted, encodingRegistry);
        await write(commands, expectedRevision);
      });
    },
    ...(!options.accountId ? { instanceEncoding } : {}),
    getLocusRoot, getSavedQueries, getTypes, getFunctions, getTypeByName, getFunctionByName, getDispatchInstances,
    getBrowseTypes: getTypes, getBrowseFunctions: getFunctions,
    getFieldFacetInstances,
    getLocusViews: query("locusViews", () => ({ locusViews: source.root().lists })),
    getActiveLocusView: query("activeLocusView", async () => {
      if (!options.accountId) return { locusView: null };
      const { peelMaybeValue } = await import("@fenel/engine/type-foundation");
      assertActive();
      return { locusView: peelMaybeValue(await source.ordinary({ kind: "browserDataActiveList", args: [source.state()] }, lifetime.signal)) ?? null };
    }),
    getViews: query("views", () => options.readFallback?.getViews() ?? { views: [] }),
    getFunctionTriggers: query("functionTriggers", (functionId: string) => options.readFallback?.getFunctionTriggers(functionId) ?? { triggers: [] }),
    getFieldAuthoringCatalog, getFieldAuthoringIdentity, getFieldResurrectionCatalog,
    editLocusRoot: (id: string, revision: number, command: LocusRootCommand, publication?: RootPublicationOptions) => {
      const submitted = structuredClone(command);
      return local(async () => {
      const admitted = await source.ordinary({ kind: "tabDataCheckRoot", args: [source.state(), id] }, lifetime.signal);
      if (admitted.$tag === "Err") throw new Error(admitted._0);
      return { root: await write([await entryCommand(submitted)], revision, publication) };
    }); },
    ...(!options.accountId ? { ingestExternal: (captured: TransferSnapshot,
      ingress?: Parameters<LocalTabSource["ingestExternal"]>[1]) => {
      assertActive();
      return source.ingestExternal(captured, { ...ingress, signal: ingress?.signal
        ? AbortSignal.any([lifetime.signal, ingress.signal]) : lifetime.signal });
    } } : {}),
    editSavedValue: (id: string, query: Record<string, unknown>, revision: number, occurrence?: LocusRootCommand,
      expectedQuery?: Record<string, unknown>) => {
      const expected = expectedQuery === undefined ? undefined : savedQueryKey(expectedQuery);
      const submitted = structuredClone({ query, occurrence });
      return local(async () => ({ root: await writeSavedQuery(id, [{ $tag: "TabPatchValue", id, patch: { query: submitted.query } },
        ...(submitted.occurrence ? [await entryCommand(submitted.occurrence)] : [])], revision, expected) }));
    },
    editDefinitionAndData: (bundle: DefinitionBundle, revision: number,
      mutation: { occurrence?: LocusRootCommand; savedValue?: { id: string; query: Record<string, unknown>; expectedQuery?: Record<string, unknown> };
        representations?: RepresentationWrites; encodingRegistry?: RepresentationEncoding } = {}) => {
      // Capture the caller's snapshot revision before waiting for preparation.
      const expectedRevision = revision;
      // Preserve object-rest's own-enumerable admission, capturing this one
      // field once before bundle cloning can normalize or mutate its baseline.
      const savedValueSlot = Object.getOwnPropertyDescriptor(mutation, "savedValue");
      const savedValue = savedValueSlot?.enumerable ? mutation.savedValue : undefined;
      const precondition = savedValue ? Object.getOwnPropertyDescriptor(savedValue, "expectedQuery") : undefined;
      if (precondition && !Object.hasOwn(precondition, "value"))
        throw new Error("This saved query baseline could not be read.");
      const expected = precondition?.value === undefined ? undefined : savedQueryKey(precondition.value);
      const submittedBundle = structuredClone(bundle);
      const encodingRegistry = mutation.encodingRegistry;
      const data: Omit<typeof mutation, "encodingRegistry" | "savedValue"> = {};
      // Retain the other object-rest metadata reads without reading savedValue
      // a second time or consulting an inherited __proto__ setter.
      for (const key of Reflect.ownKeys(mutation)) {
        if (key === "encodingRegistry" || key === "savedValue") continue;
        if (Object.getOwnPropertyDescriptor(mutation, key)?.enumerable)
          Object.defineProperty(data, key, Object.setPrototypeOf({ value: Reflect.get(mutation, key), enumerable: true, writable: true, configurable: true }, null));
      }
      // Keep unreadable controls off the native clone's traversal, then let the
      // existing Fenel guard refuse them in its original order. Admitted or
      // omitted controls retain the native carrier's fields, graph and refusals;
      // only id/query are projected into the saved-data command below.
      const submittedMutation = structuredClone({ ...data,
        savedValue: savedValue && expected?.$tag === "Err" ? { id: savedValue.id, query: savedValue.query } : savedValue });
      return local(async () => {
        const representations = submittedMutation.representations?.length
          ? await representationCommands(submittedMutation.representations, encodingRegistry) : [];
        assertActive();
        const commands: TabCommand[] = [
          ...representations,
          ...(submittedMutation.savedValue ? [{ $tag: "TabPatchValue", id: submittedMutation.savedValue.id, patch: { query: submittedMutation.savedValue.query } }] : []),
          ...(submittedMutation.occurrence ? [await entryCommand(submittedMutation.occurrence)] : []),
        ];
        const save = (assertMutationCurrent?: () => void) =>
          source.saveDefinitions(submittedBundle, lifetime.signal, { expectedRevision, commands }, assertMutationCurrent);
        return submittedMutation.savedValue ? withSavedQueryCurrent(submittedMutation.savedValue.id, expected, save) : save();
      });
    },
    api,
    apiRead: (path: string) => { assertActive(); return readEndpoint(path); },
    apiFetch: (path: string, init?: RequestInit) => {
      assertActive();
      if (init?.method && init.method !== "GET") return local(() => refused(path));
      return readEndpoint(path);
    },
  };
  const readFallbackKeys = new Set([
    "getStats", "getProfiles", "getProfile", "getEvents", "getPurchases", "getInventory", "getFunctionInstances",
    "getFunctionInstancesById", "getFunctionStatsById", "getFunctionLiveCounts", "getInstanceTimeline", "getTypeActivity",
    "getItems", "getItem", "getPlans", "getPlan", "getChannels", "getProxyLinks", "getProxyLinkStats", "getEmailTemplates",
    "getAccount", "getAnalyticsTimeseries", "getAnalyticsSummary", "getIntegrations", "getPages", "getPageDetail",
    "getView", "getEntityInstances", "queryEntities", "getQuerySchema",
  ]);
  const fallbackReads = new Map<string, unknown>();
  const fallbackRead = (name: string) => {
    if (!fallbackReads.has(name)) {
      const callback = Reflect.get(options.readFallback!, name) as (...args: unknown[]) => unknown;
      fallbackReads.set(name, query(name, (...args: unknown[]) => callback(...args)));
    }
    return fallbackReads.get(name);
  };
  const scopedClient = new Proxy(client, { get: (target, name) => Reflect.has(target, name) ? Reflect.get(target, name)
    : typeof name !== "string" || name === "then" || name === "drafts" ? undefined
      : options.readFallback && readFallbackKeys.has(name) ? fallbackRead(name) : () => refused(name) }) as unknown as ApiClient;
  inheritCoreAuthoringOwner(scopedClient, source, scopedClient.signal);
  return scopedClient;
}
