import type { EvaluateContext } from "./json-logic";
import { authenticateAuthority } from "./authority";

declare const bindingBrand: unique symbol;

/** rights R6 fills this. The slot exists now because adding it later would be
 *  the same six-site edit under a second identity mint. */
export type BindingRef = {
  readonly [bindingBrand]: true;
};

/** A protected operation as seen by the authority boundary. Arguments are
 * language data only; host calling-convention state rides private frame fields. */
export type PerformAct = {
  readonly descriptor: string;
  readonly args: readonly unknown[];
  readonly binding?: BindingRef;
};

/** Why an act was refused. `absent` and `unauthenticated` are about the FRAME;
 *  `refused` and `undecided` are the checker's verdict; `checker-failed` is a
 *  throw from inside the judgment. All five refuse — the gate proceeds on
 *  exactly one shape and nothing else. */
export type AuthorityRefusalReason =
  | "absent"
  | "unauthenticated"
  | "refused"
  | "undecided"
  | "checker-failed";

/** ⚠ The message names the DESCRIPTOR and the REASON and nothing else.
 *  `api/src/index.ts` ships `err.message` to the client outside production, so
 *  a refusal raised inside the identity realm must never interpolate params. */
export class AuthorityRefused extends Error {
  readonly descriptor: string;
  readonly reason: AuthorityRefusalReason;
  constructor(descriptor: string, reason: AuthorityRefusalReason) {
    super(`perform: authority refused "${descriptor}" (${reason})`);
    this.name = "AuthorityRefused";
    this.descriptor = descriptor;
    this.reason = reason;
  }
}

/** The judgment seam. The registry supplies a closure that evaluates
 *  `authority:permits` under a kernel frame with no perform table. It returns a
 *  Fenel `Maybe Boolean`; this module reads nothing else about it. */
export type PerformJudge = (envelope: unknown, act: PerformAct) => unknown;

export type PerformOutcome =
  | { readonly kind: "settled"; readonly value: unknown }
  | { readonly kind: "failed"; readonly error: unknown };

export type PerformOutcomeObserver = (act: PerformAct, outcome: PerformOutcome) => void;

declare const performTableBrand: unique symbol;

/** An inert registry-local handle. The implementation table itself never
 * leaves this module. `withInstance` preserves the handle by object spread. */
export type PerformTableHandle = {
  readonly [performTableBrand]: true;
};

type PerformImplementation = (
  frame: EvaluateContext,
  args: readonly unknown[],
) => unknown;

/** Which host calling convention the implementation expects. A `native` takes
 *  the act arguments POSITIONALLY; an `io` implementation reads `args[0]` as one
 *  params record and needs an `IOHandlerContext` on the frame. The two are not
 *  interchangeable, and the distinction is settled at REGISTRATION — the only
 *  place that knows it — rather than re-derived from a residency index that
 *  answers a different question. */
export type PerformConvention = "native" | "io";

/** An entry is either an implementation or an ALIAS naming another descriptor.
 *  An alias stores the target NAME, not the target entry: re-registering the
 *  target after aliasing must be visible through the alias, and storing the
 *  entry object froze the alias at the shape the target happened to have when
 *  the alias was created. */
type PerformEntry = {
  readonly priority: number;
  readonly implementation?: PerformImplementation;
  readonly aliasOf?: string;
  readonly convention: PerformConvention;
};

export type PerformTableController = {
  readonly handle: PerformTableHandle;
  register(
    descriptor: string,
    implementation: PerformImplementation,
    priority: number,
    convention?: PerformConvention,
  ): void;
  alias(descriptor: string, target: string): boolean;
  /** rights R2b — MOVE the implementation from `alias` to `canonical` and leave
   *  an alias behind, so an act has ONE name.
   *
   *  Precondition: `alias` holds an IMPLEMENTATION entry, and `canonical` is
   *  either absent or already an alias of `alias` (re-running is a no-op).
   *  Returns `false` and mutates nothing when the precondition fails — a
   *  registration pass must not silently half-apply.
   *
   *  No chaining is created: the moved entry is an implementation and the name
   *  left behind is a one-hop alias of it. */
  canonicalize(canonical: string, alias: string): boolean;
  /** Sorted IMPLEMENTATION-BEARING descriptor names — aliases are NOT listed.
   *
   *  ⚠ THE OMISSION IS THE POINT (rights R2b). This is what the request mint
   *  hands to Fenel to build an envelope from, and R2a's most serious defect
   *  was an exclusion list that carried one of an act's two spellings while
   *  this returned both. One name per act makes that unrepresentable. Every
   *  caller keeps its own spelling and keeps working: `perform` canonicalises
   *  the requested descriptor before judging it. */
  listDescriptors(): string[];
  /** rights R7's seam. No observer ships in this phase besides the test one. */
  onOutcome(observer: PerformOutcomeObserver): () => void;
};

type PerformTable = {
  readonly entries: Map<string, PerformEntry>;
  readonly judge: PerformJudge;
  readonly observers: Set<PerformOutcomeObserver>;
};

const tables = new WeakMap<PerformTableHandle, PerformTable>();

/** A2 observation only: an opaque host handle cannot become a Fenel record
 * when reflection snapshots caller data. This reveals no table or authority. */
export function isPerformTableHandle(value: unknown): boolean {
  return tables.has(value as PerformTableHandle);
}

/** Host-bootstrap seam used by ModuleRegistry. Priority is settled at
 * registration time so `perform` itself has no native/IO classification or
 * precedence branch. Equal-priority registrations retain today's last-wins
 * registry behavior.
 *
 * ⚠ `judge` is REQUIRED. A perform table without a judgment is a door without
 * a lock, and making it optional is how that ships by accident. */
export function createPerformTableController(
  options: { readonly judge: PerformJudge },
): PerformTableController {
  const handle = Object.freeze({}) as PerformTableHandle;
  const entries = new Map<string, PerformEntry>();
  const observers = new Set<PerformOutcomeObserver>();
  tables.set(handle, { entries, judge: options.judge, observers });
  return Object.freeze({
    handle,
    register(descriptor, implementation, priority, convention = "native") {
      const current = entries.get(descriptor);
      if (current !== undefined && current.priority > priority) return;
      entries.set(descriptor, { priority, implementation, convention });
    },
    alias(descriptor, target) {
      const targetEntry = entries.get(target);
      if (targetEntry === undefined) return false;
      const current = entries.get(descriptor);
      if (current !== undefined && current.priority > targetEntry.priority) return true;
      entries.set(descriptor, {
        priority: targetEntry.priority,
        aliasOf: target,
        convention: targetEntry.convention,
      });
      return true;
    },
    canonicalize(canonical, alias) {
      const source = entries.get(alias);
      if (source === undefined || source.implementation === undefined) return false;
      const existing = entries.get(canonical);
      if (existing !== undefined && existing.aliasOf !== alias) return false;
      entries.set(canonical, {
        priority: source.priority,
        implementation: source.implementation,
        convention: source.convention,
      });
      entries.set(alias, {
        priority: source.priority,
        aliasOf: canonical,
        convention: source.convention,
      });
      return true;
    },
    listDescriptors() {
      const names: string[] = [];
      for (const [name, entry] of entries) {
        if (entry.implementation !== undefined) names.push(name);
      }
      return names.sort();
    },
    onOutcome(observer) {
      observers.add(observer);
      return () => { observers.delete(observer); };
    },
  });
}

/** rights R2b — THE ACT'S ONE NAME. An alias resolves to the name it points at;
 *  an implementation name and an unknown name are their own canonical form.
 *
 *  ⚠ WHAT THIS DOES AND DOES NOT HIDE, stated precisely rather than strongly.
 *  The consult still precedes the implementation LOOKUP, so an unregistered
 *  descriptor under a refusing envelope is a refusal rather than "no
 *  implementation" (`au.gate.order`, unchanged). But the refusal is NOT
 *  byte-identical between the two cases: an unregistered name is echoed back
 *  unchanged, while an ALIAS is replaced by its canonical target. A caller who
 *  can choose a descriptor can therefore learn the canonical id of an act it
 *  may not reach — it learns a NAME, never whether an implementation is behind
 *  it, and the alias map is public information (`listPerformDescriptors` is
 *  what the mint hands to Fenel). Narrowing that would mean judging one name
 *  and reporting another, which is worse. */
function canonicalDescriptor(table: PerformTable, descriptor: string): string {
  const entry = table.entries.get(descriptor);
  return entry?.aliasOf ?? descriptor;
}

// ⚠ `resolveImplementation` IS GONE (rights R2b). It followed one alias hop at
// call time, and `perform` used to call it on the REQUESTED descriptor. Now
// `perform` canonicalises first and reads the canonical entry's OWN
// implementation — one hop in total. Keeping the helper and calling it after
// canonicalising would be TWO: an `A → B → C` chain would be JUDGED as `B` and
// EXECUTED as `C`'s implementation, which is exactly the
// judge-one-execute-another shape the canonicalisation exists to close. No
// production path builds such a chain (there are two `alias` call sites, both in
// `registerFenelBodyDispatchers`), but "unreachable today" is a weaker claim
// than "unrepresentable", and the helper had no other consumer.

/** The ONE branch on the verdict's shape. `Just true` — the exact Fenel value,
 *  own data, a real boolean — proceeds. A bare `true`, a `1`, a `Just` wrapping
 *  a truthy non-boolean, a `Nothing`, and anything unreadable all refuse. */
function isExactlyJustTrue(verdict: unknown): boolean {
  if (verdict === null || typeof verdict !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(verdict, "$tag")) return false;
  const record = verdict as Record<string, unknown>;
  if (record["$tag"] !== "Just") return false;
  if (!Object.prototype.hasOwnProperty.call(verdict, "_0")) return false;
  return record["_0"] === true;
}

function isDefiniteRefusal(verdict: unknown): boolean {
  if (verdict === null || typeof verdict !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(verdict, "$tag")) return false;
  const record = verdict as Record<string, unknown>;
  return record["$tag"] === "Just" && record["_0"] === false;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof (value as { then?: unknown }).then === "function";
}

/** rights R7's outcome classification. With no observer registered this does
 *  nothing at all — in particular it attaches NO handler to the returned
 *  promise, so the host's unhandled-rejection behaviour is untouched on the
 *  production path. With an observer, it attaches exactly ONE
 *  `then(onSettled, onFailed)` (never a separate `.catch`, whose intermediate
 *  promise would itself reject unhandled) and returns the implementation's own
 *  promise unchanged. */
function notifyOutcome(table: PerformTable, act: PerformAct, outcome: PerformOutcome): void {
  for (const observer of [...table.observers]) observer(act, outcome);
}

function observeOutcome(table: PerformTable, act: PerformAct, value: unknown): unknown {
  if (table.observers.size === 0) return value;
  const notify = (outcome: PerformOutcome): void => notifyOutcome(table, act, outcome);
  if (isThenable(value)) {
    value.then(
      (settled) => { notify({ kind: "settled", value: settled }); },
      (error) => { notify({ kind: "failed", error }); },
    );
    return value;
  }
  notify({ kind: "settled", value });
  return value;
}

/** The one descriptor-first host boundary: private table lookup, authority
 * authentication, ONE judgment over the argued act, then — and only then —
 * implementation resolution and invocation. It deliberately owns no routing,
 * classification, orchestration, or policy grammar.
 *
 * ⚠ THE CONSULT PRECEDES THE LOOKUP. Throwing "no implementation" first would
 * tell an unauthorised caller which descriptors exist, and existence is
 * information the envelope is supposed to withhold. */
export function perform(frame: EvaluateContext, act: PerformAct): unknown {
  const table = frame._performTable === undefined
    ? undefined
    : tables.get(frame._performTable);
  if (table === undefined) {
    throw new Error(`perform: no implementation table in frame for "${act.descriptor}"`);
  }
  const record = authenticateAuthority(frame._authority);
  if (record === undefined) {
    throw new AuthorityRefused(
      act.descriptor,
      frame._authority === undefined ? "absent" : "unauthenticated",
    );
  }
  // rights R2b — CANONICALISE THE ACT, ONCE, HERE. The alternative was to
  // canonicalise the ENVELOPE at mint, which means walking an opaque Fenel
  // value in TypeScript to rewrite names inside it — policy logic in the host,
  // which is exactly what this gate does not do. The act carries one name from
  // this line onward: the judgment sees it, the refusal names it, and the
  // outcome hook reports it.
  const canonical = canonicalDescriptor(table, act.descriptor);
  const argued: PerformAct = canonical === act.descriptor
    ? act
    : { ...act, descriptor: canonical };
  let verdict: unknown;
  try {
    verdict = table.judge(record.envelope, argued);
  } catch (error) {
    // The checker's own failure rides as a CAUSE, never in the message: the API
    // ships `err.message` to the client outside production, and a checker bug
    // and a policy refusal are otherwise indistinguishable at the door.
    const refusal = new AuthorityRefused(canonical, "checker-failed");
    (refusal as { cause?: unknown }).cause = error;
    throw refusal;
  }
  if (!isExactlyJustTrue(verdict)) {
    throw new AuthorityRefused(
      canonical,
      isDefiniteRefusal(verdict) ? "refused" : "undecided",
    );
  }
  // ⚠ THE CANONICAL ENTRY'S OWN IMPLEMENTATION, not a second alias hop. The
  // canonicalisation already followed one; following another here would let an
  // `A → B → C` chain be JUDGED as `B` and EXECUTED as `C`.
  const implementation = table.entries.get(canonical)?.implementation;
  if (implementation === undefined) {
    throw new Error(`perform: no implementation for "${canonical}"`);
  }
  // A SYNCHRONOUS THROW IS AN OUTCOME. Classifying only the returned value
  // would make the meter (rights R7) blind to exactly the acts that failed.
  let produced: unknown;
  try {
    produced = implementation(frame, argued.args);
  } catch (error) {
    if (table.observers.size > 0) notifyOutcome(table, argued, { kind: "failed", error });
    throw error;
  }
  return observeOutcome(table, argued, produced);
}

/** The registered calling convention for a descriptor, or `undefined` when the
 *  frame has no table entry for it. Reveals no implementation; the evaluator's
 *  native-act override seam consults it to refuse a convention mismatch. */
export function performConventionFor(
  frame: EvaluateContext,
  descriptor: string,
): PerformConvention | undefined {
  if (frame._performTable === undefined) return undefined;
  return tables.get(frame._performTable)?.entries.get(descriptor)?.convention;
}

/** Internal descriptor-presence projection for the evaluator's method-value
 * discriminator. It reveals no implementation and is intentionally omitted
 * from the package barrel. */
export function hasPerformImplementation(
  frame: EvaluateContext,
  descriptor: string,
): boolean {
  if (frame._performTable === undefined) return false;
  const table = tables.get(frame._performTable);
  return table !== undefined && table.entries.has(descriptor);
}

/** Registry-internal projection behind `ModuleRegistry.listPerformDescriptors`.
 *  IMPLEMENTATION-BEARING names only — see `listDescriptors`. */
export function listPerformDescriptorsFor(handle: PerformTableHandle): string[] {
  const table = tables.get(handle);
  if (table === undefined) return [];
  const names: string[] = [];
  for (const [name, entry] of table.entries) {
    if (entry.implementation !== undefined) names.push(name);
  }
  return names.sort();
}
