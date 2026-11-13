// Which rows a record reads as, and what a focused record's card lifts into its
// head. Pure decisions over the record's fields; RecordValueRows draws them.
// Every record, not one type: the rules read field values and names only.

import { pictureOf } from "../data-transfer/thumbnail-text";
import { bareConstructorTag } from "../constructor-presentation";

export type RecordCardField = { name: string; value: unknown };

/** A field with nothing to read: absent, `Nothing`, an empty list or blank
 * text. Its row would only say "Not set" (or nothing at all), so the default
 * view leaves it to "Show N more fields". The value itself is untouched. */
export function fieldHoldsNothing(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return keys.length === 1 && keys[0] === "$tag" && Object.getOwnPropertyDescriptor(value, "$tag")?.value === "Nothing";
  }
  return false;
}

/** The bare constructor a field holds, directly or as `Just` (a project's
 * logo, `Just PrimalDiet`); undefined for `Nothing` and any other value. */
export function fieldConstructor(value: unknown): unknown {
  let inner = value;
  if (inner && typeof inner === "object" && Object.getOwnPropertyDescriptor(inner, "$tag")?.value === "Just"
    && Object.keys(inner).length === 2) inner = Object.getOwnPropertyDescriptor(inner, "_0")?.value;
  // `Nothing` is an absent value (fieldHoldsNothing), never a constructor to picture.
  const tag = bareConstructorTag(inner);
  return tag === undefined || tag === "Nothing" ? undefined : inner;
}

/** The field shown as a focused record's portrait: the first that holds a
 * drawable picture (the same rule as the record's thumbnail mark); else the
 * first that holds a constructor with its own registered picture, as the
 * reader answers `hasPicture` (a project's logo). */
export function recordPortraitField(fields: readonly RecordCardField[], hasPicture?: (constructor: unknown) => boolean): number | undefined {
  const image = fields.findIndex(field => pictureOf(field.value) !== undefined);
  if (image >= 0) return image;
  if (!hasPicture) return undefined;
  const index = fields.findIndex(field => { const constructor = fieldConstructor(field.value); return constructor !== undefined && hasPicture(constructor); });
  return index < 0 ? undefined : index;
}

const NAME_LIKE = /(name|title)$|^label$/i;
const HEADING_MAX_CHARACTERS = 80;

/** The field read as a focused record's heading: its FIRST field, when that
 * field is named like a name or title and holds one short line of text. */
export function recordHeadingField(fields: readonly RecordCardField[]): number | undefined {
  const first = fields[0];
  if (!first || !NAME_LIKE.test(first.name.replace(/[\s_-]+/g, ""))) return undefined;
  const text = typeof first.value === "string" ? first.value.trim() : "";
  return text.length > 0 && text.length <= HEADING_MAX_CHARACTERS && !/\n/.test(text) ? 0 : undefined;
}

/** The rows of a record read as rows. `lifted` fields are drawn by the card
 * head (portrait, heading) and never as rows. Collapsed, the default view is
 * the first `limit` fields that hold something; every other field waits
 * behind "Show N more fields". Expanded, every row in declared order. */
export function recordRowPlan(input: { holdsNothing: readonly boolean[]; lifted?: readonly number[]; limit: number;
  expanded: boolean }): { shown: number[]; hidden: number } {
  const lifted = new Set(input.lifted ?? []);
  const rows = input.holdsNothing.map((_, index) => index).filter(index => !lifted.has(index));
  if (input.expanded) return { shown: rows, hidden: 0 };
  const shown = rows.filter(index => !input.holdsNothing[index]).slice(0, input.limit);
  return { shown, hidden: rows.length - shown.length };
}
