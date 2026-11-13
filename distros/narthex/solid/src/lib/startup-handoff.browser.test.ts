import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("startup cards and the real background survive route and data handoffs", async () => {
  const source = fileURLToPath(new URL("../", import.meta.url));
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const scratch = join(root, ".tmp-diag", "startup-handoff-tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "run-"));
  try {
    const baseline = process.env["FENEL_STARTUP_HANDOFF_BASELINE"];
    const snapshot = process.env["FENEL_STARTUP_HANDOFF_SOURCE_DIR"];
    const compared = new Set(["App.tsx", "global.css", "routes/app.tsx", "routes/app.css", "lib/locus-background.tsx", "lib/locus-background.css", "lib/workspace-surface.css",
      "lib/loading-screen/index.tsx", "lib/loading-screen/loading-screen.css"]);
    const sourceBytes = async (path: string) => {
      if (snapshot && compared.has(relative(source, path).split(sep).join("/"))) {
        const snapshotFile = Bun.file(join(root, snapshot, relative(root, path)));
        if (await snapshotFile.exists()) return snapshotFile.text();
      }
      if (!baseline || !compared.has(relative(source, path).split(sep).join("/"))) return Bun.file(path).text();
      const git = Bun.spawn(["git", "show", `${baseline}:${relative(root, path).split(sep).join("/")}`],
        { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [exit, body, error] = await Promise.all([git.exited, new Response(git.stdout).text(), new Response(git.stderr).text()]);
      if (exit !== 0) throw new Error(`Could not read startup comparison: ${error}`);
      return body;
    };
    const app = await sourceBytes(join(source, "App.tsx"));
    const boundary = app.slice(app.indexOf("<Errored"), app.lastIndexOf("</Errored>") + "</Errored>".length);
    if (!boundary) throw new Error("The application startup boundary changed");
    const shell = await sourceBytes(join(source, "routes/app.tsx"));
    const shellBackground = shell.match(/<Show when=\{isLocusSurface\(\)\}><LocusBackground \/><\/Show>/)?.[0] ?? "";
    const fixturePath = join(directory, "fixture.tsx");
    // The actual App fallback, LoadingScreen and modal lifecycle use normal
    // motion. Only async acquisition and the shell's route body are held;
    // shell geometry comes from the production dashboard/workspace styles.
    await Bun.write(fixturePath, `
      import { render } from "@solidjs/web";
      import { createMemo, createSignal, Errored, Loading, Show } from "solid-js";
      import { LoadingScreen } from "~/lib/loading-screen";
      import { LocusBackground } from "~/lib/locus-background";
      const deferred = () => { let resolve; const promise = new Promise(yes => resolve = yes); return { promise, resolve }; };
      const route = deferred(), module = deferred(), data = deferred();
      const [routeProblem, setRouteProblem] = createSignal();
      const routeErrorMessage = error => error.message;
      const isLocusSurface = () => true;
      function AppBoundary(props) { return ${boundary}; }
      function Data() {
        const ready = createMemo(() => data.promise);
        return <Loading fallback={<LoadingScreen inline detail="Loading data…" />}>
          <Show when={ready()}><p data-ready>Data ready</p></Show>
        </Loading>;
      }
      function Shell() {
        const ready = createMemo(() => module.promise);
        return <>${shellBackground}<div class="dashboard fenel-page-enter dashboard--home" data-workspace="true"
          data-bar-mode="DockedBar" data-bar-position="BarTop">
          <header class="topbar"><a class="topbar__brand">Fenel</a><div class="topbar__workspace" />
            <div class="topbar__actions"><button class="locus-login">Log in</button></div></header>
          <main class="main-content main-content--home">
            <Loading fallback={<LoadingScreen inline detail="Preparing your data…" />}>
              <Show when={ready()}><Data /></Show>
            </Loading>
          </main>
        </div></>;
      }
      function Route() {
        const ready = createMemo(() => { if (routeProblem()) throw routeProblem(); return route.promise; });
        return <Show when={ready()}><Shell /></Show>;
      }
      render(() => <AppBoundary><Route /></AppBoundary>, document.body);
      globalThis.startupHandoff = {
        route: () => route.resolve(true), module: () => module.resolve(true), data: () => data.resolve(true),
        fail: () => setRouteProblem(new Error("Controlled route failure")),
      };
    `);
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const imageToolsPath = Bun.resolveSync("imagetools-core", dirname(fileURLToPath(import.meta.resolve("vite-imagetools"))));
    const sharp = (await import(pathToFileURL(Bun.resolveSync("sharp", dirname(imageToolsPath))).href)).default;
    const solidEntry = await realpath(fileURLToPath(new URL("../../node_modules/solid-js/dist/solid.dev.js", import.meta.url)));
    const webEntry = await realpath(fileURLToPath(new URL("../../node_modules/@solidjs/web/dist/web.dev.js", import.meta.url)));
    const built = await Bun.build({ entrypoints: [fixturePath], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "startup-handoff-dom", setup(build) {
        build.onResolve({ filter: /^solid-js$/ }, () => ({ path: solidEntry }));
        build.onResolve({ filter: /^@solidjs\/web$/ }, () => ({ path: webEntry }));
        build.onResolve({ filter: /(^|\/)api$/ }, () => ({ path: "api", namespace: "startup-handoff-host" }));
        build.onLoad({ filter: /.*/, namespace: "startup-handoff-host" }, () => ({ loader: "js",
          contents: 'export const apiReadConnectionStatus = () => "connected";' }));
        // The real confirm-modal lifecycle remains in the graph; its unrelated
        // lazy form body must never prepare an engine in this visual fixture.
        build.onResolve({ filter: /^\.\/prompt-body$/ }, () => ({ path: "/unused-prompt-body.mjs", external: true }));
        build.onResolve({ filter: /^~\/assets\// }, args => ({ path: args.path, namespace: "startup-handoff-image" }));
        build.onLoad({ filter: /.*/, namespace: "startup-handoff-image" }, async args => {
          const [asset, query] = args.path.slice(2).split("?");
          if (!query) return { loader: "js", contents: `export default ${JSON.stringify(`data:image/png;base64,${Buffer.from(await Bun.file(join(source, asset!)).arrayBuffer()).toString("base64")}`)};` };
          const options = new URLSearchParams(query), widths = (options.get("w") || "1200").split(";").map(Number);
          const format = options.get("format") || "jpeg";
          const images = await Promise.all(widths.map(async width => {
            const bytes = await sharp(join(source, asset!)).resize({ width }).toFormat(format).toBuffer();
            if (options.has("inline")) return `data:image/${format};base64,${bytes.toString("base64")}`;
            const name = `hero-${width}.${format}`;
            await Bun.write(join(directory, name), bytes);
            return `/fixture-image/${name}`;
          }));
          const value = options.get("as") === "srcset" ? images.map((image, index) => `${image} ${widths[index]}w`).join(", ") : images[0];
          return { loader: "js", contents: `export default ${JSON.stringify(value)};` };
        });
        build.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(source, args.path.slice(2)), source) }));
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
        build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await sourceBytes(args.path), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
      } }] });
    if (!built.success) throw new AggregateError(built.logs, "Startup handoff fixture failed to compile");
    const browserPath = join(directory, "browser.js"), runnerPath = join(directory, "runner.mjs"), cssPath = join(directory, "fixture.css");
    await Bun.write(browserPath, built.outputs.find(output => output.kind === "entry-point")!);
    const css = await Promise.all(["global.css", "routes/app.css", "lib/locus-background.css", "lib/confirm-modal/confirm-modal.css",
      "lib/loading-screen/loading-screen.css", "lib/workspace-surface.css"].map(path => sourceBytes(join(source, path))));
    await Bun.write(cssPath, css.join("\n"));
    await Bun.write(runnerPath, `
      import { readFile, mkdir, writeFile } from "node:fs/promises";
      import { join } from "node:path";
      import { strict as assert } from "node:assert";
      import { chromium } from ${JSON.stringify(import.meta.resolve("playwright"))};
      const browser = await chromium.launch({ headless: true, channel: process.env.FENEL_TEST_BROWSER_CHANNEL });
      const script = await readFile(process.argv[2], "utf8"), css = await readFile(process.argv[3], "utf8");
      const reports = [], failures = [];
      try {
        for (const imageMode of ["cached", "pending"]) {
        for (const viewport of [{width: 1024, height: 768}, {width: 390, height: 844}]) {
          const page = await browser.newPage({ viewport, reducedMotion: "no-preference" });
          const errors = []; page.on("pageerror", error => errors.push(error.message));
          let releaseImage;
          const imageReady = imageMode === "cached" ? Promise.resolve() : new Promise(resolve => { releaseImage = resolve; });
          await page.route("**/*", async route => {
            const name = new URL(route.request().url()).pathname.split("/fixture-image/")[1];
            if (name) {
              await imageReady;
              return route.fulfill({ contentType: name.endsWith("webp") ? "image/webp" : "image/jpeg",
                body: await readFile(join(process.argv[4], name)), headers: {"Cache-Control": "max-age=3600"} });
            }
            return route.fulfill({ contentType: "text/html", body: "<html><head></head><body></body></html>" });
          });
          await page.goto("https://fenel.test/");
          await page.addStyleTag({ content: css });
          await page.addScriptTag({ content: script, type: "module" });
          await page.locator(".workspace-startup__card").waitFor();
          await page.waitForFunction(() => {
            for (let node = document.querySelector(".workspace-startup__card"); node; node = node.parentElement) {
              if (Number(getComputedStyle(node).opacity) !== 1) return false;
            }
            return true;
          });
          const readyImage = () => page.waitForFunction(() => {
            const image = document.querySelector(".locus-background__image");
            return image?.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity === "1";
          });
          if (imageMode === "cached") await readyImage();
          const capture = process.env.FENEL_STARTUP_HANDOFF_CAPTURE_DIR;
          const viewportName = imageMode + "-" + (viewport.width < 600 ? "phone" : "desktop");
          if (capture) { await mkdir(capture, {recursive: true}); await page.screenshot({path: join(capture, viewportName + "-route-loading.png")}); }
          const frames = await page.evaluate(async () => {
            const frames = [];
            const initialImage = document.querySelector(".locus-background__image");
            const sample = phase => {
              const cards = [...document.querySelectorAll(".workspace-startup__card")].map(card => {
                const rect = card.getBoundingClientRect(); let opacity = 1;
                for (let node = card; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, opacity,
                  label: card.querySelector(".workspace-startup__detail").textContent };
              });
              const image = document.querySelector(".locus-background__image");
              if (phase === "preparing-data" && !globalThis.startupHandoffImageAnimation)
                globalThis.startupHandoffImageAnimation = image?.getAnimations()[0];
              frames.push({ phase, cards, backgrounds: document.querySelectorAll(".locus-background").length,
                sameImage: image === initialImage, imageOpacity: image ? Number(getComputedStyle(image).opacity) : 0,
                imageReady: !!image?.hasAttribute("data-ready"), imageWidth: image?.naturalWidth,
                imageAnimationTime: image?.getAnimations()[0]?.currentTime,
                ghosts: document.querySelectorAll(".modal-transition--leaving").length,
                header: document.querySelector(".topbar")?.getBoundingClientRect().height });
            };
            const observe = async phase => { const end = performance.now() + 260;
              do { await new Promise(requestAnimationFrame); sample(phase); } while (performance.now() < end); };
            await observe("route-loading");
            startupHandoff.route(); await observe("preparing-data");
            return frames;
          });
          const origin = frames[0].cards[0];
          if (capture) {
            await writeFile(join(capture, viewportName + "-frames.json"), JSON.stringify(frames, null, 2));
            const fade = frames.find(frame => frame.phase === "preparing-data" && frame.imageOpacity < 1 && frame.imageAnimationTime != null);
            if (fade) await page.evaluate(time => {
              const animation = globalThis.startupHandoffImageAnimation;
              if (animation) { animation.pause(); animation.currentTime = time; }
            }, fade.imageAnimationTime);
            const captureState = await page.evaluate(() => {
              const image = document.querySelector(".locus-background__image");
              return {opacity: Number(getComputedStyle(image).opacity), animationTime: globalThis.startupHandoffImageAnimation?.currentTime,
                animationState: globalThis.startupHandoffImageAnimation?.playState};
            });
            if (fade) assert.ok(captureState.opacity <= 0.2, JSON.stringify({fade, captureState}));
            await writeFile(join(capture, viewportName + "-capture.json"), JSON.stringify({phase: "preparing-data", fadeFrame: fade, captureState}, null, 2));
            await page.screenshot({path: join(capture, viewportName + "-preparing-data.png")});
            if (fade) await page.evaluate(() => globalThis.startupHandoffImageAnimation?.finish());
          }
          try {
          for (const frame of frames) {
            assert.equal(frame.cards.length, 1, JSON.stringify(frame));
            assert.equal(frame.ghosts, 0, JSON.stringify(frame));
            const card = frame.cards[0];
            assert.equal(card.opacity, 1, JSON.stringify(frame));
            assert.equal(frame.backgrounds, 1, JSON.stringify(frame));
            assert.equal(frame.sameImage, true, JSON.stringify(frame));
            assert.equal(frame.imageReady, imageMode === "cached", JSON.stringify(frame));
            assert.equal(frame.imageOpacity, imageMode === "cached" ? 1 : 0, JSON.stringify(frame));
            assert.ok(Math.abs(card.x - origin.x) < 0.1 && Math.abs(card.y - origin.y) < 0.1,
              JSON.stringify({ origin, frame }));
          }
          assert.ok(frames.some(frame => frame.cards[0].label === "Preparing your data…"));
          } catch (error) { failures.push({viewport, imageMode, error: error.message}); }
          releaseImage?.();
          await readyImage();
          const dataFrames = await page.evaluate(async () => {
            const image = document.querySelector(".locus-background__image"), frames = [];
            startupHandoff.module();
            const end = performance.now() + 260;
            do {
              await new Promise(requestAnimationFrame);
              const next = document.querySelector(".locus-background__image");
              const cards = [...document.querySelectorAll(".workspace-startup__card")].map(card => {
                const rect = card.getBoundingClientRect(); let opacity = 1;
                for (let node = card; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, opacity };
              });
              frames.push({sameImage: image === next, imageOpacity: Number(getComputedStyle(next).opacity),
                backgrounds: document.querySelectorAll(".locus-background").length, cards,
                ghosts: document.querySelectorAll(".modal-transition--leaving").length});
            } while (performance.now() < end);
            return frames;
          });
          for (const frame of dataFrames) {
            assert.equal(frame.sameImage, true); assert.equal(frame.imageOpacity, 1); assert.equal(frame.backgrounds, 1);
            assert.equal(frame.ghosts, 0); assert.equal(frame.cards.length, 1); assert.equal(frame.cards[0].opacity, 1);
            assert.ok(Math.abs(frame.cards[0].x - origin.x) < 0.1 && Math.abs(frame.cards[0].y - origin.y) < 0.1);
          }
          assert.equal(await page.locator(".workspace-startup__detail").innerText(), "Loading data…");
          await page.evaluate(() => startupHandoff.data());
          await page.locator("p[data-ready]").waitFor();
          assert.equal(await page.locator(".workspace-startup__card, .modal-transition--leaving").count(), 0);
          const hiddenBackgrounds = await page.evaluate(() => {
            const background = document.querySelector(".locus-background"), dashboard = document.querySelector(".dashboard");
            dashboard.classList.remove("dashboard--home");
            const secondary = getComputedStyle(background).visibility;
            dashboard.classList.add("dashboard--home");
            const page = document.createElement("main"); page.className = "public-page-wrap";
            background.parentElement.append(page);
            const publicPage = getComputedStyle(background).visibility;
            page.remove();
            return {secondary, publicPage, home: getComputedStyle(background).visibility};
          });
          if (!process.env.FENEL_STARTUP_HANDOFF_BASELINE && !process.env.FENEL_STARTUP_HANDOFF_SOURCE_DIR)
            assert.deepEqual(hiddenBackgrounds, {secondary: "hidden", publicPage: "hidden", home: "visible"});
          await page.evaluate(() => startupHandoff.fail());
          await page.locator(".workspace-startup__error").waitFor();
          assert.equal(await page.locator(".locus-background").count(), 1);
          assert.equal(await page.locator(".locus-background__image--pixelated").count(), 1);
          assert.ok((await page.locator(".locus-background__image").getAttribute("src")).startsWith("data:image/webp;"));
          assert.deepEqual(errors, []);
          reports.push({viewport, imageMode, frames: frames.length + dataFrames.length, center: origin,
            imageOpacityMinimum: Math.min(...frames.filter(frame => frame.phase === "preparing-data").map(frame => frame.imageOpacity)),
            header: frames.find(frame => frame.header)?.header});
          await page.close();
        }
        }
        if (failures.length) throw new Error(JSON.stringify({failures, reports}));
        console.log(JSON.stringify({ passed: true, reports }));
      } finally { await browser.close(); }
    `);
    const child = Bun.spawn(["node", runnerPath, browserPath, cssPath, directory], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exit !== 0) throw new Error(`Startup handoff DOM fixture failed:\n${stdout}\n${stderr}`);
    expect(stdout).toContain('"passed":true'); console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Startup handoff cleanup escaped repository scratch");
    await rm(target, { recursive: true, force: true });
  }
}, 90_000);
