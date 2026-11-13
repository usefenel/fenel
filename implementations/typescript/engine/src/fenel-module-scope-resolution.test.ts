// ---------------------------------------------------------------------------
// fenel-module-scope-resolution.test.ts — FM-retire-11 (L1) regression pins.
//
// The L1 loader pass (`resolveLocalCallHeads`, fenel-module.ts) rewrites a
// local-applying bare-string call head `{call:["f", …]}` → `{call:[{var:"f"}, …]}`
// IFF `f` resolves to an in-scope binder, leaving the 5389/5390 global heads as
// bare strings. This file re-encodes the audit's 5 shadowing edge cases (Step-0
// findings §2) as PERMANENT tests (the audit's probe was a throwaway), plus a
// few extra surface checks (let / do / nested-ctor pattern / idempotency).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { resolveLocalCallHeads } from "./fenel-module";

/** Pull the head of a `{call:[head, …]}` node. */
function head(node: unknown): unknown {
  return (node as { call?: unknown[] }).call?.[0];
}

describe("L1 scope-resolution — the 5 audit shadowing cases", () => {
  test("1. param `f` shadows global `f` → head rewritten to {var}", () => {
    const out = resolveLocalCallHeads({ call: ["f", { var: "x" }] }, ["f", "x"]);
    expect(head(out)).toEqual({ var: "f" } as never);
  });

  test("2. global `add`, no binder → head stays a bare string", () => {
    const out = resolveLocalCallHeads({ call: ["add", 1, 2] }, []);
    expect(head(out)).toBe("add");
  });

  test("3. nested lambda rebinds `g` → head rewritten inside the lambda", () => {
    const out = resolveLocalCallHeads({ fn: [["g"], { call: ["g", 1] }] }, []);
    const lamBody = (out as { fn: unknown[] }).fn[1];
    expect(head(lamBody)).toEqual({ var: "g" } as never);
  });

  test("4. match-bound `_x` applied → head rewritten in that arm's body", () => {
    const out = resolveLocalCallHeads(
      { match: [{ var: "r" }, { $bind: "_x" }, { call: ["_x", 1] }] },
      ["r"],
    );
    const armBody = (out as { match: unknown[] }).match[2];
    expect(head(armBody)).toEqual({ var: "_x" } as never);
  });

  test("5. global head `map` inside a lambda → stays a bare string", () => {
    const out = resolveLocalCallHeads({ fn: [["x"], { call: ["map", { var: "x" }] }] }, []);
    const lamBody = (out as { fn: unknown[] }).fn[1];
    expect(head(lamBody)).toBe("map");
  });
});

describe("L1 scope-resolution — broader binder surface + invariants", () => {
  test("flat-form lambda `{fn:[p, body]}` extends binders too", () => {
    // The parser emits the flat shape; the head `f` is the param.
    const out = resolveLocalCallHeads({ fn: ["f", { call: ["f", 1] }] }, []);
    const lamBody = (out as { fn: unknown[] }).fn[1];
    expect(head(lamBody)).toEqual({ var: "f" } as never);
  });

  test("let binding shadows a global, scoped to subsequent do statements", () => {
    const out = resolveLocalCallHeads(
      { do: [{ let: { f: { var: "g" } } }, { call: ["f", 1] }] },
      [],
    );
    const stmts = (out as { do: unknown[] }).do;
    expect(head(stmts[1])).toEqual({ var: "f" } as never);
  });

  test("a let value referencing a not-yet-bound name does NOT rewrite (sequential scope)", () => {
    // `let f = f 1` — the RHS `f` is the GLOBAL f (the binding isn't in scope for
    // its own value), so it stays a bare string; only later uses see the local.
    const out = resolveLocalCallHeads({ let: { f: { call: ["f", 1] } } }, []);
    const binding = (out as { let: Record<string, unknown> }).let.f;
    expect(head(binding)).toBe("f");
  });

  test("nested-constructor pattern binds the inner name", () => {
    // case s of Cons (Just x) tail -> x 1   — `x` is bound, head rewritten.
    const out = resolveLocalCallHeads(
      {
        match: [
          { var: "s" },
          { $tag: "Cons", _0: { $tag: "Just", _0: { $bind: "x" } }, _1: { $bind: "tail" } },
          { call: ["x", 1] },
        ],
      },
      [],
    );
    const armBody = (out as { match: unknown[] }).match[2];
    expect(head(armBody)).toEqual({ var: "x" } as never);
  });

  test("a match arm's binders do NOT leak to a sibling arm", () => {
    // arm 1 binds `f`; arm 2 has no binder for `f` → arm 2's `f` head is global.
    const out = resolveLocalCallHeads(
      {
        match: [
          { var: "r" },
          { $tag: "Ok", _0: { $bind: "f" } },
          { call: ["f", 1] },
          { $tag: "Err", _0: { $bind: "e" } },
          { call: ["f", 2] },
        ],
      },
      [],
    );
    const m = (out as { match: unknown[] }).match;
    expect(head(m[2])).toEqual({ var: "f" } as never); // arm 1 — local
    expect(head(m[4])).toBe("f"); // arm 2 — global, not leaked
  });

  test("idempotent: an already-`{var}` head is left untouched (not double-wrapped)", () => {
    const out = resolveLocalCallHeads({ call: [{ var: "f" }, 1] }, ["f"]);
    expect(head(out)).toEqual({ var: "f" } as never);
  });

  test("constructor heads are never rewritten (construct stays a string head)", () => {
    const out = resolveLocalCallHeads({ construct: ["Ok", { var: "x" }] }, ["Ok", "x"]);
    expect((out as { construct: unknown[] }).construct[0]).toBe("Ok");
  });

  test("operator key-as-fnId form `{add:[…]}` is untouched", () => {
    const out = resolveLocalCallHeads({ add: [{ var: "x" }, 1] }, ["add", "x"]);
    expect(out).toEqual({ add: [{ var: "x" }, 1] } as never);
  });
});
