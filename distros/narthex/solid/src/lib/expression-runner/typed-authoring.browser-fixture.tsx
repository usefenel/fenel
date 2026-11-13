import { createSignal, Loading, snapshot } from "solid-js";
import { render } from "@solidjs/web";
import { Nothing, Maybe, List } from "@fenel/engine/type-foundation";
import type { FenelType, TypeScheme, FieldDef } from "@fenel/engine/types";
import { ExpressionEditor, DETACHED_AUTHORING_SESSION, accountAuthoringSession, SavedValuesContext, LambdaParamsContext, toLogic, evaluateAuthoringExpression, type ExprNode, type ExprViewMode, type LambdaParam } from "./index";
import { userFunctions } from "../user-registries";
import { expectedTypeForName, seedExpressionForType } from "./creation-seed";
import { draftSaveIssue } from "./creation-validation";
import { expectedSchemeForType, projectAuthoringScheme } from "@fenel/engine/authoring/environment";
import { validateValue } from "@fenel/engine/validation";
import { literalMembershipFor } from "./literal-membership";
import { createLocalReaderAuthoringSession } from "./authoring-session";
import { createLocalRegistryToken, createPreparedSnapshotOwner, prepareLocalCatalogInWorker } from "./authoring-catalog-worker";
import { namedFieldOccurrence } from "../field-occurrence/model";
import { FieldPresentationRegistryProvider } from "../field-renderer/field-presentation-context";
import type { FieldPersistenceSnapshot } from "@fenel/engine/field-authoring";

let dispose: (() => void) | undefined;
let readNode: () => ExprNode = () => ({ kind: "literal", value: undefined });
let readType: () => FenelType | undefined = () => undefined;
let setType: (name: string) => void = () => {};
let setNode: (node: ExprNode) => void = () => {};
let setRequirement: (type: FenelType | undefined) => void = () => {};
let setParams: (params: LambdaParam[]) => void = () => {};
let writes = 0;
let session = DETACHED_AUTHORING_SESSION;
const saved = {
  list: () => [
    { id: "saved-image", name: "Saved image", expr: { kind: "literal", value: { width: 1, height: 1, pixels: [{ r: 12, g: 34, b: 56, a: 255 }] } } as ExprNode },
    { id: "saved-number", name: "Saved number", expr: { kind: "literal", value: 7 } as ExprNode },
    { id: "saved-total", name: "Saved total", expr: { kind: "literal", value: 12 } as ExprNode },
  ],
  byId: (id: string) => saved.list().find((value) => value.id === id),
};
const resolver = (id: string) => saved.byId(id)?.expr;
const fixtureSource = "typed-authoring-context-fixture";
const fixtureFieldSnapshot: FieldPersistenceSnapshot = {
  owners: [{
    ownerKey: "type:390cfd50-627f-4eaf-8f03-24d9d4082525",
    kind: "type",
    storageName: "ContextRecordFixture",
    definition: {
      id: "390cfd50-627f-4eaf-8f03-24d9d4082525",
      type: { $record: { fields: [
        namedFieldOccurrence("6c895f5f-a215-4da9-a5c7-bf32c6c93321", "amount", { $ref: "Number" }),
        namedFieldOccurrence("ce6cab26-0f2c-48a0-bae5-a73f570cdb33", "label", { $ref: "String" }),
      ] } },
    },
  }],
  fields: [
    { id: "6c895f5f-a215-4da9-a5c7-bf32c6c93321", currentCodeName: "amount", status: "live", realm: "account", reuseVisibility: "account" },
    { id: "ce6cab26-0f2c-48a0-bae5-a73f570cdb33", currentCodeName: "label", status: "live", realm: "account", reuseVisibility: "account" },
  ],
  facets: [
    { fieldId: "6c895f5f-a215-4da9-a5c7-bf32c6c93321", typeName: "Codeable", methods: { codeName: "amount" }, scope: "account", priority: 100 },
    { fieldId: "ce6cab26-0f2c-48a0-bae5-a73f570cdb33", typeName: "Codeable", methods: { codeName: "label" }, scope: "account", priority: 100 },
  ],
};

const fixture = {
  async prepare() {
    // B4 wave 5: as production Local, a registry token and a frameless session.
    const catalog = await prepareLocalCatalogInWorker(fixtureSource, fixtureFieldSnapshot, [], []);
    session = createLocalReaderAuthoringSession(createLocalRegistryToken(), createPreparedSnapshotOwner(), fixtureSource, [], catalog);
  },
  productionBodyRequirement(kind: "new" | "saved", mode: "infer" | "explicit", extractedBody: string) {
    const type: FenelType = { $ref: "String" };
    const owned: TypeScheme = { quantified: [], body: { $arrow: { params: [], returns: type } } };
    const requirement = kind === "new"
      ? new Function("resultMode", "returnsType", "resultType", "ownedScheme", "Nothing", "projectAuthoringScheme", extractedBody)(
        () => mode, () => type, () => type, () => owned, Nothing, projectAuthoringScheme)
      : new Function("functionResultMode", "functionBodyReturnType", "functionOwnedScheme", "Nothing", "projectAuthoringScheme", extractedBody)(
        () => mode, () => type, () => owned, Nothing, projectAuthoringScheme);
    return requirement as { field?: FieldDef; scheme?: TypeScheme };
  },
  useAccountSession(accountId: string) { session = accountAuthoringSession({ accountId, functions: userFunctions() }); },
  mount(name: string, node?: ExprNode, viewMode: ExprViewMode = "nested", type?: FenelType, params: LambdaParam[] = [], options: { graphAuthoring?: boolean; expectedScheme?: TypeScheme } = {}) {
    dispose?.();
    writes = 0;
    const host = document.getElementById("fixture")!;
    host.replaceChildren();
    dispose = render(() => {
      const [typeName, updateTypeName] = createSignal(name);
      const [declared, updateRequirement] = createSignal(type);
      const [localParams, updateParams] = createSignal(params);
      const expectedType = () => declared() ?? expectedTypeForName(typeName(), session.environment);
      const [current, updateNode] = createSignal(node ?? seedExpressionForType(expectedType(), session.environment, name));
      readNode = current;
      readType = expectedType;
      setNode = updateNode;
      setType = updateTypeName;
      setRequirement = updateRequirement;
      setParams = updateParams;
      return <Loading fallback={<p>Loading editor…</p>}>
        <FieldPresentationRegistryProvider registry={session.registry}>
        <SavedValuesContext value={saved}>
        <LambdaParamsContext value={localParams}>
        <ExpressionEditor expr={current()} onChange={(value) => { writes++; updateNode(value); }}
          typeName={typeName() || undefined} fieldDef={expectedType() ? { name: "value", type: expectedType()!, label: Nothing, meta: {}, ui: Nothing } : undefined}
          expectedScheme={options.expectedScheme} graphAuthoring={options.graphAuthoring}
          authoringSession={session} viewMode={viewMode} hideLabel />
        </LambdaParamsContext>
        </SavedValuesContext>
        </FieldPresentationRegistryProvider>
      </Loading>;
    }, host);
  },
  mountScenario(name: string, viewMode: ExprViewMode = "nested") {
    const number: FenelType = { $ref: "Number" };
    const maybe = Maybe(number);
    if (name === "context-number-list") return fixture.mount("", { kind: "literal", value: {
      __list: [{ kind: "literal", value: "abc" }],
    } }, viewMode, List(number));
    if (name === "context-number-record") return fixture.mount("", { kind: "literal", value: {
      __record: { fields: [{ name: "amount", value: { kind: "literal", value: "abc" } }] },
    } }, viewMode, { $record: { fields: [namedFieldOccurrence("6c895f5f-a215-4da9-a5c7-bf32c6c93321", "amount", number)] } });
    if (name === "context-mixed-record-list") return fixture.mount("", { kind: "literal", value: [
      { amount: 4, label: "A" }, { other: 9, label: "B" },
    ] }, viewMode, undefined, [], { graphAuthoring: true });
    if (name === "context-record-list" || name === "context-empty-record-list") {
      if (name === "context-record-list") return fixture.mount("", { kind: "literal", value: [{ amount: 4, label: "Example" }] }, viewMode,
        undefined, [], { graphAuthoring: true });
      const type = List({ $record: { fields: [
        namedFieldOccurrence("6c895f5f-a215-4da9-a5c7-bf32c6c93321", "amount", number),
        namedFieldOccurrence("ce6cab26-0f2c-48a0-bae5-a73f570cdb33", "label", { $ref: "String" }),
      ] } });
      return fixture.mount("", { kind: "literal", value: { __ann: {
        expr: { kind: "literal", value: [] },
        type,
      } } }, viewMode);
    }
    if (name === "keyboard-local") return fixture.mount("Number", { kind: "literal", value: 3 }, viewMode, number, [
      { name: "firstNumber", type: number },
      { name: "textOnly", type: { $ref: "String" } },
      { name: "secondNumber", type: number },
    ]);
    if (name === "maybe-list") return fixture.mount("List(Maybe(Number))", { kind: "literal", value: [] }, viewMode, List(maybe));
    if (name === "image-list") return fixture.mount("List(Image)", { kind: "literal", value: [] }, viewMode, List(expectedTypeForName("Image", session.environment)!));
    const id = session.catalog.functions.find((entry) => entry.id === "std:id" || entry.codeName === "id");
    if (!id) throw new Error("identity function is missing from the catalog");
    const node: ExprNode = { kind: "call", fnId: id.targetId ?? id.id, args: [{ kind: "literal", value: 3 }] };
    fixture.mount("Maybe(Number)", name === "nested-identity"
      ? { ...node, args: [node] } : node, viewMode, maybe);
  },
  state: () => ({ node: snapshot(readNode()), type: snapshot(readType()), logic: toLogic(readNode(), resolver, session), writes,
    saveIssue: draftSaveIssue(readNode(), session.environment, { expectedType: readType(), registry: session.registry, evaluateContext: session.evaluateContext, resolveSavedExpr: resolver }),
  }),
  rawNode: () => snapshot(readNode()),
  replaceType: (name: string) => setType(name),
  replaceRequirement: (type?: FenelType) => setRequirement(type),
  replaceParams: (params: LambdaParam[]) => setParams(params),
  replaceNode: (node: ExprNode) => setNode(node),
  replaceCallArgument: (index: number, node: ExprNode) => {
    const current = readNode();
    if (current.kind !== "call") throw new Error("The fixture root is not a call");
    setNode({ ...current, args: current.args.map((argument, position) => position === index ? node : argument) });
  },
  evaluate: (data: Record<string, unknown> = {}) => evaluateAuthoringExpression(readNode(), resolver, session, data).result,
  functionId: (name: string) => session.environment.resolveFunctionId(name),
  typeDiagnostics: () => ({ type: readType(), expectedScheme: expectedSchemeForType(readType(), session.environment) }),
  imageDiagnostics: () => {
    const expected = expectedTypeForName("Image", session.environment);
    const entry = session.catalog.functions.find((entry) => entry.codeName === "imagePosterize" || entry.id === "std:imagePosterize");
    return { expected, expectedScheme: expectedSchemeForType(expected, session.environment), entry,
      resolved: session.environment.resolveTypeRef?.(expected!),
    };
  },
  imageMembershipDiagnostics: () => {
    const expected = readType();
    const scheme = expectedSchemeForType(expected, session.environment);
    const sample = { width: 1, height: 1, pixels: [{ r: 0, g: 2, b: 3, a: 255 }] };
    const selected = session.registry.getIdentifiedEntity("Image")?.type;
    if (!selected) return { error: "Image is not registered", expected, scheme };
    const defs = Object.fromEntries(session.environment.catalog.types.flatMap(entry => entry.type
      ? [[entry.entityId ?? entry.name, entry.type], [entry.name, entry.type]] : []));
    const summarize = (result: ReturnType<typeof validateValue>) => ({ valid: result.valid,
      errors: result.errors.slice(0, 4), errorCount: result.errors.length, value: result.value });
    const options = { registry: session.registry, functions: session.evaluateContext, coerce: false,
      strict: { primitiveTypes: true, rejectAdded: false, rejectOmitted: true } };
    return { expected, scheme, selected, color: session.registry.getIdentifiedEntity("Color")?.type,
      identified: summarize(validateValue(selected, sample, null, options)),
      catalogDefs: summarize(validateValue(selected, sample, null, { ...options, $defs: defs })),
      witness: expected ? literalMembershipFor(session.environment, { registry: session.registry, evaluateContext: session.evaluateContext })(sample,
        scheme ?? { quantified: [], body: expected }) : undefined };
  },
};

declare global { var typedAuthoring: typeof fixture; }
globalThis.typedAuthoring = fixture;
