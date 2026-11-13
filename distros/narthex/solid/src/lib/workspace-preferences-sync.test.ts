import { expect, test } from "bun:test";
import type { WorkspaceCommand } from "./workspace-wire";
import { createSignal, flush } from "solid-js";
import { loadFenelModule } from "../../../../../implementations/typescript/engine/src/fenel-module";
import { evaluate, type EvaluateContext } from "../../../../../implementations/typescript/engine/src/json-logic";
import { stdNatives, stdNativesCtx } from "../../../../../fenel/modules/std/ffi/std-ffi";
import { captureRegistryTransportObservation, registryTransportSnapshot } from "../../../../../implementations/typescript/engine/src/registry-transport";
import { runLocalOrdinaryOperation, type LocalOrdinaryOperation } from "./local-ordinary-operations";
import type { WorkspaceModel } from "./workspace-model-loader";
import type { WorkspacePreferencesStore } from "./workspace-preferences";
import { assertCurrentSession, sessionEpoch } from "./browser-session";
import { draftValueFingerprint } from "./native-draft";
import { createLocusSynchronization } from "./locus-synchronization";
import { createReaderDraftClient } from "./reader-draft-client";
import type { ApiClient } from "./api";
import type { LocalTabData, LocalTabSource, TabCommand } from "./local-locus-data";
import type { LocusRootCommand, LocusRootData } from "./locus-root-data";
import { workspaceExpression, type WorkspacePreferences } from "./workspace-wire";

// Isolate acquisition seams without mocking shared modules or preparing a
// registry. The production preference-store body and draft client are real.
const sourceText = await Bun.file(new URL("./workspace-preferences.ts", import.meta.url)).text();
const storeBody = sourceText.slice(sourceText.indexOf("export async function loadWorkspacePreferences"), sourceText.indexOf("\nexport type WorkspacePreferencesStore"));
const transpiler = new Bun.Transpiler({ loader: "ts" });
const makeLoader = new Function("createSignal", "createAccountApiClient", "assertCurrentSession", "sessionEpoch", "loadWorkspaceBootstrap",
  "loadWorkspaceModel", "preloadWorkspaceSlice", "workspaceExpression", "loadPublicBootstrap", "draftValueFingerprint", "flushSolid", "captureRegistryTransportObservation", "registryTransportSnapshot",
  `${transpiler.transformSync(storeBody.replace(/^export /, ""))}\nreturn loadWorkspacePreferences;`);

// GLOBAL_ONLY: literal fixture values and the actual preference bodies. This
// exercises store ordering without claiming checked-registry/worker admission.
const functions = new Map<string, NonNullable<ReturnType<typeof loadFenelModule>["functions"]>[number]>();
for (const [path, name] of [["view/types.fenel", "view"], ["std/appendItem.fenel", "std"], ["std/not.fenel", "std"],
  ["std/native/collection-native.fenel", "std"]]) {
  const owner = loadFenelModule(await Bun.file(new URL(`../../../../../fenel/modules/${path}`, import.meta.url)).text(), name!, { bootstrapParser: "typescript" });
  for (const fn of owner.functions ?? []) {
    functions.set(fn.id, fn); functions.set(fn.id.replace(":", "."), fn); functions.set(fn.id.slice(fn.id.indexOf(":") + 1), fn);
  }
}
const context: EvaluateContext = { getFunction: name => functions.get(name),
  natives: Object.assign(Object.create(null), stdNatives), nativesCtx: Object.assign(Object.create(null), stdNativesCtx),
  _constructors: { Ok: ["_0"], Err: ["_0"], Just: ["_0"], Nothing: [] } };
const model = { workspaceCall: (name: string, ...args: unknown[]) => evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
  Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), context), workspaceValueType: () => ({ $ref: "fixture-preferences" }) } as unknown as WorkspaceModel;
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

async function fixture(options: { beforeOperation?: (operation: LocalOrdinaryOperation) => Promise<void>; subjectData?: unknown;
  prepared?: boolean; initialValue?: WorkspacePreferences } = {}) {
  const value: WorkspacePreferences = options.initialValue ?? { $tag: "WorkspacePreferences", lenses: [{ $tag: "WorkspaceLens", id: "lens", title: { $tag: "Nothing" },
    source: { $tag: "AccountSource", accountId: "same-account" }, focus: { $tag: "RootFocus" }, presentation: { $tag: "ListPresentation" } }],
    activeLensId: "lens", display: { $tag: "SingleLens" }, bar: { $tag: "WorkspaceBar", mode: { $tag: "DockedBar" }, position: { $tag: "BarTop" } }, presentations: [] };
  if (Object.hasOwn(options, "subjectData")) value.lenses[0]!.subject = { $tag: "Just", _0: {
    $tag: "LensTypedSubject", dataType: { $ref: "Anything" }, data: options.subjectData,
    originSource: value.lenses[0]!.source, originFocus: value.lenses[0]!.focus,
    producer: { $tag: "Nothing" }, producerInput: { $tag: "Nothing" }, producerBinding: { $tag: "Nothing" },
  } };
  const settings = { id: "settings", caption: "Lens settings", source: { kind: "expr" as const, expr: workspaceExpression(value) } };
  let committed = { id: "same-account", name: "All data", revision: 11, type: { $ref: "List" }, expr: { kind: "literal", value: [] },
    items: [settings], lists: [], expressions: {}, layout: { kind: "list" }, referenceId: "root-ref", persisted: true, canEdit: true } as LocusRootData;
  const writes: Array<{ client: string; revision: number; command: LocusRootCommand }> = [];
  let savedQuery = { kind: "expression", expr: { kind: "literal", value: 1 } };
  const lifetimes = new Map<string, AbortController>();
  const apply = (root: LocusRootData, command: LocusRootCommand): LocusRootData => {
    if (command.kind === "replace") return { ...root, items: root.items.map(item => item.id === command.itemId ? command.item : item) };
    if (command.kind === "append") return { ...root, items: [...root.items, command.item] };
    throw new Error(`Unexpected fixture command ${command.kind}`);
  };
  const query = <T,>(fn: () => Promise<T>) => Object.assign(fn, { key: "fixture", keyFor: () => ["fixture"], uncached: fn });
  const remote = (label: string) => {
    const lifetime = new AbortController(); lifetimes.set(label, lifetime);
    return {
      accountId: "same-account", epoch: sessionEpoch(), signal: lifetime.signal,
      dispose: () => lifetime.abort(), revalidate: () => {},
      getLocusRoot: query(async () => ({ root: structuredClone(committed) })),
      editLocusRoot: async (_id: string, revision: number, command: LocusRootCommand) => {
        lifetime.signal.throwIfAborted();
        if (revision !== committed.revision) throw Object.assign(new Error("The root changed in another session."), { status: 409 });
        writes.push({ client: label, revision, command: structuredClone(command) });
        committed = { ...apply(committed, command), revision: revision + 1 };
        return { root: structuredClone(committed) };
      }, api: { savedQueryUpdate: async (id: string, patch: { query?: typeof savedQuery }) => {
        if (patch.query) savedQuery = structuredClone(patch.query);
        return { query: { id, query: structuredClone(savedQuery) } };
      } },
    } as unknown as ApiClient;
  };
  const synchronization = createLocusSynchronization();
  await synchronization.setEnabled(false);
  const client = createReaderDraftClient(remote("shared"), { synchronization, createSource: async () => {
    let root = structuredClone(committed);
    let state: LocalTabData = { tabId: root.id, revision: root.revision, entries: root.items.map(item => ({ id: item.id, value: item })),
      values: [{ id: "saved-data", value: { id: "saved-data", slug: "data", query: structuredClone(savedQuery) } }],
      representations: [], layout: root.layout, definitions: { owners: [], fields: [], facets: [] }, rootProjection: root };
    return {
      id: root.id, epoch: sessionEpoch(), firstPaint: async () => {}, readReady: async () => {}, ready: async () => {}, root: () => root, state: () => state, revision: () => state.revision,
      savedValues: () => state.values.map(entry => entry.value),
      dispose: () => {}, snapshot: () => ({ registry: {}, session: { evaluateContext: {} }, types: [], functions: [], functionRows: [], catalog: [] }),
      projectTabData(name: string, ...args: unknown[]) { return (this as unknown as Pick<LocalTabSource, "project">).project(name, ...args); },
      async ordinary(operation: LocalOrdinaryOperation) { return (this as unknown as Pick<LocalTabSource, "project">).project(operation.kind, ...operation.args); },
      project: (name: string, ...args: unknown[]) => {
        if (name === "tabDataCheckRoot") return { $tag: "Ok", _0: true };
        if (name === "tabDataRootCommand") return { $tag: "TabEditRoot", command: args[0] };
        if (name === "tabDataValue") return { $tag: "Just", _0: state.values.find(entry => entry.id === args[1])?.value };
        if (name === "tabDataValues") return state.values.map(entry => entry.value);
        throw new Error(`Unexpected fixture projection ${name}`);
      },
      transact: async (commands: readonly TabCommand[], revision?: number) => {
        if (revision !== undefined && revision !== state.revision) throw new Error("The source changed.");
        for (const command of commands) {
          if (command.$tag === "TabEditRoot") root = apply(root, command.command as LocusRootCommand);
          else if (command.$tag === "TabPatchValue") state = { ...state, values: state.values.map(entry => entry.id === command.id
            ? { ...entry, value: { ...entry.value, ...(command.patch as object) } } : entry) };
          else throw new Error(`Unexpected source command ${command.$tag}`);
        }
        root = { ...root, revision: state.revision + 1 };
        state = { ...state, revision: root.revision, entries: root.items.map(item => ({ id: item.id, value: item })), rootProjection: root };
        return root;
      },
    } as unknown as LocalTabSource;
  } });
  const noAcquisition = () => { throw new Error("Unexpected cold acquisition"); };
  const loader = makeLoader(createSignal, () => remote("preferences-owned"), assertCurrentSession, sessionEpoch, noAcquisition,
    async () => model, async () => ({ selectWorkspacePreferences: (data: LocusRootData) => {
      const item = data.items.find(item => item.id === "settings")!;
      return { id: item.id, value: (item.source as { expr: { value: WorkspacePreferences } }).expr.value };
    } }), workspaceExpression, noAcquisition, draftValueFingerprint, flush, captureRegistryTransportObservation, registryTransportSnapshot);
  const operations: string[] = [];
  const store = await loader("same-account", sessionEpoch(), { accountId: "same-account", personalAccountId: "same-account", epoch: sessionEpoch(),
    root: structuredClone(committed), accounts: [], workspace: { status: "ready", value, valueType: { $ref: "fixture-preferences" }, itemId: settings.id,
      activeLens: { $tag: "Just", _0: value.lenses[0] }, visibleLenses: value.lenses, tilePlan: { columns: 1, rows: 1, lensIds: ["lens"] }, presentations: [] } }, undefined,
    { ordinarySource: async () => ({ epoch: sessionEpoch(), ordinary: async (operation: LocalOrdinaryOperation) => {
      operations.push(operation.kind);
      await options.beforeOperation?.(operation);
      return runLocalOrdinaryOperation(model, operation);
    } }) });
  if (options.prepared !== false) await store.prepare();
  operations.length = 0;
  store.setSynchronization(synchronization); store.setClient(client);
  synchronization.register("preferences", { pending: store.pending, saving: store.saving, error: store.error,
    save: automatic => store.flush(!automatic), discard: store.discard });
  const changeLenses = () => store.update([{ $tag: "SetWorkspaceBar", bar: { ...value.bar, position: { $tag: "BarBottom" } } }]);
  return { client, store, synchronization, writes, lifetimes, changeLenses, initial: value, operations,
    setSavedValue(next: WorkspacePreferences) {
      committed = { ...committed, revision: committed.revision + 1, items: [{ ...settings,
        source: { kind: "expr", expr: workspaceExpression(next) } }] };
    },
    committed: () => committed,
    foreignLensChange: () => { committed = { ...committed, revision: committed.revision + 1, items: [{ ...settings,
      source: { kind: "expr", expr: workspaceExpression({ ...value, activeLensId: "foreign-lens" }) } }] }; },
    savedBar(position: "BarTop" | "BarBottom" | "BarRight") {
      committed = { ...committed, revision: committed.revision + 1, items: [{ ...settings,
        source: { kind: "expr", expr: workspaceExpression({ ...value, bar: { ...value.bar, position: { $tag: position } } }) } }] };
    },
    close: () => { store.dispose(); client.dispose(); },
  };
}

test("same-account data and preference drafts share one CAS source on explicit Save", async () => {
  const f = await fixture();
  try {
    await f.client.editLocusRoot("same-account", 11, { kind: "append", item: { id: "new-data", source: { kind: "expr", expr: { kind: "literal", value: 42 } } } });
    f.changeLenses();
    await Promise.resolve();
    expect(f.writes).toHaveLength(0);
    expect(await f.synchronization.saveAll()).toBe(true);
    expect(f.writes.map(write => [write.client, write.revision])).toEqual([["shared", 11], ["shared", 12]]);
    expect(f.committed().items.some(item => item.id === "new-data")).toBe(true);
    expect(f.store.value().bar.position.$tag).toBe("BarBottom");
    expect(f.store.pending()).toBe(false);
    expect(f.client.drafts.pending()).toBe(0);
    expect(f.synchronization.enabledNow()).toBe(false);
  } finally { f.close(); }
});

test("FIFO planning reads the latest draft and Save waits for accepted unplanned edits", async () => {
  const f = await fixture();
  const entered = deferred(), release = deferred();
  try {
    const first = f.store.planUpdate(async (current: WorkspacePreferences) => {
      entered.resolve(); await release.promise;
      return [{ $tag: "SetWorkspaceBar", bar: { ...current.bar, position: { $tag: "BarBottom" } } }];
    });
    await entered.promise;
    let plannedAgainst: string | undefined;
    const second = f.store.planUpdate((current: WorkspacePreferences) => {
      plannedAgainst = current.bar.position.$tag;
      return [{ $tag: "SetWorkspaceBar", bar: { ...current.bar, position: { $tag: "BarRight" } } }];
    });
    expect(f.store.pending()).toBe(true);
    let settled = false;
    const save = f.store.flush().then((result: boolean) => { settled = true; return result; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(f.writes).toHaveLength(0);
    release.resolve();
    expect(await first).toBe(true); expect(await second).toBe(true); expect(await save).toBe(true);
    expect(plannedAgainst).toBe("BarBottom");
    expect(f.store.value().bar.position.$tag).toBe("BarRight");
    expect(f.store.projection().value).toBe(f.store.value());
    expect(f.writes).toHaveLength(1);
    expect(f.store.pending()).toBe(false);
  } finally { f.close(); }
});

for (const restore of ["discard", "reload"] as const) test(`${restore} invalidates an older edit at admission and later planning sees restored data`, async () => {
  const entered = deferred(), release = deferred();
  let hold = false;
  const f = await fixture({ beforeOperation: async operation => {
    if (hold && operation.kind === "applyWorkspaceCommands") { hold = false; entered.resolve(); await release.promise; }
  } });
  try {
    hold = true;
    const older = f.changeLenses();
    await entered.promise;
    if (restore === "reload") f.savedBar("BarRight");
    const restoring = f.store[restore]();
    let plannedAgainst: string | undefined;
    const newer = f.store.planUpdate((current: WorkspacePreferences) => {
      plannedAgainst = current.bar.position.$tag;
      return [{ $tag: "SetWorkspaceBar", bar: { ...current.bar, position: { $tag: "BarBottom" } } }];
    });
    release.resolve();
    expect(await older).toBe(false);
    await restoring;
    expect(await newer).toBe(true);
    expect(plannedAgainst).toBe(restore === "reload" ? "BarRight" : "BarTop");
    expect(f.store.value().bar.position.$tag).toBe("BarBottom");
    expect(f.store.projection().value).toBe(f.store.value());
    expect(f.writes).toHaveLength(0);
    expect(await f.store.flush()).toBe(true);
    expect(f.writes).toHaveLength(1);
  } finally { f.close(); }
});

test("a command mutated after reduction cannot publish its later render packet", async () => {
  const entered = deferred(), release = deferred();
  let hold = false;
  const f = await fixture({ beforeOperation: async operation => {
    if (hold && operation.kind === "workspaceRenderPublication") { hold = false; entered.resolve(); await release.promise; }
  } });
  try {
    const before = f.store.value(), packet = f.store.projection();
    const commands = [{ $tag: "SetWorkspaceBar", bar: { ...before.bar, position: { $tag: "BarBottom" } } }];
    hold = true;
    const update = f.store.update(commands).catch((problem: Error) => problem);
    await entered.promise;
    commands[0]!.bar.position.$tag = "BarRight";
    release.resolve();
    expect(await update).toBeInstanceOf(Error);
    expect(String(await update)).toContain("transport");
    expect(f.store.value()).toBe(before);
    expect(f.store.projection()).toBe(packet);
    expect(f.writes).toHaveLength(0);
    expect(await f.store.flush()).toBe(false);
  } finally { f.close(); }
});

test("queued commands retain their admission capture while an earlier planner waits", async () => {
  const f = await fixture();
  const entered = deferred(), release = deferred();
  try {
    const first = f.store.planUpdate(async (current: WorkspacePreferences) => {
      entered.resolve(); await release.promise;
      return [{ $tag: "SetWorkspaceBar", bar: { ...current.bar, position: { $tag: "BarBottom" } } }];
    });
    await entered.promise;
    const commands = [{ $tag: "SetWorkspaceBar", bar: { ...f.store.value().bar, position: { $tag: "BarRight" } } }];
    const second = f.store.update(commands).catch((problem: Error) => problem);
    commands[0]!.bar.position.$tag = "BarLeft";
    release.resolve();
    expect(await first).toBe(true);
    expect(await second).toBeInstanceOf(Error);
    expect(f.store.value().bar.position.$tag).toBe("BarBottom");
    expect(f.writes).toHaveLength(0);
  } finally { f.close(); }
});

test("unchanged Date preference data keeps page identities, aliases and equal distinct children", async () => {
  const first = new Date(1234), equal = new Date(1234);
  const data = { first, alias: first, equal };
  const f = await fixture({ subjectData: data });
  try {
    const subject = () => f.store.value().lenses[0].subject._0.data;
    expect(subject()).toBe(data);
    expect(subject().first).toBe(first); expect(subject().alias).toBe(first); expect(subject().equal).toBe(equal);
    expect(await f.changeLenses()).toBe(true);
    expect(subject()).toBe(data);
    expect(subject().first).toBe(first); expect(subject().alias).toBe(first); expect(subject().equal).toBe(equal);
    expect(f.store.projection().value).toBe(f.store.value());
  } finally { f.close(); }
});

test("new queued Date preference commands use one owned copy without merging equal distinct data", async () => {
  const first = new Date(1234), equal = new Date(1234);
  const data = { first, alias: first, equal };
  const f = await fixture();
  try {
    const current = f.store.value();
    expect(await f.store.update([{ $tag: "EditWorkspaceLens", id: "lens", command: { $tag: "SetLensSubject", subject: { $tag: "Just", _0: {
      $tag: "LensTypedSubject", dataType: { $ref: "Anything" }, data,
      originSource: current.lenses[0].source, originFocus: current.lenses[0].focus,
      producer: { $tag: "Nothing" }, producerInput: { $tag: "Nothing" }, producerBinding: { $tag: "Nothing" },
    } } } }])).toBe(true);
    const published = f.store.value().lenses[0].subject._0.data;
    expect(published).not.toBe(data);
    expect(published.first).not.toBe(first);
    expect(published.alias).toBe(published.first);
    expect(published.equal).not.toBe(published.first);
    expect(published.first.getTime()).toBe(1234); expect(published.equal.getTime()).toBe(1234);
    expect(f.store.projection().value).toBe(f.store.value());
  } finally { f.close(); }
});

for (const mutation of ["timestamp", "equal child"] as const) test(`Date ${mutation} mutation after reduction refuses preference publication`, async () => {
  const entered = deferred(), release = deferred();
  let hold = false;
  const f = await fixture({ beforeOperation: async operation => {
    if (hold && operation.kind === "workspaceRenderPublication") { hold = false; entered.resolve(); await release.promise; }
  } });
  try {
    const before = f.store.value(), packet = f.store.projection();
    const date = new Date(1234), data = { date };
    const commands = [{ $tag: "EditWorkspaceLens", id: "lens", command: { $tag: "SetLensSubject", subject: { $tag: "Just", _0: {
      $tag: "LensTypedSubject", dataType: { $ref: "Anything" }, data,
      originSource: before.lenses[0].source, originFocus: before.lenses[0].focus,
      producer: { $tag: "Nothing" }, producerInput: { $tag: "Nothing" }, producerBinding: { $tag: "Nothing" },
    } } } }];
    hold = true;
    const update = f.store.update(commands).catch((problem: Error) => problem);
    await entered.promise;
    if (mutation === "timestamp") date.setTime(5678); else data.date = new Date(1234);
    release.resolve();
    expect(await update).toBeInstanceOf(Error);
    expect(f.store.value()).toBe(before); expect(f.store.projection()).toBe(packet);
    expect(f.writes).toHaveLength(0);
  } finally { f.close(); }
});

test("a false final guard cancels publication while Fenel refusal rejects", async () => {
  const entered = deferred(), release = deferred();
  let hold = false;
  const f = await fixture({ beforeOperation: async operation => {
    if (hold && operation.kind === "workspaceRenderPublication") { hold = false; entered.resolve(); await release.promise; }
  } });
  try {
    let current = true;
    const before = f.store.value();
    hold = true;
    const update = f.store.update([{ $tag: "SetWorkspaceBar", bar: { ...before.bar, position: { $tag: "BarBottom" } } }], () => current);
    await entered.promise; current = false; release.resolve();
    expect(await update).toBe(false);
    expect(f.store.value()).toBe(before);
    expect(f.store.pending()).toBe(false);
    await expect(f.store.update([{ $tag: "SelectWorkspaceLens", id: "missing" }])).rejects.toThrow("no longer");
    expect(f.store.value()).toBe(before);
  } finally { f.close(); }
});

test("a caller guard's own retirement cancels publication without becoming a lens-save failure", async () => {
  // An address opening guards its lens focus with its reader's currentness;
  // that guard throws its own retirement, which the address owner retries.
  // The lens settings neither changed nor failed to save.
  const entered = deferred(), release = deferred();
  let hold = false;
  const f = await fixture({ beforeOperation: async operation => {
    if (hold && operation.kind === "workspaceRenderPublication") { hold = false; entered.resolve(); await release.promise; }
  } });
  try {
    const retired = new Error("This data reader changed while its position was opening. Open it again.");
    let current = true;
    const before = f.store.value(), packet = f.store.projection();
    hold = true;
    const update = f.store.update([{ $tag: "SetWorkspaceBar", bar: { ...before.bar, position: { $tag: "BarBottom" } } }],
      () => { if (!current) throw retired; return true; }).catch((problem: unknown) => problem);
    await entered.promise; current = false; release.resolve();
    expect(await update).toBe(retired);
    expect(f.store.value()).toBe(before);
    expect(f.store.projection()).toBe(packet);
    expect(f.store.error()).toBeUndefined();
    expect(f.store.pending()).toBe(false);
    // The next edit plans and publishes normally.
    expect(await f.changeLenses()).toBe(true);
    expect(f.store.value().bar.position.$tag).toBe("BarBottom");
    expect(f.store.error()).toBeUndefined();
  } finally { f.close(); }
});

test("resize waits for prior mutation and only republishes its latest draft", async () => {
  const projections: Array<{ value: WorkspacePreferences; width: number }> = [];
  const f = await fixture({ beforeOperation: async operation => {
    if (operation.kind === "workspaceRenderPublication") projections.push({ value: operation.args[0], width: operation.args[2] });
  } });
  const entered = deferred(), release = deferred();
  try {
    projections.length = 0;
    const edit = f.store.planUpdate(async (current: WorkspacePreferences) => {
      entered.resolve(); await release.promise;
      return [{ $tag: "SetWorkspaceBar", bar: { ...current.bar, position: { $tag: "BarBottom" } } }];
    });
    await entered.promise;
    const resize = f.store.resize(1500);
    release.resolve(); await edit; await resize;
    expect(projections).toHaveLength(2);
    expect(projections.every(entry => entry.value === f.store.value() && entry.width === 1500)).toBe(true);
    expect(f.store.projection().value).toBe(f.store.value());
    expect(f.writes).toHaveLength(0);
  } finally { f.close(); }
});

test("resuming same-account data and preferences advances only exact shared acknowledgements", async () => {
  const f = await fixture();
  try {
    await f.client.editLocusRoot("same-account", 11, { kind: "append", item: { id: "new-data" } });
    f.changeLenses();
    expect(await f.synchronization.setEnabled(true)).toBe(true);
    expect(f.writes.map(write => write.revision)).toEqual([11, 12]);
    expect(f.synchronization.pending()).toBe(0);
  } finally { f.close(); }
});

test("a foreign lens change is refused while retaining the local preference draft", async () => {
  const f = await fixture();
  try {
    f.changeLenses(); f.foreignLensChange();
    expect(await f.store.flush()).toBe(false);
    expect(f.writes).toHaveLength(0);
    expect(f.store.pending()).toBe(true);
    expect(f.store.error()).toContain("changed in another tab");
    expect(f.store.value().bar.position.$tag).toBe("BarBottom");
  } finally { f.close(); }
});

test("disposing the preference store closes its own raw client and preserves the shared reader lifetime", async () => {
  const f = await fixture();
  try {
    f.store.dispose();
    expect(f.lifetimes.get("preferences-owned")!.signal.aborted).toBe(true);
    expect(f.client.signal.aborted).toBe(false);
  } finally { f.close(); }
});

for (const resume of [false, true]) test(`deferred pane staging precedes source release on ${resume ? "resume" : "explicit Save"}`, async () => {
  const f = await fixture();
  try {
    // Editing saved data moves the local source revision, while its existing
    // HTTP saved-query endpoint does not move the account-root revision.
    await f.client.api.savedQueryUpdate("saved-data", { query: { kind: "expression", expr: { kind: "literal", value: 2 } } });
    const authoredRevision = f.client.drafts.source()!.revision();
    expect(authoredRevision).toBe(12);
    let queued = true;
    f.synchronization.register("pane:deferred", { stageBeforeSave: true, pending: () => queued, saving: () => false, error: () => undefined,
      save: async () => {
        expect(f.synchronization.enabledNow()).toBe(false);
        await f.client.editLocusRoot("same-account", authoredRevision, { kind: "append", item: { id: "queued-card" } });
        queued = false; return true;
      }, discard: async () => { queued = false; return true; } });
    expect(await (resume ? f.synchronization.setEnabled(true) : f.synchronization.saveAll())).toBe(true);
    expect(f.writes.map(write => write.revision)).toEqual([11]);
    expect(f.committed().items.some(item => item.id === "queued-card")).toBe(true);
    expect(f.client.drafts.pending()).toBe(0);
    expect(f.synchronization.enabledNow()).toBe(resume);
  } finally { f.close(); }
});

function restorePreferences(): WorkspacePreferences {
  return { $tag: "WorkspacePreferences", lenses: [{ $tag: "WorkspaceLens", id: "lens", title: { $tag: "Nothing" },
    source: { $tag: "AllDataSource" }, focus: { $tag: "RootFocus" }, presentation: { $tag: "ListPresentation" } }],
    activeLensId: "lens", display: { $tag: "SingleLens" }, bar: { $tag: "WorkspaceBar", mode: { $tag: "DockedBar" }, position: { $tag: "BarTop" } }, presentations: [] };
}
function gridCommands(current: WorkspacePreferences): WorkspaceCommand[] {
  return [{ $tag: "EditWorkspaceLens", id: current.lenses[0]!.id,
    command: { $tag: "SetLensPresentation", presentation: { $tag: "GridPresentation" } } }];
}
async function settleRestore() { for (let tick = 0; tick < 8; tick++) await Promise.resolve(); }
async function restoreFixture(options: { initialPrepared?: boolean; value?: WorkspacePreferences;
  beforeOperation?: (operation: LocalOrdinaryOperation) => void | Promise<void> } = {}) {
  const f = await fixture({ prepared: options.initialPrepared ?? false, initialValue: options.value ?? restorePreferences(),
    beforeOperation: async operation => { await options.beforeOperation?.(operation); } });
  return { ...f, events: f.operations, setRemoteValue: f.setSavedValue };
}

test("early All data Grid edit cancelled by actual Sync Discard restores usable preferences", async () => {
  const entered = deferred(), release = deferred();
  const f = await restoreFixture({ beforeOperation: async operation => {
    if (operation.kind === "workspacePresentationFromCode") { entered.resolve(); await release.promise; }
  } });
  try {
    expect(f.store.prepared()).toBe(false);
    const edit = f.store.planUpdate(async (current: WorkspacePreferences, operate: Function) => {
      const verdict = await operate({ kind: "workspacePresentationFromCode", args: ["grid"] });
      return [{ $tag: "EditWorkspaceLens", id: current.lenses[0]!.id, command: { $tag: "SetLensPresentation", presentation: verdict._0 } }];
    });
    await entered.promise;
    expect(f.synchronization.pending()).toBe(1);
    const discard = f.synchronization.discardAll();
    await settleRestore(); release.resolve();
    expect(await edit).toBe(false); expect(await discard).toBe(true);
    expect(f.store.value()).toBe(f.initial);
    expect(f.store.projection().value).toBe(f.initial);
    expect(f.synchronization.pending()).toBe(0);
    expect(f.store.modelError()).toBeUndefined();
    expect(f.store.prepared()).toBe(true);
    expect(f.events.slice(-2)).toEqual(["validateWorkspacePreferences", "workspaceRenderPublication"]);
  } finally { f.close(); }
});

for (const restore of ["discard", "reload"] as const) for (const initialPrepared of [false, true])
test(`${restore} validates and prepares ${initialPrepared ? "already prepared" : "early unprepared"} restoration in its existing queue`, async () => {
  const f = await restoreFixture({ initialPrepared });
  try {
    await f.store[restore]();
    expect(f.store.prepared()).toBe(true);
    expect(f.store.modelError()).toBeUndefined();
    expect(f.store.projection().value).toBe(f.store.value());
    expect(f.events).toEqual(["validateWorkspacePreferences", "workspaceRenderPublication"]);
    expect(f.store.pending()).toBe(false);
  } finally { f.close(); }
});

for (const restore of ["discard", "reload"] as const)
test(`${restore} cannot publish or mark malformed saved preferences ready`, async () => {
  const malformed = { ...restorePreferences(), lenses: [] };
  const f = await restoreFixture(restore === "discard" ? { value: malformed } : {});
  try {
    const before = f.store.value(), packet = f.store.projection();
    if (restore === "reload") f.setRemoteValue(malformed);
    const outcome = await f.store[restore]().catch((problem: Error) => problem);
    expect(outcome).toBeInstanceOf(Error);
    expect(f.store.value()).toBe(before); expect(f.store.projection()).toBe(packet);
    expect(f.store.prepared()).toBe(false);
    expect(f.events).toEqual(["validateWorkspacePreferences"]);
  } finally { f.close(); }
});

test("successful restoration clears earlier preparation failure only after validated publication", async () => {
  let fail = true;
  const f = await restoreFixture({ beforeOperation: operation => {
    if (fail && operation.kind === "validateWorkspacePreferences") throw new Error("held preparation failed");
  } });
  try {
    const problem = await f.store.prepare().catch((problem: Error) => problem);
    expect(problem).toBeInstanceOf(Error);
    await settleRestore();
    expect(f.store.modelError()).toContain("held preparation failed");
    expect(f.store.prepared()).toBe(false);
    fail = false;
    expect(await f.store.discard()).toBe(true);
    expect(f.store.prepared()).toBe(true);
    expect(f.store.modelError()).toBeUndefined();
  } finally { f.close(); }
});

for (const stage of ["validateWorkspacePreferences", "workspaceRenderPublication"] as const)
test(`restoration ${stage} failure retains the prior value, packet and unprepared state`, async () => {
  const f = await restoreFixture({ beforeOperation: operation => { if (operation.kind === stage) throw new Error(`restore ${stage} failed`); } });
  try {
    const before = f.store.value(), packet = f.store.projection();
    const outcome = await f.store.discard().catch((problem: Error) => problem);
    expect(outcome).toBeInstanceOf(Error);
    expect(f.store.value()).toBe(before); expect(f.store.projection()).toBe(packet);
    expect(f.store.prepared()).toBe(false);
  } finally { f.close(); }
});

test("cancelled restoration cannot publish or mark readiness after disposal", async () => {
  const entered = deferred(), release = deferred();
  const f = await restoreFixture({ beforeOperation: async operation => {
    if (operation.kind === "workspaceRenderPublication") { entered.resolve(); await release.promise; }
  } });
  const before = f.store.value(), packet = f.store.projection();
  const restoring = f.store.discard().catch((problem: Error) => problem);
  await entered.promise;
  f.close(); release.resolve();
  expect(await restoring).toBeInstanceOf(Error);
  expect(f.store.value()).toBe(before); expect(f.store.projection()).toBe(packet);
  expect(f.store.prepared()).toBe(false);
});

for (const action of ["prepare", "edit"] as const)
test(`reentrant public rebind during ${action} publication cannot overwrite the new lifecycle readiness`, async () => {
  let epoch = 7, queuedRebind = false, rebindOnPacket = true;
  let store!: WorkspacePreferencesStore;
  const initial = restorePreferences();
  const noAcquisition = () => { throw new Error("Unexpected account or full-model acquisition"); };
  const boundaryFlush = () => {
    flush();
    if (queuedRebind) { queuedRebind = false; epoch = 8; store.rebindPublicSession(epoch); }
  };
  const loader = makeLoader(createSignal, noAcquisition, (expected: number) => {
    if (expected !== epoch) throw new Error("The session changed while this request was in flight");
  }, () => epoch, noAcquisition, noAcquisition, noAcquisition, workspaceExpression, async () => ({ workspace: {
    status: "ready", value: initial, visibleLenses: initial.lenses, activeLens: { $tag: "Just", _0: initial.lenses[0] },
    tilePlan: { columns: 1, rows: 1, lensIds: ["lens"] }, presentations: [],
  } }), draftValueFingerprint, boundaryFlush, captureRegistryTransportObservation, registryTransportSnapshot);
  store = await loader(undefined, epoch, undefined, undefined, { ordinarySource: async (requestedEpoch: number) => ({
    epoch: requestedEpoch, ordinary: async (operation: LocalOrdinaryOperation) => {
      const result = runLocalOrdinaryOperation(model, operation);
      if (rebindOnPacket && operation.kind === "workspaceRenderPublication") { rebindOnPacket = false; queuedRebind = true; }
      return result;
    },
  }) });
  try {
    if (action === "prepare") await store.prepare();
    else expect(await store.planUpdate(current => gridCommands(current))).toBe(true);
    expect(epoch).toBe(8);
    expect(store.prepared()).toBe(false);
    expect(store.modelError()).toBeUndefined();
    expect(store.projection().value).toBe(store.value());
    await store.prepare();
    expect(store.prepared()).toBe(true);
  } finally { store.dispose(); }
});

for (const restore of ["discard", "reload"] as const)
test(`later edits plan against ${restore}'s validated restored data in FIFO order`, async () => {
  const entered = deferred(), release = deferred();
  const f = await restoreFixture();
  try {
    const older = f.store.planUpdate(async (current: WorkspacePreferences) => { entered.resolve(); await release.promise; return gridCommands(current); });
    await entered.promise;
    if (restore === "reload") f.setRemoteValue({ ...restorePreferences(), bar: { ...restorePreferences().bar, position: { $tag: "BarRight" } } });
    const restoring = restore === "discard" ? f.synchronization.discardAll() : f.store.reload();
    await settleRestore();
    let plannedAgainst: string | undefined;
    const newer = f.store.planUpdate((current: WorkspacePreferences) => { plannedAgainst = current.bar.position.$tag; return gridCommands(current); });
    release.resolve();
    expect(await older).toBe(false); await restoring; expect(await newer).toBe(true);
    expect(plannedAgainst).toBe(restore === "reload" ? "BarRight" : "BarTop");
    expect(f.store.value().lenses[0].presentation.$tag).toBe("GridPresentation");
    expect(f.store.projection().value).toBe(f.store.value());
    expect(f.store.prepared()).toBe(true);
    expect(f.events.slice(0, 2)).toEqual(["validateWorkspacePreferences", "workspaceRenderPublication"]);
  } finally { f.close(); }
});
