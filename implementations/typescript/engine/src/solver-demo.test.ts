import { beforeAll, describe, expect, test } from "bun:test";
import { evaluate, invokeCallable, type EvaluateContext } from "./json-logic";
import { setExprEntityModule } from "./modules/set-expr-entities";
import { stdModule } from "./modules/std";
import { createRegistry, type ModuleRegistry } from "./registry";
import { Just, Nothing } from "./type-foundation";
import { publicImageDemoModule, publicSolverDemoModule } from "./modules/public-demos";
import { parseViaFenelParser, PARSE_VIA_FENEL_FAIL } from "./engine-bodies-dispatch";
import { parse } from "./fenel-parser";
import SOLVER_DEMO_SOURCE from "../../../../fenel/examples/solver-demo.fenel?raw";

// C1 fixture: load the complete authored example under its exact source owners.
// The production module supplies its shipped A4 bridges; this fixture adds no
// native override, solver logic or guessed constructor types.
let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  registry = createRegistry([
    stdModule,
    setExprEntityModule,
    publicSolverDemoModule,
    publicImageDemoModule,
  ]);
  context = registry.evaluateContext();
}, 300_000);

function demo(name: string): unknown {
  return evaluate({ call: [`SolverDemo:${name}`] }, {}, context);
}

function publicDemo(name: string, ...args: unknown[]): Record<string, unknown> {
  return evaluate({ call: [`SolverDemo:${name}`, ...args] }, {}, context) as Record<string, unknown>;
}

describe("complete solver source example", () => {
  test("the complete source fits the native parser and matches its compatibility oracle", () => {
    const native = parseViaFenelParser(SOLVER_DEMO_SOURCE);
    expect(native === PARSE_VIA_FENEL_FAIL).toBe(false);
    expect(JSON.stringify(native) === JSON.stringify(parse(SOLVER_DEMO_SOURCE))).toBe(true);
  });

  test("set helpers retain their declared SetExpr return", () => {
    for (const name of ["finiteNumberSet", "closedIntervalSet"]) {
      expect(registry.getFunction(`SolverDemo:${name}`)?.returns).toEqual({ $ref: "SetExpr" });
      expect(registry.getFunctionSignatureInfo(`SolverDemo:${name}`)?.returns.$tag).toBe("Authored");
    }
    expect(demo("closedIntervalSet")).toEqual({
      $tag: "SeInterval",
      interval: {
        lo: Just({ value: 3, inclusive: true }),
        hi: Just({ value: 7, inclusive: true }),
      },
    });
  });

  test.each([
    ["solveSimpleEquality", Just(5)],
    ["solveAffineEquation", Just(0.5)],
    ["solveFiniteChoices", Just([5, 7])],
    ["solveDecidableEmpty", Just([])],
    ["enumerateCharWindow", Just(["a", "b", "c", "d", "e"])],
    ["enumerateRefinedCharUnion", Just(["a", "b", "c", "x", "z"])],
    ["minFiniteSet", Just(1)],
    ["maxFiniteSet", Just(3)],
    ["minClosedInterval", Just(3)],
    ["maxClosedInterval", Just(7)],
    ["solveSymbolicCounterRead", Just(42)],
    ["solveSymbolicFlippedRead", Just(7)],
  ] as const)("%s has its advertised exact answer", (name, expected) => {
    expect(demo(name)).toEqual(expected);
  });

  // Numeric comparisons keep their native predicate (no interval witness);
  // Int/Nat intervals abstain from complete enumeration; the public typed
  // min/max/sample doors do not admit Int/Nat bases (the core throws on a
  // native integer carrier at this commit). These were stale `Just` rows.
  test.each([
    "solveQuadraticFence",
    "solveUnsafeTwoVarFence",
    "solveUnsafeNegationFence",
    "solveRange",
    "enumerateSmallIntegerRange",
    "enumerateDisjointIntegerBands",
    "enumerateMixedEnumAndInterval",
    "minOpenIntegerWindow",
    "maxOpenIntegerWindow",
    "sampleSmallIntegerRange",
    "enumerateDigitInhabitants",
  ])("%s abstains rather than inventing an answer", (name) => {
    expect(demo(name)).toEqual(Nothing);
  });

  test("finite family solving returns all exact bindings", () => {
    const anna = [{ name: "x", value: "anna" }, { name: "y", value: "bob" }];
    const zoe = [{ name: "x", value: "zoe" }, { name: "y", value: "bob" }];
    expect(demo("solveGrandparentOne")).toEqual(Just(anna));
    expect(demo("solveGrandparentAll")).toEqual(Just([anna, zoe]));
    expect(demo("solveGrandparentViaRule")).toEqual(Just([{ name: "x", value: "anna" }]));
    expect(demo("solveGroundNegationAntiJoin")).toEqual(Just(anna));
    expect(demo("solveRelationalOrAll")).toEqual(Just([
      [{ name: "x", value: "anna" }],
      [{ name: "x", value: "zoe" }],
      [{ name: "x", value: "eleonora" }],
    ]));
    expect(demo("solveAntijoinDropsRowsAll")).toEqual(Just([
      [{ name: "x", value: "bob" }, { name: "y", value: "eleonora" }],
      [{ name: "x", value: "carl" }, { name: "y", value: "dan" }],
    ]));
  });

  test("commerce projects declared SolverCustomer and SolverPurchase values", () => {
    expect(demo("customerRows")).toEqual([
      { $tag: "SolverCustomer", id: "cust-1", joinedDay: 1 },
      { $tag: "SolverCustomer", id: "cust-2", joinedDay: 5 },
      { $tag: "SolverCustomer", id: "cust-3", joinedDay: 2 },
      { $tag: "SolverCustomer", id: "cust-4", joinedDay: 1 },
    ]);
    expect(demo("purchaseRows")).toEqual([
      { $tag: "SolverPurchase", id: "p-1", customerId: "cust-1", book: "book-b" },
      { $tag: "SolverPurchase", id: "p-2", customerId: "cust-2", book: "book-b" },
      { $tag: "SolverPurchase", id: "p-3", customerId: "cust-3", book: "book-b" },
      { $tag: "SolverPurchase", id: "p-4", customerId: "cust-4", book: "book-a" },
    ]);
    const customerOne = [{ name: "customerId", value: "cust-1" }, { name: "joinedDay", value: 1 }];
    expect(demo("queryRecentBookBuyers")).toEqual(Just([
      customerOne,
      [{ name: "customerId", value: "cust-3" }, { name: "joinedDay", value: 2 }],
    ]));
    expect(demo("queryRecentBookBuyerOne")).toEqual(Just(customerOne));
  });

  test("seeded samples are reproducible inhabitants", () => {
    const finite = demo("sampleFiniteSet");
    expect(finite).toEqual(demo("sampleFiniteSet"));
    expect([Just(1), Just(2), Just(3)] as readonly unknown[]).toContainEqual(finite);
  });

  test("public affine inputs change the actual solver witness", () => {
    const baseline = publicDemo("affineEquation", 2, 5, 6);
    expect(baseline.answer).toEqual(Just(0.5));
    expect(baseline).toMatchObject({ coefficient: 2, offset: 5, target: 6 });
    expect(baseline.predicate).toMatchObject({ $tag: "ECall", fnId: "eq" });
    expect(baseline.interpretation).toContain("not a proof certificate");
    const changed = publicDemo("affineEquation", 4, 1, 9);
    expect(changed.answer).toEqual(Just(2));
    expect(changed.predicate).not.toEqual(baseline.predicate);
  });

  test.each([[0.1, 0.1, 2], [0.1, 0.2, 7]])("public affine decimal candidates must satisfy the exact original equation: %s*x + %s = %s", (coefficient, offset, target) => {
    const result = publicDemo("affineEquation", coefficient, offset, target);
    const answer = result.answer as { $tag: "Just"; _0: number } | { $tag: "Nothing" };
    if (answer.$tag === "Just") {
      expect(coefficient * answer._0 + offset === target).toBe(true);
    } else {
      expect(answer as unknown).toEqual(Nothing);
      expect(result.interpretation).toContain("does not prove that no solution exists");
    }
  });

  test("public family queries return bindings or a decidably empty answer", () => {
    const matched = publicDemo("grandparentsOf", "eleonora");
    expect(matched.answer).toEqual(Just([
      [{ name: "x", value: "anna" }, { name: "y", value: "bob" }],
      [{ name: "x", value: "zoe" }, { name: "y", value: "bob" }],
    ]));
    expect(matched.facts).toEqual(demo("parentFacts"));
    const empty = publicDemo("grandparentsOf", "dan");
    expect(empty.answer).toEqual(Just([]));
    expect(empty.interpretation).toContain("Decidably empty");
  });

  test("public commerce inputs use the declared SolverCustomer and SolverPurchase rows", () => {
    const customers = demo("customerRows") as unknown[];
    const purchases = demo("purchaseRows") as unknown[];
    const baseline = publicDemo("bookBuyersBefore", "book-b", 3, customers, purchases);
    expect(baseline.answer).toEqual(demo("queryRecentBookBuyers"));
    expect(baseline.customers).toEqual(customers);
    expect(baseline.purchases).toEqual(purchases);
    expect(publicDemo("bookBuyersBefore", "book-a", 3, customers, purchases).answer).toEqual(Just([
      [{ name: "customerId", value: "cust-4" }, { name: "joinedDay", value: 1 }],
    ]));
    const editedSolverCustomers = [{ $tag: "SolverCustomer", id: "visitor", joinedDay: 2 }];
    const editedSolverPurchases = [{ $tag: "SolverPurchase", id: "visitor-purchase", customerId: "visitor", book: "edited-book" }];
    expect(publicDemo("bookBuyersBefore", "edited-book", 3, editedSolverCustomers, editedSolverPurchases).answer).toEqual(Just([
      [{ name: "customerId", value: "visitor" }, { name: "joinedDay", value: 2 }],
    ]));
    const empty = publicDemo("bookBuyersBefore", "missing-book", 3, customers, purchases);
    expect(empty.answer).toEqual(Just([]));
    expect(empty.interpretation).toContain("Decidably empty");
  });

  test("public output preserves the difference between an empty answer and abstention", () => {
    const empty = publicDemo("finiteIntersection", 1, 2);
    expect(empty.answer).toEqual(Just([]));
    expect(empty.interpretation).toContain("Just []");
    expect(publicDemo("finiteIntersection", 7, 7).answer).toEqual(Just([7]));
    const unsupported = publicDemo("quadraticEquation", 9);
    expect(unsupported.answer).toEqual(Nothing);
    expect(unsupported.interpretation).toContain("Undecided");
    expect(unsupported.interpretation).toContain("does not mean");
    expect(publicDemo("quadraticEquation", 16).answer).toEqual(Nothing);
  });

  test("caller-frame re-checks accept true answers and refuse forged ones (GP-12)", () => {
    const parents = (demo("parentFacts") as { relations: { rows: string[][] }[] }).relations[0]!.rows;
    const row = (x: string, y: string) => [{ name: "x", value: x }, { name: "y", value: y }];
    const grand = (r: unknown) => publicDemo("solverDemoGrandparentRow", parents, "eleonora", r) as unknown;
    expect(grand(row("anna", "bob"))).toBe(true);
    expect(grand(row("carl", "dan"))).toBe(false);
    expect(grand(row("bob", "eleonora"))).toBe(false);
    const customers = demo("customerRows");
    const purchases = demo("purchaseRows");
    const buyer = (id: string, day: number) => publicDemo("solverDemoBookBuyerRow", "book-b", 3, customers, purchases,
      [{ name: "customerId", value: id }, { name: "joinedDay", value: day }]) as unknown;
    expect(buyer("cust-1", 1)).toBe(true);
    expect(buyer("cust-2", 5)).toBe(false);
    expect(buyer("cust-1", 2)).toBe(false);
    expect(buyer("cust-4", 1)).toBe(false);
    // A forged row in an otherwise true answer withholds the whole answer.
    const holds = invokeCallable({ $ref: "SolverDemo:solverDemoGrandparentRow" }, [parents, "eleonora"], context);
    const checked = (answer: unknown) => invokeCallable({ $ref: "SolverDemo:solverDemoCheckedRows" }, [holds, answer], context);
    expect(checked(Just([row("anna", "bob"), row("zoe", "bob")]))).toEqual(Just([row("anna", "bob"), row("zoe", "bob")]));
    expect(checked(Just([row("anna", "bob"), row("carl", "dan")]))).toEqual(Nothing);
    expect(checked(Nothing)).toEqual(Nothing);
  });

  test("raw solver bridges retain non-number payloads instead of promising Number", () => {
    const predicate = { $tag: "ECall", fnId: "eq", args: [
      { $tag: "EVar", name: "x" }, { $tag: "ELit", value: "alpha" },
    ] };
    expect(publicDemo("solverDemoSolve", predicate)).toEqual(Just("alpha"));
    expect(publicDemo("solverDemoSolveAll", predicate)).toEqual(Just(["alpha"]));
    // The same bridges abstain outside the authority-invariant fragment.
    const constructed = { $tag: "ECall", fnId: "eq", args: [
      { $tag: "EVar", name: "x" }, { $tag: "EConstruct", ctor: "Just", args: [{ $tag: "ELit", value: 1 }], fields: [] },
    ] };
    expect(publicDemo("solverDemoSolve", constructed)).toEqual(Nothing);
    expect(publicDemo("solverDemoSolveAll", constructed)).toEqual(Nothing);
  });

  test("the public example does not take sound's existing bound name", () => {
    expect(publicSolverDemoModule.functions!.some(fn => fn.id === "SolverDemo:bound")).toBe(false);
    expect(publicSolverDemoModule.functions!.some(fn => fn.id === "SolverDemo:solverDemoBound")).toBe(true);
  });

  test("public signatures expose their real result records and commerce argument types", () => {
    for (const name of ["affineEquation", "grandparentsOf", "bookBuyersBefore", "finiteIntersection", "quadraticEquation"]) {
      const fn = registry.getFunction(`SolverDemo:${name}`);
      expect(fn?.returns).toHaveProperty("$record.fields");
      expect((fn?.returns as { $record: { fields: { name: string }[] } }).$record.fields.map(field => field.name))
        .toContain("answer");
      expect(registry.getFunctionSignatureInfo(`SolverDemo:${name}`)?.returns.$tag).toBe("Authored");
    }
    // Raw source declarations precede physical field identity collection;
    // inspect their carrier without feeding source handles to a decider.
    const fn = publicSolverDemoModule.functions!.find(fn => fn.id === "SolverDemo:bookBuyersBefore")!;
    expect(fn.params[2]!.type).toMatchObject({ $opaque: { name: "List", pure: { $variant: {
      cases: expect.arrayContaining([expect.objectContaining({ name: "Cons", fields: expect.arrayContaining([
        expect.objectContaining({ name: "head", type: { $ref: "SolverCustomer" } }),
      ]) })]),
    } } } });
    expect(fn.params[3]!.type).toMatchObject({ $opaque: { name: "List", pure: { $variant: {
      cases: expect.arrayContaining([expect.objectContaining({ name: "Cons", fields: expect.arrayContaining([
        expect.objectContaining({ name: "head", type: { $ref: "SolverPurchase" } }),
      ]) })]),
    } } } });
    expect(registry.getIdentifiedEntity("Expr")).toBeDefined();
  });

  test("starting inputs carry callable values and source-owned typed example rows", () => {
    const inputs = demo("solverDemoStartingInputs") as { function: { $ref: string }; arguments: unknown[] }[];
    expect(inputs.map(input => input.function.$ref)).toEqual([
      "SolverDemo:affineEquation", "SolverDemo:grandparentsOf", "SolverDemo:bookBuyersBefore",
      "SolverDemo:finiteIntersection", "SolverDemo:quadraticEquation",
      "SolverDemo:solve", "SolverDemo:solve", "SolverDemo:solve",
      "SolverDemo:solve", "SolverDemo:solve", "SolverDemo:solve",
      "SolverDemo:solve", "SolverDemo:solve", "SolverDemo:solve",
      "SolverDemo:destinationsFrom", "SolverDemo:oneChangeTrips", "SolverDemo:reachableOnlyFrom", "SolverDemo:meetingSlots",
    ]);
    expect(inputs.slice(5, 14).map(input => (input.arguments[0] as { $ref: string }).$ref)).toEqual([
      "SolverDemo:ticketsSold", "SolverDemo:exactFractions", "SolverDemo:mixingSolutions",
      "SolverDemo:threeUnknowns", "SolverDemo:sameLineTwice", "SolverDemo:contradictoryTotals",
      "SolverDemo:circleOfRadiusFive", "SolverDemo:circleOfRadiusFive", "SolverDemo:coinsMakeTwentyOne",
    ]);
    expect(inputs[0]!.arguments).toEqual([2, 5, 6]);
    expect(inputs[2]!.arguments).toEqual(["book-b", 3, demo("customerRows"), demo("purchaseRows")]);
    expect(invokeCallable(inputs[0]!.function, inputs[0]!.arguments, context)).toMatchObject({ answer: Just(0.5) });
    expect(invokeCallable(inputs[3]!.function, inputs[3]!.arguments, context)).toMatchObject({ answer: Just([]) });
    expect(invokeCallable(inputs[4]!.function, inputs[4]!.arguments, context)).toMatchObject({ answer: Nothing });
    const imageRows = evaluate({ call: ["ImageDemo:imageMatrixSampleRows"] }, {}, context);
    const image = evaluate({ call: ["ImageDemo:imageMatrixSample"] }, {}, context);
    expect(evaluate({ call: ["ImageDemo:imageDemoStartingInputs"] }, {}, context)).toEqual([
      { function: { $ref: "ImageDemo:imageFilterDemo" }, arguments: [2, 4] },
      { function: { $ref: "ImageDemo:imageMatrixDemo" }, arguments: [3, 2, imageRows] },
      { function: { $ref: "ImageDemo:imageRows" }, arguments: [image] },
      { function: { $ref: "ImageDemo:imageFromRows" }, arguments: [3, 2, imageRows] },
    ]);
  });
});
