// ---------------------------------------------------------------------------
// Storage runtime seam.
//
// StorageHandler instances contain descriptor data authored in Fenel. Their
// host implementations live in fenel/modules/storage/ffi and are installed in
// the registry-local perform table through storageRuntimeModule. This file
// owns only runtime backend selection and the single descriptor-first call.
// ---------------------------------------------------------------------------

import { dispatchRegistry, frameVisibility, perform } from "@fenel/engine";
import type { InstanceVisibility } from "@fenel/engine";
import type { FenelModule, IOHandlerContext } from "@fenel/engine/types";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { AuthorityRef } from "@fenel/engine/authority";
import { invokeCallable } from "@fenel/engine/expressions";
import { Ref, functionRefHandle } from "@fenel/engine/type-foundation";
import { storageModule } from "@fenel/engine/modules/storage";
import { storageActsByHandle } from "../authority-mint";
import {
  isReferenceType,
  storageNatives,
  type StorageMethod,
  type StorageMethodArgs,
  type StorageMethodResult,
  type StoredRow,
  type StoredType,
  type StorageEventInput,
} from "../../../../../fenel/modules/storage/ffi/storage-ffi";

export type {
  StorageMethod,
  StorageMethodArgs,
  StorageMethodResult,
  StoredRow,
  StoredType,
  StorageEventInput,
};
export { isReferenceType };

/** Runtime-bearing counterpart of the declaration-only engine module. */
export const storageRuntimeModule: FenelModule = {
  ...storageModule,
  nativeImpls: storageNatives as unknown as NonNullable<FenelModule["nativeImpls"]>,
};

/** Base scope is Memory. A DB-configured runtime boot installs Db. */
let activeBackendTag = "Memory";

/** Install the Db StorageHandler selection at boot scope. */
export function installDbBackend(): void {
  activeBackendTag = "Db";
}

/** Restore the DB-less Memory base selection. */
export function installMemoryBackend(): void {
  activeBackendTag = "Memory";
}

/** Run a scoped computation under a different storage tag. */
export async function withStorageBackend<T>(
  tag: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = activeBackendTag;
  activeBackendTag = tag;
  try {
    return await fn();
  } finally {
    activeBackendTag = previous;
  }
}

/** Current storage tag, exposed for boot and invariant tests. */
export function activeStorageBackendTag(): string {
  return activeBackendTag;
}

export type PerformStorageOptions = {
  /** Reference-backed types route to the read-only Bundle instance. */
  readonly typeName?: string;
};

type StorageMaybe<T> =
  | { readonly $tag: "Just"; readonly _0: T }
  | { readonly $tag: "Nothing" };

const STORAGE_NOTHING: StorageMaybe<never> = Object.freeze({ $tag: "Nothing" });

function storageMaybe<T>(value: T | undefined): StorageMaybe<T> {
  return value === undefined ? STORAGE_NOTHING : { $tag: "Just", _0: value };
}

/** Lift the legacy runtime caller tuples to the declared Fenel FFI ABI. */
function descriptorStorageArgs<M extends StorageMethod>(
  method: M,
  args: StorageMethodArgs[M],
): readonly unknown[] {
  if (method === "list") {
    const [accountId, entityType, limit, filter] = args as StorageMethodArgs["list"];
    return [accountId, entityType, storageMaybe(limit), storageMaybe(filter)];
  }
  if (method === "appendEvent") {
    const [event] = args as StorageMethodArgs["appendEvent"];
    return [{
      accountId: event.accountId,
      type: event.type,
      payload: storageMaybe(event.payload),
      aggregateType: storageMaybe(event.aggregateType),
      aggregateId: storageMaybe(event.aggregateId),
      profileId: storageMaybe(event.profileId),
    }];
  }
  return args;
}

/** Lower canonical Maybe results back to the unchanged state-handler ABI. */
function legacyStorageResult(
  method: StorageMethod,
  descriptor: string,
  value: unknown,
): unknown {
  if (
    method !== "load"
    && method !== "update"
    && method !== "loadType"
    && method !== "loadTypeByName"
  ) return value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${descriptor}: expected canonical Maybe result`);
  }
  const tag = Object.getOwnPropertyDescriptor(value, "$tag");
  if (tag === undefined || !("value" in tag)) {
    throw new TypeError(`${descriptor}: expected an own Maybe result tag`);
  }
  if (tag.value === "Nothing") return null;
  if (tag.value !== "Just") {
    throw new TypeError(`${descriptor}: unknown Maybe result tag ${String(tag.value)}`);
  }
  const inner = Object.getOwnPropertyDescriptor(value, "_0");
  if (inner === undefined || !("value" in inner)) {
    throw new TypeError(`${descriptor}: Just result requires an own _0 value`);
  }
  return inner.value;
}

/** The storage module's own acts by handle, built once on the first reference
 *  read. */
let storageActs: ReadonlyMap<string, string> | undefined;

/** ⚠ rights R3a — THE SELECTION IS JUDGED UNDER THE CALLER'S AUTHORITY, and
 *  this is what completes R2b's storage partition.
 *
 *  R2b made every storage act judged on the account it ARGUES. A judgment is
 *  only as isolated as the DISPATCH that picks the act it judges, and this pick
 *  happened BEFORE the authority frame was built and saw every row: a correctly
 *  account-B-scoped `StorageHandler` row at a higher priority was selected for
 *  account A's `state.create_instance` and then judged, faithfully, under A's
 *  authority. The argued axis cannot see a selection bypass.
 *
 *  modules-as-values Phase 2c — a method value is the act's id string, used as
 *  it stands, or a function reference (`{$ref}`). A reference is read only
 *  through `storageActsByHandle` over the repository's `storageModule`, so it
 *  can name only one of that module's own acts (`storage.dbStore` or
 *  `storage:dbStore`); any other handle throws. It is never resolved through a
 *  registry. Exported for its unit tests. */
export function storageDescriptor(
  tag: string,
  method: StorageMethod,
  visibility: InstanceVisibility,
): string {
  const methods = dispatchRegistry.resolve(tag, "StorageHandler", visibility);
  if (methods === undefined) {
    throw new Error(`StorageHandler ${tag} is not registered`);
  }
  const property = Object.getOwnPropertyDescriptor(methods, method);
  if (property === undefined || !("value" in property)) {
    throw new Error(`StorageHandler ${tag}.${method} is not a data descriptor`);
  }
  if (typeof property.value === "string") return property.value;
  const handle = functionRefHandle(property.value);
  if (handle === undefined) {
    throw new Error(`StorageHandler ${tag}.${method} is not a data descriptor`);
  }
  storageActs ??= storageActsByHandle(storageModule);
  const descriptor = storageActs.get(handle);
  if (descriptor === undefined) {
    throw new Error(
      `StorageHandler ${tag}.${method} references ${JSON.stringify(handle)}, `
      + "which is not one of the storage module's own acts",
    );
  }
  return descriptor;
}

/**
 * The one runtime storage invocation path. Selection happens before the
 * authority boundary; perform itself receives only the resolved descriptor
 * and language arguments.
 */
export async function performStorageMethod<M extends StorageMethod>(
  reg: ModuleRegistry,
  ioContext: IOHandlerContext,
  method: M,
  args: StorageMethodArgs[M],
  options: PerformStorageOptions = {},
): Promise<StorageMethodResult[M]> {
  const tag = options.typeName !== undefined && isReferenceType(options.typeName)
    ? "Bundle"
    : activeBackendTag;
  const descriptor = storageDescriptor(
    tag, method, frameVisibility({ _authority: ioContext.authority }),
  );
  // rights R2a — an EXPLICIT override of the registry bootstrap authority.
  // `reg.evaluateContext()` carries the universe; spreading it and forgetting
  // this line judged every storage act under ⊤ no matter what the caller held.
  const frame = {
    ...reg.evaluateContext(),
    _ioHandlerContext: ioContext,
    _authority: ioContext.authority,
  };
  const result = await perform(frame, {
    descriptor,
    args: descriptorStorageArgs(method, args),
  });
  return legacyStorageResult(method, descriptor, result) as StorageMethodResult[M];
}

// storage-as-effect Phase 1b §3d — genId uses the Fenel-authored
// HasRandom.uuid descriptor. The storage move does not alter this path.
//
// ⚠ THE CROSS-CALL FRAME CACHE IS GONE (rights R2a). It memoised ONE
// `evaluateContext()` across every call AND every registry, so the first
// caller's frame — carrying the registry bootstrap authority, i.e. the
// universe — judged every later caller's uuid mint. `crypto:uuidV4` is
// requires-bearing, so it is a mediated act and really does reach the gate.

/** Invoke the Fenel crypto:uuidV4 body used by HasRandom.uuid, under the
 *  CALLER's authority. */
const uuidBaseContexts = new WeakMap<ModuleRegistry, ReturnType<ModuleRegistry["evaluateContext"]>>();

/** ⚠ THE BASE CONTEXT IS CACHED PER REGISTRY; THE AUTHORITY IS NOT.
 *  `evaluateContext()` rebuilds the constructor tables and the field-wire index
 *  and costs ~9 ms, so calling it per id mint put that on every row insert. The
 *  bug the ORIGINAL cache had was different: it was ONE context shared across
 *  every call AND every registry, so the first caller's frame judged everyone
 *  else's mint. Keying on the registry and spreading the caller's handle keeps
 *  the speed without the confusion. */
export function mintUuid(reg: ModuleRegistry, authority: AuthorityRef): string {
  let base = uuidBaseContexts.get(reg);
  if (base === undefined) {
    base = reg.evaluateContext();
    uuidBaseContexts.set(reg, base);
  }
  return invokeCallable(Ref("crypto:uuidV4"), [{}], { ...base, _authority: authority }) as string;
}
