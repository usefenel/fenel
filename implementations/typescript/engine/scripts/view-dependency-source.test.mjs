import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadFenelModule } from "../src/fenel-module.ts";
import { evaluate, ownDataRead } from "../src/json-logic.ts";
import * as expressionRuntime from "../src/json-logic.ts";
import * as checkpointRuntime from "../src/checkpoint-json.ts";
import { exprNodeToLogic, observeExprNode } from "../src/authoring/expression-authoring.ts";
import { stdNatives, stdNativesCtx } from "../../../../fenel/modules/std/ffi/std-ffi.ts";
import { readerSourceMetadataNative } from "../../../../fenel/modules/view/ffi/source-metadata.ts";
import { authoringInvocationAdmission } from "../../../../distros/narthex/solid/src/lib/expression-runner/invocation-admission.ts";
import { authoringStructureEnvironment, concreteAuthoringSession } from "../../../../distros/narthex/solid/src/lib/expression-runner/account-authoring-session.ts";
import { savedExpressionDeclaration, savedExpressionDeclarationEntries } from "../../../../distros/narthex/solid/src/lib/saved-expression-map.ts";
import { assertCurrentSession, sessionEpoch } from "../../../../distros/narthex/solid/src/lib/browser-session.ts";

// Actual Fenel dependency source and evaluator, using the existing isolated
// view-address-source/std-sort source harness. No repository/product registry,
// worker, account data, authority acquisition, source AST or image is loaded.
// The host supplies inert metadata packets; Fenel owns selection and graphing.
const modules = ["types.fenel", "local-data.fenel", "dependencies.fenel"].map(file =>
  loadFenelModule(readFileSync(new URL(`../../../../fenel/modules/view/${file}`, import.meta.url), "utf8"), "view"));
modules.push(loadFenelModule(readFileSync(new URL("../../../../fenel/modules/std/appendItem.fenel", import.meta.url), "utf8"), "std"));
// std `includes`/`unique` are Fenel-bodied since S1; their B4 fast paths
// re-enter these source bodies, so the isolated harness carries them too.
modules.push(loadFenelModule(readFileSync(new URL("../../../../fenel/modules/std/native/collection-native.fenel", import.meta.url), "utf8"), "std"));
// Edge labels humanize the source field name with the engine's own formatter.
modules.push(loadFenelModule(readFileSync(new URL("../../../../fenel/modules/engine/humanize-code-name.fenel", import.meta.url), "utf8"), "engine"));
const functions = modules.flatMap(module => module.functions ?? []);
const functionsById = new Map(functions.map(fn => [fn.id, fn]));
const functionsByName = new Map(functions.map(fn => [fn.id.split(":").at(-1), fn]));
const context = {
  getFunction: name => functionsById.get(name) ?? functionsByName.get(name),
  natives: Object.assign(Object.create(null), stdNatives),
  nativesCtx: Object.assign(Object.create(null), stdNativesCtx, { readerSourceMetadata: readerSourceMetadataNative,
    "view:readerSourceMetadata": readerSourceMetadataNative }),
  _constructors: {
    Nothing: [], Just: ["_0"], Ok: ["_0"], Err: ["_0"],
    SourceReference: ["identity"], SourceFieldReference: ["identity", "field"], SourceCall: ["identity"], SourceConstructor: ["identity"], SourceCodeReference: ["identity"], SourceUnknown: ["issue"], SourceApplication: [], SourceLiteral: [], SourceParameter: [],
    SourceExpressionMetadata: ["id", "label", "slots"], SourceOccurrenceMetadata: ["id", "label", "expressionId", "referenceId"],
    ReaderSourceMetadata: ["source", "rootId", "generation", "expressions", "occurrences", "callableLabels"],
    DependencySourceLocator: ["source", "rootId", "occurrenceId"],
    DependencyNode: ["id", "label"], DependencyEdge: ["from", "to", "labels"], DependencyGraph: ["focus", "nodes", "edges", "scope"],
    DependencyLinkedWalk: ["nodes", "edges", "seen", "next"], DependencyLinks: ["nodes", "edges", "linked"],
    DependencyWalkStep: ["identity", "towardParts", "towardUsers"],
  },
};
const Nothing = { $tag: "Nothing" };
const just = value => ({ $tag: "Just", _0: value });
const source = { $tag: "ThisTabSource" };
const locator = Object.freeze({ $tag: "DependencySourceLocator", source, rootId: "root-a", occurrenceId: "selected-occurrence" });
const reference = identity => ({ $tag: "SourceReference", identity });
const callSlot = identity => ({ $tag: "SourceCall", identity });
const expression = (id, label, slots = []) => ({ $tag: "SourceExpressionMetadata", id, label, slots });
const occurrence = (id, label, expressionId, referenceId = Nothing) =>
  ({ $tag: "SourceOccurrenceMetadata", id, label, expressionId, referenceId });
const node = (id, label) => ({ $tag: "DependencyNode", id, label });
function packet(changes = {}) {
  return { $tag: "ReaderSourceMetadata", source, rootId: "root-a", generation: "reader-a:1",
    expressions: [
      expression("selected-expression", "Selected source", [reference("saved-input"), callSlot("std:reverse"),
        { $tag: "SourceLiteral" }, { $tag: "SourceParameter" }]),
      expression("saved-input", "Input data"),
      expression("incoming-expression", "Incoming source", [reference("selected-ref")]),
    ],
    occurrences: [occurrence("selected-occurrence", "Selected data", "selected-expression", just("selected-ref")),
      occurrence("input-occurrence", "Input data", "saved-input", just("saved-input")),
      occurrence("incoming-occurrence", "Visible consumer", "incoming-expression", just("incoming-ref"))],
    callableLabels: [node("std:reverse", "Reverse")], ...changes };
}
function call(name, args, frame = context) {
  return evaluate({ call: [`view:${name}`, ...args.map((_, index) => ({ var: `arg${index}` }))] },
    Object.fromEntries(args.map((arg, index) => [`arg${index}`, arg])), frame);
}
const fromMetadata = (metadata, selected = locator) => call("dependencyQueryFromMetadata", [selected, metadata]);
function graph(result) {
  expect(result?.$tag).toBe("Ok");
  expect(result?._0?.$tag).toBe("DependencyGraph");
  expect(Array.isArray(result?._0?.nodes)).toBe(true);
  expect(Array.isArray(result?._0?.edges)).toBe(true);
  return result._0;
}
const edges = value => value.edges.map(edge => [edge.from, edge.to]);
const nodes = value => value.nodes.map(value => [value.id, value.label]);
function refused(result) {
  expect(result?.$tag).toBe("Err");
  expect(typeof result?._0).toBe("string");
  expect(result._0.length).toBeGreaterThan(0);
  expect(result._0?.$tag).not.toBe("DependencyGraph");
}

// This is one ordinary retained executable query. It contains only a locator;
// each normal evaluation receives its current reader's inert packet in frame.
const queryNode = { kind: "call", fnId: "view:dependencyQuery", args: [{ kind: "literal", value: locator }] };
const retainedQuery = exprNodeToLogic(queryNode, { fnCodeName: id => id, constructorName: () => undefined });
const retainedBytes = JSON.stringify(retainedQuery);
const run = metadata => evaluate(retainedQuery, {}, { ...context, _readerSourceMetadata: metadata });
// Execute the actual browser packet transport bodies without importing its
// unrelated account-session environment barrel. No test projection replaces
// the real roster, codec, packet construction, frame leaf or Fenel query.
const packetAdapterSource = readFileSync(new URL("../../../../distros/narthex/solid/src/lib/reader-source-metadata.ts", import.meta.url), "utf8");
const packetAdapterFrom = packetAdapterSource.indexOf("export function sourceExecutableSlots(");
const packetAdapterTo = packetAdapterSource.indexOf("export function assertReaderSourceMetadata(", packetAdapterFrom);
if (packetAdapterFrom < 0 || packetAdapterTo < 0) throw new Error("Reader packet transport boundary moved");
const { readerSourceMetadataPacket } = new Function("observeExprNode", "ownDataRead",
  new Bun.Transpiler({ loader: "ts" }).transformSync(packetAdapterSource.slice(packetAdapterFrom, packetAdapterTo)).replaceAll("export ", "")
    + "; return { readerSourceMetadataPacket };")(observeExprNode, ownDataRead);
const metadataPorts = new Function("observeExprNode", "ownDataRead", "concreteAuthoringSession",
  new Bun.Transpiler({ loader: "ts" }).transformSync(packetAdapterSource.slice(packetAdapterFrom)).replaceAll("export ", "")
    + "; return { assertReaderSourceMetadata, captureReaderSourceMetadata, readerSourceMetadataFrame };")
  (observeExprNode, ownDataRead, concreteAuthoringSession);
const expressionEvaluationSource = readFileSync(new URL("../../../../distros/narthex/solid/src/lib/expression-runner/expression-evaluation.ts", import.meta.url), "utf8");
const expressionEvaluationFrom = expressionEvaluationSource.indexOf("export function authoringExpressionLogic(");
if (expressionEvaluationFrom < 0) throw new Error("Ordinary expression evaluation boundary moved");
const evaluationBindings = { ...expressionRuntime, ...checkpointRuntime, ...metadataPorts, exprNodeToLogic,
  authoringInvocationAdmission, authoringStructureEnvironment };
const ordinaryEvaluation = new Function(...Object.keys(evaluationBindings),
  new Bun.Transpiler({ loader: "ts" }).transformSync(expressionEvaluationSource.slice(expressionEvaluationFrom)).replace(/^export /gm, "")
    + "; return { evaluateAuthoringExpressionInSession, authoringExpressionLogic, authoringExpressionSourceEntries, authoringExpressionSites, reachedSavedSources };")(...Object.values(evaluationBindings));
function ordinaryFixture() {
  let captured;
  let closed = false;
  let reads = 0;
  const session = { evaluateContext: { ...context }, environment: { functionCodeName: id => id,
    constructorCodeName: () => undefined, operatorCodeName: () => undefined },
    captureSourceMetadata: () => { reads++; return closed ? undefined : captured; } };
  function replace(metadata) {
    closed = false;
    const next = { session, packet: metadata, generationToken: {}, current: () => !closed && captured === next };
    captured = next;
    return next;
  }
  replace(packet());
  return { session, replace, close: () => { closed = true; }, reads: () => reads,
    evaluate: options => ordinaryEvaluation.evaluateAuthoringExpressionInSession(queryNode, undefined, session, {}, { trace: false, ...options }) };
}

describe("Fenel dependency query over the current reader metadata", () => {
  test("the declared public query is Result, reads one frame snapshot and keeps a body", () => {
    const query = functionsById.get("view:dependencyQuery");
    expect(query?.body).toBeDefined();
    expect(query?.params).toHaveLength(1);
    expect(functionsById.get("view:dependencyQueryFromMetadata")?.body).toBeDefined();
    expect(functionsById.get("view:readerSourceMetadata")?.body).toBeUndefined();
    expect(query?.returns?.$variant?.cases.map(row => [row.name, row.fields[0].type]))
      .toEqual([["Err", { $ref: "String" }], ["Ok", { $ref: "DependencyGraph" }]]);
    let reads = 0;
    const observe = frame => { reads++; return readerSourceMetadataNative(frame); };
    graph(evaluate(retainedQuery, {}, { ...context, _readerSourceMetadata: packet(), nativesCtx: { ...context.nativesCtx,
      readerSourceMetadata: observe, "view:readerSourceMetadata": observe } }));
    expect(reads).toBe(1);
    expect(retainedBytes).not.toContain("SourceExpressionMetadata");
    expect(retainedBytes).not.toContain("ReaderSourceMetadata");
  });

  test("real source builds outgoing reference/call edges and admitted incoming edges", () => {
    const value = graph(fromMetadata(packet()));
    expect(value.focus).toBe("selected-ref");
    expect(nodes(value)).toEqual([["selected-ref", "Selected data"], ["saved-input", "Input data"],
      ["std:reverse", "Reverse"], ["incoming-occurrence", "Visible consumer"]]);
    expect(edges(value)).toEqual([["saved-input", "selected-ref"], ["std:reverse", "selected-ref"], ["selected-ref", "incoming-occurrence"]]);
    expect(typeof value.scope).toBe("string");
    expect(value.scope.length).toBeGreaterThan(0);
  });

  test("the same retained query sees changed metadata without rewriting its producer", () => {
    const first = graph(run(packet()));
    const next = packet({ generation: "reader-a:2" });
    next.expressions[0] = expression("selected-expression", "Selected source", [callSlot("std:other")]);
    const second = graph(run(next));
    expect(edges(first)).toContainEqual(["std:reverse", "selected-ref"]);
    expect(edges(second)).toContainEqual(["std:other", "selected-ref"]);
    expect(edges(second)).not.toContainEqual(["std:reverse", "selected-ref"]);
    expect(JSON.stringify(retainedQuery)).toBe(retainedBytes);
  });

  test("a fresh packet changes incoming references, labels and generation together", () => {
    const first = graph(run(packet()));
    const next = packet({ generation: "reader-a:2",
      expressions: [expression("selected-expression", "Selected source", [reference("new-input")]),
        expression("new-input", "Renamed input"), expression("new-consumer", "New consumer", [reference("selected-ref")])],
      occurrences: [occurrence("selected-occurrence", "Renamed selected data", "selected-expression", just("selected-ref")),
        occurrence("new-consumer-occurrence", "New visible consumer", "new-consumer")],
    });
    const second = graph(run(next));
    expect(nodes(first)).toContainEqual(["incoming-occurrence", "Visible consumer"]);
    expect(nodes(second)).toContainEqual(["selected-ref", "Renamed selected data"]);
    expect(nodes(second)).toContainEqual(["new-input", "Renamed input"]);
    expect(edges(second)).toContainEqual(["selected-ref", "new-consumer-occurrence"]);
    expect(nodes(second)).not.toContainEqual(["incoming-occurrence", "Visible consumer"]);
  });

  test("another source, root or selected occurrence refuses rather than returning an old graph", () => {
    graph(run(packet()));
    for (const changes of [{ source: { $tag: "PublicSource" } }, { rootId: "another-root" }, { occurrences: [] }]) refused(run(packet(changes)));
    for (const changes of [{ source: { $tag: "PublicSource" } }, { rootId: "another-root" }, { occurrenceId: "missing-occurrence" }]) {
      refused(fromMetadata(packet(), { ...locator, ...changes }));
    }
    refused(evaluate(retainedQuery, {}, context));
    expect(JSON.stringify(retainedQuery)).toBe(retainedBytes);
  });

  test("account sources compare their actual account coordinate", () => {
    const accountSource = { $tag: "AccountSource", accountId: "reader-a" };
    const selected = { ...locator, source: accountSource };
    graph(fromMetadata(packet({ source: { ...accountSource } }), selected));
    refused(fromMetadata(packet({ source: { ...accountSource, accountId: "reader-b" } }), selected));
  });

  test("repeated executable slots, shared source identities and cycles produce finite deduplicated graph data", () => {
    const metadata = packet();
    metadata.expressions[0].slots = [reference("selected-ref"), reference("saved-input"), reference("saved-input"),
      callSlot("std:reverse"), callSlot("std:reverse"), { $tag: "SourceLiteral" }, { $tag: "SourceParameter" }];
    const value = graph(fromMetadata(metadata));
    expect(value.nodes.filter(value => value.id === "saved-input")).toHaveLength(1);
    expect(value.nodes.filter(value => value.id === "std:reverse")).toHaveLength(1);
    expect(value.nodes.filter(value => value.id === "selected-ref")).toHaveLength(1);
    expect(edges(value).filter(edge => edge[0] === "saved-input" && edge[1] === "selected-ref")).toHaveLength(1);
    expect(edges(value)).toContainEqual(["selected-ref", "selected-ref"]);
  });

  test("an unreadable selected executable source refuses instead of claiming no dependencies", () => {
    const metadata = packet();
    metadata.expressions[0].slots = [{ $tag: "SourceUnknown", issue: "The selected source shape is unreadable." }];
    refused(fromMetadata(metadata));
    refused(fromMetadata(packet({ expressions: [] })));
  });

  test("named-field constructor heads keep the graph and its references instead of refusing", () => {
    const constructorSlot = identity => ({ $tag: "SourceConstructor", identity });
    const metadata = packet();
    // Selected data is a linked record; another visible record links it too.
    metadata.expressions[0].slots = [reference("saved-input"), constructorSlot("ExactRecordConstructor")];
    metadata.expressions[2].slots = [reference("selected-ref"), constructorSlot("UnlabelledConstructor")];
    metadata.callableLabels = [...metadata.callableLabels, node("ExactRecordConstructor", "Record constructor")];
    const value = graph(fromMetadata(metadata));
    expect(nodes(value)).toEqual([["selected-ref", "Selected data"], ["saved-input", "Input data"],
      ["ExactRecordConstructor", "Record constructor"], ["incoming-occurrence", "Visible consumer"]]);
    expect(edges(value)).toEqual([["saved-input", "selected-ref"], ["ExactRecordConstructor", "selected-ref"],
      ["selected-ref", "incoming-occurrence"]]);
    // A constructor without an exact visible identity draws no invented node.
    expect(value.nodes.map(row => row.id)).not.toContain("UnlabelledConstructor");
    const unreadable = packet();
    unreadable.expressions[0].slots = [constructorSlot("")];
    refused(fromMetadata(unreadable));
  });

  test("an application slot keeps the graph; its head and input references stay ordinary slots", () => {
    const application = { $tag: "SourceApplication" };
    const metadata = packet();
    // "Apply this function" on saved data: the bound function and the input
    // are their own reference slots; the application itself draws nothing.
    metadata.expressions[0].slots = [reference("saved-input"), { $tag: "SourceParameter" }, application];
    // An unrelated visible card built by an application does not refuse either.
    metadata.expressions[2].slots = [reference("selected-ref"), application, { $tag: "SourceParameter" }];
    const value = graph(fromMetadata(metadata));
    expect(nodes(value)).toEqual([["selected-ref", "Selected data"], ["saved-input", "Input data"], ["incoming-occurrence", "Visible consumer"]]);
    expect(edges(value)).toEqual([["saved-input", "selected-ref"], ["selected-ref", "incoming-occurrence"]]);
    // A function bound by a local name and applied keeps its node: its visible
    // label, else its identity (never a vanished dependency).
    const bound = packet();
    bound.expressions[0].slots = [{ $tag: "SourceCodeReference", identity: "std:reverse" }, reference("saved-input"),
      { $tag: "SourceCodeReference", identity: "unlabelled-code" }, { $tag: "SourceParameter" }, application];
    const boundGraph = graph(fromMetadata(bound));
    expect(nodes(boundGraph)).toEqual([["selected-ref", "Selected data"], ["std:reverse", "Reverse"], ["saved-input", "Input data"],
      ["unlabelled-code", "unlabelled-code"], ["incoming-occurrence", "Visible consumer"]]);
    expect(edges(boundGraph)).toEqual([["std:reverse", "selected-ref"], ["saved-input", "selected-ref"], ["unlabelled-code", "selected-ref"],
      ["selected-ref", "incoming-occurrence"]]);
    const unnamedCode = packet();
    unnamedCode.expressions[0].slots = [{ $tag: "SourceCodeReference", identity: "" }];
    refused(fromMetadata(unnamedCode));
    // A codec failure next to an application still refuses the whole graph.
    const unreadable = packet();
    unreadable.expressions[2].slots = [reference("selected-ref"), application, { $tag: "SourceUnknown", issue: "Invalid authoring expression kind" }];
    refused(fromMetadata(unreadable));
  });

  test("an unreadable or missing incoming source refuses when the selected data has a reference", () => {
    const unknown = packet();
    unknown.expressions[2].slots = [{ $tag: "SourceUnknown", issue: "A visible source shape is unreadable." }];
    refused(fromMetadata(unknown));
    refused(fromMetadata(packet({ expressions: packet().expressions.slice(0, 2) })));
    const unnamed = packet({ expressions: packet().expressions.slice(0, 2) });
    unnamed.occurrences[0].referenceId = Nothing;
    const value = graph(fromMetadata(unnamed));
    expect(value.focus).toBe("selected-occurrence");
    expect(value.nodes.map(value => value.id)).not.toContain("incoming-occurrence");
  });

  test("duplicate source or occurrence identities refuse ambiguous selection", () => {
    const duplicateExpression = packet();
    duplicateExpression.expressions.push({ ...duplicateExpression.expressions[0] });
    refused(fromMetadata(duplicateExpression));
    const duplicateOccurrence = packet();
    duplicateOccurrence.occurrences.push({ ...duplicateOccurrence.occurrences[0] });
    refused(fromMetadata(duplicateOccurrence));
  });

  test("the metadata query does not acquire or evaluate referenced definitions", () => {
    const calls = [];
    const metadata = packet();
    const frame = { ...context, _readerSourceMetadata: metadata,
      getFunction(name) {
        calls.push(name);
        if (["saved-input", "selected-ref", "std:reverse"].includes(name)) throw new Error("Inspected data was evaluated");
        return context.getFunction(name);
      },
    };
    graph(evaluate(retainedQuery, {}, frame));
    expect(calls).not.toContain("saved-input");
    expect(calls).not.toContain("selected-ref");
    expect(calls).not.toContain("std:reverse");
  });

  test("unavailable referenced definitions retain honest labels without a cross-source lookup", () => {
    const metadata = packet();
    metadata.expressions[0].slots = [reference("not-admitted-here"), callSlot("unlisted-operation")];
    const value = graph(fromMetadata(metadata));
    expect(nodes(value)).toContainEqual(["not-admitted-here", "Saved data"]);
    expect(nodes(value)).toContainEqual(["unlisted-operation", "unlisted-operation"]);
    for (const invalid of [reference(""), callSlot("")]) {
      metadata.expressions[0].slots = [invalid];
      refused(fromMetadata(metadata));
    }
  });

  test("malformed matching packets refuse instead of reporting a false empty dependency set", () => {
    const badPackets = [undefined, null, 0, {}, { ...packet(), $tag: "OtherPacket" }];
    for (const key of ["expressions", "occurrences", "callableLabels"]) {
      for (const wrong of [undefined, null, {}, "not-a-list", 0]) badPackets.push({ ...packet(), [key]: wrong });
    }
    for (const wrong of [undefined, null, {}, "not-a-list", 0]) {
      const metadata = packet(); metadata.expressions[0].slots = wrong; badPackets.push(metadata);
    }
    for (const key of ["rootId", "generation"]) {
      for (const wrong of [undefined, null, "", 0, {}]) badPackets.push({ ...packet(), [key]: wrong });
    }
    for (const slot of [{ $tag: "SourceReference", identity: 42 }, { $tag: "SourceCall", identity: {} },
      { $tag: "SourceReference" }, { $tag: "SourceCall" }, { $tag: "SourceUnknown", issue: 42 },
      { $tag: "UnrecognizedSourceSlot" }, null, {}, 42]) {
      const metadata = packet(); metadata.expressions[0].slots = [slot]; badPackets.push(metadata);
    }
    for (const row of [{ id: "selected-expression", slots: [] }, { id: "selected-expression", label: 42, slots: [] },
      { id: "", label: "Data", slots: [] }, { id: 42, label: "Data", slots: [] }]) {
      const metadata = packet(); metadata.expressions[0] = row; badPackets.push(metadata);
    }
    for (const wrong of [undefined, null, {}, { $tag: "UnexpectedMaybe" }, { $tag: "Just", _0: 42 }, { $tag: "Just", _0: "" }]) {
      const metadata = packet(); metadata.occurrences[0].referenceId = wrong; badPackets.push(metadata);
    }
    for (const key of ["id", "label", "expressionId"]) {
      for (const wrong of [undefined, null, 42, {}]) {
        const metadata = packet(); metadata.occurrences[0][key] = wrong; badPackets.push(metadata);
      }
    }
    for (const [index, metadata] of badPackets.entries()) {
      const result = fromMetadata(metadata);
      if (result?.$tag !== "Err") throw new Error(`Malformed packet ${index} produced ${JSON.stringify(result)} from ${JSON.stringify(metadata)}`);
      refused(result);
    }
    for (const wrongSource of [undefined, null, {}, { $tag: "OtherSource" },
      { $tag: "AccountSource" }, { $tag: "AccountSource", accountId: "" }, { $tag: "AccountSource", accountId: 42 }]) {
      refused(fromMetadata({ ...packet(), source: wrongSource }, { ...locator, source: wrongSource }));
    }
    for (const key of ["rootId", "occurrenceId"]) {
      for (const wrong of [undefined, null, "", 0, {}]) refused(fromMetadata(packet(), { ...locator, [key]: wrong }));
    }
  });
});

describe("linked dependency query a few links both ways", () => {
  // Saved data linked as in the people, projects and plants starter: Fenel uses
  // Rom and common fennel; fennel uses its genus, the genus its family; Fen uses
  // Fenel and fennel. Every saved datum is also shown once in the tab.
  const captions = { fenel: "Fenel", rom: "Rom", fennel: "Common fennel", foeniculum: "Foeniculum", apiaceae: "Apiaceae", fen: "Fen" };
  const shown = name => occurrence(`${name}-occurrence`, captions[name], name, just(name));
  function chain(changes = {}) {
    return { $tag: "ReaderSourceMetadata", source, rootId: "root-a", generation: "reader-a:1",
      expressions: [
        expression("fenel", "Fenel", [reference("rom"), reference("fennel"), { $tag: "SourceConstructor", identity: "Project" }]),
        expression("rom", "Rom"),
        expression("fennel", "Common fennel", [reference("foeniculum"), callSlot("plate")]),
        expression("foeniculum", "Foeniculum", [reference("apiaceae")]),
        expression("apiaceae", "Apiaceae", [reference("hidden")]),
        expression("hidden", "Unshown data"),
        expression("fen", "Fen", [reference("fenel"), reference("fennel")]),
      ],
      occurrences: ["fenel", "rom", "fennel", "foeniculum", "apiaceae", "fen"].map(shown),
      callableLabels: [node("plate", "Fennel plate"), node("Project", "Software project")], ...changes };
  }
  const linked = (hops, metadata = chain(), selected = { ...locator, occurrenceId: "fenel-occurrence" }) =>
    call("dependencyQueryLinkedFromMetadata", [selected, hops, metadata]);
  const ids = value => value.nodes.map(row => row.id).sort();

  const retained = (parent, referenceId, metadata = chain()) => call("dependencyQueryLinkedAtReference",
    [{ ...locator, occurrenceId: `${parent}-occurrence` }, referenceId, 0], { ...context, _readerSourceMetadata: metadata });

  test("retained-reference selection proves direct and nested parent references, not unrelated admitted bindings", () => {
    expect(graph(retained("fenel", "rom")).focus).toBe("rom");
    expect(graph(retained("fenel", "foeniculum")).focus).toBe("foeniculum");
    refused(retained("rom", "fenel"));
    // Fen uses Fenel; that incoming edge is not Fenel retaining Fen.
    refused(retained("fenel", "fen"));
    const called = chain();
    called.expressions.push(expression("plate", "Fennel plate"));
    called.occurrences.push(occurrence("plate-occurrence", "Fennel plate", "plate", just("plate")));
    refused(retained("fennel", "plate", called));
    const cyclic = chain();
    cyclic.expressions[1] = expression("rom", "Rom", [reference("fenel")]);
    refused(retained("fenel", "fen", cyclic));
  });

  test("retained-reference relation checks preserve unavailable, ambiguous and foreign-source refusals", () => {
    const missing = chain();
    missing.expressions = missing.expressions.filter(row => row.id !== "fennel");
    refused(retained("fenel", "foeniculum", missing));
    const unknown = chain();
    unknown.expressions[0].slots.push({ $tag: "SourceUnknown", issue: "Unreadable source." });
    refused(retained("fenel", "rom", unknown));
    const ambiguous = chain();
    ambiguous.expressions.push(expression("fenel", "Another source", [reference("rom")]));
    refused(retained("fenel", "rom", ambiguous));
    refused(retained("missing-parent", "rom"));
    refused(call("dependencyQueryLinkedAtReference", [{ ...locator, source: { $tag: "AccountSource", accountId: "foreign" },
      occurrenceId: "fenel-occurrence" }, "rom", 0], { ...context, _readerSourceMetadata: chain() }));
  });

  test("two links reach the genus and the mascot, with saved identities joined", () => {
    const one = graph(linked(1));
    expect(one.focus).toBe("fenel");
    expect(ids(one)).toEqual(["Project", "fen", "fenel", "fennel", "rom"]);
    expect(edges(one).sort()).toEqual([["Project", "fenel"], ["fenel", "fen"], ["fennel", "fenel"], ["rom", "fenel"]].sort());
    const two = graph(linked(2));
    expect(ids(two)).toEqual(["Project", "fen", "fenel", "fennel", "foeniculum", "plate", "rom"]);
    // Fen uses fennel as well as Fenel, but Fen is a user of the focus: it goes
    // on only towards its own users, so its link to fennel (a part) is not drawn.
    expect(edges(two)).not.toContainEqual(["fennel", "fen"]);
    expect(edges(two)).toContainEqual(["foeniculum", "fennel"]);
    expect(nodes(two)).toContainEqual(["fennel", "Common fennel"]);
    expect(nodes(two)).toContainEqual(["plate", "Fennel plate"]);
    expect(two.nodes.filter(row => row.id === "fennel")).toHaveLength(1);
    const three = graph(linked(3));
    expect(ids(three)).toContain("apiaceae");
    expect(ids(three)).not.toContain("hidden");
    expect(ids(graph(linked(4)))).toContain("hidden");
  });

  test("no links show only the selected data; cycles stay finite", () => {
    const zero = graph(linked(0));
    expect(nodes(zero)).toEqual([["fenel", "Fenel"]]);
    expect(zero.edges).toEqual([]);
    const cyclic = chain();
    cyclic.expressions[1] = expression("rom", "Rom", [reference("fenel")]);
    const value = graph(linked(6, cyclic));
    expect(value.nodes.filter(row => row.id === "fenel")).toHaveLength(1);
    expect(edges(value)).toContainEqual(["rom", "fenel"]);
    expect(edges(value)).toContainEqual(["fenel", "rom"]);
  });

  test("an unreadable expression on the way refuses instead of cutting the graph short", () => {
    const unreadable = chain();
    unreadable.expressions[5] = expression("hidden", "Unshown data", [{ $tag: "SourceUnknown", issue: "Unreadable." }]);
    // The unshown datum becomes a node at four links; its own links are read at five.
    expect(ids(graph(linked(4, unreadable)))).toContain("hidden");
    refused(linked(5, unreadable));
    const dangling = chain({ expressions: chain().expressions.filter(row => row.id !== "hidden") });
    graph(linked(4, dangling));
    refused(linked(5, dangling));
  });

  test("application slots on the way keep the linked graph; an unknown slot beside them still refuses", () => {
    const application = { $tag: "SourceApplication" };
    const applied = chain();
    applied.expressions[2] = expression("fennel", "Common fennel", [reference("foeniculum"), application, callSlot("plate")]);
    applied.expressions[6] = expression("fen", "Fen", [application, reference("fenel"), reference("fennel")]);
    expect(edges(graph(linked(2, applied))).sort()).toEqual(edges(graph(linked(2))).sort());
    expect(ids(graph(linked(2, applied)))).toEqual(ids(graph(linked(2))));
    const unknown = chain();
    unknown.expressions[6] = expression("fen", "Fen", [application, reference("fenel"), { $tag: "SourceUnknown", issue: "Unreadable." }]);
    refused(linked(1, unknown));
  });

  test("edges name the field that holds each reference, joining two fields into one edge", () => {
    const field = (identity, name) => ({ $tag: "SourceFieldReference", identity, field: name });
    const labelled = chain();
    labelled.expressions[0] = expression("fenel", "Fenel", [field("rom", "founders"), field("rom", "maintainers"),
      field("fennel", "namedAfter"), field("giant", "emblems")]);
    labelled.expressions.push(expression("giant", "Giant fennel"));
    labelled.expressions[6] = expression("fen", "Fen", [field("fenel", "mascotOf"), field("fennel", "inspiredBy")]);
    const value = graph(linked(1, labelled));
    const labels = Object.fromEntries(value.edges.map(edge => [`${edge.from}>${edge.to}`, edge.labels]));
    expect(labels).toEqual({ "rom>fenel": ["Founders", "Maintainers"], "fennel>fenel": ["Named After"],
      "giant>fenel": ["Emblems"], "fenel>fen": ["Mascot Of"] });
    expect(value.edges.filter(edge => edge.from === "rom" && edge.to === "fenel")).toHaveLength(1);
    // Following on, plain references stay unlabelled. Fen is a user of the focus,
    // so its own inspiredBy link to fennel (a part of the focus) is not followed.
    const two = graph(linked(2, labelled));
    expect(two.edges.some(edge => edge.from === "fennel" && edge.to === "fen")).toBe(false);
    expect(two.edges.find(edge => edge.from === "foeniculum" && edge.to === "fennel").labels).toEqual([]);
    refused(linked(1, { ...labelled, expressions: [...labelled.expressions.slice(1), expression("fenel", "Fenel", [field("rom", "")])] }));
  });

  // Demo holds Fenel and 200 other things; a plate card uses common fennel
  // (a part of Fenel); a showcase uses Demo. Only parts of parts and users of
  // users are dependencies of Fenel.
  function crowded() {
    const metadata = chain();
    const unrelated = Array.from({ length: 200 }, (_, index) => `unrelated-${index}`);
    metadata.expressions.push(expression("demo", "Demo", [reference("fenel"), ...unrelated.map(reference)]),
      ...unrelated.map(id => expression(id, `Unrelated ${id}`, [reference("unrelated-part")])),
      expression("unrelated-part", "Part of an unrelated datum"),
      expression("plate-card", "Fennel plate card", [reference("fennel")]),
      expression("showcase", "Showcase", [reference("demo")]));
    metadata.occurrences.push(occurrence("demo", "Demo", "demo"),
      ...unrelated.map(id => occurrence(`${id}-occurrence`, `Unrelated ${id}`, id, just(id))),
      occurrence("plate-card-occurrence", "Fennel plate card", "plate-card", just("plate-card")),
      occurrence("showcase-occurrence", "Showcase", "showcase", just("showcase")));
    return metadata;
  }

  test("a user of the focus goes on only to its own users, a part only to its own parts", () => {
    for (const hops of [2, 3, 4]) {
      const value = graph(linked(hops, crowded()));
      const reached = ids(value);
      // Demo uses Fenel; Showcase uses Demo: users of users are kept.
      expect(reached).toContain("demo");
      expect(reached).toContain("showcase");
      // Parts of parts are kept.
      expect(reached).toContain("foeniculum");
      // Demo's other parts are neither parts nor users of Fenel.
      expect(reached.filter(id => id.startsWith("unrelated"))).toEqual([]);
      // A user of a part (the plate card uses common fennel) is not a dependency of Fenel either.
      expect(reached).not.toContain("plate-card");
      // Every edge runs along one direction from the focus: no edge leaves the drawn graph.
      for (const [from, to] of edges(value)) { expect(reached).toContain(from); expect(reached).toContain(to); }
      expect(value.edges.some(edge => edge.to === "demo" && edge.from !== "fenel")).toBe(false);
    }
  });

  test("a datum reached both as a part and as a user goes on both ways", () => {
    // Rom is a part of Fenel and also uses Fenel: Rom's own part (a city) and
    // Rom's own user (a team) are both reached.
    const cyclic = chain();
    cyclic.expressions[1] = expression("rom", "Rom", [reference("fenel"), reference("city")]);
    cyclic.expressions.push(expression("city", "City"), expression("team", "Team", [reference("rom")]));
    cyclic.occurrences.push(occurrence("city-occurrence", "City", "city", just("city")),
      occurrence("team-occurrence", "Team", "team", just("team")));
    const value = graph(linked(2, cyclic));
    expect(ids(value)).toContain("city");
    expect(ids(value)).toContain("team");
    expect(value.nodes.filter(row => row.id === "rom")).toHaveLength(1);
    expect(edges(value)).toContainEqual(["city", "rom"]);
    expect(edges(value)).toContainEqual(["rom", "team"]);
  });

  test("the directed walk is deterministic and keeps the order of first reach", () => {
    const first = graph(linked(2)), again = graph(linked(2));
    expect(again).toEqual(first);
    expect(first.nodes.map(row => row.id)).toEqual(["fenel", "rom", "fennel", "Project", "fen", "foeniculum", "plate"]);
    expect(edges(first)).toEqual([["rom", "fenel"], ["fennel", "fenel"], ["Project", "fenel"], ["fenel", "fen"],
      ["foeniculum", "fennel"], ["plate", "fennel"]]);
    const crowdedFirst = graph(linked(3, crowded())), crowdedAgain = graph(linked(3, crowded()));
    expect(crowdedAgain).toEqual(crowdedFirst);
    expect(crowdedFirst.nodes.map(row => row.id)).toEqual(["fenel", "rom", "fennel", "Project", "fen", "demo", "foeniculum", "plate", "showcase", "apiaceae"]);
  });

  test("the linked query reads only its frame's packet and refuses another source", () => {
    const queryLinked = { call: ["view:dependencyQueryLinked", { var: "locator" }, { var: "hops" }] };
    const frame = metadata => ({ ...context, _readerSourceMetadata: metadata });
    const selected = { ...locator, occurrenceId: "fenel-occurrence" };
    expect(ids(graph(evaluate(queryLinked, { locator: selected, hops: 2 }, frame(chain())))))
      .toEqual(["Project", "fen", "fenel", "fennel", "foeniculum", "plate", "rom"]);
    refused(evaluate(queryLinked, { locator: selected, hops: 2 }, context));
    refused(evaluate(queryLinked, { locator: { ...selected, rootId: "another-root" }, hops: 2 }, frame(chain())));
  });
});

describe("actual reader metadata reflection leaf", () => {
  test("the frame getter returns only its own captured packet and canonical absence", () => {
    const metadata = packet();
    expect(readerSourceMetadataNative({ _readerSourceMetadata: metadata })).toEqual(just(metadata));
    expect(readerSourceMetadataNative({ _readerSourceMetadata: metadata })._0).toBe(metadata);
    expect(readerSourceMetadataNative({})).toEqual(Nothing);
    expect(readerSourceMetadataNative({ _readerSourceMetadata: undefined })).toEqual(Nothing);
    expect(readerSourceMetadataNative(Object.create({ _readerSourceMetadata: metadata }))).toEqual(Nothing);
    expect(readerSourceMetadataNative({ _readerSourceMetadata: {} })).toEqual(Nothing);
    expect(readerSourceMetadataNative({ _readerSourceMetadata: { $tag: "AnotherPacket" } })).toEqual(Nothing);
    expect(readerSourceMetadataNative({ _readerSourceMetadata: Object.create({ $tag: "ReaderSourceMetadata" }) })).toEqual(Nothing);
  });

  test("inherited, accessor and unreadable context properties never run host code", () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "_readerSourceMetadata", { enumerable: true,
      get() { getterCalls++; throw new Error("A metadata accessor was invoked"); } });
    expect(readerSourceMetadataNative(accessor)).toEqual(Nothing);
    expect(readerSourceMetadataNative(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("Unreadable frame"); } }))).toEqual(Nothing);
    expect(getterCalls).toBe(0);
  });

  test("a captured frame remains coherent when the source owner publishes a newer packet", () => {
    const initial = packet();
    const frame = { ...context, _readerSourceMetadata: initial };
    let latest = initial;
    graph(evaluate(retainedQuery, {}, frame));
    latest = packet({ generation: "reader-a:2", occurrences: [] });
    expect(readerSourceMetadataNative(frame)._0).toBe(initial);
    graph(evaluate(retainedQuery, {}, frame));
    refused(evaluate(retainedQuery, {}, { ...context, _readerSourceMetadata: latest }));
  });
});

describe("ordinary product evaluator admits one current packet per run", () => {
  test("the unchanged authored query sees fresh source metadata through the actual product entry", () => {
    const fixture = ordinaryFixture();
    const base = fixture.session.evaluateContext;
    const first = graph(fixture.evaluate().result);
    const next = packet({ generation: "reader-a:2" });
    next.expressions[0] = expression("selected-expression", "Selected source", [callSlot("new-operation")]);
    fixture.replace(next);
    const second = graph(fixture.evaluate().result);
    expect(edges(first)).toContainEqual(["std:reverse", "selected-ref"]);
    expect(edges(second)).toContainEqual(["new-operation", "selected-ref"]);
    expect(edges(second)).not.toContainEqual(["std:reverse", "selected-ref"]);
    expect(fixture.reads()).toBe(2);
    expect(fixture.session.evaluateContext).toBe(base);
    expect(Object.hasOwn(base, "_readerSourceMetadata")).toBe(false);
    expect(JSON.stringify(retainedQuery)).toBe(retainedBytes);
  });

  test("source close clears inherited base metadata instead of returning its cached graph", () => {
    const fixture = ordinaryFixture();
    const stale = packet();
    fixture.session.evaluateContext._readerSourceMetadata = stale;
    graph(fixture.evaluate().result);
    fixture.close();
    refused(fixture.evaluate().result);
    expect(fixture.session.evaluateContext._readerSourceMetadata).toBe(stale);
  });

  test("retirement during a run refuses publication after the actual Fenel query finishes", () => {
    const fixture = ordinaryFixture();
    const read = frame => { const value = readerSourceMetadataNative(frame); fixture.close(); return value; };
    fixture.session.evaluateContext.nativesCtx = { ...context.nativesCtx,
      readerSourceMetadata: read, "view:readerSourceMetadata": read };
    expect(() => fixture.evaluate()).toThrow("current reader");
  });

  test("captured and traced evaluator frames retain the same admitted metadata packet", () => {
    const fixture = ordinaryFixture();
    graph(fixture.evaluate({ capture: true }).result);
    graph(fixture.evaluate({ trace: true }).result);
    expect(fixture.reads()).toBe(2);
    expect(Object.hasOwn(fixture.session.evaluateContext, "_readerSourceMetadata")).toBe(false);
  });
});

describe("ordinary worker entry retains one packet per submitted query", () => {
  const workerSource = readFileSync(new URL("../../../../distros/narthex/solid/src/lib/expression-runner/authoring-catalog-worker.ts", import.meta.url), "utf8");
  const workerFrom = workerSource.indexOf("export function evaluateExpressionInWorker(");
  const workerTo = workerSource.indexOf("export function discoverDataSuggestionsInWorker(", workerFrom);
  if (workerFrom < 0 || workerTo < 0) throw new Error("Worker evaluation source boundary moved");
  const workerSection = (from, to) => {
    const start = workerSource.indexOf(from), end = workerSource.indexOf(to, start);
    if (start < 0 || end < 0) throw new Error(`Worker helper boundary moved: ${from}`);
    return workerSource.slice(start, end);
  };
  const workerHelpers = [
    workerSection('const MISSING_SNAPSHOT_OWNER =', '/** The session\'s routing owner'),
    workerSection('function ownerOf(', '\n/**'),
    workerSection('function currentWorker(', '\n/**'),
    workerSection('function requestSavedSources(', '\n/**'),
    workerSection('function ownProjectionRecord(', '\nfunction denseProjectionArray('),
  ].join('\n');
  function workerFixture() {
    const calls = [];
    const bySession = new WeakMap();
    const ports = { ...metadataPorts, authoringExpressionSourceEntries: ordinaryEvaluation.authoringExpressionSourceEntries,
      reachedSavedSources: ordinaryEvaluation.reachedSavedSources, savedExpressionDeclaration, savedExpressionDeclarationEntries,
      concreteAuthoringSession, assertCurrentSession, bySession, sessionOwners: new WeakMap(), ownedRegistries: new WeakSet(),
      byOwner: new WeakMap(), retiredByOwner: new WeakMap(),
      runAuthoringWorker: (session, request) => {
      let resolve;
      const promise = new Promise(yes => { resolve = yes; });
      calls.push({ session, request, resolve });
      return promise;
    } };
    const submit = new Function(...Object.keys(ports),
      new Bun.Transpiler({ loader: "ts" }).transformSync(workerHelpers + '\n' + workerSource.slice(workerFrom, workerTo)).replace(/^export /gm, "")
        + "; return evaluateExpressionInWorker;")(...Object.values(ports));
    return { submit: (session, ...args) => {
      // The controlled physical transport is attached to this exact session;
      // production currentWorker/requestSavedSources still select its path.
      if (!bySession.has(session)) bySession.set(session, { closed: false, epoch: sessionEpoch(), localSourceId: undefined });
      return submit(session, ...args);
    }, calls };
  }

  test("packet replacements remain separate per job and leave the base session untouched", async () => {
    const fixture = ordinaryFixture(), worker = workerFixture(), saved = new Map();
    const base = fixture.session.evaluateContext;
    const first = worker.submit(fixture.session, queryNode, saved);
    const rejected = first.then(() => undefined, error => error);
    const next = packet({ generation: "reader-a:2" });
    const secondCapture = fixture.replace(next);
    const second = worker.submit(fixture.session, queryNode, saved, undefined, undefined, { capture: true });
    expect(worker.calls[0].request.sourceMetadata.generation).toBe("reader-a:1");
    expect(worker.calls[1].request.sourceMetadata).toBe(secondCapture.packet);
    expect(worker.calls[1].request.capture).toBe(true);
    expect(worker.calls[0].request.node).toBe(queryNode);
    expect(worker.calls[1].request.node).toBe(queryNode);
    expect(Object.hasOwn(base, "_readerSourceMetadata")).toBe(false);
    worker.calls[0].resolve({ result: "old result", trace: [] });
    const failure = await rejected;
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("current reader");
    worker.calls[1].resolve({ result: "current result", trace: [] });
    expect((await second).result).toBe("current result");
    expect(fixture.session.evaluateContext).toBe(base);
  });

  test("an explicitly captured packet is used once and source absence submits no stale packet", async () => {
    const fixture = ordinaryFixture(), worker = workerFixture();
    const captured = fixture.replace(packet());
    const explicit = worker.submit(fixture.session, queryNode, new Map(), undefined, undefined, { sourceMetadata: captured });
    expect(fixture.reads()).toBe(0);
    worker.calls[0].resolve({ result: "current", trace: [] }); await explicit;
    fixture.session.evaluateContext._readerSourceMetadata = captured.packet;
    fixture.close();
    const absent = worker.submit(fixture.session, queryNode, new Map());
    expect(Object.hasOwn(worker.calls[1].request, "sourceMetadata")).toBe(false);
    worker.calls[1].resolve({ result: "no source", trace: [] }); await absent;
    expect(fixture.session.evaluateContext._readerSourceMetadata).toBe(captured.packet);
    expect(() => worker.submit(fixture.session, queryNode, new Map(), undefined, undefined, { sourceMetadata: captured }))
      .toThrow("current reader");
  });

  test("canonical saved-source transport preserves root, transitive, missing and cyclic lowering and source sites", () => {
    const fixture = ordinaryFixture();
    const terminal = { kind: "literal", value: "terminal" };
    const direct = { kind: "call", fnId: "actual-call", args: [{ kind: "ref", savedExprId: "terminal" }] };
    const cycleA = { kind: "ref", savedExprId: "cycle-b" }, cycleB = { kind: "ref", savedExprId: "cycle-a" };
    const dormant = { kind: "literal", value: { $tag: "Image", bytes: new Uint8Array(4 * 1024 * 1024) } };
    const saved = new Map([["direct", direct], ["terminal", terminal], ["cycle-a", cycleA], ["cycle-b", cycleB], ["unrelated-image", dormant]]);
    const cases = [
      [{ kind: "ref", savedExprId: "direct" }, ["direct", "terminal"]],
      [{ kind: "literal", value: { __list: [{ kind: "ref", savedExprId: "direct" }] } }, ["direct", "terminal"]],
      [{ kind: "ref", savedExprId: "missing" }, []],
      [{ kind: "ref", savedExprId: "cycle-a" }, ["cycle-a", "cycle-b"]],
      [{ kind: "literal", value: { __var: { path: "name", fallback: { kind: "ref", savedExprId: "unrelated-image" }, arrayForm: true } } }, []],
    ];
    const warn = console.warn;
    const warnings = [];
    console.warn = (...values) => warnings.push(values);
    try {
      for (const [root, identities] of cases) {
        const entries = ordinaryEvaluation.authoringExpressionSourceEntries(root, saved, fixture.session);
        expect(entries.map(([identity]) => identity).sort()).toEqual([...identities].sort());
        for (const [identity, body] of entries) expect(body).toBe(saved.get(identity));
        const retained = new Map(entries);
        const original = ordinaryEvaluation.authoringExpressionSites(root, identity => saved.get(identity), fixture.session);
        const projected = ordinaryEvaluation.authoringExpressionSites(root, identity => retained.get(identity), fixture.session);
        expect(projected.logic).toEqual(original.logic);
        expect(projected.sites.map(site => site.logic)).toEqual(original.sites.map(site => site.logic));
        expect(projected.sites.length).toBe(original.sites.length);
        projected.sites.forEach((site, index) => expect(site.node).toBe(original.sites[index].node));
      }
    } finally { console.warn = warn; }
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("the closed dependency-query job omits an unrelated 4 MiB image and never iterates the saved roster", async () => {
    const fixture = ordinaryFixture(), worker = workerFixture();
    let payloadReads = 0;
    const bytes = new Uint8Array(4 * 1024 * 1024);
    const dormant = Object.defineProperty({ kind: "literal" }, "value", { enumerable: true,
      get() { payloadReads++; throw new Error("Unrelated image source was inspected"); } });
    const saved = new Map([["unrelated-image", dormant], ["other-data", { kind: "literal", value: bytes }]]);
    saved[Symbol.iterator] = () => { throw new Error("The complete saved roster was iterated"); };
    const pending = worker.submit(fixture.session, queryNode, saved);
    expect(worker.calls[0].request.savedExpressions).toEqual([]);
    expect(worker.calls[0].request.node).toBe(queryNode);
    expect(JSON.stringify(worker.calls[0].request).length).toBeLessThan(3000);
    expect(payloadReads).toBe(0);
    worker.calls[0].resolve({ result: "transport only", trace: [] });
    await pending;
  });

  test("the worker job keeps only reached original bodies and their transitive dependency", async () => {
    const fixture = ordinaryFixture(), worker = workerFixture();
    const terminal = { kind: "literal", value: "terminal" };
    const direct = { kind: "call", fnId: "actual-call", args: [{ kind: "ref", savedExprId: "terminal" }] };
    const root = { kind: "ref", savedExprId: "direct" };
    const saved = new Map([["unrelated", { kind: "literal", value: new Uint8Array(4 * 1024 * 1024) }],
      ["terminal", terminal], ["direct", direct]]);
    const pending = worker.submit(fixture.session, root, saved);
    const entries = new Map(worker.calls[0].request.savedExpressions);
    expect([...entries.keys()].sort()).toEqual(["direct", "terminal"]);
    expect(entries.get("direct")).toBe(direct);
    expect(entries.get("terminal")).toBe(terminal);
    expect(worker.calls[0].request.node).toBe(root);
    worker.calls[0].resolve({ result: "transport only", trace: [] });
    await pending;
  });
});

describe("Fenel admitted dependency roster preserves original source carriers", () => {
  function rosterFixture() {
    let inspectedPayload = 0;
    const bytes = new Uint8Array(1024 * 1024);
    const nested = new Proxy({ bytes }, {
      ownKeys() { inspectedPayload++; throw new Error("Literal payload was enumerated or cloned"); },
      getOwnPropertyDescriptor() { inspectedPayload++; throw new Error("Literal payload was snapshotted"); },
    });
    const inline = { kind: "literal", value: { $tag: "Image", nested } };
    const saved = { kind: "literal", value: { $tag: "Image", bytes } };
    const obsolete = { kind: "literal", value: "old admitted projection" };
    const nestedExpression = { kind: "call", fnId: "std:reverse", args: [{ kind: "ref", savedExprId: "saved-ref" }] };
    const rootExpression = { kind: "literal", value: { __list: [] } };
    const root = { id: "root", referenceId: "locus:root", name: "Current data", expressions: { "locus:root": rootExpression, "saved-ref": obsolete },
      items: [{ id: "inline", caption: "Inline image", source: { kind: "expr", expr: inline } },
        { id: "linked", caption: "Linked image", source: { kind: "ref", ref: { id: "saved-ref" } } }],
      lists: [{ id: "list", name: "Visible list", referenceId: "locus:root:list", view: {
        items: [{ id: "nested", caption: "Nested call", source: { kind: "expr", expr: nestedExpression } }],
      } }],
    };
    const values = [{ id: "saved-ref", name: "Saved image", query: { kind: "expression", expr: saved } },
      { id: "non-expression", name: "Not a source expression", query: { kind: "other" } }];
    return { root, values, inline, saved, nestedExpression, rootExpression, bytes, inspectedPayload: () => inspectedPayload };
  }

  test("the actual pure roster retains image payload identity and only copies metadata wrappers", () => {
    const fixture = rosterFixture();
    const projected = call("dependencyMetadataRoster", [fixture.root, fixture.values, [{ id: "std:reverse", label: "Reverse" }]]);
    const rows = new Map(projected.expressions.map(row => [row.id, row]));
    expect(rows.get("locus:root")?.expression).toBe(fixture.rootExpression);
    expect(rows.get("locus:root:inline")?.expression).toBe(fixture.inline);
    expect(rows.get("saved-ref")?.expression).toBe(fixture.saved);
    expect(rows.get("saved-ref")?.expression.value.bytes).toBe(fixture.bytes);
    expect(rows.get("locus:root:nested")?.expression).toBe(fixture.nestedExpression);
    expect(rows.has("non-expression")).toBe(false);
    expect(fixture.inspectedPayload()).toBe(0);
    expect(projected.callableLabels).toEqual([node("std:reverse", "Reverse")]);
  });

  test("the visible occurrence roster has ordinary local coordinates and no synthetic root", () => {
    const fixture = rosterFixture();
    const projected = call("dependencyMetadataRoster", [fixture.root, fixture.values, []]);
    expect(projected.occurrences).toEqual([
      occurrence("inline", "Inline image", "locus:root:inline"),
      occurrence("linked", "Linked image", "saved-ref", just("saved-ref")),
      occurrence("nested", "Nested call", "locus:root:nested"),
    ]);
    expect(projected.occurrences.some(row => row.id === fixture.root.id || row.id === fixture.root.referenceId)).toBe(false);
    expect(fixture.inspectedPayload()).toBe(0);
  });

  test("real roster and canonical slots keep the graph of an applied function and an unrelated application card", () => {
    const input = { id: "saved-input", name: "Input data", query: { kind: "expression", expr: { kind: "literal", value: [1, 2, 3] } } };
    const fn = { id: "saved-function", name: "Saved function", query: { kind: "expression", expr: { kind: "literal",
      value: { __lambda: { params: ["x"], body: { kind: "call", fnId: "std:reverse", args: [{ kind: "param", name: "x" }] }, arrayParams: true } } } } };
    // The shape "Apply this function" builds (data-suggestions applicationNode).
    const applied = { id: "saved-selected", name: "Applied", query: { kind: "expression", expr: { kind: "literal", value: { __do: [
      { kind: "literal", value: { __let: { bindings: [{ name: "selectedFunction", expr: { kind: "ref", savedExprId: "saved-function" } }] } } },
      { kind: "literal", value: { __apply: { target: { kind: "param", name: "selectedFunction" }, syntax: "call",
        args: [{ kind: "ref", savedExprId: "saved-input" }] } } },
    ] } } } };
    const pipeline = { kind: "literal", value: { __pipe: { value: { kind: "literal", value: "text" },
      steps: [{ kind: "call", fnId: "std:reverse", args: [] }], binary: true } } };
    const root = (visible) => ({ id: "root-a", referenceId: "locus:root-a", name: "Current data", expressions: {}, lists: [], items: [
      { id: "selected-occurrence", caption: "Applied data", source: { kind: "ref", ref: { id: applied.id } } },
      { id: "unrelated", caption: "Unrelated", source: { kind: "expr", expr: visible } },
    ] });
    const capture = visible => readerSourceMetadataPacket(source, "root-a", "reader-a:1",
      call("dependencyMetadataRoster", [root(visible), [applied, fn, input], [{ id: "std:reverse", label: "Reverse" }]]));
    const metadata = capture(pipeline);
    const selectedSlots = metadata.expressions.find(row => row.id === "saved-selected").slots;
    expect(selectedSlots).toContainEqual({ $tag: "SourceApplication" });
    expect(selectedSlots.some(slot => slot.$tag === "SourceUnknown")).toBe(false);
    const value = graph(run(metadata));
    expect(value.focus).toBe("saved-selected");
    expect(edges(value)).toEqual([["saved-function", "saved-selected"], ["saved-input", "saved-selected"]]);
    expect(nodes(value)).toContainEqual(["saved-function", "Saved function"]);
    // A visible card the codec cannot read still refuses instead of being skipped.
    refused(run(capture({ kind: "literal", value: { __apply: { target: { kind: "unrecognized-expression" }, args: [] } } })));
    refused(run(capture({ kind: "literal", value: { __apply: { target: { kind: "literal", value: { __fenelFn: true, params: [], body: { kind: "call", fnId: "hidden-call", args: [] } } }, args: [] } } })));
    // The checkpoint-3 grouping card: a catalogue function bound by a local name and applied.
    const grouped = { ...applied, query: { kind: "expression", expr: { kind: "literal", value: { __do: [
      { kind: "literal", value: { __let: { bindings: [{ name: "row", expr: { kind: "literal", value: { $ref: "std:countByKey" } } }] } } },
      { kind: "literal", value: { __apply: { target: { kind: "param", name: "row" }, syntax: "call", args: [
        { kind: "literal", value: { __lambda: { params: ["row"], body: { kind: "param", name: "row.person" }, arrayParams: true } } },
        { kind: "ref", savedExprId: "saved-input" }] } } },
    ] } } } };
    const countGraph = graph(run(readerSourceMetadataPacket(source, "root-a", "reader-a:3",
      call("dependencyMetadataRoster", [root(pipeline), [grouped, fn, input], [{ id: "std:countByKey", label: "Count per key" }]]))));
    expect(nodes(countGraph)).toContainEqual(["std:countByKey", "Count per key"]);
    expect(edges(countGraph)).toEqual([["std:countByKey", "saved-selected"], ["saved-input", "saved-selected"]]);
    // A head named by code identity draws that function where it is called.
    const named = { ...applied, query: { kind: "expression", expr: { kind: "literal", value: { __apply: {
      target: { kind: "literal", value: { $ref: "std:reverse" } }, syntax: "call", args: [{ kind: "ref", savedExprId: "saved-input" }] } } } } };
    const direct = graph(run(readerSourceMetadataPacket(source, "root-a", "reader-a:2",
      call("dependencyMetadataRoster", [root(pipeline), [named, fn, input], [{ id: "std:reverse", label: "Reverse" }]]))));
    expect(nodes(direct)).toContainEqual(["std:reverse", "Reverse"]);
    expect(edges(direct)).toEqual([["std:reverse", "saved-selected"], ["saved-input", "saved-selected"]]);
  });

  test("real roster, canonical slots, packet and leaf reevaluate one retained Fenel query after a source edit", () => {
    const bytes = new Uint8Array(1024 * 1024);
    const image = { kind: "literal", value: { $tag: "Image", bytes } };
    const input = { id: "saved-input", name: "Input image", query: { kind: "expression", expr: image } };
    const selected = { id: "saved-selected", name: "Selected source", query: { kind: "expression",
      expr: { kind: "call", fnId: "observed-operation", args: [{ kind: "ref", savedExprId: "saved-input" }] } } };
    const root = { id: "root-a", referenceId: "locus:root-a", name: "Current data", expressions: {}, lists: [], items: [
      { id: "selected-occurrence", caption: "Selected data", source: { kind: "ref", ref: { id: selected.id } } },
      { id: "visible-consumer", caption: "Consumer", source: { kind: "expr", expr: { kind: "ref", savedExprId: selected.id } } },
    ] };
    const capture = (values, generation) => readerSourceMetadataPacket(source, "root-a", generation,
      call("dependencyMetadataRoster", [root, values, [{ id: "observed-operation", label: "Observed operation" }]]));
    const initial = capture([selected, input], "reader-a:1");
    const first = graph(run(initial));
    expect(edges(first)).toEqual([["saved-input", "saved-selected"], ["observed-operation", "saved-selected"], ["saved-selected", "visible-consumer"]]);
    const edited = { ...selected, query: { kind: "expression", expr: { kind: "call", fnId: "new-operation", args: [{ kind: "ref", savedExprId: "new-input" }] } } };
    const fresh = capture([edited, input], "reader-a:2");
    const second = graph(run(fresh));
    expect(edges(second)).toEqual([["new-input", "saved-selected"], ["new-operation", "saved-selected"], ["saved-selected", "visible-consumer"]]);
    expect(edges(graph(run(initial)))).toEqual(edges(first));
    expect(JSON.stringify(retainedQuery)).toBe(retainedBytes);
    expect(JSON.stringify(fresh).length).toBeLessThan(2500);
    expect(JSON.stringify(fresh)).not.toContain("bytes");
    expect(input.query.expr.value.bytes).toBe(bytes);
    const unreadable = { ...selected, query: { kind: "expression", expr: { kind: "unrecognized-expression" } } };
    refused(run(capture([unreadable, input], "reader-a:3")));
    refused(evaluate(retainedQuery, {}, context));
  });
});
