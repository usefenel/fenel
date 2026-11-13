// ---------------------------------------------------------------------------
// Function-entity tracking — bidirectional visibility
//
// Profile → Functions: "what functions is this profile in, and where?"
// Function → Profiles: "what profiles are in this function, and where?"
//
// Uses the existing functionInstances table. No schema changes needed —
// profileId is already a column, checkpoints live in variables._checkpoints.
// ---------------------------------------------------------------------------

import { eq, and, desc, sql, type SQL } from "drizzle-orm";
import { getDb } from "../client";
import { functionInstances, functions } from "../schema/functions";
import { decodeCheckpointRow } from "@fenel/engine/checkpoint-json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FunctionPosition = {
  instanceId: string;
  functionId: string;
  functionName: string;
  status: string;
  currentStepPath: string | null;
  checkpoints: string[];
  lastCheckpoint: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

export type FunctionInstanceSummary = {
  instanceId: string;
  profileId: string | null;
  status: string;
  currentStepPath: string | null;
  checkpoints: string[];
  lastCheckpoint: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

export type FunctionStats = {
  total: number;
  running: number;
  waiting: number;
  completed: number;
  cancelled: number;
  failed: number;
  byCheckpoint: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Profile → Functions: "what functions is this profile in?"
// ---------------------------------------------------------------------------

/**
 * Get all function instances for a profile, with position info.
 */
export async function getProfileFunctions(
  accountId: string,
  profileId: string,
  opts?: { status?: string; limit?: number },
): Promise<FunctionPosition[]> {
  const db = getDb();
  const conditions: SQL[] = [
    eq(functionInstances.accountId, accountId),
    eq(functionInstances.profileId, profileId),
  ];

  if (opts?.status) {
    conditions.push(eq(functionInstances.status, opts.status as any));
  }

  const rows = await db
    .select({
      instanceId: functionInstances.id,
      functionId: functionInstances.functionId,
      functionName: functions.name,
      status: functionInstances.status,
      currentStepPath: functionInstances.currentStepPath,
      variables: functionInstances.variables,
      variablesEncoding: functionInstances.variablesEncoding,
      startedAt: functionInstances.startedAt,
      completedAt: functionInstances.completedAt,
    })
    .from(functionInstances)
    .innerJoin(
      functions,
      eq(functions.id, functionInstances.functionId),
    )
    .where(and(...conditions))
    .orderBy(desc(functionInstances.startedAt))
    .limit(opts?.limit ?? 50);

  return rows.map(decodeCheckpointRow).map((r) => ({
    instanceId: r.instanceId,
    functionId: r.functionId,
    functionName: r.functionName,
    status: r.status,
    currentStepPath: r.currentStepPath,
    checkpoints: extractCheckpoints(r.variables),
    lastCheckpoint: extractLastCheckpoint(r.variables),
    startedAt: r.startedAt,
    completedAt: r.completedAt,
  }));
}

// ---------------------------------------------------------------------------
// Function → Profiles: "what profiles are in this function?"
// ---------------------------------------------------------------------------

/**
 * Get all instances for a function, with profile IDs and positions.
 */
export async function getFunctionInstances(
  accountId: string,
  functionId: string,
  opts?: { status?: string; limit?: number; offset?: number },
): Promise<FunctionInstanceSummary[]> {
  const db = getDb();
  const conditions: SQL[] = [
    eq(functionInstances.accountId, accountId),
    eq(functionInstances.functionId, functionId),
  ];

  if (opts?.status) {
    conditions.push(eq(functionInstances.status, opts.status as any));
  }

  const rows = await db
    .select()
    .from(functionInstances)
    .where(and(...conditions))
    .orderBy(desc(functionInstances.startedAt))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);

  return rows.map(decodeCheckpointRow).map((r) => ({
    instanceId: r.id,
    profileId: r.profileId,
    status: r.status,
    currentStepPath: r.currentStepPath,
    checkpoints: extractCheckpoints(r.variables),
    lastCheckpoint: extractLastCheckpoint(r.variables),
    startedAt: r.startedAt,
    completedAt: r.completedAt,
  }));
}

/**
 * One-shot status counts for every function in an account. Lets the
 * functions listing show "running" / "waiting" badges per row without
 * fanning out N queries.
 */
export type FunctionLiveCounts = {
  running: number;
  waiting: number;
};

export async function getFunctionLiveCounts(
  accountId: string,
): Promise<Record<string, FunctionLiveCounts>> {
  const db = getDb();
  const rows = await db
    .select({
      functionId: functionInstances.functionId,
      status: functionInstances.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(functionInstances)
    .where(eq(functionInstances.accountId, accountId))
    .groupBy(functionInstances.functionId, functionInstances.status);

  const out: Record<string, FunctionLiveCounts> = {};
  for (const r of rows) {
    const counts = (out[r.functionId] ??= { running: 0, waiting: 0 });
    const n = Number(r.count);
    switch (r.status) {
      case "running": counts.running += n; break;
      case "waiting_timer":
      case "waiting_event":
      case "awaiting_choice":
        counts.waiting += n; break;
    }
  }
  return out;
}

/**
 * Get aggregate stats for a function.
 */
export async function getFunctionStats(
  accountId: string,
  functionId: string,
): Promise<FunctionStats> {
  const db = getDb();

  const rows = await db
    .select({
      status: functionInstances.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(functionInstances)
    .where(
      and(
        eq(functionInstances.accountId, accountId),
        eq(functionInstances.functionId, functionId),
      ),
    )
    .groupBy(functionInstances.status);

  const stats: FunctionStats = {
    total: 0,
    running: 0,
    waiting: 0,
    completed: 0,
    cancelled: 0,
    failed: 0,
    byCheckpoint: {},
  };

  for (const row of rows) {
    const n = Number(row.count);
    stats.total += n;
    switch (row.status) {
      case "running": stats.running = n; break;
      case "waiting_timer":
      case "waiting_event":
      case "awaiting_choice":
        stats.waiting += n; break;
      case "completed": stats.completed = n; break;
      case "cancelled": stats.cancelled = n; break;
      case "failed": stats.failed = n; break;
    }
  }

  // Checkpoint breakdown — count instances that have passed each checkpoint
  // Project checkpoint storage before reading its language-level fields.
  const allInstances = await db
    .select({ variables: functionInstances.variables, variablesEncoding: functionInstances.variablesEncoding })
    .from(functionInstances)
    .where(
      and(
        eq(functionInstances.accountId, accountId),
        eq(functionInstances.functionId, functionId),
      ),
    );

  for (const inst of allInstances.map(decodeCheckpointRow)) {
    const cps = extractCheckpoints(inst.variables);
    for (const cp of cps) {
      stats.byCheckpoint[cp] = (stats.byCheckpoint[cp] ?? 0) + 1;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractCheckpoints(
  variables: Record<string, unknown> | null,
): string[] {
  if (!variables) return [];
  const cps = variables._checkpoints;
  if (Array.isArray(cps)) return cps as string[];
  return [];
}

function extractLastCheckpoint(
  variables: Record<string, unknown> | null,
): string | null {
  if (!variables) return null;
  return (variables._lastCheckpoint as string) ?? null;
}
