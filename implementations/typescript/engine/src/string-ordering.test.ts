// ---------------------------------------------------------------------------
// string-ordering.test.ts — set-algebra-to-fenel Phase 3b-3 (string-ordering
// enabler).
//
// Before this phase, `lt`/`gt`/`lte`/`gte` were numeric-only (`toNum("b")` is
// NaN, so EVERY string comparison returned false). That silently broke the
// pure-Fenel interval-string deciders (a `[a..c]` char-class interval
// "contained" everything). This phase adds:
//   - `charCode : Char -> Number` — the ONE irreducible host leaf (.codePointAt).
//   - pure-Fenel `charLt` / `charCompare` / `strCompare` / `strLt` (ord.fenel),
//     the declared SOURCE OF TRUTH for lexical ordering, built on `charCode`.
//   - a both-strings perf branch on `lt`/`gt`/`lte`/`gte` (the std-ffi natives
//     AND the json-logic BUILTIN_OP_NATIVES fallback) — the opaque-repr branch
//     byte-equivalent to `strCompare s1 s2 < 0`.
//
// This pins all three, the numbers-unchanged invariant, and the char-class
// `[a..c]` interval-membership logic the deciders rely on (now correct via the
// fixed comparison ops in pure Fenel).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { invokeCallable, evaluate } from "./json-logic";

const reg = createRegistry([stdModule]);
const ctx = reg.evaluateContext();
const call = (id: string, ...args: unknown[]) => invokeCallable(id, args, ctx);

describe("charCode — the host leaf is registered + ordinal-correct", () => {
  test("charCode maps a 1-char string to its code point", () => {
    expect(call("std:charCode", "a")).toBe(97);
    expect(call("std:charCode", "b")).toBe(98);
    expect(call("std:charCode", "A")).toBe(65);
    expect(call("std:charCode", "0")).toBe(48);
  });
  test("charCode of the empty string is 0; reads the FIRST code point of a longer string", () => {
    expect(call("std:charCode", "")).toBe(0);
    expect(call("std:charCode", "abc")).toBe(97);
  });
  test("charCode ∘ charFromCode round-trips (incl. a non-BMP code point)", () => {
    for (const cp of [65, 97, 48, 0x1f600 /* 😀 */]) {
      expect(call("std:charCode", call("std:charFromCode", cp))).toBe(cp);
    }
  });
});

describe("charLt / charCompare — char ordering reduces to code-point ordering", () => {
  test("charLt", () => {
    expect(call("std:charLt", "a", "b")).toBe(true);
    expect(call("std:charLt", "b", "a")).toBe(false);
    expect(call("std:charLt", "a", "a")).toBe(false);
    expect(call("std:charLt", "A", "a")).toBe(true); // 65 < 97
  });
  test("charCompare → -1 | 0 | 1", () => {
    expect(call("std:charCompare", "a", "b")).toBe(-1);
    expect(call("std:charCompare", "b", "a")).toBe(1);
    expect(call("std:charCompare", "a", "a")).toBe(0);
  });
});

describe("strCompare / strLt — the pure-Fenel lexical source of truth", () => {
  test("first differing char decides", () => {
    expect(call("std:strCompare", "abc", "abd")).toBe(-1);
    expect(call("std:strCompare", "abd", "abc")).toBe(1);
    expect(call("std:strCompare", "abc", "abc")).toBe(0);
  });
  test("a prefix orders before its extension; empty is least", () => {
    expect(call("std:strCompare", "ab", "abc")).toBe(-1);
    expect(call("std:strCompare", "abc", "ab")).toBe(1);
    expect(call("std:strCompare", "", "a")).toBe(-1);
    expect(call("std:strCompare", "a", "")).toBe(1);
    expect(call("std:strCompare", "", "")).toBe(0);
  });
  test("strLt agrees with strCompare < 0", () => {
    expect(call("std:strLt", "ab", "abc")).toBe(true);
    expect(call("std:strLt", "abc", "ab")).toBe(false);
    expect(call("std:strLt", "apple", "banana")).toBe(true);
  });
});

describe("lt / gt / lte / gte — string perf branch (std native + invokeCallable)", () => {
  test("std:lt over strings orders lexically", () => {
    expect(call("std:lt", "b", "c")).toBe(true);
    expect(call("std:lt", "c", "b")).toBe(false);
    expect(call("std:lte", "a", "a")).toBe(true);
    expect(call("std:gt", "c", "b")).toBe(true);
    expect(call("std:gte", "a", "a")).toBe(true);
  });
  test("strLt and the std:lt perf branch agree over strings", () => {
    const pairs: [string, string][] = [["a", "b"], ["abc", "abd"], ["ab", "abc"], ["A", "a"], ["", "x"]];
    for (const [a, b] of pairs) {
      expect(call("std:lt", a, b)).toBe(call("std:strLt", a, b) as boolean);
    }
  });
});

describe("evaluate() — operator-form over the default (registry-less) ctx", () => {
  test("string comparisons (the brief's gate)", () => {
    expect(evaluate({ "<": ["b", "c"] })).toBe(true);
    expect(evaluate({ ">": ["b", "c"] })).toBe(false);
    expect(evaluate({ "<=": ["a", "a"] })).toBe(true);
    expect(evaluate({ ">=": ["b", "a"] })).toBe(true);
  });
  test("numeric comparisons UNCHANGED", () => {
    expect(evaluate({ "<": [1, 2] })).toBe(true);
    expect(evaluate({ ">": [5, 2] })).toBe(true);
    expect(evaluate({ "<=": [2, 2] })).toBe(true);
    expect(evaluate({ ">=": [1, 9] })).toBe(false);
    expect(evaluate({ "<": [2, 1] })).toBe(false);
  });
  test("codeName-keyed form agrees", () => {
    expect(evaluate({ lt: ["b", "c"] })).toBe(true);
    expect(evaluate({ gte: [3, 3] })).toBe(true);
  });
});

describe("[a..c] char-class interval membership — now correct in pure Fenel", () => {
  // Interval membership x ∈ [lo..hi] is `gte x lo && lte x hi` — exactly what
  // the set-algebra interval-string deciders fold over. Before this phase the
  // string branch always returned false, so the AND collapsed and the interval
  // mis-accepted everything. Pin the corrected behaviour.
  const inAC = (x: string) =>
    (call("std:gte", x, "a") as boolean) && (call("std:lte", x, "c") as boolean);
  test("members", () => {
    expect(inAC("a")).toBe(true);
    expect(inAC("b")).toBe(true);
    expect(inAC("c")).toBe(true);
  });
  test("non-members (above, and uppercase below 'a')", () => {
    expect(inAC("d")).toBe(false); // above hi
    expect(inAC("A")).toBe(false); // 'A'(65) < 'a'(97) — below lo
    expect(inAC("z")).toBe(false);
  });
});
