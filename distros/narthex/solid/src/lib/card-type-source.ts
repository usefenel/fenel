// What a data card's type line is read from (display glue, no type rule):
// its checked declared type, or, when the checker left the expression
// undecided, what is known of its value once read.
import type { FenelType } from "@fenel/engine/types";

/** A card's value as its reader read it, and that value's own type
 * constructor (`linkedKind`, the linked-data graph's card kind) when the
 * reader names one. */
export type CardRead = { readonly value: unknown; readonly kind?: string };

export type CardTypeSource =
  | { readonly use: "declared"; readonly type: FenelType }
  | { readonly use: "kind"; readonly kind: string }
  | { readonly use: "value"; readonly value: unknown };

/** `Any` is the public root's mark for an expression the checker left
 * undecided (public-locus-data.ts `demoRecordType`). */
export function isUndecidedCardType(type: FenelType | undefined): boolean {
  return !!type && "$ref" in type && type.$ref === "Any";
}

/** A checked declared type always answers. An undecided one answers only
 * until the value is known: the snapshot's value at once, or the live read,
 * which arrives after the caption mounted and must still reach it (B24: the
 * two pictures kept "Anything" because the caption read only the snapshot).
 * The read value's own type constructor comes first, then its shape. */
export function cardTypeSource(declared: FenelType | undefined, snapshot: unknown, read: CardRead | undefined): CardTypeSource {
  const undecided = isUndecidedCardType(declared);
  if (declared && !undecided) return { use: "declared", type: declared };
  if (undecided && snapshot === undefined && read?.kind) return { use: "kind", kind: read.kind };
  const value = snapshot !== undefined ? snapshot : read?.value;
  if (declared && value === undefined) return { use: "declared", type: declared };
  return { use: "value", value };
}
