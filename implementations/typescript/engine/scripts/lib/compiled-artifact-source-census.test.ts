import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { repositoryRelativePath, type CapturedByteStore } from "./artifact-bytes";
import { censusSourceAcquisitions } from "./compiled-artifact-acquisition";
import {
  ATTESTATION_POLICY_PATHS,
  COMPILED_ARTIFACT_INPUT_DOMAIN_LEDGER,
  compiledArtifactSourceCensus,
  computeAttestationPolicyDigest,
  computeAttestationPolicyDigestFromBytes,
  ownerOnlySources,
  ownerOverlaySources,
  validateCompiledArtifactInputDomainLedger,
  validateCompiledArtifactSourceCensus,
} from "./compiled-artifact-source-census";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, text: string): void {
  const target = join(root, ...path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

function sourceFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "fenel-m3b-source-census-"));
  temporaryRoots.push(root);
  for (const row of compiledArtifactSourceCensus()) write(root, row.path, `${row.path}\n`);
  return root;
}

function capturedPolicyBytes(values: ReadonlyMap<string, Uint8Array>): Pick<CapturedByteStore, "has" | "read"> {
  return {
    has: (path) => values.has(String(path)),
    read: (path) => {
      const bytes = values.get(String(path));
      if (bytes === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return new Uint8Array(bytes);
    },
  };
}

describe("M3b executable source census", () => {
  test("classifies the two owners, policy wrappers, schemas, and shared worker policy", () => {
    const rows = compiledArtifactSourceCensus();
    expect(rows).toEqual([...rows].sort((left, right) => Buffer.compare(
      Buffer.from(left.path),
      Buffer.from(right.path),
    )));
    expect(rows.find(({ path }) => path.endsWith("compiled-artifact-environment.ts"))).toEqual({
      path: "implementations/typescript/engine/scripts/lib/compiled-artifact-environment.ts",
      classification: "shared",
      owners: ["compiled-parser", "compiled-resolver"],
    });
    expect(rows.find(({ path }) => path.endsWith("compiled-artifact-build-certificate.schema.json"))
      ?.classification).toBe("shared");
    expect(rows.find(({ path }) => path.endsWith("prepare-compiled-artifact-check-package.ts")))
      .toEqual({
        path: "implementations/typescript/engine/scripts/prepare-compiled-artifact-check-package.ts",
        classification: "policy-only",
        owners: [],
      });
    expect(rows.find(({ path }) => path === ".github/workflows/compiled-artifact-portability.yml")
      ?.classification).toBe("policy-only");
    expect(ownerOnlySources("compiled-parser")).not.toContain(
      "implementations/typescript/engine/scripts/generate-compiled-resolver.ts",
    );
    expect(ownerOverlaySources("compiled-parser")).toContain(
      "implementations/typescript/engine/scripts/lib/compiled-artifact-worker-preload.ts",
    );
    expect(ownerOverlaySources("compiled-resolver")).toContain(
      "implementations/typescript/engine/scripts/lib/compiled-artifact-worker-policy.ts",
    );
    expect(ownerOverlaySources("compiled-parser")).not.toContain(
      ".github/workflows/compiled-artifact-portability.yml",
    );
    const workerPolicyPath =
      "implementations/typescript/engine/scripts/lib/compiled-artifact-worker-policy.ts";
    const workerPolicySource = readFileSync(new URL("./compiled-artifact-worker-policy.ts", import.meta.url), "utf8");
    expect(censusSourceAcquisitions(repositoryRelativePath(workerPolicyPath), workerPolicySource).acquisitions)
      .toEqual([]);
  });

  test("validates a complete fixture and fails closed on an unclassified executable", () => {
    const root = sourceFixture();
    expect(() => validateCompiledArtifactSourceCensus(root)).not.toThrow();
    write(
      root,
      "implementations/typescript/engine/scripts/lib/compiled-artifact-unclassified.ts",
      "export const rogue = true;\n",
    );
    expect(() => validateCompiledArtifactSourceCensus(root)).toThrow(
      "M3b executable source is unclassified",
    );

    const directoryRoot = sourceFixture();
    mkdirSync(join(
      directoryRoot,
      "implementations/typescript/engine/scripts/lib/compiled-artifact-directory.ts",
    ));
    expect(() => validateCompiledArtifactSourceCensus(directoryRoot)).toThrow(
      "M3b executable source is unclassified",
    );
  });

  test("follows relative imports regardless of helper basename", () => {
    const root = sourceFixture();
    write(
      root,
      "implementations/typescript/engine/scripts/lib/compiled-artifact-owner.ts",
      'import { value } from "./quiet-leaf";\nexport { value };\n',
    );
    write(
      root,
      "implementations/typescript/engine/scripts/lib/quiet-leaf.ts",
      "export const value = 1;\n",
    );
    expect(() => validateCompiledArtifactSourceCensus(root)).toThrow(
      "M3b executable source is unclassified: implementations/typescript/engine/scripts/lib/quiet-leaf.ts",
    );
  });

  test("rejects an owner or policy import through an ambient bare package", () => {
    const root = sourceFixture();
    write(
      root,
      "implementations/typescript/engine/scripts/lib/compiled-artifact-owner.ts",
      'import "ambient-package";\n',
    );
    expect(() => validateCompiledArtifactSourceCensus(root)).toThrow(
      "M3b executable source imports an unclassified bare package",
    );
  });

  test("rejects a classified source reached through a falsely disjoint policy edge", () => {
    const root = sourceFixture();
    write(
      root,
      "implementations/typescript/engine/scripts/prepare-compiled-artifact-check-package.ts",
      'import "./generate-compiled-parser-worker";\n',
    );
    expect(() => validateCompiledArtifactSourceCensus(root)).toThrow(
      "M3b executable source is falsely disjoint",
    );
  });

  test("fails when a classified executable is absent or replaced by a directory", () => {
    const absentRoot = sourceFixture();
    rmSync(join(absentRoot, "implementations/typescript/engine/scripts/lib/compiled-artifact-environment.ts"));
    expect(() => validateCompiledArtifactSourceCensus(absentRoot)).toThrow("classified source is absent");

    const directoryRoot = sourceFixture();
    const path = join(directoryRoot, "implementations/typescript/engine/scripts/lib/compiled-artifact-environment.ts");
    rmSync(path);
    mkdirSync(path);
    expect(() => validateCompiledArtifactSourceCensus(directoryRoot)).toThrow("not one plain file");
  });
});

describe("M3b input-domain and policy identities", () => {
  test("pins every required non-code identity domain", () => {
    expect(() => validateCompiledArtifactInputDomainLedger()).not.toThrow();
    expect(COMPILED_ARTIFACT_INPUT_DOMAIN_LEDGER).toContainEqual({
      input: ".github/fenel-artifact-toolchains.json",
      domain: "environmentFingerprint",
    });
    expect(COMPILED_ARTIFACT_INPUT_DOMAIN_LEDGER).toContainEqual({
      input: "staged-pinned-bun-executable-bytes",
      domain: "environmentFingerprint",
    });
    expect(COMPILED_ARTIFACT_INPUT_DOMAIN_LEDGER).toContainEqual({
      input: "bun.lock#acquired-package-graph",
      domain: "dependencyDigest",
    });
    expect(COMPILED_ARTIFACT_INPUT_DOMAIN_LEDGER).toContainEqual({
      input: "acquired-package-regular-bytes",
      domain: "dependencyDigest",
    });
    expect(COMPILED_ARTIFACT_INPUT_DOMAIN_LEDGER).toContainEqual({
      input: "owner-overlay-source-bytes",
      domain: "ownerEpoch",
    });
  });

  test("hashes captured raw policy bytes identically to the live convenience wrapper", () => {
    const root = sourceFixture();
    const values = new Map<string, Uint8Array>();
    for (const path of ATTESTATION_POLICY_PATHS) {
      const bytes = new TextEncoder().encode(`policy:${path}\n`);
      values.set(path, bytes);
      write(root, path, new TextDecoder().decode(bytes));
    }
    const captured = capturedPolicyBytes(values);
    const first = computeAttestationPolicyDigestFromBytes(captured);
    expect(first.ok).toBe(true);
    expect(computeAttestationPolicyDigest(root)).toEqual(first);

    write(root, ATTESTATION_POLICY_PATHS[0]!, "live mutation\n");
    expect(computeAttestationPolicyDigest(root)).not.toEqual(first);
    expect(computeAttestationPolicyDigestFromBytes(captured)).toEqual(first);
  });

  test("distinguishes missing, unreadable, ambiguous, and generic reader failure", () => {
    const values = new Map<string, Uint8Array>(ATTESTATION_POLICY_PATHS.map((path) => [
      path,
      new TextEncoder().encode(`${path}\n`),
    ]));
    values.delete(ATTESTATION_POLICY_PATHS[0]!);
    expect(computeAttestationPolicyDigestFromBytes(capturedPolicyBytes(values))).toEqual({
      ok: false,
      error: "missing-input",
    });

    const throwing = (error: Error): Pick<CapturedByteStore, "has" | "read"> => ({
      has: () => true,
      read: () => { throw error; },
    });
    expect(computeAttestationPolicyDigestFromBytes(throwing(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    ))).toEqual({ ok: false, error: "unreadable-input" });
    expect(computeAttestationPolicyDigestFromBytes(throwing(new TypeError("ambiguous"))))
      .toEqual({ ok: false, error: "ambiguous-input" });
    expect(computeAttestationPolicyDigestFromBytes(throwing(new Error("boom"))))
      .toEqual({ ok: false, error: "canonicalization-failed" });
  });
});
