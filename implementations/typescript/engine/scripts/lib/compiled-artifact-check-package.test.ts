import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { encodeCanonicalJson } from "./artifact-wire-json";
import { makeRawCompiledArtifactInput } from "./compiled-artifact-input-key";
import {
  COMPILED_ARTIFACT_SPECS,
  PORTABLE_GENERATION_ABI,
} from "./compiled-artifact-protocol";
import {
  CHECK_PACKAGE_SCHEMA,
  CHECK_PACKAGE_JSON_SCHEMA,
  buildCheckPackageNamespace,
  computeCheckPackageDigest,
  validateCheckPackageMetadata,
  type CheckPackageFileRow,
  type CompiledArtifactCheckPackageMetadata,
} from "./compiled-artifact-check-package";

const digest = (character: string): string => character.repeat(64);
const artifactPath = COMPILED_ARTIFACT_SPECS["compiled-parser"].artifactPath;

function row(path: string, marker: string, byteLength = 10): CheckPackageFileRow {
  return { path, kind: "file", byteLength, digest: digest(marker) };
}

function metadata(
  sourceProvenance: CompiledArtifactCheckPackageMetadata["sourceProvenance"] = {
    kind: "git-object",
    sourceCommit: "f".repeat(40),
    workflowDigest: digest("9"),
  },
): CompiledArtifactCheckPackageMetadata {
  const sourceFiles = [row(artifactPath, "1"), row("scripts/owner-worker.ts", "2")];
  const candidateFiles = [row(artifactPath, "3", 20)];
  const environmentFiles = [row(".github/fenel-artifact-toolchains.json", "4", 30)];
  return {
    schema: CHECK_PACKAGE_SCHEMA,
    artifact: "compiled-parser",
    artifactPath,
    portableGenerationAbi: PORTABLE_GENERATION_ABI,
    sourceProvenance,
    repositoryEpoch: digest("5"),
    ownerEpoch: digest("6"),
    dependencyDigest: digest("7"),
    attestationPolicyDigest: digest("8"),
    producerInput: makeRawCompiledArtifactInput({
      artifact: "compiled-parser",
      acquisitionDigest: digest("a"),
      ownerOverlayDigest: digest("b"),
      repositoryExactDigest: digest("c"),
      dependencyDigest: digest("7"),
      environmentFingerprint: digest("d"),
      recoveryStubVersion: digest("e"),
      portableGenerationAbi: PORTABLE_GENERATION_ABI,
    }),
    namespaces: {
      source: buildCheckPackageNamespace("source", sourceFiles),
      candidate: buildCheckPackageNamespace("candidate", candidateFiles),
      environment: buildCheckPackageNamespace("environment", environmentFiles),
    },
  };
}

describe("compiled-artifact check package", () => {
  test("the checked-in JSON Schema is the exact canonical exported schema", () => {
    expect(readFileSync(new URL("./compiled-artifact-check-package.schema.json", import.meta.url)))
      .toEqual(Buffer.from(encodeCanonicalJson(CHECK_PACKAGE_JSON_SCHEMA)));
  });

  test("accepts exact Git-object and stable-live packages and binds all namespaces", () => {
    const git = metadata();
    expect(validateCheckPackageMetadata(git)).toEqual(git);
    const live = metadata({ kind: "stable-live" });
    expect(validateCheckPackageMetadata(live)).toEqual(live);
    expect(computeCheckPackageDigest(live)).not.toBe(computeCheckPackageDigest(git));
  });

  test("rejects non-regular, unsafe, duplicate, case-colliding, and unordered rows", () => {
    expect(() => buildCheckPackageNamespace("source", [row("../escape.ts", "1")]))
      .toThrow("parent segment");
    expect(() => buildCheckPackageNamespace("source", [row("a\\b.ts", "1")]))
      .toThrow("slash-stable");
    expect(() => buildCheckPackageNamespace("source", [row("CON/file.ts", "1")]))
      .toThrow("reserved segment");
    expect(() => buildCheckPackageNamespace("source", [row("bad./file.ts", "1")]))
      .toThrow("reserved segment");
    expect(() => buildCheckPackageNamespace("source", [row("e\u0301/file.ts", "1")]))
      .toThrow("reserved segment");
    expect(() => buildCheckPackageNamespace("source", [row("b.ts", "1"), row("a.ts", "2")]))
      .toThrow("out of UTF-8 path order");
    expect(() => buildCheckPackageNamespace("source", [row("A.ts", "1"), row("a.ts", "2")]))
      .toThrow("case-only collision");
    expect(() => validateCheckPackageMetadata({
      ...metadata(),
      namespaces: {
        ...metadata().namespaces,
        source: {
          digest: digest("1"),
          fileCount: 1,
          byteLength: 1,
          files: [{ path: "x", kind: "symlink", byteLength: 1, digest: digest("2") }],
        },
      },
    })).toThrow("expected one of");
  });

  test("recomputes row count, byte length, and namespace digest", () => {
    const valid = metadata();
    expect(() => validateCheckPackageMetadata({
      ...valid,
      namespaces: {
        ...valid.namespaces,
        source: { ...valid.namespaces.source, fileCount: 99 },
      },
    })).toThrow("files.length");
    expect(() => validateCheckPackageMetadata({
      ...valid,
      namespaces: {
        ...valid.namespaces,
        source: { ...valid.namespaces.source, byteLength: 99 },
      },
    })).toThrow("sum of file bytes");
    expect(() => validateCheckPackageMetadata({
      ...valid,
      namespaces: {
        ...valid.namespaces,
        source: { ...valid.namespaces.source, digest: digest("0") },
      },
    })).toThrow("canonical namespace rows");
  });

  test("enforces disjoint namespace roles and exact artifact/path coupling", () => {
    const valid = metadata();
    const extraCandidateFiles = [
      row(artifactPath, "3", 20),
      row("other.ts", "4"),
    ];
    expect(() => validateCheckPackageMetadata({
      ...valid,
      namespaces: {
        ...valid.namespaces,
        candidate: buildCheckPackageNamespace("candidate", extraCandidateFiles),
      },
    })).toThrow("exactly the detached artifact");
    expect(() => validateCheckPackageMetadata({
      ...valid,
      namespaces: {
        ...valid.namespaces,
        source: buildCheckPackageNamespace("source", [row("scripts/owner-worker.ts", "2")]),
      },
    })).toThrow("inert recovery stub");
    expect(() => validateCheckPackageMetadata({
      ...valid,
      namespaces: {
        ...valid.namespaces,
        environment: buildCheckPackageNamespace("environment", [row("environment.json", "4")]),
      },
    })).toThrow("toolchain manifest");
    expect(() => validateCheckPackageMetadata({ ...valid, artifactPath: "wrong.ts" }))
      .toThrow("must be");
  });

  test("source provenance is a strict discriminated union", () => {
    expect(() => validateCheckPackageMetadata({
      ...metadata(),
      sourceProvenance: { kind: "stable-live", sourceCommit: "f".repeat(40) },
    })).toThrow("unknown property");
    expect(() => validateCheckPackageMetadata({
      ...metadata(),
      sourceProvenance: { kind: "git-object" },
    })).toThrow("required property");
    expect(() => validateCheckPackageMetadata({ ...metadata(), extra: true }))
      .toThrow("unknown property");
  });
});
