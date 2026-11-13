// ---------------------------------------------------------------------------
// locus-select — the app's own dropdown, in place of the native `<select>`.
//
// A native select is the OS's widget, not ours: its list is drawn by the
// platform, so it cannot be styled, cannot carry an icon or a second line, and
// on Windows it reads as a control from a different application than the one
// it sits in.
//
// Nothing new is invented for the popup. `LocusContextMenu` is already the
// repo's menu — portalled, positioned, click-outside, keyboard navigation,
// type-ahead, icons by name — and the gear button right next to this one in
// the locus bar already opens it. So the dropdown IS that menu with one item
// per option and a highlight on the current one, and this file is only the trigger
// button plus the mapping.
//
// Keyboard: the trigger is a button, so Tab reaches it and Enter or Space
// opens the list; ArrowDown, ArrowUp and Alt+ArrowDown open it too, as they do
// a native select. The list opens on the current option, and picking one hands
// focus back to the trigger.
//
// Screen readers: a native select announces its value, so the trigger's name
// is "<label>: <current option>", and the options are `menuitemradio`s with
// `aria-checked` on the current one (the highlight is the visual half).
//
// A fixed set of options is, in Fenel's terms, a variant with nullary
// constructors, and picking one is a constructor pick. This control is the
// generic presentation of that; a typed slot should reach for the constructor
// picker in the expression editor instead.
// ---------------------------------------------------------------------------

import { Show, createMemo, createSignal, latest } from "solid-js";
import { Dynamic } from "@solidjs/web";
import { LocusContextMenu, type LocusMenuItem } from "./locus-context-menu";
import { IconChevronDown, LUCIDE_BY_NAME } from "./icons";
import "./locus-select.css";

export type LocusSelectOption = {
  value: string;
  label: string;
  /** A kebab-case `Iconable.icon` name, resolved by the menu renderer. */
  icon?: string;
  /** Hover help on the option in the list. */
  tooltip?: string;
};

export function LocusSelect(props: {
  value: string;
  options: readonly LocusSelectOption[];
  /** Label an existing value whose renderer is available but is no longer
   * offered as a conversion for this subject. */
  fallbackOption?: LocusSelectOption;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Pending source work keeps keyboard focus while refusing new gestures. */
  busy?: boolean;
  label: string;
  tooltip?: string;
  /** Widen the trigger so a row of them does not jitter as values change. */
  minWidth?: string;
  class?: string;
}) {
  const [at, setAt] = createSignal<{ x: number; y: number }>();
  let trigger: HTMLButtonElement | undefined;
  const current = createMemo(() => props.options.find((option) => option.value === props.value) ?? props.fallbackOption);
  const items = createMemo<LocusMenuItem[]>(() => props.options.map((option) => ({
    id: option.value,
    label: option.label,
    icon: option.icon,
    checked: option.value === props.value,
    tooltip: option.tooltip,
    onSelect: () => {
      if (latest(() => props.disabled || props.busy)) return;
      props.onChange(option.value);
      // A native select keeps focus after a pick; the menu item that had it
      // is about to unmount.
      trigger?.focus({ preventScroll: true });
    },
  })));

  const shown = () => current()?.label ?? props.value;

  function open() {
    if (latest(() => props.disabled || props.busy)) return;
    if (at()) { setAt(undefined); return; }
    const rect = trigger?.getBoundingClientRect();
    setAt(rect ? { x: rect.left, y: rect.bottom + 4 } : { x: 0, y: 0 });
  }

  function keydown(event: KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (event.ctrlKey || event.metaKey || at()) return;
    event.preventDefault();
    open();
  }

  return <>
    <button
      type="button"
      ref={(element) => { trigger = element; }}
      class={`locus-select ${props.class ?? ""}`}
      style={props.minWidth ? `min-width: ${props.minWidth}` : undefined}
      disabled={props.disabled}
      aria-disabled={props.disabled || props.busy ? "true" : "false"}
      aria-busy={props.busy ? "true" : "false"}
      aria-haspopup="menu"
      aria-expanded={at() ? "true" : "false"}
      aria-label={shown() ? `${props.label}: ${shown()}` : props.label}
      data-tooltip={props.tooltip}
      onClick={open}
      onKeyDown={keydown}
    >
      <Show when={current()?.icon && LUCIDE_BY_NAME[current()!.icon!]}>{(Icon) => (
        <span class="locus-select__icon" aria-hidden="true"><Dynamic component={Icon()} size={14} /></span>
      )}</Show>
      <span class="locus-select__value">{shown()}</span>
      <span class="locus-select__caret" aria-hidden="true"><IconChevronDown size={12} /></span>
    </button>
    {/* Keyed: the menu's placement effect tracks x/y and must never read a
        closed position (a non-keyed accessor throws "Stale read from <Show>"). */}
    <Show when={at()} keyed>{(position) => (
      <LocusContextMenu x={position.x} y={position.y} items={items()}
        focusId={props.value} label={props.label} opener={trigger}
        onClose={() => setAt(undefined)} />
    )}</Show>
  </>;
}

/** A plain string list, for the common case where the value IS the label. */
export function locusSelectOptions(values: readonly string[]): LocusSelectOption[] {
  return values.map((value) => ({ value, label: value }));
}
