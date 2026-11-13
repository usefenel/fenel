// Collection membership agrees with structural `eq` (recipe-functions S1,
// workstreams/recipe-functions/ledger.md §4, §12 "NaN").
//
// Born as the P0/P1 probe (workstreams/recipe-functions/probes/p1-equality.test.ts),
// which pinned the pre-S1 defect: std `includes` / `elem` / `unique` compared by
// JS reference (SameValueZero) while every nullary constructor other than
// True/False evaluates to a fresh `{$tag}` object, so equal ADT values built
// separately were never found. Rows marked "S1" are the flipped regression rows
// (each was watched failing before the fix). The second describe block is the
// differential parity test of the Fenel bodies (collection-native.fenel)
// against their B4 fast paths (std-ffi.ts) over the P1 value matrix.
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFenelModule } from "./fenel-module";
import { evaluate, invokeCallable, runtimeNativeInvocationKeys, withInstance, type EvaluateContext } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { dispatchRegistry } from "./system-entities";
import { withInterpretedResolver } from "./engine-bodies-dispatch";
import { stdNatives, stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";
import { Maybe } from "./type-foundation";
import { compileFenelToJsNative } from "./modules/compile-js";
import { dispatchedSerializeJsModule } from "./engine-bodies-dispatch";
import { compileModuleCallBindings } from "./compile-call-bindings";
import { positionalCompileFieldSlots } from "./compile-field-slots";
import type { CompileSource } from "./compilable";
import type { ModuleRegistry } from "./registry";

const SOURCE = `module RecipeProbeEq where

Food = Butter | CoconutCream | Honey | LemonJuice | Egg | Tomato | Watermelon | Cucumber

Qty = Grams Number | Pinch

memb : (xs: List a) -> (v: a) -> Boolean
memb xs v = includes xs v

el : (v: a) -> (xs: b) -> Boolean
el v xs = elem v xs

uniq : (xs: List a) -> List a
uniq xs = unique xs

dc : (xs: List a) -> Nat
dc xs = distinctCount xs

same : (a: t) -> (b: t) -> Boolean
same a b = eq a b

butter : Food
butter = Butter

foods : List Food
foods = [Butter, Honey]

inlineIncludes : Boolean
inlineIncludes = includes [Butter, Honey] Butter

inlineElem : Boolean
inlineElem = elem Butter [Butter, Honey]

inlineEq : Boolean
inlineEq = eq Butter Butter

inlineUnique : List Food
inlineUnique = unique [Butter, Butter, Honey]

inlineDistinct : Nat
inlineDistinct = distinctCount [Butter, Butter, Honey]

payloadIncludes : Boolean
payloadIncludes = includes [Grams 5, Pinch] (Grams 5)

payloadNullaryIncludes : Boolean
payloadNullaryIncludes = includes [Grams 5, Pinch] Pinch

recordIncludes : Boolean
recordIncludes = includes [{ a = 1, b = { c = Butter } }] { a = 1, b = { c = Butter } }

recordReorderedEq : Boolean
recordReorderedEq = eq { a = 1, b = 2 } { b = 2, a = 1 }

recordReorderedDistinct : Nat
recordReorderedDistinct = distinctCount [{ a = 1, b = 2 }, { b = 2, a = 1 }]

sameClosureIncludes : Boolean
sameClosureIncludes = let f = (\\x -> x) in includes [f] f

sameClosureEq : Boolean
sameClosureEq = let f = (\\x -> x) in eq f f

freshClosureIncludes : Boolean
freshClosureIncludes = includes [\\x -> x] (\\x -> x)

refIncludes : Boolean
refIncludes = includes [memb] memb

refEq : Boolean
refEq = eq memb memb

refValue : (xs: List a) -> (v: a) -> Boolean
refValue = memb

mkClosure : (n: Number) -> (a -> a)
mkClosure n = \\x -> x

boolIncludes : Boolean
boolIncludes = includes [True, False] True

substring : Boolean
substring = elem "ut" "Butter"

includesOnString : Boolean
includesOnString = includes "Butter" "ut"

swapMaybe : (m: Maybe Number) -> Maybe Number
swapMaybe m = case m of
  Nothing -> Just 1
  Just n -> if eq n 1 then Nothing else Just n
`;

let ctx: EvaluateContext;
let registry: ModuleRegistry;
const call = (name: string, ...args: unknown[]): unknown =>
  withInterpretedResolver(() => invokeCallable({ $ref: `RecipeProbeEq:${name}` }, args, ctx));
const jsonRoundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

beforeAll(() => withInterpretedResolver(() => {
  registry = createRegistry([stdModule, loadFenelModule(SOURCE, "RecipeProbeEq")], { dispatchRegistry });
  ctx = registry.evaluateContext();
}), 900_000);

describe("P1 — nullary constructors are fresh objects, eq is structural", () => {
  test("each evaluation of Butter is a distinct object; eq says equal", () => {
    const a = call("butter");
    const b = call("butter");
    expect(a).toEqual({ $tag: "Butter" });
    expect(a === b).toBe(false);
    expect(call("same", a, b)).toBe(true);
    expect(call("inlineEq")).toBe(true);
  });

  test("includes / elem on separately constructed nullary ADT values (S1)", () => {
    expect(call("inlineIncludes")).toBe(true);
    expect(call("inlineElem")).toBe(true);
    expect(call("memb", call("foods"), call("butter"))).toBe(true);
    expect(call("el", call("butter"), call("foods"))).toBe(true);
  });

  test("unique keeps first occurrences under eq; distinctCount = length . unique (S1)", () => {
    expect(call("inlineUnique")).toEqual([{ $tag: "Butter" }, { $tag: "Honey" }]);
    expect(call("inlineDistinct")).toBe(2);
  });

  test("payload constructors and nested records: structural membership (S1)", () => {
    expect(call("payloadIncludes")).toBe(true);
    expect(call("payloadNullaryIncludes")).toBe(true);
    expect(call("recordIncludes")).toBe(true);
  });

  test("record key order: eq and distinctCount are both order-robust (S1)", () => {
    expect(call("recordReorderedEq")).toBe(true);
    expect(call("recordReorderedDistinct")).toBe(1);
    // Host-supplied (e.g. JSON-decoded) records with another key order: one value.
    expect(call("dc", [{ a: 1, b: 2 }, { b: 2, a: 1 }])).toBe(1);
  });

  test("JSON round trip: round-tripped values are found (S1)", () => {
    const xs = jsonRoundTrip(call("foods"));
    const v = jsonRoundTrip(call("butter"));
    expect(call("memb", xs, v)).toBe(true);
    expect(call("same", (xs as unknown[])[0], v)).toBe(true);
  });

  test("callables: closures by identity (even one let-bound closure is fresh per read); named-fn refs are structural data", () => {
    // Documented, not changed by S1: `eq` keeps callable identity, and each read of a
    // let-bound `f` yields a fresh callable carrier, so even ONE closure is not found in a
    // list holding it (membership agrees with `eq f f`, which is false).
    expect(call("sameClosureIncludes")).toBe(false);
    expect(call("sameClosureEq")).toBe(false);
    expect(call("freshClosureIncludes")).toBe(false);
    // A function named as data is a plain reference carrier, fresh per occurrence but
    // structurally equal, so membership now finds it (S1).
    expect(call("refIncludes")).toBe(true);
    const r1 = call("refValue");
    const r2 = call("refValue");
    expect(r1 === r2).toBe(false);
    expect(call("refEq")).toBe(true);
    expect(call("same", r1, r2)).toBe(true);
  });

  test("Bool stays a JS boolean, so membership already works", () => {
    expect(call("boolIncludes")).toBe(true);
  });

  test("strings: elem is substring; includes/unique/distinctCount treat a String as before S1 (not a list)", () => {
    expect(call("substring")).toBe(true);
    expect(call("includesOnString")).toBe(false);
    // Review S1-2 [Decision]: no String traversal in S1. A non-array is the
    // empty list for these three, exactly as the pre-S1 natives (`toArr`).
    expect(call("memb", "Butter", "u")).toBe(false);
    expect(call("uniq", "aab")).toEqual([]);
    expect(call("dc", "aab")).toBe(0);
  });

  test("elem's String arm keeps JS String conversion of the needle (review S1-1)", () => {
    // `String(null)` is "null", never "" — null/undefined are not found in an
    // arbitrary String, as before S1 and as legacy JSON Logic `in`.
    for (const [needle, hay, want] of [
      [null, "Butter", false], [undefined, "Butter", false],
      [null, "null", true], [undefined, "undefined", true],
      [null, "undefined", false], [undefined, "null", false],
    ] as const) {
      expect([needle, hay, call("el", needle, hay)]).toEqual([needle, hay, want]);
      expect([needle, hay, stdNatives.elem!(needle, hay)]).toEqual([needle, hay, want]);
    }
  });

  test("NaN: eq false, so includes/elem never find NaN and unique keeps every NaN (S1, §12)", () => {
    expect(call("same", NaN, NaN)).toBe(false);
    expect(call("memb", [NaN], NaN)).toBe(false);
    expect(call("el", NaN, [NaN])).toBe(false);
    expect((call("uniq", [NaN, NaN]) as unknown[]).length).toBe(2);
    expect(call("dc", [NaN, NaN])).toBe(2);
  });

  test("distinctCount is eq-based, not JSON-based: closures, undefined-valued keys (S1)", () => {
    // Two closures built by the same lambda (the P0 probe used a bare
    // `{lambda: …}` JSON node here, which evaluates to a plain record, not a closure).
    const f = call("mkClosure", 1);
    const g = call("mkClosure", 2);
    expect(f === g).toBe(false);
    expect((f as { __fenelFn?: unknown }).__fenelFn).toBe(true);
    expect(call("dc", [f, g])).toBe(2);
    expect(call("dc", [{ a: 1, b: undefined }, { a: 1 }])).toBe(2); // key sets differ under eq
  });

  test("legacy JSON Logic `in`: array arm is structural eq, string arm is substring (S1)", () => {
    const run = (rule: unknown, data: Record<string, unknown>) => withInterpretedResolver(() => evaluate(rule, data, ctx));
    const fresh = { needle: { $tag: "Butter" }, hay: [{ $tag: "Butter" }] };
    expect(run({ in: [{ var: "needle" }, { var: "hay" }] }, fresh)).toBe(true);
    expect(run({ in: [{ var: "n" }, { var: "hay" }] }, { n: NaN, hay: [NaN] })).toBe(false);
    expect(run({ in: ["ut", "Butter"] }, {})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Differential parity: the Fenel bodies (source of truth) against the B4 fast
// paths. The "body" frame is the ordinary registry frame with the three fast
// paths removed from both native maps, so `invokeFunction` falls through to the
// Fenel body (its selector order is nativesCtx -> natives -> body).
// `elem` stays a bodyless native (the compiled parser/resolver owners need it
// as a host leaf); its specification is stated in Fenel terms below
// (`contains` on a String haystack, the `includes` BODY on a List).
// ---------------------------------------------------------------------------
const FAST_PATHS = new Set(["includes", "unique", "distinctCount"]);
const shortCode = (key: string): string => key.replace(/^.*[:.]/, "");
let bodyCtx: EvaluateContext;
const viaBody = (name: string, ...args: unknown[]): unknown =>
  withInterpretedResolver(() => invokeCallable({ $ref: `std:${name}` }, args, bodyCtx));
const viaFast = (name: string, ...args: unknown[]): unknown =>
  withInterpretedResolver(() => invokeCallable({ $ref: `std:${name}` }, args, ctx));

describe("S1 parity — Fenel bodies vs fast paths over the P1 value matrix", () => {
  beforeAll(() => {
    bodyCtx = membershipSourceFrame(ctx);
  });

  const matrix = (): unknown[] => {
    const f = call("mkClosure", 1);
    const g = call("mkClosure", 2);
    return [
      call("butter"), { $tag: "Butter" }, { $tag: "Honey" }, { $tag: "Grams", _0: 5 }, { $tag: "Grams", _0: 5 },
      { $tag: "Pinch" }, { a: 1, b: { c: { $tag: "Butter" } } }, { b: { c: { $tag: "Butter" } }, a: 1 },
      { a: 1, b: undefined }, { a: 1 }, {}, {}, [1, [2]], [1, [2]], [], f, g, f,
      call("refValue"), call("refValue"), NaN, NaN, 0, -0, 1, "1", true, 1, false, 0, "", null, undefined,
      "a", "é", "😀", "a",
    ];
  };

  test("the body frame really runs the Fenel bodies (no fast path left)", () => {
    for (const map of [bodyCtx.natives, bodyCtx.nativesCtx]) {
      for (const key of Object.keys(map ?? {})) expect(FAST_PATHS.has(shortCode(key))).toBe(false);
    }
    expect(Object.keys(stdNatives).filter((k) => FAST_PATHS.has(k))).toEqual([]);
    expect(Object.keys(stdNativesCtx).filter((k) => FAST_PATHS.has(k)).sort()).toEqual(["distinctCount", "includes", "unique"]);
    expect(viaBody("includes", [{ $tag: "Butter" }], call("butter"))).toBe(true);
    expect(viaBody("unique", [NaN, NaN, 1, 1])).toEqual([NaN, NaN, 1]);
  });

  test("includes: every (prefix, needle) pair of the matrix", () => {
    const m = matrix();
    for (let n = 0; n <= m.length; n += 6) {
      const xs = m.slice(0, n);
      for (const v of m) expect([n, v, viaFast("includes", xs, v)]).toEqual([n, v, viaBody("includes", xs, v)]);
    }
  }, 900_000);

  test("unique and distinctCount: the matrix, its reverse, and windows", () => {
    const m = matrix();
    const lists = [m, [...m].reverse(), m.slice(3, 20), [NaN, NaN, null, undefined, null], [0, -0, "0", false]];
    for (const xs of lists) {
      const fast = viaFast("unique", xs) as unknown[];
      const body = viaBody("unique", xs) as unknown[];
      expect(fast.length).toBe(body.length);
      // Same elements BY IDENTITY, in the same order: first occurrences are kept.
      for (let i = 0; i < fast.length; i++) expect(Object.is(fast[i], body[i])).toBe(true);
      expect(viaFast("distinctCount", xs)).toBe(viaBody("distinctCount", xs));
    }
  }, 900_000);

  test("non-list arguments (a String included) are the empty list, as before S1", () => {
    for (const arg of ["Butter", "aab😀😀", "", 5, { a: 1 }, null, undefined, true]) {
      expect(viaFast("includes", arg, "u")).toBe(viaBody("includes", arg, "u"));
      expect(viaFast("unique", arg)).toEqual(viaBody("unique", arg));
      expect(viaFast("distinctCount", arg)).toBe(viaBody("distinctCount", arg));
    }
    expect(viaBody("unique", "aab😀😀")).toEqual([]);
    expect(viaBody("includes", "Butter", "u")).toBe(false);
  }, 900_000);

  test("elem (bodyless native) uses String conversion for substrings and stock structural membership for Lists", () => {
    const m = matrix();
    // A needle with no string conversion (a null-prototype record) throws in
    // both `toString` and the fast path: compare outcomes, throws included.
    const outcome = (run: () => unknown): unknown => {
      try { return { value: run() }; } catch { return "threw"; }
    };
    // String arm: `contains hay (toString needle)` except that the needle's
    // conversion is JS `String` (null -> "null", undefined -> "undefined"),
    // where std `toString` gives "" (review S1-1: the pre-S1 behaviour, kept).
    const spec = (needle: unknown, hay: unknown): unknown => outcome(() =>
      typeof hay === "string" ? viaBody("contains", hay, needle == null ? String(needle) : viaBody("toString", needle))
        : Array.isArray(hay) ? viaBody("includes", hay, needle) : false);
    for (const hay of [m, m.slice(0, 9), [], "Butter", "a😀b", 5, { a: 1 }, null]) {
      for (const needle of [...m.slice(0, 12), "ut", "😀", 5, null, undefined, "null"]) {
        expect([hay, needle, outcome(() => viaFast("elem", needle, hay))]).toEqual([hay, needle, spec(needle, hay)]);
      }
    }
  }, 900_000);

  test("large collections: fast paths need no harness per element and stay fast", () => {
    const big = Array.from({ length: 50_000 }, (_, i) => (i % 2 === 0 ? i % 1000 : { $tag: "Grams", _0: i % 50 }));
    const t0 = performance.now();
    expect(viaFast("distinctCount", big)).toBe(500 + 25);
    expect(viaFast("includes", big, { $tag: "Grams", _0: 49 })).toBe(true);
    expect((viaFast("unique", big) as unknown[]).length).toBe(525);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});

// The oracle removes only the stock shortcuts. User-supplied collection
// overrides remain dependencies of another collection's source body.
const membershipSourceFrame = (reader: EvaluateContext): EvaluateContext => {
  const strip = <T extends object>(map: T | undefined, stock: Record<string, unknown>): T | undefined => {
    if (map === undefined) return undefined;
    const copy = Object.create(Object.getPrototypeOf(map)) as T;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(map))) {
      if (FAST_PATHS.has(shortCode(key)) && "value" in descriptor && descriptor.value === stock[shortCode(key)]) continue;
      Object.defineProperty(copy, key, descriptor);
    }
    return copy;
  };
  return { ...reader, natives: strip(reader.natives, stdNatives), nativesCtx: strip(reader.nativesCtx, stdNativesCtx) };
};

describe("S1 reader semantics — shortcuts preserve selected dependencies", () => {
  const check = (reader: EvaluateContext, name: string, args: unknown[], expected: unknown): void => {
    const source = membershipSourceFrame(reader);
    const oracle = withInterpretedResolver(() => invokeCallable({ $ref: `std:${name}` }, args, source));
    expect(oracle).toEqual(expected);
    expect(withInterpretedResolver(() => invokeCallable({ $ref: `std:${name}` }, args, reader))).toEqual(oracle);
  };
  const duplicates = () => [{ $tag: "Butter" }, { $tag: "Butter" }];

  test("the stock reader retains the shortcut without entering a source closure", () => {
    let sourceEntries = 0;
    const reader = { ...ctx, getFunctionLexicalData: (name: string) => {
      if (FAST_PATHS.has(shortCode(name))) sourceEntries++;
      return ctx.getFunctionLexicalData?.(name);
    } };
    expect(withInterpretedResolver(() => invokeCallable({ $ref: "std:unique" }, [[1, 1]], reader))).toEqual([1]);
    expect(sourceEntries).toBe(0);
  });

  test("a missing stock fold native falls through to its source dependency closure", () => {
    const nativesCtx = { ...ctx.nativesCtx };
    delete nativesCtx["std:fold"];
    delete nativesCtx["std.fold"];
    delete nativesCtx.fold;
    let sourceEntries = 0;
    const reader = { ...ctx, nativesCtx, getFunctionLexicalData: (name: string) => {
      if (name === "std:unique") sourceEntries++;
      return ctx.getFunctionLexicalData?.(name);
    } };
    expect(withInterpretedResolver(() => invokeCallable({ $ref: "std:unique" }, [[1, 1]], reader))).toEqual([1]);
    expect(sourceEntries).toBeGreaterThan(0);
  });

  test("a customized array iterator cannot replace indexed source membership", () => {
    const values = [1];
    Object.defineProperty(values, Symbol.iterator, { value: function* () { yield 2; } });
    check(ctx, "includes", [values, 1], true);
  });

  test("a plain collection override keeps precedence through the stock context wrapper", () => {
    const reader = { ...ctx, natives: { ...ctx.natives, "std:includes": () => false } };
    expect(withInterpretedResolver(() => invokeCallable({ $ref: "std:includes" }, [[1], 1], reader))).toBe(false);
  });

  test("a plain collection override remains a dependency of another source body", () => {
    const reader = { ...ctx, natives: { ...ctx.natives, "std:includes": () => false } };
    check(reader, "unique", [[1, 1]], [1, 1]);
    check(reader, "distinctCount", [[1, 1]], 2);
  });

  test("bare contextual overrides retain their incoming invocation key", () => {
    const reader = { ...ctx, nativesCtx: { ...ctx.nativesCtx, includes: () => false } };
    expect(withInterpretedResolver(() => invokeCallable({ $ref: "includes" }, [[1], 1], reader))).toBe(false);
    expect(withInterpretedResolver(() => invokeCallable({ $ref: "std:includes" }, [[1], 1], reader))).toBe(true);
  });

  test("bare plain overrides use the reader's source route without intercepting canonical calls", () => {
    const reader = { ...ctx, natives: { ...ctx.natives, includes: () => false } };
    expect(withInterpretedResolver(() => invokeCallable({ $ref: "includes" }, [[1], 1], reader))).toBe(false);
    expect(withInterpretedResolver(() => invokeCallable({ $ref: "std:includes" }, [[1], 1], reader))).toBe(true);
  });

  for (const kind of ["contextual", "plain"] as const) {
    test(`UUID ${kind} overrides retain their incoming invocation key`, () => {
      const identity = "6201cacc-43d1-46a8-8f1e-c1233e668a65";
      const canonical = ctx.getFunction!("std:includes")!;
      const reader = {
        ...ctx,
        getFunction: (key: string) => key === identity ? canonical : ctx.getFunction!(key),
        ...(kind === "contextual" ? { nativesCtx: { ...ctx.nativesCtx, [identity]: () => false } }
          : { natives: { ...ctx.natives, [identity]: () => false } }),
      };
      expect(withInterpretedResolver(() => invokeCallable({ $ref: identity }, [[1], 1], reader))).toBe(false);
      expect(withInterpretedResolver(() => invokeCallable({ $ref: "std:includes" }, [[1], 1], reader))).toBe(true);
    });
  }

  test("an admitted alternative name retains its contextual override", () => {
    const canonical = ctx.getFunction!("std:includes")!;
    const reader = {
      ...ctx,
      getFunction: (key: string) => key === "readerHas" ? canonical : ctx.getFunction!(key),
      nativesCtx: { ...ctx.nativesCtx, readerHas: () => false },
    };
    expect(withInterpretedResolver(() => invokeCallable({ $ref: "readerHas" }, [[1], 1], reader))).toBe(false);
  });

  test("name-slot context overrides precede canonical plain overrides on a bare call", () => {
    const reader = { ...ctx, nativesCtx: { ...ctx.nativesCtx, includes: () => false }, natives: { ...ctx.natives, "std:includes": () => true } };
    expect(withInterpretedResolver(() => invokeCallable({ $ref: "includes" }, [[1], 1], reader))).toBe(false);
    expect(withInterpretedResolver(() => invokeCallable({ $ref: "std:includes" }, [[1], 1], reader))).toBe(true);
    const plain = { ...ctx, natives: { ...ctx.natives, "std:includes": () => true, includes: () => false } };
    expect(withInterpretedResolver(() => invokeCallable({ $ref: "includes" }, [[1], 1], plain))).toBe(true);
  });

  test("active invocation keys restore across nested calls, normal completion and throws", () => {
    const seen: string[] = [];
    const inner = (frame: EvaluateContext): never => {
      const keys = runtimeNativeInvocationKeys(frame, inner);
      expect(Object.isFrozen(keys)).toBe(true);
      expect(Object.keys(keys ?? {}).sort()).toEqual(["resolvedName", "selectedKey", "writtenName"]);
      seen.push(keys?.writtenName ?? "missing");
      throw new Error("inner failure");
    };
    const outer = (frame: EvaluateContext): never => {
      seen.push(runtimeNativeInvocationKeys(frame, outer)?.writtenName ?? "missing");
      expect(() => invokeCallable({ $ref: "inner" }, [], frame)).toThrow("inner failure");
      seen.push(runtimeNativeInvocationKeys(frame, outer)?.writtenName ?? "missing");
      expect(runtimeNativeInvocationKeys(frame, inner)).toBeUndefined();
      throw new Error("outer failure");
    };
    function normal(this: unknown, frame: EvaluateContext): number {
      expect(this).toBe(frame.nativesCtx);
      expect(runtimeNativeInvocationKeys(frame, normal)?.resolvedName).toBe("normal");
      return 4;
    }
    const reader: EvaluateContext = { nativesCtx: { outer, inner, normal } };
    expect(() => invokeCallable({ $ref: "outer" }, [], reader)).toThrow("outer failure");
    expect(seen).toEqual(["outer", "inner", "outer"]);
    expect(runtimeNativeInvocationKeys(reader, outer)).toBeUndefined();
    expect(runtimeNativeInvocationKeys(reader, inner)).toBeUndefined();
    expect(invokeCallable({ $ref: "normal" }, [], reader)).toBe(4);
    expect(runtimeNativeInvocationKeys(reader, normal)).toBeUndefined();
  });

  test("a scoped Maybe representation remains part of source case inspection", () => {
    const reader = withInstance(ctx, {
      typeName: "Reprable", args: ["JsRuntime", "Maybe"], methods: {
        native: Maybe({ $ref: "Number" }),
        lower: { $ref: "RecipeProbeEq:swapMaybe" },
        lift: { $ref: "RecipeProbeEq:swapMaybe" },
      },
    }, frame => frame);
    check(reader, "includes", [[1], 1], false);
  });

  test("a dependency type-family precheck cannot be skipped by the shortcut", () => {
    const reader: EvaluateContext = { ...ctx, _sourceFunction: "Reader:caller", _typeFamilyOwner: (name, sourceFunction) => {
      if (name === "std:eq" && sourceFunction === undefined) throw new Error("reader dependency precheck");
      return ctx._typeFamilyOwner?.(name, sourceFunction);
    } };
    const source = membershipSourceFrame(reader);
    expect(() => withInterpretedResolver(() => invokeCallable({ $ref: "std:includes" }, [[1], 1], source))).toThrow("reader dependency precheck");
    expect(() => withInterpretedResolver(() => invokeCallable({ $ref: "std:includes" }, [[1], 1], reader))).toThrow("reader dependency precheck");
  });

  test("plain eq override is respected by all three source bodies", () => {
    const reader = { ...ctx, natives: { ...ctx.natives, "std:eq": () => false } };
    check(reader, "includes", [duplicates(), { $tag: "Butter" }], false);
    check(reader, "unique", [duplicates()], duplicates());
    check(reader, "distinctCount", [duplicates()], 2);
  });

  test("contextual eq override is respected by all three source bodies", () => {
    const reader = { ...ctx, nativesCtx: { ...ctx.nativesCtx, "std:eq": () => false } };
    check(reader, "includes", [duplicates(), { $tag: "Butter" }], false);
    check(reader, "unique", [duplicates()], duplicates());
    check(reader, "distinctCount", [duplicates()], 2);
  });

  test("an inherited selected eq native does not authorize a shortcut", () => {
    const natives = Object.assign(Object.create({ "std:eq": () => false }), ctx.natives);
    delete natives["std:eq"];
    const reader = { ...ctx, natives };
    check(reader, "includes", [[1], 1], false);
  });

  test("a missing context-native map cannot expose an ungated plain shortcut", () => {
    const reader = { ...ctx, nativesCtx: undefined, natives: { ...ctx.natives, "std:eq": () => false } };
    check(reader, "includes", [[1], 1], false);
    check(reader, "unique", [[1, 1]], [1, 1]);
    check(reader, "distinctCount", [[1, 1]], 2);
  });

  test("the selected same-id declaration body is preserved", () => {
    const canonical = ctx.getFunction!("std:includes")!;
    const reader = { ...ctx, getFunction: (name: string) => name === canonical.id ? { ...canonical, body: false } : ctx.getFunction!(name) };
    check(reader, "includes", [[1], 1], false);
  });

  test("lexical import rebinding is preserved", () => {
    const target = { ...ctx.getFunction!("std:eq")!, id: "Reader:falseEq", body: false };
    const reader = {
      ...ctx,
      getFunction: (name: string) => name === target.id ? target : ctx.getFunction!(name),
      getFunctionImportFrame: (name: string) => {
        const frame = ctx.getFunctionImportFrame!(name);
        return name === "std:includes" && frame !== undefined ? { ...frame, names: { ...frame.names, eq: target.id } } : frame;
      },
    };
    check(reader, "includes", [[1], 1], false);
  });

  test("isArray and head overrides remain observable", () => {
    const noList = { ...ctx, natives: { ...ctx.natives, "std:isArray": () => false } };
    check(noList, "includes", [[1], 1], false);
    check(noList, "unique", [[1, 1]], []);
    check(noList, "distinctCount", [[1, 1]], 0);
    const noHead = { ...ctx, natives: { ...ctx.natives, "std:head": () => ({ $tag: "Nothing" }) } };
    check(noHead, "includes", [[1], 1], false);
  });

  test("collection, fold, concat and length overrides remain observable", () => {
    check({ ...ctx, nativesCtx: { ...ctx.nativesCtx, "std:includes": () => false } }, "unique", [[1, 1]], [1, 1]);
    check({ ...ctx, nativesCtx: { ...ctx.nativesCtx, "std:fold": () => [] } }, "unique", [[1, 1]], []);
    check({ ...ctx, natives: { ...ctx.natives, "std:concat": () => [] } }, "unique", [[1, 1]], []);
    check({ ...ctx, natives: { ...ctx.natives, "std:length": () => 17 } }, "distinctCount", [[1, 1]], 17);
  });
});

// ---------------------------------------------------------------------------
// Review S1-3 — the compiled-JS route. `emit-js.fenel` lowers `eq` to JS `===`
// with no operand-type gate (inherited; pinned below), so a compiled
// `includes` / `unique` / `distinctCount` body would silently compare by
// reference. Routing compiled `eq` through structural equality is not a local
// change (it rewrites every compiled parser/resolver comparison and the frozen
// execution-profile scope), so S1 FENCES the route instead: the JS emitter
// refuses any call of, or value reference to, the three membership functions
// (bare or std-qualified), so neither their bodies nor any caller compiles.
// ---------------------------------------------------------------------------
describe("S1 compiled-JS fence (review S1-3)", () => {
  const MEMBERSHIP = ["includes", "unique", "distinctCount"] as const;
  const demoBindings = compileModuleCallBindings({ name: "demo", functions: [] });
  const stdBindings = () => compileModuleCallBindings({
    name: "std",
    functions: MEMBERSHIP.map((code) => registry.getFunction(`std:${code}`)!),
  });
  const compile = (name: string, params: string[], body: unknown, callBindings: ReturnType<typeof compileModuleCallBindings> = demoBindings) =>
    compileFenelToJsNative({
      name,
      params: positionalCompileFieldSlots(params),
      body,
      ctorDefs: {},
      callBindings,
    } as CompileSource) as { $tag: string; _0: unknown };
  const emitted = (r: { $tag: string; _0: unknown }): string => {
    expect(r.$tag).toBe("Ok");
    const out = dispatchedSerializeJsModule(r._0 as never) as { $tag: string; _0: string };
    expect(out.$tag).toBe("Ok");
    return out._0;
  };
  const expectFenced = (r: { $tag: string; _0: unknown }): void => {
    expect(r.$tag).toBe("Err");
    expect(r._0).toMatchObject({ $tag: "Unsupported" });
    expect(String((r._0 as { reason?: unknown }).reason)).toContain("structural");
  };

  test("pin: compiled `eq` on two variables is JS `===` (reference equality on objects)", () => {
    const js = emitted(compile("demo:same", ["a", "b"], { call: ["eq", { var: "a" }, { var: "b" }] }));
    expect(js).toContain("===");
    expect(js).not.toContain("$fenel.eq");
  }, 900_000);

  test("a call of includes / unique / distinctCount is refused, bare or std-qualified", () => {
    for (const code of MEMBERSHIP) {
      expectFenced(compile("demo:bare", ["xs", "v"], { call: [code, { var: "xs" }, { var: "v" }] }));
      expectFenced(compile("std:probe", ["xs", "v"], { call: [code, { var: "xs" }, { var: "v" }] }, stdBindings()));
    }
  }, 900_000);

  test("the membership bodies themselves never compile", () => {
    for (const code of MEMBERSHIP) {
      const fn = registry.getFunction(`std:${code}`)!;
      expect(fn.body).toBeDefined();
      expectFenced(compile(fn.id, fn.params.map((p) => p.name), fn.body, stdBindings()));
    }
  }, 900_000);

  test("a membership function passed as a value is refused too", () => {
    for (const code of MEMBERSHIP) {
      expectFenced(compile("demo:asValue", ["g"], { call: [{ var: "g" }, { var: code }] }));
    }
  }, 900_000);

  test("unrelated codename calls still compile", () => {
    const js = emitted(compile("demo:other", ["xs"], { call: ["length", { var: "xs" }] }));
    expect(js).toContain("$fenel.length");
  }, 900_000);

  // Review round 2, R2-5: unresolved identity routes are refused. The admitted
  // identities are the codename lock's UUIDs; the emitter has no registry, so
  // every UUID-shaped head or function-value reference is an identity route it
  // cannot resolve and is refused (conservative: an unrelated UUID too).
  const MEMBERSHIP_UUIDS: Record<(typeof MEMBERSHIP)[number], string> = {
    includes: "6201cacc-43d1-46a8-8f1e-c1233e668a65",
    unique: "4c440035-ae11-497e-bb70-17bc04818427",
    distinctCount: "f41b7c98-8e9c-491a-9a89-f67349bc9e38",
  };
  const expectRefused = (r: { $tag: string; _0: unknown }): void => {
    expect(r.$tag).toBe("Err");
    expect(r._0).toMatchObject({ $tag: "Unsupported" });
  };

  test("R2-5: the admitted UUIDs are the lock's identities of the membership functions", () => {
    const lock = readFileSync(join(import.meta.dir, "../../../../.fenel.lock"), "utf8");
    for (const code of MEMBERSHIP) expect(lock).toContain(`\nstd:${code} ; ${MEMBERSHIP_UUIDS[code]}\n`);
  });

  test("R2-5: a UUID call head of each membership function is refused (call and key forms)", () => {
    for (const code of MEMBERSHIP) {
      const id = MEMBERSHIP_UUIDS[code];
      expectFenced(compile("demo:uuidCall", ["xs", "v"], { call: [id, { var: "xs" }, { var: "v" }] }));
      expectFenced(compile("demo:uuidKey", ["xs", "v"], { [id]: [{ var: "xs" }, { var: "v" }] }));
      expectFenced(compile("demo:uuidUpper", ["xs", "v"], { call: [id.toUpperCase(), { var: "xs" }, { var: "v" }] }));
    }
    // Conservative: the emitter cannot resolve a UUID, so an unrelated UUID head
    // (any UUID shape, any version) is refused as well.
    expectFenced(compile("demo:uuidOther", ["xs"], { call: ["00000000-0000-7000-8000-000000000000", { var: "xs" }] }));
  }, 900_000);

  test("R2-5: a UUID function-value reference is refused ($ref and var forms)", () => {
    for (const code of MEMBERSHIP) {
      const id = MEMBERSHIP_UUIDS[code];
      expectRefused(compile("demo:uuidRef", ["g"], { call: [{ var: "g" }, { $ref: id }] }));
      expectRefused(compile("demo:uuidVar", ["g"], { call: [{ var: "g" }, { var: id }] }));
    }
    // distinctCount's UUID starts with a lowercase letter, so as a variable it
    // reaches the emitter as a `$fn:<uuid>` value reference: the fence refuses it.
    expectFenced(compile("demo:uuidVarLetter", ["g"], { call: [{ var: "g" }, { var: MEMBERSHIP_UUIDS.distinctCount }] }));
  }, 900_000);

  test("R2-5: an alias binding to a membership function is refused (call and value)", () => {
    for (const code of MEMBERSHIP) {
      const alias = { has: `std:${code}` } as unknown as ReturnType<typeof compileModuleCallBindings>;
      expectFenced(compile("demo:aliasCall", ["xs", "v"], { call: ["has", { var: "xs" }, { var: "v" }] }, alias));
      expectFenced(compile("demo:aliasValue", ["g"], { call: [{ var: "g" }, { var: "has" }] }, alias));
    }
  }, 900_000);

  test("R2-5: a UUID alias binding is refused at source admission (call and value)", () => {
    for (const code of MEMBERSHIP) {
      const alias = { has: MEMBERSHIP_UUIDS[code] } as unknown as ReturnType<typeof compileModuleCallBindings>;
      expectRefused(compile("demo:uuidAliasCall", ["xs", "v"], { call: ["has", { var: "xs" }, { var: "v" }] }, alias));
      expectRefused(compile("demo:uuidAliasValue", ["g"], { call: [{ var: "g" }, { var: "has" }] }, alias));
    }
  }, 900_000);

  test("R2-5: compiling a membership owner as the root is refused whatever the body", () => {
    for (const code of MEMBERSHIP) {
      for (const root of [code, `std:${code}`, `std.${code}`, MEMBERSHIP_UUIDS[code], MEMBERSHIP_UUIDS[code].toUpperCase()]) {
        expectFenced(compile(root, ["xs"], { var: "xs" }));
      }
    }
    // An unrelated root with the same body compiles.
    expect(emitted(compile("demo:identity", ["xs"], { var: "xs" }))).toContain("xs");
  }, 900_000);
});
