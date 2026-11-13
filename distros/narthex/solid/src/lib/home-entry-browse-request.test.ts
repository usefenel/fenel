// Run with --conditions=browser --conditions=development for Solid 2's graph.
import { describe, expect, test } from "bun:test";
import { createRoot, createSignal, flush } from "solid-js";

// The actual Browse button handler of HomeEntry, with real Solid 2 signals.
// A Local tab prepares its reader on demand: opening Browse is such a demand,
// and the drawer's "Loading the rest of the catalog…" row waits on it.
const source = (await Bun.file(process.env.FENEL_HOME_ENTRY_BROWSE_SOURCE ?? new URL("./home-entry.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
const startMarker = "            onClick={() => {\n              if (props.publicRoot) { openWorkspace(\"browse\", true, \"browse\"); return; }";
const endMarker = "            }}>\n            <IconSearch size={16} />";
const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
if (start < 0 || end <= start) throw new Error("The Browse button handler boundary changed.");
const body = source.slice(start + "            onClick={() => {".length, end);
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(`const handler = () => {${body}};`);

// The server build writes synchronously and would hide the defect this file
// guards; refuse to run there instead of passing vacuously.
{
  const [probe, setProbe] = createSignal(false);
  setProbe(true);
  if (probe()) throw new Error("Run this file with --conditions=browser --conditions=development (Solid 2 client scheduling).");
  flush();
}

function harness(roots: { publicRoot?: object; navigationRoot?: object } = {}) {
  const events: string[] = [];
  const state = createRoot(() => {
    const [drawerOpen, setDrawerOpen] = createSignal(false);
    const bindings = {
      props: roots, drawerOpen, setDrawerOpen,
      workspace: { request: () => { events.push("reader-request"); } },
      openWorkspace: (...args: unknown[]) => { events.push(`open-workspace:${args.join(",")}`); },
    };
    const click = new Function(...Object.keys(bindings), `${code}; return handler;`)(...Object.values(bindings)) as () => void;
    return { drawerOpen, click };
  });
  return { ...state, events };
}

describe("HomeEntry Browse button", () => {
  test("opening Browse in a Local entry requests its reader once", () => {
    const h = harness();
    h.click();
    flush();
    expect(h.drawerOpen()).toBe(true);
    expect(h.events).toEqual(["reader-request"]);
  });

  test("closing Browse requests nothing, and reopening requests again", () => {
    const h = harness();
    h.click(); flush();
    h.click(); flush();
    expect(h.drawerOpen()).toBe(false);
    expect(h.events).toEqual(["reader-request"]);
    h.click(); flush();
    expect(h.drawerOpen()).toBe(true);
    expect(h.events).toEqual(["reader-request", "reader-request"]);
  });

  test("an All data navigation root opens the drawer without a reader", () => {
    const h = harness({ navigationRoot: {} });
    h.click(); flush();
    expect(h.drawerOpen()).toBe(true);
    expect(h.events).toEqual([]);
  });

  test("a public root opens the workspace on Browse instead", () => {
    const h = harness({ publicRoot: {} });
    h.click(); flush();
    expect(h.drawerOpen()).toBe(false);
    expect(h.events).toEqual(["open-workspace:browse,true,browse"]);
  });
});

// A focused public collection page acquires the prepared Home body by itself
// (its Representation control lives there); landing pages stay snapshot-only.
const collectionStart = source.indexOf("  const focusedPublicCollection = createMemo(() => {");
const collectionEnd = source.indexOf("\n  });\n", collectionStart);
if (collectionStart < 0 || collectionEnd <= collectionStart) throw new Error("The focused public collection boundary changed.");
const collectionCode = new Bun.Transpiler({ loader: "ts" }).transformSync(
  `const decide = () => {${source.slice(source.indexOf("{", collectionStart + "  const focusedPublicCollection = createMemo(() =>".length) + 1, collectionEnd)}};`);

function collectionPage(state: { publicRoot?: boolean; focus: { kind: string }; fields?: unknown[]; preview?: unknown;
  typeKind?: string }) {
  const valueType = { $ref: "Declared" };
  const item = { id: "item", ...(state.typeKind ? { valueType } : {}) };
  const bindings = {
    props: { publicRoot: state.publicRoot === false ? undefined : {}, pane: {} },
    current: () => ({}),
    displayFocus: () => state.focus,
    focusedFields: () => state.fields,
    focusedPreview: () => ({ item }),
    shellPreview: (candidate: unknown) => candidate === item ? state.preview : undefined,
    // The root read's own type description (its `kind` is detectTypeKind's).
    projectedTypeDescription: (type: unknown) => type === valueType ? { kind: state.typeKind } : undefined,
  };
  return (new Function(...Object.keys(bindings), `${collectionCode}; return decide;`)(...Object.values(bindings)) as () => boolean)();
}

// After a collection acquired the body, a page a fresh visit paints from the
// snapshot is painted the same way (Nov 12: "Demo" froze the tab in the body).
const snapshotStart = source.indexOf("  function publicSnapshotPage(): boolean {");
const snapshotEnd = source.indexOf("\n  }\n", snapshotStart);
if (snapshotStart < 0 || snapshotEnd <= snapshotStart) throw new Error("The public snapshot page boundary changed.");
const snapshotCode = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(snapshotStart, snapshotEnd + 4));
function snapshotPage(state: { publicRoot?: boolean; collection: boolean; layout?: string }) {
  const bindings = {
    props: { publicRoot: state.publicRoot === false ? undefined : {}, pane: { presentation: () => state.layout } },
    current: () => ({}),
    focusedPublicCollection: () => state.collection,
  };
  return (new Function(...Object.keys(bindings), `${snapshotCode}; return publicSnapshotPage;`)(...Object.values(bindings)) as () => boolean)();
}

describe("HomeEntry public snapshot page", () => {
  test("Demo, the Fenel root and records are snapshot pages; collections and functions are not", () => {
    expect(snapshotPage({ collection: false })).toBe(true);
    expect(snapshotPage({ collection: true })).toBe(false);
  });
  test("an explicit collection layout keeps the body; Automatic, Data and Desktop do not", () => {
    for (const layout of ["table", "grid", "list"]) expect(snapshotPage({ collection: false, layout })).toBe(false);
    for (const layout of [undefined, "value", "desktop"]) expect(snapshotPage({ collection: false, layout })).toBe(true);
  });
  test("a non-public reader is never released", () => {
    expect(snapshotPage({ publicRoot: false, collection: false })).toBe(false);
  });
});

describe("HomeEntry focused public collection", () => {
  test("a focused list value (/demo/Greek alphabet/Greek alphabet) acquires the reader", () => {
    expect(collectionPage({ focus: { kind: "value" }, preview: [{ name: "Alpha" }, { name: "Beta" }] })).toBe(true);
  });
  test("a root list row acquires the reader", () => {
    expect(collectionPage({ focus: { kind: "view" } })).toBe(true);
  });
  test("landing pages stay snapshot-only: the Fenel root and records of sections (/demo, /std)", () => {
    expect(collectionPage({ focus: { kind: "root" } })).toBe(false);
    expect(collectionPage({ focus: { kind: "value" }, fields: [{}, {}], preview: { sections: true } })).toBe(false);
  });
  test("a focused scalar value and a non-public root acquire nothing", () => {
    expect(collectionPage({ focus: { kind: "value" }, preview: "α" })).toBe(false);
    expect(collectionPage({ publicRoot: false, focus: { kind: "value" }, preview: [1, 2] })).toBe(false);
  });
  // /demo/People and projects/People: a call whose snapshot read stayed live
  // (the pictures exceed the initial-read transport), so no value is painted;
  // its declared type still says it is a list.
  test("a focused list without a snapshot value acquires the reader by its declared type", () => {
    expect(collectionPage({ focus: { kind: "value" }, preview: undefined, typeKind: "list" })).toBe(true);
  });
  // /demo/Recipe functions/Moisturizing-lubrication formula: a function reference; its
  // graph and Representation control are the prepared Home body.
  test("a focused function acquires the reader", () => {
    expect(collectionPage({ focus: { kind: "value" }, preview: undefined, typeKind: "arrow" })).toBe(true);
  });
  test("a focused named record or type without a snapshot value still acquires nothing", () => {
    expect(collectionPage({ focus: { kind: "value" }, preview: undefined, typeKind: "named" })).toBe(false);
    expect(collectionPage({ focus: { kind: "value" }, preview: undefined, typeKind: "type" })).toBe(false);
    expect(collectionPage({ focus: { kind: "value" }, preview: undefined })).toBe(false);
  });
  test("records of sections stay landing pages even when typed as a list or function", () => {
    expect(collectionPage({ focus: { kind: "value" }, fields: [{}], preview: { a: 1 }, typeKind: "list" })).toBe(false);
  });
});
