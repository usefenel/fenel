// ---------------------------------------------------------------------------
// proxy-tracking — exact Proxy detection for realms without
// `node:util.types.isProxy` (browsers, Web Workers, Node ESM without require),
// for the S1 engine-body memo's encoder (design/tcb-ledger.md row
// engine.memo.engine-body-replay; host glue under the S1 approval).
//
// `proxy-tracking-install.ts` replaces the realm's `Proxy` constructor and
// `Proxy.revocable` with wrappers that add every created proxy to a private
// WeakSet; the detector is `WeakSet.has`. That equals `util.types.isProxy`
// for every proxy created after installation. It is exact for the realm when
// ALL of these hold, and the detector is withheld otherwise:
//   1. installation runs before any other code of the realm creates a proxy:
//      the install module (`proxy-tracking-install.ts`, side effect only, with
//      only its inert state leaf imported) is the FIRST import of the entry.
//      `engine-require.ts` (the root every engine module imports)
//      records at its own evaluation whether tracking was already installed;
//      if not, installation is LATE and the detector is withheld for the
//      realm's life. Non-engine code evaluated before the install module is
//      not checked: keep the install import first;
//   2. the realm receives no proxy from another realm: a Worker only receives
//      structured clones (postMessage cannot carry proxies); a window realm
//      with same-origin iframes is NOT covered (don't install the memo there);
//   3. no code captured the native constructor before installation (implied
//      by 1, since only code that ran earlier could have).
// A known engine module-level proxy (`type-foundation.ts` `Str`) is checked
// as a canary at detection time: if it exists and is not tracked, the
// detector is withheld.
// ---------------------------------------------------------------------------

import { engineRequire, proxyTrackingInstalledBeforeEngine } from "./engine-require";
import { getProxyTrackingDetector, type ProxyTrackingDetector } from "./proxy-tracking-state";

/** The realm's exact detector, or null when tracking is not installed, was
 * installed after the engine's root module evaluated, or the canary proxy
 * escaped it. */
export function trackedProxyDetector(): ((value: unknown) => boolean) | null {
  const current = getProxyTrackingDetector();
  if (current === null || !proxyTrackingInstalledBeforeEngine()) return null;
  if (!canaryTracked(current)) return null;
  return current;
}

/**
 * The worker-entry pattern (S1b): the realm's entry module contains ONLY
 *
 *     import "<path>/proxy-tracking-install";
 *     await import("./real-entry");
 *
 * so the install module evaluates, alone, before any other module of the
 * realm (a static import list would let a bundler hoist shared chunks above
 * it; the dynamic import makes the rest of the graph start after it). The
 * real entry calls this first: it throws when the engine's root module
 * evaluated before the install (the pattern was not followed), so a broken
 * entry fails loudly instead of silently running without the memo.
 */
export function assertProxyTrackingPrecededEngine(): void {
  if (getProxyTrackingDetector() === null) {
    throw new Error("proxy tracking is not installed: the worker entry must import proxy-tracking-install first");
  }
  if (!proxyTrackingInstalledBeforeEngine()) {
    throw new Error("proxy tracking was installed after the engine's root module evaluated: the worker entry must be only the install import followed by a dynamic import of the real entry");
  }
}

function canaryTracked(detector: ProxyTrackingDetector): boolean {
  let foundation: { readonly Str?: unknown } | undefined;
  try {
    foundation = engineRequire("type-foundation") as { readonly Str?: unknown };
  } catch {
    return true; // not loaded in this realm: nothing to check
  }
  const str = foundation?.Str;
  return str === undefined || str === null || typeof str !== "object" || detector(str);
}
