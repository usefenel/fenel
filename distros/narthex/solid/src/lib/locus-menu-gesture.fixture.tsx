import { Show, createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { LocusContextMenu, type LocusMenuItem } from "./locus-context-menu";
import { locusContextPosition, ownsLocusContextMenu } from "./locus-menu-actions";
import { createLocusTapMenu } from "./locus-menu-gesture";

const events: string[] = [];

/** The workspace offers the card's own actions only when the menu was opened
 *  over one, which is what makes "which card" the interesting question. */
function items(card: string | undefined): readonly LocusMenuItem[] {
  return [
    { id: "new", label: "New", onSelect: () => events.push("new") },
    { id: "paste", label: "Paste", onSelect: () => events.push("paste") },
    ...(card ? [{ id: "remove", label: "Remove from view", onSelect: () => events.push(`remove:${card}`) }] : []),
  ];
}

function Fixture() {
  const [at, setAt] = createSignal<{ x: number; y: number; card?: string }>();
  function openMenu(event: MouseEvent) {
    if (!ownsLocusContextMenu(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const card = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-locus-item]")?.dataset.locusItem : undefined;
    events.push(card ? `open:${card}` : "open");
    setAt({ ...locusContextPosition(event), card });
  }
  const tapMenu = createLocusTapMenu(openMenu);
  globalThis.locusGestureFixture = { events, at: () => at(), dispose: () => {} };
  return (
    <>
      <div
        id="surface"
        style="position: fixed; inset: 0; background: #111"
        onContextMenu={tapMenu.onContextMenu}
        onPointerDown={tapMenu.onPointerDown}
        onPointerMove={tapMenu.onPointerMove}
        onPointerUp={tapMenu.onPointerUp}
        onPointerCancel={tapMenu.onPointerCancel}
        onClick={tapMenu.onClick}
      >
        <button id="control" type="button" style="position: absolute; left: 200px; top: 20px; width: 160px; height: 70px"
          onClick={() => events.push("control")}>Control</button>
        <div id="card" data-locus-item="card-1" style="position: absolute; left: 200px; top: 130px; width: 160px; height: 70px; background: #333"
          onClick={() => events.push("card")}>Card</div>
      </div>
      <Show when={at()}>{(origin) => (
        <LocusContextMenu x={origin().x} y={origin().y} items={items(origin().card)}
          onClose={() => { events.push("close"); setAt(undefined); }} />
      )}</Show>
    </>
  );
}

declare global {
  var locusGestureFixture: {
    events: string[];
    at: () => { x: number; y: number; card?: string } | undefined;
    dispose: () => void;
  };
}

const dispose = render(Fixture, document.body);
locusGestureFixture.dispose = dispose;
