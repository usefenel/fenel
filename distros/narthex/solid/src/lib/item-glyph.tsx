// An item's own glyph, wherever it is drawn outside a list circle: a tree
// node, a constructor inside a record row, a record card's portrait. It is the
// list circle's glyph (list-preview-glyph.ts, then DataThumbnail and its
// GlyphPictureImage): a bare constructor's Picturable or Emojiable, keyed by
// its tag. No picture mechanism or per-type fact lives here.
// Solid/browser renderer allowance — the same kind as the other card surfaces.

import { Show, createMemo } from "solid-js";
import { DataThumbnail } from "./data-transfer/DataPreview";
import { listPreviewGlyph } from "./list-preview-glyph";
import type { PreviewGlyph } from "./thumbnail-glyph";
import { useReaderRuntime } from "./reader-runtime";
import { useAuthoringSession } from "./expression-runner/authoring-session";
import { displayNameText } from "./display-name";
import { bareConstructorTag, ownGlyphMark } from "./constructor-presentation";
import { constructorLabel } from "./constructor-label";
import "./item-glyph.css";

export type ItemPresentation = { glyph: (value: unknown) => PreviewGlyph; name: (value: unknown) => string | undefined };

/** The reader's glyph and label of an item, as the recipe card reads its foods
 * (recipe-facts-view.tsx): a Local reader answers from its worker's thumbnail
 * packet (the page never dispatches for Local data), any other reader from its
 * own session's registry. */
export function useItemPresentation(): ItemPresentation {
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const packet = (value: unknown) => {
    if (reader?.kind !== "local" || !reader.valueState) return undefined;
    const read = reader.valueState(value, undefined, { thumbnail: true });
    return read.kind === "known" ? read.value.root : null;
  };
  const frame = () => { try { return (reader?.session() ?? authoring)?.evaluateContext; } catch { return undefined; } };
  return {
    glyph: (value) => {
      const local = packet(value);
      if (local !== undefined) return local?.glyph ?? {};
      const context = frame();
      try { return context ? listPreviewGlyph(context, value) : {}; } catch { return {}; }
    },
    name: (value) => {
      const local = packet(value);
      if (local !== undefined) return displayNameText(local?.caption);
      const tag = bareConstructorTag(value);
      return tag === undefined ? undefined : constructorLabel(frame(), tag);
    },
  };
}

/** The item's mark: the same thumbnail its list circle draws. A `held` mark
 * shows its icon or emoji and does not ask for its picture yet (pictures are
 * decoded one at a time; nested-sets-classification-near.ts releases it). */
export function ItemMark(props: { value: unknown; presentation?: ItemPresentation; held?: boolean }) {
  const fallback = useItemPresentation();
  const glyph = createMemo(() => (props.presentation ?? fallback).glyph(props.value));
  return <DataThumbnail value={props.value} picture={props.held ? undefined : glyph().picture} valueIcon={glyph().icon} emoji={glyph().emoji} />;
}

/** A bare constructor's own picture or emoji, small, before its name; nothing
 * when it has neither (a type's icon is not the item's own mark). */
export function ConstructorGlyph(props: { value: unknown; presentation?: ItemPresentation }) {
  const fallback = useItemPresentation();
  const glyph = createMemo(() => bareConstructorTag(props.value) === undefined ? {} : (props.presentation ?? fallback).glyph(props.value));
  return <Show when={ownGlyphMark(glyph())}>{(_mark) => <span class="item-glyph" aria-hidden="true">
    <DataThumbnail value={props.value} picture={glyph().picture} emoji={glyph().emoji} />
  </span>}</Show>;
}
