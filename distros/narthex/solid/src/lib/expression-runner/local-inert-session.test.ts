import { authoringWorkerHostFixtureBindings } from "./authoring-worker-host.fixture";
import { describe, expect, test } from "bun:test";
import { flush } from "solid-js";
import * as accountSessions from "./account-authoring-session";
import { isLocalRegistryToken, markLocalRegistryToken } from "../local-registry-token";

// B4 wave 4 lane S: a Local reader's page session is inert (no frame) over a
// registry token (no registry). The production worker client and authoring
// session boundary, wired over a scripted Worker, route every Local flow by
// the snapshot owner: field queries, drafts, module functions, restoration
// and rebuild. Any read of the token's members or the session's frame throws.
const strip = (text: string) => text.replace(/\r\n?/g, "\n")
  .replace(/^import[\s\S]*?;\n/gm, "")
  .replace(/^export \{[\s\S]*?\} from [^;]+;\n/gm, "");
const transpile = (text: string) => new Bun.Transpiler({ loader: "ts" }).transformSync(text).replace(/^export /gm, "");
const workerCode = transpile(strip(await Bun.file(new URL("./authoring-catalog-worker.ts", import.meta.url)).text())
  .replace(/import\.meta\.url/g, "workerBase"));
const sessionCode = transpile(strip(await Bun.file(new URL("./authoring-session.ts", import.meta.url)).text()));

type Message = { id: number; method: string; sourceModule?: string; contextId?: number; scope?: Record<string, unknown>; [key: string]: unknown };
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

type Session = accountSessions.AuthoringSession;
// The extracted modules are untyped `new Function` results.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = Record<string, (...args: any[]) => any>;

// A plain authoring environment over a worker catalogue (the shape the
// roster overlay reads), with no `moduleMembers` and no registry.
function environmentFor(catalog: { functions?: unknown[] }) {
  return { catalog: { functions: [], ...catalog }, functionById: new Map(), getFunctionEntry: () => undefined,
    resolveFunctionId: (name: string) => name, hasFunctionRefLiteral: () => false, functionForRefLiteral: () => undefined,
    functionCodeName: () => undefined, constructorCodeName: () => undefined, resolveTypeRef: () => undefined };
}

function load() {
  ScriptedWorker.all = [];
  const workerBindings: Record<string, unknown> = {
    workerBase: "file:///authoring-catalog-worker.ts", Worker: ScriptedWorker, markLocalRegistryToken, createSignal: (value: unknown) => {
      let current = value; return [() => current, (next: unknown) => { current = typeof next === "function" ? (next as (v: unknown) => unknown)(current) : next; }];
    },
    registerCatalogEntities: () => {}, registerIdentifiedCatalogEntity: () => {}, prepareEngineBodyDispatch: async () => {},
    concreteAuthoringSession: accountSessions.concreteAuthoringSession,
    localAuthoringScopeForSession: accountSessions.localAuthoringScopeForSession,
    onBrowserSessionChange: () => () => {}, sessionEpoch: () => 0, assertCurrentSession: () => {},
    installPreparedWorkspaceCatalog: () => {}, accountFieldRegistryState: () => undefined,
    retainCheckedRepositoryNamespaces: () => {}, clearCheckedRepositoryNamespaces: () => {},
    registryTransportSnapshot: (value: unknown) => JSON.parse(JSON.stringify(value)),
    assertReaderSourceMetadata: () => {}, captureReaderSourceMetadata: () => undefined, authoringExpressionSourceEntries: () => [], reachedSavedSources: () => [],
  };
  Object.assign(workerBindings, authoringWorkerHostFixtureBindings(workerBindings));
  const worker = new Function(...Object.keys(workerBindings), `${workerCode}; return { prepareLocalCatalogInWorker,
    attachPreparedAuthoringWorker, rankAuthoringSuggestions, authoringWorkerSnapshot, authoringWorkerRetired,
    prepareModuleCatalogInWorker, bindModuleAuthoringWorkerSession, runAuthoringWorker,
    createPreparedSnapshotOwner, inheritPreparedSnapshotOwner, preparedSnapshotOwnerOf, registryHasSnapshotOwner,
    prepareReaderWorkerHandle, discardPreparedReaderWorker, preparedReaderWorkerForSession, runPreparedReaderWorker,
    createLocalRegistryToken, LocalPageRegistryRead };`)(...Object.values(workerBindings)) as Api;
  const sessionBindings = {
    createContext: () => ({}), useContext: () => undefined, accountFieldRegistryState: () => undefined,
    createDetachedAuthoringEnvironment: <T>(environment: T) => environment,
    ...accountSessions,
    environmentFor, browserEvaluateContext: () => { throw new Error("A page frame was built."); },
    mintAnonymousAuthority: () => { throw new Error("A page authority was minted."); }, yieldToInput: async () => {},
    attachPreparedAuthoringWorker: worker.attachPreparedAuthoringWorker,
    authoringWorkerSnapshot: worker.authoringWorkerSnapshot,
    runAuthoringWorker: worker.runAuthoringWorker,
    prepareModuleCatalogInWorker: worker.prepareModuleCatalogInWorker,
    bindModuleAuthoringWorkerSession: worker.bindModuleAuthoringWorkerSession,
    inheritPreparedSnapshotOwner: worker.inheritPreparedSnapshotOwner,
    preparedSnapshotOwnerOf: worker.preparedSnapshotOwnerOf,
    registryHasSnapshotOwner: worker.registryHasSnapshotOwner,
    authoringSessionScopeForFunction: () => { throw new Error("The function scope was read on the page."); },
  };
  const sessions = new Function(...Object.keys(sessionBindings), `${sessionCode}; return { createLocalReaderAuthoringSession,
    localReaderDraftAuthoringSession, prepareLocalReaderAuthoringSessionForFunction, prepareModuleAuthoringSession };`)(
    ...Object.values(sessionBindings)) as Api;
  return { worker, sessions };
}

async function settle() { for (let tick = 0; tick < 12; tick++) await Promise.resolve(); flush(); }

const tabFunction = { id: "tab-fn", params: [], returns: { $ref: "String" } };

async function prepareSnapshot(api: ReturnType<typeof load>, token: object, owner: object, index: number) {
  const { worker, sessions } = api;
  const preparing = worker.prepareLocalCatalogInWorker("this-tab", { owners: [], fields: [], facets: [] }, [], [tabFunction]) as Promise<object>;
  const scripted = ScriptedWorker.all[index]!;
  scripted.reply(scripted.posted[0]!.id, { catalog: { id: `catalog-${index}`, functions: [] }, displayCatalog: [] });
  const catalog = await preparing;
  const session = sessions.createLocalReaderAuthoringSession(token, owner, "this-tab", [tabFunction], catalog) as Session;
  return { session, scripted, catalog, handle: worker.prepareReaderWorkerHandle(catalog) };
}

function expectFrameRefused(session: Session) {
  expect(() => session.evaluateContext).toThrow("LocalPageFrameRead");
  expect(accountSessions.isInertAuthoringSession(session)).toBe(true);
}

describe("a Local reader's inert page session over a registry token", () => {
  test("both page-read refusals also report to the console, even when a site catches them", () => {
    const { worker } = load();
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logged.push(args[0]); };
    try {
      const token = worker.createLocalRegistryToken() as Record<string, unknown>;
      try { void token.getFunction; } catch { /* a site turning the refusal into text */ }
      const session = accountSessions.inertAuthoringSession({ mode: "detached", registry: token as never, catalog: {} as never, environment: {} as never });
      try { void session.evaluateContext; } catch { /* likewise */ }
    } finally { console.error = original; }
    expect(logged.map(entry => (entry as Error).name)).toEqual(["LocalPageRegistryRead", "LocalPageFrameRead"]);
  });

  test("the token refuses every member read, answers then/symbols with undefined and is an owned identity", async () => {
    const { worker } = load();
    const token = worker.createLocalRegistryToken() as Record<string, unknown>;
    expect(() => (token as { getFunction: unknown }).getFunction).toThrow("LocalPageRegistryRead");
    expect(() => token.evaluateContext).toThrow("LocalPageRegistryRead");
    expect(() => "modules" in token).toThrow("LocalPageRegistryRead");
    expect(() => { token.x = 1; }).toThrow("LocalPageRegistryRead");
    expect(token.then).toBeUndefined();
    expect(token[Symbol.iterator as unknown as string]).toBeUndefined();
    // Promise resolution probes `then`: the token resolves to itself.
    expect(await Promise.resolve(token)).toBe(token);
    expect(Object.keys(token)).toEqual([]);
    expect(worker.registryHasSnapshotOwner(token)).toBe(true);
    // Renderers recognise a token without the worker client (and refuse a page plan over it).
    expect(isLocalRegistryToken(token)).toBe(true);
    expect(isLocalRegistryToken({})).toBe(false);
  });

  test("routing, field queries and drafts run in the snapshot's worker without a page frame or registry", async () => {
    const api = load(); const { worker, sessions } = api;
    const token = worker.createLocalRegistryToken(), owner = worker.createPreparedSnapshotOwner();
    const { session, scripted, handle } = await prepareSnapshot(api, token, owner, 0);
    expectFrameRefused(session);
    expect(session.registry).toBe(token as never);
    // A spread of the session reads its frame: it refuses rather than copying a frame.
    expect(() => ({ ...session })).toThrow("LocalPageFrameRead");
    expect(worker.authoringWorkerSnapshot(session)).toBeDefined();
    expect(worker.preparedSnapshotOwnerOf(session)).toBe(owner);
    // Routing: the base context of this snapshot's worker.
    const ranked = worker.rankAuthoringSuggestions([], undefined, {}, session) as Promise<unknown>;
    const rank = scripted.posted.at(-1)!;
    expect(rank).toMatchObject({ method: "rank-suggestions", contextId: 0 });
    scripted.reply(rank.id, [{ ranked: true }]);
    expect(await ranked).toEqual([{ ranked: true }]);
    // Field queries: the session's prepared handle is the snapshot's own.
    expect(worker.preparedReaderWorkerForSession(session)).toBe(handle);
    const fields = worker.runPreparedReaderWorker(handle, { method: "query-reader-field-catalog", query: { search: "" } }) as Promise<unknown>;
    const query = scripted.posted.at(-1)!;
    expect(query).toMatchObject({ method: "query-reader-field-catalog", contextId: 0 });
    scripted.reply(query.id, { fields: [], facetInterfaceNames: [] });
    expect(await fields).toEqual({ fields: [], facetInterfaceNames: [] });
    // Drafts: derived inert, same owner, roster mirrored without a frame read.
    const draft = { id: "draft-fn", params: [], returns: { $ref: "Number" } };
    const drafted = sessions.localReaderDraftAuthoringSession(session, "this-tab", [tabFunction], draft) as Session;
    expectFrameRefused(drafted);
    expect(drafted.registry).toBe(token as never);
    expect(worker.preparedSnapshotOwnerOf(drafted)).toBe(owner);
    expect(accountSessions.localAuthoringScopeForSession(drafted)).toEqual({ sourceId: "this-tab", functions: [tabFunction], draft });
    const draftRanked = worker.rankAuthoringSuggestions([], undefined, {}, drafted) as Promise<unknown>;
    const draftRank = scripted.posted.at(-1)!;
    expect(draftRank.contextId).toBeGreaterThan(0);
    expect(draftRank.scope).toEqual({ sourceId: "this-tab", functions: [tabFunction], draft });
    scripted.reply(draftRank.id, []);
    await draftRanked;
  });

  test("a facade-derived draft stays inert and uses its current snapshot owner", async () => {
    const api = load(); const { worker, sessions } = api;
    const token = worker.createLocalRegistryToken(), owner = worker.createPreparedSnapshotOwner();
    const first = await prepareSnapshot(api, token, owner, 0);
    let current = first.session;
    const facade = accountSessions.reactiveAuthoringSession(() => current);
    const draft = { id: "facade-draft", params: [], returns: { $ref: "Number" } };
    const derive = () => sessions.localReaderDraftAuthoringSession(facade, "this-tab", [tabFunction], draft) as Session;
    const drafted = derive();
    expectFrameRefused(drafted);
    expect(worker.preparedSnapshotOwnerOf(drafted)).toBe(owner);
    expect(accountSessions.localAuthoringScopeForSession(drafted)).toEqual({ sourceId: "this-tab", functions: [tabFunction], draft });
    const ranked = worker.rankAuthoringSuggestions([], undefined, {}, drafted) as Promise<unknown>;
    const request = first.scripted.posted.at(-1)!;
    expect(request.scope).toEqual({ sourceId: "this-tab", functions: [tabFunction], draft });
    first.scripted.reply(request.id, []); await ranked;

    const nextToken = worker.createLocalRegistryToken(), nextOwner = worker.createPreparedSnapshotOwner();
    const next = await prepareSnapshot(api, nextToken, nextOwner, 1);
    current = next.session;
    const nextDraft = derive();
    expectFrameRefused(nextDraft);
    expect(nextDraft.registry).toBe(nextToken as never);
    expect(worker.preparedSnapshotOwnerOf(nextDraft)).toBe(nextOwner);
    expect(worker.preparedSnapshotOwnerOf(drafted)).toBe(owner);
    const nextRanked = worker.rankAuthoringSuggestions([], undefined, {}, nextDraft) as Promise<unknown>;
    const nextRequest = next.scripted.posted.at(-1)!;
    next.scripted.reply(nextRequest.id, [{ current: true }]);
    expect(await nextRanked).toEqual([{ current: true }]);
  });

  test("module functions resolve their scope in the worker and open an inert module frame there", async () => {
    const api = load(); const { worker, sessions } = api;
    const token = worker.createLocalRegistryToken(), owner = worker.createPreparedSnapshotOwner();
    const { session, scripted } = await prepareSnapshot(api, token, owner, 0);
    // The tab's own function needs no lookup.
    expect(await sessions.prepareLocalReaderAuthoringSessionForFunction("tab-fn", session, "this-tab", [tabFunction])).toBe(session);
    const opening = sessions.prepareLocalReaderAuthoringSessionForFunction("std:id", session, "this-tab", [tabFunction]) as Promise<Session>;
    await settle();
    const lookup = scripted.posted.at(-1)!;
    expect(lookup).toMatchObject({ method: "resolve-reader-function-scope", functionId: "std:id", contextId: 0 });
    scripted.reply(lookup.id, { functionScope: { id: "std:id", sourceModule: "std" } });
    await settle();
    const catalogue = scripted.posted.at(-1)!;
    expect(catalogue).toMatchObject({ method: "module-catalog", sourceModule: "std" });
    scripted.reply(catalogue.id, { catalog: { id: "module-std", functions: [] } });
    const module = await opening;
    expect(module.mode).toBe("module"); expect(module.sourceModule).toBe("std");
    expectFrameRefused(module);
    expect(worker.preparedSnapshotOwnerOf(module)).toBe(owner);
    const ranked = worker.rankAuthoringSuggestions([], undefined, {}, module) as Promise<unknown>;
    const rank = scripted.posted.at(-1)!;
    expect(rank).toMatchObject({ method: "rank-suggestions", sourceModule: "std" });
    scripted.reply(rank.id, [{ module: true }]);
    expect(await ranked).toEqual([{ module: true }]);
    // A detached (non-module) function keeps the reader's session.
    const detached = sessions.prepareLocalReaderAuthoringSessionForFunction("other", session, "this-tab", [tabFunction]) as Promise<Session>;
    await settle();
    scripted.reply(scripted.posted.at(-1)!.id, { functionScope: {} });
    expect(await detached).toBe(session);
    // An unreadable reply refuses.
    const unreadable = sessions.prepareLocalReaderAuthoringSessionForFunction("odd", session, "this-tab", [tabFunction]) as Promise<Session>;
    await settle();
    scripted.reply(scripted.posted.at(-1)!.id, { functionScope: { sourceModule: 7 } });
    await expect(unreadable).rejects.toThrow("could not be read");
  });

  test("a reply from a replaced worker is dropped: the function scope refuses", async () => {
    const api = load(); const { worker, sessions } = api;
    const token = worker.createLocalRegistryToken(), owner = worker.createPreparedSnapshotOwner();
    const { session, scripted, handle } = await prepareSnapshot(api, token, owner, 0);
    const opening = sessions.prepareLocalReaderAuthoringSessionForFunction("std:id", session, "this-tab", [tabFunction]) as Promise<Session>;
    await settle();
    const lookup = scripted.posted.at(-1)!;
    worker.discardPreparedReaderWorker(handle);
    scripted.reply(lookup.id, { functionScope: { id: "std:id", sourceModule: "std" } });
    await expect(opening).rejects.toThrow();
    expect(scripted.posted.some(message => message.method === "module-catalog")).toBe(false);
  });

  test("a module preparation in flight across a restoration never fills the restored owner's cache", async () => {
    const api = load(); const { worker, sessions } = api;
    const token = worker.createLocalRegistryToken(), owner = worker.createPreparedSnapshotOwner();
    const first = await prepareSnapshot(api, token, owner, 0);
    const opening = sessions.prepareLocalReaderAuthoringSessionForFunction("std:id", first.session, "this-tab", [tabFunction]) as Promise<Session>;
    await settle();
    first.scripted.reply(first.scripted.posted.at(-1)!.id, { functionScope: { id: "std:id", sourceModule: "std" } });
    await settle();
    const catalogue = first.scripted.posted.at(-1)!;
    expect(catalogue).toMatchObject({ method: "module-catalog", sourceModule: "std" });
    // The owner is restored onto a new worker while the old reply is pending.
    const restored = await prepareSnapshot(api, token, owner, 1);
    first.scripted.reply(catalogue.id, { catalog: { id: "stale-module", functions: [] } });
    await expect(opening).rejects.toThrow("replaced");
    // The restored owner prepares its module frame afresh, on its own worker.
    const reopening = sessions.prepareLocalReaderAuthoringSessionForFunction("std:id", restored.session, "this-tab", [tabFunction]) as Promise<Session>;
    await settle();
    restored.scripted.reply(restored.scripted.posted.at(-1)!.id, { functionScope: { id: "std:id", sourceModule: "std" } });
    await settle();
    const fresh = restored.scripted.posted.at(-1)!;
    expect(fresh).toMatchObject({ method: "module-catalog", sourceModule: "std" });
    restored.scripted.reply(fresh.id, { catalog: { id: "fresh-module", functions: [] } });
    const module = await reopening;
    expect((module.catalog as unknown as { id: string }).id).toBe("fresh-module");
  });

  test("restoration reuses the token and owner; rebuild takes a new token; retired sessions refuse", async () => {
    const api = load(); const { worker } = api;
    const token = worker.createLocalRegistryToken(), owner = worker.createPreparedSnapshotOwner();
    const first = await prepareSnapshot(api, token, owner, 0);
    worker.discardPreparedReaderWorker(first.handle);
    await settle();
    expect(worker.authoringWorkerRetired(first.session)).toBe(true);
    // Restore: the same token and owner, a fresh worker and session.
    const restored = await prepareSnapshot(api, token, owner, 1);
    expectFrameRefused(restored.session);
    expect(restored.session.registry).toBe(token as never);
    expect(worker.authoringWorkerRetired(restored.session)).toBe(false);
    expect(worker.authoringWorkerRetired(first.session)).toBe(true);
    const ranked = worker.rankAuthoringSuggestions([], undefined, {}, restored.session) as Promise<unknown>;
    expect(ScriptedWorker.all[0]!.posted.at(-1)!.method).not.toBe("rank-suggestions");
    restored.scripted.reply(restored.scripted.posted.at(-1)!.id, [{ restored: true }]);
    expect(await ranked).toEqual([{ restored: true }]);
    // Rebuild: a new snapshot gets its own token and owner and worker.
    const nextToken = worker.createLocalRegistryToken(), nextOwner = worker.createPreparedSnapshotOwner();
    expect(nextToken).not.toBe(token);
    const rebuilt = await prepareSnapshot(api, nextToken, nextOwner, 2);
    expect(worker.preparedSnapshotOwnerOf(rebuilt.session)).toBe(nextOwner);
    expect(worker.authoringWorkerSnapshot(rebuilt.session)).not.toBe(worker.authoringWorkerSnapshot(restored.session));
  });
});
