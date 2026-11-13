// ---------------------------------------------------------------------------
// Account-scoped registries — runtime merge of DB-stored user records into
// the engine's in-memory registries.
//
// rights R3a — account-loaded instances carry the OWNERSHIP COORDINATE
// `{kind:"account", accountId}`. They are selected only under a frame whose
// authenticated authority derives the same account, and only that account's
// refresh removes them.
//
// ⚠ WHAT THIS REPLACED, because the shape is worth remembering. Every
// account-loaded instance used to be stamped with the bare string `"account"`
// — ONE shared bucket with no id in it — and `refreshAccountInstances` called
// `removeInstancesByScope("account")`, so refreshing ONE account's instances
// wiped the bucket for EVERY account. The header that used to sit here said
// isolation was "a follow-up"; it was not merely unenforced, it was
// UNREPRESENTABLE, and it read as working only because staging has one account.
// ---------------------------------------------------------------------------

import type {
  Instance,
  FenelFunction,
  TypeView,
  FenelModule,
  SetExpr,
} from "./types";
import type { DispatchRegistry } from "./dispatch-registry";
import {
  registerAccountNamedSet,
  unregisterAccountNamedSet,
  clearAccountNamedSets,
  listAccountNamedSets,
} from "./set-algebra";
import {
  registerAccountDecomposeParser,
  clearAccountDecomposeParsers,
  type DecomposeParser,
} from "./decompose";

/** A user-registered named set. Membership semantics stay as SetExpr data and
 *  are applied through the Fenel `contains` body at lookup time. */
export type AccountNamedSet = { name: string; set: SetExpr };

/** A user-registered decompose parser — same structure as a global one. */
export type AccountDecomposeParserSpec = { name: string; parser: DecomposeParser };

/** A bundle of user-registered records loaded from the typed-registry tables. */
export type AccountRegistryRecords = {
  views: TypeView[];
  functions: FenelFunction[];
  specInstances: Instance[];
  /** Optional per-account named-set definitions (`format:my-id`, etc.). */
  namedSets?: AccountNamedSet[];
  /** Optional per-account `$decompose` parsers. */
  decomposeParsers?: AccountDecomposeParserSpec[];
};

/** rights R3a — stamp an instance with its OWNER. The row's authored scope, if
 *  it had one, is discarded: ownership is derived from who loaded the row, not
 *  from what the row claims. */
function asOwnedBy(inst: Instance, accountId: string): Instance {
  return { ...inst, scope: { kind: "account", accountId } };
}

/**
 * Add a batch of typeclass instances to a registry, OWNED BY `accountId`.
 * Mutates in place.
 */
export function applyAccountSpecInstances(
  registry: DispatchRegistry,
  accountId: string,
  instances: readonly Instance[],
): void {
  assertAccountId(accountId, "applyAccountSpecInstances");
  for (const inst of instances) registry.addInstance(asOwnedBy(inst, accountId));
}

/**
 * Replace ONE account's instances with a fresh set. Used after a dashboard
 * CRUD edit so the new state takes effect without a server restart.
 *
 * ⚠ PER-OWNER, and that is the whole point: the removal names the account, so
 * refreshing A leaves B's rows and every boot row untouched.
 */
export function refreshAccountInstances(
  registry: DispatchRegistry,
  accountId: string,
  instances: readonly Instance[],
): void {
  assertAccountId(accountId, "refreshAccountInstances");
  registry.removeInstancesOwnedBy(accountId);
  applyAccountSpecInstances(registry, accountId, instances);
}

/** An empty account id is not an account (§12 trap 32); refusing loudly here
 *  keeps a caller from silently writing rows nobody can ever select. */
function assertAccountId(accountId: string, site: string): void {
  if (typeof accountId !== "string" || accountId === "") {
    throw new Error(`${site}: a non-empty accountId is required`);
  }
}

/**
 * Build a synthetic FenelModule from a user's loaded functions so the
 * caller can pass it into `createRegistry([...builtInModules, userMod])`
 * (or merge into an existing module registry's evaluate context).
 */
export function userFunctionsAsModule(
  accountId: string,
  functions: readonly FenelFunction[],
): FenelModule {
  const baseName = `account-functions-${encodeURIComponent(JSON.stringify([accountId]))}`;
  let name = baseName;
  while (functions.some((fn) => fn.id.startsWith(`${name}:`))) {
    name += "-container";
  }
  return {
    // A synthetic container name must not pretend to own the exact persisted
    // function ids. Keep it colon-free and collision-free against every exact
    // id so the registry's default `${module.name}:*` inference cannot invent
    // source members when functionNamespace is deliberately absent.
    name,
    label: `User functions (${accountId})`,
    functions: [...functions],
  };
}

// ---------------------------------------------------------------------------
// Per-account named sets + decompose parsers — bulk apply / refresh.
//
// Same pattern as applyAccountSpecInstances: pass the full set, the
// helper wipes the prior account-scoped registrations and applies the new
// ones. `contains(set, value, { accountId })` then sees the live state.
// ---------------------------------------------------------------------------

/** Apply a batch of account-scoped named sets (additive). */
export function applyAccountNamedSets(
  accountId: string,
  sets: readonly AccountNamedSet[],
): void {
  for (const { name, set } of sets) {
    registerAccountNamedSet(accountId, name, set);
  }
}

/** Replace ALL account-scoped named sets for one account with a fresh set. */
export function refreshAccountNamedSets(
  accountId: string,
  sets: readonly AccountNamedSet[],
): void {
  clearAccountNamedSets(accountId);
  applyAccountNamedSets(accountId, sets);
}

/** Apply a batch of account-scoped decompose parsers (additive). */
export function applyAccountDecomposeParsers(
  accountId: string,
  parsers: readonly AccountDecomposeParserSpec[],
): void {
  for (const { name, parser } of parsers) {
    registerAccountDecomposeParser(accountId, name, parser);
  }
}

/** Replace ALL account-scoped decompose parsers for one account. */
export function refreshAccountDecomposeParsers(
  accountId: string,
  parsers: readonly AccountDecomposeParserSpec[],
): void {
  clearAccountDecomposeParsers(accountId);
  applyAccountDecomposeParsers(accountId, parsers);
}

/** Apply an entire AccountRegistryRecords bundle in one call. */
export function applyAccountRegistry(
  accountId: string,
  registry: DispatchRegistry,
  records: AccountRegistryRecords,
): void {
  applyAccountSpecInstances(registry, accountId, records.specInstances);
  if (records.namedSets) applyAccountNamedSets(accountId, records.namedSets);
  if (records.decomposeParsers) applyAccountDecomposeParsers(accountId, records.decomposeParsers);
}

/** Replace EVERY account-scoped registration for an account. Used after a
 *  CRUD edit so the next request sees the canonical state. */
export function refreshAccountRegistry(
  accountId: string,
  registry: DispatchRegistry,
  records: AccountRegistryRecords,
): void {
  refreshAccountInstances(registry, accountId, records.specInstances);
  refreshAccountNamedSets(accountId, records.namedSets ?? []);
  refreshAccountDecomposeParsers(accountId, records.decomposeParsers ?? []);
}

// Re-export the low-level scope helpers so call sites that don't go through
// the bulk API can register/clear directly. listAccountNamedSets is the
// diagnostic surface for "what overrides does account X have right now".
export {
  registerAccountNamedSet,
  unregisterAccountNamedSet,
  clearAccountNamedSets,
  listAccountNamedSets,
  registerAccountDecomposeParser,
  clearAccountDecomposeParsers,
};
