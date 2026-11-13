import { describe, expect, test } from "bun:test";
import {
  constrain,
  fieldIds,
  filterFields,
  flatten,
  flattenPrefixed,
  getField,
  mapFields,
  merge,
  nest,
  omit,
  partial,
  pick,
  rename,
  reorder,
  required,
  resolveFieldPaths,
  type AlgebraField,
} from "./field-algebra";
import type { FenelType, FieldKey, SetExpr } from "./types";
import { Nothing } from "./type-foundation";
import { peelMaybe } from "./set-algebra";

const A: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
};
const B: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
};
const C: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
};
const PARENT: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
};

function f(
  key: FieldKey,
  name: string,
  type: FenelType = { $ref: "Str" },
): AlgebraField {
  return { key, name, label: Nothing, type, meta: {}, ui: Nothing };
}

describe("field algebra identity plans", () => {
  test("pick/omit/get/filter address UUIDs and readable paths resolve once", () => {
    const fields = [f(A, "same"), f(B, "other")];
    expect(pick(fields, [[A]])).toEqual([fields[0]!]);
    expect(omit(fields, [[A]])).toEqual([fields[1]!]);
    expect(filterFields(fields, [[B]])).toEqual([fields[1]!]);
    expect(getField(fields, [A])).toEqual(fields[0]);
    expect(resolveFieldPaths(fields, ["same"])).toEqual([[A]]);
  });

  test("same spelling with different UUID never silently merges", () => {
    expect(() => merge([f(A, "same")], [f(B, "same")])).toThrow(
      /different semantic key/,
    );
  });

  test("rename preserves UUID; reorder preserves named UUIDs", () => {
    const fields = [f(A, "a"), f(B, "b"), f(C, "c")];
    const renamed = rename(fields, [A], "renamed");
    expect(renamed[0]!.key).toEqual(A);
    expect(renamed[0]!.name).toBe("renamed");
    const reordered = reorder(renamed, [C, A]);
    expect(reordered.map((field) => field.key)).toEqual([C, A, B]);
  });

  test("positional reorder reassigns ordinal identity to list position", () => {
    const fields = [
      f({ $tag: "PositionalField", index: 0 }, "_0", { $ref: "A" }),
      f({ $tag: "PositionalField", index: 1 }, "_1", { $ref: "B" }),
    ];
    const out = reorder(fields, [
      { $tag: "PositionalField", index: 1 },
      { $tag: "PositionalField", index: 0 },
    ]);
    expect(out.map((field) => [field.key, field.name, field.type])).toEqual([
      [{ $tag: "PositionalField", index: 0 }, "_0", { $ref: "B" }],
      [{ $tag: "PositionalField", index: 1 }, "_1", { $ref: "A" }],
    ]);
  });

  test("deep selection and constrain use key paths", () => {
    const fields = [
      f(PARENT, "parent", {
        $record: { fields: [f(A, "a"), f(B, "b")] },
      }),
    ];
    expect(pick(fields, [[PARENT, B]])).toEqual([
      f(PARENT, "parent", { $record: { fields: [f(B, "b")] } }),
    ]);
    const set: SetExpr = { $tag: "SeEnum", values: ["x"] };
    const out = constrain(fields, [PARENT, A], set);
    const parentType = out[0]!.type;
    if (!("$record" in parentType)) throw new Error("expected record");
    expect(parentType.$record.fields[0]!.type).toEqual({
      $refined: { base: { $ref: "Str" }, set },
    });
  });

  test("partial/required preserve every field key", () => {
    const fields = [f(A, "a"), f(B, "b")];
    const optional = partial(fields);
    expect(optional.map((field) => field.key)).toEqual([A, B]);
    expect(optional.every((field) => peelMaybe(field.type) !== null)).toBe(true);
    expect(required(optional)).toEqual(fields);
  });

  test("shared traversal keeps opaque field facts and rejects counterfeit Maybe", () => {
    const childMeta = {};
    const parentMeta = {};
    const child = { ...f(A, "child"), meta: childMeta };
    const parent = {
      ...f(PARENT, "parent", { $record: { fields: [child] } }),
      meta: parentMeta,
    };
    const selected = pick([parent], [[PARENT, A]]);
    expect(selected[0]!.meta).toBe(parentMeta);
    const selectedType = selected[0]!.type;
    if (!("$record" in selectedType)) throw new Error("expected record");
    expect(selectedType.$record.fields[0]!.meta).toBe(childMeta);

    const counterfeitMaybe: FenelType = {
      $variant: {
        cases: [
          { name: "Nothing", label: Nothing, fields: [] },
          {
            name: "Just",
            label: Nothing,
            fields: [f(A, "_0")],
          },
        ],
      },
    };
    const counterfeitField = f(B, "counterfeit", counterfeitMaybe);
    expect(required([counterfeitField])).toEqual([counterfeitField]);
    expect(required(partial([counterfeitField]))).toEqual([counterfeitField]);

    const malformedMaybeProjection: FenelType = {
      $variant: {
        cases: [
          { name: "Nothing", label: Nothing, fields: [] },
          {
            name: "Just",
            label: Nothing,
            fields: [f({ $tag: "PositionalField", index: 0 }, "value")],
          },
        ],
      },
    };
    const malformedField = f(B, "malformed", malformedMaybeProjection);
    expect(() => required([malformedField])).toThrow(
      /type-algebra\/fieldAlgebraRequired: invalid semantic slots:.*positional wire field name must be _0/,
    );
    expect(() => pick([malformedField], [[B]])).toThrow(
      /type-algebra\/fieldAlgebraPick: invalid semantic slots:.*positional wire field name must be _0/,
    );
  });

  test("flatten preserves child identities; explicit projection changes only wire", () => {
    const nested = f(PARENT, "parent", {
      $record: { fields: [f(A, "a"), f(B, "b")] },
    });
    expect(flatten([nested], PARENT)).toEqual([f(A, "a"), f(B, "b")]);
    expect(
      flattenPrefixed([nested], PARENT, [
        { key: A, wireName: "parent.a" },
        { key: B, wireName: "parent.b" },
      ]),
    ).toEqual([f(A, "parent.a"), f(B, "parent.b")]);
  });

  test("nest requires explicit supplied identity and mapFields requires intent", () => {
    const fields = [f(A, "a"), f(B, "b")];
    const parent = f(PARENT, "parent");
    expect(
      nest(fields, [A, B], { $tag: "MintField", field: parent }),
    ).toEqual([
      f(PARENT, "parent", { $record: { fields } }),
    ]);
    expect(() =>
      nest(fields, [A], {
        $tag: "NeedsMint",
        draft: {
          name: "parent",
          label: Nothing,
          type: { $record: { fields: [] } },
          meta: {},
          ui: Nothing,
        },
      })
    ).toThrow(/NeedsMint/);

    expect(
      mapFields(fields, [
        {
          $tag: "PreserveField",
          path: [A],
          field: f(A, "a", { $ref: "Int" }),
        },
      ]),
    ).toEqual([f(A, "a", { $ref: "Int" }), f(B, "b")]);
  });

  test("fieldIds returns semantic paths, never dotted names", () => {
    const fields = [
      f(PARENT, "parent", { $record: { fields: [f(A, "a")] } }),
    ];
    expect(fieldIds(fields, { deep: true })).toEqual([
      [PARENT],
      [PARENT, A],
    ]);
  });

  test("malformed duplicate axes and projections reject", () => {
    expect(() => pick([f(A, "a"), f(A, "b")], [[A]])).toThrow(
      /duplicate semantic field key/,
    );
    expect(() => pick([f(A, "a"), f(B, "a")], [[A]])).toThrow(
      /duplicate wire field name/,
    );
  });
});
