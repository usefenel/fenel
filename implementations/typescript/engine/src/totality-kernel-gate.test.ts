// ---------------------------------------------------------------------------
// unified-static-analysis Phase 3g — THE TOTALITY KERNEL GATE (the soundness
// payload). Brief:
// `workstreams/unified-static-analysis/briefs/phase-3g-totality-kernel-gate.md`.
//
// Groups A–C built the prover substrate; phases 1→3f built a SOUND, advisory
// totality checker — but nothing CONSUMED its verdict, so the runtime-proofs
// headline was UNSOUND: a `PropForall x. P(x)` "proven" by sample-testing `P`
// over a NON-total subject is unsound (the samples may diverge / the all-pass is
// vacuous). 3g closes the hole: the kernel's `SampleTestResult`/`PropForall` arm
// (`kernel.fenel:vpSample`) now REJECTS when the subject function's totality
// verdict is `Unknown` or `Partial` — `verify` returns `Err NonTotal`.
//
// THE TWO-SIDED OBLIGATION exercised here:
//   (a) SOUNDNESS — a PropForall over an Unknown/Partial subject REJECTS.
//   (b) NO-FALSE-REJECT — the SAME proof over a Total subject (and the existing
//       no-subject corpus, covered by prover.test.ts &c.) STILL proves.
//   (c) SampleTestResult-ONLY — Refl / DecidableSetResult are UNAFFECTED by the
//       verdict (neither quantifies over a function's totality, D-3g-2).
//   (d) CONSERVATIVE on resolution failure — an unresolvable subject fn ⇒
//       Unknown ⇒ reject (never a silent Total); a CERTIFIED native leaf
//       (analyze.fenel anaCertifiedNativeLeaves) is the trusted termination
//       base ⇒ Total ⇒ proves, while a native that evaluates caller-supplied
//       code is Unknown (2026-10-03).
//
// The gate is exercised end-to-end through `verify` two ways: via a PRE-COMPUTED
// verdict tag (the eqs/decision precedent — deterministic), and via a `fnId` the
// delegate resolves through the shipped Fenel `analyze`/`totalityVerdict`
// (`subjectTotalityVerdict` — proving the registry → lower → Fenel-analyze
// computation path actually works on a real registered function).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import { verify, subjectTotalityVerdict } from "./kernel";
import { subjectTotalityForLaw } from "./law-discharge";
import {
  propForall,
  propEq,
  propSubset,
  sampleTestProof,
  reflProof,
  decidableSetProof,
} from "./prover";
import type { ForallProposition, ProofTerm } from "./prover";
import type { SetExpr } from "./types";

// A PropForall + its matching SampleTestResult proof (allPassed, n > 0) — the
// shape that, pre-3g, ALWAYS certified SampleTested. The gate now interposes the
// subject's totality verdict.
function forallAndProof(): { prop: ForallProposition; proof: ProofTerm } {
  const prop = propForall({ name: "x", type: { $ref: "Number" } }, "Law.identity", [1, 2, 3]);
  const proof = sampleTestProof("Law.identity", 3, true);
  return { prop, proof };
}

// ---------------------------------------------------------------------------
// (a) SOUNDNESS — the headline: a non-total subject REJECTS.
// ---------------------------------------------------------------------------

describe("3g — SOUNDNESS: a PropForall over a non-total subject rejects (NonTotal)", () => {
  it("verdict Unknown ⇒ Err NonTotal (the checker has not proven termination)", () => {
    const { prop, proof } = forallAndProof();
    const result = verify(prop, proof, { verdict: "Unknown" });
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("NonTotal");
      if (result._0.$tag === "NonTotal") {
        expect(result._0.reason).toContain("Unknown");
      }
    }
  });

  it("verdict Partial ⇒ Err NonTotal (declared @partial / provably non-total)", () => {
    const { prop, proof } = forallAndProof();
    const result = verify(prop, proof, { verdict: "Partial" });
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") {
      expect(result._0.$tag).toBe("NonTotal");
      if (result._0.$tag === "NonTotal") {
        expect(result._0.reason).toContain("Partial");
      }
    }
  });

  it("the gate fires BEFORE the shape checks — a non-total subject rejects even with an otherwise-valid claim", () => {
    // allPassed + propertyId match + n > 0 would certify SampleTested pre-3g;
    // the NonTotal verdict pre-empts it.
    const { prop, proof } = forallAndProof();
    const ok = verify(prop, proof); // no subject ⇒ inert ⇒ proves (baseline)
    expect(ok.$tag).toBe("Ok");
    const gated = verify(prop, proof, { verdict: "Partial" });
    expect(gated.$tag).toBe("Err");
    if (gated.$tag === "Err") expect(gated._0.$tag).toBe("NonTotal");
  });
});

// ---------------------------------------------------------------------------
// (b) NO-FALSE-REJECT — a Total subject (and no-subject) STILL proves.
// ---------------------------------------------------------------------------

describe("3g — NO-FALSE-REJECT: a Total subject (and no subject) still proves SampleTested", () => {
  it("verdict Total ⇒ Ok SampleTested n (unchanged from pre-3g)", () => {
    const { prop, proof } = forallAndProof();
    const result = verify(prop, proof, { verdict: "Total" });
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") {
      expect(result._0.$tag).toBe("SampleTested");
      if (result._0.$tag === "SampleTested") expect(result._0.samplesChecked).toBe(3);
    }
  });

  it("no subject supplied ⇒ the gate is inert ⇒ Ok SampleTested (byte-identical to the 2-arg corpus)", () => {
    const { prop, proof } = forallAndProof();
    const result = verify(prop, proof);
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") expect(result._0.$tag).toBe("SampleTested");
  });

  it("empty verdict string ⇒ inert ⇒ proves (the no-Fenel-function-subject case)", () => {
    const { prop, proof } = forallAndProof();
    const result = verify(prop, proof, { verdict: "" });
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") expect(result._0.$tag).toBe("SampleTested");
  });
});

// ---------------------------------------------------------------------------
// (c) The gate is SampleTestResult-ONLY — Refl / DecidableSetResult unaffected.
// ---------------------------------------------------------------------------

describe("3g — SampleTestResult-only: Refl / DecidableSetResult ignore the verdict (D-3g-2)", () => {
  it("Refl over a PropEq still proves Proven even with verdict Unknown", () => {
    const prop = propEq({ $ref: "Number" }, 7, 7);
    const result = verify(prop, reflProof(7), { verdict: "Unknown" });
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") expect(result._0.$tag).toBe("Proven");
  });

  it("DecidableSetResult over a PropSubset still proves SolverChecked even with verdict Partial", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const prop = propSubset(s, t);
    const proof = decidableSetProof("subset", { left: s, right: t });
    const result = verify(prop, proof, { verdict: "Partial" });
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") expect(result._0.$tag).toBe("SolverChecked");
  });
});

// ---------------------------------------------------------------------------
// (d) The verdict COMPUTATION path — `subjectTotalityVerdict` over real
// registered functions (registry → lower → shipped Fenel analyze), and the
// conservative resolution-failure default. Wired end-to-end through `verify`
// via the `fnId` arm.
// ---------------------------------------------------------------------------

describe("3g — subjectTotalityVerdict: the shipped-Fenel-analyze computation path", () => {
  it("a registered Fenel-bodied total function resolves Total (std:not — analyzed, non-recursive)", () => {
    expect(subjectTotalityVerdict("std:not")).toBe("Total");
  });

  it("a certified terminating native leaf ⇒ Total (std:head)", () => {
    // std:head is bodyless (a native) and certified (analyze.fenel
    // anaCertifiedNativeLeaves). std:map used to stand in for a native leaf,
    // but it is Fenel-bodied now; it read Total only because its bare self-call
    // `map` never matched the id `std:map` (the vacuous-gate bug).
    expect(subjectTotalityVerdict("std:head")).toBe("Total");
  });

  it("std:appendItem is Total: the list literal in its body is a construction, not a self-call", () => {
    // appendItem item arr = concat arr [item] — `[item]` lowers to a synthetic
    // `appendItem item []` the evaluator never calls; it read as non-decreasing
    // self-recursion, and every caller of a list literal inherited Unknown.
    expect(subjectTotalityVerdict("std:appendItem")).toBe("Total");
  });

  it("a native that evaluates caller-supplied code is not assumed to terminate ⇒ Unknown", () => {
    // std:evalExpr evaluates an expression value; std:validateValue evaluates
    // the refinements a type carries; control:retry runs a function id. Before
    // 2026-10-03 every bodyless subject read Total.
    expect(subjectTotalityVerdict("std:evalExpr")).toBe("Unknown");
    expect(subjectTotalityVerdict("std:validateValue")).toBe("Unknown");
    expect(subjectTotalityVerdict("control:retry")).toBe("Unknown");
  });

  it("a native whose loop bound is a caller-supplied number is not certified ⇒ Unknown", () => {
    // image-ops.ts loops y < height over the caller's image record: for
    // {width: 0, height: 1e20, pixels: []} it allocates nothing (new Array(0))
    // and the row counter stalls at 2^53 (y + 1 === y). The verdict is read
    // here; the loop is never run.
    for (const id of [
      "std:imageFlipHorizontal",
      "std:imageInvert",
      "std:imageMedian",
      "std:imageCrop",
      "std:imagePixelate",
      "std:imageDither",
      "std:imageOverlay",
    ]) {
      expect(subjectTotalityVerdict(id)).toBe("Unknown");
    }
  });

  it("an image native whose loops stay inside its own allocation stays Total", () => {
    // imgResize / imgSolid / imgRotate180 first allocate new Array(w * h), which
    // throws unless w * h is an integer below 2^32, and loop within it.
    for (const id of ["std:imageResize", "std:imageSolid", "std:imageRotate180"]) {
      expect(subjectTotalityVerdict(id)).toBe("Total");
    }
  });

  it("a native whose host act runs a Fenel function is not certified ⇒ Unknown", () => {
    // io:emit runs events:emitEvent, whose trigger dispatch runs the event's
    // subscribers; telegram:startCollectorEntry runs telegram:startTelegramForm
    // with the caller's hook functions.
    expect(subjectTotalityVerdict("io:emit")).toBe("Unknown");
    expect(subjectTotalityVerdict("telegram:startCollectorEntry")).toBe("Unknown");
    // templates:render_template is declared to evaluate the template function
    // its caller names by slug.
    expect(subjectTotalityVerdict("templates:render_template")).toBe("Unknown");
  });

  it("a Fenel-bodied recursion the size-change checker cannot certify is Unknown (std:map)", () => {
    // `map fn (fromMaybe [] (tail arr))`: the array-tail descent is outside the
    // size-change abstraction, so the gate must not read Total.
    expect(subjectTotalityVerdict("std:map")).toBe("Unknown");
  });

  it("an unresolvable fn id ⇒ Unknown (conservative resolution failure — never a silent Total)", () => {
    expect(subjectTotalityVerdict("no:such:function")).toBe("Unknown");
  });

  it("verify resolves the subject via fnId: a Total subject proves SampleTested", () => {
    const { prop, proof } = forallAndProof();
    const result = verify(prop, proof, { fnId: "std:not" });
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") expect(result._0.$tag).toBe("SampleTested");
  });

  it("verify resolves the subject via fnId: an unresolvable subject ⇒ Unknown ⇒ Err NonTotal", () => {
    const { prop, proof } = forallAndProof();
    const result = verify(prop, proof, { fnId: "no:such:function" });
    expect(result.$tag).toBe("Err");
    if (result.$tag === "Err") expect(result._0.$tag).toBe("NonTotal");
  });
});

// ---------------------------------------------------------------------------
// unified-static-analysis Phase 3h — THE GATE BITES ON THE PRODUCTION PATH.
// `subjectTotalityForLaw` is the discharge-seam gather+join (route a: the
// `{var: methodName}` references the law's `property` names → the instance
// `methods` fnIds → the shipped `subjectTotalityVerdict` per fnId → the Fenel
// `engine:joinVerdict` conservative meet). Threaded into `dischargeSampleLaw`'s
// `verify(...)` call, it engages the 3g kernel gate on the real law-discharge
// path. These cases prove the join (a) BITES on a non-total subject method, (b)
// stays inert (Total) on a Total/native subject, (c) does NOT mistake the
// instance's non-function data fields (monotonicity / label) for subjects, and
// (d) folds an empty subject set (no method-var in the property — the trusted-
// native law-harness families) to Total.
// ---------------------------------------------------------------------------

describe("3h — subjectTotalityForLaw: the discharge-path gate bites on a non-total subject method", () => {
  it("a property naming a non-total (unresolvable) method ⇒ joined verdict Unknown ⇒ verify Err NonTotal", () => {
    const property = { call: [{ var: "badMethod" }, { var: "x" }] };
    const methods = { badMethod: "no:such:function", label: "ignored" };
    const verdict = subjectTotalityForLaw(property, methods);
    expect(verdict).toBe("Unknown");
    const { prop, proof } = forallAndProof();
    const r = verify(prop, proof, { verdict });
    expect(r.$tag).toBe("Err");
    if (r.$tag === "Err") expect(r._0.$tag).toBe("NonTotal");
  });

  it("a property naming only a Total/native method ⇒ joined verdict Total ⇒ verify Ok SampleTested", () => {
    const property = { call: [{ var: "view" }, { var: "x" }] };
    const methods = { view: "std:not", monotonicity: { $tag: "Neither" }, label: "x" };
    const verdict = subjectTotalityForLaw(property, methods);
    expect(verdict).toBe("Total");
    const { prop, proof } = forallAndProof();
    const r = verify(prop, proof, { verdict });
    expect(r.$tag).toBe("Ok");
    if (r.$tag === "Ok") expect(r._0.$tag).toBe("SampleTested");
  });

  it("non-function data fields (monotonicity / label) are NOT subjects ⇒ no spurious Unknown", () => {
    const property = { deepEq: [{ var: "monotonicity" }, { var: "label" }] };
    const methods = { monotonicity: { $tag: "Neither" }, label: "length Aggregable" };
    expect(subjectTotalityForLaw(property, methods)).toBe("Total");
  });

  it("a property whose only vars are forall bindings ⇒ empty subject set ⇒ Total (the trusted-native families)", () => {
    // The Aggregable-shaped property: a literal `@native` harness head + the
    // `case` forall var. No `{var}` resolves through `methods`, so the subject
    // set is empty (the harness native is Total by policy, not gathered).
    const property = { call: ["aggregable:preimageRoundtripCheck", { var: "case" }] };
    const methods = {
      imageOf: "aggregable:lengthImageOf",
      preimageOf: "aggregable:lengthPreimageOf",
      label: "length Aggregable",
    };
    expect(subjectTotalityForLaw(property, methods)).toBe("Total");
  });

  it("a multi-subject property joins conservatively (one non-total ⇒ the whole proof rejects)", () => {
    // Iso-shaped: encode total (std:not), decode non-total (unresolvable).
    const property = {
      match: [
        { call: [{ var: "encode" }, { var: "x" }] },
        { $tag: "Ok", _0: { $bind: "_s" } },
        { call: [{ var: "decode" }, { var: "_s" }] },
      ],
    };
    const methods = { encode: "std:not", decode: "no:such:function" };
    expect(subjectTotalityForLaw(property, methods)).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// modules-as-values — a method field may hold a function REFERENCE
// (`{$ref: handle}`) instead of an id string. The gather used to keep strings
// only, so a referenced non-total subject was DROPPED and the join read Total:
// the gate stopped biting. A reference is now a subject exactly like the same
// function's id string (`subjectTotalityVerdict` resolves any handle).
// ---------------------------------------------------------------------------

describe("3h — a referenced method is a totality subject like its id string", () => {
  it("Lens-shaped: an unresolvable `view` reference ⇒ Unknown, as the string ⇒ Unknown", () => {
    const property = { call: [{ var: "view" }, { var: "x" }] };
    expect(subjectTotalityForLaw(property, { view: "no:such:function" })).toBe("Unknown");
    expect(subjectTotalityForLaw(property, { view: { $ref: "no:such:function" } })).toBe("Unknown");
  });

  it("Lens-shaped: a Total/native `view` reference ⇒ Total, as the string ⇒ Total (no false reject)", () => {
    const property = { call: [{ var: "view" }, { var: "x" }] };
    expect(subjectTotalityForLaw(property, { view: "std:not" })).toBe("Total");
    expect(subjectTotalityForLaw(property, { view: { $ref: "std:not" } })).toBe("Total");
    // A dotted handle names the same function.
    expect(subjectTotalityForLaw(property, { view: { $ref: "std.not" } })).toBe("Total");
  });

  it("Compilable-shaped: a `compile` reference fed to the harness is a subject", () => {
    const property = {
      deepEq: [
        { call: ["prover:compilableSemanticCheck", { var: "case" }, { var: "compile" }] },
        { $tag: "Just", _0: true },
      ],
    };
    expect(subjectTotalityForLaw(property, { compile: "no:such:function" })).toBe("Unknown");
    expect(subjectTotalityForLaw(property, { compile: { $ref: "no:such:function" } })).toBe("Unknown");
  });

  it("the multi-subject join stays conservative when one subject is a reference", () => {
    const property = {
      match: [
        { call: [{ var: "encode" }, { var: "x" }] },
        { $tag: "Ok", _0: { $bind: "_s" } },
        { call: [{ var: "decode" }, { var: "_s" }] },
      ],
    };
    expect(subjectTotalityForLaw(property, { encode: { $ref: "std:not" }, decode: { $ref: "no:such:function" } })).toBe("Unknown");
  });

  it("only a reference counts: an empty handle, an inherited `$ref` and a constructor value are not subjects", () => {
    const property = { call: [{ var: "view" }, { var: "x" }] };
    expect(subjectTotalityForLaw(property, { view: { $ref: "" } })).toBe("Total");
    expect(subjectTotalityForLaw(property, { view: Object.create({ $ref: "no:such:function" }) })).toBe("Total");
    // A Just holding a STRING is data (a `Maybe String`), not a subject.
    expect(subjectTotalityForLaw(property, { view: { $tag: "Just", _0: "no:such:function" } })).toBe("Total");
  });

  it("modules-as-values Phase 2d — a Just holding a REFERENCE (Migration's `backward`) is a subject", () => {
    const property = { call: ["migration:roundtripCheck", { var: "forward" }, { var: "backward" }] };
    expect(subjectTotalityForLaw(property, {
      forward: { $ref: "std.not" },
      backward: { $tag: "Just", _0: { $ref: "no:such:function" } },
    })).toBe("Unknown");
    expect(subjectTotalityForLaw(property, {
      forward: { $ref: "std.not" },
      backward: { $tag: "Just", _0: { $ref: "std.not" } },
    })).toBe("Total");
    // Nothing, an inherited `_0`, and a Just around an inherited `$ref` are not subjects.
    expect(subjectTotalityForLaw(property, { forward: { $ref: "std.not" }, backward: { $tag: "Nothing" } })).toBe("Total");
    const inherited = Object.assign(Object.create({ _0: { $ref: "no:such:function" } }), { $tag: "Just" });
    expect(subjectTotalityForLaw(property, { forward: { $ref: "std.not" }, backward: inherited })).toBe("Total");
    expect(subjectTotalityForLaw(property, {
      forward: { $ref: "std.not" },
      backward: { $tag: "Just", _0: Object.create({ $ref: "no:such:function" }) },
    })).toBe("Total");
  });
});
