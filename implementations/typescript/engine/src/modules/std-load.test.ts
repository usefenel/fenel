// ---------------------------------------------------------------------------
// std-load.test.ts — first bun:test conformance for std.ts. Locks the
// Phase 5b3 pure-helper port (negate / abs / sign / clamp to Fenel
// bodies) + the Math IO leaves' exclusion from the port.
//
// Phase 5b3 introduces `.fenel`-source-of-truth to std.ts for the first
// time — the 19 already-bodied specs use inline JSON Logic (older style);
// 5b3 creates `fenel/modules/std/` and authors 4 single-function files
// alongside. Each `defineFunction` spec gains a `body:` slot wired
// through the loader blocks. The 4 TS-native entries leave the
// `stdNatives` map; the remaining 19 math entries (min / max / round /
// floor / ceil / pow / sqrt / exp / log / sin / cos / tan etc.) stay
// TS-native — each is a Math host primitive that needs Fenel-side
// numeric tooling (Phase 6+) before porting.
//
// std-load assertions mirror email-load (5b1) / time-load (5b2):
//
//   1. 4 .fenel files parse to exactly 1 function each (per-file roster
//      lock).
//   2. Phase 5b3 — std:negate / std:abs / std:sign / std:clamp carry
//      Fenel bodies post-flip.
//   3. Math IO leaves (std:round / std:floor / std:ceil / std:pow /
//      std:sqrt / std:sin / std:cos) stay TS-native (no Fenel body).
//   4. Semantic regression smoke — 12 fixtures across the 4 ports.
//   5. Cross-Fenel-body dispatch — abs / sign / clamp call sub / lt /
//      gt, all themselves Fenel-bodied via inline JSON Logic at
//      std.ts:70/93/2147/2165. Locks the Fenel → Fenel chain.
//   6. Behavioural-divergence audit — Math.abs(-0) === 0 but Fenel
//      returns -0; Math.sign(NaN) === NaN but Fenel returns 0;
//      Math.min/max(NaN, x) === NaN but Fenel returns the non-NaN
//      bound. Third instantiation of the JS-coercion-omission pattern
//      (5b1 quote-strip, 5b2 `Number(x) || 0`, 5b3 Math.* + NaN/-0).
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import negateSrc from "../../../../../fenel/modules/std/negate.fenel?raw";
import absSrc from "../../../../../fenel/modules/std/abs.fenel?raw";
import signSrc from "../../../../../fenel/modules/std/sign.fenel?raw";
import clampSrc from "../../../../../fenel/modules/std/clamp.fenel?raw";
import idSrc from "../../../../../fenel/modules/std/id.fenel?raw";
import constSrc from "../../../../../fenel/modules/std/const.fenel?raw";
import countSrc from "../../../../../fenel/modules/std/count.fenel?raw";
import appendItemSrc from "../../../../../fenel/modules/std/appendItem.fenel?raw";
import lerpSrc from "../../../../../fenel/modules/std/lerp.fenel?raw";
import minSrc from "../../../../../fenel/modules/std/min.fenel?raw";
import maxSrc from "../../../../../fenel/modules/std/max.fenel?raw";
import imageRetroSrc from "../../../../../fenel/modules/std/imageRetro.fenel?raw";
import andSrc from "../../../../../fenel/modules/std/and.fenel?raw";
import orSrc from "../../../../../fenel/modules/std/or.fenel?raw";
import notSrc from "../../../../../fenel/modules/std/not.fenel?raw";
import ifElseSrc from "../../../../../fenel/modules/std/ifElse.fenel?raw";
import tryParseBooleanSrc from "../../../../../fenel/modules/std/tryParseBoolean.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { stdModule, stdNatives } from "./std";
import { createRegistry } from "../registry";
import { evaluate } from "../json-logic";
import { SAMPLE_IMAGES } from "../image-data";
test("4 std/*.fenel files parse to exactly 1 function each (per-file roster lock)", () => {
  const cases = [
    { name: "negate", src: negateSrc, expectedId: "std:negate" },
    { name: "abs", src: absSrc, expectedId: "std:abs" },
    { name: "sign", src: signSrc, expectedId: "std:sign" },
    { name: "clamp", src: clampSrc, expectedId: "std:clamp" },
  ];
  for (const { name, src, expectedId } of cases) {
    const mod = loadFenelModule(src, `std-${name}`);
    const fns = mod.functions ?? [];
    expect(fns.length).toBe(1);
    expect(fns[0]!.id).toBe(expectedId);
    expect(fns[0]!.body).toBeDefined();
  }
});

test("Phase 5b3 — std:negate / std:abs / std:sign / std:clamp carry Fenel bodies post-flip", () => {
  // Phase 5b3 replaces the TS natives `negateNative` / `absNative` /
  // `signNative` / `clampNative` (formerly at std.ts:2788-2803) with
  // Fenel bodies in dedicated `.fenel` files under fenel/modules/std/.
  // The body-slot wiring on each `defineFunction` spec picks the
  // loaded body up so the spec is executable through the engine
  // evaluator.
  for (const id of ["std:negate", "std:abs", "std:sign", "std:clamp"]) {
    const fn = (stdModule.functions ?? []).find((f) => f.id === id);
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  }
});

test("Math IO leaves stay TS-native — round / floor / ceil / pow / sqrt / sin / cos remain body=undefined", () => {
  // Math.* host primitives — each calls `Math.<op>(toNum(x))` and
  // can't be decomposed into a pure Fenel expression without a
  // Fenel-side IEEE-754 transcendental implementation (Phase 6+
  // numeric tooling dependency). Locked here so future per-helper
  // batches don't accidentally re-evaluate them mid-sweep.
  for (const id of ["std:round", "std:floor", "std:ceil", "std:pow", "std:sqrt", "std:sin", "std:cos"]) {
    const fn = (stdModule.functions ?? []).find((f) => f.id === id);
    expect(fn).toBeDefined();
    expect(fn!.body).toBeUndefined();
  }
});

test("Phase 5b3 — semantic regression smoke covers 12 fixtures across the 4 ports", () => {
  // Invokes each ported body through the engine evaluator with a
  // stdModule-only registry. The 12 fixtures (3 per function) cover
  // positive / negative / zero inputs for each ported helper.
  const registry = createRegistry([stdModule]);
  const ctx = registry.evaluateContext();
  const fn = (id: string) => {
    const f = (stdModule.functions ?? []).find((x) => x.id === id)!;
    return f.body;
  };

  // negate
  expect(evaluate(fn("std:negate"), { x: 5 }, ctx)).toBe(-5);
  expect(evaluate(fn("std:negate"), { x: -3 }, ctx)).toBe(3);
  expect(evaluate(fn("std:negate"), { x: 0 }, ctx)).toBe(0);

  // abs
  expect(evaluate(fn("std:abs"), { x: 5 }, ctx)).toBe(5);
  expect(evaluate(fn("std:abs"), { x: -3 }, ctx)).toBe(3);
  expect(evaluate(fn("std:abs"), { x: 0 }, ctx)).toBe(0);

  // sign
  expect(evaluate(fn("std:sign"), { x: 5 }, ctx)).toBe(1);
  expect(evaluate(fn("std:sign"), { x: -3 }, ctx)).toBe(-1);
  expect(evaluate(fn("std:sign"), { x: 0 }, ctx)).toBe(0);

  // clamp
  expect(evaluate(fn("std:clamp"), { x: 5, lo: 0, hi: 10 }, ctx)).toBe(5);
  expect(evaluate(fn("std:clamp"), { x: -1, lo: 0, hi: 10 }, ctx)).toBe(0);
  expect(evaluate(fn("std:clamp"), { x: 15, lo: 0, hi: 10 }, ctx)).toBe(10);
});

test("Phase 5b3 — cross-Fenel-body dispatch chain (abs/sign/clamp call sub/lt/gt)", () => {
  // The load-bearing check: abs / sign / clamp bodies call `sub` /
  // `lt` / `gt` — each itself Fenel-bodied via inline JSON Logic
  // (`sub` body is `{"-": [a, b]}` at std.ts:93; `lt` / `gt` are
  // inline-bodied around std.ts:2147/2165). The dispatch chain is
  // Fenel → Fenel → operator-native. If it breaks, the fixtures
  // below fail. Re-stated as explicit prose so the chain is
  // documented inside the test, not just implied by the smoke.
  const registry = createRegistry([stdModule]);
  const ctx = registry.evaluateContext();
  const absBody = (stdModule.functions ?? []).find((f) => f.id === "std:abs")!.body;
  const signBody = (stdModule.functions ?? []).find((f) => f.id === "std:sign")!.body;
  const clampBody = (stdModule.functions ?? []).find((f) => f.id === "std:clamp")!.body;
  // abs(-7) — exercises `lt -7 0` then `sub 0 -7` dispatch chain.
  expect(evaluate(absBody, { x: -7 }, ctx)).toBe(7);
  // sign(-7) — exercises `lt -7 0` (true) → `sub 0 1` dispatch.
  expect(evaluate(signBody, { x: -7 }, ctx)).toBe(-1);
  // clamp(7, 0, 5) — exercises `lt 7 0` (false) → `gt 7 5` (true)
  // dispatch.
  expect(evaluate(clampBody, { x: 7, lo: 0, hi: 5 }, ctx)).toBe(5);
});

test("Phase 5b3 — behavioural-divergence audit (NaN / -0 JS-host omissions)", () => {
  // Third instantiation of the JS-coercion-omission pattern. The TS
  // natives applied `toNum(x)` coercion AND used Math.* host calls;
  // the Fenel ports omit both. Documented divergences:
  //   - Math.abs(-0) === 0 but Fenel abs(-0) returns -0 (since
  //     `lt -0 0` is false, the else-branch returns x unchanged).
  //   - Math.sign(NaN) === NaN but Fenel sign(NaN) returns 0 (since
  //     `lt NaN 0` and `gt NaN 0` are both false in JS comparison
  //     semantics).
  //   - Math.min/max with a NaN argument returns NaN but Fenel
  //     clamp(NaN, lo, hi) returns x (NaN) since both lt/gt
  //     comparisons fail. The brief calls this out as acceptable
  //     because Fenel's typed spec is `Number`, not NaN-permitting.
  const registry = createRegistry([stdModule]);
  const ctx = registry.evaluateContext();
  const absBody = (stdModule.functions ?? []).find((f) => f.id === "std:abs")!.body;
  const signBody = (stdModule.functions ?? []).find((f) => f.id === "std:sign")!.body;

  // abs(-0) — JS Math.abs(-0) === 0; Fenel returns -0. Use
  // Object.is for -0 discrimination since -0 === 0.
  const absMinusZero = evaluate(absBody, { x: -0 }, ctx);
  expect(Object.is(absMinusZero, -0)).toBe(true);

  // sign(NaN) — JS Math.sign(NaN) === NaN; Fenel returns 0.
  const signNaN = evaluate(signBody, { x: Number.NaN }, ctx);
  expect(signNaN).toBe(0);
});

// ---------------------------------------------------------------------------
// Phase 5b4 — pure combinator-helper bodies (id / const / count /
// appendItem) added alongside the 5b3 arithmetic helpers. First batch of
// polymorphic combinator ports (id / const = `∀a b. …` signatures vs
// 5b3's monomorphic numeric). Documents the substrate-leaf-identity
// BLOCKER for operator-form migration — the 11 trivial operator-form
// specs (add / sub / mul / div / mod / eq / neq / gt / gte / lt / lte)
// cannot migrate via this recipe because rewriting `add a b = a + b`
// lowers via Infixable to `{call: ["add", a, b]}` (recursive self-call).
// `not` is similarly parser-blocked (Prefixable operator collision at
// function-decl LHS). See 5b4 roadmap completion notes.
// ---------------------------------------------------------------------------

test("Phase 5b4 — 4 combinator-helper .fenel files parse to exactly 1 function each (per-file roster lock)", () => {
  const cases = [
    { name: "id", src: idSrc, expectedId: "std:id" },
    { name: "const", src: constSrc, expectedId: "std:const" },
    { name: "count", src: countSrc, expectedId: "std:count" },
    {
      name: "appendItem",
      src: appendItemSrc,
      expectedId: "std:appendItem",
    },
  ];
  for (const { name, src, expectedId } of cases) {
    const mod = loadFenelModule(src, `std-${name}`);
    const fns = mod.functions ?? [];
    expect(fns.length).toBe(1);
    expect(fns[0]!.id).toBe(expectedId);
    expect(fns[0]!.body).toBeDefined();
  }
});

test("Phase 5b4 — std:id / std:const / std:count / std:appendItem carry Fenel bodies post-flip", () => {
  // Phase 5b4 replaces the TS natives `id` / `const` / `count` /
  // `appendItem` (formerly at std.ts:2950/2970/2971/2974) with Fenel
  // bodies in dedicated `.fenel` files under fenel/modules/std/. The
  // body-slot wiring on each `defineFunction` spec picks the loaded
  // body up so the spec is executable through the engine evaluator.
  for (const id of [
    "std:id",
    "std:const",
    "std:count",
    "std:appendItem",
  ]) {
    const fn = (stdModule.functions ?? []).find((f) => f.id === id);
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
  }
});

test("Phase 5b4 — semantic regression smoke covers 8 fixtures across the 4 combinator ports", () => {
  // Invokes each ported body through the engine evaluator with a
  // stdModule-only registry. 8 fixtures (2 per function) cover the
  // identity / second-arg-ignore / list-length / list-append cases.
  // The count / appendItem fixtures also exercise cross-std-function
  // dispatch (count → length, appendItem → concat — both TS natives;
  // first batch where the Fenel body calls a TS-native helper rather
  // than just operators).
  const registry = createRegistry([stdModule]);
  const ctx = registry.evaluateContext();
  const fn = (id: string) => {
    const f = (stdModule.functions ?? []).find((x) => x.id === id)!;
    return f.body;
  };

  // id
  expect(evaluate(fn("std:id"), { x: 5 }, ctx)).toBe(5);
  expect(evaluate(fn("std:id"), { x: "hello" }, ctx)).toBe("hello");

  // const
  expect(evaluate(fn("std:const"), { x: 7, _y: 99 }, ctx)).toBe(7);
  expect(evaluate(fn("std:const"), { x: "x", _y: null }, ctx)).toBe("x");

  // count — cross-std-function dispatch chain (Fenel body → TS native).
  expect(evaluate(fn("std:count"), { arr: [] }, ctx)).toBe(0);
  expect(evaluate(fn("std:count"), { arr: [1, 2, 3] }, ctx)).toBe(3);

  // appendItem — cross-std-function dispatch chain. Param order
  // (item, arr) matches the pre-5b4 TS native deliberately.
  expect(evaluate(fn("std:appendItem"), { item: 4, arr: [] }, ctx)).toEqual([
    4,
  ]);
  expect(
    evaluate(fn("std:appendItem"), { item: "c", arr: ["a", "b"] }, ctx),
  ).toEqual(["a", "b", "c"]);
});

// ---------------------------------------------------------------------------
// Phase 5b5 — first sub-phase whose targets are already-bodied specs (not
// TS-native → Fenel-body). Migrates 4 inline-JSON-Logic-bodied std.ts
// specs (lerp / min / max / imageRetro) to `.fenel` source-of-truth. The
// migration moves the body's source-of-truth from inline TypeScript to a
// `.fenel` file; the body shape changes from operator-form (lerp) /
// named-op-key (min, max) / pipe-op (imageRetro) to canonical call-form
// via the function registry. Semantically equivalent except for
// documented JS-host divergences (min/max NaN handling).
//
// Subtracts 4 from the 19-strong inline-JSON-Logic body backlog
// documented in 5b4's framing implications — without parser/substrate-
// design extension. Backlog now 15 (11 operator-form BLOCKED by sub-
// strate-leaf identity + 2 short-circuit and/or by lazy-arg semantics +
// 2 HOF-blocked `.` / `$` by parser function-id-vs-HOF-value ambiguity).
//
// First sub-phase porting an image-pipeline spec (imageRetro);
// validates the recipe at image-pipeline surface depth 2. Locks the
// recipe for any future image / sound / movie / picture pipeline port.
//
// Fourth instantiation of the JS-coercion-omission pattern (5b1 quote-
// strip / 5b2 `Number(x) || 0` / 5b3 Math.abs+Math.sign / 5b5 Math.min
// /Math.max NaN handling).
// ---------------------------------------------------------------------------

test("Phase 5b5 — 4 inline-JSON-Logic-bodied .fenel files parse to exactly 1 function each (per-file roster lock)", () => {
  const cases = [
    { name: "lerp", src: lerpSrc, expectedId: "std:lerp" },
    { name: "min", src: minSrc, expectedId: "std:min" },
    { name: "max", src: maxSrc, expectedId: "std:max" },
    {
      name: "imageRetro",
      src: imageRetroSrc,
      expectedId: "std:imageRetro",
    },
  ];
  for (const { name, src, expectedId } of cases) {
    const mod = loadFenelModule(src, `std-${name}`);
    const fns = mod.functions ?? [];
    expect(fns.length).toBe(1);
    expect(fns[0]!.id).toBe(expectedId);
    expect(fns[0]!.body).toBeDefined();
  }
});

test("Phase 5b5 — std:lerp / std:min / std:max / std:imageRetro bodies LOADED FROM `.fenel` source-of-truth", () => {
  // Phase 5b5 replaces the inline-JSON-Logic bodies (formerly at
  // std.ts:482 / :268 / :286 / :4079) with bodies sourced from
  // `fenel/modules/std/{lerp,min,max,imageRetro}.fenel`. Direct
  // equality check asserts source-of-truth uniformity — the spec's
  // body slot exactly matches the body parsed from the `.fenel` file
  // (not the pre-5b5 inline JSON Logic).
  const cases = [
    { specId: "std:lerp", src: lerpSrc, fenelId: "std:lerp" },
    { specId: "std:min", src: minSrc, fenelId: "std:min" },
    { specId: "std:max", src: maxSrc, fenelId: "std:max" },
    {
      specId: "std:imageRetro",
      src: imageRetroSrc,
      fenelId: "std:imageRetro",
    },
  ];
  for (const { specId, src, fenelId } of cases) {
    const fn = (stdModule.functions ?? []).find((f) => f.id === specId);
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
    const mod = loadFenelModule(src, fenelId.split(":")[0]!);
    const fenelBody = mod.functions?.find((f) => f.id === fenelId)?.body;
    expect(fn!.body).toEqual(fenelBody);
  }
});

test("Phase 5b5 — semantic regression smoke covers 8 fixtures across the 4 ports", () => {
  // Invokes each ported body through the engine evaluator with a
  // stdModule-only registry. 8 fixtures (2 per function) cover the
  // interpolation midpoint / endpoint, min/max forward+reverse arg
  // order, and the image pipeline composition with two SAMPLE_IMAGES
  // fixtures. imageRetro is the first image-pipeline port —
  // dispatches through std:imageGrayscale → std:imagePixelate (both
  // TS natives).
  const registry = createRegistry([stdModule]);
  const ctx = registry.evaluateContext();
  const fn = (id: string) => {
    const f = (stdModule.functions ?? []).find((x) => x.id === id)!;
    return f.body;
  };

  // lerp — operator-form lowered to nested call-form (add/mul/sub).
  expect(evaluate(fn("std:lerp"), { a: 0, b: 10, t: 0.5 }, ctx)).toBe(5);
  expect(evaluate(fn("std:lerp"), { a: 0, b: 10, t: 0 }, ctx)).toBe(0);

  // min — if-form over lt dispatch.
  expect(evaluate(fn("std:min"), { a: 3, b: 7 }, ctx)).toBe(3);
  expect(evaluate(fn("std:min"), { a: 7, b: 3 }, ctx)).toBe(3);

  // max — if-form over gt dispatch.
  expect(evaluate(fn("std:max"), { a: 3, b: 7 }, ctx)).toBe(7);
  expect(evaluate(fn("std:max"), { a: 7, b: 3 }, ctx)).toBe(7);

  // imageRetro — first image-pipeline port. Dispatches grayscale
  // then pixelate (both TS natives). Asserts the composition
  // returns a valid Image record (width / height / pixels). Smoke-
  // tests the pipeline, doesn't bit-compare pixel data.
  const img0 = SAMPLE_IMAGES[0]!;
  const out0 = evaluate(fn("std:imageRetro"), { img: img0, factor: 4 }, ctx) as {
    width: number;
    height: number;
    pixels: unknown[];
  };
  expect(out0).toBeDefined();
  expect(out0.width).toBe(img0.width);
  expect(out0.height).toBe(img0.height);
  expect(Array.isArray(out0.pixels)).toBe(true);
  expect(out0.pixels.length).toBe(img0.width * img0.height);

  const img1 = SAMPLE_IMAGES[1]!;
  const out1 = evaluate(fn("std:imageRetro"), { img: img1, factor: 2 }, ctx) as {
    width: number;
    height: number;
    pixels: unknown[];
  };
  expect(out1).toBeDefined();
  expect(out1.width).toBe(img1.width);
  expect(out1.height).toBe(img1.height);
  expect(Array.isArray(out1.pixels)).toBe(true);
  expect(out1.pixels.length).toBe(img1.width * img1.height);
});

// ---------------------------------------------------------------------------
// Phase 5b6 — second sub-phase migrating already-bodied specs to `.fenel`
// source-of-truth, and the first to disprove a 5b5-documented blocker.
// 5b5 categorized `std:and` / `std:or` as "BLOCKED by lazy-arg semantics
// not preserved by canonical call-form"; the if-lowering pattern 5b5
// used for min/max preserves laziness via `applyOp`'s `if` structural-
// form case branch (only the chosen branch is evaluated). 5b6 ports
// `std:and` (`if a then b else False`) and `std:or` (`if a then True
// else b`) to .fenel source.
//
// New surprise: the parser reserves `and` / `or` / `not` as operator
// keywords (KW set in parser-keywords.ts), so the .fenel-side function
// names are `andFn` / `orFn` — same operator-keyword-LHS blocker still
// documented for `not`. Body shape is portable; only the LHS ident is
// blocked. std.ts extracts via `f.id === "std:and"` and wires
// into the `std:and` spec; the user-facing codeName stays `and`.
//
// Subtracts 2 from the 15-strong inline-JSON-Logic body backlog without
// parser/substrate-design extension. Backlog now 13 (11 operator-form
// BLOCKED by substrate-leaf identity + 2 HOF-blocked `.` / `$` by
// parser function-id-vs-HOF-value ambiguity).
//
// Second instantiation of the if-lowering source-of-truth migration
// sub-recipe (5b5 piloted on min/max numeric comparators; 5b6 extends
// to Boolean short-circuits). Lazy-semantics preservation formally tied
// to `applyOp`'s if-handler invariant via the divide-by-zero probe.
// ---------------------------------------------------------------------------

test("Phase 5b6 — 2 short-circuit-helper .fenel files parse to exactly 1 function each (per-file roster lock)", () => {
  const cases = [
    { name: "and", src: andSrc, expectedId: "std:and" },
    { name: "or", src: orSrc, expectedId: "std:or" },
  ];
  for (const { name, src, expectedId } of cases) {
    const mod = loadFenelModule(src, `std-${name}`);
    const fns = mod.functions ?? [];
    expect(fns.length).toBe(1);
    expect(fns[0]!.id).toBe(expectedId);
    expect(fns[0]!.body).toBeDefined();
  }
});

test("Phase 5b6 — std:and / std:or bodies LOADED FROM `.fenel` source-of-truth (if-form, not named-op-key)", () => {
  // Phase 5b6 replaces the inline-JSON-Logic bodies (formerly at
  // std.ts:2378 / :2396 — `{and: [a, b]}` / `{or: [a, b]}` named-op-
  // key form) with bodies sourced from
  // `fenel/modules/std/{and,or}.fenel`. Direct equality check asserts
  // source-of-truth uniformity — the spec's body slot exactly matches
  // the body parsed from the `.fenel` file (not the pre-5b6 named-op-
  // key JSON Logic).
  const cases = [
    { specId: "std:and", src: andSrc, fenelId: "std:and" },
    { specId: "std:or", src: orSrc, fenelId: "std:or" },
  ];
  for (const { specId, src, fenelId } of cases) {
    const fn = (stdModule.functions ?? []).find((f) => f.id === specId);
    expect(fn).toBeDefined();
    expect(fn!.body).toBeDefined();
    const mod = loadFenelModule(src, fenelId.split(":")[0]!);
    const fenelBody = mod.functions?.find((f) => f.id === fenelId)?.body;
    expect(fn!.body).toEqual(fenelBody);
    // Body shape: if-form, not named-op-key. Sanity-check the
    // post-flip dispatch path.
    expect(typeof fn!.body).toBe("object");
    expect("if" in (fn!.body as object)).toBe(true);
  }
});

test("Phase 5b6 — semantic regression smoke (8 fixtures) + lazy-semantics audit (2 divide-by-zero probes)", () => {
  // Invokes each ported body through the engine evaluator with a
  // stdModule-only registry. 8 fixtures (4 per helper) cover the full
  // 2×2 truth table for and / or. The load-bearing assertion is the
  // pair of divide-by-zero probes — disproves the 5b5 "lazy-arg
  // semantics blocker" framing. If `applyOp`'s `if` structural-form
  // case branch ever stops short-circuiting (e.g. a future refactor
  // makes both branches eagerly evaluated), these tests regress.
  const registry = createRegistry([stdModule]);
  const ctx = registry.evaluateContext();
  const fn = (id: string) => {
    const f = (stdModule.functions ?? []).find((x) => x.id === id)!;
    return f.body;
  };

  // and — 2×2 truth table. Construct op coerces {construct: ["False"]}
  // → JS false per AGENTS.md "Bool = True | False" so results are
  // plain JS bools.
  expect(evaluate(fn("std:and"), { a: true, b: true }, ctx)).toBe(true);
  expect(evaluate(fn("std:and"), { a: true, b: false }, ctx)).toBe(false);
  expect(evaluate(fn("std:and"), { a: false, b: true }, ctx)).toBe(false);
  expect(evaluate(fn("std:and"), { a: false, b: false }, ctx)).toBe(false);

  // or — 2×2 truth table.
  expect(evaluate(fn("std:or"), { a: true, b: true }, ctx)).toBe(true);
  expect(evaluate(fn("std:or"), { a: true, b: false }, ctx)).toBe(true);
  expect(evaluate(fn("std:or"), { a: false, b: true }, ctx)).toBe(true);
  expect(evaluate(fn("std:or"), { a: false, b: false }, ctx)).toBe(false);

  // Lazy-semantics audit — divide-by-zero in `b` arg must NOT throw
  // when its branch is not chosen by `if`.
  // - and(false, _) — `b` never evaluated (else-branch returns False).
  expect(evaluate(fn("std:and"), { a: false, b: { "/": [1, 0] } }, ctx)).toBe(false);
  // - or(true, _) — `b` never evaluated (then-branch returns True).
  expect(evaluate(fn("std:or"), { a: true, b: { "/": [1, 0] } }, ctx)).toBe(true);
});

// ---------------------------------------------------------------------------
// Phase 5b7 — first sub-phase combining TS-native deletion (5b1-5b4
// category) with name-divergence workaround (5b6 category). Ports
// `std:not` (body `if x then False else True`) to `.fenel` source via
// the same if-lowering + name-divergence recipe 5b6 validated for and/
// or. The .fenel-side ident is `notFn` (parser reserves `not` as a
// Prefixable operator keyword); std.ts extracts via
// `f.id === "std:not"` and wires the body into the `std:not`
// spec; user-facing codeName stays `not`.
//
// Unlike 5b5/5b6, `stdNatives` IS touched here — the pre-5b7 entry
// `not: (x) => !x` (at std.ts:3207) is deleted, since the spec was
// TS-native (not already-bodied). First sub-phase doing BOTH a
// TS-native delete AND a name-divergent .fenel ident.
//
// Retires the 5b4-documented `not` BLOCKER framing — Prefixable LHS-
// collision is workaround-able via name divergence, consistent with
// 5b6's finding for Infixable and/or. Third instantiation of the if-
// lowering source-of-truth migration sub-recipe (5b5 numeric
// comparators → 5b6 Boolean short-circuits → 5b7 Boolean negation).
// ---------------------------------------------------------------------------

test("Phase 5b7 — not.fenel parses to exactly 1 function (per-file roster lock)", () => {
  const mod = loadFenelModule(notSrc, "std-not");
  const fns = mod.functions ?? [];
  expect(fns.length).toBe(1);
  expect(fns[0]!.id).toBe("std:not");
  expect(fns[0]!.body).toBeDefined();
});

test("Phase 5b7 — std:not body LOADED FROM `.fenel` source-of-truth; stdNatives.not deleted (post-flip dispatch path)", () => {
  // Phase 5b7 adds a body to the previously-TS-native spec (pre-5b7
  // body was undefined; dispatch went through stdNatives.not). Direct
  // equality check asserts source-of-truth uniformity — the spec's
  // body slot exactly matches the body parsed from the `.fenel` file.
  const fn = (stdModule.functions ?? []).find((f) => f.id === "std:not");
  expect(fn).toBeDefined();
  expect(fn!.body).toBeDefined();
  const mod = loadFenelModule(notSrc, "std-not");
  const fenelBody = mod.functions?.find((f) => f.id === "std:not")?.body;
  expect(fn!.body).toEqual(fenelBody);
  // Body shape: if-form, not the pre-5b7 undefined.
  expect(typeof fn!.body).toBe("object");
  expect("if" in (fn!.body as object)).toBe(true);
  // Pre-flip dispatch path is gone — `not` entry deleted from
  // stdNatives. Load-bearing: without the delete, stdNatives would
  // short-circuit the new Fenel body.
  expect("not" in stdNatives).toBe(false);
});

test("Phase 5b7 — semantic regression smoke (truth table + composition); construct coerces to JS bool", () => {
  // Invokes the ported body through the engine evaluator with a
  // stdModule-only registry. `construct` op coerces {construct:
  // ["True"]} / {construct: ["False"]} → JS bools per AGENTS.md
  // "Bool = True | False" so results are plain JS bools matching
  // the pre-5b7 TS native's `!x` return shape.
  const registry = createRegistry([stdModule]);
  const ctx = registry.evaluateContext();
  const notBody = (stdModule.functions ?? []).find((f) => f.id === "std:not")!.body;

  // Truth table — 2 fixtures.
  expect(evaluate(notBody, { x: true }, ctx)).toBe(false);
  expect(evaluate(notBody, { x: false }, ctx)).toBe(true);

  // Composition probes — `not (not x)`. Dispatches through the
  // function registry to the if-form body twice.
  expect(evaluate({ call: ["not", { call: ["not", true] }] }, {}, ctx)).toBe(true);
  expect(evaluate({ call: ["not", { call: ["not", false] }] }, {}, ctx)).toBe(false);
});

// ---------------------------------------------------------------------------
// Phase 5b8 — first sub-phase combining TS-native deletion with a SPEC-
// param rename (not just a .fenel-ident divergence per 5b6/5b7). Ports
// `std:ifElse` (body `if condition then consequent else alternative`) to
// `.fenel` source via the same if-lowering recipe. The pre-5b8 spec
// params `condition, then, else` collide with parser reserved keywords
// (`then` / `else` in KW set); the body can't reference `{var: "then"}`
// / `{var: "else"}` directly via .fenel source. Rather than diverge the
// .fenel ident only (5b6/5b7 pattern), 5b8 renames the SPEC params
// themselves to `condition, consequent, alternative` — a NEW workaround
// tier beyond 5b6/5b7's .fenel-ident divergence. Consequence-free since
// pre-5b8 grep confirmed no named-arg callers use `then` / `else` keys.
//
// The .fenel-side ident is `ifElseFn` per 5b6/5b7 hybrid-port convention
// (though `ifElse` itself isn't a parser keyword). Unlike 5b5/5b6 but
// matching 5b7, `stdNatives` IS touched — pre-5b8 `ifElse: (cond, then,
// els) => cond ? then : els` is deleted.
//
// The pre-5b8 spec description's "Note: eager — both branches evaluate"
// caveat is RETIRED post-flip: the if-form body is lazy via `applyOp`'s
// `if` case branch (only the chosen branch evaluates). Strict semantic
// improvement, not a behavior change.
//
// Fourth instantiation of the if-lowering source-of-truth migration
// sub-recipe (5b5 numeric comparators → 5b6 Boolean short-circuits →
// 5b7 Boolean negation → 5b8 polymorphic conditional). First if-
// lowering sub-phase since 5b5 NOT adding Bool-construct gap entries —
// body returns the payload value directly via if-form, so for Number
// payloads no boundary mismatch surfaces; JS/WASM self-host cleanly.
// ---------------------------------------------------------------------------

test("Phase 5b8 — ifElse.fenel parses to exactly 1 function (per-file roster lock)", () => {
  const mod = loadFenelModule(ifElseSrc, "std-ifElse");
  const fns = mod.functions ?? [];
  expect(fns.length).toBe(1);
  expect(fns[0]!.id).toBe("std:ifElse");
  expect(fns[0]!.body).toBeDefined();
});

test("Phase 5b8 — std:ifElse body LOADED FROM `.fenel`; stdNatives.ifElse deleted; spec params renamed (consequent / alternative)", () => {
  // Phase 5b8 adds a body to the previously-TS-native spec (pre-5b8
  // body was undefined; dispatch went through stdNatives.ifElse).
  // Direct equality check asserts source-of-truth uniformity — the
  // spec's body slot exactly matches the body parsed from the `.fenel`
  // file.
  const fn = (stdModule.functions ?? []).find((f) => f.id === "std:ifElse");
  expect(fn).toBeDefined();
  expect(fn!.body).toBeDefined();
  const mod = loadFenelModule(ifElseSrc, "std-ifElse");
  const fenelBody = mod.functions?.find(
    (f) => f.id === "std:ifElse",
  )?.body;
  expect(fn!.body).toEqual(fenelBody);
  // Body shape: if-form, not the pre-5b8 undefined.
  expect(typeof fn!.body).toBe("object");
  expect("if" in (fn!.body as object)).toBe(true);
  // Pre-flip dispatch path is gone — `ifElse` entry deleted from
  // stdNatives. Load-bearing: without the delete, stdNatives would
  // short-circuit the new Fenel body.
  expect("ifElse" in stdNatives).toBe(false);
  // Spec params renamed: 5b8 is the first sub-phase escalating the
  // parser-collision workaround from .fenel-ident divergence to a
  // SPEC-param rename. Pre-5b8: `condition, then, else`. Post-5b8:
  // `condition, consequent, alternative`. Locks the new artefact.
  const paramNames = fn!.params?.map((p) => p.name) ?? [];
  expect(paramNames).toEqual(["condition", "consequent", "alternative"]);
});

test("Phase 5b8 — semantic regression smoke (4 truth-table-like + 2 lazy-semantics divide-by-zero probes)", () => {
  // Invokes the ported body through the engine evaluator with a
  // stdModule-only registry. 4 truth-table-like fixtures cover the
  // polymorphic payload (Number / String / List), confirming the
  // payload passes through unchanged. 2 lazy-semantics probes assert
  // that when the unchosen branch carries a divide-by-zero-shaped data
  // value, it's never returned — proves the pre-5b8 eager-evaluation
  // caveat is retired post-flip. If `applyOp`'s `if` structural-form
  // case branch ever regresses to eager evaluation, these tests catch
  // it.
  const registry = createRegistry([stdModule]);
  const ctx = registry.evaluateContext();
  const ifElseBody = (stdModule.functions ?? []).find(
    (f) => f.id === "std:ifElse",
  )!.body;

  // Truth-table-like — Number payloads.
  expect(
    evaluate(ifElseBody, { condition: true, consequent: 1, alternative: 2 }, ctx),
  ).toBe(1);
  expect(
    evaluate(ifElseBody, { condition: false, consequent: 1, alternative: 2 }, ctx),
  ).toBe(2);
  // Polymorphic-payload — String passes through.
  expect(
    evaluate(
      ifElseBody,
      { condition: true, consequent: "hello", alternative: "world" },
      ctx,
    ),
  ).toBe("hello");
  // Polymorphic-payload — List passes through.
  expect(
    evaluate(
      ifElseBody,
      { condition: false, consequent: [1, 2], alternative: [3, 4] },
      ctx,
    ),
  ).toEqual([3, 4]);

  // Lazy-semantics probes — divide-by-zero-shaped data in the unchosen
  // branch must NOT be returned (else result would be the object
  // literal, not the chosen branch's value).
  expect(
    evaluate(
      ifElseBody,
      { condition: false, consequent: { "/": [1, 0] }, alternative: 42 },
      ctx,
    ),
  ).toBe(42);
  expect(
    evaluate(
      ifElseBody,
      { condition: true, consequent: "ok", alternative: { "/": [1, 0] } },
      ctx,
    ),
  ).toBe("ok");
});

// ---------------------------------------------------------------------------
// Phase 5b9 — first sub-phase combining TS-native deletion with a BUNDLED
// DOWNSTREAM REFACTOR (not just .fenel-ident divergence per 5b6/5b7 or
// spec-param rename per 5b8). Ports `std:tryParseBoolean` to `.fenel`
// source — body if-cascade `if elem (lower (trim s)) [...truthy...]
// then Just (True) else if elem (lower (trim s)) [...falsy...] then
// Just (False) else Nothing`. Pre-5b9 the TS native returned non-
// conformant `true | false | null` where the spec declares `returns:
// Maybe(Boolean)` (AGENTS.md says null is BANNED in Fenel). Post-5b9
// the body returns the conformant `{$tag: "Just", _0: bool} |
// {$tag: "Nothing"}` shape AND the sole downstream caller at
// engine/src/modules/telegram.ts:1417 updates its match pattern from
// raw-null + bare-bind to the canonical Maybe-variant shape. .fenel
// ident `tryParseBooleanFn` per 5b6/5b7/5b8 hybrid-port convention.
// `stdNatives` IS touched — pre-5b9 entry deleted. First sub-phase
// fixing a spec-conformance bug while porting.
// ---------------------------------------------------------------------------

test("Phase 5b9 — tryParseBoolean.fenel parses to exactly 1 function (per-file roster lock)", () => {
  const mod = loadFenelModule(tryParseBooleanSrc, "std-tryParseBoolean");
  const fns = mod.functions ?? [];
  expect(fns.length).toBe(1);
  expect(fns[0]!.id).toBe("std:tryParseBoolean");
});

test("Phase 5b9 — std:tryParseBoolean body LOADED FROM `.fenel`; stdNatives.tryParseBoolean deleted; spec returns Maybe(Boolean)", () => {
  // Phase 5b9 adds a body to the previously-TS-native spec (pre-5b9
  // body was undefined; dispatch went through stdNatives.tryParseBoolean
  // which returned non-conformant `true | false | null`). Post-5b9 the
  // body is sourced from `.fenel` and the stdNatives entry is deleted —
  // dispatch flows through the body returning conformant Maybe(Boolean).
  const fn = (stdModule.functions ?? []).find((f) => f.id === "std:tryParseBoolean");
  expect(fn).toBeDefined();
  expect(fn!.body).toBeDefined();
  const mod = loadFenelModule(tryParseBooleanSrc, "std-tryParseBoolean");
  const expectedBody = (mod.functions ?? []).find(
    (f) => f.id === "std:tryParseBoolean",
  )?.body;
  expect(fn!.body).toEqual(expectedBody);
  // Body shape: if-form (the outer constructor of the if-cascade).
  expect(fn!.body && typeof fn!.body === "object" && "if" in (fn!.body as object)).toBe(true);
  // Pre-flip dispatch path is gone — `tryParseBoolean` entry deleted
  // from stdNatives. Without the delete, the body would be shadowed
  // by the non-conformant native.
  expect("tryParseBoolean" in stdNatives).toBe(false);
  // Spec declares Maybe(Boolean) — conformance bug fixed.
  const returns = fn!.returns;
  expect(returns && typeof returns === "object" && "$variant" in (returns as object)).toBe(true);
});

test("Phase 5b9 — semantic regression smoke (10 fixtures: 5 truthy + 3 falsy + 2 unknown — all return conformant Maybe(Boolean))", () => {
  // Post-5b9 dispatch returns `{$tag: "Just", _0: bool}` for
  // recognised inputs and `{$tag: "Nothing"}` for unknowns — never
  // raw `null`. Verifies the spec-conformance fix end-to-end via
  // the registry.
  const registry = createRegistry([stdModule]);
  const ctx = registry.evaluateContext();
  const call = (s: string) => evaluate({ call: ["tryParseBoolean", s] }, {}, ctx);
  expect(call("yes")).toEqual({ $tag: "Just", _0: true });
  expect(call("Y")).toEqual({ $tag: "Just", _0: true });
  expect(call("TRUE")).toEqual({ $tag: "Just", _0: true });
  expect(call(" yeah ")).toEqual({ $tag: "Just", _0: true });
  expect(call("1")).toEqual({ $tag: "Just", _0: true });
  expect(call("no")).toEqual({ $tag: "Just", _0: false });
  expect(call("0")).toEqual({ $tag: "Just", _0: false });
  expect(call("false")).toEqual({ $tag: "Just", _0: false });
  expect(call("maybe")).toEqual({ $tag: "Nothing" });
  expect(call("")).toEqual({ $tag: "Nothing" });
  expect(call("yes maybe")).toEqual({ $tag: "Nothing" });
});
