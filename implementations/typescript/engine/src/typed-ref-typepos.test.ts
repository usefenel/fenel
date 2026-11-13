// Phase 7c (typed-function-references) — the validator accepts `{$ref}` in
// TYPE position (the first real consumer of the type-layer merge).
//
// 7b built the resolver (`refType` → referent's TYPE: function → `$arrow`,
// type/entity → its registered kind). 7c makes `validateFieldByType` route a
// `{$ref}` in type position through that resolver and recurse, so a value typed
// `{$ref:"Foo"}` validates IDENTICALLY to `{$ref:"Foo"}`. Purely additive —
// the `$ref` branch is untouched; both shapes stay valid until 7g retires
// `$ref`. Decisions: design/typed-function-references.md § "The type-layer
// merge (Phase 7)".
//
// Non-brittle catalog approach (Phase-6 leak lesson): register a CONTROLLED
// test entity rather than depend on global catalog population.

import { test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { Ref, List } from "./type-foundation";
import {
  registerCatalogEntities,
  getCatalogEntry,
  getEntityTypeByName,
} from "./type-catalog";
import { loadLock } from "./codename-lock";
import { validate } from "./validate";
import type { FenelType } from "./types";

const reg = createRegistry([stdModule], { codeNameLock: loadLock() });
const ctx = reg.evaluateContext();
const absId = reg.getUuid("abs")!;

// A controlled entity — a 2-field record. Registered in the catalog so
// `getEntityTypeByName("TestRefEntity7c")` resolves to this exact type.
const ENTITY_NAME = "TestRefEntity7c";
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

registerCatalogEntities([{ id: ENTITY_NAME, type: ENTITY_TYPE }]);

const NAMED = { $ref: ENTITY_NAME } as unknown as FenelType;
const REF = Ref(ENTITY_NAME) as unknown as FenelType;

describe("Phase 7c — validateFieldByType accepts {$ref} in type position", () => {
  test("the test entity is registered and resolves via getEntityTypeByName", () => {
    expect(getCatalogEntry(`entity:${ENTITY_NAME}`)?.entity?.type).toEqual(ENTITY_TYPE);
    expect(getEntityTypeByName(ENTITY_NAME)).toEqual(ENTITY_TYPE);
  });

  test("a value validates against {$ref:Entity} IDENTICALLY to {$ref:Entity}", () => {
    const good = { name: "Ada", age: 36 };
    const viaRef = validate(REF, good, null);
    const viaNamed = validate(NAMED, good, null);
    expect(viaRef.valid).toBe(true);
    expect(viaNamed.valid).toBe(true);
    expect(viaRef).toEqual(viaNamed); // byte-for-byte: the ref recurses into the same path
  });

  test("an INVALID value fails against {$ref:Entity} the same way as {$ref:Entity}", () => {
    const bad = { name: 123, age: "not-a-number" };
    const viaRef = validate(REF, bad, null);
    const viaNamed = validate(NAMED, bad, null);
    expect(viaRef.valid).toBe(false);
    expect(viaNamed.valid).toBe(false);
    expect(viaRef.errors).toEqual(viaNamed.errors);
  });

  test("the {$ref} resolves inside a composite: List({$ref:Entity})", () => {
    const items = [{ name: "Ada", age: 36 }, { name: "Grace", age: 45 }];
    const viaRef = validate(List(REF), items, null);
    const viaNamed = validate(List(NAMED), items, null);
    expect(viaRef.valid).toBe(true);
    expect(viaNamed.valid).toBe(true);
    expect(viaRef.valid).toBe(viaNamed.valid);
  });

  test("a {$ref} to a missing/unresolvable handle → graceful Unknown, no throw", () => {
    const result = validate(Ref("DefinitelyNotAnEntity7c") as unknown as FenelType, { name: "x" }, null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.message).toContain("Unknown");
  });

  test("handle-kind agnostic: a function-UUID and its codeable-name both resolve in type position", () => {
    // A function ref resolves to its `$arrow` (function-first, value-position
    // transparency preserved). Validating a callable string against that arrow
    // exercises the resolved-then-recurse path for both handle kinds.
    const byUuid = validate(Ref(absId) as unknown as FenelType, "abs", null, { functions: ctx });
    const byName = validate(Ref("abs") as unknown as FenelType, "abs", null, { functions: ctx });
    expect(byUuid.valid).toBe(true);
    expect(byName.valid).toBe(true);
  });
});
