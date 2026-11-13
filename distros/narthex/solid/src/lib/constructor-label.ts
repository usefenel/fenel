// The display name of a bare constructor: its own `Labelable "<Tag>"` row in
// the reader's frame, selected the way its glyph is (list-preview-glyph.ts:
// `resolveEffect` by the bare tag). No per-type fact lives here.
// Solid/browser renderer allowance — reader adapter, same kind as list-preview-glyph.ts.
import { resolveEffect, type EvaluateContext } from "@fenel/engine";
import { valueCardLabel } from "./display-name";
import { selectedRepresentationMethods } from "./constructor-presentation";

/** The label of the constructor `tag` in this frame, or undefined without one. */
export function constructorLabel(frame: EvaluateContext | undefined, tag: string): string | undefined {
  if (!frame?._specRegistry || tag === "") return undefined;
  const label = selectedRepresentationMethods("Labelable", resolveEffect(frame, frame._specRegistry, "Labelable", tag))?.label;
  const text = valueCardLabel(label)?.trim();
  return text ? text : undefined;
}
