// Test fixture (S1b worker-entry pattern): the "real entry" a worker loads by
// dynamic import after the install import. Reports the order assertion and
// whether a proxy made here is refused by the memo encoder.
import { assertProxyTrackingPrecededEngine } from "./proxy-tracking";
import { snapshotEngineBodyArguments } from "./engine-body-memo";

let order = "ok";
try {
  assertProxyTrackingPrecededEngine();
} catch (error) {
  order = String((error as Error).message);
}
const proxy = snapshotEngineBodyArguments([new Proxy({}, {})]);
console.log(JSON.stringify({ order, proxy: proxy.ok ? "ok" : proxy.reason }));
