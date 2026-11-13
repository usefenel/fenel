import { describe, expect, test } from "bun:test";
import type { FenelType, FieldDef, FieldKey, FormDefinition } from "./types";
import type { ModuleRegistry } from "./registry";
import { Just, Nothing, Maybe } from "./type-foundation";
import type { JsonSchema } from "./json-schema";
import {
  applyJsonSchemaAuthoringPlan,
  fenelTypeToJsonSchema,
  formDefinitionToJsonSchema,
  JsonSchemaAuthoringError,
  jsonSchemaToFenelType,
  jsonSchemaToFormFields,
  jsonSchemaToSetExpr,
} from "./json-schema";
import {
  dispatchEngineBody,
  dispatchedValidationAccessPlan,
} from "./engine-bodies-dispatch";
import { validateFormFieldShim } from "./validate";
import { FieldAuthoringError } from "./field-authoring";

const FIELD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_FIELD_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MINTED_FIELD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LIST_HEAD_FIELD_ID = "ffd5bf84-d5d7-4755-a3c9-649b4adbf994";
const LIST_TAIL_FIELD_ID = "f604d45e-9b60-4b72-83ce-755d2780162c";

function namedKey(id = FIELD_ID): FieldKey {
  return { $tag: "NamedField", ref: { $ref: id } };
}

function field(name: string, key: FieldKey, type: FenelType = { $ref: "String" }): FieldDef {
  return { key, name, type, label: Nothing, ui: Nothing, meta: {} };
}

describe("JSON Schema field identity boundary", () => {
  test("rename changes only the current property projection, not semantic identity", () => {
    const before = field("oldName", namedKey());
    const after = field("newName", namedKey());
    const beforePlan = dispatchedValidationAccessPlan([before]);
    const afterPlan = dispatchedValidationAccessPlan([after]);
    expect(beforePlan.ok).toBe(true);
    expect(afterPlan.ok).toBe(true);
    if (!beforePlan.ok || !afterPlan.ok) throw new Error("plan failed");
    expect(beforePlan.fields[0]?.semanticPath).toBe(afterPlan.fields[0]?.semanticPath);

    const beforeSchema = fenelTypeToJsonSchema({ $record: { fields: [before] } });
    const afterSchema = fenelTypeToJsonSchema({ $record: { fields: [after] } });
    expect(Object.keys(beforeSchema.properties ?? {})).toEqual(["oldName"]);
    expect(Object.keys(afterSchema.properties ?? {})).toEqual(["newName"]);
    expect(JSON.stringify(afterSchema)).not.toContain(FIELD_ID);
  });

  test("required and positional properties come from the shared access plan", () => {
    const fields = [
      field("_0", { $tag: "PositionalField", index: 0 }),
      field("optional", namedKey("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), Maybe({ $ref: "String" })),
    ];
    const schema = fenelTypeToJsonSchema({ $record: { fields } });
    expect(Object.keys(schema.properties ?? {})).toEqual(["_0", "optional"]);
    expect(schema.required).toEqual(["_0"]);
  });

  test("forward property and definition maps retain prototype-hostile wire names", () => {
    const record = fenelTypeToJsonSchema({
      $record: {
        fields: [
          field("__proto__", namedKey(FIELD_ID)),
          field("constructor", namedKey(SECOND_FIELD_ID), { $ref: "Number" }),
        ],
      },
    });
    expect(Object.getPrototypeOf(record.properties)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(record.properties, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(record.properties, "constructor")).toBe(true);
    expect(record.properties?.["__proto__"]).toEqual({ type: "string" });
    expect(Reflect.get(record.properties ?? {}, "constructor")).toEqual({ type: "number" });
    expect(JSON.stringify(record)).toContain('"__proto__":{"type":"string"}');
    expect(JSON.stringify(record)).toContain('"constructor":{"type":"number"}');

    const variant = fenelTypeToJsonSchema({
      $variant: {
        discriminator: "__proto__",
        cases: [{
          name: "Hostile",
          label: Nothing,
          fields: [field("constructor", namedKey(FIELD_ID))],
        }],
      },
    });
    const variantProperties = variant.oneOf?.[0]?.properties;
    expect(Object.getPrototypeOf(variantProperties)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(variantProperties, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(variantProperties, "constructor")).toBe(true);
    expect(JSON.stringify(variant)).toContain('"__proto__":{"type":"string","const":"Hostile"}');
    expect(JSON.stringify(variant)).toContain('"constructor":{"type":"string"}');

    const matrix = fenelTypeToJsonSchema({
      $map: {
        keys: { $tag: "SeEnum", values: ["__proto__", "constructor"] },
        values: { $ref: "Boolean" },
      },
    });
    expect(Object.getPrototypeOf(matrix.properties)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(matrix.properties, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(matrix.properties, "constructor")).toBe(true);
    expect(JSON.stringify(matrix)).toContain('"__proto__":{"type":"boolean"}');
    expect(JSON.stringify(matrix)).toContain('"constructor":{"type":"boolean"}');

    const definitions = Object.create(null) as Record<string, FenelType>;
    definitions["__proto__"] = { $ref: "String" };
    const definition: FormDefinition = {
      slug: "hostile-definitions",
      type: { $record: { fields: [] } },
      $defs: definitions,
    };
    const definitionSchema = formDefinitionToJsonSchema(definition);
    expect(Object.getPrototypeOf(definitionSchema.$defs)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(definitionSchema.$defs, "__proto__")).toBe(true);
    expect(definitionSchema.$defs?.["__proto__"]).toEqual({ type: "string" });
    expect(JSON.stringify(definitionSchema)).toContain('"$defs":{"__proto__":{"type":"string"}}');
  });

  test("duplicate semantic keys are rejected before serialization", () => {
    const duplicate = namedKey();
    expect(() => fenelTypeToJsonSchema({
      $record: { fields: [field("left", duplicate), field("right", duplicate)] },
    })).toThrow(/duplicate/i);
  });

  test("Fenel forward planning selects recursive structural and atomic branches", () => {
    const identifiedList: FenelType = {
      $opaque: {
        name: "List",
        pure: {
          $variant: {
            cases: [
              { name: "Nil", label: Nothing },
              {
                name: "Cons",
                label: Nothing,
                fields: [
                  field("head", namedKey(LIST_HEAD_FIELD_ID), { $ref: "Boolean" }),
                  field("tail", namedKey(LIST_TAIL_FIELD_ID), { $ref: "List" }),
                ],
              },
            ],
          },
        },
      },
    };
    expect(fenelTypeToJsonSchema(Maybe(identifiedList))).toEqual({
      oneOf: [
        { type: "array", items: { type: "boolean" } },
        { type: "null" },
      ],
    });

    const variant = fenelTypeToJsonSchema({
      $variant: {
        discriminator: "kind",
        cases: [
          { name: "Text", label: Nothing, fields: [field("value", namedKey(), { $ref: "String" })] },
          { name: "Empty", label: Nothing, fields: [] },
        ],
      },
    });
    expect(variant.discriminator).toEqual({ propertyName: "kind" });
    expect(variant.oneOf?.[0]?.properties).toEqual({
      kind: { type: "string", const: "Text" },
      value: { type: "string" },
    });

    const matrix = fenelTypeToJsonSchema({
      $map: {
        keys: { $tag: "SeEnum", values: ["desktop", 7, "mobile"] },
        values: { $ref: "Number" },
      },
    });
    expect(Object.keys(matrix.properties ?? {})).toEqual(["desktop", "mobile"]);
    expect(matrix.required).toEqual(["desktop", "mobile"]);
    expect(matrix.properties?.desktop).toEqual({ type: "number" });
  });

  test("reverse conversion returns explicit Fenel MintField intents", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
        nested: {
          type: "object",
          properties: { name: { type: "number" } },
          required: ["name"],
        },
      },
      required: ["name"],
    } satisfies JsonSchema;
    const fields = jsonSchemaToFormFields(schema);
    expect(fields[0]?.identity).toEqual({
      $tag: "JsonSchemaMintField",
      wireName: "name",
    });
    expect(fields[0]?.required).toBe(true);
    expect(fields[1]?.typePlan.$tag).toBe("RecordType");
    expect(JSON.stringify(fields)).not.toContain('"key":');

    const typePlan = jsonSchemaToFenelType(schema);
    expect(typePlan.$tag).toBe("JsonSchemaAuthoringPlan");
    expect(typePlan.typePlan.$tag).toBe("RecordType");
  });

  test("explicit reuse is validated and no UUID entropy is minted", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
    } satisfies JsonSchema;
    const reused = jsonSchemaToFormFields(schema, {
      reuseField: () => namedKey(),
    });
    expect(reused[0]?.identity).toEqual({
      $tag: "JsonSchemaReuseField",
      key: namedKey(),
      wireName: "name",
    });
    expect(() => jsonSchemaToFormFields(schema, {
      reuseField: () => namedKey("not-a-uuid"),
    })).toThrow(/invalid explicit JSON Schema field identity/);
  });

  test("Fenel folds reverse scalar, pattern, format, interval, union, complement, and multipleOf constraints", () => {
    const set = jsonSchemaToSetExpr({
      type: "integer",
      enum: [1, 2],
      minimum: 0,
      exclusiveMaximum: 10,
      multipleOf: 0.25,
      not: { const: 3 },
      anyOf: [{ const: 1 }, { const: 2 }],
    });
    expect(set?.$tag).toBe("SeIntersect");
    if (set?.$tag !== "SeIntersect") throw new Error("expected intersected reverse constraints");
    expect(set.branches.map((branch) => branch.$tag)).toEqual([
      "SeEnum",
      "SeRef",
      "SeInterval",
      "SeWhere",
      "SeComplement",
      "SeUnion",
    ]);
    const where = set.branches.find((branch) => branch.$tag === "SeWhere");
    expect(where).toEqual({
      $tag: "SeWhere",
      pred: { call: ["isMultipleOf", { var: "value" }, 0.25, 1] },
    });

    expect(jsonSchemaToSetExpr({ type: "string", format: "email" })).toEqual({
      $tag: "SeRef",
      handle: "format:email",
    });
    expect(jsonSchemaToSetExpr({ type: "string", pattern: "^[a-z]+$" })?.$tag)
      .toBe("SePattern");
  });

  test("reverse literal codec preserves hostile own data keys without invoking accessors", () => {
    let getterCalls = 0;
    const literal = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of [
      ["$ref", "literal-not-schema-reference"],
      ["__proto__", "ordinary-data"],
      ["constructor", "ordinary-constructor"],
    ] as const) {
      Object.defineProperty(literal, key, { value, enumerable: true });
    }
    Object.defineProperty(literal, "poison", {
      get: () => {
        getterCalls += 1;
        return "not-read";
      },
      enumerable: true,
    });

    const set = jsonSchemaToSetExpr({ const: literal });
    expect(set?.$tag).toBe("SeEnum");
    if (set?.$tag !== "SeEnum") throw new Error("expected enum constraint");
    const decoded = set.values[0] as Record<string, unknown>;
    expect(Object.keys(decoded)).toEqual(["$ref", "__proto__", "constructor"]);
    expect(decoded.$ref).toBe("literal-not-schema-reference");
    expect(decoded.__proto__).toBe("ordinary-data");
    expect(decoded["constructor"]).toBe("ordinary-constructor");
    expect(getterCalls).toBe(0);
  });

  test("reverse rejects unsupported host literals before reuse or entropy", () => {
    type InvalidLiteralKind =
      | "undefined"
      | "bigint"
      | "symbol"
      | "function"
      | "sparse-array"
      | "accessor-array-index"
      | "non-finite-number"
      | "cyclic-reference";
    const expectInvalidLiteral = (
      action: () => unknown,
      kind: InvalidLiteralKind,
    ): void => {
      try {
        action();
        throw new Error(`expected ${kind} JSON literal to reject`);
      } catch (error) {
        expect(error).toBeInstanceOf(JsonSchemaAuthoringError);
        expect((error as JsonSchemaAuthoringError).issue).toMatchObject({
          code: "invalid-json-literal",
          wireName: "",
          keyToken: kind,
          message: `JSON Schema reverse: unsupported JSON literal type ${kind}`,
        });
      }
    };

    const sparseLiteral: unknown[] = [];
    sparseLiteral.length = 2;
    sparseLiteral[1] = "tail";

    let accessorArrayGetterCalls = 0;
    const accessorLiteral: unknown[] = [];
    Object.defineProperty(accessorLiteral, "0", {
      get: () => {
        accessorArrayGetterCalls += 1;
        return "not-read";
      },
      enumerable: true,
      configurable: true,
    });

    const cyclicLiteral = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(cyclicLiteral, "self", {
      value: cyclicLiteral,
      enumerable: true,
    });

    const hostileSchemas: Array<readonly [
      InvalidLiteralKind,
      JsonSchema,
    ]> = [
      ["undefined", { const: undefined }],
      ["bigint", { const: { nested: [1n] } }],
      ["symbol", { enum: [[{ nested: Symbol("not-json") }]] }],
      ["function", { enum: [{ nested: [() => "not-json"] }] }],
      ["sparse-array", { const: sparseLiteral }],
      ["accessor-array-index", { enum: [accessorLiteral] }],
      ["non-finite-number", { const: Number.NaN }],
      ["non-finite-number", { const: Number.POSITIVE_INFINITY }],
      ["non-finite-number", { const: Number.NEGATIVE_INFINITY }],
      ["cyclic-reference", { const: cyclicLiteral }],
    ];
    for (const [kind, schema] of hostileSchemas) {
      expectInvalidLiteral(() => jsonSchemaToSetExpr(schema), kind);
      expectInvalidLiteral(() => jsonSchemaToFenelType(schema), kind);

      let rejectedReuseCalls = 0;
      let rejectedMintCalls = 0;
      expectInvalidLiteral(() => applyJsonSchemaAuthoringPlan({
        type: "object",
        properties: { hostile: schema },
      }, {
        owner: {
          $tag: "TypeFieldOwner",
          module: Nothing,
          localId: `Rejected${kind}`,
        },
        availableFields: [],
        reuseField: () => {
          rejectedReuseCalls += 1;
          return undefined;
        },
        mintFieldId: () => {
          rejectedMintCalls += 1;
          return MINTED_FIELD_ID;
        },
      }), kind);
      expect(rejectedReuseCalls).toBe(0);
      expect(rejectedMintCalls).toBe(0);
    }
    expect(accessorArrayGetterCalls).toBe(0);

    let getterCalls = 0;
    let reuseCalls = 0;
    let mintCalls = 0;
    const literal = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(literal, "nested", {
      value: [{ payload: [() => "not-json"] }],
      enumerable: true,
    });
    Object.defineProperty(literal, "poison", {
      get: () => {
        getterCalls += 1;
        return 1n;
      },
      enumerable: true,
    });
    const schema = {
      type: "object",
      properties: { hostile: { const: literal } },
    } satisfies JsonSchema;
    const reuseField = (): undefined => {
      reuseCalls += 1;
      return undefined;
    };

    expectInvalidLiteral(() => jsonSchemaToFormFields(schema, { reuseField }), "function");
    expectInvalidLiteral(() => applyJsonSchemaAuthoringPlan(schema, {
      owner: {
        $tag: "TypeFieldOwner",
        module: Nothing,
        localId: "UnsupportedLiteral",
      },
      availableFields: [],
      reuseField,
      mintFieldId: () => {
        mintCalls += 1;
        return MINTED_FIELD_ID;
      },
    }), "function");
    expect(getterCalls).toBe(0);
    expect(reuseCalls).toBe(0);
    expect(mintCalls).toBe(0);
  });

  test("reverse literal codec preserves JSON-valid shared DAGs by value", () => {
    const shared = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(shared, "value", { value: 7, enumerable: true });
    const root = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(root, "left", { value: shared, enumerable: true });
    Object.defineProperty(root, "right", { value: shared, enumerable: true });

    const set = jsonSchemaToSetExpr({ const: root });
    expect(set?.$tag).toBe("SeEnum");
    if (set?.$tag !== "SeEnum") throw new Error("expected shared DAG enum constraint");
    expect(JSON.stringify(set.values[0])).toBe(
      '{"left":{"value":7},"right":{"value":7}}',
    );
  });

  test("Fenel owns list, date, required, and unique-item authoring decisions", () => {
    const plan = jsonSchemaToFenelType({
      type: "object",
      properties: {
        dates: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: { type: "string", format: "date" },
        },
      },
      required: ["dates"],
    });
    expect(plan.typePlan.$tag).toBe("RecordType");
    if (plan.typePlan.$tag !== "RecordType") throw new Error("expected record plan");
    const dates = plan.typePlan.fields[0];
    expect(dates?.required).toBe(true);
    expect(dates?.typePlan.$tag).toBe("ListType");
    if (dates?.typePlan.$tag !== "ListType") throw new Error("expected list plan");
    expect(dates.typePlan.constraint?.$tag).toBe("SeIntersect");
    if (dates.typePlan.constraint?.$tag !== "SeIntersect") {
      throw new Error("expected list constraint intersection");
    }
    expect(dates.typePlan.constraint.branches.map((branch) => branch.$tag)).toEqual([
      "SeWhere",
      "SeRef",
    ]);
    expect(dates.typePlan.constraint.branches[1]).toEqual({
      $tag: "SeRef",
      handle: "list:distinct",
    });
    expect(dates.typePlan.item).toMatchObject({
      $tag: "UseType",
      type: {
        $refined: {
          base: { $ref: "Date" },
          set: { $tag: "SePattern" },
        },
      },
    });
  });

  test("reuse callbacks retain semantic case paths and hostile property names", () => {
    const ids = [
      FIELD_ID,
      SECOND_FIELD_ID,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ];
    const properties = (...entries: Array<[string, JsonSchema]>): Record<string, JsonSchema> => {
      const result = Object.create(null) as Record<string, JsonSchema>;
      for (const [name, value] of entries) {
        Object.defineProperty(result, name, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return result;
    };
    const schema = {
      oneOf: [
        {
          type: "object",
          properties: properties(
            ["__proto__", { const: "Alpha" }],
            ["constructor", {
              type: "object",
              properties: properties(["__proto__", { type: "string" }]),
            }],
          ),
          required: ["__proto__", "constructor"],
        },
        {
          type: "object",
          properties: properties(
            ["__proto__", { const: "Beta" }],
            ["prototype", { type: "number" }],
          ),
          required: ["__proto__"],
        },
      ],
      discriminator: { propertyName: "__proto__" },
    } satisfies JsonSchema;
    const callbackPaths: string[][] = [];
    const plan = jsonSchemaToFenelType(schema, {
      reuseField: (path) => {
        callbackPaths.push([...path]);
        return namedKey(ids[callbackPaths.length - 1]);
      },
    });
    expect(callbackPaths).toEqual([
      ["case:Alpha", "constructor"],
      ["case:Alpha", "constructor", "__proto__"],
      ["case:Beta", "prototype"],
    ]);
    expect(plan.typePlan.$tag).toBe("VariantType");
    if (plan.typePlan.$tag !== "VariantType") throw new Error("expected variant plan");
    expect(plan.typePlan.discriminator).toBe("__proto__");
    expect(plan.typePlan.cases.map((variantCase) => variantCase.name)).toEqual(["Alpha", "Beta"]);
    expect(plan.typePlan.cases[0]?.fields[0]?.wireName).toBe("constructor");
    expect(plan.typePlan.cases[0]?.fields[0]?.identity.$tag).toBe("JsonSchemaReuseField");
  });

  test("reverse ingress ignores inherited/accessor properties without invoking getters", () => {
    let getterCalls = 0;
    const properties = Object.create({ inherited: { type: "string" } }) as Record<string, JsonSchema>;
    Object.defineProperty(properties, "__proto__", {
      value: { type: "string" },
      enumerable: true,
    });
    Object.defineProperty(properties, "constructor", {
      value: { type: "number" },
      enumerable: true,
    });
    Object.defineProperty(properties, "poison", {
      get: () => {
        getterCalls += 1;
        return { type: "boolean" };
      },
      enumerable: true,
    });
    const schema = { type: "object", properties } as JsonSchema;
    Object.defineProperty(schema, "minimum", {
      get: () => {
        getterCalls += 1;
        return 9;
      },
      enumerable: true,
    });
    const fields = jsonSchemaToFormFields(schema);
    expect(getterCalls).toBe(0);
    expect(fields.map((fieldPlan) => fieldPlan.wireName)).toEqual([
      "__proto__",
      "constructor",
    ]);
  });

  test("duplicate reused UUIDs and wire projections are structured Fenel failures", () => {
    const duplicateReuseSchema = {
      type: "object",
      properties: {
        first: { type: "string" },
        second: { type: "number" },
      },
    } satisfies JsonSchema;
    try {
      jsonSchemaToFormFields(duplicateReuseSchema, {
        reuseField: () => namedKey(),
      });
      throw new Error("expected duplicate reused field to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonSchemaAuthoringError);
      expect((error as JsonSchemaAuthoringError).issue).toMatchObject({
        code: "duplicate-reused-field",
        wireName: "second",
        keyToken: `n:${FIELD_ID}`,
      });
    }

    const duplicateWire = dispatchEngineBody("engine:jsonSchemaIdentityIntents", [[
      { wireName: "same", reuse: Nothing },
      { wireName: "same", reuse: Just(namedKey(SECOND_FIELD_ID)) },
    ]]) as {
      $tag: string;
      code: string;
      wireName: string;
      keyToken: string;
    };
    expect(duplicateWire).toMatchObject({
      $tag: "JsipInvalid",
      code: "duplicate-wire-projection",
      wireName: "same",
      keyToken: "",
    });
  });

  test("the authorized application edge injects mint entropy and validates every occurrence", () => {
    const schema = {
      type: "object",
      properties: {
        minted: { type: "string", title: "Minted" },
        reused: { type: "number" },
      },
      required: ["minted", "reused"],
    } satisfies JsonSchema;
    const owner = {
      $tag: "TypeFieldOwner" as const,
      module: Nothing,
      localId: "ImportedSchema",
    };
    const available = [{
      id: SECOND_FIELD_ID,
      currentCodeName: "reused",
      status: "live" as const,
      realm: "account" as const,
      reuseVisibility: "account" as const,
    }];
    const mintRequests: Array<{ path: readonly string[]; wireName: string }> = [];
    const applied = applyJsonSchemaAuthoringPlan(schema, {
      owner,
      availableFields: available,
      reuseField: (path) => path.at(-1) === "reused"
        ? namedKey(SECOND_FIELD_ID)
        : undefined,
      mintFieldId: (request) => {
        mintRequests.push(request);
        return MINTED_FIELD_ID;
      },
    });
    expect(mintRequests).toEqual([{
      path: ["minted"],
      wireName: "minted",
    }]);
    expect(applied.mintedFieldIds).toEqual([MINTED_FIELD_ID]);
    expect(applied.fields.map((item) => item.key)).toEqual([
      namedKey(MINTED_FIELD_ID),
      namedKey(SECOND_FIELD_ID),
    ]);
    expect(applied.drafts.map((draft) => ({
      fieldId: draft.fieldId,
      codeName: draft.codeName,
    }))).toEqual([
      { fieldId: MINTED_FIELD_ID, codeName: "minted" },
      { fieldId: SECOND_FIELD_ID, codeName: "reused" },
    ]);
    expect(applied.type).toEqual({
      $record: { fields: [...applied.fields] },
    });

    try {
      applyJsonSchemaAuthoringPlan({
        type: "object",
        properties: { bad: { type: "string" } },
      }, {
        owner,
        availableFields: [],
        mintFieldId: () => "not-a-uuid",
      });
      throw new Error("expected invalid entropy to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(FieldAuthoringError);
      expect((error as FieldAuthoringError).diagnostic.$tag).toBe("InvalidFieldDraftUuid");
    }

    try {
      applyJsonSchemaAuthoringPlan({
        type: "object",
        properties: { reused: { type: "string" } },
      }, {
        owner,
        availableFields: [],
        reuseField: () => namedKey(SECOND_FIELD_ID),
        mintFieldId: () => {
          throw new Error("reuse must not request entropy");
        },
      });
      throw new Error("expected unavailable reuse to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(FieldAuthoringError);
      expect((error as FieldAuthoringError).diagnostic.$tag).toBe("MissingReusedField");
    }

    try {
      applyJsonSchemaAuthoringPlan({
        type: "object",
        properties: {
          first: { type: "string" },
          second: { type: "string" },
        },
      }, {
        owner,
        availableFields: [],
        mintFieldId: () => MINTED_FIELD_ID,
      });
      throw new Error("expected duplicate entropy to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(FieldAuthoringError);
      expect((error as FieldAuthoringError).diagnostic.$tag).toBe("InvalidFieldDraftUuid");
    }
  });
});

describe("single-field validation current-wire boundary", () => {
  test("a Codeable rename controls singleton input, output, and diagnostic paths", () => {
    const currentWireName = "currentAmount";
    const registry = {
      getFieldRepresentation: (typeName: string, fieldId: string) =>
        typeName === "Codeable" && fieldId === FIELD_ID
          ? {
              typeName: "Codeable",
              args: [FIELD_ID],
              methods: { codeName: currentWireName },
            }
          : undefined,
      resolveFieldPresentation: () => ({
        label: "Current amount",
        source: "uuid-field-facet",
      }),
    } as unknown as ModuleRegistry;
    const staleDeclaration = field("legacyAmount", namedKey(), { $ref: "Number" });

    const normalized = validateFormFieldShim(
      staleDeclaration,
      "42",
      `invoice.${currentWireName}`,
      {},
      {}, null,
      {},
      undefined,
      registry,
    );
    expect(normalized.errors).toEqual([]);
    expect(normalized.value).toBe(42);

    const invalid = validateFormFieldShim(
      staleDeclaration,
      "not-a-number",
      `invoice.${currentWireName}`,
      {},
      {}, null,
      {},
      undefined,
      registry,
    );
    expect(invalid.errors).toEqual([{
      path: `invoice.${currentWireName}`,
      message: "Must be a number",
    }]);

    const expressionRegistry = {
      ...registry,
      resolveFieldPresentation: () => ({
        label: "Current amount",
        display: { widget: Just("string-expression") },
        source: "uuid-field-facet",
      }),
    } as unknown as ModuleRegistry;
    const expressionSource = validateFormFieldShim(
      staleDeclaration,
      "not-a-number",
      `invoice.${currentWireName}`,
      {},
      {}, null,
      {},
      undefined,
      expressionRegistry,
    );
    expect(expressionSource).toEqual({ errors: [], value: "not-a-number" });
  }, 30_000);
});
