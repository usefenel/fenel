// S2 (2026-11-06) — finite answer sets over a STATED domain
// (`engine:solverPublicFinite`, solve.fenel): complete over the domain or
// unsupported, never a shortened list; an unbounded domain is never enumerated.

import { describe, it, expect } from "vitest";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { publicSolverDemoModule } from "./modules/public-demos";

const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });
const x = EVar("x");
const y = EVar("y");
const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

type FiniteResult = { status: string; reason: string; variables: string[]; answers: { name: string; value: unknown }[][]; candidates: number };
const finite = (vars: unknown, body: unknown, domains: unknown) =>
  dispatchEngineBody("engine:solverPublicFinite", [vars, body, domains]) as FiniteResult;
const pairs = (r: FiniteResult) => r.answers.map((row) => row.map((b) => b.value));

describe("finite answer sets over a stated domain", () => {
  it("x² + y² = 25 over the whole numbers -5..5 has exactly twelve answers", () => {
    const circle = ECall("eq", [ECall("add", [ECall("mul", [x, x]), ECall("mul", [y, y])]), ELit(25)]);
    const r = finite(["x", "y"], circle, [range(-5, 5)]);
    expect(r.status).toBe("complete");
    expect(r.candidates).toBe(121);
    expect(pairs(r).map((p) => p.join(",")).sort()).toEqual([
      "-3,-4", "-3,4", "-4,-3", "-4,3", "-5,0", "0,-5", "0,5", "3,-4", "3,4", "4,-3", "4,3", "5,0",
    ]);
    expect(r.answers[0]!.map((b) => b.name)).toEqual(["x", "y"]);
  }, 300_000);

  it("coins: 5f + 2t = 21 over 0..10 ⇒ (1, 8) and (3, 3)", () => {
    const coins = ECall("eq", [ECall("add", [ECall("mul", [ELit(5), EVar("f")]), ECall("mul", [ELit(2), EVar("t")])]), ELit(21)]);
    const r = finite(["f", "t"], coins, [range(0, 10)]);
    expect(r.status).toBe("complete");
    expect(pairs(r).map((p) => p.join(",")).sort()).toEqual(["1,8", "3,3"]);
  }, 300_000);

  it("a definite empty answer is Just [] over the domain", () => {
    const r = finite(["x"], ECall("eq", [ECall("mul", [x, x]), ELit(2)]), [range(-3, 3)]);
    expect(r.status).toBe("complete");
    expect(r.answers).toEqual([]);
  }, 300_000);

  it("explicit per-unknown candidate lists, including nullary constructor values", () => {
    const r = finite(["c", "n"], ECall("and", [ECall("eq", [EVar("c"), ELit({ $tag: "Lyon" })]), ECall("gt", [EVar("n"), ELit(1)])]),
      [[{ $tag: "Paris" }, { $tag: "Lyon" }], [1, 2, 3]]);
    expect(r.status).toBe("complete");
    expect(pairs(r)).toEqual([[{ $tag: "Lyon" }, 2], [{ $tag: "Lyon" }, 3]]);
  }, 300_000);

  it("an undecided candidate makes the answer unsupported, not shortened", () => {
    const r = finite(["x"], ECall("lt", [x, ELit(5)]), [[3, "a", 9]]);
    expect(r.status).toBe("unsupported");
    expect(r.answers).toEqual([]);
  }, 300_000);

  it("bounds: too many candidates, too many unknowns, a mismatched domain list, non-fragment bodies", () => {
    expect(finite(["x", "y"], ECall("eq", [x, y]), [range(0, 100)]).status).toBe("unsupported");
    expect(finite(["a", "b", "c", "d", "e"], ECall("eq", [EVar("a"), ELit(1)]), [[1]]).status).toBe("unsupported");
    expect(finite(["x", "y"], ECall("eq", [x, y]), [[1], [1], [1]]).status).toBe("unsupported");
    expect(finite(["x"], ECall("eq", [x, { $tag: "EConstruct", ctor: "Just", args: [], fields: [] }]), [[1]]).status).toBe("unsupported");
    expect(finite(["x"], ECall("eq", [x, ELit(1)]), [[{ $tag: "Just", _0: 1 }]]).status).toBe("unsupported");
    expect((dispatchEngineBody("engine:solverPublicFiniteFn", [{ $tag: "Unavailable" }, [[1]]]) as FiniteResult).status).toBe("unsupported");
  }, 300_000);

  it("the shipped public-demos wiring reaches the same door", () => {
    const native = (publicSolverDemoModule.nativeImpls as Record<string, (...args: unknown[]) => unknown>)["SolverDemo:solverDemoFinite"]!;
    const reified = { $tag: "Reified", package: { params: ["x"], body: ECall("eq", [ECall("mul", [x, x]), ELit(4)]), captures: [] } };
    const r = native(reified, [range(-3, 3)]) as FiniteResult;
    expect(r.status).toBe("complete");
    expect(pairs(r)).toEqual([[-2], [2]]);
    expect(r).toEqual(dispatchEngineBody("engine:solverPublicFiniteFn", [reified, [range(-3, 3)]]));
    expect((native({ $tag: "Unavailable" }, [[1]]) as FiniteResult).status).toBe("unsupported");
  }, 300_000);
});
