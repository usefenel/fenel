import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("merged Browse panel handles asynchronous rows and keyboard actions without the engine (isolated Chromium)", async () => {
  const scratch = fileURLToPath(new URL("../../../../../.tmp-tsc/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "fenel-locus-browse-"));
  try {
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const browser = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./locus-browse.fixture.tsx", import.meta.url))],
      target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "browse-engine-boundary", setup(build) {
        build.onResolve({ filter: /^@fenel\// }, args => { throw new Error(`Browse panel eagerly imports ${args.path}`); });
        build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }],
    });
    if (!browser.success) throw new AggregateError(browser.logs, "Browse browser fixture build failed");
    const browserPath = join(directory, "browser.js");
    await Bun.write(browserPath, browser.outputs[0]!);
    const cssPath = join(directory, "styles.css");
    const styles = await Promise.all(["../global.css", "../routes/app.css", "./home-entry.css"]
      .map(path => Bun.file(fileURLToPath(new URL(path, import.meta.url))).text()));
    await Bun.write(cssPath, styles.join("\n"));
    const runner = await Bun.build({ entrypoints: [fileURLToPath(new URL("./locus-browse.node-fixture.ts", import.meta.url))], target: "node", packages: "external" });
    if (!runner.success) throw new AggregateError(runner.logs, "Browse Node fixture build failed");
    const nodePath = join(directory, "runner.mjs");
    await Bun.write(nodePath, (await runner.outputs[0]!.text()).replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
    if (process.env["FENEL_BROWSE_KEEP_BASELINE"] === "1") {
      const baseline = fileURLToPath(new URL("../../../../../.tmp-diag/launch-browse-20260930/baseline/", import.meta.url));
      await mkdir(baseline, { recursive: true });
      await Promise.all([Bun.write(join(baseline, "browser.js"), Bun.file(browserPath)),
        Bun.write(join(baseline, "styles.css"), Bun.file(cssPath)), Bun.write(join(baseline, "runner.mjs"), Bun.file(nodePath))]);
    }
    const testPattern = process.env["FENEL_BROWSE_TEST_PATTERN"];
    const child = Bun.spawn(["node", ...(testPattern ? [`--test-name-pattern=${testPattern}`] : []), nodePath, browserPath, cssPath], { stdout: "pipe", stderr: "pipe",
      env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("# fail 0");
    expect(stdout).toMatch(testPattern ? /# pass [1-9]\d*(?:\r?\n|$)/ : /# pass 9(?:\r?\n|$)/);
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Browse fixture cleanup escaped its workspace scratch directory");
    await rm(target, { recursive: true, force: true });
  }
}, 120_000);
