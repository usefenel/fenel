// C2/B3: seat an unchanged source body in the evaluator's existing closure
// carrier. Its canonical invoker restores lexical names/source ownership and
// keeps dispatch/authority in the live caller, without selecting a native root.
import { invokeCallable, type EvaluateContext } from "./json-logic";
import type { FenelFunction } from "./types";

export function invokeSelfHostSourceBody(
  fn: FenelFunction,
  args: readonly unknown[],
  context: EvaluateContext,
): unknown {
  if (fn.body === undefined) throw new Error(`Self-host oracle ${fn.id} has no source body`);
  const frame = context.getFunctionImportFrame?.(fn.id);
  return invokeCallable({
    __fenelFn: true,
    params: fn.params.map(param => param.name),
    body: fn.body,
    closure: context.getFunctionLexicalData?.(fn.id) ?? Object.create(null),
    ...(frame === undefined ? {} : { lexicalImports: [frame] }),
    sourceFunction: fn.id,
  }, [...args], context);
}
