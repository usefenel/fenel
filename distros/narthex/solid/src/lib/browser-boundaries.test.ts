import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test("browser session and DOM regressions (isolated Chromium)", async () => {
  const temporaryRoot = fileURLToPath(new URL("../../../../../.tmp-diag/", import.meta.url));
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "fenel-browser-boundaries-"));
  try {
    const browser = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./browser-boundaries.fixture.ts", import.meta.url))],
      target: "browser", conditions: ["browser", "development"], minify: true,
      // Registry hydration is covered separately. Only the standalone value
      // transport leaf may load during auth; authoring stays lazy.
      plugins: [{
        name: "browser-session-engine-boundary",
        setup(build) {
          build.onResolve({ filter: /^(?:@fenel\/|\.\/(?:authoring-json|reader-presentation)$|\.\/expression-runner\/(?:authoring-session|authoring-catalog-worker)$)/ }, (args) => {
            if (args.path === "@fenel/engine/checkpoint-json") return {
              path: fileURLToPath(new URL("../../../../../implementations/typescript/engine/src/checkpoint-json.ts", import.meta.url)),
            };
            if (args.kind !== "dynamic-import") throw new Error(`Session startup eagerly imports ${args.path}`);
            return { path: args.path, external: true };
          });
        },
      }],
    });
    if (!browser.success) throw new AggregateError(browser.logs, "Browser fixture build failed");
    const browserPath = join(directory, "browser.js");
    await Bun.write(browserPath, browser.outputs[0]!);
    const readerSource = await Bun.file(new URL("./reader-runtime.tsx", import.meta.url)).text();
    const localStart = readerSource.indexOf("export function startLocalReaderRuntime(");
    const localEnd = readerSource.indexOf("export async function createLocalReaderRuntime(", localStart);
    if (localStart < 0 || localEnd < 0) throw new Error("Local reader startup boundary changed");
    const localBoundaryPath = join(directory, "local-reader-start.js");
    await Bun.write(localBoundaryPath, new Bun.Transpiler({ loader: "ts" }).transformSync(readerSource.slice(localStart, localEnd))
      .replace(/^export /gm, "").replace(/\bimport\(/g, "loadModule("));
    const runner = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./browser-boundaries.node-fixture.ts", import.meta.url))],
      target: "node", packages: "external",
    });
    if (!runner.success) throw new AggregateError(runner.logs, "Node fixture build failed");
    // Node owns Chromium's pipes on Windows. Bun's Playwright pipe transport
    // hangs here; keeping the driver in Node also matches Playwright's host.
    const nodePath = join(directory, "runner.mjs");
    await Bun.write(nodePath, (await runner.outputs[0]!.text()).replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
    const process = Bun.spawn(["node", nodePath, browserPath, localBoundaryPath], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("# fail 0");
    expect(stdout).toMatch(/# pass 32(?:\r?\n|$)/);
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(temporaryRoot) + "/") && !target.startsWith(resolve(temporaryRoot) + "\\")) {
      throw new Error("Browser fixture cleanup escaped the temporary directory");
    }
    await rm(target, { recursive: true, force: true });
  }
}, 120_000);
