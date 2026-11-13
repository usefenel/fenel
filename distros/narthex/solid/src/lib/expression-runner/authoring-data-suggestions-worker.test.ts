import { authoringWorkerHostFixtureBindings } from "./authoring-worker-host.fixture";
import { describe, expect, test } from "bun:test";
import type { DataSuggestion, DataSuggestionBatch, DataSuggestionInput } from "../data-suggestions";
import type { ModuleRegistry } from "@fenel/engine/registry";
import type { AccountAuthoringScope, AuthoringSession, ReaderAuthoringScope } from "./account-authoring-session";
import type { AuthoringWorkerMessage, AuthoringWorkerRequest, AuthoringWorkerResponse } from "./authoring-worker-protocol";

// Exercise the two production message handlers without booting an engine
// registry. Registry acquisition and discovery policy are controlled seams;
// reader selection, structured-clone, cancellation and epoch fences are real.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const clientSource = await Bun.file(new URL("./authoring-catalog-worker.ts", import.meta.url)).text();
const workerSource = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
const clientCode = transpiler.transformSync(clientSource.replace(/^import[\s\S]*?;\r?\n/gm, "")
  .replace(/^export \{[^}]*\} from [^;]+;\r?\n/gm, ""))
  .replace(/^export /gm, "").replaceAll("import.meta.url", '"https://fixture.test/suggestions-worker.js"');
const workerCode = transpiler.transformSync(workerSource.slice(workerSource.indexOf("const scope =")))
  .replaceAll("import.meta.env.BASE_URL", JSON.stringify("/"));
const input = (revision: string): DataSuggestionInput => ({ revision, type: { $unit: true },
  expression: { kind: "ref", savedExprId: "source" }, value: { marker: revision },
  savedExpressions: [["source", { kind: "literal", value: revision }]] });
const batch = (revision: string): DataSuggestionBatch => ({ $tag: "RankedSuggestions", revision,
  suggestions: [], undecided: [], omittedConfirmed: 0, omittedUndecided: 0,
  duplicateCount: 0, rejectedCount: 0, diversityDeferred: 0, totalSubmitted: 0,
  coverage: { operationsSeen: 0, operationsAvailable: 0, operationsChecked: 0, skipped: 0, truncated: false } });

function harness() {
  let epoch = 1;
  let evaluations = 0;
  let holdDiscovery = false;
  let releaseDiscovery!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const discoveries: Array<{ session: AuthoringSession; scope?: ReaderAuthoringScope;
    input: DataSuggestionInput; options: unknown; signal: AbortSignal }> = [];
  const preparations: Array<{ session: AuthoringSession; scope?: ReaderAuthoringScope;
    input: DataSuggestionInput; suggestion: DataSuggestion }> = [];
  const scopes = new WeakMap<AuthoringSession, ReaderAuthoringScope>();
  const catalog = { types: [], functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() };
  const overlay = (base: AuthoringSession, scope: ReaderAuthoringScope) => {
    const session = { ...base };
    scopes.set(session, scope);
    return session;
  };
  const workers: TestWorker[] = [];
  class TestWorker {
    onmessage?: (event: { data: AuthoringWorkerMessage }) => void;
    onerror?: (event: { message: string }) => void;
    onmessageerror?: () => void;
    readonly sent: AuthoringWorkerRequest[] = [];
    readonly replies: AuthoringWorkerResponse[] = [];
    terminated = false;
    readonly workerScope: { onmessage?: (event: { data: AuthoringWorkerRequest }) => void;
      postMessage: (reply: AuthoringWorkerMessage) => void };
    constructor() {
      workers.push(this);
      this.workerScope = { postMessage: reply => {
        const copy = structuredClone(reply);
        if (!("event" in copy)) this.replies.push(copy);
        queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: copy }); });
      } };
      const imports = {
        isReaderExtensionMethod: () => false,
        runReaderExtension: () => { throw new Error("No reader extension in this fixture."); },
        globalThis: this.workerScope,
        yieldToInput: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
        dispatchRegistry: {}, modulesFor: () => [], registerCatalogEntities: () => {},
        createAccountFieldRegistry: () => ({}), evaluateContextForCatalog: () => ({}),
        getCatalog: () => [], buildSessionCatalog: () => catalog,
        environmentForCatalog: () => ({ catalog }), createDetachedAuthoringEnvironment: (value: unknown) => value,
        createAccountAuthoringSession: overlay, createLocalAuthoringSession: overlay,
        expressionMediaScheduling: () => ({ picture: false, sampled: false, weight: 0 }),
        evaluateAuthoringExpressionInSession: () => { evaluations++; throw new Error("Discovery must not evaluate a target."); },
        discoverDataSuggestions: async (session: AuthoringSession, selected: DataSuggestionInput, options: unknown,
          control: { signal: AbortSignal; yieldControl: () => Promise<void> }) => {
          discoveries.push({ session, scope: scopes.get(session), input: selected, options, signal: control.signal });
          markStarted();
          await control.yieldControl();
          control.signal.throwIfAborted();
          if (holdDiscovery) await new Promise<void>((resolve, reject) => {
            releaseDiscovery = resolve;
            control.signal.addEventListener("abort", () => reject(control.signal.reason), { once: true });
            if (control.signal.aborted) reject(control.signal.reason);
          });
          control.signal.throwIfAborted();
          return batch(selected.revision);
        },
        prepareDataSuggestion: (session: AuthoringSession, suggestion: DataSuggestion, selected: DataSuggestionInput) => {
          preparations.push({ session, scope: scopes.get(session), input: selected, suggestion });
          return suggestion.revision === selected.revision
            ? { ok: true, node: selected.expression }
            : { ok: false, issue: "The data changed. Open Suggestions again." };
        },
      };
      new Function(...Object.keys(imports), workerCode)(...Object.values(imports));
    }
    postMessage(request: AuthoringWorkerRequest) {
      const copy = structuredClone(request);
      this.sent.push(copy);
      queueMicrotask(() => { if (!this.terminated) this.workerScope.onmessage?.({ data: copy }); });
    }
    terminate() { this.terminated = true; }
  }
  const imports = {
    Worker: TestWorker, concreteAuthoringSession: (session: AuthoringSession) => session,
    localAuthoringScopeForSession: () => undefined,
    createSignal: () => [() => 0, () => {}], sessionEpoch: () => epoch,
    assertCurrentSession: (captured: number) => { if (captured !== epoch) throw new Error("Stale session"); },
    onBrowserSessionChange: () => () => {}, closeRegistryPreparationWorker: () => {}, clearCheckedRepositoryNamespaces: () => {},
    installPreparedWorkspaceCatalog: () => {}, accountFieldRegistryState: () => undefined,
  };
  Object.assign(imports, authoringWorkerHostFixtureBindings(imports));
  const api = new Function(...Object.keys(imports), `${clientCode}; return {
    prepareCatalogInWorker, attachPreparedAuthoringWorker, discardPreparedAuthoringWorker,
    discoverDataSuggestionsInWorker, prepareDataSuggestionInWorker, disposePreparedAuthoringWorkers };`)(...Object.values(imports)) as
    Pick<typeof import("./authoring-catalog-worker"), "prepareCatalogInWorker" | "attachPreparedAuthoringWorker"
      | "discardPreparedAuthoringWorker" | "discoverDataSuggestionsInWorker" | "prepareDataSuggestionInWorker" | "disposePreparedAuthoringWorkers">;
  const detached = (registry: ModuleRegistry) => ({ mode: "detached", registry,
    catalog, environment: { catalog }, evaluateContext: {} }) as unknown as AuthoringSession;
  async function reader(accountId: string) {
    const registry = {} as ModuleRegistry;
    const base = detached(registry);
    const prepared = await api.prepareCatalogInWorker(accountId, { owners: [], fields: [], facets: [] }, [], [], { independent: true });
    api.attachPreparedAuthoringWorker(registry, prepared, base);
    const scope: AccountAuthoringScope = { accountId, functions: [] };
    return { registry, session: detached(registry), scope, worker: workers.at(-1)! };
  }
  return { ...api, reader, detached, discoveries, preparations, started, evaluations: () => evaluations,
    hold: () => { holdDiscovery = true; },
    release: () => { holdDiscovery = false; releaseDiscovery?.(); },
    advanceEpoch: () => { epoch++; } };
}

describe("data suggestion transport in the exact reader worker", () => {
  test("selection rechecks cloned input in the exact reader and refuses changed revisions without evaluating", async () => {
    const h = harness();
    try {
      const left = await h.reader("left"), right = await h.reader("right");
      const selected = input("checked");
      const suggestion = { identity: "fixture", revision: "checked" } as DataSuggestion;
      expect(await h.prepareDataSuggestionInWorker(left.session, suggestion, selected, undefined, left.scope))
        .toEqual({ ok: true, node: selected.expression });
      expect(h.preparations[0]!.scope).toEqual(left.scope);
      expect(h.preparations[0]!.suggestion).toEqual(suggestion);
      expect(h.preparations[0]!.suggestion).not.toBe(suggestion);
      expect(await h.prepareDataSuggestionInWorker(right.session, suggestion, input("new"), undefined, right.scope))
        .toEqual({ ok: false, issue: "The data changed. Open Suggestions again." });
      expect(h.prepareDataSuggestionInWorker(h.detached({} as ModuleRegistry), suggestion, selected)).toBeUndefined();
      expect(h.prepareDataSuggestionInWorker(h.detached(left.registry), suggestion, selected, undefined, right.scope)).toBeUndefined();
      expect(h.preparations).toHaveLength(2);
      expect(h.evaluations()).toBe(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("retains cloned source revision, expressions, options and each exact scope without evaluating", async () => {
    const h = harness();
    try {
      const left = await h.reader("left"), right = await h.reader("right");
      const selected = input("revision-left");
      const options = { maxOperations: 12, maxSuggestions: 4, maxArity: 3 };
      expect(await h.discoverDataSuggestionsInWorker(left.session, selected, options, undefined, left.scope)).toEqual(batch(selected.revision));
      expect(await h.discoverDataSuggestionsInWorker(right.session, input("revision-right"), {}, undefined, right.scope)).toEqual(batch("revision-right"));
      expect(h.discoveries.map(row => row.scope)).toEqual([left.scope, right.scope]);
      expect(h.discoveries[0]!.input).toEqual(selected);
      expect(h.discoveries[0]!.input).not.toBe(selected);
      expect(h.discoveries[0]!.options).toEqual(options);
      expect(h.discoveries[0]!.session).not.toBe(h.discoveries[1]!.session);
      expect(h.discoverDataSuggestionsInWorker(h.detached({} as ModuleRegistry), selected)).toBeUndefined();
      expect(h.discoverDataSuggestionsInWorker(h.detached(left.registry), selected, {}, undefined, right.scope)).toBeUndefined();
      expect(h.discoveries).toHaveLength(2);
      expect(h.evaluations()).toBe(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("transports complete lexical schemes and present unresolved destinations through discovery and selection", async () => {
    const h = harness();
    try {
      const reader = await h.reader("reader");
      const selected: DataSuggestionInput = { ...input("context"), lexicalBindings: [{
        name: "argument0", type: { $ref: "String" }, scheme: { quantified: [], body: { $ref: "String" },
          nominals: [{ path: [], identity: "captured-string-owner", publicName: "String" }] },
      }], destination: { outcome: { $tag: "AnnotationRequired", diagnostics: [{
        code: "suggestions.destination-unresolved", functionId: "<expression>", message: "Required type is unavailable.",
      }] } } };
      selected.enclosing = { expression: { kind: "literal", value: { __ann: {
        expr: selected.expression, type: { $ref: "String" },
      } } }, path: ["value", "__ann", "expr"], lexicalBindings: [],
        destination: { expected: { quantified: [], body: { $ref: "Number" },
          nominals: [{ path: [], identity: "captured-number-owner", publicName: "Number" }] }, outcome: { $tag: "Solved" } } };
      await h.discoverDataSuggestionsInWorker(reader.session, selected, {}, undefined, reader.scope);
      const captured = h.discoveries[0]!.input;
      expect(captured.lexicalBindings).toEqual(selected.lexicalBindings);
      expect(captured.lexicalBindings).not.toBe(selected.lexicalBindings);
      expect(captured.destination).toEqual(selected.destination);
      expect(captured.destination).not.toBe(selected.destination);
      expect(captured.enclosing).toEqual(selected.enclosing);
      expect(captured.enclosing).not.toBe(selected.enclosing);
      expect((captured.enclosing!.expression as { value: { __ann: { expr: unknown } } }).value.__ann.expr)
        .toBe(captured.expression);
      const suggestion = { identity: "context", revision: selected.revision } as DataSuggestion;
      await h.prepareDataSuggestionInWorker(reader.session, suggestion, selected, undefined, reader.scope);
      expect(h.preparations[0]!.input.destination).toEqual(selected.destination);
      expect(h.preparations[0]!.input.lexicalBindings).toEqual(selected.lexicalBindings);
      expect(h.preparations[0]!.input.enclosing).toEqual(selected.enclosing);
      expect(h.evaluations()).toBe(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("active cancellation reaches discovery and suppresses its reply before the next request", async () => {
    const h = harness();
    try {
      const reader = await h.reader("reader");
      h.hold();
      const controller = new AbortController();
      const pending = h.discoverDataSuggestionsInWorker(reader.session, input("cancelled"), {}, controller.signal, reader.scope)!;
      void pending.catch(() => {});
      await h.started;
      controller.abort(new Error("Menu closed"));
      await expect(pending).rejects.toThrow("Menu closed");
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(h.discoveries[0]!.signal.aborted).toBe(true);
      const cancelledId = reader.worker.sent.find(request => request.method === "discover-data-suggestions")!.id;
      expect(reader.worker.replies.some(reply => reply.id === cancelledId)).toBe(false);
      h.release();
      expect(await h.discoverDataSuggestionsInWorker(reader.session, input("next"), {}, undefined, reader.scope)).toEqual(batch("next"));
      expect(h.evaluations()).toBe(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });

  test("refuses uncloneable input, a changed epoch and a retired prepared worker", async () => {
    const h = harness();
    try {
      const reader = await h.reader("reader");
      await expect(h.discoverDataSuggestionsInWorker(reader.session,
        { ...input("uncloneable"), value: () => "host callable" }, {}, undefined, reader.scope)!).rejects.toThrow();
      expect(h.discoveries).toHaveLength(0);
      h.hold();
      const pending = h.discoverDataSuggestionsInWorker(reader.session, input("old-epoch"), {}, undefined, reader.scope)!;
      void pending.catch(() => {});
      await h.started;
      h.advanceEpoch();
      h.release();
      await expect(pending).rejects.toThrow("Stale session");
      h.discardPreparedAuthoringWorker(reader.registry);
      await expect(h.discoverDataSuggestionsInWorker(reader.session, input("retired"), {}, undefined, reader.scope)!).rejects.toThrow("replaced");
      expect(h.discoveries).toHaveLength(1);
      expect(h.evaluations()).toBe(0);
    } finally { h.disposePreparedAuthoringWorkers(); }
  });
});

const inspectionSource = await Bun.file(new URL("../DataInspectionDialog.tsx", import.meta.url)).text();
const inspectionCode = transpiler.transformSync(inspectionSource.slice(
  inspectionSource.indexOf("export function createDataInspectionSuggestions"), inspectionSource.indexOf("const panelOrder")))
  .replace(/^export /gm, "")
  .replace('import("./expression-runner/authoring-catalog-worker")', "Promise.resolve(fixtureWorkerApi)");
// The default lifecycle seam writes immediately. Its cancellation/source
// matrix cannot establish Solid's coalesced-write or memo identity behavior;
// the subscribed client-runtime control below checks those production rules.
const clientSolid = await import(new URL("../../../node_modules/solid-js/dist/solid.js", import.meta.url).href) as typeof import("solid-js");

function inspectionHarness(useClientSolid = false) {
  let current = true, token: object | undefined = {};
  let throwsOnRead = false;
  let throwsOnWorkerRead = false;
  let revision = "revision", session = {} as AuthoringSession, reader = {};
  let nextCurrent = true;
  let closed!: () => void;
  const selected: unknown[] = [], issues: string[] = [];
  const selectedSources: number[] = [];
  const sources: Array<{ id: number; current: boolean; throws: boolean }> = [];
  const discoveries: Array<{ input: DataSuggestionInput; session: AuthoringSession; options: { maxOperations: number };
    resolve: (value: DataSuggestionBatch) => void; reject: (error: unknown) => void; signal?: AbortSignal }> = [];
  const preparations: Array<{ input: DataSuggestionInput; session: AuthoringSession;
    resolve: (value: unknown) => void; signal?: AbortSignal }> = [];
  const evaluations: Array<{ node: unknown; options: Record<string, unknown>; signal?: AbortSignal;
    resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
  const api = {
    authoringWorkerSnapshot: () => { if (throwsOnWorkerRead) throw new Error("Worker disposed"); return token; },
    discoverDataSuggestionsInWorker: (session: AuthoringSession, input: DataSuggestionInput,
      options: { maxOperations: number }, signal?: AbortSignal) => {
      if (!token) return undefined;
      return new Promise<DataSuggestionBatch>((resolve, reject) => { discoveries.push({ session, input, options, resolve, reject, signal }); });
    },
    prepareDataSuggestionInWorker: (session: AuthoringSession, _suggestion: unknown, input: DataSuggestionInput, signal?: AbortSignal) => {
      if (!token) return undefined;
      return new Promise(resolve => { preparations.push({ session, input, resolve, signal }); });
    },
    evaluateExpressionInWorker: (_session: AuthoringSession, node: unknown, _saved: unknown, signal?: AbortSignal,
      _scope?: unknown, options: Record<string, unknown> = {}) => {
      if (!token) return undefined;
      return new Promise((resolve, reject) => { evaluations.push({ node, options, signal, resolve, reject }); });
    },
  };
  const imports = useClientSolid ? { createSignal: clientSolid.createSignal, createMemo: clientSolid.createMemo,
    onSettled: clientSolid.onSettled, fixtureWorkerApi: api } : { createSignal: (initial: unknown) => { let value = initial;
      return [() => value, (next: unknown) => { value = next; }]; },
    createMemo: (read: unknown) => read, onSettled: (effect: () => () => void) => { closed = effect(); }, fixtureWorkerApi: api };
  const create = new Function(...Object.keys(imports), `${inspectionCode}; return createDataInspectionSuggestions;`)(...Object.values(imports));
  const capture = () => {
    const source = { id: sources.length, current: nextCurrent, throws: false }; sources.push(source);
    nextCurrent = true;
    const capturedRevision = revision, capturedSession = session, capturedReader = reader;
    return { session, input: input(revision), current: () => {
      if (throwsOnRead || source.throws) throw new Error("Reader disposed");
      return current && source.current && revision === capturedRevision && session === capturedSession && reader === capturedReader;
    }, select: (...args: unknown[]) => { selected.push(args); selectedSources.push(source.id); },
    reportIssue: (issue: string) => issues.push(issue) };
  };
  let rendered: readonly import("../locus-context-menu").LocusMenuItem[] = [];
  const owner: import("../DataInspectionDialog").DataInspectionSuggestions = useClientSolid
    ? clientSolid.createRoot(dispose => {
      closed = dispose;
      const owner = create(capture) as import("../DataInspectionDialog").DataInspectionSuggestions;
      clientSolid.createEffect(() => owner.items(), rows => { rendered = rows; });
      return owner;
    }) : create(capture);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const suggestion = { identity: "checked", revision: "revision", label: "Checked", icon: "check", missingArguments: 0 } as DataSuggestion;
  async function ready(result?: DataSuggestionBatch) {
    const before = discoveries.length; owner.open(); await settle();
    if (discoveries.length > before) {
      const discovery = discoveries.at(-1)!;
      discovery.resolve(result ?? { ...batch(discovery.input.revision), suggestions: [{ ...suggestion, revision: discovery.input.revision }] });
    }
    await settle();
  }
  return { owner, ready, settle, selected, selectedSources, issues, sources, discoveries, preparations, evaluations, suggestion,
    rendered: () => rendered,
    current: (value: boolean) => { current = value; }, worker: (value: object | undefined) => { token = value; },
    edit: (value: string) => { revision = value; }, recreateSession: () => { session = {} as AuthoringSession; },
    recreateReader: () => { reader = {}; }, nextCurrent: (value: boolean) => { nextCurrent = value; },
    workerThrows: (value: boolean) => { throwsOnWorkerRead = value; },
    disposeReader: () => { throwsOnRead = true; },
    discovery: () => discoveries.at(-1), preparation: () => preparations.at(-1), evaluation: () => evaluations.at(-1), dispose: () => closed() };
}

describe("responsive suggestions menu lifecycle", () => {
  test("reopening a current completed batch clears a failed selection without restarting discovery", async () => {
    const h = inspectionHarness();
    await h.ready();
    h.owner.select(h.suggestion);
    h.preparation()!.resolve({ ok: false, issue: "The selection could not be prepared." });
    await h.settle();
    expect(h.owner.issue()).toBe("The selection could not be prepared.");
    h.owner.open(); await h.settle();
    expect(h.owner.issue()).toBeUndefined();
    expect(h.discoveries).toHaveLength(1);
    expect(h.owner.read()?.batch.suggestions).toEqual([h.suggestion]);
    h.dispose();
  });

  test("background preparation, a menu and a held panel join the same discovery", async () => {
    const h = inspectionHarness();
    h.owner.warm(); h.owner.open();
    const release = h.owner.hold();
    await h.settle();
    expect(h.discoveries).toHaveLength(1);
    h.owner.close();
    expect(h.discovery()!.signal?.aborted).toBe(false);
    h.discovery()!.resolve({ ...batch("revision"), suggestions: [h.suggestion] });
    await h.settle();
    expect(h.owner.read()?.batch.suggestions).toEqual([h.suggestion]);
    h.owner.open(); await h.settle();
    expect(h.discoveries).toHaveLength(1);
    release();
    expect(h.discovery()!.signal?.aborted).toBe(true);
    h.dispose();
  });

  test("a held panel cancels a changed source and accepts only its replacement query", async () => {
    const h = inspectionHarness();
    const release = h.owner.hold();
    await h.settle();
    const old = h.discovery()!;
    h.edit("next"); h.owner.invalidate();
    await h.settle();
    expect(old.signal?.aborted).toBe(true);
    expect(h.discoveries).toHaveLength(2);
    old.resolve({ ...batch("revision"), suggestions: [h.suggestion] });
    await h.settle();
    expect(h.owner.read()).toBeUndefined();
    h.discovery()!.resolve(batch("next")); await h.settle();
    expect(h.owner.read()?.batch.revision).toBe("next");
    release(); h.dispose();
  });

  test("Solid subscribed menu reuse selects the newly captured source", async () => {
    const h = inspectionHarness(true);
    try {
      await h.ready();
      const first = h.rendered()[0]!;
      expect(first.label).toBe("Checked");
      h.owner.close(); h.owner.open(); await h.settle();
      const reopened = h.rendered()[0]!;
      expect(h.discoveries).toHaveLength(1);
      expect(reopened.label).toBe("Checked");
      expect(reopened).not.toBe(first);
      h.owner.close(); reopened.onSelect?.();
      expect(h.preparations).toHaveLength(1);
      h.preparation()!.resolve({ ok: true, node: input("revision").expression }); await h.settle();
      expect(h.selectedSources).toEqual([1]);
      expect(h.issues).toHaveLength(0);
    } finally { h.dispose(); }
  });
  test("reopening unchanged data reuses one completed batch and selection rechecks the fresh source", async () => {
    const h = inspectionHarness(); await h.ready();
    h.owner.close(); h.owner.open(); await h.settle();
    expect(h.discoveries).toHaveLength(1);
    expect(h.sources).toHaveLength(2);
    expect(h.owner.items()[0]!.label).toBe("Checked");
    const row = h.owner.items()[0]!; h.owner.close(); row.onSelect?.();
    expect(h.preparations).toHaveLength(1);
    expect(h.preparation()!.input.revision).toBe("revision");
    expect(h.selected).toHaveLength(0);
    h.preparation()!.resolve({ ok: true, node: input("revision").expression }); await h.settle();
    expect(h.selectedSources).toEqual([1]);
    h.dispose();
  });
  test("edits, reader replacement, worker replacement and a new session each miss the retained batch", async () => {
    for (const change of [
      (h: ReturnType<typeof inspectionHarness>) => h.edit("edited"),
      (h: ReturnType<typeof inspectionHarness>) => h.recreateReader(),
      (h: ReturnType<typeof inspectionHarness>) => h.worker({}),
      (h: ReturnType<typeof inspectionHarness>) => h.recreateSession(),
    ]) {
      const h = inspectionHarness(); await h.ready(); h.owner.close(); change(h);
      h.owner.open(); await h.settle();
      expect(h.discoveries).toHaveLength(2);
      expect(h.owner.items()[0]!.label).toBe("Checking suggestions…");
      h.dispose();
    }
  });
  test("both old and new source predicates must still agree, and an unreadable old source is a miss", async () => {
    for (const unreadable of [false, true]) {
      const h = inspectionHarness(); await h.ready(); h.owner.close();
      if (unreadable) h.sources[0]!.throws = true; else h.sources[0]!.current = false;
      h.owner.open(); await h.settle();
      expect(h.discoveries).toHaveLength(2);
      expect(h.owner.items()[0]!.label).toBe("Checking suggestions…");
      h.dispose();
    }
    const h = inspectionHarness(); await h.ready(); h.owner.close(); h.nextCurrent(false);
    h.owner.open(); await h.settle();
    expect(h.discoveries).toHaveLength(1);
    expect(h.owner.items()[0]!.label).toContain("changed");
    h.dispose();
  });
  test("More operations preserves 32/128/512/1024 expansion and never reuses a different budget", async () => {
    const h = inspectionHarness();
    const moreBatch = (checked: number) => ({ ...batch("revision"), suggestions: [h.suggestion], coverage: {
      operationsSeen: 2048, operationsAvailable: 2048, operationsChecked: checked, skipped: 0, truncated: true } });
    await h.ready(moreBatch(32));
    h.owner.items().find(item => item.id === "data-suggestions-more")!.onSelect?.(); await h.settle();
    expect(h.discoveries.map(row => row.options.maxOperations)).toEqual([32, 128]);
    h.discovery()!.resolve(moreBatch(128)); await h.settle();
    h.owner.items().find(item => item.id === "data-suggestions-more")!.onSelect?.(); await h.settle();
    expect(h.discoveries.map(row => row.options.maxOperations)).toEqual([32, 128, 512]);
    h.discovery()!.resolve(moreBatch(512)); await h.settle();
    h.owner.items().find(item => item.id === "data-suggestions-more")!.onSelect?.(); await h.settle();
    expect(h.discoveries.map(row => row.options.maxOperations)).toEqual([32, 128, 512, 1024]);
    h.discovery()!.resolve(moreBatch(1024)); await h.settle();
    expect(h.owner.items().some(item => item.id === "data-suggestions-more")).toBe(false);
    h.owner.close(); h.owner.open(); await h.settle();
    expect(h.discoveries.map(row => row.options.maxOperations)).toEqual([32, 128, 512, 1024, 32]);
    expect(h.owner.items()[0]!.label).toBe("Checking suggestions…");
    h.dispose();
  });
  test("closing cancels discovery and neither cancelled nor failed discovery supplies a retained batch", async () => {
    for (const cancel of [true, false]) {
      const h = inspectionHarness(); h.owner.open(); await h.settle();
      const first = h.discovery()!;
      if (cancel) {
        h.owner.close(); expect(first.signal!.aborted).toBe(true);
        first.resolve({ ...batch("revision"), suggestions: [h.suggestion] });
      } else first.reject(new Error("Try again."));
      await h.settle(); h.owner.open(); await h.settle();
      expect(h.discoveries).toHaveLength(2);
      expect(h.owner.items()[0]!.label).toBe("Checking suggestions…");
      h.dispose();
    }
  });
  test("invalidation clears the completed batch and disposal refuses retained callbacks", async () => {
    const h = inspectionHarness(); await h.ready(); const old = h.owner.items()[0]!;
    h.owner.invalidate(); old.onSelect?.(); await h.settle();
    expect(h.preparations).toHaveLength(0);
    h.owner.open(); await h.settle();
    expect(h.discoveries).toHaveLength(2);
    expect(h.owner.items()[0]!.label).toBe("Checking suggestions…");
    h.dispose(); expect(h.discovery()!.signal!.aborted).toBe(true);
    h.owner.open(); old.onSelect?.(); await h.settle();
    expect(h.discoveries).toHaveLength(2);
    expect(h.preparations).toHaveLength(0);
    expect(h.selected).toHaveLength(0);
  });
  test("disposing a completed owner clears reuse and refuses its old selected row", async () => {
    const h = inspectionHarness(); await h.ready(); const old = h.owner.items()[0]!;
    h.dispose(); h.owner.open(); old.onSelect?.(); await h.settle();
    expect(h.discoveries).toHaveLength(1);
    expect(h.preparations).toHaveLength(0);
    expect(h.selected).toHaveLength(0);
  });
  test("unreadable worker snapshots clear reuse and recovery performs discovery again", async () => {
    const h = inspectionHarness(); await h.ready(); h.owner.close(); h.workerThrows(true);
    h.owner.open(); await h.settle();
    expect(h.discoveries).toHaveLength(1);
    expect(h.owner.items()[0]!.label).toContain("disposed");
    expect(h.owner.items()[0]!.label).not.toBe("Checking suggestions…");
    h.workerThrows(false); h.owner.open(); await h.settle();
    expect(h.discoveries).toHaveLength(2);
    h.dispose();
  });
  test("a row from before a data edit cannot start or accept a new preparation", async () => {
    const h = inspectionHarness(); await h.ready(); const old = h.owner.items()[0]!;
    h.owner.close(); h.edit("edited"); old.onSelect?.(); await h.settle();
    expect(h.preparations).toHaveLength(0);
    expect(h.selected).toHaveLength(0);
    await h.ready(); const fresh = h.owner.items()[0]!; h.owner.close(); fresh.onSelect?.();
    const pending = h.preparation()!; h.edit("edited-again");
    pending.resolve({ ok: true, node: input("edited").expression }); await h.settle();
    expect(h.selected).toHaveLength(0);
    expect(h.issues.at(-1)).toContain("changed");
    h.dispose();
  });
  test("a disposed reader turns a late response into visible refusal without leaving Checking pending", async () => {
    const h = inspectionHarness(); h.owner.open(); await h.settle();
    h.disposeReader(); h.discovery()!.resolve(batch("revision")); await h.settle();
    expect(h.owner.items()[0]!.label).toContain("changed");
    expect(h.owner.items().some(item => item.label === "Checking suggestions…")).toBe(false);
    h.dispose();
  });
  test("missing worker exits Checking with a retry message and no policy import or inline fallback", async () => {
    const h = inspectionHarness(); h.worker(undefined);
    h.owner.open(); await h.settle();
    expect(h.discovery()).toBeUndefined();
    expect(h.owner.items()[0]!.label).toContain("Try again");
    expect(h.owner.items().some(item => item.label === "Checking suggestions…")).toBe(false);
    h.dispose();
  });
  test("selection survives menu dismissal, awaits worker recheck and refuses a changed worker", async () => {
    const h = inspectionHarness(); await h.ready();
    const row = h.owner.items()[0]!;
    h.owner.close();
    row.onSelect?.();
    expect(h.preparation()).toBeDefined();
    expect(h.selected).toHaveLength(0);
    h.worker({});
    h.preparation()!.resolve({ ok: true, node: input("revision").expression }); await h.settle();
    expect(h.selected).toHaveLength(0);
    expect(h.issues[0]).toContain("changed");
    h.dispose();
  });
  // Actions panel (2026-11-06): one-click apply, inline inputs and pure previews.
  const hole = { kind: "literal", value: undefined };
  const openRecipe = { kind: "call", fnId: "imageBoxBlur", args: [{ kind: "param", name: "selected" }, hole] };
  test("apply fills the recipe's open inputs in order and asks the source to show the result", async () => {
    const h = inspectionHarness(); await h.ready();
    const blur = { ...h.suggestion, missingArguments: 1 } as DataSuggestion;
    const radius = { kind: "literal", value: 2 };
    h.owner.select(blur, { evaluate: true, arguments: [radius as never] });
    h.preparation()!.resolve({ ok: true, node: openRecipe }); await h.settle();
    expect(h.selected).toEqual([[{ ...openRecipe, args: [openRecipe.args[0], radius] }, blur, { evaluate: true }]]);
    // A recipe whose open slots do not match the supplied inputs is refused.
    h.owner.select(blur, { evaluate: true, arguments: [radius as never, radius as never] });
    h.preparation()!.resolve({ ok: true, node: openRecipe }); await h.settle();
    expect(h.selected).toHaveLength(1);
    expect(h.issues.at(-1)).toContain("Fill this action's inputs");
    // Open expression keeps the draft unevaluated and its slot open.
    h.owner.select(blur);
    h.preparation()!.resolve({ ok: true, node: openRecipe }); await h.settle();
    expect(h.selected.at(-1)).toEqual([openRecipe, blur]);
    h.dispose();
  });

  test("previews run only for a held panel, in the pure frame at guidance priority, and stop with it", async () => {
    const h = inspectionHarness(); await h.ready();
    const confirmed = { ...h.suggestion, applicability: { $tag: "Just", _0: true } } as DataSuggestion;
    // A menu alone never evaluates a suggestion.
    expect(h.owner.preview!(confirmed)).toBeUndefined();
    await h.settle();
    expect(h.preparations).toHaveLength(0);
    const release = h.owner.hold();
    expect(h.owner.preview!(confirmed)).toEqual({ state: "pending" });
    await h.settle();
    h.preparation()!.resolve({ ok: true, node: { kind: "call", fnId: "negate", args: [] } }); await h.settle();
    expect(h.evaluation()!.options).toMatchObject({ pure: true, priority: "guidance" });
    h.evaluation()!.resolve({ result: -42, trace: [] }); await h.settle();
    expect(h.owner.preview!(confirmed)).toEqual({ state: "ready", value: -42 });
    // An unconfirmed row, or one whose inputs are not all supplied, is not previewed.
    expect(h.owner.preview!({ ...confirmed, identity: "unknown", applicability: { $tag: "Nothing" } } as DataSuggestion)).toBeUndefined();
    expect(h.owner.preview!({ ...confirmed, identity: "blur", missingArguments: 1 } as DataSuggestion)).toBeUndefined();
    // Supplied inputs fill the prepared recipe before the pure evaluation.
    const blur = { ...confirmed, identity: "blur", missingArguments: 1 } as DataSuggestion;
    expect(h.owner.preview!(blur, [{ kind: "literal", value: 3 } as never])).toEqual({ state: "pending" });
    await h.settle();
    h.preparation()!.resolve({ ok: true, node: openRecipe }); await h.settle();
    expect(h.evaluation()!.node).toEqual({ ...openRecipe, args: [openRecipe.args[0], { kind: "literal", value: 3 }] });
    const inFlight = h.evaluation()!;
    release();
    expect(inFlight.signal!.aborted).toBe(true);
    inFlight.resolve({ result: "late", trace: [] }); await h.settle();
    expect(h.owner.preview!(blur, [{ kind: "literal", value: 3 } as never])).toBeUndefined();
    h.dispose();
  });

  test("a failed or empty pure preview is unavailable, never a value", async () => {
    const h = inspectionHarness(); await h.ready();
    const confirmed = { ...h.suggestion, applicability: { $tag: "Just", _0: true } } as DataSuggestion;
    const release = h.owner.hold();
    h.owner.preview!(confirmed); await h.settle();
    h.preparation()!.resolve({ ok: true, node: { kind: "call", fnId: "fetchUrl", args: [] } }); await h.settle();
    h.evaluation()!.resolve({ result: null, trace: [] }); await h.settle();
    expect(h.owner.preview!(confirmed)).toEqual({ state: "unavailable" });
    release(); h.dispose();
  });

  test("worker recheck may accept only while current and invalidation cancels an in-flight selection", async () => {
    const h = inspectionHarness(); await h.ready();
    const row = h.owner.items()[0]!; h.owner.close(); row.onSelect?.();
    h.preparation()!.resolve({ ok: true, node: input("revision").expression }); await h.settle();
    expect(h.selected).toHaveLength(1);
    await h.ready(); const next = h.owner.items()[0]!; h.owner.close(); next.onSelect?.();
    const pending = h.preparation()!;
    h.owner.invalidate(); expect(pending.signal!.aborted).toBe(true);
    pending.resolve({ ok: true, node: input("revision").expression }); await h.settle();
    expect(h.selected).toHaveLength(1);
    expect(h.owner.items()[0]!.label).toContain("changed");
    h.dispose();
  });
});

test("subject type admission resolves its declaration in the captured source frame", async () => {
  const source = Bun.file(new URL("../data-suggestions.ts", import.meta.url));
  const text = await source.text();
  const body = transpiler.transformSync(text.slice(text.indexOf("function resolveReaderType("), text.indexOf("function directNode(")));
  const scheme = { quantified: [], body: { $unit: true } };
  const calls: unknown[][] = [];
  const admit = new Function("checkExpression", "judgeAuthoringSchemeCompatibility", "expectedTypeConsumer", "sourceAnnotationType", `${body}; return subjectScheme;`)(
    () => ({ outcome: { $tag: "Solved" }, scheme }), () => "compatible", () => ({ id: "<fixture-expected>" }), () => undefined,
  );
  for (const sourceFunction of ["source:producer", undefined]) {
    const session = { registry: { callSiteTyping: { resolveType: (...args: unknown[]) => {
      calls.push(args); return { ok: true, type: scheme };
    } } }, evaluateContext: { _sourceFunction: sourceFunction } };
    const selected = input("source-frame");
    expect(admit(session, selected)).toBe(scheme);
    expect(calls.at(-1)).toEqual([selected.type, sourceFunction]);
  }
});
