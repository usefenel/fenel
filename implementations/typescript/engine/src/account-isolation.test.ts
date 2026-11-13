// ---------------------------------------------------------------------------
// Per-account isolation — named sets and decompose parsers shadow globals
// only when ctx.accountId is supplied. Without a ctx, only globals apply.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerNamedSet,
  registerAccountNamedSet,
  unregisterAccountNamedSet,
  clearAccountNamedSets,
  listAccountNamedSets,
  registerDecomposeParser,
  getDecomposeParser,
  registerAccountDecomposeParser,
  clearAccountDecomposeParsers,
  applyAccountNamedSets,
  refreshAccountNamedSets,
  applyAccountDecomposeParsers,
  refreshAccountDecomposeParsers,
} from "./index";
// `contains` returns MaybeBool (Phase 4); the existing assertions compare
// against booleans, so import the `B`-suffixed wrapper that collapses
// `Nothing` to `false` at the boundary.
import { containsB as contains, getAccountNamedSet } from "./set-algebra";
import type { SetExpr } from "./types";
import type { EvaluateContext } from "./json-logic";
const A = "acct_a_test";
const B = "acct_b_test";

const enumSet = (...values: unknown[]): SetExpr => ({ $tag: "SeEnum", values });

function containsHostFunction(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === "function") return true;
  if (value === null || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child) => containsHostFunction(child, seen));
}

beforeEach(() => {
  // Clean any leftover state from prior runs
  clearAccountNamedSets(A);
  clearAccountNamedSets(B);
  clearAccountDecomposeParsers(A);
  clearAccountDecomposeParsers(B);
});

describe("per-account named sets", () => {
  it("account SetExpr shadows global when ctx.accountId matches", () => {
    registerNamedSet("test:tenant-id", (v) => typeof v === "string" && /^global-\d+$/.test(v));
    const accountSet = enumSet("a-1");
    registerAccountNamedSet(A, "test:tenant-id", accountSet);

    const member = getAccountNamedSet(A, "test:tenant-id");
    expect(member).toMatchObject({
      __fenelPartial: true,
      fn: { $ref: "engine:setAlgebraContains" },
      collected: [accountSet],
      arity: 2,
    });
    expect(containsHostFunction(member)).toBe(false);

    // No ctx → global predicate
    expect(contains({ $tag: "SeRef", handle: "test:tenant-id" }, "global-1", null)).toBe(true);
    expect(contains({ $tag: "SeRef", handle: "test:tenant-id" }, "a-1", null)).toBe(false);

    // Account A ctx → account set
    expect(contains({ $tag: "SeRef", handle: "test:tenant-id" }, "global-1", A)).toBe(false);
    expect(contains({ $tag: "SeRef", handle: "test:tenant-id" }, "a-1", A)).toBe(true);

    // Account B ctx → falls through to global (no override)
    expect(contains({ $tag: "SeRef", handle: "test:tenant-id" }, "global-1", B)).toBe(true);
    expect(contains({ $tag: "SeRef", handle: "test:tenant-id" }, "a-1", B)).toBe(false);
  });

  it("account SetExpr works for names with no global counterpart", () => {
    registerAccountNamedSet(A, "test:account-only", enumSet("magic-a"));

    // Without ctx: not found, returns false
    expect(contains({ $tag: "SeRef", handle: "test:account-only" }, "magic-a", null)).toBe(false);
    // With ctx: found
    expect(contains({ $tag: "SeRef", handle: "test:account-only" }, "magic-a", A)).toBe(true);
    expect(contains({ $tag: "SeRef", handle: "test:account-only" }, "other", A)).toBe(false);
  });

  it("unregister removes one name without affecting siblings", () => {
    registerAccountNamedSet(A, "test:x", enumSet("x"));
    registerAccountNamedSet(A, "test:y", enumSet("y"));
    expect(listAccountNamedSets(A).sort()).toEqual(["test:x", "test:y"]);

    unregisterAccountNamedSet(A, "test:x");
    expect(listAccountNamedSets(A)).toEqual(["test:y"]);

    expect(contains({ $tag: "SeRef", handle: "test:x" }, "x", A)).toBe(false);
    expect(contains({ $tag: "SeRef", handle: "test:y" }, "y", A)).toBe(true);
  });

  it("clearAccountNamedSets removes all for one account, leaves others", () => {
    registerAccountNamedSet(A, "test:x", enumSet("x"));
    registerAccountNamedSet(B, "test:x", enumSet("X"));

    clearAccountNamedSets(A);
    expect(listAccountNamedSets(A)).toEqual([]);
    expect(listAccountNamedSets(B)).toEqual(["test:x"]);
    expect(contains({ $tag: "SeRef", handle: "test:x" }, "X", B)).toBe(true);
  });

  it("applyAccountNamedSets / refreshAccountNamedSets — bulk surface", () => {
    applyAccountNamedSets(A, [
      { name: "test:bulk1", set: enumSet(1) },
      { name: "test:bulk2", set: enumSet(2) },
    ]);
    expect(listAccountNamedSets(A).sort()).toEqual(["test:bulk1", "test:bulk2"]);

    // refresh wipes & replaces
    refreshAccountNamedSets(A, [
      { name: "test:bulk3", set: enumSet(3) },
    ]);
    expect(listAccountNamedSets(A)).toEqual(["test:bulk3"]);
    expect(contains({ $tag: "SeRef", handle: "test:bulk1" }, 1, A)).toBe(false);
    expect(contains({ $tag: "SeRef", handle: "test:bulk3" }, 3, A)).toBe(true);
  });

  it("propagates accountId through nested SetExpr ($intersect, $union, $complement, $diff)", () => {
    registerAccountNamedSet(A, "test:positive", enumSet(3, 4, 5));
    registerAccountNamedSet(A, "test:even", enumSet(-4, -2, 4, 6));

    const positiveAndEven = { $tag: "SeIntersect", branches: [{ $tag: "SeRef", handle: "test:positive" }, { $tag: "SeRef", handle: "test:even" }] } as SetExpr;
    expect(contains(positiveAndEven, 4, A)).toBe(true);
    expect(contains(positiveAndEven, 3, A)).toBe(false);
    expect(contains(positiveAndEven, -2, A)).toBe(false);
    // Without ctx: account sets aren't visible
    expect(contains(positiveAndEven, 4, null)).toBe(false);

    const positiveOrEven = { $tag: "SeUnion", branches: [{ $tag: "SeRef", handle: "test:positive" }, { $tag: "SeRef", handle: "test:even" }] } as SetExpr;
    expect(contains(positiveOrEven, -4, A)).toBe(true);  // even
    expect(contains(positiveOrEven, 5, A)).toBe(true);   // positive

    const notPositive = { $tag: "SeComplement", inner: { $tag: "SeRef", handle: "test:positive" } } as SetExpr;
    expect(contains(notPositive, -3, A)).toBe(true);
    expect(contains(notPositive, 3, A)).toBe(false);
  });

  it("applies a stored SeWhere through the live evaluation context, including `+` recursion", () => {
    let hits = 0;
    const evalCtx = {
      natives: {
        accountSetProbe: (value: unknown) => {
          hits += 1;
          return value === "allowed";
        },
      },
    } as unknown as EvaluateContext;
    registerAccountNamedSet(A, "test:eval-context", {
      $tag: "SeWhere",
      pred: { call: ["accountSetProbe", { var: "value" }] },
    });

    expect(contains(
      { $tag: "SeRef", handle: "test:eval-context" },
      "allowed", A, undefined, evalCtx,
    )).toBe(true);
    expect(contains(
      { $tag: "SeRef", handle: "test:eval-context" },
      "denied", A, undefined, evalCtx,
    )).toBe(false);
    expect(hits).toBe(2);

    registerAccountNamedSet(A, "test", { $tag: "SeAll" });
    registerAccountNamedSet(A, "test:composite", { $tag: "SeAll" });
    expect(contains(
      { $tag: "SeRef", handle: "test:composite+eval-context" },
      "allowed", A, undefined, evalCtx,
    )).toBe(true);
    expect(contains(
      { $tag: "SeRef", handle: "test:composite+eval-context" },
      "denied", A, undefined, evalCtx,
    )).toBe(false);
    expect(hits).toBe(4);
  });
});

describe("per-account decompose parsers — registry surface", () => {
  // Phase 3 retired the `$decompose` SetExpr constructor; the parser
  // registry (decompose.ts) remains as the data layer for future
  // `Decodable<String, T>` typeclass instances. These tests verify the
  // per-account-shadowing scope mechanics directly against the registry
  // — the SetExpr-integration tests that used to live here became
  // irrelevant when the constructor retired.

  it("account parser shadows global; bare lookup returns global", () => {
    const globalParser = (v: unknown) =>
      typeof v === "string" && v.startsWith("g:")
        ? { ok: true as const, value: { tag: "global", rest: v.slice(2) } }
        : { ok: false as const };
    const accountParser = (v: unknown) =>
      typeof v === "string" && v.startsWith("a:")
        ? { ok: true as const, value: { tag: "account", rest: v.slice(2) } }
        : { ok: false as const };

    registerDecomposeParser("test:thing", globalParser);
    registerAccountDecomposeParser(A, "test:thing", accountParser);

    // No accountId → global parser
    expect(getDecomposeParser("test:thing")?.("g:foo").ok).toBe(true);
    expect(getDecomposeParser("test:thing")?.("a:foo").ok).toBe(false);

    // accountId A → account parser shadows
    expect(getDecomposeParser("test:thing", A)?.("g:foo").ok).toBe(false);
    expect(getDecomposeParser("test:thing", A)?.("a:foo").ok).toBe(true);

    // accountId B → no override, falls through to global
    expect(getDecomposeParser("test:thing", B)?.("g:foo").ok).toBe(true);
    expect(getDecomposeParser("test:thing", B)?.("a:foo").ok).toBe(false);
  });

  it("applyAccountDecomposeParsers / refreshAccountDecomposeParsers — bulk surface", () => {
    applyAccountDecomposeParsers(A, [
      {
        name: "test:p1",
        parser: (v) => typeof v === "string"
          ? { ok: true as const, value: v }
          : { ok: false as const },
      },
    ]);
    expect(getDecomposeParser("test:p1", A)?.("x").ok).toBe(true);

    // refresh wipes
    refreshAccountDecomposeParsers(A, []);
    expect(getDecomposeParser("test:p1", A)).toBeUndefined();
  });
});
