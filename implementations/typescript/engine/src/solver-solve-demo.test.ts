// The public `solve` (SolverDemo, 2026-11-06): one call on an ordinary
// predicate function, a typed Solutions answer, and the evidence it carries.
// S1 — exact linear systems over all numbers.

import { beforeAll, describe, expect, test } from "bun:test";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { setExprEntityModule } from "./modules/set-expr-entities";
import { stdModule } from "./modules/std";
import { createRegistry, type ModuleRegistry } from "./registry";
import { publicImageDemoModule, publicSolverDemoModule } from "./modules/public-demos";

let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  registry = createRegistry([stdModule, setExprEntityModule, publicSolverDemoModule, publicImageDemoModule]);
  context = registry.evaluateContext();
}, 300_000);

const ref = (name: string) => ({ $ref: `SolverDemo:${name}` });
const tag = (name: string, fields: Record<string, unknown> = {}) => ({ $tag: name, ...fields });
type Binding = { name: string; value: unknown };
type Solutions = {
  $tag: string;
  answer?: Binding[];
  answers?: Binding[][];
  particular?: Binding[];
  directions?: Binding[][];
  free?: string[];
  reason?: string;
  evidence?: { method: string; checked: string; steps: string[]; note: string };
};

function solve(predicate: string, domain: unknown): Solutions {
  return invokeCallable(ref("solve"), [ref(predicate), domain], context) as Solutions;
}
// A linear answer's value is an exact fraction { num, den }.
function text(r: unknown): string {
  const f = r as { num: number; den: number };
  return f.den === 1 ? `${f.num}` : `${f.num}/${f.den}`;
}
// A runtime closure the way the `fn` op builds it (json-logic.ts).
const closure = (params: string[], body: unknown) => ({ __fenelFn: true as const, params, body, closure: {} });
function exact(bindings: Binding[]): Record<string, string> {
  return Object.fromEntries(bindings.map((b) => [b.name, text(b.value)]));
}

describe("solve over all numbers (exact linear systems)", () => {
  test("tickets sold: 9 adults and 11 children, re-checked exactly and by calling the predicate", () => {
    const r = solve("ticketsSold", tag("AllNumbers"));
    expect(r.$tag).toBe("OneAnswer");
    expect(exact(r.answer!)).toEqual({ adults: "9", children: "11" });
    expect(r.evidence!.checked).toContain("Every equation holds exactly");
    expect(r.evidence!.checked).toContain("also returns true");
    expect(r.evidence!.note).toContain("not a kernel certificate");
    expect(r.evidence!.steps.length).toBeGreaterThanOrEqual(4);
  }, 120_000);

  test("exact fractions: x = 7/5, y = -3/5", () => {
    const r = solve("exactFractions", tag("AllNumbers"));
    expect(r.$tag).toBe("OneAnswer");
    expect(exact(r.answer!)).toEqual({ x: "7/5", y: "-3/5" });
  }, 120_000);

  test("mixing: 2 litres and 1 litre exactly; the floating-point predicate itself disagrees, and says so", () => {
    const r = solve("mixingSolutions", tag("AllNumbers"));
    expect(r.$tag).toBe("OneAnswer");
    expect(exact(r.answer!)).toEqual({ weak: "2", strong: "1" });
    expect(r.evidence!.checked).toContain("floating-point");
  }, 120_000);

  test("three unknowns: 1, 2, 3", () => {
    const r = solve("threeUnknowns", tag("AllNumbers"));
    expect(r.$tag).toBe("OneAnswer");
    expect(exact(r.answer!)).toEqual({ x: "1", y: "2", z: "3" });
  }, 120_000);

  test("the same line twice: a family x = 2 - t, y = t", () => {
    const r = solve("sameLineTwice", tag("AllNumbers"));
    expect(r.$tag).toBe("AnswerFamily");
    expect(r.free).toEqual(["y"]);
    expect(exact(r.particular!)).toEqual({ x: "2", y: "0" });
    expect(r.directions!.map(exact)).toEqual([{ x: "-1", y: "1" }]);
  }, 120_000);

  test("contradictory totals: no answer, with the contradicting combination", () => {
    const r = solve("contradictoryTotals", tag("AllNumbers"));
    expect(r.$tag).toBe("NoAnswer");
    expect(r.evidence!.steps.some((step) => step.includes("gives 0 = "))).toBe(true);
  }, 120_000);

  test("a lambda predicate works the same way", () => {
    const lambda = closure(["a", "b"], { call: ["and",
      { call: ["eq", { call: ["add", { var: "a" }, { var: "b" }] }, 10] },
      { call: ["eq", { call: ["sub", { var: "a" }, { var: "b" }] }, 4] },
    ] });
    const r = invokeCallable(ref("solve"), [lambda, tag("AllNumbers")], context) as Solutions;
    expect(r.$tag).toBe("OneAnswer");
    expect(exact(r.answer!)).toEqual({ a: "7", b: "3" });
  }, 120_000);

  test("outside the linear fragment the answer is Unknown, with the reason", () => {
    const square = closure(["x"], { call: ["eq", { call: ["mul", { var: "x" }, { var: "x" }] }, 4] });
    const r = invokeCallable(ref("solve"), [square, tag("AllNumbers")], context) as Solutions;
    expect(r.$tag).toBe("UnknownAnswer");
    expect(r.reason).toContain("not a conjunction of linear equations");
  }, 120_000);
});

// S2 — finite answer sets over a stated domain.
describe("solve over a stated finite domain", () => {
  const values = (r: Solutions) => r.answers!.map((row) => row.map((b) => b.value).join(",")).sort();

  test("x² + y² = 25 over the whole numbers -5..5: exactly twelve answers, matching a call of the predicate on every candidate", () => {
    const r = solve("circleOfRadiusFive", tag("WholeNumbers", { low: -5, high: 5 }));
    expect(r.$tag).toBe("EveryAnswer");
    expect(values(r)).toEqual(["-3,-4", "-3,4", "-4,-3", "-4,3", "-5,0", "0,-5", "0,5", "3,-4", "3,4", "4,-3", "4,3", "5,0"]);
    expect(r.evidence!.method).toContain("121 candidate combinations");
    expect(r.evidence!.note).toContain("only over the stated domain");
    // The claim rests on calling the predicate on every candidate, not on the reflection lift.
    expect(r.evidence!.checked).toContain("on every candidate combination");
  }, 300_000);

  test("the same circle over all numbers: Unknown, pointing at a finite domain", () => {
    const r = solve("circleOfRadiusFive", tag("AllNumbers"));
    expect(r.$tag).toBe("UnknownAnswer");
    expect(r.reason).toContain("WholeNumbers");
  }, 120_000);

  test("coins making 21 from fives and twos over 0..10: (1, 8) and (3, 3)", () => {
    const r = solve("coinsMakeTwentyOne", tag("WholeNumbers", { low: 0, high: 10 }));
    expect(r.$tag).toBe("EveryAnswer");
    expect(values(r)).toEqual(["1,8", "3,3"]);
  }, 300_000);

  test("explicit choices per unknown, and a definite empty answer", () => {
    const r = solve("coinsMakeTwentyOne", tag("ChoicesFor", { options: [[1, 2, 3], [3, 8]] }));
    expect(r.$tag).toBe("EveryAnswer");
    expect(values(r)).toEqual(["1,8", "3,3"]);
    const none = solve("coinsMakeTwentyOne", tag("ChoicesFor", { options: [[0, 2], [0, 1]] }));
    expect(none.$tag).toBe("EveryAnswer");
    expect(none.answers).toEqual([]);
  }, 300_000);

  test("a range that is too wide or not whole abstains", () => {
    expect(solve("coinsMakeTwentyOne", tag("WholeNumbers", { low: 0, high: 500 })).$tag).toBe("UnknownAnswer");
    expect(solve("coinsMakeTwentyOne", tag("WholeNumbers", { low: 0.5, high: 3 })).$tag).toBe("UnknownAnswer");
    expect(solve("coinsMakeTwentyOne", tag("WholeNumbers", { low: 0, high: 100 })).$tag).toBe("UnknownAnswer");
  }, 300_000);
});

// S3 — relational showcases over typed rows (cities are a nullary-constructor ADT).
describe("relational showcases", () => {
  const call = (name: string, args: unknown[]) => invokeCallable(ref(name), args, context) as Solutions;
  const city = (name: string) => ({ $tag: name });
  const links = () => invokeCallable(ref("railLinks"), [0], context);
  const column = (r: Solutions, name: string) =>
    r.answers!.map((row) => row.find((b) => b.name === name)!.value as { $tag?: string } | string).map((v) => typeof v === "string" ? v : v.$tag!).sort();

  test("where can I go from Lille? Every city reachable directly or with changes", () => {
    const r = call("destinationsFrom", [city("Lille"), links()]);
    expect(r.$tag).toBe("EveryAnswer");
    expect(column(r, "city")).toEqual(["Bordeaux", "Lyon", "Marseille", "Nice", "Paris", "Toulouse"]);
    expect(r.evidence!.note).toContain("closed world");
  }, 300_000);

  test("one change from Paris to Nice in under 6 hours: via Marseille, 190 + 150 minutes", () => {
    const r = call("oneChangeTrips", [city("Paris"), city("Nice"), 360, links()]);
    expect(r.$tag).toBe("EveryAnswer");
    expect(r.answers!.map((row) => Object.fromEntries(row.map((b) => [b.name, typeof b.value === "object" ? (b.value as { $tag: string }).$tag : b.value]))))
      .toEqual([{ change: "Marseille", first: 190, second: 150 }]);
    const slower = call("oneChangeTrips", [city("Paris"), city("Nice"), 400, links()]);
    expect(column(slower, "change")).toEqual(["Lyon", "Marseille"]);
    const none = call("oneChangeTrips", [city("Paris"), city("Nice"), 300, links()]);
    expect(none.$tag).toBe("EveryAnswer");
    expect(none.answers).toEqual([]);
  }, 300_000);

  test("reachable from Bordeaux but not from Lyon: Toulouse (a recursive rule under not)", () => {
    const r = call("reachableOnlyFrom", [city("Bordeaux"), city("Lyon"), links()]);
    expect(r.$tag).toBe("EveryAnswer");
    expect(column(r, "city")).toEqual(["Toulouse"]);
  }, 300_000);

  test("editing the rows changes the answer", () => {
    const fewer = (links() as unknown[]).filter((link) => (link as { origin: { $tag: string } }).origin.$tag !== "Bordeaux");
    const r = call("reachableOnlyFrom", [city("Bordeaux"), city("Lyon"), fewer]);
    expect(r.$tag).toBe("EveryAnswer");
    expect(r.answers).toEqual([]);
  }, 300_000);

  test("a meeting slot when all three are free and the room is not booked", () => {
    const free = invokeCallable(ref("freeSlots"), [0], context);
    const bookings = invokeCallable(ref("roomBookings"), [0], context);
    expect(column(call("meetingSlots", ["Anna", "Bob", "Cleo", "Blue room", free, bookings]), "slot")).toEqual(["Wed 15:00"]);
    expect(column(call("meetingSlots", ["Anna", "Bob", "Cleo", "Green room", free, bookings]), "slot")).toEqual(["Mon 9:00"]);
    expect(column(call("meetingSlots", ["Anna", "Bob", "Dan", "Blue room", free, bookings]), "slot")).toEqual([]);
  }, 300_000);

  test("a query over rows outside the fragment abstains", () => {
    const bad = [{ $tag: "RailLink", origin: { $tag: "Just", _0: "Paris" }, destination: city("Lyon"), minutes: 1 }];
    expect(call("destinationsFrom", [city("Lille"), bad]).$tag).toBe("UnknownAnswer");
  }, 300_000);
});

// The ready-made calls the public Solver collection lists (zero-argument data).
describe("ready-made solve calls", () => {
  test("each equals the solve call it names", () => {
    const pairs: Array<[string, string, unknown]> = [
      ["solveTicketsSold", "ticketsSold", tag("AllNumbers")],
      ["solveSameLineTwice", "sameLineTwice", tag("AllNumbers")],
      ["solveCircleWholeNumbers", "circleOfRadiusFive", tag("WholeNumbers", { low: -5, high: 5 })],
      ["solveCircleAllNumbers", "circleOfRadiusFive", tag("AllNumbers")],
    ];
    const tags: string[] = [];
    for (const [ready, predicate, domain] of pairs) {
      const value = invokeCallable(ref(ready), [], context) as Solutions;
      expect(value).toEqual(solve(predicate, domain));
      tags.push(value.$tag);
    }
    expect(tags).toEqual(["OneAnswer", "AnswerFamily", "EveryAnswer", "UnknownAnswer"]);
  }, 300_000);
});
