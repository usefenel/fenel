import { describe, expect, test } from "bun:test";

// C1/A2/B3: execute the actual worker receiver and reader transport adapters.
// Registry/dispatch/Fenel projection are controlled host ports, so this proves
// captured-session routing and transport, not a fresh checked-registry build.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const read = path => Bun.file(new URL(path, import.meta.url)).text();
const [workerSource, presentationSource, registrySource] = await Promise.all([
  read("./authoring-catalog-worker-main.ts"), read("../reader-presentation.ts"),
  read("../../../../../../implementations/typescript/engine/src/registry-transport.ts"),
]);
function section(source, first, last) {
  const start = source.indexOf(first), end = source.indexOf(last, start + first.length);
  if (start < 0 || end < 0) throw new Error(`Production fixture boundary moved: ${first}`);
  return source.slice(start, end);
}
const compiled = source => transpiler.transformSync(source).replace(/^export /gm, "");
const workerCode = compiled(workerSource.slice(workerSource.indexOf("const scope =")))
  .replaceAll("import.meta.env.BASE_URL", '"/"');
const transport = new Function(`${compiled(section(registrySource,
  "export function registryTransportSnapshot<", "/** An injective text encoding of a transport value,"))}; return registryTransportSnapshot;`)();
const representationCode = compiled(section(presentationSource,
  "export function representationsFromReaderSnapshot(", "export type ReaderPresentation ="));
const presentationCode = compiled(presentationSource.slice(presentationSource.indexOf("export function createReaderPresentation(")));
const retainedSourceCode = compiled(section(workerSource,
  "      readerPresentationSource = { catalog:", "      scope.postMessage({ id: data.id, ok: true, result: { catalog, displayCatalog } });"));
const clone = value => structuredClone(value);

function fixture() {
  const replies = [], selections = [], invocations = [], turns = [], helperLookups = [];
  const fn = { id: "Source.fn", params: [], returns: { $ref: "String" } };
  const registry = {
    getFunction: id => {
      if (id.startsWith("engine:") || id.startsWith("engine.")) {
        helperLookups.push(id);
        throw new Error("The public reader profile omits private engine helpers.");
      }
      return id === "Source.fn" || id === "physical-fn" ? fn : undefined;
    },
    getIdentifiedEntity: () => undefined,
    getEntityNominalIdentity: () => undefined,
    getUuid: id => id === "Source.fn" || id === "physical-fn" ? "physical-fn" : undefined,
  };
  const marker = { args: ["Labelable"], methods: {}, scope: "global", priority: 0 };
  const pool = {
    listInstances: () => [marker],
    listClasses: () => [{ name: "Labelable" }, { name: "Emojiable" }],
  };
  const session = { mode: "detached", registry, environment: {},
    evaluateContext: { marker: "base", _specRegistry: pool, selections: new Map([
      ["Labelable:physical-fn", { methods: { label: "Selected label" } }],
      ["Emojiable:physical-fn", { methods: { emoji: "🧭" } }],
    ]) } };
  const bindings = {
    resolveEffect(frame, selectedPool, typeName, target) {
      selections.push({ frame, selectedPool, typeName, target });
      return frame.selections.get(`${typeName}:${target}`);
    },
    frameVisibility: frame => ({ frame }),
    instanceVisible: (_row, visibility) => visibility.frame === session.evaluateContext || visibility.frame.marker === "scoped",
    Just: value => ({ $tag: "Just", _0: value }), Nothing: { $tag: "Nothing" },
    dispatchEngineBody(fnId, args, frame) {
      invocations.push({ fnId, args, frame });
      if (fnId === "engine:representationalClassNamesFromSnapshot") return ["Labelable", "Emojiable"];
      if (fnId === "engine:representationEntriesFromSnapshot") return args[0]
        .filter(row => row.instance.$tag === "Just").map(row => ({ typeName: row.typeName, instance: row.instance._0 }));
      throw new Error("Unexpected captured projection");
    },
    ownPresentationFromReaderSnapshot: (_frame, methods) => ({
      label: methods.get("Labelable")?.label, emoji: methods.get("Emojiable")?.emoji,
    }),
  };
  const adapters = new Function(...Object.keys(bindings), `${representationCode}\n${presentationCode};
    return { representationsFromReaderSnapshot, createReaderPresentation };`)(...Object.values(bindings));
  const source = { catalog: [{ id: "function", entries: [{ id: "Source.fn", name: "Catalogue fallback", fn }] }],
    functionRows: [{ id: "Source.fn", name: "Committed source name", function: fn }], types: [] };
  const snapshots = [];
  const imports = {
    globalThis: { postMessage: value => replies.push(clone(value)) },
    ...adapters,
    registryTransportSnapshot(value, label) { snapshots.push(label); return transport(value, label); },
    setTimeout(callback) { turns.push(callback); return turns.length; },
    createLocalAuthoringSession: (_base, scope) => scopeSession(scope),
    // B3: reader extensions are forwarded to their own module; none here.
    isReaderExtensionMethod: () => false,
    runReaderExtension: () => { throw new Error("No reader extension in this fixture."); },
  };
  let scopedSession;
  const scopeSession = scope => {
    scopedSession = { ...session, evaluateContext: { ...session.evaluateContext, marker: "scoped",
      selections: new Map([["Labelable:physical-fn", { methods: { label: scope.draft.body } }]]) } };
    return scopedSession;
  };
  const api = new Function(...Object.keys(imports), `${workerCode}; return {
    run, cancelled,
    install(session, source) { base = session; readerPresentationSource = source; },
  };`)(...Object.values(imports));
  api.install(session, source);
  async function release() {
    for (const callback of turns.splice(0)) callback();
    for (let turn = 0; turn < 6; turn++) await Promise.resolve();
  }
  return { api, session, source, registry, selections, invocations, snapshots, replies, helperLookups,
    scopedSession: () => scopedSession, release,
    async run(targets, extra = {}) {
      const id = replies.length + 1;
      const job = api.run({ id, method: "project-reader-metadata", contextId: 0, targets, ...extra });
      await release(); await job;
      return replies.find(row => row.id === id && "ok" in row);
    } };
}

describe("worker reader metadata transport", () => {
  test("private projection helpers receive the captured frame without public registry lookup", async () => {
    const h = fixture();
    const answer = await h.run(["physical-fn"]);
    expect(answer.ok).toBe(true);
    expect(h.helperLookups).toEqual([]);
    expect(h.invocations.map(call => call.fnId)).toEqual([
      "engine:representationalClassNamesFromSnapshot", "engine:representationEntriesFromSnapshot",
    ]);
    expect(h.invocations.every(call => call.frame === h.session.evaluateContext)).toBe(true);
    expect(h.selections.every(call => call.frame === h.session.evaluateContext
      && call.selectedPool === h.session.evaluateContext._specRegistry)).toBe(true);
  });
  test("lightweight presentations preserve ordering and misses without enumerating raw representations", async () => {
    const h = fixture();
    const answer = await h.run(["physical-fn", "missing", "Source.fn", "physical-fn"], { method: "project-reader-presentations" });
    expect(answer.ok).toBe(true);
    expect(answer.result).toEqual({ presentations: [
      { target: "physical-fn", presentation: { label: "Selected label", description: undefined, emoji: "🧭" } },
      { target: "missing", presentation: undefined },
      { target: "Source.fn", presentation: { label: "Selected label", description: undefined, emoji: "🧭" } },
      { target: "physical-fn", presentation: { label: "Selected label", description: undefined, emoji: "🧭" } },
    ] });
    expect(h.invocations).toHaveLength(0);
    expect(h.selections.every(call => call.frame === h.session.evaluateContext)).toBe(true);
    expect(h.snapshots).toEqual(["worker reader presentations request", "worker reader presentations result"]);
    expect((await h.run([], { method: "project-reader-presentations" })).result).toEqual({ presentations: [] });
  });

  test("lightweight presentations use the selected scoped frame without raw projection", async () => {
    const h = fixture();
    const answer = await h.run(["physical-fn"], { method: "project-reader-presentations", contextId: 4,
      scope: { sourceId: "tab-a", functions: [], draft: { id: "Source.fn", body: "Scoped presentation" } } });
    expect(answer.result.presentations[0].presentation.label).toBe("Scoped presentation");
    expect(h.selections.every(call => call.frame === h.scopedSession().evaluateContext)).toBe(true);
    expect(h.invocations).toHaveLength(0);
  });

  test("preserves target order, duplicate occurrences, exact-target misses and alias presentation", async () => {
    const h = fixture();
    const answer = await h.run(["physical-fn", "missing", "Source.fn", "physical-fn"]);
    expect(answer.ok).toBe(true);
    expect(answer.result.entries.map(row => row.target)).toEqual(["physical-fn", "missing", "Source.fn", "physical-fn"]);
    expect(answer.result.entries[0]).toEqual({ target: "physical-fn", representations: [
      { typeName: "Labelable", methods: { label: "Selected label" } },
      { typeName: "Emojiable", methods: { emoji: "🧭" } },
    ], ownPresentation: { label: "Selected label", description: undefined, emoji: "🧭" } });
    expect(answer.result.entries[1]).toEqual({ target: "missing", representations: [], ownPresentation: undefined });
    // Raw representation misses retain their exact target. Only the existing
    // presentation adapter follows the registered alias to the physical owner.
    expect(answer.result.entries[2].representations).toEqual([]);
    expect(answer.result.entries[2].ownPresentation.label).toBe("Selected label");
    expect(answer.result.entries[3]).toEqual(answer.result.entries[0]);
    expect(h.selections.every(call => call.frame === h.session.evaluateContext && call.selectedPool === h.session.evaluateContext._specRegistry)).toBe(true);
    expect(h.invocations.every(call => call.frame === h.session.evaluateContext)).toBe(true);
    expect(h.snapshots).toEqual(["worker reader metadata request", "worker reader metadata result"]);
  });

  test("uses scoped request dispatch while keeping committed row fallbacks inert", async () => {
    const h = fixture();
    const scope = { sourceId: "tab-a", functions: [], draft: { id: "Source.fn", body: "Draft-scoped label" } };
    const scoped = await h.run(["physical-fn"], { contextId: 1, scope });
    expect(scoped.result.entries[0].ownPresentation.label).toBe("Draft-scoped label");
    expect(scoped.result.entries[0].representations).toEqual([{ typeName: "Labelable", methods: { label: "Draft-scoped label" } }]);
    expect(h.selections.every(call => call.frame === h.scopedSession().evaluateContext)).toBe(true);
    expect(h.invocations.every(call => call.frame === h.scopedSession().evaluateContext)).toBe(true);
    h.session.evaluateContext.selections.clear();
    const unrepresented = await h.run(["Source.fn"]);
    expect(unrepresented.result.entries[0].ownPresentation.label).toBe("Committed source name");
    expect(h.source.functionRows[0].name).toBe("Committed source name");
  });

  test("empty batches stay empty and unreadable targets or missing preparation refuse", async () => {
    const h = fixture();
    expect((await h.run([])).result).toEqual({ entries: [] });
    for (const targets of [undefined, "Source.fn", [3], [null]]) {
      const answer = await h.run(targets);
      expect(answer.ok).toBe(false);
      expect(answer.error).toContain("targets could not be read");
    }
    h.api.install(h.session, undefined);
    expect((await h.run(["Source.fn"])).error).toContain("captured presentation is unavailable");
    expect(h.selections).toHaveLength(0);
  });

  test("cancellation before the projection turn makes no semantic calls or result", async () => {
    for (const method of ["project-reader-metadata", "project-reader-presentations"]) {
      const h = fixture(), id = 71;
      const job = h.api.run({ id, method, contextId: 0, targets: ["physical-fn"] });
      h.api.cancelled.add(id);
      await h.release(); await job;
      expect(h.selections).toHaveLength(0);
      expect(h.invocations).toHaveLength(0);
      expect(h.replies.some(row => "ok" in row)).toBe(false);
    }
  });

  test("strict transport refuses executable selected methods and accessor-bearing requests", async () => {
    const h = fixture();
    h.session.evaluateContext.selections.set("Labelable:physical-fn", { methods: {
      label: "A label", hostCallback: () => "must never cross",
    } });
    const executable = await h.run(["physical-fn"]);
    expect(executable.ok).toBe(false);
    expect(executable.error).toContain("executable transport data");
    h.selections.length = 0;
    let reads = 0;
    const targets = [];
    Object.defineProperty(targets, "0", { enumerable: true, get() { reads++; return "physical-fn"; } });
    const accessor = await h.run(targets);
    expect(accessor.ok).toBe(false);
    expect(accessor.error).toContain("accessor");
    expect(reads).toBe(0);
    expect(h.selections).toHaveLength(0);
  });

  test("retains the Local holder's exact committed row shape from initialization", () => {
    const snapshot = { owners: [
      { kind: "type", storageName: "Stored type", definition: { id: "type-id", type: { $ref: "String" }, label: "Source type" } },
      { kind: "function", storageName: "Stored function", definition: { id: "fn-id", params: [], returns: { $ref: "String" } } },
    ] };
    const catalog = [{ id: "function", entries: [] }];
    const project = new Function("data", "displayCatalog", `${compiled("let readerPresentationSource, localFieldSource, localPreparationInitialization, physicalPreviewPartition; let nextPhysicalPreviewSnapshot = 0;")}\n${retainedSourceCode}; return readerPresentationSource;`);
    const local = project({ localSourceId: "tab-a", snapshot }, catalog);
    expect(local.catalog).toBe(catalog);
    expect(local.types).toEqual([{ ...snapshot.owners[0].definition, id: "type-id", name: "Stored type", isSystem: false }]);
    expect(local.functionRows).toEqual([{ id: "fn-id", name: "Stored function", function: snapshot.owners[1].definition, isSystem: false }]);
    expect(local.functionRows[0].function).toBe(snapshot.owners[1].definition);
    expect(project({ snapshot }, catalog)).toEqual({ catalog });
  });
});
