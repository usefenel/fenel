import { authoringInvocationEvaluateContext, evaluate, evaluateWithTrace, pureEvaluateContext, readerSourceMetadataEvaluateContext, withEvaluationStepObserver, type TraceStep } from "@fenel/engine/expressions";
import { collectReferencedSavedExpressions, exprNodeToLogic, type ExprNode, type RefResolver } from "@fenel/engine/authoring/expression";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import type { AuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { authoringStructureEnvironment, type AuthoringSession } from "./account-authoring-session";
import { assertReaderSourceMetadata, captureReaderSourceMetadata, readerSourceMetadataFrame,
  type ReaderSourceMetadataCapture } from "../reader-source-metadata";
import { authoringInvocationAdmission } from "./invocation-admission";

/** `source`: the written spelling (`std.all`), for text, saved bodies and
 * transport. `exact`: what a run evaluates. A call to a registered function
 * names that function's exact identity, as a compiled module body carries it,
 * so a function value built by the run reflects the same helpers the
 * evaluator calls (recipe readers refuse a projection spelling). */
export type AuthoringLogicHeads = "source" | "exact";

/** The exact identity of a function call target, or undefined to keep the
 * written spelling. Only an ordinary function entry whose target is this id,
 * and which this run's own frame answers with that same definition. Methods,
 * constructors, operators and unresolved names keep their spelling (a method
 * or an operator name may dispatch). An operator's runtime catalogue entry
 * carries a `notation`, which the authoring entry type does not declare. */
function exactFunctionHead(session: AuthoringSession, environment: AuthoringEnvironment, id: string): string | undefined {
  const entry = environment.getFunctionEntry?.(id);
  if (entry === undefined || entry.kind !== "function" || (entry as typeof entry & { notation?: unknown }).notation !== undefined
    || (entry.targetId ?? entry.id) !== id) return undefined;
  const spec = session.evaluateContext?.getFunction?.(id);
  return spec !== undefined && (spec.id === id || session.registry.getUuid?.(spec.id) === id) ? id : undefined;
}

/** The DOM-free product boundary shared by the editor and its prepared worker.
 * The caller supplies one exact session for both identity marshalling and
 * execution; no default/global registry is acquired here. */
export function authoringExpressionLogic(node: ExprNode, resolver: RefResolver | undefined,
  session: AuthoringSession, onExpression?: (node: ExprNode, logic: unknown) => void,
  heads: AuthoringLogicHeads = "source"): unknown {
  // B4 F2: a Local session's codec names come from its published structure
  // environment (the worker catalogue), never the page session's getters.
  const environment = () => authoringStructureEnvironment(session);
  const named = (id: string) => environment().functionCodeName(id) ?? id;
  return exprNodeToLogic(node, {
    resolver,
    fnCodeName: heads === "exact" ? (id) => exactFunctionHead(session, environment(), id) ?? named(id) : named,
    recordFromEntriesTarget: () => environment().resolveFunctionId("std.fromEntries"),
    constructorName: (id) => environment().constructorCodeName(id),
    operatorCodeName: (_notation, call) => environment().operatorCodeName(call.aliasId, call.arity),
    onMissingRef: (id) => console.warn(`toLogic: unresolved ref '${id}' (no resolver)`),
    onExpression,
  });
}

/** B3 worker input transport follows the same lowering resolver, retaining
 * only the exact source bodies it actually reads. No second source walk or
 * source lookup exists here; missing/cyclic refs keep the codec's behavior. */
export function authoringExpressionSourceEntries(node: ExprNode, saved: ReadonlyMap<string, ExprNode>,
  session: AuthoringSession): Array<readonly [string, ExprNode]> {
  const retained = new Map<string, ExprNode>();
  authoringExpressionLogic(node, identity => {
    const source = saved.get(identity);
    if (source) retained.set(identity, source);
    return source;
  }, session);
  return [...retained];
}

/** B4 unit C: the saved sources a lowering of `nodes` can reach, found
 * without a session: the codec's own saved-reference walk
 * (`collectReferencedSavedExpressions`, the executable slots the lowering
 * resolves; names and routes never change which references it reads),
 * followed through `lookup`. A Local request carries only these; its worker
 * then runs `authoringExpressionSourceEntries` over them with its own session. */
export function reachedSavedSources(nodes: readonly ExprNode[], lookup: (id: string) => ExprNode | undefined): Array<readonly [string, ExprNode]> {
  const reached = new Map<string, ExprNode>();
  const pending = [...nodes];
  while (pending.length) {
    for (const id of collectReferencedSavedExpressions(pending.pop()!)) {
      if (reached.has(id)) continue;
      const source = lookup(id);
      if (!source) continue;
      reached.set(id, source);
      pending.push(source);
    }
  }
  return [...reached];
}

export type AuthoringExpressionCapture = { readonly site: number; readonly value?: unknown; readonly unavailable?: string };

/** Identity association follows the canonical codec's own notifications. No
 * second expression walk, callable-name matching or child execution occurs. */
export function authoringExpressionSites(node: ExprNode, resolver: RefResolver | undefined, session: AuthoringSession,
  onExpression?: (node: ExprNode, logic: unknown) => void, heads: AuthoringLogicHeads = "source") {
  const sites: Array<{ node: ExprNode; logic: unknown }> = [];
  const logic = authoringExpressionLogic(node, resolver, session, (node, logic) => {
    sites.push({ node, logic });
    onExpression?.(node, logic);
  }, heads);
  return { logic, sites };
}

/** Host strategy eligibility is derived from the same source lowering. A
 * sliced sampler cannot retain a run's private callable-contract ownership. */
export function authoringExpressionAdmissionRequired(node: ExprNode, resolver: RefResolver | undefined,
  session: AuthoringSession, explicit = false): boolean {
  const admission = authoringInvocationAdmission(session.environment, session.registry, session.evaluateContext, explicit, node);
  authoringExpressionLogic(node, resolver, session, admission.observe);
  return admission.required();
}

export function evaluateAuthoringExpressionInSession(node: ExprNode, resolver: RefResolver | undefined,
  session: AuthoringSession, data: Record<string, unknown> = {}, options: { trace?: boolean; capture?: boolean; admitInvocations?: boolean;
    sourceMetadata?: ReaderSourceMetadataCapture;
    /** Run in the engine's reduced pure frame (`pureEvaluateContext`): a function
     * that only an IO handler implements does not resolve, so nothing performs IO.
     * Suggestion previews use it; an explicit Run or Preview never does. */
    pure?: boolean } = {},
): { result: unknown; trace: TraceStep[]; captures?: readonly AuthoringExpressionCapture[] } {
  // Capture before a reader facade is unwrapped. Every frame in this run sees
  // the same inert packet; absence shadows any packet on a supplied base.
  const sourceMetadata = options.sourceMetadata ?? captureReaderSourceMetadata(session);
  if (sourceMetadata) assertReaderSourceMetadata(sourceMetadata, session);
  const sourceContext = readerSourceMetadataEvaluateContext(session.evaluateContext, readerSourceMetadataFrame(sourceMetadata)._readerSourceMetadata);
  const readerContext = options.pure ? pureEvaluateContext(sourceContext) : sourceContext;
  const admission = authoringInvocationAdmission(session.environment, session.registry, readerContext, options.admitInvocations, node);
  const context = authoringInvocationEvaluateContext(readerContext, admission.hooks);
  const current = () => { if (sourceMetadata) assertReaderSourceMetadata(sourceMetadata, session); };
  if (options.capture) {
    const { logic, sites } = authoringExpressionSites(node, resolver, session, admission.observe, "exact");
    const sourceSites = new WeakMap<object, number[]>();
    const nodeSites = new WeakMap<ExprNode, number[]>();
    for (let site = 0; site < sites.length; site++) {
      const emitted = sites[site]!;
      const nodes = nodeSites.get(emitted.node) ?? [];
      nodes.push(site);
      nodeSites.set(emitted.node, nodes);
      if (emitted.logic !== null && typeof emitted.logic === "object") {
        const sources = sourceSites.get(emitted.logic) ?? [];
        sources.push(site);
        sourceSites.set(emitted.logic, sources);
      }
    }
    const snapshots = new Map<number, AuthoringExpressionCapture & { origin: "call" | "argument" }>();
    const observe = (site: number, value: unknown, origin: "call" | "argument") => {
      const previous = snapshots.get(site);
      if (origin === "argument" && previous?.origin === "call") return;
      if (previous) {
        snapshots.set(site, { site, origin, unavailable: "This expression ran more than once." });
        return;
      }
      try {
        const snapshot = decodeCheckpointValue(encodeCheckpointValue(value), CHECKPOINT_VALUE_ENCODING);
        snapshots.set(site, { site, value: snapshot, origin });
      } catch {
        snapshots.set(site, { site, origin, unavailable: "This computed data cannot be captured." });
      }
    };
    const onStep = (step: TraceStep, sourceExpression?: unknown) => {
      if (sourceExpression === null || typeof sourceExpression !== "object") return;
      // A legacy multi-step pipe emits each stage against the whole pipe.
      // Those stages cannot stand for its final value; a completed parent call
      // can still observe the actual final pipe data as its argument.
      if (step.op === "pipe-step" && Object.prototype.hasOwnProperty.call(sourceExpression, "pipe")) return;
      for (const site of sourceSites.get(sourceExpression) ?? []) {
        const source = sites[site]!.node;
        observe(site, step.result, "call");
        // The completed call supplies its actual inputs, including parameters
        // and constructed data that have no completed-call event of their own.
        if (step.op !== "call" || source.kind !== "call") continue;
        for (let index = 0; index < source.args.length && index < step.args.length; index++) {
          const argumentSites = nodeSites.get(source.args[index]!);
          if (argumentSites?.length === 1) observe(argumentSites[0]!, step.args[index], "argument");
        }
      }
    };
    const evaluated = options.trace === false
      ? withEvaluationStepObserver(context, onStep, () => ({
        result: evaluate(logic, data, context), trace: [] as TraceStep[],
      }))
      : evaluateWithTrace(logic, data, context, onStep);
    current();
    // Strip host bookkeeping before the existing worker message transport.
    return { ...evaluated, captures: [...snapshots.values()].map(({ origin: _origin, ...capture }) => capture) };
  }
  const logic = authoringExpressionLogic(node, resolver, session, admission.observe, "exact");
  // Read cards do not consume an intermediate-step trace. Preserve an
  // existing caller onStep while avoiding the extra retained result graph.
  const evaluated = options.trace === false
    ? { result: evaluate(logic, data, context), trace: [] }
    : evaluateWithTrace(logic, data, context);
  current();
  return evaluated;
}

/** B4 F2: the shown text of a live-trace step whose data cannot cross the
 * worker boundary (a closure, a host value). */
export const TRACE_STEP_UNAVAILABLE = "This step's data cannot be shown here.";

/** B4 F2 (host transport): a worker's live trace as data. Each step that a
 * structured clone refuses keeps its name and operation; its inputs and
 * result are replaced by the visible marker. Other steps pass unchanged. */
export function transferableTrace(trace: readonly TraceStep[]): TraceStep[] {
  return trace.map(step => {
    try { structuredClone(step); return step; }
    catch { return { fnName: step.fnName, op: step.op, args: [], result: TRACE_STEP_UNAVAILABLE } as unknown as TraceStep; }
  });
}
