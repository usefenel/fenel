import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Browser regression harness: use the actual value-scope owner and shared
// inspection/loading components, with only the worker transport controlled.
const repo = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const frontend = resolve(repo, "distros/narthex/solid");
const scratch = resolve(repo, ".tmp/lens-loading");
await mkdir(scratch, { recursive: true });
const baseline = process.argv.includes("--baseline");
const previous = baseline ? Bun.spawn(["git", "show", "HEAD:distros/narthex/solid/src/routes/app/home.tsx"], { stdout: "pipe" }) : undefined;
const home = previous ? await new Response(previous.stdout).text() : await readFile(resolve(frontend, "src/routes/app/home.tsx"), "utf8");
if (previous && await previous.exited !== 0) throw new Error("Cannot read prior committed Home");
const start = home.indexOf("  const valueScopeWorker = createMemo(");
const stop = home.indexOf("  // A released drag", start);
if (start < 0 || stop < start) throw new Error("Value scope extraction failed");
const actual = home.slice(start, stop);
const loadingSource = await readFile(resolve(frontend, "src/lib/loading-screen/index.tsx"), "utf8");
const loading = loadingSource.slice(loadingSource.indexOf("export function LoadingScreen("), loadingSource.indexOf("/** Same spinner,"))
  .replaceAll("export function", "function");
const panelSource = await readFile(resolve(frontend, "src/lib/DataInspectionDialog.tsx"), "utf8");
const panels = (panelSource.slice(panelSource.indexOf("const legacyPanels:"), panelSource.indexOf("export function toggleDataInspectionPanel("))
  + panelSource.slice(panelSource.indexOf("export function DataInspectionPanels("), panelSource.indexOf("/** Browser chrome around the existing data")))
  .replaceAll("export function", "function");
const fixture = `
import { createMemo, createSignal, createEffect, isPending, refresh, untrack, Loading, Show, For, Errored } from "solid-js";
import { render } from "@solidjs/web";
import { createAsyncValue } from ${JSON.stringify(resolve(frontend, "src/lib/async-value.ts").replaceAll("\\", "/"))};
const [prepared, setPrepared] = createSignal(false);
const [mode, setMode] = createSignal("both");
const [epoch, setEpoch] = createSignal(1);
let currentEpoch = 1;
const [revision, setRevision] = createSignal(0);
const [workerRevision, setWorkerRevision] = createSignal(0);
let currentWorker = {};
const [focus, setFocus] = createSignal(globalThis.fixtureInitialRoot ? { kind: "root" } : { kind: "value", viewId: "demo", itemId: "words", path: [] });
const jobs = [];
const errors = [];
const session = { registry: { getIdentifiedEntity: () => undefined }, environment: {}, evaluateContext: {} };
const expression = { kind: "literal", value: "fox brown quick the" };
const item = { id: "words", source: { kind: "expr", expr: expression } };
const row = { id: "demo", view: { items: [item] } };
let inspect;
const startupSteps = ["Connecting to the server…", "Checking your sign-in…", "Loading data…"];
const startupMarks = [{ label: "Server", icon: "plug-connected" }, { label: "Sign-in", icon: "user-check" }, { label: "Data", icon: "list-check" }];
const startupFromDetail = detail => ({ stage: 2, detail });
const logoSrc = "";
function LoadingPaint(props) { return <div class={props.class}>{props.children}</div>; }
function IconByName() { return <span>✓</span>; }
function LocusLoadFailure() { return <p>Could not load data</p>; }
${loading}
${panels}
function ExpressionPending() { return <aside><span class="home-new-button__spinner" /> Preparing expression…</aside>; }
function Prepared() {
  const scope = focus;
  const transferSession = () => session;
  const authoringWorkerSnapshot = () => { workerRevision(); return currentWorker; };
  const draftRevision = revision;
  const rowById = () => row;
  const viewPersistence = { read: (_, value) => value };
  const asView = x => x;
  const findLocusItem = (items, id) => items.find(item => item.id === id);
  const savedExprById = () => new Map();
  const resolveExpr = item => item.source.expr;
  const getCatalog = () => [];
  const createReaderPresentation = () => ({ catalogEntry: () => undefined });
  const resolveLocusCatalogReference = () => undefined;
  const homeData = { type: () => ({ $ref: "String" }) };
  const savedQueryForItem = () => undefined;
  const ticket = {};
  const rootSourceTicket = () => ticket;
  const root = () => ({ revision: revision() });
  const scopeKey = () => "value:words";
  const sessionEpoch = epoch;
  const evaluateLocusCard = () => new Promise((resolve, reject) => jobs.push({ resolve, reject }));
  const assertCurrentSession = expected => { if (expected !== currentEpoch) throw new Error("Retired session"); };
  const client = { signal: new AbortController().signal };
  const assertSourceTicket = expected => { if (expected !== ticket) throw new Error("Retired source"); };
  const followLocusPath = value => ({ value, followed: false });
  const readLocusCatalogReference = () => undefined;
  const childValueType = () => ({ $ref: "String" });
  const valueAt = value => value;
  const resolveValueType = type => type;
  const isFenelTypeLike = () => false;
  const childrenOf = () => undefined;
  ${actual}
  // Home's toolbar reads this same value outside its per-panel boundaries.
  const title = createMemo(() => valueScope()?.ok ? "Reversed words" : "Reversed words");
  const resultText = createMemo(() => { const result = valueScope(); return result?.ok ? result.container : result?.error; });
  inspect = { refetch: () => valueScopeResponse.refetch() };
  return <div data-prepared><h2>{title()}</h2><small>String</small><DataInspectionPanels inline mode={mode()}
    data={() => <Show when={valueScopeLoading()} fallback={<p class="result" data-result>{resultText()}</p>}><div data-spinner>${baseline ? '<LoadingScreen inline detail="Loading data…" />' : '<LensSpinner />'}</div></Show>}
    expression={() => <ExpressionPending />} /></div>;
}
Object.assign(globalThis, { fixture: { handoff: () => setPrepared(true), mode: setMode, jobs, errors,
  release: (index, value) => jobs[index].resolve({ result: value, trace: [] }),
  fail: index => jobs[index].reject(new Error("Worker unavailable")),
  refetch: () => { void inspect.refetch(); }, revision: () => setRevision(n => n + 1),
  root: () => setFocus({ kind: "root" }), value: () => setFocus({ kind: "value", viewId: "demo", itemId: "words", path: [] }),
  epoch: () => { currentEpoch++; setEpoch(currentEpoch); },
  worker: () => { currentWorker = {}; setWorkerRevision(n => n + 1); } } });
render(() => <Errored fallback={error => { errors.push(String(error())); return <p data-error>{String(error())}</p>; }}>
  <header><b>Fenel</b><span>All data › Fenel › Demo › Reversed words</span><span class="controls">Data &nbsp; Expression</span></header>
  <Loading on={epoch()} fallback={<p data-boundary-spinner>Preparing current data</p>}>
    <Show when={prepared()} fallback={<div data-early><h2>Reversed words</h2><small>String</small><DataInspectionPanels inline mode={mode()}
      data={() => <p class="result">fox brown quick the</p>} expression={() => <ExpressionPending />} /></div>}><Prepared /></Show>
  </Loading>
</Errored>, document.body);
`;
const fixturePath = join(scratch, "handoff.tsx");
await writeFile(fixturePath, fixture);
const compilerPath = Bun.resolveSync("@solidjs/compiler", dirname(Bun.resolveSync("@solidjs/vite-plugin", frontend)));
const compiler = await import(pathToFileURL(compilerPath).href);
const packages = { "solid-js": await realpath(resolve(frontend, "node_modules/solid-js")),
  "@solidjs/web": await realpath(resolve(frontend, "node_modules/@solidjs/web")) };
const built = await Bun.build({ entrypoints: [fixturePath], target: "browser", conditions: ["browser", "development"],
  plugins: [{ name: "solid-handoff", setup(build) {
    build.onResolve({ filter: /^(?:solid-js|@solidjs\/web)$/ }, args => ({ path: resolve(packages[args.path],
      args.path === "solid-js" ? "dist/solid.dev.js" : "dist/web.dev.js") }));
    build.onLoad({ filter: /\.tsx$/ }, async args => ({ loader: "ts", contents: (await compiler.transformAsync(await readFile(args.path, "utf8"),
      { filename: args.path, generate: "dom", hydratable: false, dev: true })).code }));
  } }] });
if (!built.success) throw new AggregateError(built.logs, "Cannot build handoff fixture");
await writeFile(join(scratch, baseline ? "before.js" : "browser.js"), await built.outputs[0].text());
const css = await readFile(resolve(frontend, "src/lib/loading-screen/loading-screen.css"), "utf8");
await writeFile(join(scratch, "style.css"), css + '\nbody { margin:0; font:14px Arial,sans-serif; color:#25282d; background:#fafaf9; } header{display:flex;align-items:center;padding:15px 24px;border-bottom:1px solid #d8dadd;background:white;gap:30px;} header b{font-size:21px;color:#526658} .controls{margin-left:auto;color:#646972}h2{margin:30px 36px 6px}small{margin-left:36px;color:#737983}.data-inspection-dialog__panels{display:grid;grid-template-columns:1fr 1fr;margin:30px 36px;gap:24px;}section,aside{min-height:210px;display:flex;align-items:center;justify-content:center}section{border:1px solid #e0e2e4;background:white;}aside{color:#858b92;font-size:12px;gap:8px}.result{font-size:22px}.workspace-startup{display:flex;justify-content:center;width:100%}.home-new-button__spinner{display:inline-block;width:14px;height:14px;border:2px solid #d2d5d8;border-top-color:#858b92;border-radius:100%}.workspace-pane__wait{display:flex;justify-content:center;}');
console.log(join(scratch, baseline ? "before.js" : "browser.js"));
