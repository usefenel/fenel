import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { isVersionedRoutingTableCopy } from "./routing-copy";

// Run the canonical gateway's actual host code with compiled/interpreted Fenel
// calls supplied as observable IO. Full language behavior is also exercised by
// the real source-module browser gate; this suite isolates cache eligibility.
const source = await Bun.file(new URL("./engine-bodies-dispatch.ts", import.meta.url)).text();
const start = source.indexOf("type CanonicalDirectRouteJudgments =");
const end = source.indexOf("export function dispatchCompiledResolveDispatch(", start);
if (start < 0 || end < 0) throw new Error("Canonical resolver gateway moved");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end).replace("export function dispatchCompiledResolver", "function dispatchCompiledResolver"));
const direct = () => ({ $tag: "Direct" });
// A fixture-only producer predicate isolates the gateway. The companion
// subprocess below verifies the real registry publisher and private brand.
const fixtureSnapshotBrands = new WeakSet<object>();
function table(entries: Record<string, unknown> = {}) {
  const snapshot = Object.freeze({ routeIdx: Object.freeze(Object.assign(Object.create(null), entries)) });
  fixtureSnapshotBrands.add(snapshot);
  return snapshot;
}
const route = (tag = "RDirect") => Object.freeze({ $tag: tag });
function harness(judge = (t: any, name: string, args: unknown[], frames: unknown[], tags: string[]): unknown => {
  const entry = Object.hasOwn(t.routeIdx, name) ? t.routeIdx[name] : undefined;
  return entry === undefined || entry.$tag === "RDirect" ? direct() : { $tag: "Resolved", _0: { args, frames, tags } };
}) {
  let registry = {};
  let forced = false;
  let available = true;
  let compiled = 0;
  let interpreted = 0;
  const scope = {
    isVersionedRoutingTableCopy,
    engineRequire: (name: string) => {
      if (name !== "registry") throw new Error(`Unexpected module ${name}`);
      return { isRegistryRoutingTableSnapshot: (value: object) => fixtureSnapshotBrands.has(value) };
    },
    getHarness: () => ({ reg: registry }),
    resolverInterpretedForced: () => forced,
    getResolverNamespace: () => available ? { rsvResolveBareName: (...args: Parameters<typeof judge>) => { compiled++; return judge(...args); } } : null,
    dispatchEngineBody: (id: string, args: Parameters<typeof judge>) => { expect(id).toBe("dispatch:rsvResolveBareName"); interpreted++; return judge(...args); },
  };
  const call = new Function(...Object.keys(scope), `${code}; return dispatchCompiledResolver;`)(...Object.values(scope)) as (table: unknown, name: string, args: unknown[], frames: unknown[], tags: string[]) => any;
  return { call, counts: () => ({ compiled, interpreted }), force: (next: boolean) => { forced = next; }, replaceRegistry: () => { registry = {}; }, available: (next: boolean) => { available = next; } };
}

test("actual Direct judgments eliminate repeated gateway work without sharing mutable result objects", () => {
  const h = harness(); const t = table({ named: route() });
  const first = h.call(t, "named", [], [], []);
  first.$tag = "poisoned";
  for (let index = 0; index < 10_000; index++) {
    const name = index % 2 === 0 ? "named" : "missing";
    const result = h.call(t, name, [index], [{ frame: index }], [String(index)]);
    if (result.$tag !== "Direct") throw new Error("Changed Direct judgment");
  }
  expect(h.counts()).toEqual({ compiled: 2, interpreted: 0 });
  const result = h.call(t, "named", [], [], []);
  expect(Object.isFrozen(result)).toBe(false);
  expect(result).not.toBe(h.call(t, "named", [], [], []));
});

test("replaced route indexes and mutable wrappers/indexes/resolutions retain live routing", () => {
  const h = harness();
  const directTable = table({ target: route() });
  h.call(directTable, "target", [], [], []);
  const dispatchTable = table({ target: route("RDispatch") });
  expect(h.call(dispatchTable, "target", [1], [], []).$tag).toBe("Resolved");

  const mutableIndex = Object.assign(Object.create(null), { target: { $tag: "RDirect" } });
  const frozenWrapper = Object.freeze({ routeIdx: mutableIndex });
  h.call(frozenWrapper, "target", [], [], []);
  mutableIndex.target = route("RDispatch");
  expect(h.call(frozenWrapper, "target", [], [], []).$tag).toBe("Resolved");

  const mutableResolution = { $tag: "RDirect" };
  const fixedIndex = table({ target: mutableResolution });
  h.call(fixedIndex, "target", [], [], []);
  mutableResolution.$tag = "RDispatch";
  expect(h.call(fixedIndex, "target", [], [], []).$tag).toBe("Resolved");

  const mutableWrapper = { routeIdx: directTable.routeIdx };
  h.call(mutableWrapper, "target", [], [], []);
  h.call(mutableWrapper, "target", [], [], []);
  mutableWrapper.routeIdx = dispatchTable.routeIdx;
  expect(h.call(mutableWrapper, "target", [], [], []).$tag).toBe("Resolved");
  expect(h.counts().compiled).toBe(9);
});

test("accessors and inherited custom metadata are never treated as immutable route proof", () => {
  const h = harness(); let reads = 0;
  const resolution = Object.freeze(Object.defineProperty({}, "$tag", { enumerable: true, get: () => { reads++; return "RDirect"; } }));
  const accessorResolution = table({ target: resolution });
  h.call(accessorResolution, "target", [], [], []); h.call(accessorResolution, "target", [], [], []);
  expect(reads).toBe(2);
  const accessorTable = Object.freeze(Object.defineProperty({}, "routeIdx", { get: () => { reads++; return table().routeIdx; } }));
  h.call(accessorTable, "missing", [], [], []); h.call(accessorTable, "missing", [], [], []);
  expect(reads).toBe(4);
  const inheritedIndex = Object.freeze({ routeIdx: Object.freeze({}) });
  h.call(inheritedIndex, "missing", [], [], []); h.call(inheritedIndex, "missing", [], [], []);
  expect(h.counts().compiled).toBe(6);
});

test("non-Direct judgments continue to observe every argument, dictionary and active tag", () => {
  const h = harness(); const t = table({ target: route("RDispatch") });
  for (let value = 0; value < 3; value++) {
    expect(h.call(t, "target", [value], [{ value }], [String(value)])).toEqual({ $tag: "Resolved", _0: { args: [value], frames: [{ value }], tags: [String(value)] } });
  }
  expect(h.counts()).toEqual({ compiled: 3, interpreted: 0 });
});

test("an inherited resolution tag cannot establish a memoized judgment", () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "$tag");
  const h = harness(); const t = table({ target: Object.freeze({}) });
  try {
    Object.defineProperty(Object.prototype, "$tag", { value: "RDirect", configurable: true, writable: true });
    expect(h.call(t, "target", [], [], []).$tag).toBe("Direct");
    Object.defineProperty(Object.prototype, "$tag", { value: "RDispatch", configurable: true, writable: true });
    expect(h.call(t, "target", [], [], []).$tag).toBe("Resolved");
    expect(h.counts().compiled).toBe(2);
  } finally {
    if (previous === undefined) delete (Object.prototype as Record<string, unknown>).$tag;
    else Object.defineProperty(Object.prototype, "$tag", previous);
  }
});

test("unbranded frozen table and index Proxies retain every observable read", () => {
  for (const proxiedSlot of ["table", "index"]) {
    const h = harness(); let throwOnRead = false;
    const target = proxiedSlot === "table" ? table({ target: route() })
      : Object.freeze(Object.assign(Object.create(null), { target: route() }));
    const proxy = Object.freeze(new Proxy(target, {
      get(object, key, receiver) {
        if (throwOnRead) throw new Error(`${proxiedSlot} read changed`);
        return Reflect.get(object, key, receiver);
      },
    }));
    const customTable = proxiedSlot === "table" ? proxy : Object.freeze({ routeIdx: proxy });
    expect(h.call(customTable, "target", [], [], []).$tag).toBe("Direct");
    throwOnRead = true;
    expect(() => h.call(customTable, "target", [], [], [])).toThrow(`${proxiedSlot} read changed`);
    expect(h.counts().compiled).toBe(2);
  }
});

test("forced interpreted proof and replacement harness identities never reuse compiled judgments", () => {
  const h = harness(); const t = table();
  h.call(t, "missing", [], [], []); h.call(t, "missing", [], [], []);
  h.force(true); h.call(t, "missing", [], [], []); h.call(t, "missing", [], [], []);
  expect(h.counts()).toEqual({ compiled: 1, interpreted: 1 });
  h.replaceRegistry(); h.call(t, "missing", [], [], []);
  expect(h.counts().interpreted).toBe(2);
  h.force(false); h.call(t, "missing", [], [], []);
  expect(h.counts().compiled).toBe(2);
  const undefinedResult = harness(() => undefined);
  expect(undefinedResult.call(table(), "missing", [], [], [])).toBeUndefined();
  expect(undefinedResult.counts()).toEqual({ compiled: 1, interpreted: 0 });
});

test("a long-lived route index keeps a bounded name memo", () => {
  const h = harness(); const t = table();
  for (let index = 0; index < 4097; index++) h.call(t, `name-${index}`, [], [], []);
  h.call(t, "name-4096", [], [], []);
  expect(h.counts().compiled).toBe(4097);
  h.call(t, "name-0", [], [], []);
  expect(h.counts().compiled).toBe(4098);
});

test("arbitrary installed callback, ABA, context and version behavior stays unchanged", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./direct-route-callbacks.fixture.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
  expect(stdout).toContain("custom callbacks, live context, and route versions passed");
});

test("real registry snapshot producers retain cache hits and reject Proxy identities", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./direct-route-snapshots.fixture.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (status !== 0) throw new Error(`${stdout}\n${stderr}`);
  expect(stdout).toContain("real routing snapshot provenance and cache hits passed");
}, 120_000);
