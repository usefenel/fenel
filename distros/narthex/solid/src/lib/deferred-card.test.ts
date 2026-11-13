import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("cards mount only when visible and yield between frames (isolated Chromium)", async () => {
  const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
  const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
  const scratch = join(repository, ".tmp-tsc");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "deferred-card-"));
  try {
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const browser = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./deferred-card.fixture.tsx", import.meta.url))],
      target: "browser", conditions: ["browser", "development"], minify: true,
      plugins: [{ name: "deferred-card-browser", setup(build) {
        build.onResolve({ filter: /^~\// }, (args) => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
        build.onResolve({ filter: /\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "source-text" }));
        build.onLoad({ filter: /.*/, namespace: "source-text" }, async (args) => ({ loader: "js", contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};` }));
        build.onLoad({ filter: /\.tsx$/ }, async (args) => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }],
    });
    if (!browser.success) throw new AggregateError(browser.logs, "Deferred card browser fixture build failed");
    const browserPath = join(directory, "browser.js");
    await Bun.write(browserPath, browser.outputs.find((output) => output.kind === "entry-point")!);
    const runner = await Bun.build({ entrypoints: [fileURLToPath(new URL("./deferred-card.node-fixture.ts", import.meta.url))], target: "node", packages: "external" });
    if (!runner.success) throw new AggregateError(runner.logs, "Deferred card Node fixture build failed");
    const nodePath = join(directory, "runner.mjs");
    await Bun.write(nodePath, (await runner.outputs[0]!.text()).replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
    const child = Bun.spawn(["node", nodePath, browserPath], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("# fail 0");
    expect(stdout).toMatch(/# pass 4(?:\r?\n|$)/);
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Deferred card fixture cleanup escaped its workspace scratch directory");
    await rm(target, { recursive: true, force: true });
  }
}, 240_000);
