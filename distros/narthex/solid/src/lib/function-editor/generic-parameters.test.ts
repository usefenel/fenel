import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("generic parameters use source edits and shared controls (isolated Chromium)", async () => {
  const repository = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const sourceRoot = join(repository, "distros/narthex/solid/src");
  const directory = join(repository, ".tmp-diag/generic-parameters-20261013");
  await mkdir(directory, { recursive: true });
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  const compiler = await import(pathToFileURL(compilerPath).href);
  const bundle = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./generic-parameters.browser-fixture.tsx", import.meta.url))],
    target: "browser", conditions: ["browser", "development"], minify: { whitespace: true, identifiers: false, syntax: true },
    plugins: [{ name: "actual-generic-parameters", setup(build) {
      build.onResolve({ filter: /(?:routes\/app\/home|workspace-authoring-provider)$/ }, args => ({ path: args.path, external: true }));
      build.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
      build.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "source-text" }));
      build.onLoad({ filter: /.*/, namespace: "source-text" }, async args => ({ loader: "js", contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};` }));
      build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
        filename: args.path, generate: "dom", hydratable: false, dev: true,
      })).code }));
      build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }],
  });
  if (!bundle.success) throw new AggregateError(bundle.logs, "Generic parameters fixture build failed");
  const scriptPath = join(directory, "browser.js");
  await Bun.write(scriptPath, bundle.outputs.find(output => output.kind === "entry-point")!);
  const cssPath = join(directory, "styles.css");
  const css = (await Promise.all(["global.css", "lib/type-builder/type-builder.css", "lib/locus-select.css", "lib/expression-builder/set-expr-editor.css", "lib/admin-form/admin-form.css", "lib/variant-value/variant-value-editor.css", "lib/function-editor/generic-parameters-editor.css"]
    .map(path => Bun.file(join(sourceRoot, path)).text()))).join("\n");
  await Bun.write(cssPath, css + "\nbody {margin:0;padding:24px;background:#f5f5f5} #fixture {max-width:840px;margin:auto;background:white;padding:20px;box-sizing:border-box;border-radius:12px} @media(max-width:560px){body{padding:12px} #fixture{padding:12px}}\n");
  const runner = await Bun.file(new URL("./generic-parameters.browser-smoke.mjs", import.meta.url)).text();
  const runnerPath = join(directory, "runner.mjs");
  await Bun.write(runnerPath, runner.replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
  const child = Bun.spawn(["node", runnerPath, scriptPath, cssPath], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exit) throw new Error(`${stdout}\n${stderr}`);
  console.log(stdout); expect(stdout).toContain("PASS");
}, 240_000);
