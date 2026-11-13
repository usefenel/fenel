// ---------------------------------------------------------------------------
// typed-ref-entity-consumers.test.ts — typed-function-references Phase 7e proof.
//
// 7e folds the PERIPHERAL FP-entity consumers — the inference / JSON-Schema
// export / widget-hint / default-value / printer code that does its OWN
// `"$ref" in t` read of an ENTITY code-name (not routed through a 7f
// recognizer) — so each treats a type-position `{$ref}` IDENTICALLY to the
// `{$ref}` it folds. Two fold kinds:
//   • resolve-to-TYPE (validate's `:582` entity catalog resolve) — `refType` +
//     `getEntityTypeByName`, recurse.
//   • resolve-to-NAME (json-schema / widget-hint / field-meta / both printers) —
//     the handle is a code-name (D3); rewrite `{$ref:H}`→`{$ref:H}` and run the
//     unchanged path. Byte-identical for ANY handle BY CONSTRUCTION.
//
// Purely additive: no producer emits a type `{$ref}` until 7g, so every folded
// branch is dead code for the current corpus — it lights up only here.
//
// Non-brittle (Phase-6 leak lesson): a CONTROLLED entity registered via
// `registerCatalogEntities` under BOTH its code-name AND a controlled UUID (a
// test-local mirror of 7d's registry-by-UUID wiring), never the global catalog.
//
// Canonical spec: design/typed-function-references.md § "The type-layer merge".
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { Ref, List } from "./type-foundation";
import { registerCatalogEntities, getEntityTypeByName } from "./type-catalog";
import { validate } from "./validate";
import { fenelTypeToJsonSchema } from "./json-schema";
import { widgetForType } from "./widget-hint";
import { defaultValueFor, channelsFor, type DefaultRegistry } from "./field-meta";
import { printType } from "./engine-bodies-dispatch";
import { printEntityDef } from "./entity-def-printer";
import type { FenelType } from "./types";

// A controlled entity — a 2-field record. Registered under its code-name AND a
// controlled v4-shaped UUID, so a UUID `{$ref}` resolves to the SAME type a
// code-name `{$ref}` does (the 7d identity, threaded through the catalog).
const ENTITY_NAME = "ConsumerEntity7e";
const ENTITY_UUID = "7e000000-0000-4000-8000-000000000001";
const field = (name: string, type: FenelType) =>
  ({ name, label: { $tag: "Nothing" }, type, default: { $tag: "Nothing" }, meta: {}, ui: { $tag: "Nothing" } }) as unknown;
const ENTITY_TYPE: FenelType = {
  $record: {
    fields: [
      field("name", { $ref: "String" } as FenelType),
      field("age", { $ref: "Number" } as FenelType),
    ],
  },
} as unknown as FenelType;

registerCatalogEntities([
  { id: ENTITY_NAME, type: ENTITY_TYPE },
  { id: ENTITY_UUID, type: ENTITY_TYPE },
]);

const NAMED = { $ref: ENTITY_NAME } as unknown as FenelType;
const REF = Ref(ENTITY_NAME) as unknown as FenelType;
const NAMED_UUID = { $ref: ENTITY_UUID } as unknown as FenelType;
const REF_UUID = Ref(ENTITY_UUID) as unknown as FenelType;
const MISS_NAMED = { $ref: "DefinitelyNotAnEntity7e" } as unknown as FenelType;
const MISS_REF = Ref("DefinitelyNotAnEntity7e") as unknown as FenelType;

describe("Phase 7e — the test entity resolves (catalog wired for both handles)", () => {
  test("getEntityTypeByName resolves the code-name AND the controlled UUID", () => {
    expect(getEntityTypeByName(ENTITY_NAME)).toEqual(ENTITY_TYPE);
    expect(getEntityTypeByName(ENTITY_UUID)).toEqual(ENTITY_TYPE);
  });
});

describe("Phase 7e — validate (resolve-to-TYPE): {$ref} === {$ref}", () => {
  test("a valid value validates against {$ref} IDENTICALLY to {$ref}", () => {
    const good = { name: "Ada", age: 36 };
    const viaRef = validate(REF, good, null);
    const viaNamed = validate(NAMED, good, null);
    expect(viaRef.valid).toBe(true);
    expect(viaRef).toEqual(viaNamed);
  });

  test("an INVALID value fails identically (same errors)", () => {
    const bad = { name: 123, age: "nope" };
    const viaRef = validate(REF, bad, null);
    const viaNamed = validate(NAMED, bad, null);
    expect(viaRef.valid).toBe(false);
    expect(viaRef.errors).toEqual(viaNamed.errors);
  });

  test("composite recursion: List({$ref}) === List({$ref})", () => {
    const items = [{ name: "Ada", age: 36 }, { name: "Grace", age: 45 }];
    expect(validate(List(REF), items, null)).toEqual(validate(List(NAMED), items, null));
  });

  test("post-peel base: $refined { base: {$ref} } === $refined { base: {$ref} }", () => {
    // The bare-{$ref} path is 7c's top-of-function arm; THIS exercises the new
    // 7e arm — a reference WRAPPED in $refined leaves a {$ref} base after the
    // atomic peel, which the entity-resolve point now resolves-and-recurses.
    const good = { name: "Ada", age: 36 };
    const refined = (b: FenelType): FenelType =>
      ({ $refined: { base: b, set: { $tag: "SeAll" } } }) as unknown as FenelType;
    expect(validate(refined(REF), good, null)).toEqual(validate(refined(NAMED), good, null));
  });

  test("7d identity threaded: a UUID handle resolves to the SAME entity as the code-name", () => {
    const good = { name: "Ada", age: 36 };
    expect(validate(REF_UUID, good, null).valid).toBe(true);
    expect(validate(REF_UUID, good, null)).toEqual(validate(REF, good, null));
    // …and identical to its own {$ref:uuid} twin (same catalog lookup).
    expect(validate(REF_UUID, good, null)).toEqual(validate(NAMED_UUID, good, null));
  });

  test("unresolvable handle → graceful, no throw (bare {$ref} → 7c's Unknown arm)", () => {
    // A BARE unresolvable {$ref} is caught by 7c's top-of-function arm (its own
    // "Unknown $ref type" message), NOT 7e's entity-resolve point — so it does
    // not byte-match the {$ref} miss ("Unknown field type"). 7e's byte-identity
    // guarantee is for RESOLVABLE entities; the unresolvable contract is only
    // graceful-no-throw. The {$ref} miss is likewise graceful.
    expect(() => validate(MISS_REF, { name: "x" }, null)).not.toThrow();
    const r = validate(MISS_REF, { name: "x" }, null);
    expect(r.valid).toBe(false);
    expect(r.errors[0]!.message).toContain("Unknown");
    expect(validate(MISS_NAMED, { name: "x" }, null).valid).toBe(false);
  });
});

describe("Phase 7e — json-schema export (resolve-to-NAME): {$ref} === {$ref}", () => {
  test("bare entity {$ref} exports identically to {$ref}", () => {
    expect(fenelTypeToJsonSchema(REF)).toEqual(fenelTypeToJsonSchema(NAMED));
  });

  test("inside a composite: List({$ref}) === List({$ref})", () => {
    expect(fenelTypeToJsonSchema(List(REF))).toEqual(fenelTypeToJsonSchema(List(NAMED)));
  });

  test("inside a record field: { ref: {$ref} } === { ref: {$ref} }", () => {
    const rec = (t: FenelType): FenelType =>
      ({ $record: { fields: [field("ref", t)] } }) as unknown as FenelType;
    expect(fenelTypeToJsonSchema(rec(REF))).toEqual(fenelTypeToJsonSchema(rec(NAMED)));
  });

  test("UUID handle: {$ref:uuid} === {$ref:uuid}", () => {
    expect(fenelTypeToJsonSchema(REF_UUID)).toEqual(fenelTypeToJsonSchema(NAMED_UUID));
  });

  test("unresolvable handle → graceful, no throw; === {$ref} of the same miss", () => {
    expect(() => fenelTypeToJsonSchema(MISS_REF)).not.toThrow();
    expect(fenelTypeToJsonSchema(MISS_REF)).toEqual(fenelTypeToJsonSchema(MISS_NAMED));
  });
});

describe("Phase 7e — widget-hint (resolve-to-NAME): {$ref} === {$ref}", () => {
  test("widgetForType({$ref}) === widgetForType({$ref})", () => {
    expect(widgetForType(REF)).toEqual(widgetForType(NAMED));
  });

  test("UUID handle and unresolvable handle both match their {$ref} twin", () => {
    expect(widgetForType(REF_UUID)).toEqual(widgetForType(NAMED_UUID));
    expect(widgetForType(MISS_REF)).toEqual(widgetForType(MISS_NAMED));
  });
});

describe("Phase 7e — field-meta (resolve-to-NAME, typeclass key): {$ref} === {$ref}", () => {
  test("defaultValueFor / channelsFor with NO registry match the {$ref} twin", () => {
    expect(defaultValueFor(REF)).toEqual(defaultValueFor(NAMED));
    expect(channelsFor(REF)).toEqual(channelsFor(NAMED));
  });

  test("HasDefault keyed by the entity name resolves through the {$ref} form", () => {
    // The name-keyed typeclass lookup (`registry.resolve(name, "HasDefault")`)
    // must see the handle's code-name — so the ref form yields the same default.
    const reg: DefaultRegistry = {
      resolve: (t, c) => (t === ENTITY_NAME && c === "HasDefault" ? { default: "DFLT-7e" } : undefined),
    };
    expect(defaultValueFor(REF, reg)).toBe("DFLT-7e");
    expect(defaultValueFor(REF, reg)).toEqual(defaultValueFor(NAMED, reg));
  });

  test("Inputable keyed by the entity name resolves through the {$ref} form", () => {
    const reg: DefaultRegistry = {
      resolve: (t, c) => (t === ENTITY_NAME && c === "Inputable" ? { channels: ["text"] } : undefined),
    };
    expect(channelsFor(REF, reg)).toEqual(channelsFor(NAMED, reg));
    expect(channelsFor(REF, reg)).toHaveLength(1);
  });
});

describe("Phase 7e — printers (resolve-to-NAME, verbatim): {$ref} === {$ref}", () => {
  test("fenel-printer printType({$ref}) === printType({$ref}) === the code-name", () => {
    expect(printType(REF)).toBe(ENTITY_NAME);
    expect(printType(REF)).toEqual(printType(NAMED));
  });

  test("entity-def-printer renders a {$ref}-typed field identically to a {$ref} one", () => {
    const sch = (t: FenelType) => [{ id: "ref", type: t }];
    const viaRef = printEntityDef(ENTITY_NAME, "Lbl", sch(REF) as never);
    const viaNamed = printEntityDef(ENTITY_NAME, "Lbl", sch(NAMED) as never);
    expect(viaRef).toEqual(viaNamed);
  });
});

describe("Phase 7e — {$ref} back-compat unchanged by the new arm", () => {
  test("a plain {$ref} entity still validates / exports / prints as before", () => {
    const good = { name: "Ada", age: 36 };
    expect(validate(NAMED, good, null).valid).toBe(true);
    expect(fenelTypeToJsonSchema(NAMED)).toEqual({ description: `Named type: ${ENTITY_NAME}` });
    expect(printType(NAMED)).toBe(ENTITY_NAME);
  });
});
