import { invalidateRegistryRequestScope } from "@fenel/engine/registry-request-scope";
import { eq, and, or } from "drizzle-orm";
import { getDb } from "../client";
import { types } from "../schema/types";
import { typeDefinitionFromJsonWire, typeFromJsonWire, typeToJsonWire } from "@fenel/engine/authoring/expression";
import type { FenelType, TypeConstructorParam, TypeScheme } from "@fenel/engine/types";

type TypeDeclaration = {
  params?: readonly (string | TypeConstructorParam)[];
  typeScheme?: TypeScheme;
};

function canonicalTypeRow<T extends typeof types.$inferSelect>(row: T): T & TypeDeclaration {
  const declaration = row.declaration == null ? row.declaration : typeDefinitionFromJsonWire(row.declaration as TypeDeclaration);
  return { ...row, declaration,
    ...(declaration?.params === undefined ? {} : { params: declaration.params }),
    ...(declaration?.typeScheme === undefined ? {} : { typeScheme: declaration.typeScheme }),
    type: typeFromJsonWire(row.type as FenelType) as Record<string, unknown> | null };
}

function typeColumnToWire(value: Record<string, unknown> | null | undefined) {
  return value == null ? value : typeToJsonWire(value as FenelType) as Record<string, unknown>;
}

export async function listTypes(accountId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(types)
    .where(
      or(
        eq(types.accountId, accountId),
        eq(types.isSystem, true),
      ),
    );
  return rows.map(canonicalTypeRow);
}

export async function getTypeById(accountId: string, id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(types)
    .where(
      and(
        or(eq(types.accountId, accountId), eq(types.isSystem, true)),
        eq(types.id, id),
      ),
    )
    .limit(1);
  return row ? canonicalTypeRow(row) : null;
}

export async function getType(accountId: string, name: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(types)
    .where(
      and(
        eq(types.accountId, accountId),
        eq(types.name, name),
      ),
    )
    .limit(1);
  return row ? canonicalTypeRow(row) : null;
}

export async function upsertType(
  accountId: string,
  def: {
    name: string;
    /** Type metadata (label, description, …) lives in
     *  typeclass_instances now. The API still accepts label/description
     *  in the payload for backwards compat — the route layer mirrors
     *  them into Labelable / Describable instances after upsert. They
     *  do NOT land in the `types` row. */
    type?: Record<string, unknown> | null;
    defaultTemplate?: string | null;
    defaultTemplateInline?: string | null;
    isSystem?: boolean;
  },
) {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  const db = getDb();
  const existing = await getType(accountId, def.name);

  if (existing) {
    const [updated] = await db
      .update(types)
      .set({
        type: typeColumnToWire(def.type ?? existing.type),
        defaultTemplate:
          def.defaultTemplate !== undefined
            ? def.defaultTemplate
            : existing.defaultTemplate,
        defaultTemplateInline:
          def.defaultTemplateInline !== undefined
            ? def.defaultTemplateInline
            : existing.defaultTemplateInline,
        updatedAt: new Date(),
      })
      .where(eq(types.id, existing.id))
      .returning();
    return canonicalTypeRow(updated!);
  }

  const [created] = await db
    .insert(types)
    .values({
      accountId,
      name: def.name,
      type: typeColumnToWire(def.type),
      defaultTemplate: def.defaultTemplate,
      defaultTemplateInline: def.defaultTemplateInline,
      isSystem: def.isSystem ?? false,
    })
    .returning();
  return canonicalTypeRow(created!);
}

export async function deleteType(accountId: string, name: string) {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  const db = getDb();
  return db
    .delete(types)
    .where(
      and(
        eq(types.accountId, accountId),
        eq(types.name, name),
      ),
    );
}
