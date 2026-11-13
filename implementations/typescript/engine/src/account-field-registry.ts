// Committed account field-definition snapshot -> registry-local product view.
//
// The definition-bundle transaction is the only writer of this snapshot. This
// adapter is deliberately a one-way projection: drafts never enter a product
// registry and account facets never touch the process-global dispatch registry.

import type {
  FieldPersistenceSnapshot,
  FieldOwnerDefinition,
} from "./field-authoring";
import { projectCommittedAccountFieldRegistryInputs, projectLocalFieldRegistryInputs } from "./field-authoring";
import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { registerEngineModule } from "./engine-require";
import { assertOwnedDefinitionIdentities, type ExternalFieldDescriptor } from "./field-identity";
import { repositoryIdentityKinds } from "./repository-identity-manifest";
import type { FenelModule, Instance, TypeConstructorParam } from "./types";
import type { ModuleRegistry } from "./registry";
import {
  createAccountRegistry,
  createAccountRegistryAsync,
  createLocalRegistry,
  createLocalRegistryAsync,
  type AccountRegistryOptions,
} from "./repository-registry";
import { withEngineBodyMemoPartition } from "./engine-body-memo";
/** W1 — the page realm's persistent registry preparation worker: browser
 * session owners close it (its caches may hold the previous account's data). */
export { closeRegistryPreparationWorker } from "./registry";

export type AccountFieldRegistryProjection = {
  /** One account-authored module per committed owner. Keeping the module
   * boundary explicit prevents account definitions from being mistaken for
   * repository source merely because a code name happens to match. */
  readonly ownerModules: readonly FenelModule[];
  /** Live account Field entities are valid external UUID referents. */
  readonly externalFields: readonly ExternalFieldDescriptor[];
  /** Every durable account Field UUID remains reserved, including tombstones. */
  readonly identityKinds: ReadonlyMap<string, "field" | "type" | "function">;
  /** Optional account facets for live fields only. */
  readonly fieldRepresentations: readonly Instance[];
};

export type CreateAccountFieldRegistryOptions = Omit<
  AccountRegistryOptions,
  "externalFields" | "identityKinds" | "fieldRepresentations"
>;

type AccountFieldRepresentation =
  AccountFieldRegistryProjection["fieldRepresentations"][number];

/** B3 transport of ordinary owner kinds selected by the Fenel identity plan.
 * A Local snapshot goes through the Local admission, which refuses a non-UUID
 * definition id (F0, `engine:localOwnedDefinitionIdentityKinds`). */
function ownedDefinitionKinds(snapshot: FieldPersistenceSnapshot, fields: ReadonlyMap<string, string>,
  admission: "local" | "account", ownerModules: readonly FenelModule[]) {
  // These are the emitted owner-module IDs, not a second read of a mutable
  // input definition. Reused repository Fields and references are not owners.
  assertOwnedDefinitionIdentities(ownerModules.flatMap(module => [
    ...(module.entities ?? []).map(entity => entity.id),
    ...(module.functions ?? []).map(fn => fn.id),
  ]), repositoryIdentityKinds());
  let owners: Array<{ handle: string; kind: "type" | "function" }>;
  if (admission === "local") {
    const admitted = dispatchEngineBody("engine:localOwnedDefinitionIdentityKinds", [snapshot.owners]) as
      { $tag: "Ok"; _0: typeof owners } | { $tag: "Err"; _0: string };
    if (admitted.$tag === "Err") throw new TypeError(admitted._0);
    owners = admitted._0;
  } else {
    owners = dispatchEngineBody("engine:fieldOwnedDefinitionIdentityKinds", [snapshot.owners]) as typeof owners;
  }
  const checked = dispatchEngineBody("engine:ownedDefinitionIdentityKindPlan", [
    [...[...fields].map(([handle]) => ({ handle, kind: "field" })), ...owners],
  ]) as { $tag: "Ok"; _0: Array<{ handle: string; kind: "field" | "type" | "function" }> } | { $tag: "Err"; _0: string };
  if (checked.$tag === "Err") throw new TypeError(checked._0);
  return new Map(checked._0.map(row => [row.handle, row.kind]));
}

function ownerModuleName(accountId: string, owner: FieldOwnerDefinition, sourceKind = "account"): string {
  // This is a diagnostic container identity, not semantic function ownership.
  // Encode the complete tuple once so delimiter-shaped account/owner pairs stay
  // injective while the default module namespace remains colon-free.
  const baseName = `${sourceKind}-owner-${encodeURIComponent(JSON.stringify([accountId, owner.ownerKey]))}`;
  let name = baseName;
  while (owner.definition.id.startsWith(`${name}:`)) {
    name += "-container";
  }
  return name;
}

function ownerModule(accountId: string, owner: FieldOwnerDefinition, sourceKind = "account"): FenelModule {
  const name = ownerModuleName(accountId, owner, sourceKind);
  if (owner.kind === "type") {
    return {
      name,
      label: owner.storageName,
      entities: [{
        id: owner.definition.id,
        type: owner.definition.type,
        ...(owner.definition.params === undefined ? {} : { params: [...owner.definition.params] as string[] | TypeConstructorParam[] }),
        ...(owner.definition.constructorFunction === undefined ? {} : { constructorFunction: owner.definition.constructorFunction }),
        module: name,
        // Preserve declared binders/kinds/nominals/applications. Older owners
        // without metadata retain their monomorphic compatibility ingress.
        typeScheme: owner.definition.typeScheme ?? { quantified: [], body: owner.definition.type },
      }],
    };
  }
  // Registry construction performs effect inference by assigning `requires`.
  // Keep that registry-local by copying the committed function envelope.
  const declarationSlot = Object.getOwnPropertyDescriptor(owner.definition, "signatureDeclaration");
  if (declarationSlot !== undefined && !("value" in declarationSlot)) {
    throw new TypeError("Function signature declaration must be own data.");
  }
  const declaration = declarationSlot?.value;
  if (declaration !== undefined && (declaration === null || typeof declaration !== "object"
    || Object.getOwnPropertyDescriptor(declaration, "functionId")?.value !== owner.definition.id)) {
    throw new TypeError("Function signature declaration must identify its exact saved function.");
  }
  return {
    name,
    label: owner.storageName,
    functions: [{ ...owner.definition }],
    ...(declaration === undefined ? {} : { functionSignatureDeclarations: [declaration] }),
  };
}

/** Existing snapshot wires are transport data here, not account grants.
 * Local fields/facets stay within this private registry's contextual index. */
export function projectLocalFieldRegistrySnapshot(sourceId: string, snapshot: FieldPersistenceSnapshot): AccountFieldRegistryProjection {
  if (!sourceId) throw new TypeError("A local definition source needs its tab identity.");
  const classified = projectLocalFieldRegistryInputs(snapshot.fields, snapshot.facets);
  // Own-data owner admission first (as before), then the Fenel id admission.
  const ownerModules = snapshot.owners.map(owner => ownerModule(sourceId, owner, "local"));
  const identityKinds = ownedDefinitionKinds(snapshot, classified.identityKinds, "local", ownerModules);
  return {
    ownerModules,
    externalFields: classified.liveFields.map(field => ({ id: field.id, currentCodeName: field.currentCodeName,
      ...(field.origin === undefined ? {} : { origin: field.origin }) })),
    identityKinds,
    fieldRepresentations: classified.liveFacets.map(facet => ({ typeName: facet.typeName, args: [facet.fieldId],
      methods: { ...facet.methods }, priority: facet.priority })),
  };
}

export function createLocalFieldRegistry(repositoryModules: FenelModule[], sourceId: string,
  snapshot: FieldPersistenceSnapshot, options: CreateAccountFieldRegistryOptions = {}): ModuleRegistry {
  const projected = projectLocalFieldRegistrySnapshot(sourceId, snapshot);
  // S1 engine-body memo — a Local tab build opens its OWN partition: entries
  // computed from its data stay in it; repository-identical calls read the
  // public repository partition's entries (and the replay artifact).
  return withEngineBodyMemoPartition(`local:${sourceId}`, () => createLocalRegistry(repositoryModules, [...projected.ownerModules], {
    ...options, bodySpellingPolicy: "reject",
    externalFields: projected.externalFields, identityKinds: projected.identityKinds, fieldRepresentations: projected.fieldRepresentations }));
}

export function createLocalFieldRegistryAsync(repositoryModules: FenelModule[], sourceId: string,
  snapshot: FieldPersistenceSnapshot, options: CreateAccountFieldRegistryOptions = {}): Promise<ModuleRegistry> {
  const projected = projectLocalFieldRegistrySnapshot(sourceId, snapshot);
  return createLocalRegistryAsync(repositoryModules, [...projected.ownerModules], { ...options, bodySpellingPolicy: "reject",
    externalFields: projected.externalFields, identityKinds: projected.identityKinds, fieldRepresentations: projected.fieldRepresentations });
}

/** Pure structural projection of one committed definition-bundle snapshot.
 * Liveness and identity were decided by the Fenel planner before commit; this
 * leaf only selects the corresponding registry inputs. */
export function projectAccountFieldRegistrySnapshot(
  accountId: string,
  snapshot: FieldPersistenceSnapshot,
): AccountFieldRegistryProjection {
  const classified = projectCommittedAccountFieldRegistryInputs(
    snapshot.fields,
    snapshot.facets,
  );
  const ownerModules = snapshot.owners.map((owner) => ownerModule(accountId, owner));
  return {
    ownerModules,
    externalFields: classified.liveFields.map((field) => ({
      id: field.id,
      currentCodeName: field.currentCodeName,
      ...(field.origin === undefined ? {} : { origin: field.origin }),
    })),
    identityKinds: ownedDefinitionKinds(snapshot, classified.identityKinds, "account", ownerModules),
    // ⚠ rights R3a — THE PRODUCER STAMPS THE OWNER (review round 2, Astra). This
    // copied `facet.scope` through, so a live account facet kept the bare
    // `"account"` marker the facet DATA producers emit — and after the flip that
    // marker is invisible to `instanceVisible` even for the account that owns
    // the facet. Nothing leaked (facets ride a registry-LOCAL index, not the
    // shared pool, and `fieldRepresentationKey` still routed them to the account
    // branch), but the completion note claimed the stamp and the stamp was not
    // there: `fieldRepresentationKey` learned the ADT while the thing that
    // WRITES the row did not.
    //
    // Ownership is DERIVED here exactly as everywhere else — from the account
    // whose registry is being built, never from what the facet claims.
    fieldRepresentations: classified.liveFacets.map((facet): AccountFieldRepresentation => ({
      typeName: facet.typeName,
      args: [facet.fieldId],
      methods: { ...facet.methods },
      scope: { kind: "account", accountId },
      priority: facet.priority,
    })),
  };
}

/** Build a fresh account registry from a server-returned committed snapshot.
 * The caller may atomically publish the returned registry only after this
 * function succeeds. No shared registry or source module is mutated. */
export function createAccountFieldRegistry(
  repositoryModules: FenelModule[],
  accountId: string,
  snapshot: FieldPersistenceSnapshot,
  options: CreateAccountFieldRegistryOptions = {},
): ModuleRegistry {
  const projected = projectAccountFieldRegistrySnapshot(accountId, snapshot);
  return createAccountRegistry(
    repositoryModules,
    [...projected.ownerModules],
    {
      ...options,
      // This adapter hydrates bodies that are already committed. Their codec
      // canonicalization lands in Phase 5/6, so they must not block a boot;
      // the bundle command explicitly overrides this to `reject` pre-commit.
      bodySpellingPolicy: options.bodySpellingPolicy ?? "defer-legacy-db",
      externalFields: projected.externalFields,
      identityKinds: projected.identityKinds,
      fieldRepresentations: projected.fieldRepresentations,
    },
  );
}

/** Same committed snapshot projection and strict registry authority, scheduled
 * asynchronously for browser startup and post-save snapshot swaps. */
export function createAccountFieldRegistryAsync(
  repositoryModules: FenelModule[],
  accountId: string,
  snapshot: FieldPersistenceSnapshot,
  options: CreateAccountFieldRegistryOptions = {},
): Promise<ModuleRegistry> {
  const projected = projectAccountFieldRegistrySnapshot(accountId, snapshot);
  return createAccountRegistryAsync(repositoryModules, [...projected.ownerModules], {
    ...options,
    bodySpellingPolicy: options.bodySpellingPolicy ?? "defer-legacy-db",
    externalFields: projected.externalFields,
    identityKinds: projected.identityKinds,
    fieldRepresentations: projected.fieldRepresentations,
  });
}

// A2 browser module seam: local reader preparation loads this owner before an
// explicit definition write invokes the existing lazy field-authoring bridge.
registerEngineModule("account-field-registry", { projectLocalFieldRegistrySnapshot });
