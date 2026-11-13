// A classification (fenel/modules/encyclopedia/life.fenel, foods.fenel) drawn
// by the nested-sets view: the Boxes body, and the marks the Tree and Graph
// cards share. Reading lives in nested-sets-classification.ts; nothing here
// decides a relation. Every node's mark is its item's ordinary glyph, the
// list circle's (list-preview-glyph.ts, then DataThumbnail and its
// GlyphPictureImage): a bare constructor's Picturable or Emojiable, keyed by
// its tag. A stated link to the other classification (a living thing gives
// foods, a food comes from a living thing) is drawn as the linked items' marks
// on the node, with their names on hover. In the Boxes drawing a mark asks for
// its picture when it comes near the screen (nested-sets-classification-near.ts).
// Solid/browser renderer allowance — the same kind as the other card surfaces.

import { For, Show, createMemo, createSignal, onSettled } from "solid-js";
import { ItemMark, useItemPresentation, type ItemPresentation } from "./item-glyph";
import { bareConstructorTag } from "./constructor-presentation";
import { VERDICT_TOOLTIP } from "./nested-sets-format";
import { classificationBoxes, crossAnswersToWrite, crossAnswerText, parentNotes, type ClassificationBox, type ClassificationCrossSet,
  type ClassificationLink, type ClassificationModel, type ClassificationNode } from "./nested-sets-classification";
import { createNearScreen, NearScreenContext, useNearScreen } from "./nested-sets-classification-near";
import "./nested-sets-classification.css";

// The item's glyph and mark are shared with record rows and cards (item-glyph.tsx).
export { ItemMark, useItemPresentation };

/** "Gives Tomato" / "Comes from Solanum lycopersicum", from the items' own labels. */
export function linkText(link: ClassificationLink, names: readonly (string | undefined)[]): string {
  const known = names.filter((name): name is string => !!name);
  const verb = link.relation === "gives" ? "Gives" : "Comes from";
  return known.length > 0 ? `${verb} ${known.join(", ")}` : link.relation === "gives" ? "Gives these foods" : "Comes from this living thing";
}

// The Boxes drawing's marks ask for their pictures nearest the screen first.
// Outside it (the Tree and Graph cards) a mark asks at once, as before
// (NearScreenContext, nested-sets-classification-near.ts).

/** An item's mark in its slot: its icon or emoji at once, its picture once near the screen. */
function NearMark(props: { value: unknown; presentation: ItemPresentation; class: string }) {
  const gate = useNearScreen();
  const [near, setNear] = createSignal(gate === undefined);
  let element: HTMLSpanElement | undefined;
  onSettled(() => gate && element ? gate.watch(element, () => setNear(true)) : undefined);
  return <span class={props.class} aria-hidden="true" ref={element}><ItemMark value={props.value} presentation={props.presentation} held={!near()} /></span>;
}

/** The linked items' marks, small, on their node. */
export function LinkMarks(props: { link: ClassificationLink | undefined; presentation?: ItemPresentation }) {
  const fallback = useItemPresentation();
  const presentation = () => props.presentation ?? fallback;
  return <Show when={props.link}>{(link) => <span class="nested-sets-link" data-link={link().relation}
    data-tooltip={linkText(link(), link().items.map((item) => presentation().name(item)))}>
    <For each={link().items}>{(item) => <NearMark class="nested-sets-link__mark" value={item} presentation={presentation()} />}</For>
  </span>}</Show>;
}

function LeafChip(props: { leaf: ClassificationNode; model: ClassificationModel; presentation: ItemPresentation }) {
  const notes = () => parentNotes(props.model, props.leaf);
  const scientific = () => props.leaf.scientificName !== props.leaf.name ? props.leaf.scientificName : undefined;
  return <li class="nested-sets__species nested-sets-classification__leaf" data-set-key={props.leaf.key}>
    <NearMark class="nested-sets-classification__mark" value={props.leaf.item} presentation={props.presentation} />
    <span class="nested-sets-classification__leaf-text">
      <span class="nested-sets__species-common">{props.leaf.name}</span>
      <Show when={scientific()}>{(text) => <span class="nested-sets__species-scientific">{text()}</span>}</Show>
      <For each={notes()}>{(note) => <span class="nested-sets-classification__note">{note}</span>}</For>
    </span>
    <LinkMarks link={props.leaf.link} presentation={props.presentation} />
  </li>;
}

function SetBox(props: { box: ClassificationBox; depth: number; model: ClassificationModel; presentation: ItemPresentation }) {
  const set = () => props.box.set;
  const scientific = () => set().scientificName !== set().name ? set().scientificName : undefined;
  return <section class="nested-sets-classification__set" data-depth={props.depth} data-set-key={set().key}
    aria-label={`${set().name}, ${set().countText}`}>
    <header class="nested-sets-classification__head">
      <NearMark class="nested-sets-classification__mark" value={set().item} presentation={props.presentation} />
      <span class="nested-sets__family-title">
        <span class="nested-sets__family-name">{set().name}</span>
        <Show when={scientific()}>{(text) => <span class="nested-sets__family-common"> · {text()}</span>}</Show>
      </span>
      <span class="nested-sets__count">{set().countText}</span>
      <LinkMarks link={set().link} presentation={props.presentation} />
    </header>
    <Show when={props.box.boxes.length > 0}>
      <div class="nested-sets-classification__inner">
        <For each={props.box.boxes}>{(inner) => <SetBox box={inner} depth={props.depth + 1} model={props.model} presentation={props.presentation} />}</For>
      </div>
    </Show>
    <Show when={props.box.leaves.length > 0}>
      <ul class="nested-sets__species-list">
        <For each={props.box.leaves}>{(leaf) => <LeafChip leaf={leaf} model={props.model} presentation={props.presentation} />}</For>
      </ul>
    </Show>
    <Show when={props.box.notes.length > 0}>
      <ul class="nested-sets__relations" aria-label="Decided relations">
        <For each={props.box.notes}>{(note) => <li class="nested-sets__relation">{note}</li>}</For>
      </ul>
    </Show>
  </section>;
}

// A set that cuts across is never drawn inside the classification: its members
// are chips, and its answers are written under them.
function CrossSetBox(props: { cross: ClassificationCrossSet; model: ClassificationModel; presentation: ItemPresentation }) {
  const members = () => props.cross.members.flatMap((member) => {
    const node = props.model.sets.find((row) => row.key === bareConstructorTag(member));
    return node ? [node] : [];
  });
  return <section class="nested-sets__lifeform" aria-label={`${props.cross.name}, ${props.cross.countText}`} data-named-set={props.cross.name}>
    <header class="nested-sets__genus-head">
      <span class="nested-sets__lifeform-title">{props.cross.name}</span>
      <span class="nested-sets__count">{props.cross.countText}</span>
    </header>
    <Show when={members().length > 0}>
      <ul class="nested-sets__species-list">
        <For each={members()}>{(leaf) => <LeafChip leaf={leaf} model={props.model} presentation={props.presentation} />}</For>
      </ul>
    </Show>
    <ul class="nested-sets__answers" aria-label="Decided relations">
      <For each={crossAnswersToWrite(props.model, props.cross)}>{(answer) => <li class={["nested-sets__answer", { "nested-sets__answer--undecided": answer.verdict === "undecided" }]}
        data-verdict={answer.verdict} data-tooltip={VERDICT_TOOLTIP[answer.verdict]}>{crossAnswerText(props.model, answer)}</li>}</For>
    </ul>
  </section>;
}

/** The Boxes drawing of a classification: each set a box inside the set that
 * holds it (decided `Just true`), the leaves as chips with their pictures,
 * then the sets that cut across. */
export function ClassificationBoxes(props: { model: ClassificationModel }) {
  const presentation = useItemPresentation();
  const boxes = createMemo(() => classificationBoxes(props.model));
  const gate = createNearScreen();
  onSettled(() => () => gate.close());
  return <NearScreenContext value={gate}>
    <div class="nested-sets-classification">
      <For each={boxes()}>{(box) => <SetBox box={box} depth={0} model={props.model} presentation={presentation} />}</For>
    </div>
    <Show when={props.model.crossSets.length > 0}>
      <section class="nested-sets__across" aria-label="Sets that cut across">
        <h3 class="nested-sets__section-title">Sets that cut across</h3>
        <div class="nested-sets__lifeforms">
          <For each={props.model.crossSets}>{(cross) => <CrossSetBox cross={cross} model={props.model} presentation={presentation} />}</For>
        </div>
      </section>
    </Show>
  </NearScreenContext>;
}
