import { describe, expect, test } from "bun:test";
import type { ApiClient } from "./api";
import { sessionEpoch } from "./browser-session";
import type { LocalTabData, LocalTabSource, TabCommand } from "./local-locus-data";
import type { LocusRootCommand, LocusRootData } from "./locus-root-data";
import { createReaderDraftClient } from "./reader-draft-client";

function fixture(options: { enabled?: boolean; failRoot?: boolean; failFirstRoot?: boolean; rootWait?: Promise<void>; queryWait?: Promise<void>;
  failSecondQuery?: boolean; failRefresh?: boolean; refreshWait?: Promise<void>; secondStageWait?: Promise<void>;
  onRefreshStart?: () => void; listDirtyIds?: string[]; qualifiedRepresentations?: boolean } = {}) {
  const lifetime = new AbortController();
  const baseQuery = { kind: "expression", expr: { kind: "literal", value: "saved" } };
  let root = { id: "account-root", revision: 11, items: [], lists: [{ id: "list", name: "Original", rootRevision: 11,
    view: { kind: "list", items: [{ id: "card-a" }, { id: "card-b" }] } }], referenceId: "account-reference", persisted: true, canEdit: true } as unknown as LocusRootData;
  let state: LocalTabData = { tabId: root.id, revision: 11, entries: [], values: [{ id: "saved-data",
    value: { id: "saved-data", slug: "saved", query: structuredClone(baseQuery) } }], representations: [], layout: { kind: "grid" },
    definitions: { owners: [], fields: [], facets: [] }, rootProjection: root };
  const rootCalls: unknown[][] = [], queryCalls: unknown[][] = [], definitionCalls: unknown[][] = [], liveCalls: unknown[][] = [];
  const instanceCreateCalls: unknown[][] = [], instanceUpdateCalls: unknown[][] = [], instanceDeleteCalls: unknown[][] = [];
  const savedCreateCalls: unknown[][] = [], savedDeleteCalls: unknown[][] = [], listCalls: unknown[][] = [];
  const dispatchReadRows: Array<{ id: string; instance: Record<string, unknown>; valueEncoding?: "fenel-instance-json-v1" }> = [];
  let retired = 0, refreshes = 0, freshRootReads = 0, sourceCreates = 0, enabled = options.enabled ?? false;
  let localWrites = 0;
  let committedQuery = structuredClone(baseQuery);
  const source = {
    id: root.id, epoch: sessionEpoch(), firstPaint: async () => {}, readReady: async () => {}, ready: async () => {}, root: () => root, state: () => state,
    savedValues: () => state.values.map(entry => entry.value),
    snapshot: () => ({ registry: {
      getIdentifiedEntity: (name: string) => name === "Labelable" ? { id: "Labelable", type: { $record: { fields: [
        { name: "label", type: { $ref: "Any" } },
      ] } } } : undefined, getEntity: () => undefined,
    }, session: { evaluateContext: {} }, types: [], functionRows: [], catalog: [] }),
    revision: () => state.revision, dispose: () => { retired++; },
    async ordinary(operation: { kind: string; args: readonly unknown[] }) { return (this as unknown as Pick<LocalTabSource, "project">).project(operation.kind, ...operation.args); },
    metadataTargets: () => [],
    project: (name: string, ...args: unknown[]) => {
      if (name === "tabDataCheckRoot") return { $tag: "Ok", _0: true };
      if (name === "tabDataRootCommand") return { $tag: "TabEditRoot", command: args[0] };
      if (name === "tabDataValues") return state.values.map(entry => entry.value);
      if (name === "tabDataValue") return { $tag: "Just", _0: state.values.find(entry => entry.id === args[1])?.value };
      if (name === "tabDataRepresentationRows") return state.representations.map(entry => entry.value);
      if (name === "browserDataListDirtyIds") return options.listDirtyIds ?? [];
      if (name === "browserDataListCommand") return { $tag: "TabEditList", id: args[0], patch: args[1] };
      if (name === "browserDataList") return { $tag: "Just", _0: root.lists.find(list => list.id === args[1]) };
      throw new Error(`Unexpected source projection ${name}`);
    },
    transact: async (commands: readonly TabCommand[], revision?: number) => {
      localWrites++;
      if (localWrites === 2) await options.secondStageWait;
      if (revision !== undefined && revision !== state.revision) throw new Error("The source revision changed.");
      for (const command of commands) {
        if (command.$tag === "TabEditRoot" && (command.command as LocusRootCommand).kind === "remove"
          && (command.command as { itemId: string }).itemId === "refused") throw new Error("Source admission refused.");
        if (command.$tag === "TabPatchValue") state = { ...state, values: state.values.map(entry => entry.id === command.id
          ? { ...entry, value: { ...entry.value, ...(command.patch as object) } } : entry) };
        if (command.$tag === "TabEditList") root = { ...root, lists: root.lists.map(list => list.id === command.id ? { ...list, ...(command.patch as object) } : list) };
        if (command.$tag === "TabEditValues") for (const rowCommand of command.commands as TabCommand[]) {
          if (rowCommand.$tag === "LocusAppend") state = { ...state, values: [...state.values,
            rowCommand.entry as LocalTabData["values"][number]] };
          if (rowCommand.$tag === "LocusRemove") state = { ...state, values: state.values.filter(entry => entry.id !== rowCommand.id) };
        }
        if (command.$tag === "TabEditRepresentations") for (const rowCommand of command.commands as TabCommand[]) {
          if (rowCommand.$tag === "LocusAppend") state = { ...state, representations: [...state.representations,
            rowCommand.entry as LocalTabData["representations"][number]] };
          if (rowCommand.$tag === "LocusReplace") state = { ...state, representations: state.representations.map(entry => entry.id === rowCommand.id
            ? rowCommand.entry as LocalTabData["representations"][number] : entry) };
          if (rowCommand.$tag === "LocusRemove") state = { ...state, representations: state.representations.filter(entry => entry.id !== rowCommand.id) };
        }
      }
      state = { ...state, revision: state.revision + 1 }; root = { ...root, revision: state.revision,
        lists: root.lists.map(list => ({ ...list, rootRevision: state.revision })) };
      return root;
    },
    saveDefinitions: async () => { state = { ...state, revision: state.revision + 1 }; root = { ...root, revision: state.revision };
      return { snapshot: state.definitions, root }; },
  } as unknown as LocalTabSource;
  const query = <T>(name: string, fn: () => Promise<T>) => Object.assign(fn, { key: name, keyFor: () => [name], uncached: fn });
  const remote = {
    accountId: "account", epoch: sessionEpoch(), signal: lifetime.signal, dispose: () => lifetime.abort(),
    getLocusRoot: query("locusRoot", async () => { freshRootReads++; return { root: { ...root, revision: 99 } }; }),
    getSavedQueries: query("savedQueries", async () => ({ queries: [], categories: [] })),
    getDispatchInstances: query("dispatchInstances", async () => ({ dispatchInstances: dispatchReadRows })),
    editLocusRoot: async (...args: unknown[]) => {
      rootCalls.push(args); await options.rootWait;
      if (options.failRoot || options.failFirstRoot && rootCalls.length === 1) throw new Error("Data changed in another session.");
      return { root: { ...root, revision: (args[1] as number) + 1 } };
    },
    api: {
      savedQueryCreate: async (input: { id: string; query: Record<string, unknown> }) => {
        savedCreateCalls.push([input]); return { query: { ...input } };
      },
      savedQueryDelete: async (...args: unknown[]) => { savedDeleteCalls.push(args); return { ok: true }; },
      savedQueryUpdate: async (...args: unknown[]) => {
        queryCalls.push(args); await options.queryWait;
        if (options.failSecondQuery && queryCalls.length === 2) throw new Error("The second saved edit conflicted.");
        const patch = args[1] as { query?: typeof baseQuery };
        if (patch.query) committedQuery = structuredClone(patch.query);
        return { query: { id: args[0], query: committedQuery } };
      },
      definitionBundleSave: async (input: unknown) => {
        definitionCalls.push([input]);
        return { snapshot: { owners: [], fields: [], facets: [], storageReceipt: definitionCalls.length } };
      },
      invokeIOAction: async (...args: unknown[]) => { liveCalls.push(args); return { ok: true }; },
      dispatchInstanceCreate: async (input: { id: string; instance: Record<string, unknown>; valueEncoding: string }) => {
        instanceCreateCalls.push([input]);
        return { definition: { id: input.id, instance: { ...input.instance, scope: { kind: "account", accountId: "account" }, priority: 0 },
          valueEncoding: input.valueEncoding ?? "fenel-instance-json-v1" } };
      },
      dispatchInstanceUpdate: async (...args: unknown[]) => {
        instanceUpdateCalls.push(args);
        return { definition: { id: args[0], instance: { ...(args[1] as object), scope: { kind: "account", accountId: "account" }, priority: 0 },
          valueEncoding: args[2] ?? "fenel-instance-json-v1" } };
      },
      dispatchInstanceDelete: async (...args: unknown[]) => { instanceDeleteCalls.push(args); return { ok: true }; },
      locusViewUpdate: async (...args: unknown[]) => {
        listCalls.push(args);
        return { locusView: { id: args[0], rootRevision: (args[1] as { expectedRootRevision: number }).expectedRootRevision + 1 } };
      },
      entityInstancePatch: async () => { throw new Error("Unsupported write reached HTTP."); },
    },
  } as unknown as ApiClient;
  const client = createReaderDraftClient(remote, { createSource: async () => { sourceCreates++; return source; }, enabledNow: () => enabled,
    ...(options.qualifiedRepresentations === true ? { canStageRepresentations: () => true } : {}),
    onDefinitionsChanged: async () => { refreshes++; options.onRefreshStart?.(); await options.refreshWait;
      if (options.failRefresh && refreshes === 1) throw new Error("Reader refresh failed."); } });
  return { client, source, baseQuery, rootCalls, queryCalls, definitionCalls, liveCalls,
    instanceCreateCalls, instanceUpdateCalls, instanceDeleteCalls, setEnabled: (value: boolean) => { enabled = value; },
    savedCreateCalls, savedDeleteCalls, listCalls,
    dispatchReadRows,
    counters: () => ({ retired, refreshes, freshRootReads, sourceCreates }) };
}

describe("account browser draft transport", () => {
  test("paused edits use the captured source, mark exact data, and keep HTTP silent until Save", async () => {
    const f = fixture();
    try {
      expect(f.client.drafts.source()).toBeUndefined();
      const command = { kind: "append", item: { id: "new-card", refId: "saved-data" } } as unknown as LocusRootCommand;
      const changed = await f.client.editLocusRoot("account-root", 11, command);
      expect(changed.root.revision).toBe(12);
      expect(f.rootCalls).toHaveLength(0);
      expect(f.client.drafts.pending()).toBe(1);
      expect(f.client.drafts.dirty("new-card")).toBe(true);
      expect(f.client.drafts.dirty("account-reference")).toBe(true);
      expect((await f.client.getLocusRoot()).root.revision).toBe(12);
      expect(await f.client.drafts.save()).toBe(true);
      expect(f.rootCalls).toEqual([["account-root", 11, command]]);
      expect(f.client.drafts.pending()).toBe(0);
      expect(f.client.drafts.source()).toBeUndefined();
      expect(f.counters()).toMatchObject({ refreshes: 1, retired: 1, freshRootReads: 0, sourceCreates: 1 });
    } finally { f.client.dispose(); }
  });

  test("server CAS uses the original committed root and preserves a conflicting draft", async () => {
    const f = fixture({ failRoot: true });
    try {
      await f.client.editLocusRoot("account-root", 11, { kind: "remove", itemId: "old-card" });
      expect(await f.client.drafts.save()).toBe(false);
      expect(f.rootCalls[0]?.[1]).toBe(11);
      expect(f.client.drafts.pending()).toBe(1);
      expect(f.client.drafts.error()).toContain("another session");
      expect(f.counters().freshRootReads).toBe(0);
      expect(f.client.drafts.source()).toBe(f.source);
      expect(await f.client.drafts.discard()).toBe(true);
      expect(f.client.drafts.pending()).toBe(0);
    } finally { f.client.dispose(); }
  });

  test("saved-expression preconditions advance from acknowledgements in source order", async () => {
    const f = fixture();
    try {
      const first = { kind: "expression", expr: { kind: "literal", value: "first" } };
      const second = { kind: "expression", expr: { kind: "literal", value: "second" } };
      await f.client.api.savedQueryUpdate("saved-data", { query: first });
      await f.client.api.savedQueryUpdate("saved-data", { query: second });
      expect(f.queryCalls).toHaveLength(0);
      expect((await f.client.getSavedQueries()).queries[0].query).toEqual(second);
      expect(await f.client.drafts.save()).toBe(true);
      expect(f.queryCalls).toEqual([["saved-data", { query: first, expectedQuery: f.baseQuery }],
        ["saved-data", { query: second, expectedQuery: first }]]);
    } finally { f.client.dispose(); }
  });

  test("edits arriving during a save stay pending and retain the next exact server revision", async () => {
    let release!: () => void;
    const f = fixture({ rootWait: new Promise(resolve => { release = resolve; }) });
    try {
      await f.client.editLocusRoot("account-root", 11, { kind: "remove", itemId: "first" });
      const saving = f.client.drafts.save();
      await Promise.resolve(); await Promise.resolve();
      await f.client.editLocusRoot("account-root", 12, { kind: "remove", itemId: "second" });
      expect(f.client.drafts.pending()).toBe(2);
      release();
      expect(await saving).toBe(true);
      expect(f.client.drafts.pending()).toBe(1);
      expect(f.client.drafts.dirty("second")).toBe(true);
      expect(f.counters().refreshes).toBe(0);
      expect(await f.client.drafts.save()).toBe(true);
      expect(f.rootCalls.map(call => call[1])).toEqual([11, 12]);
    } finally { f.client.dispose(); }
  });

  test("definition writes carry the complete original graph, then the successful persisted graph", async () => {
    const f = fixture();
    try {
      await f.client.api.definitionBundleSave({ ownerMutations: [] });
      await f.client.api.definitionBundleSave({ ownerMutations: [] });
      expect(await f.client.drafts.save()).toBe(true);
      expect((f.definitionCalls[0]?.[0] as { expectedSnapshot: unknown }).expectedSnapshot).toEqual({ owners: [], fields: [], facets: [] });
      expect((f.definitionCalls[1]?.[0] as { expectedSnapshot: unknown }).expectedSnapshot).toEqual({ owners: [], fields: [], facets: [], storageReceipt: 1 });
    } finally { f.client.dispose(); }
  });

  test("pausing automatic synchronization between acknowledgements leaves the remaining writes in the browser", async () => {
    let release!: () => void;
    const f = fixture({ rootWait: new Promise(resolve => { release = resolve; }) });
    try {
      await f.client.editLocusRoot("account-root", 11, { kind: "remove", itemId: "first" });
      await f.client.editLocusRoot("account-root", 12, { kind: "remove", itemId: "second" });
      f.setEnabled(true);
      const saving = f.client.drafts.save();
      await Promise.resolve(); await Promise.resolve();
      f.setEnabled(false); release();
      expect(await saving).toBe(true);
      expect(f.rootCalls).toHaveLength(1);
      expect(f.client.drafts.pending()).toBe(1);
      expect(f.client.drafts.error()).toBeUndefined();
      expect(await f.client.drafts.save()).toBe(true);
      expect(f.rootCalls.map(call => call[1])).toEqual([11, 12]);
    } finally { f.client.dispose(); }
  });

  test("failed suffix retries retain the acknowledgement baseline without replaying the successful prefix", async () => {
    const f = fixture({ failSecondQuery: true });
    try {
      const first = { kind: "expression", expr: { kind: "literal", value: "first" } };
      const second = { kind: "expression", expr: { kind: "literal", value: "second" } };
      await f.client.api.savedQueryUpdate("saved-data", { query: first });
      await f.client.api.savedQueryUpdate("saved-data", { query: second });
      expect(await f.client.drafts.save()).toBe(false);
      expect(f.client.drafts.pending()).toBe(1);
      expect(await f.client.drafts.save()).toBe(true);
      expect(f.queryCalls).toHaveLength(3);
      expect(f.queryCalls[2]).toEqual(["saved-data", { query: second, expectedQuery: first }]);
    } finally { f.client.dispose(); }
  });

  test("an acknowledged draft retains its reader refresh retry until the committed reader is ready", async () => {
    const f = fixture({ failRefresh: true });
    try {
      await f.client.editLocusRoot("account-root", 11, { kind: "remove", itemId: "first" });
      expect(await f.client.drafts.save()).toBe(false);
      expect(f.client.drafts.pending()).toBe(1);
      expect(f.client.drafts.dirty("first")).toBe(false);
      expect(f.client.drafts.source()).toBe(f.source);
      expect(f.client.drafts.error()).toBe("Reader refresh failed.");
      expect(await f.client.drafts.save()).toBe(true);
      expect(f.rootCalls).toHaveLength(1);
      expect(f.client.drafts.source()).toBeUndefined();
      expect(f.client.drafts.pending()).toBe(0);
    } finally { f.client.dispose(); }
  });

  test("a new edit still preparing during committed-reader refresh keeps its source alive", async () => {
    let releaseRefresh!: () => void, releaseEdit!: () => void;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>(resolve => { markRefreshStarted = resolve; });
    const f = fixture({ refreshWait: new Promise(resolve => { releaseRefresh = resolve; }),
      secondStageWait: new Promise(resolve => { releaseEdit = resolve; }), onRefreshStart: markRefreshStarted });
    try {
      await f.client.editLocusRoot("account-root", 11, { kind: "remove", itemId: "first" });
      const saving = f.client.drafts.save();
      await refreshStarted;
      expect(f.counters().refreshes).toBe(1);
      const edit = f.client.editLocusRoot("account-root", 12, { kind: "remove", itemId: "still-preparing" });
      await Promise.resolve(); await Promise.resolve();
      releaseRefresh();
      expect(await saving).toBe(true);
      expect(f.counters().retired).toBe(0);
      expect(f.client.drafts.source()).toBe(f.source);
      releaseEdit(); await edit;
      expect(f.client.drafts.pending()).toBe(1);
      expect(f.client.drafts.dirty("still-preparing")).toBe(true);
      expect(await f.client.drafts.save()).toBe(true);
    } finally { f.client.dispose(); }
  });

  test("saved editor preconditions remain bound to what was authored even when the source acquired newer data", async () => {
    const f = fixture();
    try {
      const originallyRead = { kind: "expression", expr: { kind: "literal", value: "older editor" } };
      const authored = { kind: "expression", expr: { kind: "literal", value: "authored" } };
      await f.client.api.savedQueryUpdate("saved-data", { query: authored, expectedQuery: originallyRead });
      expect(await f.client.drafts.save()).toBe(true);
      expect(f.queryCalls).toEqual([["saved-data", { query: authored, expectedQuery: originallyRead }]]);
    } finally { f.client.dispose(); }
  });

  test("representation promotion keeps its authored identity and uses the actual server definition receipt for later preconditions", async () => {
    const f = fixture({ qualifiedRepresentations: true });
    try {
      const first = { typeName: "Labelable", args: ["saved-data"], methods: { label: "draft" } };
      const created = await f.client.api.dispatchInstanceCreate({ typeName: "Labelable", args: ["saved-data"], instance: first });
      const id = created.dispatchInstance.id;
      const second = { ...first, methods: { label: "changed" } };
      await f.client.api.dispatchInstanceUpdate(id, second);
      await f.client.api.dispatchInstanceDelete(id);
      expect(f.instanceCreateCalls).toHaveLength(0);
      expect(await f.client.drafts.save()).toBe(true);
      expect((f.instanceCreateCalls[0]?.[0] as { id: string }).id).toBe(id);
      expect(f.instanceUpdateCalls[0]?.[3]).toEqual({ ...first, scope: { kind: "account", accountId: "account" }, priority: 0 });
      expect(f.instanceDeleteCalls[0]?.[1]).toEqual({ ...second, scope: { kind: "account", accountId: "account" }, priority: 0 });
      expect(f.client.drafts.pending()).toBe(0);
    } finally { f.client.dispose(); }
  });

  test("new saved data preserves its draft identity, and subsequent deletion uses its successful create baseline", async () => {
    const f = fixture();
    try {
      const input = { slug: "new", query: { kind: "expression", expr: { kind: "literal", value: "new" } } };
      const created = await f.client.api.savedQueryCreate(input);
      await f.client.api.savedQueryDelete(created.query.id);
      expect(f.savedCreateCalls).toHaveLength(0);
      expect(await f.client.drafts.save()).toBe(true);
      expect(f.savedCreateCalls).toEqual([[{ ...input, id: created.query.id }]]);
      expect(f.savedDeleteCalls).toEqual([[created.query.id, input.query]]);
    } finally { f.client.dispose(); }
  });

  test("a fresh lookup at submit cannot replace the representation baseline originally delivered to its editor", async () => {
    const f = fixture({ qualifiedRepresentations: true });
    try {
      const original = { typeName: "Labelable", args: ["saved-data"], methods: { label: "original editor" } };
      const external = { ...original, methods: { label: "changed by someone else" } };
      f.dispatchReadRows.push({ id: "existing-representation", instance: original, valueEncoding: "fenel-instance-json-v1" });
      await f.client.getDispatchInstances();
      f.dispatchReadRows[0] = { id: "existing-representation", instance: external, valueEncoding: "fenel-instance-json-v1" };
      await f.client.getDispatchInstances.uncached();
      f.source.state().representations.push({ id: "existing-representation", value: { id: "existing-representation",
        typeName: "Labelable", args: ["saved-data"], instance: external } });
      await f.client.api.dispatchInstanceUpdate("existing-representation", { ...original, methods: { label: "my edit" } });
      expect(await f.client.drafts.save()).toBe(true);
      expect(f.instanceUpdateCalls[0]?.[3]).toEqual(original);
    } finally { f.client.dispose(); }
  });

  test("list edits mark only the Fenel planner's changed cards and advance root CAS from the list acknowledgement", async () => {
    const f = fixture({ listDirtyIds: ["card-b"] });
    try {
      const view = { kind: "list", items: [{ id: "card-a" }, { id: "card-b", expanded: false }] };
      await f.client.api.locusViewUpdate("list", { view, expectedRootRevision: 11 });
      expect(f.client.drafts.dirty("list")).toBe(true);
      expect(f.client.drafts.dirty("card-a")).toBe(false);
      expect(f.client.drafts.dirty("card-b")).toBe(true);
      await f.client.editLocusRoot("account-root", 12, { kind: "remove", itemId: "following" });
      expect(await f.client.drafts.save()).toBe(true);
      expect(f.listCalls).toEqual([["list", { view, expectedRootRevision: 11 }]]);
      expect(f.rootCalls[0]?.[1]).toBe(12);
    } finally { f.client.dispose(); }
  });

  test("name-only list changes carry the retained view so the server enforces the same exact root CAS", async () => {
    const f = fixture();
    try {
      const original = structuredClone(f.source.root().lists[0]!.view);
      await f.client.api.locusViewUpdate("list", { name: "Renamed" });
      expect(await f.client.drafts.save()).toBe(true);
      expect(f.listCalls).toEqual([["list", { name: "Renamed", view: original, expectedRootRevision: 11 }]]);
      expect(f.client.drafts.dirty("card-a")).toBe(false);
    } finally { f.client.dispose(); }
  });

  test("an unqualified account reader refuses paused representation rules before creating or publishing a browser source", async () => {
    const f = fixture();
    try {
      const instance = { typeName: "Labelable", args: ["saved-data"], methods: { label: "blocked" } };
      expect(() => f.client.api.dispatchInstanceCreate({ typeName: "Labelable", args: ["saved-data"], instance })).toThrow("synchronization on");
      expect(() => f.client.api.dispatchInstanceUpdate("existing", instance)).toThrow("synchronization on");
      expect(() => f.client.api.dispatchInstanceDelete("existing")).toThrow("synchronization on");
      expect(() => f.client.writeDispatchInstances!([{ typeName: "Labelable", args: ["saved-data"], instance }], 11)).toThrow("synchronization on");
      expect(f.client.drafts.pending()).toBe(0);
      expect(f.client.drafts.source()).toBeUndefined();
      expect(f.source.revision()).toBe(11);
      expect(f.counters().sourceCreates).toBe(0);
      expect(f.instanceCreateCalls).toHaveLength(0);
      expect(f.instanceUpdateCalls).toHaveLength(0);
      expect(f.instanceDeleteCalls).toHaveLength(0);
    } finally { f.client.dispose(); }
  });

  test("unqualified synchronized representation writes retain the existing direct HTTP path", async () => {
    const f = fixture({ enabled: true });
    try {
      const instance = { typeName: "Labelable", args: ["saved-data"], methods: { label: "direct" } };
      await f.client.writeDispatchInstances!([{ existingId: "first", typeName: "Labelable", args: ["saved-data"], instance },
        { existingId: "second", typeName: "Labelable", args: ["saved-data"], instance }], 11);
      expect(f.instanceUpdateCalls.map(call => call[0])).toEqual(["first", "second"]);
      expect(f.client.drafts.pending()).toBe(0);
      expect(f.client.drafts.source()).toBeUndefined();
      expect(f.counters().sourceCreates).toBe(0);
      expect(f.source.revision()).toBe(11);
    } finally { f.client.dispose(); }
  });

  test("admission refusals do not journal, unsupported paused writes fail, and Run remains live", async () => {
    const f = fixture();
    try {
      await expect(f.client.editLocusRoot("account-root", 11, { kind: "remove", itemId: "refused" })).rejects.toThrow("admission refused");
      expect(f.client.drafts.pending()).toBe(0);
      expect(() => f.client.api.entityInstancePatch("entity", {})).toThrow("synchronization paused");
      await f.client.api.invokeIOAction("send", ["now"]);
      expect(f.liveCalls).toEqual([["send", ["now"]]]);
      expect(f.client.drafts.pending()).toBe(0);
    } finally { f.client.dispose(); }
  });

  test("enabled ordinary writes keep the direct endpoint and avoid preparing browser drafts", async () => {
    const f = fixture({ enabled: true });
    try {
      await f.client.editLocusRoot("account-root", 11, { kind: "remove", itemId: "direct" });
      expect(f.rootCalls).toHaveLength(1);
      expect(f.client.drafts.pending()).toBe(0);
      expect(f.counters().sourceCreates).toBe(0);
    } finally { f.client.dispose(); }
  });

  test("local receipts retain their exact source origin after explicit Save and Discard clear the overlay", async () => {
    const saved = fixture(), discarded = fixture();
    try {
      const saveReceipt = await saved.client.editLocusRoot("account-root", 11, { kind: "remove", itemId: "save" });
      expect(saved.client.drafts.resultSource(saveReceipt)).toBe(saved.source);
      expect(await saved.client.drafts.save()).toBe(true);
      expect(saved.client.drafts.source()).toBeUndefined();
      expect(saved.client.drafts.resultSource(saveReceipt)).toBe(saved.source);
      const discardReceipt = await discarded.client.editLocusRoot("account-root", 11, { kind: "remove", itemId: "discard" });
      expect(await discarded.client.drafts.discard()).toBe(true);
      expect(discarded.client.drafts.source()).toBeUndefined();
      expect(discarded.client.drafts.resultSource(discardReceipt)).toBe(discarded.source);
      expect(saved.client.drafts.resultSource(null)).toBeUndefined();
      expect(saved.client.drafts.resultSource(12)).toBeUndefined();
    } finally { saved.client.dispose(); discarded.client.dispose(); }
  });

  test("automatic save clears its overlay before returning an already admitted local receipt without losing that receipt's origin", async () => {
    const f = fixture({ enabled: true });
    try {
      const query = { kind: "expression", expr: { kind: "literal", value: "automatically saved" } };
      const receipt = await f.client.editSavedValue!("saved-data", query, 11);
      expect(f.client.drafts.source()).toBeUndefined();
      expect(f.client.drafts.resultSource(receipt)).toBe(f.source);
      expect(f.client.drafts.resultSource(receipt)).not.toBe(f.client.drafts.source());
      const remoteReceipt = await f.client.editLocusRoot("account-root", 11, { kind: "remove", itemId: "remote" });
      expect(f.client.drafts.resultSource(remoteReceipt)).toBeUndefined();
      expect(f.client.drafts.resultSource(remoteReceipt)).toBe(f.client.drafts.source());
    } finally { f.client.dispose(); }
  });

  test("list receipts retain the exact server CAS acknowledgement after virtual revisions diverge and automatic Save clears the source", async () => {
    const f = fixture();
    try {
      await f.client.api.savedQueryUpdate("saved-data", { query: { kind: "expression", expr: { kind: "literal", value: "changed" } } });
      expect(f.source.revision()).toBe(12);
      f.setEnabled(true);
      const receipt = await f.client.api.locusViewUpdate("list", { view: { kind: "list", items: [{ id: "card-a" }] }, expectedRootRevision: 12 });
      expect(f.client.drafts.resultSource(receipt)).toBe(f.source);
      expect(f.client.drafts.source()).toBeUndefined();
      expect(f.source.revision()).toBe(13);
      expect(receipt.locusView.rootRevision).toBe(13);
      expect(f.client.drafts.resultRootRevision(receipt)).toBe(12);
      const second = await f.client.api.locusViewUpdate("list", { view: { kind: "list", items: [] },
        expectedRootRevision: f.client.drafts.resultRootRevision(receipt) });
      expect(f.listCalls.map(call => (call[1] as { expectedRootRevision: number }).expectedRootRevision)).toEqual([11, 12]);
      expect(f.client.drafts.resultSource(second)).toBeUndefined();
    } finally { f.client.dispose(); }
  });

  test("only acknowledged root/list writes produce a receipt's server root revision", async () => {
    const conflicting = fixture({ failRoot: true }), savedOnly = fixture({ enabled: true }), discarded = fixture();
    try {
      const refused = await conflicting.client.editLocusRoot("account-root", 11, { kind: "remove", itemId: "conflict" });
      expect(conflicting.client.drafts.resultRootRevision(refused)).toBeUndefined();
      expect(await conflicting.client.drafts.save()).toBe(false);
      expect(conflicting.client.drafts.resultRootRevision(refused)).toBeUndefined();
      const queryReceipt = await savedOnly.client.editSavedValue!("saved-data", { kind: "expression", expr: { kind: "literal", value: "query-only" } }, 11);
      expect(savedOnly.client.drafts.source()).toBeUndefined();
      expect(savedOnly.client.drafts.resultRootRevision(queryReceipt)).toBeUndefined();
      const abandoned = await discarded.client.editLocusRoot("account-root", 11, { kind: "remove", itemId: "abandon" });
      expect(await discarded.client.drafts.discard()).toBe(true);
      expect(discarded.client.drafts.resultRootRevision(abandoned)).toBeUndefined();
    } finally { conflicting.client.dispose(); savedOnly.client.dispose(); discarded.client.dispose(); }
  });

  test("automatic save failure returns the admitted receipt and retries its journal without applying the mutation twice", async () => {
    const f = fixture({ enabled: true, failFirstRoot: true });
    try {
      const query = { kind: "expression", expr: { kind: "literal", value: "accepted before network failure" } };
      const receipt = await f.client.editSavedValue!("saved-data", query, 11, { kind: "remove", itemId: "first" });
      expect(receipt.root.revision).toBe(12);
      expect(f.client.drafts.resultSource(receipt)).toBe(f.source);
      expect(f.client.drafts.resultRootRevision(receipt)).toBeUndefined();
      expect(f.client.drafts.pending()).toBe(1);
      expect(f.client.drafts.error()).toContain("another session");
      expect(f.source.revision()).toBe(12);
      expect(f.queryCalls).toHaveLength(1);
      f.setEnabled(false);
      const next = await f.client.editLocusRoot("account-root", 12, { kind: "remove", itemId: "second" });
      expect(next.root.revision).toBe(13);
      expect(f.client.drafts.pending()).toBe(2);
      expect(await f.client.drafts.save()).toBe(true);
      expect(f.rootCalls.map(call => call[1])).toEqual([11, 11, 12]);
      expect(f.queryCalls).toHaveLength(1);
      expect(f.source.revision()).toBe(13);
      expect(f.client.drafts.resultRootRevision(receipt)).toBe(12);
      expect(f.client.drafts.pending()).toBe(0);
    } finally { f.client.dispose(); }
  });
});
