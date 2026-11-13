import { describe, expect, test } from "bun:test";
import { exprNodeToLogic } from "./expr-node-codec";
import { authoringExpressionLogic } from "./expression-evaluation";
import { withinWorkspaceLimit, WorkspaceLoadTimeoutError } from "../workspace-module-preload";

// Exercise the production lifecycle with registry construction held at its
// asynchronous host boundary. The complete registry semantics have their own
// engine gates; these checks catch a cold synchronous rebuild and identity swaps.
const sessionSource = await Bun.file(new URL("./authoring-session.ts", import.meta.url)).text();
const sessionStart = sessionSource.indexOf("function detachedSessionForRegistry(");
const sessionEnd = sessionSource.indexOf("const moduleSessions", sessionStart);
if (sessionStart < 0 || sessionEnd < 0) throw new Error("Detached session boundary changed");
const sessionCode = new Bun.Transpiler({ loader: "ts" }).transformSync(`
let detachedSessionCache;
let detachedSessionPreparation;
let detachedRepositoryPreparation;
const registrySessions = new WeakMap();
const detachedPreparedCatalogs = new WeakMap();
${sessionSource.slice(sessionStart, sessionEnd)}
`).replace(/^export /gm, "");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
}

function harness(limitMs = 1_000, worker = false) {
  const flights: Array<ReturnType<typeof deferred<object>>> = [];
  const catalogFlights: Array<ReturnType<typeof deferred<object>>> = [];
  const attached: Array<{ registry: object; catalog: object; session: object }> = [];
  const discarded: object[] = [];
  const workers = new Map<object, object>();
  const synchronousRegistry = { identity: "synchronous" };
  let synchronousBuilds = 0;
  let catalogs = 0;
  const scope = {
    // Select each host branch explicitly. Bun's ambient Worker must not boot a
    // real catalogue worker in this held-acquisition lifecycle fixture.
    Worker: worker ? function HeldWorker() {} : undefined,
    registerAuthoringSessionFacade: () => {},
    prepareRepositoryCatalogInWorker: () => {
      const flight = deferred<object>(); catalogFlights.push(flight); return flight.promise;
    },
    authoringWorkerSnapshot: (session: { registry: object }) => workers.get(session.registry),
    attachPreparedAuthoringWorker: (registry: object, catalog: object, session: object) => {
      workers.set(registry, catalog); attached.push({ registry, catalog, session });
    },
    discardPreparedAuthoringCatalog: (catalog: object) => { discarded.push(catalog); },
    createRepositoryRegistry: () => { synchronousBuilds++; return synchronousRegistry; },
    createRepositoryRegistryAsync: () => {
      const flight = deferred<object>(); flights.push(flight); return flight.promise;
    },
    modulesFor: (profile: string) => { expect(profile).toBe("seed"); return []; },
    dispatchRegistry: {},
    withinWorkspaceLimit: <T>(stage: string, load: () => Promise<T>, _limit: number | undefined,
      kind: "import" | "preparation") => withinWorkspaceLimit(stage, load, limitMs, kind),
    browserEvaluateContext: (registry: object) => ({ registry }),
    catalogFor: (registry: object) => { catalogs++; return { registry }; },
    environmentFor: (catalog: object) => ({ catalog }),
    createDetachedAuthoringEnvironment: (environment: object) => environment,
  };
  const api = new Function(...Object.keys(scope), `${sessionCode}
return { prepare: prepareDetachedAuthoringSession, session: DETACHED_AUTHORING_SESSION,
  peek: () => detachedSessionCache };`)(...Object.values(scope)) as {
    prepare(): Promise<{ registry: object }>;
    peek(): { registry: object } | undefined;
    session: { registry: object; evaluateContext: { registry: object }; catalog: object; environment: { catalog: object } };
  };
  return { ...api, flights, catalogFlights, attached, discarded, retireWorkers: () => workers.clear(),
    synchronousRegistry, synchronousBuilds: () => synchronousBuilds, catalogs: () => catalogs };
}

describe("detached workspace startup", () => {
  test("concurrent preparation shares a checked registry without building the picker catalog", async () => {
    const h = harness();
    const pending = h.prepare();
    expect(h.prepare()).toBe(pending);
    await Promise.resolve();
    expect(h.flights).toHaveLength(1);
    expect(h.synchronousBuilds()).toBe(0);
    expect(h.catalogs()).toBe(0);
    const registry = { identity: "checked" };
    h.flights[0]!.resolve(registry);
    const ready = await pending;
    expect(h.session.registry).toBe(registry);
    expect(h.session.evaluateContext.registry).toBe(registry);
    expect(h.catalogs()).toBe(0);
    expect(await h.prepare()).toBe(ready);
    expect(h.flights).toHaveLength(1);
    expect(h.session.catalog).toEqual({ registry });
    expect(h.session.environment.catalog).toBe(h.session.catalog);
    expect(h.catalogs()).toBe(1);
  });

  test("a failed checked build is retried and never falls back to a synchronous registry", async () => {
    const h = harness();
    const failed = h.prepare();
    await Promise.resolve();
    h.flights[0]!.reject(new Error("Registry checking failed"));
    await expect(failed).rejects.toThrow("Registry checking failed");
    const retried = h.prepare();
    await Promise.resolve();
    expect(h.flights).toHaveLength(2);
    const registry = { identity: "retried" };
    h.flights[1]!.resolve(registry);
    expect((await retried).registry).toBe(registry);
    expect(h.session.registry).toBe(registry);
    expect(h.synchronousBuilds()).toBe(0);
    expect(h.catalogs()).toBe(0);
  });

  test("a synchronous consumer cannot have its live registry replaced by a later preparation", async () => {
    const h = harness();
    const pending = h.prepare();
    await Promise.resolve();
    const registry = h.session.registry;
    const context = h.session.evaluateContext;
    const catalog = h.session.catalog;
    h.flights[0]!.resolve({ identity: "later" });
    expect((await pending).registry).toBe(registry);
    expect(h.session.registry).toBe(h.synchronousRegistry);
    expect(h.session.evaluateContext).toBe(context);
    expect(h.session.catalog).toBe(catalog);
    expect(h.session.catalog).toEqual({ registry });
    expect(h.catalogs()).toBe(1);
  });

  test("Retry resumes a pending checked build after the waiting deadline", async () => {
    const h = harness(30);
    const stalled = h.prepare();
    const error = await stalled.then(() => undefined, error => error);
    expect(error).toBeInstanceOf(WorkspaceLoadTimeoutError);
    expect(error.kind).toBe("preparation");
    expect(error.stage).toBe("data catalogue");
    expect(error.message).toContain("Retry to resume waiting");
    expect(error.message).not.toContain("server");
    expect(h.peek()).toBeUndefined();
    const retry = h.prepare();
    await Promise.resolve();
    expect(h.flights).toHaveLength(1);
    const registry = { identity: "same-checked-build" };
    h.flights[0]!.resolve(registry);
    expect((await retry).registry).toBe(registry);
    expect(h.session.registry).toBe(registry);
    expect(h.synchronousBuilds()).toBe(0);
  });

  test("a late completed build stays unpublished until Retry consumes it", async () => {
    const h = harness(30);
    await expect(h.prepare()).rejects.toBeInstanceOf(WorkspaceLoadTimeoutError);
    const registry = { identity: "completed-after-deadline" };
    h.flights[0]!.resolve(registry); await settle();
    expect(h.peek()).toBeUndefined();
    expect((await h.prepare()).registry).toBe(registry);
    expect(h.flights).toHaveLength(1);
  });

  test("repeated waiting deadlines do not start additional checked builds", async () => {
    const h = harness(30);
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(h.prepare()).rejects.toBeInstanceOf(WorkspaceLoadTimeoutError);
      expect(h.flights).toHaveLength(1);
      expect(h.peek()).toBeUndefined();
    }
    const retry = h.prepare(); await settle();
    const registry = { identity: "checked-once" };
    h.flights[0]!.resolve(registry);
    expect((await retry).registry).toBe(registry);
  });

  test("an actual late build refusal permits a fresh acquisition", async () => {
    const h = harness(30);
    await expect(h.prepare()).rejects.toBeInstanceOf(WorkspaceLoadTimeoutError);
    h.flights[0]!.reject(new Error("late checking refusal")); await settle();
    expect(h.peek()).toBeUndefined();
    const retry = h.prepare(); await settle();
    expect(h.flights).toHaveLength(2);
    const registry = { identity: "fresh-after-refusal" };
    h.flights[1]!.resolve(registry);
    expect((await retry).registry).toBe(registry);
  });

  test("a resumed wait propagates the actual refusal before a fresh retry", async () => {
    const h = harness(30);
    await expect(h.prepare()).rejects.toBeInstanceOf(WorkspaceLoadTimeoutError);
    const resumed = h.prepare(); await settle();
    expect(h.flights).toHaveLength(1);
    h.flights[0]!.reject(new Error("checking refused"));
    await expect(resumed).rejects.toThrow("checking refused");
    const fresh = h.prepare(); await settle();
    expect(h.flights).toHaveLength(2);
    const registry = { identity: "new-checked-build" };
    h.flights[1]!.resolve(registry);
    expect((await fresh).registry).toBe(registry);
    expect(h.synchronousBuilds()).toBe(0);
  });
});

describe("detached catalogue worker lifecycle", () => {
  test("publication and attachment wait for both checked owners", async () => {
    const h = harness(1_000, true);
    const pending = h.prepare();
    expect(h.prepare()).toBe(pending); await settle();
    const registry = { identity: "worker-checked-registry" };
    const catalog = { identity: "checked-worker-catalogue" };
    h.flights[0]!.resolve(registry); await settle();
    expect(h.peek()).toBeUndefined(); expect(h.attached).toEqual([]);
    h.catalogFlights[0]!.resolve(catalog);
    const session = await pending;
    expect(session.registry).toBe(registry);
    expect(h.attached).toEqual([{ registry, catalog, session }]);
    expect(h.session.catalog).toBe(catalog); expect(h.catalogs()).toBe(0);
    expect(await h.prepare()).toBe(session);
    expect(h.catalogFlights).toHaveLength(1); expect(h.flights).toHaveLength(1);
  });

  test("a timed-out attempt retires only its own late catalogue while Retry reuses the checked build", async () => {
    const h = harness(30, true);
    await expect(h.prepare()).rejects.toBeInstanceOf(WorkspaceLoadTimeoutError);
    const retry = h.prepare(); await settle();
    expect(h.flights).toHaveLength(1); expect(h.catalogFlights).toHaveLength(2);
    const registry = { identity: "retained-registry" }, oldCatalog = { identity: "old" }, catalog = { identity: "retry" };
    h.flights[0]!.resolve(registry); h.catalogFlights[1]!.resolve(catalog);
    const session = await retry;
    h.catalogFlights[0]!.resolve(oldCatalog); await settle();
    expect(h.discarded).toEqual([oldCatalog]);
    expect(h.attached).toEqual([{ registry, catalog, session }]);
    expect(h.session.catalog).toBe(catalog); expect(await h.prepare()).toBe(session);
  });

  test("a catalogue refusal does not duplicate a still-pending checked registry", async () => {
    const h = harness(1_000, true);
    const failed = h.prepare(); await settle();
    h.catalogFlights[0]!.reject(new Error("catalogue refused"));
    await expect(failed).rejects.toThrow("catalogue refused");
    const retry = h.prepare(); await settle();
    expect(h.flights).toHaveLength(1); expect(h.catalogFlights).toHaveLength(2);
    const registry = { identity: "retained" }, catalog = { identity: "fresh-catalogue" };
    h.flights[0]!.resolve(registry); h.catalogFlights[1]!.resolve(catalog);
    const session = await retry;
    expect(h.attached).toEqual([{ registry, catalog, session }]);
  });

  test("a registry refusal retires its catalogue and checks a fresh registry on Retry", async () => {
    const h = harness(1_000, true);
    const failed = h.prepare(); await settle();
    h.flights[0]!.reject(new Error("registry refused"));
    await expect(failed).rejects.toThrow("registry refused");
    const retry = h.prepare(); await settle();
    expect(h.flights).toHaveLength(2);
    const oldCatalog = { identity: "rejected-attempt" }, registry = { identity: "fresh" }, catalog = { identity: "fresh-catalogue" };
    h.catalogFlights[0]!.resolve(oldCatalog); await settle();
    expect(h.discarded).toEqual([oldCatalog]); expect(h.attached).toEqual([]);
    h.flights[1]!.resolve(registry); h.catalogFlights[1]!.resolve(catalog);
    const session = await retry;
    expect(h.attached).toEqual([{ registry, catalog, session }]);
  });

  test("a synchronous winner keeps its session and context while the worker attaches", async () => {
    const h = harness(1_000, true);
    const pending = h.prepare(); await settle();
    const registry = h.session.registry, context = h.session.evaluateContext;
    const catalog = { identity: "worker-catalogue" };
    h.flights[0]!.resolve({ identity: "later" }); h.catalogFlights[0]!.resolve(catalog);
    const session = await pending;
    expect(session.registry).toBe(h.synchronousRegistry);
    expect(h.session.registry).toBe(registry); expect(h.session.evaluateContext).toBe(context);
    expect(h.attached).toEqual([{ registry, catalog, session }]);
    expect(h.session.catalog).toBe(catalog);
  });

  test("worker retirement rebuilds only the catalogue against the same live registry", async () => {
    const h = harness(1_000, true);
    const first = h.prepare(); await settle();
    const registry = { identity: "live" }, catalog = { identity: "first" };
    h.flights[0]!.resolve(registry); h.catalogFlights[0]!.resolve(catalog);
    const session = await first;
    h.retireWorkers();
    const reattached = h.prepare(); await settle();
    expect(h.flights).toHaveLength(1); expect(h.catalogFlights).toHaveLength(2);
    const freshCatalog = { identity: "new-epoch-catalogue" };
    h.catalogFlights[1]!.resolve(freshCatalog);
    expect(await reattached).toBe(session);
    expect(h.attached.at(-1)).toEqual({ registry, catalog: freshCatalog, session });
  });
});

const editorSource = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
const codecStart = editorSource.indexOf("export function toLogic(");
const codecEnd = editorSource.indexOf("/** One marshal/evaluate boundary", codecStart);
if (codecStart < 0 || codecEnd < 0) throw new Error("Expression codec adapter changed");
const codecCode = new Bun.Transpiler({ loader: "ts" }).transformSync(editorSource.slice(codecStart, codecEnd))
  .replace(/^export /gm, "");
const toLogic = new Function("authoringExpressionLogic", `${codecCode}\nreturn toLogic;`)(authoringExpressionLogic) as
  (node: Parameters<typeof exprNodeToLogic>[0], resolver: undefined, session: object) => unknown;

test("ordinary saved workspace literals use the canonical codec without acquiring a picker catalog", () => {
  const value = { $tag: "WorkspacePreferences", lenses: [], activeLensId: "lens", display: { $tag: "SingleLens" },
    bar: { $tag: "WorkspaceBar", mode: { $tag: "DockedBar" }, position: { $tag: "BarTop" } }, presentations: [] };
  const session = { get environment(): never { throw new Error("The picker catalog was acquired"); } };
  expect(toLogic({ kind: "literal", value }, undefined, session)).toEqual(exprNodeToLogic({ kind: "literal", value }));
});

test("call expressions still resolve their exact identities through the same authoring environment", () => {
  let reads = 0;
  const environment = {
    functionCodeName: (id: string) => id === "saved-call-id" ? "example.makeWorkspace" : undefined,
    constructorCodeName: () => undefined,
  };
  const session = { get environment() { reads++; return environment; } };
  const node = { kind: "call" as const, fnId: "saved-call-id", args: [{ kind: "literal" as const, value: 42 }] };
  expect(toLogic(node, undefined, session)).toEqual(exprNodeToLogic(node, {
    fnCodeName: (id) => environment.functionCodeName(id) ?? id,
    constructorName: environment.constructorCodeName,
  }));
  expect(reads).toBeGreaterThan(0);
});
