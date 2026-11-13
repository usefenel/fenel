// ---------------------------------------------------------------------------
// TypePicker — searchable list of all type-shaped catalog entries (atoms,
// foundation, formats, units, composites, entities, interfaces, generics).
// Skips only the `function` section. Interfaces (record-of-methods dispatch
// faces — Labelable, PhoneFormat, …) ARE types, so they're pickable (Phase 6b:
// the merged `interface` section supersedes the old `typeclass`/`spec` split).
//
// Used as the leaf of the `Named` body in TypeBuilder, and (via re-export
// from expression-runner) by the dashboard composer chip-picker.
// ---------------------------------------------------------------------------

import { For, Show, createContext, createMemo, createSignal, createUniqueId, latest, onSettled, useContext, type Accessor } from "solid-js";
import { getIcon } from "@fenel/engine";
import {
  filterAuthoringTypeEntries,
  type AuthoringCatalogTypeEntry,
} from "@fenel/engine/authoring/environment";
import { IconByName, LUCIDE_BY_NAME, TYPE_ICON_FALLBACKS } from "../icons";
import { useAuthoringSession } from "../expression-runner/authoring-session";
import { createListboxKeys } from "../listbox-keys";
import { preferredTypePickerEntries, typePickerRows } from "./type-picker-rows";
import { QUICK_TYPE_CATEGORIES, QUICK_TYPE_SUBTYPES } from "../new-value-types";
import { DisplayNameText } from "../display-name-text";
import { inlineWidgetFor } from "../expression-runner/inline-widgets";
import { editorWidgetEnvironment } from "../expression-runner";
import { useReaderRuntime } from "../reader-runtime";
import { LOCAL_ACTION_CHANGED } from "../expression-runner/local-reader-actions";
import { resolveTypePickerSelection, TYPE_PICKER_UNAVAILABLE, type CaptureTypePickerTarget, type TypePickerSelection } from "./type-picker-selection";
export type { CaptureTypePickerTarget, TypePickerSelection } from "./type-picker-selection";

/** A type's icon name, as the picker shows it: the reader's own answer when it
 *  has one, else the registered Iconable, else the shared fallbacks. */
export function typeIconName(typeName: string | undefined, own?: unknown): string | undefined {
  const name = typeof own === "string" && own ? own
    : typeName ? getIcon(typeName) ?? TYPE_ICON_FALLBACKS[typeName] : undefined;
  return name && LUCIDE_BY_NAME[name] ? name : undefined;
}

function TypePickerIcon(props: { typeName?: string | undefined }) {
  const iconName = () => typeIconName(props.typeName);

  // An empty glyph slot keeps every name on one column.
  return (
    <span class={["expr-picker__glyph", { "expr-picker__glyph--empty": !iconName() }]} aria-hidden="true">
      <Show when={iconName()} keyed>{(name) => <IconByName name={name} size={14} />}</Show>
    </span>
  );
}

/** The New menu's quick types lead a blank picker, after the list's own types;
 *  its text formats (e-mail and web address) are everyday types too and
 *  follow Date. Only the fillable ones are kept (see `fillable`). */
const TEXT_FORMATS = (QUICK_TYPE_SUBTYPES.String ?? []).filter((type) => type.name !== "String");
const COMMON_TYPE_NAMES = QUICK_TYPE_CATEGORIES.flatMap((category) => category.types)
  .flatMap((type) => type.name === "Date" ? [type, ...TEXT_FORMATS] : [type]).map((type) => type.name);

/** The catalogue names a type by its label, else by its entity id
 *  (`getLabel(id) ?? id`): a name equal to the id is a code name. */
const rowDisplayName = (row: { name: string; entityId?: string | undefined }) =>
  row.entityId === row.name ? { text: row.name, code: true } : row.name;

/** The types in scope where the picker opens (the current list's own types),
 *  listed first. Identities are entity ids, catalogue ids or unique names. */
export const TypePickerPreferredContext = createContext<Accessor<readonly string[]>>(() => []);

export function TypePicker(props: {
  onPick: (selection: TypePickerSelection) => void;
  /** Captures the containing draft/occurrence and its edit/save lifetime. */
  captureTarget: CaptureTypePickerTarget;
  onCancel?: () => void;
  /** Show an "auto" option at the top — used by the kind/type chip flow. */
  allowAuto?: boolean;
  /** A popover: an outside click closes it (with Escape), so no cancel button. */
  closeOnOutsideClick?: boolean;
}) {
  const [filter, setFilter] = createSignal("");
  let input: HTMLInputElement | undefined;
  const session = useAuthoringSession();
  const reader = useReaderRuntime();
  const [pending, setPending] = createSignal(false);
  const [failure, setFailure] = createSignal("");
  let alive = true;
  let generation = 0;
  let controller: AbortController | undefined;
  let failedRow: Row | undefined;
  function invalidate() {
    generation += 1;
    controller?.abort();
    controller = undefined;
  }
  onSettled(() => () => { alive = false; invalidate(); });
  const enabled = () => alive && !!input?.isConnected && !input.matches(":disabled") && !input.closest("[inert]");
  function cancel() { invalidate(); props.onCancel?.(); }
  let root: HTMLDivElement | undefined;
  onSettled(() => {
    if (!props.closeOnOutsideClick) return;
    const outside = (event: PointerEvent) => {
      if (alive && root && event.target instanceof Node && event.target.isConnected && !root.contains(event.target)) cancel();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  });

  const preferred = useContext(TypePickerPreferredContext);
  // The everyday group holds only types the small data form can fill with an
  // inline control: the same question it asks before "Set under Advanced."
  // (inlineWidgetFor on the field's `$ref`). A type constructor (List, Maybe,
  // Either) stays: its argument decides.
  const fillable = (row: AuthoringCatalogTypeEntry) => {
    if (row.category === "constructor") return true;
    try {
      return !!inlineWidgetFor(row.entityId ? { $ref: row.entityId } : row.type, undefined, editorWidgetEnvironment(session, reader));
    } catch { return false; }
  };
  const ranked = createMemo(() => preferredTypePickerEntries(session.catalog.types, preferred(), filter(), 100,
    filterAuthoringTypeEntries, COMMON_TYPE_NAMES, fillable));
  const filtered = () => ranked().rows;

  /** The "auto" row asks for inference; every other row keeps its identity.
   *  Rows are keyed by catalog id: two modules may share a bare type name. */
  type Row = AuthoringCatalogTypeEntry;
  const AUTO: Row = { id: "", name: "", description: "", category: "auto" };
  const rowId = (row: Row) => row === AUTO ? "auto" : `type:${row.id}`;
  const listId = createUniqueId();
  /** One list for the markup and the keyboard. "auto" leads only while the
   *  filter is blank, so Enter after a query takes the first matching type. */
  const rows = createMemo(() => typePickerRows(props.allowAuto ? AUTO : undefined, filtered(), filter()));
  const showAuto = () => rows()[0] === AUTO;
  async function pick(row: Row, original?: string) {
    let ownGeneration = generation;
    let own: AbortController | undefined;
    let captured: string | undefined;
    try {
      if (!latest(() => enabled() && rows().includes(row))) return;
      invalidate();
      ownGeneration = generation;
      own = controller = new AbortController();
      const targetCurrent = latest(() => props.captureTarget());
      if (!targetCurrent) throw new Error(LOCAL_ACTION_CHANGED);
      // A retried pick continues only on the same content it was asked on.
      if (original !== undefined && targetCurrent.draft !== original) throw new Error(LOCAL_ACTION_CHANGED);
      captured = targetCurrent.draft;
      const query = input!.value;
      const current = () => latest(() => ownGeneration === generation && !own!.signal.aborted && enabled()
        && input!.value === query && rows().includes(row) && targetCurrent());
      if (!current()) throw new Error(LOCAL_ACTION_CHANGED);
      setFailure("");
      failedRow = undefined;
      setPending(true);
      const selection: TypePickerSelection = row === AUTO ? { kind: "auto" }
        : await resolveTypePickerSelection(row, () => session, reader, { signal: own.signal, current });
      // Apply against the same in-flight draft that passed the final guard.
      latest(() => {
        if (!current()) throw new Error(LOCAL_ACTION_CHANGED);
        props.onPick(selection);
      });
    } catch (error) {
      if (ownGeneration !== generation || own?.signal.aborted || !alive) return;
      // The draft was replaced by an equal copy while the pick resolved (a
      // Local reconciliation of the field just named): ask once more on the
      // current copy. Any content change still refuses with Retry.
      if (original === undefined && captured !== undefined && error instanceof Error && error.message === LOCAL_ACTION_CHANGED
        && latest(() => enabled() && rows().includes(row) && props.captureTarget()?.draft === captured)) {
        queueMicrotask(() => { if (alive && ownGeneration === generation) void pick(row, captured); });
        return;
      }
      failedRow = row;
      setFailure(error instanceof Error && error.message ? error.message : TYPE_PICKER_UNAVAILABLE);
    } finally {
      if (ownGeneration === generation && alive) { controller = undefined; setPending(false); }
    }
  }
  const keys = createListboxKeys<Row>({
    rows,
    id: rowId,
    domPrefix: `${listId}-option`,
    pick: (row) => { void pick(row); },
    close: cancel,
    resetOn: filter,
  });

  return (
    <div ref={(element) => { root = element; }} class="expr-picker expr-picker--types" aria-busy={pending() ? "true" : "false"}>
      <div class="expr-picker__head">
        <input
          ref={(element) => { input = element; }}
          class="expr-picker__input"
          placeholder="pick a type…"
          aria-label="Search types"
          value={filter()}
          onInput={(e) => { invalidate(); setPending(false); setFailure(""); failedRow = undefined; setFilter(e.currentTarget.value); }}
          onKeyDown={keys.keyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={keys.activeDescendant()}
          autocomplete="off"
          spellcheck={false}
          autofocus
        />
        <Show when={props.onCancel && !props.closeOnOutsideClick}>
          <button type="button" class="expr-picker__cancel" onClick={cancel}>cancel</button>
        </Show>
      </div>
      <div id={listId} class="expr-picker__list" role="listbox" aria-label="Types">
        <Show when={showAuto()}>
          <button
            type="button"
            id={keys.optionDomId(rowId(AUTO))}
            role="option"
            tabindex={-1}
            aria-selected={keys.isActive(AUTO) ? "true" : "false"}
            onMouseMove={() => keys.hover(AUTO)}
            class={["expr-picker__item", { "expr-picker__item--active": keys.isActive(AUTO) }]}
            onClick={() => { void pick(AUTO); }}
            data-tooltip="Infer from the expression"
          >
            <TypePickerIcon />
            <span class="expr-picker__item-text">
              <span class="expr-picker__name"><code class="display-name--code">auto</code></span>
              <span class="expr-picker__signature">infer from expression</span>
            </span>
          </button>
        </Show>
        <For each={filtered()}>
          {(t, index) => (
            <button
              type="button"
              id={keys.optionDomId(rowId(t))}
              role="option"
              tabindex={-1}
              aria-selected={keys.isActive(t) ? "true" : "false"}
              onMouseMove={() => keys.hover(t)}
              class={["expr-picker__item", { "expr-picker__item--active": keys.isActive(t),
                "expr-picker__item--group-start": ranked().groupStarts.includes(index()) }]}
              onClick={() => { void pick(t); }}
              data-tooltip={t.description}
            >
              <TypePickerIcon typeName={t.entityId ?? t.name} />
              <span class="expr-picker__item-text">
                <span class="expr-picker__name"><DisplayNameText name={rowDisplayName(t)} /></span>
                <Show when={t.description}><span class="expr-picker__signature">{t.description}</span></Show>
              </span>
            </button>
          )}
        </For>
      </div>
      <Show when={pending()}>
        <div class="text-muted" role="status" style="padding: 0.65rem; font-size: 0.8rem">Checking type…</div>
      </Show>
      <Show when={failure()}>
        <div role="alert" style="padding: 0.65rem; font-size: 0.8rem; line-height: 1.5">
          {failure()}
          <Show when={failedRow && rows().includes(failedRow)}>
            <button type="button" class="expr-picker__cancel" onClick={() => { if (failedRow) void pick(failedRow); }}>Retry</button>
          </Show>
        </div>
      </Show>
      <Show when={rows().length === 0}>
        <div class="text-muted" role="status" style="padding: 0.65rem; font-size: 0.8rem; line-height: 1.5; overflow-wrap: anywhere">
          <Show when={filter()} fallback={<>No types are available in this scope.</>}>
            No types match “{filter()}”. Try another name or clear the search.
          </Show>
        </div>
        <Show when={filter()}>
          <button
            type="button"
            class="expr-picker__cancel"
            style="margin: 0 0.65rem 0.65rem"
            onClick={() => { invalidate(); setPending(false); setFailure(""); failedRow = undefined; setFilter(""); input?.focus(); }}
          >
            Clear search
          </button>
        </Show>
      </Show>
    </div>
  );
}
