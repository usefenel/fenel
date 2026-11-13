import { describe, expect, test } from "bun:test";
import type { FenelType, SetExpr } from "./types";
import { fenelTypeToJsonWire, peelSetExpr, setExprToJsonWire, setExprToTag } from "./set-marker";

const repeated = {
  $tag: "SePattern",
  pattern: { t: "rep", child: { t: "match", pred: { $tag: "SeEnum", values: ["a"] } }, min: 0, max: Infinity },
} satisfies SetExpr;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("unbounded pattern JSON boundary", () => {
  test("unbounded maximum survives storage as a schema-local token", () => {
    const stored = json(setExprToJsonWire(repeated));
    expect(stored.pattern.max).toBe("unbounded");
    expect(setExprToTag(stored)).toEqual(repeated);
    expect(setExprToJsonWire(stored)).toEqual(stored);
    expect(repeated.pattern.max).toBe(Infinity);
  });

  test("nested constraints and typed captures retain their bounds and field identity", () => {
    const set: SetExpr = { $tag: "SeMu", var: "X", body: {
      $tag: "SeArrow", params: [{ $tag: "SetArrowParam", key: { $tag: "PositionalField", index: 0 }, wireName: "input", set: repeated }],
      returns: { $tag: "SeCtor", ctor: "Result", fields: [{
        $tag: "SetCtorField", key: { $tag: "NamedField", ref: { $ref: "00000000-0000-4000-8000-000000000001" } }, wireName: "value",
        set: { $tag: "SePattern", pattern: { t: "group", name: "capture", child: repeated.pattern, type: repeated } },
      }] },
    } };
    expect(setExprToTag(json(setExprToJsonWire(set)))).toEqual(set);
  });

  test("null and unknown strings are never silently promoted to unbounded", () => {
    for (const max of [null, "inf", "Infinity", "∞"]) {
      expect(peelSetExpr({ ...repeated, pattern: { ...repeated.pattern, max } })).toBeNull();
    }
    const bounded = { ...repeated, pattern: { ...repeated.pattern, max: -1 } };
    expect(setExprToTag(json(setExprToJsonWire(bounded)))).toEqual(bounded);
  });

  test("type projection reaches nested occurrence types without rewriting arbitrary metadata", () => {
    const legacyMeta = { literalPattern: { t: "rep", max: "unbounded" } };
    const type = { $record: { fields: [{
      name: "items", key: { $tag: "PositionalField", index: 0 }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" },
      // This codec must preserve opaque legacy slots even though new field
      // authoring no longer emits metadata entries.
      meta: legacyMeta,
      type: { $refined: { base: { $ref: "String" }, set: repeated } },
    }] } };
    const stored = json(fenelTypeToJsonWire(type as unknown as FenelType));
    expect(stored.$record.fields[0].type.$refined.set.pattern.max).toBe("unbounded");
    expect(stored.$record.fields[0].meta).toEqual(type.$record.fields[0]!.meta);
    expect(setExprToTag(stored.$record.fields[0].type.$refined.set)).toEqual(repeated);
  });
});
