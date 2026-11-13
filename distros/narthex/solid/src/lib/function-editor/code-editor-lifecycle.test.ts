import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("CodeMirror and the actual function Code lens preserve owned drafts and route-save refusals", async () => {
  const started = performance.now();
  const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const sourceRoot = join(root, "distros/narthex/solid/src");
  const legacyParser = process.env["FENEL_PARSER_LEGACY"] === "1";
  const output = resolve(root, process.env["FENEL_FUNCTION_CODE_OUTPUT"] ?? ".tmp-diag/code-editor-lifecycle-20261013");
  await mkdir(output, { recursive: true });
  const canvasSource = await Bun.file(process.env["FENEL_FUNCTION_CODE_CANVAS_SOURCE"]
    ?? new URL("./FunctionCanvas.tsx", import.meta.url)).text();
  const routeSource = await Bun.file(process.env["FENEL_FUNCTION_CODE_ROUTE_SOURCE"]
    ?? new URL("../../routes/app/functions/[name]/index.tsx", import.meta.url)).text();
  const codeStart = canvasSource.indexOf("function FunctionCodeView() {");
  const codeEnd = canvasSource.indexOf("/**", codeStart);
  const saveStart = routeSource.indexOf("  function saveFingerprint()");
  const saveEnd = routeSource.indexOf("  const profilesData", saveStart);
  if (codeStart < 0 || codeEnd < 0 || saveStart < 0 || saveEnd < 0) throw new Error("Actual function Code/save source extraction failed");
  const codeSource = canvasSource.slice(codeStart, codeEnd);
  const saveSource = routeSource.slice(saveStart, saveEnd);
  console.log("Code fixture: extracted actual FunctionCodeView and route save closures");
  function replaceSource(source: string, marker: string, replacement: string) {
    const start = `// ${marker}_START`, end = `// ${marker}_END`;
    if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error(`Expected one ${marker} fixture boundary`);
    return source.slice(0, source.indexOf(start) + start.length) + "\n" + replacement + "\n" + source.slice(source.indexOf(end));
  }
  const { writeVerifiedArtifact } = await import(pathToFileURL(join(root, "scripts/lib/verified-artifact-io.mjs")).href);
  await writeVerifiedArtifact(join(output, "actual-code-source.tsx"), new TextEncoder().encode(codeSource));
  await writeVerifiedArtifact(join(output, "actual-save-source.ts"), new TextEncoder().encode(saveSource));
  const compiler = await import(pathToFileURL(Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))))).href);
  console.log("Code fixture: building actual component and route browser bundle");
  const bundle = await Bun.build({ entrypoints: [fileURLToPath(new URL("./code-editor-lifecycle.browser-fixture.tsx", import.meta.url))],
    target: "browser", conditions: ["browser", "development"], minify: true,
    plugins: [{ name: "actual-code-editor", setup(build) {
      build.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
      build.onResolve({ filter: /\?raw$/ }, args => ({ path: Bun.resolveSync(args.path.slice(0, -4), args.resolveDir), namespace: "source" }));
      build.onLoad({ filter: /.*/, namespace: "source" }, async args => ({ loader: "js", contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};` }));
      build.onLoad({ filter: /(?:^|[\\/])parse-cache\.ts$/ }, async args => ({ loader: "ts",
        contents: await Bun.file(args.path).text() + (legacyParser
          ? "\nsetFenelParserLegacy(true); globalThis.functionCodeParserControl = () => ({ legacy: fenelParserLegacy(), counts: parseProvenanceCounts() });\n" : "") }));
      build.onLoad({ filter: /\.tsx$/ }, async args => {
        let source = await Bun.file(args.path).text();
        if (args.path.replaceAll("\\", "/").endsWith("/code-editor-lifecycle.browser-fixture.tsx")) {
          source = replaceSource(source, "FUNCTION_CODE_SOURCE", codeSource);
          source = replaceSource(source, "FUNCTION_SAVE_SOURCE", saveSource);
        }
        return { loader: "ts", contents: (await compiler.transformAsync(source,
          { filename: args.path, generate: "dom", hydratable: false, dev: true })).code };
      });
      build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }],
  });
  if (!bundle.success) throw new AggregateError(bundle.logs, "Code editor fixture build failed");
  const script = join(output, "fixture.js");
  const receipt = await writeVerifiedArtifact(script,
    new Uint8Array(await bundle.outputs.find(entry => entry.kind === "entry-point")!.arrayBuffer()));
  console.log(`Code editor fixture verified ${JSON.stringify(receipt)}`);
  const cssPath = join(output, "styles.css");
  const cssOwners = ["global.css", "routes/app.css", "lib/admin-form/admin-form.css", "routes/app/function-editor.css"];
  await writeVerifiedArtifact(cssPath, new TextEncoder().encode((await Promise.all(cssOwners.map(path =>
    Bun.file(join(root, "distros/narthex/solid/src", path)).text()))).join("\n")));
  const runner = join(output, "runner.mjs");
  await writeVerifiedArtifact(runner, new TextEncoder().encode(`
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.FENEL_TEST_PLAYWRIGHT_MODULE ?? ${JSON.stringify(createRequire(import.meta.url).resolve("playwright"))});
if (process.env.FENEL_TEST_READY_FD === "3") writeSync(3, "__FENEL_FIXTURE_DRIVER_READY__\\n");
const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL, timeout: 30_000 });
try {
  const page = await browser.newPage();
  const redoKey = process.platform === "darwin" ? "Meta+Shift+z" : "Control+y";
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<main id="fixture"></main>' }));
  await page.goto("https://fenel.test/");
  await page.addStyleTag({ content: await readFile(process.argv[3], "utf8") });
  await page.addScriptTag({ content: await readFile(process.argv[2], "utf8"), type: "module" });
  await page.waitForFunction(() => !!globalThis.codeEditorLifecycle);
  if (process.env.FENEL_PARSER_LEGACY === "1") assert.equal(await page.evaluate(() => functionCodeParserControl().legacy), true);
  if (process.env.FENEL_FUNCTION_CODE_ONLY !== "1") {
  await page.evaluate(() => codeEditorLifecycle.mount());
  await page.locator(".full-code .cm-content").waitFor();
  assert.equal(await page.locator(".full-code .cm-content").textContent(), "1");
  assert.deepEqual((await page.evaluate(() => codeEditorLifecycle.state())).edits, []);
  await page.evaluate(() => codeEditorLifecycle.remember());
  assert.equal((await page.evaluate(() => codeEditorLifecycle.details())).readonly, true);
  await page.evaluate(() => codeEditorLifecycle.patch({ value: "2", readonly: false, wrap: true, height: "210px", placeholder: "Updated" }));
  await page.waitForFunction(() => codeEditorLifecycle.details().value === "2");
  assert.deepEqual(await page.evaluate(() => codeEditorLifecycle.details()),
    { sameView: true, sameInlineView: true, readonly: false, value: "2", inlineValue: "2" });
  assert.deepEqual((await page.evaluate(() => codeEditorLifecycle.state())).edits, []);
  assert.equal(await page.locator(".full-code .cm-editor").evaluate(element => getComputedStyle(element).minHeight), "210px");
  assert.equal(await page.locator(".full-code .cm-lineWrapping").count(), 1);
  assert.equal(await page.locator(".inline-code .cm-content").getAttribute("aria-placeholder"), "Updated");
  await page.locator(".full-code .cm-content").click();
  await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.insertText("3");
  await page.waitForFunction(() => codeEditorLifecycle.state().edits.includes("3"));
  assert.deepEqual((await page.evaluate(() => codeEditorLifecycle.state())).edits, ["3"]);
  await page.locator(".inline-code .cm-content").click();
  await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.insertText("6");
  await page.waitForFunction(() => codeEditorLifecycle.state().edits.includes("6"));
  assert.deepEqual((await page.evaluate(() => codeEditorLifecycle.state())).edits, ["3", "6"]);
  await page.evaluate(() => codeEditorLifecycle.patch({ readonly: true, value: "4" }));
  assert.deepEqual(await page.evaluate(() => codeEditorLifecycle.details()),
    { sameView: true, sameInlineView: true, readonly: true, value: "4", inlineValue: "4" });
  assert.deepEqual((await page.evaluate(() => codeEditorLifecycle.state())).edits, ["3", "6"]);
  await page.locator(".full-code .cm-content").click();
  await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.insertText("5");
  assert.equal((await page.evaluate(() => codeEditorLifecycle.details())).value, "4");
  assert.equal((await page.evaluate(() => codeEditorLifecycle.details())).sameView, true);
  assert.deepEqual((await page.evaluate(() => codeEditorLifecycle.state())).edits, ["3", "6"]);
  await page.locator(".inline-code .cm-content").click();
  await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.insertText("7");
  await page.waitForFunction(() => codeEditorLifecycle.state().edits.includes("7"));
  assert.deepEqual((await page.evaluate(() => codeEditorLifecycle.state())).edits, ["3", "6", "7"]);
  assert.equal((await page.evaluate(() => codeEditorLifecycle.details())).sameInlineView, true);
  const beforeHistoryEdits = (await page.evaluate(() => codeEditorLifecycle.state())).edits.length;
  await page.evaluate(() => codeEditorLifecycle.patch({ documentKey: "A", value: "10", readonly: false,
    wrap: false, height: "130px", placeholder: "Document A" }));
  let priorSource = "10";
  for (const [editor, value] of [["full", "11"], ["inline", "12"]]) {
    await page.locator("." + editor + "-code .cm-content").click();
    await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.insertText(value);
    // The caller echoing this edit must retain the current document's history.
    await page.evaluate(value => codeEditorLifecycle.patch({ value }), value);
    await page.keyboard.press("ControlOrMeta+z");
    assert.equal(await page.locator("." + editor + "-code .cm-content").textContent(), priorSource);
    await page.keyboard.press(redoKey);
    assert.equal(await page.locator("." + editor + "-code .cm-content").textContent(), value);
    priorSource = value;
  }
  assert.deepEqual((await page.evaluate(() => codeEditorLifecycle.state())).edits.slice(beforeHistoryEdits),
    ["11", "10", "11", "12", "11", "12"]);
  await page.evaluate(() => codeEditorLifecycle.patch({ documentKey: "B", value: "20", readonly: false,
    wrap: true, height: "230px", placeholder: "Document B" }));
  assert.deepEqual(await page.evaluate(() => codeEditorLifecycle.details()),
    { sameView: true, sameInlineView: true, readonly: false, value: "20", inlineValue: "20" });
  assert.equal(await page.locator(".full-code .cm-editor").evaluate(element => getComputedStyle(element).minHeight), "230px");
  assert.equal(await page.locator(".full-code .cm-lineWrapping").count(), 1);
  assert.equal(await page.locator(".inline-code .cm-content").getAttribute("aria-placeholder"), "Document B");
  for (const editor of ["full", "inline"]) {
    await page.locator("." + editor + "-code .cm-content").click();
    await page.keyboard.press("ControlOrMeta+z");
    assert.equal(await page.locator("." + editor + "-code .cm-content").textContent(), "20");
    await page.keyboard.press(redoKey);
    assert.equal(await page.locator("." + editor + "-code .cm-content").textContent(), "20");
  }
  assert.deepEqual((await page.evaluate(() => codeEditorLifecycle.state())).edits.slice(beforeHistoryEdits),
    ["11", "10", "11", "12", "11", "12"]);
  for (const [editor, value] of [["full", "21"], ["inline", "22"]]) {
    await page.locator("." + editor + "-code .cm-content").click();
    await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.insertText(value);
    await page.keyboard.press("ControlOrMeta+z");
    assert.equal(await page.locator("." + editor + "-code .cm-content").textContent(), "20");
  }
  // A new owner with identical source must also discard the prior owner's redo.
  await page.evaluate(() => codeEditorLifecycle.patch({ documentKey: "C", value: "20" }));
  for (const editor of ["full", "inline"]) {
    await page.locator("." + editor + "-code .cm-content").click();
    await page.keyboard.press(redoKey);
    assert.equal(await page.locator("." + editor + "-code .cm-content").textContent(), "20");
  }
  assert.deepEqual((await page.evaluate(() => codeEditorLifecycle.state())).edits.slice(beforeHistoryEdits),
    ["11", "10", "11", "12", "11", "12", "21", "20", "22", "20"]);
  assert.deepEqual(await page.evaluate(() => codeEditorLifecycle.details()),
    { sameView: true, sameInlineView: true, readonly: false, value: "20", inlineValue: "20" });
  await page.evaluate(() => codeEditorLifecycle.unmount());
  assert.equal((await page.evaluate(() => codeEditorLifecycle.state())).destroys, 2);
  assert.equal(await page.locator(".cm-editor").count(), 0);
  console.log("PASS actual full/inline CodeMirror user callbacks, silent external values/options, owner-scoped undo/redo, retained native views, readonly input and teardown under Solid 2 dev guards");
  }
  const baseline = process.env.FENEL_FUNCTION_CODE_BASELINE === "1";
  const functionCode = page.locator(".function-code-fixture .fe-code-view .cm-content");
  async function replaceFunctionText(text) {
    await functionCode.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(text);
    await page.evaluate(() => codeEditorLifecycle.functionSnapshot());
  }
  async function captureFunction(topic) {
    if (process.env.FENEL_FUNCTION_CODE_CAPTURE === "0") return;
    for (const [size, width, height] of [["desktop", 1100, 800], ["phone", 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => { getSelection()?.removeAllRanges(); window.scrollTo(0, 0); });
      await page.screenshot({ path: join(dirname(process.argv[2]), (baseline ? "before-" : "after-") + topic + "-" + size + ".png"), fullPage: true });
    }
    await page.setViewportSize({ width: 1100, height: 800 });
  }
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.evaluate(() => codeEditorLifecycle.mountFunction());
  await functionCode.waitFor();
  assert.equal(await functionCode.textContent(), "1");
  await replaceFunctionText("(");
  assert.equal(await functionCode.textContent(), "(");
  assert.equal((await page.evaluate(() => codeEditorLifecycle.functionSnapshot())).body, 1);
  await page.locator("[data-function-save]").click();
  await page.waitForFunction(() => !codeEditorLifecycle.functionSnapshot().saving);
  let functionState = await page.evaluate(() => codeEditorLifecycle.functionSnapshot());
  assert.equal(functionState.requests.length, baseline ? 1 : 0);
  assert.equal(functionState.body, 1);
  assert.equal(functionState.dirty, !baseline);
  if (baseline) {
    assert.equal(functionState.requests[0].ownerMutations[0].owner.definition.body, 1);
    assert.equal(functionState.error, null);
  } else {
    assert.ok(functionState.bodyEditIssue);
    assert.equal(functionState.error, functionState.bodyEditIssue);
  }
  await captureFunction("function-code-invalid-save");
  await page.locator("[data-function-lens='expression']").click();
  assert.equal(await functionCode.count(), 0);
  await page.locator("[data-function-lens='code']").click();
  await functionCode.waitFor();
  assert.equal(await functionCode.textContent(), baseline ? "1" : "(");
  await captureFunction("function-code-draft-roundtrip");
  console.log("PASS actual " + (baseline ? "pre-repair" : "current") + " FunctionCodeView and actual route Save: invalid-source "
    + (baseline ? "old-body write and lens draft loss reproduced" : "refusal and lens draft retention") + "; controlled API and current singleton store; "
    + (process.env.FENEL_PARSER_LEGACY === "1" ? "verified explicit legacy-parser fixture" : "default-parser fixture"));
  if (!baseline) {
    await replaceFunctionText("2");
    await page.keyboard.press("End");
    for (const text of ["2 ", "2  "]) {
      await page.keyboard.insertText(" ");
      functionState = await page.evaluate(() => codeEditorLifecycle.functionSnapshot());
      assert.equal(await functionCode.textContent(), text);
      assert.equal(functionState.sourceText, text);
      assert.equal(functionState.body, 2);
      assert.equal(functionState.bodyEditIssue, undefined);
    }
    await page.locator("[data-function-lens='expression']").click();
    await page.locator("[data-function-lens='code']").click();
    await functionCode.waitFor();
    assert.equal(await functionCode.textContent(), "2  ");
    await replaceFunctionText("7");
    await page.locator("[data-function-save]").click();
    await page.waitForFunction(() => !codeEditorLifecycle.functionSnapshot().saving);
    functionState = await page.evaluate(() => codeEditorLifecycle.functionSnapshot());
    assert.equal(functionState.requests.length, 1);
    assert.equal(functionState.requests[0].ownerMutations[0].owner.definition.body, 7);
    assert.equal(functionState.dirty, false);
    assert.equal(functionState.error, null);
    await page.evaluate(() => codeEditorLifecycle.loadFunction(20, "row-history-A"));
    await replaceFunctionText("21");
    await page.keyboard.press("ControlOrMeta+z");
    assert.equal(await functionCode.textContent(), "20");
    assert.equal((await page.evaluate(() => codeEditorLifecycle.functionSnapshot())).body, 20);
    await page.keyboard.press(redoKey);
    assert.equal(await functionCode.textContent(), "21");
    assert.equal((await page.evaluate(() => codeEditorLifecycle.functionSnapshot())).body, 21);
    await page.evaluate(() => codeEditorLifecycle.rememberFunctionView());
    await page.evaluate(() => codeEditorLifecycle.loadFunction(20, "row-history-B"));
    assert.equal((await page.evaluate(() => codeEditorLifecycle.functionDetails())).sameView, true);
    for (const key of ["ControlOrMeta+z", redoKey]) {
      await page.keyboard.press(key);
      assert.equal(await functionCode.textContent(), "20");
      assert.equal((await page.evaluate(() => codeEditorLifecycle.functionSnapshot())).body, 20);
    }
    await replaceFunctionText("22");
    await page.keyboard.press("ControlOrMeta+z");
    assert.equal(await functionCode.textContent(), "20");
    await page.evaluate(() => codeEditorLifecycle.loadFunction(20, "row-history-C"));
    await page.keyboard.press(redoKey);
    assert.equal(await functionCode.textContent(), "20");
    assert.equal((await page.evaluate(() => codeEditorLifecycle.functionDetails())).sameView, true);
    await replaceFunctionText("(");
    await page.evaluate(() => codeEditorLifecycle.selectFunctionStep(null));
    assert.ok((await page.evaluate(() => codeEditorLifecycle.functionSnapshot())).bodyEditIssue);
    await page.evaluate(() => codeEditorLifecycle.replaceFunctionBody(30));
    assert.equal(await functionCode.textContent(), "30");
    assert.equal((await page.evaluate(() => codeEditorLifecycle.functionSnapshot())).bodyEditIssue, undefined);
    await replaceFunctionText("31");
    await page.evaluate(() => codeEditorLifecycle.resetFunction());
    const resetText = await functionCode.textContent();
    assert.equal((await page.evaluate(() => codeEditorLifecycle.functionDetails())).sameView, true);
    assert.equal((await page.evaluate(() => codeEditorLifecycle.functionSnapshot())).bodyEditIssue, undefined);
    for (const key of ["ControlOrMeta+z", redoKey]) {
      await page.keyboard.press(key);
      assert.equal(await functionCode.textContent(), resetText);
    }
    console.log("PASS actual whole-function Code character drafts, lens remount, actual-route recovery, same-owner Undo/Redo, retained-view load/equal-text/reset isolation, selection preservation and external-body discard");
  }
  await page.evaluate(() => codeEditorLifecycle.unmount());
  assert.equal(await page.locator(".cm-editor").count(), 0);
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
`));
  if (process.env["FENEL_FUNCTION_CODE_BUILD_ONLY"] === "1") return;
  const { runCommand } = await import(pathToFileURL(join(root, "scripts/run-verification.mjs")).href);
  const childOutput = await mkdtemp(join(output, "owned-browser-"));
  const logPath = join(childOutput, "stderr.log"), stdoutLogPath = join(childOutput, "stdout.log");
  const timeoutMs = Math.floor(Math.min(180_000, 240_000 - (performance.now() - started) - 25_000));
  if (timeoutMs < 1) throw new Error("Code fixture preparation left no time for owned browser cleanup");
  const result = await runCommand({ id: "function-code-lifecycle-browser", kind: "check", executable: "node",
    args: [runner, script, cssPath], timeoutMs }, {
    root, temp: output, logPath, stdoutLogPath,
    startup: { timeoutMs: Math.min(45_000, timeoutMs), marker: "__FENEL_FIXTURE_DRIVER_READY__\n" },
    environment: { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1", TEMP: output, TMP: output, FENEL_TEST_READY_FD: "3" },
  });
  const stdout = await Bun.file(stdoutLogPath).text(), stderr = await Bun.file(logPath).text();
  if (stdout) console.log(stdout); if (stderr) console.error(stderr);
  expect(result.passed, JSON.stringify(result)).toBe(true);
  expect(result.exitCode).toBe(0);
}, 240_000);
