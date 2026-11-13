import { expect, test } from "bun:test";

// C1 host controls execute the production identity observations without booting
// a registry. Fenel admission and complete catalogue parity have their own cases
// in authoring-catalogue-artifact.test.ts.
const read = async path => (await Bun.file(new URL(path, import.meta.url)).text()).replace(/\r\n?/g, "\n");
const delta = await read("./authoring-catalogue-delta.ts");
const artifact = await read("./authoring-catalogue-artifact.ts");
const holder = await read("../local-locus-data.ts");
const between = (source, first, last) => {
  const begin = source.indexOf(first), end = source.indexOf(last, begin);
  if (begin < 0 || end < begin) throw new Error(`Saved-data observation boundary moved: ${first}`);
  return source.slice(begin, end);
};
const transpile = source => new Bun.Transpiler({ loader: "ts" }).transformSync(source).replace(/^export /gm, "");
const observations = transpile(between(delta, "function localRowTargets(", "// ---------------------------------------------------------------------------")
  + between(delta, "const baseStrings =", "// ---------------------------------------------------------------------------")
  + between(artifact, "export function localCatalogueRoster(", "export type LocalCatalogueRoster"));
const { observeLocalCatalogue, localCatalogueRoster, localValueIds: observeValueIds } = new Function("instanceVisible", "GLOBAL_ONLY", `${observations};return {observeLocalCatalogue,localCatalogueRoster,localValueIds};`)(
  row => row.scope?.kind === "global", Object.freeze({}),
);
const collect = new Function(transpile(between(holder, "function localSavedValueIds(", "export type LocalRepresentationRow")) + ";return localSavedValueIds;")();
function observe({ ids, installed = ["saved-number"], outer = ["saved-number"], baseStrings = [] } = {}) {
  const data = { localSourceId: "local", snapshot: { owners: [], fields: [], facets: [] }, entities: [], functions: [],
    localRepresentations: [{ args: outer }], ...(ids === undefined ? {} : { localValueIds: ids }) };
  const result = observeInput(data, installed, baseStrings);
  return { ...result, data };
}
function observeInput(data, installed, strings) {
  const registry = { modules: [], listIdentifiedEntities: () => [], getUuid: () => { throw Error("saved data is not an alias"); } };
  const rows = installed.map(target => ({ args: Array.isArray(target) ? target : [target], scope: { kind: "tag", tag: "local" } }));
  rows.unshift({ args: ["global-target"], scope: { kind: "global" } });
  const frame = { _specRegistry: { listInstances: () => rows } };
  const scope = { functionIds: new Set(), entityIds: new Set(), entityKeys: new Set(), modules: new Set(), mixedModules: [] };
  const catalogue = { types: [], functions: [], patternConstructors: [], exactFunctionRoutes: [], exactConstructorRoutes: [], referenceRoutes: [] };
  const base = { catalog: { ...catalogue, evidence: new Map(strings.map(id => [id, { description: id }])) }, displayCatalog: [] };
  const delta = { scope, identities: ["declaration"], catalog: catalogue };
  const observation = observeLocalCatalogue(registry, frame, data, base, delta, { repository: "r", catalogue: "r" });
  return { observation, roster: localCatalogueRoster(data, "local", observation), delta };
}

test("observes saved IDs separately, preserving repository function/name/UUID/type/field collisions", () => {
  const repository = ["std:negate", "Negate", "repository-uuid", "Number", "repository-field"];
  const { observation, roster, delta } = observe({ ids: ["saved-number", ...repository], baseStrings: repository });
  expect(observation.localValueIds).toEqual(["saved-number", ...repository]);
  expect(observation.repositoryValueMentions).toEqual(repository);
  expect(observation.repositoryMentions).toEqual([]);
  expect(observation.localIdentities).toBe(delta.identities);
  expect(delta.identities).toEqual(["declaration"]);
  expect(roster.localValueIds).toBe(observation.localValueIds);
  expect(roster.repositoryValueMentions).toBe(observation.repositoryValueMentions);
});

test("actual installed targets override outer representation arguments; structural and multiargument rows keep the refusal sentinel", () => {
  expect(observe({ ids: ["saved-number"], outer: ["saved-number"], installed: ["std:negate"] }).observation.localRowTargets).toEqual(["std:negate"]);
  expect(observe({ ids: ["saved-number"], outer: ["std:negate"] }).observation.localRowTargets).toEqual(["saved-number"]);
  for (const args of [[{ $literal: "saved-number" }], [{ $enum: ["saved-number"] }], [{ $ref: "saved-number" }], ["saved-number", "extra"], []]) {
    expect(observe({ ids: ["saved-number"], installed: [args] }).observation.localRowTargets).toEqual([""]);
  }
});

test("missing evidence is empty and malformed evidence reaches Fenel's nonempty-string check", () => {
  expect(observe().observation.localValueIds).toEqual([]);
  for (const ids of ["saved-number", [""], [42], [undefined], [, "saved-number"]]) {
    expect(observe({ ids }).observation.localValueIds).toEqual(Array.isArray(ids) && Object.hasOwn(ids, "0") ? ids : [""]);
  }
});

test("identity observation never materializes inherited array slots, accessors or inherited descriptor values", () => {
  let reads = 0;
  const inherited = Object.assign(Object.create({ localValueIds: ["saved-number"] }), observe().data);
  expect(observeInput(inherited, ["saved-number"], []).observation.localValueIds).toEqual([]);
  const data = observe().data;
  Object.defineProperty(data, "localValueIds", { get() { reads++; return ["saved-number"]; } });
  expect(observeInput(data, ["saved-number"], []).observation.localValueIds).toEqual([""]);
  const ids = new Array(1), prototype = Object.create(Array.prototype, { 0: { value: "saved-number" } });
  Object.setPrototypeOf(ids, prototype);
  expect(observe({ ids }).observation.localValueIds).toEqual([""]);
  const accessors = [];
  Object.defineProperty(accessors, "0", { get() { reads++; return "saved-number"; } });
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  Object.defineProperty(Object.prototype, "value", { configurable: true, writable: true, value: ["saved-number"] });
  try { expect(observe({ ids: accessors }).observation.localValueIds).toEqual([""]); }
  finally { if (prior) Object.defineProperty(Object.prototype, "value", prior); else delete Object.prototype.value; }
  expect(reads).toBe(0);
});

test("candidate collection observes only captured entry IDs without payloads or inherited identities", () => {
  const values = [{ id: "saved-number", get value() { throw Error("payload read"); } }];
  const evidence = collect({ values });
  values.push({ id: "later-number" });
  expect(evidence).toEqual(["saved-number"]);
  expect(collect({ values })).toEqual(["saved-number", "later-number"]);
  expect(collect()).toEqual([]);
  expect(collect({ values: [Object.create({ id: "saved-number" })] })).toEqual([""]);
  expect(collect({ values: [{ get id() { throw Error("identity read"); } }] })).toEqual([""]);
  expect(collect(Object.create({ values }))).toEqual([""]);
});

test("inherited index setters cannot replace newly observed identity evidence", () => {
  const prior = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let writes = 0, candidateIds, transportedIds;
  Object.defineProperty(Array.prototype, "0", { configurable: true, set() {
    writes++;
    Object.defineProperty(this, "0", { value: "forged-number", writable: true, enumerable: true, configurable: true });
  } });
  try {
    candidateIds = collect({ values: [{ id: "saved-number" }] });
    transportedIds = observeValueIds({ localValueIds: ["saved-number"] });
  } finally { if (prior) Object.defineProperty(Array.prototype, "0", prior); else delete Array.prototype[0]; }
  expect(candidateIds).toEqual(["saved-number"]);
  expect(transportedIds).toEqual(["saved-number"]);
  expect(writes).toBe(0);
});
