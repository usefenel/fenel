import { For, Show, createEffect, createSignal, onCleanup, onSettled, untrack } from "solid-js";
import { Dynamic, Portal } from "@solidjs/web";
import { IconAsterisk, LUCIDE_BY_NAME } from "./icons";
import { noteLocusMenuDismissal } from "./locus-menu-gesture";
import { TextWithCodeName } from "./display-name-text";
import "./locus-context-menu.css";

export type LocusMenuItem = {
  id: string;
  label: string;
  /** The part of `label` that is a code name (no human label exists): shown
   *  in the shared code face (`display-name-text.tsx`). */
  labelCode?: string;
  /** A kebab-case `Iconable.icon` NAME, resolved by the renderer. Naming the
   *  icon instead of passing a component keeps this menu free of the icon set
   *  and matches how every other surface reads a type's icon. */
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  /** A secondary way on in the same section (the full picker after quick choices): italic. */
  emphasis?: boolean;
  /** Set on every option of a single-choice list (a dropdown): the item is
   *  then a `menuitemradio`, so a screen reader hears which one is current
   *  and not only the sighted user who sees its highlight. */
  checked?: boolean;
  /** Hover help, through the app's `data-tooltip`. */
  tooltip?: string;
  onSelect?: () => void;
  /** Start optional submenu work only from its pointer/keyboard opening path.
   * Repeated open intents can precede a reactive commit; async callers retain
   * their own current-menu and once guards. Focus repair never calls this. */
  onOpen?: () => void;
  /** An explicit query expansion keeps its menu and keyboard focus in place. */
  keepOpen?: boolean;
  children?: readonly LocusMenuItem[];
};

export type LocusContextMenuProps = {
  x: number;
  y: number;
  items: readonly LocusMenuItem[];
  onClose: () => void;
  /** The item that takes focus when the menu opens, as a dropdown focuses its
   *  current option; the first enabled item when absent or disabled. */
  focusId?: string;
  /** The menu's accessible name; a dropdown passes its own label. */
  label?: string;
  /** The actual control that opened a dropdown, including pointer platforms
   * where clicking a button does not move document focus. */
  opener?: Element;
};

let menuSequence = 0;

/** The press that closed a menu also clicks the button under it. Swallow that
 *  one click so a second press on an open dropdown closes it and stays closed. */
function swallowOpenerClick(opener: Element) {
  const stop = (event: Event) => {
    const target = event.target;
    if (target instanceof Node && opener.contains(target)) {
      event.preventDefault();
      event.stopPropagation();
    }
    document.removeEventListener("click", stop, true);
  };
  document.addEventListener("click", stop, true);
  setTimeout(() => document.removeEventListener("click", stop, true), 500);
}

/** A browser-only menu leaf: item handlers own navigation, authoring and IO. */
export function LocusContextMenu(props: LocusContextMenuProps) {
  let root!: HTMLDivElement;
  const rootMenuId = `locus-menu-${++menuSequence}`;
  const previousFocus = untrack(() => props.opener ?? document.activeElement);
  // Dropdowns stay in the opener's modal layer. Native dialogs make body
  // siblings inert; shared overlays establish their own higher paint layer.
  const portalMount = previousFocus instanceof Element
    ? previousFocus.closest("dialog[open], [data-modal-transition]")
      ?? previousFocus.closest('[role="dialog"][aria-modal="true"]')
    : null;
  let closed = false;
  let menuFocus: { element: HTMLElement; path: Array<{ panelId: string; itemId?: string }> } | undefined;
  let retiringFocus: Element | undefined;
  let focusRepairQueued = false;

  function rememberFocus(event: FocusEvent) {
    if (!(event.target instanceof HTMLElement)) return;
    const path: Array<{ panelId: string; itemId?: string }> = [];
    let branch: Element = event.target;
    let panel = branch.closest<HTMLElement>('[role="menu"]');
    while (panel && root.contains(panel)) {
      const item = branch.closest(".locus-context-menu-row")?.querySelector<HTMLElement>(":scope > [data-locus-menu-item]");
      path.push({ panelId: panel.id, itemId: item?.closest('[role="menu"]') === panel ? item.dataset.locusMenuItem : undefined });
      branch = panel.parentElement!;
      panel = branch.closest<HTMLElement>('[role="menu"]');
    }
    menuFocus = { element: event.target, path };
  }

  function leaveFocus(event: FocusEvent) {
    if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return;
    // Chromium dispatches focusout before physically detaching a removed row.
    // Only the exact focused node observed by its disposing owner may recover;
    // an explicit blur must relinquish focus even when rows change afterwards.
    if (event.target !== retiringFocus) menuFocus = undefined;
  }

  function noteRetiringFocus(row: HTMLElement) {
    if (row.contains(document.activeElement)) retiringFocus = document.activeElement ?? undefined;
  }

  function repairFocusAfterItems() {
    if (focusRepairQueued) return;
    focusRepairQueued = true;
    queueMicrotask(() => {
      focusRepairQueued = false;
      if (closed || !root.isConnected || !menuFocus) return;
      const active = document.activeElement;
      if (menuFocus.element.isConnected) {
        // A pending panel itself can retain focus while its first rows arrive.
        if (active !== menuFocus.element || active.getAttribute("role") !== "menu") return;
      } else if (active !== document.body || retiringFocus !== menuFocus.element) return;
      for (const entry of menuFocus.path) {
        const panel = document.getElementById(entry.panelId);
        if (!panel || !root.contains(panel)) continue;
        const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[data-locus-menu-item]:not(:disabled)')]
          .filter(button => button.closest('[role="menu"]') === panel);
        const target = buttons.find(button => button.dataset.locusMenuItem === entry.itemId) ?? buttons[0] ?? panel;
        if (target !== active) (target as HTMLElement).focus({ preventScroll: true });
        break;
      }
      retiringFocus = undefined;
    });
  }

  function fadeOut(panel: HTMLDivElement) {
    if (!panel.isConnected || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Logical dismissal stays synchronous. A short-lived inert copy preserves
    // only the paint, so another right-click or dropdown press is never blocked
    // by the old menu's animation, listeners, focus or activation handlers.
    const leaving = document.createElement("div");
    leaving.className = "locus-context-menu-root locus-context-menu-root--leaving";
    leaving.setAttribute("aria-hidden", "true");
    leaving.inert = true;
    const copy = panel.cloneNode(true) as HTMLDivElement;
    copy.classList.add("locus-context-menu--leaving");
    copy.style.setProperty("--locus-menu-exit-opacity", getComputedStyle(panel).opacity);
    copy.removeAttribute("id");
    // Each nested panel owns its own fade and fixed position.
    copy.querySelectorAll(".locus-context-menu").forEach((child) => child.remove());
    copy.querySelectorAll("[id], [data-tooltip], [data-locus-menu-item]").forEach((element) => {
      element.removeAttribute("id");
      element.removeAttribute("data-tooltip");
      element.removeAttribute("data-locus-menu-item");
    });
    leaving.append(copy);
    (portalMount ?? document.body).append(leaving);
    const timer = setTimeout(() => leaving.remove(), 180);
    copy.addEventListener("animationend", () => { clearTimeout(timer); leaving.remove(); }, { once: true });
  }

  function close(restoreFocus = false) {
    if (closed) return;
    closed = true;
    if (restoreFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    props.onClose();
  }

  onSettled(() => {
    const outside = (event: Event) => {
      if (closed) return;
      if (!(event.target instanceof Node) || root.contains(event.target)) return;
      // The surface underneath may open its own menu on a tap. Telling it which
      // gesture dismissed this one is what keeps that tap a dismissal.
      noteLocusMenuDismissal(event);
      // The opener still says it is expanded until this close re-renders.
      // The click that follows this press would otherwise open the menu again.
      const opener = event.target instanceof Element ? event.target.closest("[aria-expanded='true']") : null;
      if (opener) swallowOpenerClick(opener);
      close();
    };
    const blur = () => close();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    root.addEventListener("focusin", rememberFocus);
    root.addEventListener("focusout", leaveFocus);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      root.removeEventListener("focusin", rememberFocus);
      root.removeEventListener("focusout", leaveFocus);
      window.removeEventListener("blur", blur);
    };
  });

  type PanelProps = {
    id: string;
    items: readonly LocusMenuItem[];
    label: string;
    anchor?: HTMLButtonElement;
    onBack?: () => void;
    focusId?: string;
  };

  function MenuPanel(panelProps: PanelProps) {
    let panel!: HTMLDivElement;
    const buttons = new Map<string, HTMLButtonElement>();
    const [openChild, setOpenChild] = createSignal<string>();
    let activeId: string | undefined;
    let focusFrame: number | undefined;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    let search = "";

    // The point the menu opened at, as the effect below last tracked it. The
    // resize observer and window listeners re-place the panel from here, so
    // no imperative path reads the reactive props outside a tracking scope.
    let point = untrack(() => ({ x: props.x, y: props.y }));

    function place() {
      if (!panel) return;
      const margin = 8;
      const { width, height } = panel.getBoundingClientRect();
      const anchor = panelProps.anchor?.getBoundingClientRect();
      let left = anchor ? anchor.right - 1 : point.x;
      const top = anchor ? anchor.top - 5 : point.y;
      if (anchor && left + width > window.innerWidth - margin) left = anchor.left - width + 1;
      panel.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - width - margin))}px`;
      panel.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`;
      panel.style.visibility = "visible";
    }

    function enabled() { return panelProps.items.filter((item) => !item.disabled); }

    function focusItem(id: string, moveFocus = true) {
      activeId = id;
      for (const [key, button] of buttons) button.tabIndex = key === id ? 0 : -1;
      if (moveFocus) buttons.get(id)?.focus({ preventScroll: true });
    }

    function focusEdge(last = false) {
      const items = enabled();
      const item = last ? items.at(-1) : items[0];
      if (item) focusItem(item.id);
      else panel.focus();
    }

    function childId(item: LocusMenuItem) { return `${panelProps.id}-${encodeURIComponent(item.id)}`; }

    function open(item: LocusMenuItem, moveFocus: boolean) {
      if (item.disabled || !item.children?.length) return;
      item.onOpen?.();
      setOpenChild(item.id);
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      if (moveFocus) {
        // Solid commits the submenu before the next paint; focus belongs on
        // its first enabled item once that DOM exists.
        focusFrame = requestAnimationFrame(() => {
          focusFrame = undefined;
          const child = document.getElementById(childId(item));
          (child?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? child)?.focus();
        });
      }
    }

    function select(item: LocusMenuItem) {
      if (item.disabled) return;
      if (!item.onSelect && item.children?.length) return open(item, true);
      if (item.keepOpen) {
        if (focusFrame !== undefined) { cancelAnimationFrame(focusFrame); focusFrame = undefined; }
        panel.focus({ preventScroll: true }); activeId = undefined; item.onSelect?.(); return;
      }
      close();
      // Keep this in the original activation event: Clipboard API permissions
      // depend on user activation, including when the callback opens a modal.
      item.onSelect?.();
    }

    function keydown(event: KeyboardEvent) {
      if ((event.target as Element).closest('[role="menu"]') !== panel) return;
      const items = enabled();
      const index = items.findIndex((item) => item.id === activeId);
      const active = items[index];
      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp": {
          const offset = event.key === "ArrowDown" ? 1 : -1;
          const next = items[(index + offset + items.length) % items.length];
          setOpenChild(undefined);
          if (next) focusItem(next.id);
          break;
        }
        case "Home": setOpenChild(undefined); focusEdge(); break;
        case "End": setOpenChild(undefined); focusEdge(true); break;
        case "ArrowRight": if (active) open(active, true); break;
        case "ArrowLeft": panelProps.onBack?.(); break;
        case "Escape": close(true); break;
        case "Tab": close(true); event.stopPropagation(); return;
        case "Enter":
        case " ": if (active) select(active); break;
        default: {
          if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
          clearTimeout(searchTimer);
          search += event.key.toLocaleLowerCase();
          searchTimer = setTimeout(() => { search = ""; }, 500);
          const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
          const match = ordered.find((item) => item.label.toLocaleLowerCase().startsWith(search));
          if (match) { setOpenChild(undefined); focusItem(match.id); }
        }
      }
      event.preventDefault();
      event.stopPropagation();
    }

    createEffect(() => [props.x, props.y, panelProps.items] as const, ([x, y, items]) => {
      const moved = point.x !== x || point.y !== y;
      point = { x, y };
      if (moved || !items.some(item => item.id === untrack(openChild) && item.children?.length)) setOpenChild(undefined);
      place();
      repairFocusAfterItems();
    });

    onSettled(() => {
      place();
      if (!panelProps.anchor) {
        // Focus dispatches DOM events synchronously. Their handlers can read
        // lazy controls or mount content, which Solid 2 forbids in an owned
        // onSettled callback. Hand focus over after that callback has returned.
        focusFrame = requestAnimationFrame(() => {
          focusFrame = undefined;
          if (closed || !panel.isConnected) return;
          const initial = panelProps.focusId === undefined ? undefined : enabled().find((item) => item.id === panelProps.focusId);
          if (initial) focusItem(initial.id);
          else focusEdge();
        });
      }
      const observer = new ResizeObserver(place);
      observer.observe(panel);
      window.addEventListener("resize", place);
      // A scrolled parent menu moves the row anchoring its open submenu.
      window.addEventListener("scroll", place, true);
      return () => {
        observer.disconnect();
        window.removeEventListener("resize", place);
        window.removeEventListener("scroll", place, true);
      };
    });

    onCleanup(() => {
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      clearTimeout(searchTimer);
      fadeOut(panel);
    });

    return (
      <div ref={panel} id={panelProps.id} class="locus-context-menu" role="menu" aria-label={panelProps.label} tabindex={-1} onKeyDown={keydown}>
        <For each={panelProps.items}>{(item, index) => {
          let row!: HTMLDivElement;
          onCleanup(() => noteRetiringFocus(row));
          return (
          <>
            <Show when={item.separatorBefore && index() > 0}><div class="locus-context-menu-separator" role="separator" /></Show>
            <div ref={row} class="locus-context-menu-row" role="none">
              <button
                ref={(element) => { buttons.set(item.id, element); }}
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked === undefined ? undefined : item.checked ? "true" : "false"}
                data-tooltip={item.tooltip}
                tabindex={-1}
                class={["locus-context-menu-item", { "locus-context-menu-danger": !!item.danger, "locus-context-menu-item--emphasis": !!item.emphasis }]}
                disabled={item.disabled}
                aria-disabled={item.disabled ? "true" : undefined}
                aria-haspopup={item.children?.length ? "menu" : undefined}
                aria-expanded={item.children?.length ? (openChild() === item.id ? "true" : "false") : undefined}
                aria-controls={item.children?.length && openChild() === item.id ? childId(item) : undefined}
                data-locus-menu-item={item.id}
                onFocus={() => focusItem(item.id, false)}
                onPointerEnter={() => {
                  if (item.disabled) return;
                  focusItem(item.id);
                  if (item.children?.length) open(item, false);
                  else setOpenChild(undefined);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if ((event.target as Element).closest(".locus-context-menu-chevron")) open(item, true);
                  else select(item);
                }}
              >
                <Show when={item.icon}>{(name) => (
                  <span class="locus-context-menu-icon" aria-hidden="true">
                    <Dynamic component={LUCIDE_BY_NAME[name()] ?? IconAsterisk} size={15} />
                  </span>
                )}</Show>
                <span class="locus-context-menu-label"><TextWithCodeName text={item.label} code={item.labelCode} /></span>
                <Show when={item.shortcut}><kbd class="locus-context-menu-shortcut">{item.shortcut}</kbd></Show>
                <Show when={item.children?.length}>
                  <span class="locus-context-menu-chevron" aria-hidden="true" data-tooltip={`More ${item.label.toLocaleLowerCase()} options`}>›</span>
                </Show>
              </button>
              <Show when={!item.disabled && openChild() === item.id && item.children?.length}>
                <MenuPanel
                  id={childId(item)}
                  items={item.children!}
                  label={item.label}
                  anchor={buttons.get(item.id)!}
                  onBack={() => { setOpenChild(undefined); focusItem(item.id); }}
                />
              </Show>
            </div>
          </>
        ); }}</For>
      </div>
    );
  }

  return (
    <Portal mount={portalMount ?? document.body}>
      <div ref={root} class="locus-context-menu-root" onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        <MenuPanel id={rootMenuId} items={props.items} label={props.label ?? "Data actions"} focusId={props.focusId} />
      </div>
    </Portal>
  );
}

export default LocusContextMenu;
