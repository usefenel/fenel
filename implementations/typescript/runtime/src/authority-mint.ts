// ---------------------------------------------------------------------------
// rights R2a — the mint sites.
//
// Every authority in the running product is minted HERE or by the registry
// bootstrap, and nowhere else. `audit-effects.ts`'s `authority-minter-sites`
// rule allowlists the issuer literals to this file (plus the test support), so
// a new mint site is a finding rather than a diff nobody reads.
//
// ⚠ THE ENVELOPE IS COMPUTED BY FENEL, NOT AUTHORED HERE. The only thing this
// file decides is WHICH Fenel envelope constructor to call and what registry
// projection to hand it. `authority:roleEnvelope` decides what each ROLE may
// reach; `authority:identityRealmEnvelope` enumerates the authentication chain.
// There is no descriptor list and no role rule in this file.
//
// ⚠ `mintInterimWorkerAuthority` IS INTERIM AND SAYS SO. It hands a sessionless
// lane the FULL member envelope, which is the right shape and the wrong
// authority: the lane has no authenticated principal behind it. rights R4
// replaces every call with a mint from an authenticated principal and deletes
// this helper. Until then `grep mintInterimWorkerAuthority` IS the ingress
// census R4 starts from, and each lane names itself so the census is legible.
// ---------------------------------------------------------------------------

import type { ModuleRegistry } from "@fenel/engine";
import { mintAuthority, type AuthorityRef } from "@fenel/engine/authority";
import { functionRefHandle } from "@fenel/engine/type-foundation";

/** A sessionless ingress lane. ⚠ EVERY NAME HERE IS MINTED SOMEWHERE — the
 *  union is the census R4 reads, and a declared-but-unminted lane would make it
 *  over-report. `hook`, `embed`, `telegram-collector`, `imports` and
 *  `dashboard-run` were declared and never minted — their leaves and routes
 *  carry the CALLER's authority instead, which is the correct shape — and are
 *  gone. */
export type InterimWorkerLane =
  | "trigger"
  | "timer-sweep"
  | "event-match"
  | "parent-completion"
  | "child-reconcile"
  | "bot"
  | "events"
  | "pages"
  | "redirect"
  | "forms"
  | "receipt"
  | "subscription"
  | "catalog-cache"
  | `webhook:${string}`;

/** One line per lane per process, so a deployment's log says which interim
 *  lanes are live without anyone having to grep the source. */
const announcedLanes = new Set<string>();

/** rights R2b — the STORAGE INDEX the role policy is handed: one
 *  `StorageDescriptor` per (backend, method) of the three registered
 *  `StorageHandler` instances.
 *
 *  ⚠ A DATA PROJECTION, NOT A POLICY. It says which descriptor the runtime
 *  performs for `Db.store`; it says nothing about who may reach it. The policy
 *  reads it to select rows BY METHOD, so no rule anywhere does string surgery
 *  on a descriptor name. The pin asserts this equals
 *  `fenel/modules/storage/instances.fenel`.
 *
 *  Registry-static, so memoised on the registry object exactly as the envelope
 *  is. */
/** ⚠ THE STORAGE POLICY INPUT IS REPO-OWNED STATIC DATA, END TO END, and every
 *  word of that is load-bearing.
 *
 *  The general row is `D` minus every descriptor in this index, so whatever is
 *  MISSING here is reachable with no partition axis at all — and WHICH ROW a
 *  descriptor lands in is decided by its `method`, so whoever controls the
 *  method controls read-versus-write. Two earlier spellings put one half or the
 *  other under account control and both were live escalations:
 *
 *   · Walking the registered `StorageHandler` instances and SKIPPING one that
 *     did not resolve. `dispatch:unregister` is in the general row for EVERY
 *     role, so dropping `StorageHandler Db` moved all eight `storage:db*`
 *     descriptors into the general row. They are `@requires "HasStateIO"`
 *     declarations, so a body names one directly and reaches `perform` through
 *     `mediateNativeAct` with POSITIONAL arguments, never touching
 *     `storageDescriptor`. Measured: a `viewer` permitted `storage:dbStore` on
 *     another account.
 *   · Resolving the declarations by BARE NAME (`getFunction("dbStore")`). The
 *     codeName map is last-wins and account modules merge AFTER the repository
 *     ones, so an account module declaring a function called `dbStore` shadowed
 *     the leaf and took it straight out of the exclusion. Measured: 23 declared
 *     instead of 24, `storage:dbStore` in the general row.
 *   · Taking the BINDING from `dispatchRegistry.listInstances`. `dispatch:register`
 *     is in the general row for every role, so a `viewer` could register a fresh
 *     tag whose `load` names `storage:dbStore`, re-classify a write as a read,
 *     and persist. Measured: `viewer permits storage:dbStore(own) → Just true`.
 *
 *  So BOTH halves now come from the `storage` module OBJECT the registry loaded:
 *  its `functions` (the declarations) and its own `instances` (the bindings).
 *  Neither is reachable from any account — a module named `storage` is refused
 *  by `au.ns.reserved`, and a repository module's object is not something an
 *  installed module can edit. There is no `dispatchRegistry` read at this policy
 *  door at all.
 *
 *  ⚠ AND NO GATE ENFORCES THAT — say it plainly, because an earlier draft of
 *  this comment said the opposite and review round 1 had already corrected it
 *  once. `ambient-read-census` roots at `engine/src` and reads six paths, all
 *  under it; this file is `runtime/src` and the census would say nothing about
 *  it whatever it contained. A future phase that re-adds
 *  `dispatchRegistry.listInstances("StorageHandler")` here would run
 *  `ambient-read-census --check` GREEN. What actually catches that is the
 *  hostile-instance pin in `rights-r2b-partition.test.ts`, and only because it
 *  registers a real one.
 *
 *  ⚠ WHAT THIS DELIBERATELY DOES NOT CLAIM. `performStorageMethod` still
 *  resolves the descriptor it performs through the LIVE dispatch registry, so an
 *  account that overrides `StorageHandler Db` changes which act the storage seam
 *  executes. That act is then judged ON ITS OWN NAME, so it is not a partition
 *  bypass — it is the dispatch steering channel, and it is R3's. */
function storageModuleOf(registry: ModuleRegistry): ModuleRegistry["modules"][number] | undefined {
  const found = registry.modules.filter((module) => module.name === "storage");
  // ⚠ TWO IS A FAILURE; ZERO IS NOT. A second module answering to `storage`
  // would make the choice an ORDERING accident, and ordering is not a fence —
  // `au.ns.reserved` refuses an account module by that name, so two means
  // something upstream broke and the policy must not guess. ZERO is the ordinary
  // case for a fixture registry built from `std` and a probe module: no storage
  // module means no storage DECLARATIONS, which means no storage descriptors in
  // the table for the general row to have to exclude. An empty index is exactly
  // right there, and refusing to mint would break every registry that never
  // performs a storage act.
  if (found.length > 1) {
    throw new Error(
      `authority: found ${found.length} modules named \`storage\` in this registry — `
      + "the storage partition rows cannot be built from an ambiguous module set",
    );
  }
  return found[0];
}

const storageIndexByRegistry = new WeakMap<ModuleRegistry, readonly unknown[]>();

type StorageModuleObject = ModuleRegistry["modules"][number];

/** THE DECLARATIONS: the storage module's own `HasStateIO`-requiring
 *  functions, read off its function list by IDENTITY — never by resolving a
 *  bare name, which is the account-shadowable path. */
function storageActIds(module: StorageModuleObject): string[] {
  return (module.functions ?? [])
    .filter((fn) => {
      const requires = (fn as { requires?: readonly { class?: { entityId?: string } }[] }).requires;
      return requires !== undefined
        && requires.some((constraint) => constraint.class?.entityId === "HasStateIO");
    })
    .map((fn) => fn.id);
}

/** modules-as-values Phase 2c — every handle a `StorageHandler` method value
 *  may use to name one of the storage module's own acts, mapped to that act's
 *  function id: the id itself (`storage:dbStore`) and the qualified member
 *  (`storage.dbStore`). `storageDescriptor` in `handlers/storage-backends.ts`
 *  reads references through this same map.
 *
 *  ⚠ BUILT FROM THE MODULE OBJECT ALONE, for the reason the index is: a
 *  reference is never resolved through a registry lookup (`getFunction`, the
 *  codeName map, a UUID, the dispatch registry). Account modules and
 *  registered rows feed those lookups, which is how the earlier spellings
 *  escalated. A bare `dbStore`, a UUID, another module's member or any other
 *  handle maps to nothing, so the act it was meant to bind stays unbound and
 *  is REFUSED.
 *
 *  The member is the id's local part after `<module name>:`. The registry's
 *  module view carries no `functionSignatureDeclarations`, and the loader
 *  builds every id as `<module>:<declaration name>`, which is also the engine
 *  member index's rule when it has no declaration. An id outside that prefix
 *  gets no qualified handle, which can only refuse more. */
export function storageActsByHandle(module: StorageModuleObject): ReadonlyMap<string, string> {
  const byHandle = new Map<string, string>();
  const bind = (handle: string, id: string): void => {
    const prior = byHandle.get(handle);
    if (prior !== undefined && prior !== id) {
      throw new Error(
        `authority: the storage handle "${handle}" names both ${prior} and ${id} — `
        + "the storage partition rows cannot bind it",
      );
    }
    byHandle.set(handle, id);
  };
  const prefix = `${module.name}:`;
  for (const id of storageActIds(module)) {
    bind(id, id);
    if (id.startsWith(prefix) && id.length > prefix.length) {
      bind(`${module.name}.${id.slice(prefix.length)}`, id);
    }
  }
  return byHandle;
}

/** Exported for the partition pins, which also build it over synthetic module
 *  sets. Product code reaches it only through `roleEnvelope` and
 *  `acquisitionEnvelope`. */
export function storageIndex(registry: ModuleRegistry): readonly unknown[] {
  const cached = storageIndexByRegistry.get(registry);
  if (cached !== undefined) return cached;
  const module = storageModuleOf(registry);
  if (module === undefined) {
    storageIndexByRegistry.set(registry, []);
    return [];
  }
  const declared = storageActIds(module);
  const declaredSet = new Set(declared);
  const declaredByHandle = storageActsByHandle(module);
  // THE BINDINGS. From the module's OWN declared instances. A method entry whose
  // value is not a DECLARED act is skipped, which is how the instances' `scope`
  // sidecar (`"global"`) falls out without a class lookup. A value is the act's
  // id string, or a function reference (`{$ref}`) whose handle is in
  // `declaredByHandle`; a reference to anything else binds nothing.
  const bound = new Map<string, { backend: string; method: string }>();
  for (const instance of module.instances ?? []) {
    if (instance.typeName !== "StorageHandler") continue;
    const backend = instance.args[0];
    if (typeof backend !== "string") continue;
    for (const method of Object.keys(instance.methods)) {
      // Own DATA only — never a getter and never a prototype read, for the same
      // reason the act projection reads own data: this feeds a policy.
      // `functionRefHandle` keeps that rule for the reference's own `$ref`.
      const property = Object.getOwnPropertyDescriptor(instance.methods, method);
      if (property === undefined || !("value" in property)) continue;
      const value: unknown = property.value;
      let descriptor: string | undefined;
      if (typeof value === "string") {
        descriptor = value;
      } else {
        const handle = functionRefHandle(value);
        descriptor = handle === undefined ? undefined : declaredByHandle.get(handle);
      }
      if (descriptor === undefined || !declaredSet.has(descriptor)) continue;
      const prior = bound.get(descriptor);
      if (prior !== undefined && (prior.backend !== backend || prior.method !== method)) {
        // One descriptor, one (backend, method). A conflict means two instances
        // disagree about what an act IS, and the policy would then classify it
        // by whichever was iterated last.
        throw new Error(
          `authority: "${descriptor}" is bound to both ${prior.backend}.${prior.method} and `
          + `${backend}.${method} — the storage partition rows cannot classify it`,
        );
      }
      bound.set(descriptor, { backend, method });
    }
  }
  // One row per DECLARED act. An act no declared instance names gets an EMPTY
  // method, which excludes it from the general row (it is still a storage act)
  // and selects it into NO storage row (`storageReadMethods` /
  // `storagePositionalMethods` / `"appendEvent"` all miss it) — so it is
  // REFUSED rather than unpartitioned. That is the failure mode
  // `au.policy.partition` claims for a method nobody classified.
  const rows: unknown[] = declared.map((descriptor) => {
    const binding = bound.get(descriptor);
    return {
      $tag: "StorageDescriptor",
      backend: binding?.backend ?? "",
      method: binding?.method ?? "",
      descriptor,
    };
  });
  storageIndexByRegistry.set(registry, rows);
  return rows;
}

/** rights R2b — the role envelope, memoised per `(registry, account, role)`.
 *
 *  ⚠ THE KEY IS THE ENVELOPE'S OWN INPUTS AND NOTHING ELSE. Caching per SESSION
 *  or per PRINCIPAL would survive a role change: the membership row is read on
 *  every request precisely so a demotion takes effect on the next one. Registry-
 *  static data plus two strings is all an envelope depends on, so that is all
 *  the key carries — and the HANDLE is always fresh. */
const roleEnvelopesByRegistry = new WeakMap<ModuleRegistry, Map<string, unknown>>();

function roleEnvelope(registry: ModuleRegistry, accountId: string, role: string): unknown {
  let byKey = roleEnvelopesByRegistry.get(registry);
  if (byKey === undefined) {
    byKey = new Map<string, unknown>();
    roleEnvelopesByRegistry.set(registry, byKey);
  }
  // A NUL separator, not a space: both halves are strings the caller supplies,
  // and `"a b" + " " + "c"` and `"a" + " " + "b c"` are the same key under a
  // printable one. No live collision (account ids are uuids and roles are
  // gate-constrained), but an ambiguous key in a policy cache is free to fix.
  const key = `${accountId}\u0000${role}`;
  const cached = byKey.get(key);
  if (cached !== undefined) return cached;
  const envelope = registry.evaluateAuthorityFunction(
    "authority:roleEnvelope",
    [role, accountId, registry.listPerformDescriptors(), storageIndex(registry)],
  );
  byKey.set(key, envelope);
  return envelope;
}

/** rights R4a — the acquisition envelope, memoised per `(registry, partition)`.
 *
 *  Same key discipline as `roleEnvelope`: registry-static data plus one string,
 *  and the HANDLE is always fresh. There is no role here because there is no
 *  principal — that is the point of the realm. */
const acquisitionEnvelopesByRegistry = new WeakMap<ModuleRegistry, Map<string, unknown>>();

function acquisitionEnvelope(registry: ModuleRegistry, partition: string): unknown {
  let byKey = acquisitionEnvelopesByRegistry.get(registry);
  if (byKey === undefined) {
    byKey = new Map<string, unknown>();
    acquisitionEnvelopesByRegistry.set(registry, byKey);
  }
  const cached = byKey.get(partition);
  if (cached !== undefined) return cached;
  const envelope = registry.evaluateAuthorityFunction(
    "authority:acquisitionEnvelope",
    [partition, storageIndex(registry)],
  );
  // ⚠ CAPPED, BECAUSE THE KEY IS UNAUTHENTICATED. `roleEnvelope`'s key is an
  // account id the SESSION LOOKUP produced; this one is a partition the CALLER
  // supplies — `api/src/routes/forms.ts` passes the raw `X-Account-Id` header
  // through with no session and no validation. Anonymous requests with a fresh
  // random header each time would otherwise insert one envelope per request
  // with nothing to evict them. Bounded at 32, evicting the OLDEST INSERTION;
  // a miss costs one Fenel call and the envelope is unchanged either way.
  //
  // ⚠ FIFO, NOT LRU, and the difference is stated because an earlier draft of
  // this comment claimed parity with `account-field-registry.ts` — which IS
  // LRU (a hit there re-inserts to move the key to the end). A read here does
  // not re-insert. For the attack this bounds it makes no difference — unique
  // attacker keys are always the newest, so LRU would evict the same
  // legitimate entries — and the honest cost is that a deployment whose live
  // partition set exceeds 32 re-mints every request. One account is one entry,
  // and every ingress door but forms mints on `""` and shares a single one.
  //
  // (Found by adversarial review. The interim path memoised `roleEnvelope` by
  // that same header, so this is a SECOND copy of an existing shape rather than
  // a new one — but it is the copy this phase added, so it is the one this
  // phase bounds.)
  if (byKey.size >= 32) {
    const oldest = byKey.keys().next();
    if (!oldest.done) byKey.delete(oldest.value);
  }
  byKey.set(partition, envelope);
  return envelope;
}

const identityRealmEnvelopeByRegistry = new WeakMap<ModuleRegistry, unknown>();

function identityRealmEnvelope(registry: ModuleRegistry): unknown {
  const cached = identityRealmEnvelopeByRegistry.get(registry);
  if (cached !== undefined) return cached;
  const envelope = registry.evaluateAuthorityFunction(
    "authority:identityRealmEnvelope",
    [registry.listPerformDescriptors()],
  );
  identityRealmEnvelopeByRegistry.set(registry, envelope);
  return envelope;
}

/** rights R2b — THE AUTHENTICATED REQUEST, derived from the session's LIVE
 *  membership.
 *
 *  The role comes from the membership row the session lookup already
 *  inner-joins, so there is no extra round-trip and no cache to invalidate: a
 *  role change or a deleted membership takes effect on the next request. The
 *  membership id rides as `grant` — attribution here, and rights R4's
 *  persistence input.
 *
 *  An UNKNOWN role is not an error. `authority:roleEnvelope` denotes ∅ for it,
 *  so the mint succeeds and every act refuses — which is the fail-closed
 *  reading, and is observable (a 403 naming the descriptor) rather than a 500. */
export function mintRequestAuthority(
  registry: ModuleRegistry,
  session: { accountId: string; role: string; membershipId: string; subject?: unknown },
): AuthorityRef {
  return mintAuthority(registry, {
    envelope: roleEnvelope(registry, session.accountId, session.role),
    issuer: "request-session",
    accountId: session.accountId,
    principal: session.subject ?? null,
    lane: null,
    // `?? null`, because the field is typed `string | null` and R4 PERSISTS it:
    // an `undefined` serialises as an ABSENT column rather than a null one.
    grant: session.membershipId ?? null,
    mintedAt: Date.now(),
  });
}

/** No session resolved. The empty envelope permits nothing, so the first act an
 *  anonymous caller reaches is refused at the gate rather than at whichever
 *  leaf happened to check something. */
export function mintAnonymousAuthority(registry: ModuleRegistry): AuthorityRef {
  return mintAuthority(registry, {
    envelope: registry.evaluateAuthorityFunction("authority:emptyEnvelope", [0]),
    issuer: "anonymous",
    accountId: null,
    principal: null,
    lane: null,
    grant: null,
    mintedAt: Date.now(),
  });
}

/** THE privileged door's authority — a positive enumeration of the
 *  authentication chain and nothing else. Its only caller is
 *  `invokeIOActionPrivileged`. */
export function mintIdentityRealmAuthority(registry: ModuleRegistry): AuthorityRef {
  return mintAuthority(registry, {
    envelope: identityRealmEnvelope(registry),
    issuer: "identity-door",
    accountId: null,
    principal: null,
    lane: null,
    grant: null,
    mintedAt: Date.now(),
  });
}

/** rights R4a — THE ACQUISITION REALM'S AUTHORITY.
 *
 *  An ingress door holds this while it finds and verifies the row it is about to
 *  mint a product grant from. It is a deliberate NON-ROW authority: there is no
 *  authenticated principal behind it YET, which is exactly why it exists —
 *  anonymous ∅ cannot perform the reads the mint needs, and using the interim
 *  worker for them means discovering a row under a member envelope of an account
 *  nobody has proved anything about.
 *
 *  ⚠ THE PARTITION IS A LOOKUP COORDINATE, NOT A SELECTION COORDINATE, and
 *  conflating them is the trap. `accountId` is `null` here, so
 *  `invokeIOActionAs`-style derivation of the ACCOUNT REGISTRY and of dispatch
 *  visibility sees no account: global rows only, and no account-owned storage
 *  handler is selected. The partition is supplied separately, to the leaf
 *  CONTEXT, by `invokeIOActionEphemeral`. It only narrows — discovery reads are
 *  either public or secret-bearing-by-id, so a hostile partition cannot widen
 *  anything.
 *
 *  ⚠ FOR INGRESS DISCOVERY ONLY. The single most important trap in this design:
 *  if a product helper were given acquisition authority instead of being
 *  partitioned at its own leaf, the operation it was supposed to lose would
 *  survive the fence and its pin would still be green. The Telegram collector's
 *  foreign-bot read is the concrete case — it is repaired by making the leaf
 *  account-scoped, never by widening this envelope. */
export function mintAcquisitionAuthority(
  registry: ModuleRegistry,
  partition: string,
): AuthorityRef {
  return mintAuthority(registry, {
    envelope: acquisitionEnvelope(registry, partition),
    issuer: "acquisition",
    // ⚠ NULL, NOT THE PARTITION. See the note above: this field is the
    // SELECTION account, and giving it the caller-supplied partition would make
    // a URL segment select which account's installed source modules and
    // account-owned dispatch instances an unauthenticated request executes
    // against.
    accountId: null,
    principal: null,
    lane: null,
    grant: null,
    mintedAt: Date.now(),
  });
}

/** ⚠ INTERIM. See the file header. */
export function mintInterimWorkerAuthority(
  registry: ModuleRegistry,
  accountId: string | null,
  lane: InterimWorkerLane,
): AuthorityRef {
  if (!announcedLanes.has(lane)) {
    announcedLanes.add(lane);
    console.log(
      `[rights] interim worker authority minted for lane ${lane} — rights R4 retires this`,
    );
  }
  return mintAuthority(registry, {
    // rights R2b — the interim lane holds a MEMBER envelope PARTITIONED to its
    // account, which is strictly narrower than R2a's unpartitioned one. The
    // all-accounts timer tick passes `null` and therefore holds an envelope
    // partitioned to `""`, which matches no account — and that is correct
    // rather than broken: `resumeWaitingInstance` re-mints over the row's own
    // account BEFORE it runs anything, so the `""` envelope never judges a real
    // act. rights R4 replaces this helper with a mint from an authenticated
    // principal.
    envelope: roleEnvelope(registry, accountId ?? "", "member"),
    issuer: "interim-worker",
    accountId,
    principal: null,
    lane,
    grant: null,
    mintedAt: Date.now(),
  });
}

/** The lanes R4 owns, for its census. Exported so a test can assert the list
 *  matches what the source actually mints. */
export function announcedInterimLanes(): string[] {
  return [...announcedLanes].sort();
}
