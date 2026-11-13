// ---------------------------------------------------------------------------
// Regression suite: A SYNTHESIZED BINDER IS NOT A NAMED-ARGS CALLEE.
//
// `maybeReorderNamedArgs` (`json-logic.ts`) defers a non-trailing named-args
// gap — formals `(a, b, c)` called `f { a = 1, c = 3 }` — by synthesizing a
// binder closure whose formals are GENERATED (`__named_<index>`). That binder
// was an ordinary closure, so completing it with exactly one record argument
// RE-ENTERED the reorder seam and matched the record's keys against the
// binder's own synthesized formals: a record VALUE was unwrapped as named args.
//
// Executed, through the public evaluator: for formals `(a, b, c)` where `b`'s
// declared domain is a record type, `f {a=1,c=3}` then completing with
// `{__named_1: 42}` delivered `b = 42`, while the all-positional call
// `f 1 {__named_1=42} 3` delivers `b = {__named_1: 42}`. Same class as the
// shipped `$`-key fence: a record value misread as named args.
//
// Reachability is real, not theoretical: `__named_*` is authorable surface
// Fenel (underscore-leading identifiers are legal — `_0` is the std positional
// convention), and codec-ingress records carry arbitrary keys.
//
// The fence keys on the callee's SYNTHESIZED-NESS (a `namedBinder` envelope
// slot, the 8λ.5 `fix`-slot convention), never on name shape — a name-shape
// heuristic would false-positive on a legitimately authored `__named_*` formal.
//
// Record: `workstreams/signature-substrate/notes/defect-binder-reenters-named-reorder.md`
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

const collect3: FenelFunction = {
  id: "test:collect3",
  params: ["a", "b", "c"].map(param),
  returns: { $ref: "Any" },
  body: [{ var: "a" }, { var: "b" }, { var: "c" }],
};

const collect4: FenelFunction = {
  id: "test:collect4",
  params: ["a", "b", "c", "d"].map(param),
  returns: { $ref: "Any" },
  body: [{ var: "a" }, { var: "b" }, { var: "c" }, { var: "d" }],
};

const REGISTERED = [collect3, collect4];

const ctx = () =>
  ({ getFunction: (name: string) => REGISTERED.find((f) => f.id === name) }) as EvaluateContext;

/** Apply through the PUBLIC `$` head — the route production takes. */
const dollar = (fnVar: string, arg: unknown) => ({ call: ["$", { var: fnVar }, arg] });

describe("a synthesized binder is not a named-args callee", () => {
  it("passes a completion record whose keys match the synthesized params as a VALUE", () => {
    const binder = evaluate({ call: [collect3.id, { var: "r" }] }, { r: { a: 1, c: 3 } }, ctx()) as {
      params?: string[];
      namedBinder?: true;
    };
    expect(binder.params).toEqual(["__named_1"]);
    expect(binder.namedBinder).toBe(true);

    const value = { __named_1: 42 };
    const viaBinder = evaluate(dollar("p", { var: "v" }), { p: binder, v: value }, ctx());
    const positional = evaluate({ call: [collect3.id, 1, { var: "v" }, 3] }, { v: value }, ctx());

    expect(viaBinder).toEqual(positional);
    expect(viaBinder).toEqual([1, { __named_1: 42 }, 3]);
  });

  it("holds through the CLOSURE head as well as the registered-name head", () => {
    const closureHead = {
      apply: [
        { fn: ["a", "b", "c", [{ var: "a" }, { var: "b" }, { var: "c" }]] },
        [{ var: "r" }],
      ],
    };
    const binder = evaluate(closureHead, { r: { a: 1, c: 3 } }, ctx()) as { namedBinder?: true };
    expect(binder.namedBinder).toBe(true);

    expect(evaluate(dollar("p", { var: "v" }), { p: binder, v: { __named_1: 42 } }, ctx())).toEqual([
      1,
      { __named_1: 42 },
      3,
    ]);
  });

  it("holds for a MULTI-gap binder, at every completion step", () => {
    // formals (a,b,c,d), provide a and d -> gaps at b and c.
    const binder = evaluate({ call: [collect4.id, { var: "r" }] }, { r: { a: 1, d: 4 } }, ctx()) as {
      params?: string[];
    };
    expect(binder.params).toEqual(["__named_1", "__named_2"]);

    // A record matching a SUBSET of the binder's formals: the defect read it
    // as a trailing-partial named-args record and truncated positionally.
    const afterB = evaluate(dollar("p", { var: "v" }), { p: binder, v: { __named_1: "B" } }, ctx());
    const done = evaluate(dollar("q", "C"), { q: afterB }, ctx());
    expect(done).toEqual([1, { __named_1: "B" }, "C", 4]);

    // and a record matching ALL of them.
    const both = evaluate(
      dollar("p", { var: "v" }),
      { p: binder, v: { __named_1: "B", __named_2: "C" } },
      ctx(),
    );
    expect(evaluate(dollar("q", "C2"), { q: both }, ctx())).toEqual([
      1,
      { __named_1: "B", __named_2: "C" },
      "C2",
      4,
    ]);
  });

  it("still lets an ORDINARY closure and an ordinary registered function take named args", () => {
    // The fence is on synthesized binders ONLY.
    expect(
      evaluate(
        { apply: [{ fn: ["x", "y", { "-": [{ var: "x" }, { var: "y" }] }] }, [{ var: "r" }]] },
        { r: { y: 4, x: 10 } },
        ctx(),
      ),
    ).toBe(6);

    expect(evaluate({ call: [collect3.id, { var: "r" }] }, { r: { c: 3, b: 2, a: 1 } }, ctx())).toEqual([
      1, 2, 3,
    ]);
  });

  it("leaves ordinary POSITIONAL binder completion unchanged", () => {
    const binder = evaluate({ call: [collect3.id, { var: "r" }] }, { r: { a: 1, c: 3 } }, ctx());
    expect(evaluate(dollar("p", 2), { p: binder }, ctx())).toEqual([1, 2, 3]);
    // and a non-record completion value of every other kind.
    for (const v of [0, "", null, [1, 2], { nope: 1 }]) {
      const out = evaluate(dollar("p", { var: "v" }), { p: binder, v }, ctx()) as unknown[];
      expect(out).toEqual([1, v, 3]);
    }
  });

  it("reads the marker as OWN data — an inherited key does not fence an authored closure", () => {
    // A plain `target.namedBinder` consults the prototype, so an authored
    // closure whose prototype carries the key would silently lose the
    // named-args sugar; an own getter would additionally be INVOKED on every
    // one-record application.
    const authored = evaluate({ fn: ["x", "y", { "-": [{ var: "x" }, { var: "y" }] }] }, {}, ctx()) as object;
    const inherited = Object.assign(Object.create({ namedBinder: true }), authored);
    expect(evaluate({ call: ["$", { var: "f" }, { var: "r" }] }, { f: inherited, r: { y: 4, x: 10 } }, ctx())).toBe(6);

    let getterCalls = 0;
    const withGetter = Object.assign({}, authored);
    Object.defineProperty(withGetter, "namedBinder", {
      get: () => {
        getterCalls += 1;
        return true;
      },
      enumerable: true,
      configurable: true,
    });
    expect(evaluate({ call: ["$", { var: "f" }, { var: "r" }] }, { f: withGetter, r: { y: 4, x: 10 } }, ctx())).toBe(6);
    expect(getterCalls).toBe(0);
  });

  it("does not mark a TRAILING-gap partial (there is no binder to mark)", () => {
    // `{a}` alone truncates positionally and yields a plain partial.
    const partial = evaluate({ call: [collect3.id, { var: "r" }] }, { r: { a: 1 } }, ctx()) as {
      namedBinder?: true;
      __fenelPartial?: true;
    };
    expect(partial.__fenelPartial).toBe(true);
    expect(partial.namedBinder).toBeUndefined();
  });
});
