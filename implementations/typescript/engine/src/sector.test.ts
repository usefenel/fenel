// decide-substrate Phase 8μ.1a — the `SeCtor` datatype-SET former: the four
// decider arms (emptiness / membership / disjointness / containment) + the
// `typeToSetExpr` `$variant`/`$record` projection. `SeCtor c fs` = the values
// built by ctor `c` with field-i ∈ ⟦set-i⟧ — the 6D `dt*` term-theory's SET-side
// mirror. Design: `design/mu-induction.md` §2. Brief:
// `workstreams/decide-substrate/briefs/phase-8mu-1a-sector.md`.
//
// The deciders are exercised on PURE leaves (SeEnum / SeNone / SeAll) so no
// ctx-native seam is needed, plus SeRef/named cases (ℤ⊆ℝ) that ride the standard
// decider ctx. NB: the named-subtype decider only PROVES subset, it does not
// REFUTE — so `Just ℝ ⊆ Just ℤ` is an HONEST `Nothing`, not `Just false` (the
// same reason `⟦Maybe Number⟧ ⊆ ⟦Maybe Int⟧` is `Nothing`).

import { describe, it, expect } from "vitest";
import { contains, isSubset, isDisjoint, decideEmpty } from "./set-algebra";
import { typeToSetExpr } from "./fenel-check";
import type { FenelType, SetExpr } from "./types";

// MaybeBool → "true" | "false" | "nothing" (the canonical `Just {_0}` / `Nothing`).
function mb(m: unknown): "true" | "false" | "nothing" {
  const x = m as { $tag?: string; _0?: unknown; value?: unknown };
  if (x?.$tag === "Just") return (x._0 ?? x.value) ? "true" : "false";
  return "nothing";
}

// SeCtor builders (canonical `$tag` form — the registered Se* ADT).
const ctor = (c: string, fields: unknown[]): SetExpr =>
  ({ $tag: "SeCtor", ctor: c, fields } as unknown as SetExpr);
const SECTOR_FIELD_IDS: Record<string, string> = {
  head: "60000000-0000-4000-8000-000000000001",
  tail: "60000000-0000-4000-8000-000000000002",
  other: "60000000-0000-4000-8000-000000000003",
};
const fld = (wireName: string, set: SetExpr) => ({
  $tag: "SetCtorField",
  key: wireName === "_0"
    ? { $tag: "PositionalField", index: 0 }
    : { $tag: "NamedField", ref: { $ref: SECTOR_FIELD_IDS[wireName] } },
  wireName,
  set,
});
const enumS = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs } as unknown as SetExpr);
const ref = (h: string): SetExpr => ({ $tag: "SeRef", handle: h } as unknown as SetExpr);
const union = (...bs: SetExpr[]): SetExpr => ({ $tag: "SeUnion", branches: bs } as unknown as SetExpr);
const NONE: SetExpr = { $tag: "SeNone" } as unknown as SetExpr;
const ALL: SetExpr = { $tag: "SeAll" } as unknown as SetExpr;

// type-substrate P1(a) — the FIRST assertion in this file pays cold registry
// init (~6-8 s on a slow Windows host, measured both pre- and post-P1(a)) and
// therefore blew the 5 s default. It is a clock artifact, not a verdict: raise
// the budget for the entry point rather than weakening the assertion.
describe("SeCtor — emptiness (a product with an empty factor is empty)", () => {
  it("empty when SOME field set is empty", { timeout: 180_000 }, () => {
    expect(mb(decideEmpty(ctor("Cons", [fld("head", NONE), fld("tail", ALL)])))).toBe("true");
  });
  it("a nullary ctor is a point (never empty)", () => {
    expect(mb(decideEmpty(ctor("Nil", [])))).toBe("false");
  });
  it("all-nonempty fields ⇒ nonempty", () => {
    expect(mb(decideEmpty(ctor("Just", [fld("_0", enumS(1))])))).toBe("false");
  });
  it("a coercing ctor (True/False) degrades to Nothing", () => {
    expect(mb(decideEmpty(ctor("True", [])))).toBe("nothing");
  });
});

describe("SeCtor — membership (v.$tag == c ∧ every field ∈ ⟦set-i⟧)", () => {
  const justFive = ctor("Just", [fld("_0", enumS(5))]);
  it("a value with the matching tag + in-set fields is a member", () => {
    expect(mb(contains(justFive, { $tag: "Just", _0: 5 }, null))).toBe("true");
  });
  it("a field out of its set is refuted", () => {
    expect(mb(contains(justFive, { $tag: "Just", _0: 6 }, null))).toBe("false");
  });
  it("a mismatched tag is refuted", () => {
    expect(mb(contains(justFive, { $tag: "Nothing" }, null))).toBe("false");
  });
  it("a scalar value is not in any SeCtor", () => {
    expect(mb(contains(justFive, 5, null))).toBe("false");
  });
});

// field-identity Phase 4 (D4) — the rename adversarial oracle: a persisted
// SetExpr freezes `wireName` at write time; membership must read the host
// through the key's CURRENT wire projection when the registry knows the key,
// and keep the embedded wireName only as the unknown-key fallback. The fixture
// seam (`__registerFieldCurrentWireFixtureForTests`) plays the registry's
// field-entity `currentCodeName` answer, divorcing the frozen wire from the
// current one without constructing a renamed registry.
describe("SeCtor — membership tracks the key's CURRENT wire across a rename (D4)", () => {
  const RENAMED_ID = "60000000-0000-4000-8000-00000000000e";
  const frozen = () =>
    ctor("Bot", [
      {
        $tag: "SetCtorField",
        key: { $tag: "NamedField", ref: { $ref: RENAMED_ID } },
        wireName: "token", // frozen at write time — the OLD spelling
        set: enumS("t-1"),
      },
    ]);

  it("re-projects a registry-known key to its NEW wire (fresh values match; the frozen wire is dead)", async () => {
    const { __registerFieldCurrentWireFixtureForTests, __clearFieldCurrentWireFixturesForTests } =
      await import("./engine-bodies-dispatch");
    __registerFieldCurrentWireFixtureForTests(RENAMED_ID, "apiToken");
    try {
      // A fresh value carries the CURRENT wire — membership must track it.
      expect(mb(contains(frozen(), { $tag: "Bot", apiToken: "t-1" }, null))).toBe("true");
      // A value still carrying only the OLD wire lacks the current axis.
      expect(mb(contains(frozen(), { $tag: "Bot", token: "t-1" }, null))).toBe("false");
      // Out-of-set under the NEW wire still refutes (the set still binds).
      expect(mb(contains(frozen(), { $tag: "Bot", apiToken: "t-2" }, null))).toBe("false");
    } finally {
      __clearFieldCurrentWireFixturesForTests();
    }
  });

  it("an unknown key falls back to the embedded wireName (codec hint)", () => {
    // No fixture, no registry row for this UUID: the frozen wire is the read.
    expect(mb(contains(frozen(), { $tag: "Bot", token: "t-1" }, null))).toBe("true");
    expect(mb(contains(frozen(), { $tag: "Bot", apiToken: "t-1" }, null))).toBe("false");
  });
});

describe("SeCtor — disjointness (dtConflict distinctness set-side)", () => {
  it("distinct ctors are disjoint", () => {
    expect(mb(isDisjoint(ctor("Nothing", []), ctor("Just", [fld("_0", ALL)])))).toBe("true");
  });
  it("same ctor with a disjoint field pair is disjoint", () => {
    expect(mb(isDisjoint(ctor("Just", [fld("_0", enumS(1))]), ctor("Just", [fld("_0", enumS(2))])))).toBe("true");
  });
  it("same ctor with overlapping fields is NOT disjoint", () => {
    expect(mb(isDisjoint(ctor("Just", [fld("_0", enumS(1))]), ctor("Just", [fld("_0", enumS(1, 2))])))).toBe("false");
  });
  it("a missing semantic key stays uncertain while a later aligned pair can prove disjointness, independent of order", () => {
    const missingFirst = ctor("Pair", [fld("head", enumS(1)), fld("tail", enumS(1))]);
    const decisiveFirst = ctor("Pair", [fld("tail", enumS(1)), fld("head", enumS(1))]);
    const against = ctor("Pair", [fld("other", enumS(1)), fld("tail", enumS(2))]);
    expect(mb(isDisjoint(missingFirst, against))).toBe("true");
    expect(mb(isDisjoint(decisiveFirst, against))).toBe("true");
  });
  it("a coercing ctor degrades to Nothing", () => {
    expect(mb(isDisjoint(ctor("True", []), ctor("False", [])))).toBe("nothing");
  });
});

describe("SeCtor — containment (dtDerive injectivity set-side)", () => {
  it("same ctor, fieldwise ⊆ ⇒ subset", () => {
    expect(mb(isSubset(ctor("Just", [fld("_0", enumS(1))]), ctor("Just", [fld("_0", enumS(1, 2))])))).toBe("true");
  });
  it("same ctor, a field escapes ⇒ NOT subset (a is nonempty)", () => {
    expect(mb(isSubset(ctor("Just", [fld("_0", enumS(1, 2))]), ctor("Just", [fld("_0", enumS(1))])))).toBe("false");
  });
  it("a missing semantic key stays uncertain while a later aligned pair can refute subset, independent of order", () => {
    const missingFirst = ctor("Pair", [fld("head", enumS(1)), fld("tail", enumS(1, 2))]);
    const decisiveFirst = ctor("Pair", [fld("tail", enumS(1, 2)), fld("head", enumS(1))]);
    const against = ctor("Pair", [fld("other", enumS(1)), fld("tail", enumS(1))]);
    expect(mb(isSubset(missingFirst, against))).toBe("false");
    expect(mb(isSubset(decisiveFirst, against))).toBe("false");
  });
  it("distinct ctors ⇒ NOT subset when the sub is nonempty", () => {
    expect(mb(isSubset(ctor("Nothing", []), ctor("Just", [fld("_0", ALL)])))).toBe("false");
  });
  it("covariant named fields — Just ℤ ⊆ Just ℝ", () => {
    expect(mb(isSubset(ctor("Just", [fld("_0", ref("ℤ"))]), ctor("Just", [fld("_0", ref("ℝ"))])))).toBe("true");
  });
  it("a SeCtor ⊆ a SeUnion of SeCtors (via the union tail rule)", () => {
    const b = union(ctor("Nothing", []), ctor("Just", [fld("_0", enumS(1, 2))]));
    expect(mb(isSubset(ctor("Just", [fld("_0", enumS(1))]), b))).toBe("true");
  });
});

describe("SeCtor — the typeToSetExpr projection end-to-end", () => {
  // field-identity Phase 4 re-pin: the fixture must be identity-total — the
  // Phase-3 stabilization posture projects a KEYLESS anonymous shape to the
  // unconstrained ⊤ (`SeAll`, no throw; pinned in type-to-set.test.ts), so a
  // keyless `$variant` here would no longer exercise the SeUnion projection
  // this block exists to pin. `_0` carries its canonical positional key.
  const maybe = (elem: string): FenelType =>
    ({
      $variant: {
        cases: [
          { name: "Nothing", fields: [] },
          {
            name: "Just",
            fields: [
              { name: "_0", key: { $tag: "PositionalField", index: 0 }, type: { $ref: elem } },
            ],
          },
        ],
      },
    } as unknown as FenelType);

  it("⟦Maybe Int⟧ ⊆ ⟦Maybe Number⟧ — recursive-ADT covariant containment (was Nothing pre-8μ.1a)", () => {
    expect(mb(isSubset(typeToSetExpr(maybe("Int")), typeToSetExpr(maybe("Number"))))).toBe("true");
  });

  it("a variant projects to a SeUnion of SeCtors (not the old SeAll collapse)", () => {
    const proj = typeToSetExpr(maybe("Int")) as { $tag?: string; branches?: unknown[] };
    expect(proj.$tag).toBe("SeUnion");
    expect(proj.branches?.length).toBe(2);
  });
});
