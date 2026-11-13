// ---------------------------------------------------------------------------
// typed-ref-editor.test.ts — typed-function-references Phase 4 proof.
//
// Phase 4 adds the EDITOR producer (P4): a ref-mode on an `$arrow`-typed slot
// emits a typed function reference `{$ref: id}` as a *literal value* (the
// editor's `pickFunctionRef` → `setLiteral({ $ref: fnId })`), so a user can
// pass a function point-free (`map abs xs`). The runtime side was finished in
// Phase 2 (`{$ref}` self-evaluates; every HOF gate carries it) — this phase is
// the editor producer + display pill + lossless read-back, with NO new runtime
// wiring.
//
// The frontend round-trip (`toLogic` / `logicToExprNode`) can't be unit-tested
// in the current harness — the solid modules transitively import @solidjs/router
// which calls client-only APIs at module load, so bun can't import them; the
// solid package has no vitest/bun-test setup. Those transforms are verified by
// reading the code:
//   • toLogic: a `{$ref}` literal is not a `__form` marker → `literalToLogic`
//     returns it verbatim (no resolver needed) → engine self-evaluates it.
//   • logicToExprNode (home.tsx): `{$ref:"id"}` is a single-key, STRING-valued
//     object; the call path requires `Array.isArray(raw)`, and `isPlainRecord`
//     excludes `$`-prefixed keys, so it falls to the verbatim final fallback —
//     read back as `{kind:"literal", value:{$ref:"id"}}`, NOT a call node.
//
// This suite pins, engine-side (the runtime half + the data-shape invariant the
// frontend reader relies on):
//   • the editor's emitted shape — a literal `{$ref:id}` as a call ARG — runs
//     through the full `evaluate` → callOp → invokeCallable HOF path (`map`);
//   • the read-back-safety invariant: a `{$ref}` value is a single-key object
//     with a STRING value (never an array), so the key-as-fnId/call reader
//     cannot mis-parse it into a broken `{fnId:"$ref"}` call node.
//
// Canonical spec: design/typed-function-references.md ("References — the `Ref`
// substrate").
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import { Ref, isRef } from "./type-foundation";

const reg = createRegistry([stdModule]);
const ctx = reg.evaluateContext();
const absId = reg.getFunction("abs")!.id;

describe("Phase 4 — the editor's `{$ref}` literal runs as a call arg (producer output)", () => {
  test("a literal {$ref} passed to `map` applies the function over the list", () => {
    // This is exactly what `toLogic` emits for a function-ref literal sitting
    // in a call arg slot: `{call: ["map", {$ref: absId}, [...]]}`. It must
    // survive evaluate's arg-evaluation (self-eval pass-through) and reach the
    // HOF as a callable — the point-free `map abs xs`.
    expect(evaluate({ call: ["map", { $ref: absId }, [-1, 2, -3]] }, {}, ctx)).toEqual([1, 2, 3]);
  });

  test("the same point-free shape works through `apply`", () => {
    expect(evaluate({ apply: ["map", [{ $ref: absId }, [-4, 5]]] }, {}, ctx)).toEqual([4, 5]);
  });

  test("a literal {$ref} evaluates to itself (self-eval pass-through)", () => {
    // The editor stores `{$ref:id}` as a literal; `evaluate` hands it back
    // unchanged (json-logic single-key `$`-marker pass-through) — no resolver,
    // no inlining, serializable.
    const v = evaluate({ $ref: absId }, {}, ctx);
    expect(isRef(v)).toBe(true);
    expect(v).toEqual({ $ref: absId });
  });
});

describe("Phase 4 — read-back-safety invariant (no mis-parse as a call)", () => {
  test("a {$ref} value is a single-key object with a STRING value, never an array", () => {
    // The frontend reader (`logicToExprNode`) routes `{call|construct|...: [...]}`
    // to call/construct mode ONLY when the value is an array. A function-ref's
    // value is a bare string id, so it can never be grabbed by those paths and
    // falls through to the lossless literal fallback.
    const v = Ref(absId) as { $ref: unknown };
    expect(Object.keys(v)).toEqual(["$ref"]);
    expect(typeof v.$ref).toBe("string");
    expect(Array.isArray(v.$ref)).toBe(false);
  });
});
