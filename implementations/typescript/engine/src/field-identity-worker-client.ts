import { collectFieldIdentitiesThroughBase, FieldIdentityKernelError, FIELD_IDENTITY_BASE_INPUT_CHANGES, normalizeFieldDeclarations, type FieldDeclarationRootInput, type FieldIdentityBaseHandle, type FieldIdentityCollection, type FieldIdentityCollectionOptions, type FieldIdentityDiagnostic, type FieldIdentity, type FieldEntity } from "./field-identity";
import { FieldFacetProjectionError, projectFieldFacets, type FieldFacetProjection, type FieldFacetDiagnostic } from "./field-representations";
import { compileConstructorCatalogCandidates, type CompileConstructorCandidate, type CompileMetadataRegistry } from "./compile-field-slots";
import type { FenelModule } from "./types";
import { engineRequire } from "./engine-require";
import type { SignatureBorrowAnswer } from "./signature-inference";

export type RegistryPreparationRequest =
  | { kind: "fields"; roots: readonly FieldDeclarationRootInput[]; options: FieldIdentityCollectionOptions }
  /** W1/S2 — the field step through the base this realm retains under
   * `baseKey` (made now when none matches `roster`). The key and roster are
   * the requesting thread's selection data; the Fenel delta decides. */
  | { kind: "fieldsDelta"; roots: readonly FieldDeclarationRootInput[]; options: FieldIdentityCollectionOptions;
      baseKey: string; roster: readonly string[] }
  | { kind: "facets"; entities: readonly FieldEntity[]; identities: readonly FieldIdentity[]; directives: NonNullable<FenelModule["fieldFacetDirectives"]> }
  | { kind: "constructors"; entities: ReturnType<CompileMetadataRegistry["listIdentifiedEntities"]>;
      identityLock?: CompileMetadataRegistry["identityLock"]; identityKinds?: CompileMetadataRegistry["identityKinds"] }
  /** L5a — the S3a signature plans this realm retains (or plans now) for the
   * requester's missed authored rows, or for its missed inference call. The
   * transport admits these only between realms of one build (see
   * `checkRegistryPreparationBuild`). `key` is the requester's own exact key
   * of `arguments`: a structured clone turns null-prototype objects in them
   * into ordinary ones, which that key tells apart (measured 2026-10-30).
   * `keys` are the requester's own keys of `rows`, for the same reason: the
   * answering realm looks rows up by them and plans a miss from the received
   * copy only when the copy keys the same (otherwise it abandons). */
  | { kind: "signatureAuthoredPlans"; rows: readonly unknown[]; path: string; keys: readonly string[] }
  | { kind: "signatureInference"; arguments: readonly unknown[]; key: string };
/** A delta answer never carries the base itself: it stays in the realm that
 * made it. `base: null` reports a kernel refusal for the caller to remember;
 * `retained` says whether this realm's base served or was made. */
export type RegistryPreparationDeltaResult = {
  readonly collection?: FieldIdentityCollection; readonly outcome: string;
  readonly base?: null; readonly retained: "reused" | "made" | "none";
};
export type RegistryPreparationResult = FieldIdentityCollection | FieldFacetProjection | readonly CompileConstructorCandidate[] | RegistryPreparationDeltaResult
  | SignatureBorrowAnswer;

/** W1 — the bases this realm retains for `fieldsDelta` requests, keyed and
 * validated like the registry's own memo (one entry per key, at most two: a
 * base is about 100-150 MB). It lives in the realm that runs the kernel. */
const RETAINED_BASE_LIMIT = 2;
const retainedBases = new Map<string, { readonly roster: readonly string[]; readonly base: FieldIdentityBaseHandle }>();

function sameRoster(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/** Host glue around `collectFieldIdentitiesThroughBase`: select, retain or
 * drop this realm's base. Any failure on this path is a fallback outcome. */
export function runRetainedFieldIdentityDelta(request: Extract<RegistryPreparationRequest, { kind: "fieldsDelta" }>): RegistryPreparationDeltaResult {
  const retained = retainedBases.get(request.baseKey);
  const offered = retained !== undefined && sameRoster(retained.roster, request.roster) ? retained.base : undefined;
  const result = collectFieldIdentitiesThroughBase(request.roots, request.options, offered);
  if (result.base !== undefined && result.base !== null) {
    retainedBases.delete(request.baseKey);
    retainedBases.set(request.baseKey, Object.freeze({ roster: [...request.roster], base: result.base }));
    while (retainedBases.size > RETAINED_BASE_LIMIT) retainedBases.delete(retainedBases.keys().next().value!);
  } else if (offered !== undefined && FIELD_IDENTITY_BASE_INPUT_CHANGES.has(result.outcome)) {
    // Made under other inputs: the next build makes a fresh one.
    retainedBases.delete(request.baseKey);
  }
  return {
    ...(result.collection === undefined ? {} : { collection: result.collection }),
    ...(result.base === null ? { base: null } : {}),
    outcome: result.outcome,
    retained: offered !== undefined ? "reused" : result.base !== undefined && result.base !== null ? "made" : "none",
  };
}

/** The closed host preparation roster. Worker transports and the no-Worker
 * fallback invoke these same Fenel-owned operations, never supplied results. */
export function runRegistryPreparation(request: RegistryPreparationRequest): RegistryPreparationResult {
  if (request.kind === "fields") return normalizeFieldDeclarations(request.roots, request.options);
  if (request.kind === "fieldsDelta") return runRetainedFieldIdentityDelta(request);
  if (request.kind === "facets") return projectFieldFacets(request.entities, request.identities, request.directives);
  if (request.kind === "constructors") return compileConstructorCatalogCandidates({ listIdentifiedEntities: () => request.entities,
    identityLock: request.identityLock, identityKinds: request.identityKinds });
  if (request.kind === "signatureAuthoredPlans" || request.kind === "signatureInference") {
    const inference = engineRequire("signature-inference") as typeof import("./signature-inference");
    return request.kind === "signatureAuthoredPlans"
      ? inference.answerBorrowedAuthoredSignaturePlans(request.rows, request.path, request.keys)
      : inference.answerBorrowedSignatureInference(request.arguments, request.key);
  }
  throw new Error("Unknown registry preparation operation");
}

/** L5a-finish — the borrowed roster's premise, checked: a step computed in
 * another realm stands for the requester's own computation only when both
 * realms run the same build. The host names its build with an opaque string
 * (the browser distro: the `sourceDigest` of its authoring catalogue, whose
 * input roster covers every byte under `fenel/` and `engine/src/`); this
 * module only compares it. A mismatch is this refusal, raised by the
 * answering realm before any work and by the requester on an answer from
 * another build; the requester then computes the step itself. */
export const REGISTRY_PREPARATION_BUILD_MISMATCH = "RegistryPreparationBuildMismatch";
export class RegistryPreparationBuildMismatch extends Error {
  constructor() {
    super("The registry preparation came from another build.");
    this.name = REGISTRY_PREPARATION_BUILD_MISMATCH;
  }
}

/** Refuse unless `offered` is the same non-empty build string as `own`. */
export function checkRegistryPreparationBuild(offered: unknown, own: unknown): void {
  if (typeof offered !== "string" || typeof own !== "string" || offered === "" || offered !== own)
    throw new RegistryPreparationBuildMismatch();
}

/** True for a build refusal from either side, also after the failure envelope. */
export function isRegistryPreparationBuildMismatch(error: unknown): boolean {
  return error instanceof Error && error.name === REGISTRY_PREPARATION_BUILD_MISMATCH;
}

/** L5a (borrow-deadline, 2026-10-31) — per-request host scheduling of one
 * lease request. `signal` abandons ONLY this request (the lease and its other
 * requests stay); `started` is called once when the answering realm begins
 * this request's job (not when it is posted). Host data only, never Fenel. */
export type RegistryPreparationRunControl = {
  readonly signal?: AbortSignal;
  readonly started?: () => void;
};

/** One build's hold on the realm's preparation worker. `release` ends the
 * hold and leaves the worker warm; `abort` refuses this build's pending
 * requests and stops the worker when no other build is waiting on it. */
export type RegistryPreparationLease = {
  run(request: RegistryPreparationRequest, control?: RegistryPreparationRunControl): Promise<RegistryPreparationResult>;
  release(): void;
  abort(reason?: unknown): void;
  /** L5a — this lease's realm answers the two signature borrow operations
   * (its warm store belongs to the same source) and its transport checks the
   * build on every request and answer. Only such a lease is held through the
   * signature step; every other lease is released before it. Such a lease
   * honours `RegistryPreparationRunControl` (abandon one request; report its
   * start); other leases may ignore it. */
  readonly signatures?: true;
};

declare const registryPreparationHostBrand: unique symbol;
/** Host scheduling token only. Its identity, not any visible property,
 * selects a trusted host's acquisition callback. It is not Fenel data. */
export type RegistryPreparationHost = { readonly [registryPreparationHostBrand]: true };
const preparationHosts = new WeakMap<RegistryPreparationHost, () => Promise<RegistryPreparationLease>>();

/** Package-private trusted host boundary; deliberately absent from engine
 * barrels and package exports. Only browser host wiring and the epoch-bound
 * replay recorder may mint a token,
 * and its lease must transport the closed `runRegistryPreparation` roster
 * to the captured worker. This factory grants host result authority: it must
 * never be offered to Fenel values or untrusted options/data producers. */
export function createRegistryPreparationHost(acquire: () => Promise<RegistryPreparationLease>): RegistryPreparationHost {
  const host = Object.freeze(Object.create(null)) as RegistryPreparationHost;
  preparationHosts.set(host, acquire);
  return host;
}

export function acquireRegistryPreparationHost(host: RegistryPreparationHost): Promise<RegistryPreparationLease> {
  const acquire = preparationHosts.get(host);
  if (acquire === undefined) throw new TypeError("Invalid registry preparation host");
  return acquire();
}

/** Structured-clone envelope shared by every preparation transport. */
export type RegistryPreparationFailure = {
  message: string;
  name: string;
  diagnostic?: FieldIdentityDiagnostic | FieldFacetDiagnostic;
};

export function registryPreparationFailure(error: unknown): RegistryPreparationFailure {
  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "Error",
    ...(error instanceof FieldIdentityKernelError || error instanceof FieldFacetProjectionError ? { diagnostic: error.diagnostic } : {}),
  };
}

export function throwRegistryPreparationFailure(failure: RegistryPreparationFailure): never {
  const error = failure.name === "FieldIdentityKernelError" && failure.diagnostic
    ? new FieldIdentityKernelError(failure.diagnostic)
    : failure.name === "FieldFacetProjectionError" && failure.diagnostic
      ? new FieldFacetProjectionError(failure.diagnostic)
      : failure.name === REGISTRY_PREPARATION_BUILD_MISMATCH
        ? new RegistryPreparationBuildMismatch()
        : new Error(failure.message);
  error.name = failure.name;
  error.message = failure.message;
  throw error;
}

type Pending = { resolve: (value: RegistryPreparationResult) => void; reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>; lease: object };
type PreparationMessage = { data: { id: number; ok: true; value: RegistryPreparationResult }
  | ({ id: number; ok: false } & RegistryPreparationFailure) };
/** The host worker as this client uses it (the artifact acquisition pins the
 * one construction site below; no other host worker capability is named). */
type PreparationWorker = {
  postMessage(message: unknown): void; terminate(): void;
  onmessage: ((event: PreparationMessage) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  onmessageerror: (() => void) | null;
  ref?(): void; unref?(): void;
};
type Realm = { worker: PreparationWorker; nextId: number; closed: boolean; leases: Set<object>; pending: Map<number, Pending>;
  idle?: ReturnType<typeof setTimeout>; closeWhenIdle: boolean };

/** W1 — a persistent worker closes after this long without a build. */
export const REGISTRY_PREPARATION_IDLE_MS = 5 * 60_000;
/** Each request keeps the 180 second allowance it had before persistence. */
export const REGISTRY_PREPARATION_REQUEST_MS = 180_000;
let realm: Realm | undefined;
let spawned = 0;

function closeRealm(current: Realm, error: unknown = new Error("Registry preparation ended")): void {
  if (current.closed) return;
  current.closed = true;
  if (realm === current) realm = undefined;
  clearTimeout(current.idle);
  current.worker.terminate();
  for (const request of current.pending.values()) { clearTimeout(request.timer); request.reject(error); }
  current.pending.clear();
  current.leases.clear();
}

function settleIdle(current: Realm): void {
  if (current.closed || current.leases.size || current.pending.size) return;
  clearTimeout(current.idle);
  if (current.closeWhenIdle) { closeRealm(current); return; }
  current.idle = setTimeout(() => closeRealm(current), REGISTRY_PREPARATION_IDLE_MS);
  // A warm idle worker never keeps a script host (Bun, Node) alive by itself.
  (current.idle as { unref?: () => void }).unref?.();
  current.worker.unref?.();
}

function openRealm(): Realm {
  if (realm && !realm.closed) return realm;
  const worker = new Worker(new URL("./field-identity-worker.ts", import.meta.url), { type: "module" });
  spawned++;
  const pending = new Map<number, Pending>();
  const current: Realm = { worker: worker as unknown as PreparationWorker, nextId: 0, closed: false, leases: new Set(), pending, closeWhenIdle: false };
  current.worker.onmessage = (event: PreparationMessage) => {
    const result = event.data;
    const request = pending.get(result.id);
    if (!request) return;
    pending.delete(result.id); clearTimeout(request.timer);
    if (result.ok) request.resolve(result.value);
    else {
      try { throwRegistryPreparationFailure(result); }
      catch (error) { request.reject(error); }
    }
    settleIdle(current);
  };
  current.worker.onerror = (event) => closeRealm(current, new Error(event.message || "Registry preparation failed"));
  current.worker.onmessageerror = () => closeRealm(current, new Error("Registry preparation returned unreadable data"));
  realm = current;
  return current;
}

/** One private worker per realm serves every checked build, across builds
 * (W1): its realm-level caches and retained field bases survive. Its operation
 * roster is closed; callers cannot inject computed identities, facets or
 * signatures. The two signature borrow operations (L5a) answer only from the
 * answering realm's own planner and store, and the requester re-decodes and
 * id-checks every item; only the distro's Local lease advertises them (with
 * its build check), so builds release this lease before signatures. This
 * worker loads from this realm's own bundle URL, so it carries no build
 * check. Without a Worker host the same operations run inline. */
export function acquireRegistryPreparationWorker(): RegistryPreparationLease {
  if (typeof Worker === "undefined") return {
    run: async (request: RegistryPreparationRequest): Promise<RegistryPreparationResult> => runRegistryPreparation(request),
    release() {},
    abort() {},
  };
  const lease = {};
  let current: Realm | undefined;
  let ended = false;
  const attach = (): Realm => {
    if (!current || current.closed) {
      current = openRealm();
      clearTimeout(current.idle);
      current.idle = undefined;
      current.closeWhenIdle = false;
      current.worker.ref?.();
      current.leases.add(lease);
    }
    return current;
  };
  return {
    run: (request: RegistryPreparationRequest): Promise<RegistryPreparationResult> => {
      if (ended) return Promise.reject(new Error("Registry preparation is closed"));
      const owner = attach();
      const id = ++owner.nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => closeRealm(owner, new Error("Registry preparation timed out")), REGISTRY_PREPARATION_REQUEST_MS);
        owner.pending.set(id, { resolve, reject, timer, lease });
        try { owner.worker.postMessage({ id, request }); }
        catch (error) { owner.pending.delete(id); clearTimeout(timer); reject(error); settleIdle(owner); }
      });
    },
    release() {
      if (ended) return;
      ended = true;
      if (!current) return;
      current.leases.delete(lease);
      settleIdle(current);
    },
    abort(reason?: unknown) {
      if (ended) return;
      ended = true;
      if (!current) return;
      const owner = current;
      owner.leases.delete(lease);
      const own = [...owner.pending].filter(([, request]) => request.lease === lease);
      // A synchronous kernel cannot be interrupted: stop the worker when only
      // this build waits on it, as before persistence. Another build's work
      // continues; this build's abandoned answer is then ignored.
      if (own.length && own.length === owner.pending.size) { closeRealm(owner, reason); return; }
      for (const [id, request] of own) { owner.pending.delete(id); clearTimeout(request.timer); request.reject(reason); }
      settleIdle(owner);
    },
  };
}

/** Close the realm's preparation worker: at once (a browser session change:
 * its caches may hold the previous account's data), or once no build holds it. */
export function closeRegistryPreparationWorker(when: "now" | "idle" = "now"): void {
  if (!realm) return;
  if (when === "now") { closeRealm(realm); return; }
  realm.closeWhenIdle = true;
  settleIdle(realm);
}

/** Test observation only: how many preparation workers this realm started,
 * and whether one is alive. */
export const __registryPreparationWorkerForTests = {
  spawned: (): number => spawned,
  alive: (): boolean => realm !== undefined && !realm.closed,
  clearRetainedBases: (): void => { retainedBases.clear(); },
};
