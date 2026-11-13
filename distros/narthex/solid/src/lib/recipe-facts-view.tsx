// One row per derived fact. The fact list is produced by `recipeCard`.
// A list is drawn by the shared list row (circles and the item count).
// A list of preparations is one row of food circles per preparation.
// Any other value is drawn by the shared structural reader.
// This file does not print lists, findings, or counts itself.
// As a focused value the facts read as one ordinary data card (data-card.css,
// the solver card's shell): the number of facts is a quiet caption in the
// card's type-line style, each fact a row (its title at the top, then its
// value in small tiles, the list tile's frame); the evidence of each fact
// opens from a question-mark icon beside its label (Rom, Nov 11 and Nov 13).
// Solid/browser renderer allowance — same kind as the other card surfaces.

import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { AuthoringSession } from "./expression-runner/authoring-session";
import type { TemplateComponentProps } from "./layout-renderer/LayoutRenderer";
import { webRegistry } from "./web-template-registry";
import { DataThumbnail } from "./data-transfer/DataPreview";
import { DataValueSurface } from "./data-transfer/DataValueSurface";
import { listPreviewGlyph } from "./list-preview-glyph";
import type { PreviewGlyph } from "./thumbnail-glyph";
import { CollectionPreviewStrip, ValueCard, ValueCardCaption } from "./value-card";
import { useReaderRuntime } from "./reader-runtime";
import { IconByName } from "./icons";
import { alternativePreparations, findingGroups, ingredientCountText, recipeValueLead } from "./recipe-fact-text";
import "./data-card.css";
import "./list-tile.css";

function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isRecipeFact(value: unknown): boolean {
  return typeof own(value, "title") === "string" && own(value, "summary") !== undefined && own(value, "evidence") !== undefined;
}

/** A one-field summary is that field, so a list reaches the list row as a list.
 * A record with several fields stays whole. */
function summaryPayload(summary: unknown): unknown {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return summary;
  const keys = Object.keys(summary).filter((key) => key !== "$tag");
  if (keys.length !== 1) return summary;
  return own(summary, keys[0]!) ?? summary;
}

function constructorName(value: unknown): string | undefined {
  const tag = own(value, "$tag");
  return typeof tag === "string" ? tag : undefined;
}

function FoodStrip(props: {
  items: readonly unknown[];
  label: string;
  glyph: (value: unknown) => PreviewGlyph;
}) {
  // Rom (Nov 13): "3 items" beside three shown circles adds nothing; the
  // count stays only when the strip elides items.
  return <CollectionPreviewStrip items={props.items} label={props.label} countOnlyWhenElided
    itemLabel={(item) => constructorName(item) ?? props.label}
    render={(item) => {
      const mark = props.glyph(item);
      return <DataThumbnail value={item} picture={mark.picture} valueIcon={mark.icon} emoji={mark.emoji} />;
    }}
    preview={(item) => {
      const mark = props.glyph(item);
      const name = constructorName(item) ?? props.label;
      return <ValueCard presentation="inline" compactLayout="two-line" heading={
        <ValueCardCaption caption={name} picture={mark.picture} icon={mark.icon} emoji={mark.emoji} typeLabel={props.label} />
      }>
        <DataValueSurface value={item} label={name} hideCopy depth={0} />
      </ValueCard>;
    }} />;
}

/** One value in the list tile's frame (list-tile.css): a findings verdict is
 * the tile's corner caption. A strip tile is as wide as its circles. */
function RecipeTile(props: { caption?: string; items?: number; children: JSX.Element }) {
  return <div class={["recipe-facts__tile", {
    "recipe-facts__tile--captioned": !!props.caption, "recipe-facts__tile--strip": props.items !== undefined,
  }]} style={props.items !== undefined ? { "--recipe-tile-items": String(Math.max(1, props.items)) } : undefined}>
    <Show when={props.caption}>{(caption) => <span class="list-tile__corner">{caption()}</span>}</Show>
    {props.children}
  </div>;
}

function RecipeValue(props: {
  value: unknown;
  label: string;
  glyph: (value: unknown) => PreviewGlyph;
}) {
  const items = () => Array.isArray(props.value) ? props.value as readonly unknown[] : undefined;
  const preparations = () => {
    const list = items();
    // Substitutes: each alternative reads as its witness preparation.
    return list && list.length > 0 && list.every((item) => Array.isArray(item))
      ? list as readonly (readonly unknown[])[] : alternativePreparations(props.value);
  };
  // A findings row: each category under its verdict word, not one cube per finding.
  const findings = () => findingGroups(props.value);
  return <Show when={findings()} fallback={<Show when={preparations()} fallback={<Show when={items()} fallback={
    <Show when={ingredientCountText(props.value)} fallback={
      <RecipeTile><DataValueSurface value={props.value} label={props.label} hideCopy depth={0} /></RecipeTile>}>
      {(text) => <RecipeTile><span class="recipe-facts__count-text">{text()}</span></RecipeTile>}
    </Show>
  }>{(list) => <RecipeTile items={list().length}><FoodStrip items={list()} label={props.label} glyph={props.glyph} /></RecipeTile>}</Show>}>
    {(rows) => <For each={rows()}>{(preparation) =>
      <RecipeTile items={preparation.length}><FoodStrip items={preparation} label={props.label} glyph={props.glyph} /></RecipeTile>}</For>}
  </Show>}>
    {(groups) => <For each={groups()}>{(group) =>
      <RecipeTile caption={group.verdict} items={group.categories.length}>
        <FoodStrip items={group.categories} label={props.label} glyph={props.glyph} />
      </RecipeTile>}</For>}
  </Show>;
}

function RecipeFactRow(props: {
  value: unknown;
  glyph: (value: unknown) => PreviewGlyph;
}) {
  const title = String(own(props.value, "title"));
  const summary = () => summaryPayload(own(props.value, "summary"));
  const evidenceLabel = () => own(own(props.value, "evidence"), "$tag") === "DirectEvaluation" ? "Direct result" : "Checked evidence";
  // Rom (Nov 11): how a fact was established is a small icon beside its label,
  // opening that fact's evidence; not one control under the whole card.
  const [evidence, setEvidence] = createSignal(false);
  // Rom (Nov 13): the label sits at the top of its row, on its first tile's line.
  return <div class="recipe-facts__row" role="listitem" data-recipe-lead={recipeValueLead(summary())}>
    <span class="recipe-facts__title">{title}
      <button type="button" class="recipe-facts__evidence-icon" aria-expanded={evidence() ? "true" : "false"}
        aria-label={`How "${title}" was established`} data-tooltip={evidence() ? "Hide how this was established" : "How this was established"}
        onClick={event => { event.stopPropagation(); setEvidence(open => !open); }}>
        <IconByName name="help-circle" size={15} />
      </button>
    </span>
    <span class="recipe-facts__value">
      <RecipeValue value={summary()} label={title} glyph={props.glyph} />
      <Show when={evidence()}>
        <span class="recipe-facts__evidence">
          <span class="record-value__label">{evidenceLabel()}</span>
          <DataValueSurface value={own(props.value, "evidence")} label={evidenceLabel()} hideCopy depth={0} />
        </span>
      </Show>
    </span>
  </div>;
}

/** The fact rows of one recipe card. The caller decides when the list is ready. */
export function RecipeFactsList(props: { facts: readonly unknown[]; session?: () => AuthoringSession }) {
  const reader = useReaderRuntime();
  const glyph = (value: unknown) => {
    // B3: a Local reader reflects the fact in its worker (thumbnail packet glyph).
    if (reader?.kind === "local" && reader.valueState) {
      const read = reader.valueState(value, undefined, { thumbnail: true });
      return read.kind === "known" ? read.value.root.glyph : {};
    }
    // A registered view receives no session prop: the reader's own session
    // supplies the same glyph facts.
    const session = props.session?.() ?? reader?.session();
    return session ? listPreviewGlyph(session.evaluateContext, value) : {};
  };
  return <div class="recipe-facts__list" role="list">
    <For each={props.facts}>{(fact) => <Show when={isRecipeFact(fact)}>{(_shown) => <RecipeFactRow value={fact} glyph={glyph} />}</Show>}</For>
  </div>;
}

/** "11 facts": the card's quiet caption, in a data card's type-line style
 * (Rom, Nov 13: not a heading that outweighs the facts). */
export function recipeFactCount(facts: readonly unknown[]): string {
  const count = facts.filter(isRecipeFact).length;
  return `${count} ${count === 1 ? "fact" : "facts"}`;
}

// Source Viewable selects this body for RecipeCard data (a Local item holding
// a card, a returned card): the same rows as the pin card, nothing else.
webRegistry.registerComponent("recipe-card", (props: TemplateComponentProps) =>
  <Show when={Array.isArray(props.value) ? props.value as readonly unknown[] : undefined}>{(facts) =>
    <section class="data-card recipe-facts recipe-facts--card" data-recipe-facts="true" aria-label="Derived facts">
      <p class="recipe-facts__caption">{recipeFactCount(facts())}</p>
      <RecipeFactsList facts={facts()} />
    </section>}
  </Show>);
