// Browser-safe inert repository field facts. Generated from the same real
// profile union as the repository identity manifest.
import catalogJson from "./generated/repository-field-catalog.json";

import type { FenelType, LocaleString } from "./types";
import {
  accountFieldReuseCatalogCandidates,
  queryFieldReuseCatalogCandidates,
  type DurableFieldEntity,
  type FieldFacetInterfaceName,
  type FieldFacetValue,
  type FieldOwnerDefinition,
  type FieldReuseCatalogRow,
} from "./field-authoring";

export type RepositoryFieldCatalogRow = {
  readonly fieldId: string;
  readonly codeName: string;
  readonly label?: LocaleString;
  readonly owners: readonly string[];
  readonly occurrenceTypes: readonly FenelType[];
  readonly targetKind: "field";
  readonly realm: "repository";
  readonly reuseVisibility: "owner" | "repository";
};

export type RepositoryFieldCatalog = {
  readonly schemaVersion: 1;
  readonly identityManifestDigest: string;
  readonly digest: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly facetInterfaceNames: readonly FieldFacetInterfaceName[];
  readonly fields: readonly RepositoryFieldCatalogRow[];
  readonly labelables: readonly {
    fieldId: string;
    methods: Readonly<Record<string, unknown>>;
  }[];
  readonly displayables: readonly {
    fieldId: string;
    methods: Readonly<Record<string, unknown>>;
  }[];
};

function deepFreezeCatalogValue<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreezeCatalogValue(child);
    }
    Object.freeze(value);
  }
  return value;
}

const raw = catalogJson as unknown as RepositoryFieldCatalog;
/** The browser/Node adapter intentionally returns one immutable singleton.
 * Deep-freezing is load-bearing: occurrence types and Displayable hints are
 * recursive values, so a shallow readonly facade would let one consumer alter
 * every later registry. */
export const REPOSITORY_FIELD_CATALOG: RepositoryFieldCatalog =
  deepFreezeCatalogValue(raw);

/** Durable normalization context for account owners that reuse a public
 * repository Field. These rows are never account catalog candidates; they
 * merely prove the referenced UUID/code-name pair to the identity kernel. */
export const REPOSITORY_REUSABLE_DURABLE_FIELDS: readonly DurableFieldEntity[] =
  Object.freeze(
    REPOSITORY_FIELD_CATALOG.fields
      .filter((field) => field.reuseVisibility === "repository")
      .map((field) => Object.freeze({
        id: field.fieldId,
        currentCodeName: field.codeName,
        status: "live" as const,
        realm: "repository" as const,
        reuseVisibility: "repository" as const,
      })),
  );

export function repositoryFieldCatalog(): RepositoryFieldCatalog {
  return REPOSITORY_FIELD_CATALOG;
}

export function fieldRepresentationalInterfaceNames(): readonly FieldFacetInterfaceName[] {
  return REPOSITORY_FIELD_CATALOG.facetInterfaceNames;
}

export type RepositoryFieldReuseQuery = {
  readonly search?: string;
  readonly cursor?: string;
  readonly limit?: number;
};

export type RepositoryFieldReusePage = {
  readonly fields: readonly FieldReuseCatalogRow[];
  readonly facetInterfaceNames: readonly FieldFacetInterfaceName[];
  readonly nextCursor?: string;
};

export function queryRepositoryFieldReuse(
  query: RepositoryFieldReuseQuery = {},
): RepositoryFieldReusePage {
  const page = queryFieldReuseCatalogCandidates(
    REPOSITORY_FIELD_CATALOG.fields.map((field) => ({
      ...field,
      status: "live" as const,
      realm: "repository" as const,
    })),
    query,
  );
  return {
    fields: page.fields,
    facetInterfaceNames: REPOSITORY_FIELD_CATALOG.facetInterfaceNames,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  };
}

export function queryAvailableFieldReuse(input: {
  readonly accountOwners: readonly FieldOwnerDefinition[];
  readonly accountFields: readonly DurableFieldEntity[];
  readonly accountFacets: readonly FieldFacetValue[];
  readonly query?: RepositoryFieldReuseQuery;
}): RepositoryFieldReusePage {
  const account = accountFieldReuseCatalogCandidates({
    owners: input.accountOwners,
    fields: input.accountFields,
    facets: input.accountFacets,
    externalFields: REPOSITORY_REUSABLE_DURABLE_FIELDS,
  });
  const repository = REPOSITORY_FIELD_CATALOG.fields.map((field) => ({
    ...field,
    status: "live" as const,
    realm: "repository" as const,
  }));
  const page = queryFieldReuseCatalogCandidates([...account, ...repository], input.query);
  return {
    fields: page.fields,
    facetInterfaceNames: REPOSITORY_FIELD_CATALOG.facetInterfaceNames,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  };
}
