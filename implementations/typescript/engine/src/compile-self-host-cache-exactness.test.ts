import { beforeAll, describe, expect, it } from "vitest";
import type { FenelFunction } from "./types";
import {
  candidateFns as jsCandidateFns,
  FN_SAMPLES as JS_FN_SAMPLES,
  getClassifierStats as getJsClassifierStats,
  prepareClassifier as prepareJsClassifier,
  runOne as runJsOne,
} from "./compile-js-self-host-classifier";
import {
  candidateFns as llvmCandidateFns,
  getClassifierStats as getLlvmClassifierStats,
  prepareClassifier as prepareLlvmClassifier,
  runOne as runLlvmOne,
} from "./compile-llvm-self-host-classifier";

const samples = [[2, 7, 0.5]] as const;

function lerpCandidate(candidates: readonly FenelFunction[]): FenelFunction {
  const fn = candidates.find((candidate) => candidate.id === "std:lerp");
  if (fn === undefined) throw new Error("std:lerp self-host candidate is absent");
  return fn;
}

function withBody(
  candidate: FenelFunction,
  body: { var: string },
): FenelFunction {
  return { ...candidate, body };
}

describe("JS self-host compile cache exactness", () => {
  beforeAll(() => prepareJsClassifier(), 600_000);

  it("rejects same-id source collisions and isolates its retained fingerprint", () => {
    const candidate = lerpCandidate(jsCandidateFns);
    const mutableBody = { var: "a" };
    const mutableFn = withBody(candidate, mutableBody);

    const before = getJsClassifierStats().artifactCompileAttempts;
    expect(runJsOne(mutableFn, samples).status).toBe("ok");
    const afterFirst = getJsClassifierStats().artifactCompileAttempts;
    expect(afterFirst).toBe(before + 1);

    // Equivalent complete source may reuse the artifact across caller objects.
    expect(runJsOne(withBody(candidate, { var: "a" }), samples).status).toBe("ok");
    expect(getJsClassifierStats().artifactCompileAttempts).toBe(afterFirst);

    // Mutation must not rewrite the retained fingerprint by alias. The new
    // source is compiled and compared against its matching interpreter body.
    mutableBody.var = "b";
    expect(runJsOne(mutableFn, samples).status).toBe("ok");
    const afterMutation = getJsClassifierStats().artifactCompileAttempts;
    expect(afterMutation).toBe(afterFirst + 1);

    // The id still matches, but a third body is a distinct compiler input.
    expect(runJsOne(withBody(candidate, { var: "t" }), samples).status).toBe("ok");
    expect(getJsClassifierStats().artifactCompileAttempts).toBe(afterMutation + 1);
  }, 600_000);

  it("does not publish an adversarial same-id artifact to dependent candidates", () => {
    const lerp = lerpCandidate(jsCandidateFns);
    const hostileLerp = withBody(lerp, { var: "a" });
    expect(runJsOne(hostileLerp, samples).status).toBe("ok");

    const line = jsCandidateFns.find((candidate) => candidate.id === "path:line");
    if (line === undefined) throw new Error("path:line self-host candidate is absent");
    const lineSamples = JS_FN_SAMPLES["path:line"];
    if (lineSamples === undefined || lineSamples.length === 0) {
      throw new Error("path:line self-host samples are absent");
    }
    // path:line invokes std:lerp twice. It must resolve the canonical lazy
    // helper, not the hostile artifact compiled by the public runOne call.
    expect(runJsOne(line, lineSamples).status).toBe("ok");
  }, 600_000);
});

describe("LLVM self-host compile cache exactness", () => {
  beforeAll(() => prepareLlvmClassifier(), 600_000);

  it("rejects same-id source collisions and isolates its retained fingerprint", async () => {
    const candidate = lerpCandidate(llvmCandidateFns);
    const mutableBody = { var: "a" };
    const mutableFn = withBody(candidate, mutableBody);

    const before = getLlvmClassifierStats().artifactCompileAttempts;
    expect((await runLlvmOne(mutableFn, samples)).status).toBe("ok");
    const afterFirst = getLlvmClassifierStats().artifactCompileAttempts;
    expect(afterFirst).toBe(before + 1);

    expect((await runLlvmOne(withBody(candidate, { var: "a" }), samples)).status).toBe("ok");
    expect(getLlvmClassifierStats().artifactCompileAttempts).toBe(afterFirst);

    mutableBody.var = "b";
    expect((await runLlvmOne(mutableFn, samples)).status).toBe("ok");
    const afterMutation = getLlvmClassifierStats().artifactCompileAttempts;
    expect(afterMutation).toBe(afterFirst + 1);

    expect((await runLlvmOne(withBody(candidate, { var: "t" }), samples)).status).toBe("ok");
    expect(getLlvmClassifierStats().artifactCompileAttempts).toBe(afterMutation + 1);
  }, 600_000);
});
