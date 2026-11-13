// Two small readers that let a bare constructor value (`{ $tag: "SolanumLycopersicum" }`)
// be named by its own registered instances, the way its glyph already is
// (`_ : Picturable "SolanumLycopersicum"`, `_ : Emojiable "Mammalia"` are keyed
// by the bare tag). No per-type fact lives here: the label is the registry's.
// Solid/browser renderer allowance — reader adapter, same kind as list-preview-glyph.ts.

/** The tag of a bare (nullary) constructor value: an object whose only own key
 * is a string `$tag`. Anything else (a record, a payload, a reference) is not one. */
export function bareConstructorTag(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== "$tag") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, "$tag");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" && descriptor.value !== "" ? descriptor.value : undefined;
}

/** Which of an item's own marks a glyph holds: its picture first, else a
 * non-blank emoji. An icon is its type's, not the item's own mark. */
export function ownGlyphMark(glyph: { picture?: unknown; icon?: string; emoji?: string } | undefined): "picture" | "emoji" | undefined {
  if (!glyph) return undefined;
  if (glyph.picture !== undefined) return "picture";
  return glyph.emoji?.trim() ? "emoji" : undefined;
}

type SelectedRow = {
  methods: Record<string, unknown>;
  source: { kind: "instance"; instance: { label?: unknown } } | { kind: "block"; frame?: unknown };
};

/** A selected representation's methods. The Fenel loader lifts an authored
 * `label` out of an instance's methods onto the row itself (`fenel-module.ts`,
 * buildSpecInstance: `_ = Labelable { label = "Solanum lycopersicum" }` loads as
 * methods `{}` and `label` on the row); a Labelable selection reads it back
 * from there, so the label is the instance's own. Other classes are unchanged. */
export function selectedRepresentationMethods(typeName: string, selected: SelectedRow | undefined): Record<string, unknown> | undefined {
  if (!selected) return undefined;
  if (typeName !== "Labelable" || selected.methods.label !== undefined || selected.source.kind !== "instance") return selected.methods;
  const lifted = selected.source.instance.label;
  return lifted === undefined ? selected.methods : { ...selected.methods, label: lifted };
}
