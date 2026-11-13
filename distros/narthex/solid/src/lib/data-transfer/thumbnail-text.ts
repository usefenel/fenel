import { isInlineImageValue, type InlineImageValue } from "../expression-runner/image-canvas-data";

/** A record's field keys in declared order: the type's `order` (keys it names
 * that the value holds) when given, else the value's own key order. Served
 * data can arrive with its keys sorted, so a known type order wins. */
export function declaredFieldKeys(value: object, order?: readonly string[]): string[] {
  const own = Object.keys(value).filter(key => !key.startsWith("$"));
  const declared = order?.filter(key => !key.startsWith("$") && Object.hasOwn(value, key)) ?? [];
  return declared.length > 0 ? declared : own;
}

/** The first declared field of a record when it is short plain data (text or
 * a number); nothing for any other shape. Only the first field is read. */
export function firstFieldText(value: unknown, order?: readonly string[]): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const key of declaredFieldKeys(value, order)) {
    const field = Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
    if (typeof field === "string") { const text = field.trim(); return text.length > 0 ? text : undefined; }
    if (typeof field === "number" && Number.isFinite(field)) return String(field);
    return undefined;
  }
  return undefined;
}

/** The first declared field of a record that holds a drawable Image, directly
 * or as `Just image` (an optional picture): a person with a photo shows it as
 * its mark. A field without a value, or an empty image, is no picture. */
export function fieldPicture(value: unknown, order?: readonly string[]): InlineImageValue | undefined {
  return fieldPictureEntry(value, order)?.picture;
}

/** One field's drawable picture: an Image with pixels, directly or as `Just`. */
export function pictureOf(field: unknown): InlineImageValue | undefined {
  if (field && typeof field === "object" && Object.getOwnPropertyDescriptor(field, "$tag")?.value === "Just") field = Object.getOwnPropertyDescriptor(field, "_0")?.value;
  return isInlineImageValue(field) && field.width > 0 && field.height > 0 ? field : undefined;
}

/** `fieldPicture` with the key of the field that holds it (a focused record's portrait). */
export function fieldPictureEntry(value: unknown, order?: readonly string[]): { key: string; picture: InlineImageValue } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const key of declaredFieldKeys(value, order)) {
    const picture = pictureOf(Object.getOwnPropertyDescriptor(value, key)?.value);
    if (picture) return { key, picture };
  }
  return undefined;
}

/** The picture a thumbnail draws for a record that holds one (a person's
 * photo), wherever its mark is drawn: a list circle or a tile face. Only a
 * source-selected picture (Picturable) comes first: an icon or an emoji, the
 * type's or the value's, says less about this record than its own picture. */
export function ownPictureMark(value: unknown, sourcePicture: boolean, order?: readonly string[]): InlineImageValue | undefined {
  return sourcePicture ? undefined : fieldPicture(value, order);
}

/** The text that replaces an icon mark, or nothing when the icon stays.
 * A bare number always reads as itself. A record left with a generic mark reads
 * as its first field, unless the caller named an icon for the value. On a tile
 * face the first field also wins over an icon the whole type shares: a grid of
 * one repeated icon tells its items apart by nothing (every programming
 * language showed the same code mark, and no name). */
export function iconMarkText(value: unknown, mark: { generic: boolean; valueIcon: boolean; tileFace: boolean }, order?: readonly string[]): string | undefined {
  const own = ownNumberText(value);
  if (own !== undefined) return own;
  if (mark.tileFace) return firstFieldText(value, order);
  if (mark.valueIcon) return undefined;
  return mark.generic ? firstFieldText(value, order) : undefined;
}

/** A bare finite number reads as itself in a thumbnail circle: three "#"
 * marks told 3, 1 and 2 apart by nothing. No other value has text here. */
export function ownNumberText(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}
