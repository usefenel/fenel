import { Errored, For, Loading, Show, createEffect, createMemo, createSignal, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import { IconByName, IconWifiOff, LUCIDE_BY_NAME, TYPE_ICON_FALLBACKS } from "./icons";
import { ValueHoverPreview, ValueCardInlineContext, ValueCardCompactLayoutContext, ValueCardFocusedContext, useValueCardInline, useValueCardCompactLayout, type ValueCardCompactLayout } from "./value-hover-preview";
import { DataThumbnail } from "./data-transfer/DataPreview";
import { GlyphPictureImage, type GlyphPicture } from "./glyph-picture";
import { CornerMenuButton } from "./corner-menu";
import { ownsDataOpenEvent } from "./data-transfer/events";
import { displayNameText, valueCardLabel, type DisplayNameInput } from "./display-name";
export { valueCardLabel } from "./display-name";
import { DisplayNameText } from "./display-name-text";
import { chipSlice } from "./collection-chips";
export { useValueCardInline } from "./value-hover-preview";

/** Type captions are noun phrases; keep articles inside the description. */
export function valueCardTypeLabel(label: string | undefined): string | undefined {
  if (!label) return label;
  const phrase = label.replace(/^(?:a|an)\s+/i, "");
  return phrase !== label && phrase.length > 1 ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
}

/** Shared card chrome, including during the reader's early HTTP projection.
 * Type selection and content stay with the existing typed read surfaces. */
/** How many item circles a strip with room for `capacity` circles shows for
 * `count` items: all when they fit; otherwise one fewer, leaving room for the
 * "…"; with room for one circle only, that first item (no lone "…"). */
export function stripVisibleCount(capacity: number, count: number): number {
  if (capacity >= count) return count;
  return capacity >= 2 ? capacity - 1 : Math.max(0, Math.min(capacity, count));
}

/** How many circles a strip has room for, and whether its count yields its
 * place (A46 round 2, Nov 13: a graph card read "3 … 3 items" for three
 * items). `room` is the strip's inner width without the count; the count
 * ("3 items") takes `countWidth` plus `gap` beside the circles. When every
 * item fits only without the count, all items are shown and the count yields
 * (it says nothing the circles do not); otherwise the count keeps its place.
 * `countOnlyWhenElided` (the recipe card, Rom Nov 13): the count yields
 * whenever every item is shown, and stays only beside an elided strip. */
export function stripCapacity(input: { items: number; room: number; countWidth: number; gap: number; diameter: number; step: number;
  countOnlyWhenElided?: boolean }):
  { capacity: number; countYields: boolean } {
  const fit = (space: number) => input.diameter > 0 && space >= input.diameter
    ? Math.floor((space - input.diameter + 0.5) / Math.max(1, input.step)) + 1 : 0;
  const withCount = fit(input.room - input.countWidth - input.gap);
  const alone = fit(input.room);
  const countYields = input.items > 0 && input.items <= alone && (!!input.countOnlyWhenElided || input.items > withCount);
  return { capacity: countYields ? alone : withCount, countYields };
}

export function ValueCard(props: {
  heading: JSX.Element;
  /** The value's own description (already cut to what the card shows), under its name. */
  description?: string;
  children?: JSX.Element;
  actions?: JSX.Element;
  class?: string;
  /** Body composes the same data without card chrome; inline bounds it and
   * graph folds only its caption into a badge. */
  presentation?: "full" | "inline" | "graph" | "body";
  /** Text/signatures stay one line; hover cards inherit the two-line caption. */
  compactLayout?: ValueCardCompactLayout;
  itemId?: string;
  previewId?: string;
  busy?: boolean;
  loadingLabel?: string;
  code?: () => string;
  codeOpen?: boolean;
  cut?: boolean;
  onOpen?: () => void;
  /** The caller owns the shared menu and toggles it from this trigger. */
  menuOpen?: boolean;
  onMenu?: (event: MouseEvent) => void;
}) {
  const inheritedInline = useValueCardInline();
  const inheritedLayout = useValueCardCompactLayout();
  const inline = () => props.presentation ? props.presentation === "inline" : inheritedInline();
  const layout = () => props.compactLayout ?? (props.presentation === "inline" ? "one-line" : inheritedLayout());
  const showCode = () => !!props.codeOpen;
  const body = () => <Show when={showCode()} fallback={
    <Show when={!props.busy} fallback={<CardLoadingIndicator label={props.loadingLabel} />}>{props.children}</Show>
  }><pre class="home-item__code">{props.code?.()}</pre></Show>;
  function openBody(event: MouseEvent) {
    if (!props.onOpen || !ownsDataOpenEvent(event, event.currentTarget as Element)) return;
    event.stopPropagation();
    props.onOpen();
  }
  return <ValueCardInlineContext value={inline}><ValueCardCompactLayoutContext value={layout}><Show when={props.presentation === "body"} fallback={<article class={["home-item", "home-item--flow", props.class, {
    "corner-menu-host": !!props.onMenu,
    "home-item--preparing": !!props.busy && !showCode(), "home-item--inline": inline(),
    "home-item--inline-two-line": inline() && layout() === "two-line",
    "home-item--graph-body": props.presentation === "graph",
  }]}
    data-locus-item={props.itemId} data-locus-preview={props.previewId} data-cut={props.cut ? "true" : undefined}
    tabindex={props.onOpen ? 0 : undefined}
    onKeyDown={event => {
      if (!props.onOpen || event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault(); event.stopPropagation(); props.onOpen();
    }}
    aria-busy={props.busy && !showCode() ? "true" : undefined}
    onContextMenu={event => { if (!event.defaultPrevented) props.onMenu?.(event); }}>
    <ValueCardInlineContext value={() => props.presentation === "graph" || inline()}>
    <ValueCardCompactLayoutContext value={() => props.presentation === "graph" ? "one-line" : layout()}>
    <div class="home-item__header">
      {props.heading}
      {props.actions}
    </div>
    </ValueCardCompactLayoutContext></ValueCardInlineContext>
    <Show when={props.description}><p class="home-item__description">{props.description}</p></Show>
    <Show when={props.onMenu}>
      <CornerMenuButton onMenu={event => props.onMenu?.(event)} open={props.menuOpen} />
    </Show>
    <div class="home-item__body" onClick={openBody}>
      <ValueCardFocusedContext value={() => false}>{body()}</ValueCardFocusedContext>
    </div>
  </article>}><div class="home-value-body" data-locus-item={props.itemId} data-locus-preview={props.previewId}
    aria-busy={props.busy && !showCode() ? "true" : undefined}>
    <Show when={props.actions}><div class="home-value-body__actions">{props.actions}</div></Show>
    <ValueCardFocusedContext value={() => true}>{body()}</ValueCardFocusedContext>
  </div></Show></ValueCardCompactLayoutContext></ValueCardInlineContext>;
}

/** The position of a list item. A vertical list and a grid keep the number and
 *  the up/down arrows on the left. A horizontal list puts that same rail above
 *  the card, and the arrows point left and right. Ends stay visible and do nothing. */
export function ListOrderRail(props: {
  index: number;
  count: number;
  direction?: "horizontal" | "vertical";
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const horizontal = () => props.direction === "horizontal";
  return <div class="home-item-rail" data-direction={horizontal() ? "horizontal" : "vertical"}>
    <span class="home-item-rail__index">{props.index + 1}</span>
    <button type="button" class="home-item-rail__move" aria-label={horizontal() ? "Move left" : "Move up"}
      data-tooltip={horizontal() ? "Move left" : "Move up"}
      disabled={props.index <= 0} onClick={(event) => { event.stopPropagation(); props.onMoveUp(); }}>
      <IconByName name={horizontal() ? "arrow-left" : "arrow-up"} size={14} />
    </button>
    <button type="button" class="home-item-rail__move" aria-label={horizontal() ? "Move right" : "Move down"}
      data-tooltip={horizontal() ? "Move right" : "Move down"}
      disabled={props.index >= props.count - 1} onClick={(event) => { event.stopPropagation(); props.onMoveDown(); }}>
      <IconByName name={horizontal() ? "arrow-right" : "arrow-down"} size={14} />
    </button>
  </div>;
}

/** The shared type caption used by cards and expression argument labels. */
export function ValueTypeCaption(props: { label?: string; icon?: string }) {
  const icon = () => props.icon && LUCIDE_BY_NAME[props.icon] ? props.icon : props.label ? TYPE_ICON_FALLBACKS.Type : undefined;
  return <><span class="home-item__type-icon" aria-hidden="true"><IconByName name={icon()} size={14} /></span><span class="home-item__type-label">{valueCardTypeLabel(props.label)}</span></>;
}

/** `caption` is a human label (a string) or a picked display name; a code
 * name renders in the shared code face (`display-name-text.tsx`). */
export function ValueCardCaption(props: { caption?: DisplayNameInput; unnamed?: boolean; typeLabel?: string; typeTerm?: string; typeIcon?: string; icon?: string; emoji?: string; picture?: GlyphPicture;
  typePending?: boolean;
  /** Context already supplies the common type; generated positions add no name. */
  hideCaption?: boolean;
  hideType?: boolean;
  /** The reader failed to answer this type: offer Retry in its place. */
  onTypeRetry?: () => void;
  /** The reader has not answered this data's name yet: keep its place muted,
   * never a code name or the generic "Data". */
  captionPending?: boolean;
  /** The reader failed to answer this name: offer Retry in its place. */
  onCaptionRetry?: () => void;
  unsaved?: boolean;
  presentation?: "full" | "inline"; compactLayout?: ValueCardCompactLayout; onOpen?: () => void; onTypeContext?: (event: MouseEvent) => void;
  typePreview?: () => JSX.Element; onTypeOpen?: () => void }) {
  const inheritedInline = useValueCardInline();
  const inheritedLayout = useValueCardCompactLayout();
  const inline = () => props.presentation ? props.presentation === "inline" : inheritedInline();
  const layout = () => props.compactLayout ?? (props.presentation === "inline" ? "one-line" : inheritedLayout());
  const unsaved = createMemo(() => !!props.unsaved);
  const typeLabel = () => props.typeLabel?.trim() || "Anything";
  const typeContent = () => <ValueTypeCaption label={typeLabel()} icon={props.typeIcon} />;
  const captionText = () => displayNameText(props.caption)?.trim();
  const unsavedMarker = () => <Show when={unsaved()}>
    <span class="home-item__unsaved" role="img" aria-label="Unsaved changes"
      data-tooltip="Unsaved changes. Save or turn synchronization on."><IconByName name="alert-triangle" size={12} /></span>
  </Show>;
  const captionContent = () => <><Show when={!props.captionPending} fallback={<Show when={props.onCaptionRetry} fallback={<span class="home-item__caption-label home-item__caption-label--reserved" role="status" aria-label="Loading name" />}>
    <span class="home-item__caption-label"><span class="text-muted" role="alert">Name unavailable.</span>{" "}<button type="button" class="expr-form__btn"
      onClick={event => { event.stopPropagation(); props.onCaptionRetry?.(); }}>Retry</button></span></Show>}><span class="home-item__caption-label"><Show when={!props.unnamed && captionText()} fallback={<em>Data</em>}><DisplayNameText name={props.caption} /></Show></span></Show>{unsavedMarker()}</>;
  return <div class={["home-item__caption-block", { "home-item__caption-block--no-icon": !props.picture && !props.icon && !props.emoji,
    "home-item__caption-block--unnamed": !props.captionPending && (!!props.unnamed || !captionText()),
    "home-item__caption-block--inline": inline(),
    "home-item__caption-block--inline-two-line": inline() && layout() === "two-line",
    // Nothing to show (content-first card): the header collapses (app.css).
    "home-item__caption-block--bare": !!props.hideCaption && !!props.hideType && !props.picture && !props.icon && !props.emoji && !unsaved() }]}>
    <Show when={props.picture || props.icon || props.emoji}>
      <span class="home-item__value-icon" aria-hidden="true"><GlyphPictureImage picture={props.picture} fallback={<Show when={props.icon} fallback={props.emoji}>
        <IconByName name={props.icon} size={15} />
      </Show>} /></span>
    </Show>
    <Show when={!props.hideCaption} fallback={unsavedMarker()}>
    <Show when={props.onOpen && !(props.captionPending && props.onCaptionRetry)} fallback={<span class="home-item__caption">{captionContent()}</span>}>
      <button type="button" class="home-item__caption home-item__caption--link"
        aria-label={props.captionPending || props.unnamed || !captionText() ? "Open this data" : undefined}
        onClick={event => { event.stopPropagation(); props.onOpen?.(); }}>{captionContent()}</button>
    </Show>
    </Show>
    <Show when={!props.hideType}>
    <Show when={!props.typePending} fallback={<Show when={props.onTypeRetry} fallback={<span class="home-item__type-tag home-item__type-tag--reserved" role="status" aria-label="Loading data type">Type</span>}>
      <span class="home-item__type-tag"><span class="text-muted" role="alert">Type unavailable.</span>{" "}<button type="button" class="expr-form__btn"
        onClick={event => { event.stopPropagation(); props.onTypeRetry?.(); }}>Retry</button></span></Show>}>
      <Show when={props.typePreview && props.onTypeOpen} fallback={
        <Show when={props.onTypeContext} fallback={<span class="home-item__type-tag">{typeContent()}</span>}>
          <button type="button" class="home-item__type-tag" aria-haspopup="menu"
            onClick={event => { event.stopPropagation(); props.onTypeContext?.(event); }}
            onContextMenu={event => props.onTypeContext?.(event)}>{typeContent()}</button>
        </Show>
      }>
        <ValueHoverPreview class="home-item__type-tag" label={typeLabel()}
          preview={() => props.typePreview!()} onOpen={() => props.onTypeOpen!()}
          onContextMenu={props.onTypeContext}>
          <span>{typeContent()}</span>
        </ValueHoverPreview>
      </Show>
    </Show>
    </Show>
  </div>;
}

/** The value could not be reached. Same mark in a card and in a small preview. */
export function DataUnavailable(props: { label?: string }) {
  return <span class="data-unavailable" role="status" data-tooltip={props.label ?? "The server could not be reached."}>
    <IconWifiOff size={18} />
    <span class="data-unavailable__label">Unavailable</span>
  </span>;
}

/** B3: a row's pending value, sized like one line of text so a table, calendar,
 * timeline or tree row keeps its geometry while the worker answers. */
export function RowPending() {
  return <span class="home-row-pending" role="status" aria-label="Loading data">
    <span class="home-new-button__spinner" aria-hidden="true" /></span>;
}

export function CardLoadingIndicator(props: { label?: string }) {
  return <span class={["home-item__loading", { "home-item__loading--label": !!props.label }]} role="status" aria-label={props.label ?? "Loading data"}>
    <span class="home-new-button__spinner" aria-hidden="true" />
    <Show when={props.label}><span class="home-item__loading-label">{props.label}</span></Show>
  </span>;
}

/** Full and two-line cards preview their items; text-sized cards retain count. */
export function CollectionPreviewStrip<T>(props: {
  items: readonly T[];
  label: string;
  countLabel?: string;
  /** The count shows only beside an elided strip (stripCapacity). */
  countOnlyWhenElided?: boolean;
  /** The existing two-line compact card keeps small previews beside count. */
  inlinePreviews?: boolean;
  render: (item: T, index: number) => JSX.Element;
  preview: (item: T, index: number) => JSX.Element;
  itemLabel: (item: T, index: number) => string;
  /** Container-owned graph ports; the existing list presentation owns items. */
  itemControl?: (item: T, index: number) => JSX.Element;
  onOpenItem?: (item: T, index: number) => void;
  onItemContextMenu?: (event: MouseEvent, item: T, index: number) => void;
  onEnterCollection?: () => void;
}) {
  const inline = useValueCardInline();
  const compactLayout = useValueCardCompactLayout();
  const showPreviews = () => !inline() || !!props.inlinePreviews || compactLayout() === "two-line";
  let strip!: HTMLDivElement;
  let stack: HTMLDivElement | undefined;
  let count!: HTMLSpanElement;
  const [capacity, setCapacity] = createSignal(0);
  const [countYields, setCountYields] = createSignal(false);
  // Polish lane 2 (Nov 9): room for one circle shows the first item, never
  // a lone "…" (a calendar cell); the ellipsis needs a shown item beside it.
  const visibleCount = createMemo(() => stripVisibleCount(capacity(), props.items.length));
  // Browser geometry selects the visible slice. The count and, when needed,
  // the entry ellipsis keep their space without rendering hidden data items.
  const measure = () => {
    if (!strip.isConnected || !stack?.isConnected) { setCountYields(false); setCapacity(0); return; }
    let cell = stack.querySelector<HTMLElement>(".locus-previews__cell");
    // At first paint, or after a real zero-capacity measurement, no data
    // circle exists to measure. Use only the same empty CSS geometry here:
    // no thumbnail/hover owner is mounted and no hidden data is read.
    let probe: HTMLDivElement | undefined;
    if (!cell) {
      probe = document.createElement("div");
      probe.className = "locus-previews__item";
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
      const sizingCell = document.createElement("button");
      sizingCell.type = "button";
      sizingCell.tabIndex = -1;
      sizingCell.className = "locus-previews__cell value-hover-preview";
      probe.append(sizingCell);
      stack.append(probe);
      cell = sizingCell;
    }
    try {
      const style = getComputedStyle(strip);
      const stackStyle = getComputedStyle(stack);
      const item = cell.closest<HTMLElement>(".locus-previews__item");
      const cellStyle = getComputedStyle(item && getComputedStyle(item).display !== "contents" ? item : cell);
      const diameter = cell.getBoundingClientRect().width;
      if (!(diameter > 0)) { setCountYields(false); setCapacity(0); return; }
      const step = Math.max(1, diameter + (parseFloat(cellStyle.marginRight) || 0));
      const room = strip.clientWidth
        - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
        - (parseFloat(stackStyle.paddingLeft) || 0) - (parseFloat(stackStyle.paddingRight) || 0)
        - (parseFloat(cellStyle.marginRight) || 0);
      // The count keeps its natural width while it yields (it is only hidden),
      // so a strip that grows gives it its place back.
      const plan = stripCapacity({ items: props.items.length, room, countWidth: count.scrollWidth,
        gap: parseFloat(style.columnGap) || 0, diameter, step, countOnlyWhenElided: props.countOnlyWhenElided });
      setCountYields(plan.countYields);
      setCapacity(plan.capacity);
    } finally { probe?.remove(); }
  };
  onSettled(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    observer.observe(count);
    measure();
    return () => observer.disconnect();
  });
  createEffect(() => [props.items, props.countLabel, inline(), showPreviews()], () => { queueMicrotask(measure); });
  return <div ref={strip} class={["locus-previews", { "locus-previews--inline": inline(), "locus-previews--inline-with-items": inline() && showPreviews() }]}>
    {/* Empty data says nothing (Rom): no "Empty list", no "0 items". */}
    <Show when={showPreviews()}><Show when={props.items.length > 0}>
      <div ref={stack} class="locus-previews__stack" role="group" aria-label={props.label}>
        <For each={props.items.slice(0, visibleCount())}>{(item, index) => <div class="locus-previews__item">
          {props.itemControl?.(item, index())}
          <ValueHoverPreview class="locus-previews__cell" label={props.itemLabel(item, index())}
            onContextMenu={event => props.onItemContextMenu?.(event, item, index())}
            onOpen={props.onOpenItem ? () => props.onOpenItem?.(item, index()) : undefined} preview={() => props.preview(item, index())}>
            <div class="locus-previews__content" inert>
              <Errored fallback={() => <DataThumbnail value={undefined} />}>
                <Loading fallback={<DataThumbnail value={undefined} />}>
                  {props.render(item, index())}
                </Loading>
              </Errored>
            </div>
          </ValueHoverPreview>
        </div>
        }</For>
        <Show when={visibleCount() < props.items.length && visibleCount() > 0 && visibleCount() < capacity()}>
          <Show when={props.onEnterCollection} fallback={<span class="locus-previews__cell locus-previews__cell--more" aria-hidden="true">…</span>}>
          <button type="button" class="locus-previews__cell locus-previews__cell--more" aria-label={`${props.items.length - visibleCount()} more items`}
            data-tooltip="Enter this data" onClick={event => { event.stopPropagation(); props.onEnterCollection?.(); }}>…</button>
          </Show>
        </Show>
      </div>
    </Show></Show>
    <span ref={count} class={["locus-previews__count", { "locus-previews__count--yielded": countYields() }]}>{props.items.length === 0 ? ""
      : props.countLabel ?? `${props.items.length} ${props.items.length === 1 ? "item" : "items"}`}</span>
  </div>;
}

/** A list inside a record field, where a reader looks for what it holds: each
 * item is its mark and its short name, as small wrapping chips (about twelve,
 * then "+N", which enters the list). An item with a web address opens it in a
 * new tab; any other opens like a strip circle. Tight places (tiles, table and
 * calendar cells, compact cards) keep the marks-only strip. */
export function CollectionChips<T>(props: {
  items: readonly T[];
  label: string;
  render: (item: T, index: number) => JSX.Element;
  preview: (item: T, index: number) => JSX.Element;
  itemLabel: (item: T, index: number) => string;
  itemName: (item: T, index: number) => string | undefined;
  itemHref?: (item: T, index: number) => string | undefined;
  onOpenItem?: (item: T, index: number) => void;
  onItemContextMenu?: (event: MouseEvent, item: T, index: number) => void;
  onEnterCollection?: () => void;
}) {
  const slice = createMemo(() => chipSlice(props.items.length));
  return <Show when={props.items.length > 0}>
    <div class="locus-chips" role="list" aria-label={props.label}>
      <For each={props.items.slice(0, slice().shown)}>{(item, index) => {
        const face = () => <>
          <span class="locus-chips__mark" inert>
            <Errored fallback={() => <DataThumbnail value={undefined} />}>
              <Loading fallback={<DataThumbnail value={undefined} />}>{props.render(item, index())}</Loading>
            </Errored>
          </span>
          <Show when={props.itemName(item, index())}>{name => <span class="locus-chips__name">{name()}</span>}</Show>
        </>;
        return <span class="locus-chips__item" role="listitem">
          <Show when={props.itemHref?.(item, index())} fallback={
            <ValueHoverPreview class="locus-chips__chip" label={props.itemLabel(item, index())}
              onContextMenu={event => props.onItemContextMenu?.(event, item, index())}
              onOpen={props.onOpenItem ? () => props.onOpenItem?.(item, index()) : undefined} preview={() => props.preview(item, index())}>
              {face()}
            </ValueHoverPreview>}>
            {href => <a class="locus-chips__chip locus-chips__chip--link" href={href()} target="_blank" rel="noopener noreferrer"
              data-tooltip={href()} onClick={event => event.stopPropagation()}>{face()}</a>}
          </Show>
        </span>;
      }}</For>
      <Show when={slice().more > 0}>
        <span class="locus-chips__item" role="listitem">
          <Show when={props.onEnterCollection} fallback={<span class="locus-chips__chip locus-chips__chip--more">+{slice().more}</span>}>
            <button type="button" class="locus-chips__chip locus-chips__chip--more" aria-label={`${slice().more} more items`}
              data-tooltip="Enter this data" onClick={event => { event.stopPropagation(); props.onEnterCollection?.(); }}>+{slice().more}</button>
          </Show>
        </span>
      </Show>
    </div>
  </Show>;
}
