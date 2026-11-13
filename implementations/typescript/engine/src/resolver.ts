// ---------------------------------------------------------------------------
// Resolver — per-request engine context.
//
// The engine has several pieces of mutable state that are scoped per
// account: typeclass instances tagged `scope: "account"`, named-set
// predicates (`format:my-id`), `$decompose` parsers, user-authored
// functions. Looking these up correctly requires knowing which account's
// view the engine should see right now.
//
// Historically the engine has been "global with implicit current
// account": the per-account state is registered in shared maps and
// callers pass `{ accountId }` into helpers like `contains` to opt into
// account overrides. That works for a single-account dev tunnel; it
// doesn't compose across requests when one process serves many
// accounts.
//
// `Resolver` is the seam that lets dispatch / query / contains call
// sites take a single object and route every per-account lookup
// consistently. It carries:
//
//   - `accountId`: the partition the engine is acting within (typically
//                  the *resource* partition, equal to the request's
//                  effective account)
//   - `subject`:   an opaque identity object — the engine doesn't use
//                  this directly, but threads it so policy/audit code
//                  downstream sees who is asking
//   - `extra`:     room for future fields (registry imports, locale, …)
//                  without breaking call sites
//
// At this seam the type is intentionally minimal. Call sites that need
// more (e.g. a registry-imports list) extend by reading `extra` and
// downcasting; once enough call sites need the field, promote it to a
// real property.
//
// `Subject` is intentionally typed as `unknown` here: the engine does
// not depend on `@fenel/core`, where the actor taxonomy lives. Engine
// code that needs the subject (rare — the engine is identity-agnostic
// by design) treats it as opaque.
// ---------------------------------------------------------------------------

/**
 * The per-request resolution context.
 *
 * Construct with `createResolver({ accountId })` at the request entry
 * point and pass it into engine helpers that accept it. Helpers that
 * don't yet take a Resolver still work — Resolver is additive scaffolding
 * for future call-site adoption.
 */
export type Resolver = {
  /** The account partition the engine is acting within, if known. */
  accountId?: string;
  /** Opaque actor identity (typed `unknown` to avoid coupling the engine
   *  to the application's `Subject` ADT). */
  subject?: unknown;
  /** Bag for future fields without breaking call sites. */
  extra?: Record<string, unknown>;
};

export type CreateResolverOptions = {
  accountId?: string;
  subject?: unknown;
  extra?: Record<string, unknown>;
};

/** Construct a Resolver. All fields optional; an empty resolver is the
 *  "no per-account scope" view (built-ins only). */
export function createResolver(opts: CreateResolverOptions = {}): Resolver {
  const r: Resolver = {};
  if (opts.accountId !== undefined) r.accountId = opts.accountId;
  if (opts.subject !== undefined) r.subject = opts.subject;
  if (opts.extra !== undefined) r.extra = opts.extra;
  return r;
}

/** Default resolver — no per-account scope; only built-ins resolve. */
export const SYSTEM_RESOLVER: Resolver = Object.freeze({});

/**
 * Convert a `Resolver` to the `{ accountId? }` ctx shape that
 * `set-algebra.contains`, `decompose`, and similar engine helpers
 * already accept. Use this when calling into helpers that haven't yet
 * been migrated to take a `Resolver` directly.
 */
export function resolverToCtx(r: Resolver): { accountId?: string } {
  return r.accountId === undefined ? {} : { accountId: r.accountId };
}

/**
 * Build a Resolver scoped to a different accountId, preserving the
 * subject / extra payload. Useful when the engine crosses into
 * another account's namespace (e.g. resolving a name from an
 * imported registry that is owned by a different account).
 */
export function withAccountId(r: Resolver, accountId: string | undefined): Resolver {
  if (r.accountId === accountId) return r;
  const next: Resolver = { ...r };
  if (accountId === undefined) delete next.accountId;
  else next.accountId = accountId;
  return next;
}
