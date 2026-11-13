// Ctrl+Z / Cmd+Z for Home's in-place Undo (polish lane 2, Nov 9). A text box
// keeps its own native undo: the shortcut belongs to Home only when focus is
// not in an input, a text area, a select or editable text. Shift (redo) and
// Alt combinations are left alone.

import { isNativeEditingTarget } from "./data-transfer/events";

export type UndoKeyEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "target" | "defaultPrevented">;

export function isHomeUndoShortcut(event: UndoKeyEvent): boolean {
  if (event.defaultPrevented || event.shiftKey || event.altKey) return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  if (event.key !== "z" && event.key !== "Z") return false;
  return !isNativeEditingTarget(event.target);
}
