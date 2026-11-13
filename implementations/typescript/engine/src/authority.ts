// ---------------------------------------------------------------------------
// The opaque authority handle, its host-private record table, and the mint.
//
// rights R2a. `design/ts-exceptions-ledger.md` § A — registry-bootstrap /
// host-evaluator plumbing, the same ledgered kind as the perform table itself.
// There is no policy in this file: every rule about WHICH envelopes may be
// minted by WHICH issuer lives in `authority:mintRefusalReason`, and this module
// makes one call and branches only on Just-versus-Nothing.
//
// WHY A HANDLE AND NOT A VALUE. A frame that carried the envelope itself would
// let anyone who can build a frame build an envelope — and every frame in this
// engine is built by object spread. An `AuthorityRef` is a frozen empty object
// whose ONLY use is as a key into this module's `WeakMap`: it survives every
// spread (it is a value in the frame), it reveals nothing when logged or
// serialised, and a forged `{}` authenticates to `undefined`, which the gate
// reads as a refusal. Cornerstone 4: values describe, frames empower.
//
// NOTHING HERE IS EXPORTED FROM THE PACKAGE BARREL. The runtime imports the
// deep path; `audit-effects.ts`'s `authority-minter-sites` rule allowlists the
// importing files per issuer literal, so a new mint site is a finding rather
// than a diff nobody reads.
// ---------------------------------------------------------------------------

declare const authorityBrand: unique symbol;

/** An inert, unforgeable handle to a minted authority record. Carries no
 *  fields; the record lives only in this module's private table. */
export type AuthorityRef = {
  readonly [authorityBrand]: true;
};

/** WHO minted. Attribution and the one policy input the Fenel fence reads
 *  (`registry-bootstrap` is the sole issuer that may hold the universe). */
export type AuthorityIssuer =
  | "registry-bootstrap"
  | "request-session"
  | "identity-door"
  /** rights R4a — THE ACQUISITION REALM. An ingress door holds this while it
   *  finds and verifies the row it is about to mint a product grant from, and
   *  it is a deliberate NON-ROW authority: there is no authenticated principal
   *  behind it yet, which is the whole reason it exists. Its envelope is
   *  `authority:acquisitionEnvelope`, its selection account is null, and its
   *  execution is EPHEMERAL — nested bodied calls persist no instance, no trace
   *  and no parent notification. */
  | "acquisition"
  | "interim-worker"
  | "anonymous"
  | "test";

/** The host-private record. `principal` is ATTRIBUTION ONLY — nothing reads it
 *  for a decision, and R4 is what makes it load-bearing. */
export type AuthorityRecord = {
  /** A Fenel `authority:Envelope` value. Opaque to this module. */
  readonly envelope: unknown;
  readonly issuer: AuthorityIssuer;
  readonly accountId: string | null;
  readonly principal: unknown;
  readonly lane: string | null;
  /** rights R2b — WHICH GRANT this authority was derived from: the
   *  `account_memberships.id` for a `request-session` mint, `null` for every
   *  other issuer.
   *
   *  ⚠ ATTRIBUTION, NOT A DECISION INPUT. Nothing in this phase reads it to
   *  permit or refuse anything; the envelope alone decides. It is here because
   *  rights R4 persists exactly this on the durable row and re-mints against the
   *  LIVE membership on wake, and adding the field later would be the same
   *  six-site edit under a second identity mint. */
  readonly grant: string | null;
  readonly mintedAt: number;
};

export class AuthorityMintRefused extends Error {
  readonly issuer: AuthorityIssuer;
  constructor(issuer: AuthorityIssuer, reason: string) {
    super(`authority mint refused for issuer "${issuer}": ${reason}`);
    this.name = "AuthorityMintRefused";
    this.issuer = issuer;
  }
}

/** The registry seam the mint needs. Structural rather than `ModuleRegistry` so
 *  this module stays free of a registry import cycle. */
export type AuthorityMintKernel = {
  /** Evaluate one `authority:` function under the registry's kernel frame. */
  evaluateAuthorityFunction(name: string, args: readonly unknown[]): unknown;
};

const records = new WeakMap<AuthorityRef, AuthorityRecord>();

/** Admission verdicts, keyed on the ENVELOPE VALUE's identity.
 *
 *  ⚠ THIS IS NOT THE VERDICT CACHE THE BRIEF FORBIDS, and the difference is the
 *  whole of why it is allowed. §4.1 rules out caching a DECISION about an act —
 *  `(handle, descriptor)` — because σ-binding requires the complete dependency
 *  revisions to be validated at the exercise boundary and none are. This caches
 *  the ADMISSION of an immutable envelope VALUE: "is this structure inside the
 *  fragment", a question with no act, no frame and no time in it.
 *
 *  What it elides is ALSO only the resource half. `authority:scalarSetShapeOk`
 *  still runs per act on every denotation-critical check (ledger `au.wf.shape`),
 *  so even a mutated envelope is re-shaped at exercise; the cache can only skip
 *  re-counting elements it already counted for the same object.
 *
 *  It exists because the member envelope is ONE enum over every descriptor the
 *  registry exposes and the registry MEMOISES that value — so the same object is
 *  re-admitted on every request. Measured: 10.96 ms per mint before, and a
 *  receipt page mints eleven times. */
const admissionVerdicts = new WeakMap<object, string | undefined>();

function ownTag(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (!Object.prototype.hasOwnProperty.call(value, "$tag")) return undefined;
  const tag = (value as Record<string, unknown>)["$tag"];
  return typeof tag === "string" ? tag : undefined;
}

/** Read a Fenel `Maybe String` at the `$`-key marshal boundary. `undefined`
 *  means `Nothing`; a string means `Just`. Any other shape is itself a refusal
 *  reason — an unreadable verdict is never a pass. */
function maybeStringReason(verdict: unknown): string | undefined {
  const tag = ownTag(verdict);
  if (tag === "Nothing") return undefined;
  if (tag === "Just") {
    const payload = (verdict as Record<string, unknown>)["_0"];
    return typeof payload === "string" && payload.length > 0
      ? payload
      : "checker returned a Just with no readable reason";
  }
  return "checker did not return a Maybe String";
}

/** THE mint. Validates the envelope AND the issuer through the Fenel fence,
 *  freezes the record, and hands back a fresh handle.
 *
 *  A throw from the checker is a refusal, not a pass: a kernel frame that
 *  cannot resolve `authority:mintRefusalReason` must not be able to mint. */
export function mintAuthority(
  kernel: AuthorityMintKernel,
  record: AuthorityRecord,
): AuthorityRef {
  // ⚠ THE ISSUER IS NOT CACHEABLE, ONLY THE STRUCTURE. `mintRefusalReason`
  // folds two questions together: is the envelope well-formed (about the VALUE)
  // and may THIS issuer hold it (about the caller). Caching the pair would be a
  // caller-keyed decision cache. So the structural half is memoised on the
  // envelope object and the issuer half is re-asked every time — it is one
  // pattern match and a string compare.
  const cacheable = typeof record.envelope === "object" && record.envelope !== null;
  const cached = cacheable ? admissionVerdicts.get(record.envelope as object) : undefined;
  const known = cacheable && admissionVerdicts.has(record.envelope as object);
  let reason: string | undefined;
  try {
    if (known) {
      reason = cached ?? maybeStringReason(kernel.evaluateAuthorityFunction(
        "authority:topIssuerRefusalReason",
        [record.envelope, record.issuer],
      ));
    } else {
      reason = maybeStringReason(kernel.evaluateAuthorityFunction(
        "authority:envelopeWellFormed",
        [record.envelope],
      ));
      if (cacheable) admissionVerdicts.set(record.envelope as object, reason);
      if (reason === undefined) {
        reason = maybeStringReason(kernel.evaluateAuthorityFunction(
          "authority:topIssuerRefusalReason",
          [record.envelope, record.issuer],
        ));
      }
    }
  } catch (error) {
    throw new AuthorityMintRefused(
      record.issuer,
      `the admission checker failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (reason !== undefined) throw new AuthorityMintRefused(record.issuer, reason);
  const handle = Object.freeze({}) as AuthorityRef;
  // ⚠ SHALLOW, and said so rather than claimed otherwise. The RECORD is frozen;
  // the envelope it points at is a Fenel value shared with the registry's
  // memoised projection, and deep-freezing it per mint would walk a
  // 1718-element enum on every request. No Fenel value can reach it — the
  // record never leaves this module except through `authenticateAuthority`,
  // whose only consumer is the gate.
  records.set(handle, Object.freeze({
    envelope: record.envelope,
    issuer: record.issuer,
    accountId: record.accountId,
    principal: record.principal,
    lane: record.lane,
    grant: record.grant,
    mintedAt: record.mintedAt,
  }));
  return handle;
}

/** The ONE read. An unminted or forged handle is `undefined`, which every
 *  caller must treat as "not authenticated". */
export function authenticateAuthority(
  ref: AuthorityRef | undefined,
): AuthorityRecord | undefined {
  return ref === undefined ? undefined : records.get(ref);
}

/** The structural face of an evaluation frame the ownership derivation needs.
 *  Deliberately NOT `EvaluateContext`: typing it structurally is what keeps this
 *  module import-free, and import-free is what keeps it out of every init cycle
 *  in the engine. */
export type VisibilityFrame = {
  readonly _authority?: AuthorityRef | undefined;
  readonly _activeTags?: readonly string[] | undefined;
};

/** rights R3a Ruling 3 — THE ACCOUNT IS DERIVED FROM THE AUTHENTICATED
 *  AUTHORITY, never from a context field. Boot, harness and kernel frames hold
 *  no account and yield `null`; a forged or unminted handle authenticates to
 *  `undefined` and also yields `null`; an empty string is not an account.
 *
 *  ⚠ `AuthorityRecord.accountId` is a SELECTION input here and NEVER a judgment
 *  input — the gate decides `act ∈ envelope` and nothing on this path touches
 *  that.
 *
 *  ⚠ IT LIVES HERE, NOT BESIDE THE PREDICATE THAT CONSUMES IT. `json-logic.ts`
 *  needs it to thread the coordinate to the Fenel resolver, and importing
 *  `dispatch-registry` from there inverts the engine's module-init order —
 *  `installServedDispatcher` then runs while `json-logic`'s own top level is
 *  still in its temporal dead zone. One definition, in the import-free module.
 *
 *  rights R6: once delegation ships, the SELECTION account may be the grant's
 *  PARTITION rather than the caller's home account. That lands in the write
 *  path's disposition and here; R6 must not inherit "the mint account is always
 *  the visibility account". */
export function frameAccount(ctx: VisibilityFrame | undefined): string | null {
  const accountId = authenticateAuthority(ctx?._authority)?.accountId;
  return typeof accountId === "string" && accountId !== "" ? accountId : null;
}

