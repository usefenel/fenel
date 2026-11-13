// ---------------------------------------------------------------------------
// number-tower.test.ts — numeric-tower Phase 5, THE TOWER CAPSTONE. With all
// four rungs operational (Nat/Int/Rational/Real, Phases 1–4), Phase 5 mints the
// `Eq` / `Ord` / `Numeric` classes (D5) + per-rung instances and flips `Number`
// to the TAGGED `$variant` over the tower (D2). This oracle exercises:
//   (1) the three classes are real boot-registry dispatch classes (the
//       Functor/Monad/Monoid precedent) with the Monoid-shape arg-0 dispatch +
//       the `Ord ⇒ Eq` super;
//   (2) the per-rung instances resolve their method REFERENCES;
//   (3) END-TO-END reflective dispatch — `Eq.eq`/`Ord.lt`/`Numeric.add` over a
//       tower value route to that value's rung body BY USE-SITE REFLECTION (the
//       tower is now ONE dispatched numeric type), incl. the cross-rung coverage
//       and `Numeric Nat`'s honest absence (ℕ is not a ring);
//   (4) FORK-1 (B) — the partial ℝ carve-out (Eq/Ord Real → Maybe Bool, Nothing
//       when undecided within the default budget; the decidable rungs always Just);
//   (5) the `Number` flip + the P7-1 iso (`$variant ≅ tagged-disjoint-$union`) +
//       the Reprable JsRuntime/Jsonb Number round-trip (FORK 2, over the integer
//       sub-domain — the Real-Reprable carve-out precedent);
//   (6) D6 — the native `eq` is the polymorphic total-Boolean fast path.
//
// Ledgered test-tooling (the real-tower.test.ts precedent). The fuel-bounded ℝ
// comparison is test-only (the Number native is the production perf branch).
// ---------------------------------------------------------------------------

import { test, expect, describe, beforeAll } from "bun:test";
import { evaluate } from "./json-logic";
import { parse } from "./fenel-parser";
import { dispatchRegistry, resolveNamed } from "./system-entities";
import { getSystemEvaluateContext } from "./system-registry";
import { methodDispatchPosition } from "./effect-dispatch";
import type { EvaluateContext } from "./json-logic";
import { GLOBAL_ONLY } from "./dispatch-registry";

let ctx: EvaluateContext;
beforeAll(() => {
  ctx = getSystemEvaluateContext();
});
const ev = (src: string) => evaluate(parse(src), {}, ctx);
// Decode a Maybe Bool: Just true → true, Just false → false, Nothing → null.
const mb = (v: unknown): boolean | null => {
  const o = v as { $tag: string; _0?: boolean };
  return o.$tag === "Nothing" ? null : (o._0 as boolean);
};

// ---------------------------------------------------------------------------
// (a) Eq / Ord / Numeric are real boot-registry dispatch classes (D5).
// ---------------------------------------------------------------------------

describe("Phase 5 (a) — Eq / Ord / Numeric are boot-registry classes (Monoid-shape, no TS seed)", () => {
  test("getClass resolves all three in the boot dispatchRegistry", () => {
    expect(dispatchRegistry.getClass("Eq")).toBeDefined();
    expect(dispatchRegistry.getClass("Ord")).toBeDefined();
    expect(dispatchRegistry.getClass("Numeric")).toBeDefined();
  });

  test("comparison/arithmetic methods derive arg-0 dispatch (the class var heads a bare arg-0)", () => {
    expect(methodDispatchPosition(dispatchRegistry, "Eq", "eq")).toBe(0);
    expect(methodDispatchPosition(dispatchRegistry, "Eq", "neq")).toBe(0);
    expect(methodDispatchPosition(dispatchRegistry, "Ord", "lt")).toBe(0);
    expect(methodDispatchPosition(dispatchRegistry, "Numeric", "add")).toBe(0);
    expect(methodDispatchPosition(dispatchRegistry, "Numeric", "negate")).toBe(0);
  });

  test("Ord supers Eq — the `ordEq: Eq a` field is stamped as a super, erased from methods", () => {
    const ord = dispatchRegistry.getClass("Ord") as unknown as {
      methods: Array<{ name: string }>;
      supers?: Array<{ class: { entityId?: string } }>;
    };
    expect(ord.methods.map((m) => m.name)).toEqual(["lt", "lte", "gt", "gte"]);
    expect(ord.supers?.[0]?.class?.entityId).toBe("Eq");
  });
});

// ---------------------------------------------------------------------------
// (b) The per-rung instances resolve their method references.
// ---------------------------------------------------------------------------

describe("Phase 5 (b) — the Eq / Ord / Numeric per-rung instances are populated", () => {
  test("Eq instances over the four rungs reference their comparison wrappers", () => {
    expect(dispatchRegistry.resolve("Nat", "Eq", GLOBAL_ONLY)).toEqual({ eq: { $ref: "natEqM" }, neq: { $ref: "natNeqM" } });
    expect(dispatchRegistry.resolve("Int", "Eq", GLOBAL_ONLY)).toEqual({ eq: { $ref: "intEqM" }, neq: { $ref: "intNeqM" } });
    expect(dispatchRegistry.resolve("Rational", "Eq", GLOBAL_ONLY)).toEqual({ eq: { $ref: "ratEqM" }, neq: { $ref: "ratNeqM" } });
    expect(dispatchRegistry.resolve("Real", "Eq", GLOBAL_ONLY)).toEqual({ eq: { $ref: "realEqDefault" }, neq: { $ref: "realNeqDefault" } });
  });

  test("Numeric instances are RINGS only — Int / Rational / Real (no Numeric Nat)", () => {
    expect(dispatchRegistry.resolve("Int", "Numeric", GLOBAL_ONLY)).toEqual({
      add: { $ref: "intAdd" }, sub: { $ref: "intSub" }, mul: { $ref: "intMul" }, negate: { $ref: "intNegate" },
    });
    expect(dispatchRegistry.resolve("Real", "Numeric", GLOBAL_ONLY)).toMatchObject({ add: { $ref: "realAdd" }, negate: { $ref: "realNegate" } });
    expect(dispatchRegistry.satisfies("Int", "Numeric", GLOBAL_ONLY)).toBe(true);
    expect(dispatchRegistry.satisfies("Rational", "Numeric", GLOBAL_ONLY)).toBe(true);
    // ℕ is not a ring (no negate, truncated monus) — the absence is honest, observable, not a crash.
    expect(dispatchRegistry.satisfies("Nat", "Numeric", GLOBAL_ONLY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) THE HEADLINE — END-TO-END reflective dispatch: the tower is ONE dispatched
//     numeric type. `Eq.eq`/`Ord.lt`/`Numeric.add` over a value route to that
//     value's rung body purely by the value's runtime type (the Monad-bind
//     precedent). Decidable rungs return `Just …`.
// ---------------------------------------------------------------------------

describe("Phase 5 (c) — Eq / Ord / Numeric dispatch across the rungs by value reflection", () => {
  test("Eq.eq dispatches to each decidable rung (Nat / Int / Rational) ⇒ Just bool", () => {
    expect(mb(ev("Eq.eq (numberToNat 2) (numberToNat 2)"))).toBe(true);
    expect(mb(ev("Eq.eq (numberToNat 2) (numberToNat 3)"))).toBe(false);
    expect(mb(ev("Eq.eq (numberToInt 5) (numberToInt 5)"))).toBe(true);
    expect(mb(ev("Eq.eq (numberToInt 5) (numberToInt (negate 5))"))).toBe(false);
    expect(mb(ev("Eq.eq (numberToRational 4) (numberToRational 4)"))).toBe(true);
  });

  test("Ord.lt / Ord.gte dispatch per rung ⇒ Just bool", () => {
    expect(mb(ev("Ord.lt (numberToNat 1) (numberToNat 2)"))).toBe(true);
    expect(mb(ev("Ord.lt (numberToInt 2) (numberToInt (negate 3))"))).toBe(false);
    expect(mb(ev("Ord.gte (numberToInt 5) (numberToInt 5)"))).toBe(true);
    expect(mb(ev("Ord.gt (numberToInt 7) (numberToInt 3)"))).toBe(true);
  });

  test("Numeric.add / sub / mul / negate dispatch per ring rung (Int / Rational)", () => {
    expect(ev("intToNumber (Numeric.add (numberToInt 2) (numberToInt 3))")).toBe(5);
    expect(ev("intToNumber (Numeric.sub (numberToInt 2) (numberToInt 9))")).toBe(-7);
    expect(ev("intToNumber (Numeric.mul (numberToInt (negate 4)) (numberToInt 3))")).toBe(-12);
    expect(ev("intToNumber (Numeric.negate (numberToInt 6))")).toBe(-6);
    // Rational instance, same surface (4/2 reduces to 2/1 ⇒ 2.0).
    expect(ev("rationalToNumber (Numeric.add (numberToRational 1) (numberToRational 1))")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (d) FORK-1 (B) — the partial ℝ carve-out. Eq/Ord Real return Maybe Bool at the
//     default fuel budget: Just on a separation witness, Nothing when undecided.
// ---------------------------------------------------------------------------

describe("Phase 5 (d) — FORK-1 (B): the ℝ rung's partial Eq / Ord (Maybe Bool, default fuel)", () => {
  const real = (n: number, d: number) =>
    `(ratToReal (mkRational (numberToInt ${n}) (numberToInt ${d})))`;
  test("Ord.lt over Real is decided (Just) when the reals are separated within budget", () => {
    expect(mb(ev(`Ord.lt ${real(1, 3)} ${real(1, 2)}`))).toBe(true);   // 1/3 < 1/2
    expect(mb(ev(`Ord.lt ${real(1, 2)} ${real(1, 3)}`))).toBe(false);  // 1/2 > 1/3
    expect(mb(ev(`Ord.gt ${real(2, 1)} ${real(1, 1)}`))).toBe(true);   // 2 > 1
  }, 60_000);

  test("Eq.eq over Real is Just False on separation, Nothing when undecided (NEVER a wrong false)", () => {
    expect(mb(ev(`Eq.eq ${real(1, 3)} ${real(1, 2)}`))).toBe(false);   // separated ⇒ unequal
    // equal reals (same construction) cannot be positively confirmed ⇒ Nothing (the decidability boundary).
    expect(mb(ev(`Eq.eq ${real(1, 2)} ${real(1, 2)}`))).toBe(null);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// (e) The `Number` flip — the TAGGED $variant over the tower (D2) + the P7-1 iso
//     + the Reprable JsRuntime/Jsonb Number round-trip (FORK 2).
// ---------------------------------------------------------------------------

describe("Phase 5 (e) — Number = the tagged $variant; the P7-1 iso + the Reprable round-trip", () => {
  test("Number resolves to the opaque tagged $variant NatN|IntN|RatN|RealN (P7-1; was a bare leaf at HEAD)", () => {
    const num = resolveNamed("Number");
    expect(num).toBeDefined();
    const variant = (num!.type as { $opaque?: { name?: string; pure?: { $variant?: { cases: Array<{ name: string }> } } } }).$opaque;
    expect(variant?.name).toBe("Number");
    // the tagged disjoint sum over the rungs — exactly $variant (validates the P7-1
    // `$variant ≅ tagged-disjoint-$union` iso; NOT the untagged tier-2 $union former).
    expect(variant?.pure?.$variant?.cases.map((c) => c.name)).toEqual(["NatN", "IntN", "RatN", "RealN"]);
  });

  test("FORK-2 lower: integral ⇒ IntN, non-integral ⇒ RealN (the lossy-but-total tag carve-out)", () => {
    expect((ev("doubleToTower 7") as { $tag: string }).$tag).toBe("IntN");
    expect((ev("doubleToTower 0") as { $tag: string }).$tag).toBe("IntN");
    expect((ev("doubleToTower (negate 4)") as { $tag: string }).$tag).toBe("IntN");
    // a non-integer double cannot be placed in ℤ ⇒ RealN (its exact rung is unrecoverable; lower never makes NatN/RatN).
    expect((ev("doubleToTower 2.5") as { $tag: string }).$tag).toBe("RealN");
  });

  test("FORK-2 lift collapses any tagged rung to its double (NatN / IntN / RatN / RealN)", () => {
    expect(ev("towerToDouble (NatN (numberToNat 3))")).toBe(3);
    expect(ev("towerToDouble (IntN (numberToInt (negate 8)))")).toBe(-8);
    expect(ev("towerToDouble (RatN (numberToRational 6))")).toBe(6);
    expect(ev("towerToDouble (RealN (numberToReal 9))")).toBe(9);
  });

  test("Reprable JsRuntime/Jsonb Number round-trip over the INTEGER sub-domain (the carve-out)", () => {
    const inst = (target: string) =>
      [...dispatchRegistry.listInstances("Reprable")].find((x) => x.args[0] === target && x.args[1] === "Number")!;
    for (const target of ["JsRuntime", "Jsonb"]) {
      const i = inst(target);
      expect(i.methods.native).toEqual({ $ref: "Number" });
      const lift = i.methods.lift;   // towerToDouble (tower → double)
      const lower = i.methods.lower;  // doubleToTower (double → tower)
      // lift ∘ lower ≡ id over integers (where IntN + the rung bridges are exact).
      const lit = (n: number) => (n < 0 ? `(negate ${-n})` : `${n}`);
      for (const k of [-7, 0, 1, 42]) {
        expect(ev(`towerToDouble (doubleToTower ${lit(k)})`)).toBe(k);
      }
      // the methods are qualified references to the bridge fns (modules-as-values
      // Phase 2b), resolving to their ids in the system registry.
      expect(lift).toEqual({ $ref: "std.towerToDouble" });
      expect(lower).toEqual({ $ref: "std.doubleToTower" });
      expect(ctx.getFunction?.("std.towerToDouble")?.id).toBe("std:towerToDouble");
      expect(ctx.getFunction?.("std.doubleToTower")?.id).toBe("std:doubleToTower");
    }
  });

  test("the Reprable family grew by 2 (Number JsRuntime + Jsonb) ⇒ 18 instances", () => {
    expect([...dispatchRegistry.listInstances("Reprable")].length).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// (f) D6 — the native `eq` is the polymorphic total-Boolean FAST PATH (its
//     declared type is no longer String-only; behaviour unchanged).
// ---------------------------------------------------------------------------

describe("Phase 5 (f) — D6: native `eq` is the polymorphic total-Boolean fast path", () => {
  test("the flat native `eq` stays a total Boolean over numbers AND strings (loose ==)", () => {
    expect(ev("eq 3 3")).toBe(true);
    expect(ev("eq 3 4")).toBe(false);
    expect(ev("eq \"ab\" \"ab\"")).toBe(true);
    expect(ev("neq \"ab\" \"ac\"")).toBe(true);
  });
});
