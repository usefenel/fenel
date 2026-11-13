import type { WorkspaceBootstrapReply } from "./workspace-wire";
// ---------------------------------------------------------------------------
// Frontend auth state — current `Subject` + login / logout helpers.
//
// A single shared signal holds the resolved Subject. The auth guard
// component reads it to decide whether to render the route or request the
// sign-in dialog on Home. The dialog mutates it on success.
//
// Authentication itself is cookie-based — the server sets `fenel_session`
// as `HttpOnly` on `/api/auth/login`, so the browser includes it
// automatically on every same-origin request. The client never holds the
// raw token; it only knows which Subject the cookie resolves to (via
// `/api/auth/me`).
// ---------------------------------------------------------------------------

import { createSignal, flush } from "solid-js";
import type { Maybe } from "@fenel/engine/type-foundation";
import { clearAccountFieldRegistry } from "./account-field-registry";
import { apiFetch, apiRead, createAccountApiClient, setApiAccountScope, type ApiClient } from "./api";
import { setUserRegistryAccountScope } from "./user-registries";
import { assertCurrentSession, endBootFrame, inBootFrame, onAccountChangedElsewhere, onAuthenticationLost, sessionEpoch, stageBrowserAccountScope } from "./browser-session";
import { waitForApiReady, type ApiReadiness } from "./api-readiness";
import type { LocusRootData } from "./locus-root-data";

/** Mirrors the `Subject` discriminated union in `@fenel/core/subject`.
 *
 *  The server serialises this Fenel ADT with the canonical `$tag`
 *  discriminator (PascalCase constructor names — `User` / `Bot` /
 *  `Anonymous` / `System`), NOT the legacy `{ kind: "user" }` shape. The
 *  earlier `kind`-based type silently broke login: `/auth/me` returns
 *  `{ $tag: "User", … }`, so `s.kind` was `undefined`, `isAuthenticated()`
 *  returned false, and the auth guard bounced every logged-in user back to
 *  /login with no error. Keep this in lockstep with `@fenel/core/subject`. */
export type Subject =
  | { $tag: "User"; accountId: string; userId: string }
  | { $tag: "Bot"; accountId: string; botId: string }
  | { $tag: "Anonymous"; sessionId?: string }
  | { $tag: "System" };

/** Transport shape of auth.UserProfile; the fields are authored in Fenel. */
export type UserProfile = { $tag: "UserProfile"; email: string; name: Maybe<string> };

const [subject, setSubject] = createSignal<Subject | null>(null);
const [userProfile, setUserProfile] = createSignal<UserProfile>();
export { userProfile };
const [loading, setLoading] = createSignal<boolean>(true);
const [subjectResolutionError, setSubjectResolutionError] = createSignal<string>();
export { subjectResolutionError };
const [accountSwitchError, setAccountSwitchError] = createSignal<string | null>(null);
export { accountSwitchError };
const [accountSelectionPending, setAccountSelectionPending] = createSignal(false);
export { accountSelectionPending, setAccountSelectionPending };
export const dismissAccountSwitchError = () => { setAccountSwitchError(null); };
let authRequest = 0;

function publishSubject(
  next: Subject | null,
  { newSession = false, pending = next === null, profile }: { newSession?: boolean; pending?: boolean; profile?: UserProfile } = {},
): void {
  const nextAccount = next?.$tag === "User" || next?.$tag === "Bot" ? next.accountId : undefined;
  const previous = subject();
  // The boot frame is anonymous by transport: no account scope, and its API
  // requests send no cookie (api.ts). Confirming that the session is
  // anonymous keeps that frame, so public and Local preparation started
  // before /auth/me stays current. Any identity or session change ends the
  // boot frame for good; a later null -> Anonymous (failed sign-in) advances.
  const bootAnonymousConfirmed = inBootFrame() && !newSession && previous === null && next?.$tag === "Anonymous";
  if (next !== null || newSession) endBootFrame();
  if (!bootAnonymousConfirmed && (newSession || JSON.stringify(previous) !== JSON.stringify(next))) {
    clearAccountFieldRegistry();
    setUserRegistryAccountScope(undefined);
    stageBrowserAccountScope(nextAccount, true);
  }
  setApiAccountScope(nextAccount);
  setUserRegistryAccountScope(nextAccount);
  setSubject(next);
  setSubjectResolutionError(undefined);
  setUserProfile(next?.$tag === "User" ? profile : undefined);
  setLoading(pending);
  // Publishing an identity is a security boundary, not a render update: logout
  // must clear the previous subject BEFORE its network response, and callers
  // read subject()/isAuthenticated() imperatively in the same tick. Solid 2
  // stages signal writes to the microtask queue. Commit subject, account
  // invalidation, and loading state together so reactive readers
  // never observe the previous subject in the new session.
  flush();
}

onAuthenticationLost(() => {
  authRequest += 1;
  publishSubject({ $tag: "Anonymous" });
});

// Every tab sends the same session cookie, so a switch in one tab changes the
// account of all of them. The server refuses a request that states the old
// account; this tab then re-reads which account the session holds. A switch
// is also broadcast, so the other tabs learn at once rather than on their next
// request.
onAccountChangedElsewhere(() => { void refreshSubject().catch(() => undefined); });
const sessionChannel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("fenel-session");
sessionChannel?.addEventListener("message", (event) => {
  if ((event.data as { kind?: unknown } | null)?.kind === "account-switched") void refreshSubject().catch(() => undefined);
});

/** Reactive accessor for the current resolved Subject (null = not yet
 *  loaded; an `anonymous`-kind value = logged out). */
export { subject };

/** Reactive accessor — true while authentication or cookie revocation is pending. */
export { loading };

/** True when the current subject is an account-bound actor. */
export function isAuthenticated(): boolean {
  const s = subject();
  return s !== null && (s.$tag === "User" || s.$tag === "Bot");
}

/**
 * Resolve the current subject from the server. Call once at app start
 * (the auth guard handles this automatically) and after login / logout.
 */
export function refreshSubject(options: { signal?: AbortSignal } = {}): Promise<Subject | null> {
  return resolveSubject(++authRequest, options.signal);
}

const SUBJECT_TIMEOUT_MS = 60_000;

async function resolveSubject(request: number, signal?: AbortSignal): Promise<Subject | null> {
  const epoch = sessionEpoch();
  setLoading(true);
  // A failed session read leaves identity unresolved. An outage is not proof
  // that the person is signed out, so sign-in remains unavailable until retry.
  const bound = new AbortController();
  const boundTimer = setTimeout(() => bound.abort(), SUBJECT_TIMEOUT_MS);
  try {
    signal?.throwIfAborted();
    const res = await fetch("/api/auth/me", {
      credentials: "include", signal: signal ? AbortSignal.any([signal, bound.signal]) : bound.signal,
    });
    signal?.throwIfAborted();
    if (request !== authRequest || epoch !== sessionEpoch()) return subject();
    if (res.status === 401 || res.status === 403) {
      publishSubject({ $tag: "Anonymous" });
      return { $tag: "Anonymous" };
    }
    if (!res.ok) throw new Error("Could not check your sign-in. Please retry.");
    const body = (await res.json()) as { subject: Subject; profile?: UserProfile };
    signal?.throwIfAborted();
    if (request !== authRequest || epoch !== sessionEpoch()) return subject();
    publishSubject(body.subject, { profile: body.profile });
    return body.subject;
  } catch (error) {
    signal?.throwIfAborted();
    if (request !== authRequest || epoch !== sessionEpoch()) return subject();
    publishSubject(null, { pending: false });
    const failure = bound.signal.aborted ? new Error("Checking your sign-in timed out. Please retry.") : error;
    setSubjectResolutionError(failure instanceof Error ? failure.message : "Could not check your sign-in. Please retry.");
    throw failure;
  } finally {
    clearTimeout(boundTimer);
    if (request === authRequest) setLoading(false);
  }
}

/** Wait for API readiness, then submit credentials once. Cancellation also
 *  prevents late responses from publishing a subject or completing sign-in. */
export async function login(input: {
  email: string;
  password: string;
}, options: { signal?: AbortSignal; onStatus?: (status: ApiReadiness) => void } = {}): Promise<Subject> {
  const request = ++authRequest;
  const signal = options.signal ?? new AbortController().signal;
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (request !== authRequest) throw new Error("Sign-in was superseded by another session change");
  };
  publishSubject(null, { newSession: true });
  try {
    await waitForApiReady({ signal, onStatus: options.onStatus });
    assertCurrent();
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
      signal,
    });
    assertCurrent();
    if (!res.ok) {
      // Proxies return plain text or HTML while the API is starting or down.
      // Only an authentication rejection means the credentials were invalid.
      if (res.status >= 500) {
        throw new Error("Sign-in is temporarily unavailable. Please try again in a moment.");
      }
      let message = res.status === 401
        ? "Invalid email or password"
        : res.status === 429
          ? "Too many sign-in attempts. Please try again later."
          : "Sign-in failed. Please try again.";
      try {
        const body = (await res.json()) as { error?: unknown } | null;
        if (typeof body?.error === "string" && body.error.trim()) message = body.error;
      } catch {
        // Non-JSON responses retain the status-specific message.
      }
      throw new Error(message);
    }
    const result = await resolveSubject(request, signal);
    assertCurrent();
    if (result?.$tag !== "User" && result?.$tag !== "Bot") {
      throw new Error("Login succeeded but session resolution failed");
    }
    return result;
  } catch (error) {
    if (request === authRequest) {
      publishSubject({ $tag: "Anonymous" });
    }
    throw error;
  }
}

export type AccessibleAccount = { accountId: string; name: string; slug: string; role: string };

/** Server-selected startup data, bound to this authenticated login epoch.
 * The existing Fenel model selects/validates literal preferences on the server;
 * authored expressions explicitly defer to the browser evaluator. */
export type WorkspaceBootstrap = {
  accountId: string;
  epoch: number;
  personalAccountId: string;
  root: LocusRootData;
  allDataRoot?: LocusRootData;
  accounts: AccessibleAccount[];
  workspace?: WorkspaceBootstrapReply["workspace"];
};

/** Acquire the checked workspace projection while browser code loads. The
 * transport never guesses a source, interprets preferences or writes a value. */
export async function loadWorkspaceBootstrap(accountId: string, options: {
  epoch?: number;
  signal: AbortSignal;
  onStage?: (stage: string) => void;
}): Promise<WorkspaceBootstrap> {
  const epoch = options.epoch ?? sessionEpoch();
  const cancellation = new AbortController();
  const signal = AbortSignal.any([options.signal, cancellation.signal]);
  const assertActive = () => {
    signal.throwIfAborted();
    assertCurrentSession(epoch);
  };
  assertActive();
  const current = subject();
  if (current?.$tag !== "User" || current.accountId !== accountId) {
    throw new Error("Sign in to load your data.");
  }
  let client: ApiClient | undefined;
  const abortReader = () => client?.dispose();
  signal.addEventListener("abort", abortReader, { once: true });
  try {
    options.onStage?.("Loading data…");
    const personal = await apiFetch<{ accountId: string }>("/auth/personal-account", { method: "POST", signal });
    assertActive();
    client = createAccountApiClient(personal.accountId, { epoch });
    const width = typeof window === "undefined" ? 1280 : window.innerWidth;
    let saved: WorkspaceBootstrapReply;
    try {
      saved = await client.apiRead<WorkspaceBootstrapReply>(`/workspace-bootstrap?width=${width}`);
    } catch (error) {
      // A running app server can predate this route during a staged update.
      // Only an absent route uses the original authenticated browser restore;
      // refusals, invalid preferences and service failures remain failures.
      if (!(error && typeof error === "object" && "status" in error && error.status === 404)) throw error;
      const [root, access] = await Promise.all([
        client.getLocusRoot.uncached(), apiFetch<{ accounts: AccessibleAccount[] }>("/auth/accounts", { signal }),
      ]);
      assertActive();
      return { accountId, epoch, personalAccountId: personal.accountId, root: root.root, accounts: access.accounts };
    }
    assertActive();
    if (saved.accountId !== accountId || saved.personalAccountId !== personal.accountId) {
      throw new Error("Your account changed while loading your data. Please retry.");
    }
    return { ...saved, epoch };

  } finally {
    signal.removeEventListener("abort", abortReader);
    cancellation.abort();
    client?.dispose();
  }
}

/** Only whole-account memberships are returned. Local lists and future
 * item-level grants do not become extra accounts in this selector. */
export async function listAccessibleAccounts(): Promise<AccessibleAccount[]> {
  return (await apiRead<{ accounts: AccessibleAccount[] }>("/auth/accounts")).accounts;
}

/** The caller finishes pending edits first. Revoke browser scope before the
 * cookie can change, so the old surface cannot send a write as the new account.
 * The selection POST is sent once; only session resolution may be retried. */
export async function switchAccount(accountId: string): Promise<Subject> {
  const previous = subject();
  if (previous?.$tag !== "User") throw new Error("Sign in to choose account data.");
  if (previous.accountId === accountId) return previous;
  const request = ++authRequest;
  const controller = new AbortController();
  const assertCurrent = () => {
    if (request !== authRequest) throw new Error("Account selection was superseded by another session change");
  };
  setAccountSwitchError(null);
  publishSubject(null, { newSession: true });
  try {
    await waitForApiReady({ signal: controller.signal });
    assertCurrent();
    const response = await fetch("/api/auth/switch-account", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }), signal: controller.signal,
    });
    assertCurrent();
    if (!response.ok) {
      let message = "Could not change account data. Please try again.";
      const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
      if (typeof body?.error === "string") message = body.error;
      throw new Error(message);
    }
    const resolved = await resolveSubject(request, controller.signal);
    assertCurrent();
    if (resolved?.$tag !== "User" || resolved.accountId !== accountId || resolved.userId !== previous.userId) {
      throw new Error("The selected account session could not be confirmed. Please try again.");
    }
    sessionChannel?.postMessage({ kind: "account-switched" });
    return resolved;
  } catch (error) {
    if (request === authRequest) {
      // A lost POST response may have changed the cookie. Ask the server which
      // account it actually represents; never restore the old identity by guess.
      await resolveSubject(request).catch(() => undefined);
      if (request === authRequest) setAccountSwitchError(error instanceof Error ? error.message : "Could not change account data.");
    }
    throw error;
  }
}

/** Return navigation after sign-in stays in the application origin. */
export function localReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/app";
  const path = new URL(value, "https://fenel.invalid");
  return path.pathname === "/login" ? "/app" : `${path.pathname}${path.search}${path.hash}`;
}

/** Revoke the current session and clear the local Subject. */
export async function logout(): Promise<void> {
  const request = ++authRequest;
  // Clear private state immediately, but wait for cookie revocation before
  // the guard mounts /login (whose initial /auth/me would reuse the cookie).
  publishSubject({ $tag: "Anonymous" }, { newSession: true, pending: true });
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Server-side revoke is best-effort; we always clear local state.
  } finally {
    if (request === authRequest) setLoading(false);
  }
}

/** Internal — used by the auth provider to seed initial state without
 *  triggering a duplicate `/auth/me` call. */
export function _setSubject(s: Subject | null): void {
  authRequest += 1;
  publishSubject(s);
}
