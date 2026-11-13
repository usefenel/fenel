import { describe, expect, test } from "bun:test";
import { createViewPersistence } from "./home-view-persistence.ts";
import { rootDataRow } from "./locus-root-data.ts";

// Exercise Home's actual selection and existing draft/item owners. Declared
// types are checked public transport facts; this fixture has no type inference,
// expression evaluator, private registry or authority implementation.
const home = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
const views = await Bun.file(new URL("./locus-view-model.ts", import.meta.url)).text();
const bootstrap = await Bun.file(new URL("./generated/public-bootstrap.json", import.meta.url)).json();
function section(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  if (from < 0 || to <= from) throw new Error(`Focused type owner changed: ${start}`);
  return source.slice(from, to).replace(/^export /, "");
}
const actual = new Bun.Transpiler({ loader: "ts" }).transformSync([
  section(views, "export function asView(", "export function genId("),
  section(home, "function findLocusItem(", "function removeLocusItem("),
  section(home, "  const homes = () =>", "  const dataLoadErrors ="),
  section(home, "  function admittedFocusedType()", "  let suggestionTarget:"),
].join("\n"));
const original = bootstrap.root.items.find(item => item.id === "std");
const arrow = original.valueType.$record.fields.find(field => field.name === "upper").type;
const rootType = bootstrap.root.type;

function fixture() {
  const state = { root: { ...bootstrap.root, items: [original], lists: [] }, epoch: 7, clientEpoch: 7,
    source: "repository", ticket: "repository", aborted: false, held: undefined, resolved: undefined,
    focus: { kind: "value", viewId: bootstrap.root.id, itemId: "std", path: ["upper"], rootItem: true } };
  let revision = 0;
  const drafts = new Set();
  const persistence = createViewPersistence({ delay: 60_000, version: () => state.root?.revision,
    origin: () => state.source, changed: () => { revision++; },
    write: async () => { throw new Error("This fixture must not persist a draft"); }, refresh: async () => {} });
  const bindings = {
    rootDataRow, root: () => state.root, scope: () => state.focus,
    draftRevision: () => revision, viewPersistence: persistence,
    heldLensSubject: () => state.held, valueScope: () => state.resolved,
    client: { get epoch() { return state.clientEpoch; }, get signal() { return { aborted: state.aborted }; } },
    sessionEpoch: () => state.epoch, rootSourceTicket: () => ({ origin: state.ticket }),
    assertCurrentSession: epoch => { if (epoch !== state.epoch) throw new Error("Retired reader epoch"); },
    assertSourceTicket: ticket => { if (ticket.origin !== state.source) throw new Error("Retired read source"); },
    Anything: { $complement: { $void: true } }, List: () => rootType,
    EMPTY_CANVAS: { kind: "canvas", items: [] },
  };
  const focused = new Function(...Object.keys(bindings), `${actual}; return focusedType;`)(...Object.values(bindings));
  return { state, focused,
    draft(view) { drafts.add(state.focus.viewId); persistence.update(state.focus.viewId, view); },
    dispose() { for (const id of drafts) persistence.discard(id); },
  };
}

describe("cold Home focused type preserves current admitted declarations", () => {
  test("a prepared Clipboard uses its admitted collection bound before empty-expression inference", () => {
    const method = section(home, "    type(item: LayoutItem) {", "    savedValue(id: string)");
    const actual = new Bun.Transpiler({ loader: "ts" }).transformSync(`const owner = {${method}};`);
    const owner = new Function("transferSession", `${actual}; return owner;`)(() => {
      throw new Error("Declared Clipboard data must not fall back to empty-list inference");
    });
    const clipboard = { id: "tab:clipboard", caption: "Clipboard", valueType: rootType,
      source: { kind: "ref", ref: { kind: "savedExpr", id: "tab:clipboard" } } };
    expect(owner.type(clipboard)).toBe(rootType);
  });
  test("a known function keeps its exact declared arrow while parent evaluation is pending", () => {
    const h = fixture();
    expect(h.focused()).toBe(arrow);
    h.state.focus.path = [];
    expect(h.focused()).toBe(original.valueType);
    h.state.focus = { kind: "root" };
    expect(h.focused()).toBe(rootType);
  });

  test("canonical completion, unknown and failure take precedence over transport", () => {
    const h = fixture();
    h.state.resolved = { ok: true, containerType: arrow.$arrow.returns };
    expect(h.focused()).toBe(arrow.$arrow.returns);
    h.state.resolved = { ok: true };
    expect(h.focused()).toBeUndefined();
    h.state.resolved = { ok: false, error: "Parent expression failed" };
    expect(h.focused()).toBeUndefined();
    h.state.held = { value: "Admitted subject", type: arrow };
    expect(h.focused()).toBe(arrow);
  });

  test("unknown paths, owners and reference descent never borrow the parent List", () => {
    for (const focus of [
      { itemId: "missing" }, { path: ["missing"] }, { path: [0] },
      { path: ["upper", "result"] }, { viewId: "missing-list", rootItem: false },
    ]) {
      const h = fixture(); Object.assign(h.state.focus, focus);
      expect(h.focused()).toBeUndefined();
    }
    const h = fixture();
    h.state.root = { ...h.state.root, items: [{ ...original, valueType: { $ref: "UnresolvedRecord" } }] };
    expect(h.focused()).toBeUndefined();
    h.state.root = undefined;
    expect(h.focused()).toBeUndefined();
  });

  test("aborted, replaced-session and retired-source reads refuse admitted facts", () => {
    for (const patch of [{ aborted: true }, { epoch: 8 }, { source: "replacement" }]) {
      const h = fixture(); Object.assign(h.state, patch);
      expect(h.focused()).toBeUndefined();
    }
    const h = fixture();
    Object.assign(h.state, { source: "replacement", ticket: "replacement" });
    h.state.root = { ...h.state.root, revision: h.state.root.revision + 1, items: [{ ...original,
      valueType: { $record: { fields: [{ name: "upper", type: arrow.$arrow.returns }] } } }] };
    expect(h.focused()).toBe(arrow.$arrow.returns);
  });

  test("the current draft changes or removes the persisted declaration", () => {
    const h = fixture();
    try {
      h.draft({ kind: "grid", items: [{ ...original,
        valueType: { $record: { fields: [{ name: "upper", type: arrow.$arrow.returns }] } } }] });
      expect(h.focused()).toBe(arrow.$arrow.returns);
      h.draft({ kind: "grid", items: [] });
      expect(h.focused()).toBeUndefined();
    } finally { h.dispose(); }
  });

  test("nested tree items and saved-list items reuse the existing current item owner", () => {
    const h = fixture();
    try {
      h.draft({ kind: "tree", items: [{ id: "tree-parent", children: [original] }] });
      expect(h.focused()).toBe(arrow);
    } finally { h.dispose(); }
    h.state.root = { ...h.state.root, lists: [{ id: "saved-list", view: { kind: "tree",
      items: [{ id: "saved-parent", children: [{ id: "saved-function", valueType: arrow }] }] } }] };
    h.state.focus = { kind: "value", viewId: "saved-list", itemId: "saved-function", path: [], rootItem: false };
    expect(h.focused()).toBe(arrow);
    h.state.root.lists = [];
    expect(h.focused()).toBeUndefined();
  });
});
