// ---------------------------------------------------------------------------
// Subject — who is acting on the system.
//
// A Subject is the identity attached to every request, action, and dispatch.
// It is the input to the permission/policy layer and the resolver: the
// system asks "who is this?" before deciding what they can see, write, or
// execute.
//
// Lives in @fenel/core (not @fenel/engine) on purpose: the engine is a
// pure type/algebra layer that should not opine on the actor taxonomy of
// any particular application. Subject is an *application-level* concept —
// the engine threads partition keys and a privileged-bypass flag through
// its context, and the application maps a richer Subject to those.
//
// Distinct from `accountId: string`, which is a *partition key*. A Subject
// carries the partition key (when applicable) PLUS the identity of the
// individual actor — so policies can express things like "members of org X
// may read entity Y" or "only the bot service may run this funnel".
//
// Variants:
//   - User       : an authenticated end-user (dashboard, API token, …)
//   - Bot        : a programmatic actor running on behalf of an account
//                  (Telegram bot, scheduled job, webhook caller)
//   - Anonymous  : a public visitor — no account binding (funnel widget hit,
//                  unauthenticated read of a public registry)
//
// rights R2a DELETED the `System` variant and `systemSubject()` / `isSystem`.
// `System` existed to bypass the second policy engine, and four TypeScript
// sites manufactured one out of thin air to do exactly that. A Subject is
// attribution; what an execution may DO is the envelope on its frame, judged
// at exercise by `perform`. See `design/authority.md`.
//
// Phase 12c-core sub-step 1 — Subject ADT lifted to a Fenel-native $variant
// with PascalCase $tag discriminators. The TS shape mirrors the Fenel ADT
// (Decision A2: canonical Fenel form + cascade flip). The 5 accessor
// helpers below stay as 1-line $tag pattern-match shims for sync-callsite
// ergonomics (middleware constructs Subject per-request — IO-action
// indirection would be costly on the hot path); the Fenel bodies in
// engine/src/modules/auth.ts are the source of truth.
// ---------------------------------------------------------------------------

/**
 * The identity of an actor making a request.
 *
 * Discriminated by `$tag`. Use `subjectAccountId` when you need the
 * partition key without caring about the variant.
 */
export type Subject =
  | { $tag: "User"; accountId: string; userId: string }
  | { $tag: "Bot"; accountId: string; botId: string }
  | { $tag: "Anonymous"; sessionId?: string };

/** A user authenticated against an account (dashboard, API token, etc.). */
export function userSubject(accountId: string, userId: string): Subject {
  return { $tag: "User", accountId, userId };
}

/** A programmatic actor (bot, scheduled job, webhook) bound to an account. */
export function botSubject(accountId: string, botId: string): Subject {
  return { $tag: "Bot", accountId, botId };
}

/** A public visitor with no account binding. */
export function anonymousSubject(sessionId?: string): Subject {
  return sessionId === undefined ? { $tag: "Anonymous" } : { $tag: "Anonymous", sessionId };
}

/**
 * Extract the account partition key, if the subject is bound to one.
 *
 * Returns `undefined` for anonymous and system subjects — callers that need
 * a definite accountId must handle that case explicitly (e.g. reject the
 * request, or fall back to a public read path).
 */
export function subjectAccountId(s: Subject): string | undefined {
  switch (s.$tag) {
    case "User":
    case "Bot":
      return s.accountId;
    case "Anonymous":
      return undefined;
  }
}

/**
 * Extract the account partition key, throwing when the subject is not
 * bound to one.
 *
 * Use this at the entry point of code paths that intrinsically require an
 * account context (DB writes, account-scoped queries) — fail loudly rather
 * than silently producing partition-less queries.
 */
export function requireAccountId(s: Subject): string {
  const id = subjectAccountId(s);
  if (id === undefined) {
    throw new Error(
      `Subject ($tag=${s.$tag}) has no accountId — this code path requires an account-bound subject`,
    );
  }
  return id;
}

/**
 * The actor's stable identifier within its kind, for audit / logging.
 * Returns `undefined` for system and unsessioned anonymous subjects.
 */
export function subjectActorId(s: Subject): string | undefined {
  switch (s.$tag) {
    case "User":
      return s.userId;
    case "Bot":
      return s.botId;
    case "Anonymous":
      return s.sessionId;
  }
}

/** True when the subject represents an authenticated, account-bound actor. */
export function isAuthenticated(s: Subject): s is Extract<Subject, { $tag: "User" | "Bot" }> {
  return s.$tag === "User" || s.$tag === "Bot";
}
