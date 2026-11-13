// Test support only (never imported by the app): renders a Solid fixture to an
// HTML string in Bun, with no browser. The fixture file (.tsx) is compiled by
// the same Solid compiler the Vite plugin uses, in its server ("ssr") output,
// and bundled with the server builds of solid-js and @solidjs/web. Client-only
// work (onSettled, measurement, observers) does not run, so a test reads the
// markup a component produces, not its measured layout.

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const solidRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceRoot = join(solidRoot, "src");

/** Builds `fixture` (a .tsx module inside this package) for SSR and imports it. */
export async function loadSsrFixture<T>(fixture: URL, label: string): Promise<T> {
  const compiler = await import(pathToFileURL(Bun.resolveSync("@solidjs/compiler",
    dirname(Bun.resolveSync("@solidjs/vite-plugin", solidRoot)))).href);
  const bundle = await Bun.build({
    entrypoints: [fileURLToPath(fixture)], target: "bun", conditions: ["node", "development"], minify: true,
    plugins: [{ name: "solid-ssr-fixture", setup(build) {
      build.onResolve({ filter: /^~\// }, args => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
      build.onResolve({ filter: /\?raw$/ }, args => ({ path: Bun.resolveSync(args.path.slice(0, -4), args.resolveDir), namespace: "source-text" }));
      build.onLoad({ filter: /.*/, namespace: "source-text" }, async args => ({ loader: "js",
        contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};` }));
      build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(
        await Bun.file(args.path).text(), { filename: args.path, generate: "ssr", hydratable: false, dev: false })).code }));
      build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
    } }],
  });
  if (!bundle.success) throw new AggregateError(bundle.logs, `SSR fixture build failed: ${label}`);
  // The bundle carries the engine and its Fenel sources (tens of MB): it is
  // written only long enough to import it, then removed.
  const output = join(solidRoot, "../../../.tmp-diag/ssr-fixtures", `${label}-${process.pid}-${Date.now()}.js`);
  await mkdir(dirname(output), { recursive: true });
  await Bun.write(output, bundle.outputs.find(entry => entry.kind === "entry-point")!);
  try {
    return await import(pathToFileURL(output).href) as T;
  } finally {
    await rm(output, { force: true });
  }
}

/** The visible text of rendered markup: tags and hydration comments removed. */
export function markupText(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ").trim();
}
