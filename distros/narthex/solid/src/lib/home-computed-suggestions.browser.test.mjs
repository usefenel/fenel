import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// C1/C2: actual Home source capture/context branch and existing Suggestions
// lifecycle/menu. Only the worker transport supplies controlled replies; real
// source-path policy and checking have their separate strict evaluator proof.
test("Home computed child Suggestions retain their producer and original frame (bounded browser)", async () => {
  const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
  const packageRoot = join(repository, "distros/narthex/solid"), sourceRoot = join(packageRoot, "src");
  const output = join(repository, ".tmp-tsc/home-computed-suggestions");
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(join(output, "fixture-"));
  const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(fileURLToPath(import.meta.resolve("@solidjs/vite-plugin"))));
  const compiler = createRequire(import.meta.url)(compilerPath);
  const clientModules = {};
  for (const name of ["solid-js", "@solidjs/web"]) clientModules[name] = await realpath(join(packageRoot, "node_modules", name, "dist",
    name === "solid-js" ? "solid.dev.js" : "web.dev.js"));
  clientModules["@solidjs/signals"] = await realpath(resolve(dirname(dirname(clientModules["solid-js"])), "../@solidjs/signals/dist/dev.js"));
  for (const path of Object.values(clientModules)) if (!path.startsWith(resolve(repository) + sep)) throw new Error("Browser runtime escaped repository");
  const inspection = await readFile(join(sourceRoot, "lib/DataInspectionDialog.tsx"), "utf8");
  const ownerStart = inspection.indexOf("export function createDataInspectionSuggestions("), ownerEnd = inspection.indexOf("const panelOrder:", ownerStart);
  if (ownerStart < 0 || ownerEnd <= ownerStart) throw new Error("Suggestions owner extraction markers changed");
  const occurrence = await readFile(join(sourceRoot, "lib/data-occurrence.tsx"), "utf8");
  const occurrenceStart = occurrence.indexOf("export function captureDataOccurrence("), occurrenceEnd = occurrence.indexOf("/** Adapt captured UI lifetime", occurrenceStart);
  if (occurrenceStart < 0 || occurrenceEnd <= occurrenceStart) throw new Error("Occurrence capture extraction markers changed");
  const receipts = [];
  for (const phase of ["before", "after"]) {
    const home = await readFile(phase === "before" ? join(output, "home-before.tsx") : join(sourceRoot, "routes/app/home.tsx"), "utf8");
    if (phase === "after") await Bun.write(join(output, "home-after.tsx"), home);
    const captureStart = home.indexOf("  let suggestionTarget: LayoutItem | undefined;"), captureEnd = home.indexOf("  onSettled(() => props.pane?.registerSuggestions?.(lensSuggestions));", captureStart);
    const menuStart = home.indexOf("  function contextItems(menu: MenuTarget): LocusMenuItem[] {"), menuEnd = home.indexOf("    const into = item ? enterScopeFor(item) : undefined;", menuStart);
    if (captureStart < 0 || captureEnd <= captureStart || menuStart < 0 || menuEnd <= menuStart) throw new Error("Home computed Suggestions extraction markers changed");
    const captureSource = home.slice(captureStart, captureEnd), menuSource = home.slice(menuStart, menuEnd) + "return [];\n  }";
    const entry = `
import {createMemo,createSignal,onSettled,Show,flush} from "solid-js";
import {render} from "@solidjs/web";
import {LocusContextMenu} from ${JSON.stringify(join(sourceRoot, "lib/locus-context-menu.tsx"))};
import {locusOpenMenuItems} from ${JSON.stringify(join(sourceRoot, "lib/locus-menu-actions.ts"))};
import {ValueCard,ValueCardCaption} from ${JSON.stringify(join(sourceRoot, "lib/value-card.tsx"))};
import {draftValueFingerprint} from ${JSON.stringify(join(sourceRoot, "lib/native-draft.ts"))};
import {createDataInspectionSuggestions} from "computed-home:owner";
${occurrence.slice(occurrenceStart, occurrenceEnd)}
const producer = {kind:"call",fnId:"fixture:loadCities",args:[]};
const childType = {$ref:"String"};
const item = {id:"$inspect:computed:0.city",caption:"City",valueType:childType,source:{kind:"expr",expr:producer}};
let retained, setFrame, setTicket, setMenu, state, inspectInput;
globalThis.homeComputedJobs = []; globalThis.homeComputedPreparations = [];
function Fixture(){
  const [frame,changeFrame] = createSignal(1), [ticket,changeTicket] = createSignal({source:"controlled-source"}), [menu,setContextMenu] = createSignal();
  const issues = [], composed = [], session = Object.freeze({name:"same-fixture-reader"});
  setFrame = () => changeFrame(value=>value+1); setTicket=()=>changeTicket({source:"controlled-source"}); setMenu = setContextMenu;
  const client = {signal:new AbortController().signal}, homeAuthoringSession = ()=>session;
  const sessionEpoch = ()=>7, reader={revision:()=>0}, root=()=>({id:"fixture-root",revision:frame()}), rootSourceTicket=ticket;
  const scope=()=>({kind:"root"}), props={pane:{source:()=>({$tag:"ThisTabSource"})}}, workspaceSourceKey=()=>"this-tab";
  const savedExprById=()=>new Map(), resolveExpr=target=>target.source?.expr, focusedType=()=>childType;
  const lensExpressionSubject=()=>{throw new Error("A clicked child must not become its parent");};
  const homeData={type:target=>target.valueType,evaluated:()=>{throw new Error("A clicked occurrence must retain its captured observation");},enter(){}};
  const createModalCtx={composeSuggestion:node=>composed.push(node)}, setToolbarError=message=>issues.push(message);
  const itemFunction=()=>undefined, openInspection=()=>{throw new Error("Inspection was not selected");},setCalling=()=>{throw new Error("No callable was selected");};
  ${captureSource}
  ${menuSource}
  function open(event){
    event.preventDefault(); event.stopPropagation();
    const occurrence={item,evaluated:{value:"Paris",source:producer,sourcePath:[0,"city"]},current:()=>true};
    openDataSuggestionsFor(item,occurrence);
    setContextMenu({x:event.clientX||100,y:event.clientY||150,item,occurrence});
  }
  state=()=>({jobs:globalThis.homeComputedJobs,preparations:globalThis.homeComputedPreparations,
    issues:[...issues],composed:[...composed],frame:frame(),selected:menu()?.occurrence?.evaluated});
  retained=()=>{const row=dataSuggestions.items().find(row=>row.id.startsWith("data-suggestion:"));if(!row)throw Error("No checked row to retain");return row.onSelect;};
  inspectInput=()=>dataOccurrence.capture().input;
  return <main style="padding:32px;max-width:760px;margin:0 auto">
    <ValueCard class="computed-child-fixture" heading={<ValueCardCaption caption="City" typeLabel="String" />} onMenu={open}>
      <div data-computed-child onContextMenu={open} style="padding:12px;font-size:24px">Paris</div>
    </ValueCard>
    <Show keyed when={menu()}>{at=><LocusContextMenu x={at.x} y={at.y} label="Data actions" items={contextItems(at)}
      onClose={()=>{dataSuggestions.close();setContextMenu(undefined);}} />}</Show>
  </main>;
}
render(()=><Fixture/>,document.getElementById("fixture"));
globalThis.homeComputed={state:()=>state(),retain:()=>{globalThis.heldComputedRow=retained();},
  replaceFrame:()=>{setFrame();flush();},replaceTicket:()=>{setTicket();flush();},inspectInput:()=>inspectInput(),
  invokeHeld:()=>globalThis.heldComputedRow(),close:()=>setMenu(undefined)};
`;
    const worker = `
export const authoringWorkerSnapshot=session=>session;
export function discoverDataSuggestionsInWorker(session,input){
 globalThis.homeComputedJobs.push(input);
 return Promise.resolve({revision:input.revision,suggestions:[{identity:"controlled-uppercase",label:"Uppercase",icon:"type",revision:input.revision}],
   undecided:[],coverage:{operationsChecked:1,operationsSeen:1,operationsAvailable:1,truncated:false}});
}
export function prepareDataSuggestionInWorker(session,suggestion,input){
 globalThis.homeComputedPreparations.push(input);return Promise.resolve({ok:true,node:input.expression});
}
`;
    const browser = await Bun.build({ entrypoints: ["computed-home:entry"], target: "browser", conditions: ["browser", "development"],
      tsconfig: join(packageRoot, "tsconfig.json"), plugins: [{ name: "actual-home-computed-capture", setup(build) {
        build.onResolve({ filter: /^computed-home:/ }, args => ({path:args.path,namespace:"computed-home"}));
        build.onResolve({ filter: /authoring-catalog-worker$/ }, args => args.kind === "dynamic-import" ? {path:"computed-home:worker",namespace:"computed-home"} : undefined);
        build.onResolve({ filter: /.*/ }, args => {
          if(args.kind==="dynamic-import")return {path:"/computed-home-excluded/"+encodeURIComponent(args.path),external:true};
          if(clientModules[args.path])return {path:clientModules[args.path].replaceAll("\\","/")};
          if(args.path==="@fenel/engine/checkpoint-json")return {path:join(repository,"implementations/typescript/engine/src/checkpoint-json.ts").replaceAll("\\","/")};
          if(args.path.startsWith("@fenel/"))throw Error("Fixture attempted semantic bootstrap: "+args.path);
          if(args.path.startsWith("~/"))return {path:Bun.resolveSync(join(sourceRoot,args.path.slice(2)),sourceRoot).replaceAll("\\","/")};
        });
        build.onLoad({ filter: /.*/, namespace:"computed-home" }, async args => {
          const text=args.path==="computed-home:entry"?entry:args.path==="computed-home:worker"?worker
            :`import {createMemo,createSignal,onSettled} from "solid-js";\n${inspection.slice(ownerStart,ownerEnd)}`;
          return {loader:"ts",resolveDir:sourceRoot,contents:(await compiler.transformAsync(text,{filename:join(sourceRoot,"computed-home.fixture.tsx"),generate:"dom",hydratable:false,dev:true})).code};
        });
        build.onLoad({filter:/\.tsx$/},async args=>({loader:"ts",contents:(await compiler.transformAsync(await readFile(args.path,"utf8"),
          {filename:args.path,generate:"dom",hydratable:false,dev:true})).code}));
        build.onLoad({filter:/\.css$/},()=>({loader:"js",contents:""}));
      }}]});
    if(!browser.success)throw new AggregateError(browser.logs,"Computed Home fixture failed");
    const bundle=join(directory,phase+".js");await Bun.write(bundle,browser.outputs.find(output=>output.kind==="entry-point"));
    receipts.push({phase,homeSha256:createHash("sha256").update(home).digest("hex"),captureSha256:createHash("sha256").update(captureSource+menuSource).digest("hex"),bundle});
  }
  const cssPath=join(directory,"fixture.css");await Bun.write(cssPath,(await Promise.all(["global.css","routes/app.css","lib/home-entry.css","lib/locus-context-menu.css"].map(path=>readFile(join(sourceRoot,path),"utf8")))).join("\n")
    +"\n.computed-child-fixture { min-height: 160px !important; height: auto !important; }");
  await Bun.write(join(output,"source-receipt.json"),JSON.stringify(receipts,null,2));
  const runner=fileURLToPath(new URL("./home-computed-suggestions.browser-smoke.mjs",import.meta.url));
  const {runCommand}=await import(pathToFileURL(join(repository,"scripts/run-verification.mjs")).href);
  const driver=process.env.FENEL_TEST_PLAYWRIGHT_MODULE??join(repository,".tmp-diag/dependency-repair-20261016/full-staging/package/index.js");
  const logPath=join(directory,"stderr.log"),stdoutLogPath=join(directory,"stdout.log");
  const result=await runCommand({id:"computed-home-suggestions-browser",kind:"check",executable:"node",
    args:[runner,receipts[0].bundle,receipts[1].bundle,cssPath,output],timeoutMs:90_000},{
    root:repository,temp:directory,logPath,stdoutLogPath,startup:{timeoutMs:30_000,marker:"__FENEL_FIXTURE_DRIVER_READY__\n"},
    environment:{...process.env,FENEL_TEST_PLAYWRIGHT_MODULE:driver,FENEL_TEST_READY_FD:"3",TEMP:directory,TMP:directory}});
  const stdout=await readFile(stdoutLogPath,"utf8"),stderr=await readFile(logPath,"utf8");if(stdout)console.log(stdout);if(stderr)console.error(stderr);
  expect(result.passed,JSON.stringify(result)).toBe(true);expect(result.exitCode).toBe(0);
  await Bun.write(join(output,"passed-source-receipt.json"),JSON.stringify(receipts,null,2));
},120_000);
