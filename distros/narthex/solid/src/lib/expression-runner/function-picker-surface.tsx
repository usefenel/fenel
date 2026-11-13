import { For, Show, createEffect, createMemo, createSignal, createUniqueId, untrack, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { createListboxKeys } from "../listbox-keys";
import { DisplayNameText } from "../display-name-text";
import { IconByName } from "../icons";
import type { DisplayNameInput } from "../display-name";
import { ExpressionDialogContext } from "./expression-surfaces";

// ---------------------------------------------------------------------------
// The one function picker. Its candidates arrive as data (a model built from
// the query), so the same search box, rows, keyboard, highlight preview and
// status lines serve both sources:
//   - the prepared catalogue and session (`FunctionPicker` in ./index.tsx):
//     type ranking, constructors, local functions, the shared type contract;
//   - the functions already listed before the editing tools are ready (the
//     held lens in ./ExpressionEditor.tsx): no engine, no type ranking and no
//     constructors yet, with that owner's own pending lines.
// This module stays engine-free: the held lens imports it before any registry.
// ---------------------------------------------------------------------------

export type PickerKindFilter = "all" | "function" | "constructor";

/** The picker's own query; a model reads it reactively. */
export type FunctionPickerQuery = {
  readonly text: () => string;
  readonly kind: () => PickerKindFilter;
  readonly showOther: () => boolean;
};

export type FunctionPickerRow = {
  /** Listbox identity, unique among the rows of one model. */
  readonly key: string;
  /** The catalogue function this row picks; a highlight previews it. */
  readonly fnId?: string;
  /** A human label first; a code name only when no label exists. */
  readonly name: DisplayNameInput;
  readonly badge?: "constructor" | "local";
  /** Why this row cannot be taken (shown as a badge; the row is disabled). */
  readonly status?: string;
  readonly disabled?: boolean;
  readonly tooltip?: string;
  /** What the row's inputs (and result, where known) are. */
  readonly signature: () => JSX.Element;
  readonly match?: string;
  readonly matchLabel?: string;
  readonly localBinding?: string;
  /** Takes this row. The model re-checks that the row is still current. */
  readonly take: () => void;
};

export type FunctionPickerFailure = { readonly message: string; readonly retry?: () => void };

export type FunctionPickerModel = {
  readonly placeholder: string;
  /** Lexical functions, listed before the catalogue rows and never cut. */
  readonly local?: () => readonly FunctionPickerRow[];
  /** Catalogue rows for the current query, in display order. */
  readonly rows: () => readonly FunctionPickerRow[];
  /** Kind tab counts. Absent while constructors cannot be listed: no tabs. */
  readonly counts?: () => { all: number; functions: number; constructors: number };
  /** A type filters the rows: the contract is shown and "Show other
   * functions" applies. */
  readonly typeFiltered?: () => boolean;
  /** The type contract of the place being filled. */
  readonly guidance?: () => JSX.Element;
  /** Anything else whose change lists new rows (the expected type). */
  readonly revision?: () => unknown;
  readonly pending?: () => string | undefined;
  readonly failure?: () => FunctionPickerFailure | undefined;
  /** Only a type-filtered search that found nothing speaks. */
  readonly empty?: () => string | undefined;
  /** Functions not listed yet that the user may ask for explicitly. */
  readonly more?: () => { readonly label: string; readonly detail?: string; readonly run: () => void } | undefined;
};

const statusStyle = "padding: 0.65rem; font-size: 0.75rem";

export function FunctionPickerSurface(props: {
  model: (query: FunctionPickerQuery) => FunctionPickerModel;
  /** Pre-select this kind tab on open. Default `"all"`. */
  initialKind?: PickerKindFilter;
  /** Hide the kind tabs and keep `initialKind`. */
  lockKind?: boolean;
  onCancel?: () => void;
  /** The highlighted catalogue function, for a live preview of the choice. */
  onHighlight?: (fnId: string | undefined) => void;
  /** Other choices for the same place (data for a replaced slot). */
  children?: JSX.Element;
}) {
  // Inside a dialog its close (and Escape) is the only close.
  const inDialog = useContext(ExpressionDialogContext);
  const [filter, setFilter] = createSignal("");
  const [kindFilter, setKindFilter] = createSignal<PickerKindFilter>(untrack(() => props.initialKind ?? "all"));
  const [showOther, setShowOther] = createSignal(false);
  const [limit, setLimit] = createSignal(80);
  const model = untrack(() => props.model({ text: filter, kind: kindFilter, showOther }));
  const listQuery = () => ({ filter: filter(), kind: kindFilter(), other: showOther(), revision: model.revision?.() });
  createEffect(listQuery, () => { setLimit(80); });
  const local = createMemo(() => model.local?.() ?? []);
  const rows = createMemo(() => model.rows());
  const shown = createMemo(() => rows().slice(0, limit()));
  // The keyboard walks the rendered rows a click could take: a disabled row
  // is shown but skipped, and nothing beyond the "show more" cut is reached.
  const takeable = createMemo(() => [...local(), ...shown()].filter(row => !row.disabled));
  function pick(row: FunctionPickerRow) {
    if (!takeable().includes(row)) return;
    row.take();
  }
  const listId = createUniqueId();
  const keys = createListboxKeys<FunctionPickerRow>({
    rows: takeable,
    id: row => row.key,
    domPrefix: `${listId}-option`,
    pick,
    close: () => props.onCancel?.(),
    resetOn: listQuery,
  });
  createEffect(() => keys.highlighted()?.fnId, fnId => { props.onHighlight?.(fnId); });
  const tabs = () => props.lockKind ? undefined : model.counts?.();
  const row = (row: FunctionPickerRow) => <button type="button" role="option" tabindex={-1}
    id={keys.optionDomId(row.key)}
    aria-selected={keys.isActive(row) ? "true" : "false"}
    class={["expr-picker__item", { "expr-picker__item--active": keys.isActive(row) }]}
    data-match={row.match} data-local-binding={row.localBinding} disabled={!!row.disabled}
    data-tooltip={row.tooltip || undefined}
    onMouseMove={() => { if (!row.disabled) keys.hover(row); }}
    onClick={() => pick(row)}>
    {/* The rows read like the Suggestions and Browse rows: a glyph, the
        function's name, then what it takes in quieter text. */}
    <span class="expr-picker__glyph" aria-hidden={row.badge === "constructor" ? undefined : "true"}
      role={row.badge === "constructor" ? "img" : undefined} aria-label={row.badge === "constructor" ? "Creates data" : undefined}
      data-tooltip={row.badge === "constructor" ? "Creates data" : undefined}><IconByName name={row.badge === "constructor" ? "package" : "function"} size={14} /></span>
    <span class="expr-picker__item-text">
      <span class="expr-picker__name">
        <DisplayNameText name={row.name} />
        <Show when={row.badge === "local"}><span class="expr-picker__op-badge">local</span></Show>
        <Show when={row.status}>{status => <span class="expr-picker__op-badge">{status()}</span>}</Show>
      </span>
      <span class="expr-picker__signature">{row.signature()}</span>
    </span>
    <Show when={row.matchLabel}>{label => <span class={`expr-picker__match expr-picker__match--${row.match}`}>{label()}</span>}</Show>
  </button>;

  return (
    <div class="expr-picker" data-function-picker="true">
      <div class="expr-picker__head">
        <input
          class="expr-picker__input"
          placeholder={model.placeholder}
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
          onKeyDown={event => { if (event.key === "Escape" && inDialog()) return; keys.keyDown(event); }}
          role="combobox"
          aria-label="Search functions"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={keys.activeDescendant()}
          autocomplete="off"
          spellcheck={false}
          autofocus
        />
        <Show when={props.onCancel && !inDialog()}>
          <button type="button" class="expr-picker__cancel" onClick={() => props.onCancel?.()}>cancel</button>
        </Show>
      </div>
      <Show when={model.typeFiltered?.()}><div class="expr-picker__guidance">
        {model.guidance?.()}
        <label><input type="checkbox" checked={showOther()} onChange={(e) => setShowOther(e.currentTarget.checked)} />Show other functions</label>
      </div></Show>
      {props.children}
      <Show when={tabs()}>{counts => <div class="expr-picker__tabs">
        <button type="button" class={{ "expr-picker__tab": true, active: kindFilter() === "all" }} onClick={() => setKindFilter("all")}>
          all <span class="expr-picker__tab-count">{counts().all}</span>
        </button>
        <button type="button" class={{ "expr-picker__tab": true, active: kindFilter() === "function" }} onClick={() => setKindFilter("function")}>
          functions <span class="expr-picker__tab-count">{counts().functions}</span>
        </button>
        <button type="button" class={{ "expr-picker__tab": true, active: kindFilter() === "constructor" }} onClick={() => setKindFilter("constructor")}>
          constructors <span class="expr-picker__tab-count">{counts().constructors}</span>
        </button>
      </div>}</Show>
      <div id={listId} class="expr-picker__list" role="listbox" aria-label="Functions">
        <For each={local()}>{row}</For>
        <For each={shown()}>{row}</For>
        <Show when={rows().length > limit()}>
          <button type="button" class="expr-picker__more" onClick={() => setLimit(limit() + 80)}>Show more functions</button>
        </Show>
        <Show when={model.pending?.()}>{pending => <div class="text-muted" role="status" style={statusStyle}>
          <span class="home-new-button__spinner" aria-hidden="true" /> {pending()}</div>}</Show>
        <Show when={model.failure?.()}>{failure => <div class="admin-form-error" role="alert" style={statusStyle}>
          {failure().message}
          <Show when={failure().retry}>{retry => <> <button type="button" class="expr-form__btn" onClick={() => retry()()}>Retry</button></>}</Show>
        </div>}</Show>
        {/* An empty list says nothing. Only a type-filtered search that found
            nothing speaks, because it names what to do next. */}
        <Show when={!model.pending?.() && !model.failure?.() && rows().length === 0 && local().length === 0 && model.empty?.()}>{empty =>
          <div class="text-muted" style={`${statusStyle}; text-align: center`}>{empty()}</div>}</Show>
        <Show when={!model.pending?.() && model.more?.()}>{more => <div class="text-muted" style={statusStyle}>
          <Show when={more().detail}>{detail => <span>{detail()} </span>}</Show>
          <button type="button" class="expr-form__btn" onClick={() => more().run()}>{more().label}</button>
        </div>}</Show>
      </div>
    </div>
  );
}
