// ---------------------------------------------------------------------------
// Phase 12 — Proposition / ProofTerm as first-class FenelType ADTs
//
// Three groups of tests:
//
//   1. **Construct-op fidelity.** Propositions and proof terms built via
//      the JSON-Logic `{construct: [...]}` op produce the same `$tag`-shaped
//      values the TS helpers (`propEq`, `reflProof`, …) produce. The kernel
//      accepts both indistinguishably.
//
//   2. **Catalog registration.** The `Proposition` / `ProofTerm` /
//      `UnprovedReason` / `EpistemicStatus` / `VerifyError` entities are
//      registered in the prover module's `entities` array and surface
//      through `getSystemRegistry().listEntities()`.
//
//   3. **`PropMonotonic` worked example.** A brand-new proposition shape
//      declared as a separate ADT (no edits to the closed `Proposition` sum,
//      no kernel rule changes) is provable end-to-end through the Prover
//      typeclass — read an aggregator's `Aggregable.monotonicity` field,
//      emit a kernel-verifiable proof term, accept on `Monotone`, refute
//      on `Antitone` / `Neither`. This proves the substrate is closed:
//      adding a new law shape requires no TS code in the kernel.
//
// All three live in this dedicated file so the Phase 12 promotion is
// captured in one self-contained suite; the existing `prover.test.ts` is
// the regression suite for the Phase 4 + Phase 8 surface and keeps
// running unchanged (with the proposition shapes migrated to `$tag`).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  type EqProposition,
  type SubsetProposition,
  type ForallProposition,
  propEq,
  propSubset,
  propDisjoint,
  propEmpty,
  propForall,
  reflProof,
  decidableSetProof,
  sampleTestProof,
  isProposition,
  KNOWN_PROPOSITION_TAGS,
} from "./prover";
import { verify } from "./kernel";
import {
  decidableSetProposerNative,
  reductionProverNative,
  sampleTestProverNative,
  monotonicityProverNative,
  kernelVerifyNative,
} from "./modules/prover";
import { evaluate, type EvaluateContext } from "./json-logic";
import { getSystemRegistry } from "./system-registry";
import { engineModule } from "./modules/engine";
import type { SetExpr } from "./types";
// ---------------------------------------------------------------------------
// Group 1 — Construct-op fidelity
//
// The `{construct: ["PropEq", T, x, y]}` form is the canonical Fenel-side
// way to build a proposition. It must produce the same `$tag`-tagged
// record shape the TS helpers emit, since the kernel pattern-matches
// `$tag` regardless of construction path.
// ---------------------------------------------------------------------------

describe("Phase 12 — Proposition values via {construct: [...]}", () => {
  it("PropEq via construct produces the same shape as propEq()", () => {
    const ctx: EvaluateContext = {};
    const expr = {
      construct: ["PropEq", { $ref: "Number" }, 5, 5],
    };
    const built = evaluate(expr, {}, ctx);
    expect(built).toEqual({
      $tag: "PropEq",
      // Phase 10a-6: positional construction emits `_<idx>` keys
      // unconditionally. Named-record construction (next test) is the
      // path that preserves declared field names; the kernel reads the
      // well-known field names regardless.
      "_0": { $ref: "Number" },
      "_1": 5,
      "_2": 5,
    });
  });

  it("PropEq via the named-record literal matches the kernel's expected shape", () => {
    // Named-record construction — what a `.fenel` body produces when
    // the developer writes `PropEq { type = Number, lhs = 5, rhs = 5 }`.
    const ctx: EvaluateContext = {
      _constructors: {
        PropEq: ["type", "lhs", "rhs"],
      },
    };
    const expr = {
      construct: ["PropEq", { type: { $ref: "Number" }, lhs: 5, rhs: 5 }],
    };
    const built = evaluate(expr, {}, ctx) as EqProposition;
    expect(built.$tag).toBe("PropEq");
    expect(built.lhs).toBe(5);
    expect(built.rhs).toBe(5);
    expect(built.type).toEqual({ $ref: "Number" });

    // The kernel accepts the constructed value identically to the TS-helper version.
    const proof = reflProof(5);
    const result = verify(built, proof);
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") {
      expect(result._0.$tag).toBe("Proven");
    }
  });

  it("PropSubset via construct + kernel.verify accepts a $enum subset", () => {
    const ctx: EvaluateContext = {
      _constructors: {
        PropSubset: ["s", "t"],
      },
    };
    const s: SetExpr = { $tag: "SeEnum", values: [1, 2] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const expr = { construct: ["PropSubset", { s, t }] };
    const built = evaluate(expr, {}, ctx) as SubsetProposition;
    expect(built.$tag).toBe("PropSubset");

    const proof = decidableSetProof("subset", { left: s, right: t });
    const result = verify(built, proof);
    expect(result.$tag).toBe("Ok");
  });

  it("isProposition accepts construct-built values and rejects junk", () => {
    expect(isProposition(propEq({ $ref: "Number" }, 1, 1))).toBe(true);
    expect(isProposition(propSubset({ $enum: [1] }, { $enum: [1, 2] }))).toBe(true);
    expect(isProposition(propDisjoint({ $enum: [1] }, { $enum: [2] }))).toBe(true);
    expect(isProposition(propEmpty({ $none: true }))).toBe(true);
    expect(isProposition(propForall({ name: "x", type: { $ref: "Number" } }, "Test.law", [1]))).toBe(true);

    // Open-extension shapes — recognised via the `Prop` prefix.
    expect(isProposition({ $tag: "PropMonotonic", agg: "length" })).toBe(true);

    // Non-Proposition values.
    expect(isProposition({ $tag: "Refl", value: 1 })).toBe(false);
    expect(isProposition({ $tag: "Just", _0: 1 })).toBe(false);
    expect(isProposition(42)).toBe(false);
    expect(isProposition(null)).toBe(false);
    expect(isProposition("Prop")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group 2 — Catalog registration (RE-PINNED at decide-substrate Phase 2 K4)
//
// The closed Proposition / ProofTerm sums are RETIRED: the claim currency is
// the registered `Judgment` (JEmpty / JInhabited, engine/judgment.fenel); the
// Prop*/proof tags survive as MARKER vocabulary (structural pattern matching,
// TS `$`-key builders). The auxiliary ADTs (UnprovedReason / EpistemicStatus /
// VerifyError / PropMonotonic / ProofStrategy) stay registered.
// ---------------------------------------------------------------------------

describe("K4 — the closed sums are RETIRED; Judgment is the registered claim currency", () => {
  const registry = getSystemRegistry();

  it("Proposition entity is GONE (retired into the judgment + builder faces)", () => {
    expect(registry.getEntity("Proposition")).toBeUndefined();
  });

  it("ProofTerm entity is GONE (the proof tags survive as marker vocabulary)", () => {
    expect(registry.getEntity("ProofTerm")).toBeUndefined();
  });

  it("Judgment is registered with the 2-polarity case roster (the engine module — engine ∉ system registry, the P5 rule)", () => {
    const entity = (engineModule.entities ?? []).find((e) => e.id === "Judgment");
    expect(entity).toBeDefined();
    const variant = (entity!.type as { $variant?: { cases: { name: string }[] } }).$variant;
    expect(variant!.cases.map((c) => c.name)).toEqual(["JEmpty", "JInhabited"]);
  });

  it("the builder faces are registered (constructors are calls)", () => {
    const ids = new Set((engineModule.functions ?? []).map((f) => f.id));
    expect(ids.has("engine:propSubset")).toBe(true);
    expect(ids.has("engine:propDisjoint")).toBe(true);
    expect(ids.has("engine:propEmpty")).toBe(true);
    expect(ids.has("engine:propInhabited")).toBe(true);
  });

  it("Auxiliary ADTs (UnprovedReason / EpistemicStatus / VerifyError) registered", () => {
    expect(registry.getEntity("UnprovedReason")).toBeDefined();
    expect(registry.getEntity("EpistemicStatus")).toBeDefined();
    expect(registry.getEntity("VerifyError")).toBeDefined();
  });

  it("Open-extension shape (PropMonotonic) registered as its own entity", () => {
    const entity = registry.getEntity("PropMonotonic");
    expect(entity).toBeDefined();
    const variant = (entity!.type as { $variant?: { cases: { name: string }[] } }).$variant;
    expect(variant!.cases.map((c) => c.name)).toEqual(["PropMonotonic"]);
  });

  it("KNOWN_PROPOSITION_TAGS lists the closed kernel-known shapes", () => {
    expect(KNOWN_PROPOSITION_TAGS).toEqual([
      "PropEq",
      "PropSubset",
      "PropDisjoint",
      "PropEmpty",
      "PropInhabited",
      "PropForall",
    ]);
  });

  it("kernel:verify is registered as a Fenel function", () => {
    const fn = registry.getFunction("kernel:verify");
    expect(fn).toBeDefined();
    expect(fn!.params.map((p) => p.name)).toEqual(["proposition", "proof"]);
  });

  it("Prover instances are registered for every kernel-known proposition shape", () => {
    // The function-registry doesn't expose typeclass instances directly,
    // but the natives table is keyed by fn-id and lets us at least verify
    // the proposers are reachable.
    const fn = registry.getFunction("prover:decidableSetProver");
    expect(fn).toBeDefined();
    expect(registry.getFunction("prover:reductionProver")).toBeDefined();
    expect(registry.getFunction("prover:sampleTestProver")).toBeDefined();
    expect(registry.getFunction("prover:monotonicityProver")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Group 3 — Kernel-verify regression
//
// Phase 12 swapped the proposition discriminator from `$prop` to `$tag`.
// The kernel should still accept identical inputs identically.
// ---------------------------------------------------------------------------

describe("Phase 12 — kernel.verify regression vs Phase 4 behaviour", () => {
  it("PropEq + Refl: same kernel acceptance as Phase 4", () => {
    const prop = propEq({ $ref: "Number" }, 7, 7);
    const result = verify(prop, reflProof(7));
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") expect(result._0.$tag).toBe("Proven");
  });

  it("PropSubset + DecidableSetResult: SolverChecked status", () => {
    const s: SetExpr = { $tag: "SeEnum", values: [1] };
    const t: SetExpr = { $tag: "SeEnum", values: [1, 2, 3] };
    const result = verify(propSubset(s, t), decidableSetProof("subset", { left: s, right: t }));
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") expect(result._0.$tag).toBe("SolverChecked");
  });

  it("PropForall + SampleTestResult: SampleTested status with samples count", () => {
    const prop: ForallProposition = propForall(
      { name: "x", type: { $ref: "Number" } },
      "Regress.identity",
      [1, 2, 3],
    );
    const result = verify(prop, sampleTestProof("Regress.identity", 3, true));
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok" && result._0.$tag === "SampleTested") {
      expect(result._0.samplesChecked).toBe(3);
    }
  });

  it("kernelVerify native matches verify() output identically", () => {
    const prop = propEq({ $ref: "Number" }, 1, 1);
    const proof = reflProof(1);
    const direct = verify(prop, proof);
    const viaFenel = kernelVerifyNative(prop, proof);
    expect(viaFenel).toEqual(direct);
  });
});

// ---------------------------------------------------------------------------
// Group 4 — PropMonotonic worked example
//
// Phase 12 completeness criterion. Adding a new law-shape (`PropMonotonic`)
// involves only:
//
//   1. Declaring the ADT entity (in `modules/prover.ts` — Fenel side).
//   2. Registering a Prover instance (`MonotonicityProver`) keyed off
//      the new `$tag`.
//   3. Writing a proposer body that reads `Aggregable[aggName].monotonicity`
//      and emits a kernel-compatible proof term.
//
// The kernel itself is unchanged — the new proposer rides the existing
// SampleTestResult rule. This demonstrates the brief's "no TS code per
// law" claim: the trust boundary stays put; new shapes plug in at the
// dispatch layer.
// ---------------------------------------------------------------------------

describe("Phase 12 — PropMonotonic worked example (Aggregable monotonicity)", () => {
  // Ensure the system registry is built — this triggers Aggregable
  // instance registration as a side-effect (Phase 9 ships
  // `aggregableSum` with `monotonicity: { $tag: "Monotone" }`).
  getSystemRegistry();

  it("PropMonotonic 'sum' is provable — sum's Aggregable instance is Monotone", () => {
    const prop = { $tag: "PropMonotonic" as const, agg: "sum" };
    const out = monotonicityProverNative(prop);
    expect(out.$tag).toBe("Ok");
    if (out.$tag === "Ok") {
      // The proof maps onto the existing SampleTestResult kernel rule —
      // no kernel changes were needed to land this new proposition shape.
      expect(out._0.$tag).toBe("SampleTestResult");
      if (out._0.$tag === "SampleTestResult") {
        expect(out._0.propertyId).toBe("Monotonic.sum");
        expect(out._0.samplesChecked).toBe(1);
        expect(out._0.allPassed).toBe(true);
      }
    }
  });

  it("PropMonotonic 'length' is refuted — length's monotonicity is Neither", () => {
    // `length`'s Aggregable instance carries `monotonicity: { $tag: "Neither" }`
    // (see `modules/aggregable.ts:aggregableLength`). The proposer reports
    // a WitnessError — the Prover surface flags this as a counterexample
    // to the monotonicity claim.
    const prop = { $tag: "PropMonotonic" as const, agg: "length" };
    const out = monotonicityProverNative(prop);
    expect(out.$tag).toBe("Err");
    if (out.$tag === "Err") {
      expect(out._0.$tag).toBe("WitnessError");
      if (out._0.$tag === "WitnessError") {
        expect((out._0.counterexample as { agg: string }).agg).toBe("length");
      }
    }
  });

  it("PropMonotonic 'unknown-agg' surfaces Undecided (no Aggregable instance)", () => {
    const prop = { $tag: "PropMonotonic" as const, agg: "not-an-aggregator" };
    const out = monotonicityProverNative(prop);
    expect(out.$tag).toBe("Err");
    if (out.$tag === "Err") {
      expect(out._0.$tag).toBe("Undecided");
    }
  });

  it("MonotonicityProver returns OutOfScope for non-PropMonotonic shapes", () => {
    const prop: EqProposition = propEq({ $ref: "Number" }, 1, 1);
    const out = monotonicityProverNative(prop);
    expect(out.$tag).toBe("Err");
    if (out.$tag === "Err") {
      expect(out._0.$tag).toBe("OutOfScope");
    }
  });

  it("End-to-end: PropMonotonic 'sum' → propose → kernel verify → accepted", () => {
    // The end-to-end Prover dance: propose a proof term → re-check it
    // via the kernel. The kernel happily accepts the SampleTestResult
    // mapped from PropMonotonic to a PropForall-shaped claim because
    // the proposer constructs a propertyId-keyed sample-tested proof
    // and the kernel's SampleTestResult rule cares only about (allPassed,
    // samplesChecked, propertyId-match). To run that end-to-end, we
    // build the matching PropForall on the verify side — this is the
    // same adapter pattern future law mechanisations would use to
    // re-route open-extension shapes through the closed kernel rules
    // without growing the TCB.
    const prop = { $tag: "PropMonotonic" as const, agg: "sum" };
    const out = monotonicityProverNative(prop);
    expect(out.$tag).toBe("Ok");
    if (out.$tag !== "Ok") return;
    // The proposer produced a SampleTestResult; the kernel rule expects
    // a PropForall proposition. The adapter is one-line: emit a
    // PropForall whose propertyId matches the proof term's propertyId,
    // sample list is anything non-empty (the kernel only checks the
    // proof's `samplesChecked` field, not the proposition's `samples`).
    const adapter: ForallProposition = propForall(
      { name: "x", type: { $ref: "Any" } },
      "Monotonic.sum",
      [null], // placeholder — kernel doesn't iterate
    );
    const result = verify(adapter, out._0);
    expect(result.$tag).toBe("Ok");
    if (result.$tag === "Ok") {
      expect(result._0.$tag).toBe("SampleTested");
    }
  });
});

// ---------------------------------------------------------------------------
// Group 5 — Phase 4 proposers still operate uniformly on the new shape
//
// Spot-check the other three proposers with `propEq` / `propSubset` etc.
// helper-built propositions to confirm no regression.
// ---------------------------------------------------------------------------

describe("Phase 12 — Phase 4 proposers operate uniformly on $tag-shaped values", () => {
  it("decidableSetProposer accepts PropSubset built via propSubset()", () => {
    const prop = propSubset({ $tag: "SeEnum", values: [1, 2] } as SetExpr, { $tag: "SeEnum", values: [1, 2, 3] } as SetExpr);
    const out = decidableSetProposerNative(prop);
    expect(out.$tag).toBe("Ok");
  });

  it("reductionProver accepts PropEq built via propEq()", () => {
    const prop = propEq({ $ref: "Number" }, 99, 99);
    const out = reductionProverNative(prop);
    expect(out.$tag).toBe("Ok");
  });

  it("sampleTestProver declines unevaluated PropForall built via propForall()", () => {
    const prop = propForall(
      { name: "x", type: { $ref: "Number" } },
      "Phase12.spot",
      [1, 2, 3],
    );
    const out = sampleTestProverNative(prop);
    expect(out.$tag).toBe("Err");
    if (out.$tag === "Err") expect(out._0.$tag).toBe("Undecided");
  });
});
