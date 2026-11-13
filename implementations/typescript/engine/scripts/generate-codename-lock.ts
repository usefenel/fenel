import { manifestFor, compareName, type IdentityKind, type ManifestRow, type TypeDeclarationRow, type Manifest } from "./lib/repository-identity-wire";
export { manifestFor } from "./lib/repository-identity-wire";
// Repository identity generator/checker (field-identity Phase 2a).
//
// Chicken-and-egg order is deliberate:
//   1. collect against the current physical disk union;
//   2. mint/adopt missing requirements only;
//   3. emit the complete physical union (including tombstones) as inert JSON;
//   4. rebuild the canonical universe in StrictEmbedded mode.
//
// The generator is an importable CORE (`runCodenameLock`) behind a thin
// `import.meta.main` CLI. Module loading, not identity work, dominates a cold
// run, so a driver that needs the step-4 registries as well (see
// generate-identity-artifacts.ts) reuses this process instead of paying the first
// pass twice. The core therefore reads no `process.argv` and never calls
// `process.exit`: every verdict — including the `--check` missing-row failure,
// which is returned as `ok: false` before any manifest is built — is rendered
// by the wrapper, which owns the exit codes.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadLock,
  renameRepoLockRows,
  resetLockCache,
  syncRepoLock,
  type LockRename,
} from "../src/codename-lock";
import { dispatchEngineBody, withInterpretedResolver } from "../src/engine-bodies-dispatch";
import { fieldLockRequirements } from "../src/field-identity";
import { compileConstructorCatalogCandidates } from "../src/compile-field-slots";
import { repositoryIdentityProfiles } from "../src/repository-identity-modules";
import { createIdentityProjectionRegistry, createRegistry } from "../src/registry";
import { dispatchRegistry, specEntities, systemEntities } from "../src/system-entities";

/** A labelled step-4 registry. `unknown` because the strict universe is handed
 * to a second emitter as OPAQUE state: a consumer states the minimal projection
 * it reads, and no caller inherits registry authority by construction. */
export type StrictProfileRegistry = { profileId: string; registry: unknown };

export type CodenameLockResult =
  /** `--check` only: required rows are absent from the physical lock. Nothing
   * downstream ran — no manifest, no comparison, no strict rebuild — exactly as
   * when this path terminated the process. */
  | { ok: false; missing: string[]; total: number }
  | {
    ok: true;
    digest: string;
    manifestEntries: ReadonlyArray<ManifestRow>;
    /** name → id index over `manifestEntries`. The in-memory manifest module is
     * frozen at its own module evaluation, so a same-process consumer must take
     * post-mint identity state from HERE, never by re-reading that module. */
    manifestLock: Map<string, string>;
    strictRegistries: StrictProfileRegistry[];
    /** Rows this run actually added, each with the kind the post-mint
     * re-collect required it as. Empty when nothing was written. */
    minted: Array<{ name: string; kind: string }>;
    /** Type rows this run renamed in place to their owner key, each keeping
     * its UUID (per-owner type identity). Empty when nothing was renamed. */
    renamed: LockRename[];
    missing: string[];
    wrote: boolean;
    adopted: number;
    total: number;
    requiredCount: number;
    physicalCount: number;
  };

const scriptDir = dirname(fileURLToPath(import.meta.url));
const artifactPath = resolve(
  scriptDir,
  "../src/generated/repository-identity-manifest.json",
);
const repoLockPath = resolve(scriptDir, "../../../../.fenel.lock");


/** One type declaration as the lock sees it (per-owner type identity,
 * modules-as-values Phase 5 S2). The facts are gathered here; which ones hold a
 * row, and how the lock changes, is decided by the Fenel plan. */
type TypeIdentityCandidate = {
  readonly owner: string;
  readonly name: string;
  readonly parametric: boolean;
  readonly dispatchClass: boolean;
  readonly systemDeclared: boolean;
};

type TypeIdentityAction =
  | { $tag: "TypeIdentityRekey"; name: string; oldKey: string; newKey: string; id: string }
  | { $tag: "TypeIdentityMint"; name: string; newKey: string }
  | { $tag: "TypeIdentityRetain"; name: string; newKey: string; id: string };

const maybeOf = (value: string | undefined) =>
  value === undefined ? { $tag: "Nothing" } : { $tag: "Just", _0: value };

/** The type rows of the lock: keys from ONE call of the Fenel owner codec
 * (`engine:typeIdentityLockKeys`), the plan from `engine:typeIdentityRekeyPlan`
 * over (bare rows, owner census, keeper table). TypeScript looks up the two rows
 * each declaration can claim and applies nothing itself; any refusal stops the
 * run before a byte is written. */
function planTypeIdentity(
  candidates: readonly TypeIdentityCandidate[],
  physical: ReadonlyMap<string, string>,
): { actions: TypeIdentityAction[]; declarations: TypeDeclarationRow[] } {
  const keys = dispatchEngineBody("engine:typeIdentityLockKeys", [
    candidates.map((candidate) => maybeOf(candidate.owner)),
    candidates.map((candidate) => candidate.name),
  ]);
  if (!Array.isArray(keys) || keys.length !== candidates.length) {
    throw new Error("repository identity: the type identity lock keys are malformed");
  }
  const facts = candidates.map((candidate, index) => ({
    $tag: "TypeIdentityCandidate",
    ...candidate,
    bareId: maybeOf(physical.get(candidate.name)),
    keyedId: maybeOf(physical.get(keys[index] as string)),
  }));
  const plan = dispatchEngineBody("engine:typeIdentityRekeyPlan", [facts]) as {
    actions?: unknown;
    refusals?: unknown;
  };
  if (!Array.isArray(plan?.actions) || !Array.isArray(plan?.refusals)) {
    throw new Error("repository identity: the type identity plan is malformed");
  }
  if (plan.refusals.length > 0) {
    throw new Error(
      `repository identity: per-owner type identity refused:\n  ${plan.refusals.join("\n  ")}`,
    );
  }
  const actions = plan.actions as TypeIdentityAction[];
  // The (owner, name) behind each planned key, straight from the codec's
  // output: one row per key.
  const planned = new Set(actions.map((action) => action.newKey));
  const declarations = new Map<string, TypeDeclarationRow>();
  candidates.forEach((candidate, index) => {
    const key = keys[index] as string;
    if (planned.has(key)) declarations.set(key, [candidate.owner, candidate.name, key]);
  });
  return { actions, declarations: [...declarations.values()] };
}

function buildRequirements(physical: ReadonlyMap<string, string>): {
  requiredKinds: Map<string, Exclude<IdentityKind, "reserved">>;
  preferredIds: ReadonlyMap<string, string>;
  typeRenames: LockRename[];
  typeNames: ReadonlySet<string>;
  typeDeclarations: TypeDeclarationRow[];
} {
  // Registry construction and its lazy catalog/list projections mutate and
  // observe the exact compiled-artifact input stamp. While source edits make
  // the checked resolver stale, proving every intermediate stamp repeats the
  // whole resolver closure. Keep this complete finite proof interpreted, then
  // restore ordinary dispatch synchronously when all projections are sealed.
  return withInterpretedResolver(() => {
    const lock = new Map(physical);
    const requiredKinds = new Map<string, Exclude<IdentityKind, "reserved">>();
    const preferredIds = new Map<string, string>();

    const add = (name: string, kind: Exclude<IdentityKind, "reserved">): void => {
      const prior = requiredKinds.get(name);
      if (prior !== undefined && prior !== kind) {
        throw new Error(
          `repository identity: ${JSON.stringify(name)} is required as both ${prior} and ${kind}`,
        );
      }
      requiredKinds.set(name, kind);
    };

    const mergePreferred = (values: ReadonlyMap<string, string>): void => {
      for (const [name, id] of values) {
        const prior = preferredIds.get(name);
        if (prior !== undefined && prior !== id) {
          throw new Error(
            `repository identity: conflicting preferred UUIDs for ${JSON.stringify(name)}: ${prior}/${id}`,
          );
        }
        preferredIds.set(name, id);
      }
    };

    // Per-owner type identity: every profile's identified declarations, one
    // candidate per distinct (owner, name, facts). The retained roster is
    // explicit in type-identity.fenel (`typeIdentityRequired`): it reproduces
    // the former display-catalog roster per owner, keeps locked module
    // parametrics and the four reserved system rows that already resolved.
    const systemNames = new Set(systemEntities.map((entity) => entity.id));
    const typeCandidates = new Map<string, TypeIdentityCandidate>();
    for (const profile of repositoryIdentityProfiles()) {
      const registry = createRegistry([...profile.modules], {
        dispatchRegistry,
        codeNameLock: lock,
        fieldIdentity: {
          mode: "collect-requirements",
          defaultRealm: "repository-source",
          lock,
        },
      });
      const fields = fieldLockRequirements({
        lockRequests: registry.listFieldLockRequests(),
      });
      const constructorKinds = new Map<string, string>(registry.listConstructorSignatures()
        .flatMap(row => row.functionId === undefined ? [] : [[row.functionId, "function"] as const]));
      const constructorCandidates = compileConstructorCatalogCandidates({
        listIdentifiedEntities: () => registry.listIdentifiedEntities(),
        identityLock: lock,
        identityKinds: constructorKinds,
      });
      const functionRequirements = dispatchEngineBody("engine:constructorFunctionLockRequirements", [
        constructorCandidates, registry.listFunctions().map(fn => fn.id),
      ]);
      if (!Array.isArray(functionRequirements) || functionRequirements.some(name => typeof name !== "string")) {
        throw new Error("repository identity: constructor Function requirements are malformed");
      }
      for (const name of functionRequirements as string[]) add(name, "function");
      for (const name of fields.codeNames) add(name, "field");
      mergePreferred(fields.preferredIds);
      for (const entity of registry.listIdentifiedEntities()) {
        if (typeof entity.module !== "string") {
          throw new Error(`repository identity: type ${JSON.stringify(entity.id)} has no owner`);
        }
        const candidate: TypeIdentityCandidate = {
          owner: entity.module,
          name: entity.id,
          parametric: (entity.params?.length ?? 0) > 0,
          dispatchClass: entity.interface !== undefined,
          systemDeclared: systemNames.has(entity.id),
        };
        typeCandidates.set(JSON.stringify(candidate), candidate);
      }
      // The spec-only registrations: dispatch classes every registry
      // registers under the owner `system` (the registry's spec loop) though
      // no bundle or system declaration lists them, so they are no identified
      // entity. Their lock rows are read like any type row; which of them hold
      // one is the Fenel roster's decision (typeIdentityRetainedSystemClasses).
      const identified = new Set(registry.listIdentifiedEntities().map((entity) => entity.id));
      for (const spec of specEntities) {
        if (spec.type === undefined || identified.has(spec.id)) continue;
        const candidate: TypeIdentityCandidate = {
          owner: "system",
          name: spec.id,
          parametric: (spec.params?.length ?? 0) > 0,
          dispatchClass: dispatchRegistry.getClass(spec.id) !== undefined,
          systemDeclared: systemNames.has(spec.id),
        };
        typeCandidates.set(JSON.stringify(candidate), candidate);
      }
    }

    const candidates = [...typeCandidates.values()];
    const typeRenames: LockRename[] = [];
    const { actions, declarations: typeDeclarations } = planTypeIdentity(candidates, physical);
    for (const action of actions) {
      add(action.newKey, "type");
      if (action.$tag === "TypeIdentityRekey") {
        typeRenames.push({ from: action.oldKey, to: action.newKey, id: action.id });
      }
    }
    const typeNames = new Set(candidates.map((candidate) => candidate.name));
    return { requiredKinds, preferredIds, typeRenames, typeNames, typeDeclarations };
  });
}

/** Exported for the per-owner type identity guard tests only. `typeNames` is
 * every declared type name of the profiles: none may be a type requirement or
 * a lock key any more (a type row is keyed by its owner). `typeDeclarations`
 * is the (owner, name, key) projection of the owner-keyed type rows; each
 * key must be a live type row, once. */

function renderManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function assertArtifactEqual(expected: Manifest): void {
  let actualText: string;
  try {
    actualText = readFileSync(artifactPath, "utf8");
  } catch {
    throw new Error(`repository identity artifact is missing: ${artifactPath}`);
  }
  const expectedText = renderManifest(expected);
  // Compare LF-CANONICAL forms (slice 3jw, rider 1). MEASURED, not defensive:
  // this artifact had no `.gitattributes` pin, so with `core.autocrlf` on it
  // materializes CRLF in a FRESH checkout and this comparison threw "differs
  // from the full physical lock union" on content that was byte-identical. The
  // file is now pinned `eol=lf`, but a pin cannot repair a checkout that
  // predates it, and a false RED here reads exactly like a real identity drift.
  const lf = (t: string): string => t.replace(/\r\n/g, "\n");
  if (lf(actualText) !== lf(expectedText)) {
    throw new Error(
      "repository identity artifact differs from the full physical lock union; " +
      "run generate-codename-lock.ts",
    );
  }
}

/** Step 4. The constructed universe is RETURNED rather than discarded: it is
 * the only post-mint strict view in the process, and rebuilding it in a second
 * process is the whole cost the driver exists to avoid. */
function strictRebuild(manifest: Manifest): StrictProfileRegistry[] {
  return withInterpretedResolver(() => {
    const lock = new Map(manifest.entries.map(([name, id]) => [name, id]));
    const identityKinds = new Map(manifest.entries.map(([, id, kind]) => [id, kind]));
    const built: StrictProfileRegistry[] = [];
    for (const profile of repositoryIdentityProfiles()) {
      const create = profile.signatureJudgment === "identity-only"
        ? createIdentityProjectionRegistry
        : createRegistry;
      built.push({
        profileId: profile.id,
        registry: create([...profile.modules], {
          dispatchRegistry,
          codeNameLock: lock,
          fieldIdentity: {
            mode: "strict-embedded",
            defaultRealm: "repository-source",
            lock,
            identityKinds,
          },
        }),
      });
    }
    return built;
  });
}

export function runCodenameLock(opts: { check: boolean }): CodenameLockResult {
  const check = opts.check;
  const originalRepoLock = readFileSync(repoLockPath, "utf8");
  const originalArtifact = readFileSync(artifactPath, "utf8");
  let repoWritten = false;
  let artifactWritten = false;
  try {
    resetLockCache();
    let physical = loadLock();
    let { requiredKinds, preferredIds, typeRenames, typeNames, typeDeclarations } = buildRequirements(physical);
    const requirements = [...requiredKinds.keys()].sort(compareName);
    // Per-owner type identity: bare type rows are renamed in place to their
    // owner keys, keeping their UUIDs, before any missing row is minted.
    if (check && typeRenames.length > 0) {
      return {
        ok: false,
        missing: typeRenames.map((rename) => `${rename.from} (rename to ${rename.to})`),
        total: requirements.length,
      };
    }
    const renamed = check ? [] : typeRenames;
    if (renamed.length > 0) {
      renameRepoLockRows(renamed);
      repoWritten = true;
      resetLockCache();
      physical = loadLock();
    }
    const sync = syncRepoLock(requirements, {
      write: !check,
      preferredIds,
    });
    repoWritten = repoWritten || sync.wrote;

    if (sync.missing.length > 0 && check) {
      return { ok: false, missing: sync.missing, total: sync.total };
    }

    if (!check && (sync.wrote || renamed.length > 0)) {
      resetLockCache();
      physical = loadLock();
      ({ requiredKinds, preferredIds, typeRenames, typeNames, typeDeclarations } = buildRequirements(physical));
      if (typeRenames.length > 0) {
        throw new Error("repository identity: the type identity re-key did not converge");
      }
    }

    const manifest = manifestFor(physical, requiredKinds, typeNames, typeDeclarations);
    if (check) {
      assertArtifactEqual(manifest);
    } else {
      writeFileSync(artifactPath, renderManifest(manifest), "utf8");
      artifactWritten = true;
    }

    const strictRegistries = strictRebuild(manifest);
    return {
      ok: true,
      digest: manifest.digest,
      manifestEntries: manifest.entries,
      manifestLock: new Map(manifest.entries.map(([name, id]) => [name, id])),
      strictRegistries,
      minted: sync.wrote
        ? sync.missing.map((name) => ({
          name,
          kind: requiredKinds.get(name) ?? "reserved",
        }))
        : [],
      renamed,
      missing: sync.missing,
      wrote: sync.wrote,
      adopted: sync.adopted,
      total: sync.total,
      requiredCount: manifest.requiredCount,
      physicalCount: manifest.physicalCount,
    };
  } catch (error) {
    // Ordinary failures after the missing-only writer must not leave the two
    // generated physical views out of sync. Hard process termination remains
    // outside any in-process transaction and is detected by --check.
    if (repoWritten) writeFileSync(repoLockPath, originalRepoLock, "utf8");
    if (artifactWritten) writeFileSync(artifactPath, originalArtifact, "utf8");
    resetLockCache();
    throw error;
  }
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const result = runCodenameLock({ check });
  if (!result.ok) {
    console.error(
      `codename-lock --check FAILED: ${result.missing.length} required row(s) missing ` +
      `from the physical lock (of ${result.total} required).`,
    );
    for (const name of result.missing) console.error(`  ${name}`);
    process.exit(1);
  }
  const tombstones = result.physicalCount - result.requiredCount;
  console.log(
    `codename-lock ${check ? "--check " : ""}OK: ` +
    `${result.requiredCount} required, ${result.physicalCount} physical, ` +
    `${tombstones} retained tombstone(s), sha256 ${result.digest}` +
    (!check && result.wrote
      ? `; ${result.missing.length} added (${result.adopted} adopted)`
      : "") +
    (result.renamed.length > 0
      ? `; ${result.renamed.length} type row(s) renamed in place to owner keys`
      : ""),
  );
}
