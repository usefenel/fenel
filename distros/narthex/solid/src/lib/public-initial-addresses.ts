// Display-only record of the checked public root's own addresses.
//
// A public deep link (`/demo/Tree of life/Tree of life`) names data that the
// bundled public snapshot already holds, but member matching belongs to the
// Fenel address owner (fenel/modules/view/address.fenel), which a page reaches
// only through its worker. The build tool therefore records that owner's own
// answers, through the existing resolver, for the names the root itself shows
// (public-initial-address-projection.ts). This module admits that record and
// reads it back by exact equality of the decoded segments. It holds no
// matching rule and accepts no address: the surface uses an answer only to
// choose what its initial preview shows while the worker resolves the same
// address, and that resolution alone focuses a lens.
import type { LocusRootData } from "./locus-root-data";
import type { LocusScope } from "./locus-scope";

export const PUBLIC_INITIAL_ADDRESSES_SCHEMA = "fenel.public-initial-addresses.v1";

export type PublicInitialAddress = { segments: readonly string[]; focus: LocusScope };

/** Build-owned answers of the address owner over one checked public root. */
export type PublicInitialAddresses = {
  schema: typeof PUBLIC_INITIAL_ADDRESSES_SCHEMA;
  sourceDigest: string;
  identityDigest: string;
  rootId: string;
  entries: readonly PublicInitialAddress[];
};

export type PublicInitialAddressIndex = ReadonlyMap<string, LocusScope>;

/** Exact transport equality of decoded segments; no folding, trimming or alias. */
export function publicInitialAddressKey(segments: readonly string[]): string {
  return JSON.stringify(segments);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The one place a row may name: inside one unlisted item of this exact root,
 * one record field per further segment, spelled as that segment. A list row, a
 * position, an identity step or another root is refused. */
export function admittedPublicInitialFocus(root: LocusRootData, segments: readonly string[], focus: unknown): LocusScope | undefined {
  if (!plainRecord(focus) || Object.keys(focus).sort().join() !== "itemId,kind,path,rootItem,viewId") return undefined;
  const { kind, viewId, itemId, path, rootItem } = focus;
  if (kind !== "value" || rootItem !== true || viewId !== root.id || typeof itemId !== "string"
    || !root.items.some(item => item.id === itemId) || root.lists.some(row => row.id === itemId)
    || !Array.isArray(path) || path.length !== segments.length - 1
    || !path.every((step, index) => typeof step === "string" && step !== "" && step === segments[index + 1])) return undefined;
  const steps: readonly string[] = Object.freeze(path.map(step => String(step)));
  return Object.freeze({ kind: "value" as const, viewId: root.id, itemId, path: steps, rootItem: true });
}

/** Admit a whole record or none of it. An absent, foreign or malformed record
 * only means no early page: the address then opens as it always did. */
export function admitPublicInitialAddresses(root: LocusRootData, record: unknown,
  expected: { sourceDigest: string; identityDigest: string }): PublicInitialAddressIndex | undefined {
  if (root.canEdit !== false || root.persisted || !plainRecord(record)
    || record.schema !== PUBLIC_INITIAL_ADDRESSES_SCHEMA || record.sourceDigest !== expected.sourceDigest
    || record.identityDigest !== expected.identityDigest || record.rootId !== root.id || !Array.isArray(record.entries)) return undefined;
  const index = new Map<string, LocusScope>();
  for (const entry of record.entries as unknown[]) {
    if (!plainRecord(entry) || !Array.isArray(entry.segments) || entry.segments.length === 0
      || !entry.segments.every(segment => typeof segment === "string" && segment !== "")) return undefined;
    const segments = entry.segments as string[];
    const focus = admittedPublicInitialFocus(root, segments, entry.focus);
    const key = publicInitialAddressKey(segments);
    // One unreadable or repeated row refuses the record: it is never partly trusted.
    if (!focus || index.has(key)) return undefined;
    index.set(key, focus);
  }
  return index;
}
