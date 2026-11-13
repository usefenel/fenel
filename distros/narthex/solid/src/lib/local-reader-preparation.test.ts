import { describe, expect, test } from "bun:test";

// C1 / B4 wave 5: execute the production acquisition boundary with its owners
// held. A Local snapshot's only checked preparation is its worker catalogue;
// the page harness is prepared beside it (scheduling only). No page registry
// is built: the snapshot's registry is a token and its session is frameless.
// The former page owners (the registry builder, the page session factory and
// the preparation host) are bound to THROW here: preparation, rebuild and
// restore all succeed without them. This verifies scheduling/publication, not
// registry semantic clearance.
const source = await Bun.file(new URL("./local-locus-data.ts", import.meta.url)).text();
const start = source.indexOf("function waitForLocalPageHarness(");
const end = source.indexOf("export type LocalSavedValueRow", start);
if (start < 0 || end <= start) throw new Error("Local reader preparation boundary changed");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end))
  .replace(/^export /gm, "").replace(/\bimport\(/g, "loadModule(");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let tick = 0; tick < 12; tick++) await Promise.resolve(); }
async function expectRefusal(pending: Promise<unknown>, message: string) {
  try { await pending; }
  catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(message);
    return;
  }
  throw new Error(`Preparation accepted instead of refusing: ${message}`);
}
const pageBuild = (what: string) => () => { throw new Error(`A Local page ${what} was used.`); };

function harness(options: { holdImports?: boolean; sessionFailure?: boolean; displayMissing?: boolean; presentationFailure?: boolean;
  retirements?: Map<string, Promise<void>>; sourceId?: string; harnessFailure?: Error } = {}) {
  const sourceId = options.sourceId ?? "this-tab-source";
  const type = { id: "local-type", type: { $ref: "String" } };
  const fn = { id: "local-function", params: [], returns: type.type };
  const snapshot = { owners: [
    { kind: "type", storageName: "LocalType", definition: type },
    { kind: "function", storageName: "LocalFunction", definition: fn },
  ], fields: [{ id: "local-field" }], facets: [{ target: type.id }] };
  const representations = [{ id: "local-representation" }];
  const localValueIds = ["saved-number"];
  const catalog = { id: "exact-worker-catalogue", functions: [{ id: "local-function", label: "Local function" }] };
  const owner = { id: "exact-snapshot-owner" };
  const tokens: object[] = [];
  const display = [{ id: "exact-display-catalogue" }];
  const catalogueJob = deferred<typeof catalog>();
  const harnessJob = deferred<void>();
  const importJob = deferred<void>();
  const started = deferred<void>();
  const events: string[] = [];
  const timers: Array<{ callback: () => void; active: boolean }> = [];
  type PreparationOptions = { signal: AbortSignal; representations?: unknown; localValueIds?: unknown; onRegistryPreparation?: unknown };
  const inputs: Array<{ sourceId: string; snapshot: unknown; options: PreparationOptions }> = [];
  const sessions: Array<{ registry: unknown; owner: unknown; sourceId: string; functions: unknown; catalog: unknown; session: object }> = [];
  const discardedCatalogues: unknown[] = [];
  const bindings = {
    setTimeout: (callback: () => void) => { const timer = { callback, active: true }; timers.push(timer); return timer; },
    clearTimeout: (timer: { active: boolean }) => { timer.active = false; },
    localPreparationRetirements: options.retirements ?? new Map<string, Promise<void>>(),
    // The deleted page owners: any use refuses.
    buildLocalReaderFieldRegistry: pageBuild("registry build"),
    loadModule: async (path: string) => {
      events.push(`import:${path}`);
      if (options.holdImports) await importJob.promise;
      if (path === "./expression-runner/authoring-session") return {
        prepareLocalReaderAuthoringSession: pageBuild("session preparation"),
        createLocalReaderAuthoringSession: (registry: unknown, preparedOwner: unknown, id: string, functions: unknown, preparedCatalog: unknown) => {
          events.push("session");
          if (options.sessionFailure) throw new Error("session refused");
          const session = Object.freeze({ frameless: true, registry });
          sessions.push({ registry, owner: preparedOwner, sourceId: id, functions, catalog: preparedCatalog, session });
          return session;
        },
      };
      if (path === "./expression-runner/authoring-catalog-worker") return {
        prepareLocalCatalogInWorker: (id: string, captured: unknown, types: unknown, functions: unknown, preparationOptions: PreparationOptions) => {
          events.push("catalogue:start"); inputs.push({ sourceId: id, snapshot: captured, options: preparationOptions });
          expect(types).toEqual([{ id: type.id, type: type.type }]); expect(functions).toEqual([fn]);
          // No page registry borrows this initialization any more.
          expect(preparationOptions.onRegistryPreparation).toBeUndefined();
          started.resolve();
          return catalogueJob.promise;
        },
        prepareLocalPageHarness: () => {
          events.push("harness:start");
          if (options.harnessFailure) throw options.harnessFailure;
          return harnessJob.promise;
        },
        acquireLocalRegistryPreparation: pageBuild("registry preparation lease"),
        createLocalRegistryToken: () => { const token = Object.freeze({ token: tokens.length + 1 }); tokens.push(token); return token; },
        createPreparedSnapshotOwner: () => owner,
        preparedAuthoringDisplayCatalog: (prepared: unknown) => {
          expect(prepared).toBe(owner); events.push("display"); return options.displayMissing ? undefined : display;
        },
        prepareReaderWorkerHandle: (prepared: unknown) => { expect(prepared).toBe(catalog); return catalog; },
        runPreparedReaderWorker: async (prepared: unknown, payload: { method: string; targets: string[] }) => {
          expect(prepared).toBe(catalog); expect(payload.method).toBe("project-reader-presentations");
          if (options.presentationFailure) throw new Error("presentation refused");
          return { presentations: payload.targets.map(target => ({ target, presentation: { label: `label:${target}` } })) };
        },
        discardPreparedAuthoringCatalog: (prepared: unknown) => { discardedCatalogues.push(prepared); },
      };
      if (path === "../../../../../implementations/typescript/engine/src/field-identity-worker-client") return {
        createRegistryPreparationHost: pageBuild("registry preparation host"),
      };
      throw new Error(`Unexpected local preparation import: ${path}`);
    },
  };
  const prepare = new Function(...Object.keys(bindings), `${code}; return prepareLocalReaderSnapshot;`)(...Object.values(bindings)) as
    (id: string, snapshot: unknown, options?: { signal?: AbortSignal; representations?: unknown; localValueIds?: string[]; restore?: { registry: unknown; owner: unknown } }) => Promise<{
      kind: string; owner: unknown; worker: unknown; callableLabels: unknown;
      registry: unknown; session: unknown; functions: unknown[]; types: unknown[]; functionRows: unknown[]; catalog: unknown;
    }>;
  const restored = Object.freeze({ token: "published" });
  return { prepare: (signal?: AbortSignal) => prepare(sourceId, snapshot, { signal, representations, localValueIds }),
    prepareWorker: (signal?: AbortSignal) => prepare(sourceId, snapshot, { signal, representations, localValueIds, restore: { registry: restored, owner } }),
    started: started.promise, events, inputs, snapshot, representations, localValueIds, restored, tokens, sessions, owner, catalog, display, type, fn,
    catalogueJob, harnessJob, importJob, discardedCatalogues,
    expireTimers: () => { for (const timer of [...timers]) if (timer.active) { timer.active = false; timer.callback(); } } };
}

describe("checked local reader preparation without a page registry", () => {
  test("captures saved identity evidence before imports yield on initial preparation and restoration", async () => {
    for (const restore of [false, true]) {
      const h = harness({ holdImports: true });
      const pending = restore ? h.prepareWorker() : h.prepare();
      h.localValueIds[0] = "later-number";
      h.localValueIds.push("unrelated-number");
      h.importJob.resolve();
      await h.started;
      expect(h.inputs[0]!.options.localValueIds).toEqual(["saved-number"]);
      h.catalogueJob.resolve(h.catalog); h.harnessJob.resolve();
      await pending;
    }
  });
  test("saved type declarations survive local rows and account snapshot replacement without invented legacy schemes", async () => {
    const { typeDefinitionFromJsonWire, typeDefinitionToJsonWire } = await import("@fenel/engine/authoring/expression");
    const h = harness();
    const metadata = { params: ["a"], typeScheme: {
      quantified: [{ id: "local-type:a", sourceName: "a", kind: { $tag: "KType" as const } }],
      body: h.type.type, applications: [], nominals: [], diagnostics: [],
    } };
    const reopened = typeDefinitionFromJsonWire(JSON.parse(JSON.stringify(typeDefinitionToJsonWire({ ...h.type, ...metadata }))));
    Object.assign(h.type, reopened);
    const pending = h.prepare();
    await h.started;
    h.catalogueJob.resolve(h.catalog); h.harnessJob.resolve();
    const result = await pending;
    expect(result.types[0]).toMatchObject(metadata);
    const accountSource = await Bun.file(new URL("./reader-runtime.tsx", import.meta.url)).text();
    const projectionStart = accountSource.indexOf("const priorTypeNames =");
    const projectionEnd = accountSource.indexOf("prepared = await prepareAccountSnapshot", projectionStart);
    if (projectionStart < 0 || projectionEnd <= projectionStart) throw new Error("Account owner row projection moved");
    const projection = new Bun.Transpiler({ loader: "ts" }).transformSync(accountSource.slice(projectionStart, projectionEnd));
    const replaceRows = new Function("definitions", "nextDefinitions", "captured", `${projection}; return types;`);
    const owner = { kind: "type", storageName: "LocalType", storageId: "stored-type", definition: reopened };
    const prior = { id: "stored-type", name: "LocalType", ...metadata, declaration: metadata, label: "Retained label" };
    const rows = replaceRows({ owners: [owner] }, { owners: [owner] }, { types: [prior], functionRows: [] });
    expect(rows[0]).toMatchObject({ ...metadata, label: "Retained label", id: "stored-type" });
    const legacy = { ...owner, definition: { id: h.type.id, type: h.type.type, params: ["legacy"] } };
    const replaced = replaceRows({ owners: [owner] }, { owners: [legacy] }, { types: [prior], functionRows: [] });
    expect(replaced[0].params).toEqual(["legacy"]);
    expect(replaced[0]).not.toHaveProperty("typeScheme");
    expect(replaced[0]).not.toHaveProperty("declaration");
  });

  test("the catalogue and the page harness start together; publication waits for a warm-up still under construction and yields a token and a frameless session", async () => {
    const h = harness(); const pending = h.prepare(); let published = false;
    void pending.then(() => { published = true; });
    await h.started;
    expect(h.events.filter(event => !event.startsWith("import:"))).toEqual(["harness:start", "catalogue:start"]);
    expect(h.inputs).toHaveLength(1);
    expect(h.inputs[0]).toMatchObject({ sourceId: "this-tab-source", snapshot: h.snapshot });
    expect(h.inputs[0]!.options.representations).toBe(h.representations);
    expect(h.inputs[0]!.options.signal.aborted).toBe(false);
    h.catalogueJob.resolve(h.catalog); await settle();
    expect(published).toBe(false); expect(h.events).not.toContain("session");
    h.harnessJob.resolve();
    const result = await pending;
    expect(h.tokens).toHaveLength(1);
    expect(result.registry).toBe(h.tokens[0]);
    expect(h.sessions).toEqual([{ registry: h.tokens[0], owner: h.owner, sourceId: "this-tab-source", functions: [h.fn],
      catalog: h.catalog, session: h.sessions[0]!.session }]);
    expect(result.session).toBe(h.sessions[0]!.session);
    expect(result).toMatchObject({ functions: [h.fn], catalog: h.display, callableLabels: [{ id: "local-function", label: "Local function" }],
      types: [{ id: h.type.id, name: "LocalType", type: h.type.type, isSystem: false, label: `label:${h.type.id}` }],
      functionRows: [{ id: h.fn.id, name: "LocalFunction", function: h.fn, isSystem: false, label: `label:${h.fn.id}` }] });
    expect(result.functions[0]).toBe(h.fn); expect(result.catalog).toBe(h.display);
    // The snapshot carries its routing owner and the worker it owns.
    expect(result.kind).toBe("local"); expect(result.owner).toBe(h.owner); expect(result.worker).toBe(h.catalog);
    expect(h.discardedCatalogues).toEqual([]);
    // Nothing imported the deleted page preparation host.
    expect(h.events.some(event => event.includes("field-identity-worker-client"))).toBe(false);
  });

  test("a restoration reuses its snapshot's token and owner and prepares only a fresh worker catalogue and session", async () => {
    const h = harness(); const pending = h.prepareWorker();
    await h.started;
    h.catalogueJob.resolve(h.catalog); h.harnessJob.resolve();
    const result = await pending;
    expect(h.tokens).toEqual([]);
    expect(result.registry).toBe(h.restored); expect(result.owner).toBe(h.owner);
    expect(h.sessions[0]).toMatchObject({ registry: h.restored, owner: h.owner });
    expect(result.session).toBe(h.sessions[0]!.session); expect(result.catalog).toBe(h.display);
    expect(h.discardedCatalogues).toEqual([]);
  });

  test("a rebuild takes a new token for its new snapshot", async () => {
    const h = harness();
    const first = h.prepare(); await h.started; h.catalogueJob.resolve(h.catalog); h.harnessJob.resolve();
    const second = h.prepare(); await settle();
    const [one, two] = [await first, await second];
    expect(h.tokens).toHaveLength(2);
    expect(one.registry).toBe(h.tokens[0]); expect(two.registry).toBe(h.tokens[1]);
    expect(one.session).not.toBe(two.session);
  });

  test("elapsed time never publishes while the shared page harness is unfinished", async () => {
    const h = harness(); const pending = h.prepare(); let published = false;
    void pending.then(() => { published = true; });
    await h.started; h.catalogueJob.resolve(h.catalog);
    await settle();
    // Exercise any elapsed-time fallback installed by the actual acquisition
    // boundary. It may refuse, but must never publish unready tools.
    h.expireTimers(); await settle();
    expect(published).toBe(false); expect(h.tokens).toEqual([]); expect(h.sessions).toEqual([]);
    h.harnessJob.resolve();
    expect((await pending).registry).toBe(h.tokens[0]);
  });

  test("a failed required harness refuses immediately and retires a later catalogue", async () => {
    const h = harness(); const pending = h.prepare();
    const rejection = expectRefusal(pending, "harness refused");
    await h.started; h.harnessJob.reject(new Error("harness refused")); await rejection;
    expect(h.inputs[0]!.options.signal.aborted).toBe(true);
    expect(h.tokens).toEqual([]); expect(h.sessions).toEqual([]);
    h.catalogueJob.resolve(h.catalog); await settle();
    expect(h.discardedCatalogues).toEqual([h.catalog]);
  });

  test("a synchronous harness refusal starts no worker and leaves Retry unblocked", async () => {
    const retirements = new Map<string, Promise<void>>();
    const failed = harness({ retirements, harnessFailure: new Error("synchronous harness refusal") });
    await expectRefusal(failed.prepare(), "synchronous harness refusal");
    expect(failed.inputs).toEqual([]); expect(failed.tokens).toEqual([]);
    const retry = harness({ retirements }); const retrying = retry.prepare(); await retry.started;
    retry.harnessJob.resolve(); retry.catalogueJob.resolve(retry.catalog);
    expect((await retrying).registry).toBe(retry.tokens[0]);
  });

  test("cancelling a hung harness wait releases the source retirement barrier", async () => {
    const retirements = new Map<string, Promise<void>>();
    const first = harness({ retirements }); const controller = new AbortController();
    const pending = first.prepare(controller.signal); const rejection = expectRefusal(pending, "source replaced");
    await first.started; first.catalogueJob.resolve(first.catalog); await settle();
    controller.abort(new Error("source replaced")); await rejection;
    expect(first.discardedCatalogues).toEqual([first.catalog]);
    // first.harnessJob intentionally never settles. A new source attempt owns
    // a new cancellable wait, not the abandoned attempt's global warm-up.
    const retry = harness({ retirements }); const retrying = retry.prepare(); await retry.started;
    retry.catalogueJob.resolve(retry.catalog); retry.harnessJob.resolve();
    expect((await retrying).registry).toBe(retry.tokens[0]);
  });

  test("a failed rebuild releases its retirement barrier without awaiting the abandoned shared warm-up", async () => {
    const retirements = new Map<string, Promise<void>>();
    const failed = harness({ retirements }); const rebuild = failed.prepare();
    const refusal = expectRefusal(rebuild, "rebuild refused");
    await failed.started; failed.catalogueJob.reject(new Error("rebuild refused")); await refusal;
    const restoring = harness({ retirements }); const pending = restoring.prepareWorker();
    await restoring.started;
    expect(restoring.events).toContain("catalogue:start");
    restoring.catalogueJob.resolve(restoring.catalog); restoring.harnessJob.resolve();
    expect((await pending).registry).toBe(restoring.restored);
    failed.harnessJob.resolve();
  });

  test("harness-first completion also waits for the exact complete catalogue", async () => {
    const h = harness(); const pending = h.prepare(); await h.started;
    h.harnessJob.resolve(); await settle(); expect(h.events).not.toContain("session");
    h.catalogueJob.resolve(h.catalog); expect((await pending).registry).toBe(h.tokens[0]);
  });

  test("a catalogue refusal publishes nothing and creates no token or session", async () => {
    const h = harness(); const pending = h.prepare(); const rejection = expectRefusal(pending, "catalogue refused");
    await h.started; h.catalogueJob.reject(new Error("catalogue refused")); await rejection;
    expect(h.inputs[0]!.options.signal.aborted).toBe(true); expect(h.events).not.toContain("session");
    h.harnessJob.resolve(); await settle();
    expect(h.tokens).toEqual([]); expect(h.discardedCatalogues).toEqual([]);
  });

  test("Retry's retirement barrier waits for the abandoned catalogue, never for shared warm-up", async () => {
    const retirements = new Map<string, Promise<void>>();
    const first = harness({ retirements }), retry = harness({ retirements });
    const opening = first.prepare(); const refusal = expectRefusal(opening, "catalogue refused");
    await first.started;
    const retrying = retry.prepare(); await settle();
    expect(retry.events).toEqual([]);
    // The first catalogue refuses; its warm-up (first.harnessJob) never settles.
    first.catalogueJob.reject(new Error("catalogue refused")); await refusal; await retry.started;
    expect(retry.events.filter(event => !event.startsWith("import:"))).toEqual(["harness:start", "catalogue:start"]);
    retry.harnessJob.resolve(); retry.catalogueJob.resolve(retry.catalog);
    expect((await retrying).registry).toBe(retry.tokens[0]);
    await settle(); expect(retirements.size).toBe(0);
  });

  test("a cancelled waiting Retry starts nothing and does not block a later Retry", async () => {
    const retirements = new Map<string, Promise<void>>();
    const first = harness({ retirements }), cancelled = harness({ retirements }), retry = harness({ retirements });
    const opening = first.prepare(); const refusal = expectRefusal(opening, "catalogue refused");
    await first.started;
    const controller = new AbortController();
    const waiting = cancelled.prepare(controller.signal); const cancellation = expectRefusal(waiting, "source closed");
    controller.abort(new Error("source closed"));
    const retrying = retry.prepare(); await settle();
    expect(cancelled.events).toEqual([]); expect(retry.events).toEqual([]);
    first.catalogueJob.reject(new Error("catalogue refused")); await refusal; await cancellation; await retry.started;
    expect(cancelled.events).toEqual([]);
    retry.harnessJob.resolve(); retry.catalogueJob.resolve(retry.catalog);
    await retrying; await settle(); expect(retirements.size).toBe(0);
  });

  test("an abandoned preparation does not hold preparation for a different source", async () => {
    const retirements = new Map<string, Promise<void>>();
    const first = harness({ retirements }), other = harness({ retirements, sourceId: "another-local-source" });
    const opening = first.prepare(); const refusal = expectRefusal(opening, "catalogue refused");
    await first.started; first.catalogueJob.reject(new Error("catalogue refused")); await refusal;
    const separate = other.prepare(); await other.started;
    other.harnessJob.resolve(); other.catalogueJob.resolve(other.catalog);
    expect((await separate).registry).toBe(other.tokens[0]);
    first.harnessJob.resolve(); await settle(); expect(retirements.size).toBe(0);
  });

  test("an already cancelled source starts no imports or checked owners", async () => {
    const h = harness(); const controller = new AbortController(); controller.abort(new Error("source closed"));
    await expect(h.prepare(controller.signal)).rejects.toThrow("source closed");
    expect(h.events).toEqual([]); expect(h.inputs).toEqual([]);
  });

  test("cancellation while imports are pending starts neither the catalogue nor the harness", async () => {
    const h = harness({ holdImports: true }); const controller = new AbortController();
    const pending = h.prepare(controller.signal); const rejection = expectRefusal(pending, "source changed");
    controller.abort(new Error("source changed")); h.importJob.resolve(); await rejection;
    expect(h.inputs).toEqual([]); expect(h.events).not.toContain("harness:start"); expect(h.events).not.toContain("session");
  });

  test("cancellation reaches the active worker and cannot publish late complete results", async () => {
    const h = harness(); const controller = new AbortController();
    const pending = h.prepare(controller.signal); const rejection = expectRefusal(pending, "source closed");
    await h.started; controller.abort(new Error("source closed"));
    expect(h.inputs[0]!.options.signal.aborted).toBe(true);
    h.catalogueJob.resolve(h.catalog); await rejection;
    h.harnessJob.resolve(); await settle();
    expect(h.events).not.toContain("session"); expect(h.tokens).toEqual([]);
    expect(h.discardedCatalogues).toEqual([h.catalog]);
  });

  test("cancellation after the catalogue succeeds, while the harness prepares, retires that catalogue", async () => {
    const h = harness(); const controller = new AbortController();
    const pending = h.prepare(controller.signal); const rejection = expectRefusal(pending, "source replaced");
    await h.started; h.catalogueJob.resolve(h.catalog); await settle();
    controller.abort(new Error("source replaced")); await rejection;
    expect(h.events).not.toContain("session");
    expect(h.discardedCatalogues).toEqual([h.catalog]);
  });

  test("a session refusal retires the exact worker catalogue", async () => {
    const h = harness({ sessionFailure: true }); const pending = h.prepare();
    const rejection = expectRefusal(pending, "session refused");
    await h.started; h.harnessJob.resolve(); h.catalogueJob.resolve(h.catalog); await rejection;
    expect(h.events).toContain("session");
    expect(h.inputs[0]!.options.signal.aborted).toBe(true);
    expect(h.discardedCatalogues).toEqual([h.catalog]);
  });

  test("an unavailable checked display never returns a reader snapshot", async () => {
    const h = harness({ displayMissing: true }); const pending = h.prepare();
    const rejection = expectRefusal(pending, "checked catalogue is unavailable");
    await h.started; h.harnessJob.resolve(); h.catalogueJob.resolve(h.catalog); await rejection;
    expect(h.discardedCatalogues).toEqual([h.catalog]);
  });

  test("worker metadata failure retires the attached worker catalogue", async () => {
    const h = harness({ presentationFailure: true }); const pending = h.prepare();
    const rejection = expectRefusal(pending, "presentation refused");
    await h.started; h.harnessJob.resolve(); h.catalogueJob.resolve(h.catalog); await rejection;
    expect(h.discardedCatalogues).toEqual([h.catalog]);
  });
});

for (const synchronous of [false, true]) {
  test(`the page harness wrapper preserves ${synchronous ? "synchronous" : "async"} failure for Retry`, async () => {
    const workerSource = await Bun.file(new URL("./expression-runner/authoring-catalog-worker.ts", import.meta.url)).text();
    const start = /export (?:async )?function prepareLocalPageHarness\(/.exec(workerSource)?.index ?? -1;
    const end = workerSource.indexOf("/** One Local snapshot's registry identity", start);
    if (start < 0 || end <= start) throw new Error("Page harness boundary changed");
    const code = new Bun.Transpiler({ loader: "ts" }).transformSync(workerSource.slice(start, end)).replace(/^export /gm, "");
    let calls = 0;
    const prepare = new Function("prepareEngineBodyDispatch", `${code}; return prepareLocalPageHarness;`)(() => {
      if (++calls > 1) return Promise.resolve();
      if (synchronous) throw new Error("harness failed");
      return Promise.reject(new Error("harness failed"));
    }) as () => Promise<void>;
    await expect(prepare()).rejects.toThrow("harness failed");
    await expect(prepare()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
}
