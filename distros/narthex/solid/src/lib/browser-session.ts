// Browser-host lifecycle boundary shared by HTTP, auth and display caches.
// An epoch also distinguishes two sessions for the same account (including ABA).
import { createSignal, flush } from "solid-js";

let accountId: string | undefined;
let epoch = 0;
const [sessionEpoch, setSessionEpoch] = createSignal(epoch);
const sessionListeners = new Set<() => void>();
const mutationListeners = new Set<() => void>();
let authenticationLost: (() => void) | undefined;
// True until auth publishes the tab's first identity or starts a session
// change. It never becomes true again.
let bootFrame = true;

export { sessionEpoch };

export function onBrowserSessionChange(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function onApiMutation(listener: () => void): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

export function notifyApiMutation(): void {
  for (const listener of mutationListeners) listener();
}

export function setBrowserAccountScope(next: string | undefined, force = false): void {
  if (stageBrowserAccountScope(next, force)) flush();
}

/** Internal auth transaction: stage the epoch with the subject before flushing. */
export function stageBrowserAccountScope(next: string | undefined, force = false): boolean {
  if (!force && accountId === next) return false;
  accountId = next;
  epoch += 1;
  for (const listener of sessionListeners) listener();
  setSessionEpoch(epoch);
  // The caller must publish staged auth state before returning to request
  // capture, which uses sessionEpoch while validation uses the plain epoch.
  return true;
}

/** Before /auth/me first answers, API requests carry no cookie, so every
 *  boot response is anonymous by transport and stays valid when the session
 *  is confirmed anonymous. */
export function inBootFrame(): boolean {
  return bootFrame;
}

export function endBootFrame(): void {
  bootFrame = false;
}

export function onAuthenticationLost(listener: () => void): void {
  authenticationLost = listener;
}

/** The account this tab's surfaces were rendered for, if one is bound. Every
 *  request states it, so a request cannot run as an account another tab
 *  switched the shared session cookie to. */
export function browserAccountScope(): string | undefined {
  return accountId;
}

let accountChangedElsewhere: (() => void) | undefined;

/** Registered by the auth module: re-read which account the session holds. */
export function onAccountChangedElsewhere(listener: () => void): void {
  accountChangedElsewhere = listener;
}

/** The server refused a request because the session's account is no longer
 *  the one this tab states. Only the request's own session can report it. */
export function reportAccountChangedElsewhere(requestEpoch: number): void {
  if (requestEpoch !== epoch) return;
  accountChangedElsewhere?.();
}

export function expireBrowserSession(requestEpoch: number): void {
  if (requestEpoch !== epoch) return;
  stageBrowserAccountScope(undefined, true);
  // The auth callback stages the anonymous subject before its final flush;
  // publishing the epoch first would rerun private reads with the old subject.
  if (authenticationLost) authenticationLost();
  else flush();
}

export class StaleSessionResponseError extends Error {
  constructor() {
    super("The session changed while this request was in flight");
    this.name = "StaleSessionResponseError";
  }
}

export function assertCurrentSession(requestEpoch: number): void {
  if (requestEpoch !== epoch) throw new StaleSessionResponseError();
}
