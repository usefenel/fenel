/** Executable M3b source classification and non-code input-domain ledger. */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { posix, resolve } from "node:path";
import {
  RECOVERABLE_OUTPUT_EXCLUSIONS,
  REPOSITORY_EXACT_FILES,
  REPOSITORY_RECURSIVE_ROOTS,
  repositoryRelativePath,
  type CapturedByteStore,
} from "./artifact-bytes";
import { compareUtf8, encodeCanonicalJson } from "./artifact-wire-json";
import type { CompiledArtifactId, Sha256Hex } from "./compiled-artifact-attestation";

export type CompiledArtifactSourceClass = "owner-only" | "policy-only" | "shared";

const PARSER_OWNER_ONLY = Object.freeze([
  "implementations/typescript/engine/scripts/generate-compiled-parser.ts",
  "implementations/typescript/engine/scripts/generate-compiled-parser-worker.ts",
]);
const RESOLVER_OWNER_ONLY = Object.freeze([
  "implementations/typescript/engine/scripts/generate-compiled-resolver.ts",
  "implementations/typescript/engine/scripts/generate-compiled-resolver-worker.ts",
]);

/** Bytes reachable from both owner execution and policy verification. */
export const COMPILED_ARTIFACT_SHARED_SOURCES = Object.freeze([
  "implementations/typescript/engine/scripts/lib/artifact-bytes.ts",
  "implementations/typescript/engine/scripts/lib/artifact-wire-json.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-acquisition.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-attestation.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-build-certificate.schema.json",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-certificate.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-check-attestation.schema.json",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-check-package.schema.json",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-check-package.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-dependencies.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-environment.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-freshness.schema.json",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-git-package.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-owner.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-protocol.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-cold-projection-protocol.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-cold-policy-wire.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-identity-integrity.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-projection-anchor.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-identity-domain.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-input-key.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-producer-observation.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-origin-association.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-origin-protocol.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-consumer-plan.ts",
  "implementations/typescript/engine/scripts/lib/repository-identity-wire.ts",
  "implementations/typescript/engine/scripts/lib/repository-identity-physical.ts",
  "implementations/typescript/engine/scripts/owner-input-policy.fenel",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-preparation.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-preparation-protocol.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-snapshot.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-source-census.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-toolchain.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-worker-policy.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-worker-progress.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-worker-preload.ts",
]);

/** Orchestration that owners cannot import and that never enters a render epoch. */
export const COMPILED_ARTIFACT_POLICY_ONLY_SOURCES = Object.freeze([
  ".github/workflows/compiled-artifact-portability.yml",
  "implementations/typescript/engine/scripts/prepare-compiled-artifact-check-package.ts",
]);

export function ownerOnlySources(artifact: CompiledArtifactId): readonly string[] {
  return artifact === "compiled-parser" ? PARSER_OWNER_ONLY : RESOLVER_OWNER_ONLY;
}

export function ownerOverlaySources(artifact: CompiledArtifactId): readonly string[] {
  return Object.freeze([...ownerOnlySources(artifact), ...COMPILED_ARTIFACT_SHARED_SOURCES]);
}

export type SourceCensusRow = {
  readonly path: string;
  readonly classification: CompiledArtifactSourceClass;
  readonly owners: readonly CompiledArtifactId[];
};

type SourceClosureAuthority = CompiledArtifactId | "policy";

const SOURCE_MODULE_EXTENSIONS = Object.freeze([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
] as const);
const SOURCE_CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const repositoryExactPaths = new Set<string>(REPOSITORY_EXACT_FILES);
const recoverableOutputPaths = new Set<string>(RECOVERABLE_OUTPUT_EXCLUSIONS);

export function compiledArtifactSourceCensus(): readonly SourceCensusRow[] {
  const both = ["compiled-parser", "compiled-resolver"] as const;
  return Object.freeze([
    ...PARSER_OWNER_ONLY.map((path) => ({
      path,
      classification: "owner-only" as const,
      owners: ["compiled-parser"] as const,
    })),
    ...RESOLVER_OWNER_ONLY.map((path) => ({
      path,
      classification: "owner-only" as const,
      owners: ["compiled-resolver"] as const,
    })),
    ...COMPILED_ARTIFACT_SHARED_SOURCES.map((path) => ({
      path,
      classification: "shared" as const,
      owners: both,
    })),
    ...COMPILED_ARTIFACT_POLICY_ONLY_SOURCES.map((path) => ({
      path,
      classification: "policy-only" as const,
      owners: [] as const,
    })),
  ].sort((left, right) => compareUtf8(left.path, right.path)));
}

export type CompiledArtifactInputDomain =
  | "dependencyDigest"
  | "environmentFingerprint"
  | "ownerEpoch"
  | "repositoryEpoch";

/**
 * Complete non-code inputs. Fragment suffixes make intentional overlapping
 * roles explicit without pretending a parsed lock projection is its raw blob.
 */
export const COMPILED_ARTIFACT_INPUT_DOMAIN_LEDGER = Object.freeze([
  { input: ".github/fenel-artifact-toolchains.json", domain: "environmentFingerprint" },
  { input: "fixed-worker-environment-map", domain: "environmentFingerprint" },
  { input: "package.json#packageManager", domain: "environmentFingerprint" },
  { input: "staged-pinned-bun-executable-bytes", domain: "environmentFingerprint" },
  { input: "bun.lock#acquired-package-graph", domain: "dependencyDigest" },
  { input: "acquired-package-regular-bytes", domain: "dependencyDigest" },
  { input: "bun.lock#raw-covered-bytes", domain: "repositoryEpoch" },
  { input: "covered-source-bytes", domain: "repositoryEpoch" },
  { input: "owner-overlay-source-bytes", domain: "ownerEpoch" },
] as const satisfies readonly {
  readonly input: string;
  readonly domain: CompiledArtifactInputDomain;
}[]);

function discoverM3bExecutableSources(repositoryRoot: string): readonly string[] {
  const discovered: string[] = [];
  const libraryRelative = "implementations/typescript/engine/scripts/lib";
  const library = resolve(repositoryRoot, libraryRelative);
  try {
    for (const entry of readdirSync(library, { withFileTypes: true })) {
      if (entry.name.endsWith(".test.ts")) continue;
      if (
        entry.name === "artifact-bytes.ts"
        || entry.name === "artifact-wire-json.ts"
        || /^compiled-artifact-.*(?:\.ts|\.schema\.json)$/u.test(entry.name)
      ) {
        discovered.push(`${libraryRelative}/${entry.name}`);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze(discovered);
    throw error;
  }

  const scriptsRelative = "implementations/typescript/engine/scripts";
  for (const entry of readdirSync(resolve(repositoryRoot, scriptsRelative), { withFileTypes: true })) {
    if (
      /^(?:generate-compiled-(?:parser|resolver)(?:-worker)?|prepare-compiled-artifact-check-package)\.ts$/u
        .test(entry.name)
    ) {
      discovered.push(`${scriptsRelative}/${entry.name}`);
    }
  }
  discovered.push(".github/workflows/compiled-artifact-portability.yml");
  return Object.freeze(discovered.sort(compareUtf8));
}

function pathInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** Product source is already captured recursively in repositoryEpoch. Recovery
 * outputs are deliberately excluded and therefore are not an epoch boundary. */
function repositoryEpochCoversImportBase(path: string): boolean {
  if (
    recoverableOutputPaths.has(path)
    || [...recoverableOutputPaths].some((excluded) => excluded.startsWith(`${path}.`))
  ) {
    return false;
  }
  return repositoryExactPaths.has(path)
    || REPOSITORY_RECURSIVE_ROOTS.some((root) => pathInside(path, root));
}

function sourceScanLoader(path: string): "js" | "jsx" | "ts" | "tsx" {
  const extension = posix.extname(path).toLowerCase();
  if (extension === ".tsx") return "tsx";
  if (extension === ".jsx") return "jsx";
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") return "ts";
  return "js";
}

function literalRelativeImports(repositoryRoot: string, from: string): readonly string[] {
  const extension = posix.extname(from).toLowerCase();
  if (!SOURCE_CODE_EXTENSIONS.has(extension)) return Object.freeze([]);
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(
      readFileSync(resolve(repositoryRoot, ...from.split("/"))),
    );
  } catch (error) {
    throw new Error(`M3b executable source is not strict UTF-8: ${from}`, { cause: error });
  }
  let imports: ReturnType<Bun.Transpiler["scanImports"]>;
  try {
    imports = new Bun.Transpiler({ loader: sourceScanLoader(from) }).scanImports(source);
  } catch (error) {
    throw new Error(`M3b executable source cannot be scanned: ${from}`, { cause: error });
  }
  const relative = new Set<string>();
  for (const imported of imports) {
    if (imported.path.startsWith("node:") || imported.path.startsWith("bun:")) continue;
    if (!imported.path.startsWith(".")) {
      throw new Error(
        `M3b executable source imports an unclassified bare package: ${from} -> ${imported.path}`,
      );
    }
    if (imported.path.includes("?") || imported.path.includes("#") || imported.path.includes("\\")) {
      throw new Error(
        `M3b executable source has an unsupported relative import: ${from} -> ${imported.path}`,
      );
    }
    relative.add(imported.path);
  }
  return Object.freeze([...relative].sort(compareUtf8));
}

function resolveRelativeSourceImport(
  repositoryRoot: string,
  from: string,
  specifier: string,
): { readonly kind: "repository-epoch" } | { readonly kind: "source"; readonly path: string } {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  const canonicalBase = String(repositoryRelativePath(base));
  if (repositoryEpochCoversImportBase(canonicalBase)) return { kind: "repository-epoch" };

  const extension = posix.extname(canonicalBase).toLowerCase();
  const hasModuleExtension = SOURCE_MODULE_EXTENSIONS.includes(
    extension as (typeof SOURCE_MODULE_EXTENSIONS)[number],
  );
  const candidates = hasModuleExtension
    ? [canonicalBase]
    : [
      canonicalBase,
      ...SOURCE_MODULE_EXTENSIONS.map((candidate) => `${canonicalBase}${candidate}`),
      ...SOURCE_MODULE_EXTENSIONS.map((candidate) => `${canonicalBase}/index${candidate}`),
    ];
  const matches: string[] = [];
  for (const candidate of candidates) {
    const canonical = String(repositoryRelativePath(candidate));
    let stat;
    try {
      stat = lstatSync(resolve(repositoryRoot, ...canonical.split("/")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`M3b relative import resolves through a symbolic link: ${from} -> ${canonical}`);
    }
    if (stat.isFile()) {
      matches.push(canonical);
      continue;
    }
    if (stat.isDirectory() && canonical === canonicalBase && !hasModuleExtension) continue;
    throw new Error(`M3b relative import target is not one plain file: ${from} -> ${canonical}`);
  }
  if (matches.length === 0) {
    throw new Error(`M3b relative import is unresolved: ${from} -> ${specifier}`);
  }
  if (matches.length !== 1) {
    throw new Error(
      `M3b relative import is ambiguous: ${from} -> ${specifier} (${matches.sort(compareUtf8).join(", ")})`,
    );
  }
  return { kind: "source", path: matches[0]! };
}

function sourceAuthorities(row: SourceCensusRow): readonly SourceClosureAuthority[] {
  return Object.freeze([
    ...row.owners,
    ...(row.classification === "shared" || row.classification === "policy-only"
      ? ["policy" as const]
      : []),
  ]);
}

function classificationSupports(
  row: SourceCensusRow,
  authority: SourceClosureAuthority,
): boolean {
  return authority === "policy"
    ? row.classification === "policy-only" || row.classification === "shared"
    : row.owners.includes(authority);
}

/** Follow every statically knowable relative module edge from each classified
 * executable. A helper is usable only when its declared classification covers
 * the importing owner/policy authority; filename conventions are not trust. */
function validateCompiledArtifactSourceClosure(
  repositoryRoot: string,
  rows: readonly SourceCensusRow[],
): void {
  const classified = new Map(rows.map((row) => [row.path, row] as const));
  const importCache = new Map<string, readonly string[]>();
  const queue = rows.flatMap((row) => sourceAuthorities(row).map((authority) => ({
    path: row.path,
    authority,
  })));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const identity = `${current.authority}\0${current.path}`;
    if (visited.has(identity)) continue;
    visited.add(identity);
    let imports = importCache.get(current.path);
    if (imports === undefined) {
      imports = literalRelativeImports(repositoryRoot, current.path);
      importCache.set(current.path, imports);
    }
    for (const specifier of imports) {
      const target = resolveRelativeSourceImport(repositoryRoot, current.path, specifier);
      if (target.kind === "repository-epoch") {
        if (current.authority === "policy") {
          throw new Error(
            `M3b executable source is falsely disjoint: ${current.path} (policy) imports repository-only ${specifier}`,
          );
        }
        continue;
      }
      const targetRow = classified.get(target.path);
      if (targetRow === undefined) {
        throw new Error(
          `M3b executable source is unclassified: ${target.path} (imported by ${current.path})`,
        );
      }
      if (!classificationSupports(targetRow, current.authority)) {
        throw new Error(
          `M3b executable source is falsely disjoint: ${current.path} (${current.authority}) imports ${target.path}`,
        );
      }
      queue.push({ path: target.path, authority: current.authority });
    }
  }
}

export function validateCompiledArtifactInputDomainLedger(): void {
  const allowed = new Set<CompiledArtifactInputDomain>([
    "dependencyDigest",
    "environmentFingerprint",
    "ownerEpoch",
    "repositoryEpoch",
  ]);
  const seen = new Set<string>();
  for (const row of COMPILED_ARTIFACT_INPUT_DOMAIN_LEDGER) {
    if (row.input.length === 0 || !allowed.has(row.domain)) {
      throw new Error(`invalid M3b input-domain row ${JSON.stringify(row)}`);
    }
    const identity = `${row.input}\0${row.domain}`;
    if (seen.has(identity)) throw new Error(`duplicate M3b input-domain row ${row.input}`);
    seen.add(identity);
  }
  for (const required of [
    ".github/fenel-artifact-toolchains.json\0environmentFingerprint",
    "staged-pinned-bun-executable-bytes\0environmentFingerprint",
    "bun.lock#acquired-package-graph\0dependencyDigest",
    "acquired-package-regular-bytes\0dependencyDigest",
    "covered-source-bytes\0repositoryEpoch",
    "owner-overlay-source-bytes\0ownerEpoch",
  ]) {
    if (!seen.has(required)) throw new Error(`M3b input domain is unclassified: ${required}`);
  }
}

export function validateCompiledArtifactSourceCensus(repositoryRoot: string): void {
  const rows = compiledArtifactSourceCensus();
  const seen = new Set<string>();
  const folded = new Map<string, string>();
  for (const row of rows) {
    const canonical = String(repositoryRelativePath(row.path));
    if (canonical !== row.path || seen.has(row.path)) {
      throw new Error(`M3b source is noncanonical or classified twice: ${row.path}`);
    }
    const caseKey = row.path.toLowerCase();
    const prior = folded.get(caseKey);
    if (prior !== undefined) throw new Error(`M3b sources collide by case: ${prior} and ${row.path}`);
    seen.add(row.path);
    folded.set(caseKey, row.path);
    let stat;
    try {
      stat = lstatSync(resolve(repositoryRoot, row.path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`M3b classified source is absent: ${row.path}`);
      }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`M3b classified source is not one plain file: ${row.path}`);
    }
    if (row.classification === "policy-only" && row.owners.length !== 0) {
      throw new Error(`M3b policy-only source falsely has an owner: ${row.path}`);
    }
    if (row.classification === "owner-only" && row.owners.length !== 1) {
      throw new Error(`M3b owner-only source must name exactly one owner: ${row.path}`);
    }
    if (
      row.classification === "shared"
      && (row.owners.length !== 2
        || !row.owners.includes("compiled-parser")
        || !row.owners.includes("compiled-resolver"))
    ) {
      throw new Error(`M3b shared source must name both owners: ${row.path}`);
    }
  }
  for (const discovered of discoverM3bExecutableSources(repositoryRoot)) {
    if (!seen.has(discovered)) {
      throw new Error(`M3b executable source is unclassified: ${discovered}`);
    }
  }
  validateCompiledArtifactSourceClosure(repositoryRoot, rows);
  for (const shared of [
    "implementations/typescript/engine/scripts/lib/compiled-artifact-check-package.ts",
    "implementations/typescript/engine/scripts/lib/compiled-artifact-attestation.ts",
    "implementations/typescript/engine/scripts/lib/compiled-artifact-environment.ts",
  ]) {
    const row = rows.find((entry) => entry.path === shared);
    if (row?.classification !== "shared") throw new Error(`M3b verifier must be shared: ${shared}`);
  }
  validateCompiledArtifactInputDomainLedger();
}

export const ATTESTATION_POLICY_PATHS = Object.freeze([
  ...COMPILED_ARTIFACT_POLICY_ONLY_SOURCES,
  ...COMPILED_ARTIFACT_SHARED_SOURCES,
].sort(compareUtf8));

export type PolicyDigestResult =
  | { readonly ok: true; readonly digest: Sha256Hex }
  | {
    readonly ok: false;
    readonly error: "missing-input" | "unreadable-input" | "ambiguous-input" | "canonicalization-failed";
  };

type PolicyByteReader = (path: string) => Uint8Array | undefined;

function policyDigestFailure(error: unknown): PolicyDigestResult {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return { ok: false, error: "missing-input" };
  if (code === "EACCES" || code === "EPERM") return { ok: false, error: "unreadable-input" };
  if (error instanceof TypeError || code === "ELOOP") return { ok: false, error: "ambiguous-input" };
  return { ok: false, error: "canonicalization-failed" };
}

function computeAttestationPolicyDigestWithReader(read: PolicyByteReader): PolicyDigestResult {
  try {
    const exact = new Set<string>();
    const folded = new Set<string>();
    const rows = ATTESTATION_POLICY_PATHS.map((path) => {
      const canonical = String(repositoryRelativePath(path));
      const caseKey = canonical.toLowerCase();
      if (canonical !== path || exact.has(canonical) || folded.has(caseKey)) {
        throw new TypeError(`ambiguous attestation-policy path ${path}`);
      }
      exact.add(canonical);
      folded.add(caseKey);
      const bytes = read(path);
      if (bytes === undefined) return { missing: path } as const;
      return {
        path,
        byteLength: bytes.byteLength,
        digest: createHash("sha256").update(bytes).digest("hex"),
      } as const;
    });
    if (rows.some((row) => "missing" in row)) return { ok: false, error: "missing-input" };
    const digest = createHash("sha256")
      .update(encodeCanonicalJson({ schema: "fenel.compiled-artifact-policy.v1", rows }))
      .digest("hex") as Sha256Hex;
    return { ok: true, digest };
  } catch (error) {
    return policyDigestFailure(error);
  }
}

/** Hash policy bytes retained by the same stable capture as the owner epoch. */
export function computeAttestationPolicyDigestFromBytes(
  bytes: Pick<CapturedByteStore, "has" | "read">,
): PolicyDigestResult {
  return computeAttestationPolicyDigestWithReader((path) => {
    const canonical = repositoryRelativePath(path);
    return bytes.has(canonical) ? bytes.read(canonical) : undefined;
  });
}

/** Convenience live-tree wrapper; probe/repair should prefer captured bytes. */
export function computeAttestationPolicyDigest(repositoryRoot: string): PolicyDigestResult {
  return computeAttestationPolicyDigestWithReader((path) => {
    const absolute = resolve(repositoryRoot, path);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new TypeError(`attestation-policy input is not one plain file: ${path}`);
    }
    return new Uint8Array(readFileSync(absolute));
  });
}
