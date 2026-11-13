import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// C1 API transport/currentness controls. The entire production Local API
// adapter runs here; worker IO and account query leaves supply inert replies.
// No registry or evaluator is initialized. These tests do not establish field
// reuse, visibility, owner matching or resurrection policy semantics.
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
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function epochGuard() {
  const source = read("./browser-session.ts"), start = source.indexOf("export class StaleSessionResponseError");
  if (start < 0) throw new Error("Browser epoch guard source boundary moved");
  return compile("let epoch = 8;\n" + source.slice(start), {},
    "{ assertCurrentSession, change: () => { epoch++; } }");
}
const forbidden = () => { throw new Error("Unexpected page-side field/resolver fallback"); };
const target = Object.freeze({ ownerKey: "held-owner:μ", ownerKind: "function", storageName: "Held owner" });
const operations = [
  { name: "catalog", method: "query-reader-field-catalog", call: client => client.getFieldAuthoringCatalog("Label + μ", "opaque+cursor"),
    payload: { method: "query-reader-field-catalog", query: { search: "Label + μ", cursor: "opaque+cursor" } } },
  { name: "identity", method: "query-reader-field-identity", call: client => client.getFieldAuthoringIdentity("exact-field:μ"),
    payload: { method: "query-reader-field-identity", fieldId: "exact-field:μ" } },
  { name: "resurrections", method: "query-reader-field-resurrections", call: client => client.getFieldResurrectionCatalog(target),
    payload: { method: "query-reader-field-resurrections", target } },
  { name: "facets", method: "query-reader-field-facets", call: client => client.getFieldFacetInstances(),
    payload: { method: "query-reader-field-facets" } },
];

function harness(options = {}) {
  const guard = epochGuard(), importGate = deferred(), imported = deferred(), workerStarted = deferred(), reply = deferred();
  const sourceId = "exact-local-source", definitions = Object.freeze({ owners: [], fields: [], facets: [] });
  const state = Object.freeze({ definitions, revision: 3 });
  const session = Object.freeze({ reader: sourceId, token: Object.freeze({ generation: 4 }) });
  const instances = Object.freeze([
    Object.freeze({ id: "retained-facet-instance", typeName: "Labelable", args: ["exact-field:μ"],
      methods: { label: { $ref: "held-label-function" }, detail: { __fenelFn: true, params: ["value"], body: { var: "value" } } },
      scope: { kind: "tag", tag: sourceId }, priority: 37 }),
    Object.freeze({ id: "retained-global-facet", typeName: "Iconable", args: ["retired-field"],
      methods: { icon: { __fenelPartial: true, fnId: "held-icon-function", args: ["box"] } }, scope: "global", priority: 0 }),
  ]);
  const registryCalls = [];
  const registry = Object.freeze({ getFunction: forbidden, listFieldRepresentations() {
    if (!options.accountId) forbidden();
    registryCalls.push(this); return instances;
  } });
  const handle0 = Object.freeze({ sourceId, token: Object.freeze({ generation: 9 }) });
  // B4 wave 4 lane S: a Local snapshot carries its own worker handle.
  const selected = Object.freeze(options.local ? { kind: "local", worker: handle0, session, registry } : { session, registry });
  const handle = handle0;
  let closed = false;
  const localRow = { fieldId: "exact-field:μ", codeName: "heldName", label: "Held field", owners: ["held-owner:μ"],
    occurrenceTypes: ["String"], realm: "local", reuseVisibility: "local", sourceId };
  const ownerRow = { ...localRow, fieldId: "owner-field", reuseVisibility: "owner" };
  const repositoryRow = { fieldId: "repository-field", codeName: "repositoryName", owners: ["RepositoryOwner"],
    occurrenceTypes: ["Number"], realm: "repository", reuseVisibility: "repository" };
  const responses = {
    "query-reader-field-catalog": { fields: [localRow, ownerRow, repositoryRow], facetInterfaceNames: ["Labelable"], nextCursor: "next+opaque" },
    "query-reader-field-identity": { field: options.missingIdentity ? null : localRow },
    "query-reader-field-resurrections": { fields: [{ fieldId: "retired-field", codeName: "Retired name" }] },
    "query-reader-field-facets": { dispatchInstances: [
      { typeName: "Labelable", args: instances[0].args, instance: instances[0] },
      { typeName: "Iconable", args: instances[1].args, instance: instances[1] },
    ] },
  };
  let snapshot = selected, snapshotReads = 0, currentHandle = handle;
  const imports = [], sessions = [], workerCalls = [], accountCalls = [], readiness = [];
  const source = { id: sourceId, epoch: 8,
    ready: async () => { readiness.push("full"); }, firstPaint: forbidden, readReady: forbidden, revision: () => 3,
    snapshot: () => { snapshotReads++; return snapshot; }, state: () => state, project: forbidden,
  };
  const accountQuery = name => async (...args) => {
    if (!options.accountId) forbidden();
    accountCalls.push({ name, args }); return responses[name];
  };
  const worker = {
    preparedReaderWorkerClosed: supplied => { expect(supplied).toBe(handle); return closed; },
    preparedReaderWorkerForSession: supplied => {
      if (options.local) throw new Error("A Local snapshot was routed through its page session");
      sessions.push(supplied); expect(supplied).toBe(session);
      if (options.accountId) throw new Error("Account query touched a private worker");
      if (options.retiredWorker) throw new Error("selected worker retired");
      return options.missingWorker ? undefined : currentHandle;
    },
    runPreparedReaderWorker: (selectedHandle, payload, signal) => {
      workerCalls.push({ handle: selectedHandle, payload, signal }); workerStarted.resolve();
      expect(selectedHandle).toBe(handle);
      if (options.workerFailure) return Promise.reject(new Error("selected worker refused"));
      const pending = options.holdWorker ? reply.promise : Promise.resolve(responses[payload.method]);
      return pending.then(value => { options.afterReply?.(); return value; });
    },
  };
  const client = compile(clientCode, {
    inheritCoreAuthoringOwner: () => {},
    assertCurrentSession: guard.assertCurrentSession,
    queryLocalFieldAuthoringCatalog: accountQuery("query-reader-field-catalog"),
    queryLocalFieldAuthoringIdentity: accountQuery("query-reader-field-identity"),
    queryLocalFieldResurrectionCatalog: accountQuery("query-reader-field-resurrections"),
    loadModule: async path => {
      imports.push({ path, snapshot, snapshotReads }); imported.resolve();
      if (options.accountId) throw new Error("Account query imported a private worker");
      expect(path).toBe("./expression-runner/authoring-catalog-worker");
      if (options.holdImport) await importGate.promise;
      if (options.importFailure) throw new Error("worker import refused");
      return worker;
    },
  }, "createLocalApiClient")(source, options.accountId ? { accountId: options.accountId } : {});
  return { client, sourceId, definitions, session, selected, registry, registryCalls, instances, handle, localRow, ownerRow, repositoryRow, responses, guard,
    imports, sessions, workerCalls, accountCalls, readiness, imported: imported.promise, workerStarted: workerStarted.promise,
    releaseImport: () => importGate.resolve(), releaseWorker: value => reply.resolve(value),
    replaceHandle: () => { currentHandle = Object.freeze({ ...handle, token: Object.freeze({ generation: 10 }) }); },
    close: () => { closed = true; },
    replace: () => { snapshot = Object.freeze({ ...selected, session: Object.freeze({ reader: "replacement" }) }); } };
}

describe("Local field API worker transport", () => {
  for (const operation of operations) {
    test(`${operation.name} uses one exact-reader worker request and preserves the API DTO`, async () => {
      const h = harness();
      const result = await operation.call(h.client);
      expect(result).toEqual(h.responses[operation.method]);
      expect(h.imports).toHaveLength(1); expect(h.imports[0].snapshot).toBe(h.selected);
      expect(h.imports[0].snapshotReads).toBeGreaterThanOrEqual(1);
      expect(h.sessions).toEqual([h.session, h.session]);
      for (const selectedSession of h.sessions) expect(selectedSession).toBe(h.session);
      expect(h.workerCalls).toHaveLength(1);
      expect(h.workerCalls[0]).toEqual({ handle: h.handle, payload: operation.payload, signal: h.client.signal });
      expect(h.workerCalls[0].handle).toBe(h.handle); expect(h.workerCalls[0].signal).toBe(h.client.signal);
      if (operation.name === "resurrections") expect(h.workerCalls[0].payload.target).toBe(target);
      expect(h.accountCalls).toEqual([]); expect(h.readiness).toEqual(["full"]);
      expect(h.registryCalls).toEqual([]);
      if (operation.name === "facets") {
        for (let index = 0; index < h.instances.length; index++) {
          expect(result.dispatchInstances[index].instance).toBe(h.instances[index]);
          expect(result.dispatchInstances[index].args).toBe(h.instances[index].args);
          expect(result.dispatchInstances[index].instance.methods).toBe(h.instances[index].methods);
          expect(result.dispatchInstances[index].instance.scope).toBe(h.instances[index].scope);
        }
      }
    });

    for (const failure of ["missingWorker", "retiredWorker", "workerFailure", "importFailure"]) {
      test(`${operation.name} refuses ${failure} without a page-side query`, async () => {
        const h = harness({ [failure]: true });
        await expect(operation.call(h.client)).rejects.toThrow();
        expect(h.accountCalls).toEqual([]);
        expect(h.workerCalls).toHaveLength(failure === "workerFailure" ? 1 : 0);
      });
    }

    test(`${operation.name} refuses a DTO from a different worker operation`, async () => {
      const h = harness({ holdWorker: true }), result = operation.call(h.client);
      await h.workerStarted;
      const wrong = operation.name === "identity" ? h.responses["query-reader-field-catalog"]
        : operation.name === "catalog" ? h.responses["query-reader-field-resurrections"] : h.responses["query-reader-field-catalog"];
      h.releaseWorker(wrong);
      await expect(result).rejects.toThrow("result could not be read");
      expect(h.accountCalls).toEqual([]);
    });
  }

  test("an absent exact identity stays absent without another lookup", async () => {
    const h = harness({ missingIdentity: true });
    expect(await h.client.getFieldAuthoringIdentity("exact-field:μ")).toEqual({ field: null });
    expect(h.workerCalls).toHaveLength(1); expect(h.accountCalls).toEqual([]);
  });

  test("catalog defaults keep the same search/cursor API", async () => {
    const h = harness();
    await h.client.getFieldAuthoringCatalog();
    expect(h.workerCalls[0].payload).toEqual({ method: "query-reader-field-catalog", query: { search: "", cursor: undefined } });
  });
});

describe("Local field API request lifetime", () => {
  for (const operation of operations) {
    for (const retirement of ["snapshot", "epoch", "dispose"]) {
      test(`${operation.name} refuses ${retirement} while the worker import is pending`, async () => {
        const h = harness({ holdImport: true }), result = operation.call(h.client);
        await h.imported;
        if (retirement === "snapshot") h.replace();
        if (retirement === "epoch") h.guard.change();
        if (retirement === "dispose") h.client.dispose();
        h.releaseImport();
        await expect(result).rejects.toThrow(retirement === "snapshot" ? "snapshot" : retirement === "epoch" ? "session changed" : "local reader was closed");
        expect(h.workerCalls).toEqual([]); expect(h.accountCalls).toEqual([]);
      });

      test(`${operation.name} refuses a late response after ${retirement}`, async () => {
        const h = harness({ holdWorker: true }), result = operation.call(h.client);
        await h.workerStarted;
        if (retirement === "snapshot") h.replace();
        if (retirement === "epoch") h.guard.change();
        if (retirement === "dispose") h.client.dispose();
        h.releaseWorker(h.responses[operation.method]);
        await expect(result).rejects.toThrow(retirement === "snapshot" ? "snapshot" : retirement === "epoch" ? "session changed" : "local reader was closed");
        expect(h.workerCalls).toHaveLength(1); expect(h.accountCalls).toEqual([]);
        if (retirement === "dispose") expect(h.workerCalls[0].signal.aborted).toBe(true);
      });
    }

    for (const retirement of ["snapshot", "epoch", "dispose"]) {
      test(`${operation.name} rechecks ${retirement} as the worker reply settles`, async () => {
        let h;
        h = harness({ afterReply: () => {
          if (retirement === "snapshot") h.replace();
          if (retirement === "epoch") h.guard.change();
          if (retirement === "dispose") h.client.dispose();
        } });
        await expect(operation.call(h.client)).rejects.toThrow(
          retirement === "snapshot" ? "snapshot" : retirement === "epoch" ? "session changed" : "local reader was closed");
        expect(h.workerCalls).toHaveLength(1); expect(h.accountCalls).toEqual([]);
      });
    }

    test(`${operation.name} refuses a replaced worker generation even when the source snapshot is unchanged`, async () => {
      const h = harness({ holdWorker: true }), result = operation.call(h.client);
      await h.workerStarted; h.replaceHandle(); h.releaseWorker(h.responses[operation.method]);
      await expect(result).rejects.toThrow("field worker was replaced");
      expect(h.workerCalls).toHaveLength(1); expect(h.accountCalls).toEqual([]);
      expect(h.sessions).toEqual([h.session, h.session]);
    });
  }
});

describe("Local snapshot field API routes by the snapshot's own worker (B4 wave 4 lane S)", () => {
  for (const operation of operations) {
    test(`${operation.name} asks the snapshot's worker handle, never its page session`, async () => {
      const h = harness({ local: true });
      await operation.call(h.client);
      expect(h.workerCalls).toHaveLength(1);
      expect(h.workerCalls[0].handle).toBe(h.handle);
      expect(h.workerCalls[0].payload).toEqual(operation.payload);
      expect(h.sessions).toEqual([]); expect(h.accountCalls).toEqual([]);
    });

    test(`${operation.name} refuses a closed snapshot worker without a request`, async () => {
      const h = harness({ local: true }); h.close();
      await expect(operation.call(h.client)).rejects.toThrow("field catalogue worker is unavailable");
      expect(h.workerCalls).toEqual([]);
    });

    test(`${operation.name} refuses a reply from a snapshot worker that closed meanwhile`, async () => {
      const h = harness({ local: true, holdWorker: true }), result = operation.call(h.client);
      await h.workerStarted; h.close(); h.releaseWorker(h.responses[operation.method]);
      await expect(result).rejects.toThrow("field worker was replaced");
    });
  }
});

describe("account field API retains its existing backend", () => {
  for (const operation of operations) {
    test(`${operation.name} retains its account backend and never imports a worker`, async () => {
      const h = harness({ accountId: "operator-account" });
      const result = await operation.call(h.client);
      if (operation.name === "facets") {
        expect(h.accountCalls).toEqual([]); expect(h.registryCalls).toEqual([h.registry]); expect(h.registryCalls[0]).toBe(h.registry);
        for (let index = 0; index < h.instances.length; index++) {
          expect(result.dispatchInstances[index].instance).toBe(h.instances[index]);
          expect(result.dispatchInstances[index].args).toBe(h.instances[index].args);
          expect(result.dispatchInstances[index].instance.methods).toBe(h.instances[index].methods);
          expect(result.dispatchInstances[index].instance.scope).toBe(h.instances[index].scope);
        }
      } else {
        const argument = operation.name === "catalog" ? operation.payload.query : operation.name === "identity" ? operation.payload.fieldId : target;
        expect(h.accountCalls).toEqual([{ name: operation.method, args: [h.sourceId, h.definitions, argument] }]);
        expect(h.accountCalls[0].args[1]).toBe(h.definitions);
        if (operation.name === "resurrections") expect(h.accountCalls[0].args[2]).toBe(target);
        expect(h.registryCalls).toEqual([]);
      }
      expect(h.imports).toEqual([]); expect(h.sessions).toEqual([]); expect(h.workerCalls).toEqual([]);
      const accountRow = { fieldId: "exact-field:μ", codeName: "heldName", label: "Held field", owners: ["held-owner:μ"],
        occurrenceTypes: ["String"], realm: "account", reuseVisibility: "account" };
      if (operation.name === "catalog") {
        expect(result).toEqual({ ...h.responses[operation.method], fields: [accountRow,
          { ...accountRow, fieldId: "owner-field", reuseVisibility: "owner" }, h.repositoryRow] });
        expect(result.fields[2]).toBe(h.repositoryRow);
      } else if (operation.name === "identity") expect(result).toEqual({ field: accountRow });
      else expect(result).toEqual(h.responses[operation.method]);
      expect(h.localRow.realm).toBe("local"); expect(h.localRow.sourceId).toBe(h.sourceId);
    });
  }

  test("an absent account identity remains null", async () => {
    const h = harness({ accountId: "operator-account", missingIdentity: true });
    expect(await h.client.getFieldAuthoringIdentity("unknown-field")).toEqual({ field: null });
    expect(h.imports).toEqual([]); expect(h.workerCalls).toEqual([]);
  });
});
