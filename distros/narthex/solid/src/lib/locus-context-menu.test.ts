import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

test("Locus context menu and LocusSelect interaction and placement (isolated Chromium)", async () => {
  const scratch = fileURLToPath(new URL("../../../../../.tmp-tsc/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "fenel-locus-menu-"));
  try {
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const home = await Bun.file(fileURLToPath(new URL("../routes/app/home.tsx", import.meta.url))).text();
    const homeFrom = home.indexOf("      <Show when={contextMenu()}");
    const homeTo = home.indexOf("      <Show when={moving()}", homeFrom);
    if (homeFrom < 0 || homeTo < 0) throw new Error("Home context-menu rendering boundary moved");
    const homeMenu = home.slice(homeFrom, homeTo).trim();
    const graphSource = await Bun.file(fileURLToPath(new URL("./dependency-graph-dialog.tsx", import.meta.url))).text();
    const panelFrom = graphSource.indexOf("export function DependencyGraphPanel(");
    const spinnerSource = await Bun.file(fileURLToPath(new URL("./loading-screen/index.tsx", import.meta.url))).text();
    const spinnerFrom = spinnerSource.indexOf("export function LensSpinner()");
    const spinnerTo = spinnerSource.indexOf("/** The same lens frame", spinnerFrom);
    if ([panelFrom, spinnerFrom, spinnerTo].some(index => index < 0)) throw new Error("Home graph lifetime source boundary moved");
    const graphComponents = graphSource.slice(panelFrom);
    const production = process.env["NODE_ENV"] === "production";
    const receipt = (source: string) => ({ bytes: Buffer.byteLength(source), sha256: createHash("sha256").update(source).digest("hex") });
    console.log(JSON.stringify({ production, homeContextMenuSource: receipt(homeMenu), graphComponentsSource: receipt(graphComponents) }));
    const browser = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./locus-context-menu.fixture.tsx", import.meta.url))],
      target: "browser", conditions: ["browser", production ? "production" : "development"],
      plugins: [{ name: "context-menu-browser-leaf", setup(build) {
        build.onResolve({ filter: /^@fenel\// }, (args) => { throw new Error(`Context menu eagerly imports ${args.path}`); });
        build.onLoad({ filter: /[\\/]confirm-modal[\\/]prompt-body\.tsx$/ }, () => ({ loader: "js",
          contents: "export default function() { throw new Error('Graph lifetime fixture never opens typed prompts'); }" }));
        build.onLoad({ filter: /\.tsx$/ }, async (args) => {
          let source = await Bun.file(args.path).text();
          if (args.path.endsWith("locus-context-menu.fixture.tsx")) {
            const marker = "/* HOME_CONTEXT_MENU_SOURCE */ <></>";
            if (!source.includes(marker)) throw new Error("Home menu fixture marker moved");
            source = source.replace(marker, homeMenu);
            source = source.replace("/* HOME_GRAPH_COMPONENTS_SOURCE */", `${spinnerSource.slice(spinnerFrom, spinnerTo)}\n${graphComponents}`);
          }
          return { loader: "ts",
          contents: (await compiler.transformAsync(source, {
            filename: args.path, generate: "dom", hydratable: false, dev: !production,
          })).code,
        }; });
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }],
    });
    if (!browser.success) throw new AggregateError(browser.logs, "Context menu browser fixture build failed");
    const browserPath = join(directory, "browser.js");
    await Bun.write(browserPath, browser.outputs[0]!);
    const runner = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./locus-context-menu.node-fixture.ts", import.meta.url))],
      target: "node", packages: "external",
    });
    if (!runner.success) throw new AggregateError(runner.logs, "Context menu Node fixture build failed");
    const nodePath = join(directory, "runner.mjs");
    await Bun.write(nodePath, (await runner.outputs[0]!.text()).replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
    // Playwright's Windows pipe transport is owned by Node, as in the existing
    // browser boundary fixture. No dev server or engine startup is involved.
    const child = Bun.spawn(["node", nodePath, browserPath, fileURLToPath(new URL("./locus-context-menu.css", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("# fail 0");
    expect(stdout).toMatch(/# pass 27(?:\r?\n|$)/);
    console.log(stdout);
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Context menu fixture cleanup escaped its workspace scratch directory");
    await rm(target, { recursive: true, force: true });
  }
}, 120_000);
