import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("native change and blur during field teardown preserve the retired owner", async () => {
  const repository = resolve(fileURLToPath(new URL("../../../../../../", import.meta.url)));
  const output = resolve(repository, ".tmp-diag/native-field-teardown");
  expect(output.startsWith(repository + sep)).toBe(true);
  await mkdir(output, { recursive: true });
  const entry = fileURLToPath(new URL("./string-input-surface.tsx", import.meta.url));
  const field = await Bun.file(new URL("./FieldRenderer.tsx", import.meta.url)).text();
  const begin = field.indexOf("function createReaderInteractionGuard(");
  const end = field.indexOf("/** A2/B3 field-plan lifetime", begin);
  if (begin < 0 || end < begin) throw new Error("Native interaction guard fixture boundary moved");
  const source = `
import { render } from "@solidjs/web";
import { onSettled, isPending } from "solid-js";
import { createAsyncValue } from "../async-value";
${await Bun.file(entry).text()}
${field.slice(begin, end)}
function NativeTeardownFixture() {
  const [generation, setGeneration] = createSignal(1);
  const [visible, setVisible] = createSignal(true);
  const projected = createAsyncValue(generation,
    value => value === 1 ? Promise.resolve("ready") : new Promise(() => {}));
  const guard = createReaderInteractionGuard(() => !projected.loading && projected() !== undefined);
  const typed = [];
  let blurs = 0;
  globalThis.nativeTeardown = {
    retire() { setGeneration(2); setVisible(false); },
    state: () => ({ typed, blurs }),
  };
  const textarea = new URLSearchParams(location.search).has("textarea");
  return <><div ref={guard}><Show when={visible() ? { text: "initial" } : undefined}>
    {item => <StringInputSurface textarea={textarea} value={item().text}
      onChange={value => typed.push(value)} onBlur={() => { void item().text; blurs++; }} />}
  </Show></div><button id="outside" type="button">Outside</button></>;
}
render(() => <NativeTeardownFixture />, document.getElementById("root"));
`;
  const require = createRequire(import.meta.url);
  const compiler = await import(pathToFileURL(Bun.resolveSync("@solidjs/compiler",
    dirname(require.resolve("@solidjs/vite-plugin")))).href);
  const bundle = await Bun.build({ entrypoints: [entry], target: "browser", conditions: ["browser", "development"],
    plugins: [{ name: "native-field-teardown", setup(build) {
      build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(
        args.path === entry ? source : await Bun.file(args.path).text(),
        { filename: args.path, generate: "dom", hydratable: false, dev: true })).code }));
      build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }],
  });
  if (!bundle.success) throw new AggregateError(bundle.logs, "Native field teardown fixture failed to build");
  const script = join(output, "fixture.js");
  await writeFile(script, await bundle.outputs.find(entry => entry.kind === "entry-point").text());
  const driver = join(output, "driver.mjs");
  await writeFile(driver, `
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(${JSON.stringify(require.resolve("playwright"))});
const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30000 });
const results = [];
try {
  for (const textarea of [false, true]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }));
    await page.goto("https://fenel.test/" + (textarea ? "?textarea" : ""));
    await page.addScriptTag({ content: await readFile(${JSON.stringify(script)}, "utf8"), type: "module" });
    const input = page.locator(textarea ? "textarea" : "input");
    await input.fill("first");
    await page.locator("#outside").click();
    assert.deepEqual(await page.evaluate(() => nativeTeardown.state()), { typed: ["first"], blurs: 1 });
    await input.fill("second");
    await page.evaluate(() => nativeTeardown.retire());
    await input.waitFor({ state: "detached" });
    await page.waitForTimeout(30);
    const state = await page.evaluate(() => nativeTeardown.state());
    results.push({ textarea, errors, state });
    assert.deepEqual(errors, [], "Native teardown must not read a pending plan or a disposed Show accessor");
    assert.deepEqual(state, { typed: ["first", "second"], blurs: 1 });
    await page.close();
  }
  await writeFile(${JSON.stringify(join(output, "results.json"))}, JSON.stringify(results, null, 2));
  console.log("Native field teardown: input and textarea pass");
} finally { await browser.close(); }
`);
  const child = Bun.spawn(["node", driver], { cwd: repository, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(`Native field teardown fixture failed\n${stdout}\n${stderr}`);
  expect(stdout).toContain("input and textarea pass");
}, 60000);
