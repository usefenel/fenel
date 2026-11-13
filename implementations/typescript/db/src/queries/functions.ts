import { invalidateRegistryRequestScope } from "@fenel/engine/registry-request-scope";
import { FunctionStartUnavailable } from "@fenel/engine/result";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { getDb } from "../client";
import { functions, functionInstances } from "../schema/functions";
import { registryImports } from "../schema/registries";
import { withFieldControlPlaneAccountTransaction } from "./field-control-plane";
import { functionDefinitionFromJsonWire, functionDefinitionToJsonWire } from "@fenel/engine/authoring/expression";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointVariables, encodeCheckpointValue } from "@fenel/engine/checkpoint-json";
import type { FenelFunction } from "@fenel/engine/types";

function canonicalFunctionRow<T extends typeof functions.$inferSelect>(row: T): T {
  // Immutable source-owned rows carry a display cache only. Their evaluator
  // reparses the owning source version; never turn cached JSON into authority.
  return row.sourceRegistryId ? row : { ...row, function: functionDefinitionFromJsonWire(row.function as unknown as FenelFunction) as unknown as Record<string, unknown> };
}

/** Pause execution without deleting the current definition or its Fields. */
export async function setFunctionActive(accountId: string, functionId: string, active: boolean) {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  return withFieldControlPlaneAccountTransaction(accountId, async (tx) => {
    const [row] = await tx.update(functions).set({ active, updatedAt: new Date() })
      .where(and(
        eq(functions.accountId, accountId),
        eq(functions.id, functionId),
        eq(functions.version, 1),
        eq(functions.isSystem, false),
        isNull(functions.sourceRegistryId),
        sql`not exists (select 1 from ${functions} other_function
          where other_function.account_id = ${functions.accountId}
            and other_function.name = ${functions.name}
            and other_function.id <> ${functions.id})`,
      ))
      .returning({ id: functions.id, active: functions.active });
    return row ?? null;
  });
}

export async function listFunctions(accountId: string) {
  const db = getDb();
  const rows = await db.select().from(functions).where(eq(functions.accountId, accountId));
  return rows.map(canonicalFunctionRow);
}

export async function getFunction(accountId: string, name: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(functions)
    .where(and(eq(functions.accountId, accountId), eq(functions.name, name)))
    .orderBy(desc(functions.active), desc(functions.version))
    .limit(1);
  return row ? canonicalFunctionRow(row) : null;
}

// Definition moved to `@fenel/engine/result` — three packages raise, catch and
// republish it, so the DB package should not own it. Re-exported here so every
// existing `from "@fenel/db"` importer keeps working with ONE class identity.
export { FunctionStartUnavailable };

/** Selection and first invocation share the install/activation lock. Historical
 * source rows remain readable for existing runs, but can never start new ones. */
export async function createActiveFunctionInstance(
  accountId: string,
  selector: { id: string } | { name: string },
  data: {
    profileId: string | null;
    variables: Record<string, unknown>;
    triggerEvent: Record<string, unknown>;
    parentInstanceId?: string | null;
  },
) {
  return withFieldControlPlaneAccountTransaction(accountId, async (tx) => {
    const candidates = await tx.select({ id: functions.id, sourceRegistryId: functions.sourceRegistryId })
      .from(functions)
      .where(and(
        eq(functions.accountId, accountId),
        eq(functions.active, true),
        "id" in selector ? eq(functions.id, selector.id) : eq(functions.name, selector.name),
      ))
      .limit(2);
    if (candidates.length !== 1) throw new FunctionStartUnavailable();
    const fn = candidates[0]!;
    if (fn.sourceRegistryId !== null) {
      const [installed] = await tx.select({ id: registryImports.id })
        .from(registryImports)
        .where(and(eq(registryImports.accountId, accountId), eq(registryImports.registryId, fn.sourceRegistryId)))
        .limit(1);
      if (!installed) throw new FunctionStartUnavailable();
    }
    const [instance] = await tx.insert(functionInstances).values({
      ...data, accountId, functionId: fn.id,
      variables: encodeCheckpointVariables(data.variables), variablesEncoding: CHECKPOINT_VALUE_ENCODING,
      triggerEvent: encodeCheckpointValue(data.triggerEvent) as Record<string, unknown>, triggerEventEncoding: CHECKPOINT_VALUE_ENCODING,
      status: "running", currentStepPath: JSON.stringify([0]),
    }).returning();
    return instance!;
  });
}

export async function upsertFunction(
  accountId: string,
  def: {
    name: string;
    function: Record<string, unknown>;
    isSystem?: boolean;
  },
) {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  const db = getDb();
  const existing = await getFunction(accountId, def.name);
  if (existing) {
    if (existing.sourceRegistryId != null) throw new Error("Source-owned functions must be changed through their source module");
    const updates: Record<string, unknown> = {
      function: functionDefinitionToJsonWire(def.function as unknown as FenelFunction),
      updatedAt: new Date(),
    };
    if (def.isSystem !== undefined) updates.isSystem = def.isSystem;
    const [updated] = await db
      .update(functions)
      .set(updates)
      .where(eq(functions.id, existing.id))
      .returning();
    return canonicalFunctionRow(updated!);
  }
  const [created] = await db
    .insert(functions)
    .values({
      accountId,
      name: def.name,
      function: functionDefinitionToJsonWire(def.function as unknown as FenelFunction) as unknown as Record<string, unknown>,
      isSystem: def.isSystem ?? false,
    })
    .returning();
  return canonicalFunctionRow(created!);
}

/** The result of one batched system-function seed pass. `skippedSourceOwned`
 *  counts names whose current row is source-module-owned — the batch skips
 *  them exactly where the per-row `upsertFunction` would have thrown
 *  "Source-owned functions must be changed through their source module". */
export type SeedFunctionsResult = {
  readonly updated: number;
  readonly inserted: number;
  readonly skippedSourceOwned: number;
};

/**
 * Batched equivalent of calling `upsertFunction` once per definition.
 *
 * The boot seed refreshes ~1,534 system functions on every API start. Done one
 * at a time that is 2 serialized round trips each (a `getFunction` SELECT, then
 * an UPDATE-or-INSERT) — measured at 25.5 ms median RTT against the staging
 * Postgres, i.e. 78 s of pure latency before the port can bind, and more once
 * the JSONB write itself is counted.
 *
 * This collapses it to one SELECT plus a handful of chunked writes. The row
 * selected per name is the same one `getFunction` would pick (`active DESC,
 * version DESC`, first row), and source-owned rows are skipped rather than
 * thrown-and-caught, which is what the caller's try/catch already did with them.
 */
export async function seedFunctionsBatch(
  accountId: string,
  defs: ReadonlyArray<{ name: string; function: Record<string, unknown>; isSystem: boolean }>,
): Promise<SeedFunctionsResult> {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  const db = getDb();
  if (defs.length === 0) return { updated: 0, inserted: 0, skippedSourceOwned: 0 };

  // One read for the whole account. `getFunction` orders by `active DESC,
  // version DESC` and takes the first row; reproduce that per name here.
  const existingRows = await db
    .select({
      id: functions.id,
      name: functions.name,
      version: functions.version,
      active: functions.active,
      sourceRegistryId: functions.sourceRegistryId,
    })
    .from(functions)
    .where(eq(functions.accountId, accountId));

  const winnerByName = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    const held = winnerByName.get(row.name);
    if (
      held === undefined ||
      (held.active ? 0 : 1) > (row.active ? 0 : 1) ||
      (held.active === row.active && row.version > held.version)
    ) {
      winnerByName.set(row.name, row);
    }
  }

  const toUpdate: Array<{ id: string; wire: string; isSystem: boolean }> = [];
  const toInsert: Array<typeof functions.$inferInsert> = [];
  let skippedSourceOwned = 0;

  for (const def of defs) {
    const wire = functionDefinitionToJsonWire(def.function as unknown as FenelFunction);
    const winner = winnerByName.get(def.name);
    if (winner === undefined) {
      toInsert.push({
        accountId,
        name: def.name,
        function: wire as unknown as Record<string, unknown>,
        isSystem: def.isSystem,
      });
      continue;
    }
    if (winner.sourceRegistryId != null) {
      skippedSourceOwned++;
      continue;
    }
    toUpdate.push({ id: winner.id, wire: JSON.stringify(wire), isSystem: def.isSystem });
  }

  // 3 bound parameters per row; stay far below PostgreSQL's 65,535 limit.
  const CHUNK = 500;
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const chunk = toUpdate.slice(i, i + CHUNK);
    const values = sql.join(
      chunk.map((r) => sql`(${r.id}::uuid, ${r.wire}::jsonb, ${r.isSystem}::boolean)`),
      sql`, `,
    );
    await db.execute(sql`
      update functions as f
      set function = v.fn, is_system = v.is_system, updated_at = now()
      from (values ${values}) as v(id, fn, is_system)
      where f.id = v.id
    `);
  }
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    await db.insert(functions).values(toInsert.slice(i, i + CHUNK));
  }

  return { updated: toUpdate.length, inserted: toInsert.length, skippedSourceOwned };
}

export async function deleteFunction(accountId: string, name: string) {
  // Registry inputs change here — stop the request-scoped registry memo
  // serving a pre-mutation answer for the rest of this request. No-op outside
  // a request scope. See engine/src/registry-request-scope.ts.
  invalidateRegistryRequestScope();
  const db = getDb();
  return db
    .delete(functions)
    .where(and(eq(functions.accountId, accountId), eq(functions.name, name), isNull(functions.sourceRegistryId)));
}
