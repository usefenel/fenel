import { Show, createMemo, createSignal } from "solid-js";
import type { Expression, FenelType } from "@fenel/engine/types";
import { deepEqual } from "@fenel/engine";
import {
  ExpressionEditor,
  LambdaParamsContext,
  SavedValuesContext,
  expandParamPaths,
  logicToExprNode,
  toLogic,
  type ExprNode,
} from "~/lib/expression-runner";
import { useAuthoringSession } from "~/lib/expression-runner/authoring-session";

function predicateExpression(value: unknown): Expression {
  // SeWhere's wire payload is an Expression object. A single-statement
  // block carries literal results through that existing representation.
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Expression : { do: [value] };
}

/** A predicate is an ordinary expression. This leaf only supplies its input
 * scope and bridges the existing editor codec to the SetExpr payload. */
export function WherePredicate(props: {
  pred: Expression;
  baseType: FenelType;
  onChange: (pred: Expression) => void;
}) {
  function publish(value: unknown) {
    props.onChange(predicateExpression(value));
  }
  // Context consumers capture their parameter array when mounted. Recreate
  // that editor scope when the refined input type changes.
  return <Show when={props.baseType} keyed>{(baseType) =>
    <PredicateEditor pred={props.pred} baseType={baseType} onChange={publish} />
  }</Show>;
}

function PredicateEditor(props: {
  pred: Expression;
  baseType: FenelType;
  onChange: (pred: Expression) => void;
}) {
  const session = useAuthoringSession();
  const params = createMemo(() => expandParamPaths([
    { name: "value", type: props.baseType },
  ], session));
  const parsed = createMemo<ExprNode>(() => typeof props.pred === "boolean"
    ? { kind: "literal", value: props.pred }
    : logicToExprNode(props.pred, params().map((p) => p.name), session));
  const lossless = createMemo(() => {
    try { return deepEqual(toLogic(parsed(), undefined, session), props.pred); }
    catch { return false; }
  });
  // Keep an incomplete edit visible when serialization refuses it. A changed
  // external predicate supersedes that draft; mounting never publishes an edit.
  const [draft, setDraft] = createSignal<{ source: Expression; node: ExprNode; error?: string }>();
  const currentDraft = () => draft()?.source === props.pred ? draft() : undefined;
  function change(node: ExprNode) {
    try {
      const pred = predicateExpression(toLogic(node, undefined, session));
      props.onChange(pred);
      setDraft({ source: pred, node });
    } catch (error) {
      setDraft({ source: props.pred, node, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return (
    <div class="sev-where">
      <p class="sev-hint">Use <code>value</code> for the value being checked. The predicate should return a Boolean.</p>
      <Show when={currentDraft() !== undefined || lossless()} fallback={<PredicateJsonLens pred={props.pred} onChange={props.onChange} />}>
      <LambdaParamsContext value={params}>
        {/* Saved canvas references cannot be stored in a type definition. */}
        <SavedValuesContext value={null}>
          <ExpressionEditor
            expr={currentDraft()?.node ?? parsed()}
            onChange={change}
            typeName="Boolean"
            paramName="predicate"
            authoringSession={session}
          />
        </SavedValuesContext>
      </LambdaParamsContext>
      </Show>
      <Show when={currentDraft()?.error}>
        <div class="sev-err" role="alert">{currentDraft()?.error}</div>
      </Show>
    </div>
  );
}

/** Preserve expressions that the shared visual codec cannot yet represent
 * exactly (for example a variable lookup with a default value). */
function PredicateJsonLens(props: { pred: Expression; onChange: (pred: Expression) => void }) {
  const source = createMemo(() => JSON.stringify(props.pred, null, 2));
  const [draft, setDraft] = createSignal<{ source: string; text: string }>();
  const [error, setError] = createSignal<string>();
  const text = () => draft()?.source === source() ? draft()!.text : source();
  function apply() {
    if (text() === source()) return;
    try {
      props.onChange(JSON.parse(text()) as Expression);
      setDraft(undefined);
      setError(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  return <div class="sev-predicate-json">
    <p class="sev-hint">Edit this expression as JSON to preserve all its details.</p>
    <textarea class="sev-text-field" aria-label="Predicate JSON" rows={6} spellcheck={false}
      value={text()} onInput={(event) => { setDraft({ source: source(), text: event.currentTarget.value }); setError(undefined); }} />
    <button type="button" class="sev-add" onClick={apply}>Apply JSON</button>
    <Show when={error()}><div class="sev-err" role="alert">{error()}</div></Show>
  </div>;
}
