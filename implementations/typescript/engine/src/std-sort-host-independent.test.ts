// std:sort's native is the engine's own stable merge over keys computed once
// (2026-10-30), so its order no longer depends on the host's
// Array.prototype.sort. For a consistent key comparator it must give exactly
// the order the host sort gave. Since the same day it mirrors the Fenel body
// (hof-combine.fenel) exactly: incomparable keys (std `lt` false both ways:
// across types, Bools, records, NaN) are a tie and keep encounter order.
import { describe, expect, test } from "bun:test";
import { stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi";
import { harnessForTests } from "./engine-bodies-dispatch";
import { evaluate } from "./json-logic";

const sortNative = stdNativesCtx["sort"] as (ctx: unknown, fn: unknown, xs: unknown) => unknown[];
const ctx = harnessForTests().ctx;

// The comparator the previous native handed to Array.prototype.sort.
function hostOrder(xs: unknown[], key: (x: unknown) => unknown): unknown[] {
  return [...xs].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (typeof ka === "number" && typeof kb === "number") return ka - kb;
    const sa = String(ka), sb = String(kb);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

let seed = 20261030;
const random = (): number => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

describe("std:sort native", () => {
  test("equals the host sort for consistent keys, including stable ties", () => {
    for (let round = 0; round < 60; round += 1) {
      const n = Math.floor(random() * 300);
      const numbers = Array.from({ length: n }, (_, i) => ({ k: Math.floor(random() * 20) - 5, i }));
      const special = Array.from({ length: n }, (_, i) => ({ k: [Infinity, -Infinity, -0, 0, 1.5][i % 5]!, i }));
      const strings = Array.from({ length: n }, (_, i) => ({ k: String.fromCharCode(97 + Math.floor(random() * 5), 0xd800 + (i % 3)), i }));
      for (const items of [numbers, special, strings]) {
        const fn = { $ref: "std:id" };
        const byField = (x: unknown) => (x as { k: unknown }).k;
        const viaKey = sortNative(ctx, { __fenelFn: true, params: ["x"], body: { var: "x.k" }, closure: {} }, items);
        expect(viaKey).toEqual(hostOrder(items, byField));
        const keys = items.map(byField);
        expect(sortNative(ctx, fn, keys)).toEqual(hostOrder(keys, (x) => x));
      }
    }
  });

  test("incomparable keys are a tie: encounter order is kept", () => {
    const id = { $ref: "std:id" };
    expect(sortNative(ctx, id, [3, Number.NaN, "10", 2, 9])).toEqual([3, Number.NaN, "10", 2, 9]);
    expect(sortNative(ctx, id, [2, Number.NaN, 1])).toEqual([2, Number.NaN, 1]);
    expect(sortNative(ctx, id, [1, "a"])).toEqual([1, "a"]);
    expect(sortNative(ctx, id, ["a", 1])).toEqual(["a", 1]);
    expect(sortNative(ctx, id, [true, false])).toEqual([true, false]);
    expect(sortNative(ctx, id, [3, "b", 1, "a"])).toEqual([1, 3, "a", "b"]);
    expect(sortNative(ctx, id, [3, 1, "b", "a"])).toEqual([1, 3, "a", "b"]);
  });

  test("converts no key to text; a single element and undefined elements are keyed like any other", () => {
    // A null-prototype key cannot be converted to a string; std `lt` never
    // converts, so comparing two of them is a tie, not a throw.
    const opaque = Object.create(null);
    const other = Object.create(null);
    expect(sortNative(ctx, { $ref: "std:id" }, [opaque, other])).toEqual([opaque, other]);
    const counting = { __fenelFn: true, params: ["x"], body: { var: "x" }, closure: {} };
    const keyed = sortNative(ctx, counting, [{ n: 1 }]);
    expect(keyed).toEqual([{ n: 1 }]);
    const id = { $ref: "std:id" };
    // Undefined elements are keyed like any other (a tie with everything).
    expect(sortNative(ctx, id, [3, undefined, 1, 2, undefined])).toEqual([1, 2, 3, undefined, undefined]);
    expect(sortNative(ctx, id, [3, 1, undefined, 2])).toEqual([1, 3, undefined, 2]);
    expect(sortNative(ctx, id, "not a list")).toEqual([]);
  });

  test("the native and the Fenel body agree on every input, mixed and incomparable keys included", () => {
    const viaBody = (key: unknown, xs: unknown[]): unknown => evaluate(
      { call: ["sortUndecorate", { call: ["sortPairs", { call: ["sortDecorate", { var: "key" }, { var: "xs" }] }] }] } as never,
      { key, xs }, ctx);
    const pool: unknown[] = [1, 2, 2, -0, 0, Number.NaN, Infinity, -Infinity, "a", "b", "10", "", true, false, null,
      { a: 1 }, { a: 1 }, [1], [0]];
    const pinned: unknown[][] = [[1, "a"], ["a", 1], [false, true], [true, false], [2, Number.NaN, 1], [{ a: 1 }, { a: 1 }],
      [{ a: 2 }, { a: 1 }], [null, 1, null], ["b", 1, "a", 0]];
    const id = { $ref: "std:id" };
    const byK = { __fenelFn: true, params: ["x"], body: { var: "x.k" }, closure: {} };
    const cases: unknown[][] = [...pinned];
    for (let n = 0; n <= 9; n += 1) {
      for (let round = 0; round < 12; round += 1) cases.push(Array.from({ length: n }, () => pool[Math.floor(random() * pool.length)]));
    }
    for (const xs of cases) {
      expect([xs, sortNative(ctx, id, xs)]).toEqual([xs, viaBody(id, xs) as unknown[]]);
      const records = xs.map((k, i) => ({ k, i }));
      expect([xs, sortNative(ctx, byK, records)]).toEqual([xs, viaBody(byK, records) as unknown[]]);
    }
  });

  // fix-engine 2026-10-31: the edges the S1 claim covers, element by element
  // (`Object.is` per position, so a hole, `undefined` and -0 stay apart).
  test("the native and the Fenel body agree on undefined, holes, bigints and a throwing key", () => {
    const viaBody = (key: unknown, xs: unknown[]): unknown => evaluate(
      { call: ["sortUndecorate", { call: ["sortPairs", { call: ["sortDecorate", { var: "key" }, { var: "xs" }] }] }] } as never,
      { key, xs }, ctx);
    const id = { $ref: "std:id" };
    const byK = { __fenelFn: true, params: ["x"], body: { var: "x.k" }, closure: {} };
    const positions = (xs: unknown): Array<[boolean, unknown]> => {
      const list = xs as unknown[];
      return Array.from({ length: list.length }, (_, i) => [Object.prototype.hasOwnProperty.call(list, i), list[i]]);
    };
    // eslint-disable-next-line no-sparse-arrays
    const holed = [3, , 1, 2] as unknown[];
    const pool: unknown[] = [undefined, 2, 1, 2n, 1n, "a", Number.NaN, null];
    const cases: unknown[][] = [[undefined, 1], [1, undefined], [3, undefined, 1, 2, undefined], holed, [, 1] as unknown[],
      [2n, 1n], [1n, 1], [2, 1n, 1], [1n, "a", 0n]];
    for (let n = 0; n <= 8; n += 1) {
      for (let round = 0; round < 10; round += 1) cases.push(Array.from({ length: n }, () => pool[Math.floor(random() * pool.length)]));
    }
    for (const xs of cases) {
      const native = sortNative(ctx, id, xs);
      const body = viaBody(id, xs);
      expect([positions(xs), positions(native)]).toEqual([positions(xs), positions(body)]);
      for (const [index, value] of positions(native).entries()) expect(Object.is(value[1], positions(body)[index]![1])).toBe(true);
      // Undefined keys (a missing field) beside defined ones.
      const records = xs.map((k, i) => (k === undefined ? { i } : { k, i }));
      expect([xs, sortNative(ctx, byK, records)]).toEqual([xs, viaBody(byK, records) as unknown[]]);
    }
    // A throwing key: both surface the error of the same element, the first
    // in encounter order whose key throws (std:regexSet names its input).
    const thrower = { __fenelFn: true, params: ["x"], body: { call: ["regexSet", { var: "x" }] }, closure: {} };
    const surfaced = (run: () => unknown): string => {
      try { run(); } catch (error) { return error instanceof Error ? error.message : String(error); }
      return "no error";
    };
    for (const [xs, first] of [[["a", "(", ")"], "/(/"], [["a", ")", "("], "/)/"], [["a", "b", "c", "("], "/(/"],
      [["(", "a"], "/(/"], [[")"], "/)/"], [["b", "a", "d", "c", ")", "("], "/)/"]] as Array<[string[], string]>) {
      const left = surfaced(() => sortNative(ctx, thrower, xs));
      const right = surfaced(() => viaBody(thrower, xs));
      expect([xs, left]).toEqual([xs, right]);
      expect(left.endsWith(first)).toBe(true);
    }
  });
});
