import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// B4 wave 1 lane C (census unit E): the Local API client's name lookups and
// instance wire run in the snapshot's worker. The whole production Local API
// adapter runs here; the snapshot's worker methods supply inert replies, and
// its page registry and page session throw on any read. Parity of the worker
// answers with the page's registry lookups is pinned in
// expression-runner/reader-instance-wire-parity.test.ts.
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const production = read("./local-locus-data.ts");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const transpile = code => transpiler.transformSync(code).replace(/^export /gm, "")
  .replace(/\bimport\(/g, "loadModule(");
const compile = (code, bindings, result) => new Function(...Object.keys(bindings),
  `${transpile(code)}\nreturn ${result};`)(...Object.values(bindings));
const clientStart = production.indexOf("export function createLocalApiClient(");
if (clientStart < 0) throw new Error("Local API adapter source boundary moved");
const clientCode = production.slice(clientStart);
const apiSource = read("./api.ts");
const encodingStart = apiSource.indexOf("export function isReaderInstanceEncoding(");
if (encodingStart < 0) throw new Error("The instance encoding brand moved");
const persistSource = read("./representations/persist.ts");
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const pageRead = label => new Proxy({}, { get: (_target, key) => { throw new Error(`page ${label} read: ${String(key)}`); } });

const typeId = "5f6fcba9-e0cc-4db7-b4ac-7d5a4fd6ca0d";
const fnId = "c31057ed-291b-4b96-9cd1-c97a68738fc3";
const localType = { id: typeId, type: { $record: { fields: [] } } };
const localFn = { id: fnId, params: [], returns: { $ref: "Number" }, body: 42 };
const repositoryType = { id: "Number", type: { $opaque: { name: "Number" } } };
const repositoryFn = { id: "std:add", params: [], returns: { $ref: "Number" } };
const typeRow = { ...localType, name: "Stored type", isSystem: false };
const functionRow = { id: "function-row-id", name: "Stored function", function: localFn, isSystem: false };
// What the worker answers for each name (the registry's getIdentifiedEntity / getFunction).
const definitions = {
  "Stored type": { entity: localType }, [typeId]: { entity: localType },
  "storedFunction": { fn: localFn }, [fnId]: { fn: localFn },
  Number: { entity: repositoryType }, "std.add": { fn: repositoryFn },
};

function harness(options = {}) {
  let epoch = 8;
  const assertCurrentSession = expected => { if (expected !== epoch) throw new Error("The browser session changed."); };
  const reply = deferred(), started = deferred();
  const lookups = [], conversions = [], transactions = [], definitionSaves = [];
  const makeSnapshot = (owner, label) => Object.freeze({
    kind: "local", owner, worker: Object.freeze({ label }), registry: pageRead("registry"), session: pageRead("session"),
    types: [typeRow], functionRows: [functionRow], catalog: [], functions: [localFn],
    readPresentations: async targets => targets.map(target => ({ target, presentation: { label: `Shown ${target}` } })),
    readReferences: async (targets, signal) => {
      lookups.push({ snapshot: label, targets, signal }); started.resolve();
      if (options.holdWorker) await reply.promise;
      options.afterReply?.();
      return targets.map(target => definitions[target] ? { target, reference: { definition: definitions[target] } } : { target });
    },
    convertInstances: async (method, instances, signal) => {
      conversions.push({ snapshot: label, method, instances: structuredClone(instances), signal }); started.resolve();
      if (options.holdWorker) await reply.promise;
      options.afterReply?.();
      if (options.workerFailure) throw new Error("This authoring snapshot was replaced. Retry with the current data.");
      return instances.map(item => ({ ...item.instance, methods: { [method === "decode-reader-instances" ? "decoded" : "encoded"]: item.instance.methods },
        ...(item.valueEncoding ? { seenEncoding: item.valueEncoding } : {}) }));
    },
  });
  const owner = Object.freeze({ owner: "first" });
  let snapshot = options.account
    ? Object.freeze({ registry: options.account.registry, session: {}, types: [typeRow], functionRows: [functionRow], catalog: [], functions: [],
      readPresentations: async () => [] })
    : makeSnapshot(owner, "first");
  const root = { id: "this-tab-source", revision: 3 };
  const source = {
    id: root.id, epoch: 8, ready: async () => {}, toolsSettled: async () => {}, firstPaint: async () => {}, readReady: async () => {},
    revision: () => root.revision, root: () => root, state: () => ({ definitions: { owners: [], fields: [], facets: [] } }),
    snapshot: () => snapshot, project: () => { throw new Error("Unexpected projection"); },
    ordinary: async operation => operation.kind === "tabDataRootCommand" ? { $tag: "TabEditRoot", command: operation.args[0] } : [],
    transact: async (commands, revision) => {
      if (revision !== undefined && revision !== root.revision) throw new Error("This tab changed");
      transactions.push({ commands, revision }); options.afterTransaction?.(); return root;
    },
    saveDefinitions: async (bundle, _signal, mutation) => { definitionSaves.push({ bundle, mutation }); return { snapshot: {}, root }; },
  };
  const imports = [];
  const client = compile(clientCode, {
    inheritCoreAuthoringOwner: () => {}, assertCurrentSession,
    queryLocalFieldAuthoringCatalog: () => { throw new Error("unexpected"); },
    queryLocalFieldAuthoringIdentity: () => { throw new Error("unexpected"); },
    queryLocalFieldResurrectionCatalog: () => { throw new Error("unexpected"); },
    loadModule: async path => {
      imports.push(path);
      if (path === "./reader-presentation") return { readerPresentationDto: presentation => presentation };
      if (path === "@fenel/engine/authoring/type" && options.account) return options.account.wire;
      throw new Error(`Unexpected page module ${path}`);
    },
  }, "createLocalApiClient")(source, options.account ? { accountId: "operator-account" } : {});
  return { client, source, lookups, conversions, transactions, definitionSaves, imports, owner,
    workerStarted: started.promise, releaseWorker: () => reply.resolve(),
    changeEpoch: () => { epoch++; },
    replace: (sameOwner = false) => { snapshot = makeSnapshot(sameOwner ? owner : Object.freeze({ owner: "second" }), "second"); } };
}

describe("Local API name lookups run in the snapshot's worker", () => {
  test("a tab-owned type and function keep their checked rows; the page registry is never read", async () => {
    const h = harness();
    expect((await h.client.getTypeByName("Stored type")).definition).toEqual({ ...typeRow, id: typeId, label: `Shown ${typeId}` });
    expect((await h.client.getTypeByName(typeId)).definition.id).toBe(typeId);
    expect((await h.client.getFunctionByName("storedFunction")).definition).toEqual({ ...functionRow, id: fnId, label: `Shown ${fnId}` });
    expect((await h.client.getFunctionByName(fnId)).definition.function).toEqual(localFn);
    expect(h.lookups.map(row => row.targets)).toEqual([["Stored type"], [typeId], ["storedFunction"], [fnId]]);
    expect(h.lookups.every(row => row.snapshot === "first" && row.signal === h.client.signal)).toBe(true);
    expect(h.imports.filter(path => path !== "./reader-presentation")).toEqual([]);
  });

  test("repository definitions stay inspectable and read-only; misses stay absent", async () => {
    const h = harness();
    expect((await h.client.getTypeByName("Number")).definition).toEqual({ id: "Number", name: "Number", type: repositoryType.type,
      isSystem: true, label: "Shown Number" });
    expect((await h.client.getFunctionByName("std.add")).definition).toEqual({ id: "std:add", name: "std:add", function: repositoryFn,
      isSystem: true, label: "Shown std:add" });
    // A function name never answers a type lookup, nor a type name a function lookup.
    expect((await h.client.getTypeByName("std.add")).definition).toBeNull();
    expect((await h.client.getFunctionByName("Number")).definition).toBeNull();
    expect((await h.client.getTypeByName("missing")).definition).toBeNull();
    expect((await h.client.getFunctionByName("missing")).definition).toBeNull();
  });

  for (const retirement of ["snapshot", "epoch", "dispose"]) {
    test(`a lookup answered after ${retirement} retirement refuses (no stale definition)`, async () => {
      const h = harness({ holdWorker: true });
      const pending = h.client.getFunctionByName("storedFunction");
      await h.workerStarted;
      if (retirement === "snapshot") h.replace();
      if (retirement === "epoch") h.changeEpoch();
      if (retirement === "dispose") h.client.dispose();
      h.releaseWorker();
      await expect(pending).rejects.toThrow(retirement === "snapshot" ? "definitions were replaced"
        : retirement === "epoch" ? "session changed" : "local reader was closed");
    });
  }

  test("an account draft source keeps its page registry lookups unchanged", async () => {
    const registryReads = [];
    const registry = {
      getIdentifiedEntity: name => { registryReads.push(["entity", name]); return name === "Stored type" ? localType : undefined; },
      getFunction: name => { registryReads.push(["fn", name]); return name === "storedFunction" ? localFn : undefined; },
    };
    const h = harness({ account: { registry } });
    expect((await h.client.getTypeByName("Stored type")).definition.id).toBe(typeId);
    expect((await h.client.getFunctionByName("storedFunction")).definition.id).toBe("function-row-id");
    expect(registryReads).toEqual([["entity", "Stored type"], ["fn", "storedFunction"]]);
    expect(h.lookups).toEqual([]);
  });
});

const wire = (typeName, methods) => ({ typeName, args: ["target"], methods });

describe("Local instance decoding runs in the snapshot's worker", () => {
  test("a representation batch decodes in one worker request, in order, with each encoding", async () => {
    const h = harness();
    await h.client.writeDispatchInstances([
      { typeName: "Labelable", args: ["target"], instance: wire("Labelable", { label: "A" }), valueEncoding: "fenel-instance-json-v2" },
      { existingId: "kept", typeName: "Codeable", args: ["target"], instance: wire("Codeable", { codeName: "b" }) },
    ], 3);
    expect(h.conversions).toHaveLength(1);
    expect(h.conversions[0].method).toBe("decode-reader-instances");
    expect(h.conversions[0].instances).toEqual([
      { instance: wire("Labelable", { label: "A" }), valueEncoding: "fenel-instance-json-v2" },
      { instance: wire("Codeable", { codeName: "b" }) },
    ]);
    const [{ commands, revision }] = h.transactions;
    expect(revision).toBe(3);
    expect(commands[0].$tag).toBe("TabEditRepresentations");
    const [append, replace] = commands[0].commands;
    expect(append.$tag).toBe("LocusAppend");
    expect(append.entry.value.instance).toEqual({ ...wire("Labelable", { decoded: { label: "A" } }), seenEncoding: "fenel-instance-json-v2",
      scope: { kind: "tag", tag: "this-tab-source" } });
    expect(replace).toMatchObject({ $tag: "LocusReplace", id: "kept" });
    expect(replace.entry.value.instance.methods).toEqual({ decoded: { codeName: "b" } });
    expect(h.imports).toEqual([]);
  });

  test("create and update decode their one instance in the worker", async () => {
    const h = harness();
    const created = await h.client.api.dispatchInstanceCreate({ typeName: "Labelable", args: ["target"], instance: wire("Labelable", { label: "C" }) });
    expect(created.dispatchInstance.instance.methods).toEqual({ decoded: { label: "C" } });
    const updated = await h.client.api.dispatchInstanceUpdate("row", wire("Labelable", { label: "U" }), "fenel-instance-json-v2");
    expect(updated.dispatchInstance.instance.methods).toEqual({ decoded: { label: "U" } });
    expect(h.conversions.map(row => [row.method, row.instances])).toEqual([
      ["decode-reader-instances", [{ instance: wire("Labelable", { label: "C" }) }]],
      ["decode-reader-instances", [{ instance: wire("Labelable", { label: "U" }), valueEncoding: "fenel-instance-json-v2" }]],
    ]);
    expect(h.transactions).toHaveLength(2);
  });

  test("a definition save with representations decodes them in the worker before its transaction", async () => {
    const h = harness();
    const encoding = h.client.instanceEncoding();
    await h.client.editDefinitionAndData({ ownerMutations: [] }, 3, { encodingRegistry: encoding,
      representations: [{ typeName: "Labelable", args: ["target"], instance: wire("Labelable", { label: "D" }) }] });
    expect(h.conversions.map(row => row.method)).toEqual(["decode-reader-instances"]);
    expect(h.definitionSaves[0].mutation.commands[0].commands[0].entry.value.instance.methods).toEqual({ decoded: { label: "D" } });
  });

  test("a worker refusal refuses the write (no page decoding)", async () => {
    const h = harness({ workerFailure: true });
    await expect(h.client.writeDispatchInstances([{ typeName: "Labelable", args: ["target"], instance: wire("Labelable", {}) }], 3))
      .rejects.toThrow("Retry with the current data");
    expect(h.transactions).toEqual([]);
    expect(h.imports).toEqual([]);
  });

  test("a decode answered after the snapshot was replaced writes nothing", async () => {
    const h = harness({ holdWorker: true });
    const pending = h.client.writeDispatchInstances([{ typeName: "Labelable", args: ["target"], instance: wire("Labelable", {}) }], 3);
    await h.workerStarted;
    h.replace(true);
    h.releaseWorker();
    await expect(pending).rejects.toThrow("definitions were replaced");
    expect(h.transactions).toEqual([]);
  });
});

describe("Local instance encoding runs in the snapshot's worker", () => {
  test("encodeInstances asks the worker to encode with the requested encoding", async () => {
    const h = harness();
    const encoding = h.client.instanceEncoding();
    expect(h.client.instanceEncoding()).toBe(encoding);
    const encoded = await encoding.encodeInstances([wire("Labelable", { label: "E" })], "fenel-instance-json-v2");
    expect(encoded).toEqual([{ ...wire("Labelable", { encoded: { label: "E" } }), seenEncoding: "fenel-instance-json-v2" }]);
    expect(h.conversions.map(row => [row.method, row.instances])).toEqual([
      ["encode-reader-instances", [{ instance: wire("Labelable", { label: "E" }), valueEncoding: "fenel-instance-json-v2" }]]]);
  });

  test("a restored worker for the same definitions keeps the encoding; new definitions refuse it", async () => {
    const h = harness();
    const encoding = h.client.instanceEncoding();
    h.replace(true);
    expect(h.client.instanceEncoding()).toBe(encoding);
    await h.client.writeDispatchInstances([{ typeName: "Labelable", args: ["target"], instance: wire("Labelable", {}) }], 3, encoding);
    expect(h.transactions).toHaveLength(1);
    h.replace(false);
    await expect(encoding.encodeInstances([wire("Labelable", {})], "fenel-instance-json-v2")).rejects.toThrow("definitions changed");
    await expect(h.client.writeDispatchInstances([{ typeName: "Labelable", args: ["target"], instance: wire("Labelable", {}) }], 3, encoding))
      .rejects.toThrow("definitions changed");
    // Any other token, including a page registry, is not this snapshot's encoding.
    await expect(h.client.writeDispatchInstances([{ typeName: "Labelable", args: ["target"], instance: wire("Labelable", {}) }], 3, {}))
      .rejects.toThrow("definitions changed");
    expect(h.transactions).toHaveLength(1);
  });

  test("the worker encoding also decodes a saved body in the worker, and refuses after new definitions", async () => {
    const h = harness();
    const encoding = h.client.instanceEncoding();
    const [decoded] = await encoding.decodeInstances([{ instance: wire("Labelable", { label: "S" }), valueEncoding: "fenel-instance-json-v2" }]);
    expect(decoded.methods).toEqual({ decoded: { label: "S" } });
    expect(h.conversions.map(row => [row.method, row.instances])).toEqual([
      ["decode-reader-instances", [{ instance: wire("Labelable", { label: "S" }), valueEncoding: "fenel-instance-json-v2" }]]]);
    h.replace(false);
    await expect(encoding.decodeInstances([{ instance: wire("Labelable", {}) }])).rejects.toThrow("definitions changed");
    expect(h.imports).toEqual([]);
  });

  test("an account draft source has no worker encoding and decodes with its page registry", async () => {
    const decoded = [];
    const registry = Object.freeze({ account: true });
    const h = harness({ account: { registry, wire: { instanceFromJsonWire: (instance, used, _iface, encoding) => {
      decoded.push({ used, encoding }); return { ...instance, methods: { page: instance.methods } }; } } } });
    expect(() => h.client.instanceEncoding()).toThrow("unavailable in this data source");
    await h.client.writeDispatchInstances([{ typeName: "Labelable", args: ["target"], instance: wire("Labelable", { label: "P" }) }], 3, registry);
    expect(decoded).toEqual([{ used: registry, encoding: undefined }]);
    expect(h.conversions).toEqual([]);
    expect(h.transactions[0].commands[0].commands[0].entry.value.instance.methods).toEqual({ page: { label: "P" } });
  });
});

// Home's representation save path (persist.ts) with a Local worker encoding.
let persistModule;
const persistCode = transpiler.transformSync(persistSource.replace(/^import[\s\S]*?;\r?\n/gm, "")).replace(/^export /gm, "");
const encodingBrand = transpiler.transformSync(apiSource.slice(encodingStart, apiSource.indexOf("\n}", encodingStart) + 2)).replace(/^export /gm, "");
// Execute the production panel's live Save callback, including its persistence
// helpers, against the actual Local API adapter above. The mounted browser test
// separately owns the field/button wiring; this control owns Save ordering.
function livePanelSave(client, onPersist, setRevision = () => {}, props = { mode: "live", targetId: "target", onPersist }) {
  const panel = read("./representations/RepresentationsPanel.tsx");
  const start = panel.indexOf("onSave={async ");
  const end = panel.indexOf("\n      }}", start);
  if (start < 0 || end < 0) throw new Error("The panel Save callback boundary moved");
  const callback = panel.slice(start + "onSave={".length, end) + "\n}";
  const bindings = { client, reader: { kind: "local" }, props, setRevision,
    readerRegistry: () => { throw new Error("page registry"); }, defaultApiClient: {},
    accountFieldRegistry: () => { throw new Error("account registry"); }, ...persistModule };
  return new Function(...Object.keys(bindings), `${transpile(`const save = ${callback};`)}\nreturn save;`)(...Object.values(bindings));
}
function liveInstanceSave(props, owner) {
  const editor = read("./instances/InstanceEditor.tsx");
  const start = editor.indexOf("  async function saveDraft()"), end = editor.indexOf("\n  let autoOpened", start);
  if (start < 0 || end < 0) throw new Error("The instance Save callback boundary moved");
  const errors = [], saving = [], closed = [], revisions = [], pageReads = [];
  const value = wire("Labelable", { label: "Target A" });
  const bindings = { props, local: true, client: { instanceEncoding: () => owner }, draft: () => value, mode: () => "live",
    editingKey: () => "row:target-a", editingRow: () => undefined, setSaving: value => saving.push(value),
    setError: value => errors.push(value), draftValueFingerprint: JSON.stringify,
    INSTANCE_JSON_ENCODING: "fenel-instance-json-v2", draftToApiBody: instance => ({ typeName: instance.typeName, args: instance.args, instance }),
    // Let the old synchronous path reach its handler for the target-race
    // failure control; the candidate must leave this page path unused.
    instanceToJsonWire: instance => { pageReads.push("page encoder"); return instance; }, registry: () => undefined,
    lookupInterface: () => undefined, interfaceByName: () => undefined,
    setRevision: update => revisions.push(update(0)), closeEditor: () => closed.push(true) };
  const save = new Function(...Object.keys(bindings), `${transpile(editor.slice(start, end))}\nreturn saveDraft;`)(...Object.values(bindings));
  return { save, errors, saving, closed, revisions, pageReads };
}
describe("representation saves encode through a Local worker encoding", () => {
  test("one batch is encoded in the worker and written under that same encoding", async () => {
    const encoded = [], batches = [];
    const encoding = Object.freeze({ encodeInstances: async (drafts, wireEncoding) => {
      encoded.push({ drafts: structuredClone(drafts), wireEncoding });
      return drafts.map(draft => ({ ...draft, methods: { encoded: draft.methods } }));
    } });
    const client = { epoch: 0, getLocusRoot: async () => ({ root: { revision: 5 } }),
      apiFetch: async () => ({ dispatchInstances: [] }),
      writeDispatchInstances: async (writes, revision, token) => { batches.push({ writes, revision, token }); } };
    const bindings = {
      defaultApiClient: {}, INSTANCE_JSON_ENCODING: "fenel-instance-json-v2",
      instanceToJsonWire: () => { throw new Error("page encoding"); }, accountFieldRegistry: () => { throw new Error("page registry"); },
      instanceFromJsonWire: () => { throw new Error("page decoding"); },
      sessionEpoch: () => 0, assertCurrentSession: () => {},
      normalizeInstanceDraft: draft => draft, draftToApiBody: draft => ({ typeName: draft.typeName, args: draft.args, instance: draft }),
      representationPresetDraft: (typeName, targetId, methods) => ({ typeName, args: [targetId], methods }),
    };
    const persist = new Function(...Object.keys(bindings), `${encodingBrand}; ${persistCode}; return persistRepresentations;`)(...Object.values(bindings));
    persistModule = new Function(...Object.keys(bindings), `${encodingBrand}; ${persistCode}; return { persistRepresentation, persistInstanceDraft, decodedRepresentationBody };`)(...Object.values(bindings));
    await persist("target", { Labelable: { label: "L" }, Describable: { description: "D" } }, undefined, client, encoding);
    expect(encoded).toEqual([{ wireEncoding: "fenel-instance-json-v2", drafts: [
      { typeName: "Labelable", args: ["target"], methods: { label: "L" } },
      { typeName: "Describable", args: ["target"], methods: { description: "D" } }] }]);
    expect(batches).toHaveLength(1);
    expect(batches[0].token).toBe(encoding);
    expect(batches[0].revision).toBe(5);
    expect(batches[0].writes.map(write => write.instance.methods)).toEqual([{ encoded: { label: "L" } }, { encoded: { description: "D" } }]);
  });

  test("a single representation save and the panel's saved-body decoding use the worker encoding (page codec throws)", async () => {
    const encoded = [], decodedBodies = [], created = [];
    const encoding = Object.freeze({
      encodeInstances: async (drafts, wireEncoding) => { encoded.push({ drafts: structuredClone(drafts), wireEncoding });
        return drafts.map(draft => ({ ...draft, methods: { encoded: draft.methods } })); },
      decodeInstances: async items => { decodedBodies.push(structuredClone(items)); return items.map(item => ({ ...item.instance, methods: { decoded: item.instance.methods } })); },
    });
    const client = { epoch: 0, apiFetch: async () => ({ dispatchInstances: [] }),
      api: { dispatchInstanceCreate: async body => { created.push(body); } } };
    await persistModule.persistRepresentation("Labelable", "target", { label: "One" }, undefined, client, encoding);
    expect(encoded).toEqual([{ wireEncoding: "fenel-instance-json-v2", drafts: [{ typeName: "Labelable", args: ["target"], methods: { label: "One" } }] }]);
    expect(created.map(body => [body.instance.methods, body.valueEncoding])).toEqual([[{ encoded: { label: "One" } }, "fenel-instance-json-v2"]]);
    const body = { instance: { typeName: "Labelable", args: ["target"], methods: { label: "Wire" } }, valueEncoding: "fenel-instance-json-v2" };
    expect((await persistModule.decodedRepresentationBody(body, encoding)).methods).toEqual({ decoded: { label: "Wire" } });
    expect(decodedBodies).toEqual([[{ instance: body.instance, valueEncoding: "fenel-instance-json-v2" }]]);
  });

  test("live create/update saves publish once and retain callback data after the source replaces its encoding owner", async () => {
    for (const existingId of [undefined, "selected-row"]) {
      let h;
      h = harness({ afterTransaction: () => h.replace(false) });
      const encoding = h.client.instanceEncoding(), persisted = [], revisions = [];
      const save = livePanelSave(h.client, (...args) => persisted.push(args), update => revisions.push(update(0)));
      const instance = wire("Labelable", { label: "Saved" });
      await save({ typeName: instance.typeName, args: instance.args, instance, valueEncoding: "fenel-instance-json-v2" },
        existingId ? { id: existingId } : undefined, encoding);
      expect(h.transactions).toHaveLength(1);
      expect(h.transactions[0].revision).toBe(3);
      const command = h.transactions[0].commands[0].commands[0];
      expect(command.$tag).toBe(existingId ? "LocusReplace" : "LocusAppend");
      if (existingId) expect(command.id).toBe(existingId);
      expect(h.conversions.map(row => [row.snapshot, row.method])).toEqual([
        ["first", "decode-reader-instances"], ["first", "decode-reader-instances"]]);
      expect(persisted).toEqual([["Labelable", { decoded: { label: "Saved" } }]]);
      expect(revisions).toEqual([1]);
      expect(h.client.instanceEncoding()).not.toBe(encoding);
    }
  });

  test("live Save refuses replacement during conditional lookup before any row is committed", async () => {
    const h = harness(), persisted = [], encoding = h.client.instanceEncoding();
    const client = { ...h.client, apiFetch: async (...args) => {
      const rows = await h.client.apiFetch(...args);
      if (args[0].includes("typeName=")) h.replace(false);
      return rows;
    } };
    const save = livePanelSave(client, (...args) => persisted.push(args));
    const instance = wire("Labelable", { label: "Old definitions" });
    await expect(save({ typeName: instance.typeName, args: instance.args, instance, valueEncoding: "fenel-instance-json-v2" },
      undefined, encoding)).rejects.toThrow("definitions changed");
    expect(h.transactions).toEqual([]);
    expect(persisted).toEqual([]);
    // Only the callback's pre-write decode ran; the stale write did not decode
    // its body against the replacement definitions.
    expect(h.conversions.map(row => row.snapshot)).toEqual(["first"]);
  });

  test("a live Save keeps the same encoding when only its physical worker is restored during lookup", async () => {
    const h = harness(), persisted = [], encoding = h.client.instanceEncoding();
    const client = { ...h.client, apiFetch: async (...args) => {
      const rows = await h.client.apiFetch(...args);
      if (args[0].includes("typeName=")) h.replace(true);
      return rows;
    } };
    const save = livePanelSave(client, (...args) => persisted.push(args));
    const instance = wire("Labelable", { label: "Restored" });
    await save({ typeName: instance.typeName, args: instance.args, instance, valueEncoding: "fenel-instance-json-v2" }, undefined, encoding);
    expect(h.transactions).toHaveLength(1);
    expect(h.transactions[0].revision).toBe(3);
    expect(h.client.instanceEncoding()).toBe(encoding);
    expect(h.conversions.map(row => row.snapshot)).toEqual(["first", "second"]);
    expect(persisted).toEqual([["Labelable", { decoded: { label: "Restored" } }]]);
  });

  test("live Save refuses a moved target while callback data is decoding and never calls its replacement callback", async () => {
    const h = harness({ holdWorker: true }), callbacks = [], revisions = [];
    const props = { mode: "live", targetId: "target", onPersist: () => callbacks.push("A") };
    const save = livePanelSave(h.client, props.onPersist, update => revisions.push(update(0)), props);
    const instance = wire("Labelable", { label: "Target A" });
    const saving = save({ typeName: instance.typeName, args: instance.args, instance, valueEncoding: "fenel-instance-json-v2" },
      undefined, h.client.instanceEncoding());
    await h.workerStarted;
    props.targetId = "target-B"; props.onPersist = () => callbacks.push("B");
    h.releaseWorker();
    await expect(saving).rejects.toThrow("This data changed");
    expect(h.transactions).toEqual([]);
    expect(callbacks).toEqual([]);
    expect(revisions).toEqual([]);
  });

  test("a retained old-target draft cannot be saved into the panel's new target", async () => {
    const h = harness(), callbacks = [];
    const props = { mode: "live", targetId: "target-B", onPersist: () => callbacks.push("B") };
    const save = livePanelSave(h.client, props.onPersist, () => {}, props);
    const instance = wire("Labelable", { label: "Target A" });
    await expect(save({ typeName: instance.typeName, args: instance.args, instance, valueEncoding: "fenel-instance-json-v2" },
      undefined, h.client.instanceEncoding())).rejects.toThrow("This data changed");
    expect(h.conversions).toEqual([]);
    expect(h.transactions).toEqual([]);
    expect(callbacks).toEqual([]);
  });

  test("a target move during conditional lookup withdraws the write before publication", async () => {
    const h = harness(), callbacks = [];
    const props = { mode: "live", targetId: "target", onPersist: () => callbacks.push("A") };
    const client = { ...h.client, apiFetch: async (...args) => {
      const rows = await h.client.apiFetch(...args);
      if (args[0].includes("typeName=")) props.targetId = "target-B";
      return rows;
    } };
    const save = livePanelSave(client, props.onPersist, () => {}, props);
    const instance = wire("Labelable", { label: "Target A" });
    await save({ typeName: instance.typeName, args: instance.args, instance, valueEncoding: "fenel-instance-json-v2" },
      undefined, h.client.instanceEncoding());
    expect(h.transactions).toEqual([]);
    expect(callbacks).toEqual([]);
  });

  test("a target move during publication cannot publish callback data or refresh the new target", async () => {
    const callbacks = [], revisions = [];
    const props = { mode: "live", targetId: "target", onPersist: () => callbacks.push("A") };
    const h = harness({ afterTransaction: () => { props.targetId = "target-B"; props.onPersist = () => callbacks.push("B"); } });
    const save = livePanelSave(h.client, props.onPersist, update => revisions.push(update(0)), props);
    const instance = wire("Labelable", { label: "Target A" });
    await save({ typeName: instance.typeName, args: instance.args, instance, valueEncoding: "fenel-instance-json-v2" },
      undefined, h.client.instanceEncoding());
    expect(h.transactions).toHaveLength(1);
    expect(h.transactions[0].commands[0].commands[0].entry.value.args).toEqual(["target"]);
    expect(callbacks).toEqual([]);
    expect(revisions).toEqual([]);
  });

  test("the live panel captures the selected row id before decoding", async () => {
    const h = harness({ holdWorker: true }), row = { id: "selected-row", args: ["target"] };
    const save = livePanelSave(h.client, () => {}), instance = wire("Labelable", { label: "Saved" });
    const saving = save({ typeName: instance.typeName, args: instance.args, instance, valueEncoding: "fenel-instance-json-v2" }, row,
      h.client.instanceEncoding());
    await h.workerStarted; row.id = "other-row"; h.releaseWorker(); await saving;
    expect(h.transactions).toHaveLength(1);
    expect(h.transactions[0].commands[0].commands[0].id).toBe("selected-row");
  });

  test("InstanceEditor refuses a target change during encoding before calling either Save handler", async () => {
    const encoded = deferred(), calls = [];
    const owner = { encodeInstances: async instances => { await encoded.promise; return instances; } };
    const props = { targetId: "target", onSave: async () => calls.push("A") };
    const editor = liveInstanceSave(props, owner), saving = editor.save();
    props.targetId = "target-B"; props.onSave = async () => calls.push("B"); encoded.resolve(); await saving;
    expect(calls).toEqual([]);
    expect(editor.closed).toEqual([]);
    expect(editor.revisions).toEqual([]);
    expect(editor.errors).toEqual([""]);
    expect(editor.saving).toEqual([true, false]);
    expect(editor.pageReads).toEqual([]);
  });

  test("InstanceEditor cannot close or error a new target after the old Save handler settles", async () => {
    for (const refuse of [false, true]) {
      const publication = deferred(), started = deferred();
      const props = { targetId: "target", onSave: async () => { started.resolve(); await publication.promise; } };
      const editor = liveInstanceSave(props, { encodeInstances: async instances => instances }), saving = editor.save();
      await started.promise; props.targetId = "target-B";
      if (refuse) publication.reject(new Error("Old target write refused")); else publication.resolve();
      await saving;
      expect(editor.closed).toEqual([]);
      expect(editor.revisions).toEqual([]);
      expect(editor.errors).toEqual([""]);
      expect(editor.saving).toEqual([true, false]);
      expect(editor.pageReads).toEqual([]);
    }
  });

  test("Home's create-data dialog hands a Local reader's worker encoding over (source pin)", () => {
    const home = read("../routes/app/home.tsx");
    expect(home).toContain('target.reader?.kind === "local" ? target.client.instanceEncoding!() : target.reader?.registry()');
  });
});
