// ---------------------------------------------------------------------------
// locus-table-columns — the columns of the table view of `List a`.
//
// Rom, 2026-09-24: a table is the UX for a list of anything. When the element
// type is a record, the columns are its fields; otherwise there is one column,
// which shows each element through its own type's view.
//
// The fields are the element type's DECLARED fields, read with the same
// authoring peel `childValueType` uses for a card's child type (a record, or a
// type with one constructor, read off that constructor). Nothing here looks at
// the values: two lists of the same type get the same columns, and a list whose
// type is unknown gets the one-column view rather than columns guessed from
// its first element.
// ---------------------------------------------------------------------------

import type { FenelType, FieldDef } from "@fenel/engine/types";
import { peelToVariantType, recordFieldsForType, type AuthoringTypeResolver } from "@fenel/engine/authoring/expression";
import { Anything, Nothing, refHandle } from "@fenel/engine/type-foundation";

export type LocusTableColumn = {
  /** The field's wire name: the key of the cell's value in the element. */
  id: string;
  /** Stable presentation identity; the wire key remains `id`. */
  identity?: string;
  label: string;
  field: FieldDef;
};

export type LocusTableColumns =
  | { kind: "fields"; columns: LocusTableColumn[] }
  | { kind: "item" };

export function locusTableColumns(elementType: FenelType | undefined, context: {
  /** Named types, as the authoring environment resolves them. */
  resolver: AuthoringTypeResolver;
  /** The structural shape behind a named, refined or dependent type. */
  shape?: (type: FenelType) => FenelType;
  /** A field's label. Defaults to its name. */
  label?: (field: FieldDef) => string;
}): LocusTableColumns {
  const fields = elementFields(elementType, context);
  if (!fields || fields.length === 0) return { kind: "item" };
  const label = context.label ?? ((field: FieldDef) => field.name);
  return { kind: "fields", columns: fields.map((field) => ({ id: field.name, identity: field.key?.$tag === "NamedField" ? field.key.ref.$ref : field.name, label: label(field), field })) };
}

function elementFields(elementType: FenelType | undefined, context: {
  resolver: AuthoringTypeResolver;
  shape?: (type: FenelType) => FenelType;
}): FieldDef[] | undefined {
  if (!elementType) return undefined;
  const shape = concrete(context.shape ? context.shape(elementType) : elementType, context.resolver);
  // A primitive's values are its native representation, not the pure ADT
  // that defines it: a list of numbers is not a table of numerators.
  if (!shape || "$opaque" in shape) return undefined;
  const record = recordFieldsForType(shape, context.resolver);
  if (record) return record;
  // A type with one constructor (`Country = Country code: String …`) is a
  // record with a name. A sum of several has no single set of columns.
  const variant = peelToVariantType(shape, context.resolver);
  return variant?.cases.length === 1 ? variant.cases[0]!.fields : undefined;
}

/** The reader's additional field case. Existing record/opaque selection stays
 * with its caller; reuse the table's one-constructor rule only after that. */
export function singleConstructorFields(type: FenelType | undefined, resolver: AuthoringTypeResolver): FieldDef[] | undefined {
  const shape = type && concrete(type, resolver);
  if (!shape || "$opaque" in shape || recordFieldsForType(shape, resolver)) return undefined;
  return elementFields(shape, { resolver });
}

/** The authoring catalogue's resolver, then the reader's own declaration of a
 * name the catalogue has no row for. The catalogue's type rows are picker rows
 * deduplicated by display label: a declared type whose label another type also
 * carries has none (Nov 12: `EncyclopediaCountry`, "Country" like std
 * `Country`, lost its columns and its tiles' order). `declared` is the reader's
 * registry declaration (or a Local reader's worker answer), as the value
 * scope's own type resolution reads it. */
export function readerTypeResolver(resolver: AuthoringTypeResolver,
  declared: (name: string) => FenelType | undefined): AuthoringTypeResolver {
  const resolveNamedType = (name: string) => resolver.resolveNamedType?.(name) ?? declared(name);
  return {
    resolveNamedType,
    resolveTypeRef: (type) => {
      const resolved = resolver.resolveTypeRef?.(type);
      if (resolved) return resolved;
      const handle = refHandle(type);
      return handle === undefined ? undefined : resolveNamedType(handle);
    },
    ...(resolver.hasFunctionRefLiteral ? { hasFunctionRefLiteral: resolver.hasFunctionRefLiteral } : {}),
  };
}

/** A list's declared field order: its Table's columns' wire names. Served
 * records can arrive with sorted keys; a tile reads its type's first fields. */
export function declaredFieldOrder(elementType: FenelType | undefined, resolver: AuthoringTypeResolver,
  declared: (name: string) => FenelType | undefined): readonly string[] | undefined {
  const columns = locusTableColumns(elementType, { resolver: readerTypeResolver(resolver, declared) });
  return columns.kind === "fields" ? columns.columns.map(column => column.id) : undefined;
}

/** Follow names and refinements to the type they stand for. */
function concrete(type: FenelType, resolver: AuthoringTypeResolver): FenelType | undefined {
  let current = type;
  for (let depth = 0; depth < 32; depth++) {
    if ("$refined" in current) { current = current.$refined.base; continue; }
    const handle = refHandle(current);
    if (handle === undefined) return current;
    const next = resolver.resolveTypeRef?.(current) ?? resolver.resolveNamedType?.(handle);
    if (!next || next === current) return current;
    current = next;
  }
  return undefined;
}

/** A grouping (an `OrdinaryMap`'s entries) shown as a table has two columns,
 * the key and its value (polish lane 2, Nov 9: "Count per person" as one
 * "Data" column of key/value pairs). The key is each row's own heading (its
 * caption, which reads the key by its type: a Person by name), so the cells
 * are the entry's `value` alone, typed by the entry's declared value field
 * when known. */
export function groupingTableColumns(entry: LocusTableColumns, label = "Value"): LocusTableColumns {
  const declared = entry.kind === "fields" ? entry.columns.find((column) => column.id === "value")?.field : undefined;
  const field: FieldDef = declared ?? { name: "value", type: Anything, label: Nothing, meta: {}, ui: Nothing } as FieldDef;
  return { kind: "fields", columns: [{ id: "value", label, field }] };
}

/** A grouping table row's entry key, when the row's value is the entry record
 * ({ key, value }); undefined while it is computed or for any other value. */
export function groupingEntryKey(value: unknown): { key: unknown } | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "key")
    ? { key: (value as { key: unknown }).key } : undefined;
}

/** A grouping table's two headings: the key column and the value column named
 * by their declared types as captions read them (`label`: the reader's type
 * caption, e.g. "Person", "List of transactions"), else "Key" and "Value". An
 * undecided type ("Anything" or no caption) says nothing more than the default
 * (groupedtable, Nov 13: the opened Group by person read "Key | Value"). */
export function groupingTableHeadings(entry: LocusTableColumns, label: (type: FenelType) => string): { key: string; value: string } {
  const named = (id: string, fallback: string) => {
    const type = entry.kind === "fields" ? entry.columns.find((column) => column.id === id)?.field.type : undefined;
    let text = "";
    try { text = type ? label(type).trim() : ""; } catch { text = ""; }
    return text && text !== "Anything" ? text : fallback;
  };
  return { key: named("key", "Key"), value: named("value", "Value") };
}

/** Bind the Fenel projection to the exact original columns; stale IDs do not
 * become positional selections or change a column's wire key. */
export function projectedTableColumns(layout: LocusTableColumns, identities: readonly string[]): LocusTableColumns {
  if (layout.kind !== "fields") return layout;
  const byIdentity = new Map(layout.columns.map(column => [column.identity ?? column.id, column]));
  return { kind: "fields", columns: identities.flatMap(identity => {
    const column = byIdentity.get(identity);
    return column ? [column] : [];
  }) };
}
