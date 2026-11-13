import {
  saveFieldDefinitionBundle,
  loadFieldDefinitionBundleSnapshot,
  queryFieldDefinitionCatalog,
  queryFieldDefinitionIdentity,
  queryFieldDefinitionResurrections,
  type FieldDefinitionCommandDependencies,
  type FieldDefinitionCommandResult,
  type SaveFieldDefinitionBundleRequest,
  type FieldDefinitionCatalogPage,
  type FieldDefinitionResurrectionOwner,
} from "@fenel/core/field-definition-command";
import type {
  FieldPersistenceSnapshot,
  FieldReuseCatalogQuery,
} from "@fenel/engine/field-authoring";
import { canonical } from "@fenel/engine/locale";
import { fieldDefinitionSnapshotFromJsonWire, ownerDefinitionFromJsonWire, typeToJsonWire } from "@fenel/engine/authoring/expression";

/** API-facing command seam. Kept separate from Hono framing so route tests can
 * prove planner rejection performs no transaction write. */
export async function executeFieldDefinitionCommand(
  accountId: string,
  request: SaveFieldDefinitionBundleRequest,
  dependencies?: Partial<FieldDefinitionCommandDependencies>,
): Promise<FieldDefinitionCommandResult> {
  let decoded: SaveFieldDefinitionBundleRequest;
  try {
    decoded = { ...request,
      ...(request.expectedSnapshot === undefined ? {} : { expectedSnapshot: fieldDefinitionSnapshotFromJsonWire(request.expectedSnapshot) }),
      ownerMutations: request.ownerMutations.map((mutation) => mutation.kind === "delete"
      ? mutation : { ...mutation, owner: ownerDefinitionFromJsonWire(mutation.owner) }) };
  } catch (error) {
    return { ok: false, error: { $tag: "InvalidDefinitionTransport", message: error instanceof Error ? error.message : String(error) } };
  }
  return saveFieldDefinitionBundle(accountId, decoded, dependencies);
}

export async function executeFieldDefinitionSnapshotQuery(
  accountId: string,
): Promise<FieldPersistenceSnapshot> {
  return loadFieldDefinitionBundleSnapshot(accountId);
}

export async function executeFieldDefinitionCatalogQuery(
  accountId: string,
  query: FieldReuseCatalogQuery,
): Promise<FieldDefinitionCatalogPage> {
  return queryFieldDefinitionCatalog(accountId, query);
}

export async function executeFieldDefinitionIdentityQuery(
  accountId: string,
  fieldId: string,
) {
  return queryFieldDefinitionIdentity(accountId, fieldId);
}

export async function executeFieldDefinitionResurrectionQuery(
  accountId: string,
  ownerKey: string,
  requestedOwner?: FieldDefinitionResurrectionOwner,
) {
  return queryFieldDefinitionResurrections(accountId, ownerKey, requestedOwner);
}

export type FieldDefinitionCatalogWireRow = {
  fieldId: string;
  codeName: string;
  label?: string;
  owners: readonly string[];
  occurrenceTypes: string[];
  realm: "account" | "repository";
  reuseVisibility: "owner" | "account" | "repository";
};

export type FieldDefinitionCatalogWirePage = {
  fields: FieldDefinitionCatalogWireRow[];
  facetInterfaceNames: readonly string[];
  nextCursor?: string;
};

export function fieldDefinitionCatalogRowToWire(
  field: FieldDefinitionCatalogPage["fields"][number],
): FieldDefinitionCatalogWireRow {
  return {
    fieldId: field.fieldId,
    codeName: field.codeName,
    ...(field.label === undefined ? {} : { label: canonical(field.label) }),
    owners: [...field.owners],
    occurrenceTypes: field.occurrenceTypes.map((type) => JSON.stringify(typeToJsonWire(type))),
    realm: field.realm,
    reuseVisibility: field.reuseVisibility,
  };
}

export function fieldDefinitionCatalogToWire(
  page: FieldDefinitionCatalogPage,
): FieldDefinitionCatalogWirePage {
  return {
    fields: page.fields.map(fieldDefinitionCatalogRowToWire),
    facetInterfaceNames: [...page.facetInterfaceNames],
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  };
}
