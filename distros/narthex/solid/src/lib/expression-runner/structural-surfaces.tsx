import { For, Show, createSignal, createUniqueId, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { FenelType } from "@fenel/engine/types";
import type { ExprNode, WhereBinding } from "./expr-node-codec";
import { blankLocalBinding } from "./expression-structure";
import { ExpressionGraphArrow, useExpressionGraphPresentation } from "./expression-surfaces";
import { ifGraphEdges } from "./if-graph-geometry";
import { TypeContractType, type TypeContractOrigin } from "./type-contract";
import "../data-card.css";
import "./structural-surfaces.css";

/** The root expression keeps the titled section; a nested slot (a record
 * field, an argument) offers the same action as one small button, so a form
 * of several fields does not repeat a section per field. */
export function LocalBindingsEntry(props: { onAdd: () => void; compact?: boolean }) {
  return <Show when={!props.compact} fallback={<div class="expr-local-section expr-local-section--compact">
    <button type="button" class="expr-form__btn expr-local-section__add" onClick={props.onAdd}
      data-tooltip="Add a local binding to this expression">+ binding</button>
  </div>}>
    <div class="expr-local-section"><div class="expr-local-section__head">
      <span class="expr-local-section__title">local bindings</span>
      <button type="button" class="expr-form__btn" onClick={props.onAdd}
        data-tooltip="Add a local binding to this expression">add binding</button>
    </div></div>
  </Show>;
}

export type WhereExpressionDraft = { body: ExprNode; bindings: WhereBinding<ExprNode>[] };
export type WhereExpressionSlot = { value: ExprNode; index?: number; onChange: (next: ExprNode) => void };

/** Where's existing expression and identifier/expression pairs. Preparation
 * supplies lexical scopes and name diagnostics; both adapters share mutation.
 * A function reads as the same frame: its inputs are names without values
 * (the unknowns its body depends on), then its local names, body and result. */
export function WhereFormEditorSurface(props: WhereExpressionDraft & {
  onChange: (next: WhereExpressionDraft | ExprNode) => void;
  expression: (slot: WhereExpressionSlot) => JSX.Element;
  bindingName: (slot: { binding: WhereBinding<ExprNode>; index: number; readonly: boolean; onChange: (next: string) => void }) => JSX.Element;
  readonly?: boolean;
  graph?: boolean;
  caption?: string;
  /** A function read: one column (inputs, local names, body, result) on its own card. */
  kind?: "function";
  mainLabel?: string;
  inputs?: () => JSX.Element;
  result?: () => JSX.Element;
}) {
  const inheritedGraph = useExpressionGraphPresentation();
  const graph = () => props.graph ?? inheritedGraph();
  function update(index: number, patch: Partial<WhereBinding<ExprNode>>) {
    if (props.readonly) return;
    const bindings = props.bindings.slice();
    bindings[index] = { ...bindings[index]!, ...patch };
    props.onChange({ body: props.body, bindings });
  }
  function remove(index: number) {
    if (props.readonly) return;
    const bindings = props.bindings.slice();
    bindings.splice(index, 1);
    props.onChange(bindings.length ? { body: props.body, bindings } : props.body);
  }
  return <div class={["expr-form", "expr-form--where", "expr-form--local-bindings", { "expr-form--scope-graph": graph(), "expr-form--function": props.kind === "function" }]}
    data-expression-scope={graph() ? "true" : undefined} role="group" aria-label={props.caption ?? "Local scope"}>
    {/* A function read starts with its signature rows: no caption above them. */}
    <Show when={graph() && props.kind !== "function"}><div class="expr-scope__caption">{props.caption ?? "Local scope"}</div></Show>
    <div class="expr-form__rows">
    {props.inputs?.()}
    <div class="expr-local-main" role={props.mainLabel ? "group" : undefined} aria-label={props.mainLabel}>{props.expression({ get value() { return props.body; },
      onChange: body => { if (!props.readonly) props.onChange({ body, bindings: props.bindings }); } })}{props.result?.()}</div>
    <Show when={!props.inputs || props.bindings.length > 0 || !props.readonly}>
    <div class="expr-local-bindings">
    <div class="expr-local-bindings-head">
      <div class="expr-form__head expr-form__head--plain">{graph() ? "Local names" : "local bindings"}</div>
      <Show when={!props.readonly}><button type="button" class="expr-form__btn" data-tooltip="Add local binding"
        onClick={() => { if (!props.readonly) props.onChange({ body: props.body, bindings: [...props.bindings, blankLocalBinding(props.bindings)] }); }}>add binding</button></Show>
    </div>
    <For keyed={false} each={props.bindings}>{(binding, index) => <div class="expr-form__row">
      {props.bindingName({ get binding() { return binding(); }, index, get readonly() { return !!props.readonly; }, onChange: name => update(index, { name }) })}
      {/* A function read lists its local names as record rows (name, then its value). */}
      <Show when={props.kind !== "function"}><span class="expr-form__eq mono">=</span></Show>
      <div class="expr-form__slot">{props.expression({ get value() { return binding().expr; }, index,
        onChange: expr => update(index, { expr }) })}</div>
      <Show when={!props.readonly}><div class="expr-form__row-actions"><button type="button" class="expr-form__btn" data-tooltip="Remove this binding"
        aria-label={`Remove binding ${binding().name}`} onClick={() => remove(index)}>✕</button></div></Show>
    </div>}</For>
    </div>
    </Show>
  </div></div>;
}

/** Where a function's computation lands: the last arrow of its graph ends
 * here. A small data card (data-card.css) titled "Result", with the return
 * type in the cards' type face; with no settled type it is the title alone. */
export function FunctionResultCard(props: { type?: string; icon?: string; origin?: TypeContractOrigin }) {
  return <div class="data-card function-result-card" role="group" aria-label="Function result">
    <span class="data-card__header function-result-card__title">Result</span>
    <TypeContractType type={props.type} icon={props.icon} origin={props.origin} />
  </div>;
}

/** Fixed input-palette slots: the condition takes the first input's colour;
 * the branches take two further distinct slots (the green slot is skipped). */
const IF_CONDITION_COLOR = "var(--expr-graph-slot-0)";
const IF_TRUE_COLOR = "var(--expr-graph-slot-1)";
const IF_FALSE_COLOR = "var(--expr-graph-slot-3)";

/** `if` reads as a decision, not as an eager three-input call: the condition
 * flows into the one input dot above If, which selects one branch; under If,
 * one dot per branch sends an arrow into that branch. Only the selected
 * branch runs, and its value is the shared result. The dots, capsule and
 * arrows are the call graph's own (`expr-call__input-dot`,
 * `expr-graph-port-pill`, `ExpressionGraphArrow`). Adapters supply the
 * recursive slots. */
export function IfGraphSurface(props: {
  condition: () => JSX.Element;
  whenTrue: () => JSX.Element;
  whenFalse: () => JSX.Element;
  result?: () => JSX.Element;
}) {
  const id = `expression-if-${createUniqueId()}`;
  let root: HTMLDivElement | undefined;
  let condition: HTMLDivElement | undefined;
  let branches: HTMLDivElement | undefined;
  let trueBranch: HTMLDivElement | undefined;
  let falseBranch: HTMLDivElement | undefined;
  const dots: { condition?: HTMLElement; whenTrue?: HTMLElement; whenFalse?: HTMLElement } = {};
  const [layout, setLayout] = createSignal<ReturnType<typeof ifGraphEdges>>();
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  let frame: number | undefined;
  let alive = true;
  let painted = "";
  function measure() {
    if (!root?.isConnected || !condition || !branches || !trueBranch || !falseBranch
      || !dots.condition || !dots.whenTrue || !dots.whenFalse) return;
    const bounds = root.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const box = (rect: DOMRect) => ({ left: rect.left - bounds.left, right: rect.right - bounds.left,
      top: rect.top - bounds.top, bottom: rect.bottom - bounds.top });
    const dot = (element: HTMLElement) => {
      const rect = (element.querySelector<HTMLElement>(".expr-call__input-dot-core") ?? element).getBoundingClientRect();
      return { x: rect.left + rect.width / 2 - bounds.left, y: rect.top + rect.height / 2 - bounds.top, radius: Math.max(rect.width, rect.height) / 2 };
    };
    // A branch arrow lands on the top centre of the branch's own content, under its label.
    const branch = (element: HTMLElement) => {
      const outer = element.getBoundingClientRect();
      const content = element.querySelector<HTMLElement>(":scope > :not(.expr-if-graph__label)")?.getBoundingClientRect() ?? outer;
      return { ...box(outer), top: content.top - bounds.top };
    };
    const chip = conditionResult(condition, root);
    // A result card's type badge straddles its bottom border: leave below the badge.
    const badge = chip?.querySelector<HTMLElement>(":scope > .home-item__header")?.getBoundingClientRect();
    const chipBox = chip && box(chip.getBoundingClientRect());
    const next = ifGraphEdges({
      condition: chipBox ? { ...chipBox, bottom: Math.max(chipBox.bottom, badge ? badge.bottom - bounds.top : chipBox.bottom) }
        : box(condition.getBoundingClientRect()), straightCondition: !chip,
      conditionDot: dot(dots.condition), trueDot: dot(dots.whenTrue), falseDot: dot(dots.whenFalse),
      whenTrue: branch(trueBranch), whenFalse: branch(falseBranch),
      // Just outside the branches, so the lane never crosses the True branch's own cards.
      gutter: branches.getBoundingClientRect().right - bounds.left + 4,
    });
    const key = JSON.stringify([next, bounds.width, bounds.height]);
    if (key === painted) return;
    painted = key;
    setSize({ width: bounds.width, height: bounds.height });
    setLayout(next);
  }
  function refresh() {
    if (!alive || frame !== undefined) return;
    frame = requestAnimationFrame(() => { frame = undefined; if (alive) measure(); });
  }
  onSettled(() => {
    if (!root) return;
    const resize = new ResizeObserver(refresh);
    for (const element of [root, condition, branches, trueBranch, falseBranch]) if (element) resize.observe(element);
    // Nested graphs settle, move and pan inside the slots; arrow layers (this
    // one and the nested graphs') only repaint and never move a box.
    const mutations = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element
        && record.target.closest(".expr-call-graph__edges, .expr-call-graph__edge-labels, .expr-call-graph__edge-controls")))) refresh();
    });
    mutations.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    root.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    refresh();
    return () => {
      alive = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      resize.disconnect();
      mutations.disconnect();
      root?.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
    };
  });
  const port = (slot: keyof typeof dots, color: string, label: string) =>
    <span class="expr-call__input-dot expr-call__input-dot--connected expr-if-graph__port" ref={element => { dots[slot] = element; }}
      style={{ "--expr-input-color": color }} data-tooltip={label}><span class="expr-call__input-dot-core" aria-hidden="true" /></span>;
  return <div class="expr-if-graph" ref={root} role="group" aria-label="If" data-expression-scope="true">
    <svg class="expr-call-graph__edges expr-if-graph__edges" aria-hidden="true" width={size().width} height={size().height}>
      <Show when={layout()}>{current => <>
        <ExpressionGraphArrow id={`${id}-condition`} geometry={current().condition} color={IF_CONDITION_COLOR} />
        <ExpressionGraphArrow id={`${id}-true`} geometry={current().whenTrue} color={IF_TRUE_COLOR} />
        <ExpressionGraphArrow id={`${id}-false`} geometry={current().whenFalse} color={IF_FALSE_COLOR} />
      </>}</Show>
    </svg>
    <div class="expr-if-graph__condition" ref={condition} role="group" aria-label="Condition">{props.condition()}</div>
    <div class="expr-if-graph__node">
      <span class="expr-graph-port-pill expr-if-graph__ports">{port("condition", IF_CONDITION_COLOR, "Condition")}</span>
      <div class="expr-if-graph__decision" data-tooltip="Runs only the branch its condition selects">If</div>
      <span class="expr-graph-port-pill expr-if-graph__ports expr-if-graph__ports--branches">
        {port("whenTrue", IF_TRUE_COLOR, "When true")}{port("whenFalse", IF_FALSE_COLOR, "When false")}</span>
    </div>
    <div class="expr-if-graph__branches" ref={branches}>
      <div class="expr-if-graph__branch" ref={trueBranch} role="group" aria-label="When true">
        <div class="expr-if-graph__label" data-side={layout()?.trueLabelSide ?? "start"}>True</div>{props.whenTrue()}</div>
      <div class="expr-if-graph__branch" ref={falseBranch} role="group" aria-label="When false">
        <div class="expr-if-graph__label" data-side={layout()?.falseLabelSide ?? "end"}>False</div>{props.whenFalse()}</div>
    </div>
    <Show when={props.result}><div class="expr-if-graph__result">{props.result?.()}</div></Show>
  </div>;
}

/** The condition's own result chip (its root call graph's result), never one
 * inside an If nested in the condition. */
function conditionResult(condition: HTMLElement, root: HTMLElement): HTMLElement | undefined {
  for (const graph of condition.querySelectorAll<HTMLElement>(".expr-call-graph--root")) {
    if (graph.closest(".expr-if-graph") !== root) continue;
    const result = graph.querySelector<HTMLElement>(":scope > .expr-call-graph__stage > .expr-call-graph__result");
    const card = result?.querySelector<HTMLElement>(".home-item") ?? result;
    if (card && card.getBoundingClientRect().height > 0) return card;
    return undefined;
  }
  return undefined;
}

export type RecordFieldSlot = { field: { name: string; value: ExprNode }; index: number };

/** Named construction keeps the same field rows in prepared authoring and
 * held inspection; the owner supplies the constructor and its typed slots. */
export function ConstructFormEditorSurface(props: {
  fields: { name: string; value: ExprNode }[];
  tag: () => JSX.Element;
  fieldName: (slot: RecordFieldSlot) => JSX.Element;
  expression: (slot: RecordFieldSlot) => JSX.Element;
  picking?: boolean;
  picker?: () => JSX.Element;
  onAdd?: () => void;
  onRemove?: (index: number) => void;
  addDisabled?: boolean;
  addTooltip?: string;
  readonly?: boolean;
}) {
  return <div class="expr-construct">
    <Show when={!props.picking} fallback={props.picker?.()}>
      <div class="expr-construct__head">
        {props.tag()}
        <Show when={!props.readonly}><button type="button" class="expr-form__btn"
          onClick={() => props.onAdd?.()} disabled={!props.onAdd || !!props.addDisabled}
          data-tooltip={props.addTooltip}>+ field</button></Show>
      </div>
      <Show when={props.fields.length > 0}>
        <div class="expr-construct__fields">
          {/* Rows are positional: a value edit replaces its field object, and
              an identity-keyed row would remount its editor on every keystroke. */}
          <For each={props.fields} keyed={false}>{(field, index) => <div class="expr-construct__field">
            {props.fieldName({ get field() { return field(); }, index })}
            <span class="expr-form__eq mono">=</span>
            <div class="expr-form__slot">{props.expression({ get field() { return field(); }, index })}</div>
            <Show when={!props.readonly}><button type="button" class="expr-form__btn"
              onClick={() => props.onRemove?.(index)} data-tooltip="Remove field">✕</button></Show>
          </div>}</For>
        </div>
      </Show>
    </Show>
  </div>;
}

export type LetBindingSlot = {
  binding: { name: string; type?: FenelType; expr: ExprNode };
  index: number;
};

/** Binding positions retain their recursive owners while names and values
 * change; prepared slots alone provide lexical scope and trace metadata. */
export function LetBindingsFormEditorSurface(props: {
  bindings: { name: string; type?: FenelType; expr: ExprNode }[];
  bindingName: (slot: LetBindingSlot) => JSX.Element;
  expression: (slot: LetBindingSlot) => JSX.Element;
  onAdd?: () => void;
  onRemove?: (index: number) => void;
  readonly?: boolean;
}) {
  return <div class="expr-form expr-form--let">
    <div class="expr-local-bindings-head">
      <div class="expr-form__head expr-form__head--plain">local bindings</div>
      <Show when={!props.readonly}><button type="button" class="expr-form__btn"
        onClick={() => props.onAdd?.()} data-tooltip="Add local binding">add binding</button></Show>
    </div>
    <div class="expr-form__rows">
      <For keyed={false} each={props.bindings}>{(binding, index) => <div class="expr-form__row">
        <div class="expr-form__binding-col">{props.bindingName({ get binding() { return binding(); }, index })}</div>
        <span class="expr-form__eq mono">=</span>
        <div class="expr-form__slot">{props.expression({ get binding() { return binding(); }, index })}</div>
        <Show when={!props.readonly}><div class="expr-form__row-actions">
          <Show when={props.bindings.length > 1}><button type="button" class="expr-form__btn"
            onClick={() => props.onRemove?.(index)} data-tooltip="Remove this binding">✕</button></Show>
        </div></Show>
      </div>}</For>
    </div>
  </div>;
}

export type MatchArmSlot = { arm: { pattern: unknown; body: ExprNode }; index: number };

/** Match syntax shares its rows without acquiring the prepared pattern
 * editor's inference, constructor picker or arm-binding environment. */
export function MatchFormEditorSurface(props: {
  arms: { pattern: unknown; body: ExprNode }[];
  scrutinee: () => JSX.Element;
  pattern: (slot: MatchArmSlot) => JSX.Element;
  body: (slot: MatchArmSlot) => JSX.Element;
  onAddAfter?: (index: number) => void;
  onRemove?: (index: number) => void;
  readonly?: boolean;
}) {
  return <div class="expr-form expr-form--match">
    <div class="expr-form__row">
      <span class="expr-form__head mono">match</span>
      <div class="expr-form__slot">{props.scrutinee()}</div>
    </div>
    <div class="expr-form__rows">
      <For each={props.arms}>{(arm, index) => <div class="expr-form__row expr-form__row--arm">
        <span class="expr-form__head mono">|</span>
        <div class="expr-form__pattern-slot">{props.pattern({ arm, get index() { return index(); } })}</div>
        <span class="expr-form__arrow mono">→</span>
        <div class="expr-form__slot">{props.body({ arm, get index() { return index(); } })}</div>
        <Show when={!props.readonly}><div class="expr-form__row-actions">
          <button type="button" class="expr-form__btn" onClick={() => props.onAddAfter?.(index())}
            data-tooltip="Add arm below">+ below</button>
          <Show when={props.arms.length > 1}><button type="button" class="expr-form__btn"
            onClick={() => props.onRemove?.(index())} data-tooltip="Remove this arm">✕</button></Show>
        </div></Show>
      </div>}</For>
    </div>
  </div>;
}

export interface RecordValueEditorSurfaceProps {
  fields: { name: string; value: ExprNode }[];
  fieldName: (slot: RecordFieldSlot) => JSX.Element;
  expression: (slot: RecordFieldSlot) => JSX.Element;
  onAdd?: () => void;
  onRemove?: (index: number) => void;
  addDisabled?: boolean;
  addTooltip?: string;
  readonly?: boolean;
}

/** RecordValueEditor's existing DOM. The semantic editor owns field-name
 * choices, recursive slots and mutation; held inspection supplies inert slots. */
export function RecordValueEditorSurface(props: RecordValueEditorSurfaceProps) {
  return (
    <div class="expr-record">
      <div class="expr-record__head">
        <span class="text-muted mono" style="font-size: 0.78rem">record</span>
        <button
          type="button"
          class="expr-form__btn"
          onClick={() => props.onAdd?.()}
          disabled={!!props.readonly || !props.onAdd || !!props.addDisabled}
          data-tooltip={props.addTooltip}
        >+ field</button>
      </div>
      <Show when={props.fields.length > 0}>
        <div class="expr-record__fields">
          {/* Positional rows, as for constructor fields: a value edit keeps
              the row and its mounted editor. */}
          <For each={props.fields} keyed={false}>
            {(field, i) => (
              <div class="expr-record__field">
                {props.fieldName({ get field() { return field(); }, index: i })}
                <span class="expr-form__eq mono">=</span>
                <div class="expr-form__slot">
                  {props.expression({ get field() { return field(); }, index: i })}
                </div>
                <button
                  type="button"
                  class="expr-form__btn"
                  onClick={() => props.onRemove?.(i)}
                  disabled={!!props.readonly || !props.onRemove}
                  data-tooltip="Remove field"
                >✕</button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export type LambdaParameterSlot = { name: string; index: number };

export interface LambdaFormEditorSurfaceProps {
  title?: string;
  params?: string[];
  parameter?: (slot: LambdaParameterSlot) => JSX.Element;
  parameterType?: (slot: LambdaParameterSlot) => JSX.Element;
  parameterList?: () => JSX.Element;
  result?: () => JSX.Element;
  requirements?: () => JSX.Element;
  details?: () => JSX.Element;
  diagnostics?: () => JSX.Element;
  body: () => JSX.Element;
  onAdd?: () => void;
  onRemove?: (index: number) => void;
  readonly?: boolean;
}

/** Shared function presentation. Each adapter retains its signature, lexical
 * scope and recursive body owner; these slots never create another draft. */
export function LambdaFormEditorSurface(props: LambdaFormEditorSurfaceProps) {
  return (
    <div class="expr-form expr-form--lambda function-editor-surface">
      <div class="expr-form__head">{props.title ?? "Function"}</div>
      <section class="function-editor-surface__parameters" aria-label="Function parameters">
        <div class="function-editor-surface__label">Parameters</div>
        <Show when={!!props.parameterList} fallback={<div class="expr-lambda__params">
        <For each={props.params ?? []} keyed={false}>
          {(name, i) => (
            <span class="expr-lambda__param">
              {props.parameter?.({ get name() { return name(); }, index: i })}
              {props.parameterType?.({ get name() { return name(); }, index: i })}
              <Show when={props.onRemove}><button
                type="button"
                class="expr-form__btn"
                onClick={() => props.onRemove?.(i)}
                disabled={!!props.readonly || !props.onRemove}
                data-tooltip="Remove parameter"
                aria-label={`Remove parameter ${name()}`}
              >×</button></Show>
            </span>
          )}
        </For>
        <Show when={props.onAdd}><button type="button" class="expr-form__btn" onClick={() => props.onAdd?.()}
          disabled={!!props.readonly}>+ parameter</button></Show>
        <Show when={!props.params?.length && !props.onAdd}><span class="text-muted">No parameters</span></Show>
        </div>}>{props.parameterList?.()}</Show>
      </section>
      <Show when={props.result}><section class="function-editor-surface__result" aria-label="Function result">
        <div class="function-editor-surface__label">Result</div>
        {props.result?.()}
      </section></Show>
      <Show when={props.requirements}><section class="function-editor-surface__requirements" aria-label="Function requirements">
        <div class="function-editor-surface__label">Requirements</div>
        {props.requirements?.()}
      </section></Show>
      {props.diagnostics?.()}
      <section class="function-editor-surface__body" aria-label="Function body">
        <div class="function-editor-surface__label">Body</div>
        {props.body()}
      </section>
      <Show when={props.details}><details class="function-editor-surface__details">
        <summary>Details</summary>
        {props.details?.()}
      </details></Show>
    </div>
  );
}
