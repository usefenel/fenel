// parser-substrate Phase 1 — conformance tests for the Fenel Pattern algebra
// (`fenel/modules/engine/pattern-algebra.fenel`). brief:
// `workstreams/parser-substrate/briefs/phase-1-pattern-algebra.md`.
//
// Two suites:
//   1. DIFFERENTIAL ORACLE — ≥1000 seeded (pattern × input) cases over the
//      SHARED fragment (match/seq/alt/rep over $enum/$interval predicates):
//      Fenel `recognizeG` (a ref-free root wrapped as a singleton grammar)
//      MUST agree with TS `patternMatch` (`pattern.ts`, the frozen oracle).
//      Seeded MINSTD RNG (the P15 precedent) ⇒ failures reproduce from `SEED`.
//   2. RECURSION SUITE — no TS analogue (the TS algebra has no refs/red/PEpsV):
//      balanced (the probe-5 fixpoint-nullability regression), left-recursive
//      (recognize + parse — the termination proof for the strict step), mutual
//      recursion, a reduction pipeline building a real Syntax value, PRep
//      parity corners, env-growth (pruning on).
//
// THE TEST-LOCAL MARSHAL (decision 9b): the TS side authors `$`-keyed SetExprs
// directly and lowers them to plain-record `Ws*` markers — test-local, NOT a
// new runtime seam. The Pat values are built as positional `_0/_1/_2`-keyed
// `$tag` records (the construct-op encoding the Fenel body pattern-matches).

import { describe, it, expect } from "vitest";
import { match, seq, alt, rep, patternMatch, type Pattern } from "./pattern";
import type { SetExpr } from "./types";
import { dispatchEngineBody } from "./engine-bodies-dispatch";

// --- Pat builders (positional construct-op encoding) ----------------------
const PEmpty = { $tag: "PEmpty" };
const PEps = { $tag: "PEps" };
const PMatch = (ws: unknown) => ({ $tag: "PMatch", _0: ws });
const PSeq = (l: unknown, r: unknown) => ({ $tag: "PSeq", _0: l, _1: r });
const PAlt = (l: unknown, r: unknown) => ({ $tag: "PAlt", _0: l, _1: r });
const PRep = (c: unknown, min: number, max: number) => ({ $tag: "PRep", _0: c, _1: min, _2: max });
const PRed = (c: unknown, fn: unknown) => ({ $tag: "PRed", _0: c, _1: fn });
const PRef = (name: string) => ({ $tag: "PRef", _0: name });

type GEntry = { name: string; pat: unknown };
const G = (entries: [string, unknown][]): GEntry[] => entries.map(([name, pat]) => ({ name, pat }));
const wrap = (pat: unknown): GEntry[] => [{ name: "S", pat }];

const closure = (params: string[], body: unknown, scope: Record<string, unknown> = {}) =>
  ({ __fenelFn: true, params, body, closure: scope });

const recognizeG = (g: unknown, start: string, toks: unknown[]): boolean =>
  dispatchEngineBody("engine:recognizeG", [g, start, toks]) as boolean;
const parseG = (g: unknown, start: string, toks: unknown[]): unknown =>
  dispatchEngineBody("engine:parseG", [g, start, toks]);
const wsMember = (ws: unknown, x: unknown): boolean =>
  dispatchEngineBody("engine:wsMember", [ws, x]) as boolean;

// --- the $-keyed SetExpr → Ws marker marshal (test-local) -----------------
function predToWs(pred: SetExpr): unknown {
  if ("$enum" in pred) return { tag: "WsEnum", values: (pred as { $enum: unknown[] }).$enum };
  if ("$interval" in pred) {
    const iv = (pred as { $interval: { lo: unknown; hi: unknown } }).$interval;
    return { tag: "WsInterval", lo: iv.lo, hi: iv.hi };
  }
  if ("$all" in pred) return { tag: "WsAll" };
  if ("$none" in pred) return { tag: "WsNone" };
  if ("$union" in pred) return { tag: "WsUnion", branches: (pred as { $union: SetExpr[] }).$union.map(predToWs) };
  if ("$intersect" in pred) return { tag: "WsIntersect", branches: (pred as { $intersect: SetExpr[] }).$intersect.map(predToWs) };
  if ("$complement" in pred) return { tag: "WsComplement", inner: predToWs((pred as { $complement: SetExpr }).$complement) };
  return { tag: "WsWhere" };
}

// --- TS Pattern → Fenel Pat marshal ---------------------------------------
function tsPatToFenel(p: Pattern): unknown {
  switch (p.t) {
    case "empty": return PEmpty;
    case "eps": return PEps;
    case "match": return PMatch(predToWs(p.pred));
    case "seq": return PSeq(tsPatToFenel(p.a), tsPatToFenel(p.b));
    case "alt": return PAlt(tsPatToFenel(p.a), tsPatToFenel(p.b));
    case "rep": return PRep(tsPatToFenel(p.child), p.min, p.max === Infinity ? -1 : p.max);
    default: throw new Error(`unmarshalable TS pattern node: ${p.t}`);
  }
}

// --- Maybe<Bound> + interval/enum SetExpr builders ------------------------
const Just = (v: unknown) => ({ $tag: "Just", _0: v });
const Nothing = { $tag: "Nothing" };
const bound = (value: number, inclusive: boolean) => ({ value, inclusive });
const enumSet = (vals: number[]): SetExpr => ({ $enum: vals } as unknown as SetExpr);
const intervalSet = (lo: unknown, hi: unknown): SetExpr => ({ $interval: { lo, hi } } as unknown as SetExpr);

// =========================================================================
// wsMember — the decidable membership decider.
// =========================================================================
describe("wsMember — decidable Ws-marker membership", () => {
  it("WsEnum is an eq-scan", () => {
    expect(wsMember({ tag: "WsEnum", values: [1, 3, 5] }, 3)).toBe(true);
    expect(wsMember({ tag: "WsEnum", values: [1, 3, 5] }, 4)).toBe(false);
  });
  it("WsAll / WsNone are trivial", () => {
    expect(wsMember({ tag: "WsAll" }, 42)).toBe(true);
    expect(wsMember({ tag: "WsNone" }, 42)).toBe(false);
  });
  it("WsWhere ⇒ false (the TS conservative-false posture)", () => {
    expect(wsMember({ tag: "WsWhere" }, 42)).toBe(false);
  });
  it("WsInterval honours inclusivity + unbounded (Nothing) sides", () => {
    // [2, 5)
    const iv = { tag: "WsInterval", lo: Just(bound(2, true)), hi: Just(bound(5, false)) };
    expect(wsMember(iv, 2)).toBe(true);   // inclusive lo
    expect(wsMember(iv, 4)).toBe(true);
    expect(wsMember(iv, 5)).toBe(false);  // exclusive hi
    expect(wsMember(iv, 1)).toBe(false);
    // (-inf, 0]
    const upTo0 = { tag: "WsInterval", lo: Nothing, hi: Just(bound(0, true)) };
    expect(wsMember(upTo0, -9)).toBe(true);
    expect(wsMember(upTo0, 0)).toBe(true);
    expect(wsMember(upTo0, 1)).toBe(false);
  });
  it("WsUnion / WsIntersect / WsComplement combine", () => {
    const a = { tag: "WsEnum", values: [1, 2, 3] };
    const b = { tag: "WsEnum", values: [2, 3, 4] };
    expect(wsMember({ tag: "WsUnion", branches: [a, b] }, 4)).toBe(true);
    expect(wsMember({ tag: "WsUnion", branches: [a, b] }, 9)).toBe(false);
    expect(wsMember({ tag: "WsIntersect", branches: [a, b] }, 2)).toBe(true);
    expect(wsMember({ tag: "WsIntersect", branches: [a, b] }, 1)).toBe(false);
    expect(wsMember({ tag: "WsComplement", inner: a }, 9)).toBe(true);
    expect(wsMember({ tag: "WsComplement", inner: a }, 2)).toBe(false);
  });
  it("agrees with the TS contains-collapse on the marshalled fragment", () => {
    // A few hand cases tying wsMember to TS patternMatch via a 1-element seq.
    const cases: [SetExpr, number, boolean][] = [
      [enumSet([0, 4]), 4, true],
      [enumSet([0, 4]), 2, false],
      [intervalSet(Just(bound(1, true)), Just(bound(3, true))), 2, true],
      [intervalSet(Just(bound(1, false)), Nothing), 1, false],
    ];
    for (const [pred, v, expected] of cases) {
      expect(wsMember(predToWs(pred), v)).toBe(expected);
      // and the TS oracle agrees that the singleton pattern accepts [v] iff member
      expect(patternMatch(match(pred), [v])).toBe(expected);
    }
  });
});

// =========================================================================
// Differential oracle — Fenel recognizeG ≡ TS patternMatch (shared fragment).
// =========================================================================
describe("differential oracle vs pattern.ts (match/seq/alt/rep over enum/interval)", () => {
  const SEED = 1234567; // record: re-run reproduces any failure
  let seed = SEED;
  const rnd = (): number => {
    seed = (seed * 48271) % 2147483647; // MINSTD; 48271·(2³¹−2) < 2⁵³ ⇒ no float loss
    return seed;
  };
  const rndInt = (n: number): number => rnd() % n;

  const genPred = (): SetExpr => {
    if (rndInt(2) === 0) {
      const n = 1 + rndInt(3);
      const vals: number[] = [];
      for (let i = 0; i < n; i++) vals.push(rndInt(5));
      return enumSet([...new Set(vals)]);
    }
    const lo = rndInt(2) === 0 ? Just(bound(rndInt(5), rndInt(2) === 0)) : Nothing;
    const hi = rndInt(2) === 0 ? Just(bound(rndInt(5), rndInt(2) === 0)) : Nothing;
    return intervalSet(lo, hi);
  };
  const genPat = (depth: number): Pattern => {
    if (depth <= 0 || rndInt(3) === 0) return match(genPred());
    const k = rndInt(3);
    if (k === 0) return seq(genPat(depth - 1), genPat(depth - 1));
    if (k === 1) return alt(genPat(depth - 1), genPat(depth - 1));
    const min = rndInt(3);
    const max = rndInt(3) === 0 ? Infinity : min + rndInt(3);
    return rep(genPat(depth - 1), min, max);
  };
  const genInput = (): number[] => {
    const len = rndInt(9); // 0..8
    const out: number[] = [];
    for (let i = 0; i < len; i++) out.push(rndInt(5));
    return out;
  };

  it("≥1000 generated cases agree", () => {
    const N = 1100;
    const mismatches: { tsPat: Pattern; input: number[]; ts: boolean; fenel: boolean }[] = [];
    for (let i = 0; i < N; i++) {
      const tsPat = genPat(3);
      const input = genInput();
      const ts = patternMatch(tsPat, input);
      const fenel = recognizeG(wrap(tsPatToFenel(tsPat)), "S", input);
      if (ts !== fenel) mismatches.push({ tsPat, input, ts, fenel });
    }
    // Surface the first few mismatches readably (SEED reproduces).
    expect(mismatches.slice(0, 3)).toEqual([]);
    expect(mismatches.length).toBe(0);
  });
});

// =========================================================================
// Recursion suite — no TS analogue (refs / red / PEpsV).
// =========================================================================
const mkN = (n: number) => PMatch({ tag: "WsEnum", values: [n] });
const mkS = (s: string) => PMatch({ tag: "WsEnum", values: [s] });

describe("recursion suite", () => {
  it("balanced grammar — fixpoint nullability regression (probe 5)", () => {
    // S = "1" S "2" | ε  — the naive non-recursive nullable mis-reported these.
    const S = G([["S", PAlt(PSeq(mkN(1), PSeq(PRef("S"), mkN(2))), PEps)]]);
    expect(recognizeG(S, "S", [])).toBe(true);
    expect(recognizeG(S, "S", [1, 2])).toBe(true);
    expect(recognizeG(S, "S", [1, 1, 2, 2])).toBe(true);
    expect(recognizeG(S, "S", [1, 1, 1, 2, 2, 2])).toBe(true);
    expect(recognizeG(S, "S", [1, 2, 2])).toBe(false);
    expect(recognizeG(S, "S", [1])).toBe(false);
    expect(recognizeG(S, "S", [1, 1, 2])).toBe(false);
  });

  it("left-recursive E = E '+' 'n' | 'n' — recognize + parse (strict-step termination)", () => {
    const E = G([["E", PAlt(PSeq(PRef("E"), PSeq(mkS("+"), mkS("n"))), mkS("n"))]]);
    expect(recognizeG(E, "E", ["n"])).toBe(true);
    expect(recognizeG(E, "E", ["n", "+", "n"])).toBe(true);
    expect(recognizeG(E, "E", ["n", "+", "n", "+", "n"])).toBe(true);
    expect(recognizeG(E, "E", ["n", "+"])).toBe(false);
    expect(recognizeG(E, "E", ["+", "n"])).toBe(false);
    // parse yields the left-nested pair structure.
    expect(parseG(E, "E", ["n", "+", "n"])).toEqual({
      $tag: "Just",
      _0: { fst: "n", snd: { fst: "+", snd: "n" } },
    });
  });

  it("mutual recursion A = 'a' B | ε ; B = 'b' A", () => {
    const AB = G([
      ["A", PAlt(PSeq(mkS("a"), PRef("B")), PEps)],
      ["B", PSeq(mkS("b"), PRef("A"))],
    ]);
    expect(recognizeG(AB, "A", [])).toBe(true);
    expect(recognizeG(AB, "A", ["a", "b"])).toBe(true);
    expect(recognizeG(AB, "A", ["a", "b", "a", "b"])).toBe(true);
    expect(recognizeG(AB, "A", ["a"])).toBe(false);
    expect(recognizeG(AB, "A", ["a", "b", "a"])).toBe(false);
    expect(recognizeG(AB, "B", ["b"])).toBe(true);
    expect(recognizeG(AB, "B", ["b", "a", "b"])).toBe(true);
  });

  it("reduction pipeline builds a real Syntax value (SCall add [SLit, SLit])", () => {
    // E = "n" ⇒ SLit "n" ; Expr = E "+" E ⇒ SCall "add" [E1, E2] | E
    const SLit = closure(["v"], { construct: ["SLit", { var: "v" }] });
    const toCall = closure(["p"], {
      construct: [
        "SCall", "add",
        { construct: ["SCons", { var: "p.fst" }, { construct: ["SCons", { var: "p.snd.snd" }, { construct: ["SNil"] }] }] },
      ],
    });
    const calc = G([
      ["E", PRed(mkS("n"), SLit)],
      ["Expr", PAlt(PRed(PSeq(PRef("E"), PSeq(mkS("+"), PRef("E"))), toCall), PRef("E"))],
    ]);
    expect(parseG(calc, "Expr", ["n"])).toEqual({ $tag: "Just", _0: { $tag: "SLit", _0: "n" } });
    expect(parseG(calc, "Expr", ["n", "+", "n"])).toEqual({
      $tag: "Just",
      _0: {
        $tag: "SCall", _0: "add",
        _1: { $tag: "SCons", _0: { $tag: "SLit", _0: "n" }, _1: { $tag: "SCons", _0: { $tag: "SLit", _0: "n" }, _1: { $tag: "SNil" } } },
      },
    });
  });

  it("PRep parity corners (bounds, star, plus, nested)", () => {
    const rep23 = wrap(PRep(mkS("a"), 2, 3));
    expect(recognizeG(rep23, "S", ["a"])).toBe(false);
    expect(recognizeG(rep23, "S", ["a", "a"])).toBe(true);
    expect(recognizeG(rep23, "S", ["a", "a", "a"])).toBe(true);
    expect(recognizeG(rep23, "S", ["a", "a", "a", "a"])).toBe(false);
    const star = wrap(PRep(mkS("a"), 0, -1)); // unbounded sentinel
    expect(recognizeG(star, "S", [])).toBe(true);
    expect(recognizeG(star, "S", ["a", "a", "a", "a"])).toBe(true);
    const plus = wrap(PRep(mkS("a"), 1, -1));
    expect(recognizeG(plus, "S", [])).toBe(false);
    expect(recognizeG(plus, "S", ["a"])).toBe(true);
    const nested = wrap(PRep(PSeq(mkS("a"), mkS("a")), 0, -1)); // (aa)*
    expect(recognizeG(nested, "S", ["a", "a"])).toBe(true);
    expect(recognizeG(nested, "S", ["a", "a", "a"])).toBe(false);
    expect(recognizeG(nested, "S", ["a", "a", "a", "a"])).toBe(true);
  });
});

// =========================================================================
// 6b lever-A compaction rules — red-fusion + eps-value seq collapse (direct
// unit pins; the differential above re-proves they're value-preserving).
// =========================================================================
const PEpsV = (v: unknown) => ({ $tag: "PEpsV", _0: v });
const mkSeq = (a: unknown, b: unknown): unknown => dispatchEngineBody("engine:mkSeq", [a, b]);
const mkRed = (c: unknown, fn: unknown): unknown => dispatchEngineBody("engine:mkRed", [c, fn]);

describe("6b compaction rules", () => {
  it("eps-collapse (left): mkSeq (PEpsV v) b ⇒ PRed over b (not a PSeq)", () => {
    const b = PMatch({ tag: "WsEnum", values: ["x"] });
    const out = mkSeq(PEpsV("v"), b) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("PRed");
    expect(out._0).toEqual(b);
  });
  it("eps-collapse (right): mkSeq a (PEpsV v) ⇒ PRed over a (not a PSeq)", () => {
    const a = PMatch({ tag: "WsEnum", values: ["x"] });
    const out = mkSeq(a, PEpsV("v")) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("PRed");
    expect(out._0).toEqual(a);
  });
  it("eps×eps fully collapses to a PEpsV carrying the exact {fst,snd} pair", () => {
    // mkSeq(PEpsV l, PEpsV r) ⇒ mkRed(PEpsV r, \x->{fst:l,snd:x}) ⇒ PEpsV {fst:l,snd:r}
    expect(mkSeq(PEpsV("l"), PEpsV("r"))).toEqual(PEpsV({ fst: "l", snd: "r" }));
  });
  it("PEmpty annihilation still wins over a PEpsV side", () => {
    expect(mkSeq(PEpsV("v"), PEmpty)).toEqual(PEmpty);
    expect(mkSeq(PEmpty, PEpsV("v"))).toEqual(PEmpty);
  });
  it("red-fusion: mkRed (PRed c g) f keeps the ORIGINAL child c (no stacked PRed)", () => {
    // structural — the g/f closures are not applied here, only re-nested.
    const g = closure(["v"], { construct: ["SLit", { var: "v" }] });
    const f = closure(["w"], { construct: ["SLit", { var: "w" }] });
    const c = PMatch({ tag: "WsEnum", values: ["n"] });
    const out = mkRed(PRed(c, g), f) as { $tag: string; _0: unknown };
    expect(out.$tag).toBe("PRed");
    expect(out._0).toEqual(c); // child is c, not PRed(c,g) — the layers fused
  });
  it("red-fusion preserves value semantics (g then f) end-to-end", () => {
    // g wraps as SLit, f conses it onto SNil — fused, the order must stay g-then-f.
    const g = closure(["v"], { construct: ["SLit", { var: "v" }] });
    const f = closure(["w"], { construct: ["SCons", { var: "w" }, { construct: ["SNil"] }] });
    const S = G([["S", PRed(PRed(mkS("n"), g), f)]]);
    expect(parseG(S, "S", ["n"])).toEqual({
      $tag: "Just",
      _0: { $tag: "SCons", _0: { $tag: "SLit", _0: "n" }, _1: { $tag: "SNil" } },
    });
  });
  it("mkRed (PEpsV v) f applies f eagerly to the carried value", () => {
    const f = closure(["v"], { construct: ["SLit", { var: "v" }] });
    expect(mkRed(PEpsV("n"), f)).toEqual(PEpsV({ $tag: "SLit", _0: "n" }));
  });
});

// =========================================================================
// Env growth (reachability pruning on) — the Phase-6 budget input.
// =========================================================================
describe("env growth (pruning on)", () => {
  const maxEnvOver = (g: GEntry[], start: string, toks: unknown[]): number => {
    let cur: unknown = g;
    let root: unknown = PRef(start);
    let mx = g.length;
    for (let k = 1; k <= toks.length; k++) {
      const s = dispatchEngineBody("engine:stepGrammar", [cur, root, toks[k - 1], k]) as { g: unknown[]; root: unknown };
      cur = s.g; root = s.root;
      mx = Math.max(mx, (s.g as unknown[]).length);
    }
    return mx;
  };

  it("left-recursive grammar stays flat over 64 tokens (head-position recursion ⇒ self-referential sibling)", () => {
    const E = G([["E", PAlt(PSeq(PRef("E"), PSeq(mkS("+"), mkS("n"))), mkS("n"))]]);
    const toks: string[] = ["n"];
    while (toks.length < 64) toks.push("+", "n");
    toks.length = 63; // a valid odd-length expr
    expect(recognizeG(E, "E", toks)).toBe(true);
    expect(maxEnvOver(E, "E", toks)).toBe(1);
  });

  it("balanced grammar grows linearly with nesting depth (mid-position recursion ⇒ fresh-ref retention)", () => {
    // depth 8: env should be ~depth+1 (kept fresh-S levels), bounded & small.
    const S = G([["S", PAlt(PSeq(mkS("1"), PSeq(PRef("S"), mkS("2"))), PEps)]]);
    const toks: string[] = [];
    for (let i = 0; i < 8; i++) toks.push("1");
    for (let i = 0; i < 8; i++) toks.push("2");
    expect(recognizeG(S, "S", toks)).toBe(true);
    expect(maxEnvOver(S, "S", toks)).toBe(9);
  });
});
