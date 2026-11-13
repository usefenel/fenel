import { describe, expect, test } from "bun:test";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import type { ReaderRuntime } from "./reader-runtime";
import type { LocusAddressReader } from "./locus-address-reader";

// Execute the production transport boundary, not a second address matcher or
// evaluator. Cache uniqueness, expression-site traversal and authority remain
// owned by the ordinary card library; these fixtures hold only its interfaces.
const source = await Bun.file(new URL("./locus-address-reader.ts", import.meta.url)).text();
const start = source.indexOf("export function locusAddressReader(");
if (start < 0) throw new Error("The addressed reader production boundary changed.");
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start)).replace(/^export /gm, "");
const facadeSource = await Bun.file(new URL("./expression-runner/account-authoring-session.ts", import.meta.url)).text();
const facadeStart = facadeSource.indexOf("const facadeSources ="), facadeEnd = facadeSource.indexOf("export type AccountAuthoringScope", facadeStart);
if (facadeStart < 0 || facadeEnd < 0) throw new Error("Address facade identity boundary moved");
const { reactiveAuthoringSession, concreteAuthoringSession } = new Function("untrack", new Bun.Transpiler({ loader: "ts" })
  .transformSync(facadeSource.slice(facadeStart, facadeEnd)).replace(/^export /gm, "")
  + "; return { reactiveAuthoringSession, concreteAuthoringSession };")((read: () => unknown) => read());

type CardResult = { result: unknown; trace: readonly unknown[]; error?: string };
const call: ExprNode = { kind: "call", fnId: "probe:collection", args: [] };
const savedRef: ExprNode = { kind: "ref", savedExprId: "saved-collection" };
const result: CardResult = { result: ["first", "second"], trace: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function harness() {
  const events: string[] = [];
  const cacheReads: Array<{ node: ExprNode; saved: ReadonlyMap<string, ExprNode>; session: AuthoringSession; capture: boolean }> = [];
  const evaluationCalls: Array<{ node: ExprNode; saved: ReadonlyMap<string, ExprNode>; session: AuthoringSession }> = [];
  const representations: Array<[string, string]> = [];
  const childTypes: unknown[][] = [];
  const saved = new Map([["saved-collection", call]]);
  let globalFunctionLookups = 0;
  let session = { fixture: "reader-a", registry: { getFunction: () => {
    globalFunctionLookups++; return { id: "probe:collection", tags: ["io"] };
  } } } as unknown as AuthoringSession;
  const originalSession = session;
  let revision = 7;
  let current = true;
  let available = true;
  let worker = true;
  let capture: CardResult | undefined;
  let normal: CardResult | undefined;
  let readyGate: Promise<void> | undefined;
  let evaluateGate: Promise<CardResult> | undefined;
  let sites: Array<{ node: ExprNode }> = [{ node: call }];
  let rootChecks = 0;
  let rootCheck: (number: number) => void | Promise<void> = () => {};
  let representation: (name: string, id: string) => unknown = () => undefined;
  let inspectSites: (resolve: (id: string) => ExprNode | undefined) => void = () => {};
  const readyStarted = deferred<void>();
  const evaluationStarted = deferred<void>();
  const reader = {
    session: () => session,
    revision: () => revision,
    representation: (name: string, id: string) => {
      representations.push([name, id]);
      return representation(name, id);
    },
  } as unknown as ReaderRuntime;
  let currentReader = reader;
  const bindings = {
    reactiveAuthoringSession,
    readLocusCardResult: (node: ExprNode, observedSaved: ReadonlyMap<string, ExprNode>, observedSession: AuthoringSession,
      options?: { capture?: boolean }) => {
      const captured = !!options?.capture;
      cacheReads.push({ node, saved: observedSaved, session: observedSession, capture: captured });
      events.push(captured ? "cache:capture" : "cache:normal");
      return captured ? capture : normal;
    },
    authoringExpressionSites: (node: ExprNode, resolve: (id: string) => ExprNode | undefined, observedSession: AuthoringSession) => {
      expect(node).toBe(call === node ? call : savedRef);
      expect(concreteAuthoringSession(observedSession)).toBe(session);
      events.push("sites"); inspectSites(resolve);
      return { sites };
    },
    authoringWorkerSnapshot: (observedSession: AuthoringSession) => {
      expect(concreteAuthoringSession(observedSession)).toBe(session); events.push("worker");
      return worker ? { worker: "existing reader worker" } : undefined;
    },
    evaluateLocusCard: async (node: ExprNode, observedSaved: ReadonlyMap<string, ExprNode>, observedSession: AuthoringSession) => {
      evaluationCalls.push({ node, saved: observedSaved, session: observedSession });
      events.push("evaluate"); evaluationStarted.resolve();
      return evaluateGate ? await evaluateGate : result;
    },
    childValueType: (...args: unknown[]) => { childTypes.push(args); return { $ref: "ChildFixture" }; },
  };
  const create = new Function(...Object.keys(bindings), `${code}; return locusAddressReader;`)(...Object.values(bindings)) as
    typeof import("./locus-address-reader").locusAddressReader;
  const address: LocusAddressReader = create({
    current: () => available ? currentReader : undefined,
    ready: async () => {
      events.push("ready"); readyStarted.resolve();
      if (readyGate) await readyGate;
      return currentReader;
    },
    saved,
    assertCurrent: () => {
      if (!current) throw new Error("Address source changed");
    },
    checkRoot: async node => {
      expect(node).toBe(call === node ? call : savedRef);
      rootChecks++; events.push(`root:${rootChecks}`); await rootCheck(rootChecks);
    },
  });
  return { address, saved, reader, originalSession, events, cacheReads, evaluationCalls, representations, childTypes,
    globalFunctionLookups: () => globalFunctionLookups,
    readyStarted: readyStarted.promise, evaluationStarted: evaluationStarted.promise,
    retained: (value: CardResult | undefined, captured = false) => { if (captured) capture = value; else normal = value; },
    scoped: (resolve: typeof representation) => { representation = resolve; },
    codecSites: (value: Array<{ node: ExprNode }>, inspect?: typeof inspectSites) => { sites = value; inspectSites = inspect ?? (() => {}); },
    rootCheck: (check: typeof rootCheck) => { rootCheck = check; },
    holdReady: (promise: Promise<void>) => { readyGate = promise; },
    holdEvaluation: (promise: Promise<CardResult>) => { evaluateGate = promise; },
    noCurrentReader: () => { available = false; },
    noWorker: () => { worker = false; },
    changeSource: () => { current = false; },
    replaceReader: () => { currentReader = { ...reader } as ReaderRuntime; },
    replaceSession: () => { session = { fixture: "reader-b" } as unknown as AuthoringSession; },
    changeRevision: () => { revision++; },
  };
}

describe("addressed computed positions borrow the ordinary reader", () => {
  test("ordinary cache and evaluation use the actual source facade while keeping base currentness", async () => {
    const h = harness();
    let generation = { id: "first" };
    Object.defineProperty(h.reader, "captureSourceMetadata", { value: () => ({ session: h.originalSession,
      packet: generation, generationToken: generation, current: () => true }) });
    await h.address.load(call);
    const session = h.evaluationCalls[0]!.session;
    expect(session).not.toBe(h.originalSession);
    expect(concreteAuthoringSession(session)).toBe(h.originalSession);
    expect(session.captureSourceMetadata?.()?.generationToken).toBe(generation);
    expect(h.cacheReads.every(read => read.session === session)).toBe(true);
    generation = { id: "second" };
    expect(session.captureSourceMetadata?.()?.generationToken).toBe(generation);
    h.retained(result);
    expect(h.address.read(call)).toEqual({ value: result.result });
    expect(h.cacheReads.at(-1)!.session).toBe(session);
    h.replaceSession();
    expect(() => session.captureSourceMetadata?.()).toThrow("reader changed");
  });

  test("an absent runtime provider shadows an inherited base callback", async () => {
    const h = harness();
    Object.defineProperty(h.originalSession, "captureSourceMetadata", { value: () => ({ packet: "prior source" }) });
    await h.address.load(call);
    const session = h.evaluationCalls[0]!.session;
    expect(session).not.toBe(h.originalSession);
    expect(session.captureSourceMetadata?.()).toBeUndefined();
  });

  test("source refs and unavailable reads never prepare or evaluate a reader", () => {
    const h = harness(); h.noCurrentReader();
    expect(h.address.expression!("saved-collection")).toBe(call);
    expect(h.address.expression!("missing")).toBeUndefined();
    expect(h.address.read(call)).toBeUndefined();
    expect(h.address.childType!([1], { $ref: "List" }, 0)).toBeUndefined();
    expect(h.events).toEqual([]); expect(h.childTypes).toEqual([]);
  });

  test("a unique captured intermediate is reused without another run", async () => {
    const h = harness(); h.retained(result, true); h.noWorker();
    expect(h.address.read(call)).toEqual({ value: result.result });
    await h.address.load(call);
    expect(h.evaluationCalls).toEqual([]); expect(h.representations).toEqual([]);
    expect(h.events).toEqual(["cache:capture", "root:1", "ready", "root:2", "cache:capture"]);
    for (const read of h.cacheReads) {
      expect(read.saved).toBe(h.saved); expect(read.node).toBe(call); expect(read.session).toBe(h.originalSession);
    }
  });

  test("an unavailable capture falls through to the exact ordinary cache", async () => {
    const h = harness(); h.retained(result); h.noWorker();
    await h.address.load(call);
    expect(h.address.read(call)).toEqual({ value: result.result });
    expect(h.cacheReads.map(read => read.capture)).toEqual([true, false, true, false]);
    expect(h.evaluationCalls).toEqual([]); expect(h.events).not.toContain("sites");
  });

  test("retained undefined is data, while a retained failure remains a failure", async () => {
    const h = harness(); h.retained({ result: undefined, trace: [] });
    expect(h.address.read(call)).toEqual({ value: undefined });
    await h.address.load(call); expect(h.evaluationCalls).toEqual([]);
    const failure = harness(); failure.retained({ result: undefined, trace: [], error: "Original card failure" }, true);
    expect(failure.address.read(call)).toBeUndefined();
    await expect(failure.address.load(call)).rejects.toThrow("Original card failure");
    expect(failure.evaluationCalls).toEqual([]); expect(failure.events).not.toContain("worker");
  });

  test("child types are delegated to the existing owner with this reader's session", () => {
    const h = harness(); const value = [{ name: "first" }], type = { $ref: "FixtureList" };
    expect(h.address.childType!(value, type, 0)).toEqual({ $ref: "ChildFixture" });
    expect(h.childTypes).toEqual([[value, type, 0, h.originalSession]]);
    expect(h.events).toEqual([]);
  });

  test("a scoped IOInvokable action requires an explicit card run", async () => {
    const h = harness(); h.scoped(name => name === "IOInvokable" ? { ioAction: "state.read" } : undefined);
    await expect(h.address.load(call)).rejects.toThrow("Run this call from its card");
    expect(h.representations).toEqual([["IOInvokable", "probe:collection"], ["Taggable", "probe:collection"]]);
    expect(h.evaluationCalls).toEqual([]); expect(h.events).not.toContain("worker");
  });

  test("scoped Taggable eligibility applies to the codec's saved-reference call sites", async () => {
    const h = harness(); const ioCall: ExprNode = { kind: "call", fnId: "account:scoped-action", args: [] };
    h.saved.set("saved-collection", ioCall);
    h.codecSites([{ node: savedRef }, { node: ioCall }], resolve => {
      expect(resolve("saved-collection")).toBe(ioCall); expect(resolve("missing")).toBeUndefined();
    });
    h.scoped((name, id) => name === "Taggable" && id === ioCall.fnId ? { tags: ["io"] } : undefined);
    await expect(h.address.load(savedRef)).rejects.toThrow("Run this call from its card");
    expect(h.representations).toEqual([["IOInvokable", "account:scoped-action"], ["Taggable", "account:scoped-action"]]);
    expect(h.evaluationCalls).toEqual([]); expect(h.events).not.toContain("worker");
  });

  test("scoped metadata wins over global fn tags without inferring purity", async () => {
    const h = harness(); h.scoped(name => name === "IOInvokable" ? { ioAction: "" } : { tags: ["collection"] });
    await h.address.load(call);
    expect(h.globalFunctionLookups()).toBe(0);
    expect(h.evaluationCalls).toEqual([{ node: call, saved: h.saved, session: h.originalSession }]);
    expect(h.events).toEqual(["root:1", "ready", "root:2", "cache:capture", "cache:normal", "sites", "worker", "evaluate", "root:3"]);
  });

  test("a missing worker cannot reach the card helper's synchronous fallback", async () => {
    const h = harness(); h.noWorker();
    await expect(h.address.load(call)).rejects.toThrow("editing tools are not ready");
    expect(h.evaluationCalls).toEqual([]);
    expect(h.events).toEqual(["root:1", "ready", "root:2", "cache:capture", "cache:normal", "sites", "worker"]);
  });

  test("a source or initial root refusal starts no reader preparation", async () => {
    const sourceChanged = harness(); sourceChanged.changeSource();
    await expect(sourceChanged.address.load(call)).rejects.toThrow("Address source changed");
    expect(sourceChanged.events).toEqual([]);
    const rootChanged = harness(); rootChanged.rootCheck(() => { throw new Error("Root changed"); });
    await expect(rootChanged.address.load(call)).rejects.toThrow("Root changed");
    expect(rootChanged.events).toEqual(["root:1"]);
  });

  test("a source retired during preparation cannot reach its cache or worker", async () => {
    const h = harness(), gate = deferred<void>(); h.holdReady(gate.promise);
    const pending = h.address.load(call);
    await h.readyStarted; h.changeSource(); gate.resolve();
    await expect(pending).rejects.toThrow("Address source changed");
    expect(h.cacheReads).toEqual([]); expect(h.evaluationCalls).toEqual([]);
  });

  test("a revision changed during the second root check cannot start evaluation", async () => {
    const h = harness(), checked = deferred<void>(), gate = deferred<void>();
    h.rootCheck(async number => { if (number === 2) { checked.resolve(); await gate.promise; } });
    const pending = h.address.load(call);
    await checked.promise; h.changeRevision(); gate.resolve();
    await expect(pending).rejects.toThrow("data reader changed");
    expect(h.cacheReads).toEqual([]); expect(h.evaluationCalls).toEqual([]);
  });

  for (const change of ["replaceReader", "replaceSession", "changeRevision", "changeSource"] as const) {
    test(`a late worker result refuses ${change} instead of opening the stale position`, async () => {
      const h = harness(), gate = deferred<CardResult>(); h.holdEvaluation(gate.promise);
      const pending = h.address.load(call);
      await h.evaluationStarted; h[change](); gate.resolve(result);
      await expect(pending).rejects.toThrow(change === "changeSource" ? "Address source changed" : "data reader changed");
      expect(h.evaluationCalls).toHaveLength(1); expect(h.events).not.toContain("root:3");
    });
  }

  test("the source root is revalidated after a successful worker response", async () => {
    const h = harness(); h.rootCheck(number => { if (number === 3) throw new Error("Root body changed"); });
    await expect(h.address.load(call)).rejects.toThrow("Root body changed");
    expect(h.evaluationCalls).toHaveLength(1); expect(h.events.at(-1)).toBe("root:3");
  });

  test("the card's inline evaluation failure is preserved after the final root check", async () => {
    const h = harness(); h.holdEvaluation(Promise.resolve({ result: undefined, trace: [], error: "Call failed in worker" }));
    await expect(h.address.load(call)).rejects.toThrow("Call failed in worker");
    expect(h.events.at(-1)).toBe("root:3"); expect(h.evaluationCalls).toHaveLength(1);
  });
});
