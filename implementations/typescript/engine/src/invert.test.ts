// unified-static-analysis Phase 3b-2 — BYTE-PARITY tests for the backward-
// propagation (`invert`) port. Brief:
// `workstreams/unified-static-analysis/briefs/phase-3b-2-invert-backward-transfer.md`.
//
// Under test: `invert` / `invertConfidence` (invert.ts) — the thin marshal
// seams over the Fenel `engine:invert` / `engine:invertConfidence` bodies.
// The retained enum fragment stays byte-equal to the pre-port oracle. The
// oracle intentionally re-pins interval branches to SeAll: numeric interval
// membership now admits exact integer records, while raw arithmetic coerces
// those records to zero. Scalar endpoint inverses would exclude real solutions.
// Arithmetic confidence also abstains: its API omits the desired output, so it
// cannot distinguish the retained enum inverse from an interval-output miss.

import { describe, it, expect } from "vitest";
import { invert, invertConfidence } from "./invert";
import { contains, normalize } from "./set-algebra";
import { evaluate } from "./json-logic";
import { dispatchEngineBody, harnessForTests } from "./engine-bodies-dispatch";
import { Just, Nothing } from "./type-foundation";
import type { SetExpr } from "./types";
import { isSetExpr } from "./types";
// set-algebra-to-fenel Phase 3b-2 — the producer flip changed the OUTPUT FORM
// (`$`-key → `$tag`) but not the inference LOGIC. `canonZero` folds the migrating
// `$tag` SetExpr form back to `$`-key so the byte-parity vs the (verbatim
// pre-port) oracle stays a LOGIC check, form-agnostic. A real structural/value
// regression still fails (setExprToDollarKey only rewrites the discriminator,
// never the structure or payloads). The sanctioned mechanical test-oracle re-pin.
import { peelSetExpr, setExprToDollarKey } from "./set-marker";

// ===========================================================================
// Retained pre-port enum logic, with intentional interval/confidence fence pins.
// ===========================================================================

function oSolveArith(op: string, output: number, known: number, unknownIdx: 0 | 1): number | undefined {
  if (unknownIdx === 0) {
    switch (op) {
      case "+": return output - known;
      case "-": return output + known;
      case "*": return known === 0 ? undefined : output / known;
      case "/": return output * known;
      case "%": return undefined;
      default: return undefined;
    }
  } else {
    switch (op) {
      case "+": return output - known;
      case "-": return known - output;
      case "*": return known === 0 ? undefined : output / known;
      case "/": return output === 0 ? undefined : known / output;
      case "%": return undefined;
      default: return undefined;
    }
  }
}
function oInvertEnum(op: string, outputEnum: unknown[], knownEnum: unknown[], unknownIdx: 0 | 1): SetExpr {
  const results = new Set<unknown>();
  for (const o of outputEnum) {
    if (typeof o !== "number") continue;
    for (const k of knownEnum) {
      if (typeof k !== "number") continue;
      const v = oSolveArith(op, o, k, unknownIdx);
      if (v !== undefined && Number.isFinite(v)) results.add(v);
    }
  }
  return results.size ? { $tag: "SeEnum", values: [...results] } : { $tag: "SeNone" };
}
function oInvert(op: string, output: SetExpr, inputs: SetExpr[], unknownIdx: number): SetExpr {
  if (inputs.length !== 2) return { $tag: "SeAll" };
  if (unknownIdx !== 0 && unknownIdx !== 1) return { $tag: "SeAll" };
  const knownIdx = unknownIdx === 0 ? 1 : 0;
  const known = inputs[knownIdx]!;
  const idx = unknownIdx as 0 | 1;
  const outputView = peelSetExpr(output);
  const knownView = peelSetExpr(known);
  if (outputView?.kind === "SeNone" || knownView?.kind === "SeNone") return { $tag: "SeNone" };
  if (outputView?.kind === "SeAll") return { $tag: "SeAll" };
  if (outputView?.kind === "SeUnion") {
    return normalize({ $tag: "SeUnion", branches: outputView.branches.map((s) => oInvert(op, s, inputs, unknownIdx)) });
  }
  if (knownView?.kind === "SeUnion") {
    const withKnown = (k: SetExpr): SetExpr[] => {
      const inp = [...inputs];
      inp[knownIdx] = k;
      return inp;
    };
    return normalize({ $tag: "SeUnion", branches: knownView.branches.map((k) => oInvert(op, output, withKnown(k), unknownIdx)) });
  }
  // Intentional interval-carrier admission fence, independent of endpoint shape.
  if (outputView?.kind === "SeInterval" || knownView?.kind === "SeInterval") return { $tag: "SeAll" };
  if (outputView?.kind === "SeEnum" && knownView?.kind === "SeEnum") {
    return normalize(oInvertEnum(op, outputView.values, knownView.values, idx));
  }
  return { $tag: "SeAll" };
}
function oHasInterval(known: SetExpr): boolean {
  const view = peelSetExpr(known);
  return view?.kind === "SeInterval" || (view?.kind === "SeUnion" && view.branches.some(oHasInterval));
}
function oInvertConfidence(op: string, inputs: SetExpr[], unknownIdx: number): "exact" | "approximate" | "unavailable" {
  if (inputs.length !== 2) return "unavailable";
  if (unknownIdx !== 0 && unknownIdx !== 1) return "unavailable";
  if (op === "%" || op === "cat") return "unavailable";
  // Desired output is absent: even a native enum known can have an interval
  // output whose inverse must abstain. Keep computation, withhold precision.
  if (["+", "-", "*", "/"].includes(op)) return "unavailable";
  const known = inputs[unknownIdx === 0 ? 1 : 0]!;
  const knownView = peelSetExpr(known);
  if (knownView?.kind === "SeAll") return "unavailable";
  if (oHasInterval(known)) return "unavailable";
  if (knownView?.kind === "SeUnion") return "approximate";
  return "unavailable";
}

// ===========================================================================
// Corpus builders
// ===========================================================================

const S = (...vs: unknown[]): SetExpr => ({ $tag: "SeEnum", values: vs });
const ivl = (lo: number | null, hi: number | null, loInc = true, hiInc = true): SetExpr => ({ $tag: "SeInterval", interval: {
    lo: lo === null ? Nothing : Just({ value: lo, inclusive: loInc }),
    hi: hi === null ? Nothing : Just({ value: hi, inclusive: hiInc }),
  } });
const W: SetExpr = { $where: { ">": [{ var: "value" }, 0] } } as unknown as SetExpr;

// Canonicalize IEEE signed zero (−0 → +0) deeply. The legacy TS leaks −0 into a
// division-corner bound value (`finite / -Infinity = -0`); the Fenel port
// produces +0 — the runtime has ONE zero (`num x = Number x || 0` collapses −0).
// −0 === 0, so this is a semantically-invisible JS-repr artifact, not a real
// divergence; canonicalizing both sides keeps the rest of the comparison
// byte-exact. (See invert.fenel's SIGNED ZERO header note.)
function canonZero(x: unknown): unknown {
  if (typeof x === "number") return Object.is(x, -0) ? 0 : x;
  if (Array.isArray(x)) return x.map(canonZero);
  if (x && typeof x === "object") {
    // 3b-2 — fold the migrating `$tag` SetExpr form back to `$`-key first, so
    // both the (`$tag`) seam output and the (`$`-key) oracle output compare
    // equal on the LOGIC. Then continue the −0 canonicalization into payloads.
    const sx = isSetExpr(x) ? setExprToDollarKey(x as SetExpr) : x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sx as object)) out[k] = canonZero(v);
    return out;
  }
  return x;
}

// ===========================================================================
// Stage 1 — BYTE-PARITY: the seam `invert` === the pre-port oracle
// ===========================================================================

type Case = [string, string, SetExpr, SetExpr[], number];

const CORPUS: Case[] = [];
for (const op of ["+", "-", "*", "/", "%"]) {
  for (const idx of [0, 1]) {
    const out = ivl(2, 8);
    CORPUS.push(
      [`${op}: interval ÷ interval (idx ${idx})`, op, out, [ivl(1, 3), ivl(1, 3)], idx],
      [`${op}: interval ÷ interval neg known (idx ${idx})`, op, out, [ivl(-4, -1), ivl(-4, -1)], idx],
      [`${op}: interval ÷ interval (unbounded-hi known, idx ${idx})`, op, out, [ivl(2, null), ivl(2, null)], idx],
      [`${op}: interval ÷ interval (unbounded-lo known, idx ${idx})`, op, out, [ivl(null, -2), ivl(null, -2)], idx],
      [`${op}: interval ÷ interval (unbounded output, idx ${idx})`, op, ivl(null, 8), [ivl(1, 3), ivl(1, 3)], idx],
      [`${op}: interval ÷ interval (exclusive bounds, idx ${idx})`, op, ivl(2, 8, false, false), [ivl(1, 3, false, true), ivl(1, 3, false, true)], idx],
      [`${op}: straddle-zero known (idx ${idx})`, op, out, [ivl(-1, 1), ivl(-1, 1)], idx],
      [`${op}: inclusive-zero-lo known (idx ${idx})`, op, out, [ivl(0, 3), ivl(0, 3)], idx],
      [`${op}: inclusive-zero-hi known (idx ${idx})`, op, out, [ivl(-3, 0), ivl(-3, 0)], idx],
      [`${op}: exclusive-zero-lo known (idx ${idx})`, op, out, [ivl(0, 3, false, true), ivl(0, 3, false, true)], idx],
      [`${op}: straddle-zero output / (idx ${idx})`, op, ivl(-2, 4), [ivl(1, 3), ivl(1, 3)], idx],
      [`${op}: inclusive-zero output / (idx ${idx})`, op, ivl(0, 4), [ivl(1, 3), ivl(1, 3)], idx],
      [`${op}: enum ÷ enum (idx ${idx})`, op, S(2, 6, 12), [S(2, 3), S(2, 3)], idx],
      [`${op}: enum ÷ enum (÷0 known, idx ${idx})`, op, S(2, 6), [S(0, 2), S(0, 2)], idx],
      [`${op}: enum ÷ enum (zero output, idx ${idx})`, op, S(0, 6), [S(2, 3), S(2, 3)], idx],
      [`${op}: enum ÷ enum (dup collapse, idx ${idx})`, op, S(4, 4, 8), [S(2), S(2)], idx],
      [`${op}: enum-output × interval-known ⇒ all (idx ${idx})`, op, S(2, 6), [ivl(1, 3), ivl(1, 3)], idx],
      [`${op}: interval-output × enum-known distribute (idx ${idx})`, op, ivl(2, 8), [S(1, 2), S(1, 2)], idx],
      [`${op}: interval-output × enum-known (÷0 in known, idx ${idx})`, op, ivl(2, 8), [S(0, 2), S(0, 2)], idx],
      [`${op}: $union output distribute (idx ${idx})`, op, { $tag: "SeUnion", branches: [ivl(2, 4), ivl(6, 8)] }, [ivl(1, 2), ivl(1, 2)], idx],
      [`${op}: $union known distribute / withKnown (idx ${idx})`, op, ivl(2, 8), [{ $tag: "SeUnion", branches: [ivl(1, 2), ivl(3, 4)] }, { $tag: "SeUnion", branches: [ivl(1, 2), ivl(3, 4)] }], idx],
      [`${op}: $union known enum distribute (idx ${idx})`, op, S(2, 6), [{ $tag: "SeUnion", branches: [S(2), S(3)] }, { $tag: "SeUnion", branches: [S(2), S(3)] }], idx],
      [`${op}: $all output ⇒ all (idx ${idx})`, op, { $tag: "SeAll" }, [ivl(1, 3), ivl(1, 3)], idx],
      [`${op}: $all known (idx ${idx})`, op, ivl(2, 8), [{ $tag: "SeAll" }, { $tag: "SeAll" }], idx],
      [`${op}: $none output absorb (idx ${idx})`, op, { $tag: "SeNone" }, [ivl(1, 3), ivl(1, 3)], idx],
      [`${op}: $none known absorb (idx ${idx})`, op, ivl(2, 8), [{ $tag: "SeNone" }, { $tag: "SeNone" }], idx],
      [`${op}: $where opaque known (idx ${idx})`, op, ivl(2, 8), [W, W], idx],
      [`${op}: named known ⇒ all (idx ${idx})`, op, ivl(2, 8), [{ $tag: "SeRef", handle: "ℤ" }, { $tag: "SeRef", handle: "ℤ" }], idx],
    );
  }
}
// Arity / bad-idx guards (idx-independent).
CORPUS.push(
  ["guard: non-binary (1 input) ⇒ all", "+", ivl(2, 8), [ivl(1, 3)], 0],
  ["guard: non-binary (3 inputs) ⇒ all", "+", ivl(2, 8), [ivl(1, 3), ivl(1, 3), ivl(1, 3)], 0],
  ["guard: bad unknownIdx (2) ⇒ all", "+", ivl(2, 8), [ivl(1, 3), ivl(1, 3)], 2],
  ["guard: bad unknownIdx (-1) ⇒ all", "+", ivl(2, 8), [ivl(1, 3), ivl(1, 3)], -1],
  ["op: uninvertible (cat) ⇒ all", "cat", ivl(2, 8), [ivl(1, 3), ivl(1, 3)], 0],
);

describe("invert — BYTE-PARITY with the pre-port oracle", () => {
  for (const [name, op, output, inputs, idx] of CORPUS) {
    it(name, () => {
      expect(canonZero(invert(op, output, inputs, idx))).toEqual(canonZero(oInvert(op, output, inputs, idx)));
    });
  }
});

// ===========================================================================
// Stage 2 — BYTE-PARITY: `invertConfidence` === the pre-port oracle
// ===========================================================================

const CONF_CORPUS: Case[] = [];
for (const op of ["+", "-", "*", "/", "%", "cat", ">"]) {
  for (const idx of [0, 1]) {
    CONF_CORPUS.push(
      [`conf ${op}: interval known (idx ${idx})`, op, ivl(2, 8), [ivl(1, 3), ivl(1, 3)], idx],
      [`conf ${op}: straddle-zero interval known (idx ${idx})`, op, ivl(2, 8), [ivl(-1, 1), ivl(-1, 1)], idx],
      [`conf ${op}: unbounded-lo interval known (idx ${idx})`, op, ivl(2, 8), [ivl(null, 3), ivl(null, 3)], idx],
      [`conf ${op}: enum known (idx ${idx})`, op, ivl(2, 8), [S(1, 2), S(1, 2)], idx],
      [`conf ${op}: enum-with-zero known (idx ${idx})`, op, ivl(2, 8), [S(0, 2), S(0, 2)], idx],
      [`conf ${op}: $union known (idx ${idx})`, op, ivl(2, 8), [{ $tag: "SeUnion", branches: [S(1), S(2)] }, { $tag: "SeUnion", branches: [S(1), S(2)] }], idx],
      [`conf ${op}: $all known (idx ${idx})`, op, ivl(2, 8), [{ $tag: "SeAll" }, { $tag: "SeAll" }], idx],
      [`conf ${op}: named known (idx ${idx})`, op, ivl(2, 8), [{ $tag: "SeRef", handle: "ℤ" }, { $tag: "SeRef", handle: "ℤ" }], idx],
    );
  }
}
CONF_CORPUS.push(
  ["conf guard: non-binary ⇒ unavailable", "+", ivl(2, 8), [ivl(1, 3)], 0],
  ["conf guard: bad unknownIdx ⇒ unavailable", "+", ivl(2, 8), [ivl(1, 3), ivl(1, 3)], 2],
);

describe("invertConfidence — BYTE-PARITY with the pre-port oracle", () => {
  for (const [name, op, , inputs, idx] of CONF_CORPUS) {
    it(name, () => {
      expect(invertConfidence(op, inputs, idx)).toEqual(oInvertConfidence(op, inputs, idx));
    });
  }
});

describe("invert — interval carrier admission fence", () => {
  const knownPoint = ivl(1, 1);
  const outputPoint = ivl(2, 2);
  // Small digit boxes are not admitted: the canonical carrier for a safe
  // integer is Number. Large boxes use a safe lower endpoint, no upper bound.
  const exactCarriers = [
    ["boxed Nat", { $tag: "Nat", digits: "9007199254740992" }, ivl(1, null)],
    ["boxed Int", { $tag: "Int", digits: "9007199254740992" }, ivl(1, null)],
    ["pure Nat", { $tag: "Succ", _0: { $tag: "Zero" } }, knownPoint],
    ["pure Int", { $tag: "Int", magnitude: { $tag: "Succ", _0: { $tag: "Zero" } }, negative: { $tag: "False" } }, knownPoint],
  ] as const;

  for (const [name, known, knownInterval] of exactCarriers) {
    it(`keeps the actual scalar solution when the known interval contains ${name}`, () => {
      // GLOBAL_ONLY: these concrete intervals have no named/account lookup.
      expect(contains(knownInterval, known, null)).toEqual(Just(true));
      expect(evaluate({ call: ["add", { var: "unknown" }, { var: "known" }] }, { unknown: 2, known }, harnessForTests().ctx)).toBe(2);
      const inferred = invert("+", outputPoint, [{ $tag: "SeAll" }, knownInterval], 0);
      expect(inferred).toEqual({ $tag: "SeAll" });
      expect(contains(inferred, 2, null)).toEqual(Just(true));
      expect(invertConfidence("+", [{ $tag: "SeAll" }, knownInterval], 0)).toBe("unavailable");
    });
  }

  it("abstains when a union contains an interval output or known branch", () => {
    const mixed: SetExpr = { $tag: "SeUnion", branches: [S(1), knownPoint] };
    const nested: SetExpr = { $tag: "SeUnion", branches: [S(1), mixed] };
    expect(invert("+", S(2), [{ $tag: "SeAll" }, mixed], 0)).toEqual({ $tag: "SeAll" });
    expect(invert("+", nested, [{ $tag: "SeAll" }, S(1)], 0)).toEqual({ $tag: "SeAll" });
    expect(invertConfidence("+", [{ $tag: "SeAll" }, nested], 0)).toBe("unavailable");
  });

  it("keeps direct interval inverse helpers behind the same admission fence", () => {
    expect(dispatchEngineBody("engine:invertIv", ["+", outputPoint, knownPoint, 0])).toEqual({ $tag: "SeAll" });
    expect(dispatchEngineBody("engine:invertMul", [outputPoint, knownPoint])).toEqual({ $tag: "SeAll" });
    expect(dispatchEngineBody("engine:invertDivRight", [outputPoint, knownPoint])).toEqual({ $tag: "SeAll" });
    expect(dispatchEngineBody("engine:invertIvEnumKnown", ["+", outputPoint, [1], 0])).toEqual({ $tag: "SeAll" });
  });

  it("keeps finite native-number enum inversion available", () => {
    expect(invert("+", S(6), [{ $tag: "SeAll" }, S(2)], 0)).toEqual(S(4));
    expect(invert("-", S(2), [{ $tag: "SeAll" }, S(3)], 0)).toEqual(S(5));
    expect(invert("-", S(2), [S(3), { $tag: "SeAll" }], 1)).toEqual(S(1));
    expect(invert("*", S(6), [{ $tag: "SeAll" }, S(2)], 0)).toEqual(S(3));
    expect(invert("/", S(3), [{ $tag: "SeAll" }, S(2)], 0)).toEqual(S(6));
    expect(invert("/", S(3), [S(6), { $tag: "SeAll" }], 1)).toEqual(S(2));
    expect(invertConfidence("+", [{ $tag: "SeAll" }, S(2)], 0)).toBe("unavailable");
  });

  it("withholds arithmetic confidence for native enums and their unions without a desired output", () => {
    const knownUnion: SetExpr = { $tag: "SeUnion", branches: [S(1), S(2)] };
    for (const op of ["+", "-", "*", "/"]) {
      expect(invertConfidence(op, [{ $tag: "SeAll" }, S(2)], 0)).toBe("unavailable");
      expect(invertConfidence(op, [{ $tag: "SeAll" }, knownUnion], 0)).toBe("unavailable");
      expect(dispatchEngineBody("engine:invertConfIvEnum", [op, S(2)])).toBe("unavailable");
    }
  });
});
