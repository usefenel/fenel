import { Loading, Show, createContext, createEffect, createMemo, createSignal, onSettled } from "solid-js";
import { render } from "@solidjs/web";
import { LocusContextMenu, type LocusMenuItem } from "./locus-context-menu";
import { LocusSelect } from "./locus-select";
import { CornerMenu, CornerMenuButton, createCornerMenu } from "./corner-menu";
import { createAsyncValue } from "./async-value";

// Lifetime controls stop at the existing typed-read boundary. Keep its entire
// value/type/source payload observable. The downstream graph renderer has its
// own controls; this fixture tests its input and its containing lifetimes.
function TypedReadValue(props: { value: unknown; type: unknown; occurrence: unknown; dataPath: unknown }) {
  return <output data-home-graph-payload>{JSON.stringify({ value: props.value, type: props.type,
    occurrence: props.occurrence, dataPath: props.dataPath })}</output>;
}
/* HOME_GRAPH_COMPONENTS_SOURCE */

const events: Array<{ action: string; userActivated: boolean }> = [];
const select = (action: string) => () => { events.push({ action, userActivated: navigator.userActivation.isActive }); };
const items: readonly LocusMenuItem[] = [
  { id: "new", label: "New", onSelect: select("new"), children: [
    { id: "expression", label: "Expression", onSelect: select("expression") },
    { id: "record", label: "Record", onSelect: select("record") },
    { id: "more", label: "More", children: [{ id: "nested", label: "Nested type", onSelect: select("nested") }] },
  ] },
  { id: "cut", label: "Cut", shortcut: "Ctrl+X", disabled: true, onSelect: select("cut"), separatorBefore: true },
  { id: "copy", label: "Copy", shortcut: "Ctrl+C", onSelect: select("copy") },
  { id: "paste", label: "Paste", shortcut: "Ctrl+V", onSelect: select("paste") },
  { id: "delete", label: "Delete", danger: true, separatorBefore: true, onSelect: select("delete") },
];

function ReplacementAction(props: { label: string; replacing: boolean; onReplace: () => void }) {
  const menu = createCornerMenu();
  return <><CornerMenuButton label={props.label} onMenu={menu.open} open={menu.isOpen()} ref={menu.attach} />
    <CornerMenu menu={menu} trigger={false} label={props.label} items={[
      { id: "replace", label: "Choose new data", onSelect: props.onReplace },
      { id: "status", label: props.replacing ? "Replacement ready" : "Call controls", disabled: true },
    ]} /></>;
}

function ReplacementFixture(props: { replaceOwner?: boolean }) {
  const [replacing, setReplacing] = createSignal(false);
  const label = () => props.replaceOwner ? "Replaced call actions" : "Retained call actions";
  return <section aria-label={label()} style="margin: 16px; padding: 16px; border: 1px solid #ddd; width: 300px;">
    <p>Call input: ABC</p>
    <Show when={!props.replaceOwner || !replacing()}>
      <ReplacementAction label={label()} replacing={replacing()} onReplace={() => { select(label())(); setReplacing(true); }} />
    </Show>
    <Show when={replacing()}><input aria-label={`Replacement for ${label()}`} placeholder="Search functions" /></Show>
  </section>;
}

let finishHeldReplacement = () => {};

// The browser test replaces only this marker with Home's actual menu JSX.
// Reader/worker orchestration is outside this document-level menu fixture.
function HomeMenuLifetimeFixture() {
  type MenuTarget = { x: number; y: number; id: string; suggestions?: boolean; suggestionsLens?: boolean };
  const [contextMenu, setContextMenu] = createSignal<MenuTarget>();
  const [rows, setRows] = createSignal<readonly LocusMenuItem[]>([]);
  const closes: string[] = [];
  const actions: Array<{ target: string; userActivated: boolean; menuPresent: boolean }> = [];
  const dataSuggestions = { items: rows, close: () => { closes.push("data"); } };
  const lensSuggestions = { items: rows, close: () => { closes.push("lens"); } };
  function contextItems(menu: MenuTarget): readonly LocusMenuItem[] {
    return [
      { id: "action", label: `Select ${menu.id}`, onSelect: () => actions.push({ target: menu.id,
        userActivated: navigator.userActivation.isActive, menuPresent: !!document.querySelector('[role="menu"]') }) },
      { id: "keep", label: "More rows", keepOpen: true, onSelect: () => setRows([
        { id: "ready", label: "Ready row" },
      ]) },
      ...rows(),
    ];
  }
  globalThis.homeMenuLifetimeFixture = {
    open: (id, suggestionsLens) => setContextMenu({ id, x: 24, y: 24,
      suggestions: suggestionsLens !== undefined, suggestionsLens }),
    rows: setRows, closes, actions,
  };
  return /* HOME_CONTEXT_MENU_SOURCE */ <></>;
}

function HeldReplacementFixture() {
  const [replacing, setReplacing] = createSignal(false);
  const pending = new Promise<string>(resolve => { finishHeldReplacement = () => resolve("Replacement ready"); });
  const read = createMemo(() => replacing() ? pending : "Original call");
  return <Loading fallback={<p>Preparing replacement</p>}>
    <section aria-label="Async replacement fixture" style="margin: 16px; padding: 16px; border: 1px solid #ddd; width: 300px;">
      <p>{read()}</p>
      <Show when={!replacing()} fallback={<input aria-label="Async replacement function" placeholder="Search functions" />}>
        <ReplacementAction label="Async replacement actions" replacing={replacing()} onReplace={() => {
          select("Async replacement")(); setReplacing(true);
        }} />
      </Show>
    </section>
  </Loading>;
}

function Fixture() {
  const [point, setPoint] = createSignal<{ x: number; y: number }>();
  const [currentItems, setCurrentItems] = createSignal(items);
  const [letter, setLetter] = createSignal("b");
  let dialog: HTMLDialogElement | undefined;
  let closed = 0;
  globalThis.locusMenuFixture = {
    events,
    letter,
    open(x = 40, y = 60) { setPoint({ x, y }); },
    replaceItems: setCurrentItems,
    closed: () => closed,
    resolveHeldReplacement: () => finishHeldReplacement(),
    dispose: () => {},
  };
  return (
    <>
      <button id="trigger" onClick={() => setPoint({ x: 40, y: 60 })}>Open menu</button>
      <input id="outside" aria-label="Outside input" />
      <ReplacementFixture />
      <ReplacementFixture replaceOwner />
      <HeldReplacementFixture />
      <HomeMenuLifetimeFixture />
      <div id="right-click-target" style="position: fixed; left: 300px; top: 300px; width: 200px; height: 100px;"
        onContextMenu={(event) => { event.preventDefault(); setPoint({ x: event.clientX, y: event.clientY }); }}>Menu surface</div>
      <LocusSelect label="Letter" value={letter()} onChange={setLetter}
        options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Bravo" }, { value: "c", label: "Charlie" }]} />
      <button type="button" onClick={() => dialog?.showModal()}>Open dialog</button>
      <dialog ref={dialog} aria-label="Expression inspector fixture" style="width: 260px; height: 100px;">
        <LocusSelect label="Dialog letter" value={letter()} onChange={setLetter}
          options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Bravo" }, { value: "c", label: "Charlie" }]} />
        <button type="button" onClick={() => dialog?.close()}>Close dialog</button>
      </dialog>
      <div data-modal-transition role="dialog" aria-modal="true" aria-label="Overlay inspector fixture"
        style="position:fixed;left:420px;top:20px;width:200px;height:100px;background:white;z-index:10000;border:1px solid #ccc;padding:8px">
        <LocusSelect label="Overlay letter" value={letter()} onChange={setLetter}
          options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Bravo" }, { value: "c", label: "Charlie" }]} />
      </div>
      <Show when={point()}>{(position) => (
        <LocusContextMenu x={position().x} y={position().y} items={currentItems()} onClose={() => { closed++; setPoint(undefined); }} />
      )}</Show>
    </>
  );
}

declare global {
  var homeMenuLifetimeFixture: { open: (id: string, suggestionsLens?: boolean) => void;
    rows: (rows: readonly LocusMenuItem[]) => void; closes: string[];
    actions: Array<{ target: string; userActivated: boolean; menuPresent: boolean }> };
  var locusMenuFixture: { events: typeof events; letter: () => string; open: (x?: number, y?: number) => void; replaceItems: (items: readonly LocusMenuItem[]) => void; closed: () => number; resolveHeldReplacement: () => void; dispose: () => void };
}

const dispose = render(Fixture, document.body);
locusMenuFixture.dispose = dispose;
