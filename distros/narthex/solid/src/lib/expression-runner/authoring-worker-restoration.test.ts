import { authoringWorkerHostFixtureBindings } from "./authoring-worker-host.fixture";
// Run with --conditions=browser --conditions=development for staged writes.
import { describe, expect, test } from "bun:test";
import { createMemo, createRoot, createSignal, flush } from "solid-js";
import * as accountSessions from "./account-authoring-session";
import { markLocalRegistryToken } from "../local-registry-token";

// The production worker client and authoring-session boundary, wired together
// over a scripted Worker. A Local rebuild retires the published worker; its
// restoration attaches a new worker to the SAME registry token and snapshot
// owner (B4 wave 5: a Local snapshot's registry is a token, its session is
// frameless, and a function's scope is resolved in its worker).
const strip = (text: string) => text.replace(/\r\n?/g, "\n")
  .replace(/^import[\s\S]*?;\n/gm, "")
  .replace(/^export \{[\s\S]*?\} from [^;]+;\n/gm, "");
const transpile = (text: string) => new Bun.Transpiler({ loader: "ts" }).transformSync(text).replace(/^export /gm, "");
const workerCode = transpile(strip(await Bun.file(new URL("./authoring-catalog-worker.ts", import.meta.url)).text())
  .replace(/import\.meta\.url/g, "workerBase"));
const sessionCode = transpile(strip(await Bun.file(new URL("./authoring-session.ts", import.meta.url)).text()));

type Message = { id: number; method: string; sourceModule?: string; [key: string]: unknown };
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

type Worker = {
  prepareLocalCatalogInWorker(sourceId: string, snapshot: object, entities: object[], functions: object[]): Promise<object>;
  createPreparedSnapshotOwner(): object;
  prepareReaderWorkerHandle(catalog: object): object;
  discardPreparedReaderWorker(handle: object): void;
  rankAuthoringSuggestions(entries: object[], expected: undefined, options: object, session: object): Promise<unknown> | undefined;
  authoringWorkerSnapshot(session: object): object | undefined;
  authoringWorkerRetired(session: object): boolean;
  createLocalRegistryToken(): object;
};
type Sessions = {
  createLocalReaderAuthoringSession(registry: object, owner: object, sourceId: string, functions: object[], catalog: object): object;
  prepareLocalReaderAuthoringSessionForFunction(functionId: string, base: object, sourceId: string, functions: object[]): Promise<object>;
  prepareModuleAuthoringSession(sourceModule: string, registry: object): Promise<object>;
};

function load() {
  ScriptedWorker.all = [];
  const workerBindings = {
    workerBase: "file:///authoring-catalog-worker.ts", Worker: ScriptedWorker, markLocalRegistryToken, createSignal,
    registerCatalogEntities: () => {}, registerIdentifiedCatalogEntity: () => {}, prepareEngineBodyDispatch: async () => {},
    concreteAuthoringSession: accountSessions.concreteAuthoringSession, localAuthoringScopeForSession: accountSessions.localAuthoringScopeForSession,
    onBrowserSessionChange: () => () => {}, sessionEpoch: () => 0, assertCurrentSession: () => {},
    installPreparedWorkspaceCatalog: () => {}, accountFieldRegistryState: () => undefined,
    retainCheckedRepositoryNamespaces: () => {}, clearCheckedRepositoryNamespaces: () => {},
    assertReaderSourceMetadata: () => {}, captureReaderSourceMetadata: () => undefined, authoringExpressionSourceEntries: () => [], reachedSavedSources: () => [],
  };
  Object.assign(workerBindings, authoringWorkerHostFixtureBindings(workerBindings));
  const worker = new Function(...Object.keys(workerBindings), `${workerCode}; return { prepareLocalCatalogInWorker,
    attachPreparedAuthoringWorker, discardPreparedAuthoringWorker, rankAuthoringSuggestions, authoringWorkerSnapshot,
    authoringWorkerRetired, prepareModuleCatalogInWorker, bindModuleAuthoringWorkerSession,
    createPreparedSnapshotOwner, inheritPreparedSnapshotOwner, preparedSnapshotOwnerOf, registryHasSnapshotOwner,
    prepareReaderWorkerHandle, discardPreparedReaderWorker, runAuthoringWorker, createLocalRegistryToken };`)(...Object.values(workerBindings));
  const sessionBindings = {
    createContext: () => ({}), useContext: () => undefined, accountFieldRegistryState: () => undefined,
    createDetachedAuthoringEnvironment: <T>(environment: T) => environment,
    ...accountSessions,
    environmentFor: (catalog: object) => ({ catalog: { functions: [], ...catalog }, functionById: new Map(), getFunctionEntry: () => undefined,
      resolveFunctionId: (name: string) => name, hasFunctionRefLiteral: () => false, functionForRefLiteral: () => undefined,
      functionCodeName: () => undefined, resolveTypeRef: () => undefined }),
    browserEvaluateContext: () => { throw new Error("A page frame was built."); }, yieldToInput: async () => {},
    authoringWorkerSnapshot: worker.authoringWorkerSnapshot, runAuthoringWorker: worker.runAuthoringWorker,
    attachPreparedAuthoringWorker: worker.attachPreparedAuthoringWorker,
    prepareModuleCatalogInWorker: worker.prepareModuleCatalogInWorker,
    bindModuleAuthoringWorkerSession: worker.bindModuleAuthoringWorkerSession,
    inheritPreparedSnapshotOwner: worker.inheritPreparedSnapshotOwner,
    preparedSnapshotOwnerOf: worker.preparedSnapshotOwnerOf,
    registryHasSnapshotOwner: worker.registryHasSnapshotOwner,
    authoringSessionScopeForFunction: () => { throw new Error("The function scope was read on the page."); },
  };
  const sessions = new Function(...Object.keys(sessionBindings), `${sessionCode}; return { createLocalReaderAuthoringSession,
    prepareLocalReaderAuthoringSessionForFunction, prepareModuleAuthoringSession };`)(...Object.values(sessionBindings));
  return { worker: worker as Worker, sessions: sessions as Sessions };
}

async function settle() { for (let tick = 0; tick < 12; tick++) await Promise.resolve(); flush(); }

async function prepareWorker(api: Worker, sessions: Sessions, registry: object, owner: object, index: number) {
  const preparing = api.prepareLocalCatalogInWorker("this-tab", { owners: [], fields: [], facets: [] }, [], []);
  const scripted = ScriptedWorker.all[index]!;
  scripted.reply(scripted.posted[0]!.id, { catalog: { id: `catalog-${index}`, functions: [] }, displayCatalog: [] });
  const catalog = await preparing;
  const session = sessions.createLocalReaderAuthoringSession(registry, owner, "this-tab", [], catalog);
  // The Local snapshot keeps this handle as the worker it owns.
  return { session, scripted, handle: api.prepareReaderWorkerHandle(catalog) };
}

async function prepareModule(sessions: Sessions, base: object, scripted: ScriptedWorker) {
  const preparing = sessions.prepareLocalReaderAuthoringSessionForFunction("std:id", base, "this-tab", []);
  await settle();
  // The function's scope is resolved in this snapshot's worker.
  const lookup = scripted.posted.at(-1)!;
  expect(lookup).toMatchObject({ method: "resolve-reader-function-scope", functionId: "std:id" });
  scripted.reply(lookup.id, { functionScope: { id: "std:id", sourceModule: "std" } });
  await settle();
  const request = scripted.posted.at(-1)!;
  expect(request).toMatchObject({ method: "module-catalog", sourceModule: "std" });
  scripted.reply(request.id, { catalog: { id: `module-${scripted.posted.length}` } });
  return preparing;
}

describe("a Local worker restored on the same registry", () => {
  test("reactive readers see retirement, then the restored worker; stale module sessions refuse and are prepared again", async () => {
    const { worker, sessions } = load();
    const registry = worker.createLocalRegistryToken();
    const owner = worker.createPreparedSnapshotOwner();
    const first = await prepareWorker(worker, sessions, registry, owner, 0);
    const module = await prepareModule(sessions, first.session, first.scripted);
    const ranked = worker.rankAuthoringSuggestions([], undefined, {}, module)!;
    const rankRequest = first.scripted.posted.at(-1)!;
    expect(rankRequest).toMatchObject({ method: "rank-suggestions", sourceModule: "std" });
    first.scripted.reply(rankRequest.id, [{ module: true }]);
    expect(await ranked).toEqual([{ module: true }]);

    const [current, setCurrent] = createSignal(first.session);
    const observed = createRoot(dispose => ({ dispose,
      retired: createMemo(() => worker.authoringWorkerRetired(current())),
      token: createMemo(() => worker.authoringWorkerRetired(current()) ? undefined : worker.authoringWorkerSnapshot(current())) }));
    await settle();
    expect(observed.retired()).toBe(false);
    const firstToken = observed.token();
    expect(firstToken).toBeDefined();

    // Rebuild start: the published snapshot's own worker is retired and readers react.
    worker.discardPreparedReaderWorker(first.handle);
    await settle();
    expect(first.scripted.terminated).toBe(true);
    expect(observed.retired()).toBe(true);
    expect(observed.token()).toBeUndefined();

    // Restoration attaches a new worker and session to the same registry and owner.
    const restored = await prepareWorker(worker, sessions, registry, owner, 1);
    setCurrent(restored.session);
    await settle();
    expect(observed.retired()).toBe(false);
    expect(observed.token()).toBeDefined();
    expect(observed.token()).not.toBe(firstToken);
    // The retired session itself stays refused; it never borrows the new worker.
    expect(worker.authoringWorkerRetired(first.session)).toBe(true);

    // A module session bound to the retired worker refuses instead of
    // silently falling back to main-thread ranking.
    const stale = worker.rankAuthoringSuggestions([], undefined, {}, module);
    expect(stale).toBeDefined();
    await expect(stale!).rejects.toThrow("replaced");

    // Reopening prepares the module session again on the restored worker.
    const reopened = await prepareModule(sessions, restored.session, restored.scripted);
    expect(reopened).not.toBe(module);
    const fresh = worker.rankAuthoringSuggestions([], undefined, {}, reopened)!;
    const freshRequest = restored.scripted.posted.at(-1)!;
    expect(freshRequest).toMatchObject({ method: "rank-suggestions", sourceModule: "std" });
    first.scripted.reply(freshRequest.id, [{ stale: true }]);
    restored.scripted.reply(freshRequest.id, [{ current: true }]);
    expect(await fresh).toEqual([{ current: true }]);
    observed.dispose();
  });

  test("a session on an owned Local registry without the snapshot owner refuses loudly", async () => {
    const { worker, sessions } = load();
    const registry = worker.createLocalRegistryToken();
    await prepareWorker(worker, sessions, registry, worker.createPreparedSnapshotOwner(), 0);
    // Built beside the reader instead of derived from its session.
    const orphan = Object.freeze({ mode: "detached", registry, catalog: {}, environment: {}, evaluateContext: {} });
    const ranked = worker.rankAuthoringSuggestions([], undefined, {}, orphan);
    expect(ranked).toBeDefined();
    await expect(ranked!).rejects.toThrow("snapshot owner");
    expect(() => worker.authoringWorkerSnapshot(orphan)).toThrow("snapshot owner");
    await expect(sessions.prepareModuleAuthoringSession("std", registry)).rejects.toThrow("snapshot owner");
  });
});
