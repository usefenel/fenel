// Record and constructor field rows keep their mounted slot while a field's
// value is edited. A value edit replaces that field's object; rows keyed by
// object identity were recreated on every keystroke, and when the new row's
// editor was still pending the shown row kept its old DOM after its editor
// had been disposed (the "name =" row with nothing after it, B night A2).
// Runs the actual surfaces from structural-surfaces.tsx in isolated Chromium:
//   bun test --timeout 120000 ./distros/narthex/solid/src/lib/expression-runner/structural-field-rows.test.ts
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("record and constructor field rows survive value edits (isolated Chromium)", async () => {
  const directoryRoot = fileURLToPath(new URL("../../../../../../.tmp-diag/structural-field-rows/", import.meta.url));
  await mkdir(directoryRoot, { recursive: true });
  const directory = await mkdtemp(join(directoryRoot, "run-"));
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  try {
    const surfaces = (await Bun.file(process.env.FENEL_STRUCTURAL_SURFACES_SOURCE
      ?? new URL("./structural-surfaces.tsx", import.meta.url)).text()).replaceAll("\r\n", "\n");
    const region = (start: string, end: string) => {
      const first = surfaces.indexOf(start); const last = surfaces.indexOf(end, first);
      if (first < 0 || last < 0) throw new Error(`Missing canonical source region: ${start}`);
      return surfaces.slice(first, last).replaceAll("export function", "function").replaceAll("export type", "type")
        .replaceAll("export interface", "interface");
    };
    const construct = region("export type RecordFieldSlot", "export type LetBindingSlot");
    const record = region("export interface RecordValueEditorSurfaceProps", "export type LambdaParameterSlot");
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const fixture = `
      import { For, Show, createSignal, flush } from "solid-js";
      import { render } from "@solidjs/web";
      ${construct}
      ${record}
      let mounts = 0; let dispose;
      // A stand-in for the recursive editor: counts how often a slot mounts.
      const Slot = props => { mounts++; return <input data-slot value={props.value ?? ""}
        onInput={event => props.onChange(event.currentTarget.value)} />; };
      function Fixture(fixtureProps) {
        const [fields, setFields] = createSignal([{ name: "name", value: "" }, { name: "phone", value: "" }]);
        const update = (index, value) => setFields(current => current.map((field, position) => position === index ? { ...field, value } : field));
        globalThis.surfaceFixture.read = fields;
        const common = { get fields() { return fields(); },
          fieldName: slot => <span data-name>{slot.field.name}</span>,
          expression: slot => <Slot value={slot.field.value} onChange={value => update(slot.index, value)} />,
          onAdd: () => setFields(current => [...current, { name: "extra", value: "" }]),
          onRemove: index => setFields(current => current.filter((_, position) => position !== index)) };
        return fixtureProps.kind === "construct"
          ? <ConstructFormEditorSurface {...common} tag={() => <b>Person</b>} />
          : <RecordValueEditorSurface {...common} />;
      }
      globalThis.surfaceFixture = {
        mount(kind) { dispose?.(); document.body.replaceChildren(); mounts = 0;
          const host = document.createElement("main"); document.body.append(host);
          dispose = render(() => <Fixture kind={kind} />, host); flush(); },
        state() { flush(); return { mounts, values: globalThis.surfaceFixture.read().map(field => field.value),
          names: [...document.querySelectorAll("[data-name]")].map(node => node.textContent) }; },
      };
    `;
    const browser = await Bun.build({ entrypoints: [join(sourceDirectory, "structural-field-rows.virtual.tsx")], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "structural-field-rows-fixture", setup(build) {
        build.onResolve({ filter: /structural-field-rows\.virtual\.tsx$/ }, () => ({ path: "rows-fixture", namespace: "structural-field-rows" }));
        build.onResolve({ filter: /^(solid-js|@solidjs\/web)$/ }, args => ({ path: join(dirname(Bun.resolveSync(args.path, sourceDirectory)),
          args.path === "solid-js" ? "solid.dev.js" : "web.dev.js") }));
        build.onLoad({ filter: /.*/, namespace: "structural-field-rows" }, async () => ({ loader: "ts", resolveDir: sourceDirectory,
          contents: (await compiler.transformAsync(fixture, { filename: join(sourceDirectory, "structural-field-rows.virtual.tsx"), generate: "dom", hydratable: false, dev: true })).code }));
      } }] });
    if (!browser.success) throw new AggregateError(browser.logs, "Structural field-row fixture build failed");
    const browserPath = join(directory, "browser.js"); await Bun.write(browserPath, browser.outputs[0]!);
    const runner = join(directory, "runner.mjs");
    await Bun.write(runner, `
      import assert from "node:assert/strict"; import {readFile} from "node:fs/promises"; import {createServer} from "node:http";
      import {chromium} from ${JSON.stringify(import.meta.resolve("playwright"))};
      const js=await readFile(process.argv[2]);
      const server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/app.js"?"text/javascript":"text/html");
        res.end(req.url==="/app.js"?js:'<script type="module" src="/app.js"></script>');});
      await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
      const browser=await chromium.launch({channel:process.env.FENEL_TEST_BROWSER_CHANNEL||"msedge",headless:true,timeout:60000});
      try {
        const page=await browser.newPage(); const errors=[];page.on("pageerror",error=>errors.push(error.message));
        await page.goto("http://127.0.0.1:"+server.address().port);await page.waitForFunction(()=>!!globalThis.surfaceFixture,undefined,{timeout:30000}).catch(error=>{throw new Error(errors.join(" | ")||String(error));});
        for (const kind of ["construct","record"]) {
          await page.evaluate(kind=>surfaceFixture.mount(kind),kind);
          const state=()=>page.evaluate(()=>surfaceFixture.state());
          assert.equal((await state()).mounts,2,kind+": both slots mount once");
          await page.locator("[data-slot]").first().evaluate(node=>{node.dataset.mark="kept";});
          await page.locator("[data-slot]").first().click();
          await page.keyboard.type("Alice Martin");
          const typed=await state();
          assert.deepEqual(typed.values,["Alice Martin",""],kind+": every keystroke reaches the value");
          assert.equal(typed.mounts,2,kind+": editing a value must not remount its row");
          assert.equal(await page.locator("[data-slot]").first().getAttribute("data-mark"),"kept",kind+": the edited input stays the same element");
          assert.equal(await page.evaluate(()=>document.activeElement?.dataset.mark),"kept",kind+": focus stays in the edited input");
          await page.locator("[data-slot]").nth(1).fill("+33 6 12 34 56 78");
          assert.deepEqual((await state()).values,["Alice Martin","+33 6 12 34 56 78"],kind+": a second field edits independently");
          await page.locator(".expr-form__btn",{hasText:"✕"}).first().click();
          const removed=await state();
          assert.deepEqual(removed.names,["phone"],kind+": removal drops the chosen row");
          assert.equal(await page.locator("[data-slot]").first().inputValue(),"+33 6 12 34 56 78",kind+": the remaining row shows its own value");
        }
        assert.equal(errors.length,0,errors.join("\\n"));
      } finally { await browser.close(); server.close(); }
    `);
    // Playwright drives Chromium from Node on this host (a Bun parent stalls the launch).
    const run = Bun.spawn(["node", runner, browserPath], { cwd: directory, stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([run.exited, new Response(run.stdout).text(), new Response(run.stderr).text()]);
    expect({ exit, stdout, stderr }).toMatchObject({ exit: 0 });
  } finally {
    if (!process.env.FENEL_STRUCTURAL_ROWS_KEEP) await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
