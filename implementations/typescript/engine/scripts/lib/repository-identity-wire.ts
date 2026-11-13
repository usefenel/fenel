/** C2 wire construction/validation moved unchanged from generate-codename-lock.
 * No source-profile collection, registry construction, minting or adoption.
 */
import { createHash } from "node:crypto";

export type IdentityKind = "function" | "type" | "field" | "reserved";
export type ManifestRow = readonly [name: string, id: string, kind: IdentityKind];
/** One owner-keyed type row as data: the declaring owner, the type name and
 * the lock key the Fenel codec (`engine:typeIdentityLockKeys`) gave them. A
 * reader that cannot run Fenel (a browser worker, a node fixture) finds a
 * type's identity by (owner, name) through this projection instead of
 * re-spelling the key format. */
export type TypeDeclarationRow = readonly [owner: string, name: string, key: string];
export type Manifest = {
  schemaVersion: 1;
  digest: string;
  requiredCount: number;
  physicalCount: number;
  entries: ManifestRow[];
  types: TypeDeclarationRow[];
};

export function compareName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function manifestFor(
  physical: ReadonlyMap<string, string>,
  requiredKinds: ReadonlyMap<string, Exclude<IdentityKind, "reserved">>,
  typeNames: ReadonlySet<string> = new Set(),
  typeDeclarations: readonly TypeDeclarationRow[] = [],
): Manifest {
  for (const [name, kind] of requiredKinds) {
    if (kind === "type" && typeNames.has(name)) {
      throw new Error(
        `repository identity: bare type requirement ${JSON.stringify(name)}; ` +
        "a type row is keyed by its owner (type/module/<owner>/<Name>)",
      );
    }
  }
  for (const name of typeNames) {
    if (physical.has(name)) {
      throw new Error(
        `repository identity: retired bare type row ${JSON.stringify(name)} is still in the lock; ` +
        "per-owner type rows replace it",
      );
    }
  }
  // One live key per UUID: after an in-place re-key no alias of a live row
  // may survive, or it would read as live again.
  const keyCountById = new Map<string, number>();
  for (const id of physical.values()) keyCountById.set(id, (keyCountById.get(id) ?? 0) + 1);
  for (const name of requiredKinds.keys()) {
    const id = physical.get(name);
    const count = id === undefined ? 0 : keyCountById.get(id) ?? 0;
    if (count > 1) {
      throw new Error(
        `repository identity: live UUID ${id} (${JSON.stringify(name)}) sits under ${count} keys; ` +
        "one live key per UUID",
      );
    }
  }
  const liveKindById = new Map<string, Exclude<IdentityKind, "reserved">>();
  for (const [name, kind] of requiredKinds) {
    const id = physical.get(name);
    if (id === undefined) continue;
    const prior = liveKindById.get(id);
    if (prior !== undefined && prior !== kind) {
      throw new Error(
        `repository identity: UUID ${id} is live as both ${prior} and ${kind}`,
      );
    }
    liveKindById.set(id, kind);
  }
  const entries: ManifestRow[] = [...physical]
    .sort(([a], [b]) => compareName(a, b))
    .map(([name, id]) => [name, id, liveKindById.get(id) ?? "reserved"] as const);
  const declaredKeys = new Set<string>();
  for (const [owner, name, key] of typeDeclarations) {
    if (requiredKinds.get(key) !== "type" || !physical.has(key)) {
      throw new Error(
        `repository identity: type declaration ${owner}.${name} names ${JSON.stringify(key)}, which is no live type row`,
      );
    }
    if (declaredKeys.has(key)) {
      throw new Error(`repository identity: type row ${JSON.stringify(key)} is declared twice`);
    }
    declaredKeys.add(key);
  }
  const types: TypeDeclarationRow[] = [...typeDeclarations]
    .sort(([, , a], [, , b]) => compareName(a, b))
    .map((row) => [row[0], row[1], row[2]] as const);
  const projection = entries.map(([name, id]) => [name, id]);
  const digest = createHash("sha256")
    .update(JSON.stringify(projection), "utf8")
    .digest("hex");
  return {
    schemaVersion: 1,
    digest,
    requiredCount: requiredKinds.size,
    physicalCount: entries.length,
    entries,
    types,
  };
}
