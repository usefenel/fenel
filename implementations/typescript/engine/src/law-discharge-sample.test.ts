// expr-substrate Phase 6c — conformance tests for the sample-iteration
// discharge arm (brief:
// `workstreams/expr-substrate/briefs/phase-6c-law-tail-discharge.md`).
//
// The 66-law tail = `(instance × law-field)` pairs whose spec-record field
// is `Verified Boolean`-typed with no value, where the owning class carries
// a law DECL (forall samples + property). The discharge evaluates the
// property AS DECLARED over the sample grid (host evaluator re-entry),
// grades via the Fenel policy (`engine:sampleLawGrade`), and an all-pass
// claim is kernel re-checked (PropForall / SampleTestResult ⇒
// `SampleTested n`). A failing sample REFUTES; a thrown sample is honest
// non-evidence; zero samples cannot claim.

import { describe, it, expect } from "vitest";
import { validateSpecRecord, aggregableLength, dispatchRegistry, type FenelType } from "@fenel/engine";
import { buildProveMissingHook } from "./law-discharge";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { functionRefHandle } from "./type-foundation";

// A minimal `Verified T`-shaped field type (the `isVerifiedFieldType`
// recognizer: a single-case `$variant` whose case is named "Verified").
const VERIFIED_FIELD = {
  $variant: { cases: [{ name: "Verified", fields: [{ name: "predicate" }, { name: "evidence" }] }] },
} as unknown as FenelType;

/** A spec record type carrying one Verified-typed law field. */
const specType = (lawField: string): FenelType =>
  ({ $record: { fields: [{ name: lawField, type: VERIFIED_FIELD }] } }) as unknown as FenelType;

// ---------------------------------------------------------------------------
// The Fenel classification table — `engine:sampleLawSpec`.
// ---------------------------------------------------------------------------

describe("engine:sampleLawSpec — the field→law classification table", () => {
  it("maps aggregablePreimageRoundtrip to its class + law-decl name", () => {
    expect(dispatchEngineBody("engine:sampleLawSpec", ["aggregablePreimageRoundtrip"])).toEqual({
      tag: "SampleLaw",
      typeName: "Aggregable",
      law: "aggregable-preimage-roundtrip",
    });
  });

  it("6a-table fields and unknown fields are out-of-table (None)", () => {
    expect(dispatchEngineBody("engine:sampleLawSpec", ["labelNonEmpty"])).toEqual({ tag: "None" });
    expect(dispatchEngineBody("engine:sampleLawSpec", ["noSuchLaw"])).toEqual({ tag: "None" });
  });
});

// ---------------------------------------------------------------------------
// The Fenel grade policy — `engine:sampleLawGrade` (messages pinned
// byte-exact, prover-port-parity discipline).
// ---------------------------------------------------------------------------

describe("engine:sampleLawGrade — the sample-iteration grade policy", () => {
  it("all-pass discharges", () => {
    expect(
      dispatchEngineBody("engine:sampleLawGrade", [5, 5, 0, 0, "f", "0", "5", ""]),
    ).toEqual({ tag: "Discharged" });
  });

  it("any failing sample refutes — the verbatim counterexample message", () => {
    expect(
      dispatchEngineBody("engine:sampleLawGrade", [
        5, 3, 2, 0, "lensPutGet", "2", "5", '{"s":{}}',
      ]),
    ).toEqual({
      tag: "Refuted",
      reason:
        'sample-tested law refuted: lensPutGet: 2 of 5 sample case(s) failed; first counterexample: {"s":{}}',
    });
  });

  it("a thrown sample is honest non-evidence (a crash is not a counterexample)", () => {
    expect(
      dispatchEngineBody("engine:sampleLawGrade", [5, 4, 0, 1, "f", "0", "5", ""]),
    ).toEqual({ tag: "None" });
  });

  it("zero samples cannot claim (the kernel's samplesChecked > 0 guard, mirrored)", () => {
    expect(
      dispatchEngineBody("engine:sampleLawGrade", [0, 0, 0, 0, "f", "0", "0", ""]),
    ).toEqual({ tag: "None" });
  });
});

// ---------------------------------------------------------------------------
// End-to-end — the Aggregable family discharges through the audit's path
// (validateSpecRecord → hookFor(instance) → property eval over the inline
// samples → kernel SampleTestResult ⇒ SampleTested 5).
// ---------------------------------------------------------------------------

describe("sample-law discharge — Aggregable end-to-end", () => {
  it("aggregablePreimageRoundtrip discharges (no error) with SampleTested evidence", () => {
    const { hookFor, stats } = buildProveMissingHook();
    const methods = aggregableLength.methods as Record<string, unknown>;
    const errs = validateSpecRecord(
      specType("aggregablePreimageRoundtrip"),
      methods,
      hookFor(aggregableLength),
    );
    expect(errs).toEqual([]);
    expect(stats.sampleTested).toBe(1);
    expect(stats.refuted).toBe(0);

    // The outcome carries the kernel-graded evidence: 5 inline samples.
    const outcome = hookFor(aggregableLength)("aggregablePreimageRoundtrip", methods);
    expect(outcome).toEqual({
      status: "discharged",
      evidence: { $tag: "SampleTested", count: 5 },
    });
  });

  it("the bare (arg-less) hook also discharges Aggregable — its forall samples are inline", () => {
    const { hook, stats } = buildProveMissingHook();
    const methods = aggregableLength.methods as Record<string, unknown>;
    expect(
      validateSpecRecord(specType("aggregablePreimageRoundtrip"), methods, hook),
    ).toEqual([]);
    expect(stats.sampleTested).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Iso / Lens / Migration (seam 2) — typed-forall Exemplifiable resolution,
// inline-sample cartesian grids, and the forall-less closed-form property.
// ---------------------------------------------------------------------------

describe("sample-law discharge — Iso (typed foralls via Exemplifiable<instance-arg>)", () => {
  const isoBase64 = () =>
    dispatchRegistry
      .listInstances("Iso")
      .find((i) => i.args[0] === "String" && i.args[1] === "Bytes")!;

  it("isoDecodeEncodeRoundtrip discharges for Iso<String, Bytes> (Exemplifiable<Bytes>, 6 samples)", () => {
    const inst = isoBase64();
    const { hookFor, stats } = buildProveMissingHook();
    const methods = inst.methods as Record<string, unknown>;
    expect(
      validateSpecRecord(specType("isoDecodeEncodeRoundtrip"), methods, hookFor(inst)),
    ).toEqual([]);
    expect(stats.sampleTested).toBe(1);
    const outcome = hookFor(inst)("isoDecodeEncodeRoundtrip", methods);
    expect(outcome).toEqual({
      status: "discharged",
      evidence: { $tag: "SampleTested", count: 6 },
    });
  });

  it("isoEncodeDecodeRoundtrip discharges for Iso<String, Bytes> (Exemplifiable<String>, 5 samples)", () => {
    const inst = isoBase64();
    const { hookFor } = buildProveMissingHook();
    const outcome = hookFor(inst)(
      "isoEncodeDecodeRoundtrip",
      inst.methods as Record<string, unknown>,
    );
    expect(outcome).toEqual({
      status: "discharged",
      evidence: { $tag: "SampleTested", count: 5 },
    });
  });

  it("a typed forall WITHOUT instance args stays missing (the bare hook cannot resolve Exemplifiable)", () => {
    const inst = isoBase64();
    const { hook, stats } = buildProveMissingHook();
    const errs = validateSpecRecord(
      specType("isoDecodeEncodeRoundtrip"),
      inst.methods as Record<string, unknown>,
      hook,
    );
    expect(errs).toEqual([
      { field: "isoDecodeEncodeRoundtrip", reason: "missing Verified value (got undefined)" },
    ]);
    expect(stats.sampleTested).toBe(0);
  });

  it("a mismatched encode/decode pair REFUTES — the finding path, not a workaround", () => {
    // Synthetic broken instance: base64-encode with json-decode. decode(encode x)
    // yields Err / wrong values, so the round-trip property fails on a sample.
    const { hookFor, stats } = buildProveMissingHook();
    const broken = { args: ["String", "Bytes"] };
    const methods = { encode: "codec:base64Encode", decode: "codec:jsonDecode" };
    const outcome = hookFor(broken)("isoDecodeEncodeRoundtrip", methods);
    expect(outcome?.status).toBe("refuted");
    expect((outcome as { reason: string }).reason).toContain("sample-tested law refuted");
    expect((outcome as { reason: string }).reason).toContain("isoDecodeEncodeRoundtrip");
    expect(stats.refuted).toBe(1);
    expect(stats.sampleTested).toBe(0);
  });
});

describe("sample-law discharge — Lens (inline cartesian grids)", () => {
  const lensInst = () => dispatchRegistry.listInstances("Lens")[0]!;

  it("lensGetPut (5) / lensPutGet (30) / lensPutPut (27) all discharge for the record lens", () => {
    const inst = lensInst();
    const { hookFor, stats } = buildProveMissingHook();
    const methods = inst.methods as Record<string, unknown>;
    expect(hookFor(inst)("lensGetPut", methods)).toEqual({
      status: "discharged",
      evidence: { $tag: "SampleTested", count: 5 },
    });
    expect(hookFor(inst)("lensPutGet", methods)).toEqual({
      status: "discharged",
      evidence: { $tag: "SampleTested", count: 30 },
    });
    expect(hookFor(inst)("lensPutPut", methods)).toEqual({
      status: "discharged",
      evidence: { $tag: "SampleTested", count: 27 },
    });
    expect(stats.sampleTested).toBe(3);
  });
});

describe("sample-law discharge — Migration (forall-less closed-form property)", () => {
  it("both Migration laws discharge for both instances (SampleTested 1 — the closed-form check iterates internally)", () => {
    const { hookFor, stats } = buildProveMissingHook();
    for (const inst of dispatchRegistry.listInstances("Migration")) {
      const methods = inst.methods as Record<string, unknown>;
      expect(hookFor(inst)("migrationRoundtripLossless", methods)).toEqual({
        status: "discharged",
        evidence: { $tag: "SampleTested", count: 1 },
      });
      expect(hookFor(inst)("migrationForwardTotal", methods)).toEqual({
        status: "discharged",
        evidence: { $tag: "SampleTested", count: 1 },
      });
    }
    expect(stats.sampleTested).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// The compile-target codec demotion (Phase 6c) — the law system caught the
// 3 overclaimed Iso instances (their decode natives are documented
// unconditional-Err placeholders, so the bijectivity laws were
// unsatisfiable). They now register as what they deliver: Encodable.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DecidableMembership / Compilable / Evaluator (seam 3) — the multi-binding
// cartesian walk + the two per-case checks' laws discharged through the
// property they already delegate to (the 6b decision-2 deferral: the checks
// stay registered natives; their LAWS discharge via sample iteration).
// ---------------------------------------------------------------------------

describe("sample-law discharge — DecidableMembership (multi-binding cartesian grid)", () => {
  it("subset (36) / disjoint (36) / empty (30) soundness discharge per shape instance", () => {
    const inst = dispatchRegistry
      .listInstances("DecidableMembership")
      .find((i) => i.args[0] === "SetInterval")!;
    const { hookFor, stats } = buildProveMissingHook();
    const methods = inst.methods as Record<string, unknown>;
    expect(hookFor(inst)("decidableMembershipSubsetSoundness", methods)).toEqual({
      status: "discharged",
      evidence: { $tag: "SampleTested", count: 36 },
    });
    expect(hookFor(inst)("decidableMembershipDisjointSoundness", methods)).toEqual({
      status: "discharged",
      evidence: { $tag: "SampleTested", count: 36 },
    });
    expect(hookFor(inst)("decidableMembershipEmptySoundness", methods)).toEqual({
      status: "discharged",
      evidence: { $tag: "SampleTested", count: 30 },
    });
    expect(stats.sampleTested).toBe(3);
  });
});

describe("sample-law discharge — Compilable + Evaluator (the per-case checks' laws)", () => {
  it("compilableSemanticEquivalence discharges for the JS target (13 cases through prover:compilableSemanticCheck)", () => {
    // modules-as-values Phase 2b: the JS instance is keyed JsModule (was JsAst).
    const inst = dispatchRegistry.listInstances("Compilable").find((i) => i.args[0] === "JsModule")!;
    const { hookFor } = buildProveMissingHook();
    expect(hookFor(inst)("compilableSemanticEquivalence", inst.methods as Record<string, unknown>)).toEqual({
      status: "discharged",
      evidence: { $tag: "SampleTested", count: 13 },
    });
  });

  it("partialEvaluatorSoundness discharges for PartialStrategy (15 cases) AND vacuously for the non-PE strategies (the property's eval-guard — same claim ×4, decision 5)", () => {
    const { hookFor, stats } = buildProveMissingHook();
    for (const strategy of ["PartialStrategy", "EagerStrategy", "LazyStrategy", "JitStrategy"]) {
      const inst = dispatchRegistry.listInstances("Evaluator").find((i) => i.args[0] === strategy)!;
      expect(hookFor(inst)("partialEvaluatorSoundness", inst.methods as Record<string, unknown>)).toEqual({
        status: "discharged",
        evidence: { $tag: "SampleTested", count: 15 },
      });
    }
    expect(stats.sampleTested).toBe(4);
  });
});

describe("compile-target codecs — demoted Iso → Encodable", () => {
  it("no compile-target Iso instances remain (codec's 3 are the only Iso instances)", () => {
    const isoArgs = dispatchRegistry.listInstances("Iso").map((i) => i.args.join(","));
    expect(isoArgs.sort()).toEqual([
      "CanonicalJsonString,JsonValue",
      "String,Bytes",
      "String,JsonValue",
    ]);
  });

  it("the three targets register Encodable instances (encode-only, no decode method)", () => {
    const enc = dispatchRegistry.listInstances("Encodable");
    for (const args of [
      ["String", "JsModule"],
      ["Bytes", "WasmModule"],
      ["String", "LlvmModule"],
    ]) {
      const inst = enc.find((i) => JSON.stringify(i.args) === JSON.stringify(args));
      expect(inst).toBeDefined();
      // modules-as-values Phase 2b: `encode` holds a qualified reference.
      expect(functionRefHandle((inst!.methods as Record<string, unknown>)["encode"])).toMatch(/^compile(Js|Wasm|Llvm)\./);
      expect((inst!.methods as Record<string, unknown>)["decode"]).toBeUndefined();
    }
  });
});
