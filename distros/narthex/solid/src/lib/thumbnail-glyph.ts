import { readLocusCatalogReference } from "./locus-catalog-reference";
import type { ReaderGlyphPicture } from "@fenel/engine/engine-bodies-dispatch";

/** Methods already selected for one identity. The caller owns dispatch. */
export type GlyphMethods = { picture?: unknown; icon?: unknown; emoji?: unknown };
export type GlyphClass = "Picturable" | "Iconable" | "Emojiable";
export type PreviewGlyph = { picture?: ReaderGlyphPicture; icon?: string; emoji?: string };

function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function pushKey(keys: string[], key: unknown): void {
  if (typeof key === "string" && key.length > 0 && !keys.includes(key)) keys.push(key);
}

/** Most specific identity first: the constructor tag, then a catalog reference,
 * then the owning type and any declared identity the caller already resolved. */
export function previewGlyphKeys(value: unknown, owner: string | undefined, extra: readonly unknown[] = []): string[] {
  const keys: string[] = [];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const tag = ownData(value, "$tag");
    if (typeof tag === "string") pushKey(keys, tag);
    pushKey(keys, readLocusCatalogReference(value)?.id);
  }
  pushKey(keys, owner);
  for (const key of extra) pushKey(keys, key);
  return keys;
}

/** The circle draws a registered Iconable icon, otherwise an Emojiable glyph,
 * otherwise the existing type-icon fallback. */
export function thumbnailMark(
  valueIcon: string | undefined,
  emoji: string | undefined,
  typeIcon: string | undefined,
  knownIcons: Readonly<Record<string, unknown>>,
  generic: string,
): { kind: "icon"; name: string } | { kind: "emoji"; text: string } {
  if (valueIcon && knownIcons[valueIcon]) return { kind: "icon", name: valueIcon };
  const glyph = emoji?.trim();
  if (glyph) return { kind: "emoji", text: glyph };
  if (typeIcon && knownIcons[typeIcon]) return { kind: "icon", name: typeIcon };
  return { kind: "icon", name: generic };
}
