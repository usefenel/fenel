// Machine-generated repository identity data, exposed through a browser-safe
// leaf. The JSON contains inert name/UUID pairs only: no filesystem reader,
// resolver, classifier, or policy. Regenerate with the identity manifest tool.
import manifestJson from "./generated/repository-identity-manifest.json";

export type RepositoryIdentityManifest = {
  readonly schemaVersion: 1;
  readonly digest: string;
  readonly requiredCount: number;
  readonly physicalCount: number;
  readonly entries: readonly (readonly [
    name: string,
    id: string,
    kind: "function" | "type" | "field" | "reserved",
  ])[];
  /** The owner-keyed type rows as (owner, name, lock key), the key computed
   * by the Fenel codec when the manifest was generated. */
  readonly types: readonly (readonly [owner: string, name: string, key: string])[];
};

const raw = manifestJson as unknown as RepositoryIdentityManifest;
const frozenEntries = Object.freeze(
  raw.entries.map((entry) => Object.freeze([...entry]) as typeof entry),
);
// A manifest written before the projection existed has no `types`; the lock
// generator (which imports this module) rewrites it, and its `--check` fails
// on the stale artifact.
const frozenTypes = Object.freeze(
  (raw.types ?? []).map((row) => Object.freeze([...row]) as typeof row),
);
export const REPOSITORY_IDENTITY_MANIFEST: RepositoryIdentityManifest =
  Object.freeze({ ...raw, entries: frozenEntries, types: frozenTypes });

let typeIdentityIndex: Map<string, string> | undefined;
/** The repository UUID of the type `name` declared by `owner` (`system` for a
 * system declaration), or undefined when that declaration holds no type row.
 * Reads the generated (owner, name, key) projection: no key format is
 * re-spelled outside the Fenel codec, and no registry is built. */
export function repositoryTypeIdentity(owner: string, name: string): string | undefined {
  if (typeIdentityIndex === undefined) {
    const idByKey = new Map(REPOSITORY_IDENTITY_MANIFEST.entries.map(([key, id]) => [key, id]));
    typeIdentityIndex = new Map();
    for (const [typeOwner, typeName, key] of REPOSITORY_IDENTITY_MANIFEST.types) {
      const id = idByKey.get(key);
      if (id !== undefined) typeIdentityIndex.set(JSON.stringify([typeOwner, typeName]), id);
    }
  }
  return typeIdentityIndex.get(JSON.stringify([owner, name]));
}

/** A fresh mutable index for one registry. No registry shares its maps. */
export function repositoryIdentityLock(): Map<string, string> {
  return new Map(
    REPOSITORY_IDENTITY_MANIFEST.entries.map(([name, id]) => [name, id]),
  );
}

/** UUID→identity kind/reservation. `reserved` is intentionally retained so an
 * account UUID cannot claim a physical tombstone. It still is not a live field
 * entity; that proof comes only from a declaration or external field catalog. */
export function repositoryIdentityKinds(): Map<string, string> {
  const kinds = new Map<string, string>();
  for (const [, id, kind] of REPOSITORY_IDENTITY_MANIFEST.entries) {
    const prior = kinds.get(id);
    if (prior !== undefined && prior !== kind) {
      throw new Error(
        `repository identity manifest: UUID ${id} has conflicting kinds ${prior}/${kind}`,
      );
    }
    kinds.set(id, kind);
  }
  return kinds;
}
