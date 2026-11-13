import { createSignal, Show } from "solid-js";
import { render } from "@solidjs/web";
import { LocusBreadcrumb } from "./locus-breadcrumb";
import type { LocusScope } from "./locus-scope";
import { LocusLayoutControl } from "./locus-layout-control";
import { AccountDataSelector } from "./account-data-selector";
import { IconSearch, IconPlus, IconSettings, IconPanelsTopLeft, IconX, TYPE_ICON_FALLBACKS } from "./icons";
import { DataThumbnail } from "./data-transfer/DataPreview";

const [width, setWidth] = createSignal(340);
const [viewLabel, setViewLabel] = createSignal("Projects collection");
const [icon, setIcon] = createSignal<string>();
const [scopedThumbnails, setScopedThumbnails] = createSignal(false);
const [scope, setScope] = createSignal<LocusScope>({ kind: "value", viewId: "projects", itemId: "project-one",
  path: ["An intermediate field with a long descriptive name", "Another containing record", "Final data"] });
const navigation: LocusScope[] = [];
const opened: LocusScope[] = [];
const fixture = { setWidth, setScope, setViewLabel, setIcon, setScopedThumbnails, navigation, opened, scope };
declare global { var locusBreadcrumbFixture: typeof fixture; }
globalThis.locusBreadcrumbFixture = fixture;
function pathDepth() { const here = scope(); return here.kind === "value" ? here.path.length : 0; }

function Toolbar() {
  const nested = new URL(location.href).searchParams.has("nested");
  return <div class="home-toolbar">
    <LocusBreadcrumb scope={nested ? scope() : { kind: "root" }} rootLabel="bayneframe" typeLabel={nested ? "Record" : "A list of anything"} typeIcon="list"
      rootControl={<AccountDataSelector value="account" options={[{ id: "account", label: "bayneframe" }, { id: "public", label: "Fenel" }]} onChange={() => {}} />}
      onNavigate={() => {}} />
    <LocusLayoutControl kind="grid" options={[{ value: "grid", label: "Grid", icon: "layout-grid" }, { value: "list", label: "List", icon: "list" }]} onChange={() => {}} />
    <button class="btn home-search-trigger home-action-button"><IconSearch size={16} />Browse</button>
    <button class="btn home-action-button">+ New</button>
    <button class="btn workspace-pane__close" aria-label="Close lens"><IconX size={16} /></button>
  </div>;
}
function ToolbarFixture(props: { tiled: boolean }) {
  return <div class="dashboard dashboard--home" data-workspace="true" data-bar-mode="DockedBar" data-bar-position="BarTop">
    <header class="topbar"><div class="topbar__workspace"><div class="workspace-controls">
      <Show when={!props.tiled}><div class="workspace-data-controls"><Toolbar /></div></Show>
      <fieldset class="workspace-lens-controls" style="border:0;padding:0;margin:0">
        <button class="btn" aria-label="Lenses"><IconPanelsTopLeft size={16} /><span>{props.tiled ? 2 : 1}</span></button>
        <button class="btn" aria-label="Add lens"><IconPlus size={16} /></button>
        <button class="btn" aria-label="Lens settings"><IconSettings size={16} /></button>
      </fieldset>
    </div></div></header>
    <main class="main-content--home"><Show when={props.tiled}><section class="workspace-pane"><header class="workspace-pane__header"><Toolbar /></header></section></Show></main>
  </div>;
}
const toolbar = new URL(location.href).searchParams.get("toolbar");
render(() => <Show when={toolbar} fallback={<div style={{ padding: "12px" }}>
  <div data-breadcrumb-host style={{ display: "flex", width: `${width()}px`, "max-width": "100%" }}>
    <LocusBreadcrumb scope={scope()} rootLabel="Shared account" rootIcon="user" icon={icon()} typeLabel="Record" typeIcon={TYPE_ICON_FALLBACKS.Record}
      renderScopeThumbnail={scopedThumbnails() ? here => here.kind === "value" && here.path.length > 0
        ? <span data-reader-thumbnail="field" style="width:100%;height:100%"><DataThumbnail value={undefined} valueIcon={here.path.length === pathDepth() ? icon() ?? "mail" : "mail"} typeIcon="stack" /></span>
        : here.kind === "value" ? <span data-reader-thumbnail="image" style="width:100%;height:100%"><DataThumbnail value={{ width: 1, height: 1, pixels: [{ r: 158, g: 198, b: 233, a: 255 }] }} valueIcon="user" typeIcon="stack" /></span>
        : <span data-reader-thumbnail="type" style="width:100%;height:100%"><DataThumbnail value={undefined} typeIcon="list" /></span> : undefined}
      viewName={viewLabel} itemName={() => "Project overview"}
      onNavigate={next => { navigation.push(next); setScope(next); }} onOpenLens={next => { opened.push(next); }} />
  </div>
</div>}><ToolbarFixture tiled={toolbar === "two"} /></Show>, document.body);
