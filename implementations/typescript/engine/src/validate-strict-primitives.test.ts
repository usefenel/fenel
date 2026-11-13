import { describe, expect, it, spyOn } from "bun:test";
import { validate, validateValue } from "./validate";
import { Anything, Just, List, Maybe, NonEmptyStr, Nothing, Rational } from "./type-foundation";
import type { FieldDef, FenelType } from "./types";
import type { ModuleRegistry } from "./registry";
import * as catalog from "./type-catalog";

const StringType: FenelType = { $ref: "String" };
const strict = { coerce: false, strict: { primitiveTypes: true }, functions: {} };
const payloadId = "80000000-0000-4000-8000-000000000001";
const captionId = "80000000-0000-4000-8000-000000000002";
const fieldNames: Record<string, string> = { [payloadId]: "payload", [captionId]: "caption" };

// C1: supply only current account facts. The real recursive validator owns
// alias resolution, field traversal, primitive membership, and diagnostics.
const accountRegistry = {
  evaluateContext: () => ({ _fieldCurrentWire: fieldNames }),
  getIdentifiedEntity: (name: string) => name === "AccountCaption"
    ? { id: "AccountCaption", type: StringType }
    : undefined,
  resolveFieldPresentation: (id: string) => ({ label: fieldNames[id], source: "uuid-field-facet" }),
  getFieldRepresentation: (typeName: string, id: string) => typeName === "Codeable" && fieldNames[id]
    ? { typeName, args: [id], methods: { codeName: fieldNames[id] }, scope: "account" }
    : undefined,
} as unknown as ModuleRegistry;

const field = (id: string, type: FenelType): FieldDef => ({
  key: { $tag: "NamedField", ref: { $ref: id } },
  name: fieldNames[id]!, type, label: Nothing, ui: Nothing, meta: {},
});

describe("validate strict primitive inputs", () => {
  it("admits union alternatives through the same strict data plan and refuses unresolved branches", () => {
    const positive = { ...strict, strict: { primitiveTypes: true, membership: true } };
    const scalarUnion: FenelType = { $union: [{ $ref: "Number" }, StringType] };
    for (const value of [7, "seven"]) expect(validateValue(scalarUnion, value, null, positive)).toMatchObject({ valid: true, value });
    expect(validateValue(scalarUnion, { payload: "seven" }, null, positive).valid).toBe(false);
    const uncertain: FenelType = { $union: [{ $ref: "Number" }, { $var: "unknown" }] };
    expect(validateValue(uncertain, 7, null, positive).valid).toBe(true);
    expect(validateValue(uncertain, "not a Number", null, positive).valid).toBe(false);
    const unresolved: FenelType = { $el: { call: ["missingNativeType", 0] } };
    const decision = validateValue(unresolved, { acceptedBefore: true }, null, positive);
    expect(decision.valid).toBe(false);
    expect(decision.errors[0]?.message).toContain("could not decide membership");
    const maybeAnything = Maybe(Anything);
    expect(validateValue(maybeAnything, { $tag: "Just" }, null, positive).valid).toBe(false);
    expect(validateValue(maybeAnything, { $tag: "Just", value: "retired payload" }, null, positive).valid).toBe(false);
    expect(validateValue(maybeAnything, Just("explicit payload"), null, positive).valid).toBe(true);
    const nested: FenelType = { $record: { fields: [field(payloadId, uncertain)] } };
    expect(validateValue(nested, { payload: "not a Number" }, null, { ...positive, registry: accountRegistry }).valid).toBe(false);
  }, 60_000);

  it("resolves ordinary union aliases in the captured context without ambient hydration", () => {
    const scalarUnion: FenelType = { $union: [{ $ref: "Number" }, StringType] };
    const functions = { getEntityType: (name: string) => name === "ReaderNative" ? scalarUnion : undefined };
    const options = { coerce: false, strict: { primitiveTypes: true, membership: true }, functions };
    expect(validateValue({ $ref: "ReaderNative" }, "readable", null, options)).toMatchObject({ valid: true, value: "readable" });
    expect(validateValue({ $ref: "ReaderNative" }, 7, null, options)).toMatchObject({ valid: true, value: 7 });
    expect(validateValue({ $ref: "ReaderNative" }, false, null, options).valid).toBe(false);
    expect(validateValue({ $ref: "Rational" }, { $tag: "Rational", num: "1", den: "2" }, null, options).valid).toBe(false);
  }, 60_000);

  it("reads declared constructor fields through positional transport without running getters", () => {
    const type: FenelType = { $record: { fields: [field(payloadId, StringType)] } };
    const functions = { _constructors: { BridgeRecord: ["payload"] } };
    const options = { coerce: false, strict: { primitiveTypes: true, membership: true }, functions, registry: accountRegistry };
    expect(validateValue(type, { $tag: "BridgeRecord", _0: "positional" }, null, options)).toMatchObject({ valid: true });
    expect(validateValue(type, { $tag: "BridgeRecord", payload: "named" }, null, options)).toMatchObject({ valid: true });
    let reads = 0;
    const unreadable = { $tag: "BridgeRecord" };
    Object.defineProperty(unreadable, "_0", { get: () => { reads++; return "wrong"; }, enumerable: true });
    expect(validateValue(type, unreadable, null, options).valid).toBe(false);
    expect(reads).toBe(0);
  }, 60_000);

  it("refuses variant discriminator accessors before reading their value", () => {
    for (const discriminator of ["$tag", "kind"]) {
      const type: FenelType = { $variant: { discriminator, cases: [{ name: "Empty", fields: [], label: Nothing }] } };
      for (const enumerable of [true, false]) {
        for (const throwing of [false, true]) {
          let reads = 0;
          const value = {};
          Object.defineProperty(value, discriminator, { enumerable, get: () => {
            reads++;
            if (throwing) throw new Error("The discriminator getter must not run");
            return "Empty";
          } });
          const result = validateValue(type, value, null, strict);
          expect(result.valid).toBe(false);
          expect(result.errors).toEqual([{ path: "", message: "Could not read record data" }]);
          expect(reads).toBe(0);
        }
      }
      expect(validateValue(type, { [discriminator]: "Empty" }, null, strict)).toMatchObject({ valid: true, errors: [] });
    }
  }, 60_000);

  it("preserves inert own variant tags, their coercion and the existing case field plan", () => {
    for (const discriminator of ["$tag", "kind"]) {
      const type: FenelType = { $variant: { discriminator, cases: [
        { name: "Empty", fields: [], label: Nothing }, { name: "7", fields: [], label: Nothing }, { name: "true", fields: [], label: Nothing },
      ] } };
      for (const tag of ["Empty", 7, true]) {
        for (const prototype of [Object.prototype, null]) {
          for (const enumerable of [true, false]) {
            const value = Object.create(prototype);
            Object.defineProperty(value, discriminator, { value: tag, enumerable });
            expect(validateValue(type, value, null, strict)).toEqual({
              valid: true, errors: [], value: { [discriminator]: String(tag) },
            });
          }
        }
      }
      for (const value of [{}, { [discriminator]: "Missing" }]) {
        expect(validateValue(type, value, null, strict)).toMatchObject({ valid: false,
          errors: [{ path: discriminator, message: "Must be one of: Empty, 7, true" }] });
      }
      const payloadType: FenelType = { $variant: { discriminator, cases: [{ name: "Filled", fields: [
        { key: { $tag: "PositionalField", index: 0 }, name: "_0", type: StringType, label: Nothing, ui: Nothing, meta: {} },
      ], label: Nothing }] } };
      expect(validateValue(payloadType, { [discriminator]: "Filled", _0: "payload" }, null, strict)).toEqual({
        valid: true, errors: [], value: { [discriminator]: "Filled", _0: "payload" },
      });
      expect(validateValue(payloadType, { [discriminator]: "Filled", _0: 7 }, null, strict).valid).toBe(false);
    }
  }, 60_000);

  it("validates tagged data through its real base while retaining reference rules", () => {
    const measurePhantom: FenelType = { $refined: { base: { $ref: "MeasureExpr" }, set: { $tag: "SeEnum", values: [{ $tag: "MeasureOne" }] } } };
    const currencyPhantom: FenelType = { $refined: { base: { $ref: "String" }, set: { $tag: "SeEnum", values: ["USD"] } } };
    for (const phantom of [measurePhantom, currencyPhantom]) {
      const ratioType: FenelType = { $tagged: { value: { $ref: "Rational" }, phantom } };
      const ratio = { $tag: "Rational", num: "9007199254740993", den: "10" };
      expect(validateValue(ratioType, ratio, null, strict)).toMatchObject({ valid: true, value: ratio });
      expect(validateValue(ratioType, 0.1, null, strict).valid).toBe(false);
      const numberType: FenelType = { $tagged: { value: { $ref: "Number" }, phantom } };
      expect(validateValue(numberType, 0.1, null, strict)).toMatchObject({ valid: true, value: 0.1 });
      expect(validateValue(numberType, ratio, null, strict).valid).toBe(false);
    }
    const refType: FenelType = { $tagged: { value: { $ref: "Id" }, phantom: currencyPhantom } };
    expect(validateValue(refType, payloadId, null, strict).valid).toBe(true);
    expect(validateValue(refType, "USD", null, strict).valid).toBe(false);
    const bogus: FenelType = { $opaque: { name: "Rational", pure: StringType } };
    expect(validateValue(bogus, "own pure meaning", null, strict).valid).toBe(true);
    expect(validateValue(bogus, { $tag: "Rational", num: "1", den: "2" }, null, strict).valid).toBe(false);
  }, 60_000);
  it("checks exact Rational carriers through named Membership without floating coercion", () => {
    const valid = { $tag: "Rational", num: "9007199254740993123456789", den: "3" };
    const unreduced = { $tag: "Rational", num: "2", den: "4" };
    const nativeIntegerFields = { $tag: "Rational", num: -1, den: 2 };
    const one = { $tag: "Succ", _0: { $tag: "Zero" } };
    const pure = { $tag: "Rational", num: { $tag: "Int", magnitude: one, negative: true }, den: { $tag: "Succ", _0: one } };
    for (const type of [Rational, { $ref: "Rational" }] as FenelType[]) {
      for (const value of [valid, unreduced, nativeIntegerFields, pure]) {
        const result = validateValue(type, value, null, strict);
        expect(result.valid).toBe(true);
        expect(result.value).toEqual(value);
      }
      for (const value of [0.1, "1/10", { $tag: "Rational", num: "1", den: "0" },
        { $tag: "Rational", num: "1", den: "-2" }, { $tag: "Rational", num: "1.5", den: "2" },
        { $tag: "Rational", num: "1", den: "NaN" }, { num: "1", den: "2" }]) {
        expect(validateValue(type, value, null, strict).valid).toBe(false);
      }
    }
    const observed: unknown[] = [];
    const bounded = validateValue({ $ref: "Rational" }, { $tag: "Rational", num: "7".repeat(4097), den: "1" }, null, {
      ...strict, observeMembership: verdict => observed.push(verdict),
    });
    expect(bounded.valid).toBe(false);
    expect(observed).toEqual([Nothing]);
    expect(bounded.errors[0]?.message).toContain("could not decide membership");
    const numericObserved: unknown[] = [];
    const unsafe = validateValue({ $ref: "Rational" }, { $tag: "Rational", num: 9007199254740992, den: 1 }, null, {
      ...strict, observeMembership: verdict => numericObserved.push(verdict),
    });
    expect(unsafe.valid).toBe(false);
    expect(numericObserved).toEqual([Nothing]);
    const localOptions = { ...strict, $defs: { Rational: StringType } };
    expect(validateValue({ $ref: "Rational" }, "local meaning", null, localOptions).valid).toBe(true);
    expect(validateValue({ $ref: "Rational" }, valid, null, localOptions).valid).toBe(false);
  }, 60_000);
  it("preserves an own empty String as present data in strict scalar and required record fields", () => {
    const scalar = validateValue(StringType, "", null, strict);
    expect(scalar.valid).toBe(true);
    expect(scalar.value).toBe("");
    expect(scalar.errors).toEqual([]);

    const record: FenelType = { $record: { fields: [field(captionId, StringType)] } };
    const result = validate(record, { caption: "" }, null, {
      ...strict, registry: accountRegistry, strict: { primitiveTypes: true, rejectOmitted: true },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(Object.hasOwn(result.data, "caption")).toBe(true);
    expect(result.data).toEqual({ caption: "" });
  }, 600_000);

  it("keeps omitted and null required fields distinct from an own empty String", () => {
    const record: FenelType = { $record: { fields: [field(captionId, StringType)] } };
    const options = { ...strict, registry: accountRegistry, strict: { primitiveTypes: true, rejectOmitted: true } };
    const missing = validate(record, {}, null, options);
    expect(missing.valid).toBe(false);
    expect(missing.errors.some(error => error.path === "caption")).toBe(true);
    expect(Object.hasOwn(missing.data, "caption")).toBe(false);

    const requiredNull = validate(record, { caption: null }, null, options);
    expect(requiredNull.valid).toBe(false);
    expect(requiredNull.errors.some(error => error.path === "caption")).toBe(true);
    expect(Object.hasOwn(requiredNull.data, "caption")).toBe(false);
  }, 600_000);

  it("routes present empty strings through Number, Boolean and Date membership rather than accepting them", () => {
    for (const name of ["Number", "Boolean", "Date"]) {
      const type: FenelType = { $ref: name };
      expect(validateValue(type, "", null, strict).valid).toBe(false);
      const record: FenelType = { $record: { fields: [field(captionId, type)] } };
      const result = validate(record, { caption: "" }, null, { ...strict, registry: accountRegistry });
      expect(result.valid).toBe(false);
      expect(result.errors.some(error => error.path === "caption")).toBe(true);
    }
  }, 600_000);

  it("still refuses an empty String when the existing nonempty refinement requires content", () => {
    expect(validateValue(NonEmptyStr, "text", null, strict).valid).toBe(true);
    expect(validateValue(NonEmptyStr, "", null, strict).valid).toBe(false);
    const record: FenelType = { $record: { fields: [field(captionId, NonEmptyStr)] } };
    const result = validate(record, { caption: "" }, null, { ...strict, registry: accountRegistry });
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.path === "caption")).toBe(true);
  }, 600_000);

  it("rejects wrong carriers while accepting matching primitive values", () => {
    const cases: [FenelType, unknown, unknown[]][] = [
      [StringType, "answer", [{ wrong: true }, 12, false]],
      [{ $ref: "Number" }, 12.5, ["12.5", true, null]],
      [{ $ref: "Boolean" }, true, ["true", "false", 0, 1]],
    ];
    for (const [type, valid, invalid] of cases) {
      expect(validate(type, valid, null, strict).valid).toBe(true);
      for (const value of invalid) expect(validate(type, value, null, strict).valid).toBe(false);
    }
  }, 600_000);

  it("uses integer and natural-number domains instead of general numeric coercion", () => {
    for (const valid of [-3, 0, 7]) expect(validate({ $ref: "Int" }, valid, null, strict).valid).toBe(true);
    for (const invalid of [0.5, "7", NaN, Infinity]) expect(validate({ $ref: "Int" }, invalid, null, strict).valid).toBe(false);
    for (const valid of [0, 7]) expect(validate({ $ref: "Nat" }, valid, null, strict).valid).toBe(true);
    for (const invalid of [-1, 0.5, "7", NaN, Infinity]) expect(validate({ $ref: "Nat" }, invalid, null, strict).valid).toBe(false);
  }, 600_000);

  it("requires a Date string carrier and retains the existing date validity check", () => {
    expect(validate({ $ref: "Date" }, "2026-09-07", null, strict).valid).toBe(true);
    for (const invalid of [0, new Date("2026-09-07"), { date: "2026-09-07" }, "not-a-date"]) {
      expect(validate({ $ref: "Date" }, invalid, null, strict).valid).toBe(false);
    }
  }, 600_000);

  it("preserves the primitive policy through nested records, local definitions, and account aliases", () => {
    const nested: FenelType = { $record: { fields: [
      field(payloadId, { $record: { fields: [field(captionId, { $ref: "LocalCaption" })] } }),
    ] } };
    const options = { ...strict, registry: accountRegistry, $defs: { LocalCaption: { $ref: "AccountCaption" } as FenelType } };
    // These account/local names have no global catalog candidates. Supplying
    // that host fact avoids booting the unrelated full repository catalog;
    // the real Fenel validator still chooses and unfolds both named aliases.
    const catalogEntry = spyOn(catalog, "getCatalogEntry").mockReturnValue(undefined);
    const catalogType = spyOn(catalog, "getEntityTypeByName").mockReturnValue(undefined);
    try {
      const good = validate(nested, { payload: { caption: "text" } }, null, options);
      expect(good.valid).toBe(true);
      expect(good.data).toEqual({ payload: { caption: "text" } });
      const empty = validate(nested, { payload: { caption: "" } }, null, options);
      expect(empty.valid).toBe(true);
      expect(empty.errors).toEqual([]);
      expect(empty.data).toEqual({ payload: { caption: "" } });
      expect(Object.hasOwn(empty.data.payload as Record<string, unknown>, "caption")).toBe(true);
      const absent = validate(nested, { payload: {} }, null, {
        ...options, strict: { primitiveTypes: true, rejectOmitted: true },
      });
      expect(absent.valid).toBe(false);
      expect(absent.errors.some(error => error.path === "payload.caption")).toBe(true);
      const requiredNull = validate(nested, { payload: { caption: null } }, null, options);
      expect(requiredNull.valid).toBe(false);
      expect(requiredNull.errors.some(error => error.path === "payload.caption")).toBe(true);
      const bad = validate(nested, { payload: { caption: { wrong: true } } }, null, options);
      expect(bad.valid).toBe(false);
      expect(bad.errors.some((error) => error.path === "payload.caption")).toBe(true);
    } finally {
      catalogType.mockRestore();
      catalogEntry.mockRestore();
    }
  }, 600_000);

  it("checks primitive payloads within Maybe and List recursively", () => {
    expect(validate(Maybe(StringType), Nothing, null, strict).valid).toBe(true);
    expect(validate(Maybe(StringType), Just("text"), null, strict).valid).toBe(true);
    expect(validate(Maybe(StringType), Just({ wrong: true }), null, strict).valid).toBe(false);
    expect(validate(List(StringType), ["a", "b"], null, strict).valid).toBe(true);
    expect(validate(List(StringType), ["a", 12], null, strict).valid).toBe(false);
  }, 600_000);

  it("retains scalar form coercion while declared integers remain exact", () => {
    for (const options of [{ coerce: false, functions: {} }, { coerce: false, functions: {}, strict: { primitiveTypes: false } }]) {
      expect(validate(StringType, { wrong: true }, null, options).valid).toBe(true);
      expect(validate({ $ref: "Number" }, "12", null, options).valid).toBe(true);
      expect(validate({ $ref: "Boolean" }, "true", null, options).valid).toBe(true);
      expect(validate({ $ref: "Int" }, 0.5, null, options).valid).toBe(false);
      expect(validate({ $ref: "Int" }, "-7", null, options).valid).toBe(true);
      // Exact Nat admission applies even in the scalar-coercion compatibility
      // mode; a negative Number is not an inhabitant of Nat.
      expect(validate({ $ref: "Nat" }, -1, null, options).valid).toBe(false);
      const record: FenelType = { $record: { fields: [field(captionId, StringType)] } };
      expect(validate(record, { caption: 12 }, null, { ...options, registry: accountRegistry }).data).toEqual({ caption: "12" });
      const blank = validate(record, { caption: "" }, null, { ...options, registry: accountRegistry });
      expect(blank.valid).toBe(false);
      expect(blank.errors.some(error => error.path === "caption")).toBe(true);
      expect(Object.hasOwn(blank.data, "caption")).toBe(false);
    }
  }, 600_000);
});
