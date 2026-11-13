// S1b — record an engine-body replay artifact (scratch stage: not yet a phase of
// generate-identity-artifacts.ts; the regeneration is deferred).
//
//   bun implementations/typescript/engine/scripts/record-engine-body-replay.ts <out.gz> [projected|seed|execute|system ...]
//
// One fresh realm builds the repository registries and their canonical S2
// Bases for the given module roles, the anonymous projected workspace model's
// registry (`projected`: the seed modules SYSTEM also loads, which browser
// workers build first) and the actual SYSTEM registry (default: projected seed
// system), with the engine-body memo
// on, then writes the "repository" partition as `<out.gz>` plus its integrity
// pin `<out.gz>.stamp.json`. The Base inputs come from a real Local registry
// build over a fixed public tooling fixture; only its repository Base enters
// the public partition, never the fixture's Delta or complete registry.
// Refuses (exit 1, nothing left behind) when:
//   - the source epoch captured BEFORE any engine code is imported differs from
//     the one captured AFTER writing (a source byte changed during the run), or
//     any hashed file is dated after the recorder started (A -> B -> A);
//   - the harness pool digest recomputed uncached at export differs from the
//     cached one the recorded keys used;
//   - the harness certificate cannot be stated;
//   - a canonical Base identity universe differs from the repository, or its
//     replay requires any host check other than portable case mapping;
//   - the memo cap or a host storage failure dropped an eligible result.
// The output path must be outside the epoch's byte universe (or excluded from
// it), else the "after" epoch moves and the run refuses.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeEngineBodyReplaySourceEpoch } from "./lib/engine-body-replay-epoch";

type ReplayRecordingProfile = "projected" | "seed" | "execute" | "system";

/** Closed tooling CLI, validated before reading source bytes or engine imports.
 * SYSTEM is an accessor-backed profile and `projected` an engine-owned module
 * selection, never module-manifest roles. */
function parseReplayProfiles(args: readonly string[]): ReplayRecordingProfile[] {
  const profiles: ReplayRecordingProfile[] = [];
  for (const name of args.length ? args : ["projected", "seed", "system"]) {
    if (name !== "projected" && name !== "seed" && name !== "execute" && name !== "system")
      throw new Error(`unknown recording profile ${JSON.stringify(name)} (expected projected, seed, execute or system)`);
    if (profiles.includes(name)) throw new Error(`duplicate recording profile ${name}`);
    profiles.push(name);
  }
  if (!profiles.some(name => name === "seed" || name === "execute"))
    throw new Error("recording requires seed or execute for the canonical repository Base");
  return profiles;
}

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const out = process.argv[2];
if (out === undefined) {
  console.error("usage: record-engine-body-replay.ts <out.gz> [projected|seed|execute|system ...]");
  process.exit(2);
}
let profiles: ReplayRecordingProfile[];
try { profiles = parseReplayProfiles(process.argv.slice(3)); }
catch (error) {
  console.error(`record-engine-body-replay: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const outPath = resolve(out);
const stampPath = `${outPath}.stamp.json`;
const started = performance.now();
const log = (message: string): void => {
  process.stdout.write(`[record-engine-body-replay ${((performance.now() - started) / 1000).toFixed(1)}s] ${message}\n`);
};
const refuse = (reason: string): never => {
  for (const path of [outPath, stampPath]) if (existsSync(path)) rmSync(path);
  console.error(`record-engine-body-replay: REFUSED — ${reason}`);
  process.exit(1);
};

// 1. The epoch before any engine module is imported (only node and the
//    scripts/lib epoch helper are loaded at this point). A file modified after
//    this wall-clock instant refuses the run even if its bytes return to the
//    same content (A -> B -> A: the engine may have loaded B).
const startedWallMs = Date.now();
// The artifact must hold EVERY entry the builds stored: lift the in-realm
// table's byte cap for this process (an evicted entry would silently be
// missing from the artifact) unless the caller set one explicitly, and refuse
// below if anything was evicted or could not be stored anyway.
if (process.env["FENEL_ENGINE_BODY_MEMO_MB"] === undefined) process.env["FENEL_ENGINE_BODY_MEMO_MB"] = "8192";
const before = computeEngineBodyReplaySourceEpoch(repositoryRoot);
if (before.latestMtimeMs > startedWallMs) refuse("a source file is dated after the recorder started");
log(`source epoch before: ${before.digest} (${before.fileCount} files)`);

// 2. Engine code, then the builds.
const src = join(repositoryRoot, "implementations/typescript/engine/src");
await import(join(src, "engine-body-host-install.ts"));
const manifest = await import(join(src, "module-manifest.ts")) as typeof import("../src/module-manifest");
const repository = await import(join(src, "repository-registry.ts")) as typeof import("../src/repository-registry");
const repositoryIdentities = await import(join(src, "repository-identity-manifest.ts")) as typeof import("../src/repository-identity-manifest");
const memo = await import(join(src, "engine-body-memo.ts")) as typeof import("../src/engine-body-memo");
const replay = await import(join(src, "engine-body-replay-host.ts")) as typeof import("../src/engine-body-replay-host");
const dispatch = await import(join(src, "engine-bodies-dispatch.ts")) as typeof import("../src/engine-bodies-dispatch");
const jsonLogic = await import(join(src, "json-logic.ts")) as typeof import("../src/json-logic");
const localFields = await import(join(src, "account-field-registry.ts")) as typeof import("../src/account-field-registry");
const preparation = await import(join(src, "field-identity-worker-client.ts")) as typeof import("../src/field-identity-worker-client");
const fieldIdentity = await import(join(src, "field-identity.ts")) as typeof import("../src/field-identity");
const system = await import(join(src, "system-registry.ts")) as typeof import("../src/system-registry");
const projected = await import(join(src, "projected-workspace-modules.ts")) as typeof import("../src/projected-workspace-modules");
if (!memo.engineBodyMemoSwitchedOn()) refuse("the engine-body memo is switched off in this process (NODE_ENV=test or FENEL_ENGINE_BODY_MEMO=0)");

/** Tooling orchestration only: the real registry owns root assembly and the
 * split; the existing Fenel Base and Delta own every field judgment. These
 * fixed fixture bytes belong to the replay source epoch through this file.
 * They are neither persisted nor taken from any user's Local definitions. */
async function recordCanonicalRepositoryBase(
  modules: ReturnType<typeof manifest.modulesFor>,
  role: string,
): Promise<void> {
  const fixtureId = "bc37bff0-54c7-484b-bf0e-4c0d7e968781";
  const baseFn = "engine:collectFieldIdentitiesBase";
  const facetsFn = "engine:projectFieldFacets";
  let requests = 0;
  let recorded = 0;
  let facetsVerified = 0;
  let failure: string | undefined;
  const preparationHost = preparation.createRegistryPreparationHost(async () => ({
    async run(request) {
      if (request.kind === "facets") {
        try {
          // The page structured-clones its facets request to the worker. Its
          // transported key must equal the public entry the repository build
          // just recorded (the marshal hands plain data): a private lookup of
          // the clone must hit it, with no computation, storage or refusal.
          const counters = (row: ReturnType<typeof memo.engineBodyMemoStats>["byFn"][string] | undefined) => ({
            calls: row?.calls ?? 0, hits: row?.hits ?? 0, repositoryHits: row?.repositoryHits ?? 0,
            computed: row?.computed ?? 0, stored: row?.stored ?? 0, artifactHits: row?.artifactHits ?? 0,
            refused: JSON.stringify(row?.refused ?? {}), notStored: JSON.stringify(row?.notStored ?? {}),
          });
          const beforeFacets = counters(memo.engineBodyMemoStats().byFn[facetsFn]);
          const clonedFacets = structuredClone(request);
          const answer = memo.withEngineBodyMemoPartition("local:engine-body-replay-facets-transport-fixture",
            () => preparation.runRegistryPreparation(clonedFacets), { retain: false });
          const afterFacets = counters(memo.engineBodyMemoStats().byFn[facetsFn]);
          if (afterFacets.calls !== beforeFacets.calls + 1 || afterFacets.hits !== beforeFacets.hits + 1
            || afterFacets.repositoryHits !== beforeFacets.repositoryHits + 1
            || afterFacets.computed !== beforeFacets.computed || afterFacets.stored !== beforeFacets.stored
            || afterFacets.artifactHits !== beforeFacets.artifactHits
            || afterFacets.refused !== beforeFacets.refused || afterFacets.notStored !== beforeFacets.notStored) {
            throw new Error(`transported facets did not hit the recorded public entry: ${JSON.stringify({ beforeFacets, afterFacets })}`);
          }
          facetsVerified += 1;
          return answer;
        } catch (error) {
          failure ??= error instanceof Error ? error.message : String(error);
          throw error;
        }
      }
      if (request.kind !== "fieldsDelta") return preparation.runRegistryPreparation(request);
      requests += 1;
      try {
        const kinds = request.options.baseIdentityKinds;
        const canonicalKinds = [...repositoryIdentities.repositoryIdentityKinds()];
        const suppliedKinds = kinds === undefined ? undefined : [...kinds];
        // Entry order is part of the actual marshalled Base input. Check the
        // full fresh public map, including reservations, before public scope.
        if (suppliedKinds === undefined || kinds!.has(fixtureId)
          || suppliedKinds.length !== canonicalKinds.length
          || canonicalKinds.some(([id, kind], index) => suppliedKinds[index]![0] !== id || suppliedKinds[index]![1] !== kind)) {
          throw new Error("the registry did not supply a repository-only Base identity universe");
        }
        const beforeBase = memo.engineBodyMemoStats().byFn[baseFn];
        const prepared = memo.withEngineBodyMemoPartition(memo.REPOSITORY_PARTITION,
          () => fieldIdentity.tryCollectFieldIdentityBase(request.roots, request.options));
        if (!prepared.ok) throw new Error(`Base refused: ${prepared.reason}`);
        const afterBase = memo.engineBodyMemoStats().byFn[baseFn];
        // A successful kernel result alone is insufficient: the memo may have
        // refused storage. A hit also proves this exact call's public entry;
        // artifact hits are admitted and stored through the same memo door.
        const storedOrHit = (row: typeof afterBase): number => row === undefined ? 0
          : row.stored + row.hits + row.artifactHits;
        if (afterBase === undefined || storedOrHit(afterBase) !== storedOrHit(beforeBase) + 1
          || JSON.stringify(afterBase?.notStored ?? {}) !== JSON.stringify(beforeBase?.notStored ?? {})) {
          throw new Error(`Base was not retained by the public memo: ${JSON.stringify(afterBase)}`);
        }
        {
          // The page sends this same request through native structured clone.
          // Check that complete transport against the public entry just made;
          // a clone-only key must never become a second public recording.
          const clonedRequest = structuredClone(request);
          const clonedBase = memo.withEngineBodyMemoPartition("local:engine-body-replay-transport-fixture",
            () => fieldIdentity.tryCollectFieldIdentityBase(clonedRequest.roots, clonedRequest.options), { retain: false });
          if (!clonedBase.ok) throw new Error(`transported Base refused: ${clonedBase.reason}`);
          const afterClone = memo.engineBodyMemoStats().byFn[baseFn];
          if (afterClone === undefined
            || afterClone.calls !== afterBase.calls + 1
            || afterClone.hits !== afterBase.hits + 1
            || afterClone.repositoryHits !== afterBase.repositoryHits + 1
            || afterClone.computed !== afterBase.computed
            || afterClone.stored !== afterBase.stored
            || afterClone.artifactHits !== afterBase.artifactHits
            || JSON.stringify(afterClone.refused) !== JSON.stringify(afterBase.refused)
            || JSON.stringify(afterClone.notStored) !== JSON.stringify(afterBase.notStored)) {
            throw new Error(`transported Base did not hit the recorded public entry: ${JSON.stringify(afterClone)}`);
          }
        }
        // The public recording scope has ended. Preserve the full mixed map
        // and run the ordinary Delta with the exact Base just computed.
        const delta = fieldIdentity.collectFieldIdentitiesThroughBase(request.roots, request.options, prepared.base);
        if (delta.collection === undefined || delta.outcome !== "delta") {
          throw new Error(`the fixed Local fixture did not collect through Delta: ${delta.outcome}`);
        }
        recorded += 1;
        return { collection: delta.collection, outcome: delta.outcome, retained: "made" as const };
      } catch (error) {
        // createRegistryAsync normally catches a failed Delta and completes
        // via the monolithic kernel. That remains correct product behavior,
        // but must not let this recorder report a missing Base as success.
        failure ??= error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
    release() {},
    abort() {},
  }));
  try {
    await localFields.createLocalFieldRegistryAsync(modules, "engine-body-replay-public-fixture", {
      owners: [{ kind: "function", ownerKey: `function:${fixtureId}`, storageName: "replayBaseFixture",
        definition: { id: fixtureId, params: [], returns: { $ref: "Number" }, body: 0 } }],
      fields: [], facets: [],
    }, { preparationHost });
  } catch (error) {
    failure ??= error instanceof Error ? error.message : String(error);
  }
  // Unwind through the phase observer before the top-level refusal removes
  // outputs and exits, so failed Base recording still publishes its metrics.
  if (failure !== undefined) throw new Error(`${role} canonical Base: ${failure}`);
  if (requests === 0 || recorded !== requests) throw new Error(`${role} canonical Base was not recorded through the registry preparation host`);
  if (facetsVerified === 0) throw new Error(`${role} transported facets were not checked through the registry preparation host`);
  log(`recorded ${role} canonical Base and verified its transport hit through ${recorded} registry preparation request(s); facets transport hit verified ${facetsVerified} time(s)`);
}

/** Observe the actual ordered builds, without resetting memo/catalogue state.
 * Snapshots retain absent rows as absent and include refusals, host checks,
 * eviction and retained-text counters; elapsed time is not kernel CPU time. */
async function recordReplayProfiles(profiles: readonly ReplayRecordingProfile[]): Promise<void> {
  async function observe(profile: ReplayRecordingProfile, phase: "registry" | "canonical-base",
    run: () => void | Promise<void>): Promise<void> {
    const before = memo.engineBodyMemoStats();
    const started = performance.now();
    let completed = false;
    try { await run(); completed = true; }
    finally {
      const elapsedMs = performance.now() - started;
      const after = memo.engineBodyMemoStats();
      log(`profile-metrics ${JSON.stringify({ profile, phase, completed, elapsedMs, before, after })}`);
    }
  }
  for (const profile of profiles) {
    if (profile === "projected") {
      // Its whole-collection bodies (field identities, constructor catalogue,
      // facets, signature plans) take other inputs than the seed build's, so
      // a worker's first build replays them only from this profile. Recorded
      // first by default, as a worker builds it first in its realm.
      await observe(profile, "registry", () => { repository.createRepositoryRegistry(projected.projectedWorkspaceModules()); });
      continue;
    }
    if (profile === "system") {
      await observe(profile, "registry", () => {
        if (system.peekSystemRegistry() !== null)
          throw new Error("SYSTEM was already constructed before its recording profile; use a fresh process and inspect the preceding history");
        system.getSystemRegistry();
      });
      continue;
    }
    const modules = manifest.modulesFor(profile);
    await observe(profile, "registry", () => { repository.createRepositoryRegistry(modules); });
    await observe(profile, "canonical-base", () => recordCanonicalRepositoryBase(modules, profile));
  }
}
try { await recordReplayProfiles(profiles); }
catch (error) { refuse(error instanceof Error ? error.message : String(error)); }

// 3. Export, with the pool and certificate checks.
const tableStats = memo.engineBodyMemoStats();
if (tableStats.evictions > 0) refuse(`the memo table evicted ${tableStats.evictions} entries (raise FENEL_ENGINE_BODY_MEMO_MB)`);
const overCap = Object.values(tableStats.byFn).reduce((sum, row) => sum + (row.notStored["over the byte cap"] ?? 0), 0);
if (overCap > 0) refuse(`the memo table skipped ${overCap} over-cap results (raise FENEL_ENGINE_BODY_MEMO_MB)`);
const storageFailures = Object.values(tableStats.byFn).reduce((sum, row) => sum + (row.notStored["storage unavailable"] ?? 0), 0);
if (storageFailures > 0) refuse(`the memo table could not store ${storageFailures} results (host storage unavailable)`);
log(`memo table: ${tableStats.entries} entries, ${(tableStats.bytes / 1048576).toFixed(0)} MB (${(tableStats.textChars / 1e6).toFixed(1)} M value chars, ${(tableStats.keyChars / 1e6).toFixed(1)} M key chars)`);
const pool = dispatch.enginePoolDigestCheck();
if (pool.cached === undefined || pool.cached !== pool.fresh) refuse(`pool digest changed (cached ${pool.cached}, fresh ${pool.fresh})`);
const harnessCertificate = dispatch.engineHarnessCertificate();
if (harnessCertificate === undefined) refuse("harness certificate unavailable");
const entries = memo.exportEngineBodyMemoEntries("repository").map((entry) => ({
  keyDigest: entry.keyDigest,
  fnId: entry.fnId,
  ...(entry.hostChecks === undefined ? {} : { hostChecks: entry.hostChecks }),
  text: entry.text,
}));
const baseEntries = entries.filter((entry) => entry.fnId === "engine:collectFieldIdentitiesBase");
if (baseEntries.length === 0) refuse("the public memo exported no canonical repository Base");
for (const entry of baseEntries) {
  // Unicode lowercase is portable when its functional corpus digest agrees;
  // replay still checks that digest in the consuming host. Every other host
  // dependency (an engine-build fingerprint) blocks this artifact.
  if (entry.hostChecks !== undefined && (!Array.isArray(entry.hostChecks)
    || [...entry.hostChecks].some((check) => !Array.isArray(check) || check.length !== 2
      || check[0] !== "std:lower" || typeof check[1] !== "string"
      || check[1].length !== 69 || !/^case:[0-9a-f]{64}$/.test(check[1])))) {
    refuse(`canonical Base replay has nonportable host checks: ${JSON.stringify(entry.hostChecks)}`);
  }
}
log(`canonical Base replay: ${baseEntries.length} entries (${baseEntries.filter((entry) => "hostChecks" in entry).length} host-bound)`);
const { bytes, stamp } = replay.writeReplayArtifact({
  sourceEpoch: before.digest,
  harnessCertificate: harnessCertificate!,
  hookGeneration: jsonLogic.evaluatorHookGenerationForMemo(),
}, entries);
writeFileSync(outPath, bytes);
writeFileSync(stampPath, `${JSON.stringify(stamp, null, 1)}\n`);

// 4. The epoch after writing.
const after = computeEngineBodyReplaySourceEpoch(repositoryRoot);
if (after.digest !== before.digest) refuse(`source epoch moved during the run (${before.digest} -> ${after.digest})`);
if (after.latestMtimeMs > startedWallMs) refuse("a source file was modified during the run");
const hostBound = entries.filter((entry) => "hostChecks" in entry).length;
log(`wrote ${outPath}: ${(bytes.byteLength / 1048576).toFixed(1)} MB, ${entries.length} entries (${hostBound} host-bound), pool ${pool.cached}`);
process.exit(0);
