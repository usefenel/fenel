// ---------------------------------------------------------------------------
// Ephemeral function runner — execute a Fenel function by slug and return
// its result synchronously (no suspension support).
//
// Used by the collector hook system to call welcome / completion / onField
// functions outside of a parent evaluator context. Creates a short-lived
// function instance, runs turns until completion or suspension, and returns
// the `_lastResult` variable.
//
// ⚠ NAMING, because a grep for "ephemeral" now finds two unrelated things.
// "Ephemeral" HERE means "no PARENT instance" — this runner still inserts a
// `function_instances` row through `createActiveFunctionInstance` and still
// persists traces. rights R1's `runUnpersistedCall` (`evaluator.ts`) is the
// one that writes NOTHING, which is why it is named for what it does not do.
// ---------------------------------------------------------------------------

import { eq, and } from "drizzle-orm";
import { getDb, functionInstances, functions, createActiveFunctionInstance } from "@fenel/db";
import { executeInstance, type RuntimeDependencies } from "./evaluator";
import type { AuthorityRef } from "@fenel/engine/authority";
import { CHECKPOINT_VALUE_ENCODING, encodeCheckpointVariables, decodeCheckpointVariables } from "@fenel/engine/checkpoint-json";

/** rights R2a — `authority` is a REQUIRED parameter, NOT a mint inside this
 *  function. A hook is reached FROM a leaf that already holds the caller's
 *  authority (`state.call_hook_function_*`, `telegram-form`), and minting a
 *  fresh worker authority here would launder a restricted caller into the full
 *  member envelope one hop down — exactly the nested-hop leak this phase
 *  exists to close. Only a genuinely sessionless caller mints. */
export async function runEphemeralFunction(
  accountId: string,
  fnSlug: string,
  params: Record<string, unknown>,
  authority: AuthorityRef,
  dependencies?: RuntimeDependencies,
): Promise<unknown> {
  const db = dependencies?.getDb() ?? getDb();

  const [fnRow] = await db
    .select()
    .from(functions)
    .where(
      and(
        eq(functions.accountId, accountId),
        eq(functions.name, fnSlug),
        eq(functions.active, true),
      ),
    )
    .limit(1);
  if (!fnRow) return null;

  const profileId = typeof params._profileId === "string" && params._profileId !== "" ? params._profileId : null;
  const start = dependencies === undefined ? createActiveFunctionInstance : dependencies.createActiveFunctionInstance;
  const instance = start
    ? await start(accountId, { id: fnRow.id }, { profileId, variables: { ...params }, triggerEvent: {} })
    : (await db.insert(functionInstances).values({
      functionId: fnRow.id,
      accountId,
      profileId,
      status: "running",
      variables: encodeCheckpointVariables(params), variablesEncoding: CHECKPOINT_VALUE_ENCODING,
    }).returning())[0];
  if (!instance) return null;

  await executeInstance(instance.id, undefined, authority, dependencies);

  const [completed] = await db
    .select()
    .from(functionInstances)
    .where(eq(functionInstances.id, instance.id))
    .limit(1);

  if (!completed || completed.status !== "completed") {
    throw new Error(`Ephemeral function '${fnSlug}' did not complete (${completed?.status ?? "missing"})`);
  }
  return decodeCheckpointVariables(completed.variables, completed.variablesEncoding)._lastResult ?? null;
}
