// ---------------------------------------------------------------------------
// type-substrate P1(a.13) — resolution-honesty: the where-proof FRAME battery.
//
// `mem.where.prov` (tcb-ledger.md, UNSOUND-KNOWN) is the register's broadest
// false-`Just` channel: wherever the interpreter could not produce a value it
// returns host `null`, and an enclosing operator launders that `null` into a
// genuine Boolean — so a `$where` membership answered `Just false` / `Just true`
// for a test that never ran. That verdict reaches validation ingress →
// persistence, the permission boundary, and the kernel re-check (the SAME
// function), which then stamps `SolverChecked` on a test it never ran.
//
// The owner's ruling: **no value produced ⇒ `Nothing` = "this test could not be
// run"**. The repair observes the failure AT the failure:
//
//   • a module-level where-proof FRAME stack in `json-logic.ts`, pushed by the
//     one live SeWhere door (`whereMember`) — carried in NO evaluation context,
//     because a ctx-carried marker was measured OBSERVABLE by a
//     `Reflect.ownKeys` ctx-native (it flipped a verdict — a MINT);
//   • DIRECT trips at every interpreted no-value exit;
//   • DOOR marking: every exception crossing `evaluate` / `invokeCallable` (the
//     two exported re-entry points that execute interpreter machinery) marks the
//     innermost frame and rethrows the ORIGINAL exception, so a failure a native
//     later CATCHES and converts still abstains the proof;
//   • INNERMOST-ONLY + the boundary rule: a nested membership consumes its own
//     trip and emits `Nothing` as ordinary data.
//
// Every entry value below was MEASURED at `6b6281f9` and is recorded in-test so
// a future reader can see what moved. The three tables are the phase's pin set:
// TRIPS (must abstain), ENTITLED MOVEMENTS (declared, priced), and the
// MUST-NOT-MOVE anti-proxy net — any movement in the third table means a proxy
// regrew and the change must be reverted, not re-pinned.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { join } from "node:path";
import { contains, isSubset } from "./set-algebra";
import { evaluate, invokeCallable, type EvaluateContext } from "./json-logic";
import { beginWhereProofFrame, endWhereProofFrame, reflectionInvocationRoute, runtimeFunctionRouteIsDirect,
  runtimeSourceDependencyPrecheckIsTrivial } from "./json-logic";
import { NonEmptyStr } from "./type-foundation";
import { propSubset, decidableSetProof } from "./prover";
import { verify } from "./kernel";
import type { SetExpr, FenelFunction } from "./types";
import { __getHarnessForTests } from "./engine-bodies-dispatch";

const where = (pred: unknown): SetExpr => ({ $tag: "SeWhere", pred }) as unknown as SetExpr;
const NOTHING = { $tag: "Nothing" };
const JUST = (b: boolean) => ({ $tag: "Just", _0: b });

// `eagerEval : (expression, context) -> Result EvalError Value` — TWO declared
// params (`fenel/modules/evaluator-strategies/types.fenel`). A one-argument call
// under-applies to a PARTIAL and never reaches the native; the second argument
// is an ignored placeholder (the ctx-native threads the live ctx).
const reify = (ruleExpr: unknown) => ({
  match: [{ call: ["eagerEval", ruleExpr, {}] }, { $tag: "Err" }, true, "_", false],
});

/** A registry-visible BODYLESS function typed `-> Boolean`: the shape a
 *  request-scoped / IO name has inside a pure proof context. */
const ioBool = {
  id: "test:ioBool",
  params: [],
  returns: { $ref: "Boolean" },
} as unknown as FenelFunction;

const ctx: EvaluateContext = {
  getFunction: (n: string) => (n === "ioBool" || n === "test:ioBool" ? ioBool : undefined),
  natives: {
    /** An out-of-file native that THROWS: its exception originates outside
     *  `json-logic.ts` and at no `throw` statement in that file. */
    boomNative: () => {
      throw new Error("boom-from-a-native");
    },
    /** A two-element list whose ITERATOR is spoofed. It has to come from a
     *  NATIVE: an array LITERAL in the AST is normalised by `evaluateEach`
     *  (itself an index walk) before `merge` ever sees it, so a literal cannot
     *  discriminate the two flattens at all — measured, after a pin that
     *  silently did not and one that DISCRIMINATES caught. A native's return
     *  value reaches `merge` un-normalised, which is exactly the shape in which
     *  a spread would consult the override. */
    /** A native that MUTATES an array an earlier operand returned, plus a
     *  SPARSE list. Round 5 (Codex): `flatMap` evaluates and flattens each
     *  operand in turn and skips holes at both levels, so evaluating every
     *  operand first and then flattening was observably different. */
    firstList: () => mutableFirst,
    mutateFirst: () => {
      mutableFirst.push(2);
      return 3;
    },
    /** Round 6 (Codex): `map` / `flatMap` read the source length ONCE, so an
     *  element that GROWS the list during evaluation must not extend the walk.
     *  Both levels are snapshot; measured `[1,2]` before. */
    lengthSnapshotProbe: () => {
      const outerArgs: unknown[] = [];
      const grew = evaluate({ merge: outerArgs }, {}, {
        natives: { grow: () => { outerArgs.push(2); return 1; } },
      }) as unknown[];
      outerArgs.push({ call: ["grow"] });
      const merged = evaluate({ merge: outerArgs }, {}, {
        natives: { grow: () => { outerArgs.push(2); return 1; } },
      }) as unknown[];
      const selfGrow: unknown[] = [];
      selfGrow.push({ call: ["growSelf"] });
      const each = evaluate(selfGrow, {}, {
        natives: { growSelf: () => { selfGrow.push(9); return 1; } },
      }) as unknown[];
      // Round 7 (Grok): the INNER length was snapshot in code but not pinned.
      // Round 8 (Codex AND Grok, independently): round 7's cell did not
      // DISCRIMINATE either — it grew the inner array from a LATER operand, by
      // which time the first operand's inner walk had already finished, so a
      // re-read of `val.length` could not see the push and both spellings gave
      // `[1,8]`. The inner walk is only observable from INSIDE itself: an
      // index-0 getter that appends index 1 while that walk is reading it.
      // Snapshot gives `[1]` — which is exactly what `flatMap` gives; a
      // re-read gives `[1,7]`. This is the third pin in this phase that passed
      // with and without its own fix.
      const getterGrow: unknown[] = [];
      Object.defineProperty(getterGrow, 0, {
        get() { if (getterGrow.length === 1) getterGrow.push(7); return 1; },
        enumerable: true,
        configurable: true,
      });
      const innerMerged = evaluate({ merge: [{ call: ["inner"] }] }, {}, {
        natives: { inner: () => getterGrow },
      }) as unknown[];
      // Round 8 (Codex): `ToLength`. `map` / `flatMap` truncate the source
      // length before walking it; the indexed walks read it RAW, so an
      // array-like reporting `1.5` made `out.length = 1.5` throw `RangeError:
      // Invalid array length` where native `map` returns one element — a CRASH
      // introduced where the old `.map` worked, and one that reaches callers
      // outside any where-proof frame.
      const fractional = new Proxy([1, 2], {
        get(t, k, r) { return k === "length" ? 1.5 : Reflect.get(t, k, r); },
      }) as unknown as unknown[];
      const fracMerge = evaluate({ merge: [{ call: ["frac"] }] }, {}, {
        natives: { frac: () => fractional },
      }) as unknown[];
      const fracEach = evaluate(fractional, {}, {}) as unknown[];
      return grew.length === 0
        && merged.length === 1 && merged[0] === 1
        && each.length === 1 && each[0] === 1
        && innerMerged.length === 1 && innerMerged[0] === 1
        && fracMerge.length === 1 && fracMerge[0] === 1
        && fracEach.length === 1 && fracEach[0] === 1;
    },
    sparseArgsProbe: () => {
      // A plain native: `merge` is a KNOWN_OP and needs no registry, and a hole
      // does not survive the value boundary into a predicate, so the sparse
      // list has to be built here.
      const args: unknown[] = [];
      args.length = 2;
      args[1] = [1];
      const out = evaluate({ merge: args }, {}, {}) as unknown[];
      // ... and the shared `evaluateEach` walk preserves a hole rather than
      // writing `undefined` into it, which is the same rule one layer down
      // (`Array.prototype.map`, which it replaced, skips holes).
      const sparseAst: unknown[] = [];
      sparseAst.length = 2;
      sparseAst[1] = 1;
      const each = evaluate(sparseAst, {}, {}) as unknown[];
      return Array.isArray(out) && out.length === 1 && out[0] === 1
        && Array.isArray(each) && each.length === 2 && !(0 in each) && each[1] === 1;
    },
    /** Round 8 (Codex): the in-frame half of the sparse-arity family. The
     *  outside-frame half is asserted directly (a hole cannot cross the value
     *  boundary into a predicate, so the AST has to be built here). Inside a
     *  frame the inner `evaluate` re-enters the door with the frame open, so
     *  the trip aborts and propagates out through this native — which is why
     *  this cannot be a probe that returns `true`. Before the fix it returned
     *  host-`undefined` and `!` laundered it into `Just true`. */
    sparseAnnEval: () => {
      const a: unknown[] = [];
      a.length = 1;
      return evaluate({ ann: a }, {}, {});
    },
    /** `fn` always RETURNS a closure, so its sparse trip is only observable
     *  in-frame: the closure built from a sparse `{fn:<two holes>}` has an
     *  absent body, and applying it laundered that into a value. */
    sparseFnApply: () => {
      const a: unknown[] = [];
      a.length = 2;
      return evaluate({ apply: [{ fn: a }, []] }, {}, {});
    },
    spoofList: () => {
      const inner = [1, 2] as unknown[];
      Object.defineProperty(inner, Symbol.iterator, {
        value: () => ["spoof"][Symbol.iterator](),
        configurable: true,
      });
      return inner;
    },
  },
  nativesCtx: {
    /** The ACCIDENTAL catcher — not a documented reifier. It swallows a hard
     *  evaluator throw and answers `true`. Indistinguishable from a contractual
     *  reifier at the boundary, which is why the rule is uniform. */
    swallowHard: (c: EvaluateContext) => {
      try {
        evaluate({ method: ["NoSuchClass", "m", 1] }, {}, c);
        return false;
      } catch {
        return true;
      }
    },
    /** The synthetic BRAND-SWALLOWER: catches the trip's own abort and answers
     *  `true`. The frame consult must still abstain — the exception is not the
     *  evidence, the frame is. */
    swallowBrand: (c: EvaluateContext) => {
      try {
        evaluate({ call: ["nope:notAFn"] }, {}, c);
        return false;
      } catch {
        return true;
      }
    },
    /** The `invokeCallable` DOOR, exercised WITHOUT crossing `evaluate`: the
     *  native's own throw fires inside `invokeFunction`, reached directly. */
    viaCallable: (c: EvaluateContext) => {
      try {
        invokeCallable("boomNative", [], c);
        return false;
      } catch {
        return true;
      }
    },
    /** The CANONICAL two-element `fn` with an ABSENT body slot, built here
     *  because a trailing `undefined` does not survive the value boundary into
     *  a predicate. If the trip fires the throw leaves this native and the seam
     *  answers `Nothing`; if it does not, this returns `true` and the pin goes
     *  red on a `Just true`. */
    canonicalFnNoBody: (c: EvaluateContext) => {
      evaluate({ apply: [{ fn: [["x"], undefined] }, [1]] }, {}, c);
      return true;
    },
    /** A nested membership whose own frame trips: the boundary rule says its
     *  `Nothing` is ordinary DATA for the enclosing proof. */
    innerMemberAbstains: () =>
      JSON.stringify(contains(where({ call: ["nope:notAFn"] }), 1, null, undefined, ctx))
      === JSON.stringify(NOTHING),
    /** The same, but the inner frame trips through the `invokeCallable` DOOR
     *  rather than through a no-value exit. Review round 1 (Grok) noted the
     *  boundary pin covered only the `whereProofNoValue` half, so an
     *  all-frame regression in the second door's handler would go unseen. */
    innerViaCallableAbstains: () =>
      JSON.stringify(contains(where({ call: ["viaCallable"] }), 1, null, undefined, ctx))
      === JSON.stringify(NOTHING),
  },
};

/** Shared by the two `merge` ORDER natives: the second mutates what the
 *  first returned, which is only observable if flattening is interleaved. */
const mutableFirst: unknown[] = [1];

const ask = (pred: unknown, v: unknown = 5) => contains(where(pred), v, null, undefined, ctx);

// A supplied reader is authoritative. The tiny ctx above intentionally omits
// stock declarations; tests of actual evaluators must request their real
// registry, source/dispatch metadata and native callbacks explicitly. Preserve
// this file's probes without making the production membership door fall back.
function evaluationReader(): EvaluateContext {
  const registered = __getHarnessForTests().ctx;
  return {
    ...registered,
    getFunction: (name) => ctx.getFunction?.(name) ?? registered.getFunction?.(name),
    natives: Object.assign(Object.create(null), registered.natives, ctx.natives),
    nativesCtx: Object.assign(Object.create(null), registered.nativesCtx, ctx.nativesCtx),
  };
}
const askWithEvaluators = (pred: unknown, v: unknown = 5) =>
  contains(where(pred), v, null, undefined, evaluationReader());

// ---------------------------------------------------------------------------
// 1. TRIPS — an interpreted no-value exit inside the proof ⇒ `Nothing`
// ---------------------------------------------------------------------------

describe("mem.where.prov — the interpreted no-value exits abstain", () => {
  it("an unresolved call laundered by `>` (entry: Just false)", () => {
    expect(ask({ ">": [{ call: ["nope:notAFn"] }, 0] })).toEqual(NOTHING);
  });

  it("an unresolved call laundered by `!` (entry: Just TRUE — a positive proof from a miss)", () => {
    expect(ask({ "!": [{ call: ["nope:notAFn"] }] })).toEqual(NOTHING);
  });

  it("an unresolved call compared to null (entry: Just true)", () => {
    expect(ask({ "==": [{ call: ["nope"] }, null] })).toEqual(NOTHING);
  });

  it("a non-callable `$` application head (entry: Just true)", () => {
    expect(ask({ "!": [{ call: ["$", 7] }] })).toEqual(NOTHING);
  });

  it("a HOF whose callback argument is not callable (entry: Just true)", () => {
    expect(ask({ call: ["none", [1, 2, 3], 0] })).toEqual(NOTHING);
  });

  it("a missing field read with NO explicit default (entry: Just false — the W2-frozen posture, RETIRED)", () => {
    // W2 froze this as "the predicate ran and said no". The owner's re-cut is
    // that reading a missing field IS a resolution failure: the test could not
    // be run. (consult note §6.4)
    expect(ask({ ">": [{ var: "noSuchField" }, 0] })).toEqual(NOTHING);
  });

  it("a path read through null / a non-object / an absent key (entry: Just true ×3)", () => {
    expect(ask({ "!": [{ var: "value.obj.x" }] }, { obj: null })).toEqual(NOTHING);
    expect(ask({ "!": [{ var: "value.obj.x" }] }, { obj: 0 })).toEqual(NOTHING);
    expect(ask({ "!": [{ var: "value.obj.x" }] }, {})).toEqual(NOTHING);
  });

  it("a BODYLESS registered function — both the call and the key-as-fnId spelling (entry: Just false ×2)", () => {
    expect(ask({ "!!": [{ call: ["ioBool"] }] })).toEqual(NOTHING);
    expect(ask({ "!!": [{ ioBool: [] }] })).toEqual(NOTHING);
  });

  it("a malformed `withInstance` (arity ≠ 2) (entry: Just true)", () => {
    expect(ask({ "!": [{ withInstance: [] }] })).toEqual(NOTHING);
  });

  // ── review round 1: the MISSING-OPERAND family ───────────────────────────
  // The brief's census enumerated `return null` sites. These three return no
  // value WITHOUT returning `null`: the absent operand, or an unset
  // initializer, IS the result. A `return null` grep cannot see them, and both
  // reviewers reproduced two of the three independently.
  it("an operator applied to a MISSING operand: `{ann:[]}` (entry: Just true)", () => {
    expect(ask({ "!": [{ ann: [] }] })).toEqual(NOTHING);
    expect(ask({ "!!": [{ ann: [] }] })).toEqual(NOTHING);
  });

  it("an EMPTY `do` returns its unset initializer (entry: Just true)", () => {
    expect(ask({ "!": [{ do: [] }] })).toEqual(NOTHING);
  });

  // ── review round 8: the DECLARATION family, and holes as absence ─────────
  it("a `do` whose only statement is an EMPTY `let` (entry: Just true)", () => {
    // Round 8 (Grok): the round-1 fixes closed `{do:[]}` and the STANDALONE
    // `{let:[{}]}`, and left the composition of the two open — the nested-`let`
    // path bound nothing, so `result` stayed at its unset `null` initializer
    // and `!` laundered it. `result` was never the witness that a statement
    // ran; `produced` is.
    expect(ask({ "!": [{ do: [{ let: {} }] }] })).toEqual(NOTHING);
    expect(ask({ "!": [{ do: [{ let: [] }] }] })).toEqual(NOTHING);
    // DECLARED MOVEMENT (`Just true` -> `Nothing`): an empty `let` as the LAST
    // statement. This arm reads a `let`'s value as its last BINDING's value, so
    // a `let` that binds nothing has none; the other reading — "a declaration
    // leaves the running value alone" — disagrees, and where two readings
    // disagree the decider emits only where they agree (`design/deciding.md`
    // §9.1, standing rule C). The Fenel parser cannot spell an empty `let`.
    expect(ask({ do: [true, { let: {} }] })).toEqual(NOTHING);
  });

  it("a `type_def` used AS A VALUE produces none (entry: Just true)", () => {
    // Round 8 (self, found while verifying the reviewers' claims): the last
    // bare `return null` in the file that MINTED a no-value rather than
    // reporting an answer. A type declaration has no value; this returned one.
    expect(ask({ "!": [{ type_def: { name: "R8Val", constructors: [] } }] })).toEqual(NOTHING);
    expect(ask({ "!": [{ type_def: [{ name: "R8Val2", constructors: [] }] }] })).toEqual(NOTHING);
  });

  it("a SPARSE operand list does not satisfy an arity guard (entry: Just true)", () => {
    // Round 8 (Codex): `length` counts HOLES. Every `args.length >= k` guard
    // therefore admitted an operand list that promised k operands and carried
    // fewer, and the absent slot read as `undefined` and became the answer —
    // `{"!":[{ann:<one hole>}]}` measured `Just true` while the dense
    // `{ann:[]}` correctly abstained. The rest of this phase already reads
    // absence with `i in list`; the guards did not.
    //
    // A hole cannot cross the value boundary into a predicate, so the
    // OUTSIDE-frame half is measured directly: a no-value exit returns `null`
    // there, where these shapes previously returned host-`undefined`.
    const hole = (n: number): unknown[] => { const a: unknown[] = []; a.length = n; return a; };
    for (const rule of [
      { ann: hole(1) }, { do: hole(1) }, { reduce: hole(3) }, { if: hole(3) },
      { match: hole(2) }, { call: hole(1) }, { apply: hole(2) },
      { "|>": hole(2) }, { pipe: hole(1) }, { withInstance: hole(2) },
    ]) {
      expect(evaluate(rule, {}, {})).toBe(null);
    }
    // ... and the dense controls still produce their values
    expect(evaluate({ ann: [7] }, {}, {})).toBe(7);
    expect(evaluate({ do: [7] }, {}, {})).toBe(7);
    expect(evaluate({ if: [true, 7, 8] }, {}, {})).toBe(7);
    // The IN-frame half: the same shapes abstain rather than deciding.
    // (`fn` is excluded from the loop above because it always RETURNS a
    // closure — its trip is the statement form, so only the in-frame half is
    // observable. Applying that closure previously laundered its absent body.)
    expect(ask({ "!": [{ call: ["sparseAnnEval"] }] })).toEqual(NOTHING);
    expect(ask({ "!": [{ call: ["sparseFnApply"] }] })).toEqual(NOTHING);
  });

  it("an AST-supplied `map` at `type_def` cannot absorb the throw (entry: Just false)", () => {
    // Round 8 (Codex): `ctor.fields.map(f => f.name)` ran an AST-controlled
    // read INSIDE a method the AST controls. A subclass whose `map` catches
    // absorbed the `TypeError` from a malformed field before either door saw
    // it — the second measured counterexample to "an exception raised in this
    // file exits through the door its caller entered by", and the first one
    // that arrived through a method the file CALLS rather than one it declares.
    class CatchFields extends Array {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map(cb: any, that?: unknown): any[] {
        const out: unknown[] = [];
        for (let i = 0; i < this.length; i++) {
          try { out.push(cb.call(that, this[i], i, this)); } catch { out.push(undefined); }
        }
        return out;
      }
    }
    const hostile = new CatchFields();
    hostile.push(null);
    const td = (fields: unknown) => ({ type_def: [{ name: "R8", constructors: [{ name: "C", fields }] }] });
    expect(ask({ "!": [{ do: [td(hostile), true] }] })).toEqual(NOTHING);
    // the plain-array control answered `Nothing` before and after
    expect(ask({ "!": [{ do: [td([null]), true] }] })).toEqual(NOTHING);
  });

  it("a zero-argument `fn` has no body to construct (entry: Just true)", () => {
    expect(ask({ "!": [{ apply: [{ fn: [] }, []] }] })).toEqual(NOTHING);
    expect(ask({ "!!": [{ fn: [] }] })).toEqual(NOTHING);
  });

  it("`reduce` with no initializer slot (entry: Just true at arity 0, 1 and 2)", () => {
    // Round 2 (Grok): `evaluateInner(args[2])` with no third slot is
    // `evaluateInner(undefined)` — the `ann` shape again, and the arity census
    // had misfiled it as a coercion.
    expect(ask({ "!": [{ reduce: [] }] })).toEqual(NOTHING);
    expect(ask({ "!": [{ reduce: [true] }] })).toEqual(NOTHING);
    expect(ask({ "!": [{ reduce: [true, true] }] })).toEqual(NOTHING);
  });

  it("the CANONICAL `fn` spelling with the body slot absent (entry: Just true)", () => {
    // Round 2 (Grok): the round-1 trip closed `{fn:[]}` and left the canonical
    // two-element form with an absent body open.
    //
    // ⚠ Round 3 (Codex) then found round 2's SPELLING was wrong: `{fn:[[]]}` is
    // not the canonical form at all — it is the FLAT form of `\ -> []`, which
    // the parser really emits, so that trip refused a live shape. `fnOp` now
    // disambiguates on ARITY (canonical always carries two elements), which
    // dissolves the false trip and fixes a pre-existing parser/evaluator
    // disagreement — see the MUST-NOT-MOVE pin.
    //
    // The genuine canonical-with-no-body has to be built INSIDE a native: a
    // trailing `undefined` does not survive the value boundary into a
    // predicate (it arrives as a one-element `fn`, i.e. the flat form, which
    // legitimately decides), so the shape is not expressible as predicate DATA.
    expect(ask({ call: ["canonicalFnNoBody"] })).toEqual(NOTHING);
  });

  it("a `let` that binds NOTHING (entry: Just true)", () => {
    // Found by extending the op-arity census to ARITY 1: `{let:[true]}` has a
    // non-record operand, so `Object.entries` yields nothing, the loop never
    // runs, and the unset initializer flows out. Same for `{let:[{}]}`.
    expect(ask({ "!": [{ let: [true] }] })).toEqual(NOTHING);
    expect(ask({ "!": [{ let: [{}] }] })).toEqual(NOTHING);
  });

  it("an `if` that takes NO branch: the 2-arg JSON-Logic form (entry: Just true)", () => {
    // Fenel's own `if … then … else` always has an else arm and still decides;
    // this is the else-less JSON-Logic shape, which `$where` still accepts. An
    // `if` with no branch to take produced nothing — Fenel has no null literal,
    // so reading its host `null` as a value is exactly the launder this row
    // exists to close. An AUTHORED null stays data — see MUST-NOT-MOVE.
    expect(ask({ "!": [{ if: [false, true] }] })).toEqual(NOTHING);
  });

  it("EAGER argument evaluation carries the abort: a failing UNUSED argument (entry: Just true)", () => {
    // `ifElse` is a std FUNCTION, so `callOp` evaluates every argument before
    // invoking — including the branch that would not have been taken. Under
    // uniform abstention that failure abstains the proof. The LAZY operator
    // form short-circuits and still decides (MUST-NOT-MOVE).
    expect(ask({ call: ["ifElse", true, true, { call: ["nope"] }] })).toEqual(NOTHING);
  });
});

// ---------------------------------------------------------------------------
// 2. THE DOORS — a failure a downstream native CATCHES still abstains
// ---------------------------------------------------------------------------

describe("mem.where.prov — the doors: a converted failure still abstains", () => {
  it("`swallowHard`: an accidental catcher turns a hard evaluator throw into `true` (entry: Just true)", () => {
    // The seam's wide catch never fires — the exception is consumed below the
    // boundary. The `evaluate` DOOR marked the frame before the catcher saw it.
    expect(ask({ call: ["swallowHard"] })).toEqual(NOTHING);
  });

  it("`swallowBrand`: catching the trip's own abort does not un-trip the frame (entry: Just false)", () => {
    expect(ask({ call: ["swallowBrand"] })).toEqual(NOTHING);
  });

  it("`viaCallable`: a native throw caught around `invokeCallable`, no `evaluate` crossed (entry: Just true)", () => {
    // The `evaluate` door alone would MISS this: `invokeCallable` reaches
    // `invokeFunction` without transiting `evaluate`, and the exception is
    // caught by the native that called it.
    expect(ask({ call: ["viaCallable"] })).toEqual(NOTHING);
  });

  it("`merge` cannot absorb it either — the `flatMap` sibling (entry: Just true)", () => {
    // Round 2 (Codex): `merge` was the one evaluating callback still handed to
    // an AST-supplied method after round 1 converted the eight `.map` sites.
    class CatchArgs extends Array {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      flatMap(cb: any, that?: unknown): any[] {
        try {
          return super.flatMap(cb, that) as unknown[];
        } catch {
          return [];
        }
      }
    }
    const hostile = new CatchArgs();
    hostile.push({ construct: ["@ctor/bad"] });
    expect(ask({ "==": [{ length: { merge: hostile } }, 0] })).toEqual(NOTHING);
    // the well-formed control still decides
    expect(ask({ "==": [{ length: { merge: [[1, 2], 3] } }, 3] })).toEqual(JUST(true));
  });

  it("`merge` flattens by INDEX — no spread, no supplied iterator (round 3)", () => {
    // Round 3 (Codex): `merged.push(...val)` inherits the host's argument-count
    // limit and consumes the inner value's ITERATOR, which a caller may
    // override. Index walks on both levels do neither.
    //
    // ⚠ Two earlier versions of this pin did NOT discriminate, and DISCRIMINATES
    // caught the second: an array LITERAL in the AST is normalised by
    // `evaluateEach` (itself an index walk) before `merge` ever sees it, so the
    // spoofed-iterator cell tested nothing. The value has to arrive from a
    // NATIVE to reach `merge` un-normalised — which is also the only shape in
    // which the argument-count limit is reachable. (200 000 elements did NOT
    // exceed this host's spread limit, so the iterator half is what this pin
    // discriminates; the argument-count half rides the same one-line fix.)
    expect(ask({ "==": [{ length: { merge: [{ call: ["spoofList"] }] } }, 2] })).toEqual(JUST(true));
    // Round 5: `flatMap` evaluates and flattens each operand IN TURN, so an
    // operand that mutates an earlier operand's array does not retroactively
    // grow it. Evaluate-all-then-flatten gave `[1,2,3]`; `flatMap` gives `[1,3]`.
    mutableFirst.length = 1;
    expect(ask({ "==": [{ length: { merge: [{ call: ["firstList"] }, { call: ["mutateFirst"] }] } }, 2] }))
      .toEqual(JUST(true));
    // ... and a SPARSE argument list skips its hole rather than manufacturing
    // an `undefined` entry (built in a native: holes do not survive the value
    // boundary into a predicate).
    expect(ask({ call: ["sparseArgsProbe"] })).toEqual(JUST(true));
    // ... and both walks SNAPSHOT their source length, as `map` / `flatMap` do:
    // an operand that appends during evaluation does not extend the walk.
    expect(ask({ call: ["lengthSnapshotProbe"] })).toEqual(JUST(true));
  });

  it("an AST-carried Array SUBCLASS cannot absorb the throw inside the file (entry: Just true)", () => {
    // Review round 1, reproduced: `argList.map(a => evaluateInner(a))` runs the
    // interpreter INSIDE a method the AST supplies. A subclass whose `map`
    // catches therefore absorbed an interpreter throw before either door saw
    // it — the one measured counterexample to "an exception raised in this file
    // exits through the door its caller entered by". `evaluateEach` walks by
    // index instead, which cannot be intercepted.
    class CatchArgs extends Array {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map(cb: any, that?: unknown): any[] {
        try {
          return super.map(cb, that) as unknown[];
        } catch {
          return [true];
        }
      }
    }
    const hostile = new CatchArgs();
    hostile.push({ construct: ["@ctor/bad"] });
    expect(ask({ "!!": hostile })).toEqual(NOTHING);
    // the plain-array control answered `Nothing` before and after
    expect(ask({ "!!": [{ construct: ["@ctor/bad"] }] })).toEqual(NOTHING);
  });

  it("the frame is CLOSED on the way out — ordinary evaluation after a proof is unaffected", () => {
    // `whereMember`'s `finally` is the only thing between a tripping membership
    // and a leaked frame that would abort every later `evaluate` in the
    // process. Review round 1 noted the cleanup had no pin of its own.
    expect(ask({ ">": [{ call: ["nope:notAFn"] }, 0] })).toEqual(NOTHING);
    expect(evaluate({ call: ["nope:notAFn"] }, {}, {})).toBe(null);
    expect(evaluate({ ">": [{ var: "noSuchField" }, 0] }, {}, {})).toBe(false);
  });

  it("round 9: the FOUR operators the round-8 hole list missed (entry: Just true)", () => {
    const hole = (n: number, ...set: [number, unknown][]): unknown[] => {
      const a: unknown[] = [];
      a.length = n;
      for (const [i, v] of set) a[i] = v;
      return a;
    };
    // `var`'s explicit-default gate (Codex AND Grok): a hole in the default
    // slot was read as an authored `undefined` default, so a missing field
    // decided instead of abstaining.
    expect(ask({ "!": [{ var: hole(2, [0, "noSuchField"]) }] })).toEqual(NOTHING);
    expect(evaluate({ var: hole(2, [0, "noSuchField"]) }, {}, {})).toBe(null);
    // ... and a REAL explicit default still names the answer.
    expect(ask({ ">": [{ var: ["obj.missing", 9] }, 0] })).toEqual(JUST(true));

    // `where`'s body slot (Codex).
    expect(ask({ "!": [{ where: hole(2, [1, {}]) }] })).toEqual(NOTHING);
    expect(ask({ where: [true, {}] })).toEqual(JUST(true));

    // `deepEq`'s arity guard (Grok): a sparse two-slot list passed
    // `length !== 2` and `deepEqual(undefined, undefined)` returned the
    // OPPOSITE definite from the dense `{deepEq:[]}`.
    expect(evaluate({ deepEq: [] }, {}, {})).toBe(false);
    expect(evaluate({ deepEq: hole(2) }, {}, {})).toBe(false);
    expect(ask({ deepEq: hole(2) })).toEqual(JUST(false));
    expect(ask({ deepEq: [1, 1] })).toEqual(JUST(true));

    // `and` / `or` walked holes with `for…of`, which YIELDS them (Grok). The
    // sparse list must answer as the list it actually is.
    expect(ask({ "!": [{ and: [] }] })).toEqual(JUST(false));
    expect(ask({ "!": [{ and: hole(1) }] })).toEqual(JUST(false));
    expect(ask({ "!": [{ or: [] }] })).toEqual(JUST(true));
    expect(ask({ "!": [{ or: hole(1) }] })).toEqual(JUST(true));
    expect(ask({ and: [true, true] })).toEqual(JUST(true));
    expect(ask({ or: [false, true] })).toEqual(JUST(true));

    // A HOLE is not a supplied ARGUMENT (Codex): `evaluateEach` preserves it
    // faithfully and the application paths then bound a formal from it.
    const lam = { fn: [["x"], { "!": [{ var: "x" }] }] };
    expect(ask({ apply: [lam, []] })).toEqual(NOTHING);
    expect(ask({ apply: [lam, hole(1)] })).toEqual(NOTHING);
    expect(ask({ apply: [lam, [true]] })).toEqual(JUST(false));
    expect(ask({ apply: [lam, [false]] })).toEqual(JUST(true));
  });

  it("round 9: two more methods the AST supplies could absorb the throw", () => {
    // `applyTypeDef`'s NON-array branch (Codex AND Grok). Round 8 kept a
    // `.map` fallback "to preserve the pre-existing TypeError" — but a
    // non-array that HAS a `map` does not throw, so the fallback was the same
    // absorber one type away.
    const hostileFields = {
      map(cb: (x: unknown) => unknown) { try { return [null].map(cb); } catch { return []; } },
    };
    const td = (fields: unknown) => ({ type_def: [{ name: "R9", constructors: [{ name: "C9", fields }] }] });
    expect(ask({ "!": [{ do: [td(hostileFields), true] }] })).toEqual(NOTHING);
    expect(ask({ "!": [{ do: [td([null]), true] }] })).toEqual(NOTHING);
    expect(ask({ "!": [{ do: [td({}), true] }] })).toEqual(NOTHING);
    // ... and a WELL-FORMED declaration still decides and still registers.
    expect(ask({
      do: [
        { type_def: { name: "R9Ok", constructors: [{ name: "R9OkC", fields: [{ name: "x" }] }] } },
        { "!!": { construct: ["R9OkC", 1] } },
      ],
    })).toEqual(JUST(true));

    // `missing`'s `args.flat()` (Grok) — an Array SUBCLASS this time, not a
    // non-array oddity, and `flat` never runs `evaluateInner`: it absorbs a
    // host exception raised while the interpreter is inside the file, which is
    // the property the door argument needs and not "does it call back".
    class CatchFlat extends Array {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      flat(...args: any[]): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        try { return (super.flat as any).apply(this, args) as any[]; } catch { return []; }
      }
    }
    const throwingAt0 = (Cls: typeof Array | typeof CatchFlat): unknown[] => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = new (Cls as any)() as unknown[];
      Object.defineProperty(a, 0, {
        get() { throw new Error("boom-in-getter"); },
        enumerable: true,
        configurable: true,
      });
      (a as { length: number }).length = 1;
      return a;
    };
    expect(ask({ "==": [{ length: { missing: throwingAt0(CatchFlat) } }, 0] })).toEqual(NOTHING);
    expect(ask({ "==": [{ length: { missing: throwingAt0(Array) } }, 0] })).toEqual(NOTHING);
    // ... and `missing` still DETECTS absent keys, including through a nested list.
    expect(ask({ "==": [{ length: { missing: ["noSuchKey"] } }, 1] })).toEqual(JUST(true));
    expect(ask({ "==": [{ length: { missing: [["noSuchKey", "alsoNo"]] } }, 2] })).toEqual(JUST(true));
  });

  it("round 9: round 8's `match` slot check moved to the arm actually TAKEN", () => {
    // Codex, a regression round 8 introduced: the result slot was validated
    // BEFORE the pattern was matched, so an arm list whose UNREACHABLE result
    // slot was absent got refused. A slot that is never read need not exist.
    const a: unknown[] = [];
    a.length = 5;
    a[0] = 1; a[1] = 2; /* a[2] is the unreachable result — a HOLE */ a[3] = 1; a[4] = true;
    expect(evaluate({ match: a }, {}, {})).toBe(true);
    expect(ask({ match: a })).toEqual(JUST(true));
    // ... while the TAKEN arm's absent result still abstains.
    const b: unknown[] = [];
    b.length = 3;
    b[0] = 1; b[1] = 1; /* b[2] — the taken arm's result — is a HOLE */
    expect(evaluate({ match: b }, {}, {})).toBe(null);
    expect(ask({ "!": [{ match: b }] })).toEqual(NOTHING);
  });

  it("round 10: a hole SPREAD back into a value (entry: an opposite definite)", () => {
    const hole = (n: number, ...set: [number, unknown][]): unknown[] => {
      const a: unknown[] = [];
      a.length = n;
      for (const [i, v] of set) a[i] = v;
      return a;
    };
    // `min` / `max` spread their operands, and spread consults the array
    // ITERATOR, which YIELDS a hole as `undefined`: `Math.min(undefined)` is
    // `NaN` where `Math.min()` is `Infinity`. The `.map(toNumber)` callback is
    // SKIPPED on a hole, so the local coercion never ran to hide it.
    expect(evaluate({ min: [] }, {}, {})).toBe(Infinity);
    expect(evaluate({ min: hole(1) }, {}, {})).toBe(Infinity);
    expect(evaluate({ max: [] }, {}, {})).toBe(-Infinity);
    expect(evaluate({ max: hole(1) }, {}, {})).toBe(-Infinity);
    expect(ask({ ">": [{ min: [] }, 0] })).toEqual(JUST(true));
    expect(ask({ ">": [{ min: hole(1) }, 0] })).toEqual(JUST(true));
    expect(ask({ ">": [{ min: hole(3, [0, 3], [2, 1]) }, 0] })).toEqual(JUST(true));
    // ... and the well-formed folds still decide.
    expect(evaluate({ min: [3, 1] }, {}, {})).toBe(1);
    expect(evaluate({ max: [3, 1] }, {}, {})).toBe(3);

    // The NOTATION operators dispatch through `BUILTIN_OP_NATIVES`, which are
    // variadic natives called by SPREAD — the same laundering, one dispatch
    // tier away, and outside the operator set round 9's census read.
    expect(evaluate({ "*": [] }, {}, {})).toBe(1);
    expect(evaluate({ "*": hole(1) }, {}, {})).toBe(1);
    expect(ask({ ">": [{ "*": [] }, 0] })).toEqual(JUST(true));
    expect(ask({ ">": [{ "*": hole(1) }, 0] })).toEqual(JUST(true));
    expect(evaluate({ "*": [3, 2] }, {}, {})).toBe(6);
    expect(evaluate({ cat: hole(1) }, {}, {})).toBe("");

    // A PARTIAL that collected a hole spread it into a full application on the
    // next call, so the second application supplied an argument nobody wrote.
    const lam2 = { fn: [["a", "b"], { "!": [{ var: "b" }] }] };
    expect(ask({ apply: [{ apply: [lam2, [true]] }, []] })).toEqual(NOTHING);
    expect(ask({ apply: [{ apply: [lam2, hole(2, [0, true])] }, []] })).toEqual(NOTHING);
    expect(ask({ apply: [{ apply: [lam2, [true]] }, [false]] })).toEqual(JUST(true));

    // `construct`'s Boolean fast path counted a hole as an argument.
    //
    // ⚠ TIGHTENED BY ROUND 12, and the distinction is deliberate. Round 10 made
    // this cell answer as the TRUNCATION reading (`{construct:["True"]}` =
    // `true`, so `== true` is `Just true`). Round 12 moved the truncation
    // BEFORE the named-vs-positional classification — which it had to, because
    // classifying on the raw length produced a value neither reading gives —
    // and truncating a STRUCTURAL FORM's operand list now trips: a hole where
    // an operand was promised means the FORM is malformed, and this phase does
    // not claim on those. Both answers satisfy the census law (abstaining is
    // "produce no value"); abstaining is the safe direction.
    //
    // `invokeFunction`'s `argsUpToFirstHole` deliberately does NOT trip: there
    // the truncation reading of an ARGUMENT list is well defined (`{"*":<one
    // hole>}` answers as `{"*":[]}`), and it sits on the hot path.
    expect(ask({ "==": [{ construct: ["True"] }, true] })).toEqual(JUST(true));
    expect(ask({ "==": [{ construct: hole(2, [0, "True"]) }, true] })).toEqual(NOTHING);

    // The BITWISE family and `var` / `missing_some` read an absent operand
    // through a coercion — found by the widened census, not by a reviewer.
    expect(evaluate({ "|": hole(3, [1, 1], [2, 4]) }, {}, {})).toBe(null);
    expect(evaluate({ "^": hole(3, [1, 1], [2, 4]) }, {}, {})).toBe(null);
    expect(evaluate({ "&": [6, 3] }, {}, {})).toBe(2);
    expect(evaluate({ var: hole(3, [1, 1], [2, 4]) }, {}, {})).toBe(null);
    expect(ask({ ">": [{ var: ["obj.missing", 9] }, 0] })).toEqual(JUST(true));
  });

  it("round 10: `deepEq` is EXACT-arity again, and evaluates nothing when it is not", () => {
    // A round-9 regression: replacing the exact-arity test with a presence test
    // stopped rejecting EXTRAS, so the operator began evaluating its operands
    // and answering `true` where it had answered `false` without evaluating.
    let calls = 0;
    const c: EvaluateContext = { ...ctx, natives: { ...(ctx.natives ?? {}), probe: () => { calls++; return 1; } } };
    calls = 0;
    expect(evaluate({ deepEq: [{ call: ["probe"] }, { call: ["probe"] }, 0] }, {}, c)).toBe(false);
    expect(calls).toBe(0);
    // ... and the two-operand form still decides.
    expect(evaluate({ deepEq: [1, 1] }, {}, {})).toBe(true);
    expect(evaluate({ deepEq: [1, 2] }, {}, {})).toBe(false);
  });

  it("round 10: `and` / `or` observe an operand appended mid-walk, as `for…of` did", () => {
    // The other round-9 regression: the hole skip was intended, the LENGTH
    // SNAPSHOT that came with it was not. `for…of` read the list live.
    const growing: unknown[] = [{ call: ["grow"] }];
    const c: EvaluateContext = {
      ...ctx,
      natives: { ...(ctx.natives ?? {}), grow: () => { growing.push(false); return true; } },
    };
    growing.length = 1;
    expect(evaluate({ and: growing }, {}, c)).toBe(false);
    // ... and the hole skip, which WAS intended, still holds.
    const h: unknown[] = [];
    h.length = 1;
    expect(ask({ "!": [{ and: h }] })).toEqual(JUST(false));
    expect(ask({ and: [true, true] })).toEqual(JUST(true));
  });

  it("round 10: a catching `includes` cannot absorb the throw either", () => {
    // Round 9 classified `includes` as unable to absorb "because it takes no
    // callback". `flat` had already refuted that reading in the same round; the
    // class label just did not carry it across.
    class CatchIncludes extends Array {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      includes(...a: any[]): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        try { return (super.includes as any).apply(this, a) as boolean; } catch { return true; }
      }
    }
    const mk = (Cls: typeof Array | typeof CatchIncludes): unknown[] => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = new (Cls as any)() as unknown[];
      Object.defineProperty(a, 0, {
        get() { throw new Error("boom-getter"); },
        enumerable: true,
        configurable: true,
      });
      (a as { length: number }).length = 1;
      return a;
    };
    const plain: EvaluateContext = { ...ctx, natives: { ...(ctx.natives ?? {}), arr: () => mk(Array) } };
    const catcher: EvaluateContext = { ...ctx, natives: { ...(ctx.natives ?? {}), arr: () => mk(CatchIncludes) } };
    expect(contains(where({ in: [1, { call: ["arr"] }] }), 5, null, undefined, plain)).toEqual(NOTHING);
    expect(contains(where({ in: [1, { call: ["arr"] }] }), 5, null, undefined, catcher)).toEqual(NOTHING);
    // ... and `in` still decides on ordinary arrays and strings.
    expect(ask({ in: [1, [1, 2]] })).toEqual(JUST(true));
    expect(ask({ in: [9, [1, 2]] })).toEqual(JUST(false));
    expect(ask({ in: ["ell", "hello"] })).toEqual(JUST(true));
  });

  it("round 11: two spread sites upstream of the truncation boundary", () => {
    const hole = (n: number, ...set: [number, unknown][]): unknown[] => {
      const a: unknown[] = [];
      a.length = n;
      for (const [i, v] of set) a[i] = v;
      return a;
    };
    // (a) A PARTIAL arriving as a VALUE — crafted, or persisted. Round 10
    // closed this only for partials BUILT by `invokeFunction`, whose
    // `collected` is dense; `[...collected, ...evaluatedArgs]` spread any other
    // one, and spread yields a hole as a present `undefined` the entry
    // truncation can no longer see. The two routes to the same partial
    // disagreed: `Just true` against the door route's `Nothing`.
    const lam2 = { fn: [["a", "b"], { "!": [{ var: "b" }] }] };
    const built = evaluate(lam2, {}, {});
    const c: EvaluateContext = {
      ...ctx,
      natives: {
        ...(ctx.natives ?? {}),
        mkPartial: () => ({ __fenelPartial: true, fn: built, collected: hole(2, [0, true]), arity: 2 }),
        mkDense: () => ({ __fenelPartial: true, fn: built, collected: [true, false], arity: 2 }),
      },
    };
    expect(contains(where({ apply: [{ call: ["mkPartial"] }, []] }), 5, null, undefined, c)).toEqual(NOTHING);
    expect(contains(where({ apply: [{ apply: [lam2, hole(2, [0, true])] }, []] }), 5, null, undefined, c)).toEqual(NOTHING);
    // ... and a DENSE crafted partial still applies and decides.
    expect(contains(where({ apply: [{ call: ["mkDense"] }, []] }), 5, null, undefined, c)).toEqual(JUST(true));

    // (b) `pipe`'s step destructuring. `const [fnName, ...extras] = step`
    // consults the array iterator, so the extras were dense before
    // `invokeFunction` — a VALID step whose extras carry a hole passed an
    // argument nobody wrote.
    expect(evaluate({ pipe: [2, hole(3, [0, "*"], [2, 3])] }, {}, {})).toBe(2);
    expect(evaluate({ pipe: [2, ["*", 3]] }, {}, {})).toBe(6);
  });

  it("`in` follows structural `eq` on NaN (recipe-functions S1 — a DELIBERATE flip)", () => {
    // Round 11 pinned SameValueZero here (`[NaN].includes(NaN)`), so that
    // round 10's index walk would not flip the answer UNDECLARED. S1 (ledger
    // §4/§12) flips it on purpose and says so: the array arm of `in` is now
    // the one value equality, `structuralEq` (std `eq` / `includes` / `elem`),
    // and NaN ≠ NaN, so `NaN in [NaN]` is a definite `false`.
    const c: EvaluateContext = {
      ...ctx,
      natives: {
        ...(ctx.natives ?? {}), nan: () => NaN, nanArr: () => [NaN],
        butter: () => ({ $tag: "Butter" }), butters: () => [{ $tag: "Butter" }],
      },
    };
    expect(contains(where({ in: [{ call: ["nan"] }, { call: ["nanArr"] }] }), 5, null, undefined, c))
      .toEqual(JUST(false));
    // ... and a separately built constructor IS found (it was not, by reference).
    expect(contains(where({ in: [{ call: ["butter"] }, { call: ["butters"] }] }), 5, null, undefined, c))
      .toEqual(JUST(true));
    // ... and the ordinary cells are unchanged.
    expect(ask({ in: [1, [1, 2]] })).toEqual(JUST(true));
    expect(ask({ in: [9, [1, 2]] })).toEqual(JUST(false));
    expect(ask({ in: ["ell", "hello"] })).toEqual(JUST(true));
    // a hole in the NEEDLE slot no longer stringifies to "undefined"
    const h: unknown[] = [];
    h.length = 2;
    h[1] = "undefined";
    expect(evaluate({ in: h }, {}, {})).toBe(null);
  });

  it("round 11: the operand-list rule reaches `deepEq`, `method`, `construct`, `fn`", () => {
    const hole = (n: number, ...set: [number, unknown][]): unknown[] => {
      const a: unknown[] = [];
      a.length = n;
      for (const [i, v] of set) a[i] = v;
      return a;
    };
    // `deepEq`'s exact-arity test counted a TRAILING hole, so it refused a list
    // whose BOTH honest readings are `[7,7]` = `true`.
    expect(evaluate({ deepEq: hole(3, [0, 7], [1, 7]) }, {}, {})).toBe(true);
    expect(evaluate({ deepEq: [7, 7] }, {}, {})).toBe(true);
    expect(evaluate({ deepEq: [7, 7, 7] }, {}, {})).toBe(false);
    // `method` coerced a hole to the literal class name "undefined" and baked
    // it into a reified eta-closure.
    expect(evaluate({ method: hole(2, [1, "m"]) }, {}, {})).toBe(null);
    // `construct`'s positional payload SKIPPED a hole while keeping the index,
    // binding `_1` with no `_0` — a value neither honest reading produces.
    expect(evaluate({ construct: hole(3, [0, "P"], [2, "c"]) }, {}, {}))
      .toEqual({ $tag: "P" });
    expect(evaluate({ construct: ["P", "c"] }, {}, {})).toEqual({ $tag: "P", _0: "c" });
    // `fn`'s operand list truncates as a whole, so the flat/canonical reading
    // then applies to what remains — this is what retired the census's `fn`
    // exemption.
    expect(ask({ "!": [{ apply: [{ fn: hole(2, [1, { var: "undefined" }]) }, [true]] }] }))
      .toEqual(NOTHING);
  });

  it("round 11: the array combinators skip holes, as `merge` already did", () => {
    // `for…of` YIELDS a hole as `undefined`, so an absent element became a
    // WITNESS: `some` found one where native `.some` finds none.
    const arr: unknown[] = [];
    arr.length = 3;
    arr[0] = 1;
    arr[2] = 3;
    const c: EvaluateContext = { ...ctx, natives: { ...(ctx.natives ?? {}), arr: () => arr } };
    expect(evaluate({ some: [{ call: ["arr"] }, { "!": [{ var: "" }] }] }, {}, c)).toBe(false);
    expect(evaluate({ reduce: [{ call: ["arr"] }, { "+": [{ var: "accumulator" }, 1] }, 0] }, {}, c)).toBe(2);
    expect(evaluate({ merge: [{ call: ["arr"] }] }, {}, c)).toEqual([1, 3]);
    expect(evaluate({ map: [{ call: ["arr"] }, { var: "" }] }, {}, c)).toEqual([1, 3]);
    // ... and the dense combinators are unchanged.
    expect(ask({ "==": [{ length: { map: [[1, 2, 3], { var: "" }] } }, 3] })).toEqual(JUST(true));
    expect(ask({ some: [[1, 2], { ">": [{ var: "" }, 1] }] })).toEqual(JUST(true));
  });

  it("round 12: the spec's Call, a leaked length, and a catching ITERATOR", () => {
    const hole = (n: number, ...set: [number, unknown][]): unknown[] => {
      const a: unknown[] = [];
      a.length = n;
      for (const [i, v] of set) a[i] = v;
      return a;
    };
    // (1) was "`ToPrimitive` must CALL the converter rather than read its
    // `.call` property". **RETIRED BY ROUND 12b** — see the dedicated pin
    // below: the interpreter no longer invokes a caller-supplied converter at
    // all, so there is nothing left to call correctly.

    // (2) A non-integral length must not LEAK past the argument normalizer.
    // `argsUpToFirstHole` returned the source UNCHANGED when it was dense, so
    // the arity comparisons downstream read `1.5` directly and invented a
    // leftover argument to eta-apply.
    const argsProxy = new Proxy([123], {
      get(t, k, r) { return k === "length" ? 1.5 : Reflect.get(t, k, r); },
    }) as unknown as unknown[];
    const lam = { fn: [["x"], { fn: [[], true] }] };
    const c: EvaluateContext = {
      ...ctx,
      natives: { ...(ctx.natives ?? {}), argv: () => argsProxy, dense: () => [123] },
    };
    expect(contains(where({ apply: [lam, { call: ["argv"] }] }), 5, null, undefined, c)).toEqual(NOTHING);
    expect(contains(where({ apply: [lam, { call: ["dense"] }] }), 5, null, undefined, c)).toEqual(NOTHING);

    // (3) A hole INSIDE a canonical `fn` param vector became the property key
    // `"undefined"` — a formal nobody wrote. Every census pattern plants its
    // hole at the TOP level, so the vector was invisible to it.
    expect(ask({ apply: [{ fn: [hole(3, [0, "x"], [2, "z"]), { var: "undefined" }] }, [false, true, false]] }))
      .toEqual(NOTHING);
    expect(ask({ apply: [{ fn: [["x", "z"], { var: "z" }] }, [false, true]] })).toEqual(JUST(true));

    // (4) `construct` classified named-vs-positional on the RAW length, so a
    // trailing hole took the POSITIONAL arm and produced `{$tag:"P",_0:{x:1}}`
    // where both honest readings take the NAMED arm.
    expect(evaluate({ construct: ["P", { x: 1 }] }, {}, {})).toEqual({ $tag: "P", x: 1 });
    expect(evaluate({ construct: hole(3, [0, "P"], [1, { x: 1 }]) }, {}, {}))
      .toEqual({ $tag: "P", x: 1 });

    // (5) A CATCHING ITERATOR absorbs. The old class label reasoned that
    // `for…of` cannot catch a body throw — true, and beside the point: an
    // element GETTER throws during `next()`, and an iterator that catches there
    // substitutes a value and continues.
    const mkArr = (catching: boolean): unknown[] => {
      const a: unknown[] = [];
      Object.defineProperty(a, 0, {
        get() { throw new Error("boom-slot0"); },
        enumerable: true,
        configurable: true,
      });
      a[1] = true;
      a.length = 2;
      if (catching) {
        Object.defineProperty(a, Symbol.iterator, {
          value: function* () {
            try { yield (a as unknown[])[0]; } catch { yield { class: "X", args: [], methods: {} }; }
            yield (a as unknown[])[1];
          },
          configurable: true,
        });
      }
      return a;
    };
    expect(ask({ withInstance: mkArr(false) })).toEqual(NOTHING);
    expect(ask({ withInstance: mkArr(true) })).toEqual(NOTHING);

    // (6) `spec.params.map` ran the interpreter's own `p.name` read inside a
    // registry-supplied method. The REGISTRY class label was about PROVENANCE;
    // absorbing is a property of the METHOD.
    class CatchMap extends Array {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map(cb: any, that?: unknown): any[] {
        try { return super.map(cb, that) as unknown[]; } catch { return []; }
      }
    }
    const specCtx = (Cls: typeof Array | typeof CatchMap): EvaluateContext => ({
      ...ctx,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getFunction: (n: string) => (n === "f" ? ({ id: "f", params: (Cls as any).from([null]), returns: {} } as any) : undefined),
      natives: { ...(ctx.natives ?? {}), f: () => true },
    });
    expect(contains(where({ "!!": { call: ["f", { x: 1 }] } }), 5, null, undefined, specCtx(Array))).toEqual(NOTHING);
    expect(contains(where({ "!!": { call: ["f", { x: 1 }] } }), 5, null, undefined, specCtx(CatchMap))).toEqual(NOTHING);
  });

  it("round 12b: `toLength` invokes NO caller-supplied method — the rule that won", () => {
    // ⚠ THIS PIN REPLACES THREE — rounds 9, 10 and 11's `toLength` cells — AND
    // ONE BULLET OF ROUND 12's, because they were pinning the WRONG RULE.
    //
    // Those rounds progressively made `toLength` faithful to the spec, which is
    // `ToNumber` after `ToPrimitive` — and `ToPrimitive` on an object INVOKES
    // that object's own `Symbol.toPrimitive` / `valueOf` / `toString`. CENSUS B
    // forbids exactly that everywhere else in this file. The two rules cannot
    // both hold. Nobody noticed — three reviewers included — until the identity
    // chain's resolver generator blew its stack, which bisected to round 12's
    // `Reflect.apply` change: it began genuinely invoking converters that the
    // compilation pipeline reaches, and one of them re-enters the evaluator.
    //
    // The no-caller-code rule wins. Its STRONG form is measurable, so that is
    // what this pins: over an array-like whose length object offers all three
    // converters, the interpreter invokes NONE of them.
    let calls = 0;
    const counting = new Proxy([7, 8], {
      get(t, k, r) {
        if (k !== "length") return Reflect.get(t, k, r);
        return {
          valueOf: () => { calls++; return 1; },
          toString: () => { calls++; return "1"; },
          [Symbol.toPrimitive]: () => { calls++; return 1; },
        } as unknown;
      },
    }) as unknown as unknown[];
    calls = 0;
    expect(evaluate(counting, {}, {})).toEqual([]);
    expect(calls).toBe(0);

    // A length we may not measure without caller code has no elements we may
    // read — the TRUNCATION reading at index 0, which the hole census already
    // admits as honest. Every object-valued length answers the same way.
    const mk = (len: unknown): unknown[] =>
      new Proxy([7, 8], {
        get(t, k, r) { return k === "length" ? len : Reflect.get(t, k, r); },
      }) as unknown as unknown[];
    expect(evaluate(mk({ valueOf: () => ({}), toString: () => "2" }), {}, {})).toEqual([]);
    expect(evaluate(mk({ [Symbol.toPrimitive]: () => 2, valueOf: () => 1 }), {}, {})).toEqual([]);
    expect(evaluate(mk(Object(1n)), {}, {})).toEqual([]);

    // PRIMITIVE lengths still convert, because no caller code runs to do it —
    // so round 8's fractional cell and round 9's BigInt refusal both SURVIVE.
    expect(evaluate(mk(1.5), {}, {})).toEqual([7]);
    expect(evaluate(mk("2"), {}, {})).toEqual([7, 8]);
    expect(() => evaluate(mk(1n), {}, {})).toThrow();
    expect(ask({ "!": [mk(1n)] })).toEqual(NOTHING);

    // DECLARED MOVEMENT, priced: round 10 pinned `Object(1n)` as abstaining,
    // because reaching inside the box made the BigInt refusal fire. Reaching
    // inside the box IS caller code, so it now reports an unmeasurable length
    // and walks nothing — a definite where native `map` throws. That is the
    // price of the rule, and it is one exotic cell.
    expect(ask({ "!": [mk(Object(1n))] })).toEqual(JUST(false));
  });

  it("CENSUS: a HOLE is never read as a VALUE, over every operator", () => {
    // Round 9 stated the rule and checked it with an all-holes table compared
    // by `JSON.stringify`. Round 10 (Codex AND Grok, independently) broke that
    // fence twice over, which is exactly what a fence is for:
    //
    //  (a) `JSON.stringify` renders `NaN`, `Infinity` and `-Infinity` all as
    //      `"null"`, so `{min:<one hole>}` = `NaN` compared EQUAL to
    //      `{min:[]}` = `Infinity` — while `{">":[{min:<one hole>},0]}` was
    //      `Just false` against the empty list's `Just true`. The census was
    //      green on a live opposite definite.
    //  (b) it read only `KNOWN_OPS`, and the notation operators dispatch
    //      through `BUILTIN_OP_NATIVES` instead — `{"*":<one hole>}` was `0`
    //      against `{"*":[]}` = `1`, flipping the same comparison.
    //
    // Both are fixed, and the LAW is stronger than "answers as the empty list",
    // which was only ever the all-holes case. A hole is an operand that is not
    // there, and there are exactly two honest readings of that: the operand is
    // REMOVED, or the operand list STOPS. The evaluator may take either — what
    // it may not do is read the hole as a value. So: the outcome must fail,
    // produce no value, or agree with one of those two readings. Nothing else
    // is admissible, and `undefined`-as-a-value agrees with neither.
    const src = readFileSync(join(import.meta.dirname, "json-logic.ts"), "utf8");
    const sf = ts.createSourceFile("json-logic.ts", src, ts.ScriptTarget.Latest, true);
    const setLiteral = (name: string): string[] => {
      let out: string[] | undefined;
      const visit = (n: ts.Node): void => {
        if (
          ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name
          && n.initializer !== undefined && ts.isNewExpression(n.initializer)
          && n.initializer.arguments !== undefined && n.initializer.arguments.length === 1
          && ts.isArrayLiteralExpression(n.initializer.arguments[0]!)
        ) {
          out = (n.initializer.arguments[0] as ts.ArrayLiteralExpression).elements
            .filter(ts.isStringLiteral).map((e) => e.text);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      expect(out).toBeDefined();
      return out!;
    };
    const recordKeys = (name: string): string[] => {
      let out: string[] | undefined;
      const visit = (n: ts.Node): void => {
        if (
          ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name
          && n.initializer !== undefined && ts.isObjectLiteralExpression(n.initializer)
        ) {
          out = n.initializer.properties.flatMap((p) => {
            const nm = p.name;
            if (nm === undefined) return [];
            if (ts.isIdentifier(nm) || ts.isStringLiteral(nm)) return [nm.text];
            return [];
          });
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      expect(out).toBeDefined();
      return out!;
    };
    // BOTH dispatch tables, read from the source, so neither a new `applyOp`
    // case nor a new notation native can skip the law.
    const ops = [...new Set([...setLiteral("KNOWN_OPS"), ...recordKeys("BUILTIN_OP_NATIVES")])];
    expect(ops.length).toBeGreaterThan(60);

    type Outcome = { threw: true } | { threw: false; value: unknown };
    const run = (rule: unknown): Outcome => {
      try { return { threw: false, value: evaluate(rule, {}, {}) }; } catch { return { threw: true }; }
    };
    // `Object.is` at the leaves — this is the half round 9 got wrong.
    const sameValue = (a: unknown, b: unknown): boolean => {
      if (Object.is(a, b)) return true;
      if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
      if (Array.isArray(a) !== Array.isArray(b)) return false;
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
          if ((i in a) !== (i in b)) return false;
          if (i in a && !sameValue(a[i], b[i])) return false;
        }
        return true;
      }
      const ka = Object.keys(a as object);
      const kb = Object.keys(b as object);
      if (ka.length !== kb.length) return false;
      for (const k of ka) {
        if (!kb.includes(k)) return false;
        if (!sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
      }
      return true;
    };
    const same = (x: Outcome, y: Outcome): boolean =>
      x.threw ? y.threw : !y.threw && sameValue(x.value, y.value);

    // All-holes at three arities, PLUS a single hole at each position of
    // SEVERAL dense vectors.
    //
    // Round 11 (Codex AND Fable, independently): round 10 used ONE numeric
    // vector, `[3,1,4]`, and both offenders it missed hid behind exactly that
    // choice — `{construct:[3,…]}` throws (a number has no `startsWith`) so the
    // census skipped the row, and `method`'s hole-as-`"undefined"` needs a
    // STRING head to be visible. A single probe vector is a sampling
    // assumption, and the law is not about numbers.
    //
    // Round 11 also RETIRES the blanket `fn` exemption round 9 wrote: Codex
    // showed `fn` violating the law (a hole in a param slot became the literal
    // formal name `"undefined"`), so the exemption was hiding a defect rather
    // than describing one. `fn` now satisfies the law like everything else —
    // its param vector truncates at a hole and an absent body defaults to
    // `null`, which is what `{fn:[]}` produces.
    const patterns: Array<{ label: string; sparse: unknown[]; removed: unknown[]; truncated: unknown[] }> = [];
    for (const k of [1, 2, 3]) {
      const sparse: unknown[] = [];
      sparse.length = k;
      patterns.push({ label: `all-holes x${k}`, sparse, removed: [], truncated: [] });
    }
    const VECTORS: unknown[][] = [
      [3, 1, 4],
      ["a", "b", "c"],
      ["undefined", "undefined"],
      [true, false],
      [{ x: 1 }, [2]],
    ];
    for (const dense of VECTORS) {
      for (let i = 0; i < dense.length; i++) {
        const sparse: unknown[] = [];
        sparse.length = dense.length;
        for (let j = 0; j < dense.length; j++) if (j !== i) sparse[j] = dense[j];
        patterns.push({
          label: `hole at ${i} of ${JSON.stringify(dense)}`,
          sparse,
          removed: dense.filter((_, j) => j !== i),
          truncated: dense.slice(0, i),
        });
      }
    }

    const offenders: string[] = [];
    for (const op of ops) {
      for (const p of patterns) {
        const got = run({ [op]: p.sparse });
        if (got.threw || got.value === null) continue;
        if (same(got, run({ [op]: p.removed }))) continue;
        if (same(got, run({ [op]: p.truncated }))) continue;
        offenders.push(`${op} / ${p.label} -> ${String(got.value)}`);
      }
    }

    // Round 12 (Codex): every pattern above plants its hole at the TOP level of
    // the operand list, and `fn`'s CANONICAL arm passes the param VECTOR
    // through as one operand — so a hole INSIDE that vector was invisible to
    // the census, and became the property key `"undefined"` when the closure
    // was applied. A form that takes a LIST as an operand needs the law applied
    // one level in as well. `fn` is the only such form in the operator set; the
    // cell is written out rather than generated, because the reading that makes
    // it meaningful is "apply the closure", not "evaluate the form".
    const nested = (params: unknown): unknown =>
      ({ apply: [{ fn: [params, { var: "undefined" }] }, [false, true, false]] });
    const holeIn: unknown[] = [];
    holeIn.length = 3;
    holeIn[0] = "x";
    holeIn[2] = "z";
    for (const reading of [["x", "z"], ["x"]]) {
      const honest = run(nested(reading));
      const sparseRun = run(nested(holeIn));
      if (!sparseRun.threw && sparseRun.value !== null && same(sparseRun, honest)) break;
    }
    expect(evaluate(nested(holeIn), {}, {})).toBe(null);

    expect(offenders).toEqual([]);
  });

  describe("metadata observations retain proof provenance", () => {
    const source: FenelFunction = { id: "metadata:source", params: [], returns: { $ref: "Boolean" }, body: true };
    const observations = (failure: Error): Array<{ read: () => unknown; fallback: unknown }> => [
      { read: () => runtimeFunctionRouteIsDirect({ _routingTable: () => { throw failure; } }, "metadata:target"), fallback: false },
      { read: () => runtimeSourceDependencyPrecheckIsTrivial({
        _typeFamilyOwner: () => { throw failure; },
      }, source, source), fallback: false },
      { read: () => reflectionInvocationRoute({ getFunction: () => { throw failure; } }, source.id), fallback: undefined },
    ];

    it("keeps unreadable-metadata fallbacks outside a proof and ordinary positive observations", () => {
      // Initialize the served resolver before testing its direct-route observation.
      expect(contains(where({ deepEq: [1, 1] }), 1, null)).toEqual(JUST(true));
      for (const observation of observations(new Error("unreadable metadata"))) {
        expect(observation.read()).toBe(observation.fallback);
      }
      expect(runtimeFunctionRouteIsDirect({ _routingTable: () => ({ routeIdx: {} }) }, source.id)).toBe(true);
      expect(runtimeSourceDependencyPrecheckIsTrivial({}, source, source)).toBe(true);
      expect(reflectionInvocationRoute({ getFunction: () => source }, source.id)).toEqual({ kind: "body", params: [] });
    });

    it("abstains when a host native catches a metadata failure and returns true", () => {
      const failure = new Error("caught metadata failure");
      for (const observation of observations(failure)) {
        let caught: unknown;
        const reader: EvaluateContext = { natives: {
          observeMetadata: () => {
            try { observation.read(); } catch (error) { caught = error; }
            return true;
          },
        } };
        expect(contains(where({ call: ["observeMetadata"] }), 1, null, undefined, reader)).toEqual(NOTHING);
        expect(caught).toBe(failure);
      }
    });

    it("marks the active frame before rethrowing the identical original exception", () => {
      const failure = new Error("original metadata exception");
      for (const observation of observations(failure)) {
        const proof = beginWhereProofFrame();
        try {
          let caught: unknown;
          try { observation.read(); } catch (error) { caught = error; }
          expect(caught).toBe(failure);
          expect(proof.tripped).toBe(true);
        } finally {
          endWhereProofFrame(proof);
        }
        expect(observation.read()).toBe(observation.fallback);
      }
      expect(evaluate({ call: ["metadata:unavailable"] })).toBe(null);
    });

    it("consumes a nested metadata failure without marking the enclosing proof", () => {
      const failure = new Error("nested metadata exception");
      for (const observation of observations(failure)) {
        const inner: EvaluateContext = { natives: {
          observeMetadata: () => {
            try { observation.read(); } catch {}
            return true;
          },
        } };
        const outer: EvaluateContext = { natives: {
          innerResult: () => contains(where({ call: ["observeMetadata"] }), 1, null, undefined, inner),
        } };
        const predicate = { match: [{ call: ["innerResult"] }, { $tag: "Nothing" }, true, "_", false] };
        expect(contains(where(predicate), 1, null, undefined, outer)).toEqual(JUST(true));
      }
    });

    it("reads source parameter-owner metadata without a supplied catching iterator", () => {
      const parameter = { key: { $tag: "PositionalField", index: 0 }, name: "x", label: NOTHING,
        type: { $ref: "Number" }, meta: {}, ui: NOTHING } as FenelFunction["params"][number];
      const reader = (catching: boolean): EvaluateContext => {
        let reads = 0;
        const params: FenelFunction["params"] = [];
        Object.defineProperty(params, "0", { configurable: true, enumerable: true, get() {
          if (++reads >= 3) throw new Error("parameter owner metadata is unreadable");
          return parameter;
        } });
        if (catching) Object.defineProperty(params, Symbol.iterator, {
          value: function* (this: FenelFunction["params"]) {
            try { yield this[0]!; } catch {}
          },
        });
        const fn: FenelFunction = { id: "metadata:parameter", params, returns: { $ref: "Boolean" }, body: true };
        return { getFunction: name => name === fn.id ? fn : undefined };
      };
      const predicate = where({ call: ["metadata:parameter", 1] });
      expect(contains(predicate, 1, null, undefined, reader(false))).toEqual(NOTHING);
      expect(contains(predicate, 1, null, undefined, reader(true))).toEqual(NOTHING);
    });

    it("observes supplied hook bodies without consulting their mutable call property", () => {
      let diverted = 0;
      const lookup = () => source;
      const classify = () => ({ kind: "direct" as const });
      const familyOwner = () => undefined;
      for (const hook of [lookup, classify, familyOwner]) Object.defineProperty(hook, "call", {
        value: () => { diverted++; throw new Error("a hook's own call property is not invocation"); },
      });
      const reader: EvaluateContext = { getFunction: lookup, _resolveBareName: classify, _typeFamilyOwner: familyOwner };
      expect(reflectionInvocationRoute(reader, source.id)).toEqual({ kind: "body", params: [] });
      expect(diverted).toBe(0);
    });
  });

  it("CENSUS: every way this file consumes a caller-supplied collection", () => {
    // Round 9 enumerated array-METHOD calls and classified each receiver. Round
    // 10 (Codex) refuted one of the classes and (Grok) named what the shape
    // could not see:
    //
    //  (a) class (e), "no callback, so it cannot absorb", is FALSE. An `Array`
    //      subclass whose `includes` catches swallowed a throwing element
    //      getter, and `{in:[1,<that array>]}` returned `Just true` where the
    //      plain array abstained. `flat` had already shown in round 9 that
    //      absorbing does not require accepting a callback; the class label
    //      simply did not carry that lesson across. Both `includes` calls on
    //      caller data are index walks now, and the class is GONE.
    //  (b) the walk saw named method calls only — not `for…of`, not spread,
    //      not `Symbol.iterator`, not `X.call(...)`, not `x["map"](...)`.
    //      `for…of` is precisely the form round 9's own `and`/`or` defect lived
    //      in, so the fence could not have caught the bug the same round fixed.
    //
    // Both iteration forms are enumerated here too. As before, the table does
    // not prove a receiver is safe — it forces somebody to say which class it
    // is, and a new site fails until they do.
    const src = readFileSync(join(import.meta.dirname, "json-logic.ts"), "utf8");
    const sf = ts.createSourceFile("json-logic.ts", src, ts.ScriptTarget.Latest, true);
    const ARRAY_METHODS = new Set([
      "map", "flat", "flatMap", "filter", "slice", "forEach", "reduce", "reduceRight",
      "some", "every", "find", "findIndex", "findLast", "concat", "join", "sort",
      "reverse", "at", "includes", "indexOf", "lastIndexOf", "fill", "copyWithin",
      "splice", "push", "pop", "shift", "unshift", "toSorted", "toReversed",
      "toSpliced", "with", "entries", "keys", "values",
    ]);
    // Static namespaces are not array receivers. `Array.isArray` takes its
    // subject as an ARGUMENT and consults no method on it.
    const GLOBALS = new Set(["Object", "Reflect", "JSON", "Math", "String", "Number", "Promise", "Array"]);
    const found: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const recv = n.expression.expression.getText(sf);
        const name = n.expression.name.text;
        if (ARRAY_METHODS.has(name) && !GLOBALS.has(recv)) found.push(`${recv}.${name}`);
        // `.call` / `.apply` reach the same methods with an arbitrary receiver.
        if (name === "call" || name === "apply") found.push(`«${recv}».${name}`);
        // `Array.from(x, cb)` runs a callback over caller data.
        if (recv === "Array" && name !== "isArray") found.push(`Array.${name}`);
      }
      // A computed method call hides the name from the scan above.
      if (ts.isCallExpression(n) && ts.isElementAccessExpression(n.expression)) {
        found.push(`«computed-call» ${n.expression.getText(sf)}`);
      }
      // ITERATION — the class round 9's `and`/`or` defect lived in.
      if (ts.isForOfStatement(n)) found.push(`for-of ${n.expression.getText(sf)}`);
      if (ts.isSpreadElement(n)) found.push(`spread ...${n.expression.getText(sf)}`);
      // Round 11 (Fable): ARRAY DESTRUCTURING consumes a collection through its
      // iterator too, and the fence could not see it — which is where
      // `pipeOp`'s `const [fnName, ...extras] = step` lived, the site that
      // densified a hole before `invokeFunction` could truncate it. The
      // downstream `spread ...extras` WAS in the table; the consumption that
      // produced it was not.
      // Only a destructuring WITH an initializer consumes a collection here; a
      // `for (const [k,v] of …)` loop variable destructures the ENTRY, and the
      // collection it came from is already counted by its `for-of` row.
      if (ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.initializer !== undefined) {
        found.push(`destructure [] = ${n.initializer.getText(sf)}`);
      }
      if (
        ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isArrayLiteralExpression(n.left)
      ) {
        found.push(`destructure-assign [] = ${n.right.getText(sf)}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    found.sort();

    // CLASSES:
    //  (a) LOCAL       — an array this file just built.
    //  (b) SPREAD-REST — a `(...args)` rest parameter: always a fresh plain
    //                    array however it was called.
    //  (c) FRESH       — the direct result of `Object.keys` / `Object.entries`
    //                    / `evaluateEach` / a local builder.
    //  (d) REGISTRY    — a registered function spec or ctx table, not a
    //                    `$where` predicate.
    //  (e) STRING      — a string primitive, whose methods cannot be overridden.
    //  (f) AST/VALUE, FIDELITY-ONLY — the receiver IS caller data, but the form
    //                    cannot ABSORB an exception: `for…of` does not catch a
    //                    body throw (a throwing `return()` replaces the error
    //                    and still throws), and spread has no handler. A hostile
    //                    iterator can change WHAT is iterated, which is the
    //                    caller's own data; it cannot turn a failure into a
    //                    verdict. Argument lists additionally pass through
    //                    `argsUpToFirstHole` at the single `invokeFunction`
    //                    boundary.
    //
    // There is deliberately NO class for "caller-supplied receiver running a
    // callback, or catching". That is the class rounds 1, 8, 9 and 10 each
    // found again, and it is empty.
    const EXPECTED: Record<string, number> = {
      // (a) LOCAL — an array this file just built
      "callArgs.push": 2, "flattened.push": 2, "keys.push": 1, "lambdaParams.push": 1,
      // `out.push` went 5 → 6 at type-substrate P1(a.20): `canonicalWireList`
      // builds the constructor-table copy into a local `out`, one element per
      // own indexed descriptor. Class (a) — an array this file just built.
      // 6 → 7 at modules-as-values Phase 2d: `routingArgsValue` copies a row's
      // or block frame's type arguments into a local `out`, by index over own
      // data descriptors (a frame's `args` are caller data).
      "merged.push": 4, "names.push": 1, "out.push": 7, "paramNames.push": 1,
      "results.push": 2, "trace.push": 1,
      // Private observer storage and the reflection observer's validated-name
      // builder are local arrays. The routing precedence loops use fresh
      // source literals; no caller collection or callback is iterated.
      "evaluationStepObservers.push": 1, "params.push": 1,
      "for-of [\n      [\"context\", context, contextActs], [\"plain\", plain, plainActs],\n    ] as const": 1,
      "for-of [id, name]": 1,
      "whereProofFrames.push": 1, "whereProofFrames.lastIndexOf": 1,
      // `closureLexicalImports` copies a closure's `lexicalImports` into a local
      // `frames`, one element per own indexed data descriptor — the
      // `canonicalWireList` walk.
      "frames.push": 1,
      // `for-of parts` went 1 → 0 at modules-as-values Phase 1: `resolveVar`
      // walks its path segments by index to record where a miss happened.
      "for-of routes": 1, "for-of keys": 2, "for-of entries": 2,
      "for-of aKeys": 2, "spread ...collectedRefs": 1,
      // (b) SPREAD-REST — the `BUILTIN_OP_NATIVES` bodies: a `(...args)` rest
      //     parameter is always a fresh plain array however it was called
      "args.reduce": 2, "args.map": 1, 'args.map((a) => String(a ?? "")).join': 1,
      // (c) FRESH — the direct result of `Object.keys` / `evaluateEach` / a
      //     local builder, i.e. a plain array produced on the spot
      "collected.map": 1, "keys.filter": 1, "argKeys.every": 1,
      "recordKeys.some": 1, "recordKeys.every": 1,
      "for-of Object.keys(bindings)": 1, "for-of Object.keys(data)": 1,
      "for-of Object.keys(pObj)": 1, "for-of Object.keys(pattern)": 1,
      "for-of Object.keys(sub)": 1, "for-of Object.entries(bindings)": 1,
      "for-of Object.entries(args[1] as Record<string, unknown>)": 1,
      // ⚠ type-substrate P1(a.20) — THIS ROW WAS REMOVED, AND THE REASON IS THE
      // ROUND-12 RULE AGREEING WITH ITSELF. An earlier cut of the phase scanned a
      // constructor-table entry with `for-of Object.entries(Object.getOwnProperty      // Descriptors(v))` and justified it as class (c). Review then replaced that
      // scan with `canonicalWireList`, which walks the entry BY INDEX
      // (`Object.getOwnPropertyDescriptor(v, String(i))`, `length` read as an own
      // data descriptor) and returns a fresh frozen array. An index walk is
      // precisely what round 12 concluded every caller-data read must be, so the
      // consumption is now in the form that produces NO row — the scanner finding
      // nothing here is the census and the repair agreeing, not a gap. Its
      // `out.push` is counted above.
      "spread ...a": 1, "spread ...b": 1,
      "spread ...argsUpToFirstHole(sliceFrom(step, 1))": 1,
      // The lexical-context cache (`lexicalAmbientKeys`, `lexicalAmbientMatches`,
      // `lexicalEvaluateContext`). `Reflect.ownKeys` returns a fresh plain list
      // (its filter callback reads the ctx's own descriptors, a class (d) table)
      // and `keys` is that list. `imports` is always an array `json-logic.ts`
      // built: the registry path's one-element literal, or
      // `closureLexicalImports`'s private copy of a closure's frames. The
      // closure's OWN list was iterated here, through its own `every` and its
      // own iterator, until that copy existed.
      "Reflect.ownKeys(ctx).filter": 1, "keys.every": 1, "keys.map": 1,
      "imports.every": 2, "spread ...imports": 2,
      // (round 12 removed the one destructuring over caller data —
      // `withInstanceOp` reads its two operands by index now, because a
      // catching ITERATOR absorbs a throwing element getter.)
      // (d) REGISTRY / ctx — a registered spec or a ctx table
      "ctorDef.includes": 1,
      // constructorDeclaredFieldNames returns the shared canonical descriptor
      // copy; this method never runs on the supplied constructor entry.
      "declared.indexOf": 1,
      "spread ...(ctx._dictStack ?? [])": 1, "spread ...(ctx._importStack ?? [])": 1,
      // `fnOp` capturing the evaluator context's own import stack into the new
      // closure's `lexicalImports`.
      "spread ...ctx._importStack": 1,
      "for-of slotsRead.value": 1, "spread ...(v._1 ?? [])": 2,
      // 3 → 4 at modules-as-values Phase 2d: `installServedDispatcher` asks
      // whether its installer (host code in engine-bodies-dispatch, class (d))
      // passed the optional `resolveComplete` key at all.
      "«Object.prototype.hasOwnProperty».call": 4,
      // Intrinsic invocation preserves the ordinary hook/native receiver
      // without consulting any supplied function's mutable own call method.
      // Apply argument lists are fresh literals, except the explicitly retained
      // argument-spread residual counted below. Existing env.primordials applies.
      "«Reflect».apply": 7,
      // (e) STRING — a string primitive's methods cannot be overridden
      "haystack.includes": 1, "v.classes.join": 1, "v.bindings.join": 1,
      // modules-as-values Phase 5a: `invokeFunction` asks whether a string call
      // head `name` is a dotted spelling (`.`) and not a canonical id (`:`)
      // before consulting the bundle member walk.
      "name.indexOf": 2,
      "name.includes": 1,
      // (h) is GONE. It read: "the spec's own converter calls — `toPrimitiveNumber`
      //     IS `ToPrimitive(number)`, whose whole job is to invoke the object's
      //     own converters." Round 12b DELETED that function: a class whose
      //     purpose is to invoke caller-supplied methods is the one thing this
      //     census exists to forbid, and carving it an exemption was the error.
      //     `toLength` refuses to measure a non-primitive length instead.
      // (i) ARGUMENT SPREADS whose source has already crossed
      //     `argsUpToFirstHole` at `invokeFunction`
      // Two native call-site spreads moved into invokeContextNativeAtKey.
      // This is the same named residual, not new evidence that args is fresh.
      "spread ...evaluatedArgs": 3, "spread ...args": 1,
    };
    // ⚠ ROUND 12 RETIRED THE OLD CLASS (f), "AST/VALUE, FIDELITY-ONLY".
    //
    // Its argument was: `for…of` does not catch a body throw, so a hostile
    // iterator can change WHAT is iterated but cannot turn a failure into a
    // verdict. Codex refuted it with a measurement: the throw does not have to
    // come from the body. An element GETTER that throws raises DURING `next()`,
    // and an iterator that catches there substitutes a value and continues —
    // `withInstance` over such an array measured `Just true` against the plain
    // array's `Nothing`. Every `for…of` and every destructuring over
    // caller-supplied data is now an index walk, which is why no such row
    // remains in the table above.
    //
    // ⚠ NAMED RESIDUAL, deliberately not closed here: `spread ...evaluatedArgs`
    // is class (i) on the ground that the list crossed `argsUpToFirstHole`
    // first — but that walk tests `i in xs`, which does NOT invoke a getter, so
    // a throwing getter on a native-returned argument array still reaches the
    // spread, where a catching iterator could absorb it. Closing it means
    // copying every argument list by index on the hot path, which is an
    // allocation per call. It is written down rather than assumed away.
    const actual: Record<string, number> = {};
    for (const f of found) actual[f] = (actual[f] ?? 0) + 1;
    expect(actual).toEqual(EXPECTED);
  });

  it("the door invariant: no catch absorbs an exception during an active proof", () => {
    // Load-bearing for door marking being a strict superset of marking each
    // individual `throw` statement: if nothing inside `json-logic.ts` can
    // swallow an exception during a proof, then a door or the earlier metadata
    // observation marks it before a downstream catcher can hide it. This also
    // covers implicit host exceptions raised at no throw statement at all.
    //
    // The two doors rethrow unconditionally. A single structurally verified
    // metadata fallback may return only outside an active proof.
    //
    // ⚠ THIS CHECK IS AN AST WALK, and the three lexical versions that preceded
    // it are the reason. Review round 1 accepted any handler containing the
    // TOKEN `throw`; round 3 accepted a CONDITIONAL rethrow (`if (…) throw e;`
    // ends with `throw e;`); round 4 accepted a handler whose `break outer;`
    // escaped, and round 5 found the brace walk could be desynchronised by a
    // REGEX LITERAL (`/}/`) and that an operand-position heuristic
    // misclassifies `x++ / y` the other way. A lexical approximation of "does
    // this handler absorb" was wrong four times in four rounds; the compiler's
    // own parser is not an approximation.
    const src = readFileSync(join(import.meta.dirname, "json-logic.ts"), "utf8");
    const sf = ts.createSourceFile("json-logic.ts", src, ts.ScriptTarget.Latest, true);
    /** Does this node WRITE to `name` — by any spelling the language offers? */
    const mentionsBindingInWritePosition = (n: ts.Node, name: string): boolean => {
      const writesTo = (target: ts.Node): boolean => {
        if (ts.isIdentifier(target)) return target.text === name;
        if (ts.isArrayLiteralExpression(target)) return target.elements.some(writesTo);
        if (ts.isObjectLiteralExpression(target)) {
          return target.properties.some((pr) =>
            (ts.isShorthandPropertyAssignment(pr) && pr.name.text === name)
            || (ts.isPropertyAssignment(pr) && writesTo(pr.initializer))
            || (ts.isSpreadAssignment(pr) && writesTo(pr.expression)));
        }
        if (ts.isSpreadElement(target)) return writesTo(target.expression);
        if (ts.isBindingElement(target)) return writesTo(target.name);
        // Round 8 (Codex + Grok, independently): two spellings round 7 claimed
        // and did not cover. Object REST in an assignment pattern parses as a
        // `SpreadAssignment` — an ObjectLiteralElement, NOT the `SpreadElement`
        // the array case produces — and a parenthesized target (`(e) = 1`,
        // `(e)++`) wraps the identifier the walk was looking for.
        if (ts.isSpreadAssignment(target)) return writesTo(target.expression);
        if (ts.isParenthesizedExpression(target)) return writesTo(target.expression);
        // Round 11 (Codex): two more wrappers that hide the identifier from the
        // walk. `(e as unknown) = new Error(...)` and `e! = ...` both rebind the
        // handler's binding, and the handler still ENDS in `throw e;` — so it
        // throws a replacement and the invariant stayed green.
        if (ts.isAsExpression(target)) return writesTo(target.expression);
        if (ts.isNonNullExpression(target)) return writesTo(target.expression);
        if (ts.isTypeAssertionExpression !== undefined && ts.isTypeAssertionExpression(target)) {
          return writesTo(target.expression);
        }
        if (ts.isSatisfiesExpression !== undefined && ts.isSatisfiesExpression(target)) {
          return writesTo(target.expression);
        }
        return false;
      };
      if (ts.isBinaryExpression(n)) {
        const k = n.operatorToken.kind;
        const isAssign =
          k === ts.SyntaxKind.EqualsToken
          || (k >= ts.SyntaxKind.FirstCompoundAssignment && k <= ts.SyntaxKind.LastCompoundAssignment);
        if (isAssign && writesTo(n.left)) return true;
      }
      if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n))
        && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)
        && writesTo(n.operand)) return true;
      if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && writesTo(n.initializer)) return true;
      return false;
    };

    // A metadata fallback is permitted only outside a proof. Recognize the
    // complete control-flow shape, independent of helper names or locations.
    // The helper itself cannot shadow the private stack or the undefined value.
    const guardedMetadataCatch = (node: ts.CatchClause): boolean => {
      const binding = node.variableDeclaration?.name;
      if (binding === undefined || !ts.isIdentifier(binding)) return false;
      const attempt = node.parent;
      if (!ts.isTryStatement(attempt) || attempt.finallyBlock !== undefined) return false;
      const body = attempt.parent;
      if (!ts.isBlock(body) || body.statements.length !== 1 || body.statements[0] !== attempt) return false;
      const fn = body.parent;
      if (!ts.isFunctionDeclaration(fn) || !ts.isSourceFile(fn.parent) || fn.parameters.length !== 2
        || fn.asteriskToken !== undefined || fn.modifiers?.some(modifier =>
          modifier.kind === ts.SyntaxKind.AsyncKeyword || modifier.kind === ts.SyntaxKind.ExportKeyword)) return false;
      const observe = fn.parameters[0]!.name, fallback = fn.parameters[1]!.name;
      if (!ts.isIdentifier(observe) || !ts.isIdentifier(fallback)
        || fn.parameters.some(parameter => parameter.initializer !== undefined || parameter.dotDotDotToken !== undefined)
        || new Set([observe.text, fallback.text, binding.text]).size !== 3
        || [observe.text, fallback.text, binding.text].some(name => name === "whereProofFrames" || name === "undefined")) return false;
      const entry = attempt.tryBlock.statements;
      if (entry.length !== 1 || !ts.isReturnStatement(entry[0]!) || entry[0]!.expression === undefined) return false;
      const call = entry[0]!.expression;
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)
        || call.expression.text !== observe.text || call.arguments.length !== 0) return false;
      const statements = node.block.statements;
      if (statements.length !== 3 || !ts.isVariableStatement(statements[0]!)
        || (statements[0]!.declarationList.flags & ts.NodeFlags.Const) === 0
        || statements[0]!.declarationList.declarations.length !== 1) return false;
      const frame = statements[0]!.declarationList.declarations[0]!;
      if (!ts.isIdentifier(frame.name) || [observe.text, fallback.text, binding.text, "whereProofFrames", "undefined"].includes(frame.name.text)
        || frame.initializer === undefined || !ts.isElementAccessExpression(frame.initializer)) return false;
      const read = frame.initializer;
      if (!ts.isIdentifier(read.expression) || read.expression.text !== "whereProofFrames"
        || read.argumentExpression === undefined || !ts.isBinaryExpression(read.argumentExpression)) return false;
      const index = read.argumentExpression;
      if (index.operatorToken.kind !== ts.SyntaxKind.MinusToken || !ts.isPropertyAccessExpression(index.left)
        || !ts.isIdentifier(index.left.expression) || index.left.expression.text !== "whereProofFrames"
        || index.left.name.text !== "length" || !ts.isNumericLiteral(index.right) || index.right.text !== "1") return false;
      const branch = statements[1]!;
      if (!ts.isIfStatement(branch) || branch.elseStatement !== undefined || !ts.isBinaryExpression(branch.expression)
        || branch.expression.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
        || !ts.isIdentifier(branch.expression.left) || branch.expression.left.text !== frame.name.text
        || !ts.isIdentifier(branch.expression.right) || branch.expression.right.text !== "undefined"
        || !ts.isBlock(branch.thenStatement) || branch.thenStatement.statements.length !== 2) return false;
      const mark = branch.thenStatement.statements[0]!, rethrow = branch.thenStatement.statements[1]!;
      if (!ts.isExpressionStatement(mark) || !ts.isBinaryExpression(mark.expression)
        || mark.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
        || !ts.isPropertyAccessExpression(mark.expression.left)
        || !ts.isIdentifier(mark.expression.left.expression) || mark.expression.left.expression.text !== frame.name.text
        || mark.expression.left.name.text !== "tripped" || mark.expression.right.kind !== ts.SyntaxKind.TrueKeyword
        || !ts.isThrowStatement(rethrow) || rethrow.expression === undefined || !ts.isIdentifier(rethrow.expression)
        || rethrow.expression.text !== binding.text) return false;
      const outside = statements[2]!;
      return ts.isReturnStatement(outside) && outside.expression !== undefined
        && ts.isIdentifier(outside.expression) && outside.expression.text === fallback.text;
    };
    const absorbing: string[] = [];
    let found = 0;
    let guarded = 0;
    const visit = (node: ts.Node): void => {
      // Round 6 (Codex): a handler is not the whole story. A `finally` that
      // RETURNS swallows the exception the handler rethrew, and it lives on the
      // `TryStatement`, outside the `CatchClause` this walk scans.
      // Round 8 (Codex): the scan only ran when the SAME `try` also had a
      // `catch`. `json-logic.ts` carries two BARE `try`/`finally` blocks (the
      // resolver re-entry guards); a `return` added to either would swallow a
      // resolver exception before the door and the invariant would stay green.
      // Every `finally` in the file is now scanned, whatever it is attached to.
      if (ts.isTryStatement(node) && node.finallyBlock !== undefined) {
        const at = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        let escapes = false;
        const scanFinally = (n: ts.Node): void => {
          if (ts.isFunctionLike(n)) return;
          // Round 7 (Grok): a `finally` that THROWS also replaces the rethrown
          // exception, so it belongs with the abrupt completions.
          if (
            ts.isReturnStatement(n) || ts.isBreakStatement(n)
            || ts.isContinueStatement(n) || ts.isThrowStatement(n)
          ) escapes = true;
          ts.forEachChild(n, scanFinally);
        };
        scanFinally(node.finallyBlock);
        if (escapes) {
          absorbing.push(`line ${at}: a \`finally\` block can complete abruptly, swallowing the rethrow`);
        }
      }
      if (ts.isCatchClause(node)) {
        found++;
        if (guardedMetadataCatch(node)) {
          guarded++;
          return;
        }
        const at = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const binding = node.variableDeclaration?.name;
        if (binding === undefined || !ts.isIdentifier(binding)) {
          absorbing.push(`line ${at}: the handler does not BIND the exception, so it cannot rethrow it`);
        } else {
          const stmts = node.block.statements;
          const last = stmts[stmts.length - 1];
          const rethrows =
            last !== undefined
            && ts.isThrowStatement(last)
            && last.expression !== undefined
            && ts.isIdentifier(last.expression)
            && last.expression.text === binding.text;
          if (!rethrows) {
            absorbing.push(`line ${at}: the handler's last statement is not \`throw ${binding.text};\``);
          }
          // Any earlier statement that can leave the handler without reaching
          // that rethrow re-opens the hole, whatever its syntax.
          const escapes: string[] = [];
          const scan = (n: ts.Node): void => {
            if (n === last) return;
            // Round 11 CLAIMED to have removed this skip and did not — round 12
            // (Codex) found the claim false. A nested function's own RETURN is
            // its own control flow and says nothing about the handler, but a
            // WRITE to the handler's binding from inside one is still a write:
            // `(() => { e = new Error("x"); })(); throw e;` rethrows the
            // replacement. So the skip now applies to the abrupt-completion
            // checks only, and the rebinding check runs everywhere.
            if (ts.isFunctionLike(n)) {
              const scanWrites = (m: ts.Node): void => {
                if (mentionsBindingInWritePosition(m, binding.text)) {
                  escapes.push(`rebinding of \`${binding.text}\` inside a nested function`);
                }
                ts.forEachChild(m, scanWrites);
              };
              ts.forEachChild(n, scanWrites);
              return;
            }
            if (ts.isReturnStatement(n)) escapes.push("return");
            else if (ts.isBreakStatement(n)) escapes.push("break");
            else if (ts.isContinueStatement(n)) escapes.push("continue");
            else if (ts.isThrowStatement(n)) escapes.push("a conditional throw");
            // Round 6 (Codex): rethrowing the BINDING is only a rethrow while
            // the binding still holds the caught exception. `e = new Error(…)`
            // before `throw e;` satisfies every structural test and raises a
            // different exception.
            // Round 7 (Grok): `Identifier =` was only one spelling. A
            // destructuring assignment (`[e] = [new Error(…)]`), a compound
            // assignment, or a `for (e of …)` header rebinds it just as well.
            else if (mentionsBindingInWritePosition(n, binding.text)) {
              escapes.push(`rebinding of \`${binding.text}\``);
            }
            // Round 11 (Codex): nested function-likes were skipped wholesale,
            // so `(() => { e = other; })()` wrote the binding invisibly. A
            // nested function that MENTIONS the binding in write position is
            // reported wherever it sits; a nested function that merely reads it
            // is not.
            ts.forEachChild(n, scan);
          };
          for (const st of stmts) if (st !== last) scan(st);
          if (escapes.length > 0) {
            absorbing.push(`line ${at}: the handler can leave before its rethrow (${escapes.join(", ")})`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(absorbing).toEqual([]);
    expect(found).toBe(3); // two strict doors and one structurally verified metadata fallback
    expect(guarded).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. ENTITLED MOVEMENTS — declared, priced, and pinned at their NEW values
// ---------------------------------------------------------------------------

describe("mem.where.prov — the entitled movements (a proof is not an evaluation)", () => {
  // Fenel has natives whose PUBLISHED CONTRACT turns failure into a value
  // (`eagerEval` / `lazyEval`: throw ⇒ `Err`). A predicate that pattern-matches
  // such a value reasons about REIFIED FAILURE and runs to completion on honest
  // data. The owner chose UNIFORM ABSTENTION: a failure witnessed during a proof
  // abstains the proof, whatever converts it downstream — it is the only rule
  // that also closes the ACCIDENTAL catcher (`swallowHard`), which is not
  // distinguishable from a contractual one at the boundary. Ordinary evaluation
  // is untouched: `eagerEval` still returns `Err` everywhere else.
  const reifyErr = reify({ var: "value.rule" });

  it("a throwing method reified as `Err` (entry: Just true)", () => {
    expect(contains(where(reifyErr), { rule: { method: ["NoSuchClass", "m", 1] } }, null, undefined, evaluationReader()))
      .toEqual(NOTHING);
  });

  it("a reserved-name construct reified as `Err` (entry: Just true)", () => {
    expect(contains(where(reifyErr), { rule: { construct: ["@ctor/bad"] } }, null, undefined, evaluationReader()))
      .toEqual(NOTHING);
  });

  it("a completing-null evaluation reified as `Ok(null)` — the dual (entry: Just false)", () => {
    expect(contains(where(reifyErr), { rule: { call: ["nope"] } }, null, undefined, evaluationReader())).toEqual(NOTHING);
  });

  it("a missing read reified (entry: Just false)", () => {
    expect(contains(where(reifyErr), { rule: { var: "noSuchBinding" } }, null, undefined, evaluationReader()))
      .toEqual(NOTHING);
  });

  it("`evalExpr` of an expression with a missing read (entry: Just false)", () => {
    // Store the rule as data, so the missing read happens inside evalExpr
    // rather than while its eager caller is constructing the arguments.
    expect(askWithEvaluators(
      { call: ["evalExpr", { var: "value.expr" }, { var: "value.data" }] },
      { expr: { ">": [{ var: "noSuch" }, 0] }, data: {} },
    )).toEqual(NOTHING);
  });

  it("DOOR-ONLY: an IMPLICIT host exception (no `throw` statement) reified (entry: Just true)", () => {
    // `{construct: []}` raises a TypeError before reaching the arm's explicit
    // throw. Marking each `throw` statement would have missed this entirely;
    // the door observes the exception, not the statement that raised it.
    expect(contains(where(reifyErr), { rule: { construct: [] } }, null, undefined, evaluationReader())).toEqual(NOTHING);
  });

  it("DOOR-ONLY: an OUT-OF-FILE-origin native throw reified (entry: Just true)", () => {
    expect(contains(where(reifyErr), { rule: { call: ["boomNative"] } }, null, undefined, evaluationReader()))
      .toEqual(NOTHING);
  });

  it("a registered predicate on a candidate whose path does not exist: NonEmptyStr vs a number (entry: Just false)", () => {
    // Priced: product delta NONE — validation collapses `Nothing` and
    // `Just false` to the same rejection.
    const set = (NonEmptyStr as { $refined: { set: SetExpr } }).$refined.set;
    expect(contains(set, 5, null, undefined, ctx)).toEqual(NOTHING);
  });
});

// ---------------------------------------------------------------------------
// 4. MUST-NOT-MOVE — the anti-proxy net. A movement here means a proxy regrew.
// ---------------------------------------------------------------------------

describe("mem.where.prov — MUST-NOT-MOVE (every entry value re-measured)", () => {
  it("a successful context-free `evalExpr` still decides", () => {
    const predicate = where({ call: ["evalExpr", { var: "value.expr" }, { var: "value.data" }] });
    const candidate = { expr: { ">": [1, 0] }, data: {} };
    expect(ctx.getFunction?.("evalExpr")).toBeUndefined();
    expect(contains(predicate, candidate, null, undefined, ctx)).toEqual(NOTHING);
    expect(
      contains(
        predicate,
        candidate, null,
        undefined,
        evaluationReader(),
      ),
    ).toEqual(JUST(true));
  });

  it("strategy blocks and strategy SELECTION still decide", () => {
    const frame = (marker: string, fn: string) => ({
      typeName: "Evaluator",
      args: [marker],
      methods: { eval: `evaluator-strategies:${fn}` },
    });
    expect(askWithEvaluators({ withInstance: [frame("EagerStrategy", "eagerEval"), { ">": [{ var: "value" }, 0] }] })).toEqual(JUST(true));
    expect(askWithEvaluators({ withInstance: [frame("LazyStrategy", "lazyEval"), { ">": [{ var: "value" }, 0] }] })).toEqual(JUST(true));
    expect(askWithEvaluators({ withInstance: [frame("LazyStrategy", "lazyEval"), true] })).toEqual(JUST(true));
    expect(askWithEvaluators({ withInstance: [frame("PartialStrategy", "partialEval"), true] })).toEqual(JUST(true));
    expect(askWithEvaluators({ withInstance: [frame("JitStrategy", "jitEval"), true] })).toEqual(JUST(true));
  });

  it("the BOUNDARY rule: an outer proof that DISCARDS an inner abstention still decides", () => {
    // Both halves: an inner frame tripped by a no-value exit, and one tripped
    // through the `invokeCallable` door. Marking either on ALL frames would
    // poison the outer verdict.
    expect(ask({ do: [{ call: ["innerMemberAbstains"] }, true] })).toEqual(JUST(true));
    expect(ask({ do: [{ call: ["innerViaCallableAbstains"] }, true] })).toEqual(JUST(true));
  });

  it("documented truthy semantics survive: `and[\"hello\", true]`", () => {
    expect(contains(where({ and: [{ var: "value" }, true] }), "hello", null, undefined, ctx)).toEqual(JUST(true));
  });

  it("an unknown single-key RECORD literal is a produced VALUE, not a failure", () => {
    expect(ask({ "!!": [{ definitelyNotAFunction: [] }] })).toEqual(JUST(true));
    expect(ask({ "!!": [{ "unknown:ioBool": [] }] })).toEqual(JUST(true));
  });

  it("a PRESENT binding holding host-`undefined` is a VALUE", () => {
    expect(
      contains(where({ "==": [{ var: "value.x" }, { var: "value.y" }] }), { x: undefined, y: undefined }, null, undefined, ctx),
    ).toEqual(JUST(true));
  });

  it("a successful side effect (`type_def`) is not a no-value exit", () => {
    expect(ask({ do: [{ type_def: { name: "TmpP1a13", constructors: [] } }, true] })).toEqual(JUST(true));
    // Round 8: `type_def` used as a VALUE now abstains, so `do` runs a
    // declaration in statement position through the effect DIRECTLY. Both
    // spellings of the statement, and two in a row, still decide.
    expect(ask({ do: [{ type_def: [{ name: "TmpP1a13b", constructors: [] }] }, true] })).toEqual(JUST(true));
    expect(ask({
      do: [
        { type_def: { name: "TmpA1", constructors: [] } },
        { type_def: { name: "TmpA2", constructors: [] } },
        true,
      ],
    })).toEqual(JUST(true));
    // ... and the declared constructors it registers are still usable after it
    expect(ask({
      do: [
        { type_def: { name: "R8Adt", constructors: [{ name: "R8Ctor", fields: [{ name: "x" }] }] } },
        { "!!": { construct: ["R8Ctor", 1] } },
      ],
    })).toEqual(JUST(true));
  });

  it("an empty `let` FOLLOWED by a statement still decides", () => {
    // The other half of round 8's `do` change: `produced` must be set by any
    // real statement, wherever the empty `let` sits.
    expect(ask({ do: [{ let: {} }, true] })).toEqual(JUST(true));
    expect(ask({ do: [{ let: { x: true } }, { var: "x" }] })).toEqual(JUST(true));
    expect(ask({ do: [{ let: { x: true } }] })).toEqual(JUST(true));
  });

  it("an EXPLICIT default names the answer for the absent case — it still decides", () => {
    expect(ask({ ">": [{ var: ["obj.missing", 9] }, 0] })).toEqual(JUST(true));
  });

  it("`missing` DETECTS absent keys — the miss is its answer, not a failure", () => {
    // The operator exists to report absence. Reading its keys without an
    // explicit default would route every miss through the no-value trip and
    // abort the proof on exactly the input `missing` is for — a correct answer
    // removed. `missing` therefore reads with an explicit `null` default.
    expect(ask({ "==": [{ length: { missing: ["noSuchKey"] } }, 1] })).toEqual(JUST(true));
    expect(ask({ "==": [{ length: { missing: ["value"] } }, 0] })).toEqual(JUST(true));
    expect(ask({ "==": [{ length: { missing_some: [1, ["noSuchKey", "value"]] } }, 0] })).toEqual(JUST(true));
  });

  it("`pipe` SKIPS an invalid step — a value IS produced (residual lane iv)", () => {
    expect(ask({ ">": [{ pipe: [5, 42] }, 0] })).toEqual(JUST(true));
  });

  it("`and[Err, true]` still decides — an authored non-Bool operand is the STATIC leg's job (residual lane iv)", () => {
    expect(ask({ and: [{ $tag: "Err", _0: "bad" }, true] })).toEqual(JUST(true));
  });

  it("a reifier over a SUCCESSFUL evaluation still decides", () => {
    expect(contains(where(reify({ var: "value.rule" })), { rule: { ">": [1, 0] } }, null, undefined, evaluationReader()))
      .toEqual(JUST(false));
  });

  it("ordinary Boolean predicates are unaffected, in both polarities", () => {
    expect(ask({ ">": [{ var: "value" }, 0] }, 5)).toEqual(JUST(true));
    expect(ask({ ">": [{ var: "value" }, 0] }, -5)).toEqual(JUST(false));
  });

  it("REQUIRED PIN — the registered `NonEmptyStr` predicate decides on strings", () => {
    const set = (NonEmptyStr as { $refined: { set: SetExpr } }).$refined.set;
    expect(contains(set, "x", null, undefined, ctx)).toEqual(JUST(true));
    expect(contains(set, "", null, undefined, ctx)).toEqual(JUST(false));
  });

  // ── review round 1 additions to the net ─────────────────────────────────
  it("an AUTHORED `null` in the AST is DATA, not a failure (residual lane iv)", () => {
    // The distinction the trips rest on: what the INTERPRETER produced, versus
    // what the SOURCE contained. A literal `null` operand is a value the author
    // wrote; a branchless `if` is a value the interpreter never made.
    expect(ask({ "!": [null] })).toEqual(JUST(true));
  });

  it("well-formed `if` still decides in every arm", () => {
    expect(ask({ if: [false, true, false] })).toEqual(JUST(false));
    expect(ask({ if: [true, true] })).toEqual(JUST(true));
    // LAZY: the untaken branch is never evaluated, so a failure inside it
    // cannot abstain the proof — contrast the eager `ifElse` FUNCTION above.
    expect(ask({ if: [true, true, { call: ["nope"] }] })).toEqual(JUST(true));
  });

  it("an operator with a defined identity on the empty argument list still decides", () => {
    // `{and:[]}` is ⊤ and `{or:[]}` is ⊥ — total functions of an empty input,
    // not missing operands. The op-arity census (`notes/p1a13/op-arity.log`)
    // separates these from the three that were tripped.
    expect(ask({ and: [] })).toEqual(JUST(true));
    expect(ask({ or: [] })).toEqual(JUST(false));
  });

  it("well-formed `ann` / `fn` / `do` / `let` still decide", () => {
    expect(ask({ ann: [true] })).toEqual(JUST(true));
    expect(ask({ apply: [{ fn: [[], false] }, []] })).toEqual(JUST(false));
    expect(ask({ do: [true] })).toEqual(JUST(true));
    expect(ask({ let: [{ x: true }] })).toEqual(JUST(true));
    expect(ask({ apply: [{ fn: [[], true] }, []] })).toEqual(JUST(true));
    // Round 3 (Codex): the parser lowers a NULLARY lambda through the FLAT
    // form, so `\ -> []` is `{fn:[[]]}` — a single-element `fn` is always flat
    // and its element is the BODY. Before the arity guard this took the
    // canonical arm: `\ -> []` applied to `undefined`, and `\ -> [1,2]` applied
    // to a PARTIAL whose params were `[1, 2]`. Both are parser-produced, and
    // both were broken BEFORE this phase — the guard is a repair, not a fence.
    expect(ask({ "==": [{ length: { apply: [{ fn: [[]] }, []] } }, 0] })).toEqual(JUST(true));
    expect(ask({ "==": [{ length: { apply: [{ fn: [[1, 2]] }, []] } }, 2] })).toEqual(JUST(true));
    expect(ask({ "==": [{ reduce: [[1, 2, 3], { "+": [{ var: "current" }, { var: "accumulator" }] }, 0] }, 6] })).toEqual(JUST(true));
    // The FLAT `fn` form binds no params and takes the last arg as the body —
    // a legitimate nullary closure, not a missing operand.
    expect(ask({ "!!": [{ fn: [true] }] })).toEqual(JUST(true));
  });

  it("the Aggregable preimage lane still DECIDES — the frame touches no structural reasoning", () => {
    // `$where` subset/disjoint reasoning via `Aggregable` is structural: it
    // reads the predicate's SHAPE and never evaluates it against a candidate,
    // so no frame is ever opened. Pinned here because the phase's mechanism
    // sits in the evaluator that this lane deliberately does not use.
    const lengthIn = (values: number[]): SetExpr =>
      ({ $tag: "SeWhere", pred: { in: [{ call: ["length", { var: "value" }] }, values] } }) as unknown as SetExpr;
    expect(isSubset(lengthIn([5, 6]), lengthIn([3, 5, 6]))).toEqual(JUST(true));
    expect(isSubset(lengthIn([3, 5, 6]), lengthIn([5, 6]))).toEqual(NOTHING);
    // Numeric order does not have an exact interval extraction across native
    // and exact-integer carriers. This pre-existing fence is not a frame trip.
    const lengthGte = (n: number): SetExpr =>
      ({ $tag: "SeWhere", pred: { ">=": [{ call: ["length", { var: "value" }] }, n] } }) as unknown as SetExpr;
    expect(isSubset(lengthGte(5), lengthGte(3))).toEqual(NOTHING);
    expect(isSubset(lengthGte(3), lengthGte(5))).toEqual(NOTHING);
  });
});

// ---------------------------------------------------------------------------
// 4b. THE ONE DECLARED NON-MONOTONE MOVEMENT
// ---------------------------------------------------------------------------

describe("mem.where.frame — a predicate that OBSERVES a nested abstention", () => {
  // Review round 1 (Codex `gpt-5.6-sol` `ultra`) reproduced the phase's only
  // movement that is not `Just → Nothing`, and it is FORCED by the repair
  // rather than by the mechanism.
  //
  // The boundary rule makes an inner membership's `Nothing` ordinary DATA. A
  // predicate may therefore pattern-match it. At `6b6281f9` the inner
  // membership LIED (`Just false` from an unresolved call), so an outer
  // predicate asking "did the inner abstain?" answered `false`; now the inner
  // abstains honestly and the same predicate answers `true`. The outer verdict
  // is CORRECT in both worlds — it reports what its predicate computes — but
  // the cell moved `Just false → Just true`.
  //
  // The alternative — propagating the inner trip to the outer frame — is
  // ALL-FRAME MARKING, which the design rounds killed on a measurement and
  // which the boundary MUST-NOT-MOVE pin forbids. No frame can distinguish an
  // outer proof that DISCARDS an inner abstention from one that BRANCHES on it:
  // that is an intensional property of the predicate, not an observable of the
  // evaluation. So the movement is declared here rather than repaired, and the
  // ledger row records that an abstention is observable to a predicate.
  const observeInner = (innerPred: unknown): EvaluateContext => ({
    ...ctx,
    nativesCtx: {
      ...ctx.nativesCtx,
      innerResult: () => contains(where(innerPred), 1, null, undefined, ctx),
    },
  });
  const outer = { match: [{ call: ["innerResult"] }, { $tag: "Nothing" }, true, "_", false] };

  it("DECLARED, NOT MONOTONE: observing an abstaining inner membership (entry: Just false)", () => {
    expect(contains(where(outer), 5, null, undefined, observeInner({ ">": [{ call: ["nope:notAFn"] }, 0] })))
      .toEqual(JUST(true));
  });

  it("observing a DECIDING inner membership is unchanged", () => {
    expect(contains(where(outer), 5, null, undefined, observeInner({ ">": [{ var: "value" }, 0] })))
      .toEqual(JUST(false));
  });
});

// ---------------------------------------------------------------------------
// 5. THE KERNEL — it no longer stamps `SolverChecked` on a test it never ran
// ---------------------------------------------------------------------------

describe("mem.where.prov — the kernel re-check is the SAME function", () => {
  // `verifyWitnessMembership w s = decideSubset(SeEnum [w]) s` (judgment.fenel)
  // → `setAlgebraContains` → `whereMember`. The re-check is not an independent
  // oracle: it re-runs the SAME predicate under the SAME evaluator, so a
  // laundered `Just true` was a laundered PROOF.
  const laundered = where({ "!": [{ call: ["nope:notAFn"] }] });
  const singleton = { $tag: "SeEnum", values: [5] } as unknown as SetExpr;

  it("the singleton subset face abstains (entry: Just true)", () => {
    expect(isSubset(singleton, laundered, ctx)).toEqual(NOTHING);
  });

  it("a subset claim over a laundered `$where` is NOT stamped SolverChecked (entry: Ok/SolverChecked)", () => {
    const vr = verify(propSubset(singleton, laundered), decidableSetProof("subset", { left: singleton, right: laundered }));
    expect(vr.$tag).not.toBe("Ok");
  });

  it("the same kernel route still stamps a genuinely decidable `$where` claim", () => {
    const decidable = where({ "==": [{ var: "value" }, "a"] });
    const positive = { $tag: "SeEnum", values: ["a"] } as unknown as SetExpr;
    const vr = verify(propSubset(positive, decidable), decidableSetProof("subset", { left: positive, right: decidable }));
    expect(vr.$tag).toBe("Ok");
    if (vr.$tag === "Ok") expect(vr._0.$tag).toBe("SolverChecked");
    // The kernel requires exact structural extraction here. Numeric ordering
    // still executes in membership, but its broader interval would be unsound.
    const numeric = where({ ">": [{ var: "value" }, 0] });
    const numericWitness = { $tag: "SeEnum", values: [5] } as unknown as SetExpr;
    expect(verify(propSubset(numericWitness, numeric), decidableSetProof("subset", { left: numericWitness, right: numeric })).$tag).toBe("Err");
  });
});
