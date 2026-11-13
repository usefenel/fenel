// ---------------------------------------------------------------------------
// $where + function registry — the dependent-type / refinement bridge.
//
// A SetExpr `$where` predicate may call functions from the registry via
// JSON Logic's `call` operator. The caller passes an EvaluateContext
// through `contains()` (or via ValidateOptions.functions for validateForm).
// `pureEvaluateContext` filters that context to only expose pure functions
// — IO functions are foreign to type definitions.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { FenelFunction, FenelType, FormDefinition, SetExpr } from "./types";
import { containsB as contains, contains as containsTri, isSubsetB as isSubset, isSubset as isSubsetTri, normalize } from "./set-algebra";
import { evaluate, pureEvaluateContext, type EvaluateContext } from "./json-logic";
import { validateForm } from "./validate";
import { Just, Nothing } from "./type-foundation";
import { setExprToDollarKey } from "./set-marker";
import { stdModule } from "./modules/std";
import { createDispatchRegistry } from "./dispatch-registry";
import { mintTestAuthorityFor, testPerformTable } from "./authority-test-support";
import { loadFenelModule } from "./fenel-module";
import { createRegistry } from "./registry";

// A pure JSON-Logic function: returns whether n > 0.
const isPositive: FenelFunction = {
  id: "test:isPositive",
  params: [{ key: { $tag: "NamedField", ref: { $ref: "77777777-7777-4777-8777-777777777777" } }, name: "n", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }],
  returns: { $ref: "Boolean" },
  body: { ">": [{ var: "n" }, 0] },
};

// A pure native function (no body, but the registry pairs it with a
// nativeImpl entry — `pureEvaluateContext` admits it).
const isEven: FenelFunction = {
  id: "test:isEven",
  params: [{ key: { $tag: "NamedField", ref: { $ref: "88888888-8888-4888-8888-888888888888" } }, name: "n", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }],
  returns: { $ref: "Boolean" },
};

// An IO function: no body, no native impl. Resolved at runtime via
// `ioHandlers`. MUST NOT be callable from inside a type definition.
const readFromDb: FenelFunction = {
  id: "test:readFromDb",
  params: [{ key: { $tag: "NamedField", ref: { $ref: "99999999-9999-4999-8999-999999999999" } }, name: "id", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing }],
  returns: { $ref: "Number" },
};

const registry = {
  isPositive,
  isEven,
  readFromDb,
};

const fullCtx: EvaluateContext = {
  getFunction: (name: string) => registry[name as keyof typeof registry],
  natives: {
    [isEven.id]: (n: unknown) => typeof n === "number" && n % 2 === 0,
  },
};

describe("contains() with EvaluateContext — pure functions in $where", () => {
  // type-substrate P1(a.18) — EXPLICIT TIMEOUT, and it is not a mask.
  // These two cases carry no assertion cost: they pay the process's COLD ENGINE
  // BOOT, because they are the first in this file to reach `contains` and
  // `validateForm` respectively, and bun attributes a one-time cost to whichever
  // test triggers it. MEASURED on the Windows box, in isolation, at clean HEAD
  // and again with P1(a.18) applied: 5859 ms here and 190 891 ms below — both
  // over bun's 5000 ms DEFAULT, which the file never overrode. They fail
  // IDENTICALLY at clean HEAD (P1(a.18) makes this suite faster, 238.8 s to
  // 188.8 s), so the budget was wrong, not the behaviour. Sized for a slower
  // host, in the style of the rest of the engine suite.
  it("calls a JSON-Logic function from $where", () => {
    const set: SetExpr = { $tag: "SeWhere", pred: { call: ["isPositive", { var: "value" }] } };
    const ctx = pureEvaluateContext(fullCtx);
    expect(contains(set, 5, null, undefined, ctx)).toBe(true);
    expect(contains(set, -3, null, undefined, ctx)).toBe(false);
  }, 120_000);

  it("calls a native pure function from $where", () => {
    const set: SetExpr = { $tag: "SeWhere", pred: { call: ["isEven", { var: "value" }] } };
    const ctx = pureEvaluateContext(fullCtx);
    expect(contains(set, 4, null, undefined, ctx)).toBe(true);
    expect(contains(set, 5, null, undefined, ctx)).toBe(false);
  });

  it("returns false (not throws) when no EvaluateContext is provided", () => {
    const set: SetExpr = { $tag: "SeWhere", pred: { call: ["isPositive", { var: "value" }] } };
    // Phase 4T Step W2: the Tri verdict here is now `Nothing` (the call head
    // can't resolve, so the predicate produced no Boolean) — `contains` is the
    // BOOL boundary (`containsB`), which collapses `Nothing` to false. The
    // boundary result is unchanged; only the Tri underneath moved. (The retired
    // comment said "truthy(null) = false", which was the defect.)
    expect(contains(set, 5, null)).toBe(false);
  });
});

// set-algebra-to-fenel Phase 2b-contains-where — the `$where` membership arm
// evaluates with the actual reader frame when one is supplied. The detached
// no-caller path retains its canonical engine functions.
describe("contains() $where — authoritative reader + Err-posture", () => {
  const lengthAtLeastThree: SetExpr = {
    $tag: "SeWhere",
    pred: { ">=": [{ call: ["std:length", { var: "value" }] }, 3] },
  };

  it("abstains when the reader does not expose std:length", () => {
    const ctx = pureEvaluateContext(fullCtx);
    expect(containsTri(lengthAtLeastThree, "abcd", null, undefined, ctx)).toEqual(Nothing);
    expect(containsTri(lengthAtLeastThree, "ab", null, undefined, ctx)).toEqual(Nothing);
  });

  it("uses the exact std:length declaration and native supplied by the reader", () => {
    const length = stdModule.functions?.find((fn) => fn.id === "std:length");
    const lengthNative = stdModule.nativeImpls?.["std:length"];
    if (length === undefined || lengthNative === undefined) {
      throw new Error("the canonical std:length fixture is unavailable");
    }
    const ctx = pureEvaluateContext({
      ...fullCtx,
      getFunction: (name) => name === length.id ? length : fullCtx.getFunction?.(name),
      natives: { ...fullCtx.natives, [length.id]: lengthNative },
    });
    expect(containsTri(lengthAtLeastThree, "abcd", null, undefined, ctx)).toEqual(Just(true));
    expect(containsTri(lengthAtLeastThree, "ab", null, undefined, ctx)).toEqual(Just(false));
  });

  it("retains canonical std:length behavior without a caller frame", () => {
    expect(containsTri(lengthAtLeastThree, "abcd", null)).toEqual(Just(true));
    expect(containsTri(lengthAtLeastThree, "ab", null)).toEqual(Just(false));
  });

  it("resolves a USER function from the actual reader", () => {
    const set: SetExpr = { $tag: "SeWhere", pred: { call: ["isPositive", { var: "value" }] } };
    const ctx = pureEvaluateContext(fullCtx);
    expect(containsTri(set, 5, null, undefined, ctx)).toEqual(Just(true));
    expect(containsTri(set, -3, null, undefined, ctx)).toEqual(Just(false));
  });

  // decide-substrate Phase 4T Step W2 — this case previously read:
  //
  //   it("D-errposture: an unresolvable predicate collapses to Just false
  //       (conservative, byte-parity)", …)   expect(…).toEqual(Just(false))
  //
  // and its comment claimed "the eager eval is a falsy/Err". BOTH halves were
  // wrong. The unresolvable call does not throw and produces no Err — it
  // returns host `null` (`invokeFunction` misses ⇒ `callOp` returns null), which
  // the retired `truthy` coercion turned into a DEFINITE refutation. `Just
  // false` is not conservative for membership; only `Nothing` is. The test was
  // canonising the defect, so it is inverted here rather than preserved.
  it("W2: an unresolvable predicate is Nothing, NOT a refutation", () => {
    const set: SetExpr = { $tag: "SeWhere", pred: { call: ["isPositive", { var: "value" }] } };
    expect(containsTri(set, 5, null)).toEqual(Nothing);
  });

  it("cannot exercise an otherwise authorized mediated native during membership", () => {
    const id = "test:whereAct";
    const registry = createDispatchRegistry();
    registry.defineClass({ name: "WhereAct", params: [{ name: "scope" }], methods: [] });
    const act: FenelFunction = {
      id,
      params: [],
      returns: { $ref: "Boolean" },
      requires: [{ class: { $tag: "Id", entityId: "WhereAct" }, args: [{ $var: "scope" }] }],
    };
    let hits = 0;
    const table = testPerformTable();
    table.register(id, () => {
      hits++;
      return true;
    }, 1);
    const ctx: EvaluateContext = {
      getFunction: (name) => name === id ? act : undefined,
      _specRegistry: registry,
      _activeScopeToken: "account",
      _nativePerformDescriptors: { context: Object.create(null), plain: { [id]: true } },
      _performTable: table.handle,
      _authority: mintTestAuthorityFor([id]),
    };

    expect(evaluate({ call: [id] }, {}, ctx)).toBe(true);
    expect(hits).toBe(1);
    const set: SetExpr = { $tag: "SeWhere", pred: { call: [id] } };
    expect(containsTri(set, 0, null, undefined, ctx)).toEqual(Nothing);
    expect(hits).toBe(1);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// decide-substrate Phase 4T Step W2 — the `whereMember` Tri gate.
//
// The rule: `Just b` iff the predicate terminated normally with a value that IS
// a host Boolean. Every other outcome is `Nothing`. Each case below decided
// WRONGLY on HEAD before the repair; the `Just true` ones are the worse class
// (a positive membership proof minted from an error or an abstention).
// ---------------------------------------------------------------------------
describe("W2 — whereMember returns Just only for a host-Boolean predicate result", () => {
  const where = (pred: unknown): SetExpr => ({ $tag: "SeWhere", pred } as SetExpr);

  it("a predicate that THROWS is Nothing (was Just false — a refutation from a crash)", () => {
    const boom: FenelFunction = {
      id: "test:boom",
      params: [{ key: { $tag: "NamedField", ref: { $ref: "66666666-6666-4666-8666-666666666666" } }, name: "n", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing }],
      returns: { $ref: "Boolean" },
    };
    const ctx: EvaluateContext = {
      getFunction: (n: string) => (n === "boom" || n === "test:boom" ? boom : undefined),
      natives: { "test:boom": () => { throw new Error("boom"); } },
    };
    expect(containsTri(where({ call: ["boom", { var: "value" }] }), 5, null, undefined, ctx)).toEqual(Nothing);
  });

  it("an Err-tagged result is Nothing (was Just TRUE — membership proven by an error)", () => {
    expect(containsTri(where({ $tag: "Err", _0: "bad" }), 5, null)).toEqual(Nothing);
  });

  it("an UNSATURATED application is Nothing (was Just TRUE — a partial read as proof)", () => {
    // `isPositive` takes one argument; applying it to none yields a partial
    // application VALUE, which `truthy` read as `true`.
    const ctx = pureEvaluateContext(fullCtx);
    expect(containsTri(where({ call: ["isPositive"] }), 5, null, undefined, ctx)).toEqual(Nothing);
  });

  it("a THROWING enumerable getter on the candidate is Nothing, not an escaping throw", () => {
    // The candidate is spread into the predicate's local data. If that spread
    // sits outside the try, a getter that throws makes membership THROW rather
    // than abstain — which would make "a throw ⇒ Nothing" false at the seam.
    const hostile = Object.defineProperty({}, "boom", {
      enumerable: true,
      get() { throw new Error("getter-boom"); },
    });
    expect(containsTri(where({ ">": [{ var: "value" }, 0] }), hostile, null)).toEqual(Nothing);
  });

  it("a Nothing result is Nothing (was Just TRUE — an abstention read as proof)", () => {
    expect(containsTri(where({ $tag: "Nothing" }), 5, null)).toEqual(Nothing);
  });

  it("a `Just false` result is Nothing (was Just TRUE — a decided NEGATIVE read as proof)", () => {
    expect(containsTri(where({ $tag: "Just", _0: false }), 5, null)).toEqual(Nothing);
  });

  it("a malformed `{$tag:'True',_0:123}` is Nothing — host booleans only", () => {
    // `{construct:["True",123]}` evaluates to this shape (only the exact nullary
    // constructor is coerced to a host boolean), so a `$tag === "True"` test
    // would accept a non-Boolean as `Just true`. The gate rejects it.
    expect(containsTri(where({ construct: ["True", 123] }), 5, null)).toEqual(Nothing);
  });

  it("an unbound field read ABSTAINS (P1(a.13); W2 froze it as Just false — RETIRED)", () => {
    // W2 read this as "the predicate ran and said no", separating it from the
    // unresolvable-call case purely on the top-level result shape. The owner's
    // re-cut (consult note §6.4) is that reading a missing field IS a
    // resolution failure: the test could not be run, so the honest verdict is
    // `Nothing`. An EXPLICIT default still decides — see
    // `where-proof-frames.test.ts`.
    expect(containsTri(where({ ">": [{ var: "noSuchField" }, 0] }), 5, null)).toEqual(Nothing);
  });

  it("ordinary Boolean predicates are unaffected", () => {
    expect(containsTri(where({ ">": [{ var: "value" }, 0] }), 5, null)).toEqual(Just(true));
    expect(containsTri(where({ ">": [{ var: "value" }, 0] }), -5, null)).toEqual(Just(false));
  });

  // W2's honest fence — CLOSED for the interpreted no-value family by
  // type-substrate P1(a.13): the gate read only the TOP-LEVEL result, so a
  // failure an enclosing operator had already laundered into a Boolean still
  // decided. A where-proof FRAME now records the failure where it happens, so
  // no enclosing operator and no downstream catcher can launder it. The row
  // stays UNSOUND-KNOWN for four NAMED residual lanes — the full battery,
  // including what still decides and why, is `where-proof-frames.test.ts`.
  it("REPAIRED (mem.where.prov, P1(a.13)): a laundered failure abstains", () => {
    expect(containsTri(where({ ">": [{ call: ["nope:notAFn"] }, 0] }), 5, null)).toEqual(Nothing);
    expect(containsTri(where({ "!": [{ call: ["nope:notAFn"] }] }), 5, null)).toEqual(Nothing);
  });
});

describe("pureEvaluateContext — IO functions are foreign to types", () => {
  it("rejects calls to functions without body or native impl", () => {
    // readFromDb has neither body nor native — `pureEvaluateContext` filters it
    // out, so the call produces NO VALUE. P1(a.13): the Tri verdict is now
    // `Nothing` ("this test could not be run") rather than a manufactured
    // `Just false`; the Boolean face still collapses to `false`, so the product
    // answer — an IO function is foreign to a type definition — is unchanged.
    const set: SetExpr = { $tag: "SeWhere", pred: { call: ["readFromDb", "any-id"] } };
    const ctx = pureEvaluateContext(fullCtx);
    expect(containsTri(set, 0, null, undefined, ctx)).toEqual(Nothing);
    expect(contains(set, 0, null, undefined, ctx)).toBe(false);
    expect(contains(set, 42, null, undefined, ctx)).toBe(false);
  });

  it("admits pure but rejects IO from the same registry", () => {
    const ctx = pureEvaluateContext(fullCtx);
    // Pure: visible
    expect(ctx.getFunction?.("isPositive")).toBe(isPositive);
    expect(ctx.getFunction?.("isEven")).toBe(isEven);
    // IO: hidden
    expect(ctx.getFunction?.("readFromDb")).toBeUndefined();
  });

  it("undefined input → empty context (no functions visible)", () => {
    const ctx = pureEvaluateContext(undefined);
    expect(ctx.getFunction).toBeUndefined();
    expect(ctx.natives).toBeUndefined();
  });
});

describe("validateForm — opts.functions threads to $where in refinement types", () => {
  // A field whose value must satisfy isPositive — encoded as a $refined
  // wrapping a Number with a $where SetExpr that calls the registry.
  const PositiveNumber: FenelType = {
    $refined: {
      base: { $ref: "Number" },
      set: { $tag: "SeWhere", pred: { call: ["isPositive", { var: "value" }] } },
    },
  };

  const def: FormDefinition = {
    slug: "test",
    type: {
      $record: {
        fields: [{ key: { $tag: "NamedField", ref: { $ref: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }, name: "n", label: Nothing, type: PositiveNumber, meta: {}, ui: Nothing }],
      },
    },
  };

  it("accepts a value that the pure function approves", () => {
    const result = validateForm(def, { n: 7 }, null, { functions: fullCtx });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a value that the pure function disapproves", () => {
    const result = validateForm(def, { n: -2 }, null, { functions: fullCtx });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("without opts.functions, $where with call falls back to false", () => {
    // No registry → the call produces no value → P1(a.13) makes the membership
    // `Nothing` rather than a manufactured `Just false`. Validation collapses
    // both to the same rejection, so the product answer is unchanged.
    const result = validateForm(def, { n: 7 }, null);
    expect(result.valid).toBe(false);
  }, 600_000); // cold engine boot — see the note on the first case in this file
});

// Equality over atomic Strings is an exact extraction fragment. Numeric
// ordering deliberately is not: the native comparison and interval disagree
// on exact-integer records (comprehend.cphVarLeft's native-carrier fence).
// Load the actual source declaration and its std imports for the positive
// fixture, rather than inventing an interval the predicate cannot justify.
let extractionReaderCache: EvaluateContext | undefined;
function extractionReader(): EvaluateContext {
  if (extractionReaderCache === undefined) {
    const source = loadFenelModule(`module WhereExtract where

isA : (s: String) -> Bool
isA s = eq s "a"
`, "WhereExtract");
    extractionReaderCache = pureEvaluateContext(createRegistry([stdModule, source]).evaluateContext());
  }
  return extractionReaderCache;
}

const stringCallSet: SetExpr = { $tag: "SeWhere", pred: { call: ["WhereExtract:isA", { var: "value" }] } };
const numericCallSet: SetExpr = { $tag: "SeWhere", pred: { call: ["isPositive", { var: "value" }] } };

describe("normalize — extracts $where with function calls when evalCtx is provided", () => {
  it("with evalCtx: $where call extracts and normalizes to its structural form", () => {
    const ctx = extractionReader();
    expect(evaluate({ call: ["WhereExtract:isA", "a"] }, {}, ctx)).toBe(true);
    expect(evaluate({ call: ["WhereExtract:isA", "b"] }, {}, ctx)).toBe(false);
    expect(setExprToDollarKey(normalize(stringCallSet, ctx))).toEqual({ $enum: ["a"] });
  });

  it("without evalCtx: $where call is opaque, normalize leaves it as-is", () => {
    expect(normalize(stringCallSet)).toEqual(stringCallSet);
  });

  it("numeric ordering still executes, but its carrier-sensitive extraction abstains", () => {
    const ctx = pureEvaluateContext(fullCtx);
    expect(containsTri(numericCallSet, 5, null, undefined, ctx)).toEqual(Just(true));
    expect(containsTri(numericCallSet, -3, null, undefined, ctx)).toEqual(Just(false));
    expect(normalize(numericCallSet, ctx)).toEqual(numericCallSet);
    const halfLine: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Nothing } };
    expect(isSubsetTri(numericCallSet, halfLine, ctx)).toEqual(Nothing);
  });
});

describe("whereToSetExpr — handles `apply` op the same as `call`", () => {
  // `apply: ["fnName", [args]]` should extract identically to `call`.
  const stringApplySet: SetExpr = { $tag: "SeWhere", pred: { apply: ["WhereExtract:isA", [{ var: "value" }]] } };

  it("the actual String equality predicate via apply extracts to the same singleton", () => {
    expect(isSubset(stringApplySet, { $tag: "SeEnum", values: ["a"] }, extractionReader())).toBe(true);
    expect(normalize(stringApplySet)).toEqual(stringApplySet);
    const numericApplySet: SetExpr = { $tag: "SeWhere", pred: { apply: ["isPositive", [{ var: "value" }]] } };
    const halfLine: SetExpr = { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Nothing } };
    expect(isSubsetTri(numericApplySet, halfLine, pureEvaluateContext(fullCtx))).toEqual(Nothing);
  });
});

describe("isSubset — extracts $where with function calls structurally", () => {
  it("isA(value) is a subset of a broader String enumeration by inlining its actual body", () => {
    expect(isSubset(stringCallSet, { $tag: "SeEnum", values: ["a", "b"] }, extractionReader())).toBe(true);
  });

  it("isA(value) matches its singleton exactly after extraction", () => {
    expect(isSubset(stringCallSet, { $tag: "SeEnum", values: ["a"] }, extractionReader())).toBe(true);
  });

  it("isA(value) is not a subset of a different String singleton", () => {
    expect(isSubsetTri(stringCallSet, { $tag: "SeEnum", values: ["b"] }, extractionReader())).toEqual(Just(false));
  });

  it("without the actual reader, isA(value) is opaque — cannot prove subset", () => {
    expect(isSubsetTri(stringCallSet, { $tag: "SeEnum", values: ["a"] })).toEqual(Nothing);
  });
});
