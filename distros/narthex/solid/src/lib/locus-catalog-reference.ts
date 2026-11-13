/** Catalog links use Fenel's existing reference value. Legacy pin records are
 * accepted at the read boundary; every new reference has only the $ref field. */
export type LocusCatalogReferenceValue =
  | { readonly $ref: string }
  | { readonly $pin: string; readonly id: string; readonly name?: string };

/** A lookup request, never a persisted value. The legacy kind/name are hints;
 * only the caller's current account registry can identify the referent. */
export type LocusCatalogReference = { readonly id: string; readonly kind?: string; readonly name?: string };
export type LocusCatalogTarget = {
  readonly value: unknown; readonly kind: string; readonly name?: string;
  /** A Type owner's ordinary callable projection, for existing Call actions. */
  readonly callable?: unknown;
};
export type LocusCatalogResolver = (reference: LocusCatalogReference) => LocusCatalogTarget | undefined;
/** Temporary display props for existing cards, never a new reference carrier. */
export type LocusCatalogCard = { readonly $pin: string; readonly id: string; readonly name: string };

function ownString(value: object, field: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" && descriptor.value.length > 0
    ? descriptor.value : undefined;
}

export function readLocusCatalogReference(value: unknown): LocusCatalogReference | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const handle = ownString(value, "$ref");
  // Applied type forms and records containing a $ref field carry more data;
  // opening one must not silently discard those additional fields.
  if (handle && Object.keys(value).length === 1) return { id: handle };
  const kind = ownString(value, "$pin");
  const id = ownString(value, "id");
  if (!kind || !id || Object.hasOwn(value, "$ref")) return undefined;
  const name = ownString(value, "name");
  return name ? { id, kind, name } : { id, kind };
}

export function isLocusCatalogReference(value: unknown): value is LocusCatalogReferenceValue {
  return readLocusCatalogReference(value) !== undefined;
}

export function locusCatalogReference(id: string): { $ref: string } {
  if (!id) throw new Error("A reference needs an identifier.");
  return { $ref: id };
}

/** Keep display classification separate from the saved Ref. Canonical refs
 * have no kind field to guess from; unavailable targets get no invented card. */
export function locusCatalogReferenceMetadata(value: unknown, resolve: LocusCatalogResolver): LocusCatalogCard | undefined {
  const reference = readLocusCatalogReference(value);
  if (!reference) return undefined;
  const target = resolve(reference);
  if (!target) return undefined;
  return { $pin: target.kind, id: reference.id, name: target.name ?? reference.name ?? reference.id };
}

/** The tables one account can answer from: its committed registry and the
 * catalog projected from it. The caller binds them, so resolution never
 * reaches outside the session's account. */
export type LocusCatalogLookups = {
  readonly fn: (id: string) => unknown;
  /** Owner evidence from the same captured registry as fn. A type family's
   * callable projection keeps the type's identity and writable definition. */
  readonly typeFamilyOwner?: (id: string) => {
    readonly identity: string;
    readonly type: unknown;
    readonly typeScheme?: { readonly quantified: readonly unknown[] };
  } | undefined;
  readonly entry: (id: string) => {
    readonly fn?: unknown;
    readonly entity?: { readonly id?: string; readonly type?: unknown };
    readonly typeclass?: unknown;
    readonly typeCtor?: unknown;
  } | undefined;
  readonly entityType: (name: string) => unknown;
  /** B4 F2 (Local): the identified entity's id and nominal identity, from
   * the same captured registry as `entityType`. */
  readonly entityOwner?: (name: string) => { readonly id: string; readonly nominalIdentity?: string } | undefined;
  /** The type a catalog-only entry (an atom, a format, a unit) stands for,
   *  when it is neither an entity nor a class. */
  readonly catalogType?: (id: string) => unknown;
};

/** What a reference names in one account. A canonical Ref has no kind, so it
 * resolves functions before types unless the function is the same type
 * owner's derived callable projection. Editing then follows that type owner;
 * invocation continues through the ordinary function lookup. */
export function resolveLocusCatalogReference(
  reference: LocusCatalogReference,
  lookups: LocusCatalogLookups,
): LocusCatalogTarget | undefined {
  const { id, kind } = reference;
  if (kind === undefined || kind === "function") {
    const fn = lookups.fn(id) ?? lookups.entry(id)?.fn;
    if (fn !== undefined) {
      const owner = lookups.typeFamilyOwner?.(id);
      if (owner?.typeScheme?.quantified.length && fn !== null && typeof fn === "object"
        && ownString(fn, "id") === owner.identity) return { value: owner.type, kind: "type", callable: fn };
      return { value: fn, kind: "function" };
    }
    if (kind === "function") return undefined;
  }
  if (kind === undefined) {
    const type = lookups.entry(`entity:${id}`)?.entity?.type ?? lookups.entityType(id);
    return type === undefined ? undefined : { value: type, kind: "type" };
  }
  const entry = lookups.entry(id) ?? lookups.entry(`entity:${id}`);
  const value = entry?.entity?.type ?? entry?.typeclass ?? entry?.typeCtor
    ?? (entry?.entity?.id === undefined ? undefined : lookups.entityType(entry.entity.id))
    ?? (entry === undefined ? undefined : lookups.catalogType?.(id))
    ?? lookups.entityType(id.startsWith("entity:") ? id.slice("entity:".length) : id);
  return value === undefined ? undefined : { value, kind };
}

/** A catalog address as a drag, a shell action or a catalog row carries it. */
export type LocusCatalogAddress = { readonly kind: string; readonly id: string; readonly name?: string };

/** The handle Fenel itself resolves for an address: a function's id, or a
 * type's bare name. A module-qualified entity, a typeclass, a constructor or a
 * format has no such handle, because a bare name could name something else. */
function canonicalHandle(address: LocusCatalogAddress, lookups: LocusCatalogLookups): string | undefined {
  if (address.kind === "function") return address.id || undefined;
  if (address.kind !== "entity" && address.kind !== "type") return undefined;
  // A catalog key such as "color" names the entity `Color`: use its own name.
  const name = lookups.entry(address.id)?.entity?.id
    ?? (address.id.startsWith("entity:") ? address.id.slice("entity:".length) : address.id);
  return name && !name.includes(".") && !name.includes(":") ? name : undefined;
}

/** The value a newly authored catalog reference stores. It is the canonical
 * Ref only when its handle resolves, in this account, to the very referent the
 * address names; otherwise the address keeps the legacy pin carrier, which
 * every reader still accepts. A reference never silently changes target. */
export function locusCatalogReferenceValue(
  address: LocusCatalogAddress,
  lookups: LocusCatalogLookups,
): LocusCatalogReferenceValue {
  const handle = canonicalHandle(address, lookups);
  if (handle) {
    const named = resolveLocusCatalogReference({ id: address.id, kind: address.kind }, lookups);
    const canonical = named && resolveLocusCatalogReference({ id: handle }, lookups);
    if (canonical && canonical.value === named!.value) return locusCatalogReference(handle);
  }
  return { $pin: address.kind, id: address.id, name: address.name ?? address.id };
}
