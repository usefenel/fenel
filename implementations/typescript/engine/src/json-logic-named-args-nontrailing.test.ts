// ---------------------------------------------------------------------------
// Regression suite for the NON-TRAILING named-args completion DOUBLE-EVAL defect.
//
// `maybeReorderNamedArgs` (`json-logic.ts`) handles `f { a = va, c = vc }` for
// formals `(a, b, c)` by synthesizing a binding lambda. It SPLICED the already-evaluated provided values into that
// lambda's body AST, so applying the binder ran them back through `applyFnOp`'s
// `evaluate(args[1], …)`: every provided VALUE re-entered the evaluator as an
// EXPRESSION. `{add:[1,2]}` arrived as `3`; a record keyed by a registered
// function name DISPATCHED it — an execution edge synthesized from witness
// DATA. The repair binds each provided value into the synthesized closure's env
// and references it by `{var}` (the mechanism `__namedTarget` already used).
// Synthesized names index by formal POSITION rather than embedding the formal,
// because `{var}` path-splits on `.`.
// Record: `workstreams/signature-substrate/notes/defect-nontrailing-completion-double-eval.md`
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { evaluate, type EvaluateContext } from "./json-logic";
import type { FenelFunction } from "./types";

const Nothing = { $tag: "Nothing" } as const;

const param = (name: string) => ({
  name,
  type: { $ref: "Any" },
  label: Nothing,
  ui: Nothing,
  meta: {},
});

/** A registered 3-ary function returning its arguments POSITIONALLY (an ARRAY
 *  body — `evaluate` maps element-by-element), so a reorder or completion
 *  defect is visible in the result shape. */
const collect3: FenelFunction = {
  id: "test:collect3",
  params: ["a", "b", "c"].map(param),
  returns: { $ref: "Any" },
  body: [{ var: "a" }, { var: "b" }, { var: "c" }],
};

/** Argument-ORDER-sensitive, so terminal equality across call forms is a real
 *  assertion rather than a symmetric coincidence. */
const sub2: FenelFunction = {
  id: "test:sub2",
  params: ["x", "y"].map(param),
  returns: { $ref: "Number" },
  body: { "-": [{ var: "x" }, { var: "y" }] },
};

/** Formals a `{var}` name would PATH-SPLIT if a synthesized name embedded them.
 *  `x` and `x.y` together also probe the CROSS-READ: a formal-embedding scheme
 *  resolves `__namedVal_x.y` through the value provided for `x`.
 *
 *  NATIVE-backed on purpose. A dotted formal is unreadable from a Fenel body
 *  in the first place (`{var: "x.y"}` path-splits at the READ too, which is a
 *  separate pre-existing property of `resolveVar`, not this defect), so a
 *  body-backed fixture would fail for a reason that has nothing to do with the
 *  synthesized names. Natives receive their arguments POSITIONALLY, which
 *  isolates exactly the seam under test. */
const dotted4: FenelFunction = {
  id: "test:dotted4",
  params: ["x", "x.y", "g", "z"].map(param),
  returns: { $ref: "Any" },
};
const dottedNatives = { "test:dotted4": (...args: unknown[]) => args };

/** A registered function whose native THROWS. Key-as-fnId dispatch consults
 *  `ctx.getFunction(op)` / `BUILTIN_OP_NATIVES` to DECIDE that a single-key
 *  record is a call — installing a native alone would leave `{__canary:[99]}`
 *  an ordinary record even at the defect-live code, and the test would pass
 *  vacuously. Registering the spec is what makes the canary live. */
const canary: FenelFunction = {
  id: "__canary",
  params: ["n"].map(param),
  returns: { $ref: "Any" },
  body: { var: "n" },
};

const REGISTERED = [collect3, sub2, dotted4, canary];

function baseCtx(extra?: Partial<EvaluateContext>): EvaluateContext {
  return {
    getFunction: (name) => REGISTERED.find((f) => f.id === name),
    ...extra,
  } as EvaluateContext;
}

/** The registered-name head (`invokeCallable`). */
const namedCallByName = { call: [collect3.id, { var: "r" }] };

/** The closure head (`invokeFunction`). A hand-built `fn` literal reaches the
 *  same reorder seam through the closure branch, and it is the branch that
 *  binds `__namedTarget`. */
const collect3Closure = {
  fn: ["a", "b", "c", [{ var: "a" }, { var: "b" }, { var: "c" }]],
};
const closureCall = { apply: [collect3Closure, [{ var: "r" }]] };

/** Complete a synthesized binder through the PUBLIC `$` application head — the
 *  route production takes, not a direct closure poke. */
const completeWithDollar = (partialVar: string, arg: unknown) => ({
  call: ["$", { var: partialVar }, arg],
});

/** Non-trailing named call -> complete -> result, for either head. */
function nonTrailing(head: unknown, record: unknown, last: unknown, ctx = baseCtx()): unknown {
  const partial = evaluate(head, { r: record }, ctx);
  return evaluate(completeWithDollar("p", last), { p: partial }, ctx);
}

describe("non-trailing named-args completion — bind, don't splice", () => {
  // --- 1. silent value corruption, BOTH call sites --------------------------

  it("delivers an op-shaped record value UNCHANGED through the registered-name head", () => {
    // The defect yielded [3, "B", "C"].
    expect(nonTrailing(namedCallByName, { a: { add: [1, 2] }, c: "C" }, "B")).toEqual([
      { add: [1, 2] },
      "B",
      "C",
    ]);
  });

  it("delivers an op-shaped record value UNCHANGED through the closure head", () => {
    expect(nonTrailing(closureCall, { a: { add: [1, 2] }, c: "C" }, "B")).toEqual([
      { add: [1, 2] },
      "B",
      "C",
    ]);
  });

  // --- 2. execution-edge synthesis, BOTH call sites -------------------------

  for (const [label, head] of [
    ["registered-name head", namedCallByName],
    ["closure head", closureCall],
  ] as const) {
    it(`never DISPATCHES a registered function named by a provided value's key (${label})`, () => {
      let fired = 0;
      const ctx = baseCtx({
        natives: {
          __canary: (...args: unknown[]) => {
            fired += 1;
            throw new Error(`__canary dispatched from witness DATA with ${JSON.stringify(args)}`);
          },
        },
      });
      expect(nonTrailing(head, { a: { __canary: [99] }, c: "C" }, "B", ctx)).toEqual([
        { __canary: [99] },
        "B",
        "C",
      ]);
      expect(fired).toBe(0);
    });
  }

  it("never re-evaluates a `{var}`-shaped field inside a provided record", () => {
    // A multi-key user record is recursively evaluated by `evaluate`, so a data
    // record holding a `{var}`-shaped field was ALSO corrupted (the var
    // resolved against the binder's env, not the author's).
    expect(nonTrailing(namedCallByName, { a: { label: { var: "a" }, n: 1 }, c: "C" }, "B")).toEqual([
      { label: { var: "a" }, n: 1 },
      "B",
      "C",
    ]);
  });

  // --- 3. value kinds that must survive identically -------------------------

  it("preserves `$tag`-bearing payload values", () => {
    expect(nonTrailing(namedCallByName, { a: { $tag: "Just", _0: 5 }, c: "C" }, "B")).toEqual([
      { $tag: "Just", _0: 5 },
      "B",
      "C",
    ]);
  });

  it("preserves scalars, lists, closures, partials, null and undefined", () => {
    const closureVal = evaluate({ fn: ["z", { var: "z" }] }, {}, baseCtx());
    const partialVal = evaluate({ call: [sub2.id, 10] }, {}, baseCtx());

    for (const provided of [7, "s", true, [1, { add: [1, 2] }], closureVal, partialVal, null, undefined]) {
      const out = nonTrailing(namedCallByName, { a: provided, c: "C" }, "B") as unknown[];
      // `undefined` survives as `undefined`: the found bit distinguishes a
      // PRESENT binding holding host-`undefined` from an ABSENT one, so the
      // `{var}` read does not fall through to the registry projection.
      expect(out[0]).toEqual(provided);
      expect(out.slice(1)).toEqual(["B", "C"]);
    }
  });

  // --- 4. synthesized names never path-split, never cross-read --------------

  // formals (x, "x.y", g, z) — 4-ary so a gap can sit at any position while
  // the record still has a LATER provided key (the non-trailing condition).
  const dottedCall = { call: [dotted4.id, { var: "r" }] };
  const dottedCtx = () => baseCtx({ natives: dottedNatives });

  it("handles a path-splitting formal in the MISSING position", () => {
    // gap at "x.y". A formal-embedding scheme would read `__named_x.y` as a
    // PATH into a binding that does not exist, and answer the fallback.
    expect(nonTrailing(dottedCall, { x: 1, g: 3, z: 4 }, 2, dottedCtx())).toEqual([1, 2, 3, 4]);
  });

  it("handles a path-splitting formal in the PROVIDED position", () => {
    // gap at index 0. A formal-embedding scheme resolves `__namedVal_x.y`
    // through a binding named `__namedVal_x` — absent here, so the value is
    // silently lost.
    expect(nonTrailing(dottedCall, { "x.y": 2, g: 3, z: 4 }, 1, dottedCtx())).toEqual([1, 2, 3, 4]);
  });

  it("does not cross-read one provided formal through another", () => {
    // BOTH `x` and `x.y` provided, gap at `g`: a formal-embedding scheme reads
    // `__namedVal_x.y` as `__namedVal_x` -> `.y`, i.e. it delivers x's OWN `y`
    // field as the value of the `x.y` argument. Silent, plausible, wrong.
    expect(nonTrailing(dottedCall, { x: { y: "WRONG" }, "x.y": 2, z: 4 }, 3, dottedCtx())).toEqual([
      { y: "WRONG" },
      2,
      3,
      4,
    ]);
  });

  // --- 5. terminal equality with the all-positional call --------------------

  it("terminal-equals the positional call on an order-sensitive body", () => {
    expect(evaluate({ call: [sub2.id, 10, 4] }, {}, baseCtx())).toBe(6);
    // formals (x, y); provide only the LAST -> non-trailing gap at the first.
    expect(nonTrailing({ call: [sub2.id, { var: "r" }] }, { y: 4 }, 10)).toBe(6);
  });

  // --- 6. the surrounding guards are UNCHANGED ------------------------------

  it("leaves the trailing-partial branch, the `$` fence and keys⊄formals intact", () => {
    // trailing-partial: provide a prefix -> positional truncation, not a binder.
    const trailing = evaluate({ call: [sub2.id, { var: "r" }] }, { r: { x: 10 } }, baseCtx());
    expect(evaluate(completeWithDollar("p", 4), { p: trailing }, baseCtx())).toBe(6);

    // `$`-keyed record: a WIRE VALUE, never named args — arrives as a value.
    expect(
      evaluate(
        { apply: [{ fn: ["$tag", { var: "$tag" }] }, [{ var: "r" }]] },
        { r: { $tag: "Nil" } },
        baseCtx(),
      ),
    ).toEqual({ $tag: "Nil" });

    // keys ⊄ formals: stays a positional record literal.
    expect(
      evaluate(
        { apply: [{ fn: ["only", { var: "only" }] }, [{ var: "r" }]] },
        { r: { nope: 1 } },
        baseCtx(),
      ),
    ).toEqual({ nope: 1 });

    // full named record: still reorders to positional.
    expect(evaluate({ call: [sub2.id, { var: "r" }] }, { r: { y: 4, x: 10 } }, baseCtx())).toBe(6);
  });
});
