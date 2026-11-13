import { createMemo, untrack } from "solid-js";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { concreteAuthoringSession, isInertAuthoringSession, type AuthoringSession } from "./expression-runner/account-authoring-session";
import type { EvaluationCapture } from "./expression-runner/authoring-worker-protocol";
import { authoringSessionAccountScope } from "./expression-runner/authoring-session";
import { authoringWorkerRetired, authoringWorkerSnapshot, evaluateExpressionInWorker } from "./expression-runner/authoring-catalog-worker";
import { authoringExpressionSites, evaluateAuthoringExpressionInSession, type AuthoringExpressionCapture } from "./expression-runner/expression-evaluation";
import { assertCurrentSession, sessionEpoch } from "./browser-session";
import { createAsyncValue } from "./async-value";
import { beforePictureEvaluation } from "./picture-evaluation-gate";
import { expressionKey, expressionRendersPicture, expressionRendersSampledMedia } from "./saved-expression-identity";
export { authoringWorkerSnapshot } from "./expression-runner/authoring-catalog-worker";
export { authoringExpressionSites } from "./expression-runner/expression-evaluation";
export { displayParameterName, parameterDisplayName } from "./expression-runner/call-display";
export { childValueType, framelessDisplayType } from "./data-transfer/child-type";
import { evaluateImagePipeline, readImagePipelinePreview } from "./image-pipeline-preview";
import { assertReaderSourceMetadata, captureReaderSourceMetadata, type ReaderSourceMetadataCapture } from "./reader-source-metadata";
import { savedExpressionDeclaration } from "./saved-expression-map";

export type LocusCardResult = { result: unknown; trace: readonly unknown[]; error?: string; captures?: readonly AuthoringExpressionCapture[];
  /** Browser evaluation lifetime only; this field never enters `result`. */
  sourceMetadata?: ReaderSourceMetadataCapture };
export type LocusCardEvaluationOptions = { capture?: boolean; transient?: boolean; signal?: AbortSignal; sourceMetadata?: ReaderSourceMetadataCapture };
type Entry = { epoch: number; worker?: object; pending?: Promise<LocusCardResult>; value?: LocusCardResult; captureKey?: string;
  sourceMetadata?: ReaderSourceMetadataCapture };
type Observation = { root: ExprNode; key: string; entry: Entry; sites: ReturnType<typeof authoringExpressionSites>["sites"] };
// Plain results/promises only: one card cannot dispose a sibling's Solid owner.
// The key is the resolved expression, so lenses over the same data share the
// rendered value. A different body, reader, or login misses this cache.
const results = new WeakMap<AuthoringSession, { epoch: number; worker?: object; generationToken?: object;
  entries: Map<string, Entry>; observations: Map<string, Observation> }>();
// Bound retained root runs, including copied intermediate arrays. Ordinary
// final-answer entries keep their existing lifetime; edited Graph runs retain
// nothing here. A single captured result is still as large as its actual data.
const MAX_OBSERVATIONS = 16;
const captureSourceIdentities = new WeakMap<ExprNode, number>();
let nextCaptureSourceIdentity = 0;
/** A frameless (Local) session evaluates only in its worker: none attached. */
const FRAMELESS_TOOLS_PENDING = "This reader's editing tools are not ready. Prepare them and try again.";
function sameSourceMetadata(previous: ReaderSourceMetadataCapture | undefined, current: ReaderSourceMetadataCapture | undefined): boolean {
  if (previous?.generationToken !== current?.generationToken) return false;
  try { return (!previous || previous.current()) && (!current || current.current()); } catch { return false; }
}
function cardSourceMetadata(supplied: AuthoringSession, provided?: ReaderSourceMetadataCapture): ReaderSourceMetadataCapture | undefined {
  try {
    const capture = provided ?? captureReaderSourceMetadata(supplied);
    if (capture) assertReaderSourceMetadata(capture, supplied);
    return capture;
  } catch (error) {
    try {
      const library = results.get(concreteAuthoringSession(supplied));
      library?.entries.clear(); library?.observations.clear();
      if (library) library.generationToken = undefined;
    } catch { /* A disposed facade cannot retain an answer for another source. */ }
    throw error;
  }
}
function entries(session: AuthoringSession, epoch: number, worker: object | undefined, sourceMetadata?: ReaderSourceMetadataCapture) {
  const existing = results.get(session);
  if (existing && existing.epoch === epoch && existing.worker === worker
    && existing.generationToken === sourceMetadata?.generationToken) return existing.entries;
  // Pending jobs may still hold the old map. Empty it before replacing the
  // owner so unrelated retired entries cannot retain old source/image state.
  existing?.entries.clear(); existing?.observations.clear();
  const library = new Map<string, Entry>();
  results.set(session, { epoch, worker, generationToken: sourceMetadata?.generationToken, entries: library, observations: new Map() });
  return library;
}
function cardKey(node: ExprNode, saved: ReadonlyMap<string, ExprNode>): string {
  return expressionKey(node, saved);
}

function capturedCardKey(node: ExprNode, saved: ReadonlyMap<string, ExprNode>, session: AuthoringSession): string {
  // Ordinary cards can share a resolved answer with its reference. Captures
  // additionally retain every actual source object reported by the codec.
  const { sites } = authoringExpressionSites(node, id => saved.get(id), session);
  const identities = sites.map(site => {
    let identity = captureSourceIdentities.get(site.node);
    if (identity === undefined) {
      identity = ++nextCaptureSourceIdentity;
      captureSourceIdentities.set(site.node, identity);
    }
    return identity;
  });
  return `capture:${identities.join(",")}:${cardKey(node, saved)}`;
}

export function readLocusCardResult(node: ExprNode, saved: ReadonlyMap<string, ExprNode>, supplied: AuthoringSession,
  options: { capture?: boolean; sourceMetadata?: ReaderSourceMetadataCapture } = {}): LocusCardResult | undefined {
  let sourceMetadata: ReaderSourceMetadataCapture | undefined;
  try {
    sourceMetadata = cardSourceMetadata(supplied, options.sourceMetadata);
  } catch { return undefined; }
  const session = concreteAuthoringSession(supplied);
  const worker = authoringWorkerSnapshot(session);
  const key = options.capture ? capturedCardKey(node, saved, session) : cardKey(node, saved);
  const entry = entries(session, sessionEpoch(), worker, sourceMetadata).get(key);
  if (entry?.epoch === sessionEpoch() && entry.worker === worker && entry.value && sameSourceMetadata(entry.sourceMetadata, sourceMetadata)) return entry.value;
  if (!options.capture) return undefined;
  const observations = results.get(session)?.observations;
  if (!observations) return undefined;
  const found = observations.get(key);
  const exact = found && sameSourceMetadata(found.entry.sourceMetadata, sourceMetadata) ? found : undefined;
  const candidates = exact ? [exact] : [...observations.values()].filter(observation => sameSourceMetadata(observation.entry.sourceMetadata, sourceMetadata) && observation.sites.some(source => source.node === node)
    && capturedCardKey(observation.root, saved, session) === observation.key);
  // The same source object executed under two containing lexical frames does
  // not identify one result. Keep that case unavailable instead of guessing.
  if (candidates.length !== 1) return undefined;
  for (const observation of candidates) {
    if (!observation.entry.value || observation.entry.epoch !== sessionEpoch() || observation.entry.worker !== worker
      || !sameSourceMetadata(observation.entry.sourceMetadata, sourceMetadata)) continue;
    // A sibling card must not erase this card's actual execution. A child may
    // reuse it only when its exact source object occurred once in that run.
    if (capturedCardKey(observation.root, saved, session) !== observation.key) continue;
    observations.delete(observation.key); observations.set(observation.key, observation);
    if (observation.key === key) return observation.entry.value;
    const value = readLocusCapturedValue(observation.root, saved, supplied, node, observation.entry.value, sourceMetadata);
    if (!value) continue;
    const original = observation.sites;
    const selected = authoringExpressionSites(node, id => saved.get(id), session).sites;
    const captures: AuthoringExpressionCapture[] = [];
    for (let site = 0; site < selected.length; site++) {
      const matches = original.flatMap((source, index) => source.node === selected[site]!.node ? [index] : []);
      if (matches.length !== 1) continue;
      const capture = observation.entry.value.captures?.find(capture => capture.site === matches[0]);
      if (capture) captures.push({ ...capture, site });
    }
    return { result: value.value, trace: [], captures, ...(sourceMetadata ? { sourceMetadata } : {}) };
  }
  return undefined;
}

/** A read-only projection of this reader's same root run. Unexecuted,
 * multiply-used and unsupported source sites remain unavailable. */
export function readLocusCapturedValue(root: ExprNode, saved: ReadonlyMap<string, ExprNode>, supplied: AuthoringSession,
  child: ExprNode, observed?: LocusCardResult, providedMetadata?: ReaderSourceMetadataCapture): { value: unknown } | undefined {
  let sourceMetadata: ReaderSourceMetadataCapture | undefined;
  try { sourceMetadata = cardSourceMetadata(supplied, providedMetadata); } catch { return undefined; }
  if (observed && !sameSourceMetadata(observed.sourceMetadata, sourceMetadata)) return undefined;
  const session = concreteAuthoringSession(supplied);
  const captured = observed ?? readLocusCardResult(root, saved, supplied, { capture: true, sourceMetadata });
  if (captured && !captured.error && child === root && Object.prototype.hasOwnProperty.call(captured, "result")) {
    return { value: captured.result };
  }
  if (!captured?.captures) return undefined;
  const { sites } = authoringExpressionSites(root, id => saved.get(id), session);
  let selected: number | undefined;
  for (let site = 0; site < sites.length; site++) {
    if (sites[site]!.node !== child) continue;
    if (selected !== undefined) return undefined;
    selected = site;
  }
  if (selected === undefined) return undefined;
  const value = captured.captures.find(capture => capture.site === selected);
  return value && !value.unavailable && Object.prototype.hasOwnProperty.call(value, "value") ? { value: value.value } : undefined;
}

function storedData(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value !== "object" || depth > 6) return false;
  if (Array.isArray(value)) return value.every(entry => storedData(entry, depth + 1));
  for (const key of Object.keys(value)) {
    if (key === "construct" || key.startsWith("__")) return false;
    if (!storedData((value as Record<string, unknown>)[key], depth + 1)) return false;
  }
  return true;
}

/** A literal the reader can show without the editing worker. Constructs and
 *  closures still need the evaluator. */
function dataLiteral(node: ExprNode, saved: ReadonlyMap<string, ExprNode>, stack: string[] = []): { value: unknown } | undefined {
  if (savedExpressionDeclaration(node)) return undefined;
  if (node.kind === "literal") return storedData(node.value) ? { value: node.value } : undefined;
  if (node.kind !== "ref" || stack.includes(node.savedExprId)) return undefined;
  const target = saved.get(node.savedExprId);
  if (!target) return undefined;
  return dataLiteral(target, saved, [...stack, node.savedExprId]);
}

function paintedImage(node: ExprNode, saved: ReadonlyMap<string, ExprNode>): unknown | undefined {
  const image = evaluateImagePipeline(node, saved);
  if (image && typeof image === "object" && "pixels" in image) return image;
  return readImagePipelinePreview(cardKey(node, saved));
}

export function evaluateLocusCard(node: ExprNode, saved: ReadonlyMap<string, ExprNode>, supplied: AuthoringSession,
  options: LocusCardEvaluationOptions = {}): LocusCardResult | Promise<LocusCardResult> {
  const sourceMetadata = cardSourceMetadata(supplied, options.sourceMetadata);
  const session = concreteAuthoringSession(supplied);
  const epoch = sessionEpoch();
  const signal = options.transient ? options.signal : undefined;
  signal?.throwIfAborted();
  // B4 wave 4 lane S: a frameless (Local) page session makes no media
  // decision; its worker makes the same one (`capture: "unless-sampled"`).
  const frameless = isInertAuthoringSession(session);
  // Automatic mounted-Graph recording preserves the existing sliced media
  // route. It does not opt a picture/audio/movie into a full observed render.
  const capture = !!options.capture && (frameless || !options.transient || !expressionRendersSampledMedia(node, saved, session));
  const literal = dataLiteral(node, saved);
  if (literal) {
    let worker: object | undefined;
    try { worker = authoringWorkerSnapshot(session); } catch { worker = undefined; }
    const value = { result: literal.value, trace: [] as const, ...(capture ? { captures: [] } : {}), ...(sourceMetadata ? { sourceMetadata } : {}) };
    if (!options.transient) entries(session, epoch, worker, sourceMetadata).set(capture ? capturedCardKey(node, saved, session) : cardKey(node, saved), { epoch, worker, value, sourceMetadata });
    return value;
  }
  const declaredRoot = savedExpressionDeclaration(node) !== undefined;
  const direct = capture || declaredRoot ? undefined : paintedImage(node, saved);
  if (direct !== undefined) {
    let worker: object | undefined;
    try { worker = authoringWorkerSnapshot(session); } catch { worker = undefined; }
    const value = { result: direct, trace: [] as const, ...(sourceMetadata ? { sourceMetadata } : {}) };
    if (!options.transient) entries(session, epoch, worker, sourceMetadata).set(cardKey(node, saved), { epoch, worker, value, sourceMetadata });
    return value;
  }
  const worker = authoringWorkerSnapshot(session);
  const scope = authoringSessionAccountScope(session);
  if (scope && !worker) throw new Error("This account's editing tools are no longer available. Reload your data before retrying.");
  if (capture && options.transient) {
    const observed = readLocusCardResult(node, saved, supplied, { capture: true, sourceMetadata });
    if (observed) return observed;
    const existing = results.get(session)?.entries.get(cardKey(node, saved));
    if (existing?.pending && existing.epoch === epoch && existing.worker === worker && sameSourceMetadata(existing.sourceMetadata, sourceMetadata)
      && existing.captureKey === capturedCardKey(node, saved, session)) {
      // Opening Graph while its ordinary card is still computing shares that
      // one run. Cancelling Graph does not cancel its sibling's read.
      return existing.pending.then(() => {
        assertCurrentSession(epoch); signal?.throwIfAborted();
        if (authoringWorkerSnapshot(session) !== worker) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
        // A frameless run that rendered sampled media recorded nothing: its
        // plain answer is what this Graph read gets (as without capture).
        const captured = readLocusCardResult(node, saved, supplied, { capture: true, sourceMetadata })
          ?? (frameless ? readLocusCardResult(node, saved, supplied, { sourceMetadata }) : undefined);
        if (!captured) throw new Error("This expression changed while its data was being computed. Retry with the current data.");
        return captured;
      });
    }
  }
  // A mounted Graph owns its one current result. It neither reuses nor
  // retains observations in the session's ordinary card library.
  const nodes = options.transient ? undefined : entries(session, epoch, worker, sourceMetadata);
  const key = capture && !options.transient ? capturedCardKey(node, saved, session) : cardKey(node, saved);
  const painted = capture || declaredRoot ? undefined : readImagePipelinePreview(key);
  if (painted !== undefined) {
    const value = { result: painted, trace: [] as const, ...(sourceMetadata ? { sourceMetadata } : {}) };
    nodes?.set(key, { epoch, worker, value, sourceMetadata });
    return value;
  }
  const previous = nodes?.get(key);
  if (previous?.epoch === epoch && previous.worker === worker && sameSourceMetadata(previous.sourceMetadata, sourceMetadata)) {
    if (previous.value) return previous.value;
    if (previous.pending) return previous.pending;
  }
  const rendersPicture = expressionRendersPicture(node, saved, session);
  // Frameless: an explicit (non-transient) capture records; a mounted Graph
  // or an ordinary card records unless its run renders sampled media.
  const record: EvaluationCapture = frameless
    ? capture && !options.transient ? true : capture || !!nodes ? "unless-sampled" : false
    : capture || !!nodes && authoringExpressionSites(node, id => saved.get(id), session).sites
      .every(site => !expressionRendersSampledMedia(site.node, saved, session));
  const observationKey = record && !capture ? capturedCardKey(node, saved, session) : undefined;
  const completed = (answer: LocusCardResult): LocusCardResult => {
    if (sourceMetadata) assertReaderSourceMetadata(sourceMetadata, supplied);
    const value = sourceMetadata ? { ...answer, sourceMetadata } : answer;
    if (!observationKey || !value.captures) return value;
    // Ordinary answers retain their sharing key; bounded exact-source runs
    // retain their own snapshots instead of being erased by sibling cards.
    const library = results.get(session);
    if (library && nodes && library.entries === nodes) {
      library.observations.delete(observationKey);
      library.observations.set(observationKey, { root: node, key: observationKey, entry: { epoch, worker, value, sourceMetadata },
        sites: authoringExpressionSites(node, id => saved.get(id), session).sites });
      if (library.observations.size > MAX_OBSERVATIONS) library.observations.delete(library.observations.keys().next().value!);
    }
    const { captures: _captures, ...plainAnswer } = value;
    return plainAnswer;
  };
  // A card's own evaluation is one real computation (a recipe card's first
  // analysis runs minutes): it asks for the evaluation allowance.
  const remote = rendersPicture ? undefined : evaluateExpressionInWorker(session, node, saved, signal, scope,
    { capture: record, cardEvaluation: true, ...(sourceMetadata ? { sourceMetadata } : {}) });
  if (!rendersPicture && !remote) {
    if (frameless) throw new Error(FRAMELESS_TOOLS_PENDING);
    if (worker || scope) throw new Error("This account's editing tools do not match the current reader. Reload your data before retrying.");
    // Existing detached public/standalone previews have no private worker.
    // Keep their canonical session; never borrow an account's evaluator.
    const evaluated = evaluateAuthoringExpressionInSession(node, id => saved.get(id), session, {},
      { trace: false, capture: record === true, ...(sourceMetadata ? { sourceMetadata } : {}) });
    assertCurrentSession(epoch);
    signal?.throwIfAborted();
    const value = completed(evaluated);
    nodes?.set(key, { epoch, value, sourceMetadata });
    return value;
  }
  const entry: Entry = { epoch, worker, captureKey: observationKey, sourceMetadata };
  const pending = (async () => {
    // Yield so photo cards posted in this same turn reach the worker first.
    if (rendersPicture) await beforePictureEvaluation();
    signal?.throwIfAborted();
    assertCurrentSession(epoch);
    if (authoringWorkerSnapshot(session) !== worker) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
    const job = remote ?? evaluateExpressionInWorker(session, node, saved, signal, scope,
      { capture: record, cardEvaluation: true, ...(sourceMetadata ? { sourceMetadata } : {}) });
    if (!job) {
      if (frameless) throw new Error(FRAMELESS_TOOLS_PENDING);
      if (worker || scope) throw new Error("This account's editing tools do not match the current reader. Reload your data before retrying.");
      const evaluated = evaluateAuthoringExpressionInSession(node, id => saved.get(id), session, {},
        { trace: false, capture: record === true, ...(sourceMetadata ? { sourceMetadata } : {}) });
      assertCurrentSession(epoch);
      signal?.throwIfAborted();
      const value = completed(evaluated);
      entry.value = value;
      entry.pending = undefined;
      return value;
    }
    const evaluated = await job;
    signal?.throwIfAborted();
    assertCurrentSession(epoch);
    if (authoringWorkerSnapshot(session) !== worker) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
    const value = completed(evaluated);
    entry.value = value;
    entry.pending = undefined;
    return value;
  })();
  entry.pending = pending;
  nodes?.set(key, entry);
  void pending.catch(() => { if (nodes?.get(key) === entry) nodes.delete(key); });
  return pending;
}

/** Each consumer owns its pending/error state, while sharing only the exact
 * immutable read above. A later input never displays an earlier result.
 * A refresh keeps the picture already on screen instead of putting the spinner back. */
export function createLocusCardEvaluation(source: () => {
  expr?: ExprNode; saved: ReadonlyMap<string, ExprNode>; session: AuthoringSession;
  evaluated?: { value: unknown }; observed?: LocusCardResult; skip?: boolean; capture?: boolean; transient?: boolean; signal?: AbortSignal;
  sourceMetadata?: ReaderSourceMetadataCapture;
}) {
  const response = createAsyncValue(source, input => {
    const sourceMetadata = cardSourceMetadata(input.session, input.sourceMetadata);
    if (input.observed && sameSourceMetadata(input.observed.sourceMetadata, sourceMetadata)) return input.observed;
    if (input.evaluated) return { result: input.evaluated.value, trace: [] };
    if (input.skip) return { result: undefined, trace: [] };
    if (!input.expr) throw new Error("This card's reference resolved to nothing.");
    // A retired worker is replaced by a publication or a restoration of this
    // snapshot: the card stays pending (this read tracks the worker revision)
    // instead of answering with a failure meanwhile.
    const preparing = () => new Promise<LocusCardResult>(() => {});
    if (authoringWorkerRetired(input.session)) return preparing();
    const evaluate = () => evaluateLocusCard(input.expr!, input.saved, input.session,
      { capture: input.capture, transient: input.transient, signal: input.signal, ...(sourceMetadata ? { sourceMetadata } : {}) });
    // Mounted Graph owns its exact token through the source. An unrelated
    // worker publication must not become an extra transient-evaluation trigger.
    const job = input.transient ? untrack(evaluate) : evaluate();
    return Promise.resolve(job).catch(error => {
      if (untrack(() => authoringWorkerRetired(input.session))) return preparing();
      throw error;
    });
  });
  const value = createMemo<LocusCardResult>(() => {
    if (response.loading) {
      const input = source();
      if (input.observed) {
        try { if (sameSourceMetadata(input.observed.sourceMetadata, cardSourceMetadata(input.session, input.sourceMetadata))) return input.observed; }
        catch { /* A retired source cannot display its old observed result. */ }
      }
      if (input.expr && !input.evaluated && !input.skip && !input.transient) {
        // Pending display shares the evaluator's reader/epoch/worker/body
        // association. A previous consumer result cannot bypass that owner.
        try { return readLocusCardResult(input.expr, input.saved, input.session,
          { capture: input.capture, ...(input.sourceMetadata ? { sourceMetadata: input.sourceMetadata } : {}) }) ?? { result: undefined, trace: [] }; }
        catch { /* A retired reader has no current display result. */ }
      }
      return { result: undefined, trace: [] };
    }
    const error = response.error;
    if (error) return { result: undefined, trace: [], error: error instanceof Error ? error.message : String(error) };
    return response() ?? { result: undefined, trace: [] };
  });
  return {
    value,
    loading: () => {
      const current = value();
      return response.loading && current.result === undefined && !current.error;
    },
    retry: () => response.refetch(),
  };
}
