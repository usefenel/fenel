import { authoringWorkerHostFixtureBindings } from "./authoring-worker-host.fixture";
import { describe, expect, test } from "bun:test";

// Execute the production client lifetime with a scripted Worker. This checks
// that a retired Local worker can never deliver a late answer to its reader.
const source = (await Bun.file(new URL("./authoring-catalog-worker.ts", import.meta.url)).text()).replace(/\r\n?/g, "\n");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source
  .replace(/^import[\s\S]*?;\n/gm, "")
  .replace(/^export \{[^}]*\} from [^;]+;\n/gm, "")
  .replace(/import\.meta\.url/g, "workerBase"))
  .replace(/^export /gm, "");

type Message = { id: number; method: string; [key: string]: unknown };
class ScriptedWorker {
  static all: ScriptedWorker[] = [];
  readonly posted: Message[] = [];
  terminated = false;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message?: string }) => void;
  onmessageerror?: () => void;
  constructor() { ScriptedWorker.all.push(this); }
  postMessage(message: Message) { this.posted.push(message); }
  terminate() { this.terminated = true; }
  reply(id: number, result: unknown) { this.onmessage?.({ data: { id, ok: true, result } }); }
}

function load() {
  ScriptedWorker.all = [];
  let revision = 0;
  const bindings = {
    workerBase: "file:///authoring-catalog-worker.ts",
    Worker: ScriptedWorker,
    spawnAuthoringWorker: () => new ScriptedWorker(),
    createSignal: <T>(initial: T) => {
      let value = initial;
      return [() => value, (next: (current: T) => T) => { value = next(value); revision++; }] as const;
    },
    registerCatalogEntities: () => {}, registerIdentifiedCatalogEntity: () => {},
    prepareEngineBodyDispatch: async () => {},
    concreteAuthoringSession: <T>(session: T) => session,
    localAuthoringScopeForSession: () => undefined,
    onBrowserSessionChange: () => () => {},
    sessionEpoch: () => 0,
    assertCurrentSession: () => {},
    installPreparedWorkspaceCatalog: () => {},
    accountFieldRegistryState: () => undefined,
    retainCheckedRepositoryNamespaces: () => {}, clearCheckedRepositoryNamespaces: () => {},
    assertReaderSourceMetadata: () => {}, captureReaderSourceMetadata: () => undefined,
    authoringExpressionSourceEntries: () => [], reachedSavedSources: () => [],
  };
  Object.assign(bindings, authoringWorkerHostFixtureBindings(bindings));
  const api = new Function(...Object.keys(bindings), `${code}; return { prepareLocalCatalogInWorker, attachPreparedAuthoringWorker,
    discardPreparedAuthoringWorker, discardPreparedAuthoringCatalog, prepareCatalogInWorker, spawnEarlyAuthoringRealm, acquireEarlyAuthoringPreparation,
    rankAuthoringSuggestions, authoringWorkerSnapshot };`)(...Object.values(bindings)) as {
    prepareLocalCatalogInWorker(sourceId: string, snapshot: object, entities: object[], functions: object[], options?: object): Promise<object>;
    prepareCatalogInWorker(accountId: undefined, snapshot: object, entities: object[], functions: object[], options: object): Promise<object>;
    spawnEarlyAuthoringRealm(lineage: object, epoch: number): unknown;
    acquireEarlyAuthoringPreparation(): { release(): void } | undefined;
    discardPreparedAuthoringCatalog(catalog: object): void;
    attachPreparedAuthoringWorker(registry: object, catalog: object, session: object): void;
    discardPreparedAuthoringWorker(registry: object): void;
    rankAuthoringSuggestions(entries: object[], expected: undefined, options: object, session: object): Promise<unknown> | undefined;
    authoringWorkerSnapshot(session: object): object | undefined;
  };
  return { api, revision: () => revision };
}

async function preparedReader(api: ReturnType<typeof load>["api"], index: number) {
  const registry = { id: `registry-${index}` };
  const catalog = { id: `catalog-${index}` };
  const session = { registry, mode: "detached" };
  const preparing = api.prepareLocalCatalogInWorker("this-tab", { owners: [], fields: [], facets: [] }, [], []);
  const worker = ScriptedWorker.all[index]!;
  worker.reply(worker.posted[0]!.id, { catalog, displayCatalog: [] });
  api.attachPreparedAuthoringWorker(registry, await preparing, session);
  return { registry, session, worker };
}

describe("a retired Local catalogue worker", () => {
  test("saved identity transport is captured before the existing early preparation lease drains", async () => {
    const { api } = load();
    const lineage = {}, ids = ["saved-number"], catalog = {};
    api.spawnEarlyAuthoringRealm(lineage, 0);
    const lease = api.acquireEarlyAuthoringPreparation()!;
    const pending = api.prepareLocalCatalogInWorker("this-tab", { owners: [], fields: [], facets: [] }, [], [], { lineage, localValueIds: ids });
    const worker = ScriptedWorker.all[0]!;
    expect(worker.posted).toEqual([]);
    ids[0] = "later-number"; ids.push("unrelated-number");
    lease.release();
    for (let tick = 0; tick < 8; tick++) await Promise.resolve();
    const initialization = worker.posted[0]!;
    expect(initialization.method).toBe("initialize");
    expect(initialization.localValueIds).toEqual(["saved-number"]);
    worker.reply(initialization.id, { catalog, displayCatalog: [] });
    expect(await pending).toBe(catalog);
    api.discardPreparedAuthoringCatalog(catalog);
  });

  test("saved identity transport is captured before namespace preflight yields", async () => {
    const { api } = load();
    const ids = ["saved-number"], catalog = {};
    const pending = api.prepareCatalogInWorker(undefined, { owners: [], fields: [], facets: [] }, [], [], {
      independent: true, localSourceId: "this-tab", localValueIds: ids,
      sourceModules: [{ id: "source", source: "module Example where" }], onRepositoryNamespaces: () => {},
    });
    const worker = ScriptedWorker.all[0]!;
    expect(worker.posted[0]!.method).toBe("repository-namespaces");
    ids[0] = "later-number";
    worker.reply(worker.posted[0]!.id, { repositoryNamespaces: [], repositoryEntities: [], identifiedRepositoryEntities: [] });
    for (let tick = 0; tick < 12; tick++) await Promise.resolve();
    const initialization = worker.posted.find(request => request.method === "initialize")!;
    expect(initialization.localValueIds).toEqual(["saved-number"]);
    worker.reply(initialization.id, { catalog, displayCatalog: [] });
    expect(await pending).toBe(catalog);
    api.discardPreparedAuthoringCatalog(catalog);
  });

  test("rejects its pending answer, drops a late reply and refuses later requests", async () => {
    const { api, revision } = load();
    const old = await preparedReader(api, 0);
    const token = api.authoringWorkerSnapshot(old.session);
    expect(token).toBeDefined();
    const pending = api.rankAuthoringSuggestions([], undefined, {}, old.session)!;
    const request = old.worker.posted.at(-1)!;
    expect(request.method).toBe("rank-suggestions");
    const before = revision();
    api.discardPreparedAuthoringWorker(old.registry);
    expect(old.worker.terminated).toBe(true);
    expect(revision()).toBeGreaterThan(before);
    await expect(pending).rejects.toThrow("replaced");
    // A message already in flight from the terminated realm is ignored.
    expect(() => old.worker.reply(request.id, [{ stale: true }])).not.toThrow();
    expect(() => api.authoringWorkerSnapshot(old.session)).toThrow("replaced");
    await expect(api.rankAuthoringSuggestions([], undefined, {}, old.session)!).rejects.toThrow("replaced");

    // The replacement worker answers only its own requests.
    const next = await preparedReader(api, 1);
    const fresh = api.rankAuthoringSuggestions([], undefined, {}, next.session)!;
    const freshRequest = next.worker.posted.at(-1)!;
    old.worker.reply(freshRequest.id, [{ stale: true }]);
    next.worker.reply(freshRequest.id, [{ current: true }]);
    expect(await fresh).toEqual([{ current: true }]);
    expect(api.authoringWorkerSnapshot(next.session)).not.toBe(token);
  });
});
