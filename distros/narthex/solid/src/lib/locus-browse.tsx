// ---------------------------------------------------------------------------
// locus-browse — ONE surface for browsing and searching, shared by the Locus
// shell and the prepared workspace.
//
// It used to be two. A modal palette ("Search") ranked values, saved values and
// identifiers behind a big input; a side panel ("Browse") listed saved values
// and the catalog behind a small one. But browse IS search with an empty query
// — the same rows, the same universe, filtered by nothing — so two controls,
// two lists, two result presentations and two sets of keybindings were one
// concept wearing two costumes. This is the merge.
//
// The SIDE PANEL won the shape, not the modal. A row here can be dragged onto
// the view behind it, and a modal that covers the view cannot offer that. The
// palette's keyboard-first behaviour came along: up/down moves, Enter takes the
// row, Esc closes.
//
// The two surfaces also disagreed on what picking a row MEANT: the palette
// navigated to the row's page, the drawer added it to the view. In a locus the
// view is the subject, so adding it is primary and opening its page is the
// secondary arrow — one row, both paths, no ambiguity about which is which.
//
// One component, two callers, two data sources. The shell passes what the API
// gives it without an engine; the workspace passes the complete universe plus
// the typed value suggestions only it can compute.
// ---------------------------------------------------------------------------

import { For, Loading, Show, createEffect, createMemo, createSignal, latest, onSettled, untrack } from "solid-js";
import { IconSearch } from "./icons";
import { createListboxKeys } from "./listbox-keys";

export type BrowseRow = {
  id: string;
  label: string;
  detail?: string;
  badge?: string;
  /** Present but not takeable — an incomplete value suggestion, say. */
  disabled?: boolean;
  /** Write the row's payload so it can be dragged straight onto the view. */
  drag?: (transfer: DataTransfer) => void;
  /** The primary action: put this into the view. */
  pick: () => void;
  /** The secondary action: inspect this row in its current reader. */
  open?: () => void;
};
export type BrowseGroup = {
  id: string;
  title: string;
  rows: readonly BrowseRow[];
  /** Read asynchronous rows under this group's own Loading boundary. */
  readRows?: () => readonly BrowseRow[];
  pendingLabel?: string;
};
/** Something is still arriving. Said out loud, because an empty list that is
 *  merely early is indistinguishable from an answer. */
export type BrowsePending = { id: string; label: string };

export function LocusBrowse(props: {
  query: string;
  onQuery: (query: string) => void;
  groups: readonly BrowseGroup[];
  pending?: readonly BrowsePending[];
  /** A row was taken but the workspace it has to be added to is still
   *  building. The wait reports where the click happened. */
  pickPending?: boolean;
  onClose: () => void;
}) {
  let input: HTMLInputElement | undefined;
  onSettled(() => { input?.focus(); input?.select(); });

  /** `props.groups` is read ONLY inside the `<Loading>` boundary below, and
   *  this is the settled snapshot the chrome and the key handler use.
   *  The rows come from promise-backed reads, and reading a pending promise
   *  SUSPENDS: a read from the header or from `aria-activedescendant` would
   *  suspend the panel itself — or worse, the nearest boundary outside it —
   *  while the catalog is still arriving. The boundary must be the only door. */
  type RowSnapshot = { group: BrowseGroup; query: string; rows: readonly BrowseRow[] };
  const [groupOrder, setGroupOrder] = createSignal<readonly BrowseGroup[]>([]);
  const [navSnapshots, setNavSnapshots] = createSignal<Record<string, RowSnapshot>>({});
  const keys = createListboxKeys<BrowseRow>({
    rows: () => {
      const snapshots = navSnapshots();
      const query = latest(() => props.query);
      return groupOrder().flatMap(group => {
        const snapshot = snapshots[group.id];
        return snapshot?.group === group && snapshot.query === query ? snapshot.rows : [];
      });
    },
    id: (row) => row.id,
    domPrefix: "locus-browse-row",
    pick: (row) => row.pick(),
    secondary: (row) => row.open?.(),
    close: () => props.onClose(),
    resetOn: () => latest(() => props.query),
  });

  const PendingResults = (pending: { label?: string }) => <div class="home-drawer__section home-drawer__section--pending">
    <span class="home-new-button__spinner" aria-hidden="true" />
    {pending.label ?? "Reading data…"}
  </div>;

  /** This component owns every promise-backed group read inside Loading.
   *  A pending update can retain the previous settled value, so its query is
   *  captured only when the groups change. `latest` reads typed text while an
   *  asynchronous transition still holds the previous settled query prop. */
  function Results() {
    const groups = createMemo(() => latest(() => props.groups));
    createEffect(groups, next => {
      setGroupOrder(next);
      setNavSnapshots(previous => Object.fromEntries(next.flatMap(group => {
        const snapshot = previous[group.id];
        return snapshot?.group === group ? [[group.id, snapshot]] : [];
      })));
    });
    onSettled(() => () => { setGroupOrder([]); setNavSnapshots({}); });
    return <>
      <For each={groups()}>
        {(group) => <Loading fallback={<PendingResults label={group.pendingLabel} />}>
          <GroupResults group={group} />
        </Loading>}
      </For>
      <For each={props.pending ?? []}>
        {(note) => <PendingResults label={note.label} />}
      </For>
    </>;
  }

  // A new descriptor gets a new keyed group boundary. Reusing an indexed
  // boundary would retain the old pointer/drag rows during a held replacement.
  function GroupResults(groupProps: { group: BrowseGroup }) {
    const snapshot = createMemo(() => {
      const group = groupProps.group;
      const rows = group.readRows ? group.readRows() : group.rows;
      return { group, query: untrack(() => props.query), rows };
    });
    createEffect(snapshot, next => {
      setNavSnapshots(previous => ({ ...previous, [next.group.id]: {
        group: next.group, query: next.query, rows: next.rows.filter(row => !row.disabled),
      } }));
    });
    return <Show when={snapshot().query === latest(() => props.query)}
      fallback={<PendingResults label={groupProps.group.pendingLabel} />}>
      <Show when={snapshot().rows.length}>
          <div class="home-drawer__section">{groupProps.group.title}</div>
          <For each={snapshot().rows}>
            {(row) => (
              <div
                id={keys.optionDomId(row.id)}
                role="option"
                aria-selected={keys.isActive(row) ? "true" : "false"}
                aria-disabled={row.disabled ? "true" : "false"}
                class={["home-drawer__item", {
                  "home-drawer__item--active": keys.isActive(row),
                  "home-drawer__item--disabled": !!row.disabled,
                }]}
                draggable={row.drag ? "true" : "false"}
                onDragStart={(event) => {
                  if (!row.drag || !event.dataTransfer) { event.preventDefault(); return; }
                  row.drag(event.dataTransfer);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onMouseMove={() => { if (!row.disabled) keys.hover(row); }}
                onClick={() => { if (!row.disabled) row.pick(); }}
                data-tooltip={row.detail || row.label}
              >
                <Show when={row.drag}><span class="home-drawer__item-handle">&#8942;&#8942;</span></Show>
                <span class="home-drawer__item-name">{row.label}</span>
                <Show when={row.detail}>
                  <span class="home-drawer__item-detail">{row.detail}</span>
                </Show>
                <Show when={row.badge}>
                  <span class="home-drawer__item-kind mono">{row.badge}</span>
                </Show>
                <Show when={row.open}>
                  <button type="button" class="home-drawer__item-open" data-tooltip="Open"
                    aria-label={`Open ${row.label}`}
                    onClick={(event) => { event.stopPropagation(); row.open!(); }}>&#8599;</button>
                </Show>
              </div>
            )}
          </For>
      </Show>
    </Show>;
  }

  return (
    <aside class="home-drawer" aria-label="Browse and search">
      <div class="home-drawer__head">
        <span class="home-drawer__title">Browse</span>
        <button type="button" class="home-item__remove" onClick={props.onClose} data-tooltip="Close">x</button>
      </div>
      <div class="home-drawer__search-row">
        <IconSearch size={16} />
        <input
          ref={(element) => { input = element; }}
          class="home-drawer__search"
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls="locus-browse-results"
          aria-autocomplete="list"
          aria-activedescendant={keys.activeDescendant()}
          placeholder="Search or enter data…"
          autocomplete="off"
          spellcheck={false}
          value={props.query}
          onInput={(event) => props.onQuery(event.currentTarget.value)}
          onKeyDown={keys.keyDown}
        />
      </div>
      <p class="text-muted home-drawer__hint">
        {props.query
          ? "Enter adds it here. Ctrl/Cmd+Enter opens it. Drag a row into your data."
          : "Everything you have. Drag a row into your data, or click to add it."}
      </p>
      <Show when={props.pickPending}>
        <div class="home-drawer__picking" role="status">
          <span class="home-new-button__spinner" aria-hidden="true" />
          Adding it to your data…
        </div>
      </Show>
      {/* The rows read promises, and reading a pending promise SUSPENDS. Without
          a boundary here that suspension reaches the panel itself and the whole
          thing stays invisible until every read lands — which measured 9.6s and
          is indistinguishable from "Browse is slow". The chrome paints at once;
          only the list waits. */}
      <div id="locus-browse-results" class="home-drawer__list" role="listbox" aria-label="Results">
        <Loading fallback={<PendingResults />}><Results /></Loading>
      </div>
    </aside>
  );
}
