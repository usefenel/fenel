// S1b — the source epoch a replay artifact is bound to: a SHA-256 byte manifest
// over the compiled-owner byte universe (`REPOSITORY_BYTE_UNIVERSE` in
// artifact-bytes.ts: recursive roots, exact files, recoverable-output
// exclusions), read from that one definition, plus exact runtime/tool files. One synchronous implementation
// shared by the recorder (before importing any engine code, and again after
// writing), host startup (before engine load, rechecked at admission) and the
// browser build plugin (at build start and end). Node/bun only.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPOSITORY_BYTE_UNIVERSE, digestByteManifest } from "./artifact-bytes";

export const ENGINE_BODY_REPLAY_EPOCH_DOMAIN = "fenel.engine-body-replay.source.v2";

/** Exact replay inputs outside the owner universe (`engine/scripts/**`).
 * Runtime leaves and tools are both covered: changing either invalidates an
 * artifact recorded under the previous bytes. */
export const ENGINE_BODY_REPLAY_TOOL_FILES: readonly string[] = Object.freeze([
  // Build tools that record and bind replay artifacts.
  "implementations/typescript/engine/scripts/record-engine-body-replay.ts",
  "implementations/typescript/engine/scripts/lib/engine-body-replay-epoch.ts",
  "implementations/typescript/engine/scripts/lib/artifact-bytes.ts",
  // Runtime scripts leaves imported by the engine source input root.
  "implementations/typescript/engine/scripts/lib/artifact-wire-json.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-cold-policy-wire.ts",
  "implementations/typescript/engine/scripts/lib/compiled-artifact-identity-domain.ts",
  "implementations/typescript/engine/scripts/lib/repository-identity-physical.ts",
]);

export type EngineBodyReplaySourceEpoch = {
  /** The manifest digest. */
  readonly digest: string;
  /** The latest modification time (ms since epoch) among the hashed files. */
  readonly latestMtimeMs: number;
  readonly fileCount: number;
};

/** Hash the universe under `repositoryRoot`. Throws on any unreadable path or
 * a non-regular file (a symlink, a junction): no epoch is better than a
 * wrong one. */
export function computeEngineBodyReplaySourceEpoch(repositoryRoot: string): EngineBodyReplaySourceEpoch {
  const excluded = new Set<string>(REPOSITORY_BYTE_UNIVERSE.exclusions);
  const rows: { path: string; kind: "regular-file"; byteLength: number; sha256: string }[] = [];
  let latestMtimeMs = 0;
  const addFile = (relative: string): void => {
    if (excluded.has(relative)) return;
    const absolute = join(repositoryRoot, relative);
    const stats = statSync(absolute);
    if (!stats.isFile()) throw new Error(`engine-body-replay epoch: not a regular file: ${relative}`);
    const bytes = readFileSync(absolute);
    latestMtimeMs = Math.max(latestMtimeMs, stats.mtimeMs);
    rows.push({ path: relative, kind: "regular-file", byteLength: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
  };
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(repositoryRoot, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) addFile(child);
      else throw new Error(`engine-body-replay epoch: not a regular file: ${child}`);
    }
  };
  for (const root of REPOSITORY_BYTE_UNIVERSE.recursiveRoots) walk(root);
  for (const file of REPOSITORY_BYTE_UNIVERSE.exactFiles) addFile(file);
  for (const file of ENGINE_BODY_REPLAY_TOOL_FILES) addFile(file);
  const manifest = digestByteManifest(ENGINE_BODY_REPLAY_EPOCH_DOMAIN, rows as never);
  return { digest: manifest.digest, latestMtimeMs, fileCount: rows.length };
}
