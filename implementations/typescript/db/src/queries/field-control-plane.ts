import { and, eq, sql } from "drizzle-orm";
import {
  fieldRepresentationalInterfaceNames,
} from "@fenel/engine/repository-field-catalog";
import { repositoryIdentityKinds } from "@fenel/engine/repository-identity-manifest";
import { getDb, type Database } from "../client";
import { entityInstances } from "../schema/entity-instances";
import { functions } from "../schema/functions";
import { types } from "../schema/types";

const FIELD_REPRESENTATIONAL_TYPES = new Set<string>(
  fieldRepresentationalInterfaceNames(),
);
const REPOSITORY_IDENTITY_KINDS = repositoryIdentityKinds();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cheap generated-family classification for mutation leaves. Ordinary
 * entity rows do not participate in the Field UUID reservation race and must
 * not be serialized behind an account-wide authoring lock. */
export function mayTouchFieldControlPlane(entityType: string): boolean {
  return entityType === "Field" || FIELD_REPRESENTATIONAL_TYPES.has(entityType);
}

export class FieldControlPlaneWriteConflict extends Error {
  constructor(message = "Field control-plane rows must be changed through the definition-bundle command") {
    super(message);
    this.name = "FieldControlPlaneWriteConflict";
  }
}

export type FieldControlPlaneTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

/** One serialization boundary for definition-bundle and generic instance
 * writers. A generic check performed on another connection would be a TOCTOU
 * check: a Field bundle could reserve the target UUID before the generic
 * mutation executes. */
export async function withFieldControlPlaneAccountTransaction<T>(
  accountId: string,
  operation: (tx: FieldControlPlaneTransaction) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${accountId}, 2202))`,
    );
    return operation(tx);
  });
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Fence the generic entity/dispatch storage leaves from durable Field
 * identities and their representational facets. The definition-bundle
 * executor writes its transaction tables directly and is intentionally the
 * sole writer that does not pass through this guard. */
export async function assertNotFieldControlPlaneWrite(
  accountId: string,
  entityType: string,
  data: unknown,
  db: Pick<Database, "select"> = getDb(),
): Promise<void> {
  if (entityType === "Field") throw new FieldControlPlaneWriteConflict();
  if (!FIELD_REPRESENTATIONAL_TYPES.has(entityType)) return;
  const record = objectRecord(data);
  if (record?.["targetEntityType"] === "Field") {
    throw new FieldControlPlaneWriteConflict();
  }
  const args = Array.isArray(record?.["args"]) ? record["args"] : [];
  const targetId = typeof args[0] === "string" ? args[0] : undefined;
  if (targetId === undefined) return;
  const repositoryKind = REPOSITORY_IDENTITY_KINDS.get(targetId);
  if (repositoryKind === "field") {
    throw new FieldControlPlaneWriteConflict();
  }
  if (repositoryKind === "reserved") {
    throw new FieldControlPlaneWriteConflict(
      "A reserved repository UUID cannot be targeted by a generic representation",
    );
  }
  // Code-name/non-UUID representation targets remain legitimate. A UUID target
  // must already resolve to a live account or repository identity: accepting a
  // dangling UUID would let a generic row be pre-seeded before a Field bundle
  // reserves that UUID, then silently become a Field facet later.
  if (!UUID_RE.test(targetId) || repositoryKind !== undefined) return;

  const [instanceTarget] = await db
    .select({ entityType: entityInstances.entityType })
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.id, targetId),
      ),
    )
    .limit(1);
  if (instanceTarget?.entityType === "Field") {
    throw new FieldControlPlaneWriteConflict();
  }
  if (instanceTarget !== undefined) return;

  const [typeTarget] = await db
    .select({ id: types.id })
    .from(types)
    .where(and(eq(types.accountId, accountId), eq(types.id, targetId)))
    .limit(1);
  if (typeTarget !== undefined) return;

  const [functionTarget] = await db
    .select({ id: functions.id })
    .from(functions)
    .where(and(eq(functions.accountId, accountId), eq(functions.id, targetId)))
    .limit(1);
  if (functionTarget !== undefined) return;

  throw new FieldControlPlaneWriteConflict(
    "A unary representational UUID target must already resolve before it can be written",
  );
}
