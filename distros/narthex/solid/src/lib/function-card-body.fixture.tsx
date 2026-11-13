import { render } from "@solidjs/web";
import { IconByName } from "./icons";
import { FunctionCardBody, type FunctionCardType } from "./function-card-body";
import { ValueCard, ValueCardCaption } from "./value-card";
import { TypeDataPreviewBody } from "./type-data-preview";
import type { FenelType, FieldDef } from "@fenel/engine/types";

const previous = new URL(location.href).searchParams.get("before") === "1";
const number: FunctionCardType<string> = { type: "checked-number", label: "Number", icon: "hash", term: "Number" };
const variable: FunctionCardType<string> = { type: "checked-variable", label: "a", term: "a" };
const cases = [
  { name: "Apply ($)", inputs: [{ type: "checked-arrow", label: "a → b", icon: "function" }, variable], output: { type: "checked-return-variable", label: "b" } },
  { name: "Absolute value", inputs: [number], output: number },
  { name: "Add", inputs: [number, number], output: number },
];
const many = [{ type: "checked-a", label: "Reader A", icon: "bot" }, { type: "checked-b", label: "Reader B", icon: "user" },
  number, variable, { type: "checked-long", label: "A long admitted type name" }];
const opened: Array<{ type?: string; index?: number; inputs?: boolean }> = [];
const field = (name: string, type: FenelType): FieldDef => ({ name, type, label: { $tag: "Nothing" }, ui: { $tag: "Nothing" }, meta: {} });
const point: FenelType = { $variant: { cases: [{ name: "Point", label: { $tag: "Nothing" }, fields: [field("x", { $ref: "Number" }), field("y", { $ref: "Number" })] }] } };
const outcome: FenelType = { $variant: { cases: [
  { name: "Ready", label: { $tag: "Nothing" }, fields: [field("title", { $ref: "String" })] },
  { name: "Refused", label: { $tag: "Nothing" }, fields: [field("reason", { $ref: "String" })] },
] } };
const describeType = (type: FenelType): FunctionCardType<FenelType> => ({ type,
  label: "$ref" in type ? type.$ref : "$type" in type ? "Type" : "Record",
  icon: "$ref" in type ? type.$ref === "Number" ? "hash" : "type" : "shapes" });
const previewType = (entry: FunctionCardType<string>) => <ValueCard heading={<ValueCardCaption caption={entry.label} typeLabel="Type" typeIcon="shapes" />}>
  <span>{entry.term ?? entry.label}</span>
</ValueCard>;
function Body(props: { inputs: readonly FunctionCardType<string>[]; output: FunctionCardType<string> }) {
  return <FunctionCardBody inputs={props.inputs} output={props.output} previewType={previewType}
    onOpenType={(entry, index) => opened.push({ type: entry.type, index })} onOpenInputs={() => opened.push({ inputs: true })} />;
}
function Fixture() {
  return <main style="padding:24px;font-family:Arial,sans-serif;">
    <div style="display:flex;gap:16px;" data-examples>
      {cases.map(item => <div data-function-case={item.name} style="width:180px;height:170px;"><ValueCard heading={<ValueCardCaption caption={item.name} typeLabel="Function" typeIcon="function" />}>
        {!previous && <Body inputs={item.inputs} output={item.output} />}
      </ValueCard></div>)}
    </div>
    <div data-responsive style="width:180px;height:170px;margin-top:24px;">
      <ValueCard heading={<ValueCardCaption caption="Many input types" typeLabel="Function" typeIcon="function" />}>
        {!previous && <Body inputs={many} output={number} />}
      </ValueCard>
    </div>
    <div data-inline style="margin-top:24px;width:352px;">
      <ValueCard presentation="inline" heading={<ValueCardCaption caption="Add" typeLabel="Function" typeIcon="function" />}>
        {previous ? <IconByName name="function" size={16} /> : <Body inputs={[number, number]} output={number} />}
      </ValueCard>
    </div>
    <div data-nullary style="width:180px;height:170px;margin-top:24px;">
      <ValueCard heading={<ValueCardCaption caption="No inputs" typeLabel="Function" typeIcon="function" />}>
        {!previous && <Body inputs={[]} output={variable} />}
      </ValueCard>
    </div>
    <section data-type-previews style="display:grid;grid-template-columns:repeat(2,320px);gap:16px;margin-top:24px;">
      <div data-type-single><ValueCard heading={<ValueCardCaption caption="Point" typeLabel="Type" typeIcon="shapes" />}>
        <TypeDataPreviewBody type={point} describeType={describeType} />
      </ValueCard></div>
      <div data-type-variants><ValueCard heading={<ValueCardCaption caption="Chart outcome" typeLabel="Type" typeIcon="shapes" />}>
        <TypeDataPreviewBody type={outcome} describeType={describeType} />
      </ValueCard></div>
      <div data-type-hover><ValueCard heading={<ValueCardCaption caption="Solver" typeLabel="Record" typeIcon="stack"
        typePreview={() => <ValueCard heading={<ValueCardCaption caption="Record" typeLabel="Type" typeIcon="shapes" />}>
          <TypeDataPreviewBody type={point} describeType={describeType} />
        </ValueCard>} onTypeOpen={() => opened.push({ type: "record-type" })} />}>
        <span>Existing data</span>
      </ValueCard></div>
      <div data-type-compact><ValueCard heading={<ValueCardCaption caption="Record schema" typeLabel="Type" typeIcon="shapes" />}>
        <TypeDataPreviewBody compact type={point} describeType={describeType} />
      </ValueCard></div>
    </section>
  </main>;
}
render(() => <Fixture />, document.body);
Object.assign(globalThis, { functionCardFixture: { opened: () => [...opened] } });
declare global { var functionCardFixture: { opened: () => typeof opened }; }
