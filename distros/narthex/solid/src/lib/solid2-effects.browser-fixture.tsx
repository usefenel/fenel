// Actual migrated components; network and browser resource accounting live in
// the runner. Mount/dispose each case independently to expose cleanup leaks.
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { DataTable } from "./data-table/DataTable";
import { NumberInput } from "./number-input";
import { ValueDisplay } from "./storybook";
import { PlanView } from "./fenel-surface";
import ViewLab from "../routes/app/view-lab";
import EngineShowcase from "../routes/app/engine-showcase";
import { FieldOccurrenceEditorBase, type FieldFacetDrafts } from "./field-occurrence/FieldOccurrenceEditorBase";
import { FieldAuthoringProvider } from "./field-occurrence/context";
import { Nothing } from "@fenel/engine/type-foundation";

let dispose: (() => void) | undefined;
let selections: string[][] = [];
let changes: number[] = [];
let hydrated: FieldFacetDrafts[] = [];
let replace: (value: unknown) => void = () => {};
const pixel = (red: number, blue: number) => ({ width: 1, height: 1, pixels: [{ r: red, g: 0, b: blue, a: 255 }] });
function media(kind: "frames" | "movie", blue: boolean) {
  const seq = { fps: 1, frames: [pixel(blue ? 0 : 255, blue ? 255 : 0)] };
  return kind === "frames" ? { $tag: "Frames", _0: seq } : {
    $tag: "Recorded", _0: { ...seq, width: 1, height: 1, audio: { sampleRate: 8000, channels: 2, samples: [{ l: 0, r: 0 }] } },
  };
}
const api = {
  mount(kind: "number" | "table" | "frames" | "movie" | "shape" | "view" | "game" | "showcase" | "facets") {
    api.dispose();
    selections = [];
    changes = [];
    hydrated = [];
    const host = document.getElementById("fixture")!;
    dispose = render(() => {
      const [value, setValue] = createSignal<unknown>(kind === "number" ? 42 : kind === "facets" ? {} : media(kind === "movie" ? "movie" : "frames", false));
      replace = (next) => { setValue(next); flush(); };
      switch (kind) {
        case "number": return <NumberInput value={value()} onChange={(next) => { changes.push(next); setValue(next); }} ariaLabel="Numeric draft" />;
        case "table": return <DataTable entity="fixture" columns={[{ key: "name", label: "Name" }]} onSelectionChange={(ids) => selections.push(ids)} />;
        case "frames": case "movie": return <ValueDisplay value={value()} />;
        case "shape": return <div style="width: 100px; height: 100px"><PlanView plan={{ $tag: "PlanShapePath", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], fill: { r: 255, g: 0, b: 0, a: 255 } }} /></div>;
        case "view": return <ViewLab />;
        case "showcase": return <EngineShowcase />;
        case "facets": return <FieldAuthoringProvider facetsByFieldId={{}} onFieldFacetsChange={() => {}} onFieldFacetsForget={() => {}} onFieldFacetsHydrate={(_id, facets) => hydrated.push(facets)}>
          <FieldOccurrenceEditorBase field={{ name: "fixtureField", key: { $tag: "NamedField", ref: { $ref: "00000000-0000-4000-8000-000000000201" } }, type: { $ref: "String" }, label: Nothing, ui: Nothing, meta: {} }}
            onChange={() => {}} renderTypeEditor={() => <span>String</span>} facets={value() as FieldFacetDrafts | undefined} />
        </FieldAuthoringProvider>;
        case "game": return <ValueDisplay value={{ $tag: "LiveGame", _0: { initial: 0, inputs: { entries: [] }, update: null, view: null } }} />;
      }
    }, host);
    flush();
  },
  blue(kind: "frames" | "movie") { replace(media(kind, true)); },
  dropFacets: () => replace(undefined),
  state: () => ({ selections, changes, hydrated }),
  dispose() { dispose?.(); dispose = undefined; document.getElementById("fixture")!.replaceChildren(); flush(); },
};

declare global { var solid2EffectsFixture: typeof api; }
globalThis.solid2EffectsFixture = api;
