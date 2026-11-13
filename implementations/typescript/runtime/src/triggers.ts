import { eq, and, inArray } from "drizzle-orm";
import {
  getDb,
  appendEvent,
  functions,
  functionInstances,
  findSubscriptionsByEventType,
  createActiveFunctionInstance,
} from "@fenel/db";
import { FunctionStartUnavailable } from "@fenel/engine/result";
import type { SuspendMeta } from "@fenel/engine/types";
import { decodeCheckpointRow, decodeCheckpointVariables } from "@fenel/engine/checkpoint-json";
import type { FunctionTrigger } from "./types";
import type { AuthorityRef } from "@fenel/engine/authority";
import {
  executeInstance,
  resumeWaitingInstance,
  handleTimeout,
  reconcileChildWait,
  mintLaneAuthorityFor,
} from "./evaluator";

/**
 * Process an incoming event — check triggers + wake waiting instances.
 *
 * Called whenever an event is appended to the event log. Matches the event
 * against:
 * 1. Function triggers → start new function instances
 * 2. Waiting instances → resume if their wait_for filter matches
 * 3. Timer expirations → fire on_timeout handlers
 *
 * Telegram-specific collector dispatch (form-fill / confirm / picker /
 * callback buttons) lives in the Fenel `telegram:dispatchCollectorEvent`
 * body (engine/src/modules/telegram-bodies/dispatch-collector-event.fenel)
 * — it runs before processEvent on the inbound webhook path so the
 * collector owns its own state machine and processEvent stays purely
 * about user-defined trigger matching.
 */
export async function processEvent(
  accountId: string,
  eventType: string,
  eventPayload: Record<string, unknown>,
  profileId?: string,
): Promise<void> {
  // Scan existing waiters before launching subscriptions. A newly started run
  // must not consume its initiating occurrence again at its first event wait.
  await matchWaitingInstances(accountId, eventType, eventPayload, profileId);
  await matchTriggers(accountId, eventType, eventPayload, profileId);
}

/**
 * Check all active subscriptions for matches against the incoming event.
 *
 * Subscriptions (source = event) replace the previous function_triggers
 * registry. Each row carries the original FunctionTrigger inside
 * metadata.trigger so the existing triggerMatches filter logic can run
 * unchanged.
 */
async function matchTriggers(
  accountId: string,
  eventType: string,
  eventPayload: Record<string, unknown>,
  profileId?: string,
): Promise<void> {
  const db = getDb();
  const rows = await findSubscriptionsByEventType(accountId, eventType);

  for (const sub of rows) {
    const handlerFunctionId = sub.handlerFunctionId;
    if (!handlerFunctionId) continue;

    const trigger = parseTriggerFromMetadata(sub.metadata);
    if (!trigger) continue;
    if (!triggerMatches(trigger, eventType, eventPayload)) continue;

    // Confirm the handler function is still active.
    const [fnRow] = await db
      .select({ id: functions.id, active: functions.active })
      .from(functions)
      .where(and(eq(functions.id, handlerFunctionId), eq(functions.accountId, accountId), eq(functions.active, true)))
      .limit(1);
    if (!fnRow) continue;

    // once_per_profile — at most one instance per (function, profile).
    if (trigger.once_per_profile && profileId) {
      const existing = await db
        .select({ id: functionInstances.id })
        .from(functionInstances)
        .where(
          and(
            eq(functionInstances.functionId, handlerFunctionId),
            eq(functionInstances.profileId, profileId),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;
    }

    if (!profileId) continue; // Functions require a profile

    try {
      await startFunctionInstance(accountId, handlerFunctionId, profileId, eventType, eventPayload);
    } catch (error) {
      // Activation/install may change after the subscription read. The locked
      // start gate is final; an unavailable subscription should not abort peers.
      if (!(error instanceof FunctionStartUnavailable)) throw error;
    }
  }
}

/** Subscriptions store metadata as a JSON-serialised text blob. The
 *  event-source rows carry the original FunctionTrigger under the
 *  `trigger` key — extract it for the matcher. Returns null on any
 *  shape error. */
function parseTriggerFromMetadata(raw: string | null): FunctionTrigger | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.trigger && typeof parsed.trigger === "object") {
      return parsed.trigger as FunctionTrigger;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Check if a trigger definition matches an event.
 *
 * Phase 11a — thin shim delegating to the Fenel-bodied
 * `runtime:triggerMatches` via `dispatchedTriggerMatches`. The body
 * dispatches on a pre-classified TmInput ADT (TmiTypeMismatch /
 * TmiCheck carrying the per-filter list); the wrapper handles the
 * structural classification TS-side.
 */
export function triggerMatches(
  trigger: FunctionTrigger,
  eventType: string,
  eventPayload: Record<string, unknown>,
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedTriggerMatches } = require("./runtime-bodies-dispatch") as typeof import("./runtime-bodies-dispatch");
  return dispatchedTriggerMatches(trigger, eventType, eventPayload);
}

/**
 * Start a new function instance.
 */
/** rights R2a — `authority` is OPTIONAL, and only because two lanes are
 *  genuinely sessionless (an event subscription, the timer sweep). A CALLER
 *  that holds one must pass it: minting a fresh `"trigger"` authority for a
 *  caller-initiated start is the "mint derived from `ctx.accountId` for
 *  convenience" shape brief §4.1 forbids, and it launders the caller into the
 *  full member envelope the moment R2b mints anything narrower. */
export async function startFunctionInstance(
  accountId: string,
  functionId: string,
  profileId: string | null,
  eventType: string,
  eventPayload: Record<string, unknown>,
  authority?: AuthorityRef,
): Promise<string> {
  return startSelectedFunctionInstance(accountId, { id: functionId }, profileId, eventType, eventPayload, authority);
}

/** Manual name-based starts choose the current active version inside the same
 * transaction that records the invocation, including during source upgrades. */
export async function startFunctionInstanceByName(
  accountId: string, name: string, profileId: string | null,
  eventType: string, eventPayload: Record<string, unknown>,
  authority?: AuthorityRef,
): Promise<string> {
  return startSelectedFunctionInstance(accountId, { name }, profileId, eventType, eventPayload, authority);
}

async function startSelectedFunctionInstance(
  accountId: string, selector: { id: string } | { name: string }, profileId: string | null,
  eventType: string, eventPayload: Record<string, unknown>, authority?: AuthorityRef,
): Promise<string> {
  const instance = await createActiveFunctionInstance(accountId, selector, {
      profileId,
      variables: {
        // Spread the eventPayload first so the body can read its
        // params directly as `{var: "botToken"}` etc. Trigger-fired
        // bodies that read from `form` / `event` still work because
        // those keys are written explicitly below (and overwrite any
        // collision from the spread).
        ...eventPayload,
        _profileId: profileId,
        form: eventPayload["form"] ?? eventPayload,
        event: eventPayload,
      },
      triggerEvent: { type: eventType, ...eventPayload },
    });

  await appendEvent({
    accountId,
    type: "function_started",
    aggregateType: "function_instance",
    aggregateId: instance!.id,
    payload: { functionId: instance.functionId, eventType },
    profileId: profileId ?? undefined,
  });

  // Execute the new instance.
  //
  // rights R2a — a trigger has no session behind it, so it mints a NAMED worker
  // authority. The name is what makes `grep mintInterimWorkerAuthority` R4's
  // ingress census instead of a guess.
  await executeInstance(
    instance!.id,
    undefined,
    authority ?? await mintLaneAuthorityFor(accountId, "trigger"),
  );

  return instance!.id;
}

/**
 * Find waiting instances whose wait_for filter matches the event.
 *
 * Phase 5b (ts-elimination-completion) — the per-row filter-match decision
 * (incl. the `$`-interpolation) + the loop FOLD into the Fenel-bodied
 * `runtime:selectWaitingToResume` (via `dispatchedSelectWaitingToResume`,
 * synchronous pure pass). This shell keeps only the irreducible IO: the row
 * read + the `resumeWaitingInstance` durable drive per selected id.
 */
async function matchWaitingInstances(
  accountId: string,
  eventType: string,
  eventPayload: Record<string, unknown>,
  profileId?: string,
): Promise<void> {
  const db = getDb();

  // Find all instances waiting for events
  const waiting = await db
    .select()
    .from(functionInstances)
    .where(
      and(
        eq(functionInstances.accountId, accountId),
        eq(functionInstances.status, "waiting_event"),
      ),
    );

  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedSelectWaitingToResume } = require("./runtime-bodies-dispatch") as typeof import("./runtime-bodies-dispatch");
  const toResume = dispatchedSelectWaitingToResume(
    waiting.map(decodeCheckpointRow),
    eventType,
    eventPayload,
    profileId,
  );

  for (const instanceId of toResume) {
    // rights C1 — the ids came from an account-scoped scan (`:212`); re-assert
    // that scope at the resume itself so the predicate rides the lookup rather
    // than the caller's memory of how it built the list.
    const outcome = await resumeWaitingInstance(
      instanceId,
      { type: eventType, ...eventPayload },
      {
        issuer: "event-match",
        accountId,
        expectedVariables: waiting.find((row) => row.id === instanceId)!.variables,
        authority: await mintLaneAuthorityFor(accountId, "event-match"),
      },
    );
    if (!outcome.resumed && outcome.reason === "invalid-input") {
      console.warn("[runtime] Event did not match the waiting input type", { accountId, instanceId, eventType });
    }
  }
}

/** A function_instances row, narrowed to the timeout-sweep fields. */
type TimeoutRow = { id: string; variables: unknown; variablesEncoding?: unknown };

/** Parse a WaitTimer instance's `wakeAt` to epoch-ms. `undefined` when the
 *  instance isn't a WaitTimer or `wakeAt` is absent/empty (→ not due).
 *  `new Date(iso).getTime()` is the irreducible wall-clock-parse IO leaf; the
 *  due comparison itself is the pure Fenel `instantDue`. Mirrors the original
 *  `wakeAt && new Date(wakeAt) <= now` guard (empty/invalid → not due). */
function wakeAtMs(instance: TimeoutRow): number | undefined {
  const vars = decodeCheckpointVariables(instance.variables, instance.variablesEncoding);
  const sm = vars._suspendMeta as SuspendMeta | undefined;
  const wakeAt = sm && sm.$tag === "WaitTimer" ? sm.wakeAt : undefined;
  return wakeAt ? new Date(wakeAt).getTime() : undefined;
}

/** Parse a WaitEvent instance's `_timeoutAt` to epoch-ms. `undefined` when
 *  absent/empty (→ not timed out). Sister of `wakeAtMs`. */
function timeoutAtMs(instance: TimeoutRow): number | undefined {
  const vars = decodeCheckpointVariables(instance.variables, instance.variablesEncoding);
  const timeoutAt = vars._timeoutAt as string | undefined;
  return timeoutAt ? new Date(timeoutAt).getTime() : undefined;
}

/**
 * Check for timed-out waiting instances for a specific account.
 * Call this periodically (e.g., every minute via a cron job).
 *
 * Phase 5b — the `wakeAt`/`_timeoutAt <= now` comparison + the sweep loops
 * FOLD into `runtime:selectDueInstances` (via `dispatchedSelectDueInstances`).
 * `Date.now()` + the per-row `new Date(...).getTime()` stay the wall-clock IO
 * leaf; the inclusive `<=` is the pure Fenel body. The shell runs the
 * `resumeWaitingInstance` / `handleTimeout` durable drives per due id.
 */
export async function checkTimeouts(accountId: string): Promise<void> {
  const db = getDb();
  const nowMs = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedSelectDueInstances } = require("./runtime-bodies-dispatch") as typeof import("./runtime-bodies-dispatch");

  // Check timer-based waits
  const timerWaiting = await db
    .select()
    .from(functionInstances)
    .where(
      and(
        eq(functionInstances.accountId, accountId),
        eq(functionInstances.status, "waiting_timer"),
      ),
    );
  const timerDue = dispatchedSelectDueInstances(
    timerWaiting.map((inst) => ({ instanceId: inst.id, ms: wakeAtMs(inst) })),
    nowMs,
  );
  for (const instanceId of timerDue) {
    // rights C1 — this sweep is already account-scoped (`:279`); say so.
    await resumeWaitingInstance(
      instanceId,
      { type: "_timer_fired" },
      {
        issuer: "timer-sweep",
        accountId,
        expectedVariables: timerWaiting.find((row) => row.id === instanceId)!.variables,
        authority: await mintLaneAuthorityFor(accountId, "timer-sweep"),
      },
    );
  }

  // Check event waits with timeouts
  const eventWaiting = await db
    .select()
    .from(functionInstances)
    .where(
      and(
        eq(functionInstances.accountId, accountId),
        inArray(functionInstances.status, ["waiting_event", "awaiting_choice"]),
      ),
    );
  const eventDue = dispatchedSelectDueInstances(
    eventWaiting.map((inst) => ({ instanceId: inst.id, ms: timeoutAtMs(inst) })),
    nowMs,
  );
  for (const instanceId of eventDue) {
    await handleTimeout(instanceId, {
      issuer: "timer-sweep",
      accountId,
      expectedVariables: eventWaiting.find((row) => row.id === instanceId)!.variables,
      authority: await mintLaneAuthorityFor(accountId, "timer-sweep"),
    });
  }
  for (const instance of eventWaiting) {
    if ((decodeCheckpointVariables(instance.variables, instance.variablesEncoding)._suspendMeta as SuspendMeta | undefined)?.$tag === "WaitChild") {
      await reconcileChildWait(instance.id, accountId);
    }
  }
}

/**
 * Check all accounts for timed-out instances.
 * Designed for the in-process setInterval tick.
 *
 * Phase 5b — same fold as `checkTimeouts` (all-accounts scan). The per-id
 * try/catch + `console.error` resilience (the tick must never die on one bad
 * instance — watch-out #4) stays in this thin shell wrapping each durable
 * leaf call; the Fenel `selectDueInstances` fold only decides which are due.
 */
export async function checkAllTimeouts(): Promise<void> {
  const db = getDb();
  const nowMs = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { dispatchedSelectDueInstances } = require("./runtime-bodies-dispatch") as typeof import("./runtime-bodies-dispatch");

  // Timer-based waits (all accounts)
  const timerWaiting = await db
    .select()
    .from(functionInstances)
    .where(eq(functionInstances.status, "waiting_timer"));
  const timerDue = dispatchedSelectDueInstances(
    timerWaiting.map((inst) => ({ instanceId: inst.id, ms: wakeAtMs(inst) })),
    nowMs,
  );
  for (const instanceId of timerDue) {
    try {
      // rights C1 — the ONLY lane that legitimately spells `accountId: null`.
      // This is the in-process all-accounts tick: it scans every account by
      // design (`:329`), so there is no account to predicate on. Deriving the
      // predicate from the scanned row would be self-authorizing — a check
      // that cannot fail is worse than a named exemption.
      await resumeWaitingInstance(
        instanceId,
        { type: "_timer_fired" },
        {
          issuer: "timer-sweep",
          accountId: null,
          expectedVariables: timerWaiting.find((row) => row.id === instanceId)!.variables,
          // rights R2a — the all-accounts tick knows no account until the row
          // is read, and reading it first would undo C1's "the predicate rides
          // the lookup". The authority therefore names no account and carries
          // the BASE registry's member envelope. R4 replaces this whole lane.
          authority: await mintLaneAuthorityFor("", "timer-sweep"),
        },
      );
    } catch (err) {
      console.error(`[tick] Failed to resume timer instance ${instanceId}:`, err);
    }
  }

  // Event waits with timeouts (all accounts)
  const eventWaiting = await db
    .select()
    .from(functionInstances)
    .where(inArray(functionInstances.status, ["waiting_event", "awaiting_choice"]));
  const eventDue = dispatchedSelectDueInstances(
    eventWaiting.map((inst) => ({ instanceId: inst.id, ms: timeoutAtMs(inst) })),
    nowMs,
  );
  for (const instanceId of eventDue) {
    try {
      // rights C1 — same all-accounts tick exemption as the timer arm above.
      await handleTimeout(instanceId, {
        issuer: "timer-sweep",
        accountId: null,
        expectedVariables: eventWaiting.find((row) => row.id === instanceId)!.variables,
        // rights R2a — same all-accounts exemption as the timer arm above.
        authority: await mintLaneAuthorityFor("", "timer-sweep"),
      });
    } catch (err) {
      console.error(`[tick] Failed to handle timeout for instance ${instanceId}:`, err);
    }
  }
  for (const instance of eventWaiting) {
    if ((decodeCheckpointVariables(instance.variables, instance.variablesEncoding)._suspendMeta as SuspendMeta | undefined)?.$tag !== "WaitChild") continue;
    try {
      await reconcileChildWait(instance.id, instance.accountId);
    } catch (err) {
      console.error(`[tick] Failed to reconcile child wait ${instance.id}:`, err);
    }
  }
}

