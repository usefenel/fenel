import { beforeAll, describe, expect, test } from "bun:test";
import { createRepositoryRegistry } from "../src/repository-registry.ts";
import { modulesFor } from "../src/module-manifest.ts";
import {
  evaluate,
  readerSourceMetadataEvaluateContext,
} from "../src/json-logic.ts";
import {
  inferAuthoringExpressionWithLiteralWitnesses,
  judgeAuthoringSchemeCompatibility,
  projectAuthoringScheme,
} from "../src/authoring/environment.ts";
import { peelResultForAuthoring } from "../src/authoring/type-authoring.ts";
import {
  buildSessionCatalog,
  environmentForCatalog,
  evaluateContextForCatalog,
} from "../../../../distros/narthex/solid/src/lib/expression-runner/authoring-catalog.ts";
import { createDetachedAuthoringEnvironment } from "../../../../distros/narthex/solid/src/lib/expression-runner/detached-authoring-environment.ts";
import { literalMembershipFor } from "../../../../distros/narthex/solid/src/lib/expression-runner/literal-membership.ts";
import { authoringExpressionLogic } from "../../../../distros/narthex/solid/src/lib/expression-runner/expression-evaluation.ts";

// Deliberately expensive integration acceptance. This builds the complete seed
// with the embedded strict lock and the actual product catalogue/environment.
// No signature rows, nominal owners, current-reader sessions or inferred
// outcomes are replaced. Only inert admitted metadata is fixture data.
const BUILD_TIMEOUT = 600_000;
const CHECK_TIMEOUT = 300_000;
const nothing = { $tag: "Nothing" };
let registry;
let session;
let queryNode;
let queryLogic;
let queryBytes;
let queryFunction;
let nativeFunction;
let declaredResult;
let graphOwner;
let reverseId;
let upperId;

beforeAll(() => {
  console.info("Dependency registry acceptance: building normal strict seed registry");
  registry = createRepositoryRegistry(modulesFor("seed"));
  console.info("Dependency registry acceptance: building real product authoring catalogue");
  const catalog = buildSessionCatalog(registry);
  const environment = createDetachedAuthoringEnvironment(environmentForCatalog(catalog, registry));
  session = Object.freeze({ mode: "detached", registry, catalog: environment.catalog,
    environment, evaluateContext: evaluateContextForCatalog(registry) });
  const queryId = environment.resolveFunctionId("view.dependencyQuery");
  const nativeId = environment.resolveFunctionId("view.readerSourceMetadata");
  expect(typeof queryId).toBe("string");
  expect(typeof nativeId).toBe("string");
  queryFunction = registry.getIdentifiedFunction(queryId);
  nativeFunction = registry.getIdentifiedFunction(nativeId);
  expect(queryFunction?.body).toBeDefined();
  expect(nativeFunction).toBeDefined();
  expect(nativeFunction?.body).toBeUndefined();
  expect(registry.getFunctionSignatureInfo(queryId)?.outcome.$tag).toBe("Solved");
  expect(registry.getFunctionSignatureInfo(nativeId)?.outcome.$tag).toBe("Solved");
  const declared = registry.getFunctionScheme(queryId);
  expect(declared).toBeDefined();
  declaredResult = projectAuthoringScheme(declared, ["$arrow", "returns"]);
  expect(declaredResult).toBeDefined();
  const graphMember = registry.resolveModuleMember("view", "DependencyGraph");
  expect(graphMember.kind).toBe("type");
  const graphHandle = graphMember.value.$ref;
  const graphEntity = registry.getIdentifiedEntity(graphHandle);
  expect(graphEntity).toBeDefined();
  expect(graphEntity.module).toBe("view");
  graphOwner = registry.getEntityNominalIdentity(graphHandle);
  expect(typeof graphOwner).toBe("string");
  expect(declaredResult.nominals?.some(entry => entry.identity === graphOwner)).toBe(true);
  reverseId = environment.resolveFunctionId("std.reverse");
  upperId = environment.resolveFunctionId("std.upper");
  expect(typeof reverseId).toBe("string");
  expect(typeof upperId).toBe("string");
  queryNode = { kind: "call", fnId: queryId, args: [{ kind: "literal", value: {
    $tag: "DependencySourceLocator", source: { $tag: "ThisTabSource" }, rootId: "fixture-root", occurrenceId: "selected",
  } }] };
  queryLogic = authoringExpressionLogic(queryNode, undefined, session);
  queryBytes = JSON.stringify(queryLogic);
  console.info("Dependency registry acceptance: real seed session and retained query ready");
}, BUILD_TIMEOUT);

function packet(generation, callableId, label) {
  return { $tag: "ReaderSourceMetadata", source: { $tag: "ThisTabSource" }, rootId: "fixture-root", generation,
    expressions: [
      { $tag: "SourceExpressionMetadata", id: "selected-expression", label: "Selected source", slots: [
        { $tag: "SourceCall", identity: callableId }, { $tag: "SourceLiteral" }, { $tag: "SourceParameter" },
      ] },
      { $tag: "SourceExpressionMetadata", id: "consumer-expression", label: "Consumer source", slots: [
        { $tag: "SourceReference", identity: "selected-reference" },
      ] },
    ],
    occurrences: [
      { $tag: "SourceOccurrenceMetadata", id: "selected", label: "Selected data", expressionId: "selected-expression",
        referenceId: { $tag: "Just", _0: "selected-reference" } },
      { $tag: "SourceOccurrenceMetadata", id: "consumer", label: "Visible consumer", expressionId: "consumer-expression",
        referenceId: nothing },
    ],
    callableLabels: [{ $tag: "DependencyNode", id: callableId, label }],
  };
}

function actualGraph(result) {
  expect(result?.$tag).toBe("Ok");
  expect(result?._0?.$tag).toBe("DependencyGraph");
  expect(Array.isArray(result?._0?.nodes)).toBe(true);
  expect(Array.isArray(result?._0?.edges)).toBe(true);
  return result._0;
}

function resultPayloadScheme(scheme, caseName) {
  const caseIndex = scheme.body.$variant.cases.findIndex(row => row.name === caseName);
  expect(caseIndex).toBeGreaterThanOrEqual(0);
  const selected = projectAuthoringScheme(scheme, ["$variant", "cases", String(caseIndex), "fields", "0", "type"]);
  expect(selected).toBeDefined();
  return selected;
}

describe("dependency source metadata in the real seed registry", () => {
  test("the registered native returns canonical absence and its Fenel query returns Err", () => {
    const context = registry.evaluateContext();
    const nativeKeys = [nativeFunction.id, registry.getUuid(nativeFunction.id), "view:readerSourceMetadata"].filter(Boolean);
    expect(nativeKeys.some(key => typeof context.nativesCtx?.[key] === "function")).toBe(true);
    const node = { kind: "call", fnId: session.environment.resolveFunctionId("view.readerSourceMetadata"), args: [] };
    const nativeLogic = authoringExpressionLogic(node, undefined, session);
    expect(evaluate(nativeLogic, {}, context)).toEqual(nothing);
    expect(evaluate(nativeLogic, {}, session.evaluateContext)).toEqual(nothing);
    const result = evaluate(queryLogic, {}, session.evaluateContext);
    expect(result?.$tag).toBe("Err");
    expect(typeof result?._0).toBe("string");
    expect(result?._0.length).toBeGreaterThan(0);
    expect(result).not.toBeNull();
  }, CHECK_TIMEOUT);

  test("the ordinary unannotated call infers its real full Result String DependencyGraph scheme", () => {
    const inferred = inferAuthoringExpressionWithLiteralWitnesses(queryNode, session.environment, {
      literalMembership: literalMembershipFor(session.environment, { registry, evaluateContext: session.evaluateContext }),
    });
    if (inferred.outcome.$tag !== "Solved") {
      console.info("Dependency registry acceptance: inference refusal", JSON.stringify(inferred.outcome));
    }
    expect(inferred.outcome.$tag).toBe("Solved");
    expect(inferred.scheme).toBeDefined();
    expect(inferred.scheme.quantified).toHaveLength(0);
    const result = peelResultForAuthoring(inferred.scheme.body);
    const declared = peelResultForAuthoring(declaredResult.body);
    expect(result).not.toBeNull();
    expect(declared).not.toBeNull();
    expect(inferred.scheme.nominals?.some(entry => entry.identity === graphOwner)).toBe(true);
    for (const nominal of declaredResult.nominals ?? []) {
      expect(inferred.scheme.nominals?.some(entry => entry.identity === nominal.identity)).toBe(true);
    }
    for (const caseName of ["Err", "Ok"]) {
      const actualPayload = resultPayloadScheme(inferred.scheme, caseName);
      const declaredPayload = resultPayloadScheme(declaredResult, caseName);
      for (const nominal of declaredPayload.nominals ?? []) {
        expect(actualPayload.nominals?.some(entry => entry.identity === nominal.identity)).toBe(true);
      }
      expect(judgeAuthoringSchemeCompatibility(actualPayload, declaredPayload, { registry })).toBe("compatible");
      expect(judgeAuthoringSchemeCompatibility(declaredPayload, actualPayload, { registry })).toBe("compatible");
      if (caseName === "Ok") {
        expect(actualPayload.nominals?.some(entry => entry.identity === graphOwner && entry.path.length === 0)).toBe(true);
      }
    }
    expect(judgeAuthoringSchemeCompatibility(inferred.scheme, declaredResult, { registry })).toBe("compatible");
    expect(judgeAuthoringSchemeCompatibility(declaredResult, inferred.scheme, { registry })).toBe("compatible");
    expect(JSON.stringify(queryLogic)).toBe(queryBytes);
    expect(queryNode.args[0].kind).toBe("literal");
    expect(Object.hasOwn(queryNode.args[0].value, "__ann")).toBe(false);
  }, CHECK_TIMEOUT);

  test("normal evaluation uses a fresh captured packet without rewriting the retained query", () => {
    const firstPacket = packet("reader:1", reverseId, "Reverse");
    const secondPacket = packet("reader:2", upperId, "Uppercase");
    const firstFrame = readerSourceMetadataEvaluateContext(session.evaluateContext, firstPacket);
    const secondFrame = readerSourceMetadataEvaluateContext(session.evaluateContext, secondPacket);
    const first = actualGraph(evaluate(queryLogic, {}, firstFrame));
    const second = actualGraph(evaluate(queryLogic, {}, secondFrame));
    expect(first.focus).toBe("selected-reference");
    expect(second.focus).toBe(first.focus);
    expect(first.nodes.map(node => [node.id, node.label])).toContainEqual([reverseId, "Reverse"]);
    expect(second.nodes.map(node => [node.id, node.label])).toContainEqual([upperId, "Uppercase"]);
    expect(second.nodes.some(node => node.id === reverseId)).toBe(false);
    expect(first.edges.map(edge => [edge.from, edge.to])).toContainEqual(["selected-reference", "consumer"]);
    expect(second.edges.map(edge => [edge.from, edge.to])).toContainEqual(["selected-reference", "consumer"]);
    const cleared = readerSourceMetadataEvaluateContext(secondFrame, undefined);
    expect(evaluate(queryLogic, {}, cleared)?.$tag).toBe("Err");
    expect(evaluate(queryLogic, {}, session.evaluateContext)?.$tag).toBe("Err");
    expect(JSON.stringify(queryLogic)).toBe(queryBytes);
    expect(queryBytes).not.toContain("SourceExpressionMetadata");
    expect(queryBytes).not.toContain("ReaderSourceMetadata");
  }, CHECK_TIMEOUT);

  test("application and bound code-reference slots keep the real registered graph; an unknown slot beside them still refuses", () => {
    const applied = packet("reader:3", reverseId, "Reverse");
    applied.expressions[0].slots = [{ $tag: "SourceCodeReference", identity: upperId }, ...applied.expressions[0].slots, { $tag: "SourceApplication" }];
    applied.callableLabels = [...applied.callableLabels, { $tag: "DependencyNode", id: upperId, label: "Uppercase" }];
    applied.expressions[1].slots = [...applied.expressions[1].slots, { $tag: "SourceApplication" }];
    const value = actualGraph(evaluate(queryLogic, {}, readerSourceMetadataEvaluateContext(session.evaluateContext, applied)));
    expect(value.nodes.map(node => [node.id, node.label])).toContainEqual([reverseId, "Reverse"]);
    expect(value.nodes.map(node => [node.id, node.label])).toContainEqual([upperId, "Uppercase"]);
    expect(value.edges.map(edge => [edge.from, edge.to])).toContainEqual(["selected-reference", "consumer"]);
    const unknown = packet("reader:4", reverseId, "Reverse");
    unknown.expressions[1].slots = [...unknown.expressions[1].slots, { $tag: "SourceApplication" },
      { $tag: "SourceUnknown", issue: "Invalid authoring expression kind" }];
    expect(evaluate(queryLogic, {}, readerSourceMetadataEvaluateContext(session.evaluateContext, unknown))?.$tag).toBe("Err");
  }, CHECK_TIMEOUT);
});
