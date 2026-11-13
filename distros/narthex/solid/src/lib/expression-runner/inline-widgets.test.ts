import { beforeAll, describe, expect, test } from "bun:test";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import type { FenelType, FieldDef, SetExpr } from "@fenel/engine/types";
import { List, Maybe, Nothing, Just } from "@fenel/engine/type-foundation";
import { inlineWidgetFor } from "./inline-widgets";
import { emptyImageValue, imageCanvasPreview, isInlineImageValue } from "./image-canvas-data";

const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const color: FenelType = { $record: { fields: ["r", "g", "b", "a"].map((name) => field(name, { $ref: "Nat" })) } };
const image: FenelType = { $record: { fields: [
  field("width", { $ref: "Nat" }),
  field("height", { $ref: "Nat" }),
  field("pixels", List(color)),
] } };
const interval = (lo: number, hi?: number): SetExpr => ({
  $tag: "SeInterval", interval: {
    lo: Just({ value: lo, inclusive: true }),
    hi: hi === undefined ? Nothing : Just({ value: hi, inclusive: true }),
  },
});
const refined = (base: FenelType, set: SetExpr): FenelType => ({ $refined: { base, set } });
const environment = createAuthoringEnvironment({
  types: [
    { id: "Image", name: "Image", category: "type", description: "", type: image },
    { id: "AliasImage", name: "AliasImage", category: "type", description: "", type: { $ref: "Image" } },
    { id: "Count", name: "Count", category: "type", description: "", type: refined({ $ref: "Nat" }, interval(2)) },
    { id: "Choice", name: "Choice", category: "type", description: "", type: Maybe({ $ref: "String" }) },
    { id: "LoopA", name: "LoopA", category: "type", description: "", type: { $ref: "LoopB" } },
    { id: "LoopB", name: "LoopB", category: "type", description: "", type: { $ref: "LoopA" } },
  ],
  functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
});

beforeAll(() => {
  // The first engine set/list decision initializes its lazy runtime registry.
  inlineWidgetFor({ $ref: "Image" }, "Image", environment);
}, 30_000);

describe("inline authoring capabilities", () => {
  test("only the named LocaleString advertises the multilingual field editor", () => {
    expect(inlineWidgetFor({ $ref: "LocaleString" }, "LocaleString", environment)).toEqual({
      kind: "field", type: { $ref: "LocaleString" }, seedValue: "",
    });
    const map: FenelType = { $map: { keys: { $tag: "SeRef", handle: "String" }, values: { $ref: "String" } } };
    expect(inlineWidgetFor(map, "LocaleString", environment)).toBeUndefined();
    expect(inlineWidgetFor(map, undefined, environment)).toBeUndefined();
  });
  test("known primitive input widgets have non-null defaults without examples", () => {
    for (const name of ["Number", "Nat", "Int", "Rational", "Real"]) {
      expect(inlineWidgetFor({ $ref: name }, name, environment)).toMatchObject({
        scalarType: "number", seedValue: 0,
      });
    }
    expect(inlineWidgetFor({ $ref: "String" }, "String", environment)?.seedValue).toBe("");
    expect(inlineWidgetFor({ $ref: "Char" }, "Char", environment)?.seedValue).toBe("a");
  });

  test("constructor-only types and unresolved slots never advertise a generic inline widget", () => {
    const types: FenelType[] = [
      Maybe({ $ref: "String" }), { $ref: "Maybe" }, { $ref: "Choice" },
      { $ref: "Boolean" }, { $ref: "Bool" }, { $ref: "Unknown" },
      { $ref: "Any" }, { $var: "a" }, { $unit: true }, { $void: true },
      { $variant: { cases: [{ name: "Nothing", label: Nothing }] } },
      { $opaque: { name: "OpaqueChoice", pure: Maybe({ $ref: "String" }) } },
    ];
    for (const type of types) expect(inlineWidgetFor(type, undefined, environment)).toBeUndefined();
    expect(inlineWidgetFor(undefined, undefined, environment)).toBeUndefined();
    expect(inlineWidgetFor(undefined, "Unknown", environment)).toBeUndefined();
  });

  test("aliases preserve real input widgets and refinement constraints", () => {
    const widget = inlineWidgetFor({ $ref: "Count" }, "Count", environment);
    expect(widget).toMatchObject({ kind: "field", scalarType: "number", seedValue: 2 });
    expect(widget?.type).toEqual(refined({ $ref: "Nat" }, interval(2)));
  });

  test("empty or incompatible refinement witnesses do not manufacture an invalid default", () => {
    expect(inlineWidgetFor(refined({ $ref: "String" }, { $tag: "SeNone" }), undefined, environment))
      .toMatchObject({ kind: "field", seedValue: undefined });
    expect(inlineWidgetFor(refined({ $ref: "Char" }, { $tag: "SeEnum", values: [""] }), undefined, environment)?.seedValue)
      .toBeUndefined();
    expect(inlineWidgetFor(refined(refined({ $ref: "Nat" }, interval(5)), interval(0, 2)), undefined, environment)?.seedValue)
      .toBeUndefined();
  });

  test("Image, its alias and a catalog clone all get a real empty pixel matrix", () => {
    for (const type of [{ $ref: "Image" }, { $ref: "AliasImage" }, structuredClone(image)] as FenelType[]) {
      const widget = inlineWidgetFor(type, undefined, environment);
      expect(widget?.kind).toBe("image");
      expect(widget?.seedValue).toEqual({ width: 0, height: 0, pixels: [] });
      expect(isInlineImageValue(widget?.seedValue)).toBe(true);
    }
  });

  test("Image parameter field projections retain the canvas despite presentation metadata", () => {
    const parameterType = structuredClone(image) as Extract<FenelType, { $record: unknown }>;
    parameterType.$record.fields[0]!.label = Just("Pixel width");
    parameterType.$record.fields[0]!.key = { $tag: "NamedField", ref: { $ref: "11111111-1111-4111-8111-111111111111" } };
    parameterType.$record.fields.reverse();
    expect(inlineWidgetFor(parameterType, undefined, environment)?.kind).toBe("image");
  });

  test("a misleading type label or coincidental record field names do not select the image canvas", () => {
    const other: FenelType = { $record: { fields: [
      field("width", { $ref: "String" }), field("height", { $ref: "String" }), field("pixels", { $ref: "Number" }),
    ] } };
    expect(inlineWidgetFor(other, "Image", environment)?.kind).toBe("field");
    expect(inlineWidgetFor({ $ref: "String" }, "Image", environment)?.kind).toBe("scalar");
    const shadow = createAuthoringEnvironment({
      types: [{ id: "Image", name: "Image", category: "type", description: "", type: other }],
      functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
    });
    expect(inlineWidgetFor({ $ref: "Image" }, "Image", shadow)?.kind).toBe("field");
  });

  test("list widgets remain available for constructor-only elements", () => {
    expect(inlineWidgetFor(List(Maybe({ $ref: "String" })), undefined, environment))
      .toMatchObject({ kind: "field", seedValue: [] });
  });

  test("typed structural widgets receive complete defaults while constructor records use construction", () => {
    const record: FenelType = { $record: { fields: [field("name", { $ref: "String" }), field("count", { $ref: "Count" })] } };
    expect(inlineWidgetFor(record, undefined, environment)?.seedValue).toEqual({ name: "", count: 2 });
    expect(inlineWidgetFor({ $tuple: [{ $ref: "String" }, { $ref: "Nat" }] }, undefined, environment)?.seedValue)
      .toEqual(["", 0]);
    expect(inlineWidgetFor({ $record: { fields: [field("choice", { $ref: "Choice" })] } }, undefined, environment))
      .toBeUndefined();
    expect(inlineWidgetFor({ $record: { fields: [] } }, undefined, environment)).toBeUndefined();
  });

  test("dictionary and tuple leaves never hide unsupported child types behind raw editors", () => {
    const map = (values: FenelType): FenelType => ({ $map: { keys: { $tag: "SeRef", handle: "String" }, values } });
    expect(inlineWidgetFor(map({ $ref: "Nat" }), undefined, environment)).toBeUndefined();
    expect(inlineWidgetFor({ $record: { fields: [field("call", { $ref: "Number" })] } }, undefined, environment)).toBeUndefined();
    for (const type of [{ $ref: "Image" }, { $ref: "Choice" }, { $ref: "Unknown" }] as FenelType[]) {
      expect(inlineWidgetFor(map(type), undefined, environment)).toBeUndefined();
      expect(inlineWidgetFor({ $tuple: [type] }, undefined, environment)).toBeUndefined();
    }
  });

  test("reference widgets never manufacture an entity ID or edit numeric phantom tags as strings", () => {
    const reference: FenelType = { $tagged: { value: { $ref: "String" }, phantom: { $ref: "Image" } } };
    expect(inlineWidgetFor(reference, undefined, environment)).toMatchObject({ kind: "field" });
    expect(inlineWidgetFor(reference, undefined, environment)?.seedValue).toBeUndefined();
    expect(inlineWidgetFor({ $tagged: { value: { $ref: "Nat" }, phantom: { $ref: "Image" } } }, undefined, environment))
      .toBeUndefined();
    expect(inlineWidgetFor({ $tagged: { value: { $ref: "String" }, phantom: { $ref: "Unknown" } } }, undefined, environment))
      .toBeUndefined();
  });

  test("cyclic aliases do not hang the editor or fall back to raw values", () => {
    expect(inlineWidgetFor({ $ref: "LoopA" }, undefined, environment)).toBeUndefined();
  });
});

describe("image canvas data", () => {
  test("the empty image remains a valid 0×0 image", () => {
    const value = emptyImageValue();
    expect(isInlineImageValue(value)).toBe(true);
    expect(imageCanvasPreview(value)).toEqual({ image: value, width: 0, height: 0, rgba: new Uint8ClampedArray() });
    value.pixels.push({ r: 0, g: 0, b: 0, a: 0 });
    expect(emptyImageValue()).toEqual({ width: 0, height: 0, pixels: [] });
  });

  test("rasterizes pixels in row-major RGBA order and preserves the authored value", () => {
    const value = { width: 2, height: 1, pixels: [{ r: 255, g: 0, b: 12, a: 128 }, { r: 1, g: 2, b: 3, a: 255 }] };
    const before = structuredClone(value);
    const preview = imageCanvasPreview(value)!;
    expect([...preview.rgba]).toEqual([255, 0, 12, 128, 1, 2, 3, 255]);
    expect(value).toEqual(before);
  });

  test("a bounded preview samples larger images without allocating a full second raster", () => {
    const value = { width: 8, height: 2, pixels: Array.from({ length: 16 }, (_, r) => ({ r, g: 0, b: 0, a: 255 })) };
    const preview = imageCanvasPreview(value, 4)!;
    expect([preview.width, preview.height]).toEqual([4, 1]);
    expect([...preview.rgba]).toEqual([0, 0, 0, 255, 2, 0, 0, 255, 4, 0, 0, 255, 6, 0, 0, 255]);
    expect(preview.image).toBe(value);
  });

  test("invalid and incomplete Image carriers never masquerade as an empty image", () => {
    for (const value of [null, {}, { width: 1, height: 1, pixels: [] }, { width: -1, height: 0, pixels: [] },
      { width: 1, height: 1, pixels: [{ r: 0, g: 0, b: Number.NaN, a: 255 }] }]) {
      expect(isInlineImageValue(value)).toBe(false);
      expect(imageCanvasPreview(value)).toBeUndefined();
    }
  });
});
