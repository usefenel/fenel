import { describe, expect, test } from "bun:test";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { WorkspaceSource } from "./workspace-wire";
import { savedExpressionDeclaration, shareSavedExpressionMap } from "./saved-expression-map";

// Execute the actual browser-source acquisition callback. Only its dynamic
// adapter import and HTTP/bootstrap interfaces are held. The source owners of
// the saved map, dependency codec and expression key perform freshness checks.
function section(text: string, startMarker: string, endMarker: string) {
  const start = text.indexOf(startMarker), end = text.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error(`Address source boundary changed: ${startMarker}`);
  return text.slice(start, end);
}
const surface = await Bun.file(new URL("./workspace-surface.tsx", import.meta.url)).text();
const callback = section(surface, "    values: async (source, root) => {", "    captureCurrent: (source, root) => {")
  .trim().replace(/^values:\s*/, "").replace(/,$/, "").replace(/\bimport\(/g, "loadModule(");
const identity = await Bun.file(new URL("./saved-expression-identity.ts", import.meta.url)).text();
const codec = await Bun.file(new URL("../../../../../implementations/typescript/engine/src/authoring/expression-authoring.ts", import.meta.url)).text();
const dependencyOwner = section(codec, "export function exprNodeToLogic(", "const EXACT_OPERATOR_ALIAS_PREFIX")
  + section(codec, "function literalToLogic(", "/** Host evaluator vocabulary,");
const keyOwner = section(identity, "function stable(", "type MediaCall =");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const expressionKey = new Function("savedExpressionDeclaration",
  `${transpiler.transformSync(dependencyOwner + keyOwner).replace(/^export /gm, "")}; return expressionKey;`)(savedExpressionDeclaration) as
  (node: ExprNode, saved: ReadonlyMap<string, ExprNode>) => string;
const code = transpiler.transformSync(`const values = ${callback};`);

type Root = { id: string; revision: number; expressions: Record<string, ExprNode> };
type Queries = { queries: Array<{ id: string; query: unknown }> };
type ReaderOptions = { current: () => unknown; ready: () => Promise<unknown>; saved: ReadonlyMap<string, ExprNode>;
  assertCurrent: () => void; checkRoot: (node: ExprNode) => Promise<void> };
type Source = WorkspaceSource;
const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
const reference: ExprNode = { kind: "ref", savedExprId: "root-value" };
const savedQueryReference: ExprNode = { kind: "ref", savedExprId: "query-value" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function harness(sourceTag: Source["$tag"] = "PublicSource") {
  const calls = { adapter: 0, identity: 0, createReader: 0, cachedQueries: 0, freshQueries: 0, freshRoot: 0, bootstrap: 0 };
  const source: Source = sourceTag === "AccountSource" ? { $tag: "AccountSource", accountId: "reader" } : { $tag: sourceTag };
  const root: Root = { id: "fixture-root", revision: 2, expressions: { "root-value": literal(["first", "second"]) } };
  const queries: Queries = { queries: [{ id: "query-value", query: JSON.stringify({ expr: literal(["saved", "data"]) }) }] };
  let freshRoot = root, freshQueries = queries;
  let epoch = 5;
  let options: ReaderOptions | undefined;
  let rootGate: Promise<void> | undefined;
  let identityGate: Promise<void> | undefined;
  const rootStarted = deferred<void>();
  const queryRead = async () => {
    calls.cachedQueries++;
    if (sourceTag === "PublicSource") throw new Error("Public readers do not expose account saved queries");
    return queries;
  };
  const client = {
    getSavedQueries: Object.assign(queryRead, { uncached: async () => {
      calls.freshQueries++;
      if (sourceTag === "PublicSource") throw new Error("Public readers do not expose account saved queries");
      return freshQueries;
    } }),
    getLocusRoot: { uncached: async () => {
      calls.freshRoot++; rootStarted.resolve();
      if (sourceTag === "PublicSource") throw new Error("Public source must use its checked bootstrap");
      if (rootGate) await rootGate;
      return { root: freshRoot };
    } },
  };
  const readerValue = { fixture: "same scoped reader" };
  const abort = new AbortController();
  const entry = { client, abort, runtime: () => readerValue, ready: async () => readerValue };
  const runtimes = new Map([["source-fixture", entry]]);
  const adapterValue = { fixture: "existing ordinary reader adapter" };
  const bindings = {
    workspaceSourceKey: () => "source-fixture",
    runtimes,
    reader: () => {
      // Production reader(source) returns its cached entry before allocating.
      if (!runtimes.has("source-fixture")) calls.createReader++;
      return entry;
    },
    loadModule: async (path: string) => {
      if (path === "./saved-expression-identity") { calls.identity++; await identityGate; return { expressionKey }; }
      expect(path).toBe("./locus-address-reader"); calls.adapter++;
      return { locusAddressReader: (supplied: ReaderOptions) => { options = supplied; return adapterValue; } };
    },
    props: { epoch: 5 },
    surfaceClosed: false,
    assertCurrentSession: (captured: number) => { if (captured !== epoch) throw new Error("Session changed"); },
    shareSavedExpressionMap,
    expressionKey,
    loadPublicBootstrap: async () => { calls.bootstrap++; return { root: freshRoot }; },
  };
  const values = new Function(...Object.keys(bindings), `${code}; return values;`)(...Object.values(bindings)) as
    (source: Source, root: Root) => Promise<typeof adapterValue | undefined>;
  return { source, root, queries, calls, adapterValue, readerValue, entry, values,
    options: () => { if (!options) throw new Error("Reader adapter was not acquired"); return options; },
    rootStarted: rootStarted.promise,
    setRoot: (next: Root) => { freshRoot = next; },
    setQueries: (next: Queries) => { freshQueries = next; },
    holdRoot: (promise: Promise<void>) => { rootGate = promise; },
    holdIdentity: (promise: Promise<void>) => { identityGate = promise; },
    changeSession: () => { epoch++; },
    retireReader: () => { runtimes.delete("source-fixture"); },
  };
}

describe("addressed values use the API of their actual source", () => {
  test("public acquisition and root revalidation never call account-only APIs", async () => {
    const h = harness();
    expect(await h.values(h.source, h.root)).toBe(h.adapterValue);
    const acquired = h.options();
    expect(acquired.current).toBe(h.entry.runtime); expect(acquired.ready).toBe(h.entry.ready);
    expect(acquired.saved.get("root-value")).toBe(h.root.expressions["root-value"]);
    expect(acquired.saved.has("query-value")).toBe(false);
    await acquired.checkRoot(reference);
    expect(h.calls).toEqual({ adapter: 1, identity: 1, createReader: 0, cachedQueries: 0, freshQueries: 0, freshRoot: 0, bootstrap: 1 });
  });

  test("public checked-bootstrap body changes still refuse a stale position", async () => {
    const h = harness(); await h.values(h.source, h.root);
    h.setRoot({ ...h.root, expressions: { "root-value": literal(["changed"]) } });
    await expect(h.options().checkRoot(reference)).rejects.toThrow("data changed while its position was opening");
    expect(h.calls.cachedQueries).toBe(0); expect(h.calls.freshQueries).toBe(0); expect(h.calls.freshRoot).toBe(0);
  });

  for (const source of ["ThisTabSource", "AccountSource"] as const) {
    test(`${source} retains its own saved query API and checks fresh dependencies`, async () => {
      const h = harness(source);
      expect(await h.values(h.source, h.root)).toBe(h.adapterValue);
      expect(h.options().saved.get("query-value")).toEqual(literal(["saved", "data"]));
      await h.options().checkRoot(savedQueryReference);
      expect(h.calls).toEqual({ adapter: 1, identity: 1, createReader: 0, cachedQueries: 1, freshQueries: 1, freshRoot: 1, bootstrap: 0 });
      h.setQueries({ queries: [{ id: "query-value", query: { expr: literal(["replacement"]) } }] });
      await expect(h.options().checkRoot(savedQueryReference)).rejects.toThrow("data changed while its position was opening");
      expect(h.calls.freshQueries).toBe(2); expect(h.calls.freshRoot).toBe(2);
    });
  }

  test("fresh saved query changes reach references inside the codec's structural data slots", async () => {
    const h = harness("AccountSource"); await h.values(h.source, h.root);
    const node = literal({ __record: { fields: [{ name: "rows", value: literal({ __list: [savedQueryReference] }) }] } });
    await h.options().checkRoot(node);
    h.setQueries({ queries: [{ id: "query-value", query: { expr: literal(["edited source"]) } }] });
    await expect(h.options().checkRoot(node)).rejects.toThrow("data changed while its position was opening");
  });

  test("All data never acquires a source evaluator or an API reader", async () => {
    const h = harness("AllDataSource");
    expect(await h.values(h.source, h.root)).toBeUndefined();
    expect(h.calls).toEqual({ adapter: 0, identity: 0, createReader: 0, cachedQueries: 0, freshQueries: 0, freshRoot: 0, bootstrap: 0 });
  });

  test("a public reader retired before acquisition cannot expose its saved map", async () => {
    const h = harness(); h.retireReader(); h.entry.abort.abort();
    await expect(h.values(h.source, h.root)).rejects.toThrow("data reader was replaced");
    expect(h.calls.cachedQueries).toBe(0); expect(h.calls.freshQueries).toBe(0);
  });

  test("a delayed dependency import cannot expose data after its session changes", async () => {
    const h = harness(), gate = deferred<void>();
    h.holdIdentity(gate.promise);
    const acquisition = h.values(h.source, h.root);
    expect(h.calls.identity).toBe(1);
    h.changeSession(); gate.resolve();
    await expect(acquisition).rejects.toThrow("Session changed");
    expect(() => h.options()).toThrow("Reader adapter was not acquired");
  });

  test("a source retired during a fresh root read refuses its late response", async () => {
    const h = harness("AccountSource"), gate = deferred<void>(); await h.values(h.source, h.root); h.holdRoot(gate.promise);
    const pending = h.options().checkRoot(savedQueryReference);
    await h.rootStarted; h.retireReader(); gate.resolve();
    await expect(pending).rejects.toThrow("data reader was replaced");
  });

  test("session and reader-abort checks remain held by the acquired adapter", async () => {
    const h = harness(); await h.values(h.source, h.root); h.changeSession();
    expect(() => h.options().assertCurrent()).toThrow("Session changed");
    const aborted = harness(); await aborted.values(aborted.source, aborted.root); aborted.entry.abort.abort();
    await expect(aborted.options().checkRoot(reference)).rejects.toThrow("data reader was replaced");
    expect(aborted.calls.bootstrap).toBe(0);
  });
});
