// C1: the actual generated public root and shared HomeEntry, with complete
// reader and editor preparation deliberately unavailable.
import { createMemo, createSignal, Errored, Loading, Show, untrack } from "solid-js";
import { render } from "@solidjs/web";
import { createRouter, memoryHistory } from "@solidjs/router";
import HomeEntry from "./home-entry";
import { WorkspaceReadinessContext } from "./workspace-readiness";
import { createLocusNotificationCenter, LocusNotificationContext } from "./locus-notifications";
import { createPublicApiClient } from "./api";
import { loadPublicBootstrap, readPublicInitialValue } from "./public-bootstrap";
import type { WorkspacePane } from "./workspace-pane";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { LocusScope } from "./locus-scope";

const errors: string[] = [];
let requests = 0;
const [mode, setMode] = createSignal<import("./DataInspectionDialog").DataInspectionMode>("data");
const [focus, setFocus] = createSignal<LocusScope>({ kind: "value", viewId: "public-fenel", itemId: "demo", rootItem: true, path: [] });
const client = createPublicApiClient();
const notifications = createLocusNotificationCenter();
const bootstrap = createMemo(() => loadPublicBootstrap());
const pane: WorkspacePane = {
  id: "initial-public-demo", active: () => true,
  focus,
  presentation: () => "grid", inspectionMode: mode, onInspectionMode: setMode,
  toolbarMount: () => undefined, source: () => ({ $tag: "PublicSource" }), sourceLabel: () => "Fenel", accounts: () => [],
  onFocus: () => {}, onOpenLens: () => {}, onClose: () => {}, onPresentation: () => {}, onSource: () => {},
  onSubject: () => {}, registerFlush: () => () => {},
};
const Router = createRouter({ history: memoryHistory("/"), routes: [{ path: "/", component: () =>
  <Show when={bootstrap()}>{snapshot => <HomeEntry client={client} publicRoot={snapshot().root} pane={pane} />}</Show> }] });

const fixture = {
  openReversedWordsGraph: () => {
    setFocus({ kind: "value", viewId: "public-fenel", itemId: "demo", rootItem: true, path: ["Reversed words"] });
    setMode("expression");
  },
  state: () => {
    const snapshot = untrack(bootstrap);
    const demo = snapshot.root.items.find(item => item.id === "demo")!.source!;
    if (demo.kind !== "expr" || demo.expr.kind !== "literal") throw new Error("Expected original public record");
    const fields = (demo.expr.value as { __record: { fields: Array<{ name: string; value: ExprNode }> } }).__record.fields;
    return { requests, errors: [...errors],
      computed: fields.filter(field => field.value.kind === "call").map(field => {
        const initial = readPublicInitialValue(snapshot.root, field.value);
        return { label: field.name, available: !!initial,
          scalar: initial && typeof initial.value !== "object" ? String(initial.value) : undefined,
          variant: field.value.kind === "call" && field.value.fnId.startsWith("fixture:"),
          valueTag: initial && initial.value && typeof initial.value === "object"
            ? (initial.value as { $tag?: string }).$tag : undefined };
      }) };
  },
};
Object.assign(globalThis, { publicInitialReadsFixture: fixture });
render(() => <Errored fallback={error => { errors.push(String(error())); return <pre data-fixture-error>{String(error())}</pre>; }}>
  <Loading fallback={<p>Loading snapshot…</p>}><WorkspaceReadinessContext value={{ ready: () => false,
    loading: () => false, stage: () => "Preparing complete reader…", error: () => null,
    request: () => { requests++; }, retry: () => {} }}><LocusNotificationContext value={notifications}><Router /></LocusNotificationContext></WorkspaceReadinessContext></Loading>
</Errored>, document.body);
