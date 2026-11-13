import { For, Match, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ExprNode } from "./expr-node-codec";
import type { FenelType, FieldDef, InferenceOutcome, TypeScheme } from "@fenel/engine/types";
import { LocusSelect } from "~/lib/locus-select";
import type { ExtendedExpressionForm, VariableForm, ApplyForm } from "./expression-structure";
export { detectExtendedExpressionForm, type ExtendedExpressionForm } from "./expression-structure";

const blank = (): ExprNode => ({ kind: "literal", value: undefined });

export function ExtendedExpressionEditor(props: {
  form: ExtendedExpressionForm;
  onChange: (marker: unknown) => void;
  readonly?: boolean;
  applicationParameters?: readonly FieldDef[];
  applicationType?: FenelType;
  applicationScheme?: TypeScheme;
  applicationParameterSchemes?: readonly (TypeScheme | undefined)[];
  listElementType?: FenelType;
  listElementScheme?: TypeScheme;
  listElementOutcome?: InferenceOutcome;
  resultType?: FenelType;
  resultScheme?: TypeScheme;
  resultOutcome?: InferenceOutcome;
  expression: (props: { value: ExprNode; label: string; type?: FenelType; scheme?: TypeScheme; outcome?: InferenceOutcome; onChange: (value: ExprNode) => void }) => JSX.Element;
  literal: (props: { value: unknown; label: string; onChange: (value: unknown) => void }) => JSX.Element;
  operators: readonly { op: string; label: string; operands?: readonly string[] }[];
}) {
  return <div class={`expr-form expr-form--${props.form.kind}`}>
    <Switch>
      <Match when={props.form.kind === "list" && props.form}>
        {(form) => <>
          <div class="expr-form__head">List</div>
          <ExpressionRows items={form().content} label="Item" expression={props.expression} readonly={props.readonly}
            type={props.listElementType} scheme={props.listElementScheme} outcome={props.listElementOutcome}
            onChange={(items) => props.onChange({ __list: items })} />
        </>}
      </Match>
      <Match when={props.form.kind === "lookup" && props.form}>
        {(form) => {
          const patch = (change: Partial<VariableForm>) => props.onChange({ __var: { ...form().content, ...change } });
          return <>
            <div class="expr-form__head">Look up a value</div>
            {props.literal({ get value() { return form().content.path; }, label: "Path",
              onChange: (path) => patch({ path, omittedPath: false }) })}
            <label class="expr-form__row">
              <input type="checkbox" aria-label="Use a default value" disabled={!!props.readonly}
                checked={Object.hasOwn(form().content, "fallback")}
                onChange={(event) => {
                  if (event.currentTarget.checked) patch({ fallback: null, arrayForm: true });
                  else {
                    const { fallback: _fallback, ...content } = form().content;
                    props.onChange({ __var: content });
                  }
                }} />
              Use a default value when the path is absent
            </label>
            <Show when={Object.hasOwn(form().content, "fallback")}>
              {props.literal({ get value() { return form().content.fallback; }, label: "Default value",
                onChange: (fallback) => patch({ fallback, arrayForm: true }) })}
            </Show>
          </>;
        }}
      </Match>
      <Match when={props.form.kind === "apply" && props.form}>
        {(form) => {
          const patch = (change: Partial<ApplyForm>) => props.onChange({ __apply: { ...form().content, ...change } });
          return <>
            <div class="expr-form__head">Apply a function value</div>
            {props.expression({ get value() { return form().content.target; }, label: "Function",
              get type() { return props.applicationType; },
              get scheme() { return props.applicationScheme; },
              onChange: (target) => patch({ target }) })}
            <Show when={form().content.syntax === "apply"} fallback={
              <ExpressionRows items={form().content.args} label="Argument" expression={props.expression} readonly={props.readonly}
                types={props.applicationParameters?.map(parameter => parameter.type)}
                schemes={props.applicationParameterSchemes}
                onChange={(args) => patch({ args })} />
            }>
              {props.expression({ get value() { return form().content.arguments ?? blank(); }, label: "Arguments list",
                onChange: (args) => patch({ arguments: args }) })}
            </Show>
          </>;
        }}
      </Match>
      <Match when={props.form.kind === "scope" && props.form}>
        {(form) => <>
          <div class="expr-form__head">With an instance</div>
          {props.expression({ get value() { return form().content.frame; }, label: "Instance",
            onChange: (frame) => props.onChange({ __withInstance: { ...form().content, frame } }) })}
          {props.expression({ get value() { return form().content.body; }, label: "Body",
            get type() { return props.resultType; }, get scheme() { return props.resultScheme; },
            get outcome() { return props.resultOutcome; },
            onChange: (body) => props.onChange({ __withInstance: { ...form().content, body } }) })}
        </>}
      </Match>
      <Match when={props.form.kind === "pipeline" && props.form}>
        {(form) => <>
          <div class="expr-form__head">Pipeline</div>
          {props.expression({ get value() { return form().content.value; }, label: "Input",
            onChange: (value) => props.onChange({ __pipe: { ...form().content, value } }) })}
          <ExpressionRows items={form().content.steps} label="Step" expression={props.expression} readonly={props.readonly}
            onChange={(steps) => props.onChange({ __pipe: { ...form().content, steps } })} />
        </>}
      </Match>
      <Match when={props.form.kind === "operation" && props.form}>
        {(form) => <>
          <div class="expr-form__head">Operation</div>
          <LocusSelect label="Operation" value={form().content.op} minWidth="120px" disabled={!!props.readonly}
            options={props.operators.map((entry) => ({ value: entry.op, label: entry.label }))}
            // An operator outside the offered list still labels the trigger.
            fallbackOption={{ value: form().content.op, label: form().content.op }}
            onChange={(op) => props.onChange({ __operator: { ...form().content, op } })} />
          <ExpressionRows items={form().content.args} label="Operand" expression={props.expression} readonly={props.readonly}
            labels={props.operators.find((entry) => entry.op === form().content.op)?.operands}
            onChange={(args) => props.onChange({ __operator: {
              ...form().content, args,
              ...(args.length !== 1 ? { scalarArgs: false } : {}),
            } })} />
        </>}
      </Match>
    </Switch>
  </div>;
}

function ExpressionRows(props: {
  items: ExprNode[];
  label: string;
  labels?: readonly string[];
  types?: readonly FenelType[];
  type?: FenelType;
  scheme?: TypeScheme;
  schemes?: readonly (TypeScheme | undefined)[];
  outcome?: InferenceOutcome;
  readonly?: boolean;
  expression: (props: { value: ExprNode; label: string; type?: FenelType; scheme?: TypeScheme; outcome?: InferenceOutcome; onChange: (value: ExprNode) => void }) => JSX.Element;
  onChange: (items: ExprNode[]) => void;
}) {
  function move(index: number, delta: number) {
    const items = props.items.slice();
    [items[index], items[index + delta]] = [items[index + delta]!, items[index]!];
    props.onChange(items);
  }
  return <div class="expr-form__rows">
    <For keyed={false} each={props.items}>{(item, index) => <div class="expr-form__row">
      <div class="expr-form__slot">{props.expression({
        get value() { return item(); },
        get label() { return props.labels?.[index] ?? `${props.label} ${index + 1}`; },
        get type() { return props.types?.[index] ?? props.type; },
        get scheme() { return props.schemes?.[index] ?? props.scheme; },
        get outcome() { return props.outcome; },
        onChange: (next) => props.onChange(props.items.map((value, i) => i === index ? next : value)),
      })}</div>
      <div class="expr-form__row-actions">
        <button type="button" class="expr-form__btn" data-tooltip={`Move ${props.label.toLowerCase()} up`}
          disabled={!!props.readonly || index === 0} onClick={() => move(index, -1)}>↑</button>
        <button type="button" class="expr-form__btn" data-tooltip={`Move ${props.label.toLowerCase()} down`}
          disabled={!!props.readonly || index === props.items.length - 1} onClick={() => move(index, 1)}>↓</button>
        <button type="button" class="expr-form__btn" data-tooltip={`Remove ${props.label.toLowerCase()}`}
          disabled={!!props.readonly} onClick={() => props.onChange(props.items.filter((_, i) => i !== index))}>×</button>
      </div>
    </div>}</For>
    <button type="button" class="expr-form__btn" disabled={!!props.readonly} onClick={() => props.onChange([...props.items, blank()])}>
      + {props.label.toLowerCase()}
    </button>
  </div>;
}
