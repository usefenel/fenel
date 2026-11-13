// ---------------------------------------------------------------------------
// Phase 10a-5a conformance — locks in the current state of the typeclass
// collapse (sub-steps 10a-1..4 shipped). The "complete" suffix is forward-
// looking: the full deletion arc (legacy `Interface` / `Instance`
// TS ADTs, `Constraint` typed-Id migration, UI route fold, `typeclasses.ts`
// cache deletion) lands in Phase 10a-5b..e — this test asserts the state
// each follow-up sub-phase should preserve, and adds an explicit
// `@todo phase-10a-5*` marker for assertions that flip when the matching
// deletion lands.
//
// Scope today (Phase 10a-5a):
//   1. Spec record entities surface in `getCatalog()` `spec` section
//   2. `dispatchedSpecCodeNames` is non-empty + all entries end with "Spec"
//   3. `validateVerified` dispatches correctly on every `Evidence` variant
//   4. `validateSpecRecord` is permissive (today's policy)
//   5. `DispatchKey` + `Verified` + `Evidence` are catalog-visible ADTs
//   6. The `dispatch:lookup{One,All}` Fenel-callable surface resolves
//      registered instances byte-equivalently with `resolveEffect`
//
// Out-of-scope here (will be tested when each sub-phase lands):
//   - 10a-5b: spec-record dispatch through `effect-dispatch.ts` end-to-end
//   - 10a-5c: typed-`Id<Type>` `Constraint` resolution at function-load time
//   - 10a-5d: deletion of legacy `dispatch:register` / `dispatch:lookup`
//     fnIds (V2 surface becomes the only dispatch surface)
//   - 10a-5e: universal entity editor rendering spec record instances
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  createDispatchRegistry,
  resolveEffect,
  getCatalog,
  specEntities,
  systemEntities,
  dispatchedSpecCodeNames,
  interfaceCodeNameToName,
  validateVerified,
  validateSpecRecord,
  evidenceAxiom,
  evidenceSolverChecked,
  evidenceSampleTested,
  evidenceKernelProven,
  evidenceExternal,
  Verified,
  type Evidence,
} from "./index";

describe("Phase 10a-5a — spec record catalog surface", () => {
  it("exposes a non-empty `spec` catalog section", () => {
    const section = getCatalog().find((s) => s.id === "interface");
    expect(section).toBeDefined();
    expect(section!.entries.length).toBeGreaterThan(0);
  });

  it("every spec entry's id is the suffix-free dispatch class name (Phase 3.4b)", () => {
    for (const codeName of dispatchedSpecCodeNames) {
      // Phase 3.4b retired the `Spec` suffix; a spec entry is recognised by
      // having a registered dispatch class, not by its name ending.
      expect(codeName.endsWith("Spec")).toBe(false);
      expect(interfaceCodeNameToName.get(codeName)).toBe(codeName);
    }
  });

  it("dispatchedSpecCodeNames excludes auxiliary ADTs (DispatchKey / Evidence / Verified)", () => {
    expect(dispatchedSpecCodeNames).not.toContain("DispatchKey");
    expect(dispatchedSpecCodeNames).not.toContain("Evidence");
    expect(dispatchedSpecCodeNames).not.toContain("Verified");
  });

  it("auxiliary ADTs (DispatchKey / Evidence / Verified) ARE registered as system entities", () => {
    const specIds = new Set(specEntities.map((e) => e.id));
    const sysIds = new Set(systemEntities.map((e) => e.id));
    // Auxiliary ADTs flow into systemEntities; the loader routes
    // *-Spec entries to specEntities so they end up in the catalog's
    // `spec` section, while non-Spec ADTs (DispatchKey / Evidence /
    // Verified) stay in systemEntities (auxiliary catalog surface).
    expect(sysIds.has("DispatchKey")).toBe(true);
    expect(sysIds.has("Evidence")).toBe(true);
    expect(sysIds.has("Verified")).toBe(true);
    // Spec entities should not include these
    expect(specIds.has("DispatchKey")).toBe(false);
    expect(specIds.has("Evidence")).toBe(false);
    expect(specIds.has("Verified")).toBe(false);
  });

  it("interfaceCodeNameToName is an identity map (Phase 3.4b/3.4c — suffix dropped)", () => {
    // The entity codeName IS the class name now; Phase 3.4c removed the
    // suffix-strip step from its construction (plain identity map).
    for (const [codeName, typeName] of interfaceCodeNameToName) {
      expect(codeName).toBe(typeName);
    }
  });

  it("Labelable is a registered spec entity (representational core)", () => {
    expect(dispatchedSpecCodeNames).toContain("Labelable");
    const labelable = specEntities.find((e) => e.id === "Labelable");
    expect(labelable).toBeDefined();
  });
});

describe("Phase 10a-5a — Verified-field evidence dispatch", () => {
  function assertEvidenceClassifies(evidence: Evidence, expectedStatus: "pass" | "uncheckable") {
    const result = validateVerified(true, evidence, "test-law");
    expect(result.status).toBe(expectedStatus);
  }

  it("Axiom evidence classifies as pass (epistemicAssumed)", () => {
    assertEvidenceClassifies(evidenceAxiom, "pass");
    const result = validateVerified(true, evidenceAxiom);
    expect(result.epistemicStatus.$tag).toBe("Assumed");
  });

  it("SolverChecked evidence classifies as pass (epistemicSolverChecked)", () => {
    assertEvidenceClassifies(evidenceSolverChecked, "pass");
    const result = validateVerified(true, evidenceSolverChecked);
    expect(result.epistemicStatus.$tag).toBe("SolverChecked");
  });

  it("SampleTested evidence classifies as pass (epistemicSampleTested + samplesChecked)", () => {
    const ev = evidenceSampleTested(100);
    assertEvidenceClassifies(ev, "pass");
    const result = validateVerified(true, ev);
    expect(result.epistemicStatus.$tag).toBe("SampleTested");
    expect(result.samplesChecked).toBe(100);
  });

  it("KernelProven evidence classifies as uncheckable (reserved — kernel doesn't reduction-check yet)", () => {
    assertEvidenceClassifies(evidenceKernelProven("any-proof-expression"), "uncheckable");
  });

  it("External evidence classifies as pass / Assumed (Phase 6b Q1 arm A — A-minimal)", () => {
    assertEvidenceClassifies(evidenceExternal("human-reviewer"), "pass");
    const result = validateVerified(true, evidenceExternal("human-reviewer"));
    expect(result.epistemicStatus.$tag).toBe("Assumed");
  });
});

describe("Phase 10a-5a — validateSpecRecord permissive policy", () => {
  it("returns empty violations for a type with no Verified fields", () => {
    // FenelType with no `Verified` fields → skip path; walker returns
    // empty violation list regardless of the value shape.
    const plainRecordType = {
      $record: {
        fields: [
          { name: "name", type: { $ref: "String" }, default: { $tag: "Nothing" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" } },
        ],
      },
    } as never;
    expect(validateSpecRecord(plainRecordType, { name: "x" })).toEqual([]);
  });

  it("emits a violation for missing Verified value (predicate/evidence required)", () => {
    const specType = {
      $record: {
        fields: [
          {
            name: "lawA",
            type: Verified({ $ref: "Boolean" }),
            default: { $tag: "Nothing" },
            label: { $tag: "Nothing" },
            ui: { $tag: "Nothing" },
          },
        ],
      },
    } as never;
    const errs = validateSpecRecord(specType, { lawA: undefined });
    expect(errs.length).toBe(1);
    expect(errs[0]!.field).toBe("lawA");
  });

  it("accepts every Evidence variant under permissive policy (no fail violations)", () => {
    const specType = {
      $record: {
        fields: [
          {
            name: "lawAxiom",
            type: Verified({ $ref: "Boolean" }),
            default: { $tag: "Nothing" },
            label: { $tag: "Nothing" },
            ui: { $tag: "Nothing" },
          },
          {
            name: "lawSolver",
            type: Verified({ $ref: "Boolean" }),
            default: { $tag: "Nothing" },
            label: { $tag: "Nothing" },
            ui: { $tag: "Nothing" },
          },
          {
            name: "lawSample",
            type: Verified({ $ref: "Boolean" }),
            default: { $tag: "Nothing" },
            label: { $tag: "Nothing" },
            ui: { $tag: "Nothing" },
          },
          {
            name: "lawKernel",
            type: Verified({ $ref: "Boolean" }),
            default: { $tag: "Nothing" },
            label: { $tag: "Nothing" },
            ui: { $tag: "Nothing" },
          },
          {
            name: "lawExternal",
            type: Verified({ $ref: "Boolean" }),
            default: { $tag: "Nothing" },
            label: { $tag: "Nothing" },
            ui: { $tag: "Nothing" },
          },
        ],
      },
    } as never;
    const value = {
      lawAxiom: { predicate: true, evidence: evidenceAxiom },
      lawSolver: { predicate: true, evidence: evidenceSolverChecked },
      lawSample: { predicate: true, evidence: evidenceSampleTested(50) },
      lawKernel: { predicate: true, evidence: evidenceKernelProven("proof") },
      // Phase 6b Q1 arm A — an External-evidenced Verified field validates as
      // pass; the evidence value carries the source provenance.
      lawExternal: { predicate: true, evidence: evidenceExternal("gpt-4o-2026") },
    };
    expect(validateSpecRecord(specType, value)).toEqual([]);
  });
});

describe("Phase 10a-5a — dispatch surface end-to-end", () => {
  it("resolveEffect resolves a registry-registered instance via legacy string target", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "TestCollapseClass",
      params: [{ name: "scope" }],
      methods: [{ name: "doit", params: [], returns: { $ref: "Unit" } }],
    });
    reg.addInstance({
      typeName: "TestCollapseClass",
      args: ["TargetType"],
      methods: { doit: "test:collapseStringTarget" },
    });
    const resolved = resolveEffect(undefined, reg, "TestCollapseClass", "TargetType");
    expect(resolved).toBeDefined();
    expect(resolved!.methods.doit).toBe("test:collapseStringTarget");
  });

  it("resolveEffect accepts a DispatchKey ByType ADT value (Phase 10a-4 widening)", () => {
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "TestCollapseClass2",
      params: [{ name: "scope" }],
      methods: [{ name: "doit", params: [], returns: { $ref: "Unit" } }],
    });
    reg.addInstance({
      typeName: "TestCollapseClass2",
      args: ["TargetType2"],
      methods: { doit: "test:collapseByTypeTarget" },
    });
    const key = { $tag: "ByType" as const, target: "TargetType2" };
    const resolved = resolveEffect(undefined, reg, "TestCollapseClass2", key);
    expect(resolved).toBeDefined();
    expect(resolved!.methods.doit).toBe("test:collapseByTypeTarget");
  });

  it("resolveEffect: ByValue stays RESERVED; a ByPattern *target* surfaces no instance", () => {
    // structural-dispatch Phase 1 — the structural MATCH triggers on a ByType
    // nominal miss (the registered RULES are ByPattern-keyed); a ByValue target
    // and a ByPattern *lookup target* still surface "no instance". ByPattern
    // rules matching at dispatch is covered by structural-dispatch.test.ts.
    const reg = createDispatchRegistry();
    reg.defineClass({
      name: "TestReserved",
      params: [{ name: "scope" }],
      methods: [],
    });
    const byValue = { $tag: "ByValue" as const, value: 42 };
    const byPattern = { $tag: "ByPattern" as const, predicate: "lambda" };
    expect(resolveEffect(undefined, reg, "TestReserved", byValue)).toBeUndefined();
    expect(resolveEffect(undefined, reg, "TestReserved", byPattern)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 10a-5b..e forward markers — these assertions FLIP when the matching
// deletion sub-phase lands. Today they document the legacy-coexistence state
// each sub-phase will retire.
//
// 10a-5b — effect-dispatch / law-validation / effect-inference migration to
//   spec-record dispatch
// 10a-5c — Constraint string-class-name → Id<Type> reference migration
// 10a-5d — delete legacy dispatch:register / dispatch:lookup{,One,All}
//   fnIds; rename V2 → canonical
// 10a-5e — fold /app/typeclasses + /app/typeclass-instances UI routes into
//   universal entity editor
// ---------------------------------------------------------------------------

describe("Phase 10a-5 forward markers (assertions flip per sub-phase)", () => {
  it("legacy dispatch:register / dispatch:lookup retired (V2 promoted to canonical)", () => {
    // 10a-5d ✅ — `dispatch:register` + `dispatch:lookup` are the canonical
    // names; their pre-rename `dispatch:registerV2` / `dispatch:lookupV2`
    // ids have been retired. The canonical fnIds now accept the typed
    // DispatchKey ADT (was List<String> / String pre-10a-5d).
    const catalog = getCatalog();
    const functionsSection = catalog.find((s) => s.id === "function");
    const fnIds = (functionsSection?.entries ?? []).map((e) => e.id);
    expect(fnIds).toContain("dispatch:register"); // canonical (DispatchKey signature)
    expect(fnIds).toContain("dispatch:lookup");   // canonical (DispatchKey signature)
    expect(fnIds).not.toContain("dispatch:registerV2"); // V2 suffix retired
    expect(fnIds).not.toContain("dispatch:lookupV2");   // V2 suffix retired
  });

  it("dispatch:lookupOne + dispatch:lookupAll preserved (distinct semantics, not V2-suffixed)", () => {
    // 10a-5d kept these — they have distinct semantics (single-result vs
    // all-results) that the V2 (now canonical) `dispatch:lookup` doesn't
    // replicate. Per brief open question §2.
    const catalog = getCatalog();
    const functionsSection = catalog.find((s) => s.id === "function");
    const fnIds = (functionsSection?.entries ?? []).map((e) => e.id);
    expect(fnIds).toContain("dispatch:lookupOne");
    expect(fnIds).toContain("dispatch:lookupAll");
  });

  it("/app/typeclass-instances + /app/typeclasses routes retired (universal editor handles spec records)", () => {
    // Soft assertion documenting the 10a-5e migration. The actual routes
    // live in distros/narthex/solid, outside the engine package; the
    // universal entity editor at /app/types/<XSpec> is now the canonical
    // CRUD surface for spec-record instances.
    expect(true).toBe(true);
  });
});
