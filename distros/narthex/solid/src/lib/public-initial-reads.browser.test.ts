import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("actual generated public calls paint while the complete reader/editor are unavailable (Chromium)", async () => {
  const repository = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
  const scratch = join(repository, ".tmp-diag", "public-initial-results");
  await mkdir(scratch, { recursive: true });
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  const compiler = await import(pathToFileURL(compilerPath).href);
  const baseline = Bun.spawn(["git", "show", "HEAD:distros/narthex/solid/src/lib/home-entry.tsx"], { stdout: "pipe" });
  const previous = await new Response(baseline.stdout).text();
  if (await baseline.exited !== 0) throw new Error("Cannot capture previous HomeEntry");
  const worker = fileURLToPath(new URL("./early-read-value.browser-worker-fixture.ts", import.meta.url));
  const css = (await Promise.all(["../global.css", "../routes/app.css", "./home-entry.css", "./loading-screen/loading-screen.css", "./data-inspection-dialog.css", "./locus-context-menu.css", "./locus-notifications.css", "./data-transfer/data-transfer.css"]
    .map(path => Bun.file(fileURLToPath(new URL(path, import.meta.url))).text()))).join("\n");
  const cssPath = join(scratch, "public-initial-styles.css"); await Bun.write(cssPath, css);
  for (const before of [true, false]) {
    const directory = await mkdtemp(join(scratch, before ? "before-" : "after-"));
    try {
      const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("./public-initial-reads.browser-fixture.tsx", import.meta.url))],
        target: "browser", conditions: ["browser", "development"], plugins: [{ name: "inert-public-initial-reads", setup(build) {
          build.onResolve({ filter: /^\.\/index$/ }, args => {
            if (!args.importer.replaceAll("\\", "/").endsWith("/expression-runner/ExpressionEditor.tsx")) return;
            if (args.kind !== "dynamic-import") throw new Error("Initial graph eagerly imports the semantic editor");
            return { path: "./expression-runner/index", external: true };
          });
          build.onResolve({ filter: /^\.\/(?:layout-renderer\/TypedReadValue|data-transfer\/DataValueSurface|reader-runtime|locus-layout-options|early-read-value|locus-card-evaluation)$/ }, args => {
            if (args.kind !== "dynamic-import") throw new Error(`Initial graph eagerly imports ${args.path}`);
            return { path: args.path, external: true };
          });
          build.onResolve({ filter: /^(?:\.\.\/routes\/app\/home|\.\/workspace-authoring-provider|\.\/prompt-body|\.\/reader-presentation|\.\/authoring-json|\.\/expression-runner\/(?:authoring-session|authoring-catalog-worker))$/ }, args => {
            if (args.kind !== "dynamic-import") throw new Error(`Initial public data eagerly imports complete reader ${args.path}`);
            return { path: args.path, external: true };
          });
          build.onResolve({ filter: /^\.\/workspace-model-loader$/ }, args => {
            if (args.kind !== "dynamic-import") throw new Error("Initial public data eagerly imports the lens model");
            return { path: "held-public-lens-model", namespace: "public-initial-optional" };
          });
          build.onLoad({ filter: /.*/, namespace: "public-initial-optional" }, () => ({ loader: "js",
            contents: "export async function loadWorkspaceModel() { throw new Error('Complete lens model deliberately unavailable'); }" }));
          build.onResolve({ filter: /\.\/image-pipeline-preview$/ }, () => ({ path: worker }));
          build.onResolve({ filter: /^@fenel\/engine\/authoring\/expression$/ }, () => ({ path: worker }));
          build.onLoad({ filter: /locus-card-evaluation\.ts$/ }, async args => {
            const text = (await Bun.file(args.path).text())
              .replace(/^import .* from "\.\/expression-runner\/(?:account-authoring-session|authoring-session|authoring-catalog-worker|expression-evaluation)";\r?\n/gm, "")
              .replace(/^import .* from "\.\/picture-evaluation-gate";\r?\n/gm, "");
            return { loader: "ts", contents: `import { concreteAuthoringSession, authoringSessionAccountScope, authoringWorkerSnapshot, evaluateExpressionInWorker, evaluateAuthoringExpressionInSession, beforePictureEvaluation } from "./early-read-value.browser-worker-fixture";\n${text}` };
          });
          build.onResolve({ filter: /^@fenel\// }, args => {
            if (args.path === "@fenel/engine/checkpoint-json") return { path: join(repository, "implementations/typescript/engine/src/checkpoint-json.ts") };
            if (args.path === "@fenel/engine/maybe-value") return { path: join(repository, "implementations/typescript/engine/src/maybe-value.ts") };
            if (args.kind !== "dynamic-import") throw new Error(`Initial public data eagerly boots ${args.path}`);
            return { path: args.path, external: true };
          });
          build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(
            before && args.path.replaceAll("\\", "/").endsWith("/home-entry.tsx") ? previous : await Bun.file(args.path).text(),
            { filename: args.path, generate: "dom", hydratable: false, dev: true })).code }));
          build.onLoad({ filter: /[\\/]generated[\\/]public-bootstrap\.json$/ }, async args => ({ loader: "js", contents: `
            const snapshot = ${await Bun.file(args.path).text()};
            if (globalThis.publicInitialVariantCase) {
              const demo = snapshot.root.items.find(item => item.id === "demo");
              const type = { $variant: { cases: ["Err", "Just", "Nothing"].map(name => ({ name, fields: [] })) } };
              snapshot.root.typeDescriptions.push({ type, phrase: "Controlled variant", code: "ControlledVariant", kind: "variant", kindLabel: "Variant" });
              for (const tag of ["Err", "Just", "Nothing"]) {
                const expression = { kind: "call", fnId: "fixture:" + tag, args: [] };
                const value = tag === "Nothing" ? { $tag: tag } : { $tag: tag, _0: "retained payload" };
                demo.source.expr.value.__record.fields.push({ name: "Controlled " + tag, value: expression });
                demo.valueType.$record.fields.push({ name: "Controlled " + tag, type });
                snapshot.initialReads.entries.push({ expression, value });
              }
            }
            export default snapshot;
          ` }));
          build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
        } }] });
      if (!build.success) throw new AggregateError(build.logs, "Initial public results fixture build failed");
      const script = join(directory, "browser.js"); await Bun.write(script, build.outputs[0]!);
      const child = Bun.spawn(["node", fileURLToPath(new URL("./public-initial-reads.browser-smoke.mjs", import.meta.url)), script, cssPath, before ? "before" : "after"],
        { stdout: "pipe", stderr: "pipe", env: { ...process.env, FENEL_PUBLIC_INITIAL_CAPTURE_DIR: scratch } });
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (exit !== 0) throw new Error(`${stdout}\n${stderr}`);
      expect(stdout).toContain("PASS"); console.log(stdout.trim());
    } finally {
      if (!resolve(directory).startsWith(resolve(scratch) + sep)) throw new Error("Fixture cleanup escaped repository scratch");
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 180_000);
