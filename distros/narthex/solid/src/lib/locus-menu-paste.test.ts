import { expect, test } from "bun:test";
import type { TransferSnapshot } from "./data-transfer/types";

// Exercise HomePage's actual private handlers without importing its engine or
// preparing authoring. This follows home-authoring-regressions.test.ts.
const homeSource = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
// The declaration's OWN closing brace terminates the slice, not the next
// declaration: an earlier version keyed each end on a sibling name, and
// eb1ab92d broke it by MOVING `genId` to `~/lib/locus-view-model` while every
// handler under test stayed put. A neighbour's location is not this test's
// subject, so it must not be able to fail it.
function extract(start: string): string {
  const from = homeSource.indexOf(start);
  if (from < 0) throw new Error(`Home paste regression could not find ${start.trim()}`);
  const closing = `\n${" ".repeat(start.length - start.trimStart().length)}}`;
  const to = homeSource.indexOf(closing, from + start.length);
  if (to < 0) throw new Error(`Home paste regression could not find the end of ${start.trim()}`);
  return homeSource.slice(from, to + closing.length);
}
const actualHandlers = new Bun.Transpiler({ loader: "ts" }).transformSync([
  extract("function resolveExpr("),
  extract("function findLocusItem("),
  extract("  function menuIsCurrent("),
  extract("  function finishCut("),
  extract("  function completeImport("),
  extract("  async function pasteFromMenu("),
].join("\n"));
const makeHandlers = new Function("host", `
  const { current, sessionEpoch, setReadingClipboard, setToolbarError,
    savedExprById, homeData, readClipboardTransfer, transferCommandsFor,
    cutMark, setCutMark, scopeSubject, setTransferComplete } = host;
  let clipboardRead;
  let afterImport;
  ${actualHandlers}
  return { paste: pasteFromMenu, completeImport, abort: () => clipboardRead?.abort() };
`);

const snapshot: TransferSnapshot = { files: [], text: "incoming", html: "", internal: "", uriList: "" };
type Item = { id: string; source: { kind: "expr"; expr: { kind: string; value: number } }; valueType: object };
type Commands = { canPaste: () => boolean; paste: (value: TransferSnapshot) => Promise<void> };
type Menu = {
  epoch: number; viewId: string; item?: Item; transfer?: Commands;
  element: { isConnected: boolean; closest: () => { dataset: { locusItem: string } } };
  hint: { x: number; y: number };
};

function fixture() {
  const state = { epoch: 1, viewId: "view-a", revision: 0, ownerId: "item-a", connected: true, reading: false, canPaste: true };
  const item: Item = { id: "item-a", source: { kind: "expr", expr: { kind: "literal", value: 1 } }, valueType: { $ref: "Number" } };
  const items = [item];
  const pasted: TransferSnapshot[] = [];
  const imports: { value: TransferSnapshot; viewId: string; point: Menu["hint"] }[] = [];
  const errors: string[] = [];
  const transferCompletions: boolean[] = [];
  const reads: { signal: AbortSignal; resolve: (value: TransferSnapshot) => void; reject: (error: unknown) => void }[] = [];
  const commands: Commands = { canPaste: () => state.canPaste, paste: async (value) => { pasted.push(value); } };
  let registered: Commands | undefined = commands;
  const menu: Menu = {
    epoch: 1, viewId: "view-a", item, transfer: commands,
    element: {
      get isConnected() { return state.connected; },
      closest: () => ({ dataset: { locusItem: state.ownerId } }),
    },
    hint: { x: 0.25, y: 0.75 },
  };
  const handlers = makeHandlers({
    current: () => ({ id: state.viewId, view: { items } }),
    sessionEpoch: () => state.epoch,
    setReadingClipboard: (value: boolean) => { state.reading = value; },
    // Home's transfer-complete signal (84a2b15f), set once an import lands.
    setTransferComplete: (value: boolean) => { transferCompletions.push(value); },
    setToolbarError: (message: string | null) => { if (message) errors.push(message); },
    savedExprById: () => new Map(),
    homeData: {
      revision: () => state.revision,
      import: (value: TransferSnapshot, point: Menu["hint"]) => {
        imports.push({ value, viewId: state.viewId, point });
        handlers.completeImport();
      },
    },
    cutMark: () => undefined,
    setCutMark: () => {},
    scopeSubject: () => { throw new Error("A paste without a cut must not remove data"); },
    // Intentionally allow late results after abort: the actual handler must
    // discard them even when the browser's pending clipboard read completes.
    readClipboardTransfer: (signal: AbortSignal) => new Promise<TransferSnapshot>((resolve, reject) => {
      reads.push({ signal, resolve, reject });
    }),
    transferCommandsFor: () => registered,
  }) as { paste: (target: Menu, asNewItem?: boolean) => Promise<void>; completeImport: () => void; abort: () => void };
  return { state, item, items, menu, pasted, imports, errors, reads, transferCompletions, ...handlers,
    unregister: () => { registered = undefined; },
  };
}

test("an unchanged nested destination receives one completed clipboard snapshot", async () => {
  const f = fixture();
  const pending = f.paste(f.menu);
  expect(f.state.reading).toBe(true);
  expect(f.pasted).toEqual([]);
  f.reads[0]!.resolve(snapshot);
  await pending;
  expect(f.pasted).toEqual([snapshot]);
  expect(f.imports).toEqual([]);
  expect(f.errors).toEqual([]);
  expect(f.state.reading).toBe(false);
});

for (const [reason, change] of [
  ["source expression", (f: ReturnType<typeof fixture>) => { f.item.source.expr = { kind: "literal", value: 2 }; }],
  ["value revision", (f: ReturnType<typeof fixture>) => { f.state.revision++; }],
  ["declared type", (f: ReturnType<typeof fixture>) => { f.item.valueType = { $ref: "String" }; }],
  ["reused tab DOM owner", (f: ReturnType<typeof fixture>) => { f.state.ownerId = "item-b"; }],
  ["removed item", (f: ReturnType<typeof fixture>) => { f.items.splice(0); }],
] as const) {
  test(`a changed ${reason} refuses the pending paste`, async () => {
    const f = fixture();
    const pending = f.paste(f.menu);
    change(f);
    f.reads[0]!.resolve(snapshot);
    await pending;
    expect(f.pasted).toEqual([]);
    expect(f.imports).toEqual([]);
    expect(f.errors).toHaveLength(1);
    expect(f.errors[0]).toContain("changed while reading the clipboard");
    expect(f.state.reading).toBe(false);
  });
}

for (const [reason, change] of [
  ["disconnected element", (f: ReturnType<typeof fixture>) => { f.state.connected = false; }],
  ["unregistered target", (f: ReturnType<typeof fixture>) => { f.unregister(); }],
  ["busy target", (f: ReturnType<typeof fixture>) => { f.state.canPaste = false; }],
] as const) {
  test(`a ${reason} cannot receive a late clipboard result`, async () => {
    const f = fixture();
    const pending = f.paste(f.menu);
    change(f);
    f.reads[0]!.resolve(snapshot);
    await pending;
    expect(f.pasted).toEqual([]);
    expect(f.imports).toEqual([]);
    expect(f.errors[0]).toContain("paste destination changed");
  });
}

for (const [reason, change] of [
  ["session switch", (f: ReturnType<typeof fixture>) => { f.state.epoch++; }],
  ["view switch", (f: ReturnType<typeof fixture>) => { f.state.viewId = "view-b"; }],
  ["cancellation", (f: ReturnType<typeof fixture>) => { f.abort(); }],
] as const) {
  test(`a ${reason} discards the result without showing an import error`, async () => {
    const f = fixture();
    const pending = f.paste(f.menu);
    change(f);
    f.reads[0]!.resolve(snapshot);
    await pending;
    expect(f.pasted).toEqual([]);
    expect(f.imports).toEqual([]);
    expect(f.errors).toEqual([]);
    expect(f.state.reading).toBe(false);
  });
}

test("an already stale menu does not request clipboard access", async () => {
  const f = fixture();
  f.state.epoch++;
  await f.paste(f.menu);
  expect(f.reads).toEqual([]);
  expect(f.state.reading).toBe(false);
});

test("Paste as new item keeps the captured view and point when the nested value changes", async () => {
  const f = fixture();
  const pending = f.paste(f.menu, true);
  f.state.ownerId = "item-b";
  f.state.revision++;
  f.item.source.expr = { kind: "literal", value: 2 };
  f.reads[0]!.resolve(snapshot);
  await pending;
  expect(f.pasted).toEqual([]);
  expect(f.imports).toEqual([{ value: snapshot, viewId: "view-a", point: { x: 0.25, y: 0.75 } }]);
  expect(f.errors).toEqual([]);
  expect(f.transferCompletions).toEqual([true]);
});

test("a superseded read cannot dispatch or clear the newer read's loading state", async () => {
  const f = fixture();
  const first = f.paste(f.menu);
  const second = f.paste(f.menu);
  expect(f.reads[0]!.signal.aborted).toBe(true);
  f.reads[0]!.resolve(snapshot);
  await first;
  expect(f.pasted).toEqual([]);
  expect(f.state.reading).toBe(true);
  f.reads[1]!.resolve(snapshot);
  await second;
  expect(f.pasted).toEqual([snapshot]);
  expect(f.state.reading).toBe(false);
});
