import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "../client";
import { entityInstances } from "../schema/entity-instances";
import { getDbAccountValueRegistry } from "./account-value-registry";
import { assertJsonAuthoringValue, instanceToJsonWire, instanceFromJsonWire, valueFromJsonWire, INSTANCE_JSON_ENCODING, isInstanceJsonEncoding, isValueJsonEncoding } from "@fenel/engine/authoring/type";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import { dispatchEngineBody } from "@fenel/engine/engine-bodies-dispatch";
import {
  assertNotFieldControlPlaneWrite,
  mayTouchFieldControlPlane,
  withFieldControlPlaneAccountTransaction,
  type FieldControlPlaneTransaction,
} from "./field-control-plane";

export class DispatchInstancePersistenceConflict extends Error {
  readonly diagnostic: { $tag: "PersistenceConflict"; message: string };
  constructor(message = "Data changed since this draft was opened") {
    super(message);
    this.name = "DispatchInstancePersistenceConflict";
    this.diagnostic = { $tag: "PersistenceConflict", message };
  }
}

// Phase 10a-5d-followup-4 — `dispatch_registry` table retired (migration
// 0064). Spec-record instances live exclusively in `entity_instances`
// rows under `entity_type = <ClassName>`. The legacy query names
// (`listInstances` / `createDispatchInstance` / etc.) survive
// as thin wrappers that project the entity_instances row shape back to
// the legacy dispatch_registry row shape — call sites (the dashboard
// route + runtime handlers calling `r.instance as never`) keep working
// without a per-caller flip.
//
// Phase 3.4b — the `Spec` suffix is RETIRED from persistence. `entity_type`
// is now the suffix-free dispatch class name (`Labelable`, not
// `LabelableSpec`); writes use `def.typeName` directly, reads filter on it,
// and the spec-row scans enumerate `interfaceCodeNameToName.keys()` (now the
// suffix-free spec entity ids). Migration `0071_drop_spec_suffix.sql` renames
// any residual `<X>Spec` rows (staging probe: zero — defensive + idempotent);
// `0072_constraint_entityid_drop_spec.sql` is the matching defensive sweep over
// persisted Constraint `entityId`s. Phase 3.4c — the suffix-strip-on-read sites
// are GONE (corpus + Constraint entityIds all suffix-free); `entityType` IS the
// dispatch class name, read directly.
//
// Two `data` shapes coexist in entity_instances under the class-name
// entity_types:
//   (A) flat methods record — `{label, describe, …}`. Written by
//       state.try_create_instance for typed spec constructors like
//       `Labelable { label = … }`. The codename + class are
//       derived from `entity_type` (which IS the class name now); `args` is
//       empty.
//   (B) full Instance — `{type, args, methods, scope?, priority?,
//       targetEntityType?}`. Written by createDispatchInstance below
//       (the dashboard surface) and emitted by migration 0064 from the
//       pre-existing dispatch_registry rows.
// `projectEntityToInstance` auto-detects shape via `data.type &&
// data.methods` so callers see a uniform Instance shape.
//
// universal-dispatch-convergence Phase 3 (2026-07-06) — the dispatch-Type-name
// field is now the terminal `typeName` in-memory / `data.type` on the wire (the
// old `className` / `data.class` residual is retired across the ~37 `.fenel`
// bodies + the TS↔Fenel marshal boundary). Migration 0088 renames the persisted
// JSONB key `data.class` → `data.type` for shape-(B) rows; the projection helper
// reads `data.type` (falling back to legacy `data.class` for un-swept rows) →
// `inst.typeName` and writes `inst.typeName` → `data.type`.

type EntityInstanceRow = {
  id: string;
  accountId: string;
  entityType: string;
  data: unknown;
  dataEncoding?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type InstanceRow = {
  id: string;
  accountId: string;
  typeName: string;
  args: unknown[];
  targetEntityType: string | null;
  instance: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

/** Translate an entity_instances row's `data` into a Instance record
 *  (`{typeName, args, methods, scope?, priority?}`). Handles both
 *  shapes (A: flat methods record / B: full Instance) — see file
 *  header. The persisted JSONB key `data.type` (legacy `data.class` for
 *  un-swept rows) is translated to the TS field `inst.typeName` at the
 *  read boundary. */
export function projectEntityToInstance(row: {
  entityType: string;
  data: unknown;
  dataEncoding?: string | null;
}, registry?: ModuleRegistry): Record<string, unknown> {
  if (row.dataEncoding != null && !registry) throw new TypeError("Encoded dispatch rows require their account value registry");
  const data = isInstanceJsonEncoding(row.dataEncoding) ? instanceFromJsonWire(row.data as Record<string, unknown>, registry, undefined, row.dataEncoding)
    : isValueJsonEncoding(row.dataEncoding) ? valueFromJsonWire(registry!.getIdentifiedEntity(row.entityType)?.type ?? registry!.getEntity(row.entityType)?.type ?? { $ref: row.entityType }, row.data, registry, row.dataEncoding)
    : row.data;
  if (row.dataEncoding != null && !isInstanceJsonEncoding(row.dataEncoding) && !isValueJsonEncoding(row.dataEncoding)) throw new TypeError(`Unsupported instance encoding: ${row.dataEncoding}`);
  if (isValueJsonEncoding(row.dataEncoding)) return { typeName: row.entityType, args: [], methods: data };
  if (
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    ("type" in data || "class" in data) &&
    "methods" in data
  ) {
    const d = data as Record<string, unknown>;
    const instance: Record<string, unknown> = {
      // Read the terminal `data.type` key; fall back to the legacy
      // `data.class` key for rows not yet swept by migration 0088.
      typeName: d["type"] ?? d["class"],
      args: Array.isArray(d["args"]) ? (d["args"] as unknown[]) : [],
      methods: (d["methods"] as Record<string, unknown>) ?? {},
    };
    if ("scope" in d) instance["scope"] = d["scope"];
    if ("priority" in d) instance["priority"] = d["priority"];
    if ("label" in d) instance["label"] = d["label"];
    if ("where" in d) instance["where"] = d["where"];
    return instance;
  }
  return {
    typeName: row.entityType,
    args: [],
    methods: (data as Record<string, unknown>) ?? {},
  };
}

/** Translate an entity_instances row into the legacy dispatch_registry
 *  row shape used by listInstances callers (dashboard route +
 *  runtime handler reading `r.instance as never`). */
function projectEntityToInstanceRow(row: EntityInstanceRow, registry?: ModuleRegistry): InstanceRow {
  const instance = projectEntityToInstance(row, registry);
  const targetEntityType =
    row.data !== null &&
    typeof row.data === "object" &&
    "targetEntityType" in row.data
      ? ((row.data["targetEntityType"] as string | undefined) ?? null)
      : null;
  return {
    id: row.id,
    accountId: row.accountId,
    typeName: instance["typeName"] as string,
    args: instance["args"] as unknown[],
    targetEntityType,
    instance,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function storedDispatchData(accountId: string, data: Record<string, unknown>, registry?: ModuleRegistry) {
  const authority = registry ?? await getDbAccountValueRegistry(accountId);
  const wire = instanceToJsonWire(data, authority, undefined, INSTANCE_JSON_ENCODING);
  assertJsonAuthoringValue(wire);
  // Provenance describes the wrapper domain even when every method is plain
  // JSON. Method keys remain physically unchanged for SQL facet readers.
  return { data: wire, dataEncoding: INSTANCE_JSON_ENCODING, registry: authority };
}

async function projectRows(accountId: string, rows: EntityInstanceRow[], registry?: ModuleRegistry): Promise<InstanceRow[]> {
  const authority = registry ?? (rows.some((row) => row.dataEncoding != null) ? await getDbAccountValueRegistry(accountId) : undefined);
  return rows.map((row) => projectEntityToInstanceRow(row, authority));
}

export async function listInstances(
  accountId: string,
  typeName?: string,
): Promise<InstanceRow[]> {
  const db = getDb();
  if (typeName) {
    const rows = await db
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.entityType, typeName),
        ),
      );
    return projectRows(accountId, rows);
  }
  // An empty partition has no values to decode. This bounded extra read lets
  // its first request avoid building a full account codec registry; populated
  // accounts retain the registered-class filter and decoding below.
  const [present] = await db.select({ id: entityInstances.id })
    .from(entityInstances).where(eq(entityInstances.accountId, accountId)).limit(1);
  if (!present) return [];
  // No filter — scan every entity_instances row under a registered spec
  // codename. The engine's `interfaceCodeNameToName.keys()` enumerates
  // the canonical set; lazy-imported to avoid loading the engine bundle
  // at module-eval time.
  const { interfaceCodeNameToName } = await import("@fenel/engine");
  const registry = await getDbAccountValueRegistry(accountId);
  const codeNames = [...new Set([...interfaceCodeNameToName.keys(), ...registry.listEntities().filter((entity) => entity.interface).map((entity) => entity.id)])];
  if (codeNames.length === 0) return [];
  const rows = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        inArray(entityInstances.entityType, codeNames),
      ),
    );
  return projectRows(accountId, rows, registry);
}

export async function getDispatchInstance(
  accountId: string,
  id: string,
): Promise<InstanceRow | null> {
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
  if (!row) return null;
  // Phase 3.4b — narrow to spec rows by membership in the registered spec
  // class names (suffix-free now), replacing the retired `endsWith("Spec")`
  // guard. Guards against returning an unrelated entity_instances row by id.
  const { interfaceCodeNameToName } = await import("@fenel/engine");
  const registry = row.dataEncoding != null || !interfaceCodeNameToName.has(row.entityType) ? await getDbAccountValueRegistry(accountId) : undefined;
  if (!interfaceCodeNameToName.has(row.entityType) && !registry?.getEntity(row.entityType)?.interface) return null;
  return projectEntityToInstanceRow(row, registry);
}

export async function createDispatchInstance(
  accountId: string,
  def: {
    id?: string;
    typeName: string;
    args: unknown[];
    instance: Record<string, unknown>;
    targetEntityType?: string | null;
  },
): Promise<InstanceRow> {
  if (def.id !== undefined && (typeof def.id !== "string"
    || dispatchEngineBody("std:isUuid", [def.id]) !== true)) {
    throw new TypeError("Dispatch instance id must be a UUID when supplied");
  }
  // Mirrors the legacy contract: default `targetEntityType` from
  // `args[0]` when it's a string. The typed column lives inside `data`
  // now (vs the dedicated `target_entity_type` column on the retired
  // table); the projection helper surfaces it back to callers.
  const targetEntityType =
    def.targetEntityType !== undefined
      ? def.targetEntityType
      : typeof def.args[0] === "string"
        ? (def.args[0] as string)
        : null;
  const data: Record<string, unknown> = {
    type: def.typeName,
    args: def.args,
    methods: (def.instance["methods"] as Record<string, unknown>) ?? {},
  };
  if (def.instance["scope"] !== undefined) data["scope"] = def.instance["scope"];
  if (def.instance["priority"] !== undefined) data["priority"] = def.instance["priority"];
  if (def.instance["label"] !== undefined) data["label"] = def.instance["label"];
  if (def.instance["where"] !== undefined) data["where"] = def.instance["where"];
  if (targetEntityType !== null) data["targetEntityType"] = targetEntityType;
  const stored = await storedDispatchData(accountId, data);
  // Direct inserts bypass `createEntityInstance` validation because the spec
  // record declares `{methods…}` while shape (B) deliberately persists the
  // full Instance metadata wrapper.
  if (mayTouchFieldControlPlane(def.typeName)) {
    return withFieldControlPlaneAccountTransaction(accountId, async (tx) => {
      await assertNotFieldControlPlaneWrite(accountId, def.typeName, data, tx);
      const [created] = await tx
        .insert(entityInstances)
        .values({
          id: def.id ?? crypto.randomUUID(),
          accountId,
          entityType: def.typeName,
          data: stored.data,
          dataEncoding: stored.dataEncoding,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new DispatchInstancePersistenceConflict("This data identity is already saved");
      return projectEntityToInstanceRow(created!, stored.registry);
    });
  }

  const [created] = await getDb()
    .insert(entityInstances)
    .values({
      id: def.id ?? crypto.randomUUID(),
      accountId,
      entityType: def.typeName,
      data: stored.data,
      dataEncoding: stored.dataEncoding,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) throw new DispatchInstancePersistenceConflict("This data identity is already saved");
  return projectEntityToInstanceRow(created!, stored.registry);
}

function replacementDispatchData(
  entityType: string,
  existingData: Record<string, unknown>,
  instance: Record<string, unknown>,
): Record<string, unknown> {
  const oldType =
    typeof existingData["type"] === "string"
      ? (existingData["type"] as string)
      : typeof existingData["class"] === "string"
        ? (existingData["class"] as string)
        : entityType;
  const oldArgs = Array.isArray(existingData["args"])
    ? (existingData["args"] as unknown[])
    : [];
  const nextArgs = Array.isArray(instance["args"]) ? instance["args"] : oldArgs;
  const newData: Record<string, unknown> = {
    type: oldType,
    args: nextArgs,
    methods: (instance["methods"] as Record<string, unknown>) ?? {},
  };
  if (instance["scope"] !== undefined) newData["scope"] = instance["scope"];
  if (instance["priority"] !== undefined) newData["priority"] = instance["priority"];
  for (const key of ["label", "where"]) {
    if (Object.hasOwn(instance, key)) {
      if (instance[key] !== undefined) newData[key] = instance[key];
    } else if (Object.hasOwn(existingData, key)) newData[key] = existingData[key];
  }
  if ("targetEntityType" in existingData) {
    // Keep explicit entity targets; an automatically derived target follows
    // the edited dispatch argument instead of pointing at its former value.
    const target = existingData["targetEntityType"] === oldArgs[0]
      ? typeof nextArgs[0] === "string" ? nextArgs[0] : undefined
      : existingData["targetEntityType"];
    if (target !== undefined) newData["targetEntityType"] = target;
  }
  return newData;
}

export async function updateDispatchInstance(
  accountId: string,
  id: string,
  patch: { instance: Record<string, unknown>; expectedInstance?: Record<string, unknown> },
): Promise<InstanceRow | null> {
  const [classified] = await getDb()
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.id, id),
      ),
    )
    .limit(1);
  if (!classified) {
    if (Object.hasOwn(patch, "expectedInstance")) throw new DispatchInstancePersistenceConflict();
    return null;
  }
  const { interfaceCodeNameToName } = await import("@fenel/engine");
  const registry = await getDbAccountValueRegistry(accountId);
  if (!interfaceCodeNameToName.has(classified.entityType) && !registry.getEntity(classified.entityType)?.interface) {
    if (Object.hasOwn(patch, "expectedInstance")) throw new DispatchInstancePersistenceConflict();
    return null;
  }
  const operation = async (tx: FieldControlPlaneTransaction): Promise<InstanceRow | null> => {
    const [existing] = await tx
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.id, id),
        ),
      )
      .limit(1)
      .for("update");
    if (!existing) {
      if (Object.hasOwn(patch, "expectedInstance")) throw new DispatchInstancePersistenceConflict();
      return null;
    }
    if (!interfaceCodeNameToName.has(existing.entityType) && !registry.getEntity(existing.entityType)?.interface) {
      if (Object.hasOwn(patch, "expectedInstance")) throw new DispatchInstancePersistenceConflict();
      return null;
    }
    // Storage marshalling preserves native atoms and literal marker data.
    // The existing Fenel body owns equality; the row stays locked until write.
    if (Object.hasOwn(patch, "expectedInstance") && dispatchEngineBody("engine:eufValEq", [
      encodeCheckpointValue(projectEntityToInstance(existing, registry)),
      encodeCheckpointValue(patch.expectedInstance),
    ]) !== true) throw new DispatchInstancePersistenceConflict();
    const oldData = (existing.data ?? {}) as Record<string, unknown>;
    await assertNotFieldControlPlaneWrite(accountId, existing.entityType, oldData, tx);
    const newData = replacementDispatchData(
      existing.entityType,
      oldData,
      patch.instance,
    );
    const stored = await storedDispatchData(accountId, newData, registry);
    await assertNotFieldControlPlaneWrite(accountId, existing.entityType, newData, tx);
    const [updated] = await tx
      .update(entityInstances)
      .set({ data: stored.data, dataEncoding: stored.dataEncoding, updatedAt: new Date() })
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.id, id),
          eq(entityInstances.entityType, existing.entityType),
        ),
      )
      .returning();
    return updated ? projectEntityToInstanceRow(updated, registry) : null;
  };
  return mayTouchFieldControlPlane(classified.entityType)
    ? withFieldControlPlaneAccountTransaction(accountId, operation)
    : getDb().transaction(operation);
}

export async function deleteDispatchInstance(accountId: string, id: string,
  options: { expectedInstance?: Record<string, unknown> } = {}) {
  // Account + id are both mandatory. Narrow to spec rows too so an errant id
  // cannot delete an unrelated entity_instance in the same account.
  // Phase 3.4b — narrow by membership in the registered spec class names
  // (suffix-free), replacing the retired `like "%Spec"` filter.
  const { interfaceCodeNameToName } = await import("@fenel/engine");
  const registry = await getDbAccountValueRegistry(accountId);
  const codeNames = [...new Set([...interfaceCodeNameToName.keys(), ...registry.listEntities().filter((entity) => entity.interface).map((entity) => entity.id)])];
  if (codeNames.length === 0) {
    if (Object.hasOwn(options, "expectedInstance")) throw new DispatchInstancePersistenceConflict();
    return;
  }
  const [classified] = await getDb()
    .select({ entityType: entityInstances.entityType })
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.id, id),
        inArray(entityInstances.entityType, codeNames),
      ),
    )
    .limit(1);
  if (!classified) {
    if (Object.hasOwn(options, "expectedInstance")) throw new DispatchInstancePersistenceConflict();
    return;
  }

  const operation = async (tx: FieldControlPlaneTransaction) => {
    const [existing] = await tx
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.id, id),
          inArray(entityInstances.entityType, codeNames),
        ),
      )
      .limit(1)
      .for("update");
    if (!existing) {
      if (Object.hasOwn(options, "expectedInstance")) throw new DispatchInstancePersistenceConflict();
      return;
    }
    if (Object.hasOwn(options, "expectedInstance") && dispatchEngineBody("engine:eufValEq", [
      encodeCheckpointValue(projectEntityToInstance(existing, registry)),
      encodeCheckpointValue(options.expectedInstance),
    ]) !== true) throw new DispatchInstancePersistenceConflict();
    const data = (existing.data ?? {}) as Record<string, unknown>;
    await assertNotFieldControlPlaneWrite(accountId, existing.entityType, data, tx);
    return tx
      .delete(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, accountId),
          eq(entityInstances.id, id),
          inArray(entityInstances.entityType, codeNames),
        ),
      );
  };
  return mayTouchFieldControlPlane(classified.entityType)
    ? withFieldControlPlaneAccountTransaction(accountId, operation)
    : getDb().transaction(operation);
}

// ---------------------------------------------------------------------------
// Phase 10a sub-step 4 — typed-Id surface aliases. Identical to the
// legacy names above; provided so new code can use dispatch-registry-
// flavored vocabulary. Followup-7 (engine-internal helper + Fenel fn ID
// rename sweep) deletes the legacy names entirely.
// ---------------------------------------------------------------------------

export const listDispatchEntries = listInstances;
export const getDispatchEntry = getDispatchInstance;
export const createDispatchEntry = createDispatchInstance;
export const updateDispatchEntry = updateDispatchInstance;
export const deleteDispatchEntry = deleteDispatchInstance;
