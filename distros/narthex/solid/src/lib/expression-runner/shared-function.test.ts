import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("the shared function adapters preserve lexical binders and marker metadata", async () => {
  const repository = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const sourceRoot = join(repository, "distros/narthex/solid/src");
  const output = join(repository, ".tmp-diag/shared-function-lens-20261013");
  await mkdir(output, { recursive: true });
  const baseline = process.env.FENEL_SHARED_FUNCTION_BASELINE === "1";
  const prior = new Map<string, string>();
  if (baseline) for (const file of ["index.tsx", "structural-surfaces.tsx"]) {
    const path = `distros/narthex/solid/src/lib/expression-runner/${file}`;
    const git = Bun.spawn(["git", "show", `HEAD:${path}`], { cwd: repository, stdout: "pipe", stderr: "pipe" });
    const text = await new Response(git.stdout).text();
    if (await git.exited) throw new Error(await new Response(git.stderr).text());
    prior.set(file, text);
  }
  const compiler = await import(pathToFileURL(Bun.resolveSync("@solidjs/compiler",
    dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))))).href);
  const bundle = await Bun.build({ entrypoints: [fileURLToPath(new URL("./shared-function.browser-fixture.tsx", import.meta.url))],
    target: "browser", conditions: ["browser", "development"], minify: true,
    plugins: [{ name: "actual-shared-function-adapters", setup(build) {
      build.onResolve({ filter: /^shared-function-adapters:production$/ }, () => ({ path: join(sourceRoot, "lib/expression-runner/index.tsx") }));
      build.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
      build.onResolve({ filter: /\?raw$/ }, args => ({ path: Bun.resolveSync(args.path.slice(0, -4), args.resolveDir), namespace: "source-text" }));
      build.onLoad({ filter: /.*/, namespace: "source-text" }, async args => ({ loader: "js", contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};` }));
      build.onLoad({ filter: /\.tsx$/ }, async args => {
        const name = args.path.replaceAll("\\", "/").split("/").at(-1)!;
        const isAdapter = args.path.replaceAll("\\", "/").endsWith("/expression-runner/index.tsx");
        let source = ((isAdapter || name === "structural-surfaces.tsx") && prior.get(name)) || await Bun.file(args.path).text();
        if (isAdapter) {
          source = source.replace("  return (\n    <LambdaFormEditorSurface", "  Object.assign(globalThis, { __sharedFunctionSetBody: setBody });\n  return (\n    <LambdaFormEditorSurface");
          source += "\nexport { LambdaEditor, LambdaFormEditor, NodeEditor };\n";
        }
        return { loader: "ts", contents: (await compiler.transformAsync(source,
          { filename: args.path, generate: "dom", hydratable: false, dev: true })).code };
      });
      build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }],
  });
  if (!bundle.success) throw new AggregateError(bundle.logs, "Shared function fixture build failed");
  const script = join(output, baseline ? "before.js" : "after.js");
  await Bun.write(script, bundle.outputs.find(entry => entry.kind === "entry-point")!);
  const styles = ["global.css", "routes/app.css", "lib/expression-runner/authoring-guidance.css"];
  if (!baseline) styles.push("lib/expression-runner/structural-surfaces.css");
  const css = join(output, baseline ? "before.css" : "after.css");
  await Bun.write(css, (await Promise.all(styles.map(path => Bun.file(join(sourceRoot, path)).text()))).join("\n")
    + "\nbody { padding: 24px; } #fixture { max-width: 900px; margin: auto; }\n");
  const runner = join(output, "runner.mjs");
  await Bun.write(runner, (await Bun.file(new URL("./shared-function.browser-smoke.mjs", import.meta.url)).text())
    .replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
  const child = Bun.spawn(["node", runner, script, css], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: output, TMP: output } });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(stdout + "\n" + stderr);
  console.log(stdout.trim());
  expect(code).toBe(0);
}, 300_000);
