// F3 bounded slice: every plan is validated; unused alias conversions are not.
import { describe, expect, test } from "bun:test";
import {
  __clearSignaturePlanReuseForTests,
  __finalizeRegistryFunctionSignaturesWithAuthoredPlannerForTests,
  finalizeRegistryFunctionSignatures,
  finalizeRegistryOwnedFunctionSignatures,
  finalizeRegistryOwnedFunctionSignaturesAsync,
  signaturePlanReuseStats,
  type RegistryFunctionSignatureCandidate,
  type RegistrySignatureFinalizationOptions,
} from "./signature-inference";
import type { FenelFunction, FenelType, TypeScheme } from "./types";

const authored = { $tag: "Authored" as const, source: { $tag: "HostSpec" as const, module: "external-projection" } };
function complete(id: string, returns: FenelType = { $ref: "Number" }): RegistryFunctionSignatureCandidate {
  return {
    fn: { id, params: [], returns, body: 1 },
    declaration: { functionId: id, declarationName: id, codeName: id, params: [], returns: authored,
      scheme: { quantified: [], body: { $arrow: { params: [], returns } } } },
    implementationOrigin: { $tag: "HostNative", map: "nativeImpls" },
  };
}
function inferred(id: string, body: NonNullable<FenelFunction["body"]>): RegistryFunctionSignatureCandidate {
  return {
    fn: { id, params: [], returns: { $var: "pending" }, body },
    declaration: { functionId: id, declarationName: id, codeName: id, params: [], returns: { $tag: "Absent" } },
    implementationOrigin: { $tag: "FenelBody" },
  };
}
const rawPlan = (id: string, malformed = false) => ({
  id, status: "solved", trust: { $tag: "TrustedPrimitive", evidence: {} },
  scheme: { quantified: [], body: { tag: "ItArrow", params: [], returns: malformed
    ? { tag: "ItApp", head: { tag: "ItRigid", id: "not-quantified", sourceName: "f" },
        headKind: { $tag: "KType" }, args: [] }
    : { tag: "ItNamed", name: "Number", publicName: "Number" } } },
});

describe("needed external signature aliases", () => {
  test("projects useful aliases but avoids every unused alias conversion", () => {
    const selected = complete("external-projection:selected");
    const unused = complete("external-projection:unused", { $ref: "String" });
    const caller = inferred("external-projection:caller", { call: ["selectedAlias"] });
    const options: RegistrySignatureFinalizationOptions = { resolutions: [
      { name: selected.fn.id, targetId: selected.fn.id, status: "resolved" },
      { name: unused.fn.id, targetId: unused.fn.id, status: "resolved" },
      { name: "selectedAlias", targetId: selected.fn.id, status: "resolved" },
      ...Array.from({ length: 128 }, (_, index) => ({
        name: `unusedAlias${index}`, targetId: unused.fn.id, status: "resolved" as const,
      })),
    ] };
    const before = signaturePlanReuseStats();
    const actual = finalizeRegistryFunctionSignatures([selected, unused, caller], options);
    const after = signaturePlanReuseStats();
    expect(actual[2]!.fn.returns).toEqual({ $ref: "Number" });
    // Two canonical validation passes and two aliases of the needed target.
    expect(after.authoredExternalRows - before.authoredExternalRows).toBe(4);
    expect(after.authoredExternalAliasesSkipped - before.authoredExternalAliasesSkipped).toBe(129);
    const direct = finalizeRegistryFunctionSignatures([selected, unused,
      inferred(caller.fn.id, { call: [selected.fn.id] })], options);
    expect(actual).toEqual(direct.map((row, index) => index === 2
      ? { ...row, fn: { ...row.fn, body: caller.fn.body } } : row));
  }, 180_000);

  test("preserves duplicate rows and canonical-alias-explicit inference order", async () => {
    __clearSignaturePlanReuseForTests();
    const selected = complete("external-projection:ordered");
    const caller = inferred("external-projection:ordered-caller", { call: ["selectedAlias"] });
    const capture: { rows?: Array<{ name: string; targetId: string }> } = {};
    const actual = await finalizeRegistryOwnedFunctionSignaturesAsync([selected, caller], {
      resolutions: [
        { name: selected.fn.id, targetId: selected.fn.id, status: "resolved" },
        { name: "selectedAlias", targetId: selected.fn.id, status: "resolved" },
      ],
      externalCallables: [{ name: "explicitAlias", targetId: selected.fn.id,
        scheme: { quantified: [], body: { $arrow: { params: [], returns: { $ref: "String" } } } },
        trust: { $tag: "TrustedPrimitive", evidence: {} } }],
    }, undefined, async (request) => {
      if (request.kind === "signatureInference") {
        capture.rows = request.arguments[2] as typeof capture.rows;
      }
      return { status: "Abandon" };
    });
    expect(capture.rows?.map(({ name }) => name)).toEqual([
      selected.fn.id, selected.fn.id, "selectedAlias", "explicitAlias",
    ]);
    expect(capture.rows?.every(({ targetId }) => targetId === selected.fn.id)).toBe(true);
    expect(actual[1]!.fn.returns).toEqual({ $ref: "Number" });
  }, 180_000);

  test("still validates an unused custom-planner scheme before later boundary work", () => {
    const candidate = complete("external-projection:invalid-custom");
    let resolverCalled = false;
    expect(() => __finalizeRegistryFunctionSignaturesWithAuthoredPlannerForTests(
      [candidate, inferred("external-projection:later", { call: ["anything"] })],
      { resolutions: [], resolveCandidateReferences() { resolverCalled = true; throw new Error("too late"); } },
      () => ({ $tag: "Solved", plan: { functions: [rawPlan(candidate.fn.id, true)] } }),
    )).toThrow(/unknown quantified id/);
    expect(resolverCalled).toBe(false);
  }, 180_000);

  test("an unused malformed borrowed scheme refuses without poisoning same-key recovery", async () => {
    __clearSignaturePlanReuseForTests();
    try {
      const candidate = complete("external-projection:invalid-borrowed");
      const unrelated = complete("external-projection:retained-valid");
      const options = { resolutions: [] };
      finalizeRegistryOwnedFunctionSignatures([unrelated], options);
      const retainedBefore = signaturePlanReuseStats();
      let answered = false;
      await expect(finalizeRegistryOwnedFunctionSignaturesAsync([candidate], options, undefined,
        async (request) => {
          if (request.kind !== "signatureAuthoredPlans") return { status: "Abandon" };
          answered = true;
          return { status: "Solved", items: [rawPlan(candidate.fn.id, true)] };
        })).rejects.toThrow(/unknown quantified id/);
      expect(answered).toBe(true);
      const afterRefusal = signaturePlanReuseStats();
      expect(afterRefusal.authoredEntries).toBe(retainedBefore.authoredEntries);
      const recovered = finalizeRegistryOwnedFunctionSignatures([candidate], options);
      expect(recovered[0]!.fn.returns).toEqual({ $ref: "Number" });
      const afterRecovery = signaturePlanReuseStats();
      expect(afterRecovery.authoredPlanned - afterRefusal.authoredPlanned).toBe(1);
      expect(finalizeRegistryOwnedFunctionSignatures([candidate, unrelated], options)).toEqual([
        ...recovered, ...finalizeRegistryOwnedFunctionSignatures([unrelated], options),
      ]);
      const afterHits = signaturePlanReuseStats();
      expect(afterHits.authoredHits - afterRecovery.authoredHits).toBe(3);
      expect(afterHits.authoredPlanned - afterRecovery.authoredPlanned).toBe(0);
    } finally {
      __clearSignaturePlanReuseForTests();
    }
  }, 180_000);

  test("cancellation after borrowed item capture retains no unvalidated entry", async () => {
    __clearSignaturePlanReuseForTests();
    try {
      const candidate = complete("external-projection:canceled-borrow");
      const options = { resolutions: [] };
      const controller = new AbortController();
      const reason = new Error("Canceled before borrowed scheme validation");
      let captured = false;
      const item = new Proxy(rawPlan(candidate.fn.id), {
        ownKeys(target) {
          if (!captured) {
            captured = true;
            setTimeout(() => controller.abort(reason), 0);
          }
          return Reflect.ownKeys(target);
        },
      });
      const pending = finalizeRegistryOwnedFunctionSignaturesAsync([candidate], options, controller.signal,
        async () => ({ status: "Solved", items: [item] }));
      await expect(pending).rejects.toBe(reason);
      expect(captured).toBe(true);
      expect(signaturePlanReuseStats().authoredEntries).toBe(0);
      expect(finalizeRegistryOwnedFunctionSignatures([candidate], options)[0]!.fn.returns)
        .toEqual({ $ref: "Number" });
    } finally {
      __clearSignaturePlanReuseForTests();
    }
  }, 180_000);

  test("keeps malformed unused explicit callables eager", () => {
    const candidate = complete("external-projection:explicit");
    expect(() => finalizeRegistryFunctionSignatures([candidate], {
      resolutions: [], externalCallables: [{ name: "unused", targetId: "unused",
        scheme: { quantified: [], body: { $ref: "Number" } }, trust: { $tag: "unknown" } as never }],
    })).toThrow(/unknown signature trust/);
    const badScheme: TypeScheme = {
      quantified: [], body: { $el: { call: ["f"] } },
      applications: [{ path: [], headVarId: "not-quantified", args: [], kind: { $tag: "KType" } }],
    };
    expect(() => finalizeRegistryFunctionSignatures([candidate], {
      resolutions: [], externalCallables: [{ name: "unused", targetId: "unused", scheme: badScheme,
        trust: { $tag: "TrustedPrimitive", evidence: {} } }],
    })).toThrow(/unknown quantified id/);
  }, 180_000);

  test("captures explicit callable schemes before a reference callback can mutate the source", () => {
    const externalScheme = { quantified: [], body: { $arrow: { params: [], returns: { $ref: "Number" } } } };
    const caller = inferred("external-projection:captured", { call: ["external"] });
    const actual = finalizeRegistryFunctionSignatures([caller], {
      resolutions: [{ name: "external", status: "resolved", targetId: "external-id" }],
      externalCallables: [{ name: "external", targetId: "external-id", scheme: externalScheme,
        trust: { $tag: "TrustedPrimitive", evidence: {} } }],
      resolveCandidateReferences(_id, names) {
        externalScheme.body.$arrow.returns = { $ref: "String" };
        return names.map((name) => ({ name, status: "resolved" as const, targetId: "external-id" }));
      },
    });
    expect(actual[0]!.fn.returns).toEqual({ $ref: "Number" });
  }, 180_000);
});
