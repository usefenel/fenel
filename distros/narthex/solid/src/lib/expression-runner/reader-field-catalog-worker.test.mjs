import { describe, expect, test } from "bun:test";

// C1 transport controls: run the actual receiver, including initialize. The
// existing checked build and field-catalogue adapters are controlled host ports;
// these tests prove forwarding/lifetimes, not the field owner's semantic rules.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const [workerSource, registrySource] = await Promise.all([
  Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text(),
  Bun.file(new URL("../../../../../../implementations/typescript/engine/src/registry-transport.ts", import.meta.url)).text(),
]);
const workerStart = workerSource.indexOf("const scope =");
const transportStart = registrySource.indexOf("export function registryTransportSnapshot<");
const transportEnd = registrySource.indexOf("/** An injective text encoding of a transport value,", transportStart);
if (workerStart < 0 || transportStart < 0 || transportEnd < transportStart) throw new Error("The worker transport fixture boundary moved.");
const compiled = source => transpiler.transformSync(source).replace(/^export /gm, "");
const workerCode = compiled(workerSource.slice(workerStart)).replaceAll("import.meta.env.BASE_URL", '"/"');
const transport = new Function(`${compiled(registrySource.slice(transportStart, transportEnd))}; return registryTransportSnapshot;`)();
const clone = value => structuredClone(value);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const catalogRow = { fieldId: "live-field", codeName: "title", label: "A scoped label", owners: ["committed-owner"],
  occurrenceTypes: ["Result String [String]", "PreciseNominal"], realm: "local", reuseVisibility: "local", sourceId: "tab-a" };
const ownerRow = { ...catalogRow, fieldId: "owner-only-field", codeName: "privateField", reuseVisibility: "owner" };
const catalogPage = { fields: [catalogRow], facetInterfaceNames: ["Labelable", "Describable"], nextCursor: "exact-cursor/二" };
const resurrectionTarget = { ownerKey: "committed-owner", ownerKind: "type", storageName: "Stored type" };
const tombstones = { fields: [{ fieldId: "retired-field", codeName: "oldTitle" }] };
const facetInstances = [{ typeName: "Labelable", args: ["owner-only-field"], methods: { label: "Own field label" },
  priority: 47, scope: { kind: "tag", tag: "tab-a" }, methodOrigin: { declaration: "physical-facet-id" } },
{ typeName: "Describable", args: ["live-field"], methods: { description: "Exact committed facet", format: { $ref: "source.format" } },
  priority: 12, scope: "global" }];
const facetProjection = { dispatchInstances: facetInstances.map(instance => ({ typeName: instance.typeName, args: instance.args, instance })) };
const requests = [
  { method: "query-reader-field-catalog", query: { search: "a scoped name", cursor: "prior-cursor/一", limit: 7 } },
  { method: "query-reader-field-identity", fieldId: "owner-only-field" },
  { method: "query-reader-field-resurrections", target: resurrectionTarget },
  { method: "query-reader-field-facets" },
];

function fixture() {
  const replies = [], calls = [], builds = [], snapshots = [], turns = [], facetReads = [];
  let scopedConstructions = 0;
  const registry = { marker: "checked Local registry",
    listFieldRepresentations() { facetReads.push(this); return handlers.facets(); } };
  const initializer = { id: 1, method: "initialize", localSourceId: "tab-a", entities: [], functions: [],
    snapshot: {
      owners: [{ kind: "type", ownerKey: "committed-owner", storageName: "Stored type",
        definition: { id: "type-id", type: { $record: { fields: [] } } } }],
      fields: [{ fieldId: "owner-only-field", codeName: "privateField", retained: "exact committed field" },
        { fieldId: "retired-field", codeName: "oldTitle", status: "tombstone", origin: resurrectionTarget }],
      facets: [{ fieldId: "owner-only-field", typeName: "Labelable", methods: { label: "A scoped label" } }],
    } };
  const handlers = {
    catalog: async () => catalogPage,
    identity: async (_sourceId, _snapshot, fieldId) => ({ field: fieldId === "owner-only-field" ? ownerRow : null }),
    resurrections: async () => tombstones,
    facets: () => facetInstances,
  };
  const invoke = name => async (...args) => { calls.push({ name, args }); return handlers[name](...args); };
  const bindings = {
    isReaderExtensionMethod: () => false,
    globalThis: { postMessage: value => replies.push(clone(value)) },
    repositoryCatalogueIndex: { schema: "unavailable-test-artifact" }, AUTHORING_CATALOGUE_SCHEMA: "fixture-schema",
    repositoryCatalogueRealmKey: () => undefined,
    realmRepositoryCatalogue: (_key, load) => load(),
    buildLocalReaderFieldRegistry: async (...args) => { builds.push(args); return registry; },
    evaluateContextForCatalog: current => ({ registry: current, marker: "Local frame" }),
    mintAnonymousAuthority: current => ({ registry: current, marker: "anonymous authority" }),
    localCatalogue: async () => ({ catalog: { marker: "admitted catalogue" }, displayCatalog: [] }),
    LOCAL_BROWSER_SOURCE_ID: "tab-a",
    environmentForCatalog: catalog => ({ catalog }), createDetachedAuthoringEnvironment: environment => environment,
    queryLocalFieldAuthoringCatalog: invoke("catalog"),
    queryLocalFieldAuthoringIdentity: invoke("identity"),
    queryLocalFieldResurrectionCatalog: invoke("resurrections"),
    registryTransportSnapshot(value, label) { snapshots.push(label); return transport(value, label); },
    setTimeout(callback) { turns.push(callback); return turns.length; },
    createLocalAuthoringSession() { scopedConstructions++; throw new Error("Field lookup must not construct a draft context."); },
    createAccountAuthoringSession() { scopedConstructions++; throw new Error("Field lookup must not construct an account context."); },
  };
  const api = new Function(...Object.keys(bindings), `${workerCode}; return { run, cancelled,
    clearLocalSource() { localFieldSource = undefined; },
  };`)(...Object.values(bindings));
  async function release() {
    for (const callback of turns.splice(0)) callback();
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  }
  const start = request => api.run(request);
  const answer = id => replies.find(row => row.id === id && "ok" in row);
  let nextId = 10;
  async function run(payload) {
    const id = nextId++;
    const request = { id, contextId: 0, ...clone(payload) };
    const pending = start(request);
    await release(); await pending;
    return answer(id);
  }
  return { api, calls, builds, snapshots, replies, initializer, handlers, registry, facetReads, start, release, answer, run,
    scopedConstructions: () => scopedConstructions,
    async initialize() {
      const captured = clone(initializer);
      await api.run(captured);
      expect(answer(captured.id)).toMatchObject({ ok: true });
      return captured;
    } };
}

describe("Local field catalog worker transport", () => {
  test("all field reads use the exact successful Local initialization source, snapshot and registry", async () => {
    const h = fixture(), initialized = await h.initialize();
    // A caller's subsequently changed input is not the receiver's cloned
    // initialization, and later request lookalikes cannot select new fields.
    h.initializer.snapshot.fields[0].retained = "caller changed";
    const results = [];
    for (const payload of requests) results.push(await h.run({ ...payload,
      sourceId: "foreign-source", localSourceId: "foreign-source", snapshot: { owners: [], fields: ["uncommitted"], facets: [] } }));
    expect(results.map(row => row.ok)).toEqual([true, true, true, true]);
    expect(results.map(row => row.result)).toEqual([catalogPage, { field: ownerRow }, tombstones, facetProjection]);
    expect(h.calls.map(call => call.name)).toEqual(["catalog", "identity", "resurrections"]);
    for (const call of h.calls) {
      expect(call.args[0]).toBe("tab-a");
      expect(call.args[1]).toBe(initialized.snapshot);
      expect(call.args[1]).toBe(h.builds[0][1]);
      expect(call.args[1].fields[0].retained).toBe("exact committed field");
    }
    expect(h.calls[0].args[2]).toEqual(requests[0].query);
    expect(h.calls[1].args[2]).toBe("owner-only-field");
    expect(h.calls[2].args[2]).toEqual(resurrectionTarget);
    expect(h.facetReads).toEqual([h.registry]);
    const returnedFacet = results[3].result.dispatchInstances[0];
    expect(returnedFacet.args).toBe(returnedFacet.instance.args);
    expect(returnedFacet.instance).not.toBe(facetInstances[0]);
    expect(h.scopedConstructions()).toBe(0);
  });

  test("identity discovery remains owner-only and misses stay misses", async () => {
    const h = fixture(); await h.initialize();
    const known = await h.run(requests[1]);
    expect(known.result.field.reuseVisibility).toBe("owner");
    expect(known.result.field.occurrenceTypes).toEqual(ownerRow.occurrenceTypes);
    const missing = await h.run({ method: "query-reader-field-identity", fieldId: "draft-only-field" });
    expect(missing.result).toEqual({ field: null });
  });

  test("draft/module selectors and absent Local preparation refuse before any field query or context build", async () => {
    const h = fixture(); await h.initialize();
    for (const payload of requests) {
      for (const selectors of [
        { contextId: 9 }, { sourceModule: "foreign-module" },
        { scope: { sourceId: "tab-a", functions: [], draft: { id: "draft", fields: ["draft-only-field"] } } },
      ]) expect((await h.run({ ...payload, ...selectors })).ok).toBe(false);
    }
    expect(h.calls).toHaveLength(0);
    expect(h.facetReads).toHaveLength(0);
    expect(h.scopedConstructions()).toBe(0);
    h.api.clearLocalSource();
    for (const payload of requests) expect((await h.run(payload)).ok).toBe(false);
    expect(h.calls).toHaveLength(0);
    expect(h.facetReads).toHaveLength(0);
  });

  test("all field reads cancel before projection and async field leaves suppress held replies", async () => {
    for (const payload of requests) {
      const early = fixture(); await early.initialize();
      const id = 73, job = early.start({ ...clone(payload), id, contextId: 0 });
      early.api.cancelled.add(id);
      await early.release(); await job;
      expect(early.calls).toHaveLength(0);
      expect(early.facetReads).toHaveLength(0);
      expect(early.answer(id)).toBeUndefined();

      if (payload.method === "query-reader-field-facets") continue;
      const held = fixture(); await held.initialize();
      const gate = deferred();
      for (const name of Object.keys(held.handlers)) held.handlers[name] = () => gate.promise;
      const running = held.start({ ...clone(payload), id, contextId: 0 });
      await held.release();
      expect(held.calls).toHaveLength(1);
      held.api.cancelled.add(id);
      gate.resolve({ held: "never publish after cancellation" });
      await running;
      expect(held.answer(id)).toBeUndefined();
    }
  });

  test("strict result transport rejects host callables and accessors without invoking them", async () => {
    for (const [index, payload] of requests.slice(0, 3).entries()) {
      const h = fixture(); await h.initialize();
      const name = ["catalog", "identity", "resurrections"][index];
      h.handlers[name] = async () => ({ hostCallback: () => "must never cross" });
      const callable = await h.run(payload);
      expect(callable.ok).toBe(false);
      expect(callable.error).toContain("executable transport data");
      let reads = 0;
      const selected = {};
      Object.defineProperty(selected, "field", { enumerable: true, get() { reads++; return ownerRow; } });
      h.handlers[name] = async () => selected;
      const accessor = await h.run(payload);
      expect(accessor.ok).toBe(false);
      expect(accessor.error).toContain("accessor");
      expect(reads).toBe(0);
    }
  });

  test("facet transport preserves the exact committed scopes/methods and refuses executable or accessor methods", async () => {
    const h = fixture(); await h.initialize();
    const payload = { method: "query-reader-field-facets" };
    expect((await h.run(payload)).result).toEqual(facetProjection);
    h.handlers.facets = () => [{ ...facetInstances[0], methods: { formatter: () => "host callback" } }];
    const callable = await h.run(payload);
    expect(callable.ok).toBe(false);
    expect(callable.error).toContain("executable transport data");
    let reads = 0;
    const methods = {};
    Object.defineProperty(methods, "label", { enumerable: true, get() { reads++; return "must not read"; } });
    h.handlers.facets = () => [{ ...facetInstances[0], methods }];
    const accessor = await h.run(payload);
    expect(accessor.ok).toBe(false);
    expect(accessor.error).toContain("accessor");
    expect(reads).toBe(0);
    expect(h.facetReads.every(registry => registry === h.registry)).toBe(true);
  });

  test("strict request transport rejects accessor-bearing query/target fields before adapter reads", async () => {
    const h = fixture(); await h.initialize();
    let reads = 0;
    for (const [index, payload] of [requests[0], requests[2]].entries()) {
      const key = payload.method === "query-reader-field-catalog" ? "query" : "target";
      const body = {};
      Object.defineProperty(body, "selector", { enumerable: true, get() { reads++; return "must never read"; } });
      const id = 81 + index;
      const pending = h.start({ ...payload, [key]: body, id, contextId: 0 });
      await h.release(); await pending;
      expect(h.answer(id).ok).toBe(false);
      expect(h.answer(id).error).toContain("accessor");
    }
    expect(reads).toBe(0);
    expect(h.calls).toHaveLength(0);
  });
});
