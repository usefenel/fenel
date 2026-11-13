import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("startup Loading retires while epoch-owned readers keep their local guard", async () => {
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const scratch = join(root, ".tmp-diag", "startup-boundary-tests");
  await mkdir(scratch, { recursive: true });
  const exported = process.env["FENEL_STARTUP_BOUNDARY_EXPORT_DIR"];
  const directory = exported ? resolve(exported) : await mkdtemp(join(scratch, "run-"));
  if (!directory.startsWith(resolve(scratch) + sep)) throw new Error("Startup boundary fixture escaped repository scratch");
  await mkdir(directory, { recursive: true });
  try {
    // Compile the application's actual outer boundary. The controlled reader
    // uses the same native Loading/epoch-keyed structure and holds only data.
    const app = await Bun.file(new URL("../App.tsx", import.meta.url)).text();
    const boundary = app.match(/<Loading\b[\s\S]*?\{props\.children\}<\/Loading>/)?.[0];
    if (!boundary) throw new Error("The application startup boundary changed");
    const fixture = `
      import { Errored, Loading, Show, createMemo, createSignal, onCleanup } from "solid-js";
      import { render } from "@solidjs/web";
      const deferred = () => { let resolve; const promise = new Promise(yes => resolve = yes); return { promise, resolve }; };
      const initial = deferred(), replacement = deferred(), jobs = [], mounted = [], retired = [], errors = [];
      const [sessionEpoch, setEpoch] = createSignal(7), [late, setLate] = createSignal(false);
      const startup = createMemo(() => initial.promise);
      let shellMounts = 0;
      function LoadingScreen() { return <div data-app-startup>Initial application loading</div>; }
      function LocusBackground() { return <div data-app-backdrop />; }
      function AppBoundary(props) { shellMounts++; return ${boundary}; }
      function Reader(props) {
        mounted.push(props.epoch);
        onCleanup(() => retired.push(props.epoch));
        const ready = createMemo(() => props.epoch === 7 ? Promise.resolve("Reader 7") : replacement.promise);
        return <div data-private-reader={props.epoch}>{ready()}</div>;
      }
      function Later() {
        const job = deferred(); jobs.push(job);
        const result = createMemo(() => job.promise);
        return <div data-late-result>{result()}</div>;
      }
      const dispose = render(() => <Errored fallback={error => {
        errors.push(String(error())); return <div data-error>{String(error())}</div>;
      }}><AppBoundary><Show when={startup()}><section data-lens><h1>Mounted lens</h1>
        <Show when={sessionEpoch()} keyed>{epoch => <Loading on={epoch}
          fallback={<div data-reader-pending>Reader {epoch} preparing</div>}><Reader epoch={epoch} /></Loading>}</Show>
        <Show when={late()}><Later /></Show>
      </section></Show></AppBoundary></Errored>, document.body);
      globalThis.startupBoundary = {
        initial: () => initial.resolve(true), later: () => setLate(true), complete: index => jobs[index].resolve("Later ready"),
        changeEpoch: () => { setLate(false); setEpoch(8); }, replacement: () => replacement.resolve("Reader 8"),
        state: () => ({ epoch: sessionEpoch(), jobs: jobs.length, shellMounts, mounted: [...mounted], retired: [...retired], errors: [...errors] }), dispose,
      };
    `;
    const fixturePath = join(directory, "fixture.tsx");
    await Bun.write(fixturePath, fixture);
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const solidEntry = await realpath(fileURLToPath(new URL("../../node_modules/solid-js/dist/solid.dev.js", import.meta.url)));
    const webEntry = await realpath(fileURLToPath(new URL("../../node_modules/@solidjs/web/dist/web.dev.js", import.meta.url)));
    const built = await Bun.build({ entrypoints: [fixturePath], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "production-startup-loading-dom", setup(build) {
        // Scratch stays outside the package so TypeScript never includes the
        // generated fixture. Resolve its renderer imports from this distro.
        build.onResolve({ filter: /^solid-js$/ }, () => ({ path: solidEntry }));
        build.onResolve({ filter: /^@solidjs\/web$/ }, () => ({ path: webEntry }));
        build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await Bun.file(args.path).text(), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
      } }] });
    if (!built.success) throw new AggregateError(built.logs, "Startup boundary fixture failed to compile");
    const browserPath = join(directory, "browser.js"), runnerPath = join(directory, "runner.mjs");
    await Bun.write(browserPath, built.outputs.find(output => output.kind === "entry-point")!);
    await Bun.write(runnerPath, `
      import { readFile } from "node:fs/promises";
      import { strict as assert } from "node:assert";
      import { chromium } from ${JSON.stringify(import.meta.resolve("playwright"))};
      const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
      try {
        const page = await browser.newPage(); page.setDefaultTimeout(10000);
        const errors = []; page.on("pageerror", error => errors.push(error.message));
        await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
        await page.goto("https://fenel.test/");
        await page.addScriptTag({ content: await readFile(process.argv[2], "utf8"), type: "module" });
        await page.locator("[data-app-startup]").waitFor();
        assert.equal(await page.locator("[data-lens]").count(), 0);
        await page.evaluate(() => startupBoundary.initial());
        await page.locator('[data-private-reader="7"]').waitFor();
        const kept = async () => { assert.equal(await page.locator("[data-app-startup]").count(), 0);
          assert.equal(await page.locator("[data-lens]").count(), 1); assert.equal((await page.evaluate(() => startupBoundary.state())).shellMounts, 1); };
        await kept();
        await page.evaluate(() => startupBoundary.later());
        await page.waitForFunction(() => startupBoundary.state().jobs === 1);
        await kept(); assert.equal(await page.locator('[data-private-reader="7"]').count(), 1);
        await page.evaluate(() => startupBoundary.complete(0));
        await page.locator("[data-late-result]").filter({ hasText: "Later ready" }).waitFor();
        await page.evaluate(() => startupBoundary.changeEpoch());
        await page.locator("[data-reader-pending]").filter({ hasText: "Reader 8 preparing" }).waitFor();
        await kept(); assert.equal(await page.locator('[data-private-reader="7"]').count(), 0);
        assert.deepEqual((await page.evaluate(() => startupBoundary.state())).retired, [7]);
        await page.evaluate(() => startupBoundary.replacement());
        await page.locator('[data-private-reader="8"]').filter({ hasText: "Reader 8" }).waitFor();
        await kept(); assert.equal(await page.locator("[data-reader-pending]").count(), 0);
        await page.evaluate(() => startupBoundary.later());
        await page.waitForFunction(() => startupBoundary.state().jobs === 2);
        await kept(); assert.equal(await page.locator('[data-private-reader="8"]').count(), 1);
        await page.evaluate(() => startupBoundary.complete(1));
        await page.locator("[data-late-result]").filter({ hasText: "Later ready" }).waitFor();
        await kept(); assert.deepEqual(errors, []);
        const state = await page.evaluate(() => startupBoundary.state());
        assert.deepEqual(state.errors, []); assert.deepEqual(state.mounted, [7, 8]);
        console.log(JSON.stringify({ passed: true, scope: "production startup Loading DOM", state }));
      } finally { await browser.close(); }
    `);
    if (exported) { console.log(`Startup boundary fixture exported to ${directory}`); return; }
    const child = Bun.spawn(["node", runnerPath, browserPath], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exit !== 0) throw new Error(`Startup boundary DOM fixture failed:\n${stdout}\n${stderr}`);
    expect(stdout).toContain('"passed":true'); console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Startup boundary cleanup escaped repository scratch");
    if (!exported) await rm(target, { recursive: true, force: true });
  }
}, 90_000);

test("application route import errors use the shared startup card and reload the same address", async () => {
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const source = join(root, "distros", "narthex", "solid", "src");
  const scratch = join(root, ".tmp-diag", "startup-boundary-tests");
  await mkdir(scratch, { recursive: true });
  const captured = process.env["FENEL_ROOT_ERROR_CAPTURE_DIR"];
  const baseline = process.env["FENEL_ROOT_ERROR_BASELINE"] === "1";
  const directory = captured ? resolve(captured) : await mkdtemp(join(scratch, "root-error-"));
  if (!directory.startsWith(resolve(scratch) + sep)) throw new Error("Root error fixture escaped repository scratch");
  await mkdir(directory, { recursive: true });
  try {
    const fixturePath = join(directory, "fixture.tsx");
    await Bun.write(fixturePath, `
      import { render } from "@solidjs/web";
      import App from ${JSON.stringify(join(source, "App.tsx"))};
      import { LoadingScreen } from "~/lib/loading-screen";
      const comparison = location.search.includes("loading-comparison");
      const ordinaryError = location.search.includes("ordinary-error");
      render(() => comparison ? <LoadingScreen inline page detail="Loading data…" />
        : ordinaryError ? <LoadingScreen inline error="Ordinary lens failure" /> : <App />, document.body);
    `);
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const solidEntry = await realpath(fileURLToPath(new URL("../../node_modules/solid-js/dist/solid.dev.js", import.meta.url)));
    const webEntry = await realpath(fileURLToPath(new URL("../../node_modules/@solidjs/web/dist/web.dev.js", import.meta.url)));
    const imageToolsPath = Bun.resolveSync("imagetools-core", dirname(fileURLToPath(import.meta.resolve("vite-imagetools"))));
    const sharp = (await import(pathToFileURL(Bun.resolveSync("sharp", dirname(imageToolsPath))).href)).default;
    // Only routing, metadata, image transforms, and host IO/transition adapters
    // are controlled. App's Errored, shared LoadingScreen, LocusLoadFailure and
    // LocusBackground are the actual production components.
    const adapters: Record<string, string> = {
      "virtual:file-routes": "export const pageRoutes = [];",
      "@solidjs/meta": "export const Title = () => null;",
      "@solidjs/router/fs": "export const fileRoutes = routes => routes;",
      "@solidjs/router": `
        import { createMemo } from "solid-js";
        function Route() {
          const module = createMemo(() => import("/fixture-route.mjs"));
          return <section data-recovered-route>{module().default}</section>;
        }
        export const createRouter = () => Object.assign(function Router(props) {
          return props.children({ get children() { return <Route />; } });
        }, { paths: {} });
      `,
      "api": 'export const apiReadConnectionStatus = () => "connected";',
      "confirm-modal": `export const createModalTransition = () => () => {};
        export const openModalDialog = dialog => dialog.showModal();
        export const closeModalDialog = dialog => dialog.close();`,
    };
    const baselineNames = new Map([
      [join(source, "App.tsx"), "App.tsx"],
      [join(source, "global.css"), "global.css"],
      [join(source, "lib", "loading-screen", "index.tsx"), "loading-screen.tsx"],
      [join(source, "lib", "loading-screen", "loading-screen.css"), "loading-screen.css"],
      [join(source, "lib", "locus-background.tsx"), "locus-background.tsx"],
      [join(source, "lib", "locus-background.css"), "locus-background.css"],
    ]);
    const contents = async (path: string) => {
      const name = baselineNames.get(path);
      return Bun.file(baseline && name ? join(scratch, "root-error-baseline", name) : path).text();
    };
    const css: string[] = [];
    const built = await Bun.build({ entrypoints: [fixturePath], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "production-root-error-dom", setup(build) {
        build.onResolve({ filter: /^\/fixture-route\.mjs$/ }, args => ({ path: args.path, external: true }));
        build.onResolve({ filter: /^solid-js$/ }, () => ({ path: solidEntry }));
        build.onResolve({ filter: /^@solidjs\/web$/ }, () => ({ path: webEntry }));
        build.onResolve({ filter: /^(virtual:file-routes|@solidjs\/(meta|router|router\/fs))$/ }, args => ({ path: args.path, namespace: "root-error-adapter" }));
        build.onResolve({ filter: /(^|\/)(api|confirm-modal)$/ }, args => ({ path: args.path.split("/").pop()!, namespace: "root-error-adapter" }));
        build.onLoad({ filter: /.*/, namespace: "root-error-adapter" }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(adapters[args.path], {
          filename: `${args.path.replaceAll("/", "-")}.tsx`, generate: "dom", hydratable: false, dev: true,
        })).code }));
        build.onResolve({ filter: /^~\/assets\// }, args => ({ path: args.path, namespace: "root-error-image" }));
        build.onLoad({ filter: /.*/, namespace: "root-error-image" }, async args => {
          const [name, query = ""] = args.path.slice(2).split("?");
          const options = new URLSearchParams(query), widths = (options.get("w") || "1200").split(";").map(Number);
          const path = join(source, name!);
          const images = await Promise.all(widths.map(async width => {
            const buffer = await sharp(path).resize({ width }).webp().toBuffer();
            return `data:image/webp;base64,${buffer.toString("base64")}`;
          }));
          const value = options.get("as") === "srcset" ? images.map((data, index) => `${data} ${widths[index]}w`).join(", ") : images[0];
          return { loader: "js", contents: `export default ${JSON.stringify(value)};` };
        });
        build.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(source, args.path.slice(2)), source) }));
        build.onLoad({ filter: /\.css$/ }, async args => { css.push(await contents(args.path)); return { loader: "js", contents: "" }; });
        build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await contents(args.path), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
      } }] });
    if (!built.success) throw new AggregateError(built.logs, "Root error fixture failed to compile");
    const browserPath = join(directory, "browser.js"), runnerPath = join(directory, "runner.mjs"), cssPath = join(directory, "fixture.css");
    await Bun.write(browserPath, built.outputs.find(output => output.kind === "entry-point")!);
    await Bun.write(cssPath, css.join("\n"));
    await Bun.write(runnerPath, `
      import { readFile, writeFile } from "node:fs/promises";
      import { join } from "node:path";
      import { strict as assert } from "node:assert";
      import { chromium } from ${JSON.stringify(import.meta.resolve("playwright"))};
      const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
      const baseline = ${baseline};
      const captures = ${Boolean(captured)};
      const script = await readFile(process.argv[2], "utf8"), css = await readFile(process.argv[3], "utf8"), directory = process.argv[4];
      const reports = [];
      try {
        for (const [name, viewport] of [["desktop", { width: 1024, height: 768 }], ["phone", { width: 390, height: 844 }]]) {
          const page = await browser.newPage({ viewport, reducedMotion: "reduce" }); page.setDefaultTimeout(10000);
          const errors = []; page.on("pageerror", error => errors.push(error.message));
          let imports = 0, documentLoads = 0;
          const moduleUrls = [];
          let releaseImport;
          const firstImport = new Promise(resolve => { releaseImport = resolve; });
          await page.route("**/*", async route => {
            const url = new URL(route.request().url());
            if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script });
            if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
            if (url.pathname === "/fixture-route.mjs") {
              imports++; moduleUrls.push(url.href);
              if (imports === 1) await firstImport;
              return route.fulfill(imports === 1 ? { status: 404, contentType: "text/javascript", body: "" }
                : { contentType: "text/javascript", body: 'export default "Recovered route";' });
            }
            if (route.request().isNavigationRequest()) documentLoads++;
            return route.fulfill({ contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/fixture.css"></head><body><script type="module" src="/fixture.js"></script></body></html>' });
          });
          const mount = async query => {
            await page.goto("https://fenel.test/retained/address" + query);
          };
          const geometry = () => page.locator(".workspace-startup__card").evaluate(card => {
            const rect = card.getBoundingClientRect(), style = getComputedStyle(card);
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: style.borderRadius,
              padding: style.padding, background: style.backgroundColor, blur: style.backdropFilter, shadow: style.boxShadow };
          });
          await mount("?mode=public");
          if (baseline) {
            await page.locator(".fenel-loading").waitFor();
          } else {
            const startup = page.locator('.workspace-startup__card[role="status"]');
            await startup.waitFor();
            assert.equal(await startup.locator(".workspace-startup__title").innerText(), "Loading...");
            await page.waitForFunction(() => {
              const image = document.querySelector(".locus-background__image");
              return image?.naturalWidth > 0 && getComputedStyle(image).opacity === "1";
            });
            assert.equal(await page.locator(".locus-background__image--pixelated").count(), 0);
            assert.equal(await page.locator(".fenel-loading").count(), 0);
            assert.equal(await page.locator("[data-recovered-route]").count(), 0);
          }
          if (captures) await page.screenshot({ path: join(directory, "root-loading-" + name + ".png") });
          releaseImport();
          if (baseline) {
            await page.getByRole("heading", { name: "This page stopped working" }).waitFor();
            assert.equal(await page.locator(".workspace-startup__card").count(), 0);
            assert.equal(await page.locator(".status-page__detail").isVisible(), true);
            if (captures) await page.screenshot({ path: join(directory, "root-error-" + name + ".png") });
          } else {
            const card = page.locator('.workspace-startup__card[role="alert"]');
            await card.waitFor();
            assert.match(await card.innerText(), /Could not load this page/);
            assert.match(await card.innerText(), /Try again, or return to Home\./);
            assert.equal(await page.locator(".workspace-startup__steps").count(), 0);
            assert.equal(await page.locator(".locus-load-failure").count(), 0);
            assert.equal(await page.getByRole("link", { name: /Home/ }).getAttribute("href"), "/");
            const detail = card.locator("details"), technical = detail.locator("pre");
            assert.equal(await technical.isVisible(), false);
            await page.waitForFunction(() => document.querySelector(".locus-background__image")?.naturalWidth > 0);
            const image = await page.locator(".locus-background__image").evaluate(image => ({ naturalWidth: image.naturalWidth,
              width: image.getBoundingClientRect().width, rendering: getComputedStyle(image).imageRendering }));
            assert.ok(image.naturalWidth <= 100, JSON.stringify(image));
            assert.ok(image.width > image.naturalWidth * 3, JSON.stringify(image));
            assert.equal(image.rendering, "pixelated");
            const errorGeometry = await geometry();
            assert.ok(errorGeometry.x >= 0 && errorGeometry.x + errorGeometry.width <= viewport.width);
            assert.ok(errorGeometry.y >= 0 && errorGeometry.y + errorGeometry.height <= viewport.height);
            assert.equal(errorGeometry.blur, "blur(12px)");
            assert.notEqual(errorGeometry.shadow, "none");
            if (captures) await page.screenshot({ path: join(directory, "root-error-" + name + ".png") });
            await detail.locator("summary").click();
            assert.equal(await technical.isVisible(), true);
            assert.match(await technical.innerText(), /Failed to fetch dynamically imported module/);
            if (captures) await page.screenshot({ path: join(directory, "root-error-details-" + name + ".png") });
            const retainedAddress = page.url();
            await Promise.all([
              page.waitForEvent("load"),
              page.getByRole("button", { name: "Try again", exact: true }).click(),
            ]);
            await page.locator("[data-recovered-route]").filter({ hasText: "Recovered route" }).waitFor();
            assert.equal(imports, 2);
            assert.equal(documentLoads, 2);
            assert.equal(page.url(), retainedAddress);
            assert.deepEqual(moduleUrls, ["https://fenel.test/fixture-route.mjs", "https://fenel.test/fixture-route.mjs"]);
            assert.equal(await page.locator('.workspace-startup__card[role="alert"]').count(), 0);
            await mount("?loading-comparison");
            await page.locator(".workspace-startup__card").waitFor();
            const loadingGeometry = await geometry();
            for (const key of ["x", "width", "radius", "padding", "background", "blur", "shadow"]) {
              assert.equal(errorGeometry[key], loadingGeometry[key], "Shared card geometry: " + key);
            }
            await mount("?ordinary-error");
            await page.locator('.locus-load-failure[role="alert"]').waitFor();
            assert.equal(await page.locator(".workspace-startup__card").count(), 0);
            reports.push({ name, viewport, image, errorGeometry, loadingGeometry, imports, retainedAddress, moduleUrls });
          }
          assert.deepEqual(errors, []);
          await page.close();
        }
        const report = { passed: true, scope: "actual App Errored, LoadingScreen and LocusBackground", baseline, reports };
        if (captures) await writeFile(join(directory, "result.json"), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
      } finally { await browser.close(); }
    `);
    const child = Bun.spawn(["node", runnerPath, browserPath, cssPath, directory], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exit !== 0) throw new Error(`Root application error DOM fixture failed:\n${stdout}\n${stderr}`);
    expect(stdout).toContain('"passed":true'); console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Root error cleanup escaped repository scratch");
    if (!captured) await rm(target, { recursive: true, force: true });
  }
}, 90_000);
