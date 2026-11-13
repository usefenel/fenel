// ---------------------------------------------------------------------------
// Phase 13 of canonical-maybe `matchExpr` parametric-dispatch capability,
// *repurposed* onto the unified dependent-type substrate by Phase 1 of
// typeclass-substrate-completion.
//
// Pre-Phase-13 the matcher was string-only: `matchExpr(type: string,
// pattern: TypeExpr)` could match `string === string` and `$var → any` but
// returned `false` on parametric patterns unconditionally. This made
// `maybeUndefinable` (`args: [{$app: "Maybe", args: [{$var: "a"}]}]`)
// decorative — declared intent without runtime dispatch.
//
// Phase 13 widened the matcher to `FenelType`, added the parametric branch
// (then keyed on `$app`), and extended `isErasableType` step 3 to also hand
// parametric shapes to `dispatchRegistry.satisfies`.
//
// Phase 1 of typeclass-substrate-completion retires the `$app` constructor
// and re-targets the matcher onto `{$el: {call: [con, ...args]}}` — the
// same unified dependent-type substrate every other deferred type-app
// uses. The conformance test is renamed from `…-matcher-app-pattern…` to
// `…-matcher-el-call-pattern…`; the 25 arms below pin the same observable
// behaviour on the new shape.
//
// Conformance covers:
//   1. Matcher: `$var` matches anything; same-var binding consistency.
//   2. Matcher: string pattern matches `$ref`-shaped LHS only.
//   3. Matcher: `$el.call` pattern matches `{$el: {call: [con, ...args]}}`
//      LHS with the same constructor + arity + recursive arg match.
//   4. Matcher: mismatched constructor / arity / inner type rejects.
//   5. Registry: `findInstance`/`satisfies` against `maybeUndefinable`
//      succeeds for a literal `{$el: {call: ["Maybe", Profile]}}` LHS
//      (the regression-pinning arm for the parametric dispatch capability).
//   6. `isErasableType` step 3 path lights up for explicit `$el.call`
//      shapes alongside the existing `peelMaybe`/`peelToVariant` paths —
//      no regression on the Phase 8 contract.
//   7. The public API accepts both `string` (legacy lifted to `$ref`)
//      and full `FenelType` — every pre-Phase-13 caller continues to work
//      verbatim.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { FenelType, Instance } from "./types";
import { createDispatchRegistry } from "./dispatch-registry";
import { dispatchRegistry } from "./system-entities";
import { isErasableType } from "./set-algebra";
import { GLOBAL_ONLY } from "./dispatch-registry";

// Helper: literal `$el.call` FenelType for `Ctor<...args>`.
function elCall(con: string, args: FenelType[]): FenelType {
  return { $el: { call: [con, ...args] } } as FenelType;
}

// Helper: literal `$ref` FenelType.
function named(name: string): FenelType {
  return { $ref: name };
}

describe("Phase 1 substrate-completion — matchExpr accepts `$var` pattern", () => {
  it("$var matches a $ref type", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "Anything",
      params: [{ name: "a" }],
      methods: [],
    });
    const inst: Instance = {
      typeName: "Anything",
      args: [{ $var: "a" }],
      methods: {},
    };
    reg.addInstance(inst);
    expect(reg.satisfies(named("Profile"), "Anything", GLOBAL_ONLY)).toBe(true);
    expect(reg.satisfies(named("Number"), "Anything", GLOBAL_ONLY)).toBe(true);
  });

  it("$var matches an $el.call type", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "Anything",
      params: [{ name: "a" }],
      methods: [],
    });
    reg.addInstance({
      typeName: "Anything",
      args: [{ $var: "a" }],
      methods: {},
    });
    expect(reg.satisfies(elCall("Maybe", [named("Profile")]), "Anything", GLOBAL_ONLY)).toBe(true);
  });
});

describe("Phase 1 substrate-completion — matchExpr accepts string pattern", () => {
  it("string pattern matches $ref LHS with same name", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "OnlyProfile",
      params: [{ name: "a" }],
      methods: [],
    });
    reg.addInstance({
      typeName: "OnlyProfile",
      args: ["Profile"],
      methods: {},
    });
    expect(reg.satisfies(named("Profile"), "OnlyProfile", GLOBAL_ONLY)).toBe(true);
    expect(reg.satisfies(named("Item"), "OnlyProfile", GLOBAL_ONLY)).toBe(false);
  });

  it("string pattern accepts legacy bare-string LHS (lifted to $ref)", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "OnlyProfile",
      params: [{ name: "a" }],
      methods: [],
    });
    reg.addInstance({
      typeName: "OnlyProfile",
      args: ["Profile"],
      methods: {},
    });
    expect(reg.satisfies("Profile", "OnlyProfile", GLOBAL_ONLY)).toBe(true);
    expect(reg.satisfies("Item", "OnlyProfile", GLOBAL_ONLY)).toBe(false);
  });

  it("string pattern does NOT match $el.call LHS (direct-shape only)", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "OnlyMaybe",
      params: [{ name: "a" }],
      methods: [],
    });
    reg.addInstance({
      typeName: "OnlyMaybe",
      args: ["Maybe"],
      methods: {},
    });
    // String pattern "Maybe" is the concrete-name pattern, not the
    // "any application of Maybe" pattern — that's the $el.call shape.
    expect(reg.satisfies(elCall("Maybe", [named("Profile")]), "OnlyMaybe", GLOBAL_ONLY)).toBe(false);
  });
});

describe("Phase 1 substrate-completion — matchExpr accepts $el.call pattern", () => {
  it("$el.call pattern matches $el.call LHS with same con + recursive args", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "MaybeShape",
      params: [{ name: "a" }],
      methods: [],
    });
    reg.addInstance({
      typeName: "MaybeShape",
      args: [{ $el: { call: ["Maybe", { $var: "a" }] } }],
      methods: { kind: "maybe" },
    });
    expect(reg.satisfies(elCall("Maybe", [named("Profile")]), "MaybeShape", GLOBAL_ONLY)).toBe(true);
    expect(reg.satisfies(elCall("Maybe", [named("Number")]), "MaybeShape", GLOBAL_ONLY)).toBe(true);
    expect(reg.satisfies(elCall("Maybe", [elCall("List", [named("Char")])]), "MaybeShape", GLOBAL_ONLY)).toBe(true);
  });

  it("$el.call rejects mismatched constructor", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "MaybeShape",
      params: [{ name: "a" }],
      methods: [],
    });
    reg.addInstance({
      typeName: "MaybeShape",
      args: [{ $el: { call: ["Maybe", { $var: "a" }] } }],
      methods: {},
    });
    expect(reg.satisfies(elCall("List", [named("Profile")]), "MaybeShape", GLOBAL_ONLY)).toBe(false);
    expect(reg.satisfies(elCall("Result", [named("E"), named("A")]), "MaybeShape", GLOBAL_ONLY)).toBe(false);
  });

  it("$el.call rejects mismatched arity", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "MaybeShape",
      params: [{ name: "a" }],
      methods: [],
    });
    reg.addInstance({
      typeName: "MaybeShape",
      args: [{ $el: { call: ["Maybe", { $var: "a" }] } }],
      methods: {},
    });
    // Maybe<a> pattern requires arity-1; arity-0/2 rejected.
    expect(reg.satisfies(elCall("Maybe", []), "MaybeShape", GLOBAL_ONLY)).toBe(false);
    expect(reg.satisfies(elCall("Maybe", [named("A"), named("B")]), "MaybeShape", GLOBAL_ONLY)).toBe(false);
  });

  it("$el.call rejects mismatched inner type when pattern is concrete", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "MaybeProfile",
      params: [{ name: "a" }],
      methods: [],
    });
    reg.addInstance({
      typeName: "MaybeProfile",
      args: [{ $el: { call: ["Maybe", "Profile"] } }],
      methods: {},
    });
    expect(reg.satisfies(elCall("Maybe", [named("Profile")]), "MaybeProfile", GLOBAL_ONLY)).toBe(true);
    expect(reg.satisfies(elCall("Maybe", [named("Item")]), "MaybeProfile", GLOBAL_ONLY)).toBe(false);
  });

  it("$el.call rejects $ref LHS (the $el.call pattern requires structural $el.call)", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "MaybeShape",
      params: [{ name: "a" }],
      methods: [],
    });
    reg.addInstance({
      typeName: "MaybeShape",
      args: [{ $el: { call: ["Maybe", { $var: "a" }] } }],
      methods: {},
    });
    // Structural-equivalence (e.g. peelMaybe-shaped $variant) is NOT
    // subsumed by the matcher. That's `isErasableType`'s job via
    // peelMaybe step 1, not the $el.call matcher.
    expect(reg.satisfies(named("Maybe"), "MaybeShape", GLOBAL_ONLY)).toBe(false);
  });
});

describe("Phase 1 substrate-completion — matchExpr $var binding consistency", () => {
  it("repeat $var in nested $el.call args consistency-checks (Tuple<a, a>)", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "SameTuple",
      params: [{ name: "a" }],
      methods: [],
    });
    reg.addInstance({
      typeName: "SameTuple",
      args: [{ $el: { call: ["Tuple", { $var: "a" }, { $var: "a" }] } }],
      methods: {},
    });
    // Tuple<X, X> binds a=X twice consistently → matches.
    expect(reg.satisfies(elCall("Tuple", [named("X"), named("X")]), "SameTuple", GLOBAL_ONLY)).toBe(true);
    // Tuple<X, Y> binds a=X then sees Y ≠ X → rejects.
    expect(reg.satisfies(elCall("Tuple", [named("X"), named("Y")]), "SameTuple", GLOBAL_ONLY)).toBe(false);
  });

  it("distinct $vars at different arg positions bind independently", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "AnyPair",
      params: [{ name: "a" }],
      methods: [],
    });
    reg.addInstance({
      typeName: "AnyPair",
      args: [{ $el: { call: ["Tuple", { $var: "a" }, { $var: "b" }] } }],
      methods: {},
    });
    // Independent binding — any pair matches.
    expect(reg.satisfies(elCall("Tuple", [named("X"), named("X")]), "AnyPair", GLOBAL_ONLY)).toBe(true);
    expect(reg.satisfies(elCall("Tuple", [named("X"), named("Y")]), "AnyPair", GLOBAL_ONLY)).toBe(true);
  });
});

describe("Phase 1 substrate-completion — maybeUndefinable dispatches via registry", () => {
  // The headline regression-pinner. Pre-Phase-13: matcher returns false on
  // the parametric pattern. Phase 13 lit it up via `$app`; Phase 1 of
  // typeclass-substrate-completion *repurposed* the branch onto `$el.call`
  // — same observable dispatch, new substrate.
  it("registry-level: maybeUndefinable matches a literal $el.call Maybe<Profile>", () => {
    expect(dispatchRegistry.satisfies(elCall("Maybe", [named("Profile")]), "Undefinable", GLOBAL_ONLY)).toBe(true);
  });

  it("registry-level: maybeUndefinable matches $el.call Maybe over any concrete arg", () => {
    expect(dispatchRegistry.satisfies(elCall("Maybe", [named("Number")]), "Undefinable", GLOBAL_ONLY)).toBe(true);
    expect(dispatchRegistry.satisfies(elCall("Maybe", [named("String")]), "Undefinable", GLOBAL_ONLY)).toBe(true);
    expect(dispatchRegistry.satisfies(elCall("Maybe", [elCall("List", [named("Char")])]), "Undefinable", GLOBAL_ONLY)).toBe(true);
  });

  it("registry-level: $el.call List<Profile> does NOT satisfy Undefinable", () => {
    // No `listUndefinable` registered — the matcher correctly rejects.
    expect(dispatchRegistry.satisfies(elCall("List", [named("Profile")]), "Undefinable", GLOBAL_ONLY)).toBe(false);
  });

  it("$ref FieldMetadata still dispatches (Phase 8 preview-instance preserved)", () => {
    // Regression-pin: Phase 8's fieldMetadataUndefinable ($ref: "FieldMetadata")
    // continues to match via the string-pattern branch.
    expect(dispatchRegistry.satisfies(named("FieldMetadata"), "Undefinable", GLOBAL_ONLY)).toBe(true);
    expect(dispatchRegistry.satisfies("FieldMetadata", "Undefinable", GLOBAL_ONLY)).toBe(true);
  });
});

describe("Phase 1 substrate-completion — isErasableType step 3 extended to $el.call shapes", () => {
  // Phase 8's isErasableType had: (1) peelMaybe, (2) peelToVariant Just|Nothing,
  // (3) $ref registry. Phase 13 extended (3) to also lift parametric shapes
  // to the registry. Phase 1 of typeclass-substrate-completion replaces the
  // `$app` shape recognition with `$el.call` recognition; the peelMaybe-shaped
  // $variant path keeps working unchanged.
  it("explicit $el.call Maybe<Profile> is erasable via registry", () => {
    expect(isErasableType(elCall("Maybe", [named("Profile")]))).toBe(true);
  });

  it("explicit $el.call List<Profile> is NOT erasable (no Undefinable instance)", () => {
    expect(isErasableType(elCall("List", [named("Profile")]))).toBe(false);
  });

  it("$ref FieldMetadata still erasable (Phase 8 path unchanged)", () => {
    expect(isErasableType(named("FieldMetadata"))).toBe(true);
  });

  it("plain $ref String NOT erasable (no Undefinable instance)", () => {
    expect(isErasableType(named("String"))).toBe(false);
  });
});

describe("Phase 1 substrate-completion — public API accepts FenelType | string", () => {
  it("satisfies accepts a bare string (legacy lift to $ref)", () => {
    // Phase 8 preview-instance is keyed on the string "FieldMetadata";
    // the registry lifts the bare string to {$ref: "FieldMetadata"}
    // before matching.
    expect(dispatchRegistry.satisfies("FieldMetadata", "Undefinable", GLOBAL_ONLY)).toBe(true);
  });

  it("satisfies accepts a $ref FenelType (verbose form)", () => {
    expect(dispatchRegistry.satisfies(named("FieldMetadata"), "Undefinable", GLOBAL_ONLY)).toBe(true);
  });

  it("satisfies accepts an $el.call FenelType", () => {
    expect(dispatchRegistry.satisfies(elCall("Maybe", [named("Anything")]), "Undefinable", GLOBAL_ONLY)).toBe(true);
  });

  it("resolve accepts the same widening", () => {
    const dict = dispatchRegistry.resolve(elCall("Maybe", [named("Anything")]), "Undefinable", GLOBAL_ONLY);
    expect(dict).toBeDefined();
    expect(dict?.isErasable).toBe(true);
  });

  it("implementedBy accepts the widening", () => {
    const classes = dispatchRegistry.implementedBy(elCall("Maybe", [named("Anything")]), GLOBAL_ONLY);
    expect(classes.some((tc) => tc.name === "Undefinable")).toBe(true);
  });
});
