import { describe, expect, test } from "bun:test";
import type { FenelType, FieldDef } from "../types";
import type { ModuleRegistry } from "../registry";
import { Int, List, Nothing, Rational } from "../type-foundation";
import { assertJsonAuthoringValue, valueFromJsonWire, valueToJsonWire, pureValueType, defaultValueForAuthoring, isNativeValueRepresentation, VALUE_JSON_ENCODING } from "./value-authoring";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue } from "../checkpoint-json";
import { evaluate, runtimeRepresentationInspectionSuppressed } from "../json-logic";
import { GLOBAL_ONLY } from "../dispatch-registry";

const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: Nothing, ui: Nothing, meta: {} });
const pattern = { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: Infinity } } as const;
const typeValue = { $refined: { base: { $ref: "String" }, set: pattern } } as FenelType;
const throughJson = (schema: FenelType, value: unknown, registry?: ModuleRegistry) => valueFromJsonWire(schema, JSON.parse(JSON.stringify(valueToJsonWire(schema, value, registry))), registry);
const throughNativeJson = (schema: FenelType, value: unknown) => valueFromJsonWire(schema, JSON.parse(JSON.stringify(valueToJsonWire(schema, value, undefined, VALUE_JSON_ENCODING))), undefined, VALUE_JSON_ENCODING);

describe("source-owned authoring defaults", () => {
  test("frameless Rational default uses the fixed zero body and releases its private extent", () => {
    expect(runtimeRepresentationInspectionSuppressed()).toBe(false);
    expect(defaultValueForAuthoring({ $ref: "Rational" })).toEqual({ $tag: "Rational", num: "0", den: "1" });
    expect(runtimeRepresentationInspectionSuppressed()).toBe(false);
    const chosen = { $tag: "Rational", num: "5", den: "7" };
    const lookups: unknown[][] = [];
    const registry = { resolve: (name: string, typeName: string, scope: unknown) => {
      lookups.push([name, typeName, scope]); return { default: chosen };
    } };
    expect(defaultValueForAuthoring({ $ref: "Rational" }, registry)).toBe(chosen);
    expect(lookups).toEqual([["Rational", "HasDefault", GLOBAL_ONLY]]);
    expect(defaultValueForAuthoring({ $ref: "Number" })).toBe(0);
    expect(defaultValueForAuthoring({ $ref: "String" })).toBe("");
    expect(runtimeRepresentationInspectionSuppressed()).toBe(false);
  });
});

describe("schema-directed value JSON transport", () => {
  test("exact Rational digits survive typed value and nested JSON transport", () => {
    const value = { $tag: "Rational", num: "-900719925474099312345678901234567891", den: "100000000000000000000000000000000003" };
    for (const schema of [Rational, { $ref: "Rational" }] as FenelType[]) {
      expect(throughJson(schema, value)).toEqual(value);
      expect(throughNativeJson(schema, value)).toEqual(value);
      expect(isNativeValueRepresentation("Rational", value)).toBe(true);
      expect(isNativeValueRepresentation("Rational", 0.1)).toBe(false);
      expect(defaultValueForAuthoring(schema)).toEqual({ $tag: "Rational", num: "0", den: "1" });
    }
    expect(throughJson({ $record: { fields: [field("ratios", List(Rational))] } }, { ratios: [value] })).toEqual({ ratios: [value] });
    const pure = { $tag: "Rational", num: { $tag: "Int", magnitude: { $tag: "Zero" }, negative: false }, den: { $tag: "Succ", _0: { $tag: "Zero" } } };
    expect(isNativeValueRepresentation("Rational", pure)).toBe(false);
    expect(throughJson(Rational, pure)).toEqual(pure);
  }, 60_000);
  test("nested Type/SetExpr slots encode their schema-local tokens and leave raw records untouched", () => {
    const schema: FenelType = { $record: { fields: [
      field("type", { $type: true }), field("sets", List({ $ref: "SetExpr" })),
      field("raw", { $ref: "Any" }), field("pair", { $tuple: [{ $ref: "Bytes" }, { $type: true }] }),
    ] } };
    const raw = { $tag: "SePattern", pattern: { t: "rep", max: "unbounded", child: { t: "eps" }, min: 0 } };
    const original = { type: typeValue, sets: [pattern], raw, pair: [Uint8Array.of(0, 255), typeValue] };
    expect(throughJson(schema, original)).toEqual(original);
    const wire = valueToJsonWire(schema, original) as any;
    expect(wire.type.$refined.set.pattern.max).toBe("unbounded");
    expect(wire.raw).toEqual(raw);
    expect(wire.pair[0]).toEqual([0, 255]);
    expect(throughJson({ $ref: "Any" }, raw)).toEqual(raw);
  });

  test("renamed field UUID slots use their current registry wire projection", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const schema: FenelType = { $record: { fields: [{ ...field("oldName", { $type: true }), key: { $tag: "NamedField", ref: { $ref: id } } }] } };
    const registry = { getFieldRepresentation: (kind: string, key: string) => kind === "Codeable" && key === id ? { methods: { codeName: "currentName" } } : undefined } as unknown as ModuleRegistry;
    const value = { currentName: typeValue, oldName: { untouched: "business value" } };
    expect(throughJson(schema, value, registry)).toEqual(value);
  });

  test("identified transport fields require the registry's machine wire name", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const schema: FenelType = { $record: { fields: [{ ...field("staleName", { $type: true }), key: { $tag: "NamedField", ref: { $ref: id } } }] } };
    for (const codeName of [undefined, "", { en: "localizedName" }]) {
      const registry = { getFieldRepresentation: () => ({ methods: { codeName } }) } as unknown as ModuleRegistry;
      expect(() => valueToJsonWire(schema, { staleName: typeValue }, registry)).toThrow("no string Codeable");
    }
    // A keyless in-flight field has an explicit wire name, before persistence
    // has assigned its UUID and authoritative Codeable facet.
    expect(throughJson({ $record: { fields: [field("draft", { $type: true })] } }, { draft: typeValue })).toEqual({ draft: typeValue });
  });

  test("type-as-value metadata survives both directions", () => {
    const annotated = { annotation: "outer", $tagged: { annotation: "tag", phantom: { $ref: "Marker" }, value: { annotation: "mapOuter", $map: { annotation: "mapInner", keys: pattern, values: { annotation: "arrowOuter", $arrow: { annotation: "arrowInner", params: [field("p", typeValue)], returns: { annotation: "opaqueOuter", $opaque: { annotation: "opaqueInner", name: "Thing", pure: typeValue } } } } } } } } as unknown as FenelType;
    expect(throughJson({ $type: true }, annotated)).toEqual(annotated);
  });

  test("Bytes and ordinary lists keep distinct identities under an untagged union", () => {
    const list = List({ $ref: "Number" });
    const schema: FenelType = { $union: [{ $ref: "Bytes" }, list] };
    const bytes = throughJson(schema, Uint8Array.of(1, 2));
    const array = throughJson(schema, [1, 2]);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toEqual(Uint8Array.of(1, 2));
    expect(Array.isArray(array)).toBe(true);
    expect(array).toEqual([1, 2]);
    const wire = valueToJsonWire(schema, Uint8Array.of(3, 4));
    expect(valueFromJsonWire({ $union: [list, { $ref: "Bytes" }] }, wire)).toEqual(Uint8Array.of(3, 4));
    expect(() => valueFromJsonWire({ $union: [list] }, wire)).toThrow("removed or changed");
    expect(() => valueFromJsonWire(schema, [1, 2])).toThrow("Legacy union data");
  });

  test("ordinary marker-shaped records are escaped rather than revived", () => {
    const schema: FenelType = { $union: [{ $ref: "Bytes" }, { $ref: "Any" }] };
    const raw = { $fenelUnion: { version: 1, branch: { $ref: "Bytes" }, value: [9, 8] } };
    expect(throughJson(schema, raw)).toEqual(raw);
    expect(valueFromJsonWire({ $ref: "Any" }, raw)).toBe(raw);
  });

  test("stored carrier identity ignores presentation metadata and record declaration order", () => {
    const record: FenelType = { $record: { fields: [field("data", { $ref: "Bytes" }), field("note", { $ref: "String" })] } };
    // Existing metadata is opaque legacy data; new FieldMetadata is erased.
    const cosmetic = { $record: { fields: [...record.$record.fields].reverse().map((f) => ({ ...f, label: { $tag: "Just", _0: "Renamed display label" }, meta: { help: "New help" } })) } } as unknown as FenelType;
    const oldUnion: FenelType = { $union: [record, { $ref: "Number" }] };
    const newUnion: FenelType = { $union: [{ $ref: "Number" }, cosmetic] };
    const original = { data: Uint8Array.of(5), note: "unchanged" };
    const wire = valueToJsonWire(oldUnion, original);
    expect(valueFromJsonWire(newUnion, wire)).toEqual(original);
    // Existing v1 frames with the full, presentation-bearing type are accepted.
    expect(valueFromJsonWire(newUnion, { $fenelUnion: { version: 1, branch: record, value: { data: [5], note: "unchanged" } } })).toEqual(original);
    const intersection: FenelType = { $intersect: [record, { $ref: "Any" }] };
    expect(valueFromJsonWire({ $intersect: [{ $ref: "Any" }, cosmetic] }, valueToJsonWire(intersection, original))).toEqual(original);
    expect(() => valueFromJsonWire({ $union: [{ $record: { fields: [field("data", { $ref: "String" }), field("note", { $ref: "String" })] } }] }, wire)).toThrow("removed or changed");
  });

  test("field wire renames cannot silently reinterpret stored union slots", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const schema: FenelType = { $union: [{ $record: { fields: [{ ...field("draftName", { $ref: "Bytes" }), key: { $tag: "NamedField", ref: { $ref: id } } }] } }] };
    const registry = (wire: string) => ({ getIdentifiedEntity: () => undefined, getEntity: () => undefined, getFieldRepresentation: () => ({ methods: { codeName: wire } }) }) as unknown as ModuleRegistry;
    const encoded = valueToJsonWire(schema, { oldWire: Uint8Array.of(6) }, registry("oldWire"));
    expect(valueFromJsonWire(schema, encoded, registry("oldWire"))).toEqual({ oldWire: Uint8Array.of(6) });
    expect(() => valueFromJsonWire(schema, encoded, registry("newWire"))).toThrow("removed or changed");
  });

  test("overlapping and disjoint intersection carriers survive their exact projection", () => {
    const bytes: FenelType = { $ref: "Bytes" };
    const union: FenelType = { $union: [bytes, List({ $ref: "Number" })] };
    const schema: FenelType = { $intersect: [bytes, union] };
    const wire = valueToJsonWire(schema, Uint8Array.of(8, 9));
    expect(valueFromJsonWire(schema, wire)).toEqual(Uint8Array.of(8, 9));
    expect(valueFromJsonWire({ $intersect: [union, bytes] }, wire)).toEqual(Uint8Array.of(8, 9));
    const records: FenelType = { $intersect: [
      { $record: { fields: [field("a", bytes)] } },
      { $record: { fields: [field("b", bytes)] } },
    ] };
    const original = { a: Uint8Array.of(1), b: Uint8Array.of(2) };
    expect(throughJson(records, original)).toEqual(original);
    const raw = { $fenelIntersection: { version: 1, branches: [bytes], value: [7] } };
    expect(throughJson({ $intersect: [{ $ref: "Any" }] }, raw)).toEqual(raw);
  });

  test("Bytes aliases resolve by their declared registry identity", () => {
    const registry = { getIdentifiedEntity: (name: string) => name === "bytes-id" ? { id: "Bytes", type: { $ref: "Bytes" } } : undefined, getEntity: () => undefined } as unknown as ModuleRegistry;
    expect(throughJson({ $ref: "bytes-id" }, Uint8Array.of(42), registry)).toEqual(Uint8Array.of(42));
    expect(() => valueFromJsonWire({ $ref: "Bytes" }, [256])).toThrow("0 to 255");
  });
  test("syntax-local transport never resolves nested aliases from an ambient catalogue", () => {
    const schema: FenelType = { $record: { fields: [field("local", { $type: true }), field("unknown", { $ref: "Reprable" })] } };
    const literal = { native: { $refined: { base: { $ref: "String" }, set: { $tag: "SePattern", pattern: { t: "rep", child: { t: "eps" }, min: 0, max: "unbounded" } } } } };
    const value = { local: typeValue, unknown: literal };
    const wire = valueToJsonWire(schema, value, null);
    expect(valueFromJsonWire(schema, wire, null)).toEqual(value);
    expect(() => valueToJsonWire(schema, { local: typeValue, unknown: { native: typeValue } }, null)).toThrow("non-finite");
  });
  test("public codec convenience byte carriers retain their carrier class", () => {
    const schema: FenelType = { $ref: "Bytes" };
    const buffer = Uint8Array.of(4, 5, 6).buffer;
    const decodedBuffer = throughJson(schema, buffer);
    expect(decodedBuffer).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(decodedBuffer as ArrayBuffer))).toEqual([4, 5, 6]);
    expect(throughJson(schema, [4, 5, 6])).toEqual([4, 5, 6]);
    expect(Array.isArray(throughJson(schema, [4, 5, 6]))).toBe(true);
  });

  test("opaque native and pure numeric representations remain separate", () => {
    const pure = { $tag: "Int", magnitude: { $tag: "Succ", pred: { $tag: "Zero" } }, negative: false };
    expect(throughJson(Int, pure)).toEqual(pure);
    expect(throughJson(Int, 1)).toBe(1);
    if (!("$opaque" in Int)) throw new Error("Int fixture must retain its opaque definition");
    expect(pureValueType(Int)).toEqual(Int.$opaque.pure);
  });

  test("Arrow bodies project expression type slots while captures and bound values stay raw", () => {
    const arrow: FenelType = { $arrow: { params: [], returns: { $type: true } } };
    const source = { fn: [[], typeValue] };
    expect(throughJson(arrow, source)).toEqual(source);
    expect(throughJson({ $union: [arrow, { $ref: "String" }] }, source)).toEqual(source);
    const raw = { call: ["business-data", { $fenelUnion: { version: 1, value: [1] } }] };
    const closure = { __fenelFn: true, params: [], body: typeValue, closure: { captured: raw } };
    expect(throughJson(arrow, closure)).toEqual(closure);
    const partial = { __fenelPartial: true, fn: closure, collected: [raw], arity: 1 };
    expect(throughJson(arrow, partial)).toEqual(partial);
    expect(() => valueToJsonWire(arrow, { ...closure, closure: { captured: typeValue } })).toThrow("non-finite");
  });

  test("v2 saved evaluated closures and partials reopen and execute with native captured/default data", () => {
    const raw = { bytes: Uint8Array.of(1, 255), limit: Infinity, nan: NaN, zero: -0, business: encodeCheckpointValue(Infinity) };
    const body = { var: ["missing", raw] };
    const closure = evaluate({ fn: [[], body] }, { captured: raw });
    const arrow: FenelType = { $arrow: { params: [], returns: { $ref: "Value" } } };
    const reopened = throughNativeJson(arrow, closure);
    expect(reopened).toEqual(closure);
    expect(evaluate({ call: [{ var: "saved" }] }, { saved: reopened })).toEqual(raw);
    const partial = evaluate({ call: [{ fn: ["first", "later", { var: "first" }] }, { var: "bound" }] }, { bound: raw });
    const partialType: FenelType = { $arrow: { params: [field("later", { $ref: "String" })], returns: { $ref: "Value" } } };
    const reopenedPartial = throughNativeJson(partialType, partial);
    expect(reopenedPartial).toEqual(partial);
    const result = evaluate({ call: [{ var: "saved" }, "unused"] }, { saved: reopenedPartial }) as typeof raw;
    expect(result).toEqual(raw);
    expect(Object.is(result.zero, -0)).toBe(true);
    expect(Number.isNaN(result.nan)).toBe(true);
  });

  test("v2 closure direct binary literals retain their carrier and raw defaults keep type-looking data raw", () => {
    const arrow: FenelType = { $arrow: { params: [], returns: { $ref: "Bytes" } } };
    for (const binary of [Uint8Array.of(2, 4), Uint8Array.of(2, 4).buffer]) {
      const closure = evaluate({ fn: [[], binary] }, {});
      const reopened = throughNativeJson(arrow, closure);
      const result = evaluate({ call: [{ var: "saved" }] }, { saved: reopened });
      expect(result).toBeInstanceOf(binary instanceof Uint8Array ? Uint8Array : ArrayBuffer);
      expect(Array.from(result instanceof Uint8Array ? result : new Uint8Array(result as ArrayBuffer))).toEqual([2, 4]);
    }
    const rawSet = { $tag: "SePattern", pattern: { t: "rep", min: 0, max: "unbounded", child: { t: "eps" } } };
    const rawType = { $refined: { base: { $ref: "String" }, set: rawSet } };
    for (const [returns, fallback] of [[{ $type: true }, rawType], [{ $ref: "SetExpr" }, rawSet]] as [FenelType, unknown][]) {
      const closure = evaluate({ fn: [[], { var: ["missing", fallback] }] }, {});
      const reopened = throughNativeJson({ $arrow: { params: [], returns } }, closure);
      expect(evaluate({ call: [{ var: "saved" }] }, { saved: reopened })).toEqual(fallback);
    }
  });

  test("v2 closure bodies invert declared union/intersection carriers and escape marker literals", () => {
    const box: FenelType = { $variant: { cases: [{ name: "BytesBox", label: Nothing, fields: [field("_0", { $ref: "Bytes" })] }] } };
    const openRecord: FenelType = { $record: { fields: [] } };
    const data = { $tag: "BytesBox", _0: Uint8Array.of(1, 2) };
    for (const returns of [{ $union: [box, { $ref: "String" }] }, { $intersect: [box, openRecord] }] as FenelType[]) {
      const closure = evaluate({ fn: [[], data] }, {});
      const reopened = throughNativeJson({ $arrow: { params: [], returns } }, closure);
      expect(evaluate({ call: [{ var: "saved" }] }, { saved: reopened })).toEqual(data);
    }
    for (const [returns, marker] of [
      [{ $union: [box, openRecord] }, { $fenelUnion: { version: 1, branch: box, value: data } }],
      [{ $intersect: [openRecord] }, { $fenelIntersection: { version: 1, branches: [box], value: "literal data" } }],
    ] as [FenelType, unknown][]) {
      const closure = evaluate({ fn: [[], marker] }, {});
      const arrow: FenelType = { $arrow: { params: [], returns } };
      const reopened = throughNativeJson(arrow, closure);
      expect(evaluate({ call: [{ var: "saved" }] }, { saved: reopened })).toEqual(marker);
    }
    const legacyMarker = { $fenelUnion: { version: 1, branch: { $ref: "Bytes" }, value: [9] } };
    const legacyClosure = evaluate({ fn: [[], legacyMarker] }, {});
    expect(valueFromJsonWire({ $arrow: { params: [], returns: { $union: [box, openRecord] } } }, legacyClosure)).toEqual(legacyClosure);
  });

  test("v2 wraps raw native atoms once and never revives v1 or new marker-shaped business data", () => {
    const schema: FenelType = { $ref: "Any" };
    const marker = encodeCheckpointValue(Infinity);
    expect(throughJson(schema, marker)).toEqual(marker);
    expect(throughNativeJson(schema, marker)).toEqual(marker);
    const raw = { marker, bytes: Uint8Array.of(9), limit: Infinity, zero: -0 };
    const wire = valueToJsonWire(schema, raw, undefined, VALUE_JSON_ENCODING);
    // The HTTP native codec is an independent, explicitly flagged outer layer.
    const httpRead = decodeCheckpointValue(JSON.parse(JSON.stringify(encodeCheckpointValue(wire))), CHECKPOINT_VALUE_ENCODING);
    expect(valueFromJsonWire(schema, httpRead, undefined, VALUE_JSON_ENCODING)).toEqual(raw);
    expect(Object.is(throughNativeJson({ $ref: "Number" }, -0), -0)).toBe(true);
  });

  test("v2 retains cosmetic schema identity and rejects undefined raw fields", () => {
    const record: FenelType = { $record: { fields: [field("bytes", { $ref: "Bytes" }), field("label", { $ref: "String" })] } };
    const next: FenelType = { $record: { fields: [...record.$record.fields].reverse().map((f) => ({ ...f, label: { $tag: "Just" as const, _0: "Cosmetic label" } })) } };
    const raw = { bytes: Uint8Array.of(3), label: "kept" };
    const wire = valueToJsonWire({ $union: [record] }, raw, undefined, VALUE_JSON_ENCODING);
    expect(valueFromJsonWire({ $union: [next] }, wire, undefined, VALUE_JSON_ENCODING)).toEqual(raw);
    expect(() => valueToJsonWire({ $ref: "Any" }, { missing: undefined }, undefined, VALUE_JSON_ENCODING)).toThrow("undefined");
    expect(() => throughNativeJson({ $arrow: { params: [], returns: { $ref: "Value" } } }, { __fenelFn: true, params: [], closure: {}, body: { var: ["missing", { bad: undefined }] } })).toThrow("undefined");
  });

  test("untyped host carriers, cycles, and nonfinite values fail before JSON can corrupt them", () => {
    for (const value of [1n, Uint8Array.of(1), new ArrayBuffer(2), new Uint16Array([1]), Infinity]) expect(() => assertJsonAuthoringValue(value)).toThrow();
    expect(() => valueToJsonWire({ $ref: "Any" }, Uint8Array.of(1))).toThrow("Bytes slot");
    const cycle: any[] = []; cycle.push(cycle);
    expect(() => valueToJsonWire(List({ $ref: "Any" }), cycle)).toThrow("Cyclic");
    expect(() => valueToJsonWire({ $ref: "Any" }, { a: undefined })).toThrow("undefined");
    expect(() => valueToJsonWire({ $record: { fields: [field("a", { $ref: "Any" })] } }, { a: { b: undefined } })).toThrow("undefined");
    expect(() => valueToJsonWire({ $record: { fields: [] } }, { extra: undefined })).toThrow("undefined");
    expect(() => valueToJsonWire({ $type: true }, { $ref: "String", optionalDefinitionMetadata: undefined })).not.toThrow();
  });
});
