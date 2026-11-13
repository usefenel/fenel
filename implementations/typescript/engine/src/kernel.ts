// ---------------------------------------------------------------------------
// Kernel — the trust boundary (thin delegate over the Fenel-bodied rules).
//
// Phase 4 of the implementation roadmap built the kernel as a TS re-checker;
// expr-substrate Phase 6b0 ported the RULE LOGIC to
// `fenel/modules/engine/kernel.fenel` (`engine:verifyProof` + helpers). The
// de Bruijn criterion stands: a small, auditable re-checker — now authored
// in Fenel, the source-of-truth language — with every proposer untrusted by
// construction.
//
// API surface (unchanged):
//
//   verify(proposition, proof) : Result<VerifyError, EpistemicStatus>
//
// What stays TS here, per the 6b0 residue ledger (every line categorised):
//   - tagOf / the eqs pre-compute — host value classification: PropEq uses
//     Fenel value equality; anti-repurpose witnesses retain representation
//     deepEqual over the SetExpr carriers at the host boundary.
//   - decideByPlan / recheckPlanFor — the set-algebra re-run CALL
//     (isSubset / isDisjoint / decideEmpty) — a justified host re-entry
//     bridge; the TS set-algebra dispatchers themselves already route
//     through the Fenel `set-algebra-deciders.fenel` mirrors where ported,
//     so this is a marshalling hop into the dispatched decider substrate.
//     K3 (decide-substrate Phase 2): the claim-shape → decider ROUTING moved
//     to the Fenel `engine:recheckPlan` (ONE recognizer shared with the
//     proposer + the kernel rules); this seam keeps only the decide CALLS.
//     When the set-algebra top-level port lands (the 7b-continuation), the
//     calls flip to the Fenel deciders wholesale.
//   - markerToVerifyResult          — marker → `{$tag: …}` VerifyResult
//     construction + EpistemicStatus grading ($-key authoring boundary; the
//     6b Q1 lock keeps EpistemicStatus TS-side output grading).
//   - The `VerifyError` / `VerifyResult` type mirrors + ok/err helpers.
//
// The kernel knows three proof-term rules (Refl / DecidableSetResult /
// SampleTestResult — see kernel.fenel for the rule bodies). Each new rule
// grows the TCB; 6b's PropInhabited rule lands in the `.fenel` home.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import type { ProofTerm, Proposition, EpistemicStatus } from "./prover";
import {
  epistemicProven,
  epistemicSolverChecked,
  epistemicSampleTested,
} from "./prover";
import type { SetExpr } from "./types";
import { setExprToTag } from "./set-marker";
import {
  isSubset,
  isDisjoint,
  decideEmpty,
  isJustTrue,
  isJustFalse,
} from "./set-algebra";
import { deepEqual, structuralEq } from "./json-logic";
import { dispatchEngineBody, dispatchedJsonLogicToExpr } from "./engine-bodies-dispatch";
import type { FenelFunction } from "./types";

// ---------------------------------------------------------------------------
// VerifyError — why the kernel rejected a proof term
//
// Returned as the `Err` side of `verify`. Structured rather than free-form
// strings so callers (law-validator, debugger, audit script) can branch on
// the failure mode.
// ---------------------------------------------------------------------------

export type VerifyError =
  | {
      readonly $tag: "ShapeMismatch";
      /** Human-readable summary — "proof term shape doesn't fit proposition shape". */
      readonly reason: string;
      readonly propositionTag: string;
      readonly proofTag: string;
    }
  | {
      readonly $tag: "WitnessRejected";
      /** The proof term's claim didn't survive re-checking. */
      readonly reason: string;
    }
  | {
      readonly $tag: "UnknownRule";
      /** Proof term uses a constructor the kernel doesn't recognise (out of TCB). */
      readonly reason: string;
    }
  | {
      /** unified-static-analysis Phase 3g — THE SOUNDNESS GATE. The proof
       *  quantifies (a sample-tested `∀`) over a subject function whose totality
       *  verdict is `Unknown` or `Partial`; a universal proven by sampling a
       *  non-total function is unsound, so the kernel refuses it. */
      readonly $tag: "NonTotal";
      readonly reason: string;
    };

/** Convenience: wrap success/failure as a `Result`-shaped record. The
 *  kernel returns Result<VerifyError, EpistemicStatus> so callers can
 *  pattern-match uniformly. */
export type VerifyResult =
  | { readonly $tag: "Ok"; readonly _0: EpistemicStatus }
  | { readonly $tag: "Err"; readonly _0: VerifyError };

const ok = (status: EpistemicStatus): VerifyResult => ({ $tag: "Ok", _0: status });
const err = (e: VerifyError): VerifyResult => ({ $tag: "Err", _0: e });

// ---------------------------------------------------------------------------
// Boundary marshalling — `$tag` reads, deep-equality facts, the re-decide.
// ---------------------------------------------------------------------------

/** `$tag` extraction (6b0 category: `$`-key read leaf). Mirrors the TS
 *  original's `proof.$tag` interpolation semantics: a missing/non-string
 *  tag stringifies (`'undefined'` in the UnknownRule message). */
function tagOf(x: unknown): string {
  const t = (x as { $tag?: unknown } | null | undefined)?.$tag;
  return typeof t === "string" ? t : String(t);
}

/** The one lattice judgment as a TS mirror (decide-substrate Phase 2 K3) —
 *  the claim currency the producers emit since K2 (`JEmpty (SeIntersect …)` /
 *  `JInhabited s`). The payload rides the POSITIONAL `_0` field (the
 *  `construct` op keys positional constructor application as `_0`, not the
 *  declared field name). */
export type Judgment = {
  readonly $tag: "JEmpty" | "JInhabited";
  readonly _0: SetExpr;
};

/** The tri-precision re-check PLAN — the claim's recognized shape + the
 *  ORIGINAL (s, t), computed by the ONE Fenel recognizer
 *  (`engine:recheckPlan`, judgment.fenel). Kind selects the specialised
 *  decider; s/t feed both the decide call and the witness anti-repurpose. */
export type RecheckPlan = { kind: string; s?: unknown; t?: unknown };

/** Fetch the re-check plan from the shared Fenel recognizer (decide-substrate
 *  Phase 2 K3 — the tag→decider ROUTING moved out of this file's TS ladder
 *  into `engine:recheckPlan`; Prop* claims plan byte-identically to the
 *  retired ladder, judgment claims shape-recognize their composed set).
 *  Conservative on any failure: kind "other" (⇒ decision "unknown", eqs from
 *  the raw fields — the pre-K3 behaviour for unrecognized claims). */
export function recheckPlanFor(claim: unknown): RecheckPlan {
  try {
    const plan = dispatchEngineBody("engine:recheckPlan", [tagOf(claim), claim]) as RecheckPlan;
    return plan && typeof plan.kind === "string" ? plan : { kind: "other" };
  } catch {
    return { kind: "other" };
  }
}

/** The pre-computed structural-equality facts the Fenel rules branch on
 *  (6b0 category: deepEqual over `$`-keyed / arbitrary host values is a
 *  `$`-key-boundary operation — std `eq` is shallow on objects). K3: the
 *  witness sides compare against the PLAN's (s, t) — for Prop* claims these
 *  ARE the raw fields (byte-identical); for judgment claims they are the
 *  recognized originals extracted from the composed set (the witness
 *  anti-repurpose "compares against the ORIGINAL (s, t)"). */
function equalityFacts(proposition: unknown, proof: unknown, plan: RecheckPlan) {
  const p = (proposition ?? {}) as { lhs?: unknown; rhs?: unknown; s?: unknown; t?: unknown };
  const pr = (proof ?? {}) as { value?: unknown; witness?: { left?: unknown; right?: unknown } };
  const sRef = plan.s !== undefined ? plan.s : p.s;
  const tRef = plan.t !== undefined ? plan.t : p.t;
  return {
    // PropEq/Refl use the same value equality as enum singletons. The witness
    // anti-repurpose fields below intentionally keep representation equality.
    lhsRhs: structuralEq(p.lhs, p.rhs),
    lhsValue: structuralEq(p.lhs, pr.value),
    witnessLeft: deepEqual(sRef, pr.witness?.left),
    witnessRight: deepEqual(tRef, pr.witness?.right),
  };
}

/** The one-judgment kernel's TRI-PRECISION DISPATCH (decide-substrate Phase 2;
 *  design/deciding.md §3). The re-decide is keyed on the claim's RECOGNIZED
 *  shape (the plan from the shared Fenel recognizer) to the SPECIALISED
 *  decider — subset-shaped ⇒ `isSubset(s,t)`, disjoint-shaped ⇒ `isDisjoint`,
 *  empty/inhabited-shaped ⇒ `decideEmpty(s)` — and NEVER the naive
 *  `decideEmpty ∘ ∩ ∘ ¬` composition the judgment iso reads: the specialised
 *  trio decides MORE cases, so claim-shape dispatch is what preserves precision
 *  (the DischargeStats parity). K3: the shape comes from the plan (Prop* tags
 *  AND judgment composed-set recognition — one routing, Fenel-owned); this
 *  seam keeps ONLY the decide CALLS (6b0 category: justified host re-entry
 *  bridge; the set-algebra dispatchers route through the Fenel decider mirrors
 *  where ported.) Tri-state string: "true" | "false" | "unknown"; `catchValue`
 *  preserves the per-seam catch flavour (kernel "false", proposer "unknown"). */
export function decideByPlan(plan: RecheckPlan, catchValue: "false" | "unknown"): string {
  try {
    let outcome;
    if (plan.kind === "subset") outcome = isSubset(setExprToTag(plan.s), setExprToTag(plan.t));
    else if (plan.kind === "disjoint") outcome = isDisjoint(setExprToTag(plan.s), setExprToTag(plan.t));
    // empty + nonempty both re-decide via decideEmpty; the Fenel rule INVERTS
    // for the inhabited polarity (accepts Just false). The delegate passes the
    // RAW tri-state string either way.
    else if (plan.kind === "empty" || plan.kind === "nonempty") outcome = decideEmpty(setExprToTag(plan.s));
    else return "unknown";
    if (isJustTrue(outcome)) return "true";
    if (isJustFalse(outcome)) return "false";
    return "unknown";
  } catch {
    return catchValue;
  }
}

/** Outcome-marker → VerifyResult (6b0 category: `$`-key authoring boundary —
 *  a Fenel body cannot author `{$tag: …}` shapes; EpistemicStatus stays
 *  TS-side output grading per the 6b Q1 lock). */
function markerToVerifyResult(marker: unknown): VerifyResult {
  const m = marker as
    | {
        tag?: string;
        status?: string;
        samples?: number;
        etag?: string;
        reason?: string;
        propositionTag?: string;
        proofTag?: string;
      }
    | null
    | undefined;
  if (!m || typeof m !== "object") {
    throw new Error("kernel: engine:verifyProof returned no outcome marker");
  }
  if (m.tag === "Ok") {
    if (m.status === "Proven") return ok(epistemicProven);
    if (m.status === "SolverChecked") return ok(epistemicSolverChecked);
    if (m.status === "SampleTested") return ok(epistemicSampleTested(m.samples as number));
    throw new Error(`kernel: engine:verifyProof Ok marker with unknown status '${m.status}'`);
  }
  if (m.etag === "ShapeMismatch") {
    return err({
      $tag: "ShapeMismatch",
      reason: m.reason ?? "",
      propositionTag: m.propositionTag ?? "",
      proofTag: m.proofTag ?? "",
    });
  }
  if (m.etag === "WitnessRejected") {
    return err({ $tag: "WitnessRejected", reason: m.reason ?? "" });
  }
  if (m.etag === "NonTotal") {
    return err({ $tag: "NonTotal", reason: m.reason ?? "" });
  }
  return err({ $tag: "UnknownRule", reason: m.reason ?? "" });
}

// ---------------------------------------------------------------------------
// subjectTotalityVerdict — unified-static-analysis Phase 3g. The category-B
// host-registry + `$`-key marshal seam that feeds the kernel gate its
// pre-computed totality fact. EVERY analysis DECISION lives in Fenel
// (`engine:analyzeCallees` / `engine:verdictTagForIn` → `verdictTagFor` →
// `checkMutualTotality` / `totalityVerdict`); this seam does ONLY the three
// things a `.fenel` body cannot: (1) resolve the registry's stored JSON-Logic
// bodies, (2) lower each to core `Expr` (the `$`-key barrier — JSON-Logic keys
// ARE evaluator ops), and (3) BFS-bound the reachable call-graph closure so the
// analysis stays on the SUBJECT's small SCC rather than the whole registry (the
// interpreted census overflows the no-TCO host stack on the full engine graph —
// 3f surprise #2). The census-runner gather-host-data precedent. Any failure —
// unresolvable / unlowerable subject, BFS over the cap, a thrown lowering (the
// record is passed unanalyzable and refused in Fenel), a thrown or malformed
// callee discovery, a queued callee the registry cannot return (both fail
// closed since 2026-10-03), or an overflow inside `verdictTagForIn` — yields
// "Unknown" (the soundness-conservative
// default: reject the proof, surface the limit; NEVER a silent "Total"). The
// registry's id list goes to the Fenel projection with the gathered set, so a
// call head that names no registry function (a class method resolved by
// dispatch, a runtime-only host leaf) is refused there rather than read as a
// trusted sink (2026-10-03; extends this seam, approved by Rom 2026-10-03).
// ---------------------------------------------------------------------------

type AnalyzeFn = {
  id: string;
  params: string[];
  body: unknown;
  declaredPartial: boolean;
  analyzable: boolean;
  /** A bodyless function (native or host leaf), gathered so the Fenel
   *  projection decides whether it is a certified terminating leaf. */
  native?: boolean;
};

type KernelRegistryish = {
  getFunction: (nameOrId: string) => FenelFunction | undefined;
  listFunctions: (category?: string) => FenelFunction[];
};

let _kernelRegistry: KernelRegistryish | null = null;

/** Lazy system-registry resolve (host bridge; lazy to keep module-load order
 *  safe — only the gate path ever constructs this, exactly like
 *  law-discharge's `getSampleLawHarness`). */
function getKernelRegistry(): KernelRegistryish {
  if (_kernelRegistry === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { getSystemRegistry } = engineRequire("system-registry") as {
      getSystemRegistry: () => KernelRegistryish;
    };
    _kernelRegistry = getSystemRegistry();
  }
  return _kernelRegistry;
}

/** Result-shape readers — `jsonLogicToExpr` returns `Result CompileError Expr`
 *  (canonical positional `_0`); defensive about the slot name. */
function lowerIsOk(r: unknown): boolean {
  return typeof r === "object" && r !== null && (r as { $tag?: string }).$tag === "Ok";
}
function lowerOkValue(r: unknown): unknown {
  const o = r as Record<string, unknown>;
  return o._0 ?? o.value;
}

/** A function declared `@partial` — no first-class registry flag exists yet, so
 *  read any best-effort marker (mirrors the census runner). */
function declaredPartialOf(fn: FenelFunction): boolean {
  const f = fn as unknown as { partial?: boolean; declaredPartial?: boolean };
  return f.partial === true || f.declaredPartial === true;
}

/**
 * The SUBJECT function's totality verdict TAG ("Total" | "Unknown" | "Partial")
 * for the kernel gate. Resolves `subjectFnId` in the system registry, BFS-gathers
 * the reachable call-graph closure (lowering each stored body to core `Expr`;
 * a bodyless function becomes a `native` record), and dispatches the shipped
 * Fenel `engine:verdictTagForIn` over the gathered set and the registry's id
 * list — natives decided by certification, the transitive `verdictTagFor`
 * projection, and the refusal of any call head that names no registry id.
 * Conservative on any failure ("Unknown" — never a silent "Total").
 */
export function subjectTotalityVerdict(subjectFnId: string): string {
  // BFS reachable-set cap: keeps the analysis on the subject's SCC and is a
  // backstop against the no-TCO overflow on a dense graph (⇒ conservative
  // "Unknown" rather than a thrown census).
  const CAP = 600;
  try {
    const reg = getKernelRegistry();
    const subject = reg.getFunction(subjectFnId);
    // Genuine resolution failure (the id names no registered function) ⇒
    // "Unknown" (the soundness-conservative default — never a silent "Total").
    if (!subject) return "Unknown";
    // A BODYLESS subject or callee (a native or host leaf) is no longer assumed
    // to terminate here: it is gathered as a `native` record, and whether it is a
    // certified terminating leaf is Fenel data (`engine:verdictTagForIn`,
    // `anaCertifiedNativeLeaves`). A native that evaluates caller-supplied code
    // re-enters the evaluator and is not certified (2026-10-03; extends this
    // seam, approved by Rom 2026-10-03).
    const rootId = subject.id;
    const allIds = reg.listFunctions().map((f) => f.id);

    const gathered: AnalyzeFn[] = [];
    const visited = new Set<string>([rootId]);
    const queue: string[] = [rootId];
    while (queue.length > 0) {
      if (gathered.length > CAP) return "Unknown";
      const id = queue.shift() as string;
      const fn = reg.getFunction(id);
      // A queued callee with no registry function cannot be gathered: refuse
      // rather than let the Fenel side read the missing record as a sink.
      if (!fn) return "Unknown";
      if (fn.body === undefined || fn.body === null) {
        gathered.push({
          id: fn.id,
          params: (fn.params ?? []).map((p) => p.name),
          body: null,
          declaredPartial: declaredPartialOf(fn),
          analyzable: false,
          native: true,
        });
        continue;
      }
      let bodyExpr: unknown = null;
      let analyzable = false;
      let callees: string[] = [];
      try {
        const res = dispatchedJsonLogicToExpr(fn.body);
        if (lowerIsOk(res)) {
          bodyExpr = lowerOkValue(res);
          analyzable = true;
        }
      } catch {
        // unlowerable ⇒ analyzable stays false (the Fenel projection refuses
        // a reached record that did not lower)
      }
      if (analyzable) {
        // Callee discovery fails CLOSED (2026-10-03): a throw here propagates
        // to the outer catch ("Unknown"), and a malformed result is refused.
        // Before, a throw left the record analyzable with no callees, so the
        // callees were never gathered and a non-terminating one read as Total.
        const found = dispatchEngineBody("engine:analyzeCallees", [bodyExpr, allIds]);
        if (!Array.isArray(found)) return "Unknown";
        callees = found as string[];
      }
      gathered.push({
        id: fn.id,
        params: (fn.params ?? []).map((p) => p.name),
        body: bodyExpr,
        declaredPartial: declaredPartialOf(fn),
        analyzable,
      });
      for (const c of callees) {
        if (!visited.has(c)) {
          visited.add(c);
          queue.push(c);
        }
      }
    }

    const tag = dispatchEngineBody("engine:verdictTagForIn", [rootId, gathered, allIds]) as string;
    return tag === "Total" || tag === "Partial" ? tag : "Unknown";
  } catch {
    return "Unknown";
  }
}

// ---------------------------------------------------------------------------
// verify — the kernel entry point (delegate)
// ---------------------------------------------------------------------------

/** unified-static-analysis Phase 3g — the subject-function totality fact for
 *  the kernel gate. Either a PRE-COMPUTED `verdict` tag ("Total" | "Unknown" |
 *  "Partial" — the eqs/decision precedent: a fact the caller already holds) OR
 *  a `fnId` the delegate resolves via the shipped Fenel analyze
 *  (`subjectTotalityVerdict`). Omitted entirely (the existing 2-arg callers, and
 *  any proof that names no Fenel-function subject) ⇒ the gate is inert. */
export type SubjectTotality = { readonly verdict?: string; readonly fnId?: string };

/**
 * Re-check `proof` against a claim. Returns `Ok status` when the proof term
 * is well-formed *and* its claim survives re-checking; `Err` with a
 * structured `VerifyError` otherwise.
 *
 * The claim is EITHER a closed-sum `Proposition` (the compat presentation —
 * retires at K4) OR a `Judgment` (`JEmpty`/`JInhabited` — the judgment-native
 * currency the producers emit since decide-substrate Phase 2 K2/K3). Both
 * route through the shared Fenel recognizer (`engine:recheckPlan`) for the
 * tri-precision decide + the witness anti-repurpose facts.
 *
 * The rule bodies live in `fenel/modules/engine/kernel.fenel`
 * (`engine:verifyProof` — Refl / DecidableSetResult (Prop* + judgment arms) /
 * SampleTestResult); this delegate marshals the `$tag`s + equality facts +
 * the re-decide across the boundary and maps the outcome marker back.
 *
 * Phase 3g adds the totality GATE: when `subject` is supplied and the proof is
 * a `SampleTestResult`, the delegate threads the subject function's totality
 * verdict TAG (pre-computed or resolved via `subjectTotalityVerdict`) as a 7th
 * pre-computed fact; the kernel's `vpSample` rule REJECTS an "Unknown"/"Partial"
 * subject with `Err NonTotal` (a sample-tested `∀` over a non-total function is
 * unsound). No subject (or a non-SampleTestResult proof) ⇒ verdict "" ⇒ the gate
 * is inert (the existing kernel behaviour, byte-identical).
 */
export function verify(
  proposition: Proposition | Judgment,
  proof: ProofTerm,
  subject?: SubjectTotality,
): VerifyResult {
  const propTag = tagOf(proposition);
  const proofTag = tagOf(proof);
  const plan = recheckPlanFor(proposition);
  const eqs = equalityFacts(proposition, proof, plan);
  const decision = proofTag === "DecidableSetResult" ? decideByPlan(plan, "false") : "unknown";
  // The gate is SampleTestResult-only (D-3g-2). For every other proof term the
  // verdict is "" and `vpSample` is never reached — the gate is inert.
  let verdict = "";
  if (proofTag === "SampleTestResult" && subject) {
    if (typeof subject.verdict === "string") verdict = subject.verdict;
    else if (typeof subject.fnId === "string") verdict = subjectTotalityVerdict(subject.fnId);
  }
  const marker = dispatchEngineBody("engine:verifyProof", [
    propTag,
    proofTag,
    proposition,
    proof,
    eqs,
    decision,
    verdict,
  ]);
  return markerToVerifyResult(marker);
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("kernel") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_kernel from "./kernel";
import { registerEngineModule as __reg_kernel } from "./engine-require";
__reg_kernel("kernel", __self_kernel);
