// Test fixture (S1 proxy tracking): the install module is the FIRST static
// import; a later module creates proxies at load. Prints the encoder verdicts.
import "./proxy-tracking-install";
import { madeAtLoad, revocableAtLoad } from "./proxy-tracking-maker.fixture";
import { snapshotEngineBodyArguments } from "./engine-body-memo";

const verdict = (v: unknown): string => {
  const s = snapshotEngineBodyArguments([v]);
  return s.ok ? "ok" : s.reason;
};
const later = new Proxy({ c: 3 }, { ownKeys: () => [] });
console.log(JSON.stringify({
  madeAtLoad: verdict(madeAtLoad),
  revocableAtLoad: verdict(revocableAtLoad),
  later: verdict(later),
  nested: verdict({ inner: [later] }),
  plain: verdict({ plain: [1, "x"] }),
  constructorStillWorks: typeof new Proxy({}, {}) === "object",
  callWithoutNewThrows: (() => { try { (Proxy as unknown as () => void)(); return false; } catch { return true; } })(),
}));
