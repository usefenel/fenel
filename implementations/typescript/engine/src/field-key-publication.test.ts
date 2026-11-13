// ---------------------------------------------------------------------------
// field-key-publication.test.ts — FieldRef and FieldKey are published in the
// system and seed registries beside SetExpr (Rom, 2026-09-25: publish them as
// declared, create no type, mint nothing).
//
// SetExpr's SetCtorField and SetArrowParam key their fields by FieldKey, and
// the authority rows, the compiler IR and several class records reach it. The
// two types now come from `fenel/modules/engine/field-key.fenel` through
// `modules/set-expr-entities.ts`. Before that, the system registry did not
// publish them and every such value was refused with "field semantic slot:
// invalid named field". Against `getSystemRegistry()` this file pins:
//   (a)-(c) values whose types mention FieldKey validate;
//   (d) a SetExpr with an unknown case is refused, naming the SetExpr cases;
//   (e) KNOWN GAP: a named key in the stored form `{$ref: uuid}` is refused;
//   (f) where the two types are published.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { validate } from "./validate";
import { getSystemRegistry } from "./system-registry";
import { SYSTEM_REGISTRY_MODULES } from "./system-registry-modules";
import { modulesFor } from "./module-manifest";
import { setExprEntityModule } from "./modules/set-expr-entities";
import type { FenelModule, FenelType } from "./types";

// The first test builds the system registry (about a minute on a quiet host);
// validating a SeCtor takes a few seconds.
const TIMEOUT = 300_000;

const SET_EXPR: FenelType = { $ref: "SetExpr" };
const SE_ALL = { $tag: "SeAll" } as const;
const FIELD_HANDLE = "00000000-0000-4000-8000-000000000501";

function check(type: FenelType, value: unknown) {
  return validate(type, value, null, { registry: getSystemRegistry() });
}

function seCtorWithKey(key: unknown) {
  return {
    $tag: "SeCtor",
    ctor: "Pair",
    fields: [{ $tag: "SetCtorField", key, wireName: "x", set: SE_ALL }],
  };
}

describe("FieldRef and FieldKey are published beside SetExpr", () => {
  test("(a) SeAll validates as SetExpr", () => {
    expect(check(SET_EXPR, SE_ALL)).toMatchObject({ valid: true, errors: [] });
  }, TIMEOUT);

  test("(b) a SeCtor whose field has a PositionalField key validates", () => {
    const value = seCtorWithKey({ $tag: "PositionalField", index: 0 });
    expect(check(SET_EXPR, value)).toMatchObject({ valid: true, errors: [] });
  }, TIMEOUT);

  test("(c) the authority module's FieldAxis { name = \"x\", set = SeAll } validates", () => {
    const value = { $tag: "FieldAxis", name: "x", set: SE_ALL };
    expect(check({ $ref: "FieldAxis" }, value)).toMatchObject({ valid: true, errors: [] });
  }, TIMEOUT);

  test("(d) an unknown SetExpr case is refused with the SetExpr cases named", () => {
    const setExpr = setExprEntityModule.entities?.find(({ id }) => id === "SetExpr")?.type as
      | { $variant: { cases: Array<{ name: string }> } }
      | undefined;
    const cases = setExpr?.$variant.cases.map(({ name }) => name) ?? [];
    expect(cases).toHaveLength(15);

    const result = check(SET_EXPR, { $tag: "SeBogus" });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe("$tag");
    const message = result.errors[0]?.message;
    expect(typeof message).toBe("string");
    const text = typeof message === "string" ? message : "";
    expect(text.startsWith("Must be one of: ")).toBe(true);
    expect(text.slice("Must be one of: ".length).split(", ")).toEqual(cases);
  }, TIMEOUT);

  // KNOWN GAP (the FieldRef-shape follow-up). The published FieldRef is the
  // kernel's `$`-free view, `FieldRef { handle }`, while the host stores a
  // reference to a Field as `{$ref: "<uuid>"}` (design/field-identity.md). So a
  // named key in the stored form is refused and the kernel view is accepted.
  // When the general typed-reference type lands, the first assertion flips.
  test("(e) KNOWN GAP: a NamedField key in the stored {$ref} form is refused", () => {
    const stored = check(SET_EXPR, seCtorWithKey({ $tag: "NamedField", ref: { $ref: FIELD_HANDLE } }));
    expect(stored.valid).toBe(false);
    expect(stored.errors.map(({ path }) => path)).toEqual(["fields.0.key.ref.handle"]);
    expect(stored.errors[0]?.message).toContain("Handle is required");

    const kernelView = check(
      SET_EXPR,
      seCtorWithKey({ $tag: "NamedField", ref: { $tag: "FieldRef", handle: FIELD_HANDLE } }),
    );
    expect(kernelView).toMatchObject({ valid: true, errors: [] });
  }, TIMEOUT);

  test("(f) both are published once, by engine, in the system and seed profiles and not in execute", () => {
    const publishers = (modules: readonly FenelModule[], id: string) =>
      modules.flatMap((module) =>
        (module.entities ?? [])
          .filter((entity) => entity.id === id)
          .map((entity) => ({ module: module.name, owner: entity.module })),
      );
    for (const id of ["FieldKey", "FieldRef"]) {
      expect(publishers(SYSTEM_REGISTRY_MODULES, id)).toEqual([{ module: "engine", owner: "engine" }]);
      expect(publishers(modulesFor("seed"), id)).toEqual([{ module: "engine", owner: "engine" }]);
      expect(publishers(modulesFor("execute"), id)).toEqual([]);
      expect(
        getSystemRegistry().listIdentifiedEntities()
          .filter((entity) => entity.id === id)
          .map((entity) => entity.module),
      ).toEqual(["engine"]);
    }
  }, TIMEOUT);
});
