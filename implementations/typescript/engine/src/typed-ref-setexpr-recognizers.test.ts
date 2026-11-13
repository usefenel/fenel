// Phase 7f-cont (typed-function-references) — the SetExpr recognizers learn
// `{$ref}` (closes the recognizer-readiness gate).
//
// 7f taught the structural-CORE recognizers (`peel*` / `isSubtype`, over
// `FenelType`). 7f-cont closes the surface by teaching the three deciders that
// reason over `SetExpr`: `contains` / `isDisjoint` (+ its delegate `isSubset`),
// and `untaggedToVariant` (in `type-algebra.ts`). Once every recognizer the
// producer's output flows through understands `{$ref}`, the producer flip (7g)
// is safe.
//
// Model (LOCKED, the brief's pre-blessed defaults — see
// audit-phase7f-cont-setexpr-sites.md):
//   D-A: a resolved referent is fed back as a SetExpr exactly as `{$ref}` is
//        today; a non-SetExpr resolved shape degrades to `Nothing` (graceful).
//   D-B: refs are stripped at the wrapper ENTRY by a total walk over the four
//        recursive SetExpr arms (`$union`/`$intersect`/`$diff`/`$complement`) —
//        entry AND nested in one pass; marshaller + Fenel deciders untouched.
//   empty-referent corner: `isDisjoint(Ref X, Ref X)` ⇒ `Just false` (handle
//        equality; a ref denotes an inhabited registered entity).
//   unresolvable ref ⇒ `Nothing` (NOT `Just false`); never throws.
//
// Non-brittle catalog approach (Phase-6 leak lesson): register CONTROLLED test
// entities rather than depend on global catalog population. Additive: no
// producer emits `{$ref}` in a SetExpr position pre-7g, so the oracle corpus is
// untouched.

import { test, expect, describe } from "bun:test";
import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a.5) — budget raise, no assertion weakened. This suite drives
// the INTERPRETED Fenel deciders and had rows measuring 200 s against bun's 5 s
// default BEFORE this phase and after it (verified identical on the pre-repair
// tree), so it was reporting CLOCK as failure. A gate nobody can read is how a
// genuine red went unnoticed at P1(a). Raise the budget; never weaken an
// assertion to fit it.
setDefaultTimeout(300_000);
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { Ref, refType, type RefValue } from "./type-foundation";
import { registerCatalogEntities, getEntityTypeByName } from "./type-catalog";
import { loadLock } from "./codename-lock";
import { contains, isDisjoint, isJustTrue, isJustFalse } from "./set-algebra";
import { buildSetExpr } from "./set-marker";
import { untaggedToVariant } from "./type-algebra";
import type { FieldKey } from "./types";

const FIELD_VALUE: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "11111111-1111-4111-8111-111111111111" },
};
const PARAM_ARG: FieldKey = {
  $tag: "NamedField",
  ref: { $ref: "22222222-2222-4222-8222-222222222222" },
};
import type { FenelType, SetExpr } from "./types";

const identifiedVariantCandidates = (types: readonly FenelType[]) =>
  types.map((type) => ({
    type,
    payload: {
      $tag: "ReuseField" as const,
      field: {
        key: FIELD_VALUE,
        name: "value",
        label: { $tag: "Nothing" as const },
        type,
        meta: {},
        ui: { $tag: "Nothing" as const },
      },
    },
  }));

const reg = createRegistry([stdModule], { codeNameLock: loadLock() });
const ctx = reg.evaluateContext();

// The injected resolver — `refType` bridges function-id → `$arrow` and
// type/entity code-name → its registered kind; `getEntityTypeByName` is the
// injected catalog lookup (NOT imported into set-algebra — Hard fact 1).
const resolve = (ref: RefValue): FenelType =>
  refType(ref, ctx.getFunction ?? (() => undefined), getEntityTypeByName);

// Controlled entities. SetExpr-shaped types for contains/isDisjoint (a SetExpr
// is also a degenerate FenelType — the `{$ref}` precedent, D-A); structural
// FenelType shapes for untaggedToVariant (disjoint by differing shape tag).
const ENUM_AB: SetExpr = { $tag: "SeEnum", values: ["a", "b"] };
const ENUM_X: SetExpr = { $tag: "SeEnum", values: ["x"] };
const ENUM_Y: SetExpr = { $tag: "SeEnum", values: ["y"] };
const ENUM_XZ: SetExpr = { $tag: "SeEnum", values: ["x", "z"] };
const RECORD_T: FenelType = { $record: { fields: [] } } as unknown as FenelType;
const VARIANT_T: FenelType = { $variant: { cases: [{ name: "K", fields: [] }] } } as unknown as FenelType;

registerCatalogEntities([
  { id: "EnumAB7fc", type: ENUM_AB as unknown as FenelType },
  { id: "EnumX7fc", type: ENUM_X as unknown as FenelType },
  { id: "EnumXZ7fc", type: ENUM_XZ as unknown as FenelType },
  { id: "RecAlias7fc", type: RECORD_T },
  { id: "RecAliasB7fc", type: RECORD_T },
  { id: "VarAlias7fc", type: VARIANT_T },
]);

const refOf = (name: string): SetExpr => buildSetExpr.ref(name);
const refT = (name: string) => Ref(name) as unknown as FenelType;

describe("Phase 7f-cont — contains resolves a {$ref} set to its referent", () => {
  test("contains(Ref(EnumAB), 'a') === contains(structural enum, 'a') — in-set", () => {
    expect(contains(refOf("EnumAB7fc"), "a", null, undefined, undefined, resolve)).toEqual(
      contains(ENUM_AB, "a", null),
    );
    expect(isJustTrue(contains(refOf("EnumAB7fc"), "a", null, undefined, undefined, resolve))).toBe(true);
  });
  test("contains(Ref(EnumAB), 'z') === contains(structural enum, 'z') — out-of-set", () => {
    expect(contains(refOf("EnumAB7fc"), "z", null, undefined, undefined, resolve)).toEqual(
      contains(ENUM_AB, "z", null),
    );
    expect(isJustFalse(contains(refOf("EnumAB7fc"), "z", null, undefined, undefined, resolve))).toBe(true);
  });
});

describe("Phase 7f-cont — isDisjoint resolve-then-redispatch, both directions", () => {
  test("isDisjoint(Ref(X), structural Y) === structural (disjoint)", () => {
    const structural = isDisjoint(ENUM_X, ENUM_Y);
    expect(isDisjoint(refOf("EnumX7fc"), ENUM_Y, undefined, resolve)).toEqual(structural);
    expect(isJustTrue(structural)).toBe(true);
  });
  test("isDisjoint(structural Y, Ref(X)) === structural (symmetry)", () => {
    expect(isDisjoint(ENUM_Y, refOf("EnumX7fc"), undefined, resolve)).toEqual(isDisjoint(ENUM_Y, ENUM_X));
  });
  test("isDisjoint(Ref(X), structural XZ) === structural (NOT disjoint — overlap)", () => {
    const structural = isDisjoint(ENUM_X, ENUM_XZ);
    expect(isDisjoint(refOf("EnumX7fc"), ENUM_XZ, undefined, resolve)).toEqual(structural);
    expect(isJustFalse(structural)).toBe(true);
  });
});

describe("Phase 7f-cont — handle-equality without a resolver", () => {
  test("isDisjoint(Ref X, Ref X) is Just false with NO resolver passed", () => {
    expect(isJustFalse(isDisjoint(refOf("Anything7fc"), refOf("Anything7fc")))).toBe(true);
  });
});

describe("Phase 7f-cont — nested {$ref} inside a compound SetExpr", () => {
  test("contains($union[Ref(EnumAB)], 'a') === contains($union[structural enum], 'a')", () => {
    expect(
      contains({ $tag: "SeUnion", branches: [refOf("EnumAB7fc")] }, "a", null, undefined, undefined, resolve),
    ).toEqual(contains({ $tag: "SeUnion", branches: [ENUM_AB] }, "a", null));
  });
  test("isDisjoint($union[Ref(X)], Y) === isDisjoint($union[structural X], Y)", () => {
    expect(
      isDisjoint({ $tag: "SeUnion", branches: [refOf("EnumX7fc")] }, ENUM_Y, undefined, resolve),
    ).toEqual(isDisjoint({ $tag: "SeUnion", branches: [ENUM_X] }, ENUM_Y));
  });
});

describe("floor-kernel Phase 4 — reference resolution follows the full ADT in Fenel", () => {
  test("resolves a SeRef nested in a SeCtor field", () => {
    const viaRef = buildSetExpr.ctor("Box", [
      buildSetExpr.ctorField(FIELD_VALUE, "value", refOf("EnumAB7fc")),
    ]);
    const structural = buildSetExpr.ctor("Box", [
      buildSetExpr.ctorField(FIELD_VALUE, "value", ENUM_AB),
    ]);
    const value = { $tag: "Box", value: "a" };
    expect(contains(viaRef, value, null, undefined, undefined, resolve)).toEqual(
      contains(structural, value, null),
    );
  });

  test("discovers SeRef leaves in SeArrow params and returns", () => {
    const seen = new Set<string>();
    const trackingResolve = (ref: RefValue): FenelType => {
      seen.add(ref.$ref);
      return resolve(ref);
    };
    const arrow = buildSetExpr.arrow(
      [buildSetExpr.arrowParam(PARAM_ARG, "arg", refOf("EnumX7fc"))],
      refOf("EnumXZ7fc"),
    );
    contains(arrow, { $ref: "noSuchFunction" }, null, undefined, undefined, trackingResolve);
    expect(seen).toEqual(new Set(["EnumX7fc", "EnumXZ7fc"]));
  });

  test("does not substitute a SeMu-bound SeRef", () => {
    const recursive = buildSetExpr.mu("EnumAB7fc", refOf("EnumAB7fc"));
    expect(contains(recursive, "a", null, undefined, undefined, resolve)).toEqual(
      contains(recursive, "a", null),
    );
  });
});

describe("Phase 7f-cont — untaggedToVariant resolves {$ref} candidates", () => {
  test("untaggedToVariant([Ref(A), Ref(B)]) (disjoint) === structural candidates", () => {
    expect(untaggedToVariant(identifiedVariantCandidates([refT("RecAlias7fc"), refT("VarAlias7fc")]), resolve)).toEqual(
      untaggedToVariant(identifiedVariantCandidates([RECORD_T, VARIANT_T])),
    );
  });
  test("untaggedToVariant([Ref(A), Ref(A')]) (non-disjoint referents) still errors", () => {
    const res = untaggedToVariant(identifiedVariantCandidates([refT("RecAlias7fc"), refT("RecAliasB7fc")]), resolve);
    expect("err" in res).toBe(true);
  });
});

describe("7g-retire-4a — an unresolvable {$ref} decides like its {$ref} twin (never throws)", () => {
  // Pre-4a this asserted `unresolvable ⇒ Nothing`: the SetExpr entry-resolve
  // VOIDED an unresolvable `{$ref}` → Nothing, a `{$ref}`-ONLY behavior that did
  // NOT match its `{$ref}` twin (`{$ref:unknown}` → `setNamedContains` → the
  // conservative `Just false`). -4a's entry-resolve INVERT keeps the `{$ref}`
  // name-handle leaf so the marshaller decides it IDENTICALLY to `{$ref}` —
  // closing that pre-existing invariant gap. The "never throws" guarantee holds.
  const namedUnknown = buildSetExpr.ref("DefinitelyNot7fc");
  test("contains(Ref(unresolvable), v) === contains({$ref:unresolvable}, v) — the named twin", () => {
    expect(contains(refOf("DefinitelyNot7fc"), "a", null, undefined, undefined, resolve)).toEqual(
      contains(namedUnknown, "a", null),
    );
  });
  test("isDisjoint(Ref(unresolvable), Y) === isDisjoint({$ref:unresolvable}, Y) — the named twin", () => {
    expect(isDisjoint(refOf("DefinitelyNot7fc"), ENUM_Y, undefined, resolve)).toEqual(
      isDisjoint(namedUnknown, ENUM_Y),
    );
  });
  test("untaggedToVariant with an unresolvable ref never throws", () => {
    expect(() => untaggedToVariant(identifiedVariantCandidates([refT("DefinitelyNot7fc"), VARIANT_T]), resolve)).not.toThrow();
  });
});

describe("Phase 7f-cont — back-compat: structural decisions unchanged by the resolve param", () => {
  test("contains is identical with vs without the resolve param (ref-free input)", () => {
    expect(contains(ENUM_AB, "a", null, undefined, undefined, resolve)).toEqual(contains(ENUM_AB, "a", null));
  });
  test("isDisjoint over two structural enums is unchanged by the ref param", () => {
    expect(isDisjoint(ENUM_X, ENUM_Y, undefined, resolve)).toEqual(isDisjoint(ENUM_X, ENUM_Y));
  });
});
