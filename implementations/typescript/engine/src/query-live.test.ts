// ---------------------------------------------------------------------------
// query-live.test.ts — solver-extension Phase 4. THE LIVE queryRel EXPOSURE.
//
// expr-substrate P16 shipped `engine:queryRel` (= solve ∘ materialize, all
// Fenel-bodied) but left "decision 6" explicit: a production `query:queryEntities`
// DANGLES — engine ∉ the production registry, and running the engine query
// bodies there breaks on the `std:contains` vs `set:contains` codeName shadow
// (the Step-0 finding: engine bodies call bare `contains` = the string
// predicate; prod resolves bare `contains` → the set-membership decider,
// last-write-wins). This phase wires the dangle:
//
//   • `query:rel` / `query:relOne` — a ffi BRIDGE (the prover/ffi host-re-entry
//     category) that routes `engine:queryRel` / `engine:queryRelOne` through the
//     engine's CURATED dispatch harness (`dispatchEngineBody`), which is
//     collision-free by construction — so the query is IMMUNE to the prod
//     `contains` shadow. The ONLY new TS (reuses the shipped dispatchedQueryRel).
//   • `query:queryEntities` / `query:queryEntitiesOne` — the Fenel ORCHESTRATION
//     bodies (requires HasStateIO): fetch each relSpec's rows via the existing
//     `state:listInstancesByName` leaf, assemble the relDef markers, call the
//     bridge. ZERO new IO leaf. They live in the `query` module (NOT the
//     pure-leaf `state` module) the way every consumer composes state leaves.
//
// This oracle is DB-LESS (engine stays DB-less — the db-less-invariant): it
// stubs `state:listInstancesByName` with fixture rows in the EXACT merged-
// envelope shape the runtime handler returns (`{ id, accountId, ...data,
// createdAt, updatedAt }`, state.ts:947). The LIVE-DB run (seed real
// entity_instances → fetch the real merged rows → bridge → the two early-joining
// book-b buyers bound by their real UUIDs) is recorded in the roadmap completion
// notes (Windows-safe direct-SQL proof; not committed — keeps the engine package
// DB-less + CI green without a DB).
//
// The shipped solve / rel-solve / materialize / enumerate paths stay BYTE-
// untouched (verified by their own oracles in the gate).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import type { FenelModule } from "./types";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import { stdModule } from "./modules/std";
import { queryModule } from "./modules/query";
import { stateModule } from "./modules/state";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { dispatchedQueryRel, dispatchedQueryRelOne } from "./engine-bodies-dispatch";

// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ELit = (value: unknown) => ({ $tag: "ELit", value });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });

type MaybeV = { $tag: string; _0?: unknown };

// Merged-envelope fixture rows — EXACTLY what state:listInstancesByName returns
// (state.ts:947): the data fields spread flat alongside id / accountId /
// createdAt / updatedAt. Envelope fields are ORDINARY columns.
const env = { accountId: "acc-1", createdAt: "2026-01-01", updatedAt: "2026-01-02" };
const customers = [
  { id: "cust-1", joinedDay: 1, ...env },
  { id: "cust-2", joinedDay: 5, ...env },
  { id: "cust-3", joinedDay: 2, ...env },
];
const purchases = [
  { id: "p-1", customerId: "cust-1", book: "book-b", ...env },
  { id: "p-2", customerId: "cust-2", book: "book-b", ...env },
  { id: "p-3", customerId: "cust-3", book: "book-b", ...env },
];
const FIX: Record<string, unknown[]> = { customer: customers, bought: purchases };

// A relSpec — the caller-facing input the state body fetches + assembles.
const relSpec = (name: string, fieldOrder: string[], typeName: string) => ({ name, fieldOrder, typeName });
const relDef = (name: string, fieldOrder: string[], instances: unknown[]) => ({ name, fieldOrder, instances });

// `customer c d ∧ bought c "book-b" ∧ lt d 3` — c grounds on customer.id, the
// `bought c "book-b"` is a constant-select id-join, `lt d 3` an affine residual.
const headlineExpr = ECall("and", [
  ECall("customer", [EVar("c"), EVar("d")]),
  ECall("bought", [EVar("c"), ELit("book-b")]),
  ECall("lt", [EVar("d"), ELit(3)]),
]);
const expectedFindall = [
  [{ name: "c", value: "cust-1" }, { name: "d", value: 1 }],
  [{ name: "c", value: "cust-3" }, { name: "d", value: 2 }],
];

// Build a registry whose state IO leaf is stubbed with fixture rows. Including
// decidableMembershipModule reproduces the PROD `contains` shadow — the body
// MUST still resolve correctly (the bridge routes to the curated harness).
function stubbedRegistry(withShadow: boolean) {
  const stub: FenelModule = {
    name: "state-stub",
    label: "state stub",
    nativeImplsCtx: {
      "state:listInstancesByName": (_ctx: unknown, typeName: unknown) => FIX[String(typeName)] ?? [],
    } as Record<string, (ctx: unknown, ...a: unknown[]) => unknown>,
  };
  const mods: FenelModule[] = [stdModule, queryModule, stateModule, stub];
  if (withShadow) mods.splice(1, 0, decidableMembershipModule);
  return createRegistry(mods as never);
}

const runBody = (reg: ReturnType<typeof createRegistry>, fnId: string, expr: unknown, relSpecs: unknown[], rules: unknown[]) =>
  evaluate({ call: [fnId, { var: "qe" }, { var: "rs" }, { var: "ru" }] }, { qe: expr, rs: relSpecs, ru: rules }, reg.evaluateContext()) as MaybeV;

// ---------------------------------------------------------------------------
describe("query:rel / query:relOne bridge — routes engine:queryRel through the curated harness", () => {
  const relDefs = [relDef("customer", ["id", "joinedDay"], customers), relDef("bought", ["customerId", "book"], purchases)];

  test("dispatchedQueryRel ⇒ ALL matching bindings (findall)", () => {
    const r = dispatchedQueryRel(headlineExpr, relDefs, []) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual(expectedFindall);
  });

  test("dispatchedQueryRelOne ⇒ the first satisfying binding", () => {
    const r = dispatchedQueryRelOne(headlineExpr, relDefs, []) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "c", value: "cust-1" }, { name: "d", value: 1 }]);
  });

  test("the bridge fns resolve in a registry (query:rel / query:relOne + codeNames)", () => {
    const reg = createRegistry([stdModule, queryModule] as never);
    expect(reg.listFunctions().find((f) => f.id === "query:rel")).toBeDefined();
    expect(reg.listFunctions().find((f) => f.id === "query:relOne")).toBeDefined();
    expect(reg.getFunctionByCodeName?.("runRelQuery")?.id).toBe("query:rel");
    expect(reg.getFunctionByCodeName?.("runRelQueryOne")?.id).toBe("query:relOne");
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe("query:queryEntities — the live orchestration (fetch → assemble → bridge)", () => {
  const reg = stubbedRegistry(false);
  const relSpecs = [relSpec("customer", ["id", "joinedDay"], "customer"), relSpec("bought", ["customerId", "book"], "bought")];

  test("the orchestration bodies register (queryRel / queryRelOne / materializeRelSpecs)", () => {
    expect(reg.listFunctions().find((f) => f.id === "query:queryEntities")).toBeDefined();
    expect(reg.listFunctions().find((f) => f.id === "query:queryEntitiesOne")).toBeDefined();
    expect(reg.listFunctions().find((f) => f.id === "query:materializeRelSpecs")).toBeDefined();
  });

  test("queryRel (findall): fetches each relSpec + ⇒ ALL bindings", () => {
    const r = runBody(reg, "query:queryEntities", headlineExpr, relSpecs, []);
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual(expectedFindall);
  });

  test("queryRelOne (first witness): ⇒ the first binding", () => {
    const r = runBody(reg, "query:queryEntitiesOne", headlineExpr, relSpecs, []);
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "c", value: "cust-1" }, { name: "d", value: 1 }]);
  });

  test("safe-but-empty: a predicate no row satisfies ⇒ Just [] (the P15 split)", () => {
    const noMatch = ECall("and", [ECall("customer", [EVar("c"), EVar("d")]), ECall("bought", [EVar("c"), ELit("book-z")])]);
    const r = runBody(reg, "query:queryEntities", noMatch, relSpecs, []);
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([]);
  });

  test("the fence: an out-of-fragment predicate ⇒ Nothing (the P15 split)", () => {
    // `eq c d` — two free unknowns compared, no relation grounds them (the
    // materialize.test.ts unsafe case). queryRel folds this to Nothing.
    const r = runBody(reg, "query:queryEntities", ECall("eq", [EVar("c"), EVar("d")]), relSpecs, []);
    expect(r.$tag).toBe("Nothing");
  });

  test("id-join is first-class: join on a customer's envelope id column", () => {
    // members(id) ⋈ active(memberId) on the id — `active m` selects the active id,
    // `member m` grounds m on the member's envelope id.
    const members = [{ id: "m-1", ...env }, { id: "m-2", ...env }];
    const active = [{ id: "a-1", memberId: "m-2", ...env }];
    const stub: FenelModule = {
      name: "state-stub-join",
      label: "state stub (join)",
      nativeImplsCtx: { "state:listInstancesByName": (_c: unknown, t: unknown) => (t === "member" ? members : active) } as Record<string, (c: unknown, ...a: unknown[]) => unknown>,
    };
    const reg2 = createRegistry([stdModule, queryModule, stateModule, stub] as never);
    const specs = [relSpec("member", ["id"], "member"), relSpec("active", ["memberId"], "active")];
    const expr = ECall("and", [ECall("member", [EVar("m")]), ECall("active", [EVar("m")])]);
    const r = runBody(reg2, "query:queryEntitiesOne", expr, specs, []);
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "m", value: "m-2" }]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// solver-extension Phase 5 — DEEP VARIANT-CELL MATCHING. The matching now
// bottoms out in `deepEqValue` (structural) instead of reference-shallow `eq`,
// so a query over an ADT-valued field MATCHES + JOINS. Scalars stay byte-
// identical (the regression guard); a different tag / a distinct closure cell
// stays an honest no-match.
// ---------------------------------------------------------------------------
describe("deep variant-cell matching (Phase 5)", () => {
  const Active = { $tag: "Active" };
  const Pending = { $tag: "Pending" };

  test("constant-SELECT on a $tag cell MATCHES + binds (status = Active)", () => {
    const rd = [relDef("conv", ["id", "status"], [
      { id: "c-1", status: Active, ...env },
      { id: "c-2", status: Pending, ...env },
    ])];
    // `conv x Active` — select the rows whose status cell is structurally {$tag:"Active"}.
    const r = dispatchedQueryRel(ECall("conv", [EVar("x"), ELit(Active)]), rd, []) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([[{ name: "x", value: "c-1" }]]);
  });

  test("a DIFFERENT tag ⇒ honest no-match (Just [])", () => {
    const rd = [relDef("conv", ["id", "status"], [{ id: "c-1", status: Active, ...env }])];
    const r = dispatchedQueryRel(ECall("conv", [EVar("x"), ELit(Pending)]), rd, []) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([]);
  });

  test("a JOIN binding a variable to a variant cell across two relations", () => {
    // acct(id, status) ⋈ tier(status, label) ON the variant status cell.
    const accts = [
      { id: "a-1", status: Active, ...env },
      { id: "a-2", status: Pending, ...env },
    ];
    const tiers = [
      { status: Active, label: "gold", ...env },
      { status: Pending, label: "bronze", ...env },
    ];
    const rd = [relDef("acct", ["id", "status"], accts), relDef("tier", ["status", "label"], tiers)];
    // `acct a s ∧ tier s t` — s is bound to a variant cell by acct, then the
    // join-consistency check (matchOne's bound-var arm) deepEqValue-matches it
    // against tier's status cell.
    const expr = ECall("and", [ECall("acct", [EVar("a"), EVar("s")]), ECall("tier", [EVar("s"), EVar("t")])]);
    const r = dispatchedQueryRel(expr, rd, []) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([
      [{ name: "a", value: "a-1" }, { name: "s", value: Active }, { name: "t", value: "gold" }],
      [{ name: "a", value: "a-2" }, { name: "s", value: Pending }, { name: "t", value: "bronze" }],
    ]);
  });

  test("a NESTED variant cell matches (Just (Active))", () => {
    const nested = { $tag: "Just", _0: Active };
    const rd = [relDef("box", ["id", "wrapped"], [
      { id: "b-1", wrapped: nested, ...env },
      { id: "b-2", wrapped: { $tag: "Just", _0: Pending }, ...env },
    ])];
    const r = dispatchedQueryRel(ECall("box", [EVar("x"), ELit(nested)]), rd, []) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([[{ name: "x", value: "b-1" }]]);
  });

  test("a variant cell rides as a binding when projected by an EVar (projection unchanged)", () => {
    const rd = [relDef("conv", ["id", "status"], [{ id: "c-1", status: Active, ...env }])];
    const r = dispatchedQueryRelOne(ECall("conv", [EVar("x"), EVar("s")]), rd, []) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([{ name: "x", value: "c-1" }, { name: "s", value: Active }]);
  });

  test("scalars stay byte-identical (regression guard) — a string-cell select", () => {
    const rd = [relDef("conv", ["id", "name"], [
      { id: "c-1", name: "alice", ...env },
      { id: "c-2", name: "bob", ...env },
    ])];
    const r = dispatchedQueryRel(ECall("conv", [EVar("x"), ELit("bob")]), rd, []) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([[{ name: "x", value: "c-2" }]]);
  });

  test("a distinct closure-valued cell ⇒ honest no-match (no structural eq for functions)", () => {
    const rd = [relDef("rec", ["id", "fn"], [{ id: "r-1", fn: () => 1, ...env }])];
    // A DIFFERENT closure literal — deepEqValue bottoms out in reference `eq` ⇒
    // false (distinct refs) ⇒ no match. NOT a spurious vacuous-true, NOT a crash.
    const r = dispatchedQueryRel(ECall("rec", [EVar("x"), ELit(() => 1)]), rd, []) as MaybeV;
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("shadow-immunity — the whole point of the bridge", () => {
  test("query:queryEntities is correct EVEN when the caller registry resolves bare contains → set:contains", () => {
    const reg = stubbedRegistry(true); // decidableMembershipModule present
    expect(reg.getFunctionByCodeName?.("contains")?.id).toBe("set:contains"); // the prod shadow IS present
    const relSpecs = [relSpec("customer", ["id", "joinedDay"], "customer"), relSpec("bought", ["customerId", "book"], "bought")];
    const r = runBody(reg, "query:queryEntities", headlineExpr, relSpecs, []);
    expect(r.$tag).toBe("Just");
    expect(r._0).toEqual(expectedFindall); // routed to the curated harness — unbroken
  }, 60_000);
});
