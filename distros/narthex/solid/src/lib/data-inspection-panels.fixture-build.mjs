// C2 tooling only. Compile the actual production JSX with Solid's compiler.
// Unreachable semantic dependencies throw; no source policy is reimplemented.
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { writeVerifiedArtifact } from "../../../../../scripts/lib/verified-artifact-io.mjs";

const repository = process.cwd();
const frontend = resolve(repository, "distros/narthex/solid");
const output = resolve(repository, process.env.FENEL_INSPECTION_PANELS_OUTPUT_DIR ?? ".tmp-diag/panel-repair");
const within = relative(repository, output);
if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error("Panel fixture output must stay inside the repository");
if (process.env.FENEL_INSPECTION_PANELS_OUTPUT_DIR) {
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Explicit comparison builds never reuse an old artifact directory.
} else await mkdir(output, { recursive: true });
const writeArtifact = async (name, content) => {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content)
    : new Uint8Array(await content.arrayBuffer());
  return writeVerifiedArtifact(resolve(output, name), bytes);
};
const compiler = await import(pathToFileURL(Bun.resolveSync("@solidjs/compiler",
  dirname(Bun.resolveSync("@solidjs/vite-plugin", frontend)))).href);
const source = path => resolve(frontend, "src/lib", path);
const unavailable = name => `export function ${name}() { throw new Error("Unreachable semantic dependency: ${name}"); }`;
const stubs = new Map([
  ["./prompt-body", "export default function PromptBody() { throw new Error(\"The panel fixture never opens a typed prompt.\"); }"],
  ["./public-bootstrap", unavailable("loadPublicBootstrap")],
  ["./workspace-model-loader", unavailable("loadWorkspaceModel")],
  ["./lens-shortcuts", unavailable("lensPolicyData")],
  ["./data-suggestions", unavailable("policyCandidate")],
  ["./layout-renderer/TypedReadValue", unavailable("TypedReadValue") + "\n" + unavailable("typedReadTypePresentation")],
  ["./value-card", `export { CardLoadingIndicator } from ${JSON.stringify(source("value-card.tsx"))}; `
    + ["ValueCard", "ValueCardCaption", "ValueTypeCaption", "valueCardLabel", "valueCardTypeLabel", "RowPending"].map(unavailable).join("\n")],
  ["./expression-runner/authoring-catalog-worker", `
    export const authoringWorkerSnapshot = session => dataInspectionPanelsFixture.recordedWorkerSnapshot(session);
    export const discoverDataSuggestionsInWorker = (session, input, options, signal) =>
      dataInspectionPanelsFixture.discoverRecordedSuggestions(session, input, options, signal);
    export const prepareDataSuggestionInWorker = session => dataInspectionPanelsFixture.prepareRecordedSuggestion(session);
  `],
  ["@fenel/engine/type-foundation", `export { Just, Nothing, peelMaybeValue } from ${JSON.stringify(resolve(repository,
    "implementations/typescript/engine/src/maybe-value.ts"))}; ${unavailable("List")}`],
  ["@fenel/engine/templates", unavailable("builtinTemplates")],
]);

// CardLoadingIndicator is the actual production Show-based component. Its
// owner also imports full-card helpers; those paths remain unreachable in this
// panel fixture. Scope these throwing bindings to that owner's imports only.
const valueCardUnreachable = new Map([
  ["./value-hover-preview", ["ValueHoverPreview", "ValueCardInlineContext", "ValueCardCompactLayoutContext",
    "useValueCardInline", "useValueCardCompactLayout"].map(unavailable).join("\n")],
  ["./data-transfer/DataPreview", unavailable("DataThumbnail")],
  ["./corner-menu", unavailable("CornerMenuButton")],
  ["./data-transfer/events", unavailable("ownsDataOpenEvent")],
  ["./display-name", unavailable("displayNameText") + unavailable("valueCardLabel")],
  ["./display-name-text", unavailable("DisplayNameText")],
]);

// This fixture stops at the actual missing-declaration refusal. These result,
// argument and Local-worker paths are unreachable, and still throw if called.
// Only imports owned by the real related-data panel receive these bindings.
const relatedPanelUnreachable = new Map([
  ["@fenel/engine/authoring/expression", ["typePhrase"]],
  ["./field-renderer/FieldRenderer", ["displayTypeLabel", "FieldLabel", "FieldRenderer", "PlainFieldsContext"]],
  ["./expression-runner/inline-widgets", ["inlineWidgetFor"]],
  ["./expression-runner/local-editor-reads", ["createLocalLensPolicy", "localEditorSession"]],
  ["./loading-screen", ["LensSpinner"]],
  ["./grouping-read", ["createGroupingPresentation"]],
  ["./grouping-lens", ["suggestionLensChip"]],
].map(([path, names]) => [path, names.map(unavailable).join("\n")]));

// The panel genuinely reads its optional Solid context before refusing the
// absent declaration. Acquire these exact production declarations, without
// importing their owner's account/Local initialization graph or faking a reader.
const readerContextDeclarations = "export const ReaderRuntimeContext = createContext<ReaderRuntime | null>(null);\nexport function useReaderRuntime(): ReaderRuntime | undefined { return useContext(ReaderRuntimeContext) ?? undefined; }\n";
const readerContextInputs = [];

const entry = source("data-inspection-panels.browser-fixture.tsx");
const compiled = [];
const engineRoot = resolve(repository, "implementations/typescript/engine/src");
const allowedEngineInputs = new Set(["maybe-value.ts", "checkpoint-json.ts", "engine-body-value-transport.ts", "template-registry.ts"]);
const engineInputs = [];
const bundle = await Bun.build({ entrypoints: [entry], target: "browser", conditions: ["browser", "development"],
  plugins: [{ name: "actual-inspection-panels-negative-source", setup(build) {
    build.onResolve({ filter: /^(?:solid-js|@solidjs\/web)$/ }, args => ({
      path: resolve(dirname(Bun.resolveSync(args.path, frontend)), args.path === "solid-js" ? "solid.dev.js" : "web.dev.js"),
    }));
    build.onResolve({ filter: /^(?:@fenel\/|\.\/)/ }, args => {
      const importer = args.importer ? resolve(args.importer) : "";
      if (importer === source("related-data-panels.tsx")) {
        if (args.path === "./reader-runtime") return {
          path: source("reader-runtime.tsx"), namespace: "actual-reader-context-source",
        };
        if (relatedPanelUnreachable.has(args.path)) return {
          path: args.path, namespace: "related-panel-unavailable-source",
        };
      }
      if (importer === source("value-card.tsx") && valueCardUnreachable.has(args.path)) return {
        path: args.path, namespace: "value-card-unavailable-source",
      };
      if (stubs.has(args.path)) return { path: args.path, namespace: "unavailable-source" };
      if (args.path === "@fenel/engine/maybe-value") return { path: resolve(repository, "implementations/typescript/engine/src/maybe-value.ts") };
      if (args.path === "@fenel/engine/checkpoint-json") return { path: resolve(repository, "implementations/typescript/engine/src/checkpoint-json.ts") };
      if (args.path === "@fenel/engine/template-registry") return { path: resolve(repository, "implementations/typescript/engine/src/template-registry.ts") };
      if (args.path === "./authoring/surface" && args.importer.endsWith("template-registry.ts")) return {
        path: "template-surface-policy", namespace: "unavailable-source",
      };
      if (args.path.startsWith("@fenel/")) throw new Error("Unexpected engine acquisition in bounded panel fixture: " + args.path);
    });
    build.onLoad({ filter: /.*/, namespace: "related-panel-unavailable-source" }, args => ({
      loader: "js", contents: relatedPanelUnreachable.get(args.path),
    }));
    build.onLoad({ filter: /.*/, namespace: "actual-reader-context-source" }, async args => {
      const contents = await Bun.file(args.path).text();
      const start = contents.indexOf(readerContextDeclarations);
      if (start < 0 || contents.indexOf(readerContextDeclarations, start + 1) !== -1
        || start > 0 && contents[start - 1] !== "\n") {
        throw new Error("Actual ReaderRuntime context declarations changed; review this fixture acquisition.");
      }
      const acquired = contents.slice(start, start + readerContextDeclarations.length);
      readerContextInputs.push({
        path: "distros/narthex/solid/src/lib/reader-runtime.tsx",
        bytes: Buffer.byteLength(contents), sha256: createHash("sha256").update(contents).digest("hex"),
        exports: ["ReaderRuntimeContext", "useReaderRuntime"],
        firstLine: contents.slice(0, start).split("\n").length,
        sliceBytes: Buffer.byteLength(acquired), sliceSha256: createHash("sha256").update(acquired).digest("hex"),
        scope: "Exact consecutive production context declarations; no reader initialization acquired",
      });
      return { loader: "ts", contents: 'import { createContext, useContext } from "solid-js";\n' + acquired };
    });
    build.onLoad({ filter: /.*/, namespace: "value-card-unavailable-source" }, args => ({
      loader: "js", contents: valueCardUnreachable.get(args.path),
    }));
    build.onLoad({ filter: /.*/, namespace: "unavailable-source" }, args => ({ loader: "js", contents:
      args.path === "template-surface-policy" ? ["mergeSurfaceDisplay", "mergeSurfaceEditDisplay", "mergeSurfaceReadDisplay",
        "resolveSurfaceDefaultTemplate", "resolveSurfaceTypeView"].map(unavailable).join("\n") : stubs.get(args.path),
    }));
    build.onLoad({ filter: /\.tsx$/ }, async args => {
      const text = await Bun.file(args.path).text();
      compiled.push({ path: args.path.slice(repository.length + 1).replaceAll("\\", "/"),
        sha256: createHash("sha256").update(text).digest("hex") });
      const code = (await compiler.transformAsync(text,
        { filename: args.path, generate: "dom", hydratable: false, dev: true })).code;
      // C2 acquisition observer only: the actual lazy body's module evaluates
      // at first use. Its renderer and missing-declaration refusal stay real.
      return { loader: "ts", contents: resolve(args.path) === source("related-data-panels.tsx")
        ? `globalThis.__relatedDataPanelAcquisitions = (globalThis.__relatedDataPanelAcquisitions ?? 0) + 1;\n${code}` : code };
    });
    build.onLoad({ filter: /\.ts$/ }, async args => {
      const name = relative(engineRoot, args.path).replaceAll("\\", "/");
      if (name === ".." || name.startsWith("../") || isAbsolute(name)) return undefined;
      if (!allowedEngineInputs.has(name)) throw new Error(`Panel fixture acquired an unexpected engine graph input: ${name}`);
      const contents = await Bun.file(args.path).text();
      engineInputs.push({ path: `implementations/typescript/engine/src/${name}`, sha256: createHash("sha256").update(contents).digest("hex") });
      return { loader: "ts", contents };
    });
    build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
  } }] });
if (!bundle.success) {
  console.error(bundle.logs.slice(0, 12).map(log => log.message).join("\n"));
  throw new Error(`Actual inspection-panel browser fixture build failed (${bundle.logs.length} diagnostics)`);
}
for (const required of ["DataInspectionDialog.tsx", "related-data-panels.tsx", "locus-notifications.tsx", "value-card.tsx"]) {
  if (!compiled.some(file => file.path.endsWith("/" + required))) throw new Error("Real boundary was not compiled: " + required);
}
if (readerContextInputs.length !== 1) throw new Error("Actual reader context was not acquired exactly once");
const scriptReceipt = await writeArtifact("panel-boundary.js", bundle.outputs[0]);
await writeArtifact("panel-boundary-assertions.mjs", Bun.file(source("data-inspection-panels.node-fixture.mjs")));
const css = (await Promise.all(["src/global.css", "src/lib/data-inspection-dialog.css", "src/lib/locus-notifications.css", "src/lib/locus-context-menu.css"]
  .map(path => Bun.file(resolve(frontend, path)).text()))).join("\n");
const cssReceipt = await writeArtifact("panel-boundary.css", css + "\nbody { padding: 24px; } [data-fixture-marker] { padding: 12px; } [data-fixture-marker] input { display: block; margin: 8px 0; }\n");
await writeArtifact("panel-boundary.html", '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./panel-boundary.css"></head><body><p>Actual inspection controls · controlled acquisition or recorded checker replies</p><div id="fixture"></div><script type="module" src="./panel-boundary.js"></script></body></html>');
await writeArtifact("panel-boundary-provenance.json", JSON.stringify({
  scope: "Actual Solid 2 development DOM components; missing declaration or optional recorded checker reply; exact production reader-context source slice; no reader initialization, engine registry initialization, live policy verdict, expression preparation, or ordinary Data/Expression renderer coverage",
  compiled: compiled.sort((a, b) => a.path.localeCompare(b.path)),
  engineInputs: engineInputs.sort((a, b) => a.path.localeCompare(b.path)),
  artifacts: { script: scriptReceipt, css: cssReceipt },
  replayTransport: "Import-free engine-body-value-transport; exact captured input and UI operation window; reuse:false remains uncached checker provenance, not a timing claim",
  actualComponentExports: ["value-card.tsx:CardLoadingIndicator"],
  actualSourceSlices: readerContextInputs,
  throwingDependencies: [...stubs.keys()].filter(path => path !== "./expression-runner/authoring-catalog-worker" && path !== "./value-card")
    .concat("./value-card:ValueCard", "./value-card:ValueCardCaption", "./value-card:ValueTypeCaption",
      "./value-card:valueCardLabel", "./value-card:valueCardTypeLabel", "./value-card:RowPending",
      "./layout-renderer/TypedReadValue:typedReadTypePresentation", "template-surface-policy",
      [...valueCardUnreachable.keys()].map(path => `value-card.tsx:${path}`),
      [...relatedPanelUnreachable.keys()].map(path => `related-data-panels.tsx:${path}`)),
  controlledDependencies: ["./expression-runner/authoring-catalog-worker: exact recorded batch replay only; snapshot validates its reader and preparation always throws"],
}, null, 2));
console.log(`Built actual inspection-control fixture at ${resolve(output, "panel-boundary.js")}`);
