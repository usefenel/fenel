import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("shared read-only data display, copy and import lifecycle (isolated Chromium)", async () => {
  const scratch = fileURLToPath(new URL("../../../../../../.tmp-tsc/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "fenel-read-only-"));
  try {
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const browser = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./read-only.browser-fixture.tsx", import.meta.url))],
      target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "read-only-browser-fixture", setup(build) {
        build.onResolve({ filter: /^\.\.\/local-locus-data$/ }, args => /data-transfer[\\/]index\.ts$/.test(args.importer)
          ? { path: args.path, namespace: "read-only-clipboard-holder" } : undefined);
        build.onLoad({ filter: /.*/, namespace: "read-only-clipboard-holder" }, () => ({ loader: "js", contents:
          `export const localTabDataSource = () => ({ retainClipboard: async copy => readOnlyFixture.remember(copy) });` }));
        build.onResolve({ filter: /^\.\/(?:expressions|child-type|session-analysis)$/ }, (args) => args.importer.endsWith("DataValueSurface.tsx")
          ? { path: args.path, namespace: "read-only-analysis-fixture" } : undefined);
        build.onLoad({ filter: /.*/, namespace: "read-only-analysis-fixture" }, () => ({ loader: "js", contents: `
          export function expressionForTransfer(item) { return { kind: "literal", value: item.value }; }
          export function typeForTransfer(item) { return item.type; }
          export function prepareTransferItem(item) { return item; }
          export function childValueType(value, type, key) { return type?.$record?.fields.find(field => field.name === key)?.type; }
          export function adaptTransferForSession(items, options, signal) { return readOnlyFixture.adapt(items, options, signal); }
        ` }));
        build.onLoad({ filter: /\.tsx$/ }, async (args) => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }],
    });
    if (!browser.success) throw new AggregateError(browser.logs, "Read-only browser fixture build failed");
    const browserPath = join(directory, "browser.js");
    await Bun.write(browserPath, browser.outputs[0]!);
    const runner = await Bun.build({ entrypoints: [fileURLToPath(new URL("./read-only.node-fixture.ts", import.meta.url))], target: "node", packages: "external" });
    if (!runner.success) throw new AggregateError(runner.logs, "Read-only Node fixture build failed");
    const runnerPath = join(directory, "runner.mjs");
    await Bun.write(runnerPath, (await runner.outputs[0]!.text()).replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
    const child = Bun.spawn(["node", runnerPath, browserPath], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("# fail 0");
    expect(stdout).toMatch(/# pass 11(?:\r?\n|$)/);
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Read-only fixture cleanup escaped its workspace scratch directory");
    await rm(target, { recursive: true, force: true });
  }
}, 120_000);
