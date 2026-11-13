import { describe, expect, test } from "bun:test";

import { dispatchEngineBody } from "./engine-bodies-dispatch";
import {
  __finalizeRegistryFunctionSignaturesWithAuthoredPlannerForTests,
  finalizeRegistryFunctionSignatures,
  type RegistryFunctionSignatureCandidate,
  SignatureAnnotationRequiredError,
  type SignatureResolutionRow,
} from "./signature-inference";
import { Nothing } from "./type-foundation";
import type { FieldDef, FenelFunction, FenelType, TypeScheme } from "./types";

const authored = {
  $tag: "Authored" as const,
  source: { $tag: "HostSpec" as const, module: "authored-fence-test" },
};

function positionalField(name: string, index: number, type: FenelType): FieldDef {
  return {
    name,
    key: { $tag: "PositionalField", index },
    type,
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
}

function completeCandidate(
  id: string,
  codeName: string,
  params: readonly FieldDef[],
  returns: FenelType,
  scheme: TypeScheme,
): RegistryFunctionSignatureCandidate {
  const fn: FenelFunction = {
    id,
    params: [...params],
    returns,
    body: params.length === 0 ? null : { var: params[0]!.name },
  };
  return {
    fn,
    declaration: {
      functionId: id,
      declarationName: codeName,
      codeName,
      scheme,
      params: params.map(() => authored),
      returns: authored,
    },
    implementationOrigin: { $tag: "HostNative", map: "nativeImpls" },
  };
}

function fixtureResolutionRows(
  candidates: readonly RegistryFunctionSignatureCandidate[],
): SignatureResolutionRow[] {
  const bindings = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const name of [candidate.fn.id, candidate.declaration.codeName]) {
      const ids = bindings.get(name) ?? new Set<string>();
      ids.add(candidate.fn.id);
      bindings.set(name, ids);
    }
  }
  return [...bindings]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, ids]) => ids.size === 1
      ? { name, status: "resolved" as const, targetId: [...ids][0]! }
      : { name, status: "ambiguous" as const, targetId: "" });
}

function finalizeFixture(
  candidates: readonly RegistryFunctionSignatureCandidate[],
) {
  return finalizeRegistryFunctionSignatures(candidates, {
    resolutions: fixtureResolutionRows(candidates),
  });
}

function simpleCompleteCandidate(
  id: string,
  codeName: string,
): RegistryFunctionSignatureCandidate {
  const params = [positionalField("value", 0, { $ref: "String" })];
  const returns: FenelType = { $ref: "String" };
  return completeCandidate(
    id,
    codeName,
    params,
    returns,
    {
      quantified: [],
      body: { $arrow: { params, returns } },
    },
  );
}

function simpleCompleteCandidates(count: number): RegistryFunctionSignatureCandidate[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(3, "0");
    return simpleCompleteCandidate(
      `authored-fence-test:batched${suffix}`,
      `batched${suffix}`,
    );
  });
}

function withSourceDiagnostic(
  candidate: RegistryFunctionSignatureCandidate,
  spelling: string,
): RegistryFunctionSignatureCandidate {
  const scheme = candidate.declaration.scheme;
  if (scheme === undefined) throw new Error("expected a complete authored scheme fixture");
  return {
    ...candidate,
    declaration: {
      ...candidate.declaration,
      scheme: {
        ...scheme,
        diagnostics: [{
          code: "UnboundSourceTypeVariable",
          declaration: candidate.declaration.declarationName,
          path: ["params", "0"],
          spelling,
          message: `unbound source type variable ${spelling}`,
        }],
      },
    },
  };
}

describe("complete authored inference fences", () => {
  test("plans 257 complete authored signatures in bounded 128, 128, 1 transports", () => {
    const candidates = simpleCompleteCandidates(257);
    const batchSizes: number[] = [];
    const finalized = __finalizeRegistryFunctionSignaturesWithAuthoredPlannerForTests(
      candidates,
      { resolutions: [] },
      (batch, path) => {
        batchSizes.push(batch.length);
        return dispatchEngineBody("engine:planAuthoredTopLevelSignatures", [batch, path]);
      },
    );

    expect(batchSizes).toEqual([128, 128, 1]);
    expect(finalized.map(({ fn }) => fn.id)).toEqual(
      candidates.map(({ fn }) => fn.id),
    );
    expect(finalized).toHaveLength(257);
    expect(finalized.every(({ info }) => info.outcome.$tag === "Solved")).toBe(true);
  }, 180_000);

  test("a later authored batch keeps its first diagnostic and publishes no solved prefix", () => {
    const candidates = simpleCompleteCandidates(257);
    candidates[128] = withSourceDiagnostic(candidates[128]!, "firstLaterBatchFailure");
    candidates[129] = withSourceDiagnostic(candidates[129]!, "secondLaterBatchFailure");
    const firstSourceFn = candidates[0]!.fn;
    const firstSourceReturns = firstSourceFn.returns;
    const batchSizes: number[] = [];
    let published: ReturnType<
      typeof __finalizeRegistryFunctionSignaturesWithAuthoredPlannerForTests
    > | undefined;
    let caught: unknown;

    try {
      published = __finalizeRegistryFunctionSignaturesWithAuthoredPlannerForTests(
        candidates,
        { resolutions: [] },
        (batch, path) => {
          batchSizes.push(batch.length);
          return dispatchEngineBody("engine:planAuthoredTopLevelSignatures", [batch, path]);
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(batchSizes).toEqual([128, 128]);
    expect(published).toBeUndefined();
    expect(caught).toBeInstanceOf(SignatureAnnotationRequiredError);
    if (!(caught instanceof SignatureAnnotationRequiredError)) return;
    expect(caught.diagnostics).toHaveLength(1);
    expect(caught.diagnostics[0]).toMatchObject({
      code: "inference.source-scheme",
      functionId: candidates[128]!.fn.id,
    });
    expect(firstSourceFn.returns).toBe(firstSourceReturns);
    expect(Object.isFrozen(firstSourceFn)).toBe(false);
  }, 180_000);

  test("prepares every authored boundary before a first-batch planner error can win", () => {
    const candidates = simpleCompleteCandidates(129);
    const preparedIds: string[] = [];
    let plannerCalls = 0;

    expect(() => __finalizeRegistryFunctionSignaturesWithAuthoredPlannerForTests(
      candidates,
      {
        resolutions: [],
        resolveCandidateNominalReferences(functionId, names) {
          preparedIds.push(functionId);
          if (functionId === candidates[128]!.fn.id) {
            throw new Error("late authored boundary preparation wins");
          }
          return names.map((name) => ({
            name,
            status: "missing" as const,
            targetId: "",
          }));
        },
      },
      (_batch, path) => {
        plannerCalls += 1;
        return {
          $tag: "Invalid",
          diagnostics: [{
            code: "inference.injected-first-batch",
            path,
            message: "the first Fenel batch must not run before boundary preparation finishes",
          }],
        };
      },
    )).toThrow("late authored boundary preparation wins");

    expect(preparedIds).toEqual(candidates.map(({ fn }) => fn.id));
    expect(plannerCalls).toBe(0);
  });

  test("rejects permuted or duplicate authored plans before downstream resolution", () => {
    const authoredCandidates = simpleCompleteCandidates(2);
    const missingFn: FenelFunction = {
      id: "authored-fence-test:missingConsumer",
      params: [],
      returns: { $var: "compat-return" },
      body: { call: [authoredCandidates[0]!.declaration.codeName, "value"] },
    };
    const missingCandidate: RegistryFunctionSignatureCandidate = {
      fn: missingFn,
      declaration: {
        functionId: missingFn.id,
        declarationName: "missingConsumer",
        codeName: "missingConsumer",
        params: [],
        returns: { $tag: "Absent" },
      },
      implementationOrigin: { $tag: "FenelBody" },
    };
    const candidates = [...authoredCandidates, missingCandidate];

    for (const mode of ["permuted", "duplicate"] as const) {
      let downstreamResolutionCalls = 0;
      expect(() => __finalizeRegistryFunctionSignaturesWithAuthoredPlannerForTests(
        candidates,
        {
          resolutions: fixtureResolutionRows(candidates),
          resolveCandidateReferences: (_functionId, names) => {
            downstreamResolutionCalls += 1;
            return names.map((name) => ({
              name,
              status: "missing" as const,
              targetId: "",
            }));
          },
        },
        (batch, path) => {
          const raw = dispatchEngineBody(
            "engine:planAuthoredTopLevelSignatures",
            [batch, path],
          ) as {
            $tag: "Solved";
            plan: { functions: unknown[] } & Record<string, unknown>;
          };
          const [first, second] = raw.plan.functions;
          return {
            ...raw,
            plan: {
              ...raw.plan,
              functions: mode === "permuted"
                ? [second, first]
                : [first, first],
            },
          };
        },
      )).toThrow(
        mode === "permuted"
          ? `expected ordered plan ${authoredCandidates[0]!.fn.id} at batch offset 0, received ${authoredCandidates[1]!.fn.id}`
          : `expected ordered plan ${authoredCandidates[1]!.fn.id} at batch offset 1, received ${authoredCandidates[0]!.fn.id}`,
      );
      expect(downstreamResolutionCalls).toBe(0);
    }
  }, 180_000);

  test("attributes a cross-batch substring diagnostic against the complete authored roster", () => {
    const candidates = simpleCompleteCandidates(129);
    const shorterId = "authored-fence-test:substringTarget";
    const longerId = `${shorterId}Extended`;
    candidates[0] = simpleCompleteCandidate(shorterId, "substringTarget");
    candidates[128] = simpleCompleteCandidate(longerId, "substringTargetExtended");
    let plannerCalls = 0;
    let caught: unknown;

    try {
      __finalizeRegistryFunctionSignaturesWithAuthoredPlannerForTests(
        candidates,
        { resolutions: [] },
        (batch, path) => {
          plannerCalls += 1;
          if (plannerCalls === 1) {
            return dispatchEngineBody(
              "engine:planAuthoredTopLevelSignatures",
              [batch, path],
            );
          }
          return {
            $tag: "Invalid",
            diagnostics: [{
              code: "inference.cross-batch-substring",
              path: `${path}/${longerId}`,
              message: "cross-batch substring diagnostic",
            }],
          };
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(plannerCalls).toBe(2);
    expect(caught).toBeInstanceOf(SignatureAnnotationRequiredError);
    if (!(caught instanceof SignatureAnnotationRequiredError)) return;
    expect(caught.diagnostics).toEqual([{
      code: "inference.cross-batch-substring",
      functionId: shorterId,
      message: "cross-batch substring diagnostic",
      path: [`registry/signatures/authored/${longerId}`],
    }]);
  }, 180_000);

  test("publishes an exact dependent authored scheme as AnnotationRequired Advisory", () => {
    const dependent = {
      $el: { call: ["Vec", { var: "length" }] },
    } as FenelType;
    const params = [positionalField("length", 0, { $ref: "Number" })];
    const scheme: TypeScheme = {
      quantified: [],
      body: { $arrow: { params, returns: dependent } },
      applications: [],
    };
    const [published] = finalizeFixture([
      completeCandidate("authored-fence-test:tabulateVec", "tabulateVec", params, dependent, scheme),
    ]);

    expect(published!.info.scheme).toEqual(scheme);
    expect(published!.info.params).toEqual([authored]);
    expect(published!.info.returns).toEqual(authored);
    expect(published!.info.outcome.$tag).toBe("AnnotationRequired");
    if (published!.info.outcome.$tag === "AnnotationRequired") {
      expect(published!.info.outcome.diagnostics.map(({ code }) => code)).toEqual([
        "inference.value-dependent-type",
      ]);
    }
    expect(published!.info.trust.$tag).toBe("Advisory");
  }, 180_000);

  test("does not expose a fenced authored scheme as an external callable", () => {
    const dependent = {
      $el: { call: ["Vec", { var: "length" }] },
    } as FenelType;
    const params = [positionalField("length", 0, { $ref: "Number" })];
    const target = completeCandidate(
      "authored-fence-test:tabulateVec",
      "tabulateVec",
      params,
      dependent,
      {
        quantified: [],
        body: { $arrow: { params, returns: dependent } },
        applications: [],
      },
    );
    const callerFn: FenelFunction = {
      id: "authored-fence-test:caller",
      params: [],
      returns: { $var: "compat-return" },
      body: { call: ["tabulateVec", 2] },
    };
    const caller: RegistryFunctionSignatureCandidate = {
      fn: callerFn,
      declaration: {
        functionId: callerFn.id,
        declarationName: "caller",
        codeName: "caller",
        params: [],
        returns: { $tag: "Absent" },
      },
      implementationOrigin: { $tag: "FenelBody" },
    };

    expect(() => finalizeFixture([target, caller])).toThrow(
      "inference.unknown-name",
    );
  }, 180_000);

  test("keeps malformed complete declarations batch-atomic", () => {
    const validParams = [positionalField("value", 0, { $ref: "String" })];
    const valid = completeCandidate(
      "authored-fence-test:valid",
      "valid",
      validParams,
      { $ref: "String" },
      {
        quantified: [],
        body: { $arrow: { params: validParams, returns: { $ref: "String" } } },
      },
    );
    const malformed = {} as FenelType;
    const invalid = completeCandidate(
      "authored-fence-test:malformed",
      "malformed",
      [],
      malformed,
      { quantified: [], body: { $arrow: { params: [], returns: malformed } } },
    );

    expect(() => finalizeFixture([valid, invalid])).toThrow(
      "inference.malformed-type",
    );
  }, 180_000);
});
