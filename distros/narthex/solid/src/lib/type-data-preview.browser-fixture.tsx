import { For } from "solid-js";
import { render } from "@solidjs/web";
import type { FenelType } from "@fenel/engine/types";
import type { LocusTypeDescription } from "../../../../../implementations/typescript/engine/src/authoring/locus-type-presentation";
import { ValueHoverPreview } from "./value-hover-preview";
// @ts-expect-error C1 imports the actual HomeEntry preview functions through the harness.
import { HomeTypePreview } from "fixture:home-type-preview";
import previewStyle from "./home-entry.css?raw";
import functionCardStyle from "./function-card-body.css?raw";
import typedReadStyle from "./layout-renderer/typed-read-value.css?raw";
import appStyle from "../routes/app.css?raw";
import globalStyle from "../global.css?raw";

// C1 captured read rows. The engine's source-real projection tests establish
// these finite summary/dependence facts; this fixture exercises their inert
// consumption without acquiring a registry or executing a type expression.
const nothing = { $tag: "Nothing" } as const;
const yes = { $tag: "Just", _0: true } as const;
const stringType: FenelType = { $ref: "String" };
const field = (name: string, type: FenelType) => ({ name, type, label: nothing, meta: {}, ui: nothing });
const locationType: FenelType = { $ref: "WorkspacePresentationTarget" };
const locationShape: FenelType = { $variant: { cases: [
  { name: "ValuePresentationTarget", label: nothing, fields: [field("source", { $ref: "WorkspaceSource" }), field("focus", { $ref: "WorkspaceFocus" })] },
  { name: "InhabitantsPresentationTarget", label: nothing, fields: [field("typeRef", { $ref: "Ref" })] },
] } };
const recordType: FenelType = { $record: { fields: [field("title", stringType)] } };
const singleType: FenelType = { $variant: { cases: [{ name: "Point", label: nothing, fields: [field("x", stringType), field("y", stringType)] }] } };
const dependentType: FenelType = { $el: { var: "selectedType" } };
const nestedType: FenelType = { $record: { fields: [field("chosen", dependentType)] } };
const genericType: FenelType = { $el: { call: ["List", stringType] } };
const rows: Array<{ id: string; label: string; type: FenelType; descriptions: LocusTypeDescription[] }> = [
  { id: "location", label: "Data location", type: locationType, descriptions: [{ type: locationType,
    phrase: "A data location", code: "WorkspacePresentationTarget", kind: "named", kindLabel: "Named",
    previewShape: locationShape, previewDetails: { summary: "2 variants", dependent: nothing } }] },
  { id: "record", label: "Record schema", type: recordType, descriptions: [{ type: recordType,
    phrase: "A record", code: "Record", kind: "record", kindLabel: "Record",
    previewShape: recordType, previewDetails: { summary: "1 field", dependent: nothing } }] },
  { id: "single", label: "Point", type: singleType, descriptions: [{ type: singleType,
    phrase: "A choice", code: "Variant", kind: "variant", kindLabel: "Variant",
    previewShape: singleType, previewDetails: { summary: "2 fields", dependent: nothing } }] },
  { id: "direct", label: "Dependent type", type: dependentType, descriptions: [{ type: dependentType,
    phrase: "", code: "", kind: "el", kindLabel: "Dependent",
    previewShape: dependentType, previewDetails: { summary: "Dependent type", dependent: yes } }] },
  { id: "nested", label: "Dependent record", type: nestedType, descriptions: [{ type: nestedType,
    phrase: "A record", code: "Record", kind: "record", kindLabel: "Record",
    previewShape: nestedType, previewDetails: { summary: "1 field", dependent: yes } }] },
  { id: "generic", label: "List String", type: genericType, descriptions: [{ type: genericType,
    phrase: "A list of strings", code: "List String", kind: "el-call", kindLabel: "Generic App",
    previewShape: genericType, previewDetails: { summary: "Type application", dependent: nothing } }] },
  { id: "legacy", label: "Older type projection", type: { $ref: "PreviewLegacy" }, descriptions: [{ type: { $ref: "PreviewLegacy" },
    phrase: "A named type", code: "PreviewLegacy", kind: "named", kindLabel: "Named" }] },
];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("The inert preview attempted HTTP IO"); }) as unknown as typeof fetch;
render(() => <>
  <style>{globalStyle + appStyle + previewStyle + typedReadStyle + functionCardStyle}</style>
  <section data-type-preview-review style="display:flex;gap:16px;padding:24px;font-family:Arial,sans-serif;">
    <For each={rows}>{entry => <ValueHoverPreview class="home-item__type-tag" label={entry.label}
      preview={() => <HomeTypePreview type={entry.type} label={entry.label} descriptions={entry.descriptions} />}>
      <span data-type-hover-case={entry.id}>{entry.label}</span>
    </ValueHoverPreview>}</For>
  </section>
</>, document.getElementById("fixture")!);
Object.assign(globalThis, { fenelTypedRead: { state: () => ({ fetches }), debug: () => ({ scope: "inert projection rows" }) } });
