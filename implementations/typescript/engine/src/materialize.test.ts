// expr-substrate Phase 16 — conformance tests for `queryRel` / `queryRelOne` /
// `queryFnRel` / `queryFnRelOne` (queries = solve ∘ materialize, engine-side).
// brief: `workstreams/expr-substrate/briefs/phase-16-queries-materialize.md`.
//
// The MATERIALIZE half turns flat merged-envelope entity-instance rows (the
// shape `state:listInstancesByName` returns at runtime/src/handlers/state.ts
// :876 — `{ id, accountId, ...data, createdAt, updatedAt }`, top-level $tag
// stripped, nested-field variants kept) into the P13 facts env; the four query
// entries thinly compose the SHIPPED P13/P15 solve+findall families. solve /
// solve-affine / refine / rel-solve / enumerate are PINNED surfaces — UNTOUCHED.
//
// Decision 6: there is NO live-DB integration test (no runtime DB-test infra
// exists in this repo). The leaf is production-exercised already; the
// composition is demonstrated here over HANDLER-SHAPED fixture rows + documented
// (the live caller one-liner sits in materialize.fenel's header). The production
// `state:queryRel` orchestration fn rides the engine→SYSTEM_MODULES exposure
// decision (engine ∉ SYSTEM_MODULES today ⇒ a cross-module body would dangle).

import { describe, it, expect } from "vitest";
import {
  dispatchEngineBody,
  dispatchedQueryRel,
  dispatchedQueryRelOne,
  dispatchedQueryFnRel,
  dispatchedQueryFnRelOne,
} from "./engine-bodies-dispatch";
import { isSubset } from "./set-algebra";
import { getSystemEvaluateContext } from "./system-registry";
import type { SetExpr } from "./types";

// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });

// FenelClosure the way the `fn` op builds it (json-logic.ts:1729).
const closure = (
  params: string[],
  body: unknown,
  scope: Record<string, unknown> = {},
) => ({ __fenelFn: true as const, params, body, closure: scope });

type MaybeV = { $tag: string; _0?: unknown };

// A relDef MARKER (the caller-facing input — the `$`-key barrier discipline).
const relDef = (name: string, fieldOrder: string[], instances: unknown[]) => ({
  name,
  fieldOrder,
  instances,
});

// Handler-shaped merged-envelope fields — `state:listInstancesByName` spreads
// the data fields flat alongside id/accountId/createdAt/updatedAt (state.ts:876).
const envelope = { accountId: "acc-1", createdAt: "2026-01-01", updatedAt: "2026-01-02" };

// ---------------------------------------------------------------------------
// The headline — "bought book-b ∧ joined < 3 days" over Customer × Purchase,
// materialized from handler-shaped instance rows, via queryRel AND queryFnRel
// (findall semantics — ALL matching bindings).
// ---------------------------------------------------------------------------

describe("queries = solve ∘ materialize — the headline query", () => {
  // cust-1 (day1, book-b) ✓ · cust-2 (day5, book-b) ✗ joined too late ·
  // cust-3 (day2, book-b) ✓ · cust-4 (day1, book-a) ✗ wrong book.
  const customers = [
    { id: "cust-1", joinedDay: 1, ...envelope },
    { id: "cust-2", joinedDay: 5, ...envelope },
    { id: "cust-3", joinedDay: 2, ...envelope },
    { id: "cust-4", joinedDay: 1, ...envelope },
  ];
  const purchases = [
    { id: "p-1", customerId: "cust-1", book: "book-b", ...envelope },
    { id: "p-2", customerId: "cust-2", book: "book-b", ...envelope },
    { id: "p-3", customerId: "cust-3", book: "book-b", ...envelope },
    { id: "p-4", customerId: "cust-4", book: "book-a", ...envelope },
  ];
  const relDefs = [
    relDef("customer", ["id", "joinedDay"], customers),
    relDef("bought", ["customerId", "book"], purchases),
  ];
  // and (customer c d) (bought c "book-b") (lt d 3) — c grounds on the customer
  // id, d on joinedDay; `bought c "book-b"` is a constant-select join on the id
  // column, `lt d 3` a P12 affine residual (proven-rows).
  const queryExpr = ECall("and", [
    ECall("customer", [EVar("c"), EVar("d")]),
    ECall("bought", [EVar("c"), ELit("book-b")]),
    ECall("lt", [EVar("d"), ELit(3)]),
  ]);
  const expected = [
    [{ name: "c", value: "cust-1" }, { name: "d", value: 1 }],
    [{ name: "c", value: "cust-3" }, { name: "d", value: 2 }],
  ];

  it("queryRel (Expr-direct): ⇒ ALL matching bindings (findall)", () => {
    const r = dispatchedQueryRel(queryExpr, relDefs, []) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual(expected);
  });

  it("queries INHERIT `or` (decide-substrate P4T Step C): bought book-b OR joined day-5", () => {
    // and (customer c d) (or (bought c "book-b") (eq d 5)) — the rel-bearing or
    // DNF-distributes; branch 1 = the book-b buyers, branch 2 = the day-5
    // joiners; the union dedupes cust-2 (in both... actually cust-2 bought
    // book-b AND joined day 5 — one row either way).
    const r = dispatchedQueryRel(
      ECall("and", [
        ECall("customer", [EVar("c"), EVar("d")]),
        ECall("or", [
          ECall("bought", [EVar("c"), ELit("book-b")]),
          ECall("eq", [EVar("d"), ELit(5)]),
        ]),
      ]),
      relDefs,
      [],
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      [{ name: "c", value: "cust-1" }, { name: "d", value: 1 }],
      [{ name: "c", value: "cust-2" }, { name: "d", value: 5 }],
      [{ name: "c", value: "cust-3" }, { name: "d", value: 2 }],
    ]);
  });

  it("queries INHERIT ground `not` (P4T Step C): customers who did NOT buy book-b", () => {
    const r = dispatchedQueryRel(
      ECall("and", [
        ECall("customer", [EVar("c"), EVar("d")]),
        ECall("not", [ECall("bought", [EVar("c"), ELit("book-b")])]),
      ]),
      relDefs,
      [],
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([[{ name: "c", value: "cust-4" }, { name: "d", value: 1 }]]);
  });

  it("queryFnRel (lambda form): \\c d -> and ... ⇒ the same findall set (param order)", () => {
    const r = dispatchedQueryFnRel(
      closure(["c", "d"], {
        and: [
          { call: ["customer", { var: "c" }, { var: "d" }] },
          { call: ["bought", { var: "c" }, "book-b"] },
          { call: ["lt", { var: "d" }, 3] },
        ],
      }),
      relDefs,
      [],
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual(expected);
  });

  it("queryRelOne (first-witness): ⇒ only the first binding", () => {
    const r = dispatchedQueryRelOne(queryExpr, relDefs, []) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "c", value: "cust-1" }, { name: "d", value: 1 }]);
  });

  it("queryFnRelOne (first-witness, lambda form): ⇒ only the first binding", () => {
    const r = dispatchedQueryFnRelOne(
      closure(["c", "d"], {
        and: [
          { call: ["customer", { var: "c" }, { var: "d" }] },
          { call: ["bought", { var: "c" }, "book-b"] },
          { call: ["lt", { var: "d" }, 3] },
        ],
      }),
      relDefs,
      [],
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "c", value: "cust-1" }, { name: "d", value: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// The MATERIALIZE builders — projection drops partial rows; envelope fields are
// ordinary columns.
// ---------------------------------------------------------------------------

describe("materialize — projection + the total-row policy", () => {
  it("projectInstanceRow projects in fieldOrder ⇒ Just row (envelope fields are columns)", () => {
    const r = dispatchEngineBody("engine:projectInstanceRow", [
      ["id", "joinedDay", "accountId"],
      { id: "x", joinedDay: 3, accountId: "acc-1", createdAt: "c", updatedAt: "u" },
    ]) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual(["x", 3, "acc-1"]);
  });

  it("projectInstanceRow drops a PARTIAL instance (missing a fieldOrder column) ⇒ Nothing", () => {
    const r = dispatchEngineBody("engine:projectInstanceRow", [
      ["id", "joinedDay"],
      { id: "x" }, // no joinedDay
    ]) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  it("relationFromInstances drops partial rows (pin the dropped count): 3 instances, 1 partial ⇒ 2 rows", () => {
    const reln = dispatchEngineBody("engine:relationFromInstances", [
      "customer",
      ["id", "joinedDay"],
      [{ id: "a", joinedDay: 1 }, { id: "b" }, { id: "c", joinedDay: 2 }],
    ]) as { name: string; arity: number; rows: unknown[][] };
    expect(reln.name).toBe("customer");
    expect(reln.arity).toBe(2);
    expect(reln.rows).toEqual([["a", 1], ["c", 2]]); // the partial `b` is gone
  });

  it("envelope-field (`id`) JOIN: and (members x) (active x) joins on the instance id ⇒ x=m-2", () => {
    // `id` projects + joins like any data column (decision 2 — no special-casing).
    const rd = [
      relDef("members", ["id"], [{ id: "m-1" }, { id: "m-2" }]),
      relDef("active", ["memberId"], [{ memberId: "m-2" }]),
    ];
    const r = dispatchedQueryRelOne(
      ECall("and", [ECall("members", [EVar("x")]), ECall("active", [EVar("x")])]),
      rd,
      [],
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "x", value: "m-2" }]);
  });
});

// ---------------------------------------------------------------------------
// The inherited `Just [] ≠ Nothing` split (the P15 semantic distinction).
// ---------------------------------------------------------------------------

describe("queries — safe-but-empty ⇒ Just [] vs unsafe ⇒ Nothing (inherited P15 split)", () => {
  const cd = [relDef("customer", ["id", "joinedDay"], [{ id: "c1", joinedDay: 5 }])];

  it("safe but no satisfying row ⇒ Just [] (decidable-empty)", () => {
    const r = dispatchedQueryRel(
      ECall("and", [ECall("customer", [EVar("c"), EVar("d")]), ECall("lt", [EVar("d"), ELit(0)])]),
      cd,
      [],
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([]);
  });

  it("unsafe (a var ungrounded by any relation atom) ⇒ Nothing", () => {
    const r = dispatchedQueryRel(ECall("eq", [EVar("c"), EVar("d")]), cd, []) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });

  it("queryRelOne on safe-but-empty ⇒ Nothing (first-witness folds empty back)", () => {
    const r = dispatchedQueryRelOne(
      ECall("and", [ECall("customer", [EVar("c"), EVar("d")]), ECall("lt", [EVar("d"), ELit(0)])]),
      cd,
      [],
    ) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// Rules threading — a grandparent rule over instance-materialized parentOf.
// ---------------------------------------------------------------------------

describe("queries — rules thread through factsFromDefs", () => {
  it("grandparentOf(a,c) :- parentOf(a,b), parentOf(b,c) over materialized parentOf ⇒ x=anna", () => {
    const parentInsts = [
      { parent: "anna", child: "bob", ...envelope },
      { parent: "bob", child: "eleonora", ...envelope },
      { parent: "carl", child: "dan", ...envelope },
    ];
    const prd = [relDef("parentOf", ["parent", "child"], parentInsts)];
    // body PRE-REIFIED to Expr (the caller threads it — the P13 rule).
    const grandparentRule = {
      name: "grandparentOf",
      params: ["a", "c"],
      body: ECall("and", [
        ECall("parentOf", [EVar("a"), EVar("b")]),
        ECall("parentOf", [EVar("b"), EVar("c")]),
      ]),
    };
    const r = dispatchedQueryRelOne(
      ECall("grandparentOf", [EVar("x"), ELit("eleonora")]),
      prd,
      [grandparentRule],
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "x", value: "anna" }]);
  });
});

// ---------------------------------------------------------------------------
// Variant cells now MATCH (solver-extension Phase 5 — the deep-eq widening).
// The P16/Phase-4 "ride but don't match" shallow-eq fence is LIFTED: matchOne /
// rowEq / closedEq bottom out in `deepEqValue` (structural), so a constant-
// SELECT or a join against an ADT-valued cell decides structurally. Projection
// is byte-unchanged (materialize is untouched) — the variant still rides
// verbatim; what changed is the MATCH.
// ---------------------------------------------------------------------------

describe("queries — variant cells RIDE and now MATCH (the Phase-5 deep-eq widening)", () => {
  const recRd = [
    relDef("rec", ["id", "status"], [{ id: "r-1", status: { $tag: "Just", _0: "active" } }]),
  ];

  it("a variant-valued cell PROJECTS into the row verbatim (it rides — projection unchanged)", () => {
    const r = dispatchedQueryRelOne(ECall("rec", [EVar("x"), EVar("s")]), recRd, []) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      { name: "x", value: "r-1" },
      { name: "s", value: { $tag: "Just", _0: "active" } }, // the variant, verbatim
    ]);
  });

  it("a constant-SELECT against a structurally-equal variant cell now MATCHES ⇒ Just (Phase-5 deep-eq)", () => {
    // ELit of a STRUCTURALLY-equal variant. Pre-Phase-5 this was Nothing (std
    // `eq` is reference-shallow on records); deepEqValue recurses $tag + fields
    // ⇒ the row matches and binds x.
    const r = dispatchedQueryRelOne(
      ECall("rec", [EVar("x"), ELit({ $tag: "Just", _0: "active" })]),
      recRd,
      [],
    ) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "x", value: "r-1" }]);
  });

  it("a constant-SELECT against a DIFFERENT variant cell still ⇒ Nothing (honest negative)", () => {
    const r = dispatchedQueryRelOne(
      ECall("rec", [EVar("x"), ELit({ $tag: "Just", _0: "inactive" })]),
      recRd,
      [],
    ) as MaybeV;
    expect(r.$tag).toBe("Nothing");
  });
});

// ---------------------------------------------------------------------------
// Query subsumption = subset-decide over the query-plan SetExpr (decision 5).
// The witness set IS the query plan: a tighter query ⊆ a looser one. ZERO new
// fns — `isSubset` (set-algebra) is already-shipped algebra; this demo makes
// the roadmap row's "subset-decide = query subsumption" claim load-bearing.
// (The comparison-predicate → interval extraction is the refine path; here the
// query plan is the interval/enum form the algebra reasons over directly.)
// ---------------------------------------------------------------------------

describe("queries — subsumption is subset-decide over the query plan", () => {
  const ctx = getSystemEvaluateContext();
  const J = (v: unknown) => ({ $tag: "Just", _0: v });
  const N = { $tag: "Nothing" };
  // `spent ≥ 100` (the query plan [100, ∞)) and `spent ≥ 50` ([50, ∞)).
  const spent100: SetExpr = { $tag: "SeInterval", interval: { lo: J({ value: 100, inclusive: true }), hi: N } } as SetExpr;
  const spent50: SetExpr = { $tag: "SeInterval", interval: { lo: J({ value: 50, inclusive: true }), hi: N } } as SetExpr;
  // an opaque predicate the algebra can't reduce.
  const opaque: SetExpr = { $tag: "SeWhere", pred: { call: ["readFromDb", "x"] } } as SetExpr;

  it("a tighter query subsumes into a looser one: spent≥100 ⊆ spent≥50 ⇒ Just true", () => {
    expect(isSubset(spent100, spent50, ctx)).toEqual({ $tag: "Just", _0: true });
  });

  it("the reverse does NOT subsume: spent≥50 ⊆ spent≥100 ⇒ Just false", () => {
    expect(isSubset(spent50, spent100, ctx)).toEqual({ $tag: "Just", _0: false });
  });

  it("against an irreducible predicate ⇒ Nothing (undecidable — honest)", () => {
    expect(isSubset(spent100, opaque, ctx)).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// reify fences inherited — a native / bodyless fn via the Fn-taking entries.
// ---------------------------------------------------------------------------

describe("queries — reify Err ⇒ Nothing (inherited)", () => {
  it("a native fn (std:add) ⇒ Nothing via queryFnRel", () => {
    expect(
      (dispatchedQueryFnRel("std:add", [relDef("r", ["id"], [{ id: "x" }])], []) as MaybeV).$tag,
    ).toBe("Nothing");
  });
});
