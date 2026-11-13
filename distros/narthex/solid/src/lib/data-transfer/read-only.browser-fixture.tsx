// C1 browser fixture: real shared DOM, media, clipboard and command components.
// The build substitutes only type-analysis/projection with the controlled
// adaptation below; language/type semantics are covered by the product tests.
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import type { AuthoringSession } from "../expression-runner/account-authoring-session";
import type { FenelType } from "@fenel/engine/types";
import { DataValueSurface } from "./DataValueSurface";
import { DataTransferTarget } from "./DataTransferTarget";
import { transferCommandsFor } from "./commands";
import { decodeTransferItem, type TransferItem, type TransferSnapshot } from "./index";

const image = { width: 2, height: 1, pixels: [{ r: 20, g: 60, b: 100, a: 255 }, { r: 200, g: 150, b: 50, a: 255 }] };
const initial = { count: 1, original: image, filteredImages: [image, image] };
const nothing = { $tag: "Nothing" } as const;
const type: FenelType = { $record: { fields: [
  { name: "count", type: { $ref: "Number" }, label: nothing, ui: nothing, meta: {} },
  { name: "original", type: { $ref: "Image" }, label: nothing, ui: nothing, meta: {} },
  { name: "filteredImages", type: { $tuple: [{ $ref: "Image" }, { $ref: "Image" }] }, label: nothing, ui: nothing, meta: {} },
] } };
const session = { mode: "detached", registry: {}, environment: {}, evaluateContext: {} } as AuthoringSession;
const emptySnapshot: TransferSnapshot = { files: [], text: "9", html: "", internal: "", uriList: "" };

function Fixture() {
  const [editable, setEditable] = createSignal(false);
  const [value, setValue] = createSignal(structuredClone(initial));
  const [valueType, setValueType] = createSignal(type);
  const [inspection, setInspection] = createSignal<unknown>({});
  let changes = 0;
  let ancestor = 0;
  let analysis = 0;
  let hold = false;
  let pending: { signal?: AbortSignal; resolve: () => void } | undefined;
  let directSignal: AbortSignal | undefined;
  let directRelease: (() => void) | undefined;
  let directPublished = 0;
  let directStarted = 0;
  let editPath: readonly (string | number)[] | undefined;
  let dragged: { effect: string; payload: string } | undefined;
  let history: unknown[] = [];
  const copyItem: TransferItem = { value: 1, typeName: "Number", source: "fenel" };

  globalThis.readOnlyFixture = {
    reset(nextEditable = false) {
      setEditable(nextEditable); setValue(structuredClone(initial)); setValueType(type);
      changes = 0; ancestor = 0; analysis = 0; hold = false; pending = undefined; editPath = undefined; dragged = undefined;
      history = [];
      flush();
    },
    editable(next: boolean) { setEditable(next); flush(); },
    inspect(next: unknown) { setInspection(structuredClone(next)); flush(); },
    type(next: FenelType) { setValueType(next); flush(); },
    hold(next = true) { hold = next; },
    release() { pending?.resolve(); },
    remember(copy: unknown) { history.push(copy); },
    async adapt(_items, _options, signal) {
      analysis++;
      if (hold) await new Promise<void>((resolve) => { pending = { signal, resolve }; });
      return { value: 9, expr: { kind: "literal", value: 9 }, type: { $ref: "Number" } };
    },
    state: () => ({ editable: editable(), value: structuredClone(value()), changes, ancestor, analysis,
      aborted: pending?.signal?.aborted, directAborted: directSignal?.aborted, directPublished, directStarted, editPath, dragged, history }),
    commands(selector) {
      const commands = transferCommandsFor(document.querySelector(selector));
      return { copy: commands?.canCopy(), paste: commands?.canPaste() };
    },
    capabilities() {
      return Array.from(document.querySelectorAll("#value [data-fenel-transfer-target]"), (node) => {
        const commands = transferCommandsFor(node);
        return { copy: commands?.canCopy(), paste: commands?.canPaste(), label: node.getAttribute("aria-label") };
      });
    },
    async paste(selector) { await transferCommandsFor(document.querySelector(selector))?.paste(emptySnapshot); },
    decode(payload) { return decodeTransferItem(payload).value; },
    async startDirect() { await transferCommandsFor(document.querySelector("#direct [data-fenel-transfer-target]"))?.paste(emptySnapshot); },
    releaseDirect() { directRelease?.(); },
    dispose: () => {},
  };

  return <div id="ancestor" onPaste={() => { ancestor++; }} onDrop={() => { ancestor++; }} onDragOver={() => { ancestor++; }}>
    <main id="value"><DataValueSurface value={value()} type={valueType()} label="Computed result" session={() => session}
      onChange={editable() ? (next) => { changes++; editPath = next.edit?.path; setValue(next.value as typeof initial); } : undefined} /></main>
    <section id="direct"><DataTransferTarget label="Copy-only target" copyValue={() => copyItem}
      onTransfer={editable() ? async (_snapshot, signal) => {
        directStarted++; directSignal = signal;
        await new Promise<void>((resolve) => { directRelease = resolve; });
        signal.throwIfAborted(); directPublished++;
      } : undefined}><span>Direct data</span><input aria-label="Native text" value="Native text" /></DataTransferTarget></section>
    <p id="selected-text">Native selected text</p>
    <section id="inspection"><DataValueSurface value={inspection()} label="Computed result" session={() => session} /></section>
    <section id="inspection-hover"><DataValueSurface value={inspection()} label="Computed result" session={() => session}
      renderChild={(child, render) => <div class="inspection-child" data-child-label={child.label}>
        <output class="inspection-preview">{JSON.stringify(child.value)}</output>{render()}
      </div>} /></section>
    <div id="drag-destination" style={{ width: "180px", height: "60px", border: "1px solid" }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault(); event.stopPropagation();
        dragged = { effect: event.dataTransfer!.effectAllowed, payload: event.dataTransfer!.getData("application/x-fenel-value+json") };
      }}>Drop destination</div>
  </div>;
}

declare global {
  var readOnlyFixture: {
    reset(editable?: boolean): void; editable(value: boolean): void; inspect(value: unknown): void; type(value: FenelType): void; hold(value?: boolean): void; release(): void;
    remember(copy: unknown): void;
    adapt(items: unknown, options: unknown, signal?: AbortSignal): Promise<unknown>;
    state(): { editable: boolean; value: typeof initial; changes: number; ancestor: number; analysis: number;
      aborted?: boolean; directAborted?: boolean; directPublished: number; directStarted: number;
      editPath?: readonly (string | number)[]; dragged?: { effect: string; payload: string }; history: unknown[] };
    commands(selector: string): { copy?: boolean; paste?: boolean }; paste(selector: string): Promise<void>;
    capabilities(): { copy?: boolean; paste?: boolean; label: string | null }[];
    decode(payload: string): unknown; startDirect(): Promise<void>; releaseDirect(): void; dispose(): void;
  };
}
const dispose = render(Fixture, document.body);
readOnlyFixture.dispose = dispose;
