import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("generic function signature layout (isolated Chromium)", async () => {
  const temporaryRoot = fileURLToPath(new URL("../../../../../.tmp-diag/function-card-tests/", import.meta.url));
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "run-"));
  try {
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("./function-card-body.fixture.tsx", import.meta.url))],
      target: "browser", conditions: ["browser", "development"], plugins: [{ name: "function-card-layout", setup(build) {
        // DataPreview's deferred structural inspection is outside this layout
        // fixture. Fail if it mounts; do not bundle its unrelated editor graph.
        build.onResolve({ filter: /DataValueSurface$/ }, args => ({ path: args.path, namespace: "unused-structural-preview" }));
        build.onLoad({ filter: /.*/, namespace: "unused-structural-preview" }, () => ({ loader: "js",
          contents: 'export function DataValueSurface() { throw new Error("Function signature unexpectedly opened structural data"); }' }));
        build.onResolve({ filter: /^@fenel\// }, args => { throw new Error(`Signature chrome eagerly imports ${args.path}`); });
        build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }] });
    if (!build.success) throw new AggregateError(build.logs, "Function card browser graph failed");
    const script = join(directory, "browser.js");
    await Bun.write(script, build.outputs.find(output => output.kind === "entry-point")!);
    const css = join(directory, "styles.css");
    await Bun.write(css, (await Promise.all(["../global.css", "../routes/app.css", "./home-entry.css", "./function-card-body.css", "./layout-renderer/typed-read-value.css"]
      .map(path => Bun.file(fileURLToPath(new URL(path, import.meta.url))).text()))).join("\n"));
    const runner = await Bun.build({ entrypoints: [fileURLToPath(new URL("./function-card-body.node-fixture.ts", import.meta.url))], target: "node", packages: "external" });
    if (!runner.success) throw new AggregateError(runner.logs, "Function card Node fixture failed");
    const nodePath = join(directory, "runner.mjs");
    await Bun.write(nodePath, (await runner.outputs[0]!.text()).replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
    const child = Bun.spawn(["node", nodePath, script, css], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exit !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("# pass 1");
    expect(stdout).toContain("# fail 0");
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(temporaryRoot) + sep)) throw new Error("Function card cleanup escaped its repository test directory");
    await rm(target, { recursive: true, force: true });
  }
}, 120_000);
