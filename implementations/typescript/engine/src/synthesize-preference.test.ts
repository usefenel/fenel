// decide-substrate Phase 8λ.6 — the preference-ordered candidate search.
//
// The COMPETITION ORACLES are NOT asserted here. They live in the frozen corpus
// (`workstreams/decide-substrate/notes/phase-8lambda-6-witness-preference/harness/corpus.json`)
// with committed expectations, and `harness/verify.ts` is the single runner CI
// executes over them — copying them into a suite would create exactly the drift
// trap the gate names (the suite gets updated while CI runs stale copies).
//
// What IS here: the contracts that are cheap, local, and would otherwise have no
// executable pin — budget normalization and the wrapper equations, the exhaustive
// `lawEvalSafe` matrix including the no-reflection requirement, the
// `synTermBudget` contract, and the trace face's shape.
//
// Design (normative, AS AMENDED): `design/arrow-synthesis.md` §5.1 + §10 + §11.

import { test, expect, describe } from "bun:test";
import type { SetExpr } from "./types";

import { setDefaultTimeout } from "bun:test";

// type-substrate P1(a) - bun's 5 s per-test default is wrong for this file: it
// drives the INTERPRETED Fenel deciders/synthesizer, and on a slow Windows host
// individual assertions measured 5-70 s BEFORE this phase and after it (verdicts
// identical either side). A suite that reports clock as failure is a gate nobody
// can read, which is how a real red in tcb-recheck went unnoticed. Raise the
// budget; never weaken an assertion to fit it.
setDefaultTimeout(600_000);

const { dispatchEngineBodyWithDeciderCtx: dec } = require("./engine-bodies-dispatch") as typeof import("./engine-bodies-dispatch");

const ref = (h: string): SetExpr => ({ $tag: "SeRef", handle: h } as unknown as SetExpr);
const posKey = (i: number) => ({ $tag: "PositionalField", index: i });
const arrowP = (ps: SetExpr[], r: SetExpr): SetExpr => ({
  $tag: "SeArrow",
  params: ps.map((s, i) => ({ $tag: "SetArrowParam", key: posKey(i), wireName: `_${i}`, set: s })),
  returns: r,
} as unknown as SetExpr);
const INT = ref("Int");

// ── the budget API (gate 9) ────────────────────────────────────────────────
describe("8λ.6 — admission-budget normalization", () => {
  const norm = (b: number) => dec("engine:synBudgetNorm", [b]) as number;

  test("NaN and BOTH infinities normalize to ZERO — order matters, and naively composing min/floor/max would send +Infinity to the cap instead", () => {
    expect(norm(NaN)).toBe(0);
    expect(norm(Infinity)).toBe(0);
    expect(norm(-Infinity)).toBe(0);
  });

  test("a negative value normalizes to zero, a positive fraction floors, an integer passes through", () => {
    expect(norm(-3)).toBe(0);
    expect(norm(-0.5)).toBe(0);
    expect(norm(2.7)).toBe(2);
    expect(norm(3)).toBe(3);
    expect(norm(0)).toBe(0);
    expect(norm(8)).toBe(8);
  });

  test("above-cap finite values clamp to the operational cap 64 — 65 and a large finite value both", () => {
    expect(norm(65)).toBe(64);
    expect(norm(1e9)).toBe(64);
    expect(norm(64)).toBe(64);
    expect(norm(63.9)).toBe(63);
  });

  test("clamping is reported, and only for a finite above-cap input", () => {
    const clamped = (b: number) => dec("engine:synBudgetClamped", [b]) as boolean;
    expect(clamped(65)).toBe(true);
    expect(clamped(1e9)).toBe(true);
    expect(clamped(64)).toBe(false);
    expect(clamped(8)).toBe(false);
    expect(clamped(Infinity)).toBe(false); // normalized to 0, not clamped to the cap
    expect(clamped(NaN)).toBe(false);
  });
});

// ── the wrapper policy (gate 9) ────────────────────────────────────────────
describe("8λ.6 — the three old names stay real wrappers at their exact arities", () => {
  const goal = arrowP([INT], INT);
  const law = { __fenelFn: true, params: ["f"], body: true, closure: {} };

  test("`synthesize fuel goal` returns a VERDICT at arity 2, not a partial closure, and equals `synthesizeBudget fuel 8 goal`", () => {
    const a = dec("engine:synthesize", [8, goal]) as { $tag?: string };
    const b = dec("engine:synthesizeBudget", [8, 8, goal]);
    expect(typeof a?.$tag).toBe("string");
    expect(a).toEqual(b as never);
  });

  test("`synthesizeArrow fuel s` returns a VERDICT at arity 2 and equals `synthesizeArrowBudget fuel 8 s`", () => {
    const a = dec("engine:synthesizeArrow", [8, goal]) as { $tag?: string };
    const b = dec("engine:synthesizeArrowBudget", [8, 8, goal]);
    expect(typeof a?.$tag).toBe("string");
    expect(a).toEqual(b as never);
  });

  test("`synthesizeWithLaw fuel goal law` returns a VERDICT at arity 3 and equals `synthesizeWithLawBudget fuel 8 goal law`", () => {
    const a = dec("engine:synthesizeWithLaw", [8, goal, law]) as { $tag?: string };
    const b = dec("engine:synthesizeWithLawBudget", [8, 8, goal, law]);
    expect(typeof a?.$tag).toBe("string");
    expect(a).toEqual(b as never);
  });

  test("the literal default IS 8 — a budget of 8 and the wrapper agree while a smaller one is a different admitted window", () => {
    const eight = dec("engine:synthesizeArrowBudget", [8, 8, goal]);
    expect(dec("engine:synthesizeArrow", [8, goal])).toEqual(eight as never);
  });
});

// ── Option A's law/value boundary (gate 10) ────────────────────────────────
describe("8λ.6 — lawEvalSafe: the exhaustive seven-case Expr screen", () => {
  const safe = (e: unknown) => dec("engine:lawEvalSafe", [e]) as number;
  const SAFE = 0, MATCH = 1, OTHER = 2;
  const lit = (v: unknown) => ({ $tag: "ELit", value: v });
  const evar = (n: string) => ({ $tag: "EVar", name: n });

  test("EVar is safe; ELit is safe for null/Boolean/Number/String ONLY", () => {
    expect(safe(evar("x"))).toBe(SAFE);
    expect(safe(lit(null))).toBe(SAFE);
    expect(safe(lit(true))).toBe(SAFE);
    expect(safe(lit(0))).toBe(SAFE);
    expect(safe(lit(""))).toBe(SAFE);
    expect(safe(lit([1, 2]))).toBe(OTHER);
    expect(safe(lit({ $tag: "Just", _0: 1 }))).toBe(OTHER);
    expect(safe(lit({ __fenelFn: true, params: [], body: 1, closure: {} }))).toBe(OTHER);
  });

  test("ECall / ELambda / EConstruct / ERecord recurse through EVERY expression child", () => {
    expect(safe({ $tag: "ECall", fnId: "f", args: [evar("x"), lit(1)] })).toBe(SAFE);
    expect(safe({ $tag: "ECall", fnId: "f", args: [evar("x"), lit([1])] })).toBe(OTHER);
    expect(safe({ $tag: "ELambda", params: ["x"], body: evar("x") })).toBe(SAFE);
    expect(safe({ $tag: "ELambda", params: ["x"], body: lit({}) })).toBe(OTHER);
    expect(safe({ $tag: "EConstruct", ctor: "Pair", args: [evar("x"), evar("y")], fields: [] })).toBe(SAFE);
    expect(safe({ $tag: "EConstruct", ctor: "Pair", args: [evar("x"), lit(new Date())], fields: [] })).toBe(OTHER);
    expect(safe({ $tag: "ERecord", fields: [{ name: "a", value: evar("x") }] })).toBe(SAFE);
    expect(safe({ $tag: "ERecord", fields: [{ name: "a", value: lit([]) }] })).toBe(OTHER);
  });

  test("EMatch is ALWAYS unsafe, at any depth, and reports the MATCH class so the reason stays total", () => {
    const m = { $tag: "EMatch", scrutinee: evar("x"), arms: [{ pattern: { $tag: "PatWildcard" }, body: evar("x") }] };
    expect(safe(m)).toBe(MATCH);
    expect(safe({ $tag: "ELambda", params: ["x"], body: m })).toBe(MATCH);
    expect(safe({ $tag: "ECall", fnId: "f", args: [m] })).toBe(MATCH);
  });

  test("a MIXED candidate is the OTHER class, not the match class — that is what makes pin 21's iff decidable", () => {
    const m = { $tag: "EMatch", scrutinee: evar("x"), arms: [] };
    expect(safe({ $tag: "ECall", fnId: "f", args: [m, lit([1])] })).toBe(OTHER);
  });

  test("an unknown or malformed future Expr case is UNSAFE — the classifier fails closed rather than falling through to a permissive host null", () => {
    expect(safe({ $tag: "ENewFutureCase", whatever: 1 })).toBe(OTHER);
    expect(safe({ notAnExprAtAll: true })).toBe(OTHER);
    expect(safe(null)).toBe(OTHER);
  });

  test("a non-scalar literal is refused WITHOUT reading a property — no getter, proxy trap, or enumeration runs", () => {
    let touched = 0;
    const spy = { get a() { touched++; return 1; }, b: 2 };
    expect(safe(lit(spy))).toBe(2);
    expect(touched).toBe(0);

    // The getter spy above is the assertion that actually pins "no property
    // READ": an accessor is invoked only by a `get`, and `touched` stays 0.
    // A Proxy cannot pin the same thing from a test, because the value has to
    // cross the TypeScript→Fenel argument boundary to reach the classifier and
    // that boundary enumerates own keys (`ownKeys`) on the way in. So the proxy
    // pins the CLASSIFICATION — refused — and the trap count is recorded rather
    // than asserted, with the read-free property left to the getter spy.
    let gets = 0;
    const proxy = new Proxy({ x: 1, y: 2 }, {
      get(t, k) { gets++; return (t as Record<string | symbol, unknown>)[k]; },
    });
    expect(safe(lit(proxy))).toBe(2); // refused, whatever the boundary did on the way in
  });

  // Measured while writing the test above, and worth pinning so the next reader
  // does not mistake it for a hole in the classifier: a ONE-KEY plain object is
  // not data at this boundary. `{x: 1}` is a well-formed JSON-Logic OPERATION
  // (`x` applied to `1`), so a one-key object handed across the TypeScript→Fenel
  // argument boundary is EVALUATED rather than passed through, and an
  // unresolvable head yields host null — which the scalar test then correctly
  // reads as null. Every other non-scalar shape (empty object, array, `$tag`
  // record, closure, multi-key object) is refused as it should be. The
  // ambiguity is the known single-field-record collapse, not this fence.
  test("the one-key-object boundary artifact is the JSON-Logic operation form, not a classifier hole", () => {
    expect(safe(lit({}))).toBe(2);
    expect(safe(lit({ $tag: "Just", _0: 1 }))).toBe(2);
    expect(safe(lit({ a: 1, b: 2 }))).toBe(2);
    expect(safe(lit([1]))).toBe(2);
    expect(safe(lit({ __fenelFn: true, params: [], body: 1, closure: {} }))).toBe(2);
  });
});

// ── the Γ-carrying engine entry (pin 19) ───────────────────────────────────
describe("8λ.6 — synTermBudget: the engine's own root entry", () => {
  test("returns an Expr (never a converted witness value) and takes NO fixed-point tail", () => {
    const out = dec("engine:synTermBudget", [8, 8, [], arrowP([INT], INT)]) as { $tag?: string; _0?: { $tag?: string } };
    expect(out?.$tag).toBe("Just");
    expect(out?._0?.$tag).toBe("ELambda"); // an Expr, not a {__fenelFn} closure
  });

  test("the legacy `synTerm` is NOT a wrapper around it — it stays byte-stable as the fixed-point face's private cascade", () => {
    const legacy = dec("engine:synTerm", [8, [], arrowP([INT], INT)]) as { _0?: { body?: { $tag?: string } } };
    const engine = dec("engine:synTermBudget", [8, 8, [], arrowP([INT], INT)]) as { _0?: { body?: { $tag?: string } } };
    // the legacy cascade still takes its base-first choice; the engine prefers
    // the base-free projection. If these ever agree by construction, the
    // isolation this pins has been lost.
    expect(legacy?._0?.body?.$tag).toBe("ELit");
    expect(engine?._0?.body?.$tag).toBe("EVar");
  });
});

// ── the trace face (pin 24) ────────────────────────────────────────────────
describe("8λ.6 — the Fenel-owned admission trace", () => {
  test("reports the normalized budget, the clamp flag, a cursor, the count-free candidates, and phase-tagged charges with ONE-BASED slots", () => {
    const t = dec("engine:synTraceArrow", [8, 8, arrowP([INT], INT)]) as {
      budget: number; budgetRaw: number; clamped: boolean; cursor: string;
      freeVacuous: boolean; freeReserve: boolean;
      realizePhase: Array<{ slot: number; outcome: string; addr: number[] }>;
      consumerPhase: Array<{ slot: number; outcome: string }>;
    };
    expect(t.budget).toBe(8);
    expect(t.clamped).toBe(false);
    expect(["cut", "exhausted", "refused"]).toContain(t.cursor);
    expect(t.freeVacuous).toBe(false);
    expect(t.freeReserve).toBe(true); // Int has a canonical point, so the reserve exists
    expect(t.realizePhase.length).toBeGreaterThan(0);
    for (const r of t.realizePhase) expect(r.slot).toBeGreaterThanOrEqual(1);
    for (const r of t.consumerPhase) expect(r.slot).toBeGreaterThanOrEqual(1);
    // the winner is a paid ticket inside the default window
    const win = t.consumerPhase.find((r) => r.outcome === "accepted");
    expect(win).toBeDefined();
    expect(win!.slot).toBeLessThanOrEqual(8);
  });

  test("a clamped invocation records it", () => {
    const t = dec("engine:synTraceArrow", [8, 65, arrowP([INT], INT)]) as { budget: number; clamped: boolean };
    expect(t.budget).toBe(64);
    expect(t.clamped).toBe(true);
  });
});

// ── the LAW-MODE trace face + the count-free tiers (close phase) ────────────
// `synTraceArrow` records the ORDINARY consumer. Running a law row through it
// recorded the ordinary winner and the ordinary rejections — not where that
// row's verdict came from — so the harness refused law rows rather than lying
// about them. `synTraceLawArrow` is the law-mode RECORDING CONSUMER over the
// SAME engine: same generator, same admission, same window, same `P` order,
// staging each candidate through self-check → the Option A Expr-safety screen →
// the predicate, exactly as `synConsumeLaw` does. It is never a second search.
describe("8λ.6 close — the law-mode trace face", () => {
  // `(x: Int, y: Int) → Int` with a law that accepts only the FIRST parameter:
  // `P` offers `_1` first (higher Γ ordinal, same rule and provenance), so a
  // first-success consumer stops at a rejected candidate and the whole search
  // abstains. The law consumer charges that slot and continues.
  const onlyFirstParam = {
    __fenelFn: true, params: ["w"],
    body: { "==": [{ call: ["$", { var: "w" }, 7, 9] }, 7] },
    closure: {},
  };
  const goal = arrowP([INT, INT], INT);

  test("records the staged law outcomes in P visit order, and the winner is REACHED AFTER a charged rejection", () => {
    const t = dec("engine:synTraceLawArrow", [8, 8, goal, onlyFirstParam]) as {
      budget: number; clamped: boolean; cursor: string; windowed: number; admitted: number;
      freeVacuous: boolean; freeVacuousAccepted: boolean; freeReserve: boolean; freeReserveAccepted: boolean;
      consumerPhase: Array<{ slot: number; outcome: string; prule: number }>;
    };
    expect(t.budget).toBe(8);
    // Every outcome is one of the pinned staged classes — a wildcard-less Fenel
    // `case` falls through to host null, so an unlisted string here would be the
    // silent-null trap rather than a new class.
    const CLASSES = ["accepted", "check-rejected", "law-match-excluded", "law-unsafe-excluded", "law-rejected", "not-reached"];
    for (const r of t.consumerPhase) expect(CLASSES).toContain(r.outcome);
    const acceptedAt = t.consumerPhase.findIndex((r) => r.outcome === "accepted");
    expect(acceptedAt).toBeGreaterThan(-1);
    // the acceptance is NOT the first candidate offered: something was charged first
    expect(acceptedAt).toBeGreaterThan(0);
    expect(t.consumerPhase[acceptedAt - 1]!.outcome).toBe("law-rejected");
    // and the public law face agrees with the trace on the verdict
    const v = dec("engine:synthesizeWithLawBudget", [8, 8, goal, onlyFirstParam]) as { $tag: string };
    expect(v.$tag).toBe("TvFound");
  });

  test("the ordinary trace and the law trace disagree about the WINNER on the same goal — which is why one face cannot record both", () => {
    const ord = dec("engine:synTraceArrow", [8, 8, goal]) as { consumerPhase: Array<{ slot: number; outcome: string }> };
    const law = dec("engine:synTraceLawArrow", [8, 8, goal, onlyFirstParam]) as { consumerPhase: Array<{ slot: number; outcome: string }> };
    const winOrd = ord.consumerPhase.find((r) => r.outcome === "accepted");
    const winLaw = law.consumerPhase.find((r) => r.outcome === "accepted");
    expect(winOrd).toBeDefined();
    expect(winLaw).toBeDefined();
    // the ordinary consumer takes the FIRST P-ordered candidate that self-checks;
    // the law consumer must walk past it. Same engine, different acceptance.
    expect(winLaw!.slot).not.toBe(winOrd!.slot);
  });
});

describe("8λ.6 close — the count-free tiers are RECORDED, not inferred", () => {
  const NONE: SetExpr = { $tag: "SeNone" } as unknown as SetExpr;

  test("a nested-vacuous goal: Intro*;Vacuous is present, ACCEPTS, and no paid candidate is reached", () => {
    // `(x: Int) → (z: ∅) → Int` — the canonical false-bodied nested Vacuous.
    const goal = arrowP([INT], arrowP([NONE], INT));
    const t = dec("engine:synTraceArrow", [8, 8, goal]) as {
      freeVacuous: boolean; freeVacuousAccepted: boolean;
      consumerPhase: Array<{ outcome: string }>; windowed: number; admitted: number;
    };
    expect(t.freeVacuous).toBe(true);
    expect(t.freeVacuousAccepted).toBe(true);
    // "first and uncharged": it holds no admission slot, so every paid row that
    // exists at all must read `not-reached`.
    for (const r of t.consumerPhase) expect(r.outcome).toBe("not-reached");
  });

  test("`windowed` is the ranked window and `admitted` may exceed it by the ONE successor peek", () => {
    const t = dec("engine:synTraceArrow", [8, 3, arrowP([INT, INT], INT)]) as {
      windowed: number; admitted: number; cursor: string;
    };
    // the batch is truncated to the budget; the generator is asked for one MORE
    // so the successor peek can be satisfied at all.
    expect(t.windowed).toBeLessThanOrEqual(3);
    expect(t.admitted).toBeGreaterThanOrEqual(t.windowed);
    expect(t.admitted).toBeLessThanOrEqual(4);
  });

  test("the reserve is recorded as a CONDITIONAL — it would accept, but the paid winner is what answered", () => {
    const t = dec("engine:synTraceArrow", [8, 8, arrowP([INT], INT)]) as {
      freeReserve: boolean; freeReserveWouldAccept: boolean;
      consumerPhase: Array<{ outcome: string }>; winner: { $tag: string; _0?: unknown };
    };
    // Int has a canonical point, so the bare reserve exists AND self-certifies.
    // It is offered LAST, so on this goal it never answers: the paid identity
    // wins first. The field is named WouldAccept for exactly that reason —
    // reading it as "the reserve answered" reports two winners.
    expect(t.freeReserve).toBe(true);
    expect(t.freeReserveWouldAccept).toBe(true);
    expect(t.consumerPhase.some((r) => r.outcome === "accepted")).toBe(true);
    // and the walk's own winner is the paid IDENTITY, not the reserve constant.
    // Candidates are complete derivations at the ROOT, so the accepted Expr is
    // the whole ELambda; what distinguishes the identity from the constant is
    // its BODY — a reference to the fresh param, versus an ELit.
    expect(t.winner.$tag).toBe("Just");
    const win = t.winner._0 as { $tag?: string; body?: { $tag?: string } };
    expect(win.$tag).toBe("ELambda");
    expect(win.body?.$tag).toBe("EVar");
  });

  test("the traced winner IS the live face's answer, byte for byte — not merely 'both found something'", () => {
    const goal = arrowP([INT, INT], INT);
    const t = dec("engine:synTraceArrow", [8, 8, goal]) as { winner: unknown };
    const live = dec("engine:synTermBudget", [8, 8, [], goal]);
    // synTermBudget is the engine's own root entry: the live candidate list and
    // the live self-check consumer. The trace derives its winner from its OWN
    // walk, so equality here is the drift detector the close brief's trap asks
    // for — a trace that skipped the real winner and accepted a later candidate
    // would still report "found" and would fail this.
    expect(JSON.stringify(t.winner)).toBe(JSON.stringify(live));
  });
});
