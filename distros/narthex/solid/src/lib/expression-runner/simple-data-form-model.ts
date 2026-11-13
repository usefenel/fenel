// ---------------------------------------------------------------------------
// The New data dialog's simple form (demo 1, 2026-11-08): which drafts it can
// show, what each field row is, and when a row speaks. Pure: the editor
// supplies the catalogue facts (a tag's declared fields, a type's widget).
//
// The simple form is a presentation lens of the canonical expression editor
// (as TypeBuilder's "simple"), not a second editor: it edits the same
// constructor draft, and "Advanced" shows that draft in the full editor.
// ---------------------------------------------------------------------------

import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType, FieldDef } from "@fenel/engine/types";

/** `value`: the field's own input over its data. `saved`: a saved record of
 * the field's type is picked (a reference). `advanced`: an expression the
 * form does not author (a call, a parameter); shown, edited under Advanced. */
export type SimpleFieldKind = "value" | "saved" | "advanced";

export type SimpleFormRow = { field: FieldDef; node: ExprNode; kind: SimpleFieldKind; index: number };
export type SimpleFormModel = { tag: string; rows: SimpleFormRow[] };

export type SimpleFormFacts = {
  /** The declared fields of a constructor tag (undefined when unknown). */
  constructorFields: (tag: string) => readonly FieldDef[] | undefined;
  /** Whether the field's type has an inline input (inline-widgets.ts). */
  hasWidget: (type: FenelType) => boolean;
  /** Saved values, read for their root constructor only. */
  saved: () => readonly { id: string; expr: ExprNode }[];
};

type ConstructForm = { tag: string; fields: { name: string; value: ExprNode }[] };

export function constructForm(node: ExprNode): ConstructForm | undefined {
  if (node.kind !== "literal" || !node.value || typeof node.value !== "object") return undefined;
  const form = (node.value as { __construct?: unknown }).__construct as ConstructForm | undefined;
  return form && typeof form.tag === "string" && Array.isArray(form.fields) ? form : undefined;
}

function recordForm(node: ExprNode): { fields: { name: string; value: ExprNode }[] } | undefined {
  if (node.kind !== "literal" || !node.value || typeof node.value !== "object") return undefined;
  const form = (node.value as { __record?: unknown }).__record as { fields?: unknown } | undefined;
  return form && Array.isArray(form.fields) ? form as { fields: { name: string; value: ExprNode }[] } : undefined;
}

function isStructural(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).some((key) => key.startsWith("__"));
}

/** The root constructor tag a saved or draft expression builds, if any. */
export function rootConstructorTag(node: ExprNode): string | undefined {
  if (node.kind === "call" && node.args.length > 0) return node.fnId;
  return constructForm(node)?.tag;
}

/** The data a field row's input shows: a plain literal, or a record of plain
 * literals (`__record` / `__construct` children). `undefined` when the node is
 * empty; `NOT_DATA` when it is an expression the form does not author. */
export const NOT_DATA: unique symbol = Symbol("not data");
export function dataOfNode(node: ExprNode, depth = 0): unknown | typeof NOT_DATA {
  if (depth > 12) return NOT_DATA;
  if (node.kind !== "literal") return NOT_DATA;
  if (!isStructural(node.value)) return node.value;
  const form = recordForm(node) ?? constructForm(node);
  if (!form) return NOT_DATA;
  const out: Record<string, unknown> = {};
  for (const field of form.fields) {
    const data = dataOfNode(field.value, depth + 1);
    if (data === NOT_DATA) return NOT_DATA;
    if (data !== undefined) out[field.name] = data;
  }
  return out;
}

/** The simple form applies to a constructor draft whose fields are exactly the
 * tag's declared named fields (positional or partial drafts keep the full
 * editor). Each row is classified once per draft. */
export function simpleFormModel(node: ExprNode, facts: SimpleFormFacts): SimpleFormModel | undefined {
  const form = constructForm(node);
  if (!form) return undefined;
  const declared = facts.constructorFields(form.tag);
  if (!declared || declared.length === 0) return undefined;
  if (declared.every((field, index) => field.name === `_${index}`)) return undefined;
  if (form.fields.length !== declared.length) return undefined;
  const byName = new Map(form.fields.map((field) => [field.name, field.value] as const));
  if (byName.size !== declared.length || declared.some((field) => !byName.has(field.name))) return undefined;
  let savedTags: Set<string> | undefined;
  const savedTag = (tag: string) => (savedTags ??= new Set(facts.saved()
    .map((saved) => rootConstructorTag(saved.expr)).filter((t): t is string => t !== undefined))).has(tag);
  const rows = declared.map((field, index): SimpleFormRow => {
    const value = byName.get(field.name)!;
    return { field, node: value, index, kind: rowKind(field, value) };
  });
  return { tag: form.tag, rows };

  function rowKind(field: FieldDef, value: ExprNode): SimpleFieldKind {
    if (value.kind === "ref") return "saved";
    // A field whose type has saved records (their root builds the same
    // constructor as this field's seed) picks one of them.
    const tag = rootConstructorTag(value);
    if (tag !== undefined && savedTag(tag) && dataOfNode(value) !== NOT_DATA) return "saved";
    if (dataOfNode(value) !== NOT_DATA && facts.hasWidget(field.type)) return "value";
    return "advanced";
  }
}

/** A row's input wrote new data: its draft node. The caller supplies the
 * existing data projection (`expressionForLiteralValue`). */
export function replaceRow(model: SimpleFormModel, index: number, next: ExprNode): ExprNode {
  return { kind: "literal", value: { __construct: { tag: model.tag,
    fields: model.rows.map((row) => ({ name: row.field.name, value: row.index === index ? next : row.node })) } } };
}

function blank(data: unknown): boolean {
  if (data === undefined || data === null) return true;
  if (typeof data === "string") return data.trim().length === 0;
  if (typeof data === "number") return !Number.isFinite(data);
  return false;
}

function incomplete(data: unknown, field: FieldDef, recordFields?: (type: FenelType) => readonly FieldDef[] | undefined): boolean {
  if (blank(data)) return true;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const parts = recordFields?.(field.type);
  if (parts) return parts.some((part) => incomplete((data as Record<string, unknown>)[part.name], part, recordFields));
  return Object.values(data).some((value) => blank(value));
}

/** A row's plain-word issue, shown only after the row was left or a Create
 * was attempted (`shown`). Never an engine diagnostic. */
export function rowIssue(row: SimpleFormRow, label: string, typeLabel: string | undefined, shown: boolean,
  recordFields?: (type: FenelType) => readonly FieldDef[] | undefined): string | undefined {
  if (!shown) return undefined;
  if (row.kind === "saved") {
    return row.node.kind === "ref" ? undefined : `Choose ${typeLabel ? `a ${typeLabel}` : `the ${label}`}.`;
  }
  if (row.kind === "advanced") return undefined;
  const data = dataOfNode(row.node);
  if (data === NOT_DATA) return undefined;
  return incomplete(data, row.field, recordFields) ? `Enter the ${label}.` : undefined;
}
