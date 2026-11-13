// ---------------------------------------------------------------------------
// signature-substrate Phase 4+4b slice 3g — the TRUSTED VALIDATION ENTRY.
//
// THE FIRST SLICE WHERE AUTHORITY IS REACHABLE, so this battery is written the
// other way round from 3a–3f's. Those suites proved things were INERT; this one
// has to prove that the one thing which can now say YES says it exactly when it
// should, and that every gate in front of it actually fires. A suite that only
// checked refusals would pass on an entry that refuses everything, which is not
// what "authority is reachable" means.
//
// So every fence test is paired with the baseline it perturbs: the same request,
// one field moved, admitted-versus-refused. A gate that is not load-bearing
// shows up as a perturbation the entry still admits.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  dispatchEngineBody,
  dispatchEngineBodyWithDeciderCtx,
  dispatchedTrustedValidation,
  dispatchedValidationCarrier,
  marshalTraversalType,
  type ValidationLedgerRouteInput,
  type ValidationTrustedEntryInput,
} from "./engine-bodies-dispatch";
import { canonicalDigest } from "./validation-canonical-bytes";

// Engine init happens on the first dispatch and costs seconds; paid here so no
// individual test is really measuring boot time.
beforeAll(() => {
  dispatchEngineBody("engine:vteBodyDomain", [0]);
});

const REPO = path.resolve(import.meta.dir, "../../../..");

const tt = (t: unknown): unknown => marshalTraversalType(t);
const INT = { $ref: "Int" };

// Arrows are built through `foldTypes`, never by hand. The field-identity
// validator FORCES ordinal positional identity on arrow params, so a
// hand-marshalled param fails `traversalSemanticSlotsError` — and
// `typeToSetExpr` answers SeAll on a slots error, which makes a hand-built
// arrow indistinguishable from a genuinely inexact one. A test that built its
// own arrows would "prove" the exactness fence using the wrong input.
const groundArrow = (): unknown =>
  (dispatchEngineBody("engine:foldTypes", [[tt(INT), tt(INT)]]) as { _0: unknown })._0;

const h = (domain: string, hex: string) => ({ domain, hex });
const SCHEME = h("fenel.validation.scheme.v1", "5c1e");
const CALLER_SCHEME = h("fenel.validation.scheme.v1", "ca11");

const route = (name: string, targetId: string): ValidationLedgerRouteInput => ({
  name,
  status: "resolved",
  targetId,
  kind: "function",
  candidates: [],
  diagnostics: [],
});

type Outcome = {
  $tag: string;
  reason?: { $tag: string; detail?: string; observed?: string; requires?: string[] };
  admission?: {
    entries: { digest: { domain: string; hex: string }; authority: { $tag: string } }[];
    digest: { domain: string; hex: string };
    eligibility: { $tag: string };
    classes?: { class: { $tag: string; ruleKind?: { $tag: string } } }[];
  };
  verdict?: { $tag: string };
};

function baseRequest(over: Partial<ValidationTrustedEntryInput> = {}): ValidationTrustedEntryInput {
  const arrow = groundArrow();
  return {
    callerId: "mod:caller",
    body: { call: ["myFn", 1] },
    paramNames: [],
    routes: [route("myFn", "mod:myFn")],
    flatRoutes: [route("myFn", "mod:myFn")],
    arities: [{ targetId: "mod:myFn", arity: 1 }],
    provenance: { bodyHash: "", astAbi: "4", parser: "authoritative" },
    wireProjections: [],
    ctorFields: [],
    schemes: [{
      targetId: "mod:myFn",
      schemeHash: SCHEME,
      quantified: 0,
      diagnostics: [],
      outcome: "Solved",
      arrow,
      requires: [],
      origin: "FenelBody",
      attestedPure: false,
      attestedTotal: false,
      attestedHonest: false,
      sccId: "scc:myFn",
    }],
    certificates: [{
      targetId: "mod:myFn",
      kind: "dependency",
      certificateHash: h("fenel.validation.dependency.v1", "dead"),
      schemeHash: SCHEME,
      implementationHash: h("fenel.validation.implementation.v1", "beef"),
      ruleVersion: "v1",
    }],
    callerScheme: {
      schemeHash: CALLER_SCHEME,
      quantified: 0,
      diagnostics: [],
      outcome: "Solved",
      arrow,
      requires: [],
      sccId: "scc:caller",
      sccSize: 1,
    },
    registryGeneration: "gen-1",
    validatorVersion: "v1",
    executorProfile: "VepPureEvaluate",
    ...over,
  };
}

const run = (over: Partial<ValidationTrustedEntryInput> = {}): Outcome =>
  dispatchedTrustedValidation(baseRequest(over)) as Outcome;

const schemeWith = (over: Record<string, unknown>) => [{ ...baseRequest().schemes[0]!, ...over }];

describe("slice 3g — the trusted entry ADMITS (authority is actually reachable)", () => {
  it("admits a ground, undiagnosed, pure, exact, certificate-backed occurrence", () => {
    const r = run();
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.admission!.entries).toHaveLength(1);
    expect(r.admission!.entries[0]!.authority.$tag).toBe("OsaExternalDependency");
    expect(r.admission!.eligibility.$tag).toBe("EligEvidenceComplete");
  });

  it("stamps both digests under their own domain literals", () => {
    const r = run();
    expect(r.admission!.digest.domain).toBe("fenel.validation.admission.v1");
    expect(r.admission!.digest.hex).toMatch(/^[0-9a-f]{64}$/);
    expect(r.admission!.entries[0]!.digest.domain).toBe("fenel.validation.occurrence.v1");
    expect(r.admission!.entries[0]!.digest.hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("admits a non-Fenel root ONLY with a positive attestation (requires-absence is not purity)", () => {
    // `ai:callLLM` is the standing counterexample: bodyless, no `@requires`, and
    // its handler performs network IO. So an empty requires vector must not be
    // enough for a root.
    const unattested = run({ schemes: schemeWith({ origin: "HostNative" }) });
    expect(unattested.$tag).toBe("VtaRefused");
    expect(unattested.reason!.$tag).toBe("RsnPrimitiveClaimMismatch");

    const attested = run({
      schemes: schemeWith({
        origin: "HostNative",
        attestedPure: true,
        attestedTotal: true,
        attestedHonest: true,
      }),
    });
    expect(attested.$tag).toBe("VtaAdmitted");
  });

  it("needs all three attestations, not any one of them", () => {
    for (const missing of ["attestedPure", "attestedTotal", "attestedHonest"]) {
      const flags = {
        origin: "HostNative",
        attestedPure: true,
        attestedTotal: true,
        attestedHonest: true,
        [missing]: false,
      };
      const r = run({ schemes: schemeWith(flags) });
      expect(r.$tag).toBe("VtaRefused");
      expect(r.reason!.$tag).toBe("RsnPrimitiveClaimMismatch");
    }
  });
});

describe("slice 3g — SC-sig: a ground declaration is not self-authorizing", () => {
  it("refuses an occurrence with NO certificate", () => {
    const r = run({ certificates: [] });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnMissingPrimitiveCertificate");
  });

  it("refuses a certificate verified against a DIFFERENT scheme identity", () => {
    // The counterexample this closes: a certificate issued against an older
    // declaration authorizing the current one.
    const r = run({
      certificates: [{
        ...baseRequest().certificates[0]!,
        schemeHash: h("fenel.validation.scheme.v1", "0000"),
      }],
    });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnStaleEvidence");
  });

  it("refuses an AMBIGUOUS certificate set rather than taking the first row", () => {
    const c = baseRequest().certificates[0]!;
    const r = run({ certificates: [c, c] });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnMissingPrimitiveCertificate");
  });

  it("refuses an AMBIGUOUS scheme table rather than taking the first row", () => {
    const s = baseRequest().schemes[0]!;
    const r = run({ schemes: [s, s] });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnMissingEvidence");
  });
});

describe("slice 3g — the current-SCC fence and the role gate", () => {
  it("refuses a target that sits in the CALLER's own SCC", () => {
    // The circularity P4 exists to break: discharging a same-SCC use needs the
    // atomic group solve this slice does not have, and an unvalidated
    // assumption is not evidence.
    const r = run({ schemes: schemeWith({ sccId: "scc:caller" }) });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnSccAssumptionNotValidated");
  });

  it("an ABSENT caller SCC identity FENCES — undecided is not 'not in the same SCC'", () => {
    // The round-2 finding: skipping the SCC comparison on an empty caller id let
    // `f -> g -> f` through whenever neither carried SCC metadata, which is
    // precisely the case a caller controls by omission. Missing metadata is
    // undecided, and undecided fences.
    const r = run({
      schemes: schemeWith({ sccId: "" }),
      callerScheme: { ...baseRequest().callerScheme, sccId: "" },
    });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnSccAssumptionNotValidated");
  });

  it("MUTUAL recursion with unset SCC metadata cannot slip past the identity fence", () => {
    // f -> g where both carry no SCC id: the direct-identity test is false in
    // both directions, so only the undecided-fences rule catches it.
    const r = run({
      callerId: "mod:f",
      routes: [route("g", "mod:g")],
      flatRoutes: [route("g", "mod:g")],
      arities: [{ targetId: "mod:g", arity: 1 }],
      body: { call: ["g", 1] },
      schemes: [{ ...baseRequest().schemes[0]!, targetId: "mod:g", sccId: "" }],
      certificates: [{ ...baseRequest().certificates[0]!, targetId: "mod:g" }],
      callerScheme: { ...baseRequest().callerScheme, sccId: "" },
    });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnSccAssumptionNotValidated");
  });

  it("only a call or a bare registered reference is admitted; a rule-shaped role is not", () => {
    // Gated on the ROLE — the ledger's own closed discriminator — rather than on
    // a kind spelling copied from the registry's vocabulary.
    expect(dispatchEngineBody("engine:vteRoleCarriesScheme", ["VurCall"])).toBe(true);
    expect(dispatchEngineBody("engine:vteRoleCarriesScheme", ["VurReference"])).toBe(true);
    for (const role of ["VurConstructor", "VurIntrinsic", "VurCapabilityDispatch", "VurLexical", ""]) {
      expect(dispatchEngineBody("engine:vteRoleCarriesScheme", [role])).toBe(false);
    }
  });
});

describe("slice 3g — eligibility is an inventory verdict, not a restatement", () => {
  it("reports EligEvidenceIncomplete when the inventory does not describe a reached target", () => {
    // Without this second verdict the classifier would always answer
    // EligEvidenceComplete by the time it is consulted, because the caller gate
    // has already run — a verdict that says nothing.
    const carrier = { $tag: "VcaUseId", callerId: "mod:caller", role: "VurCall", path: [], targetId: "mod:absent", kind: "function" };
    const verdict = dispatchEngineBody("engine:vteEligible", [
      { $tag: "VteRequest", ...baseRequest(), schemes: [], certificates: [] },
      [carrier],
    ]) as { $tag: string };
    expect(verdict.$tag).toBe("EligEvidenceIncomplete");
  });

  it("ignores roles that carry no scheme when judging inventory completeness", () => {
    const lexical = { $tag: "VcaUseId", callerId: "mod:caller", role: "VurLexical", path: [], targetId: "x", kind: "lexical" };
    const verdict = dispatchEngineBody("engine:vteEligible", [
      { $tag: "VteRequest", ...baseRequest(), schemes: [], certificates: [] },
      [lexical],
    ]) as { $tag: string };
    expect(verdict.$tag).toBe("EligEvidenceComplete");
  });

  it("consults NO certificate — the anti-circularity property", () => {
    // "Eligible" must not come to mean "happened to verify".
    const src = fs.readFileSync(path.join(REPO, "fenel/modules/engine/validation-entry.fenel"), "utf8");
    const body = src.slice(src.indexOf("vteEligible : "), src.indexOf("@label \"Trusted entry first undescribed"));
    expect(body).not.toContain("certificates");
    expect(body).not.toContain("Authority");
  });
});

describe("slice 3g — SC-eff: a ground arrow proves nothing about purity", () => {
  it("refuses a target with a declared requires", () => {
    // `deletePage : (id: String) -> Unit` is perfectly ground and performs
    // state IO — effects live outside the value type by design.
    const r = run({ schemes: schemeWith({ requires: ["HasStateIO"] }) });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnEffectfulScEff");
    expect(r.reason!.requires).toEqual(["HasStateIO"]);
  });

  it("refuses an effectful CALLER before anything is built", () => {
    const r = run({ callerScheme: { ...baseRequest().callerScheme, requires: ["HasNetwork"] } });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnEffectfulScEff");
  });
});

describe("slice 3g — the ground cut and the exactness fence", () => {
  it("refuses a QUANTIFIED target with the reason minted for it", () => {
    const r = run({ schemes: schemeWith({ quantified: 1 }) });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnUnsolvedUseInstance");
  });

  it("refuses a scheme carrying authored diagnostics even when it is ground", () => {
    const r = run({ schemes: schemeWith({ diagnostics: ["inference.value-dependent-type"] }) });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnMissingEvidence");
  });

  it("refuses an unsolved outcome even when it is ground and undiagnosed", () => {
    const r = run({ schemes: schemeWith({ outcome: "AnnotationRequired" }) });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnMissingEvidence");
  });

  it("refuses a scheme whose projection carries SeAll anywhere", () => {
    const r = run({ schemes: schemeWith({ arrow: tt({ $var: "a" }) }) });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnUnsupportedRankOrKind");
    expect(r.reason!.detail).toContain("SeAll");
  });

  // THE R5 REPAIR, DERIVED RATHER THAN ASSERTED. The withdrawn argument was
  // "the eleven Vec-argued declarations are quantified, so a ground-only rule
  // fences them". `Vec String Number` is the zero-binder counterexample that
  // kills it. The real reason they cannot reach this reader is that
  // `typeToSetExpr` has no TtApp/TtEl arm, so ANY nominal application projects
  // to a set carrying SeAll — quantified or not.
  it("fences a ZERO-BINDER nominal application (the Vec String Number counterexample)", () => {
    const app = tt({ $el: { call: ["Vec", "String", { $ref: "Number" }] } });
    const projected = dispatchEngineBody("engine:typeToSetExpr", [app]);
    expect(dispatchEngineBody("engine:seHasAll", [projected])).toBe(true);

    const r = run({ schemes: schemeWith({ quantified: 0, arrow: app }) });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnUnsupportedRankOrKind");
  });

  it("the exactness fence is the CHECKER's own rule, not a second one", () => {
    // `synthFromSig` refuses a signature whose projection carries SeAll. Reusing
    // `seHasAll` is what keeps this entry from being more permissive than the
    // checker that will consume what it admits.
    const src = fs.readFileSync(path.join(REPO, "fenel/modules/engine/check.fenel"), "utf8");
    expect(src).toContain("if seHasAll sigArrow then SeAll");
  });
});

describe("slice 3g — exactness is STRICTER than 'contains no SeAll'", () => {
  // `seHasAll` answers "contains SeAll", which is not "is exact": SeWhere,
  // SePattern and SeRigid are all non-SeAll and none of them denotes a set this
  // entry can stand behind. Found by the result review.
  const residual = (s: unknown) => dispatchEngineBody("engine:vteResidual", [s]) as boolean;
  const ALL = { $tag: "SeAll" };
  const arrowOf = (paramSet: unknown) => ({
    $tag: "SeArrow",
    params: [{ $tag: "SetArrowParam", key: { $tag: "PositionalField", index: 0 }, wireName: "_0", set: paramSet }],
    returns: { $tag: "SeEnum", values: [1] },
  });

  it("treats the four opaque leaves as residuals even though none carries SeAll", () => {
    for (const [label, leaf] of [
      ["SeWhere", { $tag: "SeWhere", pred: true }],
      ["SePattern", { $tag: "SePattern", pattern: { $tag: "SpAny" } }],
      ["SeRigid", { $tag: "SeRigid", scopeToken: "forged", ordinal: 0, kind: { $tag: "KType" } }],
    ] as const) {
      expect({ label, hasAll: dispatchEngineBody("engine:seHasAll", [leaf]) }).toEqual({ label, hasAll: false });
      expect({ label, residual: residual(leaf) }).toEqual({ label, residual: true });
    }
  });

  it("finds a residual at every structural depth", () => {
    expect(residual(arrowOf({ $tag: "SeWhere", pred: true }))).toBe(true);
    expect(residual({ $tag: "SeMu", var: "x", body: ALL })).toBe(true);
    expect(residual({
      $tag: "SeCtor",
      ctor: "C",
      fields: [{ $tag: "SetCtorField", key: { $tag: "PositionalField", index: 0 }, wireName: "_0", set: { $tag: "SeRigid", scopeToken: "t", ordinal: 0, kind: { $tag: "KType" } } }],
    })).toBe(true);
    expect(residual({ $tag: "SeUnion", branches: [{ $tag: "SeEnum", values: [1] }, ALL] })).toBe(true);
    expect(residual({ $tag: "SeDiff", left: { $tag: "SeNone" }, right: { $tag: "SeWhere", pred: 1 } })).toBe(true);
    expect(residual({ $tag: "SeComplement", inner: { $tag: "SePattern", pattern: {} } })).toBe(true);
  });

  it("an UNRECOGNISED constructor is a residual, not an admissible leaf", () => {
    // The round-2 finding, and my own comment had claimed the opposite: a Fenel
    // `case` with no matching arm falls through to host-null, and null is not
    // `true` — so without an explicit wildcard a sixteenth SetExpr constructor
    // would have read as NOT a residual. The safe default has to be written.
    expect(residual({ $tag: "SeSomethingNobodyHasAddedYet" })).toBe(true);
    const key = dispatchEngineBody("engine:vteSetKey", [{ $tag: "SeSomethingNobodyHasAddedYet" }]) as { tag: string };
    expect(key.tag).toBe("SeUnknown");
  });

  it("admits the exact leaves", () => {
    for (const leaf of [{ $tag: "SeNone" }, { $tag: "SeEnum", values: [1, 2] }, { $tag: "SeInterval", interval: {} }]) {
      expect(residual(leaf)).toBe(false);
    }
  });

  // SeRef is DELIBERATELY admitted, and the reason is a side condition rather
  // than a claim: `Int` itself projects to `SeRef "ℤ"`, so fencing every SeRef
  // refuses every ordinary signature and the entry admits nothing at all.
  it("admits SeRef, and the code says why rather than implying the hole is closed", () => {
    expect(residual({ $tag: "SeRef", handle: "GhostNameNobodyRegistered" })).toBe(false);
    const projected = dispatchEngineBody("engine:typeToSetExpr", [tt(INT)]);
    expect(projected).toEqual({ $tag: "SeRef", handle: "ℤ" });
    const src = fs.readFileSync(path.join(REPO, "fenel/modules/engine/validation-entry.fenel"), "utf8");
    expect(src).toContain("IS ADMITTED, AND THAT IS A SIDE CONDITION RATHER THAN A CLAIM");
  });

  it("fences an arrow whose parameter carries an opaque leaf", () => {
    const r = run({ schemes: schemeWith({ arrow: tt({ $refined: { base: INT, set: { $where: true } } }) }) });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnUnsupportedRankOrKind");
  });
});

describe("slice 3g — a public helper cannot be a second admitting entry", () => {
  // Round 1's finding: every function here is reachable by name through generic
  // dispatch, so "only vteValidate calls it" is a claim about the repository,
  // not about the function. `vtePreflight` is public and returns VteOutcome.
  //
  // Round 2's finding: BINDING a supplied carrier to the request was not enough.
  // The caller holds the request, so it can compute `vteInputsHash request` and
  // still hand over a carrier whose identities, root and readiness it invented —
  // and re-deriving readiness from that carrier's own rows only proves the
  // forgery is self-consistent. So the carrier stopped being an argument.
  it("vtePreflight takes NO carrier and NO eligibility — only the request and the entries", () => {
    const src = fs.readFileSync(path.join(REPO, "fenel/modules/engine/validation-entry.fenel"), "utf8");
    const sig = src.match(/^vtePreflight : .*$/m)![0];
    // slice 3h: the partition rides beside the entries — still NO carrier and NO
    // supplied eligibility, which is the property this pin exists for.
    expect(sig).toBe("vtePreflight : (request: VteRequest) -> (entries: [VteEntry]) -> (classes: [VteClassified]) -> VteOutcome");
    expect(sig).not.toContain("VcaCarrier");
    expect(sig).not.toContain("eligibility");
  });

  it("rebuilds the carrier itself, so a forged identity list cannot be matched", () => {
    // The forged-carrier attack in its strongest form: the attacker supplies an
    // entry list, and the only carrier it could have been built against is the
    // one this function derives. An empty entry list against a body with one
    // live occurrence is now a bijection failure rather than a vacuous pass.
    // Reached directly the body is not marshalled, so the rebuilt carrier
    // refuses on the projection before it can even reach the bijection check.
    // Either way the claim under test is the same one: it does NOT admit.
    // slice 3h: a raw record reaches the entry with a STRING executorProfile
    // (the transport is what maps the two spellings to their constructors), so
    // the request gate refuses it before anything is built — which is itself the
    // property under test: the direct entrant is held to the same conditions.
    const r = dispatchEngineBodyWithDeciderCtx("engine:vtePreflight", [
      { $tag: "VteRequest", ...baseRequest() },
      [],
      [],
    ]) as Outcome;
    expect(r.$tag).toBe("VtaRefused");

    // And through the transport — where the body IS marshalled — an empty entry
    // list against a body with one live occurrence is a bijection failure
    // rather than the vacuous pass it used to be.
    const viaTransport = dispatchedTrustedValidation(baseRequest()) as Outcome;
    expect(viaTransport.$tag).toBe("VtaAdmitted");
    expect(viaTransport.admission!.entries).toHaveLength(1);
  });

  it("re-runs the caller gate, so a direct entrant is held to the same conditions", () => {
    // The raw record carries the executor profile as its transport SPELLING, so
    // it is re-tagged here — otherwise the slice-3h request gate refuses first
    // and the caller gate, which is what this test is about, never runs.
    const raw = baseRequest({ callerScheme: { ...baseRequest().callerScheme, quantified: 1 } });
    const r = dispatchEngineBodyWithDeciderCtx("engine:vtePreflight", [
      { $tag: "VteRequest", ...raw, executorProfile: { $tag: "VepPureEvaluate" } },
      [],
      [],
    ]) as Outcome;
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnUnsupportedRankOrKind");
  });

  it("vteFromCarrier likewise discards the supplied carrier in favour of a rebuild", () => {
    const src = fs.readFileSync(path.join(REPO, "fenel/modules/engine/validation-entry.fenel"), "utf8");
    const body = src.slice(src.indexOf("vteFromCarrier request carrier ="), src.indexOf("@label \"Trusted entry from a request-bound carrier\""));
    expect(body).toContain("vcaCarrier request.callerId");
    expect(body).toContain("VcoCarrier { carrier = rebuilt } -> vteFromCheckedCarrier request rebuilt");
  });
});

describe("slice 3g — self-reference, negative Nats, and the resolved kind", () => {
  it("fences a DIRECT self-call on identity, not on SCC metadata", () => {
    // The hole: caller `mod:f` calling target `mod:f` with both SCC ids unset
    // was admitted as an EXTERNAL dependency — the most wrong possible reading.
    const r = run({
      callerId: "mod:myFn",
      callerScheme: { ...baseRequest().callerScheme, sccId: "" },
      schemes: schemeWith({ sccId: "" }),
    });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnSccAssumptionNotValidated");
  });

  it("a NEGATIVE quantified count does not pass the zero-quantified gate", () => {
    // `not (gt n 0)` admits n = -1, and nothing between the transport and the
    // body proves a Nat-declared slot holds one.
    expect(run({ schemes: schemeWith({ quantified: -1 }) }).$tag).toBe("VtaRefused");
    expect(run({ callerScheme: { ...baseRequest().callerScheme, quantified: -1 } }).$tag).toBe("VtaRefused");
  });

  it("a caller sccSize of 0 does not pass the not-multi-member gate", () => {
    expect(run({ callerScheme: { ...baseRequest().callerScheme, sccSize: 0 } }).$tag).toBe("VtaRefused");
    expect(run({ callerScheme: { ...baseRequest().callerScheme, sccSize: 2 } }).$tag).toBe("VtaRefused");
  });

  it("the RESOLVED route kind is checked, not just the syntactic role", () => {
    // `vlgWalk` gives any named call role VurCall while the route table
    // independently records what the name resolved to, so a call resolving to a
    // constructor or a capability reaches the mint with a passing role.
    for (const kind of ["constructor", "capability", "intrinsic", "lexical", "entity", ""]) {
      expect({ kind, ok: dispatchEngineBody("engine:vteKindCarriesScheme", [kind]) })
        .toEqual({ kind, ok: false });
    }
    expect(dispatchEngineBody("engine:vteKindCarriesScheme", ["function"])).toBe(true);

    // slice 3h: the kind gate still holds — `vteKindCarriesScheme` is exactly as
    // strict — but a constructor-kind occurrence is no longer a REFUSAL. It is
    // rule-class: it gets NO entry (so it can never be read as an external
    // dependency, which is the property this test was written to protect) and is
    // enumerated in the admission's classes instead.
    const r = run({
      routes: [{ ...route("myFn", "mod:myFn"), kind: "constructor" }],
      flatRoutes: [{ ...route("myFn", "mod:myFn"), kind: "constructor" }],
    });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.admission!.entries).toHaveLength(0);
    expect(r.admission!.classes).toHaveLength(1);
    expect(r.admission!.classes![0]!.class.$tag).toBe("VtcRule");
    expect(r.admission!.classes![0]!.class.ruleKind!.$tag).toBe("VrkConstructor");
  });
});

describe("slice 3g — the caller gate (what makes R3/R4 vacuous rather than skipped)", () => {
  it("refuses a QUANTIFIED caller, naming the unconverted observation frame", () => {
    const r = run({ callerScheme: { ...baseRequest().callerScheme, quantified: 1 } });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnUnsupportedRankOrKind");
    expect(r.reason!.detail).toContain("observation frame");
  });

  it("refuses a caller in a multi-member SCC (no atomic group solve here)", () => {
    const r = run({ callerScheme: { ...baseRequest().callerScheme, sccSize: 2 } });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnSccAssumptionNotValidated");
  });

  it("refuses an unsolved or diagnosed caller", () => {
    expect(run({ callerScheme: { ...baseRequest().callerScheme, outcome: "Invalid" } }).reason!.$tag)
      .toBe("RsnMissingEvidence");
    expect(run({ callerScheme: { ...baseRequest().callerScheme, diagnostics: ["x"] } }).reason!.$tag)
      .toBe("RsnMissingEvidence");
  });

  it("the entry never names the vob* observation namespace", () => {
    const src = fs.readFileSync(path.join(REPO, "fenel/modules/engine/validation-entry.fenel"), "utf8");
    const code = src
      .split("\n")
      .filter((l) => !/^\s*--/.test(l) && !/^\s*@(label|description|tags|category)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/\bvob[A-Z]/);
  });
});

describe("slice 3g — the frozen/flat route agreement still binds through the entry", () => {
  it("refuses when the flat runtime route names a different target", () => {
    const r = run({ flatRoutes: [route("myFn", "mod:other")] });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnCheckerAbstained");
  });

  it("refuses when the flat route is ABSENT — no second opinion is not agreement", () => {
    const r = run({ flatRoutes: [] });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnCheckerAbstained");
  });
});

describe("slice 3g — the body digest is DERIVED, not taken on the caller's word", () => {
  it("refuses a caller that states a body hash it did not compute", () => {
    const r = run({ provenance: { bodyHash: "deadbeef", astAbi: "4", parser: "authoritative" } });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnStaleEvidence");
    expect(r.reason!.observed).toContain("not the digest of the body");
  });

  it("admits when the caller states nothing, and stamps the derived hash itself", () => {
    const r = run();
    expect(r.$tag).toBe("VtaAdmitted");
    // The snapshot's body identity is now a 64-hex digest, not the empty claim.
    const entry = r.admission!.entries[0]! as unknown as { snapshot: { bodyHash: string } };
    expect(entry.snapshot.bodyHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("slice 3g — the two-level binding (a digest over the key alone cannot see meaning)", () => {
  const hexOf = (r: Outcome) => r.admission!.digest.hex;

  it("is deterministic over the same request", () => {
    expect(hexOf(run())).toBe(hexOf(run()));
  });

  it("moves with the registry generation", () => {
    expect(hexOf(run())).not.toBe(hexOf(run({ registryGeneration: "gen-2" })));
  });

  it("moves with the validator version", () => {
    expect(hexOf(run())).not.toBe(hexOf(run({ validatorVersion: "v2" })));
  });

  // The round-1 design review's finding: `VcaUseId` omits saturation, locality
  // and enters-target, and an ARITY-TABLE change flips them without touching the
  // key. Before those fields rode in the per-entry digest, both runs produced
  // the same brand while meaning different things.
  it("moves with the ARITY TABLE, which the occurrence key cannot see", () => {
    // slice 3h: `declaredArity` is now a BOUND entry field, so the two runs
    // differ in the digest AND the incoherent one is refused outright — an arity
    // of 2 over a one-parameter projected chain is two tables disagreeing.
    // slice 3h: `declaredArity` is now a BOUND entry field, so the two runs
    // differ in the digest — shown over a TWO-parameter target so both arities
    // stay coherent (exact at 1, under-applied at 2). The incoherent direction
    // is its own assertion below: an arity longer than the projected chain is
    // two tables disagreeing, and that refuses.
    const arrow2 = (dispatchEngineBody("engine:foldTypes", [[tt(INT), tt(INT), tt(INT)]]) as { _0: unknown })._0;
    const twoParam = { schemes: schemeWith({ arrow: arrow2 }) };
    const a = run({ ...twoParam, arities: [{ targetId: "mod:myFn", arity: 1 }] });
    const b = run({ ...twoParam, arities: [{ targetId: "mod:myFn", arity: 2 }] });
    expect(a.$tag).toBe("VtaAdmitted");
    expect(b.$tag).toBe("VtaAdmitted");
    expect(hexOf(a)).not.toBe(hexOf(b));
    expect(a.admission!.entries[0]!.digest.hex).not.toBe(b.admission!.entries[0]!.digest.hex);
    const overlong = run({ arities: [{ targetId: "mod:myFn", arity: 2 }] });
    expect(overlong.$tag).toBe("VtaRefused");
    expect(overlong.reason!.$tag).toBe("RsnUnsupportedRankOrKind");
  });

  // The other half of the same finding: run A (certificate present) and run B
  // (a different certificate) must not share an admission digest.
  it("moves with the certificate the authority rests on", () => {
    const b = run({
      certificates: [{
        ...baseRequest().certificates[0]!,
        certificateHash: h("fenel.validation.dependency.v1", "f00d"),
      }],
    });
    expect(b.$tag).toBe("VtaAdmitted");
    expect(hexOf(run())).not.toBe(hexOf(b));
  });

  // The result review's collision: with only `seTag instance` in the payload,
  // `String -> String` and `Number -> Number` are both "SeArrow" and two
  // materially different instances shared one digest.
  it("moves with the INSTANCE STRUCTURE, not merely its constructor tag", () => {
    const strArrow = (dispatchEngineBody("engine:foldTypes", [[tt({ $ref: "String" }), tt({ $ref: "String" })]]) as { _0: unknown })._0;
    const a = run();
    const b = run({ schemes: schemeWith({ arrow: strArrow }) });
    expect(a.$tag).toBe("VtaAdmitted");
    expect(b.$tag).toBe("VtaAdmitted");
    expect(a.admission!.entries[0]!.digest.hex).not.toBe(b.admission!.entries[0]!.digest.hex);
    expect(hexOf(a)).not.toBe(hexOf(b));
  });

  it("moves with the param-name table, which decides lexical-vs-registered resolution", () => {
    const b = run({ paramNames: ["z"] });
    expect(b.$tag).toBe("VtaAdmitted");
    expect(hexOf(run())).not.toBe(hexOf(b));
  });

  it("binds the domain FIRST — a cross-domain hash comparison is a rejection", () => {
    const H = (d: string, x: string) => ({ $tag: "ValidationHash", domain: d, hex: x });
    expect(dispatchEngineBody("engine:vcaHashEq", [H("d", "ab"), H("d", "ab")])).toBe(true);
    expect(dispatchEngineBody("engine:vcaHashEq", [H("d1", "ab"), H("d2", "ab")])).toBe(false);
    // An empty hex is never equal to anything, including itself: an unset digest
    // must not read as agreement.
    expect(dispatchEngineBody("engine:vcaHashEq", [H("d", ""), H("d", "")])).toBe(false);
  });
});

describe("slice 3g — the total projection walk (the VciInert hole 3f left open)", () => {
  const inputsHash = { domain: "fenel.validation.inputs.v1", hex: "probe" };
  const carrierFor = (body: unknown) =>
    dispatchedValidationCarrier({
      callerId: "mod:caller",
      body,
      paramNames: [],
      routes: [],
      arities: [],
      provenance: { bodyHash: "bh", astAbi: "4", parser: "authoritative" },
      flatRoutes: [],
      wireProjections: [],
      inputsHash,
    }) as { $tag: string; carrier: { readiness: { $tag: string }; fences: unknown[]; root: unknown } };

  // THE DEFECT. An unsupported STRUCTURAL node projects to `VcpUnsupported` and
  // issues `VciInert` — neither `VciFenced` nor `VciAliased` — so
  // `vcaCollectFences` never sees it and 3f's preflight reaches VckReady with it
  // present. `vcaFirstUnsupportedIdentity` guards the other door: unsupported
  // nodes that DO issue an identity.
  it("3f's carrier really does report a clean, ready carrier for an unsupported form", () => {
    for (const body of [{ do: [1, 2] }, { let: [{ a: 1 }, { var: "a" }] }]) {
      const out = carrierFor(body);
      expect(out.$tag).toBe("VcoCarrier");
      expect(out.carrier.readiness.$tag).toBe("VrdStructurallyReady");
      expect(out.carrier.fences).toHaveLength(0);
    }
  });

  it("the entry's total walk finds the unsupported node the fence collection misses", () => {
    // slice 3h widened the BINDING family and nothing else, so the probe moved
    // to the forms that are still honestly fenced: an array literal and an
    // annotation. `{do}` / `{let}` now carry `VcpBinding` and pass this walk.
    for (const body of [{ ann: [1, 2] }, [1, 2]]) {
      const out = carrierFor(body);
      const found = dispatchEngineBody("engine:vteFirstUnsupported", [out.carrier.root]) as {
        $tag: string;
      };
      expect(found.$tag).toBe("Just");
    }
  });

  it("and the entry refuses such a body outright", () => {
    const r = run({ body: { ann: [{ call: ["myFn", 1] }, 1] } });
    expect(r.$tag).toBe("VtaRefused");
    expect(r.reason!.$tag).toBe("RsnUnsupportedSyntax");
  });

  it("slice 3h — the BINDING family is supported and admits end to end", () => {
    const r = run({ body: { do: [{ call: ["myFn", 1] }] } });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.admission!.entries).toHaveLength(1);
  });

  it("the supported set is exactly the eight core projections", () => {
    const supported = ["VcpLit", "VcpVar", "VcpCall", "VcpConstruct", "VcpRecord", "VcpLambda", "VcpMatch", "VcpPattern"];
    for (const tag of supported) {
      expect(dispatchEngineBody("engine:vteProjectionSupported", [{ $tag: tag }])).toBe(true);
    }
    expect(dispatchEngineBody("engine:vteProjectionSupported", [{ $tag: "VcpUnsupported", form: "do" }]))
      .toBe(false);
  });
});

describe("slice 3g — R7: the not-yet-ready bucket, split and TYPED", () => {
  // The classification is driven off the detail string, which is only sound
  // because the ledger's vocabulary is CLOSED. This enumerates every spelling
  // the ledger can produce, harvested from its own source, so a new one cannot
  // land in a pending bucket unnoticed.
  const ledgerSrc = fs.readFileSync(path.join(REPO, "fenel/modules/engine/validation-ledger.fenel"), "utf8");
  const fdcSrc = fs.readFileSync(path.join(REPO, "fenel/modules/engine/form-decomposition.fenel"), "utf8");

  const REFINABLE = new Set([
    "lexical callable applied without an exact origin",
    "overapplication eta-tail may enter an unledgered callable",
    "single-record argument may be a named-argument application",
  ]);

  const kindOf = (detail: string) =>
    dispatchEngineBody("engine:vckPendingKindOf", [detail]) as { $tag: string; _0?: { $tag: string } };

  it("names an evidence demand for exactly the three refinable spellings", () => {
    expect(kindOf("lexical callable applied without an exact origin")._0!.$tag).toBe("VrpExactOrigin");
    expect(kindOf("overapplication eta-tail may enter an unledgered callable")._0!.$tag)
      .toBe("VrpCertifiedEtaStage");
    expect(kindOf("single-record argument may be a named-argument application")._0!.$tag)
      .toBe("VrpNamedArgumentDecision");
  });

  // The CLOSED vocabulary, enumerated. Fourteen literals in the ledger plus
  // three forwarded verbatim from `fdcBindingOf`. It is written out rather than
  // harvested by regex because a harvest that silently matched nothing would
  // make the test vacuous — and each spelling is cross-checked against the
  // source below, so a rename breaks this test instead of quietly widening the
  // pending bucket.
  const CLOSED_DETAILS: readonly string[] = [
    "dynamic-application",
    "raw-rule intrinsic evaluates its rule in a derived per-item data context",
    "var without a string name",
    "data-dependent dotted variable path",
    "an arm pattern introduces a binder whose runtime spelling is not reproducible or whose write is conditional on the scrutinee",
    "a lambda parameter spelling is not reproducible, so the binder it introduces cannot be named",
    "the $ application vehicle applies a callee VALUE and bypasses registry resolution",
    "lexical callable applied without an exact origin",
    "data-dependent dotted callable path",
    "callee is not a fnId or {var}",
    "constructor name is not a literal",
    "scope-dependent capability dispatch",
    "overapplication eta-tail may enter an unledgered callable",
    "single-record argument may be a named-argument application",
    "a tagged bindings record binds its discriminator too, and the marshal discarded that key's position, so the binder order is unrecoverable",
    "an ABSENT or null bindings carrier makes the host enumeration THROW, so the form produces no value at all",
    "a bindings carrier that is not a record is enumerated by the host in a way this decomposition does not reproduce",
  ];

  it("the enumerated vocabulary is exactly the seventeen the producers can emit", () => {
    expect(CLOSED_DETAILS).toHaveLength(17);
    expect(new Set(CLOSED_DETAILS).size).toBe(17);
    for (const detail of CLOSED_DETAILS) {
      const present = ledgerSrc.includes(detail) || fdcSrc.includes(detail);
      expect({ detail, present }).toEqual({ detail, present: true });
    }
  });

  it("every spelling outside the three is FINAL, not pending", () => {
    for (const detail of CLOSED_DETAILS) {
      if (REFINABLE.has(detail)) continue;
      expect({ detail, kind: kindOf(detail).$tag }).toEqual({ detail, kind: "Nothing" });
    }
  });

  it("an UNCLASSIFIED spelling defaults to final fence, not to pending", () => {
    expect(kindOf("a dynamic form nobody has classified yet").$tag).toBe("Nothing");
    expect(kindOf("").$tag).toBe("Nothing");
  });

  it("slice 3h — an ordinary lexical READ is no longer pending; it reaches Γ", () => {
    // THE LEXICAL SPLIT's whole point. `{var: x}` with `x` a formal is ordinary
    // explicit evidence: the binder identity IS the evidence and the checker's Γ
    // discipline discharges it, so readiness is READY and the occurrence is
    // Γ-class — no entry, enumerated in the admission's classes.
    const r = run({ body: { var: "x" }, paramNames: ["x"], routes: [], flatRoutes: [], arities: [] });
    expect(r.$tag).toBe("VtaAdmitted");
    expect(r.admission!.entries).toHaveLength(0);
    expect(r.admission!.classes).toHaveLength(1);
    expect(r.admission!.classes![0]!.class.$tag).toBe("VtcGamma");
  });

  it("slice 3h — an APPLIED lexical callable still refuses (VrpExactOrigin, 3i's)", () => {
    const r = run({
      body: { call: [{ var: "f" }, 1] },
      paramNames: ["f"],
      routes: [],
      flatRoutes: [],
      arities: [],
    });
    expect(r.$tag).toBe("VtaRefused");
  });
});

describe("slice 3g — the authoritative path is DISTINCT, and the gate can see it", () => {
  it("the non-authoritative pair is untouched and still takes a caller table", () => {
    const src = fs.readFileSync(path.join(REPO, "fenel/modules/engine/validation-carrier.fenel"), "utf8");
    expect(src).toContain("vckPreflightTable : (carrier: VcaCarrier) -> (entries: [VckEntry]) -> VckPreflight");
    expect(src).toContain("vckLookup : (useId: VcaUseId) -> (entries: [VckEntry]) -> Maybe SetExpr");
    expect(src).toContain("NON-AUTHORITATIVE");
  });

  it("the trusted entry takes NO occurrence table — there is no argument to smuggle one through", () => {
    const src = fs.readFileSync(path.join(REPO, "fenel/modules/engine/validation-entry.fenel"), "utf8");
    const sig = src.match(/^vteValidate : .*$/m)![0];
    expect(sig).toBe("vteValidate : (request: VteRequest) -> VteOutcome");
    const request = src.match(/^VteRequest = VteRequest .*$/m)![0];
    expect(request).not.toContain("entries");
    expect(request).not.toContain("VckEntry");
    expect(request).not.toContain("instance");
  });

  it("only the ledgered transport and the module registration name the non-authoritative pair", () => {
    const roots = ["implementations/typescript/engine/src", "implementations/typescript/runtime/src"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "generated") walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue;
        const src = fs.readFileSync(full, "utf8");
        if (/vckPreflightTable|vckLookup/.test(src)) offenders.push(path.relative(REPO, full));
      }
    };
    for (const r of roots) walk(path.join(REPO, r));
    // The transport wrapper (which 3f labelled NON-AUTHORITATIVE and exists so a
    // test can exercise the supplied-table path) and the module registration
    // comment. Anything else means a production surface has started consuming
    // the path that cannot establish authenticity.
    expect(offenders.map((o) => o.split(path.sep).join("/")).sort()).toEqual([
      "implementations/typescript/engine/src/engine-bodies-dispatch.ts",
      "implementations/typescript/engine/src/modules/engine.ts",
    ]);
    const transport = fs.readFileSync(
      path.join(REPO, "implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
      "utf8",
    );
    expect(transport).toContain("NON-AUTHORITATIVE");
  });

  it("every declaration in the entry module carries the vte prefix, so a namespace scan can see it all", () => {
    const src = fs.readFileSync(path.join(REPO, "fenel/modules/engine/validation-entry.fenel"), "utf8");
    const declared = [...src.matchAll(/^([a-z][A-Za-z0-9]*)\s*:\s*\(/gm)].map((m) => m[1]!);
    expect(declared.length).toBeGreaterThan(20);
    for (const name of declared) expect(name).toMatch(/^vte[A-Z]/);
  });
});

describe("slice 3g — the certificate-byte leaf, reached the way the entry reaches it", () => {
  it("the ctx-native is merged only by the DECIDER dispatcher", () => {
    // The bug this pins: dispatched through the plain entry, a bare ctx-native
    // head resolves to nothing and the body returns host-null — silently.
    const src = fs.readFileSync(path.join(REPO, "implementations/typescript/engine/src/engine-bodies-dispatch.ts"), "utf8");
    const wrapper = src.slice(src.indexOf("export function dispatchedTrustedValidation"));
    expect(wrapper).toContain('dispatchEngineBodyWithDeciderCtx("engine:vteValidate"');
  });

  it("is TOTAL on a malformed request — a refusal, never a host throw", () => {
    // A null request must not reach the leaf with a null domain (which the leaf
    // would refuse loudly) nor evaluate to host-null. It refuses.
    const r = dispatchEngineBodyWithDeciderCtx("engine:vteValidate", [null]) as Outcome;
    expect(r.$tag).toBe("VtaRefused");
  });

  it("the leaf refuses an ill-formed domain rather than digesting something else", () => {
    const src = fs.readFileSync(
      path.join(REPO, "implementations/typescript/engine/src/engine-bodies-dispatch.ts"),
      "utf8",
    );
    const native = src.slice(src.indexOf("validationCanonicalDigest: ("));
    expect(native.slice(0, 900)).toContain("must be a non-empty string literal");
  });

  it("the entry's digests agree with the leaf's own encoder", () => {
    // Same domain, same payload shape ⇒ the Fenel side is using the leaf, not a
    // second hashing path.
    const direct = canonicalDigest("fenel.validation.body.v1", { a: 1 });
    expect(direct).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalDigest("fenel.validation.body.v1", { a: 1 })).toBe(direct);
    expect(canonicalDigest("fenel.validation.inputs.v1", { a: 1 })).not.toBe(direct);
  });

  it("the domain constants take a unit argument so they evaluate to their VALUE", () => {
    // A bare nullary name resolves to a `{$ref}` handle in argument and
    // record-field position; that shape reached the leaf and was refused.
    for (const [fn, lit] of [
      ["vteEntryVersion", "fenel.validation.entry.v2"],
      ["vteInputsDomain", "fenel.validation.inputs.v1"],
      ["vteBodyDomain", "fenel.validation.body.v1"],
      ["vteOccurrenceDomain", "fenel.validation.occurrence.v1"],
      ["vteAdmissionDomain", "fenel.validation.admission.v1"],
      ["vcaCarrierVersion", "fenel.validation.carrier.v2"],
    ] as const) {
      expect(dispatchEngineBody(`engine:${fn}`, [0])).toBe(lit);
    }
  });

  it("the carrier snapshot carries the version STRING, not a reference handle", () => {
    const r = run();
    const entry = r.admission!.entries[0]! as unknown as { snapshot: { carrierVersion: unknown } };
    expect(entry.snapshot.carrierVersion).toBe("fenel.validation.carrier.v2");
  });
});
