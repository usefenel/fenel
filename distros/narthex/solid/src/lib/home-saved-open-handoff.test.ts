import { describe, expect, test } from "bun:test";
import { cloneDraftValue } from "./native-draft";
import type { HomeAction } from "./home-action";

// Execute the existing Home owners without constructing an unrelated registry.
// The shell/browser fixture covers the real arrow, cancellation and replacement;
// this covers the same saved editor's ready and retained-action entry points.
const source = (await Bun.file(process.env.FENEL_HOME_SAVED_OPEN_SOURCE
  ?? new URL("../routes/app/home.tsx", import.meta.url)).text()).replace(/\r\n/g, "\n");
function section(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error(`Saved editor owner boundary changed: ${startMarker}`);
  return source.slice(start, end);
}
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(
  section("  const initialSavedOpen =", "  const initialSource =")
  + section("  type ItemEditState =", "  const [calling,")
  + section("  let acceptedShellAction =", "  onSettled(() => {\n    const paste ="),
);

const query = (text: string) => ({ kind: "expression", expr: { kind: "literal", value: text } });
function harness(initialAction?: HomeAction) {
  let root: { id: string } | null = null;
  let saved = { failed: false, queries: [{ id: "note", query: query("first") }] };
  let ticket: object = { generation: 1 };
  let consume!: () => void;
  const bindings = {
    initialAction, initialPin: undefined, props: {}, cloneDraftValue,
    createSignal: (initial: unknown) => {
      let value = initial;
      return [() => value, (next: unknown) => { value = next; }];
    },
    createEffect: (read: () => unknown, apply: (value: unknown) => void) => { consume = () => apply(read()); },
    root: () => root, savedAll: () => saved, rootSourceTicket: () => ticket,
    reader: { kind: "local" }, scope: () => ({ kind: "root" }), transferOwner: undefined,
    peekWorkspaceTransfers: () => [], takeWorkspaceTransfers: () => [],
    createLinkedDemo: () => { throw new Error("Opening saved data must not create a demo"); },
    homeData: { add: () => { throw new Error("Opening saved data must not pin another copy"); } },
  };
  const owner = new Function(...Object.keys(bindings), `${code}; return { editing, setEditing, openSavedItemEditor };`)(...Object.values(bindings)) as {
    editing: () => { homeId: string; standalone: string; item: unknown; sourceTicket: object; expectedSavedQuery: unknown } | null;
    setEditing: (value: null) => void; openSavedItemEditor: (id: string, caption: string) => void;
  };
  return { ...owner, consume,
    prepare: (text: string, failed = false) => {
      root = { id: "local-root" }; saved = { failed, queries: [{ id: "note", query: query(text) }] };
      ticket = { generation: 2 }; return { saved, ticket };
    },
  };
}

describe("Browse saved Open uses the current reader's existing editor", () => {
  const action: HomeAction = { kind: "open-saved", savedExprId: "note", caption: "Demo note" };

  test("a retained arrow waits for root/saved readiness and captures the current query and source ticket once", () => {
    const h = harness(action);
    h.consume(); expect(h.editing()).toBeNull();
    const refused = h.prepare("not accepted", true);
    h.consume(); expect(h.editing()).toBeNull();
    const current = h.prepare("current value");
    h.consume();
    const editor = h.editing()!;
    expect(editor.homeId).toBe(""); expect(editor.standalone).toBe("saved");
    expect(editor.item).toEqual({ id: "browse:saved:note", caption: "Demo note",
      source: { kind: "ref", ref: { kind: "savedExpr", id: "note" } } });
    expect(editor.sourceTicket).toBe(current.ticket);
    expect(editor.sourceTicket).not.toBe(refused.ticket);
    expect(editor.expectedSavedQuery).toEqual(query("current value"));
    expect(editor.expectedSavedQuery).not.toBe(current.saved.queries[0]!.query);
    current.saved.queries[0]!.query.expr.value = "later edit";
    expect(editor.expectedSavedQuery).toEqual(query("current value"));
    h.setEditing(null); h.prepare("another publication"); h.consume();
    expect(h.editing()).toBeNull(); // A later read cannot reopen a dismissed editor.
  });

  test("an already prepared Browse arrow uses the same editor qualification", () => {
    const h = harness();
    const current = h.prepare("ready value"); h.consume();
    expect(h.editing()).toBeNull();
    h.openSavedItemEditor("note", "Demo note");
    expect(h.editing()?.sourceTicket).toBe(current.ticket);
    expect(h.editing()?.expectedSavedQuery).toEqual(query("ready value"));
    expect(h.editing()?.standalone).toBe("saved");
  });

  test("other startup intents do not open a saved editor", () => {
    const h = harness({ kind: "browse", query: "Demo note" });
    h.prepare("ready value"); h.consume(); expect(h.editing()).toBeNull();
  });
});
