import { describe, expect, test } from "bun:test";
import {
  extendType,
  freeze,
  isDisjointType,
  mergeType,
  omitType,
  pickType,
  recordToTuple,
  renameType,
  resolveTypeFieldPaths,
  thaw,
  tupleToRecord,
  untaggedToVariant,
  type AlgebraField,
  type FieldCreationIntent,
} from "./type-algebra";
import type { FenelType, FieldDef, FieldKey } from "./types";
import { Nothing } from "./type-foundation";

const NAME_KEY: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "11111111-1111-4111-8111-111111111111" },
};
const AGE_KEY: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "22222222-2222-4222-8222-222222222222" },
};
const EMAIL_KEY: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "33333333-3333-4333-8333-333333333333" },
};
const PHONE_KEY: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "44444444-4444-4444-8444-444444444444" },
};

function field(
  key: FieldKey,
  name: string,
  type: FenelType = { $ref: "Str" },
): AlgebraField {
  return { key, name, label: Nothing, type, meta: {}, ui: Nothing };
}

function record(fields: AlgebraField[]): FenelType {
  return { $record: { fields } };
}

function keylessField(name: string, type: FenelType): FieldDef {
  return { name, label: Nothing, type, meta: {}, ui: Nothing };
}

const Person = record([
  field(NAME_KEY, "name"),
  field(AGE_KEY, "age", { $ref: "Nat" }),
  field(EMAIL_KEY, "email"),
]);

describe("identity-total type algebra", () => {
  test("pick/omit address fields by key, independent of current spelling", () => {
    const renamed = renameType(Person, [EMAIL_KEY], "contact");
    expect(pickType(renamed, [[EMAIL_KEY]])).toEqual(
      record([field(EMAIL_KEY, "contact")]),
    );
    expect(omitType(renamed, [[AGE_KEY]])).toEqual(
      record([field(NAME_KEY, "name"), field(EMAIL_KEY, "contact")]),
    );
  });

  test("current-wire paths resolve once to FieldKey paths", () => {
    expect(resolveTypeFieldPaths(Person, ["email", "name"])).toEqual([
      [EMAIL_KEY],
      [NAME_KEY],
    ]);
    expect(() => resolveTypeFieldPaths(Person, ["missing"])).toThrow(
      /does not resolve/,
    );
  });

  test("deep paths carry keys through nested records", () => {
    const addressKey: FieldKey = {
      $tag: "NamedField",
      ref: { $ref: "55555555-5555-4555-8555-555555555555" },
    };
    const cityKey: FieldKey = {
      $tag: "NamedField",
      ref: { $ref: "66666666-6666-4666-8666-666666666666" },
    };
    const type = record([
      field(
        addressKey,
        "address",
        record([field(cityKey, "city"), field(EMAIL_KEY, "email")]),
      ),
    ]);
    expect(resolveTypeFieldPaths(type, ["address.city"])).toEqual([
      [addressKey, cityKey],
    ]);
    expect(pickType(type, [[addressKey, cityKey]])).toEqual(
      record([
        field(addressKey, "address", record([field(cityKey, "city")])),
      ]),
    );
  });

  test("merge matches UUID, not wire name", () => {
    const override = record([field(AGE_KEY, "age", { $ref: "Int" })]);
    const merged = mergeType(Person, override);
    expect((merged as Extract<FenelType, { $record: unknown }>).$record.fields[1])
      .toEqual(field(AGE_KEY, "age", { $ref: "Int" }));

    const otherKey: FieldKey = {
      $tag: "NamedField",
      ref: { $ref: "77777777-7777-4777-8777-777777777777" },
    };
    expect(() =>
      mergeType(Person, record([field(otherKey, "age")]))
    ).toThrow(/different semantic key/);
    expect(() =>
      mergeType(Person, record([field(AGE_KEY, "years")]))
    ).toThrow(/conflicting wire projections/);
  });

  test("extend requires explicit preserve/reuse/mint intent", () => {
    const reused = field(PHONE_KEY, "phone");
    expect(
      extendType(Person, [
        { $tag: "ReuseField", path: [PHONE_KEY], field: reused },
      ]),
    ).toEqual(
      record([
        field(NAME_KEY, "name"),
        field(AGE_KEY, "age", { $ref: "Nat" }),
        field(EMAIL_KEY, "email"),
        reused,
      ]),
    );
    expect(() =>
      extendType(Person, [
        {
          $tag: "NeedsMint",
          path: [],
          draft: {
            name: "phone",
            label: Nothing,
            type: { $ref: "Str" },
            meta: {},
            ui: Nothing,
          },
        },
      ])
    ).toThrow(/NeedsMint/);
    expect(() =>
      extendType(Person, [
        {
          $tag: "MintField",
          path: [AGE_KEY],
          field: field(AGE_KEY, "age"),
        },
      ])
    ).toThrow(/mint key already exists/);
  });

  test("rename changes only the projection and preserves key", () => {
    const renamed = renameType(Person, [EMAIL_KEY], "contact");
    const fields = thaw(renamed);
    expect(fields[2]!.key).toEqual(EMAIL_KEY);
    expect(fields[2]!.name).toBe("contact");
    expect(resolveTypeFieldPaths(renamed, ["contact"])).toEqual([[EMAIL_KEY]]);
    expect(() => renameType(Person, [EMAIL_KEY], "age")).toThrow(
      /duplicate wire field name/,
    );
  });

  test("freeze/thaw use ordered key entries, not a name-keyed Map", () => {
    const entries = [
      field(NAME_KEY, "name"),
      field(AGE_KEY, "age", { $ref: "Nat" }),
    ];
    expect(thaw(freeze(entries))).toEqual(entries);
  });

  test("freeze/thaw route identity validation through the Fenel body", () => {
    expect(() => freeze([
      field(NAME_KEY, "name"),
      field(NAME_KEY, "renamed"),
    ])).toThrow(/duplicate (?:semantic )?field key/);
    expect(() => freeze([
      field(NAME_KEY, "same"),
      field(AGE_KEY, "same"),
    ])).toThrow(/duplicate wire field name/);
    expect(() => thaw({
      $record: {
        fields: [{
          name: "name",
          label: Nothing,
          type: { $ref: "Str" },
          meta: {},
          ui: Nothing,
        }],
      },
    })).toThrow(/invalid named field/);
  });

  test("tuple bridge produces positional identity-total fields", () => {
    const tuple: FenelType = {
      $tuple: [{ $ref: "Int" }, { $ref: "Str" }],
    };
    expect(tupleToRecord(tuple)).toEqual({
      $record: {
        fields: [
          field({ $tag: "PositionalField", index: 0 }, "_0", {
            $ref: "Int",
          }),
          field({ $tag: "PositionalField", index: 1 }, "_1", {
            $ref: "Str",
          }),
        ],
      },
    });
    expect(recordToTuple(tupleToRecord(tuple))).toEqual(tuple);
  });

  test("Fenel owns algebra root-shape diagnostics", () => {
    expect(() => pickType({ $tuple: [] }, [])).toThrow(
      /type-algebra\/pickType: expected \$record, got \$tuple/,
    );
    expect(() => tupleToRecord(record([]))).toThrow(
      /type-algebra\/tupleToRecord: expected \$tuple, got \$record/,
    );
  });

  test("every algebra root rejects semantic-slot defects hidden below opaque algebra branches", () => {
    const variantWithKeylessPayload: FenelType = {
      $variant: {
        cases: [{
          name: "Broken",
          label: Nothing,
          fields: [keylessField("payload", { $ref: "Str" })],
        }],
      },
    };
    const arrowWithKeylessParam: FenelType = {
      $arrow: {
        params: [keylessField("argument", { $ref: "Str" })],
        returns: { $ref: "Str" },
      },
    };
    const malformedMaybeProjection: FenelType = {
      $variant: {
        cases: [
          { name: "Nothing", label: Nothing, fields: [] },
          {
            name: "Just",
            label: Nothing,
            fields: [{
              ...field({ $tag: "PositionalField", index: 0 }, "value"),
            }],
          },
        ],
      },
    };

    expect(() => pickType(
      record([field(NAME_KEY, "value", variantWithKeylessPayload)]),
      [[NAME_KEY]],
    )).toThrow(
      /type-algebra\/pickType: invalid semantic slots:.*variant case Broken:.*invalid/,
    );
    expect(() => freeze([
      field(NAME_KEY, "value", arrowWithKeylessParam),
    ])).toThrow(
      /type-algebra\/freezeTypeFields: invalid semantic slots:.*arrow params:.*invalid/,
    );
    expect(() => thaw(record([
      field(NAME_KEY, "value", variantWithKeylessPayload),
    ]))).toThrow(
      /type-algebra\/thawTypeFields: invalid semantic slots:.*variant case Broken:.*invalid/,
    );
    expect(() => tupleToRecord({
      $tuple: [arrowWithKeylessParam],
    })).toThrow(
      /type-algebra\/tupleToRecord: invalid semantic slots:.*arrow params:.*invalid/,
    );
    expect(() => recordToTuple(record([
      field(NAME_KEY, "value", malformedMaybeProjection),
    ]))).toThrow(
      /type-algebra\/recordToTuple: invalid semantic slots:.*positional wire field name must be _0/,
    );
    expect(() => tupleToRecord({
      $tuple: [malformedMaybeProjection],
    })).toThrow(
      /type-algebra\/tupleToRecord: invalid semantic slots:.*positional wire field name must be _0/,
    );
  });

  test("unresolved fields are rejected instead of inferred from names", () => {
    const keyless: FenelType = {
      $record: {
        fields: [
          {
            name: "name",
            label: Nothing,
            type: { $ref: "Str" },
            meta: {},
            ui: Nothing,
          },
        ],
      },
    };
    expect(() => pickType(keyless, [[NAME_KEY]])).toThrow(/invalid/);
  });
});

describe("adjacent type algebra", () => {
  test("disjoint delegates unchanged", () => {
    expect(isDisjointType({ $void: true }, { $ref: "Str" })).toBe(true);
  });

  test("untagged variants require explicit payload occurrence intent", () => {
    const payload = (
      key: FieldKey,
      type: FenelType,
    ): FieldCreationIntent => ({
      $tag: "MintField",
      field: field(key, "value", type),
    });
    const result = untaggedToVariant([
      {
        type: { $ref: "Int" },
        payload: payload(NAME_KEY, { $ref: "Int" }),
      },
      {
        type: { $ref: "String" },
        payload: payload(EMAIL_KEY, { $ref: "String" }),
      },
    ]);
    expect("ok" in result).toBe(true);
    if (!("ok" in result) || !("$variant" in result.ok)) return;
    expect(result.ok.$variant.cases[0]!.fields?.[0]?.key).toEqual(NAME_KEY);
    expect(result.ok.$variant.cases[1]!.fields?.[0]?.key).toEqual(EMAIL_KEY);
  });

  test("untagged variant reports NeedsMint rather than minting", () => {
    const result = untaggedToVariant([
      {
        type: { $ref: "Int" },
        payload: {
          $tag: "NeedsMint",
          draft: {
            name: "value",
            label: Nothing,
            type: { $ref: "Int" },
            meta: {},
            ui: Nothing,
          },
        },
      },
      {
        type: { $ref: "String" },
        payload: {
          $tag: "ReuseField",
          field: field(EMAIL_KEY, "value", { $ref: "String" }),
        },
      },
    ]);
    expect(result).toEqual({ err: expect.stringMatching(/NeedsMint/) });
  });
});
