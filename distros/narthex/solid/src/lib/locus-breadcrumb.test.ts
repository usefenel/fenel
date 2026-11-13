import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("responsive data path navigation and context menu (isolated Chromium)", async () => {
  const temporaryRoot = fileURLToPath(new URL("../../../../../.tmp-diag/breadcrumb-tests/", import.meta.url));
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "run-"));
  try {
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const browser = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./locus-breadcrumb.fixture.tsx", import.meta.url))],
      target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "breadcrumb-browser-leaf", setup(build) {
        // Preserve the real modal lifecycle used by path navigation while
        // excluding the unrelated lazy typed prompt editor from this fixture.
        build.onLoad({ filter: /[\\/]confirm-modal[\\/]prompt-body\.tsx$/ }, () => ({ loader: "js", contents: "export default () => null;" }));
        // Geometry uses an already supplied Grid/List choice, not the engine
        // capability judgment that computes a subject's offered layouts.
        build.onResolve({ filter: /^\.\/locus-layout-options$/ }, () => ({ path: "grid-layout", namespace: "breadcrumb-layout-fixture" }));
        build.onLoad({ filter: /.*/, namespace: "breadcrumb-layout-fixture" }, () => ({ loader: "js",
          contents: 'export const locusLayoutOption = () => ({ value: "grid", label: "Grid", icon: "layout-grid" });' }));
        build.onResolve({ filter: /^@fenel\// }, args => { throw new Error(`Breadcrumb eagerly imports ${args.path}`); });
        build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }],
    });
    if (!browser.success) throw new AggregateError(browser.logs, "Breadcrumb browser fixture build failed");
    const browserPath = join(directory, "browser.js");
    await Bun.write(browserPath, browser.outputs[0]!);
    const cssPath = join(directory, "styles.css");
    const styles = await Promise.all(["../global.css", "../routes/app.css", "./home-entry.css", "./workspace-surface.css", "./locus-select.css", "./locus-layout-control.css", "./locus-context-menu.css", "./data-transfer/data-transfer.css", "./expression-runner/image-canvas.css"]
      .map(path => Bun.file(fileURLToPath(new URL(path, import.meta.url))).text()));
    await Bun.write(cssPath, styles.join("\n"));
    const runner = await Bun.build({ entrypoints: [fileURLToPath(new URL("./locus-breadcrumb.node-fixture.ts", import.meta.url))], target: "node", packages: "external" });
    if (!runner.success) throw new AggregateError(runner.logs, "Breadcrumb Node fixture build failed");
    const nodePath = join(directory, "runner.mjs");
    await Bun.write(nodePath, (await runner.outputs[0]!.text()).replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
    const child = Bun.spawn(["node", nodePath, browserPath, cssPath], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("# fail 0");
    expect(stdout).toMatch(/# pass 8(?:\r?\n|$)/);
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(temporaryRoot) + sep)) throw new Error("Breadcrumb cleanup escaped the repository test directory");
    await rm(target, { recursive: true, force: true });
  }
}, 90_000);
