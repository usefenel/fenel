// @ts-nocheck -- Isolated worker/session imports around the production cache boundary.
import { describe, expect, test } from "bun:test";
import { expressionKey, expressionMediaScheduling, expressionRendersPicture, expressionRendersSampledMedia } from "./saved-expression-identity";
import { inertAuthoringSession } from "./expression-runner/account-authoring-session";
import { exprNodeToLogic } from "@fenel/engine/authoring/expression";
import { savedExpressionDeclaration, shareSavedExpressionMap } from "./saved-expression-map";

const source = await Bun.file(new URL("./locus-card-evaluation.ts", import.meta.url)).text();
const start = source.indexOf("const results =");
if (start < 0) throw new Error("Card evaluation cache boundary moved");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start)).replace(/^export /gm, "");
const facadeSource = await Bun.file(new URL("./expression-runner/account-authoring-session.ts", import.meta.url)).text();
const facadeStart = facadeSource.indexOf("const facadeSources ="), facadeEnd = facadeSource.indexOf("export type AccountAuthoringScope", facadeStart);
if (facadeStart < 0 || facadeEnd < 0) throw new Error("Card facade identity boundary moved");
const { reactiveAuthoringSession, concreteAuthoringSession } = new Function("untrack", new Bun.Transpiler({ loader: "ts" })
  .transformSync(facadeSource.slice(facadeStart, facadeEnd)).replace(/^export /gm, "")
  + "; return { reactiveAuthoringSession, concreteAuthoringSession };")(read => read());
const earlySource = await Bun.file(new URL("./early-read-value.tsx", import.meta.url)).text();
const earlyStart = earlySource.indexOf("  const evaluation = createLocusCardEvaluation("), earlyEnd = earlySource.indexOf("  const current =", earlyStart);
if (earlyStart < 0 || earlyEnd < 0) throw new Error("Early card evaluation source boundary moved");
const earlyCode = new Bun.Transpiler({ loader: "ts" }).transformSync(earlySource.slice(earlyStart, earlyEnd));
const metadataSource = await Bun.file(new URL("./reader-source-metadata.ts", import.meta.url)).text();
const metadataStart = metadataSource.indexOf("export function assertReaderSourceMetadata(");
if (metadataStart < 0) throw new Error("Reader metadata admission boundary moved");
const metadataPorts = new Function("concreteAuthoringSession",
  new Bun.Transpiler({ loader: "ts" }).transformSync(metadataSource.slice(metadataStart)).replace(/^export /gm, "")
    + "; return { assertReaderSourceMetadata, captureReaderSourceMetadata, readerSourceMetadataFrame };")(concreteAuthoringSession);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const declarations = new Map(["picture:render", "sound:renderSound", "movie:renderMovie"].map(id => [id, { id }]));
  const mediaSession = { registry: { getFunction: id => declarations.get(id) }, evaluateContext: { getFunction: id => declarations.get(id) },
    environment: { functionCodeName: id => id, constructorCodeName: () => undefined } };
  let epoch = 1;
  let syncCalls = 0;
  const jobs = [];
  const workers = new Map();
  const reads = [];
  const metadata = new Map();
  const syncReads = [];
  const replaceMetadata = (session, generation) => {
    const packet = { $tag: "ReaderSourceMetadata", source: { $tag: "ThisTabSource" }, rootId: "same-root", generation,
      expressions: [], occurrences: [], callableLabels: [] };
    const capture = { session, packet, generationToken: {}, current: () => metadata.get(session) === capture };
    metadata.set(session, capture);
    session.captureSourceMetadata = () => metadata.get(session);
    return capture;
  };
  const guards = {
    savedExpressionDeclaration,
    ...metadataPorts,
    createMemo: compute => compute,
    untrack: compute => compute(),
    createAsyncValue: (readSource, fetcher) => {
      let generation = 0;
      let value, error, loading = false;
      const read = () => value;
      const run = () => {
        const current = ++generation;
        loading = true;
        error = undefined;
        let result;
        try { result = fetcher(readSource()); }
        catch (failure) { loading = false; error = failure; return Promise.resolve(); }
        return Promise.resolve(result).then(next => {
          if (current === generation) { value = next; loading = false; }
        }, failure => {
          if (current === generation) { error = failure; loading = false; }
        });
      };
      Object.defineProperties(read, {
        loading: { get: () => loading }, error: { get: () => error },
      });
      read.refetch = () => read.pending = run();
      read.pending = run();
      reads.push(read);
      return read;
    },
    concreteAuthoringSession,
    authoringSessionAccountScope: session => session.account,
    authoringWorkerRetired: session => !!workers.get(session)?.closed,
    authoringWorkerSnapshot: session => {
      const worker = workers.get(session);
      if (worker?.closed) throw new Error("Snapshot retired");
      return worker?.token;
    },
    sessionEpoch: () => epoch,
    assertCurrentSession: captured => { if (captured !== epoch) throw new Error("Session changed"); },
    evaluateExpressionInWorker: (session, node, saved, signal, scope, options) => {
      const worker = workers.get(session);
      if (!worker || worker.ineligible) return undefined;
      const flight = deferred();
      jobs.push({ ...flight, session, node, saved, signal, scope, options });
      return flight.promise;
    },
    evaluateAuthoringExpressionInSession: (_node, _resolver, session, _data, options) => {
      syncCalls++; syncReads.push({ session, options });
      return { result: options?.sourceMetadata?.packet.generation ?? "public", trace: [] };
    },
    authoringExpressionSites: (node, resolver) => {
      const sites = [];
      const logic = exprNodeToLogic(node, { resolver, onExpression: (node, logic) => sites.push({ node, logic }) });
      return { logic, sites };
    },
    expressionKey,
    // B4 wave 4 lane S: a frameless (Local) session's page media facts are
    // neutral (saved-expression-identity); a sampled-media page decision for
    // one would read its frame, so this fixture refuses it.
    isInertAuthoringSession: session => !!session?.frameless,
    expressionRendersPicture: (node, saved, session) => session?.frameless ? false : expressionRendersPicture(node, saved, mediaSession),
    expressionRendersSampledMedia: (node, saved, session) => {
      if (session?.frameless) throw new Error("A page media decision read a frameless session");
      return expressionRendersSampledMedia(node, saved, mediaSession);
    },
    readImagePipelinePreview: () => undefined,
    evaluateImagePipeline: (node, saved) => {
      const expr = node?.kind === "ref" ? saved.get(node.savedExprId) : node;
      return expr?.fnId === "std:imageInvert" ? { width: 96, height: 53, pixels: [] } : undefined;
    },
    beforePictureEvaluation: () => Promise.resolve(),
  };
  const production = new Function(...Object.keys(guards), `${code}; return { evaluateLocusCard, readLocusCardResult, readLocusCapturedValue, createLocusCardEvaluation,
    retainedEntries: session => results.get(session)?.entries.size ?? 0,
    retainedObservations: session => results.get(session)?.observations.size ?? 0,
    retainedOwner: session => results.get(session) };`)(...Object.values(guards));
  return { ...production, workers, jobs, reads, syncReads, replaceMetadata, closeMetadata: session => metadata.delete(session),
    syncCalls: () => syncCalls, changeLogin: () => { epoch++; } };
}
const node = () => ({ kind: "call", fnId: "example", args: [] });
// Inspect only references reachable through the explicit cache owner's own
// data/Map slots. This makes no statement about GC, pending promise internals
// or external fixture references that intentionally still retain the capture.
function ownerReferences(root, expected, seen = new Set()) {
  if (root === expected) return true;
  if (root === null || typeof root !== "object" || seen.has(root)) return false;
  seen.add(root);
  if (root instanceof Map) {
    for (const [key, value] of root) if (ownerReferences(key, expected, seen) || ownerReferences(value, expected, seen)) return true;
    return false;
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(root))) {
    if ("value" in descriptor && ownerReferences(descriptor.value, expected, seen)) return true;
  }
  return false;
}

describe("card results stay with the exact reader snapshot", () => {
  test("a saved declaration reaches admission before the raw-data card shortcut", () => {
    const h = harness(), session = {};
    const saved = shareSavedExpressionMap(undefined, [{ id: "recipe", query: {
      expr: { kind: "literal", value: 42 },
      valueType: { $arrow: { params: [{ name: "pantry", type: { $ref: "Number" } }], returns: { $ref: "Number" } } },
    } }]);
    const root = saved.get("recipe");
    const result = h.evaluateLocusCard(root, saved, session);
    expect(h.syncCalls()).toBe(1);
    expect(result.result).toBe("public");
    const unchanged = h.evaluateLocusCard({ kind: "literal", value: 42 }, new Map(), session);
    expect(unchanged.result).toBe(42);
    expect(h.syncCalls()).toBe(1);
  });

  test("ordinary EarlyReadValue evaluation preserves the source facade and its cache generation", async () => {
    const h = harness(), session = {}, expression = node(), saved = new Map();
    let capture = h.replaceMetadata(session, 1);
    delete session.captureSourceMetadata;
    const facade = reactiveAuthoringSession(() => session, () => capture);
    const props = { runtime: { session: () => session, captureSourceMetadata: () => capture },
      node: expression, saved, sourceSession: () => facade };
    const view = new Function("props", "createLocusCardEvaluation", `${earlyCode}; return evaluation;`)(props, h.createLocusCardEvaluation);
    await h.reads[0].pending;
    expect(view.value().result).toBe(1);
    expect(h.syncReads[0].session).toBe(session);
    expect(h.syncReads[0].options.sourceMetadata).toBe(capture);
    const cached = h.readLocusCardResult(expression, saved, facade);
    expect(cached.result).toBe(1);
    expect(h.evaluateLocusCard(expression, saved, facade)).toBe(cached);
    expect(h.syncCalls()).toBe(1);
    capture = h.replaceMetadata(session, 2);
    delete session.captureSourceMetadata;
    await h.reads[0].refetch();
    expect(view.value().result).toBe(2);
    expect(h.readLocusCardResult(expression, saved, facade).result).toBe(2);
    expect(h.syncCalls()).toBe(2);
  });

  test("an ordinary reader with a provider cannot silently evaluate its bare base", async () => {
    const h = harness(), session = {}, capture = h.replaceMetadata(session, 1);
    delete session.captureSourceMetadata;
    const props = { runtime: { session: () => session, captureSourceMetadata: () => capture }, node: node(), saved: new Map() };
    expect(() => new Function("props", "createLocusCardEvaluation", `${earlyCode}; return evaluation;`)(props,
      read => { read(); return undefined; })).toThrow("still preparing");
    expect(h.syncCalls()).toBe(0);
  });

  for (const transition of ["replacement", "absence", "unreadable"]) {
    test(`source ${transition} empties all retired cache maps and releases their captured callbacks`, async () => {
      const h = harness();
      const session = { account: { accountId: "a" } }, saved = new Map();
      h.workers.set(session, { token: {} });
      const retired = h.replaceMetadata(session, "generation-a");
      for (let index = 0; index < 3; index++) {
        const expression = { ...node(), fnId: `different-source-${index}` };
        const pending = h.evaluateLocusCard(expression, saved, session);
        h.jobs[index].resolve({ result: `graph-${index}`, trace: [], captures: [] });
        await pending;
      }
      expect(h.retainedEntries(session)).toBe(3);
      expect(h.retainedObservations(session)).toBe(3);
      const oldOwner = h.retainedOwner(session);
      expect(ownerReferences(oldOwner, retired)).toBe(true);
      expect(ownerReferences(oldOwner, retired.current)).toBe(true);
      const oldEntries = oldOwner.entries, oldObservations = oldOwner.observations;
      const pending = h.evaluateLocusCard({ ...node(), fnId: "late-retired-source" }, saved, session);
      const rejected = pending.then(() => undefined, error => error);
      expect(oldEntries.size).toBe(4);
      let current;
      if (transition === "replacement") current = h.replaceMetadata(session, "generation-b");
      else {
        h.closeMetadata(session);
        if (transition === "unreadable") session.captureSourceMetadata = () => { throw new Error("Source owner is unreadable"); };
      }
      expect(h.readLocusCardResult(node(), saved, session)).toBeUndefined();
      expect(h.retainedEntries(session)).toBe(0);
      expect(h.retainedObservations(session)).toBe(0);
      expect(oldEntries.size).toBe(0);
      expect(oldObservations.size).toBe(0);
      expect(ownerReferences(oldOwner, retired)).toBe(false);
      expect(ownerReferences(oldOwner, retired.current)).toBe(false);
      const owner = h.retainedOwner(session);
      expect(owner?.generationToken).toBe(current?.generationToken);
      expect(ownerReferences(owner, retired)).toBe(false);
      expect(ownerReferences(owner, retired.current)).toBe(false);
      h.jobs[3].resolve({ result: "late graph", trace: [], captures: [] });
      expect(await rejected).toBeInstanceOf(Error);
      expect(oldEntries.size).toBe(0);
      expect(h.retainedEntries(session)).toBe(0);
      expect(h.retainedObservations(session)).toBe(0);
    });
  }

  test("unchanged source and worker miss their cached graph when the metadata generation changes", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } }, saved = new Map(), expression = node();
    h.workers.set(session, { token: {} });
    const first = h.replaceMetadata(session, "generation-a");
    const pending = h.evaluateLocusCard(expression, saved, session);
    expect(h.jobs[0].options.sourceMetadata).toBe(first);
    h.jobs[0].resolve({ result: "graph-a", trace: [] });
    const initial = await pending;
    expect(h.readLocusCardResult(expression, saved, session)).toBe(initial);
    const second = h.replaceMetadata(session, "generation-b");
    expect(h.readLocusCardResult(expression, saved, session)).toBeUndefined();
    const refreshed = h.evaluateLocusCard(expression, saved, session);
    expect(h.jobs).toHaveLength(2);
    expect(h.jobs[1].node).toBe(expression);
    expect(h.jobs[1].options.sourceMetadata).toBe(second);
    h.jobs[1].resolve({ result: "graph-b", trace: [] });
    expect((await refreshed).result).toBe("graph-b");
    expect(h.readLocusCardResult(expression, saved, session).result).toBe("graph-b");
  });

  test("a retired source cannot publish its late graph or coalesce with a newer packet", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } }, saved = new Map(), expression = node();
    h.workers.set(session, { token: {} });
    h.replaceMetadata(session, "generation-a");
    const first = h.evaluateLocusCard(expression, saved, session);
    const firstRejected = first.then(() => undefined, error => error);
    const second = h.replaceMetadata(session, "generation-b");
    const current = h.evaluateLocusCard(expression, saved, session);
    expect(h.jobs).toHaveLength(2);
    h.jobs[0].resolve({ result: "late-graph-a", trace: [] });
    const failure = await firstRejected;
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("current reader");
    expect(h.readLocusCardResult(expression, saved, session)).toBeUndefined();
    expect(h.jobs[1].options.sourceMetadata).toBe(second);
    h.jobs[1].resolve({ result: "current-graph-b", trace: [] });
    await current;
    expect(h.readLocusCardResult(expression, saved, session).result).toBe("current-graph-b");
  });

  test("closing a source hides its completed ordinary and captured graph results", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } }, saved = new Map(), expression = node();
    h.workers.set(session, { token: {} });
    h.replaceMetadata(session, "generation-a");
    const pending = h.evaluateLocusCard(expression, saved, session);
    h.jobs[0].resolve({ result: "graph-a", trace: [], captures: [] });
    await pending;
    expect(h.readLocusCardResult(expression, saved, session).result).toBe("graph-a");
    h.closeMetadata(session);
    expect(h.readLocusCardResult(expression, saved, session)).toBeUndefined();
    expect(h.readLocusCardResult(expression, saved, session, { capture: true })).toBeUndefined();
  });

  test("an unreadable source owner refuses evaluation and hides every prior read", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } }, saved = new Map(), expression = node();
    h.workers.set(session, { token: {} });
    h.replaceMetadata(session, "generation-a");
    const pending = h.evaluateLocusCard(expression, saved, session);
    h.jobs[0].resolve({ result: "graph-a", trace: [], captures: [] });
    const observed = await pending;
    session.captureSourceMetadata = () => { throw new Error("Source owner is closed"); };
    expect(h.readLocusCardResult(expression, saved, session)).toBeUndefined();
    expect(h.readLocusCardResult(expression, saved, session, { capture: true })).toBeUndefined();
    expect(h.readLocusCapturedValue(expression, saved, session, expression, observed)).toBeUndefined();
    expect(() => h.evaluateLocusCard(expression, saved, session)).toThrow("Source owner is closed");
    expect(h.jobs).toHaveLength(1);
  });

  test("a mounted graph hides its prior answer while the same AST reads a newer metadata generation", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } }, saved = new Map(), expression = node();
    h.workers.set(session, { token: {} });
    h.replaceMetadata(session, "generation-a");
    const card = h.createLocusCardEvaluation(() => ({ expr: expression, saved, session }));
    h.jobs[0].resolve({ result: "graph-a", trace: [] });
    await h.reads[0].pending;
    expect(card.value().result).toBe("graph-a");
    const second = h.replaceMetadata(session, "generation-b");
    const refresh = h.reads[0].refetch();
    expect(card.value().result).toBeUndefined();
    expect(card.loading()).toBe(true);
    expect(h.jobs[1].options.sourceMetadata).toBe(second);
    h.jobs[1].resolve({ result: "graph-b", trace: [] });
    await refresh;
    expect(card.value().result).toBe("graph-b");
  });

  test("the detached evaluator receives the same admitted packet used by its cache lifetime", () => {
    const h = harness();
    const session = {}, saved = new Map(), expression = node();
    const captured = h.replaceMetadata(session, "generation-a");
    expect(h.evaluateLocusCard(expression, saved, session).result).toBe("generation-a");
    expect(h.syncReads[0].options.sourceMetadata).toBe(captured);
    h.replaceMetadata(session, "generation-b");
    expect(h.evaluateLocusCard(expression, saved, session).result).toBe("generation-b");
    expect(h.syncCalls()).toBe(2);
  });

  test("the ordinary answer keeps its steps for Graph without another worker run", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } }, saved = new Map();
    h.workers.set(session, { token: {} });
    const words = { kind: "call", fnId: "words", args: [{ kind: "literal", value: "one two" }] };
    const reverse = { kind: "call", fnId: "reverse", args: [words] };
    const root = { kind: "call", fnId: "join", args: [reverse, { kind: "literal", value: " " }] };
    const sites = [];
    exprNodeToLogic(root, { onExpression: node => sites.push(node) });
    const normal = h.evaluateLocusCard(root, saved, session);
    expect(h.jobs[0].options).toEqual({ capture: true, cardEvaluation: true });
    h.jobs[0].resolve({ result: "two one", trace: [], captures: [
      { site: sites.indexOf(words), value: ["one", "two"] },
      { site: sites.indexOf(reverse), value: ["two", "one"] },
    ] });
    const answer = await normal;
    expect(answer).toEqual({ result: "two one", trace: [] });
    expect(h.readLocusCardResult(root, saved, session)).toBe(answer);
    const observed = h.readLocusCardResult(root, saved, session, { capture: true });
    const graph = h.createLocusCardEvaluation(() => ({ expr: root, saved, session, transient: true, capture: true, observed }));
    expect(graph.loading()).toBe(false);
    expect(graph.value()).toBe(observed);
    await h.reads[0].pending;
    expect(h.readLocusCapturedValue(root, saved, session, words, graph.value())).toEqual({ value: ["one", "two"] });
    expect(h.readLocusCapturedValue(root, saved, session, reverse, graph.value())).toEqual({ value: ["two", "one"] });
    expect(h.jobs).toHaveLength(1);
  });

  test("a selected graph projects the same exact call from the enclosing ordinary record", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } }, saved = new Map();
    h.workers.set(session, { token: {} });
    const input = { kind: "call", fnId: "words", args: [{ kind: "literal", value: "one two" }] };
    const selected = { kind: "call", fnId: "reverse", args: [input] };
    const root = { kind: "literal", value: { __record: { fields: [
      { name: "First", value: { kind: "literal", value: 17 } }, { name: "Words", value: selected },
    ] } } };
    const sites = [];
    exprNodeToLogic(root, { onExpression: node => sites.push(node) });
    const pending = h.evaluateLocusCard(root, saved, session);
    h.jobs[0].resolve({ result: { First: 17, Words: ["two", "one"] }, trace: [], captures: [
      { site: sites.indexOf(input), value: ["one", "two"] }, { site: sites.indexOf(selected), value: ["two", "one"] },
    ] });
    await pending;
    const observed = h.readLocusCardResult(selected, saved, session, { capture: true });
    expect(observed.result).toEqual(["two", "one"]);
    expect(h.readLocusCapturedValue(selected, saved, session, input, observed)).toEqual({ value: ["one", "two"] });
    expect(h.readLocusCardResult(structuredClone(selected), saved, session, { capture: true })).toBeUndefined();
    expect(h.jobs).toHaveLength(1);
    expect(h.retainedEntries(session)).toBe(1);
    const next = h.evaluateLocusCard(node(), saved, session);
    h.jobs[1].resolve({ result: "next", trace: [], captures: [] });
    await next;
    expect(h.readLocusCardResult(selected, saved, session, { capture: true }).result).toEqual(["two", "one"]);
    expect(h.readLocusCapturedValue(selected, saved, session, input,
      h.readLocusCardResult(selected, saved, session, { capture: true }))).toEqual({ value: ["one", "two"] });
    expect(h.readLocusCardResult(root, saved, session).result.Words).toEqual(["two", "one"]);
    expect(h.retainedEntries(session)).toBe(2);
  });

  test("Graph shares its in-flight ordinary root instead of posting the same execution twice", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } }, saved = new Map();
    h.workers.set(session, { token: {} });
    const child = { kind: "call", fnId: "words", args: [{ kind: "literal", value: "one two" }] };
    const root = { kind: "call", fnId: "reverse", args: [child] };
    const sites = [];
    exprNodeToLogic(root, { onExpression: node => sites.push(node) });
    const normal = h.evaluateLocusCard(root, saved, session);
    const graph = h.evaluateLocusCard(root, saved, session, { capture: true, transient: true });
    expect(h.jobs).toHaveLength(1);
    h.jobs[0].resolve({ result: ["two", "one"], trace: [], captures: [{ site: sites.indexOf(child), value: ["one", "two"] }] });
    await normal;
    const result = await graph;
    expect(h.readLocusCapturedValue(root, saved, session, child, result)).toEqual({ value: ["one", "two"] });
    expect(h.jobs).toHaveLength(1);
  });

  test("captured root retention is bounded and preserves final answers after eviction", async () => {
    const h = harness(), session = { account: { accountId: "a" } }, saved = new Map();
    h.workers.set(session, { token: {} });
    const roots = [];
    for (let index = 0; index < 20; index++) {
      const root = { kind: "call", fnId: "identity", args: [{ kind: "literal", value: index }] };
      roots.push(root);
      const pending = h.evaluateLocusCard(root, saved, session);
      h.jobs.at(-1).resolve({ result: index, trace: [], captures: [] });
      await pending;
    }
    expect(h.retainedObservations(session)).toBe(16);
    expect(h.readLocusCardResult(roots[0], saved, session).result).toBe(0);
    expect(h.readLocusCardResult(roots[0], saved, session, { capture: true })).toBeUndefined();
    expect(h.readLocusCardResult(roots.at(-1), saved, session, { capture: true }).result).toBe(19);
  });

  test("a child shared by different containing runs does not select a guessed lexical result", async () => {
    const h = harness(), session = { account: { accountId: "a" } }, saved = new Map();
    h.workers.set(session, { token: {} });
    const child = { kind: "call", fnId: "identity", args: [] };
    for (let index = 0; index < 2; index++) {
      const root = { kind: "call", fnId: `outer${index}`, args: [child] };
      const sites = [];
      exprNodeToLogic(root, { onExpression: node => sites.push(node) });
      const pending = h.evaluateLocusCard(root, saved, session);
      h.jobs.at(-1).resolve({ result: index, trace: [], captures: [{ site: sites.indexOf(child), value: index }] });
      await pending;
    }
    expect(h.readLocusCardResult(child, saved, session, { capture: true })).toBeUndefined();
  });

  test("ordinary retained steps refuse changed source, saved bindings, reader, worker and login", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    const savedInput = { kind: "ref", savedExprId: "source" };
    const root = { kind: "call", fnId: "identity", args: [savedInput] };
    const saved = new Map([["source", { kind: "literal", value: "original" }]]);
    const pending = h.evaluateLocusCard(root, saved, session);
    h.jobs[0].resolve({ result: "original", trace: [], captures: [] });
    await pending;
    expect(h.readLocusCardResult(root, saved, session, { capture: true }).result).toBe("original");
    expect(h.readLocusCardResult(root, new Map([["source", { kind: "literal", value: "changed" }]]), session, { capture: true })).toBeUndefined();
    expect(h.readLocusCardResult(root, saved, { account: { accountId: "b" } }, { capture: true })).toBeUndefined();
    expect(h.readLocusCardResult({ ...root }, saved, session, { capture: true })).toBeUndefined();
    root.fnId = "other";
    expect(h.readLocusCardResult(root, saved, session, { capture: true })).toBeUndefined();
    root.fnId = "identity";
    h.workers.set(session, { token: {} });
    expect(h.readLocusCardResult(root, saved, session, { capture: true })).toBeUndefined();
    const current = h.evaluateLocusCard(root, saved, session);
    h.jobs[1].resolve({ result: "current", trace: [], captures: [] });
    await current;
    expect(h.readLocusCardResult(root, saved, session, { capture: true }).result).toBe("current");
    h.changeLogin();
    expect(h.readLocusCardResult(root, saved, session, { capture: true })).toBeUndefined();
    expect(h.jobs).toHaveLength(2);
  });

  test("ordinary sampled media inside an enclosing record does not retain or request full steps", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    const media = { kind: "call", fnId: "sound:renderSound", args: [] };
    const root = { kind: "literal", value: { __record: { fields: [{ name: "Sound", value: media }] } } };
    const saved = new Map();
    const pending = h.evaluateLocusCard(root, saved, session);
    expect(h.jobs[0].options).toEqual({ capture: false, cardEvaluation: true });
    h.jobs[0].resolve({ result: { Sound: "samples" }, trace: [] });
    await pending;
    expect(h.readLocusCardResult(root, saved, session, { capture: true })).toBeUndefined();
    expect(h.readLocusCardResult(media, saved, session, { capture: true })).toBeUndefined();
  });

  test("a transient graph owns fresh observations without retaining them or replacing the ordinary result", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    const child = { kind: "call", fnId: "identity", args: [{ kind: "literal", value: "input" }] };
    const root = { kind: "call", fnId: "combine", args: [child] };
    const saved = new Map();
    const normal = h.evaluateLocusCard(root, saved, session);
    const original = { result: "earlier", trace: [] };
    h.jobs[0].resolve(original);
    await normal;
    const sites = [];
    exprNodeToLogic(root, { onExpression: node => sites.push(node) });
    const abort = new AbortController();
    const graph = h.evaluateLocusCard(root, saved, session, { capture: true, transient: true, signal: abort.signal });
    expect(h.jobs).toHaveLength(2);
    expect(h.jobs[1].signal).toBe(abort.signal);
    expect(h.jobs[1].options).toEqual({ capture: true, cardEvaluation: true });
    const observed = { result: "fresh", trace: [], captures: [{ site: sites.indexOf(child), value: "actual input" }] };
    h.jobs[1].resolve(observed);
    const result = await graph;
    expect(h.readLocusCapturedValue(root, saved, session, root, result)).toEqual({ value: "fresh" });
    expect(h.readLocusCapturedValue(root, saved, session, child, result)).toEqual({ value: "actual input" });
    expect(h.readLocusCardResult(root, saved, session)).toBe(original);
    expect(h.readLocusCardResult(root, saved, session, { capture: true })).toBeUndefined();
    expect(h.retainedEntries(session)).toBe(1);
  });

  test("successive edited graph runs and their released consumer leave no retained graph entries", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    const saved = new Map();
    for (let edit = 0; edit < 12; edit++) {
      const expr = { kind: "call", fnId: "identity", args: [{ kind: "literal", value: edit }] };
      const pending = h.evaluateLocusCard(expr, saved, session, { capture: true, transient: true });
      h.jobs.at(-1).resolve({ result: edit, trace: [], captures: [] });
      expect((await pending).result).toBe(edit);
      expect(h.readLocusCardResult(expr, saved, session)).toBeUndefined();
      expect(h.readLocusCardResult(expr, saved, session, { capture: true })).toBeUndefined();
      expect(h.retainedEntries(session)).toBe(0);
    }
    let input = { expr: node(), saved, session, capture: true, transient: true };
    const graph = h.createLocusCardEvaluation(() => input);
    h.jobs.at(-1).resolve({ result: "current graph", trace: [], captures: [] });
    await h.reads[0].pending;
    expect(graph.value().result).toBe("current graph");
    input = { ...input, expr: undefined, skip: true };
    await h.reads[0].refetch();
    expect(graph.value()).toEqual({ result: undefined, trace: [] });
    expect(h.retainedEntries(session)).toBe(0);
  });

  test("a transient graph refuses late data after abort or worker replacement", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    const expr = node(), saved = new Map(), abort = new AbortController();
    const closing = h.evaluateLocusCard(expr, saved, session, { capture: true, transient: true, signal: abort.signal });
    abort.abort();
    h.jobs[0].resolve({ result: "closed", trace: [], captures: [] });
    await expect(closing).rejects.toThrow();
    const replaced = h.evaluateLocusCard(expr, saved, session, { capture: true, transient: true });
    h.workers.set(session, { token: {} });
    h.jobs[1].resolve({ result: "old reader", trace: [], captures: [] });
    await expect(replaced).rejects.toThrow("replaced");
    expect(h.retainedEntries(session)).toBe(0);
  });

  test("transient sampled media keeps its ordinary worker route and offers only its actual final result", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    const picture = { kind: "call", fnId: "picture:render", args: [{ kind: "literal", value: "field" }] };
    const saved = new Map();
    const pending = h.evaluateLocusCard(picture, saved, session, { capture: true, transient: true });
    await Promise.resolve();
    expect(h.jobs).toHaveLength(1);
    expect(h.jobs[0].options).toEqual({ capture: false, cardEvaluation: true });
    const output = { width: 1, height: 1, pixels: [] };
    h.jobs[0].resolve({ result: output, trace: [] });
    const observed = await pending;
    expect(h.readLocusCapturedValue(picture, saved, session, picture, observed)).toEqual({ value: output });
    expect(h.readLocusCapturedValue(picture, saved, session, picture.args[0], observed)).toBeUndefined();
    expect(h.retainedEntries(session)).toBe(0);
  });

  test("captured child reads share one root run and expire with reader, body, worker and login", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    const first = { kind: "call", fnId: "identity", args: [{ kind: "literal", value: "first" }] };
    const second = { kind: "call", fnId: "identity", args: [{ kind: "literal", value: "second" }] };
    const root = { kind: "call", fnId: "combine", args: [first, second] };
    const sites = [];
    exprNodeToLogic(root, { onExpression: node => sites.push(node) });
    const saved = new Map();
    const pending = h.evaluateLocusCard(root, saved, session, { capture: true });
    expect(h.jobs).toHaveLength(1);
    expect(h.jobs[0].options).toEqual({ capture: true, cardEvaluation: true });
    expect(h.readLocusCapturedValue(root, saved, session, first)).toBeUndefined();
    h.jobs[0].resolve({ result: "combined", trace: [], captures: [
      { site: sites.indexOf(first), value: "first" }, { site: sites.indexOf(second), value: "second" },
    ] });
    await pending;
    expect(h.readLocusCapturedValue(root, saved, session, first)).toEqual({ value: "first" });
    expect(h.readLocusCapturedValue(root, saved, session, second)).toEqual({ value: "second" });
    expect(h.readLocusCapturedValue(root, new Map(), session, first)).toEqual({ value: "first" });
    expect(h.readLocusCardResult(root, saved, session)).toBeUndefined();
    expect(h.evaluateLocusCard(root, saved, session, { capture: true }).result).toBe("combined");
    expect(h.jobs).toHaveLength(1);
    expect(h.readLocusCapturedValue({ ...root }, saved, session, first)).toBeUndefined();
    expect(h.readLocusCapturedValue({ ...root, args: [first] }, saved, session, first)).toBeUndefined();
    expect(h.readLocusCapturedValue(root, saved, { account: session.account }, first)).toBeUndefined();
    h.workers.set(session, { token: {} });
    expect(h.readLocusCapturedValue(root, saved, session, first)).toBeUndefined();
    h.changeLogin();
    expect(h.readLocusCapturedValue(root, saved, session, first)).toBeUndefined();
    expect(h.jobs).toHaveLength(1);
  });

  test("shared source objects in different occurrences refuse a single ambiguous value", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    const shared = { kind: "call", fnId: "identity", args: [] };
    const root = { kind: "call", fnId: "combine", args: [shared, shared] };
    const sites = [];
    exprNodeToLogic(root, { onExpression: node => sites.push(node) });
    const pending = h.evaluateLocusCard(root, new Map(), session, { capture: true });
    h.jobs[0].resolve({ result: "combined", trace: [], captures: [{ site: sites.indexOf(shared), value: "first" }] });
    await pending;
    expect(h.readLocusCapturedValue(root, new Map(), session, shared)).toBeUndefined();
    expect(h.jobs).toHaveLength(1);
  });

  test("changing a source body invalidates a transitive saved-reference result", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    const doubled = { kind: "call", fnId: "std:mul", args: [
      { kind: "ref", savedExprId: "source" }, { kind: "literal", value: 2 },
    ] };
    const result = { kind: "call", fnId: "std:add", args: [
      { kind: "ref", savedExprId: "doubled" }, { kind: "literal", value: 1 },
    ] };
    const reference = { kind: "ref", savedExprId: "result" };
    const original = new Map([
      ["source", { kind: "literal", value: 10 }], ["doubled", doubled], ["result", result],
    ]);
    const first = h.evaluateLocusCard(reference, original, session);
    expect(h.jobs).toHaveLength(1);
    h.jobs[0].resolve({ result: 21, trace: [] });
    const settled = await first;
    expect(h.readLocusCardResult(reference, original, session)).toBe(settled);

    // A refreshed source map keeps every reference and the two derived bodies.
    const edited = new Map(original);
    edited.set("source", { kind: "literal", value: 20 });
    expect(edited.get("doubled")).toBe(doubled);
    expect(edited.get("result")).toBe(result);
    expect(h.readLocusCardResult(reference, edited, session)).toBeUndefined();
    const next = h.evaluateLocusCard(reference, edited, session);
    expect(h.jobs).toHaveLength(2);
    expect(h.jobs[1].node).toBe(reference);
    expect(h.jobs[1].saved).toBe(edited);
    h.jobs[1].resolve({ result: 41, trace: [] });
    const updated = await next;
    expect(updated.result).toBe(41);
    expect(h.readLocusCardResult(reference, edited, session)).toBe(updated);

    const unchanged = new Map(edited);
    unchanged.set("unrelated", { kind: "literal", value: 99 });
    expect(h.evaluateLocusCard(reference, unchanged, session)).toBe(updated);
    expect(h.jobs).toHaveLength(2);
    expect(h.readLocusCardResult(reference, original, session)).toBe(settled);
  });

  test("a source inside a structural list invalidates the completed card result", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    const list = { kind: "literal", value: { __list: [
      { kind: "ref", savedExprId: "source" }, { kind: "literal", value: 1 },
    ] } };
    const reference = { kind: "ref", savedExprId: "list" };
    const original = new Map([["source", { kind: "literal", value: 10 }], ["list", list]]);
    const first = h.evaluateLocusCard(reference, original, session);
    expect(h.jobs).toHaveLength(1);
    h.jobs[0].resolve({ result: [10, 1], trace: [] });
    const settled = await first;
    expect(h.readLocusCardResult(reference, original, session)).toBe(settled);

    const edited = new Map(original);
    edited.set("source", { kind: "literal", value: 20 });
    expect(edited.get("list")).toBe(list);
    expect(h.readLocusCardResult(reference, edited, session)).toBeUndefined();
    const next = h.evaluateLocusCard(reference, edited, session);
    expect(h.jobs).toHaveLength(2);
    expect(h.jobs[1].saved).toBe(edited);
    h.jobs[1].resolve({ result: [20, 1], trace: [] });
    const updated = await next;
    expect(updated.result).toEqual([20, 1]);
    expect(h.readLocusCardResult(reference, edited, session)).toBe(updated);

    const unchanged = new Map(edited);
    unchanged.set("unrelated", { kind: "literal", value: 99 });
    expect(h.evaluateLocusCard(reference, unchanged, session)).toBe(updated);
    expect(h.jobs).toHaveLength(2);
    expect(h.readLocusCardResult(reference, original, session)).toBe(settled);
  });

  test("sibling consumers share a plain job/result without a consumer-owned cancellation signal", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } }, expr = node(), saved = new Map();
    h.workers.set(session, { token: {} });
    const first = h.evaluateLocusCard(expr, saved, session);
    const sibling = h.evaluateLocusCard(expr, saved, session);
    expect(sibling).toBe(first);
    expect(h.jobs).toHaveLength(1);
    expect(h.jobs[0].signal).toBeUndefined();
    h.jobs[0].resolve({ result: [1, 2], trace: [] });
    const completed = await sibling;
    expect(h.evaluateLocusCard(expr, saved, session)).toBe(completed);
    expect(h.readLocusCardResult(expr, saved, session)).toBe(completed);
    // Another lens holds the same library in a different map object.
    expect(h.evaluateLocusCard(expr, new Map(), session)).toBe(completed);
    expect(h.jobs).toHaveLength(1);
    const changed = h.evaluateLocusCard({ kind: "ref", savedExprId: "plot" }, new Map([["plot", { kind: "call", fnId: "example:other", args: [] }]]), session);
    expect(h.jobs).toHaveLength(2);
    h.jobs[1].resolve({ result: "new references", trace: [] });
    await changed;
  });

  test("copies of one picture share a single render", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    const picture = { kind: "call", fnId: "picture:render", args: [{ kind: "literal", value: 1 }] };
    const copy = { kind: "call", fnId: "picture:render", args: [{ kind: "literal", value: 1 }] };
    h.workers.set(session, { token: {} });
    const first = h.evaluateLocusCard(picture, new Map(), session);
    const second = h.evaluateLocusCard(copy, new Map([["unused", { kind: "literal", value: 0 }]]), session);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(h.jobs).toHaveLength(1);
    h.jobs[0].resolve({ result: "raster", trace: [] });
    expect((await first).result).toBe("raster");
    const ref = { kind: "ref", savedExprId: "plot" };
    expect(h.evaluateLocusCard(ref, new Map([["plot", copy]]), session)).toEqual({ result: "raster", trace: [] });
    expect(h.jobs).toHaveLength(1);
  });

  test("saved data literals paint without the editing worker", () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    const saved = new Map([
      ["token", { kind: "literal", value: "ok" }],
      ["pin", { kind: "literal", value: { $pin: "function", id: "example:pin", name: "pin" } }],
    ]);
    expect(h.evaluateLocusCard({ kind: "ref", savedExprId: "token" }, saved, session).result).toBe("ok");
    expect(h.evaluateLocusCard({ kind: "ref", savedExprId: "pin" }, saved, session).result).toEqual({ $pin: "function", id: "example:pin", name: "pin" });
    expect(h.evaluateLocusCard({ kind: "literal", value: false }, saved, session).result).toBe(false);
    expect(h.jobs).toHaveLength(0);
    const pending = h.evaluateLocusCard({ kind: "literal", value: { construct: ["Field", 1] } }, saved, session);
    expect(pending).toBeInstanceOf(Promise);
    expect(h.jobs).toHaveLength(1);
  });

  test("a saved image pointer paints without waiting for the editing worker", () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    const photo = { kind: "call", fnId: "std:imageInvert", args: [] };
    const saved = new Map([["book", photo]]);
    const result = h.evaluateLocusCard({ kind: "ref", savedExprId: "book" }, saved, session);
    expect(result.result.width).toBe(96);
    expect(h.jobs).toHaveLength(0);
  });

  test("retiring or replacing a worker invalidates a completed cache entry in the same login", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } }, expr = node(), saved = new Map();
    const binding = { token: {}, closed: false };
    h.workers.set(session, binding);
    const first = h.evaluateLocusCard(expr, saved, session);
    h.jobs[0].resolve({ result: "old", trace: [] });
    await first;
    binding.closed = true;
    expect(() => h.evaluateLocusCard(expr, saved, session)).toThrow("retired");
    expect(() => h.readLocusCardResult(expr, saved, session)).toThrow("retired");
    h.workers.set(session, { token: {} });
    const replacement = h.evaluateLocusCard(expr, saved, session);
    expect(h.jobs).toHaveLength(2);
    h.jobs[1].resolve({ result: "current", trace: [] });
    expect((await replacement).result).toBe("current");
  });

  test("late results and failed jobs are never promoted into a replacement reader", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } }, expr = node(), saved = new Map();
    h.workers.set(session, { token: {} });
    const stale = h.evaluateLocusCard(expr, saved, session);
    h.workers.set(session, { token: {} });
    h.jobs[0].resolve({ result: "stale", trace: [] });
    await expect(stale).rejects.toThrow("replaced");
    const failed = h.evaluateLocusCard(expr, saved, session);
    h.jobs[1].reject(new Error("Worker failed"));
    await expect(failed).rejects.toThrow("Worker failed");
    const retry = h.evaluateLocusCard(expr, saved, session);
    expect(h.jobs).toHaveLength(3);
    h.jobs[2].resolve({ result: "retry", trace: [] });
    expect((await retry).result).toBe("retry");
    expect(h.syncCalls()).toBe(0);
  });

  test("only a detached session without an attached worker may use the existing public evaluator", () => {
    const h = harness();
    const expr = node(), saved = new Map();
    expect(() => h.evaluateLocusCard(expr, saved, { account: { accountId: "private" } })).toThrow("no longer available");
    const foreign = {};
    h.workers.set(foreign, { token: {}, ineligible: true });
    expect(() => h.evaluateLocusCard(expr, saved, foreign)).toThrow("do not match");
    expect(h.syncCalls()).toBe(0);
    expect(h.evaluateLocusCard(expr, saved, {}).result).toBe("public");
    expect(h.syncCalls()).toBe(1);
  });
});

describe("a frameless (Local) session's cards leave every media decision to its worker (B4 wave 4 lane S)", () => {
  test("cards send capture unless-sampled, explicit captures stay explicit, and no page evaluation or media decision runs", async () => {
    const h = harness(), session = { frameless: true }, saved = new Map();
    h.workers.set(session, { token: {} });
    const ordinary = h.evaluateLocusCard(node(), saved, session);
    expect(h.jobs).toHaveLength(1);
    expect(h.jobs[0].options).toEqual({ capture: "unless-sampled", cardEvaluation: true });
    // A picture card is not held back on the page: its worker weighs it.
    const picture = { kind: "call", fnId: "picture:render", args: [{ kind: "literal", value: "field" }] };
    const painted = h.evaluateLocusCard(picture, saved, session);
    expect(h.jobs).toHaveLength(2);
    expect(h.jobs[1].options).toEqual({ capture: "unless-sampled", cardEvaluation: true });
    const graphed = { kind: "call", fnId: "graphed", args: [] };
    const graph = h.evaluateLocusCard(graphed, saved, session, { capture: true, transient: true });
    expect(h.jobs[2].options).toEqual({ capture: "unless-sampled", cardEvaluation: true });
    const explicit = h.evaluateLocusCard({ kind: "call", fnId: "explicit", args: [] }, saved, session, { capture: true });
    expect(h.jobs[3].options).toEqual({ capture: true, cardEvaluation: true });
    const transient = h.evaluateLocusCard({ kind: "call", fnId: "transient", args: [] }, saved, session, { transient: true });
    expect(h.jobs[4].options).toEqual({ capture: false, cardEvaluation: true });
    for (const job of h.jobs) job.resolve({ result: job.node.fnId, trace: [] });
    expect((await ordinary).result).toBe("example");
    expect((await painted).result).toBe("picture:render");
    expect((await graph).result).toBe("graphed");
    await explicit; await transient;
    expect(h.syncCalls()).toBe(0);
  });

  test("a Graph sharing a frameless sampled-media run that recorded nothing gets its plain answer", async () => {
    const h = harness(), session = { frameless: true }, saved = new Map();
    h.workers.set(session, { token: {} });
    const picture = { kind: "call", fnId: "picture:render", args: [{ kind: "literal", value: "field" }] };
    const normal = h.evaluateLocusCard(picture, saved, session);
    const graph = h.evaluateLocusCard(picture, saved, session, { capture: true, transient: true });
    expect(h.jobs).toHaveLength(1);
    const output = { width: 1, height: 1, pixels: [] };
    h.jobs[0].resolve({ result: output, trace: [] });
    expect((await normal).result).toBe(output);
    expect((await graph).result).toBe(output);
    expect(h.syncCalls()).toBe(0);
  });

  test("a frameless session's page media facts are neutral and read neither its frame nor its registry", () => {
    const registry = new Proxy({}, { get() { throw new Error("A page registry read"); } });
    const session = inertAuthoringSession({ mode: "detached", registry, catalog: {},
      environment: { functionCodeName: id => id, constructorCodeName: () => undefined } });
    const picture = { kind: "call", fnId: "picture:render", args: [{ kind: "literal", value: "field" }] };
    expect(expressionMediaScheduling(picture, new Map(), session)).toEqual({ picture: false, sampled: false, weight: 0 });
    expect(expressionRendersPicture(picture, new Map(), session)).toBe(false);
    expect(expressionRendersSampledMedia(picture, new Map(), session)).toBe(false);
  });

  test("without an attached worker a frameless card refuses instead of evaluating on the page", () => {
    const h = harness(), session = { frameless: true };
    expect(() => h.evaluateLocusCard(node(), new Map(), session)).toThrow("editing tools are not ready");
    expect(h.syncCalls()).toBe(0);
  });
});

describe("card consumers use the current reader's completed result", () => {
  test("same expression in a replacement reader never displays the prior reader while pending", async () => {
    const h = harness();
    const firstSession = { account: { accountId: "a" } };
    const nextSession = { account: { accountId: "a" } };
    h.workers.set(firstSession, { token: {} });
    h.workers.set(nextSession, { token: {} });
    let input = { expr: node(), saved: new Map(), session: firstSession };
    const card = h.createLocusCardEvaluation(() => input);
    h.jobs[0].resolve({ result: "reader A", trace: [] });
    await h.reads[0].pending;
    expect(card.value().result).toBe("reader A");

    input = { ...input, session: nextSession };
    const replacement = h.reads[0].refetch();
    expect(h.jobs).toHaveLength(2);
    expect(card.value().result).toBeUndefined();
    expect(card.loading()).toBe(true);
    h.jobs[1].resolve({ result: "reader B", trace: [] });
    await replacement;
    expect(card.value().result).toBe("reader B");
    expect(card.loading()).toBe(false);
  });

  test("worker retirement, replacement and login ABA invalidate the consumer's completed result", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    const binding = { token: {}, closed: false };
    h.workers.set(session, binding);
    const input = { expr: node(), saved: new Map(), session };
    const card = h.createLocusCardEvaluation(() => input);
    h.jobs[0].resolve({ result: "old worker", trace: [] });
    await h.reads[0].pending;
    binding.closed = true;
    // A retired worker is replaced by a publication or restoration: the card
    // drops the old result and stays pending; it never answers with a failure.
    void h.reads[0].refetch();
    await Promise.resolve();
    expect(card.value().result).toBeUndefined();
    expect(card.value().error).toBeUndefined();
    expect(card.loading()).toBe(true);
    expect(h.jobs).toHaveLength(1);

    h.workers.set(session, { token: {} });
    const replaced = h.reads[0].refetch();
    expect(card.value().result).toBeUndefined();
    h.jobs[1].resolve({ result: "replacement worker", trace: [] });
    await replaced;
    expect(card.value().result).toBe("replacement worker");

    h.changeLogin();
    const loggedInAgain = h.reads[0].refetch();
    expect(h.jobs).toHaveLength(3);
    expect(card.value().result).toBeUndefined();
    h.jobs[2].resolve({ result: "new login", trace: [] });
    await loggedInAgain;
    expect(card.value().result).toBe("new login");
  });

  test("a retirement landing during an evaluation keeps the card pending, not failed", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    const binding = { token: {}, closed: false };
    h.workers.set(session, binding);
    const card = h.createLocusCardEvaluation(() => ({ expr: node(), saved: new Map(), session }));
    binding.closed = true;
    h.jobs[0].reject(new Error("This authoring snapshot was replaced. Retry with the current data."));
    for (let tick = 0; tick < 6; tick++) await Promise.resolve();
    expect(card.value().error).toBeUndefined();
    expect(card.loading()).toBe(true);
  });

  test("a quiet refresh keeps the exact cached result but changed data hides it", async () => {
    const h = harness();
    const session = { account: { accountId: "a" } };
    h.workers.set(session, { token: {} });
    let input = { expr: node(), saved: new Map(), session };
    const card = h.createLocusCardEvaluation(() => input);
    const result = { result: "same data", trace: [] };
    h.jobs[0].resolve(result);
    await h.reads[0].pending;
    const quiet = card.retry();
    expect(card.value()).toBe(result);
    expect(card.loading()).toBe(false);
    await quiet;
    expect(h.jobs).toHaveLength(1);

    input = { ...input, expr: { ...node(), fnId: "changed" } };
    const changed = h.reads[0].refetch();
    expect(card.value().result).toBeUndefined();
    h.jobs[1].resolve({ result: "changed data", trace: [] });
    await changed;
    expect(card.value().result).toBe("changed data");
  });

  test("an earlier valid reader completing late cannot replace the current reader's display", async () => {
    const h = harness();
    const firstSession = { account: { accountId: "a" } };
    const nextSession = { account: { accountId: "b" } };
    h.workers.set(firstSession, { token: {} });
    h.workers.set(nextSession, { token: {} });
    let input = { expr: node(), saved: new Map(), session: firstSession };
    const card = h.createLocusCardEvaluation(() => input);
    const earlier = h.reads[0].pending;
    input = { ...input, session: nextSession };
    const current = h.reads[0].refetch();
    h.jobs[0].resolve({ result: "late A", trace: [] });
    await earlier;
    expect(card.value().result).toBeUndefined();
    h.jobs[1].resolve({ result: "current B", trace: [] });
    await current;
    expect(card.value().result).toBe("current B");
    expect(h.jobs).toHaveLength(2);
  });
});
