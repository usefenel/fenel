import { expect, test } from "bun:test";
import * as ts from "typescript";
import { mkdir, mkdtemp } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

test("saved Home definitions preserve ingress modes and scoped metadata (isolated Chromium)", async () => {
  const started = performance.now();
  const trace = (stage: string, details?: unknown) => {
    if (process.env.FENEL_SAVED_EDITOR_TRACE === "1") console.log("Saved editor fixture trace", JSON.stringify({ stage, elapsedMs: Math.round(performance.now() - started), details }));
  };
  trace("test:start");
  const repository = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const sourceRoot = join(repository, "distros/narthex/solid/src");
  const output = resolve(repository, process.env.FENEL_SAVED_EDITOR_OUTPUT ?? ".tmp-diag/saved-definition-editor-20261013");
  const phoneCapsule = process.env.FENEL_SAVED_EDITOR_PHONE_PICKER === "1";
  const phoneStage = process.env.FENEL_SAVED_EDITOR_PHONE_STAGE;
  if (phoneCapsule && phoneStage !== "before" && phoneStage !== "after") throw Error("Phone capsule requires an explicit before/after stage");
  if (phoneCapsule && ["FENEL_SAVED_EDITOR_PENDING", "FENEL_SAVED_EDITOR_UNCERTAIN", "FENEL_SAVED_EDITOR_TYPE_LIFETIME", "FENEL_SAVED_EDITOR_INSERT"].some(flag => process.env[flag] === "1")) {
    throw Error("Phone visual capture cannot share another fixture scenario");
  }
  if (phoneCapsule) for (const file of ["phone-capsule.json", "before-browser.js", "after-browser.js", "styles.css", "runner.mjs"]) {
    if (await Bun.file(join(output, file)).exists()) throw Error(`Refusing to overwrite frozen Phone artifact: ${file}`);
  }
  await mkdir(output, { recursive: true });
  const captured = new Map<string, string>();
  const sourcePathWithinRepository = (path: string) => {
    const name = relative(repository, path).replaceAll("\\", "/");
    return name && !name.startsWith("../") && !isAbsolute(name) && !name.split("/").includes("node_modules") ? name : undefined;
  };
  const readSource = async (path: string) => {
    const body = await Bun.file(path).text();
    const name = sourcePathWithinRepository(path);
    if (phoneCapsule && name) captured.set(name, body);
    return body;
  };
  trace("artifact-writer.acquire:start");
  const { writeVerifiedArtifact } = await import(pathToFileURL(join(repository, "scripts/lib/verified-artifact-io.mjs")).href);
  trace("artifact-writer.acquire:done");
  const encoder = new TextEncoder();
  const sourcePath = process.env.FENEL_SAVED_EDITOR_SOURCE ?? join(sourceRoot, "routes/app/home.tsx");
  trace("source.home.read:start", { path: sourcePath });
  const source = (await readSource(sourcePath)).replace(/\r\n?/g, "\n");
  trace("source.home.read:done", { characters: source.length });
  const start = source.indexOf("function EditModalContent(");
  const end = source.indexOf("// ---------------------------------------------------------------------------\n// NewValueModal", start);
  if (start < 0 || end < 0) throw Error("Missing actual saved editor source");
  let component = source.slice(start, end);
  const valueStart = source.indexOf("function NewValueModal(");
  const valueEnd = source.indexOf("// ---------------------------------------------------------------------------\n// NewTypeModal", valueStart);
  let valueComponent = source.slice(valueStart, valueEnd);
  const valueHelpers = source.slice(source.indexOf('type NewValueKind ='), source.indexOf("function knownTypeIconName("))
    + source.slice(source.indexOf("function QuickTypeIcon("), source.indexOf("type CreationDestination ="));
  const valueReturn = valueComponent.lastIndexOf("\n  return (");
  valueComponent = valueComponent.slice(0, valueReturn)
    + `\n  valueControls = { snapshot: () => ({ draft: snapshot(draft()), reps: snapshot(reps()), error: saveError(), saving: saving(),
      typeName: chosenType(), valueType: snapshot(chosenValueType()), expectedType: snapshot(expectedType()),
      typeLabel: declaredTypeLabel(), typeStep: composerStep(), pickingType: pickingType() }), save, updateDraft,
      openTypePicker: () => { showTypeStep(); ${valueComponent.includes("function setTypePickerOpen(") ? "setTypePickerOpen" : "setPickingType"}(true); },
      ${valueComponent.includes("const captureRichTypeTarget:") ? "captureTypeTarget: captureRichTypeTarget," : ""}
    };\n`
    + valueComponent.slice(valueReturn);
  const modern = component.includes("functionResultMode");
  const controls = `\n  controls = { snapshot: () => ({ body: snapshot(bodyDraft()), arrow: snapshot(arrowDraft()), error: saveError(), conflict: sourceConflict(),
    ${modern ? 'mode: functionResultMode(), scheme: snapshot(functionOwnedScheme()), declaration: snapshot(functionDeclaration()), result: snapshot(functionResultType()), requirements: snapshot(functionRequirements()), typeParams: snapshot(typeParamsDraft()), typeScheme: snapshot(typeOwnedScheme()),' : ''}
    type: snapshot(typeDraft()), facets: snapshot(fieldFacets()) }), body: setBodyDraft, facets: setFieldFacets, save,
    shape: next => { ${modern ? 'if (guardSavedTypeShape(next)) changeSavedTypeShape(next);' : 'setTypeDraft(next); setTypeDraftDirty(true);'} },
    ${modern ? 'mode: next => { setFunctionResultMode(next); setFunctionSignatureDirty(true); }, genericIssue: setFunctionGenericIssue, parameters: guardFunctionFields, result: type => { if (guardFunctionResult(type)) changeFunctionResult(type); },' : 'mode: () => {}, genericIssue: () => {}, parameters: () => false, result: () => {},'}
  };\n`;
  const at = component.lastIndexOf("\n  return (");
  component = component.slice(0, at) + controls + component.slice(at);
  const helperStart = source.indexOf("type FunctionDefinitionRow =");
  const helpers = source.slice(helperStart, source.indexOf("function inspectionFunctionEntry(", helperStart));
  const dedicatedType = process.env.FENEL_SAVED_EDITOR_TYPE_LIFETIME === "1";
  let dedicatedComponent = "";
  let dedicatedBefore = false;
  if (dedicatedType) {
    const detailPath = process.env.FENEL_SAVED_EDITOR_TYPE_SOURCE ?? join(sourceRoot, "routes/app/types/[id]/index.tsx");
    trace("source.type.read:start", { path: detailPath });
    const detail = (await readSource(detailPath)).replace(/\r\n?/g, "\n");
    trace("source.type.read:done", { characters: detail.length });
    const section = (start: string, end: string) => {
      const first = detail.indexOf(start), last = detail.indexOf(end, first);
      if (first < 0 || last <= first) throw Error(`Missing actual Type detail boundary: ${start}`);
      return detail.slice(first, last);
    };
    dedicatedComponent = section("function productFieldLabel(", "function cellValue(")
      + section("function ConfirmModal(", "/** Per-relation CRUD callbacks.")
      + section("async function instanceRefResolver(", "function accountFieldFacetDrafts(")
      + section("function accountFieldFacetDrafts(", "function UserTypeValueRow(")
      + section("function UserTypeValueRow(", "function UserDefinedTypeDetail(").replace(/export\s*$/, "")
      + section("function UserDefinedTypeDetail(", "export default function TypeDetailPage(");
    dedicatedBefore = !dedicatedComponent.includes("let saveInFlight = false");
  }
  // Exact Home support declarations accompany the spliced component. Keep their
  // implementation in Home; never replace a missing runtime binding with a stub.
  const parsedHome = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const supportNames = ["splitLoweredFunctionDraft", "createLocalSignatureGuard", "parameterTextEdit",
    "LOCAL_SAVE_TOOLS_PENDING", "LOCAL_SAVE_CHANGED", "LOCAL_SAVE_DRAFT_CHANGED", "LOCAL_SAVE_UNCHECKABLE",
    "localExpressionSaveIssue", "localSaveIssueOptions", "localWorkerSaveIssue", "ValueFailure",
    "updateItemInView", "findLocusItem"];
  const support = supportNames.map(name => {
    const matches = parsedHome.statements.filter(statement =>
      ts.isFunctionDeclaration(statement) ? statement.name?.text === name
        : ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
          ts.isIdentifier(declaration.name) && declaration.name.text === name));
    if (matches.length !== 1) throw Error(`Missing or ambiguous captured Home declaration: ${name}`);
    return matches[0]!.getText(parsedHome);
  }).join("\n");
  const assembleFixture = (body: string) => body
    .replace(/declare const PhoneVisualNodeEditor:[^\n]+;/, phoneCapsule
      ? 'import { PhoneVisualNodeEditor } from "../expression-runner";'
      : 'const PhoneVisualNodeEditor = () => { throw Error("Enable the Phone visual capsule first"); };')
    .replace(/declare const EditModalContent:[^\n]+;/, support + "\n" + helpers + component)
    .replace(/declare const NewValueModal:[^\n]+;/, valueHelpers + valueComponent)
    .replace(/declare const UserDefinedTypeDetail:[^\n]+;/, dedicatedComponent
      || 'const UserDefinedTypeDetail = () => { throw Error("Enable the existing dedicated Type fixture mode first"); };');
  const fixturePath = fileURLToPath(new URL("./saved-definition.browser-fixture.tsx", import.meta.url));
  const assembledFixture = assembleFixture(await readSource(fixturePath));
  // Cheap pre-bundle binding check, delegated to TypeScript. Imports remain local
  // binding declarations: no dependency graph or product semantic check is run.
  const options: ts.CompilerOptions = { noEmit: true, types: [], skipLibCheck: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve };
  const host = ts.createCompilerHost(options);
  host.resolveModuleNames = names => names.map(() => undefined);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    resolve(fileName) === resolve(fixturePath)
      ? ts.createSourceFile(fileName, assembledFixture, languageVersion, true, ts.ScriptKind.TSX)
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fixturePath], options, host);
  const assembled = program.getSourceFile(fixturePath)!;
  const syntax = program.getSyntacticDiagnostics(assembled);
  if (syntax.length) throw Error(ts.formatDiagnosticsWithColorAndContext(syntax, {
    getCanonicalFileName: path => path, getCurrentDirectory: () => repository, getNewLine: () => "\n" }));
  const runtimeNameError = (diagnostic: ts.Diagnostic) => {
    if (![2304, 2552, 18004, 2693, 1361].includes(diagnostic.code) || diagnostic.start === undefined) return false;
    let found: ts.Node = assembled;
    const locate = (node: ts.Node) => {
      if (node.getStart(assembled) <= diagnostic.start! && diagnostic.start! < node.end) {
        found = node; ts.forEachChild(node, locate);
      }
    };
    locate(assembled);
    for (let node: ts.Node | undefined = found; node && node !== assembled; node = node.parent) {
      if (ts.isTypeNode(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)
        || ts.isImportDeclaration(node)) return false;
    }
    return true;
  };
  const missing = program.getSemanticDiagnostics(assembled).filter(runtimeNameError);
  if (missing.length) throw Error("Unbound assembled fixture runtime names before bundle:\n"
    + ts.formatDiagnosticsWithColorAndContext(missing, {
      getCanonicalFileName: path => path, getCurrentDirectory: () => repository, getNewLine: () => "\n" }));
  trace("fixture.runtime-bindings:passed", { supportNames });
  if (process.env.FENEL_SAVED_EDITOR_BINDINGS_ONLY === "1") {
    console.log("PASS saved editor assembled runtime bindings (no bundle or browser)"); return;
  }
  trace("compiler.resolve:start");
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  trace("compiler.resolve:done", { path: compilerPath });
  trace("compiler.import:start");
  const compiler = await import(pathToFileURL(compilerPath).href);
  trace("compiler.import:done");
  trace("build:start");
  const result = await Bun.build({ entrypoints: [fileURLToPath(new URL("./saved-definition.browser-fixture.tsx", import.meta.url))], target: "browser",
    conditions: ["browser", "development"], minify: true, plugins: [{ name: "saved-definition-production", setup(build) {
      build.onResolve({ filter: /(?:routes\/app\/home|workspace-authoring-provider)$/ }, args => {
        if (args.kind !== "dynamic-import") throw Error("Fixture eagerly loads full Home");
        return { path: args.path, external: true };
      });
      build.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
      build.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "source" }));
      build.onLoad({ filter: /.*/, namespace: "source" }, async args => ({ loader: "js", contents: `export default ${JSON.stringify(await readSource(args.path))}` }));
      build.onLoad({ filter: /\.tsx$/ }, async args => {
        let body = await readSource(args.path);
        if (phoneCapsule && args.path.replaceAll("\\", "/").endsWith("/expression-runner/index.tsx")) {
          body += "\nexport { NodeEditor as PhoneVisualNodeEditor };\n";
        }
        if (args.path.endsWith("saved-definition.browser-fixture.tsx")) {
          if (assembleFixture(body) !== assembledFixture) throw Error("Fixture source changed after its binding check");
          body = assembledFixture;
        }
        return { loader: "ts", contents: (await compiler.transformAsync(body, { filename: args.path, generate: "dom", dev: true, hydratable: false })).code };
      });
      build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      build.onLoad({ filter: /\.(?:[cm]?[jt]s|json)$/ }, async args => {
        if (!phoneCapsule || !sourcePathWithinRepository(args.path)) return undefined;
        return { loader: args.path.endsWith(".json") ? "json" : /\.[cm]?ts$/.test(args.path) ? "ts" : "js", contents: await readSource(args.path) };
      });
    } }] });
  trace("build:done", { success: result.success, outputs: result.outputs.length });
  if (!result.success) throw new AggregateError(result.logs, "Saved editor fixture build failed");
  const bundle = join(output, phoneCapsule ? `${phoneStage}-browser.js` : modern ? "after-browser.js" : "before-browser.js");
  const entry = result.outputs.find(item => item.kind === "entry-point")!;
  trace("entry.arrayBuffer:start", { path: entry.path, bytes: entry.size });
  const browserBytes = new Uint8Array(await entry.arrayBuffer());
  trace("entry.arrayBuffer:done", { bytes: browserBytes.byteLength });
  trace("artifact.bundle.publish:start", { path: bundle });
  const browserReceipt = await writeVerifiedArtifact(bundle, browserBytes);
  trace("artifact.bundle.publish:done", browserReceipt);
  const css = join(output, "styles.css");
  trace("source.styles.read:start");
  const styles = (await Promise.all(["global.css", "routes/app.css", "lib/home-entry.css", "lib/type-builder/type-builder.css",
    "lib/locus-select.css", "lib/variant-value/variant-value-editor.css", "lib/expression-runner/authoring-guidance.css", "lib/expression-runner/type-contract.css",
    "lib/expression-runner/structural-surfaces.css", "lib/function-editor/generic-parameters-editor.css", "lib/admin-form/admin-form.css",
    ...(dedicatedType ? ["lib/data-table/data-table.css"] : [])].map(path => readSource(join(sourceRoot, path))))).join("\n");
  trace("source.styles.read:done", { characters: styles.length });
  trace("artifact.styles.publish:start", { path: css });
  const stylesReceipt = await writeVerifiedArtifact(css, encoder.encode(styles));
  trace("artifact.styles.publish:done", stylesReceipt);
  const runner = join(output, "runner.mjs");
  trace("source.runner.read:start");
  const runnerSource = await readSource(fileURLToPath(new URL("./saved-definition.browser-smoke.mjs", import.meta.url)));
  trace("source.runner.read:done", { characters: runnerSource.length });
  trace("artifact.runner.publish:start", { path: runner });
  const runnerBytes = encoder.encode(runnerSource
    .replace('?? "playwright"', `?? ${JSON.stringify(createRequire(import.meta.url).resolve("playwright"))}`));
  const runnerReceipt = await writeVerifiedArtifact(runner, runnerBytes);
  trace("artifact.runner.publish:done", runnerReceipt);
  if (phoneCapsule) {
    for (const path of [fileURLToPath(import.meta.url), join(repository, "package.json"), join(repository, "bun.lock")]) await readSource(path);
    const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    const sources: { path: string; bytes: number; sha256: string }[] = [];
    for (const [path, body] of [...captured].sort(([a], [b]) => a.localeCompare(b))) {
      const bytes = encoder.encode(body), destination = join(output, "sources", path);
      await mkdir(dirname(destination), { recursive: true }); await writeVerifiedArtifact(destination, bytes);
      sources.push({ path, bytes: bytes.length, sha256: digest(bytes) });
    }
    const harnessPaths = ["distros/narthex/solid/src/lib/function-editor/saved-definition.test.ts",
      "distros/narthex/solid/src/lib/function-editor/saved-definition.browser-fixture.tsx",
      "distros/narthex/solid/src/lib/function-editor/saved-definition.browser-smoke.mjs",
      "distros/narthex/solid/src/lib/type-builder/type-picker-owner.browser-fixture.ts"];
    const harness = harnessPaths.map(path => {
      const entry = sources.find(item => item.path === path);
      if (!entry) throw Error(`Phone capsule did not capture required source: ${path}`); return entry;
    });
    let matchedBefore: { path: string; sha256: string } | undefined;
    if (phoneStage === "after") {
      const supplied = process.env.FENEL_SAVED_EDITOR_PHONE_BEFORE;
      if (!supplied) throw Error("After Phone capsule requires the frozen before phone-capsule.json path");
      const beforePath = resolve(repository, supplied), beforeBytes = new Uint8Array(await Bun.file(beforePath).arrayBuffer());
      const before = JSON.parse(new TextDecoder().decode(beforeBytes));
      if (before.kind !== "home-expression-phone-visual-capsule" || before.stage !== "before") throw Error("Invalid before Phone capsule");
      for (const input of harness) if (!before.harness?.some((item: any) => item.path === input.path && item.sha256 === input.sha256)) {
        throw Error(`Before/after visual harness differs: ${input.path}`);
      }
      matchedBefore = { path: beforePath, sha256: digest(beforeBytes) };
    }
    const artifact = (path: string, bytes: Uint8Array) => ({ path, bytes: bytes.length, sha256: digest(bytes) });
    await writeVerifiedArtifact(join(output, "phone-capsule.json"), encoder.encode(JSON.stringify({
      kind: "home-expression-phone-visual-capsule", semanticAcceptance: false, stage: phoneStage,
      artifacts: { bundle: artifact(bundle, browserBytes), styles: artifact(css, encoder.encode(styles)), runner: artifact(runner, runnerBytes) },
      sourceHome: { path: sourcePath, sha256: digest(encoder.encode(source)) }, sources, harness, matchedBefore,
      testTransforms: ["Actual EditModalContent/NewValueModal and guarded Home support declarations spliced into existing fixture with observation controls",
        "Exact internal NodeEditor exported by the existing test bundler for the Phone visual mount only"],
      limits: ["Shared controlled Phone registry/presentation IO; actual Home and expression components.",
        "No Local, owner-provenance, membership, inference, Preview, Save, or persistence acceptance."],
    }, null, 2) + "\n"));
  }
  if (process.env.FENEL_SAVED_EDITOR_BUILD_ONLY === "1") { console.log(`PASS saved editor fixture built: ${bundle}`); return; }
  const { runCommand } = await import(pathToFileURL(join(repository, "scripts/run-verification.mjs")).href);
  const childOutput = await mkdtemp(join(output, "owned-browser-"));
  const logPath = join(childOutput, "stderr.log"), stdoutLogPath = join(childOutput, "stdout.log");
  // Charge preparation to the original 180s test budget and leave cleanup time.
  const timeoutMs = Math.floor(Math.min(180_000, 180_000 - (performance.now() - started) - 25_000));
  if (timeoutMs < 1) throw new Error("Saved editor preparation left no time for owned browser cleanup");
  const browserResult = await runCommand({ id: "saved-definition-browser", kind: "check", executable: "node", args: [runner, bundle, css], timeoutMs }, {
    root: repository, temp: output, logPath, stdoutLogPath,
    startup: { timeoutMs: Math.min(45_000, timeoutMs), marker: "__FENEL_FIXTURE_DRIVER_READY__\n" },
    environment: { ...process.env, TEMP: output, TMP: output, FENEL_TEST_READY_FD: "3",
      FENEL_SAVED_EDITOR_BEFORE: process.env.FENEL_SAVED_EDITOR_BEFORE ?? (dedicatedType ? dedicatedBefore ? "1" : "0" : modern ? "0" : "1") },
  });
  const stdout = await Bun.file(stdoutLogPath).text(), stderr = await Bun.file(logPath).text();
  if (!browserResult.passed || browserResult.exitCode) throw Error(`${JSON.stringify(browserResult)}\n${stdout}\n${stderr}`);
  console.log(stdout); expect(stdout).toContain("PASS");
}, 180_000);
