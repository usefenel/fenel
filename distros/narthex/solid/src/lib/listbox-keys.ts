// ---------------------------------------------------------------------------
// listbox-keys — the keyboard half of "a search box over a list of rows".
//
// The Locus Browse panel, the expression editor's FunctionPicker and the
// TypePicker all have the same shape: focus stays in a text input, the rows
// below it are the answers, and the keyboard walks them without leaving the
// input. Up/down moves a highlight (wrapping), Enter takes the highlighted
// row (the first one while nothing is highlighted), Ctrl/Cmd+Enter takes its
// secondary action where the surface has one, Esc closes. The highlighted row
// is scrolled into view and named to assistive technology through
// `aria-activedescendant` on the input (the combobox) and `aria-selected` on
// the row (the option).
//
// This was written once, inside `locus-browse.tsx`; it lives here so the other
// pickers reuse it rather than growing a second copy. The decisions (which key
// means what, which row is active, where a step lands) are plain functions so
// they can be tested without a browser; `createListboxKeys` wires them to a
// signal and the DOM.
// ---------------------------------------------------------------------------

import { createEffect, createSignal } from "solid-js";

export type ListboxCommand =
  | { kind: "move"; step: 1 | -1 }
  | { kind: "pick"; secondary: boolean }
  | { kind: "close" };

export type ListboxKeyEvent = Pick<KeyboardEvent, "key" | "isComposing" | "ctrlKey" | "metaKey">;

/** What a key press means to a listbox, or `undefined` when it is not ours
 *  (ordinary typing, and every key while an IME composes). */
export function listboxCommand(event: ListboxKeyEvent): ListboxCommand | undefined {
  if (event.isComposing) return undefined;
  switch (event.key) {
    case "ArrowDown": return { kind: "move", step: 1 };
    case "ArrowUp": return { kind: "move", step: -1 };
    case "Enter": return { kind: "pick", secondary: event.ctrlKey || event.metaKey };
    case "Escape": return { kind: "close" };
    default: return undefined;
  }
}

/** The row Enter would take: the highlighted one while the list still shows
 *  it, otherwise the first. A stale highlight on a row the current query no
 *  longer lists would send Enter somewhere the user cannot see. */
export function activeListboxId(ids: readonly string[], activeId: string | undefined): string | undefined {
  if (activeId !== undefined && ids.includes(activeId)) return activeId;
  return ids[0];
}

/** Where one step from the active row lands, wrapping at both ends. With no
 *  explicit highlight the first row counts as active (it is what Enter takes),
 *  so the first ArrowDown reaches the second row and ArrowUp the last. */
export function stepListboxId(ids: readonly string[], activeId: string | undefined, step: 1 | -1): string | undefined {
  if (!ids.length) return undefined;
  const current = ids.indexOf(activeListboxId(ids, activeId)!);
  return ids[(current + step + ids.length) % ids.length];
}

export type ListboxKeysOptions<T> = {
  /** The rows the keyboard can reach, in display order — only the rendered,
   *  takeable ones (no disabled rows, nothing beyond a "show more" cut). Read
   *  on every key press and by the row markup; a caller whose rows come from
   *  a suspending read passes a plain mirror instead of the read itself. */
  rows: () => readonly T[];
  id: (row: T) => string;
  /** Prefix of the rows' DOM ids. Unique per mounted list. */
  domPrefix: string;
  pick: (row: T) => void;
  /** Ctrl/Cmd+Enter. Without it, Ctrl/Cmd+Enter picks. */
  secondary?: (row: T) => void;
  /** Esc. Without it, Esc is left to the surrounding surface. */
  close?: () => void;
  /** Tracked; whenever it changes the highlight is dropped (a new query lists
   *  new rows). */
  resetOn?: () => unknown;
};

export function createListboxKeys<T>(options: ListboxKeysOptions<T>) {
  const [activeId, setActiveSignal] = createSignal<string>();
  /** The key handler's own copy. A signal write lands on the next microtask,
   *  so two key presses handled in one task would both step from the old
   *  highlight; the handler reads this plain mirror instead. */
  let latestId: string | undefined;
  const setActiveId = (id: string | undefined) => { latestId = id; setActiveSignal(id); };
  // The first run is the mount, when nothing is highlighted yet; it is also
  // scheduled, so a highlight made before the first flush must survive it.
  let mounted = false;
  if (options.resetOn) createEffect(options.resetOn, () => {
    if (mounted) setActiveId(undefined);
    mounted = true;
  });

  const optionDomId = (id: string) => `${options.domPrefix}-${encodeURIComponent(id)}`;
  const ids = () => options.rows().map(options.id);
  const rowFor = (highlighted: string | undefined): T | undefined => {
    const rows = options.rows();
    const id = activeListboxId(rows.map(options.id), highlighted);
    return id === undefined ? undefined : rows.find((row) => options.id(row) === id);
  };
  const activeRow = () => rowFor(activeId());

  function keyDown(event: KeyboardEvent) {
    const command = listboxCommand(event);
    if (!command) return;
    if (command.kind === "close") {
      if (!options.close) return;
      event.preventDefault();
      options.close();
      return;
    }
    event.preventDefault();
    if (command.kind === "pick") {
      const row = rowFor(latestId);
      if (!row) return;
      if (command.secondary && options.secondary) options.secondary(row);
      else options.pick(row);
      return;
    }
    const next = stepListboxId(ids(), latestId, command.step);
    if (next === undefined) return;
    setActiveId(next);
    if (typeof document !== "undefined") {
      document.getElementById(optionDomId(next))?.scrollIntoView({ block: "nearest" });
    }
  }

  return {
    keyDown,
    optionDomId,
    activeRow,
    /** Is this row the highlighted one (the implicit first included)? */
    isActive: (row: T) => {
      const active = activeRow();
      return active !== undefined && options.id(active) === options.id(row);
    },
    /** For the input's `aria-activedescendant`: only an explicit highlight the
     *  list still shows, so a screen reader is not sent to a row on every
     *  keystroke of the query. */
    activeDescendant: () => {
      const id = activeId();
      return id !== undefined && ids().includes(id) ? optionDomId(id) : undefined;
    },
    /** The pointer highlights as it moves, so Enter and the hover agree. */
    hover: (row: T) => setActiveId(options.id(row)),
    /** The row the user highlighted (pointer or arrows) while the list still
     *  shows it; never the implicit first row. Live previews follow it. */
    highlighted: (): T | undefined => {
      const id = activeId();
      return id === undefined ? undefined : options.rows().find((row) => options.id(row) === id);
    },
  };
}
