// Existing typed in-place editor; loaded on first use by TypedReadValue.
import { Show, createMemo, createSignal, onCleanup, onSettled, untrack } from "solid-js";
import { Portal } from "@solidjs/web";
import type { FenelType } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { Nothing } from "@fenel/engine/type-foundation";
import { FieldRenderer, PlainFieldsContext } from "./field-renderer/FieldRenderer";
import { RecordPartsEditor, scalarRecordParts } from "./expression-runner/simple-data-form";
import { editorWidgetEnvironment } from "./expression-runner/index";
import { inlineWidgetFor } from "./expression-runner/inline-widgets";
import { useAuthoringSession } from "./expression-runner/authoring-session";
import { useReaderRuntime } from "./reader-runtime";
import { DisplayNameText } from "./display-name-text";
import type { DisplayNameInput } from "./display-name";
import "./locus-quick-value.css";

/** The same small card in EDIT mode (polish item 1, Nov 8): click a field's
 *  value in a card and its editor opens right there, the field's own
 *  `FieldRenderer` (one general editor, here in its compact form). The card is
 *  the draft: Enter or Apply writes it, Escape, Cancel or a click outside
 *  drops it, and the full editor stays one click away. */
export function LocusQuickEdit(props: {
  name: DisplayNameInput;
  type: FenelType | undefined;
  value: unknown;
  registry?: ModuleRegistry;
  /** The clicked value's box (viewport coordinates); the card opens under it. */
  anchor: { left: number; top: number; bottom: number };
  applyLabel: string;
  onApply: (value: unknown) => Promise<void>;
  onOpenFull?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = createSignal<unknown>(untrack(() => props.value));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [position, setPosition] = createSignal(untrack(() => ({ left: props.anchor.left, top: props.anchor.bottom + 4 })));
  const session = useAuthoringSession();
  const reader = useReaderRuntime();
  // Polish lane 2 (Nov 9): a record of plain parts (a date's day, month,
  // year) is edited as its own part inputs, as the New data simple form does
  // (one shared RecordPartsEditor), so no typed key is dropped.
  const parts = createMemo(() => {
    try {
      const control = inlineWidgetFor(props.type, undefined, editorWidgetEnvironment(session, reader));
      return control ? scalarRecordParts(control.type, session, reader) : undefined;
    } catch { return undefined; }
  });
  let card!: HTMLDivElement;

  /** Keep the card inside the viewport, under the value, else above it, else
   *  shifted up; it scrolls inside when taller than the viewport. Re-placed
   *  whenever its size changes (it grows once its field editor is prepared). */
  const place = () => {
    const box = card.getBoundingClientRect();
    const room = window.innerHeight - 8;
    const left = Math.max(8, Math.min(props.anchor.left, window.innerWidth - box.width - 8));
    const below = props.anchor.bottom + 4;
    const above = props.anchor.top - 4 - box.height;
    const top = below + box.height <= room ? below : above >= 8 ? above : Math.max(8, room - box.height);
    const current = untrack(position);
    if (current.left !== left || current.top !== top) setPosition({ left, top });
  };

  onSettled(() => {
    place();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => place()) : undefined;
    observer?.observe(card);
    window.addEventListener("resize", place);
    card.querySelector<HTMLElement>("input, textarea, [contenteditable=true], button:not(.locus-quick-value__full):not(.locus-quick-value__close)")?.focus();
    const outside = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-home-navigation]")) return;
      // A picker the field editor opened (a menu, a popover) is part of this draft.
      if (event.target instanceof Element && event.target.closest("[role=listbox], [role=menu], [role=dialog]:not(.locus-quick-value)")) return;
      if (event.target instanceof Node && !card.contains(event.target)) props.onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
  });
  onCleanup(() => setBusy(false));

  async function apply() {
    if (busy()) return;
    setBusy(true);
    setError(undefined);
    try {
      await props.onApply(draft());
      props.onClose();
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof Error ? failure.message : "Could not change this value.");
    }
  }

  return <Portal><div
    ref={card}
    class="locus-quick-value locus-quick-value--edit"
    style={`left: ${Math.round(position().left)}px; top: ${Math.round(position().top)}px`}
    role="dialog"
    aria-label="Edit field"
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.onClose(); }
      // Enter in a one-line box applies; a multi-line text keeps its newline.
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); void apply(); }
    }}
  >
    <div class="locus-quick-value__head">
      <span class="locus-quick-value__type"><DisplayNameText name={props.name} /></span>
      <Show when={props.onOpenFull}>
        <button type="button" class="locus-quick-value__full" onClick={() => { props.onClose(); props.onOpenFull?.(); }}
          data-tooltip="Open the full editor for this data">⤢</button>
      </Show>
      <button type="button" class="locus-quick-value__close" onClick={props.onClose} aria-label="Cancel">×</button>
    </div>
    {/* The compact context shows the value's input only: no type badges and
        no "Value representations" toggle (the simple form's PlainFieldsContext). */}
    <div class="locus-quick-value__field"><PlainFieldsContext value={true}>
      <Show when={parts()} fallback={<FieldRenderer identityMode="transient" registry={props.registry} compact
        field={{ name: "value", type: props.type ?? { $ref: "Any" } as FenelType, label: Nothing, meta: {}, ui: Nothing }}
        value={draft()} onChange={(next) => { setDraft(() => next); setError(undefined); }} />}>
        {fields => <RecordPartsEditor fields={fields()} value={draft()}
          onChange={(next) => { setDraft(() => next); setError(undefined); }} />}
      </Show>
    </PlainFieldsContext></div>
    <Show when={error()}><div class="locus-quick-value__error" role="alert">{error()}</div></Show>
    <div class="locus-quick-value__actions">
      <button type="button" class="btn locus-quick-value__cancel" disabled={busy()} onClick={props.onClose}>Cancel</button>
      <button type="button" class="btn btn-primary locus-quick-value__save" disabled={busy()}
        onClick={() => void apply()}>{busy() ? `${props.applyLabel === "Save" ? "Saving" : "Applying"}…` : props.applyLabel}</button>
    </div>
  </div></Portal>;
}
