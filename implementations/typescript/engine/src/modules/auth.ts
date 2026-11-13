// ---------------------------------------------------------------------------
// Auth — module-substrate Phase 3m seam (the cross-file header UNION + dup-name
// load-error representative; OQ3, the last unproven load-time SUBSTRATE axis).
//
// THE NEW MECHANISM this seam exercises: `loadFenelModuleUnion` parses the 3
// auth `.fenel` files INDEPENDENTLY and GROUPS them by their `module … where`
// header (OQ3 — the header is identity, not the directory / `name` arg):
//   - `subject.fenel`  (header `module subject where`) → the `subject` group
//     (the Subject ADT + 5 accessors). It does NOT fold into `auth`.
//   - `session.fenel` + `cookies.fenel` (BOTH `module auth where`) → the `auth`
//     group, UNIONED into one namespace (the 6 orchestrators + 2 cookie helpers
//     + 8 private session helpers + IssuedSession/ResolvedSession). A top-level
//     name colliding across the two files would throw a precise load-time error.
//
// This RETIRES the ~370-LOC hand-merge the pre-migration `auth.ts` performed:
// it loaded each file under a throwaway internal name, hand-extracted bodies by
// id, re-wrapped every function in a `defineFunction` spec, re-prefixed to the
// public namespace, AND ran a separate loop to re-register the 8 private session
// helpers Codeable-only. All of that is gone — the union does the file→module
// mapping; the identity facets ride @directives in the `.fenel` files; the 8
// helpers are ordinary directive-free defs (Codeable-only via the Phase-3j
// loader default, the `permissions` precedent).
//
// THE DECISION (brief §): Option A (DECOMPOSE — subject is its OWN module). The
// union genuinely produces TWO modules (`auth` + `subject`), proving header-is-
// identity AND the union as distinct mechanisms. For BOOT-LIST parity the seam
// folds the `subject` group into the single exported `authModule` — the
// `subject:*` ids were baked from `subject.fenel`'s header at LOAD time, so they
// survive the fold (the registry indexes by fn.id, never re-prefixing by module
// name). Every consumer imports `authModule` by name → 0 boot-list / consumer
// edits, full parity, while the union (not a hand re-wrap) does the assembly.
//
// `core/auth.ts` calls `invokeIOAction("auth:<name>")` (the fn.id colon form);
// the body dispatcher registers a handler at every `fn.id`, so the migrated
// `auth:issueSession` etc. keep working with NO runtime edit. The 6
// orchestrators ALSO carry `@ioAction "auth.<name>"` → the public IOInvokable
// dot-form handler (byte-parity with the retired specs). HasStateIO is INFERRED
// from their `state:*` calls, not declared (the 3a precedent).
//
// The `subject:accountId` / `subject:actorId` id-suffix ≠ codeName divergence
// (`subjectAccountId` / `subjectActorId`) is reproduced by the def-head rename +
// `@codeName` (Phase 3c) in `subject.fenel`. The seam re-exports `authModule`
// by name only — the pre-migration export contract.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModuleUnion } from "../fenel-module";
import SUBJECT_FENEL from "../../../../../fenel/modules/auth/subject.fenel?raw";
import SESSION_FENEL from "../../../../../fenel/modules/auth/session.fenel?raw";
import COOKIES_FENEL from "../../../../../fenel/modules/auth/cookies.fenel?raw";
// rights R2b — the third file of the `auth` union: member management.
import MEMBERSHIP_FENEL from "../../../../../fenel/modules/auth/membership.fenel?raw";
// 2026-09-23 — account selection (listing a user's accounts, switching the
// session), reached through the privileged auth door like the session lifecycle.
import ACCOUNTS_FENEL from "../../../../../fenel/modules/auth/accounts.fenel?raw";

// The cross-file UNION entry point — parse each file independently (never
// string-concat), group by header. `session.fenel` + `cookies.fenel` (both
// `module auth where`) UNION into `auth`; `subject.fenel` (`module subject
// where`) stays its own group. The `name` args are header-overridden fallbacks.
const groups = loadFenelModuleUnion(
  [
    { src: SUBJECT_FENEL, name: "subject" },
    { src: SESSION_FENEL, name: "auth" },
    { src: COOKIES_FENEL, name: "auth" },
    { src: MEMBERSHIP_FENEL, name: "auth" },
    { src: ACCOUNTS_FENEL, name: "auth" },
  ],
  { labels: { auth: "Auth" } },
);

const authGroup = groups.find((m) => m.name === "auth");
const subjectGroup = groups.find((m) => m.name === "subject");
if (!authGroup || !subjectGroup) {
  throw new Error(
    "auth: loadFenelModuleUnion did not yield the expected `auth` + `subject` groups — Fenel sources out of sync with the seam",
  );
}

// Fold the `subject` group into the single `authModule` export (its `subject:*`
// ids + the Subject entity ride along, keeping their header-driven ids). The
// `auth` group carries IssuedSession/ResolvedSession + the auth:* members.
export const authModule: FenelModule = {
  ...authGroup,
  // The subject header remains a distinct exact function namespace even though
  // boot-list compatibility folds its functions into the auth display module.
  functionNamespaceOverrides: (subjectGroup.functions ?? []).map((fn) => ({
    functionId: fn.id,
    namespace: subjectGroup.name,
  })),
  functions: [...(authGroup.functions ?? []), ...(subjectGroup.functions ?? [])],
  functionSignatureDeclarations: [
    ...(authGroup.functionSignatureDeclarations ?? []),
    ...(subjectGroup.functionSignatureDeclarations ?? []),
  ],
  entities: [...(authGroup.entities ?? []), ...(subjectGroup.entities ?? [])],
  instances: [...(authGroup.instances ?? []), ...(subjectGroup.instances ?? [])],
};
