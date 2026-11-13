import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { writeVerifiedArtifact } from "../../../../../scripts/lib/verified-artifact-io.mjs";

const writeArtifact = (path: string, source: string | Blob) => typeof source === "string"
  ? writeVerifiedArtifact(path, new TextEncoder().encode(source))
  : source.arrayBuffer().then(bytes => writeVerifiedArtifact(path, new Uint8Array(bytes)));

const exportDirectory = process.env["FENEL_STARTUP_FIXTURE_EXPORT_DIR"];
const priorNavigation = process.env["FENEL_STARTUP_FIXTURE_VARIANT"] === "before";
const navigationBaseline = process.env["FENEL_STARTUP_FIXTURE_BASELINE"] ?? "HEAD";
const ownerNavigation = process.env["FENEL_STARTUP_TEST_OWNER_NAVIGATION"] === "1";
const loadingRegression = process.env["FENEL_STARTUP_TEST_LOADING"] !== "0" && !ownerNavigation && !priorNavigation;
const sourceSnapshot = process.env["FENEL_STARTUP_FIXTURE_SOURCE_DIR"];

test.skipIf(!!exportDirectory || !!sourceSnapshot)("prepared lens acquisition releases canceled, failed and stale stores exactly once", async () => {
  // Exercise the production acquisition transaction without importing the
  // renderer graph or initializing an engine registry. Only its IO owners are
  // controlled; the helper's actual code chooses and disposes resources.
  const source = await Bun.file(fileURLToPath(new URL("./workspace-surface.tsx", import.meta.url))).text();
  const start = source.indexOf("export async function acquireWorkspaceSurface(");
  const end = source.indexOf("\nexport default function WorkspaceSurface", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const compiled = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end).replace(/^export /, ""));
  type TestStore = { personalAccountId: string; dispose: () => void };
  type Account = { accountId: string; name: string; slug: string };
  type Ready = { store: TestStore; epoch: number; accountId?: string; accounts: Array<{ id: string; label: string; slug?: string }>; dispose: () => void };
  type Acquire = (bootstrap: { accounts: Account[] } | undefined,
    options: { accountId?: string; epoch: number; signal: AbortSignal }) => Promise<Ready>;
  const factory = new Function("loadWorkspacePreferences", "listAccessibleAccounts", "assertCurrentSession",
    `${compiled}\nreturn acquireWorkspaceSurface;`) as (
      preferences: (...args: unknown[]) => Promise<TestStore>, roster: () => Promise<Account[]>, epoch: (epoch: number) => void,
    ) => Acquire;
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  const roster: Account[] = [{ accountId: "reader", name: "Reader", slug: "reader" },
    { accountId: "personal", name: "Personal", slug: "personal" }];

  {
    let disposals = 0;
    let rosterReads = 0;
    let preferenceSignal: AbortSignal | undefined;
    const store: TestStore = { personalAccountId: "personal", dispose: () => { disposals++; } };
    const controller = new AbortController();
    const bootstrap = { accounts: roster };
    const acquire = factory(async (account, epoch, supplied, signal) => {
      expect([account, epoch]).toEqual(["reader", 4]);
      expect(supplied).toBe(bootstrap);
      expect(signal).toBeInstanceOf(AbortSignal);
      preferenceSignal = signal as AbortSignal;
      expect(preferenceSignal.aborted).toBe(false);
      return store;
    }, async () => { rosterReads++; return roster; }, epoch => { expect(epoch).toBe(4); });
    const ready = await acquire(bootstrap, { accountId: "reader", epoch: 4, signal: controller.signal });
    expect(ready.store).toBe(store);
    expect(ready.accounts).toEqual([{ id: "reader", label: "Reader", slug: "reader" }]);
    expect(rosterReads).toBe(0);
    ready.dispose();
    expect(preferenceSignal?.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    ready.dispose(); controller.abort();
    expect(disposals).toBe(1);
  }

  {
    let disposals = 0;
    const preferences = deferred<TestStore>();
    const controller = new AbortController();
    const acquire = factory(() => preferences.promise, async () => roster, () => {});
    const pending = acquire({ accounts: roster }, { accountId: "reader", epoch: 4, signal: controller.signal });
    void pending.catch(() => {});
    controller.abort();
    preferences.resolve({ personalAccountId: "personal", dispose: () => { disposals++; } });
    await expect(pending).rejects.toThrow("closed");
    expect(disposals).toBe(1);
  }

  {
    let disposals = 0;
    const rosterAnswer = deferred<Account[]>();
    const acquire = factory(async () => ({ personalAccountId: "personal", dispose: () => { disposals++; } }),
      () => rosterAnswer.promise, () => {});
    const pending = acquire(undefined, { accountId: "reader", epoch: 4, signal: new AbortController().signal });
    void pending.catch(() => {});
    await Promise.resolve();
    rosterAnswer.reject(new Error("Roster unavailable"));
    await expect(pending).rejects.toThrow("Roster unavailable");
    expect(disposals).toBe(1);
  }

  {
    let disposals = 0;
    let preferenceSignal: AbortSignal | undefined;
    let abortedPreferenceReads = 0;
    const preferences = deferred<TestStore>();
    const controller = new AbortController();
    const acquire = factory((_account, _epoch, _bootstrap, signal) => {
      preferenceSignal = signal as AbortSignal;
      preferenceSignal.addEventListener("abort", () => { abortedPreferenceReads++; }, { once: true });
      return preferences.promise;
    }, async () => { throw new Error("Roster unavailable"); }, () => {});
    const pending = acquire(undefined, { accountId: "reader", epoch: 4, signal: controller.signal });
    expect(preferenceSignal?.aborted).toBe(false);
    await expect(pending).rejects.toThrow("Roster unavailable");
    expect(preferenceSignal?.aborted).toBe(true);
    expect(abortedPreferenceReads).toBe(1);
    expect(controller.signal.aborted).toBe(false);
    preferences.resolve({ personalAccountId: "personal", dispose: () => { disposals++; } });
    await Promise.resolve();
    controller.abort();
    expect(abortedPreferenceReads).toBe(1);
    expect(disposals).toBe(1);
  }

  {
    let currentEpoch = 4;
    let disposals = 0;
    const rosterAnswer = deferred<Account[]>();
    const acquire = factory(async () => ({ personalAccountId: "personal", dispose: () => { disposals++; } }),
      () => rosterAnswer.promise, epoch => { if (epoch !== currentEpoch) throw new Error("Session changed"); });
    const pending = acquire(undefined, { accountId: "reader", epoch: 4, signal: new AbortController().signal });
    void pending.catch(() => {});
    await Promise.resolve();
    currentEpoch = 5;
    rosterAnswer.resolve(roster);
    await expect(pending).rejects.toThrow("Session changed");
    expect(disposals).toBe(1);
  }
});

test(exportDirectory ? "workspace startup fixture compiles for an external browser capture"
  : "saved workspace paints through the lightweight graph before its model (isolated Chromium)", async () => {
  const temporaryRoot = fileURLToPath(new URL("../../../../../.tmp-diag/workspace-startup-tests/", import.meta.url));
  await mkdir(temporaryRoot, { recursive: true });
  const directory = exportDirectory ? resolve(exportDirectory) : await mkdtemp(join(temporaryRoot, "run-"));
  if (!directory.startsWith(resolve(temporaryRoot) + sep)) throw new Error("Workspace startup capture escaped the repository test directory");
  await mkdir(directory, { recursive: true });
  try {
    const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
    const priorNavigationFiles = new Set([
      "distros/narthex/solid/src/lib/home-entry.tsx", "distros/narthex/solid/src/lib/workspace-surface.tsx",
      "distros/narthex/solid/src/lib/locus-breadcrumb.tsx", "distros/narthex/solid/src/lib/lens-data-summary.tsx",
      "distros/narthex/solid/src/lib/home-entry.css", "distros/narthex/solid/src/lib/workspace-surface.css",
      "distros/narthex/solid/src/lib/lens-data-summary.css", "distros/narthex/solid/src/routes/app.css",
      "distros/narthex/solid/src/lib/workspace-startup.fixture.tsx",
      "distros/narthex/solid/src/lib/data-inspection-dialog.css",
    ]);
    async function sourceBytes(path: string) {
      const repositoryPath = relative(repositoryRoot, path).split(sep).join("/");
      if (sourceSnapshot) {
        const snapshotRoot = resolve(repositoryRoot, sourceSnapshot);
        if (!snapshotRoot.startsWith(resolve(repositoryRoot) + sep)) throw new Error("Startup source snapshot escaped the repository");
        const snapshot = Bun.file(join(snapshotRoot, repositoryPath));
        if (await snapshot.exists()) return snapshot.text();
      }
      if (!priorNavigation || !priorNavigationFiles.has(repositoryPath)) return Bun.file(path).text();
      const git = Bun.spawn(["git", "show", `${navigationBaseline}:${repositoryPath}`], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
      const [code, source, error] = await Promise.all([git.exited, new Response(git.stdout).text(), new Response(git.stderr).text()]);
      if (code !== 0) throw new Error(`Could not read prior navigation source: ${error}`);
      return source;
    }
    const buildProgress = (stage: string) => { if (process.env["FENEL_STARTUP_DEBUG_BUILD"] === "1") console.log(`Startup fixture: ${stage}`); };
    buildProgress("loading compiler");
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    buildProgress("loading image tooling");
    const imageToolsPath = Bun.resolveSync("imagetools-core", dirname(fileURLToPath(import.meta.resolve("vite-imagetools"))));
    const sharp = (await import(pathToFileURL(Bun.resolveSync("sharp", dirname(imageToolsPath))).href)).default;
    buildProgress("image tooling loaded");
    buildProgress("building browser graph");
    const browser = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./workspace-startup.fixture.tsx", import.meta.url))],
      target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "workspace-startup-engine-boundary", setup(build) {
        // The source's admitted ordinary data is controlled; the production
        // client, HomeEntry and reader requester remain the actual owners.
        build.onResolve({ filter: /^\.\/local-locus-data$/ }, args => args.importer.endsWith("workspace-startup.fixture.tsx")
          ? undefined : { path: "local-source", namespace: "workspace-startup-local" });
        build.onLoad({ filter: /.*/, namespace: "workspace-startup-local" }, () => ({ loader: "js", contents: `
          export const localTabDataSource = () => workspaceStartupFixture.localSource();
          export const localTabSourceId = () => workspaceStartupFixture.localSource().id;
          export const createLocalApiClient = source => workspaceStartupFixture.localClient(source);
        ` }));
        // Preserve the production backdrop and its actual image bytes; only
        // Vite's image-query transport is adapted for the isolated browser.
        build.onResolve({ filter: /^~\/assets\/hero\.jpg\?/ }, args => ({ path: args.path, namespace: "workspace-startup-image" }));
        build.onLoad({ filter: /.*/, namespace: "workspace-startup-image" }, async args => {
          const options = new URLSearchParams(args.path.split("?")[1]);
          const widths = (options.get("w") || "1200").split(";").map(Number);
          const format = options.get("format") || "jpeg";
          const imagePath = fileURLToPath(new URL("../assets/hero.jpg", import.meta.url));
          const images = await Promise.all(widths.map(async width => {
            const bytes = await sharp(imagePath).resize({ width }).toFormat(format).toBuffer();
            return `data:image/${format};base64,${bytes.toString("base64")}`;
          }));
          const value = options.get("as") === "srcset" ? images.map((data, index) => `${data} ${widths[index]}w`).join(", ") : images[0];
          return { loader: "js", contents: `export default ${JSON.stringify(value)};` };
        });
        if (loadingRegression) {
          // Keep the actual reader. Only a newly opened descendant's async
          // acquisition is held to exercise the production loading boundaries.
          build.onResolve({ filter: /^\.\/home-entry$/ }, args => args.importer.endsWith("workspace-startup.fixture.tsx")
            ? undefined : { path: "loading-reader", namespace: "workspace-startup-loading" });
          build.onLoad({ filter: /.*/, namespace: "workspace-startup-loading" }, () => ({ loader: "js", contents:
            "export default function LoadingReader(props) { return workspaceStartupFixture.renderLoadingReader(props); }" }));
          build.onResolve({ filter: /^\.\/workspace-preferences$/ }, args => args.importer.endsWith("workspace-startup.fixture.tsx")
            ? undefined : { path: "loading-preferences", namespace: "workspace-startup-loading-preferences" });
          build.onLoad({ filter: /.*/, namespace: "workspace-startup-loading-preferences" }, () => ({ loader: "js", contents:
            "export const loadWorkspacePreferences = (...args) => workspaceStartupFixture.loadPreferences(...args);" }));
        }
        if (ownerNavigation) {
          // The navigation owner and preference store are real. Its data-reader
          // child only registers the actual pane callbacks and flush boundary.
          build.onResolve({ filter: /^\.\/home-entry$/ }, () => ({ path: "pane", namespace: "workspace-startup-pane" }));
          // A virtual module resolves its own imports (solid-js) from this directory.
          build.onLoad({ filter: /.*/, namespace: "workspace-startup-pane" }, () => ({ loader: "js", resolveDir: fileURLToPath(new URL(".", import.meta.url)), contents: `
            import { createEffect, onSettled } from "solid-js";
            export default function HomeEntry(props) {
              onSettled(() => workspaceStartupFixture.registerPane(props.pane));
              const body = document.createElement("div");
              body.style.cssText = "padding:24px;color:#525866;font:14px system-ui";
              createEffect(() => ({ source: props.pane.source(), focus: props.pane.focus(), presentation: props.pane.presentation() }), state => {
                body.textContent = "Controlled data reader · " + (state.source.accountId || state.source.$tag)
                  + " · " + (state.focus.itemId || state.focus.viewId || "All data") + " · " + (state.presentation || "Automatic");
              });
              return body;
            }
          ` }));
        }
        // Keep the actual model loader and its dynamic imports. The scheduling
        // boundary is immediate in this test; the model module itself is held.
        build.onResolve({ filter: /^\.\/workspace-module-preload$/ }, () => ({ path: "preload", namespace: "workspace-startup-host" }));
        build.onLoad({ filter: /.*/, namespace: "workspace-startup-host" }, () => ({ loader: "js", contents: `
          export const WORKSPACE_IMPORT_LIMIT_MS = 240000;
          export class WorkspaceLoadTimeoutError extends Error {}
          export async function preloadWorkspaceModules() {}
          export async function preloadWorkspaceSlice(_name, load) { return load(); }
          export async function withinWorkspaceLimit(_name, load) { return load(); }
        ` }));
        build.onLoad({ filter: /.*/, namespace: "workspace-startup-codec" }, async () => {
          // C1/C2: compile the real codec into the fixture, holding the semantic
          // owners it normally imports. None of those owners is replaced by a
          // positive answer; touching one fails this presentation-only fixture.
          const authoring = fileURLToPath(new URL("../../../../../implementations/typescript/engine/src/authoring/expression-authoring.ts", import.meta.url));
          const operators = fileURLToPath(new URL("../../../../../implementations/typescript/engine/src/authoring/expression-operators.ts", import.meta.url));
          const transpiler = new Bun.Transpiler({ loader: "ts" });
          const source = transpiler.transformSync(await sourceBytes(authoring))
            .replace(/^(?:import[\s\S]*?from|export\s*\{[\s\S]*?\}\s*from)\s*["'][^"']+["'];?\s*$/gm, "");
          return { loader: "js", contents: `
            import { Nothing } from "@fenel/engine/maybe-value";
            const unavailable = () => { throw new Error("The startup presentation fixture has no prepared semantic owner"); };
            const peelList = unavailable, peelMaybe = unavailable, peelResult = unavailable;
            const refHandle = unavailable, functionRefHandle = unavailable;
            const isCompileFieldSlot = unavailable, compileFieldSlotWireName = unavailable;
            const engineRequire = unavailable, inferJsonLogicPatternBindings = unavailable, inferJsonLogicType = unavailable;
            ${transpiler.transformSync(await sourceBytes(operators))}
            ${source}
          ` };
        });
        build.onResolve({ filter: /^(?:@fenel\/|\.{1,2}\/|~\/)/ }, (args) => {
          // Test the actual lazy HomeSurface-to-WorkspaceSurface handoff. Its
          // heavy reader/model imports stay controlled at the boundaries below.
          if (args.kind === "dynamic-import" && args.path === "./workspace-surface") return undefined;
          if (args.path.startsWith("@fenel/")) {
            if (args.path === "@fenel/engine/authoring/expression") {
              // Reference identity uses the actual codec's executable slots.
              // Keep that source owner rather than supplying invented empty
              // dependencies at the browser fixture boundary.
              return { path: "authoring-expression", namespace: "workspace-startup-codec" };
            }
            if (args.path === "@fenel/engine/checkpoint-json" || args.path === "@fenel/engine/maybe-value"
              || args.path === "@fenel/engine/inference-transport") {
              return { path: fileURLToPath(new URL(`../../../../../implementations/typescript/engine/src/${args.path.split("/").at(-1)}.ts`, import.meta.url)) };
            }
            if (args.kind !== "dynamic-import") throw new Error(`Workspace startup eagerly imports ${args.path}`);
          }
          if (args.kind === "dynamic-import") return { path: `/fixture/dynamic/${encodeURIComponent(args.path)}`, external: true };
          return undefined;
        });
        build.onLoad({ filter: /\.tsx$/ }, async (args) => ({ loader: "ts", contents: (await compiler.transformAsync(await sourceBytes(args.path), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
        if (sourceSnapshot) build.onLoad({ filter: /\.ts$/ }, async args => ({ loader: "ts", contents: await sourceBytes(args.path) }));
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }],
    });
    buildProgress("browser graph built");
    if (!browser.success) throw new AggregateError(browser.logs, "Workspace startup browser graph failed");
    const browserPath = join(directory, "browser.js");
    await writeArtifact(browserPath, browser.outputs[0]!);
    const cssPath = join(directory, "styles.css");
    const styles = await Promise.all(["../global.css", "../routes/app.css", "./locus-background.css", "./home-entry.css", "./lens-data-summary.css", "./layout-renderer/typed-read-value.css", "./data-inspection-dialog.css", "./loading-screen/loading-screen.css", "./workspace-surface.css", "./locus-select.css", "./locus-layout-control.css", "./locus-context-menu.css", "./locus-quick-value.css", "./locus-notifications.css", "./confirm-modal/confirm-modal.css"]
      .map((path) => sourceBytes(fileURLToPath(new URL(path, import.meta.url)))));
    await writeArtifact(cssPath, styles.join("\n"));
    const runner = await Bun.build({ entrypoints: [fileURLToPath(new URL("./workspace-startup.node-fixture.ts", import.meta.url))], target: "node", packages: "external" });
    if (!runner.success) throw new AggregateError(runner.logs, "Workspace startup Node fixture failed");
    const nodePath = join(directory, "runner.mjs");
    await writeArtifact(nodePath, await runner.outputs[0]!.text());
    const testPattern = process.env["FENEL_STARTUP_TEST_PATTERN"];
    const shellPath = fileURLToPath(new URL("../routes/app.tsx", import.meta.url));
    const logoPath = fileURLToPath(new URL("../assets/logo.png", import.meta.url));
    if (exportDirectory) {
      await writeArtifact(join(directory, "fixture-paths.json"), JSON.stringify({ browserPath, cssPath, nodePath, shellPath, logoPath,
        navigation: priorNavigation ? "before" : "after", baseline: priorNavigation ? navigationBaseline : undefined,
        priorFiles: priorNavigation ? [...priorNavigationFiles] : [] }));
      console.log(`Workspace startup browser fixture exported to ${directory}`);
      return;
    }
    const child = Bun.spawn(["node", ...(testPattern ? [`--test-name-pattern=${testPattern}`] : []), nodePath, browserPath, cssPath, shellPath, logoPath], { stdout: "pipe", stderr: "pipe",
      env: { ...process.env, TEMP: directory, TMP: directory,
        FENEL_TEST_PLAYWRIGHT_MODULE: process.env["FENEL_TEST_PLAYWRIGHT_MODULE"] ?? createRequire(import.meta.url).resolve("playwright") } });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("# fail 0");
    expect(stdout).toContain("# cancelled 0");
    const passed = stdout.match(/# pass ([1-9]\d*)(?:\r?\n|$)/);
    expect(passed).not.toBeNull();
    if (!testPattern) {
      expect(stdout).toContain("# skipped 0");
      expect(Number(passed?.[1])).toBe(Number(stdout.match(/# tests (\d+)(?:\r?\n|$)/)?.[1]));
    }
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(temporaryRoot) + sep)) throw new Error("Workspace startup cleanup escaped the repository test directory");
    if (!exportDirectory) await rm(target, { recursive: true, force: true });
  }
}, 120_000);
