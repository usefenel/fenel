import type { FenelType } from "@fenel/engine/types";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { Anything, List } from "@fenel/engine/type-foundation";
import {
  applyLocusCommands, defaultListLayout, type LocusCommand, type LocusEntry,
  authoredPlacements, canvasExpression, canvasSource, isCanvasExpression, placementFromGeometry, placedListType,
  type AuthoredPlacement,
} from "@fenel/engine/authoring/expression";

/** The persisted subject is an ordinary Fenel list expression. These identities
 * and labels describe its occurrences; none carries another copy of its data.
 * Legacy layout arguments are retained while their renderers are replaced. */
export type LocusOccurrence = {
  id: string;
  attributes: Record<string, unknown>;
  form?: "list" | "tree";
  children?: LocusOccurrence[];
  layout?: Record<string, unknown>;
};

export type LocusRootValue = {
  $locusRoot: 1;
  type: FenelType;
  expr: ExprNode;
  revision: number;
  occurrences: LocusOccurrence[];
  layout: { kind: "list" | "grid" | "tree" | "tabs"; axis?: "horizontal" | "vertical" };
  activeListId: string | null;
  /** The original rows are retained physically, and this is their exact id set.
   * They are archival once this carrier exists; reads never merge them back. */
  migratedRowIds: string[];
  legacyRevisions: Record<string, string | null>;
};

export type LegacyLocusRow = {
  id: string;
  name: string;
  view: unknown;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type LocusItem = Record<string, unknown> & { id: string; source?: unknown; expr?: unknown };
export type LocusRootSingleCommand =
  | { kind: "append"; item: LocusItem }
  | { kind: "replace"; itemId: string; item: LocusItem }
  | { kind: "remove"; itemId: string }
  | { kind: "reorder"; itemIds: string[] }
  | { kind: "layout"; layout: LocusRootValue["layout"] };
export type LocusRootCommand = LocusRootSingleCommand | { kind: "batch"; commands: LocusRootSingleCommand[] };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const locusListType = (): FenelType => List(Anything);
export const locusListExpression = (items: ExprNode[]): ExprNode => ({ kind: "literal", value: { __list: items } });
export function locusListElements(expr: ExprNode): ExprNode[] | undefined {
  if (expr.kind !== "literal" || !record(expr.value) || !Array.isArray(expr.value.__list)) return undefined;
  return expr.value.__list as ExprNode[];
}

/** Structural equality over JSON data, independent of key order. The carrier
 * lives in a jsonb column, and jsonb returns object keys shortest first rather
 * than in the order they were written. Keys holding `undefined` are absent. */
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => sameJson(item, right[index]));
  }
  if (!record(left) || !record(right)) return false;
  const keys = (value: Record<string, unknown>) => Object.keys(value).filter((key) => value[key] !== undefined);
  const leftKeys = keys(left);
  return leftKeys.length === keys(right).length
    && leftKeys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}

function expression(value: unknown): value is ExprNode {
  if (!record(value)) return false;
  if (value.kind === "literal") return Object.hasOwn(value, "value");
  if (value.kind === "ref") return typeof value.savedExprId === "string";
  if (value.kind === "param") return typeof value.name === "string";
  return value.kind === "call" && typeof value.fnId === "string" && Array.isArray(value.args) && value.args.every(expression);
}

/** Fail closed on malformed data. An empty list must never be the fallback for
 * a carrier we could not decode: that would turn the next save into data loss. */
export function assertLocusRoot(value: unknown): asserts value is LocusRootValue {
  if (!record(value) || value.$locusRoot !== 1 || !expression(value.expr)
    || !Array.isArray(value.occurrences) || !Array.isArray(value.migratedRowIds) || !record(value.legacyRevisions)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !record(value.layout) || !["list", "grid", "tree", "tabs"].includes(String(value.layout.kind))) {
    throw new Error("The saved root data has an unsupported or malformed carrier.");
  }
  if (!sameJson(value.type, locusListType())) throw new Error("The account root must have the Fenel type List Anything.");
  const check = (expr: ExprNode, nodes: LocusOccurrence[]) => {
    const values = locusListElements(canvasSource(expr) ?? expr);
    if (!values || values.length !== nodes.length) throw new Error("The saved root list and its identities disagree.");
    if (isCanvasExpression(expr) && authoredPlacements(expr)?.length !== nodes.length) throw new Error("The saved canvas has malformed placement arguments.");
    const ids = new Set<string>();
    nodes.forEach((node, index) => {
      if (!record(node) || typeof node.id !== "string" || !node.id || ids.has(node.id) || !record(node.attributes)) throw new Error("The saved root has duplicate or invalid value identities.");
      ids.add(node.id);
      if (node.form === "list") check(values[index]!, node.children ?? []);
      if (node.form === "tree") {
        const parts = treeParts(values[index]!);
        if (!parts) throw new Error("The saved tree value is malformed.");
        check(parts.children, node.children ?? []);
      }
    });
  };
  check(value.expr as ExprNode, value.occurrences as LocusOccurrence[]);
}

function sourceOf(item: Record<string, unknown>): ExprNode {
  const source = item.source;
  if (record(source) && source.kind === "ref" && record(source.ref) && source.ref.kind === "savedExpr" && typeof source.ref.id === "string") {
    return { kind: "ref", savedExprId: source.ref.id };
  }
  if (record(source) && source.kind === "expr" && expression(source.expr)) return source.expr;
  if (expression(item.expr)) return item.expr;
  throw new Error(`The value ${typeof item.id === "string" ? item.id : "without an identity"} has no valid expression.`);
}

function treeExpression(value: ExprNode, children: ExprNode[]): ExprNode {
  return { kind: "literal", value: { __record: { fields: [
    { name: "value", value }, { name: "children", value: locusListExpression(children) },
  ] } } };
}
function treeParts(expr: ExprNode): { value: ExprNode; children: ExprNode } | undefined {
  if (expr.kind !== "literal" || !record(expr.value) || !record(expr.value.__record) || !Array.isArray(expr.value.__record.fields)) return undefined;
  const fields = expr.value.__record.fields as { name: string; value: ExprNode }[];
  const value = fields.find((field) => field.name === "value")?.value;
  const children = fields.find((field) => field.name === "children")?.value;
  return value && children ? { value, children } : undefined;
}

function importItem(item: unknown): { expr: ExprNode; occurrence: LocusOccurrence } {
  if (!record(item) || typeof item.id !== "string" || !item.id) throw new Error("A saved value has no stable identity.");
  const { id, source: _source, expr: _expr, children, ...attributes } = item;
  const expr = sourceOf(item);
  if (children !== undefined) {
    if (!Array.isArray(children)) throw new Error(`The children of ${id} are malformed.`);
    const nested = children.map(importItem);
    return { expr: treeExpression(expr, nested.map((child) => child.expr)), occurrence: { id, attributes, form: "tree", children: nested.map((child) => child.occurrence) } };
  }
  return { expr, occurrence: { id, attributes } };
}

function importView(view: unknown, preservePlaced = false): { expr: ExprNode; occurrences: LocusOccurrence[]; layout: Record<string, unknown>; valueType: FenelType } {
  if (!record(view) || !Array.isArray(view.items)) throw new Error("A saved list has malformed contents; it was left untouched.");
  const { items, ...layout } = view;
  const placed = layout.kind === "canvas" || preservePlaced;
  const placements: AuthoredPlacement[] = [];
  const imported = items.map((item) => {
    if (!placed || !record(item)) return importItem(item);
    const { x, y, w, h, ...data } = item;
    if (x === undefined && y === undefined && w === undefined && h === undefined) placements.push({ $tag: "Nothing" });
    else placements.push({ $tag: "Just", _0: placementFromGeometry({
      // These are the old renderer's explicit defaults, preserved only while
      // translating partially authored legacy positions into a typed value.
      x: (x ?? .5) as number, y: (y ?? .5) as number, w: w as number | undefined, h: h as number | undefined,
    }) });
    return importItem(data);
  });
  const source = locusListExpression(imported.map((item) => item.expr));
  return { expr: placed ? canvasExpression(source, placements) : source,
    occurrences: imported.map((item) => item.occurrence), layout,
    valueType: placed ? placedListType(Anything) : locusListType() };
}

/** Pure preview, also used by the first authorized write under its transaction.
 * No row is dropped, flattened, evaluated, or dereferenced during migration. */
export function migrateLocusRows(rows: readonly LegacyLocusRow[]): LocusRootValue {
  const values = rows.map((row) => {
    const child = importView(row.view);
    return { expr: child.expr, occurrence: {
      id: row.id, attributes: { caption: row.name, valueType: child.valueType },
      form: "list" as const, children: child.occurrences, layout: child.layout,
    } };
  });
  const result: LocusRootValue = {
    $locusRoot: 1, type: locusListType(), expr: locusListExpression(values.map((item) => item.expr)),
    revision: 0, occurrences: values.map((item) => item.occurrence), layout: defaultListLayout(),
    activeListId: rows.find((row) => row.active)?.id ?? rows[0]?.id ?? null,
    migratedRowIds: rows.map((row) => row.id),
    legacyRevisions: Object.fromEntries(rows.map((row) => [row.id, legacyLocusRevision(row.updatedAt)])),
  };
  assertLocusRoot(result);
  return result;
}

export function legacyLocusRevision(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
}

function projectedItem(expr: ExprNode, occurrence: LocusOccurrence): LocusItem {
  if (occurrence.form === "tree") {
    const parts = treeParts(expr)!;
    return { ...occurrence.attributes, id: occurrence.id, source: projectedSource(parts.value), children: projectItems(parts.children, occurrence.children ?? []) };
  }
  return { ...occurrence.attributes, id: occurrence.id, source: projectedSource(expr) };
}
function projectedSource(expr: ExprNode) {
  return expr.kind === "ref"
    ? { kind: "ref", ref: { kind: "savedExpr", id: expr.savedExprId } }
    : { kind: "expr", expr };
}
function projectItems(expr: ExprNode, occurrences: LocusOccurrence[]): LocusItem[] {
  const placements = authoredPlacements(expr);
  return locusListElements(canvasSource(expr) ?? expr)!.map((value, index) => {
    const item = projectedItem(value, occurrences[index]!);
    const placement = placements?.[index];
    return placement?.$tag === "Just" ? { ...item, x: placement._0.at.x, y: placement._0.at.y,
      ...(placement._0.width.$tag === "Just" ? { w: placement._0.width._0 } : {}),
      ...(placement._0.height.$tag === "Just" ? { h: placement._0.height._0 } : {}),
    } : item;
  });
}
export const locusReferenceId = (accountId: string, itemId?: string): string => itemId === undefined ? `locus:${accountId}` : `locus:${accountId}:${itemId}`;

/** A data set's entries: each item's expression beside its occurrence id, as
 * `view:LocusEntry` values. A canvas over the set keys its placements by these
 * ids (`view:placeEntries`), so removing, reordering or editing an item moves
 * no other item's card. Only a plain list has entries: a set that is itself a
 * derived canvas presents placed items, not its source's. */
export function locusEntriesExpression(expr: ExprNode, occurrences: readonly LocusOccurrence[]): ExprNode | undefined {
  const items = locusListElements(expr);
  if (!items || items.length !== occurrences.length) return undefined;
  return locusListExpression(items.map((value, index) => ({ kind: "literal", value: { __construct: { tag: "LocusEntry", fields: [
    { name: "id", value: { kind: "literal", value: occurrences[index]!.id } }, { name: "value", value },
  ] } } })));
}

export function projectLocusRoot(accountId: string, value: LocusRootValue, persisted: boolean) {
  assertLocusRoot(value);
  const elements = locusListElements(value.expr)!;
  const expressions: Record<string, ExprNode> = { [locusReferenceId(accountId)]: value.expr };
  value.occurrences.forEach((occurrence, index) => {
    const referenceId = locusReferenceId(accountId, occurrence.id);
    expressions[referenceId] = elements[index]!;
    const source = canvasSource(elements[index]!);
    if (source) expressions[`${referenceId}:source`] = source;
    const entries = occurrence.form === "list" ? locusEntriesExpression(elements[index]!, occurrence.children ?? []) : undefined;
    if (entries) expressions[`${referenceId}:entries`] = entries;
  });
  const lists = value.occurrences.flatMap((occurrence, index) => occurrence.form !== "list" ? [] : [{
    id: occurrence.id, name: typeof occurrence.attributes.caption === "string" ? occurrence.attributes.caption : "List",
    active: occurrence.id === value.activeListId,
    view: { ...occurrence.layout, items: projectItems(elements[index]!, occurrence.children ?? []) },
    referenceId: locusReferenceId(accountId, occurrence.id),
    sourceReferenceId: canvasSource(elements[index]!) ? `${locusReferenceId(accountId, occurrence.id)}:source` : locusReferenceId(accountId, occurrence.id),
    ...(locusEntriesExpression(elements[index]!, occurrence.children ?? []) ? { entriesReferenceId: `${locusReferenceId(accountId, occurrence.id)}:entries` } : {}),
    valueType: occurrence.attributes.valueType as FenelType,
    derivedCanvas: isCanvasExpression(elements[index]),
    rootRevision: value.revision,
  }]);
  return { id: accountId, name: "All data", type: value.type, expr: value.expr, revision: value.revision,
    persisted, layout: value.layout, items: projectItems(value.expr, value.occurrences), lists, expressions,
    referenceId: locusReferenceId(accountId),
  };
}
export type LocusRoot = ReturnType<typeof projectLocusRoot>;

type RootEntryValue = { expr: ExprNode; occurrence: LocusOccurrence };
function rootEntries(value: LocusRootValue): LocusEntry<RootEntryValue>[] {
  const expressions = locusListElements(value.expr)!;
  return value.occurrences.map((occurrence, index) => ({ id: occurrence.id, value: { expr: expressions[index]!, occurrence } }));
}
function editRootEntries(value: LocusRootValue, commands: LocusCommand<RootEntryValue>[]): LocusRootValue {
  const result = applyLocusCommands(rootEntries(value), commands);
  if (result.$tag === "Err") throw new Error(result._0);
  const occurrences = result._0.map((entry) => entry.value.occurrence);
  const activeListId = occurrences.some((item) => item.id === value.activeListId && item.form === "list") ? value.activeListId : occurrences.find((item) => item.form === "list")?.id ?? null;
  return { ...value, expr: locusListExpression(result._0.map((entry) => entry.value.expr)), occurrences,
    activeListId, revision: value.revision + 1 };
}

export function applyLocusRootCommand(value: LocusRootValue, command: LocusRootCommand): LocusRootValue {
  assertLocusRoot(value);
  if (!record(command)) throw new Error("A root edit command is required.");
  const input = command.kind === "batch" ? command.commands : [command];
  if (!Array.isArray(input) || input.length < 1 || input.length > 256
      || input.some((child) => !record(child) || (child as { kind: unknown }).kind === "batch")) {
      throw new Error("A grouped edit requires 1 to 256 ordinary value edits.");
  }
  let layout = value.layout;
  const edits: LocusCommand<RootEntryValue>[] = [];
  // This is the transport codec: JSX occurrence metadata and the existing
  // expression editor carrier become typed command payloads. All list
  // surgery, identity checks, ordering, and batch failure semantics are Fenel.
  for (const command of input) {
    if ((command.kind === "append" || command.kind === "replace") && record(command.item)
      && ["x", "y", "w", "h", "date", "ts", "lat", "lng"].some((key) => Object.hasOwn(command.item, key) && command.item[key] !== undefined)) {
      throw new Error("Positions and dates belong in typed values or derivation arguments, not on a plain root-list item.");
    }
    if (command.kind === "append" || command.kind === "replace") {
      const next = importItem(command.item);
      if (command.kind === "replace") {
        // A data set keeps its items' captions, types and dates as child
        // occurrences, and its layout beside them. A plain item carries
        // neither, so replacing the set with one would drop them for good.
        // A set is edited from inside it (`updateLocusList`).
        const target = value.occurrences.find((occurrence) => occurrence.id === command.itemId);
        if (target?.form !== undefined && target.form !== next.occurrence.form) {
          throw new Error("Edit this data set from inside it. Replacing it here would drop its items' details.");
        }
      }
      const entry = { id: next.occurrence.id, value: next };
      edits.push(command.kind === "append" ? { $tag: "LocusAppend", entry } : { $tag: "LocusReplace", id: command.itemId, entry });
    } else if (command.kind === "remove") edits.push({ $tag: "LocusRemove", id: command.itemId });
    else if (command.kind === "reorder") {
      if (!Array.isArray(command.itemIds) || !command.itemIds.every((id) => typeof id === "string")) throw new Error("A reorder requires a list of value identities.");
      edits.push({ $tag: "LocusReorder", ids: command.itemIds });
    } else if (command.kind === "layout") {
      if (!record(command.layout) || !["list", "grid", "tree", "tabs"].includes(String(command.layout.kind))) throw new Error("This layout needs additional typed data.");
      const kind = command.layout.kind as LocusRootValue["layout"]["kind"];
      const axis = kind === "list" && (command.layout.axis === "horizontal" || command.layout.axis === "vertical")
        ? command.layout.axis : undefined;
      layout = axis ? { kind, axis } : { kind };
    } else throw new Error("Unknown root edit command.");
  }
  return { ...editRootEntries(value, edits), layout };
}

/** Compatibility editor for migrated child lists. Data is rewritten into the
 * root expression; the archived locus row is never updated. */
export function updateLocusList(value: LocusRootValue, id: string, patch: { name?: string; view?: unknown; active?: boolean }): LocusRootValue | undefined {
  const index = value.occurrences.findIndex((item) => item.id === id && item.form === "list");
  if (index < 0) return undefined;
  const occurrence = value.occurrences[index]!;
  const previous = locusListElements(value.expr)![index]!;
  const imported = patch.view === undefined ? undefined : importView(patch.view, isCanvasExpression(previous));
  const nextOccurrence: LocusOccurrence = {
    ...occurrence, ...(imported ? { children: imported.occurrences, layout: imported.layout } : {}),
    attributes: { ...occurrence.attributes,
      ...(imported ? { valueType: imported.valueType } : {}),
      ...(patch.name === undefined ? {} : { caption: patch.name }),
    },
  };
  const updated = editRootEntries(value, [{ $tag: "LocusReplace", id, entry: { id, value: { expr: imported?.expr ?? previous, occurrence: nextOccurrence } } }]);
  return { ...updated, activeListId: patch.active === true ? id : patch.active === false && value.activeListId === id ? null : value.activeListId };
}

export function appendLocusList(value: LocusRootValue, row: LegacyLocusRow): LocusRootValue {
  const imported = migrateLocusRows([row]);
  const updated = editRootEntries(value, [{ $tag: "LocusAppend", entry: rootEntries(imported)[0]! }]);
  return { ...updated, activeListId: row.active || !value.activeListId ? row.id : value.activeListId };
}
