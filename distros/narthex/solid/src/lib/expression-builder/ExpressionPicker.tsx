import { Show, createMemo, createSignal, useContext } from "solid-js";
import type { Expression } from "@fenel/engine/types";
import {
  ExpressionEditor, LambdaParamsContext, SavedValuesContext,
  expandParamPaths, logicToExprNode, toLogic, type ExprNode,
} from "../expression-runner";
import { useAuthoringSession } from "../expression-runner/authoring-session";
import type { VariableHint } from "./ConditionBuilder";

export type ExpressionPickerProps = {
  value: Expression | unknown;
  onChange: (value: Expression | unknown) => void;
  variables?: VariableHint[];
  inline?: boolean;
};

/** Compatibility entry point for expression-valued fields. The former picker
 * implemented a second, incomplete expression language. All callers now use
 * the canonical editor and its engine codec, including view predicates and the
 * function creation form. Mounting never rewrites an existing expression. */
export function ExpressionPicker(props: ExpressionPickerProps) {
  const session = useAuthoringSession();
  const inherited = useContext(LambdaParamsContext);
  const saved = useContext(SavedValuesContext);
  const params = createMemo(() => expandParamPaths([
    ...inherited(),
    ...(props.variables ?? []).map((variable) => ({
      name: variable.name,
      type: variable.type ?? { $ref: "Value" } as const,
    })),
  ], session));
  const parsed = createMemo(() => logicToExprNode(props.value, params().map((param) => param.name), session));
  const [draft, setDraft] = createSignal<{ source: unknown; node: ExprNode; error?: string }>();
  const current = () => draft()?.source === props.value ? draft() : undefined;
  function change(node: ExprNode) {
    try {
      const value = toLogic(node, saved ? (id) => saved.byId(id)?.expr : undefined, session);
      props.onChange(value);
      setDraft({ source: value, node });
    } catch (error) {
      setDraft({ source: props.value, node, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return <div class={["expression-picker", { "expression-picker--inline": !!(props.inline) }]}>
    <LambdaParamsContext value={params}>
      <ExpressionEditor expr={current()?.node ?? parsed()} onChange={change} authoringSession={session} />
    </LambdaParamsContext>
    <Show when={current()?.error}>{(error) => <p class="sev-err" role="alert">{error()}</p>}</Show>
  </div>;
}
