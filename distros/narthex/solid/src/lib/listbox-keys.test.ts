// Run with --conditions=browser --conditions=development so signal writes are
// staged the way they are in the app.
import { expect, test } from "bun:test";
import { createRoot, createSignal, flush } from "solid-js";
import { activeListboxId, createListboxKeys, listboxCommand, stepListboxId } from "./listbox-keys";

const key = (key: string, extra: Partial<{ isComposing: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  key, isComposing: false, ctrlKey: false, metaKey: false, ...extra,
});

test("keys map to listbox commands; typing and IME composition are not ours", () => {
  expect(listboxCommand(key("ArrowDown"))).toEqual({ kind: "move", step: 1 });
  expect(listboxCommand(key("ArrowUp"))).toEqual({ kind: "move", step: -1 });
  expect(listboxCommand(key("Enter"))).toEqual({ kind: "pick", secondary: false });
  expect(listboxCommand(key("Enter", { ctrlKey: true }))).toEqual({ kind: "pick", secondary: true });
  expect(listboxCommand(key("Enter", { metaKey: true }))).toEqual({ kind: "pick", secondary: true });
  expect(listboxCommand(key("Escape"))).toEqual({ kind: "close" });
  expect(listboxCommand(key("a"))).toBeUndefined();
  expect(listboxCommand(key("Tab"))).toBeUndefined();
  expect(listboxCommand(key("Enter", { isComposing: true }))).toBeUndefined();
  expect(listboxCommand(key("ArrowDown", { isComposing: true }))).toBeUndefined();
});

test("the active row is the highlighted one while listed, else the first", () => {
  expect(activeListboxId(["a", "b", "c"], undefined)).toBe("a");
  expect(activeListboxId(["a", "b", "c"], "b")).toBe("b");
  expect(activeListboxId(["a", "c"], "b")).toBe("a");
  expect(activeListboxId([], "b")).toBeUndefined();
  expect(activeListboxId([], undefined)).toBeUndefined();
});

test("a step wraps at both ends and counts the implicit first row as active", () => {
  const ids = ["a", "b", "c"];
  expect(stepListboxId(ids, undefined, 1)).toBe("b");
  expect(stepListboxId(ids, undefined, -1)).toBe("c");
  expect(stepListboxId(ids, "b", 1)).toBe("c");
  expect(stepListboxId(ids, "c", 1)).toBe("a");
  expect(stepListboxId(ids, "a", -1)).toBe("c");
  expect(stepListboxId(ids, "gone", 1)).toBe("b");
  expect(stepListboxId(["only"], "only", 1)).toBe("only");
  expect(stepListboxId([], undefined, 1)).toBeUndefined();
});

type Row = { id: string };

function fakeEvent(name: string, extra: Partial<{ ctrlKey: boolean }> = {}) {
  let prevented = false;
  const event = {
    ...key(name, extra),
    preventDefault: () => { prevented = true; },
  } as unknown as KeyboardEvent;
  return { event, prevented: () => prevented };
}

function mount(options: { rows: Row[]; close?: boolean; secondary?: boolean }) {
  const picked: string[] = [];
  const opened: string[] = [];
  let closed = 0;
  return createRoot((dispose) => {
    const [rows, setRows] = createSignal<Row[]>(options.rows);
    const [query, setQuery] = createSignal("");
    const keys = createListboxKeys<Row>({
      rows,
      id: (row) => row.id,
      domPrefix: "test-option",
      pick: (row) => picked.push(row.id),
      secondary: options.secondary ? (row) => opened.push(row.id) : undefined,
      close: options.close ? () => { closed++; } : undefined,
      resetOn: query,
    });
    return { keys, setRows, setQuery, picked, opened, closed: () => closed, dispose };
  });
}

test("arrows move the highlight, Enter picks it, and the DOM ids follow it", () => {
  const list = mount({ rows: [{ id: "a" }, { id: "b/c" }, { id: "d" }] });
  try {
    expect(list.keys.activeRow()?.id).toBe("a");
    expect(list.keys.activeDescendant()).toBeUndefined();

    const down = fakeEvent("ArrowDown");
    list.keys.keyDown(down.event);
    flush();
    expect(down.prevented()).toBe(true);
    expect(list.keys.activeRow()?.id).toBe("b/c");
    expect(list.keys.isActive({ id: "b/c" })).toBe(true);
    expect(list.keys.isActive({ id: "a" })).toBe(false);
    expect(list.keys.activeDescendant()).toBe("test-option-b%2Fc");

    list.keys.keyDown(fakeEvent("ArrowUp").event);
    list.keys.keyDown(fakeEvent("ArrowUp").event);
    flush();
    expect(list.keys.activeRow()?.id).toBe("d");

    list.keys.keyDown(fakeEvent("Enter").event);
    expect(list.picked).toEqual(["d"]);
  } finally {
    list.dispose();
  }
});

test("a new query drops the highlight; a row the list no longer shows is not announced", () => {
  const list = mount({ rows: [{ id: "a" }, { id: "b" }] });
  try {
    list.keys.hover({ id: "b" });
    flush();
    expect(list.keys.activeRow()?.id).toBe("b");

    list.setRows([{ id: "a" }]);
    flush();
    expect(list.keys.activeRow()?.id).toBe("a");
    expect(list.keys.activeDescendant()).toBeUndefined();

    list.setRows([{ id: "a" }, { id: "b" }]);
    list.keys.hover({ id: "b" });
    flush();
    list.setQuery("x");
    flush();
    expect(list.keys.activeRow()?.id).toBe("a");
    expect(list.keys.activeDescendant()).toBeUndefined();
  } finally {
    list.dispose();
  }
});

test("Ctrl/Cmd+Enter takes the secondary action, or picks when there is none", () => {
  const withOpen = mount({ rows: [{ id: "a" }], secondary: true });
  const without = mount({ rows: [{ id: "a" }] });
  try {
    withOpen.keys.keyDown(fakeEvent("Enter", { ctrlKey: true }).event);
    expect(withOpen.opened).toEqual(["a"]);
    expect(withOpen.picked).toEqual([]);
    without.keys.keyDown(fakeEvent("Enter", { ctrlKey: true }).event);
    expect(without.picked).toEqual(["a"]);
  } finally {
    withOpen.dispose();
    without.dispose();
  }
});

test("Esc closes when the surface can close, and is left alone otherwise", () => {
  const closable = mount({ rows: [{ id: "a" }], close: true });
  const fixed = mount({ rows: [{ id: "a" }] });
  try {
    const esc = fakeEvent("Escape");
    closable.keys.keyDown(esc.event);
    expect(closable.closed()).toBe(1);
    expect(esc.prevented()).toBe(true);

    const ignored = fakeEvent("Escape");
    fixed.keys.keyDown(ignored.event);
    expect(ignored.prevented()).toBe(false);
  } finally {
    closable.dispose();
    fixed.dispose();
  }
});

test("an empty list swallows the keys without acting", () => {
  const list = mount({ rows: [] });
  try {
    list.keys.keyDown(fakeEvent("ArrowDown").event);
    list.keys.keyDown(fakeEvent("Enter").event);
    flush();
    expect(list.picked).toEqual([]);
    expect(list.keys.activeRow()).toBeUndefined();
  } finally {
    list.dispose();
  }
});
