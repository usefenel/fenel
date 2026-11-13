// A2/B3/Solid boundary: captured catalogue and ExprNode codec transport only.
// Fenel owns enumeration, admission aggregation, ranking and coverage policy.
import type { FenelType, InferenceOutcome, TypeScheme } from "@fenel/engine/types";
import { Just, Nothing, Ref, type RefValue, type Maybe } from "@fenel/engine/type-foundation";
import { EVALUATOR_STRATEGIES, constructorPattern, exprNodeToLogic, peelToVariantType, recordFieldsForType, type ExprNode,
  type AuthoringBinding, type AuthoringInferenceContext, type AuthoringInferenceResult,
  type AuthoringFunctionEntry } from "@fenel/engine/authoring/expression";
import {
  inferAuthoringExpressionWithLiteralWitnesses, prepareAuthoringLiteralWitnesses, judgeAuthoringSchemeCompatibility,
  projectAuthoringScheme, projectAuthoringChildExpectation, type AuthoringCatalogFunctionEntry, type AuthoringExpectedType } from "@fenel/engine/authoring/environment";
import { peelListForAuthoring } from "@fenel/engine/authoring/type";
import { dispatchEngineBody, dispatchedJsonLogicToSyntax } from "@fenel/engine/engine-bodies-dispatch";
import { resolveEffect } from "@fenel/engine";
import { evaluatorHookGenerationForMemo } from "@fenel/engine/expressions";
import { asAuthoringScheme, expectedTypeConsumer } from "../../../../../implementations/typescript/engine/src/authoring/call-scheme";
import { callSiteNominalGroundType, checkAuthoringSchemeStructure, snapshotAuthoringSchemeTransport } from "../../../../../implementations/typescript/engine/src/signature-inference";
import { exactImmutableDataEqual, exactImmutableDataSnapshot } from "../../../../../implementations/typescript/engine/src/self-host-immutable-data";
import { concreteAuthoringSession, type AuthoringSession } from "./expression-runner/account-authoring-session";
import { literalMembershipFor, sharedLiteralMembership } from "./expression-runner/literal-membership";
import { createSubjectMemo } from "./suggestion-subject-memo";
import { emptyExpressionSlot } from "./expression-runner/creation-seed";
import { valueCardLabel } from "./display-name";
import { lensPolicyData } from "./lens-shortcuts";
import { transferContainerShape, transferInferenceContext } from "./data-transfer/expressions";
import { detectStructuralForm } from "./expression-runner/expression-structure";
import { annotationTypeForEditor } from "./expression-runner/annotation-lens";
import { inspectAuthoringExpressionOccurrence, readAuthoringExpressionPath, replaceAuthoringExpressionOccurrence, wrapAuthoringExpressionOccurrenceForCheck } from "@fenel/engine/authoring/binding-edits";

export type DataSuggestionInput = {
  expression: ExprNode;
  type?: FenelType;
  scheme?: TypeScheme;
  /** Residual path inside the result of this authored producer. */
  sourcePath?: readonly (string | number)[];
  sourceType?: FenelType;
  sourceScheme?: TypeScheme;
  value?: unknown;
  savedExpressions?: readonly (readonly [string, ExprNode])[];
  lexicalBindings?: readonly AuthoringBinding[];
  destination?: { expected?: AuthoringExpectedType; outcome: InferenceOutcome };
  /** The selected data's own live handle (a card or saved-value reference),
   * when new data made from it should follow it (demo 1). Discovery and checks
   * use `expression`, the authored copy; only the prepared recipe of new data
   * reads this reference instead (review B4). */
  reference?: ExprNode;
  enclosing?: {
    expression: ExprNode;
    path: readonly (string | number)[];
    lexicalBindings?: readonly AuthoringBinding[];
    destination?: { expected?: AuthoringExpectedType; outcome: InferenceOutcome };
  };
  revision: string;
};
export type DataSuggestionOptions = { maxOperations?: number; maxSuggestions?: number; maxArity?: number;
  /** Run the same catalogue/planning policy afresh, for parity controls. */
  reuse?: boolean };
type Operation = { $tag: "SuggestionOperation"; key: string; label: string; paramNames: string[];
  payload: { functionId: string; family: string; kind: AuthoringCatalogFunctionEntry["kind"];
    callable: Maybe<RefValue>; scheme: Maybe<TypeScheme>;
    /** Lane D: the function's own internal marker, pin and operator notation (transport facts). */
    internal?: boolean; pinned?: boolean; operator?: boolean } };
type DirectPlan = { $tag: "SuggestionPlan"; operation: Operation; inputIndex: number;
  bindingNames: string[]; missingNames: string[] };
type ProjectionPlan = { $tag: "SuggestionProjection"; sourceBinding: string;
  field: { identity: string; label: string; path: string[]; payload: unknown } };
type ApplicationPlan = { $tag: "SuggestionApplicationPlan"; operation: Operation;
  callableBinding: string; bindingNames: string[]; missingNames: string[] };
type MappedProjectionPlan = { $tag: "SuggestionMappedProjection"; operation: Operation;
  rowBinding: string; field: Omit<ProjectionPlan["field"], "payload"> & {
    payload: { key: unknown; type: FenelType; sourceScheme: TypeScheme; elementType: FenelType } } };
// Typed grouping reuses the mapped-field payload: an ordinary application of
// the admitted std.groupByKey callable to a field-projection callback.
type GroupedProjectionPlan = Omit<MappedProjectionPlan, "$tag"> & { $tag: "SuggestionGroupedProjection" };
// Aggregations per key (M9) apply std.countByKey / std.sumByKey the same way.
type CountProjectionPlan = Omit<MappedProjectionPlan, "$tag"> & { $tag: "SuggestionCountProjection" };
type SumProjectionPlan = Omit<MappedProjectionPlan, "$tag"> & { $tag: "SuggestionSumProjection"; amount: MappedProjectionPlan["field"] };
type SuggestionPlan = DirectPlan | ProjectionPlan | ApplicationPlan | MappedProjectionPlan | GroupedProjectionPlan
  | CountProjectionPlan | SumProjectionPlan;
export type DataSuggestion = {
  $tag: "SuggestionCandidate";
  identity: string;
  family: string;
  label: string;
  icon: string;
  expression: ExprNode;
  resultType: string;
  resultScheme?: TypeScheme;
  /** The open inputs' schemes in slot order, as the whole-expression check
   * inferred them (a direct `+` on a Number: Number). Presentation only. */
  argumentSchemes?: (TypeScheme | undefined)[];
  inputIndex: number;
  missingArguments: number;
  applicability: Maybe<boolean>;
  relevance: number;
  compositionCost: number;
  pin: Maybe<number>;
  lenses: string[];
  reasons: string[];
  plan: SuggestionPlan;
  revision: string;
  /** Whether the checked result fits the selected data's own type: the reader's
   * judgment, Nothing when undecided or not applicable (inputs still open). */
  replaceable?: Maybe<boolean>;
  /** The default click (Fenel `suggestionDisposition`): replace the selected
   * data in place, or make new data from it. */
  disposition?: SuggestionDisposition;
  /** What the action computes, in words (Fenel `suggestionSentence`), for
   * field-derived actions; shown under the row (polish lane B item 6). */
  sentence?: string;
};
export type SuggestionDisposition = "ApplyToDraft" | "CreateDerivedData";
export type DataSuggestionBatch = {
  $tag: "RankedSuggestions";
  suggestions: DataSuggestion[];
  undecided: DataSuggestion[];
  omittedConfirmed: number;
  omittedUndecided: number;
  duplicateCount: number;
  rejectedCount: number;
  diversityDeferred: number;
  totalSubmitted: number;
  revision: string;
  coverage: { operationsSeen: number; operationsAvailable: number; operationsChecked: number; skipped: number; truncated: boolean; reason?: string };
};
export type DataSuggestionPreparation = { ok: true; node: ExprNode } | { ok: false; issue: string };
type DiscoveryLifetime = { signal?: AbortSignal; yieldControl?: () => Promise<void> };
type SourceSlot = { kind: "list-element" | "record-field"; name: string; index: number };
type SourceStep = { slot: SourceSlot; declared: Maybe<string[]> };
type SourceSelection = { scheme?: TypeScheme; producerScheme?: TypeScheme;
  names: string[]; patterns: unknown[]; steps: SourceStep[];
  routes?: { head: string; drop: string; present: string; snapshot: string; just: string;
    find: string; bind: string; fmap: string } };
// The policy's String fields are display projections. Checked codec/scheme
// data travels unchanged in its generic payload, including after deduplication.
type PolicyCandidate = Omit<DataSuggestion, "expression" | "plan" | "icon" | "resultScheme" | "argumentSchemes" | "revision"
  | "replaceable" | "disposition" | "sentence"> & {
  expression: string;
  plan: { semanticPlan: SuggestionPlan; expression: ExprNode; icon: string; resultScheme?: TypeScheme;
    argumentSchemes?: (TypeScheme | undefined)[]; revision: string; replaceable?: Maybe<boolean>; disposition?: SuggestionDisposition;
    sentence?: string };
};
type PolicyBatch = Omit<DataSuggestionBatch, "suggestions" | "undecided" | "coverage" | "revision"> & {
  suggestions: PolicyCandidate[]; undecided: PolicyCandidate[];
};

export function policyCandidate(candidate: DataSuggestion): PolicyCandidate {
  const { expression, plan, icon, resultScheme, argumentSchemes, revision, replaceable, disposition, sentence, ...projection } = candidate;
  return { ...projection, expression: "", plan: { semanticPlan: plan, expression, icon, resultScheme,
    ...(argumentSchemes ? { argumentSchemes } : {}), revision,
    ...(replaceable ? { replaceable } : {}), ...(disposition ? { disposition } : {}), ...(sentence ? { sentence } : {}) } };
}

function readerCandidate(candidate: PolicyCandidate): DataSuggestion {
  const { plan, ...projection } = candidate;
  return { ...projection, expression: plan.expression, plan: plan.semanticPlan, icon: plan.icon,
    ...(plan.resultScheme ? { resultScheme: plan.resultScheme } : {}),
    ...(plan.argumentSchemes ? { argumentSchemes: plan.argumentSchemes } : {}), revision: plan.revision,
    ...(plan.replaceable ? { replaceable: plan.replaceable } : {}), ...(plan.disposition ? { disposition: plan.disposition } : {}),
    ...(plan.sentence ? { sentence: plan.sentence } : {}) };
}

/** Transport-only fact for the default click: whether the checked result type
 * fits the selected data's own type (Reverse on a String: yes; Group by on a
 * list: no). A child read through its parent's path, open inputs or generic
 * schemes stay undecided. The Fenel `suggestionDisposition` decides from it. */
function replaceableFact(session: AuthoringSession, input: DataSuggestionInput, scheme: TypeScheme | undefined,
  checked: ReturnType<typeof checkPlan>): Maybe<boolean> {
  const result = checked.resultScheme;
  if (input.sourcePath?.length || checked.missing > 0 || !scheme || !result
    || scheme.quantified.length > 0 || result.quantified.length > 0) return Nothing;
  try {
    const verdict = judgeAuthoringSchemeCompatibility(result, scheme, { registry: session.registry });
    return verdict === "compatible" ? Just(true) : verdict === "incompatible" ? Just(false) : Nothing;
  } catch { return Nothing; }
}

/** The ranked rows' default click, decided by the Fenel policy. A reader whose
 * policy is unavailable keeps the safe default: new data from this one. */
function withDisposition(session: AuthoringSession, candidate: DataSuggestion): DataSuggestion {
  let disposition: SuggestionDisposition = "CreateDerivedData";
  try {
    const decided = lensPolicyData<{ $tag?: string }>(session, "suggestionDisposition", candidate.replaceable ?? Nothing);
    if (decided?.$tag === "ApplyToDraft") disposition = "ApplyToDraft";
  } catch { disposition = "CreateDerivedData"; }
  return { ...candidate, disposition };
}

/** `fit` transports the existing selected-slot judgment for the bounded
 * prefix (Fenel `suggestionCatalogueSnapshot` orders by it): 0 a concretely
 * typed input admits the data, 1 only a bare type variable does, 2 unresolved,
 * 3 every input definitely refuses it (the same verdict that rejects a plan).
 * Each judgment costs a canonical containment check (about 30 ms on a loaded
 * host, 9456 slots for the whole catalogue, and a list's discovery then
 * outlived the worker's 180 s job allowance): only std and reader-local inputs
 * whose signature head equals the data's are judged, and identical slot
 * schemes share one verdict. Every other input stays unresolved (2). */
type CatalogueOperations = { callable: boolean; moduleName: string; fit: number; internal: boolean; pinned: boolean; operation: Operation }[];
type PlannedCatalogue = {
  snapshot: { operations: Operation[]; totalSubmitted: number; eligibleCount: number; excludedCount: number; omittedCount: number;
    rejectedCount: number };
  planned: { plans: DirectPlan[]; skippedOperations: string[] };
};
type PlanningMemo = {
  registry: AuthoringSession["registry"];
  environment: AuthoringSession["environment"];
  catalog: AuthoringSession["catalog"];
  routing: number;
  hooks: number;
  scope: unknown;
  operations: CatalogueOperations;
  catalogues: Map<string, PlannedCatalogue>;
  hygienic: WeakMap<object, Map<string, SuggestionPlan>>;
};
// Approved host cache only: these are catalogue and binder-allocation results,
// never membership/inference verdicts. Named-set membership has dependencies
// outside the dispatch revision, so it must continue through the live checker.
const planningMemos = new WeakMap<AuthoringSession["evaluateContext"], PlanningMemo>();
const PLANNING_MEMO_LIMIT = 8;
const HYGIENE_MEMO_LIMIT = 32;
const HYGIENE_KEY_LIMIT = 16_384;

function boundedPlanningMemo<K, V>(map: Map<K, V>, key: K, value: V, limit: number): V {
  if (map.size >= limit) map.delete(map.keys().next().value!);
  map.set(key, value);
  return value;
}

function planningMemo(session: AuthoringSession, operations: CatalogueOperations, reuse: boolean): PlanningMemo | undefined {
  if (!reuse || !Object.isFrozen(session.evaluateContext) || !Object.isFrozen(session.environment)) return undefined;
  // An unavailable routing revision is not an immutable pool certificate.
  let routing: unknown;
  try { routing = session.evaluateContext._routingTableVersion?.(); } catch { return undefined; }
  if (typeof routing !== "number" || !Number.isSafeInteger(routing) || routing < 0) return undefined;
  const hooks = evaluatorHookGenerationForMemo();
  const scope = [session.evaluateContext._activeTags, session.evaluateContext._dictStack, session.evaluateContext._importStack];
  // Compare two captured graphs, and compute from this same captured input.
  const captured = exactImmutableDataSnapshot(operations);
  const capturedScope = exactImmutableDataSnapshot(scope);
  if (captured.status !== "ok" || capturedScope.status !== "ok") return undefined;
  const previous = planningMemos.get(session.evaluateContext);
  try {
    if (previous?.registry === session.registry && previous.environment === session.environment
      && previous.catalog === session.catalog && previous.routing === routing && previous.hooks === hooks
      && exactImmutableDataEqual(previous.scope, capturedScope.value)
      && exactImmutableDataEqual(previous.operations, captured.value)) return previous;
  } catch { return undefined; }
  // Rebuild the host observations on every request. This detects an in-place
  // row change as well as a fresh catalogue/environment or dispatch revision.
  const memo: PlanningMemo = { registry: session.registry, environment: session.environment, catalog: session.catalog,
    routing, hooks, scope: capturedScope.value, operations: captured.value, catalogues: new Map(), hygienic: new WeakMap() };
  planningMemos.set(session.evaluateContext, memo);
  return memo;
}

function plannedCatalogue(session: AuthoringSession, operations: CatalogueOperations, memo: PlanningMemo | undefined,
  maxOperations: number, maxArity: number): PlannedCatalogue {
  const key = Number.isFinite(maxOperations) && Number.isFinite(maxArity) ? JSON.stringify([maxOperations, maxArity]) : undefined;
  const cached = key === undefined ? undefined : memo?.catalogues.get(key);
  if (cached) return cached;
  const snapshot = lensPolicyData<PlannedCatalogue["snapshot"]>(session, "suggestionCatalogueSnapshot", maxOperations, memo?.operations ?? operations);
  const planned = lensPolicyData<PlannedCatalogue["planned"]>(session, "suggestionPlanBatch", maxArity, snapshot.operations);
  const result = { snapshot, planned };
  if (!memo || key === undefined) return result;
  const captured = exactImmutableDataSnapshot(result);
  return captured.status === "ok"
    ? boundedPlanningMemo(memo.catalogues, key, captured.value, PLANNING_MEMO_LIMIT) : result;
}

function reusedHygienicPlan(session: AuthoringSession, memo: PlanningMemo | undefined, reserved: string[],
  plan: SuggestionPlan): SuggestionPlan {
  if (!memo) return hygienicPlan(session, reserved, plan);
  // A worker yield may have admitted a newer pool or scope before this plan.
  try {
    const scope = exactImmutableDataSnapshot([session.evaluateContext._activeTags,
      session.evaluateContext._dictStack, session.evaluateContext._importStack]);
    if (session.evaluateContext._routingTableVersion?.() !== memo.routing || evaluatorHookGenerationForMemo() !== memo.hooks
      || scope.status !== "ok" || !exactImmutableDataEqual(memo.scope, scope.value)) return hygienicPlan(session, reserved, plan);
  } catch { return hygienicPlan(session, reserved, plan); }
  // The key contains only strings from the existing Fenel name planner.
  const key = JSON.stringify(reserved);
  if (key.length > HYGIENE_KEY_LIMIT) return hygienicPlan(session, reserved, plan);
  let byReserved = memo.hygienic.get(plan);
  if (!byReserved) memo.hygienic.set(plan, byReserved = new Map());
  const cached = byReserved.get(key);
  if (cached) return cached;
  const planned = hygienicPlan(session, reserved, plan);
  const captured = exactImmutableDataSnapshot(planned);
  return captured.status === "ok"
    ? boundedPlanningMemo(byReserved, key, captured.value, HYGIENE_MEMO_LIMIT) : planned;
}

const param = (name: string): ExprNode => ({ kind: "param", name });
const lambda = (names: string[], body: ExprNode): ExprNode => names.length
  ? { kind: "literal", value: { __lambda: { params: names, arrayParams: true, body } } } : body;

function inferenceContext(session: AuthoringSession, input: DataSuggestionInput) {
  const saved = new Map(input.savedExpressions ?? []);
  return transferInferenceContext({ ...session.environment, resolveSavedExpr: (id: string) => saved.get(id)
    ?? session.environment.resolveSavedExpr?.(id),
    bindings: Object.fromEntries((input.lexicalBindings ?? []).map(binding => [binding.name, binding.scheme ?? binding.type])),
  } as typeof session.environment & AuthoringInferenceContext) as typeof session.environment & AuthoringInferenceContext;
}

// Every candidate plan of one discovery judges the same transported subject
// data against the same expected schemes; for a pasted image that membership
// is the costly part, so one input shares each verdict across its plans.
const inputMemberships = new WeakMap<DataSuggestionInput, { session: AuthoringSession; membership: ReturnType<typeof literalMembershipFor> }>();
function sessionMembership(session: AuthoringSession) {
  return sharedLiteralMembership(literalMembershipFor(session.environment, {
    registry: session.registry, evaluateContext: session.evaluateContext,
  }));
}
// ...and, across requests, one verdict per subject (suggestion-subject-memo.ts):
// the list, each previewed row and the click no longer recheck the picture.
const subjects = createSubjectMemo<ReturnType<typeof literalMembershipFor>>();
const subjectOwners = (session: AuthoringSession) => [session.environment, session.registry] as const;
function inputMembership(session: AuthoringSession, input: DataSuggestionInput) {
  const held = inputMemberships.get(input);
  if (held?.session === session) return held.membership;
  const own = sessionMembership(session);
  const membership: ReturnType<typeof literalMembershipFor> = (value, expected) =>
    (subjects.membershipFor(session.evaluateContext, subjectOwners(session), value) ?? own)(value, expected);
  if (own.resolveAnnotationScheme) membership.resolveAnnotationScheme = own.resolveAnnotationScheme;
  inputMemberships.set(input, { session, membership });
  return membership;
}
/** This request's input over the frame's held copy of the same subject bytes.
 * An occurrence inside an enclosing expression keeps its own object: its path
 * check compares that identity. */
function stableSubjectInput(session: AuthoringSession, input: DataSuggestionInput): DataSuggestionInput {
  if (input.enclosing !== undefined) return input;
  const expression = subjects.subject(session.evaluateContext, subjectOwners(session), input.expression, () => sessionMembership(session));
  return expression === input.expression ? input : { ...input, expression };
}

function checkExpression(session: AuthoringSession, input: DataSuggestionInput, node: ExprNode,
  bindings?: AuthoringInferenceContext["bindings"], expectedScheme?: TypeScheme,
  consumers: readonly AuthoringFunctionEntry[] = []): AuthoringInferenceResult {
  const context = inferenceContext(session, input);
  return inferAuthoringExpressionWithLiteralWitnesses(node, { ...context,
    ...(bindings ? { bindings: { ...context.bindings, ...bindings } } : {}),
    ...(consumers.length ? { getFunctionEntry: (id: string, arity?: number) => consumers.find(consumer => consumer.id === id)
      ?? context.getFunctionEntry?.(id, arity) } : {}),
  }, {
    ...(expectedScheme ? { expectedScheme } : {}),
    literalMembership: inputMembership(session, input),
  });
}

/** A transported Type handle is an identity, not a written source spelling.
 * Project it through the registry's existing declaration, then require the
 * canonical resolver to return that exact nominal owner. Missing, shadowed,
 * ambiguous and quantified declarations keep the original refusal. */
function resolveReaderType(session: AuthoringSession, type: FenelType) {
  const resolved = session.registry.callSiteTyping.resolveType(type, session.evaluateContext._sourceFunction);
  // The registry admits an exact type handle in every frame (its own owner
  // key) and keeps the UUID spelling, so `ref:<uuid>` shares no catalogue
  // parameter's index head. Rename it to the scoped name when that name
  // resolves to the same owner here; otherwise keep the admitted handle
  // (for example a Local type the caller cannot name).
  if (resolved.ok) {
    const handle = exactHandleSpelling(type);
    return handle === undefined ? resolved : scopedReaderHandle(session, type, handle) ?? resolved;
  }
  if (resolved.reason !== "missing" || typeof resolved.spelling !== "string") return resolved;
  return scopedReaderHandle(session, type, resolved.spelling) ?? resolved;
}

/** The `$ref` string of a plain data carrier; never reads an accessor. */
function exactHandleSpelling(type: FenelType): string | undefined {
  try {
    if (type === null || typeof type !== "object") return undefined;
    const reference = Object.getOwnPropertyDescriptor(type, "$ref");
    return reference && "value" in reference && typeof reference.value === "string" ? reference.value : undefined;
  } catch { return undefined; }
}

function scopedReaderHandle(session: AuthoringSession, type: FenelType, handle: string) {
  // The canonical boundary has already checked the complete carrier. Never
  // turn a malformed/getter-bearing type refusal into a new getter read.
  try {
    if (type === null || typeof type !== "object") return undefined;
    const reference = Object.getOwnPropertyDescriptor(type, "$ref");
    if (!reference || !("value" in reference) || reference.value !== handle) return undefined;
  } catch { return undefined; }
  const declaration = session.registry.getIdentifiedEntity(handle);
  const identity = session.registry.getEntityNominalIdentity(handle);
  if (!declaration || !identity || typeof declaration.module !== "string" || typeof declaration.id !== "string") return undefined;
  // Only exact registered handles use this transport repair; an unresolved
  // written name must keep its original lexical/import refusal.
  if (session.registry.getTypeUuid(declaration.module, declaration.id) !== handle) return undefined;
  let qualified = session.registry.callSiteTyping.resolveType({ $ref: `${declaration.module}.${declaration.id}` },
    session.evaluateContext._sourceFunction);
  // Some storage owners (for example system scalars) are not source bundles.
  // Their normal spelling may still be admitted by the caller's own prelude.
  // This remains a canonical caller lookup, never a declaration-scope grant.
  if (!qualified.ok && qualified.reason === "missing") {
    qualified = session.registry.callSiteTyping.resolveType({ $ref: declaration.id }, session.evaluateContext._sourceFunction);
  }
  if (!qualified.ok || qualified.type.quantified.length > 0) return undefined;
  const owners = qualified.type.nominals?.filter(owner => owner.path.length === 0) ?? [];
  if (owners.length !== 1 || owners[0]!.identity !== identity) return undefined;
  // Resolution has established the exact owner in the caller's scope. Use
  // the same ground nominal carrier as canonical runtime reflection, so its
  // public name is the declaration's own name rather than a routing spelling
  // such as system.Number. The explicit owner survives a conflicting bare
  // spelling; nothing is re-resolved in another frame or admitted by a label.
  return { ...qualified, type: callSiteNominalGroundType(identity, declaration.id) };
}

/** A function picker's requirement takes the same transport repair as the
 * Suggestions subject. A slot typed by a picked type keeps that type's exact
 * identity handle ({$ref: <String UUID>}); the unifier compares nominal
 * spellings, so every `String` result was refused and the type-filtered list
 * stayed empty. Only a ground, bare exact handle is renamed, and only to the
 * same owner under the name the caller's scope resolves; anything else
 * (another owner already recorded, a quantified scheme, a written name, a
 * Local type the caller cannot name) is returned unchanged. */
export function scopedExpectedType(session: AuthoringSession, expected: AuthoringExpectedType | undefined): AuthoringExpectedType | undefined {
  if (expected === undefined) return undefined;
  try {
    const scheme = asAuthoringScheme(expected);
    // A repair must not erase unreadable metadata before its caller checks it.
    snapshotAuthoringSchemeTransport(scheme);
    if (scheme.quantified.length > 0 || (scheme.applications?.length ?? 0) > 0) return expected;
    const body = scheme.body;
    if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1) return expected;
    const handle = exactHandleSpelling(body);
    if (handle === undefined) return expected;
    const renamed = scopedReaderHandle(session, body, handle);
    if (!renamed) return expected;
    const owner = renamed.type.nominals?.[0]?.identity;
    const recorded = (scheme.nominals ?? []).filter(row => row.path.length === 0);
    if (recorded.some(row => row.identity !== owner) || (scheme.nominals ?? []).some(row => row.path.length > 0)) return expected;
    return renamed.type;
  } catch { return expected; }
}

/** Lane D (4b, 2026-11-08): an editor's result requirement spelled by a picked
 * scalar's exact identity handle (a Local String card's `{$ref: <String UUID>}`)
 * is judged under the name this reader's scope gives that same owner, as
 * rank-suggestions judges a picker's requirement (`scopedExpectedType`).
 * Anything else is returned unchanged. */
export function scopedResultRequirement<T extends { expected: FenelType; scheme?: TypeScheme }>(session: AuthoringSession, judge: T): T {
  const spelled = judge.scheme ?? judge.expected;
  const repaired = scopedExpectedType(session, spelled);
  if (repaired === undefined || repaired === spelled) return judge;
  try {
    const scheme = asAuthoringScheme(repaired);
    return { ...judge, expected: scheme.body, scheme };
  } catch { return judge; }
}

function subjectScheme(session: AuthoringSession, input: DataSuggestionInput): TypeScheme | undefined {
  // The transported declared scheme never supplies its own admission evidence.
  if (input.type === undefined && input.scheme === undefined) {
    const inferred = checkExpression(session, input, input.expression);
    return inferred.outcome.$tag === "Solved" ? inferred.scheme : undefined;
  }
  // A complete captured scheme keeps declaration-owned binders, arrow slots
  // and nominal/application evidence. Re-resolving its raw body loses those
  // owners; validate its carrier, then obtain independent expression evidence.
  if (input.scheme && !checkAuthoringSchemeStructure(input.scheme).ok) return undefined;
  const annotation = sourceAnnotationType(input);
  const resolved = annotation !== undefined
    ? resolveReaderType(session, annotation)
    : input.scheme === undefined && input.type !== undefined
      ? resolveReaderType(session, input.type) : undefined;
  // An empty list can retain an observational generic scheme despite its real
  // ground annotation. The authored source declaration owns that type; its
  // independent whole-source equation below still has to succeed.
  if (annotation !== undefined && !resolved?.ok) return undefined;
  const declared = annotation !== undefined && resolved?.ok ? resolved.type
    : input.scheme ?? (resolved?.ok ? resolved.type : undefined);
  const inferred = checkExpression(session, input, input.expression, undefined, declared);
  if (inferred.outcome.$tag !== "Solved" || !inferred.scheme) return undefined;
  if (!declared || judgeAuthoringSchemeCompatibility(inferred.scheme, declared, { registry: session.registry }) !== "compatible") {
    return undefined;
  }
  // A raw-body compatibility shortcut may omit one-sided nominal evidence.
  // The source itself must also satisfy the complete declaration equation.
  // Universal declarations need their rigid owner context, not instantiation.
  if (declared.quantified.length > 0) return undefined;
  const consumer = expectedTypeConsumer(declared);
  const admitted = checkExpression(session, input,
    { kind: "call", fnId: consumer.id, args: [input.expression] }, undefined, undefined, [consumer]);
  if (admitted.outcome.$tag !== "Solved") return undefined;
  // Empty/sampled data never erases the admitted declared element/union type.
  return declared;
}

/** B3: project the original carrier through the canonical child owner. Fenel
 * normalizes the path and allocates names; no observed value supplies a type. */
function sourceSelection(session: AuthoringSession, input: DataSuggestionInput,
  reserved: string[]): SourceSelection | undefined {
  if (input.sourcePath === undefined) return undefined;
  const slots = lensPolicyData<Maybe<SourceSlot[]>>(session, "suggestionSourceSlots", input.sourcePath);
  if (slots.$tag === "Just" && slots._0.length === 0) return undefined;
  const producerScheme = subjectScheme(session, { ...input, type: input.sourceType,
    scheme: input.sourceScheme, sourcePath: undefined, enclosing: undefined, destination: undefined });
  const names = slots.$tag === "Just"
    ? lensPolicyData<string[]>(session, "suggestionSourceNames", reserved, slots._0) : [];
  const selected: SourceSelection = { producerScheme, names,
    patterns: [], steps: [] };
  if (slots.$tag !== "Just" || !producerScheme) return selected;
  let scheme: TypeScheme = producerScheme;
  for (const slot of slots._0) {
    const child = projectAuthoringChildExpectation(scheme, slot.kind === "list-element"
      ? { kind: "list-element" } : { kind: "record-field", name: slot.name }, session.environment);
    if (child.state !== "known") return selected;
    // This projector admits structural records. Constructor positional aliases
    // require their actual captured constructor declaration, never these fields.
    selected.steps.push({ slot, declared: Nothing });
    scheme = child.scheme;
  }
  const head = session.environment.resolveFunctionId("std.head");
  const drop = session.environment.resolveFunctionId("std.drop");
  const present = session.environment.resolveFunctionId("view.suggestionSourceFieldPresent");
  const snapshot = session.environment.resolveFunctionId("std.representationValueSnapshot");
  const find = session.environment.resolveFunctionId("std.find");
  const bind = session.environment.resolveFunctionId("algebra.maybeBind");
  const fmap = session.environment.resolveFunctionId("algebra.maybeFmap");
  const just = session.environment.resolveConstructorTarget?.("Just");
  const array = session.environment.resolveConstructorTarget?.("SnapshotArray");
  if (!head || !drop || !present || !snapshot || !just || !find || !bind || !fmap || !array) return selected;
  selected.patterns = names.slice(1).map(() => ({ array: constructorPattern(array, { _0: "_" }) }));
  selected.routes = { head, drop, present, snapshot, just, find, bind, fmap };
  selected.scheme = scheme;
  return selected;
}

function sourceBody(session: AuthoringSession, source: SourceSelection | undefined,
  plan: SuggestionPlan, selected: ExprNode, checking: boolean): ExprNode {
  if (!source) return candidateBody(plan, selected, checking);
  if (!source.scheme || !source.routes) return emptyExpressionSlot();
  return lensPolicyData<ExprNode>(session, "suggestionSourceExpression", source.routes, source.steps,
    source.names, source.patterns, selected,
    candidateBody(plan, param(source.names.at(-1)!), checking));
}

function sourceCandidateNode(session: AuthoringSession, input: DataSuggestionInput,
  source: SourceSelection | undefined, plan: SuggestionPlan, checking: boolean): ExprNode {
  if (!source) return candidateNode(plan, input.expression, checking);
  const body = sourceBody(session, source, plan, input.expression, checking);
  return checking ? lambda(missingNames(plan), body) : body;
}

function directNode(plan: DirectPlan, selected: ExprNode, checking: boolean): ExprNode {
  const call: ExprNode = { kind: "call", fnId: plan.operation.payload.functionId,
    ...(plan.operation.payload.kind === "constructor" ? { callSyntax: "construct" as const } : {}),
    args: plan.bindingNames.map((name, index) => index === plan.inputIndex
      ? selected : checking ? param(name) : emptyExpressionSlot()) };
  // Undefined is the existing editor's incomplete slot, never a null literal.
  return call;
}

function projectionNode(plan: ProjectionPlan, selected: ExprNode): ExprNode {
  // Bind the actual source once; the canonical codec owns identity-bearing dot access.
  return { kind: "literal", value: { __do: [
    { kind: "literal", value: { __let: { bindings: [{ name: plan.sourceBinding, expr: selected }] } } },
    { kind: "param", name: [plan.sourceBinding, ...plan.field.path].join(".") },
  ] } };
}

function applicationNode(plan: ApplicationPlan, selected: ExprNode, checking: boolean): ExprNode {
  const apply: ExprNode = { kind: "literal", value: { __apply: {
    target: param(plan.callableBinding), syntax: "call",
    args: plan.bindingNames.map(name => checking ? param(name) : emptyExpressionSlot()),
  } } };
  const body: ExprNode = { kind: "literal", value: { __do: [
    { kind: "literal", value: { __let: { bindings: [{ name: plan.callableBinding, expr: selected }] } } }, apply,
  ] } };
  return body;
}

function mappedProjectionNode(plan: MappedProjectionPlan | GroupedProjectionPlan | CountProjectionPlan | SumProjectionPlan,
  selected: ExprNode): ExprNode {
  const callable: ExprNode = { kind: "literal", value: plan.operation.payload.callable.$tag === "Just"
    ? plan.operation.payload.callable._0 : undefined };
  // Reuse the ordinary application codec: its target is a bound value. The
  // callback's same-named parameter shadows that binding only inside its body.
  const projector = (field: MappedProjectionPlan["field"]) =>
    lambda([plan.rowBinding], param([plan.rowBinding, ...field.path].join(".")));
  const args = plan.$tag === "SuggestionSumProjection"
    ? [projector(plan.field), projector(plan.amount), selected] : [projector(plan.field), selected];
  // A catalogue function with an id is an ordinary direct call, as directNode:
  // `groupByKey (\row -> row.date) <data>` reads as itself and is inferred like
  // any authored call (polish lane B 7b). Only a callable without an id keeps
  // the bound-value application below.
  if (plan.operation.payload.functionId) return { kind: "call", fnId: plan.operation.payload.functionId, args };
  const apply: ExprNode = { kind: "literal", value: { __apply: {
    target: param(plan.rowBinding), syntax: "call", args,
  } } };
  return { kind: "literal", value: { __do: [
    { kind: "literal", value: { __let: { bindings: [{ name: plan.rowBinding, expr: callable }] } } }, apply,
  ] } };
}

function candidateBody(plan: SuggestionPlan, selected: ExprNode, checking: boolean): ExprNode {
  switch (plan.$tag) {
    case "SuggestionPlan": return directNode(plan, selected, checking);
    case "SuggestionProjection": return projectionNode(plan, selected);
    case "SuggestionApplicationPlan": return applicationNode(plan, selected, checking);
    case "SuggestionMappedProjection": return mappedProjectionNode(plan, selected);
    case "SuggestionGroupedProjection": return mappedProjectionNode(plan, selected);
    case "SuggestionCountProjection": return mappedProjectionNode(plan, selected);
    case "SuggestionSumProjection": return mappedProjectionNode(plan, selected);
  }
}

function missingNames(plan: SuggestionPlan): string[] {
  return plan.$tag === "SuggestionPlan" || plan.$tag === "SuggestionApplicationPlan" ? plan.missingNames : [];
}

function candidateNode(plan: SuggestionPlan, selected: ExprNode, checking: boolean): ExprNode {
  const body = candidateBody(plan, selected, checking);
  return checking ? lambda(missingNames(plan), body) : body;
}

/** Plain literal data: scalars, lists of plain data, and records of two or
 * more ordinary fields. Its surface lowering refers to no name except the
 * list-literal primitive. Null, one-key objects (a call in the JSON Logic
 * wire), `$`/`_` keys and editor envelopes are not plain data. */
function plainLiteralData(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(plainLiteralData);
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value);
  return keys.length > 1 && keys.every(key => !key.startsWith("$") && !key.startsWith("_"))
    && keys.every(key => plainLiteralData((value as Record<string, unknown>)[key]));
}

function plainDataNameSkeleton(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [plainDataNameSkeleton(value[0])] : [];
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainDataNameSkeleton(child)]));
}

/** The Fenel surface walk owns reserved names. Its list lowering nests one
 * call per element, so a pasted image's pixel list exceeds the evaluator's
 * stack. Every element of plain data contributes the same (empty) references,
 * so one representative element per list lowers to exactly the same names at
 * a depth bounded by the data's nesting, not by its length. Other nodes and
 * envelopes are unchanged; saved references project their targets the same way. */
function nameSkeleton(node: ExprNode): ExprNode {
  if (node.kind === "literal") return plainLiteralData(node.value) ? { ...node, value: plainDataNameSkeleton(node.value) } : node;
  if (node.kind === "call") return { ...node, args: node.args.map(nameSkeleton) };
  return node;
}

function planningNames(session: AuthoringSession, input: DataSuggestionInput): string[] | undefined {
  const context = inferenceContext(session, input);
  const syntax = dispatchedJsonLogicToSyntax(exprNodeToLogic(nameSkeleton(input.enclosing?.expression ?? input.expression), {
    resolver: id => { const target = context.resolveSavedExpr?.(id); return target && nameSkeleton(target); },
    constructorName: context.resolveConstructorTarget,
    operatorCodeName: (_notation, call) => context.resolveOperatorAlias?.(call.aliasId, call.notation, call.arity) ?? call.aliasId,
  })) as { $tag: string; _0?: unknown };
  if (syntax.$tag !== "Ok") return undefined;
  const names = dispatchEngineBody("engine:inferenceSurfaceReferences", [syntax._0], session.evaluateContext) as string[];
  if (!Array.isArray(names) || names.some(name => typeof name !== "string")) return undefined;
  return lensPolicyData<string[]>(session, "suggestionReservedNames", names,
    [...input.lexicalBindings ?? [], ...input.enclosing?.lexicalBindings ?? []].map(binding => binding.name));
}

function destinationScheme(session: AuthoringSession, input: DataSuggestionInput): TypeScheme | undefined {
  const destination = input.destination;
  if (destination?.outcome.$tag !== "Solved" || destination.expected === undefined) return undefined;
  const expected = destination.expected;
  if ("quantified" in expected && "body" in expected) return asAuthoringScheme(expected);
  const resolved = session.registry.callSiteTyping.resolveType(expected, session.evaluateContext._sourceFunction);
  return resolved.ok ? resolved.type : undefined;
}

/** A2/B3: reconstruct this occurrence, then invoke the existing checker on its
 * captured enclosing expression. Checking-only consumers retain their original
 * lexical positions; one ordinary lambda shares every still-open argument.
 * These wrappers never become the persisted or evaluated candidate. */
function checkEnclosingPlan(session: AuthoringSession, input: DataSuggestionInput,
  body: ExprNode, missing: string[]): { checked?: AuthoringInferenceResult; available: boolean; rigid: boolean } {
  const enclosing = input.enclosing;
  if (!enclosing) return { available: false, rigid: false };
  try {
    if (readAuthoringExpressionPath(enclosing.expression, enclosing.path) !== input.expression) {
      return { available: false, rigid: false };
    }
  } catch { return { available: false, rigid: false }; }
  const replaced = replaceAuthoringExpressionOccurrence(enclosing.expression, enclosing.path, body, session.evaluateContext);
  if (!replaced.ok) return { available: false, rigid: false };
  let root = replaced.value;
  const inspected = inspectAuthoringExpressionOccurrence(root, root, session.evaluateContext);
  if (!inspected.ok) return { available: false, rigid: false };
  const captured: DataSuggestionInput = { ...input, expression: root,
    lexicalBindings: enclosing.lexicalBindings, destination: enclosing.destination, enclosing: undefined };
  const consumers: AuthoringFunctionEntry[] = [];
  for (const annotation of inspected.value.annotations) {
    const type = annotationTypeForEditor(annotation.type);
    if (!type) return { available: false, rigid: false };
    const resolved = session.registry.callSiteTyping.resolveType(type, session.evaluateContext._sourceFunction);
    if (!resolved.ok) return { available: false, rigid: false };
    if (resolved.type.quantified.length > 0) return { available: false, rigid: true };
    const consumer = { ...expectedTypeConsumer(resolved.type), id: `<authoring-annotation-${consumers.length}>` };
    consumers.push(consumer);
    const wrapped = wrapAuthoringExpressionOccurrenceForCheck(root, annotation.expressionPath,
      consumer.id, session.evaluateContext);
    if (!wrapped.ok) return { available: false, rigid: false };
    root = wrapped.value;
  }
  const target = destinationScheme(session, captured);
  const rigid = (target?.quantified.length ?? 0) > 0
    || (enclosing.lexicalBindings ?? []).some(binding => (binding.scheme?.quantified.length ?? 0) > 0);
  if (rigid) return { available: false, rigid: true };
  if (enclosing.destination && !target) return { available: false, rigid: false };
  if (target) {
    const consumer = { ...expectedTypeConsumer(target), id: `<authoring-annotation-${consumers.length}>` };
    consumers.push(consumer);
    root = { kind: "call", fnId: consumer.id, args: [root] };
  }
  return { checked: checkExpression(session, captured, lambda(missing, root), undefined, undefined, consumers), available: true, rigid: false };
}

function hygienicPlan(session: AuthoringSession, reserved: string[], plan: SuggestionPlan): SuggestionPlan {
  switch (plan.$tag) {
    case "SuggestionPlan": return lensPolicyData<DirectPlan>(session, "suggestionHygienicPlan", reserved, plan);
    case "SuggestionProjection": return lensPolicyData<ProjectionPlan>(session, "suggestionHygienicProjection", reserved, plan);
    case "SuggestionApplicationPlan": return lensPolicyData<ApplicationPlan>(session, "suggestionHygienicApplication", reserved, plan);
    case "SuggestionMappedProjection": return lensPolicyData<MappedProjectionPlan>(session, "suggestionHygienicMappedProjection", reserved, plan);
    case "SuggestionGroupedProjection": return lensPolicyData<GroupedProjectionPlan>(session, "suggestionHygienicGroupedProjection", reserved, plan);
    case "SuggestionCountProjection": return lensPolicyData<CountProjectionPlan>(session, "suggestionHygienicCountProjection", reserved, plan);
    case "SuggestionSumProjection": return lensPolicyData<SumProjectionPlan>(session, "suggestionHygienicSumProjection", reserved, plan);
  }
}

function reflectionType(session: AuthoringSession, input: DataSuggestionInput, scheme: TypeScheme | undefined): FenelType | undefined {
  if (!scheme) return undefined;
  if (input.sourcePath?.length) return scheme.body;
  const declared = sourceAnnotationType(input) ?? input.type;
  if (!declared) return scheme.body;
  const resolved = resolveReaderType(session, declared);
  if (!resolved.ok || resolved.type.quantified.length > 0) return scheme.body;
  const consumer = expectedTypeConsumer(resolved.type);
  const checked = checkExpression(session, input,
    { kind: "call", fnId: consumer.id, args: [input.expression] }, undefined, undefined, [consumer]);
  return checked.outcome.$tag === "Solved" ? declared : scheme.body;
}

function sourceAnnotationType(input: DataSuggestionInput): FenelType | undefined {
  const form = input.expression.kind === "literal" ? detectStructuralForm(input.expression.value,
    strategy => Object.hasOwn(EVALUATOR_STRATEGIES, strategy)) : null;
  return form?.kind === "ann" ? annotationTypeForEditor(form.type) ?? undefined : undefined;
}

function checkPlan(session: AuthoringSession, input: DataSuggestionInput, scheme: TypeScheme | undefined,
  plan: SuggestionPlan, namesAvailable: boolean, source?: SourceSelection) {
  let compatibility = scheme ? "compatible" : "unknown";
  let genericSlot = false;
  const missing = missingNames(plan).length;
  if (plan.$tag === "SuggestionPlan") {
    const entry = session.environment.getFunctionEntry?.(plan.operation.payload.functionId);
    if (!entry || !scheme) compatibility = "unknown";
    else {
      // A direct plan has no fixed sibling/expected result. Its selected slot's
      // declared scheme retains the same binders/owners; complete lambda inference
      // below still checks all shared-variable relationships and residual inputs.
      const expected = entry.signatureOutcome?.$tag === "Solved" && entry.scheme
        ? projectAuthoringScheme(entry.scheme, ["$arrow", "params", String(plan.inputIndex), "type"]) : undefined;
      compatibility = expected ? judgeAuthoringSchemeCompatibility(scheme, expected, { registry: session.registry }) : "unknown";
      genericSlot = !!expected && bareTypeVariable(expected.body);
    }
  }
  // A2 scheduling consumes the existing Fenel admission policy: a definite
  // selected-slot mismatch already rejects this plan independently of whole
  // inference. Compatible and unresolved inputs still run every usual check.
  const preliminary = lensPolicyData<Maybe<boolean>>(session, "suggestionAdmission", "NotChecked", compatibility);
  if (preliminary.$tag === "Just" && !preliminary._0) {
    return { applicability: preliminary, inferred: undefined, resultScheme: undefined, missing, compatibility, genericSlot };
  }
  const context = inferenceContext(session, input);
  // This is the canonical literal-fact adapter, not substitution of the source
  // by an independently instantiated parameter. Lexical references stay inside
  // the same complete expression, retaining their shared monomorphic variables.
  const selected = prepareAuthoringLiteralWitnesses(input.expression, context, {
    ...((source?.producerScheme ?? scheme) ? { expectedScheme: source?.producerScheme ?? scheme } : {}),
    literalMembership: inputMembership(session, input),
  });
  const body = sourceBody(session, source, plan, selected.node, true);
  const inferred = checkExpression(session, input, lambda(missingNames(plan), body), selected.bindings);
  const target = destinationScheme(session, input);
  // The existing sink instantiates schemes. It cannot establish an arbitrary
  // authored universal arrow contract or independently freshened generic locals.
  // Those obligations remain with whole-function rigid declaration inference.
  const localRigidContext = (target?.quantified.length ?? 0) > 0
    || (input.lexicalBindings ?? []).some(binding => (binding.scheme?.quantified.length ?? 0) > 0);
  const consumer = target && !localRigidContext ? expectedTypeConsumer(target) : undefined;
  const enclosing = input.enclosing ? checkEnclosingPlan(session, input,
    sourceBody(session, source, plan, input.expression, true), missingNames(plan)) : undefined;
  const rigidContext = localRigidContext || enclosing?.rigid === true;
  const targetChecked = enclosing ? enclosing.checked : input.destination && consumer ? checkExpression(session, input,
    lambda(missingNames(plan), { kind: "call", fnId: consumer.id, args: [body] }), selected.bindings, undefined, [consumer]) : undefined;
  const resultScheme = inferred.scheme && (missing > 0
    ? projectAuthoringScheme(inferred.scheme, ["$arrow", "returns"]) : inferred.scheme);
  const targetCompatibility = target && resultScheme && !rigidContext
    ? judgeAuthoringSchemeCompatibility(resultScheme, target, { registry: session.registry }) : "unknown";
  const applicability = lensPolicyData<Maybe<boolean>>(session, "suggestionDestinationAdmission",
    inferred.outcome.$tag, compatibility, input.destination !== undefined || input.enclosing !== undefined,
    targetChecked?.outcome.$tag ?? "NotChecked", !rigidContext && (enclosing ? enclosing.available : target !== undefined),
    namesAvailable && !rigidContext, targetCompatibility);
  const argumentSchemes = missing > 0 && inferred.scheme ? Array.from({ length: missing },
    (_, index) => projectAuthoringScheme(inferred.scheme!, ["$arrow", "params", String(index), "type"])) : undefined;
  return { inferred, applicability, resultScheme, missing, targetChecked, rigidContext, compatibility, genericSlot, argumentSchemes };
}

/** A bare quantified/inference variable admits any data: a generic slot. */
function bareTypeVariable(type: FenelType | undefined): boolean {
  return !!type && typeof type === "object" && "$var" in type;
}

/** Transport-only facts for the Fenel relevance policy: the existing
 * selected-slot verdict, whether the checked result type and the data's type
 * contain each other (an endomorphism such as Negate or Reverse), and the
 * catalogue kind and module. No type name or function name is inspected. */
function candidateFacts(session: AuthoringSession, scheme: TypeScheme | undefined, plan: SuggestionPlan,
  checked: ReturnType<typeof checkPlan>) {
  if (plan.$tag !== "SuggestionPlan") return undefined;
  const result = checked.resultScheme;
  let sameType = false;
  try {
    sameType = !!scheme && !!result && scheme.quantified.length === 0 && result.quantified.length === 0
      && judgeAuthoringSchemeCompatibility(result, scheme, { registry: session.registry }) === "compatible"
      && judgeAuthoringSchemeCompatibility(scheme, result, { registry: session.registry }) === "compatible";
  } catch { sameType = false; }
  const entry = session.environment.getFunctionEntry?.(plan.operation.payload.functionId) as AuthoringFunctionEntry | undefined;
  return { slot: checked.genericSlot ? "generic" : checked.compatibility === "compatible" ? "exact" : "unknown",
    sameType, constructs: plan.operation.payload.kind === "constructor" || entry?.kind === "constructor" || entry?.constructorTarget !== undefined,
    moduleName: plan.operation.payload.family,
    operator: plan.operation.payload.operator === true, internal: plan.operation.payload.internal === true };
}

/** The facts the Fenel sentence reads, for a field-derived plan: its kind, the
 * list element's type name (its code name; empty for anonymous records) and
 * the fields' labels. Presentation only: a reader without the policy shows none. */
function suggestionSentence(session: AuthoringSession, plan: SuggestionPlan): string {
  if (plan.$tag !== "SuggestionMappedProjection" && plan.$tag !== "SuggestionGroupedProjection"
    && plan.$tag !== "SuggestionCountProjection" && plan.$tag !== "SuggestionSumProjection") return "";
  const element = plan.field.payload.elementType as FenelType | undefined;
  const handle = element && typeof element === "object" && "$ref" in element && typeof element.$ref === "string" ? element.$ref : undefined;
  const name = handle ? session.registry.getIdentifiedEntity(handle)?.id ?? "" : "";
  try {
    const sentence = lensPolicyData<unknown>(session, "suggestionSentence", plan.$tag, name, plan.field.label,
      plan.$tag === "SuggestionSumProjection" ? plan.amount.label : "");
    return typeof sentence === "string" ? sentence : "";
  } catch { return ""; }
}

/** A field's label for an action: its Labelable label when it has one, else
 * its code name as written (the rule data names follow; never re-cased). */
function fieldActionLabel(field: { name: string; label?: unknown }): string {
  const label = field.label && typeof field.label === "object" && (field.label as { $tag?: unknown }).$tag === "Just"
    ? valueCardLabel((field.label as { _0?: unknown })._0) : undefined;
  return label?.trim() || field.name;
}

function makeCandidate(session: AuthoringSession, input: DataSuggestionInput, scheme: TypeScheme | undefined,
  plan: SuggestionPlan, namesAvailable: boolean, source?: SourceSelection): DataSuggestion {
  const checked = checkPlan(session, input, scheme, plan, namesAvailable, source);
  const grouped = plan.$tag === "SuggestionGroupedProjection";
  const aggregate = plan.$tag === "SuggestionCountProjection" || plan.$tag === "SuggestionSumProjection";
  const projection = plan.$tag === "SuggestionProjection" || plan.$tag === "SuggestionMappedProjection" || grouped || aggregate;
  const family = grouped ? "grouping" : aggregate ? "aggregate" : projection ? "projection" : plan.operation.payload.family;
  const identity = plan.$tag === "SuggestionSumProjection" ? `sum-field:${plan.amount.identity}/per:${plan.field.identity}`
    : plan.$tag === "SuggestionCountProjection" ? `count-field:${plan.field.identity}`
    : projection ? `${grouped ? "grouped-field" : plan.$tag === "SuggestionMappedProjection" ? "mapped-field" : "field"}:${plan.field.identity}`
    : plan.$tag === "SuggestionApplicationPlan" ? "selected-function:apply"
    : `${plan.operation.key}/argument:${plan.inputIndex}`;
  // A2 transport still submits every policy-rejected plan so aggregate counts
  // retain complete coverage. rankSuggestions filters it before reading display
  // fields; no label, traits, reason or recipe projection is needed for it.
  if (!checked.inferred && checked.applicability.$tag === "Just" && !checked.applicability._0) {
    return { $tag: "SuggestionCandidate", identity, family,
      label: "", icon: "", expression: sourceCandidateNode(session, input, source, plan, false), resultType: "",
      inputIndex: plan.$tag === "SuggestionPlan" ? plan.inputIndex : 0,
      missingArguments: checked.missing, applicability: checked.applicability,
      relevance: 0, compositionCost: 0, pin: Nothing, lenses: [], reasons: [],
      revision: input.revision, plan };
  }
  const label = grouped ? lensPolicyData<string>(session, "suggestionGroupingLabel", plan.field)
    : plan.$tag === "SuggestionCountProjection" ? lensPolicyData<string>(session, "suggestionCountLabel", plan.field)
    : plan.$tag === "SuggestionSumProjection" ? lensPolicyData<string>(session, "suggestionSumLabel", plan.amount, plan.field)
    : projection ? lensPolicyData<string>(session, "suggestionProjectionLabel", plan.$tag === "SuggestionMappedProjection", plan.field)
    : plan.$tag === "SuggestionApplicationPlan" ? "Apply this function"
    : lensPolicyData<string>(session, "suggestionPlanLabel", plan);
  const traits = lensPolicyData<{ relevance: number; compositionCost: number; icon: string }>(session,
    "suggestionTemplateTraits", plan.$tag);
  const sentence = suggestionSentence(session, plan);
  const facts = candidateFacts(session, scheme, plan, checked);
  const relevance = facts ? lensPolicyData<number>(session, "suggestionCatalogueRelevance", traits.relevance,
    facts.slot, facts.sameType, facts.constructs, facts.moduleName, facts.operator, facts.internal) : traits.relevance;
  return { $tag: "SuggestionCandidate", identity, family,
    label, icon: traits.icon, expression: sourceCandidateNode(session, input, source, plan, false),
    resultType: "", ...(checked.resultScheme ? { resultScheme: checked.resultScheme } : {}),
    ...(checked.argumentSchemes ? { argumentSchemes: checked.argumentSchemes } : {}),
    inputIndex: plan.$tag === "SuggestionPlan" ? plan.inputIndex : 0, missingArguments: checked.missing,
    applicability: checked.applicability, relevance, compositionCost: traits.compositionCost,
    // Rom's pins (Nov 9): a pinned action ranks first (the ranker's existing
    // pin tier); its own relevance orders the pins among themselves.
    pin: plan.$tag === "SuggestionPlan" && plan.operation.payload.pinned === true ? Just(0) : Nothing,
    lenses: [], revision: input.revision, plan, replaceable: replaceableFact(session, input, scheme, checked),
    ...(sentence ? { sentence } : {}),
    reasons: [lensPolicyData<string>(session, "suggestionAdmissionReason", checked.inferred?.outcome.$tag ?? "NotChecked",
      checked.applicability.$tag === "Just" ? checked.applicability._0 ? "compatible" : "incompatible" : "unknown"),
      ...[lensPolicyData<string>(session, "suggestionDestinationReason", input.destination !== undefined || input.enclosing !== undefined,
        checked.rigidContext ?? false, checked.targetChecked?.outcome.$tag ?? "NotChecked")].filter(Boolean),
      ...((checked.targetChecked?.outcome as { diagnostics?: { message: string }[] } | undefined)?.diagnostics ?? []).map(item => item.message),
      ...((checked.inferred?.outcome as { diagnostics?: { message: string }[] } | undefined)?.diagnostics ?? []).map(item => item.message)],
  };
}

/** The selected-slot judgment of `checkPlan`, applied to every input of one
 * catalogue operation before the bounded prefix is chosen (see `fit` above).
 * A bare type variable admits any data without a judgment. Identical projected
 * slot schemes share one verdict: the judgment depends only on the two schemes
 * and the reader's registry, so the memo is keyed by both carriers, per registry. */
type FitMemo = Map<string, number>;
const fitMemos = new WeakMap<object, Map<string, FitMemo>>();
const FIT_SUBJECT_LIMIT = 16;
const FIT_KEY_LIMIT = 8_192;

function fitMemoFor(session: AuthoringSession, scheme: TypeScheme): FitMemo {
  let subject: string;
  try { subject = JSON.stringify(scheme); } catch { return new Map(); }
  if (subject.length > FIT_KEY_LIMIT) return new Map();
  let bySubject = fitMemos.get(session.registry);
  if (!bySubject) fitMemos.set(session.registry, bySubject = new Map());
  const known = bySubject.get(subject);
  if (known) return known;
  return boundedPlanningMemo(bySubject, subject, new Map(), FIT_SUBJECT_LIMIT);
}

/** A syntactic signature-head index key (design/suggestions.md: "an index can
 * shortlist by checked signature head/arity, but it is only an optimization").
 * It is never a verdict: equal heads are then judged; other heads stay
 * unresolved (2), behind the judged matches but never refused by it. */
function typeHead(type: unknown): string | undefined {
  if (type === null || typeof type !== "object" || Array.isArray(type)) return undefined;
  const carrier = type as Record<string, unknown>;
  if (typeof carrier.$ref === "string") return `ref:${carrier.$ref}`;
  const opaque = carrier.$opaque as { name?: unknown } | undefined;
  if (opaque && typeof opaque.name === "string") return `opaque:${opaque.name}`;
  return Object.keys(carrier).find(key => key.startsWith("$"));
}

function catalogueFit(session: AuthoringSession, scheme: TypeScheme | undefined, declaration: AuthoringFunctionEntry | undefined,
  memo: FitMemo, subjectHead: string | undefined): number {
  if (!scheme || !declaration?.scheme || declaration.signatureOutcome?.$tag !== "Solved") return 2;
  const params = (declaration.scheme.body as { $arrow?: { params?: { type?: FenelType }[] } }).$arrow?.params ?? [];
  if (params.length === 0) return 3;
  let best = 3;
  for (let index = 0; index < params.length && best > 0; index++) {
    if (bareTypeVariable(params[index]?.type)) { best = Math.min(best, 1); continue; }
    // Different heads are not judged here (each judgment is a full containment check).
    if (subjectHead === undefined || typeHead(params[index]?.type) !== subjectHead) { best = Math.min(best, 2); continue; }
    let fit = 2;
    try {
      const slot = projectAuthoringScheme(declaration.scheme, ["$arrow", "params", String(index), "type"]);
      if (slot) {
        const key = JSON.stringify(slot);
        const known = key.length <= FIT_KEY_LIMIT ? memo.get(key) : undefined;
        if (known !== undefined) fit = known;
        else {
          const verdict = judgeAuthoringSchemeCompatibility(scheme, slot, { registry: session.registry });
          fit = verdict === "incompatible" ? 3 : verdict === "compatible" ? (bareTypeVariable(slot.body) ? 1 : 0) : 2;
          if (key.length <= FIT_KEY_LIMIT) memo.set(key, fit);
        }
      }
    } catch { fit = 2; }
    if (fit < best) best = fit;
  }
  return best;
}

/** Transport only (lane D, Rom's decision (b), 2026-11-08): a function's own
 * Categorizable category and Taggable tags, selected in this reader's frame by
 * the canonical resolveEffect, judged by the Fenel `suggestionInternal` rule.
 * One judgment per distinct (category, tags) and one lookup per function and
 * frame; an unreadable representation is not internal. */
const internalByFrame = new WeakMap<object, Map<string, boolean>>();
const internalJudgments = new WeakMap<object, Map<string, boolean>>();
export function functionMarkedInternal(session: AuthoringSession, ids: readonly (string | undefined)[]): boolean {
  return functionMarker(session, ids, "suggestionInternal", internalByFrame, internalJudgments);
}
/** Lane D (Nov 9, Rom's pins): the same transport for the Fenel
 * `suggestionPinnedAction` rule over the function's own tags. */
const pinnedByFrame = new WeakMap<object, Map<string, boolean>>();
const pinnedJudgments = new WeakMap<object, Map<string, boolean>>();
export function functionPinnedAction(session: AuthoringSession, ids: readonly (string | undefined)[]): boolean {
  return functionMarker(session, ids, "suggestionPinnedAction", pinnedByFrame, pinnedJudgments);
}
/** Nov 11 (Rom: "Aren't array and list the same in Fenel?!"): the same
 * transport for the Fenel `suggestionRepresentationBridge` rule over the
 * function's own tags. Discovery drops such a function before it is counted;
 * an unreadable rule or representation keeps it (fail open). */
const bridgeByFrame = new WeakMap<object, Map<string, boolean>>();
const bridgeJudgments = new WeakMap<object, Map<string, boolean>>();
export function functionRepresentationBridge(session: AuthoringSession, ids: readonly (string | undefined)[]): boolean {
  return functionMarker(session, ids, "suggestionRepresentationBridge", bridgeByFrame, bridgeJudgments);
}
function functionMarker(session: AuthoringSession, ids: readonly (string | undefined)[],
  rule: "suggestionInternal" | "suggestionPinnedAction" | "suggestionRepresentationBridge",
  byFrame: WeakMap<object, Map<string, boolean>>, judged: WeakMap<object, Map<string, boolean>>): boolean {
  const frame = session.evaluateContext;
  const pool = frame?._specRegistry;
  if (!frame || !pool) return false;
  let known = byFrame.get(frame);
  if (!known) byFrame.set(frame, known = new Map());
  const key = ids.filter(Boolean).join("\u0000");
  const cached = known.get(key);
  if (cached !== undefined) return cached;
  let category = "";
  let tags: string[] = [];
  try {
    for (const id of ids) {
      if (!id) continue;
      const categorized = resolveEffect(frame, pool, "Categorizable", id)?.methods?.category;
      const tagged = resolveEffect(frame, pool, "Taggable", id)?.methods?.tags;
      if (typeof categorized === "string" && !category) category = categorized;
      if (Array.isArray(tagged) && !tags.length) tags = tagged.filter((tag): tag is string => typeof tag === "string");
      if (category || tags.length) break;
    }
  } catch { category = ""; tags = []; }
  let judgments = judged.get(frame);
  if (!judgments) judged.set(frame, judgments = new Map());
  const factsKey = JSON.stringify([category, tags]);
  let marked = judgments.get(factsKey);
  if (marked === undefined) {
    try {
      marked = (rule === "suggestionInternal" ? lensPolicyData<boolean>(session, rule, category, tags)
        : lensPolicyData<boolean>(session, rule, tags)) === true;
    } catch { marked = false; }
    judgments.set(factsKey, marked);
  }
  if (known.size > 16_384) known.clear();
  known.set(key, marked);
  return marked;
}

/** Which inputs the bounded first check judges (transport cost only; the
 * Fenel snapshot orders by the result). The standard library and reader-local
 * callables: every verdict. Another module's user-facing function (lane D,
 * Nov 8: a games module's Image -> FrameSequence never reached the first check
 * on an image): only an input that concretely admits the data (0) or a
 * definite refusal (3) counts, so it meets the data beside the standard
 * library's typed operations; its generic and unresolved inputs stay
 * unresolved (2), behind them, as before. An internal helper is not judged:
 * it ranks in the last band whatever its fit. `catalogueFit` itself judges
 * only inputs whose signature head equals the data's. */
export function catalogueEntryFit(moduleName: string, internal: boolean, judge: () => number): number {
  if (moduleName === "std" || moduleName === "") return judge();
  if (internal) return 2;
  const fit = judge();
  return fit === 0 || fit === 3 ? fit : 2;
}

/** Query only the current reader's captured catalogue. No registry scan, body
 * execution, account acquisition or arbitrary authored provider is performed. */
export async function discoverDataSuggestions(reader: AuthoringSession, input: DataSuggestionInput,
  options: DataSuggestionOptions = {}, lifetime: DiscoveryLifetime = {}): Promise<DataSuggestionBatch> {
  const session = concreteAuthoringSession(reader);
  const checkpoint = async () => { lifetime.signal?.throwIfAborted(); await lifetime.yieldControl?.(); lifetime.signal?.throwIfAborted(); };
  await checkpoint();
  input = stableSubjectInput(session, input);
  const reserved = planningNames(session, input);
  const source = sourceSelection(session, input, reserved ?? []);
  const scheme = source ? source.scheme : subjectScheme(session, input);
  const planReserved = [...reserved ?? [], ...source?.names ?? []];
  const fitMemo = scheme ? fitMemoFor(session, scheme) : new Map<string, number>();
  const subjectHead = typeHead(scheme?.body);
  const operations: CatalogueOperations = [];
  for (const entry of session.catalog.functions) {
    // The fit pass judges many slots: share the worker between slices.
    if (operations.length % 64 === 63) await checkpoint();
    const target = entry.targetId ?? entry.id;
    const handle = session.registry.getUuid(target);
    // A representation bridge is never offered on data: it is dropped before
    // it is counted, so it is neither checked nor reported as not shown.
    if (entry.kind !== "constructor" && functionRepresentationBridge(session, [target, entry.id, handle])) continue;
    const declaration = session.environment.getFunctionEntry?.(target) as AuthoringCatalogFunctionEntry | undefined;
    const moduleName = entry.parentModule ?? declaration?.parentModule ?? "";
    const internal = entry.kind !== "constructor" && functionMarkedInternal(session, [target, entry.id, handle]);
    const pinned = entry.kind !== "constructor" && !internal && functionPinnedAction(session, [target, entry.id, handle]);
    operations.push({ callable: entry.kind !== "constructor", moduleName, internal, pinned,
      fit: entry.kind === "constructor" ? 3 : catalogueEntryFit(moduleName, internal,
        () => catalogueFit(session, scheme, declaration, fitMemo, subjectHead)),
      operation: { $tag: "SuggestionOperation" as const, key: target, label: entry.label,
        paramNames: entry.params.map(field => field.name),
        payload: { functionId: target, family: moduleName || "catalogue", kind: entry.kind, internal, pinned,
          operator: typeof entry.notation === "string" && entry.notation.length > 0,
          callable: handle ? Just(Ref(handle)) : Nothing, scheme: entry.scheme ? Just(entry.scheme) : Nothing } },
    });
  }
  const memo = planningMemo(session, operations, options.reuse !== false);
  const { snapshot, planned } = plannedCatalogue(session, operations, memo, options.maxOperations ?? 128, options.maxArity ?? 5);
  const candidates: DataSuggestion[] = [];
  for (const plan of planned.plans) {
    await checkpoint(); candidates.push(makeCandidate(session, input, scheme,
      reusedHygienicPlan(session, memo, planReserved, plan), reserved !== undefined, source));
  }
  // Reflection transports actual FieldKeys; the canonical inference owner checks
  // projection ownership. A nominal declaration gap remains undecided.
  const fields = recordFieldsForType(scheme?.body, session.environment) ?? [];
  const reflected = fields.map(field => ({ $tag: "SuggestionField", identity: JSON.stringify(field.key),
    label: fieldActionLabel(field), path: [field.name], payload: { key: field.key, type: field.type } }));
  const projections = lensPolicyData<ProjectionPlan[]>(session, "suggestionProjectionPlans", 12, reflected);
  for (const plan of projections) {
    await checkpoint(); candidates.push(makeCandidate(session, input, scheme,
      hygienicPlan(session, planReserved, plan), reserved !== undefined, source));
  }
  const reflectedType = reflectionType(session, input, scheme);
  const listElement = reflectedType && peelListForAuthoring(transferContainerShape(reflectedType,
    session.environment, session.evaluateContext, session.registry))?.elem;
  const recordFields = listElement && recordFieldsForType(listElement, session.environment);
  const variant = listElement && !recordFields ? peelToVariantType(listElement, session.environment) : undefined;
  const elementFields = recordFields ?? (variant?.cases.length === 1 ? variant.cases[0]!.fields : undefined) ?? [];
  const mappedFields = elementFields.map(field => ({ $tag: "SuggestionField", identity: JSON.stringify(field.key),
    label: fieldActionLabel(field), path: [field.name], payload: { key: field.key, type: field.type, sourceScheme: scheme, elementType: listElement } }));
  const mapId = session.environment.resolveFunctionId("std.map") ?? session.environment.resolveFunctionId("std:map");
  const mapper = operations.find(entry => entry.operation.payload.functionId === mapId)?.operation;
  const mapped = lensPolicyData<MappedProjectionPlan[]>(session, "suggestionMappedProjectionPlans", 12,
    planReserved, mapper ? Just(mapper) : Nothing, mappedFields);
  for (const plan of mapped) { await checkpoint(); candidates.push(makeCandidate(session, input, scheme, plan, reserved !== undefined, source)); }
  const groupId = session.environment.resolveFunctionId("std.groupByKey") ?? session.environment.resolveFunctionId("std:groupByKey");
  const grouper = operations.find(entry => entry.operation.payload.functionId === groupId)?.operation;
  const grouped = lensPolicyData<GroupedProjectionPlan[]>(session, "suggestionGroupedProjectionPlans", 12,
    planReserved, grouper ? Just(grouper) : Nothing, mappedFields);
  for (const plan of grouped) { await checkpoint(); candidates.push(makeCandidate(session, input, scheme, plan, reserved !== undefined, source)); }
  const operationFor = (name: string) => {
    const id = session.environment.resolveFunctionId(`std.${name}`) ?? session.environment.resolveFunctionId(`std:${name}`);
    return operations.find(entry => entry.operation.payload.functionId === id)?.operation;
  };
  const counter = operationFor("countByKey");
  const counted = lensPolicyData<CountProjectionPlan[]>(session, "suggestionCountProjectionPlans", 12,
    planReserved, counter ? Just(counter) : Nothing, mappedFields);
  for (const plan of counted) { await checkpoint(); candidates.push(makeCandidate(session, input, scheme, plan, reserved !== undefined, source)); }
  const summer = operationFor("sumByKey");
  const summed = lensPolicyData<SumProjectionPlan[]>(session, "suggestionSumProjectionPlans", 24,
    planReserved, summer ? Just(summer) : Nothing, mappedFields);
  for (const plan of summed) { await checkpoint(); candidates.push(makeCandidate(session, input, scheme, plan, reserved !== undefined, source)); }
  if (scheme && "$arrow" in scheme.body) {
    const operation: Operation = { $tag: "SuggestionOperation", key: "selected-function", label: "Apply this function",
      paramNames: scheme.body.$arrow.params.map(field => field.name),
      payload: { functionId: "", family: "application", kind: "function", callable: Nothing, scheme: Just(scheme) } };
    const application = lensPolicyData<Maybe<ApplicationPlan>>(session, "suggestionApplicationPlan", options.maxArity ?? 5, operation);
    if (application.$tag === "Just") {
      await checkpoint(); candidates.push(makeCandidate(session, input, scheme,
        hygienicPlan(session, planReserved, application._0), reserved !== undefined, source));
    }
  }
  await checkpoint();
  const ranked = lensPolicyData<PolicyBatch>(session, "rankSuggestions",
    options.maxSuggestions ?? 20, lensPolicyData<number>(session, "suggestionFamilyQuota", options.maxSuggestions ?? 20),
    candidates.map(policyCandidate));
  return { ...ranked, suggestions: ranked.suggestions.map(readerCandidate).map(candidate => withDisposition(session, candidate)),
    undecided: ranked.undecided.map(readerCandidate),
    revision: input.revision, coverage: {
    operationsSeen: snapshot.totalSubmitted, operationsAvailable: snapshot.eligibleCount,
    operationsChecked: snapshot.operations.length - planned.skippedOperations.length + snapshot.rejectedCount,
    skipped: snapshot.omittedCount - snapshot.rejectedCount + planned.skippedOperations.length,
    truncated: snapshot.omittedCount > snapshot.rejectedCount || planned.skippedOperations.length > 0 || fields.length > projections.length
      || mapper !== undefined && elementFields.length > mapped.length
      || grouper !== undefined && elementFields.length > grouped.length
      || counter !== undefined && elementFields.length > counted.length
      || summer !== undefined && elementFields.length * Math.max(0, elementFields.length - 1) > summed.length,
    reason: scheme ? `Current reader catalogue; ${snapshot.excludedCount} constructor picker entries excluded. Bounded direct applications, record fields, mapped, grouped and aggregated record fields and selected functions.`
      : "The selected source's declared type could not be confirmed. Checks remain unresolved.",
  } };
}

/** Rebuild and recheck under the selecting reader. Transported verdicts and
 * editor expressions never authorize a recipe or choose another reader. */
export function prepareDataSuggestion(reader: AuthoringSession, suggestion: DataSuggestion,
  input: DataSuggestionInput): DataSuggestionPreparation {
  const session = concreteAuthoringSession(reader);
  if (suggestion.revision !== input.revision) return { ok: false, issue: "The data changed. Open Suggestions again." };
  try {
    input = stableSubjectInput(session, input);
    const reserved = planningNames(session, input);
    const source = sourceSelection(session, input, reserved ?? []);
    const plan = hygienicPlan(session, [...reserved ?? [], ...source?.names ?? []], suggestion.plan);
    const checked = checkPlan(session, input, source ? source.scheme : subjectScheme(session, input), plan, reserved !== undefined, source);
    if (checked.applicability.$tag !== "Just" || !checked.applicability._0) {
      return { ok: false, issue: "This suggestion could not be checked for the current data." };
    }
    // Checked against the authored copy; new data reads the data's own live
    // reference (the same value) so it follows later edits (review B4).
    const subject = input.reference && !source ? { ...input, expression: input.reference } : input;
    return { ok: true, node: sourceCandidateNode(session, subject, source, plan, false) };
  } catch (error) { return { ok: false, issue: error instanceof Error ? error.message : String(error) }; }
}
