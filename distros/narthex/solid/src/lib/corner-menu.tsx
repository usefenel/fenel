import { Show, createSignal, flush } from "solid-js";
import { IconEllipsis } from "./icons";
import { LocusContextMenu, type LocusMenuItem } from "./locus-context-menu";
import { hasTextSelection, isNativeEditingTarget } from "./data-transfer/events";

/** The affordance is shared; cards keep their current menu/action owner. */
export function CornerMenuButton(props: {
  onMenu: (event: MouseEvent) => void;
  open?: boolean;
  label?: string;
  class?: string;
  ref?: (element: HTMLButtonElement) => void;
}) {
  return <span class="corner-menu-trigger"><button type="button" ref={props.ref}
    class={["corner-menu-button", props.class, { "corner-menu-button--open": !!props.open }]}
    data-corner-menu-trigger="true" aria-label={props.label ?? "Actions"} aria-haspopup="menu"
    aria-expanded={props.open ? "true" : "false"} data-tooltip={props.label ?? "Actions"}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => { event.stopPropagation(); props.onMenu(event); }}
    onContextMenu={event => { event.stopPropagation(); props.onMenu(event); }}
    onKeyDown={event => {
      if (event.key !== "ArrowDown" && event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.click();
    }}><IconEllipsis size={16} /></button></span>;
}

export function createCornerMenu() {
  const [position, setPosition] = createSignal<{ x: number; y: number; opener?: HTMLElement }>();
  let trigger: HTMLButtonElement | undefined;
  function open(event: MouseEvent) {
    // Native text editing/selection owns its context menu. Local editor menus
    // stay admitted inside modals, whose outer class the canvas guard excludes.
    if (isNativeEditingTarget(event.target) || hasTextSelection()) return;
    if (event.target instanceof Element && event.target.closest('a[href], video, audio, [role="menu"]')) return;
    if (event.defaultPrevented && event.type !== "contextmenu") return;
    if (event.currentTarget instanceof Element && event.target instanceof Element) {
      const nearest = event.target.closest("[data-corner-menu-owner]");
      if (nearest && nearest !== event.currentTarget && !event.currentTarget.closest("[data-corner-menu-trigger]")) return;
    }
    event.preventDefault(); event.stopPropagation();
    const current = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    const opener = current instanceof HTMLButtonElement ? current : trigger?.getClientRects().length ? trigger
      : [...current?.querySelectorAll<HTMLButtonElement>(".corner-menu-button") ?? []].find(button => button.getClientRects().length > 0) ?? current;
    const rect = opener?.getBoundingClientRect();
    const atPointer = event.type === "contextmenu" && (event.clientX || event.clientY);
    setPosition({ x: atPointer ? event.clientX : rect?.left ?? 0,
      y: atPointer ? event.clientY : (rect?.bottom ?? 0) + 4, opener });
  }
  return { position, open, close: () => {
    setPosition(undefined);
    // Retire the popup before its synchronous action can start a pending
    // replacement under Loading and retain this closing menu with the old UI.
    flush();
  },
    isOpen: () => position() !== undefined,
    attach: (element: HTMLButtonElement) => { trigger = element; } };
}

/** Only the corner trigger and popup lifecycle; existing item callbacks own
 * lenses, authoring, navigation and IO. Right-click calls this same controller. */
export function CornerMenu(props: {
  menu: ReturnType<typeof createCornerMenu>;
  items: readonly LocusMenuItem[];
  label?: string;
  trigger?: boolean;
}) {
  return <><Show when={props.trigger !== false}><CornerMenuButton onMenu={props.menu.open} open={props.menu.isOpen()} ref={props.menu.attach} /></Show>
    <Show keyed when={props.menu.position()}>{at => <LocusContextMenu x={at.x} y={at.y}
      opener={at.opener} items={props.items} label={props.label ?? "Actions"} onClose={props.menu.close} />}</Show></>;
}
