import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("actual URL Call controls keep nested epoch Loading inline during DOM clicks", async () => {
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  const scratch = join(packageRoot, ".tmp-diag", "address-preview-dom");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "run-"));
  const source = await Bun.file(new URL("../routes/app/home.tsx", import.meta.url)).text();
  const section = (startMarker: string, endMarker: string) => {
    const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
    if (start < 0 || end <= start) throw new Error(`Shared Call DOM boundary changed: ${startMarker}`);
    return source.slice(start, end);
  };
  const requests = section("  const [addressRunRequest, setAddressRunRequest]", "  let addressInitialized = false;");
  const previews = section("  const addressPreview = createAsyncValue(", "  const displayedResult = createMemo(");
  const editing = section("  function setArg(idx: number, expr: ExprNode)", "  // Modal header uses the human-readable Labelable.");
  const preparation = section("function EditorPreparation(", "function FunctionCallModal(");
  const controlsStart = source.indexOf("<Show when={validationDemo() || props.addressInputs && !isIO()}>");
  const controlsEnd = source.indexOf("</Show>", controlsStart) + "</Show>".length;
  if (controlsStart < 0 || controlsEnd <= controlsStart) throw new Error("Shared Call Run controls changed");
  const controls = source.slice(controlsStart, controlsEnd);
  const local = (path: string) => JSON.stringify(relative(directory, join(packageRoot, path)).replaceAll("\\", "/"));
  const virtual = `
    import { Errored, Loading, Show, createMemo, createSignal, latest, onCleanup, untrack } from "solid-js";
    import { render } from "@solidjs/web";
    import { createAsyncValue } from ${local("src/lib/async-value.ts")};
    import { ModalOverlay } from ${local("src/lib/confirm-modal/index.tsx")};
    const session = { fixture: "same-reader" }, accountScope = { fixture: "same-scope" };
    const jobs = [], errors = []; let mounts = 0, edit;
    const sessionEpoch = () => 7;
    const reader = { revision: () => 2 };
    const authoringSession = () => session;
    const concreteAuthoringSession = captured => captured;
    const authoringSessionAccountScope = captured => { if (captured !== session) throw new Error("Wrong reader"); return accountScope; };
    const cloneDraftValue = structuredClone;
    const savedCtx = { list: () => [] };
    const evaluateExpressionInWorker = (captured, node, saved, signal, scope) => {
      if (captured !== session || scope !== accountScope) throw new Error("The worker lost its reader");
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      jobs.push({ node, signal, resolve, reject }); return promise;
    };
    const evaluateAuthoringExpression = () => { throw new Error("Synchronous evaluation was reached"); };
    const fn = () => ({ id: "probe:upper" });
    const inputIssue = () => undefined;
    const isIO = () => false;
    const validationDemo = () => false;
    ${preparation}
    function Call(props) {
      mounts++;
      const [argExprs, setArgExprs] = createSignal([{ kind: "literal", value: "hello" }]);
      const [addressIssues, setAddressIssues] = createSignal([]);
      const callExpr = () => ({ kind: "call", fnId: "probe:upper", args: argExprs() });
      ${requests}
      ${previews}
      ${editing}
      edit = text => setArg(0, { kind: "literal", value: text });
      return <div data-call-form>
        ${controls}
        <span data-result>{evaluated()?.result}</span>
        <span data-error>{evaluated()?.error}</span>
      </div>;
    }
    const dispose = render(() => <Errored fallback={error => {
      errors.push(String(error())); return <div data-app-error>{String(error())}</div>;
    }}><Loading on={sessionEpoch()} fallback={<div data-app-loading>Loading App</div>}>
      <section data-lens><h1>Mounted lens</h1>
        <EditorPreparation label="Call Uppercase" onClose={() => {}}>
          <Call addressInputs={[{ name: "s", text: "hello" }]} />
        </EditorPreparation>
      </section>
    </Loading></Errored>, document.body);
    globalThis.addressPreviewDom = {
      state: () => ({ mounts, jobs: jobs.length, errors: [...errors], aborted: jobs.map(job => job.signal.aborted) }),
      complete: (index, value) => jobs[index].resolve({ result: value, trace: [] }),
      fail: (index, message) => jobs[index].reject(new Error(message)), edit: text => edit(text), dispose,
    };
  `;
  const runnerSource = `
    import { readFile } from "node:fs/promises";
    import { strict as assert } from "node:assert";
    import { chromium } from ${JSON.stringify(import.meta.resolve("playwright"))};
    const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
    try {
      const page = await browser.newPage(); page.setDefaultTimeout(10000);
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
      await page.goto("https://fenel.test/");
      await page.addScriptTag({ content: await readFile(process.argv[2], "utf8"), type: "module" });
      const button = page.getByRole("button", { name: "Run this call", exact: true });
      await button.waitFor();
      const mounted = async () => {
        assert.equal(await page.locator("[data-app-loading]").count(), 0);
        assert.equal(await page.locator("[data-lens]").count(), 1);
        assert.equal(await page.locator("[data-call-form]").count(), 1);
        assert.equal((await page.evaluate(() => addressPreviewDom.state())).mounts, 1);
        assert.deepEqual(errors, []);
      };
      await mounted();
      await button.click();
      await page.getByRole("button", { name: "Running…", exact: true }).waitFor();
      await mounted();
      assert.equal(await page.locator("[data-result]").innerText(), "");
      await page.evaluate(() => addressPreviewDom.complete(0, "HELLO"));
      await page.locator("[data-result]").filter({ hasText: "HELLO" }).waitFor();
      await mounted();
      await button.click();
      await page.getByRole("button", { name: "Running…", exact: true }).waitFor();
      await mounted(); assert.equal(await page.locator("[data-result]").innerText(), "");
      await page.evaluate(() => addressPreviewDom.fail(1, "worker refused call"));
      await page.locator("[data-error]").filter({ hasText: "worker refused call" }).waitFor();
      await mounted();
      await button.click();
      await page.getByRole("button", { name: "Running…", exact: true }).waitFor();
      await mounted(); assert.equal(await page.locator("[data-error]").innerText(), "");
      await page.evaluate(() => addressPreviewDom.edit("changed"));
      await button.waitFor(); await mounted();
      assert.equal((await page.evaluate(() => addressPreviewDom.state())).aborted[2], true);
      await page.evaluate(() => addressPreviewDom.complete(2, "obsolete"));
      await mounted(); assert.equal(await page.locator("[data-result]").innerText(), "");
      await button.click();
      await page.getByRole("button", { name: "Running…", exact: true }).waitFor();
      await mounted();
      await page.evaluate(() => addressPreviewDom.complete(3, "CHANGED"));
      await page.locator("[data-result]").filter({ hasText: "CHANGED" }).waitFor();
      await mounted();
      assert.deepEqual((await page.evaluate(() => addressPreviewDom.state())).errors, []);
      console.log(JSON.stringify({ fixture: "actual URL Call DOM", passed: true, state: await page.evaluate(() => addressPreviewDom.state()) }));
    } catch (error) { throw error; } finally { await browser.close(); }
  `;
  try {
    const virtualPath = join(directory, "fixture.tsx"); await Bun.write(virtualPath, virtual);
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const browser = await Bun.build({ entrypoints: [virtualPath], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "actual-call-preview-dom", setup(build) {
        build.onResolve({ filter: /^\.\/prompt-body$/ }, args => {
          if (args.kind !== "dynamic-import") throw new Error("The modal eagerly imported its prompt editor");
          return { path: args.path, external: true };
        });
        build.onResolve({ filter: /^@fenel\// }, args => { throw new Error(`The Call boundary eagerly imported an engine: ${args.path}`); });
        build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }] });
    if (!browser.success) throw new AggregateError(browser.logs, "Shared Call boundary build failed");
    const browserPath = join(directory, "browser.js"), runnerPath = join(directory, "runner.mjs");
    await Bun.write(browserPath, browser.outputs.find(output => output.kind === "entry-point")!);
    await Bun.write(runnerPath, runnerSource);
    const child = Bun.spawn(["node", runnerPath, browserPath], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exit !== 0) throw new Error(`Shared Call DOM fixture failed:\n${stdout}\n${stderr}`);
    expect(stdout).toContain('"passed":true'); console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Call preview cleanup escaped repository scratch");
    await rm(target, { recursive: true, force: true });
  }
}, 90_000);
