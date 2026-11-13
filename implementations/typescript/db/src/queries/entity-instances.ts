import { eq, and, sql } from "drizzle-orm";
import type { FenelType } from "@fenel/engine/types";
import { validateValue } from "@fenel/engine/validation";
import { canonical } from "@fenel/engine/locale";
import { getDb } from "../client";
import { entityInstances } from "../schema/entity-instances";
import { getType } from "./types";
import { getDbAccountValueRegistry } from "./account-value-registry";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { valueToJsonWire, VALUE_JSON_ENCODING, isInstanceJsonEncoding, type ValueJsonEncoding } from "@fenel/engine/authoring/type";
import {
  assertNotFieldControlPlaneWrite,
  mayTouchFieldControlPlane,
  withFieldControlPlaneAccountTransaction,
} from "./field-control-plane";

/** Thrown when an entity_instance write fails type validation. The route
 *  layer catches this and converts to a 400. */
export class EntityInstanceValidationError extends Error {
  constructor(
    public readonly entityType: string,
    public readonly issues: { path: string; message: string }[],
  ) {
    super(
      `Invalid ${entityType}: ${issues
        .map((i) => `${i.path}: ${i.message}`)
        .join(", ")}`,
    );
    this.name = "EntityInstanceValidationError";
  }
}

/** Look up the entity's FenelType from the types registry and validate
 *  the incoming data. Returns the (validated) data, possibly with
 *  type-driven coercions applied; throws EntityInstanceValidationError
 *  on invalid input.
 *
 *  Resolution order: per-account `types` row first, then the system
 *  entity registry (e.g. "bot", "profile" — declared in code, never
 *  in the DB). The bot collector flow persists bots as
 *  entity_instances rows of type "bot", so this fallback is what makes
 *  `tryCreateInstanceByName "bot" …` succeed without seeding a row in
 *  the types table. */
async function validateInstanceData(
  accountId: string,
  entityType: string,
  data: unknown,
  registry?: ModuleRegistry,
): Promise<{ data: unknown; dataEncoding: ValueJsonEncoding | null }> {
  // Draft<T> wrapper — accept data permissively. Form-fill bodies
  // produce field-by-field Either<String, T_field> values that are
  // shape-correct by construction (parse-or-Left); strict validation
  // against the inner T runs at `promote` time when the Draft is
  // unwrapped. The proper parametric Draft<T> resolution (instantiate
  // walks T's fields → wraps each in Either) is deferred — see the
  // Draft entry in system-entities.ts.
  if (entityType.startsWith("Draft<") && entityType.endsWith(">")) {
    return { data: valueToJsonWire({ $ref: "Any" }, data), dataEncoding: null };
  }
  const valueRegistry = registry ?? await getDbAccountValueRegistry(accountId);
  let type: FenelType | null = valueRegistry.getIdentifiedEntity(entityType)?.type ?? valueRegistry.getEntity(entityType)?.type ?? null;
  const def = type ? null : await getType(accountId, entityType);
  if (def) {
    type = def.type as FenelType | null;
  } else if (!type) {
    const { getSystemEntity } = await import("@fenel/engine");
    const sys = getSystemEntity(entityType);
    if (sys) {
      type = (sys.type as FenelType) ?? null;
    } else {
      throw new EntityInstanceValidationError(entityType, [
        { path: "", message: `Unknown entity type: ${entityType}` },
      ]);
    }
  }
  if (!type) {
    // Type record exists but has no schema — accept the data unchanged.
    return { data: valueToJsonWire({ $ref: "Any" }, data), dataEncoding: null };
  }
  // ⚠ rights R3a — THE REQUEST ACCOUNT, wired one call up from the storage
  // leaf. The leaf itself is a PLAIN native with no frame, so there is nothing
  // to derive down there; `validateInstanceData` has held `accountId` all along
  // and is the first place in this chain that knows it. Before R3a the account
  // arrived by accident — as a FIELD OF THE VALUE BEING VALIDATED — so a record
  // with an `accountId` chose whose named sets decided its own validity.
  const result = validateValue(type, data, accountId, { coerce: true, registry: valueRegistry });
  if (!result.valid) {
    throw new EntityInstanceValidationError(
      entityType,
      result.errors.map((e) => ({ path: e.path, message: canonical(e.message) })),
    );
  }
  return { data: valueToJsonWire(type, result.value, valueRegistry, VALUE_JSON_ENCODING), dataEncoding: VALUE_JSON_ENCODING };
}

export async function listEntityInstances(
  accountId: string,
  entityType: string,
  limit?: number,
  where?: Record<string, unknown>,
) {
  const db = getDb();
  const { sql } = await import("drizzle-orm");
  const baseConds = and(
    eq(entityInstances.accountId, accountId),
    eq(entityInstances.entityType, entityType),
  );
  // JSONB containment — Postgres `@>` matches when the row's data is
  // a superset of the supplied object. postgres-js binds the parameter
  // as text + cast, so pre-stringify the record (it can't encode plain
  // objects as JSONB parameters automatically).
  const whereConds =
    where && Object.keys(where).length > 0
      ? and(
          baseConds,
          sql`${entityInstances.data} @> ${JSON.stringify(where)}::jsonb`,
        )
      : baseConds;
  const q = db
    .select()
    .from(entityInstances)
    .where(whereConds);
  if (limit) {
    return q.limit(limit);
  }
  return q;
}

export async function getEntityInstance(accountId: string, id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

// typed-function-references Phase 9b — resolve entity_instances rows by their
// CodeableName handle, account-scoped. This is the `name → value` ADJOINT of the
// 9a-2.1 `value → name` Codeable projection.
//
// SOURCE-OF-TRUTH INVERSION (the core 9b change): 8c's predecessor read
// `data->>'codeName'` off the entity row's JSONB. But 9a-2.1 made an instance's
// codeName a `Codeable` TYPECLASS INSTANCE keyed by the row id (item: codeName ←
// the `slug` field) — and item rows carry NO `codeName` data field (their `data`
// is `{slug, name, type}`). So reading `data->>'codeName'` MISSES every item
// instance. 9b inverts the producer: resolve through the persisted Codeable
// registry — find the `Codeable` rows (entity_type='Codeable', shape (B):
// {class, args:[rowId], methods:{codeName}}) whose `methods.codeName` matches,
// then JOIN to the instance row their `args[0]` names. The Codeable rows ARE the
// registry in persisted form (loadAccountRegistry reads the same rows into the
// in-memory dispatchRegistry); this is not a parallel mechanism.
//
// SCOPE MODEL (Phase-9 LOCKED — block → tag → global, closest-wins): measured at
// 9a-2.1 HEAD on staging, ZERO instance-Codeable rows carry a `data.scope` field
// (all account-global), so the block/tag arm is a forward-compatible no-op today.
// The account-global path is the live one. A block/tag-scoped instance-Codeable
// would carry `data.scope`; the seam to filter/prioritise on it is left for 9c /
// multiplayer (YAGNI — nothing exercises it now). `entityType` is the in-scope
// disambiguator (narrows a codeName shared across types).
//
// CONFLICT (no silent pick): returns ALL matching instance rows, ordered
// deterministically (createdAt asc — for a STABLE Conflict list, NOT a tiebreak
// pick). The caller decides: 0 → None, 1 → Unique, ≥2 → Conflict. This RETIRES
// the 8c `orderBy(asc).limit(1)` oldest-match stopgap. Measured: 0 cross-row
// codeName collisions among instance-Codeables today, so Conflict is forward-only
// (like LookupResult was at 10a) — the model is in place before the data needs it.
export async function findEntityInstancesByCodeName(
  accountId: string,
  codeName: string,
  entityType?: string,
): Promise<EntityInstanceRow[]> {
  const db = getDb();
  const { sql, asc } = await import("drizzle-orm");
  const { alias } = await import("drizzle-orm/pg-core");
  // Self-join: `c` = the Codeable spec rows, the bare table = the referent
  // instance rows. The Codeable row's `args[0]` names the instance id.
  const c = alias(entityInstances, "c");
  const whereConds = [eq(entityInstances.accountId, accountId)];
  if (entityType) whereConds.push(eq(entityInstances.entityType, entityType));
  const rows = await db
    .select({
      id: entityInstances.id,
      accountId: entityInstances.accountId,
      entityType: entityInstances.entityType,
      data: entityInstances.data,
      dataEncoding: entityInstances.dataEncoding,
      createdAt: entityInstances.createdAt,
      updatedAt: entityInstances.updatedAt,
    })
    .from(entityInstances)
    .innerJoin(
      c,
      and(
        eq(c.accountId, accountId),
        eq(c.entityType, "Codeable"),
        sql`${c.data}->'methods'->>'codeName' = ${codeName}`,
        sql`${entityInstances.id}::text = ${c.data}->'args'->>0`,
      ),
    )
    .where(and(...whereConds))
    .orderBy(asc(entityInstances.createdAt));
  return rows as EntityInstanceRow[];
}

type EntityInstanceRow = {
  id: string;
  accountId: string;
  entityType: string;
  data: Record<string, unknown>;
  dataEncoding?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function createEntityInstance(
  accountId: string,
  entityType: string,
  data: unknown,
  // storage-as-effect Phase 1 + D3 tail (2026-07-06) — the entity id, minted
  // BEFORE the store by the Fenel `crypto:uuidV4` body (via the `state:create*`
  // mint-before-store bodies) instead of Postgres `gen_random_uuid()`. `id`
  // stays OPTIONAL, but the leaf no longer relies on the DB DEFAULT: when a
  // caller omits it, we mint a `crypto.randomUUID()` here so the
  // `entity_instances.id` DEFAULT could be dropped (migration 0087). The
  // `state:*` domain path always supplies it; the direct `bots` /
  // `dispatch-registry` inserters mint at their own insert sites.
  id?: string,
  validationRegistry?: ModuleRegistry,
) {
  if (mayTouchFieldControlPlane(entityType)) {
    return withFieldControlPlaneAccountTransaction(accountId, async (tx) => {
      await assertNotFieldControlPlaneWrite(accountId, entityType, data, tx);
      const validated = await validateInstanceData(accountId, entityType, data, validationRegistry);
      await assertNotFieldControlPlaneWrite(accountId, entityType, validated.data, tx);
      const [created] = await tx
        .insert(entityInstances)
        .values({
          id: id ?? crypto.randomUUID(),
          accountId,
          entityType,
          data: validated.data === null ? sql`'null'::jsonb` : validated.data as Record<string, unknown>,
          dataEncoding: validated.dataEncoding,
        })
        .returning();
      return created!;
    });
  }

  const validated = await validateInstanceData(accountId, entityType, data, validationRegistry);
  const [created] = await getDb()
    .insert(entityInstances)
    .values({
      id: id ?? crypto.randomUUID(),
      accountId,
      entityType,
      data: validated.data === null ? sql`'null'::jsonb` : validated.data as Record<string, unknown>,
      dataEncoding: validated.dataEncoding,
    })
    .returning();
  return created!;
}

export async function updateEntityInstance(
  accountId: string,
  id: string,
  data: unknown,
  validationRegistry?: ModuleRegistry,
) {
  const classified = await getEntityInstance(accountId, id);
  if (!classified) return null;
  if (isInstanceJsonEncoding(classified.dataEncoding)) {
    throw new EntityInstanceValidationError(classified.entityType, [
      { path: "", message: "Edit this scoped instance through the dispatch-instance editor." },
    ]);
  }
  if (!mayTouchFieldControlPlane(classified.entityType)) {
    const validated = await validateInstanceData(accountId, classified.entityType, data, validationRegistry);
    const [updated] = await getDb()
      .update(entityInstances)
      .set({ data: validated.data === null ? sql`'null'::jsonb` : validated.data as Record<string, unknown>, dataEncoding: validated.dataEncoding, updatedAt: new Date() })
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.id, id),
          eq(entityInstances.entityType, classified.entityType),
          sql`${entityInstances.dataEncoding} IS DISTINCT FROM 'fenel-instance-json-v1'`,
          sql`${entityInstances.dataEncoding} IS DISTINCT FROM 'fenel-instance-json-v2'`,
        ),
      )
      .returning();
    return updated ?? null;
  }

  return withFieldControlPlaneAccountTransaction(accountId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.id, id),
        ),
      )
      .limit(1);
    if (!existing) return null;
    if (isInstanceJsonEncoding(existing.dataEncoding)) {
      throw new EntityInstanceValidationError(existing.entityType, [
        { path: "", message: "Edit this scoped instance through the dispatch-instance editor." },
      ]);
    }
    await assertNotFieldControlPlaneWrite(
      accountId,
      existing.entityType,
      existing.data,
      tx,
    );
    await assertNotFieldControlPlaneWrite(accountId, existing.entityType, data, tx);
    const validated = await validateInstanceData(accountId, existing.entityType, data, validationRegistry);
    await assertNotFieldControlPlaneWrite(
      accountId,
      existing.entityType,
      validated.data,
      tx,
    );
    const [updated] = await tx
      .update(entityInstances)
      .set({
        data: validated.data === null ? sql`'null'::jsonb` : validated.data as Record<string, unknown>,
        dataEncoding: validated.dataEncoding,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.id, id),
          eq(entityInstances.entityType, existing.entityType),
          sql`${entityInstances.dataEncoding} IS DISTINCT FROM 'fenel-instance-json-v1'`,
          sql`${entityInstances.dataEncoding} IS DISTINCT FROM 'fenel-instance-json-v2'`,
        ),
      )
      .returning();
    return updated ?? null;
  });
}

export async function deleteEntityInstance(accountId: string, id: string) {
  const classified = await getEntityInstance(accountId, id);
  if (!classified) return;
  if (!mayTouchFieldControlPlane(classified.entityType)) {
    return getDb()
      .delete(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.id, id),
          eq(entityInstances.entityType, classified.entityType),
        ),
      );
  }

  return withFieldControlPlaneAccountTransaction(accountId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.id, id),
        ),
      )
      .limit(1);
    if (!existing) return;
    await assertNotFieldControlPlaneWrite(
      accountId,
      existing.entityType,
      existing.data,
      tx,
    );
    return tx
      .delete(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.id, id),
          eq(entityInstances.entityType, existing.entityType),
        ),
      );
  });
}

// ---------------------------------------------------------------------------
// Conversation sweeps — direct JSONB updates on entity_instances rows of
// entityType "Conversation". Used by the api-server tick (stale GC) and
// the collector stop handler (bot-wide cancel). Bypasses
// updateEntityInstance because the patch is uniform across many rows and
// per-row validate-then-update would be O(N) round-trips.
// jsonb_build_object accepts any value type, so its timestamp parameter needs
// an explicit bigint cast for PostgreSQL to type a prepared statement.
// ---------------------------------------------------------------------------

/** Cancel every in-flight (Active or Confirming) Conversation row for a
 *  bot in one shot. Used by the collector stop handler.
 *
 *  Status is the typed `ConversationStatus` ADT (`Active | Confirming |
 *  Completed | Cancelled`) stored as a tagged-variant JSONB shape
 *  ({"$tag": "Active"} etc.) — see Phase 11c sub-step 2b. */
/** ⚠ ACCOUNT-SCOPED, and it was not (rights R2b review round 6). The predicate
 *  was `data->>'botId'` alone, so a body naming another account's bot id
 *  cancelled every in-flight Conversation on that account's funnel. The act
 *  argues no account handle, so no partition axis reaches it and it sits in
 *  every role's general row — measured `Just true` for a `viewer` of A against
 *  B's bot. `entity_instances` carries `account_id`, so the fix is one
 *  predicate, and the caller already held the account. */
export async function cancelInFlightConversationsByBot(
  accountId: string,
  botId: string,
): Promise<void> {
  const db = getDb();
  const { sql } = await import("drizzle-orm");
  const nowMs = Date.now();
  await db.execute(sql`
    UPDATE entity_instances
    SET data = data
      || jsonb_build_object('status', jsonb_build_object('$tag', 'Cancelled'),
                            'completedAt', jsonb_build_object('$tag', 'Just', '_0', ${nowMs}::bigint)),
        updated_at = now()
    WHERE entity_type = 'Conversation'
      AND account_id = ${accountId}
      AND data->>'botId' = ${botId}
      AND data->'status'->>'$tag' IN ('Active', 'Confirming')
  `);
}

/** Cancel Conversation rows whose startedAt (ms-since-epoch Int) is older
 *  than the cutoff. Without this, an api crash mid-conversation leaves a
 *  row in `Active` forever and confuses every subsequent /start. */
export async function cancelStaleConversations(olderThanMs: number): Promise<void> {
  const db = getDb();
  const { sql } = await import("drizzle-orm");
  const nowMs = Date.now();
  const cutoffMs = nowMs - olderThanMs;
  await db.execute(sql`
    UPDATE entity_instances
    SET data = data
      || jsonb_build_object('status', jsonb_build_object('$tag', 'Cancelled'),
                            'completedAt', jsonb_build_object('$tag', 'Just', '_0', ${nowMs}::bigint)),
        updated_at = now()
    WHERE entity_type = 'Conversation'
      AND data->'status'->>'$tag' IN ('Active', 'Confirming')
      AND (data->>'startedAt')::bigint < ${cutoffMs}
  `);
}
