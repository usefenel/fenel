import { eq, sql, desc, and } from "drizzle-orm";
import { getDb } from "../client";
import { functionTraces, functions, functionInstances } from "../schema/functions";
import type { Trace } from "@fenel/engine/types";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointValue, decodeCheckpointValue } from "@fenel/engine/checkpoint-json";

export async function insertTraces(traces: Trace[]): Promise<void> {
  if (traces.length === 0) return;
  const db = getDb();
  await db.insert(functionTraces).values(
    traces.map((s) => ({
      id: s.id,
      instanceId: s.instanceId,
      parentId: s.parentId.$tag === "Just" ? s.parentId._0 : null,
      name: s.name,
      kind: s.kind,
      status: s.status,
      startedAt: new Date(s.startedAt),
      completedAt: s.completedAt.$tag === "Just" ? new Date(s.completedAt._0) : null,
      durationMs: s.durationMs.$tag === "Just" ? s.durationMs._0 : null,
      // The flagged format owns the complete Maybe slots. In particular,
      // Just(null) remains a returned null instead of becoming Nothing.
      input: encodeCheckpointValue(s.input) as Record<string, unknown>,
      output: encodeCheckpointValue(s.output),
      valuesEncoding: CHECKPOINT_VALUE_ENCODING,
      error: s.error.$tag === "Just" ? s.error._0 : null,
      capability: s.capability.$tag === "Just" ? s.capability._0 : null,
      provider: s.provider.$tag === "Just" ? s.provider._0 : null,
      effects: null,
      meta: encodeCheckpointValue(s.meta),
      valueTypes: s.valueTypes.$tag === "Just" && s.valueTypes._0.length ? s.valueTypes._0 : null,
      stepPath: s.stepPath.$tag === "Just" ? s.stepPath._0 : null,
    })),
  );
}

/** ⚠ ACCOUNT-SCOPED, and it was not (rights R2b review round 6). `traces` has
 *  no account column, so this matched on `instance_id` alone and returned every
 *  step's `input` and `output` payload for a run in ANY account — measured
 *  `Just true` for a `viewer` of A against an instance in B, and the act argues
 *  no account handle, so no partition axis reaches it. The owning
 *  `function_instances` row DOES carry `account_id`; an instance in another
 *  account reads as an empty trace list, which is what a caller that cannot see
 *  the instance should observe. */
export async function getTracesByInstance(
  accountId: string,
  instanceId: string,
): Promise<Trace[]> {
  const db = getDb();
  const [owner] = await db
    .select({ accountId: functionInstances.accountId })
    .from(functionInstances)
    .where(eq(functionInstances.id, instanceId))
    .limit(1);
  if (!owner || owner.accountId !== accountId) return [];
  const rows = await db
    .select()
    .from(functionTraces)
    .where(eq(functionTraces.instanceId, instanceId))
    .orderBy(functionTraces.startedAt);
  return rows.map(rowToTrace);
}

// rights R2b review round 6 — the account rides through; this has no caller
// outside this file today, and threading it keeps the scoping honest if one lands.
export async function getTraceTree(accountId: string, instanceId: string): Promise<TraceNode[]> {
  const traces = await getTracesByInstance(accountId, instanceId);
  const map = new Map<string, TraceNode>();
  const roots: TraceNode[] = [];

  for (const trace of traces) {
    map.set(trace.id, { ...trace, children: [] });
  }
  for (const node of map.values()) {
    if (node.parentId.$tag === "Just" && map.has(node.parentId._0)) {
      map.get(node.parentId._0)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export type TraceNode = Trace & { children: TraceNode[] };

/** Recent traces touching values of `typeName`, scoped to one account.
 *  Joined with the function row so the UI can link back to the function. */
export type TraceWithContext = Trace & {
  functionId: string | null;
  functionName: string | null;
  profileId: string | null;
};

export async function getRecentTracesByType(
  accountId: string,
  typeName: string,
  limit = 50,
): Promise<TraceWithContext[]> {
  const db = getDb();
  const rows = await db
    .select({
      trace: functionTraces,
      functionId: functions.id,
      functionName: functions.name,
      profileId: functionInstances.profileId,
    })
    .from(functionTraces)
    .innerJoin(functionInstances, eq(functionInstances.id, functionTraces.instanceId))
    .leftJoin(functions, eq(functions.id, functionInstances.functionId))
    .where(
      and(
        eq(functionInstances.accountId, accountId),
        sql`${functionTraces.valueTypes} @> ${JSON.stringify([typeName])}::jsonb`,
      ),
    )
    .orderBy(desc(functionTraces.startedAt))
    .limit(limit);
  return rows.map((r) => ({
    ...rowToTrace(r.trace),
    functionId: r.functionId,
    functionName: r.functionName,
    profileId: r.profileId,
  }));
}

function rowToTrace(row: typeof functionTraces.$inferSelect): Trace {
  const encoded = row.valuesEncoding != null;
  // Calling the shared decoder with an unknown flag rejects it explicitly;
  // legacy nullable columns retain their established Maybe projection.
  const input = decodeCheckpointValue(row.input, row.valuesEncoding);
  const output = decodeCheckpointValue(row.output, row.valuesEncoding);
  const meta = decodeCheckpointValue(row.meta, row.valuesEncoding);
  return {
    id: row.id,
    instanceId: row.instanceId,
    parentId: row.parentId !== null ? Just(row.parentId) : Nothing,
    name: row.name,
    kind: row.kind,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt !== null ? Just(row.completedAt.toISOString()) : Nothing,
    durationMs: row.durationMs !== null ? Just(row.durationMs) : Nothing,
    input: encoded ? input as Trace["input"] : input !== null ? Just(input as Record<string, unknown>) : Nothing,
    output: encoded ? output as Trace["output"] : output !== null ? Just(output) : Nothing,
    error: row.error !== null ? Just(row.error) : Nothing,
    capability: row.capability !== null ? Just(row.capability) : Nothing,
    provider: row.provider !== null ? Just(row.provider) : Nothing,
    meta: (meta ?? Nothing) as Trace["meta"],
    valueTypes: row.valueTypes !== null ? Just(row.valueTypes) : Nothing,
    stepPath: row.stepPath !== null ? Just(row.stepPath) : Nothing,
  };
}
