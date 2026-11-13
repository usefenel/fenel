// ---------------------------------------------------------------------------
// State IO handlers — JS impls for the Fenel `state` module's loadType
// and createInstance functions.
//
//   state.load_type(typeId)            -> the type's $record JSON, or null
//   state.create_instance(typeId, val) -> { id } of the newly-persisted row
//
// These are dispatched by the runtime's IO handler registry. The Fenel
// function declarations live in @fenel/engine/modules/state and bind here
// via the IOInvokable typeclass instance (action names match the keys
// registered below).
// ---------------------------------------------------------------------------

import type { ModuleRegistry } from "@fenel/engine/registry";
import type { FenelFunction, FenelType, IOHandlerContext } from "@fenel/engine/types";
import { Just, Nothing, Ref, peelMaybeValue, type Maybe } from "@fenel/engine/type-foundation";
import { invokeCallable, pureEvaluateContext } from "@fenel/engine/expressions";
import type { PersonalIdentityDecision, PersonalAccountPlan } from "@fenel/db";
import { getSystemRegistry } from "@fenel/engine/system-registry";
import { systemEntities } from "@fenel/engine/system-entities";
import { paramRecordOf, fieldType, peelMaybe } from "@fenel/engine";
import { decodeCheckpointRow } from "@fenel/engine/checkpoint-json";
import type {
  AccountFieldDefinitionGraph,
  FieldPersistencePlan,
  FieldPersistenceSnapshot,
} from "@fenel/engine/field-authoring";
// Landing 1 A2+B8 — the storage method set (store / load / update / delete /
// list / appendEvent / loadType / loadTypeByName) is descriptor-only instance
// data. Every exercise crosses `performStorageMethod`; backend host callables
// live solely behind the registry's perform table. Non-storage-method-set reads
// (codeName / system-table / subscriptions / sessions / …) still `await
// import("@fenel/db")` directly — they are sibling-axis reads, not this method
// set. `mintUuid` is the `HasRandom.uuid` id-mint (D3).
import {
  mintUuid,
  performStorageMethod,
  type StoredRow,
} from "./storage-backends";

export type FieldDefinitionStatePlanCurrent = (
  current: AccountFieldDefinitionGraph,
) => FieldPersistencePlan | Promise<FieldPersistencePlan>;

/** The sole host-facing state leaves for the atomic field-definition graph.
 * The higher-order transaction is intentional: Fenel must plan from the graph
 * reloaded under the account lock, so load/plan/write cannot be split across
 * independent calls without reintroducing a stale-plan race. */
export async function loadAccountFieldDefinitionGraphStateLeaf(
  accountId: string,
): Promise<AccountFieldDefinitionGraph> {
  const { loadAccountFieldDefinitionGraph } = await import("@fenel/db");
  return loadAccountFieldDefinitionGraph(accountId);
}

/** Read the account's pinned source documents through the state IO boundary. */
/** rights R4a C1a — THE ACCOUNT-SCOPED BOT READ, at the storage boundary.
 *
 *  The Telegram collector relayed with a bot found GLOBALLY: `telegram.ack_callback_query`
 *  had no ownership check at all, and two of the other three checked only AFTER
 *  the global read had already handed back the token. The repair is to read the
 *  bot the FRAME's account owns.
 *
 *  ⚠ WHY IT LIVES HERE AND NOT IN THE COLLECTOR. `audit-effects.ts`'s
 *  `direct-db-outside-leaf` rule names this file as "the state-IO DB leaf (the
 *  ONLY storage boundary)", and `telegram-collector.ts` was deliberately DRAINED
 *  of direct database access in ts-elimination-completion Phases 2-7. Putting the
 *  read back there would re-grandfather a file that arc emptied; putting it here
 *  is what the rule's own PERMANENT category is for. The collector calls this.
 *
 *  ⚠ AND THE STRONGER FORM IS FILED, NOT BUILT. Brief §4.3 says: "If the census
 *  finds no account-argued bot read, add one and add it to
 *  `accountArguedStateDescriptors`." The census finds none —
 *  `state:findBotIdForAccount` resolves an account's SOLE bot id and cannot look
 *  one up BY id — so a new account-ARGUED descriptor would let the GATE enforce
 *  the partition instead of the leaf choosing it. That is a new Fenel
 *  declaration and therefore a second owner regen, so C1a ships the leaf-level
 *  read the brief's primary instruction names and files the descriptor for a
 *  later slice. The behavioural property is pinned either way (P22 asserts the
 *  read carries the frame's account, with a same-account positive control). */
export async function findAccountBotRowStateLeaf(
  accountId: string,
  botId: string,
): Promise<{ id: string; accountId: string; token: string; enabled: boolean } | null> {
  if (!accountId || !botId) return null;
  const { findBotById } = await import("@fenel/db");
  return (await findBotById(accountId, botId)) as
    | { id: string; accountId: string; token: string; enabled: boolean }
    | null;
}

export async function loadAccountSourceModulesStateLeaf(accountId: string) {
  const { listAccountImports } = await import("@fenel/db");
  return listAccountImports(accountId);
}

export async function loadSourceRegistryVersionGraphStateLeaf(accountId: string, registryId: string) {
  const { loadSourceRegistryVersionGraph } = await import("@fenel/db");
  return loadSourceRegistryVersionGraph(accountId, registryId);
}

// ---------------------------------------------------------------------------
// Source-module registry leaves (ts-elimination Phase 1 gate repair).
//
// `api/src/routes/modules.ts` used to import these six operations straight out
// of `@fenel/db`, which is the violation CLAUDE.md > "Database is not your
// concern" names: an HTTP route is not a storage boundary. They are forwarded
// here — the ONE declared storage boundary — and republished DB-free through
// `../state-source-modules`.
//
// Each leaf is a TOTAL forward: `...args` passes the caller's host callbacks
// (`prepareIdentity` / `validate` / `validateRemaining`) and the optional
// `host` transaction seam through untouched. That is load-bearing, NOT
// ceremony — publish prepares identity under the account lock and
// install/uninstall validate the candidate graph INSIDE their transaction
// (`db/src/queries/registries.ts:185`, `:209`, `:244`). Splitting any of them
// into a preliminary read plus a later write would reintroduce exactly the
// stale-read race the higher-order shape exists to prevent, so do not
// "simplify" these into value-in/value-out calls.
//
// The callbacks stay HOST callables on the host side of the boundary; none of
// them is ever handed to Fenel as a value (descriptor-only discipline).
//
// NOT CLOSED by this move, and filed in TODO.md: these are not yet mediated
// `state:*` effects entered under the request's authority, so the module
// install/publish door still has no role check (rights R9), and the
// publish/install DECISIONS in `registries.ts` are still TS rather than Fenel.
// ---------------------------------------------------------------------------

type SourceRegistryDb = typeof import("@fenel/db");

/** One source-module registry row by id (ownership is checked by the caller). */
export async function getSourceRegistryByIdStateLeaf(
  ...args: Parameters<SourceRegistryDb["getRegistryById"]>
) {
  const { getRegistryById } = await import("@fenel/db");
  return getRegistryById(...args);
}

/** Built-in registries plus the ones this account owns. */
export async function listVisibleSourceRegistriesStateLeaf(
  ...args: Parameters<SourceRegistryDb["listVisibleRegistries"]>
) {
  const { listVisibleRegistries } = await import("@fenel/db");
  return listVisibleRegistries(...args);
}

/** Publish a new immutable version. `prepareIdentity` runs under the account
 *  authoring lock, against the history read inside the same transaction. */
export async function publishSourceRegistryVersionStateLeaf(
  ...args: Parameters<SourceRegistryDb["publishSourceRegistryVersion"]>
) {
  const { publishSourceRegistryVersion } = await import("@fenel/db");
  return publishSourceRegistryVersion(...args);
}

/** Install a pinned version. `validate` sees the complete candidate graph
 *  before any write, inside the transaction. */
export async function installSourceRegistryVersionStateLeaf(
  ...args: Parameters<SourceRegistryDb["installSourceRegistryVersion"]>
): Promise<void> {
  const { installSourceRegistryVersion } = await import("@fenel/db");
  return installSourceRegistryVersion(...args);
}

/** Uninstall a pinned version, validating what REMAINS before the write. */
export async function uninstallSourceRegistryVersionStateLeaf(
  ...args: Parameters<SourceRegistryDb["uninstallSourceRegistryVersion"]>
): Promise<void> {
  const { uninstallSourceRegistryVersion } = await import("@fenel/db");
  return uninstallSourceRegistryVersion(...args);
}

export async function executeFieldDefinitionCommandTransactionStateLeaf(
  accountId: string,
  planCurrent: FieldDefinitionStatePlanCurrent,
): Promise<FieldPersistenceSnapshot> {
  const { executeFieldDefinitionCommandTransaction } = await import("@fenel/db");
  return executeFieldDefinitionCommandTransaction(accountId, planCurrent);
}

async function getRuntimeAccountFieldRegistryLazy(
  accountId: string,
): Promise<ModuleRegistry> {
  const { getRuntimeAccountFieldRegistry } = await import("../account-field-registry");
  return getRuntimeAccountFieldRegistry(accountId);
}

/** Drop the top-level `$tag` field if present — the engine's `construct`
 *  op always tags a constructed value with the constructor name, but for
 *  record-entity instances the `entity_type` column already carries the
 *  identity. Storing both is redundant; the storage boundary is where we
 *  reconcile. Variant values nested INSIDE fields keep their `$tag`
 *  (load-bearing for downstream pattern matching) — only this top frame
 *  is stripped.
 *
 *  representation-substrate Phase 5c (R7): this `stripTopLevelTag` → `store`
 *  value path is the irreducible DB IO leaf (ledger A1) AND the ledgered PERF
 *  BRANCH of the `Reprable Jsonb <type>` instances (ledger B4). The language
 *  *fact* — how a `<type>` value encodes AT REST — lives in the `.fenel`
 *  instances (`fenel/std/dispatch-instances.fenel` `reprable*Jsonb`); these are
 *  their `lift` (pure→native) fast path. Values reach here ALREADY in their
 *  JS-native form (the runtime never threads a pure Peano/cons-spine/Bool-ctor
 *  form to storage — Step-0 (b) confirmed 445 staging rows are uniformly native),
 *  so the `Reprable Jsonb` `lift` is the identity at the value level and
 *  store-as-is reproduces today's bytes EXACTLY (NO data migration). The
 *  `.fenel` instance is the semantic source of truth; this is its law-bound
 *  shortcut. No decision logic — the encoding is the instance. */
function stripTopLevelTag(value: Record<string, unknown>): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (!("$tag" in value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "$tag") continue;
    out[k] = v;
  }
  return out;
}

// storage-as-effect Phase 1 (2026-06-19) — mint an entity id from the Fenel
// `crypto:uuidV4` body (pure: composes crypto:randomTokenHex + the v4 version /
// variant bit-fields), the Fenel-bodied replacement for Postgres
// `gen_random_uuid()` (design/storage-as-effect.md D3). Phase 1b (2026-06-19)
// formalizes this as `HasRandom.uuid`: `mintUuid` resolves the id-mint through
// the effect class (storage-agnostic — a `Memory` backend mints v4 just like
// `Db`), falling back to the direct `crypto:uuidV4` invocation. Byte-identical
// id minting either way; the handler only sources the id, exactly as it
// previously relied on the DB default to supply one.
function mintInstanceId(reg: ModuleRegistry, ctx: IOHandlerContext): string {
  // rights R2a — `crypto:uuidV4` is requires-bearing, so minting an id IS a
  // mediated act and really does reach the gate. It runs under the authority
  // that reached this leaf, never under a frame cached from an earlier caller.
  return mintUuid(reg, ctx.authority);
}

/** Find an entity's *type definition* by name, across all three sources
 *  the catalog merges (`/types` API does the same merge):
 *    - `systemEntities` — compile-time engine entities (Bot, Conversation, …)
 *    - module registry — entities registered by loaded modules
 *    - DB-stored types — user-defined types for this account
 *  Returns the entity's `type` (unwrapped through `$opaque.pure` if it
 *  carries one, so callers see the canonical ADT). */
async function findEntityTypeByName(
  reg: ModuleRegistry,
  ioCtx: IOHandlerContext,
  name: string,
  fieldRegistry?: ModuleRegistry,
): Promise<FenelType | null> {
  const identified = fieldRegistry?.getIdentifiedEntity(name);
  if (identified?.type) return identified.type;
  const local = reg.getEntity?.(name);
  if (local?.type) return local.type;
  const { getEntityTypeByName } = await import("@fenel/engine");
  const catalogType = getEntityTypeByName(name);
  if (catalogType) return catalogType;
  for (const e of systemEntities) {
    if (e.id === name && e.type) return e.type;
  }
  const moduleEntity = getSystemRegistry().getEntity(name);
  if (moduleEntity) return moduleEntity.type;
  const dbRow = await performStorageMethod(
    reg,
    ioCtx,
    "loadTypeByName",
    [ioCtx.accountId, name],
  );
  if (dbRow) return dbRow.type as FenelType;
  return null;
}

/** Only storage-owned provenance authorizes interpreting a value envelope.
 * Legacy data that happens to resemble an envelope remains ordinary data. */
async function decodeStoredInstanceValue(type: FenelType | null, data: unknown, encoding: string | null | undefined, registry: ModuleRegistry): Promise<unknown> {
  if (encoding == null) return data;
  const { isInstanceJsonEncoding, isValueJsonEncoding } = await import("@fenel/engine/authoring/type");
  if (isInstanceJsonEncoding(encoding)) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("Encoded instance must be a record");
    const { instanceFromJsonWire } = await import("@fenel/engine/authoring/type");
    return instanceFromJsonWire(data as Record<string, unknown>, registry, undefined, encoding);
  }
  if (!isValueJsonEncoding(encoding)) throw new Error(`Unsupported stored value encoding: ${encoding}`);
  if (!type) throw new Error("Cannot decode a stored value without its declared type");
  const { valueFromJsonWire } = await import("@fenel/engine/authoring/type");
  return valueFromJsonWire(type, data, registry, encoding);
}

/** Language list DTOs contain native values. Raw storage envelopes (including
 * name/id lookups and explicit envelope:true lists) keep their original flag. */
async function projectStoredInstanceRows(reg: ModuleRegistry, ctx: IOHandlerContext, typeName: string, rows: StoredRow[]): Promise<Record<string, unknown>[]> {
  const declared = await findEntityTypeByName(reg, ctx, typeName);
  return Promise.all(rows.map(async (row) => {
    const data = await decodeStoredInstanceValue(declared, row.data, row.dataEncoding, reg);
    if (declared && !("$record" in declared)) {
      const { dataEncoding: _physicalEncoding, ...envelope } = row;
      return { ...envelope, data };
    }
    return { id: row.id, accountId: row.accountId, ...(data as Record<string, unknown> ?? {}), createdAt: row.createdAt, updatedAt: row.updatedAt };
  }));
}

/** Phase 10a sub-step 4 — construction-time Verified-field check.
 *  Returns null when validation passes (or when `typeName` isn't a spec
 *  record); returns a comma-joined error string describing each
 *  violating field when it fails.
 *
 *  Trigger: `typeName` must be a registered spec codename (the
 *  dispatched-spec set is exported as `dispatchedSpecCodeNames` from
 *  engine/src/system-entities.ts). Non-spec entity types short-circuit
 *  with null so the write path stays unchanged for them.
 *
 *  Imports are lazy so the engine bundle isn't pulled in at module-eval
 *  time (matches the pattern the rest of this file uses). */
async function checkSpecRecordVerified(
  reg: ModuleRegistry,
  ioCtx: IOHandlerContext,
  typeName: string,
  value: Record<string, unknown>,
): Promise<string | null> {
  if (!typeName.endsWith("Spec")) return null;
  const { dispatchedSpecCodeNames, validateSpecRecord } = await import("@fenel/engine");
  if (!dispatchedSpecCodeNames.includes(typeName)) return null;
  const fieldRegistry = await getRuntimeAccountFieldRegistryLazy(ioCtx.accountId);
  const type = await findEntityTypeByName(reg, ioCtx, typeName, fieldRegistry);
  if (!type) return null;
  const errors = validateSpecRecord(type, value);
  if (errors.length === 0) return null;
  return errors.map((e) => `${e.field}: ${e.reason}`).join("; ");
}

/** Throws when `checkSpecRecordVerified` returns a non-null error. Used
 *  by the strict `state.create_instance` handler whose contract is
 *  "throw on type-validation failure" (parallels EntityInstanceValidationError
 *  from the db layer). */
async function assertSpecRecordVerified(
  reg: ModuleRegistry,
  ioCtx: IOHandlerContext,
  typeName: string,
  value: Record<string, unknown>,
): Promise<void> {
  const err = await checkSpecRecordVerified(reg, ioCtx, typeName, value);
  if (err) {
    throw new Error(`Verified-field policy violated: ${err}`);
  }
}

/** Map an entity-type identifier (in any of the shapes the picker /
 *  callers might produce) down to the bare type name that engine /
 *  DB queries expect:
 *
 *    - `system:<name>` / `module:<name>` — synthetic ids the `/types`
 *      API returns for engine-defined entities. Strip the prefix.
 *    - UUID — a real DB-stored type row. Look up by id to read its
 *      `name` column.
 *    - bare name (`"bot"`) — already a name; pass through. This covers
 *      legacy `.fenel` calls like `tryCreateInstanceByName "bot" …`
 *      that pre-date the typed-id refactor.
 *
 *  Returns `null` if the id is UUID-shaped but doesn't match a row. */
async function resolveEntityName(
  reg: ModuleRegistry,
  ioCtx: IOHandlerContext,
  rawId: string,
): Promise<string | null> {
  if (rawId.startsWith("system:") || rawId.startsWith("module:")) {
    return rawId.slice(rawId.indexOf(":") + 1) || null;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
    const row = await performStorageMethod(
      reg,
      ioCtx,
      "loadType",
      [ioCtx.accountId, rawId],
    );
    if (row?.name) return row.name;
    const named = await performStorageMethod(reg, ioCtx, "loadTypeByName", [ioCtx.accountId, rawId]);
    return named?.name ?? null;
  }
  return rawId;
}

/** action-subsumption Phase 1 / Decision D2 — the validation core, shared by
 *  the entity-name path (`state.validate_entity_instance`) and the function-args
 *  path (`state.validate_function_args`). Both feed the SAME `validate(Type,
 *  Value)`; only the *resolver* that produced the `type` differs (D2: the
 *  name-lookup is pulled OUT of the primitive). `partial=true` narrows a
 *  `$record` type to only the fields present in `raw` (PATCH semantics).
 *  Returns `{ok:true, data}` (coerced) or `{ok:false, errors:[{path,message}]}`. */
type RecordValidation =
  | { ok: true; data: unknown }
  | { ok: false; errors: { path: string; message: string }[] };

async function runRecordValidation(
  type: FenelType,
  raw: unknown,
  partial: boolean,
  fieldRegistry: ModuleRegistry,
  /** ⚠ rights R3a — the REQUEST account, from `ctx.accountId` at both callers.
   *  Required, no default: an absent account here does not fail closed, it
   *  silently substitutes global named sets for the account's own. */
  requestAccount: string | null,
): Promise<RecordValidation> {
  let t = type;
  if (partial && typeof t === "object" && t !== null && "$record" in t && raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const present = new Set(Object.keys(raw));
    const recordType = t as { $record: { fields: { name: string }[] } };
    t = {
      $record: {
        fields: recordType.$record.fields.filter((f) => present.has(f.name)),
      },
    } as FenelType;
  }
  const { validateValue } = await import("@fenel/engine/validation");
  const { canonical } = await import("@fenel/engine/locale");
  const result = validateValue(t, raw, requestAccount, { coerce: true, registry: fieldRegistry });
  if (!result.valid) {
    return {
      ok: false,
      errors: result.errors.map((e) => ({ path: e.path, message: canonical(e.message) })),
    };
  }
  return { ok: true, data: result.value };
}

/** Context-injected params excluded from a function's validated arg-record
 *  (D4): supplied by the dispatcher from `ActionContext`, never by the caller.
 *  - `adapter` — the entry-channel origin tag (D4; the Channel-as-capability
 *    arc removes the param and this exclusion together).
 *  - `accountId` — the resource partition. It is ambient in the runtime
 *    `EvaluateContext` (`ctx.accountId`); a handful of action bodies still take
 *    it as an explicit param (e.g. `inventory:getInventoryStatusAction`), so the
 *    dispatcher injects it the same way it injects `adapter`. The future
 *    scope/Channel arc lifts both to `requires:`-resolved scope reads. */
const CONTEXT_INJECTED_PARAMS: ReadonlySet<string> = new Set([
  "adapter",
  "accountId",
]);

export type StateHandlerFieldRegistryDependencies = {
  readonly getAccountFieldRegistry: (accountId: string) => Promise<ModuleRegistry>;
};

/** rights R2b P0.5 — THE IDENTITY LEAVES THIS MODULE FENCES, as the pair of
 *  names the perform table carries for each. A bodied or bodyless `@ioAction`
 *  leaf is reachable under BOTH its dotted action name and its colon function
 *  id, so a fence declared under one spelling and a policy list written in the
 *  other agree only by coincidence — which is exactly how R2a's most serious
 *  defect shipped. Declaring the pair makes the two spellings one fact. */
const GUARDED_IDENTITY_LEAVES: readonly { readonly action: string; readonly id: string }[] = [
  { action: "state.create_session", id: "state:createSession" },
  { action: "state.get_session_by_hash", id: "state:getSessionByHash" },
  { action: "state.touch_session", id: "state:touchSession" },
  { action: "state.delete_session_by_hash", id: "state:deleteSessionByHash" },
  { action: "state.list_user_memberships", id: "state:listUserMemberships" },
  { action: "state.get_user_by_email", id: "state:getUserByEmail" },
  { action: "state.get_or_create_user_by_email", id: "state:getOrCreateUserByEmail" },
  { action: "state.set_user_password_hash", id: "state:setUserPasswordHash" },
  { action: "state:ensurePersonalAccount", id: "state:ensurePersonalAccount" },
];

/** rights R2b ruling 5 — THE REALM BIT SPLITS, and `state.create_membership` is
 *  the leaf that leaves.
 *
 *  Seven of R1's eight fenced leaves mint sessions, read users by email, or
 *  write password hashes: there is no product reason for any frame but the
 *  login chain to reach them, so they keep the bit as defence in depth exactly
 *  as R2a ruled. The eighth is what an account OWNER legitimately performs when
 *  inviting a member — and the bit would refuse the owner. The GATE is the
 *  boundary now (that was the whole of R2a), so for the membership family the
 *  owner row's argued axes replace it. The identity realm still ENUMERATES
 *  `state:createMembership`, so the bootstrap and dev-login chains are
 *  unchanged. */
const IDENTITY_LEAF_LIST_ID = "authority:sessionLeafDescriptors";

/** rights R2b P0.5 — the fence and the Fenel policy list must name the SAME
 *  set, and the check runs at REGISTRATION, in BOTH directions, naming both
 *  differences.
 *
 *  Exported so a pin can feed it a pair that differs by one name in each
 *  direction; the production pair is read from the real registry at
 *  `registerStateHandlers` time, so this throwing is a boot failure rather than
 *  a request failure. */
export function assertFencedLeavesMatch(
  guarded: readonly string[],
  fenced: readonly string[],
  listId: string = IDENTITY_LEAF_LIST_ID,
): void {
  const guardedSet = new Set(guarded);
  const fencedSet = new Set(fenced);
  const notInList = [...guardedSet].filter((name) => !fencedSet.has(name)).sort();
  const notFenced = [...fencedSet].filter((name) => !guardedSet.has(name)).sort();
  if (notInList.length === 0 && notFenced.length === 0) return;
  throw new Error(
    `state handlers: the privileged-realm fence and ${listId} must name the same set`
    + (notInList.length === 0 ? "" : ` — fenced here but absent from the list: ${notInList.join(", ")}`)
    + (notFenced.length === 0 ? "" : ` — in the list but not fenced here: ${notFenced.join(", ")}`),
  );
}

/** rights R4a — read one declared `Maybe` PARAMETER of a native.
 *
 *  `Just x` is present, `Nothing` and an absent key are absent, and anything
 *  else throws. The throw is the point: a caller that marshalled a raw value
 *  where the signature declares `Maybe` would otherwise have its update read as
 *  "leave the column alone", which turns a marshalling bug into a silently
 *  dropped write — the same silent-null family `reference_fenel_body_silent_null_traps`
 *  records. */
function maybeArgument(
  supplied: unknown,
  where: string,
): { present: false } | { present: true; value: unknown } {
  if (supplied === undefined) return { present: false };
  const tag = (supplied as { $tag?: unknown } | null)?.$tag;
  if (tag === "Nothing") return { present: false };
  if (tag === "Just") return { present: true, value: (supplied as { _0?: unknown })._0 };
  throw new Error(
    `${where}: expected Just/Nothing, received ${JSON.stringify(supplied)?.slice(0, 120) ?? String(supplied)}`,
  );
}

/** Pure policy re-entry uses only the base repository registry. A caller's
 * account definitions, dispatch dictionaries and authority are not inherited. */
async function personalIdentityRule<T>(id: string, args: readonly unknown[]): Promise<T> {
  const { loadRegistry } = await import("../evaluator");
  const { mintAnonymousAuthority } = await import("../authority-mint");
  const registry = loadRegistry();
  const base = registry.evaluateContext();
  return invokeCallable(Ref(id), [...args], {
    ...pureEvaluateContext(base),
    // The generic pure narrowing omits constructor slots. These immutable
    // repository facts are needed to keep Result/Maybe payloads positional.
    _constructors: base._constructors,
    _constructorWireNames: base._constructorWireNames,
    _ctorFieldKeys: base._ctorFieldKeys,
    _strictPatternFields: base._strictPatternFields,
    getFunctionImportFrame: base.getFunctionImportFrame,
    _authority: mintAnonymousAuthority(registry),
  }) as T;
}

export function registerStateHandlers(
  reg: ModuleRegistry,
  dependencies: Partial<StateHandlerFieldRegistryDependencies> = {},
): void {
  const accountFieldRegistryFor = dependencies.getAccountFieldRegistry
    ?? getRuntimeAccountFieldRegistryLazy;
  reg.registerIOHandler("state.load_type", async (params, ctx) => {
    const typeId = params["typeId"] as string | undefined;
    if (!typeId) {
      throw new Error("state.load_type: typeId required");
    }
    const row = await performStorageMethod(
      reg,
      ctx,
      "loadType",
      [ctx.accountId, typeId],
    );
    return {
      action: "continue",
      value: (row?.type ?? null),
    };
  });

  // schemaOf — the bridge between *types as values* and `$el`
  // dependent typing. Accepts any id form (bare name, `system:<n>`,
  // `module:<n>`, UUID), resolves to the entity's *pure* type, and
  // returns that as a Fenel Type value. The runtime validator and
  // the editor's `resolveElInType` both consume this to type a
  // sibling param against another's runtime value.
  reg.registerIOHandler("state.schema_of", async (params, ctx) => {
    const rawId = params["typeId"] as string | undefined;
    if (!rawId) {
      throw new Error("state.schema_of: typeId required");
    }
    const name = await resolveEntityName(reg, ctx, rawId);
    if (!name) {
      return { action: "continue", value: null };
    }
    const t = await findEntityTypeByName(reg, ctx, name);
    return { action: "continue", value: (t ?? null) };
  });

  // Sibling of schema_of for typeclasses. The editor's `$el` resolver
  // calls this with the picked typeName (e.g. "Iconable") and uses
  // the returned `$record` to type the `methods` field. Without this,
  // `registerRepresentation(target, "Iconable", { icon = "bot" })`
  // would render with no field schema → every key shown in red.
  reg.registerIOHandler("state.typeclass_methods_schema", async (params) => {
    const typeName = params["typeName"] as string | undefined;
    if (!typeName) return { action: "continue", value: null };
    const { dispatchRegistry } = await import("@fenel/engine");
    const tc = dispatchRegistry.getClass(typeName);
    if (!tc) return { action: "continue", value: null };
    const fields = tc.methods.map((m) => ({
      name: m.name,
      label: m.label,
      type: m.returns,
    }));
    return {
      action: "continue",
      value: ({ $record: { fields } }),
    };
  });

  // storage-as-effect Phase 1 (2026-06-19) — the entity id is now minted by the
  // Fenel `crypto:uuidV4` body (mintInstanceId → invokeCallable, pure) and passed
  // explicitly to createEntityInstance, instead of relying on Postgres
  // `gen_random_uuid()`. The leaf stays bodyless + this handler unchanged bar the
  // mint. The mint-then-store orchestration stays HANDLER-side (rather than
  // converting createInstance into a Fenel body) for PERF + risk, not a language
  // limit: a Fenel body CAN end in an IO call and returns its value fine (pinned by
  // runtime/evaluator.test.ts "bare IO-tail"). Routing this hot create leaf through
  // a body would spawn a durable function_instance per create + touch the
  // order-sensitive HasStateIO dispatch; handler-side keeps it byte-identical.
  // Everything else (type resolution, $tag strip, Verified check) is UNCHANGED.
  reg.registerIOHandler("state.create_instance", async (params, ctx) => {
    const typeId = params["typeId"] as string | undefined;
    const value = params["value"] as Record<string, unknown> | undefined;
    if (!typeId) {
      throw new Error("state.create_instance: typeId required");
    }
    if (!value || typeof value !== "object") {
      throw new Error("state.create_instance: value (record) required");
    }
    const typeRow = await performStorageMethod(
      reg,
      ctx,
      "loadType",
      [ctx.accountId, typeId],
    );
    if (!typeRow) {
      throw new Error(`state.create_instance: type ${typeId} not found`);
    }
    // Typed-constructor values arrive as `{$tag: "Bot", platform: …}`
    // because the `construct` op always tags. For record-entity rows
    // the `$tag` is redundant with the `entity_type` column, so strip
    // it at the storage boundary — keeps the DB free of routing
    // metadata. Variant values inside fields keep their `$tag` (it's
    // load-bearing for downstream pattern matching); only the TOP-LEVEL
    // tag is dropped.
    const declared = typeRow.type as FenelType;
    const stripped = declared && "$record" in declared ? stripTopLevelTag(value) : value;
    // Phase 10a sub-step 4 — construction-time `Verified`-field
    // validation. Only fires for spec-record entity types (the
    // `dispatchedSpecCodeNames` set exported from system-entities.ts).
    // The validator walks the type, locates `Verified T`-shaped fields,
    // and dispatches `validateVerified` per field; any non-empty error
    // list throws (the strict `create_instance` path mirrors the
    // existing "throw on type-validation failure" contract).
    await assertSpecRecordVerified(reg, ctx, typeRow.name, stripped);
    const created = await performStorageMethod(
      reg,
      ctx,
      "store",
      [ctx.accountId, typeRow.name, stripped, mintInstanceId(reg, ctx)],
    );
    return {
      action: "continue",
      value: created.id,
    };
  });

  reg.registerIOHandler("state.update_instance", async (params, ctx) => {
    const instanceId = params["instanceId"] as string | undefined;
    const patch = params["value"];
    if (!instanceId) {
      throw new Error("state.update_instance: instanceId required");
    }
    if (patch === undefined) throw new Error("state.update_instance: value required");
    // Patch semantics: merge `patch` into the existing instance data.
    // Fields absent from `patch` are left untouched; fields present
    // are set; fields whose value is the Fenel `Nothing` constructor
    // (`{$tag: "Nothing"}`) are removed from the data. This is the
    // honest Fenel mapping: `Maybe<T>` already means "present or
    // absent", so the runtime handler interprets `Nothing` as
    // "this field should be absent".
    const existing = await performStorageMethod(
      reg,
      ctx,
      "load",
      [ctx.accountId, instanceId],
    );
    if (!existing) {
      throw new Error(`state.update_instance: instance ${instanceId} not found`);
    }
    const declared = await findEntityTypeByName(reg, ctx, existing.entityType);
    if (declared && !("$record" in declared)) {
      const updated = await performStorageMethod(reg, ctx, "update", [ctx.accountId, instanceId, patch as Record<string, unknown>]);
      if (!updated) throw new Error(`state.update_instance: instance ${instanceId} not found`);
      return { action: "continue", value: null };
    }
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) throw new Error("state.update_instance: record patch required for a record type");
    const currentData = (await decodeStoredInstanceValue(declared, existing.data, existing.dataEncoding, reg) ?? {}) as Record<string, unknown>;
    const nextData: Record<string, unknown> = { ...currentData };
    // Same `$tag` stripping as create_instance: if the caller passes a
    // typed-constructor patch like `Bot { … }` (yielding `{$tag: "Bot",
    // …fields}`), the top-level tag is redundant with the existing
    // row's `entity_type` column and shouldn't pollute the merge.
    const cleanedPatch = stripTopLevelTag(patch as Record<string, unknown>);
    for (const [k, v] of Object.entries(cleanedPatch)) {
      const isNothing =
        v != null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        (v as { $tag?: unknown }).$tag === "Nothing";
      if (isNothing) {
        delete nextData[k];
      } else {
        nextData[k] = v;
      }
    }
    const updated = await performStorageMethod(
      reg,
      ctx,
      "update",
      [ctx.accountId, instanceId, nextData],
    );
    if (!updated) {
      throw new Error(`state.update_instance: instance ${instanceId} not found`);
    }
    return { action: "continue", value: null };
  });

  // Phase 12b — pure validation primitive. Validates a raw record
  // against a registered entity's FenelType without persisting. Returns
  // `{ok: true, value}` with the coerced data on success; `{ok: false,
  // errors: [{path, message}]}` on failure. `partial=true` narrows the
  // entity's `$record` to only the fields present in `raw` (for PATCH
  // semantics — missing fields are not "required" errors).
  //
  // This is the substrate primitive that retires the dashboard.ts Zod
  // prelude. Routes call this before invoking their create/update body
  // — validation is decoupled from persistence.
  reg.registerIOHandler("state.validate_entity_instance", async (params, ctx) => {
    const typeName = params["typeName"] as string | undefined;
    const raw = params["raw"];
    const partial = params["partial"] === true;
    if (!typeName) {
      return {
        action: "continue",
        value: { ok: false, errors: [{ path: "", message: "typeName required" }] },
      };
    }
    if (raw === undefined) {
      return {
        action: "continue",
        value: { ok: false, errors: [{ path: "", message: "raw value required" }] },
      };
    }
    const fieldRegistry = await accountFieldRegistryFor(ctx.accountId);
    const type = await findEntityTypeByName(reg, ctx, typeName, fieldRegistry);
    if (!type) {
      return {
        action: "continue",
        value: {
          ok: false,
          errors: [{ path: "", message: `Unknown entity type: ${typeName}` }],
        },
      };
    }
    // Partial mode narrows the $record to fields present in `raw` (PATCH
    // semantics) — handled inside runRecordValidation, shared with the
    // function-args path below.
    const r = await runRecordValidation(type, raw, partial, fieldRegistry, ctx.accountId);
    if (!r.ok) {
      return { action: "continue", value: { ok: false, errors: r.errors } };
    }
    return { action: "continue", value: { ok: true, value: r.data } };
  });

  // action-subsumption Phase 1 (Decision D2) — the function-args validation
  // surface. The resolver here is the arrow-domain projection
  // `paramRecordOf(fn)`: a public action IS a typed Fenel function, so
  // validating its incoming params is the SAME `validate(Type, Value)` over the
  // function's own param-record — no `<action>_params` mirror entity, no
  // `validateAgainstFunction` primitive. `fnRef` is a function id
  // (`items:createItem`); `adapter` (and any other context-injected param) is
  // excluded from the validated record.
  //
  // On success the returned `value` is body-READY: optional (`Maybe<T>`) params
  // are coerced to the canonical tagged form (`{$tag:"Just",_0:x}` present /
  // `{$tag:"Nothing"}` absent) so the function body's `case x of Nothing | Just`
  // matches directly — the per-action `toMaybe` marshalling the old TS handlers
  // carried, lifted into the one coercion boundary (D1).
  reg.registerIOHandler("state.validate_function_args", async (params, ctx) => {
    const fnRef = params["fnRef"] as string | undefined;
    const raw = params["raw"] as Record<string, unknown> | undefined;
    const partial = params["partial"] === true;
    if (!fnRef) {
      return {
        action: "continue",
        value: { ok: false, errors: [{ path: "", message: "fnRef required" }] },
      };
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        action: "continue",
        value: { ok: false, errors: [{ path: "", message: "raw record required" }] },
      };
    }
    const fieldRegistry = await accountFieldRegistryFor(ctx.accountId);
    const fn = fieldRegistry.getIdentifiedFunction(fnRef)
      ?? reg.getIdentifiedFunction(fnRef);
    if (!fn) {
      return {
        action: "continue",
        value: { ok: false, errors: [{ path: "", message: `Unknown function: ${fnRef}` }] },
      };
    }
    const type = paramRecordOf(fn, CONTEXT_INJECTED_PARAMS);
    const r = await runRecordValidation(type, raw, partial, fieldRegistry, ctx.accountId);
    if (!r.ok) {
      return { action: "continue", value: { ok: false, errors: r.errors } };
    }
    // Marshal the validated record into the body's expected arg shape: wrap
    // `Maybe<T>` params into canonical tagged form (present → Just, absent →
    // Nothing), pass required params through unchanged.
    const out: Record<string, unknown> = {};
    const validatedArgs = r.data as Record<string, unknown>;
    for (const p of fn.params) {
      if (CONTEXT_INJECTED_PARAMS.has(p.name)) continue;
      if (peelMaybe(fieldType(p))) {
        if (p.name in validatedArgs) {
          const v = validatedArgs[p.name];
          const tag =
            v && typeof v === "object" ? (v as { $tag?: unknown }).$tag : undefined;
          out[p.name] =
            tag === "Just" || tag === "Nothing" ? v : { $tag: "Just", _0: v };
        } else {
          out[p.name] = { $tag: "Nothing" };
        }
      } else {
        out[p.name] = validatedArgs[p.name];
      }
    }
    return { action: "continue", value: { ok: true, value: out } };
  });

  // Phase 12a sub-step 1 — DELETE primitive. Mirrors the {ok, error?}
  // Result shape of try_create_instance. DELETE is idempotent on the
  // wire (a missing row still reports ok: true) so callers don't have
  // to disambiguate "row didn't exist" from "row was deleted".
  reg.registerIOHandler("state.delete_instance", async (params, ctx) => {
    const instanceId = params["instanceId"] as string | undefined;
    if (!instanceId) {
      return { action: "continue", value: { ok: false, error: "instanceId required" } };
    }
    try {
      await performStorageMethod(
        reg,
        ctx,
        "delete",
        [ctx.accountId, instanceId],
      );
      return { action: "continue", value: { ok: true } };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { action: "continue", value: { ok: false, error: msg } };
    }
  });

  reg.registerIOHandler("state.append_event", async (params, ctx) => {
    const type = params["type"] as string | undefined;
    const payload = params["payload"] as Record<string, unknown> | undefined;
    if (!type) {
      throw new Error("state.append_event: type required");
    }
    const unwrapMaybeString = (v: unknown): string | undefined => {
      if (v == null) return undefined;
      if (typeof v === "string") return v;
      if (typeof v === "object") {
        const tag = (v as { $tag?: unknown }).$tag;
        if (tag === "Just") {
          const inner = (v as { _0?: unknown })._0;
          return typeof inner === "string" ? inner : undefined;
        }
        if (tag === "Nothing") return undefined;
      }
      return undefined;
    };
    await performStorageMethod(
      reg,
      ctx,
      "appendEvent",
      [{
        accountId: ctx.accountId,
        type,
        payload: payload ?? {},
        aggregateType: unwrapMaybeString(params["aggregateType"]),
        aggregateId: unwrapMaybeString(params["aggregateId"]),
        profileId: unwrapMaybeString(params["profileId"]),
      }],
    );
    return { action: "continue", value: null };
  });

  // Virtual dispatch — when the type name matches a system table the
  // instance lives in that table, not in entity_instances. Bots have
  // since migrated to entity_instances (entity_type = "Bot"); reads
  // route through findBotById, which flattens the JSONB back into the
  // historic bot row shape so callers see the same fields as before.
  // Conversation moved to entity_instances ("Conversation") in the
  // same spirit — the dispatch entry was removed; the type lives in
  // system-entities.ts and the routing bodies use generic state.*
  // primitives.
  async function readSystemInstance(
    accountId: string,
    typeName: string,
    instanceId: string,
  ): Promise<Record<string, unknown> | null> {
    if (typeName === "bot") {
      const { findBotById } = await import("@fenel/db");
      const row = await findBotById(accountId, instanceId);
      return row ? (row as unknown as Record<string, unknown>) : null;
    }
    if (typeName === "profile") {
      const { findProfileById } = await import("@fenel/db");
      const row = await findProfileById(accountId, instanceId);
      return row ?? null;
    }
    return null;
  }

  async function listSystemInstances(
    accountId: string,
    typeName: string,
  ): Promise<Record<string, unknown>[]> {
    if (typeName === "bot") {
      const { listBotsByAccount } = await import("@fenel/db");
      const rows = await listBotsByAccount(accountId);
      return rows.map((r) => r as unknown as Record<string, unknown>);
    }
    return [];
  }

  reg.registerIOHandler("state.get_instance", async (params, ctx) => {
    const typeId = params["typeId"] as string | undefined;
    const instanceId = params["instanceId"] as string | undefined;
    if (!typeId || !instanceId) {
      throw new Error("state.get_instance: typeId and instanceId required");
    }
    // Returns Maybe<Record>. Use resolveEntityName so system entities
    // (Bot / Conversation / …) resolve by codeName when the types row
    // doesn't exist for them.
    const typeName = await resolveEntityName(reg, ctx, typeId);
    if (!typeName) {
      return { action: "continue", value: { $tag: "Nothing" } };
    }
    const sysRow = await readSystemInstance(ctx.accountId, typeName, instanceId);
    if (sysRow) {
      return {
        action: "continue",
        value: { $tag: "Just", _0: sysRow },
      };
    }
    const inst = await performStorageMethod(
      reg,
      ctx,
      "load",
      [ctx.accountId, instanceId],
    );
    if (!inst) {
      return { action: "continue", value: { $tag: "Nothing" } };
    }
    // Merge the row's id into the body-facing value so callers can refer
    // to `conv.id` without two-stage lookups. Storage is unchanged —
    // entity_instances.data never holds `id`; it's the row's column.
    const declared = await findEntityTypeByName(reg, ctx, typeName);
    const decoded = await decodeStoredInstanceValue(declared, inst.data, inst.dataEncoding, reg);
    const value = declared && !("$record" in declared) ? decoded : ({ id: inst.id, ...(decoded as Record<string, unknown> ?? {}) });
    return { action: "continue", value: { $tag: "Just", _0: value } };
  });

  // ts-elimination-completion Phase 4.2 — get a full entity_instances envelope
  // row by id alone, account-scoped via ctx. Unlike get_instance, returns the
  // RAW row (id/accountId/entityType/data/createdAt/updatedAt) — the dashboard
  // POST/PUT/PATCH wrappers flatten it + read entityType for ownership guards.
  reg.registerIOHandler("state.get_instance_by_id", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: { $tag: "Nothing" } };
    const row = await performStorageMethod(
      reg,
      ctx,
      "load",
      [ctx.accountId, id],
    );
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: (row) } };
  });

  // typed-function-references Phase 9b — the scoped `name → value` inverse (the
  // Codeable adjoint, on instances). Two surfaces share one resolver:
  //
  //   state.resolve_instance_by_name → LookupResult (Unique / Conflict / None)
  //   state.get_instance_by_name     → Maybe (the thin Unique→Just, _→Nothing
  //                                     adapter for the existing inert caller)
  //
  // SOURCE: both resolve through `findEntityInstancesByCodeName`, which inverts
  // the 9a-2.1 producer — it matches the persisted `Codeable` typeclass instances
  // (args=[rowId], methods.codeName) rather than the retired `data->>'codeName'`
  // JSONB read. Item instances carry codeName ONLY as a Codeable projection, so
  // the old read missed them; this resolves them. Account-scoped, optionally
  // narrowed by entityType. Returns ALL matches (no silent oldest-match pick —
  // the 8c stopgap is retired); the arm count decides Unique/Conflict/None.
  //
  // SCOPE: account-global is the live path (measured: 0 instance-Codeables carry
  // `data.scope` today). The block/tag closest-wins seam rides the persisted
  // `data.scope` field when 9c / multiplayer light it up — forward-compatible.
  const collapseEntityType = (rawType: unknown): string | undefined => {
    if (typeof rawType === "string") return rawType;
    if (rawType && typeof rawType === "object") {
      const tag = (rawType as { $tag?: unknown }).$tag;
      if (tag === "Just") {
        const v = (rawType as { _0?: unknown })._0;
        if (typeof v === "string") return v;
      }
    }
    return undefined;
  };

  reg.registerIOHandler("state.resolve_instance_by_name", async (params, ctx) => {
    const codeName = params["codeName"] as string | undefined;
    if (!codeName) return { action: "continue", value: { $tag: "None" } };
    const entityType = collapseEntityType(params["entityType"]);
    const { findEntityInstancesByCodeName } = await import("@fenel/db");
    const rows = await findEntityInstancesByCodeName(ctx.accountId, codeName, entityType);
    if (rows.length === 0) return { action: "continue", value: { $tag: "None" } };
    if (rows.length === 1) {
      return { action: "continue", value: { $tag: "Unique", value: (rows[0]) } };
    }
    // ≥2 same-(account, entityType) matches — a genuine Conflict. Surface every
    // candidate; never arbitrarily pick. (Forward-only: 0 collisions in live data.)
    return {
      action: "continue",
      value: { $tag: "Conflict", items: rows.map((r) => (r)) },
    };
  });

  // The Maybe adapter over the LookupResult resolver — Unique→Just, Conflict/None
  // →Nothing (an ambiguous resolution is NOT a value; the caller that needs
  // disambiguation uses resolve_instance_by_name). Kept Maybe-returning so the
  // inert `Identifiable CodeableName` instance (resolve = getInstanceByName) stays
  // shape-symmetric with its UUID sibling getInstanceById; the deref flip (9c) is
  // out of scope here.
  reg.registerIOHandler("state.get_instance_by_name", async (params, ctx) => {
    const codeName = params["codeName"] as string | undefined;
    if (!codeName) return { action: "continue", value: { $tag: "Nothing" } };
    const entityType = collapseEntityType(params["entityType"]);
    const { findEntityInstancesByCodeName } = await import("@fenel/db");
    const rows = await findEntityInstancesByCodeName(ctx.accountId, codeName, entityType);
    if (rows.length !== 1) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: (rows[0]) } };
  });

  reg.registerIOHandler("state.list_instances", async (params, ctx) => {
    const typeId = params["typeId"] as string | undefined;
    if (!typeId) throw new Error("state.list_instances: typeId required");
    // Optional `where` containment filter. Accepts either a raw object
    // (Nothing not yet wrapped) or a Maybe (`{$tag:"Just", _0}` /
    // `{$tag:"Nothing"}`); collapses both to a plain Record or undefined.
    const rawWhere = params["where"];
    let where: Record<string, unknown> | undefined;
    if (rawWhere && typeof rawWhere === "object") {
      const tag = (rawWhere as { $tag?: unknown }).$tag;
      if (tag === "Just") {
        const v = (rawWhere as { _0?: unknown })._0;
        if (v && typeof v === "object") where = v as Record<string, unknown>;
      } else if (tag === "Nothing") {
        where = undefined;
      } else {
        where = rawWhere as Record<string, unknown>;
      }
    }
    const typeName = await resolveEntityName(reg, ctx, typeId);
    if (!typeName) return { action: "continue", value: [] };
    // `listSystemInstances` is the legacy dispatch for "bot" / "profile" /
    // etc. — kept as-is for those types until the rest of the half-done
    // migration lands. Filters don't apply here (only fires when the
    // type is one of the half-migrated system tables).
    if (!where) {
      const sysRows = await listSystemInstances(ctx.accountId, typeName);
      if (sysRows.length > 0) return { action: "continue", value: sysRows };
    }
    // Storage list resolution remains per-type: reference types route to the
    // read-only Bundle instance, while dynamic types use the active backend.
    // The type name is resolution metadata; argued-act args stay unchanged.
    const rows = await performStorageMethod(
      reg,
      ctx,
      "list",
      [ctx.accountId, typeName, 1000, where],
      { typeName },
    );
    // Phase 12a sub-step 3 — envelope evolution. Previously returned
    // `{id, ...data}` only; the dashboard /profiles/:id route needs
    // id/accountId/createdAt/updatedAt so relation rows render the legacy
    // wire shape without an extra TS-side flatten. Additive — existing
    // consumers (conversation.fenel's findActiveConversation /
    // findConfirmingConversation read only data-side fields like botId /
    // chatId / status) are unaffected by the extra envelope fields.
    // Sister-evolution to state.list_instances_by_name (12a-2).
    return {
      action: "continue",
      value: await projectStoredInstanceRows(reg, ctx, typeName, rows),
    };
  });

  // storage-as-effect Phase 1 (2026-06-19) — id Fenel-minted via crypto:uuidV4
  // (mintInstanceId), passed to createEntityInstance below. Handler unchanged.
  reg.registerIOHandler("state.try_create_instance_by_name", async (params, ctx) => {
    // Accept either the new `typeId` param (typed `Id<entity_definition>`,
    // picker-driven) or the legacy `typeName` (bare slug, used by older
    // `.fenel` callers). One of them must be present.
    const rawId =
      (params["typeId"] as string | undefined) ??
      (params["typeName"] as string | undefined);
    const value = params["value"];
    if (!rawId) {
      return { action: "continue", value: { ok: false, error: "typeId required" } };
    }
    if (value === undefined) {
      return { action: "continue", value: { ok: false, error: "value required" } };
    }
    try {
      const typeName = await resolveEntityName(reg, ctx, rawId);
      if (!typeName) {
        return { action: "continue", value: { ok: false, error: `unknown type id: ${rawId}` } };
      }
      // See state.create_instance — strip top-level `$tag` so typed
      // constructors (`Bot { … }` → `{$tag: "Bot", …}`) round-trip to
      // the DB without the redundant routing metadata.
      const declared = await findEntityTypeByName(reg, ctx, typeName);
      const stripped = declared && "$record" in declared && value !== null && typeof value === "object" && !Array.isArray(value)
        ? stripTopLevelTag(value as Record<string, unknown>) : value;
      // Phase 10a sub-step 4 — construction-time Verified-field check.
      // Returns an Err Result on policy violation (mirrors the existing
      // "ok / error" Result contract on this handler).
      const specErr = await checkSpecRecordVerified(reg, ctx, typeName, stripped as Record<string, unknown>);
      if (specErr) {
        return { action: "continue", value: { ok: false, error: specErr } };
      }
      const created = await performStorageMethod(
        reg,
        ctx,
        "store",
        [ctx.accountId, typeName, stripped as Record<string, unknown>, mintInstanceId(reg, ctx)],
      );
      return { action: "continue", value: { ok: true, value: created.id } };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { action: "continue", value: { ok: false, error: msg } };
    }
  });

  // Typed-constructor variant of try_create_instance_by_name. The
  // value's `$tag` carries the type identity, so no separate typeId
  // arg is needed. Same Result-shape return.
  // storage-as-effect Phase 1 (2026-06-19) — id Fenel-minted via crypto:uuidV4
  // (mintInstanceId), passed to createEntityInstance below. Handler unchanged.
  reg.registerIOHandler("state.try_create_instance", async (params, ctx) => {
    const value = params["value"] as Record<string, unknown> | undefined;
    if (!value || typeof value !== "object") {
      return { action: "continue", value: { ok: false, error: "value (typed record) required" } };
    }
    const tag = (value as { $tag?: unknown }).$tag;
    if (typeof tag !== "string" || !tag) {
      return {
        action: "continue",
        value: { ok: false, error: "value must be a typed constructor (missing $tag); use tryCreateInstanceByName if you only have a type name" },
      };
    }
    try {
      const typeName = await resolveEntityName(reg, ctx, tag);
      if (!typeName) {
        return { action: "continue", value: { ok: false, error: `unknown type: ${tag}` } };
      }
      const declared = await findEntityTypeByName(reg, ctx, typeName);
      const stripped = declared && "$record" in declared ? stripTopLevelTag(value) : value;
      // Phase 10a sub-step 4 — construction-time Verified-field check.
      const specErr = await checkSpecRecordVerified(reg, ctx, typeName, stripped);
      if (specErr) {
        return { action: "continue", value: { ok: false, error: specErr } };
      }
      const created = await performStorageMethod(
        reg,
        ctx,
        "store",
        [ctx.accountId, typeName, stripped, mintInstanceId(reg, ctx)],
      );
      return { action: "continue", value: { ok: true, value: created.id } };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { action: "continue", value: { ok: false, error: msg } };
    }
  });

  // The seven `state.*_conversation*` IO handlers that used to live
  // here — find_active_conversation / find_confirming_conversation /
  // insert_conversation / update_conversation_progress /
  // mark_conversation_completed / mark_conversation_cancelled /
  // mark_conversation_confirming / mark_conversation_active — have
  // been retired. Conversation is now a system entity ("Conversation"
  // in system-entities.ts); the routing bodies compose the generic
  // state.list_instances / state.try_create_instance /
  // state.update_instance primitives via Fenel helpers in
  // fenel/modules/telegram/conversation.fenel.

  reg.registerIOHandler("state.call_hook_function_string", async (params, ctx) => {
    const fnSlug = params["fnSlug"] as string | undefined;
    const args = (params["args"] as Record<string, unknown> | undefined) ?? {};
    if (!fnSlug) return { action: "continue", value: { $tag: "Nothing" } };
    try {
      const { runEphemeralFunction } = await import("../hook-runner");
      // rights R2a — the CALLER's authority, not a fresh worker one. A hook
      // reached from a restricted body must not gain the member envelope by
      // being one hop further down.
      const result = await runEphemeralFunction(ctx.accountId, fnSlug, args, ctx.authority);
      if (typeof result === "string" && result.length > 0) {
        return { action: "continue", value: { $tag: "Just", _0: result } };
      }
    } catch (e) {
      console.error(`[state.call_hook_function_string] hook ${fnSlug} failed:`, e);
    }
    return { action: "continue", value: { $tag: "Nothing" } };
  });

  reg.registerIOHandler("state.call_hook_function_record", async (params, ctx) => {
    const fnSlug = params["fnSlug"] as string | undefined;
    const args = (params["args"] as Record<string, unknown> | undefined) ?? {};
    if (!fnSlug) return { action: "continue", value: { $tag: "Nothing" } };
    try {
      const { runEphemeralFunction } = await import("../hook-runner");
      // rights R2a — the CALLER's authority, not a fresh worker one. A hook
      // reached from a restricted body must not gain the member envelope by
      // being one hop further down.
      const result = await runEphemeralFunction(ctx.accountId, fnSlug, args, ctx.authority);
      if (result && typeof result === "object" && !Array.isArray(result)) {
        return { action: "continue", value: { $tag: "Just", _0: result } };
      }
    } catch (e) {
      console.error(`[state.call_hook_function_record] hook ${fnSlug} failed:`, e);
    }
    return { action: "continue", value: { $tag: "Nothing" } };
  });

  reg.registerIOHandler("state.register_representation", async (params, ctx) => {
    const targetId = params["targetId"] as string | undefined;
    const typeName = params["typeName"] as string | undefined;
    const methods = params["methods"] as Record<string, unknown> | undefined;
    if (!targetId || !typeName || !methods) {
      throw new Error(
        "state.register_representation: targetId/typeName/methods required",
      );
    }
    const { createDispatchInstance } = await import("@fenel/db");
    const { applyAccountSpecInstances } = await import("@fenel/engine");
    const { dispatchRegistry } = await import("@fenel/engine/system-entities");
    const instance = { typeName, args: [targetId], methods };
    await createDispatchInstance(ctx.accountId, {
      typeName,
      args: [targetId],
      instance,
    });
    applyAccountSpecInstances(dispatchRegistry, ctx.accountId, [instance]);
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.delete_subscription", async (params, ctx) => {
    const slug = params["slug"] as string | undefined;
    if (!slug) return { action: "continue", value: null };
    const { deleteSubscription } = await import("@fenel/db");
    // rights R2b review round 5 — the ACCOUNT, which this handler already had
    // and was the only state handler in the file not to destructure. Without it
    // the delete matched on a globally unique slug alone.
    await deleteSubscription(ctx.accountId, slug).catch(() => undefined);
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.dispatch_event_triggers", async (params, ctx) => {
    const eventType = params["eventType"] as string | undefined;
    const payload = params["payload"] as Record<string, unknown> | undefined;
    if (!eventType) return { action: "continue", value: null };
    const { processEvent } = await import("../triggers");
    await processEvent(ctx.accountId, eventType, payload ?? {}, ctx.profileId || undefined);
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.list_instances_by_name", async (params, ctx) => {
    const typeName = params["typeName"] as string | undefined;
    if (!typeName) return { action: "continue", value: [] };
    // Dispatch through the same readSystemInstance/listSystemInstances
    // path that state.list_instances uses, but keyed by the type name
    // directly (no UUID lookup).
    const sysRows = await listSystemInstances(ctx.accountId, typeName);
    if (sysRows.length > 0) {
      return { action: "continue", value: params["envelope"] === true
        ? sysRows.map((row) => ({ id: row.id, accountId: ctx.accountId, entityType: typeName, data: row, dataEncoding: null }))
        : sysRows };
    }
    // Preserve by-type storage resolution (reference → Bundle, otherwise the
    // active dynamic backend) while exercising the selected descriptor.
    const rows = await performStorageMethod(
      reg,
      ctx,
      "list",
      [ctx.accountId, typeName, 1000, undefined],
      { typeName },
    );
    // The HTTP value boundary needs storage provenance beside the payload.
    // This host projection avoids flattening a business field named
    // dataEncoding/id into physical row metadata.
    if (params["envelope"] === true) return { action: "continue", value: rows };
    // Phase 12a sub-step 2 — envelope evolution. Previously returned
    // `r.data` only; the dashboard GET routes need id/accountId/createdAt/
    // updatedAt to render legacy wire shapes (flattenInstance / flattenRelation
    // both read row.id + row.accountId + row.createdAt). Additive — existing
    // consumers (listTelegramCollectors / Conversation lookups) that only
    // read data-side fields are unaffected by the extra envelope fields.
    return {
      action: "continue",
      value: await projectStoredInstanceRows(reg, ctx, typeName, rows),
    };
  });

  reg.registerIOHandler("state.cancel_all_conversations", async (params, ctx) => {
    const botId = params["botId"] as string | undefined;
    if (!botId) return { action: "continue", value: null };
    // Operates on entity_instances rows of entityType "Conversation"
    // (the Conversation system entity, no dedicated table).
    const { cancelInFlightConversationsByBot } = await import("@fenel/db");
    // rights R2b review round 6 — the ACCOUNT. The act argues only a bot id, so
    // no partition axis reaches it; the frame is the only thing that can scope it.
    await cancelInFlightConversationsByBot(ctx.accountId, botId).catch(() => undefined);
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.upsert_subscription", async (params, ctx) => {
    const slug = params["slug"] as string | undefined;
    const source = params["source"] as string | undefined;
    const secret = params["secret"] as string | undefined;
    const metadata = params["metadata"] as Record<string, unknown> | undefined;
    if (!slug || !source || !secret) {
      throw new Error(
        "state.upsert_subscription: slug/source/secret required",
      );
    }
    const { upsertSubscription } = await import("@fenel/db");
    await upsertSubscription({
      accountId: ctx.accountId,
      slug,
      source: source as "http_webhook" | "event" | "cron" | "signal",
      secret,
      handlerFunctionId: null,
      enabled: true,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    });
    return { action: "continue", value: null };
  });

  // ---- Phase 12a sub-step 4 — types/functions registry reads -------------
  reg.registerIOHandler("state.list_types", async (_params, ctx) => {
    const { listTypes } = await import("@fenel/db");
    const rows = await listTypes(ctx.accountId);
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.get_type", async (params, ctx) => {
    const name = params["name"] as string | undefined;
    if (!name) return { action: "continue", value: { $tag: "Nothing" } };
    const row = await performStorageMethod(
      reg,
      ctx,
      "loadTypeByName",
      [ctx.accountId, name],
    );
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  // The by-UUID sister of state.get_type. Returns the full entity_definition
  // row (id/name/type/…) as Maybe. Backs the telegram collector's
  // typeId→(typeName, fields) resolution leaf, which needs both `.name` and
  // `.type` off the row (the by-name get_type can't be used — the collector
  // holds a typeId UUID, not a name).
  reg.registerIOHandler("state.get_type_by_id", async (params, ctx) => {
    const typeId = params["typeId"] as string | undefined;
    if (!typeId) return { action: "continue", value: { $tag: "Nothing" } };
    const row = await performStorageMethod(
      reg,
      ctx,
      "loadType",
      [ctx.accountId, typeId],
    );
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.list_functions", async (_params, ctx) => {
    const { listFunctions } = await import("@fenel/db");
    const rows = await listFunctions(ctx.accountId);
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.catalog_read_revision", async (params, ctx) => {
    const catalog = params["catalog"];
    if (catalog !== "types" && catalog !== "functions") throw new Error("Unknown catalog revision");
    const { catalogReadRevision } = await import("@fenel/db");
    return { action: "continue", value: await catalogReadRevision(ctx.accountId, catalog) };
  });

  reg.registerIOHandler("state.get_function", async (params, ctx) => {
    const name = params["name"] as string | undefined;
    if (!name) return { action: "continue", value: { $tag: "Nothing" } };
    const { getFunction } = await import("@fenel/db");
    const row = await getFunction(ctx.accountId, name);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  // ---- Phase 12a sub-step 5 — function_instance state primitives -------
  //
  // function_instances is its own table (not entity_instances). These
  // handlers wrap the existing drizzle queries + the runtime helpers
  // (startFunctionInstance / resumeWaitingInstance). All five primitives
  // are scoped to ctx.accountId for safety.

  reg.registerIOHandler("state.list_function_instances", async (params, ctx) => {
    const { getDb, functionInstances, functions } = await import("@fenel/db");
    const { and, eq, inArray, desc } = await import("drizzle-orm");
    const fnDbIdRaw = params["fnDbId"];
    const statusesRaw = params["statuses"];
    // Unwrap Maybe wrappers. Nothing → undefined; Just X → X.
    let fnDbId: string | undefined;
    if (typeof fnDbIdRaw === "string") fnDbId = fnDbIdRaw;
    else if (fnDbIdRaw && typeof fnDbIdRaw === "object") {
      const tag = (fnDbIdRaw as { $tag?: unknown }).$tag;
      if (tag === "Just") {
        const v = (fnDbIdRaw as { _0?: unknown })._0;
        if (typeof v === "string") fnDbId = v;
      }
    }
    let statuses: string[] | undefined;
    if (Array.isArray(statusesRaw)) statuses = statusesRaw as string[];
    else if (statusesRaw && typeof statusesRaw === "object") {
      const tag = (statusesRaw as { $tag?: unknown }).$tag;
      if (tag === "Just") {
        const v = (statusesRaw as { _0?: unknown })._0;
        if (Array.isArray(v)) statuses = v as string[];
      }
    }
    const conditions = [eq(functionInstances.accountId, ctx.accountId)];
    if (fnDbId) conditions.push(eq(functionInstances.functionId, fnDbId));
    if (statuses && statuses.length > 0) {
      conditions.push(inArray(functionInstances.status, statuses as never));
    }
    const rows = await getDb()
      .select({
        id: functionInstances.id,
        functionId: functionInstances.functionId,
        functionName: functions.name,
        status: functionInstances.status,
        variables: functionInstances.variables,
        variablesEncoding: functionInstances.variablesEncoding,
        startedAt: functionInstances.startedAt,
        completedAt: functionInstances.completedAt,
      })
      .from(functionInstances)
      .leftJoin(functions, eq(functions.id, functionInstances.functionId))
      .where(and(...conditions))
      .orderBy(desc(functionInstances.startedAt))
      .limit(100);
    return { action: "continue", value: rows.map(decodeCheckpointRow) };
  });

  reg.registerIOHandler("state.get_function_instance", async (params, ctx) => {
    const instanceId = params["instanceId"] as string | undefined;
    if (!instanceId) return { action: "continue", value: { $tag: "Nothing" } };
    const { getDb, functionInstances } = await import("@fenel/db");
    const { and, eq } = await import("drizzle-orm");
    const [row] = await getDb()
      .select()
      .from(functionInstances)
      .where(
        and(
          eq(functionInstances.id, instanceId),
          eq(functionInstances.accountId, ctx.accountId),
        ),
      )
      .limit(1);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: decodeCheckpointRow(row) } };
  });

  reg.registerIOHandler("state.start_function_instance", async (params, ctx) => {
    const dbFnId = params["dbFnId"] as string | undefined;
    if (!dbFnId) {
      throw new Error("state.start_function_instance: dbFnId required");
    }
    const profileIdRaw = params["profileId"];
    let profileId: string | null = null;
    if (typeof profileIdRaw === "string") profileId = profileIdRaw;
    else if (profileIdRaw && typeof profileIdRaw === "object") {
      const tag = (profileIdRaw as { $tag?: unknown }).$tag;
      if (tag === "Just") {
        const v = (profileIdRaw as { _0?: unknown })._0;
        if (typeof v === "string") profileId = v;
      }
    }
    const source = (params["source"] as string | undefined) ?? "_unknown";
    const callerParams = (params["params"] as Record<string, unknown> | undefined) ?? {};
    const { startFunctionInstance } = await import("../triggers");
    const instanceId = await startFunctionInstance(
      ctx.accountId,
      dbFnId,
      profileId,
      source,
      callerParams,
      // rights R2a — the CALLER's authority. A body that starts another
      // function must not gain reach by doing so.
      ctx.authority,
    );
    return { action: "continue", value: instanceId };
  });

  reg.registerIOHandler("state.resume_waiting_instance", async (params, ctx) => {
    const instanceId = params["instanceId"] as string | undefined;
    if (!instanceId) {
      return {
        action: "continue",
        value: { ok: false, error: "instanceId required" },
      };
    }
    const event = (params["event"] as Record<string, unknown> | undefined) ?? {};
    try {
      const rawNonce = params["expectedSuspensionId"];
      if (rawNonce != null && (typeof rawNonce !== "object" || !("$tag" in rawNonce) || (rawNonce.$tag !== "Just" && rawNonce.$tag !== "Nothing"))) {
        throw new Error("expectedSuspensionId must be Maybe String");
      }
      if (rawNonce && typeof rawNonce === "object" && "$tag" in rawNonce && rawNonce.$tag === "Just" && (!("_0" in rawNonce) || typeof rawNonce._0 !== "string" || !rawNonce._0)) {
        throw new Error("expectedSuspensionId must be Maybe String");
      }
      const expectedSuspensionId = peelMaybeValue(rawNonce as Maybe<unknown> | undefined);
      if (expectedSuspensionId != null && (typeof expectedSuspensionId !== "string" || !expectedSuspensionId)) {
        throw new Error("expectedSuspensionId must be Maybe String");
      }
      const { resumeWaitingInstance } = await import("../evaluator");
      // rights C1 — AUTHORIZE BEFORE RESUMING. This used to call
      // `resumeWaitingInstance(instanceId, event)` — running the victim's
      // continuation to completion — and only THEN run the account-scoped
      // SELECT below to build the return value. The account filter was on the
      // *reply*, not on the *act*: a caller who could name another account's
      // instance uuid resumed that computation and chose what it saw on waking,
      // then merely got "not found" back. The scope now rides the lookup inside
      // `resumeWaitingInstance` itself, so a cross-account id never resumes.
      const outcome = await resumeWaitingInstance(instanceId, event, {
        issuer: "caller",
        accountId: ctx.accountId,
        expectedSuspensionId: expectedSuspensionId as string | null,
        // rights R2a — the woken continuation runs under the authority of the
        // frame that asked for the wake. Being entitled to wake an instance is
        // not the same as being entitled to everything it then does, and R4
        // replaces this with a re-mint from the instance's own grant ids.
        authority: ctx.authority,
      });
      if (!outcome.resumed) {
        if (outcome.reason === "stale-wait") {
          return { action: "continue", value: { ok: false, error: "This prompt has changed. Refresh before responding." } };
        }
        if (outcome.reason === "invalid-input") {
          return { action: "continue", value: { ok: false, error: "input does not match the requested type" } };
        }
        // One message for lookup/claim failure. `not-found` already conflates absent
        // with other-account inside the evaluator; keeping `not-resumable`
        // distinct here would leak that an id exists in another account
        // whenever that instance happened to be in a non-waiting status.
        return { action: "continue", value: { ok: false, error: "instance not found" } };
      }
      const { getDb, functionInstances } = await import("@fenel/db");
      const { and, eq } = await import("drizzle-orm");
      const [row] = await getDb()
        .select()
        .from(functionInstances)
        .where(
          and(
            eq(functionInstances.id, instanceId),
            eq(functionInstances.accountId, ctx.accountId),
          ),
        )
        .limit(1);
      if (!row) {
        return {
          action: "continue",
          value: { ok: false, error: "instance not found after resume" },
        };
      }
      const instance = decodeCheckpointRow(row);
      if (instance.status === "failed" || instance.status === "cancelled") {
        return { action: "continue", value: { ok: false, error: String(instance.variables?._error ?? `instance ${instance.status}`) } };
      }
      return { action: "continue", value: { ok: true, instance: { $tag: "Just", _0: instance } } };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { action: "continue", value: { ok: false, error: msg } };
    }
  });

  reg.registerIOHandler("state.find_last_completed_instance", async (params, ctx) => {
    const fnDbId = params["fnDbId"] as string | undefined;
    if (!fnDbId) return { action: "continue", value: { $tag: "Nothing" } };
    const { getDb, functionInstances } = await import("@fenel/db");
    const { and, eq, desc } = await import("drizzle-orm");
    const [row] = await getDb()
      .select()
      .from(functionInstances)
      .where(
        and(
          eq(functionInstances.accountId, ctx.accountId),
          eq(functionInstances.functionId, fnDbId),
          eq(functionInstances.status, "completed"),
        ),
      )
      .orderBy(desc(functionInstances.startedAt))
      .limit(1);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: decodeCheckpointRow(row) } };
  });

  // ---- Phase 12a sub-step 6 — typeclass + subscription + traces + events --
  //
  // Substrate primitives for the dashboard /spec-instances + /triggers +
  // /functions/:fnId/instances/:instId/timeline routes. Each handler is a
  // single irreducible IO leaf wrapping the matching @fenel/db query.

  reg.registerIOHandler("state.list_spec_instances", async (params, ctx) => {
    const typeNameRaw = params["typeName"];
    let typeName: string | undefined;
    if (typeof typeNameRaw === "string") typeName = typeNameRaw;
    else if (typeNameRaw && typeof typeNameRaw === "object") {
      const tag = (typeNameRaw as { $tag?: unknown }).$tag;
      if (tag === "Just") {
        const v = (typeNameRaw as { _0?: unknown })._0;
        if (typeof v === "string") typeName = v;
      }
    }
    const { listInstances } = await import("@fenel/db");
    const rows = await listInstances(ctx.accountId, typeName);
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.get_spec_instance", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: { $tag: "Nothing" } };
    const { getDispatchInstance } = await import("@fenel/db");
    const row = await getDispatchInstance(ctx.accountId, id);
    if (!row) {
      return { action: "continue", value: { $tag: "Nothing" } };
    }
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.create_spec_instance", async (params, ctx) => {
    const body = params["body"] as Record<string, unknown> | undefined;
    if (!body) throw new Error("state.create_spec_instance: body required");
    const typeName = body["typeName"];
    const args = body["args"];
    const instance = body["instance"];
    const suppliedId = body["id"];
    if (suppliedId !== undefined && typeof suppliedId !== "string") {
      throw new TypeError("state.create_spec_instance: body.id must be a UUID string when supplied");
    }
    if (typeof typeName !== "string") {
      throw new Error("state.create_spec_instance: body.typeName (string) required");
    }
    if (!Array.isArray(args)) {
      throw new Error("state.create_spec_instance: body.args (array) required");
    }
    if (!instance || typeof instance !== "object") {
      throw new Error("state.create_spec_instance: body.instance (record) required");
    }
    const { createDispatchInstance } = await import("@fenel/db");
    const targetEntityType = body["targetEntityType"];
    if (targetEntityType !== undefined && targetEntityType !== null && typeof targetEntityType !== "string") throw new Error("state.create_spec_instance: body.targetEntityType must be a string or null");
    const row = await createDispatchInstance(ctx.accountId, {
      ...(suppliedId !== undefined ? { id: suppliedId as string } : {}),
      typeName,
      args: args as unknown[],
      instance: instance as Record<string, unknown>,
      ...(targetEntityType !== undefined ? { targetEntityType } : {}),
    });
    return { action: "continue", value: row };
  });

  reg.registerIOHandler("state.update_spec_instance", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    const body = params["body"] as Record<string, unknown> | undefined;
    if (!id) throw new Error("state.update_spec_instance: id required");
    if (!body) throw new Error("state.update_spec_instance: body required");
    const instance = body["instance"];
    if (!instance || typeof instance !== "object") {
      throw new Error("state.update_spec_instance: body.instance (record) required");
    }
    const { updateDispatchInstance } = await import("@fenel/db");
    const expectedInstance = body["expectedInstance"];
    if (Object.hasOwn(body, "expectedInstance") && (!expectedInstance
      || typeof expectedInstance !== "object" || Array.isArray(expectedInstance))) {
      throw new TypeError("state.update_spec_instance: expectedInstance must be a record when supplied");
    }
    const row = await updateDispatchInstance(ctx.accountId, id, {
      instance: instance as Record<string, unknown>,
      ...(Object.hasOwn(body, "expectedInstance") ? { expectedInstance: expectedInstance as Record<string, unknown> } : {}),
    });
    return { action: "continue", value: row };
  });

  reg.registerIOHandler("state.delete_spec_instance", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: null };
    const { deleteDispatchInstance } = await import("@fenel/db");
    const expected = maybeArgument(params["expectedInstance"], "state.delete_spec_instance.expectedInstance");
    if (expected.present && (!expected.value || typeof expected.value !== "object" || Array.isArray(expected.value))) {
      throw new TypeError("state.delete_spec_instance: expectedInstance must be a record when supplied");
    }
    await deleteDispatchInstance(ctx.accountId, id, expected.present
      ? { expectedInstance: expected.value as Record<string, unknown> } : {});
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.list_subscriptions_by_handler", async (params, ctx) => {
    const handlerFnId = params["handlerFnId"] as string | undefined;
    if (!handlerFnId) return { action: "continue", value: [] };
    const { listEventSubscriptionsByHandler } = await import("@fenel/db");
    const rows = await listEventSubscriptionsByHandler(ctx.accountId, handlerFnId);
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.get_subscription", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: { $tag: "Nothing" } };
    const { getSubscriptionById } = await import("@fenel/db");
    const row = await getSubscriptionById(id);
    if (!row || row.accountId !== ctx.accountId) {
      return { action: "continue", value: { $tag: "Nothing" } };
    }
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.update_subscription", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    const patch = params["patch"] as Record<string, unknown> | undefined;
    if (!id) return { action: "continue", value: { $tag: "Nothing" } };
    if (!patch) return { action: "continue", value: { $tag: "Nothing" } };
    // Each patch field is unwrapped from the Fenel-side Maybe wrapper:
    // {$tag: "Nothing"} → leave column alone; {$tag: "Just", _0: v} → set v.
    // Bare values (legacy callers / non-Maybe entries) pass through with a
    // type-guard. metadata is JSON.stringified at the boundary — the column
    // is TEXT, not JSONB.
    const unwrap = (v: unknown): { present: boolean; value: unknown } => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const tag = (v as { $tag?: unknown }).$tag;
        if (tag === "Nothing") return { present: false, value: undefined };
        if (tag === "Just") return { present: true, value: (v as { _0?: unknown })._0 };
      }
      return { present: true, value: v };
    };
    const dbPatch: {
      eventType?: string | null;
      enabled?: boolean;
      metadata?: string | null;
    } = {};
    if ("eventType" in patch) {
      const { present, value: v } = unwrap(patch.eventType);
      if (present) {
        if (typeof v === "string" || v === null) dbPatch.eventType = v;
      }
    }
    if ("enabled" in patch) {
      const { present, value: v } = unwrap(patch.enabled);
      if (present && typeof v === "boolean") dbPatch.enabled = v;
    }
    if ("metadata" in patch) {
      const { present, value: v } = unwrap(patch.metadata);
      if (present) {
        if (v === null) dbPatch.metadata = null;
        else if (typeof v === "string") dbPatch.metadata = v;
        else if (typeof v === "object") dbPatch.metadata = JSON.stringify(v);
      }
    }
    const { updateSubscriptionById } = await import("@fenel/db");
    const row = await updateSubscriptionById(ctx.accountId, id, dbPatch);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.delete_subscription_by_id", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: false };
    const { deleteSubscriptionById } = await import("@fenel/db");
    const ok = await deleteSubscriptionById(ctx.accountId, id);
    return { action: "continue", value: ok };
  });

  reg.registerIOHandler("state.create_subscription", async (params, ctx) => {
    const row = params["row"] as Record<string, unknown> | undefined;
    if (!row) throw new Error("state.create_subscription: row required");
    const slug = row["slug"];
    const source = row["source"];
    if (typeof slug !== "string") {
      throw new Error("state.create_subscription: row.slug (string) required");
    }
    if (typeof source !== "string") {
      throw new Error("state.create_subscription: row.source (string) required");
    }
    const metadataRaw = row["metadata"];
    let metadata: string | null | undefined;
    if (metadataRaw === undefined) metadata = undefined;
    else if (metadataRaw === null) metadata = null;
    else if (typeof metadataRaw === "string") metadata = metadataRaw;
    else if (typeof metadataRaw === "object") metadata = JSON.stringify(metadataRaw);
    const eventTypeRaw = row["eventType"];
    const eventType =
      typeof eventTypeRaw === "string"
        ? eventTypeRaw
        : eventTypeRaw === null
          ? null
          : undefined;
    const handlerFunctionIdRaw = row["handlerFunctionId"];
    const handlerFunctionId =
      typeof handlerFunctionIdRaw === "string"
        ? handlerFunctionIdRaw
        : handlerFunctionIdRaw === null
          ? null
          : undefined;
    const secretRaw = row["secret"];
    const secret =
      typeof secretRaw === "string"
        ? secretRaw
        : secretRaw === null
          ? null
          : undefined;
    const enabledRaw = row["enabled"];
    const enabled = typeof enabledRaw === "boolean" ? enabledRaw : undefined;
    const { upsertSubscription } = await import("@fenel/db");
    const created = await upsertSubscription({
      accountId: ctx.accountId,
      slug,
      source: source as "http_webhook" | "event" | "cron" | "signal",
      secret,
      eventType,
      handlerFunctionId,
      enabled,
      metadata,
    });
    return { action: "continue", value: created };
  });

  reg.registerIOHandler("state.list_traces_by_instance", async (params, ctx) => {
    const instanceId = params["instanceId"] as string | undefined;
    if (!instanceId) return { action: "continue", value: [] };
    const { getTracesByInstance } = await import("@fenel/db");
    // rights R2b review round 6 — the ACCOUNT. Trace rows carry the `input` and
    // `output` of every step; the act argues only an instance id.
    const rows = await getTracesByInstance(ctx.accountId, instanceId);
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.list_events_by_aggregate", async (params, ctx) => {
    const aggregateType = params["aggregateType"] as string | undefined;
    const aggregateId = params["aggregateId"] as string | undefined;
    const startDateRaw = params["startDate"];
    const endDateRaw = params["endDate"];
    const limitRaw = params["limit"];
    if (!aggregateType || !aggregateId) return { action: "continue", value: [] };
    let startDate: Date | undefined;
    if (typeof startDateRaw === "string") startDate = new Date(startDateRaw);
    else if (startDateRaw instanceof Date) startDate = startDateRaw;
    if (!startDate) return { action: "continue", value: [] };
    let endDate: Date | undefined;
    if (typeof endDateRaw === "string") endDate = new Date(endDateRaw);
    else if (endDateRaw instanceof Date) endDate = endDateRaw;
    else if (endDateRaw && typeof endDateRaw === "object") {
      const tag = (endDateRaw as { $tag?: unknown }).$tag;
      if (tag === "Just") {
        const v = (endDateRaw as { _0?: unknown })._0;
        if (typeof v === "string") endDate = new Date(v);
        else if (v instanceof Date) endDate = v;
      }
    }
    const limit = typeof limitRaw === "number" ? limitRaw : 200;
    const { getDb, events } = await import("@fenel/db");
    const { and, eq, desc, sql } = await import("drizzle-orm");
    const conditions = [
      eq(events.accountId, ctx.accountId),
      eq(events.aggregateType, aggregateType),
      eq(events.aggregateId, aggregateId),
      sql`${events.createdAt} >= ${startDate}`,
    ];
    if (endDate) {
      conditions.push(sql`${events.createdAt} <= ${endDate}`);
    }
    const rows = await getDb()
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.createdAt))
      .limit(limit);
    return { action: "continue", value: rows };
  });

  // ---- Phase 12a sub-step 7 — saved queries + categories + locus views --
  //
  // Substrate primitives for the dashboard /saved-queries, /query-categories,
  // and /locus-views routes. Each handler does raw drizzle against the
  // matching table (no @fenel/db helpers exist — Decision HH).

  // Unwrap a Fenel-side Maybe wrapper to { present, value }. Pass-through for
  // bare values. Used by every patch handler that accepts Maybe-wrapped
  // partial-update fields.
  const unwrapMaybe = (v: unknown): { present: boolean; value: unknown } => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const tag = (v as { $tag?: unknown }).$tag;
      if (tag === "Nothing") return { present: false, value: undefined };
      if (tag === "Just") return { present: true, value: (v as { _0?: unknown })._0 };
    }
    return { present: true, value: v };
  };

  // ---- Saved queries ----

  reg.registerIOHandler("state.list_saved_queries", async (_params, ctx) => {
    const { eq } = await import("drizzle-orm");
    const { getDb, savedQueries, decodeSavedQueryRow } = await import("@fenel/db");
    const rows = await getDb()
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.accountId, ctx.accountId))
      .orderBy(savedQueries.name);
    return { action: "continue", value: rows.map(decodeSavedQueryRow) };
  });

  reg.registerIOHandler("state.list_saved_queries_by_category", async (params, ctx) => {
    const categorySlug = params["categorySlug"] as string | undefined;
    if (!categorySlug) return { action: "continue", value: [] };
    const { eq, and, inArray } = await import("drizzle-orm");
    const { getDb, savedQueries, decodeSavedQueryRow, queryCategories, queryCategoryMembers } = await import("@fenel/db");
    const db = getDb();
    const [cat] = await db
      .select()
      .from(queryCategories)
      .where(and(eq(queryCategories.accountId, ctx.accountId), eq(queryCategories.slug, categorySlug)));
    if (!cat) return { action: "continue", value: [] };
    const members = await db
      .select({ queryId: queryCategoryMembers.queryId })
      .from(queryCategoryMembers)
      .where(eq(queryCategoryMembers.categoryId, cat.id));
    if (members.length === 0) return { action: "continue", value: [] };
    const queryIds = members.map((m) => m.queryId);
    const rows = await db
      .select()
      .from(savedQueries)
      .where(and(eq(savedQueries.accountId, ctx.accountId), inArray(savedQueries.id, queryIds)))
      .orderBy(savedQueries.name);
    return { action: "continue", value: rows.map(decodeSavedQueryRow) };
  });

  reg.registerIOHandler("state.search_saved_queries", async (params, ctx) => {
    const q = params["q"] as string | undefined;
    if (!q) return { action: "continue", value: [] };
    const { eq, and, or, sql } = await import("drizzle-orm");
    const { getDb, savedQueries, decodeSavedQueryRow } = await import("@fenel/db");
    const like = `%${q}%`;
    const rows = await getDb()
      .select()
      .from(savedQueries)
      .where(
        and(
          eq(savedQueries.accountId, ctx.accountId),
          or(
            sql`${savedQueries.name} ILIKE ${like}`,
            sql`${savedQueries.description} ILIKE ${like}`,
            sql`${savedQueries.slug} ILIKE ${like}`,
          ),
        ),
      )
      .orderBy(savedQueries.name);
    return { action: "continue", value: rows.map(decodeSavedQueryRow) };
  });

  reg.registerIOHandler("state.get_saved_query", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: { $tag: "Nothing" } };
    const { eq, and } = await import("drizzle-orm");
    const { getDb, savedQueries, decodeSavedQueryRow } = await import("@fenel/db");
    const [row] = await getDb()
      .select()
      .from(savedQueries)
      .where(and(eq(savedQueries.id, id), eq(savedQueries.accountId, ctx.accountId)));
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: decodeSavedQueryRow(row) } };
  });

  reg.registerIOHandler("state.create_saved_query", async (params, ctx) => {
    const data = params["data"] as Record<string, unknown> | undefined;
    if (!data) throw new Error("state.create_saved_query: data required");
    const slug = data["slug"];
    const name = data["name"];
    const description = data["description"];
    const query = data["query"];
    const id = data["id"];
    if (id !== undefined) {
      const { dispatchEngineBody } = await import("@fenel/engine/engine-bodies-dispatch");
      if (typeof id !== "string" || dispatchEngineBody("std:isUuid", [id]) !== true) {
        throw new TypeError("state.create_saved_query: data.id must be a UUID when supplied");
      }
    }
    if (typeof slug !== "string") throw new Error("state.create_saved_query: data.slug required");
    // A name is a `Labelable` instance, not a field of this row — an unnamed
    // value writes NULL here rather than a sentinel empty string. The column
    // is the denormalised mirror ORDER BY / ILIKE read, not the definition.
    if (!query || typeof query !== "object") {
      throw new Error("state.create_saved_query: data.query (record) required");
    }
    const { getDb, savedQueries, decodeSavedQueryRow, savedQueryColumns } = await import("@fenel/db");
    const [row] = await getDb()
      .insert(savedQueries)
      .values({
        ...(id === undefined ? {} : { id: id as string }),
        accountId: ctx.accountId,
        slug,
        name: typeof name === "string" && name.length > 0 ? name : null,
        description: typeof description === "string" && description.length > 0 ? description : null,
        ...savedQueryColumns(query),
      })
      .returning();
    return { action: "continue", value: decodeSavedQueryRow(row!) };
  });

  reg.registerIOHandler("state.update_saved_query", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    const patch = params["patch"] as Record<string, unknown> | undefined;
    if (!id) return { action: "continue", value: { $tag: "Nothing" } };
    if (!patch) return { action: "continue", value: { $tag: "Nothing" } };
    const { getDb, savedQueries, decodeSavedQueryRow, savedQueryColumns } = await import("@fenel/db");
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if ("slug" in patch) {
      const { present, value: v } = unwrapMaybe(patch.slug);
      if (present && typeof v === "string") updates.slug = v;
    }
    if ("name" in patch) {
      const { present, value: v } = unwrapMaybe(patch.name);
      if (present && typeof v === "string") updates.name = v;
    }
    if ("description" in patch) {
      const { present, value: v } = unwrapMaybe(patch.description);
      if (present) {
        if (v === null || typeof v === "string") updates.description = v;
      }
    }
    if ("query" in patch) {
      const { present, value: v } = unwrapMaybe(patch.query);
      if (present) Object.assign(updates, savedQueryColumns(v));
    }
    const { eq, and } = await import("drizzle-orm");
    const expected = unwrapMaybe(patch.expectedQuery ?? { $tag: "Nothing" });
    if (expected.present) {
      // The existing storage transaction is one atomic act. Canonical storage
      // marshalling preserves native atoms and literal marker-shaped legacy
      // data; the immutable Fenel equality body decides whether they match.
      const expectedColumns = savedQueryColumns(expected.value);
      const { dispatchEngineBody } = await import("@fenel/engine/engine-bodies-dispatch");
      return getDb().transaction(async (tx) => {
        const [current] = await tx.select().from(savedQueries)
          .where(and(eq(savedQueries.id, id), eq(savedQueries.accountId, ctx.accountId)))
          .for("update");
        if (!current) return { action: "continue" as const, value: { $tag: "Nothing" } };
        const currentColumns = savedQueryColumns(decodeSavedQueryRow(current).query);
        const matches = dispatchEngineBody("engine:eufValEq", [
          currentColumns.query, expectedColumns.query,
        ]);
        if (matches !== true) return { action: "continue" as const, value: { $tag: "Nothing" } };
        const [row] = await tx.update(savedQueries).set(updates)
          .where(and(eq(savedQueries.id, id), eq(savedQueries.accountId, ctx.accountId)))
          .returning();
        return { action: "continue" as const, value: row ? { $tag: "Just", _0: decodeSavedQueryRow(row) } : { $tag: "Nothing" } };
      });
    }
    const [row] = await getDb()
      .update(savedQueries)
      .set(updates)
      .where(and(eq(savedQueries.id, id), eq(savedQueries.accountId, ctx.accountId)))
      .returning();
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: decodeSavedQueryRow(row) } };
  });

  reg.registerIOHandler("state.delete_saved_query", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: false };
    const { eq, and } = await import("drizzle-orm");
    const { getDb, savedQueries, decodeSavedQueryRow, savedQueryColumns } = await import("@fenel/db");
    const expected = unwrapMaybe(params["expectedQuery"] ?? { $tag: "Nothing" });
    if (expected.present) {
      const expectedColumns = savedQueryColumns(expected.value);
      const { dispatchEngineBody } = await import("@fenel/engine/engine-bodies-dispatch");
      return getDb().transaction(async (tx) => {
        const [current] = await tx.select().from(savedQueries)
          .where(and(eq(savedQueries.id, id), eq(savedQueries.accountId, ctx.accountId)))
          .for("update");
        if (!current) return { action: "continue" as const, value: false };
        const currentColumns = savedQueryColumns(decodeSavedQueryRow(current).query);
        if (dispatchEngineBody("engine:eufValEq", [currentColumns.query, expectedColumns.query]) !== true) {
          return { action: "continue" as const, value: false };
        }
        const [deleted] = await tx.delete(savedQueries)
          .where(and(eq(savedQueries.id, id), eq(savedQueries.accountId, ctx.accountId)))
          .returning();
        return { action: "continue" as const, value: !!deleted };
      });
    }
    const [deleted] = await getDb()
      .delete(savedQueries)
      .where(and(eq(savedQueries.id, id), eq(savedQueries.accountId, ctx.accountId)))
      .returning();
    return { action: "continue", value: !!deleted };
  });

  // ---- Query categories ----

  reg.registerIOHandler("state.list_query_categories", async (_params, ctx) => {
    const { eq } = await import("drizzle-orm");
    const { getDb, queryCategories } = await import("@fenel/db");
    const rows = await getDb()
      .select()
      .from(queryCategories)
      .where(eq(queryCategories.accountId, ctx.accountId))
      .orderBy(queryCategories.name);
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.list_query_category_members", async (params, ctx) => {
    const categoryIds = params["categoryIds"];
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return { action: "continue", value: [] };
    }
    const ids = categoryIds.filter((x): x is string => typeof x === "string");
    if (ids.length === 0) return { action: "continue", value: [] };
    // ⚠ THE READ SIBLING OF THE THREE WRITES (rights R2b review round 9). Round 6
    // fenced `add` / `remove` / `createMembers` on `query_category_members` — a
    // table with NO account column — through `ownsQueryCategory`, and left the
    // LIST over the same table, taking the same caller-chosen uuids, unscoped.
    // Measured: a `viewer` of account A listing a category id in B received B's
    // rows. Both Fenel callers build `catIds` from `listQueryCategories`, which
    // IS account-scoped, so narrowing to owned categories changes nothing for
    // either — and an id from anywhere else now reads as no members.
    const { inArray, and, eq } = await import("drizzle-orm");
    const { getDb, queryCategories, queryCategoryMembers } = await import("@fenel/db");
    const owned = await getDb()
      .select({ id: queryCategories.id })
      .from(queryCategories)
      .where(and(
        inArray(queryCategories.id, ids),
        eq(queryCategories.accountId, ctx.accountId),
      ));
    const ownedIds = owned.map((row) => row.id);
    if (ownedIds.length === 0) return { action: "continue", value: [] };
    const rows = await getDb()
      .select()
      .from(queryCategoryMembers)
      .where(inArray(queryCategoryMembers.categoryId, ownedIds));
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.create_query_category", async (params, ctx) => {
    const data = params["data"] as Record<string, unknown> | undefined;
    if (!data) throw new Error("state.create_query_category: data required");
    const slug = data["slug"];
    const name = data["name"];
    const description = data["description"];
    const parentId = data["parentId"];
    if (typeof slug !== "string") throw new Error("state.create_query_category: data.slug required");
    if (typeof name !== "string") throw new Error("state.create_query_category: data.name required");
    const { getDb, queryCategories } = await import("@fenel/db");
    const [row] = await getDb()
      .insert(queryCategories)
      .values({
        accountId: ctx.accountId,
        slug,
        name,
        description: typeof description === "string" ? description : null,
        parentId: typeof parentId === "string" ? parentId : null,
      })
      .returning();
    return { action: "continue", value: row };
  });

  /** ⚠ rights R2b review round 6 — `query_category_members` carries NO account
   *  column, so a predicate on `(categoryId, queryId)` alone is account-blind:
   *  the three membership acts argue two opaque uuids and nothing else, so no
   *  partition axis reaches them and they sit in every role's general row.
   *  Measured `Just true` for a `viewer` of account A naming a category in B.
   *  The OWNING `query_categories` row does carry `account_id`, so ownership is
   *  one lookup, and a category in another account reads as "not found" — which
   *  is what a caller that cannot see it should observe. */
  async function ownsQueryCategory(accountId: string, categoryId: string): Promise<boolean> {
    const { eq, and } = await import("drizzle-orm");
    const { getDb, queryCategories } = await import("@fenel/db");
    const [row] = await getDb()
      .select({ id: queryCategories.id })
      .from(queryCategories)
      .where(and(eq(queryCategories.id, categoryId), eq(queryCategories.accountId, accountId)))
      .limit(1);
    return row !== undefined;
  }

  reg.registerIOHandler("state.create_query_category_members", async (params, ctx) => {
    const categoryId = params["categoryId"] as string | undefined;
    const queryIds = params["queryIds"];
    if (!categoryId) return { action: "continue", value: false };
    if (!Array.isArray(queryIds) || queryIds.length === 0) {
      return { action: "continue", value: true };
    }
    const ids = queryIds.filter((x): x is string => typeof x === "string");
    if (ids.length === 0) return { action: "continue", value: true };
    if (!(await ownsQueryCategory(ctx.accountId, categoryId))) {
      return { action: "continue", value: false };
    }
    const { getDb, queryCategoryMembers } = await import("@fenel/db");
    await getDb()
      .insert(queryCategoryMembers)
      .values(ids.map((qid) => ({ categoryId, queryId: qid })));
    return { action: "continue", value: true };
  });

  reg.registerIOHandler("state.update_query_category", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    const patch = params["patch"] as Record<string, unknown> | undefined;
    if (!id) return { action: "continue", value: { $tag: "Nothing" } };
    if (!patch) return { action: "continue", value: { $tag: "Nothing" } };
    const updates: Record<string, unknown> = {};
    if ("slug" in patch) {
      const { present, value: v } = unwrapMaybe(patch.slug);
      if (present && typeof v === "string") updates.slug = v;
    }
    if ("name" in patch) {
      const { present, value: v } = unwrapMaybe(patch.name);
      if (present && typeof v === "string") updates.name = v;
    }
    if ("description" in patch) {
      const { present, value: v } = unwrapMaybe(patch.description);
      if (present) {
        if (v === null || typeof v === "string") updates.description = v;
      }
    }
    if ("parentId" in patch) {
      const { present, value: v } = unwrapMaybe(patch.parentId);
      if (present) {
        if (v === null || typeof v === "string") updates.parentId = v;
      }
    }
    // No-op patch case — drizzle's .set({}) throws. Just return the row.
    if (Object.keys(updates).length === 0) {
      const { eq, and } = await import("drizzle-orm");
      const { getDb, queryCategories } = await import("@fenel/db");
      const [row] = await getDb()
        .select()
        .from(queryCategories)
        .where(and(eq(queryCategories.id, id), eq(queryCategories.accountId, ctx.accountId)));
      if (!row) return { action: "continue", value: { $tag: "Nothing" } };
      return { action: "continue", value: { $tag: "Just", _0: row } };
    }
    const { eq, and } = await import("drizzle-orm");
    const { getDb, queryCategories } = await import("@fenel/db");
    const [row] = await getDb()
      .update(queryCategories)
      .set(updates)
      .where(and(eq(queryCategories.id, id), eq(queryCategories.accountId, ctx.accountId)))
      .returning();
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.delete_query_category", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: false };
    const { eq, and } = await import("drizzle-orm");
    const { getDb, queryCategories } = await import("@fenel/db");
    const [deleted] = await getDb()
      .delete(queryCategories)
      .where(and(eq(queryCategories.id, id), eq(queryCategories.accountId, ctx.accountId)))
      .returning();
    return { action: "continue", value: !!deleted };
  });

  reg.registerIOHandler("state.add_query_to_category", async (params, ctx) => {
    const categoryId = params["categoryId"] as string | undefined;
    const queryId = params["queryId"] as string | undefined;
    if (!categoryId || !queryId) return { action: "continue", value: false };
    if (!(await ownsQueryCategory(ctx.accountId, categoryId))) {
      return { action: "continue", value: false };
    }
    const { getDb, queryCategoryMembers } = await import("@fenel/db");
    await getDb()
      .insert(queryCategoryMembers)
      .values({ categoryId, queryId })
      .onConflictDoNothing();
    return { action: "continue", value: true };
  });

  reg.registerIOHandler("state.remove_query_from_category", async (params, ctx) => {
    const categoryId = params["categoryId"] as string | undefined;
    const queryId = params["queryId"] as string | undefined;
    if (!categoryId || !queryId) return { action: "continue", value: false };
    if (!(await ownsQueryCategory(ctx.accountId, categoryId))) {
      return { action: "continue", value: false };
    }
    const { eq, and } = await import("drizzle-orm");
    const { getDb, queryCategoryMembers } = await import("@fenel/db");
    await getDb()
      .delete(queryCategoryMembers)
      .where(
        and(
          eq(queryCategoryMembers.categoryId, categoryId),
          eq(queryCategoryMembers.queryId, queryId),
        ),
      );
    return { action: "continue", value: true };
  });

  // ---- Locus views ----

  reg.registerIOHandler("state.read_locus_root", async (_params, ctx) => {
    const { readLocusRoot } = await import("@fenel/db");
    return { action: "continue", value: await readLocusRoot(ctx.accountId) };
  });

  reg.registerIOHandler("state.edit_locus_root", async (params, ctx) => {
    if (params["id"] !== ctx.accountId) return { action: "continue", value: { $tag: "Nothing" } };
    const { editLocusRoot } = await import("@fenel/db");
    const root = await editLocusRoot(ctx.accountId, params["expectedRevision"] as number,
      params["command"] as import("@fenel/db").LocusRootCommand);
    return { action: "continue", value: { $tag: "Just", _0: root } };
  });

  reg.registerIOHandler("state.list_locus_views", async (_params, ctx) => {
    const { listLocusRootRows } = await import("@fenel/db");
    return { action: "continue", value: await listLocusRootRows(ctx.accountId) };
  });

  reg.registerIOHandler("state.get_active_locus_view", async (_params, ctx) => {
    const { activeLocusRootList } = await import("@fenel/db");
    const row = await activeLocusRootList(ctx.accountId);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.count_locus_views", async (_params, ctx) => {
    const { readLocusRoot } = await import("@fenel/db");
    return { action: "continue", value: (await readLocusRoot(ctx.accountId)).lists.length };
  });

  reg.registerIOHandler("state.clear_all_active_locus_views", async (_params, ctx) => {
    const { clearActiveLocusRootList } = await import("@fenel/db");
    return { action: "continue", value: await clearActiveLocusRootList(ctx.accountId) };
  });

  reg.registerIOHandler("state.create_locus_view", async (params, ctx) => {
    const data = params["data"] as Record<string, unknown> | undefined;
    if (!data) throw new Error("state.create_locus_view: data required");
    const name = data["name"];
    const view = data["view"];
    const active = data["active"];
    if (typeof name !== "string") throw new Error("state.create_locus_view: data.name required");
    if (!view || typeof view !== "object") {
      throw new Error("state.create_locus_view: data.view (record) required");
    }
    const { createLocusRootList } = await import("@fenel/db");
    const row = await createLocusRootList(ctx.accountId, { name, view, active: active === true });
    return { action: "continue", value: row };
  });

  reg.registerIOHandler("state.update_locus_view", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    const patch = params["patch"] as Record<string, unknown> | undefined;
    if (!id) return { action: "continue", value: { $tag: "Nothing" } };
    if (!patch) return { action: "continue", value: { $tag: "Nothing" } };
    const updates: { name?: string; view?: unknown; active?: boolean } = {};
    if ("name" in patch) {
      const { present, value: v } = unwrapMaybe(patch.name);
      if (present && typeof v === "string") updates.name = v;
    }
    if ("view" in patch) {
      const { present, value: v } = unwrapMaybe(patch.view);
      if (present && v && typeof v === "object") {
        updates.view = v;
      }
    }
    if ("active" in patch) {
      const { present, value: v } = unwrapMaybe(patch.active);
      if (present && typeof v === "boolean") updates.active = v;
    }
    const { patchLocusRootList } = await import("@fenel/db");
    if (id === ctx.accountId) throw new Error("Edit root data through its explicit root edit action.");
    const listCommand = updates.view as { kind?: unknown; expectedRevision?: number; view?: unknown } | undefined;
    const expectedRevision = listCommand?.kind === "locus-list-command" ? listCommand.expectedRevision : undefined;
    if (listCommand?.kind === "locus-list-command") updates.view = listCommand.view;
    const row = await patchLocusRootList(ctx.accountId, id, updates, expectedRevision);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.delete_locus_view_by_id", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: { $tag: "Nothing" } };
    const { removeLocusRootList } = await import("@fenel/db");
    const deleted = await removeLocusRootList(ctx.accountId, id);
    if (!deleted) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: deleted } };
  });

  reg.registerIOHandler("state.promote_oldest_locus_view", async (_params, ctx) => {
    const { promoteLocusRootList } = await import("@fenel/db");
    return { action: "continue", value: await promoteLocusRootList(ctx.accountId) };
  });

  // ---- Phase 12a sub-step 8 — stats + analytics + activity handlers ----
  //
  // Per Decision LL: dedicated per-stat primitives over a generic group-by
  // (each filter is genuine SQL — JSONB accessors / JOIN with cross-account
  // scoping). Per Decisions MM + OO: dynamic-key Record outputs built JS-
  // side via Object.fromEntries (no std:recordFromEntries primitive today).
  // Per Decision QQ: row Date columns pass through unchanged — c.json on the
  // Hono layer ISO-serialises them.

  reg.registerIOHandler("state.count_profiles", async (_params, ctx) => {
    const { eq, and, count } = await import("drizzle-orm");
    const { getDb, entityInstances } = await import("@fenel/db");
    const [row] = await getDb()
      .select({ total: count() })
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, ctx.accountId),
          eq(entityInstances.entityType, "profile"),
        ),
      );
    return { action: "continue", value: Number(row?.total ?? 0) };
  });

  reg.registerIOHandler("state.profile_tag_counts_record", async (_params, ctx) => {
    const { eq, and, count, sql } = await import("drizzle-orm");
    const { getDb, entityInstances } = await import("@fenel/db");
    const rows = await getDb()
      .select({
        tag: sql<string>`${entityInstances.data}->>'tag'`,
        total: count(),
      })
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, ctx.accountId),
          eq(entityInstances.entityType, "profile_tag"),
          sql`${entityInstances.data}->>'validTo' IS NULL`,
        ),
      )
      .groupBy(sql`${entityInstances.data}->>'tag'`);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.tag] = Number(r.total);
    return { action: "continue", value: out };
  });

  reg.registerIOHandler("state.count_purchases_by_status", async (_params, ctx) => {
    const { eq, and, count, sql } = await import("drizzle-orm");
    const { getDb, entityInstances } = await import("@fenel/db");
    const rows = await getDb()
      .select({
        status: sql<string>`${entityInstances.data}->>'status'`,
        total: count(),
      })
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, ctx.accountId),
          eq(entityInstances.entityType, "purchase"),
        ),
      )
      .groupBy(sql`${entityInstances.data}->>'status'`);
    return {
      action: "continue",
      value: rows.map((r) => ({ status: r.status, total: Number(r.total) })),
    };
  });

  reg.registerIOHandler("state.count_function_instances_by_status", async (_params, ctx) => {
    const { eq, count } = await import("drizzle-orm");
    const { getDb, functionInstances } = await import("@fenel/db");
    const rows = await getDb()
      .select({ status: functionInstances.status, total: count() })
      .from(functionInstances)
      .where(eq(functionInstances.accountId, ctx.accountId))
      .groupBy(functionInstances.status);
    return {
      action: "continue",
      value: rows.map((r) => ({ status: r.status, total: Number(r.total) })),
    };
  });

  reg.registerIOHandler("state.sum_paid_payment_steps", async (_params, ctx) => {
    const { sql } = await import("drizzle-orm");
    const { getDb, entityInstances } = await import("@fenel/db");
    const rows = await getDb().execute(sql`
      SELECT coalesce(sum((${entityInstances.data}->>'amount')::int), 0)::int AS total
      FROM ${entityInstances}
      WHERE ${entityInstances.accountId} = ${ctx.accountId}
        AND ${entityInstances.entityType} = 'payment_step'
        AND ${entityInstances.data}->>'status' = 'paid'
    `);
    const first = (rows as unknown as Array<{ total: number | string | null }>)[0];
    return { action: "continue", value: Number(first?.total ?? 0) };
  });

  reg.registerIOHandler("state.event_counts_by_type_since_record", async (params, ctx) => {
    const since = params["since"] as string | undefined;
    if (!since) return { action: "continue", value: {} };
    const { sql } = await import("drizzle-orm");
    const { getDb, events } = await import("@fenel/db");
    const rows = await getDb().execute(sql`
      SELECT ${events.type} AS type, count(*)::int AS total
      FROM ${events}
      WHERE ${events.accountId} = ${ctx.accountId}
        AND ${events.createdAt} >= ${since}
      GROUP BY ${events.type}
      ORDER BY total DESC
    `);
    const out: Record<string, number> = {};
    for (const r of rows as unknown as Array<{ type: string; total: number | string }>) {
      out[r.type] = Number(r.total);
    }
    return { action: "continue", value: out };
  });

  reg.registerIOHandler("state.count_profiles_created_since_record", async (params, ctx) => {
    const d7 = params["d7"] as string | undefined;
    const d30 = params["d30"] as string | undefined;
    if (!d7 || !d30) return { action: "continue", value: { last7d: 0, last30d: 0 } };
    const { sql } = await import("drizzle-orm");
    const { getDb, entityInstances } = await import("@fenel/db");
    const rows = await getDb().execute(sql`
      SELECT
        count(*) FILTER (WHERE ${entityInstances.createdAt} >= ${d7})::int AS last_7d,
        count(*) FILTER (WHERE ${entityInstances.createdAt} >= ${d30})::int AS last_30d
      FROM ${entityInstances}
      WHERE ${entityInstances.accountId} = ${ctx.accountId}
        AND ${entityInstances.entityType} = 'profile'
    `);
    const first = (rows as unknown as Array<{ last_7d: number | string | null; last_30d: number | string | null }>)[0];
    return {
      action: "continue",
      value: {
        last7d: Number(first?.last_7d ?? 0),
        last30d: Number(first?.last_30d ?? 0),
      },
    };
  });

  reg.registerIOHandler("state.purchases_by_status_with_revenue_since", async (params, ctx) => {
    const since = params["since"] as string | undefined;
    if (!since) return { action: "continue", value: [] };
    const { sql } = await import("drizzle-orm");
    const { getDb } = await import("@fenel/db");
    const rows = await getDb().execute(sql`
      SELECT p.data->>'status' AS status, count(*)::int AS total,
        coalesce(sum(case when ps.data->>'status' = 'paid' then (ps.data->>'amount')::int else 0 end), 0)::int AS revenue
      FROM entity_instances p
      LEFT JOIN entity_instances ps
        ON ps.entity_type = 'payment_step'
        AND ps.account_id = p.account_id
        AND ps.data->>'purchaseId' = p.id::text
      WHERE p.account_id = ${ctx.accountId}
        AND p.entity_type = 'purchase'
        AND p.created_at >= ${since}
      GROUP BY p.data->>'status'
    `);
    return {
      action: "continue",
      value: (rows as unknown as Array<{ status: string; total: number | string; revenue: number | string }>).map((r) => ({
        status: r.status,
        total: Number(r.total),
        revenue: Number(r.revenue),
      })),
    };
  });

  reg.registerIOHandler("state.events_timeseries", async (params, ctx) => {
    const since = params["since"] as string | undefined;
    const eventTypeRaw = params["eventType"];
    if (!since) return { action: "continue", value: [] };
    let eventType: string | undefined;
    if (typeof eventTypeRaw === "string") eventType = eventTypeRaw;
    else if (eventTypeRaw && typeof eventTypeRaw === "object") {
      const tag = (eventTypeRaw as { $tag?: unknown }).$tag;
      if (tag === "Just") {
        const v = (eventTypeRaw as { _0?: unknown })._0;
        if (typeof v === "string") eventType = v;
      }
    }
    const { sql } = await import("drizzle-orm");
    const { getDb, events } = await import("@fenel/db");
    const conditions = [
      sql`${events.accountId} = ${ctx.accountId}`,
      sql`${events.createdAt} >= ${since}`,
    ];
    if (eventType) conditions.push(sql`${events.type} = ${eventType}`);
    const rows = await getDb().execute(sql`
      SELECT
        date_trunc('day', ${events.createdAt})::date AS day,
        ${events.type} AS type,
        count(*)::int AS total
      FROM ${events}
      WHERE ${sql.join(conditions, sql` AND `)}
      GROUP BY day, type
      ORDER BY day ASC
    `);
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.proxy_link_clicks_aggregate_record", async (_params, ctx) => {
    const { eq, and, count, sql } = await import("drizzle-orm");
    const { getDb, events } = await import("@fenel/db");
    const rows = await getDb()
      .select({
        aggregateId: events.aggregateId,
        totalClicks: count(),
        uniqueVisitors: sql<number>`count(distinct ${events.payload}->>'visitorHash')`,
      })
      .from(events)
      .where(
        and(
          eq(events.accountId, ctx.accountId),
          eq(events.type, "proxy_link_click"),
        ),
      )
      .groupBy(events.aggregateId);
    const out: Record<string, { totalClicks: number; uniqueVisitors: number }> = {};
    for (const r of rows) {
      if (r.aggregateId) {
        out[r.aggregateId] = {
          totalClicks: Number(r.totalClicks),
          uniqueVisitors: Number(r.uniqueVisitors),
        };
      }
    }
    return { action: "continue", value: out };
  });

  reg.registerIOHandler("state.function_stats", async (params, ctx) => {
    const fnId = params["fnId"] as string | undefined;
    if (!fnId) {
      return {
        action: "continue",
        value: {
          total: 0,
          running: 0,
          waiting: 0,
          completed: 0,
          cancelled: 0,
          failed: 0,
          byCheckpoint: {},
        },
      };
    }
    const { getFunctionStats } = await import("@fenel/db");
    const stats = await getFunctionStats(ctx.accountId, fnId);
    return { action: "continue", value: stats };
  });

  reg.registerIOHandler("state.function_live_counts_record", async (_params, ctx) => {
    const { getFunctionLiveCounts } = await import("@fenel/db");
    const counts = await getFunctionLiveCounts(ctx.accountId);
    return { action: "continue", value: counts };
  });

  reg.registerIOHandler("state.recent_traces_by_type", async (params, ctx) => {
    const typeName = params["typeName"] as string | undefined;
    const limitRaw = params["limit"];
    if (!typeName) return { action: "continue", value: [] };
    const limit = typeof limitRaw === "number" ? limitRaw : 50;
    const { getRecentTracesByType } = await import("@fenel/db");
    const traces = await getRecentTracesByType(ctx.accountId, typeName, limit);
    return { action: "continue", value: traces };
  });

  // Phase 12c-routes sub-step 1 — email-webhook substrate handlers.
  // The 4-fold collapse: replaces findMailgun/Postmark/Resend/SesIntegration
  // private helpers from the 4 webhook files with one shared primitive.
  reg.registerIOHandler("state.find_integration_by_id_and_type", async (params) => {
    const id = params["id"] as string | undefined;
    const type = params["type"] as string | undefined;
    if (!id || !type) return { action: "continue", value: { $tag: "Nothing" } };
    const { eq, and } = await import("drizzle-orm");
    const { getDb } = await import("@fenel/db");
    const { integrations } = await import("@fenel/db/schema");
    // The integrations.type column is a Postgres enum; the engine's
    // bare-String parameter signature can't enforce the union at the
    // Fenel-side. Cast to the enum domain at the boundary — Drizzle's
    // eq() refuses an arbitrary `string`.
    const enumType = type as import("@fenel/engine/integrations").IntegrationType;
    const [row] = await getDb()
      .select({
        id: integrations.id,
        accountId: integrations.accountId,
        credentials: integrations.credentials,
        enabled: integrations.enabled,
      })
      .from(integrations)
      .where(
        and(
          eq(integrations.id, id),
          eq(integrations.type, enumType),
          eq(integrations.enabled, true),
        ),
      )
      .limit(1);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.mark_webhook_processed", async (params, ctx) => {
    const provider = params["provider"] as string | undefined;
    const key = params["key"] as string | undefined;
    if (!provider || !key) return { action: "continue", value: false };
    const { markWebhookProcessed } = await import("@fenel/db");
    const fresh = await markWebhookProcessed(provider, key, ctx.accountId);
    return { action: "continue", value: fresh };
  });

  reg.registerIOHandler("state.auto_suppress_if_bad_event", async (params, ctx) => {
    const provider = params["provider"] as string | undefined;
    const recipientRaw = params["recipient"];
    const emailEvent = params["emailEvent"] as Record<string, unknown> | undefined;
    if (!provider || !emailEvent) return { action: "continue", value: null };
    // Maybe<Address> unwrap — accept { $tag: "Just", _0 } / { $tag: "Nothing" }
    // and the legacy null fallback (the runtime can hand a plain null when the
    // declared Maybe field is unset by an upstream lift).
    let recipient: { local: string; domain: string; displayName: string | null } | null = null;
    if (recipientRaw && typeof recipientRaw === "object") {
      const tagged = recipientRaw as { $tag?: unknown; _0?: unknown };
      if (tagged.$tag === "Just" && tagged._0 && typeof tagged._0 === "object") {
        const v = tagged._0 as Record<string, unknown>;
        recipient = {
          local: String(v.local ?? ""),
          domain: String(v.domain ?? ""),
          displayName: typeof v.displayName === "string" ? v.displayName : null,
        };
      } else if (tagged.$tag === undefined) {
        const v = recipientRaw as Record<string, unknown>;
        if (v.local || v.domain) {
          recipient = {
            local: String(v.local ?? ""),
            domain: String(v.domain ?? ""),
            displayName: typeof v.displayName === "string" ? v.displayName : null,
          };
        }
      }
    }
    const { autoSuppressIfBadEvent } = await import("../handlers/auto-suppress");
    await autoSuppressIfBadEvent(
      provider,
      ctx.accountId,
      recipient,
      emailEvent as unknown as import("../handlers/mailgun-webhook").EmailEventValue,
    );
    return { action: "continue", value: null };
  });

  // Phase 12c-routes sub-step 2 — mixed-ingress substrate handlers.
  reg.registerIOHandler("state.find_subscription_by_slug", async (params) => {
    const slug = params["slug"] as string | undefined;
    if (!slug) return { action: "continue", value: { $tag: "Nothing" } };
    const { findSubscriptionBySlug } = await import("@fenel/db");
    const row = await findSubscriptionBySlug(slug);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.find_bot_by_id_global", async (params) => {
    const botId = params["botId"] as string | undefined;
    if (!botId) return { action: "continue", value: { $tag: "Nothing" } };
    const { findBotByIdGlobal } = await import("@fenel/db");
    const row = await findBotByIdGlobal(botId);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  // Phase 14a sub-step 2 — profile handles lookup for the Fenel-bodied
  // tg_dm action. Wraps @fenel/db's getProfileHandles (which queries
  // entity_instances WHERE entity_type='profile_handle' AND data->>profileId=$1).
  // Returns the list verbatim — each row carries platform/handle/suspected/
  // validity-window fields that the body filters on.
  reg.registerIOHandler("state.get_profile_handles", async (params) => {
    const accountId = params["accountId"] as string | undefined;
    const profileId = params["profileId"] as string | undefined;
    if (!accountId || !profileId) return { action: "continue", value: [] };
    const { getProfileHandles } = await import("@fenel/db");
    const rows = await getProfileHandles(accountId, profileId);
    return { action: "continue", value: rows };
  });

  // Phase 13c sub-step 1 — polling deployment's startup-time botId
  // resolution. Sister of state.find_bot_by_id_global (keyed by botId for
  // the webhook ingress); this handler is keyed by accountId. Returns
  // Just botId when exactly one Bot is registered for the account;
  // Nothing otherwise (the "exactly one Bot per account" constraint
  // matches the polling deployment reality — BOT_TOKEN is per-process).
  reg.registerIOHandler("state.find_bot_id_for_account", async (params) => {
    const accountId = params["accountId"] as string | undefined;
    if (!accountId) return { action: "continue", value: { $tag: "Nothing" } };
    const { listBotsByAccount } = await import("@fenel/db");
    const rows = await listBotsByAccount(accountId);
    if (rows.length !== 1) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: rows[0]!.id } };
  });

  reg.registerIOHandler("state.find_proxy_link_by_account_slug_and_tag", async (params) => {
    const accountSlug = params["accountSlug"] as string | undefined;
    const tag = params["tag"] as string | undefined;
    if (!accountSlug || !tag) return { action: "continue", value: { $tag: "Nothing" } };
    const { eq, and, sql } = await import("drizzle-orm");
    const { getDb, entityInstances, accounts } = await import("@fenel/db");
    const [row] = await getDb()
      .select({ instance: entityInstances })
      .from(entityInstances)
      .innerJoin(accounts, eq(entityInstances.accountId, accounts.id))
      .where(
        and(
          eq(accounts.slug, accountSlug),
          eq(entityInstances.entityType, "proxy_link"),
          sql`${entityInstances.data}->>'tag' = ${tag}`,
        ),
      )
      .limit(1);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    const data = row.instance.data as Record<string, string | undefined>;
    const link = {
      id: row.instance.id,
      accountId: row.instance.accountId,
      tag: data.tag ?? "",
      url: data.url ?? "",
      title: data.title ?? null,
      description: data.description ?? null,
      image: data.image ?? null,
    };
    return { action: "continue", value: { $tag: "Just", _0: link } };
  });

  // Phase 12c-routes sub-step 3 — public-surfaces substrate handlers.
  // forms-collapse Phase 4 Stage 3 — state.find_form_by_slug RETIRED (forms gone).
  reg.registerIOHandler("state.get_page_by_slug", async (params) => {
    const accountSlug = params["accountSlug"] as string | undefined;
    const pageSlug = params["pageSlug"] as string | undefined;
    if (!accountSlug || !pageSlug) return { action: "continue", value: { $tag: "Nothing" } };
    const { getPageBySlug } = await import("@fenel/db");
    const row = await getPageBySlug(accountSlug, pageSlug);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  // storage-as-effect Phase 4a (2026-06-19) — state.create_page_submission
  // RETIRED. The page-submit lane captures via state:tryCreateInstanceByName
  // (an instance of the resolved type, mirroring types:submit); the
  // dedicated page_submissions row + its leaf are gone (migration 0080).

  reg.registerIOHandler("state.find_account_by_slug", async (params) => {
    const slug = params["slug"] as string | undefined;
    if (!slug) return { action: "continue", value: { $tag: "Nothing" } };
    const { eq } = await import("drizzle-orm");
    const { getDb, accounts } = await import("@fenel/db");
    const [row] = await getDb()
      .select()
      .from(accounts)
      .where(eq(accounts.slug, slug))
      .limit(1);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  // rights R2a — `state.list_policies` / `state.get_action_definition` /
  // `state.create_policy` are DELETED with the second policy engine and the
  // `permission_policies` table they read. Authority is decided at exercise
  // by `perform`, against the envelope on the frame.

  // forms-collapse Phase 4 Stage 3 — state.store_form_submission RETIRED. The
  // forms submit pipeline is gone; a funnel submission is an ordinary instance
  // (state:tryCreateInstanceByName) created by the funnel function body.

  // Phase 12d sub-step 2 — internal action dispatch substrate. Wraps the
  // TS @fenel/core dispatch() function with a System ActionContext.
  // Sister of the route-level dispatch() but invokable from inside Fenel
  // bodies via invokeIOActionAs, under the caller's own authority (rights R2a
  // deleted the manufactured System subject that used to bypass the check
  // policy evaluation; the action's Zod schema parse + handler fire
  // normally. Lazy import of @fenel/core dodges the workspace cycle
  // (same pattern as state.get_action_definition above).
  reg.registerIOHandler("dispatch.dispatch_action", async (params, ctx) => {
    const actionName = params["actionName"] as string | undefined;
    if (!actionName) {
      throw new Error("dispatch.dispatch_action: actionName required");
    }
    const actionParams =
      (params["params"] as Record<string, unknown> | undefined) ?? {};
    const { dispatch } = await import("@fenel/core");
    // rights R2a — a Fenel body can no longer run a public action as `System`.
    // The action runs under the authority that reached this leaf.
    const result = await dispatch(actionName, actionParams, {
      authority: ctx.authority,
      accountId: ctx.accountId,
      adapter: "system",
    });
    return { action: "continue", value: result };
  });

  // Phase 12d sub-step 3 — inventory substrate handlers. Two bodyless
  // IO leaves wrapping @fenel/db's inventory helpers. Sisters of
  // state.find_form_by_slug (12c-routes-3).
  reg.registerIOHandler("state.find_inventory_by_slug", async (params) => {
    const accountId = params["accountId"] as string | undefined;
    const slug = params["slug"] as string | undefined;
    if (!accountId || !slug) return { action: "continue", value: { $tag: "Nothing" } };
    const { findInventoryBySlug } = await import("@fenel/db");
    const row = await findInventoryBySlug(accountId, slug);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.get_inventory_status", async (params) => {
    const accountId = params["accountId"] as string | undefined;
    const slug = params["slug"] as string | undefined;
    if (!accountId || !slug) return { action: "continue", value: { $tag: "Nothing" } };
    const { getInventoryStatus } = await import("@fenel/db");
    const status = await getInventoryStatus(accountId, slug);
    if (!status) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: status } };
  });

  // ts-elimination-completion Phase 2 (entitlements area) — slug → item
  // lookup leaf. accountId from ctx (sister of find_profiles_by_handles).
  reg.registerIOHandler("state.find_item_by_slug", async (params, ctx) => {
    const slug = params["slug"] as string | undefined;
    if (!slug) return { action: "continue", value: { $tag: "Nothing" } };
    const { findItemBySlug } = await import("@fenel/db");
    const row = await findItemBySlug(ctx.accountId, slug);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  // ts-elimination-completion Phase 5 (5a-2/5a-3) — slug → plan lookup leaf.
  // Sister of state.find_item_by_slug; wraps the SAME @fenel/db:findPlanBySlug
  // the purchases.ts / payments.ts wrappers called, account-scoped via ctx.
  reg.registerIOHandler("state.find_plan_by_slug", async (params, ctx) => {
    const slug = params["slug"] as string | undefined;
    if (!slug) return { action: "continue", value: { $tag: "Nothing" } };
    const { findPlanBySlug } = await import("@fenel/db");
    const row = await findPlanBySlug(ctx.accountId, slug);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  // ts-elimination-completion Phase 2 (entitlements area) — read-only
  // access-validity Boolean query. accountId from ctx.
  reg.registerIOHandler("state.check_profile_access", async (params, ctx) => {
    const profileId = params["profileId"] as string | undefined;
    const itemSlug = params["itemSlug"] as string | undefined;
    if (!profileId || !itemSlug) return { action: "continue", value: false };
    const { checkProfileAccess } = await import("@fenel/db");
    const hasAccess = await checkProfileAccess(ctx.accountId, profileId, itemSlug);
    return { action: "continue", value: hasAccess };
  });

  // Phase 12d sub-step 4 — purchases substrate handler. One bodyless IO
  // leaf wrapping the raw SQL at core/actions/purchases.ts pre-port
  // (lines 119–128 of markPaymentStepPaidHandler) — an account-scoped
  // containment query for payment_step rows by purchaseId. Returns the
  // merged `{id, ...data}` shape per state.get_instance's convention so
  // the Fenel body reads `step.id` / `step.status` / `step.stepSlug`
  // uniformly without flatten side-channels.
  reg.registerIOHandler("state.list_payment_steps_by_purchase", async (params, ctx) => {
    const purchaseId = params["purchaseId"] as string | undefined;
    if (!purchaseId) return { action: "continue", value: [] };
    const { eq, and, sql } = await import("drizzle-orm");
    const { getDb, entityInstances } = await import("@fenel/db");
    const db = getDb();
    const rows = await db
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, ctx.accountId),
          eq(entityInstances.entityType, "payment_step"),
          sql`${entityInstances.data}->>'purchaseId' = ${purchaseId}`,
        ),
      );
    return {
      action: "continue",
      value: rows.map((r) => ({
        id: r.id,
        ...((r.data ?? {}) as Record<string, unknown>),
      })),
    };
  });

  // Phase 12d sub-step 6 — profiles substrate handler (1 of 2). Batch
  // profile lookup + sort. Replaces the N-query loop at pre-port
  // createOrMergeProfileHandler lines 332-349 with a single OR-of-pairs
  // SELECT over entity_instances filtered by entity_type='profile_handle'
  // + a single inArray fetch of matched profile rows + ORDER BY
  // createdAt asc. Decision B-deviation: returns List<Record> pre-sorted
  // rather than List<String> profileIds, because std:sort can't compare
  // Date keys (it String()-coerces non-numeric keys, mangling
  // chronological order). createdAt is serialised as ISO string for
  // safe round-trip. Substrate scopes by accountId (Decision O — fixes
  // pre-port's missing-accountId exists-check at lines 393-400).
  reg.registerIOHandler("state.find_profiles_by_handles", async (params, ctx) => {
    const handlePairs = params["handlePairs"] as Array<{
      platform?: string;
      handle?: string;
    }> | undefined;
    if (!handlePairs || handlePairs.length === 0) {
      return { action: "continue", value: [] };
    }
    const { eq, and, or, inArray, sql } = await import("drizzle-orm");
    const { getDb, entityInstances } = await import("@fenel/db");
    const db = getDb();
    const pairExprs = handlePairs
      .filter((p) => typeof p.platform === "string" && typeof p.handle === "string")
      .map(
        (p) =>
          sql`(${entityInstances.data}->>'platform' = ${p.platform} AND ${entityInstances.data}->>'handle' = ${p.handle})`,
      );
    if (pairExprs.length === 0) {
      return { action: "continue", value: [] };
    }
    const handleRows = await db
      .select({ data: entityInstances.data })
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, ctx.accountId),
          eq(entityInstances.entityType, "profile_handle"),
          or(...pairExprs),
        ),
      );
    const ids = new Set<string>();
    for (const r of handleRows) {
      const pid = (r.data as Record<string, unknown> | null)?.["profileId"];
      if (typeof pid === "string") ids.add(pid);
    }
    if (ids.size === 0) {
      return { action: "continue", value: [] };
    }
    const profileRows = await db
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, ctx.accountId),
          eq(entityInstances.entityType, "profile"),
          inArray(entityInstances.id, Array.from(ids)),
        ),
      );
    profileRows.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const value = profileRows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      ...((r.data ?? {}) as Record<string, unknown>),
    }));
    return { action: "continue", value };
  });

  // Phase 12d sub-step 6 — profiles substrate handler (2 of 2).
  // Multi-table in-tx cascade. Wraps the entire pre-port mergeProfilesHandler
  // db.transaction block (lines 189-297) as a single irreducible IO leaf.
  // Touches 6 tables atomically:
  //   - profile_handle: read source + read target + dedup-and-delete-or-rekey
  //   - entitlement / purchase / reservation: jsonb_set profileId rekey
  //   - profile: jsonb_set archivedAt
  //   - function_instances: typed UPDATE
  // The in-tx event emit is NOT included (Decision A — emit moves to
  // the body via state:appendEvent post-cascade). Returns
  // {movedHandles, success} for the body's event-payload composition.
  reg.registerIOHandler("state.cascade_profile_merge", async (params, ctx) => {
    const sourceProfileId = params["sourceProfileId"] as string | undefined;
    const targetProfileId = params["targetProfileId"] as string | undefined;
    const archivedAtIso = params["archivedAtIso"] as string | undefined;
    if (!sourceProfileId || !targetProfileId || !archivedAtIso) {
      throw new Error(
        "state.cascade_profile_merge: sourceProfileId, targetProfileId, archivedAtIso required",
      );
    }
    const { eq, and, sql } = await import("drizzle-orm");
    const { getDb, entityInstances, functionInstances } =
      await import("@fenel/db");
    const db = getDb();
    let movedHandles = 0;
    await db.transaction(async (tx) => {
      const sourceHandleRows = await tx
        .select()
        .from(entityInstances)
        .where(
          and(
            eq(entityInstances.accountId, ctx.accountId),
            eq(entityInstances.entityType, "profile_handle"),
            sql`${entityInstances.data}->>'profileId' = ${sourceProfileId}`,
          ),
        );
      const targetHandleRows = await tx
        .select()
        .from(entityInstances)
        .where(
          and(
            eq(entityInstances.accountId, ctx.accountId),
            eq(entityInstances.entityType, "profile_handle"),
            sql`${entityInstances.data}->>'profileId' = ${targetProfileId}`,
          ),
        );
      const targetHandleKeys = new Set(
        targetHandleRows.map((h) => {
          const d = h.data as Record<string, unknown>;
          return `${d["platform"]}:${d["handle"]}`;
        }),
      );
      for (const sh of sourceHandleRows) {
        const sd = sh.data as Record<string, unknown>;
        const key = `${sd["platform"]}:${sd["handle"]}`;
        if (targetHandleKeys.has(key)) {
          await tx.delete(entityInstances).where(eq(entityInstances.id, sh.id));
        } else {
          await tx.execute(sql`
            UPDATE entity_instances
            SET data = jsonb_set(data, '{profileId}', to_jsonb(${targetProfileId}::text), false)
            WHERE id = ${sh.id}
          `);
        }
      }
      movedHandles = sourceHandleRows.length;
      await tx.execute(sql`
        UPDATE entity_instances
        SET data = jsonb_set(data, '{profileId}', to_jsonb(${targetProfileId}::text), false)
        WHERE entity_type = 'entitlement'
          AND account_id = ${ctx.accountId}
          AND data->>'profileId' = ${sourceProfileId}
      `);
      await tx.execute(sql`
        UPDATE entity_instances
        SET data = jsonb_set(data, '{profileId}', to_jsonb(${targetProfileId}::text), false)
        WHERE entity_type = 'purchase'
          AND account_id = ${ctx.accountId}
          AND data->>'profileId' = ${sourceProfileId}
      `);
      // storage-as-effect Phase 4b — the form_submission profileId rewrite is
      // RETIRED. A submission is now an instance of its form's own type
      // (ContactMessage, migration 0081), and D2 dropped the envelope linkage
      // (no profileId is carried), so there is nothing for a profile merge to
      // re-point. The form_submission envelope concept exists nowhere.
      await tx
        .update(functionInstances)
        .set({ profileId: targetProfileId })
        .where(eq(functionInstances.profileId, sourceProfileId));
      await tx.execute(sql`
        UPDATE entity_instances
        SET data = jsonb_set(data, '{profileId}', to_jsonb(${targetProfileId}::text), false)
        WHERE entity_type = 'reservation'
          AND account_id = ${ctx.accountId}
          AND data->>'profileId' = ${sourceProfileId}
      `);
      await tx.execute(sql`
        UPDATE entity_instances
        SET data = jsonb_set(data, '{archivedAt}', to_jsonb(${archivedAtIso}::text), true)
        WHERE entity_type = 'profile'
          AND account_id = ${ctx.accountId}
          AND id = ${sourceProfileId}
      `);
    });
    return {
      action: "continue",
      value: { movedHandles, success: true },
    };
  });

  // -------------------------------------------------------------------------
  // ts-elimination-completion Phase 4.3 — dashboard profile-detail residual.
  // Four read leaves; accountId from ctx.
  // -------------------------------------------------------------------------
  reg.registerIOHandler("state.get_profile_entitlements", async (params, ctx) => {
    const profileId = params["profileId"] as string | undefined;
    if (!profileId) return { action: "continue", value: [] };
    const { getProfileEntitlements } = await import("@fenel/db");
    const rows = await getProfileEntitlements(ctx.accountId, profileId);
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.list_active_flows_by_profile", async (params, ctx) => {
    const profileId = params["profileId"] as string | undefined;
    if (!profileId) return { action: "continue", value: [] };
    // Verbatim copy of the inline activeFlows query from dashboard GET
    // /profiles/:id: in-flight statuses, projecting {id, functionId, status,
    // startedAt}.
    const { getDb, functionInstances } = await import("@fenel/db");
    const { and, eq, or } = await import("drizzle-orm");
    const rows = await getDb()
      .select({
        id: functionInstances.id,
        functionId: functionInstances.functionId,
        status: functionInstances.status,
        startedAt: functionInstances.startedAt,
      })
      .from(functionInstances)
      .where(
        and(
          eq(functionInstances.profileId, profileId),
          eq(functionInstances.accountId, ctx.accountId),
          or(
            eq(functionInstances.status, "running" as never),
            eq(functionInstances.status, "waiting_event" as never),
            eq(functionInstances.status, "waiting_timer" as never),
            eq(functionInstances.status, "awaiting_choice" as never),
          ),
        ),
      );
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.get_profile_functions", async (params, ctx) => {
    const profileId = params["profileId"] as string | undefined;
    if (!profileId) return { action: "continue", value: [] };
    const statusRaw = params["status"];
    let status: string | undefined;
    if (typeof statusRaw === "string") status = statusRaw;
    else if (statusRaw && typeof statusRaw === "object" && (statusRaw as { $tag?: unknown }).$tag === "Just") {
      const v = (statusRaw as { _0?: unknown })._0;
      if (typeof v === "string") status = v;
    }
    const { getProfileFunctions } = await import("@fenel/db");
    const rows = await getProfileFunctions(ctx.accountId, profileId, { status });
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.get_function_instances_by_fn", async (params, ctx) => {
    const functionId = params["functionId"] as string | undefined;
    if (!functionId) return { action: "continue", value: [] };
    const statusRaw = params["status"];
    let status: string | undefined;
    if (typeof statusRaw === "string") status = statusRaw;
    else if (statusRaw && typeof statusRaw === "object" && (statusRaw as { $tag?: unknown }).$tag === "Just") {
      const v = (statusRaw as { _0?: unknown })._0;
      if (typeof v === "string") status = v;
    }
    const limitRaw = params["limit"];
    const offsetRaw = params["offset"];
    const limit = typeof limitRaw === "number" ? limitRaw : undefined;
    const offset = typeof offsetRaw === "number" ? offsetRaw : undefined;
    const { getFunctionInstances } = await import("@fenel/db");
    const rows = await getFunctionInstances(ctx.accountId, functionId, { status, limit, offset });
    return { action: "continue", value: rows };
  });

  // -------------------------------------------------------------------------
  // ts-elimination-completion Phase 4.4 — events + purchases + channels + account.
  // -------------------------------------------------------------------------
  reg.registerIOHandler("state.list_events_recent", async (params, ctx) => {
    const limitRaw = params["limit"];
    const limit = typeof limitRaw === "number" && limitRaw > 0 ? limitRaw : 50;
    const { getDb, events } = await import("@fenel/db");
    const { eq, desc } = await import("drizzle-orm");
    const rows = await getDb()
      .select()
      .from(events)
      .where(eq(events.accountId, ctx.accountId))
      .orderBy(desc(events.createdAt))
      .limit(limit);
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.find_purchase_by_id", async (params, ctx) => {
    const purchaseId = params["purchaseId"] as string | undefined;
    if (!purchaseId) return { action: "continue", value: { $tag: "Nothing" } };
    const { findPurchaseById } = await import("@fenel/db");
    const row = await findPurchaseById(ctx.accountId, purchaseId);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.get_purchase_steps", async (params, ctx) => {
    const purchaseId = params["purchaseId"] as string | undefined;
    if (!purchaseId) return { action: "continue", value: [] };
    const { getPurchaseSteps } = await import("@fenel/db");
    const rows = await getPurchaseSteps(ctx.accountId, purchaseId);
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.find_plan_by_id", async (params, ctx) => {
    const planId = params["planId"] as string | undefined;
    if (!planId) return { action: "continue", value: { $tag: "Nothing" } };
    const { findPlanById } = await import("@fenel/db");
    const row = await findPlanById(ctx.accountId, planId);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  // ts-elimination-completion Phase 2b — repointed off the `channels` table
  // (collapsed into entity_instances by migration 0073) to entity_instances
  // entity_type='channel'. Envelope mapping {id, accountId, ...data,
  // createdAt, updatedAt} ≡ the legacy row {id, accountId, slug, type, config,
  // createdAt} plus updatedAt (additive — no consumer reads a missing key).
  reg.registerIOHandler("state.list_channels", async (_params, ctx) => {
    const { getDb, entityInstances } = await import("@fenel/db");
    const { eq, and, desc } = await import("drizzle-orm");
    const rows = await getDb()
      .select()
      .from(entityInstances)
      .where(
        and(
          eq(entityInstances.accountId, ctx.accountId),
          eq(entityInstances.entityType, "channel"),
        ),
      )
      .orderBy(desc(entityInstances.createdAt));
    return {
      action: "continue",
      value: (
        rows.map((r) => ({
          id: r.id,
          accountId: r.accountId,
          ...((r.data ?? {}) as Record<string, unknown>),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }))
      ),
    };
  });

  reg.registerIOHandler("state.get_account_by_id", async (_params, ctx) => {
    const { getDb, accounts } = await import("@fenel/db");
    const { eq } = await import("drizzle-orm");
    const [row] = await getDb()
      .select()
      .from(accounts)
      .where(eq(accounts.id, ctx.accountId))
      .limit(1);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.update_account", async (params, ctx) => {
    const patch = (params["patch"] ?? {}) as Record<string, unknown>;
    const { getDb, accounts } = await import("@fenel/db");
    const { eq } = await import("drizzle-orm");
    const [row] = await getDb()
      .update(accounts)
      .set(patch as never)
      .where(eq(accounts.id, ctx.accountId))
      .returning();
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  // -------------------------------------------------------------------------
  // FM-retire-4b Step 2 — the 3 forms READ handlers (state.list_form_definitions
  // / state.get_form_definition / state.list_form_submissions) RETIRED. The READ
  // lane went through the generic state.list_instances / state.get_instance
  // handlers (above). The WRITE handler state.store_form_submission is ALSO
  // RETIRED (forms-collapse Phase 4 Stage 3, ~line 2393), and storage-as-effect
  // Phase 4b retired the form_submission envelope concept entirely — the 12
  // legacy rows were migrated to instances of ContactMessage (migration 0081),
  // a submission is just an instance of its form's own type. form_submission
  // exists nowhere — data, reader, writer, or docs.
  // -------------------------------------------------------------------------
  // ts-elimination-completion Phase 4.6 — types / views / functions CRUD +
  // findProfileById. accountId from ctx.
  // -------------------------------------------------------------------------
  reg.registerIOHandler("state.upsert_type", async (params, ctx) => {
    const def = params["def"] as { name: string } & Record<string, unknown>;
    if (def["isSystem"] !== true) {
      const { saveFieldDefinitionBundle } = await import(
        "@fenel/core/field-definition-command"
      );
      const saved = await saveFieldDefinitionBundle(ctx.accountId, {
        ownerMutations: [{
          kind: "upsert",
          owner: {
            ownerKey: `type:${def.name}`,
            kind: "type",
            storageName: def.name,
            definition: { id: def.name, type: def["type"] as never },
          },
        }],
      });
      if (!saved.ok) throw new Error(saved.error.message);
      const { getType } = await import("@fenel/db");
      const row = await getType(ctx.accountId, def.name);
      if (!row) throw new Error("state.upsert_type: committed owner is unreadable");
      return { action: "continue", value: row };
    }
    const { upsertType } = await import("@fenel/db");
    const row = await upsertType(ctx.accountId, def);
    return { action: "continue", value: row };
  });

  reg.registerIOHandler("state.delete_type", async (params, ctx) => {
    const name = params["name"] as string | undefined;
    if (!name) return { action: "continue", value: null };
    const { saveFieldDefinitionBundle } = await import(
      "@fenel/core/field-definition-command"
    );
    const deleted = await saveFieldDefinitionBundle(ctx.accountId, {
      ownerMutations: [{
        kind: "delete",
        ownerKey: `type:${name}`,
        ownerKind: "type",
        storageName: name,
      }],
    });
    if (!deleted.ok) throw new Error(deleted.error.message);
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.list_views", async (_params, ctx) => {
    const { listViews } = await import("@fenel/db");
    const rows = await listViews(ctx.accountId);
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.get_view", async (params, ctx) => {
    const name = params["name"] as string | undefined;
    if (!name) return { action: "continue", value: { $tag: "Nothing" } };
    const { getView } = await import("@fenel/db");
    const row = await getView(ctx.accountId, name);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.upsert_view", async (params, ctx) => {
    const name = params["name"] as string | undefined;
    const view = (params["view"] ?? {}) as Record<string, unknown>;
    if (!name) throw new Error("state.upsert_view: name required");
    const { upsertView } = await import("@fenel/db");
    const row = await upsertView(ctx.accountId, { name, view });
    return { action: "continue", value: row };
  });

  reg.registerIOHandler("state.delete_view", async (params, ctx) => {
    const name = params["name"] as string | undefined;
    if (!name) return { action: "continue", value: null };
    const { deleteView } = await import("@fenel/db");
    await deleteView(ctx.accountId, name);
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.upsert_function", async (params, ctx) => {
    const name = params["name"] as string | undefined;
    const fn = (params["fn"] ?? {}) as Record<string, unknown>;
    if (!name) throw new Error("state.upsert_function: name required");
    const { name: _legacyFunctionName, ...functionDefinition } = fn;
    const { saveFieldDefinitionBundle } = await import(
      "@fenel/core/field-definition-command"
    );
    const saved = await saveFieldDefinitionBundle(ctx.accountId, {
      ownerMutations: [{
        kind: "upsert",
        owner: {
          ownerKey: `function:${name}`,
          kind: "function",
          storageName: name,
          definition: { ...functionDefinition, id: name } as FenelFunction,
        },
      }],
    });
    if (!saved.ok) throw new Error(saved.error.message);
    const { getFunction } = await import("@fenel/db");
    const row = await getFunction(ctx.accountId, name);
    if (!row) throw new Error("state.upsert_function: committed owner is unreadable");
    return { action: "continue", value: row };
  });

  reg.registerIOHandler("state.set_function_active", async (params, ctx) => {
    const functionId = params["functionId"];
    const active = params["active"];
    if (typeof functionId !== "string" || typeof active !== "boolean") {
      throw new Error("state.set_function_active: functionId and active are required");
    }
    const { setFunctionActive } = await import("@fenel/db");
    const row = await setFunctionActive(ctx.accountId, functionId, active);
    return { action: "continue", value: row ? { $tag: "Just", _0: { id: row.id, active: row.active } } : { $tag: "Nothing" } };
  });

  reg.registerIOHandler("state.delete_function", async (params, ctx) => {
    const name = params["name"] as string | undefined;
    if (!name) return { action: "continue", value: null };
    const { saveFieldDefinitionBundle } = await import(
      "@fenel/core/field-definition-command"
    );
    const deleted = await saveFieldDefinitionBundle(ctx.accountId, {
      ownerMutations: [{
        kind: "delete",
        ownerKey: `function:${name}`,
        ownerKind: "function",
        storageName: name,
      }],
    });
    if (!deleted.ok) throw new Error(deleted.error.message);
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.delete_function_by_id", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: false };
    // Resolve the current user owner by its storage-row id, then route the
    // deletion through the same Fenel bundle planner as every other function
    // writer. Historical/inactive/system rows are not current account owners.
    const { getDb, functions } = await import("@fenel/db");
    const { and, eq } = await import("drizzle-orm");
    const [existing] = await getDb()
      .select({
        id: functions.id,
        name: functions.name,
        active: functions.active,
        isSystem: functions.isSystem,
      })
      .from(functions)
      .where(and(eq(functions.id, id), eq(functions.accountId, ctx.accountId)))
      .limit(1);
    if (!existing || !existing.active || existing.isSystem) {
      return { action: "continue", value: false };
    }
    const { saveFieldDefinitionBundle } = await import(
      "@fenel/core/field-definition-command"
    );
    const deleted = await saveFieldDefinitionBundle(ctx.accountId, {
      ownerMutations: [{
        kind: "delete",
        ownerKey: `function:${existing.name}`,
        ownerKind: "function",
        storageName: existing.name,
      }],
    });
    if (!deleted.ok) throw new Error(deleted.error.message);
    return { action: "continue", value: true };
  });

  reg.registerIOHandler("state.find_profile_by_id", async (params, ctx) => {
    const profileId = params["profileId"] as string | undefined;
    if (!profileId) return { action: "continue", value: { $tag: "Nothing" } };
    const { findProfileById } = await import("@fenel/db");
    const row = await findProfileById(ctx.accountId, profileId);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  // -------------------------------------------------------------------------
  // ts-elimination-completion Phase 4.7 — function-instances (by account) +
  // integrations CRUD + pages CRUD.
  // -------------------------------------------------------------------------
  reg.registerIOHandler("state.list_function_instances_by_account", async (params, ctx) => {
    const statusRaw = params["status"];
    let status: string | undefined;
    if (typeof statusRaw === "string") status = statusRaw;
    else if (statusRaw && typeof statusRaw === "object" && (statusRaw as { $tag?: unknown }).$tag === "Just") {
      const v = (statusRaw as { _0?: unknown })._0;
      if (typeof v === "string") status = v;
    }
    const { getDb, functionInstances } = await import("@fenel/db");
    const { and, eq, desc } = await import("drizzle-orm");
    const conditions = [eq(functionInstances.accountId, ctx.accountId)];
    if (status) conditions.push(eq(functionInstances.status, status as never));
    const rows = await getDb()
      .select()
      .from(functionInstances)
      .where(and(...conditions))
      .orderBy(desc(functionInstances.startedAt))
      .limit(100);
    return { action: "continue", value: rows.map(decodeCheckpointRow) };
  });

  reg.registerIOHandler("state.list_integrations", async (_params, ctx) => {
    const { getDb, integrations } = await import("@fenel/db");
    const { eq, desc } = await import("drizzle-orm");
    const rows = await getDb()
      .select()
      .from(integrations)
      .where(eq(integrations.accountId, ctx.accountId))
      .orderBy(desc(integrations.createdAt));
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.upsert_integration", async (params, ctx) => {
    const data = (params["data"] ?? {}) as {
      type?: unknown; label?: unknown; credentials?: unknown; config?: unknown;
    };
    const { getDb, integrations } = await import("@fenel/db");
    const [row] = await getDb()
      .insert(integrations)
      .values({
        accountId: ctx.accountId,
        type: data.type as never,
        label: (data.label as string | null | undefined) ?? null,
        credentials: data.credentials as Record<string, unknown>,
        config: (data.config as Record<string, unknown> | undefined) ?? {},
      })
      .onConflictDoUpdate({
        target: [integrations.accountId, integrations.type],
        set: {
          label: (data.label as string | null | undefined) ?? null,
          credentials: data.credentials as Record<string, unknown>,
          config: (data.config as Record<string, unknown> | undefined) ?? {},
          updatedAt: new Date(),
        },
      })
      .returning();
    return { action: "continue", value: row };
  });

  // rights R4a C1a §0.5 — THE SIGNATURE IS THE ALLOWLIST, and C0b's TypeScript
  // filter is deleted here because the forgery is no longer representable.
  //
  // What was here before C0b: `.set({ ...patch, updatedAt: new Date() } as never)`.
  // The `where` clause constrains the row that is FOUND; the spread decided what
  // was WRITTEN. So a member or a viewer holding an integration in account A
  // performed `state:updateIntegration { id, patch: { accountId: B } }` and the
  // real Drizzle builder generated
  //     UPDATE integrations SET account_id = B WHERE id = … AND account_id = A
  // — an ordinary product edit moving a grant row, and its known secret, into
  // another account. The `as never` cast is what let it through.
  //
  // The root cause was a Fenel-first violation, not a TypeScript bug: the native
  // was declared `(id: String) -> (patch: { }) -> Maybe ({ })`, and a
  // declared-empty record is what `CLAUDE.md` names outright as a lie. An
  // undeclared blob parameter is what a raw spread is FOR. Now each mutable
  // column is a DECLARED PARAMETER — `id`, `type`, `accountId` and `createdAt`
  // are not things a caller can name, so the handler reads exactly what the
  // signature promises and there is nothing to filter.
  reg.registerIOHandler("state.update_integration", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: { $tag: "Nothing" } };
    const { getDb, integrations } = await import("@fenel/db");
    const { and, eq } = await import("drizzle-orm");
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    // Each declared `Maybe` parameter: `Just x` writes, `Nothing` or absent
    // leaves the column alone. Anything else THROWS rather than being read as
    // absence — a mis-marshalled caller must be loud, because silently treating
    // a malformed value as "unchanged" turns a bug into a dropped update.
    for (const column of ["label", "credentials", "config", "status", "enabled"] as const) {
      const supplied = maybeArgument(params[column], `state.update_integration.${column}`);
      if (supplied.present) updates[column] = supplied.value;
    }
    const [row] = await getDb()
      .update(integrations)
      .set(updates)
      .where(and(eq(integrations.id, id), eq(integrations.accountId, ctx.accountId)))
      .returning();
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.delete_integration", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: null };
    const { getDb, integrations } = await import("@fenel/db");
    const { and, eq } = await import("drizzle-orm");
    await getDb()
      .delete(integrations)
      .where(and(eq(integrations.id, id), eq(integrations.accountId, ctx.accountId)));
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.list_pages", async (_params, ctx) => {
    const { listPages } = await import("@fenel/db");
    const rows = await listPages(ctx.accountId);
    return { action: "continue", value: rows };
  });

  reg.registerIOHandler("state.get_page_by_id", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: { $tag: "Nothing" } };
    const { getPage } = await import("@fenel/db");
    const row = await getPage(ctx.accountId, id);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.create_page", async (params, ctx) => {
    const data = (params["data"] ?? {}) as {
      slug: string; name: string; blocks: never[]; config?: Record<string, unknown>; published?: boolean;
    };
    const { createPage } = await import("@fenel/db");
    const row = await createPage(ctx.accountId, data);
    return { action: "continue", value: row };
  });

  reg.registerIOHandler("state.update_page", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: { $tag: "Nothing" } };
    const data = (params["data"] ?? {}) as Record<string, unknown>;
    const { updatePage } = await import("@fenel/db");
    const row = await updatePage(ctx.accountId, id, data);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.delete_page", async (params, ctx) => {
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: null };
    const { deletePage } = await import("@fenel/db");
    await deletePage(ctx.accountId, id);
    return { action: "continue", value: null };
  });

  // Phase 12c-core sub-step 3 — auth substrate handlers. 9 state:* IO
  // leaves wrapping the @fenel/db session / user / membership helpers.
  // Each Maybe-wraps null returns from the DB query; nullable inputs
  // (label / expiresAt / hash) come in as Maybe-tagged and unwrap at the
  // handler boundary.
  //
  // rights R1 — THE PRIVILEGED REALM BOUNDARY LIVES HERE, NOT AT THE
  // FUNCTION NAME.
  //
  // Eight of these nine are the identity primitives: they mint sessions, set
  // password hashes, create memberships, and return password hashes into
  // Fenel. `auth:issueSession` is nothing but `randomTokenHex` + `sha256Hex`
  // + `createSession` — NOTHING in it lives in the auth module — so fencing
  // the auth module would leave an ordinary account body free to call
  // `createSession victimUserId victimAccountId (sha256Hex "mine")` and hold
  // a working session with no `auth:` name anywhere. Two further doors reach
  // the same place: `executeInstance` runs the SEEDED `functions` row rather
  // than the registry, and a member can attach a trigger to any seeded name.
  //
  // So the boundary is the leaf, and the gate is one bit on the IO context
  // that only `invokeIOActionPrivileged` mints. `get_membership` is
  // deliberately NOT fenced — reading whether a membership exists is an
  // ordinary authorization input, not an identity mutation.
  //
  // Brief: `workstreams/rights/briefs/r1-containment-ii.md` §4.2. R2 replaces
  // this bit with the opaque `AuthorityRef`.
  // rights R2a — THE FENCED SET IS ONE LIST, and it is READ, not retyped. It
  // used to be eight string literals here that merely coincided with
  // `authority:sessionLeafDescriptors`; every role envelope excludes that Fenel
  // list, so a leaf added to one side and not the other would be fenced by
  // exactly one of the two mechanisms, silently. Reading it makes the
  // coincidence a dependency.
  //
  // rights R2b P0.5 — AND THE CHECK IS NOW BIDIRECTIONAL AND REGISTRATION-TIME.
  // R2a's version asked one question at CALL time — "is this leaf in the list?"
  // — which catches a leaf fenced here and dropped from the list, and is BLIND
  // to the opposite drift: a name in the list that nothing fences. That
  // direction is the dangerous one, because the list is also what the member
  // envelope excludes, so a name that only the list carries is advertised as
  // fenced by two mechanisms and enforced by neither. Asserting SET EQUALITY at
  // registration closes both, before a single request runs.
  //
  // rights R2b — ONE SPELLING on both sides. `authority:sessionLeafDescriptors`
  // carries canonical function ids only, because `listPerformDescriptors` now
  // publishes one name per act. The fence is declared as PAIRS so the dotted
  // handler name and the canonical id stay one fact; only the canonical half is
  // compared.
  assertFencedLeavesMatch(
    GUARDED_IDENTITY_LEAVES.map((leaf) => leaf.id),
    reg.evaluateAuthorityFunction(IDENTITY_LEAF_LIST_ID, [0]) as string[],
    IDENTITY_LEAF_LIST_ID,
  );
  const guardedActions = new Set(GUARDED_IDENTITY_LEAVES.map((leaf) => leaf.action));
  const requirePrivilegedRealm = (leaf: string, ctx: IOHandlerContext): void => {
    // ⚠ THE CALL-TIME MEMBERSHIP CHECK IS KEPT, and the registration-time
    // set-equality above does NOT subsume it. That one compares two LISTS —
    // `GUARDED_IDENTITY_LEAVES` against the Fenel policy — and nothing ties
    // either to the seven `requirePrivilegedRealm("…")` CALL SITES. A leaf
    // fenced here but absent from the array would pass registration, be granted
    // by the owner envelope, and then throw the realm refusal for a caller the
    // gate deliberately permitted: R1's outage shape, green pins, production
    // down. R2a's version asked exactly this question and it is the direction
    // the list-vs-list check cannot see.
    if (!guardedActions.has(leaf)) {
      throw new Error(
        `${leaf}: is fenced here but absent from GUARDED_IDENTITY_LEAVES — the `
        + "fence, the array and authority:sessionLeafDescriptors must name one set (rights R2b)",
      );
    }
    if (ctx.realm !== "privileged") {
      throw new Error(
        `${leaf}: refused — identity leaves require the privileged execution realm. ` +
          `Ordinary account code cannot mint sessions, memberships or password hashes.`,
      );
    }
  };
  reg.registerIOHandler("state:ensurePersonalAccount", async (params, ctx) => {
    requirePrivilegedRealm("state:ensurePersonalAccount", ctx);
    const { ensurePersonalAccount } = await import("@fenel/db");
    const userId = params["userId"] as string;
    const value = await ensurePersonalAccount(userId, (snapshot) => personalIdentityRule<PersonalIdentityDecision<PersonalAccountPlan>>(
      "auth:planPersonalAccount", [userId, params.candidateAccount, params.candidateMembership, snapshot],
    ));
    return { action: "continue", value };
  });
  // This bodyless declaration has no legacy IOInvokable annotation. Both
  // optional source-name projections re-enter its single canonical act.
  reg.aliasIOHandler("state.ensurePersonalAccount", "state:ensurePersonalAccount");
  reg.aliasIOHandler("ensurePersonalAccount", "state:ensurePersonalAccount");
  reg.registerIOHandler("state.create_session", async (params, ctx) => {
    requirePrivilegedRealm("state.create_session", ctx);
    const userId = params["userId"] as string | undefined;
    const accountId = params["accountId"] as string | undefined;
    const tokenHash = params["tokenHash"] as string | undefined;
    if (!userId || !accountId || !tokenHash) {
      throw new Error("state.create_session: userId, accountId, tokenHash required");
    }
    const labelMaybe = params["label"] as
      | { $tag: "Just"; _0: string }
      | { $tag: "Nothing" }
      | undefined;
    const label =
      labelMaybe && labelMaybe.$tag === "Just" ? labelMaybe._0 : null;
    const expiresAtMaybe = params["expiresAt"] as
      | { $tag: "Just"; _0: string }
      | { $tag: "Nothing" }
      | undefined;
    const expiresAt =
      expiresAtMaybe && expiresAtMaybe.$tag === "Just"
        ? new Date(expiresAtMaybe._0)
        : null;
    const { createSession } = await import("@fenel/db");
    const row = await createSession({
      userId,
      accountId,
      tokenHash,
      label,
      expiresAt,
    });
    return { action: "continue", value: row };
  });

  reg.registerIOHandler("state.get_session_by_hash", async (params, ctx) => {
    requirePrivilegedRealm("state.get_session_by_hash", ctx);
    const tokenHash = params["tokenHash"] as string | undefined;
    if (!tokenHash) {
      return { action: "continue", value: { $tag: "Nothing" } };
    }
    const { getSessionByHash } = await import("@fenel/db");
    const row = await getSessionByHash(tokenHash);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    // `expiresAt` crosses as `Maybe String` (ISO), never a raw null or a host
    // Date: `auth:switchAccount` re-issues with it and derives the cookie's
    // Max-Age from it.
    const expiresAt = row.expiresAt instanceof Date
      ? { $tag: "Just", _0: row.expiresAt.toISOString() } : { $tag: "Nothing" };
    const name = row.name == null ? Nothing : Just(row.name);
    return { action: "continue", value: Just({ ...row, expiresAt, name }) };
  });

  reg.registerIOHandler("state.touch_session", async (params, ctx) => {
    requirePrivilegedRealm("state.touch_session", ctx);
    const id = params["id"] as string | undefined;
    if (!id) return { action: "continue", value: null };
    // Decision D — swallow errors at the handler boundary so the Fenel
    // body stays catch-free. resolveToken fire-and-forgets; a failed
    // last-used bump must not reject the token.
    try {
      const { touchSession } = await import("@fenel/db");
      await touchSession(id);
    } catch (err) {
      console.warn("[auth] state.touch_session failed:", err);
    }
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.list_user_memberships", async (params, ctx) => {
    requirePrivilegedRealm("state.list_user_memberships", ctx);
    const userId = params["userId"] as string | undefined;
    if (!userId) return { action: "continue", value: [] };
    const { listUserAccountRoots } = await import("@fenel/db");
    return { action: "continue", value: await listUserAccountRoots(userId) };
  });

  reg.registerIOHandler("state.delete_session_by_hash", async (params, ctx) => {
    requirePrivilegedRealm("state.delete_session_by_hash", ctx);
    const tokenHash = params["tokenHash"] as string | undefined;
    if (!tokenHash) return { action: "continue", value: null };
    const { deleteSessionByHash } = await import("@fenel/db");
    await deleteSessionByHash(tokenHash);
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.get_user_by_email", async (params, ctx) => {
    requirePrivilegedRealm("state.get_user_by_email", ctx);
    const email = params["email"] as string | undefined;
    if (!email) return { action: "continue", value: { $tag: "Nothing" } };
    const { getUserByEmail } = await import("@fenel/db");
    const row = await getUserByEmail(email);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    // System identity linkage belongs only to the personal-context door, not
    // the existing user value (and its nullable DB slot is not a Fenel null).
    const { personalAccountId: _personalAccountId, ...identity } = row;
    // Maybe-wrap passwordHash so the Fenel body's `case user.passwordHash
    // of Just _ -> verify | Nothing -> deny` works without a TS bridge.
    const lifted = {
      ...identity,
      passwordHash:
        row.passwordHash === null || row.passwordHash === undefined
          ? { $tag: "Nothing" }
          : { $tag: "Just", _0: row.passwordHash },
    };
    return { action: "continue", value: { $tag: "Just", _0: lifted } };
  });

  reg.registerIOHandler("state.get_or_create_user_by_email", async (params, ctx) => {
    requirePrivilegedRealm("state.get_or_create_user_by_email", ctx);
    const email = params["email"] as string | undefined;
    if (!email) {
      throw new Error("state.get_or_create_user_by_email: email required");
    }
    const nameMaybe = params["name"] as
      | { $tag: "Just"; _0: string }
      | { $tag: "Nothing" }
      | undefined;
    const name = nameMaybe && nameMaybe.$tag === "Just" ? nameMaybe._0 : null;
    const { getOrCreateUserByEmail } = await import("@fenel/db");
    const row = await getOrCreateUserByEmail({ email, name });
    const { personalAccountId: _personalAccountId, ...identity } = row;
    return { action: "continue", value: identity };
  });

  reg.registerIOHandler("state.get_membership", async (params) => {
    const userId = params["userId"] as string | undefined;
    const accountId = params["accountId"] as string | undefined;
    if (!userId || !accountId) {
      return { action: "continue", value: { $tag: "Nothing" } };
    }
    const { getMembership } = await import("@fenel/db");
    const row = await getMembership(userId, accountId);
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  // rights R2b — NO REALM GUARD. This is the act that introduces authority, and
  // an account owner legitimately performs it; the owner envelope names it and
  // argues it on the account and the role, which is a fence the owner can pass
  // and a member cannot. `role` arrives as a STRING because a FieldAxis judges
  // a scalar own entry and a `Maybe` payload is an object the host `elem`
  // matches by reference; `auth:createMembershipForRole` resolves the default.
  reg.registerIOHandler("state.create_membership", async (params) => {
    const userId = params["userId"] as string | undefined;
    const accountId = params["accountId"] as string | undefined;
    const role = params["role"] as string | undefined;
    if (!userId || !accountId || !role) {
      throw new Error("state.create_membership: userId, accountId, role required");
    }
    const { createMembership } = await import("@fenel/db");
    const row = await createMembership({ userId, accountId, role }, (snapshot) =>
      personalIdentityRule<PersonalIdentityDecision<boolean>>("auth:personalMembershipDecision", [snapshot]));
    return { action: "continue", value: row };
  });

  // rights R2b — the two membership WRITES the owner envelope adds, and the
  // roster READ every role holds. Each is one irreducible query; the last-owner
  // rule lives in `auth:changeMemberRole` / `auth:removeMember`, because it is a
  // question about the current population rather than about the argued act.
  reg.registerIOHandler("state.set_membership_role", async (params) => {
    const userId = params["userId"] as string | undefined;
    const accountId = params["accountId"] as string | undefined;
    const role = params["role"] as string | undefined;
    if (!userId || !accountId || !role) {
      throw new Error("state.set_membership_role: userId, accountId, role required");
    }
    const { setMembershipRole } = await import("@fenel/db");
    const row = await setMembershipRole(userId, accountId, role, (snapshot) =>
      personalIdentityRule<PersonalIdentityDecision<boolean>>("auth:personalMembershipDecision", [snapshot]));
    if (!row) return { action: "continue", value: { $tag: "Nothing" } };
    return { action: "continue", value: { $tag: "Just", _0: row } };
  });

  reg.registerIOHandler("state.delete_membership", async (params) => {
    const userId = params["userId"] as string | undefined;
    const accountId = params["accountId"] as string | undefined;
    if (!userId || !accountId) {
      throw new Error("state.delete_membership: userId, accountId required");
    }
    const { deleteMembership } = await import("@fenel/db");
    await deleteMembership(userId, accountId, (snapshot) =>
      personalIdentityRule<PersonalIdentityDecision<boolean>>("auth:personalMembershipDecision", [snapshot]));
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.list_account_members", async (params) => {
    const accountId = params["accountId"] as string | undefined;
    if (!accountId) {
      throw new Error("state.list_account_members: accountId required");
    }
    const { listAccountMembers } = await import("@fenel/db");
    return { action: "continue", value: await listAccountMembers(accountId) };
  });

  reg.registerIOHandler("state.set_user_password_hash", async (params, ctx) => {
    requirePrivilegedRealm("state.set_user_password_hash", ctx);
    const userId = params["userId"] as string | undefined;
    if (!userId) {
      throw new Error("state.set_user_password_hash: userId required");
    }
    const hashMaybe = params["hash"] as
      | { $tag: "Just"; _0: string }
      | { $tag: "Nothing" }
      | undefined;
    const hash = hashMaybe && hashMaybe.$tag === "Just" ? hashMaybe._0 : null;
    const { setUserPasswordHash } = await import("@fenel/db");
    await setUserPasswordHash(userId, hash);
    return { action: "continue", value: null };
  });

  reg.registerIOHandler("state.pin_to_view", async (params, ctx) => {
    const value = params["value"];
    const caption = typeof params["caption"] === "string" ? params["caption"] : undefined;
    const { appendValueToLocusRoot } = await import("@fenel/db");
    await appendValueToLocusRoot(ctx.accountId, value, caption);
    return { action: "continue", value: null };
  });
}
