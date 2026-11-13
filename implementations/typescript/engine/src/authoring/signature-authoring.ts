import { dispatchEngineBody, marshalStoredBodyForValidation } from "../engine-bodies-dispatch";
import { assertAcyclicAuthoringData } from "./json-value";
import { snapshotAuthoringSchemeTransport } from "../signature-inference";
import type {
  FunctionSignatureDeclaration,
  InferenceOutcome,
  SlotDeclaration,
  TypeScheme,
} from "../types";
import type { FieldError, ValidationAdmissionObservation } from "../validate";
import { noPerformEvaluateContext, type EvaluateContext } from "../json-logic";
import type { FenelType } from "../types";

/** A2: a checker retains reader/account selection but has no perform route.
 * Descriptor copying does not execute accessors on a supplied frame. */
export function authoringMembershipEvaluateContext(context: EvaluateContext): EvaluateContext {
  return noPerformEvaluateContext(context);
}

/** B3: replace only source-selected nominal head slots with their already
 * captured reader identity. This changes no type structure or predicate. */
export function closeAuthoringMembershipType(scheme: TypeScheme, context: EvaluateContext): FenelType | undefined {
  const captured = snapshotAuthoringSchemeTransport(scheme);
  let body = captured.body;
  const read = (root: unknown, path: readonly string[]): unknown => {
    let current = root;
    for (const key of path) {
      if (current === null || typeof current !== "object") return undefined;
      const slot = Object.getOwnPropertyDescriptor(current, key);
      if (!slot || !("value" in slot)) return undefined;
      current = slot.value;
    }
    return current;
  };
  const replace = (root: unknown, path: readonly string[], next: unknown): unknown => {
    if (path.length === 0) return next;
    if (root === null || typeof root !== "object") throw new TypeError("The captured type path is unavailable.");
    const key = path[0]!;
    const slot = Object.getOwnPropertyDescriptor(root, key);
    if (!slot || !("value" in slot)) throw new TypeError("The captured type path is unavailable.");
    const copy = Array.isArray(root) ? [...root] : { ...root };
    Object.defineProperty(copy, key, { value: replace(slot.value, path.slice(1), next), enumerable: true, configurable: true, writable: true });
    return copy;
  };
  for (const nominal of captured.nominals ?? []) {
    const handle = context._typeFamilyNominalHandle?.(nominal.identity, nominal.publicName, nominal.identity);
    if (!handle) return undefined;
    const current = read(body, nominal.path);
    if (current === undefined) return undefined;
    // GLOBAL_ONLY: identify a representation slot in supplied type data.
    const selected = dispatchEngineBody("engine:authoringMembershipNominalHeadPath", [marshalStoredBodyForValidation(current)]) as {
      $tag: string; _0?: string[];
    };
    if (selected.$tag !== "Just" || !selected._0) return undefined;
    body = replace(body, [...nominal.path, ...selected._0], handle) as FenelType;
  }
  return body;
}

/** B3: source-owned validation flags and actual membership decisions determine
 * admission. Diagnostic text and projected/coerced data supply no evidence. */
export function authoringValidationMembership(checked: { valid: boolean; errors: readonly FieldError[] },
  observations: readonly ({ $tag: "Nothing" } | { $tag: "Just"; _0: boolean })[] = [],
  plans: readonly ValidationAdmissionObservation[] = [],
): { $tag: "Nothing" } | { $tag: "Just"; _0: boolean } {
  // GLOBAL_ONLY: this classification observes only the supplied validation result.
  return dispatchEngineBody("engine:authoringValidationMembership", [checked.valid, observations, plans]) as
      { $tag: "Nothing" } | { $tag: "Just"; _0: boolean };
}

/** B3: transport existing verdicts to the source-owned Save policy. */
export function authoringSaveResultVerdict(compatibility: string,
  membership: ReturnType<typeof authoringValidationMembership>,
): ReturnType<typeof authoringValidationMembership> {
  // GLOBAL_ONLY: supplied verdict data only; no reader lookup or host perform.
  return dispatchEngineBody("engine:authoringSaveResultVerdict", [compatibility, membership]) as
    ReturnType<typeof authoringValidationMembership>;
}

/** B3: presentation of the existing Save verdict and recursive hint states.
 * This neither proves membership nor admits a write. */
export function authoringCreationFeedbackState(verdict: ReturnType<typeof authoringSaveResultVerdict>,
  incomplete: boolean, refused: boolean, states: readonly import("../validation-hints").HintState[],
): import("../validation-hints").HintState {
  // GLOBAL_ONLY: supplied display facts only; no lookup or host perform.
  return dispatchEngineBody("engine:authoringCreationFeedbackState", [verdict, incomplete, refused, states]) as import("../validation-hints").HintState;
}

export type AuthoringSignatureDeclarationInput = {
  readonly functionId: string;
  readonly declarationName: string;
  readonly codeName: string;
  readonly ownerModule: string;
  readonly parameterCount: number;
  readonly inferResult: boolean;
  readonly scheme: TypeScheme;
};

/** B3: encode only the ingress facts chosen by the Fenel authoring policy.
 * The supplied authored scheme remains the same object, including all of its
 * application/nominal/diagnostic sidecars. No preview outcome is accepted. */
export function buildAuthoringSignatureDeclaration(
  input: AuthoringSignatureDeclarationInput,
): FunctionSignatureDeclaration {
  // GLOBAL_ONLY: deterministic declaration metadata; no reader lookup or host perform.
  const plan = dispatchEngineBody("engine:authoringSignatureIngressPlan", [
    input.parameterCount, input.inferResult,
  ]) as { params: readonly string[]; returns: string };
  const source = {
    $tag: "HostSpec" as const,
    module: input.ownerModule,
  };
  const decode = (slot: string): SlotDeclaration => {
    if (slot === "absent") return { $tag: "Absent" };
    if (slot === "authored") return { $tag: "Authored", source };
    throw new TypeError("Invalid authoring signature ingress marker");
  };
  return {
    functionId: input.functionId,
    declarationName: input.declarationName,
    codeName: input.codeName,
    params: plan.params.map(decode),
    returns: decode(plan.returns),
    scheme: input.scheme,
  };
}

export type AuthoringInferencePresentation = {
  readonly status: "solved" | "annotation-required" | "invalid";
  readonly label: string;
  readonly needsAnnotation: boolean;
  readonly invalid: boolean;
};

/** B3: transport the shipped verdict to its source-owned presentation. */
export function projectAuthoringInferenceOutcome(
  outcome: InferenceOutcome,
): AuthoringInferencePresentation {
  // GLOBAL_ONLY: deterministic verdict presentation; no reader lookup or host perform.
  return dispatchEngineBody("engine:authoringInferenceOutcomePlan", [outcome]) as AuthoringInferencePresentation;
}

/** B3 raw-expression transport to the source-owned completeness rule. The
 * existing JsonLogic boundary maps both absent and null slots to JlNull. */
export function authoringExpressionHasEmptySlot(logic: unknown): boolean {
  assertAcyclicAuthoringData(logic);
  // GLOBAL_ONLY: structural completeness of supplied data, no lookup/perform.
  const result = dispatchEngineBody("engine:authoringExpressionHasEmptySlot", [marshalStoredBodyForValidation(logic)]);
  if (typeof result !== "boolean") throw new TypeError("Invalid authoring completeness result");
  return result;
}

export function projectAuthoringFunctionSaveVerdict(
  inferResult: boolean,
  outcome: InferenceOutcome,
  resultCompatibility: "compatible" | "incompatible" | "unknown" = "unknown",
): {
  readonly invalid: boolean; readonly needsAnnotation: boolean;
} {
  // GLOBAL_ONLY: presentation of the captured mode, inference verdict and the
  // existing containment verdict supplied by the caller.
  return dispatchEngineBody("engine:authoringFunctionCheckedSaveVerdict", [inferResult, outcome, resultCompatibility]) as {
    invalid: boolean; needsAnnotation: boolean;
  };
}

/** B3: whether an authored result met the canonical equation's set-former
 * abstention, so Save must consult the existing containment verdict. */
export function authoringFunctionResultNeedsContainment(inferResult: boolean, outcome: InferenceOutcome): boolean {
  // GLOBAL_ONLY: source-owned policy over the captured mode and verdict.
  const result = dispatchEngineBody("engine:authoringFunctionResultNeedsContainment", [inferResult, outcome]);
  if (typeof result !== "boolean") throw new TypeError("Invalid authoring result-containment plan");
  return result;
}

/** B3: carry display names and descriptor-safe schemes to the source-owned
 * wording for an existing refusal. Unsupported metadata supplies no identity
 * explanation; it never turns an unknown relationship into a mismatch. */
export function authoringResultMismatchMessage(
  actualName: string,
  expectedName: string,
  actual?: TypeScheme,
  wanted?: TypeScheme,
): string {
  let captured: readonly [TypeScheme, TypeScheme] | undefined;
  if (actual !== undefined && wanted !== undefined) {
    try {
      captured = [snapshotAuthoringSchemeTransport(actual), snapshotAuthoringSchemeTransport(wanted)];
    } catch {
      // Dropping either unsupported carrier drops both: absent transport must
      // not be presented as evidence that one declaration identity is missing.
    }
  }
  // GLOBAL_ONLY: wording over captured data, with no lookup or host perform.
  return dispatchEngineBody("engine:authoringResultMismatchMessage", [actualName, expectedName,
    marshalStoredBodyForValidation(captured?.[0]), marshalStoredBodyForValidation(captured?.[1]),
  ]) as string;
}
