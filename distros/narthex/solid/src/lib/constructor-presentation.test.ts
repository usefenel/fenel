import { describe, expect, test } from "bun:test";
import { bareConstructorTag, ownGlyphMark, selectedRepresentationMethods } from "./constructor-presentation";
import { constructorLabel } from "./constructor-label";
import type { EvaluateContext } from "@fenel/engine";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { createDispatchRegistry } from "../../../../../implementations/typescript/engine/src/dispatch-registry";
import { resolveEffect } from "../../../../../implementations/typescript/engine/src/effect-dispatch";

describe("bareConstructorTag", () => {
  test("only an object whose one own key is a string $tag", () => {
    expect(bareConstructorTag({ $tag: "SolanumLycopersicum" })).toBe("SolanumLycopersicum");
    expect(bareConstructorTag({ $tag: "Just", _0: 1 })).toBeUndefined();
    expect(bareConstructorTag({ $tag: "" })).toBeUndefined();
    expect(bareConstructorTag({ $ref: "x" })).toBeUndefined();
    expect(bareConstructorTag([{ $tag: "A" }])).toBeUndefined();
    expect(bareConstructorTag("Tomato")).toBeUndefined();
    const accessor = Object.defineProperty({}, "$tag", { get: () => "Leaf", enumerable: true });
    expect(bareConstructorTag(accessor)).toBeUndefined();
  });
});

describe("ownGlyphMark: the item's own picture first, else its emoji", () => {
  test("a type's icon or a blank emoji is no mark of the item", () => {
    const picture = { $tag: "GlyphPictureReference", handle: "primalDietLogo" };
    expect(ownGlyphMark({ picture, emoji: "🥩" })).toBe("picture");
    expect(ownGlyphMark({ emoji: " 🥩 " })).toBe("emoji");
    expect(ownGlyphMark({ emoji: "  " })).toBeUndefined();
    expect(ownGlyphMark({ icon: "leaf" })).toBeUndefined();
    expect(ownGlyphMark(undefined)).toBeUndefined();
  });
});

describe("selectedRepresentationMethods: a Labelable keyed by a bare tag, as the loader stores it", () => {
  // The same authoring as life-data.fenel: `_ : Labelable "<Tag>"` / `_ = Labelable { label = … }`.
  const source = [
    "module ConstructorLabelProbe where", "",
    "Thing = AllThings | LeafThing", "",
    "_ : Labelable \"LeafThing\"", "_ = Labelable { label = \"A leaf\" }", "",
    "_ : Emojiable \"LeafThing\"", "_ = Emojiable { emoji = \"🍃\" }", "",
  ].join("\n");
  const loaded = loadFenelModule(source, "ConstructorLabelProbe");
  const pool = createDispatchRegistry();
  for (const instance of loaded.instances ?? []) pool.addInstance(instance);

  test("the loader lifts the label off the methods; the selection reads it back from the row", () => {
    const selected = resolveEffect(undefined, pool, "Labelable", "LeafThing");
    expect(selected?.methods).toEqual({});
    expect(selectedRepresentationMethods("Labelable", selected)).toEqual({ label: "A leaf" });
  });

  test("other classes, and a label already in the methods, are returned as selected", () => {
    const emoji = resolveEffect(undefined, pool, "Emojiable", "LeafThing");
    expect(selectedRepresentationMethods("Emojiable", emoji)).toBe(emoji!.methods);
    const inMethods = { methods: { label: "Kept" }, source: { kind: "instance" as const, instance: { label: "Row" } } };
    expect(selectedRepresentationMethods("Labelable", inMethods)).toEqual({ label: "Kept" });
    expect(selectedRepresentationMethods("Labelable", undefined)).toBeUndefined();
    expect(resolveEffect(undefined, pool, "Labelable", "AllThings")).toBeUndefined();
  });

  test("constructorLabel: the bare tag's own label in the reader's frame, else nothing", () => {
    const frame = { _specRegistry: pool } as unknown as EvaluateContext;
    expect(constructorLabel(frame, "LeafThing")).toBe("A leaf");
    expect(constructorLabel(frame, "AllThings")).toBeUndefined();
    expect(constructorLabel(undefined, "LeafThing")).toBeUndefined();
  });
});
