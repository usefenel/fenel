import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("actual HomeEntry reads before held editors and shares its checked card owner (Chromium)", async () => {
  const repository = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
  const scratch = join(repository, ".tmp", "early-results");
  await mkdir(scratch, { recursive: true });
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  const compiler = await import(pathToFileURL(compilerPath).href);
  const baseline = Bun.spawn(["git", "show", "HEAD:distros/narthex/solid/src/lib/home-entry.tsx"], { stdout: "pipe" });
  const previous = await new Response(baseline.stdout).text();
  if (await baseline.exited !== 0) throw new Error("Cannot capture previous HomeEntry");
  const worker = fileURLToPath(new URL("./early-read-value.browser-worker-fixture.ts", import.meta.url));
  const css = (await Promise.all(["../global.css", "../routes/app.css", "./home-entry.css", "./loading-screen/loading-screen.css", "./data-inspection-dialog.css", "./locus-context-menu.css", "./locus-notifications.css", "./data-transfer/data-transfer.css"]
    .map(path => Bun.file(fileURLToPath(new URL(path, import.meta.url))).text()))).join("\n");
  const cssPath = join(scratch, "early-styles.css"); await Bun.write(cssPath, css);
  for (const before of [true, false]) {
    const directory = await mkdtemp(join(scratch, before ? "before-" : "after-"));
    try {
      const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("./early-read-value.browser-fixture.tsx", import.meta.url))],
        target: "browser", conditions: ["browser", "development"], plugins: [{ name: "checked-read-transport", setup(build) {
          build.onResolve({ filter: /^(?:\.\.\/routes\/app\/home|\.\/workspace-authoring-provider)$/ }, args => {
            if (args.kind !== "dynamic-import") throw new Error("Early read eagerly imports editor UI");
            return { path: args.path, external: true };
          });
          build.onResolve({ filter: /^(?:\.\/prompt-body|\.\/reader-presentation)$/ }, args => {
            if (args.kind !== "dynamic-import") throw new Error("Early Home eagerly imports optional tools");
            return { path: args.path, external: true };
          });
          build.onResolve({ filter: /^(?:\.\/authoring-json|\.\/expression-runner\/(?:authoring-session|authoring-catalog-worker))$/ }, args => {
            if (args.kind !== "dynamic-import") throw new Error("Early Home eagerly imports checked authoring tools");
            return { path: args.path, external: true };
          });
          build.onResolve({ filter: /^\.\/workspace-model-loader$/ }, args => {
            if (args.kind !== "dynamic-import") throw new Error("Early Home eagerly imports the lens model");
            return { path: "held-lens-model", namespace: "early-read-optional" };
          });
          build.onLoad({ filter: /.*/, namespace: "early-read-optional" }, () => ({ loader: "js",
            contents: "export async function loadWorkspaceModel() { return { workspaceCall: () => [] }; }" }));
          build.onResolve({ filter: /\.\/image-pipeline-preview$/ }, () => ({ path: worker }));
          build.onResolve({ filter: /^@fenel\/engine\/authoring\/expression$/ }, () => ({ path: worker }));
          build.onLoad({ filter: /locus-card-evaluation\.ts$/ }, async args => {
            let text = await Bun.file(args.path).text();
            text = text.replace(/^import .* from "\.\/expression-runner\/(?:account-authoring-session|authoring-session|authoring-catalog-worker|expression-evaluation)";\r?\n/gm, "")
              .replace(/^import .* from "\.\/picture-evaluation-gate";\r?\n/gm, "");
            return { loader: "ts", contents: `import { concreteAuthoringSession, authoringSessionAccountScope, authoringWorkerSnapshot, evaluateExpressionInWorker, evaluateAuthoringExpressionInSession, beforePictureEvaluation } from "./early-read-value.browser-worker-fixture";\n${text}` };
          });
          build.onResolve({ filter: /^@fenel\// }, args => {
            if (args.path === "@fenel/engine/checkpoint-json") return { path: join(repository, "implementations/typescript/engine/src/checkpoint-json.ts") };
            if (args.path === "@fenel/engine/maybe-value") return { path: join(repository, "implementations/typescript/engine/src/maybe-value.ts") };
            if (args.kind !== "dynamic-import") throw new Error(`Isolated early read eagerly boots ${args.path}`);
            return { path: args.path, external: true };
          });
          build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(
            before && args.path.replaceAll("\\", "/").endsWith("/home-entry.tsx") ? previous : await Bun.file(args.path).text(),
            { filename: args.path, generate: "dom", hydratable: false, dev: true })).code }));
          build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
        } }] });
      if (!build.success) throw new AggregateError(build.logs, "Early read fixture build failed");
      const script = join(directory, "browser.js"); await Bun.write(script, build.outputs[0]!);
      const child = Bun.spawn(["node", fileURLToPath(new URL("./early-read-value.browser-smoke.mjs", import.meta.url)), script, cssPath, before ? "before" : "after"],
        { stdout: "pipe", stderr: "pipe", env: { ...process.env, FENEL_EARLY_READ_CAPTURE_DIR: scratch } });
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (exit !== 0) throw new Error(`${stdout}\n${stderr}`);
      expect(stdout).toContain("PASS"); console.log(stdout.trim());
    } finally {
      if (!resolve(directory).startsWith(resolve(scratch) + sep)) throw new Error("Fixture cleanup escaped repository scratch");
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 180_000);
