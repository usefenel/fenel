// C1 actual producer/merger/source integration. Only the private candidate,
// routing cache and frame marshalling are source-extracted to count source
// invocations. All provenance and policy decisions delegate to production.
// Normal replay admission is mandatory; this fixture never generates artifacts.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { EvaluateContext, ServedBareNameResolver } from "../../src/json-logic";
import type { RoutingTableValue } from "../../src/registry";

const order = process.argv[2];
assert(order === "registry-first" || order === "harness-first" || order === "helper-first");
const receiptPath = process.argv[3]!;
const repo = fileURLToPath(new URL("../../../../../", import.meta.url));
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const roster = ["implementations/typescript/engine/src/json-logic.ts", "implementations/typescript/engine/src/engine-bodies-dispatch.ts",
  "implementations/typescript/engine/src/registry.ts", "implementations/typescript/engine/src/routing-copy.ts",
  "distros/narthex/solid/src/lib/expression-runner/authoring-session-scope.ts", "fenel/modules/std/representation-value.fenel"];
const hashes = () => Object.fromEntries(roster.map(path => [path, sha(readFileSync(resolve(repo, path)))]));
const sourceHashes = hashes();
const events: string[] = [];
const mark = (event: string) => { events.push(event); console.log(JSON.stringify({ event, order })); };
const environment = Object.fromEntries(["FENEL_PARSER_LEGACY", "FENEL_ENGINE_BODY_REPLAY", "FENEL_RESOLVER_INTERPRETED", "NODE_ENV"]
  .map(name => [name, process.env[name] ?? "<unset>"]));

// Host installation precedes every engine import in this fresh child.
await import("../../src/engine-body-host-install");
// Read the already-existing inert namespace/completion state; these observations
// neither require a module nor construct the private source harness.
const moduleState = await import("../../src/engine-module-state");
const moduleObservations: Array<{ phase: string; modules: Record<string, { registered: boolean; completed: boolean }> }> = [];
const observeModules = (phase: string) => {
  const observation = { phase, modules: Object.fromEntries(["registry", "engine-bodies-dispatch", "modules/std", "json-logic"].map(id =>
    [id, { registered: moduleState.engineModuleRegistered(id), completed: moduleState.engineModuleCompleted(id) }])) };
  moduleObservations.push(observation);
  console.log(JSON.stringify({ event: "existing-module-state", order, ...observation }));
  return observation;
};
observeModules("after-host-preload");
let coldHelper: { getterReads: number; answers: boolean[]; ordinaryUnbrandedTable: boolean } | undefined;
let coldTable: object | undefined;
if (order === "helper-first") {
  // Do not explicitly import registry/engine-bodies-dispatch or request a
  // harness before exercising the new cold unbranded public-helper path.
  const earlyEvaluator = await import("../../src/json-logic");
  const beforeHelper = observeModules("after-lightweight-evaluator-before-helper");
  const table = { $tag: "RoutingTable", routes: [], routeIdx: Object.create(null), posIdx: Object.create(null),
    ownerIdx: Object.create(null), instanceIdx: Object.create(null), generalIdx: Object.create(null), generalScopeIdx: Object.create(null) };
  coldTable = table;
  coldHelper = { getterReads: 0, answers: [], ordinaryUnbrandedTable: true };
  const context: EvaluateContext = { _routingTable: () => { coldHelper!.getterReads++; return table; } };
  try {
    assert.equal(beforeHelper.modules.registry!.registered, false, "helper-first must reach an actually cold registry boundary");
    assert.equal(beforeHelper.modules.registry!.completed, false);
    for (let index = 0; index < 2; index++) {
      const answer = earlyEvaluator.runtimeRepresentationOwnerMayInspect(context, "ColdMissingOwner");
      coldHelper.answers.push(answer);
      assert.equal(answer, false);
      assert.equal(coldHelper.getterReads, index + 1, "Each unversioned public helper call retains one source-getter observation");
      observeModules(`after-cold-helper-call-${index + 1}`);
    }
    mark("cold-unbranded-public-helper-passed-before-explicit-registry-import");
  } catch (error) {
    observeModules("cold-helper-refusal");
    const refusal = { name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error) };
    writeFileSync(receiptPath, JSON.stringify({ schema: "fenel.routing-owner-facts-integration.v1", order,
      phase: "cold-helper-refusal", passed: false, events, environment, moduleObservations, coldHelper, refusal, sourceHashes,
      sourceHashesAfterRefusal: hashes(), fixtureSha256: sha(readFileSync(import.meta.path)),
      replay: { inspected: false, reason: "Cold helper refused before explicit engine initialization; no replay acceptance claim" } }, null, 2) + "\n", { flag: "wx" });
    throw new Error(`helper-first cold unbranded public helper refused: ${refusal.name}: ${refusal.message}`, { cause: error });
  }
}
const engine = await import("../../src/engine-bodies-dispatch");
if (order === "harness-first") { engine.harnessForTests(); mark("private-harness-created-first"); }
const registryModule = await import("../../src/registry");
const { createDispatchRegistry } = await import("../../src/dispatch-registry");
const dispatch = createDispatchRegistry();
const registry = registryModule.createRegistry([], { dispatchRegistry: dispatch });
mark("actual-small-registry-created");
const harness = engine.__getHarnessForTests();
mark("private-harness-ready");
observeModules("after-explicit-registry-and-private-harness-initialization");
const replay = engine.engineBodyReplayStatus();
assert.equal(replay.accepted, true, `Normal replay admission refused: ${replay.refused}`);
assert.equal(engine.__engineHarnessResolverArtifactFreshForTests(), true, "Canonical resolver artifact must be fresh after regeneration");
const replayFile = process.env.FENEL_ENGINE_BODY_REPLAY!;
assert(replayFile, "Controller must name the canonical replay");
const replaySha256 = sha(readFileSync(replayFile));
const jl = await import("../../src/json-logic");
const { engineRequire } = await import("../../src/engine-require");
const { isVersionedRoutingTableCopy, createVersionedRoutingTableReader } = await import("../../src/routing-copy");
if (coldTable !== undefined) {
  assert(!registryModule.isRegistryRoutingTableSnapshot(coldTable));
  assert(!isVersionedRoutingTableCopy(coldTable));
}
const { mergeBrowserEvaluateContext } = await import("../../../../../distros/narthex/solid/src/lib/expression-runner/authoring-session-scope");
const { frameAccount } = await import("../../src/authority");
const canonicalHooks = { resolveBareName: engine.dispatchCompiledResolver as import("../../src/json-logic").ServedBareNameResolver,
  resolveDispatch: engine.dispatchCompiledResolveDispatch as import("../../src/json-logic").ServedDispatchResolver,
  resolveComplete: engine.dispatchCompiledResolveComplete as import("../../src/json-logic").ServedCompleteResolver };
assert(jl.servedDispatcherMatches(canonicalHooks));

const method = { $ref: "std:toString" };
dispatch.addInstance({ typeName: "Reprable", args: ["JsRuntime", "PoolOwner"], methods: { lower: method }, scope: { kind: "global" } });
dispatch.addInstance({ typeName: "Reprable", args: ["JsRuntime", "TaggedOwner"], methods: { lower: method }, scope: { kind: "tag", tag: "owner-facts-tag" } });
dispatch.addInstance({ typeName: "Reprable", args: ["JsRuntime", "AccountOwner"], methods: { lower: method }, scope: { kind: "account", accountId: "owner-facts-a" } });
const rawContext = registry.evaluateContext();
const secondRaw = registry.evaluateContext();
assert.equal(rawContext._routingTable, secondRaw._routingTable);
const browserContext = mergeBrowserEvaluateContext(rawContext, {}, {});
const secondBrowser = mergeBrowserEvaluateContext(secondRaw, {}, {});

function compareGraphs(left: unknown, right: unknown): number {
  const forward = new Map<object, object>(); const backward = new Map<object, object>();
  const visit = (first: unknown, second: unknown): void => {
    if (first === null || typeof first !== "object") { assert(Object.is(first, second)); return; }
    assert(second !== null && typeof second === "object");
    if (forward.has(first)) { assert.equal(forward.get(first), second); return; }
    assert(!backward.has(second)); forward.set(first, second); backward.set(second, first);
    assert.equal(Object.getPrototypeOf(first), Object.getPrototypeOf(second));
    assert.equal(Object.isExtensible(first), Object.isExtensible(second));
    assert.deepEqual(Reflect.ownKeys(first), Reflect.ownKeys(second));
    if (first instanceof Uint8Array) assert.deepEqual(Array.from(first), Array.from(second as Uint8Array));
    for (const key of Reflect.ownKeys(first)) {
      const a: PropertyDescriptor = Object.getOwnPropertyDescriptor(first, key)!;
      const b: PropertyDescriptor = Object.getOwnPropertyDescriptor(second, key)!;
      assert.equal(a.enumerable, b.enumerable); assert.equal(a.configurable, b.configurable); assert.equal(a.writable, b.writable);
      assert(Object.hasOwn(a, "value") && Object.hasOwn(b, "value")); visit(a.value, b.value);
    }
  };
  visit(left, right); return forward.size;
}
const original = rawContext._routingTable!() as RoutingTableValue;
const copied = browserContext._routingTable!() as RoutingTableValue;
assert(registryModule.isRegistryRoutingTableSnapshot(original));
assert(registryModule.isCompletedRegistryRoutingTableProducer(rawContext._routingTable, rawContext._routingTableVersion, original));
assert(!registryModule.isRegistryRoutingTableSnapshot(copied)); assert(isVersionedRoutingTableCopy(copied));
assert.notEqual(copied, original);
const comparedNodes = compareGraphs(original, copied);
assert.equal(secondRaw._routingTable!(), original);
assert.equal(secondBrowser._routingTable!(), copied);

// The pool is the actual small registry. Existing private-harness function and
// native owners supply std source for its ordinary frame/public-helper calls;
// this is composition of real owners, not a supplied helper-policy answer.
const reader = (base: EvaluateContext, extra: EvaluateContext = {}): EvaluateContext => ({ ...harness.ctx,
  _routingTable: base._routingTable, _routingTableVersion: base._routingTableVersion,
  _specRegistry: base._specRegistry, _authority: base._authority, _dictStack: [], _activeTags: [], ...extra });
const source = readFileSync(new URL("../../src/json-logic.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function between(first: string, next: string): string {
  assert.equal(source.split(first).length, 2, `Nonunique extraction anchor ${first}`);
  const start = source.indexOf(first); const end = source.indexOf(next, start);
  assert(end > start, `Missing extraction end ${next}`); return source.slice(start, end);
}
const nextDoc = (first: string) => between(first, "\n/**");
const extracted = between("const privateRoutingTables =", "/** A2/B4: observe directness")
  + between("const runtimeRepresentationOwnerFacts =", "/** A2/B3 invocation boundary")
  + nextDoc("export function routingArgsValue(").replace("export function", "function")
  + nextDoc("function framesForResolver(") + nextDoc("function toLength(")
  + between("function runtimeRepresentationOwnerCandidate(", "function runtimeRepresentationInspectionPlan(");
const extractedJs = new Bun.Transpiler({ loader: "ts" }).transformSync(extracted);
function candidate() {
  let sourceCalls = 0; let frameCalls = 0; let beforeSource: (() => void) | undefined;
  const scopes: Array<{ tags: string[]; account: string | null; frames: number }> = [];
  const dependencies = {
    ownDataRead: jl.ownDataRead, isVersionedRoutingTableCopy, evaluatorHookGenerationForMemo: jl.evaluatorHookGenerationForMemo,
    engineRequire: (id: string) => id === "engine-bodies-dispatch" ? {
      representationProjectionOwnerFactsMemoGeneration: engine.representationProjectionOwnerFactsMemoGeneration,
      representationProjectionOwnerFactsFromSource: (rows: unknown) => {
        sourceCalls++; beforeSource?.(); return engine.representationProjectionOwnerFactsFromSource(rows);
      },
    } : engineRequire(id),
    invokeRuntimeRepresentationMethod: (callable: unknown, args: unknown[], ctx: EvaluateContext) => {
      frameCalls++; scopes.push({ tags: [...(ctx._activeTags ?? [])], account: frameAccount(ctx), frames: ctx._dictStack?.length ?? 0 });
      return jl.invokeRuntimeRepresentationMethod(callable, args, ctx);
    },
  };
  const check = new Function(...Object.keys(dependencies), `${extractedJs}; return runtimeRepresentationOwnerCandidate;`)(...Object.values(dependencies)) as
    (ctx: EvaluateContext, owner: string) => boolean;
  return { check, scopes, get sourceCalls() { return sourceCalls; }, get frameCalls() { return frameCalls; },
    set beforeSource(value: (() => void) | undefined) { beforeSource = value; } };
}
const poolRows = original.instanceIdx.Reprable!.JsRuntime!;
const actualSourceFacts = engine.representationProjectionOwnerFactsFromSource(poolRows) as { all: boolean; owners: string[] };
assert.equal(actualSourceFacts.all, false);
assert.deepEqual(actualSourceFacts.owners, ["PoolOwner", "TaggedOwner", "AccountOwner"]);

const reuse = candidate();
for (const base of [rawContext, secondRaw, browserContext, secondBrowser]) {
  assert.equal(reuse.check(reader(base), "PoolOwner"), true);
  assert.equal(reuse.check(reader(base), "MissingOwner"), false);
}
assert.equal(reuse.sourceCalls, 2, "Original and copy retain separate canonical source results, each shared across readers");
const unqualified = createVersionedRoutingTableReader()(rawContext._routingTable!, () => rawContext._routingTableVersion!()) as RoutingTableValue;
assert(!isVersionedRoutingTableCopy(unqualified)); assert(!registryModule.isRegistryRoutingTableSnapshot(unqualified));
const customBase: EvaluateContext = { _routingTable: () => unqualified };
assert.equal(reuse.check(reader(customBase), "PoolOwner"), true);
assert.equal(reuse.check(reader(customBase), "MissingOwner"), false);
assert.equal(reuse.sourceCalls, 4, "Unqualified roots retain live computation");

let helperCalls = 0; let dependencyCalls = 0; let invocationCalls = 0; let publicValue = false;
const rootSpec = harness.ctx.getFunction!("std:representationProjectionOwnerFacts")!;
const headSpec = harness.ctx.getFunction!("std:head")!;
const overriddenNative = { ...harness.ctx.natives };
for (const key of [rootSpec.id, "std:representationProjectionOwnerFacts", "representationProjectionOwnerFacts"]) {
  overriddenNative[key] = () => { helperCalls++; return { all: publicValue, owners: [] }; };
}
for (const key of [headSpec.id, "std:head", "head"]) overriddenNative[key] = () => { dependencyCalls++; throw new Error("reader head override"); };
const overridden = reader(rawContext, { natives: overriddenNative,
  _constructors: { Just: ["wrong"], Nothing: ["wrong"], RepresentationProjectionOwnerFacts: ["wrong"] },
  _authoringInvocation: { valueContract: () => { invocationCalls++; return undefined; } } as never });
const overrideControl = candidate();
assert.equal(overrideControl.check(overridden, "PoolOwner"), true);
assert.equal(overrideControl.check(reader(rawContext, { getFunction: () => { throw new Error("reader getFunction override"); } }), "MissingOwner"), false);
assert.deepEqual({ helperCalls, dependencyCalls, invocationCalls }, { helperCalls: 0, dependencyCalls: 0, invocationCalls: 0 });
const publicReader = reader(rawContext, { natives: overriddenNative });
assert.deepEqual(jl.invokeRuntimeRepresentationMethod({ $ref: rootSpec.id }, [poolRows], publicReader), { all: false, owners: [] });
publicValue = true;
assert.deepEqual(jl.invokeRuntimeRepresentationMethod({ $ref: rootSpec.id }, [poolRows], publicReader), { all: true, owners: [] });
assert.equal(helperCalls, 2);

const live = candidate();
const support = await import("../../src/authority-test-support");
const emptyEnvelope = harness.reg.evaluateAuthorityFunction("authority:emptyEnvelope", [0]);
const authorityA = support.mintTestAuthorityForAccount("owner-facts-a", emptyEnvelope, harness.reg);
const authorityB = support.mintTestAuthorityForAccount("owner-facts-b", emptyEnvelope, harness.reg);
const frame = { typeName: "Reprable", args: ["JsRuntime", "FrameOwner"], methods: { lower: method } };
for (const [tags, authority, expectedAccount] of [
  [[], undefined, null], [["owner-facts-tag"], authorityA, "owner-facts-a"], [[], authorityB, "owner-facts-b"],
] as const) {
  const context = reader(browserContext, { _dictStack: [frame], _activeTags: [...tags], _authority: authority });
  assert.equal(frameAccount(context), expectedAccount);
  assert.equal(live.check(context, "FrameOwner"), true);
  assert.equal(live.check(context, "OtherFrameOwner"), false);
  assert.deepEqual(jl.resolveRuntimeRepresentationMethod(context, "FrameOwner", "lower"), method);
  assert.deepEqual(jl.resolveRuntimeRepresentationMethod(context, "TaggedOwner", "lower"), tags.length ? method : undefined);
  assert.deepEqual(jl.resolveRuntimeRepresentationMethod(context, "AccountOwner", "lower"), expectedAccount === "owner-facts-a" ? method : undefined);
}
assert.equal(live.sourceCalls, 1); assert.equal(live.frameCalls, 6);
assert.deepEqual(live.scopes.map(scope => scope.account), [null, null, "owner-facts-a", "owner-facts-a", "owner-facts-b", "owner-facts-b"]);

const customHooks = candidate();
assert.equal(customHooks.check(reader(rawContext), "PoolOwner"), true);
let hookCalls = 0; let throwFromHook = false;
const hooked: ServedBareNameResolver = (...args) => {
  hookCalls++; if (throwFromHook) throw new Error("stateful custom served hook refusal");
  return canonicalHooks.resolveBareName(...args);
};
try {
  jl.installServedDispatcher({ ...canonicalHooks, resolveBareName: hooked });
  assert.equal(customHooks.check(reader(rawContext), "PoolOwner"), true);
  assert.equal(customHooks.check(reader(rawContext), "MissingOwner"), false);
  assert.equal(customHooks.sourceCalls, 3); assert(hookCalls > 0);
  throwFromHook = true;
  assert.throws(() => customHooks.check(reader(rawContext), "PoolOwner"), /stateful custom served hook refusal/);
  assert.equal(customHooks.sourceCalls, 4);
} finally { jl.installServedDispatcher(canonicalHooks); }
assert.equal(customHooks.check(reader(rawContext), "PoolOwner"), true);
assert.equal(customHooks.sourceCalls, 4, "Canonical restoration may reuse the earlier proven canonical entry");

const abaResults = [];
for (const kind of ["hooks", "fixtures"] as const) {
  const aba = candidate();
  aba.beforeSource = () => {
    if (kind === "hooks") { jl.installServedDispatcher({ ...canonicalHooks, resolveBareName: hooked }); jl.installServedDispatcher(canonicalHooks); }
    else { engine.__registerFnBodyFixtureForTests("ownerFactsUnrelatedFixture", true); engine.__clearFnBodyFixturesForTests(); }
  };
  assert.equal(aba.check(reader(rawContext), "PoolOwner"), true);
  aba.beforeSource = undefined;
  assert.equal(aba.check(reader(rawContext), "PoolOwner"), true);
  assert.equal(aba.sourceCalls, 2, `${kind} ABA must not retain the first computation`);
  if (kind === "fixtures") {
    engine.__registerFnBodyFixtureForTests("ownerFactsUnrelatedFixture", true);
    try {
      assert.equal(aba.check(reader(rawContext), "PoolOwner"), true); assert.equal(aba.check(reader(rawContext), "PoolOwner"), true);
      assert.equal(aba.sourceCalls, 4);
    } finally { engine.__clearFnBodyFixturesForTests(); }
  }
  abaResults.push({ kind, sourceCalls: aba.sourceCalls });
}

// A real general row changes the published table/version; the live general
// gate remains positive even when its account scope is currently invisible.
const oldVersion = rawContext._routingTableVersion!();
dispatch.addInstance({ typeName: "Reprable", args: [], methods: { lower: method }, scope: { kind: "account", accountId: "owner-facts-general" } });
assert.notEqual(rawContext._routingTableVersion!(), oldVersion);
const general = candidate();
assert.equal(general.check(reader(browserContext), "MissingOwner"), true);
assert.equal(general.check(reader(browserContext, { _activeTags: ["changed"] }), "MissingOwner"), true);
assert.equal(general.sourceCalls, 1);

// The closure has no method call, native requires or withInstance. These real
// global hooks throw if reached. Exact method/act restoration uses their owner;
// Evaluator has no exported reset, so this control is last in the fresh child.
const calls = { method: 0, nativeAct: 0, evaluator: 0 };
const effect = await import("../../src/effect-dispatch");
jl.installMethodResolver(() => { calls.method++; throw new Error("unexpected method resolver dependency"); });
jl.installNativeActResolver(() => { calls.nativeAct++; throw new Error("unexpected native-act dependency"); });
jl.installDispatchedEvaluator(() => { calls.evaluator++; throw new Error("unexpected Evaluator dependency"); });
try {
  compareGraphs(actualSourceFacts, engine.representationProjectionOwnerFactsFromSource(poolRows));
  assert.deepEqual(calls, { method: 0, nativeAct: 0, evaluator: 0 });
} finally { effect.installEngineMethodDispatch(); }
assert.deepEqual(hashes(), sourceHashes, "Production source changed during the child");
assert.equal(sha(readFileSync(replayFile)), replaySha256, "Canonical replay changed during the child");
const receipt = { schema: "fenel.routing-owner-facts-integration.v1", order, events,
  scope: "Actual small registry producer and browser merger, real canonical helper/resolver and current scoped selection. Exact source-extracted candidate/cache/frame marshalling with delegation-only counters; no supplied internal helper policy or brand. Reader std functions compose the existing private harness with the small registry pool. No native timing or whole-app acceptance.",
  sourceHashes, fixtureSha256: sha(readFileSync(import.meta.path)), extractedSha256: sha(extracted), environment, moduleObservations, coldHelper,
  replay: { ...replay, configuredFile: replayFile, sha256: replaySha256, admissionBypassed: false },
  provenance: { originalPublisher: true, copiedOwner: true, graphDescriptorsAliasesCompared: true, comparedNodes },
  canonicalReuse: { twoRootsEightRequestsSourceCalls: 2, withTwoUnqualifiedRequestsSourceCalls: reuse.sourceCalls },
  callerOverrides: { internalIgnored: true, publicHelperCalls: helperCalls, dependencyCalls, invocationCalls },
  currentScopes: { sourceCalls: live.sourceCalls, frameCalls: live.frameCalls, scopes: live.scopes,
    authenticatedAccountsAndTagsAndFrameSelection: true },
  customHooks: { sourceCalls: customHooks.sourceCalls, hookCalls, unchangedStatefulRefusalObserved: true, canonicalRestoreReused: true },
  aba: abaResults, generalVersionChanged: true, generalSourceCalls: general.sourceCalls,
  closureThrowingHooks: { calls, methodActRestoredByCanonicalOwner: true, evaluatorIsolatedToEndingChild: true } };
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
mark("actual-owner-facts-integration-passed");
console.log(JSON.stringify({ receiptPath, canonicalReuse: receipt.canonicalReuse, scopes: receipt.currentScopes, closureThrowingHooks: receipt.closureThrowingHooks }));
