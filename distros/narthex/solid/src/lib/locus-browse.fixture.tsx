import { Show, createMemo, createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { LocusBrowse, type BrowseGroup, type BrowseRow } from "./locus-browse";

type Event = { action: "pick" | "open"; id: string };
type Mode = "immediate" | "delayed";
const events: Event[] = [];
const releases = new Map<string, (groups: BrowseGroup[]) => void>();
const row = (id: string, label: string, disabled = false): BrowseRow => ({
  id, label, disabled, detail: `${label} detail`,
  pick: () => events.push({ action: "pick", id }),
  open: disabled ? undefined : () => events.push({ action: "open", id }),
  drag: disabled ? undefined : transfer => {
    transfer.setData("application/x-fenel-savedexpr-id", id);
    transfer.setData("application/x-fenel-savedexpr-name", label);
  },
});
const initialGroups = (): BrowseGroup[] => [
  { id: "create", title: "Create data", rows: [row("incomplete", "Incomplete date", true)] },
  { id: "saved", title: "Saved data", rows: [row("alpha", "Saved Alpha"), row("beta", "Saved Beta")] },
  { id: "catalog", title: "Catalog", rows: [row("echo", "Echo function")] },
];

function Fixture() {
  const [open, setOpen] = createSignal(true);
  const [query, setQuery] = createSignal("");
  const [mode, setMode] = createSignal<Mode>(new URL(location.href).searchParams.has("delayed") ? "delayed" : "immediate");
  const [rows, setRows] = createSignal(initialGroups());
  const [pickPending, setPickPending] = createSignal(false);
  let releaseReplacement: ((rows: BrowseRow[]) => void) | undefined;
  const replacementRows = createMemo(() => new Promise<BrowseRow[]>(resolve => { releaseReplacement = resolve; }));
  let closed = 0;
  const groups = createMemo(() => {
    const text = query().trim().toLowerCase();
    if (mode() === "delayed") return new Promise<BrowseGroup[]>(resolve => releases.set(text, resolve));
    return rows().map(group => ({ ...group, rows: group.rows.filter(item => item.label.toLowerCase().includes(text)) }));
  });
  globalThis.locusBrowseFixture = {
    events, query, closed: () => closed,
    reopen() { setOpen(true); },
    delayed() { setMode("delayed"); },
    release(text, ids) {
      const complete = releases.get(text);
      if (!complete) throw new Error(`No held read for ${JSON.stringify(text)}`);
      releases.delete(text);
      complete([{ id: "saved", title: "Saved data", rows: ids.map(id => row(id, `Result ${id}`)) }]);
    },
    replace(ids) { setRows([{ id: "saved", title: "Saved data", rows: ids.map(id => row(id, `Saved ${id}`)) }]); },
    replaceHeld() { setRows([{ id: "saved", title: "Saved data", rows: [], readRows: replacementRows, pendingLabel: "Reading replacement…" }]); },
    releaseReplacement(ids) {
      if (!releaseReplacement) throw new Error("Replacement rows have not been read");
      releaseReplacement(ids.map(id => row(id, `Saved ${id}`)));
    },
    picking: setPickPending,
    dispose: () => {},
  };
  return <>
    <Show when={open()}><LocusBrowse query={query()} onQuery={setQuery} groups={groups()}
      pending={[{ id: "catalog", label: "Loading the rest of the catalog…" }]} pickPending={pickPending()}
      onClose={() => { closed++; setOpen(false); }} /></Show>
    <div id="drop-target" style="position: absolute; left: 440px; top: 80px; width: 160px; height: 100px;">Data destination</div>
  </>;
}

declare global {
  var locusBrowseFixture: {
    events: Event[];
    query: () => string;
    closed: () => number;
    reopen: () => void;
    delayed: () => void;
    release: (query: string, ids: string[]) => void;
    replace: (ids: string[]) => void;
    replaceHeld: () => void;
    releaseReplacement: (ids: string[]) => void;
    picking: (pending: boolean) => void;
    dispose: () => void;
  };
}

const dispose = render(Fixture, document.body);
locusBrowseFixture.dispose = dispose;
