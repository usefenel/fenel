import { expect, test } from "bun:test";
import { CHECKPOINT_VALUE_ENCODING, decodeCheckpointValue, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { exprNodeToLogic } from "@fenel/engine/authoring/expression";
import { authoredPlacements, canvasSource, isCanvasExpression } from "@fenel/engine/authoring/expression";
import {
  applyLocusRootCommand, assertLocusRoot, locusListElements, migrateLocusRows, projectLocusRoot, updateLocusList,
} from "./queries/locus-root-model";

const legacy = [
  { id: "list-a", name: "Images", active: true, view: { kind: "canvas", edgesVisible: false, items: [
    { id: "same-ref", caption: "Shared", x: .23, y: .42, source: { kind: "ref", ref: { kind: "savedExpr", id: "saved-a" } } },
    { id: "raw", source: { kind: "expr", expr: { kind: "literal", value: { bytes: Uint8Array.of(1, 255), zero: -0, maximum: Infinity } } } },
  ] } },
  { id: "list-b", name: "Tree", active: false, view: { kind: "tree", items: [
    { id: "parent", source: { kind: "expr", expr: { kind: "literal", value: "parent value" } }, collapsed: true,
      children: [{ id: "nested", source: { kind: "ref", ref: { kind: "savedExpr", id: "saved-a" } }, children: [] }] },
  ] } },
];

test("fresh roots use the source-owned List default and an explicit Grid survives reopening", () => {
  const root = migrateLocusRows([]);
  expect(root.layout).toEqual({ kind: "list" });
  const chosen = applyLocusRootCommand(root, { kind: "layout", layout: { kind: "grid" } });
  const reopened = decodeCheckpointValue(JSON.parse(JSON.stringify(encodeCheckpointValue(chosen))), CHECKPOINT_VALUE_ENCODING);
  assertLocusRoot(reopened);
  expect(projectLocusRoot("owner", reopened, true).layout).toEqual({ kind: "grid" });
});

test("migration is deterministic, preserves native values, layout arguments and nested tree data without dereferencing", () => {
  const root = migrateLocusRows(legacy);
  expect(migrateLocusRows(legacy)).toEqual(root);
  const reopened = decodeCheckpointValue(JSON.parse(JSON.stringify(encodeCheckpointValue(root))), CHECKPOINT_VALUE_ENCODING);
  assertLocusRoot(reopened);
  const projected = projectLocusRoot("owner", reopened, true);
  expect(projected.lists.map(({ referenceId: _referenceId, sourceReferenceId: _sourceReferenceId, rootRevision: _rootRevision, valueType: _valueType, derivedCanvas: _derivedCanvas, entriesReferenceId: _entriesReferenceId, ...row }) => row)).toEqual(legacy);
  expect(root.migratedRowIds).toEqual(["list-a", "list-b"]);
  const firstList = locusListElements(canvasSource(locusListElements(root.expr)![0]!)!)!;
  expect(firstList[0]).toEqual({ kind: "ref", savedExprId: "saved-a" });
  expect(projected.expressions["locus:owner:list-a"]).toEqual(locusListElements(root.expr)![0]);
  expect(projected.expressions["locus:owner:list-a:source"]).toEqual(canvasSource(locusListElements(root.expr)![0]!));
  expect(root.occurrences[0]!.children![0]!.attributes).not.toHaveProperty("x");
  expect(root.occurrences[0]!.children![0]!.attributes).not.toHaveProperty("y");
  expect(authoredPlacements(locusListElements(root.expr)![0]!)![0]).toMatchObject({ $tag: "Just", _0: { at: { x: .23, y: .42 } } });
});

/** What a Postgres jsonb column returns: object keys shortest first, then
 * bytewise, whatever order they were written in. */
function jsonbOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (!value || typeof value !== "object") return value;
  const keys = Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(keys.map((key) => [key, jsonbOrder((value as Record<string, unknown>)[key])]));
}
const throughJsonb = (value: unknown) =>
  decodeCheckpointValue(jsonbOrder(JSON.parse(JSON.stringify(encodeCheckpointValue(value)))), CHECKPOINT_VALUE_ENCODING);

test("a root read back through jsonb, with its keys reordered, is still readable and editable", () => {
  let root = migrateLocusRows(legacy);
  root = applyLocusRootCommand(root, { kind: "append", item: { id: "number", source: { kind: "expr", expr: { kind: "literal", value: 42 } } } });
  const reread = throughJsonb(root);
  // The reordering is real: the stored type no longer serializes identically.
  expect(JSON.stringify((reread as { type: unknown }).type)).not.toBe(JSON.stringify(root.type));
  assertLocusRoot(reread);
  expect(projectLocusRoot("owner", reread, true).items.map((item) => item.id)).toEqual(["list-a", "list-b", "number"]);
  const edited = applyLocusRootCommand(reread, { kind: "append", item: { id: "text", source: { kind: "expr", expr: { kind: "literal", value: "x" } } } });
  expect(edited.revision).toBe(root.revision + 1);
  assertLocusRoot(throughJsonb(edited));
});

test("a plain data set projects its entries, each item beside its occurrence id, for keyed canvases", () => {
  const root = migrateLocusRows(legacy);
  const projected = projectLocusRoot("owner", root, true);
  // list-b is a plain list; list-a was migrated as a canvas, which presents placed items instead.
  expect(projected.lists.find((row) => row.id === "list-b")).toMatchObject({ entriesReferenceId: "locus:owner:list-b:entries" });
  expect(projected.lists.find((row) => row.id === "list-a")).not.toHaveProperty("entriesReferenceId");
  expect(projected.expressions).not.toHaveProperty(["locus:owner:list-a:entries"]);
  const items = locusListElements(projected.expressions["locus:owner:list-b"]!)!;
  const entries = locusListElements(projected.expressions["locus:owner:list-b:entries"]!)!;
  // The item expressions are carried, not copied into values: references stay references.
  expect(entries.map((entry) => (entry as { value: { __construct: unknown } }).value.__construct)).toEqual(items.map((value, index) => ({
    tag: "LocusEntry", fields: [{ name: "id", value: { kind: "literal", value: root.occurrences[1]!.children![index]!.id } }, { name: "value", value }],
  })));
});

test("a data set is not replaced by the plain value its card projects, which would drop its items' details", () => {
  const root = migrateLocusRows(legacy);
  const card = projectLocusRoot("owner", root, false).items.find((item) => item.id === "list-a")!;
  expect(card).not.toHaveProperty("children");
  expect(() => applyLocusRootCommand(root, { kind: "replace", itemId: "list-a", item: card })).toThrow(/inside it/);
});

test("a new root contains scalar values directly, and its expression uses the actual engine list codec", () => {
  let root = migrateLocusRows([]);
  root = applyLocusRootCommand(root, { kind: "append", item: { id: "number", source: { kind: "expr", expr: { kind: "literal", value: 42 } } } });
  root = applyLocusRootCommand(root, { kind: "append", item: { id: "ref", source: { kind: "ref", ref: { kind: "savedExpr", id: "shared" } } } });
  expect(exprNodeToLogic(root.expr, { resolver: (id) => id === "shared" ? { kind: "literal", value: ["one", "two"] } : undefined })).toEqual([42, ["one", "two"]]);
  expect(projectLocusRoot("owner", root, true).lists).toEqual([]);
  expect(root.revision).toBe(2);
});

test("editing a migrated list rewrites its expression and retains stable reference ids", () => {
  const root = migrateLocusRows(legacy);
  const edited = updateLocusList(root, "list-a", { view: { kind: "list", items: [{ id: "same-ref", source: { kind: "expr", expr: { kind: "literal", value: "changed" } } }] } })!;
  const projected = projectLocusRoot("owner", edited, true);
  expect(exprNodeToLogic(projected.expressions["locus:owner:list-a:source"]!)).toEqual(["changed"]);
  expect(isCanvasExpression(projected.expressions["locus:owner:list-a"])).toBe(true);
  expect(edited.occurrences[0]!.id).toBe(root.occurrences[0]!.id);
  expect(projected.lists[1]!.view).toEqual(legacy[1]!.view);
  expect(root.revision).toBe(0);
});

test("unknown, duplicate, missing and malformed edits never silently erase data", () => {
  const root = migrateLocusRows(legacy);
  expect(() => applyLocusRootCommand(root, { kind: "reorder", itemIds: ["list-a", "list-a"] })).toThrow();
  expect(() => applyLocusRootCommand(root, { kind: "reorder", itemIds: ["list-a", "foreign"] })).toThrow();
  expect(() => applyLocusRootCommand(root, { kind: "remove", itemId: "foreign" })).toThrow();
  expect(() => applyLocusRootCommand(root, { kind: "replace", itemId: "list-a", item: { id: "other" } })).toThrow();
  expect(() => applyLocusRootCommand(root, { kind: "append", item: { id: "bad", source: { kind: "expr", expr: { kind: "unknown" } } } })).toThrow();
  expect(() => applyLocusRootCommand(root, { kind: "append", item: { id: "position", x: .2, source: { kind: "expr", expr: { kind: "literal", value: 4 } } } })).toThrow("typed values");
  expect(() => migrateLocusRows([{ id: "bad", name: "Bad", active: true, view: {} }])).toThrow();
  expect(() => assertLocusRoot({ ...root, occurrences: [] })).toThrow();
  expect(() => assertLocusRoot({ ...root, type: { $ref: "String" } })).toThrow("List Any");
  expect(() => applyLocusRootCommand(root, { kind: "layout", layout: { kind: "canvas" } as never })).toThrow("additional typed data");
  expect(root).toEqual(migrateLocusRows(legacy));
});

test("a bounded promotion batch appends and replaces atomically with one revision", () => {
  const initial = applyLocusRootCommand(migrateLocusRows([]), { kind: "append", item: { id: "source", source: { kind: "expr", expr: { kind: "literal", value: [1, 2] } } } });
  const result = applyLocusRootCommand(initial, { kind: "batch", commands: [
    { kind: "append", item: { id: "lifted", source: { kind: "expr", expr: { kind: "literal", value: 2 } } } },
    { kind: "replace", itemId: "source", item: { id: "source", source: { kind: "expr", expr: { kind: "literal", value: [1] } } } },
  ] });
  expect(result.revision).toBe(initial.revision + 1);
  expect(exprNodeToLogic(result.expr)).toEqual([[1], 2]);
  expect(() => applyLocusRootCommand(initial, { kind: "batch", commands: [] })).toThrow();
  expect(() => applyLocusRootCommand(initial, { kind: "batch", commands: [{ kind: "batch", commands: [] }] as never })).toThrow();
  expect(() => applyLocusRootCommand(initial, { kind: "batch", commands: [
    { kind: "append", item: { id: "lifted", source: { kind: "expr", expr: { kind: "literal", value: 2 } } } },
    { kind: "remove", itemId: "missing" },
  ] })).toThrow();
  expect(exprNodeToLogic(initial.expr)).toEqual([[1, 2]]);
});

test("root deletion and reorder edit the value; archival row ids do not resurrect removed children", () => {
  const root = migrateLocusRows(legacy);
  const reversed = applyLocusRootCommand(root, { kind: "reorder", itemIds: ["list-b", "list-a"] });
  expect(projectLocusRoot("owner", reversed, true).items.map((item) => item.id)).toEqual(["list-b", "list-a"]);
  const removed = applyLocusRootCommand(reversed, { kind: "remove", itemId: "list-a" });
  expect(projectLocusRoot("owner", removed, true).items.map((item) => item.id)).toEqual(["list-b"]);
  expect(removed.migratedRowIds).toEqual(["list-a", "list-b"]);
});
