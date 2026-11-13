/** Pinned controller-side environment acquisition for M3b render workers. */

import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseCanonicalJson } from "./artifact-wire-json";
import {
  computeEnvironmentFingerprint,
  validateArtifactEnvironmentEvidence,
  type ArtifactEnvironmentEvidence,
  type Sha256Hex,
} from "./compiled-artifact-attestation";
import {
  bunToolchainRowDigest,
  decodeArtifactToolchainManifest,
  decodeStrictJson,
  osFamilyFromPlatform,
  selectBunToolchain,
  stagePinnedBun,
  type ArtifactToolchainManifest,
} from "./compiled-artifact-toolchain";
import {
  COMPILED_ARTIFACT_DECLARED_ABSENT_ENVIRONMENT_KEYS,
  COMPILED_ARTIFACT_FIXED_PRESENT_ENVIRONMENT_KEYS,
} from "./compiled-artifact-worker-policy";

export const NORMALIZED_SNAPSHOT_TEMP = "<snapshot>/.tmp" as const;
// LANG/LC_ALL/TZ are exact worker-visible map values. They are not claims that
// JavaScriptCore resolves an effective Intl locale from those strings; the
// acquired closure pins locale-sensitive sites and the preload denies Intl.
export const COMPILED_ARTIFACT_ENVIRONMENT_VARIABLES = Object.freeze([
  { name: "FENEL_DISPATCH_FENEL_PASSES", state: "absent" as const },
  { name: "FENEL_PARSER_INTERPRETED", state: "present" as const, value: "1" },
  { name: "FENEL_PARSER_LEGACY", state: "present" as const, value: "1" },
  { name: "FENEL_PARSE_CACHE", state: "present" as const, value: "0" },
  { name: "FENEL_REGEX_SHIM_DEBUG", state: "absent" as const },
  { name: "FENEL_RESOLVER_INTERPRETED", state: "present" as const, value: "1" },
  { name: "FENEL_SIMULATE_BROWSER", state: "absent" as const },
  { name: "LANG", state: "present" as const, value: "C" },
  { name: "LC_ALL", state: "present" as const, value: "C" },
  { name: "NODE_ENV", state: "present" as const, value: "production" },
  { name: "TEMP", state: "present" as const, value: NORMALIZED_SNAPSHOT_TEMP },
  { name: "TMP", state: "present" as const, value: NORMALIZED_SNAPSHOT_TEMP },
  { name: "TMPDIR", state: "present" as const, value: NORMALIZED_SNAPSHOT_TEMP },
  { name: "TZ", state: "present" as const, value: "UTC" },
]);
for (const [state, expected] of [
  ["present", COMPILED_ARTIFACT_FIXED_PRESENT_ENVIRONMENT_KEYS],
  ["absent", COMPILED_ARTIFACT_DECLARED_ABSENT_ENVIRONMENT_KEYS],
] as const) {
  const actual = COMPILED_ARTIFACT_ENVIRONMENT_VARIABLES
    .filter((row) => row.state === state)
    .map((row) => row.name);
  if (
    actual.length !== expected.length
    || actual.some((name, index) => name !== expected[index])
  ) {
    throw new Error(`compiled-artifact ${state} environment rows differ from worker policy`);
  }
}
export const COMPILED_ARTIFACT_ENVIRONMENT_KEYS = Object.freeze(
  COMPILED_ARTIFACT_ENVIRONMENT_VARIABLES.map((row) => row.name),
);
const TOOLCHAIN_CACHE_ROOT = ".tmp-m3b-toolchains" as const;
export interface PinnedBunRuntimeVersions {
  readonly release: string;
  readonly revision: string;
  readonly webkitVersion: string;
  readonly javascriptCoreVersion: string;
  readonly icuVersion: string;
  readonly unicodeVersion: string;
}

export interface AcquiredCompiledArtifactEnvironment {
  readonly manifest: ArtifactToolchainManifest;
  readonly bunExecutable: string;
  readonly environment: ArtifactEnvironmentEvidence;
  readonly environmentFingerprint: Sha256Hex;
}

export interface EnvironmentAcquisitionDependencies {
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly bunArchiveBytes?: Uint8Array;
  readonly allowNetwork?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly inspectPinnedBun?: (executable: string) => Promise<PinnedBunRuntimeVersions>;
  readonly nonce?: () => string;
}

function assertInside(parent: string, target: string, allowEqual = false): string {
  const base = resolve(parent);
  const absolute = resolve(target);
  const rel = relative(base, absolute);
  if (rel === "" || rel === ".") {
    if (allowEqual) return absolute;
    throw new Error("toolchain target must be below the cache root");
  }
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("toolchain target escapes the cache root");
  }
  return absolute;
}

function assertPlainDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`toolchain cache path is not a plain directory: ${path}`);
  }
}

function requiredVariables(): ArtifactEnvironmentEvidence["variables"] {
  return COMPILED_ARTIFACT_ENVIRONMENT_VARIABLES;
}

async function inspectPinnedBun(executable: string): Promise<PinnedBunRuntimeVersions> {
  const source = `process.stdout.write(JSON.stringify({
    icuVersion: process.versions.icu,
    javascriptCoreVersion: process.versions.webkit,
    release: Bun.version,
    revision: Bun.revision,
    unicodeVersion: process.versions.unicode,
    webkitVersion: process.versions.webkit,
  }) + "\\n");`;
  const child = Bun.spawn([
    executable,
    "--no-env-file",
    "--no-install",
    "-e",
    source,
  ], { env: {}, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).bytes(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`pinned Bun introspection exited ${exitCode}: ${stderr}`);
  const raw = parseCanonicalJson(stdout) as Record<string, unknown>;
  const keys = [
    "icuVersion",
    "javascriptCoreVersion",
    "release",
    "revision",
    "unicodeVersion",
    "webkitVersion",
  ];
  if (Object.keys(raw).sort().join("\0") !== keys.join("\0")) {
    throw new Error("pinned Bun introspection returned the wrong shape");
  }
  for (const key of keys) {
    if (typeof raw[key] !== "string" || raw[key] === "") {
      throw new Error(`pinned Bun introspection lacks ${key}`);
    }
  }
  return raw as unknown as PinnedBunRuntimeVersions;
}

function rootPackageManager(bytes: Uint8Array): string {
  const raw = decodeStrictJson(bytes, "root package.json");
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("root package.json is not an object");
  }
  const value = (raw as Record<string, unknown>).packageManager;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("root package.json lacks packageManager");
  }
  return value;
}

export async function acquireCompiledArtifactEnvironment(
  input: {
    readonly repositoryRoot: string;
    readonly toolchainManifestBytes: Uint8Array;
    readonly rootPackageJsonBytes: Uint8Array;
  },
  dependencies: EnvironmentAcquisitionDependencies = {},
): Promise<AcquiredCompiledArtifactEnvironment> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const cacheRoot = resolve(repositoryRoot, TOOLCHAIN_CACHE_ROOT);
  mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  assertInside(repositoryRoot, cacheRoot);
  assertPlainDirectory(cacheRoot);

  const manifest = decodeArtifactToolchainManifest(input.toolchainManifestBytes);
  const osFamily = osFamilyFromPlatform(dependencies.platform ?? process.platform);
  if (osFamily === null) throw new Error(`unsupported compiled-artifact platform ${process.platform}`);
  const arch = dependencies.arch ?? process.arch;
  const row = selectBunToolchain(manifest, { osFamily, arch });
  const nonce = dependencies.nonce?.() ?? randomBytes(16).toString("hex");
  if (!/^[0-9a-f]{16,128}$/u.test(nonce)) throw new Error("invalid environment acquisition nonce");

  const staged = await stagePinnedBun({
    row,
    cacheRoot,
    ...(dependencies.bunArchiveBytes === undefined ? {} : { archiveBytes: dependencies.bunArchiveBytes }),
    allowNetwork: dependencies.allowNetwork ?? false,
    ...(dependencies.fetchImpl === undefined ? {} : { fetchImpl: dependencies.fetchImpl }),
    nonce,
  });
  const packageManagerPin = rootPackageManager(input.rootPackageJsonBytes);
  if (packageManagerPin !== `bun@${row.bunRelease}`) {
    throw new Error("root packageManager does not equal the pinned Bun manifest row");
  }
  const versions = await (dependencies.inspectPinnedBun ?? inspectPinnedBun)(staged.executablePath);
  if (versions.release !== row.bunRelease || versions.revision !== row.bunRevision) {
    throw new Error("pinned Bun runtime version does not match the selected manifest row");
  }
  const environment = validateArtifactEnvironmentEvidence({
    osFamily,
    arch,
    bun: {
      release: row.bunRelease,
      revision: row.bunRevision,
      executableDigest: row.binarySha256,
      webkitVersion: versions.webkitVersion,
      javascriptCoreVersion: versions.javascriptCoreVersion,
      icuVersion: versions.icuVersion,
      unicodeVersion: versions.unicodeVersion,
      toolchainManifestDigest: manifest.manifestDigest,
      toolchainRowDigest: bunToolchainRowDigest(row),
    },
    variables: requiredVariables(),
  });
  return Object.freeze({
    manifest,
    bunExecutable: staged.executablePath,
    environment,
    environmentFingerprint: computeEnvironmentFingerprint(environment),
  });
}
