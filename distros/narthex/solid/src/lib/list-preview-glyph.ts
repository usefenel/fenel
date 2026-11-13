import { resolveEffect } from "@fenel/engine";
import { typeConstructorOf } from "../../../../../implementations/typescript/engine/src/effect-dispatch";
import { LUCIDE_BY_NAME } from "./icons";
import { previewGlyphKeys, type GlyphMethods, type GlyphClass, type PreviewGlyph } from "./thumbnail-glyph";
import { dispatchEngineBody, type ReaderGlyphPicture } from "@fenel/engine/engine-bodies-dispatch";
import { Just, Nothing, peelMaybeValue, type Maybe } from "@fenel/engine/type-foundation";

/** A2/B3 adapter over already-selected facts. Fenel owns picture/icon/emoji
 * precedence. Keep the evaluator out of the early thumbnail-mark module. */
export function previewGlyph(keys: readonly unknown[], resolve: (className: GlyphClass, key: unknown) => GlyphMethods | undefined,
  knownIcons: Readonly<Record<string, unknown>>): PreviewGlyph {
  const maybe = (value: unknown) => value === undefined ? Nothing : Just(value);
  const selected = dispatchEngineBody("engine:surfaceReaderGlyphPlan", [keys.map(key => ({
    picture: maybe(resolve("Picturable", key)?.picture),
    icon: maybe(resolve("Iconable", key)?.icon), emoji: maybe(resolve("Emojiable", key)?.emoji),
  })), Object.keys(knownIcons)]) as { picture: Maybe<ReaderGlyphPicture>; icon: Maybe<string>; emoji: Maybe<string> };
  const picture = peelMaybeValue(selected.picture) ?? undefined, icon = peelMaybeValue(selected.icon) ?? undefined, emoji = peelMaybeValue(selected.emoji) ?? undefined;
  return { ...(picture === undefined ? {} : { picture }), ...(icon === undefined ? {} : { icon }), ...(emoji === undefined ? {} : { emoji }) };
}

/** List-circle glyph for one value. A caller that already has the reader's
 * captured representations passes `methodsFor`; a miss there stays a miss. */
export function listPreviewGlyph(
  frame: Parameters<typeof typeConstructorOf>[1],
  value: unknown,
  extra: readonly unknown[] = [],
  methodsFor?: (className: GlyphClass, key: unknown) => GlyphMethods | undefined,
): PreviewGlyph {
  const keys = previewGlyphKeys(value, typeConstructorOf(value, frame), extra);
  const resolve = methodsFor ?? ((className: GlyphClass, key: unknown) => {
    if (!frame || typeof key !== "string") return undefined;
    const registry = frame._specRegistry;
    if (!registry) return undefined;
    return resolveEffect(frame, registry, className, key)?.methods;
  });
  return previewGlyph(keys, resolve, LUCIDE_BY_NAME);
}
