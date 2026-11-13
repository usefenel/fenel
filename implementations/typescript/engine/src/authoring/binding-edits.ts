import type { EvaluateContext } from "../json-logic";
import type { FenelType, InferenceOutcome, TypeScheme } from "../types";
import { exprNodeToLogic, type ExprNode } from "./expression-authoring";
import { dispatchEngineBody, marshalStoredBodyForValidation } from "../engine-bodies-dispatch";
import { Just, Nothing, peelMaybeValue, type Maybe } from "../type-foundation";
import type { AuthoringTypeCompatibility } from "./call-guidance";

export interface AuthoringBindingDraft {
  params: readonly { name: string; type?: FenelType }[];
  body: ExprNode;
  returns?: FenelType;
  scheme?: TypeScheme;
}

export type AuthoringBindingEdit =
  | { kind: "rename"; index: number; name: string }
  | { kind: "remove"; index: number }
  | { kind: "add"; name: string };

export interface AuthoringBindingDiagnostic {
  code: string;
  message: string;
  path: (string | number)[];
}

export type AuthoringBindingEditResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: AuthoringBindingDiagnostic[] };

type BindingPatch = { path: (string | number)[]; before: string; after: string };
type BindingPlan = {
  patches: BindingPatch[];
  diagnostics: AuthoringBindingDiagnostic[];
  reattachments: { path: (string | number)[]; source: (string | number)[] }[];
  selections: { path: (string | number)[]; indices: number[] }[];
  initializations?: { path: (string | number)[]; value: unknown }[];
};

function materializeBindingPlan<T>(draft: T, plan: BindingPlan): AuthoringBindingEditResult<T> {
  if (!plan || !Array.isArray(plan.patches) || !Array.isArray(plan.diagnostics)
    || !Array.isArray(plan.reattachments) || !Array.isArray(plan.selections)
    || (plan.initializations !== undefined && !Array.isArray(plan.initializations))) {
    throw new TypeError("Binding analysis returned no readable result.");
  }
  if (plan.diagnostics.length > 0) return { ok: false, diagnostics: plan.diagnostics };
  let value: unknown = draft;
  for (const initialization of plan.initializations ?? []) {
    value = replaceBindingPath(value, initialization.path, initialization.value);
  }
  for (const patch of plan.patches) {
    if (!patch || !Array.isArray(patch.path) || !patch.path.every((part) =>
      typeof part === "string" || (typeof part === "number" && Number.isSafeInteger(part) && part >= 0))
      || typeof patch.before !== "string" || typeof patch.after !== "string") {
      throw new TypeError("Binding analysis returned a malformed patch.");
    }
    value = applyBindingPatch(value, patch);
  }
  for (const selection of plan.selections) {
    const original = readBindingPath(value, selection.path);
    if (!Array.isArray(original) || !Array.isArray(selection.indices)) throw new TypeError("Binding selection is not a list.");
    const selected = selection.indices.map((index) => {
      if (!Number.isSafeInteger(index) || index < 0 || index >= original.length) throw new TypeError("Binding selection index is invalid.");
      return readBindingPath(original, [index]);
    });
    value = replaceBindingPath(value, selection.path, selected);
  }
  for (const reattachment of plan.reattachments) {
    value = replaceBindingPath(value, reattachment.path, readBindingPath(value, reattachment.source));
  }
  return { ok: true, value: value as T };
}

function bindingBoundaryFailure(error: unknown): { ok: false; diagnostics: AuthoringBindingDiagnostic[] } {
  return { ok: false, diagnostics: [{
    code: "binding.boundary", path: [],
    message: error instanceof Error ? error.message : "Binding analysis is unavailable.",
  }] };
}

/** B3 transport: copy only a source-selected path through own data properties.
 * No expression interpretation or binding decision lives in this function. */
function applyBindingPatch(root: unknown, patch: BindingPatch, depth = 0): unknown {
  if (readBindingPath(root, patch.path) !== patch.before) throw new TypeError("Binding patch no longer matches its source value.");
  return replaceBindingPath(root, patch.path, patch.after, depth);
}

function readBindingPath(root: unknown, path: readonly (string | number)[]): unknown {
  if (!Array.isArray(path)) throw new TypeError("Binding path is not a list.");
  let value = root;
  for (const key of path) {
    if (typeof key !== "string" && (typeof key !== "number" || !Number.isSafeInteger(key) || key < 0)) throw new TypeError("Binding path component is invalid.");
    if (value === null || typeof value !== "object") throw new TypeError("Binding path is not an object.");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("Binding path is not an own data property.");
    value = descriptor.value;
  }
  return value;
}

function replaceBindingPath(root: unknown, path: readonly (string | number)[], next: unknown, depth = 0): unknown {
  if (!Array.isArray(path)) throw new TypeError("Binding path is not a list.");
  if (depth === path.length) return next;
  if (root === null || typeof root !== "object") throw new TypeError("Binding patch path is not an object.");
  const key = path[depth]!;
  if (typeof key !== "string" && (typeof key !== "number" || !Number.isSafeInteger(key) || key < 0)) throw new TypeError("Binding path component is invalid.");
  const descriptors = Object.getOwnPropertyDescriptors(root);
  const descriptor = descriptors[key];
  if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("Binding patch path is not an own data property.");
  const replacement = replaceBindingPath(descriptor.value, path, next, depth + 1);
  descriptors[key] = { ...descriptor, value: replacement };
  const copy = Array.isArray(root) ? [] : Object.create(Object.getPrototypeOf(root));
  Object.defineProperties(copy, descriptors);
  return copy;
}

/** Fenel owns name validation, lexical scope, capture checks and replacement
 * planning. The host snapshots the existing carrier and reattaches leaf edits
 * to it, retaining undefined holes and every unrelated descriptor/identity.
 * Add/remove success validates the edit; the caller owns parameter row changes.
 * This extends the existing A2/B3 invocation/marshal exception categories.
 * GLOBAL_ONLY when context is omitted: this closed draft analysis performs no
 * host acts, resolves no user definition, and caches no reader/frame data. */
export function editAuthoringBinding<T extends AuthoringBindingDraft>(
  draft: T,
  edit: AuthoringBindingEdit,
  context?: EvaluateContext,
): AuthoringBindingEditResult<T> {
  try {
    const plan = dispatchEngineBody("engine:authoringBindingEditPlan", [
      marshalStoredBodyForValidation(draft),
      { kind: edit.kind, index: "index" in edit ? edit.index : -1, name: "name" in edit ? edit.name : "" },
    ], context) as BindingPlan;
    return materializeBindingPlan(draft, plan);
  } catch (error) {
    return bindingBoundaryFailure(error);
  }
}

/** Whole-row sibling for TypeBuilder changes. Fenel compares FieldKeys and
 * checks simultaneous renames/removals/additions; this adapter only supplies
 * original and next carriers and applies its patches to the proposed rows.
 * GLOBAL_ONLY without context for the same closed pure-analysis reason above. */
export function reconcileAuthoringBindingRows<T extends AuthoringBindingDraft>(
  draft: T,
  nextParams: T["params"],
  context?: EvaluateContext,
): AuthoringBindingEditResult<T> {
  try {
    const plan = dispatchEngineBody("engine:authoringBindingRowsPlan", [
      marshalStoredBodyForValidation(draft), marshalStoredBodyForValidation(nextParams),
    ], context) as BindingPlan;
    return materializeBindingPlan({ ...draft, params: nextParams }, plan);
  } catch (error) {
    return bindingBoundaryFailure(error);
  }
}

export type AuthoringCallEdit =
  | { kind: "wrap"; call: ExprNode; index?: number; targetIndex?: number }
  | { kind: "remove"; empty: ExprNode; index?: number; names?: readonly string[]; logic?: unknown }
  /** Move a call up past the call feeding its first input (Fenel plans it). */
  | { kind: "swap" };

/** Fenel chooses the original carrier paths; this existing B3 boundary only
 * snapshots them and materializes reattachments. The supplied call comes from
 * canonical call guidance and seeding, and the empty slot from the editor.
 * GLOBAL_ONLY without context: a closed draft edit resolves no definitions,
 * performs no host acts and retains no reader/frame data. */
export function editAuthoringCall(
  node: ExprNode,
  edit: AuthoringCallEdit,
  context?: EvaluateContext,
): AuthoringBindingEditResult<ExprNode> {
  try {
    const draft = { node, call: edit.kind === "wrap" ? edit.call : undefined,
      empty: edit.kind === "remove" ? edit.empty : undefined, replacement: undefined,
      logic: edit.kind === "remove" ? edit.logic ?? exprNodeToLogic(node) : undefined };
    const targetIndex = edit.kind === "wrap" ? edit.targetIndex : undefined;
    const index = edit.kind === "swap" ? undefined : edit.index;
    const plan = dispatchEngineBody("engine:authoringCallEditPlan", [
      marshalStoredBodyForValidation(draft),
      { kind: edit.kind, index: index === undefined ? Nothing : Just(index),
        targetIndex: targetIndex === undefined ? Nothing : Just(targetIndex),
        names: edit.kind === "remove" ? edit.names ?? [] : [] },
    ], context) as BindingPlan;
    const result = materializeBindingPlan(draft, plan);
    return result.ok ? { ok: true, value: result.value.node } : result;
  } catch (error) {
    return bindingBoundaryFailure(error);
  }
}

/** B3 transport of existing verdicts to the source-owned edge presentation.
 * GLOBAL_ONLY without context: deterministic projection, with no reader lookup
 * or host perform. Compatibility remains the existing author's judgment. */
export function projectAuthoringGraphEdgeIssue(
  compatibility: AuthoringTypeCompatibility,
  outcome: InferenceOutcome,
  mismatchMessage: string,
  context?: EvaluateContext,
): string | undefined {
  const issue = dispatchEngineBody("engine:authoringGraphEdgeIssuePlan", [
    compatibility, marshalStoredBodyForValidation(outcome), mismatchMessage,
  ], context) as Maybe<string>;
  return peelMaybeValue(issue) ?? undefined;
}

/** B3 roster transport: Fenel selects indices; the browser keeps the exact
 * original catalogue entries. GLOBAL_ONLY without context: no reader lookup,
 * callable inference or type compatibility judgment. */
export function selectAuthoringCallCandidates<T extends { params: readonly unknown[] }>(
  entries: readonly T[],
  requiresInput: boolean,
  context?: EvaluateContext,
): T[] {
  const indices = dispatchEngineBody("engine:authoringCallCandidateIndices", [
    entries.map(entry => entry.params.length), requiresInput,
  ], context) as number[];
  return indices.map(index => readBindingPath(entries, [index]) as T);
}

export interface AuthoringResultBindingProposal {
  expression: ExprNode;
  name: string;
  scopePath: (string | number)[];
  targetPath: (string | number)[];
  scope: ExprNode;
}

/** B3 exact-occurrence transport. Prefixes are descriptor paths supplied by
 * the mounted editor; the canonical codec supplies their lowered carriers.
 * Only prefixes that the source-owned site plan reports as executable
 * occurrences are lowered: intermediate carriers such as an `args` list are
 * not expressions, and the codec rightly refuses them.
 * Fenel chooses scope and checks names, then the existing materializer retains
 * original subtrees in the proposed expression. No source write occurs here.
 * GLOBAL_ONLY without context: closed supplied draft analysis, no host act or
 * registry lookup. Product callers supply their session's existing lowerer. */
export function proposeAuthoringResultBinding(
  root: ExprNode,
  targetPath: readonly (string | number)[],
  name: string,
  options: {
    lower?: (node: ExprNode) => unknown;
    boundNames?: readonly string[];
    context?: EvaluateContext;
  } = {},
): AuthoringBindingEditResult<AuthoringResultBindingProposal> {
  try {
    readBindingPath(root, targetPath);
    const sitePlan = readAuthoringExpressionSitePlan(root, options.context);
    if (sitePlan.diagnostics.length > 0) return { ok: false, diagnostics: sitePlan.diagnostics };
    const sites: { depth: number; logic: unknown }[] = [];
    for (let depth = 0; depth <= targetPath.length; depth++) {
      const prefix = targetPath.slice(0, depth);
      if (!sitePlan.occurrences.some(site => sameAuthoringExpressionPath(site.path, prefix))) continue;
      const original = readBindingPath(root, prefix);
      const logic = options.lower ? options.lower(original as ExprNode) : exprNodeToLogic(original as ExprNode);
      sites.push({ depth, logic: marshalStoredBodyForValidation(logic) });
    }
    const draft = { node: root, replacement: undefined, reference: undefined, scope: undefined };
    const plan = dispatchEngineBody("engine:authoringResultBindingPlan", [
      marshalStoredBodyForValidation(draft),
      { targetPath, name, boundNames: options.boundNames ?? [], sites },
    ], options.context) as BindingPlan & Pick<AuthoringResultBindingProposal, "name" | "scopePath" | "targetPath">;
    const result = materializeBindingPlan(draft, plan);
    return result.ok ? { ok: true, value: { expression: result.value.node, name: plan.name,
      scopePath: plan.scopePath, targetPath: plan.targetPath, scope: result.value.scope as unknown as ExprNode } } : result;
  } catch (error) {
    return bindingBoundaryFailure(error);
  }
}

/** B3 pre-codec transport. Fenel validates actual authored binding rows before
 * object serialization can collapse duplicate names. GLOBAL_ONLY without
 * context: supplied-draft inspection, no reader lookup or host perform. */
export function authoringBindingNameIssue(node: ExprNode, context?: EvaluateContext): string | undefined {
  try {
    const issue = dispatchEngineBody("engine:authoringBindingNameIssuePlan", [
      marshalStoredBodyForValidation(node),
    ], context) as Maybe<string>;
    return peelMaybeValue(issue) ?? undefined;
  } catch (error) {
    return bindingBoundaryFailure(error).diagnostics[0]?.message;
  }
}

type AuthoringExpressionPath = (string | number)[];
type AuthoringExpressionSitePlan = {
  occurrences: { path: AuthoringExpressionPath; hasEnclosingAnnotation: boolean; detached: boolean }[];
  annotations: { expressionPath: AuthoringExpressionPath; typePath: AuthoringExpressionPath }[];
  barriers: AuthoringExpressionPath[];
  diagnostics: AuthoringBindingDiagnostic[];
};

export interface AuthoringExpressionOccurrence {
  path: AuthoringExpressionPath;
  hasEnclosingAnnotation: boolean;
  detached: boolean;
  /** Source order is deepest first so checking wrappers retain ancestor paths. */
  annotations: {
    expressionPath: AuthoringExpressionPath;
    typePath: AuthoringExpressionPath;
    expression: ExprNode;
    type: unknown;
  }[];
  barriers: AuthoringExpressionPath[];
}

/** A2 invocation of the source-owned site plan, refusing an unreadable answer. */
function readAuthoringExpressionSitePlan(root: ExprNode, context?: EvaluateContext): AuthoringExpressionSitePlan {
  const plan = dispatchEngineBody("engine:authoringExpressionSites", [
    marshalStoredBodyForValidation(root),
  ], context) as AuthoringExpressionSitePlan;
  if (!plan || !Array.isArray(plan.occurrences) || !Array.isArray(plan.annotations)
    || !Array.isArray(plan.barriers) || !Array.isArray(plan.diagnostics)
    || !plan.occurrences.every(site => site && Array.isArray(site.path))) {
    throw new TypeError("Expression occurrence analysis returned no readable result.");
  }
  return plan;
}

/** B3 transport: exact component equality of two source-reported paths. */
function sameAuthoringExpressionPath(left: readonly (string | number)[], right: readonly (string | number)[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

/** B3 projection of a source-selected path through own data descriptors. The
 * caller supplies paths from the existing expression-site planner; no recursive
 * expression traversal or type judgment lives at this boundary. */
export function readAuthoringExpressionPath(root: ExprNode, path: readonly (string | number)[]): unknown {
  return readBindingPath(root, path);
}

/** Fenel selects executable slots, annotation sites and initializer boundaries.
 * The host associates one original carrier by identity, refusing shared or
 * missing occurrences instead of guessing a path from structural equality.
 * This extends existing A2/B3 invocation and descriptor transport categories.
 * GLOBAL_ONLY without context: closed supplied-draft analysis, no host act. */
export function inspectAuthoringExpressionOccurrence(
  root: ExprNode,
  selected: ExprNode,
  context?: EvaluateContext,
): AuthoringBindingEditResult<AuthoringExpressionOccurrence> {
  try {
    const plan = readAuthoringExpressionSitePlan(root, context);
    if (plan.diagnostics.length > 0) return { ok: false, diagnostics: plan.diagnostics };
    const matches = plan.occurrences.filter(site => readBindingPath(root, site.path) === selected);
    if (matches.length !== 1) return { ok: false, diagnostics: [{
      code: "binding.occurrence", path: [],
      message: "The selected expression does not identify one current executable occurrence.",
    }] };
    const occurrence = matches[0]!;
    if (typeof occurrence.hasEnclosingAnnotation !== "boolean" || typeof occurrence.detached !== "boolean") {
      throw new TypeError("Expression occurrence analysis returned unreadable context flags.");
    }
    return { ok: true, value: {
      ...occurrence,
      annotations: plan.annotations.map(site => ({ ...site,
        expression: readBindingPath(root, site.expressionPath) as ExprNode,
        type: readBindingPath(root, site.typePath),
      })),
      barriers: plan.barriers,
    } };
  } catch (error) {
    return bindingBoundaryFailure(error);
  }
}

/** Source validates the exact executable path; the existing B3 materializer
 * reattaches the supplied replacement without copying untouched subtrees.
 * GLOBAL_ONLY without context: closed supplied-draft edit, no host act. */
export function replaceAuthoringExpressionOccurrence(
  root: ExprNode,
  path: readonly (string | number)[],
  replacement: ExprNode,
  context?: EvaluateContext,
): AuthoringBindingEditResult<ExprNode> {
  try {
    const draft = { node: root, replacement };
    const plan = dispatchEngineBody("engine:authoringExpressionOccurrencePlan", [
      marshalStoredBodyForValidation(draft), path,
    ], context) as BindingPlan;
    const result = materializeBindingPlan(draft, plan);
    return result.ok ? { ok: true, value: result.value.node } : result;
  } catch (error) {
    return bindingBoundaryFailure(error);
  }
}

/** Source constructs a checking-only consumer/result wrapper at its actual
 * lexical position. A2/B3 transports the canonical consumer identity and the
 * original carrier; callers infer this tree and persist their separate edit.
 * GLOBAL_ONLY without context: closed supplied-draft plan, no host act. */
export function wrapAuthoringExpressionOccurrenceForCheck(
  root: ExprNode,
  path: readonly (string | number)[],
  consumerId: string,
  context?: EvaluateContext,
): AuthoringBindingEditResult<ExprNode> {
  try {
    const draft = { node: root, wrapper: undefined };
    const plan = dispatchEngineBody("engine:authoringExpressionCheckPlan", [
      marshalStoredBodyForValidation(draft), path, consumerId,
    ], context) as BindingPlan;
    const result = materializeBindingPlan(draft, plan);
    return result.ok ? { ok: true, value: result.value.node } : result;
  } catch (error) {
    return bindingBoundaryFailure(error);
  }
}
