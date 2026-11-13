// ---------------------------------------------------------------------------
// module-migrate-prover.test.ts — module-substrate Phase 3i (close-out) parity
// proof. The both-maps CAPSTONE.
//
// prover is a PARTIAL 3/7 both-maps module: 3 of its 7 natives register in BOTH
// the plain `nativeImpls` AND the ctx `nativeImplsCtx` map (reductionProver /
// compilableSemanticCheck / partialEvaluatorSoundnessCheck re-enter the
// evaluator when a ctx is threaded). This is a PARITY migration — the ~1178-LOC
// hand-assembled engine/src/modules/prover.ts (7 defineFunction specs + 6 inline
// `$variant` entity literals + inline native impls) was replaced by types.fenel
// (`module prover where` + 6 @native decls + 6 entity `data` decls) +
// ffi/prover-ffi.ts (the 7 impls + the plain & ctx maps) + a thin seam, with the
// instances.fenel sidecar (8 Prover instances) UNCHANGED. NOTHING dropped.
//
// Three reconciliations this proof locks:
//   1. codeName ≠ fnId-suffix on the 4 *Propose fns: fnId `prover:<name>`,
//      codeName + native-map key `<name>Propose` (the native key rides the
//      CODENAME via rekey, NOT the fnId). Asserted for decidableSetProver +
//      reductionProver (the brief's "assert all three" requirement).
//   2. `kernel:verify` cross-prefix: re-id'd from `prover:kernelVerify`; its
//      native re-added at the explicit `kernel:kernelVerify` key.
//   3. PARTIAL 3/7 both-maps: plain holds all 7 (+ the cross-prefix kernel key),
//      ctx holds exactly the 3 overlap fns — seam-routed, no marker (axis #4).
// ---------------------------------------------------------------------------

import { beforeAll, test, expect, describe } from "bun:test";
import {
  proverModule,
  decidableSetProposerNative,
  kernelVerifyNative,
  isPropositionShape,
  structuralProverInstance,
  smtProverInstance,
} from "./modules/prover";
import { createRegistry } from "./registry";
import { repositoryIdentityKinds, repositoryIdentityLock } from "./repository-identity-manifest";
import type { Instance, FenelType, TypeScheme } from "./types";
import { authoringMembershipEvaluateContext, authoringValidationMembership, closeAuthoringMembershipType } from "./authoring/signature-authoring";
import type { AuthoringLiteralMembership } from "./authoring/literal-witness";
import { moduleSourceCoordinate } from "./json-logic";
import { engineModule } from "./modules/engine";
import { publicRecipeFunctionsModule } from "./modules/public-demos";
import { stdModule } from "./modules/std";
import { Anything, Just, Nothing } from "./type-foundation";
import { validateValue, type ValidationAdmissionObservation } from "./validate";

// --- Snapshot of the retired defineFunction identity (the parity baseline) ---
// `id` is the registered fnId (note kernel:verify's cross-prefix). `codeName`
// diverges from the fnId-suffix on the 4 *Propose fns. `nativeKey` is the
// rekeyed native-map key (= `prover:<codeName>`, or `kernel:kernelVerify`).
// `ctx` == the native ALSO lands in nativeImplsCtx (the partial 3/7 overlap).
type Expected = {
  id: string;
  codeName: string;
  label: string;
  tags: string[];
  nativeKey: string;
  ctx: boolean;
};
const FNS: Record<string, Expected> = {
  decidableSetProver: { id: "prover:decidableSetProver", codeName: "decidableSetProverPropose", label: "DecidableSetProver — PropSubset / PropDisjoint / PropEmpty", tags: ["prover", "decidable", "set-algebra"], nativeKey: "prover:decidableSetProverPropose", ctx: false },
  reductionProver: { id: "prover:reductionProver", codeName: "reductionProverPropose", label: "ReductionProver — PropEq via evaluator reduction", tags: ["prover", "reduction", "eq"], nativeKey: "prover:reductionProverPropose", ctx: true },
  sampleTestProver: { id: "prover:sampleTestProver", codeName: "sampleTestProverPropose", label: "SampleTestProver — PropForall via Phase 9.2 sample iteration", tags: ["prover", "sample-test", "forall"], nativeKey: "prover:sampleTestProverPropose", ctx: false },
  monotonicityProver: { id: "prover:monotonicityProver", codeName: "monotonicityProverPropose", label: "MonotonicityProver — PropMonotonic via Aggregable lookup", tags: ["prover", "monotonicity", "aggregable", "phase12-demo"], nativeKey: "prover:monotonicityProverPropose", ctx: false },
  compilableSemanticCheck: { id: "prover:compilableSemanticCheck", codeName: "compilableSemanticCheck", label: "CompilableSemanticProver — per-case equivalence check", tags: ["prover", "compilable", "sample-test", "semantic-equivalence"], nativeKey: "prover:compilableSemanticCheck", ctx: true },
  partialEvaluatorSoundnessCheck: { id: "prover:partialEvaluatorSoundnessCheck", codeName: "partialEvaluatorSoundnessCheck", label: "PartialEvaluatorSoundnessProver — per-case soundness check", tags: ["prover", "partial-evaluator", "sample-test", "soundness"], nativeKey: "prover:partialEvaluatorSoundnessCheck", ctx: true },
  kernelVerify: { id: "kernel:verify", codeName: "kernelVerify", label: "Kernel verify", tags: ["kernel", "verify", "proof", "trust-boundary"], nativeKey: "kernel:kernelVerify", ctx: false },
};

const KEYS = Object.keys(FNS);
const ALL_IDS = KEYS.map((k) => FNS[k]!.id);
const CTX_KEYS = KEYS.filter((k) => FNS[k]!.ctx).map((k) => FNS[k]!.nativeKey); // 3

// Entity case-name rosters (from the retired inline $variant literals).
// decide-substrate Phase 2 K4: the closed Proposition (6-case) + ProofTerm
// (3-rule) sums are RETIRED — the claim currency is the engine `Judgment`
// (JEmpty/JInhabited, judgment.fenel); the Prop*/proof tags survive as marker
// vocabulary (see types.fenel's header). 5 entities remain.
const ENTITY_CASES: Record<string, string[]> = {
  UnprovedReason: ["OutOfScope", "Undecided", "BudgetExceeded", "WitnessError"],
  EpistemicStatus: ["Proven", "SolverChecked", "SampleTested", "Assumed", "Conjectured", "Unknown", "Refuted"],
  VerifyError: ["ShapeMismatch", "WitnessRejected", "UnknownRule"],
  PropMonotonic: ["PropMonotonic"],
  // expr-substrate Phase 6b — the ProofStrategy ADT (8→2 consolidation).
  ProofStrategy: ["Structural", "Smt"],
};

// expr-substrate Phase 6b — the 2 Fenel-bodied router fns (the strategy
// propose methods). Plain `prover:` ids, bodied (NOT @native), default
// codeName == fnId-suffix.
const ROUTER_IDS = ["prover:structuralPropose", "prover:smtPropose"];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}
function casesOf(type: FenelType | undefined): string[] {
  const v = (type as { $variant?: { cases: { name: string }[] } } | undefined)?.$variant;
  return v ? v.cases.map((c) => c.name) : [];
}

describe("prover migration — header-driven identity", () => {
  test("the `module prover where` header is authoritative (lowercase prefix preserved)", () => {
    expect(proverModule.name).toBe("prover");
  });

  test("all 9 functions registered (6 under `prover:` + the cross-prefix `kernel:verify` + 2 Phase-6b routers)", () => {
    expect((proverModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ALL_IDS, ...ROUTER_IDS].sort());
    expect((proverModule.functions ?? []).length).toBe(9);
  });

  test("the cross-prefix `kernel:verify` is present (re-id'd from prover:kernelVerify)", () => {
    const ids = (proverModule.functions ?? []).map((f) => f.id);
    expect(ids).toContain("kernel:verify");
    expect(ids).not.toContain("prover:kernelVerify");
  });

  test("module label preserved", () => {
    expect(JSON.stringify(proverModule.label)).toContain("Prover");
  });
});

describe("prover migration — the 5 surviving ADT entities (Proposition/ProofTerm retired at decide-substrate P2 K4)", () => {
  test("all 5 entity ids ride along", () => {
    expect((proverModule.entities ?? []).map((e) => e.id).sort()).toEqual(
      Object.keys(ENTITY_CASES).slice().sort(),
    );
  });

  test("each entity's case-name roster matches the retired inline literals", () => {
    const byId = new Map((proverModule.entities ?? []).map((e) => [e.id, e.type]));
    for (const [id, cases] of Object.entries(ENTITY_CASES)) {
      expect(casesOf(byId.get(id)), `${id} cases`).toEqual(cases);
    }
  });

  test("PropMonotonic stayed a 1-case $variant (the open-extension demo, via @discriminator)", () => {
    const byId = new Map((proverModule.entities ?? []).map((e) => [e.id, e.type]));
    expect(casesOf(byId.get("PropMonotonic"))).toEqual(["PropMonotonic"]);
  });
});

describe("prover migration — the both-maps `ffi/` split (axis #3 + #4) + the cross-prefix native", () => {
  test("the 7 @native fns are BODYLESS; the 2 Phase-6b routers ARE bodied", () => {
    const bodyless = (proverModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual([...ALL_IDS].sort());
    const bodied = (proverModule.functions ?? []).filter((f) => f.body).map((f) => f.id).sort();
    expect(bodied).toEqual([...ROUTER_IDS].sort());
  });

  test("nativeImpls (PLAIN map) holds all 7 codeName-rekeyed natives + cross-prefix kernel:kernelVerify + the 4 Phase-6b fnId aliases", () => {
    const expected = [...KEYS.map((k) => FNS[k]!.nativeKey)];
    // FNS.kernelVerify.nativeKey IS kernel:kernelVerify; the rekey ALSO produces
    // prover:kernelVerify (kernelVerify is a key in proverNatives), so the plain
    // map carries both prover:kernelVerify AND kernel:kernelVerify — byte-equal
    // to the retired seam. expr-substrate Phase 6b ALSO adds 4 fnId-keyed
    // aliases for the proposer natives (so the Fenel `structuralPropose` router
    // can reach them by codeName → spec.id → native).
    const PHASE_6B_ALIASES = [
      "prover:decidableSetProver",
      "prover:reductionProver",
      "prover:sampleTestProver",
      "prover:monotonicityProver",
    ];
    const plainKeys = Object.keys(proverModule.nativeImpls ?? {}).sort();
    expect(plainKeys).toEqual([...expected, "prover:kernelVerify", ...PHASE_6B_ALIASES].sort());
    expect(proverModule.nativeImpls?.["kernel:kernelVerify"], "explicit cross-prefix kernel native").toBeDefined();
  });

  test("nativeImplsCtx (CTX map) holds EXACTLY the partial 3/7 overlap, id-keyed", () => {
    expect(proverModule.nativeImplsCtx, "nativeImplsCtx must be present").toBeDefined();
    expect(Object.keys(proverModule.nativeImplsCtx ?? {}).sort()).toEqual([...CTX_KEYS].sort());
  });

  test("the 3 ctx-overlap keys are ALSO in the plain map (the both-maps fallback, seam-routed)", () => {
    const plain = new Set(Object.keys(proverModule.nativeImpls ?? {}));
    for (const k of CTX_KEYS) expect(plain.has(k), `${k} must be in BOTH maps`).toBe(true);
  });

  test("no ioHandlers / credentialRequirements", () => {
    expect(proverModule.ioHandlers).toBeUndefined();
    expect(proverModule.credentialRequirements).toBeUndefined();
  });
});

describe("prover migration — identity-facet parity (incl. the codeName≠fnId-suffix reconciliation)", () => {
  const insts = proverModule.instances ?? [];

  // THE RECONCILIATION #1 — assert all three (fn id, codeName, native key) for
  // decidableSetProver + reductionProver (the brief's requirement).
  test("codeName≠fnId-suffix: fnId / codeName / native-key for the *Propose fns", () => {
    const fnIds = (proverModule.functions ?? []).map((f) => f.id);
    for (const k of ["decidableSetProver", "reductionProver"]) {
      const exp = FNS[k]!;
      expect(fnIds, `fnId ${exp.id}`).toContain(exp.id);
      expect(methodOf(insts, "Codeable", exp.id), `codeName for ${exp.id}`).toEqual({ codeName: exp.codeName });
      expect(exp.codeName).toBe(`${k}Propose`); // codeName = <name>Propose
      expect(exp.nativeKey).toBe(`prover:${exp.codeName}`); // native key rides the codeName
      expect(proverModule.nativeImpls?.[exp.nativeKey], `native ${exp.nativeKey}`).toBeDefined();
      // The codeName-keyed native is the PRIMARY entry (production dispatch).
      // expr-substrate Phase 6b ALSO adds an fnId-keyed alias for the 4
      // proposers so the Fenel `structuralPropose` router reaches them by
      // codeName → spec.id → native; both decidableSetProver + reductionProver
      // are routed proposers, so their fnId aliases are present.
      expect(proverModule.nativeImpls?.[exp.id], `Phase-6b fnId alias at ${exp.id}`).toBeDefined();
    }
  });

  test("Codeable / Labelable / Describable / Taggable: byte-identical for all 7 fns", () => {
    for (const k of KEYS) {
      const exp = FNS[k]!;
      expect(methodOf(insts, "Codeable", exp.id)).toEqual({ codeName: exp.codeName });
      expect(methodOf(insts, "Labelable", exp.id)).toEqual({ label: exp.label });
      expect(methodOf(insts, "Describable", exp.id)).toBeDefined();
      expect(methodOf(insts, "Taggable", exp.id)).toEqual({ tags: exp.tags });
    }
  });

  // Phase 3j: no @category anywhere — the 6 prover: fns derive "prover" and
  // kernel:verify derives "kernel" at read time. No IOInvokable (no ioAction).
  test("NO stored Categorizable, NO IOInvokable (both derive / absent — byte-equal post-3j)", () => {
    for (const k of KEYS) {
      expect(methodOf(insts, "Categorizable", FNS[k]!.id), `${FNS[k]!.id} no Categorizable`).toBeUndefined();
      expect(methodOf(insts, "IOInvokable", FNS[k]!.id), `${FNS[k]!.id} no IOInvokable`).toBeUndefined();
    }
  });

  // Identity-facet count: 7 @native fns + 2 Phase-6b routers = 9 each of
  // Codeable/Labelable/Describable/Taggable (the routers carry @label /
  // @description / @tags + a default codeName).
  test("identity-facet counts: 9 Codeable/Labelable/Describable/Taggable, 0 Categorizable, 0 IOInvokable", () => {
    const counts: Record<string, number> = {};
    for (const i of insts) counts[i.typeName] = (counts[i.typeName] ?? 0) + 1;
    expect(counts.Codeable).toBe(9);
    expect(counts.Labelable).toBe(9);
    expect(counts.Describable).toBe(9);
    expect(counts.Taggable).toBe(9);
    expect(counts.Categorizable ?? 0).toBe(0);
    expect(counts.IOInvokable ?? 0).toBe(0);
  });
});

describe("prover migration — the 2 Prover strategy instances ride (8→2 consolidation, Phase 6b)", () => {
  const insts = proverModule.instances ?? [];
  const provInsts = insts.filter((i) => i.typeName === "Prover");

  test("exactly 2 Prover dispatch instances (Structural / Smt)", () => {
    expect(provInsts.length).toBe(2);
    expect(provInsts.map((i) => i.args[0]).sort()).toEqual(["Smt", "Structural"]);
  });

  // modules-as-values Phase 2c: `propose` is typed as the proposer function, so
  // each instance holds a qualified reference to the function its id string
  // named (`prover:structuralPropose` / `prover:smtPropose`).
  test("the projected instance consts carry the right propose reference", () => {
    expect(structuralProverInstance.args).toEqual(["Structural"]);
    expect(structuralProverInstance.methods.propose).toEqual({ $ref: "prover.structuralPropose" });
    expect(smtProverInstance.args).toEqual(["Smt"]);
    expect(smtProverInstance.methods.propose).toEqual({ $ref: "prover.smtPropose" });
  });
});

describe("prover migration — resolution + native callability through createRegistry", () => {
  const reg = createRegistry([proverModule]);

  test("getFunction resolves every function by id AND by codeName", () => {
    for (const k of KEYS) {
      const { id, codeName } = FNS[k]!;
      expect(reg.getFunction(id)?.id, `by id: ${id}`).toBe(id);
      expect(reg.getFunctionByCodeName(codeName)?.id, `by codeName: ${codeName}`).toBe(id);
    }
  });

  test("kernel:verify resolves with params [proposition, proof]", () => {
    const fn = reg.getFunction("kernel:verify");
    expect(fn).toBeDefined();
    expect(fn!.params.map((p) => p.name)).toEqual(["proposition", "proof"]);
  });

  test("the registry context exposes the plain + ctx native maps", () => {
    const ctx = reg.evaluateContext();
    expect(typeof ctx.natives?.["prover:decidableSetProverPropose"]).toBe("function");
    expect(typeof ctx.natives?.["kernel:kernelVerify"]).toBe("function");
    for (const k of CTX_KEYS) {
      expect(typeof ctx.nativesCtx?.[k], `ctx native: ${k}`).toBe("function");
    }
  });
});

describe("prover migration — the re-exported natives are directly callable (consumer surface)", () => {
  test("decidableSetProposerNative refutes a non-subset (Err WitnessError)", () => {
    const out = decidableSetProposerNative({ $tag: "PropSubset", s: { $enum: [1, 2, 3] }, t: { $enum: [1] } }) as { $tag: string };
    expect(out.$tag).toBe("Err");
  });

  test("kernelVerifyNative accepts a Refl proof of a PropEq", () => {
    const out = kernelVerifyNative({ $tag: "PropEq", type: { $ref: "Number" }, lhs: 5, rhs: 5 }, { $tag: "Refl", value: 5 }) as { $tag: string };
    expect(out.$tag).toBe("Ok");
  });

  test("isPropositionShape recognises a tagged proposition + rejects junk", () => {
    expect(isPropositionShape({ $tag: "PropMonotonic", agg: "sum" })).toBe(true);
    expect(isPropositionShape({ $tag: "Refl", value: 1 })).toBe(false);
  });
});

// D4: returned evidence is ordinary declared data. Resolving its payload type
// must not grade that evidence or turn an unknown claim into a proof.
describe("prover counterexample declarations — captured owners and strict data admission", () => {
  let registry: ReturnType<typeof createRegistry>;
  beforeAll(() => {
    // Product identity (createRepositoryRegistry's lock and strict field
    // identity) without global catalogue publication. A lockless registry is
    // tools-only: its type handles are bare spellings that admission cannot
    // authenticate, and its captured declarations carry no canonical List keys.
    const lock = repositoryIdentityLock();
    registry = createRegistry([stdModule, engineModule, proverModule, publicRecipeFunctionsModule], {
      publishCatalogEntities: false, codeNameLock: lock,
      fieldIdentity: { mode: "strict-embedded", defaultRealm: "repository-source", lock, identityKinds: repositoryIdentityKinds() },
    });
  }, 300_000);

  function declared(name: string, owner = "prover"): TypeScheme {
    const resolved = registry.callSiteTyping.resolveType({ $ref: name }, moduleSourceCoordinate(owner));
    if (!resolved.ok) throw new Error(`Unresolved ${owner}.${name}: ${resolved.message}`);
    return resolved.type;
  }

  // The same captured-owner closure, strict original-input validator and
  // admission classifier as the ordinary authoring membership path. No local
  // type walker, coerced value, error-text classifier or replacement decider.
  function admit(value: unknown, expected: TypeScheme) {
    const reader = authoringMembershipEvaluateContext(registry.evaluateContext());
    const closed = closeAuthoringMembershipType(expected, reader);
    if (!closed) return { checked: undefined, verdict: Nothing };
    const observations: Array<ReturnType<AuthoringLiteralMembership>> = [];
    const plans: ValidationAdmissionObservation[] = [];
    const checked = validateValue(closed, value, null, {
      registry, functions: reader, coerce: false,
      strict: { primitiveTypes: true, membership: true, rejectOmitted: true, rejectAdded: false },
      observeMembership: verdict => observations.push(verdict),
      observeAdmission: plan => plans.push(plan),
    });
    return { checked, verdict: authoringValidationMembership(checked, observations, plans) };
  }

  function expectAdmitted(value: unknown, expected: TypeScheme) {
    const before = structuredClone(value);
    const result = admit(value, expected);
    expect(result.checked?.valid, JSON.stringify(result.checked?.errors)).toBe(true);
    expect(result.checked?.errors).toEqual([]);
    expect(result.verdict).toEqual(Just(true));
    expect(value).toEqual(before);
  }

  test("both payload fields resolve in the prover declaration to the canonical system owner", () => {
    expect(registry.getIdentifiedEntity("Anything")).toMatchObject({ module: "system", type: Anything });
    const universalOwner = registry.getEntityNominalIdentity("Anything");
    expect(universalOwner).toBeDefined();
    for (const [name, tag] of [["UnprovedReason", "WitnessError"], ["EpistemicStatus", "Refuted"]] as const) {
      const entity = registry.getIdentifiedEntity(name);
      const owner = registry.getEntityNominalIdentity(name);
      expect(entity?.module).toBe("prover");
      if (!entity?.type || !("$variant" in entity.type) || !owner) throw new Error(`Missing captured prover.${name}`);
      const field = entity.type.$variant.cases.find(candidate => candidate.name === tag)?.fields
        ?.find(candidate => candidate.name === "counterexample");
      if (!field) throw new Error(`Missing ${name}.${tag}.counterexample`);
      const resolve = registry.callSiteTyping.resolveTypeInDeclaration;
      if (!resolve) throw new Error("Captured declaration resolver is unavailable");
      const resolved = resolve(field.type, owner);
      expect(resolved.ok, JSON.stringify(resolved)).toBe(true);
      if (!resolved.ok) throw new Error(resolved.message);
      expect(resolved.type.nominals).toEqual([{ path: [], identity: universalOwner!, publicName: "Anything" }]);
    }
  }, 180_000);

  test("Refuted and WitnessError retain their tags and strictly admit arbitrary counterexample data", () => {
    for (const [name, tag] of [["EpistemicStatus", "Refuted"], ["UnprovedReason", "WitnessError"]] as const) {
      const expected = declared(name);
      for (const counterexample of [null, 2, "JPY", [1, "two"], { reason: "witness", nested: [false, 3] }]) {
        expectAdmitted({ $tag: tag, counterexample }, expected);
      }
    }
  }, 180_000);

  test("unknown evidence stays unknown data, and unresolved owners and malformed cases still refuse", () => {
    const status = declared("EpistemicStatus");
    const reason = declared("UnprovedReason");
    expectAdmitted({ $tag: "Unknown" }, status);
    expectAdmitted({ $tag: "Undecided", note: "No deciding evidence" }, reason);
    for (const [expected, value] of [
      [status, { $tag: "Refuted" }],
      [reason, { $tag: "WitnessError" }],
      [status, { $tag: "SampleTested", samplesChecked: "three" }],
      [reason, { $tag: "Undecided", note: 42 }],
      [status, { $tag: "UnregisteredEvidence" }],
      [reason, { $tag: "UnregisteredReason" }],
    ] as const) expect(admit(value, expected).verdict).toEqual(Just(false));
    for (const name of ["Any", "UnregisteredCounterexampleType"]) {
      expect(registry.callSiteTyping.resolveType({ $ref: name }, moduleSourceCoordinate("prover")).ok).toBe(false);
    }
    const missingOwner: TypeScheme = { quantified: [], body: { $ref: "Anything" },
      nominals: [{ path: [], identity: '["missing-prover-counterexample-owner","Anything"]', publicName: "Anything" }] };
    expect(admit(2, missingOwner).verdict).toEqual(Nothing);
  }, 180_000);

  test("the actual RecipeCard declaration admits empty and direct/status rows while retaining its envelope", () => {
    const expected = declared("RecipeCard", "RecipeFunctions");
    // Same source-derived candidate as the retained Local D4 diagnostic. This
    // is membership evidence, not execution of recipeCard or a new saved item.
    const row = { $tag: "RecipeFact", title: "This pantry",
      summary: { $tag: "Preparations", items: [
        [{ $tag: "Butter" }, { $tag: "Honey" }, { $tag: "LemonJuice" }, { $tag: "Egg" }],
        [{ $tag: "CoconutCream" }, { $tag: "Honey" }, { $tag: "LemonJuice" }, { $tag: "Egg" }],
      ] }, evidence: { $tag: "DirectEvaluation" } };
    expectAdmitted([], expected);
    expectAdmitted([row], expected);
    for (const status of [{ $tag: "Unknown" }, { $tag: "Refuted", counterexample: { food: "Butter" } }]) {
      expectAdmitted([{ ...row, evidence: { $tag: "StatusEvidence", status } }], expected);
    }
    for (const invalid of [
      [{ ...row, title: 42 }],
      [{ ...row, summary: { $tag: "Preparations", items: 42 } }],
      [{ ...row, evidence: { $tag: "StatusEvidence", status: { $tag: "Refuted" } } }],
      [{ ...row, evidence: { $tag: "UnregisteredEvidence" } }],
    ]) expect(admit(invalid, expected).verdict).toEqual(Just(false));
  }, 180_000);
});
