import type { FenelType, TypeScheme } from "../types";
import {
  dispatchEngineBody,
  dispatchedDisjointType,
  dispatchedSubset,
  marshalStoredBodyForValidation,
  type ContainmentDispatchOptions,
} from "../engine-bodies-dispatch";
import { inferJsonLogicType, snapshotAuthoringSchemeTransport } from "../signature-inference";
import { Just, Nothing } from "../type-foundation";
import { assertJsonAuthoringValue } from "./json-value";
import {
  type AuthoringFunctionEntry,
  type AuthoringInferenceContext,
  type ExprNode,
} from "./expression-authoring";
import type { AuthoringEnvironment } from "./environment";
import { projectAuthoringScheme } from "./scheme-projection";
export { projectAuthoringScheme } from "./scheme-projection";
import {
  asAuthoringScheme as asScheme,
  expectedTypeConsumer as consumer,
  inferCallScheme,
  solvedAuthoringArrow as solvedArrow,
  type AuthoringCallScheme,
  type AuthoringExpectedType,
} from "./call-scheme";
export type { AuthoringExpectedType } from "./call-scheme";
import { inferAuthoringExpressionWithLiteralWitnesses } from "./literal-witness";

export type AuthoringTypeCompatibility = "compatible" | "incompatible" | "unknown";
export type AuthoringSuggestionMatch = "direct" | "adaptable" | "mismatch" | "unavailable";
type AuthoringSchemeMatchPlan = {
  readonly needsInference: boolean;
  readonly match: AuthoringSuggestionMatch;
};
export type AuthoringFunctionSuggestion<T extends AuthoringFunctionEntry> = {
  entry: T;
  match: AuthoringSuggestionMatch;
};
export type AuthoringSuggestionOptions = ContainmentDispatchOptions & {
  mode?: "call" | "reference";
  /** A composition step must accept the preceding expression as argument 0. */
  inputScheme?: TypeScheme;
};

/** A selected generic type gets binder authority from its exact constructor
 * owner. An arbitrary `$var` occurring in a raw type never creates a binder. */
export function expectedSchemeForType(
  type: FenelType | undefined,
  environment: AuthoringEnvironment,
): TypeScheme | undefined {
  if (type === undefined) return undefined;
  const reference = "$ref" in type ? type.$ref : "$named" in type ? type.$named : undefined;
  const rows = environment.catalog.types.filter((row) =>
    row.type === type
    || (reference !== undefined
      && (row.entityId === reference || row.id === reference || row.name === reference))
  );
  if (rows.length !== 1) return undefined;
  const row = rows[0]!;
  const constructors = (environment.catalog.patternConstructors ?? environment.catalog.functions)
    .filter((entry) => entry.kind === "constructor"
      && entry.signatureOutcome?.$tag === "Solved"
      && entry.scheme !== undefined
      && (entry.parentEntity === row.entityId || entry.parentEntity === row.name));
  const owners = new Set(constructors.map((entry) =>
    entry.ownerIdentity ?? JSON.stringify([entry.parentModule, entry.parentEntity])));
  if (owners.size !== 1) return undefined;
  for (const constructor of constructors) {
    const result = projectAuthoringScheme(constructor.scheme!, ["$arrow", "returns"]);
    if (result !== undefined) return result;
  }
  return undefined;
}

/** Sound containment, with a disjointness proof for known unequal atom sorts.
 * The permissive picker matcher deliberately is not a validation verdict. */
export function judgeAuthoringTypeCompatibility(
  actual: FenelType,
  expected: FenelType,
  options?: ContainmentDispatchOptions,
): AuthoringTypeCompatibility {
  try {
    const subset = dispatchedSubset(actual, expected, options);
    if (subset.$tag === "Just") return subset._0 ? "compatible" : "incompatible";
    const disjoint = dispatchedDisjointType(actual, expected, options);
    return disjoint.$tag === "Just" && disjoint._0 ? "incompatible" : "unknown";
  } catch {
    return "unknown";
  }
}

const rankOrder: Record<AuthoringSuggestionMatch, number> = {
  direct: 0, adaptable: 1, mismatch: 2, unavailable: 3,
};
const detachedScope = {};
const rankingCaches = new WeakMap<object, Map<string, Map<string, AuthoringSuggestionMatch>>>();

function schemeCacheKey(scheme: TypeScheme): string {
  // A lone bound variable shares one proof with alpha-renamings of that
  // variable (its kind still belongs in the key).
  if ("$var" in scheme.body && !(scheme.applications?.length || scheme.nominals?.length)) {
    const variableName = scheme.body.$var;
    const binder = scheme.quantified.find(({ sourceName }) => sourceName === variableName);
    if (binder !== undefined) return JSON.stringify(["bound-variable", binder.kind, scheme.diagnostics]);
  }
  const application = scheme.applications?.length === 1 ? scheme.applications[0] : undefined;
  if (application?.path.length === 0 && application.headRef !== undefined
    && (scheme.nominals ?? []).every((item) => item.path.length === 0)) {
    const variables = application.args.map((arg) => "$var" in arg
      ? scheme.quantified.find((variable) => variable.sourceName === arg.$var)
      : undefined);
    if (variables.length > 0 && variables.every((variable) => variable !== undefined)) {
      const indices = new Map<string, number>();
      // Maybe(a) and the solver's freshly generalized Maybe(a0) are the same
      // query. Preserve repeated-variable relationships and the declared kinds.
      const args = variables.map((variable) => {
        if (!indices.has(variable!.id)) indices.set(variable!.id, indices.size);
        return [indices.get(variable!.id), variable!.kind];
      });
      return JSON.stringify(["nominal-application-variables", application.headRef,
        application.kind, scheme.nominals?.[0]?.identity, args, scheme.diagnostics]);
    }
  }
  // Retain the complete header on this generic path. Even an unused binder
  // can fail canonical preparation (for example, duplicate binder IDs);
  // transport snapshotting alone does not justify sharing that refusal or
  // success with a different header.
  return JSON.stringify(scheme);
}

function suggestionCache(
  wanted: TypeScheme | undefined,
  options: ContainmentDispatchOptions,
): Map<string, AuthoringSuggestionMatch> {
  const scope = options.registry ?? detachedScope;
  let byExpected = rankingCaches.get(scope);
  if (byExpected === undefined) rankingCaches.set(scope, byExpected = new Map());
  const expectedKey = wanted === undefined ? "<input-only>" : schemeCacheKey(wanted);
  let cache = byExpected.get(expectedKey);
  if (cache === undefined) {
    if (byExpected.size >= 32) byExpected.delete(byExpected.keys().next().value!);
    byExpected.set(expectedKey, cache = new Map());
  }
  return cache;
}

function classifySchemeMatch(
  actual: TypeScheme,
  wanted: TypeScheme,
  options: ContainmentDispatchOptions,
  checkUnresolvedReference = false,
): AuthoringSuggestionMatch {
  let captured: readonly [TypeScheme, TypeScheme] | undefined;
  let canCheck = true;
  try {
    captured = [snapshotAuthoringSchemeTransport(actual), snapshotAuthoringSchemeTransport(wanted)];
  } catch {
    // Non-enumerable plain data can retain a canonical refusal. The existing
    // preflight rejects accessors/cycles before any original slots are read.
    try { assertJsonAuthoringValue({ actual, wanted }); } catch { canCheck = false; }
  }
  const cache = captured === undefined ? undefined : suggestionCache(captured[1], options);
  const key = captured === undefined ? undefined : schemeCacheKey(captured[0]);
  const cached = key === undefined ? undefined : cache?.get(key);
  if (cached !== undefined && !checkUnresolvedReference) return cached;
  const comparable = captured ?? (canCheck ? [actual, wanted] as const : undefined);
  const compatibility = comparable === undefined ? "unknown"
    : judgeAuthoringTypeCompatibility(comparable[0].body, comparable[1].body, options);
  if (checkUnresolvedReference && comparable !== undefined) {
    const expected = comparable[1];
    const reference = "$ref" in expected.body ? expected.body.$ref
      : "$named" in expected.body ? expected.body.$named : undefined;
    // An unresolved source spelling is not a declaration of a disjoint nominal
    // type. Its captured owner remains unavailable in this session.
    if (typeof reference === "string"
      && !expected.nominals?.some((item) => item.path.length === 0)
      && options.registry?.getEntity(reference) === undefined
      && compatibility === "unknown") return "unavailable";
  }
  if (cached !== undefined) return cached;
  const actualSnapshot = marshalStoredBodyForValidation(captured?.[0]);
  const wantedSnapshot = marshalStoredBodyForValidation(captured?.[1]);
  // GLOBAL_ONLY: source-owned policy over captured schemes and verdicts; the
  // existing consumer below supplies the complete canonical type equation.
  let plan = dispatchEngineBody("engine:authoringSchemeMatchPlan", [
    actualSnapshot, wantedSnapshot, compatibility, Nothing,
  ]) as AuthoringSchemeMatchPlan;
  if (plan.needsInference && canCheck) {
    const sink = consumer(captured?.[1] ?? wanted);
    const inferred = inferJsonLogicType(
      { call: ["<authoring-expected>", { var: "candidate" }] },
      { bindings: { candidate: captured?.[0] ?? actual }, resolveFunction: () => sink },
    );
    plan = dispatchEngineBody("engine:authoringSchemeMatchPlan", [
      actualSnapshot, wantedSnapshot, compatibility, Just(inferred.outcome),
    ]) as AuthoringSchemeMatchPlan;
  }
  if (key !== undefined) cache?.set(key, plan.match);
  return plan.match;
}

/** Compare an inferred expression scheme with a contextual expectation using
 * exactly the same proofs as suggestions. No expression is evaluated. */
export function judgeAuthoringSchemeCompatibility(
  actual: TypeScheme,
  expected: AuthoringExpectedType,
  options: ContainmentDispatchOptions = {},
): AuthoringTypeCompatibility {
  const wanted = asScheme(expected);
  const match = classifySchemeMatch(actual, wanted, options, true);
  return match === "direct" || match === "adaptable" ? "compatible"
    : match === "mismatch" ? "incompatible" : "unknown";
}

export function rankAuthoringFunctionSuggestions<T extends AuthoringFunctionEntry>(
  entries: readonly T[],
  expected: AuthoringExpectedType | undefined,
  options: AuthoringSuggestionOptions = {},
): Array<AuthoringFunctionSuggestion<T>> {
  if (expected === undefined && (options.inputScheme === undefined || options.mode === "reference")) {
    return entries.map((entry) => ({ entry, match: "direct" }));
  }
  const wanted = expected === undefined ? undefined : asScheme(expected);
  const cache = suggestionCache(wanted, options);
  const sink = wanted === undefined ? undefined : consumer(wanted);
  const ranked = entries.map((entry): AuthoringFunctionSuggestion<T> => {
    if (solvedArrow(entry) === undefined) return { entry, match: "unavailable" };
    const actual = options.mode === "reference"
      ? entry.scheme!
      : projectAuthoringScheme(entry.scheme!, ["$arrow", "returns"]);
    if (actual === undefined) return { entry, match: "unavailable" };
    let match: AuthoringSuggestionMatch = wanted === undefined ? "direct"
      : classifySchemeMatch(actual, wanted, options);
    if (options.inputScheme !== undefined && options.mode !== "reference"
      && (match === "direct" || match === "adaptable")) {
      const inputKey = JSON.stringify(["input", entry.scheme, options.inputScheme]);
      let constrained = cache!.get(inputKey);
      if (constrained === undefined) {
        const holes = solvedArrow(entry)!.params.slice(1).map((_, index) => `argument${index + 1}`);
        const call = {
          call: ["<authoring-call>", { var: "input" }, ...holes.map((name) => ({ var: name }))],
        };
        const result = inferJsonLogicType({
          fn: [holes, sink === undefined ? call : { call: ["<authoring-expected>", call] }],
        }, {
          bindings: { input: options.inputScheme },
          resolveFunction: (id) => id === "<authoring-call>" ? entry : sink,
        });
        // GLOBAL_ONLY: project this canonical verdict through the same source
        // policy; no reader lookup or additional type judgment occurs here.
        constrained = dispatchEngineBody("engine:authoringSchemeCheckedMatch", [
          match, result.outcome,
        ]) as AuthoringSuggestionMatch;
        cache!.set(inputKey, constrained);
      }
      match = constrained;
    }
    return { entry, match };
  });
  return ranked.sort((left, right) => rankOrder[left.match] - rankOrder[right.match]);
}

export type AuthoringCallGuidance = AuthoringCallScheme;

/** Infer each slot from its surrounding result and already supplied siblings.
 * Excluding the slot itself means an incorrect current value does not prevent
 * the editor from suggesting a replacement of the right type. */
export function inferAuthoringCallGuidance(
  entry: AuthoringFunctionEntry,
  args: readonly ExprNode[],
  expected: AuthoringExpectedType | undefined,
  context: AuthoringInferenceContext = {},
): AuthoringCallGuidance {
  const arrow = solvedArrow(entry);
  if (arrow === undefined) return inferCallScheme(entry, args.map(() => undefined), expected);
  const declaredSchemes = arrow.params.map((_, index) =>
    projectAuthoringScheme(entry.scheme!, ["$arrow", "params", String(index), "type"]));
  const argumentSchemes = args.map((arg, index) => {
    const result = inferAuthoringExpressionWithLiteralWitnesses(arg, context, { expectedScheme: declaredSchemes[index] });
    return result.outcome.$tag === "Solved" ? result.scheme : undefined;
  });
  const initial = inferCallScheme(entry, argumentSchemes, expected);
  if (context.literalMembership === undefined) return initial;
  const witnessedSchemes = args.map((arg, index) => {
    const result = inferAuthoringExpressionWithLiteralWitnesses(arg, context, { expectedScheme: initial.paramSchemes[index] });
    return result.outcome.$tag === "Solved" ? result.scheme : undefined;
  });
  return inferCallScheme(entry, witnessedSchemes, expected);
}
