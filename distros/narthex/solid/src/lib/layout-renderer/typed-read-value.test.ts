import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("typed read previews keep reader-owned custom presentation (isolated Chromium)", async () => {
  const stage = (name: string) => console.log(`[typed-read-stage] bun ${name}`);
  stage("starting fixture build");
  const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
  const repository = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const scratch = join(repository, ".tmp-tsc");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "typed-read-"));
  try {
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    stage("Solid compiler loaded");
    const baseline = process.env["FENEL_TYPED_READ_BASELINE"] === "1";
    const heldBaseline = process.env["FENEL_TYPED_READ_HELD_BASELINE"] === "1";
    // C1: main HEAD includes the new surfaces after integration. Both before
    // modes must keep reading the actual prior committed implementation.
    const baselineRevision = process.env["FENEL_TYPED_READ_BASELINE_REVISION"] ?? "f8ffcbc2";
    const legacyParser = process.env["FENEL_PARSER_LEGACY"] === "1";
    const previousFiles = ["lib/function-card-body.tsx", "lib/function-card-body.css", "lib/layout-renderer/TypedReadValue.tsx",
      "lib/type-data-preview.tsx", "lib/layout-renderer/typed-read-value.css", "lib/home-entry.tsx", "routes/app.css", "routes/app/home.tsx",
      "lib/expression-runner/ExpressionEditor.tsx", "lib/expression-runner/index.tsx", "lib/expression-runner/structural-surfaces.tsx",
      "lib/lens-shortcuts.ts", "fenel/modules/view/instances.fenel", "fenel/modules/engine/surface-library.fenel"];
    const readSource = async (path: string) => {
      const normalized = path.replaceAll("\\", "/");
      if (!(baseline && previousFiles.some(file => normalized.endsWith(file)))
        && !(heldBaseline && normalized.endsWith("lib/expression-runner/ExpressionEditor.tsx"))) return Bun.file(path).text();
      const revision = Bun.spawnSync(["git", "show", `${baselineRevision}:${relative(repository, path).replaceAll("\\", "/")}`], { cwd: repository });
      if (revision.exitCode !== 0) throw new Error(revision.stderr.toString());
      return revision.stdout.toString();
    };
    stage("building browser bundle");
    const browser = await Bun.build({
      entrypoints: [fileURLToPath(new URL(process.env["FENEL_TYPED_READ_TEST_PATTERN"] === "early nominal type hovers"
        ? "../type-data-preview.browser-fixture.tsx" : "./typed-read-value.fixture.tsx", import.meta.url))],
      target: "browser", conditions: ["browser", "development"], minify: true,
      plugins: [{ name: "typed-read-browser", setup(build) {
        build.onLoad({ filter: /[/\\]parse-cache\.ts$/ }, async args => {
          const source = await readSource(args.path);
          const selector = 'let _legacyParser = (typeof process !== "undefined" ? process.env["FENEL_PARSER_LEGACY"] : undefined) === "1";';
          if (!source.includes(selector)) throw new Error("The browser test's explicit parser selector is unavailable");
          // C1: the shell's existing source-parser test escape must also reach
          // browser module initialization, which has no process environment.
          return { loader: "ts", contents: legacyParser ? source.replace(selector, "let _legacyParser = true;") : source };
        });
        build.onResolve({ filter: /^fixture:home-function-card$/ }, () => ({ path: join(sourceRoot, "function-card-review.fixture.tsx") }));
        build.onResolve({ filter: /^fixture:home-type-preview$/ }, () => ({ path: join(sourceRoot, "home-type-preview-review.fixture.tsx") }));
        build.onLoad({ filter: /home-type-preview-review\.fixture\.tsx$/ }, async () => {
          const home = await readSource(join(sourceRoot, "lib/home-entry.tsx"));
          const body = home.slice(home.indexOf("  function previewTypeDescription("), home.indexOf("  const [typePreviewIntent,"));
          const contents = `import { ValueCard, ValueCardCaption, valueCardLabel } from "~/lib/value-card";
            import { TypeDataPreviewBody } from "~/lib/type-data-preview";
            import { typeIconForPresentation } from "~/lib/type-icon-presentation";
            import { TYPE_ICON_FALLBACKS, LUCIDE_BY_NAME } from "~/lib/icons";
            export function HomeTypePreview(props) {
              const projectedTypeDescription = type => props.descriptions.find(entry => JSON.stringify(entry.type) === JSON.stringify(type));
              const previewTypeTarget = type => type && "$ref" in type ? type.$ref : undefined;
              const projectedOwnPresentation = () => undefined;
              const projectedPreviewRepresentation = (target, className) => className === "Labelable" && target === previewTypeTarget(props.type)
                && target !== undefined ? { label: props.label } : undefined;
              const projectedThumbnailIcon = () => undefined;
              ${body}
              return previewType(props.type, props.label);
            }`;
          return { loader: "ts", resolveDir: sourceRoot, contents: (await compiler.transformAsync(contents, {
            filename: join(sourceRoot, "home-type-preview-review.tsx"), generate: "dom", hydratable: false, dev: true,
          })).code };
        });
        build.onLoad({ filter: /function-card-review\.fixture\.tsx$/ }, async () => {
          const home = await readSource(join(sourceRoot, "routes/app/home.tsx"));
          const body = home.slice(home.indexOf("function FunctionTypeBody("), home.indexOf("function ResultBody("));
          const actions = home.slice(home.indexOf("function IOCallActionButtons("), home.indexOf("/** The body fragment for an io-tagged call:"));
          const fieldOwnerStart = home.indexOf("function readerFieldOwner(");
          const fieldOwnerEnd = home.indexOf("\n// A public reader", fieldOwnerStart);
          if (fieldOwnerStart < 0 || fieldOwnerEnd <= fieldOwnerStart) throw new Error("The actual Home field-owner adapter is unavailable");
          const fieldOwner = home.slice(fieldOwnerStart, fieldOwnerEnd);
          const contents = `import { Show, createMemo, createSignal } from "solid-js";
            import { resolveEffect } from "@fenel/engine";
            import { projectAuthoringScheme } from "@fenel/engine/authoring/environment";
            import { typeCode } from "@fenel/engine/authoring/expression";
            import { peelResultForAuthoring } from "@fenel/engine/authoring/type";
            import { IconByName, LUCIDE_BY_NAME, TYPE_ICON_FALLBACKS } from "~/lib/icons";
            import { FunctionCardBody } from "~/lib/function-card-body";
            import { ValueCard, ValueCardCaption, valueCardLabel as locale, valueCardTypeLabel } from "~/lib/value-card";
            import { presentedTypeTarget } from "~/lib/type-icon-presentation";
            import { TypedReadValue, typedReadTypeOwnIcon, typedReadTypePresentation } from "~/lib/layout-renderer/TypedReadValue";
            ${fieldOwner}
            const TypeInspectionDialog = () => { throw new Error("Fixture must not open the editor"); };
            export function HomeFunctionSignature(props) {
              const useHomeReader = () => ({ reader: props.reader, homeAuthoringSession: () => props.reader.session(),
                knownTypeIconName: id => props.reader.representation("Iconable", id)?.icon,
                getLabel: id => props.reader.presentation(id)?.label,
                getCodeName: id => props.reader.presentation(id)?.codeName });
              ${body}
              return <FunctionTypeBody arrow={props.arrow} />;
            }
            ${actions}
            export { IOCallActionButtons as HomeFunctionActions };`;
          return { loader: "ts", resolveDir: sourceRoot, contents: (await compiler.transformAsync(contents, {
            filename: join(sourceRoot, "function-card-review.tsx"), generate: "dom", hydratable: false, dev: true,
          })).code };
        });
        build.onResolve({ filter: /^~\// }, (args) => ({ path: Bun.resolveSync(join(sourceRoot, args.path.slice(2)), sourceRoot) }));
        build.onResolve({ filter: /\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "source-text" }));
        build.onLoad({ filter: /.*/, namespace: "source-text" }, async (args) => ({ loader: "js", contents: `export default ${JSON.stringify(await readSource(args.path))};` }));
        build.onLoad({ filter: /\.tsx$/ }, async (args) => ({ loader: "ts", contents: (await compiler.transformAsync(await readSource(args.path), {
          filename: args.path, generate: "dom", hydratable: false, dev: true,
        })).code }));
        build.onLoad({ filter: /\.css$/ }, () => ({ loader: "js", contents: "" }));
      } }],
    });
    if (!browser.success) throw new AggregateError(browser.logs, "Typed read browser fixture build failed");
    stage("browser bundle built");
    const browserPath = join(directory, "browser.js");
    stage("writing browser bundle");
    await Bun.write(browserPath, browser.outputs.find((output) => output.kind === "entry-point")!);
    stage("browser bundle written");
    const captureDirectory = process.env["FENEL_TYPED_READ_CAPTURE_DIR"];
    if (captureDirectory) {
      const target = resolve(repository, captureDirectory);
      if (!target.startsWith(resolve(repository) + sep)) throw new Error("Typed read capture escaped its repository");
      await mkdir(target, { recursive: true });
      stage("writing capture browser bundle");
      await Bun.write(join(target, "browser.js"), browser.outputs.find((output) => output.kind === "entry-point")!);
      stage("capture browser bundle written");
    }
    stage("building Node runner");
    const runner = await Bun.build({ entrypoints: [fileURLToPath(new URL("./typed-read-value.node-fixture.ts", import.meta.url))], target: "node", packages: "external" });
    if (!runner.success) throw new AggregateError(runner.logs, "Typed read Node fixture build failed");
    stage("Node runner built");
    const nodePath = join(directory, "runner.mjs");
    stage("writing Node runner");
    await Bun.write(nodePath, (await runner.outputs[0]!.text()).replace('from "playwright"', `from ${JSON.stringify(import.meta.resolve("playwright"))}`));
    stage("Node runner written");
    const testPattern = process.env["FENEL_TYPED_READ_TEST_PATTERN"];
    const child = Bun.spawn(["node", ...(testPattern ? [`--test-name-pattern=${testPattern}`] : []), nodePath, browserPath], { stdout: "pipe", stderr: "pipe",
      env: { ...process.env, TEMP: directory, TMP: directory } });
    stage(`Node runner spawned pid=${child.pid}`);
    // C1: retain the exact TAP/diagnostic receipt while exposing child output
    // before a parent timeout can prevent the joined receipt from returning.
    const [receipt, progress] = child.stdout.tee();
    const [diagnostics, diagnosticProgress] = child.stderr.tee();
    const progressFinished = progress.pipeTo(new WritableStream<Uint8Array>({
      write(chunk) { process.stdout.write(chunk); },
    }));
    const diagnosticsFinished = diagnosticProgress.pipeTo(new WritableStream<Uint8Array>({
      write(chunk) { process.stderr.write(chunk); },
    }));
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(receipt).text(), new Response(diagnostics).text(),
      progressFinished, diagnosticsFinished]);
    stage(`Node runner exited code=${exitCode}`);
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("# fail 0");
    expect(stdout).toMatch(testPattern ? /# pass [1-9]\d*(?:\r?\n|$)/ : /# pass 16(?:\r?\n|$)/);
  } finally {
    stage("cleaning fixture scratch");
    const target = resolve(directory);
    if (!target.startsWith(resolve(scratch) + sep)) throw new Error("Typed read fixture cleanup escaped its workspace scratch directory");
    await rm(target, { recursive: true, force: true });
    stage("fixture scratch cleaned");
  }
}, 240_000);
