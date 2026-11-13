import { describe, expect, test } from "bun:test";
import {
  ROOT_SCOPE, appendValueAt, childrenOf, containerSummary, enterChild, isEnterable,
  isLocusSetRef, locusSetRef, parentScope, removeValueAt, scopeAncestors, scopeKey,
  scopeLabel, scopeViewId, setValueAt, valueAt, type LocusScope,
} from "./locus-scope";

const inValue = (path: (string | number)[]): LocusScope =>
  ({ kind: "value", viewId: "set-1", itemId: "card-1", path });

describe("where you are", () => {
  test("the root has nothing above it, so there is nowhere to go up to", () => {
    expect(scopeAncestors(ROOT_SCOPE)).toEqual([]);
    expect(parentScope(ROOT_SCOPE)).toBeUndefined();
  });

  test("a data set sits directly in the root", () => {
    const set: LocusScope = { kind: "view", viewId: "set-1" };
    expect(scopeAncestors(set)).toEqual([ROOT_SCOPE]);
    expect(parentScope(set)).toEqual(ROOT_SCOPE);
  });

  test("the trail into a value passes through every step it took", () => {
    expect(scopeAncestors(inValue(["a", 2]))).toEqual([
      ROOT_SCOPE,
      { kind: "view", viewId: "set-1" },
      inValue([]),
      inValue(["a"]),
    ]);
  });

  test("going up unwinds one step at a time", () => {
    expect(parentScope(inValue(["a", 2]))).toEqual(inValue(["a"]));
    expect(parentScope(inValue([]))).toEqual({ kind: "view", viewId: "set-1" });
  });

  test("a direct root value has no synthetic list between it and the root", () => {
    const scope: LocusScope = { kind: "value", viewId: "account", itemId: "number", path: [], rootItem: true };
    expect(scopeAncestors(scope)).toEqual([ROOT_SCOPE]);
    expect(parentScope(enterChild(scope, "name"))).toEqual(scope);
  });

  test("list index 1 and field \"1\" are different places", () => {
    expect(scopeKey(inValue([1]))).not.toBe(scopeKey(inValue(["1"])));
  });

  test("a scope knows which data set it is inside", () => {
    expect(scopeViewId(ROOT_SCOPE)).toBeUndefined();
    expect(scopeViewId(inValue(["a"]))).toBe("set-1");
  });

  test("entering names the step it took", () => {
    expect(enterChild(inValue(["a"]), 3)).toEqual(inValue(["a", 3]));
  });

  test("a crumb reads as the step, and names come from the caller", () => {
    expect(scopeLabel(ROOT_SCOPE)).toBe("All data");
    expect(scopeLabel({ kind: "view", viewId: "s" }, { viewName: () => "Photos" })).toBe("Photos");
    expect(scopeLabel(inValue([2]))).toBe("Item 3");
    expect(scopeLabel(inValue(["title"]))).toBe("title");
  });
});

describe("walking a value", () => {
  const doc = { $tag: "Post", title: "hi", tags: ["a", "b"], author: { name: "Rom" } };

  test("a path reads what it points at", () => {
    expect(valueAt(doc, [])).toBe(doc);
    expect(valueAt(doc, ["tags", 1])).toBe("b");
    expect(valueAt(doc, ["author", "name"])).toBe("Rom");
  });

  test("a path that leaves the value answers nothing rather than throwing", () => {
    expect(valueAt(doc, ["title", "nope"])).toBeUndefined();
    expect(valueAt(doc, ["missing", "deeper"])).toBeUndefined();
  });

  test("writing shares everything above the path and leaves the original alone", () => {
    const next = setValueAt(doc, ["author", "name"], "Bayne") as typeof doc;
    expect(next.author.name).toBe("Bayne");
    expect(doc.author.name).toBe("Rom");
    expect(next.tags).toBe(doc.tags);
    expect(next.$tag).toBe("Post");
  });

  test("a list stays a list and keeps its length", () => {
    const next = setValueAt(doc, ["tags", 0], "z") as typeof doc;
    expect(Array.isArray(next.tags)).toBe(true);
    expect(next.tags).toEqual(["z", "b"]);
  });

  test("a step that does not fit its carrier is refused, not coerced", () => {
    expect(() => setValueAt(doc, ["tags", "name"], 1)).toThrow(/list index/);
    expect(() => setValueAt(doc, ["author", 0], 1)).toThrow(/field name/);
    expect(() => setValueAt(doc, ["tags", 9], 1)).toThrow(/no item 10/);
    expect(() => setValueAt(doc, ["title", "x"], 1)).toThrow(/no longer has the contents/);
  });

  test("an empty path replaces the whole value", () => {
    expect(setValueAt(doc, [], 5)).toBe(5);
  });

  test("only own fields are paths and stale edits cannot create fields", () => {
    expect(valueAt({}, ["constructor"])).toBeUndefined();
    expect(() => setValueAt({}, ["missing"], 3)).toThrow(/no longer has the field/);
    expect(() => setValueAt([1], [0.5], 3)).toThrow(/no item/);
    const data = JSON.parse('{"__proto__":{"safe":1}}');
    const result = setValueAt(data, ["__proto__", "safe"], 2) as any;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.__proto__.safe).toBe(2);
  });

  test("removing from a list closes the gap; removing a field drops the key", () => {
    expect((removeValueAt(doc, ["tags", 0]) as typeof doc).tags).toEqual(["b"]);
    expect("name" in (removeValueAt(doc, ["author", "name"]) as { author: object }).author).toBe(false);
  });

  test("a value cannot remove itself", () => {
    expect(() => removeValueAt(doc, [])).toThrow(/cannot remove itself/);
  });

  test("only a list grows by adding", () => {
    expect((appendValueAt(doc, ["tags"], "c") as typeof doc).tags).toEqual(["a", "b", "c"]);
    expect(() => appendValueAt(doc, ["author"], 1)).toThrow(/Only a list/);
  });
});

describe("what a value contains", () => {
  test("a list offers its items in order", () => {
    expect(childrenOf([10, 20])).toEqual([
      { key: 0, label: "Item 1", value: 10 },
      { key: 1, label: "Item 2", value: 20 },
    ]);
  });

  test("a record offers its fields, and a variant hides its discriminator", () => {
    expect(childrenOf({ $tag: "Just", _0: 7 })).toEqual([{ key: "_0", label: "_0", value: 7 }]);
  });

  test("a scalar is a leaf, so there is nothing to enter", () => {
    for (const leaf of ["text", 5, true, null, undefined]) {
      expect(childrenOf(leaf)).toBeUndefined();
      expect(isEnterable(leaf)).toBe(false);
    }
  });

  test("a value that carries its own presentation is a leaf", () => {
    // A file's fields are its carrier, not its contents. Offering to enter it
    // would promise a room that is not there.
    const file = { url: "https://example.com/a.txt", name: "a.txt", mimeType: "text/plain", size: 12 };
    expect(childrenOf(file)).toBeUndefined();
    expect(isEnterable(file)).toBe(false);
  });

  test("a reference is a leaf: its fields are the reference's own machinery", () => {
    expect(childrenOf({ $pin: "function", name: "send", id: "fn-1" })).toBeUndefined();
    expect(childrenOf({ $ref: "std:negate" })).toBeUndefined();
    expect(childrenOf(locusSetRef({ id: "s", name: "Photos" }, 3))).toBeUndefined();
    // An applied type carries more than a handle, so it stays an open record.
    expect(childrenOf({ $ref: "List", args: ["String"] })?.map((child) => child.key)).toEqual(["$ref", "args"]);
  });

  test("a class instance is not an open structure", () => {
    expect(childrenOf(new Date())).toBeUndefined();
    expect(childrenOf(new Map())).toBeUndefined();
  });

  test("an empty container is still enterable — it has a room, just nothing in it", () => {
    expect(childrenOf([])).toEqual([]);
    expect(isEnterable([])).toBe(true);
    expect(isEnterable({})).toBe(true);
  });

  test("a container says what it is and how much of it there is", () => {
    expect(containerSummary([1])).toBe("1 item");
    expect(containerSummary([1, 2])).toBe("2 items");
    expect(containerSummary({ a: 1, b: 2 })).toBe("Record — 2 fields");
    expect(containerSummary({ $tag: "Just", _0: 1 })).toBe("Just — 1 field");
    expect(containerSummary("scalar")).toBeUndefined();
  });
});

describe("a data set seen from the root", () => {
  test("is a reference to the row, carrying what a card needs to say", () => {
    const ref = locusSetRef({ id: "set-1", name: "Photos" }, 12);
    expect(isLocusSetRef(ref)).toBe(true);
    expect(ref).toEqual({ $locus: "set-1", name: "Photos", count: 12 });
  });

  test("is not confused with an ordinary value", () => {
    expect(isLocusSetRef({ name: "Photos", count: 1 })).toBe(false);
    expect(isLocusSetRef(null)).toBe(false);
  });
});

describe("entering a card on a canvas", () => {
  test("the way back up skips the Placed wrapper the entry stepped through", () => {
    const canvas: LocusScope = { kind: "value", viewId: "root", itemId: "canvas", path: [], rootItem: true };
    const item: LocusScope = { ...canvas, path: [2, "item"], passThrough: [1] };
    expect(parentScope(item)).toEqual(canvas);
    expect(scopeAncestors(item).map((scope) => scope.kind === "value" ? scope.path : scope.kind)).toEqual(["root", []]);
    expect(scopeLabel(item)).toBe("Item 3");
    // Deeper places inside the item keep the item as a stop on the way back.
    const field: LocusScope = { ...item, path: [2, "item", "title"] };
    expect(parentScope(field)).toEqual(item);
  });
});
