// Phase 4 conformance test for the canonical-Maybe workstream — pins
// the wire shape of `Interval.{lo,hi}: Maybe<Bound>` post-lift and the
// migration-walker semantics for `0054_interval_lo_hi_to_maybe.sql`.
//
// Mirrors the Phase 2 / Phase 3 conformance test layouts.

import { describe, it, expect } from "vitest";
import type { Interval, SetExpr } from "./types";
import { Just, Nothing, peelMaybeValue, Maybe } from "./type-foundation";
import { containsB, isSubsetB, peelMaybe } from "./set-algebra";

const intervalSubset = (a: Interval, b: Interval): boolean =>
  isSubsetB({ $tag: "SeInterval", interval: a }, { $tag: "SeInterval", interval: b });

// ---------------------------------------------------------------------------
// 1) The TS Interval type accepts canonical Maybe<Bound> shapes.
// ---------------------------------------------------------------------------

describe("Interval accepts canonical Maybe<Bound> shape", () => {
  it("constructs with both bounds (Just/Just)", () => {
    const iv: Interval = {
      lo: Just({ value: 0, inclusive: true }),
      hi: Just({ value: 10, inclusive: false }),
    };
    expect(iv.lo.$tag).toBe("Just");
    expect(iv.hi.$tag).toBe("Just");
    if (iv.lo.$tag !== "Just") throw new Error("unreachable");
    if (iv.hi.$tag !== "Just") throw new Error("unreachable");
    expect(iv.lo._0.value).toBe(0);
    expect(iv.lo._0.inclusive).toBe(true);
    expect(iv.hi._0.value).toBe(10);
    expect(iv.hi._0.inclusive).toBe(false);
  });

  it("constructs with lower bound only (Just/Nothing)", () => {
    const iv: Interval = {
      lo: Just({ value: 1, inclusive: true }),
      hi: Nothing,
    };
    expect(iv.lo.$tag).toBe("Just");
    expect(iv.hi.$tag).toBe("Nothing");
  });

  it("constructs with upper bound only (Nothing/Just)", () => {
    const iv: Interval = {
      lo: Nothing,
      hi: Just({ value: 100, inclusive: true }),
    };
    expect(iv.lo.$tag).toBe("Nothing");
    expect(iv.hi.$tag).toBe("Just");
  });

  it("constructs as unbounded (Nothing/Nothing)", () => {
    const iv: Interval = { lo: Nothing, hi: Nothing };
    expect(iv.lo.$tag).toBe("Nothing");
    expect(iv.hi.$tag).toBe("Nothing");
  });

  it("supports a cascade-discriminate read pattern", () => {
    const iv: Interval = {
      lo: Just({ value: 5, inclusive: true }),
      hi: Nothing,
    };
    if (iv.lo.$tag === "Just") {
      const b = iv.lo._0;
      expect(b.value).toBe(5);
      expect(b.inclusive).toBe(true);
    }
    expect(peelMaybeValue(iv.lo)?.value).toBe(5);
    expect(peelMaybeValue(iv.hi)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2) intervalSubset / contains semantics preserved across the lift.
// ---------------------------------------------------------------------------

describe("intervalSubset semantics preserved", () => {
  const bounded: Interval = {
    lo: Just({ value: 0, inclusive: true }),
    hi: Just({ value: 10, inclusive: true }),
  };
  const unbounded: Interval = { lo: Nothing, hi: Nothing };
  const halfBounded: Interval = {
    lo: Just({ value: 5, inclusive: true }),
    hi: Nothing,
  };

  it("bounded ⊆ unbounded", () => {
    expect(intervalSubset(bounded, unbounded)).toBe(true);
  });

  it("unbounded ⊄ bounded", () => {
    expect(intervalSubset(unbounded, bounded)).toBe(false);
  });

  it("bounded ⊄ half-bounded (lower-bound only covers different range)", () => {
    expect(intervalSubset(bounded, halfBounded)).toBe(false);
  });

  it("half-bounded ⊆ unbounded", () => {
    expect(intervalSubset(halfBounded, unbounded)).toBe(true);
  });

  it("contains on unbounded interval accepts any value", () => {
    const set: SetExpr = { $tag: "SeInterval", interval: unbounded };
    expect(containsB(set,0, null)).toBe(true);
    expect(containsB(set,-1000, null)).toBe(true);
    expect(containsB(set,1e10, null)).toBe(true);
  });

  it("contains on bounded interval respects bounds", () => {
    const set: SetExpr = { $tag: "SeInterval", interval: bounded };
    expect(containsB(set,0, null)).toBe(true);
    expect(containsB(set,5, null)).toBe(true);
    expect(containsB(set,10, null)).toBe(true);
    expect(containsB(set,-1, null)).toBe(false);
    expect(containsB(set,11, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3) Migration walker — TS mirror of the PL/pgSQL `lift_interval_lo_hi`.
// ---------------------------------------------------------------------------

function liftIntervalLoHi(j: unknown): unknown {
  if (j === null || j === undefined) return j;
  if (Array.isArray(j)) return j.map(liftIntervalLoHi);
  if (typeof j !== "object") return j;

  const obj = j as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = liftIntervalLoHi(v);
  }

  const iv = result.$interval;
  if (
    iv === null ||
    iv === undefined ||
    typeof iv !== "object" ||
    Array.isArray(iv)
  ) {
    return result;
  }
  const ivObj = iv as Record<string, unknown>;
  const loVal = ivObj.lo;
  const hiVal = ivObj.hi;

  // Idempotency: if both already lifted, return.
  const isLifted = (x: unknown): boolean =>
    x !== null &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    "$tag" in (x as Record<string, unknown>);
  if (isLifted(loVal) && isLifted(hiVal)) return result;

  const liftSlot = (val: unknown): unknown => {
    if (val === undefined) return { $tag: "Nothing" };
    if (isLifted(val)) return val;
    return { $tag: "Just", _0: val };
  };

  result.$interval = { lo: liftSlot(loVal), hi: liftSlot(hiVal) };
  return result;
}

describe("migration 0054 lifts absent lo/hi to Nothing", () => {
  it("lifts an interval with only lo present (hi absent → Nothing)", () => {
    const pre = { $interval: { lo: { value: 0, inclusive: true } } };
    const post = liftIntervalLoHi(pre);
    expect(post).toEqual({
      $interval: {
        lo: { $tag: "Just", _0: { value: 0, inclusive: true } },
        hi: { $tag: "Nothing" },
      },
    });
  });

  it("lifts an interval with only hi present (lo absent → Nothing)", () => {
    const pre = { $interval: { hi: { value: 100, inclusive: true } } };
    const post = liftIntervalLoHi(pre);
    expect(post).toEqual({
      $interval: {
        lo: { $tag: "Nothing" },
        hi: { $tag: "Just", _0: { value: 100, inclusive: true } },
      },
    });
  });

  it("lifts an interval with both bounds present", () => {
    const pre = {
      $interval: {
        lo: { value: 0, inclusive: true },
        hi: { value: 10, inclusive: false },
      },
    };
    const post = liftIntervalLoHi(pre);
    expect(post).toEqual({
      $interval: {
        lo: { $tag: "Just", _0: { value: 0, inclusive: true } },
        hi: { $tag: "Just", _0: { value: 10, inclusive: false } },
      },
    });
  });

  it("lifts an empty (unbounded) interval", () => {
    const pre = { $interval: {} };
    const post = liftIntervalLoHi(pre);
    expect(post).toEqual({
      $interval: {
        lo: { $tag: "Nothing" },
        hi: { $tag: "Nothing" },
      },
    });
  });

  it("walks nested SetExpr — $union of intervals", () => {
    const pre = {
      $union: [
        { $interval: { lo: { value: 0, inclusive: true } } },
        { $interval: { hi: { value: 100, inclusive: false } } },
      ],
    };
    const post = liftIntervalLoHi(pre);
    expect(post).toEqual({
      $union: [
        {
          $interval: {
            lo: { $tag: "Just", _0: { value: 0, inclusive: true } },
            hi: { $tag: "Nothing" },
          },
        },
        {
          $interval: {
            lo: { $tag: "Nothing" },
            hi: { $tag: "Just", _0: { value: 100, inclusive: false } },
          },
        },
      ],
    });
  });
});

describe("migration 0054 is idempotent", () => {
  it("applying twice yields identity on the second pass", () => {
    const pre = {
      $interval: {
        lo: { value: 5, inclusive: true },
        hi: { value: 50, inclusive: true },
      },
    };
    const once = liftIntervalLoHi(pre);
    const twice = liftIntervalLoHi(once);
    expect(twice).toEqual(once);
  });

  it("idempotent on already-canonical shape", () => {
    const canonical = {
      $interval: {
        lo: { $tag: "Just", _0: { value: 0, inclusive: true } },
        hi: { $tag: "Nothing" },
      },
    };
    expect(liftIntervalLoHi(canonical)).toEqual(canonical);
  });

  it("idempotent on mixed-shape (lo lifted, hi raw — partial migration)", () => {
    const partial = {
      $interval: {
        lo: { $tag: "Just", _0: { value: 1, inclusive: true } },
        hi: { value: 99, inclusive: false },
      },
    };
    const post = liftIntervalLoHi(partial);
    expect(post).toEqual({
      $interval: {
        lo: { $tag: "Just", _0: { value: 1, inclusive: true } },
        hi: { $tag: "Just", _0: { value: 99, inclusive: false } },
      },
    });
  });
});

// ---------------------------------------------------------------------------
// 4) Maybe<T> + Just + Nothing + peelMaybeValue round-trip.
// ---------------------------------------------------------------------------

describe("Maybe<T> / Just / Nothing / peelMaybeValue round-trip", () => {
  it("Just(x) is Maybe<T> with tag Just and value x", () => {
    const m: Maybe<number> = Just(42);
    expect(m.$tag).toBe("Just");
    if (m.$tag !== "Just") throw new Error("unreachable");
    expect(m._0).toBe(42);
  });

  it("Nothing widens to any Maybe<T>", () => {
    const m: Maybe<number> = Nothing;
    expect(m.$tag).toBe("Nothing");
  });

  it("peelMaybeValue(Just(x)) returns x", () => {
    expect(peelMaybeValue(Just(0))).toBe(0);
    expect(peelMaybeValue(Just("hi"))).toBe("hi");
    expect(peelMaybeValue(Just(false))).toBe(false);
  });

  it("peelMaybeValue(Nothing) returns null", () => {
    expect(peelMaybeValue(Nothing)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5) peelMaybe — type-level recognizer on the Interval entity field.
// ---------------------------------------------------------------------------

describe("peelMaybe type-level recognizer", () => {
  it("walks a Maybe<Bound>-shaped FenelType to the inner type", () => {
    // Hand-construct the canonical Maybe<Bound> FenelType shape
    // as produced by `Maybe(Bound)` (the type-foundation helper).
    const maybeBoundType = {
      $variant: {
        cases: [
          { name: "Nothing", label: Nothing, fields: [] },
          {
            name: "Just",
            label: Nothing,
            fields: [
              {
                name: "_0",
                label: Nothing,
                type: { $ref: "Bound" },
                ui: Nothing,
              },
            ],
          },
        ],
      },
    };
    const peeled = peelMaybe(maybeBoundType as never);
    expect(peeled).toEqual({ value: { $ref: "Bound" } });
  });
});
