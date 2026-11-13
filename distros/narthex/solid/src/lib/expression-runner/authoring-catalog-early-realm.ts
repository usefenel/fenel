// L1/L3 A2-B3 host transport. No engine runtime values enter this leaf.
import { onBrowserSessionChange, sessionEpoch, assertCurrentSession } from "../browser-session";
import { createAuthoringWorkerTransport, requestAuthoringTransport, observeAuthoringTransport,
  closeAuthoringTransport, retireAuthoringTransport, type AuthoringWorkerTransport } from "./authoring-worker-transport";
import type { RegistryPreparationRequest } from "../../../../../../implementations/typescript/engine/src/field-identity-worker-client";
import type { AuthoringWorkerResult } from "./authoring-worker-protocol";
import { AUTHORING_BUILD_IDENTITY } from "./authoring-build-identity";

export type EarlyAuthoringRealm = {
  readonly transport: AuthoringWorkerTransport; readonly lineage: object; readonly epoch: number;
  readonly kind: "local" | "reader";
  phase: "early" | "reserved" | "adopted";
  retireWhenIdle: boolean;
  readonly preparationLeases: Set<() => void>; readonly changes: Set<() => void>;
  detach: () => void;
};
export type EarlyAuthoringReservation = {
  readonly transport: AuthoringWorkerTransport;
  waitForPreparation(signal?: AbortSignal): Promise<void>;
  adopted(): void;
};
const realms = new Map<object, EarlyAuthoringRealm>();
const reservations = new Map<object, EarlyAuthoringRealm>();
const retiringRealms = new Set<EarlyAuthoringRealm>();
const currentTransports = new Map<object, Map<object, AuthoringWorkerTransport>>();
const attempted = new WeakSet<object>();
// Only an actual failed initial incarnation may rearm this holder. The ticket
// is host identity, never carried in a Fenel value or a worker request.
const spawnedRealms = new WeakSet<EarlyAuthoringRealm>();
type ReaderRealmBinding = { readonly lineage: object; readonly epoch: number; readonly signal?: AbortSignal };
const readerBindings = new WeakMap<object, ReaderRealmBinding>();
let repositoryOwner: { epoch: number; lineage: object } | undefined;

/** Existing detached repository sessions share one host owner per epoch. */
export function repositoryAuthoringRealmOwner(): object {
  const epoch = sessionEpoch();
  if (repositoryOwner?.epoch !== epoch) repositoryOwner = { epoch, lineage: Object.freeze({}) };
  return repositoryOwner.lineage;
}
export function bindCoreAuthoringOwner(reader: object, lineage: object, epoch: number, signal?: AbortSignal): void {
  assertCurrentSession(epoch);
  readerBindings.set(reader, { lineage, epoch, signal });
}
export function inheritCoreAuthoringOwner(reader: object, source: object, signal?: AbortSignal): void {
  const binding = readerBindings.get(source);
  if (!binding) return;
  const lifetime = signal && binding.signal && signal !== binding.signal
    ? AbortSignal.any([binding.signal, signal]) : signal ?? binding.signal;
  bindCoreAuthoringOwner(reader, binding.lineage, binding.epoch, lifetime);
}
export function authoringRealmOwnerFor(reader: object): object {
  const binding = readerBindings.get(reader);
  if (!binding) throw new Error("This reader's typed-choice owner is unavailable.");
  assertCurrentSession(binding.epoch); binding.signal?.throwIfAborted();
  return binding.lineage;
}
export function borrowCoreAuthoringTransportForReader(reader: object): ReturnType<typeof borrowCoreAuthoringTransport> {
  const lineage = authoringRealmOwnerFor(reader);
  const binding = readerBindings.get(reader)!;
  return borrowCoreAuthoringTransport(lineage, binding.epoch);
}

export function spawnAuthoringTransport(): AuthoringWorkerTransport {
  const worker = new Worker(new URL("./authoring-catalog.worker.ts", import.meta.url), { type: "module" });
  return createAuthoringWorkerTransport(worker, sessionEpoch());
}
function notify(realm: EarlyAuthoringRealm): void {
  for (const listener of [...realm.changes]) listener();
  if (realm.retireWhenIdle && !realm.preparationLeases.size && !realm.transport.jobs.size && !realm.transport.pending.size)
    closeAuthoringTransport(realm.transport, "The Local holder was closed.");
}
function spawnEarly(lineage: object, epoch: number, kind: EarlyAuthoringRealm["kind"]): EarlyAuthoringRealm | undefined {
  if (epoch !== sessionEpoch() || typeof Worker === "undefined") return undefined;
  if (attempted.has(lineage)) {
    const existing = realms.get(lineage);
    return existing?.kind === kind && existing.epoch === epoch && !existing.transport.closed && !existing.retireWhenIdle
      ? existing : undefined;
  }
  attempted.add(lineage);
  const realm: EarlyAuthoringRealm = { transport: spawnAuthoringTransport(), lineage, epoch, kind,
    phase: "early", retireWhenIdle: false, preparationLeases: new Set(), changes: new Set(), detach: () => {} };
  realms.set(lineage, realm);
  spawnedRealms.add(realm);
  realm.detach = observeAuthoringTransport(realm.transport, () => {
    if (realm.transport.closed) {
      forgetEarlyAuthoringRealm(realm);
      retiringRealms.delete(realm);
      if (reservations.get(lineage) === realm) reservations.delete(lineage);
      for (const seal of [...realm.preparationLeases]) seal();
    }
    notify(realm);
  });
  return realm;
}
export function spawnEarlyAuthoringRealm(lineage: object, epoch: number): EarlyAuthoringRealm | undefined { return spawnEarly(lineage, epoch, "local"); }
export function spawnReaderAuthoringRealm(lineage: object, epoch: number): void { spawnEarly(lineage, epoch, "reader"); }

/** Explicit subsequent admission retry, never an automatic RPC replay. An
 * adopted/retired holder, live realm or unsettled physical outcome cannot use
 * this initial-incarnation recovery door. Existing generic spawn stays once. */
export function retryEarlyAuthoringRealm(previous: EarlyAuthoringRealm): EarlyAuthoringRealm | undefined {
  assertCurrentSession(previous.epoch);
  const transport = previous.transport;
  if (!spawnedRealms.has(previous) || previous.kind !== "local" || previous.phase !== "early" || previous.retireWhenIdle
    || !transport.closed || transport.jobs.size || transport.pending.size || transport.storage.size || transport.retirement
    || realms.has(previous.lineage) || reservations.has(previous.lineage) || currentAuthoringTransport(previous.lineage))
    return undefined;
  spawnedRealms.delete(previous);
  attempted.delete(previous.lineage);
  return spawnEarly(previous.lineage, previous.epoch, "local");
}
export function forgetEarlyAuthoringRealm(realm: EarlyAuthoringRealm): void {
  if (realms.get(realm.lineage) === realm) realms.delete(realm.lineage);
}
export function availableEarlyAuthoringRealm(): EarlyAuthoringRealm | undefined {
  // The existing projected Local preparation may borrow only a Local holder.
  return [...realms.values()].find(realm => realm.kind === "local" && realm.epoch === sessionEpoch()
    && realm.phase === "early" && !realm.retireWhenIdle && !realm.transport.closed);
}

/** Reserve synchronously. A second preparer must refuse, never spawn while
 * the same owner waits for its existing multi-step early lease to drain. */
export function reserveEarlyAuthoringRealm(lineage: object): EarlyAuthoringReservation | undefined {
  if (reservations.has(lineage)) throw new Error("This authoring realm is already reserved by its reader.");
  const realm = realms.get(lineage);
  if (!realm) return undefined;
  forgetEarlyAuthoringRealm(realm);
  if (realm.epoch !== sessionEpoch() || realm.transport.closed || realm.retireWhenIdle) {
    void retireAuthoringTransport(realm.transport, "The authoring realm is unavailable.");
    return undefined;
  }
  realm.phase = "reserved";
  reservations.set(lineage, realm);
  return Object.freeze({ transport: realm.transport,
    waitForPreparation(signal?: AbortSignal) {
      return new Promise<void>((resolve, reject) => {
        const cleanup = () => { realm.changes.delete(check); signal?.removeEventListener("abort", check); };
        const check = () => {
          let failure: unknown;
          if (signal?.aborted) failure = signal.reason ?? new DOMException("Cancelled", "AbortError");
          else if (realm.transport.closed) failure = new Error(realm.transport.reason ?? "The authoring realm was closed.");
          else if (realm.epoch !== sessionEpoch()) failure = new Error("The account session changed.");
          else if (realm.retireWhenIdle) failure = new Error("The Local holder was closed.");
          if (failure !== undefined) { cleanup(); reject(failure); return; }
          // Exclude neutral core jobs and the reserved initialization itself.
          if (realm.preparationLeases.size || [...realm.transport.jobs.values()]
            .some(job => job.method === "prepare-repository-registry-step")) return;
          cleanup(); resolve();
        };
        realm.changes.add(check);
        signal?.addEventListener("abort", check, { once: true });
        check();
      });
    },
    adopted() {
      if (reservations.get(lineage) !== realm) return;
      reservations.delete(lineage);
      retiringRealms.delete(realm);
      realm.phase = "adopted";
      realm.detach();
    },
  });
}

/** Only the host operation is transported here; the heavy existing adapter
 * still validates and unwraps the actual RegistryPreparationResult. */
export function acquireEarlyAuthoringPreparation(): {
  run(preparation: RegistryPreparationRequest): Promise<AuthoringWorkerResult>;
  release(): void; abort(reason?: unknown): void;
} | undefined {
  const realm = availableEarlyAuthoringRealm();
  if (!realm) return undefined;
  const cancellation = new AbortController();
  let ended = false;
  const seal = () => {
    if (ended) return;
    ended = true; realm.preparationLeases.delete(seal); notify(realm);
  };
  const assertLease = () => {
    cancellation.signal.throwIfAborted(); assertCurrentSession(realm.epoch);
    if (ended || realm.transport.closed || realm.phase === "adopted")
      throw new Error("This repository registry preparation lease is closed.");
  };
  realm.preparationLeases.add(seal);
  return Object.freeze({
    async run(preparation: RegistryPreparationRequest) {
      assertLease();
      const result = await requestAuthoringTransport(realm.transport,
        { method: "prepare-repository-registry-step", request: preparation, build: AUTHORING_BUILD_IDENTITY }, cancellation.signal);
      assertLease(); return result;
    },
    release: seal,
    abort(reason?: unknown) { if (!ended) { cancellation.abort(reason); seal(); } },
  });
}
export function discardEarlyAuthoringRealm(lineage: object): void {
  const realm = realms.get(lineage) ?? reservations.get(lineage);
  if (!realm) return;
  forgetEarlyAuthoringRealm(realm);
  retiringRealms.add(realm);
  realm.retireWhenIdle = true;
  notify(realm);
}

/** The explicit opaque reader/holder key selects this host transport. The
 * key is not sent to Fenel and is neither an account name nor authority. */
export function bindAuthoringTransport(lineage: object, transport: AuthoringWorkerTransport): () => void {
  assertCurrentSession(transport.epoch);
  if (transport.closed) throw new Error(transport.reason ?? "The authoring worker is unavailable.");
  const bindings = currentTransports.get(lineage) ?? new Map<object, AuthoringWorkerTransport>();
  const token = Object.freeze({});
  bindings.set(token, transport);
  currentTransports.set(lineage, bindings);
  return () => {
    bindings.delete(token);
    if (!bindings.size && currentTransports.get(lineage) === bindings) currentTransports.delete(lineage);
  };
}
function currentAuthoringTransport(lineage: object): AuthoringWorkerTransport | undefined {
  // A reader can retain committed and paused-draft snapshots simultaneously.
  // Retiring the newer snapshot restores its still-live exact-owner peer.
  const bindings = currentTransports.get(lineage);
  return bindings && [...bindings.values()].reverse()
    .find(transport => !transport.closed && transport.epoch === sessionEpoch());
}

/** Read-only exact Local owner lookup. Warm realms remain with the heavy
 * client's existing map; its ordinary adapter composes the two lookups.
 * This never primes a reader or gives core choices access to a retired one. */
export function findLocalOrdinaryTransport(lineage: object, epoch: number): AuthoringWorkerTransport | undefined {
  assertCurrentSession(epoch);
  const bindings = currentTransports.get(lineage);
  const bound = bindings && [...bindings.values()].reverse().find(transport =>
    !transport.closed && !transport.retirement && transport.epoch === epoch);
  if (bound) return bound;
  const realm = realms.get(lineage) ?? reservations.get(lineage);
  return realm?.kind === "local" && realm.epoch === epoch && !realm.retireWhenIdle
    && !realm.transport.closed && !realm.transport.retirement ? realm.transport : undefined;
}
export function borrowCoreAuthoringTransport(lineage: object, epoch: number): {
  suggest(input: string, signal?: AbortSignal): Promise<AuthoringWorkerResult>; dispose(): void;
} {
  assertCurrentSession(epoch);
  let realm = realms.get(lineage) ?? reservations.get(lineage);
  let transport = currentAuthoringTransport(lineage) ?? realm?.transport;
  if (!transport) {
    spawnReaderAuthoringRealm(lineage, epoch);
    realm = realms.get(lineage); transport = realm?.transport;
  }
  if (!transport || transport.closed || transport.epoch !== epoch) throw new Error("The typed-choice authoring realm is unavailable.");
  const captured = transport;
  const cancellation = new AbortController();
  let ended = false;
  return Object.freeze({
    suggest(input: string, signal?: AbortSignal) {
      try {
        assertCurrentSession(epoch);
        if (ended) throw new Error("The typed choices were closed.");
        // A retired snapshot cannot lend its still-warm physical transport.
        const current = currentAuthoringTransport(lineage) ?? realms.get(lineage)?.transport ?? reservations.get(lineage)?.transport;
        if (current !== captured) throw new Error("These editing tools were replaced by a newer account snapshot.");
        return requestAuthoringTransport(captured, { method: "core-value-suggestions", input },
          signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal);
      } catch (error) { return Promise.reject(error); }
    },
    dispose() {
      if (ended) return;
      ended = true; cancellation.abort(new DOMException("The typed choices were closed.", "AbortError"));
      // Browse borrows the reader's realm. Its actual owner (client/holder or
      // the shared repository epoch) retains it across Browse close/reopen.
    },
  });
}

// Registered before the heavy client imports. All uninitialized/reserved
// realm exits settle through the same physical pending/jobs/message owner.
export function disposeEarlyAuthoringTransports(): void {
  for (const realm of new Set([...realms.values(), ...reservations.values(), ...retiringRealms]))
    void retireAuthoringTransport(realm.transport, "The account or committed authoring snapshot changed.");
  realms.clear(); reservations.clear(); retiringRealms.clear();
}
onBrowserSessionChange(() => { disposeEarlyAuthoringTransports(); currentTransports.clear(); });
