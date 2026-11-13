import { describe, expect, test } from "bun:test";
import {
  digestByteManifest,
  parseSha256Hex,
  repositoryRelativePath,
  sha256Raw,
  type ByteManifestRow,
} from "./artifact-bytes";
import { encodeCanonicalJson } from "./artifact-wire-json";
import {
  CURRENT_SELF_HOST_MATRIX_MODE,
  LEGACY_STAMPLESS_TOMBSTONE_DIGEST,
  MATRIX_NO_FAILURE_DIGEST,
  SELF_HOST_MATRIX_EXACT_INPUTS,
  SELF_HOST_MATRIX_RECURSIVE_ROOTS,
  UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
  assertMatrixCandidateEqualsCommitted,
  computeMatrixPackageDigest,
  encodeMatrixControllerReceipt,
  encodeMatrixEnvironmentCertificate,
  evaluateMatrixState,
  insertMatrixStamp,
  makeMatrixControllerReceipt,
  makeMatrixEnvironmentCertificate,
  makeMatrixInputsCertificate,
  makeMatrixLeg,
  matrixArtifactIdentity,
  matrixFailureDigest,
  matrixStampFor,
  matrixStampLine,
  normalizeMatrixControllerArgs,
  parseMatrixControllerReceipt,
  parseMatrixDocument,
  parseMatrixEnvironmentCertificate,
  replaceMatrixPresentation,
  type MatrixArtifactIdentity,
  type MatrixEnvironmentCertificate,
  type MatrixRelationEvidence,
} from "./self-host-matrix-certificate";

const digest = (character: string) => parseSha256Hex(character.repeat(64));
const sourceCommit = "1".repeat(40);

function row(path: string, text = `${path}\n`): ByteManifestRow {
  const bytes = new TextEncoder().encode(text);
  return {
    path: repositoryRelativePath(path),
    kind: "regular-file",
    byteLength: bytes.byteLength,
    sha256: sha256Raw(bytes),
  };
}

function sourceRows(): readonly ByteManifestRow[] {
  return [
    ...SELF_HOST_MATRIX_EXACT_INPUTS.map((path) => row(path)),
    ...SELF_HOST_MATRIX_RECURSIVE_ROOTS.map((root) => row(`${root}/fixture.ts`)),
  ];
}

function inputs() {
  return makeMatrixInputsCertificate({
    sourceRows: sourceRows(),
    dependencyRows: [],
  });
}

function shapeEnvironment(): MatrixEnvironmentCertificate {
  return makeMatrixEnvironmentCertificate({
    osFamily: "windows",
    arch: "x64",
    bun: {
      executableSha256: digest("b"),
      release: "1.3.13",
      revision: "2".repeat(40),
      webkit: "WebKit-fixture",
      icu: "73.2",
      unicode: "15.0",
    },
    toolchainManifestDigest: digest("a"),
    locale: "en-US",
    timezone: "UTC",
    parentEnvironment: [
      { key: "COMSPEC", value: "C:\\Windows\\System32\\cmd.exe" },
      { key: "LANG", value: "C.UTF-8" },
      { key: "LC_ALL", value: "C.UTF-8" },
      { key: "NO_COLOR", value: "1" },
      { key: "PATH", value: "<matrix-package>/.bin" },
      { key: "TEMP", value: "<matrix-package>/.tmp" },
      { key: "TMP", value: "<matrix-package>/.tmp" },
      { key: "TZ", value: "UTC" },
      { key: "SYSTEMROOT", value: "C:\\Windows" },
    ],
    externalTool: {
      mode: "shape-only",
      privatePath: "<matrix-package>/.bin",
      clang: "absent",
    },
  });
}

function stamplessDocument(): Uint8Array {
  return new TextEncoder().encode(`---
verified: 2026-08-11
verified_at_sha: 1111111
covers:
  - fixture
---

# Self-Host Matrix

| fnId | Body |
|---|---|
| \`std:add\` | Fenel |
`);
}

function stampedDocument(): Uint8Array {
  const base = stamplessDocument();
  const observation = parseMatrixDocument(base);
  const stamp = matrixStampFor({
    inputs: inputs(),
    environment: shapeEnvironment(),
    bodyDigest: observation.bodyDigest,
  });
  return insertMatrixStamp(base, stamp);
}

function evidence(overrides: Partial<MatrixRelationEvidence> = {}): MatrixRelationEvidence {
  return {
    artifact: "present",
    stampClass: "valid",
    inputs: "equal",
    environment: "equal",
    body: "equal",
    ...overrides,
  };
}

describe("self-host matrix byte contracts", () => {
  test("inputs cover all roots/configs, hash arbitrary additions, and exclude the artifact", () => {
    const first = inputs();
    const second = makeMatrixInputsCertificate({
      sourceRows: [...sourceRows(), row("fenel/new-arbitrary-file.fenel")],
      dependencyRows: [],
    });
    expect(first.digest).not.toBe(second.digest);
    expect(() => makeMatrixInputsCertificate({
      sourceRows: sourceRows().filter((item) => item.path !== ".fenel.lock"),
      dependencyRows: [],
    })).toThrow("omits .fenel.lock");
    expect(() => makeMatrixInputsCertificate({
      sourceRows: [...sourceRows(), row("docs/SELF_HOST_MATRIX.md")],
      dependencyRows: [],
    })).toThrow("may not hash");
    expect(inputs().digest).toBe(first.digest);
    expect(makeMatrixEnvironmentCertificate({
      ...shapeEnvironment(),
      toolchainManifestDigest: digest("d"),
    }).digest).not.toBe(shapeEnvironment().digest);
  });

  test("shape-only and pinned-bundle environment certificates are canonical and closed", () => {
    const shape = shapeEnvironment();
    expect(parseMatrixEnvironmentCertificate(encodeMatrixEnvironmentCertificate(shape))).toEqual(shape);
    expect(() => parseMatrixEnvironmentCertificate(encodeCanonicalJson({
      ...shape,
      extra: true,
    }))).toThrow("unknown property");
    expect(() => parseMatrixEnvironmentCertificate(encodeCanonicalJson({
      ...shape,
      bun: { ...shape.bun, extra: true },
    }))).toThrow("unknown property");
    expect(() => parseMatrixEnvironmentCertificate(encodeCanonicalJson({
      ...shape,
      parentEnvironment: [...shape.parentEnvironment].reverse(),
    }))).toThrow("UTF-8 byte order");
    expect(() => parseMatrixEnvironmentCertificate(encodeCanonicalJson({
      ...shape,
      parentEnvironment: shape.parentEnvironment.map((row, index) => (
        index === 0 ? { ...row, extra: true } : row
      )),
    }))).toThrow("unknown property");
    const bundleManifest = digestByteManifest("self-host-matrix-toolchain-bundle", [
      row("bundle/bin/clang"),
      row("bundle/lib/runtime.a"),
    ]);
    const pinned = makeMatrixEnvironmentCertificate({
      ...shape,
      externalTool: {
        mode: "pinned-bundle",
        archiveSha256: digest("c"),
        entrypoint: repositoryRelativePath("bundle/bin/clang"),
        manifest: bundleManifest,
        childEnvironment: [
          ...shape.parentEnvironment,
          { key: "FENEL_LLVM_IN_SUBPROCESS", value: "1" },
        ],
      },
    });
    expect(pinned.digest).not.toBe(shape.digest);
    expect(parseMatrixEnvironmentCertificate(encodeMatrixEnvironmentCertificate(pinned))).toEqual(pinned);
    if (pinned.externalTool.mode !== "pinned-bundle") throw new Error("fixture mode changed");
    const pinnedExternalTool = pinned.externalTool;
    expect(() => parseMatrixEnvironmentCertificate(encodeCanonicalJson({
      ...pinned,
      externalTool: {
        ...pinnedExternalTool,
        manifest: {
          ...pinnedExternalTool.manifest,
          rows: pinnedExternalTool.manifest.rows.map((item, index) => (
            index === 0 ? { ...item, extra: true } : item
          )),
        },
      },
    }))).toThrow("unknown property");
    expect(() => makeMatrixEnvironmentCertificate({
      ...shape,
      parentEnvironment: shape.parentEnvironment.filter((row) => row.key !== "TMP"),
    })).toThrow("closed v1 key set");
    expect(() => makeMatrixEnvironmentCertificate({
      ...shape,
      timezone: "Europe/Paris",
    })).toThrow("timezone must be UTC");
    expect(() => makeMatrixEnvironmentCertificate({
      ...shape,
      externalTool: {
        mode: "pinned-bundle",
        archiveSha256: digest("c"),
        entrypoint: repositoryRelativePath("bundle/bin/missing"),
        manifest: bundleManifest,
        childEnvironment: [
          ...shape.parentEnvironment,
          { key: "FENEL_LLVM_IN_SUBPROCESS", value: "1" },
        ],
      },
    })).toThrow("entrypoint is absent");
    expect(() => makeMatrixEnvironmentCertificate({
      ...shape,
      externalTool: {
        mode: "pinned-bundle",
        archiveSha256: digest("c"),
        entrypoint: repositoryRelativePath("bundle/bin/clang"),
        manifest: bundleManifest,
        childEnvironment: [
          ...shape.parentEnvironment,
          { key: "FENEL_LLVM_IN_SUBPROCESS", value: "0" },
          { key: "FENEL_LLVM_IN_SUBPROCESS", value: "1" },
        ],
      },
    })).toThrow("exactly FENEL_LLVM_IN_SUBPROCESS=1");
  });

  test("stamp parser enforces exact schema/order/placement and body normalization", () => {
    const stamped = stampedDocument();
    const parsed = parseMatrixDocument(stamped);
    expect(parsed.stampClass).toBe("valid");
    expect(parsed.stamp?.body).toBe(parsed.bodyDigest);
    expect(parsed.bodyDigest).toBe(parseMatrixDocument(stamplessDocument()).bodyDigest);
    const stampedLines = new TextDecoder().decode(stamped).split("\n");
    const stampIndex = stampedLines.findIndex((line) => line.startsWith("<!-- fenel:self-host-matrix:"));
    const headingIndex = stampedLines.indexOf("# Self-Host Matrix");
    expect(stampIndex).toBe(headingIndex - 1);
    expect(() => insertMatrixStamp(stamped, parsed.stamp!)).toThrow("requires a stampless document");
    expect(() => insertMatrixStamp(stamplessDocument(), matrixStampFor({
      inputs: inputs(),
      environment: shapeEnvironment(),
      bodyDigest: digest("f"),
    }))).toThrow("body does not match");
    const volatile = replaceMatrixPresentation(stamped, {
      verified: "2099-12-31",
      verifiedAtSha: "abcdef0",
    });
    expect(parseMatrixDocument(volatile).bodyDigest).toBe(parsed.bodyDigest);

    const text = new TextDecoder().decode(stamped);
    expect(parseMatrixDocument(new TextEncoder().encode(text.replace(
      "# Self-Host Matrix",
      `${matrixStampLine(parsed.stamp!)}\n# Self-Host Matrix`,
    ))).stampClass).toBe("duplicate");
    expect(parseMatrixDocument(new TextEncoder().encode(text.replace(
      "inputs=",
      "environment=",
    ))).stampClass).toBe("malformed");
    const illegal = text.replace(
      matrixStampLine(parsed.stamp!),
      "",
    ).replace(
      "| fnId | Body |",
      `${matrixStampLine(parsed.stamp!)}\n| fnId | Body |`,
    );
    expect(parseMatrixDocument(new TextEncoder().encode(illegal)).stampClass).toBe("illegal-placement");
    const corrupted = new TextEncoder().encode(text.replace("std:add", "std:sub"));
    expect(parseMatrixDocument(corrupted).bodyDigest).not.toBe(parsed.stamp?.body);
  });

  test("legacy absence is a kind-only tombstone and can never be FRESH", () => {
    const parsed = parseMatrixDocument(stamplessDocument());
    expect(parsed.stampClass).toBe("absent");
    expect(parsed.certificateDigest).toBe(LEGACY_STAMPLESS_TOMBSTONE_DIGEST);
    expect(() => makeMatrixControllerReceipt({
      evidence: "complete",
      failureDigest: MATRIX_NO_FAILURE_DIGEST,
      mode: "legacy-stampless",
      operation: "probe",
      decision: "FRESH",
      result: "FRESH",
      stampClass: "absent",
      inputsDigest: digest("1"),
      environmentDigest: digest("2"),
      bodyDigest: parsed.bodyDigest,
      certificateDigest: parsed.certificateDigest,
      controllerDigest: digest("3"),
      packageDigest: digest("4"),
      capturedPresentation: {
        sourceCommit,
        verified: "2026-08-11",
        verifiedAtSha: sourceCommit.slice(0, 7),
      },
      publication: {
        published: false,
        before: matrixArtifactIdentity(stamplessDocument()),
        candidate: { kind: "absent" },
        after: matrixArtifactIdentity(stamplessDocument()),
      },
    })).toThrow("FRESH requires");
  });
});

describe("self-host matrix state tables", () => {
  test("legacy-stampless table is total over its named rows", () => {
    const decide = (relation: MatrixRelationEvidence, selected = false, fullCheck: "failed" | "green" | "not-run" = "not-run") =>
      evaluateMatrixState({
        mode: "legacy-stampless",
        evidence: relation,
        selected,
        adoptCurrentEnvironment: false,
        fullCheck,
      });
    expect(decide(evidence({ artifact: "absent", stampClass: "absent" }))).toEqual({ decision: "LEGACY_DUE", action: "repair", exitCode: 0 });
    expect(decide(evidence({ stampClass: "absent" }))).toEqual({ decision: "SKIPPED_LEGACY", action: "none", exitCode: 0 });
    expect(decide(evidence({ stampClass: "absent" }), true)).toEqual({ decision: "LEGACY_DUE", action: "repair", exitCode: 0 });
    for (const stampClass of ["duplicate", "illegal-placement", "malformed"] as const) {
      expect(decide(evidence({ stampClass }))).toEqual({ decision: "UNDECIDABLE", action: "none", exitCode: 21 });
    }
    expect(decide(evidence())).toEqual({ decision: "FRESH", action: "none", exitCode: 0 });
    expect(decide(evidence({ inputs: "different" }))).toEqual({ decision: "DUE", action: "none", exitCode: 20 });
    expect(decide(evidence({ body: "different" }))).toEqual({ decision: "DUE", action: "none", exitCode: 20 });
    expect(decide(evidence({ environment: "foreign" }))).toEqual({ decision: "CHECK_REQUIRED", action: "check", exitCode: 0 });
    expect(decide(evidence({ environment: "foreign" }), false, "green")).toEqual({ decision: "VERIFIED_FOREIGN", action: "none", exitCode: 0 });
    expect(decide(evidence({ environment: "foreign", inputs: "different" }), false, "green")).toEqual({ decision: "VERIFIED_FOREIGN_DUE", action: "none", exitCode: 20 });
    expect(decide(evidence({ environment: "foreign" }), false, "failed")).toEqual({ decision: "CHECK_REQUIRED", action: "none", exitCode: 1 });
    expect(decide(evidence({ environment: "foreign", body: "different" }), false, "failed")).toEqual({ decision: "CHECK_REQUIRED", action: "none", exitCode: 1 });
  });

  test("required-v1 table keeps adoption explicit and fixture-only", () => {
    const decide = (relation: MatrixRelationEvidence, adopt = false, fullCheck: "failed" | "green" | "not-run" = "not-run") =>
      evaluateMatrixState({
        mode: "required-v1",
        evidence: relation,
        selected: false,
        adoptCurrentEnvironment: adopt,
        fullCheck,
      });
    for (const relation of [
      evidence({ artifact: "absent", stampClass: "absent" }),
      evidence({ stampClass: "absent" }),
      evidence({ stampClass: "duplicate" }),
      evidence({ stampClass: "illegal-placement" }),
      evidence({ stampClass: "malformed" }),
    ]) {
      expect(decide(relation)).toEqual({ decision: "DUE_UNTRUSTED", action: "none", exitCode: 20 });
      expect(decide(relation, true)).toEqual({ decision: "REPAIR_REQUIRED", action: "repair", exitCode: 0 });
    }
    expect(decide(evidence())).toEqual({ decision: "FRESH", action: "none", exitCode: 0 });
    expect(decide(evidence(), true)).toEqual({ decision: "REPAIR_REQUIRED", action: "repair", exitCode: 0 });
    for (const relation of [
      evidence({ inputs: "different" }),
      evidence({ body: "different" }),
      evidence({ inputs: "different", body: "different" }),
    ]) {
      expect(decide(relation)).toEqual({ decision: "DUE", action: "none", exitCode: 20 });
      expect(decide(relation, true)).toEqual({ decision: "REPAIR_REQUIRED", action: "repair", exitCode: 0 });
    }
    for (const [relation, greenDecision, greenExit] of [
      [evidence({ environment: "foreign" }), "VERIFIED_FOREIGN", 0],
      [evidence({ environment: "foreign", inputs: "different" }), "VERIFIED_FOREIGN_DUE", 20],
      [evidence({ environment: "foreign", body: "different" }), "VERIFIED_FOREIGN_DUE", 20],
    ] as const) {
      expect(decide(relation)).toEqual({ decision: "CHECK_REQUIRED", action: "check", exitCode: 0 });
      expect(decide(relation, false, "green")).toEqual({ decision: greenDecision, action: "none", exitCode: greenExit });
      expect(decide(relation, false, "failed")).toEqual({ decision: "CHECK_REQUIRED", action: "none", exitCode: 1 });
      expect(decide(relation, true)).toEqual({ decision: "REPAIR_REQUIRED", action: "repair", exitCode: 0 });
    }
  });
});

describe("matrix CLI and receipt boundary", () => {
  test("operation normalization rejects every selector/operation conflict before work", () => {
    expect(CURRENT_SELF_HOST_MATRIX_MODE).toBe("required-v1");
    expect(normalizeMatrixControllerArgs(["--probe"])).toMatchObject({ operation: "probe" });
    expect(normalizeMatrixControllerArgs(["--check", "--progress", "--package=fixture"])).toMatchObject({ operation: "check", progress: true, packagePath: "fixture" });
    expect(normalizeMatrixControllerArgs(["--decide", "--function-mints=0", "--no-matrix"])).toMatchObject({ operation: "decide", functionMints: 0, noMatrix: true });
    expect(normalizeMatrixControllerArgs(["--repair"], "legacy-stampless", { allowInternalLegacyRepair: true })).toMatchObject({ operation: "repair" });
    expect(normalizeMatrixControllerArgs([
      "--decide",
      "--function-mints=0",
      "--with-matrix",
      `--adopt-matrix-environment=${digest("a")}`,
    ])).toMatchObject({ operation: "decide", withMatrix: true });
    expect(normalizeMatrixControllerArgs([
      "--repair",
      "--with-matrix",
      `--adopt-matrix-environment=${digest("a")}`,
      "--progress",
    ], "required-v1")).toMatchObject({ operation: "repair", progress: true });
    for (const args of [
      [],
      ["--probe", "--check"],
      ["--probe", "--probe"],
      ["--probe", "--progress"],
      ["--probe", "--package=fixture"],
      ["--probe", "--function-mints=1"],
      ["--probe", "--with-matrix"],
      ["--decide"],
      ["--decide", "--function-mints=-1"],
      ["--decide", "--function-mints=01"],
      ["--decide", "--function-mints=1.5"],
      ["--decide", "--function-mints=9007199254740992"],
      ["--decide", "--function-mints=1", "--function-mints=2"],
      ["--decide", "--function-mints=1", "--progress", "--progress"],
      ["--decide", "--function-mints=1", "--package=fixture"],
      ["--decide", "--function-mints=1", "--with-matrix", "--no-matrix"],
      ["--decide", "--function-mints=1", `--adopt-matrix-environment=${digest("a")}`],
      ["--decide", "--function-mints=1", "--with-matrix", "--adopt-matrix-environment=ABC"],
      ["--check", "--with-matrix"],
      ["--check", "--no-matrix"],
      ["--check", "--function-mints=1"],
      ["--check", "--package=first", "--package=second"],
      ["--repair"],
      ["--repair", "--function-mints=1"],
      ["--repair", "--package=fixture"],
      ["--unknown"],
    ]) expect(() => normalizeMatrixControllerArgs(args)).toThrow();
    expect(() => normalizeMatrixControllerArgs([
      "--decide",
      "--function-mints=1",
      "--with-matrix",
      `--adopt-matrix-environment=${digest("a")}`,
    ], "legacy-stampless")).toThrow("unavailable in legacy-stampless");
    expect(() => normalizeMatrixControllerArgs([
      "--decide",
      "--function-mints=1",
      "--with-matrix",
    ], "required-v1")).toThrow("requires current environment adoption");
  });

  test("canonical receipt binds candidate/publication and the separate matrix leg", () => {
    const artifact = stamplessDocument();
    const artifactIdentity = matrixArtifactIdentity(artifact);
    const packageDigest = computeMatrixPackageDigest({
      inputsDigest: digest("1"),
      environmentDigest: digest("2"),
      controllerDigest: digest("3"),
      sourceCommit,
      verified: "2026-08-11",
      verifiedAtSha: sourceCommit.slice(0, 7),
      initialArtifact: artifactIdentity,
    });
    const observation = parseMatrixDocument(artifact);
    const receipt = makeMatrixControllerReceipt({
      evidence: "complete",
      failureDigest: MATRIX_NO_FAILURE_DIGEST,
      mode: "legacy-stampless",
      operation: "decide",
      decision: "SKIPPED_LEGACY",
      result: "SKIPPED_LEGACY",
      stampClass: "absent",
      inputsDigest: digest("1"),
      environmentDigest: digest("2"),
      bodyDigest: observation.bodyDigest,
      certificateDigest: observation.certificateDigest,
      controllerDigest: digest("3"),
      packageDigest,
      capturedPresentation: {
        sourceCommit,
        verified: "2026-08-11",
        verifiedAtSha: sourceCommit.slice(0, 7),
      },
      publication: {
        published: false,
        before: artifactIdentity,
        candidate: { kind: "absent" },
        after: artifactIdentity,
      },
    });
    expect(parseMatrixControllerReceipt(encodeMatrixControllerReceipt(receipt))).toEqual(receipt);
    expect(() => makeMatrixControllerReceipt({
      ...receipt,
      operation: "probe",
      result: "CHECK_OK",
    })).toThrow("authorized state-table relation");
    expect(() => makeMatrixControllerReceipt({
      ...receipt,
      mode: "required-v1",
    })).toThrow("authorized state-table relation");
    expect(() => makeMatrixControllerReceipt({
      ...receipt,
      operation: "check",
      result: "CHECK_OK",
    })).toThrow("requires one rendered candidate");
    expect(() => makeMatrixControllerReceipt({
      ...receipt,
      publication: {
        published: false,
        before: { kind: "absent" },
        candidate: { kind: "absent" },
        after: { kind: "absent" },
      },
    })).toThrow("SKIPPED_LEGACY requires a present");
    expect(() => makeMatrixControllerReceipt({
      ...receipt,
      operation: "probe",
      decision: "FRESH",
      result: "FRESH",
      stampClass: "valid",
      publication: {
        published: false,
        before: { kind: "absent" },
        candidate: { kind: "absent" },
        after: { kind: "absent" },
      },
    })).toThrow("classified matrix stamp requires a present");
    expect(() => makeMatrixControllerReceipt({
      ...receipt,
      decision: "LEGACY_DUE",
      result: "LEGACY_REPAIRED",
    })).toThrow("authorized state-table relation");
    expect(() => makeMatrixControllerReceipt({
      ...receipt,
      publication: {
        published: true,
        before: artifactIdentity,
        candidate: artifactIdentity,
        after: artifactIdentity,
      },
    })).toThrow("authorized state-table relation");
    const leg = makeMatrixLeg({
      receipt,
      currentArtifact: artifactIdentity,
      currentBodyDigest: observation.bodyDigest,
      currentControllerDigest: digest("3"),
      currentPackageDigest: packageDigest,
      currentCertificateDigest: observation.certificateDigest,
    });
    expect(leg.matrixLegDigest).toHaveLength(64);
    expect(leg.artifact).toEqual(artifactIdentity);
    expect(() => makeMatrixLeg({
      receipt,
      currentArtifact: matrixArtifactIdentity(replaceMatrixPresentation(artifact, {
        verified: "2026-08-12",
        verifiedAtSha: sourceCommit.slice(0, 7),
      })),
      currentBodyDigest: observation.bodyDigest,
      currentControllerDigest: digest("3"),
      currentPackageDigest: packageDigest,
      currentCertificateDigest: observation.certificateDigest,
    })).toThrow("artifact identity");
    expect(() => makeMatrixLeg({
      receipt,
      currentArtifact: artifactIdentity,
      currentBodyDigest: digest("f"),
      currentControllerDigest: digest("3"),
      currentPackageDigest: packageDigest,
      currentCertificateDigest: observation.certificateDigest,
    })).toThrow("body identity");

    const unavailable = makeMatrixControllerReceipt({
      ...receipt,
      evidence: "unavailable",
      failureDigest: matrixFailureDigest("watcher unsupported"),
      result: "UNDECIDABLE",
      decision: "UNDECIDABLE",
      stampClass: "malformed",
      inputsDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
      environmentDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
      packageDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
      capturedPresentation: {
        sourceCommit: "0".repeat(40),
        verified: "1970-01-01",
        verifiedAtSha: "0".repeat(7),
      },
    });
    expect(() => makeMatrixControllerReceipt({
      ...unavailable,
      inputsDigest: digest("f"),
    })).toThrow("unavailable input, environment, and package identities");
    expect(() => makeMatrixControllerReceipt({
      ...unavailable,
      capturedPresentation: receipt.capturedPresentation,
    })).toThrow("unavailable presentation sentinel");
    expect(() => makeMatrixControllerReceipt({
      ...receipt,
      inputsDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
    })).toThrow("complete evidence cannot use unavailable");
    expect(makeMatrixLeg({
      receipt: unavailable,
      currentArtifact: artifactIdentity,
      currentBodyDigest: digest("9"),
      currentControllerDigest: digest("8"),
      currentPackageDigest: UNAVAILABLE_MATRIX_IDENTITY_DIGEST,
      currentCertificateDigest: digest("7"),
    }).matrixLegDigest).toHaveLength(64);
  });

  test("required-v1 admits only the two published REPAIRED relations and binds the final leg", () => {
    const beforeBytes = stamplessDocument();
    const inputCertificate = inputs();
    const environment = shapeEnvironment();
    const beforeObservation = parseMatrixDocument(beforeBytes);
    const candidateBytes = insertMatrixStamp(beforeBytes, matrixStampFor({
      inputs: inputCertificate,
      environment,
      bodyDigest: beforeObservation.bodyDigest,
    }));
    const candidateObservation = parseMatrixDocument(candidateBytes);
    const before = matrixArtifactIdentity(beforeBytes);
    const candidate = matrixArtifactIdentity(candidateBytes);
    const controllerDigest = digest("3");
    const repairedReceipt = (
      operation: "decide" | "repair",
      initialArtifact: MatrixArtifactIdentity = before,
    ) => makeMatrixControllerReceipt({
      evidence: "complete",
      failureDigest: MATRIX_NO_FAILURE_DIGEST,
      mode: "required-v1",
      operation,
      decision: "REPAIR_REQUIRED",
      result: "REPAIRED",
      stampClass: "valid",
      inputsDigest: inputCertificate.digest,
      environmentDigest: environment.digest,
      bodyDigest: candidateObservation.bodyDigest,
      certificateDigest: candidateObservation.certificateDigest,
      controllerDigest,
      packageDigest: computeMatrixPackageDigest({
        inputsDigest: inputCertificate.digest,
        environmentDigest: environment.digest,
        controllerDigest,
        sourceCommit,
        verified: "2026-08-11",
        verifiedAtSha: sourceCommit.slice(0, 7),
        initialArtifact,
      }),
      capturedPresentation: {
        sourceCommit,
        verified: "2026-08-11",
        verifiedAtSha: sourceCommit.slice(0, 7),
      },
      publication: {
        published: true,
        before: initialArtifact,
        candidate,
        after: candidate,
      },
    });

    for (const operation of ["decide", "repair"] as const) {
      for (const initialArtifact of [before, { kind: "absent" } as const]) {
        const receipt = repairedReceipt(operation, initialArtifact);
        expect(parseMatrixControllerReceipt(encodeMatrixControllerReceipt(receipt))).toEqual(receipt);
        expect(makeMatrixLeg({
          receipt,
          currentArtifact: candidate,
          currentBodyDigest: candidateObservation.bodyDigest,
          currentControllerDigest: controllerDigest,
          currentPackageDigest: receipt.packageDigest,
          currentCertificateDigest: candidateObservation.certificateDigest,
        }).artifact).toEqual(candidate);
      }
    }

    const admittedRelations: string[] = [];
    for (const mode of ["legacy-stampless", "required-v1"] as const) {
      for (const operation of ["check", "decide", "invalid", "probe", "repair"] as const) {
        for (const decision of [
          "CHECK_REQUIRED",
          "DUE",
          "DUE_UNTRUSTED",
          "FRESH",
          "LEGACY_DUE",
          "REPAIR_REQUIRED",
          "SKIPPED_EXPLICIT",
          "SKIPPED_LEGACY",
          "UNDECIDABLE",
          "VERIFIED_FOREIGN",
          "VERIFIED_FOREIGN_DUE",
        ] as const) {
          for (const stampClass of [
            "absent",
            "duplicate",
            "illegal-placement",
            "malformed",
            "valid",
          ] as const) {
            for (const published of [false, true] as const) {
              try {
                makeMatrixControllerReceipt({
                  ...repairedReceipt("decide"),
                  mode,
                  operation,
                  decision,
                  stampClass,
                  publication: published
                    ? { published, before, candidate, after: candidate }
                    : { published, before, candidate: { kind: "absent" }, after: before },
                });
                admittedRelations.push([
                  mode,
                  operation,
                  decision,
                  stampClass,
                  published ? "published" : "not-published",
                ].join("/"));
              } catch {
                // Every rejected Cartesian row is outside the closed success relation.
              }
            }
          }
        }
      }
    }
    expect(admittedRelations).toEqual([
      "required-v1/decide/REPAIR_REQUIRED/valid/published",
      "required-v1/repair/REPAIR_REQUIRED/valid/published",
    ]);

    const receipt = repairedReceipt("decide");
    for (const mutation of [
      { evidence: "unavailable" as const },
      { operation: "check" as const },
      { decision: "FRESH" as const },
      { mode: "legacy-stampless" as const },
      { stampClass: "absent" as const },
    ]) {
      expect(() => makeMatrixControllerReceipt({ ...receipt, ...mutation }))
        .toThrow();
    }
    expect(() => makeMatrixControllerReceipt({
      ...receipt,
      publication: {
        published: false,
        before,
        candidate,
        after: before,
      },
    })).toThrow("authorized state-table relation");
    expect(() => makeMatrixControllerReceipt({
      ...receipt,
      publication: {
        published: true,
        before,
        candidate: { kind: "absent" },
        after: candidate,
      },
    })).toThrow("published candidate must exactly equal after identity");
    expect(() => makeMatrixLeg({
      receipt,
      currentArtifact: candidate,
      currentBodyDigest: candidateObservation.bodyDigest,
      currentControllerDigest: controllerDigest,
      currentPackageDigest: receipt.packageDigest,
      currentCertificateDigest: digest("f"),
    })).toThrow("certificate identity");
  });

  test("candidate equality is exact bytes, not normalized-body equivalence", () => {
    const first = stamplessDocument();
    const second = replaceMatrixPresentation(first, { verified: "2026-08-12", verifiedAtSha: "2222222" });
    expect(parseMatrixDocument(first).bodyDigest).toBe(parseMatrixDocument(second).bodyDigest);
    expect(() => assertMatrixCandidateEqualsCommitted(first, second)).toThrow("differ");
  });
});
