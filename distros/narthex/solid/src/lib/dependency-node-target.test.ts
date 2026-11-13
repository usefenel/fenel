import { expect, test } from "bun:test";
import { dependencyNodeTarget } from "./dependency-node-target";

const places = {
  rootId: "root",
  rootItems: [{ id: "species" }, { id: "genus" }],
  lists: [{ id: "list-1", view: { items: [{ id: "listed" }] } }],
  packetOccurrences: [
    { id: "elsewhere", referenceId: { $tag: "Just", _0: "saved-a" } },
    { id: "genus", referenceId: { $tag: "Just", _0: "saved-a" } },
    { id: "listed", referenceId: { $tag: "Just", _0: "saved-b" } },
    { id: "species", referenceId: { $tag: "Nothing" } },
    { id: "demo-binding", referenceId: { $tag: "Just", _0: "encyclopedia-plant" } },
  ],
  catalogPaths: new Map([["std-add", { itemId: "std", path: ["add"] }], ["demo-binding", { itemId: "demo", path: ["People", "Plant"] }]]),
};

test("a root item opens in place", () => {
  expect(dependencyNodeTarget("species", places)).toEqual({ kind: "value", viewId: "root", itemId: "species", path: [], rootItem: true });
});

test("a list item opens in its list", () => {
  expect(dependencyNodeTarget("listed", places)).toEqual({ kind: "value", viewId: "list-1", itemId: "listed", path: [] });
});

test("a saved identity opens the first item of this tab that holds it", () => {
  expect(dependencyNodeTarget("saved-a", places)).toEqual({ kind: "value", viewId: "root", itemId: "genus", path: [], rootItem: true });
  expect(dependencyNodeTarget("saved-b", places)).toEqual({ kind: "value", viewId: "list-1", itemId: "listed", path: [] });
});

test("a public library entry opens at its catalogue path", () => {
  expect(dependencyNodeTarget("std-add", places)).toEqual({ kind: "value", viewId: "root", itemId: "std", path: ["add"], rootItem: true });
});

test("a public value held by a demo entry opens that entry", () => {
  expect(dependencyNodeTarget("encyclopedia-plant", places)).toEqual({ kind: "value", viewId: "root", itemId: "demo", path: ["People", "Plant"], rootItem: true });
});

test("a node with no place in this tab has no target", () => {
  expect(dependencyNodeTarget("std.filter", places)).toBeUndefined();
  expect(dependencyNodeTarget("", places)).toBeUndefined();
  expect(dependencyNodeTarget("species", {})).toBeUndefined();
});
