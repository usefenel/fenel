import "../../../../../../implementations/typescript/engine/src/engine-body-host-install";
import { describe, expect, test } from "bun:test";
import type { AuthoringSession } from "./account-authoring-session";
import type { FenelType, TypeScheme } from "@fenel/engine/types";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import { draftSaveIssue } from "./creation-validation";
import { evaluateAuthoringExpressionInSession } from "./expression-evaluation";
import { readWrappingInputInference } from "./async-suggestions";
import { inferScopedAuthoringExpression, literalMembershipFor } from "./literal-membership";
import { checkAuthoringSchemeStructure } from "../../../../../../implementations/typescript/engine/src/signature-inference";
import type { ExpressionInferenceItem, ExpressionInferenceReply } from "./authoring-worker-protocol";

// Function picker contract (checkpoint 3 rehearsal, Nov 8): on a Local String
// card, Add function -> "upper" showed "functions 8" and no rows. A slot typed by
// a picked scalar keeps that type's exact identity handle ({$ref: <String UUID>},
// `expectedSchemeForType` has no constructor row for an opaque scalar), and the
// worker's rank-suggestions judged every `String` result against that UUID
// spelling. One actual Local registry and its full captured catalogue, as the
// worker uses them; run alone in the shared heavy slot:
//   bun --no-env-file test --timeout 600000 ./src/lib/expression-runner/picker-uuid-contract.test.ts  (distro dir, FENEL_PARSER_LEGACY=1)
const SOURCE = "fenel-browser-local-picker";
const [reader, catalogue, artifact, detached, mint, suggestions, authoring, judgment] = await Promise.all([
  import("../reader-registry"), import("./authoring-catalog"),
  import("./authoring-catalogue-artifact"), import("./detached-authoring-environment"),
  import("../../../../../../implementations/typescript/runtime/src/authority-mint"), import("../data-suggestions"),
  import("@fenel/engine/authoring/environment"), import("./result-judgment"),
]);
type LabeledResultRequirement = Parameters<typeof suggestions.scopedResultRequirement>[1] & { label: string };
const saved = { owners: [], fields: [], facets: [] };
const registry = await reader.buildLocalReaderFieldRegistry(SOURCE, saved as never, { preparation: "inline", representations: [] });
const frame = Object.freeze({ ...catalogue.evaluateContextForCatalog(registry), _authority: mint.mintAnonymousAuthority(registry),
  _activeTags: Object.freeze([SOURCE]) as unknown as string[] });
const { catalog } = await artifact.localCatalogue(registry, frame,
  { localSourceId: SOURCE, snapshot: saved, entities: [], functions: [], localRepresentations: [] } as never, undefined,
  { catalogueSourceId: SOURCE, graceMs: 0 });
const environment = detached.createDetachedAuthoringEnvironment(catalogue.environmentForCatalog(catalog, registry));
const session: AuthoringSession = Object.freeze({ mode: "detached", registry, catalog: environment.catalog, environment, evaluateContext: frame });

const entry = (name: string) => {
  const id = environment.resolveFunctionId(name);
  const row = session.catalog.functions.find(candidate => (candidate.targetId ?? candidate.id) === id);
  if (!row) throw new Error(`${name} is not in the Local catalogue`);
  return row;
};
const systemType = (name: string) => {
  const handle = registry.getTypeUuid("system", name);
  if (!handle) throw new Error(`no system ${name} type identity`);
  return { $ref: handle };
};
// The worker's rank-suggestions options: mode and input from the page, its own registry.
const rank = (name: string, expected: unknown) => authoring.rankAuthoringFunctionSuggestions([entry(name)], expected as never,
  { mode: "call", registry: session.registry })[0]!.match;

describe("Function picker: a slot typed by a picked scalar's identity handle", () => {
  test("the worker's requirement repair ranks std.upper direct against the raw String handle", async () => {
    const raw = systemType("String");
    // The defect itself: the raw handle refuses every String result.
    console.info("[picker-uuid] raw", JSON.stringify(raw), rank("std.upper", raw));
    const expected = suggestions.scopedExpectedType(session, raw);
    console.info("[picker-uuid] scoped", JSON.stringify(expected), rank("std.upper", expected));
    expect(rank("std.upper", expected)).toBe("direct");
    expect(rank("std.capitalize", expected)).toBe("direct");
    // A Number result stays out of the String-filtered list.
    expect(rank("std.negate", expected)).not.toBe("direct");
    // The same owner, written by name, is unchanged and ranks the same way.
    expect(suggestions.scopedExpectedType(session, { $ref: "String" })).toEqual({ $ref: "String" });
    expect(rank("std.upper", { $ref: "String" })).toBe("direct");
  }, 600_000);

  // Lane D (4b): the Local String card's Expression graph said "Data not
  // available" and "This expression returns String. Finish with <UUID>": its
  // result requirement is the same raw handle, so upper "Bonjour" was judged a
  // mismatch and the graph capture was refused.
  test("a result requirement spelled by the raw String handle judges a String result compatible once repaired", () => {
    const raw = systemType("String");
    const node = { kind: "call", fnId: environment.resolveFunctionId("std.upper")!, args: [{ kind: "literal", value: "Bonjour" }] } as const;
    const inferred = authoring.inferAuthoringExpressionWithLiteralWitnesses(node as never, { ...environment });
    expect(inferred.outcome.$tag).toBe("Solved");
    const before = judgment.judgeAuthoringResult(node as never, raw as never, undefined, "String", inferred, session);
    console.info("[result-uuid] raw", JSON.stringify(raw), before.mismatch, before.message);
    const judge = suggestions.scopedResultRequirement<LabeledResultRequirement>(session, { expected: raw as never, label: "String" });
    expect(judge.scheme).toBeDefined();
    const after = judgment.judgeAuthoringResult(node as never, judge.expected, judge.scheme, judge.label, inferred, session);
    expect(after.mismatch).toBe(false);
    // A Number result still mismatches the repaired String requirement.
    const negated = { kind: "call", fnId: environment.resolveFunctionId("std.negate")!, args: [{ kind: "literal", value: 2 }] } as const;
    const number = authoring.inferAuthoringExpressionWithLiteralWitnesses(negated as never, { ...environment });
    expect(judgment.judgeAuthoringResult(negated as never, judge.expected, judge.scheme, judge.label, number, session).mismatch).toBe(true);
    // A requirement written by name is unchanged.
    const named = { expected: { $ref: "String" } as never, label: "String" };
    expect(suggestions.scopedResultRequirement(session, named)).toBe(named);
  }, 600_000);

  // Lane D (Rom's decision (b)): the function's own representations, selected
  // in this actual Local frame, mark the internal helpers.
  test("functions their source marks internal are marked in the Local frame; ordinary ones are not", () => {
    const id = (name: string) => { const row = entry(name); return [row.targetId, row.id]; };
    const marked = (name: string) => suggestions.functionMarkedInternal(session, id(name));
    console.info("[internal] documentExportHtmlLiteral", marked("std.documentExportHtmlLiteral"), "upper", marked("std.upper"));
    expect(marked("std.documentExportHtmlLiteral")).toBe(true);
    expect(marked("std.upper")).toBe(false);
    expect(marked("std.escapeHtml")).toBe(false);
    expect(marked("std.capitalize")).toBe(false);
  }, 600_000);

  test("infer-expression judges against the repaired requirement", async () => {
    const source = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
    const branch = source.slice(source.indexOf('data.method === "infer-expression"'), source.indexOf('data.method === "infer-function-draft"'));
    expect(branch).toContain("scopedResultRequirement(framed, item.judge)");
  });

  test("rank-suggestions judges against the repaired requirement", async () => {
    const source = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
    const branch = source.slice(source.indexOf('data.method === "rank-suggestions"'), source.indexOf("The authoring worker request is unavailable."));
    expect(branch).toContain("scopedExpectedType(session, data.expected)");
    expect(branch).not.toContain("data.expected, {");
  });
});

// Execute the actual worker admission tails against the real Local fixture
// above. The harness supplies only already-established frame/source plumbing;
// qualification, inference, membership and result transport remain production.
const workerSaveSource = await Bun.file(new URL("./authoring-catalog-worker-main.ts", import.meta.url)).text();
const compileAdmission = (start: string, end: string) => {
  const from = workerSaveSource.indexOf(start), to = workerSaveSource.indexOf(end, from);
  if (from < 0 || to < from || workerSaveSource.indexOf(start, from + start.length) >= 0)
    throw new Error("The worker admission boundary moved; inspect the test extraction.");
  const body = workerSaveSource.slice(from, to + end.length);
  const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(`function runAdmission() { ${body} }`);
  return new Function("session", "data", "node", "value", "dependencies", `
    const { scopedResultRequirement, draftSaveIssue, evaluateAuthoringExpressionInSession, registryTransportSnapshot } = dependencies;
    const framed = session, evaluateContext = session.evaluateContext, element = undefined;
    const saved = new Map(), resolveSavedExpr = id => saved.get(id), cancelled = new Set();
    const prepared = { node }, evaluated = { result: value }, admission = data;
    let result = { result: value };
    ${javascript}
    runAdmission();
    return result;
  `) as (session: AuthoringSession, data: SaveRequest, node: ExprNode, value: unknown,
    dependencies: typeof workerSaveDependencies) => { issue?: string; result?: unknown };
};
const workerSaveDependencies = { scopedResultRequirement: suggestions.scopedResultRequirement,
  draftSaveIssue, evaluateAuthoringExpressionInSession, registryTransportSnapshot };
type SaveRequest = Pick<NonNullable<Parameters<typeof draftSaveIssue>[2]>,
  "expectedType" | "expectedScheme" | "expectedTypeName" | "actualTypeName"> & { evaluate?: boolean };
const saveOnly = compileAdmission("const expectedType = element ?? data.expectedType;",
  'result = registryTransportSnapshot({ issue: draftSaveIssue(node, framed.environment, options) }, "worker expression save result");');
const evaluatedSave = compileAdmission("const expectedType = element ?? admission.expectedType;",
  "if (issue !== undefined) result = { ...result, issue };");
const workerSave = (which: typeof saveOnly, node: ExprNode, request: SaveRequest, value?: unknown) =>
  which(session, request, node, value, workerSaveDependencies);
const imageValue = { width: 1, height: 1, pixels: [{ r: 244, g: 233, b: 208, a: 255 }] };
const saveCases = () => [
  { name: "Number", raw: systemType("Number") as FenelType,
    node: { kind: "call", fnId: entry("std.negate").targetId!, args: [{ kind: "literal", value: 21 }] } as ExprNode },
  { name: "Image", raw: { $ref: registry.getTypeUuid("std", "Image")! } as FenelType,
    node: { kind: "call", fnId: entry("std.imageInvert").targetId!, args: [{ kind: "literal", value: imageValue }] } as ExprNode },
];

describe("Worker save admission retains the selected type owner", () => {
  test("both save paths accept computed Number and Image under their exact selected handles", () => {
    for (const { name, raw, node } of saveCases()) {
      expect("$ref" in raw && typeof raw.$ref === "string").toBe(true);
      const value = evaluateAuthoringExpressionInSession(node, () => undefined, session).result;
      if (name === "Number") expect(value).toBe(-21);
      else expect(value).toEqual({ width: 1, height: 1, pixels: [{ r: 11, g: 22, b: 47, a: 255 }] });
      expect(workerSave(saveOnly, node, { expectedType: raw }).issue).toBeUndefined();
      expect(workerSave(saveOnly, node, { expectedType: raw, evaluate: true }).issue).toBeUndefined();
      expect(workerSave(evaluatedSave, node, { expectedType: raw }, value).issue).toBeUndefined();
      // A transported scheme alone is also a selected handle, not a new owner.
      expect(workerSave(saveOnly, node, { expectedScheme: { quantified: [], body: raw } }).issue).toBeUndefined();
    }
  }, 600_000);

  test("same displayed names cannot replace a different captured nominal owner", () => {
    for (const { raw, node } of saveCases()) {
      const repaired = suggestions.scopedResultRequirement<{ expected: FenelType; scheme?: TypeScheme }>(session, { expected: raw });
      if (!repaired.scheme?.nominals?.length) throw new Error("Expected canonical selected type owner");
      const foreign: TypeScheme = { ...repaired.scheme, body: raw,
        nominals: repaired.scheme.nominals.map(owner => ({ ...owner, identity: '["other-account","SameCaption"]' })) };
      const request = { expectedType: raw, expectedScheme: foreign };
      expect(suggestions.scopedResultRequirement(session, { expected: raw, scheme: foreign }).scheme).toBe(foreign);
      const value = evaluateAuthoringExpressionInSession(node, () => undefined, session).result;
      expect(workerSave(saveOnly, node, request).issue).toBeDefined();
      expect(workerSave(evaluatedSave, node, request, value).issue).toBeDefined();
      // The original UUID/body contradiction remains a rejected carrier.
      expect(checkAuthoringSchemeStructure(foreign).ok).toBe(false);
      // Separately retain refusal for a well-formed scheme with another owner.
      // Its public spelling and body agree; canonical scheme comparison owns
      // the mismatch, while unavailable membership stays undecided.
      const foreignOwner: TypeScheme = { ...foreign, body: repaired.scheme.body };
      expect(checkAuthoringSchemeStructure(foreignOwner).ok).toBe(true);
      const ownedRequest = { expectedType: raw, expectedScheme: foreignOwner };
      expect(workerSave(saveOnly, node, ownedRequest).issue).toBeDefined();
      expect(workerSave(evaluatedSave, node, ownedRequest, value).issue).toBeDefined();
    }
  }, 600_000);

  test("known input, return and evaluated-value refusals survive requirement repair", () => {
    const [numberCase, imageCase] = saveCases();
    const badImage: ExprNode = { ...imageCase!.node as Extract<ExprNode, { kind: "call" }>,
      args: [{ kind: "literal", value: 42 }] };
    expect(workerSave(saveOnly, badImage, { expectedType: imageCase!.raw }).issue).toBeDefined();
    const wrongReturn: ExprNode = { kind: "call", fnId: entry("std.upper").targetId!, args: [{ kind: "literal", value: "hello" }] };
    expect(workerSave(saveOnly, wrongReturn, { expectedType: numberCase!.raw }).issue).toBeDefined();
    // Even a compatible computed Number cannot admit an independently supplied
    // non-Number result at the existing evaluate-then-save membership boundary.
    expect(workerSave(evaluatedSave, numberCase!.node, { expectedType: numberCase!.raw }, "not a number").issue).toBeDefined();
  }, 600_000);
});

// Exercise the actual infer-expression owner between its prepared node and
// reply projection, under this test's real Local registry/frame. No copied
// qualification or membership policy lives in the harness.
const inferBranchStart = workerSaveSource.indexOf('data.method === "infer-expression"');
const inferBranchEnd = workerSaveSource.indexOf('data.method === "infer-function-draft"', inferBranchStart);
const inferBranch = workerSaveSource.slice(inferBranchStart, inferBranchEnd);
const inferStart = inferBranch.indexOf("const expected = item.expectedScheme");
const inferEnd = inferBranch.indexOf("// Lane D (4b)", inferStart);
if (inferBranchStart < 0 || inferBranchEnd < inferBranchStart || inferStart < 0 || inferEnd < inferStart
  || inferBranch.indexOf("const expected = item.expectedScheme", inferStart + 1) >= 0)
  throw new Error("The worker input-inference boundary moved; inspect the test extraction.");
const inferJavascript = new Bun.Transpiler({ loader: "ts" }).transformSync(inferBranch.slice(inferStart, inferEnd));
const compatibilityStart = workerSaveSource.indexOf("function readerCompatibility(");
const compatibilityEnd = workerSaveSource.indexOf("function take(", compatibilityStart);
if (compatibilityStart < 0 || compatibilityEnd < compatibilityStart)
  throw new Error("The worker compatibility helper moved; inspect the test extraction.");
const compatibilityJavascript = new Bun.Transpiler({ loader: "ts" })
  .transformSync(workerSaveSource.slice(compatibilityStart, compatibilityEnd));
const workerInferDependencies = {
  scopedExpectedType: suggestions.scopedExpectedType,
  judgeAuthoringSchemeCompatibility: authoring.judgeAuthoringSchemeCompatibility,
  scopedResultRequirement: suggestions.scopedResultRequirement,
  inferScopedAuthoringExpression,
  literalMembershipFor,
};
const workerInputInference = new Function("framed", "item", "dependencies", `
  const { scopedExpectedType, scopedResultRequirement, judgeAuthoringSchemeCompatibility, inferScopedAuthoringExpression, literalMembershipFor } = dependencies;
  const node = item.node, resolveSavedExpr = id => framed.environment.resolveSavedExpr?.(id);
  const literalMembership = literalMembershipFor(framed.environment,
    { registry: framed.registry, evaluateContext: framed.evaluateContext });
  ${compatibilityJavascript}
  ${inferJavascript}
  return reply;
`) as (framed: AuthoringSession, item: ExpressionInferenceItem,
  dependencies: typeof workerInferDependencies) => ExpressionInferenceReply;
const inferPickerInput = (item: ExpressionInferenceItem) => workerInputInference(session, item, workerInferDependencies);
const imagePickerRequirement = () => {
  const identity = registry.getTypeUuid("std", "Image");
  if (!identity) throw new Error("The real Local catalogue has no std.Image identity");
  const raw: FenelType = { $ref: identity };
  const exact = suggestions.scopedResultRequirement<{ expected: FenelType; scheme?: TypeScheme }>(session, { expected: raw });
  if (!exact.scheme?.nominals?.length) throw new Error("Image must retain its actual captured nominal owner");
  return { raw, exact: exact.scheme };
};
const rankImageInput = (input: ExpressionInferenceReply, expected: TypeScheme) => {
  if (!input.scheme || input.outcome.$tag !== "Solved") throw new Error("Input did not solve");
  return authoring.rankAuthoringFunctionSuggestions([entry("std.imageInvert")], expected,
    { mode: "call", registry: session.registry, inputScheme: input.scheme })[0]!.match;
};

describe("Worker wrapping-input inference retains a checked selected owner", () => {
  test("a checked Image input makes Invert available without replacing the structural-inference control", () => {
    const { raw, exact } = imagePickerRequirement();
    const node: ExprNode = { kind: "literal", value: imageValue };
    const standalone = inferPickerInput({ node });
    expect(standalone.outcome.$tag).toBe("Solved");
    expect(rankImageInput(standalone, exact)).toBe("mismatch");
    const absent = inferScopedAuthoringExpression(node, { ...environment,
      literalMembership: literalMembershipFor(environment, { registry, evaluateContext: frame }) }, { expectedScheme: undefined });
    expect(absent).toEqual(standalone);
    const undecided = { ...environment, literalMembership: () => ({ $tag: "Nothing" } as const) };
    for (const body of [{ $el: { var: "pendingType" } }, { $var: "unbound" }] as FenelType[]) {
      const options = { expectedScheme: { quantified: [], body } };
      const ordinary = authoring.inferAuthoringExpressionWithLiteralWitnesses(node, undecided, options);
      expect(inferScopedAuthoringExpression(node, undecided, options)).toEqual(ordinary);
    }
    const item: ExpressionInferenceItem = { node, expectedScheme: { quantified: [], body: raw } };
    const checked = readWrappingInputInference(item, inferPickerInput);
    expect(checked?.outcome.$tag).toBe("Solved");
    expect(checked?.scheme?.nominals).toEqual(exact.nominals);
    expect(rankImageInput(checked!, exact)).toBe("direct");
    expect(item.expectedScheme?.body).toEqual(raw);
    expect(node.value).toEqual(imageValue);
  }, 600_000);

  test("invalid pixels and a foreign same-caption owner cannot become a checked Image input", () => {
    const { raw, exact } = imagePickerRequirement();
    const foreign: TypeScheme = { ...exact, body: raw,
      nominals: exact.nominals!.map(owner => ({ ...owner, identity: '["other-account","Image"]' })) };
    expect(suggestions.scopedResultRequirement(session, { expected: raw, scheme: foreign }).scheme).toBe(foreign);
    expect(checkAuthoringSchemeStructure(foreign).ok).toBe(false);
    const hiddenRaw: TypeScheme = Object.defineProperty({ ...exact, body: raw }, "nominals",
      { value: exact.nominals, enumerable: false });
    expect(suggestions.scopedResultRequirement(session, { expected: raw, scheme: hiddenRaw }).scheme).toBe(hiddenRaw);
    const cases: ExpressionInferenceItem[] = [
      { node: { kind: "literal", value: { ...imageValue, pixels: [{ r: "red", g: 0, b: 0, a: 255 }] } },
        expectedScheme: { quantified: [], body: raw } },
      { node: { kind: "literal", value: imageValue }, expectedScheme: foreign },
      // A refused transport must not be sanitized by dropping its sidecar and
      // then re-inferred as if that metadata had never been supplied.
      { node: { kind: "literal", value: imageValue }, expectedScheme:
        Object.defineProperty({ ...exact }, "nominals", { value: exact.nominals, enumerable: false }) },
      { node: { kind: "literal", value: imageValue }, expectedScheme: hiddenRaw },
    ];
    for (const item of cases) {
      const contextual = inferPickerInput(item);
      expect(contextual.outcome.$tag).not.toBe("Solved");
      const fallback = readWrappingInputInference(item, inferPickerInput);
      expect(fallback?.outcome.$tag).toBe("Solved");
      const match = rankImageInput(fallback!, exact);
      expect(match).not.toBe("direct");
      expect(match).not.toBe("adaptable");
    }
    // A readable but unavailable foreign owner remains an unknown membership,
    // so ordinary structural inference is preserved without an Image witness.
    const foreignOwner: TypeScheme = { ...foreign, body: exact.body };
    expect(checkAuthoringSchemeStructure(foreignOwner).ok).toBe(true);
    const unknown = inferPickerInput({ node: { kind: "literal", value: imageValue }, expectedScheme: foreignOwner });
    const independent = inferPickerInput({ node: { kind: "literal", value: imageValue }, expectedScheme: undefined });
    expect(unknown).toEqual(independent);
    const match = rankImageInput(unknown, exact);
    expect(match).not.toBe("direct");
    expect(match).not.toBe("adaptable");
  }, 600_000);
});

test("a String destination preserves String and cannot supply a Phone witness", () => {
  // Exact public Phone identity; an unscoped spelling does not select this fixture owner.
  const owner = frame._typeFamilyOwner?.("f582abdc-9959-43fd-be5a-10049b855d8c", undefined);
  if (!owner) throw new Error("The real Local catalogue has no shipped Phone owner");
  const resolved = frame._callSiteTyping?.resolveTypeInDeclaration?.({ $ref: owner.name }, owner.ownerIdentity);
  if (!resolved?.ok) throw new Error("The captured Phone declaration could not be resolved");
  const node: ExprNode = { kind: "literal", value: "not a phone" };
  const rawString = systemType("String");
  const reads: ExpressionInferenceItem[] = [];
  const broad = readWrappingInputInference({ node, expectedScheme: { quantified: [], body: rawString } }, item => {
    reads.push(item);
    return inferPickerInput(item);
  });
  expect(broad?.outcome.$tag).toBe("Solved");
  expect(broad?.scheme?.body).toEqual({ $ref: "String" });
  expect(reads).toHaveLength(1);
  expect(reads[0]?.expectedScheme).toBeUndefined();
  expect(authoring.judgeAuthoringSchemeCompatibility(broad!.scheme!, resolved.type, { registry })).not.toBe("compatible");
  const phoneItem: ExpressionInferenceItem = { node, expectedScheme: resolved.type };
  expect(inferPickerInput(phoneItem).outcome.$tag).not.toBe("Solved");
  const refused = readWrappingInputInference(phoneItem, inferPickerInput);
  expect(refused?.scheme?.body).toEqual({ $ref: "String" });
  expect(authoring.judgeAuthoringSchemeCompatibility(refused!.scheme!, resolved.type, { registry })).not.toBe("compatible");
}, 600_000);
