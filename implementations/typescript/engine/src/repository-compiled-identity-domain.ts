/** C2/B3 inert generated identity-input projection. No evaluator/registry and
 * no reduction of the real identity maps. Scope ONLY compiled emission hashes.
 */
import { REPOSITORY_IDENTITY_MANIFEST } from "./repository-identity-manifest";
import { resolveCompiledIdentityDomain, decodeCompiledOwnerIdentityScope, type CompiledIdentityDomain,
  type CompiledOwnerIdentityScope, resolveGeneratedCompiledIdentityDomain,
  type CurrentCompiledIdentityInputs, type ResolvedCompiledIdentityDomain } from "../scripts/lib/compiled-artifact-identity-domain";
import type { CompiledArtifactId } from "../scripts/lib/artifact-bytes";

export type OwnerIdentityScope = CompiledOwnerIdentityScope;
export type ReviewedOwnerIdentityAnchor = Readonly<{
  policyDigest: string; anchorDigest: string; finitePlanDigest: string;
}>;
/** Replaced only by the concrete reviewed policy-anchor artifact in the final
 * bundle. Ordinary full rendering must never mint/rebase this review input.
 * Empty means owner mode is unavailable; all mode remains exact and usable.
 */
export const REVIEWED_OWNER_IDENTITY_ANCHORS: Readonly<Partial<Record<CompiledArtifactId, ReviewedOwnerIdentityAnchor>>> = Object.freeze({});

export function currentCompiledIdentityInputs(owner: CompiledArtifactId): CurrentCompiledIdentityInputs {
  const manifest = REPOSITORY_IDENTITY_MANIFEST as typeof REPOSITORY_IDENTITY_MANIFEST & {
    readonly compilerScopes?: Readonly<Partial<Record<CompiledArtifactId, OwnerIdentityScope>>>;
  };
  const expected = REVIEWED_OWNER_IDENTITY_ANCHORS[owner];
  let scoped: CompiledOwnerIdentityScope | undefined;
  try {
    const table = Object.getOwnPropertyDescriptor(manifest, "compilerScopes");
    if (table !== undefined && Object.hasOwn(table, "value") && table.value !== null && typeof table.value === "object") {
      const slot = Object.getOwnPropertyDescriptor(table.value, owner);
      if (slot !== undefined && Object.hasOwn(slot, "value")) scoped = decodeCompiledOwnerIdentityScope(slot.value, owner);
    }
  } catch { /* Unreadable generated scope never enables owner mode. */ }
  const scope = expected !== undefined && scoped !== undefined
    && scoped.policyDigest === expected.policyDigest && scoped.anchorDigest === expected.anchorDigest
    && scoped.finitePlanDigest === expected.finitePlanDigest ? Object.freeze({ digest: scoped.digest,
      policyDigest: scoped.policyDigest, anchorDigest: scoped.anchorDigest, finitePlanDigest: scoped.finitePlanDigest }) : undefined;
  return Object.freeze({ owner, fullDigest: manifest.digest, ...(scope === undefined ? {} : { scope }) });
}

export function allCompiledIdentityDomain(owner: CompiledArtifactId): CompiledIdentityDomain {
  return Object.freeze({ schema: "fenel.compiled-identity-input.v1", owner, kind: "all",
    digest: REPOSITORY_IDENTITY_MANIFEST.digest });
}
export function ownerCompiledIdentityDomain(owner: CompiledArtifactId): CompiledIdentityDomain {
  const current = currentCompiledIdentityInputs(owner);
  if (current.scope === undefined) throw new Error("compiled owner identity scope is absent or unreviewed");
  return Object.freeze({ schema: "fenel.compiled-identity-input.v1", owner, kind: "owner",
    digest: current.scope.digest, policyDigest: current.scope.policyDigest,
    anchorDigest: current.scope.anchorDigest, finitePlanDigest: current.scope.finitePlanDigest });
}
export function resolveRepositoryCompiledIdentityDomain(value: unknown, owner: CompiledArtifactId): ResolvedCompiledIdentityDomain {
  return resolveCompiledIdentityDomain(value, currentCompiledIdentityInputs(owner));
}

// perf 2026-11-01 (harness §8): the compiled parser/resolver gates resolve the
// generated identity domain on every call (the catalogue worker: 1,482 calls,
// about 0.8 s of Chrome CPU per open). This per-realm cache keeps the
// RESOLUTION only (never the active domain, which `withCompiledIdentityDomain`
// still re-resolves per call). A hit needs, read on every call: the same
// generated module object, the same identity carriers in its own data slots
// (`<PREFIX>_IDENTITY_DOMAIN`, `<PREFIX>_SHARDS`), the same owner, full digest
// and reviewed scope digests (`compilerScopes` is not frozen, so the current
// inputs are recomputed each call). It caches only when the shard table, every
// row and every domain carrier are frozen objects: their own data slots, and so
// the uncached resolution's whole input, can then never change. A refusal is
// never cached; it is recomputed (and thrown) on every call.
type GeneratedIdentityResolution = Readonly<{
  owner: CompiledArtifactId; common: object; table: object; fullDigest: string; scope: string;
  resolved: ResolvedCompiledIdentityDomain;
}>;
const generatedIdentityResolutions = new WeakMap<object, GeneratedIdentityResolution>();

function ownDataSlot(carrier: object, key: string): unknown {
  const slot = Object.getOwnPropertyDescriptor(carrier, key);
  return slot !== undefined && Object.hasOwn(slot, "value") ? slot.value : undefined;
}
function scopeKey(current: CurrentCompiledIdentityInputs): string {
  const scope = current.scope;
  return scope === undefined ? "" : JSON.stringify([scope.digest, scope.policyDigest, scope.anchorDigest, scope.finitePlanDigest]);
}
/** The frozen-carrier condition of the cache above (checked once, at insert). */
function frozenIdentityCarriers(common: object, table: object): boolean {
  if (!Object.isFrozen(common) || !Object.isFrozen(table)) return false;
  for (const key of Reflect.ownKeys(table)) {
    const row = typeof key === "string" ? ownDataSlot(table, key) : undefined;
    if (row === null || typeof row !== "object" || !Object.isFrozen(row)) return false;
    const domain = ownDataSlot(row, "identityDomain");
    if (domain === null || typeof domain !== "object" || !Object.isFrozen(domain)) return false;
  }
  return true;
}

/** `resolveGeneratedCompiledIdentityDomain(generated, current)`, answered from
 * the per-realm cache when every input read this call equals the cached ones. */
export function resolveGeneratedCompiledIdentityDomainCached(generated: object,
  current: CurrentCompiledIdentityInputs): ResolvedCompiledIdentityDomain {
  const prefix = current.owner === "compiled-parser" ? "PARSER" : "RESOLVER";
  const common = ownDataSlot(generated, `${prefix}_IDENTITY_DOMAIN`);
  const table = ownDataSlot(generated, `${prefix}_SHARDS`);
  const scope = scopeKey(current);
  const cached = generatedIdentityResolutions.get(generated);
  if (cached !== undefined && cached.owner === current.owner && cached.common === common
    && cached.table === table && cached.fullDigest === current.fullDigest && cached.scope === scope) {
    return cached.resolved;
  }
  const resolved = resolveGeneratedCompiledIdentityDomain(generated, current);
  if (common !== null && typeof common === "object" && table !== null && typeof table === "object"
    && frozenIdentityCarriers(common, table)) {
    generatedIdentityResolutions.set(generated, Object.freeze({ owner: current.owner, common, table,
      fullDigest: current.fullDigest, scope, resolved }));
  }
  return resolved;
}

/** The generated artifact's identity domain against this realm's current
 * repository inputs (`currentCompiledIdentityInputs`, read every call). */
export function resolveGeneratedRepositoryCompiledIdentityDomain(generated: object,
  owner: CompiledArtifactId): ResolvedCompiledIdentityDomain {
  return resolveGeneratedCompiledIdentityDomainCached(generated, currentCompiledIdentityInputs(owner));
}

// Synchronous generation/runtime hash scope only. Per-owner coordinates avoid
// a parser proof silently changing a nested resolver's identity domain.
const active = new Map<CompiledArtifactId, CompiledIdentityDomain>();
export function compiledIdentityInput(artifact: "parser" | "resolver"): ResolvedCompiledIdentityDomain {
  const owner = artifact === "parser" ? "compiled-parser" : "compiled-resolver";
  return resolveRepositoryCompiledIdentityDomain(active.get(owner) ?? allCompiledIdentityDomain(owner), owner);
}
export function withCompiledIdentityDomain<T>(domain: CompiledIdentityDomain,
  operation: (() => T) & (Extract<T, PromiseLike<unknown>> extends never ? unknown : never)): T {
  const resolved = resolveRepositoryCompiledIdentityDomain(domain, domain.owner);
  const previous = active.get(domain.owner);
  active.set(domain.owner, resolved.domain);
  try { return operation(); }
  finally { if (previous === undefined) active.delete(domain.owner); else active.set(domain.owner, previous); }
}
