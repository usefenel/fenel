// Boolean is `$opaque { name: "Boolean", pure: True | False }` — the
// type system reasons about it as an ADT, but the runtime keeps using
// JS booleans. These tests pin down the coercion bridge: constructor
// calls produce JS booleans, and pattern-matching against tagged
// `True` / `False` patterns accepts JS booleans.
// representation-substrate Phase 5a — the `repr: "boolean"` field retired; the
// JS-boolean native rep lives in the `Reprable JsRuntime Boolean` instance.

import { describe, it, expect } from "vitest";
import { evaluate } from "./json-logic";
import { Bool, Nothing } from "./type-foundation";
import { dispatchRegistry } from "./system-entities";
describe("Boolean — opaque type wrapper", () => {
  it("Bool is opaque-wrapped with pure variant", () => {
    expect(Bool).toMatchObject({
      $opaque: {
        name: "Boolean",
        pure: {
          $variant: {
            cases: [{ name: "True", label: Nothing }, { name: "False", label: Nothing }],
          },
        },
      },
    });
  });
});

describe("construct — True / False produce JS booleans", () => {
  it("True → true", () => {
    expect(evaluate({ construct: ["True"] }, {}, { natives: {} } as never)).toBe(true);
  });
  it("False → false", () => {
    expect(evaluate({ construct: ["False"] }, {}, { natives: {} } as never)).toBe(false);
  });
});

describe("match — True / False patterns coerce JS booleans", () => {
  it("matches True against JS true", () => {
    const result = evaluate(
      {
        match: [
          true,
          { $tag: "True" },
          "yes",
          { $tag: "False" },
          "no",
        ],
      },
      {},
      { natives: {} } as never,
    );
    expect(result).toBe("yes");
  });

  it("matches False against JS false", () => {
    const result = evaluate(
      {
        match: [
          false,
          { $tag: "True" },
          "yes",
          { $tag: "False" },
          "no",
        ],
      },
      {},
      { natives: {} } as never,
    );
    expect(result).toBe("no");
  });

  it("round-trips construct → match", () => {
    const result = evaluate(
      {
        match: [
          { construct: ["True"] },
          { $tag: "True" },
          1,
          { $tag: "False" },
          0,
        ],
      },
      {},
      { natives: {} } as never,
    );
    expect(result).toBe(1);
  });

  it("wildcard still matches Boolean values", () => {
    const result = evaluate(
      { match: [true, "_", "anything"] },
      {},
      { natives: {} } as never,
    );
    expect(result).toBe("anything");
  });

  it("bind still works on Boolean values", () => {
    const result = evaluate(
      {
        match: [
          true,
          { $bind: "b" },
          { var: "b" },
        ],
      },
      {},
      { natives: {} } as never,
    );
    expect(result).toBe(true);
  });
});

describe("existing Boolean ops still work (JS rep unchanged)", () => {
  it("if true then x else y", () => {
    const result = evaluate({ if: [true, "x", "y"] }, {}, { natives: {} } as never);
    expect(result).toBe("x");
  });

  it("and (true, true) → true", () => {
    const result = evaluate({ and: [true, true] }, {}, { natives: {} } as never);
    expect(result).toBe(true);
  });

  it("== (true, true) → true", () => {
    const result = evaluate({ "==": [true, true] }, {}, { natives: {} } as never);
    expect(result).toBe(true);
  });

  it("if {construct:['True']} then x else y", () => {
    // Constructor calls flow through the same control-flow ops as
    // literals do — coercion happens at construct, not at if.
    const result = evaluate(
      { if: [{ construct: ["True"] }, "x", "y"] },
      {},
      { natives: {} } as never,
    );
    expect(result).toBe("x");
  });
});

// ---------------------------------------------------------------------------
// representation-substrate Phase 1 — `Reprable JsRuntime Boolean`.
//
// The `.fenel` instance (fenel/std/dispatch-instances.fenel) is the SEMANTIC
// source of truth for the Bool↔JS-boolean boundary; the json-logic.ts
// construct/matchPattern arms above are its law-bound opaque-repr PERF BRANCH
// (design/ts-exceptions-ledger.md B5). These tests discharge the round-trip
// laws over the instance — the D1/D7 "the law keeps the views honest" mechanism
// (numeric-tower nat-peano.test.ts) applied to coercion — and pin the
// substrate's wiring (class derived, instance projected, native type-ref).
// ---------------------------------------------------------------------------

// Resolve the single registered `Reprable JsRuntime Boolean` instance.
function reprableBool() {
  const insts = [...dispatchRegistry.listInstances("Reprable")];
  const bool = insts.find(
    (i) => i.args[0] === "JsRuntime" && i.args[1] === "Boolean",
  );
  if (!bool) throw new Error("Reprable JsRuntime Boolean instance not registered");
  return bool;
}

// The perf branch — `construct("True"/"False")` → JS boolean (the native rep).
const perfConstruct = (tag: "True" | "False") =>
  evaluate({ construct: [tag] }, {}, { natives: {} } as never);

// Apply an instance lambda method (`{fn:["x", body]}`) to one value through
// the evaluator — the SEMANTIC path (the instance is the source of truth).
const applyMethod = (method: unknown, arg: unknown) =>
  evaluate({ apply: [method, [arg]] }, {}, { natives: {} } as never);

describe("Reprable JsRuntime Boolean — substrate wiring", () => {
  it("the class is derived + registered (no TS class-seed literal)", () => {
    const seed = dispatchRegistry.getClass("Reprable");
    expect(seed).toBeDefined();
    const methodNames = (seed?.methods ?? []).map((m) => m.name);
    // The two `Verified Boolean` law fields are ERASED from the dispatch method
    // set (the Labelable `labelNonEmpty` precedent); native/lift/lower remain.
    expect(methodNames).toContain("lift");
    expect(methodNames).toContain("lower");
    expect(methodNames).toContain("native");
    expect(methodNames).not.toContain("reprLowerLiftRoundtrip");
    expect(methodNames).not.toContain("reprLiftLowerRoundtrip");
    // `lift : a -> native` heads arg 0 with the bare class var `a` ⇒ arg-0
    // value-dispatch derives with no TS seed (the `Monoid.mappend` shape).
    const lift = (seed?.methods ?? []).find((m) => m.name === "lift");
    expect(lift?.params?.length).toBe(1);
  });

  it("the instance is projected with native as a TYPE reference", () => {
    const bool = reprableBool();
    expect(bool.typeName).toBe("Reprable");
    expect(bool.args).toEqual(["JsRuntime", "Boolean"]);
    // `native = Boolean` lowered via typeValuedFields to a type ref, NOT the
    // runtime value `{$tag:"Boolean"}`. The loader emits `{$ref}` (the
    // aggregable `inputType = List → {$ref:"List"}` precedent — the
    // typeValuedFields path predates the 7g `$ref`→`$ref` sweep).
    expect(bool.methods.native).toEqual({ $ref: "Boolean" });
    expect(bool.methods.lift).toBeDefined();
    expect(bool.methods.lower).toBeDefined();
  });
});

describe("Reprable JsRuntime Boolean — round-trip laws (vs the perf branch)", () => {
  it("lift True ≡ perfConstruct \"True\"  /  lift False ≡ perfConstruct \"False\"", () => {
    const { lift } = reprableBool().methods;
    expect(applyMethod(lift, perfConstruct("True"))).toBe(perfConstruct("True"));
    expect(applyMethod(lift, perfConstruct("True"))).toBe(true);
    expect(applyMethod(lift, perfConstruct("False"))).toBe(perfConstruct("False"));
    expect(applyMethod(lift, perfConstruct("False"))).toBe(false);
  });

  it("lower (perfConstruct \"True\") ≡ True  /  lower (perfConstruct \"False\") ≡ False", () => {
    const { lower } = reprableBool().methods;
    // The pure `True`/`False` are JS booleans in disguise (the degenerate Bool
    // case), so `lower true ≡ True` reads as `true === true`.
    expect(applyMethod(lower, perfConstruct("True"))).toBe(perfConstruct("True"));
    expect(applyMethod(lower, perfConstruct("False"))).toBe(perfConstruct("False"));
  });

  it("reprLowerLiftRoundtrip: lower (lift x) ≡ x   (on Bool, both cases)", () => {
    const { lift, lower } = reprableBool().methods;
    for (const x of [perfConstruct("True"), perfConstruct("False")]) {
      expect(applyMethod(lower, applyMethod(lift, x))).toBe(x);
    }
  });

  it("reprLiftLowerRoundtrip: lift (lower n) ≡ n   (on native JS boolean, both cases)", () => {
    const { lift, lower } = reprableBool().methods;
    for (const n of [true, false]) {
      expect(applyMethod(lift, applyMethod(lower, n))).toBe(n);
    }
  });
});
