// expr-substrate Phase 3a — conformance tests for `engine:reify`, runtime
// introspection of a function value into `{ body: Expr, captures }` (brief:
// `workstreams/expr-substrate/briefs/phase-3a-reify.md`).
//
// reify LIFTS VIA THE PROVEN ADAPTER (decision 1) — the body equality checks
// below assert `reify(fn).body === jsonLogicToExpr(fn's raw body)`, tying the
// lift to the 4a adapter rather than re-deriving an expected tree. The
// reify-SPECIFIC logic under test is the captures projection (decision 6):
// a FenelClosure carries its WHOLE lexical scope, and reify filters it to the
// body's free vars via `collectFreeVars` + `reifyFilterCaptures`.
//
// Shapes (decision 5): (a) registry fn (by exact canonical id or typed `{$ref}`) — Ok,
// captures EMPTY; (b) FenelClosure — Ok, captures = free-var-filtered scope;
// native / bodyless / partial / non-reifiable ⇒ Err Unsupported (the Result-sig
// amendment, decision 3 — reusing the CompileError ctor, no new entity).

import { describe, it, expect } from "vitest";
import { dispatchedReify, dispatchedJsonLogicToExpr } from "./engine-bodies-dispatch";
import { engineModule } from "./modules/engine";

// --- tiny Expr builders (plain $tag-tagged objects) ----------------------
const EVar = (name: string) => ({ $tag: "EVar", name });
const ECall = (fnId: string, args: unknown[]) => ({ $tag: "ECall", fnId, args });

// Build a FenelClosure value the way the `fn` op does (json-logic.ts:1729):
// the whole data context at capture time rides in `closure`.
const closure = (
  params: string[],
  body: unknown,
  scope: Record<string, unknown> = {},
) => ({ __fenelFn: true as const, params, body, closure: scope });

type ReifyResult = {
  $tag: string;
  _0?: { body?: unknown; captures?: unknown; reason?: string };
};

const okBody = (r: unknown) => (r as ReifyResult)._0!.body;
const okCaptures = (r: unknown) => (r as ReifyResult)._0!.captures;
const liftBody = (raw: unknown) =>
  (dispatchedJsonLogicToExpr(raw) as { $tag: string; _0: unknown })._0;

describe("reify — FenelClosure (body lifted via the adapter, captures free-var-filtered)", () => {
  it("closes captured source Name aliases while preserving locals and literal payloads", () => {
    const fn = {
      ...closure(["value"], { call: ["same", { var: "value" }] }),
      lexicalImports: [{ names: { same: "SourceOrigin:same", value: "Wrong:value" }, aliases: {} }],
    };
    const reified = dispatchedReify(fn) as ReifyResult;
    expect(reified.$tag).toBe("Ok");
    expect(okBody(reified)).toEqual(ECall("SourceOrigin:same", [EVar("value")]));
    const nested = dispatchedReify({ ...fn, body: { fn: ["same", { call: [{ var: "same" }, { var: "value" }] }] } });
    expect(okBody(nested)).toEqual(liftBody({ fn: ["same", { call: [{ var: "same" }, { var: "value" }] }] }));
    expect(okCaptures(reified)).toEqual([]);
  });
  it("\\x -> x + y with {y, z} in scope ⇒ body ECall add, captures = {y} only (z filtered)", () => {
    const raw = { call: ["add", { var: "x" }, { var: "y" }] };
    const r = dispatchedReify(closure(["x"], raw, { y: 5, z: 99 }));
    expect((r as ReifyResult).$tag).toBe("Ok");
    expect(okBody(r)).toEqual(ECall("add", [EVar("x"), EVar("y")]));
    // free = {y}; z is in the lexical scope but NOT referenced ⇒ dropped.
    expect(okCaptures(r)).toEqual([{ name: "y", value: 5 }]);
  });

  it("\\x -> x with a non-free var in scope ⇒ body EVar x, captures empty", () => {
    const raw = { var: "x" };
    const r = dispatchedReify(closure(["x"], raw, { w: 1 }));
    expect((r as ReifyResult).$tag).toBe("Ok");
    expect(okBody(r)).toEqual(EVar("x"));
    expect(okCaptures(r)).toEqual([]);
  });

  it("nested lambda \\x -> \\z -> x + z + y captures y (free under both binders), not x/z", () => {
    const raw = {
      fn: [
        ["z"],
        {
          call: [
            "add",
            { call: ["add", { var: "x" }, { var: "z" }] },
            { var: "y" },
          ],
        },
      ],
    };
    const r = dispatchedReify(closure(["x"], raw, { y: 7, x: 999 }));
    expect((r as ReifyResult).$tag).toBe("Ok");
    expect(okBody(r)).toEqual(liftBody(raw));
    expect(okCaptures(r)).toEqual([{ name: "y", value: 7 }]);
  });

  it("sequential let under a lambda \\x -> let a = x; b = y in b captures y only", () => {
    // `{let:{a,b}}` ⇒ implicit body = last binding (SVar "b"); a binds x
    // (param, bound), b binds y (free). Sequential scope: b's value sees a.
    const raw = { let: { a: { var: "x" }, b: { var: "y" } } };
    const r = dispatchedReify(closure(["x"], raw, { y: 11 }));
    expect((r as ReifyResult).$tag).toBe("Ok");
    expect(okBody(r)).toEqual(liftBody(raw)); // lift == the adapter's (decision 1)
    expect(okCaptures(r)).toEqual([{ name: "y", value: 11 }]);
  });
});

describe("reify — registry fns (Ok, captures EMPTY — top-level fns capture nothing)", () => {
  it("reify by id (engine:desugar) ⇒ Ok, body is an Expr tree, captures []", () => {
    const r = dispatchedReify("engine:desugar");
    expect((r as ReifyResult).$tag).toBe("Ok");
    // The lift uses the harness's real `_constructors`-derived ctorDefs (probe
    // 3), so an exact cross-lift vs a no-ctorDefs `jsonLogicToExpr` would
    // diverge on construct-bearing bodies — assert the body is an `Expr` node
    // (the corpus smoke pins the partition ≡ the adapter's on every body).
    expect(String((okBody(r) as { $tag: string }).$tag)).toMatch(/^E/);
    expect(okCaptures(r)).toEqual([]);
  });

  it("reify by {$ref: id} resolves the same as by exact canonical id string", () => {
    const byString = dispatchedReify("engine:reifyFilterCaptures");
    const byRef = dispatchedReify({ $ref: "engine:reifyFilterCaptures" });
    expect(byRef).toEqual(byString);
    expect((byRef as ReifyResult).$tag).toBe("Ok");
    expect(okCaptures(byRef)).toEqual([]);
  });
});

describe("reify — non-reifiable ⇒ Err Unsupported (the Result-sig amendment)", () => {
  it("a native / bodyless std fn (std:add) ⇒ Err Unsupported", () => {
    const r = dispatchedReify("std:add") as ReifyResult;
    expect(r.$tag).toBe("Err");
    expect(r._0!.reason).toMatch(/no Fenel body/);
  });

  it("an unregistered name ⇒ Err Unsupported", () => {
    const r = dispatchedReify("engine:doesNotExist") as ReifyResult;
    expect(r.$tag).toBe("Err");
  });

  it("a colliding bare Codeable alias is not compiler ownership authority", () => {
    const r = dispatchedReify("normaliseToCore") as ReifyResult;
    expect(r.$tag).toBe("Err");
    expect(r._0!.reason).toMatch(/no Fenel body/);
  });

  it("a partial application ({__fenelPartial}) ⇒ Err Unsupported (v1 fence)", () => {
    const partial = { __fenelPartial: true, fn: "std:add", collected: [1], arity: 2 };
    const r = dispatchedReify(partial) as ReifyResult;
    expect(r.$tag).toBe("Err");
    expect(r._0!.reason).toMatch(/no Fenel body/);
  });

  it("a plain non-fn value (number) ⇒ Err Unsupported", () => {
    const r = dispatchedReify(42) as ReifyResult;
    expect(r.$tag).toBe("Err");
  });
});

describe("reify — corpus smoke (partition ≡ the adapter's; captures empty for every registry fn)", () => {
  it("reify every Fenel-bodied engine fn; Ok/Err partition matches jsonLogicToExpr, captures always []", () => {
    const fns = engineModule.functions ?? [];
    let ok = 0;
    let err = 0;
    let divergent = 0;
    let nonEmptyCaptures = 0;
    for (const f of fns) {
      const body = (f as { body?: unknown }).body;
      if (body === undefined || body === null) continue;
      const reified = dispatchedReify(f.id) as ReifyResult;
      const lifted = dispatchedJsonLogicToExpr(body) as { $tag: string };
      // reify's partition must equal the adapter's on the SAME body (decision 1).
      if (reified.$tag !== lifted.$tag) divergent++;
      if (reified.$tag === "Ok") {
        ok++;
        // every registry fn captures nothing.
        const caps = reified._0!.captures as unknown[];
        if (!Array.isArray(caps) || caps.length !== 0) nonEmptyCaptures++;
      } else {
        err++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `[3a corpus smoke] bodies: ${ok + err}  Ok: ${ok}  Err: ${err}  divergent-vs-adapter: ${divergent}  non-empty-captures: ${nonEmptyCaptures}`,
    );
    expect(ok + err).toBeGreaterThan(0);
    expect(ok).toBeGreaterThan(0);
    expect(divergent).toBe(0); // reify-partition ≡ adapter-partition
    expect(nonEmptyCaptures).toBe(0); // registry fns capture nothing
  }, 120000);
});
