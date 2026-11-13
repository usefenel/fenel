// @ts-nocheck -- Bun test harness is outside the Solid ambient tsconfig.
import { describe, expect, test } from "bun:test";
import { createViewPersistence } from "./home-view-persistence";
import { settleWithin } from "./settle-within";
import { createIOCallController } from "./io-call-controller";
import { EVALUATOR_STRATEGIES, collectReferencedSavedExpressions, exprNodeToLogic, observeExprNode, logicToExprNode, typeCode, typePhrase, carrierTypeName } from "../../../../../implementations/typescript/engine/src/authoring/expression-authoring";
import { projectLocusTypeDescriptions } from "../../../../../implementations/typescript/engine/src/authoring/locus-type-presentation";
import { presentedTypeTarget, typeIconForPresentation } from "./type-icon-presentation";
import { readerResultTypeLabel, readerTypeLabelInSession } from "./reader-presentation";
import { displayNameItemFields, pickDisplayName } from "./display-name";
import { recordChildNameFields } from "./layout-renderer/typed-read-field-slots";
import { workspaceSourceKey } from "./workspace-source-wire";
import { projectAuthoringScheme } from "../../../../../implementations/typescript/engine/src/authoring/scheme-projection";
import { appendExpressionAt, editableContainerAt, expressionAt, replaceExpressionAt } from "./locus-expression-edit";
import { ROOT_SCOPE, childrenOf, scopeKey, scopeLabel, valueAt } from "./locus-scope";
import { followLocusPath } from "./locus-reference";
import { resolveLocusCatalogReference } from "./locus-catalog-reference";
import { childValueType } from "./data-transfer/child-type";
import { locusCatalogReferenceMetadata, readLocusCatalogReference } from "./locus-catalog-reference";
import { defaultTypeForKind, isFenelTypeLike, TYPE_KIND_GROUPS, detectTypeKind, TYPE_KIND_LABELS, peelListForAuthoring } from "@fenel/engine/authoring/type";
import { locusOpenMenuItems } from "./locus-menu-actions";
import { scopedConcreteType } from "./data-transfer/expressions";
import { cloneDraftValue, draftValueFingerprint } from "./native-draft";
import { registryTransportSnapshot } from "../../../../../implementations/typescript/engine/src/registry-transport";
import { createAuthoringEnvironment, expectedSchemeForType, inferAuthoringExpressionWithLiteralWitnesses,
  judgeAuthoringSchemeCompatibility, judgeAuthoringTypeCompatibility } from "@fenel/engine/authoring/environment";
import { projectAuthoringGraphEdgeIssue } from "@fenel/engine/authoring/binding-edits";
import { withInterpretedCompiledArtifacts } from "../../../../../implementations/typescript/engine/src/engine-bodies-dispatch";
import { checkScopedDataMembership, inferScopedAuthoringExpression } from "./expression-runner/literal-membership";
import { draftSaveIssue, draftSaveValidation, functionBodySaveIssue } from "./expression-runner/creation-validation";
import { expressionForLiteralValue } from "./expression-runner/creation-seed";
import { inlineWidgetFor } from "./expression-runner/inline-widgets";
import { judgeAuthoringResult } from "./expression-runner/result-judgment";
import { resolveValueType } from "@fenel/engine/authoring/type";
import { Maybe, List, Nothing, refHandle, Anything } from "@fenel/engine/type-foundation";
import { canvasSource, isCanvasExpression, isEntriesCanvasExpression, isPlacedValue, placementFromItem, projectPlacedItems } from "./locus-canvas-data";
import { fieldRecordEditPlan } from "@fenel/engine/authoring/field-render";
import { createLocusSynchronization } from "./locus-synchronization";
import { detectStructuralForm } from "./expression-runner/expression-structure";
import { authoringExpressionLogic, authoringExpressionSites } from "./expression-runner/expression-evaluation";
import { authoringExpressionHasEmptySlot } from "@fenel/engine/authoring/signature-authoring";

const source = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
const draftSaveSource = await Bun.file(new URL("./type-draft-save.ts", import.meta.url)).text();
const earlySource = await Bun.file(new URL("./home-entry.tsx", import.meta.url)).text();
const typedReadSource = await Bun.file(new URL("./layout-renderer/TypedReadValue.tsx", import.meta.url)).text();
const valueCardSource = await Bun.file(new URL("./value-card.tsx", import.meta.url)).text();
const displayNameSource = await Bun.file(new URL("./display-name.ts", import.meta.url)).text();
const accountDataSource = await Bun.file(new URL("./account-data-selector.tsx", import.meta.url)).text();
const fieldRendererSource = await Bun.file(new URL("./field-renderer/FieldRenderer.tsx", import.meta.url)).text();
const valuesSource = await Bun.file(new URL("../routes/app/values.tsx", import.meta.url)).text();
const panelsSource = await Bun.file(new URL("./DataInspectionDialog.tsx", import.meta.url)).text();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const editorSource = await Bun.file(new URL("./expression-runner/index.tsx", import.meta.url)).text();
const expressionSurfacesSource = await Bun.file(new URL("./expression-runner/expression-surfaces.tsx", import.meta.url)).text();
const cardEvaluationSource = await Bun.file(new URL("./locus-card-evaluation.ts", import.meta.url)).text();
const inspectionControllerStart = source.indexOf("function createInspectionExpressionController(");
const inspectionControllerEnd = source.indexOf("type InspectionExpressionController =", inspectionControllerStart);
if (inspectionControllerStart < 0 || inspectionControllerEnd <= inspectionControllerStart)
  throw new Error("Inspection controller boundary changed");
const inspectionControllerSource = source.slice(inspectionControllerStart, inspectionControllerEnd);
const inspectionPendingStart = inspectionControllerSource.indexOf("  function setPendingSourceText(");
const inspectionPendingEnd = inspectionControllerSource.indexOf("  // B4 unit C: a Local reader prints", inspectionPendingStart);
if (inspectionPendingStart < 0 || inspectionPendingEnd <= inspectionPendingStart)
  throw new Error("Inspection pending source boundary changed");
const inspectionPendingSource = inspectionControllerSource.slice(inspectionPendingStart, inspectionPendingEnd);

describe("complete rich graph data keeps shared checker guidance", () => {
  const inferenceStart = editorSource.indexOf("  const currentInference = createMemo", editorSource.indexOf("function NodeEditor("));
  const inferenceSource = editorSource.slice(inferenceStart, editorSource.indexOf("  const graphData = createMemo", inferenceStart));
  const guidanceStart = editorSource.indexOf("  const resultGuidance = createMemo", inferenceStart);
  const guidanceSource = editorSource.slice(guidanceStart, editorSource.indexOf("  const scopeCapture =", guidanceStart));
  const captionStart = editorSource.indexOf("function editorTypeCaption(");
  const captionSource = editorSource.slice(captionStart, editorSource.indexOf("/** B4 wave 4 lane E", captionStart));
  const captureStart = expressionSurfacesSource.indexOf("export const ExpressionGraphCaptureContext =");
  const captureEnd = expressionSurfacesSource.indexOf("/** An enclosing lexical expression", captureStart);
  if (captureStart < 0 || captureEnd <= captureStart) throw new Error("Graph capture context declaration moved");
  // Acquire the production default for an editor without an enclosing capture.
  // Only createContext's host allocation is replaced; no graph/checker policy is supplied.
  const graphCaptureContext = new Function("createContext",
    `${transpiler.transformSync(expressionSurfacesSource.slice(captureStart, captureEnd).replace("export ", ""))}; return ExpressionGraphCaptureContext;`)
    (value => value);
  const environment = createAuthoringEnvironment({ types: [], functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() });
  function fixture(value, expected) {
    const props = { node: { kind: "literal", value } };
    const scheme = { quantified: [], body: expected };
    const dependencies = {
      createMemo: compute => compute, props, needsChoice: () => true,
      genericSlot: () => false, inlineWidget: () => undefined, widgetTypeForSlot: () => undefined,
      expectedSchemeForType, session: { environment }, expectedScheme: () => scheme, resolvedFieldType: () => expected,
      measureAuthoringWork: (_label, compute) => compute(), inferScopedAuthoringExpression,
      // B4 slice 2: a page reader (no Local live guidance).
      guidance: undefined,
      inferenceContext: () => ({ ...environment,
        literalMembership: (data, wanted) => checkScopedDataMembership(wanted.body, data, environment) }),
    };
    const currentInference = new Function(...Object.keys(dependencies), `${transpiler.transformSync(inferenceSource)}; return currentInference;`)(...Object.values(dependencies));
    const guidanceDependencies = { ...dependencies, currentInference,
      typeNameOf: () => undefined, displayTypeLabel: typeCode, judgeAuthoringSchemeCompatibility,
      judgeAuthoringTypeCompatibility, draftSaveIssue, projectAuthoringGraphEdgeIssue, structuralModeForNode: () => undefined,
      // B4 slice 2: the editor's judgment moved verbatim into this shared function.
      judgeAuthoringResult,
      // The editor's own caption helper, for a page reader (no Local structure).
      editorTypeCaption: new Function("localStructure", "valueCardTypeLabel", "editorTypePhrase", "typeNameOf", "displayTypeLabel",
        `${transpiler.transformSync(captionSource)}; return editorTypeCaption;`)(() => false, label => label, () => undefined, () => undefined, typeCode),
      reader: undefined,
      graphCaptureContext,
    };
    const resultGuidance = new Function(...Object.keys(guidanceDependencies), `${transpiler.transformSync(guidanceSource)}; return resultGuidance;`)(...Object.values(guidanceDependencies));
    return { props, currentInference, resultGuidance };
  }

  test("non-inline ADT, record and list data report real membership refusals on their receiving edge", () => {
    withInterpretedCompiledArtifacts(() => {
      for (const value of [{ $tag: "Just", _0: 3 }, { name: "Rom", count: 3 }, [1, 2]]) {
        const f = fixture(value, { $ref: "String" });
        expect(checkScopedDataMembership({ $ref: "String" }, value, environment)).toEqual({ $tag: "Just", _0: false });
        expect(f.currentInference()?.outcome).toBeDefined();
        expect(f.resultGuidance()?.graphIssue).toBeTruthy();
        expect(f.props.node.value).toBe(value);
      }
    });
  }, 60_000);

  test("accepted rich data and undecided nominal data have no false broken edge", () => {
    withInterpretedCompiledArtifacts(() => {
      const record = { name: "Rom", count: 3 };
      const actual = inferAuthoringExpressionWithLiteralWitnesses({ kind: "literal", value: record }, environment);
      expect(actual.outcome.$tag).toBe("Solved");
      const accepted = fixture(record, actual.type);
      expect(accepted.currentInference()?.outcome).toBeDefined();
      expect(accepted.currentInference()?.outcome.$tag).not.toBe("Invalid");
      expect(accepted.resultGuidance()?.graphIssue).toBeUndefined();
      for (const value of [record, [1, 2]]) {
        const universal = fixture(value, Anything);
        expect(checkScopedDataMembership(Anything, value, environment)).toEqual({ $tag: "Just", _0: true });
        expect(universal.currentInference()?.outcome).toBeDefined();
        expect(universal.resultGuidance()?.graphIssue).toBeUndefined();
        const unknown = fixture(value, { $ref: "UnpublishedGraphType" });
        expect(checkScopedDataMembership({ $ref: "UnpublishedGraphType" }, value, environment)).toEqual({ $tag: "Nothing" });
        expect(unknown.currentInference()?.outcome.$tag).not.toBe("Invalid");
        expect(unknown.currentInference()?.outcome).toBeDefined();
        expect(unknown.resultGuidance()?.graphIssue).toBeUndefined();
      }
    });
  }, 60_000);

  test("an actual incomplete slot still waits for authored data", () => {
    const f = fixture(undefined, { $ref: "String" });
    expect(f.currentInference()).toBeUndefined();
    expect(f.resultGuidance()).toBeUndefined();
  });
});

const detectStructural = value => detectStructuralForm(value, strategy => strategy in EVALUATOR_STRATEGIES);
// B4 unit C: the Inspection source projection moved verbatim from Home into
// the shared text boundary that the page and a Local reader's worker run.
const textSource = (await Bun.file(new URL("./expression-runner/expression-text.ts", import.meta.url)).text()).replaceAll("\r\n", "\n");
const sourceProjectionStart = textSource.indexOf("function inspectionSourceExpression(");
const sourceProjection = textSource.slice(sourceProjectionStart, textSource.indexOf("/** `editor`: the recursive editor", sourceProjectionStart));
const projectSource = new Function("detectStructuralForm", `${transpiler.transformSync(sourceProjection)}; return inspectionSourceExpression;`)(detectStructural);
const sourceNamesStart = textSource.indexOf("function inspectionFunctionCodeName(");
const sourceNames = new Function("environmentForCatalog", `${transpiler.transformSync(textSource.slice(sourceNamesStart,
  textSource.indexOf("/** A read-only source projection", sourceNamesStart)))}; return inspectionFunctionCodeName;`);
const authoredStart = source.indexOf("function projectAuthoredExpression(");
const authoredProjection = new Function("expressionAt", `${transpiler.transformSync(source.slice(authoredStart,
  source.indexOf("function itemExpression(", authoredStart)))}; return projectAuthoredExpression;`)(expressionAt);
const removeStart = source.indexOf("  function removeItem(id: string)");
const removeSource = source.slice(removeStart, source.indexOf("  function duplicateItem(", removeStart));
const makeRemove = new Function("props", "persist", `${transpiler.transformSync(removeSource)}; return removeItem;`);
const view = (...ids: string[]) => ({ kind: "canvas", items: ids.map((id) => ({ id, x: 0, y: 0 })) });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("showcase saved-label compatibility", () => {
  const start = valuesSource.indexOf("  async function seedShowcase()");
  const body = valuesSource.slice(start, valuesSource.indexOf("  // List + index", start));
  const makeSeed = new Function("client", "sessionEpoch", "savedRaw", "KIND", "SEED_VALUES", "assertCurrentSession",
    "persistRepresentation", "slugify", "api", `${transpiler.transformSync(body)}; return seedShowcase;`);
  const example = { name: "reverse", previousName: "String · reverse", description: "Reverse some text", expr: { kind: "literal", value: "seed" } };
  function fixture(options = {}) {
    const rows = options.rows ?? [];
    const labels = options.labels ?? [];
    const calls = [];
    let epoch = 1;
    let failLabels = options.failLabels;
    const api = {
      savedQueryUpdate: async (id, payload) => {
        calls.push({ update: id, payload });
        if (options.failRename) throw Error("Offline");
        Object.assign(rows.find(row => row.id === id), payload);
        if (options.switchAccount) epoch++;
      },
      savedQueryCreate: async payload => {
        const row = { id: `new-${rows.length}`, ...payload };
        rows.push(row); calls.push({ create: payload }); return { query: row };
      },
    };
    const client = { epoch: 1, apiFetch: async path => {
      calls.push({ read: path });
      if (failLabels) throw Error("Metadata unavailable");
      return { dispatchInstances: labels };
    }, revalidate: key => { calls.push({ revalidate: key }); } };
    const seed = makeSeed(client, () => epoch, () => ({ queries: rows }), "expression", options.seeds ?? [example],
      captured => { if (captured !== epoch) throw Error("Changed account"); },
      async (typeName, id, methods, encoding, capturedClient) => {
        calls.push({ representation: { typeName, id, methods, encoding, capturedClient } });
        labels.find(row => (row.args ?? row.instance?.args)?.[0] === id).instance.methods = methods;
      }, name => name, api);
    return { seed, rows, labels, calls, client, allowMetadata: () => { failLabels = false; } };
  }
  test("an exact old name renames the existing id without replacing its slug, description or edited expression", async () => {
    const edited = { kind: "literal", value: "user edit" };
    const row = { id: "saved-id", name: example.previousName, slug: "original-slug", description: "My description", query: { kind: "expression", expr: edited } };
    const f = fixture({ rows: [row], labels: [{ args: [row.id], instance: { methods: { label: example.previousName, extra: "preserved" } } }] });
    await f.seed();
    expect(f.calls.find(call => call.update)).toEqual({ update: row.id, payload: { name: example.name } });
    expect(row.slug).toBe("original-slug");
    expect(row.description).toBe("My description");
    expect(row.query.expr).toBe(edited);
    expect(f.labels[0].instance.methods).toEqual({ label: example.name, extra: "preserved" });
    expect(f.calls.find(call => call.representation).representation.capturedClient).toBe(f.client);
    const writes = f.calls.filter(call => call.update || call.create || call.representation).length;
    await f.seed();
    expect(f.calls.filter(call => call.update || call.create || call.representation)).toHaveLength(writes);
    expect(f.rows).toHaveLength(1);
  });
  test("an existing current-name entry does not prevent renaming a separate legacy id or create another saved value", async () => {
    const currentExpr = { kind: "literal", value: "current edit" }, oldExpr = { kind: "literal", value: "old edit" };
    const f = fixture({ rows: [{ id: "current", name: example.name, query: { kind: "expression", expr: currentExpr } },
      { id: "old", name: example.previousName, query: { kind: "expression", expr: oldExpr } }] });
    await f.seed();
    expect(f.calls.filter(call => call.update || call.create)).toEqual([{ update: "old", payload: { name: example.name } }]);
    expect(f.rows.map(row => row.id)).toEqual(["current", "old"]);
    expect(f.rows.map(row => row.name)).toEqual([example.name, example.name]);
    expect(f.rows[0].query.expr).toBe(currentExpr);
    expect(f.rows[1].query.expr).toBe(oldExpr);
  });
  test("every duplicate legacy name is renamed in place and localized overrides retain custom text", async () => {
    const edits = [{ kind: "literal", value: "first edit" }, { kind: "literal", value: "second edit" }];
    const f = fixture({ rows: edits.map((expr, index) => ({ id: `saved-${index}`, name: example.previousName, query: { kind: "expression", expr } })),
      labels: [{ args: ["saved-0"], instance: { methods: { label: { en: example.previousName, fr: "Mon inversion" }, other: "kept" } } },
        { args: ["saved-1"], instance: { methods: { label: "My version" } } }] });
    await f.seed();
    expect(f.calls.filter(call => call.update).map(call => call.update)).toEqual(["saved-0", "saved-1"]);
    expect(f.calls.filter(call => call.create)).toEqual([]);
    expect(f.rows.map(row => row.id)).toEqual(["saved-0", "saved-1"]);
    for (let index = 0; index < edits.length; index++) expect(f.rows[index].query.expr).toBe(edits[index]);
    expect(f.labels[0].instance.methods).toEqual({ label: { en: example.name, fr: "Mon inversion" }, other: "kept" });
    expect(f.labels[1].instance.methods.label).toBe("My version");
    await f.seed();
    expect(f.calls.filter(call => call.update)).toHaveLength(2);
    expect(f.calls.filter(call => call.representation)).toHaveLength(1);
  });
  test("custom labels survive while exact legacy locale text changes in its existing representation", async () => {
    const f = fixture({ rows: [{ id: "saved-id", name: example.previousName, query: { kind: "expression" } }],
      labels: [{ args: ["saved-id"], instance: { methods: { label: "My reverse" } } }] });
    await f.seed();
    expect(f.labels[0].instance.methods.label).toBe("My reverse");
    expect(f.calls.filter(call => call.representation)).toEqual([]);
    f.labels[0].instance.methods.label = { en: example.previousName, fr: "Mon inversion" };
    await f.seed();
    expect(f.labels[0].instance.methods.label).toEqual({ en: example.name, fr: "Mon inversion" });
    f.labels[0].instance.methods.label = { en: "My inversion", fr: example.previousName, de: "Meine Umkehrung" };
    await f.seed();
    expect(f.labels[0].instance.methods.label).toEqual({ en: "My inversion", fr: example.name, de: "Meine Umkehrung" });
  });
  test("similar user names and another query kind are preserved rather than stripped or reclassified", async () => {
    const f = fixture({ rows: [{ id: "custom", name: "String · customized reverse", query: { kind: "expression" } },
      { id: "other", name: example.previousName, query: { kind: "data-search", search: "unchanged" } }] });
    await f.seed();
    expect(f.calls.filter(call => call.update)).toEqual([]);
    expect(f.calls.filter(call => call.create)).toHaveLength(1);
    expect(f.rows[0].name).toBe("String · customized reverse");
    expect(f.rows[1].query).toEqual({ kind: "data-search", search: "unchanged" });
    await f.seed();
    expect(f.calls.filter(call => call.create)).toHaveLength(1);
  });
  test("a failed rename never falls through into creating a duplicate", async () => {
    const f = fixture({ failRename: true, rows: [{ id: "saved-id", name: example.previousName, query: { kind: "expression" } }] });
    await f.seed();
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0].name).toBe(example.previousName);
    expect(f.calls.filter(call => call.create || call.representation)).toEqual([]);
  });
  test("a metadata-read failure keeps the same renamed row and recovers its old label on the next visit", async () => {
    const f = fixture({ failLabels: true, rows: [{ id: "saved-id", name: example.previousName, query: { kind: "expression" } }],
      labels: [{ instance: { args: ["saved-id"], methods: { label: example.previousName } } }] });
    await f.seed();
    expect(f.calls.filter(call => call.update)).toHaveLength(1);
    expect(f.calls.filter(call => call.create || call.representation)).toEqual([]);
    expect(f.calls.filter(call => call.revalidate)).toHaveLength(1);
    f.allowMetadata();
    await f.seed();
    expect(f.calls.filter(call => call.update)).toHaveLength(1);
    expect(f.labels[0].instance.methods.label).toBe(example.name);
  });
  test("an account switch after a rename stops subsequent seed and representation writes", async () => {
    const f = fixture({ switchAccount: true, rows: [{ id: "saved-id", name: example.previousName, query: { kind: "expression" } }],
      seeds: [example, { name: "new example", description: "New", expr: { kind: "literal", value: 0 } }] });
    await f.seed();
    expect(f.calls).toEqual([{ update: "saved-id", payload: { name: example.name } }]);
  });
});

describe("source-owned unsaved card markers", () => {
  const start = source.indexOf("  function itemIsUnsaved(");
  const markerSource = source.slice(start, source.indexOf("  const homeData =", start));
  const makeMarker = new Function("client", "scope", "childItemKey", "valueScope", "resolveExpr", "savedExprById",
    "readLocusCatalogReference", "homeAuthoringSession", "current", "pendingViewWrites", "findLocusItem", "rowById", "draftValueFingerprint",
    // B4 wave 4 lane H: a page reader (the Local branch reads its catalogue).
    "reader = undefined",
    `${transpiler.transformSync(markerSource)}; return itemIsUnsaved;`);
  const resolveStart = source.indexOf("function resolveExpr(");
  const resolve = new Function(`${transpiler.transformSync(source.slice(resolveStart,
    source.indexOf("function rendersPicture(", resolveStart)))}; return resolveExpr;`)();
  function fixture(options = {}) {
    const dirtyIds = new Set(options.dirty ?? []);
    return makeMarker(options.noDrafts ? {} : { drafts: { pending: () => dirtyIds.size, dirty: id => {
      if (id === undefined) throw Error("An unrelated card must never ask whether the whole source is dirty");
      return dirtyIds.has(id);
    } } }, () => { if (options.unreadyFocus) throw Error("The focus is not ready"); return options.scope ?? { kind: "root" }; }, id => id.startsWith("i#") ? Number(id.slice(2))
      : id.startsWith("f.") ? id.slice(2) : undefined,
    () => { if (options.unreadyScope) throw Error("The value scope is not ready"); return options.owner ? { ok: true, item: options.owner } : undefined; }, resolve,
    () => { if (options.unreadySaved) throw Error("Saved expressions are not ready"); return options.saved ?? new Map(); },
    readLocusCatalogReference, () => ({ registry: {
      getFunction: id => options.functions?.[id], getIdentifiedEntity: id => options.types?.[id],
    } }), () => { if (options.unreadyCurrent) throw Error("The current data is not ready"); return options.current; },
    () => options.pending ?? [], (items, id) => items.find(item => item.id === id),
    () => options.original, draftValueFingerprint);
  }
  const inline = (id, value = 42) => ({ id, source: { kind: "expr", expr: { kind: "literal", value } } });
  const ref = (id, savedId) => ({ id, source: { kind: "ref", ref: { kind: "savedExpr", id: savedId } } });
  test("an edited inline card is marked while its unchanged sibling and source root remain independent", () => {
    const marked = fixture({ dirty: ["root", "changed"] });
    expect(marked(inline("changed"))).toBe(true);
    expect(marked(inline("unchanged"))).toBe(false);
    expect(fixture({ noDrafts: true })(inline("changed"))).toBe(false);
  });
  test("every occurrence of an edited saved datum is marked without marking another datum", () => {
    const marked = fixture({ dirty: ["saved"] });
    expect(marked(ref("first", "saved"))).toBe(true);
    expect(marked(ref("second", "saved"))).toBe(true);
    expect(marked(ref("third", "other"))).toBe(false);
  });
  test("function and type references follow their admitted UUID-to-declaration identity", () => {
    const marked = fixture({ dirty: ["myFunction", "Person"], functions: { "function-uuid": { id: "myFunction" } },
      types: { "type-uuid": { id: "Person" } } });
    expect(marked(inline("fn-card", { $ref: "function-uuid" }))).toBe(true);
    expect(marked(inline("type-card", { $ref: "type-uuid" }))).toBe(true);
    expect(marked(inline("unrelated-type", { $ref: "Other" }))).toBe(false);
  });
  test("synthetic focused children inherit their authored datum rather than their temporary index", () => {
    const marked = fixture({ scope: { kind: "value" }, owner: ref("container", "saved"), dirty: ["saved"] });
    expect(marked(inline("i#0"))).toBe(true);
    expect(marked(inline("f.name"))).toBe(true);
    expect(marked(inline("$self"))).toBe(true);
    expect(marked(inline("unrelated-card"))).toBe(false);
  });
  test("an unchanged computed caller is not marked just because its function's definition changed", () => {
    const marked = fixture({ dirty: ["edited-function"] });
    expect(marked({ id: "result", source: { kind: "expr", expr: { kind: "call", fnId: "edited-function", args: [] } } })).toBe(false);
  });
  test("a debounced list edit marks only changed cards before the existing queue stages it", () => {
    const first = inline("first", 1), changed = inline("first", 2), sibling = inline("sibling", 3);
    const marked = fixture({ current: { id: "list", view: { items: [changed, sibling] } },
      original: { id: "list", view: { items: [first, sibling] } }, pending: [{ id: "list" }] });
    expect(marked(changed)).toBe(true);
    expect(marked(sibling)).toBe(false);
  });
  test("a known clean source returns immediately even when synthetic scope and data reads are not ready", () => {
    const marked = fixture({ scope: { kind: "value" }, unreadyFocus: true, unreadyScope: true, unreadyCurrent: true, unreadySaved: true });
    expect(marked(inline("$self"))).toBe(false);
    expect(marked(inline("i#0"))).toBe(false);
  });
  test("known changed occurrence and saved-reference IDs appear before an unready async data graph", () => {
    const marked = fixture({ dirty: ["changed", "saved"], unreadyFocus: true, unreadyCurrent: true, unreadySaved: true });
    expect(marked(inline("changed"))).toBe(true);
    expect(marked(ref("pin", "saved"))).toBe(true);
  });
  test("an unrelated pending datum does not make a card wait for current data when no pane write needs comparison", () => {
    const marked = fixture({ dirty: ["another-datum"], unreadyCurrent: true });
    expect(marked(inline("unchanged"))).toBe(false);
  });
});

describe("paused account creation appearance preflight", () => {
  const start = source.indexOf("  function assertAppearanceDrafts(");
  const make = new Function("reader", "client", "synchronization", `${transpiler.transformSync(source.slice(start,
    source.indexOf("  return {", start)))}; return assertAppearanceDrafts;`);
  test("requested account appearance rules refuse before source creation while empty drafts keep data and code creation available", () => {
    const check = make({ kind: "account" }, { drafts: { pending: () => 0 } }, { enabledNow: () => false });
    expect(() => check({ Labelable: { label: "My data" } })).toThrow("Turn synchronization on");
    expect(() => check({ Iconable: {} })).toThrow("create in Local");
    expect(() => check({})).not.toThrow();
    // A new type's save is lib/type-draft-save.ts, shared by the type card and NewTypeModal.
    const typeDraftSave = draftSaveSource.slice(draftSaveSource.indexOf("  async function save()"));
    expect(typeDraftSave.indexOf("host.assertAppearanceDrafts(reps())")).toBeGreaterThan(0);
    expect(typeDraftSave.indexOf("host.assertAppearanceDrafts(reps())")).toBeLessThan(typeDraftSave.indexOf("await host.saveDefinition("));
    const typeModal = source.slice(source.indexOf("function NewTypeModal("), source.indexOf("function createHomeTypeDraft("));
    expect(typeModal).toContain("await draft.save()");
    expect(typeModal).not.toContain("saveDefinitionWithRepresentations(");
    for (const component of ["NewValueModal", "NewFunctionModal"]) {
      const begin = source.indexOf(`function ${component}(`);
      const save = source.indexOf("  async function save()", begin);
      const guard = source.indexOf("assertAppearanceDrafts(reps())", save);
      // Definitions are written through saveDefinitionWithRepresentations since 61391420.
      const mutation = source.indexOf(component === "NewValueModal" ? "await saveClient.api.savedQueryUpdate" : "await saveDefinitionWithRepresentations(", save);
      expect(guard).toBeGreaterThan(save);
      expect(guard).toBeLessThan(mutation);
    }
  });
  test("ordinary synchronous account creation and This tab retain the same universal appearance editor", () => {
    const rules = { Iconable: { icon: "star" } };
    expect(() => make({ kind: "account" }, { drafts: { pending: () => 0 } }, { enabledNow: () => true })(rules)).not.toThrow();
    expect(() => make({ kind: "local" }, {}, { enabledNow: () => false })(rules)).not.toThrow();
  });
});

describe("automatic synchronization save honesty", () => {
  test("an admitted account edit with failed automatic persistence keeps Apply wording until its journal is saved", () => {
    const start = source.indexOf("  function temporaryEdits(");
    const make = new Function("reader", "client", "synchronization", `${transpiler.transformSync(source.slice(start,
      source.indexOf("  function assertAppearanceDrafts", start)))}; return temporaryEdits;`);
    let pending = 0;
    const temporary = make({ kind: "account" }, { drafts: { pending: () => pending } }, { enabled: () => true });
    expect(temporary()).toBe(false);
    pending = 1;
    expect(temporary()).toBe(true);
    pending = 0;
    expect(temporary()).toBe(false);
  });
});

describe("captured source ownership before writes", () => {
  const start = source.indexOf("  const captureSourceTicket =");
  const makeTickets = new Function("client", `${transpiler.transformSync(source.slice(start,
    source.indexOf("  const representationString", start)))}; return { captureSourceTicket, assertSourceTicket };`);
  function fixture() {
    let current = {};
    const tickets = makeTickets({ drafts: { source: () => current } });
    return { ...tickets, retire: () => { current = undefined; } };
  }
  test("a queued list command cannot reinterpret its captured virtual14 as foreign raw server14", async () => {
    const begin = source.indexOf("  function writeLocusList(");
    const make = new Function("root", "enqueueRootWrite", "api", "rebasedRevision", "acknowledgeRootRevision", "captureSourceTicket", "assertSourceTicket",
      `${transpiler.transformSync(source.slice(begin, source.indexOf("  const [draftRevision", begin)))}; return writeLocusList;`);
    const f = fixture(), gate = deferred();
    let writes = 0;
    const write = make(() => ({ id: "account" }), async work => { await gate.promise; return work(); }, {
      locusViewUpdate: async (_id, patch) => { expect(patch.expectedRootRevision).toBe(14); writes++; return { locusView: { rootRevision: 15 } }; },
    }, (_account, revision) => revision, () => {}, f.captureSourceTicket, f.assertSourceTicket);
    const pending = write("list", { view: view("my edit") }, 14);
    f.retire();
    gate.resolve();
    await expect(pending).rejects.toThrow("data source changed while editing");
    expect(writes).toBe(0);
  });
  test("a value-scope snapshot refuses a retired source before reconstruction can call its writer at the coincident revision", async () => {
    const begin = source.indexOf("  async function writeValueScopeExpression(");
    const make = new Function("assertCurrentSession", "scopeKey", "scope", "current", "root", "homeData", "transferSession", "draftSaveIssue",
      "savedExprById", "evaluateAuthoringExpression", "assertSourceTicket", `${transpiler.transformSync(source.slice(begin,
        source.indexOf("  /** The names the breadcrumb", begin)))}; return writeValueScopeExpression;`);
    const f = fixture();
    const state = { epoch: 1, scopeIdentity: "same", rootRevision: 14, row: { id: "root" }, item: { id: "card" },
      sourceTicket: f.captureSourceTicket() };
    let writes = 0;
    const write = make(() => {}, () => "same", () => ({}), () => ({ id: "root" }), () => ({ revision: 14 }), {
      type: () => undefined, replace: async () => { writes++; },
    }, () => ({}), () => undefined, () => new Map(), () => ({}), f.assertSourceTicket);
    f.retire();
    await expect(write(state, { kind: "literal", value: 2 })).rejects.toThrow("data source changed while editing");
    expect(writes).toBe(0);
  });
});

describe("saved-data browser edit baselines", () => {
  test("opening the universal modal captures the full original query before another lens changes it", () => {
    const start = source.indexOf("  function openItemEditor(");
    const make = new Function("savedQueryForItem", "setEditing", "cloneDraftValue", "rootSourceTicket = () => ({ origin: undefined })", `${transpiler.transformSync(source.slice(start,
      source.indexOf("  const [calling", start)))}; return openItemEditor;`);
    const original = { kind: "expression", expr: { kind: "literal", value: 1 }, valueType: { $ref: "Number" }, custom: "retained" };
    let opened;
    const open = make(() => original, state => { opened = state; }, cloneDraftValue);
    open({ item: { id: "card" }, homeId: "root" });
    original.expr.value = 2;
    expect(opened.expectedSavedQuery).toEqual({ kind: "expression", expr: { kind: "literal", value: 1 },
      valueType: { $ref: "Number" }, custom: "retained" });
  });
  test("editing a focused field retains its read's full saved-query baseline through reconstruction", async () => {
    const start = source.indexOf("  async function writeValueScopeExpression(");
    const make = new Function("assertCurrentSession", "scopeKey", "scope", "current", "root", "homeData", "transferSession",
      "draftSaveIssue", "savedExprById", "evaluateAuthoringExpression", "assertSourceTicket = () => {}", `${transpiler.transformSync(source.slice(start,
      source.indexOf("  /** The names the breadcrumb", start)))}; return writeValueScopeExpression;`);
    const calls = [];
    const original = { kind: "expression", expr: { kind: "literal", value: [1] }, valueType: { $ref: "Numbers" } };
    const state = { epoch: 1, scopeIdentity: "here", row: { id: "root" }, rootRevision: 4,
      item: { id: "saved-card" }, sourceQuery: original };
    const write = make(() => {}, () => "here", () => ({}), () => ({ id: "root" }), () => ({ revision: 4 }),
      { type: () => undefined, replace: async (...args) => { calls.push(args); } }, () => ({}), () => undefined, () => new Map(), () => ({}));
    const edited = { kind: "literal", value: [2] };
    await write(state, edited);
    expect(calls[0][1]).toBe(edited);
    expect(calls[0][7]).toBe(original);
    const olderEditor = { ...original, expr: { kind: "literal", value: [0] } };
    await write(state, edited, undefined, olderEditor);
    expect(calls[1][7]).toBe(olderEditor);
  });
});

describe("lens Value, Expression and Code panels", () => {
  const helpers = panelsSource.slice(panelsSource.indexOf("export type DataInspectionMode"), panelsSource.indexOf("export function DataInspectionControls"));
  const { visible, toggle } = new Function(`${transpiler.transformSync(helpers.replaceAll("export ", ""))}; return {
    visible: dataInspectionPanelVisible, toggle: toggleDataInspectionPanel };`)();
  const panels = ["data", "expression", "code"];
  const expected = { data: ["data"], expression: ["expression"], both: ["data", "expression"], code: ["code"],
    "data-code": ["data", "code"], "expression-code": ["expression", "code"], all: panels };

  test("the original identifiers retain their panels and all seven nonempty combinations are distinct", () => {
    for (const [mode, members] of Object.entries(expected)) expect(panels.filter(panel => visible(mode, panel))).toEqual(members);
  });
  test("each option toggles independently without changing the two other options", () => {
    for (const [mode, members] of Object.entries(expected)) for (const panel of panels) {
      if (members.length === 1 && members.includes(panel)) continue;
      const next = toggle(mode, panel);
      expect(visible(next, panel)).toBe(!visible(mode, panel));
      for (const other of panels.filter(candidate => candidate !== panel)) expect(visible(next, other)).toBe(visible(mode, other));
    }
  });
  test("switching off the sole active option retains a visible panel and the original Value/Expression fallback", () => {
    expect(toggle("data", "data")).toBe("expression");
    expect(toggle("expression", "expression")).toBe("data");
    expect(toggle("code", "code")).toBe("data");
  });
  test("Suggestions and Dependencies surround the same independently visible legacy panels", () => {
    const allPanels = ["suggestions", "data", "expression", "code", "dependencies"];
    let mode = toggle(toggle("all", "suggestions"), "dependencies");
    expect(allPanels.filter(panel => visible(mode, panel))).toEqual(allPanels);
    mode = toggle(toggle(mode, "suggestions"), "dependencies");
    expect(mode).toBe("all");
    expect(toggle({ panels: ["suggestions"] }, "suggestions")).toBe("data");
    expect(toggle({ panels: ["dependencies"] }, "dependencies")).toBe("data");
  });
});

describe("scoped generic function type icons", () => {
  const start = source.indexOf("  const entry = (type:", source.indexOf("function FunctionTypeBody("));
  const entrySource = source.slice(start, source.indexOf("  const inputs =", start));
  const makeEntry = new Function("props", "homeAuthoringSession", "knownTypeIconName", "resolveEffect", "projectAuthoringScheme", "typeCode",
    "locale", "getLabel", "getCodeName", "LUCIDE_BY_NAME", "typedReadTypeOwnIcon", "reader", "typedReadTypePresentation", "peelResultForAuthoring",
    "presentedTypeTarget", `${transpiler.transformSync(entrySource)}; return entry;`);
  test("anonymous arrow inputs and outputs use the captured Iconable frame while nominal misses remain authoritative", () => {
    const calls = [];
    const frame = { _specRegistry: { id: "reader-registry" } };
    const entry = makeEntry({}, () => ({ evaluateContext: frame }), id => id === "Number" ? "hash" : undefined,
      (captured, registry, typeName, witness) => {
        calls.push({ captured, registry, typeName, witness });
        return { methods: { icon: "function" } };
      }, projectAuthoringScheme, typeCode, value => value, () => undefined, () => undefined, { function: true, hash: true }, () => undefined, undefined,
      // The own-icon target is the shared presentedTypeTarget (type-icon-presentation.ts).
      type => ({ label: typeCode(type) }), () => undefined, presentedTypeTarget);
    const input = { $arrow: { params: [{ name: "a", type: { $ref: "Number" } }], returns: { $ref: "Number" } } };
    const output = { $arrow: { params: [{ name: "b", type: { $ref: "String" } }], returns: { $ref: "String" } } };
    expect(entry(input, [], "f").icon).toBe("function");
    expect(entry(output, []).icon).toBe("function");
    expect(calls).toEqual([input, output].map(witness => ({ captured: frame, registry: frame._specRegistry, typeName: "Iconable", witness })));
    expect(entry({ $ref: "Number" }, []).icon).toBe("hash");
    expect(entry({ $ref: "AccountTypeWithNoIcon" }, []).icon).toBeUndefined();
    expect(calls).toHaveLength(2);
  });
  test("function heading type glyphs honor the active frame override and retain a generic nominal miss", () => {
    const headingStart = source.indexOf("    const frame = session.evaluateContext;", source.indexOf("function useDataTypePresentation("));
    const headingSource = source.slice(headingStart, source.indexOf("    const detailLabel =", headingStart));
    const icon = new Function("props", "session", "displayType", "type", "nominal", "kind", "shape", "reader", "resolveEffect",
      "LUCIDE_BY_NAME", "typeIconForPresentation", "TYPE_KIND_LABELS", `${transpiler.transformSync(headingSource)}; return icon;`);
    const type = { $arrow: { params: [], returns: { $ref: "Number" } } };
    const publicFrame = { _specRegistry: { id: "public" }, icon: "function" };
    const accountFrame = { _specRegistry: { id: "account" }, icon: "moon" };
    const calls = [];
    const resolve = (frame, registry, typeName, witness) => {
      calls.push({ frame, registry, typeName, witness });
      return { methods: { icon: frame.icon } };
    };
    const show = (frame, identity, reader) => icon({}, { evaluateContext: frame,
      registry: { getIdentifiedEntity: id => ({ id }) } }, identity ? { $ref: identity } : type, type, identity,
      identity ? detectTypeKind({ $ref: identity }) : "arrow", "Function", reader,
      resolve, { function: true, moon: true, "type-set": true }, typeIconForPresentation, TYPE_KIND_LABELS);
    expect(show(publicFrame)).toBe("function");
    expect(show(accountFrame)).toBe("moon");
    expect(calls).toEqual([publicFrame, accountFrame].map(frame => ({ frame, registry: frame._specRegistry, typeName: "Iconable", witness: type })));
    expect(show(accountFrame, "AccountArrow", { representation: () => undefined })).toBe("type-set");
    expect(calls).toHaveLength(2);
    expect(show({ _specRegistry: undefined })).toBe("function");
  });
});

describe("lens shared visual and code draft", () => {
  const start = source.indexOf("function createInspectionExpressionState(");
  const makeState = new Function("createSignal", "untrack", `${transpiler.transformSync(source.slice(start,
    source.indexOf("function inspectionFunctionEntry(", start)))}; return createInspectionExpressionState;`)
    (initial => { let value = initial; return [() => value, next => { value = next; }]; }, fn => fn());
  const presentationOwner = source.indexOf("function InspectionExpression(");
  const presentationStart = source.indexOf("  const showingCode = ", presentationOwner);
  const presentationEnd = source.indexOf("  const [inspectingType", presentationStart);
  if (presentationOwner < 0 || presentationStart < presentationOwner || presentationEnd <= presentationStart)
    throw new Error("Inspection presentation boundary changed");
  const visualStart = inspectionControllerSource.indexOf("  function changeDraft(");
  const visualEnd = inspectionControllerSource.indexOf("  function cancelChanges(", visualStart);
  if (visualStart < 0 || visualEnd <= visualStart) throw new Error("Inspection visual draft boundary changed");
  const surfaceSource = inspectionPendingSource + inspectionControllerSource.slice(visualStart, visualEnd)
    + source.slice(presentationStart, presentationEnd);
  const makeSurface = new Function("props", "state", "localTyping = undefined",
    `${transpiler.transformSync(surfaceSource)}; return { showingCode, setDraft: changeDraft, draft: state.draft };`);

  test("fixed visual and code panels remain distinct when the legacy authoring switch changes", () => {
    const state = makeState(() => true);
    const visual = makeSurface({ presentation: "visual" }, state);
    const code = makeSurface({ presentation: "code" }, state);
    const authoring = makeSurface({}, state);
    expect([visual.showingCode(), code.showingCode(), authoring.showingCode()]).toEqual([false, true, true]);
    state.setCode(false);
    expect([visual.showingCode(), code.showingCode(), authoring.showingCode()]).toEqual([false, true, false]);
  });
  test("an edited visual draft survives closing and reopening Code while a new focused subject starts clean", () => {
    const state = makeState();
    const visual = makeSurface({ presentation: "visual" }, state);
    const changed = { kind: "param", name: "x" };
    visual.setDraft(changed);
    expect(makeSurface({ presentation: "code" }, state).draft()).toBe(changed);
    state.setSignaturePresentation("parameters");
    expect(makeSurface({ presentation: "code" }, state).draft()).toBe(changed);
    expect(state.signaturePresentation()).toBe("parameters");
    expect(makeState().draft()).toBeUndefined();
  });
});

describe("definition saves without no-op occurrence writes", () => {
  test("a mixed edit inside saved list data forwards its bundle through the existing scoped reconstruction", async () => {
    const nestedStart = source.indexOf("    async replace(item:");
    const nestedEnd = source.indexOf("      if (edit) {", nestedStart);
    const head = source.slice(nestedStart, nestedEnd).replace("async replace(", "async function replace(");
    const make = new Function("sessionEpoch", "root", "scope", "childItemKey", "valueScope", "writeValueScopeExpression",
      "appendAll", "replaceExpressionAt", "expressionEditOptions", "rootSourceTicket = () => ({ origin: undefined })", "assertSourceTicket = () => {}",
      `${transpiler.transformSync(head + "\n}")}; return replace;`);
    const original = { kind: "literal", value: { __list: [{ kind: "literal", value: { $ref: "old" } }, { kind: "literal", value: "sibling" }] } };
    const state = { ok: true, sourceExpression: original, rootRevision: 4 };
    const writes = [];
    const replace = make(() => 1, () => ({ canEdit: true, revision: 4 }),
      () => ({ kind: "value", viewId: "root", itemId: "saved-list", path: [] }),
      () => 0, () => state, async (...args) => { writes.push(args); }, () => { throw Error("Not an append"); },
      replaceExpressionAt, () => ({}));
    const expr = { kind: "literal", value: { $ref: "changed" } };
    const bundle = { ownerMutations: [] };
    await replace({ id: "i#0" }, expr, undefined, undefined, undefined, 4, bundle);
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe(state);
    expect(expressionAt(writes[0][1], [0])).toBe(expr);
    expect(expressionAt(writes[0][1], [1])).toBe(original.value.__list[1]);
    expect(writes[0][2]).toBe(bundle);
  });
  const start = source.indexOf("  async function save()", source.indexOf("function EditModalContent("));
  const end = source.indexOf("  return (", start);
  const ownerStart = source.indexOf("function functionDefinitionOwner(");
  const owner = new Function(`${transpiler.transformSync(source.slice(ownerStart,
    source.indexOf("function inspectionFunctionEntry(", ownerStart)))}; return functionDefinitionOwner;`)();
  const makeSave = new Function("props", "draft", "cardReps", "initial", "cloneDraftValue", "draftValueFingerprint", "setSaving", "setSaveError",
    "sourceConflict", "fieldFacets", "desiredFieldFacetValues", "fieldFacetReplacementIds", "fieldResurrections", "functionPin", "functionBaseline",
    "bodyDraft", "arrowDraft", "fieldFacetsDirty", "functionDefinitionChanged", "persistedFunctionRow", "toLogic", "functionAuthoringSession",
    "functionDefinitionOwner", "entityPin", "entityDefinition", "typeDraft", "typeDraftDirty", "typeDefinitionChanged", "api", "revalidate",
    "reloadUserRegistries", "getLocusRoot", "close", "reader", "client",
    "readLocusCatalogReference", "resolveCatalogReference", "homeAuthoringSession", "draftSaveIssue", "functionBodySaveIssue", "logicToExprNode",
    "sourceTicket = { origin: undefined }", "assertSourceTicket = () => {}",
    "functionGenericIssue = () => undefined", "typeGenericIssue = () => undefined", "functionSignatureDirty = () => false",
    "functionSignatureShapeIssue = () => undefined", "functionDeclaration = () => undefined", "functionRequirements = () => undefined",
    "functionPreview = () => undefined", "functionResultMode = () => 'explicit'", "typeBaseline = () => undefined",
    "typeParamsDraft = () => []", "typeGenericEditable = () => false", "typeOwnedScheme = () => undefined",
    // Since 60a61cfe save() captures its intent through Solid's latest() and
    // routes Local checks through prepared workers; account readers use none.
    "latest = read => read()", "concreteAuthoringSession = session => session",
    // A ready Local preview job; its worker check runs the same body checker.
    // B4 unit D item 2: the worker lowers the draft body in the same request
    // (`body`); this stand-in lowers it with the fixture codec.
    "localSavedFunctionPreviewJob = () => ({ request: { handle: 'prepared-reader', controller: new AbortController() }, promise: Promise.resolve(undefined), body: Promise.resolve(toLogic(bodyDraft(), undefined, functionAuthoringSession())) })",
    "assertLocalSavedFunctionPreview = () => {}", "savedExpressionDeclaration = () => undefined",
    "runPreparedReaderWorker = async (_handle, request) => ({ issue: functionBodySaveIssue(request.node, request.definition, functionAuthoringSession().environment, { evaluateContext: functionAuthoringSession().evaluateContext }) })",
    // B4 slice 2: no nested value check of this editor is pending.
    "localDraftChecksPending = () => false", "draftScope = {}",
    // B4 slice 1: a Local reader's item-reference Save asks its worker, which
    // runs the same draftSaveIssue with the page's inputs.
    "localExpressionSaveIssue = async (node, admission) => draftSaveIssue(node, homeAuthoringSession().environment, { expectedType: admission.expectedType, registry: homeAuthoringSession().registry, evaluateContext: homeAuthoringSession().evaluateContext, resolveSavedExpr: id => admission.saved?.get(id) })",
    "LOCAL_SAVE_DRAFT_CHANGED = 'The draft changed while it was being checked. Save again.'",
    // B4 wave 4 lane H: no Local signature guard (page readers here).
    "localFunctionSignature = undefined", "localTypeSignature = undefined",
    `let dismissed = false, saveInFlight = false; ${transpiler.transformSync(source.slice(start, end))}; return save;`);
  function fixture(options = {}) {
    let currentSource = options.sourceOrigin;
    const sourceTicket = { origin: currentSource };
    const expression = options.originalExpression ?? (options.savedData ? { kind: "literal", value: 20 }
      : { kind: "literal", value: { $ref: options.type ? "local-type" : "local-function" } });
    let authored = options.originalExpression ? expression : options.savedData ? { kind: "literal", value: options.value ?? 20 } : expression;
    const fn = { id: "local-function", params: [], returns: { $ref: "String" }, body: "hello" };
    const arrow = { $arrow: { params: [], returns: fn.returns } };
    const originalType = { $record: { fields: [] } };
    const item = options.savedData ? { id: "occurrence", source: { kind: "ref", ref: { kind: "savedExpr", id: "saved" } }, valueType: options.expectedType ?? { $ref: "Number" } }
      : { id: "occurrence", source: { kind: "expr", expr: expression } };
    const bundles = [], occurrences = [], errors = [];
    let committed = false, closed = 0, draftEvaluations = 0;
    const environment = options.environment ?? createAuthoringEnvironment({ types: [], functions: [], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const save = makeSave({ item, homeId: "this-tab-root", savedExprById: new Map([["saved", expression]]), onSaveItem: async (...args) => {
      if (options.savedData) { occurrences.push(args); committed = true; return; }
      if (options.atomic) {
        if (options.atomicRefusal) throw Error("External source revision changed");
        bundles.push(args[2]);
        if (args[3]) occurrences.push(args);
        committed = true;
        return;
      }
      occurrences.push(args); throw Error("Stale occurrence revision");
    } }, () => authored, () => options.changedCard ? { Iconable: { icon: "star" } } : {}, () => expression,
    cloneDraftValue, draftValueFingerprint, () => {}, error => { if (error) errors.push(error); },
    () => options.externalDefinition ? "The definition changed while editing" : undefined,
    () => ({}), () => [], () => [], { fieldIds: () => [] },
    () => options.type || options.savedData ? null : { id: fn.id, name: fn.id, fn },
    () => options.type || options.savedData ? null : { id: fn.id, fn, body: { kind: "literal", value: "hello" }, arrow },
    () => options.type || options.savedData ? null : options.body ?? { kind: "literal", value: "hi" },
    () => options.type || options.savedData ? null : options.arrow ?? arrow,
    () => false, () => committed, () => ({ id: fn.id, name: fn.id }), body => exprNodeToLogic(body), () => ({ environment, evaluateContext: {} }), owner,
    () => options.type ? { id: "local-type", name: "local-type", type: originalType } : null,
    () => options.type ? { kind: "persisted", row: { id: "local-type", name: "local-type", type: originalType } } : null,
    () => options.type ? { $record: { fields: [{ name: "count", type: { $ref: "Number" } }] } } : null,
    () => !!options.type, () => committed,
    { definitionBundleSave: async bundle => { bundles.push(bundle); committed = true; } }, () => {}, async () => {},
    async () => { throw Error("No unchanged occurrence should acquire another root snapshot"); }, () => { closed++; }, options.reader ?? { kind: "local" },
    options.atomic ? { editDefinitionAndData: () => {} } : {},
    readLocusCatalogReference, () => undefined, () => ({ environment,
      evaluateContext: {
        getFunction: name => name === "save-probe:value" ? environment.getFunctionEntry?.(name) : undefined,
        natives: { "save-probe:value": () => { draftEvaluations++; throw Error("Do not evaluate a draft to check its type"); } },
      } }), draftSaveIssue, functionBodySaveIssue, logicToExprNode,
    sourceTicket, ticket => { if (ticket.origin !== currentSource) throw Error("The data source changed while editing. Your draft is kept here."); });
    return { save, bundles, occurrences, errors, closed: () => closed, draftEvaluations: () => draftEvaluations,
      setSource: next => { currentSource = next; },
      changeDraft: value => { authored = { kind: "literal", value }; }, changeExpression: value => { authored = value; } };
  }
  test("saved Number editing refuses String before writing, then permits a corrected Number through the same boundary", async () => {
    const f = fixture({ savedData: true, value: "wrong" });
    await f.save();
    expect(f.errors[0]).toContain("Finish with Number");
    expect(f.occurrences).toEqual([]);
    expect(f.bundles).toEqual([]);
    expect(f.closed()).toBe(0);
    f.changeDraft(30);
    await f.save();
    expect(f.occurrences).toHaveLength(1);
    expect(f.occurrences[0][1]).toEqual({ kind: "literal", value: 30 });
    expect(f.closed()).toBe(1);
  });
  test("saving a checked callable retains its source without executing the draft", async () => {
    const number = { $ref: "Number" };
    const callable = { id: "save-probe:value", codeName: "value", label: "Value", description: "",
      kind: "function", params: [], returns: number,
      scheme: { quantified: [], body: { $arrow: { params: [], returns: number } } }, signatureOutcome: { $tag: "Solved" } };
    const environment = createAuthoringEnvironment({ types: [], functions: [callable], capabilities: [],
      catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const expression = { kind: "call", fnId: callable.id, args: [] };
    const f = fixture({ savedData: true, originalExpression: expression, expectedType: number, environment });
    await f.save();
    expect(f.errors).toEqual([]);
    expect(f.draftEvaluations()).toBe(0);
    expect(f.occurrences).toHaveLength(1);
    expect(f.occurrences[0][1]).toEqual(expression);
  });
  test("typed data projects visually without changing raw no-op saves, and a first field edit uses the existing save boundary", async () => {
    const type = { $ref: "PublicPerson" };
    const text = { $ref: "String" };
    const fields = [
      { name: "name", type: text, label: Nothing, ui: Nothing, meta: {} },
      { name: "biography", type: Maybe(text), label: Nothing, ui: Nothing, meta: {} },
      { name: "socialLinks", type: List(text), label: Nothing, ui: Nothing, meta: {} },
    ].map((field, index) => ({ ...field, key: { $tag: "PositionalField", index } }));
    const target = "@ctor/test/PublicPerson/PublicPerson";
    const ctor = { id: "PublicPerson", targetId: target, codeName: "PublicPerson", label: "Person", description: "",
      kind: "constructor", parentEntity: "PublicPerson", parentModule: "test", params: fields, returns: type,
      scheme: { quantified: [], body: { $arrow: { params: fields, returns: type } } }, signatureOutcome: { $tag: "Solved" } };
    const environment = createAuthoringEnvironment({
      types: [{ id: "person", entityId: "PublicPerson", name: "Person", description: "", category: "entity", type: { $record: { fields } } }],
      functions: [ctor, { ...ctor, id: "Nothing", targetId: "@ctor/test/Maybe/Nothing", codeName: "Nothing", parentEntity: "Maybe",
        params: [], returns: Maybe(text), scheme: { quantified: [], body: { $arrow: { params: [], returns: Maybe(text) } } } }],
      capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
    });
    const raw = Object.freeze({ $tag: "PublicPerson", name: "Rom", biography: Object.freeze({ $tag: "Nothing" }), socialLinks: Object.freeze([]) });
    const original = { kind: "literal", value: raw };
    let authored = original;
    const projectionStart = source.indexOf("  const visualDraft = createMemo(", source.indexOf("function EditModalContent("));
    const project = new Function("createMemo", "draft", "props", "detectStructuralForm", "expressionForLiteralValue", "homeAuthoringSession",
      `${transpiler.transformSync(source.slice(projectionStart, source.indexOf("  const [savedBaseline", projectionStart)))}; return visualDraft;`)(
      compute => compute, () => authored, { item: { valueType: type } }, detectStructural, expressionForLiteralValue, () => ({ environment }));
    const displayed = project();
    expect(displayed.value.__construct.tag).toBe(target);
    expect(authored).toBe(original);
    expect(raw.name).toBe("Rom");
    const noOp = fixture({ savedData: true, originalExpression: original, expectedType: type, environment });
    await noOp.save();
    expect(noOp.errors).toEqual([]);
    expect(noOp.occurrences[0][1]).toEqual(original);
    expect(draftValueFingerprint(noOp.occurrences[0][1])).toBe(draftValueFingerprint(original));
    authored = replaceExpressionAt(displayed, ["name"], { kind: "literal", value: "Rom · edited" });
    const changed = fixture({ savedData: true, originalExpression: original, expectedType: type, environment });
    changed.changeExpression(authored);
    await changed.save();
    expect(changed.errors).toEqual([]);
    expect(changed.occurrences).toHaveLength(1);
    expect(expressionAt(changed.occurrences[0][1], ["name"])).toEqual({ kind: "literal", value: "Rom · edited" });
    expect(raw.name).toBe("Rom");
    expect(changed.closed()).toBe(1);
    const extra = { kind: "literal", value: { ...raw, extra: "Preserve unsupported source" } };
    authored = extra;
    expect(project()).toEqual(extra);
  });
  // A Local reader commits a function through editDefinitionAndData (60a61cfe);
  // the separate definition-bundle save below is the account reader's path.
  test("editing a referenced function's body commits hi and closes without replacing its unchanged pin", async () => {
    const f = fixture({ reader: { kind: "account" } });
    await f.save();
    expect(f.errors).toEqual([]);
    expect(f.bundles[0].ownerMutations[0].owner.definition.body).toBe("hi");
    expect(f.occurrences).toEqual([]);
    expect(f.errors).toEqual([]);
    expect(f.closed()).toBe(1);
  });
  test("function body and return edits refuse incompatible or incomplete definitions before any write", async () => {
    for (const options of [
      { body: { kind: "literal", value: 0 } },
      { body: { kind: "literal", value: undefined } },
      { arrow: { $arrow: { params: [], returns: { $ref: "Number" } } } },
    ]) {
      const f = fixture(options);
      await f.save();
      expect(f.errors).toHaveLength(1);
      expect(f.bundles).toEqual([]);
      expect(f.occurrences).toEqual([]);
      expect(f.closed()).toBe(0);
    }
  });
  test("editing a referenced type also skips an unchanged occurrence transaction", async () => {
    const f = fixture({ type: true });
    await f.save();
    expect(f.errors).toEqual([]);
    expect(f.bundles[0].ownerMutations[0].owner.definition.type.$record.fields[0].name).toBe("count");
    expect(f.occurrences).toEqual([]);
    expect(f.errors).toEqual([]);
    expect(f.closed()).toBe(1);
  });
  test("an actual card override still reaches the existing occurrence writer and keeps its conflict", async () => {
    const f = fixture({ changedCard: true, reader: { kind: "account" } });
    await f.save();
    expect(f.occurrences).toHaveLength(1);
    expect(f.occurrences[0][0].representations).toEqual({ Iconable: { icon: "star" } });
    expect(f.errors).toEqual(["Stale occurrence revision"]);
    expect(f.closed()).toBe(0);
  });
  test("an external definition change still refuses before either write", async () => {
    const f = fixture({ externalDefinition: true });
    await f.save();
    expect(f.bundles).toEqual([]);
    expect(f.occurrences).toEqual([]);
    expect(f.errors).toEqual(["The definition changed while editing"]);
  });
  test("a modal opened on a retired source keeps its draft and refuses before any definition or occurrence write", async () => {
    const f = fixture({ sourceOrigin: {}, atomic: true, changedCard: true });
    f.setSource(undefined);
    await f.save();
    expect(f.errors[0]).toContain("data source changed while editing");
    expect(f.bundles).toEqual([]);
    expect(f.occurrences).toEqual([]);
    expect(f.closed()).toBe(0);
  });
  test("a local mixed body and card edit delegates both changes together before any separate definition save", async () => {
    const f = fixture({ atomic: true, changedCard: true });
    await f.save();
    expect(f.bundles).toHaveLength(1);
    expect(f.bundles[0].ownerMutations[0].owner.definition.body).toBe("hi");
    expect(f.occurrences).toHaveLength(1);
    expect(f.occurrences[0][0].representations).toEqual({ Iconable: { icon: "star" } });
    expect(f.occurrences[0][2]).toBe(f.bundles[0]);
    expect(f.errors).toEqual([]);
    expect(f.closed()).toBe(1);
  });
  test("a local atomic refusal keeps both the definition and occurrence unpublished", async () => {
    const f = fixture({ atomic: true, atomicRefusal: true, changedCard: true });
    await f.save();
    expect(f.bundles).toEqual([]);
    expect(f.occurrences).toEqual([]);
    expect(f.errors).toEqual(["External source revision changed"]);
    expect(f.closed()).toBe(0);
  });
});

describe("root acknowledgment source coordinates", () => {
  const start = source.indexOf("  let ownRevisions:");
  const make = new Function("client", `${transpiler.transformSync(source.slice(start,
    source.indexOf("  function enqueueRootWrite", start)))}; return { acknowledgeRootRevision, rebasedRevision };`);
  const versionStart = source.indexOf("    writtenVersion: (result) =>", source.indexOf("  const viewPersistence ="));
  const makeWrittenVersion = new Function("client", `${transpiler.transformSync("const writtenVersion = " + source.slice(
    versionStart + "    writtenVersion:".length, source.lastIndexOf("},", source.indexOf("    refresh:", versionStart)) + 1) + ";")}; return writtenVersion;`);
  function fixture() {
    let active;
    const origins = new WeakMap();
    const physicalVersions = new WeakMap();
    const client = { drafts: { source: () => active, resultSource: result => origins.get(result),
      resultRootRevision: result => physicalVersions.get(result) } };
    const journal = make(client);
    return { ...journal, client, setSource: next => { active = next; }, receipt: (origin, revision, physical) => {
      const result = { root: { id: "account", revision }, locusView: { rootRevision: revision } };
      if (origin) origins.set(result, origin);
      if (physical !== undefined) physicalVersions.set(result, physical);
      return result;
    } };
  }
  test("only contiguous own acknowledgments in the same account and source can rebase an authored revision", () => {
    const f = fixture();
    const first = f.receipt(undefined, 11), second = f.receipt(undefined, 12);
    f.acknowledgeRootRevision("account", 11, first);
    f.acknowledgeRootRevision("account", 12, second);
    expect(f.rebasedRevision("account", 10)).toBe(12);
    expect(f.rebasedRevision("another-account", 10)).toBe(10);
    expect(f.rebasedRevision("account", 9)).toBe(9);
  });
  test("Save and Discard cannot carry browser virtual acknowledgments into the restored server coordinate", () => {
    for (const reset of ["Save", "Discard"]) {
      const f = fixture(), local = { reset };
      f.setSource(local);
      const accepted = f.receipt(local, 12);
      f.acknowledgeRootRevision("account", 12, accepted);
      expect(f.rebasedRevision("account", 11)).toBe(12);
      f.setSource(undefined);
      expect(f.rebasedRevision("account", 11)).toBe(11);
      const remote = f.receipt(undefined, 11);
      f.acknowledgeRootRevision("account", 11, remote);
      expect(f.rebasedRevision("account", 10)).toBe(11);
    }
  });
  test("a late local receipt after automatic source retirement cannot be misclassified as a server acknowledgment", () => {
    const f = fixture(), local = {};
    const remote = f.receipt(undefined, 11);
    f.acknowledgeRootRevision("account", 11, remote);
    f.setSource(local);
    const delayed = f.receipt(local, 12);
    f.setSource(undefined);
    f.acknowledgeRootRevision("account", 12, delayed);
    expect(f.rebasedRevision("account", 10)).toBe(11);
  });
  test("a retired receipt may carry its exact physical successor, while its larger virtual number stays local", () => {
    const f = fixture(), local = {};
    const remote = f.receipt(undefined, 11);
    f.acknowledgeRootRevision("account", 11, remote);
    const accepted = f.receipt(local, 13, 12);
    f.acknowledgeRootRevision("account", 13, accepted);
    expect(f.rebasedRevision("account", 10)).toBe(12);
  });
  test("a retired source's receipt cannot advance a different current browser draft", () => {
    const f = fixture(), retired = {}, current = {};
    const delayed = f.receipt(retired, 23);
    f.setSource(current);
    const accepted = f.receipt(current, 22);
    f.acknowledgeRootRevision("account", 22, accepted);
    f.acknowledgeRootRevision("account", 23, delayed);
    expect(f.rebasedRevision("account", 21)).toBe(22);
  });
  test("the local pane queue stages before source saving can retire its virtual CAS coordinate", () => {
    const registration = source.slice(source.indexOf('synchronization?.register(`home:'), source.indexOf("  // Leaving waits"));
    expect(registration).toContain("stageBeforeSave: true");
    expect(registration).toContain("save: () => viewPersistence.flushAll()");
  });
  test("a retired local list receipt uses only the exact physical ack or refuses the obsolete queue base", () => {
    const f = fixture(), local = {};
    const readVersion = makeWrittenVersion(f.client);
    f.setSource(local);
    const accepted = f.receipt(local, 13, 12);
    expect(readVersion(accepted)).toBe(13);
    f.setSource(undefined);
    expect(readVersion(accepted)).toBe(12);
    expect(() => readVersion(f.receipt(local, 14))).toThrow("Discard these changes");
    expect(readVersion(f.receipt(undefined, 11))).toBe(11);
    expect(makeWrittenVersion({})(f.receipt(undefined, 10))).toBe(10);
  });
  test("incomplete receipt acknowledgement blocks repeated writes until the same existing draft is discarded", async () => {
    const f = fixture(), local = {};
    let fail = true, writes = 0;
    const q = createViewPersistence({ delay: 60_000, version: () => 12, changed: () => {}, refresh: async () => {},
      writtenVersion: makeWrittenVersion(f.client), write: async () => {
        writes++;
        return fail ? f.receipt(local, 13) : f.receipt(undefined, 12);
      } });
    q.update("list", view("first"));
    expect(await q.flush("list")).toBe(false);
    expect(q.status()[0].blocked).toBe(true);
    fail = false;
    expect(await q.flush("list")).toBe(false);
    q.update("list", view("second"));
    expect(await q.flushAll()).toBe(false);
    expect(writes).toBe(1);
    expect(q.read("list", view("server"))).toEqual(view("second"));
    expect(q.discard("list")).toBe(true);
    q.update("list", view("fresh"));
    expect(await q.flush("list")).toBe(true);
    expect(writes).toBe(2);
    const notices = source.slice(source.indexOf("    for (const write of pendingViewWrites())"), source.indexOf('    if (importing()'));
    expect(notices).toContain("retry: write.blocked ||");
    expect(notices).toContain('label: "Reload latest"');
  });
  test("auto-save retires the local source while successive queued edits advance from the physical list ack", async () => {
    const f = fixture(), local = {};
    f.setSource(local);
    const gate = deferred(), writes = [];
    const q = createViewPersistence({ delay: 60_000, version: () => 12, origin: f.client.drafts.source, changed: () => {}, refresh: async () => {},
      writtenVersion: makeWrittenVersion(f.client), write: async (_id, next, base) => {
        writes.push({ next, base });
        if (writes.length === 1) {
          await gate.promise;
          const receipt = f.receipt(local, 13, 12);
          f.setSource(undefined);
          return receipt;
        }
        return f.receipt(undefined, 13);
      } });
    q.update("list", view("first"));
    const pending = q.flush("list");
    await Promise.resolve();
    q.update("list", view("second"));
    gate.resolve();
    expect(await pending).toBe(true);
    expect(writes.map(write => write.base)).toEqual([12, 12]);
    expect(q.status()).toEqual([]);
  });
  test("a queued draft from retired virtual14 cannot write against foreign server14 before any receipt exists", async () => {
    const f = fixture(), local = {};
    f.setSource(local);
    let rawWrites = 0;
    const q = createViewPersistence({ delay: 60_000, version: () => 14, origin: f.client.drafts.source,
      changed: () => {}, refresh: async () => {}, writtenVersion: makeWrittenVersion(f.client),
      write: async (_id, _view, base) => { expect(base).toBe(14); rawWrites++; return f.receipt(undefined, 15); } });
    q.update("list", view("my draft"));
    f.setSource(undefined);
    expect(await q.flush("list")).toBe(false);
    expect(await q.flush("list")).toBe(false);
    expect(rawWrites).toBe(0);
    expect(q.status()[0].blocked).toBe(true);
    q.discard("list");
  });
  test("an A receipt with exact physical13 cannot authorize a queued write in new B at colliding virtual13", async () => {
    const f = fixture(), sourceA = { id: "A" }, sourceB = { id: "B", virtualRevision: 13 };
    f.setSource(sourceA);
    const entered = deferred(), gate = deferred();
    let writes = 0, writesInB = 0;
    const q = createViewPersistence({ delay: 60_000, version: () => 13, origin: f.client.drafts.source,
      changed: () => {}, refresh: async () => {}, writtenVersion: makeWrittenVersion(f.client),
      write: async () => {
        writes++;
        if (f.client.drafts.source() === sourceB) writesInB++;
        entered.resolve();
        await gate.promise;
        return f.receipt(sourceA, 14, 13);
      } });
    q.update("list", view("first"));
    const pending = q.flush("list");
    await entered.promise;
    q.update("list", view("queued draft"));
    f.setSource(sourceB);
    gate.resolve();
    expect(await pending).toBe(false);
    expect(await q.flush("list")).toBe(false);
    expect(await q.flushAll()).toBe(false);
    expect(writes).toBe(1);
    expect(writesInB).toBe(0);
    expect(q.status()[0].blocked).toBe(true);
    expect(q.read("list", view("B data"))).toEqual(view("queued draft"));
    expect(q.discard("list")).toBe(true);
  });
  test("retirement during refresh cannot reuse an already-virtual acknowledged14 for a later queued gesture", async () => {
    const f = fixture(), local = {};
    f.setSource(local);
    const refreshing = deferred(), gate = deferred();
    let rawWrites = 0, writes = 0;
    const q = createViewPersistence({ delay: 60_000, version: () => 13, origin: f.client.drafts.source,
      changed: () => {}, refresh: async () => { refreshing.resolve(); await gate.promise; },
      writtenVersion: makeWrittenVersion(f.client), write: async () => {
        writes++;
        if (f.client.drafts.source() === undefined) rawWrites++;
        return f.receipt(local, 14);
      } });
    q.update("list", view("first"));
    const pending = q.flush("list");
    await refreshing.promise;
    q.update("list", view("second"));
    f.setSource(undefined);
    gate.resolve();
    expect(await pending).toBe(false);
    expect(writes).toBe(1);
    expect(rawWrites).toBe(0);
    expect(q.status()[0].blocked).toBe(true);
    q.discard("list");
  });
  test("retirement during refresh may translate only the last operation's newly available exact physical successor", async () => {
    const f = fixture(), local = {};
    f.setSource(local);
    const refreshing = deferred(), gate = deferred(), bases = [];
    const receipt = f.receipt(local, 14, 13);
    let refreshCount = 0;
    const q = createViewPersistence({ delay: 60_000, version: () => 13, origin: f.client.drafts.source,
      changed: () => {}, refresh: async () => { if (++refreshCount === 1) { refreshing.resolve(); await gate.promise; } },
      writtenVersion: makeWrittenVersion(f.client), write: async (_id, _value, base) => {
        bases.push(base);
        return bases.length === 1 ? receipt : f.receipt(undefined, 14);
      } });
    q.update("list", view("first"));
    const pending = q.flush("list");
    await refreshing.promise;
    q.update("list", view("second"));
    f.setSource(undefined);
    gate.resolve();
    expect(await pending).toBe(true);
    expect(bases).toEqual([13, 13]);
  });
});

describe("serialized root source responses", () => {
  const start = source.indexOf("  async function changeRoot(");
  const end = source.indexOf("  /** The data set the locus is inside", start);
  const makeRootWriter = new Function("root", "sessionEpoch", "setRootSaving", "enqueueRootWrite", "assertCurrentSession", "client",
    "rebasedRevision", "editLocusRoot", "revalidate", "refresh", "all", "acknowledgeRootRevision", "setRootWriteError",
    "rootSourceTicket = () => ({ origin: undefined })", "assertSourceTicket = () => {}", "settleWithin", "DISPLAY_CATCH_UP_WAIT_MS",
    `let rootWriteFailure; ${transpiler.transformSync(source.slice(start, end))}; return changeRoot;`);
  function fixture(options = {}) {
    const staleDisplay = { id: "this-tab-root", revision: 0 };
    let display = staleDisplay;
    let actualRevision = options.actualRevision ?? 2;
    let currentSource = options.sourceOrigin;
    let epoch = 1;
    const lifetime = new AbortController();
    const reads = [], writes = [], events = [];
    let queue = options.waitForQueue ?? Promise.resolve();
    const writer = makeRootWriter(() => display, () => epoch, () => {}, work => {
      const next = queue.then(work); queue = next.catch(() => {}); return next;
    }, captured => { if (captured !== epoch) throw Error("Session changed"); }, {
      signal: lifetime.signal, getLocusRoot: { uncached: async () => {
        reads.push(actualRevision); events.push(`read:${actualRevision}`);
        if (options.changeSession) epoch++;
        if (options.abortReader) lifetime.abort(Error("Reader closed"));
        if (options.changeDisplaySource) display = { ...display, id: "another-source" };
        return { root: { id: options.responseSource ?? staleDisplay.id, revision: actualRevision } };
      } },
    }, (_id, revision) => revision, async (id, revision, command) => {
      writes.push({ id, revision, command }); events.push(`write:${revision}`);
      if (revision !== actualRevision) throw Error("Stale authored edit");
      actualRevision++;
      return { root: { id, revision: actualRevision } };
    }, () => {}, options.refresh ?? (async () => {}), () => staleDisplay, () => {}, () => {},
    () => ({ origin: currentSource }), ticket => { if (ticket.origin !== currentSource) throw Error("The data source changed while editing"); },
    settleWithin, 20);
    return { writer, reads, writes, events, display: () => display, setSource: next => { currentSource = next; } };
  }
  const append = { kind: "append", item: { id: "counter-pin", source: { kind: "expr", expr: { kind: "literal", value: { $ref: "counter-type" } } } } };

  test("a new definition pin reads revision 2 while the refreshed display deliberately stays at 0", async () => {
    const f = fixture();
    await f.writer(append);
    expect(f.reads).toEqual([2]);
    expect(f.writes).toEqual([{ id: "this-tab-root", revision: 2, command: append }]);
    expect(f.display().revision).toBe(0);
  });

  test("a committed append completes although the display catch-up never settles (Create stayed on Creating…)", async () => {
    const f = fixture({ refresh: () => new Promise(() => {}) });
    const outcome = await Promise.race([f.writer(append).then(() => "done"), new Promise(r => setTimeout(() => r("hung"), 2000))]);
    expect(outcome).toBe("done");
    expect(f.writes).toEqual([{ id: "this-tab-root", revision: 2, command: append }]);
  });

  test("a display catch-up that fails in time still reports its failure", async () => {
    const f = fixture({ refresh: async () => { throw Error("Root read failed"); } });
    await expect(f.writer(append)).rejects.toThrow("Root read failed");
  });

  test("uncached append and layout reads run inside the shared serialized write lane", async () => {
    const held = deferred();
    const f = fixture({ waitForQueue: held.promise });
    const first = f.writer(append);
    const second = f.writer({ kind: "layout", layout: { kind: "grid" } });
    expect(f.reads).toEqual([]);
    held.resolve();
    await Promise.all([first, second]);
    expect(f.events).toEqual(["read:2", "write:2", "read:3", "write:3"]);
    expect(f.display().revision).toBe(0);
  });

  test("replacement, removal and a mixed batch retain their stale authored compare-and-swap", async () => {
    for (const command of [{ kind: "replace", itemId: "old", item: { id: "old" } },
      { kind: "remove", itemId: "old" }, { kind: "batch", commands: [append, { kind: "remove", itemId: "old" }] }]) {
      const f = fixture();
      await expect(f.writer(command, 0)).rejects.toThrow("Stale authored edit");
      expect(f.reads).toEqual([]);
      expect(f.writes[0].revision).toBe(0);
    }
  });
  test("a queued virtual revision cannot overwrite a foreign server root with the same numeric revision after source retirement", async () => {
    const gate = deferred(), local = {};
    const f = fixture({ sourceOrigin: local, actualRevision: 14, waitForQueue: gate.promise });
    const pending = f.writer({ kind: "replace", itemId: "old", item: { id: "old" } }, 14);
    f.setSource(undefined);
    gate.resolve();
    await expect(pending).rejects.toThrow("data source changed");
    expect(f.writes).toEqual([]);
  });

  test("a different source response, visible source, session or closed reader refuses before writing", async () => {
    for (const options of [{ responseSource: "another-source" }, { changeDisplaySource: true },
      { changeSession: true }, { abortReader: true }]) {
      const f = fixture(options);
      await expect(f.writer(append)).rejects.toThrow();
      expect(f.writes).toEqual([]);
    }
  });
});

describe("creation pin destination freshness", () => {
  const start = source.indexOf("    async add(source:");
  const end = source.indexOf("    // Adding lands in the scope", start);
  const addBody = source.slice(start, end).trim().replace("async add(", "async function add(").replace(/,\s*$/, "");
  const makeAdd = new Function("accountSelectionPending", "homeData", "scope", "sessionEpoch", "root", "revalidate", "refresh", "all",
    "savedAll", "valueScopeResponse", "assertCurrentSession", "scopeKey", "valueScope", "writeValueScopeExpression", "appendExpressionAt",
    "expressionEditOptions", "genId", "changeRoot", "current", "viewPersistence", "setToolbarError", "settleWithin", "DISPLAY_CATCH_UP_WAIT_MS",
    `${transpiler.transformSync(addBody)}; return add;`);
  function fixture(kind = "root", options = {}) {
    let here = kind === "root" ? { kind } : kind === "view" ? { kind, viewId: "list" }
      : { kind, viewId: "tab-root", itemId: "list-data", path: [] };
    let root = { id: "tab-root", revision: 6, items: [] };
    let epoch = 1;
    let state = { ok: true, rootRevision: 6, sourceExpression: { kind: "literal", value: { __list: [{ kind: "literal", value: 1 }] } } };
    const calls = [], errors = [], saved = () => {}, all = () => {};
    const pending = createViewPersistence({ delay: 60_000, changed: () => {}, version: () => root.revision,
      refresh: async () => {}, write: async (id, next, revision) => {
        calls.push({ viewWrite: id, revision, next });
        if (options.failWrites > 0) { options.failWrites--; throw Error("Temporary placement failure"); }
        if (revision !== 8) throw Error("The existing draft has a stale authored revision");
      } });
    const serverView = view("committed-item");
    if (options.pendingDraft) pending.update("list", view("draft-item"));
    const add = makeAdd(() => false, { canAdd: () => true }, () => here, () => epoch, () => root,
      keys => calls.push({ revalidate: keys }), async memo => {
        calls.push({ refresh: memo === all ? "root" : "saved" });
        if (options.refreshNever) return new Promise(() => {});
        if (memo === all) root = { ...root, revision: 8 };
        if (options.changeFocus) here = { kind: "root" };
        if (options.changeSession) epoch++;
      }, all, saved, { refetch: async () => {
        calls.push({ refetchValue: true }); state = { ...state, rootRevision: root.revision };
      } }, captured => { if (captured !== epoch) throw Error("Session changed"); }, scopeKey, () => state,
      async (captured, expression) => { calls.push({ valueWrite: captured.rootRevision, expression }); }, appendExpressionAt,
      () => ({}), () => "new-definition-occurrence", async command => { calls.push({ rootWrite: root.revision, command }); },
      () => ({ id: "list", view: pending.read("list", serverView) }), pending, error => errors.push(error), settleWithin, 20);
    return { add, calls, errors, pending };
  }
  const definition = { expr: { kind: "literal", value: { $ref: "local-type-identity" } }, valueType: { $type: true } };

  test("a root pin is still appended when the root read never settles after the definition write", async () => {
    const f = fixture("root", { refreshNever: true });
    const outcome = await Promise.race([f.add(definition, "Counter"), new Promise(r => setTimeout(() => r("hung"), 2000))]);
    expect(outcome).toBe(true);
    expect(f.calls.filter(call => call.rootWrite).length).toBe(1);
  });

  test("a root pin adopts the committed revision after definition and representation writes", async () => {
    const f = fixture();
    expect(await f.add(definition, "Counter")).toBe(true);
    expect(f.calls.find(call => call.rootWrite)).toEqual({ rootWrite: 8, command: { kind: "append", item: {
      id: "new-definition-occurrence", caption: "Counter", valueType: definition.valueType,
      source: { kind: "expr", expr: definition.expr },
    } } });
    expect(f.errors).toEqual([]);
  });

  test("a nested list pin re-reads its value and uses the same scoped writer at the current revision", async () => {
    const f = fixture("value");
    expect(await f.add(definition)).toBe(true);
    expect(f.calls.find(call => call.valueWrite)).toEqual({ valueWrite: 8, expression: {
      kind: "literal", value: { __list: [{ kind: "literal", value: 1 }, definition.expr] },
    } });
    expect(f.calls.some(call => call.refetchValue)).toBe(true);
    expect(f.calls.some(call => call.rootWrite)).toBe(false);
  });

  test("refreshing for a new pin preserves a stale existing list draft and its compare-and-swap base", async () => {
    const f = fixture("view", { pendingDraft: true });
    expect(await f.add(definition)).toBe(false);
    expect(f.calls.find(call => call.viewWrite).revision).toBe(6);
    expect(f.pending.read("list", view()).items.map(item => item.id)).toEqual(["draft-item", "new-definition-occurrence"]);
    expect(f.pending.status()[0].error).toContain("stale authored revision");
    f.pending.discard("list");
  });

  test("a changed focus or session during refresh cannot receive the new pin", async () => {
    for (const options of [{ changeFocus: true }, { changeSession: true }]) {
      const f = fixture("value", options);
      expect(await f.add(definition)).toBe(false);
      expect(f.calls.some(call => call.rootWrite || call.valueWrite || call.viewWrite)).toBe(false);
      expect(f.errors).toHaveLength(1);
    }
  });

  test("retrying a failed creation placement flushes the retained occurrence once without duplicating it", async () => {
    const f = fixture("view", { failWrites: 1 });
    const occurrence = { id: "retained-creation-occurrence" };
    expect(await f.add(definition, "Created", undefined, undefined, occurrence)).toBe(false);
    expect(f.pending.read("list", view()).items.filter(item => item.id === occurrence.id)).toHaveLength(1);
    expect(await f.add(definition, "Created", undefined, undefined, occurrence)).toBe(true);
    expect(f.calls.filter(call => call.viewWrite)).toHaveLength(2);
    expect(f.calls.filter(call => call.viewWrite).at(-1).next.items.filter(item => item.id === occurrence.id)).toHaveLength(1);
    expect(f.pending.status()).toEqual([]);
  });
});

describe("captured reader function signature drafts", () => {
  const start = source.indexOf("  const functionAuthoringSession = createMemo(", source.indexOf("function EditModalContent("));
  const end = source.indexOf("  /** Lambda params surfaced", start);
  const prepare = new Function("createMemo", "functionPin", "arrowDraft", "reader", "subject",
    "functionSourceAuthoringSession", "prepareAuthoringSessionForFunction", "userFunctions",
    "functionBaseline = () => undefined", "functionSignatureShapeIssue = () => undefined",
    "functionDeclaration = () => undefined", "functionRequirements = () => undefined",
    `${transpiler.transformSync(source.slice(start, end))}; return functionAuthoringSession;`);

  test("local readers own signature drafts for anonymous and authenticated subjects", () => {
    for (const who of [{ $tag: "Anonymous" }, { $tag: "User", accountId: "unrelated-account" }]) {
      const fn = { id: "local-function", params: [], returns: { $ref: "String" }, body: "before" };
      const arrow = { $arrow: { params: [{ name: "count", type: { $ref: "Number" } }], returns: { $ref: "Number" } } };
      const calls = [];
      const session = { source: "this-tab" };
      let subjectReads = 0;
      const prepared = prepare(compute => compute, () => ({ fn }), () => arrow,
        { kind: "local", draftSession: draft => { calls.push({ id: draft.id, draft }); return session; },
          prepareFunction: () => { throw Error("The local signature draft must use its synchronous checked session"); } },
        () => { subjectReads++; return who; },
        () => { throw Error("The persisted session would omit the signature draft"); },
        () => { throw Error("No account session may replace the local reader"); },
        () => { throw Error("No account roster may replace the local roster"); });
      expect(prepared()).toBe(session);
      expect(calls).toEqual([{ id: fn.id, draft: { ...fn, params: arrow.$arrow.params, returns: arrow.$arrow.returns } }]);
      expect(subjectReads).toBe(0);
    }
  });

  test("the reopened body tracks the draft return type supplied to the universal editor", () => {
    const returnStart = source.indexOf("  const functionBodyReturnType = createMemo", source.indexOf("function EditModalContent("));
    // The memo's own closing line; the Local preview job now follows it (60a61cfe).
    const returnEnd = source.indexOf("\n  });", returnStart) + "\n  });".length;
    const makeReturn = new Function("createMemo", "arrowDraft",
      `${transpiler.transformSync(source.slice(returnStart, returnEnd))}; return functionBodyReturnType;`);
    let arrow = { $arrow: { params: [], returns: { $ref: "Number" } } };
    const currentReturn = makeReturn(compute => compute, () => arrow);
    expect(currentReturn()).toBe(arrow.$arrow.returns);
    arrow = { $arrow: { params: [], returns: { $ref: "String" } } };
    expect(currentReturn()).toBe(arrow.$arrow.returns);
    expect(source.slice(source.indexOf("expr={bodyDraft()!}"), source.indexOf("expr={bodyDraft()!}") + 450))
      .toContain("type: functionBodyReturnType()!");
  });
});

describe("editable inspection code and saves", () => {
  const stateStart = source.indexOf("function createInspectionExpressionState(");
  const stateFactory = new Function("createSignal", "untrack", "cloneDraftValue", `${transpiler.transformSync(source.slice(stateStart,
    source.indexOf("function inspectionFunctionEntry(", stateStart)))}; return { createInspectionExpressionState, refreshCleanInspectionState, persistedFunctionDefinition, functionDefinitionOwner };`)
    (initial => { let value = initial; return [() => value, next => { value = next; }]; }, fn => fn(), cloneDraftValue);
  const handlersStart = inspectionControllerSource.indexOf("  function changeCode(");
  const handlersEnd = inspectionControllerSource.indexOf("  const dirty = createMemo", handlersStart);
  if (handlersStart < 0 || handlersEnd <= handlersStart) throw new Error("Inspection handlers boundary changed");
  const handlers = inspectionControllerSource.slice(handlersStart, handlersEnd);
  const makeHandlers = new Function("state", "source", "parameters", "homeAuthoringSession", "parseFenel", "logicToExprNode",
    "resolveLocalCallHeads", "draftValueFingerprint", "cloneDraftValue", "data", "fn", "draft", "props", "sessionEpoch", "assertCurrentSession",
    "evaluateAuthoringExpression", "getIOAction", "followLocusPath", "resolveCatalogReference", "onSettled", "temporaryEdits", "toLogic", "draftIssue",
    "createEffect", "original",
    // B4 slice 2: a page (non-Local) inspector has no live guidance.
    "localGuidance = undefined", "reader = undefined",
    // B4 unit C: the page reads through the shared text boundary; no Local typing.
    "readAuthoringExpressionText", "printedSource", "localTyping = undefined", "pendingSourceText = undefined",
    "readLocalExpressionText = undefined", "LOCAL_SAVE_DRAFT_CHANGED = undefined",
    `${transpiler.transformSync(inspectionPendingSource + handlers)}; return { changeCode, formatCode, cancelChanges, saveChanges };`);
  async function fixture(options = {}) {
    const { print } = await import("../../../../../implementations/typescript/engine/src/engine-bodies-dispatch");
    const { parse } = await import("../../../../../implementations/typescript/engine/src/fenel-parser");
    const { resolveLocalCallHeads } = await import("../../../../../implementations/typescript/engine/src/fenel-module");
    const state = stateFactory.createInspectionExpressionState();
    let original = options.original ?? (options.function ? logicToExprNode({ call: [{ var: "f" }, { var: "x" }] }, ["f", "x"])
      : { kind: "literal", value: 1 });
    const draft = () => state.draft() ?? state.savedDraft() ?? original;
    const printed = () => print(exprNodeToLogic(projectSource(draft())));
    state.setSourceText(printed());
    state.acceptedSourceText = printed();
    const calls = [];
    let focusedState = state;
    let dispose;
    let fn = options.function ? { id: "Apply", params: [{ name: "f" }, { name: "x" }], body: { call: [{ var: "f" }, { var: "x" }] } } : undefined;
    state.functionBaseline = fn ? structuredClone(fn) : undefined;
    const session = { environment: {}, evaluateContext: {} };
    const surface = makeHandlers(state, printed, () => fn?.params ?? [], () => session, parse,
      (logic, names) => logicToExprNode(logic, names, name => name === "f" ? "global-shadow-f" : name), resolveLocalCallHeads, JSON.stringify, structuredClone,
      { focusedExpressionState: () => focusedState, saveInspection: async (...args) => {
        if (options.autoPublishFunction && fn) fn = { ...fn, body: exprNodeToLogic(args[1]) };
        calls.push(args); return options.save ? options.save(...args) : "lens";
      } }, () => fn, draft, { item: { id: "$self" }, savedExprById: new Map(), evaluated: options.evaluated }, () => 1, epoch => {
        if (epoch !== 1) throw Error("Changed session");
      }, node => { calls.push({ evaluate: node }); return options.evaluate?.(node) ?? { result: node.value, trace: [] }; },
      id => id === "io" ? "perform" : undefined, (value, path) => ({ value: path.length ? value[path[0]] : value }),
      () => undefined, callback => { dispose = callback(); }, () => !!options.paused || !!options.pending, exprNodeToLogic,
      () => options.checkedEnvironment ? draftSaveIssue(draft(), options.checkedEnvironment, {
        expectedType: options.expectedType, resolveSavedExpr: options.resolveSavedExpr,
      }) : undefined,
      // The early-handoff effect (Save once the editing tools are ready): no handoff here.
      (compute, apply) => apply(compute()), () => original, undefined, undefined,
      (text, names) => logicToExprNode(resolveLocalCallHeads(parse(text), [...names]), [...names], name => name === "f" ? "global-shadow-f" : name),
      () => ({ text: printed(), readable: true }));
    return { state, surface, draft, calls, original, printed, replaceOriginal: next => { original = next; }, replaceFunction: next => { fn = next; },
      replaceFocus: () => { focusedState = stateFactory.createInspectionExpressionState(); }, dispose: () => dispose?.() };
  }

  test("canonical parsing binds function parameters and preserves comments and incomplete input until formatting", async () => {
    const f = await fixture({ function: true });
    const text = "-- keep while typing\nf    x";
    f.surface.changeCode(text);
    expect(f.state.sourceText()).toBe(text);
    expect(f.state.sourceError()).toBeUndefined();
    expect(exprNodeToLogic(f.draft())).toEqual({ call: [{ var: "f" }, { var: "x" }] });
    f.surface.formatCode();
    expect(f.state.sourceText()).toBe("f x");
    const admitted = f.draft();
    f.surface.changeCode("f (");
    expect(f.state.sourceText()).toBe("f (");
    expect(f.state.sourceError()).toBeTruthy();
    expect(f.draft()).toBe(admitted);
    await f.surface.saveChanges();
    expect(f.calls).toEqual([]);
  });
  test("the existing binder pass preserves nested lexical parameters over catalog names", async () => {
    const f = await fixture({ function: true });
    f.surface.changeCode("\\x -> f x");
    expect(f.state.sourceError()).toBeUndefined();
    expect(exprNodeToLogic(f.draft())).toEqual({ fn: ["x", { call: [{ var: "f" }, { var: "x" }] }] });
  });
  test("Save accepts the shared function body and Cancel returns to that baseline rather than the repository body", async () => {
    const f = await fixture({ function: true });
    f.surface.changeCode("x");
    await f.surface.saveChanges();
    expect(f.printed()).toBe("x");
    expect(f.state.saveNotice()).toBe("Applied in this lens.");
    expect(f.calls).toHaveLength(1);
    f.surface.changeCode("f x");
    f.surface.cancelChanges();
    expect(f.printed()).toBe("x");
    expect(f.state.sourceError()).toBeUndefined();
    expect(f.state.savedDraft()).toEqual({ kind: "param", name: "x" });
  });
  test("local scalar Save publishes the evaluated data with its authored source", async () => {
    const f = await fixture();
    f.surface.changeCode("42");
    await f.surface.saveChanges();
    expect(f.state.savedValue()).toEqual({ value: 42, source: { kind: "literal", value: 42 }, sourcePath: [] });
    expect(f.calls).toHaveLength(2);
    f.surface.changeCode("17");
    f.surface.cancelChanges();
    expect(f.draft()).toEqual({ kind: "literal", value: 42 });
  });
  test("local focused-field Save evaluates only its projected producer and Cancel keeps the accepted scalar", async () => {
    const producer = { kind: "call", fnId: "reverse", args: [{ kind: "literal", value: "Fenel" }] };
    const parent = { kind: "literal", value: { __record: { fields: [{ name: "Computed text", value: producer },
      { name: "Unrelated identity", value: { kind: "literal", value: { $ref: "opaque-identity" } } }] } } };
    const evaluated = { value: "leneF", ...authoredProjection(parent, ["Computed text"], {}) };
    const f = await fixture({ original: evaluated.source, evaluated });
    f.surface.changeCode("42");
    await f.surface.saveChanges();
    expect(f.state.savedValue()).toEqual({ value: 42, source: { kind: "literal", value: 42 }, sourcePath: [] });
    expect(f.calls.filter(call => call.evaluate)).toEqual([{ evaluate: { kind: "literal", value: 42 } }]);
    expect(f.state.saveNotice()).toBe("Applied in this lens.");
    f.surface.changeCode("99");
    f.surface.cancelChanges();
    expect(f.printed()).toBe("42");
    expect(f.state.savedValue()?.value).toBe(42);
    expect(parent.value.__record.fields[0].value).toBe(producer);
  });
  test("local computed-child Save selects only the residual path in its edited producer's result", async () => {
    const producer = { kind: "call", fnId: "reverse", args: [{ kind: "literal", value: "Fenel" }] };
    const parent = { kind: "literal", value: { __record: { fields: [{ name: "Produced list", value: producer }] } } };
    const evaluated = { value: "second", ...authoredProjection(parent, ["Produced list", 1], {}) };
    const f = await fixture({ original: evaluated.source, evaluated,
      evaluate: () => ({ result: ["changed first", "changed second"], trace: [] }) });
    f.surface.changeCode('["changed first", "changed second"]');
    const submitted = f.draft();
    await f.surface.saveChanges();
    expect(f.state.savedValue()).toEqual({ value: "changed second", source: submitted, sourcePath: [1] });
    expect(f.calls.filter(call => call.evaluate)).toEqual([{ evaluate: submitted }]);
    expect(parent.value.__record.fields[0].value).toBe(producer);
  });
  test("failed persistence keeps the same parsed draft available for Retry", async () => {
    let failed = true;
    const f = await fixture({ save: () => { if (failed) throw Error("Offline"); return "data"; } });
    f.surface.changeCode("42");
    await f.surface.saveChanges();
    expect(f.state.saveError()).toBe("Offline");
    expect(f.state.sourceError()).toBeUndefined();
    expect(f.state.savedDraft()).toBeUndefined();
    failed = false;
    await f.surface.saveChanges();
    expect(f.state.saveError()).toBeUndefined();
    expect(f.state.saveNotice()).toBe("Saved.");
    expect(f.calls).toHaveLength(2);
  });
  test("an invalid intermediary graph call refuses Save and Apply, keeps its draft, and recovers after repair", async () => {
    const text = { $ref: "String" };
    const number = { $ref: "Number" };
    const field = (type, index) => ({ name: `input${index}`, type, key: { $tag: "PositionalField", index },
      label: Nothing, ui: Nothing, meta: {} });
    const entry = (id, types, returns) => {
      const params = types.map(field);
      return { id, targetId: id, kind: "function", label: id, description: "", params, returns,
        scheme: { quantified: [], body: { $arrow: { params, returns } } }, signatureOutcome: { $tag: "Solved" } };
    };
    const environment = createAuthoringEnvironment({ types: [], functions: [
      entry("length", [text], number), entry("increment", [number], number), entry("display", [number], text),
    ], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const input = { kind: "literal", value: "the quick brown fox" };
    const length = { kind: "call", fnId: "length", args: [input] };
    const increment = { kind: "call", fnId: "increment", args: [length] };
    const original = { kind: "call", fnId: "display", args: [increment] };
    for (const paused of [false, true]) {
      const f = await fixture({ original, checkedEnvironment: environment, expectedType: text, paused, save: () => "data" });
      const invalid = { ...original, args: [{ ...increment, args: [input] }] };
      f.state.setDraft(invalid);
      await f.surface.saveChanges();
      expect(f.state.saveError()).toBeTruthy();
      expect(f.calls).toHaveLength(0);
      expect(f.draft()).toBe(invalid);
      expect(f.state.savedDraft()).toBeUndefined();
      const repaired = { ...original, args: [length] };
      f.state.setDraft(repaired);
      await f.surface.saveChanges();
      expect(f.state.saveError()).toBeUndefined();
      expect(f.calls).toHaveLength(1);
      expect(f.state.savedDraft()).toEqual(repaired);
      expect(f.state.saveNotice()).toBe(paused ? "Applied locally." : "Saved.");
      expect(original.args[0]).toBe(increment);
    }
  }, 60_000);
  test("duplicate local binding rows refuse saving before serialization can discard one", async () => {
    const environment = createAuthoringEnvironment({ types: [], functions: [], capabilities: [], catalogTypes: [],
      operatorCodeNameByNotation: new Map() });
    const original = { kind: "literal", value: 1 };
    const invalid = { kind: "literal", value: { __where: {
      body: { kind: "param", name: "x" }, bindings: [
        { name: "x", expr: original }, { name: "x", expr: { kind: "literal", value: 2 } },
      ],
    } } };
    const f = await fixture({ original, checkedEnvironment: environment, save: () => "data" });
    f.state.setDraft(invalid);
    await f.surface.saveChanges();
    expect(f.state.saveError()).toContain("x");
    expect(f.calls).toHaveLength(0);
    expect(f.draft()).toBe(invalid);
    expect(invalid.value.__where.bindings).toHaveLength(2);
    f.state.setDraft(original);
    await f.surface.saveChanges();
    expect(f.state.saveError()).toBeUndefined();
    expect(f.calls).toHaveLength(1);
  });
  test("accepting paused account code reports Apply without claiming that it was saved", async () => {
    const f = await fixture({ paused: true, save: () => "data" });
    f.surface.changeCode("42");
    await f.surface.saveChanges();
    expect(f.state.savedDraft()).toEqual({ kind: "literal", value: 42 });
    expect(f.state.saveNotice()).toBe("Applied locally.");
    expect(f.calls).toHaveLength(1);
  });
  test("accepted code after a failed automatic save reports Applied while its journal remains pending", async () => {
    const f = await fixture({ pending: true, save: () => "data" });
    f.surface.changeCode("42");
    await f.surface.saveChanges();
    expect(f.state.saveNotice()).toBe("Applied locally.");
    expect(f.calls).toHaveLength(1);
  });
  async function discardedInspectionFixture() {
    let active = {}, writes = 0, pending = true;
    const f = await fixture({ paused: true, save: (_item, _expr, _fn, origin) => {
      if (origin.sourceTicket.origin !== active) throw Error("The data source changed while editing");
      writes++;
      return "data";
    } });
    const captured = { scope: { kind: "value" }, epoch: 1, rootRevision: 14, sourceTicket: { origin: active } };
    f.state.saveOrigin = captured;
    f.surface.changeCode("42");
    await f.surface.saveChanges();
    const synchronization = createLocusSynchronization();
    synchronization.register("fixture-source", { pending: () => pending, saving: () => false, error: () => undefined,
      save: async () => true, discard: async () => {
        pending = false;
        active = undefined;
        f.replaceOriginal({ kind: "literal", value: 6 });
        return true;
      } });
    const freshOrigin = () => ({ scope: captured.scope, epoch: 1, rootRevision: 13,
      sourceTicket: { origin: active }, expectedSavedQuery: { kind: "expression", expr: { kind: "literal", value: 6 } } });
    return { ...f, synchronization, freshOrigin, writes: () => writes, captured };
  }
  test("global Discard after accepted Code refreshes a clean reopened inspector from the current datum", async () => {
    const f = await discardedInspectionFixture();
    expect(f.printed()).toBe("42");
    expect(await f.synchronization.discardAll()).toBe(true);
    const fresh = f.freshOrigin();
    expect(stateFactory.refreshCleanInspectionState(f.state, fresh)).toBe(true);
    expect(f.printed()).toBe("6");
    expect(f.state.savedDraft()).toBeUndefined();
    expect(f.state.savedValue()).toBeUndefined();
    expect(f.state.sourceText()).toBeUndefined();
    expect(f.state.saveOrigin).toBe(fresh);
    f.surface.changeCode("7");
    await f.surface.saveChanges();
    expect(f.state.saveError()).toBeUndefined();
    expect(f.writes()).toBe(2);
  });
  test("global Discard preserves a private Code draft under its retired ticket and its Apply still refuses", async () => {
    const f = await discardedInspectionFixture();
    f.surface.changeCode("99");
    const draft = f.draft(), text = f.state.sourceText(), origin = f.state.saveOrigin;
    expect(await f.synchronization.discardAll()).toBe(true);
    expect(stateFactory.refreshCleanInspectionState(f.state, f.freshOrigin())).toBe(false);
    expect(f.draft()).toBe(draft);
    expect(f.state.sourceText()).toBe(text);
    expect(f.state.saveOrigin).toBe(origin);
    await f.surface.saveChanges();
    expect(f.state.saveError()).toContain("data source changed");
    expect(f.writes()).toBe(1);
  });
  test("retired-source cache recovery keeps private text, parser errors and in-flight saves intact", async () => {
    for (const mode of ["private-text", "parser-error", "save-error", "saving"]) {
      const f = await discardedInspectionFixture();
      if (mode === "private-text") f.state.setSourceText("-- private comment\n42");
      if (mode === "parser-error") f.surface.changeCode("(");
      if (mode === "save-error") f.state.setSaveError("Keep this failed edit");
      if (mode === "saving") f.state.saveInFlight = true;
      const original = f.state.saveOrigin, accepted = f.state.savedDraft(), text = f.state.sourceText();
      expect(await f.synchronization.discardAll()).toBe(true);
      expect(stateFactory.refreshCleanInspectionState(f.state, f.freshOrigin())).toBe(false);
      expect(f.state.saveOrigin).toBe(original);
      expect(f.state.savedDraft()).toBe(accepted);
      expect(f.state.sourceText()).toBe(text);
    }
  });
  test("an incomplete first Code edit keeps its last admitted AST across source retirement until explicit Cancel", () => {
    const state = stateFactory.createInspectionExpressionState();
    const sourceA = {};
    state.saveOrigin = { scope: { kind: "value" }, epoch: 1, sourceTicket: { origin: sourceA } };
    let original = { kind: "literal", value: 42 };
    const draft = () => state.draft() ?? state.savedDraft() ?? original;
    const printed = () => String(draft().value);
    state.setSourceText("42");
    state.acceptedSourceText = "42";
    const parse = text => { if (text === "(") throw Error("Incomplete code"); return Number(text); };
    const surface = makeHandlers(state, printed, () => [], () => ({ environment: {} }), parse,
      value => ({ kind: "literal", value }), value => value, JSON.stringify, cloneDraftValue,
      undefined, () => undefined, draft, { item: { id: "$self" }, savedExprById: new Map() }, () => 1, () => {},
      () => ({}), () => undefined, () => ({}), () => undefined, () => {}, () => true, value => value,
      () => undefined, (compute, apply) => apply(compute()), () => original, undefined, undefined,
      text => ({ kind: "literal", value: parse(text) }), () => ({ text: printed(), readable: true }));
    surface.changeCode("(");
    original = { kind: "literal", value: 6 };
    const current = { scope: state.saveOrigin.scope, epoch: 1, sourceTicket: { origin: undefined } };
    expect(stateFactory.refreshCleanInspectionState(state, current)).toBe(false);
    expect(draft()).toEqual({ kind: "literal", value: 42 });
    expect(state.sourceText()).toBe("(");
    expect(state.sourceError()).toBe("Incomplete code");
    surface.cancelChanges();
    expect(stateFactory.refreshCleanInspectionState(state, current)).toBe(true);
    expect(draft()).toEqual({ kind: "literal", value: 6 });
    expect(state.sourceError()).toBeUndefined();
  });
  test("an external function edit cannot be overwritten by an older inspected body even when the root revision stays unchanged", async () => {
    const f = await fixture({ function: true, save: () => "data" });
    f.surface.changeCode("x");
    f.replaceFunction({ ...f.state.functionBaseline, body: "Changed by another lens" });
    await f.surface.saveChanges();
    expect(f.state.saveError()).toContain("function changed while editing");
    expect(f.state.savedDraft()).toBeUndefined();
    expect(f.draft()).toEqual({ kind: "param", name: "x" });
    expect(f.calls).toHaveLength(0);
  });
  test("an accepted function edit advances its captured baseline so the same inspector can apply another edit", async () => {
    const f = await fixture({ function: true, autoPublishFunction: true, save: () => "data" });
    f.surface.changeCode("x");
    await f.surface.saveChanges();
    expect(f.state.saveError()).toBeUndefined();
    f.surface.changeCode("f x");
    await f.surface.saveChanges();
    expect(f.state.saveError()).toBeUndefined();
    expect(f.calls).toHaveLength(2);
  });
  test("a temporary function-body projection can be applied twice while retaining its unchanged declaration baseline", async () => {
    const f = await fixture({ function: true, paused: true });
    const original = structuredClone(f.state.functionBaseline);
    f.surface.changeCode("x");
    await f.surface.saveChanges();
    f.surface.changeCode("f x");
    await f.surface.saveChanges();
    expect(f.state.saveError()).toBeUndefined();
    expect(f.state.functionBaseline).toEqual(original);
    expect(f.calls).toHaveLength(2);
  });
  test("a local evaluator error preserves the accepted data and edited source for Retry", async () => {
    let failed = false;
    const f = await fixture({ evaluate: node => failed ? { result: undefined, trace: [], error: "Unavailable input" }
      : { result: node.value, trace: [] } });
    f.surface.changeCode("42");
    await f.surface.saveChanges();
    f.surface.changeCode("99");
    failed = true;
    await f.surface.saveChanges();
    expect(f.state.saveError()).toBe("Unavailable input");
    expect(f.state.sourceError()).toBeUndefined();
    expect(f.state.saveNotice()).toBeUndefined();
    expect(f.state.savedValue()?.value).toBe(42);
    expect(f.state.savedDraft()).toEqual({ kind: "literal", value: 42 });
    expect(f.draft()).toEqual({ kind: "literal", value: 99 });
    failed = false;
    await f.surface.saveChanges();
    expect(f.state.saveError()).toBeUndefined();
    expect(f.state.savedValue()?.value).toBe(99);
    expect(f.state.saveNotice()).toBe("Applied in this lens.");
  });
  test("a late Save does not publish into a different focused subject, while hiding a panel keeps its shared baseline", async () => {
    let finish;
    const f = await fixture({ save: () => new Promise(resolve => { finish = resolve; }) });
    f.surface.changeCode("42");
    const pending = f.surface.saveChanges();
    f.dispose();
    finish("lens");
    await pending;
    expect(f.state.savedValue()?.value).toBe(42);
    const other = await fixture({ save: () => new Promise(resolve => { finish = resolve; }) });
    other.surface.changeCode("17");
    const stale = other.surface.saveChanges();
    other.replaceFocus();
    finish("lens");
    await stale;
    expect(other.state.savedDraft()).toBeUndefined();
    expect(other.state.savedValue()).toBeUndefined();
  });
  test("a pending Save accepts its submitted data without replacing a newer valid or incomplete Code draft", async () => {
    for (const newer of ["99", "("]) {
      let finish;
      const f = await fixture({ save: () => new Promise(resolve => { finish = resolve; }) });
      f.surface.changeCode("42");
      const pending = f.surface.saveChanges();
      f.surface.changeCode(newer);
      finish("lens");
      await pending;
      expect(f.state.savedDraft()).toEqual({ kind: "literal", value: 42 });
      expect(f.state.savedValue()?.value).toBe(42);
      expect(f.state.sourceText()).toBe(newer);
      expect(f.draft()).toEqual({ kind: "literal", value: newer === "99" ? 99 : 42 });
      expect(!!f.state.sourceError()).toBe(newer === "(");
      expect(f.state.saving()).toBe(false);
      f.surface.cancelChanges();
      expect(f.printed()).toBe("42");
      expect(f.state.sourceError()).toBeUndefined();
    }
  });
  test("saving an IO call accepts its expression without automatically executing it", async () => {
    const f = await fixture();
    f.state.setDraft({ kind: "call", fnId: "io", args: [] });
    await f.surface.saveChanges();
    expect(f.calls).toHaveLength(1);
    expect(f.state.savedValue()?.value).toBeUndefined();
    expect(f.state.savedDraft()?.fnId).toBe("io");
  });
  test("the modified accepted body retains ordinary checker guidance", () => {
    const start = inspectionControllerSource.indexOf("  const untouched = createMemo");
    const end = inspectionControllerSource.indexOf(";", start);
    if (start < 0 || end <= start) throw new Error("Inspection untouched boundary changed");
    const expression = inspectionControllerSource.slice(start, end + 1);
    const makeUntouched = new Function("createMemo", "state", "draftValueFingerprint", "draft", "original", `${transpiler.transformSync(expression)}; return untouched;`);
    const state = stateFactory.createInspectionExpressionState();
    const original = { kind: "param", name: "original" };
    const draft = () => state.draft() ?? state.savedDraft() ?? original;
    const untouched = makeUntouched(fn => fn, state, JSON.stringify, draft, () => original);
    expect(untouched()).toBe(true);
    state.setSavedDraft({ kind: "param", name: "changed" });
    expect(untouched()).toBe(false);
  });
  const effectStart = inspectionControllerSource.indexOf("  createEffect(() => ({ node: draft(), reading: printedSource() })");
  const effectEnd = inspectionControllerSource.indexOf("  function changeCode(", effectStart);
  if (effectStart < 0 || effectEnd <= effectStart) throw new Error("Inspection source effect boundary changed");
  const sourceEffect = inspectionControllerSource.slice(effectStart, effectEnd);
  const printedSourceEffect = new Function("createEffect", "draft", "printedSource", "state", "draftValueFingerprint",
    transpiler.transformSync(sourceEffect));
  // B4 unit C: the printed source carries its own reading (the shared
  // `expressionTextReadability`: no parse of unreadable text).
  const initializePrintedSource = (createEffect, draft, source, state, fingerprint, parseFenel, codeLensTextIsReadable) =>
    printedSourceEffect(createEffect, draft, () => {
      const text = source();
      if (!codeLensTextIsReadable(text)) return { text, readable: false };
      try { parseFenel(text); return { text, readable: true }; }
      catch (error) { return { text, readable: true, parseError: error instanceof Error ? error.message : String(error) }; }
    }, state, fingerprint);
  test("an unprintable admitted reference keeps Visual editable and Apply never parses its generated diagnostic", async () => {
    const { parse } = await import("../../../../../implementations/typescript/engine/src/fenel-parser");
    const { dispatchedCodeLensTextIsReadable } = await import("../../../../../implementations/typescript/engine/src/engine-bodies-dispatch");
    const value = { kind: "literal", value: { $ref: "exact-reader-uuid" } };
    const f = await fixture({ original: value, save: () => "data" });
    let parses = 0;
    initializePrintedSource((compute, apply) => apply(compute()), f.draft, f.printed, f.state, JSON.stringify,
      text => { parses++; return parse(text); }, dispatchedCodeLensTextIsReadable);
    expect(f.printed()).toContain("<no surface syntax:");
    expect(parses).toBe(0);
    expect(f.state.sourceError()).toBeUndefined();
    expect(f.state.sourceUnavailable()).toContain("edit it in the editor");
    f.surface.changeCode("42");
    expect(f.state.draft()).toBeUndefined();
    await f.surface.saveChanges();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0][1]).toEqual(value);
    expect(f.state.saveError()).toBeUndefined();
    expect(f.state.saveNotice()).toBe("Saved.");
  });
  test("generated text recovery for the same AST updates Code without replacing private comments", async () => {
    const { parse } = await import("../../../../../implementations/typescript/engine/src/fenel-parser");
    const { dispatchedCodeLensTextIsReadable } = await import("../../../../../implementations/typescript/engine/src/engine-bodies-dispatch");
    const f = await fixture();
    let printed = "<no surface syntax: pending name>";
    const initialize = () => initializePrintedSource((compute, apply) => apply(compute()), f.draft,
      () => printed, f.state, JSON.stringify, parse, dispatchedCodeLensTextIsReadable);
    initialize();
    expect(f.state.sourceUnavailable()).toBeTruthy();
    printed = "1";
    initialize();
    expect(f.state.sourceUnavailable()).toBeUndefined();
    expect(f.state.sourceText()).toBe("1");
    f.surface.changeCode("-- keep my comment\n1");
    initialize();
    expect(f.state.sourceText()).toBe("-- keep my comment\n1");
    expect(f.state.sourceError()).toBeUndefined();
  });
  test("actual incomplete Code blocks Apply until Cancel and a visual edit replaces generated unavailable text", async () => {
    const { parse } = await import("../../../../../implementations/typescript/engine/src/fenel-parser");
    const { dispatchedCodeLensTextIsReadable } = await import("../../../../../implementations/typescript/engine/src/engine-bodies-dispatch");
    const f = await fixture({ original: { kind: "literal", value: { $ref: "exact-reader-uuid" } } });
    const initialize = () => initializePrintedSource((compute, apply) => apply(compute()), f.draft, f.printed,
      f.state, JSON.stringify, parse, dispatchedCodeLensTextIsReadable);
    initialize();
    f.state.setDraft({ kind: "literal", value: 42 });
    initialize();
    expect(f.state.sourceUnavailable()).toBeUndefined();
    expect(f.state.sourceText()).toBe("42");
    f.surface.changeCode("(");
    initialize();
    expect(f.state.sourceError()).toBeTruthy();
    expect(f.state.sourceText()).toBe("(");
    await f.surface.saveChanges();
    expect(f.calls).toHaveLength(0);
    f.surface.cancelChanges();
    initialize();
    expect(f.state.sourceError()).toBeUndefined();
    expect(f.state.sourceUnavailable()).toBeTruthy();
    expect(f.draft().value.$ref).toBe("exact-reader-uuid");
  });

  const targetStart = source.indexOf("    async saveInspection(");
  const target = source.slice(targetStart, source.indexOf("    revision:", targetStart)).trim()
    .replace("async saveInspection(", "async function saveInspection(").replace(/,\s*$/, "");
  const makeTarget = new Function("scope", "sessionEpoch", "root", "props", "assertCurrentSession", "getFunctionByName",
    "persistedFunctionDefinition", "prepareAuthoringSessionForFunction", "draftValueFingerprint", "toLogic", "api",
    "functionDefinitionOwner", "revalidate", "reloadUserRegistries", "valueScope", "homeData", "writeValueScopeExpression",
    "projectAuthoredExpression", "expressionEditOptions", "replaceExpressionAt", "reader",
    "rootSourceTicket = () => ({ origin: undefined })", "assertSourceTicket = () => {}", "captureSourceTicket = () => ({ origin: undefined })",
    // B4 unit D item 2: a Local reader's definition check and body lowering
    // run in its worker (a stand-in here); page readers never reach them.
    "runLocalReaderAction = undefined", "readLocalDefinition = undefined", "loweredLogic = undefined",
    "homeAuthoringSession = () => undefined", "client = {}", "registryTransportSnapshot = undefined",
    // Fix lane A (Nov 8): the value branch refuses a loading scope and checks
    // the authored containers with the shared writer's own predicate.
    "valueScopeLoading", "editableContainerAt",
    `${transpiler.transformSync(target)}; return saveInspection;`);
  function saveTarget(options = {}) {
    let currentSource = options.sourceOrigin;
    const sourceTicket = { origin: currentSource };
    let currentScope = { kind: "value", viewId: "root", itemId: "record", path: options.path ?? ["nested"] };
    let root = { revision: options.revision ?? 7, canEdit: options.writable !== false };
    const initialScope = currentScope;
    const fn = { id: "fn-identity", params: [{ name: "x" }], returns: { $ref: "Number" }, body: { var: "x" } };
    const state = { ok: true, item: { id: "record" }, sourceExpression: options.source ?? { kind: "literal", value: { nested: 1 } },
      rootRevision: root.revision, sourceTicket };
    const calls = [], workerRequests = [];
    const local = options.reader?.kind === "local";
    // A Local reader's page session refuses every registry read.
    const session = local ? { get registry() { throw new Error("Page registry read for a Local reader"); } } : { registry: { getFunction: () => fn } };
    const worker = async (_reader, _session, query, read, requestOptions) => {
      workerRequests.push({ query, via: requestOptions.via });
      // The worker's reply crosses the canonical transport (keys sorted).
      return read(query.method === "project-reader-references" ? registryTransportSnapshot({ references: [{ target: query.targets[0],
        reference: { definition: { fn } } }] }, "fixture worker references result")
        : { lowered: { $tag: "Ok", _0: { logic: exprNodeToLogic(query.node), emptySlot: false } } });
    };
    const readDefinition = new Function(`${transpiler.transformSync(source.slice(source.indexOf("function readLocalDefinition("),
      source.indexOf("/** Every live value belongs")))}; return readLocalDefinition;`)();
    const lowered = reply => reply.lowered._0.logic;
    const save = makeTarget(() => currentScope, () => 1, () => root, { publicData: options.public ? {} : undefined },
      epoch => { if (epoch !== 1) throw Error("Session changed"); }, async () => ({ definition: {
        id: options.reader?.kind === "local" ? fn.id : "storage-row",
        name: options.reader?.kind === "local" ? fn.id : "Account.function", isSystem: options.system === true,
      } }), stateFactory.persistedFunctionDefinition, async () => session, JSON.stringify,
      body => exprNodeToLogic(body), { definitionBundleSave: async bundle => { calls.push({ bundle }); } },
      stateFactory.functionDefinitionOwner, keys => calls.push({ revalidate: keys }), async () => { calls.push({ reload: true }); },
      () => state, { canWrite: () => options.writable !== false, canEditExpression: () => options.writable !== false,
        revision: () => 0, replace: async (...args) => { calls.push({ replace: args }); } },
      async (...args) => { calls.push({ writeValueScopeExpression: args }); }, authoredProjection, () => ({}), replaceExpressionAt, options.reader,
      () => ({ origin: currentSource }), ticket => { if (ticket.origin !== currentSource) throw Error("The data source changed while editing"); },
      () => ({ origin: currentSource }), worker, readDefinition, lowered, () => undefined, {}, registryTransportSnapshot,
      () => false, editableContainerAt);
    return { save, fn, state, calls, workerRequests, session, initialTicket: sourceTicket, origin: { scope: initialScope, epoch: 1, rootRevision: root.revision, sourceTicket },
      setSource: next => { currentSource = next; },
      changeRevision: revision => { root = { ...root, revision }; }, changeFocus: () => { currentScope = { ...currentScope, path: [] }; } };
  }
  test("an owned function saves through the same admitted row and owner bundle wire as EditModal", async () => {
    const f = saveTarget();
    expect(await f.save({ id: "$self" }, { kind: "literal", value: 42 }, f.fn, f.origin)).toBe("data");
    expect(f.calls[0]).toEqual({ bundle: { ownerMutations: [{ kind: "upsert", owner: { ownerKey: "function:Account.function",
      kind: "function", storageName: "Account.function", storageId: "storage-row", definition: { ...f.fn, body: 42 } } }] } });
    expect(f.calls).toHaveLength(3);
  });
  test("a captured local function saves its nominal identity without inventing a server storage row", async () => {
    const f = saveTarget({ reader: { kind: "local" } });
    expect(await f.save({ id: "$self" }, { kind: "literal", value: 42 }, f.fn, f.origin)).toBe("data");
    expect(f.calls[0]).toEqual({ bundle: { ownerMutations: [{ kind: "upsert", owner: {
      ownerKey: `function:${f.fn.id}`, kind: "function", storageName: f.fn.id, definition: { ...f.fn, body: 42 },
    } }] } });
    expect(f.calls[0].bundle.ownerMutations[0].owner).not.toHaveProperty("storageId");
    expect(f.calls).toHaveLength(3);
    // B4 unit D item 2: both reads ran in the function's worker frame.
    expect(f.workerRequests.map(row => [row.query.method, row.via])).toEqual([["project-reader-references", f.session],
      ["lower-reader-expression", f.session]]);
    expect(f.workerRequests[1].query).toEqual({ method: "lower-reader-expression", node: { kind: "literal", value: 42 },
      savedExpressions: [], unresolved: true });
  });
  test("repository functions and public/composite expressions save locally without account writes", async () => {
    for (const options of [{ system: true }, { public: true }]) {
      const f = saveTarget(options);
      expect(await f.save({ id: "$self" }, { kind: "literal", value: 42 }, f.fn, f.origin)).toBe("lens");
      expect(f.calls).toEqual([]);
    }
    const composite = saveTarget();
    expect(await composite.save({ id: "$lens:root" }, { kind: "literal", value: [] }, undefined, composite.origin)).toBe("lens");
    expect(composite.calls).toEqual([]);
  });
  test("owned read-only data and a changed captured revision/focus cannot acquire a write", async () => {
    const readonly = saveTarget({ writable: false });
    await expect(readonly.save({ id: "$self" }, { kind: "literal", value: 42 }, readonly.fn, readonly.origin)).rejects.toThrow("read-only");
    const revision = saveTarget();
    revision.changeRevision(8);
    await expect(revision.save({ id: "$self" }, { kind: "literal", value: 42 }, undefined, revision.origin)).rejects.toThrow("changed");
    const focus = saveTarget();
    focus.changeFocus();
    await expect(focus.save({ id: "$self" }, { kind: "literal", value: 42 }, undefined, focus.origin)).rejects.toThrow("lens changed");
    expect([...readonly.calls, ...revision.calls, ...focus.calls]).toEqual([]);
  });
  test("an inspector opened on virtual14 refuses a retired source even when the current server root also says14", async () => {
    const f = saveTarget({ sourceOrigin: {}, revision: 14 });
    f.setSource(undefined);
    await expect(f.save({ id: "$self" }, { kind: "literal", value: 42 }, f.fn, f.origin)).rejects.toThrow("data source changed while editing");
    expect(f.calls).toEqual([]);
  });
  test("an authored nested value reconstructs its parent through the existing scope writer", async () => {
    const f = saveTarget();
    const changed = { kind: "literal", value: 42 };
    expect(await f.save({ id: "$self" }, changed, undefined, f.origin)).toBe("data");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].writeValueScopeExpression.slice(0, 2)).toEqual([f.state, replaceExpressionAt(f.state.sourceExpression, ["nested"], changed)]);
    expect(f.calls[0].writeValueScopeExpression[4]).toBe(f.initialTicket);
    expect(f.state.sourceExpression.value.nested).toBe(1);
  });
  test("a selected computed result saves its producer at the authored prefix while preserving sibling sources", async () => {
    const producer = { kind: "call", fnId: "original", args: [] };
    const sibling = { kind: "ref", savedExprId: "retained-saved-source" };
    const original = { kind: "literal", value: { __record: { fields: [{ name: "nested", value: producer }, { name: "sibling", value: sibling }] } } };
    const f = saveTarget({ source: original, path: ["nested", 1] });
    const changed = { kind: "call", fnId: "changed", args: [] };
    expect(await f.save({ id: "$self" }, changed, undefined, f.origin)).toBe("data");
    const written = f.calls[0].writeValueScopeExpression[1];
    expect(expressionAt(written, ["nested"])).toBe(changed);
    expect(expressionAt(written, ["sibling"])).toBe(sibling);
    expect(expressionAt(original, ["nested"])).toBe(producer);
  });
});

describe("prepared lens navigation settings", () => {
  const start = source.indexOf("  function contextItems(menu: MenuTarget)");
  const contextSource = source.slice(start, source.indexOf("  let acceptedShellAction", start));
  const makeMenu = new Function("enterScopeFor", "parentScope", "scope", "homeData", "locusOpenMenuItems", "props",
    "navigateScope", "openInspection", "codeItemId", "itemFunction", "savedExprById", "homeAuthoringSession", "readingClipboard",
    "scopeKey", "locusLayoutOptions", "dataSuggestions",
    // An editable account root offers no public demo copy branch.
    "itemDemoCopy = () => undefined", "focusDemoCopy = () => undefined",
    // B4 wave 4 lane H: a page reader (the Local branch reads its catalogue).
    "reader = undefined",
    // Data suggestions rows are another menu's concern here (none requested).
    "contextDataSuggestionItems = () => []",
    `${transpiler.transformSync(contextSource)}; return contextItems;`);
  const target = { kind: "value", viewId: "root", itemId: "record", path: ["nested"], rootItem: true };
  function menu() {
    const moves = [];
    const modes = [];
    const item = { id: "$field:nested" };
    const contextItems = makeMenu(() => target, () => undefined, () => ({ kind: "root" }),
      { canLift: () => false, canWrite: () => false, evaluated: () => undefined,
        dataTarget: () => undefined, listSummary: () => undefined }, locusOpenMenuItems, {},
      next => moves.push(next), (next, mode) => modes.push({ item: next, mode }), () => undefined,
      () => undefined, () => new Map(), () => ({}), () => false,
      scopeKey, () => [], { items: () => [] });
    return { items: contextItems({ item, focus: { kind: "root" } }), item, moves, modes };
  }
  test("ordinary Open focuses the current lens without changing its panel settings", () => {
    const current = menu();
    current.items.find(item => item.id === "open").onSelect();
    expect(current.moves).toEqual([target]);
    expect(current.modes).toEqual([]);
  });
  test("only explicit Open panel choices select a mode for the focused occurrence", () => {
    const current = menu();
    for (const child of current.items.find(item => item.id === "open").children) child.onSelect();
    expect(current.modes).toEqual(["data", "expression", "code", "both"].map(mode => ({ item: current.item, mode })));
    expect(current.moves).toEqual([]);
  });
});

describe("held type exploration", () => {
  const from = source.indexOf("function heldTypeForInspection(");
  const heldType = new Function("readLocusCatalogReference", "isFenelTypeLike",
    `${transpiler.transformSync(source.slice(from, source.indexOf("/** One heading", from)))}; return heldTypeForInspection;`)(
      readLocusCatalogReference, isFenelTypeLike);
  const record = { $record: { fields: [] } };
  const targets = new Map([
    ["ContactInput", { kind: "type", value: record }],
    ["calculate", { kind: "function", value: { params: [], returns: record } }],
  ]);
  const resolve = reference => targets.get(reference.id);
  const card = value => locusCatalogReferenceMetadata(value, resolve) ?? null;

  test("all existing editor type forms reach the shared playground without expression evaluation", () => {
    for (const kind of TYPE_KIND_GROUPS.flatMap(group => group.kinds)) {
      const value = defaultTypeForKind(kind);
      // Pure refs require the positive captured catalog lookup below.
      if (readLocusCatalogReference(value)) continue;
      expect(heldType(value, card, resolve)).toEqual({ source: value, definition: value });
    }
    expect(heldType({ call: ["calculate"] }, card, resolve)).toBeUndefined();
    for (const value of ["ordinary data", 42, undefined, {}, []]) expect(heldType(value, card, resolve)).toBeUndefined();
  });

  test("registered type refs retain the source ref while legacy refs use their captured target", () => {
    const reference = { $ref: "ContactInput" };
    expect(heldType(reference, card, resolve)).toEqual({ source: reference, definition: record });
    expect(heldType({ $pin: "entity", id: "ContactInput" }, card, resolve)).toEqual({ source: record, definition: record });
    expect(heldType({ $ref: "calculate" }, card, resolve)).toBeUndefined();
    expect(heldType({ $ref: "missing" }, card, resolve)).toBeUndefined();
    expect(heldType(reference, () => null, resolve)).toBeUndefined();
  });

  test("the same ref uses the captured reader's target and cannot borrow another reader's type", () => {
    const reference = { $ref: "ContactInput" };
    expect(heldType(reference, card, resolve)).toEqual({ source: reference, definition: record });
    expect(heldType(reference, () => null, () => undefined)).toBeUndefined();
  });

  const headingFrom = source.indexOf("function ValueCardHeading(");
  const heading = source.slice(headingFrom, source.indexOf("function TypeInspectionDialog(", headingFrom));
  const itemsFrom = heading.indexOf("items={[") + "items={".length;
  const menuItems = new Function("menu", "create", "data", "setInspectingType", "TYPE_ICON_FALLBACKS",
    `${transpiler.transformSync(`const items = ${heading.slice(itemsFrom, heading.indexOf("]} />", itemsFrom) + 1)};`)} return items;`);

  test("Inspect type keeps the type of the data while Explore this type uses the held type and captured session", () => {
    const captures = [];
    const session = { registry: {} };
    const universe = { $type: true };
    const menu = { type: universe, heldType: { source: record, definition: record }, session };
    const items = menuItems(() => menu, {}, { canAdd: () => false }, inspection => captures.push(inspection), { Type: "type-set" });
    items.find(item => item.id === "inspect-type").onSelect();
    items.find(item => item.id === "explore-type").onSelect();
    expect(captures).toEqual([{ type: universe, session }, { type: record, definition: record, session }]);
    expect(heading).toContain("heldType: heldTypeForInspection(props.value, catalogCardOf, resolveCatalogReference)");
    expect(heading).toContain("session={inspection().session}");
    expect(heading).toContain("definition={inspection().definition}");
  });

  test("ordinary data keeps the existing Type actions without an extra type-value action", () => {
    const items = menuItems(() => ({ type: { $ref: "Number" }, session: {} }), {}, { canAdd: () => true }, () => {}, { Type: "type-set" });
    expect(items.map(item => item.id)).toEqual(["new-of-type", "inspect-type"]);
  });
});

describe("focused data presentation", () => {
  const start = source.indexOf("function focusedLocusItem(");
  const focusItem = new Function("scopeLabel", `${transpiler.transformSync(source.slice(start,
    source.indexOf("function ValueCardHeading(", start)))}; return focusedLocusItem;`)(scopeLabel);
  const item = { id: "standard-library", caption: "Standard library", representations: {
    Labelable: { label: "Standard library" }, Iconable: { icon: "stack" },
  }, source: { kind: "expr", expr: { kind: "literal", value: { $ref: "std:$" } } } };
  const here = path => ({ kind: "value", viewId: "root", itemId: item.id, path, rootItem: true });

  test("a selected child retains its origin without parent Labelable or Iconable overrides", () => {
    const selected = focusItem(item, here(["$"]));
    expect(selected.caption).toBe("$");
    expect(selected.representations).toBeUndefined();
    expect(selected.id).toBe(item.id);
    expect(selected.source).toBe(item.source);
    expect(item.representations.Iconable.icon).toBe("stack");
  });
  test("a direct occurrence keeps its explicit presentation and pass-through children use their logical caption", () => {
    expect(focusItem(item, here([]))).toBe(item);
    expect(focusItem(item, { ...here([2, "item"]), passThrough: [1] }).caption).toBe("Item 3");
  });
  test("the early field projection drops parent name and icon exactly as the prepared owner does", () => {
    const earlyStart = earlySource.indexOf("  function previewForScope(");
    const earlyProjection = earlySource.slice(earlyStart, earlySource.indexOf("  const focusedFields =", earlyStart));
    let focus = here([]);
    const parent = { ...item, valueType: { $record: { fields: [{ name: "one", type: { $ref: "String" } }] } },
      source: { kind: "expr", expr: { kind: "literal", value: { __record: { fields: [
        { name: "one", value: { kind: "literal", value: "Child data" } },
      ] } } } } };
    const project = new Function("createMemo", "displayFocus", "current", "previewExpression",
      `${transpiler.transformSync(earlyProjection)}; return focusedPreview;`)(fn => fn, () => focus,
      () => ({ items: [parent] }), occurrence => occurrence.source.expr);
    expect(project().item.representations).toBe(parent.representations);
    focus = here(["one"]);
    const child = project();
    expect(child.original).toBe(parent);
    expect(child.item.id).toBe(parent.id);
    expect(child.item.caption).toBe("one");
    expect(child.item.representations).toBeUndefined();
    expect(child.item.representations).toEqual(focusItem(parent, focus).representations);
    expect(child.item.source.expr).toEqual({ kind: "literal", value: "Child data" });
    expect(child.item.valueType).toEqual({ $ref: "String" });
  });
  // The heading's valueIcon and the toolbar's summaryIcon became reader
  // presentations in 60a61cfe (valuePresentation / summaryPresentation through
  // ownPresentationFromReaderSnapshot); home-caption-glyphs.test.mjs runs those
  // actual memos, including the root's static icon and held references.
  test("expanded list descriptions retain the exact argument from early transport through the prepared heading", () => {
    const namedTypeStart = source.indexOf("function recipeDeclaredType(");
    const namedTypeSource = source.slice(namedTypeStart, source.indexOf("/** The card and current-data header", namedTypeStart));
    const presentationStart = source.indexOf("function useDataTypePresentation(");
    const presentationSource = source.slice(presentationStart, source.indexOf("/** Nested data keeps", presentationStart));
    const labelStart = source.indexOf("function typeLabel(");
    const labelSource = source.slice(labelStart, source.indexOf("function typeTerm(", labelStart));
    const readLabelStart = typedReadSource.indexOf("export function typedReadTypeLabel(");
    const readLabelSource = typedReadSource.slice(readLabelStart, typedReadSource.indexOf("/** The same checked type facts", readLabelStart)).replace("export function", "function");
    const cardLabelStart = displayNameSource.indexOf("export function valueCardLabel(");
    const typeLabelStart = valueCardSource.indexOf("export function valueCardTypeLabel(");
    const cardLabelSource = (displayNameSource.slice(cardLabelStart, displayNameSource.indexOf("export function humanName(", cardLabelStart))
      + valueCardSource.slice(typeLabelStart, valueCardSource.indexOf("/** Shared card chrome", typeLabelStart))).replaceAll("export function", "function");
    const makePresentation = new Function("createMemo", "useHomeReader", "typeConstructorOf", "heldTypeForInspection", "refHandle",
      "classifyData", "carrierTypeName", "detectTypeKind", "TYPE_KIND_LABELS", "peelListForAuthoring", "resolveEffect",
      "LUCIDE_BY_NAME", "TYPE_ICON_FALLBACKS", "locale", "typePhrase", "typeCode", "typeIconForPresentation", "readerResultTypeLabel",
      "readerTypeLabelInSession", "readLocusCatalogReference",
      `${transpiler.transformSync(cardLabelSource + readLabelSource + namedTypeSource + presentationSource + labelSource)}; return useDataTypePresentation;`);
    const session = { evaluateContext: {}, registry: { getIdentifiedEntity: () => undefined }, environment: {} };
    const presentation = makePresentation(fn => fn, () => ({
      reader: undefined, homeAuthoringSession: () => session,
      catalogReferenceType: () => undefined, catalogCardOf: () => undefined, resolveCatalogReference: () => undefined,
      getLabel: () => undefined, getCodeName: () => undefined,
    }), value => { expect(value).toBeUndefined(); return undefined; }, () => undefined, refHandle,
    () => { throw new Error("An unavailable root value must not be classified"); }, carrierTypeName, detectTypeKind,
    TYPE_KIND_LABELS, peelListForAuthoring, () => undefined, { list: true }, { List: "list" }, value => value, typePhrase, typeCode, typeIconForPresentation, readerResultTypeLabel,
    readerTypeLabelInSession, readLocusCatalogReference);
    for (const [type, expected] of [[List(Anything), "List of anything"], [List({ $ref: "Image" }), "List of images"]]) {
      const early = projectLocusTypeDescriptions({ type })[0]!;
      const prepared = presentation({ type, declaredType: type })();
      expect(early.phrase).toBe(`A ${expected.toLowerCase()}`);
      expect(prepared.detailLabel).toBe(expected);
      expect(prepared.type).toBe(type);
      expect(prepared.icon).toBe("list");
    }
  });
});

describe("function type presentation", () => {
  const start = source.indexOf("function inspectionArrowText(");
  const arrow = new Function("typeCode", "projectAuthoringScheme",
    `${transpiler.transformSync(source.slice(start, source.indexOf("function FunctionInspectionSignature", start)))}; return inspectionArrowText;`)
    (typeCode, projectAuthoringScheme);
  const field = (name, type) => ({ name, type, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} });
  const atom = name => ({ $ref: name });
  const type = (params, returns) => ({ $arrow: { params, returns } });
  const entry = (params, returns) => ({ id: "apply", kind: "function", label: "Apply", description: "", params, returns });

  test("the default arrow makes right association explicit while preserving callable inputs", () => {
    expect(arrow(entry([field("a", atom("A")), field("b", atom("B"))], atom("C"))))
      .toBe("A → (B → C)");
    expect(arrow(entry([field("a", atom("A"))], type([field("b", atom("B"))], atom("C")))))
      .toBe("A → (B → C)");
    expect(arrow(entry([field("callback", type([field("a", atom("A"))], atom("B"))), field("value", atom("A"))], atom("B"))))
      .toBe("(A → B) → (A → B)");
  });

  test("checked quantified signatures take precedence without promoting an unavailable scheme", () => {
    const params = [field("callback", type([field("value", { $var: "a" })], { $var: "b" })), field("value", { $var: "a" })];
    const checked = { ...entry([field("stale", atom("String"))], atom("Number")), signatureOutcome: { $tag: "Solved" },
      scheme: { quantified: [{ id: "q0", sourceName: "a", kind: { $tag: "KType" } },
        { id: "q1", sourceName: "b", kind: { $tag: "KType" } }], body: type(params, { $var: "b" }) } };
    expect(arrow(checked)).toBe("∀ a b. (a → b) → (a → b)");
    expect(arrow({ ...checked, signatureOutcome: { $tag: "AnnotationRequired" } })).toBe("String → Number");
  });
});

describe("inspection source projection", () => {
  test("detached Code printing reuses canonical catalog routes only for the same admitted target", async () => {
    const { createAuthoringEnvironment } = await import("../../../../../implementations/typescript/engine/src/authoring/environment");
    const { createDetachedAuthoringEnvironment } = await import("./expression-runner/detached-authoring-environment");
    const { print } = await import("../../../../../implementations/typescript/engine/src/engine-bodies-dispatch");
    const { parse } = await import("../../../../../implementations/typescript/engine/src/fenel-parser");
    const entry = { id: "std:pow", targetId: "std:pow", kind: "function", codeName: "pow", parentModule: "std", label: "Power", description: "",
      params: [{ name: "base", type: { $ref: "Number" } }, { name: "exponent", type: { $ref: "Number" } }], returns: { $ref: "Number" } };
    const catalog = { types: [], functions: [entry], capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map(),
      exactFunctionRoutes: [{ sourceName: "std.pow", targetId: entry.id, entry }] };
    const base = createAuthoringEnvironment(catalog);
    const environment = createDetachedAuthoringEnvironment(base);
    expect(environment.functionCodeName(entry.id)).toBe("std:pow");
    expect(environment.catalog.operatorCodeNameByNotation instanceof Map).toBe(false);
    const names = sourceNames(createAuthoringEnvironment)({ catalog: environment.catalog, environment });
    expect(names(entry.id)).toBe("std.pow");
    expect(environment.resolveFunctionId(names(entry.id))).toBe(environment.resolveFunctionId(entry.id));
    const expression = { kind: "call", fnId: entry.id, sourceHead: entry.id, sourceTargetId: entry.id,
      args: [{ kind: "literal", value: 1.05 }, { kind: "literal", value: 10 }] };
    const text = print(exprNodeToLogic(projectSource(expression, names)));
    expect(text).toBe("std.pow 1.05 10");
    expect(() => parse(text)).not.toThrow();
    const denied = { ...environment, resolveFunctionId: name => name === "std.pow" ? undefined : environment.resolveFunctionId(name) };
    expect(sourceNames(createAuthoringEnvironment)({ catalog: environment.catalog, environment: denied })(entry.id)).toBe("std:pow");
    expect(expression.sourceHead).toBe("std:pow");
  });

  test("captured canonical call names replace legacy source heads without changing their targets or the admitted draft", async () => {
    const { print } = await import("../../../../../implementations/typescript/engine/src/engine-bodies-dispatch");
    const { parse } = await import("../../../../../implementations/typescript/engine/src/fenel-parser");
    const targets = new Map([["std:pow", "power-id"], ["pow", "power-id"], ["std:mul", "multiply-id"], ["mul", "multiply-id"]]);
    const names = new Map([["power-id", "pow"], ["multiply-id", "mul"]]);
    const expression = logicToExprNode({ call: ["std:mul", { call: ["std:pow", 1.05, 10] }, 1000] }, [], name => targets.get(name));
    const original = structuredClone(expression);
    const projected = projectSource(expression, id => names.get(id));
    const logic = exprNodeToLogic(projected);
    const text = print(logic);
    expect(text).not.toContain("std:");
    expect(logic).toEqual({ call: ["mul", { call: ["pow", 1.05, 10] }, 1000] });
    const parsed = logicToExprNode(parse(text), [], name => targets.get(name));
    expect(parsed.fnId).toBe("multiply-id");
    expect(parsed.args[0].fnId).toBe("power-id");
    expect(expression).toEqual(original);
    expect(expression.args[0].sourceHead).toBe("std:pow");
    const privateProjection = projectSource(expression, id => id === "power-id" ? "privatePower" : names.get(id));
    expect(exprNodeToLogic(privateProjection).call[1].call[0]).toBe("privatePower");
  });

  test("the actual canonical printer renders the admitted apply body and nested argument order", async () => {
    const { print } = await import("../../../../../implementations/typescript/engine/src/engine-bodies-dispatch");
    for (const [body, expected] of [
      [{ call: [{ var: "f" }, { var: "x" }] }, "f x"],
      [{ call: [{ var: "f" }, { call: [{ var: "g" }, { var: "x" }] }, { var: "y" }] }, "f (g x) y"],
    ]) {
      const expr = logicToExprNode(body, ["f", "g", "x", "y"]);
      const original = structuredClone(expr);
      const projected = projectSource(expr);
      expect(print(exprNodeToLogic(projected))).toBe(expected);
      expect(expr).toEqual(original);
      expect(exprNodeToLogic(expr)).toEqual(body);
    }
  });

  test("lambda, record and constructor child slots use the same source projection", () => {
    const application = { call: [{ var: "f" }, { var: "x" }] };
    const expression = logicToExprNode({ fn: ["f", "x", { construct: ["Packet", { callback: application,
      nested: { callback: application } }] }] });
    const original = structuredClone(expression);
    const projected = exprNodeToLogic(projectSource(expression));
    const expectedApply = { apply: [{ var: "f" }, [{ var: "x" }]] };
    expect(projected).toEqual({ fn: ["f", "x", { construct: ["Packet", { callback: expectedApply,
      nested: { callback: expectedApply } }] }] });
    expect(expression).toEqual(original);
  });

  test("source literal, tagged data, variable defaults and captured closures retain their data", () => {
    const application = logicToExprNode({ call: [{ var: "f" }, { var: "x" }] });
    for (const value of [
      { sourceLiteral: application },
      { $tag: "Packet", __apply: application.value.__apply },
      { __fenelFn: true, __apply: application.value.__apply },
      { __fenelPartial: true, __apply: application.value.__apply },
      { __fenelClosure: true, __apply: application.value.__apply },
      { __var: { path: "f", arrayForm: true, fallback: application } },
    ]) {
      const expression = { kind: "literal", value };
      expect(projectSource(expression)).toBe(expression);
      expect(expression.value).toBe(value);
    }
    const noArguments = logicToExprNode({ call: [{ var: "f" }] });
    expect(exprNodeToLogic(projectSource(noArguments))).toEqual({ call: [{ var: "f" }] });
  });
});

function queue(write = async () => {}, refresh = async () => {}) {
  const writes = [];
  const persistence = createViewPersistence({
    delay: 60_000, changed: () => {}, refresh,
    write: async (id, next) => { writes.push({ id, next }); await write(id, next); },
  });
  return { ...persistence, writes };
}

describe("Home Call input guard", () => {
  const modalStart = source.indexOf("function FunctionCallModalContent(");
  const callStart = source.indexOf("  const inputValues = createProjection", modalStart);
  const callSource = source.slice(callStart, source.indexOf("  const addressPreview =", callStart))
    + source.slice(source.indexOf("  const evaluated = createMemo", callStart), source.indexOf("  const [pinning", callStart));
  const makeCall = new Function("createMemo", "createSignal", "props", "argExprs", "fn", "params", "authoringSession",
    "refResolver", "evaluateAuthoringExpression", "draftSaveIssue", "validationDemo", "cloneDraftValue",
    "createProjection", "detectStructuralForm", "scopedConcreteType", "addressIssues = () => []",
    // B4 slice 2: a page reader (no Local live guidance).
    "reader = undefined", "createLocalLiveGuidance = undefined", "onCleanup = () => {}", "openLiveGuidance = () => {}", "completeLiveDraft = () => false",
    "openLocalLiveGuidance = () => {}",
    `${transpiler.transformSync(callSource)}; return { evaluated, displayedResult, draftIssue, tryInput, resolvedParams };`);

  // Keep the projected object's identity while reading the fixture's current
  // authored data, matching the production derived store's consumer contract.
  const projection = compute => new Proxy({}, {
    get: (_, key) => compute()[key], ownKeys: () => Reflect.ownKeys(compute()),
    getOwnPropertyDescriptor: (_, key) => Object.getOwnPropertyDescriptor(compute(), key),
  });

  test("Call projects declared dependent records visually while retaining raw defaults until the first real edit", () => {
    const text = { $ref: "String" }, number = { $ref: "Number" };
    const field = (name, type, index) => ({ name, type, key: { $tag: "PositionalField", index }, label: Nothing, ui: Nothing, meta: {} });
    const bandType = { $record: { fields: [field("name", text, 0), field("lowerHz", number, 1), field("upperHz", number, 2)] } };
    const dependent = { $el: { call: ["humanSpectrumColorType", { var: "band" }] } };
    const inputType = { $record: { fields: [field("band", bandType, 0), field("frequencyHz", dependent, 1)] } };
    const declared = { $ref: "HumanSpectrumColorInput" };
    const environment = createAuthoringEnvironment({
      types: [{ id: "human-input", entityId: "HumanSpectrumColorInput", name: "Observer input", category: "entity", description: "", type: inputType }],
      functions: [], capabilities: [], catalogTypes: [inputType], operatorCodeNameByNotation: new Map(),
    });
    const defaultValue = Object.freeze({ band: Object.freeze({ name: "Authored band", lowerHz: 400e12, upperHz: 790e12 }), frequencyHz: 550e12 });
    const original = Object.freeze({ kind: "literal", value: defaultValue });
    let arguments_ = [original];
    const visualStart = source.indexOf("                    const visualArgument = createMemo(", modalStart);
    const makeVisual = new Function("createMemo", "argExprs", "idx", "emptyExpressionSlot", "detectStructuralForm", "expressionForLiteralValue", "field", "authoringSession",
      `${transpiler.transformSync(source.slice(visualStart, source.indexOf("                    const dataCandidate", visualStart)))}; return visualArgument;`);
    const visual = makeVisual(compute => compute, () => arguments_, () => 0, () => ({ kind: "literal", value: undefined }), detectStructural,
      expressionForLiteralValue, () => ({ type: declared }), () => ({ environment }));
    const displayed = visual();
    expect(displayed.value.__record.fields.map(field => field.name)).toEqual(["band", "frequencyHz"]);
    expect(expressionAt(displayed, ["frequencyHz"])).toEqual({ kind: "literal", value: 550e12 });
    expect(arguments_[0]).toBe(original);
    expect(exprNodeToLogic({ kind: "call", fnId: "observer", args: arguments_ })).toEqual({ call: ["observer", defaultValue] });
    const setterStart = source.indexOf("  function setArg(idx:", modalStart);
    let tried = "previous result";
    const change = new Function("setTriedInput", "setArgExprs", "props", "setAddressIssues", "untrack", "argExprs", "callGuidance = undefined", "setPinRefusal = () => {}", "addressDecodePending = () => false", `${transpiler.transformSync(source.slice(setterStart,
      source.indexOf("  // Modal header", setterStart)))}; return setArg;`)(
      value => { tried = value; }, value => { arguments_ = value; }, {}, () => {}, compute => compute(), () => arguments_);
    const edited = replaceExpressionAt(displayed, ["frequencyHz"], { kind: "literal", value: 650e12 });
    change(0, edited);
    expect(arguments_[0]).toBe(edited);
    expect(tried).toBeUndefined();
    expect(expressionAt(arguments_[0], ["frequencyHz"])).toEqual({ kind: "literal", value: 650e12 });
    expect(defaultValue.frequencyHz).toBe(550e12);
    expect(expressionAt(arguments_[0], ["band"]).value).toEqual(defaultValue.band);
    arguments_ = [{ kind: "literal", value: { ...defaultValue, extra: "Keep unsupported data" } }];
    expect(visual()).toEqual(arguments_[0]);
    expect(visual().value).toBe(arguments_[0].value);
    arguments_ = [{ kind: "literal", value: { $tag: "HumanSpectrumColorInput", ...defaultValue } }];
    expect(visual()).toEqual(arguments_[0]);
    expect(visual().value).toBe(arguments_[0].value);
    arguments_ = [{ kind: "call", fnId: "retained-computation", args: [] }];
    expect(visual()).toBe(arguments_[0]);
    arguments_ = [{ kind: "literal", value: undefined }];
    expect(visual()).toBe(arguments_[0]);
  });

  test("Call uses the declared record data renderer for a retained tagged literal without a solved constructor witness", () => {
    const number = { $ref: "Number" }, text = { $ref: "String" };
    const field = (name, type, index) => ({ name, type, key: { $tag: "PositionalField", index }, label: Nothing, ui: Nothing, meta: {} });
    const bandType = { $record: { fields: [field("name", text, 0), field("lowerHz", number, 1), field("upperHz", number, 2)] } };
    const inputType = { $record: { fields: [field("band", bandType, 0), field("frequencyHz", { $el: { call: ["humanSpectrumColorType", { var: "band" }] } }, 1)] } };
    const declared = { $ref: "HumanSpectrumColorInput" };
    const environment = createAuthoringEnvironment({ types: [{ id: "human", name: "Observer data", entityId: "HumanSpectrumColorInput", description: "", category: "entity", type: inputType }],
      functions: [], capabilities: [], catalogTypes: [inputType], operatorCodeNameByNotation: new Map() });
    const session = { environment, registry: { getIdentifiedEntity: () => { throw Error("Use the captured declared type"); } } };
    const originalValue = Object.freeze({ $tag: "HumanSpectrumColorInput", band: Object.freeze({ name: "Declared band", lowerHz: 400e12, upperHz: 790e12 }), frequencyHz: 550e12,
      extra: "Preserve source fields" });
    let original = { kind: "literal", value: originalValue };
    const selectorStart = source.indexOf("                    const recordCandidate = createMemo(", modalStart);
    const selector = new Function("createMemo", "dataCandidate", "visualArgument", "readLocusCatalogReference", "isFenelTypeLike", "detectStructuralForm", "authoringSession", "inlineWidgetFor", "field", "resolveValueType",
      `${transpiler.transformSync(source.slice(selectorStart, source.indexOf("                    return (", selectorStart)))}; return recordCandidate;`)(
      compute => compute, () => original, () => expressionForLiteralValue(original.value, declared, environment),
      readLocusCatalogReference, isFenelTypeLike, detectStructural, () => session, inlineWidgetFor, () => ({ type: declared }), resolveValueType);
    expect(selector()).toBe(original);
    expect(selector().value).toBe(originalValue);
    // Exercise RecordEditor's actual callback through the shared controller's
    // edit port and the real captured-frame Fenel edit oracle. This controlled
    // stable snapshot does not model a live worker or its replacement lifetime.
    const recordStart = fieldRendererSource.indexOf("function RecordEditor(");
    const recordSource = fieldRendererSource.slice(recordStart, fieldRendererSource.indexOf("/** Freeform", recordStart));
    const callbackStart = recordSource.indexOf("            const change = createMemo(");
    const callbackEnd = recordSource.indexOf("            return <Show when={admitted()}", callbackStart);
    expect(callbackStart).toBeGreaterThanOrEqual(0);
    expect(callbackEnd).toBeGreaterThan(callbackStart);
    expect(recordSource).toContain("onChange={change().callback}");
    let updated, editError;
    const editRequests = [], snapshot = {};
    const frame = { _constructors: { HumanSpectrumColorInput: ["band", "frequencyHz"] } };
    const preparation = {
      input: () => snapshot,
      edit: (name, value, publish) => {
        editRequests.push({ field: name, edited: value });
        const edited = fieldRecordEditPlan(originalValue, name, value, frame);
        if (edited.$tag === "Err") { editError = edited._0; return; }
        publish(edited._0);
      },
    };
    const publication = { callback: value => { updated = value; } };
    // The current snapshot is stable here; the real Solid browser suite also
    // checks replacement and late callbacks across accepted cloned plans.
    const change = new Function("createMemo", "latest", "publication", "field", "preparation",
      `${transpiler.transformSync(recordSource.slice(callbackStart, callbackEnd))}; return change().callback;`)(
      compute => { const value = compute(); return () => value; }, accessor => accessor(), () => publication,
      () => ({ name: "frequencyHz" }), preparation);
    change(650e12);
    expect(editRequests).toEqual([{ field: "frequencyHz", edited: 650e12 }]);
    expect(editError).toBeUndefined();
    expect(updated.$tag).toBe("HumanSpectrumColorInput");
    expect(updated.extra).toBe(originalValue.extra);
    expect(updated.band).toBe(originalValue.band);
    expect(updated.frequencyHz).toBe(650e12);
    expect(originalValue.frequencyHz).toBe(550e12);
    original = { kind: "literal", value: { $ref: "retained-reference" } };
    expect(selector()).toBeUndefined();
    original = { kind: "literal", value: { $record: { fields: [] } } };
    expect(selector()).toBeUndefined();
  });

  function fixture() {
    let radius = 8;
    let position = 51;
    const radiusType = { $ref: "DrawingRadius" };
    const positionType = { $ref: "DrawingPosition" };
    const parameters = [{ name: "radius", type: radiusType }, { name: "position", type: positionType }];
    let session = { environment: {}, registry: { available: true }, evaluateContext: {} };
    const calls = [];
    const checks = [];
    const resolveSavedExpr = () => undefined;
    const memo = compute => compute;
    const signal = initial => { let current = initial; return [() => current, next => { current = next; }]; };
    const surface = makeCall(memo, signal, { fnId: "drawing" }, () => [
      { kind: "literal", value: radius }, { kind: "literal", value: position },
    ], () => ({ returns: { $ref: "Number" } }), () => parameters, () => session, resolveSavedExpr,
      node => { calls.push(node); return { result: radius, trace: [] }; },
      (node, environment, options) => {
        checks.push({ node, environment, options });
        // Whole-call inference can abstain while the canonical field check
        // knows the concrete candidate violates its displayed declaration.
        if (node.kind !== "literal" || !options.registry.available) return undefined;
        return options.expectedType === radiusType && node.value > 12
          || options.expectedType === positionType && node.value < 16
          ? "This value does not satisfy the required input type." : undefined;
      }, () => true, structuredClone, projection, detectStructural, scopedConcreteType);
    return { surface, calls, checks, radiusType, positionType, resolveSavedExpr, session: () => session,
      edit: value => { radius = value; }, editPosition: value => { position = value; }, replaceSession: available => {
      session = { ...session, registry: { available } };
    } };
  }

  test("each argument receives its actual declared type and current reader context before whole-call fallback", () => {
    const f = fixture();
    expect(f.surface.draftIssue()).toBeUndefined();
    expect(f.checks.slice(0, 2).map(check => check.node.value)).toEqual([8, 51]);
    expect(f.checks[0].options.expectedType).toBe(f.radiusType);
    expect(f.checks[1].options.expectedType).toBe(f.positionType);
    for (const check of f.checks.slice(0, 2)) {
      expect(check.environment).toBe(f.session().environment);
      expect(check.options.registry).toBe(f.session().registry);
      expect(check.options.evaluateContext).toBe(f.session().evaluateContext);
      expect(check.options.resolveSavedExpr).toBe(f.resolveSavedExpr);
    }
    expect(f.checks[2].node.kind).toBe("call");
    expect(f.checks[2].options).not.toHaveProperty("expectedType");
  });

  test("the actual live evaluator and explicit Try do not run a rejected candidate", () => {
    const { surface, calls, edit } = fixture();
    edit(13);
    expect(surface.draftIssue()).toContain("required input type");
    expect(surface.evaluated()).toBeNull();
    surface.tryInput();
    expect(surface.displayedResult()).toBeNull();
    expect(calls).toEqual([]);
    edit(12);
    expect(surface.draftIssue()).toBeUndefined();
    expect(surface.displayedResult().result).toBe(12);
    // This harness memo does not cache, so the count follows the number of
    // reads; what matters is that only the accepted candidate was evaluated.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(node => node.args?.[0]?.value === 12)).toBe(true);
  });

  test("a rejected current candidate hides a previously tried result and the current session owns the check", () => {
    const { surface, calls, edit, replaceSession } = fixture();
    surface.tryInput();
    expect(surface.displayedResult().result).toBe(8);
    const previousCalls = calls.length;
    edit(13);
    expect(surface.displayedResult()).toBeNull();
    surface.tryInput();
    expect(calls).toHaveLength(previousCalls);
    replaceSession(false);
    expect(surface.draftIssue()).toBeUndefined();
    surface.tryInput();
    expect(surface.displayedResult().result).toBe(13);
    replaceSession(true);
    expect(surface.displayedResult()).toBeNull();
    expect(surface.draftIssue()).toContain("required input type");
  });

  test("a later rejected argument blocks execution and valid radius/position recover", () => {
    const { surface, calls, edit, editPosition } = fixture();
    edit(12);
    editPosition(15);
    expect(surface.draftIssue()).toContain("required input type");
    expect(surface.evaluated()).toBeNull();
    surface.tryInput();
    expect(calls).toEqual([]);
    editPosition(23);
    expect(surface.draftIssue()).toBeUndefined();
    expect(surface.displayedResult().result).toBe(12);
    expect(calls.at(-1).args.map(argument => argument.value)).toEqual([12, 23]);
  });

  test("the same sibling-derived type reaches the picker field and input guard, and changes reject stale data", () => {
    const stringType = { $ref: "String" }, numberType = { $ref: "Number" };
    const dependentType = { $el: { var: "inputType" } };
    const parameters = [{ name: "inputType", type: { $type: true } }, { name: "input", type: dependentType }];
    let typeArgument = { kind: "literal", value: stringType };
    let valueArgument = { kind: "literal", value: "first" };
    const checks = [], calls = [];
    const session = { registry: {}, environment: {}, evaluateContext: {} };
    const signal = initial => { let current = initial; return [() => current, next => { current = next; }]; };
    const surface = makeCall(compute => compute, signal, { fnId: "typed-input" }, () => [typeArgument, valueArgument],
      () => ({ returns: stringType }), () => parameters, () => session, undefined,
      node => { calls.push(node); return { result: valueArgument.value, trace: [] }; },
      (node, _environment, options) => {
        checks.push(options);
        return node === valueArgument && options.expectedType === numberType && typeof node.value !== "number"
          ? "This data does not satisfy the required input type." : undefined;
      }, () => true, structuredClone, projection, detectStructural, scopedConcreteType);
    expect(surface.resolvedParams()[1].type).toBe(stringType);
    expect(surface.draftIssue()).toBeUndefined();
    expect(checks[1].expectedType).toBe(stringType);
    const admittedCalls = calls.length;
    typeArgument = { kind: "literal", value: numberType };
    expect(surface.resolvedParams()[1].type).toBe(numberType);
    expect(surface.draftIssue()).toContain("required input type");
    expect(surface.evaluated()).toBeNull();
    expect(calls).toHaveLength(admittedCalls);
    valueArgument = { kind: "literal", value: 42 };
    expect(surface.evaluated().result).toBe(42);
    expect(calls).toHaveLength(admittedCalls + 1);

    for (const expression of [
      { kind: "literal", value: undefined },
      { kind: "call", fnId: "effectful-type", args: [] },
      { kind: "literal", value: { __apply: { fn: { kind: "literal", value: { $ref: "effectful-type" } }, args: [] } } },
    ]) {
      typeArgument = expression;
      expect(surface.resolvedParams()[1].type).toBe(dependentType);
      expect(surface.draftIssue()).toContain("earlier inputs");
      expect(surface.evaluated()).toBeNull();
    }
    expect(calls).toHaveLength(admittedCalls + 1);
  });
});

describe("home view writes", () => {
  test("two actual remove actions accumulate in one debounce window", async () => {
    const q = queue();
    const server = view("a", "b", "c");
    const remove = makeRemove({ get view() { return q.read("A", server); } }, (next) => q.update("A", next));
    remove("a"); remove("b");
    expect(q.read("A", server).items.map((x) => x.id)).toEqual(["c"]);
    await q.flushAll();
    expect(q.writes).toEqual([{ id: "A", next: view("c") }]);
  });

  test("switching same-layout identity keeps both drafts and targets separate", async () => {
    const q = queue();
    const first = view("a1", "a2"); const second = view("b1", "b2");
    makeRemove({ get view() { return q.read("A", first); } }, (next) => q.update("A", next))("a1");
    makeRemove({ get view() { return q.read("B", second); } }, (next) => q.update("B", next))("b1");
    expect(q.read("A", first)).toEqual(view("a2"));
    await q.flushAll();
    expect(q.writes).toEqual([{ id: "A", next: view("a2") }, { id: "B", next: view("b2") }]);
  });

  test("drag then resize persists both changes while a request is in flight", async () => {
    const firstWrite = deferred();
    const q = queue(async () => { if (q.writes.length === 1) await firstWrite.promise; });
    q.update("A", { ...view("a"), items: [{ id: "a", x: 0.4, y: 0.5 }] });
    const pending = q.flush("A");
    await Promise.resolve();
    const draft = q.read("A", view("a"));
    q.update("A", { ...draft, items: draft.items.map((item) => ({ ...item, w: 0.7, h: 0.8 })) });
    expect(q.writes).toHaveLength(1);
    firstWrite.resolve();
    await pending;
    expect(q.writes[1].next.items[0]).toEqual({ id: "a", x: 0.4, y: 0.5, w: 0.7, h: 0.8 });
    expect(q.status()).toEqual([]);
  });

  test("edits arriving during refresh are included before flush completes", async () => {
    const refresh = deferred(); let count = 0;
    const q = queue(undefined, async () => { if (++count === 1) await refresh.promise; });
    q.update("A", view("a")); const pending = q.flush("A");
    await Promise.resolve(); await Promise.resolve();
    q.update("A", view("b")); refresh.resolve();
    await pending;
    expect(q.writes.map((x) => x.next)).toEqual([view("a"), view("b")]);
    expect(q.status()).toEqual([]);
  });

  test("failed writes retain the draft and can be retried", async () => {
    let fail = true;
    const q = queue(async () => { if (fail) throw new Error("offline"); });
    q.update("A", view("b"));
    expect(await q.flush("A")).toBe(false);
    expect(q.status()[0].error).toBe("offline");
    expect(q.read("A", view("a"))).toEqual(view("b"));
    fail = false;
    expect(await q.flushAll()).toBe(true);
    expect(q.status()).toEqual([]);
  });

  test("a synchronous host failure does not leave a completed promise blocking retries", async () => {
    let fail = true;
    const q = createViewPersistence({ delay: 60_000, changed: () => {}, refresh: async () => {},
      write: () => { if (fail) throw new Error("request rejected"); return Promise.resolve(); } });
    q.update("A", view("a"));
    expect(await q.flush("A")).toBe(false);
    fail = false;
    expect(await q.flush("A")).toBe(true);
    expect(q.status()).toEqual([]);
  });
});

describe("IO call deployment control", () => {
  test("run then stop sends its handle and an acknowledged stop clears it", async () => {
    const calls = [];
    const c = createIOCallController({ info: () => ({ fnId: "collector", args: [], stopAction: "stop" }),
      evaluate: (x) => x, invoke: async (...args) => { calls.push(args); return { ok: true, value: "handle-123", ...(args[2] === "stop" ? { stopped: true } : {}) }; } });
    expect(c.canStop()).toBe(false);
    await c.dispatch("run"); expect(c.canStop()).toBe(true);
    await c.dispatch("stop");
    expect(calls).toEqual([["collector", [], "run"], ["collector", ["handle-123"], "stop"]]);
    expect(c.canStop()).toBe(false);
    await c.dispatch("stop"); expect(calls).toHaveLength(2);
  });

  test("stop failures preserve the handle for retry", async () => {
    const calls = []; let fail = true;
    const c = createIOCallController({ info: () => ({ fnId: "collector", args: [], stopAction: "stop" }),
      evaluate: (x) => x, invoke: async (...args) => {
        calls.push(args);
        if (args[2] === "stop" && fail) throw new Error("offline");
        return { ok: true, value: "handle-123", ...(args[2] === "stop" ? { stopped: true } : {}) };
      } });
    await c.dispatch("run"); await c.dispatch("stop");
    expect(c.state().kind).toBe("error"); expect(c.canStop()).toBe(true);
    fail = false; await c.dispatch("stop");
    expect(calls.slice(1).map((x) => x[1])).toEqual([["handle-123"], ["handle-123"]]);
  });

  test("changing the function does not reuse another function's handle", async () => {
    let fnId = "first"; const calls = [];
    const c = createIOCallController({ info: () => ({ fnId, args: [], stopAction: "stop" }),
      evaluate: (x) => x, invoke: async (...args) => { calls.push(args); return { ok: true, value: "handle" }; } });
    await c.dispatch("run"); fnId = "second";
    expect(c.canStop()).toBe(false); await c.dispatch("stop"); expect(calls).toHaveLength(1);
  });

  test("a running invocation without a handle cannot call a deployment stop", async () => {
    const result = deferred(); const calls = [];
    const c = createIOCallController({ info: () => ({ fnId: "collector", args: [], stopAction: "stop" }),
      evaluate: (x) => x, invoke: async (...args) => { calls.push(args); return result.promise; } });
    const pending = c.dispatch("run"); await c.dispatch("stop"); expect(calls).toHaveLength(1);
    result.resolve({ ok: true, value: "handle" }); await pending;
  });
});

describe("authored editor requirements", () => {
  function expressionProp(file, owner, property, following) {
    const ownerStart = file.indexOf(owner);
    const start = file.indexOf(`${property}={`, ownerStart);
    const end = file.indexOf(following, start);
    if (ownerStart < 0 || start < 0 || end < 0) throw Error(`Missing production ${property} transport in ${owner}`);
    return file.slice(start + property.length + 2, end).trim().slice(0, -1);
  }
  const newOwner = "function NewFunctionModal(";
  const newField = expressionProp(source, newOwner, "fieldDef", "expectedScheme={");
  const newScheme = expressionProp(source, newOwner, "expectedScheme", "hideLabel");
  const newRequirement = new Function("resultMode", "returnsType", "resultType", "ownedScheme", "Nothing", "projectAuthoringScheme",
    transpiler.transformSync(`return { field: ${newField}, scheme: ${newScheme} };`));
  const savedOwner = source.indexOf("                        fieldDef={functionResultMode()", source.indexOf("function EditModalContent("));
  const savedSource = source.slice(savedOwner);
  const savedField = expressionProp(savedSource, "fieldDef={", "fieldDef", "expectedScheme={");
  const savedScheme = expressionProp(savedSource, "fieldDef={", "expectedScheme", "authoringSession={");
  const savedRequirement = new Function("functionResultMode", "functionBodyReturnType", "functionOwnedScheme", "Nothing", "projectAuthoringScheme",
    transpiler.transformSync(`return { field: ${savedField}, scheme: ${savedScheme} };`));
  const letOwner = "function LetBindingsEditor(";
  const letType = expressionProp(editorSource, letOwner, "expectedType", "expectedScheme={");
  const letScheme = expressionProp(editorSource, letOwner, "expectedScheme", "expectedOutcome={");
  const letOutcome = expressionProp(editorSource, letOwner, "expectedOutcome", "typeName={");
  const letField = expressionProp(editorSource, letOwner, "fieldDef", "declaredType=");
  // LetBindingsEditor renders each binding through one slot ({ binding, index }).
  const letSlotRequirement = new Function("slot", "props", "Nothing",
    transpiler.transformSync(`return { type: ${letType}, scheme: ${letScheme}, outcome: ${letOutcome}, field: ${letField} };`));
  const letRequirement = (binding, index, props, nothing) => letSlotRequirement({ binding: binding(), index }, props, nothing);
  const annotationOutcome = expressionProp(editorSource, "function AnnotationFormEditor(", "expectedOutcome", "typeName={");
  const readAnnotationOutcome = new Function("typeValue", "props", transpiler.transformSync(`return ${annotationOutcome};`));
  const text = { $ref: "String" }, number = { $ref: "Number" };
  const owned = { quantified: [{ id: "function:a", sourceName: "a", kind: { $tag: "KType" } }],
    body: { $arrow: { params: [], returns: text } },
    applications: [{ path: ["$arrow", "returns"], headRef: "String", args: [], kind: { $tag: "KType" } }],
    nominals: [{ path: ["$arrow", "returns"], identity: "fixture:String", publicName: "String" }] };
  test("Infer from body never installs its observed result as a new-function requirement", () => {
    for (const observed of [text, number, undefined]) {
      expect(newRequirement(() => "infer", () => text, () => observed, () => owned, Nothing, projectAuthoringScheme))
        .toEqual({ field: undefined, scheme: undefined });
    }
  });
  test("chosen new-function result retains its declared type and complete scheme sidecars", () => {
    const expected = projectAuthoringScheme(owned, ["$arrow", "returns"]);
    const actual = newRequirement(() => "explicit", () => text, () => number, () => owned, Nothing, projectAuthoringScheme);
    expect(actual.field.type).toBe(text);
    expect(actual.scheme).toEqual(expected);
    expect(actual.scheme.quantified).toBe(owned.quantified);
    expect(actual.scheme.nominals[0].path).toEqual([]);
    expect(actual.scheme.applications[0].path).toEqual([]);
  });
  test("saved-function result mode transports only the chosen contract", () => {
    expect(savedRequirement(() => "infer", () => text, () => owned, Nothing, projectAuthoringScheme))
      .toEqual({ field: undefined, scheme: undefined });
    const chosen = savedRequirement(() => "explicit", () => text, () => owned, Nothing, projectAuthoringScheme);
    expect(chosen.field.type).toBe(text);
    expect(chosen.scheme).toEqual(projectAuthoringScheme(owned, ["$arrow", "returns"]));
  });
  test("free earlier let bindings remain unconstrained and only the returned occurrence receives the parent contract", () => {
    const bindings = [{ name: "free", expr: { kind: "literal", value: "text" } },
      { name: "result", expr: { kind: "param", name: "free" } }];
    const scheme = { quantified: [], body: number };
    const props = { bindings, expectedType: number, expectedScheme: scheme };
    expect(letRequirement(() => bindings[0], 0, props, Nothing))
      .toEqual({ type: undefined, scheme: undefined, outcome: undefined, field: undefined });
    const returned = letRequirement(() => bindings[1], 1, props, Nothing);
    expect(returned.type).toBe(number);
    expect(returned.scheme).toBe(scheme);
    expect(returned.field).toBeUndefined();
  });
  test("a binding annotation stays authored and competing returned requirements remain unresolved", () => {
    const annotated = { name: "value", type: text, expr: { kind: "literal", value: "text" } };
    const props = { bindings: [annotated], expectedType: number };
    const returned = letRequirement(() => annotated, 0, props, Nothing);
    expect(returned.field.type).toBe(text);
    expect(returned.type).toBeUndefined();
    expect(returned.scheme).toBeUndefined();
    expect(returned.outcome.$tag).toBe("AnnotationRequired");
    const standalone = letRequirement(() => annotated, 0, { bindings: [annotated] }, Nothing);
    expect(standalone.field.type).toBe(text);
    expect(standalone.outcome).toBeUndefined();
  });
  test("an unreadable authored annotation cannot become an unconstrained suggestion target", () => {
    expect(readAnnotationOutcome(() => null, {}).$tag).toBe("AnnotationRequired");
    expect(readAnnotationOutcome(() => text, {})).toBeUndefined();
    const inherited = { $tag: "AnnotationRequired", diagnostics: [] };
    expect(readAnnotationOutcome(() => text, { expectedOutcome: inherited })).toBe(inherited);
  });
});

describe("new function reference persistence", () => {
  // Since 60a61cfe save() captures an intent first; the body conversion is
  // the one statement that projects the captured node with a refusing resolver.
  // B4 unit D item 2: a Local body comes from its worker (`local.body`); this
  // page reader has no Local job, so the statement takes its toLogic branch.
  const start = source.indexOf("        fn.body = local && \"request\" in local ? await local.body", source.indexOf("function NewFunctionModal("));
  const end = source.indexOf("        let issue: string | undefined;", start);
  if (start < 0 || end < 0) throw Error("New function body conversion moved");
  const bodySource = source.slice(start, end);
  const saveBody = new Function("node", "toLogic", "session", "local", "dismissed",
    `${transpiler.transformSync(`async function convertBody() { const fn: any = {}; ${bodySource} return fn.body; }`)}; return convertBody();`);
  const ref = { kind: "ref", savedExprId: "price" };
  const convert = (node) => saveBody(node, (node, resolver) => exprNodeToLogic(node, { resolver }), { environment: {} });
  test("a direct reference is rejected visibly", async () => {
    await expect(convert(ref)).rejects.toThrow("References to saved data");
  });
  test("a reference inside a lambda is rejected without snapshotting", async () => {
    await expect(convert({ kind: "literal", value: { __lambda: { params: [], body: ref } } }))
      .rejects.toThrow("References to saved data");
  });
  test("a function parameter remains an executable reference", async () => {
    expect(await convert({ kind: "param", name: "price" })).toEqual({ var: "price" });
  });
});

describe("function inspection body presence", () => {
  const start = source.indexOf("  const functionBodyExpr = createMemo");
  // B4 unit D item 2: a page reader has no Local body raise.
  const make = new Function("createMemo", "functionPin", "logicToExprNode", "functionSourceAuthoringSession", "functionIngress = () => undefined",
    "localFunctionBody = undefined",
    `${transpiler.transformSync(source.slice(start, source.indexOf("  const [bodyDraft", start)))}; return functionBodyExpr();`);
  test("false, zero and empty text remain editable expressions while an absent body stays absent", () => {
    for (const value of [false, 0, ""]) {
      expect(make(fn => fn, () => ({ fn: { body: value, params: [] } }), logicToExprNode, () => undefined))
        .toEqual({ kind: "literal", value });
    }
    expect(make(fn => fn, () => ({ fn: { params: [] } }), logicToExprNode, () => undefined)).toBeNull();
  });
});

describe("canvas dependency projection", () => {
  const rendererStart = source.indexOf("function CanvasRenderer(");
  const edgesStart = source.indexOf("  const edges = createMemo", rendererStart);
  const code = source.slice(edgesStart, source.indexOf("  // Filter edges", edgesStart));
  const project = new Function("props", "homeData", "createMemo", "readLocusCatalogReference", "listRefs",
    `${transpiler.transformSync(code)}; return edges();`);
  test("projected references and stored cards share the existing edges, including structural slots and inert literal controls", () => {
    const listRef = { kind: "ref", savedExprId: "source" };
    const structural = { kind: "literal", value: { __list: [listRef] } };
    const quoted = { kind: "literal", value: [{ kind: "ref", savedExprId: "source" }] };
    const saved = new Map([["source", { kind: "literal", value: 20 }], ["double", { kind: "call", fnId: "std:mul", args: [listRef, { kind: "literal", value: 2 }] }],
      ["result", structural], ["quoted", quoted]]);
    const values = ["source", "double", "result", "quoted"].map(id => ({ id: `child:${id}`, source: { kind: "expr", expr: { kind: "literal", value: 20 } } }));
    const metadata = new Map(values.map(item => [item.id, { value: 20, source: { kind: "ref", savedExprId: item.id.slice(6) }, sourcePath: [] }]));
    expect(project({ view: { items: values }, savedExprById: saved }, { evaluated: item => metadata.get(item.id) }, fn => fn,
      readLocusCatalogReference, collectReferencedSavedExpressions)).toEqual([
      { from: "child:double", to: "child:source", kind: "saved-ref" }, { from: "child:result", to: "child:source", kind: "saved-ref" },
    ]);
    const stored = values.map(item => ({ ...item, source: { kind: "ref", ref: { kind: "savedExpr", id: item.id.slice(6) } } }));
    expect(project({ view: { items: stored }, savedExprById: saved }, undefined, fn => fn,
      readLocusCatalogReference, collectReferencedSavedExpressions)).toEqual([
      { from: "child:double", to: "child:source", kind: "saved-ref" }, { from: "child:result", to: "child:source", kind: "saved-ref" },
    ]);
  });
});

describe("expression inspection keeps the producing source", () => {
  const cacheStart = source.indexOf("  const renderedValues =");
  const cache = source.slice(cacheStart, source.indexOf("  const homeData =", cacheStart));
  const itemsStart = source.indexOf("  const valueScopeItems = createMemo");
  // The items read the grouping presentation helper declared just before them.
  const groupingStart = source.lastIndexOf("  function derivedGroupingKind(", itemsStart);
  const items = source.slice(groupingStart >= 0 ? groupingStart : itemsStart, source.indexOf("  /** A row the renderers", itemsStart));
  const focusStart = source.indexOf("function focusedLocusItem(");
  const focusItem = source.slice(focusStart, source.indexOf("function ValueCardHeading(", focusStart));
  const projectWithFieldNames = new Function("valueScope", "scope", "transferSession", "createMemo", "expressionAt",
    "expressionEditOptions", "arrangementRevision", "isCanvasExpression", "childItemId", "childValueType", "scopeLabel",
    "projectAuthoredExpression", "canvasFunctions", "savedValuesById = () => new Map()", "recordChildNameFields",
    `${transpiler.transformSync(focusItem + cache + items)}; return valueScopeItems().map(item => ({ item, evaluated: renderedValues.get(item.source.expr) }));`);
  // Callers pass up to the first 14 arguments; the field-slot name helper is the real one.
  const project = (...args) => projectWithFieldNames(...Array.from({ length: 14 }, (_, index) => args[index]), recordChildNameFields);
  const lensStart = source.indexOf("  const lensExpressionSubject = createMemo");
  const lensEnd = source.indexOf("  const lensExpressionAvailable =", lensStart);
  if (lensStart < 0 || lensEnd <= lensStart) throw new Error("Focused lens expression subject boundary moved");
  const lensBody = source.slice(lensStart, lensEnd);
  const lensSubject = new Function("scope", "valueScope", "createMemo", "projectAuthoredExpression", "expressionEditOptions", "scopeLabel",
    "props = {}", "heldLensSubject = () => undefined",
    `${transpiler.transformSync(focusItem + lensBody)}; return lensExpressionSubject();`);
  function focusedSubject(expr, path, value) {
    return lensSubject(() => ({ kind: "value", viewId: "data", itemId: "source", path }),
      () => ({ ok: true, item: { id: "source", caption: "Parent", representations: { Labelable: { label: "Parent" } } },
        sourceExpression: expr, container: value, containerType: { $ref: "Number" } }), fn => fn,
      authoredProjection, () => ({}), scopeLabel);
  }
  const expressionStart = source.indexOf("function itemExpression(");
  const expression = source.slice(expressionStart, source.indexOf("function itemFenelSource(", expressionStart));
  const resolveStart = source.indexOf("function resolveExpr(");
  const resolve = source.slice(resolveStart, source.indexOf("// ---------------------------------------------------------------------------", resolveStart));
  const inspect = new Function("expressionForTransfer", "classifyData", `${transpiler.transformSync(resolve + expression)}; return itemExpression;`)(
    () => { throw new Error("The producing expression was lost and replaced by a result literal"); }, () => "String");
  const call = { kind: "call", fnId: "std:reverse", args: [{ kind: "literal", value: "Fenel" }] };
  const record = { kind: "literal", value: { __record: { fields: [{ name: "Computed text", value: call }] } } };
  const intentStart = source.indexOf("  const [codeItemId, setCodeItemId]");
  const intent = source.slice(intentStart, source.indexOf("  const [cutMark", intentStart));
  const sourceHandoff = new Function("createSignal", "createEffect", "initialSource", "initialInspection", "sessionEpoch", "scopeKey", "scope", "valueScope",
    "rowById", "viewPersistence", "asView", "findLocusItem", "savedExprById", "props", "setLensMode", "focusedExpressionState",
    `${transpiler.transformSync(resolve + intent)}; return { codeItemId, sourceDialog };`);

  function handoff(state, item = { id: "source", caption: "Authored data", source: { kind: "expr", expr: call } }, changedFocus = false, inLens = false) {
    const captured = { kind: "value", viewId: "data", itemId: "source", path: [] };
    let effect, mode, code;
    const signal = initial => {
      let value = initial;
      return [() => value, next => { value = next; }];
    };
    const result = sourceHandoff(signal, (compute, apply) => { effect = () => apply(compute()); },
      { kind: "show-code", itemId: "source", scope: captured }, undefined, () => 1, scopeKey,
      () => changedFocus ? { ...captured, itemId: "another" } : captured,
      () => state, () => ({ id: "data", view: { kind: "list", items: [item] } }),
      { read: (_id, view) => view }, view => view,
      (items, id) => items.find(item => item.id === id), () => new Map([["saved-source", call]]),
      { pane: inLens ? {} : undefined }, next => { mode = next; }, () => ({ setCode: next => { code = next; } }));
    effect();
    effect();
    return { cardId: result.codeItemId(), dialog: result.sourceDialog(), ...(inLens ? { mode, code } : {}) };
  }

  test("an early source handoff opens the actual prepared focused leaf card", () => {
    expect(handoff({ ok: true, leaf: true })).toEqual({ cardId: "$self", dialog: undefined });
  });

  test("a focused container handoff preserves its producing call in the canonical inspector", () => {
    const result = handoff({ ok: true, leaf: false });
    expect(result.cardId).toBeUndefined();
    expect(inspect(result.dialog, new Map(), {})).toBe(call);
  });

  test("a focused lens source handoff selects its Code panel and retains shared state without a modal", () => {
    expect(handoff({ ok: true, leaf: false }, undefined, false, true)).toEqual({
      cardId: undefined, dialog: undefined, mode: "code", code: true,
    });
  });

  test("pending or failed evaluation does not prevent inspecting a focused saved source", () => {
    const item = { id: "source", source: { kind: "ref", ref: { kind: "savedExpr", id: "saved-source" } } };
    for (const state of [undefined, { ok: false, error: "Evaluation failed" }]) {
      const result = handoff(state, item);
      expect(result.cardId).toBeUndefined();
      expect(inspect(result.dialog, new Map(), {})).toBe(call);
    }
  });

  test("a stale focused source handoff cannot open another item's source", () => {
    expect(handoff({ ok: true, leaf: true }, undefined, true)).toEqual({ cardId: undefined, dialog: undefined });
  });

  function cards(expr, path, children, container, leaf = false) {
    return project(() => ({ ok: true, sourceExpression: expr, children, container, leaf,
      item: { id: "source", caption: "Authored data" } }),
    () => ({ kind: "value", viewId: "data", itemId: "source", path }), () => ({}), fn => fn, expressionAt,
    () => ({}), () => {}, () => false, key => `child:${key}`, () => undefined, scopeLabel, authoredProjection, () => () => undefined);
  }

  test("the focused lens Code subject excludes unrelated parent fields and keeps its authored scalar source", () => {
    const sibling = { kind: "literal", value: { $ref: "unrelated-identity" } };
    const parent = { ...record, value: { __record: { fields: [...record.value.__record.fields, { name: "Identity", value: sibling }] } } };
    const subject = focusedSubject(parent, ["Computed text"], "leneF");
    expect(subject.item.source.expr).toBe(call);
    expect(subject.evaluated).toEqual({ value: "leneF", source: call, sourcePath: [] });
    expect(subject.item.representations).toBeUndefined();
    expect(parent.value.__record.fields[1].value).toBe(sibling);
  });

  test("the focused lens keeps a residual result path when its producer is inside an authored record", () => {
    const subject = focusedSubject(record, ["Computed text", 1], "second");
    expect(subject.item.source.expr).toBe(call);
    expect(subject.evaluated).toEqual({ value: "second", source: call, sourcePath: [1] });
    expect(focusedSubject(call, [1], "second").evaluated).toEqual({ value: "second", source: call, sourcePath: [1] });
  });

  test("a computed record field keeps its full call for code and visual inspection", () => {
    const [card] = cards(record, [], [{ key: "Computed text", label: "Computed text", value: "leneF" }], { "Computed text": "leneF" });
    expect(card.evaluated.value).toBe("leneF");
    expect(inspect(card.item, new Map(), {}, card.evaluated)).toBe(call);
    expect(card.evaluated.sourcePath).toEqual([]);
  });

  test("entering a computed scalar does not turn its source into its result", () => {
    const [card] = cards(record, ["Computed text"], [], "leneF", true);
    expect(inspect(card.item, new Map(), {}, card.evaluated)).toBe(call);
  });

  test("a computed output child retains the parent expression and its result path", () => {
    const [card] = cards(call, [], [{ key: 1, label: "Item 2", value: "second" }], ["first", "second"]);
    expect(inspect(card.item, new Map(), {}, card.evaluated)).toBe(call);
    expect(card.evaluated.sourcePath).toEqual([1]);
  });

  test("authored list children use the captured saved name without changing their source slot or occurrence id", () => {
    const reference = { kind: "ref", savedExprId: "saved-source" };
    const list = { kind: "literal", value: { __list: [reference] } };
    const [card] = project(() => ({ ok: true, sourceExpression: list, children: [{ key: 0, label: "Item 1", value: 20 }], container: [20] }),
      () => ({ kind: "value", viewId: "data", itemId: "list", path: [] }), () => ({}), fn => fn, expressionAt,
      () => ({}), () => {}, () => false, key => `child:${key}`, () => undefined, scopeLabel, authoredProjection,
      () => () => undefined, () => new Map([["saved-source", { name: "Source" }]]));
    expect(card.item).toMatchObject({ id: "child:0", caption: "Source" });
    expect(card.evaluated).toEqual({ value: 20, source: reference, sourcePath: [] });
    expect(expressionAt(list, [0])).toBe(reference);
    expect(() => replaceExpressionAt(reference, [0], { kind: "literal", value: 0 })).toThrow("reference");
  });

  test("an exact placeAll projection retains each saved reference and falls back for computed or unavailable source lists", () => {
    const references = ["source", "double", "result"].map(savedExprId => ({ kind: "ref", savedExprId }));
    const list = { kind: "literal", value: { __list: references } };
    const canvas = { kind: "call", fnId: "view:placeAll", args: [{ kind: "ref", savedExprId: "list" }, { kind: "literal", value: [] }] };
    const placement = placementFromItem({ x: 0.1, y: 0.2 });
    const value = [20, 40, 41].map(item => ({ placement, item }));
    const names = new Map(references.map(ref => [ref.savedExprId, { name: ref.savedExprId.toUpperCase() }]));
    const canvasProject = new Function("valueScope", "scope", "transferSession", "createMemo", "expressionAt",
      "expressionEditOptions", "arrangementRevision", "isCanvasExpression", "childItemId", "childValueType", "scopeLabel",
      "projectAuthoredExpression", "canvasFunctions", "savedValuesById", "isEntriesCanvasExpression", "canvasSource", "invokeCallable",
      "Ref", "savedExprById", "isPlacedValue", "readArrangement", "projectPlacedItems", "accountKey", "scopeKey", "activeCanvasDraft",
      // B4 wave 4 lane H: a page reader (a Local reader keeps the canvas expression's paths).
      "reader = undefined",
      `${transpiler.transformSync(focusItem + cache + items)}; return valueScopeItems().map(item => ({ item, evaluated: renderedValues.get(item.source.expr) }));`);
    const run = retained => canvasProject(() => ({ ok: true, sourceExpression: canvas, container: value,
      sourceSnapshot: new Map([["list", list]]), sourceSession: { evaluateContext: {} } }),
      () => ({ kind: "value", path: [] }), () => ({ evaluateContext: {} }), fn => fn, expressionAt,
      () => ({}), () => {}, isCanvasExpression, key => `child:${key}`, () => undefined, scopeLabel, authoredProjection,
      () => undefined, () => names, isEntriesCanvasExpression, canvasSource, () => retained, id => ({ $ref: id }),
      () => new Map([["list", list]]), isPlacedValue, () => ({ kind: "canvas" }), projectPlacedItems, () => "local", () => "canvas", () => undefined);
    const projected = run({ $tag: "Just", _0: list });
    expect(projected.map(card => card.item.id)).toEqual(["child:0", "child:1", "child:2"]);
    expect(projected.map(card => card.item.caption)).toEqual(["SOURCE", "DOUBLE", "RESULT"]);
    expect(projected.map(card => card.evaluated.source)).toEqual(references);
    expect(projected.map(card => card.evaluated.sourcePath)).toEqual([[], [], []]);
    expect(projected.map(card => card.item.x)).toEqual([0.1, 0.1, 0.1]);
    for (const retained of [{ $tag: "Nothing" }, { $tag: "Just", _0: { kind: "call", fnId: "never:invoke", args: [] } }]) {
      const fallback = run(retained);
      expect(fallback.map(card => card.item.caption)).toEqual(["Item 1", "Item 2", "Item 3"]);
      expect(fallback.map(card => card.evaluated.source)).toEqual([canvas, canvas, canvas]);
      expect(fallback.map(card => card.evaluated.sourcePath)).toEqual([[0, "item"], [1, "item"], [2, "item"]]);
    }
    expect(canvas.args[0]).toEqual({ kind: "ref", savedExprId: "list" });
  });

  test("literal data resembling an expression marker stays literal during inspection", () => {
    const value = { __record: { fields: [] } };
    const expr = { kind: "literal", value: { nested: value } };
    const [card] = cards(expr, [], [{ key: "nested", label: "nested", value }], { nested: value });
    const inspected = inspect(card.item, new Map(), {}, card.evaluated);
    expect(inspected).toEqual(expressionAt(expr, ["nested"]));
    expect(inspected.value.__record.fields[0].name).toBe("__record");
    expect(card.evaluated.value).toBe(value);
  });

  test("function source prints the reader's admitted body and parameters instead of its UUID", () => {
    const printStart = source.indexOf("function itemFenelSource(");
    const printSource = source.slice(printStart, source.indexOf("/** Every live value", printStart));
    const printed = [];
    const makePrint = new Function("readLocusCatalogReference", "toLogic", "printFenel", "expressionForTransfer", "classifyData", "logicToExprNode",
      "inspectionSourceExpression", "inspectionFunctionCodeName",
      `${transpiler.transformSync(resolve + expression + printSource)}; return itemFenelSource;`);
    const print = makePrint(readLocusCatalogReference,
      exprNodeToLogic,
      (body, locale, options) => { printed.push({ body, locale, options }); return "f x"; },
      () => undefined, () => "Function", (body, names) => logicToExprNode(body, names), projectSource,
      sourceNames(() => ({ functionCodeName: () => undefined })));
    const body = { call: [{ var: "f" }, { var: "x" }] };
    const fn = { id: "std:apply", params: [{ name: "f" }, { name: "x" }], body };
    const routes = [{ sourceName: "Example.Done", targetId: "ctor-id", status: "resolved" }];
    const session = { catalog: {}, registry: { getFunction: id => id === "function-uuid" ? fn : undefined },
      environment: { catalog: { exactConstructorRoutes: routes } } };
    const item = { source: { kind: "expr", expr: { kind: "literal", value: { $ref: "function-uuid" } } } };
    expect(print(item, new Map(), session)).toBe("-- Parameters: f, x\nf x");
    expect(printed).toEqual([{ body: { apply: [{ var: "f" }, [{ var: "x" }]] }, locale: undefined, options: {
      constructorRoutes: routes, constructorTargets: [], referenceRoutes: [], boundNames: ["f", "x"],
    } }]);
    fn.body = undefined;
    expect(print(item, new Map(), session)).toContain("native declaration");
    expect(printed).toHaveLength(1);
  });

  test("an admitted function's body does not label its original reference path as a selected body result", () => {
    const labelAt = source.indexOf(">Selected result:");
    const start = source.lastIndexOf("<Show when={", labelAt) + "<Show when={".length;
    const guard = new Function("fn", "props", `return !!(${transpiler.transformSync(source.slice(start,
      source.indexOf("}>", start))).replace(/;\s*$/, "")});`);
    const selected = { evaluated: { value: { $ref: "function-uuid" }, source: call, sourcePath: ["$"] } };
    expect(guard(() => ({ body: { call: [{ var: "f" }, { var: "x" }] } }), selected)).toBe(false);
    expect(guard(() => undefined, { evaluated: { value: "second", source: call, sourcePath: [1] } })).toBe(true);
    expect(guard(() => undefined, { evaluated: { value: "second", source: call, sourcePath: [] } })).toBe(false);
  });

  test("full inspection cards retain authored fields and paths into computed children", async () => {
    const componentStart = source.indexOf("function InspectionDataValue(");
    const projectionStart = source.indexOf("  const projected = createMemo", componentStart);
    const projectionSource = source.slice(projectionStart, source.indexOf("\n  return <", projectionStart));
    const makeProjection = new Function("props", "homeAuthoringSession", "children", "createMemo", "resolveExpr",
      "expressionAt", "childItemId", "childValueType", "projectAuthoredExpression", "typedReadValueCaption", "reader", "displayNameItemFields", `${transpiler.transformSync(projectionSource)}; return projected();`);
    const resolveExpression = new Function(`${transpiler.transformSync(resolve)}; return resolveExpr;`)();
    const typedSource = await Bun.file(new URL("./layout-renderer/TypedReadValue.tsx", import.meta.url)).text();
    const captionSource = typedSource.slice(typedSource.indexOf("export function typedReadValueCaption("),
      typedSource.indexOf("/** A data heading"));
    const labelSource = displayNameSource.slice(displayNameSource.indexOf("export function valueCardLabel("),
      displayNameSource.indexOf("export function humanName("));
    const caption = new Function("readLocusCatalogReference", "pickDisplayName", `${transpiler.transformSync((labelSource + captionSource).replaceAll("export function", "function"))}; return typedReadValueCaption;`)(readLocusCatalogReference, pickDisplayName);
    const reader = { presentation: id => id === "saved-ref" ? { label: "Existing saved name" } : undefined };
    const session = { environment: {} };
    const project = (value, expr, evaluated) => makeProjection({ item: { id: "inspected", source: { kind: "expr", expr } },
      value, evaluated, savedExprById: new Map() }, () => session, () => childrenOf(value), fn => fn,
      resolveExpression, expressionAt, key => String(key), () => undefined, authoredProjection, caption, reader, displayNameItemFields);
    const [authored] = project({ "Computed text": "leneF" }, record);
    expect(authored.item.source.expr).toBe(call);
    expect(authored.evaluated).toEqual({ value: "leneF", source: call, sourcePath: [] });
    const [, computed] = project(["first", "second"], call);
    expect(computed.item.caption).toBeUndefined();
    expect(computed.evaluated).toEqual({ value: "second", source: call, sourcePath: [1] });
    const [nested] = project({ leaf: "kept" }, call, { value: { leaf: "kept" }, source: call, sourcePath: ["nested"] });
    expect(nested.evaluated).toEqual({ value: "kept", source: call, sourcePath: ["nested", "leaf"] });
    const [named] = project([{ $ref: "saved-ref" }], call);
    expect(named.item.caption).toBe("Existing saved name");
  });
});

const creationPlacementSource = await Bun.file(new URL("./locus-view-model.ts", import.meta.url)).text();
const { shareSavedExpressionMap: creationSavedExpressionMap } = await import("./saved-expression-map");
const { locusReaderWrites: creationReaderWrites } = await import("./locus-reader-writes");
const creationExpressionStart = source.indexOf("function resolveExpr(");
const creationResolveExpression = new Function(`${transpiler.transformSync(source.slice(creationExpressionStart,
  source.indexOf("function rendersPicture(", creationExpressionStart)))}; return resolveExpr;`)();
const creationItemUpdateStart = source.indexOf("function updateItemInView(");
const creationItemHelpers = new Function(`${transpiler.transformSync(source.slice(creationItemUpdateStart,
  source.indexOf("function removeLocusItem(", creationItemUpdateStart)))}; return { findLocusItem, updateItemInView };`)();
const creationDependencySource = await Bun.file(new URL("./dependency-graph-dialog.tsx", import.meta.url)).text();
const creationMentionsStart = creationDependencySource.indexOf("export function expressionMentions(");
const creationExpressionMentions = new Function("observeExprNode", `${transpiler.transformSync(creationDependencySource.slice(creationMentionsStart,
  creationDependencySource.indexOf("/** Captured-reader transport", creationMentionsStart)).replace("export function", "function"))}; return expressionMentions;`)(observeExprNode);

describe("New expression destination ownership", () => {
  const captionStart = valueCardSource.indexOf("export function valueCardTypeLabel(");
  const captionEnd = valueCardSource.indexOf("/** Shared card chrome", captionStart);
  if (captionStart < 0 || captionEnd <= captionStart) throw new Error("Type caption fixture boundary moved");
  const valueCardTypeLabel = new Function(`${transpiler.transformSync(valueCardSource.slice(captionStart, captionEnd)
    .replace("export function", "function"))}; return valueCardTypeLabel;`)();
  const messagesStart = source.indexOf("const LOCAL_SAVE_TOOLS_PENDING =");
  const messagesEnd = source.indexOf("type LocalSaveAdmission =", messagesStart);
  if (messagesStart < 0 || messagesEnd <= messagesStart) throw new Error("Local Save message fixture boundary moved");
  const localSaveMessages = new Function(`${transpiler.transformSync(source.slice(messagesStart, messagesEnd))};
    return { LOCAL_SAVE_TOOLS_PENDING, LOCAL_SAVE_CHANGED, LOCAL_SAVE_DRAFT_CHANGED, LOCAL_SAVE_UNCHECKABLE };`)();
  const componentStart = source.indexOf("function NewValueModal(");
  const setupStart = source.indexOf("  const origin = useHomeReader();", componentStart);
  // The setup ends at the composer's first inner component (JSX follows).
  const setupEnd = [source.indexOf("  function ComposerTypePicker()", setupStart), source.indexOf("  function ComposerExpressionEditor()", setupStart)]
    .filter(index => index >= 0).reduce((first, index) => Math.min(first, index));
  const graphValueStart = source.indexOf("graphValue={", setupEnd) + "graphValue={".length;
  const graphValueExpression = source.slice(graphValueStart, source.indexOf("\n                    hideLabel", graphValueStart)).trim().slice(0, -1);
  const capturedValueStart = cardEvaluationSource.indexOf("export function readLocusCapturedValue(");
  // The captured value is tied to its reader source metadata; this fixture's
  // sessions carry none, and the real sameSourceMetadata compares them.
  const sameMetadataStart = cardEvaluationSource.indexOf("function sameSourceMetadata(");
  const sameMetadata = cardEvaluationSource.slice(sameMetadataStart, cardEvaluationSource.indexOf("function cardSourceMetadata(", sameMetadataStart));
  const readPreviewValue = new Function("concreteAuthoringSession", "authoringExpressionSites", "readLocusCardResult", "cardSourceMetadata",
    `${transpiler.transformSync(sameMetadata + cardEvaluationSource.slice(capturedValueStart, cardEvaluationSource.indexOf("\nfunction storedData(", capturedValueStart))
      .replace("export function", "function"))}; return readLocusCapturedValue;`)(session => session, authoringExpressionSites,
      () => { throw Error("A supplied Preview snapshot must not acquire another result"); }, () => undefined);
  const cancellationMarker = "includeAccounts onClose={() => {";
  const cancellationStart = source.indexOf(cancellationMarker, setupEnd) + cancellationMarker.length;
  const cancellation = source.slice(cancellationStart, source.indexOf("}} onPlace={chooseCreationScope}", cancellationStart));
  const kindHandlerStart = source.indexOf("onClick={() => {", source.indexOf('class={["home-composer-modal__kind-option"', setupEnd)) + "onClick={() => {".length;
  const kindHandler = source.slice(kindHandlerStart, source.indexOf("                  }}", kindHandlerStart));
  const makeComposer = new Function("env", `with (env) {
    ${transpiler.transformSync(source.slice(setupStart, setupEnd))}
    return { save, chooseCreationScope, creationChildren, destination, saveError, preparingScope, updateDraft, close, evaluated, inferredType,
      previewDraft, previewCurrent, graphValue: ${graphValueExpression}, toggleComposerPresentation, currentDraft: draft,
      creationPresentation: () => ({ cardAnchor, cardExpanded: cardExpanded(), editorLens: editorLens(), inline: inlineCard() }),
      switchKind: kind => { const k = { id: kind }; ${transpiler.transformSync(kindHandler)} },
      cancelScope: () => { ${transpiler.transformSync(cancellation)} } };
  }`);
  const placementStart = creationPlacementSource.indexOf("export async function addToLocus(");
  const makeRootPlacement = new Function("env", `with (env) {
    ${transpiler.transformSync(creationPlacementSource.slice(placementStart).replace("export async function", "async function"))}
    return addToLocus;
  }`);
  const directCreationStart = source.indexOf("creation={composeExpression()");
  const directGuardStart = source.indexOf("assertSource: ", directCreationStart) + "assertSource: ".length;
  const directGuardEnd = source.indexOf("})(),", directGuardStart) + "})()".length;
  const makeDirectGuard = new Function("env", `with (env) { return ${transpiler.transformSync(source.slice(directGuardStart, directGuardEnd))}; }`);

  function fixture(options = {}) {
    let epoch = 1, sequence = 0, closed = 0, originFocusCurrent = true;
    const calls = [], placementErrors = [], evaluatedBy = [], inferredBy = [];
    const contexts = { saved: {}, data: {} };
    const environment = createAuthoringEnvironment({ types: [], functions: [{ id: "fixture-call", kind: "function",
      label: "Fixture call", description: "", params: [], returns: { $ref: "String" }, signatureOutcome: { $tag: "Solved" },
      scheme: { quantified: [], body: { $arrow: { params: [], returns: { $ref: "String" } } } } }],
      capabilities: [], catalogTypes: [], operatorCodeNameByNotation: new Map() });
    const signal = initial => {
      let value = initial;
      return [() => value, next => { value = typeof next === "function" ? next(value) : next; }];
    };
    const assertCurrentSession = captured => { if (captured !== epoch) throw Error("Session changed"); };
    class ResponseError extends Error { status = 409; }
    const addToLocus = makeRootPlacement({
      defaultApiClient: {}, sessionEpoch: () => epoch, assertCurrentSession,
      browserAccountScope: () => "origin", genId: () => `occurrence-${++sequence}`, ApiResponseError: ResponseError,
      console: { error: (...args) => { placementErrors.push(args); } },
    });
    function owner(id) {
      let sourceTicket;
      const state = {
        root: { id, revision: 1, canEdit: true, type: List(Anything), items: [],
          lists: [{ id: `${id}-list`, name: "Destination list", valueType: List(Anything), view: { kind: "list", items: [] } }], expressions: {} },
        queries: [], failPlacement: false, failAfterPlacement: false, beforeRootRead: undefined, beforePlacementRead: undefined, beforeSavedRead: undefined,
      };
      const client = {
        accountId: id, rootId: id, epoch: 1, signal: new AbortController().signal,
        drafts: { source: () => sourceTicket },
        getLocusRoot: { uncached: async () => {
          calls.push({ owner: id, read: "root" });
          await state.beforeRootRead?.();
          return { root: cloneDraftValue(state.root) };
        } },
        getSavedQueries: { uncached: async () => {
          calls.push({ owner: id, read: "saved" });
          await state.beforeSavedRead?.();
          return { queries: cloneDraftValue(state.queries) };
        } },
        apiRead: async () => {
          calls.push({ owner: id, read: "placement" });
          await state.beforePlacementRead?.();
          return { root: cloneDraftValue(state.root) };
        },
        editLocusRoot: async (rootId, revision, command) => {
          calls.push({ owner: id, root: rootId, revision, command: cloneDraftValue(command) });
          if (state.failPlacement) { state.failPlacement = false; throw Error("Placement unavailable"); }
          if (revision !== state.root.revision) throw Error("Stale root revision");
          if (command.kind === "replace") state.root.items = creationItemHelpers.updateItemInView({ kind: "tree", items: state.root.items },
            command.itemId, () => cloneDraftValue(command.item)).items;
          else state.root.items.push(cloneDraftValue(command.item));
          state.root.revision++;
          if (state.failAfterPlacement) { state.failAfterPlacement = false; throw Error("Placement receipt lost"); }
          return { root: cloneDraftValue(state.root) };
        },
        editSavedValue: async (savedId, query, revision, _occurrence, expectedQuery) => {
          calls.push({ owner: id, savedPlacement: savedId, query: cloneDraftValue(query), revision, expectedQuery: cloneDraftValue(expectedQuery) });
          if (state.failPlacement) { state.failPlacement = false; throw Error("Placement unavailable"); }
          if (revision !== state.root.revision) throw Error("Stale root revision");
          const stored = state.queries.find(row => row.id === savedId);
          if (!stored || draftValueFingerprint(stored.query) !== draftValueFingerprint(expectedQuery)) throw Error("Stale saved expression");
          stored.query = cloneDraftValue(query); state.root.revision++;
          if (state.failAfterPlacement) { state.failAfterPlacement = false; throw Error("Placement receipt lost"); }
          return { root: cloneDraftValue(state.root) };
        },
        revalidate: () => {},
        api: {
          savedQueryCreate: async payload => {
            calls.push({ owner: id, create: cloneDraftValue(payload) });
            const query = { id: `${id}-saved`, ...cloneDraftValue(payload) };
            state.queries.push(query); return { query };
          },
          savedQueryUpdate: async (savedId, payload) => {
            calls.push({ owner: id, update: savedId, payload: cloneDraftValue(payload) });
            const query = state.queries.find(row => row.id === savedId);
            Object.assign(query, cloneDraftValue(payload)); return { query };
          },
          locusViewUpdate: async (listId, patch) => {
            calls.push({ owner: id, list: listId, patch: cloneDraftValue(patch) });
            if (state.failPlacement) { state.failPlacement = false; throw Error("Placement unavailable"); }
            state.root.lists.find(list => list.id === listId).view = cloneDraftValue(patch.view); state.root.revision++;
            if (state.failAfterPlacement) { state.failAfterPlacement = false; throw Error("Placement receipt lost"); }
            return { locusView: { id: listId, rootRevision: state.root.revision } };
          },
        },
      };
      const session = { id, environment, registry: { getIdentifiedEntity: () => undefined }, evaluateContext: {} };
      const runtime = { kind: "account", client, session: () => session, registry: () => session.registry, revision: () => state.root.revision,
        catalogLookups: { fn: () => undefined, entry: () => undefined, entityType: () => undefined } };
      return { client, session, runtime, state, setSource: value => { sourceTicket = value; } };
    }
    const origin = owner("origin"), target = owner("target");
    const originSaved = { list: () => [{ id: "origin-only", name: "Private origin data", expr: { kind: "literal", value: "private" } }],
      byId: id => id === "origin-only" ? originSaved.list()[0] : undefined };
    const originAdd = async (...args) => { calls.push({ owner: "origin", originAdd: args }); return true; };
    const initialDestination = { place: { accountId: "origin", accountLabel: "Origin", sourceId: "origin", kind: "root", rootId: "origin", revision: 1, listName: "All data" },
      reader: origin.runtime, client: origin.client, saved: originSaved, add: originAdd, assertCurrent: () => {
        assertCurrentSession(1);
        if (!originFocusCurrent) throw Error("The original creation location changed");
      } };
    const props = { expressionMode: true, evaluateOnRequest: options.evaluateOnRequest, cardAnchor: options.cardAnchor,
      presetExpr: options.draft ?? { kind: "literal", value: "created here" }, onClose: () => { closed++; },
      creation: options.withoutCreation ? undefined : { current: initialDestination, pane: { creationSource: id => id === "target" ? {
        client: target.client, ready: () => options.ready?.promise ?? Promise.resolve(target.runtime),
      } : undefined } } };
    const evaluate = (node, resolve, session, data, evaluationOptions) => {
      evaluatedBy.push(session.id);
      if (options.evaluate) return options.evaluate(node, resolve, session, data, evaluationOptions);
      const expression = node.kind === "ref" ? resolve(node.savedExprId) : node;
      if (!expression) throw Error("Missing saved data");
      if (expression.kind === "call") {
        if (expression.fnId !== "fixture-call") throw Error("Unexpected fixture call");
        return { result: "from call", trace: [] };
      }
      const value = expression.value;
      if (value && typeof value === "object") {
        if (Array.isArray(value.__list)) return { result: value.__list.map(child => evaluate(child, resolve, session).result), trace: [] };
        if (Array.isArray(value.__record?.fields)) return { result: Object.fromEntries(value.__record.fields
          .map(field => [field.name, evaluate(field.value, resolve, session).result])), trace: [] };
      }
      return { result: value, trace: [] };
    };
    const composer = makeComposer({
      ...localSaveMessages, props, useHomeReader: () => ({ reader: origin.runtime, client: origin.client, api: origin.client.api,
        revalidate: origin.client.revalidate, homeAuthoringSession: () => origin.session,
        evaluateAuthoringExpression: evaluate, persistRepresentation: async () => {}, addToLocus: originAdd,
        temporaryEdits: () => false, assertAppearanceDrafts: () => {} }),
      useContext: context => context === contexts.saved ? originSaved : { add: originAdd },
      SavedValuesContext: contexts.saved, HomeDataContext: contexts.data,
      createSignal: signal, createMemo: fn => fn, untrack: fn => fn(), onSettled: () => {},
      sessionEpoch: () => epoch, assertCurrentSession, genId: () => `occurrence-${++sequence}`,
      cloneDraftValue, draftValueFingerprint, draftSaveIssue, draftSaveValidation, resolveValueType, peelListForAuthoring,
      listRefs: collectReferencedSavedExpressions, shareSavedExpressionMap: creationSavedExpressionMap,
      locusReaderWrites: creationReaderWrites, addToLocus, Nothing,
      ROOT_SCOPE, childrenOf, valueAt, scopeKey, followLocusPath, resolveLocusCatalogReference, childValueType,
      resolveExpr: creationResolveExpression, editableContainerAt, expressionAt, appendExpressionAt,
      expressionMentions: creationExpressionMentions, ...creationItemHelpers,
      authoringExpressionHasEmptySlot, toLogic: authoringExpressionLogic,
      inferExpressionType: (_node, _context, session) => { inferredBy.push(session.id); return { $ref: "String" }; },
      typeDisplayName: type => type.$ref, valueCardTypeLabel,
      evaluateLocusCard: async (node, saved, session) => evaluate(node, id => saved.get(id), session),
      readLocusCapturedValue: readPreviewValue,
      repString: (reps, type, method) => reps[type]?.[method] ?? "", newValueSlug: name => name || "new-data",
      // B4 slice 2: these Account readers have no Local live guidance.
      createLocalLiveGuidance: () => ({ read: () => undefined, touch() {}, cancel() {}, dispose() {} }), onCleanup: () => {},
      openLiveGuidance: () => {}, completeLiveDraft: () => false, openLocalLiveGuidance: () => {},
    });
    const place = kind => ({ accountId: "target", accountLabel: "Target", sourceId: "target", kind, rootId: "target", revision: 1,
      listName: kind === "list" ? "Destination list" : "All data", ...(kind === "list" ? { listId: "target-list" } : {}) });
    return { ...composer, origin, target, calls, placementErrors, evaluatedBy, inferredBy, place, initialDestination, addToLocus, props, originSaved,
      changeEpoch: () => { epoch++; },
      invalidateOriginFocus: () => { originFocusCurrent = false; }, closed: () => closed };
  }

  test("a pending data creation ignores a queued kind switch and still places its one created identity", async () => {
    const f = fixture({ withoutCreation: true, cardAnchor: { x: 420, y: 240 } });
    const entered = deferred(), receipt = deferred(), switches = [];
    const create = f.origin.client.api.savedQueryCreate;
    f.origin.client.api.savedQueryCreate = async payload => { entered.resolve(); await receipt.promise; return create(payload); };
    f.props.onSwitchKind = kind => { switches.push(kind); };
    const pending = f.save();
    await entered.promise;
    const presentation = f.creationPresentation();
    f.toggleComposerPresentation();
    expect(f.creationPresentation()).toEqual(presentation);
    f.switchKind("function");
    f.close();
    expect(switches).toEqual([]);
    expect(f.closed()).toBe(0);
    receipt.resolve();
    await pending;
    expect(f.calls.filter(call => call.create)).toHaveLength(1);
    expect(f.calls.filter(call => call.originAdd)).toHaveLength(1);
    expect(f.closed()).toBe(1);
  });

  test("expanding and collapsing creation preserves all entered data in the shared draft", () => {
    const draft = { kind: "literal", value: { __record: { fields: [
      { name: "name", value: { kind: "literal", value: "Taylor" } },
      { name: "phone", value: { kind: "literal", value: "+33" } },
    ] } } };
    const f = fixture({ draft, cardAnchor: { x: 420, y: 240 } });
    const before = cloneDraftValue(f.currentDraft());
    f.toggleComposerPresentation();
    expect(f.creationPresentation().editorLens).toBe("full");
    expect(f.currentDraft()).toEqual(before);
    f.toggleComposerPresentation();
    expect(f.creationPresentation().editorLens).toBe("simple");
    expect(f.currentDraft()).toEqual(before);
    expect(f.calls.filter(call => call.create || call.update)).toEqual([]);
  });

  function nestedDestination(f, ownerKind = "root") {
    const reference = { kind: "ref", savedExprId: "target-reference" };
    const call = { kind: "call", fnId: "fixture-call", args: [] };
    const expression = { kind: "literal", value: { __record: { fields: [
      { name: "nested", value: { kind: "literal", value: { __list: [reference, call] } } },
      { name: "sibling", value: call },
    ] } } };
    const valueType = { $record: { fields: [{ name: "nested", type: List(Anything) }, { name: "sibling", type: { $ref: "String" } }] } };
    f.target.state.queries.push({ id: "target-reference", name: "Existing reference", query: { kind: "expression", expr: { kind: "literal", value: "kept" } } });
    const item = { id: "nested-owner", caption: "Record", valueType,
      source: ownerKind === "saved" ? { kind: "ref", ref: { kind: "savedExpr", id: "target-owner" } }
        : { kind: "expr", expr: expression } };
    if (ownerKind === "saved") f.target.state.queries.push({ id: "target-owner", query: { kind: "expression", expr: expression, valueType } });
    if (ownerKind === "view") f.target.state.root.lists[0].view.items.push(item);
    else f.target.state.root.items.push(item);
    const place = { ...f.place("root"), kind: "list", listName: "nested", listType: List(Anything),
      scope: { kind: "value", viewId: ownerKind === "view" ? "target-list" : "target", itemId: item.id,
        rootItem: ownerKind !== "view", path: ["nested"] } };
    const currentExpression = () => ownerKind === "saved" ? f.target.state.queries.find(row => row.id === "target-owner").query.expr
      : (ownerKind === "view" ? f.target.state.root.lists[0].view.items : f.target.state.root.items).find(row => row.id === item.id).source.expr;
    return { place, item, expression, reference, call, currentExpression };
  }

  function directGuard(nested) {
    return makeDirectGuard({ scope: () => nested.place.scope,
      valueScope: () => ({ ok: true, sourceExpression: nested.expression, item: nested.item }),
      cloneDraftValue, expressionEditOptions: () => ({}), draftValueFingerprint, expressionAt, editableContainerAt,
      expressionMentions: creationExpressionMentions, resolveExpr: creationResolveExpression, ...creationItemHelpers });
  }

  test("direct-current creation captures its nested contents and owner type before either can change", () => {
    for (const change of ["contents", "type"]) {
      const f = fixture(), nested = nestedDestination(f), assertSource = directGuard(nested);
      expect(() => assertSource(f.target.state.root, new Map())).not.toThrow();
      if (change === "contents") nested.item.source.expr = appendExpressionAt(nested.expression, ["nested"], { kind: "literal", value: "foreign edit" });
      else nested.item.valueType = { $record: { fields: [{ name: "nested", type: List({ $ref: "Number" }) }] } };
      expect(() => assertSource(f.target.state.root, new Map())).toThrow("collection changed");
    }
  });

  test("direct-current creation admits its exact created reference on retry while a type change still refuses", () => {
    const f = fixture(), nested = nestedDestination(f, "saved"), assertSource = directGuard(nested);
    const appended = appendExpressionAt(nested.expression, ["nested"], { kind: "ref", savedExprId: "created-id" });
    const sources = new Map([["target-owner", appended]]);
    expect(() => assertSource(f.target.state.root, sources)).toThrow("collection changed");
    expect(() => assertSource(f.target.state.root, sources, "created-id")).not.toThrow();
    expect(() => assertSource(f.target.state.root, sources, "another-id")).toThrow("collection changed");
    nested.item.valueType = { $record: { fields: [{ name: "nested", type: List({ $ref: "Number" }) }] } };
    expect(() => assertSource(f.target.state.root, sources, "created-id")).toThrow("collection changed");
  });

  test("direct-current creation captures only its selected subtree while preserving a changed sibling", () => {
    const f = fixture(), nested = nestedDestination(f, "view"), assertSource = directGuard(nested);
    nested.item.source.expr = replaceExpressionAt(nested.expression, ["sibling"], { kind: "literal", value: "another sibling edit" });
    expect(() => assertSource(f.target.state.root, new Map())).not.toThrow();
  });

  test("blank, incomplete nested and incomplete local-binding drafts do not run evaluation or type inference", () => {
    for (const draft of [
      { kind: "literal", value: undefined },
      { kind: "literal", value: { __list: [{ kind: "call", fnId: "fixture-call", args: [] }, { kind: "literal", value: undefined }] } },
      { kind: "literal", value: { __where: { body: { kind: "call", fnId: "fixture-call", args: [] },
        bindings: [{ name: "x", expr: { kind: "literal", value: undefined } }] } } },
    ]) {
      const f = fixture({ draft });
      expect(f.evaluated()).toEqual({ result: undefined, trace: [] });
      expect(f.inferredType()).toBeUndefined();
      expect(f.evaluatedBy).toEqual([]);
      expect(f.inferredBy).toEqual([]);
    }
  });

  test("a completed new expression retains evaluation and inference in its captured reader", () => {
    const f = fixture();
    expect(f.evaluated().result).toBe("created here");
    expect(f.inferredType()).toBe("String");
    expect(f.graphValue).toBeUndefined();
    expect(f.evaluatedBy).toEqual(["origin"]);
    expect(f.inferredBy).toEqual(["origin"]);
  });

  function previewFixture() {
    const child = { kind: "call", fnId: "fixture-call", args: [] };
    const sibling = { kind: "literal", value: "sibling" };
    const draft = { kind: "literal", value: { __list: [child, sibling] } };
    const requests = [];
    const f = fixture({ draft, evaluateOnRequest: true, evaluate: (node, resolve, session, _data, options) => {
      requests.push({ node, session, options });
      const { sites } = authoringExpressionSites(node, resolve, session);
      return { result: node.value.__list.map(part => part.kind === "call" ? "observed call output" : part.value), trace: [],
        captures: sites.flatMap((site, index) => site.node.kind === "call" ? [{ site: index, value: "observed call output" }] : []) };
    } });
    return { ...f, draft, child, sibling, requests };
  }

  test("explicit Preview supplies root and executed child graph data from one current run", () => {
    const f = previewFixture();
    expect(f.graphValue(f.draft)).toBeUndefined();
    expect(f.graphValue(f.child)).toBeUndefined();
    expect(f.requests).toHaveLength(0);
    f.previewDraft();
    expect(f.saveError()).toBeNull();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].options).toEqual({ capture: true });
    expect(f.graphValue(f.draft)).toEqual({ value: ["observed call output", "sibling"] });
    expect(f.graphValue(f.child)).toEqual({ value: "observed call output" });
    expect(f.graphValue({ ...f.child })).toBeUndefined();
    expect(f.requests).toHaveLength(1);

    const editedChild = { ...f.child };
    const edited = { ...f.draft, value: { __list: [editedChild, { ...f.sibling, value: "edited sibling" }] } };
    f.updateDraft(edited);
    expect(f.graphValue(edited)).toBeUndefined();
    expect(f.graphValue(editedChild)).toBeUndefined();
    expect(f.graphValue(f.child)).toBeUndefined();
    expect(f.requests).toHaveLength(1);
    f.previewDraft();
    expect(f.requests).toHaveLength(2);
    expect(f.graphValue(edited)).toEqual({ value: ["observed call output", "edited sibling"] });
    expect(f.graphValue(editedChild)).toEqual({ value: "observed call output" });
    expect(f.graphValue(f.child)).toBeUndefined();
    expect(f.requests).toHaveLength(2);
  });

  test("explicit Preview graph data expires with captured content, saved data, reader, session and login", () => {
    for (const invalidation of ["content", "saved", "reader", "session", "login"]) {
      const f = previewFixture();
      f.previewDraft();
      expect(f.graphValue(f.child)).toEqual({ value: "observed call output" });
      if (invalidation === "content") f.sibling.value = "mutated content";
      if (invalidation === "saved") f.originSaved.list = () => [{ id: "origin-only", expr: { kind: "literal", value: "changed saved data" } }];
      if (invalidation === "reader") f.origin.state.root.revision++;
      if (invalidation === "session") f.origin.runtime.session = () => ({ ...f.origin.session });
      if (invalidation === "login") f.changeEpoch();
      expect(f.previewCurrent()).toBe(false);
      expect(f.graphValue(f.draft)).toBeUndefined();
      expect(f.graphValue(f.child)).toBeUndefined();
      expect(f.requests).toHaveLength(1);
    }
  });

  test("explicit Preview follows the selected destination reader revision without borrowing the origin", async () => {
    const f = previewFixture();
    await f.chooseCreationScope(f.place("root"));
    expect(f.destination().reader).toBe(f.target.runtime);
    f.previewDraft();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].session).toBe(f.target.session);
    expect(f.graphValue(f.child)).toEqual({ value: "observed call output" });
    f.origin.state.root.revision++;
    expect(f.previewCurrent()).toBe(true);
    expect(f.graphValue(f.child)).toEqual({ value: "observed call output" });
    f.target.state.root.revision++;
    expect(f.previewCurrent()).toBe(false);
    expect(f.graphValue(f.draft)).toBeUndefined();
    expect(f.graphValue(f.child)).toBeUndefined();
    expect(f.requests).toHaveLength(1);
    f.previewDraft();
    expect(f.requests).toHaveLength(2);
    expect(f.previewCurrent()).toBe(true);
    expect(f.graphValue(f.child)).toEqual({ value: "observed call output" });
  });

  test("root expansion retains mixed authored lists and computed siblings without evaluating them", async () => {
    const f = fixture();
    const mixed = { kind: "literal", value: { __list: [
      { kind: "ref", savedExprId: "target-reference" }, { kind: "call", fnId: "fixture-call", args: [] },
    ] } };
    f.target.state.root.items.push({ id: "mixed", caption: "Mixed", source: { kind: "expr", expr: mixed } },
      { id: "computed", caption: "Computed", source: { kind: "expr", expr: { kind: "call", fnId: "fixture-call", args: [] } } });
    const children = await f.creationChildren(f.place("root"));
    expect(children.find(place => place.scope?.itemId === "mixed").canCreate).toBe(true);
    expect(children.find(place => place.scope?.itemId === "computed").canCreate).toBe(false);
    expect(children.some(place => place.scope?.kind === "view" && place.scope.viewId === "target-list")).toBe(true);
    expect(f.evaluatedBy).toEqual([]);
    expect(f.calls.filter(call => call.create || call.update || call.root || call.list || call.savedPlacement)).toEqual([]);
  });

  test("expanding a record discovers its nested collection with the selected source's reader", async () => {
    const f = fixture(), nested = nestedDestination(f);
    const children = await f.creationChildren({ ...nested.place, scope: { ...nested.place.scope, path: [] } });
    const child = children.find(place => place.listName === "nested");
    expect(child.scope.path).toEqual(["nested"]);
    expect(child.listType).toEqual(List(Anything));
    expect(child.canCreate).toBe(true);
    expect(child.canExpand).toBe(true);
    expect(children.find(place => place.listName === "sibling").canCreate).toBe(false);
    expect(f.evaluatedBy.length).toBeGreaterThan(0);
    expect(f.evaluatedBy.every(id => id === "target")).toBe(true);
  });

  test("the scope tree traverses several alternating record/list levels and derives the current collection type", async () => {
    const f = fixture();
    const collectionType = List({ $ref: "String" });
    const item = { id: "deep-owner", caption: "Deep record", valueType: { $record: { fields: [{ name: "groups",
      type: List({ $record: { fields: [{ name: "nested", type: collectionType }] } }) }] } },
      source: { kind: "expr", expr: { kind: "literal", value: { groups: [{ nested: ["kept"] }] } } } };
    f.target.state.root.items.push(item);
    let place = { ...f.place("root"), kind: "list", scope: { kind: "value", viewId: "target", itemId: item.id, rootItem: true, path: [] } };
    for (const step of ["groups", 0, "nested"]) {
      const children = await f.creationChildren(place);
      place = children.find(child => child.scope.path.at(-1) === step);
      expect(place).toBeTruthy();
    }
    expect(place.scope.path).toEqual(["groups", 0, "nested"]);
    expect(place.canCreate).toBe(true);
    expect(place.listType).toEqual(collectionType);
    // The tree's cached type is only a hint; selection re-derives it from the owner.
    await f.chooseCreationScope({ ...place, listType: List({ $ref: "Number" }) });
    expect(f.destination().place.listType).toEqual(collectionType);
    await f.save();
    expect(f.saveError()).toBeNull();
    const written = f.target.state.root.items[0].source.expr;
    expect(expressionAt(written, ["groups", 0, "nested", 0])).toEqual({ kind: "literal", value: "kept" });
    expect(expressionAt(written, ["groups", 0, "nested", 1])).toEqual({ kind: "ref", savedExprId: "target-saved" });
  });

  for (const ownerKind of ["root", "view", "saved"]) {
    test(`creating in a nested ${ownerKind} owner preserves every existing reference and call`, async () => {
      const f = fixture(), nested = nestedDestination(f, ownerKind);
      await f.chooseCreationScope(nested.place);
      await f.save();
      expect(f.saveError()).toBeNull();
      expect(f.closed()).toBe(1);
      const written = nested.currentExpression();
      expect(expressionAt(written, ["nested", 0])).toEqual(nested.reference);
      expect(expressionAt(written, ["nested", 1])).toEqual(nested.call);
      expect(expressionAt(written, ["sibling"])).toEqual(nested.call);
      expect(expressionAt(written, ["nested", 2])).toEqual({ kind: "ref", savedExprId: "target-saved" });
      expect(f.calls.filter(call => call.create || call.update || call.root || call.list || call.savedPlacement)
        .every(call => call.owner === "target")).toBe(true);
      expect(f.calls.filter(call => call.create)).toHaveLength(1);
      expect(f.origin.state.queries).toHaveLength(0);
      expect(f.origin.state.root.items).toHaveLength(0);
      expect(expressionAt(nested.expression, ["nested"]).value.__list).toHaveLength(2);
    });

    test(`an ambiguous nested ${ownerKind} receipt retries without appending a second reference`, async () => {
      const f = fixture(), nested = nestedDestination(f, ownerKind);
      await f.chooseCreationScope(nested.place);
      f.target.state.failAfterPlacement = true;
      await f.save();
      expect(f.saveError()).toBeTruthy();
      expect(f.closed()).toBe(0);
      await f.save();
      expect(f.saveError()).toBeNull();
      expect(f.closed()).toBe(1);
      expect(expressionAt(nested.currentExpression(), ["nested"]).value.__list).toHaveLength(3);
      expect(f.calls.filter(call => call.create)).toHaveLength(1);
      expect(f.calls.filter(call => call.root || call.list || call.savedPlacement)).toHaveLength(1);
    });
  }

  test("a changed nested collection or declared owner type refuses before creating data", async () => {
    for (const change of ["contents", "type"]) {
      const f = fixture(), nested = nestedDestination(f);
      await f.chooseCreationScope(nested.place);
      if (change === "contents") f.target.state.root.items[0].source.expr = appendExpressionAt(nested.expression,
        ["nested"], { kind: "literal", value: "another edit" });
      else f.target.state.root.items[0].valueType = { $record: { fields: [{ name: "nested", type: List({ $ref: "Number" }) }] } };
      await f.save();
      expect(f.saveError()).toContain("collection changed");
      expect(f.calls.filter(call => call.create || call.update || call.root || call.list || call.savedPlacement)).toEqual([]);
      expect(f.closed()).toBe(0);
    }
  });

  test("a source ticket revoked during nested baseline reads refuses before creating data", async () => {
    const f = fixture({ cardAnchor: { x: 420, y: 240 } }), nested = nestedDestination(f);
    await f.chooseCreationScope(nested.place);
    f.target.state.beforeSavedRead = () => f.target.setSource({ replacement: true });
    await f.save();
    expect(f.saveError()).toContain("data source changed");
    expect(f.calls.filter(call => call.create || call.update || call.root || call.list || call.savedPlacement)).toEqual([]);
    expect(f.closed()).toBe(0);
  });

  test("a source ticket revoked during scope selection cannot admit a stale nested baseline", async () => {
    const f = fixture(), nested = nestedDestination(f);
    f.target.state.beforeSavedRead = () => f.target.setSource({ replacement: true });
    await expect(f.chooseCreationScope(nested.place)).rejects.toThrow("source changed");
    expect(f.destination()).toBe(f.initialDestination);
    expect(f.calls.filter(call => call.create || call.update || call.root || call.list || call.savedPlacement)).toEqual([]);
  });

  test("source revocation during a nested placement read retains the created identity and refuses the owner mutation", async () => {
    const f = fixture({ cardAnchor: { x: 420, y: 240 } }), nested = nestedDestination(f, "saved");
    await f.chooseCreationScope(nested.place);
    let savedReads = 0;
    f.target.state.beforeSavedRead = () => { if (++savedReads === 2) f.target.setSource({ replacement: true }); };
    await f.save();
    expect(f.saveError()).toContain("data source changed");
    expect(f.calls.filter(call => call.create)).toHaveLength(1);
    expect(f.calls.filter(call => call.root || call.list || call.savedPlacement)).toEqual([]);
    expect(expressionAt(nested.currentExpression(), ["nested"]).value.__list).toHaveLength(2);
    expect(f.target.state.queries.some(row => row.id === "target-saved")).toBe(true);
    expect(f.closed()).toBe(0);
  });

  for (const kind of ["root", "list"]) {
    test(`creates and places data only in the selected ${kind}'s owner`, async () => {
      const f = fixture();
      await f.chooseCreationScope(f.place(kind));
      await f.save();
      expect(f.saveError()).toBeNull();
      expect(f.calls.filter(call => call.create)).toHaveLength(1);
      expect(f.calls.filter(call => call.create || call.root || call.list || call.originAdd).every(call => call.owner === "target")).toBe(true);
      expect(f.evaluatedBy.every(id => id === "target")).toBe(true);
      const items = kind === "root" ? f.target.state.root.items : f.target.state.root.lists[0].view.items;
      expect(items).toHaveLength(1);
      expect(items[0].source).toEqual({ kind: "ref", ref: { kind: "savedExpr", id: "target-saved" } });
      expect(f.origin.state.queries).toHaveLength(0);
      expect(f.origin.state.root.items).toHaveLength(0);
      expect(f.closed()).toBe(1);
    });

    test(`retry after an ambiguous ${kind} placement keeps the saved identity and occurrence`, async () => {
      const f = fixture();
      await f.chooseCreationScope(f.place(kind));
      f.target.state.failAfterPlacement = true;
      await f.save();
      expect(f.saveError()).toBeTruthy();
      expect(f.closed()).toBe(0);
      const items = () => kind === "root" ? f.target.state.root.items : f.target.state.root.lists[0].view.items;
      const occurrence = items()[0].id;
      await f.save();
      expect(f.saveError()).toBeNull();
      expect(f.calls.filter(call => call.create)).toHaveLength(1);
      expect(f.calls.filter(call => call.update).map(call => call.update)).toEqual(["target-saved"]);
      expect(f.calls.filter(call => call.root || call.list)).toHaveLength(1);
      expect(items().map(item => item.id)).toEqual([occurrence]);
      expect(f.closed()).toBe(1);
    });
  }

  test("an origin-only reference is refused before creating anything in another scope", async () => {
    const f = fixture({ draft: { kind: "ref", savedExprId: "origin-only" } });
    await f.chooseCreationScope(f.place("root"));
    await f.save();
    expect(f.saveError()).toBeTruthy();
    expect(f.calls.filter(call => call.create || call.update || call.root || call.list || call.originAdd)).toEqual([]);
    expect(f.closed()).toBe(0);
  });

  test("a saved reference changed after choosing scope refuses before creating data", async () => {
    const f = fixture({ draft: { kind: "ref", savedExprId: "target-reference" } });
    f.target.state.queries.push({ id: "target-reference", name: "Reference", query: { kind: "expression", expr: { kind: "literal", value: "before" } } });
    await f.chooseCreationScope(f.place("root"));
    f.target.state.queries[0].query.expr = { kind: "literal", value: "after" };
    await f.save();
    expect(f.saveError()).toContain("Referenced data changed");
    expect(f.calls.filter(call => call.create || call.update || call.root || call.list || call.originAdd)).toEqual([]);
    expect(f.closed()).toBe(0);
  });

  test("reactive creation props do not redirect the initially captured destination after navigation", async () => {
    const f = fixture({ cardAnchor: { x: 420, y: 240 } });
    f.props.creation.current = { ...f.initialDestination, place: f.place("root"), client: f.target.client,
      reader: f.target.runtime, assertCurrent: () => {} };
    f.invalidateOriginFocus();
    await f.save();
    expect(f.destination()).toBe(f.initialDestination);
    expect(f.saveError()).toContain("original creation location changed");
    expect(f.calls.filter(call => call.create || call.update || call.root || call.list || call.originAdd)).toEqual([]);
    expect(f.closed()).toBe(0);
  });

  test("an anchored creation cannot acquire a late destination after its epoch changes", async () => {
    const ready = deferred(), f = fixture({ ready, cardAnchor: { x: 420, y: 240 } });
    const selection = f.chooseCreationScope(f.place("root"));
    f.changeEpoch(); ready.resolve(f.target.runtime);
    await selection;
    expect(f.destination()).toBe(f.initialDestination);
    expect(f.calls.filter(call => call.owner === "target")).toEqual([]);
    expect(f.calls.filter(call => call.create || call.update || call.root || call.list || call.originAdd)).toEqual([]);
    expect(f.closed()).toBe(0);
  });

  test("canceling Scope ignores a late reader preparation and retains the original destination", async () => {
    const ready = deferred(), f = fixture({ ready });
    const selection = f.chooseCreationScope(f.place("root"));
    expect(f.preparingScope()).toBe(true);
    f.cancelScope();
    ready.resolve(f.target.runtime);
    await selection;
    expect(f.destination()).toBe(f.initialDestination);
    expect(f.preparingScope()).toBe(false);
    expect(f.calls.filter(call => call.owner === "target")).toEqual([]);
    expect(f.closed()).toBe(0);
  });

  test("a source ticket change during the final creation read refuses before saving", async () => {
    const f = fixture({ cardAnchor: { x: 420, y: 240 } });
    await f.chooseCreationScope(f.place("root"));
    f.target.state.beforeRootRead = () => f.target.setSource({ replacement: true });
    await f.save();
    expect(f.saveError()).toContain("source changed");
    expect(f.calls.filter(call => call.create || call.update || call.root || call.list)).toEqual([]);
  });

  test("an edit during creation's fresh root read refuses before saving and preserves the new draft", async () => {
    const f = fixture({ cardAnchor: { x: 420, y: 240 } });
    await f.chooseCreationScope(f.place("root"));
    const newer = { kind: "literal", value: "typed while checking" };
    f.target.state.beforeRootRead = () => f.updateDraft(newer);
    await f.save();
    expect(f.saveError()).toContain("changed");
    expect(f.calls.filter(call => call.create || call.update || call.root || call.list)).toEqual([]);
    expect(f.closed()).toBe(0);
  });

  test("the shared root placement refuses a source ticket change across its root read", async () => {
    const f = fixture();
    f.target.state.beforePlacementRead = () => f.target.setSource({ replacement: true });
    const placed = await f.addToLocus({ savedExprId: "already-created" }, "New data", undefined, f.target.client, { id: "stable-occurrence" });
    expect(placed).toBe(false);
    expect(f.calls.filter(call => call.root || call.list)).toEqual([]);
    expect(String(f.placementErrors[0][1])).toContain("source changed");
  });
});
