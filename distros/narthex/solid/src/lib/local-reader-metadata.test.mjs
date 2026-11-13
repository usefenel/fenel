import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canonical } from "../../../../../implementations/typescript/engine/src/locale.ts";
import { frameAccount } from "../../../../../implementations/typescript/engine/src/authority.ts";

// C1 host-wiring evidence only. Execute the actual preparation/source/client
// bodies, with checked worker acquisition and worker replies held at their IO
// ports. No registry is initialized; these fixtures do not establish Fenel
// presentation, dispatch priority, worker execution or authority semantics.
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const production = read("./local-locus-data.ts");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const transpile = source => transpiler.transformSync(source).replace(/^export /gm, "")
  .replace(/\bimport\(/g, "loadModule(");
function section(source, first, last) {
  const start = source.indexOf(first);
  if (start < 0 || source.indexOf(first, start + first.length) !== -1) throw new Error(`Source boundary moved: ${first}`);
  const end = source.indexOf(last, start + first.length);
  if (end <= start) throw new Error(`Source boundary moved: ${last}`);
  return source.slice(start, end);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const forbidden = () => { throw new Error("Unexpected page-side presentation/resolver fallback"); };
const compile = (code, bindings, result) => new Function(...Object.keys(bindings),
  `${transpile(code)}\nreturn ${result};`)(...Object.values(bindings));
const presentationDto = compile(section(read("./reader-presentation.ts"),
  "export function readerPresentationDto(", "type PresentationRow ="), { canonical }, "readerPresentationDto");
const presentationSource = read("./reader-presentation.ts");
const snapshotPresentation = compile(presentationSource.slice(presentationSource.indexOf("export function createReaderPresentation(")),
  { resolveEffect: forbidden, ownPresentationFromReaderSnapshot: forbidden }, "createReaderPresentation");
const sessionCode = read("./browser-session.ts");
function epochGuard() {
  // Both exception type and validation are production code, with only the
  // current browser identity's epoch supplied by this test.
  return compile("let epoch = 8;\n" + sessionCode.slice(sessionCode.indexOf("export class StaleSessionResponseError")), {},
    "{ assertCurrentSession, change: () => { epoch++; } }");
}

const prepareCode = section(production, "export async function prepareLocalReaderSnapshot(", "export type LocalSavedValueRow");
function preparation(options = {}) {
  const sourceId = "this-tab-exact-source";
  const type = { id: "type-id", type: { $ref: "String" }, params: ["a"] };
  const fallbackType = { id: "unnamed-type-id", type: { $ref: "Number" } };
  const fn = { id: "function-id", params: [], returns: type.type };
  const definitions = { owners: options.empty ? [] : [
    { kind: "type", storageName: "KeptTypeName", definition: type },
    { kind: "function", storageName: "KeptFunctionName", definition: fn },
    { kind: "type", storageName: "FallbackTypeName", definition: fallbackType },
  ], fields: [], facets: [] };
  const representations = [{ id: "selected-representation" }];
  // B4 wave 5: the snapshot's registry is a token (an identity only).
  const registry = Object.freeze({ getFunction: forbidden, getIdentifiedEntity: forbidden, getFieldRepresentations: forbidden });
  const catalog = Object.freeze({ sourceId, token: "exact-catalogue-generation", functions: Object.freeze([]) });
  const owner = Object.freeze({ sourceId, token: "exact-snapshot-owner" });
  const handle = Object.freeze({ sourceId, token: Object.freeze({ generation: 12 }) });
  const session = Object.freeze({ registry, evaluateContext: Object.freeze({ reader: sourceId }) });
  const display = Object.freeze([{ entries: [] }]);
  const calls = [], discarded = [], started = deferred();
  const catalogue = { signal: undefined };
  const worker = {
    prepareLocalCatalogInWorker: async (id, snapshot, types, functions, supplied) => {
      expect(id).toBe(sourceId); expect(snapshot).toBe(definitions);
      expect(types).toEqual(options.empty ? [] : [{ id: type.id, type: type.type }, { id: fallbackType.id, type: fallbackType.type }]);
      expect(functions).toEqual(options.empty ? [] : [fn]);
      expect(supplied.representations).toBe(representations);
      // No page registry borrows this initialization (B4 wave 5).
      expect(supplied.onRegistryPreparation).toBeUndefined();
      catalogue.signal = supplied.signal;
      return catalog;
    },
    acquireLocalRegistryPreparation: forbidden,
    prepareLocalPageHarness: async () => {},
    createLocalRegistryToken: () => registry,
    createPreparedSnapshotOwner: () => owner,
    preparedAuthoringDisplayCatalog: selected => { expect(selected).toBe(owner); return display; },
    prepareReaderWorkerHandle: selected => { expect(selected).toBe(catalog); return handle; },
    runPreparedReaderWorker: (selected, payload, signal) => {
      expect(selected).toBe(handle);
      calls.push({ selected, payload, signal }); started.resolve();
      return options.reply ? options.reply(payload, signal) : payload.method === "project-reader-presentations"
        ? Promise.resolve({ presentations: [
          { target: fn.id, presentation: { label: "Worker function", emoji: "🧮" } },
          { target: type.id, presentation: { label: { en: "Worker type", fr: "Type" }, icon: "box" } },
        ] }) : Promise.resolve({ entries: [] });
    },
    discardPreparedAuthoringWorker: selected => discarded.push(selected),
    discardPreparedAuthoringCatalog: selected => discarded.push(selected),
  };
  const prepare = compile(prepareCode, {
    localPreparationRetirements: new Map(),
    // The required harness is settled in this metadata-only fixture.
    waitForLocalPageHarness: work => work,
    createReaderPresentation: forbidden, resolveEffect: forbidden,
    loadModule: async path => {
      if (path === "./expression-runner/authoring-catalog-worker") return worker;
      if (path === "./expression-runner/authoring-session") return {
        prepareLocalReaderAuthoringSession: forbidden,
        createLocalReaderAuthoringSession: (selected, selectedOwner, id, functions, selectedCatalog) => {
          expect(selected).toBe(registry); expect(selectedOwner).toBe(owner); expect(id).toBe(sourceId); expect(selectedCatalog).toBe(catalog);
          expect(functions).toEqual(options.empty ? [] : [fn]); return session;
        },
      };
      throw new Error(`Unexpected preparation import: ${path}`);
    },
    buildLocalReaderFieldRegistry: forbidden,
  }, "prepareLocalReaderSnapshot");
  return { sourceId, type, fallbackType, fn, definitions, registry, session, catalog, display, handle, calls,
    catalogue, discarded, started: started.promise,
    prepare: signal => prepare(sourceId, definitions, { signal, representations }) };
}

const activeCode = section(production, "  const assertActive = () => { assertCurrentSession(epoch);", "  const changed =");
// The read/publication section: metadata targets come from the worker's
// published packet for this exact state and snapshot, never a page projection.
const readCode = section(production, "  const read = () => { assertActive(); version(); return state; };", "  const captureSourceMetadata = ");
const metadataCode = section(production, "  const metadata = (requested:", "  const discard = async");
function sourceMetadata(snapshot, targets = ["ordinary-target"], published = {}) {
  const guard = epochGuard(), lifetime = new AbortController();
  const state = Object.freeze({ revision: 3 });
  const value = compile("let snapshot = selected;\nlet publicationPacket = packet(snapshot);\n" + activeCode + readCode + metadataCode, {
    selected: snapshot, state, epoch: 8, lifetime, version: () => {}, assertCurrentSession: guard.assertCurrentSession, readModel: undefined, options: {},
    packet: selected => ({ state: published.state ?? state, snapshot: "snapshot" in published ? published.snapshot : selected,
      value: Object.freeze({ metadataTargets: targets }) }),
    call: forbidden,
    createReaderPresentation: forbidden, representationsFromReaderSnapshot: forbidden, resolveEffect: forbidden,
  }, "{ metadata, replace: value => { snapshot = value; } }");
  return { ...value, guard, lifetime, targets };
}

const clientCode = production.slice(production.indexOf("export function createLocalApiClient("));
function clientHarness(options = {}) {
  const guard = epochGuard(), started = deferred(), calls = [];
  const type = { id: "type-id", name: "KeptType", type: { $ref: "String" }, params: ["a"], isSystem: false };
  const fallback = { id: "fallback-id", name: "KeptFallback", type: { $ref: "Number" }, isSystem: false };
  const fn = { id: "function-id", name: "KeptFunction", function: { id: "function-id", params: [], returns: type.type }, isSystem: false };
  const projections = [
    { target: fn.id, presentation: { label: { fr: "Fonction", en: "Function" }, emoji: "🧮" } },
    { target: type.id, presentation: { label: { en: "Type", fr: "Type fr" },
      description: { en: "A type" }, codeName: "scopedCode", icon: "box" } },
  ];
  const selected = { types: options.empty ? [] : [type, fallback], functionRows: options.empty ? [] : [fn],
    registry: new Proxy({}, { get: forbidden }),
    readMetadata: forbidden,
    readPresentations: (targets, signal) => {
      calls.push({ snapshot: selected, targets, signal }); started.resolve();
      return options.reply ? options.reply(targets, signal) : Promise.resolve(projections);
    } };
  let current = selected;
  const readiness = [];
  const source = { id: "this-tab-client", epoch: 8,
    firstPaint: async () => { readiness.push("read"); }, readReady: async () => { readiness.push("read"); }, ready: async () => { readiness.push("full"); },
    snapshot: () => current, revision: () => 3,
    project: forbidden, metadata: forbidden,
  };
  const client = compile(clientCode, {
    inheritCoreAuthoringOwner: () => {},
    assertCurrentSession: guard.assertCurrentSession,
    loadModule: async path => {
      expect(path).toBe("./reader-presentation"); return { readerPresentationDto: presentationDto,
        createReaderPresentation: forbidden, representationsFromReaderSnapshot: forbidden };
    },
    createReaderPresentation: forbidden, representationsFromReaderSnapshot: forbidden, resolveEffect: forbidden,
  }, "createLocalApiClient")(source);
  return { client, calls, readiness, guard, started: started.promise, type, fallback, fn, projections, selected,
    replace: () => { current = { ...selected }; } };
}

const accountCode = section(read("./reader-runtime.tsx"), "export function startAccountReaderRuntime(",
  "export async function createAccountReaderRuntime(");
const accountActiveCode = section(accountCode, "  const assertActive = () => {", "  const abort = () => {");
const accountAdapterCode = section(accountCode, "          const draftSnapshot =", "        } catch (error) {");
function accountAdapter() {
  const guard = epochGuard(), lifetime = new AbortController();
  const active = compile("let active = true;\n" + accountActiveCode,
    { epoch: 8, options: { signal: lifetime.signal }, assertCurrentSession: guard.assertCurrentSession },
    "{ assertActive, close: () => { active = false; } }");
  const registry = { getFunction: () => undefined, getIdentifiedEntity: () => undefined, getUuid: () => undefined };
  // Model the bootstrap handoff's account-null coordinate without minting an
  // authority or claiming a real registry/bootstrap integration test.
  const frame = Object.freeze({ _authority: undefined, reader: "account-null-bootstrap-handoff" });
  const session = Object.freeze({ registry, evaluateContext: frame });
  const targets = ["account-type", "account-function"];
  const methods = new Map([["Labelable", { label: "Raw captured label" }]]);
  const metadata = new Map(targets.map(target => [target, methods]));
  const ownPresentations = new Map(targets.map(target => [target, Object.freeze({ label: `Own ${target}`, icon: "account-icon" })]));
  const prepared = { registry, session: Object.freeze({ evaluateContext: Object.freeze({ account: "old-frame" }) }),
    types: [{ id: targets[0], name: "AccountType" }],
    functionRows: [{ id: targets[1], name: "AccountFunction", function: { id: targets[1] } }], catalog: [],
    metadata: new Map(), ownPresentations: new Map() };
  const raw = new Map(targets.map(target => [target, [{ typeName: "Labelable", methods: { label: `Raw ${target}` } }]]));
  const rawCalls = [], presentationReads = [], readers = [];
  const bindings = { prepared, session, metadata, ownPresentations, evaluateContext: frame, assertActive: active.assertActive,
    presentationTools: {
      createReaderPresentation: reader => {
        readers.push(reader);
        return snapshotPresentation(() => { const value = reader(); presentationReads.push(value); return value; });
      },
      representationsFromReaderSnapshot: (selectedRegistry, selectedFrame, target) => {
        expect(selectedRegistry).toBe(registry); expect(selectedFrame).toBe(frame);
        rawCalls.push({ registry: selectedRegistry, frame: selectedFrame, target }); return raw.get(target);
      },
    } };
  // This production slice returns the completed adapter directly.
  const result = new Function(...Object.keys(bindings), transpile(accountAdapterCode))(...Object.values(bindings));
  return { result, guard, lifetime, close: active.close, prepared, registry, frame, session, targets, methods,
    metadata, ownPresentations, raw, rawCalls, presentationReads, readers };
}

describe("Local reader preparation metadata transport", () => {
  test("hydrates all Local definition names/icons in one exact-source worker batch, retaining storage names on misses", async () => {
    const h = preparation();
    const result = await h.prepare();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].selected).toBe(h.handle);
    expect(h.calls[0].payload).toEqual({ method: "project-reader-presentations", targets: [h.type.id, h.fallbackType.id, h.fn.id] });
    expect(h.calls[0].signal).toBe(h.catalogue.signal);
    expect(result).toMatchObject({ registry: h.registry, session: h.session, catalog: h.display,
      types: [{ ...h.type, name: "KeptTypeName", isSystem: false, label: { en: "Worker type", fr: "Type" }, icon: "box" },
        { ...h.fallbackType, name: "FallbackTypeName", isSystem: false }],
      functionRows: [{ id: h.fn.id, name: "KeptFunctionName", function: h.fn, isSystem: false, label: "Worker function", emoji: "🧮" }] });
    expect(result.functions[0]).toBe(h.fn);
    expect(result.functionRows[0].function).toBe(h.fn);
    expect(result.types[1]).not.toHaveProperty("icon");
    expect(h.discarded).toEqual([]);
  });

  test("retains the admitted handle for later metadata requests and preserves the exact returned packet", async () => {
    const reply = { entries: [] }, presentations = [], h = preparation({ reply: payload => Promise.resolve(
      payload.method === "project-reader-presentations" ? { presentations } : reply) });
    const result = await h.prepare();
    const targets = ["selected-id"], controller = new AbortController();
    expect(await result.readMetadata(targets, controller.signal)).toBe(reply);
    expect(await result.readPresentations(targets, controller.signal)).toBe(presentations);
    expect(h.calls).toHaveLength(3);
    for (const call of h.calls.slice(1)) {
      expect(call.selected).toBe(h.handle); expect(call.payload.targets).toBe(targets); expect(call.signal).toBe(controller.signal);
    }
    expect(h.calls.map(call => call.payload.method)).toEqual([
      "project-reader-presentations", "project-reader-metadata", "project-reader-presentations",
    ]);
  });

  test("does not issue an empty metadata batch when there are no Local definitions", async () => {
    const h = preparation({ empty: true }), result = await h.prepare();
    expect(result.types).toEqual([]); expect(result.functionRows).toEqual([]); expect(h.calls).toEqual([]);
  });

  test("a presentation reply from another operation refuses and retires both prepared owners", async () => {
    const h = preparation({ reply: () => Promise.resolve({ descriptions: [] }) });
    await expect(h.prepare()).rejects.toThrow("presentation could not be read");
    expect(h.discarded).toEqual([h.catalog]);
  });

  test("the full metadata port refuses a reply from another worker operation", async () => {
    // Arrays inherit an entries() method; that is not a metadata packet.
    for (const otherReply of [{ descriptions: [] }, [], [{ match: "direct" }]]) {
      const h = preparation({ reply: payload => Promise.resolve(
        payload.method === "project-reader-presentations" ? { presentations: [] } : otherReply) });
      const result = await h.prepare();
      await expect(result.readMetadata(["target"])).rejects.toThrow("metadata could not be read");
    }
  });

  test("closing the source while its metadata batch is pending cannot publish a snapshot", async () => {
    const pending = deferred(), controller = new AbortController();
    const h = preparation({ reply: () => pending.promise }), result = h.prepare(controller.signal);
    await h.started; controller.abort(new Error("source closed")); pending.resolve({ presentations: [] });
    await expect(result).rejects.toThrow("source closed");
    expect(h.discarded).toEqual([h.catalog]);
  });
});

describe("Local source metadata lifetime", () => {
  test("forwards explicit targets and returns exact worker data without page resolver work", async () => {
    const targets = ["selected-target"], packet = { entries: [] }, calls = [];
    const selected = { readMetadata: (requested, signal) => { calls.push({ requested, signal }); return Promise.resolve(packet); } };
    const h = sourceMetadata(selected);
    expect(await h.metadata(targets)).toBe(packet);
    expect(calls).toEqual([{ requested: targets, signal: h.lifetime.signal }]);
    // The source forwards a copy, so a caller's later mutation cannot reach the worker request.
    expect(calls[0].requested).not.toBe(targets);
  });

  test("uses the current publication's own metadata targets when targets are omitted", async () => {
    let received;
    const h = sourceMetadata({ readMetadata: targets => { received = targets; return Promise.resolve({ entries: [] }); } });
    await h.metadata(); expect(received).toBe(h.targets);
  });

  for (const stale of ["state", "snapshot"]) {
    test(`refuses omitted targets from a publication of another ${stale}`, () => {
      const selected = { readMetadata: forbidden };
      const h = sourceMetadata(selected, undefined, stale === "state" ? { state: Object.freeze({ revision: 2 }) } : { snapshot: { readMetadata: forbidden } });
      expect(() => h.metadata()).toThrow("This source's data is not ready.");
    });
  }

  for (const retirement of ["snapshot", "epoch", "dispose"]) {
    test(`refuses a late worker reply after ${retirement} replacement`, async () => {
      const pending = deferred(), h = sourceMetadata({ readMetadata: () => pending.promise });
      const result = h.metadata(["selected-target"]);
      if (retirement === "snapshot") h.replace({ readMetadata: forbidden });
      if (retirement === "epoch") h.guard.change();
      if (retirement === "dispose") h.lifetime.abort(new DOMException("source closed", "AbortError"));
      pending.resolve({ entries: [] });
      await expect(result).rejects.toThrow(retirement === "snapshot" ? "snapshot was replaced" : retirement === "epoch" ? "session changed" : "source closed");
    });
  }
});

describe("Local API definition metadata DTOs", () => {
  test("batches each definition list once and preserves its DTO and optional fallback shape", async () => {
    const h = clientHarness();
    const types = await h.client.getTypes(), functions = await h.client.getFunctions();
    expect(h.calls.map(call => call.targets)).toEqual([[h.type.id, h.fallback.id], [h.fn.id]]);
    for (const call of h.calls) { expect(call.snapshot).toBe(h.selected); expect(call.signal).toBe(h.client.signal); }
    expect(h.readiness).toEqual(["full", "full"]);
    expect(types).toEqual({ types: [{ ...h.type, label: "Type", description: "A type", codeName: "scopedCode", icon: "box" },
      { ...h.fallback, label: undefined, description: undefined }] });
    expect(functions).toEqual({ functions: [{ ...h.fn, label: "Fonction", description: undefined, emoji: "🧮" }] });
    expect(types.types[0].type).toBe(h.type.type);
    expect(functions.functions[0].function).toBe(h.fn.function);
    expect(h.type).not.toHaveProperty("label"); expect(h.fn).not.toHaveProperty("label");
    expect(h.client.getBrowseTypes).toBe(h.client.getTypes); expect(h.client.getBrowseFunctions).toBe(h.client.getFunctions);
  });

  test("empty definition lists retain the API shape without worker requests", async () => {
    const h = clientHarness({ empty: true });
    expect(await h.client.getTypes()).toEqual({ types: [] }); expect(await h.client.getFunctions()).toEqual({ functions: [] });
    expect(h.calls).toEqual([]);
  });

  for (const method of ["getTypes", "getFunctions"]) {
    for (const retirement of ["snapshot", "epoch", "dispose"]) {
      test(`${method} refuses stale DTOs after ${retirement} replacement`, async () => {
        const pending = deferred(), h = clientHarness({ reply: () => pending.promise });
        const result = h.client[method](); await h.started;
        if (retirement === "snapshot") h.replace();
        if (retirement === "epoch") h.guard.change();
        if (retirement === "dispose") h.client.dispose();
        pending.resolve(h.projections);
        await expect(result).rejects.toThrow(retirement === "snapshot" ? "snapshot was replaced" : retirement === "epoch" ? "session changed" : "local reader was closed");
        expect(h.calls).toHaveLength(1);
      });
    }
  }
});

describe("account reader captured metadata adapter", () => {
  test("the light branch retains authoritative maps and exact session without reading raw representations", async () => {
    const h = accountAdapter();
    expect(frameAccount(h.frame)).toBeNull();
    const result = await h.result.readPresentations(h.targets);
    expect(result).toEqual(h.targets.map(target => ({ target, presentation: h.ownPresentations.get(target) })));
    expect(h.result.session).toBe(h.session); expect(h.result.session.evaluateContext).toBe(h.frame);
    expect(h.result.metadata).toBe(h.metadata); expect(h.result.ownPresentations).toBe(h.ownPresentations);
    expect(h.result.metadata.get(h.targets[0])).toBe(h.methods);
    expect(h.readers).toHaveLength(1); expect(h.readers[0]().session).toBe(h.session);
    expect(h.readers[0]().metadata).toBe(h.metadata); expect(h.readers[0]().ownPresentations).toBe(h.ownPresentations);
    for (const snapshot of h.presentationReads) {
      expect(snapshot.session).toBe(h.session); expect(snapshot.metadata).toBe(h.metadata);
      expect(snapshot.ownPresentations).toBe(h.ownPresentations);
    }
    expect(h.rawCalls).toEqual([]);
    expect(result[0].presentation).toBe(h.ownPresentations.get(h.targets[0]));
    expect(h.prepared.metadata.size).toBe(0); expect(h.prepared.ownPresentations.size).toBe(0);
  });

  test("the full branch forwards the exact prepared registry/frame and retains the captured own presentation", async () => {
    const h = accountAdapter();
    const result = await h.result.readMetadata(h.targets);
    expect(result).toEqual({ entries: h.targets.map(target => ({ target,
      representations: h.raw.get(target), ownPresentation: h.ownPresentations.get(target) })) });
    expect(h.rawCalls).toEqual(h.targets.map(target => ({ registry: h.registry, frame: h.frame, target })));
    for (const entry of result.entries) {
      expect(entry.representations).toBe(h.raw.get(entry.target));
      expect(entry.ownPresentation).toBe(h.ownPresentations.get(entry.target));
    }
    expect(h.result.metadata).toBe(h.metadata); expect(h.result.ownPresentations).toBe(h.ownPresentations);
  });

  for (const method of ["readPresentations", "readMetadata"]) {
    for (const retirement of ["request", "lifetime", "epoch", "close"]) {
      test(`${method} refuses ${retirement} retirement before any projection`, async () => {
        const h = accountAdapter(), request = new AbortController();
        if (retirement === "request") request.abort(new Error("request cancelled"));
        if (retirement === "lifetime") h.lifetime.abort(new Error("account lifetime cancelled"));
        if (retirement === "epoch") h.guard.change();
        if (retirement === "close") h.close();
        await expect(h.result[method](h.targets, request.signal)).rejects.toThrow(
          retirement === "request" ? "request cancelled" : retirement === "lifetime" ? "account lifetime cancelled"
            : retirement === "epoch" ? "session changed" : "reader was closed");
        expect(h.rawCalls).toEqual([]); expect(h.presentationReads).toEqual([]);
      });
    }
  }
});
