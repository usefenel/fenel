// Run with: bun test --conditions=browser --conditions=development ./src/lib/expression-runner/local-editor-structure-sites.test.mjs
// B4 F2: the expression editor's structure sites, extracted unchanged from
// `index.tsx`, for a Local reader whose page session THROWS on every
// registry, frame, environment and catalogue read. Its published structure
// environment (a real authoring environment over a catalogue) and its worker
// clients (recorded, answered here) are the only sources. Account sessions
// keep reading their own session. B4F2_INDEX_SOURCE points the same tests at
// another revision of index.tsx (the fail-first run against the base).
import { describe, expect, test } from "bun:test";
import { createMemo, createRoot, createSignal, flush, onCleanup } from "../../../node_modules/solid-js/dist/solid.dev.js";
import { createAuthoringEnvironment, expectedSchemeForType, inferAuthoringCallGuidance } from "@fenel/engine/authoring/environment";
import { Maybe, Nothing } from "@fenel/engine/type-foundation";
import { expressionForLiteralValue, seedExpressionForType, expectedTypeForName, constructorExpression } from "./creation-seed";
import { constructorFieldsForTag, peelToArrowType, peelToRecordType, recordFieldsForType, summarizeExprNode, typeDisplayName,
  callSlotMetadata, partialCallNode } from "./expr-node-codec";
import { parameterDisplayName } from "./call-display";
import { localParameterName } from "./local-field-names";
import { codeName, displayNameText, humanName } from "../display-name";

const sourcePath = process.env.B4F2_INDEX_SOURCE ?? new URL("./index.tsx", import.meta.url);
const source = (await Bun.file(sourcePath).text()).replaceAll("\r\n", "\n");
const transpiler = new Bun.Transpiler({ loader: "ts" });
const compiled = code => transpiler.transformSync(code).replace(/^export /gm, "");
function section(start, end, optional = false) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0) { if (optional) return ""; throw new Error(`index.tsx boundary changed: ${start}`); }
  return source.slice(first, last);
}
async function settle() { for (let turn = 0; turn < 16; turn++) { await Promise.resolve(); flush(); } }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

const text = { $ref: "String" }, number = { $ref: "Number" };
const field = (name, type, extra = {}) => ({ name, type, label: Nothing, ui: Nothing, meta: {}, ...extra });
const maybe = Maybe(text);
const point = { $record: { fields: [field("x", number), field("y", number)] } };
const shape = { $variant: { cases: [{ name: "Circle", fields: [field("_0", number)], label: Nothing }, { name: "Dot", fields: [], label: Nothing }] } };
const ctor = (owner, name, params, returns) => ({ id: name, targetId: `@ctor/test/${owner}/${name}`, codeName: name, label: name, description: "",
  kind: "constructor", parentEntity: owner, parentModule: "test", params, returns, scheme: { quantified: [], body: { $arrow: { params, returns } } },
  signatureOutcome: { $tag: "Solved" } });
const amountField = field("amount", number, { key: { $tag: "NamedField", ref: { $ref: "field-amount" } } });
const scale = { id: "scale", codeName: "scale", label: "Scale", description: "", kind: "function", params: [field("shape", { $ref: "Shape" }), amountField],
  returns: { $ref: "Shape" }, scheme: { quantified: [], body: { $arrow: { params: [field("shape", { $ref: "Shape" }), amountField], returns: { $ref: "Shape" } } } },
  signatureOutcome: { $tag: "Solved" } };
const published = createAuthoringEnvironment({
  types: [{ id: "maybe", name: "Maybe", description: "", category: "type", entityId: "Maybe", type: maybe },
    { id: "point", name: "Point", description: "", category: "type", entityId: "Point", type: point },
    { id: "shape", name: "Shape", description: "", category: "type", entityId: "Shape", type: shape }],
  functions: [ctor("Maybe", "Just", [field("_0", text)], maybe), ctor("Maybe", "Nothing", [], maybe),
    ctor("Shape", "Circle", [field("_0", number)], { $ref: "Shape" }), ctor("Shape", "Dot", [], { $ref: "Shape" }), scale],
  capabilities: [], catalogTypes: [maybe, point, shape], operatorCodeNameByNotation: new Map(),
});

function world(kind = "local") {
  const pageReads = [], requests = [], fieldNames = new Map();
  const session = { label: "page session" };
  for (const key of ["registry", "evaluateContext", "environment", "catalog"]) Object.defineProperty(session, key, { get() {
    pageReads.push(`session.${key}`);
    if (kind === "account") return key === "environment" ? published : key === "catalog" ? published.catalog : key === "registry" ? accountRegistry : {};
    throw new Error(`Page session ${key} read for a Local reader`); } });
  const accountRegistry = { getIdentifiedEntity: () => undefined, getFieldRepresentation: () => undefined, getFunction: id => ({ id, params: [], returns: number }) };
  const interfaces = [{ id: "interface", label: "Interfaces", description: "", entries: [{ id: "tc:Labelable", name: "Labelable" }, { id: "spec:Iconable", name: { en: "Iconable" } }] }];
  const reader = { kind, revision: () => 3, session: () => session, registry: () => ({ token: "own registry" }), catalog: () => interfaces,
    typePresentation: type => type.$ref === "Shape" ? { type, label: "Shape (worker)" } : undefined,
    catalogLookups: { fn: id => id === "scale" ? { id: "scale", params: [field("shape", { $ref: "Shape" })], returns: number } : undefined },
    presentation: () => undefined };
  const record = method => (...args) => { const held = deferred(); requests.push({ method, args, ...held }); return held.promise; };
  const helperImports = {
    publishedAuthoringEnvironment: value => kind === "local" && value === session ? published : undefined,
    preparedSnapshotOwnerOf: value => kind === "local" && value === session ? { owner: "snapshot" } : undefined,
    createAuthoringEnvironment, parameterDisplayName, localParameterName, humanName, codeName, Nothing,
    localFieldName: (_reader, _session, id) => fieldNames.get(id),
    typePhrase: () => "page phrase", valueCardLabel: value => value, displayTypeLabel: type => `display ${JSON.stringify(type)}`,
  };
  return { session, reader, pageReads, requests, record, helperImports, fieldNames, kind };
}

const helperCode = section("let emptyStructureEnvironment", "/** Thin UI adapter over the pure ExprNode codec. */", true);
const typeNameCode = section("function typeNameOf(", "// structural-dispatch Phase 4a");
/** Compile production `code` with the world's imports plus `extra`; return `names`. */
function load(w, code, names, extra = {}) {
  const imports = { ...w.helperImports, typeDisplayName, ...extra };
  return new Function(...Object.keys(imports), `${compiled(helperCode)}\n${compiled(typeNameCode)}\n${compiled(code)}\nreturn { ${names.join(", ")} };`)(
    ...Object.values(imports));
}

describe("B4 F2: Local editor structure sites read published data and the worker, never the page session", () => {
  test("record seeds, lambda seeds and expected record fields come from the published environment", () => {
    const w = world();
    const api = load(w, section("function isBlankLiteral(", "function seedStructuralNode("), ["expectedRecordFieldsFor", "seedRecordFields", "seedLambda"],
      { recordFieldsForType, seedExpressionForType, expressionForLiteralValue, peelToArrowType, detectStructuralForm: () => null });
    expect(api.expectedRecordFieldsFor(point, w.session)).toEqual(recordFieldsForType(point, published));
    expect(api.seedRecordFields({ kind: "literal", value: undefined }, recordFieldsForType(point, published), w.session))
      .toEqual([{ name: "x", value: seedExpressionForType(number, published) }]);
    expect(api.seedRecordFields({ kind: "literal", value: { x: 1, y: 2 } }, recordFieldsForType(point, published), w.session))
      .toEqual([{ name: "x", value: expressionForLiteralValue(1, number, published) }, { name: "y", value: expressionForLiteralValue(2, number, published) }]);
    const arrow = { $arrow: { params: [field("n", number)], returns: number } };
    expect(api.seedLambda(arrow, w.session)).toEqual(seedExpressionForType(arrow, published));
    expect(w.pageReads).toEqual([]);
  });

  test("function entries, node summaries and type names come from the published environment", () => {
    const w = world();
    const api = load(w, section("function authoringFunctionEntry(", "function functionPickerSelectionId(")
      + section("function summarizeNode(", "/** Same idea for raw match-arm patterns"), ["authoringFunctionEntry", "summarizeNode", "typeNameOf"],
      { summarizeExprNode, fnCodeName: id => id, DETACHED_AUTHORING_SESSION: {} });
    expect(api.authoringFunctionEntry(w.session, "scale")).toEqual(published.getFunctionEntry("scale"));
    const node = { kind: "call", fnId: "@ctor/test/Shape/Circle", args: [{ kind: "literal", value: 2 }] };
    expect(api.summarizeNode(node, w.session, [])).toEqual(summarizeExprNode(node, id => id, { constructorRoutes: published.catalog.exactConstructorRoutes ?? [],
      constructorTargets: published.catalog.patternConstructors ?? [], referenceRoutes: published.catalog.referenceRoutes ?? [], boundNames: [] }));
    expect(api.typeNameOf({ $ref: "Shape" }, w.session)).toEqual(typeDisplayName({ $ref: "Shape" }, published));
    expect(w.pageReads).toEqual([]);
  });

  test("a call's next and remaining inputs are seeded from the published environment", () => {
    const w = world();
    const changes = [];
    const props = { node: { kind: "call", fnId: "scale", args: [] }, onChange: next => changes.push(next), expectedType: undefined };
    const imports = {
      useAuthoringSession: () => w.session, useContext: () => () => [], useReaderRuntime: () => w.reader, LambdaParamsContext: {},
      ExpressionGraphScopeCaptureContext: {}, useExpressionInferenceContext: () => () => ({ ...published, literalMembership: () => Nothing, bindings: {} }),
      createMemo, measureAuthoringWork: (_label, run) => run(),
      callArgumentPlan: (node, entry, expected, context) => inferAuthoringCallGuidance(entry, node.args, expected, context),
      registryCallParams: entry => entry.params, callSlotMetadata, partialCallNode, nextReturnedFunctionParameter: () => undefined,
      fnCodeName: id => id, seedExpressionForType, props,
    };
    const run = () => createRoot(dispose => {
      const api = load(w, section("function authoringFunctionEntry(", "function functionPickerSelectionId(")
        + section("function CallEditor(props: {", "  const pendingCall = () => pendingCalls.has(props.node);")
          .replace(/^function CallEditor\(props: \{[\s\S]*?\}\) \{\n/, ""), ["fillNextArg", "fillAllArgs", "params"], imports);
      return { api, dispose };
    });
    const { api, dispose } = run();
    api.fillNextArg();
    api.fillAllArgs();
    expect(changes[0]).toEqual({ ...props.node, args: [seedExpressionForType({ $ref: "Shape" }, published)] });
    expect(changes[1].args).toEqual([seedExpressionForType({ $ref: "Shape" }, published), seedExpressionForType(number, published)]);
    expect(w.pageReads).toEqual([]);
    dispose();
  });

  test("a function pin and the interface picker read the reader's worker data", async () => {
    const w = world();
    const pin = createRoot(dispose => ({ dispose, api: load(w, section("function PinLiteralDisplay(props: {", "  const isType = () =>")
      .replace(/^function PinLiteralDisplay\(props: \{[\s\S]*?\}\) \{\n/, ""), ["fn"],
      { useAuthoringSession: () => w.session, useReaderRuntime: () => w.reader, createMemo, props: { pin: { kind: "function", name: "scale", id: "scale" } } }) }));
    expect(pin.api.fn()).toEqual(w.reader.catalogLookups.fn("scale"));
    pin.dispose();
    const rows = load(w, section("function fetchEntityIdRows(", "function EntityIdPicker("), ["fetchEntityIdRows"],
      { sessionCatalogSections: () => { w.pageReads.push("sessionCatalogSections"); return []; }, canonical: value => typeof value === "string" ? value : value.en });
    expect(await rows.fetchEntityIdRows("typeclass", {}, w.session, w.reader)).toEqual([{ id: "Labelable", label: "Labelable" }, { id: "Iconable", label: "Iconable" }]);
    expect(w.pageReads).toEqual([]);
  });

  test("the parameter picker filters its inputs by the worker's verdicts; pending offers none and says nothing", async () => {
    const w = world();
    const params = [{ name: "a", type: number }, { name: "b", type: text }];
    let compatibility;
    const imports = {
      useAuthoringSession: () => w.session, useContext: () => () => params, LambdaParamsContext: {}, useReaderRuntime: () => w.reader,
      createSignal, createMemo, expectedSchemeForType, judgeAuthoringSchemeCompatibility: () => { w.pageReads.push("page judgment"); return "compatible"; },
      createLocalPickerCompatibility: (_reader, _session, items) => {
        const [answer, setAnswer] = createSignal();
        compatibility = { items, answer: setAnswer };
        return { verdicts: () => answer(), pending: () => answer() === undefined, error: () => undefined };
      },
      props: { paramType: number, onPick() {} },
    };
    const picker = createRoot(dispose => ({ dispose, api: load(w, section("function ParamPicker(props: {", "  const listId = createUniqueId();")
      .replace(/^function ParamPicker\(props: \{[\s\S]*?\}\) \{\n/, ""), ["filtered"], imports) }));
    expect(compatibility.items()).toEqual(params.map(p => ({ scheme: { quantified: [], body: p.type }, expected: expectedSchemeForType(number, published) ?? number })));
    expect(picker.api.filtered()).toEqual([]);
    compatibility.answer([{ compatibility: "compatible" }, { compatibility: "unknown" }]);
    await settle();
    expect(picker.api.filtered().map(p => p.name)).toEqual(["a"]);
    expect(w.pageReads).toEqual([]);
    picker.dispose();
  });

  test("the saved-value picker infers and judges its values in the worker", async () => {
    const w = world();
    const saved = [{ id: "s1", name: "One", expr: { kind: "literal", value: 1 } }, { id: "s2", name: "Two", expr: { kind: "literal", value: "x" } }];
    const { createAsyncValue } = await import("../async-value.ts");
    const imports = {
      useAuthoringSession: () => w.session, useContext: () => ({ list: () => saved, byId: id => saved.find(sv => sv.id === id) }),
      SavedValuesContext: {}, useReaderRuntime: () => w.reader, createSignal, createMemo, createAsyncValue, expectedSchemeForType,
      authoringWorkerSnapshot: () => ({ worker: "one" }), LIVE_INFERENCE_BATCH_LIMIT: 64, NESTED_TOOLS_PENDING: "pending",
      inferExpressionsInWorker: w.record("infer-expression"),
      inferExpression: () => { w.pageReads.push("page inference"); return {}; },
      judgeAuthoringSchemeCompatibility: () => { w.pageReads.push("page judgment"); return "compatible"; },
      props: { fieldType: number, onPick() {} },
    };
    const picker = createRoot(dispose => ({ dispose, api: load(w, section("function SavedValuePicker(props: {", "  const listId = createUniqueId();")
      .replace(/^function SavedValuePicker\(props: \{[\s\S]*?\}\) \{\n/, ""), ["filtered", "savedUnavailable", "savedChecked"], imports) }));
    await settle();
    expect(picker.api.filtered()).toEqual([]);
    // While the worker check runs, the type-filtered "None of your saved values" claim stays silent.
    expect(picker.api.savedChecked()).toBe(false);
    expect(w.requests.map(row => row.method)).toEqual(["infer-expression"]);
    const expected = expectedSchemeForType(number, published) ?? { quantified: [], body: number };
    expect(w.requests[0].args[1]).toEqual(saved.map(sv => ({ node: sv.expr, expectedScheme: expected, compatibility: expected })));
    w.requests[0].resolve([{ outcome: { $tag: "Solved" }, compatibility: "compatible" }, { outcome: { $tag: "Solved" }, compatibility: "incompatible" }]);
    await settle();
    expect(picker.api.filtered().map(sv => sv.id)).toEqual(["s1"]);
    expect(picker.api.savedUnavailable()).toBeUndefined();
    expect(picker.api.savedChecked()).toBe(true);
    expect(w.pageReads).toEqual([]);
    picker.dispose();
  });

  test("the saved-value picker shows the existing unavailable copy when its worker check fails", async () => {
    const w = world();
    const saved = [{ id: "s1", name: "One", expr: { kind: "literal", value: 1 } }];
    const { createAsyncValue } = await import("../async-value.ts");
    const imports = {
      useAuthoringSession: () => w.session, useContext: () => ({ list: () => saved, byId: id => saved.find(sv => sv.id === id) }),
      SavedValuesContext: {}, useReaderRuntime: () => w.reader, createSignal, createMemo, createAsyncValue, expectedSchemeForType,
      authoringWorkerSnapshot: () => ({ worker: "one" }), LIVE_INFERENCE_BATCH_LIMIT: 64, NESTED_TOOLS_PENDING: "This reader's editing tools are not ready.",
      inferExpressionsInWorker: () => undefined, inferExpression: () => ({}), judgeAuthoringSchemeCompatibility: () => "compatible",
      props: { fieldType: number, onPick() {} },
    };
    const picker = createRoot(dispose => ({ dispose, api: load(w, section("function SavedValuePicker(props: {", "  const listId = createUniqueId();")
      .replace(/^function SavedValuePicker\(props: \{[\s\S]*?\}\) \{\n/, ""), ["filtered", "savedUnavailable", "savedChecked"], imports) }));
    await settle();
    expect(picker.api.filtered()).toEqual([]);
    expect(picker.api.savedUnavailable()).toBe("This reader's editing tools are not ready.");
    // A failed check is not a finding about the saved values: no "None of your saved values" claim.
    expect(picker.api.savedChecked()).toBe(false);
    picker.dispose();
  });

  test("the live trace runs in the worker; the previous trace stays shown while the next one is pending", async () => {
    const w = world();
    const { createAsyncValue } = await import("../async-value.ts");
    const [expr, setExpr] = createSignal({ kind: "literal", value: 1 });
    const imports = {
      useAuthoringSession: () => w.session, useContext: () => null, SavedValuesContext: {}, useReaderRuntime: () => w.reader,
      createMemo, createAsyncValue, onCleanup, authoringWorkerSnapshot: () => ({ worker: "one" }), NESTED_TOOLS_PENDING: "pending",
      evaluateExpressionInWorker: w.record("evaluate-expression"),
      evaluateAuthoringExpression: () => { w.pageReads.push("page evaluation"); return { result: "page", trace: [] }; },
      props: { get expr() { return expr(); }, authoringSession: undefined },
    };
    const trace = createRoot(dispose => ({ dispose, api: load(w, section("export function ExpressionTrace(props: {", "  const isPipe = () =>")
      .replace(/^export function ExpressionTrace\(props: \{[\s\S]*?\}\) \{\n/, ""), ["evaluated"], imports) }));
    await settle();
    trace.api.evaluated();
    await settle();
    expect(w.requests.map(row => row.method)).toEqual(["evaluate-expression"]);
    expect(w.requests[0].args[1]).toEqual({ kind: "literal", value: 1 });
    expect(w.requests[0].args[5]).toEqual({ trace: true, priority: "guidance" });
    const steps = [{ fnName: "add", args: [1, 2], result: 3, op: "=" }];
    w.requests[0].resolve({ result: 3, trace: steps });
    await settle();
    expect(trace.api.evaluated()).toEqual({ result: 3, trace: steps });
    setExpr({ kind: "literal", value: 2 });
    await settle();
    expect(w.requests).toHaveLength(2);
    // The newer draft aborted the older run (latest wins).
    expect(w.requests[0].args[3].aborted).toBe(true);
    // Pending: the previous trace, unchanged.
    expect(trace.api.evaluated()).toEqual({ result: 3, trace: steps });
    w.requests[1].resolve({ result: 2, trace: [] });
    await settle();
    expect(trace.api.evaluated()).toEqual({ result: 2, trace: [] });
    expect(w.pageReads).toEqual([]);
    trace.dispose();
  });

  test("Account sessions keep reading their own session (unchanged)", () => {
    const w = world("account");
    const api = load(w, section("function isBlankLiteral(", "function seedStructuralNode("), ["expectedRecordFieldsFor"],
      { recordFieldsForType, seedExpressionForType, expressionForLiteralValue, peelToArrowType, detectStructuralForm: () => null });
    expect(api.expectedRecordFieldsFor(point, w.session)).toEqual(recordFieldsForType(point, published));
    expect(w.pageReads).toEqual(["session.environment"]);
  });
});

describe("B4 F2: the helpers a Local session reads instead of its page session", () => {
  const w = world();
  const helpers = () => load(w, "", ["editorEnvironment", "localStructure", "editorFrame", "editorFieldRegistry", "editorContainment",
    "editorParameterName", "editorTypePhrase"]);
  test("published environment, no frame, the reader's own registry by identity, no page containment", () => {
    const api = helpers();
    expect(api.editorEnvironment(w.session)).toBe(published);
    expect(api.localStructure(w.session)).toBe(true);
    expect(api.editorFrame(w.session)).toBeUndefined();
    expect(api.editorFieldRegistry(w.session, w.reader)).toEqual({ token: "own registry" });
    expect(api.editorContainment(w.session)).toEqual({});
    expect(w.pageReads).toEqual([]);
  });
  test("parameter names come from the worker once answered; type phrases from the worker presentation", () => {
    const api = helpers();
    expect(api.editorParameterName(amountField, 0, w.session, w.reader)).toEqual({ text: "amount", code: true });
    w.fieldNames.set("field-amount", { label: "Amount" });
    expect(api.editorParameterName(amountField, 0, w.session, w.reader)).toEqual({ text: "Amount", code: false });
    expect(api.editorTypePhrase({ $ref: "Shape" }, w.session, w.reader)).toBe("Shape (worker)");
    expect(api.editorTypePhrase({ $ref: "Point" }, w.session, w.reader)).toBe(typeDisplayName({ $ref: "Point" }, published));
    expect(w.pageReads).toEqual([]);
  });
  test("a Local session that published nothing reads an empty environment, never the page", () => {
    const bare = world();
    const api = load({ ...bare, helperImports: { ...bare.helperImports, publishedAuthoringEnvironment: () => undefined } }, "", ["editorEnvironment"]);
    expect(api.editorEnvironment(bare.session).catalog.functions).toEqual([]);
    expect(bare.pageReads).toEqual([]);
  });
});

describe("B4 F2 fix round: a Local new item's literal seed is data without evaluation", () => {
  test("a constructor seed of literals becomes the data the existing projection reads back; anything else stays empty", async () => {
    const w = world();
    const { detectStructuralForm } = await import("./expression-structure.ts");
    const api = load(w, section("function authoringFunctionEntry(", "function functionPickerSelectionId(")
      + section("/** B4 F2: the data a purely literal seed stands for", "/** Thin UI adapter over the pure ExprNode codec. */"),
      ["literalSeedData"], { seedExpressionForType, expressionForLiteralValue, detectStructuralForm: value => detectStructuralForm(value, () => false) });
    const seedOf = type => seedExpressionForType(type, published);
    // Maybe String seeds Nothing; Shape seeds Dot; a Circle of 2 is a call of literals.
    expect(api.literalSeedData(seedOf(maybe), maybe, w.session)).toEqual({ value: { $tag: "Nothing" } });
    expect(api.literalSeedData(seedOf({ $ref: "Shape" }), { $ref: "Shape" }, w.session)).toEqual({ value: { $tag: "Dot" } });
    const circle = { kind: "call", fnId: "@ctor/test/Shape/Circle", args: [{ kind: "literal", value: 2 }] };
    expect(api.literalSeedData(circle, { $ref: "Shape" }, w.session)).toEqual({ value: { $tag: "Circle", _0: 2 } });
    // A computed or incomplete seed stays empty (never evaluated on the page).
    expect(api.literalSeedData({ kind: "call", fnId: "scale", args: [] }, { $ref: "Shape" }, w.session)).toBeUndefined();
    expect(api.literalSeedData({ kind: "call", fnId: "@ctor/test/Shape/Circle", args: [{ kind: "literal", value: undefined }] },
      { $ref: "Shape" }, w.session)).toBeUndefined();
    expect(w.pageReads).toEqual([]);
  });

  test("Save refuses a list literal with an empty item", async () => {
    const { draftSaveIssue } = await import("./creation-validation.ts");
    const { List } = await import("@fenel/engine/type-foundation");
    expect(draftSaveIssue({ kind: "literal", value: [1, undefined] }, published, { expectedType: List(number) })).toBeDefined();
  });
});

describe("B4 F2 fix round: a Local record constructor keeps the record type's caption", () => {
  test("the owner's worker facts select the catalogue label the page showed; otherwise the constructor's name", () => {
    const w = world();
    const record = { $record: { fields: [field("x", number)] } };
    const make = { ...ctor("Pos", "Pos", [field("x", number)], { $ref: "Pos" }), ownerIdentity: "owner-pos" };
    const env = createAuthoringEnvironment({ ...published.catalog, operatorCodeNameByNotation: new Map(),
      types: [...published.catalog.types, { id: "pos", name: "Position", description: "", category: "type", entityId: "Pos", type: record }],
      functions: [...published.catalog.functions, make] });
    const owners = { Pos: { id: "Pos", nominalIdentity: "owner-pos", type: record } };
    w.reader.catalogLookups = { ...w.reader.catalogLookups, entityType: name => owners[name]?.type, entityOwner: name => owners[name] };
    const run = (tag, imports = {}) => createRoot(dispose => {
      const api = load({ ...w, helperImports: { ...w.helperImports, publishedAuthoringEnvironment: value => value === w.session ? env : undefined } },
        section("function authoringFunctionEntry(", "function functionPickerSelectionId(")
        + section("function ConstructValueEditor(props: {", "  function fieldScheme(name: string)").replace(/^function ConstructValueEditor\(props: \{[\s\S]*?\}\) \{\n/, ""),
        ["displayTag"], { useAuthoringSession: () => w.session, useReaderRuntime: () => w.reader, createSignal, createMemo, constructorFieldsForTag,
          functionPickerDisplayName: entry => `ctor ${entry.id}`, props: { tag, fields: [] }, ...imports });
      const shown = api.displayTag();
      dispose();
      return shown;
    });
    expect(run("@ctor/test/Pos/Pos")).toBe("Position");
    owners.Pos = { id: "Pos", nominalIdentity: "another-owner", type: record };
    expect(run("@ctor/test/Pos/Pos")).toBe("ctor Pos");
    expect(w.pageReads).toEqual([]);
  });
});

describe("B4 F2 fix round: a Local editor follows its reactive session", () => {
  test("a facade swapping sessions re-runs the structure helpers (a new draft, a reload, Local to Account)", async () => {
    const { createLocalAuthoringSession, createAccountAuthoringSession, publishedAuthoringEnvironment, reactiveAuthoringSession } =
      await import("./account-authoring-session.ts");
    const environmentWith = extra => createAuthoringEnvironment({ ...published.catalog, operatorCodeNameByNotation: new Map(), functions: [...published.catalog.functions, ...extra] });
    const base = environment => Object.freeze({ mode: "detached", registry: {}, catalog: environment.catalog, environment, evaluateContext: {} });
    const double = { id: "tab:double", params: [field("n", number)], returns: number, body: 1 };
    const first = createLocalAuthoringSession(base(published), { sourceId: "tab", functions: [double] });
    const draft = createLocalAuthoringSession(first, { sourceId: "tab", functions: [double],
      draft: { ...double, params: [field("n", number), field("m", number)] } });
    const reloaded = createLocalAuthoringSession(base(environmentWith([{ ...scale, id: "reloaded", codeName: "reloaded" }])), { sourceId: "tab", functions: [] });
    const account = createAccountAuthoringSession(base(published), { accountId: "acct", functions: [] });
    const w = world();
    const api = load({ ...w, helperImports: { ...w.helperImports, publishedAuthoringEnvironment, preparedSnapshotOwnerOf: () => undefined } }, "",
      ["editorEnvironment", "editorCatalog", "localStructure"]);
    const [current, setCurrent] = createSignal(first);
    const { dispose, reads } = createRoot(dispose => {
      const facade = reactiveAuthoringSession(() => current());
      return { dispose, reads: {
        params: createMemo(() => api.editorEnvironment(facade).getFunctionEntry?.("tab:double")?.params.length),
        reloaded: createMemo(() => api.editorCatalog(facade).functions.some(entry => entry.id === "reloaded")),
        local: createMemo(() => api.localStructure(facade)),
      } };
    });
    expect([reads.params(), reads.reloaded(), reads.local()]).toEqual([1, false, true]);
    setCurrent(draft); flush();
    expect(reads.params()).toBe(2);
    setCurrent(reloaded); flush();
    expect(reads.reloaded()).toBe(true);
    setCurrent(account); flush();
    expect(reads.local()).toBe(false);
    dispose();
  });
});

describe("B4 F2 (slice 2 review M3): a pending Local answer keeps the occurrence's hints as last shown", () => {
  test("the inferred type, mismatch and edge issue stay unchanged until the new answer arrives", () => {
    const code = section("  const answerPending = () => {", "  // Browser lifetime only");
    const [answer, setAnswer] = createSignal({ inferred: "Number", mismatch: "Needs Text", graphIssue: "edge" });
    const [node, setNode] = createSignal({ kind: "literal", value: 1 });
    const [busy, setBusy] = createSignal(true);
    const imports = {
      guidance: { busy }, createMemo, props: { get node() { return node(); } },
      currentInference: () => answer() ? { outcome: { $tag: "Solved" } } : undefined, annotation: () => undefined, observedInference: () => undefined,
      contract: () => ({ inferred: answer()?.inferred, mismatch: answer()?.mismatch, declared: "Text" }),
      resultGuidance: () => answer() ? { graphIssue: answer().graphIssue } : undefined,
    };
    const { api, dispose } = createRoot(dispose => ({ dispose,
      api: new Function(...Object.keys(imports), `${compiled(code)}\nreturn { hint };`)(...Object.values(imports)) }));
    expect(api.hint()).toEqual({ inferred: "Number", mismatch: "Needs Text", graphIssue: "edge" });
    setNode({ kind: "literal", value: 2 }); setAnswer(undefined); flush();
    expect(api.hint()).toEqual({ inferred: "Number", mismatch: "Needs Text", graphIssue: "edge" });
    setAnswer({ inferred: "Number", mismatch: undefined, graphIssue: undefined }); flush();
    expect(api.hint()).toEqual({ inferred: "Number", mismatch: undefined, graphIssue: undefined });
    // A request that failed or is never sent (no worker): the held hint drops.
    setNode({ kind: "literal", value: 3 }); setAnswer(undefined); flush();
    expect(api.hint().mismatch).toBeUndefined();
    setAnswer({ inferred: "Number", mismatch: "Needs Text", graphIssue: "edge" }); flush();
    setNode({ kind: "literal", value: 4 }); setAnswer(undefined); flush();
    expect(api.hint()).toEqual({ inferred: "Number", mismatch: "Needs Text", graphIssue: "edge" });
    setBusy(false); flush();
    expect(api.hint()).toEqual({ inferred: undefined, mismatch: undefined, graphIssue: undefined });
    setBusy(true);
    // A blank slot has no pending answer: its empty hint shows at once.
    setNode({ kind: "literal", value: undefined }); setAnswer(undefined); flush();
    expect(api.hint()).toEqual({ inferred: undefined, mismatch: undefined, graphIssue: undefined });
    dispose();
  });
});
