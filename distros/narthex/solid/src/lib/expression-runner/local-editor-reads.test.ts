// Run with: bun test --conditions=browser --conditions=development ./src/lib/expression-runner/local-editor-reads.test.ts
import { describe, expect, mock, test } from "bun:test";
import type { FenelType } from "@fenel/engine/types";

// B4 wave 4 lane E: the page side of the editor's Local worker reads over a
// controlled worker client, for a Local session whose page registry and frame
// THROW: each read sends its closed request (display reads at the guidance
// class, a user's button without it), maps the answer, shows nothing while
// pending, drops a reply computed under a capture that moved (and asks
// again), and refuses a malformed reply; a copy is prefetched on intent and
// refused visibly until it lands.
const requests: Array<{ via: "prepared" | "session" | "evaluate"; payload: Record<string, unknown>; signal?: AbortSignal;
  resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
let snapshot: object | undefined = { worker: "one" };
let handle: object | undefined = { handle: "one" };
const ask = (via: "prepared" | "session" | "evaluate") => (_target: unknown, payload: Record<string, unknown>, signal?: AbortSignal) =>
  new Promise((resolve, reject) => { requests.push({ via, payload, signal, resolve, reject }); });
// Lane S's real Local registry token and inert page session (every registry
// member and the frame refuse), with only the worker client controlled.
const realWorker = await import("./authoring-catalog-worker");
const { createInertLocalAuthoringSession } = await import("./account-authoring-session");
const { createAuthoringEnvironment } = await import("@fenel/engine/authoring/environment");
const token = realWorker.createLocalRegistryToken();
const inertSession = createInertLocalAuthoringSession(token, createAuthoringEnvironment({ types: [], functions: [], capabilities: [],
  catalogTypes: [], operatorCodeNameByNotation: new Map() }), { sourceId: "tab", functions: [] });
mock.module("./authoring-catalog-worker", () => ({
  ...realWorker,
  authoringWorkerSnapshot: () => snapshot,
  authoringWorkerReplacementPending: () => false,
  preparedReaderWorkerForSession: () => handle,
  preparedSnapshotOwnerOf: () => ({ owner: "snapshot" }),
  runPreparedReaderWorker: ask("prepared"),
  runAuthoringWorker: ask("session"),
  evaluateExpressionInWorker: (_session: unknown, node: unknown, saved: ReadonlyMap<string, unknown>, _signal: unknown, _scope: unknown,
    options: Record<string, unknown>) => ask("evaluate")(undefined, { node, saved: [...saved], ...options }),
}));
const reads = await import("./local-editor-reads");
const { createRoot, createSignal, flush } = await import("solid-js");
const settle = async () => { for (let turn = 0; turn < 16; turn++) { await Promise.resolve(); flush(); } };

const pageReads: string[] = [];
const session = {} as Record<string, unknown>;
for (const key of ["registry", "evaluateContext"]) Object.defineProperty(session, key, { get() {
  pageReads.push(`session.${key}`); throw new Error(`Page session ${key} read for a Local reader`); } });
let revision = 1;
const reader = { kind: "local" as const, revision: () => revision };
const number = { $ref: "Number" }, text = { $ref: "String" };
const dependent = { $el: { var: "kind" } };

describe("Local instance editor metadata and wire remain current", () => {
  test("delayed roster and method types use the current reader and discard an older argument reply", async () => {
    requests.length = 0; pageReads.length = 0; revision = 1;
    const { api, setArgs, dispose } = createRoot(dispose => {
      const [args, setArgs] = createSignal<unknown[]>(["String"]);
      return { dispose, setArgs, api: {
        roster: reads.createLocalInstanceInterfaces(() => reader, () => session as never),
        type: reads.createLocalInstanceMethodsType(() => reader, () => session as never, () => ({ typeName: "Example", args: args() })),
      } };
    });
    await settle();
    expect(api.roster.answer()).toBeUndefined();
    expect(requests.map(row => row.payload.method)).toEqual(["project-reader-instance-interfaces", "project-reader-instance-methods-type"]);
    setArgs(["Bytes"]); await settle();
    const bytes: FenelType = { $record: { fields: [{ name: "value", key: { $tag: "NamedField", ref: { $ref: "field-id" } },
      type: { $ref: "Bytes" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} }] } };
    requests[2]!.resolve({ instanceMethodsType: { $tag: "Ok", _0: bytes } }); await settle();
    expect(api.type.answer()).toEqual({ $tag: "Ok", _0: bytes });
    requests[1]!.resolve({ instanceMethodsType: { $tag: "Ok", _0: number } }); await settle();
    expect(api.type.answer()).toEqual({ $tag: "Ok", _0: bytes });
    revision = 2;
    requests[0]!.resolve({ instanceInterfaces: { $tag: "Ok", _0: { interfaces: [], representational: [] } } }); await settle();
    expect(api.roster.answer()).toBeUndefined();
    expect(requests.length).toBeGreaterThan(3);
    expect(pageReads).toEqual([]);
    dispose();
    for (const request of requests.slice(3)) request.resolve({ instanceInterfaces: { $tag: "Ok", _0: { interfaces: [], representational: [] } } });
    await settle();
  });

  test("source metadata generation invalidates an in-flight roster even when the session, worker and revision stay equal", async () => {
    requests.length = 0; pageReads.length = 0; revision = 1;
    let generation = {};
    const sourceSession = Object.create(session);
    sourceSession.captureSourceMetadata = () => {
      const captured = generation;
      return { session: sourceSession, generationToken: captured, packet: {}, current: () => generation === captured };
    };
    const { api, dispose } = createRoot(dispose => ({ dispose,
      api: reads.createLocalInstanceInterfaces(() => reader, () => sourceSession) }));
    await settle();
    expect(requests).toHaveLength(1);
    generation = {};
    requests[0]!.resolve({ instanceInterfaces: { $tag: "Ok", _0: { interfaces: [], representational: ["stale"] } } });
    await settle();
    expect(api.answer()).toBeUndefined();
    expect(requests).toHaveLength(2);
    const current = { interfaces: [], representational: [] };
    requests[1]!.resolve({ instanceInterfaces: { $tag: "Ok", _0: current } });
    await settle();
    expect(api.answer()).toEqual({ $tag: "Ok", _0: current });
    expect(pageReads).toEqual([]);
    dispose();
  });

  test("disposing metadata reads aborts both requests and admits neither late reply", async () => {
    requests.length = 0; pageReads.length = 0; revision = 1;
    const { api, dispose } = createRoot(dispose => ({ dispose, api: {
      roster: reads.createLocalInstanceInterfaces(() => reader, () => session as never),
      type: reads.createLocalInstanceMethodsType(() => reader, () => session as never,
        () => ({ typeName: "Codeable", args: ["target"] })),
    } }));
    await settle();
    expect(requests).toHaveLength(2);
    expect(requests.every(request => request.signal && !request.signal.aborted)).toBe(true);
    dispose();
    expect(requests.every(request => request.signal?.aborted)).toBe(true);
    requests[0]!.resolve({ instanceInterfaces: { $tag: "Ok", _0: { interfaces: [], representational: [] } } });
    requests[1]!.resolve({ instanceMethodsType: { $tag: "Ok", _0: number } });
    await settle();
    expect(api.roster.answer()).toBeUndefined();
    expect(api.type.answer()).toBeUndefined();
    expect(requests).toHaveLength(2);
    expect(pageReads).toEqual([]);
  });

  test("wire completion requires current content and the same snapshot owner", async () => {
    const pending: Array<{ methods: unknown; resolve: (value: Record<string, unknown>[]) => void; reject: (error: unknown) => void }> = [];
    const owner = { encodeInstances: (instances: readonly Record<string, unknown>[]) => new Promise<Record<string, unknown>[]>((resolve, reject) =>
      pending.push({ methods: instances[0]!.methods, resolve, reject })), decodeInstances: async () => [] };
    const { api, setText, setOwner, dispose } = createRoot(dispose => {
      const [text, setText] = createSignal("A");
      const [encoding, setOwner] = createSignal(owner);
      return { dispose, setText, setOwner, api: reads.createLocalInstanceWire(encoding, () => ({ kind: "encode", valueEncoding: "fenel-instance-json-v2",
        instances: [{ typeName: "Labelable", args: ["target"], methods: { label: text() } }] })) };
    });
    await settle();
    expect(api.answer()).toBeUndefined();
    setText("B"); await settle();
    pending[1]!.resolve([{ methods: { label: "B" } }]); await settle();
    expect(api.answer()).toEqual([{ methods: { label: "B" } }]);
    pending[0]!.resolve([{ methods: { label: "A" } }]); await settle();
    expect(api.answer()).toEqual([{ methods: { label: "B" } }]);
    // Equal owner access keeps a current answer. Actual physical replacement
    // under the same owner is controlled in local-api-client-worker.test.mjs.
    setOwner(owner); await settle();
    expect(api.answer()).toEqual([{ methods: { label: "B" } }]);
    expect(pending).toHaveLength(2);
    setOwner({ ...owner }); await settle();
    expect(api.answer()).toBeUndefined();
    pending[2]!.reject(new Error("definitions replaced")); await settle();
    expect(api.answer()).toBeUndefined();
    expect(api.failure()).toBe("definitions replaced");
    dispose();
  });
});

describe("B4 wave 4 lane E: over lane S's real inert Local session", () => {
  test("the inert session refuses its registry members and frame; each read still answers from the worker", async () => {
    expect(() => (inertSession.registry as unknown as { getFunction: unknown }).getFunction).toThrow("LocalPageRegistryRead");
    expect(() => inertSession.evaluateContext).toThrow("LocalPageFrameRead");
    requests.length = 0; revision = 1;
    const real = () => inertSession;
    const { api, dispose } = createRoot(dispose => ({ dispose, api: {
      dependent: reads.createLocalDependentType(() => reader, real, () => ({ type: dependent as never, values: { kind: number } })),
      union: reads.createLocalUnionBranch(() => reader, real, () => ({ branches: [number, text] as never, value: 3 })),
      policy: reads.createLocalLensPolicy(() => reader, real, () => ({ policy: "suggestionPanelRows", args: [] })),
      expression: reads.createLocalReturnedExpression(() => reader, real, () => ({ value: 1 })),
      copy: reads.createLocalTransferCopy(() => reader, real, () => ({ value: 1, typeName: "Number", source: "fenel" as const })),
    } }));
    api.copy.intent();
    await settle();
    expect(requests.map(row => row.payload.method)).toEqual(["resolve-reader-dependent-type", "select-reader-union-branch",
      "project-reader-lens-policy", "read-reader-returned-expression", "prepare-reader-transfer-item"]);
    requests[0]!.resolve({ dependentType: { resolved: number } });
    requests[1]!.resolve({ unionBranch: { selected: 0, labels: ["Number", "Text"] } });
    requests[2]!.resolve({ lensPolicy: { $tag: "Ok", _0: { declarationId: "view.SuggestionPresentation", value: [] } } });
    requests[3]!.resolve({ returnedExpression: {} });
    requests[4]!.resolve({ transferItem: { $tag: "Ok", _0: { value: 1, typeName: "Number", source: "fenel" } } });
    await settle();
    expect([api.dependent.failure(), api.union.failure(), api.policy.failure(), api.expression.failure()]).toEqual([undefined, undefined, undefined, undefined]);
    expect(api.dependent.answer()).toEqual({ resolved: number });
    expect(api.union.answer()).toEqual({ selected: 0, labels: ["Number", "Text"] });
    expect(api.expression.answer()).toEqual({});
    expect(api.copy.copy()).toEqual({ value: 1, typeName: "Number", source: "fenel" } as never);
    const shortcuts = reads.localTextShortcuts(reader, real);
    await settle();
    requests[5]!.resolve({ textShortcuts: { $tag: "Ok", _0: [] } });
    expect(await shortcuts).toEqual([]);
    dispose();
  });
});

describe("B4 wave 4 lane E: the editor's Local worker reads", () => {
  test("a dependent type is asked at the guidance class; pending shows nothing; a stale reply is dropped and asked again", async () => {
    requests.length = 0; pageReads.length = 0; revision = 1;
    const [values, setValues] = createSignal<Record<string, unknown>>({ kind: number });
    const { api, dispose } = createRoot(dispose => ({ dispose, api: reads.createLocalDependentType(() => reader, () => session as never,
      () => ({ type: dependent as never, values: values() })) }));
    await settle();
    expect(requests.map(row => row.payload)).toEqual([{ method: "resolve-reader-dependent-type", type: dependent, values: { kind: number }, priority: "guidance" }]);
    expect(requests[0]!.via).toBe("prepared");
    expect(api.answer()).toBeUndefined();
    // The reader's revision moves while the request is in flight: its reply is dropped and the request is asked again.
    revision = 2;
    requests[0]!.resolve({ dependentType: { resolved: text } });
    await settle();
    expect(api.answer()).toBeUndefined();
    expect(requests).toHaveLength(2);
    requests[1]!.resolve({ dependentType: { resolved: number } });
    await settle();
    expect(api.answer()).toEqual({ resolved: number });
    // New values: a new request; the older answer is not shown for them.
    setValues({ kind: text });
    await settle();
    expect(api.answer()).toBeUndefined();
    requests[2]!.resolve({ dependentType: {} });
    await settle();
    expect(api.answer()).toEqual({});
    // A malformed reply is a refusal, never a type.
    setValues({ kind: { $ref: "Bool" } });
    await settle();
    requests[3]!.resolve({ dependentType: { resolved: "Number" } });
    await settle();
    expect(api.answer()).toBeUndefined();
    expect(api.failure()).toBe("The authoring worker response could not be read.");
    expect(pageReads).toEqual([]);
    dispose();
  });

  test("a union's branch answer counts only with one caption per branch; undecided claims no branch", async () => {
    requests.length = 0; pageReads.length = 0; revision = 1;
    const branches = [number, text];
    const { api, dispose } = createRoot(dispose => ({ dispose, api: reads.createLocalUnionBranch(() => reader, () => session as never,
      () => ({ branches: branches as never, value: 3, representationTypeName: "Number" })) }));
    await settle();
    expect(requests.map(row => row.payload)).toEqual([{ method: "select-reader-union-branch", branches, value: 3,
      representationTypeName: "Number", priority: "guidance" }]);
    requests[0]!.resolve({ unionBranch: { labels: ["Number", "Text"] } });
    await settle();
    expect(api.answer()).toEqual({ labels: ["Number", "Text"] });
    expect(api.answer()?.selected).toBeUndefined();
    expect(() => reads.readUnionBranch(2)({ unionBranch: { selected: 0, labels: ["Number"] } })).toThrow("could not be read");
    expect(() => reads.readUnionBranch(2)({ unionBranch: { selected: 2, labels: ["a", "b"] } })).toThrow("could not be read");
    expect(reads.readUnionBranch(2)({ unionBranch: { selected: 1, labels: ["a", "b"] } })).toEqual({ selected: 1, labels: ["a", "b"] });
    expect(pageReads).toEqual([]);
    dispose();
  });

  test("lens policies, returned expressions and text shortcuts read their own reply shapes", async () => {
    requests.length = 0; pageReads.length = 0; revision = 1;
    const { api, dispose } = createRoot(dispose => ({ dispose, api: {
      policy: reads.createLocalLensPolicy(() => reader, () => session as never, () => ({ policy: "dependencyGraph", args: ["scope"] })),
      expression: reads.createLocalReturnedExpression(() => reader, () => session as never, () => ({ value: { $tag: "EVar", name: "x" } })),
    } }));
    await settle();
    expect(requests.map(row => row.payload)).toEqual([
      { method: "project-reader-lens-policy", policy: "dependencyGraph", args: ["scope"], priority: "guidance" },
      { method: "read-reader-returned-expression", value: { $tag: "EVar", name: "x" }, priority: "guidance" }]);
    requests[0]!.resolve({ lensPolicy: { $tag: "Err", _0: "Dependency data is unavailable in this reader. Prepare its current tools and retry." } });
    requests[1]!.resolve({ returnedExpression: { node: { kind: "param", name: "x" } } });
    await settle();
    expect(api.policy.answer()).toEqual({ $tag: "Err", _0: "Dependency data is unavailable in this reader. Prepare its current tools and retry." });
    expect(api.expression.answer()).toEqual({ node: { kind: "param", name: "x" } });
    expect(() => reads.readReturnedExpression({ returnedExpression: { node: "x" } })).toThrow("could not be read");
    expect(() => reads.readLensPolicy({ lensPolicy: { $tag: "Ok", _0: { declarationId: "" } } })).toThrow("could not be read");
    dispose();
    // A user's button: no guidance class; an Err refuses with its own copy.
    const shortcuts = reads.localTextShortcuts(reader, () => session as never);
    await settle();
    expect(requests[2]!.payload).toEqual({ method: "project-reader-text-shortcuts" });
    requests[2]!.resolve({ textShortcuts: { $tag: "Err", _0: "Lens shortcuts are unavailable in this reader. Retry when its data is ready." } });
    await expect(shortcuts).rejects.toThrow("Lens shortcuts are unavailable in this reader.");
    const accepted = reads.localTextShortcuts(reader, () => session as never);
    await settle();
    requests[3]!.resolve({ textShortcuts: { $tag: "Ok", _0: [{ $tag: "LensShortcut", id: "reverse" }] } });
    expect(await accepted).toEqual([{ $tag: "LensShortcut", id: "reverse" }] as never);
    // A shortcut answered under a moved capture is refused, never applied.
    const moved = reads.localTextShortcuts(reader, () => session as never);
    await settle();
    revision = 5;
    requests[4]!.resolve({ textShortcuts: { $tag: "Ok", _0: [] } });
    await expect(moved).rejects.toThrow("This data changed while preparing the edit.");
    // No prepared worker: the existing not-ready copy, nothing sent.
    handle = undefined;
    await expect(reads.localTextShortcuts(reader, () => session as never)).rejects.toThrow("This reader's editing tools are not ready.");
    handle = { handle: "one" };
    expect(requests).toHaveLength(5);
    expect(pageReads).toEqual([]);
  });

  test("a copy is prefetched on intent, through the session's own worker context, and refused visibly until it lands", async () => {
    requests.length = 0; pageReads.length = 0; revision = 1;
    const [value, setValue] = createSignal<unknown>(4);
    const { copy, dispose } = createRoot(dispose => ({ dispose, copy: reads.createLocalTransferCopy(() => reader, () => session as never,
      () => ({ value: value(), type: number as never, typeName: "Number", source: "fenel" as const })) }));
    await settle();
    // Nothing is asked before an intent.
    expect(requests).toHaveLength(0);
    expect(() => copy.copy()).toThrow(reads.LOCAL_COPY_PREPARING);
    await settle();
    expect(requests.map(row => [row.via, row.payload])).toEqual([["session", { method: "prepare-reader-transfer-item",
      item: { value: 4, type: number, typeName: "Number", source: "fenel" }, priority: "guidance" }]]);
    expect(() => copy.copy()).toThrow(reads.LOCAL_COPY_PREPARING);
    const item = { value: 4, type: number, typeName: "Number", label: "Four", source: "fenel" };
    requests[0]!.resolve({ transferItem: { $tag: "Ok", _0: item } });
    await settle();
    expect(copy.copy()).toEqual(item as never);
    // Different data: the earlier item is never copied for it.
    setValue(5);
    await settle();
    expect(() => copy.copy()).toThrow(reads.LOCAL_COPY_PREPARING);
    requests[1]!.resolve({ transferItem: { $tag: "Err", _0: "This value cannot be copied." } });
    await settle();
    expect(() => copy.copy()).toThrow("This value cannot be copied.");
    expect(pageReads).toEqual([]);
    dispose();
  });

  test("a slot's copy evaluates in the worker on intent, then prepares that value; no value means nothing to copy", async () => {
    requests.length = 0; pageReads.length = 0; revision = 1;
    const literal = { kind: "call", fnId: "add", args: [] };
    const [node, setNode] = createSignal<unknown>(literal);
    const { copy, dispose } = createRoot(dispose => ({ dispose, copy: reads.createLocalExpressionCopy(() => reader, () => session as never,
      () => ({ node: node() as never, saved: new Map(), type: number as never, typeName: "Number" })) }));
    await settle();
    expect(requests).toHaveLength(0);
    copy.intent();
    await settle();
    expect(requests.map(row => [row.via, row.payload])).toEqual([["evaluate", { node: literal, saved: [], priority: "guidance" }]]);
    expect(() => copy.copy()).toThrow(reads.LOCAL_COPY_PREPARING);
    requests[0]!.resolve({ result: 7, trace: [] });
    await settle();
    expect(requests[1]!.via).toBe("session");
    expect(requests[1]!.payload).toEqual({ method: "prepare-reader-transfer-item", priority: "guidance",
      item: { value: 7, type: number, typeName: "Number", source: "fenel" } });
    requests[1]!.resolve({ transferItem: { $tag: "Ok", _0: { value: 7, typeName: "Number", source: "fenel" } } });
    await settle();
    // Exactly one preparation for this value.
    expect(requests).toHaveLength(2);
    expect(copy.copy()).toEqual({ value: 7, typeName: "Number", source: "fenel" } as never);
    // An edited slot evaluates again; an incomplete one has nothing to copy.
    setNode({ kind: "literal", value: undefined });
    await settle();
    expect(() => copy.copy()).toThrow(reads.LOCAL_COPY_PREPARING);
    requests[2]!.resolve({ result: undefined, trace: [] });
    await settle();
    expect(copy.copy()).toBeUndefined();
    expect(requests).toHaveLength(3);
    expect(pageReads).toEqual([]);
    dispose();
  });
});
