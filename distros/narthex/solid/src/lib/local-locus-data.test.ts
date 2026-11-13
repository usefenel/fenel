import { describe, expect, test } from "bun:test";
import { createLocalApiClient, localTabDataSource, localTabSourceId, type LocalTabSource } from "./local-locus-data";
import { sessionEpoch } from "./browser-session";

function sourceFixture(ready: Promise<void> = Promise.resolve(), snapshot?: ReturnType<LocalTabSource["snapshot"]>) {
  const writes: unknown[][] = [];
  const root = { id: "this-tab-source", revision: 0, items: [], persisted: false, canEdit: true };
  const projectTabData = (name: string, ...args: unknown[]) => {
    if (name === "tabDataValues" || name === "tabDataRepresentationRows") return [];
    if (name === "tabDataCheckRoot") return { $tag: "Ok", _0: true };
    if (name === "tabDataRootCommand") return { $tag: "TabEditRoot", command: args[0] };
    throw new Error(`Unexpected fixture projection ${name}`);
  };
  const source = {
    id: root.id, epoch: sessionEpoch(), firstPaint: () => ready, readReady: () => ready, ready: () => ready, root: () => root, savedValues: () => [],
    revision: () => root.revision,
    state: () => ({ values: [], representations: [] }),
    snapshot: () => snapshot ?? ({ types: [], functionRows: [] }),
    project: projectTabData, ordinary: async (operation: { kind: string; args: unknown[] }) => projectTabData(operation.kind, ...operation.args), metadataTargets: () => [],
    transact: async (...args: unknown[]) => { writes.push(args); return root; },
    saveDefinitions: async () => { throw new Error("Unexpected definition write"); },
  } as unknown as LocalTabSource;
  return { source, writes };
}

describe("tab-local transport lifetime", () => {
  test("unknown JavaScript promise and iterator protocols stay absent on the client and action namespace", async () => {
    const { source } = sourceFixture();
    const client = createLocalApiClient(source);
    try {
      for (const value of [client, client.api]) {
        expect(Reflect.get(value, Symbol.asyncIterator)).toBeUndefined();
        expect(Reflect.get(value, Symbol.iterator)).toBeUndefined();
        expect(Reflect.get(value, "then")).toBeUndefined();
        expect(await Promise.resolve(value)).toBe(value);
      }
      expect(typeof client.getLocusRoot).toBe("function");
      expect(client.drafts).toBeUndefined();
      expect(client.drafts?.revision()).toBeUndefined();
      expect(typeof client.api.savedQueryCreate).toBe("function");
      expect(() => client.api.invokeIOAction("send", [])).toThrow("unavailable in This tab");
    } finally { client.dispose(); }
  });

  test("combined definition/data transport captures the authored revision and both drafts before preparation waits", async () => {
    let release!: () => void;
    const { source } = sourceFixture(new Promise(resolve => { release = resolve; }));
    const submitted: unknown[][] = [];
    source.saveDefinitions = async (...args) => {
      submitted.push(args);
      return { snapshot: { owners: [], fields: [], facets: [] }, root: source.root() };
    };
    const client = createLocalApiClient(source);
    const bundle = { ownerMutations: [] };
    const occurrence = { kind: "replace" as const, itemId: "occurrence", item: { id: "occurrence",
      representations: { Iconable: { icon: "star" } } } };
    const query = { kind: "expression", expr: { kind: "literal", value: "hi" } };
    const pending = client.editDefinitionAndData!(bundle, 7, { occurrence, savedValue: { id: "data", query } });
    occurrence.item.representations.Iconable.icon = "later";
    query.expr.value = "later";
    release();
    await pending;
    expect(submitted).toHaveLength(1);
    expect(submitted[0]![1]).toBe(client.signal);
    expect(submitted[0]![2]).toEqual({ expectedRevision: 7, commands: [
      { $tag: "TabPatchValue", id: "data", patch: { query: { kind: "expression", expr: { kind: "literal", value: "hi" } } } },
      { $tag: "TabEditRoot", command: { kind: "replace", itemId: "occurrence", item: { id: "occurrence",
        representations: { Iconable: { icon: "star" } } } } },
    ] });
    client.dispose();
  });

  test("a closed local reader cannot start a combined definition/data transaction after preparation", async () => {
    let release!: () => void;
    const { source } = sourceFixture(new Promise(resolve => { release = resolve; }));
    let writes = 0;
    source.saveDefinitions = async () => {
      writes++;
      return { snapshot: { owners: [], fields: [], facets: [] }, root: source.root() };
    };
    const client = createLocalApiClient(source);
    const pending = client.editDefinitionAndData!({ ownerMutations: [] }, 0);
    client.dispose(); release();
    await expect(pending).rejects.toThrow("closed");
    expect(writes).toBe(0);
  });

  test("definition reads retain checked local owner rows after canonical identity lookup", async () => {
    const type = { id: "5f6fcba9-e0cc-4db7-b4ac-7d5a4fd6ca0d", type: { $ref: "Number" } };
    const fn = { id: "c31057ed-291b-4b96-9cd1-c97a68738fc3", params: [], returns: type.type, body: 42 };
    const typeRow = { ...type, name: type.id, isSystem: false };
    const functionRow = { id: fn.id, name: fn.id, function: fn, isSystem: false };
    const { source } = sourceFixture(Promise.resolve(), {
      types: [typeRow], functionRows: [functionRow], readPresentations: async () => [], registry: {
        getIdentifiedEntity: (name: string) => name === "type-alias" || name === type.id ? type : undefined,
        getFunction: (name: string) => name === "function-alias" || name === fn.id ? fn : undefined,
        getEntityNominalIdentity: () => undefined, getUuid: () => undefined,
      }, session: { evaluateContext: {} }, catalog: [],
    } as unknown as ReturnType<LocalTabSource["snapshot"]>);
    const client = createLocalApiClient(source);
    try {
      expect((await client.getTypeByName("type-alias")).definition).toMatchObject(typeRow);
      expect((await client.getFunctionByName("function-alias")).definition).toMatchObject(functionRow);
      expect((await client.getFunctionByName(fn.id)).definition.id).toBe(fn.id);
      expect((await client.getTypeByName(type.id)).definition.name).toBe(type.id);
      expect(client.accountId).toBeUndefined();
    } finally { client.dispose(); }
  });

  test("repository definitions remain inspectable and read-only, and missing definitions stay absent", async () => {
    const type = { id: "f31c1fd4-8a5a-4884-8377-4e433e4d0e6e", type: { $ref: "String" } };
    const fn = { id: "c021bf26-b777-4cb9-a1dd-8f3e62751f5f", params: [], returns: type.type, body: "repository" };
    const { source } = sourceFixture(Promise.resolve(), {
      types: [], functionRows: [], readPresentations: async () => [], registry: {
        getIdentifiedEntity: (name: string) => name === "Repository.type" ? type : undefined,
        getFunction: (name: string) => name === "Repository.function" ? fn : undefined,
        getEntityNominalIdentity: () => undefined, getUuid: () => undefined,
      }, session: { evaluateContext: {} }, catalog: [],
    } as unknown as ReturnType<LocalTabSource["snapshot"]>);
    const client = createLocalApiClient(source);
    try {
      expect((await client.getTypeByName("Repository.type")).definition).toMatchObject({ ...type, name: type.id, isSystem: true });
      expect((await client.getFunctionByName("Repository.function")).definition).toMatchObject({ id: fn.id, name: fn.id, function: fn, isSystem: true });
      expect((await client.getTypeByName("missing")).definition).toBeNull();
      expect((await client.getFunctionByName("missing")).definition).toBeNull();
    } finally { client.dispose(); }
  });

  test("uses its real root identity without inventing account authority", async () => {
    const { source } = sourceFixture();
    const client = createLocalApiClient(source);
    expect(client.accountId).toBeUndefined();
    expect((client as typeof client & { rootId: string }).rootId).toBe(source.id);
    expect((await client.getLocusRoot()).root.id).toBe(source.id);
    client.dispose();
  });

  test("unsupported reads and host acts refuse without invoking fetch", async () => {
    const { source, writes } = sourceFixture();
    const client = createLocalApiClient(source);
    const previous = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls++; throw new Error("Network must remain unused"); }) as unknown as typeof fetch;
    try {
      await expect(client.apiRead("/account")).rejects.toThrow("unavailable in This tab");
      expect(() => client.api.invokeIOAction("send", [])).toThrow("unavailable in This tab");
      expect(calls).toBe(0);
      expect(writes).toHaveLength(0);
    } finally { globalThis.fetch = previous; client.dispose(); }
  });

  test("closing a reader while preparation waits cannot publish a local write", async () => {
    let release!: () => void;
    const { source, writes } = sourceFixture(new Promise(resolve => { release = resolve; }));
    const client = createLocalApiClient(source);
    const pending = client.api.savedQueryCreate({ slug: "temporary", query: { kind: "expression", expr: { kind: "literal", value: 42 } } });
    client.dispose(); release();
    await expect(pending).rejects.toThrow("closed");
    expect(writes).toHaveLength(0);
  });

  test("passes data and expression type metadata unchanged to Fenel commands", async () => {
    const { source, writes } = sourceFixture();
    const client = createLocalApiClient(source);
    const query = { kind: "expression", expr: { kind: "literal", value: { call: ["ordinary", 7] } }, valueType: { $record: { fields: [] } } };
    const result = await client.api.savedQueryCreate({ slug: "data", query });
    expect(result.query.query).toBe(query);
    const command = (writes[0]![0] as Array<{ $tag: string; commands: Array<{ entry: { value: { query: unknown } } }> }>)[0]!;
    expect(command.$tag).toBe("TabEditValues");
    expect(command.commands[0]!.entry.value.query).toBe(query);
    expect(writes[0]![2]).toBe(client.signal);
    client.dispose();
  });

  test("reader disposal does not retire the shared tab source", () => {
    const source = localTabDataSource();
    const id = localTabSourceId();
    const first = createLocalApiClient(source);
    first.dispose();
    expect(localTabDataSource()).toBe(source);
    expect(localTabSourceId()).toBe(id);
    const next = createLocalApiClient(source);
    expect(next.signal?.aborted).toBe(false);
    next.dispose();
  });

  test("editing a saved value and its occurrence carries one authored revision", async () => {
    const { source, writes } = sourceFixture();
    const client = createLocalApiClient(source);
    const query = { kind: "expression", expr: { kind: "literal", value: 43 }, valueType: { $ref: "Number" } };
    const occurrence = { kind: "replace" as const, itemId: "occurrence", item: {
      id: "occurrence", valueType: { $ref: "Number" },
      source: { kind: "ref" as const, ref: { kind: "savedExpr" as const, id: "data" } },
    } };
    await client.editSavedValue!("data", query, 7, occurrence);
    expect(writes).toHaveLength(1);
    expect(writes[0]![0]).toEqual([
      { $tag: "TabPatchValue", id: "data", patch: { query } },
      { $tag: "TabEditRoot", command: occurrence },
    ]);
    expect(writes[0]![1]).toBe(7);
    expect(writes[0]![2]).toBe(client.signal);
    client.dispose();
  });
});
