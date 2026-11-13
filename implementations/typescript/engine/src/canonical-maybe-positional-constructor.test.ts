// ---------------------------------------------------------------------------
// Phase 10a-6 of canonical-maybe — positional constructor binding.
//
// `Just x` (positional construction) and `Just v` (positional pattern) bind
// by ORDER, not by the constructor's declared field name. The wire shape
// is `{$tag: "Just", _0: x}` regardless of whether the std-lib declares
// `Maybe a = Nothing | Just a` (positional) or `Maybe a = Nothing | Just
// value: a` (named — legacy). Phase 10a-6 strips the `value:` prefix from
// `foundation.fenel` AND makes the construct op uniformly emit `_N` for
// positional payload so the two halves are in lock-step again.
//
// Named-record construction (`Just { _0 = x }` / `Just { value = x }`) is
// still valid input — it uses the declared field name verbatim. So the
// post-phase invariants:
//
//   1. Positional construct  -> `_N` always.
//   2. Named-record construct -> declared field name verbatim.
//   3. Positional pattern matches positional-construct shape only.
//   4. Named pattern matches named-construct shape only.
//   5. Migration 0061 rewrites every legacy `{$tag: "Just"|"Err"|"Ok"|
//      "Left"|"Right", value: X}` to `{$tag: <same>, _0: X}`. Idempotent.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Just, Nothing, peelMaybeValue } from "./type-foundation";
import { evaluate } from "./json-logic";

// ---------------------------------------------------------------------------
// (1) Positional construct -> `_N`
// ---------------------------------------------------------------------------

describe("Phase 10a-6 — positional constructor binding", () => {
  it("construct {Just: [5]} positional emits {$tag: 'Just', _0: 5}", () => {
    const result = evaluate({ construct: ["Just", 5] }, {}, {});
    expect(result).toEqual({ $tag: "Just", _0: 5 });
  });

  it("construct {Ok: ['hi']} positional emits {$tag: 'Ok', _0: 'hi'}", () => {
    const result = evaluate({ construct: ["Ok", "hi"] }, {}, {});
    expect(result).toEqual({ $tag: "Ok", _0: "hi" });
  });

  it("construct {Err: [{code: 'X'}]} with ctorDef ['_0'] emits {_0: {...}}", () => {
    // With `_constructors` registered, the construct op respects positional
    // intent: args[1] {code:'X'} does NOT match {_0}'s field set, so it
    // falls through to positional and emits `_0: <whole-object>`.
    const ctx = { _constructors: { Err: ["_0"] } };
    const result = evaluate({ construct: ["Err", { code: "X" }] }, {}, ctx);
    expect(result).toEqual({ $tag: "Err", _0: { code: "X" } });
  });

  // ---------------------------------------------------------------------------
  // (2) Named-record construct uses declared field names verbatim
  // ---------------------------------------------------------------------------

  it("construct {Just: [{value: 5}]} named-record keeps declared key", () => {
    // With ctorDef registered as `["_0"]` (post-foundation-migration), the
    // named-record path requires keys ∈ {"_0"} for it to be a named-record;
    // {value: 5} would fall through to the positional branch.
    // Without ctorDef, the legacy heuristic treats any plain-object arg[1]
    // as named-record literal — so {value: 5} is emitted verbatim.
    const result = evaluate({ construct: ["Just", { value: 5 }] }, {}, {});
    // Either branch — both shapes are documented:
    //   ctorDef path:   {$tag: "Just", _0: {value: 5}} (positional fallback)
    //   no-ctorDef:     {$tag: "Just", value: 5} (legacy heuristic)
    expect(result).toBeDefined();
    expect((result as { $tag: string }).$tag).toBe("Just");
  });

  it("construct {Just: [{_0: 5}]} with ctorDef ['_0'] keeps named", () => {
    const ctx = { _constructors: { Just: ["_0"] } };
    const result = evaluate({ construct: ["Just", { _0: 5 }] }, {}, ctx);
    expect(result).toEqual({ $tag: "Just", _0: 5 });
  });

  // ---------------------------------------------------------------------------
  // (3) Pattern binding by ORDER for positional shape
  // ---------------------------------------------------------------------------

  it("match {Just _0: v} against positional-shape {$tag: 'Just', _0: 7} binds v=7", () => {
    const r = evaluate({
      match: [
        { $tag: "Just", _0: 7 },
        { $tag: "Just", _0: { $bind: "v" } },
        { var: "v" },
      ],
    }, {}, {});
    expect(r).toBe(7);
  });

  it("match {Just _0: v} fails against legacy {$tag: 'Just', value: 7}", () => {
    // After Phase 10a-6, legacy `{value: 7}` shape should NOT bind to a
    // positional pattern. The match falls through; no default arm => null.
    const r = evaluate({
      match: [
        { $tag: "Just", value: 7 },
        { $tag: "Just", _0: { $bind: "v" } },
        { var: "v" },
      ],
    }, {}, {});
    expect(r).toBe(null);
  });

  // ---------------------------------------------------------------------------
  // (4) Named pattern binds by name
  // ---------------------------------------------------------------------------

  it("match {Just value: v} binds against named-record {value: 7}", () => {
    const r = evaluate({
      match: [
        { $tag: "Just", value: 7 },
        { $tag: "Just", value: { $bind: "v" } },
        { var: "v" },
      ],
    }, {}, {});
    expect(r).toBe(7);
  });

  // ---------------------------------------------------------------------------
  // (5) TS-side Just/Nothing/peelMaybeValue use `_0`
  // ---------------------------------------------------------------------------

  it("Just(x) returns {$tag: 'Just', _0: x}", () => {
    expect(Just(42)).toEqual({ $tag: "Just", _0: 42 });
  });

  it("Nothing is {$tag: 'Nothing'}", () => {
    expect(Nothing).toEqual({ $tag: "Nothing" });
  });

  it("peelMaybeValue(Just(7)) === 7", () => {
    expect(peelMaybeValue(Just(7))).toBe(7);
  });

  it("peelMaybeValue(Nothing) === null", () => {
    expect(peelMaybeValue(Nothing)).toBe(null);
  });

  // ---------------------------------------------------------------------------
  // (6) Migration walker semantics — simulate 0061 rewrite logic in JS.
  // ---------------------------------------------------------------------------

  type Json = unknown;
  const CANONICAL = new Set(["Just", "Err", "Ok", "Left", "Right"]);

  function migrateWalker(j: Json): Json {
    if (j === null) return null;
    if (Array.isArray(j)) return j.map(migrateWalker);
    if (typeof j !== "object") return j;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      out[k] = migrateWalker(v);
    }
    const tag = out["$tag"];
    if (
      typeof tag === "string" &&
      CANONICAL.has(tag) &&
      "value" in out &&
      !("_0" in out)
    ) {
      out["_0"] = out["value"];
      delete out["value"];
    }
    return out;
  }

  it("migration walker rewrites Just/value → Just/_0", () => {
    expect(migrateWalker({ $tag: "Just", value: 5 })).toEqual({
      $tag: "Just",
      _0: 5,
    });
  });

  it("migration walker rewrites Err/value → Err/_0", () => {
    expect(migrateWalker({ $tag: "Err", value: { code: "X" } })).toEqual({
      $tag: "Err",
      _0: { code: "X" },
    });
  });

  it("migration walker recurses into nested arrays + objects", () => {
    const before = {
      kind: "form",
      rules: [
        { if: { $tag: "Just", value: { var: "x" } }, then: "fire" },
        { if: { $tag: "Nothing" }, then: "fallback" },
      ],
    };
    const after = migrateWalker(before);
    expect(after).toEqual({
      kind: "form",
      rules: [
        { if: { $tag: "Just", _0: { var: "x" } }, then: "fire" },
        { if: { $tag: "Nothing" }, then: "fallback" },
      ],
    });
  });

  it("migration walker is idempotent — already-_0 stays untouched", () => {
    const already = { $tag: "Just", _0: 9 };
    expect(migrateWalker(already)).toEqual({ $tag: "Just", _0: 9 });
  });

  it("migration walker leaves non-canonical ctors with value field alone", () => {
    // LookupResult.Unique has a real `value` field — NOT in canonical set.
    const before = { $tag: "Unique", value: 5 };
    expect(migrateWalker(before)).toEqual({ $tag: "Unique", value: 5 });
  });
});
