// ---------------------------------------------------------------------------
// Law validation — Verified-field evidence dispatch + spec-record walker
// (thin delegates over the Fenel-bodied logic).
//
// Phase 10a-5b retired the legacy `validateLaws` pass; the construction-time
// canonical surface is `validateSpecRecord(type, value)` + `validateVerified`.
// expr-substrate Phase 6b0 ported the LOGIC of both to
// `fenel/modules/engine/law-validate.fenel`:
//   - `engine:gradeEvidence`   — the Evidence-variant dispatch + every
//     reason string (validateVerified's body).
//   - `engine:specObligations` — the per-field walk: skip non-Verified,
//     the missing / prove-candidate split, malformed-evidence
//     classification, evidence grading (validateSpecRecord's body). Emits
//     an ORDERED outcome list this delegate replays, so the error list is
//     byte-identical to the original single walk — including the
//     prove-on-missing hook firing order (Phase 6a).
//
// What stays TS here, per the 6b0 residue ledger:
//   - `Evidence` / `LawValidationResult` / `SpecValidationError` /
//     `ProveMissing*` type mirrors + the evidence* constructors (TS-type
//     surface for engine consumers).
//   - `isVerifiedFieldType` — `$variant` READ leaf, AND the ONE recognizer
//     shared verbatim with effect-dispatch.ts's `isLawField` (Phase 7bc):
//     porting it would either fork the recognizer (a TS shadow) or make
//     `seedFromType` dispatch-dependent during registry bootstrap (a
//     getHarness re-entrancy cycle). It stays the single TS source.
//   - `specFieldsOf` — the `$record` / single-case-`$variant` field-list
//     READ ($-key boundary).
//   - `fieldFacts` — the typeof / `$`-key fact extraction the Fenel walk
//     branches on ($-key + host-typeof boundary).
//   - The marker → LawValidationResult / error-list mapping + the
//     proveMissing hook replay (the hook is a host callback; EpistemicStatus
//     stays TS-side output grading per the 6b Q1 lock).
//
// See `design/laws-and-proofs.md` Stage 10a for the dispatched-evidence
// design pass; `design/unified-dispatch.md` Phase 10a sub-step 3 for the
// `Evidence` ADT envelope.
// ---------------------------------------------------------------------------

import type { FenelType, FieldDef } from "./types";
import type { EpistemicStatus } from "./prover";
import {
  epistemicSolverChecked,
  epistemicSampleTested,
  epistemicUnknown,
  epistemicAssumed,
} from "./prover";
import { dispatchEngineBody } from "./engine-bodies-dispatch";

// ---------------------------------------------------------------------------
// Phase 10a sub-step 3 — `Evidence` envelope.
//
// `Evidence` is the Fenel-side ADT registered in `fenel/std/typeclass-specs.fenel`
// (see `system-entities.ts` Stage 1 loader). The TS shape mirrors the ADT:
//
//   Evidence = Axiom                              -- definitionally true; no checking
//            | SampleTested count: Nat            -- empirically checked over N samples
//            | SolverChecked                      -- a decidable procedure verified it
//            | KernelProven proof: String         -- fnId of a Fenel proof body
//                                                 -- (RESERVED: today's kernel doesn't
//                                                 --  reduction-check proof expressions)
// ---------------------------------------------------------------------------

/** Mirror of the Fenel-side `Evidence` ADT. */
export type Evidence =
  | { readonly $tag: "Axiom" }
  | { readonly $tag: "SampleTested"; readonly count: number }
  | { readonly $tag: "SolverChecked" }
  | { readonly $tag: "KernelProven"; readonly proof: string }
  // expr-substrate Phase 6b (Q1 arm A) — provenance of an un-re-checkable
  // external attestation (LLM / human / third-party tool). Graded Assumed.
  | { readonly $tag: "External"; readonly source: string };

/** Convenience constructors mirroring the Fenel-side variants. */
export const evidenceAxiom: Evidence = { $tag: "Axiom" };
export const evidenceSolverChecked: Evidence = { $tag: "SolverChecked" };
export function evidenceSampleTested(count: number): Evidence {
  return { $tag: "SampleTested", count };
}
export function evidenceKernelProven(proof: string): Evidence {
  return { $tag: "KernelProven", proof };
}
export function evidenceExternal(source: string): Evidence {
  return { $tag: "External", source };
}

/**
 * Result of validating one law against one instance.
 *
 * - `pass`        — the law holds for every checked combination.
 * - `fail`        — the law is violated.
 * - `uncheckable` — the property couldn't be evaluated.
 *
 * `epistemicStatus` grades the *kind* of evidence the law produced (see
 * `prover.ts`); the binary `status` field is retained for backward compat.
 */
export type LawValidationResult = {
  law: string;
  status: "pass" | "fail" | "uncheckable";
  reason?: string;
  /** For quantified failures: the variable bindings that produced the
   *  counterexample. Lets the user immediately see "for x = '...' the
   *  round-trip diverged". */
  counterexample?: Record<string, unknown>;
  /** Number of samples checked (quantified laws). 0 for closed-form. */
  samplesChecked?: number;
  /** Phase 4 — Curry-Howard epistemic-status grading. */
  epistemicStatus: EpistemicStatus;
};

/** Marker shape `engine:gradeEvidence` emits (plain record — the Fenel body
 *  cannot author `$tag` shapes; the `es` field names the status this
 *  delegate grades). */
type GradeMarker = {
  law: string;
  status: "pass" | "fail" | "uncheckable";
  es: "Assumed" | "SolverChecked" | "SampleTested" | "Unknown";
  reason?: string;
  samplesChecked?: number;
  hasSamples: boolean;
};

function epistemicOf(m: GradeMarker): EpistemicStatus {
  switch (m.es) {
    case "Assumed":
      return epistemicAssumed;
    case "SolverChecked":
      return epistemicSolverChecked;
    case "SampleTested":
      return epistemicSampleTested(m.samplesChecked as number);
    default:
      return epistemicUnknown;
  }
}

function gradeToResult(m: GradeMarker): LawValidationResult {
  const out: LawValidationResult = {
    law: m.law,
    status: m.status,
    epistemicStatus: epistemicOf(m),
  };
  if (m.reason !== undefined) out.reason = m.reason;
  if (m.hasSamples) out.samplesChecked = m.samplesChecked;
  return out;
}

/** Validate a single Verified value's evidence kind against its predicate.
 *  The Evidence-variant dispatch (and every reason string) is Fenel-bodied
 *  — `engine:gradeEvidence` in `law-validate.fenel`; this delegate extracts
 *  the `$tag`/count facts and reconstructs the exact LawValidationResult
 *  key set. The `predicate` is documentary today (KernelProven is reserved
 *  per the Phase 10a design pass). */
export function validateVerified(
  predicate: unknown,
  evidence: Evidence,
  lawName: string = "(verified)",
): LawValidationResult {
  void predicate; // reserved for future kernel-walk; see KernelProven in law-validate.fenel
  // $tag / count extraction (6b0 category: $-key read leaf).
  const tag = (evidence as { $tag?: unknown } | null | undefined)?.$tag;
  const evidenceTag = typeof tag === "string" ? tag : "";
  const count = (evidence as { count?: unknown } | null | undefined)?.count;
  const marker = dispatchEngineBody("engine:gradeEvidence", [
    evidenceTag,
    count,
    lawName,
  ]) as GradeMarker;
  return gradeToResult(marker);
}

// ---------------------------------------------------------------------------
// Phase 10a sub-step 4 — `validateSpecRecord` construction-time wiring.
//
// The runtime's `state.create_instance` / `state.try_create_instance`
// handlers call this just before the entity_instance row is written; the
// audit walks every spec instance through it. The walk LOGIC is the
// Fenel `engine:specObligations`; this delegate marshals the field facts,
// replays the ordered outcome list, and fires the proveMissing hook on the
// prove-candidates (Phase 6a — audit-only; construction-time callers pass
// no hook and the behavior is byte-identical to the pre-6a surface).
//
// Today's policy is **permissive**: any evidence graded `pass` is accepted,
// `uncheckable` (KernelProven, reserved) does not surface.
// ---------------------------------------------------------------------------

/** Per-field violation surfaced by `validateSpecRecord`. */
export type SpecValidationError = {
  /** The field name in the spec record that holds the failing Verified value. */
  field: string;
  /** Either the `validateVerified` reason or a synthesized message for
   *  structurally invalid Verified values (missing / wrong shape). */
  reason: string;
};

/** Outcome of a `proveMissing` attempt on a missing `Verified` field. */
export type ProveMissingOutcome =
  | { readonly status: "discharged"; readonly evidence: Evidence }
  | { readonly status: "refuted"; readonly reason: string };

/** Hook attempted when a `Verified T`-shaped field has no value. Returns an
 *  outcome (discharged / refuted) or `undefined` to fall through to today's
 *  "missing Verified value" error. `fieldName` is the law-field name (e.g.
 *  `"labelNonEmpty"`); `value` is the full instance methods record (the
 *  hook reads the sibling method — `methods.label` etc.). */
export type ProveMissingHook = (
  fieldName: string,
  value: Record<string, unknown>,
) => ProveMissingOutcome | undefined;

/** Recognize a `Verified T`-shaped field type. The Verified record type
 *  is registered in `fenel/std/typeclass-specs.fenel` as
 *  `Verified p = Verified predicate: p evidence: Evidence`; spec record
 *  fields holding laws use it via the parser-side canonical container:
 *  `Verified Boolean` lifts to a `$variant` with a single `Verified` case.
 *
 *  6b0 residue category: `$variant` READ leaf — AND the ONE recognizer
 *  shared with `effect-dispatch.ts`'s `isLawField` (Phase 7bc), so the
 *  dispatch-method set and the construction-time law validator can never
 *  disagree on which fields are laws. Porting it to a dispatched body
 *  would either fork the recognizer or cycle the registry bootstrap
 *  (seedFromType runs during createRegistry). */
export function isVerifiedFieldType(t: FenelType | undefined): boolean {
  if (!t || typeof t !== "object") return false;
  if (!("$variant" in t)) return false;
  const cases = (t as { $variant: { cases?: Array<{ name?: unknown }> } }).$variant.cases;
  if (!Array.isArray(cases) || cases.length !== 1) return false;
  return cases[0]?.name === "Verified";
}

/** Walk a spec record type and return its top-level fields. Handles two
 *  shapes the system-entities.ts loader emits:
 *    - `{$variant: {cases: [{name: "<X>Spec", fields: [...]}]}}` — the
 *      programmatic `typeclassToSpecRecord` form.
 *    - `{$record: {fields: [...]}}` — the hand-authored Fenel-side form.
 *  Returns `[]` for any other shape ("no Verified validation needed").
 *  6b0 residue category: `$record`/`$variant` READ leaf. */
function specFieldsOf(type: FenelType): FieldDef[] {
  if (!type || typeof type !== "object") return [];
  if ("$record" in type) {
    return type.$record.fields ?? [];
  }
  if ("$variant" in type) {
    const cases = type.$variant.cases ?? [];
    if (cases.length === 1) return cases[0]!.fields ?? [];
  }
  return [];
}

/** The marshalled per-field facts `engine:specObligations` branches on.
 *  6b0 residue category: typeof / `$`-key fact extraction leaf — the
 *  BRANCHING on these facts is the Fenel body's. */
function fieldFacts(field: FieldDef, value: Record<string, unknown>) {
  const fv = value[field.name];
  const fvIsObject = typeof fv === "object";
  const fvObj =
    fv && fvIsObject && !Array.isArray(fv) ? (fv as Record<string, unknown>) : undefined;
  const ev = fvObj?.evidence;
  const evTag = (ev as { $tag?: unknown } | null | undefined)?.$tag;
  return {
    name: field.name,
    verified: isVerifiedFieldType(field.type),
    valueFalsy: !fv,
    valueTypeofObject: fvIsObject,
    valueIsArray: Array.isArray(fv),
    valueIsUndefined: fv === undefined,
    typeofStr: fv === undefined ? "undefined" : typeof fv,
    evidencePresent: !!ev,
    evidenceTypeofObject: typeof ev === "object",
    evidenceTagIsString: typeof evTag === "string",
    evidenceTag: typeof evTag === "string" ? evTag : "",
    evidenceCount: (ev as { count?: unknown } | null | undefined)?.count,
  };
}

/** Outcome entries `engine:specObligations` emits (ordered). */
type ObligationEntry =
  | { outcome: "err"; field: string; reason: string }
  | { outcome: "prove"; field: string; missingReason: string };

/** Validate every `Verified T`-shaped field on a spec record value.
 *  Returns the list of per-field errors; empty on success. The walk logic
 *  is Fenel-bodied (`engine:specObligations`); this delegate replays the
 *  ordered outcome list — errors push in field order, prove-candidates fire
 *  the hook (discharged ⇒ no error; refuted ⇒ its reason; declined ⇒ the
 *  verbatim missing-value error). With `proveMissing` absent (every
 *  construction-time caller) the result is byte-identical to the
 *  pre-6a/pre-6b0 surface. */
export function validateSpecRecord(
  type: FenelType,
  value: Record<string, unknown>,
  proveMissing?: ProveMissingHook,
): SpecValidationError[] {
  const facts = specFieldsOf(type).map((f) => fieldFacts(f, value));
  if (facts.length === 0) return [];
  const entries = dispatchEngineBody("engine:specObligations", [
    facts,
    proveMissing !== undefined,
  ]) as ObligationEntry[];
  const errors: SpecValidationError[] = [];
  for (const e of entries) {
    if (e.outcome === "err") {
      errors.push({ field: e.field, reason: e.reason });
      continue;
    }
    // prove-candidate — Phase 6a's prove-on-missing branch.
    const outcome = proveMissing?.(e.field, value);
    if (outcome) {
      if (outcome.status === "discharged") continue; // law satisfied
      errors.push({ field: e.field, reason: outcome.reason }); // refuted
      continue;
    }
    errors.push({ field: e.field, reason: e.missingReason });
  }
  return errors;
}
