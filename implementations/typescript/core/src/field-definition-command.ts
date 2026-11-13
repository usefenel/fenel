import {
  executeFieldDefinitionCommandTransactionState,
  loadAccountFieldDefinitionGraphState,
  type FieldDefinitionStatePlanCurrent,
} from "@fenel/runtime/state-field-definitions";
import type {
  DesiredFieldFacetValue,
  FieldOwnerMutation,
  FieldOwnerDefinition,
  FieldPersistencePlan,
  FieldPersistenceSnapshot,
  FieldPersistenceInput,
} from "@fenel/engine/field-authoring";
import {
  accountFieldReuseCatalogCandidates,
  fieldPersistenceSnapshotMatches,
  queryFieldReuseCatalogCandidates,
  queryFieldResurrectionCandidates,
  type DurableFieldEntity,
  type FieldReuseCatalogCandidate,
  type FieldReuseCatalogPage,
  type FieldReuseCatalogQuery,
  type FieldReuseCatalogRow,
} from "@fenel/engine/field-authoring";
import type { FenelType, LocaleString } from "@fenel/engine/types";

export type FieldOwnerMutationRequest = FieldOwnerMutation;

export type SaveFieldDefinitionBundleRequest = {
  ownerMutations: FieldOwnerMutationRequest[];
  /** Optional opening graph for a deferred draft. Compared under the existing
   * account transaction lock; a mismatch refuses the entire bundle. */
  expectedSnapshot?: FieldPersistenceSnapshot;
  /** Tombstoned account Field UUIDs the caller explicitly intends to restore.
   * A NamedField ref alone is ordinary reuse and remains rejected. */
  resurrectFieldIds?: string[];
  /** Exact desired optional facets for the explicitly replaced field IDs. */
  desiredFacets?: DesiredFieldFacetValue[];
  /** Per-field replacement authority. Absent IDs retain their current facets;
   * listed IDs with no desired rows intentionally clear optional facets. */
  replaceFacetFieldIds?: string[];
};

export type FieldDefinitionCommandError = {
  $tag?: string;
  message: string;
  [key: string]: unknown;
};

export type FieldDefinitionCommandResult =
  | {
      ok: true;
      snapshot: FieldPersistencePlan["snapshot"];
    }
  | { ok: false; error: FieldDefinitionCommandError };

export class FieldDefinitionSnapshotIntegrityError extends Error {
  readonly diagnostic: FieldDefinitionCommandError;

  constructor(message: string, issues: readonly unknown[]) {
    super(message);
    this.name = "FieldDefinitionSnapshotIntegrityError";
    this.diagnostic = {
      $tag: "FieldDefinitionSnapshotIntegrity",
      message,
      issues,
    };
  }
}

type PlannerResult =
  | { ok: true; value: FieldPersistencePlan }
  | { ok: false; error: FieldDefinitionCommandError };

export type FieldDefinitionCommandDependencies = {
  plan: (input: FieldPersistenceInput) => PlannerResult;
  /** Test/integration seam for the pre-commit account-body proof. Production
   * uses the strict account registry below; injected planners may supply the
   * same proof without booting the complete repository corpus. */
  validateSnapshot?: (
    accountId: string,
    snapshot: FieldPersistenceSnapshot,
  ) => void | Promise<void>;
  executeTransaction: (
    accountId: string,
    planCurrent: FieldDefinitionStatePlanCurrent,
  ) => Promise<FieldPersistenceSnapshot>;
};

async function defaultPlan(
  input: Parameters<FieldDefinitionCommandDependencies["plan"]>[0],
): Promise<PlannerResult> {
  // Lazy to keep the DB/core import graph acyclic during engine bootstrap.
  const engine = await import("@fenel/engine/field-authoring") as unknown as {
    tryPlanFieldPersistence: (
      value: Parameters<FieldDefinitionCommandDependencies["plan"]>[0],
    ) => PlannerResult;
  };
  return engine.tryPlanFieldPersistence(input);
}

async function defaultValidateSnapshot(
  accountId: string,
  snapshot: FieldPersistenceSnapshot,
): Promise<void> {
  // Lazy imports keep the DB/core bootstrap graph acyclic. This is the strict
  // account-command edge: committed runtime hydration deliberately selects the
  // legacy-deferred posture in `createAccountFieldRegistry` instead.
  const [accountRegistry, manifest] = await Promise.all([
    import("@fenel/engine/account-field-registry"),
    import("@fenel/engine/module-manifest"),
  ]);
  const { loadAccountSourceModulesState } = await import("@fenel/runtime/source-module-runtime");
  const sourceRows = await loadAccountSourceModulesState(accountId);
  if (sourceRows.length) {
    const { prepareSourceModulesFromRows, validateSourceAwareAccountSnapshot } = await import("@fenel/engine/authoring/source-module");
    validateSourceAwareAccountSnapshot(accountId, snapshot, prepareSourceModulesFromRows(sourceRows));
    return;
  }
  accountRegistry.createAccountFieldRegistry(
    manifest.modulesFor("seed"),
    accountId,
    snapshot,
    {
      bodySpellingPolicy: "reject",
    },
  );
}

type RepositoryCatalogAdapter = {
  repositoryFieldCatalog?: () => {
    fields: readonly {
      fieldId: string;
      codeName: string;
      label?: LocaleString;
      owners: readonly string[];
      occurrenceTypes: readonly FenelType[];
      reuseVisibility: "owner" | "repository";
    }[];
    facetInterfaceNames: readonly string[];
  };
};

type RepositoryIdentityAdapter = {
  repositoryIdentityKinds?: () => Map<string, string>;
};

async function loadRepositoryCatalog(): Promise<{
  candidates: FieldReuseCatalogCandidate[];
  facetInterfaceNames: readonly string[];
  identityKinds: Map<string, string>;
}> {
  // Lazy explicit leaves keep core bootstrap acyclic and read each generated
  // artifact through its existing owner, independently of the engine barrel.
  const [catalogue, identity] = await Promise.all([
    import("@fenel/engine/repository-field-catalog") as Promise<RepositoryCatalogAdapter>,
    import("@fenel/engine/repository-identity-manifest") as Promise<RepositoryIdentityAdapter>,
  ]);
  const catalog = catalogue.repositoryFieldCatalog?.();
  const candidates = (catalog?.fields ?? []).map((field) => ({
    fieldId: field.fieldId,
    codeName: field.codeName,
    ...(field.label === undefined ? {} : { label: field.label }),
    owners: field.owners,
    occurrenceTypes: field.occurrenceTypes,
    status: "live" as const,
    realm: "repository" as const,
    reuseVisibility: field.reuseVisibility,
  }));
  return {
    candidates,
    facetInterfaceNames: catalog?.facetInterfaceNames ?? [],
    identityKinds: identity.repositoryIdentityKinds?.() ?? new Map(),
  };
}

function publicRepositoryFields(
  candidates: readonly FieldReuseCatalogCandidate[],
): DurableFieldEntity[] {
  const byId = new Map(candidates.map((candidate) => [candidate.fieldId, candidate]));
  const visible: DurableFieldEntity[] = [];
  let cursor: string | undefined;
  do {
    const page = queryFieldReuseCatalogCandidates(candidates, {
      ...(cursor === undefined ? {} : { cursor }),
      limit: 100,
    });
    for (const row of page.fields) {
      const source = byId.get(row.fieldId);
      if (!source) continue;
      visible.push({
        id: source.fieldId,
        currentCodeName: source.codeName,
        status: "live",
        realm: "repository",
        reuseVisibility: "repository",
      });
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return visible;
}

const DEFAULT_DEPENDENCIES: FieldDefinitionCommandDependencies = {
  // The public dependency is synchronous because the engine bridge is pure.
  // The default command resolves it lazily just below.
  plan: () => {
    throw new Error("field definition planner was not initialized");
  },
  executeTransaction: executeFieldDefinitionCommandTransactionState,
};

/** Initial authenticated hydration uses the exact committed graph shape
 * returned after a successful save. Ambiguous/version-shaped owner state is a
 * hard integrity error; serving an incomplete snapshot would make product
 * reads depend on whichever historical row happened to be selected. */
export async function loadFieldDefinitionBundleSnapshot(
  accountId: string,
): Promise<FieldPersistenceSnapshot> {
  const graph = await loadAccountFieldDefinitionGraphState(accountId);
  if (graph.storageIssues.length > 0) {
    throw new FieldDefinitionSnapshotIntegrityError(
      "Account field-definition snapshot contains ambiguous current owners",
      graph.storageIssues,
    );
  }
  return {
    owners: graph.currentOwners,
    fields: graph.currentFields,
    facets: graph.currentFacets,
  };
}

/** One server command for the complete account definition graph. The DB leaf
 * locks and reloads account state, then this callback delegates every semantic
 * choice to Fenel before the same transaction applies the decided plan. */
export async function saveFieldDefinitionBundle(
  accountId: string,
  request: SaveFieldDefinitionBundleRequest,
  dependencies?: Partial<FieldDefinitionCommandDependencies>,
): Promise<FieldDefinitionCommandResult> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const repository = dependencies?.plan === undefined
    ? await loadRepositoryCatalog()
    : { candidates: [], facetInterfaceNames: [], identityKinds: new Map<string, string>() };
  try {
    const snapshot = await deps.executeTransaction(accountId, async (current) => {
      if (request.expectedSnapshot !== undefined && !fieldPersistenceSnapshotMatches({
        owners: current.currentOwners,
        fields: current.currentFields,
        facets: current.currentFacets,
      }, request.expectedSnapshot)) {
        const rejected = new Error("Definitions changed since this draft was opened") as Error & {
          diagnostic: FieldDefinitionCommandError;
        };
        rejected.diagnostic = { $tag: "PersistenceConflict", message: rejected.message };
        throw rejected;
      }
      const input = {
        currentOwners: current.currentOwners,
        currentFields: current.currentFields,
        currentFacets: current.currentFacets,
        storageIssues: current.storageIssues,
        ownerMutations: request.ownerMutations,
        ...(request.resurrectFieldIds === undefined
          ? {}
          : { resurrectFieldIds: request.resurrectFieldIds }),
        ...(dependencies?.plan === undefined
          ? {
              repositoryFields: publicRepositoryFields(repository.candidates),
              identityKinds: repository.identityKinds,
            }
          : {}),
        ...(request.desiredFacets === undefined
          ? {}
          : { desiredFacets: request.desiredFacets }),
        ...(request.replaceFacetFieldIds === undefined
          ? {}
          : { replaceFacetFieldIds: request.replaceFacetFieldIds }),
      };
      const planned = dependencies?.plan
        ? deps.plan(input)
        : await defaultPlan(input);
      if (!planned.ok) {
        const rejected = new Error(planned.error.message) as Error & {
          diagnostic: FieldDefinitionCommandError;
        };
        rejected.diagnostic = planned.error;
        throw rejected;
      }
      const validateSnapshot = dependencies?.validateSnapshot
        ?? (dependencies?.plan === undefined ? defaultValidateSnapshot : undefined);
      if (validateSnapshot !== undefined) {
        await validateSnapshot(accountId, planned.value.snapshot);
      }
      return planned.value;
    });
    return { ok: true, snapshot };
  } catch (error) {
    const diagnostic = (error as { diagnostic?: FieldDefinitionCommandError })
      .diagnostic;
    if (diagnostic !== undefined) return { ok: false, error: diagnostic };
    throw error;
  }
}

export type FieldDefinitionCatalogPage = FieldReuseCatalogPage & {
  readonly facetInterfaceNames: readonly string[];
};

export type FieldDefinitionResurrectionOwner = {
  readonly ownerKey: string;
  readonly kind: "type" | "function";
  readonly storageName: string;
};

/** Realm/visibility-aware reuse catalog. Candidate construction is structural;
 * liveness, visibility, search, ordering, and pagination execute in Fenel. */
export async function queryFieldDefinitionCatalog(
  accountId: string,
  query: FieldReuseCatalogQuery = {},
): Promise<FieldDefinitionCatalogPage> {
  const [account, repository] = await Promise.all([
    loadAccountFieldDefinitionGraphState(accountId),
    loadRepositoryCatalog(),
  ]);
  const accountCandidates = accountFieldReuseCatalogCandidates({
    owners: account.currentOwners,
    fields: account.currentFields,
    facets: account.currentFacets,
    externalFields: publicRepositoryFields(repository.candidates),
  });
  const page = queryFieldReuseCatalogCandidates(
    [...accountCandidates, ...repository.candidates],
    query,
  );
  return {
    ...page,
    facetInterfaceNames: repository.facetInterfaceNames,
  };
}

/** Exact current-identity metadata for an editor that already holds a Field
 * UUID. This is deliberately separate from the paginated reuse catalog: it
 * neither grants reuse authority nor hides owner-local identities, and cannot
 * accidentally infer realm/ownership from whichever first page was loaded. */
export async function queryFieldDefinitionIdentity(
  accountId: string,
  fieldId: string,
): Promise<FieldReuseCatalogRow | undefined> {
  const [account, repository] = await Promise.all([
    loadAccountFieldDefinitionGraphState(accountId),
    loadRepositoryCatalog(),
  ]);
  return [
    ...accountFieldReuseCatalogCandidates({
      owners: account.currentOwners,
      fields: account.currentFields,
      facets: account.currentFacets,
      externalFields: publicRepositoryFields(repository.candidates),
    }),
    ...repository.candidates,
  ].find((candidate) => candidate.fieldId === fieldId);
}

function placeholderResurrectionOwner(
  requested: FieldDefinitionResurrectionOwner,
): FieldOwnerDefinition | undefined {
  if (requested.ownerKey !== `${requested.kind}:${requested.storageName}`) return undefined;
  return requested.kind === "type"
    ? {
        ownerKey: requested.ownerKey,
        kind: "type",
        storageName: requested.storageName,
        definition: {
          id: requested.storageName,
          type: { $record: { fields: [] } },
        },
      }
    : {
        ownerKey: requested.ownerKey,
        kind: "function",
        storageName: requested.storageName,
        definition: {
          id: requested.storageName,
          params: [],
          returns: { $ref: "Unit" },
        },
      };
}

/** Explicit, owner-scoped resurrection catalog. Tombstones never enter the
 * ordinary reuse picker; the Fenel query compares their retained origin with
 * the selected current owner. */
export async function queryFieldDefinitionResurrections(
  accountId: string,
  ownerKey: string,
  requestedOwner?: FieldDefinitionResurrectionOwner,
) {
  const account = await loadAccountFieldDefinitionGraphState(accountId);
  const owner = account.currentOwners.find((candidate) => candidate.ownerKey === ownerKey)
    ?? (requestedOwner === undefined
      ? undefined
      : placeholderResurrectionOwner(requestedOwner));
  if (owner === undefined) return undefined;
  return queryFieldResurrectionCandidates(owner, account.currentFields);
}
