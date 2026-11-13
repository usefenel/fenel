import { describe, expect, test } from "bun:test";
import { withinWorkspaceLimit, WorkspaceLoadTimeoutError } from "./workspace-module-preload";

// Hold registry work at the host import boundary. The separate semantic proof
// checks the real selected modules; these checks cover cache sharing, refusal
// and the asynchronous complete-model fallback after a literal first load.
const source = await Bun.file(new URL("./workspace-model-loader.ts", import.meta.url)).text();
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source)
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "").replace(/\bimport\(/g, "loadModule(");

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  let completePreparations = 0;
  const imports: string[] = [];
  const flights: Array<ReturnType<typeof deferred<object>>> = [];
  const preparations: unknown[] = [];
  const complete = { workspaceCall: () => "complete", prepareProjectedWorkspaceModel: (options?: unknown) => {
    preparations.push(options);
    const flight = deferred<object>(); flights.push(flight); return flight.promise;
  } };
  const full = deferred<void>();
  const boundaries = {
    preloadWorkspaceModules: async () => {},
    preloadWorkspaceSlice: (_name: string, load: () => Promise<unknown>) => load(),
    loadModule: async (path: string) => {
      imports.push(path);
      if (path === "./workspace-model") return complete;
      if (path === "./expression-runner/authoring-session") return {
        prepareDetachedAuthoringSession: async () => { completePreparations++; await full.promise; },
      };
      throw new Error(`Unexpected module ${path}`);
    },
  };
  const load = new Function(...Object.keys(boundaries), `${code}; return loadWorkspaceModel;`)(...Object.values(boundaries)) as
    (options?: { projected?: boolean; preparation?: "inline" }) => Promise<typeof complete>;
  return { load, imports, flights, full, complete, preparations, completePreparations: () => completePreparations };
}

async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe("literal and authored workspace model preparation", () => {
  test("worker preparation selects the inline host and retains one realm-owned model", async () => {
    const h = harness();
    const first = h.load({ projected: true, preparation: "inline" });
    await settle();
    expect(h.preparations).toEqual([{ preparation: "inline" }]);
    h.flights[0]!.resolve({ workspaceCall: () => "worker" });
    expect((await first).workspaceCall()).toBe("worker");
    expect(await h.load({ projected: true, preparation: "inline" })).toBe(await first);
    expect(h.preparations).toHaveLength(1);
    expect(h.completePreparations()).toBe(0);
  });
  test("literal requests share only their checked model and never acquire the complete detached model", async () => {
    const h = harness();
    const first = h.load({ projected: true });
    expect(h.load({ projected: true })).toBe(first);
    await settle();
    expect(h.flights).toHaveLength(1);
    expect(h.completePreparations()).toBe(0);
    expect(h.imports).toEqual(["./workspace-model"]);
    const projected = { workspaceCall: () => "literal" };
    h.flights[0]!.resolve(projected);
    const ready = await first;
    expect(ready.workspaceCall()).toBe("literal");
    expect(await h.load({ projected: true })).toBe(ready);
    expect(h.completePreparations()).toBe(0);
  });

  test("authored or reloaded expressions still await the separate complete detached preparation", async () => {
    const h = harness();
    const literal = h.load({ projected: true });
    await settle();
    h.flights[0]!.resolve({ workspaceCall: () => "literal" });
    await literal;
    const authored = h.load();
    expect(h.load()).toBe(authored);
    let complete = false;
    void authored.then(() => { complete = true; });
    await settle();
    expect(h.completePreparations()).toBe(1);
    expect(complete).toBe(false);
    expect(h.imports).toContain("./expression-runner/authoring-session");
    h.full.resolve();
    expect(await authored).toBe(h.complete);
    expect((await h.load()).workspaceCall()).toBe("complete");
    expect((await h.load({ projected: true })).workspaceCall()).toBe("literal");
  });

  test("a refused narrow build retries without occupying the complete-model cache", async () => {
    const h = harness();
    const failed = h.load({ projected: true });
    await settle();
    h.flights[0]!.reject(new Error("checked model refused"));
    await expect(failed).rejects.toThrow("checked model refused");
    const retry = h.load({ projected: true });
    await settle();
    expect(h.flights).toHaveLength(2);
    h.flights[1]!.resolve({ workspaceCall: () => "retried" });
    expect((await retry).workspaceCall()).toBe("retried");
    expect(h.completePreparations()).toBe(0);
    const authored = h.load();
    await settle();
    expect(h.completePreparations()).toBe(1);
    h.full.resolve();
    expect(await authored).toBe(h.complete);
  });
});

// Exercise the actual projected-model owner with its checked registry held at
// the asynchronous host boundary. A waiting deadline cannot cancel that build.
const modelSource = await Bun.file(new URL("./workspace-model.ts", import.meta.url)).text();
const projectedStart = modelSource.indexOf("const projectedPreparationHost =");
if (projectedStart < 0) throw new Error("Projected workspace preparation boundary changed");
const projectedCode = new Bun.Transpiler({ loader: "ts" }).transformSync(modelSource.slice(projectedStart))
  .replace(/^export /gm, "").replaceAll("import(", "loadModule(");

function projectedHarness(limitMs = 30) {
  const flights: Array<ReturnType<typeof deferred<object>>> = [];
  const modules = [{ name: "checked-projected-modules" }];
  const dispatch = {};
  const authorities: object[] = [];
  const inlineRegistries: object[] = [];
  let earlyAvailable = false;
  const earlyLease = {}, fallbackLease = {};
  let acquireHost!: () => Promise<object>;
  const scope = {
    availableEarlyAuthoringRealm: () => earlyAvailable ? {} : undefined,
    createRegistryPreparationHost: (acquire: () => Promise<object>) => { acquireHost = acquire; return acquire; },
    acquireRegistryPreparationWorker: () => fallbackLease,
    loadModule: async () => ({ acquireEarlyLocalEnginePreparation: () => earlyAvailable ? earlyLease : undefined }),
    PROJECTED_WORKSPACE_MODULES: modules,
    dispatchRegistry: dispatch,
    createRepositoryRegistry: (input: object, options: { dispatchRegistry: object }) => {
      expect(input).toBe(modules);
      expect(options).toEqual({ dispatchRegistry: dispatch });
      const registry = {}; inlineRegistries.push(registry); return registry;
    },
    createRepositoryRegistryAsync: (input: object, options: { dispatchRegistry: object; preparationHost: unknown }) => {
      expect(input).toBe(modules);
      expect(options.dispatchRegistry).toBe(dispatch);
      expect(options.preparationHost).toBe(acquireHost);
      const flight = deferred<object>(); flights.push(flight); return flight.promise;
    },
    evaluateContextForCatalog: (registry: object) => ({ registry }),
    mintAnonymousAuthority: (registry: object) => { authorities.push(registry); return { registry }; },
    workspaceModelFor: (read: () => { registry: object; evaluateContext: object }) => ({ read }),
    withinWorkspaceLimit: <T>(stage: string, load: () => Promise<T>, _limit?: number,
      kind?: "import" | "preparation") => withinWorkspaceLimit(stage, load, limitMs, kind),
  };
  const prepare = new Function(...Object.keys(scope), `${projectedCode}; return prepareProjectedWorkspaceModel;`)(...Object.values(scope)) as
    (options?: { preparation?: "inline" }) => Promise<{ read: () => { registry: object; evaluateContext: { _authority: { registry: object }; _dictStack: unknown[]; _activeTags: unknown[]; _importStack: unknown[] } } }>;
  return { prepare, flights, authorities, inlineRegistries, acquire: () => acquireHost(), earlyLease, fallbackLease, setEarly: (value: boolean) => { earlyAvailable = value; } };
}

describe("projected workspace checked-build lifetime", () => {
  test("inline worker preparation keeps the same anonymous model without the async worker host", async () => {
    const h = projectedHarness();
    const model = await h.prepare({ preparation: "inline" });
    expect(h.flights).toEqual([]);
    expect(h.inlineRegistries).toHaveLength(1);
    expect(model.read().registry).toBe(h.inlineRegistries[0]!);
    expect(model.read().evaluateContext).toMatchObject({
      _authority: { registry: h.inlineRegistries[0] }, _dictStack: [], _activeTags: [], _importStack: [],
    });
    expect(Object.isFrozen(model.read().evaluateContext)).toBe(true);
    expect(await h.prepare({ preparation: "inline" })).toBe(model);
    expect(h.inlineRegistries).toHaveLength(1);
    expect(h.authorities).toEqual(h.inlineRegistries);
  });
  test("the host chooses a live early realm per acquisition and otherwise preserves fallback", async () => {
    const h = projectedHarness();
    expect(await h.acquire()).toBe(h.fallbackLease);
    h.setEarly(true);
    expect(await h.acquire()).toBe(h.earlyLease);
    h.setEarly(false);
    expect(await h.acquire()).toBe(h.fallbackLease);
  });
  test("repeated waiting deadlines and concurrent retries reuse the same checked build", async () => {
    const h = projectedHarness();
    for (let attempt = 0; attempt < 3; attempt++) {
      const error = await h.prepare().then(() => undefined, error => error);
      expect(error).toBeInstanceOf(WorkspaceLoadTimeoutError);
      expect(h.flights).toHaveLength(1);
      expect(h.authorities).toEqual([]);
    }
    const retry = h.prepare();
    const concurrent = h.prepare();
    await settle();
    expect(h.flights).toHaveLength(1);
    const registry = { identity: "one-checked-projection" };
    h.flights[0]!.resolve(registry);
    const model = await retry;
    expect(await concurrent).toBe(model);
    expect(await h.prepare()).toBe(model);
    expect(model.read().registry).toBe(registry);
    expect(model.read().evaluateContext).toMatchObject({
      _authority: { registry }, _dictStack: [], _activeTags: [], _importStack: [],
    });
    expect(Object.isFrozen(model.read().evaluateContext)).toBe(true);
    expect(h.authorities).toEqual([registry]);
  });

  test("a completed build remains reusable after its waiter times out", async () => {
    const h = projectedHarness();
    const error = await h.prepare().then(() => undefined, error => error);
    expect(error).toBeInstanceOf(WorkspaceLoadTimeoutError);
    expect(error.kind).toBe("preparation");
    expect(error.message).toContain("Retry to resume waiting");
    const registry = { identity: "late-success" };
    h.flights[0]!.resolve(registry);
    await settle();
    expect((await h.prepare()).read().registry).toBe(registry);
    expect(h.flights).toHaveLength(1);
    expect(h.authorities).toEqual([registry]);
  });

  test("an actual build refusal permits a fresh checked acquisition", async () => {
    const h = projectedHarness();
    const failed = h.prepare();
    await settle();
    h.flights[0]!.reject(new Error("projection checking refused"));
    await expect(failed).rejects.toThrow("projection checking refused");
    const retry = h.prepare();
    await settle();
    expect(h.flights).toHaveLength(2);
    const registry = { identity: "fresh-after-refusal" };
    h.flights[1]!.resolve(registry);
    expect((await retry).read().registry).toBe(registry);
    expect(h.authorities).toEqual([registry]);
  });

  test("an actual late refusal permits retry after a waiting deadline", async () => {
    const h = projectedHarness();
    await expect(h.prepare()).rejects.toBeInstanceOf(WorkspaceLoadTimeoutError);
    h.flights[0]!.reject(new Error("late checked refusal"));
    await settle();
    const retry = h.prepare();
    await settle();
    expect(h.flights).toHaveLength(2);
    const registry = { identity: "fresh-after-late-refusal" };
    h.flights[1]!.resolve(registry);
    expect((await retry).read().registry).toBe(registry);
    expect(h.authorities).toEqual([registry]);
  });
});
