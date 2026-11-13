// Privacy-scoped public field-registry wire projection.
//
// Public form/page GETs already return the canonical type that will be
// rendered. A root can, however, refer to account-authored nominal types, and
// those definitions can own further Fields or refer to still more account
// types. The browser therefore needs the complete *reachable* account slice,
// not merely the Fields physically nested in the root value.
//
// Semantics stay in the Fenel kernels:
//   - collectTypeNames discovers nominal type-reference edges; and
//   - normalizeFieldDeclarations discovers and validates NamedField UUIDs.
//
// This API/DB boundary is only the cycle-safe graph worklist and wire
// projection. It emits no unrelated owners, no tombstones, no repository
// definitions/Fields, and no persistence row ids or origin provenance.

import {
  collectTypeNames,
  getSystemEntity,
} from "@fenel/engine";
import {
  normalizeFieldDeclarations,
  type ExternalFieldDescriptor,
  type FieldDeclarationRootInput,
} from "@fenel/engine/field-identity";
import {
  projectCommittedAccountFieldRegistryInputs,
  publicFieldRootBindingMatches,
  type FieldFacetValue,
  type FieldOwnerDefinition,
  type FieldPersistenceSnapshot,
  type PublicFieldRootBinding,
} from "@fenel/engine/field-authoring";
import { repositoryFieldCatalog } from "@fenel/engine/repository-field-catalog";
import { isFenelType } from "@fenel/engine/dependent-types";
import { dispatchEngineBody } from "@fenel/engine/engine-bodies-dispatch";
import type { FenelType } from "@fenel/engine/types";
import { loadAccountFieldDefinitionGraphState } from "@fenel/runtime/state-field-definitions";
import { getSystemRegistry } from "@fenel/engine/system-registry";

export type PublicFieldRegistryBundle = {
  /** Canonical resolved entity name, never the possibly-aliased public slug. */
  readonly rootTypeName: string;
  readonly snapshot: FieldPersistenceSnapshot;
};

export type PublicFieldRegistrySnapshotLoader = (
  accountId: string,
) => Promise<FieldPersistenceSnapshot>;

type RepositoryFieldDescriptor = ExternalFieldDescriptor & {
  readonly realm: "repository";
};

/** Focused seams keep tests independent of the full repository bootstrap while
 * production still executes the real Fenel traversal/identity kernels. */
export type PublicFieldRegistrySemantics = {
  readonly typeNames?: (type: FenelType) => readonly string[];
  readonly repositoryTypeExists?: (name: string) => boolean;
  readonly repositoryFields?: () => readonly RepositoryFieldDescriptor[];
  readonly normalize?: typeof normalizeFieldDeclarations;
  readonly repositoryRootType?: (accountId: string, name: string) => Promise<FenelType | undefined>;
  readonly repositoryRootDeclaration?: (name: string) => FenelType | undefined;
};

export type PublicFieldRegistryBundleErrorCode =
  | "InvalidRootType"
  | "RootTypeChanged"
  | "InvalidAccountTypeOwner"
  | "UnresolvedRootType"
  | "UnresolvedTypeReference"
  | "UnresolvedFieldReference"
  | "TombstonedFieldReference"
  | "ConflictingFieldIdentity";

export class PublicFieldRegistryBundleError extends Error {
  readonly code: PublicFieldRegistryBundleErrorCode;

  constructor(code: PublicFieldRegistryBundleErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PublicFieldRegistryBundleError";
    this.code = code;
  }
}

async function loadPublicFieldSnapshot(
  accountId: string,
): Promise<FieldPersistenceSnapshot> {
  const graph = await loadAccountFieldDefinitionGraphState(accountId);
  // Unrelated function-version storage issues do not make a public type
  // unreadable. Only current owner definitions and committed Field state enter
  // the reachability projection below.
  return {
    owners: graph.currentOwners,
    fields: graph.currentFields,
    facets: graph.currentFacets,
  };
}

let cachedRepositoryFields: readonly RepositoryFieldDescriptor[] | undefined;

function defaultRepositoryFields(): readonly RepositoryFieldDescriptor[] {
  cachedRepositoryFields ??= repositoryFieldCatalog().fields.map((field) => ({
    id: field.fieldId,
    currentCodeName: field.codeName,
    realm: "repository" as const,
  }));
  return cachedRepositoryFields;
}

function publicFacet(facet: FieldFacetValue): FieldFacetValue {
  return {
    fieldId: facet.fieldId,
    typeName: facet.typeName,
    methods: { ...facet.methods },
    scope: facet.scope,
    priority: facet.priority,
  };
}

function publicOwner(owner: FieldOwnerDefinition): FieldOwnerDefinition {
  if (owner.kind !== "type") {
    throw new PublicFieldRegistryBundleError(
      "InvalidAccountTypeOwner",
      `Public field registry cannot expose non-type owner ${JSON.stringify(owner.ownerKey)}`,
    );
  }
  return {
    ownerKey: owner.ownerKey,
    kind: "type",
    storageName: owner.storageName,
    definition: { id: owner.definition.id, type: owner.definition.type },
  };
}

function typeOwnerIndex(
  owners: readonly FieldOwnerDefinition[],
): ReadonlyMap<string, FieldOwnerDefinition & { readonly kind: "type" }> {
  const result = new Map<string, FieldOwnerDefinition & { readonly kind: "type" }>();
  for (const owner of owners) {
    if (owner.kind !== "type") continue;
    if (
      owner.ownerKey !== `type:${owner.storageName}`
      || owner.definition.id !== owner.storageName
    ) {
      throw new PublicFieldRegistryBundleError(
        "InvalidAccountTypeOwner",
        `Public field registry rejected non-canonical type owner ${JSON.stringify(owner.ownerKey)}`,
      );
    }
    if (result.has(owner.storageName)) {
      throw new PublicFieldRegistryBundleError(
        "InvalidAccountTypeOwner",
        `Public field registry found multiple current owners for ${JSON.stringify(owner.storageName)}`,
      );
    }
    result.set(owner.storageName, owner);
  }
  return result;
}

type ReachableAccountTypes = {
  readonly owners: readonly (FieldOwnerDefinition & { readonly kind: "type" })[];
  readonly roots: readonly FieldDeclarationRootInput[];
};

/** Resolve the account-owned nominal closure with an explicit worklist. A type
 * reference is either another current owner for this account or a known
 * repository type. Anything else is rejected before a partial bundle exists. */
function reachableAccountTypes(
  rootTypeName: string,
  rootType: FenelType,
  snapshot: FieldPersistenceSnapshot,
  typeNames: (type: FenelType) => readonly string[],
  repositoryTypeExists: (name: string) => boolean,
): ReachableAccountTypes {
  const byName = typeOwnerIndex(snapshot.owners);
  const rootOwner = byName.get(rootTypeName);
  if (rootOwner === undefined && !repositoryTypeExists(rootTypeName)) {
    throw new PublicFieldRegistryBundleError(
      "UnresolvedRootType",
      `Public field registry cannot resolve root type ${JSON.stringify(rootTypeName)}`,
    );
  }

  const selected = new Map<string, FieldOwnerDefinition & { readonly kind: "type" }>();
  const queued = new Set<string>([rootTypeName]);
  const work: Array<{ readonly name: string; readonly type: FenelType }> = [{
    name: rootTypeName,
    type: rootType,
  }];

  if (rootOwner !== undefined) {
    // The root returned by the Fenel public view is the render authority for
    // this response. Storage metadata and identity still come from the exact
    // current owner row loaded for the same account.
    selected.set(rootTypeName, {
      ...rootOwner,
      definition: { ...rootOwner.definition, type: rootType },
    });
  }

  for (let cursor = 0; cursor < work.length; cursor++) {
    const current = work[cursor]!;
    for (const referencedName of typeNames(current.type)) {
      const accountOwner = byName.get(referencedName);
      if (accountOwner !== undefined) {
        if (!selected.has(referencedName)) selected.set(referencedName, accountOwner);
        if (!queued.has(referencedName)) {
          queued.add(referencedName);
          work.push({ name: referencedName, type: accountOwner.definition.type });
        }
        continue;
      }
      // A recursive reference to a repository root is already resolved by the
      // supplied canonical root, even in a focused test registry.
      if (referencedName === rootTypeName || repositoryTypeExists(referencedName)) continue;
      throw new PublicFieldRegistryBundleError(
        "UnresolvedTypeReference",
        `Public type ${JSON.stringify(current.name)} references unresolved type ${JSON.stringify(referencedName)}`,
      );
    }
  }

  const owners = [...selected.values()];
  const roots: FieldDeclarationRootInput[] = owners.map((owner) => ({
    kind: "type",
    realm: "account-authored",
    entity: owner.definition,
  }));
  if (rootOwner === undefined) {
    // Repository roots are not emitted, but the identity kernel still needs
    // the exact public structural root to discover direct NamedField UUIDs.
    roots.unshift({
      kind: "type",
      realm: "account-authored",
      entity: { id: rootTypeName, type: rootType },
    });
  }
  return { owners, roots };
}

function relevantFieldIds(
  roots: readonly FieldDeclarationRootInput[],
  snapshot: FieldPersistenceSnapshot,
  repositoryFields: readonly RepositoryFieldDescriptor[],
  normalize: typeof normalizeFieldDeclarations,
): ReadonlySet<string> {
  // First pass: explicit account UUIDs are valid declarations in the identity
  // kernel. This discovers the minimal UUID set without feeding the full
  // repository catalog through every public request.
  const discovered = normalize(roots, { mode: "strict-embedded" });
  const ids = new Set(discovered.entities.map((field) => field.id));

  const accountById = new Map(snapshot.fields.map((field) => [field.id, field] as const));
  const repositoryById = new Map(repositoryFields.map((field) => [field.id, field] as const));
  const classified = projectCommittedAccountFieldRegistryInputs(
    snapshot.fields,
    snapshot.facets,
  );
  const liveAccountById = new Map(classified.liveFields.map((field) => [field.id, field] as const));
  const external: ExternalFieldDescriptor[] = [];
  const kinds = new Map<string, string>();

  for (const id of ids) {
    const account = accountById.get(id);
    const repository = repositoryById.get(id);
    if (account !== undefined && repository !== undefined) {
      throw new PublicFieldRegistryBundleError(
        "ConflictingFieldIdentity",
        `Public field UUID ${JSON.stringify(id)} exists in both account and repository realms`,
      );
    }
    if (account !== undefined) {
      const live = liveAccountById.get(id);
      if (live === undefined) {
        throw new PublicFieldRegistryBundleError(
          "TombstonedFieldReference",
          `Public type closure references tombstoned account Field ${JSON.stringify(id)}`,
        );
      }
      external.push({
        id: live.id,
        currentCodeName: live.currentCodeName,
        ...(live.origin === undefined ? {} : { origin: live.origin }),
      });
      kinds.set(id, "field");
      continue;
    }
    if (repository !== undefined) {
      external.push(repository);
      kinds.set(id, "field");
      continue;
    }
    throw new PublicFieldRegistryBundleError(
      "UnresolvedFieldReference",
      `Public type closure references unknown Field UUID ${JSON.stringify(id)}`,
    );
  }

  // Second pass: re-run the same Fenel identity kernel with only the discovered
  // live referents. This proves codename/kind/reuse consistency and prevents a
  // locally declared-looking UUID from bypassing committed liveness.
  normalize(roots, {
    mode: "strict-embedded",
    externalFields: external,
    identityKinds: kinds,
  });
  return ids;
}

export function scopePublicFieldRegistrySnapshot(
  rootTypeName: string,
  type: unknown,
  snapshot: FieldPersistenceSnapshot,
  semantics: PublicFieldRegistrySemantics = {},
): FieldPersistenceSnapshot {
  if (!isFenelType(type)) {
    throw new PublicFieldRegistryBundleError(
      "InvalidRootType",
      `Public field registry received an invalid type for ${JSON.stringify(rootTypeName)}`,
    );
  }

  const typeNames = semantics.typeNames ?? collectTypeNames;
  const repositoryTypeExists = semantics.repositoryTypeExists
    ?? ((name: string) => getSystemEntity(name) !== undefined
      || dispatchEngineBody("engine:validationPrimitiveName", [name]) === true);
  const repositoryFields = (semantics.repositoryFields ?? defaultRepositoryFields)();
  const normalize = semantics.normalize ?? normalizeFieldDeclarations;
  const closure = reachableAccountTypes(
    rootTypeName,
    type,
    snapshot,
    typeNames,
    repositoryTypeExists,
  );
  const referencedIds = relevantFieldIds(
    closure.roots,
    snapshot,
    repositoryFields,
    normalize,
  );

  const classified = projectCommittedAccountFieldRegistryInputs(
    snapshot.fields,
    snapshot.facets,
  );
  const fields = classified.liveFields
    .filter((field) => referencedIds.has(field.id))
    .map((field) => ({
      id: field.id,
      currentCodeName: field.currentCodeName,
      status: "live" as const,
      realm: "account" as const,
      // The public renderer needs a valid durable wire row, not the account's
      // private authoring/reuse policy.
      reuseVisibility: "account" as const,
    }));
  const liveIds = new Set(fields.map((field) => field.id));

  return {
    owners: closure.owners.map(publicOwner),
    fields,
    facets: classified.liveFacets
      .filter((facet) => liveIds.has(facet.fieldId))
      .map(publicFacet),
  };
}

export async function loadPublicFieldRegistryBundle(
  accountId: string,
  rootTypeName: string,
  type: unknown,
  binding: PublicFieldRootBinding | undefined,
  load: PublicFieldRegistrySnapshotLoader = loadPublicFieldSnapshot,
  semantics: PublicFieldRegistrySemantics = {},
): Promise<PublicFieldRegistryBundle> {
  if (!isFenelType(type)) {
    throw new PublicFieldRegistryBundleError(
      "InvalidRootType",
      `Public field registry received an invalid type for ${JSON.stringify(rootTypeName)}`,
    );
  }
  const snapshot = await load(accountId);
  const repositoryDeclaration = (semantics.repositoryRootDeclaration ?? ((name: string) => getSystemEntity(name)?.type))(rootTypeName);
  if (!publicFieldRootBindingMatches(binding, rootTypeName, type, snapshot.owners, repositoryDeclaration)) {
    throw new PublicFieldRegistryBundleError(
      "RootTypeChanged",
      "Public type changed while it was loading; reload to try again",
    );
  }
  let rootType = type;
  const accountRoot = snapshot.owners.some((owner) => owner.kind === "type" && owner.storageName === rootTypeName);
  const repositoryTypeExists = semantics.repositoryTypeExists
    ?? ((name: string) => getSystemEntity(name) !== undefined);
  if (!accountRoot && repositoryTypeExists(rootTypeName)) {
    // Repository source declarations can have keyless NamedFields. Traverse
    // their checked registry projection, just as the public browser does,
    // instead of relaxing the Field identity kernels for raw source slots.
    const identified = semantics.repositoryRootType
      ? await semantics.repositoryRootType(accountId, rootTypeName)
      : getSystemRegistry().getIdentifiedEntity(rootTypeName)?.type;
    if (identified === undefined) {
      throw new PublicFieldRegistryBundleError(
        "UnresolvedRootType",
        `Public field registry cannot resolve identified repository type ${JSON.stringify(rootTypeName)}`,
      );
    }
    rootType = identified;
  }
  return {
    rootTypeName,
    snapshot: scopePublicFieldRegistrySnapshot(rootTypeName, rootType, snapshot, semantics),
  };
}
