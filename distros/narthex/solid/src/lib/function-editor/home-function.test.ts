import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("Home's canonical function modal preserves its signature and body (isolated Chromium)", async () => {
  const started = performance.now();
  const repository = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const sourceRoot = join(repository, "distros/narthex/solid/src");
  const directory = resolve(repository, process.env["FENEL_HOME_FUNCTION_OUTPUT"] ?? ".tmp-diag/gp29-20260930");
  await mkdir(directory, { recursive: true });
  const baseline = process.env["FENEL_HOME_FUNCTION_BASELINE"] === "1";
  const legacyParser = process.env["FENEL_PARSER_LEGACY"] === "1";
  const priorComponents = new Map<string, string>();
  if (baseline) for (const path of ["lib/type-builder/TypeBuilder.tsx", "lib/field-occurrence/FieldOccurrenceEditorBase.tsx", "lib/expression-runner/structural-surfaces.tsx"]) {
    const child = Bun.spawn(["git", "show", `HEAD:distros/narthex/solid/src/${path}`], { cwd: repository, stdout: "pipe", stderr: "pipe" });
    const source = await new Response(child.stdout).text();
    if (await child.exited) throw new Error(await new Response(child.stderr).text());
    priorComponents.set(join(sourceRoot, path).replaceAll("\\", "/"), source);
  }
  for (const [flag, path] of [
    ["FENEL_HOME_FIELD_CONTEXT_SOURCE", "lib/field-occurrence/context.tsx"],
    ["FENEL_HOME_FIELD_EDITOR_SOURCE", "lib/field-occurrence/FieldOccurrenceEditorBase.tsx"],
  ] as const) {
    const frozen = process.env[flag];
    if (frozen) priorComponents.set(join(sourceRoot, path).replaceAll("\\", "/"), await Bun.file(frozen).text());
  }
  const homeSource = await Bun.file(process.env["FENEL_HOME_FUNCTION_SOURCE"] ?? (baseline ? join(directory, "baseline-home.tsx") : join(sourceRoot, "routes/app/home.tsx"))).text();
  const start = homeSource.indexOf("function NewFunctionModal(");
  const end = homeSource.indexOf("/** Insert `child`", start);
  if (start < 0 || end < 0) throw new Error("Could not find canonical Home function modal");
  let modal = homeSource.slice(start, end);
  const constantsStart = homeSource.lastIndexOf("const FN_", start);
  const oldTypesStart = homeSource.lastIndexOf("const FN_RETURN_TYPES", start);
  const constants = homeSource.slice(oldTypesStart >= 0 ? oldTypesStart : constantsStart, start);
  const bodyStart = homeSource.indexOf("  const functionBodyExpr = createMemo");
  const bodyProjection = homeSource.slice(bodyStart, homeSource.indexOf("  const [bodyDraft", bodyStart));
  // Home's actual definition-save selection (useHomeReader). The fixture keeps
  // only the reader IO it calls; older Home sources without it splice nothing.
  const saveStart = homeSource.indexOf("    saveDefinitionWithRepresentations: async (");
  const saveSelection = saveStart < 0 ? "" : homeSource.slice(saveStart, homeSource.indexOf("    addToLocus:", saveStart));
  const modern = modal.includes('const [resultMode, setResultMode]');
  const legacyReturn = modal.includes('returnsTag') ? '{ $ref: returnsTag() }' : 'returnsType()';
  const controls = `\n  controls = {
    snapshot: () => ({ id: ${modern ? 'functionId()' : 'fnName()'}, codeName: fnName(), params: snapshot(paramFields()), returns: snapshot(${modern ? 'resultType()' : legacyReturn}), explicitReturns: snapshot(${legacyReturn}), body: snapshot(body()), hasBody: hasBody(), requires: ${modal.includes('const [requires') ? 'snapshot(requires())' : '[]'},
      ${modern ? 'resultMode: resultMode(), ownedScheme: snapshot(ownedScheme()), declaration: snapshot(declaration()), preview: snapshot(functionPreview()), editorLens: editorLens(), facets: snapshot(fieldFacets()), error: saveError(), saving: saving(),' : ''}
      logic: (() => { try { return toLogic(body(), undefined, newFunctionAuthoringSession()); } catch { return undefined; } })() }),
    params: setParamsType, returns: ${modern ? '(value) => { setResultMode("explicit"); setReturnsType(value); }' : modal.includes('returnsTag') ? '(value) => setReturnsTag("$ref" in value ? String(value.$ref) : "String")' : 'setReturnsType'},
    body: (value) => { bodyEdited = true; setBody(value); }, reps: setReps,
    requires: ${modal.includes('const [requires') ? 'setRequires' : '() => {}'}, hasBody: setHasBody,
    ${modern ? 'resultMode: setResultMode, ownedScheme: installOwnedScheme, guardParams: guardParameterFields, facets: setFieldFacets,' : ''}
    ${modal.includes('const changeFieldFacet =') ? 'authorFacet: changeFieldFacet,' : ''}
    ${modal.includes('function guardReturnType') ? 'editReturn: next => { if (!guardReturnType(next)) return false; changeReturnType(next); return true; },' : ''}
  };\n`;
  const typeStart = homeSource.indexOf("function NewTypeModal(");
  let typeModal = homeSource.slice(typeStart, homeSource.lastIndexOf("// ---------------------------------------------------------------------------", constantsStart));
  const genericType = typeModal.includes('const [typeParams') || typeModal.includes('const typeParams = draft.typeParams');
  const typeControls = `\n  typeControls = {
    snapshot: () => ({ id: typeId(), shape: snapshot(typeShape()), reps: snapshot(reps()), facets: snapshot(fieldFacets()), error: saveError(), saving: saving(), ${genericType ? 'params: snapshot(typeParams()), scheme: snapshot(typeScheme()), editorLens: editorLens(),' : ''} }),
    shape: setTypeShape, reps: setReps, facets: setFieldFacets, ${genericType ? 'scheme: installTypeScheme, params: setTypeParams,' : ''}
    ${/const changeFieldFacet =|\{ changeFieldFacet,/.test(typeModal) ? 'authorFacet: changeFieldFacet,' : ''}
    ${/function guardTypeShape|guardTypeShape, changeTypeShape \} = draft/.test(typeModal) ? 'editShape: next => { if (!guardTypeShape(next)) return false; changeTypeShape(next); return true; },' : ''}
  };\n`;
  const typeReturnIndex = typeModal.lastIndexOf("\n  return (");
  if (typeStart < 0 || typeReturnIndex < 0) throw new Error("Could not find canonical Home type modal");
  typeModal = typeModal.slice(0, typeReturnIndex) + typeControls + typeModal.slice(typeReturnIndex);
  // Home's shared composer helpers that the type modal renders (its identity
  // row, icon picker and representations dialog, and the draft writers they
  // call), spliced verbatim from their run before `knownTypeIconName`. Older
  // Home sources without the identity row splice nothing.
  const composerHelpersStart = homeSource.indexOf("function isBlankRepresentationValue(");
  const composerHelpersEnd = homeSource.indexOf("function knownTypeIconName(", composerHelpersStart);
  const iconOptionsStart = homeSource.indexOf("const NEW_VALUE_ICON_OPTIONS =");
  const composerHelpers = typeModal.includes("<ComposerIdentityRow") && composerHelpersStart >= 0 && composerHelpersEnd >= 0 && iconOptionsStart >= 0
    ? `${homeSource.slice(iconOptionsStart, homeSource.indexOf(";", iconOptionsStart) + 1)}\n${homeSource.slice(composerHelpersStart, composerHelpersEnd)}`
    : "";
  const returnIndex = modal.lastIndexOf("\n  return (");
  modal = modal.slice(0, returnIndex) + controls + modal.slice(returnIndex);
  console.log("Home function fixture: canonical modal source extracted");
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  console.log("Home function fixture: loading Solid compiler");
  const compiler = await import(pathToFileURL(compilerPath).href);
  console.log("Home function fixture: building browser bundle");
  const browser = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./home-function.browser-fixture.tsx", import.meta.url))],
    target: "browser", conditions: ["browser", "development"], minify: true,
    plugins: [{ name: "canonical-home-function", setup(build) {
      build.onResolve({ filter: /(?:routes\/app\/home|workspace-authoring-provider)$/ }, args => {
        if (args.kind !== "dynamic-import") throw new Error(`The modal fixture eagerly loads Home: ${args.path}`);
        return { path: args.path, external: true };
      });
      build.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
      build.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "source-text" }));
      build.onLoad({ filter: /.*/, namespace: "source-text" }, async args => ({ loader: "js", contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};` }));
      build.onLoad({ filter: /(?:^|[\\/])parse-cache\.ts$/ }, async args => ({ loader: "ts",
        contents: await Bun.file(args.path).text() + (legacyParser
          ? "\nsetFenelParserLegacy(true); globalThis.homeFunctionParserControl = () => ({ legacy: fenelParserLegacy(), counts: parseProvenanceCounts() });\n" : "") }));
      build.onLoad({ filter: /\.tsx$/ }, async args => {
        const editorSource = process.env["FENEL_HOME_FUNCTION_EDITOR_SOURCE"];
        let source = priorComponents.get(args.path.replaceAll("\\", "/")) ?? await Bun.file(editorSource && args.path.replaceAll("\\", "/").endsWith("/expression-runner/index.tsx")
          ? editorSource : args.path).text();
        if (args.path.endsWith("home-function.browser-fixture.tsx")) source = source
          .replace(/declare const NewFunctionModal:[^\n]+;/, constants + modal)
          .replace(/declare const NewTypeModal:[^\n]+;/, () => composerHelpers + typeModal)
          .replace("/* ACTUAL_FUNCTION_BODY_PROJECTION */", bodyProjection)
          .replace("/* ACTUAL_HOME_DEFINITION_SAVE */", () => saveSelection);
        return { loader: "ts", contents: (await compiler.transformAsync(source, { filename: args.path, generate: "dom", hydratable: false, dev: true })).code };
      });
      build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }],
  });
  if (!browser.success) throw new AggregateError(browser.logs, "Home function fixture build failed");
  console.log("Home function fixture: browser bundle built");
  const browserPath = join(directory, baseline ? "before-browser.js" : "after-browser.js");
  const browserBytes = new Uint8Array(await browser.outputs.find(output => output.kind === "entry-point")!.arrayBuffer());
  const { writeVerifiedArtifact } = await import(pathToFileURL(join(repository, "scripts/lib/verified-artifact-io.mjs")).href);
  const browserReceipt = await writeVerifiedArtifact(browserPath, browserBytes);
  console.log(`Home function fixture: browser artifact written and verified ${JSON.stringify(browserReceipt)}`);
  const cssPath = join(directory, "styles.css");
  const css = await Promise.all(["global.css", "routes/app.css", "lib/admin-form/admin-form.css", "lib/home-entry.css", "lib/type-builder/type-builder.css", "lib/expression-runner/type-contract.css", "lib/locus-select.css", "lib/variant-value/variant-value-editor.css", "lib/expression-builder/set-expr-editor.css", "lib/expression-runner/authoring-guidance.css", "routes/app/function-editor.css", "lib/expression-runner/structural-surfaces.css", "lib/function-editor/generic-parameters-editor.css"]
    .map(async path => { const file = Bun.file(join(sourceRoot, path)); return await file.exists() ? file.text() : ""; }));
  await writeVerifiedArtifact(cssPath, new TextEncoder().encode(css.join("\n")));
  const runner = fileURLToPath(new URL("./home-function.browser-smoke.mjs", import.meta.url));
  const executable = await Bun.file(runner).text();
  const nodePath = join(directory, "runner.mjs");
  const driverLoad = 'createRequire(import.meta.url)(process.env.FENEL_TEST_PLAYWRIGHT_MODULE ?? "playwright")';
  if (executable.split(driverLoad).length !== 2) throw new Error("Expected one Home smoke Playwright driver load");
  await writeVerifiedArtifact(nodePath, new TextEncoder().encode(executable.replace(driverLoad,
    `createRequire(import.meta.url)(process.env.FENEL_TEST_PLAYWRIGHT_MODULE ?? ${JSON.stringify(createRequire(import.meta.url).resolve("playwright"))})`)));
  console.log(`Home function browser fixture: ${legacyParser ? "explicit legacy parser" : "default parser"}`);
  if (process.env["FENEL_HOME_FUNCTION_BUILD_ONLY"] === "1") return;
  const { runCommand } = await import(pathToFileURL(join(repository, "scripts/run-verification.mjs")).href);
  const childOutput = await mkdtemp(join(directory, "owned-browser-"));
  const logPath = join(childOutput, "stderr.log"), stdoutLogPath = join(childOutput, "stdout.log");
  // Reserve the existing supervisor's 20s cleanup bound plus 5s for reporting.
  const timeoutMs = Math.floor(Math.min(180_000, 240_000 - (performance.now() - started) - 25_000));
  if (timeoutMs < 1) throw new Error("Home fixture preparation left no time for owned browser cleanup");
  const result = await runCommand({ id: "home-function-browser", kind: "check", executable: "node", args: [nodePath, browserPath, cssPath], timeoutMs }, {
    root: repository, temp: directory, logPath, stdoutLogPath,
    startup: { timeoutMs: Math.min(45_000, timeoutMs), marker: "__FENEL_FIXTURE_DRIVER_READY__\n" },
    environment: { ...process.env, TEMP: directory, TMP: directory, FENEL_TEST_READY_FD: "3" },
  });
  const stdout = await Bun.file(stdoutLogPath).text(), stderr = await Bun.file(logPath).text();
  if (stdout) console.log(stdout); if (stderr) console.error(stderr);
  expect(result.passed, JSON.stringify(result)).toBe(true);
  expect(result.exitCode).toBe(0);
}, 240_000);
