// The Encyclopedia's species sets drawn as nested sets
// (fenel/modules/encyclopedia/plants.fenel). `Viewable PlantSpeciesSetsInCollection`
// and `Viewable PlantFamilySpeciesSets` select this registered read component,
// as `Viewable RecipeCard` selects recipe-card. A family set is the outer box,
// each genus set a box inside it, each species a chip inside its genus; the
// relations the data decides (pairwise disjoint, ∪ = the family) sit under the
// family box; the family boxes form a responsive grid. Below them, the sets by
// life form and the sets by name (made by people, such as the fennels) cut
// across the families, and a table gives each family ∩ life form. Every verdict comes from Fenel's set judgment; reading lives in
// nested-sets-format.ts and nothing here decides a relation. An undecided
// selection or any unrecognised shape keeps the shared structural reader, so
// the value never renders blank.
// Solid/browser renderer allowance — the same kind as the other card surfaces.

import { For, Show, createMemo, createSignal } from "solid-js";
import type { TemplateComponentProps } from "./layout-renderer/LayoutRenderer";
import { webRegistry } from "./web-template-registry";
import { StructuralReadValue } from "./data-transfer/DataPreview";
import { DataValueSurface } from "./data-transfer/DataValueSurface";
import {
  crossingCellText,
  familyTitle,
  namedAnswerNeedsWords,
  namedAnswerText,
  nestedSetsInlineText,
  readNestedSets,
  relationNeedsWords,
  relationText,
  relationTooltip,
  verdictNeedsWords,
  verdictText,
  VERDICT_TOOLTIP,
  type CrossingCell,
  type CrossingTable,
  type FamilySet,
  type GenusSet,
  type LifeFormSet,
  type NamedSet,
  type NestedSetsModel,
  type SetRelation,
  type SpeciesChip,
} from "./nested-sets-format";
import { nestedSetsGraph, nestedSetsRepresentation, nextDrawing, type NestedSetsRepresentation } from "./nested-sets-graph";
import { NestedSetsGraph } from "./nested-sets-graph-view";
import { classificationGraph, classificationInlineText, readClassification } from "./nested-sets-classification";
import { ClassificationBoxes } from "./nested-sets-classification-view";
import { IconByName } from "./icons";
import "./nested-sets-view.css";

function SpeciesChipView(props: { species: SpeciesChip }) {
  return <li class="nested-sets__species">
    <Show when={props.species.common}>{(common) => <span class="nested-sets__species-common">{common()}</span>}</Show>
    <span class="nested-sets__species-scientific">{props.species.scientific}</span>
  </li>;
}

function VerdictChip(props: { genus: GenusSet; whole: string }) {
  // A box inside its family already reads "within": only another answer is written.
  return <Show when={verdictNeedsWords(props.genus.verdict) && props.genus.verdict}>{(verdict) =>
    <span class={["nested-sets__verdict", `nested-sets__verdict--${verdict()}`]}
      data-verdict={verdict()} data-tooltip={VERDICT_TOOLTIP[verdict()]}>
      <Show when={verdict() === "true"}><span class="nested-sets__check" aria-hidden="true">✓</span></Show>
      {verdictText(verdict(), props.whole)}
    </span>}
  </Show>;
}

function GenusBox(props: { genus: GenusSet; whole: string }) {
  return <section class="nested-sets__genus" aria-label={`${props.genus.name}, ${props.genus.countText}`}>
    <header class="nested-sets__genus-head">
      <span class="nested-sets__genus-name">{props.genus.name}</span>
      <span class="nested-sets__count">{props.genus.countText}</span>
      <VerdictChip genus={props.genus} whole={props.whole} />
    </header>
    <Show when={props.genus.species.length > 0}>
      <ul class="nested-sets__species-list">
        <For each={props.genus.species}>{(species) => <SpeciesChipView species={species} />}</For>
      </ul>
    </Show>
  </section>;
}

function RelationRow(props: { relation: SetRelation }) {
  const undecided = () => props.relation.kind === "overlap-undecided";
  return <li class={["nested-sets__relation", { "nested-sets__relation--undecided": undecided() }]} data-relation={props.relation.kind}
    data-tooltip={relationTooltip(props.relation)}>
    {relationText(props.relation)}
  </li>;
}

function FamilyBox(props: { family: FamilySet }) {
  return <div class="nested-sets__family-block">
    <section class="nested-sets__family" aria-label={`${familyTitle(props.family)}, ${props.family.countText}`}>
      <header class="nested-sets__family-head">
        <span class="nested-sets__family-title">
          <span class="nested-sets__family-name">{props.family.name}</span>
          <Show when={props.family.commonName}>{(common) => <span class="nested-sets__family-common"> · {common()}</span>}</Show>
        </span>
        <span class="nested-sets__count">{props.family.countText}</span>
      </header>
      <Show when={props.family.genera.length > 0}>
        <div class="nested-sets__genera">
          <For each={props.family.genera}>{(genus) => <GenusBox genus={genus} whole={props.family.name} />}</For>
        </div>
      </Show>
    </section>
    <Show when={props.family.relations.some(relationNeedsWords)}>
      <ul class="nested-sets__relations" aria-label="Decided relations">
        <For each={props.family.relations.filter(relationNeedsWords)}>{(relation) => <RelationRow relation={relation} />}</For>
      </ul>
    </Show>
  </div>;
}

function LifeFormBox(props: { set: LifeFormSet }) {
  return <section class="nested-sets__lifeform" aria-label={`${props.set.title}, ${props.set.countText}`} data-life-form={props.set.key}>
    <header class="nested-sets__genus-head">
      <span class="nested-sets__lifeform-title">{props.set.title}</span>
      <span class="nested-sets__count">{props.set.countText}</span>
    </header>
    <Show when={props.set.species.length > 0}>
      <ul class="nested-sets__species-list">
        <For each={props.set.species}>{(species) => <SpeciesChipView species={species} />}</For>
      </ul>
    </Show>
  </section>;
}

// A set made by people sits beside the life forms. It is not drawn inside a
// family, so its relations to the family and genus sets it meets are written
// as plain lines under its species.
function NamedSetBox(props: { set: NamedSet }) {
  const answers = () => props.set.answers.filter((answer) => namedAnswerNeedsWords(answer, props.set.answers));
  return <section class="nested-sets__lifeform" aria-label={`${props.set.name}, ${props.set.countText}`} data-named-set={props.set.name}>
    <header class="nested-sets__genus-head">
      <span class="nested-sets__lifeform-title">{props.set.name}</span>
      <span class="nested-sets__count">{props.set.countText}</span>
    </header>
    <Show when={props.set.species.length > 0}>
      <ul class="nested-sets__species-list">
        <For each={props.set.species}>{(species) => <SpeciesChipView species={species} />}</For>
      </ul>
    </Show>
    <Show when={answers().length > 0}>
      <ul class="nested-sets__answers" aria-label="Decided relations">
        <For each={answers()}>{(answer) => <li class={["nested-sets__answer", { "nested-sets__answer--undecided": answer.verdict === "undecided" }]}
          data-verdict={answer.verdict} data-tooltip={VERDICT_TOOLTIP[answer.verdict]}>{namedAnswerText(answer)}</li>}</For>
      </ul>
    </Show>
  </section>;
}

function cellTooltip(cell: CrossingCell | undefined): string | undefined {
  if (!cell) return undefined;
  switch (cell.kind) {
    case "shared": return cell.species.map((row) => row.scientific).join(", ");
    case "empty": return "Disjoint: decided by Fenel's set judgment";
    case "not-empty": return "Fenel's set judgment decided that these sets meet";
    case "undecided": return "Fenel's set judgment did not decide this intersection";
  }
}

function CrossingCellView(props: { cell: CrossingCell | undefined }) {
  return <td class={["nested-sets__cell", { "nested-sets__cell--quiet": props.cell !== undefined && props.cell.kind !== "shared" }]}
    data-cell={props.cell?.kind} data-tooltip={cellTooltip(props.cell)}>
    <Show when={props.cell}>{(cell) => crossingCellText(cell())}</Show>
  </td>;
}

function CrossingTableView(props: { table: CrossingTable }) {
  return <div class="nested-sets__table-scroll">
    <table class="nested-sets__crossings">
      <caption>Each cell is the intersection of two sets, computed by the set judgment.</caption>
      <thead>
        <tr>
          <th scope="col"><span class="nested-sets__visually-hidden">Family</span></th>
          <For each={props.table.columns}>{(column) => <th scope="col">{column.title}</th>}</For>
        </tr>
      </thead>
      <tbody>
        <For each={props.table.rows}>{(row) => <tr>
          <th scope="row">{row.name}</th>
          <For each={row.cells}>{(cell) => <CrossingCellView cell={cell} />}</For>
        </tr>}</For>
      </tbody>
    </table>
  </div>;
}

function AcrossFamilies(props: { lifeForms: readonly LifeFormSet[] | "undecided" | undefined; crossings: CrossingTable | "undecided" | undefined;
  namedSets: readonly NamedSet[] | "undecided" | undefined }) {
  const sets = () => Array.isArray(props.lifeForms) ? props.lifeForms as readonly LifeFormSet[] : [];
  const named = () => Array.isArray(props.namedSets) ? props.namedSets as readonly NamedSet[] : [];
  const table = () => typeof props.crossings === "object" ? props.crossings : undefined;
  return <section class="nested-sets__across" aria-label="Sets that cut across families">
    <h3 class="nested-sets__section-title">Sets that cut across families</h3>
    <Show when={props.lifeForms === "undecided" || props.namedSets === "undecided"}>
      <p class="nested-sets__undecided">Not decided</p>
    </Show>
    <Show when={sets().length + named().length > 0}>
      <div class="nested-sets__lifeforms">
        <For each={sets()}>{(set) => <LifeFormBox set={set} />}</For>
        <For each={named()}>{(set) => <NamedSetBox set={set} />}</For>
      </div>
    </Show>
    <Show when={props.crossings !== undefined}>
      <Show when={table()} fallback={<p class="nested-sets__undecided">Not decided</p>}>
        {(shown) => <Show when={shown().rows.length > 0}><CrossingTableView table={shown()} /></Show>}
      </Show>
    </Show>
  </section>;
}

function NestedSetsBody(props: { model: NestedSetsModel; value: unknown }) {
  const families = () => props.model.kind === "family" ? [props.model.family]
    : props.model.families;
  const lifeForms = () => props.model.kind === "collection" ? props.model.lifeForms : undefined;
  const crossings = () => props.model.kind === "collection" ? props.model.crossings : undefined;
  const namedSets = () => props.model.kind === "collection" ? props.model.namedSets : undefined;
  return <>
    <Show when={families()} fallback={<>
      <p class="nested-sets__undecided">Not decided</p>
      <DataValueSurface value={props.value} label="Species sets" hideCopy depth={0} />
    </>}>
      {(shown) => <div class="nested-sets__families">
        <For each={shown()}>{(family) => <FamilyBox family={family} />}</For>
      </div>}
    </Show>
    <Show when={lifeForms() !== undefined || crossings() !== undefined || namedSets() !== undefined}>
      <AcrossFamilies lifeForms={lifeForms()} crossings={crossings()} namedSets={namedSets()} />
    </Show>
  </>;
}

/** Three drawings of one value: the nested boxes, the same sets as a tree
 * (top to bottom) and as a graph (left to right), both drawn like the
 * Dependencies panel. The lens's Representation control lists layouts of a
 * container (List, Table, Grid…) and a type's Viewable names one view, so the
 * choice lives here, as the list's Row/Stack switch does it: one button that
 * names (and shows on hover) the drawing a click will show, cycling Boxes,
 * Tree, Graph. "Fit" is the same kind of button, beside it. */
const NEXT_DRAWING_BUTTON: Record<NestedSetsRepresentation, { label: string; icon: string; tooltip: string }> = {
  boxes: { label: "Tree", icon: "binary-tree", tooltip: "Show these sets as a tree: the broadest sets at the top, the species under them" },
  tree: { label: "Graph", icon: "share-2", tooltip: "Show these sets as a graph read from left to right" },
  graph: { label: "Boxes", icon: "layout-grid", tooltip: "Show these sets as boxes inside boxes" },
};

function RepresentationSwitch(props: { shown: NestedSetsRepresentation; fit: boolean;
  onChange: (next: NestedSetsRepresentation) => void; onFit: (fit: boolean) => void }) {
  const next = () => NEXT_DRAWING_BUTTON[props.shown];
  return <div class="nested-sets__representation">
    <Show when={props.shown !== "boxes"}>
      <button type="button" class="btn home-action-button nested-sets__representation-button" data-nested-sets-fit={props.fit ? "true" : "false"}
        data-tooltip={props.fit ? "Show the drawing at its natural size (it scrolls)" : "Shrink the drawing to fit the card's width"}
        onClick={() => props.onFit(!props.fit)}>
        <Show when={props.fit} fallback={<IconByName name="minimize" size={16} />}><IconByName name="maximize" size={16} /></Show>
        {props.fit ? "Actual size" : "Fit"}
      </button>
    </Show>
    <button type="button" class="btn home-action-button nested-sets__representation-button" data-nested-sets-representation={props.shown}
      data-tooltip={next().tooltip} onClick={() => props.onChange(nextDrawing(props.shown))}>
      <IconByName name={next().icon} size={16} />
      {next().label}
    </button>
  </div>;
}

// One preference for this kind of view, for the session: it survives the view
// being redrawn (another lens, a refreshed value). Not stored.
const [preferredDrawing, setPreferredDrawing] = createSignal<NestedSetsRepresentation>("boxes");
const [preferredFit, setPreferredFit] = createSignal(false);

export function NestedSetsRead(props: { value: unknown; compact?: boolean }) {
  const model = createMemo(() => readNestedSets(props.value));
  // A classification of any depth (the tree of life, the foods), when the value is not the species sets.
  const classification = createMemo(() => model() ? undefined : readClassification(props.value));
  const graph = createMemo(() => {
    const read = model();
    if (read) return nestedSetsGraph(read);
    const tree = classification();
    return tree ? classificationGraph(tree) : undefined;
  });
  const shown = () => nestedSetsRepresentation(preferredDrawing(), !!graph());
  const kind = () => model()?.kind ?? classification()?.kind;
  return <Show when={props.compact} fallback={
    <section class="nested-sets" data-nested-sets={kind() ?? "unrecognised"} data-representation={shown()} aria-label="Nested sets">
      <Show when={graph()}><RepresentationSwitch shown={shown()} fit={preferredFit()}
        onChange={(next) => setPreferredDrawing(next)} onFit={(fit) => setPreferredFit(fit)} /></Show>
      <Show when={kind()} fallback={<DataValueSurface value={props.value} label="Species sets" hideCopy depth={0} />}>
        {(_kind) => <Show when={shown() !== "boxes" && graph()} fallback={
          <Show when={model()} fallback={<Show when={classification()}>{(tree) => <>
            <ClassificationBoxes model={tree()} />
          </>}</Show>}>{(read) => <NestedSetsBody model={read()} value={props.value} />}</Show>}>
          {(drawn) => <>
            <NestedSetsGraph graph={drawn()} orientation={shown() === "tree" ? "tree" : "graph"} fit={preferredFit()} />
          </>}
        </Show>}
      </Show>
    </section>
  }>
    <Show when={model()} fallback={<Show when={classification()} fallback={<StructuralReadValue value={props.value} depth={1} />}>
      {(tree) => <span class="nested-sets-inline" data-nested-sets="classification">{classificationInlineText(tree())}</span>}
    </Show>}>
      {(shown) => <span class="nested-sets-inline" data-nested-sets={shown().kind}>{nestedSetsInlineText(shown())}</span>}
    </Show>
  </Show>;
}

// Source Viewable selects this body for the species sets (the public "Species
// sets" item, the Encyclopedia's living things): full sets in a card, one line
// inside a record row.
webRegistry.registerComponent("nested-sets", (props: TemplateComponentProps) =>
  <NestedSetsRead value={props.value} compact={props.context?._compact === true} />);
