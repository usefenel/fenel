// ---------------------------------------------------------------------------
// Side effect only, importing only the inert state leaf: install Proxy tracking
// for this realm (S1 engine-body memo; conditions in proxy-tracking.ts). Must be
// the FIRST import of the realm's entry module, so it evaluates before any
// other module can create a proxy. Replaces `Proxy` and `Proxy.revocable` with
// wrappers that add every created proxy to a private WeakSet. Only its detector
// is published through the shared state leaf; installation is idempotent.
// ---------------------------------------------------------------------------
import { getProxyTrackingDetector, installProxyTrackingDetector } from "./proxy-tracking-state";

if (getProxyTrackingDetector() === null) {
  const NativeProxy = globalThis.Proxy;
  const nativeRevocable = NativeProxy.revocable;
  const tracked = new WeakSet<object>();
  const TrackingProxy = function Proxy(this: unknown, target: object, handler: ProxyHandler<object>): object {
    if (new.target === undefined) throw new TypeError("Constructor Proxy requires 'new'");
    const proxy = Reflect.construct(NativeProxy, [target, handler]) as object;
    tracked.add(proxy);
    return proxy;
  } as unknown as ProxyConstructor;
  // Like the native constructor: no `prototype` (so `class extends Proxy`
  // still fails) and a tracked `revocable`.
  Object.defineProperty(TrackingProxy, "prototype", { value: undefined });
  Object.defineProperty(TrackingProxy, "revocable", {
    value: function revocable(target: object, handler: ProxyHandler<object>) {
      const pair = Reflect.apply(nativeRevocable, NativeProxy, [target, handler]) as { proxy: object; revoke: () => void };
      tracked.add(pair.proxy);
      return pair;
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Proxy");
  Object.defineProperty(globalThis, "Proxy", {
    value: TrackingProxy,
    writable: descriptor?.writable ?? true,
    enumerable: descriptor?.enumerable ?? false,
    configurable: descriptor?.configurable ?? true,
  });
  installProxyTrackingDetector((value) =>
    (typeof value === "object" || typeof value === "function") && value !== null && tracked.has(value));
}
