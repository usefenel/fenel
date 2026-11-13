// perf 2026-11-01 (harness §8): the compiled parser/resolver gates resolve the
// generated identity domain on every call. The per-realm cache of that
// RESOLUTION must answer exactly what the uncached resolution answers: a hit
// only for the same generated module, the same identity carriers (read each
// call) and the same current inputs (full digest and reviewed scope digests,
// read each call); any change misses (and a stale input still throws).
import { describe, expect, test } from "bun:test";

import * as resolverArtifact from "./generated/compiled-resolver.generated";
import {
  currentCompiledIdentityInputs,
  resolveGeneratedCompiledIdentityDomainCached,
  resolveGeneratedRepositoryCompiledIdentityDomain,
} from "./repository-compiled-identity-domain";
import {
  decodeCompiledOwnerIdentityScope,
  resolveGeneratedCompiledIdentityDomain,
  type CurrentCompiledIdentityInputs,
} from "../scripts/lib/compiled-artifact-identity-domain";

const D = (c: string) => c.repeat(64);

function allDomain(digest: string) {
  return Object.freeze({ schema: "fenel.compiled-identity-input.v1", owner: "compiled-resolver", kind: "all", digest });
}
function ownerDomain(digest: string, policyDigest: string, anchorDigest: string, finitePlanDigest: string) {
  return Object.freeze({ schema: "fenel.compiled-identity-input.v1", owner: "compiled-resolver", kind: "owner",
    digest, policyDigest, anchorDigest, finitePlanDigest });
}
function frozenGenerated(domain: object): object {
  const shards = Object.freeze(Object.assign(Object.create(null), {
    "dispatch:a": Object.freeze({ identityDomain: domain }),
    "dispatch:b": Object.freeze({ identityDomain: domain }),
  }));
  return Object.freeze({ RESOLVER_IDENTITY_DOMAIN: domain, RESOLVER_SHARDS: shards });
}
const full = (fullDigest: string): CurrentCompiledIdentityInputs =>
  Object.freeze({ owner: "compiled-resolver", fullDigest });
const scoped = (scope: { digest: string; policyDigest: string; anchorDigest: string; finitePlanDigest: string }):
  CurrentCompiledIdentityInputs => Object.freeze({ owner: "compiled-resolver", fullDigest: D("f"), scope: Object.freeze(scope) });

function observeWithInheritedDescriptorValue(inherited: PropertyDescriptor, operation: () => unknown) {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let result: unknown, error: unknown;
  Object.defineProperty(Object.prototype, "value", Object.assign(Object.create(null), inherited, { configurable: true }));
  try { result = operation(); } catch (caught) { error = caught; }
  finally {
    if (previous === undefined) delete (Object.prototype as { value?: unknown }).value;
    else Object.defineProperty(Object.prototype, "value", Object.assign(Object.create(null), previous));
  }
  return { result, error };
}

// Source-execute the existing current-input projector against a controlled
// manifest; the production manifest's top-level slots are already frozen.
const repositorySource = await Bun.file(new URL("./repository-compiled-identity-domain.ts", import.meta.url)).text();
const currentInputsCode = new Bun.Transpiler({ loader: "ts" }).transformSync(repositorySource.slice(
  repositorySource.indexOf("export function currentCompiledIdentityInputs("),
  repositorySource.indexOf("export function allCompiledIdentityDomain(")).replace(/^export /gm, ""));
const currentInputsForManifest = new Function("REPOSITORY_IDENTITY_MANIFEST", "REVIEWED_OWNER_IDENTITY_ANCHORS",
  "decodeCompiledOwnerIdentityScope", currentInputsCode + "; return currentCompiledIdentityInputs;");

describe("generated identity-domain resolution cache", () => {
  test("the checked-in resolver: equal to the uncached resolution, and a hit on repeat", () => {
    const uncached = resolveGeneratedCompiledIdentityDomain(resolverArtifact, currentCompiledIdentityInputs("compiled-resolver"));
    const first = resolveGeneratedRepositoryCompiledIdentityDomain(resolverArtifact, "compiled-resolver");
    expect(first).toEqual(uncached);
    expect(Object.isFrozen(first)).toBe(true);
    expect(resolveGeneratedRepositoryCompiledIdentityDomain(resolverArtifact, "compiled-resolver")).toBe(first);
  });

  test("equal inputs hit; a changed full digest misses (and is refused), then hits again", () => {
    const generated = frozenGenerated(allDomain(D("a")));
    const first = resolveGeneratedCompiledIdentityDomainCached(generated, full(D("a")));
    expect(first).toEqual(resolveGeneratedCompiledIdentityDomain(generated, full(D("a"))));
    expect(resolveGeneratedCompiledIdentityDomainCached(generated, full(D("a")))).toBe(first);
    expect(() => resolveGeneratedCompiledIdentityDomainCached(generated, full(D("b")))).toThrow("full identity domain is stale");
    expect(resolveGeneratedCompiledIdentityDomainCached(generated, full(D("a")))).toEqual(first);
  });

  test("each changed scope digest misses (and is refused)", () => {
    const scope = { digest: D("1"), policyDigest: D("2"), anchorDigest: D("3"), finitePlanDigest: D("4") };
    const generated = frozenGenerated(ownerDomain(scope.digest, scope.policyDigest, scope.anchorDigest, scope.finitePlanDigest));
    const first = resolveGeneratedCompiledIdentityDomainCached(generated, scoped(scope));
    expect(first).toEqual(resolveGeneratedCompiledIdentityDomain(generated, scoped(scope)));
    expect(resolveGeneratedCompiledIdentityDomainCached(generated, scoped({ ...scope }))).toBe(first);
    for (const key of ["digest", "policyDigest", "anchorDigest", "finitePlanDigest"] as const) {
      expect(() => resolveGeneratedCompiledIdentityDomainCached(generated, scoped({ ...scope, [key]: D("9") })))
        .toThrow("owner identity domain lacks its exact current reviewed scope");
    }
    expect(() => resolveGeneratedCompiledIdentityDomainCached(generated, full(D("f"))))
      .toThrow("owner identity domain lacks its exact current reviewed scope");
    expect(resolveGeneratedCompiledIdentityDomainCached(generated, scoped(scope))).toEqual(first);
  });

  test("a replaced identity carrier or a mutable shard table is re-read every call", () => {
    const generated: Record<string, unknown> = { ...frozenGenerated(allDomain(D("a"))) };
    const first = resolveGeneratedCompiledIdentityDomainCached(generated, full(D("a")));
    expect(resolveGeneratedCompiledIdentityDomainCached(generated, full(D("a")))).toBe(first);
    // The common domain slot now names another digest: re-resolved, refused.
    generated["RESOLVER_IDENTITY_DOMAIN"] = allDomain(D("c"));
    expect(() => resolveGeneratedCompiledIdentityDomainCached(generated, full(D("a")))).toThrow("full identity domain is stale");
    // ... and its shards still name the old one.
    expect(() => resolveGeneratedCompiledIdentityDomainCached(generated, full(D("c")))).toThrow("full identity domain is stale");
    // A replaced (frozen) shard table whose rows name another digest, beside
    // the cached common carrier: re-resolved, refused.
    const tabled: Record<string, unknown> = { ...frozenGenerated(allDomain(D("a"))) };
    const cachedTable = resolveGeneratedCompiledIdentityDomainCached(tabled, full(D("a")));
    expect(resolveGeneratedCompiledIdentityDomainCached(tabled, full(D("a")))).toBe(cachedTable);
    tabled["RESOLVER_SHARDS"] = (frozenGenerated(allDomain(D("e"))) as Record<string, unknown>)["RESOLVER_SHARDS"];
    expect(() => resolveGeneratedCompiledIdentityDomainCached(tabled, full(D("a")))).toThrow("full identity domain is stale");
    // A mutable shard table is never cached: a row changed in place is seen.
    const domain = allDomain(D("c"));
    const rows: Record<string, unknown> = { "dispatch:a": Object.freeze({ identityDomain: domain }) };
    generated["RESOLVER_IDENTITY_DOMAIN"] = domain;
    generated["RESOLVER_SHARDS"] = rows;
    const mutable = resolveGeneratedCompiledIdentityDomainCached(generated, full(D("c")));
    expect(mutable).toEqual(resolveGeneratedCompiledIdentityDomain(generated, full(D("c"))));
    rows["dispatch:b"] = Object.freeze({ identityDomain: allDomain(D("d")) });
    expect(() => resolveGeneratedCompiledIdentityDomainCached(generated, full(D("c")))).toThrow("full identity domain is stale");
  });

  test("an owner mismatch is never answered from another owner's entry", () => {
    const generated = frozenGenerated(allDomain(D("a")));
    resolveGeneratedCompiledIdentityDomainCached(generated, full(D("a")));
    expect(() => resolveGeneratedCompiledIdentityDomainCached(generated,
      Object.freeze({ owner: "compiled-parser", fullDigest: D("a") }))).toThrow();
  });

  test("warm cache admission refuses accessor replacements despite inherited descriptor values", () => {
    for (const key of ["RESOLVER_IDENTITY_DOMAIN", "RESOLVER_SHARDS"] as const) {
      for (const throwingInheritedGetter of [false, true]) {
        const generated: Record<string, unknown> = { ...frozenGenerated(allDomain(D("a"))) };
        const inherited = generated[key];
        const first = resolveGeneratedCompiledIdentityDomainCached(generated, full(D("a")));
        expect(resolveGeneratedCompiledIdentityDomainCached(generated, full(D("a")))).toBe(first);
        let carrierReads = 0, inheritedReads = 0;
        Object.defineProperty(generated, key, { get() { carrierReads++; return inherited; } });
        const input = full(D("a"));
        const observed = observeWithInheritedDescriptorValue(throwingInheritedGetter
          ? { get() { inheritedReads++; throw new Error("inherited descriptor getter"); } }
          : { value: inherited }, () => resolveGeneratedCompiledIdentityDomainCached(generated, input));
        expect(observed.error).toBeInstanceOf(Error);
        expect((observed.error as Error).message).toBe("generated identity metadata is missing or accessor-backed");
        expect(carrierReads).toBe(0); expect(inheritedReads).toBe(0);
      }
    }
  });

  test("current scope observations ignore accessor slots without inherited descriptor reads", () => {
    for (const slotKind of ["table", "scope"] as const) for (const throwingInheritedGetter of [false, true]) {
      const domain = { schema: "fenel.owner-identity-scope.v1", owner: "compiled-resolver",
        digest: D("a"), policyDigest: D("b"), anchorDigest: D("c"), finitePlanDigest: D("d") };
      const table = { "compiled-resolver": domain };
      const manifest = { digest: D("f"), compilerScopes: table };
      let carrierReads = 0, inheritedReads = 0, decodes = 0;
      const readCurrent = currentInputsForManifest(manifest, Object.freeze({}), (...args: Parameters<typeof decodeCompiledOwnerIdentityScope>) => {
        decodes++; return decodeCompiledOwnerIdentityScope(...args);
      }) as typeof currentCompiledIdentityInputs;
      // Calibrate the decoder observation on an ordinary own-data scope.
      expect(readCurrent("compiled-resolver")).toEqual(full(D("f")));
      expect(decodes).toBe(1); decodes = 0;
      const [carrier, key, inherited] = slotKind === "table"
        ? [manifest, "compilerScopes", table] as const : [table, "compiled-resolver", domain] as const;
      Object.defineProperty(carrier, key, { get() { carrierReads++; return inherited; } });
      const observed = observeWithInheritedDescriptorValue(throwingInheritedGetter
        ? { get() { inheritedReads++; throw new Error("inherited descriptor getter"); } }
        : { value: inherited }, () => readCurrent("compiled-resolver"));
      expect(observed.error).toBeUndefined();
      expect(observed.result).toEqual(full(D("f")));
      expect(carrierReads).toBe(0); expect(inheritedReads).toBe(0); expect(decodes).toBe(0);
    }
  });
});
