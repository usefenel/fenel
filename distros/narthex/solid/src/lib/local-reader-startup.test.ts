// Run with --conditions=browser --conditions=development for Solid 2's graph (the server build never runs effects).
import { describe, expect, test } from "bun:test";
import { createEffect, createMemo, createRoot, createSignal, flush, untrack } from "solid-js";
import { constantData } from "./locus-expression-edit";

// C1: execute the real reader lifecycle with controlled acquisition leaves.
// The checked model and registry have their own semantic admission tests.
const surface = await Bun.file(new URL("./workspace-surface.tsx", import.meta.url)).text();
const runtime = await Bun.file(new URL("./reader-runtime.tsx", import.meta.url)).text();
const home = await Bun.file(new URL("./home-entry.tsx", import.meta.url)).text();
function section(source: string, from: string, to: string) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  if (start < 0 || end < start) throw new Error(`Reader boundary moved: ${from}`);
  return new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end))
    .replace(/^export /gm, "").replace(/\bimport\(/g, "loadModule(");
}
const surfaceCode = section(surface, "  function reader(source:", "  let settingsReaderRequested");
const runtimeCode = section(runtime, "export function startLocalReaderRuntime", "export async function createLocalReaderRuntime");
const canvasCode = section(home, "  const needsTypedCanvas =", "  async function retryReads");
const valueDemandCode = section(home, "  createEffect(() => (!!props.publicRoot", "  function previewScope");
const shellPreviewCode = section(home, "  function shellPreview", "  createEffect(() => (!!props.publicRoot");
const metadataCode = section(home, "  const [thumbnailMetadata, setThumbnailMetadata]", "  function projectedPreviewRepresentation");
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function signal<T>(initial: T): [() => T, (next: T) => void] {
  let value = initial;
  return [() => value, next => { value = next; }];
}
function harness() {
  let epoch = 4, preparations = 0, modelPreparations = 0, imports = 0, acquisitions = 0;
  const checked = deferred<void>();
  const root = { id: "local-root", items: [{ id: "clipboard" }] };
  const snapshot = { kind: "local", worker: {}, registry: {}, session: {}, callableLabels: [], functions: [], types: [], functionRows: [], catalog: [] };
  let metadataCurrent = true;
  const metadataCapture = { session: snapshot.session, packet: Object.freeze({ source: { $tag: "ThisTabSource" } }),
    generationToken: Object.freeze({}), current: () => metadataCurrent };
  const source = { ready: () => { preparations++; return checked.promise; }, snapshot: () => snapshot, revision: () => 0,
    state: () => ({}), metadataTargets: () => [],
    captureSourceMetadata: () => metadataCapture };
  const clients: Array<{ signal: AbortSignal; getLocusRoot: () => Promise<{ root: typeof root }>; dispose: () => void }> = [];
  const bindings = {
    createSignal: signal, untrack: (read: () => unknown) => read(), sessionEpoch: () => epoch,
    assertCurrentSession: (captured: number) => { if (captured !== epoch) throw new Error("Stale reader session"); },
    onBrowserSessionChange: () => () => {},
    localTabDataSource: () => { acquisitions++; return source; },
    createLocalApiClient: () => {
      const life = new AbortController();
      const client = { signal: life.signal, getLocusRoot: async () => {
        life.signal.throwIfAborted(); return { root };
      }, dispose: () => life.abort() };
      clients.push(client); return client;
    },
    loadModule: async (path: string) => {
      imports++;
      if (path === "./web-template-registry") return { createReaderTemplateRegistry: () => ({}) };
      if (path === "./local-reader-presentation") return { createLocalReaderPresentation: () => ({ prefill: async () => {} }) };
      if (path === "./expression-runner/authoring-catalog-worker") return { runPreparedReaderWorker: async () => ({}) };
      if (path === "./icons") return { LUCIDE_BY_NAME: {} };
      if (path === "./expression-runner/authoring-session") return {};
      throw new Error(`Unexpected import: ${path}`);
    },
  };
  const startLocalReaderRuntime = new Function(...Object.keys(bindings), `${runtimeCode}; return startLocalReaderRuntime;`)(...Object.values(bindings));
  const runtimes = new Map();
  const scope = { ...bindings, runtimes, workspaceOwner: undefined, synchronization: () => ({}),
    runWithOwner: (_owner: unknown, read: () => unknown) => read(), createRoot: (read: (dispose: () => void) => unknown) => read(() => {}),
    props: { epoch: 4, store: {} }, prepareModel: async () => { modelPreparations++; },
    workspaceSourceKey: () => "local", setReaderEntries: () => {}, startLocalReaderRuntime,
    PublicBootstrapMismatchError: class extends Error {},
    createPublicApiClient: () => { throw new Error("Local acquired a public client"); },
    loadPublicBootstrap: () => { throw new Error("Local acquired a public root"); },
  };
  const reader = new Function(...Object.keys(scope), `${surfaceCode}; return reader;`)(...Object.values(scope));
  return { reader: () => reader({ $tag: "ThisTabSource" }), root, source, checked, clients, metadataCapture,
    retireMetadata: () => { metadataCurrent = false; },
    counts: () => ({ preparations, modelPreparations, imports, acquisitions }), nextEpoch: () => { epoch++; } };
}
async function turn() { await Promise.resolve(); await Promise.resolve(); flush(); }

describe("Local reader preparation demand", () => {
  for (const boundary of ["reader", "session", "client", "source"] as const) test(`source metadata retires with its ${boundary}`, async () => {
    const h = harness(), reader = h.reader();
    const waiting = reader.ready(); await turn(); h.checked.resolve();
    const loaded = await waiting;
    const capture = loaded.captureSourceMetadata();
    expect(capture.session).toBe(loaded.session());
    expect(capture.packet).toBe(h.metadataCapture.packet);
    expect(capture.generationToken).toBe(h.metadataCapture.generationToken);
    expect(capture.current()).toBe(true);
    if (boundary === "reader") reader.dispose();
    else if (boundary === "session") h.nextEpoch();
    else if (boundary === "client") loaded.client.dispose();
    else h.retireMetadata();
    expect(capture.current()).toBe(false);
    if (boundary !== "reader") reader.dispose();
  });

  test("opening and rereading Local use one checked client without preparing editors", async () => {
    const h = harness(), reader = h.reader();
    expect((await reader.client.getLocusRoot()).root).toBe(h.root);
    expect(h.reader()).toBe(reader);
    expect(reader.requested()).toBe(false); expect(reader.preparing()).toBe(false);
    expect(h.counts()).toEqual({ preparations: 0, modelPreparations: 0, imports: 0, acquisitions: 1 });
    expect(h.clients).toHaveLength(1);
    reader.dispose(); expect(h.clients[0]!.signal.aborted).toBe(true);
  });

  test("several explicit interactions join one preparation and retain the original client", async () => {
    const h = harness(), reader = h.reader();
    reader.request(); reader.request();
    const first = reader.ready(), second = reader.ready();
    expect(first).toBe(second);
    await turn();
    expect(h.counts()).toEqual({ preparations: 1, modelPreparations: 1, imports: 0, acquisitions: 1 });
    h.checked.resolve();
    const loaded = await first;
    expect(reader.runtime()).toBe(loaded); expect(loaded.client).toBe(reader.client);
    expect(h.clients).toHaveLength(1); expect(reader.preparing()).toBe(false);
    reader.dispose();
  });

  test("tools failure leaves the checked root readable until retry or disposal", async () => {
    const h = harness(), reader = h.reader();
    const waiting = reader.ready(); await turn(); h.checked.reject(new Error("Registry refused"));
    await expect(waiting).rejects.toThrow("Registry refused");
    expect(reader.error()).toBe("Registry refused"); expect(reader.preparing()).toBe(false);
    expect((await reader.client.getLocusRoot()).root).toBe(h.root);
    reader.dispose(); expect(reader.client.signal.aborted).toBe(true);
  });

  for (const boundary of ["close", "session"] as const) test(`${boundary} prevents late runtime publication`, async () => {
    const h = harness(), reader = h.reader();
    const waiting = reader.ready(); await turn();
    if (boundary === "close") reader.dispose(); else h.nextEpoch();
    h.checked.resolve(); await expect(waiting).rejects.toThrow();
    expect(reader.runtime()).toBeUndefined(); expect(reader.client.signal.aborted).toBe(true);
  });
});

function shellHarness(local: boolean, items: Array<{ id: string; expression?: { kind: string; value?: unknown } }>) {
  const frames = new Map<number, () => void>();
  let nextFrame = 0, requests = 0, handoffs = 0, metadataReads = 0;
  const [ready, setReady] = createSignal(false);
  const root = { items, previewMetadata: { entries: [{ target: "local-list", representations: [] }] } };
  const scope = { createSignal, createMemo, createEffect, untrack,
    prepareOnDemand: () => local, readProjection: () => undefined,
    props: {}, previewItems: () => items, previewLists: () => items.filter(item => item.id === "clipboard"),
    recordPreview: () => undefined, constantData, pipelinePreviews: () => new Map(),
    previewableValue: (value: unknown) => typeof value === "string" || typeof value === "number" || typeof value === "boolean",
    previewExpression: (item: { expression?: unknown }) => item.expression,
    currentReads: () => true, failed: () => false, current: () => root, sessionEpoch: () => 4,
    requested: () => false, openWorkspace: () => { handoffs++; },
    workspace: { ready, error: () => undefined, request: () => { requests++; } }, thumbnailTargets: () => ["local-list"],
    requestAnimationFrame: (callback: () => void) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    client: { signal: new AbortController().signal, api: { readerMetadata: async () => { metadataReads++; return { entries: [] }; } } },
  };
  let dispose!: () => void;
  const metadata = createRoot(end => {
    dispose = end;
    return new Function(...Object.keys(scope), `${shellPreviewCode}\n${canvasCode}\n${valueDemandCode}\n${metadataCode}; return thumbnailMetadata;`)(...Object.values(scope));
  });
  flush();
  while (frames.size) { const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback()); }
  return { dispose, metadata, counts: () => ({ requests, handoffs, metadataReads }), ready: () => { setReady(true); flush(); } };
}

describe("Local early Home lifecycle", () => {
  for (const items of [[], [{ id: "structural-clipboard", expression: { kind: "literal", value: { __list: [] } } }],
    [{ id: "literal-data", expression: { kind: "literal", value: "Saved local text" } }]]) test(`root with ${items.length} entries does not demand full tools`, async () => {
    const h = shellHarness(true, items);
    try {
      await turn();
      expect(h.counts()).toEqual({ requests: 0, handoffs: 0, metadataReads: 0 });
      expect(h.metadata().entries).toEqual([{ target: "local-list", representations: [] }]);
      h.ready(); await turn();
      expect(h.counts()).toEqual({ requests: 0, handoffs: 0, metadataReads: 1 });
    } finally { h.dispose(); }
  });

  test("account canvases retain their existing automatic preparation", async () => {
    const h = shellHarness(false, [{ id: "account-data" }]);
    try { await turn(); expect(h.counts()).toEqual({ requests: 1, handoffs: 1, metadataReads: 1 }); }
    finally { h.dispose(); }
  });

  test("a visible computed Local value still requests its checked evaluator", async () => {
    const h = shellHarness(true, [{ id: "formula", expression: { kind: "call" } }]);
    try { await turn(); expect(h.counts()).toEqual({ requests: 1, handoffs: 0, metadataReads: 0 }); }
    finally { h.dispose(); }
  });

  test("a structural list containing a call keeps that child behind the checked evaluator", async () => {
    const h = shellHarness(true, [{ id: "computed-list", expression: { kind: "literal",
      value: { __list: [{ kind: "call", fnId: "fixture:held", args: [] }] } } }]);
    try { await turn(); expect(h.counts()).toEqual({ requests: 1, handoffs: 0, metadataReads: 0 }); }
    finally { h.dispose(); }
  });

  test("a Clipboard occurrence stays inert until its unresolved contents are opened", async () => {
    const h = shellHarness(true, [{ id: "clipboard", expression: { kind: "call" } }]);
    try { await turn(); expect(h.counts()).toEqual({ requests: 0, handoffs: 0, metadataReads: 0 }); }
    finally { h.dispose(); }
  });
});
