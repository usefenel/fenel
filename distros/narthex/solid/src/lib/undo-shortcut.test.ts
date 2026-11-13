import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// No DOM in bun tests: a minimal Element/HTMLElement pair answers `closest`
// and `isContentEditable` as the browser does for these cases.
class FakeElement { constructor(readonly editing: boolean) {} closest(_selector: string) { return this.editing ? this : null; } }
class FakeHTMLElement extends FakeElement { isContentEditable = false; }
let originalElement: PropertyDescriptor | undefined;
let originalHTMLElement: PropertyDescriptor | undefined;
beforeEach(() => {
  originalElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
  originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  Object.defineProperties(globalThis, {
    Element: { configurable: true, writable: true, value: FakeElement },
    HTMLElement: { configurable: true, writable: true, value: FakeHTMLElement },
  });
});
afterEach(() => {
  if (originalElement) Object.defineProperty(globalThis, "Element", originalElement);
  else Reflect.deleteProperty(globalThis, "Element");
  if (originalHTMLElement) Object.defineProperty(globalThis, "HTMLElement", originalHTMLElement);
  else Reflect.deleteProperty(globalThis, "HTMLElement");
});
const { isHomeUndoShortcut } = await import("./undo-shortcut");

const key = (patch: Partial<Parameters<typeof isHomeUndoShortcut>[0]>) => ({
  key: "z", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
  target: new FakeHTMLElement(false) as unknown as EventTarget, ...patch });

describe("Home Undo shortcut (polish lane 2)", () => {
  test("Ctrl+Z and Cmd+Z outside a text box undo", () => {
    expect(isHomeUndoShortcut(key({}))).toBe(true);
    expect(isHomeUndoShortcut(key({ ctrlKey: false, metaKey: true, key: "Z" }))).toBe(true);
  });
  test("a text box keeps its own undo", () => {
    expect(isHomeUndoShortcut(key({ target: new FakeHTMLElement(true) as unknown as EventTarget }))).toBe(false);
  });
  test("redo, other keys, plain z and handled events are not Undo", () => {
    expect(isHomeUndoShortcut(key({ shiftKey: true }))).toBe(false);
    expect(isHomeUndoShortcut(key({ altKey: true }))).toBe(false);
    expect(isHomeUndoShortcut(key({ key: "y" }))).toBe(false);
    expect(isHomeUndoShortcut(key({ ctrlKey: false }))).toBe(false);
    expect(isHomeUndoShortcut(key({ defaultPrevented: true }))).toBe(false);
  });
});
