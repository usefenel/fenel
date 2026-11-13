import assert from "node:assert/strict";
import * as registryModule from "./registry";
import { createDispatchRegistry } from "./dispatch-registry";
import { createVersionedRoutingTableReader, isVersionedRoutingTableCopy } from "./routing-copy";
import { mergeBrowserEvaluateContext } from "../../../../distros/narthex/solid/src/lib/expression-runner/authoring-session-scope";

const registry = registryModule.createRegistry([], { dispatchRegistry: createDispatchRegistry() });
const snapshot = registry.routingTable();
const firstContext = registry.evaluateContext();
const secondContext = registry.evaluateContext();
assert.equal(firstContext._routingTable, secondContext._routingTable, "context getter identity stays stable");
assert(registryModule.isRegistryRoutingTableSnapshot(snapshot));
assert(registryModule.isRegistryRoutingTableSnapshot(firstContext._routingTable!()));
assert(!registryModule.isRegistryRoutingTableSnapshot(Object.freeze({ ...snapshot })));
assert(!registryModule.isRegistryRoutingTableSnapshot(snapshot.routeIdx), "the brand is specific to published routing roots");
assert(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.routeIdx));
assert.equal(Object.getPrototypeOf(snapshot.routeIdx), null);

// Execute the real memo gateway with the real producer predicate, isolating
// only canonical resolver evaluation so this check needs no full engine boot.
const source = await Bun.file(new URL("./engine-bodies-dispatch.ts", import.meta.url)).text();
const start = source.indexOf("type CanonicalDirectRouteJudgments =");
const end = source.indexOf("export function dispatchCompiledResolveDispatch(", start);
assert(start >= 0 && end > start);
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end).replace("export function dispatchCompiledResolver", "function dispatchCompiledResolver"));
let calls = 0;
const scope = {
  isVersionedRoutingTableCopy,
  engineRequire: (name: string) => { assert.equal(name, "registry"); return registryModule; },
  getHarness: () => ({ reg: registry }),
  resolverInterpretedForced: () => false,
  getResolverNamespace: () => ({ rsvResolveBareName: (table: typeof snapshot, name: string) => {
    calls++;
    assert.equal(Object.hasOwn(table.routeIdx, name), false);
    return { $tag: "Direct" };
  } }),
  dispatchEngineBody: () => { throw new Error("Unexpected interpreted branch"); },
};
const resolve = new Function(...Object.keys(scope), `${code}; return dispatchCompiledResolver;`)(...Object.values(scope)) as (table: unknown, name: string, args: unknown[], frames: unknown[], tags: string[]) => { $tag: string };
for (let index = 0; index < 1000; index++) assert.equal(resolve(snapshot, "missing", [index], [], []).$tag, "Direct");
assert.equal(calls, 1, "a real published snapshot still memoizes its actual Direct judgment");

const firstBrowser = mergeBrowserEvaluateContext(firstContext, {}, {});
const secondBrowser = mergeBrowserEvaluateContext(secondContext, {}, {});
assert.notEqual(firstBrowser._routingTable, secondBrowser._routingTable);
const firstCopy = firstBrowser._routingTable!() as typeof snapshot;
const secondCopy = secondBrowser._routingTable!() as typeof snapshot;
assert(isVersionedRoutingTableCopy(firstCopy));
assert(isVersionedRoutingTableCopy(secondCopy));
assert(!registryModule.isRegistryRoutingTableSnapshot(firstCopy), "copy provenance does not widen the original publisher brand");
assert.notEqual(firstCopy, snapshot);
assert.notEqual(firstCopy.routeIdx, snapshot.routeIdx);
assert.equal(firstCopy.routeIdx, secondCopy.routeIdx, "scope-module owner preserves cross-context copied-index sharing");
for (let index = 0; index < 1000; index++) assert.equal(resolve(firstCopy, "missing", [index], [], []).$tag, "Direct");
assert.equal(resolve(secondCopy, "missing", [], [], []).$tag, "Direct");
assert.equal(resolve(snapshot, "missing", [], [], []).$tag, "Direct");
assert.equal(calls, 2, "raw and copied indexes have separate memos, and copied contexts share their existing index");

const get = firstContext._routingTable!;
const version = firstContext._routingTableVersion!;
assert(registryModule.isCompletedRegistryRoutingTableProducer(get, version, snapshot));
const customVersion = () => version();
const customFirst = createVersionedRoutingTableReader();
const unqualified = customFirst(get, customVersion);
assert(!isVersionedRoutingTableCopy(unqualified));
assert.equal(customFirst(get, version), unqualified);
assert(!isVersionedRoutingTableCopy(unqualified), "a later genuine pair does not upgrade a retained custom-first base");
resolve(unqualified, "missing", [], [], []); resolve(unqualified, "missing", [], [], []);
assert.equal(calls, 4, "an unqualified copy keeps the live canonical path");
const genuineFirst = createVersionedRoutingTableReader();
const qualified = genuineFirst(get, version);
assert(isVersionedRoutingTableCopy(qualified));
assert.equal(genuineFirst(get, customVersion), qualified);
assert(isVersionedRoutingTableCopy(qualified), "an exact already-proven output retains proof on a same-entry custom alias hit");
resolve(qualified, "missing", [], [], []); resolve(qualified, "missing", [], [], []);
assert.equal(calls, 5);
for (const [getter, versionGetter] of [
  [new Proxy(get, {}), version],
  [get, new Proxy(version, {})],
  [registry.routingTable, version],
] as const) assert(!isVersionedRoutingTableCopy(createVersionedRoutingTableReader()(getter, versionGetter)));

let throwOnRead = false;
let reads = 0;
const beforeProxy = calls;
const proxy = Object.freeze(new Proxy(snapshot, { get(target, key, receiver) {
  reads++;
  if (throwOnRead) throw new Error("custom table read changed");
  return Reflect.get(target, key, receiver);
} }));
assert.equal(registryModule.isRegistryRoutingTableSnapshot(proxy), false);
assert.equal(reads, 0, "the read-only provenance check must not exercise Proxy traps");
assert.equal(resolve(proxy, "missing", [], [], []).$tag, "Direct");
throwOnRead = true;
assert.throws(() => resolve(proxy, "missing", [], [], []), /custom table read changed/);
assert.equal(calls, beforeProxy + 2);
console.log("real routing snapshot provenance and cache hits passed");
