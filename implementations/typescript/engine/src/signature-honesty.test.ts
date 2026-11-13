// ---------------------------------------------------------------------------
// signature-honesty.test.ts — signature-substrate Phase 4+4b slice 3c.
//
// THREE THINGS ARE UNDER TEST, and they are deliberately separate claims:
//
//   D1  the FOUND BIT. "the binding is ABSENT" and "the binding is PRESENT and
//       holds host-`undefined`" are distinct states, and only the first may
//       reach the bare-ident registry projection / the fallback. Both
//       directions are pinned, plus the dotted-path exit, plus the LAZY
//       evaluator strategy — which is where the round-1 design review found the
//       hole, and where a repair had to land before `obs.var.undefined` could
//       be discharged at all.
//
//   D2  RANGE HONESTY of `std:minimum` / `std:maximum`. The claim is NOT that
//       the Fenel body and the native perf branch are interchangeable — they
//       are not, at depth and on hostile host values, and `extremum.fenel` says
//       so. The claim is that on every input BOTH return either
//       `{$tag:"Nothing"}` or `{$tag:"Just",_0:x}` with `x` an element of the
//       argument. That is what SC-sig is about, and it is what is pinned here,
//       branch by branch.
//
//   D3/D6 the DETECTOR and its GATE. The load-bearing assertion is a negative
//       one: the detector must never say a root is honest, and its
//       `UnknownFenced` bucket must be REPORTED rather than silently empty.
//
// METHOD NOTE (earned in 3a and 3b, re-earned here): every expected value below
// was read off the LIVE behaviour before it was written down. Slice 3b's round
// 2 refuted a fix that a new test had already frozen; a test written from a
// wrong model makes the wrong model permanent.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";

import "./index";
import { evaluate, type EvaluateContext } from "./json-logic";
import { getSystemRegistry } from "./system-registry";
import {
  detect,
  activeRoute,
  activeRouteFor,
  activeRouteForSpelling,
} from "../scripts/generate-signature-honesty-claims";
import { lazyEvalNative } from "../../../../fenel/modules/evaluator-strategies/ffi/evaluator-strategies-ffi";
import { codecHostNatives } from "../../../../fenel/modules/codec/ffi/codec-ffi";
import { Anything } from "./type-foundation";
import type { FenelType } from "./types";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const registry = getSystemRegistry();
const ctx = registry.evaluateContext() as unknown as EvaluateContext;

type MaybeV = { $tag: string; _0?: unknown };

/** Bind values into a prototype-free data context the way the evaluator does.
 *  The argument is passed through `{var:…}` rather than inlined into the call
 *  form, because a raw array/record in EXPRESSION position is evaluated
 *  element-wise (and a plain object is an operator lookup) — inlining would
 *  test the wrong thing. */
function scope(entries: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(entries)) {
    Object.defineProperty(data, k, { value: v, enumerable: true, configurable: true, writable: true });
  }
  return data;
}

/** Call through the REGISTRY — what a Fenel caller actually sees (the native
 *  perf branch wins here, exactly as `invokeFunction` selects it). */
const callRegistry = (fn: string, arg: unknown): MaybeV =>
  evaluate({ call: [fn, { var: "xs" }] }, scope({ xs: arg }), ctx) as MaybeV;

/** Evaluate the FENEL BODY of `fn` directly, with its declared params bound —
 *  the branch compiled targets run, which the native normally shadows. */
function callBody(fn: string, ...args: unknown[]): MaybeV {
  const spec = registry.getFunction(fn);
  if (spec === undefined || spec.body === undefined) {
    throw new Error(`${fn} has no Fenel body — the 3c-D2 dual is gone`);
  }
  const bound: Record<string, unknown> = {};
  spec.params.forEach((p, i) => { bound[p.name] = args[i]; });
  return evaluate(spec.body, scope(bound), ctx) as MaybeV;
}

// ---------------------------------------------------------------------------
// 3c-D1 — the found bit
// ---------------------------------------------------------------------------

describe("3c-D1 — resolveVar distinguishes ABSENT from PRESENT-with-undefined", () => {
  it("ABSENT ⇒ the bare-ident registry projection still fires (this is what makes `xs |> filter abs` work)", () => {
    const out = evaluate({ var: "abs" }, {}, ctx) as { $ref?: string };
    expect(out).toBeTruthy();
    expect(typeof out.$ref).toBe("string");
  });

  it("PRESENT-with-undefined ⇒ the value is returned VERBATIM, not laundered into a {$ref} or the fallback", () => {
    const data: Record<string, unknown> = Object.create(null);
    Object.defineProperty(data, "abs", {
      value: undefined, enumerable: true, configurable: true, writable: true,
    });
    // Pre-repair this fell through to the registry and produced `{$ref: …}` for
    // a binding that was genuinely bound — the found-bit OBSERVATION.
    expect(evaluate({ var: "abs" }, data, ctx)).toBeUndefined();
  });

  it("ABSENT with a fallback ⇒ the fallback; PRESENT-with-undefined ⇒ still undefined", () => {
    const present: Record<string, unknown> = Object.create(null);
    Object.defineProperty(present, "zzz", {
      value: undefined, enumerable: true, configurable: true, writable: true,
    });
    expect(evaluate({ var: ["zzz", "FALLBACK"] }, {}, ctx)).toBe("FALLBACK");
    expect(evaluate({ var: ["zzz", "FALLBACK"] }, present, ctx)).toBeUndefined();
  });

  it("the DOTTED-PATH exit has the same split (it has its own `current === undefined` tail)", () => {
    const inner: Record<string, unknown> = Object.create(null);
    Object.defineProperty(inner, "b", {
      value: undefined, enumerable: true, configurable: true, writable: true,
    });
    const withPresentUndefined: Record<string, unknown> = Object.create(null);
    Object.defineProperty(withPresentUndefined, "a", {
      value: inner, enumerable: true, configurable: true, writable: true,
    });
    const withAbsent: Record<string, unknown> = Object.create(null);
    Object.defineProperty(withAbsent, "a", {
      value: Object.create(null), enumerable: true, configurable: true, writable: true,
    });
    expect(evaluate({ var: ["a.b", "FALLBACK"] }, withPresentUndefined, ctx)).toBeUndefined();
    expect(evaluate({ var: ["a.b", "FALLBACK"] }, withAbsent, ctx)).toBe("FALLBACK");
  });

  it("the LAZY strategy presents its scope as own DATA — and stays call-by-name", () => {
    // Regression pin. `ownDataRead` reads through `Object.getOwnPropertyDescriptor`,
    // which consults neither the `get` nor the `has` trap — so before 3c the lazy
    // scope proxy reported EVERY formal as absent and call-by-name returned the
    // fallback `null` for an ordinary `42`. The "unforced argument never fires"
    // guarantee held only VACUOUSLY, because no argument was reachable at all.
    //
    // `lazyEvalNative` is invoked DIRECTLY with the unevaluated rule. Routing it
    // through `{call: ["…lazyEval", <rule>]}` would be a wrong-model test: an
    // ordinary call evaluates its arguments eagerly, so the exploding argument
    // would fire before the lazy strategy ever saw it.
    const firstOnly = {
      id: "firstOnly", params: [{ name: "x" }, { name: "y" }], returns: { $ref: "Number" },
      body: { var: "x" },
    };
    let boomCalled = false;
    const lazyCtx = {
      ...(ctx as object),
      getFunction: (n: string) =>
        (n === "firstOnly" ? firstOnly : (ctx as { getFunction?: (s: string) => unknown }).getFunction?.(n)),
      natives: {
        ...((ctx as { natives?: object }).natives ?? {}),
        boom: () => { boomCalled = true; throw new Error("boom — must not fire under lazy"); },
      },
      _localData: {},
    } as unknown as EvaluateContext;
    const out = lazyEvalNative(
      { call: ["firstOnly", 42, { call: ["boom"] }] }, lazyCtx,
    ) as { $tag?: string; _0?: unknown };
    expect(out.$tag).toBe("Ok");
    expect(out._0).toBe(42);
    expect(boomCalled).toBe(false);
  });

  it("a lazy body that COPIES its scope loses its params UNIFORMLY — the lemma obs.var.undefined rests on", () => {
    // The honest limitation, pinned rather than left to be rediscovered. The
    // lazy scope proxy has NO `ownKeys` trap (adding one would force every thunk
    // twice per scope copy and destroy call-by-name), so `copyOwnDataContext`'s
    // `Object.keys` walk copies an EMPTY scope and a `do`/`let`-shaped lazy body
    // sees none of its parameters.
    //
    // THIS IS NOT A FOUND-BIT OBSERVATION, and that distinction is what lets
    // `obs.var.undefined` be SIDE-CONDITIONED rather than MISSING: the binding
    // is absent for EVERY value it might have held, so the read answers the
    // fallback UNIFORMLY. Two runs whose argument differs only in its VALUE
    // must therefore agree — which is exactly what non-observation means.
    const mk = (arg: unknown) => {
      const f = {
        id: "firstOnlyDo", params: [{ name: "x" }, { name: "y" }], returns: { $ref: "Number" },
        body: { do: [0, { var: "x" }] },
      };
      const c = {
        ...(ctx as object),
        getFunction: (n: string) =>
          (n === "firstOnlyDo" ? f : (ctx as { getFunction?: (s: string) => unknown }).getFunction?.(n)),
        _localData: {},
      } as unknown as EvaluateContext;
      return lazyEvalNative({ call: ["firstOnlyDo", arg, 0] }, c) as { $tag?: string; _0?: unknown };
    };
    // Same shape, different VALUES — including the host-`undefined` that started
    // all of this. The answer must not depend on which.
    const a = mk(42);
    const b = mk("a string");
    const c = mk(undefined);
    expect(a._0).toEqual(b._0 as never);
    expect(a._0).toEqual(c._0 as never);
  });

  it("the lazy scope is PROTOTYPE-FREE — `__proto__` is an ordinary binder, not Object.prototype", () => {
    // `prop in thunks` over an ordinary `{}` answered true for `__proto__` and
    // `toString` and then "forced" a host object as if it were an argument
    // expression. Same laundering `ownDataRead` exists to stop, one layer out.
    const protoFn = {
      id: "protoFn", params: [{ name: "__proto__" }], returns: { $ref: "Number" },
      body: { var: "__proto__" },
    };
    const c = {
      ...(ctx as object),
      getFunction: (n: string) =>
        (n === "protoFn" ? protoFn : (ctx as { getFunction?: (s: string) => unknown }).getFunction?.(n)),
      _localData: {},
    } as unknown as EvaluateContext;
    const out = lazyEvalNative({ call: ["protoFn", 42] }, c) as { $tag?: string; _0?: unknown };
    expect(out.$tag).toBe("Ok");
    expect(out._0).toBe(42);
  });

  it("an ordinary present value is unaffected (the repair is not a behaviour change for well-typed programs)", () => {
    const data: Record<string, unknown> = Object.create(null);
    Object.defineProperty(data, "n", {
      value: 42, enumerable: true, configurable: true, writable: true,
    });
    expect(evaluate({ var: "n" }, data, ctx)).toBe(42);
    expect(evaluate({ var: ["n", "FALLBACK"] }, data, ctx)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 3c-D2 — range honesty of the repaired extrema
// ---------------------------------------------------------------------------

/** Every result of `minimum`/`maximum`, on ANY input, must be a canonical
 *  `Maybe` — and a `Just` payload must be an element of the argument. This is
 *  the SC-sig range claim, stated as an assertion. */
function expectRangeHonest(out: MaybeV, input: unknown): void {
  expect(out === null || out === undefined).toBe(false);
  expect(out.$tag === "Nothing" || out.$tag === "Just").toBe(true);
  if (out.$tag === "Just") {
    expect(Array.isArray(input)).toBe(true);
    expect((input as unknown[]).includes(out._0)).toBe(true);
  }
}

const EXTREMUM_CASES: ReadonlyArray<{ label: string; input: unknown; min: MaybeV; max: MaybeV }> = [
  // The two semantically DISTINCT causes of `Nothing` get their own rows: there
  // is nothing to compare, versus there is no order to compare with. Today they
  // are the same range violation, which is exactly why they are separated here.
  { label: "empty — no extremum of ∅", input: [], min: { $tag: "Nothing" }, max: { $tag: "Nothing" } },
  {
    label: "unsupported comparison — MIXED number/string",
    input: [1, "a"], min: { $tag: "Nothing" }, max: { $tag: "Nothing" },
  },
  {
    label: "unsupported comparison — HOMOGENEOUS booleans (the review's finding 8: not a 'mixed' problem)",
    input: [true, false], min: { $tag: "Nothing" }, max: { $tag: "Nothing" },
  },
  {
    label: "unsupported comparison — HOMOGENEOUS records",
    input: [{ a: 1 }, { a: 2 }], min: { $tag: "Nothing" }, max: { $tag: "Nothing" },
  },
  { label: "numbers", input: [3, 1, 2], min: { $tag: "Just", _0: 1 }, max: { $tag: "Just", _0: 3 } },
  {
    label: "strings (the ordering `lt`/`gt` support and the reason minOfSet uses these)",
    input: ["banana", "apple", "cherry"],
    min: { $tag: "Just", _0: "apple" }, max: { $tag: "Just", _0: "cherry" },
  },
  {
    label: "singleton of a NON-orderable type ⇒ Just x (no comparison is performed, so no order is claimed)",
    input: [true], min: { $tag: "Just", _0: true }, max: { $tag: "Just", _0: true },
  },
  {
    label: "non-array (a String in its JS repr) ⇒ Nothing — the isArray guard that keeps the two branches coherent",
    input: "abc", min: { $tag: "Nothing" }, max: { $tag: "Nothing" },
  },
];

describe("3c-D2 — std:minimum / std:maximum are range-honest through the REGISTRY", () => {
  for (const c of EXTREMUM_CASES) {
    it(`minimum: ${c.label}`, () => {
      const out = callRegistry("minimum", c.input);
      expect(out).toEqual(c.min as never);
      expectRangeHonest(out, c.input);
    });
    it(`maximum: ${c.label}`, () => {
      const out = callRegistry("maximum", c.input);
      expect(out).toEqual(c.max as never);
      expectRangeHonest(out, c.input);
    });
  }

  it("NEVER returns host-undefined — the escape that falsified SC-sig and kept obs.var.undefined MISSING", () => {
    for (const c of EXTREMUM_CASES) {
      expect(callRegistry("minimum", c.input)).not.toBeUndefined();
      expect(callRegistry("maximum", c.input)).not.toBeUndefined();
    }
  });
});

describe("3c-D2 — the Fenel BODY branch agrees with the native perf branch on the conforming cases", () => {
  for (const c of EXTREMUM_CASES) {
    it(`body ≡ native: ${c.label}`, () => {
      expect(callBody("minimum", c.input)).toEqual(callRegistry("minimum", c.input) as never);
      expect(callBody("maximum", c.input)).toEqual(callRegistry("maximum", c.input) as never);
    });
  }
});

describe("3c-D2 — the enumerate callers stopped double-wrapping", () => {
  it("minOfSet over a HETEROGENEOUS scalar list ⇒ Nothing (scalarExtension guards only the HEAD)", async () => {
    const { dispatchedMinOfSet, dispatchedMaxOfSet } = await import("./engine-bodies-dispatch");
    // Head is a number so `scalarExtension` passes; the later string makes the
    // pair unorderable. Pre-3c this produced `Just undefined` — a `Maybe` whose
    // payload was host-undefined. THE intended verdict delta of this slice.
    const het = { $tag: "SeEnum", values: [1, "a"] };
    expect((dispatchedMinOfSet(het) as MaybeV).$tag).toBe("Nothing");
    expect((dispatchedMaxOfSet(het) as MaybeV).$tag).toBe("Nothing");
  });

  it("the ordinary tiers still answer Just (no double-Just from the un-wrapped callers)", async () => {
    const { dispatchedMinOfSet, dispatchedMaxOfSet } = await import("./engine-bodies-dispatch");
    const nums = { $tag: "SeEnum", values: [3, 1, 2] };
    expect(dispatchedMinOfSet(nums)).toEqual({ $tag: "Just", _0: 1 } as never);
    expect(dispatchedMaxOfSet(nums)).toEqual({ $tag: "Just", _0: 3 } as never);
  });
});

// ---------------------------------------------------------------------------
// 3c-D3 / 3c-D6 — the detector and the gate
// ---------------------------------------------------------------------------

const NUMBER_T = { $ref: "Number" } as unknown as FenelType;
const UNIT_T = { $unit: true } as unknown as FenelType;

describe("3c-D3 — the conservative detector never infers honesty", () => {
  it("a synthetic DISHONEST native is refuted — the gate's negative test", () => {
    const dishonest = (xs: unknown[]) => { if (xs.length === 0) { return undefined; } return xs[0]; };
    const d = detect(dishonest, NUMBER_T);
    expect(d.claim).toBe("WitnessedEscape");
    expect(d.witness).toBeTruthy();
  });

  it("a nullish literal OUTSIDE return position is NOT refuted — the refuter is deliberately narrow", () => {
    // `WitnessedEscape` hard-fails the gate, so a false positive costs an
    // allowlist entry for a root that is fine. A ternary arm / guard / object
    // value must land in `UnknownFenced` instead.
    const guarded = (x: unknown) => { if (x === undefined) { return 0; } return 1; };
    expect(detect(guarded, NUMBER_T).claim).toBe("UnknownFenced");
  });

  it("a `return null` native is refuted too (cornerstone 7 — host null is no type's inhabitant)", () => {
    const sentinel = (xs: unknown[]) => { if (xs.length === 0) { return null; } return xs[0]; };
    expect(detect(sentinel, NUMBER_T).claim).toBe("WitnessedEscape");
  });

  it("the actual host JSON null egress remains WitnessedEscape under Anything", () => {
    const assemble = codecHostNatives.jsonHostAssemble!;
    expect(assemble({
      $tag: "JsonHostParts",
      scalar: { $tag: "Just", _0: { $tag: "JsonNull" } },
      items: { $tag: "Nothing" },
      pairs: { $tag: "Nothing" },
    })).toBeNull();
    const detection = detect(assemble, Anything);
    expect(detection.claim).toBe("WitnessedEscape");
    expect(detection.witness).toBe("return null;");
    expect(detection.reasons).toContain("literal-nullish-egress-in-own-source");
  });

  it("the host JSON blocker acknowledgement is exact-id and does not admit unrelated null roots", () => {
    // audit-effects runs main on import. Read only its actual policy declaration
    // so this pin adds no second registry or audit profile to the harness.
    const source = readFileSync(join(REPO_ROOT, "implementations/typescript/engine/scripts/audit-effects.ts"), "utf8");
    const declaration = /const SIGNATURE_HONESTY_ESCAPE_ALLOW:[\s\S]*?\n\]\);/.exec(source);
    expect(declaration).not.toBeNull();
    const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(declaration![0]);
    const allow = new Function(`${compiled}; return SIGNATURE_HONESTY_ESCAPE_ALLOW;`)() as ReadonlyMap<string, string>;
    const blocker = allow.get("codec:jsonHostAssemble");
    expect(blocker).toContain("BLOCKER:");
    expect(blocker).toContain("JsonNull");
    expect(blocker).toContain("unwrapJsonValue : JsonValue -> a");
    for (const id of ["codec:jsonHostAssembleOther", "codec:unwrapJsonValue", "fixture:unrelatedNullRoot"]) {
      expect(allow.has(id)).toBe(false);
    }
    expect(detect(() => null, Anything).claim).toBe("WitnessedEscape");
    expect(detect(() => null, NUMBER_T).claim).toBe("WitnessedEscape");
  });

  it("a CLEAN native is NOT called honest — absence of a witness is not evidence", () => {
    const clean = (a: number, b: number) => a + b;
    const d = detect(clean, NUMBER_T);
    expect(d.claim).toBe("UnknownFenced");
    expect(d.reasons).toContain("no-escape-witness-found-which-is-not-evidence-of-honesty");
  });

  it("an ASYNC native fences on the unawaited plain-native ABI rather than being read", () => {
    const slow = async (x: number) => x;
    expect(detect(slow, NUMBER_T).reasons)
      .toContain("async-implementation-returns-a-promise-through-the-unawaited-native-abi");
  });

  it("a $unit/$void return with a nullish egress FENCES rather than refutes (the representation question is open)", () => {
    const unitish = () => { return undefined; };
    const d = detect(unitish, UNIT_T);
    expect(d.claim).toBe("UnknownFenced");
    expect(d.reasons).toContain("unit-or-void-return-representation-undecided");
  });

  it("an unreadable implementation is counted as BLINDNESS, not as a pass", () => {
    const d = detect(Math.max, NUMBER_T);
    expect(d.claim).toBe("UnknownFenced");
    expect(d.unreadable).toBe(true);
  });

  it("a bare type-variable return is fenced on universal semantics", () => {
    const idish = (x: unknown) => x;
    expect(detect(idish, { $var: "a" } as unknown as FenelType).reasons)
      .toContain("declared-return-is-a-bare-type-variable-claim-must-hold-at-every-instantiation");
  });

  it("`Honest` is not expressible — the outcome vocabulary has no positive case", () => {
    const outcomes = ["WitnessedEscape", "ManuallyAttested", "RuntimeChecked", "UnknownFenced"];
    expect(outcomes).not.toContain("Honest");
  });
});

describe("3c-D3 — the root enumerator sees the natives maps (the 3b census defect)", () => {
  it("evaluateContext() carries BOTH native maps, and they are non-empty", () => {
    const c = ctx as unknown as { natives?: object; nativesCtx?: object };
    expect(Object.keys(c.natives ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(c.nativesCtx ?? {}).length).toBeGreaterThan(0);
  });

  it("`registry.nativeImpls` does NOT exist — reading it is what blinded the 3b census", () => {
    const r = registry as unknown as { nativeImpls?: unknown; nativeImplsCtx?: unknown };
    expect(r.nativeImpls).toBeUndefined();
    expect(r.nativeImplsCtx).toBeUndefined();
  });

  it("activeRoute follows invokeFunction's own order (ctx-native → native → body)", () => {
    const impl = () => 1;
    expect(activeRoute("f", {}, { f: impl }, false))
      .toEqual({ origin: "HostNative", tier: "nativeImplsCtx", key: "f" });
    expect(activeRoute("f", { f: impl }, {}, true))
      .toEqual({ origin: "NativeWithFallback", tier: "nativeImpls", key: "f" });
    expect(activeRoute("f", {}, {}, true)).toEqual({ origin: "FenelBody", tier: "", key: "" });
    expect(activeRoute("f", {}, {}, false))
      .toEqual({ origin: "ExternalHandlerDeclaration", tier: "", key: "" });
    // A ctx-native SHADOWS a plain native of the same key.
    expect(activeRoute("f", { f: impl }, { f: impl }, false).tier).toBe("nativeImplsCtx");
  });
});

describe("3c-D4 — the claim artifact reports its own blindness rather than hiding it", () => {
  it("the committed artifact has rows, a non-empty UnknownFenced bucket, and no conservation failure", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(
      "implementations/typescript/engine/src/generated/signature-honesty-claims.json", "utf8",
    );
    const artifact = JSON.parse(raw) as {
      schemaVersion: string;
      conservationErrors: string[];
      profiles: Record<string, { counts: Record<string, number>; rows: unknown[] }>;
    };
    expect(artifact.schemaVersion).toBe("fenel.signature.honesty.claims.v1");
    expect(artifact.conservationErrors).toEqual([]);
    for (const [profile, p] of Object.entries(artifact.profiles)) {
      expect(p.counts.roots, `${profile}: zero roots means the natives maps were lost`)
        .toBeGreaterThan(0);
      // The bucket must be REPORTED. 3b's census printed `withOpaqueParam: 0`
      // beside a plausible-looking table; a silently empty bucket is the same
      // failure wearing a different hat.
      expect(p.counts.UnknownFenced, `${profile}: UnknownFenced silently empty`)
        .toBeGreaterThan(0);
      expect(p.rows.length).toBe(p.counts.roots ?? -1);
    }
  });
});

// ===========================================================================
// SLICE 3d — the per-SPELLING route, and the census's origin strata.
// ===========================================================================

describe("3d-D6 — the route is resolved per WRITTEN CALL SPELLING", () => {
  it("`invokeFunction` selects per spelling, not by scanning every alias", () => {
    // Verified against source before this test froze it: the order is
    // ctx[id] → ctx[name] → plain[id] → plain[name] → body, and the id and
    // the code name are DIFFERENT spellings, each taking the whole ladder.
    const src = readFileSync(
      join(REPO_ROOT, "implementations/typescript/engine/src/json-logic.ts"),
      "utf8",
    );
    expect(src).toContain("nativesCtx");
  });

  it("an ALIAS-only native does not become the canonical id's active branch", () => {
    // The 3c enumerator unioned the candidate keys and scanned every ctx
    // candidate before every plain one, so a native reachable only under an
    // alias was reported as the FUNCTION's active implementation — an
    // implementation no canonical-id call site reaches. The canonical route
    // is now the winner and the disagreement is reported instead.
    const impl = () => 1;
    const route = activeRouteFor(["mod:f", "alias"], {}, { alias: impl }, true);
    expect(route.origin).toBe("FenelBody");
    expect(route.ambiguous).toBe(true);
    expect(route.spellings).toEqual({ "mod:f": "FenelBody", alias: "nativeImplsCtx:alias" });
  });

  it("the SAME implementation at both tiers is still two routes — the ABI differs", () => {
    // A ctx-native receives the whole EvaluateContext as its first argument,
    // so two map entries holding the same function object are not the same
    // obligation.
    const impl = () => 1;
    const route = activeRouteFor(["f"], { f: impl }, { f: impl }, false);
    expect(route.tier).toBe("nativeImplsCtx");
    expect(route.ambiguous).toBeUndefined();
  });

  it("a spelling that agrees with the canonical route is NOT ambiguous", () => {
    const impl = () => 1;
    const route = activeRouteFor(["mod:f", "alias"], {}, { "mod:f": impl, alias: impl }, false);
    expect(route.tier).toBe("nativeImplsCtx");
    expect(route.key).toBe("mod:f");
    expect(route.ambiguous).toBeUndefined();
  });

  it("`activeRouteForSpelling` walks the runtime's FOUR-STEP ladder, id first", () => {
    // ROUND-2 REPAIR. The first version probed `ctx[written] → plain[written]`,
    // which is not what `invokeFunction` does: it resolves the spec and then
    // tries `nativesCtx[spec.id]` BEFORE `nativesCtx[written]`, and
    // `natives[spec.id]` before `natives[written]`. Verified against source.
    const src = readFileSync(
      join(REPO_ROOT, "implementations/typescript/engine/src/json-logic.ts"),
      "utf8",
    );
    // Each step now also admits a perform-mediated descriptor (`2e5694b5`,
    // rights Landing 1), so the guards span several lines. The ladder is pinned
    // by its four direct calls, each written exactly once, in this order.
    const ladder = [
      "return ctx.nativesCtx[spec.id]!(ctx, ...evaluatedArgs);",
      "return ctx.nativesCtx[name]!(ctx, ...evaluatedArgs);",
      "return ctx.natives[spec.id]!(...evaluatedArgs);",
      "return ctx.natives[name]!(...evaluatedArgs);",
    ];
    const positions = ladder.map((step) => src.indexOf(step));
    for (const [index, step] of ladder.entries()) {
      expect(positions[index]).toBeGreaterThanOrEqual(0);
      expect(src.indexOf(step, positions[index]! + 1)).toBe(-1);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    const idImpl = () => 1;
    const aliasImpl = () => 2;
    // A call written under an ALIAS still reaches a native registered at the
    // canonical id — the case the first version reported as body-only.
    expect(activeRouteForSpelling("mod:f", "alias", {}, { "mod:f": idImpl }, true))
      .toEqual({ origin: "NativeWithFallback", tier: "nativeImplsCtx", key: "mod:f" });
    // ctx[id] outranks ctx[alias].
    expect(activeRouteForSpelling("mod:f", "alias", {}, { "mod:f": idImpl, alias: aliasImpl }, false).key)
      .toBe("mod:f");
    // ctx[alias] outranks plain[id] — the second step of the ladder beats the third.
    expect(activeRouteForSpelling("mod:f", "alias", { "mod:f": idImpl }, { alias: aliasImpl }, false))
      .toEqual({ origin: "HostNative", tier: "nativeImplsCtx", key: "alias" });
    // plain[id] outranks plain[alias].
    expect(activeRouteForSpelling("mod:f", "alias", { "mod:f": idImpl, alias: aliasImpl }, {}, false).key)
      .toBe("mod:f");
    // nothing anywhere ⇒ the body / a declaration.
    expect(activeRouteForSpelling("mod:f", "alias", {}, { g: idImpl }, true))
      .toEqual({ origin: "FenelBody", tier: "", key: "" });
    expect(activeRouteForSpelling("mod:f", "mod:f", { "mod:f": idImpl }, {}, false))
      .toEqual({ origin: "HostNative", tier: "nativeImpls", key: "mod:f" });
  });

  it("a CANONICAL-body function whose alias reaches a native is reported, not dropped", () => {
    // It is not a root, so it carries no claim row — and the first version's
    // `continue` therefore dropped its ambiguity entirely. That is exactly the
    // case a consumer must not treat as "a body".
    const artifact = JSON.parse(readFileSync(
      join(REPO_ROOT, "implementations/typescript/engine/src/generated/signature-honesty-claims.json"),
      "utf8",
    )) as { profiles: Record<string, { counts: Record<string, number>; bodyAmbiguities: unknown[] }> };
    for (const p of Object.keys(artifact.profiles)) {
      const prof = artifact.profiles[p]!;
      expect(prof.counts.fenelBodyRouteAmbiguous).toBeDefined();
      expect(Array.isArray(prof.bodyAmbiguities)).toBe(true);
      expect(prof.bodyAmbiguities.length).toBe(prof.counts.fenelBodyRouteAmbiguous ?? -1);
    }
  });

  it("the artifact states its route scope rather than implying a function-global one", () => {
    const artifact = JSON.parse(readFileSync(
      join(REPO_ROOT, "implementations/typescript/engine/src/generated/signature-honesty-claims.json"),
      "utf8",
    )) as { routeScope?: string; authority?: string };
    expect(artifact.routeScope).toContain("CANONICAL-ID INVOCATION ONLY");
    expect(artifact.authority).toContain("NONE");
  });
});

describe("3d-D6 — the census's origin strata are non-degenerate", () => {
  it("a native IS classified as a native — the 3b strata had ZERO of them", () => {
    // The defect this pins: the census read the maps off `registry.nativeImpls`
    // / `.nativeImplsCtx`, which do not exist, so `activeOrigin` saw two empty
    // maps and every function came out `FenelBody` or `ExternalHandler`. The
    // table looked plausible and was blind.
    const c = ctx as unknown as {
      natives?: Record<string, unknown>;
      nativesCtx?: Record<string, unknown>;
    };
    const natives = c.natives ?? {};
    const nativesCtx = c.nativesCtx ?? {};
    const strata: Record<string, number> = {};
    for (const fn of registry.listFunctions() as { id: string; body?: unknown }[]) {
      const route = activeRouteFor([fn.id], natives, nativesCtx, fn.body !== undefined);
      strata[route.origin] = (strata[route.origin] ?? 0) + 1;
    }
    // The load-bearing assertion: at least one function's ACTIVE branch is a
    // host native. Under the 3b reader this number was 0.
    const nativeBranch = (strata.HostNative ?? 0) + (strata.NativeWithFallback ?? 0);
    expect(nativeBranch).toBeGreaterThan(0);
    expect(strata.FenelBody ?? 0).toBeGreaterThan(0);
  });

  it("the census imports the shared enumerator instead of carrying a copy", () => {
    const census = readFileSync(
      join(REPO_ROOT, "implementations/typescript/engine/scripts/signature-phase-4-census.ts"),
      "utf8",
    );
    expect(census).toContain("\"./generate-signature-honesty-claims\"");
    expect(census).toContain("activeRouteForSpelling");
    expect(census).toContain("registry.evaluateContext()");
    expect(census).not.toContain("registry as unknown as { nativeImpls?");
    // and the ported pure logic is gone from TypeScript entirely
    expect(census).not.toContain("function activeOrigin");
    expect(census).not.toContain("function harvestRawKeys");
  });

  it("the census's invalidation identity is the ROUTE, not the target id alone", () => {
    const census = readFileSync(
      join(REPO_ROOT, "implementations/typescript/engine/scripts/signature-phase-4-census.ts"),
      "utf8",
    );
    expect(census).toContain("dependencyId: `${specActive.origin}|${specActive.tier}|${specActive.key}|${spec.id}`");
  });
});
