import "../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import type { DataSuggestionInput } from "./data-suggestions";

// Ranking regression (checkpoint 3 rehearsal, Nov 8 07:05): on a Number (21) the
// first check listed only generic `a -> ...` developer functions alphabetically
// (Canonical string, Identity, Is null, ...), and on "Bonjour" no Uppercase /
// Capitalize / Reverse. The first check (32 operations, DataInspectionDialog's
// default) must reach the subject type's own operations. One actual Local
// registry and the FULL captured catalogue, as the panel's worker uses them; run
// alone in the shared heavy slot:
//   bun --no-env-file test --timeout 600000 ./src/lib/data-suggestions-ranking.test.ts  (distro dir, FENEL_PARSER_LEGACY=1)
const SOURCE = "fenel-browser-local-ranking";
const [reader, catalogue, artifact, detached, mint, suggestions, authoringEnvironment] = await Promise.all([
  import("./reader-registry"), import("./expression-runner/authoring-catalog"),
  import("./expression-runner/authoring-catalogue-artifact"), import("./expression-runner/detached-authoring-environment"),
  import("../../../../../implementations/typescript/runtime/src/authority-mint"), import("./data-suggestions"),
  import("@fenel/engine/authoring/environment"),
]);
const saved = { owners: [], fields: [], facets: [] };
const registry = await reader.buildLocalReaderFieldRegistry(SOURCE, saved as never, { preparation: "inline", representations: [] });
const frame = Object.freeze({ ...catalogue.evaluateContextForCatalog(registry), _authority: mint.mintAnonymousAuthority(registry),
  _activeTags: Object.freeze([SOURCE]) as unknown as string[] });
const { catalog } = await artifact.localCatalogue(registry, frame,
  { localSourceId: SOURCE, snapshot: saved, entities: [], functions: [], localRepresentations: [] } as never, undefined,
  { catalogueSourceId: SOURCE, graceMs: 0 });
const environment = detached.createDetachedAuthoringEnvironment(catalogue.environmentForCatalog(catalog, registry));
const session: AuthoringSession = Object.freeze({ mode: "detached", registry, catalog: environment.catalog, environment, evaluateContext: frame });
console.info("[ranking-catalogue]", session.catalog.functions.length, "functions");

// The panel transports a pasted value's type as its exact identity handle
// ({$ref: <system Number UUID>}); since the registry admits that handle in every
// frame, the subject kept its UUID spelling and shared no parameter's head.
const systemType = (name: string) => {
  const handle = registry.getTypeUuid("system", name);
  if (!handle) throw new Error(`no system ${name} type identity`);
  return { $ref: handle };
};
const firstCheck = async (value: unknown, revision: string, type?: unknown) => {
  const input: DataSuggestionInput = { revision, value, expression: { kind: "literal", value } as never,
    ...(type === undefined ? {} : { type: type as never }) };
  try {
    const inferred = authoringEnvironment.inferAuthoringExpressionWithLiteralWitnesses({ kind: "literal", value } as never,
      { ...session.environment } as never) as { outcome: { $tag: string }; scheme?: unknown };
    console.info("[ranking-subject]", revision, inferred.outcome.$tag, JSON.stringify(inferred.scheme).slice(0, 600));
  } catch (error) { console.info("[ranking-subject]", revision, "threw", String(error).slice(0, 300)); }
  const started = performance.now();
  const batch = await suggestions.discoverDataSuggestions(session, input, { reuse: false, maxOperations: 32, maxSuggestions: 20 });
  console.info("[ranking-ms]", revision, type === undefined ? "untyped" : "typed", Math.round(performance.now() - started));
  const rows = batch.suggestions.map(row => ({ label: row.label, family: row.family, applicability: row.applicability }));
  console.info("[ranking]", revision, JSON.stringify({ coverage: batch.coverage, rows, undecided: batch.undecided.slice(0, 12).map(row => row.label) }).slice(0, 4000));
  return { batch, labels: batch.suggestions.map(row => row.label), report: JSON.stringify(rows) };
};

// For diagnosis: how the subject and two known operations' first parameters are spelled.
const describeEntry = (name: string) => {
  const id = environment.resolveFunctionId(name);
  const entry = session.catalog.functions.find(row => (row.targetId ?? row.id) === id);
  const declaration = id ? environment.getFunctionEntry?.(id) as { scheme?: { body?: { $arrow?: { params?: { type?: unknown }[] } } }; parentModule?: string; signatureOutcome?: { $tag: string } } | undefined : undefined;
  console.info("[ranking-entry]", name, JSON.stringify({ id, inCatalogue: !!entry, parentModule: entry?.parentModule ?? declaration?.parentModule,
    outcome: declaration?.signatureOutcome?.$tag, param0: declaration?.scheme?.body?.$arrow?.params?.[0]?.type }).slice(0, 600));
};

describe("Suggestions: the first check reaches the subject type's own operations", () => {
  test("a Number ranks its arithmetic (Negate, Double, Absolute value) in the first rows, not developer helpers", async () => {
    for (const name of ["std.negate", "std.abs", "std.double", "std.canonicalString", "std.isNull", "std.identity"]) describeEntry(name);
    await firstCheck(21, "number-untyped");
    const { labels, report } = await firstCheck(21, "number", systemType("Number"));
    expect(labels.slice(0, 12).filter(label => /Negate|Double|Absolute value|Square|Increment|Ceiling|Floor/.test(label)).length, report)
      .toBeGreaterThan(0);
    expect(labels.slice(0, 8), report).not.toContain("Canonical string");
    expect(labels.slice(0, 8), report).not.toContain("JS literal encode");
  }, 600_000);

  test("a String ranks its text operations (Uppercase, Capitalize, Reverse) in the first rows", async () => {
    for (const name of ["std.upper", "std.capitalize", "std.reverse"]) describeEntry(name);
    const { labels, report } = await firstCheck("Bonjour", "string", systemType("String"));
    expect(labels.slice(0, 12).filter(label => /Uppercase|Capitalize|Reverse|Lowercase|Trim/.test(label)).length, report).toBeGreaterThan(0);
    expect(labels.slice(0, 8), report).not.toContain("Canonical string");
  }, 600_000);
});

// Lane D (2026-11-09, Rom): pinned actions (std functions tagged "pin") come
// first on their types; a type without pins keeps the automatic order.
describe("Suggestions: pinned actions first", () => {
  test("\"Bonjour\" and 21 show their pins first; a Boolean (no pins) keeps the automatic order", async () => {
    const text = await firstCheck("Bonjour", "string-pins", systemType("String"));
    console.info("[pins-bonjour]", JSON.stringify(text.labels.slice(0, 10)));
    for (const label of ["Uppercase", "Lowercase", "Reverse", "Length"]) expect(text.labels.slice(0, 4), text.report).toContain(label);
    const number = await firstCheck(21, "number-pins", systemType("Number"));
    console.info("[pins-number]", JSON.stringify(number.labels.slice(0, 10)));
    for (const label of ["Double", "Negate", "Round", "Absolute value"]) expect(number.labels.slice(0, 4), number.report).toContain(label);
    const flag = await firstCheck(true, "boolean-pins", registry.getTypeUuid("system", "Boolean") ? systemType("Boolean") : systemType("Bool"));
    console.info("[pins-boolean]", JSON.stringify(flag.labels.slice(0, 10)));
    expect(flag.batch.suggestions.every(row => row.pin.$tag === "Nothing"), flag.report).toBe(true);
  }, 600_000);
});

// Nov 11 (Rom: "Aren't array and list the same in Fenel?!"): representation
// bridges (the Fenel `suggestionRepresentationBridge` rule over each function's
// own tags) never reach Suggestions; an ordinary operation of the same type
// does, and the bridges stay in the reader's catalogue.
describe("Suggestions: representation bridges are not offered", () => {
  const bridgeNames = ["std.listToArray", "std.arrayToList", "std.stringToCharList", "std.charListToString",
    "std.numberToInt", "std.numberToNat", "std.numberToRational", "std.numberToReal", "std.towerToDouble", "std.doubleToTower"];
  const ordinaryNames = ["std.reverse", "std.double", "std.upper"];
  const entryOf = (name: string) => {
    const id = environment.resolveFunctionId(name);
    const entry = session.catalog.functions.find(row => (row.targetId ?? row.id) === id);
    if (!id || !entry) throw new Error(`${name} is not in the reader's catalogue`);
    return { id, entry, handle: registry.getUuid(id) };
  };
  const marked = (name: string) => {
    const { id, entry, handle } = entryOf(name);
    return suggestions.functionRepresentationBridge(session, [id, entry.id, handle]);
  };
  const wide = async (value: unknown, revision: string, type?: unknown) => {
    const input: DataSuggestionInput = { revision, value, expression: { kind: "literal", value } as never,
      ...(type === undefined ? {} : { type: type as never }) };
    const batch = await suggestions.discoverDataSuggestions(session, input, { reuse: false, maxOperations: 4096, maxSuggestions: 400 });
    const labels = [...batch.suggestions, ...batch.undecided].map(row => row.label);
    return { batch, labels, report: JSON.stringify({ coverage: batch.coverage, labels }).slice(0, 4000) };
  };

  test("the rule marks the bridges, read from their own tags, and nothing ordinary", () => {
    for (const name of bridgeNames) expect(marked(name), name).toBe(true);
    for (const name of ordinaryNames) expect(marked(name), name).toBe(false);
  });

  test("a list of numbers, a number and a text meet no bridge; their own operations stay; the counts leave bridges out", async () => {
    const bridgeLabels = bridgeNames.map(name => entryOf(name).entry.label);
    const dropped = session.catalog.functions.filter(row => row.kind !== "constructor"
      && suggestions.functionRepresentationBridge(session, [row.targetId ?? row.id, row.id, registry.getUuid(row.targetId ?? row.id)])).length;
    expect(dropped).toBeGreaterThanOrEqual(bridgeNames.length);
    // The list's type is inferred from the literal, as the panel does for pasted data.
    const list = await wide([1, 2, 3], "list-bridges");
    expect(list.labels, list.report).toContain(entryOf("std.reverse").entry.label);
    const number = await wide(21, "number-bridges", systemType("Number"));
    expect(number.labels, number.report).toContain(entryOf("std.double").entry.label);
    const text = await wide("Bonjour", "text-bridges", systemType("String"));
    expect(text.labels, text.report).toContain(entryOf("std.upper").entry.label);
    for (const run of [list, number, text]) {
      for (const label of bridgeLabels) expect(run.labels, `${label} ${run.report}`).not.toContain(label);
      // Dropped before counting: neither checked nor reported as not shown.
      expect(run.batch.coverage.operationsSeen, run.report).toBe(session.catalog.functions.length - dropped);
    }
  }, 600_000);
});
