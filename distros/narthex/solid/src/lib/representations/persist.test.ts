import { describe, expect, test } from "bun:test";

const transpiler = new Bun.Transpiler({ loader: "ts" });
const source = await Bun.file(new URL("./persist.ts", import.meta.url)).text();
const production = transpiler.transformSync(source.replace(/^import[\s\S]*?;\r?\n/gm, "")).replace(/^export /gm, "");
const drafts = await Bun.file(new URL("../instances/instance-draft.ts", import.meta.url)).text();
const draftStart = drafts.indexOf("export function normalizeInstanceDraft(");
const draftEnd = drafts.indexOf("/** An instance's full identity", draftStart);
const draftCode = transpiler.transformSync(drafts.slice(draftStart, draftEnd)).replace(/^export /gm, "");
const draftFunctions = new Function(`${draftCode}; return { normalizeInstanceDraft, representationPresetDraft, draftToApiBody };`)();

function fixture(local = true, accountDraft = false) {
  let epoch = 0;
  let revision = 7;
  let beforeRead: (() => void) | undefined;
  let beforeEncode: (() => void) | undefined;
  let rejectWrite: string | undefined;
  const registry: { captured: boolean; encodeInstances?: (drafts: any[], encoding: string) => Promise<any[]> } = { captured: true };
  const reads: string[] = [];
  const writes: Array<{ typeName: string; instance: Record<string, unknown> }> = [];
  const batches: Array<{ writes: any[]; revision: number; registry: unknown }> = [];
  const encoded: Array<{ draft: any; registry: unknown }> = [];
  const httpCalls: unknown[][] = [];
  if (local && !accountDraft) registry.encodeInstances = async drafts => drafts.map(draft => {
    encoded.push({ draft, registry }); beforeEncode?.(); return draft;
  });
  const existing = { id: "old-label", typeName: "Labelable", args: ["data"],
    instance: { typeName: "Labelable", args: ["data"], methods: { label: "Old" }, priority: 17 } };
  const client = {
    epoch: 0,
    ...(local ? { instanceEncoding: accountDraft
      ? () => { throw new Error("Instance encoding is unavailable in this data source"); } : () => registry } : {}),
    getLocusRoot: async () => ({ root: { revision } }),
    apiFetch: async (path: string) => {
      reads.push(path);
      beforeRead?.();
      return { dispatchInstances: path.includes("Labelable") ? [existing] : [] };
    },
    api: {
      dispatchInstanceCreate: async (body: any) => {
        httpCalls.push(["create", body]);
        if (body.typeName === rejectWrite) throw new Error("Write refused");
        writes.push(body);
      },
      dispatchInstanceUpdate: async (id: string, instance: any, valueEncoding: string) => {
        httpCalls.push(["update", id, instance, valueEncoding]);
        if (instance.typeName === rejectWrite) throw new Error("Write refused");
        writes.push({ typeName: instance.typeName, instance });
      },
    },
    ...(local ? { writeDispatchInstances: async (items: any[], capturedRevision: number, encodingRegistry: unknown) => {
      if (capturedRevision !== revision) throw new Error("This tab changed");
      batches.push({ writes: items, revision: capturedRevision, registry: encodingRegistry });
    } } : {}),
  };
  const bindings = {
    defaultApiClient: client,
    ...draftFunctions,
    INSTANCE_JSON_ENCODING: "fixture-wire",
    // The existing api.ts encoding-owner brand, also used by persistence.
    isReaderInstanceEncoding: (encoding: unknown) => encoding !== undefined && Object.hasOwn(encoding as object, "encodeInstances"),
    instanceToJsonWire: (draft: any, captured: unknown) => { encoded.push({ draft, registry: captured }); beforeEncode?.(); return draft; },
    accountFieldRegistry: () => registry,
    sessionEpoch: () => epoch,
    assertCurrentSession: (expected: number) => { if (expected !== epoch) throw new Error("Reader changed"); },
  };
  const functions = new Function(...Object.keys(bindings), `${production}; return { persistRepresentations, persistRepresentation, persistInstanceDraft };`)(...Object.values(bindings));
  return { persist: functions.persistRepresentations, persistOne: functions.persistRepresentation, persistRow: functions.persistInstanceDraft,
    client, registry, reads, writes, batches, encoded, httpCalls,
    beforeRead: (callback: () => void) => { beforeRead = callback; },
    beforeEncode: (callback: () => void) => { beforeEncode = callback; },
    changeEpoch: () => { epoch++; }, changeRevision: () => { revision++; },
    rejectWrite: (name: string) => { rejectWrite = name; } };
}

describe("representation save orchestration", () => {
  test("a single Local representation retains conditional update/create and the batch owner", async () => {
    const f = fixture();
    await f.persistOne("Labelable", "data", { label: "New" }, "provided-wire", f.client, f.registry);
    await f.persistOne("Describable", "data", { description: "New" }, "provided-wire", f.client, f.registry);
    expect(f.httpCalls).toEqual([]);
    expect(f.batches.map(batch => [batch.revision, batch.registry])).toEqual([[7, f.registry], [7, f.registry]]);
    expect(f.batches.map(batch => batch.writes.map(row => [row.typeName, row.existingId, row.valueEncoding])))
      .toEqual([[["Labelable", "old-label", "provided-wire"]], [["Describable", undefined, "provided-wire"]]]);
    expect(f.batches[0]!.writes[0].instance.priority).toBe(17);
    expect(f.batches[0]!.writes[0].instance.methods).toEqual({ label: "New" });
    expect(f.encoded).toEqual([]);
  });

  test("a known Local row retains its exact identity and metadata without a class lookup", async () => {
    const f = fixture();
    const draft = { typeName: "Reprable", args: ["JsRuntime", "Bytes"], methods: { native: "Bytes" }, priority: 11,
      scope: { kind: "tag", tag: "this-tab" }, label: "My representation" };
    await f.persistRow(draft, "second-row", "provided-wire", f.client, f.registry);
    await f.persistRow(draft, undefined, "provided-wire", f.client, f.registry);
    expect(f.reads).toEqual([]);
    expect(f.httpCalls).toEqual([]);
    expect(f.batches.map(batch => batch.writes.map(row => [row.existingId, row.instance])))
      .toEqual([[["second-row", draft]], [[undefined, draft]]]);
    expect(f.batches.every(batch => batch.revision === 7 && batch.registry === f.registry)).toBe(true);
  });

  test("a single representation refuses a revision change during its conditional lookup", async () => {
    const f = fixture();
    f.beforeRead(f.changeRevision);
    await expect(f.persistOne("Labelable", "data", { label: "New" }, "provided-wire", f.client, f.registry))
      .rejects.toThrow("This tab changed");
    expect(f.httpCalls).toEqual([]);
    expect(f.batches).toEqual([]);
  });

  test("a known row refuses a revision change while its body is encoded", async () => {
    const f = fixture();
    f.beforeEncode(f.changeRevision);
    await expect(f.persistRow({ typeName: "Labelable", args: ["data"], methods: { label: "New" } }, "old-label",
      undefined, f.client, f.registry)).rejects.toThrow("This tab changed");
    expect(f.httpCalls).toEqual([]);
    expect(f.batches).toEqual([]);
  });

  test("HTTP single-row saves keep their update/create endpoints and explicit encoding", async () => {
    const f = fixture(false);
    const draft = { typeName: "Labelable", args: ["data"], methods: { label: "New" } };
    await f.persistRow(draft, "selected-row", "provided-wire", f.client, f.registry);
    await f.persistRow(draft, undefined, "provided-wire", f.client, f.registry);
    expect(f.httpCalls).toEqual([["update", "selected-row", draft, "provided-wire"],
      ["create", { typeName: "Labelable", args: ["data"], instance: draft, valueEncoding: "provided-wire" }]]);
    expect(f.batches).toEqual([]);
  });

  test("account-draft single-row saves keep their endpoints even when the source has a batch writer", async () => {
    const f = fixture(true, true);
    expect(f.client.writeDispatchInstances).toBeDefined();
    // The account-draft client's missing-method Proxy supplies a refusing
    // function, so capability truthiness alone cannot identify a Local owner.
    expect(() => f.client.instanceEncoding!()).toThrow("unavailable");
    await f.persistOne("Labelable", "data", { label: "Updated account draft" }, "provided-wire", f.client, f.registry);
    await f.persistOne("Describable", "data", { description: "Created account draft" }, "provided-wire", f.client, f.registry);
    expect(f.httpCalls.map(call => call[0])).toEqual(["update", "create"]);
    expect(f.httpCalls[0]![1]).toBe("old-label");
    expect((f.httpCalls[0]![2] as { priority: number }).priority).toBe(17);
    expect(f.batches).toEqual([]);
  });

  test("local create/update envelopes retain the captured codec registry and publish one revision batch", async () => {
    const f = fixture();
    await f.persist("data", { Labelable: { label: "New" }, Describable: { description: "Details" } }, undefined, f.client, f.registry);
    expect(f.writes).toEqual([]);
    expect(f.batches).toHaveLength(1);
    expect(f.batches[0]!.revision).toBe(7);
    expect(f.batches[0]!.registry).toBe(f.registry);
    expect(f.batches[0]!.writes.map(row => [row.typeName, row.existingId])).toEqual([["Labelable", "old-label"], ["Describable", undefined]]);
    expect(f.batches[0]!.writes[0].instance.priority).toBe(17);
    expect(f.batches[0]!.writes[0].instance.methods).toEqual({ label: "New" });
    expect(f.batches[0]!.writes[1].instance.methods).toEqual({ description: "Details" });
    expect(f.encoded.map(row => row.registry)).toEqual([f.registry, f.registry]);
    expect(f.batches[0]!.writes.map(row => row.valueEncoding)).toEqual(["fixture-wire", "fixture-wire"]);
  });

  test("empty drafts do no lookup, encoding or write", async () => {
    const f = fixture();
    await f.persist("data", {}, undefined, f.client, f.registry);
    expect(f.reads).toEqual([]);
    expect(f.encoded).toEqual([]);
    expect(f.batches).toEqual([]);
  });

  test("HTTP fallback preserves sequential acknowledged writes and stops on the first failure", async () => {
    const f = fixture(false);
    f.rejectWrite("Describable");
    await expect(f.persist("data", { Labelable: { label: "New" }, Describable: { description: "Details" }, Iconable: { icon: "star" } },
      undefined, f.client, f.registry)).rejects.toThrow("Write refused");
    expect(f.writes.map(row => row.typeName)).toEqual(["Labelable"]);
    expect(f.reads).toHaveLength(2);
    expect(f.reads.some(path => path.includes("Iconable"))).toBe(false);
    expect(f.batches).toEqual([]);
  });

  test("a reader change during lookup cannot submit any local row", async () => {
    const f = fixture();
    f.beforeRead(f.changeEpoch);
    await expect(f.persist("data", { Labelable: { label: "New" } }, undefined, f.client, f.registry)).rejects.toThrow("Reader changed");
    expect(f.batches).toEqual([]);
    expect(f.encoded).toEqual([]);
  });

  test("dismissal after an acknowledged HTTP write stops later representations", async () => {
    const f = fixture(false);
    await f.persist("data", { Labelable: { label: "New" }, Describable: { description: "Details" } },
      undefined, f.client, f.registry, () => f.writes.length === 0);
    expect(f.writes.map(row => row.typeName)).toEqual(["Labelable"]);
    expect(f.reads).toHaveLength(1);
  });

  test("dismissal during a deferred HTTP lookup prevents its write and later representations", async () => {
    const f = fixture(false);
    const lookup = f.client.apiFetch;
    let releaseLookup!: () => void;
    let enteredLookup!: () => void;
    const lookupPending = new Promise<void>(resolve => { releaseLookup = resolve; });
    const lookupEntered = new Promise<void>(resolve => { enteredLookup = resolve; });
    f.client.apiFetch = async (path: string) => {
      const result = await lookup(path);
      enteredLookup();
      await lookupPending;
      return result;
    };
    let open = true;
    const continuations: boolean[] = [];
    const saving = f.persist("data", { Labelable: { label: "New" }, Describable: { description: "Details" } },
      undefined, f.client, f.registry, () => { continuations.push(open); return open; });
    await lookupEntered;
    expect(f.httpCalls).toEqual([]);
    open = false;
    releaseLookup();
    await saving;
    expect(continuations).toContain(false);
    expect(f.reads).toHaveLength(1);
    expect(f.encoded).toEqual([]);
    expect(f.httpCalls).toEqual([]);
    expect(f.writes).toEqual([]);
    expect(f.batches).toEqual([]);
  });

  test("dismissal during a local lookup cannot publish the planned batch", async () => {
    const f = fixture();
    let open = true;
    f.beforeRead(() => { open = false; });
    await f.persist("data", { Labelable: { label: "New" } }, undefined, f.client, f.registry, () => open);
    expect(f.batches).toEqual([]);
    expect(f.encoded).toEqual([]);
  });

  test("a concurrent edit does not relabel the earlier captured revision", async () => {
    const f = fixture();
    f.beforeRead(f.changeRevision);
    await expect(f.persist("data", { Labelable: { label: "New" } }, undefined, f.client, f.registry)).rejects.toThrow("This tab changed");
    expect(f.batches).toEqual([]);
  });

  test("already encoded instances retain their explicit wire encoding", async () => {
    const f = fixture();
    await f.persist("data", { Labelable: { label: "Encoded" } }, "provided-wire", f.client, f.registry);
    expect(f.encoded).toEqual([]);
    expect(f.batches[0]!.writes[0].valueEncoding).toBe("provided-wire");
  });
});
