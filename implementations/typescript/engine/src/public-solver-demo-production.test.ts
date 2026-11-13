import { beforeAll, describe, expect, test } from "bun:test";
import { invokeCallable } from "./json-logic";
import type { EvaluateContext } from "./json-logic";
import { modulesFor } from "./module-manifest";
import { createRepositoryRegistry } from "./repository-registry";
import type { ModuleRegistry } from "./registry";
import { dispatchRegistry } from "./system-entities";
import { Just, Nothing } from "./type-foundation";
import { mintAnonymousAuthority } from "../../runtime/src/authority-mint";

// C1 product-boundary fixture: the exact seed profile, physical identities and
// anonymous frame. No source append, evaluator substitute or native override.
let registry: ModuleRegistry;
let context: EvaluateContext;
beforeAll(() => {
  registry = createRepositoryRegistry(modulesFor("seed"), { dispatchRegistry });
  context = { ...registry.evaluateContext(), _authority: mintAnonymousAuthority(registry) };
}, 180_000);

function call(name: string, ...args: unknown[]): unknown {
  const fn = registry.getFunction(`SolverDemo:${name}`);
  if (!fn) throw new Error(`The production solver example ${name} is unavailable.`);
  const handle = registry.getUuid(fn.id);
  if (!handle || registry.getFunction(handle)?.id !== fn.id) throw new Error(`The solver example ${name} has no exact repository identity.`);
  return invokeCallable({ $ref: handle }, args, context);
}

describe("public solver examples in the production seed registry", () => {
  test("anonymous exact-identity calls return changed arithmetic and finite family answers", () => {
    expect(call("affineEquation", 2, 5, 6)).toMatchObject({ answer: Just(0.5) });
    expect(call("affineEquation", 4, 1, 9)).toMatchObject({ answer: Just(2) });
    expect(call("grandparentsOf", "eleonora")).toMatchObject({ answer: Just([
      [{ name: "x", value: "anna" }, { name: "y", value: "bob" }],
      [{ name: "x", value: "zoe" }, { name: "y", value: "bob" }],
    ]) });
  });

  test.each([
    [0.1, 0.1, 2],
    [0.1, 0.2, 7],
    [-0.1, 0.1, 2],
    [1e308, -1e308, 1e308],
    [Number.MIN_VALUE, 0, 1],
  ])("every admitted affine proposal satisfies the exact original equation: %s*x + %s = %s", (coefficient, offset, target) => {
    const result = call("affineEquation", coefficient, offset, target) as {
      answer: { $tag: "Just"; _0: number } | { $tag: "Nothing" };
      interpretation: string;
    };
    if (result.answer.$tag === "Just") {
      expect(coefficient * result.answer._0 + offset === target).toBe(true);
    } else {
      expect(result.answer as unknown).toEqual(Nothing);
      expect(result.interpretation).toContain("does not prove that no solution exists");
    }
  });

  test.each([
    [2, 5, 6, 0.5],
    [-2, 5, 6, -0.5],
    [0.5, 0.25, 1.25, 2],
    [0.1, 0.1, 0.2, 1],
    [1e308, 0, 1e308, 1],
    [Number.MIN_VALUE, 0, Number.MIN_VALUE, 1],
  ])("an exactly satisfying affine witness survives: %s*x + %s = %s", (coefficient, offset, target, witness) => {
    expect(call("affineEquation", coefficient, offset, target)).toMatchObject({ answer: Just(witness) });
    expect(coefficient * witness + offset === target).toBe(true);
  });

  test.each([[0, 5, 5], [0, 5, 6]])("zero-coefficient equations retain solver abstention: %s*x + %s = %s", (coefficient, offset, target) => {
    expect(call("affineEquation", coefficient, offset, target)).toMatchObject({ answer: Nothing });
  });

  test("the finite empty answer remains different from unsupported quadratic abstention", () => {
    const empty = call("finiteIntersection", 1, 2) as { answer: unknown; interpretation: string };
    const unknown = call("quadraticEquation", 9) as { answer: unknown; interpretation: string };
    expect(empty.answer).toEqual(Just([]));
    expect(empty.interpretation).toContain("Decidably empty");
    expect(unknown.answer).toEqual(Nothing);
    expect(unknown.interpretation).toContain("Undecided");
  });

  test("commerce retains its own typed rows beside the existing Purchase type", () => {
    const customers = call("customerRows");
    const purchases = call("purchaseRows");
    expect(call("bookBuyersBefore", "book-b", 3, customers, purchases)).toMatchObject({ answer: Just([
      [{ name: "customerId", value: "cust-1" }, { name: "joinedDay", value: 1 }],
      [{ name: "customerId", value: "cust-3" }, { name: "joinedDay", value: 2 }],
    ]) });
    expect(registry.getIdentifiedEntity("SolverCustomer")).toBeDefined();
    expect(registry.getIdentifiedEntity("SolverPurchase")).toBeDefined();
    expect(registry.getIdentifiedEntity("Expr")).toBeDefined();
    expect(registry.getEntityNominalIdentity("SolverPurchase")).not.toBe(registry.getEntityNominalIdentity("Purchase"));
  });

  test("sound keeps the existing bare bound target after public examples are registered", () => {
    expect(registry.getFunction("bound")?.id).toBe("sound:bound");
    expect(registry.getFunction("SolverDemo:bound")).toBeUndefined();
    expect(registry.getFunction("SolverDemo:solverDemoBound")?.id).toBe("SolverDemo:solverDemoBound");
  });

  test("starting inputs retain exact function identities and run their chosen examples", () => {
    const inputs = call("solverDemoStartingInputs") as { function: { $ref: string }; arguments: unknown[] }[];
    expect(inputs.map(input => input.function.$ref)).toEqual([
      "affineEquation", "grandparentsOf", "bookBuyersBefore", "finiteIntersection", "quadraticEquation",
      "solve", "solve", "solve", "solve", "solve", "solve",
      "solve", "solve", "solve",
      "destinationsFrom", "oneChangeTrips", "reachableOnlyFrom", "meetingSlots",
    ].map(name => {
      const identity = registry.getUuid(`SolverDemo:${name}`);
      if (!identity) throw new Error(`The solver example ${name} is missing its exact repository identity.`);
      return identity;
    }));
    expect(inputs.slice(5, 14).map(input => (input.arguments[0] as { $ref: string }).$ref)).toEqual([
      "ticketsSold", "exactFractions", "mixingSolutions", "threeUnknowns", "sameLineTwice", "contradictoryTotals",
      "circleOfRadiusFive", "circleOfRadiusFive", "coinsMakeTwentyOne",
    ].map(name => {
      const identity = registry.getUuid(`SolverDemo:${name}`);
      if (!identity) throw new Error(`The solver predicate ${name} is missing its exact repository identity.`);
      return identity;
    }));
    expect(inputs[0]!.arguments).toEqual([2, 5, 6]);
    expect(inputs[2]!.arguments).toEqual(["book-b", 3, call("customerRows"), call("purchaseRows")]);
    expect(invokeCallable(inputs[0]!.function, inputs[0]!.arguments, context)).toMatchObject({ answer: Just(0.5) });
    expect(invokeCallable(inputs[3]!.function, inputs[3]!.arguments, context)).toMatchObject({ answer: Just([]) });
    expect(invokeCallable(inputs[4]!.function, inputs[4]!.arguments, context)).toMatchObject({ answer: Nothing });
    const imageRows = invokeCallable({ $ref: registry.getUuid("ImageDemo:imageMatrixSampleRows")! }, [], context);
    const image = invokeCallable({ $ref: registry.getUuid("ImageDemo:imageMatrixSample")! }, [], context);
    expect(invokeCallable({ $ref: registry.getUuid("ImageDemo:imageDemoStartingInputs")! }, [], context)).toEqual([
      { function: { $ref: registry.getUuid("ImageDemo:imageFilterDemo") }, arguments: [2, 4] },
      { function: { $ref: registry.getUuid("ImageDemo:imageMatrixDemo") }, arguments: [3, 2, imageRows] },
      { function: { $ref: registry.getUuid("ImageDemo:imageRows") }, arguments: [image] },
      { function: { $ref: registry.getUuid("ImageDemo:imageFromRows") }, arguments: [3, 2, imageRows] },
    ]);
  });
});
