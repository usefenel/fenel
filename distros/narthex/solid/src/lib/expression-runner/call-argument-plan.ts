import type { TypeScheme } from "@fenel/engine/types";
import {
  inferAuthoringCallGuidance,
  inferAuthoringExpressionWithLiteralWitnesses,
  type AuthoringCallGuidance,
  type AuthoringExpectedType,
  type AuthoringCatalogFunctionEntry,
} from "@fenel/engine/authoring/environment";
import type { AuthoringInferenceContext, ExprNode } from "./expr-node-codec";

type CallNode = Extract<ExprNode, { kind: "call" }>;

/** Each supplied argument belongs to a declared arrow. Additional stages are
 * admitted only when the kernel proves the applied prefix returns a callable.
 * A constructor's fields never grow from the number of supplied arguments. */
export function callArgumentPlan(
  node: CallNode,
  entry: AuthoringCatalogFunctionEntry,
  expected: AuthoringExpectedType | undefined,
  context: AuthoringInferenceContext,
): AuthoringCallGuidance {
  const first = inferAuthoringCallGuidance(entry, node.args, expected, context);
  if (entry.kind === "constructor" || node.args.length <= first.params.length) return first;
  const params = [...first.params];
  const paramSchemes = [...first.paramSchemes];
  let outcome = first.outcome;
  while (params.length < node.args.length) {
    const applied = inferAuthoringExpressionWithLiteralWitnesses({ ...node, args: node.args.slice(0, params.length) }, context);
    if (applied.outcome.$tag !== "Solved" || !applied.scheme || !("$arrow" in applied.scheme.body)) break;
    const arrow = applied.scheme.body.$arrow;
    if (arrow.params.length === 0) break;
    const tail = inferAuthoringCallGuidance({
      id: "<returned-function>", kind: "function", params: arrow.params,
      returns: arrow.returns, scheme: applied.scheme, signatureOutcome: applied.outcome,
    }, node.args.slice(params.length), expected, context);
    params.push(...tail.params);
    paramSchemes.push(...tail.paramSchemes);
    outcome = tail.outcome;
  }
  return { params, paramSchemes, outcome };
}

export function nextReturnedFunctionParameter(
  entry: AuthoringCatalogFunctionEntry | undefined,
  supplied: number,
  declared: number,
  resultScheme: TypeScheme | undefined,
) {
  if (!entry || entry.kind === "constructor" || supplied < declared || !resultScheme || !("$arrow" in resultScheme.body)) return undefined;
  return resultScheme.body.$arrow.params[0];
}
