// S1 (2026-11-06) — exact linear systems: Gauss–Jordan elimination over
// exact safe-integer fractions with derivation multipliers (`engine:linearSolve`, solve.fenel) and
// its public door (`engine:solverPublicLinear`). Design:
// `workstreams/locus-workspace/notes/2026-11-06-public-solver-clearance.md`.

import { describe, it, expect } from "vitest";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { publicSolverDemoModule } from "./modules/public-demos";

const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });
const add = (a: unknown, b: unknown) => ECall("add", [a, b]);
const sub = (a: unknown, b: unknown) => ECall("sub", [a, b]);
const mul = (a: unknown, b: unknown) => ECall("mul", [a, b]);
const eq = (a: unknown, b: unknown) => ECall("eq", [a, b]);
const and = (...args: unknown[]) => ECall("and", args);
const x = EVar("x");
const y = EVar("y");
const z = EVar("z");

type Equation = { coefficients: unknown[]; constant: unknown };
type Derived = Equation & { multipliers: unknown[] };
type LinearResult = {
  status: string;
  reason: string;
  variables: string[];
  equations: Equation[];
  derived: Derived[];
  values: unknown[];
  directions: unknown[][];
  free: string[];
};

// An exact fraction result { num, den }: safe integers, den > 0, lowest terms.
function fraction(r: unknown): [bigint, bigint] {
  const f = r as { num: number; den: number };
  if (!Number.isSafeInteger(f.num) || !Number.isSafeInteger(f.den) || f.den <= 0) throw new Error(`not a fraction: ${JSON.stringify(r)}`);
  return [BigInt(f.num), BigInt(f.den)];
}
function text(r: unknown): string {
  const [n, d] = fraction(r);
  return d === 1n ? `${n}` : `${n}/${d}`;
}
function addF(a: [bigint, bigint], b: [bigint, bigint]): [bigint, bigint] {
  return [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
}
function mulF(a: [bigint, bigint], b: [bigint, bigint]): [bigint, bigint] {
  return [a[0] * b[0], a[1] * b[1]];
}
function eqF(a: [bigint, bigint], b: [bigint, bigint]): boolean {
  return a[0] * b[1] === b[0] * a[1];
}

function solveLinear(vars: string[], body: unknown): LinearResult {
  return dispatchEngineBody("engine:linearSolve", [vars, body]) as LinearResult;
}

// An independent TS re-check of the result's own data, by exact BigInt
// fractions: substitution and every derivation recomputed from its multipliers.
function recheck(r: LinearResult): void {
  const point = r.values.map(fraction);
  for (const derived of r.derived) {
    const lambda = derived.multipliers.map(fraction);
    const sumConstant = r.equations.reduce<[bigint, bigint]>((acc, e, i) => addF(acc, mulF(lambda[i]!, fraction(e.constant))), [0n, 1n]);
    expect(eqF(sumConstant, fraction(derived.constant))).toBe(true);
    derived.coefficients.forEach((c, j) => {
      const sum = r.equations.reduce<[bigint, bigint]>((acc, e, i) => addF(acc, mulF(lambda[i]!, fraction(e.coefficients[j]))), [0n, 1n]);
      expect(eqF(sum, fraction(c))).toBe(true);
    });
  }
  if (r.status === "unique" || r.status === "family") {
    for (const e of r.equations) {
      const lhs = e.coefficients.reduce<[bigint, bigint]>((acc, c, j) => addF(acc, mulF(fraction(c), point[j]!)), [0n, 1n]);
      expect(eqF(lhs, fraction(e.constant))).toBe(true);
    }
  }
}

describe("exact linear systems", () => {
  it("tickets: a + c = 20, 12a + 8c = 196 ⇒ a = 9, c = 11", () => {
    const r = solveLinear(["a", "c"], and(eq(add(EVar("a"), EVar("c")), ELit(20)), eq(add(mul(ELit(12), EVar("a")), mul(ELit(8), EVar("c"))), ELit(196))));
    expect(r.status).toBe("unique");
    expect(r.values.map(text)).toEqual(["9", "11"]);
    recheck(r);
  }, 120_000);

  it("fractions: 2x + 3y = 1, x - y = 2 ⇒ x = 7/5, y = -3/5", () => {
    const r = solveLinear(["x", "y"], and(eq(add(mul(ELit(2), x), mul(ELit(3), y)), ELit(1)), eq(sub(x, y), ELit(2))));
    expect(r.status).toBe("unique");
    expect(r.values.map(text)).toEqual(["7/5", "-3/5"]);
    expect(r.derived.map((d) => d.coefficients.map(text))).toEqual([["1", "0"], ["0", "1"]]);
    recheck(r);
  }, 120_000);

  it("decimals are read exactly: w + s = 3, 0.1w + 0.4s = 0.6 ⇒ w = 2, s = 1", () => {
    const r = solveLinear(["w", "s"], and(eq(add(EVar("w"), EVar("s")), ELit(3)), eq(add(mul(ELit(0.1), EVar("w")), mul(ELit(0.4), EVar("s"))), ELit(0.6))));
    expect(r.status).toBe("unique");
    expect(r.values.map(text)).toEqual(["2", "1"]);
    recheck(r);
  }, 120_000);

  it("three unknowns ⇒ x = 1, y = 2, z = 3", () => {
    const r = solveLinear(["x", "y", "z"], and(
      eq(add(add(x, y), z), ELit(6)),
      eq(add(sub(mul(ELit(2), x), y), z), ELit(3)),
      eq(sub(add(x, mul(ELit(2), y)), z), ELit(2)),
    ));
    expect(r.status).toBe("unique");
    expect(r.values.map(text)).toEqual(["1", "2", "3"]);
    recheck(r);
  }, 120_000);

  it("the same line twice ⇒ a family: x = 2 - t, y = t", () => {
    const r = solveLinear(["x", "y"], and(eq(add(x, y), ELit(2)), eq(add(mul(ELit(2), x), mul(ELit(2), y)), ELit(4))));
    expect(r.status).toBe("family");
    expect(r.free).toEqual(["y"]);
    expect(r.values.map(text)).toEqual(["2", "0"]);
    expect(r.directions.map((d) => d.map(text))).toEqual([["-1", "1"]]);
    recheck(r);
  }, 120_000);

  it("contradictory totals ⇒ none, with the combination giving 0 = c ≠ 0", () => {
    const r = solveLinear(["x", "y"], and(eq(add(x, y), ELit(2)), eq(add(x, y), ELit(3))));
    expect(r.status).toBe("none");
    expect(r.derived).toHaveLength(1);
    expect(r.derived[0]!.coefficients.map(text)).toEqual(["0", "0"]);
    expect(text(r.derived[0]!.constant)).not.toBe("0");
    recheck(r);
  }, 120_000);

  it("outside the linear fragment ⇒ unsupported, never a guess", () => {
    const cases = [
      eq(mul(x, x), ELit(4)),
      ECall("lte", [add(x, y), ELit(10)]),
      eq(ECall("length", [x]), ELit(2)),
      eq(ECall("div", [ELit(1), x]), ELit(2)),
      eq(ECall("div", [x, ELit(0)]), ELit(2)),
      eq(x, ELit("two")),
      eq(EVar("w"), ELit(2)),
    ];
    for (const body of cases) {
      expect({ body, status: solveLinear(["x", "y"], body).status }).toEqual({ body, status: "unsupported" });
    }
  }, 120_000);

  it("the reader admits only shapes the reflection lift reads as evaluation does (lift.expr.evaluator-fidelity exclusion)", () => {
    // The lift's two documented unfaithful shapes arrive as an EConstruct (a
    // tagged literal with fields) and an ERecord (a one-key operator object
    // with a non-array value). A one-argument `sub x` or `add x` is a partial
    // application when evaluated, not -x or x; an `if` is not an equation.
    const cases = [
      eq(x, { $tag: "EConstruct", ctor: "C", args: [ELit(5)] }),
      eq({ $tag: "ERecord", fields: [{ name: "not", value: ELit(false) }] }, ELit(true)),
      eq(ECall("sub", [x]), ELit(5)),
      eq(ECall("add", [x]), ELit(5)),
      eq(ECall("mul", [ELit(2), x, x]), ELit(4)),
      and(eq(x, ELit(1)), ECall("if", [ELit(true), ELit(true), ELit(false)])),
      eq(x, ELit(null)),
      eq(x, ELit(true)),
    ];
    for (const body of cases) {
      expect({ body, status: solveLinear(["x"], body).status }).toEqual({ body, status: "unsupported" });
      expect({ body, door: (dispatchEngineBody("engine:solverPublicLinear", [["x"], body]) as LinearResult).status }).toEqual({ body, door: "unsupported" });
    }
    const negated = solveLinear(["x"], eq(ECall("negate", [x]), ELit(5)));
    expect(negated.status).toBe("unique");
    expect(negated.values.map(text)).toEqual(["-5"]);
  }, 120_000);

  it("a step outside the safe-integer range answers unsupported instead of a rounded answer", () => {
    const big = 123456789012345;
    const r = solveLinear(["x", "y"], and(
      eq(add(mul(ELit(big), x), mul(ELit(big - 1), y)), ELit(1)),
      eq(add(mul(ELit(big - 2), x), mul(ELit(big + 3), y)), ELit(2)),
    ));
    expect(r.status).toBe("unsupported");
    expect(r.reason).toContain("too large");
  }, 120_000);

  it("std-qualified heads read as the same arithmetic", () => {
    const r = solveLinear(["x", "y"], ECall("std:and", [ECall("std:eq", [ECall("std:add", [x, y]), ELit(10)]), ECall("std.eq", [ECall("std:sub", [x, y]), ELit(4)])]));
    expect(r.status).toBe("unique");
    expect(r.values.map(text)).toEqual(["7", "3"]);
  }, 120_000);

  it("the public door refuses non-fragment input and bad unknown lists", () => {
    const construct = eq(x, { $tag: "EConstruct", ctor: "Just", args: [ELit(1)], fields: [] });
    expect((dispatchEngineBody("engine:solverPublicLinear", [["x"], construct]) as LinearResult).status).toBe("unsupported");
    expect((dispatchEngineBody("engine:solverPublicLinear", [[], eq(x, ELit(1))]) as LinearResult).status).toBe("unsupported");
    expect((dispatchEngineBody("engine:solverPublicLinear", [["a", "b", "c", "d", "e", "f", "g"], eq(x, ELit(1))]) as LinearResult).status).toBe("unsupported");
    expect((dispatchEngineBody("engine:solverPublicLinear", ["x", eq(x, ELit(1))]) as LinearResult).status).toBe("unsupported");
    const ok = dispatchEngineBody("engine:solverPublicLinear", [["x"], eq(mul(ELit(3), x), ELit(1))]) as LinearResult;
    expect(ok.status).toBe("unique");
    expect(ok.values.map(text)).toEqual(["1/3"]);
    expect((dispatchEngineBody("engine:solverPublicLinearFn", [{ $tag: "Unavailable" }]) as LinearResult).status).toBe("unsupported");
  }, 120_000);

  it("the shipped public-demos wiring reaches the same door", () => {
    const native = (publicSolverDemoModule.nativeImpls as Record<string, (...args: unknown[]) => unknown>)["SolverDemo:solverDemoLinear"]!;
    const reified = { $tag: "Reified", package: { params: ["x"], body: eq(mul(ELit(3), x), ELit(1)), captures: [] } };
    const r = native(reified) as LinearResult;
    expect(r.status).toBe("unique");
    expect(r.values.map(text)).toEqual(["1/3"]);
    expect(r).toEqual(dispatchEngineBody("engine:solverPublicLinearFn", [reified]));
    const refused = { $tag: "Reified", package: { params: ["x"], body: eq(x, { $tag: "ERecord", fields: [] }), captures: [] } };
    expect((native(refused) as LinearResult).status).toBe("unsupported");
    expect((native({ $tag: "Unavailable" }) as LinearResult).status).toBe("unsupported");
  }, 300_000);
});
