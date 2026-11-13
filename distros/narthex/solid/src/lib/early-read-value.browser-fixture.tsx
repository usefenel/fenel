import { createSignal, Errored, Loading, untrack } from "solid-js";
import { render } from "@solidjs/web";
import { createRouter, memoryHistory } from "@solidjs/router";
import HomeEntry from "./home-entry";
import { WorkspaceReadinessContext } from "./workspace-readiness";
import { createLocusNotificationCenter, LocusNotificationContext } from "./locus-notifications";
import { createPublicApiClient } from "./api";
import { sessionEpoch, setBrowserAccountScope } from "./browser-session";
import { SEED_VALUES } from "./expression-runner/seed-values";
import { evaluateLocusCard, readLocusCardResult } from "./locus-card-evaluation";
import { jobs } from "./early-read-value.browser-worker-fixture";
import type { LocusRootData } from "./locus-root-data";
import type { ReaderRuntime } from "./reader-runtime";
import type { WorkspacePane } from "./workspace-pane";
import type { DataInspectionMode } from "./DataInspectionDialog";

const names = ["Reversed shouting", "Compound interest", "Reversed words"];
const examples = names.map(name => SEED_VALUES.find(entry => entry.name === name)!);
const saved = new Map();
const errors: string[] = [];
let requests = 0, editorHandoffs = 0, sameCache = false;
const [runtime, setRuntime] = createSignal<ReaderRuntime>();
const [editorReady, setEditorReady] = createSignal(false);
const [mode, setMode] = createSignal<DataInspectionMode>("data");
const client = createPublicApiClient();
const readers: ReaderRuntime[] = [];
const notifications = createLocusNotificationCenter();
const root: LocusRootData = {
  id: "public-fenel", name: "Demo", type: { $ref: "Any" },
  expr: { kind: "literal", value: { __list: examples.map(entry => entry.expr) } },
  revision: 0, persisted: false, canEdit: false, layout: { kind: "grid" }, lists: [], expressions: {},
  referenceId: "locus:public-fenel",
  items: examples.map((entry, index) => ({ id: `demo-${index}`, caption: entry.name,
    source: { kind: "expr", expr: entry.expr }, valueType: entry.type })),
};
const pane: WorkspacePane = {
  id: "public-demo", active: () => true, focus: () => ({ kind: "root" }), presentation: () => "grid",
  inspectionMode: mode, onInspectionMode: setMode, toolbarMount: () => undefined,
  source: () => ({ $tag: "PublicSource" }), sourceLabel: () => "Public examples", accounts: () => [],
  onFocus: () => {}, onOpenLens: () => {}, onClose: () => {}, onPresentation: () => {}, onSource: () => {},
  onSubject: () => {}, registerFlush: () => () => {},
};
const Router = createRouter({ history: memoryHistory("/"), routes: [{ path: "/", component: () => <HomeEntry
  client={client} publicRoot={root} pane={pane} readRuntime={runtime()}
  renderWorkspace={() => {
    editorHandoffs++;
    const current = untrack(runtime)!;
    sameCache = examples.every(entry => {
      const prior = readLocusCardResult(entry.expr, saved, current.session());
      return !!prior && evaluateLocusCard(entry.expr, saved, current.session()) === prior;
    });
    return <div data-editor-handoff>Checked data kept for editing</div>;
  }} /> }] });

const fixture = {
  state: () => ({ requests, editorHandoffs, sameCache, mode: mode(), errors: [...errors],
    jobs: jobs.map(job => ({ reader: job.session.reader, fnId: job.node.fnId })) }),
  prepare: () => {
    const lifecycle = new AbortController();
    const session = { mode: "detached", reader: readers.length + 1, worker: {}, registry: {}, environment: {}, catalog: [], evaluateContext: {} };
    const next = { kind: "public", epoch: sessionEpoch(), client: { signal: lifecycle.signal },
      session: () => { lifecycle.signal.throwIfAborted(); return session; },
      dispose: () => lifecycle.abort(new Error("Reader closed")) } as unknown as ReaderRuntime;
    readers.push(next); setRuntime(next);
  },
  release: (reader: number, values: unknown[]) => {
    jobs.filter(job => job.session.reader === reader).forEach((job, index) => job.resolve({ result: values[index], trace: [] }));
  },
  fail: (reader: number) => { jobs.filter(job => job.session.reader === reader).forEach(job => job.reject(new Error("Worker unavailable"))); },
  close: () => { untrack(runtime)?.dispose(); },
  login: () => setBrowserAccountScope("next-reader", true),
  handoff: () => { setMode("expression"); setEditorReady(true); },
};
Object.assign(globalThis, { earlyReadFixture: fixture });
render(() => <Errored fallback={error => { errors.push(String(error())); return <pre data-fixture-error>{String(error())}</pre>; }}>
  <Loading fallback={<p>Loading fixture…</p>}><WorkspaceReadinessContext value={{ ready: editorReady,
    loading: () => !editorReady(), stage: () => "Preparing editing tools…", error: () => null,
    request: () => { requests++; }, retry: () => {} }}><LocusNotificationContext value={notifications}><Router /></LocusNotificationContext></WorkspaceReadinessContext></Loading>
</Errored>, document.body);
