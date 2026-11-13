// Type annotation `(expression : Type)` in the expression editor: the two
// display decisions the editor makes about it, kept free of JSX so
// `annotation-lens.test.ts` runs them directly. The encoding itself (the
// `__ann` marker and the `{ann: [e, T]}` node) is the engine codec's.
import type { FenelType } from "@fenel/engine/types";
import { dispatchedCodeLensTextIsReadable } from "@fenel/engine/engine-bodies-dispatch";

/** The type the annotation's TypeBuilder edits. A real FenelType is edited as
 *  is. A bare name is the legacy spelling older parsers wrote for `x :: T`;
 *  it is shown as the reference it names, and the stored value changes only
 *  when the user edits the type. Anything else leaves the builder empty. */
export function annotationTypeForEditor(type: unknown): FenelType | null {
  if (typeof type === "string") return type.trim() === "" ? null : { $ref: type.trim() };
  return type !== null && typeof type === "object" && !Array.isArray(type) ? type as FenelType : null;
}

/** Whether printed code can be read back by the parser. The printer writes a
 *  type it has no syntax for either as a JSON dump (a `$`-keyed object, outside
 *  annotations) or, inside an annotation, as the diagnostic
 *  `<no surface syntax: …>` (`ppAnn`, `fenel-printer.fenel`). Neither parses
 *  back to the same expression, so the code lens shows such text read-only
 *  instead of offering it as editable source. Literal text holding either is
 *  data the parser reads back unchanged: the printer escapes the quotes of a
 *  JSON dump inside a double-quoted literal (so the dump pattern never matches
 *  there), and neither is looked for in a template's text. The expressions a
 *  template interpolates (`${…}`) are code, and are checked like any code. */
export function codeLensTextIsReadable(code: string): boolean {
  return dispatchedCodeLensTextIsReadable(code);
}
