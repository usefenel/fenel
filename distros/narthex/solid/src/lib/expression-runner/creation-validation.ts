import type { FenelFunction, FenelType, TypeScheme } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { EvaluateContext } from "@fenel/engine/expressions";
import { dispatchedDataExpressionValue } from "@fenel/engine/engine-bodies-dispatch";
import { authoringExpressionHasEmptySlot, authoringResultMismatchMessage, authoringSaveResultVerdict, authoringCreationFeedbackState } from "@fenel/engine/authoring/signature-authoring";
import { Nothing } from "@fenel/engine/type-foundation";
import { authoringBindingNameIssue } from "@fenel/engine/authoring/binding-edits";
import {
  expectedSchemeForType,
  judgeAuthoringSchemeCompatibility,
  judgeAuthoringTypeCompatibility,
  judgeAuthoringFunctionDraftSave,
  projectAuthoringScheme,
  type AuthoringEnvironment,
} from "@fenel/engine/authoring/environment";
import {
  exprNodeToLogic,
  typeDisplayName,
  type ExprNode,
  type RefResolver,
  type AuthoringInferenceContext,
} from "@fenel/engine/authoring/expression";
import { inferScopedAuthoringExpression, literalMembershipChecksFor, literalMembershipFor } from "./literal-membership";
import type { MembershipHints } from "@fenel/engine";
import { dataOfNode, NOT_DATA } from "./simple-data-form-model";

export type CreationValidation = { verdict: ReturnType<typeof authoringSaveResultVerdict>;
  state: MembershipHints["state"]; fields: { path: string; hints: MembershipHints }[]; issue?: string;
  /** The source's actual diagnostic location, for presentation only. */
  issueDiagnostic?: { code: string; path?: readonly string[] } };

/** Browser declaration adapter: the existing expression judge checks the body
 * in its parameter scope, retaining authoritative scheme projections. */
export function functionBodySaveIssue(
  node: ExprNode,
  declaration: FenelFunction,
  environment: AuthoringEnvironment & AuthoringInferenceContext,
  options: { registry?: ModuleRegistry; evaluateContext?: EvaluateContext } = {},
): string | undefined {
  const bindingIssue = authoringBindingNameIssue(node, options.evaluateContext);
  if (bindingIssue) return bindingIssue;
  if (declaration.signatureDeclaration !== undefined) {
    const logic = exprNodeToLogic(node, {
      fnCodeName: id => environment.functionCodeName(id) ?? id,
      recordFromEntriesTarget: () => environment.resolveFunctionId("std.fromEntries"),
      constructorName: id => environment.constructorCodeName(id),
      operatorCodeName: (_notation, call) => environment.operatorCodeName(call.aliasId, call.arity),
    });
    if (authoringExpressionHasEmptySlot(logic)) {
      return "Complete the empty value slots before saving. Choose a constructor for an absent value.";
    }
    const verdict = judgeAuthoringFunctionDraftSave({ ...declaration, body: logic as FenelFunction["body"] },
      declaration.signatureDeclaration, environment, { registry: options.registry });
    const inferred = verdict.inferred;
    const diagnostic = inferred.outcome.$tag === "Solved" ? undefined : inferred.outcome.diagnostics[0]?.message;
    if (verdict.resultMismatch !== undefined) {
      // The existing containment verdict refused an authored result that the
      // canonical equation could not decide; explain it as a result mismatch.
      const { actual, expected } = verdict.resultMismatch;
      return authoringResultMismatchMessage(typeDisplayName(actual.body, environment) ?? "a different type",
        typeDisplayName(expected.body, environment) ?? "the selected type", actual, expected);
    }
    if (verdict.invalid) return diagnostic ?? "Complete the expression before saving.";
    if (verdict.needsAnnotation) return `Add a result type to finish this function.${diagnostic ? ` ${diagnostic}` : ""}`;
    return undefined;
  }
  const entry = environment.getFunctionEntry?.(declaration.id);
  const scheme = entry?.signatureOutcome?.$tag === "Solved" ? entry.scheme : undefined;
  return draftSaveIssue(node, {
    ...environment,
    bindings: Object.fromEntries(declaration.params.map((param, index) => [param.name,
      (scheme && projectAuthoringScheme(scheme, ["$arrow", "params", String(index), "type"]))
        ?? expectedSchemeForType(param.type, environment) ?? param.type])),
  }, {
    ...options,
    expectedType: declaration.returns,
    expectedScheme: scheme ? projectAuthoringScheme(scheme, ["$arrow", "returns"]) : undefined,
  });
}

function containsEmptySlot(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child) => containsEmptySlot(child, seen));
}

/** Save the completed expression only after the shared inference boundary has
 * rejected known errors. An undecided type relationship is not a mismatch. */
export function draftSaveIssue(
  node: ExprNode,
  environment: AuthoringEnvironment & AuthoringInferenceContext,
  options: {
    expectedType?: FenelType;
    /** Projected declaration authority, including nominal and application sidecars. */
    expectedScheme?: TypeScheme;
    expectedTypeName?: string;
    /** Reader-projected display only; never compatibility evidence. */
    actualTypeName?: string;
    registry?: ModuleRegistry;
    resolveSavedExpr?: RefResolver;
    evaluatedValue?: unknown;
    evaluateContext?: EvaluateContext;
    /** Forward the existing source-owned result judgment; no issue is not a proof. */
    observeVerdict?: (verdict: ReturnType<typeof authoringSaveResultVerdict>) => void;
    observeInference?: (inferred: ReturnType<typeof inferScopedAuthoringExpression>) => void;
  } = {},
): string | undefined {
  const bindingIssue = authoringBindingNameIssue(node, options.evaluateContext);
  if (bindingIssue) return bindingIssue;
  const expectedType = options.expectedScheme?.body ?? options.expectedType;
  const expectedScheme = options.expectedScheme ?? expectedSchemeForType(expectedType, environment);
  const rootScheme = expectedScheme ?? (expectedType ? { quantified: [], body: expectedType } : undefined);
  const inferred = inferScopedAuthoringExpression(node, {
    ...environment,
    resolveSavedExpr: options.resolveSavedExpr,
    literalMembership: literalMembershipFor(environment, options),
  }, {
    expectedScheme: rootScheme,
    literalMembershipChecks: literalMembershipChecksFor(environment, options),
    ...(options.evaluateContext === undefined ? {} : { expressionData: (current: ExprNode) =>
      dispatchedDataExpressionValue(exprNodeToLogic(current, {
        fnCodeName: (id) => environment.functionCodeName(id) ?? id,
        recordFromEntriesTarget: () => environment.resolveFunctionId("std.fromEntries"),
        constructorName: (id) => environment.constructorCodeName(id),
        operatorCodeName: (_notation, call) => environment.operatorCodeName(call.aliasId, call.arity),
      }), options.evaluateContext!),
    }),
  });
  options.observeInference?.(inferred);
  if (inferred.outcome.$tag === "Invalid") {
    const diagnostic = inferred.outcome.diagnostics[0];
    if (expectedType && diagnostic?.code === "authoring.literal-membership"
      && diagnostic.path?.length === 1 && diagnostic.path[0] === "$expression") {
      // The source has already refused the whole result. Retain its verdict
      // while presenting the selected final target rather than an input label.
      const expected = options.expectedTypeName ?? typeDisplayName(expectedType, environment) ?? "the selected type";
      return authoringResultMismatchMessage(options.actualTypeName ?? "a different type", expected, inferred.scheme, rootScheme);
    }
    return diagnostic?.message ?? "Complete the expression before saving.";
  }
  const logic = exprNodeToLogic(node, {
    resolver: options.resolveSavedExpr,
    fnCodeName: (id) => environment.functionCodeName(id) ?? id,
    recordFromEntriesTarget: () => environment.resolveFunctionId("std.fromEntries"),
    constructorName: (id) => environment.constructorCodeName(id),
    operatorCodeName: (_notation, call) => environment.operatorCodeName(call.aliasId, call.arity),
  });
  if (containsEmptySlot(logic)) {
    return "Complete the empty value slots before saving. Choose a constructor for an absent value.";
  }
  if (expectedType && inferred.outcome.$tag === "Solved" && inferred.type) {
    const expected = expectedScheme ?? expectedType;
    const knownExpected = !("$ref" in expectedType) || expectedScheme !== undefined
      || environment.resolveTypeRef?.(expectedType) !== undefined
      || environment.resolveNamedType?.(expectedType.$ref) !== undefined;
    const compatibility = inferred.scheme && knownExpected
      ? judgeAuthoringSchemeCompatibility(inferred.scheme, expected, { registry: options.registry })
      : judgeAuthoringTypeCompatibility(inferred.type, expectedType, { registry: options.registry });
    const value = Object.hasOwn(options, "evaluatedValue") ? options.evaluatedValue
      : node.kind === "literal" && typeof node.value !== "object" ? node.value : undefined;
    let membership: ReturnType<typeof authoringSaveResultVerdict> = Nothing;
    if (Object.hasOwn(options, "evaluatedValue") || (value !== undefined && value !== null)) {
      try {
        membership = literalMembershipFor(environment, options)(value, rootScheme!);
      } catch {
        // Undecided membership does not replace the inference result.
      }
    }
    const verdict = authoringSaveResultVerdict(compatibility, membership);
    options.observeVerdict?.(verdict);
    if (verdict.$tag === "Just" && verdict._0 === false) {
      const expected = options.expectedTypeName ?? typeDisplayName(expectedType, environment) ?? "the selected type";
      const actual = options.actualTypeName ?? typeDisplayName(inferred.type, environment) ?? "a different type";
      return authoringResultMismatchMessage(actual, expected, inferred.scheme, rootScheme);
    }
  }
  return undefined;
}

/** Display projection of the same Save judgment and recursive validator. The
 * caller captures this answer with its draft/reader; submit still checks anew. */
export function draftSaveValidation(node: ExprNode, environment: AuthoringEnvironment & AuthoringInferenceContext,
  options: Parameters<typeof draftSaveIssue>[2] = {}): CreationValidation {
  let verdict: CreationValidation["verdict"] = Nothing;
  let inferred: ReturnType<typeof inferScopedAuthoringExpression> | undefined;
  const issue = draftSaveIssue(node, environment, { ...options,
    observeVerdict: result => { verdict = result; }, observeInference: result => { inferred = result; } });
  const target = options.expectedScheme ?? expectedSchemeForType(options.expectedType, environment)
    ?? (options.expectedType ? { quantified: [], body: options.expectedType } : inferred?.scheme);
  // Auto has no external requirement: the solved source is checked against
  // its own complete scheme by the existing compatibility judgment.
  if (!options.expectedType && !options.expectedScheme && inferred?.outcome.$tag === "Solved" && inferred.scheme) {
    verdict = authoringSaveResultVerdict(judgeAuthoringSchemeCompatibility(inferred.scheme, inferred.scheme,
      { registry: options.registry }), Nothing);
  }
  const fields: CreationValidation["fields"] = [];
  let incomplete = true;
  try {
    const logic = exprNodeToLogic(node, { resolver: options.resolveSavedExpr,
      fnCodeName: id => environment.functionCodeName(id) ?? id,
      recordFromEntriesTarget: () => environment.resolveFunctionId("std.fromEntries"),
      constructorName: id => environment.constructorCodeName(id),
      operatorCodeName: (_notation, call) => environment.operatorCodeName(call.aliasId, call.arity) });
    incomplete = authoringExpressionHasEmptySlot(logic);
    const concrete = options.evaluateContext === undefined ? undefined : dispatchedDataExpressionValue(logic, options.evaluateContext);
    const partial = concrete?.$tag === "Concrete" ? concrete.value : dataOfNode(node);
    const value = Object.hasOwn(options, "evaluatedValue") && options.evaluatedValue !== undefined
      ? options.evaluatedValue : partial === NOT_DATA ? undefined : partial;
    if (target && value !== undefined) literalMembershipFor(environment, { ...options,
      observeHints: (path, hints) => { fields.push({ path, hints }); } })(value, target);
  } catch { /* Unavailable feedback remains undecided. */ }
  const state = authoringCreationFeedbackState(verdict, incomplete, !!issue, fields.map(field => field.hints.state));
  const diagnostic = issue && inferred?.outcome.$tag === "Invalid" ? inferred.outcome.diagnostics[0] : undefined;
  return { verdict, state, fields, ...(issue === undefined ? {} : { issue }),
    ...(diagnostic ? { issueDiagnostic: { code: diagnostic.code, ...(diagnostic.path ? { path: [...diagnostic.path] } : {}) } } : {}) };
}
