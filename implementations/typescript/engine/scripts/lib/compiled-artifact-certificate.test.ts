import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareUtf8, encodeCanonicalJson } from "./artifact-wire-json";
import { makeRawCompiledArtifactInput } from "./compiled-artifact-input-key";
import {
  computeEnvironmentFingerprint,
  type ArtifactEnvironmentEvidence,
  type CompiledArtifactCheckAttestation,
  type EnvironmentVariableEvidence,
} from "./compiled-artifact-attestation";
import {
  RECOVERY_STUB_VERSION,
  assertExactLfArtifact,
  atomicReplaceExact,
  compiledArtifactRecoveryStubs,
  makeBaseBuildCertificate,
  mergeArtifactAttestations,
  publishArtifactAndBaseCertificate,
  readArtifactPair,
  replaceArtifactAttestations,
  sha256Bytes,
} from "./compiled-artifact-certificate";
import {
  COMPILED_ARTIFACT_SPECS,
  PORTABLE_GENERATION_ABI,
  computeCertificateBaseDigest,
  type BuildCertificateInputManifest,
  type CompiledArtifactBuildCertificate,
} from "./compiled-artifact-protocol";

const temporaryRoots: string[] = [];
const UTF8 = new TextEncoder();
const digest = (character: string): string => character.repeat(64);

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fenel-m3b-certificate-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "implementations/typescript/engine/src/generated"), { recursive: true });
  return root;
}

function temporaryRecoveryWorld(): { readonly root: string; readonly engineSource: string } {
  const root = mkdtempSync(join(tmpdir(), "fenel-m3b-recovery-world-"));
  temporaryRoots.push(root);
  const liveEngineSource = fileURLToPath(new URL("../../src/", import.meta.url));
  const engineSource = join(root, "implementations/typescript/engine/src");
  const excluded = new Set(compiledArtifactRecoveryStubs().map(({ path }) =>
    path.replace("implementations/typescript/engine/src/", "")));
  cpSync(liveEngineSource, engineSource, {
    recursive: true,
    filter: (source) => {
      const rel = relative(liveEngineSource, source).replaceAll("\\", "/");
      return rel === "" || !excluded.has(rel);
    },
  });
  cpSync(fileURLToPath(new URL("../", import.meta.url)),
    join(root, "implementations/typescript/engine/scripts"), { recursive: true });
  cpSync(join(process.cwd(), "fenel"), join(root, "fenel"), { recursive: true });
  for (const stub of compiledArtifactRecoveryStubs()) {
    const target = join(root, ...stub.path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, stub.bytes);
  }
  return { root, engineSource };
}

function manifest(): BuildCertificateInputManifest {
  return {
    coveredSourceArchiveDigest: digest("a"),
    repository: { digest: digest("1"), fileCount: 10, byteLength: 100 },
    ownerOverlay: { digest: digest("2"), fileCount: 4, byteLength: 40 },
    dependencies: { digest: digest("3"), fileCount: 0, byteLength: 0 },
  };
}

function certificateFor(bytes: Uint8Array): CompiledArtifactBuildCertificate {
  return makeBaseBuildCertificate({
    artifact: "compiled-parser",
    repositoryEpoch: digest("1"),
    ownerEpoch: digest("4"),
    dependencyDigest: digest("3"),
    artifactBytes: bytes,
    inputManifest: manifest(),
    producerInput: makeRawCompiledArtifactInput({
      artifact: "compiled-parser",
      acquisitionDigest: digest("c"),
      ownerOverlayDigest: manifest().ownerOverlay.digest,
      repositoryExactDigest: digest("d"),
      dependencyDigest: digest("3"),
      environmentFingerprint: computeEnvironmentFingerprint(environment()),
      recoveryStubVersion: RECOVERY_STUB_VERSION,
      portableGenerationAbi: PORTABLE_GENERATION_ABI,
    }),
    producerCheckPackageDigest: digest("b"),
  });
}

function pairPaths(root: string): { readonly artifact: string; readonly certificate: string } {
  const spec = COMPILED_ARTIFACT_SPECS["compiled-parser"];
  return {
    artifact: join(root, ...spec.artifactPath.split("/")),
    certificate: join(root, ...spec.certificatePath.split("/")),
  };
}

function installPair(root: string, bytes: Uint8Array): CompiledArtifactBuildCertificate {
  const certificate = certificateFor(bytes);
  const paths = pairPaths(root);
  writeFileSync(paths.artifact, bytes);
  writeFileSync(paths.certificate, encodeCanonicalJson(certificate));
  return certificate;
}

function environment(): ArtifactEnvironmentEvidence {
  const variables: EnvironmentVariableEvidence[] = [
    { name: "FENEL_DISPATCH_FENEL_PASSES", state: "absent" },
    { name: "FENEL_PARSE_CACHE", state: "present", value: "0" },
    { name: "FENEL_PARSER_INTERPRETED", state: "present", value: "1" },
    { name: "FENEL_PARSER_LEGACY", state: "present", value: "1" },
    { name: "FENEL_REGEX_SHIM_DEBUG", state: "absent" },
    { name: "FENEL_RESOLVER_INTERPRETED", state: "present", value: "1" },
    { name: "FENEL_SIMULATE_BROWSER", state: "absent" },
    { name: "LANG", state: "present", value: "C" },
    { name: "LC_ALL", state: "present", value: "C" },
    { name: "NODE_ENV", state: "present", value: "production" },
    { name: "TEMP", state: "present", value: "<snapshot>/.tmp" },
    { name: "TMP", state: "present", value: "<snapshot>/.tmp" },
    { name: "TMPDIR", state: "present", value: "<snapshot>/.tmp" },
    { name: "TZ", state: "present", value: "UTC" },
  ];
  variables.sort((left, right) => compareUtf8(left.name, right.name));
  return {
    osFamily: "windows",
    arch: "x64",
    bun: {
      release: "1.3.13",
      revision: "bf2e2cec",
      executableDigest: digest("5"),
      webkitVersion: "WebKit-1",
      javascriptCoreVersion: "JSC-1",
      icuVersion: "76.1",
      unicodeVersion: "16.0",
      toolchainManifestDigest: digest("6"),
      toolchainRowDigest: digest("7"),
    },
    variables,
  };
}

function localAttestation(
  certificate: CompiledArtifactBuildCertificate,
): CompiledArtifactCheckAttestation {
  const evidence = environment();
  return {
    schema: "fenel.compiled-artifact-check-attestation.v2",
    result: "MATCH",
    artifact: certificate.artifact,
    origin: { kind: "local" },
    checkPackageDigest: digest("b"),
    coveredSourceArchiveDigest: certificate.inputManifest.coveredSourceArchiveDigest,
    certificateBaseDigest: computeCertificateBaseDigest(certificate),
    repositoryEpoch: certificate.repositoryEpoch,
    ownerEpoch: certificate.ownerEpoch,
    dependencyDigest: certificate.dependencyDigest,
    environment: evidence,
    environmentFingerprint: computeEnvironmentFingerprint(evidence),
    artifactByteLength: certificate.artifactByteLength,
    artifactDigest: certificate.artifactDigest,
    attestationPolicyDigest: digest("c"),
  };
}

function exportedConstants(source: string): readonly string[] {
  return [...source.matchAll(/^export const ([A-Za-z0-9_]+)/gmu)]
    .map((match) => match[1]!)
    .sort(compareUtf8);
}

describe("compiled artifact recovery bytes", () => {
  test("pins six inert stubs and compatible generated namespace surfaces", async () => {
    const stubs = compiledArtifactRecoveryStubs();
    expect(stubs.map(({ path }) => path)).toEqual([
      "implementations/typescript/engine/src/generated/compiled-parser.build-certificate.json",
      "implementations/typescript/engine/src/generated/compiled-parser.generated.ts",
      "implementations/typescript/engine/src/generated/compiled-resolver.build-certificate.json",
      "implementations/typescript/engine/src/generated/compiled-resolver.generated.ts",
      "implementations/typescript/engine/src/generated/parse-cache.generated.ts",
      "implementations/typescript/engine/src/generated/signature-honesty-claims.json",
    ]);
    expect(new Set(stubs.map(({ path }) => path)).size).toBe(stubs.length);
    for (const stub of stubs) expect(stub.digest).toBe(sha256Bytes(stub.bytes));
    expect(RECOVERY_STUB_VERSION).toMatch(/^[0-9a-f]{64}$/);

    for (const name of ["compiled-parser.generated.ts", "compiled-resolver.generated.ts", "parse-cache.generated.ts"]) {
      const stub = stubs.find(({ path }) => path.endsWith(`/${name}`))!;
      const live = readFileSync(new URL(`../../src/generated/${name}`, import.meta.url), "utf8");
      const stubText = new TextDecoder().decode(stub.bytes);
      expect(new Set(exportedConstants(stubText))).toEqual(new Set(exportedConstants(live)));
    }

    const root = temporaryRoot();
    for (const stub of stubs.filter(({ path }) => path.endsWith(".ts"))) {
      const target = join(root, ...stub.path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, stub.bytes);
    }
    const abiTarget = join(root, "implementations/typescript/engine/src/parse-cache-abi.ts");
    writeFileSync(abiTarget, readFileSync(new URL("../../src/parse-cache-abi.ts", import.meta.url)));
    const generated = join(root, "implementations/typescript/engine/src/generated");
    const parser = await import(`${pathToFileURL(join(generated, "compiled-parser.generated.ts")).href}?stub=1`);
    const resolver = await import(`${pathToFileURL(join(generated, "compiled-resolver.generated.ts")).href}?stub=1`);
    const cache = await import(`${pathToFileURL(join(generated, "parse-cache.generated.ts")).href}?stub=1`);
    expect(Object.keys(parser).sort(compareUtf8)).toEqual([...exportedConstants(
      new TextDecoder().decode(stubs.find(({ path }) => path.endsWith("compiled-parser.generated.ts"))!.bytes),
    )]);
    expect(Object.keys(resolver).sort(compareUtf8)).toEqual([...exportedConstants(
      new TextDecoder().decode(stubs.find(({ path }) => path.endsWith("compiled-resolver.generated.ts"))!.bytes),
    )]);
    expect(parser.PARSER_CLOSURE_IDS).toEqual([]);
    expect(resolver.RESOLVER_FN_BODIES).toEqual({});
    expect(cache.PARSE_CACHE_COUNT).toBe(0);
    expect(cache.PARSE_CACHE_JSON).toBe("{}");
  });

  test("accepts only exact UTF-8 LF artifact bytes", () => {
    expect(() => assertExactLfArtifact(UTF8.encode("ok\n"))).not.toThrow();
    for (const bytes of [
      new Uint8Array(),
      UTF8.encode("missing LF"),
      UTF8.encode("CRLF\r\n"),
      Uint8Array.from([0xff, 0x0a]),
    ]) expect(() => assertExactLfArtifact(bytes)).toThrow();
  });

  test("imports the engine module registry with every excluded output replaced by inert bytes", () => {
    const recovery = temporaryRecoveryWorld();
    const temp = join(recovery.root, ".tmp");
    mkdirSync(temp);
    const entry = `${pathToFileURL(join(recovery.engineSource, "engine-modules.ts")).href}?recovery=1`;
    const result = Bun.spawnSync({
      cmd: [process.execPath, "--no-env-file", "--no-install", "-e", `await import(${JSON.stringify(entry)});`],
      cwd: recovery.root,
      env: {
        FENEL_PARSE_CACHE: "0",
        FENEL_PARSER_INTERPRETED: "1",
        FENEL_PARSER_LEGACY: "1",
        FENEL_RESOLVER_INTERPRETED: "1",
        LANG: "C",
        LC_ALL: "C",
        NODE_ENV: "production",
        TEMP: temp,
        TMP: temp,
        TMPDIR: temp,
        TZ: "UTC",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  }, 60_000);
});

describe("crash-consistent publication", () => {
  test("atomically replaces exact bytes and leaves no owned temp", () => {
    const root = temporaryRoot();
    const target = join(root, "implementations/typescript/engine/src/generated/exact.txt");
    writeFileSync(target, "old\n");
    atomicReplaceExact(target, UTF8.encode("new\n"));
    expect(readFileSync(target, "utf8")).toBe("new\n");
    expect(readdirSync(dirname(target)).filter((name) => name.includes(".m3b-") && name.endsWith(".tmp")))
      .toEqual([]);
  });

  test("publishes artifact before an empty base sidecar and proves three epochs", async () => {
    const root = temporaryRoot();
    installPair(root, UTF8.encode("old artifact\n"));
    const intended = UTF8.encode("new artifact\n");
    let epochs = 0;
    const observed = await publishArtifactAndBaseCertificate({
      repositoryRoot: root,
      artifact: "compiled-parser",
      artifactBytes: intended,
      certificate: certificateFor(intended),
      assertEpoch: () => { epochs += 1; },
    });
    expect(epochs).toBe(3);
    expect(observed.artifactBytes).toEqual(intended);
    expect(observed.certificate.producerAttestations).toEqual([]);
    expect(readArtifactPair(root, "compiled-parser").artifactDigest).toBe(sha256Bytes(intended));
  });

  test("retains a preflight-valid pair but invalidates every sidecar after publication begins", async () => {
    for (const failureAt of [1, 2, 3]) {
      const root = temporaryRoot();
      const oldBytes = UTF8.encode("old artifact\n");
      installPair(root, oldBytes);
      const intended = UTF8.encode(`new artifact ${failureAt}\n`);
      let epochs = 0;
      await expect(publishArtifactAndBaseCertificate({
        repositoryRoot: root,
        artifact: "compiled-parser",
        artifactBytes: intended,
        certificate: certificateFor(intended),
        assertEpoch: () => {
          epochs += 1;
          if (epochs === failureAt) throw new Error(`epoch ${failureAt}`);
        },
      })).rejects.toThrow(`epoch ${failureAt}`);
      const paths = pairPaths(root);
      if (failureAt === 1) {
        expect(readFileSync(paths.artifact)).toEqual(Buffer.from(oldBytes));
        expect(existsSync(paths.certificate)).toBe(true);
      } else {
        expect(readFileSync(paths.artifact)).toEqual(Buffer.from(intended));
        expect(existsSync(paths.certificate)).toBe(false);
      }
    }
  });

  test("rejects a wrong-kind base certificate before the publication interval", async () => {
    const root = temporaryRoot();
    const oldBytes = UTF8.encode("old artifact\n");
    installPair(root, oldBytes);
    const intended = UTF8.encode("new artifact\n");
    const wrongKind = makeBaseBuildCertificate({
      artifact: "compiled-resolver",
      repositoryEpoch: digest("1"),
      ownerEpoch: digest("4"),
      dependencyDigest: digest("3"),
      artifactBytes: intended,
      inputManifest: manifest(),
      producerInput: makeRawCompiledArtifactInput({
        artifact: "compiled-resolver",
        acquisitionDigest: digest("c"),
        ownerOverlayDigest: manifest().ownerOverlay.digest,
        repositoryExactDigest: digest("d"),
        dependencyDigest: digest("3"),
        environmentFingerprint: computeEnvironmentFingerprint(environment()),
        recoveryStubVersion: RECOVERY_STUB_VERSION,
        portableGenerationAbi: PORTABLE_GENERATION_ABI,
      }),
      producerCheckPackageDigest: digest("b"),
    });
    let epochs = 0;
    await expect(publishArtifactAndBaseCertificate({
      repositoryRoot: root,
      artifact: "compiled-parser",
      artifactBytes: intended,
      certificate: wrongKind,
      assertEpoch: () => { epochs += 1; },
    })).rejects.toThrow("does not match compiled-parser");
    expect(epochs).toBe(0);
    expect(readArtifactPair(root, "compiled-parser").artifactBytes).toEqual(oldBytes);
  });

  test("rejects a sidecar/artifact mismatch", () => {
    const oldSidecarRoot = temporaryRoot();
    installPair(oldSidecarRoot, UTF8.encode("old artifact\n"));
    writeFileSync(pairPaths(oldSidecarRoot).artifact, "new artifact\n");
    expect(() => readArtifactPair(oldSidecarRoot, "compiled-parser")).toThrow("does not bind");

    const newSidecarRoot = temporaryRoot();
    installPair(newSidecarRoot, UTF8.encode("old artifact\n"));
    writeFileSync(
      pairPaths(newSidecarRoot).certificate,
      encodeCanonicalJson(certificateFor(UTF8.encode("new artifact\n"))),
    );
    expect(() => readArtifactPair(newSidecarRoot, "compiled-parser")).toThrow("does not bind");
  });

  test("rejects sidecar A/artifact/sidecar B when the two sidecar reads disagree", () => {
    const root = temporaryRoot();
    installPair(root, UTF8.encode("artifact\n"));
    const certificatePath = pairPaths(root).certificate;
    const nativeReadFileSync = fs.readFileSync;
    let sidecarReads = 0;
    const readSpy = spyOn(fs, "readFileSync").mockImplementation(((path: string) => {
      const observed = nativeReadFileSync(path);
      if (resolve(path) === resolve(certificatePath) && ++sidecarReads === 2) {
        return Buffer.concat([observed, Buffer.from("race")]);
      }
      return observed;
    }) as typeof fs.readFileSync);
    try {
      expect(() => readArtifactPair(root, "compiled-parser")).toThrow(
        "sidecar changed during sidecar/artifact/sidecar read",
      );
      expect(sidecarReads).toBe(2);
    } finally {
      readSpy.mockRestore();
    }
  });

  test("rejects truncated artifacts and sidecars instead of accepting a partial pair", () => {
    for (const artifactBytes of [new Uint8Array(), UTF8.encode("missing final LF")]) {
      const root = temporaryRoot();
      installPair(root, UTF8.encode("artifact\n"));
      writeFileSync(pairPaths(root).artifact, artifactBytes);
      expect(() => readArtifactPair(root, "compiled-parser")).toThrow("must end in exactly one LF");
    }
    for (const sidecarBytes of [new Uint8Array(), UTF8.encode('{"schema":')]) {
      const root = temporaryRoot();
      installPair(root, UTF8.encode("artifact\n"));
      writeFileSync(pairPaths(root).certificate, sidecarBytes);
      expect(() => readArtifactPair(root, "compiled-parser")).toThrow();
    }
  });

  test("invalidates certification when the artifact mutates at every post-write reread window", async () => {
    for (const window of ["before-intended-reread", "after-intended-reread", "after-sidecar-write"] as const) {
      const root = temporaryRoot();
      installPair(root, UTF8.encode("old artifact\n"));
      const intended = UTF8.encode(`intended ${window}\n`);
      const paths = pairPaths(root);
      const nativeReadFileSync = fs.readFileSync;
      let artifactReads = 0;
      let epochs = 0;
      const readSpy = spyOn(fs, "readFileSync").mockImplementation(((path: string) => {
        if (resolve(path) === resolve(paths.artifact)) {
          artifactReads += 1;
          if (
            (window === "before-intended-reread" && artifactReads === 1)
            || (window === "after-sidecar-write" && artifactReads === 2)
          ) {
            writeFileSync(paths.artifact, UTF8.encode(`mutated ${window}`));
          }
        }
        return nativeReadFileSync(path);
      }) as typeof fs.readFileSync);
      try {
        await expect(publishArtifactAndBaseCertificate({
          repositoryRoot: root,
          artifact: "compiled-parser",
          artifactBytes: intended,
          certificate: certificateFor(intended),
          assertEpoch: () => {
            epochs += 1;
            if (window === "after-intended-reread" && epochs === 2) {
              writeFileSync(paths.artifact, UTF8.encode("mutated after intended reread"));
            }
          },
        })).rejects.toThrow();
      } finally {
        readSpy.mockRestore();
      }
      expect(existsSync(paths.certificate), window).toBe(false);
      expect(readFileSync(paths.artifact), window).not.toEqual(Buffer.from(intended));
    }
  });

  test("merges into an unchanged base and invalidates a post-write epoch failure", async () => {
    const root = temporaryRoot();
    const bytes = UTF8.encode("artifact\n");
    const base = installPair(root, bytes);
    let epochs = 0;
    const merged = await mergeArtifactAttestations({
      repositoryRoot: root,
      artifact: "compiled-parser",
      attestations: [localAttestation(base)],
      assertEpoch: () => { epochs += 1; },
    });
    expect(epochs).toBe(3);
    expect(merged.certificate.producerAttestations).toHaveLength(1);
    expect(computeCertificateBaseDigest(merged.certificate)).toBe(computeCertificateBaseDigest(base));

    installPair(root, bytes);
    epochs = 0;
    await expect(mergeArtifactAttestations({
      repositoryRoot: root,
      artifact: "compiled-parser",
      attestations: [localAttestation(base)],
      assertEpoch: () => {
        epochs += 1;
        if (epochs === 3) throw new Error("post-write epoch drift");
      },
    })).rejects.toThrow("post-write epoch drift");
    expect(existsSync(pairPaths(root).certificate)).toBe(false);
    expect(readFileSync(pairPaths(root).artifact)).toEqual(Buffer.from(bytes));
  });

  test("does not destroy an existing pair when a pre-write merge check fails", async () => {
    const root = temporaryRoot();
    const bytes = UTF8.encode("artifact\n");
    const base = installPair(root, bytes);
    let epochs = 0;
    await expect(mergeArtifactAttestations({
      repositoryRoot: root,
      artifact: "compiled-parser",
      attestations: [localAttestation(base)],
      assertEpoch: () => {
        epochs += 1;
        if (epochs === 2) throw new Error("pre-write epoch drift");
      },
    })).rejects.toThrow("pre-write epoch drift");
    expect(readArtifactPair(root, "compiled-parser").certificate.producerAttestations).toEqual([]);
  });

  test("seal publication replaces provisional attestations without changing the base", async () => {
    const root = temporaryRoot();
    const bytes = UTF8.encode("artifact\n");
    const base = installPair(root, bytes);
    await mergeArtifactAttestations({
      repositoryRoot: root,
      artifact: "compiled-parser",
      attestations: [localAttestation(base)],
      assertEpoch: () => {},
    });
    const replacement = {
      ...localAttestation(base),
      attestationPolicyDigest: digest("d"),
    };
    const sealed = await replaceArtifactAttestations({
      repositoryRoot: root,
      artifact: "compiled-parser",
      attestations: [replacement],
      assertEpoch: () => {},
    });
    expect(sealed.certificate.producerAttestations).toEqual([replacement]);
    expect(computeCertificateBaseDigest(sealed.certificate)).toBe(computeCertificateBaseDigest(base));
  });
});
