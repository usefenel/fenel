// ---------------------------------------------------------------------------
// type-picker-rows — which rows the TypePicker lists, and in what order.
//
// With `allowAuto` the picker offers an "auto" row (infer the type from the
// expression) above the catalog types. That row is not a match for anything
// the user types, so it is listed only while the filter is empty: were it
// kept on top during a search, Enter (which takes the first row while nothing
// is highlighted) would pick "auto" instead of the type the user searched for.
// The same list drives both the markup and the keyboard, so what is shown and
// what the arrows and Enter reach never disagree.
// ---------------------------------------------------------------------------

/** The rows in display order: the optional lead ("auto") row first while the
 *  query is blank, then the filtered types. */
export function typePickerRows<T>(lead: T | undefined, types: readonly T[], query: string): readonly T[] {
  return lead !== undefined && !query.trim() ? [lead, ...types] : types;
}

// ---------------------------------------------------------------------------
// Preferred types — the types this list already uses lead the picker.
//
// When you shape Transaction.person right after creating Person beside your
// transactions, Person should not be row 140 of the catalogue (beyond the
// 100-row cut, so not shown at all until searched). The surface that opens
// the picker names the types in scope through `TypePickerPreferredContext`;
// the picker lists the matching catalogue rows first, in that order, then the
// rest in catalogue order. A presentation order only: what a row resolves to
// on pick is unchanged (resolveTypePickerSelection).
// ---------------------------------------------------------------------------

type CatalogRow = { readonly id: string; readonly name: string; readonly entityId?: string | undefined };

/** Split the catalogue into the preferred rows (in `preferred` order) and the
 *  rest (in catalogue order). A preferred identity matches a row's entity id
 *  or catalogue id; a bare name matches only when one row carries it. */
export function splitPreferredTypes<T extends CatalogRow>(all: readonly T[], preferred: readonly string[]): { lead: T[]; rest: T[] } {
  if (preferred.length === 0) return { lead: [], rest: [...all] };
  const taken = new Set<T>();
  const lead: T[] = [];
  for (const identity of preferred) {
    let row = all.find((entry) => entry.entityId === identity || entry.id === identity || entry.id === `entity:${identity}`);
    if (!row) {
      const named = all.filter((entry) => entry.name === identity);
      if (named.length === 1) row = named[0];
    }
    if (row && !taken.has(row)) { taken.add(row); lead.push(row); }
  }
  return { lead, rest: all.filter((entry) => !taken.has(entry)) };
}

/** Rank and cut like the picker's search, with the preferred rows first. While
 *  the query is blank the `common` names (the New menu's quick types, in its
 *  order) come next: a name (shown name or entity id) takes its first
 *  catalogue row that `everyday` accepts (the picker: one the small data form
 *  can fill), so an unfillable row never leads. A search ranks the rest by
 *  match alone. `groupStarts` are the indexes where a later group begins. */
export function preferredTypePickerEntries<T extends CatalogRow>(all: readonly T[], preferred: readonly string[], query: string,
  limit: number, filter: (entries: readonly T[], query: string, limit: number) => T[], common: readonly string[] = [],
  everyday: (row: T, name: string) => boolean = () => true): { rows: T[]; leadCount: number; groupStarts: number[] } {
  const { lead, rest } = splitPreferredTypes(all, preferred);
  const quick: T[] = [];
  if (!query.trim()) for (const name of common) {
    const row = rest.find((entry) => !quick.includes(entry) && (entry.name === name || entry.entityId === name) && everyday(entry, name));
    if (row) quick.push(row);
  }
  const groups = [lead, quick, rest.filter((entry) => !quick.includes(entry))];
  const rows: T[] = [];
  const groupStarts: number[] = [];
  let leadCount = 0;
  for (const [index, group] of groups.entries()) {
    const picked = group.length ? filter(group, query, Math.max(0, limit - rows.length)) : [];
    if (picked.length && rows.length) groupStarts.push(rows.length);
    rows.push(...picked);
    if (index === 0) leadCount = rows.length;
  }
  return { rows, leadCount, groupStarts };
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** The type references (`$ref` handles) a list's items carry: a type placed in
 *  the list (a type reference whose value type is Type) and the named types
 *  inside each item's value type (a Transaction's `person: Person`). */
export function listedTypeIdentities(items: readonly { readonly source?: unknown; readonly expr?: unknown; readonly valueType?: unknown }[]): string[] {
  const out: string[] = [];
  const add = (identity: unknown) => { if (typeof identity === "string" && identity && !out.includes(identity)) out.push(identity); };
  const walk = (type: unknown, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(type)) { for (const part of type) walk(part, depth + 1); return; }
    if (!record(type)) return;
    for (const [key, value] of Object.entries(type)) {
      if (key === "$ref") add(value);
      else walk(value, depth + 1);
    }
  };
  for (const item of items) {
    const source = record(item.source) && item.source.kind === "expr" ? item.source.expr : item.expr;
    const isType = record(item.valueType) && item.valueType.$type === true;
    if (isType && record(source) && source.kind === "literal" && record(source.value)) add(source.value.$ref);
    else walk(item.valueType, 0);
  }
  return out;
}
