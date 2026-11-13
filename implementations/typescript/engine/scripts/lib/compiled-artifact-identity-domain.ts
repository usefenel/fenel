/** C2 exact identity-domain framing. This does not select semantic dependencies.
 * Scope rows come from the Fenel-owned selector and a separately reviewed plan.
 */
import { encodeCanonicalJson, expectClosedKeys, expectSha256, expectWireLiteral,
  expectWireRecord } from "./artifact-wire-json";
import type { CompiledArtifactId } from "./artifact-bytes";

export type CompiledIdentityDomain = Readonly<{
  schema: "fenel.compiled-identity-input.v1"; owner: CompiledArtifactId;
  kind: "all"; digest: string;
}> | Readonly<{
  schema: "fenel.compiled-identity-input.v1"; owner: CompiledArtifactId;
  kind: "owner"; digest: string; policyDigest: string; anchorDigest: string; finitePlanDigest: string;
}>;
export type CurrentCompiledIdentityInputs = Readonly<{
  /** Caller chooses this from its parser/resolver coordinate, never the artifact. */
  owner: CompiledArtifactId;
  fullDigest: string;
  scope?: Readonly<{ digest: string; policyDigest: string; anchorDigest: string; finitePlanDigest: string }>;
}>;
export type ResolvedCompiledIdentityDomain = Readonly<{
  domain: CompiledIdentityDomain; digest: string; cacheIdentity: string;
}>;
export type CompiledOwnerIdentityScope = Readonly<{
  schema: "fenel.owner-identity-scope.v1"; owner: CompiledArtifactId;
  digest: string; policyDigest: string; anchorDigest: string; finitePlanDigest: string;
}>;

function ownDataCarrier(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("identity domain is missing or unreadable");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("identity domain has an exotic prototype");
  const copied: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new Error("identity domain has a symbol key");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) throw new Error("identity domain has an accessor");
    copied[key] = descriptor.value;
  }
  return copied;
}

/** Inert generated scope rows are framed separately from runtime domains.
 * Coordinate is checked against the caller-selected manifest slot as well as
 * the artifact carrier, so a parser cannot select a resolver projection.
 */
export function decodeCompiledOwnerIdentityScope(value: unknown, expectedOwner: CompiledArtifactId): CompiledOwnerIdentityScope {
  const path = "$compilerScope";
  const row = expectWireRecord(ownDataCarrier(value), path);
  expectClosedKeys(row, ["schema", "owner", "digest", "policyDigest", "anchorDigest", "finitePlanDigest"], [], path);
  expectWireLiteral(row.schema, ["fenel.owner-identity-scope.v1"], path + ".schema");
  expectWireLiteral(row.owner, [expectedOwner], path + ".owner");
  return Object.freeze({ schema: "fenel.owner-identity-scope.v1", owner: expectedOwner,
    digest: expectSha256(row.digest, path + ".digest"), policyDigest: expectSha256(row.policyDigest, path + ".policyDigest"),
    anchorDigest: expectSha256(row.anchorDigest, path + ".anchorDigest"),
    finitePlanDigest: expectSha256(row.finitePlanDigest, path + ".finitePlanDigest") });
}

// Private evidence for decoder-created, frozen own-scalar shapes only: scalar
// validation and current freshness still run. Captured trusted realm primitives
// keep callbacks from substituting provenance operations. Unknown objects,
// proxies and copies retain the complete shape check.
const decodedIdentityDomains = new WeakSet<object>();
const decoderHas = decodedIdentityDomains.has.bind(decodedIdentityDomains);
const decoderRemember = decodedIdentityDomains.add.bind(decodedIdentityDomains);
const decoderFreeze = Object.freeze;
const decoderIsFrozen = Object.isFrozen;
const decoderApply = Reflect.apply;
export function decodeCompiledIdentityDomain(value: unknown, expectedOwner: CompiledArtifactId): CompiledIdentityDomain {
  const path = "$identityDomain";
  const produced = value !== null && typeof value === "object" && decoderHas(value);
  const row = produced ? value as ReturnType<typeof expectWireRecord> : expectWireRecord(ownDataCarrier(value), path);
  const kind = expectWireLiteral(row.kind, ["all", "owner"], path + ".kind");
  const keys = ["schema", "owner", "kind", "digest"];
  if (!produced) expectClosedKeys(row, kind === "all" ? keys : [...keys, "policyDigest", "anchorDigest", "finitePlanDigest"], [], path);
  expectWireLiteral(row.schema, ["fenel.compiled-identity-input.v1"], path + ".schema");
  expectWireLiteral(row.owner, [expectedOwner], path + ".owner");
  const base = { schema: "fenel.compiled-identity-input.v1" as const, owner: expectedOwner,
    digest: expectSha256(row.digest, path + ".digest") };
  const freezeReceiver = Object;
  const freeze = freezeReceiver.freeze;
  const literal = kind === "all" ? { ...base, kind } : { ...base, kind,
    policyDigest: expectSha256(row.policyDigest, path + ".policyDigest"),
    anchorDigest: expectSha256(row.anchorDigest, path + ".anchorDigest"),
    finitePlanDigest: expectSha256(row.finitePlanDigest, path + ".finitePlanDigest") };
  const decoded = decoderApply(freeze, freezeReceiver, [literal]);
  if (freeze === decoderFreeze && decoded === literal && decoderIsFrozen(literal)) decoderRemember(literal);
  return decoded as CompiledIdentityDomain;
}

// C2/B3 bounded text reuse only. No carrier/current/registry verdict is cached.
// Keys contain already-decoded scalars; this JSON tuple is only a lookup key,
// never the identity wire format. First misses retain the canonical codec.
const canonicalIdentityTextCache = new Map<string, string>();
const CANONICAL_IDENTITY_TEXT_CACHE_LIMIT = 32;
const CANONICAL_IDENTITY_TEXT_CACHE_MAX_CHARS = 2048;
function canonicalIdentityText(domain: CompiledIdentityDomain): string {
  const key = JSON.stringify([domain.schema, domain.owner, domain.kind, domain.digest,
    domain.kind === "owner" ? domain.policyDigest : null,
    domain.kind === "owner" ? domain.anchorDigest : null,
    domain.kind === "owner" ? domain.finitePlanDigest : null]);
  if (key.length <= CANONICAL_IDENTITY_TEXT_CACHE_MAX_CHARS) {
    const cached = canonicalIdentityTextCache.get(key);
    if (cached !== undefined) return cached;
  }
  const text = new TextDecoder().decode(encodeCanonicalJson(domain));
  if (key.length <= CANONICAL_IDENTITY_TEXT_CACHE_MAX_CHARS
    && text.length <= CANONICAL_IDENTITY_TEXT_CACHE_MAX_CHARS) {
    if (canonicalIdentityTextCache.size >= CANONICAL_IDENTITY_TEXT_CACHE_LIMIT) {
      const oldest = canonicalIdentityTextCache.keys().next().value;
      if (oldest !== undefined) canonicalIdentityTextCache.delete(oldest);
    }
    canonicalIdentityTextCache.set(key, text);
  }
  return text;
}

/** Invoke BEFORE every hash-null/browser-trust or namespace-cache fast path.
 * Missing/malformed legacy carriers refuse; migration requires a real render.
 * Full digests remain in all registry/kind/type/catalogue/replay contracts.
 */
export function resolveCompiledIdentityDomain(value: unknown,
  current: CurrentCompiledIdentityInputs): ResolvedCompiledIdentityDomain {
  const domain = decodeCompiledIdentityDomain(value, current.owner);
  if (domain.kind === "all") {
    if (domain.digest !== current.fullDigest) throw new Error("full identity domain is stale");
  } else {
    const scope = current.scope;
    if (scope === undefined || domain.digest !== scope.digest || domain.policyDigest !== scope.policyDigest
      || domain.anchorDigest !== scope.anchorDigest || domain.finitePlanDigest !== scope.finitePlanDigest) {
      throw new Error("owner identity domain lacks its exact current reviewed scope");
    }
  }
  return Object.freeze({ domain, digest: domain.digest,
    cacheIdentity: canonicalIdentityText(domain) });
}

export function resolveCompiledIdentityDomainFamily(common: unknown, shardDomains: readonly unknown[],
  current: CurrentCompiledIdentityInputs): ResolvedCompiledIdentityDomain {
  const resolved = resolveCompiledIdentityDomain(common, current);
  if (!Array.isArray(shardDomains) || Object.getPrototypeOf(shardDomains) !== Array.prototype) throw new Error("shard domains are not an ordinary array");
  const descriptors = Object.getOwnPropertyDescriptors(shardDomains);
  const lengthSlot = Object.getOwnPropertyDescriptor(descriptors, "length")?.value as PropertyDescriptor | undefined;
  const length = lengthSlot !== undefined && Object.hasOwn(lengthSlot, "value") ? lengthSlot.value : undefined;
  if (!Number.isSafeInteger(length) || length < 0 || Reflect.ownKeys(descriptors).length !== length + 1) throw new Error("shard domains are not dense closed own data");
  // Never consume an artifact-provided iterator: it could hide a mismatch.
  for (let index = 0; index < length; index++) {
    const slot = Object.getOwnPropertyDescriptor(descriptors, String(index))?.value as PropertyDescriptor | undefined;
    if (slot === undefined || !Object.hasOwn(slot, "value")) throw new Error("shard domain is missing or accessor-backed");
    if (resolveCompiledIdentityDomain(slot.value, current).cacheIdentity !== resolved.cacheIdentity) {
      throw new Error("common/shard identity domains disagree");
    }
  }
  return resolved;
}

/** B3 framing for the generated data-as-code boundary. The expected owner
 * determines the export names; artifact data cannot choose a manifest scope.
 * Check ALL own shard carriers before any consumer reaches a cache/browser
 * fast path. Missing legacy carriers deliberately have no implicit default.
 */
export function resolveGeneratedCompiledIdentityDomain(generated: object,
  current: CurrentCompiledIdentityInputs): ResolvedCompiledIdentityDomain {
  const prefix = current.owner === "compiled-parser" ? "PARSER" : "RESOLVER";
  const ownValue = (object: object, key: string): unknown => {
    const slot = Object.getOwnPropertyDescriptor(object, key);
    if (slot === undefined || !Object.hasOwn(slot, "value")) throw new Error("generated identity metadata is missing or accessor-backed");
    return slot.value;
  };
  const common = ownValue(generated, `${prefix}_IDENTITY_DOMAIN`);
  const table = ownValue(generated, `${prefix}_SHARDS`);
  if (table === null || typeof table !== "object" || Array.isArray(table)) throw new Error("generated shard table is unreadable");
  const prototype = Object.getPrototypeOf(table);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("generated shard table has an exotic prototype");
  const domains: unknown[] = [];
  for (const key of Reflect.ownKeys(table)) {
    if (typeof key !== "string") throw new Error("generated shard table has a symbol key");
    const row = ownValue(table, key);
    if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error("generated shard row is unreadable");
    domains.push(ownValue(row, "identityDomain"));
  }
  return resolveCompiledIdentityDomainFamily(common, domains, current);
}
