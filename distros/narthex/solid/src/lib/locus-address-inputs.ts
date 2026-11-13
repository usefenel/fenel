// URI-to-editor transport for the existing typed Call form. Literal parsing
// and data extraction reuse the Fenel parser/codec; no input is evaluated.
import type { FieldDef } from "@fenel/engine/types";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import { parseFenel } from "@fenel/engine";
import { dispatchedDataExpressionValue } from "@fenel/engine/engine-bodies-dispatch";
import { emptyExpressionSlot, expressionForLiteralValue } from "./expression-runner/creation-seed";
import { inlineWidgetFor } from "./expression-runner/inline-widgets";
// B4 unit C: the DOM-free codec adapters (the editor barrel's `toLogic` and
// `logicToExprNode` delegate to the same two), so a Local reader's worker
// runs these functions unchanged.
import { authoringLogicToExprNode as logicToExprNode } from "./expression-runner/expression-text";
import { authoringExpressionLogic as toLogic } from "./expression-runner/expression-evaluation";
import { parseInput } from "@fenel/engine/input-layer";
import { itemFromText, transferPlainText } from "./data-transfer/data";
import { encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { expressionForTransfer } from "./data-transfer/expressions";
import { authoringExpressionSites } from "./expression-runner/expression-evaluation";

export type LocusAddressInput = { name: string; text: string };
export type LocusAddressInputRequest = { id: number; source: string; focus: import("./locus-scope").LocusScope; inputs: readonly LocusAddressInput[] };

export function decodeLocusAddressInputs(inputs: readonly LocusAddressInput[], params: readonly FieldDef[], session: AuthoringSession): {
  args: ExprNode[]; issues: string[];
} {
  const args = params.map(() => emptyExpressionSlot());
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const index = params.findIndex(param => param.name === input.name);
    if (index < 0) { issues.push(`There is no parameter named "${input.name}".`); continue; }
    if (seen.has(input.name)) { issues.push(`The address supplies "${input.name}" more than once.`); args[index] = emptyExpressionSlot(); continue; }
    seen.add(input.name);
    const param = params[index]!;
    try {
      const widget = inlineWidgetFor(param.type, undefined, session.environment);
      const scalar = widget?.scalarType;
      let value: unknown;
      if (scalar === "string") value = input.text;
      else if (scalar === "number") {
        const parsed = parseInput(input.text, widget!.type);
        if (!parsed.ok) throw new Error(parsed.error);
        value = parsed.value;
      }
      else {
        const imported = itemFromText(input.text);
        if (imported.source === "json") {
          const expression = expressionForTransfer({ ...imported, type: param.type }, session.environment,
            { registry: session.registry, evaluateContext: session.evaluateContext });
          // Import may construct known ADT data. The codec's own sites and
          // existing closed-data projection require the same reader's runtime
          // constructor evidence; no payload or field shape is guessed here.
          for (const site of authoringExpressionSites(expression, undefined, session).sites) {
            if (site.node.kind === "call" && session.environment.getFunctionEntry?.(site.node.fnId)?.kind === "constructor"
              && dispatchedDataExpressionValue(site.logic, session.evaluateContext).$tag !== "Concrete") {
              throw new Error("This reader cannot construct that literal data. Prepare its editing tools and try again.");
            }
          }
          args[index] = expression;
          continue;
        }
        else {
          const node = logicToExprNode(parseFenel(input.text), [], session);
          const decoded = dispatchedDataExpressionValue(toLogic(node, undefined, session), session.evaluateContext);
          if (decoded.$tag !== "Concrete") throw new Error("Use literal data; an address input cannot run an expression.");
          value = decoded.value;
        }
      }
      args[index] = expressionForLiteralValue(value, param.type, session.environment);
    } catch (error) {
      issues.push(`${input.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { args, issues };
}

/** The caller supplies the existing ExprNode codec and Fenel printer. A
 * non-data expression is omitted so refreshing cannot replay a stale input. */
export function encodeLocusAddressInputs(args: readonly ExprNode[], params: readonly FieldDef[], session: AuthoringSession,
  logic: (node: ExprNode) => unknown, print: (value: unknown) => string,
): { inputs: LocusAddressInput[]; omittedExpressions: boolean } {
  let omittedExpressions = false;
  const inputs = params.flatMap((param, index) => {
    const argument = args[index];
    if (!argument || argument.kind === "literal" && argument.value === undefined) return [];
    const wire = logic(argument);
    const decoded = dispatchedDataExpressionValue(wire, session.evaluateContext);
    if (decoded.$tag !== "Concrete") { omittedExpressions = true; return []; }
    const scalar = inlineWidgetFor(param.type, undefined, session.environment)?.scalarType;
    // Preserve the opaque Number carrier's signed zero at the URI boundary.
    // Its existing typed input parser already accepts this spelling.
    let text = scalar === "string" && typeof decoded.value === "string" ? decoded.value
      : scalar === "number" && Object.is(decoded.value, -0) ? "-0" : print(wire);
    if (decoded.value && typeof decoded.value === "object") {
      try {
        const transported = transferPlainText({ value: decoded.value, typeName: "Data", source: "fenel" });
        const recovered = itemFromText(transported);
        if (recovered.source === "json" && JSON.stringify(encodeCheckpointValue(recovered.value)) === JSON.stringify(encodeCheckpointValue(decoded.value))) text = transported;
      } catch { /* Keep the existing Fenel printer when JSON cannot preserve this data. */ }
      // A host data carrier is shared only if this same input/codec boundary
      // can recover it exactly. The ordinary printer may normalize a nested
      // opaque representation; omit instead of publishing different data.
      try {
        const restored = decodeLocusAddressInputs([{ name: param.name, text }], [param], session);
        const roundtrip = !restored.issues.length && restored.args[0]
          ? dispatchedDataExpressionValue(logic(restored.args[0]), session.evaluateContext) : undefined;
        if (!roundtrip || roundtrip.$tag !== "Concrete"
          || JSON.stringify(encodeCheckpointValue(roundtrip.value)) !== JSON.stringify(encodeCheckpointValue(decoded.value))) {
          omittedExpressions = true; return [];
        }
      } catch { omittedExpressions = true; return []; }
    }
    return [{ name: param.name, text }];
  });
  return { inputs, omittedExpressions };
}
