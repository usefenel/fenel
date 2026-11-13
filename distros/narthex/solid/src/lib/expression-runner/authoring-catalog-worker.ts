import { reserveEarlyAuthoringRealm, spawnAuthoringTransport, acquireEarlyAuthoringPreparation, bindAuthoringTransport, disposeEarlyAuthoringTransports, repositoryAuthoringRealmOwner, findLocalOrdinaryTransport } from "./authoring-catalog-early-realm";
import { requestAuthoringTransport, reserveAuthoringInitialization, controlAuthoringTransport,
  retireAuthoringTransport, observeAuthoringTransport, WorkerRequestError,
  type AuthoringWorkerTransport, type InitializationReservation } from "./authoring-worker-transport";
export { AUTHORING_JOB_ALLOWANCE_MS, AUTHORING_INITIALIZATION_ALLOWANCE_MS, AUTHORING_EVALUATION_ALLOWANCE_MS } from "./authoring-worker-transport";
import { createSignal } from "solid-js";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import type { AuthoringCatalogSnapshot, AuthoringExpectedType, AuthoringSuggestionOptions, AuthoringFunctionSuggestion } from "@fenel/engine/authoring/environment";
import type { AuthoringFunctionEntry, ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelFunction, FenelType } from "@fenel/engine/types";
import type { InstanceDraft } from "../instances/instance-draft";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { closeRegistryPreparationWorker, registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import { acquireRegistryPreparationWorker, checkRegistryPreparationBuild, throwRegistryPreparationFailure, type RegistryPreparationLease,
  type RegistryPreparationRunControl } from "../../../../../../implementations/typescript/engine/src/field-identity-worker-client";
import { AUTHORING_BUILD_IDENTITY } from "./authoring-build-identity";
import type { SourceModuleDocument } from "@fenel/engine/authoring/source-module";
import { registerCatalogEntities, registerIdentifiedCatalogEntity, type CatalogSection } from "@fenel/engine";
import { prepareEngineBodyDispatch } from "@fenel/engine/engine-bodies-dispatch";
import { concreteAuthoringSession, localAuthoringScopeForSession, type AccountAuthoringScope, type ReaderAuthoringScope, type AuthoringSession } from "./account-authoring-session";
import type { AuthoringExpressionEvaluation, AuthoringExpressionAdmittedEvaluation, AuthoringFunctionBodySaveIssue, AuthoringWorkerPayload, AuthoringWorkerCommand, AuthoringWorkerResult, DataSuggestionWorkerOptions,
  ExpressionAdmissionInput, ExpressionInferenceItem, ExpressionInferenceReply, ExpressionSaveIssueInput } from "./authoring-worker-protocol";
import { LIVE_INFERENCE_BATCH_LIMIT } from "./live-guidance-limits";
import type { DataSuggestionInput, DataSuggestionBatch, DataSuggestion, DataSuggestionPreparation } from "../data-suggestions";
import { onBrowserSessionChange, sessionEpoch, assertCurrentSession } from "../browser-session";
import { installPreparedWorkspaceCatalog } from "../workspace-catalog";
import { accountFieldRegistryState } from "../account-field-registry";
import { retainCheckedRepositoryNamespaces, clearCheckedRepositoryNamespaces } from "../repository-namespaces";
import { assertReaderSourceMetadata, captureReaderSourceMetadata } from "../reader-source-metadata";
import { authoringExpressionSourceEntries, reachedSavedSources } from "./expression-evaluation";
import { savedExpressionDeclaration, savedExpressionDeclarationEntries } from "../saved-expression-map";
import { markLocalRegistryToken } from "../local-registry-token";
export { checkedRepositoryNamespaces } from "../repository-namespaces";

type Context = { id: number; sourceModule?: string; scope?: ReaderAuthoringScope; configured: boolean;
  catalog?: AuthoringCatalogSnapshot; readerHandle?: PreparedReaderWorker };
declare const preparedReaderWorkerBrand: unique symbol;
/** Host transport identity only; neither a registry nor a Fenel authority. */
export type PreparedReaderWorker = { readonly [preparedReaderWorkerBrand]: true };
declare const preparedSnapshotOwnerBrand: unique symbol;
/** Host identity of one prepared Local snapshot: it routes its sessions to its
 * worker in place of the page registry. A restoration keeps the same owner. */
export type PreparedSnapshotOwner = { readonly [preparedSnapshotOwnerBrand]: true };
declare const localRegistryPreparationOwnerBrand: unique symbol;
/** Host identity of one Local initialization, available before publication.
 * Its private binding cannot follow a catalogue object reused by another build. */
export type LocalRegistryPreparationOwner = { readonly [localRegistryPreparationOwnerBrand]: true };
/** A Local snapshot owner, or the registry for account, public and detached sessions. */
type WorkerOwner = PreparedSnapshotOwner | ModuleRegistry;
type Client = {
  transport: AuthoringWorkerTransport; accountId?: string; localSourceId?: string; epoch: number; independent: boolean; closed: boolean; nextContext: number;
  /** Lane S: a public (repository-only) worker; its realm answers repository preparation steps. */
  repositoryOnly?: boolean;
  /** W1: the Local holder whose successive snapshots may reuse this realm. */
  lineage?: object;
  contexts: WeakMap<AuthoringSession, Context>;
  transportCleanup?: () => void; unbindTransport?: () => void;
  catalog?: AuthoringCatalogSnapshot; displayCatalog?: CatalogSection[];
  baseContext?: Context;
  preparationCleanup?: () => void;
  preparationPhase: "preparing" | "attached";
  initializationId?: number;
  preparationLeases: Set<() => void>;
  retirementDrained?: Promise<void>;
  successorClaim?: { valid: boolean; adopted?: boolean };
};
const activeClients = new Set<Client>();
const localRegistryPreparations = new WeakMap<LocalRegistryPreparationOwner, { client: Client; initializationId: number }>();
const byCatalog = new WeakMap<AuthoringCatalogSnapshot, Client>();
const byOwner = new WeakMap<WorkerOwner, Client>();
const sessionOwners = new WeakMap<AuthoringSession, PreparedSnapshotOwner>();
/** Registries whose worker is reached only through a Local snapshot owner. */
const ownedRegistries = new WeakSet<ModuleRegistry>();
const bySession = new WeakMap<AuthoringSession, Client>();
const preparedReaderWorkers = new WeakMap<PreparedReaderWorker, { client: Client; context: Context }>();
const preparedReaderMethods: Readonly<Record<AuthoringWorkerPayload["method"], true>> = Object.freeze({
  "analyze-transfer": true, "adapt-transfer": true, "evaluate-expression": true,
  "discover-data-suggestions": true, "prepare-data-suggestion": true, "rank-suggestions": true,
  "infer-function-draft": true, "function-body-save-issue": true, "expression-save-issue": true, "infer-expression": true, "project-reader-types": true,
  "project-reader-metadata": true, "project-reader-presentations": true,
  "project-reader-type-preview": true, "project-reader-field-plan": true,
  "decode-reader-numeric-text": true, "encode-reader-numeric-text": true, "project-reader-numeric-codec": true,
  "project-reader-record-slots": true, "edit-reader-record-field": true,
  "project-reader-values": true, "project-reader-picture": true,
  "project-reader-choice-selection": true, "project-reader-list-selection": true, "edit-reader-list-chips": true,
  "query-reader-field-catalog": true, "query-reader-field-identity": true, "query-reader-field-resurrections": true,
  "query-reader-field-facets": true,
  "project-reader-references": true, "project-reader-type-presentations": true, "check-set-membership": true,
  // B4 wave 1 lane B: representation switching (equality transport).
  "project-reader-representation": true, "edit-reader-representation": true, "create-reader-representation": true,
  // B4 wave 1 lane C: the Local API client's instance wire.
  "decode-reader-instances": true, "encode-reader-instances": true,
  // B4 wave 2 lane A: text parsing and printing.
  "read-reader-expression-text": true, "print-reader-expression-text": true,
  "decode-reader-address-inputs": true, "encode-reader-address-inputs": true,
  // B4 wave 2 lane B (F1): the FunctionPicker's options (guidance class).
  "project-reader-function-options": true, "resolve-reader-type-ref": true,
  // B4 wave 3 lane A (census unit D): Home's actions.
  "plan-reader-linked-demo": true, "run-reader-lens-shortcut": true,
  "prepare-reader-transfer-item": true, "project-reader-transfer-captions": true,
  "lower-reader-expression": true, "raise-reader-logic": true,
  // B4 wave 3 lane B (F2): the expression editor's parameter names (guidance class).
  "project-reader-field-names": true, "judge-reader-compatibility": true,
  // B4 wave 4 lane S: the Local session contract.
  "resolve-reader-function-scope": true,
  // B4 wave 4 lane H: Home.
  "reconcile-reader-signature": true, "project-reader-call-signature": true, "query-reader-value-search": true,
  "judge-reader-function-graph": true,
  // B4 wave 4 lane E: the expression editor and renderers.
  "resolve-reader-dependent-type": true, "select-reader-union-branch": true, "project-reader-lens-policy": true,
  "read-reader-returned-expression": true, "project-reader-text-shortcuts": true,
  "project-reader-instance-interfaces": true, "project-reader-instance-methods-type": true,
});
/** A Local owner whose retired worker was replaced by a restored one. Its
 * sessions bound only to the retired client must refuse, never fall back. */
const retiredByOwner = new WeakMap<WorkerOwner, Client>();
const moduleCatalogs = new WeakMap<AuthoringCatalogSnapshot, { client: Client; owner: WorkerOwner; sourceModule: string }>();
const snapshotTokens = new WeakMap<Client, object>();
const [workerRevision, setWorkerRevision] = createSignal(0);

/** W1: an idle Local realm released by its retired snapshot, kept for the
 * same holder's next preparation. It holds no snapshot state (the worker
 * dropped it on `release`), only realm-level engine caches. Host lifetime
 * glue: no registry, catalogue or authority is reachable through it. */
type WarmRealm = { transport: AuthoringWorkerTransport; lineage: object; epoch: number; idle?: ReturnType<typeof setTimeout>; detach: () => void };
const warmRealms = new Map<object, WarmRealm>();
/** Idle time only. An ordinary operation or durable save may borrow a warm
 * realm; its existing request/receipt deadlines own that active interval. */
export const WARM_REALM_IDLE_MS = 60_000;
/** Fixed experiment parameter; the zero-grace control is an isolated source overlay. */
const READER_RETIREMENT_ALLOWANCE_MS = 250;

function dropWarmRealm(realm: WarmRealm): void {
  clearTimeout(realm.idle);
  if (warmRealms.get(realm.lineage) === realm) warmRealms.delete(realm.lineage);
  realm.detach();
  void retireAuthoringTransport(realm.transport, "The warm authoring realm was closed.");
}

function watchWarmRealm(realm: WarmRealm): void {
  const transport = realm.transport;
  if (transport.closed || realm.epoch !== sessionEpoch()) { dropWarmRealm(realm); return; }
  if (transport.jobs.size || transport.pending.size || transport.storage.size) {
    clearTimeout(realm.idle); realm.idle = undefined; return;
  }
  if (realm.idle !== undefined) return;
  const timer = setTimeout(() => {
    if (realm.idle !== timer || warmRealms.get(realm.lineage) !== realm) return;
    realm.idle = undefined;
    if (transport.jobs.size || transport.pending.size || transport.storage.size) return;
    dropWarmRealm(realm);
  }, WARM_REALM_IDLE_MS);
  realm.idle = timer;
}

/** Keep only a clean realm: a prepared Local snapshot of the current session
 * with no job in flight. A busy or failed realm is terminated as before. */
function parkRealm(client: Client): boolean {
  const lineage = client.lineage;
  const transport = client.transport;
  if (!lineage || !client.localSourceId || !client.catalog || transport.closed || transport.jobs.size || transport.pending.size
    || client.epoch !== sessionEpoch()) return false;
  const prior = warmRealms.get(lineage);
  if (prior) dropWarmRealm(prior);
  const realm: WarmRealm = { transport, lineage, epoch: client.epoch, detach: () => {} };
  realm.detach = observeAuthoringTransport(transport, () => watchWarmRealm(realm));
  try { controlAuthoringTransport(transport, { method: "release" }); }
  catch { clearTimeout(realm.idle); realm.detach(); return false; }
  warmRealms.set(lineage, realm);
  watchWarmRealm(realm);
  return true;
}

/** Borrow the existing holder's physical incarnation without initializing a
 * reader or creating a worker. Ordinary projected data survives reader release;
 * core-choice borrowing keeps its stricter snapshot lifetime unchanged. */
export function borrowLocalOrdinaryTransport(lineage: object, epoch: number): {
  readonly transport: AuthoringWorkerTransport; assertCurrent(): void;
} {
  const current = () => {
    assertCurrentSession(epoch);
    if ([...activeClients].some(client => client.lineage === lineage && client.successorClaim && !client.successorClaim.adopted)) return undefined;
    const bound = findLocalOrdinaryTransport(lineage, epoch);
    if (bound) return bound;
    const warm = warmRealms.get(lineage);
    return warm?.epoch === epoch && !warm.transport.closed && !warm.transport.retirement ? warm.transport : undefined;
  };
  const transport = current();
  if (!transport) throw new Error("Local data is unavailable. Retry to prepare it again.");
  return Object.freeze({ transport, assertCurrent() {
    if (current() !== transport) throw new Error("These Local data tools were replaced. Retry with the current source.");
  } });
}

function takeWarmRealm(lineage: object): WarmRealm | undefined {
  const realm = warmRealms.get(lineage);
  if (!realm) return undefined;
  clearTimeout(realm.idle); realm.detach();
  warmRealms.delete(lineage);
  if (realm.epoch !== sessionEpoch() || realm.transport.closed) {
    void retireAuthoringTransport(realm.transport, "The account session changed."); return undefined;
  }
  return realm;
}

/** The holder closed: its unclaimed warm realm ends with it, and the page's
 * persistent registry preparation worker closes once no build holds it. */
export function discardWarmAuthoringRealm(lineage: object): void {
  for (const client of activeClients) if (client.closed && client.lineage === lineage) {
    if (client.successorClaim) client.successorClaim.valid = false;
    void retireAuthoringTransport(client.transport, "The Local holder was closed.");
  }
  const realm = warmRealms.get(lineage);
  if (realm) dropWarmRealm(realm);
  closeRegistryPreparationWorker("idle");
}

function dispose(client: Client, reason: string, keepRealm = false): void {
  if (client.closed) {
    if (!keepRealm) {
      if (client.successorClaim) client.successorClaim.valid = false;
      if (client.transport.retirement) void retireAuthoringTransport(client.transport, reason);
    }
    return;
  }
  // Snapshot clients never reopen. Warm successors get fresh contexts/handles
  // over the same physical transport and its monotonic IDs.
  const currentHolder = client.epoch === sessionEpoch() && client.lineage
    && findLocalOrdinaryTransport(client.lineage, client.epoch) === client.transport;
  client.closed = true;
  for (const seal of client.preparationLeases) seal();
  setWorkerRevision(revision => revision + 1);
  client.preparationCleanup?.(); client.preparationCleanup = undefined;
  client.transportCleanup?.(); client.transportCleanup = undefined;
  client.unbindTransport?.(); client.unbindTransport = undefined;
  // Physical reader work is eligible only at this permanent, attached Local
  // retirement boundary. Generic requests retain their independent ownership.
  const reader = keepRealm && currentHolder && client.lineage && client.localSourceId && client.catalog
    && client.accountId === undefined && client.preparationPhase === "attached" && client.epoch === sessionEpoch()
    ? { owner: client, allowanceMs: READER_RETIREMENT_ALLOWANCE_MS } : undefined;
  const drained = retireAuthoringTransport(client.transport, reason, keepRealm ? () => parkRealm(client) : undefined, reader);
  if (keepRealm && client.transport.retirement) client.retirementDrained = drained;
  if (!client.transport.retirement) activeClients.delete(client);
  else void drained.then(() => { if (!client.successorClaim) activeClients.delete(client); });
}
export function disposePreparedAuthoringWorkers(): void {
  disposeEarlyAuthoringTransports();
  clearCheckedRepositoryNamespaces();
  // W1: the page realm's persistent registry preparation worker may hold the
  // previous session's account data in its caches; the next build restarts it.
  closeRegistryPreparationWorker("now");
  for (const client of [...activeClients]) dispose(client, "The account or committed authoring snapshot changed.");
  for (const realm of [...warmRealms.values()]) dropWarmRealm(realm);
}
onBrowserSessionChange(disposePreparedAuthoringWorkers);

/** A snapshot facade over the sole physical request/job owner. */
function request(client: Client, payload: AuthoringWorkerCommand, signal?: AbortSignal,
  onStart?: () => void): Promise<AuthoringWorkerResult> {
  if (client.closed) return Promise.reject(new Error("These editing tools were replaced by a newer account snapshot."));
  return requestAuthoringTransport(client.transport, payload, signal, onStart);
}
function reserveInitialization(client: Client,
  payload: Extract<AuthoringWorkerCommand, { method: "initialize" }>): InitializationReservation {
  if (client.closed) throw new Error("These editing tools were replaced by a newer account snapshot.");
  if (client.initializationId !== undefined) throw new Error("This authoring worker already has an initialization.");
  const reservation = reserveAuthoringInitialization(client.transport, payload);
  client.initializationId = reservation.id;
  return reservation;
}
function attachClientWorker(client: Client): void {
  client.transportCleanup = observeAuthoringTransport(client.transport, () => {
    if (client.transport.closed) dispose(client, client.transport.reason ?? "The authoring worker failed.");
  });
}
/** Keep the existing result/failure adapter in its current heavy owner. */
export function acquireEarlyLocalEnginePreparation(): RegistryPreparationLease | undefined {
  const lease = acquireEarlyAuthoringPreparation();
  if (!lease) return undefined;
  return Object.freeze({
    async run(preparation: Parameters<RegistryPreparationLease["run"]>[0]) {
      const result = await lease.run(preparation);
      if (!result || typeof result !== "object" || !("registryPreparation" in result)
        || !result.registryPreparation || typeof result.registryPreparation.ok !== "boolean")
        throw new Error("The registry preparation response could not be read.");
      // L5a-finish: an answer of another build never reaches the page build.
      checkRegistryPreparationBuild(result.registryPreparation.build, AUTHORING_BUILD_IDENTITY);
      if (result.registryPreparation.ok) return result.registryPreparation.value;
      return throwRegistryPreparationFailure(result.registryPreparation);
    },
    release: lease.release,
    abort: lease.abort,
  });
}

/** B3 transport checks only: the checked repository build owns identity and
 * type semantics. Reject an unreadable whole projection before either global
 * catalog publisher can observe a partial response. */
function ownProjectionRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    && Reflect.ownKeys(value).every(key => typeof key === "string"
      && "value" in Object.getOwnPropertyDescriptor(value, key)!);
}

function denseProjectionArray(value: unknown, valid: (entry: unknown) => boolean): value is unknown[] {
  if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !valid(descriptor.value)) return false;
  }
  return true;
}

function repositoryProjectionEntity(value: unknown): boolean {
  return ownProjectionRecord(value) && Object.hasOwn(value, "id") && typeof value.id === "string" && value.id.length > 0
    && Object.hasOwn(value, "type") && ownProjectionRecord(value.type)
    && (value.module === undefined || typeof value.module === "string")
    && (value.params === undefined || denseProjectionArray(value.params, param => typeof param === "string" || ownProjectionRecord(param)));
}

/** Structured clone removes the repository registry's recursive freezes.
 * Restore that own-data boundary before publication. Bytes keep the registry's
 * existing exception: the worker transfer supplied a fresh copy, whose typed
 * array elements JavaScript cannot freeze. */
function finalizeRepositoryProjection(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value === "function" || typeof value === "symbol") {
    throw new Error("The checked repository namespace projection could not be read.");
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  if (Object.getPrototypeOf(value) === Uint8Array.prototype) return;
  if (Array.isArray(value) ? !denseProjectionArray(value, () => true) : !ownProjectionRecord(value)) {
    throw new Error("The checked repository namespace projection could not be read.");
  }
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor)) throw new Error("The checked repository namespace projection could not be read.");
    finalizeRepositoryProjection(descriptor.value, seen);
  }
  Object.freeze(value);
}

export async function prepareCatalogInWorker(accountId: string | undefined, snapshot: FieldPersistenceSnapshot,
  entities: Array<{ id: string; type: FenelType; module?: string }>, functions: readonly FenelFunction[] = [],
  options: { independent?: boolean; sourceModules?: readonly SourceModuleDocument[]; signal?: AbortSignal;
    onRepositoryNamespaces?: (names: ReadonlySet<string>) => void; localSourceId?: string; representations?: readonly InstanceDraft[]; repositoryOnly?: boolean;
    localValueIds?: readonly string[]; lineage?: object; onRegistryPreparation?: (owner: LocalRegistryPreparationOwner) => void } = {},
): Promise<AuthoringCatalogSnapshot> {
  // Lifecycle coordinates and callback identities are part of this admission,
  // just like the initialization data captured below.
  options = { ...options };
  options.signal?.throwIfAborted();
  if (options.onRegistryPreparation && (!options.localSourceId || accountId !== undefined || options.independent !== true))
    throw new TypeError("Registry preparation requires an independent Local authoring worker.");
  const epoch = sessionEpoch();
  const namespaceConsumer = options.sourceModules?.length ? options.onRepositoryNamespaces : undefined;
  const retiring = options.lineage
    ? [...activeClients].find(client => client.closed && client.lineage === options.lineage
      && (client.retirementDrained || client.successorClaim)) : undefined;
  if (retiring?.successorClaim) throw new Error("This Local replacement already has a preparation owner.");
  if (retiring && (accountId !== undefined || !options.localSourceId
    || retiring.localSourceId !== options.localSourceId || retiring.epoch !== epoch))
    throw new Error("This preparation does not belong to the retiring Local source.");
  const claim: Client["successorClaim"] = retiring ? { valid: true } : undefined;
  if (retiring) retiring.successorClaim = claim;
  let adopted = false;
  try {
  // Capture every initialization input before the new retirement wait yields.
  const initialization: Extract<AuthoringWorkerCommand, { method: "initialize" }> = { method: "initialize", accountId, localSourceId: options.localSourceId, repositoryOnly: options.repositoryOnly, snapshot, entities, functions,
    sourceModules: options.sourceModules, localRepresentations: options.representations, localValueIds: options.localValueIds, sessionEpoch: epoch };
  const capturedBeforeRetirement = retiring ? structuredClone(initialization) : undefined;
  if (retiring) {
    options.signal?.throwIfAborted();
    const abort = () => {
      if (retiring.successorClaim !== claim) return;
      claim!.valid = false;
      void retireAuthoringTransport(retiring.transport, "Preparing the editing tools was cancelled.");
      const warm = warmRealms.get(options.lineage!);
      if (warm?.transport === retiring.transport) dropWarmRealm(warm);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      // Source-module namespace preflight keeps fresh preparation and never
      // inherits the old reader's drain/reuse policy.
      if (namespaceConsumer) void retireAuthoringTransport(retiring.transport, "Source-module preparation needs fresh editing tools.");
      await retiring.retirementDrained;
      assertCurrentSession(epoch); options.signal?.throwIfAborted();
      if (retiring.successorClaim !== claim || !claim?.valid) throw new Error("This Local preparation owner was replaced.");
    } finally { options.signal?.removeEventListener("abort", abort); }
  }
  // The previous service remains usable while the replacement is checked.
  // Activation after the atomic registry publication retires old authority.
  // W1: a Local holder's next snapshot reuses the realm its previous snapshot
  // released; request ids continue, so no late message can match a new job.
  const freshPreflight = retiring && namespaceConsumer;
  const early = !freshPreflight && options.lineage ? reserveEarlyAuthoringRealm(options.lineage) : undefined;
  const warm = !freshPreflight && !early && options.lineage && options.localSourceId ? takeWarmRealm(options.lineage) : undefined;
  const transport = early?.transport ?? warm?.transport ?? spawnAuthoringTransport();
  const client: Client = { transport, accountId, localSourceId: options.localSourceId, epoch: transport.epoch,
    independent: options.independent === true, closed: false, nextContext: 0, contexts: new WeakMap(),
    ...(options.repositoryOnly === true ? { repositoryOnly: true } : {}),
    preparationPhase: "preparing", preparationLeases: new Set(),
    ...(options.lineage ? { lineage: options.lineage } : {}) };
  activeClients.add(client);
  if (options.lineage) client.unbindTransport = bindAuthoringTransport(options.lineage, transport);
  // Acquiring and rebinding the physical realm is synchronous with releasing
  // the exclusive claim. Ordinary borrowers cannot enter the warm gap.
  if (claim) claim.adopted = true;
  adopted = true;
  if (options.signal) {
    const signal = options.signal;
    const abort = () => dispose(client, signal.reason instanceof Error ? signal.reason.message : "Preparing the editing tools was cancelled.");
    signal.addEventListener("abort", abort, { once: true });
    client.preparationCleanup = () => signal.removeEventListener("abort", abort);
  }
  attachClientWorker(client);
  try {
    // Capture the full payload before namespace preflight OR the new lease
    // drain can yield. The caller's mutable source cannot change this build.
    const capturedInitialization = capturedBeforeRetirement ?? (namespaceConsumer || early ? structuredClone(initialization) : initialization);
    let checkedNames: readonly string[] | undefined;
    if (namespaceConsumer) {
      const projection: unknown = await request(client, { method: "repository-namespaces" });
      assertCurrentSession(client.epoch);
      options.signal?.throwIfAborted();
      if (client.closed) throw new Error("These editing tools were replaced by a newer account snapshot.");
      if (!ownProjectionRecord(projection) || !Object.hasOwn(projection, "repositoryNamespaces")
        || !denseProjectionArray(projection.repositoryNamespaces, name => typeof name === "string")
        || !Object.hasOwn(projection, "repositoryEntities") || !denseProjectionArray(projection.repositoryEntities, repositoryProjectionEntity)
        || !Object.hasOwn(projection, "identifiedRepositoryEntities") || !denseProjectionArray(projection.identifiedRepositoryEntities, repositoryProjectionEntity)) {
        throw new Error("The checked repository namespace projection could not be read.");
      }
      // A2/B3: restore the original checked execute build's repository catalog
      // side effects in their original raw-then-identified order. Account rows,
      // source rows, callables and authority never enter this projection.
      const checked = projection as Extract<AuthoringWorkerResult, { repositoryNamespaces: readonly string[] }>;
      checkedNames = Object.freeze([...checked.repositoryNamespaces]);
      const finalized = new WeakSet<object>();
      finalizeRepositoryProjection(checked.repositoryEntities, finalized);
      finalizeRepositoryProjection(checked.identifiedRepositoryEntities, finalized);
      // A2/B3 scheduling: source field normalization previously prepared this
      // same private harness before the main execute-profile publication. Keep
      // that first-registration order without another repository registry.
      await prepareEngineBodyDispatch();
      assertCurrentSession(client.epoch);
      options.signal?.throwIfAborted();
      if (client.closed) throw new Error("These editing tools were replaced by a newer account snapshot.");
      registerCatalogEntities(checked.repositoryEntities);
      for (const entity of checked.identifiedRepositoryEntities) registerIdentifiedCatalogEntity(entity);
      namespaceConsumer(new Set(checkedNames));
    }
    // Preserve namespace-preflight timing and the same 600s allowance at
    // reservation, including early preparation. Reader retirement has decided.
    const initializationReservation = reserveInitialization(client, capturedInitialization);
    if (early) await early.waitForPreparation(options.signal);
    assertCurrentSession(client.epoch); options.signal?.throwIfAborted();
    if (client.closed) throw new Error("These editing tools were replaced by a newer account snapshot.");
    initializationReservation.post();
    if (client.transport.closed) throw new Error(client.transport.reason ?? "The authoring worker failed.");
    early?.adopted();
    const pendingInitialization = initializationReservation.result;
    if (options.onRegistryPreparation) {
      // The request counter assigned this exact generation before submission.
      // Observe failure even if the consumer's synchronous callback refuses.
      void pendingInitialization.catch(() => undefined);
      if (client.initializationId === undefined) throw new Error("The Local worker initialization was not submitted.");
      const owner = Object.freeze({}) as LocalRegistryPreparationOwner;
      localRegistryPreparations.set(owner, { client, initializationId: client.initializationId });
      options.onRegistryPreparation(owner);
    }
    const prepared = await pendingInitialization as { catalog: AuthoringCatalogSnapshot; displayCatalog: CatalogSection[] };
    assertCurrentSession(client.epoch);
    options.signal?.throwIfAborted();
    if (client.closed) throw new Error("These editing tools were replaced by a newer account snapshot.");
    client.catalog = prepared.catalog;
    client.displayCatalog = prepared.displayCatalog;
    byCatalog.set(prepared.catalog, client);
    // Namespace callbacks may start the main build before initialization is
    // complete. Only a successful current preparation becomes reusable by a
    // later standalone committed-snapshot rebuild.
    if (checkedNames) retainCheckedRepositoryNamespaces(client.epoch, checkedNames);
    return prepared.catalog;
  } catch (error) { dispose(client, "Preparing the editing tools failed."); throw error; }
  } finally {
    if (retiring) {
      if (retiring.successorClaim === claim) retiring.successorClaim = undefined;
      if (!adopted) {
        void retireAuthoringTransport(retiring.transport, "The Local replacement preparation ended.");
        const warm = options.lineage && warmRealms.get(options.lineage);
        if (warm && warm.transport === retiring.transport) dropWarmRealm(warm);
      }
      activeClients.delete(retiring);
    }
  }
}

export function prepareLocalCatalogInWorker(sourceId: string, snapshot: FieldPersistenceSnapshot,
  entities: Array<{ id: string; type: FenelType; module?: string }>, functions: readonly FenelFunction[],
  options: { signal?: AbortSignal; representations?: readonly InstanceDraft[]; localValueIds?: readonly string[]; lineage?: object;
    onRegistryPreparation?: (owner: LocalRegistryPreparationOwner) => void } = {}): Promise<AuthoringCatalogSnapshot> {
  if (!sourceId) return Promise.reject(new TypeError("A local authoring worker needs its source identity."));
  return prepareCatalogInWorker(undefined, snapshot, entities, functions,
    { ...options, independent: true, localSourceId: sourceId });
}

/** One request's signal: aborted by the lease's own cancellation or by the
 * request's signal, whichever comes first. `done` drops both listeners. */
function linkRequestSignal(lease: AbortSignal, own: AbortSignal | undefined): { signal: AbortSignal; done(): void } {
  if (own === undefined) return { signal: lease, done() {} };
  const link = new AbortController();
  const fromLease = () => link.abort(lease.reason);
  const fromOwn = () => link.abort(own.reason);
  if (lease.aborted) fromLease();
  else if (own.aborted) fromOwn();
  lease.addEventListener("abort", fromLease, { once: true });
  own.addEventListener("abort", fromOwn, { once: true });
  return { signal: link.signal, done() {
    lease.removeEventListener("abort", fromLease);
    own.removeEventListener("abort", fromOwn);
  } };
}

/** One page build borrows only the preparation operations of its exact Local
 * initialization. Publication owns the worker; releasing a lease never does. */
export function acquireLocalRegistryPreparation(owner: LocalRegistryPreparationOwner, sourceId: string): RegistryPreparationLease {
  const captured = localRegistryPreparations.get(owner);
  if (!captured) throw new TypeError("The Local registry preparation owner is unavailable.");
  const { client, initializationId } = captured;
  const assertPreparing = () => {
    if (client.closed) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
    assertCurrentSession(client.epoch);
    if (!sourceId || client.localSourceId !== sourceId || client.accountId !== undefined || !client.independent)
      throw new Error("The registry preparation does not belong to this Local source.");
    if (client.initializationId !== initializationId || !client.catalog || client.preparationPhase !== "preparing")
      throw new Error("This Local registry preparation is no longer available.");
  };
  assertPreparing();
  const cancellation = new AbortController();
  let ended = false;
  const seal = () => { ended = true; client.preparationLeases.delete(seal); };
  const assertLease = () => {
    cancellation.signal.throwIfAborted();
    assertPreparing();
    if (ended) throw new Error("This Local registry preparation lease is closed.");
  };
  client.preparationLeases.add(seal);
  return Object.freeze({
    async run(preparation: Parameters<RegistryPreparationLease["run"]>[0], control?: RegistryPreparationRunControl) {
      assertLease();
      control?.signal?.throwIfAborted();
      // borrow-deadline: the request's own signal abandons only this request
      // (the lease and its later requests stay); the lease's abort still
      // ends every request. `started` follows this job's start ACK.
      const linked = linkRequestSignal(cancellation.signal, control?.signal);
      let result: AuthoringWorkerResult;
      try {
        result = await request(client, { method: "prepare-registry-step", initializationId,
          localSourceId: sourceId, request: preparation, build: AUTHORING_BUILD_IDENTITY }, linked.signal, control?.started);
      } finally { linked.done(); }
      assertLease();
      if (!result || typeof result !== "object" || !("registryPreparation" in result))
        throw new Error("The registry preparation response could not be read.");
      const answer = result.registryPreparation;
      if (!answer || typeof answer !== "object" || typeof answer.ok !== "boolean")
        throw new Error("The registry preparation response could not be read.");
      // L5a-finish: an answer of another build never reaches the page build;
      // the registry then computes the step itself (registry.ts).
      checkRegistryPreparationBuild(answer.build, AUTHORING_BUILD_IDENTITY);
      if (answer.ok) return answer.value;
      return throwRegistryPreparationFailure(answer);
    },
    release: seal,
    abort(reason?: unknown) {
      if (ended) return;
      seal();
      cancellation.abort(reason);
    },
    // L5a: this worker built the same source's inline registry, so its S3a
    // store is warm; the page build holds this lease through signatures. The
    // build check above covers the signature borrows like every other step,
    // and `run` honours the per-request control (borrow-deadline).
    signatures: true,
  });
}

/** Lane S (Nov 8): the page's own build of the checked repository borrows the
 * preparation steps of the public worker that already built it (L5a pattern:
 * same build, its warm repository memo partition; every miss runs the same
 * kernel there). Only the repository-only client that produced `catalog`, of
 * the current session; the page build checks the build on every answer. */
export function acquireRepositoryRegistryPreparation(catalog: AuthoringCatalogSnapshot): RegistryPreparationLease {
  const client = byCatalog.get(catalog);
  const assertCurrent = () => {
    if (!client || client.closed || client.transport.closed) throw new Error("The public authoring worker is unavailable.");
    assertCurrentSession(client.epoch);
    if (client.repositoryOnly !== true || client.accountId !== undefined || client.localSourceId !== undefined || client.catalog !== catalog)
      throw new Error("This registry preparation does not belong to the public authoring worker.");
  };
  assertCurrent();
  const cancellation = new AbortController();
  let ended = false;
  // A public worker that stops answering (closed, replaced) must not fail the
  // page's own build: its field, facet and constructor steps then go to the
  // page's existing preparation worker. Signature borrows are optional (the
  // page computes a refused one itself); another build's answer is refused.
  let fallback: RegistryPreparationLease | undefined;
  const assertLease = () => {
    cancellation.signal.throwIfAborted();
    if (ended) throw new Error("This public registry preparation lease is closed.");
  };
  const borrowed = async (preparation: Parameters<RegistryPreparationLease["run"]>[0], control?: RegistryPreparationRunControl) => {
    assertCurrent();
    const linked = linkRequestSignal(cancellation.signal, control?.signal);
    let result: AuthoringWorkerResult;
    try {
      result = await request(client!, { method: "prepare-repository-registry-step", request: preparation,
        build: AUTHORING_BUILD_IDENTITY }, linked.signal, control?.started);
    } finally { linked.done(); }
    assertLease(); assertCurrent();
    if (!result || typeof result !== "object" || !("registryPreparation" in result))
      throw new Error("The registry preparation response could not be read.");
    const answer = result.registryPreparation;
    if (!answer || typeof answer !== "object" || typeof answer.ok !== "boolean")
      throw new Error("The registry preparation response could not be read.");
    checkRegistryPreparationBuild(answer.build, AUTHORING_BUILD_IDENTITY);
    if (answer.ok) return answer.value;
    try { return throwRegistryPreparationFailure(answer); }
    catch (error) { answered.add(error as object); throw error; }
  };
  // The worker's own answer (a checked refusal) is the page build's answer too.
  const answered = new WeakSet<object>();
  return Object.freeze({
    async run(preparation: Parameters<RegistryPreparationLease["run"]>[0], control?: RegistryPreparationRunControl) {
      assertLease();
      control?.signal?.throwIfAborted();
      const signature = preparation.kind === "signatureAuthoredPlans" || preparation.kind === "signatureInference";
      if (fallback) {
        if (signature) throw new Error("The public authoring worker no longer lends signature plans.");
        return fallback.run(preparation, control);
      }
      try { return await borrowed(preparation, control); }
      catch (error) {
        if (cancellation.signal.aborted || control?.signal?.aborted || ended || signature
          || (typeof error === "object" && error !== null && answered.has(error))
          || (error instanceof Error && error.name === "RegistryPreparationBuildMismatch")) throw error;
        fallback ??= acquireRegistryPreparationWorker();
        return fallback.run(preparation, control);
      }
    },
    release() { ended = true; fallback?.release(); },
    abort(reason?: unknown) {
      if (ended) return;
      ended = true;
      cancellation.abort(reason);
      fallback?.abort(reason);
    },
    signatures: true,
  });
}

/** Public evaluation uses the checked repository only. No account/source
 * coordinate or captured reader authority crosses this acquisition boundary. */
export function prepareRepositoryCatalogInWorker(): Promise<AuthoringCatalogSnapshot> {
  return prepareCatalogInWorker(undefined, { owners: [], fields: [], facets: [] }, [], [],
    { independent: true, repositoryOnly: true, lineage: repositoryAuthoringRealmOwner() });
}

/** Select only the worker that produced this exact checked catalogue. This
 * does not prepare a registry or attach a page-side authoring session. */
export function prepareReaderWorkerHandle(catalog: AuthoringCatalogSnapshot): PreparedReaderWorker {
  const client = byCatalog.get(catalog);
  if (!client || client.closed) throw new Error("The prepared authoring worker is unavailable.");
  assertCurrentSession(client.epoch);
  return readerWorkerHandle(client, client.baseContext ??= { id: 0, configured: true });
}

function readerWorkerHandle(client: Client, context: Context): PreparedReaderWorker {
  if (!context.readerHandle) {
    const handle = Object.freeze({}) as PreparedReaderWorker;
    preparedReaderWorkers.set(handle, { client, context });
    context.readerHandle = handle;
  }
  return context.readerHandle;
}

/** Explicit replacement ownership, independent of historical worker closure. */
const readerReplacementLeases = new WeakMap<Client, Set<object>>();
export function beginPreparedReaderWorkerReplacement(handle: PreparedReaderWorker): () => void {
  const prepared = preparedReaderWorkers.get(handle);
  if (!prepared) throw new TypeError("The prepared reader worker is unavailable.");
  assertCurrentSession(prepared.client.epoch);
  const leases = readerReplacementLeases.get(prepared.client) ?? new Set<object>();
  readerReplacementLeases.set(prepared.client, leases);
  const lease = {}; leases.add(lease);
  setWorkerRevision(value => value + 1);
  return () => { if (leases.delete(lease)) setWorkerRevision(value => value + 1); };
}
export function authoringWorkerReplacementPending(session: AuthoringSession): boolean {
  workerRevision();
  const concrete = concreteAuthoringSession(session);
  // Only private known owners participate. An unknown/missing-owner session
  // gets its actual refusal from token acquisition, not from this classifier.
  const bound = bySession.get(concrete), owner = sessionOwners.get(concrete);
  if (!bound && !owner) return false;
  const current = owner ? byOwner.get(owner) : undefined, prior = owner ? retiredByOwner.get(owner) : undefined;
  const known = bound ?? (!current?.contexts.has(concrete) && prior?.contexts.has(concrete) ? prior : current);
  if (!known) return false;
  if (known.epoch !== sessionEpoch()) return false;
  return known.closed && (readerReplacementLeases.get(known)?.size ?? 0) > 0;
}
/** Known private handle liveness; never accepts a missing handle as recoverable. */
export function preparedReaderWorkerClosed(handle: PreparedReaderWorker): boolean {
  const prepared = preparedReaderWorkers.get(handle);
  if (!prepared) throw new TypeError("The prepared reader worker is unavailable.");
  assertCurrentSession(prepared.client.epoch);
  return prepared.client.closed;
}

function preparedReaderWorker(handle: PreparedReaderWorker): { client: Client; context: Context } {
  const prepared = preparedReaderWorkers.get(handle);
  if (!prepared) throw new TypeError("The prepared reader worker is unavailable.");
  if (prepared.client.closed) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
  assertCurrentSession(prepared.client.epoch);
  return prepared;
}

/** Inert projections from the same preparation, never a registry facade. */
export function preparedReaderWorkerCatalog(handle: PreparedReaderWorker): Readonly<{
  catalog: AuthoringCatalogSnapshot; displayCatalog: readonly CatalogSection[];
}> {
  const { client, context } = preparedReaderWorker(handle);
  return Object.freeze({ catalog: context.catalog ?? client.catalog!, displayCatalog: client.displayCatalog! });
}

/** A new immutable worker context captures exactly this data roster. Scoping
 * another scoped handle replaces its roster; it does not merge draft scopes.
 * A2/B3 browser wire: no reader frame or host callback crosses this boundary. */
export function scopePreparedReaderWorker(handle: PreparedReaderWorker, scope: ReaderAuthoringScope): PreparedReaderWorker {
  const { client, context } = preparedReaderWorker(handle);
  const captured = registryTransportSnapshot(scope, "prepared reader worker scope");
  if ("sourceId" in captured
    ? typeof captured.sourceId !== "string" || !captured.sourceId || captured.sourceId !== client.localSourceId || client.accountId !== undefined
    : typeof captured.accountId !== "string" || !captured.accountId || captured.accountId !== client.accountId || client.localSourceId !== undefined) {
    throw new Error("The authoring scope does not belong to this prepared reader.");
  }
  const mirroredScope: ReaderAuthoringScope = "sourceId" in captured
    ? { sourceId: captured.sourceId, functions: captured.functions, ...(captured.draft !== undefined ? { draft: captured.draft } : {}) }
    : { accountId: captured.accountId, functions: captured.functions, ...(captured.draft !== undefined ? { draft: captured.draft } : {}) };
  return readerWorkerHandle(client, { id: ++client.nextContext, scope: mirroredScope, configured: false,
    ...(context.sourceModule ? { sourceModule: context.sourceModule } : {}), ...(context.catalog ? { catalog: context.catalog } : {}),
  });
}

/** Reuse the prepared client's request, cancellation and lifetime owner. */
/** How a prepared reader request is copied before it crosses to the worker.
 * Data whose own-key order is observable (read values, membership candidates)
 * keeps that order; canonical copying sorts keys. */
export function preparedReaderTransportMode(method: unknown): "canonical" | "equality" | "value-read" {
  return method === "project-reader-values" || method === "project-reader-picture" || method === "check-set-membership"
    || method === "decode-reader-instances" || method === "encode-reader-instances"
    || method === "project-reader-instance-methods-type"
    || method === "read-reader-expression-text" || method === "print-reader-expression-text"
    || method === "decode-reader-address-inputs" || method === "encode-reader-address-inputs"
    || method === "project-reader-function-options" || method === "plan-reader-linked-demo"
    || method === "run-reader-lens-shortcut" || method === "lower-reader-expression" || method === "infer-function-draft"
    || method === "raise-reader-logic"
    || method === "query-reader-value-search" || method === "select-reader-union-branch" || method === "resolve-reader-dependent-type"
    || method === "read-reader-returned-expression" || method === "project-reader-lens-policy" || method === "project-reader-call-signature"
    || method === "judge-reader-function-graph"
    ? "value-read" : method === "project-reader-choice-selection" || method === "project-reader-list-selection"
    || method === "edit-reader-list-chips" || method === "project-reader-field-plan"
    || method === "decode-reader-numeric-text" || method === "encode-reader-numeric-text"
    || method === "project-reader-numeric-codec" || method === "project-reader-record-slots"
    || method === "edit-reader-record-field" || method === "project-reader-representation"
    || method === "edit-reader-representation" || method === "create-reader-representation" ? "equality" : "canonical";
}

export function runPreparedReaderWorker(handle: PreparedReaderWorker, payload: AuthoringWorkerPayload,
  signal?: AbortSignal,
): Promise<AuthoringWorkerResult> {
  try {
    signal?.throwIfAborted();
    const { client, context } = preparedReaderWorker(handle);
    // Capture new direct requests as plain data; only the private binding may
    // select a context, source module or mirrored scope.
    const methodSlot = Object.getOwnPropertyDescriptor(payload, "method");
    const method = methodSlot && Object.hasOwn(methodSlot, "value") ? Reflect.get(payload, "method") : undefined;
    const mode = preparedReaderTransportMode(method);
    const captured = registryTransportSnapshot(payload, "prepared reader worker request", mode, Reflect.get);
    if (!Object.hasOwn(captured, "method") || captured.method !== method || !Object.hasOwn(preparedReaderMethods, captured.method))
      throw new TypeError("The prepared reader operation is unavailable.");
    return runWorkerContext(client, context, { ...captured, sourceModule: undefined, scope: undefined }, signal, captured.method);
  } catch (error) { return Promise.reject(error); }
}

export function createPreparedSnapshotOwner(): PreparedSnapshotOwner {
  return Object.freeze({}) as PreparedSnapshotOwner;
}

/** The Local snapshot owner this session routes by, if any. */
export function preparedSnapshotOwnerOf(session: AuthoringSession): PreparedSnapshotOwner | undefined {
  return sessionOwners.get(concreteAuthoringSession(session));
}

/** A derived session (a draft or a module frame) routes like its base. */
export function inheritPreparedSnapshotOwner<S extends AuthoringSession>(derived: S, base: AuthoringSession): S {
  const owner = preparedSnapshotOwnerOf(base);
  if (owner) sessionOwners.set(derived, owner);
  return derived;
}

/** Whether this registry's workers are routed by a Local snapshot owner. */
export function registryHasSnapshotOwner(registry: ModuleRegistry): boolean { return ownedRegistries.has(registry); }

/** B4 wave 4 lane S (Central reader worker transport, host plumbing): a read
 * of a Local reader's page registry, which no longer exists. */
export class LocalPageRegistryRead extends Error {
  constructor(member: string) {
    super(`LocalPageRegistryRead: a Local reader has no page registry (read of "${member}"); its registry lives in its worker.`);
    this.name = "LocalPageRegistryRead";
    // Reported even when a site catches it and shows text (the probe reads the console).
    console.error(this);
  }
}

/** B4 wave 5 (scheduling only): the page's engine-body harness, which the
 * Local page registry build used to prepare in cooperative phases. With no
 * page registry, the page's first engine body (codec, labels, printing) would
 * build it synchronously; this starts the same asynchronous preparation
 * beside the worker catalogue. Completion means the required page tools are
 * ready; failure reaches the source's existing Retry path. The engine owner
 * clears its failed shared flight, so a later attempt can prepare it again. */
export async function prepareLocalPageHarness(): Promise<void> {
  await prepareEngineBodyDispatch();
}

/** One Local snapshot's registry identity: no registry, only a key (routing,
 * `ownedRegistries`, `registry !== reader.registry()` comparisons). Every
 * member read refuses with `LocalPageRegistryRead`, except `then` and symbol
 * keys, which answer `undefined` (Promise resolution and Solid probe them). A
 * restoration of the same snapshot reuses its token. */
export function createLocalRegistryToken(): ModuleRegistry {
  const refuse = (key: string | symbol): never => { throw new LocalPageRegistryRead(String(key)); };
  const token = new Proxy(Object.freeze(Object.create(null)) as object, {
    get: (_target, key) => key === "then" || typeof key === "symbol" ? undefined : refuse(key),
    has: (_target, key) => key === "then" || typeof key === "symbol" ? false : refuse(key),
    set: (_target, key) => refuse(key),
    defineProperty: (_target, key) => refuse(key),
    deleteProperty: (_target, key) => refuse(key),
  }) as ModuleRegistry;
  ownedRegistries.add(token);
  markLocalRegistryToken(token);
  return token;
}

const MISSING_SNAPSHOT_OWNER = "This Local session has no snapshot owner. Derive it from the reader's session instead of its registry.";

/** The session's routing owner: its Local snapshot owner, else its registry.
 * A session on a Local snapshot's registry without that owner refuses: it was
 * built beside the reader, and would otherwise silently run without a worker. */
function ownerOf(session: AuthoringSession): WorkerOwner {
  const owned = sessionOwners.get(session);
  if (owned) return owned;
  if (ownedRegistries.has(session.registry)) throw new Error(MISSING_SNAPSHOT_OWNER);
  return session.registry;
}

/** `owner` defaults to the registry; a Local snapshot passes its own owner. */
export function attachPreparedAuthoringWorker(registry: ModuleRegistry, catalog: AuthoringCatalogSnapshot, session: AuthoringSession,
  owner: WorkerOwner = registry): void {
  const client = byCatalog.get(catalog);
  if (!client || client.closed) throw new Error("The prepared authoring worker is unavailable.");
  assertCurrentSession(client.epoch);
  if (client.preparationPhase === "preparing") {
    client.preparationPhase = "attached";
    for (const seal of client.preparationLeases) seal();
    if (client.localSourceId && client.initializationId !== undefined) {
      try { controlAuthoringTransport(client.transport, { method: "seal-registry-preparation",
        initializationId: client.initializationId, localSourceId: client.localSourceId }); }
      catch (error) { dispose(client, "The Local registry preparation could not be closed."); throw error; }
    }
  }
  client.preparationCleanup?.();
  client.preparationCleanup = undefined;
  const prior = byOwner.get(owner);
  if (prior && prior !== client && prior.closed) retiredByOwner.set(owner, prior);
  byOwner.set(owner, client);
  if (owner !== registry) {
    sessionOwners.set(session, owner as PreparedSnapshotOwner);
    ownedRegistries.add(registry);
  }
  setWorkerRevision(revision => revision + 1);
  client.contexts.set(session, client.baseContext ??= { id: 0, configured: true });
  bySession.set(session, client);
  if (client.displayCatalog) installPreparedWorkspaceCatalog(registry, client.displayCatalog);
  if (!client.independent && accountFieldRegistryState()?.registry === registry) activatePreparedAuthoringWorker(registry);
}

/** Called after a checked same-account registry replaces the published state. */
export function activatePreparedAuthoringWorker(registry: ModuleRegistry): void {
  const client = byOwner.get(registry);
  if (!client || client.closed || client.independent) return;
  for (const previous of [...activeClients]) if (previous !== client && !previous.independent && previous.accountId === client.accountId) {
    dispose(previous, "The committed authoring snapshot changed.");
  }
}

/** A checked display projection belongs to this exact private owner. */
export function preparedAuthoringDisplayCatalog(owner: WorkerOwner): readonly CatalogSection[] | undefined {
  const client = byOwner.get(owner);
  return client && !client.closed ? client.displayCatalog : undefined;
}

/** A newer load may win while this prepared owner is still unpublished. */
export function discardPreparedAuthoringWorker(owner: WorkerOwner): void {
  const client = byOwner.get(owner);
  if (client) dispose(client, "A newer committed authoring snapshot replaced this preparation.");
}

/** Retire exactly the snapshot behind this handle, whichever owner it serves.
 * `keepRealm` (a Local rebuild) releases the snapshot and keeps its physically
 * settled realm warm for the same holder; the old reader's requests refuse. */
export function discardPreparedReaderWorker(handle: PreparedReaderWorker, options: { keepRealm?: boolean } = {}): void {
  const prepared = preparedReaderWorkers.get(handle);
  if (prepared) dispose(prepared.client, "A newer committed authoring snapshot replaced this preparation.", options.keepRealm === true);
}

/** Cancel an unbound catalog whose captured source roster was superseded.
 * It must never be attached or activate over the current committed worker. */
export function discardPreparedAuthoringCatalog(catalog: AuthoringCatalogSnapshot): void {
  const client = byCatalog.get(catalog);
  if (client) dispose(client, "The installed source snapshot changed during preparation.");
}

export function prepareModuleCatalogInWorker(owner: WorkerOwner, sourceModule: string, signal?: AbortSignal): Promise<AuthoringCatalogSnapshot> | undefined {
  const client = byOwner.get(owner);
  if (!client) return undefined;
  if (client.closed) return Promise.reject(new Error("This authoring snapshot was replaced. Retry with the current data."));
  return (async () => {
    const result = await request(client, { method: "module-catalog", sourceModule }, signal) as { catalog: AuthoringCatalogSnapshot };
    assertCurrentSession(client.epoch); signal?.throwIfAborted();
    moduleCatalogs.set(result.catalog, { client, owner, sourceModule });
    return result.catalog;
  })();
}

export function bindModuleAuthoringWorkerSession(session: AuthoringSession, catalog: AuthoringCatalogSnapshot): void {
  const prepared = moduleCatalogs.get(catalog);
  if (!prepared || prepared.client.closed || prepared.owner !== ownerOf(session) || prepared.sourceModule !== session.sourceModule) {
    throw new Error("The module authoring catalog does not belong to this session.");
  }
  assertCurrentSession(prepared.client.epoch);
  prepared.client.contexts.set(session, { id: 0, sourceModule: prepared.sourceModule, configured: true, catalog });
  bySession.set(session, prepared.client);
}

/** One physical lookup for requests and cached-reader liveness. Module
 * sessions are bound to this client's contexts by the checked catalog path
 * above; inspecting a snapshot does not create or admit a new context. */
function currentWorker(facadeOrSession: AuthoringSession): { session: AuthoringSession; client?: Client } {
  const session = concreteAuthoringSession(facadeOrSession);
  const bound = bySession.get(session);
  if (bound) {
    if (bound.closed) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
    assertCurrentSession(bound.epoch);
    return { session, client: bound };
  }
  const owned = sessionOwners.get(session);
  const descriptor = owned ? undefined : Object.getOwnPropertyDescriptor(session, "registry");
  if (descriptor && !("value" in descriptor)) return { session };
  const owner = ownerOf(session);
  const client = byOwner.get(owner);
  if (client?.closed) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
  if (client && !client.contexts.has(session) && retiredByOwner.get(owner)?.contexts.has(session)) {
    throw new Error("This authoring snapshot was replaced. Retry with the current data.");
  }
  if (client) assertCurrentSession(client.epoch);
  return { session, client };
}

/** The same detached scope admission serves authoring and read projections.
 * A fresh draft captures its own roster before its first read; it never borrows
 * the committed context. Module contexts still require their checked catalog. */
function workerContextForSession(client: Client, session: AuthoringSession,
  accountScope?: AccountAuthoringScope): Context | undefined {
  let context = client.contexts.get(session);
  if (!context) {
    if (session.mode !== "detached") return undefined;
    const mirroredScope = accountScope ?? localAuthoringScopeForSession(session);
    if (!mirroredScope || ("sourceId" in mirroredScope
      ? mirroredScope.sourceId !== client.localSourceId || client.accountId !== undefined
      : mirroredScope.accountId !== client.accountId || client.localSourceId !== undefined)) return undefined;
    context = { id: ++client.nextContext, scope: mirroredScope, configured: false };
    client.contexts.set(session, context);
    bySession.set(session, client);
  }
  return context;
}

/** Route by the current reader's session identity. Shared-registry drafts and
 * explicitly owned module sessions retain their own evaluation context, even
 * before their first worker request. Unknown field owners remain unavailable. */
export function localReadSession(base: AuthoringSession, inherited: AuthoringSession,
  fieldRegistry?: ModuleRegistry): AuthoringSession | undefined {
  if (fieldRegistry && fieldRegistry !== inherited.registry && fieldRegistry !== base.registry) return undefined;
  if (inherited !== base && (fieldRegistry ? fieldRegistry === inherited.registry : inherited.registry === base.registry)) return inherited;
  return !fieldRegistry || fieldRegistry === base.registry ? base : undefined;
}

/** B4 F1: `localReadSession` for a Local reader, without reading its page
 * sessions' registries. The reader's own field registry is recognised by
 * identity with its snapshot (`own`, `reader.registry()`), and a session of
 * this reader is one bound to the same snapshot owner: drafts and module
 * frames inherit it and share the snapshot's registry, so they win exactly as
 * a shared-registry session does above. Only a foreign inherited session's
 * registry is compared, for a foreign field owner. */
export function localReaderReadSession(base: AuthoringSession, inherited: AuthoringSession, own: ModuleRegistry,
  fieldRegistry?: ModuleRegistry): AuthoringSession | undefined {
  const owner = preparedSnapshotOwnerOf(base);
  const derived = inherited !== base && owner !== undefined && preparedSnapshotOwnerOf(inherited) === owner;
  if (!fieldRegistry || fieldRegistry === own) return derived ? inherited : base;
  // A superseded Local snapshot's registry is refused, never read on the page.
  if (registryHasSnapshotOwner(fieldRegistry)) return undefined;
  return !derived && inherited !== base && fieldRegistry === inherited.registry ? inherited : undefined;
}

/** Bind only a scope already captured by this reader's authoring session. */
export function preparedReaderWorkerForSession(facadeOrSession: AuthoringSession): PreparedReaderWorker | undefined {
  workerRevision();
  const { session, client } = currentWorker(facadeOrSession);
  const context = client && workerContextForSession(client, session);
  return client && context ? readerWorkerHandle(client, context) : undefined;
}

/** A cache stamp, never a capability or a worker selection by account name.
 * A replaced client gets a new token even for the same registry and login. */
export function authoringWorkerSnapshot(session: AuthoringSession): object | undefined {
  workerRevision();
  const { client } = currentWorker(session);
  if (!client) return undefined;
  let token = snapshotTokens.get(client);
  if (!token) { token = Object.freeze({}); snapshotTokens.set(client, token); }
  return token;
}

/** A retired worker is replaced by a publication or a restoration of the same
 * snapshot. Readers show their preparing state meanwhile, not a failure. */
export function authoringWorkerRetired(session: AuthoringSession): boolean {
  workerRevision();
  try { currentWorker(session); return false; }
  catch { return true; }
}

/** Undefined means this exact authority has no prepared worker. A module or
 * arbitrary draft registry must not run against an unrelated account registry. */
export function runAuthoringWorker(facadeOrSession: AuthoringSession, payload: AuthoringWorkerPayload,
  signal?: AbortSignal, accountScope?: AccountAuthoringScope, allowance?: "evaluation",
): Promise<AuthoringWorkerResult> | undefined {
  let selectedWorker: ReturnType<typeof currentWorker>;
  let observedMethod: AuthoringWorkerPayload["method"] | undefined;
  try {
    signal?.throwIfAborted();
    const method = Object.getOwnPropertyDescriptor(payload, "method");
    if (method && !Object.hasOwn(method, "value"))
      throw new TypeError("The prepared reader operation cannot be an accessor.");
    observedMethod = method && Object.hasOwn(method, "value") ? Reflect.get(payload, "method") : undefined;
    if (typeof observedMethod !== "string" || !Object.hasOwn(preparedReaderMethods, observedMethod))
      throw new TypeError("The prepared reader operation is unavailable.");
    selectedWorker = currentWorker(facadeOrSession);
  }
  catch (error) { return Promise.reject(error); }
  const { session, client } = selectedWorker;
  if (!client) return undefined;
  const context = workerContextForSession(client, session, accountScope);
  if (!context) return undefined;
  // Compatibility callers of equality-sensitive operations use the same
  // descriptor-faithful capture as direct prepared-reader requests.
  if (observedMethod === "project-reader-choice-selection" || observedMethod === "project-reader-list-selection"
    || observedMethod === "edit-reader-list-chips" || observedMethod === "project-reader-field-plan"
    || observedMethod === "decode-reader-numeric-text" || observedMethod === "encode-reader-numeric-text"
    || observedMethod === "project-reader-numeric-codec" || observedMethod === "project-reader-record-slots"
    || observedMethod === "edit-reader-record-field" || observedMethod === "project-reader-values"
    || observedMethod === "project-reader-instance-methods-type")
    return runPreparedReaderWorker(readerWorkerHandle(client, context), payload, signal);
  return runWorkerContext(client, context, payload, signal, observedMethod, allowance);
}

function runWorkerContext(client: Client, selected: Context, payload: AuthoringWorkerPayload & {
  sourceModule?: undefined; scope?: undefined;
}, signal?: AbortSignal, expectedMethod?: AuthoringWorkerPayload["method"], allowance?: "evaluation"): Promise<AuthoringWorkerResult> {
  return (async () => {
    assertCurrentSession(client.epoch);
    const invoke = () => {
      if (client.closed) throw new Error("These editing tools were replaced by a newer account snapshot.");
      assertCurrentSession(client.epoch);
      const outgoing = { ...payload, sourceModule: undefined, scope: undefined, contextId: selected.id,
        ...(selected.sourceModule ? { sourceModule: selected.sourceModule } : {}),
        ...(!selected.configured && selected.scope ? { scope: selected.scope } : {}),
      };
      if (!Object.hasOwn(outgoing, "method") || outgoing.method !== expectedMethod)
        throw new TypeError("The prepared reader operation changed while its request was captured.");
      if (client.closed) throw new Error("These editing tools were replaced by a newer account snapshot.");
      // This boundary alone proves a request belongs to this exact reader.
      // Preparation, neutral borrowing and ordinary/storage requests stay unowned.
      return requestAuthoringTransport(client.transport, outgoing, signal, undefined, client, allowance);
    };
    let result: AuthoringWorkerResult;
    try { result = await invoke(); }
    catch (error) {
      if (!(error instanceof WorkerRequestError) || error.code !== "context-missing" || !selected.scope) throw error;
      selected.configured = false;
      result = await invoke();
    }
    if (client.closed) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
    selected.configured = true;
    assertCurrentSession(client.epoch);
    signal?.throwIfAborted();
    return result;
  })();
}

export function rankAuthoringSuggestions<T extends AuthoringFunctionEntry>(entries: readonly T[], expected: AuthoringExpectedType | undefined,
  options: AuthoringSuggestionOptions, session: AuthoringSession, signal?: AbortSignal, accountScope?: AccountAuthoringScope,
): Promise<AuthoringFunctionSuggestion<T>[]> | undefined {
  return runAuthoringWorker(session, { method: "rank-suggestions", entries, expected,
    options: { mode: options.mode, inputScheme: options.inputScheme },
  }, signal, accountScope) as Promise<AuthoringFunctionSuggestion<T>[]> | undefined;
}

/** B4 unit C: the saved sources a request carries. An Account, public or
 * detached reader lowers the expression on the page with its own session
 * (`authoringExpressionSourceEntries`) and sends exactly what that lowering
 * read, as before. A Local reader's page session is not read: the request
 * carries the sources the expression reaches (`reachedSavedSources`, the
 * codec's session-free reference walk) with `selectSavedSources`, and the
 * worker runs that same lowering over them with its own session. A Local
 * reader whose worker is missing, closed or stale sends them too (the request
 * then refuses or goes nowhere), never a page lowering. */
function requestSavedSources(session: AuthoringSession, nodes: readonly ExprNode[], savedExpressions: ReadonlyMap<string, ExprNode>): {
  savedExpressions: Array<readonly [string, ExprNode]>; savedDeclarations?: Array<readonly [string, import("../saved-expression-map").SavedExpressionDeclaration]>;
  selectSavedSources?: true;
} {
  let pageLowers = false;
  try { const { client } = currentWorker(session); pageLowers = client !== undefined && client.localSourceId === undefined; }
  catch { pageLowers = false; }
  if (!pageLowers) {
    const library = reachedSavedSources(nodes, id => savedExpressions.get(id));
    const savedDeclarations = savedExpressionDeclarationEntries(library);
    return { savedExpressions: library, ...(savedDeclarations.length ? { savedDeclarations } : {}), selectSavedSources: true };
  }
  const sources = new Map<string, ExprNode>();
  for (const node of nodes) for (const [id, source] of authoringExpressionSourceEntries(node, savedExpressions, session)) sources.set(id, source);
  const entries = [...sources];
  const savedDeclarations = savedExpressionDeclarationEntries(entries);
  return { savedExpressions: entries, ...(savedDeclarations.length ? { savedDeclarations } : {}) };
}

/** Run a card through the worker attached to this exact authoring snapshot.
 * `undefined` means no worker is attached; a rejected job must not be rerun
 * synchronously. The same client fences epoch, registry replacement and abort,
 * and catches structured-clone failures at its existing message boundary. */
export function evaluateExpressionInWorker(session: AuthoringSession, node: ExprNode,
  savedExpressions: ReadonlyMap<string, ExprNode>, signal?: AbortSignal, accountScope?: AccountAuthoringScope,
  options: { capture?: import("./authoring-worker-protocol").EvaluationCapture; admitInvocations?: boolean; sourceMetadata?: import("../reader-source-metadata").ReaderSourceMetadataCapture;
    /** B4 slice 2: check the evaluated value in the same request (`issue`). */
    admission?: ExpressionAdmissionInput; priority?: "guidance";
    /** B4 F2: the same run's trace steps (a Local live trace). */
    trace?: boolean;
    /** Suggestion previews: the worker evaluates in the reduced pure frame. */
    pure?: boolean;
    /** A data card's own evaluation: it may run up to AUTHORING_EVALUATION_ALLOWANCE_MS. */
    cardEvaluation?: true } = {},
): Promise<AuthoringExpressionAdmittedEvaluation> | undefined {
  const sourceMetadata = options.sourceMetadata ?? captureReaderSourceMetadata(session);
  if (sourceMetadata) assertReaderSourceMetadata(sourceMetadata, session);
  const sources = requestSavedSources(session, [node], savedExpressions);
  const rootDeclaration = savedExpressionDeclaration(node);
  const job = runAuthoringWorker(session, { method: "evaluate-expression", node,
    ...sources, ...(options.capture ? { capture: options.capture } : {}),
    ...(rootDeclaration ? { rootDeclaration } : {}),
    ...(options.admitInvocations ? { admitInvocations: true } : {}),
    ...(options.admission ? { admission: options.admission } : {}), ...(options.priority ? { priority: options.priority } : {}),
    ...(options.trace ? { trace: true } : {}), ...(options.pure ? { pure: true } : {}),
    ...(sourceMetadata ? { sourceMetadata: sourceMetadata.packet } : {}) }, signal, accountScope, options.cardEvaluation ? "evaluation" : undefined) as Promise<AuthoringExpressionEvaluation> | undefined;
  return job?.then(result => {
    if (sourceMetadata) assertReaderSourceMetadata(sourceMetadata, session);
    if (options.admission && (!ownProjectionRecord(result) || (Object.hasOwn(result, "issue") && typeof (result as { issue?: unknown }).issue !== "string")))
      throw new Error("The authoring worker response could not be read.");
    return result as AuthoringExpressionAdmittedEvaluation;
  });
}

/** B4 slice 2: one editor root's live inference batch (`infer-expression`) in
 * the worker attached to this exact session. Saved sources are captured as for
 * `evaluate-expression`, once for the whole batch. `undefined` means no worker
 * is attached; the caller shows no verdict (checking), never a page result. */
export function inferExpressionsInWorker(session: AuthoringSession, items: readonly ExpressionInferenceItem[],
  savedExpressions: ReadonlyMap<string, ExprNode>,
  options: { sourceMetadata?: import("../reader-source-metadata").ReaderSourceMetadataCapture; priority?: "guidance" } = {},
  signal?: AbortSignal,
): Promise<readonly ExpressionInferenceReply[]> | undefined {
  if (items.length > LIVE_INFERENCE_BATCH_LIMIT) return Promise.reject(new RangeError("Too many live inference items in one request."));
  const sourceMetadata = options.sourceMetadata ?? captureReaderSourceMetadata(session);
  if (sourceMetadata) assertReaderSourceMetadata(sourceMetadata, session);
  const sources = requestSavedSources(session, items.map(item => item.node), savedExpressions);
  const outgoing = items.map(item => {
    const rootDeclaration = savedExpressionDeclaration(item.node);
    return rootDeclaration ? { ...item, rootDeclaration } : item;
  });
  const job = runAuthoringWorker(session, { method: "infer-expression", items: outgoing,
    ...sources, ...(options.priority ? { priority: options.priority } : {}),
    ...(sourceMetadata ? { sourceMetadata: sourceMetadata.packet } : {}) }, signal);
  return job?.then((result: unknown) => {
    if (sourceMetadata) assertReaderSourceMetadata(sourceMetadata, session);
    const inferences = ownProjectionRecord(result) ? (result as { inferences?: unknown }).inferences : undefined;
    // A batch that yielded to other work answers a prefix of its items.
    const yielded = ownProjectionRecord(result) && (result as { yielded?: unknown }).yielded === true;
    if (!Array.isArray(inferences) || (yielded ? inferences.length >= items.length : inferences.length !== items.length)
      || inferences.some(row => !ownProjectionRecord(row) || !ownProjectionRecord((row as { outcome?: unknown }).outcome)))
      throw new Error("The authoring worker response could not be read.");
    return inferences as ExpressionInferenceReply[];
  });
}

/** B4 slice 1: Save-time admission (`draftSaveIssue`, with same-request
 * evaluation when `evaluate` is set) in the worker attached to this exact
 * session. Inputs are captured as `evaluateExpressionInWorker` captures them.
 * `undefined` means no worker is attached: the caller refuses Save, never
 * falls back to the page. The reply is advisory; writes keep their own CAS and
 * Fenel validation. */
export function expressionSaveIssueInWorker(session: AuthoringSession, node: ExprNode,
  savedExpressions: ReadonlyMap<string, ExprNode>,
  options: Pick<ExpressionSaveIssueInput, "expectedType" | "expectedScheme" | "expectedTypeName" | "actualTypeName" | "expectedListType" | "evaluate" | "priority" | "creationValidation">
    & { sourceMetadata?: import("../reader-source-metadata").ReaderSourceMetadataCapture } = {},
  signal?: AbortSignal,
): Promise<AuthoringFunctionBodySaveIssue> | undefined {
  const sourceMetadata = options.sourceMetadata ?? captureReaderSourceMetadata(session);
  if (sourceMetadata) assertReaderSourceMetadata(sourceMetadata, session);
  const sources = requestSavedSources(session, [node], savedExpressions);
  const rootDeclaration = savedExpressionDeclaration(node);
  const job = runAuthoringWorker(session, { method: "expression-save-issue", node, ...sources,
    ...(rootDeclaration ? { rootDeclaration } : {}),
    ...(options.expectedType === undefined ? {} : { expectedType: options.expectedType }),
    ...(options.expectedScheme === undefined ? {} : { expectedScheme: options.expectedScheme }),
    ...(options.expectedTypeName === undefined ? {} : { expectedTypeName: options.expectedTypeName }),
    ...(options.actualTypeName === undefined ? {} : { actualTypeName: options.actualTypeName }),
    ...(options.expectedListType === undefined ? {} : { expectedListType: options.expectedListType }),
    ...(options.creationValidation ? { creationValidation: true } : {}),
    ...(options.evaluate ? { evaluate: true } : {}), ...(options.priority ? { priority: options.priority } : {}),
    ...(sourceMetadata ? { sourceMetadata: sourceMetadata.packet } : {}) }, signal);
  return job?.then((result: unknown) => {
    if (sourceMetadata) assertReaderSourceMetadata(sourceMetadata, session);
    if (!ownProjectionRecord(result) || Reflect.ownKeys(result).some(key => key !== "issue" && key !== "validation")
      || (result.issue !== undefined && typeof result.issue !== "string"))
      throw new Error("The authoring worker response could not be read.");
    return result as AuthoringFunctionBodySaveIssue;
  });
}

/** Discovery shares this reader's existing worker and cancellation boundary.
 * A missing prepared worker remains unavailable; a failed job is never retried
 * against another reader or on the input thread. */
export function discoverDataSuggestionsInWorker(session: AuthoringSession,
  input: DataSuggestionInput,
  options: DataSuggestionWorkerOptions = {},
  signal?: AbortSignal, accountScope?: AccountAuthoringScope,
): Promise<DataSuggestionBatch> | undefined {
  return runAuthoringWorker(session, { method: "discover-data-suggestions", input, options }, signal, accountScope) as Promise<DataSuggestionBatch> | undefined;
}

/** Selection rechecks the ordinary expression in the same worker as discovery.
 * The UI cannot accept a transported verdict or retry on its input thread. */
export function prepareDataSuggestionInWorker(session: AuthoringSession,
  suggestion: DataSuggestion, input: DataSuggestionInput,
  signal?: AbortSignal, accountScope?: AccountAuthoringScope,
): Promise<DataSuggestionPreparation> | undefined {
  return runAuthoringWorker(session, { method: "prepare-data-suggestion", input, suggestion }, signal, accountScope) as Promise<DataSuggestionPreparation> | undefined;
}
