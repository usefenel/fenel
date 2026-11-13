// Structural B3 bridge for field-authoring and persistence planning. Semantic
// authority lives in fenel/modules/engine/field-authoring.fenel and the Phase-2a
// field identity kernel.

import { dispatchEngineBody } from "./engine-bodies-dispatch";
import { encodeCheckpointValue } from "./checkpoint-json";
import {
  assertOwnedDefinitionIdentities,
  identifiedDefinitionView,
  normalizeFieldDeclarations,
  qualifiedFieldName,
  tryNormalizeFieldDeclarations,
  type ExternalFieldDescriptor,
  type FieldDeclarationRootInput,
  type FieldEntity,
  type FieldIdentity,
  type FieldIdentityDiagnostic,
  type FieldOrigin,
  type FieldOwner,
  type FieldOwnerEntity,
} from "./field-identity";
import type {
  EditDisplay,
  FenelFunction,
  FenelType,
  FieldDef,
  LocaleString,
} from "./types";
import { Nothing } from "./type-foundation";
import { repositoryIdentityKinds } from "./repository-identity-manifest";
import { engineRequire } from "./engine-require";
import type { CompileConstructorCandidate } from "./compile-field-slots";

type FenelMaybe<T> = { $tag: "Nothing" } | { $tag: "Just"; _0: T };
const NOTHING: FenelMaybe<never> = { $tag: "Nothing" };
const just = <T>(value: T): FenelMaybe<T> => ({ $tag: "Just", _0: value });
const maybe = <T>(value: T | undefined): FenelMaybe<T> =>
  value === undefined ? NOTHING : just(value);
const unwrap = <T>(value: FenelMaybe<T>): T | undefined =>
  value.$tag === "Just" ? value._0 : undefined;

/** A name from the generated Fenel FieldRepresentational family. The bridge
 * deliberately does not duplicate that open family as a TS string union. */
export type FieldFacetInterfaceName = string;
export type EditableFieldFacetInterfaceName = string;

export type DesiredFieldFacets = {
  readonly label?: LocaleString;
  readonly description?: string;
  readonly icon?: string;
  readonly display?: EditDisplay | Record<string, unknown>;
};

export type FieldContextualPresentationOverride = DesiredFieldFacets;

export type FieldOccurrenceDraft = {
  readonly draftId: string;
  readonly owner: FieldOwner;
  readonly action:
    | { readonly kind: "new"; readonly fieldId: string }
    | { readonly kind: "reuse"; readonly fieldId: string }
    | { readonly kind: "resurrect"; readonly fieldId: string };
  readonly codeName: string;
  readonly occurrenceType: FenelType;
  readonly facets: DesiredFieldFacets;
  readonly contextualOverride?: FieldContextualPresentationOverride;
};

export type NormalizedFieldOccurrenceDraft = Omit<FieldOccurrenceDraft, "action"> & {
  readonly fieldId: string;
};

export type DurableFieldEntity = {
  readonly id: string;
  readonly currentCodeName: string;
  readonly status: "live" | "tombstoned";
  readonly realm: "account" | "repository";
  readonly reuseVisibility: "owner" | "account" | "repository";
  readonly origin?: FieldOrigin;
};

export type FieldFacetValue = {
  readonly rowId?: string;
  readonly fieldId: string;
  readonly typeName: FieldFacetInterfaceName;
  readonly methods: Record<string, unknown>;
  readonly scope: "account";
  readonly priority: number;
  /** Physical ingress fact used only to force one canonical storage rewrite.
   * Omitted values are canonical for all non-migration callers. */
  readonly storageCanonical?: boolean;
};

export type DesiredFieldFacetValue = {
  readonly fieldId: string;
  readonly typeName: EditableFieldFacetInterfaceName;
  readonly methods: Record<string, unknown>;
};

export type FieldOwnerDefinition =
  | {
      readonly ownerKey: string;
      readonly kind: "type";
      readonly storageName: string;
      readonly storageId?: string;
      readonly definition: FieldOwnerEntity;
    }
  | {
      readonly ownerKey: string;
      readonly kind: "function";
      readonly storageName: string;
      readonly storageId?: string;
      readonly definition: FenelFunction;
    };

export type FieldOwnerMutation =
  | { readonly kind: "upsert"; readonly owner: FieldOwnerDefinition }
  | {
      readonly kind: "delete";
      readonly ownerKey: string;
      readonly ownerKind: "type" | "function";
      readonly storageName: string;
    };

/** Captured by the Fenel public view; never accepted from an HTTP client. */
export type PublicFieldRootBinding = {
  readonly origin: "account" | "repository";
  readonly id: string;
  readonly name: string;
};

export type FieldStorageIssue = {
  readonly ownerKind: "type" | "function";
  readonly storageName: string;
  readonly rowIds: readonly string[];
  readonly reason: "multiple-current" | "version-shaped";
};

/** Canonical committed account graph consumed by field authoring. Persistence
 * implementations may choose how to load it, but the graph shape belongs to
 * the semantic control plane rather than to any particular database package. */
export type AccountFieldDefinitionGraph = {
  readonly currentOwners: readonly FieldOwnerDefinition[];
  readonly currentFields: readonly DurableFieldEntity[];
  readonly currentFacets: readonly FieldFacetValue[];
  readonly storageIssues: readonly FieldStorageIssue[];
};

export type FieldPersistenceInput = {
  readonly currentOwners: readonly FieldOwnerDefinition[];
  /** Migration-only identified mirror used to normalize the pre-migration
   * occurrence roster. Diff/precondition state remains currentOwners. */
  readonly currentIdentityOwners?: readonly FieldOwnerDefinition[];
  readonly ownerMutations: readonly FieldOwnerMutation[];
  readonly currentFields: readonly DurableFieldEntity[];
  readonly currentFacets: readonly FieldFacetValue[];
  /** Explicit account-tombstone resurrection authority. Merely referencing a
   * tombstoned UUID without listing it here remains an ordinary rejected
   * reuse. */
  readonly resurrectFieldIds?: readonly string[];
  /** Complete desired optional-facet values for explicitly replaced fields. */
  readonly desiredFacets?: readonly DesiredFieldFacetValue[];
  /** Per-field tri-state replacement contract. IDs absent here retain every
   * current optional facet; a present ID with no desired values deletes all of
   * that field's optional facets. */
  readonly replaceFacetFieldIds?: readonly string[];
  readonly repositoryFields?: readonly DurableFieldEntity[];
  readonly identityKinds?: ReadonlyMap<string, string>;
  readonly storageIssues?: readonly FieldStorageIssue[];
};

export type FieldPersistenceSnapshot = {
  readonly owners: readonly FieldOwnerDefinition[];
  readonly fields: readonly DurableFieldEntity[];
  readonly facets: readonly FieldFacetValue[];
};

export type FieldPersistencePlan = {
  readonly ownerUpserts: readonly FieldOwnerDefinition[];
  readonly ownerDeletes: readonly FieldOwnerDefinition[];
  readonly fieldUpserts: readonly DurableFieldEntity[];
  readonly fieldTombstones: readonly DurableFieldEntity[];
  readonly facetUpserts: readonly FieldFacetValue[];
  readonly facetDeletes: readonly FieldFacetValue[];
  readonly retainedFacets: readonly FieldFacetValue[];
  readonly snapshot: FieldPersistenceSnapshot;
};

export type FieldAuthoringDiagnostic = {
  readonly $tag: string;
  readonly message: string;
  readonly [key: string]: unknown;
};

export class FieldAuthoringError extends Error {
  readonly diagnostic: FieldAuthoringDiagnostic;
  constructor(diagnostic: FieldAuthoringDiagnostic) {
    super(diagnostic.message);
    this.name = "FieldAuthoringError";
    this.diagnostic = diagnostic;
  }
}

function marshalOwnerDefinition(owner: FieldOwnerDefinition): unknown {
  return {
    $tag: "FieldOwnerDefinition",
    ownerKey: owner.ownerKey,
    kind: owner.kind,
    storageName: owner.storageName,
    storageId: maybe(owner.storageId),
    definition: owner.definition,
  };
}

/** B3 only: marshal the captured binding and coherent owners into the existing
 * pure field-authoring harness. Fenel owns every identity/version decision. */
export function publicFieldRootBindingMatches(
  binding: PublicFieldRootBinding | undefined,
  typeName: string,
  type: FenelType,
  owners: readonly FieldOwnerDefinition[],
  repositoryType: FenelType | undefined,
): boolean {
  return dispatchEngineBody("engine:publicFieldRootBindingMatches", [
    maybe(binding), typeName, type, owners.map(marshalOwnerDefinition),
    maybe(repositoryType), { $ref: typeName },
  ]) === true;
}

function unmarshalOwnerDefinition(value: any): FieldOwnerDefinition {
  const common = {
    ownerKey: value.ownerKey as string,
    storageName: value.storageName as string,
    ...(unwrap(value.storageId as FenelMaybe<string>) === undefined
      ? {}
      : { storageId: unwrap(value.storageId as FenelMaybe<string>)! }),
  };
  return value.kind === "type"
    ? { ...common, kind: "type", definition: value.definition as FieldOwnerEntity }
    : { ...common, kind: "function", definition: value.definition as FenelFunction };
}

function marshalMutation(mutation: FieldOwnerMutation): unknown {
  return mutation.kind === "upsert"
    ? { $tag: "UpsertFieldOwner", owner: marshalOwnerDefinition(mutation.owner) }
    : {
        $tag: "DeleteFieldOwner",
        ownerKey: mutation.ownerKey,
        kind: mutation.ownerKind,
        storageName: mutation.storageName,
      };
}

function ownerRoot(owner: FieldOwnerDefinition, realm: "account-authored" | "repository-source" | "transient-draft"): FieldDeclarationRootInput {
  return owner.kind === "type"
    ? { kind: "type", realm, entity: owner.definition }
    : { kind: "function", realm, fn: owner.definition };
}

function marshalOrigin(origin: FieldOrigin | undefined): FenelMaybe<unknown> {
  return origin === undefined
    ? NOTHING
    : just({ $tag: "FieldOrigin", owner: origin.owner, path: origin.path });
}

function unmarshalOrigin(origin: FenelMaybe<any>): FieldOrigin | undefined {
  return origin.$tag === "Nothing"
    ? undefined
    : { owner: origin._0.owner as FieldOwner, path: origin._0.path };
}

function marshalDurable(field: DurableFieldEntity): unknown {
  return {
    $tag: "DurableFieldEntity",
    id: { $tag: "FieldRef", handle: field.id },
    currentCodeName: field.currentCodeName,
    status: { $tag: field.status === "live" ? "FieldLive" : "FieldTombstoned" },
    realm: { $tag: field.realm === "account" ? "DurableAccountField" : "DurableRepositoryField" },
    reuseVisibility: {
      $tag: field.reuseVisibility === "owner"
        ? "FieldOwnerOnly"
        : field.reuseVisibility === "account"
          ? "FieldAccountReusable"
          : "FieldRepositoryReusable",
    },
    origin: marshalOrigin(field.origin),
  };
}

function unmarshalDurable(value: any): DurableFieldEntity {
  const origin = unmarshalOrigin(value.origin);
  return {
    id: value.id.handle,
    currentCodeName: value.currentCodeName,
    status: value.status.$tag === "FieldLive" ? "live" : "tombstoned",
    realm: value.realm.$tag === "DurableAccountField" ? "account" : "repository",
    reuseVisibility: value.reuseVisibility.$tag === "FieldOwnerOnly"
      ? "owner"
      : value.reuseVisibility.$tag === "FieldAccountReusable"
        ? "account"
        : "repository",
    ...(origin === undefined ? {} : { origin }),
  };
}

function marshalFacet(facet: FieldFacetValue): unknown {
  return {
    $tag: "FieldFacetValue",
    rowId: maybe(facet.rowId),
    field: { $tag: "FieldRef", handle: facet.fieldId },
    typeName: facet.typeName,
    methods: facet.methods,
    scope: facet.scope,
    priority: facet.priority,
    storageCanonical: facet.storageCanonical !== false,
  };
}

/** B3 marshalling only. Native data atoms use the existing lossless storage
 * codec before Fenel compares the complete captured graph. */
export function fieldPersistenceSnapshotMatches(
  current: FieldPersistenceSnapshot,
  expected: FieldPersistenceSnapshot,
): boolean {
  const marshal = (snapshot: FieldPersistenceSnapshot) => encodeCheckpointValue({
    $tag: "FieldPersistenceSnapshot",
    owners: snapshot.owners.map(marshalOwnerDefinition),
    fields: snapshot.fields.map(marshalDurable),
    facets: snapshot.facets.map(marshalFacet),
  });
  return dispatchEngineBody("engine:fieldPersistenceSnapshotMatches", [
    marshal(current), marshal(expected),
  ]) === true;
}

function unmarshalFacet(value: any): FieldFacetValue {
  const rowId = unwrap(value.rowId as FenelMaybe<string>);
  return {
    ...(rowId === undefined ? {} : { rowId }),
    fieldId: value.field.handle,
    typeName: value.typeName,
    methods: value.methods,
    scope: "account",
    priority: value.priority,
    ...(value.storageCanonical === false ? { storageCanonical: false } : {}),
  };
}

function marshalDesiredFacet(facet: DesiredFieldFacetValue): unknown {
  return {
    $tag: "DesiredFieldFacet",
    field: { $tag: "FieldRef", handle: facet.fieldId },
    typeName: facet.typeName,
    methods: facet.methods,
  };
}

function externalDescriptor(field: DurableFieldEntity): ExternalFieldDescriptor {
  return {
    id: field.id,
    currentCodeName: field.currentCodeName,
    ...(field.origin === undefined ? {} : { origin: field.origin }),
  };
}

type PreparedFieldAuthoringInventory = {
  currentAvailable: DurableFieldEntity[];
  desiredAvailable: DurableFieldEntity[];
  accountTombstones: DurableFieldEntity[];
  repositoryIds: Array<{ $tag: "FieldRef"; handle: string }>;
  mutableCodeableIds: string[];
  identityKinds: Map<string, string>;
};

export type CommittedAccountFieldRegistryInputs = {
  readonly liveFields: readonly DurableFieldEntity[];
  readonly identityKinds: ReadonlyMap<string, string>;
  readonly liveFacets: readonly FieldFacetValue[];
};

function prepareFieldAuthoringInventory(
  currentFields: readonly DurableFieldEntity[],
  repositoryFields: readonly DurableFieldEntity[],
  identityKinds: ReadonlyMap<string, string> = new Map(),
): { ok: true; value: PreparedFieldAuthoringInventory } | { ok: false; error: FieldAuthoringDiagnostic } {
  const result = dispatchEngineBody("engine:prepareFieldAuthoringInventory", [
    currentFields.map(marshalDurable),
    repositoryFields.map(marshalDurable),
    [...identityKinds].map(([handle, kind]) => ({
      $tag: "FieldIdentityKindBinding",
      handle,
      kind,
    })),
  ]) as { $tag: "Ok"; _0: any } | { $tag: "Err"; _0: FieldAuthoringDiagnostic };
  if (result.$tag === "Err") return { ok: false, error: result._0 };
  return {
    ok: true,
    value: {
      currentAvailable: result._0.currentAvailable.map(unmarshalDurable),
      desiredAvailable: result._0.desiredAvailable.map(unmarshalDurable),
      accountTombstones: result._0.accountTombstones.map(unmarshalDurable),
      repositoryIds: result._0.repositoryIds,
      mutableCodeableIds: result._0.mutableCodeables.map((field: { handle: string }) => field.handle),
      identityKinds: new Map(
        result._0.identityKinds.map((binding: any) => [binding.handle, binding.kind]),
      ),
    },
  };
}

/** Fenel-owned liveness projection for committed product registries. The host
 * adapter receives an already-classified live roster/facet set plus the
 * tombstone-inclusive UUID reservation map. */
export function projectCommittedAccountFieldRegistryInputs(
  fields: readonly DurableFieldEntity[],
  facets: readonly FieldFacetValue[],
): CommittedAccountFieldRegistryInputs {
  return projectFieldRegistryInputs("engine:projectCommittedAccountFieldRegistryInputs", fields, facets);
}

export function projectLocalFieldRegistryInputs(fields: readonly DurableFieldEntity[],
  facets: readonly FieldFacetValue[]): CommittedAccountFieldRegistryInputs {
  return projectFieldRegistryInputs("engine:projectLocalFieldRegistryInputs", fields, facets);
}

function projectFieldRegistryInputs(fnId: string, fields: readonly DurableFieldEntity[],
  facets: readonly FieldFacetValue[]): CommittedAccountFieldRegistryInputs {
  const result = dispatchEngineBody(fnId, [
    fields.map(marshalDurable),
    facets.map(marshalFacet),
  ]) as { $tag: "Ok"; _0: any } | { $tag: "Err"; _0: FieldAuthoringDiagnostic };
  if (result.$tag === "Err") throw new FieldAuthoringError(result._0);
  return {
    liveFields: result._0.liveFields.map(unmarshalDurable),
    identityKinds: new Map(
      result._0.identityKinds.map((binding: any) => [binding.handle, binding.kind]),
    ),
    liveFacets: result._0.liveFacets.map(unmarshalFacet),
  };
}

function marshalFieldEntity(field: FieldEntity): unknown {
  return {
    $tag: "FieldEntity",
    id: { $tag: "FieldRef", handle: field.id },
    currentCodeName: field.currentCodeName,
    origin: marshalOrigin(field.origin),
    occurrences: [],
  };
}

function selectDesiredAccountFields(
  fields: readonly FieldEntity[],
  repositoryIds: readonly { $tag: "FieldRef"; handle: string }[],
): unknown[] {
  return dispatchEngineBody("engine:selectDesiredAccountFields", [
    fields.map(marshalFieldEntity),
    repositoryIds,
  ]) as unknown[];
}

function marshalOccurrence(identity: FieldIdentity): unknown {
  return {
    $tag: "ResolvedFieldOccurrence",
    owner: identity.owner,
    key: identity.field.key.$tag === "NamedField"
      ? { $tag: "NamedField", ref: { $tag: "FieldRef", handle: identity.field.key.ref.$ref } }
      : { $tag: "PositionalField", index: identity.field.key.index },
  };
}

function normalizeOwners(
  owners: readonly FieldOwnerDefinition[],
  reusableFields: readonly DurableFieldEntity[],
  kinds: ReadonlyMap<string, string>,
  mutableExternalCodeableIds: readonly string[] = [],
) {
  return normalizeFieldDeclarations(
    owners.map((owner) => ownerRoot(owner, "account-authored")),
    {
      mode: "strict-embedded",
      externalFields: reusableFields.map(externalDescriptor),
      identityKinds: kinds,
      mutableExternalCodeableIds,
    },
  );
}

function selectFieldResurrections(
  available: readonly DurableFieldEntity[],
  requested: readonly string[],
): { ok: true; value: DurableFieldEntity[] } | { ok: false; error: FieldAuthoringDiagnostic } {
  const result = dispatchEngineBody("engine:selectFieldResurrections", [
    available.map(marshalDurable),
    requested.map((handle) => ({ $tag: "FieldRef", handle })),
  ]) as { $tag: "Ok"; _0: any[] } | { $tag: "Err"; _0: FieldAuthoringDiagnostic };
  return result.$tag === "Err"
    ? { ok: false, error: result._0 }
    : { ok: true, value: result._0.map(unmarshalDurable) };
}

function presentationMaybe(value: unknown): FenelMaybe<unknown> {
  if (value !== null && typeof value === "object" && "$tag" in value) {
    const tag = (value as { $tag?: unknown }).$tag;
    if (tag === "Nothing" || tag === "Just") return value as FenelMaybe<unknown>;
  }
  return value === undefined ? NOTHING : just(value);
}

function validateCanonicalFieldDeclarations(
  identities: readonly FieldIdentity[],
): { ok: true } | { ok: false; error: FieldAuthoringDiagnostic } {
  const result = dispatchEngineBody("engine:validateCanonicalFieldDeclarations", [
    identities.map((identity) => ({
      $tag: "FieldDeclarationPresentation",
      qualifiedName: identity.qualifiedName,
      label: presentationMaybe(identity.sourceField.label),
      display: presentationMaybe(identity.sourceField.ui),
    })),
  ]) as { $tag: "Ok"; _0: boolean } | { $tag: "Err"; _0: FieldAuthoringDiagnostic };
  return result.$tag === "Err" ? { ok: false, error: result._0 } : { ok: true };
}

function validateFieldResurrectionUses(
  selected: readonly DurableFieldEntity[],
  identities: readonly FieldIdentity[],
): { ok: true } | { ok: false; error: FieldAuthoringDiagnostic } {
  const result = dispatchEngineBody("engine:validateFieldResurrectionUses", [
    selected.map(marshalDurable),
    identities.map(marshalOccurrence),
  ]) as { $tag: "Ok"; _0: boolean } | { $tag: "Err"; _0: FieldAuthoringDiagnostic };
  return result.$tag === "Err" ? { ok: false, error: result._0 } : { ok: true };
}

function validateFieldTombstoneReferences(
  tombstones: readonly DurableFieldEntity[],
  selected: readonly DurableFieldEntity[],
  identities: readonly FieldIdentity[],
): { ok: true } | { ok: false; error: FieldAuthoringDiagnostic } {
  const result = dispatchEngineBody("engine:validateFieldTombstoneReferences", [
    tombstones.map(marshalDurable),
    selected.map(marshalDurable),
    identities.map(marshalOccurrence),
  ]) as { $tag: "Ok"; _0: boolean } | { $tag: "Err"; _0: FieldAuthoringDiagnostic };
  return result.$tag === "Err" ? { ok: false, error: result._0 } : { ok: true };
}

function validateFieldReuseVisibility(
  fields: readonly DurableFieldEntity[],
  identities: readonly FieldIdentity[],
): { ok: true } | { ok: false; error: FieldAuthoringDiagnostic } {
  const result = dispatchEngineBody("engine:validateFieldReuseVisibility", [
    fields.map(marshalDurable),
    identities.map(marshalOccurrence),
  ]) as { $tag: "Ok"; _0: boolean } | { $tag: "Err"; _0: FieldAuthoringDiagnostic };
  return result.$tag === "Err" ? { ok: false, error: result._0 } : { ok: true };
}

function applyOwnerMutations(
  current: readonly FieldOwnerDefinition[],
  mutations: readonly FieldOwnerMutation[],
): { ok: true; value: FieldOwnerDefinition[] } | { ok: false; error: FieldAuthoringDiagnostic } {
  const result = dispatchEngineBody("engine:applyFieldOwnerMutationsKernel", [
    current.map(marshalOwnerDefinition),
    mutations.map(marshalMutation),
  ]) as { $tag: "Ok"; _0: any[] } | { $tag: "Err"; _0: FieldAuthoringDiagnostic };
  return result.$tag === "Err"
    ? { ok: false, error: result._0 }
    : { ok: true, value: result._0.map(unmarshalOwnerDefinition) };
}

/** B3 preflight projection of the existing owner-mutation kernel. Derived
 * constructor Function rows join the same bundle before field validation. */
export function projectFieldOwnerMutations(current: readonly FieldOwnerDefinition[],
  mutations: readonly FieldOwnerMutation[]): readonly FieldOwnerDefinition[] {
  const result = applyOwnerMutations(current, mutations);
  if (!result.ok) throw new FieldAuthoringError(result.error);
  return result.value;
}

export function tryPlanFieldPersistence(
  input: FieldPersistenceInput,
): { ok: true; value: FieldPersistencePlan } | { ok: false; error: FieldAuthoringDiagnostic } {
  try {
    const applied = applyOwnerMutations(input.currentOwners, input.ownerMutations);
    if (!applied.ok) return applied;
    // Inspect the proposed owner graph against repository reservations only;
    // editing a retained account UUID is allowed, and deleting a corrupt owner
    // can repair the graph. A reference to a repository definition is not a claim.
    assertOwnedDefinitionIdentities(applied.value.map(owner => owner.definition.id), repositoryIdentityKinds());
    const repositoryFields = input.repositoryFields ?? [];
    const prepared = prepareFieldAuthoringInventory(
      input.currentFields,
      repositoryFields,
      input.identityKinds,
    );
    if (!prepared.ok) return prepared;
    const selectedResurrections = selectFieldResurrections(
      [...input.currentFields, ...repositoryFields],
      input.resurrectFieldIds ?? [],
    );
    if (!selectedResurrections.ok) return selectedResurrections;
    // Normalize the server-loaded graph as an integrity check even though the
    // Fenel persistence kernel only needs its stored owner/Field/facet rows.
    // This rejects corrupt current identities before planning a desired diff.
    normalizeOwners(
      input.currentIdentityOwners ?? input.currentOwners,
      prepared.value.currentAvailable,
      prepared.value.identityKinds,
    );
    const desired = normalizeOwners(
      applied.value,
      prepared.value.desiredAvailable,
      prepared.value.identityKinds,
      prepared.value.mutableCodeableIds,
    );
    const reuseVisibility = validateFieldReuseVisibility(
      [...input.currentFields, ...repositoryFields],
      desired.occurrences,
    );
    if (!reuseVisibility.ok) return reuseVisibility;
    const tombstoneReferences = validateFieldTombstoneReferences(
      prepared.value.accountTombstones,
      selectedResurrections.value,
      desired.occurrences,
    );
    if (!tombstoneReferences.ok) return tombstoneReferences;
    const canonical = validateCanonicalFieldDeclarations(desired.occurrences);
    if (!canonical.ok) return canonical;
    const resurrectionUses = validateFieldResurrectionUses(
      selectedResurrections.value,
      desired.occurrences,
    );
    if (!resurrectionUses.ok) return resurrectionUses;
    const desiredFields = selectDesiredAccountFields(
      desired.entities,
      prepared.value.repositoryIds,
    );
    const kernelInput = {
      $tag: "FieldAuthoringPlanInput",
      currentOwners: input.currentOwners.map(marshalOwnerDefinition),
      desiredOwners: applied.value.map(marshalOwnerDefinition),
      currentFields: input.currentFields.map(marshalDurable),
      desiredFields,
      currentFacets: input.currentFacets.map(marshalFacet),
      desiredFacets: (input.desiredFacets ?? []).map(marshalDesiredFacet),
      replaceFacetFields: (input.replaceFacetFieldIds ?? []).map((handle) => ({
        $tag: "FieldRef",
        handle,
      })),
      storageIssues: (input.storageIssues ?? []).map((issue) => ({
        $tag: "FieldStorageIssue",
        ...issue,
        rowIds: [...issue.rowIds],
      })),
    };
    const result = dispatchEngineBody("engine:planFieldPersistenceKernel", [kernelInput]) as
      | { $tag: "Ok"; _0: any }
      | { $tag: "Err"; _0: FieldAuthoringDiagnostic };
    if (result.$tag === "Err") return { ok: false, error: result._0 };
    const plan = result._0;
    return {
      ok: true,
      value: {
        ownerUpserts: plan.ownerUpserts.map(unmarshalOwnerDefinition),
        ownerDeletes: plan.ownerDeletes.map(unmarshalOwnerDefinition),
        fieldUpserts: plan.fieldUpserts.map(unmarshalDurable),
        fieldTombstones: plan.fieldTombstones.map(unmarshalDurable),
        facetUpserts: plan.facetUpserts.map(unmarshalFacet),
        facetDeletes: plan.facetDeletes.map(unmarshalFacet),
        retainedFacets: plan.retainedFacets.map(unmarshalFacet),
        snapshot: {
          owners: plan.snapshot.owners.map(unmarshalOwnerDefinition),
          fields: plan.snapshot.fields.map(unmarshalDurable),
          facets: plan.snapshot.facets.map(unmarshalFacet),
        },
      },
    };
  } catch (error) {
    const diagnostic = (error as { diagnostic?: FieldAuthoringDiagnostic | FieldIdentityDiagnostic }).diagnostic;
    if (diagnostic !== undefined) return { ok: false, error: diagnostic };
    throw error;
  }
}

export function planFieldPersistence(input: FieldPersistenceInput): FieldPersistencePlan {
  const result = tryPlanFieldPersistence(input);
  if (!result.ok) throw new FieldAuthoringError(result.error);
  return result.value;
}

/** A2/B3 explicit-write transport. Fenel selects constructor occurrences and
 * identity actions; the supplied browser crypto leaf provides entropy only
 * for a requested mint. All resulting values use ordinary Function owners. */
export function prepareLocalConstructorFunctionMutations(sourceId: string,
  current: FieldPersistenceSnapshot, desired: FieldPersistenceSnapshot,
  mutations: readonly FieldOwnerMutation[], mintId: () => string,
  identityKinds: ReadonlyMap<string, string> = new Map()): FieldOwnerMutation[] {
  const { projectLocalFieldRegistrySnapshot } = engineRequire("account-field-registry") as
    typeof import("./account-field-registry");
  const { compileConstructorCatalogCandidates } = engineRequire("compile-field-slots") as
    typeof import("./compile-field-slots");
  const { createConstructorFunctionSpec } = engineRequire("registry") as typeof import("./registry");
  const mutationRows = mutations.map(mutation =>
    mutation.kind === "upsert" ? { kind: mutation.kind, ownerKey: mutation.owner.ownerKey, ownerKind: mutation.owner.kind }
      : { kind: mutation.kind, ownerKey: mutation.ownerKey, ownerKind: mutation.ownerKind });
  const types = dispatchEngineBody("engine:localConstructorSelectedTypes", [mutationRows, desired.owners]) as
    FieldOwnerDefinition[];
  const projected = projectLocalFieldRegistrySnapshot(sourceId, { ...desired, owners: types });
  const entities = projected.ownerModules.flatMap(module => module.entities ?? []);
  const candidates = compileConstructorCatalogCandidates({ listIdentifiedEntities: () => entities });
  const ownPath = (root: unknown, path: readonly (string | number)[]): unknown => {
    let value = root;
    for (const segment of path) {
      const slot = value != null && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, segment) : undefined;
      if (slot && !("value" in slot)) throw new TypeError("constructor occurrence metadata must be own data");
      value = slot?.value;
    }
    return value;
  };
  const priorTypes = dispatchEngineBody("engine:localConstructorTouchedTypes", [mutationRows, current.owners]) as
    FieldOwnerDefinition[];
  const priorModules = projectLocalFieldRegistrySnapshot(sourceId, { ...current, owners: priorTypes }).ownerModules;
  const priorCandidates = compileConstructorCatalogCandidates({ listIdentifiedEntities: () =>
    priorModules.flatMap(module => module.entities ?? []) });
  const priorRows = priorCandidates.map(candidate => ({ ownerId: candidate.ownerId, retained: maybe(ownPath(
    priorTypes.find(owner => owner.definition.id === candidate.ownerId)!.definition,
    [...candidate.functionPath, "$ref"]) as string | undefined) }));
  const currentFunctions = dispatchEngineBody("engine:localConstructorOwnedFunctionIds", [current.owners]) as string[];
  const rows = candidates.map(candidate => {
    const owner = types.find(owner => owner.definition.id === candidate.ownerId)!;
    const retained = ownPath(owner.definition, [...candidate.functionPath, "$ref"]) as string | undefined;
    const prior = current.owners.find(value => value.ownerKey === owner.ownerKey);
    const priorId = prior
      ? ownPath(prior.definition, [...candidate.functionPath, "$ref"]) as string | undefined : undefined;
    const choice = dispatchEngineBody("engine:localConstructorRetainedChoice", [candidate.kind, maybe(retained), maybe(priorId)]) as
      { $tag: "Ok"; _0: FenelMaybe<string> } | { $tag: "Err"; _0: string };
    if (choice.$tag === "Err") throw new TypeError(choice._0);
    // B3 exact captured-owner join; the action kernel decides whether this
    // provenance authorizes retaining a Function identity.
    const priorFunctions = priorRows.filter(row => row.ownerId === candidate.ownerId)
      .flatMap(row => row.retained.$tag === "Just" ? [row.retained._0] : []);
    return { ownerKey: owner.ownerKey, ownerId: candidate.ownerId, candidate, retained: choice._0,
      currentFunctions, priorFunctions };
  });
  const functionIds = dispatchEngineBody("engine:localConstructorOwnedFunctionIds", [desired.owners]) as string[];
  const actions = dispatchEngineBody("engine:localConstructorFunctionActions", [rows, functionIds]) as
    { $tag: "Ok"; _0: Array<{ mint: boolean; row: typeof rows[number] }> } | { $tag: "Err"; _0: string };
  if (actions.$tag === "Err") throw new TypeError(actions._0);
  const patched = new Map<string, FieldOwnerDefinition>();
  const functionMutations: FieldOwnerMutation[] = [];
  const desiredFunctionIds: string[] = [];
  // B3 NamedField wire extraction from the already classified parameter slots.
  const parameterIdentities = candidates.flatMap(candidate => candidate.fields.flatMap(slot =>
    slot.key.$tag === "NamedField" ? [slot.key.ref.$ref] : []));
  const heldIdentities = [...identityKinds.keys(), ...desired.owners.map(owner => owner.definition.id),
    ...desired.fields.map(field => field.id), ...parameterIdentities];
  for (const action of actions._0) {
    const functionId = action.mint ? mintId() : unwrap(action.row.retained)!;
    if (action.mint) {
      const allocated = dispatchEngineBody("engine:localConstructorMintIdentity", [functionId,
        [...heldIdentities, ...desiredFunctionIds]]) as { $tag: "Ok"; _0: string } | { $tag: "Err"; _0: string };
      if (allocated.$tag === "Err") throw new TypeError(allocated._0);
    }
    const choice = dispatchEngineBody("engine:compilerConstructorFunctionChoice", [maybe(functionId), NOTHING]) as
      { $tag: "Ok"; _0: FenelMaybe<string> } | { $tag: "Err"; _0: string };
    if (choice.$tag === "Err") throw new TypeError(choice._0);
    desiredFunctionIds.push(functionId);
    const original = types.find(owner => owner.ownerKey === action.row.ownerKey)!;
    const owner = patched.get(original.ownerKey) ?? structuredClone(original);
    let target = owner.definition as unknown as Record<string | number, unknown>;
    const path = action.row.candidate.functionPath;
    for (const segment of path.slice(0, -1)) target = target[segment] as Record<string | number, unknown>;
    target[path.at(-1)!] = { $ref: functionId };
    patched.set(owner.ownerKey, owner);
    const metadata = dispatchEngineBody("engine:localConstructorFunctionOwnerMetadata", [functionId]) as
      { ownerKey: string; kind: "function"; storageName: string };
    functionMutations.push({ kind: "upsert", owner: { ...metadata,
      definition: createConstructorFunctionSpec(action.row.candidate as CompileConstructorCandidate, functionId) } });
  }
  const priorFunctionIds = priorRows.flatMap(row => row.retained.$tag === "Just" ? [row.retained._0] : []);
  const removed = dispatchEngineBody("engine:localConstructorRemovedFunctions", [priorFunctionIds, desiredFunctionIds]) as string[];
  for (const id of removed) {
    const metadata = dispatchEngineBody("engine:localConstructorFunctionOwnerMetadata", [id]) as
      { ownerKey: string; kind: "function"; storageName: string };
    functionMutations.push({ kind: "delete", ownerKey: metadata.ownerKey, ownerKind: metadata.kind, storageName: metadata.storageName });
  }
  // B3 exact owner-key transport: an explicitly supplied ordinary Function
  // row is already in the bundle. The registry's canonical body proof checks
  // it; a derived duplicate must neither overwrite it nor run twice.
  const suppliedKeys = mutations.map(mutation => mutation.kind === "upsert" ? mutation.owner.ownerKey : mutation.ownerKey);
  const derived = functionMutations.filter(mutation => !suppliedKeys.includes(
    mutation.kind === "upsert" ? mutation.owner.ownerKey : mutation.ownerKey));
  return [...mutations.map(mutation => mutation.kind === "upsert" && patched.has(mutation.owner.ownerKey)
    ? { kind: "upsert" as const, owner: patched.get(mutation.owner.ownerKey)! } : mutation), ...derived];
}

function marshalDraft(draft: FieldOccurrenceDraft): unknown {
  const action = draft.action.kind === "new"
    ? { $tag: "NewField", field: { $tag: "FieldRef", handle: draft.action.fieldId } }
    : draft.action.kind === "reuse"
      ? { $tag: "ReuseField", field: { $tag: "FieldRef", handle: draft.action.fieldId } }
      : { $tag: "ResurrectField", field: { $tag: "FieldRef", handle: draft.action.fieldId } };
  return {
    $tag: "FieldOccurrenceDraft",
    draftId: draft.draftId,
    owner: draft.owner,
    action,
    codeName: draft.codeName,
    occurrenceType: draft.occurrenceType,
    facets: {
      $tag: "DesiredFieldFacets",
      label: maybe(draft.facets.label),
      description: maybe(draft.facets.description),
      icon: maybe(draft.facets.icon),
      display: maybe(draft.facets.display),
    },
    contextualOverride: draft.contextualOverride === undefined
      ? NOTHING
      : just({
          $tag: "FieldPresentationOverride",
          label: maybe(draft.contextualOverride.label),
          description: maybe(draft.contextualOverride.description),
          icon: maybe(draft.contextualOverride.icon),
          display: maybe(draft.contextualOverride.display),
        }),
  };
}

function unmarshalDesiredFacets(value: any): DesiredFieldFacets {
  const label = unwrap(value.label as FenelMaybe<LocaleString>);
  const description = unwrap(value.description as FenelMaybe<string>);
  const icon = unwrap(value.icon as FenelMaybe<string>);
  const display = unwrap(value.display as FenelMaybe<EditDisplay>);
  return {
    ...(label === undefined ? {} : { label }),
    ...(description === undefined ? {} : { description }),
    ...(icon === undefined ? {} : { icon }),
    ...(display === undefined ? {} : { display }),
  };
}

export function tryNormalizeFieldOccurrenceDraft(
  draft: FieldOccurrenceDraft,
  available: readonly DurableFieldEntity[],
): { ok: true; value: NormalizedFieldOccurrenceDraft } | { ok: false; error: FieldAuthoringDiagnostic } {
  const result = dispatchEngineBody("engine:normalizeFieldOccurrenceDraft", [
    marshalDraft(draft),
    available.map(marshalDurable),
  ]) as { $tag: "Ok"; _0: any } | { $tag: "Err"; _0: FieldAuthoringDiagnostic };
  if (result.$tag === "Err") return { ok: false, error: result._0 };
  return {
    ok: true,
    value: {
      draftId: result._0.draftId,
      owner: draft.owner,
      fieldId: result._0.field.handle,
      codeName: result._0.codeName,
      occurrenceType: result._0.occurrenceType,
      facets: unmarshalDesiredFacets(result._0.facets),
      ...(draft.contextualOverride === undefined
        ? {}
        : { contextualOverride: draft.contextualOverride }),
    },
  };
}

export function normalizeFieldOccurrenceDraft(
  draft: FieldOccurrenceDraft,
  available: readonly DurableFieldEntity[],
): NormalizedFieldOccurrenceDraft {
  const result = tryNormalizeFieldOccurrenceDraft(draft, available);
  if (!result.ok) throw new FieldAuthoringError(result.error);
  return result.value;
}

export type NamedFieldReconciliationPrior = {
  readonly priorIndex: number;
  readonly fieldId: string;
  readonly codeName: string;
};

export type NamedFieldReconciliationParsed = {
  readonly codeName: string;
};

export type NamedFieldReconciliationAction =
  | {
      readonly kind: "keep";
      readonly parsedIndex: number;
      readonly priorIndex: number;
      readonly fieldId: string;
    }
  | { readonly kind: "mint"; readonly parsedIndex: number };

/** Structural bridge for the Fenel-owned exact → positional → mint
 * reconciliation policy. This function returns explicit actions; it never
 * materializes entropy. */
export function planNamedFieldOccurrenceReconciliation(
  prior: readonly NamedFieldReconciliationPrior[],
  parsed: readonly NamedFieldReconciliationParsed[],
): NamedFieldReconciliationAction[] {
  const result = dispatchEngineBody("engine:reconcileNamedFieldOccurrencesKernel", [
    prior.map((field) => ({
      $tag: "FieldReconcilePrior",
      index: field.priorIndex,
      field: { $tag: "FieldRef", handle: field.fieldId },
      codeName: field.codeName,
    })),
    parsed.map((field, index) => ({
      $tag: "FieldReconcileParsed",
      index,
      codeName: field.codeName,
    })),
  ]) as Array<
    | {
        $tag: "KeepReconciledField";
        parsedIndex: number;
        priorIndex: number;
        field: { handle: string };
      }
    | { $tag: "MintReconciledField"; parsedIndex: number }
  >;
  return result.map((action) => action.$tag === "KeepReconciledField"
    ? {
        kind: "keep",
        parsedIndex: action.parsedIndex,
        priorIndex: action.priorIndex,
        fieldId: action.field.handle,
      }
    : { kind: "mint", parsedIndex: action.parsedIndex });
}

export function createNewFieldOccurrenceDraft(input: {
  readonly draftId: string;
  readonly fieldId: string;
  readonly owner: FieldOwner;
  readonly codeName: string;
  readonly occurrenceType: FenelType;
  readonly facets?: DesiredFieldFacets;
  readonly contextualOverride?: FieldContextualPresentationOverride;
}): FieldOccurrenceDraft {
  return {
    ...input,
    action: { kind: "new", fieldId: input.fieldId },
    facets: input.facets ?? {},
  };
}

export function fieldDefToOccurrenceDraft(
  field: FieldDef,
  options: {
    readonly owner: FieldOwner;
    readonly draftId?: string;
    readonly action?: "reuse" | "resurrect";
    readonly facets?: DesiredFieldFacets;
    readonly contextualOverride?: FieldContextualPresentationOverride;
  },
): FieldOccurrenceDraft {
  if (field.key?.$tag !== "NamedField") {
    throw new Error("fieldDefToOccurrenceDraft: named FieldDef requires an explicit NamedField key");
  }
  const fieldId = field.key.ref.$ref;
  return {
    draftId: options.draftId ?? fieldId,
    owner: options.owner,
    action: { kind: options.action ?? "reuse", fieldId },
    codeName: field.name,
    occurrenceType: field.type,
    facets: options.facets ?? {},
    ...(options.contextualOverride === undefined
      ? {}
      : { contextualOverride: options.contextualOverride }),
  };
}

export function fieldOccurrenceDraftToFieldDef(
  draft: FieldOccurrenceDraft | NormalizedFieldOccurrenceDraft,
): FieldDef {
  const fieldId = "fieldId" in draft ? draft.fieldId : draft.action.fieldId;
  return {
    name: draft.codeName,
    key: { $tag: "NamedField", ref: { $ref: fieldId } },
    type: draft.occurrenceType,
    label: Nothing,
    ui: Nothing,
    meta: {},
  };
}

export function durableFieldToStorageData(field: DurableFieldEntity): unknown {
  return dispatchEngineBody("engine:durableFieldStorageData", [marshalDurable(field)]);
}

export function durableFieldFromStorageData(id: string, data: unknown): DurableFieldEntity {
  return unmarshalDurable(dispatchEngineBody("engine:durableFieldFromStorageData", [
    { $tag: "FieldRef", handle: id },
    data,
  ]));
}

export type LegacyFieldMigrationInput = {
  readonly owners: readonly FieldOwnerDefinition[];
  readonly mintedFieldIds: ReadonlyMap<string, string>;
  readonly currentFacets?: readonly FieldFacetValue[];
  readonly repositoryFields?: readonly DurableFieldEntity[];
  readonly identityKinds?: ReadonlyMap<string, string>;
};

export type LegacyFieldMigrationProjection = {
  readonly owners: readonly FieldOwnerDefinition[];
  readonly fields: readonly DurableFieldEntity[];
  readonly facets: readonly DesiredFieldFacetValue[];
};

export function tryMigrateLegacyFieldDefinitions(
  input: LegacyFieldMigrationInput,
): { ok: true; value: LegacyFieldMigrationProjection } | { ok: false; error: FieldAuthoringDiagnostic } {
  const roots = input.owners.map((owner) => ownerRoot(owner, "repository-source"));
  const repositoryFields = input.repositoryFields ?? [];
  const preparedRepository = prepareFieldAuthoringInventory(
    [],
    repositoryFields,
    input.identityKinds,
  );
  if (!preparedRepository.ok) return preparedRepository;
  const lock = new Map(input.mintedFieldIds);
  let first = tryNormalizeFieldDeclarations(roots, {
    mode: "collect-requirements",
    lock,
    externalFields: preparedRepository.value.currentAvailable.map(externalDescriptor),
    identityKinds: preparedRepository.value.identityKinds,
  });
  if (!first.ok) return { ok: false, error: first.error };
  let addedPreferred = false;
  for (const request of first.value.lockRequests) {
    if (!lock.has(request.name) && request.preferredId !== undefined) {
      lock.set(request.name, request.preferredId);
      addedPreferred = true;
    }
  }
  const missingRequest = first.value.lockRequests.find((request) => !lock.has(request.name));
  if (missingRequest !== undefined) {
    return {
      ok: false,
      error: {
        $tag: "LegacyFieldMigrationMissingId",
        message: `field migration: no stable minted UUID supplied for ${missingRequest.name}`,
        qualifiedName: missingRequest.name,
      },
    };
  }
  if (addedPreferred || first.value.needsMint.length > 0) {
    first = tryNormalizeFieldDeclarations(roots, {
      mode: "collect-requirements",
      lock,
      externalFields: preparedRepository.value.currentAvailable.map(externalDescriptor),
      identityKinds: preparedRepository.value.identityKinds,
    });
    if (!first.ok) return { ok: false, error: first.error };
  }
  if (first.value.needsMint.length > 0) {
    const missing = first.value.needsMint[0]!;
    const missingQualifiedName = qualifiedFieldName(missing.owner, missing.path);
    return {
      ok: false,
      error: {
        $tag: "LegacyFieldMigrationMissingId",
        message: `field migration: no stable minted UUID supplied for ${missingQualifiedName}`,
        qualifiedName: missingQualifiedName,
      },
    };
  }
  const identities = first.value.occurrences;
  const legacyIdentityValidation = dispatchEngineBody("engine:validateLegacyFieldIdentities", [
    identities.map((identity) => ({
      $tag: "LegacyFieldIdentity",
      field: {
        $tag: "FieldRef",
        handle: identity.field.key.$tag === "NamedField"
          ? identity.field.key.ref.$ref
          : identity.field.name,
      },
      qualifiedName: identity.qualifiedName,
      codeName: identity.field.name,
      uuidAsName: identity.ingress === "legacy-uuid-name",
    })),
  ]) as { $tag: "Ok"; _0: boolean } | { $tag: "Err"; _0: FieldAuthoringDiagnostic };
  if (legacyIdentityValidation.$tag === "Err") {
    return { ok: false, error: legacyIdentityValidation._0 };
  }
  const owners = input.owners.map((owner, index): FieldOwnerDefinition => {
    const viewPlan = first.value.viewPlans[index];
    if (viewPlan === undefined) {
      throw new Error(`field migration: missing identified-view plan for root${index}`);
    }
    if (owner.kind === "type") {
      return {
        ...owner,
        definition: {
          ...owner.definition,
          type: identifiedDefinitionView(owner.definition.type, viewPlan, {
            clearInlinePresentation: true,
          }),
        },
      };
    }
    return {
      ...owner,
      definition: identifiedDefinitionView(owner.definition, viewPlan, {
        clearInlinePresentation: true,
      }),
    };
  });
  const legacy = identities
    .filter((identity) => identity.field.key.$tag === "NamedField")
    .map((identity) => ({
      $tag: "LegacyFieldPresentation",
      field: { $tag: "FieldRef", handle: identity.field.key.$tag === "NamedField" ? identity.field.key.ref.$ref : "" },
      qualifiedName: identity.qualifiedName,
      codeName: identity.field.name,
      label: identity.sourceField.label?.$tag === "Just" || identity.sourceField.label?.$tag === "Nothing"
        ? identity.sourceField.label
        : NOTHING,
      display: identity.sourceField.ui?.$tag === "Just" || identity.sourceField.ui?.$tag === "Nothing"
        ? identity.sourceField.ui
        : NOTHING,
    }));
  const classified = dispatchEngineBody("engine:classifyLegacyFieldPresentation", [legacy]) as any;
  if (classified === null || typeof classified !== "object" || !Array.isArray(classified.facets)) {
    return {
      ok: false,
      error: {
        $tag: "LegacyFieldMigrationAmbiguous",
        message: "field migration: Fenel legacy presentation classifier returned an invalid projection",
        qualifiedName: legacy[0]?.qualifiedName ?? "",
      },
    };
  }
  const mergedFacets = dispatchEngineBody("engine:mergeLegacyFieldFacets", [
    (input.currentFacets ?? []).map(marshalFacet),
    classified.facets,
  ]) as { $tag: "Ok"; _0: any[] } | { $tag: "Err"; _0: FieldAuthoringDiagnostic };
  if (mergedFacets.$tag === "Err") return { ok: false, error: mergedFacets._0 };
  const fields = (dispatchEngineBody("engine:selectMigratedAccountFields", [
    first.value.entities.map(marshalFieldEntity),
    repositoryFields.map((field) => ({ $tag: "FieldRef", handle: field.id })),
  ]) as any[]).map(unmarshalDurable);
  return {
    ok: true,
    value: {
      owners,
      fields,
      facets: mergedFacets._0.map((facet) => ({
        fieldId: facet.field.handle,
        typeName: facet.typeName,
        methods: facet.methods,
      })),
    },
  };
}

export function migrateLegacyFieldDefinitions(
  input: LegacyFieldMigrationInput,
): LegacyFieldMigrationProjection {
  const result = tryMigrateLegacyFieldDefinitions(input);
  if (!result.ok) throw new FieldAuthoringError(result.error);
  return result.value;
}

export type FieldReuseCatalogCandidate = {
  readonly fieldId: string;
  readonly codeName: string;
  readonly label?: LocaleString;
  readonly owners: readonly string[];
  readonly occurrenceTypes: readonly FenelType[];
  readonly status: "live" | "tombstoned";
  readonly realm: "account" | "repository";
  readonly reuseVisibility: "owner" | "account" | "repository";
};

export type FieldReuseCatalogRow = Pick<
  FieldReuseCatalogCandidate,
  "fieldId" | "codeName" | "label" | "owners" | "occurrenceTypes" | "realm" | "reuseVisibility"
>;

export type FieldReuseCatalogQuery = {
  readonly search?: string;
  readonly cursor?: string;
  readonly limit?: number;
};

export type FieldReuseCatalogPage = {
  readonly fields: readonly FieldReuseCatalogRow[];
  readonly nextCursor?: string;
};

export type FieldResurrectionCatalogRow = {
  readonly fieldId: string;
  readonly codeName: string;
};

/** Owner-scoped tombstone catalog. Its Fenel body compares the retained origin
 * with the exact owner; this is intentionally separate from live reuse. */
export function queryFieldResurrectionCandidates(
  owner: FieldOwnerDefinition,
  fields: readonly DurableFieldEntity[],
): readonly FieldResurrectionCatalogRow[] {
  const result = dispatchEngineBody("engine:queryFieldResurrectionCandidates", [
    marshalOwnerDefinition(owner),
    fields.map(marshalDurable),
  ]) as Array<{ field: { handle: string }; codeName: string }>;
  return result.map((candidate) => ({
    fieldId: candidate.field.handle,
    codeName: candidate.codeName,
  }));
}

export function queryFieldResurrectionsByTarget(owners: readonly FieldOwnerDefinition[], fields: readonly DurableFieldEntity[],
  target: { ownerKey: string; ownerKind: "type" | "function"; storageName: string }): readonly FieldResurrectionCatalogRow[] {
  const result = dispatchEngineBody("engine:queryFieldResurrectionsByTarget", [owners.map(marshalOwnerDefinition),
    fields.map(marshalDurable), target.ownerKey, target.ownerKind, target.storageName]) as
    | { $tag: "Ok"; _0: Array<{ field: { handle: string }; codeName: string }> } | { $tag: "Err"; _0: string };
  if (result.$tag === "Err") throw new Error(result._0);
  return result._0.map(candidate => ({ fieldId: candidate.field.handle, codeName: candidate.codeName }));
}

export function queryFieldReuseCatalogCandidates(
  candidates: readonly FieldReuseCatalogCandidate[],
  query: FieldReuseCatalogQuery = {},
): FieldReuseCatalogPage {
  const marshalled = candidates.map((entry) => ({
    $tag: "FieldReuseCatalogEntry",
    fieldId: entry.fieldId,
    codeName: entry.codeName,
    label: maybe(entry.label),
    owners: [...entry.owners],
    occurrenceTypes: [...entry.occurrenceTypes],
    status: { $tag: entry.status === "live" ? "FieldLive" : "FieldTombstoned" },
    realm: { $tag: entry.realm === "account" ? "DurableAccountField" : "DurableRepositoryField" },
    reuseVisibility: {
      $tag: entry.reuseVisibility === "owner"
        ? "FieldOwnerOnly"
        : entry.reuseVisibility === "account"
          ? "FieldAccountReusable"
          : "FieldRepositoryReusable",
    },
  }));
  const result = dispatchEngineBody("engine:queryFieldReuseCatalog", [
    marshalled,
    query.search ?? "",
    query.cursor ?? "",
    maybe(query.limit),
  ]) as { fields: any[]; nextCursor: FenelMaybe<number> };
  const nextCursor = unwrap(result.nextCursor);
  return {
    fields: result.fields.map((entry) => {
      const label = unwrap(entry.label as FenelMaybe<LocaleString>);
      return {
        fieldId: entry.fieldId,
        codeName: entry.codeName,
        ...(label === undefined ? {} : { label }),
        owners: entry.owners,
        occurrenceTypes: entry.occurrenceTypes,
        realm: entry.realm.$tag === "DurableAccountField" ? "account" : "repository",
        reuseVisibility: entry.reuseVisibility.$tag === "FieldOwnerOnly"
          ? "owner"
          : entry.reuseVisibility.$tag === "FieldAccountReusable"
            ? "account"
            : "repository",
      };
    }),
    ...(nextCursor === undefined ? {} : { nextCursor: String(nextCursor) }),
  };
}

export function accountFieldReuseCatalogCandidates(input: {
  readonly owners: readonly FieldOwnerDefinition[];
  readonly fields: readonly DurableFieldEntity[];
  readonly facets: readonly FieldFacetValue[];
  /** Repository Fields needed to normalize account occurrences are context,
   * not account catalog rows, and are therefore never returned below. */
  readonly externalFields?: readonly DurableFieldEntity[];
}): readonly FieldReuseCatalogCandidate[] {
  return authoredFieldReuseCatalogCandidates(input, "account-authored");
}

/** The same identified occurrence/catalog projection under strict transient
 * ownership. Legacy persistence-row realm words stay internal transport. */
export function localFieldReuseCatalogCandidates(input: {
  readonly owners: readonly FieldOwnerDefinition[];
  readonly fields: readonly DurableFieldEntity[];
  readonly facets: readonly FieldFacetValue[];
  readonly externalFields?: readonly DurableFieldEntity[];
}): readonly FieldReuseCatalogCandidate[] {
  return authoredFieldReuseCatalogCandidates(input, "transient-draft");
}

function authoredFieldReuseCatalogCandidates(input: {
  readonly owners: readonly FieldOwnerDefinition[];
  readonly fields: readonly DurableFieldEntity[];
  readonly facets: readonly FieldFacetValue[];
  readonly externalFields?: readonly DurableFieldEntity[];
}, realm: "account-authored" | "transient-draft"): readonly FieldReuseCatalogCandidate[] {
  const prepared = prepareFieldAuthoringInventory(
    input.fields,
    input.externalFields ?? [],
  );
  if (!prepared.ok) throw new FieldAuthoringError(prepared.error);
  const collection = normalizeFieldDeclarations(
    input.owners.map((owner) => ownerRoot(owner, realm)),
    {
      mode: "strict-embedded",
      externalFields: prepared.value.currentAvailable.map(externalDescriptor),
      identityKinds: prepared.value.identityKinds,
    },
  );
  const entities = new Map(collection.entities.map((entity) => [entity.id, entity]));
  const labels = new Map(
    input.facets
      .filter((facet) => facet.typeName === "Labelable")
      .map((facet) => [facet.fieldId, facet.methods.label as LocaleString]),
  );
  return input.fields.map((field) => {
    const entity = entities.get(field.id);
    const summary = dispatchEngineBody("engine:summarizeFieldReuseOccurrences", [
      (entity?.occurrences ?? []).map((occurrence) => ({
        $tag: "FieldReuseOccurrence",
        owner: qualifiedFieldName(occurrence.owner, []),
        occurrenceType: occurrence.field.type,
      })),
    ]) as { owners: string[]; occurrenceTypes: FenelType[] };
    const label = labels.get(field.id);
    return {
      fieldId: field.id,
      codeName: field.currentCodeName,
      ...(label === undefined ? {} : { label }),
      owners: summary.owners,
      occurrenceTypes: summary.occurrenceTypes,
      status: field.status,
      realm: field.realm,
      reuseVisibility: field.reuseVisibility,
    };
  });
}
