import { For, Show, createEffect, createSignal, onSettled } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import { IconArrowUp, IconChevronDown, IconChevronRight, IconByName, TYPE_ICON_FALLBACKS } from "./icons";
import { locusPathAccessibleName, locusPathEntries, locusPathNameMinChars, type LocusPathEntry } from "./locus-path";
import { scopeAncestors, scopeKey, scopeLabel, type LocusScope } from "./locus-scope";
import { LocusContextMenu } from "./locus-context-menu";
import { closeModalDialog, openModalDialog } from "./confirm-modal";
import { locusOpenMenuItems } from "./locus-menu-actions";
import { ValueHoverPreview } from "./value-hover-preview";
import { displayNameText, type DisplayNameInput } from "./display-name";
import { DisplayNameText } from "./display-name-text";
import type { WorkspacePendingNavigation } from "./workspace-pane";

/** Read left to right: account, containing path, current data, then up. */
export function LocusBreadcrumb(props: {
  scope: LocusScope;
  viewName?: (id: string) => string | undefined;
  itemName?: (viewId: string, itemId: string) => string | undefined;
  onNavigate: (scope: LocusScope) => void;
  onOpenLens?: (scope: LocusScope, mode?: "stack" | "split") => void;
  rootLabel?: string;
  /** The root data's name is separate from its account/source selector. */
  rootDataName?: string;
  subjectName?: DisplayNameInput;
  subjectUnnamed?: boolean;
  rootIcon?: string;
  rootControl?: JSX.Element;
  onAllData?: () => void;
  onOpenAllDataLens?: (mode?: "stack" | "split") => void;
  allData?: boolean;
  hideRoot?: boolean;
  typeLabel?: string;
  typeTerm?: string;
  typeIcon?: string;
  /** The current data's own mark when no reader thumbnail is supplied. */
  icon?: string;
  /** The owning reader reuses its collection thumbnail over each exact scope.
   * This chrome never evaluates data or selects representation instances. */
  renderScopeThumbnail?: (scope: LocusScope) => JSX.Element;
  /** The owning reader supplies the exact current type and scoped focus action. */
  typePreview?: () => JSX.Element;
  onTypeOpen?: () => void;
  /** A destination the lens already shows while its navigation commits. The
   * current data reads as its parent; going up takes the navigation back. */
  pending?: WorkspacePendingNavigation;
}) {
  const names = () => ({ viewName: props.viewName, itemName: props.itemName });
  const ancestors = () => scopeAncestors(props.scope);
  const containingPath = () => ancestors().filter(scope => props.onAllData || scope.kind !== "root");
  const label = (scope: LocusScope) => scope.kind === "root" ? props.rootDataName ?? (props.onAllData ? props.rootLabel : undefined) ?? "All data"
    : scope.kind === "value" && scope.path.length === 0 ? props.itemName?.(scope.viewId, scope.itemId)?.trim() || "Data"
    : scopeLabel(scope, names()).trim() || "Data";
  const unnamed = (scope: LocusScope) => scope.kind === "view" ? !props.viewName?.(scope.viewId)?.trim()
    : scope.kind === "value" && scope.path.length === 0 && !props.itemName?.(scope.viewId, scope.itemId)?.trim();
  const subjectLabel = (): DisplayNameInput => (displayNameText(props.subjectName)?.trim() ? props.subjectName : undefined) || (props.allData ? "All data" : props.onAllData && props.scope.kind === "root" ? props.rootLabel ?? "Data" : label(props.scope));
  /** The complete path, root first and current data last: the modal's list and
   * the narrow toolbar's one path button both read it. */
  const pathEntries = () => locusPathEntries({ ancestors: ancestors(), current: props.scope, allDataEntry: !!props.onAllData && !props.allData });
  const currentText = () => (props.subjectUnnamed ?? unnamed(props.scope)) ? "Data" : displayNameText(subjectLabel())?.trim() || "Data";
  const entryLabel = (entry: LocusPathEntry<LocusScope>) => entry.kind === "all-data" ? "All data" : entry.current ? currentText() : label(entry.scope);
  const pathName = () => locusPathAccessibleName(pathEntries().map(entryLabel));
  /** A narrow lens toolbar (`workspace-surface.css`, the `lens-toolbar` ≤540px
   * container query) replaces the path with one button when there is a path. */
  const compactable = () => !props.allData && pathEntries().length > 1;
  const compactName = () => props.pending ? displayNameText(props.pending.name)?.trim() || "Data" : currentText();
  const up = () => ancestors().at(-1);
  const [overflow, setOverflow] = createSignal(false);
  const [pathOpen, setPathOpen] = createSignal(false);
  const [menu, setMenu] = createSignal<{ x: number; y: number; scope: LocusScope; allData?: boolean }>();
  let trail: HTMLOListElement | undefined;
  let nav!: HTMLElement;
  const measure = () => {
    if (!trail || !trail.isConnected) { setOverflow(false); return; }
    const path = trail.parentElement!;
    const siblings = [...nav.children].filter(element => element !== path);
    const occupied = siblings.reduce((width, element) => width + element.getBoundingClientRect().width, 0);
    const gap = parseFloat(getComputedStyle(nav).columnGap) || 0;
    setOverflow(trail.scrollWidth > Math.max(0, nav.clientWidth - occupied - gap * siblings.length) + 1);
  };
  onSettled(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    measure();
    return () => observer.disconnect();
  });
  createEffect(() => [label(props.scope), ancestors().map(label), props.typeLabel], () => { queueMicrotask(measure); });
  function context(event: MouseEvent, scope: LocusScope, allData = false) {
    event.preventDefault(); event.stopPropagation();
    const next = { x: event.clientX, y: event.clientY, scope, allData };
    setPathOpen(false);
    // Finish the modal's focus restoration before the menu starts observing
    // outside focus. Sharing one Solid update lets that restoration close the
    // new menu immediately, depending on the browser's focus event timing.
    queueMicrotask(() => setMenu(next));
  }
  function navigate(scope: LocusScope) { setPathOpen(false); props.onNavigate(scope); }
  const typeContent = () => <><IconByName name={props.typeIcon ?? TYPE_ICON_FALLBACKS.Type} size={14} /><span>{props.typeLabel}</span></>;
  const scopeThumbnail = (scope: LocusScope) => <span class="locus-crumbs__thumbnail" aria-hidden="true"><Show
    when={props.renderScopeThumbnail} fallback={<IconByName name={scopeKey(scope) === scopeKey(props.scope)
      ? props.icon ?? (props.allData ? "list" : props.typeIcon) ?? TYPE_ICON_FALLBACKS.Data
      : scope.kind === "root" ? props.rootIcon ?? "list" : TYPE_ICON_FALLBACKS.Data} size={16} />}>
    {props.renderScopeThumbnail?.(scope)}
  </Show></span>;
  function PathDialog() {
    let dialog!: HTMLDialogElement;
    const previous = document.activeElement;
    onSettled(() => {
      openModalDialog(dialog);
      return () => { closeModalDialog(dialog); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
    });
    return <Portal><dialog ref={dialog} class="locus-path-dialog" aria-label="Data path"
      onCancel={event => { event.preventDefault(); setPathOpen(false); }} onClick={event => { if (event.target === dialog) setPathOpen(false); }}>
      <div class="locus-path-dialog__content">
        <h2>Data path</h2>
        <ol><For each={pathEntries()}>{entry => <li>{entry.kind === "all-data"
          ? <button class="locus-crumbs__link"
            onClick={() => { setPathOpen(false); props.onAllData?.(); }} onContextMenu={event => context(event, { kind: "root" }, true)}>
            <IconByName name="list" size={14} />{entryLabel(entry)}</button>
          : <button class={["locus-crumbs__link", { "locus-crumbs__link--current": entry.current }]} aria-current={entry.current ? "location" : undefined}
            onClick={() => navigate(entry.scope)} onContextMenu={event => context(event, entry.scope)}>
            {scopeThumbnail(entry.scope)}{entryLabel(entry)}
          </button>}
        </li>}</For></ol>
        <button class="btn" autofocus onClick={() => setPathOpen(false)}>Close</button>
      </div>
    </dialog></Portal>;
  }
  return <>
    <nav class={["locus-crumbs", { "locus-crumbs--nested": props.scope.kind !== "root", "locus-crumbs--compactable": compactable() }]} aria-label="Where you are" ref={nav}>
      <Show when={!props.allData}><span class={["locus-crumbs__account", { "locus-crumbs__account--link": !props.rootControl }]} onContextMenu={event => context(event, { kind: "root" }, !!props.onAllData)}>
        <Show when={props.rootControl} fallback={<button type="button" class="locus-crumbs__account-button"
          onClick={() => props.onAllData ? props.onAllData() : navigate({ kind: "root" })}><IconByName name={props.onAllData ? "list" : props.rootIcon ?? "user"} size={14} />
          <span>{props.onAllData ? "All data" : props.rootLabel ?? "Data"}</span></button>}>{props.rootControl}</Show>
      </span>
      <IconChevronRight class="locus-crumbs__sep" size={13} /></Show>
      <Show when={containingPath().length > 0}><div class={["locus-crumbs__path", { "locus-crumbs__path--collapsed": overflow() }]}>
        <ol ref={trail} class={['locus-crumbs__trail', { 'locus-crumbs__trail--collapsed': overflow() }]} aria-hidden={overflow() ? "true" : undefined}>
          <For each={containingPath()}>{ancestor => <li class="locus-crumbs__crumb">
            <button type="button" class="locus-crumbs__link" tabindex={overflow() ? -1 : 0}
              onClick={() => navigate(ancestor)} onContextMenu={event => context(event, ancestor)}>{scopeThumbnail(ancestor)}{label(ancestor)}</button>
            <IconChevronRight size={13} />
          </li>}</For>
        </ol>
        <Show when={overflow()}><button class="locus-crumbs__overflow" aria-label="Show full data path" aria-haspopup="dialog"
          aria-expanded={pathOpen() ? "true" : "false"} data-tooltip={pathName()} onClick={() => setPathOpen(true)}>…<IconChevronRight size={13} /></button></Show>
      </div></Show>
      {/* The narrow toolbar's whole path: the current data's mark and name, and
          the full path in the same modal the collapsed "…" opens. Hidden by
          default; `workspace-surface.css` shows it in place of the account
          link, the separators, the path and the current chip. */}
      <Show when={compactable()}><button type="button" class="locus-crumbs__compact" aria-haspopup="dialog"
        aria-expanded={pathOpen() ? "true" : "false"} aria-busy={props.pending ? "true" : undefined}
        aria-label={pathName()} data-tooltip={pathName()}
        onClick={() => setPathOpen(true)} onContextMenu={event => context(event, props.scope)}>
        <Show when={props.pending} keyed fallback={scopeThumbnail(props.scope)}>{pending => <span class="locus-crumbs__thumbnail" aria-hidden="true">
          <Show when={pending.icon || !pending.emoji} fallback={pending.emoji}><IconByName name={pending.icon ?? TYPE_ICON_FALLBACKS.Data} size={16} /></Show></span>}</Show>
        <span class="locus-crumbs__compact-name" style={{ "min-width": `${locusPathNameMinChars(compactName())}ch` }}>{compactName()}</span>
        <IconChevronDown class="locus-crumbs__compact-caret" size={12} />
      </button></Show>
      <span class="locus-crumbs__subject">
        <Show when={props.pending} keyed fallback={<span class="locus-crumbs__current" aria-current="page"
          onContextMenu={event => context(event, props.scope)}>
          {scopeThumbnail(props.scope)}
          <span class="locus-crumbs__here"><Show when={props.subjectUnnamed ?? unnamed(props.scope)} fallback={<DisplayNameText name={subjectLabel()} />}><em>Data</em></Show></span>
        </span>}>{pending => <button type="button" class="locus-crumbs__link" onClick={() => pending.cancel()}>
          {scopeThumbnail(props.scope)}
          <span class="locus-crumbs__here"><Show when={props.subjectUnnamed ?? unnamed(props.scope)} fallback={<DisplayNameText name={subjectLabel()} />}><em>Data</em></Show></span>
        </button>}</Show>
        <Show when={!props.pending && props.typeLabel}><Show when={props.typePreview && props.onTypeOpen} fallback={
          <span class="locus-crumbs__type" aria-label={"Current type: " + props.typeLabel}>{typeContent()}</span>
        }>
          <ValueHoverPreview class="locus-crumbs__type" label={props.typeLabel ?? "Type"}
            preview={() => props.typePreview!()} onOpen={() => props.onTypeOpen!()}>{typeContent()}</ValueHoverPreview>
        </Show></Show>
      </span>
      {/* Keyed: these nested conditions must never read a released navigation
          (a non-keyed accessor throws "Stale read from <Show>"). */}
      <Show when={props.pending} keyed>{pending => <>
        <IconChevronRight class="locus-crumbs__sep" size={13} />
        <span class="locus-crumbs__subject">
          <span class="locus-crumbs__current locus-crumbs__current--pending" aria-current="page" aria-busy="true">
            <span class="locus-crumbs__thumbnail" aria-hidden="true"><Show when={pending.icon || !pending.emoji} fallback={pending.emoji}>
              <IconByName name={pending.icon ?? TYPE_ICON_FALLBACKS.Data} size={16} /></Show></span>
            <span class="locus-crumbs__here"><Show when={displayNameText(pending.name)?.trim()} fallback={<em>Data</em>}><DisplayNameText name={pending.name} /></Show></span>
            <span class="home-new-button__spinner" aria-hidden="true" />
          </span>
        </span>
        <button type="button" class="locus-crumbs__up" onClick={() => pending.cancel()} aria-label="Go up"><IconArrowUp size={15} /></button>
      </>}</Show>
      <Show when={!props.pending && up()}>{parent => <button type="button" class="locus-crumbs__up" onClick={() => navigate(parent())}
        aria-label="Go up"><IconArrowUp size={15} /></button>}</Show>
      <Show when={!props.pending && !up() && props.onAllData && !props.allData}><button type="button" class="locus-crumbs__up" onClick={() => props.onAllData!()}
        aria-label="Go up"><IconArrowUp size={15} /></button></Show>
    </nav>
    <Show when={pathOpen()}><PathDialog /></Show>
    <Show when={menu()} keyed>{at => <LocusContextMenu x={at.x} y={at.y} label="Data path actions" onClose={() => setMenu(undefined)}
      items={locusOpenMenuItems(() => at.allData ? props.onAllData?.() : navigate(at.scope), at.allData ? props.onOpenAllDataLens : props.onOpenLens
        ? mode => { setPathOpen(false); props.onOpenLens!(at.scope, mode); } : undefined)} />}</Show>
  </>;
}
