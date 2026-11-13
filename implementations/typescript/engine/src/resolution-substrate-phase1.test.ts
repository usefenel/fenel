// ---------------------------------------------------------------------------
// resolution-substrate Phase 1 — the parity test (the KEPT deliverable).
//
// "Name resolution IS dispatch" (`design/resolution-substrate.md`). A bare
// codeName at a call head resolves coherently — single-binding direct,
// multi-binding through the SHIPPED `{method:…}` dispatch path, ambiguity a HARD
// ERROR, never a silent last-wins. This test asserts the resolver picks the
// binding the design specifies for every case the brief enumerates:
//   • single-binding direct           • dispatch-arg partial (the §4 eta wrinkle)
//   • multi-binding dispatch by type   • cross-class homonym → qualify Class.
//   • the D3 bare-method (0-binding)    • unclassed homonym  → qualify Module.
//   • the 4 grandfathered collisions stay last-wins (no throw, no regression)
//
// The controlled cases use a fresh spec + a tiny module (the prototype's
// `Sequential List`+`Vec` shape, here `Sliceable` over List vs String so the
// dispatch arg reflects via built-in `typeConstructorOf`). The grandfather +
// no-regression cases use the REAL system registry.
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { createRegistry } from "./registry";
import { createDispatchRegistry } from "./dispatch-registry";
import { getSystemRegistry } from "./system-registry";
import { evaluate } from "./json-logic";
import type { EvaluateContext, BareNameResolution } from "./json-logic";
import type { FenelModule, FenelFunction, FieldDef } from "./types";
import type { DispatchRegistry } from "./dispatch-registry";

// A FieldDef with just `{name, type}` — the runtime tolerates the partial shape;
// this cast keeps the controlled fixtures terse without spelling out
// `label`/`ui`/`meta` on every param.
const fld = (name: string, type: unknown): FieldDef => ({ name, type } as unknown as FieldDef);

// --- a controlled multi-binding scenario --------------------------------------
// `Sliceable s` with `slice : Number -> s a -> s a` (the count is arg 0, the
// sequence — the dispatch arg — is arg 1; `dispatchPositionForSeed` reads it off
// the signature). Two instances (List native + String native) + two codeName
// bindings for `slice` make it a genuine collision that DISPATCHES.

function mkFn(id: string, returns: string): FenelFunction {
  return {
    id,
    params: [fld("n", { $ref: "Number" }), fld("xs", { $ref: returns })],
    returns: { $ref: returns },
  };
}

function controlledRegistry(): { ctx: EvaluateContext; spec: DispatchRegistry } {
  const spec = createDispatchRegistry();
  // The class — `slice`'s arg 1 is `s` (the class param) ⇒ dispatch position 1.
  spec.defineClass({
    name: "Sliceable",
    params: [{ name: "s" }],
    methods: [
      {
        name: "slice",
        params: [fld("_0", { $ref: "Number" }), fld("_1", { $var: "s" })],
        returns: { $var: "s" },
      },
    ],
  });
  spec.addInstance({ typeName: "Sliceable", args: ["List"], methods: { slice: "m:sliceList" } });
  spec.addInstance({ typeName: "Sliceable", args: ["String"], methods: { slice: "m:sliceStr" } });
  // A SECOND arg-dispatched class declaring `clip` — used for the cross-class
  // homonym test (two arg-dispatched classes own the same method name).
  spec.defineClass({
    name: "Clippable",
    params: [{ name: "s" }],
    methods: [
      { name: "clip", params: [fld("_0", { $ref: "Number" }), fld("_1", { $var: "s" })], returns: { $var: "s" } },
    ],
  });
  spec.defineClass({
    name: "Croppable",
    params: [{ name: "s" }],
    methods: [
      { name: "clip", params: [fld("_0", { $ref: "Number" }), fld("_1", { $var: "s" })], returns: { $var: "s" } },
    ],
  });
  // resolution-substrate Phase 3 — a BARE-METHOD (nB===0) scenario: `chop` is the
  // method of ONE arg-dispatched class with a SINGLE instance (List) and NO
  // Codeable codeName binding (so it's a method name, never a plain codeName —
  // exactly the live `fmap`/`foldr`/… shape). It classifies `dispatch` (D3); after
  // Phase 3 the dispatch is HARD — a `None` (no instance for the reflected type)
  // ERRORS instead of falling through to an unbound-name error.
  spec.defineClass({
    name: "Choppable",
    params: [{ name: "s" }],
    methods: [
      { name: "chop", params: [fld("_0", { $ref: "Number" }), fld("_1", { $var: "s" })], returns: { $var: "s" } },
    ],
  });
  spec.addInstance({ typeName: "Choppable", args: ["List"], methods: { chop: "m:chopList" } });

  const mod: FenelModule = {
    name: "m",
    label: { $tag: "Nothing" } as never,
    functions: [
      mkFn("m:sliceList", "List"),
      mkFn("m:sliceStr", "String"),
      // a single-binding control (arity 1 — proves the direct fast path)
      { id: "m:soloFn", params: [fld("n", { $ref: "Number" })], returns: { $ref: "Number" } },
      // two unrelated bindings for `mash`, NO class ⇒ ambiguousModule.
      mkFn("m:mashA", "Number"),
      mkFn("m:mashB", "Number"),
      // two bindings for `clip` + two classes own it ⇒ ambiguousClass.
      mkFn("m:clipA", "Number"),
      mkFn("m:clipB", "Number"),
      // the bare-method (nB===0) instance fn — NO Codeable codeName, so `chop`
      // binds zero codeNames and resolves ONLY through Choppable dispatch.
      mkFn("m:chopList", "List"),
    ],
    instances: [
      { typeName: "Codeable", args: ["m:sliceList"], methods: { codeName: "slice" } },
      { typeName: "Codeable", args: ["m:sliceStr"], methods: { codeName: "slice" } },
      { typeName: "Codeable", args: ["m:soloFn"], methods: { codeName: "solo" } },
      { typeName: "Codeable", args: ["m:mashA"], methods: { codeName: "mash" } },
      { typeName: "Codeable", args: ["m:mashB"], methods: { codeName: "mash" } },
      { typeName: "Codeable", args: ["m:clipA"], methods: { codeName: "clip" } },
      { typeName: "Codeable", args: ["m:clipB"], methods: { codeName: "clip" } },
    ],
    nativeImpls: {
      "m:sliceList": (n, xs) => (xs as unknown[]).slice(0, n as number),
      "m:sliceStr": (n, s) => (s as string).slice(0, n as number),
      "m:soloFn": (n) => (n as number) * 10,
      "m:mashA": (n) => n,
      "m:mashB": (n) => n,
      "m:clipA": (n) => n,
      "m:clipB": (n) => n,
      "m:chopList": (n, xs) => (xs as unknown[]).slice(0, n as number),
    },
  };
  const reg = createRegistry([mod], { dispatchRegistry: spec });
  return { ctx: reg.evaluateContext(), spec };
}

const { ctx } = controlledRegistry();
const ev = (rule: unknown): unknown => evaluate(rule, {}, ctx);
const classify = (name: string): BareNameResolution => ctx._resolveBareName!(name);

// ===========================================================================
describe("classifier (the resolver fork)", () => {
  test("single-binding name → direct", () => {
    expect(classify("solo").kind).toBe("direct");
  });
  test("multi-binding name owned by ONE arg-dispatched class → dispatch", () => {
    const r = classify("slice");
    expect(r.kind).toBe("dispatch");
    if (r.kind === "dispatch") {
      expect(r.typeName).toBe("Sliceable");
      expect(r.soft).toBeFalsy(); // multi-binding dispatch is hard (not D3-soft)
    }
  });
  test("multi-binding name owned by ≥2 arg-dispatched classes → ambiguousClass", () => {
    const r = classify("clip");
    expect(r.kind).toBe("ambiguousClass");
    if (r.kind === "ambiguousClass") expect([...r.classes].sort()).toEqual(["Clippable", "Croppable"]);
  });
  test("multi-binding name with NO class → ambiguousModule", () => {
    const r = classify("mash");
    expect(r.kind).toBe("ambiguousModule");
    if (r.kind === "ambiguousModule") expect([...r.bindings].sort()).toEqual(["m:mashA", "m:mashB"]);
  });
  test("an unknown / 0-binding non-method name → direct (table miss)", () => {
    expect(classify("nonesuch").kind).toBe("direct");
  });
});

// ===========================================================================
describe("end-to-end dispatch by reflected type", () => {
  test("`slice 2 [10,20,30]` dispatches to the List instance", () => {
    expect(ev({ call: ["slice", 2, [10, 20, 30]] })).toEqual([10, 20]);
  });
  test("`slice 2 \"abcdef\"` dispatches to the String instance", () => {
    expect(ev({ call: ["slice", 2, "abcdef"] })).toBe("ab");
  });
  test("single-binding `solo 4` resolves direct (byte-identical fast path)", () => {
    expect(ev({ call: ["solo", 4] })).toBe(40);
  });
});

// ===========================================================================
describe("the dispatch-arg partial (the §4 eta wrinkle)", () => {
  test("`(slice 2) [10,20,30]` defers then dispatches List → [10,20]", () => {
    expect(ev({ call: [{ call: ["slice", 2] }, [10, 20, 30]] })).toEqual([10, 20]);
  });
  test("`(slice 3) \"abcdef\"` defers then dispatches String → \"abc\"", () => {
    expect(ev({ call: [{ call: ["slice", 3] }, "abcdef"] })).toBe("abc");
  });
  test("the same partial re-dispatches per the SECOND arg's type (coherence)", () => {
    // Build the partial once, apply to a List then a String — each re-reflects.
    const partial = ev({ call: ["slice", 2] });
    expect(evaluate({ apply: [{ var: "p" }, [[9, 8, 7, 6]]] }, { p: partial }, ctx)).toEqual([9, 8]);
    expect(evaluate({ apply: [{ var: "p" }, ["zyxwv"]] }, { p: partial }, ctx)).toBe("zy");
  });
});

// ===========================================================================
describe("ambiguity → hard error (never a silent last-wins)", () => {
  test("a cross-class homonym throws `qualify with Class.`", () => {
    expect(() => ev({ call: ["clip", 2, [1, 2, 3]] })).toThrow(/qualify with `Class\.clip`/);
  });
  test("an unclassed homonym throws `qualify with Module.`", () => {
    expect(() => ev({ call: ["mash", 5] })).toThrow(/qualify with `Module\.mash`/);
  });
});

// ===========================================================================
// resolution-substrate Phase 3 — the soft→HARD policy for canonical bare methods.
// A bare method (nB===0, one arg-dispatched class) now dispatches HARD: it
// resolves by the arg's type when an instance exists, and ERRORS (no silent
// fall-through) when none does — exactly like the qualified `Class.method` form.
// ===========================================================================
describe("Phase 3 — bare-method dispatch is HARD (no silent fall-through)", () => {
  test("a 0-binding bare method classifies `dispatch` with NO `soft` flag", () => {
    const r = classify("chop");
    expect(r.kind).toBe("dispatch");
    if (r.kind === "dispatch") {
      expect(r.typeName).toBe("Choppable");
      expect(r.soft).toBeFalsy(); // Phase 3: promoted hard
    }
  });
  test("bare `chop 2 [list]` resolves by the reflected type (instance present)", () => {
    expect(ev({ call: ["chop", 2, [5, 6, 7, 8]] })).toEqual([5, 6]);
  });
  test("bare `chop 2 \"abc\"` ERRORS hard (no String instance) — was a silent fall-through", () => {
    expect(() => ev({ call: ["chop", 2, "abc"] })).toThrow(
      /unresolved bare dispatch "chop" via Choppable/,
    );
  });
});

// ===========================================================================
// The REAL system registry — the 4 grandfathered collisions + no regression.
// ===========================================================================
describe("system registry — grandfather + no regression", () => {
  const reg = getSystemRegistry();
  const sys = reg.evaluateContext();
  const sysClassify = (n: string): BareNameResolution => sys._resolveBareName!(n);

  test("`log`/`repeat`/`now` resolve single-binding `direct` to the conventional binding (Phase 1b retired the collisions)", () => {
    // Commits 2–4 renamed the non-conventional binding's codeName apart
    // (control:log→logSpan, control:repeat→repeatCall, std:now→nowDate), so each
    // bare name binds ONE fnId → `direct` → the conventional std/time function.
    const expected: Record<string, string> = {
      log: "std:log", repeat: "std:repeat", now: "time:now",
    };
    for (const [name, id] of Object.entries(expected)) {
      expect(sysClassify(name).kind).toBe("direct");
      expect(reg.getFunctionByCodeName(name)?.id).toBe(id);
    }
  });

  test("`contains` classifies `dispatch Containable` (Phase 1b Commit 1 — the grandfather retired)", () => {
    // The `Containable` class (String→std:contains, List→std:includes) is the
    // unique arg-dispatched owner of the multi-binding `contains` codeName
    // (`std:contains` + the `set:contains` SetExpr-decider sibling), so the
    // classifier routes bare `contains` through it instead of last-wins.
    expect(sysClassify("contains")).toEqual({ kind: "dispatch", typeName: "Containable" });
  });

  test("bare `contains` dispatches by the container's reflected type (String vs List)", () => {
    expect(evaluate({ call: ["contains", "abcdef", "cd"] }, {}, sys)).toBe(true);
    expect(evaluate({ call: ["contains", "abcdef", "zz"] }, {}, sys)).toBe(false);
    expect(evaluate({ call: ["contains", [1, 2, 3], 2] }, {}, sys)).toBe(true);
    expect(evaluate({ call: ["contains", [1, 2, 3], 9] }, {}, sys)).toBe(false);
  });

  test("a sample of single-binding names classify `direct` (the fast path)", () => {
    // includes single-binding CLASS METHODS (`eq`/`lt`/`truthy`) — these MUST
    // stay direct, never hijacked to dispatch (the hot-operator regression guard).
    // (`take`/`drop` are NO LONGER here — resolution-substrate Phase 2 Commit 4
    // made them multi-binding `Sequential` dispatch; see the next test.)
    for (const name of ["map", "filter", "add", "length", "eq", "lt", "truthy"]) {
      expect(sysClassify(name).kind).toBe("direct");
    }
  });

  test("Phase 3 — the arg-dispatched bare methods classify `dispatch` HARD (no `soft`)", () => {
    // fmap/foldr/traverse/bind/mappend resolve bare by the arg's type; the
    // Phase-1 soft fall-through is GONE (Phase 3) — a no-instance value errors.
    const expected: Record<string, string> = {
      fmap: "Functor", foldr: "Foldable", traverse: "Traversable",
      bind: "Monad", mappend: "Monoid",
    };
    for (const [m, cls] of Object.entries(expected)) {
      expect(sysClassify(m)).toEqual({ kind: "dispatch", typeName: cls });
    }
  });

  test("Phase 3 — the return-position methods STAY `direct` (nothing to reflect)", () => {
    // mempty/return/pure reflect on no argument (RETURN_POSITION) → they classify
    // `direct`, can't go bare, and STAY qualified. The spine of the partition.
    for (const name of ["mempty", "return", "pure"]) {
      expect(sysClassify(name).kind).toBe("direct");
    }
  });

  test("`take`/`drop` classify `dispatch Sequential` (the resolution-substrate Phase 2 Commit 4 collision)", () => {
    // The `Sequential Vec` instance methods were renamed `takeAxis`→`take` /
    // `dropAxis`→`drop`, so each bare codeName binds two fnIds (`std:take` +
    // `algebra:take`) and the classifier routes it through its one arg-dispatched
    // owning class — the first live bare-method dispatch in the system registry.
    for (const name of ["take", "drop"]) {
      expect(sysClassify(name)).toEqual({ kind: "dispatch", typeName: "Sequential" });
    }
  });

  test("the non-conventional renamed bindings stay reachable under their new codeNames (Phase 1b)", () => {
    // The rename-apart kept the losers discoverable, not orphaned: each new
    // codeName resolves to its original fnId.
    const renamed: Record<string, string> = {
      logSpan: "control:log", repeatCall: "control:repeat", nowDate: "std:now",
    };
    for (const [codeName, id] of Object.entries(renamed)) {
      expect(reg.getFunctionByCodeName(codeName)?.id).toBe(id);
    }
  });
});
