import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { IconByName } from "./icons";
import { CollectionPreviewStrip, ValueTypeCaption, useValueCardInline } from "./value-card";
import { ValueHoverPreview } from "./value-hover-preview";
import "./function-card-body.css";

/** The owning reader supplies admitted types and their scoped presentation. */
export type FunctionCardType<T = unknown> = {
  type: T;
  label: string;
  icon?: string;
  ownIcon?: string;
  ownEmoji?: string;
  term?: string;
};

/** Layout only: no signature inference, representation lookup or invocation.
 * An output uses index -1; input indices retain their declaration order. */
export function FunctionCardBody<T>(props: {
  inputs: readonly FunctionCardType<T>[];
  output: FunctionCardType<T>;
  renderType?: (entry: FunctionCardType<T>) => JSX.Element;
  previewType: (entry: FunctionCardType<T>, index: number) => JSX.Element;
  onOpenType: (entry: FunctionCardType<T>, index: number) => void;
  onOpenInputs: () => void;
}) {
  const inline = useValueCardInline();
  const typeLine = (entry: FunctionCardType<T>) => <Show when={props.renderType} fallback={
    <ValueTypeCaption label={entry.label} icon={entry.icon} />
  }>{render => render()(entry)}</Show>;
  return <div class={["function-card-body", { "function-card-body--inline": inline() }]}>
    <div class="function-card-body__inputs" aria-label="Input types">
      <Show when={props.inputs.length > 0} fallback={<span class="function-card-body__empty">No inputs</span>}>
        <Show when={inline() || props.inputs.length === 1} fallback={
        <CollectionPreviewStrip items={props.inputs} label="Input types"
          countLabel={`${props.inputs.length} ${props.inputs.length === 1 ? "input" : "inputs"}`}
          itemLabel={entry => entry.label}
          render={entry => <Show when={entry.icon} fallback={<span class="function-card-body__input-label" data-tooltip={entry.term ?? entry.label}>{entry.label}</span>}>
            <span class="function-card-body__input-icon" aria-hidden="true"><IconByName name={entry.icon} size={16} /></span>
          </Show>}
          preview={(entry, index) => props.previewType(entry, index)}
          onOpenItem={(entry, index) => props.onOpenType(entry, index)}
          onEnterCollection={props.onOpenInputs} />
        }>
          <span class="function-card-body__input-types"><For each={props.inputs}>{(entry, index) => <>
            <Show when={index() > 0}><span class="function-card-body__comma">, </span></Show>
            <ValueHoverPreview class="function-card-body__input-type" label={entry.label}
              preview={() => props.previewType(entry, index())} onOpen={() => props.onOpenType(entry, index())}>
              <span class="function-card-body__type-line">{typeLine(entry)}</span>
            </ValueHoverPreview>
          </>}</For></span>
        </Show>
      </Show>
    </div>
    <span class="function-card-body__arrow" aria-hidden="true"><IconByName name={inline() ? "arrow-right" : "arrow-down"} size={16} /></span>
    <ValueHoverPreview class="function-card-body__output" label={props.output.label}
      preview={() => props.previewType(props.output, -1)} onOpen={() => props.onOpenType(props.output, -1)}>
      <div class="function-card-body__type-line" data-tooltip={props.output.term ?? props.output.label}>{typeLine(props.output)}</div>
    </ValueHoverPreview>
  </div>;
}
