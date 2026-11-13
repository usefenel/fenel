// ---------------------------------------------------------------------------
// Storage — FFI leaves.
//
// The declarative StorageHandler surface lives in ../types.fenel and
// ../instances.fenel. This file contains only the irreducible host storage
// operations behind those descriptors: Postgres calls, the process-local
// memory store, and reads from the bundled reference register.
// ---------------------------------------------------------------------------

import {
  dispatchRegistry,
  referenceTypeByCodeName,
} from "../../../../implementations/typescript/engine/src/index";
import { getSystemRegistry } from "../../../../implementations/typescript/engine/src/system-registry";
import { systemEntities } from "../../../../implementations/typescript/engine/src/system-entities";
import { invokeCallable } from "../../../../implementations/typescript/engine/src/json-logic";
import { Ref } from "../../../../implementations/typescript/engine/src/type-foundation";
import { GLOBAL_ONLY, instanceVisible } from "../../../../implementations/typescript/engine/src/dispatch-registry";
import { wrapJsonValue } from "../../codec/ffi/codec-ffi";
import {
  appendEvent as dbAppendEvent,
  createEntityInstance,
  deleteEntityInstance,
  getEntityInstance,
  getType,
  getTypeById,
  listEntityInstances,
  updateEntityInstance,
} from "../../../../implementations/typescript/db/src/index";

/** Persisted entity-instance envelope returned by storage reads. */
export type StoredRow = {
  id: string;
  accountId: string;
  entityType: string;
  data: Record<string, unknown>;
  dataEncoding?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Registered type-definition row returned by loadType/loadTypeByName. */
export type StoredType = {
  name: string;
  type: unknown;
  [key: string]: unknown;
};

/** Append-event payload shared by the Db and Memory leaves. */
export type StorageEventInput = {
  accountId: string;
  type: string;
  payload?: Record<string, unknown>;
  aggregateType?: string;
  aggregateId?: string;
  profileId?: string;
};

/** Canonical Fenel value shape for semantic optionality at the FFI boundary. */
type StorageMaybe<T> =
  | { readonly $tag: "Just"; readonly _0: T }
  | { readonly $tag: "Nothing" };

type StorageDescriptorEventInput = {
  accountId: string;
  type: string;
  payload: StorageMaybe<Record<string, unknown>>;
  aggregateType: StorageMaybe<string>;
  aggregateId: StorageMaybe<string>;
  profileId: StorageMaybe<string>;
};

/** Typed language-level argument tuples for StorageHandler methods. */
export type StorageMethodArgs = {
  store: readonly [
    accountId: string,
    entityType: string,
    data: Record<string, unknown>,
    id: string,
  ];
  load: readonly [accountId: string, instanceId: string];
  update: readonly [
    accountId: string,
    instanceId: string,
    data: Record<string, unknown>,
  ];
  delete: readonly [accountId: string, instanceId: string];
  list: readonly [
    accountId: string,
    entityType: string,
    limit?: number,
    where?: Record<string, unknown>,
  ];
  appendEvent: readonly [event: StorageEventInput];
  loadType: readonly [accountId: string, typeId: string];
  loadTypeByName: readonly [accountId: string, name: string];
};

/** Resolved result value for each StorageHandler method. */
export type StorageMethodResult = {
  store: { id: string };
  load: StoredRow | null;
  update: StoredRow | null;
  delete: void;
  list: StoredRow[];
  appendEvent: void;
  loadType: StoredType | null;
  loadTypeByName: StoredType | null;
};

export type StorageMethod = keyof StorageMethodArgs;

// ---------------------------------------------------------------------------
// Db leaves — the existing @fenel/db operations, with no routing decisions.
// ---------------------------------------------------------------------------

async function dbStoreNative(
  accountId: string,
  entityType: string,
  data: Record<string, unknown>,
  id: string,
): Promise<{ id: string }> {
  const created = await createEntityInstance(accountId, entityType, data, id);
  return { id: created.id };
}

async function dbLoadNative(
  accountId: string,
  instanceId: string,
): Promise<StoredRow | null> {
  return (await getEntityInstance(accountId, instanceId)) as StoredRow | null;
}

async function dbUpdateNative(
  accountId: string,
  instanceId: string,
  data: Record<string, unknown>,
): Promise<StoredRow | null> {
  return (await updateEntityInstance(accountId, instanceId, data)) as StoredRow | null;
}

async function dbDeleteNative(accountId: string, instanceId: string): Promise<void> {
  await deleteEntityInstance(accountId, instanceId);
}

async function dbListNative(
  accountId: string,
  entityType: string,
  limit?: number,
  where?: Record<string, unknown>,
): Promise<StoredRow[]> {
  return (await listEntityInstances(accountId, entityType, limit, where)) as StoredRow[];
}

async function dbAppendEventNative(event: StorageEventInput): Promise<void> {
  await dbAppendEvent({
    accountId: event.accountId,
    type: event.type,
    payload: event.payload ?? {},
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    profileId: event.profileId,
  });
}

async function dbLoadTypeNative(
  accountId: string,
  typeId: string,
): Promise<StoredType | null> {
  return (await getTypeById(accountId, typeId)) as StoredType | null;
}

async function dbLoadTypeByNameNative(
  accountId: string,
  name: string,
): Promise<StoredType | null> {
  return (await getType(accountId, name)) as StoredType | null;
}

// ---------------------------------------------------------------------------
// Memory leaves — one process-local store, preserving the previous singleton
// backend semantics while removing the callable backend dictionary.
// ---------------------------------------------------------------------------

const memoryRows = new Map<string, Map<string, StoredRow>>();
const memoryEventLog: StorageEventInput[] = [];

function memoryAccountRows(accountId: string): Map<string, StoredRow> {
  let rows = memoryRows.get(accountId);
  if (rows === undefined) {
    rows = new Map();
    memoryRows.set(accountId, rows);
  }
  return rows;
}

/** Host JSON bridge; the containment policy is authored in the storage module. */
function containmentMatch(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  const registry = getSystemRegistry();
  const result = invokeCallable(
    Ref("storage:jsonContains"),
    [wrapJsonValue(row), wrapJsonValue(where)],
    registry.evaluateContext(),
  );
  if (typeof result !== "boolean") {
    throw new TypeError("storage:jsonContains: expected a Boolean result");
  }
  return result;
}

/** Resolve a system/module type from the process-local type catalog. */
function memoryTypeByName(name: string): StoredType | null {
  for (const entity of systemEntities) {
    if (entity.id === name && entity.type) return { name, type: entity.type };
  }
  const moduleEntity = getSystemRegistry().getEntity(name);
  return moduleEntity === undefined ? null : { name, type: moduleEntity.type };
}

async function memoryStoreNative(
  accountId: string,
  entityType: string,
  data: Record<string, unknown>,
  id: string,
): Promise<{ id: string }> {
  for (const rows of memoryRows.values()) {
    if (rows.has(id)) throw new Error(`Entity instance already exists: ${id}`);
  }
  const now = new Date();
  memoryAccountRows(accountId).set(id, {
    id,
    accountId,
    entityType,
    data: structuredClone(data),
    dataEncoding: null,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

async function memoryLoadNative(
  accountId: string,
  instanceId: string,
): Promise<StoredRow | null> {
  const row = memoryAccountRows(accountId).get(instanceId);
  return row === undefined ? null : structuredClone(row);
}

async function memoryUpdateNative(
  accountId: string,
  instanceId: string,
  data: Record<string, unknown>,
): Promise<StoredRow | null> {
  const rows = memoryAccountRows(accountId);
  const existing = rows.get(instanceId);
  if (existing === undefined) return null;
  const next: StoredRow = {
    ...existing,
    data: structuredClone(data),
    dataEncoding: null,
    updatedAt: new Date(),
  };
  rows.set(instanceId, next);
  return structuredClone(next);
}

async function memoryDeleteNative(accountId: string, instanceId: string): Promise<void> {
  memoryAccountRows(accountId).delete(instanceId);
}

async function memoryListNative(
  accountId: string,
  entityType: string,
  limit?: number,
  where?: Record<string, unknown>,
): Promise<StoredRow[]> {
  let rows = Array.from(memoryAccountRows(accountId).values()).filter(
    (row) => row.entityType === entityType,
  );
  if (where !== undefined && Object.keys(where).length > 0) {
    rows = rows.filter((row) => containmentMatch(row.data, where));
  }
  if (limit) rows = rows.slice(0, limit);
  return rows.map((row) => structuredClone(row));
}

async function memoryAppendEventNative(event: StorageEventInput): Promise<void> {
  memoryEventLog.push(JSON.parse(JSON.stringify({ ...event, payload: event.payload ?? {} })));
}

async function memoryLoadTypeNative(
  _accountId: string,
  typeId: string,
): Promise<StoredType | null> {
  return memoryTypeByName(typeId);
}

async function memoryLoadTypeByNameNative(
  _accountId: string,
  name: string,
): Promise<StoredType | null> {
  return memoryTypeByName(name);
}

// ---------------------------------------------------------------------------
// Bundle leaves — the read-only bundled reference register.
// ---------------------------------------------------------------------------

const BUNDLE_READ_ONLY =
  "StorageHandler Bundle is read-only — reference data is bundled, not user-written";
const BUNDLE_EPOCH = new Date(0);

// ⚠ rights R3a — BOTH ARE `GLOBAL_ONLY`, AND THE POSITIONAL `accountId` MUST
// NOT BE USED (§12 trap 15). These are PLAIN natives: the storage seam registers
// them in `nativeImpls`, the plain perform wrapper is `(_frame, args) =>
// implementation(...args)`, and `dbStoreNative` is positional — so there is no
// frame here to derive an account from, and the `accountId` that IS in scope is
// the argued partition of the READ, not the owner of the rows. Using it would
// mix boot reference rows with account-owned instances of the same type.
//
// The honest fence is the right one on its own terms: `Bundle` is BUNDLED
// REFERENCE DATA (Currency, Country, …) shipped with the repository.
function bundleRefId(typeName: string): string {
  const methods = dispatchRegistry.resolve(typeName, "Referenceable", GLOBAL_ONLY);
  return (methods?.["refId"] as string | undefined) ?? "code";
}

function bundleRowsOf(typeName: string): Record<string, unknown>[] {
  return dispatchRegistry
    .listInstances(typeName)
    .filter((instance) => instanceVisible(instance, GLOBAL_ONLY))
    .map((instance) => instance.methods as Record<string, unknown>);
}

function bundleRow(
  accountId: string,
  entityType: string,
  row: Record<string, unknown>,
  refId: string,
): StoredRow {
  return {
    id: String(row[refId] ?? row["code"] ?? row["id"] ?? ""),
    accountId,
    entityType,
    data: row,
    createdAt: BUNDLE_EPOCH,
    updatedAt: BUNDLE_EPOCH,
  };
}

/** True when typeName is backed by the loader-derived reference register. */
export function isReferenceType(typeName: string): boolean {
  for (const candidate of referenceTypeByCodeName().values()) {
    if (candidate === typeName) return true;
  }
  return false;
}

function rejectBundleWrite(): never {
  throw new Error(BUNDLE_READ_ONLY);
}

async function bundleStoreNative(
  _accountId: string,
  _entityType: string,
  _data: Record<string, unknown>,
  _id: string,
): Promise<{ id: string }> {
  return rejectBundleWrite();
}

async function bundleLoadNative(
  accountId: string,
  instanceId: string,
): Promise<StoredRow | null> {
  for (const typeName of new Set(referenceTypeByCodeName().values())) {
    const refId = bundleRefId(typeName);
    for (const row of bundleRowsOf(typeName)) {
      if (String(row[refId]) === instanceId) {
        return bundleRow(accountId, typeName, row, refId);
      }
    }
  }
  return null;
}

async function bundleUpdateNative(
  _accountId: string,
  _instanceId: string,
  _data: Record<string, unknown>,
): Promise<StoredRow | null> {
  return rejectBundleWrite();
}

async function bundleDeleteNative(
  _accountId: string,
  _instanceId: string,
): Promise<void> {
  return rejectBundleWrite();
}

async function bundleListNative(
  accountId: string,
  entityType: string,
  _limit?: number,
  _where?: Record<string, unknown>,
): Promise<StoredRow[]> {
  const refId = bundleRefId(entityType);
  return bundleRowsOf(entityType).map((row) =>
    bundleRow(accountId, entityType, row, refId)
  );
}

async function bundleAppendEventNative(_event: StorageEventInput): Promise<void> {
  return rejectBundleWrite();
}

async function bundleLoadTypeNative(
  accountId: string,
  typeId: string,
): Promise<StoredType | null> {
  return memoryLoadTypeNative(accountId, typeId);
}

async function bundleLoadTypeByNameNative(
  accountId: string,
  name: string,
): Promise<StoredType | null> {
  return memoryLoadTypeByNameNative(accountId, name);
}

// ---------------------------------------------------------------------------
// Canonical Fenel ABI adapters. The backend leaves above deliberately retain
// their host-facing null/undefined convention; only these table-resident
// wrappers cross the descriptor boundary declared in types.fenel.
// ---------------------------------------------------------------------------

const STORAGE_NOTHING: StorageMaybe<never> = Object.freeze({ $tag: "Nothing" });

function storageJust<T>(value: T): StorageMaybe<T> {
  return { $tag: "Just", _0: value };
}

function readStorageMaybe<T>(value: StorageMaybe<T>, field: string): T | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field}: expected canonical Maybe data`);
  }
  const tag = Object.getOwnPropertyDescriptor(value, "$tag");
  if (tag === undefined || !("value" in tag)) {
    throw new TypeError(`${field}: expected an own Maybe tag`);
  }
  if (tag.value === "Nothing") return undefined;
  if (tag.value !== "Just") {
    throw new TypeError(`${field}: unknown Maybe tag ${String(tag.value)}`);
  }
  const inner = Object.getOwnPropertyDescriptor(value, "_0");
  if (inner === undefined || !("value" in inner)) {
    throw new TypeError(`${field}: Just requires an own _0 value`);
  }
  return inner.value as T;
}

function descriptorMaybeResult<A extends unknown[], T>(
  native: (...args: A) => Promise<T | null>,
): (...args: A) => Promise<StorageMaybe<T>> {
  return async (...args) => {
    const value = await native(...args);
    return value === null ? STORAGE_NOTHING : storageJust(value);
  };
}

type StorageListNative = (
  accountId: string,
  entityType: string,
  limit?: number,
  filter?: Record<string, unknown>,
) => Promise<StoredRow[]>;

function descriptorList(native: StorageListNative) {
  return (
    accountId: string,
    entityType: string,
    limit: StorageMaybe<number>,
    filter: StorageMaybe<Record<string, unknown>>,
  ): Promise<StoredRow[]> => native(
    accountId,
    entityType,
    readStorageMaybe(limit, "storage list limit"),
    readStorageMaybe(filter, "storage list filter"),
  );
}

function descriptorAppendEvent(
  native: (event: StorageEventInput) => Promise<void>,
) {
  return (event: StorageDescriptorEventInput): Promise<void> => native({
    accountId: event.accountId,
    type: event.type,
    payload: readStorageMaybe(event.payload, "storage event payload"),
    aggregateType: readStorageMaybe(event.aggregateType, "storage event aggregateType"),
    aggregateId: readStorageMaybe(event.aggregateId, "storage event aggregateId"),
    profileId: readStorageMaybe(event.profileId, "storage event profileId"),
  });
}

/** Canonical descriptor -> irreducible host implementation. */
export const storageNatives = {
  "storage:dbStore": dbStoreNative,
  "storage:dbLoad": descriptorMaybeResult(dbLoadNative),
  "storage:dbUpdate": descriptorMaybeResult(dbUpdateNative),
  "storage:dbDelete": dbDeleteNative,
  "storage:dbList": descriptorList(dbListNative),
  "storage:dbAppendEvent": descriptorAppendEvent(dbAppendEventNative),
  "storage:dbLoadType": descriptorMaybeResult(dbLoadTypeNative),
  "storage:dbLoadTypeByName": descriptorMaybeResult(dbLoadTypeByNameNative),

  "storage:memoryStore": memoryStoreNative,
  "storage:memoryLoad": descriptorMaybeResult(memoryLoadNative),
  "storage:memoryUpdate": descriptorMaybeResult(memoryUpdateNative),
  "storage:memoryDelete": memoryDeleteNative,
  "storage:memoryList": descriptorList(memoryListNative),
  "storage:memoryAppendEvent": descriptorAppendEvent(memoryAppendEventNative),
  "storage:memoryLoadType": descriptorMaybeResult(memoryLoadTypeNative),
  "storage:memoryLoadTypeByName": descriptorMaybeResult(memoryLoadTypeByNameNative),

  "storage:bundleStore": bundleStoreNative,
  "storage:bundleLoad": descriptorMaybeResult(bundleLoadNative),
  "storage:bundleUpdate": descriptorMaybeResult(bundleUpdateNative),
  "storage:bundleDelete": bundleDeleteNative,
  "storage:bundleList": descriptorList(bundleListNative),
  "storage:bundleAppendEvent": descriptorAppendEvent(bundleAppendEventNative),
  "storage:bundleLoadType": descriptorMaybeResult(bundleLoadTypeNative),
  "storage:bundleLoadTypeByName": descriptorMaybeResult(bundleLoadTypeByNameNative),
};
