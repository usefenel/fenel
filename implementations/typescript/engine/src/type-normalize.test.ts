import { describe, it, expect } from "vitest";
import { normalizeFenelTypeShorthand } from "./type-normalize";
import { Maybe, List, Result, Nothing } from "./type-foundation";
describe("normalizeFenelTypeShorthand — leaves canonical input untouched", () => {
  it("plain $ref is unchanged", () => {
    const t = { $ref: "String" };
    const { value, rewrites } = normalizeFenelTypeShorthand(t);
    expect(value).toEqual(t);
    expect(rewrites).toBe(0);
  });

  it("canonical Maybe is unchanged", () => {
    const t = Maybe({ $ref: "String" });
    const { value, rewrites } = normalizeFenelTypeShorthand(t);
    expect(value).toEqual(t);
    expect(rewrites).toBe(0);
  });

  it("canonical List is unchanged", () => {
    const t = List({ $ref: "Number" });
    const { value, rewrites } = normalizeFenelTypeShorthand(t);
    expect(value).toEqual(t);
    expect(rewrites).toBe(0);
  });

  it("canonical Result is unchanged", () => {
    const t = Result({ $ref: "String" }, { $ref: "Number" });
    const { value, rewrites } = normalizeFenelTypeShorthand(t);
    expect(value).toEqual(t);
    expect(rewrites).toBe(0);
  });
});

describe("normalizeFenelTypeShorthand — rewrites shorthand", () => {
  it("rewrites a top-level `{$maybe: T}`", () => {
    const { value, rewrites } = normalizeFenelTypeShorthand({ $maybe: { $ref: "String" } });
    expect(value).toEqual(Maybe({ $ref: "String" }));
    expect(rewrites).toBe(1);
  });

  it("rewrites a top-level `{$list: T}`", () => {
    const { value, rewrites } = normalizeFenelTypeShorthand({ $list: { $ref: "Number" } });
    expect(value).toEqual(List({ $ref: "Number" }));
    expect(rewrites).toBe(1);
  });

  it("rewrites a top-level `{$result: {err, ok}}`", () => {
    const { value, rewrites } = normalizeFenelTypeShorthand({
      $result: { err: { $ref: "String" }, ok: { $ref: "Number" } },
    });
    expect(value).toEqual(Result({ $ref: "String" }, { $ref: "Number" }));
    expect(rewrites).toBe(1);
  });
});

describe("normalizeFenelTypeShorthand — nested shorthand", () => {
  it("rewrites shorthand inside a record's fields", () => {
    const before = {
      $record: {
        fields: [
          { name: "id", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing },
          { name: "label", label: Nothing, type: { $maybe: { $ref: "String" } }, meta: {}, ui: Nothing },
          { name: "tags", label: Nothing, type: { $list: { $ref: "String" } }, meta: {}, ui: Nothing },
        ],
      },
    };
    const after = {
      $record: {
        fields: [
          { name: "id", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing },
          { name: "label", label: Nothing, type: Maybe({ $ref: "String" }), meta: {}, ui: Nothing },
          { name: "tags", label: Nothing, type: List({ $ref: "String" }), meta: {}, ui: Nothing },
        ],
      },
    };
    const r = normalizeFenelTypeShorthand(before);
    expect(r.value).toEqual(after);
    expect(r.rewrites).toBe(2);
  });

  it("rewrites nested shorthand in a single pass (inner-first)", () => {
    // `{$maybe: {$list: String}}` → `Maybe(List(String))`
    const before = { $maybe: { $list: { $ref: "String" } } };
    const after = Maybe(List({ $ref: "String" }));
    const r = normalizeFenelTypeShorthand(before);
    expect(r.value).toEqual(after);
    expect(r.rewrites).toBe(2);
  });

  it("rewrites shorthand inside a function's params + returns", () => {
    // Mirrors a stored `functions.function` JSONB row.
    const before = {
      id: "demo:fn",
      params: [
        { name: "x", label: Nothing, type: { $maybe: { $ref: "Int" } }, meta: {}, ui: Nothing },
        { name: "xs", label: Nothing, type: { $list: { $ref: "String" } }, meta: {}, ui: Nothing },
      ],
      returns: { $result: { err: { $ref: "String" }, ok: { $ref: "Int" } } },
    };
    const r = normalizeFenelTypeShorthand(before);
    expect(r.rewrites).toBe(3);
    expect((r.value as any).params[0].type).toEqual(Maybe({ $ref: "Int" }));
    expect((r.value as any).params[1].type).toEqual(List({ $ref: "String" }));
    expect((r.value as any).returns).toEqual(Result({ $ref: "String" }, { $ref: "Int" }));
  });
});

describe("normalizeFenelTypeShorthand — pass-through for value-level shapes", () => {
  it("does not touch `$tag` value records", () => {
    const v = { $tag: "Just", _0: 42 };
    const r = normalizeFenelTypeShorthand(v);
    expect(r.value).toEqual(v);
    expect(r.rewrites).toBe(0);
  });

  it("does not touch a record with a `$maybe` *field name*", () => {
    // Defensive: only a SOLE `$maybe` key on an object triggers rewrite.
    // A record with `$maybe` alongside other keys is not shorthand.
    const obj = { $maybe: { $ref: "String" }, $ref: "Weird" };
    const r = normalizeFenelTypeShorthand(obj);
    expect(r.value).toEqual(obj);
    expect(r.rewrites).toBe(0);
  });

  it("walks deep into arbitrary nested JSON", () => {
    const before = {
      outer: {
        inner: [
          { type: { $list: { $ref: "X" } } },
          { type: { $ref: "Y" } },
        ],
      },
    };
    const r = normalizeFenelTypeShorthand(before);
    expect(r.rewrites).toBe(1);
    expect((r.value as any).outer.inner[0].type).toEqual(List({ $ref: "X" }));
    expect((r.value as any).outer.inner[1].type).toEqual({ $ref: "Y" });
  });
});

describe("normalizeFenelTypeShorthand — idempotence", () => {
  it("running twice yields the same result with zero rewrites the second time", () => {
    const before = {
      $record: {
        fields: [
          { name: "label", label: Nothing, type: { $maybe: { $ref: "String" } }, meta: {}, ui: Nothing },
          { name: "items", label: Nothing, type: { $list: { $ref: "Number" } }, meta: {}, ui: Nothing },
        ],
      },
    };
    const r1 = normalizeFenelTypeShorthand(before);
    const r2 = normalizeFenelTypeShorthand(r1.value);
    expect(r2.value).toEqual(r1.value);
    expect(r2.rewrites).toBe(0);
  });
});
