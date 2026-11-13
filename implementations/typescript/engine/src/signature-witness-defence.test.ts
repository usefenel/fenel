// ---------------------------------------------------------------------------
// signature-witness-defence.test.ts — signature-substrate slice 3jw, §2 + §2a.
//
// TWO deliverables, one file:
//   §2a  `Char` MEMBERSHIP — the prerequisite. Before this slice `Char` had no
//        `Membership` instance at all, so `namedMember Char "a"` answered
//        `Nothing` and every Char witness proposal re-checked to Nothing.
//   §2   the WITNESS DE-FENCE — `inhabit (SeRef h)` now exhibits the canonical
//        inhabitant for `seNamedEmpty`'s ten definitionally-inhabited names,
//        each one membership-re-checked; every other handle stays fenced.
//
// WHY THE CHAR ORACLE IS CONSTRUCTED IN TYPESCRIPT AND NOT IN `.fenel`.
// `\uXXXX` IS NOT A FENEL ESCAPE. `decodeEsc` (fenel/modules/engine/lexer.fenel)
// resolves exactly `n`, `t`, `\` and `"`, then returns the character VERBATIM —
// so `"\uD800"` in a `.fenel` file is the five-character string `uD800`, which
// is five scalars, which answers `Just false`. The negative rows would pass for
// entirely the wrong reason and every positive boundary row would fail. So each
// value is built here as a TS literal and ITS CODE-UNIT SEQUENCE IS ASSERTED
// before it is used — a mis-constructed value silently changes what a row tests.
//
// EVERY ORACLE ROW KILLS A NAMED WRONG IMPLEMENTATION, and the `kills` column
// is load-bearing documentation: four design rounds each widened this table
// because the previous version was passed by a plausible bug (5 rows -> 11 ->
// 16 -> 18). Do not prune a row that looks redundant; read its `kills` first.
// ---------------------------------------------------------------------------

import { setDefaultTimeout, describe, it, expect } from "bun:test";

// Booting the system registry + running kernel-backed judgments crosses bun's
// 5s default on a slower box. A harness fact, stated as one.
setDefaultTimeout(120000);

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchEngineBody, dispatchEngineBodyWithDeciderCtx, dispatchedInhabit } from "./engine-bodies-dispatch";
import { createRepositoryRegistry } from "./repository-registry";
import { createDispatchRegistry } from "./dispatch-registry";
import { SYSTEM_REGISTRY_MODULES } from "./system-registry-modules";
import { evaluate } from "./json-logic";
import { witnessOf } from "./set-algebra";
import type { SetExpr } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const read = (relative: string): string => readFileSync(join(REPO, relative), "utf8");

const dec = (fnId: string, args: unknown[]): unknown => dispatchEngineBodyWithDeciderCtx(fnId, args);
const registry = createRepositoryRegistry([...SYSTEM_REGISTRY_MODULES], { dispatchRegistry: createDispatchRegistry() });
const ref = (handle: string): SetExpr => ({ $tag: "SeRef", handle });
const enumS = (...values: unknown[]): SetExpr => ({ $tag: "SeEnum", values });
const JUST = (b: boolean) => ({ $tag: "Just", _0: b });
const NOTHING = { $tag: "Nothing" };

/** The ten names `seNamedEmpty` answers `Just false` for — NOT "the atom
 *  tower", which is a different set: `Real` / `Rational` / `ℚ` / `NonEmpty`
 *  have LIVE membership but are absent from these ten (measured). */
const TEN = ["ℝ", "ℤ", "ℕ", "Number", "Int", "Nat", "String", "Char", "Boolean", "Bool"] as const;
const CANONICAL: Record<string, unknown> = {
  "ℝ": 0, "ℤ": 0, "ℕ": 0, Number: 0, Int: 0, Nat: 0,
  String: "", Char: "a", Boolean: false, Bool: false,
};

// ---------------------------------------------------------------------------
// §2a — the EIGHTEEN-row Char oracle
// ---------------------------------------------------------------------------

type CharRow = {
  label: string;
  value: unknown;
  /** UTF-16 code units, asserted before the row runs. `null` = not a string. */
  units: readonly number[] | null;
  expect: boolean;
  kills: string;
};
const CHAR_ORACLE: readonly CharRow[] = [
  { label: "U+0061 'a'", value: "a", units: [0x0061], expect: true, kills: "the trivially-broken" },
  { label: "U+00E9 'é'", value: "é", units: [0x00e9], expect: true, kills: "the trivially-broken" },
  { label: "U+0000 NUL", value: "\u0000", units: [0x0000], expect: true, kills: "`codePointAt(0) > 0` used as the empty test — rejects a valid NUL scalar" },
  { label: "U+D7FF", value: "퟿", units: [0xd7ff], expect: true, kills: "an off-by-one LOW bound on the surrogate block" },
  { label: "U+D800 lone high", value: "\uD800", units: [0xd800], expect: false, kills: "lone HIGH surrogate" },
  { label: "U+DBFF top high", value: "\uDBFF", units: [0xdbff], expect: false, kills: "a `< 0xDBFF` EXCLUSIVE high-range test — admits the top high surrogate" },
  { label: "U+DC00 lone low", value: "\uDC00", units: [0xdc00], expect: false, kills: "lone LOW surrogate — a high-only guard admits it" },
  { label: "U+DFFF top low", value: "\uDFFF", units: [0xdfff], expect: false, kills: "top of the surrogate block" },
  { label: "U+E000", value: "", units: [0xe000], expect: true, kills: "an off-by-one HIGH bound on the block" },
  { label: "U+10000 min astral", value: "\u{10000}", units: [0xd800, 0xdc00], expect: true, kills: "over-strict surrogate-pair bounds — the MINIMUM astral scalar, which U+1F98A and U+10FFFF do not catch" },
  { label: "reversed pair", value: "\uDC00\uD800", units: [0xdc00, 0xd800], expect: false, kills: "'any two surrogate units' with no order check" },
  { label: "U+1F98A '🦊'", value: "\u{1F98A}", units: [0xd83e, 0xdd8a], expect: true, kills: "a `.length === 1` test" },
  { label: "U+10FFFF max", value: "\u{10FFFF}", units: [0xdbff, 0xdfff], expect: true, kills: "the maximum scalar" },
  { label: "the empty string", value: "", units: [], expect: false, kills: "no scalar" },
  { label: "U+0061 U+0062 'ab'", value: "ab", units: [0x0061, 0x0062], expect: false, kills: "two scalars" },
  { label: "the number 97", value: 97, units: null, expect: false, kills: "wrong carrier" },
  { label: "the number 7", value: 7, units: null, expect: false, kills: "`String(x)` coercion before the scalar count — `97` becomes \"97\" and is rejected, but `7` becomes \"7\" and would be falsely ACCEPTED" },
  { label: "the ARRAY [97]", value: [97], units: null, expect: false, kills: "an implementation with NO `isString` — live `length(97)`/`length(7)` are 0 so both numeric rows pass, but `length([97])` is 1 and `charCode([97])` coerces through `String([97])` to 57" },
  { label: "U+D800 then 'A'", value: "\uD800A", units: [0xd800, 0x0041], expect: false, kills: "'first unit is a high surrogate ⇒ accept the pair' — passes the reversed-pair row but admits a high surrogate followed by a non-low unit" },
];

describe("slice 3jw §2a — Char membership (unicode-scalar semantics)", () => {
  it("every oracle value is CONSTRUCTED as the code-unit sequence it claims", () => {
    // Guards the whole table: a value that is not what it says it is turns a
    // green row into no evidence at all.
    for (const row of CHAR_ORACLE) {
      if (row.units === null) { expect(typeof row.value).not.toBe("string"); continue; }
      const s = row.value as string;
      const got = Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));
      expect({ label: row.label, units: got }).toEqual({ label: row.label, units: [...row.units] });
    }
  });

  it("`namedMember Char _` decides all 18 rows, each killing its named wrong implementation", () => {
    for (const row of CHAR_ORACLE) {
      const got = dec("engine:namedContains", ["Char", row.value]);
      expect({ row: row.label, kills: row.kills, verdict: got })
        .toEqual({ row: row.label, kills: row.kills, verdict: JUST(row.expect) });
    }
  });

  it("`namedMember Char \"a\"` is `Just true` — the prerequisite the whole slice rests on", () => {
    // Measured `Nothing` at the entry head: `Char` was in seNamedEmpty's ten
    // but had NO Membership instance, so seWitnessRef would propose "a",
    // re-check, get Nothing, and correctly return Nothing.
    expect(dec("engine:namedContains", ["Char", "a"])).toEqual(JUST(true));
  });

  it("the predicate is Fenel-bodied and its scalar bound is EXACTLY the surrogate block", () => {
    const src = read("fenel/modules/engine/set-algebra-deciders.fenel");
    expect(/membershipChar value =\s*\n\s*if isString value/.test(src)).toBe(true);
    // The decimals in the body, pinned against their hex meaning so a typo
    // cannot pass review: 0 and 0x10FFFF are the scalar range; 0xD800-0xDFFF
    // is the surrogate block removed from it.
    expect(0xd800).toBe(55296);
    expect(0xdfff).toBe(57343);
    expect(0x10ffff).toBe(1114111);
    // The predicate is the closed form `[0, 0x10FFFF] \ [0xD800, 0xDFFF]`.
    // The range bounds are NOT redundant with the caller's guard: a review
    // round observed that a surrogate-exclusion-only version answered `true`
    // for -1, 0x110000 and Infinity, none of which is a Unicode scalar.
    expect(/charCodeIsScalar c =\s*\n\s*if lt c 0 then false\s*\n\s*else if gt c 1114111 then false\s*\n\s*else if lt c 55296 then true\s*\n\s*else if gt c 57343 then true else false/.test(src)).toBe(true);
  });

  it("`charCodeIsScalar` is correct over the INTEGERS — the live domain — with the gap recorded", () => {
    // NAMED PRECISELY (round 2). It is exact on the integers, which is
    // `std:charCode`'s codomain and therefore every value the only caller can
    // supply. A NON-INTEGER in range still answers true; that gap is recorded
    // in the `mem.char` ledger row and queued, and it cannot produce a false
    // `membershipChar`. Asserted here so the limit is visible, not implied.
    // Executed, not merely read off the source — the four boundary pairs plus
    // the three out-of-range values the review round named.
    const scalar = (c: number): unknown => dec("engine:charCodeIsScalar", [c]);
    for (const c of [0, 97, 0xd7ff, 0xe000, 0x10000, 0x10ffff]) expect({ c, ok: scalar(c) }).toEqual({ c, ok: true });
    for (const c of [0xd800, 0xdbff, 0xdc00, 0xdfff, -1, 0x110000, Infinity, -Infinity, NaN]) {
      expect({ c, ok: scalar(c) }).toEqual({ c, ok: false });
    }
    // THE RECORDED GAP, asserted so it cannot silently change without notice:
    // a non-integer in range is currently accepted.
    expect({ c: 0.5, ok: scalar(0.5), note: "KNOWN GAP — queued, unreachable from charCode" })
      .toEqual({ c: 0.5, ok: true, note: "KNOWN GAP — queued, unreachable from charCode" });
  });

  it("does NOT contradict `std:charCode`, which is total on the wider declared domain", () => {
    // charCode is declared over `String` and answers 55296 for a lone high
    // surrogate (audited at slice 3j1). `Char` is the scalar SUBSET of String;
    // the restriction lives in the membership predicate, not in charCode.
    expect(dec("engine:namedContains", ["String", "\uD800"])).toEqual(JUST(true));
    expect(dec("engine:namedContains", ["Char", "\uD800"])).toEqual(JUST(false));
  });
});

// ---------------------------------------------------------------------------
// §2 — the witness de-fence
// ---------------------------------------------------------------------------

describe("slice 3jw §2 — inhabit de-fences SeRef over the ten names", () => {
  it("all ten witness, and EVERY witness re-checks `Just true` through membership", () => {
    // Deliberately NOT leaning on the generic `witnessSound` law: it treats an
    // undecided (`Nothing`) subset result as success, so a buggy Char witness
    // would false-green. Assert `namedMember(...) == Just true` directly.
    for (const h of TEN) {
      const w = dispatchedInhabit(ref(h)) as { $tag: string; _0?: unknown };
      expect({ h, tag: w.$tag }).toEqual({ h, tag: "Just" });
      expect({ h, w: w._0 }).toEqual({ h, w: CANONICAL[h] });
      expect({ h, recheck: dec("engine:namedContains", [h, w._0]) }).toEqual({ h, recheck: JUST(true) });
    }
  });

  it("names OUTSIDE the ten stay fenced — including ones with LIVE membership", () => {
    // `Real` / `Rational` / `ℚ` / `NonEmpty` HAVE membership instances but are
    // absent from seNamedEmpty's ten. The witness table is the dual of THAT
    // table, not of the membership registry; widening the two together is
    // queued, not done here.
    for (const h of ["Real", "Rational", "ℚ", "NonEmpty", "Bogus", "Bot", "X"]) {
      expect({ h, w: dispatchedInhabit(ref(h)) }).toEqual({ h, w: NOTHING });
    }
  });

  it("the SIX other `seWitnessNone` shapes are untouched", () => {
    const tails: Array<[string, SetExpr]> = [
      ["SeAll", { $tag: "SeAll" }],
      ["SeNone", { $tag: "SeNone" }],
      // The `pattern` payload is the pattern-algebra `Pattern` (`{t: …}`), NOT
      // the registered `Sp*` vocabulary, and NOT the bare `{t:"any"}` either —
      // `peelSetExpr` rejects both at the boundary, which is how these fixtures
      // were caught being wrong rather than being asserted from a wrong model.
      ["SePattern match", { $tag: "SePattern", pattern: { t: "match", pred: ref("char:ascii-letter") } } as unknown as SetExpr],
      ["SeWhere", { $tag: "SeWhere", pred: { call: ["gt", { var: "x" }, 0] } } as unknown as SetExpr],
      ["SeComplement SeNone", { $tag: "SeComplement", inner: { $tag: "SeNone" } }],
      ["SeComplement (SeRef String)", { $tag: "SeComplement", inner: ref("String") }],
      ["SeRigid", { $tag: "SeRigid", scopeToken: "t", ordinal: 0, kind: { $tag: "KType" } } as unknown as SetExpr],
      // ...and a μ-bound reference, which must NOT be read as a named set.
      ["SeMu X. SeRef X", { $tag: "SeMu", var: "X", body: ref("X") } as unknown as SetExpr],
    ];
    for (const [label, s] of tails) {
      expect({ label, w: dispatchedInhabit(s) }).toEqual({ label, w: NOTHING });
    }
  });

  // modules-as-values Phase 2c: the witness targets are qualified references
  // (`witness = engine.seWitnessNone`), no longer id strings.
  it("the six OTHER `dmInstance*` witness targets are unchanged, enumerated by name", () => {
    const src = read("fenel/modules/decidable-membership/instances.fenel");
    for (const inst of ["dmInstanceAll", "dmInstanceNone", "dmInstancePattern", "dmInstanceWhere", "dmInstanceComplement", "dmInstanceRigid"]) {
      const line = src.split("\n").find((l) => l.startsWith(`${inst} = `));
      expect({ inst, found: line !== undefined }).toEqual({ inst, found: true });
      expect({ inst, witness: /witness = ([\w.]+)/.exec(line!)?.[1] }).toEqual({ inst, witness: "engine.seWitnessNone" });
    }
    // ...and exactly SEVEN witness targets existed before; SIX remain on the
    // shared face, so the count is a real check and not a spelling check.
    expect(src.match(/witness = engine\.seWitnessNone\b/g)?.length).toBe(6);
  });

  it("`dmInstanceNamed` now names the real face", () => {
    const src = read("fenel/modules/decidable-membership/instances.fenel");
    const line = src.split("\n").find((l) => l.startsWith("dmInstanceNamed = "));
    expect(/witness = ([\w.]+)/.exec(line!)?.[1]).toBe("engine.seWitnessRef");
  });

  it("the CLASS-METHOD path `set:witness` agrees, evaluated through the ordinary context", () => {
    // WHAT THIS DOES AND DOES NOT PROVE — corrected after a review round.
    //
    // An earlier version of this test called `witnessOf` and described it as
    // "the class-dispatch path". It is not: `witnessOf` is the set-algebra
    // shim over `dispatchedInhabit`. The REAL polymorphic class method is
    // `set:witness`, and per its own `@description` it dispatches the ONE
    // `engine:inhabit` judgment core for EVERY shape — the per-shape `witness`
    // fnId on each `dmInstance*` is recorded metadata whose live route is
    // `inhabit` (decide-substrate Phase 3 left the per-shape fnId face as a
    // tail). So this exercises the method a consumer actually calls, through
    // `evaluate` on the ordinary registry context.
    //
    // It does NOT prove that `engine:seWitnessRef` is invocable by fnId in the
    // ordinary context. It is not — and neither are `engine:seWitnessNone` or
    // `engine:seWitnessEnum`, which this slice did not touch: engine per-shape
    // faces resolve through the curated engine-body harness. Measured, so the
    // limitation is recorded rather than implied away.
    const ctx = registry.evaluateContext();
    const setWitness = (s: SetExpr): unknown =>
      evaluate({ call: ["set:witness", { var: "s" }] } as never, { s }, ctx);
    expect(setWitness(ref("String"))).toEqual({ $tag: "Just", _0: "" });
    expect(setWitness(ref("Char"))).toEqual({ $tag: "Just", _0: "a" });
    expect(setWitness(ref("Bogus"))).toEqual(NOTHING);
    expect(setWitness({ $tag: "SeAll" })).toEqual(NOTHING);
    // ...and the set-algebra surface agrees with it.
    expect(witnessOf(ref("String"))).toEqual({ $tag: "Just", _0: "" });
    expect(witnessOf(ref("Char"))).toEqual({ $tag: "Just", _0: "a" });
    expect(witnessOf(ref("Bogus"))).toEqual(NOTHING);
  });
});

describe("slice 3jw §2 — the contradiction path, across BOTH production edges", () => {
  // All ten names answer `emp = Just false`, so NO ordinary production input
  // can reach `mem = Just true ∧ emp = Just true`. That is exactly why the two
  // edges below are needed: a gate that stopped at the adjudicator would pass
  // while the internal face laundered WContradiction into WAccept, and a gate
  // that stopped at the internal face would pass while the public projection
  // ignored the verdict. The guard is defence-in-depth against a future
  // widening of one table without the other — stated honestly, not dressed up
  // as a reachable production path.

  it("EDGE 1 — conflicting verdicts through the REAL internal face yield exactly WContradiction", () => {
    const v = dec("engine:seWitnessAdjudicate", ["W", JUST(true), JUST(true)]) as { $tag: string; diag?: string };
    expect(v.$tag).toBe("WContradiction");
    expect(typeof v.diag).toBe("string");
    expect(v.diag).toContain("seNamedEmpty");
  });

  it("EDGE 1 — the non-conflicting verdicts are the three the Tri discipline requires", () => {
    expect((dec("engine:seWitnessAdjudicate", ["W", JUST(true), JUST(false)]) as { $tag: string }).$tag).toBe("WAccept");
    expect((dec("engine:seWitnessAdjudicate", ["W", JUST(true), NOTHING]) as { $tag: string }).$tag).toBe("WAccept");
    // `Just false` and — load-bearing — an UNDECIDED membership are BOTH
    // abstentions. An undecided oracle is never read as agreement.
    expect((dec("engine:seWitnessAdjudicate", ["W", JUST(false), JUST(false)]) as { $tag: string }).$tag).toBe("WAbstain");
    expect((dec("engine:seWitnessAdjudicate", ["W", NOTHING, JUST(false)]) as { $tag: string }).$tag).toBe("WAbstain");
  });

  it("EDGE 2 — the REAL internal→public composition maps WContradiction to Nothing", () => {
    const contradiction = dec("engine:seWitnessAdjudicate", ["W", JUST(true), JUST(true)]);
    expect(dec("engine:wvToMaybe", [contradiction])).toEqual(NOTHING);
    // ...and the other two cases project as declared.
    expect(dec("engine:wvToMaybe", [{ $tag: "WAbstain" }])).toEqual(NOTHING);
    expect(dec("engine:wvToMaybe", [{ $tag: "WAccept", w: 7 }])).toEqual({ $tag: "Just", _0: 7 });
  });

  it("EDGE 2 — the public face IS that composition, with no room to ignore the verdict", () => {
    // The IGNORE/BYPASS mutant this forbids: `seWitnessRef` returning `Just w`
    // whenever membership is true, DISCARDING the W-result. On every live name
    // that mutant is observationally identical (emp is always `Just false`), so
    // execution alone cannot catch it — the parsed source must. `.fenel` is
    // read as Fenel source, never through a TS parser (a category error).
    const src = read("fenel/modules/engine/inhabit.fenel");
    expect(/seWitnessRef s =\s*\n\s*case s of\s*\n\s*SeRef \{ handle = h \} -> wvToMaybe \(seWitnessRefPick h\)\s*\n\s*_ -> Nothing/.test(src)).toBe(true);
    // ...and `seWitnessRefPick` hands the adjudicator's result back VERBATIM
    // (a tail call), so there is nowhere to inspect or override it either.
    expect(/Just w -> seWitnessAdjudicate w \(namedMember h w\) \(seNamedEmpty h\)/.test(src)).toBe(true);
  });

  it("the internal face's live behaviour on the ten names is WAccept, and WAbstain elsewhere", () => {
    for (const h of TEN) {
      expect({ h, tag: (dec("engine:seWitnessRefPick", [h]) as { $tag: string }).$tag }).toEqual({ h, tag: "WAccept" });
    }
    expect((dec("engine:seWitnessRefPick", ["Bogus"]) as { $tag: string }).$tag).toBe("WAbstain");
  });
});

describe("slice 3jw §2 — the parser budget stays honest", () => {
  it("`inhabit.fenel` is NOT in FENCE_FALLBACK — asserted DIRECTLY, not inferred", () => {
    // The swap replaced one identifier with another (`seWitnessNone` ->
    // `seWitnessFallback`), measured token-NEUTRAL at 119/120. This re-measures
    // the SHIPPED source through the same lexer + layout + splitter the parser
    // gate uses, so a later edit cannot silently cross the cap.
    const CAP = 120;
    const src = read("fenel/modules/engine/inhabit.fenel").replace(/\r\n?/g, "\n");
    // The PLAIN harness, not the decider ctx: the decider ctx's merged natives
    // re-enter the lexer's own dispatch and blow the stack on a file this size.
    const lexed = dispatchEngineBody("engine:lexAll", [src]);
    const spliced = dispatchEngineBody("engine:spliceSetBodies", [src, lexed]);
    const toks = dispatchEngineBody("engine:layoutTokens", [spliced]);
    const split = dispatchEngineBody("engine:splitTopLevelDecls", [toks]) as {
      groups: { v?: string }[][];
    };
    const over = split.groups.filter((g) => g.length > CAP);
    expect(over.map((g) => String(g[0]?.v ?? "?"))).toEqual([]);
    // ...and `inhabit` itself is still the one at the ceiling, so the headroom
    // claim is a measurement rather than a hope.
    const inhabitGroup = split.groups.find((g) => String(g[0]?.v ?? "") === "inhabit" && g.length > 20);
    expect(inhabitGroup).toBeDefined();
    expect(inhabitGroup!.length).toBeLessThanOrEqual(CAP);
  });
});

describe("slice 3jw — the Char registration's OWN effect, recorded separately", () => {
  // These widen from registering Char membership ALONE, through the existing
  // search paths, with no edit to SeDiff / SeIntersect. They are listed here
  // because the four-stage differential classifies them as the S1-S0 delta and
  // a corpus that omitted them would false-green.
  it("`SeDiff (SeEnum [1]) (SeRef Char)` witnesses", () => {
    expect(dispatchedInhabit({ $tag: "SeDiff", left: enumS(1), right: ref("Char") })).toEqual({ $tag: "Just", _0: 1 });
  });
  it("`SeIntersect [SeEnum [\"a\"], SeRef Char]` witnesses", () => {
    expect(dispatchedInhabit({ $tag: "SeIntersect", branches: [enumS("a"), ref("Char")] })).toEqual({ $tag: "Just", _0: "a" });
  });
  it("the one known `Just -> Just` change is enumerated, with both values sound", () => {
    // `SeUnion [SeRef String, SeEnum [42]]` was `Just 42` and is now `Just ""`:
    // the union face prefers the FIRST witnessing child, and the first child
    // now witnesses. BOTH are sound inhabitants of the union — the old one
    // because 42 ∈ {42}, the new one because "" ∈ String.
    const u: SetExpr = { $tag: "SeUnion", branches: [ref("String"), enumS(42)] };
    expect(dispatchedInhabit(u)).toEqual({ $tag: "Just", _0: "" });
    expect(dec("engine:namedContains", ["String", ""])).toEqual(JUST(true));
  });
});
