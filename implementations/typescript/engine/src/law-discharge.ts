// ---------------------------------------------------------------------------
// Law discharge — the audit-side `proveMissing` hook for `validateSpecRecord`.
// expr-substrate Phase 6a (hook) + 6b0 (the Fenel port — brief:
// `workstreams/expr-substrate/briefs/phase-6b0-prover-fenel-port.md`) + 6c
// (the sample-iteration arm — brief:
// `workstreams/expr-substrate/briefs/phase-6c-law-tail-discharge.md`).
//
// The audit's decidable representation-presence / enum-membership laws are
// DECIDED from data the instance already carries; a kernel-accepted
// `SolverChecked` round-trip discharges. After 6b0 the hook is PLUMBING:
// every policy step is a Fenel body —
//   classify   → `engine:lawProposition`   (6a — the 5-row table)
//   propose    → `decidableSetProposerNative` (routing/grading Fenel-bodied
//                via `engine:proposeDecidableSet`; the enum decide is the
//                set-algebra bridge)
//   verify     → `verify` (kernel rules Fenel-bodied via `engine:verifyProof`)
//   grade      → `engine:dischargeGrade`   (which combinations discharge /
//                refute / fall through + the refutation message)
//   ∃-locale   → `engine:firstNonEmptyString` (the LocaleString selection
//                walk — probe-5: std `entries` exists; only the typeof
//                classification stays here)
//
// Phase 6c adds the SAMPLE-ITERATION arm for the sample-bearing law families
// (Aggregable / Iso / Lens / Migration / DecidableMembership / Compilable /
// Evaluator): the spec-record law field maps onto the law decl the class
// already carries (`engine:sampleLawSpec`, the field→law table); the bridge
// resolves the decl's forall samples (inline, or typed bindings through
// `Exemplifiable<instance-arg>`), iterates the property expression over the
// sample grid (host evaluator re-entry — the justified bridge), and an
// all-pass outcome claims a SampleTestResult the kernel re-checks
// (PropForall rule ⇒ `SampleTested n`). Grade policy + messages are Fenel
// (`engine:sampleLawGrade`): a failing sample REFUTES (a finding); a thrown
// sample is honest non-evidence (a crash is not a counterexample); zero
// samples cannot claim.
//
// TS-residue ledger (6b0 + 6c — every surviving fn, categorised):
//   projectValue        — typeof classification (string / object / nullish)
//     + Object.values string-filter: host-typeof boundary; the ∃-selection
//     POLICY is the Fenel walk.
//   peelLawEnumSet / peelLawJudgment — the judgment claim's canonical `$tag`
//     SeEnum leaves peeled + value-projected (decide-substrate Phase 2 K3: the
//     producers emit `JEmpty (SeIntersect [(¬)t, s])` — the one lattice
//     judgment — and the proposer + kernel consume it DIRECTLY via the shared
//     Fenel shape recognizer `engine:recheckPlan`; the K2 back-map that
//     recovered Prop* tags here is DEAD. This peel only value-projects the
//     enum leaves — the LocaleString ∃-projection, value-level not shape-level).
//   getSampleLawHarness — lazy system-registry + EvaluateContext resolve
//     (host registry bridge; lazy to keep load order safe — only the audit
//     and its tests ever construct this).
//   resolveForallSamples — law-decl sample read + the typed-binding →
//     `Exemplifiable<args[i]>` registry resolve (host registry bridge).
//   cartesian / safeJson — sample-grid mechanics + counterexample
//     stringification for the Fenel-built message (host JSON boundary).
//   dischargeSampleLaw  — the per-sample property EVALUATION loop (host
//     evaluator re-entry — the sanctioned bridge) + the PropForall /
//     SampleTestResult kernel round-trip; pass/fail/vacuous POLICY is the
//     Fenel `engine:sampleLawGrade`.
//   gatherSubjectFnIds / subjectTotalityForLaw — unified-static-analysis
//     Phase 3h: the totality-gate subject gather (the `$`-keyed property AST
//     walk + the dynamic-key `methods` lookup — category-B seam) feeding the
//     shipped 3g `subjectTotalityVerdict` per fnId; the conservative-meet
//     DECISION is the Fenel `engine:joinVerdict`. The joined verdict threads
//     into the `dischargeSampleLaw` `verify(...)` call, engaging the kernel
//     gate on the production law-discharge path.
//   buildProveMissingHook — the hook closure: dispatch plumbing + the
//     mutable stats tally (host callback surface for validateSpecRecord) +
//     marker→ProveMissingOutcome mapping. `hookFor(instance)` threads the
//     instance args the typed-forall resolve needs (Iso); the bare `hook`
//     stays for arg-less callers (6a tests).
//
// NOTHING is persisted — proofs are recomputable. The hook is audit-only:
// construction-time callers never pass it, so `validateSpecRecord` stays
// byte-identical there.
// ---------------------------------------------------------------------------

// browser-engine-compat Phase 1b: browser-safe lazy module lookup (was require())
import { engineRequire } from "./engine-require";
import { GLOBAL_ONLY, type InstanceVisibility } from "./dispatch-registry";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { decidableSetProposerNative } from "./modules/prover";
import { verify, subjectTotalityVerdict, type Judgment } from "./kernel";
import { functionRefHandle } from "./type-foundation";
import { evidenceSolverChecked, evidenceSampleTested } from "./law-validation";
import type { ProveMissingHook, ProveMissingOutcome } from "./law-validation";
import type { ProofTerm } from "./prover";
import { propForall, sampleTestProof } from "./prover";
import type { SetExpr, FenelType } from "./types";
import type { EvaluateContext } from "./json-logic";
import { resolveEvaluator } from "./evaluator-class";

/** Mutable tally the audit reads after the spec-record walk. */
export type DischargeStats = {
  /** Laws discharged by a kernel-accepted `SolverChecked` round-trip. */
  discharged: number;
  /** Laws discharged by a kernel-accepted `SampleTested` round-trip (6c). */
  sampleTested: number;
  /** Laws refuted (a genuinely empty / out-of-set value, or a failing
   *  sample combination) — the wanted failure mode, distinct from missing. */
  refuted: number;
};

// --- WitSet-marker → SetExpr unmarshal (the boundary a Fenel body can't cross) ---

/** Project one marker value to its comparable `$enum` element. Plain strings
 *  pass through; a LocaleString object projects to ∃ a non-empty locale value
 *  via the Fenel selection walk (`engine:firstNonEmptyString` — the law's
 *  ∃-semantics live there; this leaf only does the typeof classification +
 *  string-filter); an all-empty object / missing value collapses to `""`
 *  (⇒ refuted vs `{""}`). Census 2026-06-11: 0 objects at HEAD — the object
 *  arm is defensive (the spec types `label: LocaleString`). */
function projectValue(v: unknown): unknown {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const stringVals = Object.values(v as Record<string, unknown>).filter(
      (lv): lv is string => typeof lv === "string",
    );
    return dispatchEngineBody("engine:firstNonEmptyString", [stringVals]);
  }
  if (v === undefined || v === null) return "";
  return v;
}

/** The law markers' set payloads are the CANONICAL `$tag` `SeEnum` SetExpr
 *  (decide-substrate Phase 1 Stage F — the plain-record `WsEnum` marker rode
 *  the retired Ws vocabulary). This peel just verifies the SeEnum shape and
 *  re-emits it with `projectValue`-cleaned values (the LocaleString
 *  ∃-projection is value-level, not shape-level). */
function peelLawEnumSet(w: unknown): SetExpr | undefined {
  if (!w || typeof w !== "object") return undefined;
  const m = w as { $tag?: string; values?: unknown[] };
  if (m.$tag !== "SeEnum" || !Array.isArray(m.values)) return undefined;
  return { $tag: "SeEnum", values: m.values.map(projectValue) };
}

/** The `JEmpty set` judgment the law producers emit (decide-substrate Phase 2
 *  K2): `nonEmptyProp` / `membershipProp` (law-discharge.fenel) speak the one
 *  lattice judgment via the kernel's iso builders (`jopDisjoint` /
 *  `jopSubset`). The payload rides the POSITIONAL `_0` field (the `construct`
 *  op keys positional constructor application as `_0`, not the declared `s`). */
type JudgmentMarker = { $tag?: string; _0?: unknown };
type ComposedSet = { $tag?: string; branches?: unknown[]; inner?: unknown };

/** Value-project a law judgment's enum leaves (decide-substrate Phase 2, K3 —
 *  the K2 back-map is DEAD: the proposer + kernel now consume the judgment
 *  DIRECTLY via the shared shape recognizer `engine:recheckPlan`). The law
 *  producers emit `JEmpty (SeIntersect [t, s])` (disjoint) / `JEmpty
 *  (SeIntersect [SeComplement t, s])` (subset) with `SeEnum` leaves (`s` LAST
 *  — the `appendItem` snoc); this peel verifies that 2-branch shape and
 *  re-emits it with `projectValue`-cleaned enum values (the LocaleString
 *  ∃-projection is value-level, not shape-level — exactly what
 *  `peelLawEnumSet` did per side pre-K3). An unexpected shape ⇒ `undefined`
 *  (the law stays missing — the pre-K3 failure mode). */
function peelLawJudgment(marker: unknown): Judgment | undefined {
  if (!marker || typeof marker !== "object") return undefined;
  const m = marker as JudgmentMarker;
  // The law path emits only the JEmpty polarity (disjoint / subset); the
  // out-of-table sentinel (`{ tag = "None" }`) and any other shape fall through.
  if (m.$tag !== "JEmpty") return undefined;
  const set = m._0 as ComposedSet | undefined;
  if (
    !set ||
    set.$tag !== "SeIntersect" ||
    !Array.isArray(set.branches) ||
    set.branches.length !== 2
  ) {
    return undefined;
  }
  const projected: SetExpr[] = [];
  for (const b of set.branches) {
    const cb = b as ComposedSet;
    if (cb && cb.$tag === "SeComplement") {
      const inner = peelLawEnumSet(cb.inner);
      if (!inner) return undefined;
      projected.push({ $tag: "SeComplement", inner });
    } else {
      const leaf = peelLawEnumSet(b);
      if (!leaf) return undefined;
      projected.push(leaf);
    }
  }
  return {
    $tag: "JEmpty",
    _0: { $tag: "SeIntersect", branches: projected },
  };
}

// ---------------------------------------------------------------------------
// Phase 6c — the sample-iteration arm.
// ---------------------------------------------------------------------------

/** The law-decl shapes the bridge reads off the spec registry's class decls. */
type LawForallEntry = { name: string; samples?: unknown[]; type?: string };
type LawDecl = { name: string; forall?: LawForallEntry[]; property?: unknown };
type ClassDeclish = {
  params?: ReadonlyArray<{ name: string }>;
  laws?: ReadonlyArray<LawDecl>;
};
/** ⚠ rights R3a — a HAND-TYPED STRUCTURAL FACADE, and therefore a CENSUS
 *  target rather than something the compiler floor covers (Ruling 2). The third
 *  parameter is mirrored so a real `DispatchRegistry` still satisfies it. */
type SpecRegistryish = {
  getClass: (name: string) => ClassDeclish | undefined;
  resolve: (
    target: string,
    cls: string,
    visibility: InstanceVisibility,
  ) => Record<string, unknown> | undefined;
};

/** Lazy harness — the property expressions call typeclass-method fnIds
 *  (`set:contains`, `aggregable:preimageRoundtripCheck`, codec fnIds, …)
 *  that only the FULL system registry resolves; the engine-bodies harness
 *  (engine+std) is not enough. Lazy `require` keeps module-load order safe:
 *  only the audit + its tests ever construct this. */
let _sampleLawHarness: { dispatchRegistry: SpecRegistryish; ctx: EvaluateContext } | null = null;

function getSampleLawHarness(): { dispatchRegistry: SpecRegistryish; ctx: EvaluateContext } {
  if (_sampleLawHarness === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { dispatchRegistry } = engineRequire("system-entities") as { dispatchRegistry: SpecRegistryish };
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { getSystemRegistry } = engineRequire("system-registry") as {
      getSystemRegistry: () => { evaluateContext: () => EvaluateContext };
    };
    _sampleLawHarness = { dispatchRegistry, ctx: getSystemRegistry().evaluateContext() };
  }
  return _sampleLawHarness;
}

/** Resolve one forall binding's sample list: inline `samples` verbatim, or a
 *  typed binding (`type: "a"`) through the class params → instance args →
 *  `Exemplifiable<typeName>.examples` chain. `undefined` = unresolvable
 *  (no samples / no Exemplifiable / typed binding without instance args) —
 *  the law stays missing (honest non-evidence; the kernel's
 *  `samplesChecked > 0` guard would reject a zero-sample claim anyway). */
function resolveForallSamples(
  cls: ClassDeclish | undefined,
  instArgs: ReadonlyArray<unknown> | undefined,
  fe: LawForallEntry,
): unknown[] | undefined {
  if (Array.isArray(fe.samples)) return fe.samples;
  if (typeof fe.type === "string") {
    const idx = cls?.params?.findIndex((p) => p.name === fe.type) ?? -1;
    const typeName = idx >= 0 ? instArgs?.[idx] : undefined;
    if (typeof typeName !== "string") return undefined;
    // rights R3a — GLOBAL_ONLY. Law discharge runs over the REPOSITORY's
    // registered classes and their boot `Exemplifiable` samples; it has no
    // frame and no account, and an account-authored example steering which
    // witnesses a law is discharged against is precisely a thing to fence.
    const ex = getSampleLawHarness().dispatchRegistry.resolve(
      typeName, "Exemplifiable", GLOBAL_ONLY,
    );
    const examples = ex?.["examples"];
    return Array.isArray(examples) && examples.length > 0 ? examples : undefined;
  }
  return undefined;
}

/** Cartesian product of the per-binding sample lists (the multi-binding
 *  walk — DM's (s, t, x) grid; single-binding families degenerate to a map;
 *  forall-less families (Migration) to one empty combo). */
function cartesian(lists: unknown[][]): unknown[][] {
  return lists.reduce<unknown[][]>(
    (acc, list) => acc.flatMap((c) => list.map((v) => [...c, v])),
    [[]],
  );
}

/** Bounded JSON for the counterexample fragment of the Fenel-built message. */
function safeJson(v: unknown, cap: number): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > cap ? `${s.slice(0, cap)}…` : s;
}

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 3h — the totality-gate subject join.
//
// 3g shipped the kernel gate + `subjectTotalityVerdict` but left it INERT on
// the production path (`dischargeSampleLaw` called `verify` 2-arg). 3h gathers
// the discharging INSTANCE's subject method fnIds the law's `property` names
// (route a — D-subject-set), resolves each to a totality verdict via the
// shipped `subjectTotalityVerdict`, folds them through the Fenel
// `engine:joinVerdict` meet, and threads the result into `verify`. The DECISION
// (the conservative meet) is the Fenel body; the property-AST walk + the host
// record lookup below are the category-B `$`-key seam — a `.fenel` body cannot
// recurse past the property's `$tag`/`$bind` shapes nor do the dynamic-key
// `methods` lookup. (D-wiring-locus — the only new TS, restated for the
// new-TS gate; pre-authorized in the 3h brief as the 3g boundary extension.)
// ---------------------------------------------------------------------------

/** Walk the law `property`'s JSON-Logic AST collecting every `{var: name}` in
 *  CALL POSITION — a direct element (head or argument) of a `{call: [...]}`
 *  node — then keep the names whose `methods[name]` is a non-empty string fnId
 *  (route a, "call-participant" refinement — D-subject-set as-settled).
 *
 *  modules-as-values: a method field may instead hold a `{$ref: handle}`
 *  function reference. Its handle (an own-data read, `functionRefHandle`) is a
 *  subject exactly like the same function's id string: `subjectTotalityVerdict`
 *  resolves any handle and keys on the canonical id, and a handle that resolves
 *  to nothing is Unknown. Dropping a reference would read Total and let the
 *  gate stop biting. A value wrapped in a constructor (Migration's
 *  `backward = Just …`) is neither form and stays out of the subject set, as
 *  before; Migration's own conversion decides that verdict change.
 *
 *  Call-position-only is the soundness discipline: a method INVOKED
 *  (`{call: [{var:"encode"}, …]}` — Iso/Lens) or FED to an invocation
 *  (`{call: ["migration:roundtripCheck", {var:"forward"}, …]}` — the HOF
 *  law-harnesses of Migration/Compilable) is a genuine functional subject; a
 *  string-valued DATA field referenced in a comparison node
 *  (`{deepEq: [{var:"label"}, …]}`, `{"===": [{var:"eval"}, …]}`) is NOT —
 *  catching it would spuriously resolve a label/strategy-tag string to no
 *  function ⇒ a WRONG Unknown ⇒ false-reject (the `label` hazard the brief
 *  flags). Non-string method fields (`monotonicity` = a constructor), forall
 *  bindings, and `$bind` match-vars are dropped by the `methods`-string filter
 *  (the latter two never appear in `methods`). Literal-string call heads (the
 *  generic dispatchers / `@native` harnesses — `set:contains`,
 *  `aggregable:preimageRoundtripCheck`, …) are NOT collected: trusted-`@native`
 *  Total by policy, and several do not resolve under `getSystemRegistry`
 *  (D-unresolvable). The net production subject set: Iso encode/decode, Lens
 *  view/put, Migration forward/backward, Compilable compile — all trusted
 *  natives / census-Total ⇒ 0 flips. */
function gatherSubjectFnIds(property: unknown, methods: Record<string, unknown>): string[] {
  const names = new Set<string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const e of n) walk(e);
      return;
    }
    if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      const call = o["call"];
      if (Array.isArray(call)) {
        for (const el of call) {
          if (el && typeof el === "object" && !Array.isArray(el)) {
            const v = (el as Record<string, unknown>)["var"];
            if (typeof v === "string" && v.length > 0) names.add(v);
          }
        }
      }
      for (const k of Object.keys(o)) walk(o[k]);
    }
  };
  walk(property);
  const fnIds: string[] = [];
  for (const name of names) {
    const handle = functionRefHandle(methods[name]) ?? justReferenceHandle(methods[name]);
    if (handle !== undefined && handle.length > 0) fnIds.push(handle);
  }
  return fnIds;
}

/** modules-as-values Phase 2d — a `Just` whose payload is a function
 *  REFERENCE (`{$tag:"Just", _0:{$ref}}`, e.g. Migration's `backward`) is a
 *  subject too: the law applies that function. Own data properties only. A
 *  Just holding a string stays data (a `Maybe String` field is not a
 *  function), so it is not a subject. */
function justReferenceHandle(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const tag = Object.getOwnPropertyDescriptor(value, "$tag");
  if (tag === undefined || !("value" in tag) || tag.value !== "Just") return undefined;
  const payload = Object.getOwnPropertyDescriptor(value, "_0");
  if (payload === undefined || !("value" in payload)) return undefined;
  const inner: unknown = payload.value;
  return typeof inner === "string" ? undefined : functionRefHandle(inner);
}

/** The discharging instance's conservative-join totality verdict for the law
 *  `property`'s subject methods (Phase 3h). Gathers the subject fnIds (route a),
 *  resolves each via the shipped 3g `subjectTotalityVerdict`, and folds through
 *  the Fenel `engine:joinVerdict` meet. An empty subject set folds to "Total"
 *  (the gate proceeds). Exported for the gate's bites-case test. */
export function subjectTotalityForLaw(
  property: unknown,
  methods: Record<string, unknown>,
): string {
  const verdicts = gatherSubjectFnIds(property, methods).map((id) => subjectTotalityVerdict(id));
  return dispatchEngineBody("engine:joinVerdict", [verdicts]) as string;
}

/** The 6c discharge: resolve the law decl, iterate the property over the
 *  sample grid (host evaluator re-entry), grade via the Fenel policy, and
 *  on an all-pass claim run the kernel SampleTestResult round-trip — now
 *  GATED on the discharging instance's subject totality verdict (Phase 3h). */
function dischargeSampleLaw(
  typeName: string,
  lawName: string,
  fieldName: string,
  methods: Record<string, unknown>,
  instArgs: ReadonlyArray<unknown> | undefined,
  stats: DischargeStats,
): ProveMissingOutcome | undefined {
  const h = getSampleLawHarness();
  const cls = h.dispatchRegistry.getClass(typeName);
  const law = cls?.laws?.find((l) => l.name === lawName);
  if (!law || law.property === undefined) return undefined;

  const forall = law.forall ?? [];
  const lists: Array<{ name: string; vals: unknown[] }> = [];
  for (const fe of forall) {
    const vals = resolveForallSamples(cls, instArgs, fe);
    if (vals === undefined) return undefined; // unresolvable binding ⇒ stays missing
    lists.push({ name: fe.name, vals });
  }
  const combos = lists.length === 0 ? [[]] : cartesian(lists.map((b) => b.vals));

  let passes = 0;
  let fails = 0;
  let threws = 0;
  let firstCounterexample: Record<string, unknown> | undefined;
  for (const combo of combos) {
    const env: Record<string, unknown> = { ...methods };
    lists.forEach((b, i) => {
      env[b.name] = combo[i];
    });
    let r: unknown;
    try {
      // Phase-11 discipline: resolve the in-scope Evaluator strategy rather
      // than importing `evaluate` directly (no strategy frames exist on the
      // audit ctx today, so this is the eager fast path).
      r = resolveEvaluator(h.ctx)(law.property as Record<string, unknown>, env, h.ctx);
    } catch {
      threws++;
      continue;
    }
    if (r === true) {
      passes++;
    } else {
      fails++;
      if (firstCounterexample === undefined) {
        firstCounterexample = {};
        lists.forEach((b, i) => {
          firstCounterexample![b.name] = combo[i];
        });
      }
    }
  }

  const total = combos.length;
  const grade = dispatchEngineBody("engine:sampleLawGrade", [
    total,
    passes,
    fails,
    threws,
    fieldName,
    String(fails),
    String(total),
    firstCounterexample === undefined ? "" : safeJson(firstCounterexample, 200),
  ]) as { tag?: string; reason?: string };

  if (grade.tag === "Discharged") {
    // Kernel re-check — the trust boundary. The bridge's iteration claim is
    // untrusted; the kernel's PropForall/SampleTestResult rule validates the
    // claim's shape (propertyId match, allPassed, n > 0) and grades it
    // SampleTested (empirical evidence stays SampleTested, never Proven).
    const propertyId = `${typeName}.${lawName}`;
    const prop = propForall(
      { name: forall[0]?.name ?? "case", type: { $ref: "Any" } as FenelType },
      propertyId,
      combos,
    );
    const proof: ProofTerm = sampleTestProof(propertyId, total, true);
    // Phase 3h — ENGAGE the totality gate on the production path: thread the
    // discharging instance's conservative-join subject verdict so the kernel's
    // `vpSample` rule rejects a sample-tested `∀` over an Unknown/Partial
    // subject (Err NonTotal). Every shipped subject is a trusted `@native` or a
    // census-Total Fenel body ⇒ verdict "Total" ⇒ 0 production flips; forward
    // enforcement bites the day a non-total Fenel-bodied method lands.
    const verdict = subjectTotalityForLaw(law.property, methods);
    const vr = verify(prop, proof, { verdict });
    if (vr.$tag !== "Ok" || vr._0.$tag !== "SampleTested") return undefined;
    stats.sampleTested++;
    return { status: "discharged", evidence: evidenceSampleTested(total) };
  }
  if (grade.tag === "Refuted") {
    stats.refuted++;
    return { status: "refuted", reason: grade.reason ?? "" };
  }
  return undefined; // honest non-evidence ⇒ stays "missing"
}

// ---------------------------------------------------------------------------
// The hook.
// ---------------------------------------------------------------------------

/** Build the audit's `proveMissing` hook + its discharge tally. Plumbing
 *  only after 6b0/6c — classify / propose / verify / grade are Fenel bodies;
 *  the closures thread the chain, unmarshal at the `$`-key boundary, run the
 *  sample grid, and keep the stats tally. `hookFor(instance)` threads the
 *  instance args the typed-forall resolve needs (Iso); the bare `hook` is
 *  the arg-less form (6a behavior preserved — typed-forall laws stay
 *  missing without args). */
export function buildProveMissingHook(): {
  hook: ProveMissingHook;
  hookFor: (instance?: { args?: ReadonlyArray<unknown> }) => ProveMissingHook;
  stats: DischargeStats;
} {
  const stats: DischargeStats = { discharged: 0, sampleTested: 0, refuted: 0 };

  const hookFor =
    (instance?: { args?: ReadonlyArray<unknown> }): ProveMissingHook =>
    (fieldName, methods): ProveMissingOutcome | undefined => {
      // 1. Classify the field into a JUDGMENT claim (the 6a `.fenel` table —
      //    judgment-native since K2; the K2 back-map died at K3: the claim
      //    flows to the proposer + kernel DIRECTLY, both routing through the
      //    shared shape recognizer).
      const marker = dispatchEngineBody("engine:lawProposition", [fieldName, methods]);
      const claim = peelLawJudgment(marker);
      if (claim) {
        // 2. Propose — the decidable set procedure decides the law.
        const proposed = decidableSetProposerNative(claim) as {
          $tag: string;
          _0: { $tag?: string } | undefined;
        };

        // 3. Kernel re-check — the trust boundary. Only run when the proposer
        //    produced a term (the proposer is untrusted; the kernel re-verifies).
        const vr =
          proposed.$tag === "Ok" ? verify(claim, proposed._0 as unknown as ProofTerm) : undefined;
        const verifiedStatus = vr && vr.$tag === "Ok" ? vr._0.$tag : "";

        // 4. Grade — the discharge policy (`engine:dischargeGrade`).
        const grade = dispatchEngineBody("engine:dischargeGrade", [
          proposed.$tag,
          proposed.$tag === "Err" ? (proposed._0?.$tag ?? "") : "",
          verifiedStatus,
          fieldName,
        ]) as { tag?: string; reason?: string };

        if (grade.tag === "Discharged") {
          stats.discharged++;
          return { status: "discharged", evidence: evidenceSolverChecked };
        }
        if (grade.tag === "Refuted") {
          stats.refuted++;
          return { status: "refuted", reason: grade.reason ?? "" };
        }
        return undefined; // honest non-evidence ⇒ stays "missing"
      }

      // 5. The 6c sample-iteration arm (out-of-table for 6a's classifier).
      const spec = dispatchEngineBody("engine:sampleLawSpec", [fieldName]) as {
        tag?: string;
        typeName?: string;
        law?: string;
      };
      if (spec.tag !== "SampleLaw" || !spec.typeName || !spec.law) return undefined;
      return dischargeSampleLaw(spec.typeName, spec.law, fieldName, methods, instance?.args, stats);
    };

  return { hook: hookFor(undefined), hookFor, stats };
}
