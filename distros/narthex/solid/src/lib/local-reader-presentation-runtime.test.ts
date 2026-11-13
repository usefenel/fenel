import { describe, expect, test } from "bun:test";
import * as presentationModule from "./local-reader-presentation";
import { resolveLocusCatalogReference } from "./locus-catalog-reference";

// B3 (T4/T10): run the real Local reader runtime factory with a snapshot whose
// page registry and page session refuse every read. Every presentation,
// catalogue reference and type caption must come from the snapshot's worker.
const runtime = await Bun.file(new URL("./reader-runtime.tsx", import.meta.url)).text();
function section(source: string, from: string, to: string) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  if (start < 0 || end < start) throw new Error(`Reader boundary moved: ${from}`);
  return new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end))
    .replace(/^export /gm, "").replace(/\bimport\(/g, "loadModule(");
}
const runtimeCode = section(runtime, "export function startLocalReaderRuntime", "export async function createLocalReaderRuntime");
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function refusing(name: string): object {
  return new Proxy({}, { get: (_target, key) => {
    if (key === "then") return undefined;
    throw new Error(`page ${name}.${String(key)} was read`);
  } });
}

function harness() {
  const pageReads: string[] = [];
  const handle = Object.freeze({});
  const requests: Array<{ method: string; targets?: readonly string[] }> = [];
  const snapshot = {
    kind: "local", worker: handle, functions: [], catalog: [],
    types: [{ id: "type-1", name: "Shape" }], functionRows: [{ id: "fn-1", name: "double" }],
    get registry() { pageReads.push("registry"); return refusing("registry"); },
    get session() { pageReads.push("session"); return refusing("session"); },
  };
  const source = { id: "local", ready: async () => {}, snapshot: () => snapshot, revision: () => 0,
    state: () => ({}), metadataTargets: () => ["uuid-ref"],
    captureSourceMetadata: () => undefined };
  const run = async (target: object, payload: { method: string; targets?: readonly string[]; types?: unknown[] }) => {
    expect(target).toBe(handle);
    requests.push({ method: payload.method, targets: payload.targets });
    if (payload.method === "project-reader-metadata") return { entries: payload.targets!.map(target => ({ target,
      representations: [{ typeName: "Labelable", methods: { label: `Local ${target}` } }],
      ownPresentation: { label: `Local ${target}`, icon: "hash" } })) };
    if (payload.method === "project-reader-references") return { references: payload.targets!.map(target => ({ target,
      ...(target === "uuid-ref" ? { reference: { fn: { id: "demo:double" }, handle: "uuid-ref" } } : {}) })) };
    return { typePresentations: payload.types!.map(type => ({ type, label: "Shape", icon: "shapes" })) };
  };
  const bindings = {
    createSignal: (value: unknown) => [() => value, () => {}], untrack: (read: () => unknown) => read(),
    sessionEpoch: () => 1, assertCurrentSession: () => {}, onBrowserSessionChange: () => () => {},
    localTabDataSource: () => source, createLocalApiClient: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    loadModule: async (path: string) => {
      if (path === "./web-template-registry") return { createReaderTemplateRegistry: () => ({ list: () => [], listComponentNames: () => [] }) };
      if (path === "./local-reader-presentation") return presentationModule;
      if (path === "./expression-runner/authoring-session") return {};
      if (path === "./expression-runner/authoring-catalog-worker") return { runPreparedReaderWorker: run };
      if (path === "./icons") return { LUCIDE_BY_NAME: { hash: true, shapes: true } };
      // Before B3 the Local reader built its presentation over the page registry.
      if (path === "./reader-presentation") return await import("./reader-presentation");
      throw new Error(`Unexpected import: ${path}`);
    },
  };
  const start = new Function(...Object.keys(bindings), `${runtimeCode}; return startLocalReaderRuntime;`)(...Object.values(bindings));
  return { start, pageReads, requests };
}

describe("B3 Local reader presentation runtime", () => {
  test("T4/T10: names, references and type captions come from the worker, never the page registry", async () => {
    const h = harness();
    const reader = await h.start().ready;
    // Prefill before publication: own definitions and the tab's metadata targets.
    expect(h.requests.find(request => request.method === "project-reader-metadata")?.targets)
      .toEqual(["type-1", "fn-1", "uuid-ref"]);
    expect(reader.presentation("fn-1")?.label).toBe("Local fn-1");
    expect(reader.representation("Labelable", "type-1")).toEqual({ label: "Local type-1" });
    expect(reader.ownIcon("uuid-ref")).toBe("hash");
    expect(resolveLocusCatalogReference({ id: "uuid-ref", kind: "function" } as never, reader.catalogLookups))
      .toEqual({ value: { id: "demo:double" }, kind: "function" });
    expect(reader.presentationPending("other")).toBe(true);
    expect(reader.typePresentation({ $ref: "Shape" })).toBeUndefined();
    await tick(); await tick();
    expect(reader.presentation("other")?.label).toBe("Local other");
    expect(reader.typePresentation({ $ref: "Shape" })?.icon).toBe("shapes");
    expect(h.pageReads).toEqual([]);
  });
});
