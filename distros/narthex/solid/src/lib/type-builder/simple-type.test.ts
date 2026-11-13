import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("type lenses preserve canonical types and share field editing (isolated Chromium)", async () => {
  const repository = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const sourceRoot = join(repository, "distros/narthex/solid/src");
  const predicates = process.env.FENEL_SIMPLE_TYPE_PREDICATES === "1";
  const phoneCapsule = process.env.FENEL_SIMPLE_TYPE_PHONE_PICKER === "1";
  const directory = resolve(repository, process.env.FENEL_SIMPLE_TYPE_OUTPUT
    ?? (predicates ? ".tmp-diag/type-predicates-20261013" : ".tmp-diag/simple-type-lens-20261013"));
  await mkdir(directory, { recursive: true });
  const baseline = process.env.FENEL_SIMPLE_TYPE_BASELINE === "1";
  if (phoneCapsule && baseline) throw new Error("Phone capsules freeze the actual installed source; the partial BASELINE override is not a before build.");
  const stage = process.env.FENEL_SIMPLE_TYPE_STAGE;
  if (stage !== undefined && stage !== "before" && stage !== "after") throw new Error("Invalid type fixture stage");
  const prefix = stage ?? (baseline ? "before" : "after");
  if (phoneCapsule && (await Promise.all([`${prefix}-browser.js`, `${prefix}-styles.css`, `${prefix}-capsule.json`, "runner.mjs"]
    .map(path => Bun.file(join(directory, path)).exists()))).some(Boolean)) throw new Error("This Phone capsule output already exists; preserve it and choose a fresh output directory.");
  const captured = new Map<string, string>();
  const replaced = ["lib/type-builder/TypeBuilder.tsx", "lib/field-occurrence/FieldOccurrenceEditorBase.tsx", "lib/type-builder/type-builder.css"];
  const read = async (path: string) => {
    const source = baseline && replaced.some(relative => path.replaceAll("\\", "/").endsWith(relative))
      ? execFileSync("git", ["show", `HEAD:${path.slice(repository.length).replaceAll("\\", "/")}`], { cwd: repository, encoding: "utf8" })
      : await Bun.file(path).text();
    if (phoneCapsule && path.startsWith(repository) && !path.includes("node_modules")) captured.set(path, source);
    return source;
  };
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  const compiler = await import(pathToFileURL(compilerPath).href);
  const bundle = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./simple-type.browser-fixture.tsx", import.meta.url))],
    target: "browser", conditions: ["browser", "development"], minify: { whitespace: true, identifiers: false, syntax: true },
    plugins: [{ name: "actual-type-lenses", setup(build) {
      build.onResolve({ filter: /authoring-catalog-worker(?:\.ts)?$/ }, args => {
        if (!phoneCapsule || args.importer.replaceAll("\\", "/").endsWith("/type-picker-worker.browser-fixture.ts")) return undefined;
        return { path: join(sourceRoot, "lib/type-builder/type-picker-worker.browser-fixture.ts") };
      });
      build.onResolve({ filter: /(?:routes\/app\/home|workspace-authoring-provider)$/ }, args => ({ path: args.path, external: true }));
      build.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
      build.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "source-text" }));
      build.onLoad({ filter: /.*/, namespace: "source-text" }, async args => ({ loader: "js", contents: `export default ${JSON.stringify(await read(args.path))};` }));
      build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await read(args.path), {
        filename: args.path, generate: "dom", hydratable: false, dev: true,
      })).code }));
      build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      build.onLoad({ filter: /\.(?:[cm]?[jt]s|json)$/ }, async args => {
        if (!phoneCapsule || !args.path.startsWith(repository) || args.path.includes("node_modules")) return undefined;
        return { loader: args.path.endsWith(".json") ? "json" : /\.[cm]?ts$/.test(args.path) ? "ts" : "js", contents: await read(args.path) };
      });
    } }],
  });
  if (!bundle.success) throw new AggregateError(bundle.logs, "Type lens fixture build failed");
  const { writeVerifiedArtifact } = await import(pathToFileURL(join(repository, "scripts/lib/verified-artifact-io.mjs")).href);
  const scriptPath = join(directory, `${prefix}-browser.js`);
  const scriptBytes = new Uint8Array(await bundle.outputs.find(output => output.kind === "entry-point")!.arrayBuffer());
  const scriptReceipt = await writeVerifiedArtifact(scriptPath, scriptBytes);
  const cssPath = join(directory, `${prefix}-styles.css`);
  const css = (await Promise.all(["global.css", "routes/app.css", "lib/type-builder/type-builder.css", "lib/locus-select.css", "lib/expression-builder/set-expr-editor.css", "lib/expression-builder/set-expr-builder.css", "lib/expression-runner/authoring-guidance.css", "lib/variant-value/variant-value-editor.css", "lib/admin-form/admin-form.css"]
    .map(path => read(join(sourceRoot, path))))).join("\n");
  const cssBytes = new TextEncoder().encode(css + "\nbody {margin:0;padding:24px;background:#f5f5f5} #fixture {max-width:840px;margin:auto;background:white;padding:20px;box-sizing:border-box;border-radius:12px} @media(max-width:560px){body{padding:12px} #fixture{padding:12px}}\n");
  const cssReceipt = await writeVerifiedArtifact(cssPath, cssBytes);
  const runnerSourcePath = fileURLToPath(new URL(predicates ? "./type-predicate.browser-smoke.mjs" : "./simple-type.browser-smoke.mjs", import.meta.url));
  const runner = await read(runnerSourcePath);
  const runnerPath = join(directory, "runner.mjs");
  const runnerBytes = new TextEncoder().encode(runner.replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
  const runnerReceipt = await writeVerifiedArtifact(runnerPath, runnerBytes);
  if (phoneCapsule) {
    for (const path of [fileURLToPath(import.meta.url), join(repository, "package.json"), join(repository, "bun.lock")]) await read(path);
    const sources = [];
    for (const [path, content] of [...captured].sort(([a], [b]) => a.localeCompare(b))) {
      const relative = path.slice(repository.length).replaceAll("\\", "/");
      const bytes = new TextEncoder().encode(content);
      const destination = join(directory, "sources", relative);
      await mkdir(dirname(destination), { recursive: true });
      await writeVerifiedArtifact(destination, bytes);
      sources.push({ path: relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    await writeVerifiedArtifact(join(directory, `${prefix}-capsule.json`), new TextEncoder().encode(JSON.stringify({
      kind: "actual-component-visual-and-transport-fixture", semanticAcceptance: false, stage: prefix,
      partialBaselineOverride: false, script: scriptReceipt, css: cssReceipt, runner: runnerReceipt, sources,
      controlledIO: "Only this explicit visual fixture session routes worker reference IO through type-picker-worker.browser-fixture; all other worker readers use the actual module.",
      artifacts: Object.fromEntries([[`${prefix}-browser.js`, scriptBytes], [`${prefix}-styles.css`, cssBytes], ["runner.mjs", runnerBytes]]
        .map(([path, bytes]) => [path as string, { bytes: (bytes as Uint8Array).length, sha256: createHash("sha256").update(bytes as Uint8Array).digest("hex") }])),
      bunVersion: Bun.version,
      limits: ["Fixture registry/presentation replies are observations supplied to the component, not a normal Local reader.",
        "No membership, inference, Save or reload acceptance is inferred from this capsule."],
    }, null, 2) + "\n"));
  }
  if (process.env.FENEL_SIMPLE_TYPE_BUILD_ONLY === "1") return;
  const child = Bun.spawn(["node", runnerPath, scriptPath, cssPath], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exit) throw new Error(`${stdout}\n${stderr}`);
  console.log(stdout); expect(stdout).toContain("PASS");
}, 240_000);

