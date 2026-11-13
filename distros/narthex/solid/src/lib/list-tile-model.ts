// A focused list draws each item as a key-like tile: the item's thumbnail mark,
// enlarged, with its next piece of identity in the corner. What represents an
// item is the existing thumbnail rule (DataPreview.tsx `DataThumbnail`, with
// `thumbnail-text.ts`); this module only decides whether that mark is compact
// enough to be a tile's face, how large it is drawn, and the corner text.

import { fileData, isImageLike, record } from "./data-transfer/data-preview-shape";
import { declaredFieldKeys, fieldPicture, firstFieldText, ownNumberText } from "./data-transfer/thumbnail-text";
import { isInlineImageValue } from "./expression-runner/image-canvas-data";
import { bareConstructorTag, ownGlyphMark } from "./constructor-presentation";

export type TileMarkScale = "large" | "medium" | "small" | "tiny";

/** Longer text is a sentence or a name, not a key's mark: its list keeps cards. */
const TILE_MARK_MAX_CHARACTERS = 12;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;

/** Characters as read: a flag emoji or an accented letter counts once. */
function characterCount(text: string): number {
  if (!segmenter) return Array.from(text).length;
  let count = 0;
  for (const _segment of segmenter.segment(text)) count++;
  return count;
}

/** The value is its own picture, or a record holds one, as the thumbnail draws it. */
function tilePicture(value: unknown, order?: readonly string[]): boolean {
  if (fieldPicture(value, order)) return true;
  const file = fileData(value);
  if (file) return file.mimeType.startsWith("image/") && file.size > 0 && !/;base64,$/i.test(file.url);
  if (isImageLike(value)) return true;
  return isInlineImageValue(value) && value.width > 0 && value.height > 0;
}

/** The text the thumbnail shows for this value when it is not a picture.
 * `order` is the list's declared field order (the Table's columns). */
function tileMarkText(value: unknown, order?: readonly string[]): string | undefined {
  return ownNumberText(value) ?? firstFieldText(value, order);
}

/** The glyph the reader already selected for one item (its value packet's
 * `glyph`: Picturable, Iconable, Emojiable keyed by the item's identity). */
export type TileGlyph = { picture?: unknown; icon?: string; emoji?: string } | undefined;

/** A bare constructor (a tree's leaf, a food) whose own registered picture or
 * emoji the reader selected: that mark is its face. A type's icon is not. */
function constructorGlyph(value: unknown, glyph: TileGlyph): boolean {
  return bareConstructorTag(value) !== undefined && ownGlyphMark(glyph) !== undefined;
}

export function hasTileMark(value: unknown, order?: readonly string[], glyph?: TileGlyph): boolean {
  if (constructorGlyph(value, glyph) || tilePicture(value, order)) return true;
  // An empty picture or file is media without content, not its width as text.
  if (fileData(value) || isInlineImageValue(value)) return false;
  const text = tileMarkText(value, order);
  return text !== undefined && characterCount(text) <= TILE_MARK_MAX_CHARACTERS;
}

/** Every item needs a compact mark: one card among tiles reads as a defect. */
export function listShowsTiles(values: readonly unknown[], order?: readonly string[], glyphAt?: (index: number) => TileGlyph): boolean {
  return values.length > 0 && values.every((value, index) => hasTileMark(value, order, glyphAt?.(index)));
}

export function tileMarkScale(value: unknown, order?: readonly string[]): TileMarkScale {
  const text = tilePicture(value, order) ? undefined : tileMarkText(value, order);
  if (text === undefined) return "large";
  const count = characterCount(text);
  // Ten to twelve characters ("TypeScript") fit one line only at the smallest size.
  return count <= 2 ? "large" : count <= 4 ? "medium" : count <= 9 ? "small" : "tiny";
}

function shortText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

/** A record's second declared field when it is short plain data, else the
 * item's own caption. Nothing when neither exists or it repeats the mark. A
 * record whose picture is the mark keeps its first field (a person's name). */
export function tileCornerLabel(value: unknown, caption?: string, order?: readonly string[]): string | undefined {
  if (fieldPicture(value, order)) return firstFieldText(value, order) ?? shortText(caption);
  const mark = tilePicture(value) ? undefined : tileMarkText(value, order);
  const fields = record(value);
  const keys = fields ? declaredFieldKeys(fields, order) : [];
  const second = fields && keys.length > 1 ? shortText(Object.getOwnPropertyDescriptor(fields, keys[1]!)?.value) : undefined;
  const label = second ?? shortText(caption);
  return label !== undefined && label !== mark ? label : undefined;
}
