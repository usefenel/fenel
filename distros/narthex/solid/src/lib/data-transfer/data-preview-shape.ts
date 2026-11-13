// ---------------------------------------------------------------------------
// data-preview-shape — "does this value carry its OWN presentation?"
//
// Extracted out of `DataPreview.tsx`, which is a component file: these four are
// pure predicates over a value's shape, they render nothing, and a second
// caller now needs them. The locus scope stack asks the same question for a
// different reason — a value that presents itself is a LEAF, because its fields
// are its carrier rather than its contents, and offering to go inside one would
// promise a room that is not there.
//
// This is a MOVE, not a rewrite. `DataPreview.tsx` re-exports `hasDataPreview`
// so its existing importers are unchanged.
// ---------------------------------------------------------------------------

import { isInlineImageValue } from "../expression-runner/image-canvas-data";
import type { ImportedMarkup } from "./markup";

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Shared with the storybook: image URL values retain their media preview. */
export function isImageLike(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.startsWith("data:image/") || /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(value);
}

export function fileData(value: unknown) {
  const data = record(value);
  return data && typeof data.url === "string" && /^(?:https?:\/\/|data:[^;,]+;base64,)/i.test(data.url)
    && typeof data.name === "string" && typeof data.mimeType === "string" && typeof data.size === "number"
    ? data as { url: string; name: string; mimeType: string; size: number } : undefined;
}

export function isMarkup(value: unknown, depth = 0, budget = { remaining: 300 }): value is ImportedMarkup {
  if (--budget.remaining < 0) return true;
  const node = record(value);
  if (!node || depth > 64) return false;
  switch (node.$tag) {
    case "Text": return typeof node.content === "string";
    case "Image": return typeof node.src === "string" && typeof node.alt === "string";
    case "Bold": case "Italic": case "Heading": case "Link": return isMarkup(node.child, depth + 1, budget);
    case "Paragraph": case "Fragment": return Array.isArray(node.children) && node.children.slice(0, 100).every(child => isMarkup(child, depth + 1, budget));
    case "List": return Array.isArray(node.items) && node.items.slice(0, 100).every(child => isMarkup(child, depth + 1, budget));
    default: return false;
  }
}

export function hasDataPreview(value: unknown): boolean {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value) || !!fileData(value)
    || isImageLike(value)
    || isInlineImageValue(value)
    || isMarkup(value);
}
