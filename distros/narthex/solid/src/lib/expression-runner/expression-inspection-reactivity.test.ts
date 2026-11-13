import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { dirname, join, relative as relativePath, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Match the Chromium runner's bounded reads on the shared Windows host.
function readSource(path: string): string {
  const fd = openSync(path, "r");
  try {
    const bytes = Buffer.alloc(fstatSync(fd).size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, Math.min(16_384, bytes.length - offset), offset);
      if (!count) throw new Error("Fixture source changed during its read");
      offset += count;
    }
    return bytes.toString("utf8");
  } finally { closeSync(fd); }
}

test("held metadata, graph placement and call controls preserve mounted presentation (isolated Chromium)", async () => {
  const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const repository = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const scratch = join(repository, ".tmp-tsc");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "held-call-metadata-"));
  try {
    console.log("Loading the Solid compiler");
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = createRequire(import.meta.url)(compilerPath);
    const baseline = process.env["FENEL_INSPECTION_REACTIVITY_BASELINE"] === "1";
    const graphBaseline = process.env["FENEL_EXPRESSION_GRAPH_BASELINE_SHA"];
    const valueTypeBaseline = process.env["FENEL_GRAPH_VALUE_TYPE_BASELINE_SHA"];
    const readBaseline = process.env["FENEL_GRAPH_READ_BASELINE_SHA"];
    const authoringBaseline = process.env["FENEL_GRAPH_AUTHORING_BASELINE"] === "1";
    const callEditBaseline = process.env["FENEL_GRAPH_CALL_EDIT_BASELINE_SHA"];
    const scopeBaseline = process.env["FENEL_GRAPH_SCOPE_BASELINE_SHA"];
    const capture = process.env["FENEL_EXPRESSION_GRAPH_CAPTURE_DIR"];
    const capturePath = capture ? resolve(repository, capture) : undefined;
    if (capturePath && !capturePath.startsWith(resolve(repository) + sep)) throw new Error("Graph captures escaped their repository");
    if (capturePath) await mkdir(capturePath, { recursive: true });
    const frozenGraph = new Map<string, string>();
    const occurrenceBaseline = process.env["FENEL_GRAPH_OCCURRENCE_BASELINE_SHA"];
    if (occurrenceBaseline) {
      if (!/^[a-f0-9]{7,40}$/i.test(occurrenceBaseline)) throw new Error("Graph occurrence baseline must be a committed Git SHA");
      for (const path of ["src/lib/expression-runner/ExpressionEditor.tsx"]) {
        const preceding = Bun.spawnSync(["git", "show", `${occurrenceBaseline}:distros/narthex/solid/${path}`], { cwd: repository });
        if (preceding.exitCode !== 0) throw new Error(`Cannot read the occurrence baseline: ${path}`);
        frozenGraph.set(resolve(packageRoot, path), new TextDecoder().decode(preceding.stdout));
      }
    }
    if (scopeBaseline) {
      if (!/^[a-f0-9]{7,40}$/i.test(scopeBaseline)) throw new Error("Graph scope baseline must be a committed Git SHA");
      for (const path of ["src/lib/expression-runner/ExpressionEditor.tsx", "src/lib/expression-runner/expression-surfaces.tsx",
        "src/lib/expression-runner/structural-surfaces.tsx", "src/lib/expression-runner/structural-surfaces.css", "src/routes/app.css"]) {
        const preceding = Bun.spawnSync(["git", "show", `${scopeBaseline}:distros/narthex/solid/${path}`], { cwd: repository });
        if (preceding.exitCode !== 0) throw new Error(`Cannot read the scope baseline: ${path}`);
        frozenGraph.set(resolve(packageRoot, path), new TextDecoder().decode(preceding.stdout));
      }
    }
    if (callEditBaseline) {
      if (!/^[a-f0-9]{7,40}$/i.test(callEditBaseline)) throw new Error("Graph call-edit baseline must be a committed Git SHA");
      for (const path of ["src/lib/expression-runner/ExpressionEditor.tsx", "src/lib/expression-runner/expression-surfaces.tsx", "src/routes/app.css"]) {
        const preceding = Bun.spawnSync(["git", "show", `${callEditBaseline}:distros/narthex/solid/${path}`], { cwd: repository });
        if (preceding.exitCode !== 0) throw new Error(`Cannot read the call-edit baseline: ${path}`);
        frozenGraph.set(resolve(packageRoot, path), new TextDecoder().decode(preceding.stdout));
      }
    }
    if (authoringBaseline) {
      for (const path of ["src/lib/expression-runner/ExpressionEditor.tsx", "src/lib/expression-runner/expression-surfaces.tsx", "src/routes/app.css"]) {
        const preceding = Bun.spawnSync(["git", "show", `HEAD:distros/narthex/solid/${path}`], { cwd: repository });
        if (preceding.exitCode !== 0) throw new Error(`Cannot read the authoring baseline: ${path}`);
        frozenGraph.set(resolve(packageRoot, path), new TextDecoder().decode(preceding.stdout));
      }
    }
    if (readBaseline) {
      if (!/^[a-f0-9]{7,40}$/i.test(readBaseline)) throw new Error("Typed reader baseline must be a committed Git SHA");
      for (const path of ["src/lib/value-card.tsx", "src/lib/data-transfer/DataPreview.tsx", "src/lib/layout-renderer/TypedReadValue.tsx"]) {
        const preceding = Bun.spawnSync(["git", "show", `${readBaseline}:distros/narthex/solid/${path}`], { cwd: repository });
        if (preceding.exitCode !== 0) throw new Error(`Cannot read the typed-reader baseline: ${path}`);
        frozenGraph.set(resolve(packageRoot, path), new TextDecoder().decode(preceding.stdout));
      }
    }
    if (graphBaseline) {
      if (!/^[a-f0-9]{7,40}$/i.test(graphBaseline)) throw new Error("Graph baseline must be a committed Git SHA");
      for (const path of ["src/lib/expression-runner/expression-surfaces.tsx", "src/routes/app.css"]) {
        const frozen = Bun.spawnSync(["git", "show", `${graphBaseline}:distros/narthex/solid/${path}`], { cwd: repository });
        if (frozen.exitCode !== 0) throw new Error(`Cannot read the graph baseline: ${path}`);
        frozenGraph.set(resolve(packageRoot, path), new TextDecoder().decode(frozen.stdout));
      }
    }
    const editor = fileURLToPath(new URL("./ExpressionEditor.tsx", import.meta.url));
    if (valueTypeBaseline && !/^[a-f0-9]{7,40}$/i.test(valueTypeBaseline)) throw new Error("Graph type baseline must be a committed Git SHA");
    const frozen = baseline || valueTypeBaseline ? Bun.spawnSync(["git", "show", `${valueTypeBaseline ?? "20cd4da0"}:distros/narthex/solid/src/lib/expression-runner/ExpressionEditor.tsx`], { cwd: repository }) : undefined;
    if (frozen && frozen.exitCode !== 0) throw new Error("Cannot read the preceding held renderer");
    // Reuse the exact production recursive reader while keeping the existing
    // held harness independent of registry bootstrap, inference and evaluation.
    // String/List/Any and one String-backed nominal fixture are admitted;
    // unknown semantic paths throw instead of broadening component evidence.
    // The new lazy readonly structural body resolves here; editing-worker
    // imports remain blocked, so pending authoring cannot stand in for reads.
    const readerPath = join(packageRoot, "src/lib/layout-renderer/TypedReadValue.tsx");
    const readerSource = frozenGraph.get(resolve(readerPath)) ?? readSource(readerPath);
    const readerPresentationSource = readSource(join(packageRoot, "src/lib/reader-presentation.ts"));
    const resultLabelStart = readerPresentationSource.indexOf("export function readerResultTypeLabel(");
    const resultLabelEnd = readerPresentationSource.indexOf("/** B3 DTO", resultLabelStart);
    const typeAuthoringSource = readSource(join(repository, "implementations/typescript/engine/src/authoring/type-authoring.ts"));
    const resultPeelerStart = typeAuthoringSource.indexOf("export function peelResultForAuthoring(");
    const resultPeelerEnd = typeAuthoringSource.indexOf("/** B3 authoring lens", resultPeelerStart);
    if (resultLabelStart < 0 || resultLabelEnd <= resultLabelStart || resultPeelerStart < 0 || resultPeelerEnd <= resultPeelerStart)
      throw new Error("Reader Result label extraction markers changed");
    const reflectionSource = readSource(join(repository, "implementations/typescript/engine/src/effect-dispatch.ts"));
    const reflectionStart = reflectionSource.indexOf("export function typeConstructorOf(");
    const reflectionEnd = reflectionSource.indexOf("// rights R3a", reflectionStart);
    if (reflectionStart < 0 || reflectionEnd <= reflectionStart) throw new Error("Reader reflection extraction markers changed");
    const valueTypeSource = readSource(join(repository, "implementations/typescript/engine/src/authoring/value-authoring.ts"));
    const nativeStart = valueTypeSource.indexOf("const DEFAULT_FOR_NAMED:");
    const nativeEnd = valueTypeSource.indexOf("function lookupValueType(", nativeStart);
    const resolveStart = valueTypeSource.indexOf("export function resolveValueType(");
    const resolveEnd = valueTypeSource.indexOf("export function variantValueDiscriminator(", resolveStart);
    if (nativeStart < 0 || nativeEnd <= nativeStart || resolveStart < 0 || resolveEnd <= resolveStart)
      throw new Error("Value type resolution extraction markers changed");
    const preparedSource = readSource(join(packageRoot, "src/lib/expression-runner/index.tsx"));
    const graphOwnerBaseline = process.env["FENEL_GRAPH_OWNER_BASELINE"] === "1";
    const precedingGraphOwner = graphOwnerBaseline ? Bun.spawnSync(["git", "show",
      "HEAD:distros/narthex/solid/src/lib/expression-runner/index.tsx"], { cwd: repository }) : undefined;
    if (precedingGraphOwner && precedingGraphOwner.exitCode !== 0) throw new Error("Cannot read the preceding graph activation owner");
    const graphOwnerSource = precedingGraphOwner ? new TextDecoder().decode(precedingGraphOwner.stdout) : preparedSource;
    const graphOwnerStateStart = graphOwnerSource.indexOf("  const activeGraphs = new Map<");
    const graphOwnerStateEnd = graphOwnerSource.indexOf("  const currentGraphWorker =", graphOwnerStateStart);
    const graphOwnerActivationStart = graphOwnerSource.indexOf("  onCleanup(() => {", graphOwnerStateEnd);
    const graphOwnerActivationEnd = graphOwnerSource.indexOf("  const requestCapture =", graphOwnerActivationStart);
    if (graphOwnerStateStart < 0 || graphOwnerStateEnd <= graphOwnerStateStart
      || graphOwnerActivationStart < 0 || graphOwnerActivationEnd <= graphOwnerActivationStart
      || !graphOwnerSource.slice(graphOwnerActivationStart, graphOwnerActivationEnd).includes("const activateGraph ="))
      throw new Error("Prepared graph activation owner extraction markers changed");
    const preparedListStart = preparedSource.indexOf("  const graphListData = (");
    const preparedListEnd = preparedSource.indexOf("  const graphCallableName =", preparedListStart);
    if (preparedListStart < 0 || preparedListEnd <= preparedListStart) throw new Error("Prepared graph list extraction markers changed");
    const structuralReadSource = readSource(join(packageRoot, "src/lib/data-transfer/DataValueSurface.tsx"));
    const structuralReadStart = structuralReadSource.indexOf("export function DataValueSurface(");
    if (structuralReadStart < 0) throw new Error("Structural read fixture extraction marker changed");
    const readerStart = readerSource.indexOf("export function typedReadDisplayType(");
    const readerEnd = readerSource.indexOf("/** Semantic inspection");
    if (readerStart < 0 || readerEnd <= readerStart) throw new Error("Typed reader fixture extraction markers changed");
    const relative = (file: string) => JSON.stringify(relativePath(directory, join(packageRoot, file)).replaceAll("\\", "/"));
    const typedReader = join(directory, "typed-reader.tsx");
    await Bun.write(typedReader, `
import { Errored, For, Loading, Show, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { CollectionPreviewStrip, ValueCard, ValueCardCaption, valueCardLabel } from ${relative("src/lib/value-card")};
import { DataPreview, DataThumbnail, DelimitedText, hasDataPreview } from ${relative("src/lib/data-transfer/DataPreview")};
import { IconByName, LUCIDE_BY_NAME } from ${relative("src/lib/icons")};
import { typeIconForPresentation } from ${relative("src/lib/type-icon-presentation")};
import { readLocusCatalogReference } from ${relative("src/lib/locus-catalog-reference")};
import { detectStructuralForm as heldStructuralForm } from ${relative("src/lib/expression-runner/expression-structure")};
import * as graphControls from ${relative("src/lib/expression-runner/expression-surfaces")};
import { DataOccurrenceBoundary } from ${relative("src/lib/data-occurrence")};
const ExpressionGraphCollectionItemControl = graphControls.ExpressionGraphCollectionItemControl;
const Nothing = { $tag: "Nothing" };
const Anything = { $complement: { $void: true } };
const listType = element => ({ $opaque: { name: "List", pure: { $variant: { cases: [
  { name: "Nil" }, { name: "Cons", fields: [{ name: "head", type: element }] }
] } } } });
const excluded = name => { throw new Error("Held typed read fixture excludes " + name); };
${typeAuthoringSource.slice(resultPeelerStart, resultPeelerEnd)}
const printType = () => excluded("Result source printing"), dispatchedCodeLensTextIsReadable = () => excluded("Result source readability");
${readerPresentationSource.slice(resultLabelStart, resultLabelEnd)}
const refHandle = type => type?.$ref;
${reflectionSource.slice(reflectionStart, reflectionEnd)}
const registry = { getIdentifiedEntity(id) {
  if (id === "String" || id === "CustomerId") return { id, type: { $ref: "String" } };
  if (id === "Any") return { id, type: { $complement: { $void: true } } };
  if (id === "List") return { id, type: listType({ $var: "a" }) };
  return excluded("registry identity " + id);
} };
const representation = (className, id) => className === "Viewable" || className === "Labelable" || className === "Codeable" ? undefined
  : className === "Iconable" ? { icon: id === "List" ? "list" : "type" }
  : excluded("dispatch class " + className);
const webRegistry = { resolve: () => undefined, getComponent: () => undefined };
const session = { registry, environment: { resolveTypeRef: () => undefined }, evaluateContext: { _specRegistry: {} } };
globalThis.heldTypedReaderSession = session;
const reader = { session: () => session, templates: () => webRegistry, representation,
  presentation: id => id === "named-string" ? { label: "Named string" } : { codeName: id } };
const useAuthoringSession = () => session, useReaderRuntime = () => reader;
const resolveEffect = () => excluded("live dispatch"), entitySchemaFields = () => undefined, recordFieldsForType = () => undefined;
const pureValueType = type => type;
const lookupValueType = id => registry.getIdentifiedEntity(id)?.type;
${valueTypeSource.slice(nativeStart, nativeEnd)}
${valueTypeSource.slice(resolveStart, resolveEnd)}
const isFenelTypeLike = () => false, peelMaybeForAuthoring = () => undefined;
const peelMaybeValue = value => value?.$tag === "Just" ? value._0 : undefined;
const fieldNumericTextCodecPlan = name => name === "String" || name === "Any" ? undefined : excluded("numeric codec " + name);
const childrenOf = value => value.map((value, key) => ({ value, key, label: "Item " + (key + 1) }));
const childValueType = (_value, type) => type?.$opaque?.pure?.$variant?.cases?.[1]?.fields?.[0]?.type;
const typeCode = (type, label) => type?.$opaque?.name === "List" ? "List of " + typeCode(childValueType([], type), label).toLowerCase() + "s"
  : type?.$ref ? label(type.$ref) : type?.$var ? type.$var : excluded("type formatter");
const typePhrase = typeCode;
const surfaceReadValuePlan = () => excluded("scalar plan outside String");
const ReadPlanValue = () => excluded("scalar renderer outside String");
const VariantValueRenderer = () => excluded("variant renderer"), ReadValue = () => excluded("custom Viewable renderer");
const StructuralReadValue = props => <DataPreview value={props.value} />;
const LayoutRenderer = () => excluded("record layout"), TypeDataPreview = () => excluded("type data");
const DataTransferTarget = props => <div class="fenel-transfer-target">{props.children}</div>;
const classifyData = () => excluded("transfer classification"), cloneDraftValue = () => excluded("transfer draft");
${structuralReadSource.slice(structuralReadStart)}
${readerSource.slice(readerStart, readerEnd)}
globalThis.heldPreparedGraphProjection = (node, element, observed) => {
  const graphValue = current => current === node ? observed : undefined;
  const graphType = () => listType(element), resolvedFieldType = () => undefined;
  const peelList = type => ({ elem: childValueType([], type) });
  const transferSaved = undefined;
  const preparedTypeIcon = type => type?.$var ? "box" : "type";
  const detectStructuralForm = value => heldStructuralForm(value, () => true);
  ${preparedSource.slice(preparedListStart, preparedListEnd)}
  return graphListData(node);
};
// Only the lifecycle owner is extracted. These boundary fixtures admit one
// complete local expression and no inherited/external capture or evaluation.
globalThis.heldPreparedGraphActivation = () => {
  let publications = 0;
  const sourceCreateSignal = createSignal;
  return ((createSignal) => {
    ${graphOwnerSource.slice(graphOwnerStateStart, graphOwnerStateEnd)}
    const controller = new AbortController();
    const captureRequest = () => ({ controller });
    const completeExpression = () => true, externalCapture = () => false;
    const inheritedCapture = {};
    ${graphOwnerSource.slice(graphOwnerActivationStart, graphOwnerActivationEnd)}
    return { activate: activateGraph, state: () => ({
      nodes: [...activeGraphs.values()].map(current => current.node),
      selected: untrack(graphSelection)?.node, active: untrack(graphActive),
      publications, aborted: controller.signal.aborted,
    }) };
  })((...args) => {
    const [read, write] = sourceCreateSignal(...args);
    return [read, value => { publications++; return write(value); }];
  });
};
`);
    const inspectionSource = readSource(join(packageRoot, "src/lib/DataInspectionDialog.tsx"));
    const inspectionStart = inspectionSource.indexOf("export function createDataInspectionSuggestions(");
    const inspectionEnd = inspectionSource.indexOf("const panelOrder:", inspectionStart);
    if (inspectionStart < 0 || inspectionEnd <= inspectionStart) throw new Error("Suggestions lifecycle extraction markers changed");
    const inspectionOwner = join(directory, "suggestions-owner.tsx");
    await Bun.write(inspectionOwner, `import {createMemo,createSignal,onSettled} from "solid-js";\n${inspectionSource.slice(inspectionStart, inspectionEnd)}`);
    const dedicatedSource = (path: string) => {
      if (!occurrenceBaseline) return readSource(join(packageRoot, path));
      const preceding = Bun.spawnSync(["git", "show", `${occurrenceBaseline}:distros/narthex/solid/${path}`], { cwd: repository });
      if (preceding.exitCode !== 0) throw new Error(`Cannot read the dedicated occurrence baseline: ${path}`);
      return new TextDecoder().decode(preceding.stdout);
    };
    const exampleSource = dedicatedSource("src/lib/storybook/index.tsx"), exampleStart = exampleSource.indexOf("export function ValueDisplay("),
      exampleEnd = exampleSource.indexOf("// ---------------------------------------------------------------------------", exampleStart);
    const tableSource = dedicatedSource("src/routes/app/types/[id]/index.tsx"), tableStart = tableSource.indexOf("function listDisplayToColumnDefs("),
      tableEnd = tableSource.indexOf("/** Default inline-edit", tableStart);
    const recordSource = dedicatedSource("src/routes/app/types/[id]/[instanceId].tsx"), recordStart = recordSource.indexOf("function CellValue("),
      recordEnd = recordSource.indexOf("function productFieldLabel(", recordStart);
    if (exampleStart < 0 || exampleEnd <= exampleStart || tableStart < 0 || tableEnd <= tableStart || recordStart < 0 || recordEnd <= recordStart)
      throw new Error("Dedicated occurrence renderer extraction markers changed");
    await Bun.write(typedReader, (await Bun.file(typedReader).text()) + `
// Only concrete scalar presentation is admitted in these dedicated-page ports.
// Source policy remains the production DataOccurrenceBoundary above.
{
  const useStorybookContext = () => () => ({});
  const isImageRecord = () => false, isSoundValue = () => false, isAudioBufferValue = () => false,
    isAnimationValue = () => false, isFrameSequenceValue = () => false, isMovieValue = () => false,
    isRecordedMovieValue = () => false, isTrackValue = () => false, isLiveGameValue = () => false,
    isGameValue = () => false, isEventValue = () => false, isImageLike = () => false;
  const RenderScalar = props => <DataPreview value={props.value} />;
  const ReadPlanValue = props => <DataPreview value={props.plan.value} />;
  const surfaceReadValuePlan = value => ({ value });
  const surfaceListDisplayRenderPlan = () => ({columns:[{fieldName:"name",label:"Name",editable:false,fallbackKind:"scalar"}]});
  const resolveSurfaceView = () => undefined, renderEditableCell = value => <DataPreview value={value} />;
  const UNAVAILABLE_TABLE_OCCURRENCE = { state:"unavailable",issue:"This table has no live source expression here." };
  const UNAVAILABLE_INSTANCE_OCCURRENCE = { state:"unavailable",issue:"This record has no live source expression here." };
  const refEntityType = () => undefined;
  ${exampleSource.slice(exampleStart, exampleEnd).replace("export function", "function")}
  ${tableSource.slice(tableStart, tableEnd)}
  ${recordSource.slice(recordStart, recordEnd)}
  globalThis.heldDedicatedOccurrence = {
    storybook: () => <ValueDisplay value="A concrete example" typeName="String" />,
    table: () => <table class="data-table"><tbody><tr><td>{listDisplayToColumnDefs({columns:[{field:"name"}]},[])[0].render("Ada",{},undefined)}</td></tr></tbody></table>,
    record: () => <CellValue field={{name:"name",type:{$ref:"String"}}} value="Ada" />,
  };
}
`);
    console.log(`Building ${baseline ? "preceding" : graphBaseline ? `graph baseline ${graphBaseline}` : "current"} held renderer`);
    const browser = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./expression-inspection-reactivity.fixture.tsx", import.meta.url))],
      target: "browser", conditions: ["browser", "development"], tsconfig: join(packageRoot, "tsconfig.json"),
      plugins: [{ name: "held-call-metadata-browser", setup(build) {
        build.onResolve({ filter: /(?:^|\/)layout-renderer\/TypedReadValue$/ }, () => ({ path: typedReader }));
        build.onResolve({ filter: /DataInspectionDialog$/ }, () => ({ path: inspectionOwner }));
        build.onResolve({ filter: /authoring-catalog-worker$/ }, args => args.kind === "dynamic-import"
          ? { path: "occurrence-worker", namespace: "held-occurrence" } : undefined);
        build.onLoad({ filter: /.*/, namespace: "held-occurrence" }, () => ({ loader: "js", contents: `
export const authoringWorkerSnapshot = session => session;
export function discoverDataSuggestionsInWorker(session,input) {
  globalThis.graphOccurrenceDiscoveries ??= [];
  globalThis.graphOccurrenceDiscoveries.push(input);
  return Promise.resolve({ revision:input.revision,suggestions:[{identity:"fixture-operation",label:"Use this source",icon:"wand-sparkles",revision:input.revision}],
    undecided:[],coverage:{operationsChecked:1,operationsSeen:1,operationsAvailable:1,truncated:false}});
}
export function prepareDataSuggestionInWorker(session,suggestion,input) {
  globalThis.graphOccurrencePreparations ??= [];
  globalThis.graphOccurrencePreparations.push(input);
  return Promise.resolve({ok:true,node:input.expression});
}` }));
        build.onResolve({ filter: /.*/ }, args => args.kind === "dynamic-import"
          ? args.path === "./DataValueSurface" && args.importer.replaceAll("\\", "/").endsWith("/data-transfer/DataPreview.tsx")
            ? { path: typedReader } : { path: `/fixture/dynamic/${encodeURIComponent(args.path)}`, external: true }
          : undefined);
        build.onResolve({ filter: /^\.\/index$/ }, args => args.importer.replaceAll("\\", "/").endsWith("/expression-runner/ExpressionEditor.tsx")
          ? { path: "/prepared-controller", external: true } : undefined);
        build.onResolve({ filter: /^@fenel\// }, args => {
          if (args.path === "@fenel/engine/maybe-value") return { path: join(repository, "implementations/typescript/engine/src/maybe-value.ts") };
          if (args.path === "@fenel/engine/checkpoint-json") return { path: join(repository, "implementations/typescript/engine/src/checkpoint-json.ts") };
          throw new Error(`Held renderer eagerly imported semantics: ${args.path}`);
        });
        build.onResolve({ filter: /^(?:solid-js|@solidjs\/web)$/ }, args => ({
          path: join(dirname(Bun.resolveSync(args.path, packageRoot)), args.path === "solid-js" ? "solid.dev.js" : "web.dev.js").replaceAll("\\", "/"),
        }));
        build.onResolve({ filter: /^@solidjs\/signals$/ }, args => ({
          path: join(dirname(dirname(Bun.resolveSync(args.path, dirname(Bun.resolveSync("solid-js", packageRoot))))), "dev.js").replaceAll("\\", "/"),
        }));
        build.onLoad({ filter: /\.tsx$/ }, async args => {
          const contents = (await compiler.transformAsync(
            frozen && resolve(args.path) === resolve(editor) ? new TextDecoder().decode(frozen.stdout)
              : frozenGraph.get(resolve(args.path)) ?? readSource(args.path),
            { filename: args.path, generate: "dom", hydratable: false, dev: true },
          )).code;
          return { loader: "ts", contents };
        });
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }],
    });
    if (!browser.success) throw new AggregateError(browser.logs, "Held metadata browser build failed");
    console.log("Held renderer built; building Chromium runner");
    const browserPath = join(directory, "browser.js");
    await Bun.write(browserPath, browser.outputs.find(output => output.kind === "entry-point")!);
    const cssPath = join(directory, "browser.css");
    await Bun.write(cssPath, (await Promise.all(["src/global.css", "src/routes/app.css", "src/lib/home-entry.css",
      "src/lib/admin-form/admin-form.css", "src/lib/locus-context-menu.css", "src/lib/expression-runner/structural-surfaces.css"].map(path => frozenGraph.get(resolve(packageRoot, path))
        ?? readSource(join(packageRoot, path))))).join("\n"));
    const runner = await Bun.build({ entrypoints: [fileURLToPath(new URL("./expression-inspection-reactivity.node-fixture.ts", import.meta.url))], target: "node", packages: "external" });
    if (!runner.success) throw new AggregateError(runner.logs, "Held metadata runner build failed");
    const nodePath = join(directory, "runner.mjs");
    await Bun.write(nodePath, (await runner.outputs[0]!.text()).replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
    const preload = process.env["FENEL_TEST_NODE_PRELOAD"];
    const preloadPath = preload ? resolve(repository, preload) : undefined;
    if (preloadPath && !preloadPath.startsWith(resolve(repository) + sep)) throw new Error("Node fixture preload escaped its repository");
    const child = Bun.spawn(["node", ...(preloadPath ? ["--require", preloadPath] : []), nodePath, browserPath, cssPath], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory,
        ...(capturePath ? { FENEL_EXPRESSION_GRAPH_CAPTURE_DIR: capturePath } : {}) },
    });
    console.log(`Running held metadata fixture, PID ${child.pid}`);
    const collect = async (stream: ReadableStream<Uint8Array>) => {
      let output = "";
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return output;
        const message = decoder.decode(chunk.value, { stream: true });
        output += message;
        console.log(message.trimEnd());
      }
    };
    const [code, stdout, stderr] = await Promise.all([child.exited, collect(child.stdout), collect(child.stderr)]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain(baseline ? '"baseline":true' : '"baseline":false');
    console.log(stdout.trim());
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Held fixture cleanup escaped the repository scratch directory");
    await rm(target, { recursive: true, force: true });
  }
}, 600_000);
