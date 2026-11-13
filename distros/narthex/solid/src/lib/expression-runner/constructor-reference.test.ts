import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("the shared constructor editor displays scoped references and preserves exact targets (isolated Chromium)", async () => {
  const directoryRoot = fileURLToPath(new URL("../../../../../../.tmp-diag/constructor-reference/", import.meta.url));
  await mkdir(directoryRoot, { recursive: true });
  const directory = await mkdtemp(join(directoryRoot, "run-"));
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = fileURLToPath(new URL("../../../../../../", import.meta.url));
  const captureDirectory = process.env.FENEL_CONSTRUCTOR_REFERENCE_CAPTURE === "1"
    ? join(repositoryRoot, ".playwright-mcp") : undefined;
  try {
    const editor = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
    const display = await Bun.file(new URL("./callable-names.ts", import.meta.url)).text();
    const seeds = await Bun.file(new URL("./creation-seed.ts", import.meta.url)).text();
    const region = (text: string, start: string, end: string) => {
      const first = text.indexOf(start); const last = text.indexOf(end, first);
      if (first < 0 || last < 0) throw new Error(`Missing canonical source region: ${start}`);
      return text.slice(first, last).replaceAll("export function", "function");
    };
    const constructor = region(editor, "function ConstructValueEditor(", "/** `do { … }`");
    let priorConstructor = "";
    if (captureDirectory) {
      const prior = Bun.spawn(["git", "show", "HEAD:distros/narthex/solid/src/lib/expression-runner/index.tsx"],
        { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
      const [exit, committed, failure] = await Promise.all([prior.exited, new Response(prior.stdout).text(), new Response(prior.stderr).text()]);
      if (exit !== 0) throw new Error(`Could not read the committed constructor editor: ${failure}`);
      priorConstructor = region(committed, "function ConstructValueEditor(", "/** `do { … }`")
        .replace("function ConstructValueEditor(", "function PriorConstructValueEditor(");
      await mkdir(captureDirectory, { recursive: true });
    }
    const binding = region(editor, "function BindingNameInput(", "/** Field-name picker for constructor patterns.");
    const pick = region(editor, "  function pickFunction(fnId:", "  function pickRef(");
    const constructorExpression = region(seeds, "export function constructorExpression(", "\n/**");
    const names = region(display, "function decodePart(", "export function constructorNameCounts(")
      + display.slice(display.indexOf("export function displayFunctionName(")).replace("export function", "function");
    const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
    const compiler = await import(pathToFileURL(compilerPath).href);
    const fixture = `
      import { For, Show, createMemo, createSignal, flush } from "solid-js";
      import { render } from "@solidjs/web";
      import { validateBindingName } from "./binding-name";
      ${names}
      const functionPickerDisplayName = displayFunctionName;
      ${constructorExpression}
      const recordId = "0d803573-aefa-4f5c-8473-f0920c56e744";
      const docId = "211f4b40-2c3f-462e-b174-5cec884bd294";
      const recordTarget = "@ctor/tab/"+recordId+"/"+recordId;
      const literalTarget = "@ctor/tab/"+docId+"/ELit";
      const positionalTarget = "@ctor/tab/"+docId+"/EPos";
      const number = { $ref: "Number" };
      const field = name => ({ name, type:number, label:{$tag:"Nothing"},ui:{$tag:"Nothing"},meta:{} });
      const makeEntry = (id,targetId,owner,params) => ({id,targetId,parentEntity:owner,ownerIdentity:"owner:"+owner,
        kind:"constructor",signatureOutcome:{$tag:"Solved"},label:id,description:"",params,returns:{$ref:owner}});
      const entries = [makeEntry(recordId,recordTarget,recordId,[field("count")]),
        makeEntry("ELit",literalTarget,docId,[field("value")]),makeEntry("EPos",positionalTarget,docId,[field("_0")])];
      let session; let dispose; let read; let writes; let picks;
      const useAuthoringSession = () => session;
      const authoringFunctionEntry = (captured,id) => captured.catalog.functions.find(entry=>entry.targetId===id||entry.id===id);
      const constructorFieldsForTag = (id,environment) => environment.entries.find(entry=>entry.targetId===id||entry.id===id)?.params;
      const typeNameOf = () => "Number";
      const projectAuthoringScheme = () => { throw Error("No scheme projection is needed by this settled DTO fixture"); };
      const PathSegmentProvider = props => props.children;
      const CtorFieldNameSelect = props => <span>{props.value}</span>;
      const NodeEditor = props => <input data-value value={props.node.value}
        onInput={event=>props.onChange({kind:"literal",value:Number(event.currentTarget.value)})}/>;
      const FunctionPicker = props => <div data-picker data-kind={props.initialKind} data-locked={String(props.lockKind)}>
        <button data-same onClick={()=>props.onPick(read().value.__construct.tag)}>Same constructor</button>
        <button data-positional onClick={()=>props.onPick(positionalTarget)}>Positional constructor</button>
        <button data-cancel onClick={props.onCancel}>Cancel</button>
      </div>;
      ${binding}
      ${constructor}
      ${priorConstructor}
      function Editor(editorProps) {
        const [current,setCurrent] = createSignal(read()); read=current;
        const setPicking = () => {}; const setPickingUse = () => {};
        const expectedScheme = () => undefined;
        const resolvedFieldType = () => ({$ref:session.owner}); const inferenceContext = () => ({});
        const registryCallParams = entry => entry.params;
        const inferAuthoringCallGuidance = entry => ({params:entry.params});
        const seedExpressionForType = () => ({kind:"literal",value:0});
        const EMPTY_EXPRESSION = {kind:"literal",value:undefined};
        const props = {onChange:next=>{picks++;setCurrent(next);}};
        ${pick}
        return <Show when={current().kind==="literal"} fallback={<div data-call>{current().fnId}</div>}>
          <Show when={!editorProps.before} fallback={${priorConstructor ? `<PriorConstructValueEditor
            tag={current().value.__construct.tag} fields={current().value.__construct.fields}
            onChange={value=>{writes++;setCurrent({kind:"literal",value:{__construct:value}});}}/>` : "undefined"}}>
          <ConstructValueEditor tag={current().value.__construct.tag} fields={current().value.__construct.fields}
            expectedType={resolvedFieldType()}
            onChange={value=>{writes++;setCurrent({kind:"literal",value:{__construct:value}});}}
            onPickFunction={pickFunction}/>
          </Show>
        </Show>;
      }
      globalThis.constructorFixture = {
        mount(mode,version="after") {
          dispose?.(); document.body.replaceChildren(); writes=0;picks=0;
          const owner = mode==="variant"?docId:recordId;
          const type = mode==="variant"?{$variant:{cases:[{name:"ELit"},{name:"EPos"}]}}:{$record:{fields:[field("count")]}};
          const target = mode==="unknown"?"AdHoc":mode==="variant"?literalTarget:recordTarget;
          const row = {entityId:owner,name:mode==="variant"?"Document expression":"Counter"};
          session = { owner, catalog:{functions:entries,types:mode==="ambiguous"?[row,{...row,name:"Other label"}]:[row]},
            environment:{entries,resolveConstructorTarget:id=>entries.find(entry=>entry.targetId===id||entry.id===id)?.targetId},
            registry:{getEntityNominalIdentity:id=>mode==="foreign"?"foreign-owner":"owner:"+id,
              getIdentifiedEntity:id=>id===owner?{id,type}:undefined} };
          read = ()=>({kind:"literal",value:{__construct:{tag:target,fields:[{name:mode==="variant"?"value":"count",value:{kind:"literal",value:7}}]}}});
          const host=document.createElement("main");
          ${captureDirectory ? `host.className="constructor-comparison";
          const header=document.createElement("header");
          const title=document.createElement("h1");title.textContent=(version==="before"?"Before":"After")+" · Constructor reference";
          const context=document.createElement("p");context.textContent="Isolated shared-editor fixture · Counter · count 7 · same typed metadata and constructor target";
          header.append(title,context);document.body.append(header);` : ""}
          document.body.append(host);dispose=render(()=> <Editor before={version==="before"}/>,host); flush();
        }, state(){return {node:read(),writes,picks,recordTarget,literalTarget,positionalTarget};}
      };
    `;
    const browser = await Bun.build({ entrypoints: [join(sourceDirectory, "constructor-reference.virtual.tsx")], target: "browser", conditions: ["browser", "development"],
      plugins: [{ name: "constructor-reference-fixture", setup(build) {
        build.onResolve({ filter: /constructor-reference\.virtual\.tsx$/ }, () => ({ path: "constructor-fixture", namespace: "constructor-reference" }));
        build.onResolve({ filter: /^\.\/binding-name$/ }, () => ({ path: join(sourceDirectory, "binding-name.ts") }));
        build.onResolve({ filter: /^(solid-js|@solidjs\/web)$/ }, args => ({ path: join(dirname(Bun.resolveSync(args.path, sourceDirectory)),
          args.path === "solid-js" ? "solid.dev.js" : "web.dev.js") }));
        build.onLoad({ filter: /.*/, namespace: "constructor-reference" }, async () => ({ loader: "ts", resolveDir: sourceDirectory,
          contents: (await compiler.transformAsync(fixture, { filename: join(sourceDirectory, "constructor-reference.virtual.tsx"), generate: "dom", hydratable: false, dev: true })).code }));
      } }] });
    if (!browser.success) throw new AggregateError(browser.logs, "Constructor-reference fixture build failed");
    const browserPath = join(directory, "browser.js"); await Bun.write(browserPath, browser.outputs[0]!);
    const stylesPath = join(directory, "styles.css");
    if (captureDirectory) {
      const styles = await Promise.all([Bun.file(new URL("../../global.css", import.meta.url)).text(),
        Bun.file(new URL("../../routes/app.css", import.meta.url)).text()]);
      await Bun.write(stylesPath, styles.join("\n") + `\nbody{background:#f8fafc;color:#111827;padding:36px;font-family:Arial,sans-serif}
        header{max-width:760px;margin:0 auto 24px}h1{font-size:25px;font-weight:600;margin-bottom:10px}
        header p{font-size:13px;color:#475569;line-height:1.5}.constructor-comparison{max-width:760px;margin:auto;background:white;padding:24px;border:1px solid #e2e8f0;border-radius:10px}
        [data-value]{border:1px solid #cbd5e1;border-radius:4px;padding:7px 10px;font-size:14px;background:white}
        @media(max-width:640px){body{padding:18px}h1{font-size:21px}.constructor-comparison{padding:16px}}
      `);
    }
    const runner = join(directory, "runner.mjs");
    await Bun.write(runner, `
      import assert from "node:assert/strict"; import {readFile} from "node:fs/promises"; import {createServer} from "node:http"; import {join} from "node:path";
      import {chromium} from ${JSON.stringify(import.meta.resolve("playwright"))};
      const js=await readFile(process.argv[2]);const captureDirectory=process.argv[3]||undefined;const styles=captureDirectory?await readFile(process.argv[4]):undefined;
      const server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/app.js"?"text/javascript":req.url==="/styles.css"?"text/css":"text/html");
        res.end(req.url==="/app.js"?js:req.url==="/styles.css"?styles:'<link rel="stylesheet" href="/styles.css"><script type="module" src="/app.js"></script>');});
      await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
      const browser=await chromium.launch({channel:process.env.FENEL_TEST_BROWSER_CHANNEL||"msedge",headless:true});
      try {
        const page=await browser.newPage(); const errors=[];page.on("pageerror",error=>errors.push(error.message));
        await page.goto("http://127.0.0.1:"+server.address().port);await page.waitForFunction(()=>!!globalThis.constructorFixture);
        const mount=mode=>page.evaluate(mode=>constructorFixture.mount(mode),mode);const state=()=>page.evaluate(()=>constructorFixture.state());
        await mount("record");assert.equal(await page.locator(".expr-pattern__ctor-tag-btn").textContent(),"Counter ↻");
        assert.equal(await page.locator(".expr-form__name--invalid").count(),0);assert.equal((await state()).writes,0);
        await page.locator("[data-value]").fill("9");const edited=await state();
        assert.equal(edited.node.value.__construct.tag,edited.recordTarget);assert.equal(edited.node.value.__construct.fields[0].value.value,9);
        await page.locator(".expr-pattern__ctor-tag-btn").click();assert.equal(await page.locator("[data-picker]").getAttribute("data-kind"),"constructor");
        assert.equal(await page.locator("[data-picker]").getAttribute("data-locked"),"true");await page.locator("[data-same]").click();
        assert.deepEqual((await state()).node,edited.node);assert.equal((await state()).picks,0);
        await mount("variant");assert.equal(await page.locator(".expr-pattern__ctor-tag-btn").textContent(),"ELit ↻");
        await page.locator(".expr-pattern__ctor-tag-btn").click();await page.locator("[data-positional]").click();
        const selected=await state();assert.equal(selected.node.kind,"call");assert.equal(selected.node.fnId,selected.positionalTarget);
        assert.deepEqual(selected.node.args,[{kind:"literal",value:0}]);assert.equal(selected.picks,1);
        for(const mode of ["foreign","ambiguous"]) {await mount(mode);assert.doesNotMatch(await page.locator(".expr-pattern__ctor-tag-btn").innerText(),/Counter|Other label/);}
        await mount("unknown");assert.equal(await page.locator(".expr-pattern__ctor-tag-btn").count(),0);
        await page.locator(".expr-form__name").fill("invalid-tag");assert.equal(await page.locator(".expr-form__name--invalid").count(),1);
        assert.equal((await state()).node.value.__construct.tag,"invalid-tag");assert.equal(errors.length,0,errors.join("\\n"));
        if(captureDirectory) {
          for(const [label,viewport] of [["desktop",{width:1024,height:640}],["phone",{width:390,height:640}]]) {
            await page.setViewportSize(viewport);await page.evaluate(()=>constructorFixture.mount("record","before"));
            await page.mouse.move(0,0);assert.equal(await page.locator(".expr-form__name--invalid").count(),1);
            const before=await state();assert.equal(before.writes,0);assert.equal(before.node.value.__construct.fields[0].value.value,7);
            await page.screenshot({path:join(captureDirectory,"data-lenses-constructor-reference-fixture-before-"+label+".png")});
            await page.evaluate(()=>constructorFixture.mount("record","after"));await page.mouse.move(0,0);
            const after=await state();assert.deepEqual(after.node,before.node);assert.equal(after.writes,0);
            assert.equal(await page.locator(".expr-form__name--invalid").count(),0);assert.equal(await page.locator(".expr-pattern__ctor-tag-btn").textContent(),"Counter ↻");
            await page.screenshot({path:join(captureDirectory,"data-lenses-constructor-reference-fixture-after-"+label+".png")});
          }
          console.log("CAPTURE matched committed/current constructor fixture desktop and phone");
        }
        console.log("PASS scoped constructor reference label, exact field edits, locked picker and positional swap");
      } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
    `);
    const child = Bun.spawn(["node", runner, browserPath, captureDirectory ?? "", stylesPath], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEMP: directory, TMP: directory } });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exit !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(stdout).toContain("PASS scoped constructor reference label");
  } finally {
    const target = resolve(directory);
    if (!target.startsWith(resolve(directoryRoot) + sep)) throw new Error("Constructor fixture cleanup escaped its test directory");
    await rm(target, { recursive: true, force: true });
  }
}, 90_000);
