import { describe, it, expect } from "vitest";
import {
  isSubtype,
  isSubset as decideSubset,
  isSubsetB as isSubset,
  unfold,
  normalize,
  isEmptyB as isEmpty,
  isEmpty as decideEmpty,
  isSatisfiableB as isSatisfiable,
  isDisjoint as decideDisjoint,
  isDisjointB as isDisjoint,
  containsB as contains,
  contains as decideContains,
  setIntervalContains,
} from "./set-algebra";
import { setExprToDollarKey, setExprToTag } from "./set-marker";
import { Nat, Int, Bool, Char, Str, List, Maybe, Refined, Just, Nothing } from "./type-foundation";
import { regexStringToPattern } from "./regex-shim";
import type { FenelType, SetExpr } from "./types";

import { setDefaultTimeout } from "bun:test";

// GLOBAL_ONLY: these structural and built-in-domain fixtures have no request account;
// contains still uses the dispatched test harness's actual reader context.

describe("exact integer interval membership", () => {
  // GLOBAL_ONLY: these structural fixtures and built-in named domains have no request account.
  const just = (answer: boolean) => ({ $tag: "Just", _0: answer });
  const unknown = { $tag: "Nothing" };
  const nat = (digits: string) => ({ $tag: "Nat", digits });
  const int = (digits: string) => ({ $tag: "Int", digits });
  const pureNat = (n: number): unknown => n === 0 ? { $tag: "Zero" } : { $tag: "Succ", _0: pureNat(n - 1) };
  const pureInt = (n: number, negative: boolean) => ({ $tag: "Int", magnitude: pureNat(n), negative: { $tag: negative ? "True" : "False" } });
  const interval = (lo: number | string | null, hi: number | string | null, inclusive = true): Extract<SetExpr, { $tag: "SeInterval" }> => ({
    $tag: "SeInterval", interval: {
      lo: lo === null ? Nothing : Just({ value: lo, inclusive }),
      hi: hi === null ? Nothing : Just({ value: hi, inclusive }),
    },
  });

  it("shares the exact boxed and pure Nat/Int numeric judgment", () => {
    for (const value of [nat("9007199254740993"), int("9007199254740993"), pureNat(3), pureInt(3, false)]) {
      expect(decideContains(interval(1, null), value, null)).toEqual(just(true));
      expect(setIntervalContains(interval(1, null), value)).toEqual(just(true));
      expect(decideContains(interval(null, 2), value, null)).toEqual(just(false));
    }
    for (const value of [int("-9007199254740993"), pureInt(3, true)]) {
      expect(decideContains(interval(null, -1), value, null)).toEqual(just(true));
      expect(decideContains(interval(0, null), value, null)).toEqual(just(false));
    }
    expect(decideContains(interval(3, 3), pureNat(3), null)).toEqual(just(true));
    expect(decideContains(interval(3, 4, false), pureNat(3), null)).toEqual(just(false));
    expect(decideContains(interval(null, 3.5), pureNat(3), null)).toEqual(just(true));
    expect(decideContains(interval(null, -1.5), pureInt(2, true), null)).toEqual(just(true));
    expect(decideContains(interval(null, -1.5), pureInt(1, true), null)).toEqual(just(false));
  });

  it("keeps Number/String semantics and exact admission/endpoint fences", () => {
    expect(decideContains(interval(0, 10, false), 5, null)).toEqual(just(true));
    expect(decideContains(interval("a", "z", false), "m", null)).toEqual(just(true));
    expect(decideContains(interval("a", "z"), nat("1"), null)).toEqual(just(false));
    for (const value of [nat("01"), int("-0"), true, [], {}])
      expect(decideContains(interval(0, 255), value, null)).toEqual(just(false));
    for (const value of [nat("9".repeat(4097)), pureNat(128), pureInt(128, false)]) {
      expect(decideContains(interval(0, 255), value, null)).toEqual(unknown);
      expect(decideSubset({ $tag: "SeEnum", values: [value] }, interval(0, 255))).toEqual(unknown);
      expect(decideDisjoint({ $tag: "SeEnum", values: [value] }, interval(0, 255))).toEqual(unknown);
    }
    for (const bound of [Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(decideContains(interval(0, bound), pureNat(1), null)).toEqual(unknown);
    const unreadable = Object.defineProperty({}, "$tag", { enumerable: true, get() { throw new Error("Do not run candidate getters."); } });
    expect(decideContains(interval(0, 255), unreadable, null)).toEqual(unknown);
  });

  it("uses the same interval for PositiveNat and NonNegInt refinements", () => {
    const positive: SetExpr = { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "Nat" }, interval(1, null)] };
    const nonnegative: SetExpr = { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "Int" }, interval(0, null)] };
    expect(decideContains(positive, nat("9007199254740993"), null)).toEqual(just(true));
    expect(decideContains(positive, pureNat(3), null)).toEqual(just(true));
    expect(decideContains(positive, nat("0"), null)).toEqual(just(false));
    expect(decideContains(nonnegative, int("9007199254740993"), null)).toEqual(just(true));
    expect(decideContains(nonnegative, pureInt(3, false), null)).toEqual(just(true));
    expect(decideContains(nonnegative, int("-1"), null)).toEqual(just(false));
  });

  it("normalization preserves unknown constraints and structural enum holes", () => {
    const tooLarge = nat("9".repeat(4097));
    const meet: SetExpr = { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [tooLarge] }, interval(0, 10)] };
    const normalizedMeet = normalize(meet);
    expect(decideContains(normalizedMeet, tooLarge, null)).toEqual(unknown);
    expect((normalizedMeet as any).$tag).toBe("SeIntersect");
    const hole: SetExpr = { $tag: "SeDiff", left: interval(0, 2), right: { $tag: "SeEnum", values: [1] } };
    const normalizedHole = normalize(hole);
    expect(decideContains(normalizedHole, 1, null)).toEqual(just(false));
    for (const value of [nat("1"), int("1")]) {
      expect(decideContains(hole, value, null)).toEqual(just(false));
      expect(decideContains(normalizedHole, value, null)).toEqual(just(false));
    }
    for (const value of [pureNat(1), pureInt(1, false)]) {
      expect(decideContains(hole, value, null)).toEqual(unknown);
      expect(decideContains(normalizedHole, value, null)).toEqual(unknown);
    }
  });
});

// type-substrate P1(a) — bun's 5 s per-test default is wrong for this file: it
// drives the INTERPRETED Fenel deciders, and on a slow Windows host individual
// assertions measured 5-75 s BEFORE this phase and after it (verdicts identical
// either side). A suite that reports clock as failure is a gate nobody can read,
// which is how a real red in the sibling tcb-recheck suite went unnoticed. Raise
// the budget; never weaken an assertion to fit it.
setDefaultTimeout(300_000);

// ---------------------------------------------------------------------------
// Atoms & trivial rules
// ---------------------------------------------------------------------------

describe("isSubtype — atoms", () => {
  it("$void ⊆ anything", () => {
    expect(isSubtype({ $void: true }, { $unit: true })).toBe(true);
    expect(isSubtype({ $void: true }, { $ref: "Int" })).toBe(true);
  });

  it("$unit ⊆ $unit", () => {
    expect(isSubtype({ $unit: true }, { $unit: true })).toBe(true);
  });

  it("$unit not ⊆ $void", () => {
    expect(isSubtype({ $unit: true }, { $void: true })).toBe(false);
  });

  it("structural identity via JSON key", () => {
    const t: FenelType = { $ref: "Foo" };
    expect(isSubtype(t, t)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Named hierarchy (delegates to existing NAMED_HIERARCHY)
// ---------------------------------------------------------------------------

describe("isSubtype — named hierarchy", () => {
  it("Nat ⊆ Int (named, via NAMED_HIERARCHY)", () => {
    expect(isSubtype({ $ref: "Nat" }, { $ref: "Int" })).toBe(true);
  });

  it("Int ⊆ Real", () => {
    expect(isSubtype({ $ref: "Int" }, { $ref: "ℝ" })).toBe(true);
  });

  it("Bool not ⊆ Int", () => {
    expect(isSubtype({ $ref: "Bool" }, { $ref: "Int" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Variant — width subtyping with covariant case fields
// ---------------------------------------------------------------------------

describe("isSubtype — $variant", () => {
  const Color2: FenelType = {
    $variant: { cases: [{ name: "Red", label: Nothing }, { name: "Blue", label: Nothing }] },
  };
  const Color3: FenelType = {
    $variant: {
      cases: [{ name: "Red", label: Nothing }, { name: "Blue", label: Nothing }, { name: "Green", label: Nothing }],
    },
  };

  it("subset of cases ⊆ superset of cases", () => {
    expect(isSubtype(Color2, Color3)).toBe(true);
  });

  it("superset of cases not ⊆ subset of cases", () => {
    expect(isSubtype(Color3, Color2)).toBe(false);
  });

  it("identical variants are subtypes of each other", () => {
    expect(isSubtype(Color2, Color2)).toBe(true);
  });

  it("variant with payload covariance", () => {
    const A: FenelType = {
      $variant: {
        cases: [
          { name: "Some", label: Nothing, fields: [{ name: "v", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing }] },
        ],
      },
    };
    const B: FenelType = {
      $variant: {
        cases: [
          { name: "Some", label: Nothing, fields: [{ name: "v", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing }] },
        ],
      },
    };
    expect(isSubtype(A, B)).toBe(true); // Nat ⊆ Int → Some(Nat) ⊆ Some(Int)
    expect(isSubtype(B, A)).toBe(false);
  });

  it("mismatched field count → not a subtype", () => {
    const A: FenelType = {
      $variant: {
        cases: [{ name: "X", label: Nothing, fields: [{ name: "a", label: Nothing, type: { $unit: true }, meta: {}, ui: Nothing }] }],
      },
    };
    const B: FenelType = {
      $variant: { cases: [{ name: "X", label: Nothing }] },
    };
    expect(isSubtype(A, B)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Record — width + depth subtyping
// ---------------------------------------------------------------------------

describe("isSubtype — $record", () => {
  it("more fields in subtype ⊆ fewer fields in supertype (width)", () => {
    const A: FenelType = {
      $record: {
        fields: [
          { name: "x", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing },
          { name: "y", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing },
        ],
      },
    };
    const B: FenelType = {
      $record: { fields: [{ name: "x", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing }] },
    };
    expect(isSubtype(A, B)).toBe(true);
  });

  it("missing required field → not a subtype", () => {
    const A: FenelType = {
      $record: { fields: [{ name: "x", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing }] },
    };
    const B: FenelType = {
      $record: {
        fields: [
          { name: "x", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing },
          { name: "y", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing },
        ],
      },
    };
    expect(isSubtype(A, B)).toBe(false);
  });

  it("Maybe-typed field in supertype tolerates missing in subtype", () => {
    const A: FenelType = {
      $record: { fields: [{ name: "x", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing }] },
    };
    const B: FenelType = {
      $record: {
        fields: [
          { name: "x", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing },
          { name: "y", label: Nothing, type: Maybe({ $ref: "Nat" }), meta: {}, ui: Nothing },
        ],
      },
    };
    expect(isSubtype(A, B)).toBe(true);
  });

  it("required (non-Maybe) in supertype, Maybe in subtype → not a subtype", () => {
    const A: FenelType = {
      $record: {
        fields: [{ name: "x", label: Nothing, type: Maybe({ $ref: "Nat" }), meta: {}, ui: Nothing }],
      },
    };
    const B: FenelType = {
      $record: { fields: [{ name: "x", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing }] },
    };
    expect(isSubtype(A, B)).toBe(false);
  });

  it("depth: covariant on field types (Nat ⊆ Int)", () => {
    const A: FenelType = {
      $record: { fields: [{ name: "v", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing }] },
    };
    const B: FenelType = {
      $record: { fields: [{ name: "v", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing }] },
    };
    expect(isSubtype(A, B)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tuple
// ---------------------------------------------------------------------------

describe("isSubtype — $tuple", () => {
  it("same length, pairwise covariant", () => {
    const A: FenelType = { $tuple: [{ $ref: "Nat" }, { $ref: "Nat" }] };
    const B: FenelType = { $tuple: [{ $ref: "Int" }, { $ref: "Int" }] };
    expect(isSubtype(A, B)).toBe(true);
  });

  it("mismatched length → not a subtype", () => {
    const A: FenelType = { $tuple: [{ $ref: "Nat" }] };
    const B: FenelType = { $tuple: [{ $ref: "Nat" }, { $ref: "Nat" }] };
    expect(isSubtype(A, B)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// $map — heterogeneous indexed dictionary with SetExpr-keyed domain
// ---------------------------------------------------------------------------

// type-substrate P1(a.7) — the sound `$map` subset arm ABSTAINS in both
// polarities, so `isSubtype` (which is `isJustTrue ∘ dispatchedSubset`, i.e.
// `Nothing → false`) is now `false` for every map pair. `ssMap` read `$map` as a
// PARTIAL DICTIONARY (`K1 ⊆ K2`) while `validationValidateMap`'s finite branch
// requires a TOTAL array of length `card`, so `Map[3,T] ⊆ Map[4,T]` was a false
// POSITIVE at an implemented arm. The two positive expectations below are
// therefore PRICED LOSSES; the negatives below keep their Bool value for a
// DIFFERENT reason (abstention also collapses to false), which is stated in
// place so a future reader does not read them as surviving refutations.
// Ledger row `t.sub.map` (THEOREM → MISSING); the named recovery is a
// key-EQUALITY-gated positive built on `conformMap`.
describe("isSubtype — $map", () => {
  it("narrower allowed keys + narrower values — PRICED LOSS at P1(a.7), was true", () => {
    const A: FenelType = { $map: { keys: { $tag: "SeEnum", values: ["a"] }, values: { $ref: "Nat" } } };
    const B: FenelType = { $map: { keys: { $tag: "SeEnum", values: ["a", "b"] }, values: { $ref: "Int" } } };
    expect(isSubtype(A, B)).toBe(false);
  });

  it("wider allowed keys → still false, but now by ABSTENTION, not refutation", () => {
    const A: FenelType = { $map: { keys: { $tag: "SeEnum", values: ["a", "b"] }, values: { $ref: "Nat" } } };
    const B: FenelType = { $map: { keys: { $tag: "SeEnum", values: ["a"] }, values: { $ref: "Int" } } };
    expect(isSubtype(A, B)).toBe(false);
  });

  it("incompatible value types → still false, but now by ABSTENTION, not refutation", () => {
    const A: FenelType = { $map: { keys: { $tag: "SeEnum", values: ["a"] }, values: { $ref: "Str" } } };
    const B: FenelType = { $map: { keys: { $tag: "SeEnum", values: ["a"] }, values: { $ref: "Int" } } };
    expect(isSubtype(A, B)).toBe(false);
  });

  it("string-keyed open map supertype — PRICED LOSS at P1(a.7), was true", () => {
    const Closed: FenelType = { $map: { keys: { $tag: "SeEnum", values: ["a", "b"] }, values: { $ref: "Int" } } };
    const Open: FenelType = { $map: { keys: { $tag: "SeRef", handle: "String" }, values: { $ref: "Int" } } };
    expect(isSubtype(Closed, Open)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// $mu — recursive types with co-inductive cycle detection
// ---------------------------------------------------------------------------

describe("isSubtype — $mu (recursive types)", () => {
  it("μX. X sound proof is fenced (degenerate bottom — must not loop)", () => {
    const Bottom: FenelType = { $mu: { var: "X", body: { $var: "X" } } };
    // type-substrate P1(a.6): the sound Tri core cannot borrow the conceptual
    // bottom theorem from a non-live μ face. The direct picker keeps its legacy
    // shortcut; isSubtype accepts only a proved Just true.
    expect(isSubtype(Bottom, Bottom)).toBe(false);
  });

  it("μX. X ⊆ anything has no public sound proof without a live bottom face", () => {
    const Bottom: FenelType = { $mu: { var: "X", body: { $var: "X" } } };
    expect(isSubtype(Bottom, { $ref: "Int" })).toBe(false);
  });

  it("List<Nat> ⊆ List<Int> via μ-encoded form", () => {
    const ListNatMu: FenelType = {
      $mu: {
        var: "X",
        body: {
          $variant: {
            cases: [
              { name: "Nil", label: Nothing },
              {
                name: "Cons",
                label: Nothing,
                fields: [
                  { name: "head", label: Nothing, type: { $ref: "Nat" }, meta: {}, ui: Nothing },
                  { name: "tail", label: Nothing, type: { $var: "X" }, meta: {}, ui: Nothing },
                ],
              },
            ],
          },
        },
      },
    };
    const ListIntMu: FenelType = {
      $mu: {
        var: "X",
        body: {
          $variant: {
            cases: [
              { name: "Nil", label: Nothing },
              {
                name: "Cons",
                label: Nothing,
                fields: [
                  { name: "head", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing },
                  { name: "tail", label: Nothing, type: { $var: "X" }, meta: {}, ui: Nothing },
                ],
              },
            ],
          },
        },
      },
    };
    expect(isSubtype(ListNatMu, ListIntMu)).toBe(true);
    expect(isSubtype(ListIntMu, ListNatMu)).toBe(false);
  });

  it("List<Color2> ⊆ List<Color3> (variant subtyping inside a recursive list)", () => {
    const C2: FenelType = {
      $variant: { cases: [{ name: "Red", label: Nothing }, { name: "Blue", label: Nothing }] },
    };
    const C3: FenelType = {
      $variant: {
        cases: [{ name: "Red", label: Nothing }, { name: "Blue", label: Nothing }, { name: "Green", label: Nothing }],
      },
    };
    expect(isSubtype(List(C2), List(C3))).toBe(true);
    expect(isSubtype(List(C3), List(C2))).toBe(false);
  });

  it("recursive type ⊆ itself", () => {
    const NatPure: FenelType = {
      $mu: {
        var: "X",
        body: {
          $variant: {
            cases: [
              { name: "Zero", label: Nothing },
              {
                name: "Succ",
                label: Nothing,
                fields: [{ name: "pred", label: Nothing, type: { $var: "X" }, meta: {}, ui: Nothing }],
              },
            ],
          },
        },
      },
    };
    expect(isSubtype(NatPure, NatPure)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sugar desugaring — $list / $maybe / $result
// ---------------------------------------------------------------------------

describe("isSubtype — List / Maybe", () => {
  it("List narrow ⊆ List wide via element subtyping", () => {
    expect(isSubtype(List({ $ref: "Nat" }), List({ $ref: "Int" }))).toBe(true);
    expect(isSubtype(List({ $ref: "Int" }), List({ $ref: "Nat" }))).toBe(false);
  });

  it("Maybe Nat ⊆ Maybe Int", () => {
    expect(isSubtype(Maybe({ $ref: "Nat" }), Maybe({ $ref: "Int" }))).toBe(true);
  });

  it("List(T) desugars consistently with the explicit μ form", () => {
    const explicitMu: FenelType = {
      $mu: {
        var: "X",
        body: {
          $variant: {
            cases: [
              { name: "Nil", label: Nothing },
              {
                name: "Cons",
                label: Nothing,
                fields: [
                  { name: "head", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing },
                  { name: "tail", label: Nothing, type: { $var: "X" }, meta: {}, ui: Nothing },
                ],
              },
            ],
          },
        },
      },
    };
    expect(isSubtype(List({ $ref: "Int" }), explicitMu)).toBe(true);
    expect(isSubtype(explicitMu, List({ $ref: "Int" }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// $opaque — sees through pure form
// ---------------------------------------------------------------------------

describe("isSubtype — $opaque", () => {
  it("Nat self-subtyping abstains through its non-live recursive pure face", () => {
    expect(isSubtype(Nat, Nat)).toBe(false);
  });

  it("Int self-subtyping abstains without keyed-product presentation scope", () => {
    expect(isSubtype(Int, Int)).toBe(false);
  });

  it("Bool ⊆ Bool", () => {
    expect(isSubtype(Bool, Bool)).toBe(true);
  });

  it("opaque without pure: name equality", () => {
    // representation-substrate Phase 5a — `repr` retired; equality is name-alone.
    const A: FenelType = { $opaque: { name: "Foo" } };
    const B: FenelType = { $opaque: { name: "Foo" } };
    const C: FenelType = { $opaque: { name: "Bar" } };
    expect(isSubtype(A, B)).toBe(true);
    expect(isSubtype(A, C)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// $refined — combines type-level + set-level subtyping
// ---------------------------------------------------------------------------

describe("isSubtype — $refined", () => {
  it("refined(Int, [0,10]) ⊆ refined(Int, [0,100]) via set-level subset", () => {
    const A: FenelType = {
      $refined: {
        base: { $ref: "Int" },
        set: { $tag: "SeInterval", interval: {
            lo: Just({ value: 0, inclusive: true }),
            hi: Just({ value: 10, inclusive: true }),
          } },
      },
    };
    const B: FenelType = {
      $refined: {
        base: { $ref: "Int" },
        set: { $tag: "SeInterval", interval: {
            lo: Just({ value: 0, inclusive: true }),
            hi: Just({ value: 100, inclusive: true }),
          } },
      },
    };
    expect(isSubtype(A, B)).toBe(true);
    expect(isSubtype(B, A)).toBe(false);
  });

  it("refined(A, S) ⊆ A (forget refinement)", () => {
    const A: FenelType = {
      $refined: {
        base: { $ref: "Int" },
        set: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Nothing } },
      },
    };
    expect(isSubtype(A, { $ref: "Int" })).toBe(true);
  });

  it("A not ⊆ refined(A, S) without value-level proof", () => {
    const A: FenelType = { $ref: "Int" };
    const B: FenelType = {
      $refined: {
        base: { $ref: "Int" },
        set: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Nothing } },
      },
    };
    expect(isSubtype(A, B)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// unfold — one-step μ unfolding with substitution
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 3 — Char and Str.pure = List(Char)
// ---------------------------------------------------------------------------

describe("isSubtype — Char", () => {
  it("Char ⊆ Char", () => {
    expect(isSubtype(Char, Char)).toBe(true);
  });

  it("Char ⊆ Nat cannot borrow the opaque/refined pure carrier", () => {
    expect(isSubtype(Char, Nat)).toBe(false);
  });

  it("Nat not ⊆ Char (no value-level proof of bound)", () => {
    expect(isSubtype(Nat, Char)).toBe(false);
  });

  it("a tighter Char-range refinement ⊆ Char", () => {
    const Ascii: FenelType = Refined(Char, { $tag: "SeInterval", interval: {
        lo: Just({ value: 0, inclusive: true }),
        hi: Just({ value: 127, inclusive: true }),
      } });
    expect(isSubtype(Ascii, Char)).toBe(true);
    expect(isSubtype(Char, Ascii)).toBe(false);
  });
});

describe("isSubtype — Str via List(Char)", () => {
  it("Str ⊆ Str abstains without validation-source context", () => {
    expect(isSubtype(Str, Str)).toBe(false);
  });

  it("List(Char) ⊆ Str abstains without validation-source context", () => {
    expect(isSubtype(List(Char), Str)).toBe(false);
  });

  it("Str ⊆ List(Char) abstains without validation-source context", () => {
    expect(isSubtype(Str, List(Char))).toBe(false);
  });

  it("List(Nat) not ⊆ Str (Nat is wider than Char)", () => {
    expect(isSubtype(List(Nat), Str)).toBe(false);
  });

  it("List(Ascii) ⊆ Str abstains at the rebindable Char reference", () => {
    const Ascii: FenelType = Refined(Char, { $tag: "SeInterval", interval: {
        lo: Just({ value: 0, inclusive: true }),
        hi: Just({ value: 127, inclusive: true }),
      } });
    expect(isSubtype(List(Ascii), Str)).toBe(false);
  });

  it("Str not ⊆ List(Bool)", () => {
    expect(isSubtype(Str, List(Bool))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 5a — isSubset reasons about regex patterns via Brzozowski derivatives
// ---------------------------------------------------------------------------

const pat = (p: string): SetExpr => {
  const parsed = regexStringToPattern(p);
  if (!parsed) throw new Error(`pat: invalid regex /${p}/`);
  return { $tag: "SePattern", pattern: parsed };
};

describe("isSubset — $pattern subset via regex-shim engine", () => {
  it("identity: same pattern", () => {
    expect(isSubset(pat("^[a-z]+$"), pat("^[a-z]+$"))).toBe(true);
  });

  it("single char ⊆ char class", () => {
    expect(isSubset(pat("^a$"), pat("^[a-z]$"))).toBe(true);
  });

  it("narrower char class ⊆ wider char class", () => {
    expect(isSubset(pat("^[a-c]$"), pat("^[a-z]$"))).toBe(true);
    expect(isSubset(pat("^[a-z]$"), pat("^[a-c]$"))).toBe(false);
  });

  it("a+ ⊆ a* (one-or-more inside zero-or-more)", () => {
    expect(isSubset(pat("^a+$"), pat("^a*$"))).toBe(true);
  });

  it("a* ⊄ a+ (zero-or-more accepts empty, one-or-more does not)", () => {
    expect(isSubset(pat("^a*$"), pat("^a+$"))).toBe(false);
  });

  it("specific string ⊆ wildcard (.*)", () => {
    expect(isSubset(pat("^abc$"), pat("^.*$"))).toBe(true);
  });

  it("alternation ⊆ char class containing both", () => {
    expect(isSubset(pat("^(a|b)$"), pat("^[a-c]$"))).toBe(true);
  });

  it("alternation ⊄ subset class", () => {
    expect(isSubset(pat("^(a|b|c)$"), pat("^[a-b]$"))).toBe(false);
  });

  it("unanchored — contains pattern ⊆ broader contains", () => {
    expect(isSubset(pat("abc"), pat("a.*c"))).toBe(true);
  });

  it("disjoint single chars are not subtypes", () => {
    expect(isSubset(pat("^a$"), pat("^b$"))).toBe(false);
  });

  it("digit class ⊆ word class", () => {
    expect(isSubset(pat("^\\d+$"), pat("^\\w+$"))).toBe(true);
  });

  it("word class ⊄ digit class (word includes letters)", () => {
    expect(isSubset(pat("^\\w+$"), pat("^\\d+$"))).toBe(false);
  });

  it("specific email-shaped ⊆ broader contains-@", () => {
    // ^[a-z]+@[a-z]+\.[a-z]+$ ⊆ unanchored pattern requiring @
    expect(isSubset(pat("^[a-z]+@[a-z]+\\.[a-z]+$"), pat("@"))).toBe(true);
  });

  it("anchored prefix ⊆ unanchored substring", () => {
    expect(isSubset(pat("^abc"), pat("abc"))).toBe(true);
  });

  it("unanchored ⊄ anchored exact match", () => {
    // "abc" matches anything containing abc; "^abc$" matches only "abc"
    expect(isSubset(pat("abc"), pat("^abc$"))).toBe(false);
  });

  it("a{3} ⊆ a+", () => {
    expect(isSubset(pat("^a{3}$"), pat("^a+$"))).toBe(true);
  });

  it("a{2,4} ⊆ a+", () => {
    expect(isSubset(pat("^a{2,4}$"), pat("^a+$"))).toBe(true);
  });

  it("a+ ⊄ a{2,4}", () => {
    // a+ allows 1 or 5+, a{2,4} requires 2-4
    expect(isSubset(pat("^a+$"), pat("^a{2,4}$"))).toBe(false);
  });
});

describe("isSubset — opaque $where tail stays Fenel-owned", () => {
  const opaqueWhere: SetExpr = {
    $tag: "SeWhere",
    pred: { ">=": [{ var: "value" }, { var: "min" }] },
  };

  it("re-enters the top-level judgment for right-union branches", () => {
    expect(decideSubset(opaqueWhere, {
      $tag: "SeUnion",
      branches: [structuredClone(opaqueWhere), { $tag: "SeEnum", values: [1] }],
    })).toEqual({ $tag: "Just", _0: true });
  });

  it("does not falsely refute an opaque set against an empty right union", () => {
    expect(decideSubset(opaqueWhere, {
      $tag: "SeUnion",
      branches: [],
    })).toEqual({ $tag: "Nothing" });
  });

  it("re-enters the top-level judgment for every right-intersect branch", () => {
    expect(decideSubset(opaqueWhere, {
      $tag: "SeIntersect",
      branches: [structuredClone(opaqueWhere), { $tag: "SeAll" }],
    })).toEqual({ $tag: "Just", _0: true });
  });
});

// ---------------------------------------------------------------------------
// normalize — disjointness detection across enum / pattern / named
// ---------------------------------------------------------------------------

describe("normalize — disjoint detection", () => {
  it("empty $enum collapses to $none", () => {
    expect(setExprToDollarKey(normalize({ $tag: "SeEnum", values: [] }))).toEqual({ $none: true });
  });

  it("disjoint enums collapse to $none", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [3, 4] }] };
    expect(setExprToDollarKey(normalize(set))).toEqual({ $none: true });
  });

  it("overlapping enums intersect to common values", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [1, 2, 3] }, { $tag: "SeEnum", values: [2, 3, 4] }] };
    const norm = setExprToDollarKey(normalize(set)) as Record<string, unknown>;
    expect(norm).toHaveProperty("$enum");
    expect((norm as { $enum: number[] }).$enum.sort()).toEqual([2, 3]);
  });

  it("enum filtered by pattern (mismatch ⇒ $none)", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: ["abc"] }, pat("^[0-9]+$")] };
    expect(setExprToDollarKey(normalize(set))).toEqual({ $none: true });
  });

  it("enum filtered by pattern (some match ⇒ enum kept tight)", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [
        { $tag: "SeEnum", values: ["abc", "123", "456"] },
        pat("^[0-9]+$"),
      ] };
    expect(setExprToDollarKey(normalize(set))).toEqual({ $enum: ["123", "456"] });
  });

  it("enum filtered by named set (format:email mismatch ⇒ $none)", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [
        { $tag: "SeEnum", values: ["not-an-email"] },
        { $tag: "SeRef", handle: "format:email" },
      ] };
    expect(setExprToDollarKey(normalize(set))).toEqual({ $none: true });
  });

  it("enum filtered by named set (format:email pass ⇒ enum kept)", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [
        { $tag: "SeEnum", values: ["a@b.com", "not-email"] },
        { $tag: "SeRef", handle: "format:email" },
      ] };
    expect(setExprToDollarKey(normalize(set))).toEqual({ $enum: ["a@b.com"] });
  });

  it("$where with cross-field var is preserved (opaque)", () => {
    // $where referencing other fields can't be filtered against just the value
    const set: SetExpr = { $tag: "SeIntersect", branches: [
        { $tag: "SeEnum", values: [1, 2, 3] },
        { $tag: "SeWhere", pred: { ">=": [{ var: "value" }, { var: "min" }] } },
      ] };
    const norm = setExprToDollarKey(normalize(set)) as Record<string, unknown>;
    // The $where should be retained, not filtered against (no ctx available)
    expect("$intersect" in norm).toBe(true);
  });

  it("complex chain: enum ∩ interval ∩ pattern ∩ named", () => {
    // [50, "abc", 25] ∩ [0,100] = [50, 25]; ∩ ^[0-9]+$ = ["50" doesn't match number, but
    // we keep numeric values; for strict mismatch detection on numeric vs string pattern,
    // the pattern doesn't match a number primitive, so they get filtered)
    const set: SetExpr = { $tag: "SeIntersect", branches: [
        { $tag: "SeEnum", values: [50, 25, 250] },
        { $tag: "SeInterval", interval: {
            lo: Just({ value: 0, inclusive: true }),
            hi: Just({ value: 100, inclusive: true }),
          } },
      ] };
    const norm = setExprToDollarKey(normalize(set));
    expect(norm).toHaveProperty("$enum");
    expect((norm as { $enum: number[] }).$enum.sort()).toEqual([25, 50]);
  });

  it("an interval minus one scalar retains the structural enum hole", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeInterval", interval: {
            lo: Just({ value: 0, inclusive: true }),
            hi: Just({ value: 100, inclusive: true }),
          } }, right: { $tag: "SeEnum", values: [42] } };
    const normalized = normalize(set);
    expect(setExprToDollarKey(normalized)).toHaveProperty("$diff");
    expect(contains(normalized, 41, null)).toBe(true);
    expect(contains(normalized, 42, null)).toBe(false);
    expect(contains(normalized, 101, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isEmpty / isSatisfiable
// ---------------------------------------------------------------------------

describe("isEmpty / isSatisfiable", () => {
  it("$none is empty", () => {
    expect(isEmpty({ $tag: "SeNone" })).toBe(true);
    expect(isSatisfiable({ $tag: "SeNone" })).toBe(false);
  });

  it("$all is satisfiable", () => {
    expect(isEmpty({ $tag: "SeAll" })).toBe(false);
    expect(isSatisfiable({ $tag: "SeAll" })).toBe(true);
  });

  it("empty enum is empty", () => {
    expect(isEmpty({ $tag: "SeEnum", values: [] })).toBe(true);
  });

  it("non-empty enum is satisfiable", () => {
    expect(isSatisfiable({ $tag: "SeEnum", values: [1] })).toBe(true);
  });

  it("disjoint intervals via intersect are empty", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [
        { $tag: "SeInterval", interval: {
            lo: Just({ value: 0, inclusive: true }),
            hi: Just({ value: 10, inclusive: true }),
          } },
        { $tag: "SeInterval", interval: {
            lo: Just({ value: 20, inclusive: true }),
            hi: Just({ value: 30, inclusive: true }),
          } },
      ] };
    expect(isEmpty(set)).toBe(true);
  });

  it("disjoint enums via intersect are empty", () => {
    expect(isEmpty({ $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [1] }, { $tag: "SeEnum", values: [2] }] })).toBe(true);
  });

  it("enum mismatching pattern is empty", () => {
    expect(
      isEmpty({ $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: ["abc"] }, pat("^[0-9]+$")] }),
    ).toBe(true);
  });

  it("complement of universe is empty", () => {
    expect(isEmpty({ $tag: "SeComplement", inner: { $tag: "SeAll" } })).toBe(true);
  });

  it("difference of universe and universe is empty", () => {
    expect(isEmpty({ $tag: "SeDiff", left: { $tag: "SeAll" }, right: { $tag: "SeAll" } })).toBe(true);
  });

  it("non-empty interval is satisfiable", () => {
    expect(
      isSatisfiable({ $tag: "SeInterval", interval: {
          lo: Just({ value: 0, inclusive: true }),
          hi: Just({ value: 10, inclusive: true }),
        } }),
    ).toBe(true);
  });

  it("'everything except one number' is satisfiable", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeAll" }, right: { $tag: "SeEnum", values: [42] } };
    expect(isSatisfiable(set)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isDisjoint — provable A ∩ B = ∅
// ---------------------------------------------------------------------------

describe("isDisjoint", () => {
  it("equal SeRef handles are Fenel-decided as non-disjoint", () => {
    const ref: SetExpr = { $tag: "SeRef", handle: "Nat" };
    expect(decideDisjoint(ref, structuredClone(ref))).toEqual({
      $tag: "Just",
      _0: false,
    });
  });

  it("$none on either side ⇒ disjoint", () => {
    expect(isDisjoint({ $tag: "SeNone" }, { $tag: "SeAll" })).toBe(true);
    expect(isDisjoint({ $tag: "SeAll" }, { $tag: "SeNone" })).toBe(true);
  });

  it("$all ∩ $all is not disjoint", () => {
    expect(isDisjoint({ $tag: "SeAll" }, { $tag: "SeAll" })).toBe(false);
  });

  it("disjoint enums", () => {
    expect(isDisjoint({ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [3, 4] })).toBe(true);
    expect(isDisjoint({ $tag: "SeEnum", values: [1, 2] }, { $tag: "SeEnum", values: [2, 3] })).toBe(false);
  });

  it("disjoint intervals", () => {
    const a: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } };
    const b: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 20, inclusive: true }), hi: Just({ value: 30, inclusive: true }) } };
    const c: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 5, inclusive: true }), hi: Just({ value: 15, inclusive: true }) } };
    expect(isDisjoint(a, b)).toBe(true);
    expect(isDisjoint(a, c)).toBe(false);
  });

  it("enum vs interval — value outside", () => {
    expect(isDisjoint(
      { $tag: "SeEnum", values: [50, 100] },
      { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } },
    )).toBe(true);
  });

  it("enum vs pattern — no value matches", () => {
    expect(isDisjoint({ $tag: "SeEnum", values: ["abc"] }, pat("^[0-9]+$"))).toBe(true);
    expect(isDisjoint({ $tag: "SeEnum", values: ["123"] }, pat("^[0-9]+$"))).toBe(false);
  });

  it("disjoint regex patterns", () => {
    expect(isDisjoint(pat("^a$"), pat("^b$"))).toBe(true);
    expect(isDisjoint(pat("^[a-c]$"), pat("^[d-f]$"))).toBe(true);
  });

  it("overlapping regex patterns", () => {
    expect(isDisjoint(pat("^a$"), pat("^[a-z]$"))).toBe(false);
    expect(isDisjoint(pat("^a*$"), pat("^a+$"))).toBe(false);
  });

  it("regex pattern vs numeric interval — always disjoint", () => {
    const numInterval: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } };
    expect(isDisjoint(pat("^[a-z]+$"), numInterval)).toBe(true);
    expect(isDisjoint(numInterval, pat("^.*$"))).toBe(true);
  });

  it("regex pattern vs string interval — not auto-disjoint (could overlap)", () => {
    // Alphabetical interval ["a", "z"] could overlap a pattern like "^[a-c]+$"
    const strInterval: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: "a", inclusive: true }), hi: Just({ value: "z", inclusive: true }) } };
    // We don't decide string-interval ∩ pattern; conservative false
    expect(isDisjoint(pat("^[a-c]+$"), strInterval)).toBe(false);
  });

  // 2b-complement — ¬X ∩ Y = ∅ iff Y ⊆ X. The decision re-enters the Fenel
  // setAlgebraIsSubset over a re-marshalled subset ADT (cross-query re-entry).
  // Exercises complement as BOTH the a-leaf and the b-leaf (swap interaction).
  it("complement vs enum — Y ⊆ X ⇒ disjoint (complement as a-leaf)", () => {
    // ¬{1,2,3} ∩ {2}: {2} ⊆ {1,2,3} ⇒ disjoint.
    expect(isDisjoint({ $tag: "SeComplement", inner: { $tag: "SeEnum", values: [1, 2, 3] } }, { $tag: "SeEnum", values: [2] })).toBe(true);
  });

  it("complement vs enum — Y ⊄ X ⇒ not disjoint (complement as a-leaf)", () => {
    // ¬{1,2,3} ∩ {2,5}: 5 ∉ {1,2,3} ⇒ shared element 5 ⇒ not disjoint.
    expect(isDisjoint({ $tag: "SeComplement", inner: { $tag: "SeEnum", values: [1, 2, 3] } }, { $tag: "SeEnum", values: [2, 5] })).toBe(false);
  });

  it("enum vs complement — Y ⊆ X ⇒ disjoint (complement as b-leaf / swap)", () => {
    // {2} ∩ ¬{1,2,3}: routes through the symmetric swap, same verdict.
    expect(isDisjoint({ $tag: "SeEnum", values: [2] }, { $tag: "SeComplement", inner: { $tag: "SeEnum", values: [1, 2, 3] } })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalize — $diff simplification
// ---------------------------------------------------------------------------

describe("normalize — $diff simplifications", () => {
  it("enum minus enum: {1,2,3} \\ {2,4} = {1,3}", () => {
    const r = setExprToDollarKey(normalize({ $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3] }, right: { $tag: "SeEnum", values: [2, 4] } }));
    expect(r).toEqual({ $enum: [1, 3] });
  });

  it("enum minus disjoint: {1,2,3} \\ {4,5} = {1,2,3}", () => {
    const r = setExprToDollarKey(normalize({ $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3] }, right: { $tag: "SeEnum", values: [4, 5] } }));
    expect(r).toEqual({ $enum: [1, 2, 3] });
  });

  it("enum minus enum subset: {1} \\ {1,2} = ∅", () => {
    const r = setExprToDollarKey(normalize({ $tag: "SeDiff", left: { $tag: "SeEnum", values: [1] }, right: { $tag: "SeEnum", values: [1, 2] } }));
    expect(r).toEqual({ $none: true });
  });

  it("interval minus disjoint enum stays as interval", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } }, right: { $tag: "SeEnum", values: [200] } };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$interval");
  });

  it("interval minus disjoint interval stays as interval", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } }, right: { $tag: "SeInterval", interval: { lo: Just({ value: 100, inclusive: true }), hi: Just({ value: 200, inclusive: true }) } } };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$interval");
    expect((r as any).$interval.hi._0.value).toBe(10);
  });

  it("enum minus pattern: drops only matching values", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeEnum", values: ["abc", "123"] }, right: pat("^[0-9]+$") };
    expect(setExprToDollarKey(normalize(set))).toEqual({ $enum: ["abc"] });
  });

  it("interval minus single value retains its exact difference and scalar membership", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } }, right: { $tag: "SeEnum", values: [42] } };
    const normalized = normalize(set);
    expect(setExprToTag(normalized)).toEqual(set);
    for (const [value, expected] of [[41, true], [42, false], [43, true], [101, false]] as const) {
      expect(contains(set, value, null)).toBe(expected);
      expect(contains(normalized, value, null)).toBe(expected);
    }
  });

  it("a scalar boundary hole remains explicit instead of removing every representation of zero", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } }, right: { $tag: "SeEnum", values: [0] } };
    const normalized = normalize(set);
    expect(setExprToTag(normalized)).toEqual(set);
    expect(contains(normalized, 0, null)).toBe(false);
    expect(contains(normalized, 1, null)).toBe(true);
  });

  it("interval minus multiple scalar values retains both enum holes", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } }, right: { $tag: "SeEnum", values: [30, 60] } };
    const normalized = normalize(set);
    expect(setExprToTag(normalized)).toEqual(set);
    for (const value of [30, 60]) expect(contains(normalized, value, null)).toBe(false);
    expect(contains(normalized, 45, null)).toBe(true);
  });

  it("interval minus values outside: [0,10] \\ {200, 300} = [0,10]", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } }, right: { $tag: "SeEnum", values: [200, 300] } };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$interval");
  });

  it("interval minus interval (middle): [0,100] \\ [50,60] = [0,50) ∪ (60,100]", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } }, right: { $tag: "SeInterval", interval: { lo: Just({ value: 50, inclusive: true }), hi: Just({ value: 60, inclusive: true }) } } };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$union");
    const parts = (r as any).$union;
    expect(parts).toHaveLength(2);
    expect(parts[0]!.$interval.hi._0.value).toBe(50);
    expect(parts[0]!.$interval.hi._0.inclusive).toBe(false);
    expect(parts[1]!.$interval.lo._0.value).toBe(60);
    expect(parts[1]!.$interval.lo._0.inclusive).toBe(false);
  });

  it("interval minus interval (covers lower part): [0,100] \\ [-50,30] = (30,100]", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } }, right: { $tag: "SeInterval", interval: { lo: Just({ value: -50, inclusive: true }), hi: Just({ value: 30, inclusive: true }) } } };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$interval");
    const iv = (r as any).$interval;
    expect(iv.lo._0.value).toBe(30);
    expect(iv.lo._0.inclusive).toBe(false);
  });

  it("interval minus interval (b covers a): [0,100] \\ [-50,200] = ∅", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } }, right: { $tag: "SeInterval", interval: { lo: Just({ value: -50, inclusive: true }), hi: Just({ value: 200, inclusive: true }) } } };
    expect(setExprToDollarKey(normalize(set))).toEqual({ $none: true });
  });

  it("a \\ (b ∪ c) = ((a \\ b) \\ c) — iterates", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } }, right: { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [30] }, { $tag: "SeEnum", values: [60] }] } };
    const normalized = normalize(set);
    const r = setExprToDollarKey(normalized);
    expect(r).toHaveProperty("$diff");
    expect((r as { $diff: unknown[] }).$diff[1]).toEqual({ $enum: [30, 60] });
    expect(contains(normalized, 30, null)).toBe(false);
    expect(contains(normalized, 60, null)).toBe(false);
    expect(contains(normalized, 45, null)).toBe(true);
  });

  it("(a ∪ b) \\ c distributes: each part minus c", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeUnion", branches: [
            { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } },
            { $tag: "SeInterval", interval: { lo: Just({ value: 100, inclusive: true }), hi: Just({ value: 200, inclusive: true }) } },
          ] }, right: { $tag: "SeEnum", values: [50] } };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$union");
    // Both intervals stay intact since 50 is in neither
    expect((r as { $union: unknown[] }).$union).toHaveLength(2);
  });

  it("(a ∪ b) \\ c retains the affected difference and the disjoint interval", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeUnion", branches: [
            { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
            { $tag: "SeInterval", interval: { lo: Just({ value: 200, inclusive: true }), hi: Just({ value: 300, inclusive: true }) } },
          ] }, right: { $tag: "SeEnum", values: [50] } };
    const normalized = normalize(set);
    const r = setExprToDollarKey(normalized);
    expect(r).toHaveProperty("$union");
    const parts = (r as { $union: Record<string, unknown>[] }).$union;
    expect(parts).toHaveLength(2);
    expect(parts.some(part => "$diff" in part)).toBe(true);
    expect(parts.some(part => "$interval" in part)).toBe(true);
    expect(contains(normalized, 50, null)).toBe(false);
    expect(contains(normalized, 25, null)).toBe(true);
    expect(contains(normalized, 250, null)).toBe(true);
  });

  it("a \\ (b ∩ c) — De Morgan, distributes as union", () => {
    // {1,2,3,4} \ ({2,3,4} ∩ {3,4,5}) = {1,2,3,4} \ {3,4} = {1,2}
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3, 4] }, right: { $tag: "SeIntersect", branches: [{ $tag: "SeEnum", values: [2, 3, 4] }, { $tag: "SeEnum", values: [3, 4, 5] }] } };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$enum");
    expect((r as { $enum: number[] }).$enum.sort()).toEqual([1, 2]);
  });

  it("a \\ ¬c = a ∩ c", () => {
    // {1,2,3} \ ¬{2,3,4} = {1,2,3} ∩ {2,3,4} = {2,3}
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeEnum", values: [1, 2, 3] }, right: { $tag: "SeComplement", inner: { $tag: "SeEnum", values: [2, 3, 4] } } };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$enum");
    expect((r as { $enum: number[] }).$enum.sort()).toEqual([2, 3]);
  });

  it("interval minus exclusive interval: [0,100] \\ (50,60) = [0,50] ∪ [60,100]", () => {
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } }, right: { $tag: "SeInterval", interval: { lo: Just({ value: 50, inclusive: false }), hi: Just({ value: 60, inclusive: false }) } } };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$union");
    const parts = (r as any).$union;
    // Result intervals: [0, 50] and [60, 100] — boundary 50/60 should be inclusive (since b excluded them)
    expect(parts[0]!.$interval.hi._0.value).toBe(50);
    expect(parts[0]!.$interval.hi._0.inclusive).toBe(true);
    expect(parts[1]!.$interval.lo._0.value).toBe(60);
    expect(parts[1]!.$interval.lo._0.inclusive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalize — $intersect with disjoint patterns
// ---------------------------------------------------------------------------

describe("normalize — pairwise disjointness in $intersect", () => {
  it("two disjoint regex patterns ⇒ ∅", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [pat("^a$"), pat("^b$")] };
    expect(setExprToDollarKey(normalize(set))).toEqual({ $none: true });
  });

  it("overlapping regex patterns stay as intersect", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [pat("^[a-z]$"), pat("^[a-c]$")] };
    const r = normalize(set);
    // Either kept as intersect or simplified — neither way is "none"
    expect("$none" in r).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalize — $union interval merging
// ---------------------------------------------------------------------------

describe("normalize — $union interval merging", () => {
  it("merges overlapping intervals: [0,50] ∪ [40,100] = [0,100]", () => {
    const set: SetExpr = { $tag: "SeUnion", branches: [
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 50, inclusive: true }) } },
        { $tag: "SeInterval", interval: { lo: Just({ value: 40, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
      ] };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$interval");
    const iv = (r as any).$interval;
    expect(iv.lo._0.value).toBe(0);
    expect(iv.hi._0.value).toBe(100);
  });

  it("merges adjacent inclusive intervals: [0,5] ∪ [5,10] = [0,10]", () => {
    const set: SetExpr = { $tag: "SeUnion", branches: [
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 5, inclusive: true }) } },
        { $tag: "SeInterval", interval: { lo: Just({ value: 5, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } },
      ] };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$interval");
  });

  it("does NOT merge non-touching intervals: [0,5] ∪ [10,15] stays separate", () => {
    const set: SetExpr = { $tag: "SeUnion", branches: [
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 5, inclusive: true }) } },
        { $tag: "SeInterval", interval: { lo: Just({ value: 10, inclusive: true }), hi: Just({ value: 15, inclusive: true }) } },
      ] };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$union");
    expect((r as { $union: unknown[] }).$union).toHaveLength(2);
  });

  it("does NOT merge intervals separated by exclusive boundary: [0,5) ∪ (5,10]", () => {
    const set: SetExpr = { $tag: "SeUnion", branches: [
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 5, inclusive: false }) } },
        { $tag: "SeInterval", interval: { lo: Just({ value: 5, inclusive: false }), hi: Just({ value: 10, inclusive: true }) } },
      ] };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$union");
  });

  it("dedupes enum values across union", () => {
    const set: SetExpr = { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1, 2, 3] }, { $tag: "SeEnum", values: [3, 4, 5] }] };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$enum");
    expect((r as { $enum: number[] }).$enum.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("drops enum values already covered by an interval", () => {
    const set: SetExpr = { $tag: "SeUnion", branches: [
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } },
        { $tag: "SeEnum", values: [5, 100] }, // 5 is in the interval, 100 isn't
      ] };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$union");
    const parts = (r as { $union: SetExpr[] }).$union;
    const enumPart = parts.find((p) => "$enum" in p);
    expect(enumPart).toBeDefined();
    expect((enumPart as { $enum: number[] }).$enum).toEqual([100]);
  });
});

// ---------------------------------------------------------------------------
// whereToSetExpr — negation extraction
// ---------------------------------------------------------------------------

describe("normalize — $where with !", () => {
  it("$where: !(value >= 18) retains the native scalar predicate", () => {
    const set: SetExpr = { $tag: "SeWhere", pred: { "!": [{ ">=": [{ var: "value" }, 18] }] } };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toEqual({ $where: set.pred });
    expect(contains(set, 17, null)).toBe(true);
    expect(contains(set, 18, null)).toBe(false);
  });

  it("$where: !(value in [1,2,3]) extracts to complement of enum", () => {
    const set: SetExpr = { $tag: "SeWhere", pred: { "!": [{ in: [{ var: "value" }, [1, 2, 3]] }] } };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$complement");
  });

  it("a numeric predicate and its negation remain undecided without exact extraction", () => {
    // intersection of (value >= 18) and !(value >= 18) is empty
    const set: SetExpr = { $tag: "SeIntersect", branches: [
        { $tag: "SeWhere", pred: { ">=": [{ var: "value" }, 18] } },
        { $tag: "SeWhere", pred: { "!": [{ ">=": [{ var: "value" }, 18] }] } },
      ] };
    expect(decideEmpty(set)).toEqual({ $tag: "Nothing" });
    expect(contains(set, 17, null)).toBe(false);
    expect(contains(set, 18, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// $diff: left-intersect distribution
// ---------------------------------------------------------------------------

describe("normalize — (A ∩ B) \\ C distributes through left intersect", () => {
  it("(int[0,100] ∩ enum) \\ {bad value} drops the value", () => {
    // ([0,100] ∩ {25, 50, 75}) \ {50} = {25, 75}
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeIntersect", branches: [
            { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
            { $tag: "SeEnum", values: [25, 50, 75] },
          ] }, right: { $tag: "SeEnum", values: [50] } };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$enum");
    expect((r as { $enum: number[] }).$enum.sort()).toEqual([25, 75]);
  });

  it("(A ∩ B) \\ C with C disjoint from one factor — drops disjoint factor entirely", () => {
    // (int[0,100] ∩ int[200,300]) \ {50}
    // The left intersect is already empty (disjoint intervals → ∅), so result is ∅
    const set: SetExpr = { $tag: "SeDiff", left: { $tag: "SeIntersect", branches: [
            { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
            { $tag: "SeInterval", interval: { lo: Just({ value: 200, inclusive: true }), hi: Just({ value: 300, inclusive: true }) } },
          ] }, right: { $tag: "SeEnum", values: [50] } };
    expect(setExprToDollarKey(normalize(set))).toEqual({ $none: true });
  });
});

// ---------------------------------------------------------------------------
// $intersect: drop strict-superset constraints
// ---------------------------------------------------------------------------

describe("normalize — $intersect drops strict supersets", () => {
  it("named: Nat ∩ Int retains both domains without a cross-carrier inclusion proof", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "Nat" }, { $tag: "SeRef", handle: "Int" }] };
    const normalized = normalize(set);
    expect(setExprToTag(normalized)).toEqual(set);
    expect(contains(normalized, 3, null)).toBe(true);
  });

  it("regex: ^a$ ∩ ^[a-z]$ drops the wider pattern", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [pat("^a$"), pat("^[a-z]$")] };
    const r = setExprToTag(normalize(set));
    expect(r).toEqual(pat("^a$"));
  });

  it("interval ⊆ wider interval → drop wider", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [
        { $tag: "SeInterval", interval: { lo: Just({ value: 10, inclusive: true }), hi: Just({ value: 20, inclusive: true }) } },
        { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
      ] };
    // The interval merger already handles this case (intersect of intervals)
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$interval");
    const iv = (r as any).$interval;
    expect(iv.lo._0.value).toBe(10);
    expect(iv.hi._0.value).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// DNF distribution in $intersect
// ---------------------------------------------------------------------------

describe("normalize — $intersect distributes through $union (DNF)", () => {
  it("(a ∪ b) ∩ c distributes to (a ∩ c) ∪ (b ∩ c)", () => {
    const set: SetExpr = { $tag: "SeIntersect", branches: [
        { $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1, 2, 3] }, { $tag: "SeEnum", values: [10, 20, 30] }] },
        { $tag: "SeEnum", values: [2, 3, 20, 30, 40] },
      ] };
    const r = setExprToDollarKey(normalize(set));
    // Each branch ∩ {2,3,20,30,40}: {1,2,3}∩{...} = {2,3}; {10,20,30}∩{...} = {20,30}
    // Union: {2,3,20,30}
    expect(r).toHaveProperty("$enum");
    expect((r as { $enum: number[] }).$enum.sort((a, b) => a - b)).toEqual([2, 3, 20, 30]);
  });

  it("(union of intervals) ∩ (union of intervals) — cross product simplifies", () => {
    // ([0,10] ∪ [20,30]) ∩ ([5,25] ∪ [40,50])
    // = [0,10]∩[5,25] ∪ [0,10]∩[40,50] ∪ [20,30]∩[5,25] ∪ [20,30]∩[40,50]
    // = [5,10] ∪ ∅ ∪ [20,25] ∪ ∅
    // = [5,10] ∪ [20,25]
    const set: SetExpr = { $tag: "SeIntersect", branches: [
        { $tag: "SeUnion", branches: [
            { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } },
            { $tag: "SeInterval", interval: { lo: Just({ value: 20, inclusive: true }), hi: Just({ value: 30, inclusive: true }) } },
          ] },
        { $tag: "SeUnion", branches: [
            { $tag: "SeInterval", interval: { lo: Just({ value: 5, inclusive: true }), hi: Just({ value: 25, inclusive: true }) } },
            { $tag: "SeInterval", interval: { lo: Just({ value: 40, inclusive: true }), hi: Just({ value: 50, inclusive: true }) } },
          ] },
      ] };
    const r = setExprToDollarKey(normalize(set));
    expect(r).toHaveProperty("$union");
    const parts = (r as any).$union;
    expect(parts).toHaveLength(2);
    const sorted = parts.sort((a: any, b: any) => a.$interval.lo._0.value - b.$interval.lo._0.value);
    expect(sorted[0]!.$interval.lo._0.value).toBe(5);
    expect(sorted[0]!.$interval.hi._0.value).toBe(10);
    expect(sorted[1]!.$interval.lo._0.value).toBe(20);
    expect(sorted[1]!.$interval.hi._0.value).toBe(25);
  });

  it("DNF guards explosion: huge cross-product gives up gracefully", () => {
    // 10 unions of size 8 each = 8^10 = 1 billion products. Cap blocks this.
    const bigUnion = (offset: number): SetExpr => ({ $tag: "SeUnion", branches: Array.from({ length: 8 }, (_, i) => ({ $tag: "SeEnum", values: [offset + i] })) });
    const set: SetExpr = { $tag: "SeIntersect", branches: Array.from({ length: 10 }, (_, i) => bigUnion(i * 100)) };
    // Should NOT explode (or take forever); should return some safe fallback
    const r = normalize(set);
    expect(r).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Modular arithmetic extraction
// ---------------------------------------------------------------------------

describe("normalize — value % N == 0 extracts to SeRef multiple:N", () => {
  it("extracts even-number predicate", () => {
    const set: SetExpr = { $tag: "SeWhere", pred: { "==": [{ "%": [{ var: "value" }, 2] }, 0] } };
    const r = normalize(set);
    expect(r).toEqual({ $tag: "SeRef", handle: "multiple:2" });
  });

  it("extracts === modular pattern", () => {
    const set: SetExpr = { $tag: "SeWhere", pred: { "===": [{ "%": [{ var: "value" }, 5] }, 0] } };
    const r = normalize(set);
    expect(r).toEqual({ $tag: "SeRef", handle: "multiple:5" });
  });

  it("extracts when zero is on the left", () => {
    const set: SetExpr = { $tag: "SeWhere", pred: { "==": [0, { "%": [{ var: "value" }, 3] }] } };
    const r = normalize(set);
    expect(r).toEqual({ $tag: "SeRef", handle: "multiple:3" });
  });

  it("contains works for multiple:N", () => {
    expect(contains({ $tag: "SeRef", handle: "multiple:7" }, 14, null)).toBe(true);
    expect(contains({ $tag: "SeRef", handle: "multiple:7" }, 15, null)).toBe(false);
    expect(contains({ $tag: "SeRef", handle: "multiple:7" }, 0, null)).toBe(true);
    expect(contains({ $tag: "SeRef", handle: "multiple:7" }, "14", null)).toBe(false);
  });

  it("isEmpty detects $intersect: [multiple:2, multiple:3 NOT applicable…]", () => {
    // multiple:6 ⊆ multiple:2 (every multiple of 6 is also a multiple of 2)
    // Doesn't directly test emptiness, but tests interaction
    const set: SetExpr = { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "multiple:2" }, { $tag: "SeEnum", values: [1, 3, 5] }] };
    // None of {1, 3, 5} are even — should be ∅
    expect(isEmpty(set)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Symbolic interval bounds — structural equality
// ---------------------------------------------------------------------------

describe("isSubset — interval with expression bounds", () => {
  it("[expr, hi] ⊆ [expr, hi'] with same expr — structurally decidable", () => {
    const a: SetExpr = { $tag: "SeInterval", interval: {
        lo: Just({ value: { $expr: { var: "config.min" } } as never, inclusive: true }),
        hi: Just({ value: 50, inclusive: true }),
      } };
    const b: SetExpr = { $tag: "SeInterval", interval: {
        lo: Just({ value: { $expr: { var: "config.min" } } as never, inclusive: true }),
        hi: Just({ value: 100, inclusive: true }),
      } };
    // Same lo expression on both sides; hi 50 ≤ 100 → a ⊆ b
    expect(isSubset(a, b)).toBe(true);
    expect(isSubset(b, a)).toBe(false);
  });

  it("different expression bounds are NOT decidable as subset", () => {
    const a: SetExpr = { $tag: "SeInterval", interval: {
        lo: Just({ value: { $expr: { var: "x" } } as never, inclusive: true }),
        hi: Nothing,
      } };
    const b: SetExpr = { $tag: "SeInterval", interval: {
        lo: Just({ value: { $expr: { var: "y" } } as never, inclusive: true }),
        hi: Nothing,
      } };
    expect(isSubset(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// `$preimage` SetExpr constructor retired in Phase 3 of the implementation
// roadmap. The function-composition shape (predicate of `agg(value)`) now
// lives directly inside `$where`; structural-subtype reasoning over
// aggregates moves to a future Aggregable typeclass (Phase 4+). The
// Phase 3 brief explicitly notes that test coverage for the retired
// constructor is removed in the same commit — see set-algebra.ts +
// design/structural-introspection.md Instance 1.
// ---------------------------------------------------------------------------

describe("isSubset — $enum ⊆ $pattern", () => {
  it("strings matching the pattern", () => {
    expect(isSubset({ $tag: "SeEnum", values: ["foo", "bar"] }, pat("^(foo|bar)$"))).toBe(true);
  });

  it("single value matching anchored pattern", () => {
    expect(isSubset({ $tag: "SeEnum", values: ["abc"] }, pat("^[a-z]+$"))).toBe(true);
  });

  it("single value NOT matching pattern", () => {
    expect(isSubset({ $tag: "SeEnum", values: ["abc1"] }, pat("^[a-z]+$"))).toBe(false);
  });

  it("any one value mismatch fails the whole subset", () => {
    expect(isSubset({ $tag: "SeEnum", values: ["foo", "BAR"] }, pat("^[a-z]+$"))).toBe(false);
  });

  it("non-string enum values fall outside pattern languages", () => {
    expect(isSubset({ $tag: "SeEnum", values: [1, 2, 3] }, pat("^\\d$"))).toBe(false);
  });

  it("unanchored contains-pattern accepts strings containing the substring", () => {
    expect(isSubset({ $tag: "SeEnum", values: ["xfoo", "fooy", "xfooy"] }, pat("foo"))).toBe(true);
  });

  it("empty enum is vacuously subset of any pattern", () => {
    expect(isSubset({ $tag: "SeEnum", values: [] }, pat("^impossible$"))).toBe(true);
  });
});

describe("unfold", () => {
  it("substitutes the bound var with the original $mu", () => {
    const mu: { $mu: { var: string; body: FenelType } } = {
      $mu: {
        var: "X",
        body: {
          $variant: {
            cases: [
              { name: "Nil", label: Nothing },
              { name: "Cons", label: Nothing, fields: [{ name: "tail", label: Nothing, type: { $var: "X" }, meta: {}, ui: Nothing }] },
            ],
          },
        },
      },
    };
    const unfolded = unfold(mu);
    expect(unfolded).toEqual({
      $variant: {
        cases: [
          { name: "Nil", label: Nothing },
          { name: "Cons", label: Nothing, fields: [{ name: "tail", label: Nothing, type: mu, meta: {}, ui: Nothing }] },
        ],
      },
    });
  });

  it("respects shadowing of inner $mu vars", () => {
    const inner: FenelType = { $mu: { var: "X", body: { $var: "X" } } };
    const outer: { $mu: { var: string; body: FenelType } } = {
      $mu: { var: "X", body: inner },
    };
    expect(unfold(outer)).toEqual(inner);
  });
});
