import { createContext, createSignal, For, Show, onSettled, useContext, type Accessor } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useValueCardInline, useValueCardCompactLayout } from "../value-hover-preview";
import { IconChevronDown } from "../icons";
import { recordRowPlan } from "./record-card-plan";
import "../data-card.css";

/** Record display rule (Rom, 2026-11-06): a record VALUE shows its fields as
 * `label: value` rows, one per line, each value through its own read UX, about
 * six rows then "Show N more fields". A nested record reads as one line. The
 * compact per-field circles remain only where space is tight: a one-line inline
 * card or a cell narrower than DENSE_WIDTH. Types keep their own summary.
 * One component for every record value; the density decision is made here from
 * the space and nesting it is given, never by a call site. */
export const RECORD_ROW_LIMIT = 6;
const DENSE_WIDTH = 170;
/** A surface that draws many records' cards small at once (the linked-data
 * graph) asks for fewer rows per record; the others still wait behind
 * "Show N more fields". Unset: the rule above. The default is a defined value
 * on purpose: Solid 2's useContext throws when a context is unset and its
 * default is `undefined`, which replaced every record outside the graph with
 * "Could not load data." (Nov 12). */
export const RecordRowLimitContext = createContext<{ rows: number | undefined }>({ rows: undefined });

export type RecordValueRowsProps = {
  count: number;
  label: (index: number) => JSX.Element;
  value: (index: number) => JSX.Element;
  /** "rows" for a record of its own; "line" for a record nested in a row. */
  mode: "rows" | "line";
  /** The existing compact per-field strip, used only when space is tight. */
  dense?: () => JSX.Element;
  /** The surrounding surface asked for a compact read (a card cell). */
  tight?: boolean;
  /** Polish item 1: whether a field's value opens its small editor on click. */
  editable?: (index: number) => boolean;
  /** Called with the clicked value's element (the small editor's anchor). */
  onActivateValue?: (index: number, anchor: HTMLElement) => void;
  /** Fields with nothing to read (record-card-plan.ts): behind "Show N more fields" by default. */
  holdsNothing?: (index: number) => boolean;
  /** A focused record reads as one data card: `head` draws the fields it
   * lifts (portrait, heading), which are then never rows. */
  card?: { lifted: readonly number[]; head: () => JSX.Element };
};

/** Polish item 1 (Nov 8): a field is edited in place only where the host
 * gave a write port, outside a template, and for a value with one editor (a
 * list keeps its own surface). Nested record lines edit their own fields. */
export function fieldEditInPlace(input: { port: boolean; templateOnly: boolean; value: unknown }): boolean {
  return input.port && !input.templateOnly && !Array.isArray(input.value);
}

/** The density decision, from the space and nesting a record is given. */
export function recordDensity(input: { hasDense: boolean; mode: "rows" | "line"; inline: boolean; tight: boolean;
  layout: "one-line" | "two-line"; width: number | undefined }): "dense" | "rows" | "line" {
  if (input.mode === "line") return "line";
  if (!input.hasDense) return "rows";
  if ((input.inline || input.tight) && input.layout === "one-line") return "dense";
  return input.width !== undefined && input.width < DENSE_WIDTH ? "dense" : "rows";
}

export function RecordValueRows(props: RecordValueRowsProps) {
  const inline = useValueCardInline();
  const layout = useValueCardCompactLayout();
  const [width, setWidth] = createSignal<number>();
  const [expanded, setExpanded] = createSignal(false);
  let element: HTMLElement | undefined;
  onSettled(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0) setWidth(box.width);
    });
    // The space a record is given is its surface's (a card, panel, cell or
    // row), not its own box: a centred card body would shrink it to content.
    observer.observe(element.closest("article, section, td, li, .suggestion-row, dialog") ?? element.parentElement ?? element);
    return () => observer.disconnect();
  });
  const dense: Accessor<boolean> = () => recordDensity({ hasDense: !!props.dense, mode: props.mode, inline: inline(),
    tight: !!props.tight, layout: layout(), width: width() }) === "dense";
  const lineShown = () => Math.min(props.count, 3);
  const surfaceLimit = useContext(RecordRowLimitContext).rows;
  // The record's own page shows every field that holds something (the Fenel project hid its nine
  // inspirations behind "Show 4 more fields"); only a record inside something else is cut to a few rows.
  const plan = (open: boolean) => recordRowPlan({ limit: surfaceLimit ?? (props.card ? Number.POSITIVE_INFINITY : RECORD_ROW_LIMIT), expanded: open, lifted: props.card?.lifted,
    holdsNothing: Array.from({ length: props.count }, (_, index) => !!props.holdsNothing?.(index)) });
  const collapsed = () => plan(false);
  const indices = () => props.mode === "line" ? Array.from({ length: lineShown() }, (_, index) => index) : plan(expanded()).shown;
  const hidden = () => props.mode === "line" ? props.count - lineShown() : collapsed().hidden;
  // Event handlers bind once (Solid 2): read the current callbacks at event time.
  const editable = (index: number) => !!props.onActivateValue && !!props.editable?.(index);
  const activate = (index: number, event: Event) => {
    if (!editable(index) || !(event.currentTarget instanceof HTMLElement)) return;
    event.stopPropagation();
    event.preventDefault();
    props.onActivateValue?.(index, event.currentTarget);
  };
  const valueSlot = (index: number, className: string) => <span class={[className, { "record-value__editable": editable(index) }]}
    role={editable(index) ? "button" : undefined} tabindex={editable(index) ? 0 : undefined}
    onClick={event => activate(index, event)}
    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") activate(index, event); }}>{props.value(index)}</span>;
  return <span ref={node => { element = node; }} class={["record-value", `record-value--${props.mode}`, { "record-value--dense": dense(),
    "record-value--card": !!props.card && !dense() && props.mode === "rows", "data-card": !!props.card && !dense() && props.mode === "rows" }]}
    data-record-density={dense() ? "dense" : props.mode}>
    <Show when={!dense()} fallback={props.dense?.()}>
      <Show when={props.mode === "rows"} fallback={<span class="record-value__line">
        <For each={indices()}>{index => <>
          <Show when={index > 0}><span class="record-value__separator" aria-hidden="true">·</span></Show>
          {valueSlot(index, "record-value__line-item")}
        </>}</For>
        <Show when={hidden() > 0}><span class="record-value__more-count">+{hidden()}</span></Show>
      </span>}>
        <Show when={props.card}>{card => card().head()}</Show>
        <span class="record-value__rows" role="list">
          <For each={indices()}>{index => <span class="record-value__row" role="listitem">
            <span class="record-value__label">{props.label(index)}</span>
            {valueSlot(index, "record-value__value")}
          </span>}</For>
        </span>
        <Show when={hidden() > 0}>
          <button type="button" class="record-value__more" aria-expanded={expanded() ? "true" : "false"}
            onClick={event => { event.stopPropagation(); setExpanded(open => !open); }}>
            <span class="record-value__more-icon" aria-hidden="true"><IconChevronDown size={14} /></span>
            <span>{expanded() ? "Show fewer fields" : `Show ${hidden()} more ${hidden() === 1 ? "field" : "fields"}`}</span>
          </button>
        </Show>
      </Show>
    </Show>
  </span>;
}
