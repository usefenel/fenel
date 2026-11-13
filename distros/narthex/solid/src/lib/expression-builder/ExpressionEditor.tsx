import { Show, createSignal } from "solid-js";
import type { Expression } from "@fenel/engine/types";
import type { LeafRenderProps, VariableHint } from "./ConditionBuilder";
import { ExpressionPicker } from "./ExpressionPicker";

export type ExpressionEditorProps = {
  value: Expression | undefined;
  onChange: (expression: Expression | undefined) => void;
  label?: string;
  compact?: boolean;
  /** @deprecated Use ConditionBuilder directly for condition-tree leaves. */
  renderLeaf?: (props: LeafRenderProps) => unknown;
  /** @deprecated Expression values use the canonical expression editor. */
  createBlank?: () => unknown;
  variables?: VariableHint[];
};

/** Optional-expression chrome over the one expression authoring surface. */
export function ExpressionEditor(props: ExpressionEditorProps) {
  const [open, setOpen] = createSignal(false);
  return <div class="fe-expr-editor">
    <Show when={props.compact} fallback={<Show when={props.label}><div class="fe-expr-label">{props.label}</div></Show>}>
      <button type="button" class="fe-btn-add fe-btn-add--sm" aria-expanded={open() ? "true" : "false"} onClick={() => setOpen(!open())}>
        {props.label ?? "Condition"}{props.value !== undefined ? " (set)" : ""}
      </button>
    </Show>
    <Show when={!props.compact || open()}>
      <Show when={props.value !== undefined} fallback={
        <button type="button" class="fe-btn-add fe-btn-add--sm" onClick={() => props.onChange({ do: [true] })}>
          + Add condition
        </button>
      }>
        <ExpressionPicker value={props.value} variables={props.variables} inline
          onChange={(value) => props.onChange(value as Expression)} />
        <button type="button" class="fe-btn-danger-sm" onClick={() => props.onChange(undefined)}>Clear condition</button>
      </Show>
    </Show>
  </div>;
}
