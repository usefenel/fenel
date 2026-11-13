// ---------------------------------------------------------------------------
// type-draft-fields — what Create does with a field nobody named.
//
// The small type card shows a new field's name box empty (its minted code
// name is not a name anyone typed). At Create, a field the card added that
// still has no name is left out while its type is the default one; once a
// type was chosen for it, Create refuses and points at its name box. No
// field is ever saved under its minted name.
// ---------------------------------------------------------------------------

import type { FenelType, FieldDef } from "@fenel/engine/types";

/** A new field's type before anyone chose one (RecordBody's default). */
const DEFAULT_FIELD_TYPE = JSON.stringify({ $ref: "String" });

const fieldIdOf = (field: FieldDef) => field.key?.$tag === "NamedField" ? field.key.ref.$ref : undefined;

/** `minted`: the fields this card added, by id, with the code name they were
 *  minted with. `labelOf`: the name typed for a field (its label), if any. */
export function typeCardSubmission(shape: FenelType, minted: ReadonlyMap<string, string>,
  labelOf: (fieldId: string) => string | undefined): { shape: FenelType; unnamed: string[] } {
  if (!shape || typeof shape !== "object" || !("$record" in shape)) return { shape, unnamed: [] };
  const fields = shape.$record.fields ?? [];
  const unnamed: string[] = [];
  const kept = fields.filter((field) => {
    const id = fieldIdOf(field);
    if (!id || minted.get(id) !== field.name || labelOf(id)?.trim()) return true;
    if (JSON.stringify(field.type) === DEFAULT_FIELD_TYPE) return false;
    unnamed.push(id);
    return true;
  });
  return { shape: kept.length === fields.length ? shape : { $record: { ...shape.$record, fields: kept } }, unnamed };
}
