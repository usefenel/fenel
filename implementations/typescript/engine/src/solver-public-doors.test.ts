// GP-12 clearance (2026-11-06) — the public solver doors and the relational
// completeness repair. Design and argument:
// `workstreams/locus-workspace/notes/2026-11-06-public-solver-clearance.md`.
//
// 1. The source census pins every call site of the four context-dependent
//    reads: the three the ledger names (`syn.witness.ctx-authority`, A5′) and
//    the representation-owner read `exactValueOwnerType` that structural
//    equality consults for numeric-tower records. A new site fails here and
//    forces the fragment argument to be re-examined.
// 2. Every `engine:solverPublic*` door abstains outside the fragment and
//    agrees with its core entry inside it; its answers are scalar data.
// 3. A find-all answer or a materialized derived predicate never rests on a
//    row whose residual condition was undecided.
// 4. The refute-first review of 2026-11-07: calculation arguments in relation
//    atoms, rule-local variables and repeated rule parameters no longer give
//    wrong relational answers; every non-relational door re-checks its answers
//    by membership; door answers do not change when the context-dependent
//    reads and the predicate seams are stubbed to throw.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  engineHarnessIdentity,
  harnessForTests,
  setAlgebraDeciderNativesCtx,
  withEngineDispatchEvaluationSnapshot,
} from "./engine-bodies-dispatch";
import { evaluate } from "./json-logic";
import { publicSolverDemoModule } from "./modules/public-demos";

const ROOT = join(import.meta.dir, "../../../..");

// --- tiny Expr / SetExpr builders (plain $tag-tagged objects) ---------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });
const Just = (v: unknown) => ({ $tag: "Just", _0: v });
const Nothing = { $tag: "Nothing" };
const rel = (name: string, arity: number, rows: unknown[][]) => ({ name, arity, rows });
const factsOf = (relations: unknown[], rules: unknown[] = []) => ({ relations, rules });
const bound = (value: unknown, inclusive: boolean) => Just({ value, inclusive });
const interval = (lo: unknown, hi: unknown) => ({ $tag: "SeInterval", interval: { lo, hi } });
const enumSet = (...values: unknown[]) => ({ $tag: "SeEnum", values });

const PARENT = rel("parentOf", 2, [["anna", "bob"], ["zoe", "bob"], ["bob", "eleonora"], ["carl", "dan"]]);
const GRANDPARENT = ECall("and", [
  ECall("parentOf", [EVar("x"), EVar("y")]),
  ECall("parentOf", [EVar("y"), ELit("eleonora")]),
]);

function scalarOnly(value: unknown): boolean {
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(scalarOnly);
  if (typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (record.$tag === "Just") return keys.join(",") === "$tag,_0" && scalarOnly(record._0);
  if (record.$tag === "Nothing") return keys.join(",") === "$tag";
  // A binding record: exactly { name: String, value: scalar }.
  return keys.join(",") === "name,value" && typeof record.name === "string" && scalarOnly(record.value);
}

// ---------------------------------------------------------------------------
// 1. The census of context-dependent reads.
// ---------------------------------------------------------------------------

function fenelFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) fenelFiles(path, out);
    else if (name.endsWith(".fenel")) out.push(path);
  }
  return out;
}

describe("the four context-dependent reads have exactly the pinned call sites", () => {
  it("checkCtorDeclaredWires / fieldKeyCurrentWire / fnTypeMarker / exactValueOwnerType are called only where the fragment argument says", () => {
    const reads = ["checkCtorDeclaredWires", "fieldKeyCurrentWire", "fnTypeMarker", "exactValueOwnerType"];
    const sites: string[] = [];
    for (const file of fenelFiles(join(ROOT, "fenel"))) {
      let enclosing = "";
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (const line of lines) {
        const signature = /^([A-Za-z_][A-Za-z0-9_']*) :/.exec(line);
        if (signature) enclosing = signature[1]!;
        if (/^\s*--/.test(line) || /^\s*@/.test(line)) continue;
        if (/^[A-Za-z_][A-Za-z0-9_']* :/.test(line)) continue;
        for (const read of reads) {
          if (new RegExp(`\\b${read}\\b`).test(line)) {
            sites.push(`${read} @ ${relative(ROOT, file).replaceAll("\\", "/")}:${enclosing}`);
          }
        }
      }
    }
    expect([...new Set(sites)].sort()).toEqual([
      "checkCtorDeclaredWires @ fenel/modules/engine/check.fenel:checkCtorSourceWires",
      "exactValueOwnerType @ fenel/modules/engine/rel-solve.fenel:deepEqExactOwner",
      "fieldKeyCurrentWire @ fenel/modules/engine/set-algebra-deciders.fenel:seCtorFieldReadWire",
      "fnTypeMarker @ fenel/modules/engine/check.fenel:synthCall",
      "fnTypeMarker @ fenel/modules/engine/set-algebra-deciders.fenel:arrowIdMembership",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. The public doors.
// ---------------------------------------------------------------------------

describe("public solver doors admit the fragment and abstain outside it", () => {
  it("in-fragment queries agree with the core entries, with scalar answers", () => {
    const eq5 = ECall("eq", [EVar("x"), ELit(5)]);
    const affine = ECall("eq", [ECall("add", [ECall("mul", [ELit(2), EVar("x")]), ELit(5)]), ELit(6)]);
    const facts = factsOf([PARENT]);
    const pairs: [string, unknown[], string, unknown[]][] = [
      ["engine:solverPublicSolve", [eq5], "engine:solve", [eq5]],
      ["engine:solverPublicSolve", [affine], "engine:solve", [affine]],
      ["engine:solverPublicSolveAll", [eq5], "engine:solveAll", [eq5]],
      ["engine:solverPublicSolveRel", [GRANDPARENT, facts], "engine:solveRel", [GRANDPARENT, facts]],
      ["engine:solverPublicSolveRelAll", [GRANDPARENT, facts], "engine:solveRelAll", [GRANDPARENT, facts]],
    ];
    for (const [door, doorArgs, core, coreArgs] of pairs) {
      const viaDoor = door === "engine:solverPublicSolve"
        ? dispatchEngineBodyWithDeciderCtx(door, doorArgs)
        : dispatchEngineBody(door, doorArgs);
      const viaCore = core === "engine:solve"
        ? dispatchEngineBodyWithDeciderCtx(core, coreArgs)
        : dispatchEngineBody(core, coreArgs);
      expect({ door, answer: viaDoor }).toEqual({ door, answer: viaCore });
      expect({ door, scalar: scalarOnly(viaDoor) }).toEqual({ door, scalar: true });
    }
    expect(dispatchEngineBodyWithDeciderCtx("engine:solverPublicSolve", [affine])).toEqual(Just(0.5));
    expect(dispatchEngineBody("engine:solverPublicSolveRelAll", [GRANDPARENT, facts])).toEqual(Just([
      [{ name: "x", value: "anna" }, { name: "y", value: "bob" }],
      [{ name: "x", value: "zoe" }, { name: "y", value: "bob" }],
    ]));
  }, 120_000);

  it("typed relation definitions with scalar cells pass; non-scalar cells abstain", () => {
    const customers = [
      { $tag: "SolverCustomer", id: "cust-1", joinedDay: 1 },
      { $tag: "SolverCustomer", id: "cust-2", joinedDay: 5 },
    ];
    const purchases = [{ $tag: "SolverPurchase", id: "p-1", customerId: "cust-1", book: "book-b" }];
    const defs = (rows: unknown[]) => [
      { name: "customer", fieldOrder: ["id", "joinedDay"], instances: rows },
      { name: "bought", fieldOrder: ["customerId", "book"], instances: purchases },
    ];
    const query = ECall("and", [
      ECall("customer", [EVar("c"), EVar("d")]),
      ECall("bought", [EVar("c"), ELit("book-b")]),
      ECall("lt", [EVar("d"), ELit(3)]),
    ]);
    expect(dispatchEngineBody("engine:solverPublicQueryRel", [query, defs(customers), []]))
      .toEqual(dispatchEngineBody("engine:queryRel", [query, defs(customers), []]));
    expect(dispatchEngineBody("engine:solverPublicQueryRel", [query, defs(customers), []]))
      .toEqual(Just([[{ name: "c", value: "cust-1" }, { name: "d", value: 1 }]]));
    const constructorCell = [{ $tag: "SolverCustomer", id: { $tag: "Just", _0: "cust-1" }, joinedDay: 1 }];
    expect(dispatchEngineBody("engine:solverPublicQueryRel", [query, defs(constructorCell), []])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicQueryRelOne", [query, defs(constructorCell), []])).toEqual(Nothing);
  }, 120_000);

  it("every excluded expression shape abstains at the expression doors", () => {
    const excluded = [
      ECall("eq", [EVar("x"), { $tag: "EConstruct", ctor: "Just", args: [ELit(5)], fields: [] }]),
      ECall("eq", [EVar("x"), { $tag: "ELambda", params: ["y"], body: EVar("y") }]),
      ECall("eq", [EVar("x"), { $tag: "ERecord", fields: [] }]),
      ECall("eq", [EVar("x"), { $tag: "EMatch", scrutinee: EVar("x"), arms: [] }]),
      ECall("foo", [EVar("x")]),
      ECall("eq", [EVar("x"), ELit({ $tag: "Just", _0: 5 })]),
      ECall("eq", [EVar("x"), ELit([5])]),
      ECall("eq", [EVar("x"), ELit(Number.POSITIVE_INFINITY)]),
      ECall("eq", [EVar("x"), ELit(null)]),
      "eq x 5",
    ];
    for (const predicate of excluded) {
      expect({ predicate, solve: dispatchEngineBodyWithDeciderCtx("engine:solverPublicSolve", [predicate]) })
        .toEqual({ predicate, solve: Nothing });
      expect({ predicate, all: dispatchEngineBody("engine:solverPublicSolveAll", [predicate]) })
        .toEqual({ predicate, all: Nothing });
      expect({ predicate, enumerable: dispatchEngineBody("engine:solverPublicEnumerableSolveAll", ["Char", predicate]) })
        .toEqual({ predicate, enumerable: Nothing });
    }
  }, 120_000);

  it("relational doors refuse non-scalar facts, unknown heads and malformed rules", () => {
    const base = factsOf([PARENT]);
    const cases: [string, unknown, unknown][] = [
      ["record cell", GRANDPARENT, factsOf([rel("parentOf", 2, [[{ name: "anna" }, "bob"]])])],
      ["constructor cell", GRANDPARENT, factsOf([rel("parentOf", 2, [[{ $tag: "Just", _0: "anna" }, "bob"]])])],
      ["unknown head", ECall("and", [ECall("parentOf", [EVar("x"), EVar("y")]), ECall("likes", [EVar("x")])]), base],
      ["lambda rule body", ECall("grand", [EVar("x"), EVar("y")]), factsOf([PARENT], [{ name: "grand", params: ["a", "c"], body: { $tag: "ELambda", params: [], body: ELit(true) } }])],
      ["non-string param", ECall("grand", [EVar("x"), EVar("y")]), factsOf([PARENT], [{ name: "grand", params: [1, "c"], body: ELit(true) }])],
      ["facts not a record", GRANDPARENT, [PARENT]],
    ];
    for (const [label, predicate, facts] of cases) {
      expect({ label, one: dispatchEngineBody("engine:solverPublicSolveRel", [predicate, facts]) })
        .toEqual({ label, one: Nothing });
      expect({ label, all: dispatchEngineBody("engine:solverPublicSolveRelAll", [predicate, facts]) })
        .toEqual({ label, all: Nothing });
    }
  }, 120_000);

  it("nullary constructor values are admitted as literals and cells; constructors with fields and numeric-tower records are not", () => {
    const paris = { $tag: "Paris" };
    const lyon = { $tag: "Lyon" };
    const nice = { $tag: "Nice" };
    const rail = rel("rail", 3, [[paris, lyon, 120], [lyon, nice, 270]]);
    const fromParis = ECall("rail", [ELit(paris), EVar("to"), EVar("minutes")]);
    expect(dispatchEngineBody("engine:solverPublicSolveRelAll", [fromParis, factsOf([rail])]))
      .toEqual(Just([[{ name: "to", value: lyon }, { name: "minutes", value: 120 }]]));
    expect(dispatchEngineBodyWithDeciderCtx("engine:solverPublicSolve", [ECall("eq", [EVar("x"), ELit(paris)])]))
      .toEqual(Just(paris));
    const withField = { $tag: "Just", _0: "Paris" };
    const succ = { $tag: "Succ" };
    for (const cell of [withField, succ, { $tag: "Zero" }, { $tag: "Rational" }, { $ref: "SolverDemo:city" }]) {
      const facts = factsOf([rel("rail", 3, [[cell, lyon, 120]])]);
      expect({ cell, all: dispatchEngineBody("engine:solverPublicSolveRelAll", [fromParis, facts]) })
        .toEqual({ cell, all: Nothing });
      expect({ cell, solve: dispatchEngineBodyWithDeciderCtx("engine:solverPublicSolve", [ECall("eq", [EVar("x"), ELit(cell)])]) })
        .toEqual({ cell, solve: Nothing });
    }
  }, 120_000);

  it("set doors admit scalar set formers and refuse constructor, named, predicate and recursive sets", () => {
    const closed = interval(bound(3, true), bound(7, true));
    expect(dispatchEngineBody("engine:solverPublicMinOfSet", [closed])).toEqual(Just(3));
    expect(dispatchEngineBody("engine:solverPublicMaxOfSet", [enumSet(3, 1, 2)])).toEqual(Just(3));
    expect(dispatchEngineBody("engine:solverPublicEnumerableSet", ["Char", interval(bound("a", true), bound("c", true))]))
      .toEqual(Just(["a", "b", "c"]));
    const refused = [
      { $tag: "SeCtor", ctor: "Just", fields: [] },
      { $tag: "SeRef", handle: "Nat" },
      { $tag: "SeWhere", pred: ECall("gt", [EVar("x"), ELit(1)]) },
      { $tag: "SeMu", var: "X", body: { $tag: "SeRef", handle: "X" } },
      enumSet({ $tag: "Just", _0: 1 }),
      interval(Just({ value: { n: 1 }, inclusive: true }), Nothing),
      { $tag: "SeUnion", branches: [enumSet(1), { $tag: "SeCtor", ctor: "Nil", fields: [] }] },
      { $enum: [1, 2] },
    ];
    for (const set of refused) {
      expect({ set, min: dispatchEngineBody("engine:solverPublicMinOfSet", [set]) }).toEqual({ set, min: Nothing });
      expect({ set, sample: dispatchEngineBody("engine:solverPublicSampleSet", [1, set]) }).toEqual({ set, sample: Nothing });
      expect({ set, enumerable: dispatchEngineBody("engine:solverPublicEnumerableSet", ["Char", set]) })
        .toEqual({ set, enumerable: Nothing });
      expect({ set, inhabit: dispatchEngineBody("engine:solverPublicEnumerableInhabit", [{ tag: "InhRefined", base: "Char", set }]) })
        .toEqual({ set, inhabit: Nothing });
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 3. Relational completeness.
// ---------------------------------------------------------------------------

describe("relational answers never rest on an undecided residual row", () => {
  // `lt` decides only between numbers: the "a" row is undecided, not false.
  const VALUE = rel("value", 1, [[3], ["a"], [9]]);
  const small = ECall("and", [ECall("value", [EVar("x")]), ECall("lt", [EVar("x"), ELit(5)])]);

  it("find-all abstains when a row is undecided; one proven witness stays available", () => {
    expect(dispatchEngineBody("engine:solveRelAll", [small, factsOf([VALUE])])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solveRel", [small, factsOf([VALUE])])).toEqual(Just([{ name: "x", value: 3 }]));
    const decided = factsOf([rel("value", 1, [[3], [9]])]);
    expect(dispatchEngineBody("engine:solveRelAll", [small, decided])).toEqual(Just([[{ name: "x", value: 3 }]]));
  }, 120_000);

  it("the typed query face (queryRel) abstains on an undecided row as well", () => {
    const defs = [{ name: "value", fieldOrder: ["v"], instances: [{ v: 3 }, { v: "a" }, { v: 9 }] }];
    const query = ECall("and", [ECall("value", [EVar("x")]), ECall("lt", [EVar("x"), ELit(5)])]);
    expect(dispatchEngineBody("engine:queryRel", [query, defs, []])).toEqual(Nothing);
  }, 120_000);

  it("a negated derived predicate whose extension has an undecided row abstains instead of a false witness", () => {
    // smallOne(x) :- value(x), lt x 5. Its extension is {3}; "a" is undecided.
    // Before the repair `value x, not smallOne x` returned "a" as a proven
    // answer, though "a" was never shown to be outside smallOne.
    const facts = factsOf([VALUE], [{
      name: "smallOne",
      params: ["v"],
      body: ECall("and", [ECall("value", [EVar("v")]), ECall("lt", [EVar("v"), ELit(5)])]),
    }]);
    const notSmall = ECall("and", [ECall("value", [EVar("x")]), ECall("not", [ECall("smallOne", [EVar("x")])])]);
    expect(dispatchEngineBody("engine:solveRel", [notSmall, facts])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solveRelAll", [notSmall, facts])).toEqual(Nothing);
    const decidedFacts = factsOf([rel("value", 1, [[3], [9]])], facts.rules);
    expect(dispatchEngineBody("engine:solveRelAll", [notSmall, decidedFacts])).toEqual(Just([[{ name: "x", value: 9 }]]));
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 4. Review findings (refute-first review, 2026-11-07).
// ---------------------------------------------------------------------------

const SeCtor = (ctor: string) => ({ $tag: "SeCtor", ctor, fields: [] });

describe("relational atoms, rule-local variables and repeated parameters (review findings 1-3)", () => {
  const PAIR = rel("pair", 2, [[1, 2], [3, 4]]);

  it("a calculation argument in a relation atom abstains instead of answering an empty result (finding 1)", () => {
    // `pair (add x 0) y` matched no row, so the conjunction answered Just [] —
    // a false "no answer": (1, 2) and (3, 4) satisfy it.
    const query = ECall("and", [
      ECall("pair", [EVar("x"), EVar("y")]),
      ECall("pair", [ECall("add", [EVar("x"), ELit(0)]), EVar("y")]),
    ]);
    expect(dispatchEngineBody("engine:solveRelAll", [query, factsOf([PAIR])])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicSolveRelAll", [query, factsOf([PAIR])])).toEqual(Nothing);
    // The same calculation inside a rule body.
    const shifted = factsOf([PAIR], [{
      name: "shifted",
      params: ["a", "b"],
      body: ECall("pair", [ECall("add", [EVar("a"), ELit(0)]), EVar("b")]),
    }]);
    expect(dispatchEngineBody("engine:solveRelAll", [ECall("shifted", [EVar("x"), EVar("y")]), shifted])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicSolveRelAll", [ECall("shifted", [EVar("x"), EVar("y")]), shifted])).toEqual(Nothing);
  }, 120_000);

  // grandparentOf(a, c) :- parentOf(a, b), parentOf(b, c). `b` is rule-local.
  const GRAND_RULE = {
    name: "grandparentOf",
    params: ["a", "c"],
    body: ECall("and", [
      ECall("parentOf", [EVar("a"), EVar("b")]),
      ECall("parentOf", [EVar("b"), EVar("c")]),
    ]),
  };

  it("a rule-local variable is not captured by a same-named query variable (finding 2)", () => {
    // Inline unfolding turned `grandparentOf x b` into `parentOf x b, parentOf b b`.
    const query = ECall("grandparentOf", [EVar("x"), EVar("b")]);
    const expected = Just([
      [{ name: "x", value: "anna" }, { name: "b", value: "eleonora" }],
      [{ name: "x", value: "zoe" }, { name: "b", value: "eleonora" }],
    ]);
    expect(dispatchEngineBody("engine:solveRelAll", [query, factsOf([PARENT], [GRAND_RULE])])).toEqual(expected);
    expect(dispatchEngineBody("engine:solverPublicSolveRelAll", [query, factsOf([PARENT], [GRAND_RULE])])).toEqual(expected);
  }, 120_000);

  it("two unfoldings of one rule do not share its local variable (finding 2)", () => {
    const chain = rel("parentOf", 2, [["p1", "p2"], ["p2", "p3"], ["p3", "p4"], ["p4", "p5"]]);
    const query = ECall("and", [
      ECall("grandparentOf", [EVar("x"), EVar("y")]),
      ECall("grandparentOf", [EVar("y"), EVar("z")]),
    ]);
    expect(dispatchEngineBody("engine:solveRelAll", [query, factsOf([chain], [GRAND_RULE])])).toEqual(Just([
      [{ name: "x", value: "p1" }, { name: "y", value: "p3" }, { name: "z", value: "p5" }],
    ]));
  }, 120_000);

  it("a rule with a repeated parameter abstains instead of dropping the equality (finding 3)", () => {
    // twin(a, a) :- item(a). Inline unfolding kept only the first `a`, so
    // `item y, twin x y` answered every (x, y) pair, including x ≠ y.
    const facts = factsOf([rel("item", 1, [[1], [2]])], [{
      name: "twin",
      params: ["a", "a"],
      body: ECall("item", [EVar("a")]),
    }]);
    const query = ECall("and", [ECall("item", [EVar("y")]), ECall("twin", [EVar("x"), EVar("y")])]);
    expect(dispatchEngineBody("engine:solveRelAll", [query, facts])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solveRel", [query, facts])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicSolveRelAll", [query, facts])).toEqual(Nothing);
  }, 120_000);
});

describe("non-relational doors re-check every answer (review finding 4)", () => {
  it("an empty string interval has no witness (4a)", () => {
    // x >= "m" and x <= "c" is empty; the witness search answered Just "c".
    const empty = ECall("and", [ECall("gte", [EVar("x"), ELit("m")]), ECall("lte", [EVar("x"), ELit("c")])]);
    expect(dispatchEngineBodyWithDeciderCtx("engine:solverPublicSolve", [empty])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicSolveAll", [empty])).toEqual(Nothing);
    // The core keeps the old answer (tcb-ledger `inhabit.interval-empty`, UNSOUND-KNOWN).
    expect(dispatchEngineBodyWithDeciderCtx("engine:solve", [empty])).toEqual(Just("c"));
    const nonEmpty = ECall("and", [ECall("gte", [EVar("x"), ELit("c")]), ECall("lte", [EVar("x"), ELit("m")])]);
    const witness = dispatchEngineBodyWithDeciderCtx("engine:solverPublicSolve", [nonEmpty]) as { $tag: string; _0?: unknown };
    expect(witness.$tag).toBe("Just");
    expect(String(witness._0) >= "c" && String(witness._0) <= "m").toBe(true);
  }, 120_000);

  it("min and max of an empty or mixed interval abstain (4b)", () => {
    const empty = interval(bound(7, true), bound(3, true));
    // The core keeps the old answers (tcb-ledger `enum.min-max-empty`, UNSOUND-KNOWN).
    expect(dispatchEngineBody("engine:minOfSet", [empty])).toEqual(Just(7));
    expect(dispatchEngineBody("engine:maxOfSet", [empty])).toEqual(Just(3));
    expect(dispatchEngineBody("engine:solverPublicMinOfSet", [empty])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicMaxOfSet", [empty])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicSampleSet", [1, empty])).toEqual(Nothing);
    const mixed = interval(bound(1, true), bound("c", true));
    expect(dispatchEngineBody("engine:solverPublicMinOfSet", [mixed])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicMaxOfSet", [mixed])).toEqual(Nothing);
    const boolBound = interval(bound(true, true), Nothing);
    expect(dispatchEngineBody("engine:solverPublicMinOfSet", [boolBound])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicEnumerableMinOfSet", ["String", empty])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicMinOfSet", [interval(bound(3, true), bound(7, true))])).toEqual(Just(3));
    expect(dispatchEngineBody("engine:solverPublicMaxOfSet", [interval(bound(3, true), bound(7, true))])).toEqual(Just(7));
  }, 120_000);

  it("typed enumeration answers belong to the base type (4c)", () => {
    // Char enumeration read only the first code point of "aa" and listed "aa";
    // Number bounds 1..3 listed [1, "2", "3"]. The core keeps the old answers
    // (tcb-ledger `enum.typed-base`, UNSOUND-KNOWN).
    expect(dispatchEngineBody("engine:enumerableSet", ["Char", interval(bound("aa", true), bound("c", true))])).toEqual(Just(["aa", "b", "c"]));
    expect(dispatchEngineBody("engine:enumerableSet", ["Char", interval(bound(1, true), bound(3, true))])).toEqual(Just([1, "2", "3"]));
    expect(dispatchEngineBody("engine:enumerableSet", ["Int", enumSet(1.5, 2)])).toEqual(Just([1.5, 2]));
    expect(dispatchEngineBody("engine:solverPublicEnumerableSet", ["Char", interval(bound("aa", true), bound("c", true))])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicEnumerableSet", ["Char", interval(bound(1, true), bound(3, true))])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicEnumerableInhabit", [{ tag: "InhRefined", base: "Char", set: interval(bound("aa", true), bound("c", true)) }])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicEnumerableMinOfSet", ["Char", interval(bound("aa", true), bound("c", true))])).toEqual(Nothing);
    // An enum member outside the base, or a base the doors cannot check.
    expect(dispatchEngineBody("engine:solverPublicEnumerableSet", ["Int", enumSet(1.5, 2)])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicEnumerableSet", ["Char", enumSet("ab")])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicEnumerableSet", ["Planet", enumSet(1)])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicEnumerableSet", ["Int", enumSet(2, 1)])).toEqual(Just([2, 1]));
    // A Char range wider than 4096 code points abstains instead of building it.
    expect(dispatchEngineBody("engine:solverPublicEnumerableSet", ["Char", interval(bound("a", true), bound("\u{10000}", true))])).toEqual(Nothing);
    expect(dispatchEngineBody("engine:solverPublicEnumerableSet", ["Char", interval(bound("a", true), bound("c", true))])).toEqual(Just(["a", "b", "c"]));
  }, 120_000);

  it("a predicate whose set leaves the fragment abstains before any witness search (findings 4 and 8)", () => {
    const illTyped = [
      ECall("eq", [ECall("add", [EVar("x"), ELit("a")]), ELit(5)]),
      ECall("eq", [ECall("and", [EVar("x"), ELit(1)]), ELit(true)]),
      ECall("lt", [EVar("x"), ELit({ $tag: "Paris" })]),
      ECall("eq", [ECall("mul", [EVar("x"), EVar("x")]), ELit(4)]),
      ECall("gt", [EVar("x"), ELit(true)]),
    ];
    for (const predicate of illTyped) {
      expect({ predicate, solve: dispatchEngineBodyWithDeciderCtx("engine:solverPublicSolve", [predicate]) }).toEqual({ predicate, solve: Nothing });
      expect({ predicate, all: dispatchEngineBody("engine:solverPublicSolveAll", [predicate]) }).toEqual({ predicate, all: Nothing });
    }
  }, 120_000);
});

describe("door inputs: names, arities, constructors and refused sets (review findings 7, 9, 10)", () => {
  it("duplicate names, operator names and rows of the wrong length abstain (finding 9)", () => {
    const query = ECall("parentOf", [EVar("x"), EVar("y")]);
    const duplicate = factsOf([rel("parentOf", 2, [["anna", "bob"]]), rel("parentOf", 2, [["zoe", "bob"]])]);
    expect(dispatchEngineBody("engine:solverPublicSolveRelAll", [query, duplicate])).toEqual(Nothing);
    const ruleShadow = factsOf([rel("parentOf", 2, [["anna", "bob"]])], [{ name: "parentOf", params: ["a", "b"], body: ELit(true) }]);
    expect(dispatchEngineBody("engine:solverPublicSolveRelAll", [query, ruleShadow])).toEqual(Nothing);
    const operatorName = factsOf([rel("lt", 2, [[5, 1]])]);
    expect(dispatchEngineBody("engine:solverPublicSolveRelAll", [ECall("lt", [EVar("x"), EVar("y")]), operatorName])).toEqual(Nothing);
    const longRow = factsOf([rel("pair", 2, [[1, 2, 3]])]);
    expect(dispatchEngineBody("engine:solverPublicSolveRelAll", [ECall("pair", [EVar("x"), EVar("y")]), longRow])).toEqual(Nothing);
    const typedDuplicate = [
      { name: "value", fieldOrder: ["v"], instances: [{ v: 3 }] },
      { name: "value", fieldOrder: ["v"], instances: [{ v: 4 }] },
    ];
    expect(dispatchEngineBody("engine:solverPublicQueryRel", [ECall("value", [EVar("x")]), typedDuplicate, []])).toEqual(Nothing);
  }, 120_000);

  it("native-carrier constructor literals and instances missing a field abstain (finding 10)", () => {
    for (const tag of ["True", "False", "Nil"]) {
      expect({ tag, solve: dispatchEngineBodyWithDeciderCtx("engine:solverPublicSolve", [ECall("eq", [EVar("x"), ELit({ $tag: tag })])]) })
        .toEqual({ tag, solve: Nothing });
    }
    const defs = [{ name: "value", fieldOrder: ["v"], instances: [{ v: 3 }, { w: 1 }] }];
    expect(dispatchEngineBody("engine:solverPublicQueryRel", [ECall("value", [EVar("x")]), defs, []])).toEqual(Nothing);
  }, 120_000);

  it("arrow, constructor, pattern and rigid sets are refused at every set door, also nested (finding 7)", () => {
    const refused = [
      { $tag: "SeArrow", domain: { $tag: "SeAll" }, codomain: { $tag: "SeAll" } },
      { $tag: "SeComplement", inner: SeCtor("Nil") },
      { $tag: "SeDiff", left: { $tag: "SeAll" }, right: SeCtor("Nil") },
      { $tag: "SeIntersect", branches: [{ $tag: "SeAll" }, SeCtor("Nil")] },
      { $tag: "SePattern", pattern: "^a" },
      { $tag: "SeRigid", name: "k" },
    ];
    for (const set of refused) {
      expect({ set, min: dispatchEngineBody("engine:solverPublicMinOfSet", [set]) }).toEqual({ set, min: Nothing });
      expect({ set, max: dispatchEngineBody("engine:solverPublicMaxOfSet", [set]) }).toEqual({ set, max: Nothing });
      expect({ set, sample: dispatchEngineBody("engine:solverPublicSampleSet", [1, set]) }).toEqual({ set, sample: Nothing });
      expect({ set, enumerable: dispatchEngineBody("engine:solverPublicEnumerableSet", ["Char", set]) }).toEqual({ set, enumerable: Nothing });
      expect({ set, typedMin: dispatchEngineBody("engine:solverPublicEnumerableMinOfSet", ["String", set]) }).toEqual({ set, typedMin: Nothing });
      expect({ set, typedMax: dispatchEngineBody("engine:solverPublicEnumerableMaxOfSet", ["String", set]) }).toEqual({ set, typedMax: Nothing });
      expect({ set, typedSample: dispatchEngineBody("engine:solverPublicEnumerableSampleSet", ["String", 1, set]) }).toEqual({ set, typedSample: Nothing });
      expect({ set, inhabit: dispatchEngineBody("engine:solverPublicEnumerableInhabit", [{ tag: "InhRefined", base: "Char", set }]) }).toEqual({ set, inhabit: Nothing });
    }
  }, 120_000);

  it("all sixteen SolverDemo entry points, through the shipped public-demos wiring, answer the door's answer (finding 7)", () => {
    const natives = publicSolverDemoModule.nativeImpls as Record<string, (...args: unknown[]) => unknown>;
    const eq5 = ECall("eq", [EVar("x"), ELit(5)]);
    const lambdaPred = ECall("eq", [EVar("x"), { $tag: "ELambda", params: ["y"], body: EVar("y") }]);
    const facts = factsOf([PARENT]);
    const charWindow = ECall("and", [ECall("gte", [EVar("c"), ELit("a")]), ECall("lte", [EVar("c"), ELit("c")])]);
    const closed = interval(bound(3, true), bound(7, true));
    const strings = interval(bound("b", true), bound("d", true));
    const defs = [{ name: "value", fieldOrder: ["v"], instances: [{ v: 3 }, { v: 9 }] }];
    const valueQuery = ECall("and", [ECall("value", [EVar("x")]), ECall("lt", [EVar("x"), ELit(5)])]);
    const counter = ECall("eq", [ECall("$effect:HasStateIO:getInstance", [ELit("counter")]), ELit(42)]);
    const cases: [string, unknown[], unknown, unknown[]][] = [
      ["solverDemoSolve", [eq5], Just(5), [lambdaPred]],
      ["solverDemoSolveAll", [eq5], Just([5]), [lambdaPred]],
      ["solverDemoSolveRel", [GRANDPARENT, facts], Just([{ name: "x", value: "anna" }, { name: "y", value: "bob" }]), [GRANDPARENT, [PARENT]]],
      ["solverDemoSolveRelAll", [GRANDPARENT, facts], Just([
        [{ name: "x", value: "anna" }, { name: "y", value: "bob" }],
        [{ name: "x", value: "zoe" }, { name: "y", value: "bob" }],
      ]), [GRANDPARENT, [PARENT]]],
      ["solverDemoQueryRel", [valueQuery, defs, []], Just([[{ name: "x", value: 3 }]]), [valueQuery, [{ name: "value", fieldOrder: ["v"], instances: [{ v: { n: 1 } }] }], []]],
      ["solverDemoQueryRelOne", [valueQuery, defs, []], Just([{ name: "x", value: 3 }]), [valueQuery, defs, "rules"]],
      ["solverDemoSampleSet", [1, enumSet(4)], Just(4), [1, SeCtor("Nil")]],
      ["solverDemoMinOfSet", [closed], Just(3), [interval(bound(7, true), bound(3, true))]],
      ["solverDemoMaxOfSet", [closed], Just(7), [interval(bound(7, true), bound(3, true))]],
      ["solverDemoEnumerableSet", ["Char", interval(bound("a", true), bound("c", true))], Just(["a", "b", "c"]), ["Char", interval(bound("aa", true), bound("c", true))]],
      ["solverDemoEnumerableSolveAll", ["Char", charWindow], Just(["a", "b", "c"]), ["Char", lambdaPred]],
      ["solverDemoEnumerableInhabit", [{ tag: "InhRefined", base: "Char", set: interval(bound("a", true), bound("b", true)) }], Just(["a", "b"]), [{ tag: "InhRefined", base: "Planet", set: enumSet(1) }]],
      ["solverDemoEnumerableMinOfSet", ["String", strings], Just("b"), ["Int", closed]],
      ["solverDemoEnumerableMaxOfSet", ["String", strings], Just("d"), ["Nat", closed]],
      ["solverDemoEnumerableSampleSet", ["String", 1, enumSet("q")], Just("q"), ["String", 1, interval(bound("d", true), bound("b", true))]],
      ["solverDemoSolveSymbolic", [[], counter], Just(42), [[], ECall("eq", [ECall("$effect:HasStateIO:getInstance", [ELit("counter")]), ELit({ $tag: "Just", _0: 1 })])]],
    ];
    expect(cases.length).toBe(16);
    // The `solve` entry points (exact linear, finite domains) return records,
    // not scalars; they are tested through this wiring in solver-linear.test.ts
    // and solver-finite.test.ts.
    const covered = cases.map(([name]) => `SolverDemo:${name}`);
    const solveEntryPoints = ["SolverDemo:solverDemoLinear", "SolverDemo:solverDemoFinite"];
    for (const key of covered) expect({ key, wired: typeof natives[key] }).toEqual({ key, wired: "function" });
    expect(Object.keys(natives).filter((k) => k.startsWith("SolverDemo:") && !covered.includes(k) && !solveEntryPoints.includes(k))).toEqual([]);
    for (const [name, admitted, answer, refused] of cases) {
      const native = natives[`SolverDemo:${name}`]!;
      expect({ name, admitted: native(...admitted) }).toEqual({ name, admitted: answer });
      expect({ name, scalar: scalarOnly(native(...admitted)) }).toEqual({ name, scalar: true });
      expect({ name, refused: native(...refused) }).toEqual({ name, refused: Nothing });
    }
  }, 300_000);
});

// ---------------------------------------------------------------------------
// The runtime tripwire (review finding 6). The census above pins first-hop
// mentions only; here every door runs with the four context-dependent reads
// and the three seams that could carry context (bodyToExpr, namedMember,
// whereMember) replaced by natives that throw. `exactValueOwnerType` is also
// reached inside the deepEqValueTri native's own context, so that native
// refuses numeric-tower arguments here. The answers must equal the shipped
// dispatch's answers.
// ---------------------------------------------------------------------------

const TRIPPED = ["checkCtorDeclaredWires", "fieldKeyCurrentWire", "fnTypeMarker", "exactValueOwnerType", "bodyToExpr", "namedMember", "whereMember"];
const TOWER = new Set(["Nat", "Int", "Rational", "Zero", "Succ"]);

function mentionsTower(value: unknown, depth = 0): boolean {
  if (depth > 32 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => mentionsTower(v, depth + 1));
  const record = value as Record<string, unknown>;
  if (typeof record.$tag === "string" && TOWER.has(record.$tag)) return true;
  return Object.values(record).some((v) => mentionsTower(v, depth + 1));
}

function tripwiredDispatch(fnId: string, args: unknown[], decider: boolean): unknown {
  const { ctx } = harnessForTests();
  const reg = engineHarnessIdentity() as { getFunction(id: string): { params: { name: string }[]; body?: unknown } | undefined };
  const fn = reg.getFunction(fnId);
  if (fn === undefined || fn.body === undefined) throw new Error(`no body for ${fnId}`);
  const natives: Record<string, unknown> = Object.assign(
    Object.create(null),
    ctx.nativesCtx ?? {},
    decider ? setAlgebraDeciderNativesCtx(null) : {},
  );
  const trip = (name: string) => () => { throw new Error(`tripwire: ${name} was called`); };
  const originals = new Set<unknown>();
  for (const name of TRIPPED) {
    for (const key of [name, `engine:${name}`]) if (natives[key] !== undefined) originals.add(natives[key]);
  }
  for (const key of Object.keys(natives)) if (originals.has(natives[key])) natives[key] = trip(key);
  for (const name of TRIPPED) {
    natives[name] = trip(name);
    natives[`engine:${name}`] = trip(name);
  }
  const deepEq = natives.deepEqValueTri as ((...a: unknown[]) => unknown) | undefined;
  if (deepEq !== undefined) {
    const guarded = (c: unknown, ...a: unknown[]) => {
      if (a.some((v) => mentionsTower(v))) throw new Error("tripwire: deepEqValueTri over a numeric-tower record");
      return deepEq(c, ...a);
    };
    for (const key of Object.keys(natives)) if (natives[key] === deepEq) natives[key] = guarded;
  }
  const data: Record<string, unknown> = {};
  fn.params.forEach((p, i) => { data[p.name] = args[i]; });
  return withEngineDispatchEvaluationSnapshot(() => evaluate(fn.body, data, { ...ctx, nativesCtx: natives } as typeof ctx));
}

describe("door answers do not depend on the context-dependent reads (review finding 6)", () => {
  it("every door answers the same with the reads and seams stubbed to throw", () => {
    const paris = { $tag: "Paris" };
    const lyon = { $tag: "Lyon" };
    const rail = rel("rail", 3, [[paris, lyon, 120], [lyon, { $tag: "Nice" }, 270]]);
    const grandRule = { name: "grand", params: ["a", "c"], body: ECall("and", [ECall("parentOf", [EVar("a"), EVar("b")]), ECall("parentOf", [EVar("b"), EVar("c")])]) };
    const notGrand = ECall("and", [ECall("parentOf", [EVar("x"), EVar("y")]), ECall("not", [ECall("grand", [EVar("x"), ELit("eleonora")])])]);
    const defs = [{ name: "value", fieldOrder: ["v"], instances: [{ v: 3 }, { v: 9 }] }];
    const corpus: [string, unknown[], boolean][] = [
      ["engine:solverPublicSolve", [ECall("eq", [EVar("x"), ELit(5)])], true],
      ["engine:solverPublicSolve", [ECall("eq", [ECall("add", [ECall("mul", [ELit(2), EVar("x")]), ELit(5)]), ELit(6)])], true],
      ["engine:solverPublicSolve", [ECall("and", [ECall("gt", [EVar("x"), ELit(1)]), ECall("neq", [EVar("x"), ELit(2)])])], true],
      ["engine:solverPublicSolve", [ECall("or", [ECall("eq", [EVar("x"), ELit(paris)]), ECall("eq", [EVar("x"), ELit(lyon)])])], true],
      ["engine:solverPublicSolve", [ECall("eq", [ECall("mul", [EVar("x"), EVar("x")]), ELit(4)])], true],
      ["engine:solverPublicSolveAll", [ECall("or", [ECall("eq", [EVar("x"), ELit(5)]), ECall("eq", [EVar("x"), ELit(7)])])], false],
      ["engine:solverPublicSolveRel", [GRANDPARENT, factsOf([PARENT])], false],
      ["engine:solverPublicSolveRelAll", [GRANDPARENT, factsOf([PARENT])], false],
      ["engine:solverPublicSolveRelAll", [notGrand, factsOf([PARENT], [grandRule])], false],
      ["engine:solverPublicSolveRelAll", [ECall("rail", [ELit(paris), EVar("to"), EVar("m")]), factsOf([rail])], false],
      ["engine:solverPublicQueryRel", [ECall("value", [EVar("x")]), defs, []], false],
      ["engine:solverPublicQueryRelOne", [ECall("value", [EVar("x")]), defs, []], false],
      ["engine:solverPublicSampleSet", [1, enumSet(3, 4, 5)], false],
      ["engine:solverPublicMinOfSet", [{ $tag: "SeIntersect", branches: [interval(bound(3, true), Nothing), interval(Nothing, bound(9, false))] }], false],
      ["engine:solverPublicMaxOfSet", [enumSet(3, 1, 2)], false],
      ["engine:solverPublicEnumerableSet", ["Char", { $tag: "SeUnion", branches: [interval(bound("a", true), bound("c", true)), enumSet("x")] }], false],
      ["engine:solverPublicEnumerableSolveAll", ["Char", ECall("and", [ECall("gte", [EVar("c"), ELit("a")]), ECall("lte", [EVar("c"), ELit("e")])])], false],
      ["engine:solverPublicEnumerableInhabit", [{ tag: "InhRefined", base: "Char", set: interval(bound("a", true), bound("b", true)) }], false],
      ["engine:solverPublicEnumerableMinOfSet", ["String", interval(bound("b", true), bound("d", true))], false],
      ["engine:solverPublicEnumerableMaxOfSet", ["String", interval(bound("b", true), bound("d", true))], false],
      ["engine:solverPublicEnumerableSampleSet", ["String", 1, enumSet("q", "r")], false],
      ["engine:solverPublicSolveSymbolic", [[], ECall("eq", [ECall("$effect:HasStateIO:getInstance", [ELit("counter")]), ELit(42)])], false],
    ];
    for (const [door, args, decider] of corpus) {
      const shipped = decider ? dispatchEngineBodyWithDeciderCtx(door, args) : dispatchEngineBody(door, args);
      let tripped: unknown;
      try {
        tripped = tripwiredDispatch(door, args, decider);
      } catch (error) {
        tripped = { threw: String(error) };
      }
      expect({ door, args, answer: tripped }).toEqual({ door, args, answer: shipped });
    }
  }, 300_000);
});
