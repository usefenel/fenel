import { dispatchRegistry, getCatalog, registerCatalogEntities, type CatalogSection } from "@fenel/engine";
import { createAccountFieldRegistry } from "@fenel/engine/account-field-registry";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import { modulesFor } from "@fenel/engine/module-manifest";
import { inferAuthoringFunctionDraft, judgeAuthoringSchemeCompatibility, rankAuthoringFunctionSuggestions, type AuthoringFunctionSuggestion } from "@fenel/engine/authoring/environment";
import type { AuthoringCatalogSnapshot } from "@fenel/engine/authoring/environment";
import type { FenelType, TypeScheme } from "@fenel/engine/types";
import type { AuthoringFunctionEntry, ExprNode } from "@fenel/engine/authoring/expression";
import { buildSessionCatalog, environmentForCatalog, evaluateContextForCatalog } from "./authoring-catalog";
import repositoryCatalogueIndex from "../generated/authoring-catalogue.json";
import publicRepositoryCatalogueIndex from "../generated/repository-authoring-catalogue.json";
import { AUTHORING_CATALOGUE_SCHEMA, chunkIntegrity, loadAuthoringCatalogue, localCatalogue, realmRepositoryCatalogue,
  repositoryCatalogueRealmKey, repositoryOnlyCatalogue, REPOSITORY_CATALOGUE_SOURCE_ID,
  type AuthoringCatalogueIndex, type LocalCatalogueInput } from "./authoring-catalogue-artifact";
import { REPOSITORY_IDENTITY_MANIFEST } from "@fenel/engine/repository-identity-manifest";
import { createBrowserDataStorage, LOCAL_BROWSER_SOURCE_ID } from "../browser-data-storage";
import { assertLocalOrdinaryOperation, runLocalOrdinaryOperation } from "../local-ordinary-operations";
import { loadWorkspaceModel } from "../workspace-model-loader";
import { createDetachedAuthoringEnvironment } from "./detached-authoring-environment";
import { createAccountAuthoringSession, createLocalAuthoringSession, type AuthoringSession } from "./account-authoring-session";
import { buildReaderFieldRegistry, buildLocalReaderFieldRegistry, queryLocalFieldAuthoringCatalog,
  queryLocalFieldAuthoringIdentity, queryLocalFieldResurrectionCatalog } from "../reader-registry";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";
import { mintAnonymousAuthority } from "../../../../../../implementations/typescript/runtime/src/authority-mint";
import { repositorySourceModuleProjection } from "@fenel/engine/authoring/source-module";
import { adaptTransferToTarget, expressionForTransfer, typeForTransfer } from "../data-transfer/expressions";
import { authoringExpressionAdmissionRequired, authoringExpressionLogic, authoringExpressionSourceEntries, evaluateAuthoringExpressionInSession, transferableTrace } from "./expression-evaluation";
import type { AuthoringWorkerRequest, AuthoringWorkerMessage, AuthoringWorkerResult, ExpressionInferenceReply, WorkspaceTransferAnalysis } from "./authoring-worker-protocol";
import { expressionMediaScheduling } from "../saved-expression-identity";
import { discoverDataSuggestions, functionMarkedInternal, prepareDataSuggestion, scopedExpectedType, scopedResultRequirement } from "../data-suggestions";
import { yieldToInput } from "./async-suggestions";
import { readerSourceMetadataEvaluateContext, resolveRuntimeRepresentationMethod, runtimeRepresentationNativeContext } from "@fenel/engine/expressions";
import type { ReaderSourceMetadataCapture } from "../reader-source-metadata";
import { restoreSavedExpressionDeclaration, restoreSavedExpressionDeclarations, type SavedExpressionDeclaration } from "../saved-expression-map";
import { draftSaveIssue, draftSaveValidation, functionBodySaveIssue } from "./creation-validation";
import { inferScopedAuthoringExpression, literalMembershipFor } from "./literal-membership";
import { judgeAuthoringResult } from "./result-judgment";
import { LIVE_INFERENCE_BATCH_LIMIT } from "./live-guidance-limits";
import { peelListForAuthoring, resolveValueType } from "@fenel/engine/authoring/type";
import { fieldChoiceSelectionPlan, fieldListChipsSelectionPlan, fieldListChipsEditPlan, fieldReaderPlan, fieldNumericTextCodecPlan, fieldRecordSlotsPlan, fieldRecordEditPlan } from "@fenel/engine/authoring/field-render";
import { runNumericTextCodec } from "../numeric-text-codec";
import { isReaderExtensionMethod, runReaderExtension } from "./authoring-worker-reader-extensions";
import { createReaderPresentation, projectReaderTypeDescriptionsInSession, projectReaderTypePreviewInSession, projectReaderValueReadInSession, representationsFromReaderSnapshot,
  type ReaderPresentationSource } from "../reader-presentation";
import { assertProxyTrackingPrecededEngine } from "../../../../../../implementations/typescript/engine/src/proxy-tracking";
import { checkRegistryPreparationBuild, runRegistryPreparation, registryPreparationFailure } from "../../../../../../implementations/typescript/engine/src/field-identity-worker-client";
import { AUTHORING_BUILD_IDENTITY } from "./authoring-build-identity";
import { clearEngineBodyMemoPartition, REPOSITORY_PARTITION, withEngineBodyMemoPartition } from "../../../../../../implementations/typescript/engine/src/engine-body-memo";

import { coreValueSuggestions } from "../home-search/core-value-suggestions-operation";

// S1b: the realm's entry (authoring-catalog.worker.ts) installs Proxy tracking
// before this module graph evaluates. A broken entry fails here, loudly.
assertProxyTrackingPrecededEngine();

const scope = globalThis as unknown as { onmessage: (event: { data: AuthoringWorkerRequest }) => void; postMessage: (value: AuthoringWorkerMessage) => void };
let base: AuthoringSession | undefined;
// Existing S1 storage, private to one adopted reader snapshot. A source-id-only
// partition would let a replacement snapshot reuse its predecessor's entries.
let nextPhysicalPreviewSnapshot = 0;
let physicalPreviewPartition: string | undefined;
let readerPresentationSource: Pick<ReaderPresentationSource, "catalog" | "types" | "functionRows"> | undefined;
let localFieldSource: { sourceId: string; snapshot: FieldPersistenceSnapshot } | undefined;
// Transport generation only. A retired initialization cannot lend its warm
// realm to an older page build, even when the catalogue data are unchanged.
let localPreparationInitialization: number | undefined;
// Lane S (Nov 8): this realm holds a repository-only (public) snapshot, whose
// checked registry build filled the repository memo partition. The page's own
// build of the same repository may then borrow its preparation steps.
let repositoryOnlySnapshot = false;
const contexts = new Map<number, AuthoringSession>();
const moduleContexts = new Map<string, { catalog: AuthoringCatalogSnapshot; session: AuthoringSession }>();
const cancelled = new Set<number>();
const active = new Set<number>();
function beginWorkerJob(id: number): void {
  if (active.has(id)) return;
  active.add(id);
  scope.postMessage({ id, event: "started", startedAt: performance.timeOrigin + performance.now() });
}
function finishWorkerJob(id: number): void {
  if (active.delete(id)) scope.postMessage({ id, event: "finished" });
}
const discoveryAborts = new Map<number, AbortController>();
// Storage is source-owned browser IO, independent of a prepared reader. Its
// realm-local policy loader survives snapshot release; no reader/frame does.
let localStorage: ReturnType<typeof createBrowserDataStorage> | undefined;
const storageAborts = new Map<number, AbortController>();
// Pure ordinary operations share storage's existing realm-local model. This
// generation only fences replies that awaited preparation across release.
let ordinaryGeneration = 0;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const rankOrder = { direct: 0, adaptable: 1, mismatch: 2, unavailable: 3 };

function moduleContext(sourceModule: string) {
  const cached = moduleContexts.get(sourceModule);
  if (cached) return cached;
  if (!base) throw new Error("The editing worker is not ready.");
  const catalog = buildSessionCatalog(base.registry, sourceModule);
  const environment = environmentForCatalog(catalog, base.registry);
  const session: AuthoringSession = Object.freeze({ mode: "module", sourceModule,
    registry: base.registry, catalog: environment.catalog, environment, evaluateContext: base.evaluateContext });
  const result = { catalog, session };
  if (moduleContexts.size >= 8) moduleContexts.delete(moduleContexts.keys().next().value!);
  moduleContexts.set(sourceModule, result);
  return result;
}

type WorkerJob = Exclude<AuthoringWorkerRequest, { method: "cancel" | "release" | "seal-registry-preparation" }>;
type EvalJob = Extract<WorkerJob, { method: "evaluate-expression" }>;
type Slice = { id: number; kind: "picture" | "sound"; step: () => boolean };
const waiting: WorkerJob[] = [];
const weights = new WeakMap<WorkerJob, number>();
type PreparedEvaluation = { session?: AuthoringSession; node?: ExprNode; sourceMetadata?: ReaderSourceMetadataCapture;
  media?: ReturnType<typeof expressionMediaScheduling>; requiresAdmission?: boolean; capture?: boolean; error?: unknown };
const evaluationJobs = new WeakMap<EvalJob, PreparedEvaluation>();
const parked: Slice[] = [];
let slice: Slice | undefined;
let pumping = false;
const SLICE_BUDGET_MS = 32;
/** B4 slice 2: how long a guidance batch runs before it looks for other work. */
const LIVE_INFERENCE_SLICE_MS = 8;

// Queue classes (2026-11-11, host scheduling only). Every weight-0 job is one of:
// - ordered: replaces or prepares realm state (the snapshot, browser storage,
//   registry preparation). It keeps its arrival position among weight-0 jobs:
//   it passes nothing and nothing passes it.
// - heavy: a derived computation of unbounded length (an evaluation, a check,
//   an inference, printed text, suggestion discovery). It reads the prepared
//   sessions and writes no realm state except its own context (see `pinned`).
// - light: everything else (display reads, ordinary operations, short plans).
// A light job may start before heavy jobs that arrived earlier, never before
// an ordered one. Light jobs keep their own arrival order, heavy jobs theirs.
const ORDERED_METHODS: ReadonlySet<string> = new Set(["initialize", "load-local-storage", "commit-local-storage",
  "prepare-registry-step", "prepare-repository-registry-step", "repository-namespaces", "module-catalog"]);
const HEAVY_METHODS: ReadonlySet<string> = new Set(["evaluate-expression", "expression-save-issue", "function-body-save-issue",
  "infer-expression", "infer-function-draft", "print-reader-expression-text", "discover-data-suggestions",
  "prepare-data-suggestion", "rank-suggestions", "analyze-transfer"]);
/** No starvation: once light jobs have run for this long ahead of a waiting
 * heavy job, the oldest heavy job runs. Each passing job counts at least 1 ms. */
const LIGHT_STREAK_LIMIT_MS = 10_000;
/** A guidance job (weight 3) starts only after the page had this long to
 * answer the last foreground reply (a parent read's children arrive then). */
const GUIDANCE_QUIET_MS = 150;
/** ...and is never held back longer than this by a trickle of foreground work. */
const GUIDANCE_QUIET_LIMIT_MS = 2_000;
let lightStreak = 0;
// False while messages may be posted but undelivered: after a message arrived
// (the rest of its burst follows it) and after a job ran. A deferred job
// (heavy, media or guidance) then starts only after one turn of the message
// queue, so a read already posted is seen and runs first.
let inboxDrained = true;
let foregroundSerial = 0;
let foregroundAt = Number.NEGATIVE_INFINITY;
let quietSerial = -1;
let quietSince: number | undefined;
function foregroundActivity(): void { foregroundSerial++; foregroundAt = performance.now(); }

type SavedSourceInput = { savedExpressions: readonly (readonly [string, ExprNode])[];
  savedDeclarations?: readonly (readonly [string, SavedExpressionDeclaration])[] };
const savedSelections = new WeakMap<object, SavedSourceInput>();
/** B4 unit C: a Local reader's request carries its whole saved library
 * (`selectSavedSources`). The page's former step runs here instead: the
 * canonical lowering (`authoringExpressionSourceEntries`) through this
 * session's own environment keeps exactly the sources it reads, and the
 * declarations of those sources only, in that order. Every handler then reads
 * the same input the page used to send. A request without the flag is the
 * page's own selection (Account, public, detached), unchanged. Computed once
 * per request; the request itself is never modified. */
function savedSources(data: SavedSourceInput & { selectSavedSources?: true }, nodes: readonly ExprNode[],
  session: AuthoringSession): SavedSourceInput {
  if (!Object.hasOwn(data, "selectSavedSources")) return data;
  const cached = savedSelections.get(data);
  if (cached) return cached;
  if (data.selectSavedSources !== true || !Array.isArray(data.savedExpressions)
    || (data.savedDeclarations !== undefined && !Array.isArray(data.savedDeclarations)))
    throw new TypeError("The saved sources could not be read.");
  const library = new Map<string, ExprNode>(data.savedExpressions);
  const retained = new Map<string, ExprNode>();
  for (const node of nodes) for (const [id, source] of authoringExpressionSourceEntries(node, library, session)) retained.set(id, source);
  const declarations = new Map(data.savedDeclarations ?? []);
  const kept = [...retained.keys()].flatMap(id => declarations.has(id) ? [[id, declarations.get(id)!] as const] : []);
  const selected: SavedSourceInput = { savedExpressions: [...retained], ...(kept.length ? { savedDeclarations: kept } : {}) };
  savedSelections.set(data, selected);
  return selected;
}

function prepareEvaluation(data: EvalJob) {
  const existing = evaluationJobs.get(data);
  if (existing) return existing;
  // Scheduling may inspect several media jobs before selecting one. Its first
  // per-job preparation is already work, so it shares the execution deadline.
  beginWorkerJob(data.id);
  let prepared: PreparedEvaluation;
  try {
    const baseSession = sessionFor(data);
    if (baseSession) {
      const frame = readerSourceMetadataEvaluateContext(baseSession.evaluateContext, data.sourceMetadata);
      const session = frame === baseSession.evaluateContext ? baseSession : Object.freeze({ ...baseSession, evaluateContext: frame });
      const sourceMetadata = data.sourceMetadata ? { session, packet: data.sourceMetadata,
        generationToken: Object.freeze({}), current: () => !cancelled.has(data.id) } : undefined;
      const sources = savedSources(data, [data.node], session);
      const saved = new Map(sources.savedExpressions);
      restoreSavedExpressionDeclarations(saved, sources.savedDeclarations);
      const node = data.rootDeclaration ? restoreSavedExpressionDeclaration(data.node, data.rootDeclaration) : data.node;
      const requiresAdmission = (data.admitInvocations || data.rootDeclaration || sources.savedDeclarations?.length)
        ? authoringExpressionAdmissionRequired(node, id => saved.get(id), session, data.admitInvocations) : false;
      // B4 wave 4 lane S: "unless-sampled" is the page's former decision, made
      // here with the same facts: record unless the run renders sampled media.
      // Unsampled facts never slice, so the capture flag changes nothing else.
      const unlessSampled = data.capture === "unless-sampled";
      const media = expressionMediaScheduling(node, saved, session, { capture: unlessSampled ? false : data.capture === true });
      const capture = unlessSampled ? !media.sampled : data.capture === true;
      prepared = { session, node, sourceMetadata, requiresAdmission, media, capture };
    } else prepared = {};
  } catch (error) { prepared = { error }; }
  evaluationJobs.set(data, prepared);
  return prepared;
}

/** 0 runs now, 1 is a picture the reader is waiting on, 2 is audio or a movie.
 * Save admission (`expression-save-issue`) stays 0: a reader waits on it, and
 * it is sent only from a Save handler, never from a memo or a mount.
 * 3 is live editor guidance (B4 slice 2, `priority: "guidance"`): it runs only
 * when no other job and no media slice waits. Its weight is read from the
 * request alone, so a queued guidance job starts no preparation clock. */
function weight(data: WorkerJob): number {
  const cached = weights.get(data);
  if (cached !== undefined) return cached;
  let value = 0;
  if ("priority" in data && data.priority === "guidance") value = 3;
  else if (data.method === "evaluate-expression") {
    value = prepareEvaluation(data).media?.weight ?? 0;
  }
  weights.set(data, value);
  return value;
}

/** B4 F2: the page's `judgeAuthoringSchemeCompatibility`; a throw abstains. */
function readerCompatibility(scheme: TypeScheme | undefined, expected: FenelType | TypeScheme, registry: AuthoringSession["registry"]) {
  if (scheme === undefined) return "unknown" as const;
  try { return judgeAuthoringSchemeCompatibility(scheme, expected, { registry }); }
  catch { return "unknown" as const; }
}

function take(match: (job: WorkerJob) => boolean): WorkerJob | undefined {
  const index = waiting.findIndex(match);
  if (index < 0) return undefined;
  return waiting.splice(index, 1)[0];
}

/** The next weight-0 job. The oldest one, as before, unless it is heavy: then
 * the oldest light job behind it goes first, provided that
 * - no ordered job stands between them (nothing passes an ordered job);
 * - it shares no scoped context with a job it would pass: a request that
 *   carries a `scope` creates its context, so requests of one context keep
 *   their arrival order whenever one of them carries a scope;
 * - light jobs have not already run `LIGHT_STREAK_LIMIT_MS` ahead of it.
 * Jobs behind the head are classified from the request alone: a queued
 * evaluation is never prepared (its clock never started) by this scan. */
function nextForeground(): { job: WorkerJob; heavy: boolean; passes: boolean } | undefined {
  const head = waiting.findIndex(job => weight(job) === 0);
  if (head < 0) return undefined;
  const first = waiting[head]!;
  if (!HEAVY_METHODS.has(first.method)) { lightStreak = 0; return { job: first, heavy: false, passes: false }; }
  if (lightStreak < LIGHT_STREAK_LIMIT_MS) {
    // Context id -> whether a passed job of that context carries its scope.
    const passed = new Map<number, boolean>();
    const note = (job: WorkerJob) => {
      const id = (job as { contextId?: unknown }).contextId;
      if (typeof id === "number" && id !== 0) passed.set(id, passed.get(id) === true || (job as { scope?: unknown }).scope !== undefined);
    };
    note(first);
    for (let index = head + 1; index < waiting.length; index++) {
      const job = waiting[index]!;
      if (ORDERED_METHODS.has(job.method)) break;
      if (job.method === "evaluate-expression" || HEAVY_METHODS.has(job.method)) { note(job); continue; }
      if ("priority" in job && job.priority === "guidance") continue;
      const id = (job as { contextId?: unknown }).contextId;
      const pinned = typeof id === "number" && id !== 0 && passed.has(id)
        && (passed.get(id) === true || (job as { scope?: unknown }).scope !== undefined);
      if (!pinned) return { job, heavy: false, passes: true };
      note(job);
    }
  }
  return { job: first, heavy: true, passes: false };
}

function nativeCall(session: AuthoringSession, id: string): NonNullable<AuthoringSession["evaluateContext"]["nativesCtx"]>[string] | undefined {
  const fn = session.evaluateContext.nativesCtx?.[id];
  return typeof fn === "function" ? fn : undefined;
}

function sessionFor(data: EvalJob): AuthoringSession | undefined {
  if (!base) throw new Error("The editing worker is not ready.");
  const contextualBase = data.sourceModule ? moduleContext(data.sourceModule).session : base;
  let session = data.contextId === 0 ? contextualBase : contexts.get(data.contextId);
  if (data.scope) {
    session = "sourceId" in data.scope ? createLocalAuthoringSession(contextualBase, data.scope)
      : createAccountAuthoringSession(contextualBase, data.scope);
    if (contexts.size >= 16) contexts.delete(contexts.keys().next().value!);
    contexts.set(data.contextId, session);
  }
  if (!session) {
    scope.postMessage({ id: data.id, ok: false, error: "The authoring context needs to be refreshed.", code: "context-missing" });
    return undefined;
  }
  return session;
}

/** The build-owned repository catalogue (generate-public-bootstrap.mjs) for
 * an admissible Local input, or undefined. Its index is a checked generated
 * module; every chunk must match the index digest. */
async function readRepositoryCatalogue(data: Pick<LocalCatalogueInput, "localSourceId">, signal: AbortSignal,
  // Lane S (Nov 8): the public worker reads its own repository-only projection
  // (generated/repository-authoring-catalogue*) through this same verified read.
  index = repositoryCatalogueIndex as unknown as AuthoringCatalogueIndex, directory = "authoring-catalogue") {
  // Bundled index (checked at the serving boundary): the chunk requests leave
  // synchronously, so they download while the registry builds.
  if (index.schema !== AUTHORING_CATALOGUE_SCHEMA || index.sourceId !== data.localSourceId
    || index.identityDigest !== REPOSITORY_IDENTITY_MANIFEST.digest) return undefined;
  const base = new URL(`${import.meta.env.BASE_URL}generated/${directory}/`, globalThis.location.href);
  const result = await loadAuthoringCatalogue(index, async (file, sha256) => {
    // The browser verifies each chunk against its recorded digest (SRI).
    const response = await fetch(new URL(file, base), { signal, integrity: chunkIntegrity(sha256) });
    if (!response.ok) throw new Error("The repository catalogue is unavailable.");
    return response.text();
  }, { readerVerifies: true });
  return result && { index, result };
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Sample a picture or a sound in short stretches so a track cannot hold the
 *  worker for the whole page. Returns "plain" when the ordinary evaluator
 *  should run the job instead. */
function startSlice(data: WorkerJob): Slice | "plain" | "finished" {
  if (data.method !== "evaluate-expression") return "plain";
  // Include selected-job preparation and argument evaluation in its lifetime.
  // A plain fallback shares this start with run(), rather than resetting it.
  beginWorkerJob(data.id);
  const prepared = prepareEvaluation(data);
  if ("error" in prepared || !prepared.session) return "plain";
  // A2: this host sampler cannot retain private per-run callable contracts.
  // Pick the ordinary strategy before evaluating any argument or sample.
  // B4 slice 2: a checked evaluation needs the whole value for its check.
  // A pure preview keeps the reduced frame for every argument and sample.
  if (prepared.requiresAdmission || data.admission !== undefined || data.pure === true) return "plain";
  // Source admission keeps capture, exact arity and ordinary-call fences.
  const kind = prepared.media?.slice;
  const root = prepared.media?.root;
  if (!kind || !root) return "plain";
  const saved = new Map(savedSources(data, [data.node], prepared.session).savedExpressions);
  const session = prepared.session;
  try {
    if (kind === "picture") {
      const sample = nativeCall(session, "picture:sample") ?? nativeCall(session, "sample");
      if (!sample) return "plain";
      const picture = evaluateAuthoringExpressionInSession(root.args[0]!, id => saved.get(id), session, {},
        { trace: false, ...(prepared.sourceMetadata ? { sourceMetadata: prepared.sourceMetadata } : {}) }).result;
      // Fenel admission already checked these exact slots as finite numeric
      // literals. Read them after the first argument, in declared call order.
      const width = (root.args[1] as Extract<ExprNode, { kind: "literal" }>).value as number;
      const height = (root.args[2] as Extract<ExprNode, { kind: "literal" }>).value as number;
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      const pixels: unknown[] = new Array(w * h);
      const ctx = session.evaluateContext;
      let y = 0;
      return { id: data.id, kind: "picture", step: () => {
        if (cancelled.has(data.id)) { cancelled.delete(data.id); finishWorkerJob(data.id); return true; }
        const started = performance.now();
        while (y < h && performance.now() - started < SLICE_BUDGET_MS) {
          for (let x = 0; x < w; x++) pixels[y * w + x] = sample(ctx, picture, { x, y });
          y++;
        }
        if (y < h) return false;
        if (!cancelled.delete(data.id)) scope.postMessage({ id: data.id, ok: true, result: { result: { width: w, height: h, pixels }, trace: [] } });
        finishWorkerJob(data.id);
        return true;
      } };
    }
    if (kind === "sound") {
      const sample = nativeCall(session, "sound:sampleSound") ?? nativeCall(session, "sampleSound");
      if (!sample) return "plain";
      const sound = evaluateAuthoringExpressionInSession(root.args[0]!, id => saved.get(id), session, {},
        { trace: false, ...(prepared.sourceMetadata ? { sourceMetadata: prepared.sourceMetadata } : {}) }).result;
      const duration = (root.args[1] as Extract<ExprNode, { kind: "literal" }>).value as number;
      const rate = (root.args[2] as Extract<ExprNode, { kind: "literal" }>).value as number;
      const sr = Math.max(1, Math.floor(rate));
      const total = Math.max(0, Math.floor(Math.max(0, duration) * sr));
      const samples: unknown[] = new Array(total);
      const ctx = session.evaluateContext;
      let i = 0;
      return { id: data.id, kind: "sound", step: () => {
        if (cancelled.has(data.id)) { cancelled.delete(data.id); finishWorkerJob(data.id); return true; }
        const started = performance.now();
        while (i < total && performance.now() - started < SLICE_BUDGET_MS) {
          samples[i] = sample(ctx, sound, { seconds: i / sr });
          i++;
        }
        if (i < total) return false;
        if (!cancelled.delete(data.id)) scope.postMessage({ id: data.id, ok: true, result: { result: { sampleRate: sr, channels: 2, samples }, trace: [] } });
        finishWorkerJob(data.id);
        return true;
      } };
    }
  } catch (error) {
    if (!cancelled.delete(data.id)) scope.postMessage({ id: data.id, ok: false, error: failureText(error) });
    finishWorkerJob(data.id);
    return "finished";
  }
  return "plain";
}

/** W1: forget the current snapshot. A realm reused for its holder's next
 * snapshot never keeps two Local registries alive; realm-level engine caches
 * (module, parse, field-base and signature-plan memos) are what it keeps. */
function releaseSnapshotState(): void {
  if (physicalPreviewPartition !== undefined) clearEngineBodyMemoPartition(physicalPreviewPartition);
  physicalPreviewPartition = undefined;
  base = undefined;
  readerPresentationSource = undefined;
  localFieldSource = undefined;
  localPreparationInitialization = undefined;
  repositoryOnlySnapshot = false;
  contexts.clear();
  moduleContexts.clear();
}

let initializationReceived = false;
const repositoryPreparationAdmissions = new Set<number>();
scope.onmessage = ({ data }) => {
  if (data.method === "initialize") initializationReceived = true;
  if (data.method === "prepare-repository-registry-step" && (!initializationReceived || repositoryOnlySnapshot))
    repositoryPreparationAdmissions.add(data.id);
  if (data.method === "seal-registry-preparation") {
    if (Object.hasOwn(data, "contextId") || Object.hasOwn(data, "scope") || Object.hasOwn(data, "sourceModule")) return;
    if (data.initializationId === localPreparationInitialization && data.localSourceId === localFieldSource?.sourceId)
      localPreparationInitialization = undefined;
    return;
  }
  if (data.method === "release") {
    ordinaryGeneration++;
    // The host releases only an idle realm; drop anything still queued too.
    for (const job of waiting.splice(0)) {
      repositoryPreparationAdmissions.delete(job.id); cancelled.delete(job.id);
      if (job.method === "commit-local-storage") scope.postMessage({ id: job.id, event: "storage-settled",
        outcome: { status: "not-committed", error: "Browser data storage was released before it started." } });
      if (job.method === "commit-local-storage" && !active.has(job.id))
        scope.postMessage({ id: job.id, event: "finished" });
      else finishWorkerJob(job.id);
    }
    for (const controller of discoveryAborts.values()) controller.abort(new DOMException("Released", "AbortError"));
    for (const controller of storageAborts.values()) controller.abort(new DOMException("Released", "AbortError"));
    parked.length = 0;
    slice = undefined;
    releaseSnapshotState();
    return;
  }
  if (data.method === "cancel") {
    if (active.has(data.id)) cancelled.add(data.id);
    discoveryAborts.get(data.id)?.abort(new DOMException("Cancelled", "AbortError"));
    storageAborts.get(data.id)?.abort(new DOMException("Cancelled", "AbortError"));
    const index = waiting.findIndex(job => job.id === data.id);
    if (index >= 0) {
      const [job] = waiting.splice(index, 1);
      repositoryPreparationAdmissions.delete(data.id);
      cancelled.delete(data.id);
      if (job!.method === "commit-local-storage") scope.postMessage({ id: data.id, event: "storage-settled",
        outcome: { status: "not-committed", error: "Browser data storage was cancelled before it started." } });
      if (active.has(data.id)) finishWorkerJob(data.id);
      else scope.postMessage({ id: data.id, event: "finished" });
    }
    return;
  }
  // Foreground work (light or ordered) was asked for: guidance stays quiet.
  if (!HEAVY_METHODS.has(data.method) && !("priority" in data && data.priority === "guidance")) foregroundActivity();
  waiting.push(data);
  // The page posts in bursts: the rest of this one is still on its way. (A
  // message delivered by the turn that drains the queue is that burst.)
  if (!draining) inboxDrained = false;
  wake?.();
  void pump();
};

/** One turn of the message queue: everything already posted is delivered. */
let draining = false;
async function drainInbox(): Promise<void> {
  inboxDrained = true;
  draining = true;
  await pause();
  draining = false;
}

/** A quiet interval that any new message ends at once. */
let wake: (() => void) | undefined;
function rest(ms: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => { if (wake === done) wake = undefined; resolve(); };
    wake = done;
    setTimeout(done, ms);
  });
}
/** How long the next guidance job still waits for the page: at most once per
 * foreground event, and never past `GUIDANCE_QUIET_LIMIT_MS` in a row. */
function guidanceQuietDelay(): number {
  const now = performance.now();
  const remaining = GUIDANCE_QUIET_MS - (now - foregroundAt);
  if (!(remaining > 0) || quietSerial === foregroundSerial) return 0;
  if (quietSince !== undefined && now - quietSince >= GUIDANCE_QUIET_LIMIT_MS) return 0;
  quietSince ??= now;
  quietSerial = foregroundSerial;
  return remaining;
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (waiting.length || slice || parked.length) {
      const foreground = nextForeground();
      if (foreground) {
        // A heavy job cannot be interrupted once begun: see what was posted first.
        if (foreground.heavy && !inboxDrained) { await drainInbox(); continue; }
        const { job } = foreground;
        waiting.splice(waiting.indexOf(job), 1);
        const started = performance.now();
        await run(job);
        inboxDrained = false;
        if (foreground.heavy) lightStreak = 0;
        else {
          if (foreground.passes) lightStreak += Math.max(1, performance.now() - started);
          foregroundActivity();
        }
        continue;
      }
      if (slice?.kind === "sound" && waiting.some(job => weight(job) === 1)) {
        parked.push(slice);
        slice = undefined;
      }
      if (!slice) {
        // Guidance (3) waits behind every other job and every parked slice.
        const next = waiting.find(job => weight(job) === 1) ?? waiting.find(job => weight(job) !== 3)
          ?? (parked.length ? undefined : waiting[0]);
        if (!next) {
          slice = parked.pop();
          if (!slice) break;
        } else {
          if (!inboxDrained) { await drainInbox(); continue; }
          if (weight(next) === 3) {
            const quiet = guidanceQuietDelay();
            if (quiet > 0) { await rest(quiet); continue; }
            quietSince = undefined;
          }
          waiting.splice(waiting.indexOf(next), 1);
          const started = startSlice(next);
          if (started === "plain") { await run(next); inboxDrained = false; continue; }
          if (started === "finished") { inboxDrained = false; continue; }
          slice = started;
        }
      }
      if (!slice) continue;
      let done = false;
      try { done = slice.step(); }
      catch (error) {
        const id = slice.id;
        if (!cancelled.delete(id)) scope.postMessage({ id, ok: false, error: failureText(error) });
        finishWorkerJob(id);
        slice = undefined;
        inboxDrained = false;
        continue;
      }
      if (done) { slice = undefined; inboxDrained = false; }
      else { await pause(); inboxDrained = true; }
    }
  } finally {
    pumping = false;
    quietSince = undefined;
    if (waiting.length || slice || parked.length) void pump();
  }
}

async function run(data: WorkerJob) {
  beginWorkerJob(data.id);
  try {
    if (data.method === "run-local-ordinary") {
      if (Reflect.ownKeys(data).some(key => key !== "id" && key !== "method" && key !== "operation"))
        throw new Error("Local ordinary operations accept only their closed data request.");
      assertLocalOrdinaryOperation(data.operation);
      const generation = ordinaryGeneration;
      const model = await loadWorkspaceModel({ projected: true, preparation: "inline" });
      if (generation !== ordinaryGeneration || cancelled.has(data.id)) return;
      const value = runLocalOrdinaryOperation(model, data.operation);
      // One native message preserves actual sharing between the received
      // request and its result. Never clone these two graphs independently.
      scope.postMessage({ id: data.id, ok: true, result: { localOrdinary: { operation: data.operation, value } } });
      return;
    }
    if (data.method === "load-local-storage" || data.method === "commit-local-storage") {
      localStorage ??= createBrowserDataStorage({ preparation: "inline" });
      const controller = new AbortController();
      storageAborts.set(data.id, controller);
      const allowed = data.method === "load-local-storage" ? ["id", "method"]
        : ["id", "method", "next", "expectedGeneration"];
      if (data.method === "commit-local-storage") {
        let record;
        try {
          if (Reflect.ownKeys(data).some(key => typeof key !== "string" || !allowed.includes(key)))
            throw new Error("Browser data storage accepts only its ordinary source snapshot.");
          record = await localStorage.commit(data.next, data.expectedGeneration, controller.signal);
        } catch (error) {
          scope.postMessage({ id: data.id, event: "storage-settled", outcome: {
            status: "not-committed", error: error instanceof Error ? error.message : String(error),
          } });
          throw error;
        }
        // A durable receipt belongs to the physical owner even if its reader
        // cancelled. Posting failure after commit must never claim noncommit.
        scope.postMessage({ id: data.id, event: "storage-settled", outcome: { status: "committed", record } });
        if (!cancelled.delete(data.id)) scope.postMessage({ id: data.id, ok: true, result: { storageRecord: record } });
      } else {
        if (Reflect.ownKeys(data).some(key => typeof key !== "string" || !allowed.includes(key)))
          throw new Error("Browser data storage accepts only its ordinary source request.");
        const record = await localStorage.load(controller.signal);
        if (!cancelled.delete(data.id)) scope.postMessage({ id: data.id, ok: true,
          result: record === undefined ? {} : { storageRecord: record } });
      }
      return;
    }
    if (data.method === "core-value-suggestions") {
      if (typeof data.input !== "string" || Reflect.ownKeys(data).some(key =>
        key !== "id" && key !== "method" && key !== "input"))
        throw new Error("Typed choices accept only neutral input text.");
      const coreValueSuggestion = coreValueSuggestions(data.input);
      if (!cancelled.delete(data.id)) scope.postMessage({ id: data.id, ok: true, result: { coreValueSuggestion } });
      return;
    }
    if (data.method === "repository-namespaces") {
      // The existing checked execute registry owns this projection. Initialize
      // reuses its per-worker memo. Metadata comes from that repository-only
      // build before any account initialization; no reader frame is transferred.
      const projection = repositorySourceModuleProjection();
      scope.postMessage({ id: data.id, ok: true, result: {
        repositoryNamespaces: [...projection.namespaces], repositoryEntities: projection.entities,
        identifiedRepositoryEntities: projection.identifiedEntities,
      } });
      return;
    }
    if (data.method === "initialize") {
      // W1: a reused realm builds the next snapshot only once the previous one
      // is unreachable here; a refused initialization leaves the realm empty.
      releaseSnapshotState();
      if (data.repositoryOnly) {
        if (data.accountId !== undefined || data.localSourceId !== undefined || data.snapshot.owners.length
          || data.snapshot.fields.length || data.snapshot.facets.length || data.entities.length || data.functions?.length
          || data.sourceModules?.length || data.localRepresentations?.length || data.localValueIds?.length)
          throw new Error("Public editing tools accept repository data only.");
      } else if (data.localSourceId ? data.accountId !== undefined : !data.accountId) throw new Error("The authoring source identity is unavailable.");
      if (!data.localSourceId && !data.repositoryOnly) registerCatalogEntities(data.entities);
      // Start reading the build-owned repository catalogue now, so transfer
      // overlaps the checked registry build below. Adoption is decided later.
      const repositoryRead = new AbortController();
      // W1: a realm reused by its holder keeps the verified catalogue it read.
      const localSourceId = data.localSourceId;
      const publicIndex = publicRepositoryCatalogueIndex as unknown as AuthoringCatalogueIndex;
      const repositoryCatalogue = localSourceId ? realmRepositoryCatalogue(repositoryCatalogueRealmKey(repositoryCatalogueIndex as unknown as AuthoringCatalogueIndex,
        localSourceId, data.sessionEpoch), () => readRepositoryCatalogue({ ...data, localSourceId }, repositoryRead.signal))
        // Lane S: the public worker's own build-owned projection, same checks.
        : data.repositoryOnly ? realmRepositoryCatalogue(repositoryCatalogueRealmKey(publicIndex, REPOSITORY_CATALOGUE_SOURCE_ID, data.sessionEpoch),
          () => readRepositoryCatalogue({ localSourceId: REPOSITORY_CATALOGUE_SOURCE_ID }, repositoryRead.signal, publicIndex, "repository-authoring-catalogue"))
        : undefined;
      repositoryCatalogue?.catch(() => undefined);
      const registryStarted = performance.now();
      // GLOBAL_ONLY: this public worker has no authenticated account or local
      // source; only checked repository declarations participate in resolution.
      const registry = data.repositoryOnly ? createRepositoryRegistry(modulesFor("seed"), { dispatchRegistry }) : data.localSourceId
        ? await buildLocalReaderFieldRegistry(data.localSourceId, data.snapshot, { preparation: "inline", representations: data.localRepresentations })
        : data.sourceModules
          ? await buildReaderFieldRegistry(data.accountId!, data.snapshot, data.sourceModules, { preparation: "inline" })
          : createAccountFieldRegistry(modulesFor("seed"), data.accountId!, data.snapshot, { dispatchRegistry });
      const evaluateContext = evaluateContextForCatalog(registry);
      const frame = data.localSourceId || data.repositoryOnly ? Object.freeze({ ...evaluateContext, _authority: mintAnonymousAuthority(registry),
        ...(data.localSourceId ? { _activeTags: Object.freeze([data.localSourceId]) as unknown as string[] } : {}) }) : evaluateContext;
      const catalogueStarted = performance.now();
      const prepared: { catalog: AuthoringCatalogSnapshot; displayCatalog: CatalogSection[]; source?: string; reason?: string } = data.localSourceId
        // Let pending response bodies finish after the synchronous registry
        // work, within the bounded read window; then adopt or build live.
        ? await localCatalogue(registry, frame, { ...data, localSourceId: data.localSourceId }, repositoryCatalogue,
          { abort: () => repositoryRead.abort(),
            catalogueSourceId: LOCAL_BROWSER_SOURCE_ID })
        : data.repositoryOnly ? await repositoryOnlyCatalogue(registry, frame, repositoryCatalogue, { abort: () => repositoryRead.abort() })
        : { catalog: buildSessionCatalog(registry), displayCatalog: getCatalog(registry) };
      const { catalog, displayCatalog } = prepared;
      // Lane S probe record (read by browser probes only; never sent): which
      // catalogue this initialization used and where its time went.
      (globalThis as Record<symbol, unknown>)[Symbol.for("fenel.authoring-catalogue.initialize")] = Object.freeze({
        repositoryOnly: data.repositoryOnly === true, local: data.localSourceId !== undefined, source: prepared.source ?? "live",
        reason: prepared.reason, registryMs: Math.round(catalogueStarted - registryStarted),
        catalogueMs: Math.round(performance.now() - catalogueStarted) });
      const environment = createDetachedAuthoringEnvironment(environmentForCatalog(catalog, registry));
      base = Object.freeze({ mode: "detached", registry, catalog: environment.catalog, environment,
        evaluateContext: frame });
      // A2/B3: retain the same inert committed source rows as the Local holder.
      // Scoped requests select their own session/frame, without rewriting these
      // source fallbacks to look like a newly committed draft definition.
      readerPresentationSource = { catalog: displayCatalog,
        ...(data.localSourceId ? {
          types: data.snapshot.owners.flatMap(owner => owner.kind === "type"
            ? [{ ...owner.definition, id: owner.definition.id, name: owner.storageName, isSystem: false }] : []),
          functionRows: data.snapshot.owners.flatMap(owner => owner.kind === "function"
            ? [{ id: owner.definition.id, name: owner.storageName, function: owner.definition, isSystem: false }] : []),
        } : {}),
      };
      localFieldSource = data.localSourceId ? { sourceId: data.localSourceId, snapshot: data.snapshot } : undefined;
      localPreparationInitialization = data.localSourceId ? data.id : undefined;
      repositoryOnlySnapshot = data.repositoryOnly === true;
      physicalPreviewPartition = `reader-physical:${++nextPhysicalPreviewSnapshot}`;
      scope.postMessage({ id: data.id, ok: true, result: { catalog, displayCatalog } });
      return;
    }
    if (data.method === "prepare-repository-registry-step") {
      // Lane S: after a repository-only snapshot, every step kind (fields,
      // deltas, facets, constructors, signature plans) runs in the repository
      // partition its own checked build filled; before any initialization, the
      // early Local realm keeps its original three kinds without a partition.
      const borrowed = repositoryOnlySnapshot;
      if (!repositoryPreparationAdmissions.delete(data.id)
        || ["contextId", "scope", "sourceModule", "initializationId", "localSourceId"].some(key => Object.hasOwn(data, key))
        || !data.request || (!borrowed && !["fields", "facets", "constructors"].includes(data.request.kind)))
        throw new Error("Repository registry preparation is unavailable.");
      await pause();
      if (cancelled.delete(data.id)) return;
      if (borrowed !== repositoryOnlySnapshot) throw new Error("This repository registry preparation belongs to a released snapshot.");
      let registryPreparation: Extract<AuthoringWorkerResult, { registryPreparation: unknown }>["registryPreparation"];
      // L5a-finish: a page of another build gets a refusal before any work;
      // every answer names this worker's build for the page to check.
      try {
        checkRegistryPreparationBuild(data.build, AUTHORING_BUILD_IDENTITY);
        const request = data.request;
        registryPreparation = { ok: true, value: borrowed ? withEngineBodyMemoPartition(REPOSITORY_PARTITION, () => runRegistryPreparation(request))
          : runRegistryPreparation(request), build: AUTHORING_BUILD_IDENTITY };
      } catch (error) { registryPreparation = { ok: false, ...registryPreparationFailure(error), build: AUTHORING_BUILD_IDENTITY }; }
      if (!cancelled.delete(data.id)) scope.postMessage({ id: data.id, ok: true, result: { registryPreparation } });
      return;
    }
    if (!base) throw new Error("The editing worker is not ready.");
    if (data.method === "prepare-registry-step") {
      if (!localFieldSource || data.localSourceId !== localFieldSource.sourceId
        || data.initializationId !== localPreparationInitialization
        || Object.hasOwn(data, "contextId") || Object.hasOwn(data, "scope") || Object.hasOwn(data, "sourceModule"))
        throw new Error("This registry preparation belongs to a replaced Local snapshot.");
      // Give queued cancellation a turn before the synchronous kernel. The
      // page sends the existing field-worker request through native structured
      // clone (including its Maps); the Fenel owners still decide.
      await pause();
      if (cancelled.delete(data.id)) return;
      if (!localFieldSource || data.localSourceId !== localFieldSource.sourceId
        || data.initializationId !== localPreparationInitialization)
        throw new Error("This registry preparation belongs to a replaced Local snapshot.");
      let registryPreparation: Extract<AuthoringWorkerResult, { registryPreparation: unknown }>["registryPreparation"];
      try {
        // L5a-finish: every borrowed step (fields, deltas, facets,
        // constructors, signature plans) is the page's own computation only
        // for a page of this build; refuse another before any work.
        checkRegistryPreparationBuild(data.build, AUTHORING_BUILD_IDENTITY);
        // S1: the same private partition as this source's inline registry.
        // Exact argument/code/pool matches reuse its checked work; every miss
        // executes the same kernel. Never hold this scope across an await.
        const value = withEngineBodyMemoPartition(`local:${localFieldSource.sourceId}`,
          () => runRegistryPreparation(data.request));
        registryPreparation = { ok: true, value, build: AUTHORING_BUILD_IDENTITY };
      } catch (error) {
        registryPreparation = { ok: false, ...registryPreparationFailure(error), build: AUTHORING_BUILD_IDENTITY };
      }
      if (!cancelled.delete(data.id)) scope.postMessage({ id: data.id, ok: true, result: { registryPreparation } });
      return;
    }
    if (data.method === "module-catalog") {
      scope.postMessage({ id: data.id, ok: true, result: { catalog: moduleContext(data.sourceModule).catalog } });
      return;
    }
    // Committed field reads belong to the retained Local source. A draft or
    // module context cannot replace that source's definitions or ownership.
    if ((data.method === "query-reader-field-catalog" || data.method === "query-reader-field-identity"
      || data.method === "query-reader-field-resurrections" || data.method === "query-reader-field-facets")
      && (data.contextId !== 0 || data.scope !== undefined || data.sourceModule !== undefined))
      throw new Error("This reader's field catalogue requires its committed Local context.");
    if (data.method === "project-reader-values" && repositoryOnlySnapshot
      && (data.contextId !== 0 || data.scope !== undefined || data.sourceModule !== undefined))
      throw new Error("This public value presentation requires its prepared repository context.");
    const prepared = data.method === "evaluate-expression" ? prepareEvaluation(data) : undefined;
    if (prepared && "error" in prepared) throw prepared.error;
    const contextualBase = data.sourceModule ? moduleContext(data.sourceModule).session : base;
    let session = prepared ? prepared.session : data.contextId === 0 ? contextualBase : contexts.get(data.contextId);
    if (!prepared && data.scope) {
      session = "sourceId" in data.scope ? createLocalAuthoringSession(contextualBase, data.scope)
        : createAccountAuthoringSession(contextualBase, data.scope);
      if (contexts.size >= 16) contexts.delete(contexts.keys().next().value!);
      contexts.set(data.contextId, session);
    }
    if (!session) {
      if (!prepared) scope.postMessage({ id: data.id, ok: false, error: "The authoring context needs to be refreshed.", code: "context-missing" });
      return;
    }
    if (cancelled.delete(data.id)) return;
    const options = { registry: session.registry, evaluateContext: session.evaluateContext };
    let result: AuthoringWorkerResult;
    // B3 reader extensions live in their own module (worker-transport kind).
    if (isReaderExtensionMethod(data.method)) {
      const extended = await runReaderExtension(data as Parameters<typeof runReaderExtension>[0], session, readerPresentationSource, pause,
        () => cancelled.has(data.id), () => waiting.some(job => weight(job) !== 3));
      if (extended !== undefined && !cancelled.delete(data.id)) scope.postMessage({ id: data.id, ok: true, result: extended });
      return;
    }
    if (data.method === "evaluate-expression") {
      // Give queued cancellation a chance before entering the synchronous
      // evaluator. Only the completed data crosses back, never a registry,
      // callable host context. Opt-in intermediates come from this same run.
      await pause();
      if (cancelled.delete(data.id)) return;
      const sources = savedSources(data, [data.node], session);
      const saved = new Map(sources.savedExpressions);
      restoreSavedExpressionDeclarations(saved, sources.savedDeclarations);
      // This request's captured packet is an inert per-run overlay. The
      // prepared session/base is never mutated or given a source callback.
      if (!prepared?.node) throw new Error("The authoring expression needs to be prepared.");
      const evaluated = evaluateAuthoringExpressionInSession(prepared.node, (id) => saved.get(id), session, {},
        { trace: data.trace === true, capture: prepared.capture === true, admitInvocations: data.admitInvocations, pure: data.pure === true,
          ...(prepared?.sourceMetadata ? { sourceMetadata: prepared.sourceMetadata } : {}) });
      // B4 F2: a Local live trace asks for the same run's trace steps.
      result = { result: evaluated.result, trace: data.trace === true ? transferableTrace(evaluated.trace ?? []) : [],
        ...(evaluated.captures ? { captures: evaluated.captures } : {}) };
      if (data.admission !== undefined) {
        // B4 slice 2: the page's "evaluate, then check" pair in one request.
        // The existing `draftSaveIssue` checks the value just evaluated, with
        // the same inputs the page passed; a list destination is peeled with
        // this reader's own registry, as for `expression-save-issue`.
        const admission = data.admission;
        const element = admission.expectedListType === undefined ? undefined : peelListForAuthoring(resolveValueType(admission.expectedListType,
          name => session.registry.getIdentifiedEntity(name)?.type))?.elem;
        const expectedType = element ?? admission.expectedType;
        // Keep the same exact-owner requirement used by live result guidance.
        const requirement = expectedType === undefined && admission.expectedScheme === undefined ? undefined
          : scopedResultRequirement(session, { expected: expectedType ?? admission.expectedScheme!.body, scheme: admission.expectedScheme });
        const expectedScheme = requirement?.scheme ?? admission.expectedScheme;
        const options = { registry: session.registry,
          evaluateContext: session.evaluateContext, resolveSavedExpr: (id: string) => saved.get(id), evaluatedValue: evaluated.result,
          ...(expectedType === undefined ? {} : { expectedType: requirement!.expected }),
          ...(expectedScheme === undefined ? {} : { expectedScheme }),
          ...(admission.expectedTypeName === undefined ? {} : { expectedTypeName: admission.expectedTypeName }) };
        const validation = admission.creationValidation ? draftSaveValidation(prepared.node, session.environment, options) : undefined;
        const issue = validation ? validation.issue : draftSaveIssue(prepared.node, session.environment, options);
        if (validation) result = { ...result, validation };
        if (issue !== undefined) result = { ...result, issue };
      }
    } else if (data.method === "infer-expression") {
      // B4 slice 2: an editor root's live inference batch for a Local reader.
      // Each item runs the existing literal-witness inference with this
      // reader's own membership judge, and, when asked, the shared result
      // judgment of that same inference. Only data crosses back.
      await pause();
      if (cancelled.delete(data.id)) return;
      if (!Array.isArray(data.items) || data.items.length > LIVE_INFERENCE_BATCH_LIMIT)
        throw new TypeError("The live inference request could not be read.");
      const sources = savedSources(data, data.items.map(item => item.node), session);
      const saved = new Map(sources.savedExpressions);
      restoreSavedExpressionDeclarations(saved, sources.savedDeclarations);
      const evaluateContext = readerSourceMetadataEvaluateContext(session.evaluateContext, data.sourceMetadata);
      const framed = evaluateContext === session.evaluateContext ? session : Object.freeze({ ...session, evaluateContext });
      const resolveSavedExpr = (id: string) => saved.get(id);
      const literalMembership = literalMembershipFor(framed.environment, { registry: framed.registry, evaluateContext });
      const inferences: ExpressionInferenceReply[] = [];
      let slice = performance.now(), yielded = false;
      for (const item of data.items) {
        // A running job cannot be pre-empted, so a guidance batch yields
        // between items: when any other job waits (a Save admission, a
        // registry step, a picture), it stops and replies with the items it
        // finished; the page keeps them and asks only for the rest.
        if (data.priority === "guidance" && performance.now() - slice >= LIVE_INFERENCE_SLICE_MS) {
          await pause();
          slice = performance.now();
          if (cancelled.delete(data.id)) return;
          if (waiting.some(job => weight(job) !== 3)) { yielded = true; break; }
        }
        const node = item.rootDeclaration ? restoreSavedExpressionDeclaration(item.node, item.rootDeclaration) : item.node;
        // The same exact-owner transport repair used by picker/result checks.
        // Only this captured worker resolves a Local page's selected type handle.
        const expected = item.expectedScheme ? scopedResultRequirement(framed, {
          expected: item.expectedScheme.body, scheme: item.expectedScheme,
        }).scheme : undefined;
        const inferred = inferScopedAuthoringExpression(node, { ...framed.environment, literalMembership,
          bindings: item.bindings ?? {}, resolveSavedExpr }, expected ? { expectedScheme: expected } : {});
        const compatibility = scopedExpectedType(framed, item.compatibility);
        const reply = { outcome: inferred.outcome, ...(inferred.type === undefined ? {} : { type: inferred.type }),
          ...(inferred.scheme === undefined ? {} : { scheme: inferred.scheme }),
          // B4 F2: a Local picker's compatibility filter, judged here.
          // A judgment that cannot be computed abstains ("unknown").
          ...(compatibility === undefined ? {} : { compatibility: readerCompatibility(inferred.scheme, compatibility, framed.registry) }) };
        // Lane D (4b): a requirement spelled by a picked scalar's identity
        // handle is judged under its scoped name (a String result on a Local
        // String card is not a mismatch, so its graph is not refused).
        const judge = item.judge ? scopedResultRequirement(framed, item.judge) : undefined;
        inferences.push(judge ? { ...reply, judgment: judgeAuthoringResult(node, judge.expected, judge.scheme, judge.label,
          inferred, framed) } : reply);
      }
      result = registryTransportSnapshot({ inferences, ...(yielded ? { yielded: true } : {}) }, "worker live inference result");
    } else if (data.method === "infer-function-draft") {
      await pause();
      if (cancelled.delete(data.id)) return;
      // B4 unit D item 2: value-read transport both ways, so a draft body's
      // authored literal key order survives into the body that is saved.
      const input = registryTransportSnapshot(data, "worker function draft request", "value-read");
      // B4 unit D item 2: a Local editor's draft body is lowered here, with the
      // editor's codec adapter and refusal, as the page lowered it; a refusal
      // fails the request with its own message. The lowered body crosses back.
      let fn = input.fn;
      let loweredBody: unknown;
      if (input.lowerBody !== undefined) {
        const lowering = input.lowerBody;
        if (!lowering || typeof lowering !== "object" || !lowering.node || typeof lowering.refusal !== "string")
          throw new TypeError("The function draft request could not be read.");
        loweredBody = authoringExpressionLogic(lowering.node, () => { throw new Error(lowering.refusal); }, session);
        fn = { ...fn, body: loweredBody as typeof fn["body"] };
      }
      const inferred = inferAuthoringFunctionDraft(fn, input.declaration, session.environment, { registry: session.registry });
      result = registryTransportSnapshot(input.lowerBody === undefined ? inferred : { ...inferred, loweredBody }, "worker function draft result", "value-read");
    } else if (data.method === "function-body-save-issue") {
      await pause();
      if (cancelled.delete(data.id)) return;
      const input = registryTransportSnapshot(data, "worker function body save request");
      const node = input.rootDeclaration ? restoreSavedExpressionDeclaration(input.node, input.rootDeclaration) : input.node;
      const evaluateContext = readerSourceMetadataEvaluateContext(session.evaluateContext, input.sourceMetadata);
      result = registryTransportSnapshot({ issue: functionBodySaveIssue(node, input.definition, session.environment,
        { registry: session.registry, evaluateContext }) }, "worker function body save result");
    } else if (data.method === "expression-save-issue") {
      // B4 slice 1: Home's Save-time admission for a Local reader. The existing
      // `draftSaveIssue` runs here with the page's inputs; when asked, the node
      // is evaluated first in this same request, exactly as the page evaluated
      // it, and an evaluation failure refuses Save with its own message. Only
      // the issue text crosses back. Like `evaluate-expression`, the request
      // arrives as a structured clone (authored key order, Bytes and Date kept).
      await pause();
      if (cancelled.delete(data.id)) return;
      const sources = savedSources(data, [data.node], session);
      const saved = new Map(sources.savedExpressions);
      restoreSavedExpressionDeclarations(saved, sources.savedDeclarations);
      const node = data.rootDeclaration ? restoreSavedExpressionDeclaration(data.node, data.rootDeclaration) : data.node;
      // The captured packet is an inert per-run overlay, as for evaluation.
      const evaluateContext = readerSourceMetadataEvaluateContext(session.evaluateContext, data.sourceMetadata);
      const framed = evaluateContext === session.evaluateContext ? session : Object.freeze({ ...session, evaluateContext });
      const resolveSavedExpr = (id: string) => saved.get(id);
      // A destination list's element type, peeled with this reader's own
      // registry exactly as the page peeled it with its registry.
      const element = data.expectedListType === undefined ? undefined : peelListForAuthoring(resolveValueType(data.expectedListType,
        name => framed.registry.getIdentifiedEntity(name)?.type))?.elem;
      const expectedType = element ?? data.expectedType;
      // Qualify only exact registered handles, preserving supplied owners.
      const requirement = expectedType === undefined && data.expectedScheme === undefined ? undefined
        : scopedResultRequirement(framed, { expected: expectedType ?? data.expectedScheme!.body, scheme: data.expectedScheme });
      const expectedScheme = requirement?.scheme ?? data.expectedScheme;
      const options: NonNullable<Parameters<typeof draftSaveIssue>[2]> = { registry: framed.registry, evaluateContext, resolveSavedExpr,
        ...(expectedType === undefined ? {} : { expectedType: requirement!.expected }),
        ...(expectedScheme === undefined ? {} : { expectedScheme }),
        ...(data.expectedTypeName === undefined ? {} : { expectedTypeName: data.expectedTypeName }),
        ...(data.actualTypeName === undefined ? {} : { actualTypeName: data.actualTypeName }) };
      if (data.evaluate === true) {
        const sourceMetadata: ReaderSourceMetadataCapture | undefined = data.sourceMetadata ? { session: framed, packet: data.sourceMetadata,
          generationToken: Object.freeze({}), current: () => !cancelled.has(data.id) } : undefined;
        options.evaluatedValue = evaluateAuthoringExpressionInSession(node, resolveSavedExpr, framed, {},
          { trace: false, ...(sourceMetadata ? { sourceMetadata } : {}) }).result;
        if (cancelled.delete(data.id)) return;
      }
      const validation = data.creationValidation ? draftSaveValidation(node, framed.environment, options) : undefined;
      result = registryTransportSnapshot({ issue: validation ? validation.issue : draftSaveIssue(node, framed.environment, options),
        ...(validation ? { validation } : {}) }, "worker expression save result");
    } else if (data.method === "project-reader-type-preview") {
      const captured = readerPresentationSource;
      if (!localFieldSource || !captured) throw new Error("This reader's Local type presentation is unavailable.");
      await pause();
      if (cancelled.delete(data.id)) return;
      const input = registryTransportSnapshot(data, "worker reader type preview request");
      if ((input.typeLookup !== "registry" && input.typeLookup !== "session")
        || !input.type || typeof input.type !== "object" || Array.isArray(input.type)
        || !Array.isArray(input.knownIcons) || input.knownIcons.some(name => typeof name !== "string"))
        throw new TypeError("The reader type preview request could not be read.");
      result = registryTransportSnapshot({ preview: projectReaderTypePreviewInSession(input.type, session,
        input.typeLookup, captured, input.knownIcons) }, "worker reader type preview result");
    } else if (data.method === "project-reader-values") {
      const captured = readerPresentationSource;
      const partition = physicalPreviewPartition;
      const publicSnapshot = repositoryOnlySnapshot && localFieldSource === undefined && session === base
        && data.contextId === 0 && data.scope === undefined && data.sourceModule === undefined;
      if ((!localFieldSource && !publicSnapshot) || !captured || partition === undefined)
        throw new Error("This reader's Local value presentation is unavailable.");
      await pause();
      if (cancelled.delete(data.id)) return;
      // A release/replacement during the yield cannot repopulate its cleared
      // snapshot partition with an old queued request.
      if (partition !== physicalPreviewPartition || captured !== readerPresentationSource
        || publicSnapshot && (!repositoryOnlySnapshot || localFieldSource !== undefined || session !== base))
        throw new Error("This data's reader was replaced.");
      const input = registryTransportSnapshot(data, "worker reader value request", "value-read");
      if (!Array.isArray(input.inputs) || !Array.isArray(input.knownIcons) || input.knownIcons.some(name => typeof name !== "string"))
        throw new TypeError("The reader value request could not be read.");
      for (const entry of input.inputs) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)
          || (entry.typeLookup !== "registry" && entry.typeLookup !== "session")
          || !Array.isArray(entry.views) || !Array.isArray(entry.componentNames)
          || entry.componentNames.some((name: unknown) => typeof name !== "string")
          || (entry.compact !== undefined && typeof entry.compact !== "boolean")
          || (entry.thumbnail !== undefined && typeof entry.thumbnail !== "boolean")
          || (entry.templateOnly !== undefined && typeof entry.templateOnly !== "boolean"))
          throw new TypeError("The reader value input could not be read.");
      }
      result = registryTransportSnapshot({ valueReads: input.inputs.map(entry =>
        projectReaderValueReadInSession(entry, session, captured, input.knownIcons,
          operation => withEngineBodyMemoPartition(partition, operation))) }, "worker reader value result", "value-read");
    } else if (data.method === "project-reader-record-slots" || data.method === "edit-reader-record-field") {
      if (!localFieldSource) throw new Error("This reader's Local record tools are unavailable.");
      await pause();
      if (cancelled.delete(data.id)) return;
      const input = registryTransportSnapshot(data, "worker reader record request", "equality");
      if (input.representationTypeName !== undefined && typeof input.representationTypeName !== "string")
        throw new TypeError("The reader record representation could not be read.");
      if (input.representationTypeName !== undefined && (!input.representationTypeName
        || resolveRuntimeRepresentationMethod(session.evaluateContext, input.representationTypeName, "lower") === undefined))
        throw new TypeError("The reader record representation is unavailable.");
      const frame = input.representationTypeName === undefined ? session.evaluateContext
        : runtimeRepresentationNativeContext(session.evaluateContext, input.representationTypeName);
      if (input.method === "project-reader-record-slots") {
        if (!Array.isArray(input.fields) || input.fields.some(field => typeof field !== "string"))
          throw new TypeError("The reader record fields could not be read.");
        result = registryTransportSnapshot({ recordSlots: fieldRecordSlotsPlan(input.value, input.fields, frame) },
          "worker reader record slots result", "equality");
      } else {
        if (typeof input.field !== "string") throw new TypeError("The reader record field could not be read.");
        result = registryTransportSnapshot({ edit: fieldRecordEditPlan(input.value, input.field, input.edited, frame) },
          "worker reader record edit result", "equality");
      }
    } else if (data.method === "project-reader-numeric-codec") {
      if (!localFieldSource) throw new Error("This reader's Local numeric text tools are unavailable.");
      await pause();
      if (cancelled.delete(data.id)) return;
      const input = registryTransportSnapshot(data, "worker reader numeric codec request", "equality");
      if (typeof input.typeName !== "string") throw new TypeError("The reader numeric codec request could not be read.");
      result = registryTransportSnapshot({ codec: fieldNumericTextCodecPlan(input.typeName, session.evaluateContext) },
        "worker reader numeric codec result", "equality");
    } else if (data.method === "decode-reader-numeric-text" || data.method === "encode-reader-numeric-text") {
      if (!localFieldSource) throw new Error("This reader's Local numeric text tools are unavailable.");
      await pause();
      if (cancelled.delete(data.id)) return;
      const input = registryTransportSnapshot(data, "worker reader numeric text request", "equality");
      const codec = input.codec as unknown as Record<string, unknown>;
      if (!input.codec || typeof input.codec !== "object" || Array.isArray(input.codec)
        || (Object.hasOwn(codec, "typeName")
          ? typeof codec.typeName !== "string" || Object.hasOwn(codec, "methods")
          : !Object.hasOwn(codec, "methods") || !codec.methods || typeof codec.methods !== "object" || Array.isArray(codec.methods))
        || (input.method === "decode-reader-numeric-text" && typeof input.value !== "string"))
        throw new TypeError("The reader numeric text request could not be read.");
      const direction = input.method === "decode-reader-numeric-text" ? "decode" : "encode";
      const numericText = runNumericTextCodec(session, input.codec, direction, input.value);
      if (direction === "encode") {
        if (numericText.ok && typeof numericText.value !== "string")
          throw new TypeError("The reader numeric text result could not be read.");
        result = registryTransportSnapshot({ encoded: numericText as import("../number-input").NumberTextResult<string> },
          "worker reader numeric text result", "equality");
      } else result = registryTransportSnapshot({ decoded: numericText }, "worker reader numeric text result", "equality");
    } else if (data.method === "project-reader-field-plan") {
      if (!localFieldSource) throw new Error("This reader's Local field planning tools are unavailable.");
      await pause();
      if (cancelled.delete(data.id)) return;
      const input = registryTransportSnapshot(data, "worker reader field plan request", "equality");
      if (!input.field || typeof input.field !== "object" || Array.isArray(input.field)
        || (input.fieldMode !== "identified" && input.fieldMode !== "transient")
        || typeof input.channelsEnabled !== "boolean"
        || (input.channelId !== undefined && typeof input.channelId !== "string")
        || (input.recordValues !== undefined && (!input.recordValues || typeof input.recordValues !== "object" || Array.isArray(input.recordValues)))
        || (input.presentationOverride !== undefined && (!input.presentationOverride || typeof input.presentationOverride !== "object" || Array.isArray(input.presentationOverride))))
        throw new TypeError("The reader field plan request could not be read.");
      result = registryTransportSnapshot({ fieldPlan: fieldReaderPlan({ field: input.field, value: input.value,
        recordValues: input.recordValues, fieldMode: input.fieldMode, channelId: input.channelId,
        presentationOverride: input.presentationOverride, channelsEnabled: input.channelsEnabled,
        registry: session.registry, evaluateContext: session.evaluateContext }) }, "worker reader field plan result", "equality");
    } else if (data.method === "project-reader-choice-selection" || data.method === "project-reader-list-selection"
      || data.method === "edit-reader-list-chips") {
      if (!localFieldSource) throw new Error("This reader's Local selection tools are unavailable.");
      await pause();
      if (cancelled.delete(data.id)) return;
      const input = registryTransportSnapshot(data, "worker reader selection request", "equality");
      if (input.method === "edit-reader-list-chips") {
        result = registryTransportSnapshot({ edit: fieldListChipsEditPlan(input.type, input.value, input.action,
          session.evaluateContext, session.registry, input.declarationType) }, "worker reader list edit result", "equality");
      } else {
        if (!Array.isArray(input.options)) throw new TypeError("The reader selection choices could not be read.");
        result = input.method === "project-reader-choice-selection"
          ? registryTransportSnapshot({ selection: fieldChoiceSelectionPlan(input.options, input.value, session.evaluateContext) },
            "worker reader selection result", "equality")
          : registryTransportSnapshot({ selection: fieldListChipsSelectionPlan(input.options, input.value, session.evaluateContext) },
            "worker reader selection result", "equality");
      }
    } else if (data.method === "project-reader-types") {
      await pause();
      if (cancelled.delete(data.id)) return;
      const input = registryTransportSnapshot(data, "worker reader type descriptions request");
      if (input.typeLookup !== "registry" && input.typeLookup !== "session") throw new TypeError("The reader type lookup mode is unavailable.");
      result = registryTransportSnapshot({ descriptions: projectReaderTypeDescriptionsInSession(input.root, session, input.typeLookup) },
        "worker reader type descriptions result");
    } else if (data.method === "project-reader-metadata" || data.method === "project-reader-presentations") {
      await pause();
      if (cancelled.delete(data.id)) return;
      const operation = data.method === "project-reader-metadata" ? "reader metadata" : "reader presentations";
      const input = registryTransportSnapshot(data, `worker ${operation} request`);
      if (!Array.isArray(input.targets) || input.targets.some(target => typeof target !== "string"))
        throw new TypeError("The reader metadata targets could not be read.");
      const capturedPresentation = readerPresentationSource;
      if (!capturedPresentation) throw new Error("This reader's captured presentation is unavailable.");
      const presentation = createReaderPresentation(() => ({ ...capturedPresentation, registry: session.registry, session }));
      const projected = input.method === "project-reader-metadata"
        ? { entries: input.targets.map(target => ({ target,
          representations: representationsFromReaderSnapshot(session.registry, session.evaluateContext, target),
          ownPresentation: presentation.presentation(target),
        })) }
        : { presentations: input.targets.map(target => ({ target, presentation: presentation.presentation(target) })) };
      result = registryTransportSnapshot(projected, `worker ${operation} result`);
    } else if (data.method === "query-reader-field-catalog" || data.method === "query-reader-field-identity"
      || data.method === "query-reader-field-resurrections" || data.method === "query-reader-field-facets") {
      const captured = localFieldSource;
      const committedRegistry = base.registry;
      await pause();
      if (cancelled.delete(data.id)) return;
      const input = registryTransportSnapshot(data, "worker reader field request");
      if (!captured) throw new Error("This reader's committed Local field source is unavailable.");
      if (input.method === "query-reader-field-catalog") {
        if (!input.query || typeof input.query !== "object" || Array.isArray(input.query)
          || (input.query.search !== undefined && typeof input.query.search !== "string")
          || (input.query.cursor !== undefined && typeof input.query.cursor !== "string")
          || (input.query.limit !== undefined && typeof input.query.limit !== "number"))
          throw new TypeError("The reader field catalogue query could not be read.");
        result = registryTransportSnapshot(await queryLocalFieldAuthoringCatalog(captured.sourceId, captured.snapshot, input.query),
          "worker reader field catalogue result");
      } else if (input.method === "query-reader-field-identity") {
        if (typeof input.fieldId !== "string") throw new TypeError("The reader field identity could not be read.");
        result = registryTransportSnapshot(await queryLocalFieldAuthoringIdentity(captured.sourceId, captured.snapshot, input.fieldId),
          "worker reader field identity result");
      } else if (input.method === "query-reader-field-resurrections") {
        if (!input.target || typeof input.target !== "object" || Array.isArray(input.target)
          || typeof input.target.ownerKey !== "string" || typeof input.target.storageName !== "string"
          || (input.target.ownerKind !== "type" && input.target.ownerKind !== "function"))
          throw new TypeError("The reader field resurrection target could not be read.");
        result = registryTransportSnapshot(await queryLocalFieldResurrectionCatalog(captured.sourceId, captured.snapshot, input.target),
          "worker reader field resurrection result");
      } else {
        result = registryTransportSnapshot({ dispatchInstances: committedRegistry.listFieldRepresentations()
          .map(instance => ({ typeName: instance.typeName, args: instance.args, instance })) },
        "worker reader field facets result");
      }
    } else if (data.method === "analyze-transfer") {
      const values: WorkspaceTransferAnalysis[] = [];
      for (const item of data.items) {
        await pause();
        if (cancelled.delete(data.id)) return;
        const type = typeForTransfer(item, session.environment, options);
        const expr = expressionForTransfer({ ...item, type, typeCandidate: undefined }, session.environment, options);
        values.push({ value: item.value, typeName: item.typeName, label: item.label, note: item.note, expr, type });
      }
      result = values;
    } else if (data.method === "adapt-transfer") {
      result = adaptTransferToTarget(data.items, { ...data.target, ...options, environment: session.environment });
    } else if (data.method === "discover-data-suggestions") {
      const controller = new AbortController();
      discoveryAborts.set(data.id, controller);
      await pause();
      if (cancelled.has(data.id)) controller.abort(new DOMException("Cancelled", "AbortError"));
      controller.signal.throwIfAborted();
      let start = performance.now();
      result = await discoverDataSuggestions(session, data.input, data.options, {
        signal: controller.signal,
        // The discovery owner still checks abort before and after every plan.
        // Share the editor's host yield after the same small proof-work slice,
        // rather than paying a timer turn for every definite rejection.
        yieldControl: async () => {
          if (performance.now() - start >= 8) {
            await yieldToInput();
            start = performance.now();
          }
        },
      });
    } else if (data.method === "prepare-data-suggestion") {
      await pause();
      if (cancelled.delete(data.id)) return;
      result = prepareDataSuggestion(session, data.suggestion, data.input);
    } else if (data.method === "rank-suggestions") {
      const rows: AuthoringFunctionSuggestion<AuthoringFunctionEntry>[] = [];
      // A slot typed by a picked type carries its exact identity handle;
      // judge it under the name this reader's scope gives that same owner.
      const expected = scopedExpectedType(session, data.expected);
      let start = performance.now();
      for (const entry of data.entries) {
        // Lane D (Rom's decision (b)): the function's own internal marker,
        // judged in this reader's frame; the picker keeps such rows out of its
        // default list.
        rows.push(...rankAuthoringFunctionSuggestions([entry], expected, { ...data.options, registry: session.registry })
          .map(row => functionMarkedInternal(session, [(entry as { targetId?: string }).targetId, entry.id]) ? { ...row, internal: true } : row));
        if (performance.now() - start > 8) {
          await pause();
          if (cancelled.delete(data.id)) return;
          start = performance.now();
        }
      }
      result = rows.sort((left, right) => rankOrder[left.match] - rankOrder[right.match]);
    } else {
      throw new Error("The authoring worker request is unavailable.");
    }
    if (!cancelled.delete(data.id)) scope.postMessage({ id: data.id, ok: true, result });
  } catch (error) {
    // Failed adoption must not leave a private partition in a warm realm.
    if (data.method === "initialize") releaseSnapshotState();
    if (!cancelled.delete(data.id)) scope.postMessage({ id: data.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    finishWorkerJob(data.id);
    discoveryAborts.delete(data.id);
    storageAborts.delete(data.id);
    repositoryPreparationAdmissions.delete(data.id);
    cancelled.delete(data.id);
  }
}
