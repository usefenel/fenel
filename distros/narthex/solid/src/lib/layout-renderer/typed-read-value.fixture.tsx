import { createDispatchRegistry, entitySchemaFields } from "@fenel/engine";
import { createSignal, For } from "solid-js";
import { render } from "@solidjs/web";
import type { CatalogSection, FenelFunction, FenelType, TypeView } from "@fenel/engine";
import { Anything, Just, List, Maybe, Nothing, Result, Str } from "@fenel/engine/type-foundation";
import { createAccountFieldRegistry } from "@fenel/engine/account-field-registry";
import { createRegistry } from "@fenel/engine/registry";
import { dispatchRegistry } from "@fenel/engine/system-entities";
import { createAuthoringEnvironment } from "@fenel/engine/authoring/environment";
import { recordFieldsForType } from "@fenel/engine/authoring/expression";
import { createSurfaceEnvironment, surfaceLayoutRenderPlan } from "@fenel/engine/authoring/surface";
import { createDetachedAuthoringEnvironment } from "../expression-runner/detached-authoring-environment";
import { AuthoringSessionContext, type AuthoringSession } from "../expression-runner/authoring-session";
import { ReaderRuntimeContext, type ReaderRuntime } from "../reader-runtime";
import { createReaderTemplateRegistry, webRegistry } from "../web-template-registry";
import type { TemplateComponentProps } from "./LayoutRenderer";
import { TypedReadValue } from "./TypedReadValue";
import type { DataOccurrenceSource } from "../data-occurrence";
import { ReadValue } from "./LayoutRenderer";
import EarlyReadValue from "../early-read-value";
import { sessionEpoch } from "../browser-session";
import { createPublicApiClient } from "../api";
import { ValueCard, ValueCardCaption } from "../value-card";
import { childValueType } from "../data-transfer/child-type";
import { createReaderPresentation, projectReaderTypeDescriptions } from "../reader-presentation";
import { TypeDataPreviewBody } from "../type-data-preview";
import { ValueHoverPreview } from "../value-hover-preview";
import previewStyle from "../home-entry.css?raw";
import functionCardStyle from "../function-card-body.css?raw";
import typedReadStyle from "./typed-read-value.css?raw";
import appStyle from "../../routes/app.css?raw";
import globalStyle from "../../global.css?raw";
// @ts-expect-error The browser harness extracts these actual Home components.
import { HomeFunctionActions, HomeFunctionSignature } from "fixture:home-function-card";
// @ts-expect-error The browser harness extracts the actual early Home type preview.
import { HomeTypePreview } from "fixture:home-type-preview";
import { evaluateAuthoringExpression, type ExprNode } from "../expression-runner";
import { FieldRenderer } from "../field-renderer";
import { DataValueSurface } from "../data-transfer/DataValueSurface";
import { LineChart, type PointLineChartValue } from "../charts";
import { publicDrawingDemoModule, publicRecipeFunctionsModule } from "../../../../../../implementations/typescript/engine/src/modules/public-demos";
import { unitsModule } from "../../../../../../implementations/typescript/engine/src/modules/units";
import { projectReaderValueReadInSession } from "../reader-presentation";
// Registers the shared recipe-card body selected by the source Viewable.
import "../recipe-facts-view";
import { stdModule } from "@fenel/engine/modules/std";
import { pictureModule } from "@fenel/engine/modules/picture";
import { pathModule } from "@fenel/engine/modules/path";
import { viewModule } from "../../../../../../implementations/typescript/engine/src/modules/view";
import { evaluate } from "../../../../../../implementations/typescript/engine/src/json-logic";
import { displayNameText } from "../display-name";
import { ExpressionEditor, ExpressionGraphValueContext } from "../expression-runner/ExpressionEditor";
import { ExpressionGraphCaptureContext } from "../expression-runner/expression-surfaces";

const field = (name: string, type: FenelType) => ({ name, type, label: Nothing, meta: {}, ui: Nothing });
const record: FenelType = { $record: { fields: [field("title", Str)] } };
// RC (Nov 11): a focused record reads as one data card; the same record in a
// plain read keeps its rows. Its picture is the portrait, its name the heading,
// and fields that hold nothing wait behind "Show N more fields".
const portraitImage = { width: 2, height: 2, pixels: Array.from({ length: 4 }, (_, index) => ({ r: 40 * index, g: 90, b: 140, a: 255 })) };
const focusedPersonType: FenelType = { $record: { fields: [field("name", Str), field("picture", Maybe(Anything)), field("role", Str),
  field("biography", Maybe(Str)), field("nickname", Str), field("links", List(Str))] } };
const focusedPersonValue = { name: "Rom", picture: Just(portraitImage), role: "Founder", biography: Nothing, nickname: "", links: [] };
const types = ["Widget", "Card", "NoView", "DeclaredString", "MissingInline", "RawStringView"].map((name) => ({ id: name, name,
  type: name === "DeclaredString" ? Str : record, description: "", category: "fixture" }));
for (const name of ["WorkspacePresentationTarget", "WorkspaceSource", "WorkspaceFocus"]) {
  const entity = viewModule.entities?.find(entity => entity.id === name);
  if (!entity) throw new Error(`The source data-location type ${name} is missing`);
  types.push({ id: name, name, type: entity.type, description: "", category: "fixture" });
}
const locationType: FenelType = { $ref: "WorkspacePresentationTarget" };
const publicLocation = { $tag: "ValuePresentationTarget", source: { $tag: "PublicSource" }, focus: { $tag: "RootFocus" } };
const accountLocation = { $tag: "ValuePresentationTarget", source: { $tag: "AccountSource", accountId: "account-a" }, focus: { $tag: "RootFocus" } };
const environment = createDetachedAuthoringEnvironment(createAuthoringEnvironment({ types, capabilities: [],
  catalogTypes: types.map((row) => row.type), functions: [], operatorCodeNameByNotation: new Map() }));
const titleId = "a1000000-0000-4000-8000-000000000201";
const emailId = "a1000000-0000-4000-8000-000000000202";
const passwordId = "a1000000-0000-4000-8000-000000000203";
let registry: ReturnType<typeof createAccountFieldRegistry> | undefined;
const session: AuthoringSession = { mode: "detached", environment, catalog: environment.catalog,
  get registry() {
    return registry ??= createAccountFieldRegistry([], "preview-account", {
      owners: [{ ownerKey: "type:Card", kind: "type", storageName: "Card", definition: {
        id: "Card", type: { $record: { fields: [{ ...field("title", { $ref: "String" }),
          key: { $tag: "NamedField", ref: { $ref: titleId } } }] } },
      } }, { ownerKey: "type:EmailAlias", kind: "type", storageName: "EmailAlias", definition: {
        id: "EmailAlias", type: { $refined: { base: { $ref: "String" }, set: { $tag: "SeRef", handle: "format:email" } } },
      } }, { ownerKey: "type:SignInFields", kind: "type", storageName: "SignInFields", definition: {
        id: "SignInFields", type: { $record: { fields: [
          { ...field("email", { $ref: "EmailAlias" }), key: { $tag: "NamedField", ref: { $ref: emailId } } },
          { ...field("password", { $ref: "String" }), key: { $tag: "NamedField", ref: { $ref: passwordId } } },
        ] } },
      } }],
      fields: [
        { id: titleId, currentCodeName: "title", status: "live", realm: "account", reuseVisibility: "account" },
        { id: emailId, currentCodeName: "email", status: "live", realm: "account", reuseVisibility: "account" },
        { id: passwordId, currentCodeName: "password", status: "live", realm: "account", reuseVisibility: "account" },
      ],
      facets: [
        { fieldId: titleId, typeName: "Codeable", methods: { codeName: "title" }, scope: "account", priority: 100 },
        { fieldId: titleId, typeName: "Labelable", methods: { label: "Title" }, scope: "account", priority: 100 },
        { fieldId: emailId, typeName: "Codeable", methods: { codeName: "email" }, scope: "account", priority: 100 },
        { fieldId: emailId, typeName: "Labelable", methods: { label: "Email" }, scope: "account", priority: 100 },
        { fieldId: emailId, typeName: "Displayable", methods: { hint: { widget: Just("native") } }, scope: "account", priority: 100 },
        { fieldId: passwordId, typeName: "Codeable", methods: { codeName: "password" }, scope: "account", priority: 100 },
        { fieldId: passwordId, typeName: "Labelable", methods: { label: "Password" }, scope: "account", priority: 100 },
        { fieldId: passwordId, typeName: "Displayable", methods: { hint: { widget: Just("password") } }, scope: "account", priority: 100 },
      ],
    });
  }, evaluateContext: { _caseOwner: { WidgetValue: "Widget" } } };
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("A preview attempted HTTP IO"); }) as unknown as typeof fetch;

for (const name of ["a", "b", "updated", "full"]) {
  webRegistry.registerComponent(`preview-${name}`, (props: TemplateComponentProps) =>
    <strong data-template={name} data-type={"$ref" in props.type ? props.type.$ref : "structural"}
      data-mode={props.mode} data-compact={String(props.context._compact)}>
      {name}:{(props.value as { title?: string }).title ?? String(props.value)}
    </strong>);
}
function views(component: string): TypeView[] {
  return [
    { name: "base", readComponent: `preview-${component}`, display: Nothing },
    { name: "shared-inline", extends: "base", display: Nothing },
    { name: "full", readComponent: "preview-full", display: Nothing },
    { name: "card", display: Nothing, layout: { sections: [{ rows: [{ slots: [{ field: "title" }] }] }] } },
  ];
}
const [leftTemplates, setLeftTemplates] = createSignal(createReaderTemplateRegistry(views("a")));
const rightTemplates = createReaderTemplateRegistry(views("b"));
const [leftView, setLeftView] = createSignal(true);
const [value, setValue] = createSignal({ title: "First" });
const [optionalTemplateValue, setOptionalTemplateValue] = createSignal(Just({ title: "Optional custom presentation" }));
const [emailInput, setEmailInput] = createSignal<unknown>("");
const [passwordInput, setPasswordInput] = createSignal<unknown>("");
const [locationIcon, setLocationIcon] = createSignal<string | undefined>("users");
const [locationCustom, setLocationCustom] = createSignal(false);
const [locationParentPath, setLocationParentPath] = createSignal<readonly (string | number)[]>([]);
const locationOpens: unknown[] = [];
const detailedCallable: FenelType = { $arrow: { params: [], returns: Str } };
const detailedRecord: FenelType = { $record: { fields: [field("title", Str),
  field("formatter", detailedCallable), field("Echo", detailedCallable)] } };
const [detailedValue, setDetailedValue] = createSignal({ title: "Fenel",
  formatter: { $ref: "named-detail" }, Echo: { $ref: "same-word-detail" } });
const detailedOpens: { caption?: string; label: string; path: readonly (string | number)[]; value: unknown }[] = [];
// Each captured read gets the real endpoint client's complete lifetime
// contract. HTTP remains guarded by the fixture's throwing fetch above.
// Registry rows never change; value/template updates use reactive props.
const capturedReaderLifetime = () => ({ epoch: sessionEpoch(), client: createPublicApiClient(), revision: () => 0 });
function reader(left: boolean): ReaderRuntime {
  // UI fixture: inject only the already-authorized reader presentation data.
  // This is not an authority token and cannot perform any operation.
  return {
    ...capturedReaderLifetime(),
    session: () => session, registry: () => session.registry,
    templates: left ? leftTemplates : () => rightTemplates,
    presentation: id => id === "named-detail" ? { label: "Human value name", codeName: "namedDetail" }
      : id === "same-word-detail" ? { label: "Echo", codeName: "sameWordDetail" } : undefined,
    representation(typeName: string, id: string) {
      if (typeName === "Iconable" && id === "WorkspacePresentationTarget") return { icon: left ? "map-pin" : "user" };
      if (typeName === "Iconable" && ["Widget", "NoView"].includes(id)) return { icon: left ? "user" : "bot" };
      if (typeName !== "Viewable") return undefined;
      if (id === "WorkspacePresentationTarget") return {
        defaultView: left && locationCustom() ? "full" : "data-thumbnail",
        defaultInlineView: left && locationCustom() ? "full" : "data-thumbnail",
      };
      if (id === "RawStringView") return { defaultView: "full", defaultInlineView: "shared-inline" };
      if (id === "Card") return { defaultView: Just("card"), defaultInlineView: Nothing };
      if (id === "MissingInline") return { defaultView: Just("full"), defaultInlineView: Just("not-installed") };
      if (!["Widget", "DeclaredString"].includes(id) || (left && !leftView())) return undefined;
      return { defaultView: Just("full"), defaultInlineView: Just("shared-inline") };
    },
  } as ReaderRuntime;
}
const left = reader(true);
const right = reader(false);
const earlyReader = { ...left, ...capturedReaderLifetime() } as ReaderRuntime;
const chartRegistry = createRegistry([stdModule, pictureModule, pathModule, publicDrawingDemoModule]);
const chartContext = chartRegistry.evaluateContext();
const chartSession: AuthoringSession = { ...session, registry: chartRegistry, evaluateContext: chartContext };
const chartPresentation = createReaderPresentation(() => ({ registry: chartRegistry, session: chartSession, catalog: [] }));
const chartTemplates = createReaderTemplateRegistry([]);
const chartReader = { ...capturedReaderLifetime(), session: () => chartSession, registry: () => chartRegistry, templates: () => chartTemplates,
  presentation: chartPresentation.presentation, representation: chartPresentation.representation } as ReaderRuntime;
// Recipes demo L3 (T8): a RecipeCard value selects the shared card body
// through the actual source Viewable, on the account read and on the Local
// packet read (the worker's prepared view).
const recipeRegistry = createRegistry([stdModule, unitsModule, publicRecipeFunctionsModule]);
const recipeSession: AuthoringSession = { ...session, registry: recipeRegistry, evaluateContext: recipeRegistry.evaluateContext() };
const recipePresentation = createReaderPresentation(() => ({ registry: recipeRegistry, session: recipeSession, catalog: [] }));
const recipeReader = { ...capturedReaderLifetime(), session: () => recipeSession, registry: () => recipeRegistry, templates: () => chartTemplates,
  presentation: recipePresentation.presentation, representation: recipePresentation.representation } as ReaderRuntime;
const recipeCardType: FenelType = { $ref: "RecipeCard" };
const recipeCardValue = [
  { $tag: "RecipeFact", title: "Full pantry", summary: { $tag: "Preparations", items: [[{ $tag: "Butter" }, { $tag: "Honey" }]] },
    evidence: { $tag: "DirectEvaluation" } },
  { $tag: "RecipeFact", title: "Ingredient count", summary: { $tag: "IngredientCount", minimum: 4, maximum: 4 },
    evidence: { $tag: "StatusEvidence", status: { $tag: "SolverChecked" } } },
];
const recipeCardPacket = projectReaderValueReadInSession({ value: recipeCardValue, type: recipeCardType, typeLookup: "session",
  views: chartTemplates.list(), componentNames: chartTemplates.listComponentNames!() },
  recipeSession, { catalog: [], types: [], functionRows: [] }, []);
// C1: retain the actual source instance while keeping this read-only fixture
// independent of the complete view authoring/query catalogue.
const returnedRegistry = createRegistry([stdModule, { name: viewModule.name, label: "Returned expression fixture", functions: [],
  instances: viewModule.instances?.filter(instance => instance.typeName === "Viewable" && instance.methods.defaultView === "returned-expression") }]);
const returnedSession: AuthoringSession = { ...chartSession, registry: returnedRegistry, evaluateContext: returnedRegistry.evaluateContext() };
const returnedPresentation = createReaderPresentation(() => ({ registry: returnedRegistry, session: returnedSession, catalog: [] }));
const returnedReader = { ...capturedReaderLifetime(), session: () => returnedSession, registry: () => returnedRegistry, templates: () => chartTemplates,
  presentation: returnedPresentation.presentation, representation: returnedPresentation.representation } as ReaderRuntime;
const returnedExprHandle = returnedRegistry.getTypeUuid("system", "Expr") ?? "Expr";
const returnedExprDeclaration = returnedRegistry.getIdentifiedEntity(returnedExprHandle);
if (returnedExprDeclaration?.module !== "system" || returnedExprDeclaration.id !== "Expr") {
  throw new Error("The returned expression fixture has no canonical system Expr owner.");
}
const returnedExprType: FenelType = { $ref: returnedExprHandle };
const returnedFunction = returnedRegistry.getFunction("std.reverse")!.id;
const [returnedExpression, setReturnedExpression] = createSignal<unknown>({ $tag: "ELambda", params: ["text"],
  body: { $tag: "ECall", fnId: returnedFunction, args: [{ $tag: "EVar", name: "text" }] } });
let returnedCaptureRequests = 0, returnedGraphReads = 0;
// Checked witnesses use the same captured public profile, which omits engine.
const arrowRegistry = chartRegistry;
const arrowSession: AuthoringSession = { ...session, registry: arrowRegistry, evaluateContext: arrowRegistry.evaluateContext() };
const arrowPresentation = createReaderPresentation(() => ({ registry: arrowRegistry, session: arrowSession, catalog: [] }));
const arrowReader = { ...capturedReaderLifetime(), session: () => arrowSession, registry: () => arrowRegistry, templates: () => chartTemplates,
  presentation: arrowPresentation.presentation, representation: arrowPresentation.representation } as ReaderRuntime;
const functionReadType: FenelType = { $arrow: { params: [{ ...field("pantry", Str), label: Just("Pantry") }], returns: Str } };
const functionReadBody: ExprNode = { kind: "call", fnId: "Http:send", args: [{ kind: "param", name: "pantry" }] };
const functionReadNode: ExprNode = { kind: "literal", value: { __lambda: { params: ["pantry"], body: functionReadBody } } };
const [functionSourceCurrent, setFunctionSourceCurrent] = createSignal(true);
const functionReadSource = { node: functionReadNode, current: functionSourceCurrent };
let functionReadExecutions = 0;
const functionReadTripwire = () => { functionReadExecutions++; throw new Error("A function read tried to execute its effectful body"); };
const earlySignature: FenelType = { $arrow: { params: [field("text", Str)], returns: Result(Str, Str) } };
const earlySignatureDescriptions = projectReaderTypeDescriptions({ type: earlySignature }, { evaluateContext: chartContext });
const dependentPreviewType: FenelType = { $el: { var: "selectedType" } };
const previewTypes = [
  { id: "location", label: "Data location", type: locationType },
  { id: "record", label: "Record schema", type: record },
  { id: "single", label: "Point", type: { $variant: { cases: [{ name: "Point", fields: [field("x", Str), field("y", Str)] }] } } as FenelType },
  { id: "direct", label: "Dependent type", type: dependentPreviewType },
  { id: "nested", label: "Dependent record", type: { $record: { fields: [field("chosen", dependentPreviewType)] } } as FenelType },
  { id: "generic", label: "List String", type: { $el: { call: ["List", Str] } } as FenelType },
  { id: "legacy", label: "Older type projection", type: { $ref: "PreviewLegacy" } as FenelType },
].map(entry => ({ ...entry, descriptions: entry.id === "legacy"
  ? [{ type: entry.type, phrase: "A named type", code: "PreviewLegacy", kind: "named" as const, kindLabel: "Named" }]
  : projectReaderTypeDescriptions({ type: entry.type }, { evaluateContext: session.evaluateContext }, undefined, undefined,
    handle => session.registry.getIdentifiedEntity(handle)?.type ?? session.environment.resolveTypeRef?.({ $ref: handle })) }));
const arrowType: FenelType = { $arrow: { params: [], returns: Str } };
const chartCall = (name: string, ...args: unknown[]) => evaluate({ call: [`DrawingDemo:${name}`, ...args] }, {}, chartContext) as PointLineChartValue;
const chartValues = {
  square: chartCall("formulaChart", { $ref: "DrawingDemo:squareFormula" }),
  negative: chartCall("pointLineChart", [{ x: -2, y: -4 }, { x: -1, y: 0 }, { x: 4, y: 8 }]),
  refused: chartCall("pointLineChart", [{ x: Infinity, y: 0 }]),
  refusedEmpty: { $tag: "PointLineChartRefused", reason: "" } as PointLineChartValue,
  empty: chartCall("pointLineChart", []),
  zero: chartCall("pointLineChart", [{ x: 0, y: 0 }]),
};
const [chartValue, setChartValue] = createSignal(chartValues.square);
const [lineValue, setLineValue] = createSignal<PointLineChartValue | undefined>(undefined);
const [thumbnailIcon, setThumbnailIcon] = createSignal<string | undefined>("bot");
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=";
const broadList = [{ $tag: "WidgetValue", title: "From Anything" }];
let previewMounts = 0;
let previewOpens = 0;
const dataContextEvents: Array<{ value: unknown; path: readonly (string | number)[]; type?: FenelType }> = [];
const contextData = (event: MouseEvent, data: import("../data-transfer/DataValueSurface").ContainedValuePreview) => {
  event.preventDefault(); event.stopPropagation();
  dataContextEvents.push({ value: data.value, path: data.path, type: data.getType() });
};
const contextRecordValue = { title: "Selected child" }, contextListValue = ["First child", "Second child"];
const contextListType = List(Str);
const contextOccurrence = (value: unknown, type: FenelType): DataOccurrenceSource => ({ state: "source", capture: () => ({
  session, input: { expression: { kind: "literal", value }, type, sourceType: type, revision: "context-fixture:1" },
  current: () => true, select: () => { throw new Error("A context event must not execute a proposal"); },
}) });
const contextRecordSource = contextOccurrence(contextRecordValue, record), contextListSource = contextOccurrence(contextListValue, contextListType);
const host = document.getElementById("fixture")!;
render(() => <AuthoringSessionContext value={session}>
  <style>{globalStyle + appStyle + previewStyle + typedReadStyle + functionCardStyle}</style>
  <ReaderRuntimeContext value={left}>
    <div data-case="location-public"><ValueCard heading={<ValueCardCaption caption="Fenel" typeLabel="Data location" />} onOpen={() => locationOpens.push(publicLocation)}>
      <EarlyReadValue runtime={earlyReader} node={{ kind: "literal", value: publicLocation }} saved={new Map()}
        type={locationType} value={{ value: publicLocation }} valueIcon="globe" />
    </ValueCard></div>
    <div data-case="location-account"><ValueCard heading={<ValueCardCaption caption="Account A" typeLabel="Data location" />} onOpen={() => locationOpens.push(accountLocation)}>
      <EarlyReadValue runtime={earlyReader} node={{ kind: "literal", value: accountLocation }} saved={new Map()}
        type={locationType} value={{ value: accountLocation }} valueIcon={locationIcon()} />
    </ValueCard></div>
    <div data-case="location-type-fallback"><TypedReadValue type={locationType} value={publicLocation} /></div>
    <div data-case="location-malformed-metadata"><ReadValue value={publicLocation} registry={leftTemplates()}
      template={leftTemplates().resolve("data-thumbnail")!} field={field("value", locationType)}
      context={{ _valueIcon: { toString: () => "users" }, _typeIcon: "map-pin" }} /></div>
    <div data-case="location-detail"><TypedReadValue detail type={locationType} value={publicLocation} valueIcon="globe" /></div>
    <div data-case="location-child-scope" data-parent-path={JSON.stringify(locationParentPath())}><TypedReadValue detail type={{ $record: { fields: [field("location", locationType)] } }}
      value={{ location: publicLocation }} valueIcon="users" dataPath={locationParentPath()} /></div>
    <div data-pane="a"><TypedReadValue compact type={{ $ref: "Widget" }} value={value()} /></div>
    <div data-case="layout"><TypedReadValue compact type={{ $ref: "Card" }} value={{ title: "Layout title" }} /></div>
    <div data-case="structural"><TypedReadValue compact type={record} value={{ title: "Unnamed value" }} /></div>
    <div data-case="context-record"><TypedReadValue detail type={record} value={contextRecordValue}
      dataPath={["outer"]} occurrence={contextRecordSource} onDataContext={contextData} /></div>
    <div data-case="context-list"><TypedReadValue type={contextListType} value={contextListValue}
      dataPath={["rows"]} occurrence={contextListSource} onDataContext={contextData} /></div>
    <div data-case="detail-field-provenance"><TypedReadValue detail value={detailedValue()} type={detailedRecord}
      onOpenData={data => detailedOpens.push({ caption: displayNameText(data.caption), label: data.label, path: data.path, value: data.value })} /></div>
    <div data-case="icon"><TypedReadValue compact type={{ $ref: "NoView" }} value={{ title: "Fallback" }} /></div>
    <div data-case="declared-string"><TypedReadValue compact type={{ $ref: "DeclaredString" }} value="Typed scalar" /></div>
    <div data-case="raw-string-view"><TypedReadValue compact type={{ $ref: "RawStringView" }} value={{ title: "Declared String methods" }} /></div>
    <div data-case="missing-inline"><TypedReadValue compact type={{ $ref: "MissingInline" }} value={{ title: "Recovered" }} /></div>
    <div data-case="broad-list"><TypedReadValue compact value={broadList[0]}
      type={childValueType(broadList, List(Anything), 0, session)} /></div>
    <div data-case="image"><TypedReadValue compact type={Str} value={image} /></div>
    <div data-case="thumbnail-value"><TypedReadValue thumbnail type={{ $ref: "Widget" }} value={value()} valueIcon={thumbnailIcon()} /></div>
    <div data-case="thumbnail-type"><TypedReadValue thumbnail type={{ $ref: "Widget" }} value={value()} /></div>
    <div data-case="thumbnail-generic"><TypedReadValue thumbnail value="Letters stay in the full card" /></div>
    <div data-case="thumbnail-image"><TypedReadValue thumbnail type={{ $ref: "Widget" }} value={image} valueIcon="bot" /></div>
    <div data-case="thumbnail-file"><TypedReadValue thumbnail value={{ url: image, name: "Picture.png", mimeType: "image/png", size: 68 }} valueIcon="bot" /></div>
    <div data-case="thumbnail-audio"><TypedReadValue thumbnail value={{ url: "data:audio/wav;base64,AQ==", name: "Sound.wav", mimeType: "audio/wav", size: 1 }} /></div>
    <div data-case="thumbnail-matrix"><TypedReadValue thumbnail value={{ width: 1, height: 1, pixels: [{ r: 12, g: 34, b: 56, a: 255 }] }} valueIcon="bot" /></div>
    <div data-case="thumbnail-empty-image"><TypedReadValue thumbnail value={{ width: 0, height: 0, pixels: [] }} valueIcon="bot" /></div>
    <div data-case="callable"><TypedReadValue compact type={{ $arrow: { params: [], returns: Str } }} value={{ $ref: "never:invoke" }} /></div>
    <div data-case="empty-list"><TypedReadValue type={List(Str)} value={[]} /></div>
    <div data-case="early-list"><EarlyReadValue runtime={earlyReader} node={{ kind: "call", fnId: "never:invoke", args: [] }}
      saved={new Map()} type={List(record)} value={{ value: [{ title: "Held project" }] }} /></div>
    <div data-case="early-function"><EarlyReadValue runtime={earlyReader} node={{ kind: "call", fnId: "never:invoke", args: [] }}
      saved={new Map()} type={{ $arrow: { params: [field("text", Str)], returns: Str } }} value={{ value: { $ref: "never:invoke" } }} /></div>
    <div data-case="optional-name"><TypedReadValue type={Maybe(Str)} value={Just("Rom")} /></div>
    <div data-case="focused-record"><ValueCard presentation="body" heading={null}>
      <TypedReadValue type={focusedPersonType} value={focusedPersonValue} /></ValueCard></div>
    <div data-case="plain-record"><TypedReadValue type={focusedPersonType} value={focusedPersonValue} /></div>
    <div data-case="optional-empty"><TypedReadValue type={Maybe(Str)} value={Nothing} /></div>
    <div data-case="optional-custom"><TypedReadValue compact type={Maybe({ $ref: "Widget" })} value={Just({ title: "Optional widget" })} /></div>
    <div data-case="typed-sign-in"><FieldRenderer registry={session.registry}
      field={entitySchemaFields(session.registry.getIdentifiedEntity("SignInFields")!)[0]!}
      value={emailInput()} onChange={setEmailInput} autocomplete="email" />
      <FieldRenderer registry={session.registry}
        field={entitySchemaFields(session.registry.getIdentifiedEntity("SignInFields")!)[1]!}
        value={passwordInput()} onChange={setPasswordInput} autocomplete="current-password" /></div>
    <div data-case="hover" style="width: 180px; margin: 24px">
      <ValueHoverPreview label="Nested value" onOpen={() => { previewOpens++; }} preview={() => {
        previewMounts++;
        return <TypedReadValue compact type={{ $ref: "Widget" }} value={value()} />;
      }}><span>Nested value</span></ValueHoverPreview>
    </div>
  </ReaderRuntimeContext>
  <ReaderRuntimeContext value={chartReader}>
    <div data-case="point-chart" style="width: 100%; max-width: 480px"><TypedReadValue type={{ $ref: "PointLineChart" }} value={chartValue()} fieldRegistry={chartRegistry} /></div>
    <div data-case="point-chart-surface" style="width: 100%; max-width: 480px">
      <DataValueSurface value={chartValue()} type={{ $ref: "PointLineChart" }} label="Returns" session={() => chartSession}
        presentation={<TypedReadValue templateOnly type={{ $ref: "PointLineChart" }} value={chartValue()} fieldRegistry={chartRegistry} />} />
    </div>
  </ReaderRuntimeContext>
  <ReaderRuntimeContext value={recipeReader}>
    <div data-case="recipe-card" style="width: 100%; max-width: 480px"><TypedReadValue type={recipeCardType} value={recipeCardValue} fieldRegistry={recipeRegistry} /></div>
    <div data-case="recipe-card-packet" style="width: 100%; max-width: 480px"><TypedReadValue type={recipeCardType} value={recipeCardValue}
      {...({ readFacts: recipeCardPacket } as {}) /* the account reader forwards an already-read packet to the body (TypedReadValue.tsx fallback) */} /></div>
  </ReaderRuntimeContext>
  <ReaderRuntimeContext value={arrowReader}>
    <ExpressionGraphCaptureContext value={{ request: functionReadTripwire, activate: functionReadTripwire,
      available: () => true, pending: () => false }}>
      <ExpressionGraphValueContext value={functionReadTripwire}>
        <div data-case="function-read"><TypedReadValue value={{ $ref: "uninvoked-function" }} type={functionReadType}
          functionSource={functionReadSource} /></div>
        <div data-case="function-read-no-source"><TypedReadValue value={{ $ref: "uninvoked-function" }} type={functionReadType}
          functionSource={{ current: () => true }} /></div>
        <div data-case="function-read-reference"><TypedReadValue value={{ $ref: returnedFunction }} type={functionReadType}
          functionSource={{ node: { kind: "literal", value: { $ref: returnedFunction } }, current: () => true }} /></div>
        <div data-case="function-read-computed"><TypedReadValue value={{ $ref: "uninvoked-function" }} type={functionReadType}
          functionSource={{ node: { kind: "call", fnId: "Http:send", args: [] }, current: () => true }} /></div>
        <div data-case="function-read-compact"><TypedReadValue compact value={{ $ref: "uninvoked-function" }} type={functionReadType}
          functionSource={functionReadSource} /></div>
      </ExpressionGraphValueContext>
    </ExpressionGraphCaptureContext>
    <section data-function-signatures style="display:grid;gap:16px;width:420px;padding:24px;font-family:Arial,sans-serif;">
      <For each={[
        { label: "Trim text", params: [field("text", Str)], returns: Result(Str, Str) },
        { label: "Split text", params: [field("source", { $ref: "ImportTextInput" }), field("delimiter", Str)], returns: Result(Str, List(Str)) },
        { label: "String identity", params: [field("text", Str)], returns: Str },
      ]}>{fn => <ValueCard heading={<ValueCardCaption caption={fn.label} typeLabel="Function" typeIcon="function" />}
        actions={<HomeFunctionActions onCallFunction={() => { throw new Error("Signature must not invoke a function"); }}
          surface={{ pinInfo: () => ({ $pin: "function", id: "uninvoked-callable" }), ioCallInfo: () => undefined,
            runState: () => ({ kind: "idle" }), canStop: () => false }} />}>
        <HomeFunctionSignature reader={arrowReader} arrow={{ params: fn.params, returns: fn.returns }} />
      </ValueCard>}</For>
    </section>
    <div data-early-function-signature style="width:420px;padding:24px;">
      <ValueCard heading={<ValueCardCaption caption="Early Trim text" typeLabel="Function" typeIcon="function" />}>
        <TypeDataPreviewBody type={earlySignature} describeType={type => ({ type,
          label: earlySignatureDescriptions.find(entry => JSON.stringify(entry.type) === JSON.stringify(type))?.code ?? "Missing type description" })} />
      </ValueCard>
    </div>
    <div data-case="thumbnail-admitted-arrow"><TypedReadValue thumbnail type={arrowType} value={{ $ref: "uninvoked-callable" }} /></div>
    <div data-case="thumbnail-arrow-override"><TypedReadValue thumbnail type={arrowType} value={{ $ref: "uninvoked-callable" }} valueIcon="user" /></div>
    <div data-case="thumbnail-arrow-unrelated"><TypedReadValue thumbnail type={record} value={{ title: "Unrelated" }} /></div>
  </ReaderRuntimeContext>
  <ReaderRuntimeContext value={left}>
    <div data-case="template-only-generic"><TypedReadValue templateOnly type={record} value={{ title: "Retained by surrounding surface" }} /></div>
    <div data-case="template-only-missing"><TypedReadValue templateOnly type={{ $ref: "NoView" }} value={{ title: "No custom presentation" }} /></div>
    <div data-case="template-only-known"><TypedReadValue templateOnly type={{ $ref: "RawStringView" }} value={{ title: "Custom presentation only" }} /></div>
    <div data-case="template-only-optional"><TypedReadValue templateOnly type={Maybe({ $ref: "RawStringView" })} value={optionalTemplateValue()} /></div>
    <div data-case="template-only-optional-missing"><TypedReadValue templateOnly type={Maybe({ $ref: "NoView" })} value={Just({ title: "No inner custom presentation" })} /></div>
    <div data-case="template-only-optional-empty"><TypedReadValue templateOnly type={Maybe({ $ref: "RawStringView" })} value={Nothing} /></div>
  </ReaderRuntimeContext>
  <div data-case="line-transition" style="width: 100%; max-width: 480px"><LineChart data={[{ label: "A", value: 2 }, { label: "B", value: 5 }]} value={lineValue()} /></div>
  <ReaderRuntimeContext value={right}>
    <div data-case="location-other-reader"><TypedReadValue type={locationType} value={publicLocation} /></div>
    <div data-case="thumbnail-other-reader"><TypedReadValue thumbnail type={{ $ref: "Widget" }} value={value()} /></div>
    <div data-pane="b"><TypedReadValue compact type={{ $ref: "Widget" }} value={value()} /></div>
  </ReaderRuntimeContext>
  <ReaderRuntimeContext value={returnedReader}>
    <div data-case="held-let"><ExpressionEditor graphAuthoring={false}
      expr={{ kind: "literal", value: { __let: { bindings: [{ name: "answer", expr: { kind: "literal", value: "HELD LOCAL BODY" } }] } } }}
      inspection={{ callable: () => undefined, typeLabel: () => undefined }} onChange={() => { throw new Error("Held let inspection edited data"); }} />
    </div>
    <ExpressionGraphCaptureContext value={{ request: () => { returnedCaptureRequests++; }, activate: () => { returnedCaptureRequests++; },
      available: () => true, pending: () => false }}>
      <ExpressionGraphValueContext value={() => { returnedGraphReads++; return { value: "INHERITED PRODUCER RESULT" }; }}>
        <section data-case="returned-expression" style="padding:24px;max-width:720px;">
          <TypedReadValue type={returnedExprType} value={returnedExpression()} />
        </section>
      </ExpressionGraphValueContext>
    </ExpressionGraphCaptureContext>
  </ReaderRuntimeContext>
  <div data-case="without-reader"><TypedReadValue type={Maybe(Str)} value={Just("Outside a lens")} fieldRegistry={session.registry} /></div>
  <section data-type-previews style="display:grid;grid-template-columns:repeat(2,320px);gap:16px;padding:24px;font-family:Arial,sans-serif;">
    <div data-case="type-single"><ValueCard heading={<ValueCardCaption caption="Point" typeLabel="Type" typeIcon="shapes" />}>
      <TypedReadValue type={{ $type: true }} value={{ $variant: { cases: [{ name: "Point", label: Nothing,
        fields: [field("x", { $ref: "Number" }), field("y", { $ref: "Number" })] }] } }} fieldRegistry={session.registry} />
    </ValueCard></div>
    <div data-case="type-variants"><ValueCard heading={<ValueCardCaption caption="Chart outcome" typeLabel="Type" typeIcon="shapes" />}>
      <TypedReadValue type={{ $type: true }} value={{ $variant: { cases: [
        { name: "Ready", label: Nothing, fields: [field("title", Str)] },
        { name: "Refused", label: Nothing, fields: [field("reason", Str)] },
      ] } }} fieldRegistry={session.registry} />
    </ValueCard></div>
    <div data-case="type-compact"><ValueCard heading={<ValueCardCaption caption="Record schema" typeLabel="Type" typeIcon="shapes" />}>
      <TypedReadValue compact type={{ $type: true }} value={record} fieldRegistry={session.registry} />
    </ValueCard></div>
    <div data-case="type-function"><ValueCard presentation="inline" heading={<ValueCardCaption caption="Add" typeLabel="Function" typeIcon="function" />}>
      <TypedReadValue type={{ $type: true }} value={{ $arrow: { params: [field("left", { $ref: "Number" }), field("right", { $ref: "Number" })],
        returns: { $ref: "Number" } } }} fieldRegistry={session.registry} />
    </ValueCard></div>
  </section>
  <section data-type-preview-review style="display:flex;gap:16px;padding:24px;font-family:Arial,sans-serif;">
    <For each={previewTypes}>{entry => <ValueHoverPreview class="home-item__type-tag" label={entry.label}
      preview={() => <HomeTypePreview type={entry.type} label={entry.label} descriptions={entry.descriptions} />}>
      <span data-type-hover-case={entry.id}>{entry.label}</span>
    </ValueHoverPreview>}</For>
  </section>
</AuthoringSessionContext>, host);

export const typedReadFixture = {
  functionSourceCurrent: setFunctionSourceCurrent,
  functionReadExecutions: () => functionReadExecutions,
  returnedExpression: setReturnedExpression,
  returnedExpressionState: () => ({ captureRequests: returnedCaptureRequests, graphReads: returnedGraphReads,
    methods: returnedPresentation.representation("Viewable", returnedExprHandle) }),
  dataContexts: () => ({ events: dataContextEvents, stringType: Str }),
  locationIcon: setLocationIcon,
  locationCustom: setLocationCustom,
  relocateLocationParent() { setLocationParentPath(["relocated-root"]); },
  locationOpens: () => locationOpens,
  updateDetailedTitle() { setDetailedValue({ ...detailedValue(), title: "Updated title" }); },
  detailedOpens: () => detailedOpens,
  thumbnailIcon: setThumbnailIcon,
  optionalTemplate(present: boolean) { setOptionalTemplateValue(present ? Just({ title: "Optional custom presentation" }) : Nothing); },
  chart(kind: keyof typeof chartValues) { setChartValue(chartValues[kind]); },
  linePlan(enabled: boolean) { setLineValue(enabled ? chartValues.negative : undefined); },
  chartSnapshot: () => chartValue(),
  recipeCardView: () => ({ packet: recipeCardPacket.root.view?.name, methods: recipePresentation.representation("Viewable", "RecipeCard") }),
  chartRegistration() { return {
    methods: chartPresentation.representation("Viewable", "PointLineChart"),
    component: chartTemplates.getComponent(chartTemplates.resolve("point-line-chart")!.readComponent!) === LineChart,
  }; },
  updateLeft() { setLeftTemplates(createReaderTemplateRegistry(views("updated"))); },
  removeLeftView() { setLeftView(false); },
  replaceValue() { setValue({ title: "Second" }); },
  state: () => ({ fetches }),
  previewState: () => ({ previewMounts, previewOpens }),
  evaluationModes() {
    const literal = (value: unknown): ExprNode => ({ kind: "literal", value });
    const image = { width: 1, height: 1, pixels: [{ r: 12, g: 34, b: 56, a: 255 }] };
    const calls: string[] = [];
    const evaluationSession: AuthoringSession = { ...session, evaluateContext: {
      ...session.evaluateContext,
      natives: { "fixture:double": (value: unknown) => Number(value) * 2, "fixture:image": () => image },
      onStep: (step) => { calls.push(`${step.op}:${step.fnName}`); },
    } };
    const expressions: ExprNode[] = [
      { kind: "call", fnId: "fixture:double", args: [{ kind: "ref", savedExprId: "saved-number" }] },
      literal({ __apply: { target: literal({ __lambda: { params: ["number"],
        body: { kind: "call", fnId: "fixture:double", args: [{ kind: "param", name: "number" }] } } }), args: [literal(4)] } }),
      { kind: "call", fnId: "fixture:image", args: [] },
    ];
    return expressions.map((node) => {
      const resolver = (id: string) => id === "saved-number" ? literal(3) : undefined;
      calls.length = 0;
      const traced = evaluateAuthoringExpression(node, resolver, evaluationSession);
      const tracedCalls = [...calls];
      calls.length = 0;
      const quiet = evaluateAuthoringExpression(node, resolver, evaluationSession, {}, { trace: false });
      return { traced: traced.result, quiet: quiet.result, traceLength: traced.trace.length,
        quietTraceLength: quiet.trace.length, tracedCalls, quietCalls: [...calls] };
    });
  },
  aliases() {
    const functionId = "alias-fixture:read";
    const functionUuid = "a1000000-0000-4000-8000-000000000301";
    const entityUuid = "a1000000-0000-4000-8000-000000000302";
    const fn: FenelFunction = { id: functionId, params: [], returns: { $ref: "String" }, body: "Example" };
    const instances = createDispatchRegistry();
    for (const name of ["Labelable", "Iconable"]) instances.defineClass(dispatchRegistry.getClass(name)!);
    instances.addInstance({ typeName: "Labelable", args: [functionId], methods: { label: "Lower priority" }, scope: "global", priority: 1 });
    instances.addInstance({ typeName: "Labelable", args: [functionId], methods: { label: "Priority winner" }, scope: "global", priority: 30 });
    instances.addInstance({ typeName: "Iconable", args: [functionId], methods: { icon: "star" }, scope: "global" });
    const registry = createRegistry([{ name: "alias-fixture", label: "Alias fixture", functions: [fn],
      entities: [{ id: "AliasType", type: { $ref: "String" } }] }], {
      // A type row is keyed by its declaring owner (type/module/<owner>/<Name>).
      codeNameLock: new Map([[functionId, functionUuid], ["type/module/alias-fixture/AliasType", entityUuid]]),
      dispatchRegistry: instances,
    });
    const catalog: CatalogSection[] = [
      { id: "function", label: "Functions", description: "", entries: [{ id: functionId, name: "Readable function", description: "", category: "function", fn }] },
      { id: "entity", label: "Types", description: "", entries: [{ id: "entity:AliasType", name: "Alias type", description: "", category: "entity", entity: { id: "AliasType", type: { $ref: "String" } } }] },
    ];
    const source = { registry, session: { evaluateContext: registry.evaluateContext() }, catalog };
    const publicView = createReaderPresentation(() => source);
    const accountView = createReaderPresentation(() => ({ ...source, functionRows: [{ name: functionId, function: fn, label: "Account function" }] }));
    const projected = createReaderPresentation(() => ({ ...source, metadata: new Map([
      [functionId, new Map([["Labelable", { label: "Projected label" }]])],
    ]) }));
    const exactMiss = createReaderPresentation(() => ({ ...source, metadata: new Map([
      [functionUuid, new Map()], [functionId, new Map([["Labelable", { label: "Other spelling" }]])],
    ]) }));
    return {
      functionResolves: registry.getFunction(functionUuid)?.id,
      entityResolves: registry.getEntity(entityUuid)?.id,
      entityOwnerUuid: registry.getTypeUuid("alias-fixture", "AliasType"),
      catalogId: publicView.catalogEntry(functionUuid)?.id,
      publicLabel: publicView.presentation(functionUuid)?.label,
      accountLabel: accountView.presentation(functionUuid)?.label,
      globalPriority: publicView.representation("Labelable", functionUuid)?.label,
      globalIcon: publicView.representation("Iconable", functionUuid)?.icon,
      entityLabel: publicView.presentation(entityUuid)?.label,
      projectedLabel: projected.representation("Labelable", functionUuid)?.label,
      projectedMissingIcon: projected.representation("Iconable", functionUuid) ?? null,
      exactMissingLabel: exactMiss.presentation(functionUuid)?.label ?? null,
      exactMissingRepresentation: exactMiss.representation("Labelable", functionUuid) ?? null,
      publicStillVisible: publicView.presentation(functionUuid)?.label,
    };
  },
  debug() {
    try {
      const entity = session.registry.getIdentifiedEntity("Card");
      const fields = entity ? entitySchemaFields(entity) : recordFieldsForType({ $ref: "Card" }, environment);
      const template = leftTemplates().resolve("card");
      return { fields, template, plan: surfaceLayoutRenderPlan({ environment: createSurfaceEnvironment({ registry: session.registry }),
        layout: template!.layout!, fields: fields ?? [], values: { title: "Layout title" }, mode: "read" }) };
    } catch (error) { return { error: String(error), stack: (error as Error).stack }; }
  },
};
declare global { var fenelTypedRead: typeof typedReadFixture; }
globalThis.fenelTypedRead = typedReadFixture;
