import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeVerifiedArtifact } from "../../../../../scripts/lib/verified-artifact-io.mjs";

const writeFixtureArtifact = (path: string, source: string | Blob) => typeof source === "string"
  ? writeVerifiedArtifact(path, new TextEncoder().encode(source))
  : source.arrayBuffer().then(bytes => writeVerifiedArtifact(path, new Uint8Array(bytes)));

const exportDirectory = process.env["FENEL_HOME_ENTRY_FIXTURE_EXPORT_DIR"];
const baselineHome = process.env["FENEL_HOME_ENTRY_FIXTURE_BASELINE"];
const snapshotHome = process.env["FENEL_HOME_ENTRY_FIXTURE_SOURCE_DIR"];
const snapshotHomeOnly = process.env["FENEL_HOME_ENTRY_FIXTURE_HOME_SOURCE"];
const nullBaseline = process.env["FENEL_HOME_ENTRY_NULL_GUARD_BASELINE"] === "1";
test("ordinary menu lifetime refuses retired owners before reading their root", async () => {
  const home = (await Bun.file(new URL("./home-entry.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
  const start = home.indexOf("  createEffect(() => {\n    const target = contextMenu();");
  const end = home.indexOf("  const [representationOwner,", start);
  if (start < 0 || end <= start) throw new Error("Home menu lifetime boundary moved");
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(home.slice(start, end));
  const original = { epoch: 3, source: "local", focus: "root", rootId: "root", revision: 1 };
  let target: typeof original | undefined;
  let epoch = original.epoch, source = original.source, focus = original.focus, rootReads = 0, unreadable = false;
  let compute!: () => boolean, apply!: (expired: boolean) => void;
  const bindings = {
    createEffect: (read: typeof compute, effect: typeof apply) => { compute = read; apply = effect; },
    contextMenu: () => target, setContextMenu: () => { target = undefined; },
    sessionEpoch: () => epoch, paneSourceKey: () => source, displayFocus: () => focus,
    sameFocus: (left: string, right: string) => left === right,
    current: () => { rootReads++; if (unreadable) throw new Error("The retired reader cannot be read"); return { id: "root", revision: 1 }; },
  };
  new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  const settle = () => apply(compute());
  settle(); expect(rootReads).toBe(0);
  target = original; settle(); expect(target).toBe(original); expect(rootReads).toBe(1);
  unreadable = true;
  for (const boundary of ["epoch", "source", "focus"] as const) {
    target = original; epoch = original.epoch; source = original.source; focus = original.focus;
    if (boundary === "epoch") epoch++;
    else if (boundary === "source") source = "other";
    else focus = "other";
    settle(); expect(target).toBeUndefined(); expect(rootReads).toBe(1);
  }
  // A current owner still reads its root; the guard must not swallow that failure.
  target = original; epoch = original.epoch; source = original.source; focus = original.focus;
  expect(settle).toThrow("The retired reader cannot be read");
});
test(exportDirectory ? "Home entry fixture compiles for direct Node browser verification"
  : "loading Home context menu stays responsive without the engine (isolated Chromium)", async () => {
  const scratch = fileURLToPath(new URL("../../../../../.tmp-tsc/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const directory = exportDirectory ? resolve(exportDirectory) : await mkdtemp(join(scratch, "fenel-home-entry-menu-"));
  if (!directory.startsWith(resolve(scratch) + sep)) throw new Error("Home entry export escaped its repository scratch directory");
  await mkdir(directory, { recursive: true });
  try {
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    async function componentSource(path: string) {
      const file = path.replaceAll("\\", "/").split("/").at(-1);
      if (snapshotHomeOnly && file === "home-entry.tsx") return readFile(resolve(snapshotHomeOnly), "utf8");
      if (snapshotHome && ["home-entry.tsx", "workspace-surface.tsx"].includes(file!)) {
        return readFile(join(resolve(snapshotHome), file!), "utf8");
      }
      if (!baselineHome || !["home-entry.tsx", "workspace-surface.tsx"].includes(file!)) return readFile(path, "utf8");
      const revision = Bun.spawn(["git", "--no-optional-locks", "-c", "core.preloadIndex=false", "-c", "core.fsmonitor=false",
        "show", `${baselineHome}:distros/narthex/solid/src/lib/${file}`], {
        cwd: fileURLToPath(new URL("../../../../../", import.meta.url)), stdout: "pipe", stderr: "pipe",
      });
      const [code, source, error] = await Promise.all([revision.exited, new Response(revision.stdout).text(), new Response(revision.stderr).text()]);
      if (code !== 0) throw new Error(`Could not read prior Home entry: ${error}`);
      return source;
    }
    const browser = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./home-entry-context-menu.fixture.tsx", import.meta.url))],
      target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "home-entry-engine-boundary", setup(build) {
        build.onResolve({ filter: /^\.\/related-data-panels$/ }, args => {
          if (args.kind !== "dynamic-import") throw new Error("Early Home eagerly imports related typed panel bodies");
          return { path: args.path, external: true };
        });
        build.onResolve({ filter: /^\.\/DataValueSurface$/ }, args => {
          if (args.kind !== "dynamic-import") throw new Error("Early scalar previews eagerly import their structural data owner");
          return { path: "data-transfer/DataValueSurface", external: true };
        });
        build.onResolve({ filter: /^\.\/index$/ }, (args) => {
          if (!args.importer.replaceAll("\\", "/").endsWith("/expression-runner/ExpressionEditor.tsx")) return;
          if (args.kind !== "dynamic-import") throw new Error("Held expression inspection eagerly imports its semantic controller");
          return { path: "./expression-runner/index", external: true };
        });
        build.onResolve({ filter: /^(?:\.\.\/routes\/app\/home|\.\/workspace-authoring-provider)$/ }, (args) => {
          if (args.kind !== "dynamic-import") throw new Error(`Workspace eagerly imports ${args.path}`);
          return { path: args.path, external: true };
        });
        build.onResolve({ filter: /^\.\/prompt-body$/ }, (args) => {
          if (args.kind !== "dynamic-import") throw new Error("Early Home eagerly imports the typed prompt body");
          return { path: args.path, external: true };
        });
        build.onResolve({ filter: /^\.\/reader-presentation$/ }, (args) => {
          if (args.kind !== "dynamic-import") throw new Error("Early Home eagerly imports checked reader presentation");
          return { path: args.path, external: true };
        });
        build.onResolve({ filter: /^\.\/early-read-value$/ }, (args) => {
          if (args.kind !== "dynamic-import") throw new Error("Early Home eagerly imports the checked result reader");
          return { path: args.path, external: true };
        });
        build.onResolve({ filter: /^\.\/locus-card-evaluation$/ }, (args) => {
          if (args.kind !== "dynamic-import") throw new Error("Early Home eagerly imports its evaluator");
          return { path: args.path, external: true };
        });
        build.onResolve({ filter: /^\.\/(?:layout-renderer\/TypedReadValue|data-transfer\/DataValueSurface|reader-runtime|locus-layout-options)$/ }, (args) => {
          if (args.kind !== "dynamic-import") throw new Error(`Early Home eagerly imports ${args.path}`);
          return { path: args.path, external: true };
        });
        build.onResolve({ filter: /^\.\/reader-source-metadata$/ }, (args) => {
          if (args.kind !== "dynamic-import") throw new Error("Early Home eagerly imports reader source metadata");
          return { path: args.path, external: true };
        });
        build.onResolve({ filter: /^\.\/expression-runner\/(?:local-field-names|authoring-catalogue-transport)$/ }, (args) => {
          if (args.kind !== "dynamic-import") throw new Error(`Early Home eagerly imports ${args.path}`);
          return { path: args.path, external: true };
        });
        build.onResolve({ filter: /^\.\.\/local-locus-data$/ }, (args) => {
          if (args.kind !== "dynamic-import") throw new Error("Early transfer capture eagerly imports the Local data owner");
          return { path: args.path, external: true };
        });
        // A deep relative import bypasses the @fenel/ boundary above: refuse any
        // static import that resolves into the engine or runtime sources.
        build.onResolve({ filter: /implementations\/typescript\// }, (args) => {
          if (args.kind !== "dynamic-import") throw new Error(`Lightweight Home eagerly imports ${args.path}`);
          return { path: args.path, external: true };
        });
        build.onResolve({ filter: /^\.\/workspace-model-loader$/ }, (args) => {
          if (args.kind !== "dynamic-import") throw new Error("Early Home eagerly imports the lens model");
          return { path: "lens-model", namespace: "home-entry-lens-fixture" };
        });
        // C2: this early-menu fixture holds the semantic model; its ordinary
        // toolbar data matches the source's three presentation shortcuts.
        build.onLoad({ filter: /.*/, namespace: "home-entry-lens-fixture" }, () => ({ loader: "js", contents: `
          const shortcuts = [
            { $tag: "LensShortcut", id: "data", label: "Data", icon: "stack", operation: { $tag: "PresentLensSubject", subject: { $tag: "CurrentDataSubject" } }, disposition: { $tag: "PresentExistingData" }, presentation: { $tag: "Nothing" } },
            { $tag: "LensShortcut", id: "expression", label: "Expression", icon: "branch", operation: { $tag: "PresentLensSubject", subject: { $tag: "ProducerExpressionSubject" } }, disposition: { $tag: "PresentExistingData" }, presentation: { $tag: "Nothing" } },
            { $tag: "LensShortcut", id: "code", label: "Code", icon: "code", operation: { $tag: "PresentLensSubject", subject: { $tag: "ProducerExpressionSubject" } }, disposition: { $tag: "PresentExistingData" }, presentation: { $tag: "Just", _0: { $tag: "CodePresentation" } } }
          ];
          export async function loadWorkspaceModel() { return { workspaceCall: () => shortcuts }; }
        ` }));
        // The shell paints pictures later. The real module pulls the image engine,
        // so the test keeps a stub and still rejects a static import.
        build.onResolve({ filter: /^\.\/image-pipeline-preview$/ }, (args) => {
          if (args.kind !== "dynamic-import") throw new Error(`Lightweight Home eagerly imports ${args.path}`);
          return { path: "image-pipeline-preview", namespace: "home-entry-stub" };
        });
        build.onLoad({ filter: /.*/, namespace: "home-entry-stub" }, () => ({
          loader: "js",
          contents: "export function evaluateImagePipeline() { return undefined; }\nexport function readImagePipelinePreview() { return undefined; }\n",
        }));
        build.onResolve({ filter: /^(?:@fenel\/|\.\/authoring-json$|\.\/expression-runner\/(?:account-authoring-session|authoring-session|authoring-catalog-worker)$)/ }, (args) => {
          if (args.path === "@fenel/engine/checkpoint-json") return { path: fileURLToPath(new URL("../../../../../implementations/typescript/engine/src/checkpoint-json.ts", import.meta.url)) };
          if (args.path === "@fenel/engine/maybe-value") return { path: fileURLToPath(new URL("../../../../../implementations/typescript/engine/src/maybe-value.ts", import.meta.url)) };
          if (args.path === "@fenel/engine/inference-transport") return { path: fileURLToPath(new URL("../../../../../implementations/typescript/engine/src/inference-transport.ts", import.meta.url)) };
          if (args.kind !== "dynamic-import") throw new Error(`Lightweight Home eagerly imports ${args.path}`);
          return { path: args.path, external: true };
        });
        build.onLoad({ filter: /\.tsx$/ }, async (args) => {
          let source = await componentSource(args.path);
          if (nullBaseline && args.path.replaceAll("\\", "/").endsWith("/home-entry.tsx")) {
            source = source.replace("if (entered && entered.runtime === state.runtime", "if (entered?.runtime === state.runtime");
          }
          if (args.path.replaceAll("\\", "/").endsWith("/home-entry-context-menu.fixture.tsx")) {
            const shelf = (await componentSource(fileURLToPath(new URL("./workspace-surface.tsx", import.meta.url)))).replace(/\r\n/g, "\n");
            const start = shelf.indexOf("  const rootHandlers = new Set<"), end = shelf.indexOf("  createEffect(() => composerSearch.new", start);
            if (start < 0 || end <= start) throw new Error("Production root shelf fixture boundary moved");
            source = `Object.assign(globalThis, { fixtureRootShelfFactory: (props, exploreData, frame) => {
              const surfaceClosed = false, active = frame.active, value = frame.value;
              const useSearchParams = () => [{}, () => {}];
              const address = { initialLoading: () => false, initialRootSource: () => undefined };
              ${shelf.slice(start, end)}
              return { shelf: rootShelf, canCreate: () => [...rootHandlers].map(handler => handler.canCreate()) };
            } });\n` + source;
          }
          return { loader: "ts", contents: (await compiler.transformAsync(source, {
            filename: args.path, generate: "dom", hydratable: false, dev: true,
          })).code };
        });
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }],
    });
    if (!browser.success) throw new AggregateError(browser.logs, "Home entry browser fixture build failed");
    const browserPath = join(directory, "browser.js");
    await writeFixtureArtifact(browserPath, browser.outputs[0]!);
    const cssPath = join(directory, "styles.css");
    const styles = await Promise.all(["../global.css", "../routes/app.css", "./home-entry.css", "./workspace-surface.css", "./lens-data-summary.css", "./loading-screen/loading-screen.css", "./desktop-data.css", "./locus-notifications.css", "./confirm-modal/confirm-modal.css", "./locus-context-menu.css", "./data-inspection-dialog.css", "./admin-form/admin-form.css", "./data-transfer/data-transfer.css", "./expression-runner/structural-surfaces.css"]
      .map((path) => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8")));
    await writeFixtureArtifact(cssPath, styles.join("\n"));
    const captureDirectory = process.env["FENEL_HOME_ENTRY_CAPTURE_DIR"];
    if (captureDirectory) {
      const repository = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
      const target = resolve(repository, captureDirectory);
      if (!target.startsWith(repository + sep)) throw new Error("Home entry capture escaped its repository");
      await mkdir(target, { recursive: true });
      await writeFixtureArtifact(join(target, "browser.js"), browser.outputs[0]!);
      await writeFixtureArtifact(join(target, "styles.css"), styles.join("\n"));
    }
    const runner = await Bun.build({ entrypoints: [fileURLToPath(new URL("./home-entry-context-menu.node-fixture.ts", import.meta.url))], target: "node", packages: "external" });
    if (!runner.success) throw new AggregateError(runner.logs, "Home entry Node fixture build failed");
    const nodePath = join(directory, "runner.mjs");
    await writeFixtureArtifact(nodePath, await runner.outputs[0]!.text());
    if (exportDirectory) {
      console.log(`Home entry browser fixture exported to ${directory}`);
      return;
    }
    const testPattern = process.env["FENEL_HOME_ENTRY_TEST_PATTERN"];
    const child = Bun.spawn(["node", "--test-reporter=tap", ...(testPattern ? [`--test-name-pattern=${testPattern}`] : []), nodePath, browserPath, cssPath], { stdout: "pipe", stderr: "pipe",
      env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("# fail 0");
    expect(stdout).toMatch(/# pass [1-9]\d*(?:\r?\n|$)/);
    if (!testPattern) {
      expect(stdout).toContain("# skipped 0");
      expect(stdout.match(/# pass (\d+)/)?.[1]).toBe(stdout.match(/# tests (\d+)/)?.[1]);
    }
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Home entry fixture cleanup escaped its workspace scratch directory");
    if (!exportDirectory) await rm(target, { recursive: true, force: true });
  }
  // 102 Chromium scenarios take about four and a half minutes on a loaded host.
}, 480_000);
