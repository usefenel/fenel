// ---------------------------------------------------------------------------
// module-migrate-std.test.ts — typed-function-references FenelModule-retirement
// Phase FM-retire-9 parity proof + roster lock for the `std` port.
//
// std is the largest + most load-bearing module. FM-retire-9 moved nearly its
// entire `defineFunction` surface into `module std where` `.fenel`: 9a the 22
// bodied helpers, 9b the 176 native-only leaves (impls → ffi/std-ffi.ts), 9c
// `bindResult` (operators.fenel). FM-retire-10 then ported the 4 dependent
// type-returners (recordType bodied → recordType.fenel; typeOf / vecOfLength /
// lengthBoundedStringOf `@native` → native/type-native.fenel) via the Ext1 `Type`
// type-atom. FM-retire-11 (L1) then ported the LAST 2 combinators `.`/`$` to
// operators.fenel — the loader's scope-resolution pass (`resolveLocalCallHeads`,
// fenel-module.ts) rewrites their local-applying bare-string heads to `{var}`
// heads at load time, so they self-host on JS+Wasm losslessly (byte-identical
// core IR) and the 9c `callOp` interpreter band-aid is retired. std.ts is now a
// thin loader at **0** `defineFunction` — every std fn is `.fenel`-authored.
//
// GENERATE-THEN-LOCK: the pre-migration TS specs are already retired (9a/9b), so
// this oracle is a NORMALIZED snapshot of the post-9c stdModule (dumped by
// scripts/gen-std-oracle.ts → module-migrate-std.oracle.json), the regression
// lock the live module is compared against. The §4 normalizations are applied on
// BOTH sides so the lock is robust to the documented cosmetic divergences while
// still catching any real roster / sig / facet change:
//   1. type-var $var/$ref/$ref of a name → one token ({$ref})
//   2. anonymous arrow-param names → _i (positional)
//   4. object key order canonicalized (sort)
// (Normalization 3 — compose/flip's return-var `r`, the 9b Surprise-2 gap — is
// already the loaded shape, so the snapshot carries `r` with no special-casing.)
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { stdModule } from "./modules/std";
import { createRegistry } from "./registry";
import { evaluate } from "./json-logic";
import { perform } from "./perform";
import { parse } from "./fenel-parser";
import type { Instance } from "./types";
import oracle from "./module-migrate-std.oracle.json";

// norm — identical to scripts/gen-std-oracle.ts (normalizations 1/2/4).
function norm(t: unknown): unknown {
  if (Array.isArray(t)) return t.map(norm);
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if (typeof o.$var === "string") return { $ref: o.$var };
    if (typeof o.$ref === "string") return { $ref: o.$ref };
    if (o.$arrow && typeof o.$arrow === "object") {
      const arr = o.$arrow as { params?: unknown[]; returns?: unknown };
      const params = (arr.params ?? []).map((p, i) => {
        const pn = norm(p) as Record<string, unknown>;
        return { ...pn, name: `_${i}` };
      });
      return { $arrow: sortKeys({ params, returns: norm(arr.returns) }) };
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = norm(o[k]);
    return sortKeys(out);
  }
  return t;
}
function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

const fns = stdModule.functions ?? [];
const insts = (stdModule.instances ?? []) as Instance[];
const byId = new Map(fns.map((f) => [f.id, f]));
function methodOf(typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

const FIXTURE = oracle as {
  fns: Record<string, {
    codeName: string; label?: string; description?: string; tags?: string[];
    category?: string; ioAction?: string; params: unknown; returns: unknown; hasBody: boolean;
  }>;
};
const ALL_IDS = Object.keys(FIXTURE.fns);

describe("std migration — the ported roster + identity", () => {
  test("the module header is authoritative (module name = `std`)", () => {
    expect(stdModule.name).toBe("std");
  });

  // Roster count: 215 (FM-retire-11 pin: 208 9c + countryFlag/regionalIndicator
  // + the 5 string-ordering enablers) grew to 302 across the numeric-tower
  // (Phases 1–5 Nat/Int/Rational/Real arith + bridges + compare wrappers +
  // number-tower), Enumerable (solver-extension P1), the List/String Reprable
  // bridges (representation-substrate P3), and ord (set-algebra 3b-3) — all
  // landed WITHOUT an oracle re-pin (the regen script itself had rotted on the
  // retired `className` field, so it silently dropped facets). Re-pinned
  // 2026-07-10 (effect-visibility Phase 3) alongside the 17 HOF hasBody flips
  // + the 5 new HOF recursion helpers (findIndexAt / groupByAcc / sortDecorate
  // / sortMergePairs / sortPairs) = 307. Re-pinned 2026-07-27
  // (signature-substrate slice 3c-D2) at 310: `minimum` / `maximum` moved from
  // bodyless `@native` decls to Fenel-BODIED members in list/extremum.fenel
  // (same ids, so no roster delta of their own) and brought THREE new helpers
  // with them — `minimumScan` / `maximumScan` (the running folds) and
  // `orderablePair` (the same-scalar-kind guard that keeps the honest
  // `Nothing` fence from being a guess).
  // 313 since 2026-09-23: `isUuid` and its two parts (`isUuidDigits`,
  // `isUuidVersion`), the UUID syntax a runtime body can call (auth:switchAccount;
  // the engine's own is not in the execute profile).
  // Bytes registration adds the approved isBytes host-representation fact.
  // 317 after the roster-scale sort repair adds bounded merge-head, merge-step
  // and undecoration helpers; the public sort signature remains unchanged.
  // 322 since 2026-11-06 (typed grouping): exactValueEqual (the A4 equality
  // bridge), groupFold (the shared grouping traversal), groupByRecordInsert
  // (legacy groupBy's insert step), groupByKeyInsert and groupByKey.
  // 325 with the aggregations per key: mapValues, countByKey and sumByKey.
  // 593 re-pinned 2026-11-12 from scripts/gen-std-oracle.ts: rows added since
  // October without a re-pin (exact numerics, document import/export, spectra,
  // image sources, structural membership, grouping steps, palette images), and
  // std:stringReverse removed (std.reverse is list-parametric since 2026-10-12).
  test("the fixture covers the full 593-fn roster", () => {
    expect(ALL_IDS.length).toBe(593);
  });

  test("every fixture id is published by stdModule (unique)", () => {
    for (const id of ALL_IDS) expect(byId.has(id)).toBe(true);
    expect(new Set(fns.map((f) => f.id)).size).toBe(fns.length);
    expect(fns.length).toBe(593);
  });

  // resolution-substrate Phase 1b Commit 4 renamed std:now's codeName to
  // `nowDate` (bare-`now` ambiguity), so codeName === id-suffix no longer holds
  // universally — the oracle carries the authoritative codeName per fn.
  test("codeName matches the oracle for every fn (sole @codeName divergence: std:now → nowDate)", () => {
    for (const id of ALL_IDS) {
      expect(methodOf("Codeable", id)).toEqual({ codeName: FIXTURE.fns[id]!.codeName });
    }
    const diverging = ALL_IDS.filter((id) => FIXTURE.fns[id]!.codeName !== id.slice("std:".length));
    expect(diverging).toEqual(["std:now"]);
  });

  test("FM-retire-11: `.`/`$` are now `.fenel`-bodied (std.ts `defineFunction` floor 0 — 0 TS residual specs)", () => {
    // `.`/`$` ported to operators.fenel via the L1 loader pass (FM-retire-11);
    // they are present by id with a Fenel body, no longer TS `defineFunction`
    // specs. Together with the 4 FM-retire-10 type-returners (recordType bodied;
    // typeOf/vecOfLength/lengthBoundedStringOf @native), std.ts holds zero
    // `defineFunction` specs — every std fn is `.fenel`-authored.
    for (const id of ["std:.", "std:$", "std:recordType", "std:typeOf", "std:vecOfLength", "std:lengthBoundedStringOf"]) {
      expect(byId.has(id)).toBe(true);
    }
    // `.`/`$` carry a Fenel body (the L1 pass rewrote their bare-string heads).
    for (const id of ["std:.", "std:$"]) expect(byId.get(id)?.body).toBeDefined();
  });
});

describe("std migration — param / return parity (byte-identical under norm)", () => {
  test("params match the oracle for every fn", () => {
    for (const id of ALL_IDS) {
      expect(norm(byId.get(id)?.params)).toEqual(norm(FIXTURE.fns[id]!.params) as never);
    }
  });
  test("returns match the oracle for every fn", () => {
    for (const id of ALL_IDS) {
      expect(norm(byId.get(id)?.returns)).toEqual(norm(FIXTURE.fns[id]!.returns) as never);
    }
  });
});

describe("std migration — facet parity (Labelable / Describable / Taggable / Categorizable)", () => {
  test("Labelable + Describable + Taggable byte-identical for every fn", () => {
    for (const id of ALL_IDS) {
      const f = FIXTURE.fns[id]!;
      if (f.label !== undefined) expect(methodOf("Labelable", id)).toEqual({ label: f.label });
      if (f.description !== undefined) expect(methodOf("Describable", id)).toEqual({ description: f.description });
      if (f.tags !== undefined) expect(methodOf("Taggable", id)).toEqual({ tags: f.tags });
    }
  });

  // @category OMITTED on every PORTED fn (Phase-3j read-time derives "std" from
  // the id prefix). After FM-retire-11 the ONLY stored Categorizable survivors are
  // the 2 combinators `.`/`$` — now `.fenel`-bodied (operators.fenel) but authored
  // with an explicit `@category "function"` facet, a faithful carry of their
  // retired TS specs; the 4 FM-retire-10 type-returners shed their category when
  // they moved to `.fenel` (recordType.fenel / native/type-native.fenel).
  // Later internal helpers carry an authored internal category instead
  // ("document-internal" for the document formats and imports,
  // "engine-internal" for the numeric, representation and type-marker
  // helpers); no public std fn stores one.
  test("Categorizable only on `.`/`$` (authored @category, now `.fenel`-bodied) and on internal helpers; dropped on every other ported fn", () => {
    for (const id of ALL_IDS) {
      const cat = FIXTURE.fns[id]!.category;
      if (cat !== undefined) {
        expect(methodOf("Categorizable", id)).toEqual({ category: cat });
      } else {
        expect(methodOf("Categorizable", id)).toBeUndefined();
      }
    }
    const INTERNAL = new Set(["document-internal", "engine-internal"]);
    const withCat = ALL_IDS.filter((id) => FIXTURE.fns[id]!.category !== undefined && !INTERNAL.has(FIXTURE.fns[id]!.category!));
    expect(withCat.sort()).toEqual(["std:$", "std:."].sort());
  });
});

describe("std migration — bodies (9a/9c Fenel-bodied vs 9b bodyless @native)", () => {
  test("hasBody matches the oracle for every fn", () => {
    for (const id of ALL_IDS) expect(byId.get(id)?.body !== undefined).toBe(FIXTURE.fns[id]!.hasBody);
  });
});

describe("std migration — every id + codeName resolves through createRegistry", () => {
  const reg = createRegistry([stdModule]);
  test("by id AND by codeName", () => {
    for (const id of ALL_IDS) {
      // Resolve by the AUTHORITATIVE codeName (the oracle's), not the id
      // suffix — std:now's codeName is `nowDate` (resolution-substrate 1b C4).
      expect(reg.getFunction(id)?.id).toBe(id);
      expect(reg.getFunctionByCodeName(FIXTURE.fns[id]!.codeName)?.id).toBe(id);
    }
  });
});

// ===========================================================================
// FM-retire-11 (L1) — all 3 combinators (`.`/`$`/bindResult) are `.fenel`-bodied
// in operators.fenel → std.ts `defineFunction` floor 0.
//
// 9c ported `bindResult` (unsampled → matrix-neutral); `.`/`$` stayed TS at
// floor 2 because a naïve port regressed their JS+Wasm self-host (the parser
// strips `{var}` off a lowercase head, and the self-host chokepoint
// `normalise-to-core:resolveCallee` lowers a bare-string head as a GLOBAL
// `$fenel.f`). FM-retire-11's L1 loader pass (`resolveLocalCallHeads`,
// fenel-module.ts) rewrites a local-applying bare-string head back to `{var}`
// BEFORE registration, so the bodies carry `{var}` heads, the compiled core IR
// is byte-identical to the retired TS bodies (`{var}`→`$dyn:`), and `.`/`$`
// self-host on JS+Wasm exactly as before. The L1 pass also retired the 9c
// `callOp` interpreter band-aid — the head now arrives `{var}` from the loader.
// ===========================================================================

describe("std FM-retire-11 — `.`/`$`/bindResult all `.fenel`-bodied (floor 0)", () => {
  test("all 3 combinators are Fenel-bodied at preserved ids", () => {
    for (const id of ["std:.", "std:$", "std:bindResult"]) {
      expect(byId.get(id)?.body).toBeDefined();
    }
  });

  test("bindResult returns a Result variant (Err | Ok), arity 2", () => {
    const br = byId.get("std:bindResult");
    expect(br?.params?.map((p) => p.name)).toEqual(["r", "f"]);
    const cases = (br?.returns as { $variant?: { cases?: Array<{ name: string }> } }).$variant?.cases?.map((c) => c.name);
    expect(cases).toEqual(["Err", "Ok"]);
  });

  test("`.` (now `.fenel`-bodied) keeps params [f, g] (arity 2) and a faithful arrow return (a -> c)", () => {
    const dot = byId.get("std:.");
    expect(dot?.params?.map((p) => p.name)).toEqual(["f", "g"]);
    expect((dot?.returns as { $arrow?: unknown }).$arrow).toBeDefined();
    // contrast: compose (9b @native) flattened to the opaque var `r`.
    // Inspect the live shape directly: the legacy oracle normalizer deliberately
    // folds `$var` and `$ref`, so it cannot prove this provenance distinction.
    expect(byId.get("std:compose")?.returns).toEqual({ $var: "r" } as never);
  });

  test("`.`/`$` bodies carry `{var}` application heads (the L1 loader pass rewrote them)", () => {
    // `($) f x = f x` → `{call:[{var:"f"}, {var:"x"}]}` — head `f` rewritten.
    const dollar = byId.get("std:$");
    const dHead = (dollar?.body as { call?: unknown[] }).call?.[0];
    expect(dHead).toEqual({ var: "f" } as never);
    // `(.) f g = \x -> f (g x)` → lambda body's outer call head is `{var:"f"}`.
    const dot = byId.get("std:.");
    const lam = (dot?.body as { fn?: unknown[] }).fn;
    const lamBody = (lam as unknown[])?.[(lam as unknown[]).length - 1] as { call?: unknown[] };
    expect(lamBody.call?.[0]).toEqual({ var: "f" } as never);
  });

  test("all three dispatch end-to-end (heads resolve via the normal `{var}` path post-L1)", () => {
    const reg = createRegistry([stdModule]);
    const ctx = reg.evaluateContext();
    // (addOne . double) 5 = add 1 (mul 2 5) = 11
    expect(evaluate({ call: [{ call: [".", { call: ["add", 1] }, { call: ["mul", 2] }] }, 5] }, {}, ctx)).toBe(11);
    // abs $ -5 = abs (-5) = 5. Use the canonical id here: a bare `$` head is
    // evaluator syntax, whereas this regression must execute the authored
    // `std:$` function and then its loader-rewritten `{var:"f"}` inner head.
    expect(evaluate({ call: ["std:$", "abs", -5] }, {}, ctx)).toBe(5);
    // bindResult (Ok 3) (\x -> Ok (x+1)) = Ok 4 — the .fenel body's `f _x` head
    // arrives `{var:"f"}` from the L1 loader pass and resolves through resolveVar
    expect(evaluate({ call: ["bindResult", { construct: ["Ok", 3] }, { fn: ["x", { construct: ["Ok", { call: ["add", { var: "x" }, 1] }] }] }] }, {}, ctx)).toEqual({ $tag: "Ok", _0: 4 } as never);
    // bindResult (Err e) f short-circuits unchanged
    expect(evaluate({ call: ["bindResult", { construct: ["Err", "boom"] }, { fn: ["x", { construct: ["Ok", { var: "x" }] }] }] }, {}, ctx)).toEqual({ $tag: "Err", _0: "boom" } as never);
  }, 60_000);
});

// ===========================================================================
// §5 — operator fixity is INDEPENDENT of the port (parser-fixities.fenel,
// untouched). Proves the parser still lowers operators to their canonical call
// form, including `.` / `$` (whose fixity rides parser-fixities.fenel regardless
// of where their bodies live).
// ===========================================================================

describe("std §5 — operator fixity (parser-fixities.fenel; untouched by the port)", () => {
  test("binary infix + unary prefix lower to canonical call form", () => {
    expect(parse("1 + 2")).toEqual({ call: ["add", 1, 2] });
    expect(parse("3 * 4")).toEqual({ call: ["mul", 3, 4] });
    expect(parse("a == b")).toEqual({ call: ["eq", { var: "a" }, { var: "b" }] });
    expect(parse("not x")).toEqual({ call: ["not", { var: "x" }] });
    expect(parse("0 - y")).toEqual({ call: ["sub", 0, { var: "y" }] });
  });
  test("`.` / `$` keep their fixity", () => {
    expect(parse("f . g")).toEqual({ call: [".", { var: "f" }, { var: "g" }] });
    expect(parse("f $ x")).toEqual({ call: ["$", { var: "f" }, { var: "x" }] });
  });
});

// ===========================================================================
// §6 — the class-C non-shadow: each of the 15 C ids resolves to ONE fn (a body
// for min/max/and/or, a bodyless @native decl for the 11 op-form) AND its
// registered native, in distinct keyspaces (fn.body vs nativeImpls[id]) — no
// duplicate spec at the id.
// ===========================================================================

describe("std §6 — class-C body/native coexistence (no double-registration)", () => {
  const BODIED_C = ["min", "max", "and", "or"];
  const NATIVE_C = ["add", "sub", "mul", "div", "mod", "eq", "neq", "gt", "gte", "lt", "lte"];
  const native = (stdModule.nativeImpls ?? {}) as Record<string, unknown>;

  test("each of the 15 C ids has exactly ONE published spec", () => {
    for (const c of [...BODIED_C, ...NATIVE_C]) {
      expect(fns.filter((f) => f.id === `std:${c}`).length).toBe(1);
    }
  });

  test("min/max/and/or are BODIED + keep their perf native (coexistence)", () => {
    for (const c of BODIED_C) {
      expect(byId.get(`std:${c}`)?.body).toBeDefined();
      expect(typeof native[`std:${c}`]).toBe("function");
    }
  });

  test("the 11 op-form are bodyless @native + resolve via their native", () => {
    for (const c of NATIVE_C) {
      expect(byId.get(`std:${c}`)?.body).toBeUndefined();
      expect(typeof native[`std:${c}`]).toBe("function");
    }
  });
});

// ===========================================================================
// §6b — R0 (2026-08-28): the coexistence must SURVIVE rights Landing 1's
// native/IO collision gate.
//
// Landing 1 made a native/IO descriptor collision a hard throw. The runtime's
// `registerFenelBodyDispatchers` auto-pass registered an IO handler at `fn.id`
// for every BODIED fn, guarded only by the IO table — so on the four class-C
// ids above (bodied AND natively implemented) it walked straight into that
// throw and `loadRegistry` died, 500ing `POST /api/auth/login`.
//
// The repair yields the AUTOMATIC pass only. These pin both halves: the native
// stays the exercise path with no auto-registered IO handler beside it, and a
// DELIBERATE IO registration at a native id still throws loudly.
// ===========================================================================

describe("std §6b — class-C coexistence under the Landing-1 collision gate", () => {
  const BODIED_C = ["min", "max", "and", "or"];
  // One build for the three tests (the §3 describe above uses the same shape) —
  // a `createRegistry([stdModule])` is ~20s, well past the default test timeout.
  const reg = createRegistry([stdModule]);

  test("each class-C id is a NATIVE descriptor with no IO handler beside it", () => {
    for (const c of BODIED_C) {
      expect(reg.hasNativeDescriptor(`std:${c}`)).toBe(true);
      expect(reg.getIOHandler(`std:${c}`)).toBeUndefined();
    }
  });

  test("a DELIBERATE IO registration at a native id still throws (not a silent no-op)", () => {
    for (const c of BODIED_C) {
      expect(() => reg.registerIOHandler(`std:${c}`, (async () => null) as never))
        .toThrow(`perform: native/IO descriptor collision at "std:${c}"`);
    }
  });

  test("the native — not the body — is what executes for the class-C ids", () => {
    const ctx = reg.evaluateContext();
    // Ordinary values agree between the two implementations, so they pin the
    // RESULT but not the PATH.
    expect(evaluate({ call: ["std:min", 3, 7] }, {}, ctx)).toBe(3);
    expect(evaluate({ call: ["std:max", 3, 7] }, {}, ctx)).toBe(7);
    expect(evaluate({ call: ["std:and", true, false] }, {}, ctx)).toBe(false);
    expect(evaluate({ call: ["std:or", true, false] }, {}, ctx)).toBe(true);
    // R0 review round 1, finding 4 — the DISCRIMINATORS, one per id. A body-first
    // dispatch regression that silently loses the sanctioned perf native turns
    // each of these red; the value assertions above would stay green.
    //
    // min/max: `min.fenel` documents the divergence — `Math.min(NaN, x)` is NaN,
    // while the body `if lt a b then a else b` returns `x`, because `lt NaN x` is
    // false in JS comparison semantics and the else-branch yields `b`.
    expect(evaluate({ call: ["std:min", NaN, 7] }, {}, ctx)).toBeNaN();
    expect(evaluate({ call: ["std:max", NaN, 7] }, {}, ctx)).toBeNaN();
    // and/or (review round 2, finding 6): the natives COERCE
    // (`Boolean(a) && Boolean(b)`) while the bodies RETURN THE OPERAND
    // (`and a b = if a then b else False`, `or a b = if a then True else b`).
    // So on a non-Boolean operand the native gives `true`/`false` and the body
    // gives `1`/`0`. `toBe` is strict, so the body result cannot pass.
    expect(evaluate({ call: ["std:and", true, 1] }, {}, ctx)).toBe(true);
    expect(evaluate({ call: ["std:or", false, 0] }, {}, ctx)).toBe(false);
  });

  // R0 review round 2, finding 5 — DECLARED DEVIATION from the brief.
  //
  // §0.5 of the P1(a.12) brief asks this suite to pin that `perform("std:min")`
  // executes the native. That is not achievable and should not be made so: a
  // requires-free native is deliberately DIRECT-ONLY — it lives in the registry's
  // direct map, never in the private perform table, which holds act descriptors
  // (natives whose declaration `@requires` a registered dispatch class). Routing
  // a pure computation through `perform` would be a new architecture, not a pin.
  // `rights-perform-gate.test.ts` already pins that split from the other side.
  // The tests above therefore pin the same PROPERTY — "the native, not the body,
  // is what executes" — through `evaluate`, which is the real selection path.
  test("std:min is a DIRECT native, not a perform-table act (why the brief's pin is not taken literally)", () => {
    const ctx = reg.evaluateContext();
    expect(reg.hasNativeDescriptor("std:min")).toBe(true);
    // Not exposed as an IO/perform descriptor: the compatibility face is empty.
    expect(reg.getIOHandler("std:min")).toBeUndefined();
    // It carries no dispatch-class requirement, which is what would have
    // promoted it into the perform table — asked of the EFFECTIVE declaration,
    // which is what the perform classification itself reads.
    expect(reg.getFunction("std:min")?.requires ?? []).toEqual([]);
    // … so it is absent from the act tables …
    expect(ctx._nativePerformDescriptors?.plain["std:min"]).toBeUndefined();
    expect(ctx._nativePerformDescriptors?.context["std:min"]).toBeUndefined();
    // … and the direct assertion the review asked for: `perform` REFUSES it.
    // (Review round 3, finding 5: the earlier assertions all stay green if a
    // future change quietly promotes `std:min` into the perform table.)
    expect(() => perform(ctx, { descriptor: "std:min", args: [3, 7] }))
      .toThrow(/no implementation/i);
    // The native itself is very much live — through `evaluate`, the real path.
    expect(evaluate({ call: ["std:min", NaN, 7] }, {}, ctx)).toBeNaN();
  });
});
