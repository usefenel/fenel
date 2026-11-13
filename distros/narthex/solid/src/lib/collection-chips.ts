// What a list inside a record field shows for each of its items: its mark and
// its short name, as small wrapping chips (value-card.tsx CollectionChips),
// instead of identical circles and "4 items" (Nov 12: Fenel's Social Links,
// Inspired By Languages). Reads only what the item already says about itself:
// its reader caption, its first declared field, a constructor's own label.
// Solid/browser renderer allowance — presentation adapter, same kind as thumbnail-text.ts.

import { declaredFieldKeys, firstFieldText } from "./data-transfer/thumbnail-text";
import { bareConstructorTag } from "./constructor-presentation";
import { recordHeadingField } from "./layout-renderer/record-card-plan";

/** More items than this wait behind "+N", which enters the list. */
export const COLLECTION_CHIP_LIMIT = 12;

export function chipSlice(count: number, limit = COLLECTION_CHIP_LIMIT): { shown: number; more: number } {
  const shown = Math.max(0, Math.min(count, limit));
  return { shown, more: Math.max(0, count - shown) };
}

/** An http(s) address a reader may open: the value itself, or a record's first such field. */
export function chipHref(value: unknown, order?: readonly string[]): string | undefined {
  const web = (text: unknown) => typeof text === "string" && /^https?:\/\/\S+$/i.test(text.trim()) ? text.trim() : undefined;
  if (typeof value === "string") return web(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const key of declaredFieldKeys(value, order)) {
    const href = web(Object.getOwnPropertyDescriptor(value, key)?.value);
    if (href) return href;
  }
  return undefined;
}

/** A chip's name is a name, never a sentence: longer text is not used. */
export const CHIP_NAME_MAX_CHARACTERS = 40;

function shortName(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed && trimmed.length <= CHIP_NAME_MAX_CHARACTERS && !/\n/.test(trimmed) && !chipHref(trimmed) ? trimmed : undefined;
}

/** The item's short name: its reader caption (a catalogue reference: "Haskell"),
 * else, for a record, the field a focused record's heading reads (record-card-plan.ts
 * recordHeadingField: a first field named like a name or title), else its first
 * declared field when that is short text or a number, else that field's
 * constructor label ("X" for `SocialLink { platform = X, … }`), else the label
 * of the record's own constructor ("Emblem"). Text over about forty characters
 * is never a name. An item that says nothing short has none: its chip is its mark. */
export function chipName(value: unknown, read: {
  caption: (value: unknown) => string | undefined;
  constructorName: (tag: string) => string | undefined;
  order?: readonly string[];
}): string | undefined {
  const caption = shortName(read.caption(value));
  if (caption) return caption;
  const own = bareConstructorTag(value);
  if (own !== undefined) return shortName(read.constructorName(own));
  if (typeof value === "string") return shortName(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const keys = declaredFieldKeys(value, read.order);
  const fields = keys.map(name => ({ name, value: Object.getOwnPropertyDescriptor(value, name)?.value as unknown }));
  const heading = recordHeadingField(fields);
  const named = heading === undefined ? undefined : shortName(String(fields[heading]!.value));
  if (named) return named;
  const text = shortName(firstFieldText(value, read.order));
  if (text) return text;
  const tag = keys.length === 0 ? undefined : bareConstructorTag(fields[0]!.value);
  const fieldName = tag === undefined ? undefined : shortName(read.constructorName(tag));
  if (fieldName) return fieldName;
  const recordTag = Object.getOwnPropertyDescriptor(value, "$tag")?.value;
  return typeof recordTag === "string" && recordTag !== "" ? shortName(read.constructorName(recordTag)) : undefined;
}
