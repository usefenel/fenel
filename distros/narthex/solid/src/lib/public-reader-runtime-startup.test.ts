import { describe, expect, test } from "bun:test";
import type { FenelFunction, FenelType } from "@fenel/engine/types";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";

// C1: hold the production public reader's checked preparation and imports.
// Readiness must precede editor presentation without admitting unchecked data.
const source = await Bun.file(new URL("./reader-runtime.tsx", import.meta.url)).text();
const start = source.indexOf("export async function createPublicReaderRuntime");
const end = source.indexOf("export function startLocalReaderRuntime", start);
if (start < 0 || end < start) throw new Error("Public reader boundary changed");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end))
  .replace(/^export /gm, "").replace(/\bimport\(/g, "loadModule(");

// Run the actual entity-scoping projection with controlled host lookups. A
// prepared display catalogue must not invoke its expensive getCatalog default.
const catalogSource = await Bun.file(new URL("./expression-runner/authoring-catalog.ts", import.meta.url)).text();
const catalogStart = catalogSource.indexOf("const scopedSections =");
const catalogEnd = catalogSource.indexOf("\n/** Immutable presentation projection", catalogStart);
if (catalogStart < 0 || catalogEnd < catalogStart) throw new Error("Scoped catalogue boundary changed");
const catalogCode = new Bun.Transpiler({ loader: "ts" }).transformSync(catalogSource.slice(catalogStart, catalogEnd))
  .replace(/^export /gm, "");
function scopedCatalogHarness() {
  let builds = 0;
  const bindings = {
    getCatalog: () => { builds++; throw new Error("Unexpected catalogue rebuild"); },
    repositoryEntityPresentation: (id: string) => ({ name: id, description: "Current reader" }),
    readerSourceDeclarations: () => undefined,
  };
  const project = new Function(...Object.keys(bindings), `${catalogCode}; return sessionCatalogSections;`)(...Object.values(bindings));
  return { project, builds: () => builds };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function harness() {
  let epoch = 3, catalogBuilds = 0, clients = 0, disposed = 0, preparationCalls = 0;
  let rejectBootstrap = false;
  let sessionChanged = () => {};
  const sessionReady = deferred<void>();
  const preparationStarted = deferred<void>();
  // Registry methods remain controlled ports installed by each scenario; no
  // repository registry is built. The session itself has its real contract.
  const registry = { owner: "checked repository" } as unknown as ModuleRegistry & { owner: string };
  const environment = createAuthoringEnvironment();
  const evaluateContext: AuthoringSession["evaluateContext"] & { reader: string } = { reader: "public" };
  const session: AuthoringSession = { mode: "detached", registry, environment, evaluateContext, catalog: environment.catalog };
  const publicData = { root: { id: "public-fenel", revision: 0 }, registry, session,
    catalogLookups: { fn: (id: string) => ({ id }), entityType: (id: string) => ({ id }) } };
  const catalog = [{ id: "functions", entries: [] }];
  const preparedCatalogs = new Map<object, unknown>();
  const preparedLookups: object[] = [];
  let projectCatalog = (value: unknown, _sections?: unknown) => {
    expect(value).toBe(registry); catalogBuilds++; return catalog;
  };
  const clientLife = new AbortController();
  const client = { signal: clientLife.signal, dispose: () => { disposed++; clientLife.abort(); } };
  const events: string[] = [];
  const metadataCaptures: Array<{ data: unknown; generation: string; labels: unknown; current: () => boolean }> = [];
  const bindings = {
    sessionEpoch: () => epoch, untrack: (read: () => unknown) => read(),
    assertCurrentSession: (captured: number) => { if (captured !== epoch) throw new Error("Stale reader session"); },
    onBrowserSessionChange: (listener: () => void) => { sessionChanged = listener; return () => { sessionChanged = () => {}; }; },
    createPublicApiClient: () => { clients++; return client; },
    catalogCallableLabels: (catalog: unknown) => { expect(catalog).toBe(session.catalog); return []; },
    loadModule: async (path: string) => {
      events.push(path);
      if (path === "./public-locus-data") return { publicSourceMetadataForSession: (data: unknown, generation: string, labels: unknown, current: () => boolean) => {
        metadataCaptures.push({ data, generation, labels, current });
        return { session, packet: { source: { $tag: "PublicSource" }, rootId: publicData.root.id, generation }, generationToken: {}, current };
      }, preparePublicLocusData: async () => {
        preparationCalls++; preparationStarted.resolve(); await sessionReady.promise; return publicData;
      } };
      if (path === "./expression-runner/authoring-catalog") return {
        sessionCatalogSections: (value: unknown, sections?: unknown) => projectCatalog(value, sections),
      };
      if (path === "./expression-runner/authoring-catalog-worker") return {
        preparedAuthoringDisplayCatalog: (value: object) => { preparedLookups.push(value); return preparedCatalogs.get(value); },
      };
      if (path === "./web-template-registry") return { createReaderTemplateRegistry: () => ({}) };
      if (path === "./reader-presentation") return { createReaderPresentation: (read: () => unknown) => ({
        catalogEntry: () => { read(); return undefined; },
        presentation: () => { read(); return undefined; },
        representation: () => { read(); return undefined; },
      }) };
      if (path === "./public-bootstrap") return { assertPublicBootstrapMatches: async (root: unknown, digest: string) => {
        expect(root).toBe(publicData.root); expect(digest).toBe("exact repository");
        if (rejectBootstrap) throw new Error("Public bootstrap changed");
      } };
      if (path === "@fenel/engine/repository-identity-manifest") return { REPOSITORY_IDENTITY_MANIFEST: { digest: "exact repository" } };
      throw new Error(`Unexpected import: ${path}`);
    },
  };
  const createPublicReaderRuntime = new Function(...Object.keys(bindings), `${code}; return createPublicReaderRuntime;`)(...Object.values(bindings)) as
    typeof import("./reader-runtime").createPublicReaderRuntime;
  return { createPublicReaderRuntime, events, registry, session, publicData, catalog, metadataCaptures,
    preparedCatalogs, preparedLookups, useCatalogProjection: (project: typeof projectCatalog) => { projectCatalog = project; },
    preparationStarted: preparationStarted.promise, complete: () => sessionReady.resolve(),
    nextSession: () => { epoch++; sessionChanged(); }, rejectBootstrap: () => { rejectBootstrap = true; },
    stats: () => ({ catalogBuilds, clients, disposed, preparationCalls }) };
}

describe("checked public read startup", () => {
  test("public source capture is lazy, exact-reader owned and retired with the runtime", async () => {
    const h = harness();
    const pending = h.createPublicReaderRuntime(); h.complete();
    const runtime = await pending;
    expect(h.metadataCaptures).toEqual([]);
    const capture = runtime.captureSourceMetadata!()!;
    expect(runtime.captureSourceMetadata!()).toBe(capture);
    expect(h.metadataCaptures).toHaveLength(1);
    expect(h.metadataCaptures[0]!.data).toBe(h.publicData);
    expect(h.metadataCaptures[0]!.generation).toBe("exact repository:0");
    expect(capture.session).toBe(h.session);
    expect(capture.packet.source).toEqual({ $tag: "PublicSource" });
    expect(capture.current()).toBe(true);
    expect(h.stats().catalogBuilds).toBe(0);
    runtime.dispose();
    expect(capture.current()).toBe(false);
    expect(() => runtime.captureSourceMetadata!()).toThrow("public reader was closed");
  });

  test("a public source packet cannot survive an epoch replacement", async () => {
    const h = harness();
    const pending = h.createPublicReaderRuntime(); h.complete();
    const runtime = await pending;
    const capture = runtime.captureSourceMetadata!()!;
    h.nextSession();
    expect(capture.current()).toBe(false);
    expect(() => runtime.captureSourceMetadata!()).toThrow("Stale reader session");
  });

  test("caption reads reuse the exact prepared catalogue while retaining the reader's entity scoping", async () => {
    const h = harness(), scoped = scopedCatalogHarness();
    const currentType: FenelType = { $unit: true };
    const current = { id: "Shared", module: "public", type: currentType };
    Object.assign(h.registry, {
      listIdentifiedEntities: () => [current],
      getIdentifiedEntity: (id: string) => id === "Shared" ? current : undefined,
    });
    const fn: FenelFunction = { id: "public:kept", params: [], returns: currentType };
    const prepared = [{ id: "entity", entries: [
      { id: "Shared", entity: { id: "Shared", type: { $void: true } } },
      { id: "PrivateOnly", entity: { id: "PrivateOnly", type: { $void: true } } },
    ] }, { id: "function", entries: [{ id: fn.id, fn }] }];
    h.preparedCatalogs.set(h.registry, prepared);
    h.preparedCatalogs.set({ owner: "another reader" }, [{ id: "foreign", entries: [] }]);
    h.useCatalogProjection(scoped.project);
    const pending = h.createPublicReaderRuntime(); h.complete();
    const runtime = await pending;
    expect(h.preparedLookups).toEqual([]);
    runtime.presentation("Shared");
    const rows = runtime.catalog().flatMap(section => section.entries);
    expect(h.preparedLookups).toEqual([h.registry]);
    expect(scoped.builds()).toBe(0);
    expect(rows.map(row => row.id)).toEqual(["Shared", "public:kept"]);
    expect(rows[0]!.entity!.type).toBe(currentType);
    expect(rows[1]!.fn).toBe(fn);
    expect(prepared[0]!.entries).toHaveLength(2);
    runtime.dispose();
  });

  test("a replacement reader uses only its own prepared source and a retired reader cannot acquire it", async () => {
    const first = harness(), next = harness(), scoped = scopedCatalogHarness();
    for (const h of [first, next]) {
      Object.assign(h.registry, { listIdentifiedEntities: () => [] });
      h.useCatalogProjection(scoped.project);
    }
    const previousRows = [{ id: "function", entries: [{ id: "previous", fn: { id: "previous" } }] }];
    const nextRows = [{ id: "function", entries: [{ id: "next", fn: { id: "next" } }] }];
    first.preparedCatalogs.set(first.registry, previousRows);
    // The lookup sees both owners; identity, not the most recently prepared
    // catalogue or a matching display name, selects the public source.
    next.preparedCatalogs.set(first.registry, previousRows);
    next.preparedCatalogs.set(next.registry, nextRows);
    const pendingFirst = first.createPublicReaderRuntime(); first.complete();
    const oldRuntime = await pendingFirst;
    first.nextSession();
    const pendingNext = next.createPublicReaderRuntime(); next.complete();
    const nextRuntime = await pendingNext;
    expect(nextRuntime.catalog().flatMap(section => section.entries).map(row => row.id)).toEqual(["next"]);
    expect(next.preparedLookups).toEqual([next.registry]);
    expect(() => oldRuntime.catalog()).toThrow("Stale reader session");
    expect(first.preparedLookups).toEqual([]);
    expect(scoped.builds()).toBe(0);
    nextRuntime.dispose();
  });

  test("the exact checked session becomes readable before catalogue presentation is built", async () => {
    const h = harness();
    let ready = false;
    const pending = h.createPublicReaderRuntime().then(runtime => { ready = true; return runtime; });
    await h.preparationStarted;
    expect(ready).toBe(false);
    expect(h.stats()).toEqual({ catalogBuilds: 0, clients: 0, disposed: 0, preparationCalls: 1 });
    h.complete();
    const runtime = await pending;
    expect(runtime.kind).toBe("public"); expect(runtime.epoch).toBe(3);
    expect<unknown>(runtime.registry()).toBe(h.registry); expect<unknown>(runtime.session()).toBe(h.session);
    expect<unknown>(runtime.publicData).toBe(h.publicData);
    expect(h.stats().catalogBuilds).toBe(0);
    expect<unknown>(await runtime.prepareFunction("selected")).toBe(h.session);
    expect<unknown>(runtime.catalog()).toBe(h.catalog); expect<unknown>(runtime.catalog()).toBe(h.catalog);
    expect(h.stats().catalogBuilds).toBe(1);
    runtime.dispose(); runtime.dispose();
    expect(h.stats().disposed).toBe(1);
  });

  test("abort during complete repository preparation cannot expose a late read session", async () => {
    const h = harness(); const abort = new AbortController();
    const pending = h.createPublicReaderRuntime({ signal: abort.signal });
    await h.preparationStarted;
    abort.abort(new Error("Reader closed")); h.complete();
    await expect(pending).rejects.toThrow("Reader closed");
    expect(h.stats().clients).toBe(0); expect(h.stats().catalogBuilds).toBe(0);
  });

  test("session replacement retires preparation captured before asynchronous imports", async () => {
    const h = harness();
    const pending = h.createPublicReaderRuntime();
    h.nextSession();
    await expect(pending).rejects.toThrow("Stale reader session");
    expect(h.events).toEqual([]); expect(h.stats().preparationCalls).toBe(0);
  });

  test("session replacement during the shared checked build cannot borrow the new epoch", async () => {
    const h = harness();
    const pending = h.createPublicReaderRuntime();
    await h.preparationStarted; h.nextSession(); h.complete();
    await expect(pending).rejects.toThrow("Stale reader session");
    expect(h.stats().clients).toBe(0);
  });

  test("a bootstrap identity mismatch cannot expose the checked result under stale shell data", async () => {
    const h = harness(); h.rejectBootstrap();
    const pending = h.createPublicReaderRuntime();
    await h.preparationStarted; h.complete();
    await expect(pending).rejects.toThrow("Public bootstrap changed");
    expect(h.stats().clients).toBe(0); expect(h.stats().catalogBuilds).toBe(0);
  });

  test("closing a readable public runtime prevents late projection and evaluator acquisition", async () => {
    const h = harness(); const abort = new AbortController();
    const pending = h.createPublicReaderRuntime({ signal: abort.signal });
    await h.preparationStarted; h.complete();
    const runtime = await pending;
    abort.abort(new Error("Reader closed"));
    expect(() => runtime.session()).toThrow("Reader closed");
    expect(() => runtime.catalog()).toThrow("Reader closed");
    expect(() => runtime.catalogLookups.fn("retired")).toThrow("Reader closed");
    expect(h.stats().catalogBuilds).toBe(0); expect(h.stats().disposed).toBe(1);
  });

  test("an already cancelled reader does not start imports or registry work", async () => {
    const h = harness(); const abort = new AbortController();
    abort.abort(new Error("Already closed"));
    await expect(h.createPublicReaderRuntime({ signal: abort.signal })).rejects.toThrow("Already closed");
    expect(h.events).toEqual([]); expect(h.stats().preparationCalls).toBe(0);
  });
});
