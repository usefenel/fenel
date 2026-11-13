import { render } from "@solidjs/web";
import { createSignal } from "solid-js";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { IconByName } from "./icons";
import { ValueCard, ValueCardCaption, CollectionPreviewStrip } from "./value-card";
import { TypeDataPreviewBody } from "./type-data-preview";
import { LocusBreadcrumb } from "./locus-breadcrumb";
import { FunctionCardBody } from "./function-card-body";
import { TooltipLayer } from "./tooltip";
import { DataPreview, DataThumbnail } from "./data-transfer/DataPreview";

const field = (name: string): FieldDef => ({ name, type: { $ref: "String" }, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} });
const record: FenelType = { $record: { fields: Array.from({ length: 13 }, (_, index) => field(`field${index}`)) } };
const opened: unknown[] = [];
const describeType = (type: FenelType) => ({ type, label: "$ref" in type ? type.$ref : "Record", icon: "$ref" in type ? "type" : "stack" });
const typePreview = () => <ValueCard heading={<ValueCardCaption caption="Record" typeLabel="Type" typeIcon="shapes" />}>
  <TypeDataPreviewBody type={record} describeType={describeType} compact />
</ValueCard>;
const names = ["Axioms and named claims", "Recipes and rules", "Country encyclopedia", "A long collection name that needs to be clipped within the compact card", "Shared utilities"];
const items = Array.from({ length: 13 }, (_, index) => index);
const number = { type: "checked-number", label: "Number", icon: "hash" };
const [bodyPresentation, setBodyPresentation] = createSignal<"body" | "full">("body");
const [bodyData, setBodyData] = createSignal("fox brown quick the");
const [listWidth, setListWidth] = createSignal(270);
const [listValues, setListValues] = createSignal([3, 1, 2]);

// C1: source-shaped read-plan oracle; production gets this text from the
// reader's existing surfaceReadValuePlan, exercised in reader-value-source.
const scalarPlan = (value: number) => ({ kind: "text" as const, text: String(value),
  raw: value, empty: false, fallbackKind: "scalar" as const });
function NumericCollection(props: { output?: boolean; compact?: boolean; oneLine?: boolean }) {
  const values = () => props.output ? [...listValues()].reverse() : listValues();
  return <ValueCard presentation={props.compact ? "inline" : "graph"} compactLayout={props.compact ? props.oneLine ? "one-line" : "two-line" : undefined}
    heading={<ValueCardCaption unnamed typeLabel="List of numbers" typeIcon="list" />}>
    <span style="display:contents"><span class="typed-read-value">
      <CollectionPreviewStrip items={values()} label="Numbers" inlinePreviews itemLabel={value => String(value)}
        itemControl={props.compact && !props.oneLine ? undefined : value => <button type="button" class="expr-graph-collection__item-dot"
          aria-label={`Expand ${value}`} onClick={() => opened.push({ expand: value })}>•</button>}
        render={value => <DataThumbnail value={value} typeIcon="hash" valueIcon="hash" scalarPlan={scalarPlan(value)} />}
        preview={value => <DataPreview value={value} />} onOpenItem={value => opened.push({ number: value })}
        onEnterCollection={() => opened.push("numbers")} />
    </span></span>
  </ValueCard>;
}

function Collection(props: { name: string }) {
  return <CollectionPreviewStrip items={items} label="Fields" countLabel="13 fields"
    itemLabel={index => `${props.name} field ${index + 1}`} render={() => <IconByName name="function" size={22} />}
    preview={() => typePreview()} onOpenItem={index => opened.push(index)} onEnterCollection={() => opened.push("collection")} />;
}
function RecordCard(props: { name: string }) {
  return <ValueCard heading={<ValueCardCaption caption={props.name} typeLabel="Record" typeIcon="stack"
    typePreview={typePreview} onTypeOpen={() => opened.push({ type: record, source: "card" })} />}>
    <Collection name={props.name} />
  </ValueCard>;
}
render(() => <>
  <main style="padding:20px;font-family:Arial,sans-serif;max-width:820px;margin:auto;">
    <header style="display:flex;margin-bottom:28px;" data-breadcrumb>
      <LocusBreadcrumb scope={{ kind: "view", viewId: "demo" }} rootLabel="Fenel" rootIcon="globe"
        viewName={() => "Demo"} typeLabel="Record" typeIcon="stack" typePreview={typePreview}
        onTypeOpen={() => opened.push({ type: record, source: "breadcrumb" })} onNavigate={scope => opened.push(scope)} />
    </header>
    <section data-collections style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;">
      <div data-record-card style="height:150px;"><RecordCard name="Recipes and rules" /></div>
      <div style="height:150px;"><ValueCard heading={<ValueCardCaption caption="Public collections" typeLabel="List" typeIcon="list" />}>
        <CollectionPreviewStrip items={names} label="Collections" itemLabel={name => name} render={() => <IconByName name="stack" size={22} />}
          preview={name => <RecordCard name={name} />} onOpenItem={name => opened.push(name)} onEnterCollection={() => opened.push("all")} />
      </ValueCard></div>
    </section>
    <section data-composable-body style="margin-top:28px;">
      <ValueCard presentation={bodyPresentation()} itemId="$self" onMenu={() => {}}
        heading={<ValueCardCaption caption="Reversed words" typeLabel="String" typeIcon="type" />}
        actions={<button type="button" data-body-action>Run</button>}>
        <DataPreview value={bodyData()} />
      </ValueCard>
    </section>
    <div data-single-line style="margin-top:32px;max-width:100%;">
      <ValueCard presentation="inline" heading={<ValueCardCaption caption="Add" typeLabel="Function" typeIcon="function" />}>
        <FunctionCardBody inputs={[number, number]} output={number} previewType={typePreview} onOpenType={() => {}} onOpenInputs={() => {}} />
      </ValueCard>
    </div>
    <section data-card-layouts style="display:flex;flex-direction:column;align-items:flex-start;gap:12px;margin-top:28px;">
      <div data-wide-card style="width:100%;"><ValueCard heading={<ValueCardCaption caption="Reversed words" typeLabel="String" typeIcon="type" />}>
        <span>fox brown quick the</span>
      </ValueCard></div>
      <div data-function-hover><ValueCard presentation="inline" compactLayout="two-line"
        heading={<ValueCardCaption caption="Approximate Rational as Number" typeLabel="Function" typeIcon="function" />}>
        <DataThumbnail value={{ $ref: "checked-function" }} typeIcon="function" />
      </ValueCard></div>
      <div data-specific-function-hover><ValueCard presentation="inline" compactLayout="two-line"
        heading={<ValueCardCaption caption="My function" icon="bot" typeLabel="Function" typeIcon="function" />}>
        <DataThumbnail value={{ $ref: "checked-function" }} valueIcon="bot" typeIcon="function" />
      </ValueCard></div>
      <div data-scalar-badge style="display:inline-flex;align-items:center;gap:5px;max-width:100%;">Computed:
        <ValueCard presentation="inline" heading={<ValueCardCaption caption="" unnamed typeLabel="String" typeIcon="type" />}>
          <span>fox</span>
        </ValueCard>
      </div>
      <div data-two-line-scalar><ValueCard presentation="inline" compactLayout="two-line"
        heading={<ValueCardCaption caption="Item 1" typeLabel="String" typeIcon="type" />}>
        <span>LENEF</span>
      </ValueCard></div>
      <div data-unnamed-full class="expr-call-graph__data-card-host expr-call-graph__data-card-host--unnamed" style="width:100%;">
        <ValueCard heading={<ValueCardCaption caption="" unnamed typeLabel="List of strings" typeIcon="list" />}>
          <CollectionPreviewStrip items={["LENEF", "!!!"]} label="Items" itemLabel={(_, index) => `Item ${index + 1}`}
            render={() => <IconByName name="type" size={20} />} preview={() => typePreview()} onOpenItem={() => {}} />
        </ValueCard>
      </div>
    </section>
    <section data-numeric-strips style="display:flex;flex-direction:column;gap:16px;margin-top:28px;">
      <div data-list-case="input" style={{ width: `${listWidth()}px` }}><NumericCollection /></div>
      <div data-list-case="output" style={{ width: `${listWidth()}px` }}><NumericCollection output /></div>
      <div data-list-case="compact" style="width:270px;"><NumericCollection compact /></div>
      <div data-list-case="one-line" style="width:270px;"><NumericCollection compact oneLine /></div>
    </section>
  </main>
  <TooltipLayer />
</>, document.body);
Object.assign(globalThis, { inlineCardFixture: { opened, record, setBodyData, setBodyPresentation, setListWidth, setListValues, showUnsavedBadge() {
  const host = document.createElement("div");
  host.dataset.unsavedBadge = "true";
  document.body.append(host);
  render(() => <ValueCard presentation="inline" heading={<ValueCardCaption unnamed unsaved typeLabel="String" typeIcon="type" />}>
    <span>Edited text</span>
  </ValueCard>, host);
} } });
