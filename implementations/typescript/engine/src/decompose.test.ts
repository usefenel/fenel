import { describe, it, expect } from "vitest";
import { registerDecomposeParser, getDecomposeParser, matchesShape } from "./decompose";
import type { FenelType, FieldDef, FieldKey } from "./types";
import { List, Maybe, Nothing } from "./type-foundation";

const fieldIds = {
  listHead: "ffd5bf84-d5d7-4755-a3c9-649b4adbf994",
  listTail: "f604d45e-9b60-4b72-83ce-755d2780162c",
  root: "11111111-1111-4111-8111-111111111111",
  segments: "22222222-2222-4222-8222-222222222222",
  name: "33333333-3333-4333-8333-333333333333",
  age: "44444444-4444-4444-8444-444444444444",
  proto: "55555555-5555-4555-8555-555555555555",
  constructor: "66666666-6666-4666-8666-666666666666",
  toString: "77777777-7777-4777-8777-777777777777",
} as const;

function namedFieldKey(id: string): FieldKey {
  return { $tag: "NamedField", ref: { $ref: id } };
}

function field(name: string, type: FenelType, id: string): FieldDef {
  return {
    name,
    key: namedFieldKey(id),
    label: Nothing,
    type,
    meta: {},
    ui: Nothing,
  };
}

/** Positive semantic-boundary fixture for the repository List declaration.
 * The public `List(a)` authoring helper intentionally remains keyless; the
 * repository registry owns this lock-derived projection in production. */
function identifiedList(element: FenelType): FenelType {
  return {
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
                field("head", element, fieldIds.listHead),
                field("tail", { $ref: "List" }, fieldIds.listTail),
              ],
            },
          ],
        },
      },
    },
  };
}
// ---------------------------------------------------------------------------
// matchesShape — best-effort structural check
// ---------------------------------------------------------------------------

describe("matchesShape — atoms and basic shapes", () => {
  it("$void rejects everything", () => {
    expect(matchesShape({}, { $void: true })).toBe(false);
  });

  it("$unit accepts null/undefined/empty record", () => {
    expect(matchesShape(null, { $unit: true })).toBe(true);
    expect(matchesShape(undefined, { $unit: true })).toBe(true);
    expect(matchesShape({}, { $unit: true })).toBe(true);
    expect(matchesShape({ x: 1 }, { $unit: true })).toBe(false);
    expect(matchesShape({ $tag: "NotAnEmptyObject" }, { $unit: true })).toBe(false);
  });

  it("List accepts arrays only", () => {
    expect(matchesShape([1, 2, 3], identifiedList({ $ref: "Number" }))).toBe(true);
    expect(matchesShape("not array", identifiedList({ $ref: "Number" }))).toBe(false);
  });

  it("rejects the raw keyless List authoring shape at the semantic boundary", () => {
    expect(() => matchesShape([], List({ $ref: "Number" }))).toThrow(
      /field-identity semantic boundary \(matchesShape\)/,
    );
  });

  it("$tuple checks length and per-element shape", () => {
    const t: FenelType = { $tuple: [{ $ref: "String" }, { $ref: "Number" }] };
    expect(matchesShape(["x", 1], t)).toBe(true);
    expect(matchesShape(["x", 1, 2], t)).toBe(false);
    expect(matchesShape(["x"], t)).toBe(false);
  });
});

describe("matchesShape — $variant", () => {
  const Path: FenelType = {
    $variant: {
      cases: [
        { name: "AbsolutePath", label: Nothing, fields: [field("root", { $ref: "String" }, fieldIds.root), field("segments", identifiedList({ $ref: "String" }), fieldIds.segments)] },
        { name: "RelativePath", label: Nothing, fields: [field("segments", identifiedList({ $ref: "String" }), fieldIds.segments)] },
      ],
    },
  };

  it("matches a value with a valid __case tag", () => {
    expect(matchesShape({ __case: "AbsolutePath", root: "/", segments: ["usr", "bin"] }, Path)).toBe(true);
    expect(matchesShape({ __case: "RelativePath", segments: ["foo"] }, Path)).toBe(true);
  });

  it("accepts $tag as alternative discriminator", () => {
    expect(matchesShape({ $tag: "RelativePath", segments: [] }, Path)).toBe(true);
  });

  it("rejects unknown case tag", () => {
    expect(matchesShape({ __case: "UnknownPath", segments: [] }, Path)).toBe(false);
  });

  it("rejects when required fields are missing", () => {
    expect(matchesShape({ __case: "AbsolutePath", root: "/" }, Path)).toBe(false); // segments missing
  });
});

describe("matchesShape — $record", () => {
  const Person: FenelType = {
    $record: {
      fields: [
        field("name", { $ref: "String" }, fieldIds.name),
        field("age", Maybe({ $ref: "Number" }), fieldIds.age),
      ],
    },
  };

  it("requires all non-maybe fields", () => {
    expect(matchesShape({ name: "Alice", age: 30 }, Person)).toBe(true);
    expect(matchesShape({ name: "Alice" }, Person)).toBe(true); // age is $maybe
    expect(matchesShape({ age: 30 }, Person)).toBe(false);     // name missing
  });

  it("rejects non-objects", () => {
    expect(matchesShape("Alice", Person)).toBe(false);
    expect(matchesShape([], Person)).toBe(false);
  });
});

describe("matchesShape — descriptor-safe semantic boundary", () => {
  const Person: FenelType = {
    $record: {
      fields: [field("name", { $ref: "String" }, fieldIds.name)],
    },
  };

  it("does not invoke inherited or accessor type structure", () => {
    let inheritedReads = 0;
    const prototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(prototype, "$record", {
      enumerable: true,
      get() {
        inheritedReads += 1;
        return { fields: [] };
      },
    });
    const inherited = Object.create(prototype) as FenelType;
    expect(() => matchesShape({ name: "Alice" }, inherited)).toThrow(
      /semantic boundary \(matchesShape\)/,
    );
    expect(inheritedReads).toBe(0);

    let accessorReads = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "$record", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return { fields: [] };
      },
    });
    expect(() => matchesShape({}, accessor as FenelType)).toThrow(
      /semantic boundary \(matchesShape\)/,
    );
    expect(accessorReads).toBe(0);
  });

  it("reads only enumerable own-data value fields and discriminators", () => {
    let fieldReads = 0;
    const accessorValue = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessorValue, "name", {
      enumerable: true,
      get() {
        fieldReads += 1;
        return "Alice";
      },
    });
    expect(matchesShape(accessorValue, Person)).toBe(false);
    expect(fieldReads).toBe(0);

    let inheritedTagReads = 0;
    const taggedPrototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(taggedPrototype, "$tag", {
      enumerable: true,
      get() {
        inheritedTagReads += 1;
        return "Only";
      },
    });
    const inheritedTag = Object.assign(Object.create(taggedPrototype), { name: "Alice" });
    const Only: FenelType = {
      $variant: {
        cases: [{ name: "Only", label: Nothing, fields: [field("name", { $ref: "String" }, fieldIds.name)] }],
      },
    };
    expect(matchesShape(inheritedTag, Only)).toBe(false);
    expect(inheritedTagReads).toBe(0);
  });

  it("keeps hostile current-wire names as data, not object mechanics", () => {
    const hostileType: FenelType = {
      $record: {
        fields: [
          field("__proto__", { $ref: "String" }, fieldIds.proto),
          field("constructor", { $ref: "String" }, fieldIds.constructor),
          field("toString", { $ref: "String" }, fieldIds.toString),
        ],
      },
    };
    const hostileValue = Object.create(null) as Record<string, unknown>;
    hostileValue["__proto__"] = "proto";
    hostileValue["constructor"] = "ctor";
    hostileValue["toString"] = "stringer";
    expect(matchesShape(hostileValue, hostileType)).toBe(true);
    expect(matchesShape({}, hostileType)).toBe(false);
  });

  it("does not invoke sparse/accessor array members and terminates on cycles", () => {
    let indexReads = 0;
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, "0", {
      enumerable: true,
      configurable: true,
      get() {
        indexReads += 1;
        return 1;
      },
    });
    Object.defineProperty(accessorArray, "length", { value: 1 });
    expect(matchesShape(accessorArray, identifiedList({ $ref: "Number" }))).toBe(true);
    expect(indexReads).toBe(0);

    const cyclic = Object.create(null) as Record<string, unknown>;
    cyclic["name"] = cyclic;
    expect(matchesShape(cyclic, Person)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Parser registry — direct surface tests
//
// The `$decompose` SetExpr constructor retired in Phase 3 of the
// implementation roadmap (see set-algebra.ts § Phase 3 note + design/
// structural-introspection.md Instance 2). The parser registry remains
// as the data layer for future `Decodable<String, T>` typeclass instances;
// the tests below verify the registry's lookup mechanics directly so the
// scope semantics it carries are still exercised. The previous
// SetExpr-integration tests are gone — there's no `$decompose` to dispatch
// through.
// ---------------------------------------------------------------------------

describe("decompose parser registry", () => {
  it("returns undefined when parser is not registered", () => {
    expect(getDecomposeParser("nonExistent")).toBeUndefined();
  });

  it("parsed result drives downstream shape checks", () => {
    registerDecomposeParser("intParser", (input) => {
      const n = Number(input);
      if (Number.isFinite(n)) return { ok: true, value: n };
      return { ok: false, error: "not a number" };
    });
    const parser = getDecomposeParser("intParser");
    expect(parser).toBeTruthy();
    expect(parser?.("42")).toEqual({ ok: true, value: 42 });
    expect(parser?.("xyz").ok).toBe(false);
    // The retired `$decompose` constructor would have applied matchesShape
    // against a target type here. The same composition is now expressible
    // as: parse + matchesShape, called explicitly by the caller.
    const parsed = parser?.("42");
    if (parsed && parsed.ok) {
      expect(matchesShape(parsed.value, { $ref: "Number" })).toBe(true);
    }
  });

  it("parser-then-shape-match composes against a structured target type", () => {
    // Toy parser: split on "/", produce { __case, segments }
    registerDecomposeParser("parsePath", (input) => {
      if (typeof input !== "string" || input.length === 0) {
        return { ok: false, error: "empty" };
      }
      if (input.startsWith("/")) {
        return {
          ok: true,
          value: {
            __case: "AbsolutePath",
            root: "/",
            segments: input.slice(1).split("/").filter(Boolean),
          },
        };
      }
      return {
        ok: true,
        value: {
          __case: "RelativePath",
          segments: input.split("/").filter(Boolean),
        },
      };
    });

    const Path: FenelType = {
      $variant: {
        cases: [
          { name: "AbsolutePath", label: Nothing, fields: [field("root", { $ref: "String" }, fieldIds.root), field("segments", identifiedList({ $ref: "String" }), fieldIds.segments)] },
          { name: "RelativePath", label: Nothing, fields: [field("segments", identifiedList({ $ref: "String" }), fieldIds.segments)] },
        ],
      },
    };

    const parser = getDecomposeParser("parsePath")!;
    const r1 = parser("/usr/local/bin");
    expect(r1.ok && matchesShape(r1.value, Path)).toBe(true);
    const r2 = parser("relative/path");
    expect(r2.ok && matchesShape(r2.value, Path)).toBe(true);
    expect(parser("").ok).toBe(false);
    expect(parser(42).ok).toBe(false);
  });
});
