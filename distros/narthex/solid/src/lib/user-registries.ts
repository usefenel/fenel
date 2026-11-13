// ---------------------------------------------------------------------------
// User-registries loader — pulls TypeViews / FenelFunctions / source modules
// from the typed-registry tables and merges them into the
// engine + frontend registries on first call. Idempotent.
//
// Used by AdminForm (views via webRegistry) and StepEditor (user
// functions via the userFunctions signal). Also exposes
// reloadUserRegistries() so dashboard CRUD pages can refresh the
// signals without a full page reload.
//
// We bypass the @solidjs/router query() cache here on purpose — the
// signals are the source of truth for the live editors, so the loader
// always hits the API when called fresh.
// ---------------------------------------------------------------------------

import { createSignal } from "solid-js";
import type { FenelFunction, TypeView } from "@fenel/engine/types";
import type { SourceModuleDocument } from "@fenel/engine/authoring/source-module";
import { apiRead } from "./api";
import { accountFunctionRows, repositoryFunctionIdsForAuthoring, type AccountFunctionRow } from "./user-function-roster";
import { withinWorkspaceLimit } from "./workspace-module-preload";

// ---- Module-level reactive signals -----------------------------------------

const [userViews, setUserViews] = createSignal<TypeView[]>([]);
const [userFunctions, setUserFunctions] = createSignal<FenelFunction[]>([]);
const [userSourceModules, setUserSourceModules] = createSignal<SourceModuleDocument[]>([]);

export { userViews, userFunctions };

export function sourceModulesForAccount(accountId: string): readonly SourceModuleDocument[] {
  const documents = userSourceModules();
  return desiredAccountId === accountId ? documents : [];
}

// ---- Loader ---------------------------------------------------------------

let desiredAccountId: string | undefined;
let loadedAccountId: string | undefined;
let loadEpoch = 0;
let loading:
  | { readonly accountId: string; readonly epoch: number; readonly promise: Promise<void> }
  | undefined;

function clearLoadingGeneration(accountId: string, epoch: number): void {
  if (loading?.accountId === accountId && loading.epoch === epoch) loading = undefined;
}

async function runLoad(accountId: string, epoch: number): Promise<boolean> {
  const { functionDefinitionFromJsonWire, viewDefinitionFromJsonWire } = await import("@fenel/engine/authoring/expression");
  if (desiredAccountId !== accountId || loadEpoch !== epoch) return false;
  const [viewsRes, fnsRes, modulesRes] = await Promise.allSettled([
    apiRead<{ views?: Array<{ view: TypeView }> }>("/views"),
    apiRead<{ functions?: AccountFunctionRow[] }>("/functions"),
    apiRead<{ modules?: SourceModuleDocument[] }>("/modules/installed"),
  ]);
  if (desiredAccountId !== accountId || loadEpoch !== epoch) return false;
  let functions: FenelFunction[] | undefined;
  if (fnsRes.status === "fulfilled") {
    const rows = fnsRes.value?.functions ?? [];
    // Most empty/new accounts need no extra module import. Existing accounts
    // compare system rows against actual seed-profile membership, not names.
    const repositoryIds = rows.some((row) => row.isSystem === true && !row.sourceRegistryId)
      ? await withinWorkspaceLimit("function roster", repositoryFunctionIdsForAuthoring) : new Set<string>();
    if (desiredAccountId !== accountId || loadEpoch !== epoch) return false;
    functions = accountFunctionRows(rows, repositoryIds).map((row) => functionDefinitionFromJsonWire(row.function));
  }
  if (viewsRes.status === "fulfilled") {
    setUserViews((viewsRes.value?.views ?? []).map((r) => viewDefinitionFromJsonWire(r.view)));
  }
  if (functions !== undefined) setUserFunctions(functions);
  if (modulesRes.status === "fulfilled") {
    const next = modulesRes.value.modules ?? [];
    setUserSourceModules((prior) => JSON.stringify(prior) === JSON.stringify(next) ? prior : next);
  }
  // Dispatch-instance hydration belongs to the server. No browser consumer
  // used the old diagnostic read, so it must not delay editor readiness.
  return viewsRes.status === "fulfilled" && fnsRes.status === "fulfilled" && modulesRes.status === "fulfilled";
}

/** Synchronously revoke the previous account's browser roster before any child
 * route can render under a newly authenticated subject. In-flight responses
 * carry the epoch/account pair and are discarded if they arrive late. */
export function setUserRegistryAccountScope(accountId: string | undefined): void {
  if (desiredAccountId === accountId) return;
  desiredAccountId = accountId;
  loadedAccountId = undefined;
  loading = undefined;
  loadEpoch += 1;
  setUserViews([]);
  setUserFunctions([]);
  setUserSourceModules([]);
}

export function ensureUserRegistriesLoaded(
  accountId: string | undefined = desiredAccountId,
): Promise<void> {
  if (accountId === undefined || accountId !== desiredAccountId) return Promise.resolve();
  if (loadedAccountId === accountId) return Promise.resolve();
  if (loading?.accountId === accountId && loading.epoch === loadEpoch) return loading.promise;
  const epoch = loadEpoch;
  const promise = (async () => {
    try {
      const complete = await runLoad(accountId, epoch);
      if (complete && desiredAccountId === accountId && loadEpoch === epoch) {
        loadedAccountId = accountId;
      }
    }
    catch (err) { console.warn("[user-registries] failed to load:", err); }
    finally {
      clearLoadingGeneration(accountId, epoch);
    }
  })();
  loading = { accountId, epoch, promise };
  return promise;
}

/** Imperative startup check: a settled load can still be incomplete when one
 * API read failed. Do not expose authoring until the whole roster is loaded. */
export function userRegistriesLoadedFor(accountId: string): boolean {
  return desiredAccountId === accountId && loadedAccountId === accountId;
}

/** Force a fresh re-fetch and update the live signals. Called by the
 *  dashboard CRUD pages after save/delete so AdminForm / StepEditor see
 *  the new records without a full page reload. */
export async function reloadUserRegistries(
  accountId: string | undefined = desiredAccountId,
): Promise<void> {
  if (accountId === undefined || accountId !== desiredAccountId) return;
  // A save can trigger a reload while the initial load (or another save's
  // reload) is still in flight. Give every explicit refresh a new generation
  // so only the newest response for the still-current account may publish.
  loadEpoch += 1;
  const epoch = loadEpoch;
  loadedAccountId = undefined;
  loading = undefined;
  const promise = (async () => {
    try {
      const complete = await runLoad(accountId, epoch);
      if (complete && desiredAccountId === accountId && loadEpoch === epoch) {
        loadedAccountId = accountId;
      }
    }
    catch (err) { console.warn("[user-registries] reload failed:", err); }
    finally {
      clearLoadingGeneration(accountId, epoch);
    }
  })();
  loading = { accountId, epoch, promise };
  await promise;
}
