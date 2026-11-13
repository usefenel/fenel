// ---------------------------------------------------------------------------
// codename-lock.ts — the codeName ↔ UUID lockfile (typed-function-references
// Phase 6).
//
// Identity is an opaque UUID (fresh mints are v4); the code-name (today the slug `module:name`)
// is a `Codeable` projection over it. The link is persisted as a machine-owned
// lockfile next to the source — NEVER inside the `.fenel`/`.ts` definition. A
// `.fenel` file authors clean code-names; this sidecar pins the resolved UUIDs
// the registry keys identity by, the same way a package lockfile pins versions
// a manifest only names. Canonical design: `design/codename-uuid-lockfile.md`
// (five locked decisions, 2026-06-03).
//
// NODE-ONLY. This module touches `node:fs` / `node:crypto` and MUST NOT be
// imported from `registry.ts` (which is bundled into the SolidJS frontend —
// see FunctionCallEditor / FieldRenderer / StepEditor). The registry instead
// takes the loaded `LockMap` via `CreateRegistryOptions.codeNameLock`; the
// Node callers (system-registry, the seed script, the audit) read the lock
// here and pass it in. Frontend `createRegistry` calls get no lock and emit
// slug-refs, which bridge to the same UUID identity via the registry's
// slug/codeName resolution chain (`getFunction`).
//
// Line format: `<fully-qualified codeName> ; <uuid>`, one per line; `#`
// comments + blank lines ignored. Repo-level `.fenel.lock` + per-file
// `<name>.fenel.lock` are UNIONED; a code-name must be unique across the union
// (collision = hard error). D3/D5.
// ---------------------------------------------------------------------------

// BROWSER-SAFETY (2026-07-05): the `node:fs`/`node:path`/`node:url`/`node:crypto`
// access is LAZY — `require`d inside the functions that use it, and the repo-path
// constants are computed by lazy memoized getters — NOT static top-level imports
// + top-level `const … = join(…)` computations. This module is reachable from the
// BROWSER graph (audit.tsx → system-registry → loadLock), and vite externalizes
// the node builtins to a stub that THROWS on property access at module-EVAL time
// (both the import binding AND a top-level `join(dirname(fileURLToPath(…)))` call).
// A static form therefore made merely importing @fenel/engine fatal in the browser,
// blanking every /app page. The frontend never CALLS these fns (it builds lock-less
// registries — see the header), so the lazy require/getter never executes there.
// Same pattern as `crypto/ffi/crypto-ffi.ts` + `engine-bodies-dispatch.ts`.

// browser-engine-compat Phase 1b: the single "no host `require`" predicate (also
// honors FENEL_SIMULATE_BROWSER). `engine-require` is a dependency-free leaf, so
// this static import adds no runtime edge / cycle.
import { hostRequireUnavailable } from "./engine-require";
import { isUuidSyntax, parseLockText, mergePhysicalLockRows, type LockMap } from "../scripts/lib/repository-identity-physical";
export { parseLockText, mergePhysicalLockRows } from "../scripts/lib/repository-identity-physical";
export type { LockMap } from "../scripts/lib/repository-identity-physical";

// C2 filesystem-tooling syntax check. Field adoption/reuse/conflict semantics
// live in the Fenel identity kernel; the lock reader only rejects malformed
// physical UUID rows before indexing or writing them.

/** Lazy host-node accessors — `require`d only when a lock op actually runs
 *  (server-side); never touched during a browser module-eval. */
function nodeFs(): typeof import("node:fs") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require("node:fs") as typeof import("node:fs");
}

/** Repo root = four up from `implementations/typescript/engine/src`. Uses the
 *  standard `fileURLToPath(import.meta.url)` anchor (not Bun's `import.meta.dir`)
 *  so this module typechecks in the SolidStart program too — it is reachable
 *  there via `audit.tsx → system-registry`. The `node:fs`/`node:crypto` work is
 *  server-only (vinxi externalizes the node builtins); the frontend never
 *  executes it (it builds lock-less registries). Lazy + memoized so the node:path/
 *  node:url calls never fire at a browser module-eval. */
let repoRootCached: string | null = null;
function repoRoot(): string {
  if (repoRootCached !== null) return repoRootCached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dirname, join } = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { fileURLToPath } = require("node:url") as typeof import("node:url");
  repoRootCached = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  return repoRootCached;
}
/** The repo-level lock (the no-basename dotfile) — covers every source file
 *  that does not carry its own `<name>.fenel.lock`. Also the MINT TARGET: new
 *  code-names are appended here. */
function repoLockPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { join } = require("node:path") as typeof import("node:path");
  return join(repoRoot(), ".fenel.lock");
}
/** Where `.fenel` source (and thus any per-file lock) lives. Scanned for
 *  `*.fenel.lock` so per-file locks union in (D3). */
function fenelDir(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { join } = require("node:path") as typeof import("node:path");
  return join(repoRoot(), "fenel");
}

/** fully-qualified codeName (the slug today) → opaque UUID. */

function readLockFile(path: string): Array<[string, string]> {
  try {
    return parseLockText(nodeFs().readFileSync(path, "utf8"), path);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
}

/** Recursively collect every `*.fenel.lock` under `dir` (per-file locks sit
 *  next to their `.fenel` source). `node_modules` / `.git` pruned. */
function scanForLockFiles(dir: string): string[] {
  const { readdirSync, statSync } = nodeFs();
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { join } = require("node:path") as typeof import("node:path");
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (e === "node_modules" || e === ".git") continue;
      out.push(...scanForLockFiles(full));
    } else if (e.endsWith(".fenel.lock")) {
      out.push(full);
    }
  }
  return out;
}

/** Every lockfile that participates in the union: the repo-level lock first,
 *  then any per-file `*.fenel.lock` under `fenel/`. */
export function lockFilePaths(): string[] {
  const { existsSync } = nodeFs();
  const repoLock = repoLockPath();
  const paths: string[] = [];
  if (existsSync(repoLock)) paths.push(repoLock);
  paths.push(...scanForLockFiles(fenelDir()).sort());
  return paths;
}

let cached: LockMap | null = null;

/** Load + UNION every lockfile into one `codeName → uuid` map. A code-name
 *  owned by two different lockfiles is a hard error (D3: exactly one owner).
 *  Cached per-process; `resetLockCache()` clears it (used after a write). */
/** C2 captured-row entry; identical UUID/physical-owner validation and order. */

export function loadLock(): LockMap {
  if (cached) return cached;
  // browser-engine-compat Phase 1b: the lock reader touches `node:fs` via the
  // host `require`, which is undefined in the browser. Per this module's
  // contract, return an empty map there instead of throwing `require is not
  // defined`. Product browser registries no longer call this leaf: they import
  // the generated inert manifest through repository-registry.ts.
  if (hostRequireUnavailable()) {
    cached = new Map();
    return cached;
  }
  const inputs = (function* () {
    for (const path of lockFilePaths()) yield { path, rows: readLockFile(path) };
  })();
  cached = mergePhysicalLockRows(inputs);
  return cached;
}

/** Drop the process cache (after a write, or in a test that re-seeds). */
export function resetLockCache(): void {
  cached = null;
}

export type LockSyncResult = {
  /** code-names present in the registry but absent from every lockfile. */
  missing: string[];
  /** total code-names checked. */
  total: number;
  /** whether the repo-level lock was rewritten (write mode + missing > 0). */
  wrote: boolean;
  /** Missing names whose caller-supplied UUID was adopted exactly rather than
   * freshly minted (field-identity Phase 1, UUID-as-name compatibility). */
  adopted: number;
};

function renderLockText(map: ReadonlyMap<string, string>): string {
  const lines = [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([n, u]) => `${n} ; ${u}`);
  const header =
    "# .fenel.lock — machine-owned codeName↔UUID map (typed-function-references Phase 6; field-identity Phase 2a).\n" +
    "# Format: <fully-qualified codeName> ; <uuid>. Regenerable; do NOT hand-edit\n" +
    "# except to pin a rename. Regenerate: bun implementations/typescript/engine/scripts/generate-codename-lock.ts\n" +
    "# Identity is the UUID; the code-name is a Codeable projection. See design/codename-uuid-lockfile.md.\n\n";
  return header + lines.join("\n") + "\n";
}

function writeRepoLock(map: Map<string, string>): void {
  nodeFs().writeFileSync(repoLockPath(), renderLockText(map), "utf8");
}

/** One in-place rename of a lock row: the row keyed `from` is re-keyed `to`
 * and keeps exactly the UUID `id`. */
export type LockRename = {
  readonly from: string;
  readonly to: string;
  readonly id: string;
};

/**
 * Rename rows of one lock file in place, each keeping its UUID — the lock
 * header's pin-a-rename policy (modules-as-values Phase 5 S2 re-keys bare type
 * rows to owner keys this way; precedent 805476ec re-keyed field rows).
 *
 * All or nothing: every rename is checked before any byte is written. The old
 * row must exist in this file with exactly the expected UUID; the new key must
 * be free in this file and in `occupied` (the physical union); no row is
 * renamed twice and no key is targeted twice. The file is then replaced by one
 * rename of a complete sibling file, so an interrupted write leaves either the
 * old or the new lock, never a mix. Which rows to rename is decided elsewhere
 * (the Fenel re-key plan, type-identity.fenel); this is filesystem tooling.
 */
export function renameLockFileRows(
  path: string,
  renames: readonly LockRename[],
  occupied: ReadonlyMap<string, string> = new Map(),
): { renamed: number } {
  const rows = new Map<string, string>(readLockFile(path));
  const sources = new Set<string>();
  const targets = new Set<string>();
  for (const rename of renames) {
    if (!isUuidSyntax(rename.id)) {
      throw new Error(`codename-lock rename: invalid UUID "${rename.id}" for ${rename.from}`);
    }
    const pinned = rows.get(rename.from);
    if (pinned === undefined) {
      throw new Error(`codename-lock rename: ${rename.from} has no such row in ${path}`);
    }
    if (pinned !== rename.id) {
      throw new Error(
        `codename-lock rename: ${rename.from} pins ${pinned}, the rename expects ${rename.id}`,
      );
    }
    if (sources.has(rename.from)) {
      throw new Error(`codename-lock rename: ${rename.from} is renamed twice`);
    }
    if (targets.has(rename.to)) {
      throw new Error(`codename-lock rename: ${rename.to} is targeted twice`);
    }
    if (rows.has(rename.to) || occupied.has(rename.to)) {
      throw new Error(`codename-lock rename: ${rename.to} is occupied`);
    }
    sources.add(rename.from);
    targets.add(rename.to);
  }
  if (renames.length === 0) return { renamed: 0 };
  for (const rename of renames) {
    rows.delete(rename.from);
    rows.set(rename.to, rename.id);
  }
  const fs = nodeFs();
  const staged = `${path}.rename-staged`;
  fs.writeFileSync(staged, renderLockText(rows), "utf8");
  try {
    fs.renameSync(staged, path);
  } catch (error) {
    fs.rmSync(staged, { force: true });
    throw error;
  }
  return { renamed: renames.length };
}

/** `renameLockFileRows` on the repo-level lock, checked against the whole
 * physical union (a per-file lock row occupies its key too). */
export function renameRepoLockRows(renames: readonly LockRename[]): { renamed: number } {
  resetLockCache();
  const union = loadLock();
  const result = renameLockFileRows(repoLockPath(), renames, union);
  resetLockCache();
  return result;
}

/**
 * Reconcile the lock against a set of fully-qualified code-names (function
 * ids). `check` mode reports missing entries and never writes (CI). `write`
 * mode uses a caller-supplied preferred UUID when present, otherwise mints a
 * fresh v4 UUID for each missing code-name, then rewrites the repo lock sorted.
 *
 * Per-file locks are honoured as "already covered" so a code-name owned by a
 * per-file lock is never double-minted into the repo-level lock.
 */
export function syncRepoLock(
  codeNames: string[],
  opts: {
    write: boolean;
    /** Exact UUIDs to use for selected missing names. Used when an existing
     * UUID-shaped field name is already durable identity: the owner-qualified
     * lock entry adopts it rather than minting a second UUID. An existing
     * different pin is an integrity error and is never overwritten. */
    preferredIds?: ReadonlyMap<string, string>;
  },
): LockSyncResult {
  const repoEntries = new Map<string, string>(readLockFile(repoLockPath()));
  const covered = new Map<string, string>(loadLock());
  // Validate the whole physical union, including stale/tombstone rows that are
  // not in today's required-name roster. A malformed dormant pin must not hide
  // merely because sync is missing-only.
  for (const [name, uuid] of covered) {
    if (!isUuidSyntax(uuid)) {
      throw new Error(`codename-lock: invalid UUID "${uuid}" for "${name}"`);
    }
  }

  const missing: string[] = [];
  for (const cn of codeNames) {
    const existing = covered.get(cn);
    const preferred = opts.preferredIds?.get(cn);
    if (preferred !== undefined && !isUuidSyntax(preferred)) {
      throw new Error(
        `codename-lock: invalid preferred UUID "${preferred}" for "${cn}"`,
      );
    }
    if (existing === undefined) {
      missing.push(cn);
      continue;
    }
    if (preferred !== undefined && existing !== preferred) {
      throw new Error(
        `codename-lock: preferred UUID conflict for "${cn}": ` +
          `required ${preferred}, lock pins ${existing}`,
      );
    }
  }
  missing.sort();

  let wrote = false;
  let adopted = 0;
  if (opts.write && missing.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
    for (const cn of missing) {
      const preferred = opts.preferredIds?.get(cn);
      repoEntries.set(cn, preferred ?? randomUUID());
      if (preferred !== undefined) adopted++;
    }
    writeRepoLock(repoEntries);
    resetLockCache();
    wrote = true;
  }

  return { missing, total: codeNames.length, wrote, adopted };
}
