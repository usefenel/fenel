// B4 slice 2: the editor's result judgment, moved verbatim out of the
// expression editor component so the page (Account and public readers) and a
// Local reader's worker (`infer-expression`) run the same code. No new rule:
// inference, the existing scheme/type compatibility deciders and the existing
// save-issue message, composed exactly as the editor composed them.
import { judgeAuthoringSchemeCompatibility, judgeAuthoringTypeCompatibility } from "@fenel/engine/authoring/environment";
import { projectAuthoringGraphEdgeIssue } from "@fenel/engine/authoring/binding-edits";
import { fieldTypeLabelPlan } from "@fenel/engine/authoring/field-render";
import type { FenelType, TypeScheme } from "@fenel/engine/types";
import type { AuthoringSession } from "./account-authoring-session";
import { draftSaveIssue } from "./creation-validation";
import { EVALUATOR_STRATEGIES, typeDisplayName, type AuthoringInferenceResult, type ExprNode } from "./expr-node-codec";
import { detectStructuralForm } from "./expression-structure";
import { measureAuthoringWork } from "./performance-diagnostics";

export type AuthoringResultJudgment = {
  mismatch: boolean;
  message: string | undefined;
  graphIssue: ReturnType<typeof projectAuthoringGraphEdgeIssue>;
};

/** The existing result judgment of one expression against one requirement:
 * inference, the scheme/type compatibility deciders and the save-issue
 * message. Only the verdict's presentation is shared by its callers. */
export function judgeAuthoringResult(node: ExprNode, expected: FenelType, scheme: TypeScheme | undefined, label: string,
  result: AuthoringInferenceResult, session: Pick<AuthoringSession, "environment" | "registry" | "evaluateContext">): AuthoringResultJudgment {
  const expectedHasAuthority = scheme !== undefined || !("$ref" in expected)
    || session.environment.resolveTypeRef?.(expected) !== undefined
    || session.environment.resolveNamedType?.(expected.$ref) !== undefined;
  const compatibility = result.scheme && expectedHasAuthority
    ? measureAuthoringWork("result compatibility", () => judgeAuthoringSchemeCompatibility(result.scheme!, scheme ?? expected, { registry: session.registry }))
    : result.type ? judgeAuthoringTypeCompatibility(result.type, expected, { registry: session.registry }) : "unknown";
  const mismatchMessage = result.type && compatibility === "incompatible"
    ? draftSaveIssue(node, session.environment, {
      expectedType: expected, expectedScheme: scheme,
      expectedTypeName: label,
      actualTypeName: result.type ? typeDisplayName(result.type, session.environment) ?? fieldTypeLabelPlan(result.type) : undefined,
      registry: session.registry, evaluateContext: session.evaluateContext,
      ...(node.kind === "literal" && !detectStructuralForm(node.value, strategy => strategy in EVALUATOR_STRATEGIES)
        ? { evaluatedValue: node.value } : {}),
    }) : undefined;
  const graphIssue = projectAuthoringGraphEdgeIssue(mismatchMessage ? "incompatible" : "unknown", result.outcome, mismatchMessage ?? "");
  if (mismatchMessage) return { mismatch: true, message: mismatchMessage, graphIssue };
  if (result.outcome.$tag === "Invalid") {
    return { mismatch: true, message: result.outcome.diagnostics[0]?.message ?? `Complete or correct this expression to produce ${label}.`, graphIssue };
  }
  return { mismatch: false, message: undefined, graphIssue };
}
