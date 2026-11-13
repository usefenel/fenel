import { describe, expect, it } from "vitest";
import {
  dispatchedFieldsReferencing,
  dispatchedFunctionArrowType,
  dispatchedFunctionUsages,
  dispatchedTraversalSemanticSlotsError,
  marshalTraversalDeclarationType,
  marshalTraversalType,
  printerTypeToMarker,
  traversalHasHostileNode,
  traversalHasUnknownNode,
} from "./engine-bodies-dispatch";
import { parseEntityDef, printEntityDef } from "./entity-def-printer";
import { Nothing } from "./type-foundation";
import { walkType } from "./type-traversal";
import type { FieldDef } from "./types";

const field = (
  name: string,
  type: unknown,
  key?: FieldDef["key"],
): FieldDef => ({
  name,
  ...(key === undefined ? {} : { key }),
  type: type as FieldDef["type"],
  label: Nothing,
  meta: {},
  ui: Nothing,
});

describe("field-identity traversal boundary", () => {
  it("prints an unresolved UUID field as an explicit fieldRef debug form", () => {
    const id = "11111111-1111-4111-8111-111111111119";
    const key = { $tag: "NamedField", ref: { $ref: id } } as const;
    const type = {
      $record: {
        fields: [{ name: id, key, type: { $ref: "String" } }],
      },
    };
    const marker = printerTypeToMarker(type) as unknown as {
      fields: Array<{ name: string }>;
    };
    expect(marker.fields[0]?.name).toBe(`fieldRef(${JSON.stringify(id)})`);
    const printed = printEntityDef("Debug", "Debug", [{ id, key, type: { $ref: "String" } }]);
    expect(printed).toContain("<no surface syntax: a constructor field name");
    expect(printed).toContain(id);
    expect(parseEntityDef(printed)).toHaveProperty("error");

    const current = printerTypeToMarker({
      $record: {
        fields: [{ name: "currentName", key, type: { $ref: "String" } }],
      },
    }) as unknown as { fields: Array<{ name: string }> };
    expect(current.fields[0]?.name).toBe("currentName");
  });

  it("classifies exact key wires and returns an opaque token sink", () => {
    const namedId = "11111111-1111-4111-8111-111111111111";
    const missing = field("name", { $ref: "String" });
    const named = field("externalId", { $ref: "String" }, {
      $tag: "NamedField",
      ref: { $ref: namedId },
    });
    const positional = field("_2", { $ref: "Number" }, {
      $tag: "PositionalField",
      index: 2,
    });
    const raw = { $record: { fields: [missing, named, positional] } };

    const marshalled = marshalTraversalDeclarationType(raw, "type:demo:T");
    const view = marshalled.type as {
      $tag: string;
      fields: Array<Record<string, unknown>>;
    };

    expect(view.$tag).toBe("TtRecord");
    expect(view.fields.map((f) => ({
      name: f.name,
      key: f.key,
      semanticKey: f.semanticKey,
      wireName: f.wireName,
      token: f.token,
    }))).toEqual([
      {
        name: "name",
        key: { $tag: "NoFieldKey" },
        semanticKey: { $tag: "NamedField", ref: { $ref: "" } },
        wireName: "name",
        token: "type:demo:T:f0",
      },
      {
        name: "externalId",
        key: { $tag: "NamedFieldInput", handle: namedId },
        semanticKey: { $tag: "NamedField", ref: { $ref: namedId } },
        wireName: "externalId",
        token: "type:demo:T:f1",
      },
      {
        name: "_2",
        key: { $tag: "PositionalFieldInput", index: 2 },
        semanticKey: { $tag: "PositionalField", index: 2 },
        wireName: "_2",
        token: "type:demo:T:f2",
      },
    ]);
    expect(marshalled.fields.get("type:demo:T:f0")).toBe(missing);
    expect(marshalled.fields.get("type:demo:T:f1")).toBe(named);
    expect(marshalled.fields.get("type:demo:T:f2")).toBe(positional);
    expect([...marshalled.fieldLocators]).toEqual([
      ["type:demo:T:f0", ["$record", "fields", 0]],
      ["type:demo:T:f1", ["$record", "fields", 1]],
      ["type:demo:T:f2", ["$record", "fields", 2]],
    ]);
    expect(view.fields[0]!.raw).toBe(missing.type);
    expect(view.fields[0]).not.toHaveProperty("label");
    expect(view.fields[0]).not.toHaveProperty("ui");
    expect(view.fields[0]).not.toHaveProperty("meta");

    const again = marshalTraversalDeclarationType(raw, "type:demo:T");
    expect(
      (again.type as { fields: Array<{ token: string }> }).fields.map(
        (f) => f.token,
      ),
    ).toEqual(["type:demo:T:f0", "type:demo:T:f1", "type:demo:T:f2"]);

    const param = field("_0", { $ref: "String" }, {
      $tag: "PositionalField",
      index: 0,
    });
    const arrow = marshalTraversalDeclarationType(
      { $arrow: { params: [param], returns: { $ref: "String" } } },
      "function:demo:f",
    );
    expect(
      (arrow.type as { params: unknown[] }).params[0],
    ).toMatchObject({
      $tag: "TtArrowParam",
      name: "_0",
      key: { $tag: "PositionalFieldInput", index: 0 },
      semanticKey: { $tag: "PositionalField", index: 0 },
      wireName: "_0",
      token: "function:demo:f:f0",
      raw: param.type,
    });
    expect(arrow.fields.get("function:demo:f:f0")).toBe(param);
    expect(arrow.fieldLocators.get("function:demo:f:f0")).toEqual([
      "$arrow",
      "params",
      0,
    ]);
  });

  it("surfaces Fenel-decided total-key and projection validation", () => {
    const firstKey = {
      $tag: "NamedField" as const,
      ref: { $ref: "22222222-2222-4222-8222-222222222222" },
    };
    const secondKey = {
      $tag: "NamedField" as const,
      ref: { $ref: "33333333-3333-4333-8333-333333333333" },
    };

    expect(dispatchedTraversalSemanticSlotsError({
      $record: { fields: [field("current", { $ref: "String" }, firstKey)] },
    })).toEqual({ $tag: "Nothing" });

    expect(dispatchedTraversalSemanticSlotsError({
      $record: { fields: [field("missing", { $ref: "String" })] },
    })).toMatchObject({
      $tag: "Just",
      _0: expect.stringContaining("invalid"),
    });

    expect(dispatchedTraversalSemanticSlotsError({
      $record: {
        fields: [
          field("same", { $ref: "String" }, firstKey),
          field("same", { $ref: "Number" }, secondKey),
        ],
      },
    })).toMatchObject({
      $tag: "Just",
      _0: expect.stringContaining("duplicate wire field name"),
    });

    expect(dispatchedTraversalSemanticSlotsError({
      $arrow: {
        params: [field("_1", { $ref: "String" }, {
          $tag: "PositionalField",
          index: 1,
        })],
        returns: { $ref: "String" },
      },
    })).toMatchObject({
      $tag: "Just",
      _0: expect.stringContaining("does not match ordinal 0"),
    });
  });

  it("admits only dense own-data type envelopes without invoking accessors", () => {
    const expectInvalid = (type: unknown) => {
      expect(dispatchedTraversalSemanticSlotsError(type)).toMatchObject({
        $tag: "Just",
        _0: expect.stringContaining("invalid own-data type boundary"),
      });
    };

    let getterCalls = 0;
    const accessorEnvelope = {};
    Object.defineProperty(accessorEnvelope, "$record", {
      get() {
        getterCalls += 1;
        return { fields: [] };
      },
    });
    expectInvalid(accessorEnvelope);

    const inheritedEnvelope = Object.create({ $record: { fields: [] } });
    expectInvalid(inheritedEnvelope);

    const ambiguousEnvelope = {
      $record: { fields: [] },
      $tuple: [],
    };
    expectInvalid(ambiguousEnvelope);

    const sparseTuple = new Array(1);
    expectInvalid({ $tuple: sparseTuple });

    const indexedAccessor: unknown[] = [];
    Object.defineProperty(indexedAccessor, "0", {
      get() {
        getterCalls += 1;
        return { $ref: "String" };
      },
    });
    indexedAccessor.length = 1;
    expectInvalid({ $tuple: indexedAccessor });

    const fieldWithAccessor = field("safe", { $ref: "String" }, {
      $tag: "NamedField",
      ref: { $ref: "77777777-7777-4777-8777-777777777777" },
    }) as FieldDef & { inherited?: unknown };
    Object.defineProperty(fieldWithAccessor, "name", {
      configurable: true,
      get() {
        getterCalls += 1;
        return "unsafe";
      },
    });
    expect(dispatchedTraversalSemanticSlotsError({
      $record: { fields: [fieldWithAccessor] },
    })).toMatchObject({ $tag: "Just" });

    const nonEnumerableEnvelope = {};
    Object.defineProperty(nonEnumerableEnvelope, "$record", {
      value: { fields: [] },
      enumerable: false,
    });
    expect(dispatchedTraversalSemanticSlotsError(nonEnumerableEnvelope)).toEqual({
      $tag: "Nothing",
    });
    expect(getterCalls).toBe(0);
  });

  it("returns identity-bearing field and function usage rows", () => {
    const fieldId = "44444444-4444-4444-8444-444444444444";
    const paramId = "55555555-5555-4555-8555-555555555555";
    const key = { $tag: "NamedField" as const, ref: { $ref: fieldId } };
    const paramKey = { $tag: "NamedField" as const, ref: { $ref: paramId } };

    expect(dispatchedFieldsReferencing({
      $record: {
        fields: [field("currentWire", { $ref: "Target" }, key)],
      },
    }, "Target")).toEqual([{
      $tag: "FieldUsageSlot",
      key,
      wireName: "currentWire",
    }]);

    const fn = {
      id: "demo:uses-target",
      params: [field("renamedParam", { $ref: "Target" }, paramKey)],
      returns: { $ref: "Boolean" },
    } as Parameters<typeof dispatchedFunctionUsages>[0][number]["fn"];
    expect(dispatchedFunctionUsages([{ fn }], "Target")[0]?.asParam).toEqual([{
      $tag: "FieldUsageSlot",
      key: paramKey,
      wireName: "renamedParam",
    }]);
  });

  it("keeps wrapper selection and visitor recursion Fenel-owned", () => {
    const recordKey = {
      $tag: "NamedField" as const,
      ref: { $ref: "66666666-6666-4666-8666-666666666666" },
    };
    const record = {
      $record: {
        fields: [field("renamedTarget", { $ref: "Target" }, recordKey)],
      },
    };
    const maybe = {
      $variant: {
        cases: [
          { name: "Nothing", fields: [] },
          {
            name: "Just",
            fields: [field("_0", record, {
              $tag: "PositionalField",
              index: 0,
            })],
          },
        ],
      },
    };
    const wrapped = {
      $refined: {
        base: maybe,
        set: { $tag: "SeAll" },
      },
    } as Parameters<typeof dispatchedFieldsReferencing>[0];

    expect(dispatchedFieldsReferencing(wrapped, "Target")).toEqual([{
      $tag: "FieldUsageSlot",
      key: recordKey,
      wireName: "renamedTarget",
    }]);

    const left = { $ref: "Left" } as const;
    const right = { $ref: "Right" } as const;
    const complement = { $complement: right } as const;
    const union = { $union: [left, complement] } as Parameters<typeof walkType>[0];
    const visited: unknown[] = [];
    expect(walkType(union, (node) => {
      visited.push(node);
      return node === right;
    })).toBe(true);
    expect(visited).toEqual([union, left, complement, right]);
  });

  it("exposes every declaration-semantic payload omitted by the old view", () => {
    const keys = { $tag: "SeEnum", values: ["a"] };
    const refinement = { $tag: "SeRef", handle: "Nat" };
    const raw = {
      $tuple: [
        {
          $variant: {
            discriminator: "kind",
            cases: [{ name: "One", fields: [] }],
          },
        },
        { $map: { keys, values: { $ref: "Number" } } },
        { $refined: { base: { $ref: "Number" }, set: refinement } },
        { $el: { call: ["Vec", { $ref: "a" }, 2] } },
        { $el: { dependent: { var: "n" } } },
        { $mu: { var: "r", body: { $var: "r" } } },
        { $opaque: { name: "Box", pure: { $ref: "String" } } },
      ],
    };

    const items = (marshalTraversalType(raw) as {
      items: Array<Record<string, unknown>>;
    }).items;
    expect(items[0]).toMatchObject({
      $tag: "TtVariant",
      discriminator: { $tag: "Just", _0: "kind" },
    });
    expect(items[1]).toMatchObject({ $tag: "TtMap", keys });
    expect(items[2]).toMatchObject({
      $tag: "TtRefined",
      set: refinement,
      setView: refinement,
    });
    expect(items[3]).toMatchObject({
      $tag: "TtEl",
      content: { call: ["Vec", { $ref: "a" }, 2] },
    });
    expect(items[4]).toMatchObject({
      $tag: "TtEl",
      content: { dependent: { var: "n" } },
    });
    expect(items[5]).toMatchObject({ $tag: "TtMu", var: "r" });
    expect(items[6]).toMatchObject({ $tag: "TtOpaque", name: "Box" });
  });

  it("preserves dependent call expressions without treating sibling values as types", () => {
    const closure = { __fenelFn: true, params: ["currency"], body: { $type: true }, closure: {} };
    const partial = { __fenelPartial: true, fn: { $ref: "type-function-identity" }, collected: [2], arity: 2 };
    for (const call of [
      ["countryCodeType", { var: "currency" }],
      ["vecOfLength", { $ref: "String" }, 2],
      ["vecOfLength", { var: "n" }, { $ref: "String" }],
      [{ $ref: "type-function-identity" }, { $ref: "String" }],
      [closure, { var: "currency" }],
      [partial, { $ref: "String" }],
    ]) {
      const raw = { $el: { call } };
      const projected = marshalTraversalType(raw);
      expect(projected).toEqual({ $tag: "TtEl", content: raw.$el, raw });
      expect(traversalHasHostileNode(projected)).toBe(false);
      expect(traversalHasUnknownNode(projected)).toBe(false);
    }
    const raw = { $el: { call: ["List", { $ref: "String" }] } };
    expect(marshalTraversalType(raw)).toEqual({
      $tag: "TtApp", head: "List",
      args: [{ $tag: "TtNamed", name: "String", origin: "ref", raw: { $ref: "String" } }],
      raw,
    });
  });

  it("projects a callable's dependent parameter without evaluating its type expression", () => {
    const dependent = { $el: { call: ["unavailableCountryCodeType", { var: "currency" }] } };
    const fn = {
      params: [
        field("currency", { $ref: "String" }, { $tag: "PositionalField", index: 0 }),
        field("countryCode", dependent, { $tag: "PositionalField", index: 1 }),
      ],
      returns: { $ref: "String" } as const,
    };
    expect(dispatchedFunctionArrowType(fn)).toMatchObject({
      $tag: "TtArrow",
      params: [
        { type: { $tag: "TtNamed", name: "String" } },
        { type: { $tag: "TtEl", content: dependent.$el, raw: dependent } },
      ],
    });
  });

  it("keeps dependent calls hostile when type arguments or call arrays cannot be safely read", () => {
    let reads = 0;
    const accessorType = Object.defineProperty({}, "$ref", {
      get() { reads += 1; return "String"; },
    });
    const accessorTerm = Object.defineProperty({}, "var", {
      enumerable: true,
      get() { reads += 1; return "currency"; },
    });
    const accessorCall: unknown[] = ["countryCodeType"];
    Object.defineProperty(accessorCall, "1", {
      get() { reads += 1; return { var: "currency" }; },
    });
    const sparseCall: unknown[] = ["countryCodeType"];
    sparseCall.length = 2;
    for (const call of [
      ["countryCodeType", { var: "currency" }, { $ref: 7 }],
      ["countryCodeType", { $ref: "String" }, { var: "currency" }, { $ref: "String", $type: true }],
      ["countryCodeType", { var: "currency" }, accessorType],
      ["countryCodeType", accessorTerm],
      [accessorType, { var: "currency" }],
      [{ $ref: 7 }, { var: "currency" }],
      accessorCall,
      sparseCall,
    ]) {
      expect(traversalHasHostileNode(marshalTraversalType({ $el: { call } }))).toBe(true);
    }
    expect(reads).toBe(0);
  });

  it("rejects host functions throughout dependent expression data without executing them", () => {
    let calls = 0;
    const host = () => { calls += 1; return { $type: true }; };
    const hidden = Object.defineProperty({}, "callback", { value: host });
    const symbol = { [Symbol("callback")]: host };
    const cyclic: Record<string, unknown> = { callback: host };
    cyclic.self = cyclic;
    for (const call of [
      [host, { var: "currency" }],
      ["countryCodeType", host],
      ["countryCodeType", { nested: [{ callback: host }] }],
      ["countryCodeType", { raw: { callback: host } }],
      ["countryCodeType", { $tag: "SeEnum", values: [host] }],
      ["countryCodeType", hidden],
      ["countryCodeType", symbol],
      ["countryCodeType", cyclic],
    ]) {
      const dependent = { $el: { call } };
      expect(traversalHasHostileNode(marshalTraversalType(dependent))).toBe(true);
      expect(() => dispatchedFunctionArrowType({
        params: [field("input", dependent, { $tag: "PositionalField", index: 0 })],
        returns: { $ref: "String" },
      })).toThrow("invalid own-data type boundary");
    }
    expect(calls).toBe(0);
  });

  it("carries raw and canonical phantom refinements without a TS semantic label", () => {
    const legacySet = { $enum: ["invoice", "fallback"] };
    const raw = {
      $tagged: {
        value: { $ref: "Id" },
        phantom: {
          $refined: {
            base: { $ref: "String" },
            set: legacySet,
          },
        },
      },
    };

    const view = marshalTraversalType(raw) as {
      $tag: string;
      phantom: {
        $tag: string;
        set: unknown;
        setView: unknown;
      };
    };
    expect(view.$tag).toBe("TtTagged");
    expect(view.phantom.$tag).toBe("TtRefined");
    expect(view.phantom.set).toBe(legacySet);
    expect(view.phantom.setView).toEqual({
      $tag: "SeEnum",
      values: ["invoice", "fallback"],
    });
    expect(Object.prototype.hasOwnProperty.call(view, "phantomEntity")).toBe(false);
  });

  it("rejects accessor-backed nested intervals without invoking them", () => {
    let reads = 0;
    const interval: Record<string, unknown> = {
      hi: { $tag: "Nothing" },
    };
    Object.defineProperty(interval, "lo", {
      enumerable: true,
      get() {
        reads += 1;
        return { $tag: "Nothing" };
      },
    });
    const raw = {
      $tagged: {
        value: { $ref: "Id" },
        phantom: {
          $refined: {
            base: { $ref: "String" },
            set: {
              $tag: "SeUnion",
              branches: [{ $tag: "SeInterval", interval }],
            },
          },
        },
      },
    };

    const view = marshalTraversalType(raw) as {
      $tag: string;
      phantom: { $tag: string; invalid?: boolean };
    };
    expect(view).toMatchObject({
      $tag: "TtTagged",
      phantom: { $tag: "TtUnknown", invalid: true },
    });
    expect(reads).toBe(0);
  });

  it("classifies accessor-backed SetExpr tags as malformed without invoking them", () => {
    let reads = 0;
    const set: Record<string, unknown> = {};
    Object.defineProperty(set, "$tag", {
      enumerable: true,
      get() {
        reads += 1;
        return "SeAll";
      },
    });
    const view = marshalTraversalType({
      $refined: { base: { $ref: "String" }, set },
    }) as { $tag: string; invalid?: boolean };

    expect(view).toMatchObject({ $tag: "TtUnknown", invalid: true });
    expect(traversalHasHostileNode(view)).toBe(true);
    expect(reads).toBe(0);
  });

  it("separates malformed keyless SetExpr ctors from benign unknown refinements", () => {
    const malformed = marshalTraversalType({
      $refined: {
        base: { $ref: "String" },
        set: {
          $tag: "SeCtor",
          ctor: "Box",
          fields: [{
            $tag: "SetCtorField",
            wireName: "value",
            set: { $tag: "SeAll" },
          }],
        },
      },
    }) as { $tag: string; invalid?: boolean };
    const benign = marshalTraversalType({
      $refined: {
        base: { $ref: "String" },
        set: { futureSetEncoding: true },
      },
    }) as { $tag: string; invalid?: boolean };

    expect(malformed).toMatchObject({ $tag: "TtUnknown", invalid: true });
    expect(benign).toMatchObject({ $tag: "TtUnknown", invalid: false });
    expect(traversalHasHostileNode(malformed)).toBe(true);
    expect(traversalHasHostileNode(benign)).toBe(false);
  });

  it("keeps active back-edges unknown while preserving surrounding fields", () => {
    const recursive: Record<string, unknown> = {};
    recursive.$mu = { var: "r", body: recursive };
    const outer = field("finite", recursive);
    const marshalled = marshalTraversalDeclarationType(
      { $record: { fields: [outer] } },
      "cycle",
    );
    const view = marshalled.type as {
      fields: Array<{
        token: string;
        type: { body: { $tag: string; invalid?: boolean } };
      }>;
    };
    expect(view.fields[0]!.token).toBe("cycle:f0");
    expect(view.fields[0]!.type.body.$tag).toBe("TtUnknown");
    expect(view.fields[0]!.type.body.invalid).toBe(false);
    expect(marshalled.fields.get("cycle:f0")).toBe(outer);
  });

  it("treats cyclic enum values and predicates as opaque SetExpr payloads", () => {
    const enumValue: Record<string, unknown> = {
      $tag: "TtUnknown",
      invalid: true,
    };
    enumValue.self = enumValue;
    const predicate: Record<string, unknown> = {
      $tag: "TtUnknown",
      invalid: true,
    };
    predicate.self = predicate;

    for (const set of [
      { $enum: [enumValue] },
      { $tag: "SeWhere", pred: predicate },
    ]) {
      const view = marshalTraversalType({
        $opaque: {
          name: "CyclicPayload",
          pure: {
            $refined: {
              base: { $ref: "String" },
              set,
            },
          },
        },
      });
      expect(view).toMatchObject({
        $tag: "TtOpaque",
        pure: { $tag: "TtRefined" },
      });
      expect(traversalHasHostileNode(view)).toBe(false);
      expect(traversalHasUnknownNode(view)).toBe(false);
    }
  });
});
