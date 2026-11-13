import { describe, expect, test } from "bun:test";
import {
  formatSolverValue,
  readSolverSolutions,
  solverAnswerCount,
  solverBindingsLine,
  solverEvidenceOf,
  solverFamilyFormula,
  solverFamilyParameters,
  solverSolutionsOfKind,
} from "./solver-solutions-format";

const frac = (num: number, den: number) => ({ den, num });
const binding = (name: string, value: unknown) => ({ $tag: "SolveBinding", name, value });
const evidence = {
  $tag: "SolveEvidence",
  method: "Exact Gauss–Jordan elimination over the rationals.",
  checked: "Every equation holds exactly at this answer.",
  steps: ["[1] adults + children = 20", "[2] 12·adults + 8·children = 196"],
  note: "A solver result with its exact re-check and derivation; it is not a kernel certificate.",
};

describe("formatSolverValue", () => {
  test("exact fractions read as whole numbers or a/b, with one sign", () => {
    expect(formatSolverValue(frac(9, 1))).toBe("9");
    expect(formatSolverValue(frac(1, 2))).toBe("1/2");
    expect(formatSolverValue(frac(-7, 5))).toBe("-7/5");
    expect(formatSolverValue(frac(-5, 1))).toBe("-5");
    expect(formatSolverValue(frac(0, 1))).toBe("0");
    expect(formatSolverValue(frac(3, -4))).toBe("-3/4");
    expect(formatSolverValue({ num: 1n, den: 3n })).toBe("1/3");
  });

  test("the invalid 0/0 and non-integer parts are not math text", () => {
    expect(formatSolverValue(frac(0, 0))).toBeUndefined();
    expect(formatSolverValue(frac(1.5, 2))).toBeUndefined();
    expect(formatSolverValue({ num: 1, den: 2, extra: 3 })).toBeUndefined();
    expect(formatSolverValue({ $tag: "Fraction", num: 1, den: 2 })).toBeUndefined();
  });

  test("plain numbers, strings, booleans and Just", () => {
    expect(formatSolverValue(-5)).toBe("-5");
    expect(formatSolverValue(-0)).toBe("0");
    expect(formatSolverValue(0.25)).toBe("0.25");
    expect(formatSolverValue(Number.NaN)).toBeUndefined();
    expect(formatSolverValue("Anna")).toBe("Anna");
    expect(formatSolverValue(true)).toBe("true");
    expect(formatSolverValue({ $tag: "Just", _0: frac(2, 3) })).toBe("2/3");
  });

  test("constructors, lists and records are left to the shared reader", () => {
    expect(formatSolverValue({ $tag: "Paris" })).toBeUndefined();
    expect(formatSolverValue([1, 2])).toBeUndefined();
    expect(formatSolverValue({ name: "x" })).toBeUndefined();
    expect(formatSolverValue(undefined)).toBeUndefined();
    expect(formatSolverValue(null)).toBeUndefined();
  });
});

describe("readSolverSolutions", () => {
  test("OneAnswer: one line per unknown", () => {
    const model = readSolverSolutions({ $tag: "OneAnswer", answer: [binding("adults", frac(9, 1)), binding("children", frac(11, 1))], evidence });
    const one = solverSolutionsOfKind(model, "one");
    expect(one?.answer.map((row) => `${row.name} = ${row.text}`)).toEqual(["adults = 9", "children = 11"]);
    expect(solverEvidenceOf(model)?.parsed?.note).toContain("not a kernel certificate");
    expect(solverEvidenceOf(model)?.parsed?.steps).toHaveLength(2);
  });

  test("EveryAnswer: rows of plain {name, value} records keep their unknowns together", () => {
    const answers = [[{ name: "x", value: -5 }, { name: "y", value: 0 }], [{ name: "x", value: -4 }, { name: "y", value: -3 }]];
    const every = solverSolutionsOfKind(readSolverSolutions({ $tag: "EveryAnswer", answers, evidence: { ...evidence, steps: [] } }), "every");
    expect(every?.answers.map(solverBindingsLine)).toEqual(["x = -5, y = 0", "x = -4, y = -3"]);
    expect(solverAnswerCount(every!.answers.length)).toBe("2 answers");
    expect(solverAnswerCount(1)).toBe("1 answer");
    expect(solverAnswerCount(0)).toBe("0 answers");
  });

  test("a row with a constructor value has no single text line", () => {
    const every = solverSolutionsOfKind(readSolverSolutions({ $tag: "EveryAnswer", answers: [[{ name: "city", value: { $tag: "Paris" } }]], evidence }), "every");
    expect(every?.answers[0]?.[0]?.text).toBeUndefined();
    expect(solverBindingsLine(every!.answers[0]!)).toBeUndefined();
  });

  test("AnswerFamily, NoAnswer and UnknownAnswer", () => {
    const family = solverSolutionsOfKind(readSolverSolutions({ $tag: "AnswerFamily",
      particular: [binding("x", frac(2, 1)), binding("y", frac(0, 1))],
      directions: [[binding("x", frac(-1, 1)), binding("y", frac(1, 1))]], free: ["y"], evidence }), "family");
    expect(family?.free).toEqual(["y"]);
    expect(solverFamilyFormula(family!.particular, family!.directions)).toEqual({ formula: "(x, y) = (2, 0) + t·(-1, 1)", parameters: ["t"] });
    expect(readSolverSolutions({ $tag: "NoAnswer", evidence })?.kind).toBe("none");
    expect(readSolverSolutions({ $tag: "UnknownAnswer", reason: "Not linear." })).toEqual({ kind: "unknown", reason: "Not linear." });
    expect(solverEvidenceOf(readSolverSolutions({ $tag: "UnknownAnswer", reason: "Not linear." }))).toBeUndefined();
  });

  test("positional payloads and a Just wrapper", () => {
    const model = readSolverSolutions({ $tag: "Just", _0: { $tag: "OneAnswer", _0: [{ $tag: "SolveBinding", _0: "x", _1: frac(1, 2) }], _1: evidence } });
    expect(solverSolutionsOfKind(model, "one")?.answer[0]).toMatchObject({ name: "x", text: "1/2" });
    expect(readSolverSolutions({ $tag: "UnknownAnswer", _0: "why" })).toEqual({ kind: "unknown", reason: "why" });
  });

  test("unrecognised evidence is kept raw for the structural reader", () => {
    const model = readSolverSolutions({ $tag: "NoAnswer", evidence: { $tag: "Other", detail: 1 } });
    expect(solverEvidenceOf(model)).toEqual({ raw: { $tag: "Other", detail: 1 } });
  });

  test("any other shape is not a Solutions value", () => {
    expect(readSolverSolutions(undefined)).toBeUndefined();
    expect(readSolverSolutions([])).toBeUndefined();
    expect(readSolverSolutions({ $tag: "Something" })).toBeUndefined();
    expect(readSolverSolutions({ $tag: "OneAnswer", answer: [{ value: 1 }], evidence })).toBeUndefined();
    expect(readSolverSolutions({ $tag: "OneAnswer", answer: "x = 1", evidence })).toBeUndefined();
    expect(readSolverSolutions({ $tag: "AnswerFamily", particular: [], directions: [], free: [1], evidence })).toBeUndefined();
    expect(readSolverSolutions({ $tag: "UnknownAnswer", reason: 3 })).toBeUndefined();
  });
});

describe("solverFamilyFormula", () => {
  const row = (pairs: [string, unknown][]) => pairs.map(([name, value]) => ({ name, value, text: formatSolverValue(value) }));

  test("one unknown, and fractions in a factor are bracketed", () => {
    expect(solverFamilyFormula(row([["x", frac(1, 2)]]), [row([["x", frac(-1, 3)]])]))
      .toEqual({ formula: "x = 1/2 + t·(-1/3)", parameters: ["t"] });
  });

  test("two directions get subscripted parameters", () => {
    const result = solverFamilyFormula(row([["x", 1], ["y", 0], ["z", 0]]),
      [row([["x", -1], ["y", 1], ["z", 0]]), row([["x", -2], ["y", 0], ["z", 1]])]);
    expect(result).toEqual({ formula: "(x, y, z) = (1, 0, 0) + t₁·(-1, 1, 0) + t₂·(-2, 0, 1)", parameters: ["t₁", "t₂"] });
  });

  test("a parameter never reuses an unknown's name", () => {
    expect(solverFamilyParameters(["t", "s"], 1)).toEqual(["k"]);
    expect(solverFamilyParameters(["x"], 0)).toBeUndefined();
  });

  test("mismatched unknowns or non-text values give no formula", () => {
    expect(solverFamilyFormula(row([["x", 1], ["y", 0]]), [row([["y", 1], ["x", 0]])])).toBeUndefined();
    expect(solverFamilyFormula(row([["x", { $tag: "Paris" }]]), [row([["x", 1]])])).toBeUndefined();
    expect(solverFamilyFormula(row([["x", 1]]), [])).toBeUndefined();
  });
});
