// ---------------------------------------------------------------------------
// type-draft-card — a new type as a small card, beside the card you clicked.
//
// "New beside -> Type" in a list used to open the full "New type" modal (an
// editor-lens switch, a generator surface, every representation). Rom asked
// for the other end of the spectrum: a minimal card placed like any other
// card, with the type's name, its fields ("name: String", "email: Email") and
// Create; the one constructor a record type has stays implicit. Saving adds
// the type to the list beside the clicked card, where it reads as a normal
// card.
//
// This is UX sugar over the universal editors, not a second type editor: the
// fields are TypeBuilder's simple record lens, the draft and its save are
// lib/type-draft-save.ts (shared with the modal), and the expand icon opens the
// full modal on the same draft. The icon slot is the host's icon picker. It
// opens with one field whose name box is empty; Create leaves out a field
// nobody named (lib/type-draft-fields.ts).
// ---------------------------------------------------------------------------

import { Show, createMemo, createSignal, flush, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { FieldDef } from "@fenel/engine/types";
import { FieldAuthoringProvider, createNewNamedFieldOccurrence, persistedRootFieldOwner } from "./field-occurrence";
import { fieldLabelFacetText } from "./field-occurrence/model";
import { MembershipHintsView } from "./field-renderer/refinement-hints";
import { typeCardSubmission } from "./type-draft-fields";
import { TypeBuilder } from "./type-builder";
import type { TypeDraft } from "./type-draft-save";
import "./type-draft-card.css";

/** Keep a fixed card of this size inside the viewport. */
export function clampCardPosition(at: { x: number; y: number }, size: { width: number; height: number },
  viewport: { width: number; height: number }, margin = 8): { x: number; y: number } {
  const x = Math.max(margin, Math.min(at.x, viewport.width - size.width - margin));
  const y = Math.max(margin, Math.min(at.y, viewport.height - size.height - margin));
  return { x, y };
}

export function TypeDraftCard(props: {
  draft: TypeDraft;
  /** Viewport position of the click that opened it. */
  x: number;
  y: number;
  /** The host's icon picker for the draft's Iconable. */
  icon?: JSX.Element;
  /** Write the name the user typed into the draft's Codeable (the host's
   *  representation-draft writer, shared with the modal's Name row). */
  onNameInput: (text: string) => void;
  /** The full editor on the same draft. */
  onMore: () => void;
  onClose: () => void;
  onCreated: () => void;
}) {
  const draft = props.draft;
  let card!: HTMLDivElement;
  let nameInput!: HTMLInputElement;
  const [at, setAt] = createSignal({ x: props.x, y: props.y });
  const place = () => {
    if (!card) return;
    const box = card.getBoundingClientRect();
    setAt(clampCardPosition({ x: props.x, y: props.y }, { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight }));
  };
  // The fields this card added, with the code names they were minted with.
  const [minted, setMinted] = createSignal<ReadonlyMap<string, string>>(new Map());
  const remember = (field: FieldDef) => {
    const id = field.key?.$tag === "NamedField" ? field.key.ref.$ref : undefined;
    if (id) setMinted(current => new Map(current).set(id, field.name));
  };
  const submission = createMemo(() => typeCardSubmission(draft.typeShape(), minted(),
    (id) => fieldLabelFacetText(draft.fieldFacets()[id], id)));
  const ready = () => !!draft.codeName().trim() && submission().unnamed.length === 0;
  // Nothing typed yet: a click elsewhere just dismisses the card. Once the
  // draft has content, only Cancel or Escape discards it.
  const pristine = () => !draft.codeName().trim() && fieldCount(submission().shape) === 0
    && submission().unnamed.length === 0 && !draft.icon();

  onSettled(() => {
    if (fieldCount(draft.typeShape()) === 0) {
      const field = createNewNamedFieldOccurrence("field1");
      remember(field);
      draft.changeTypeShape({ $record: { fields: [field] } });
    }
    nameInput?.focus();
    place();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    observer?.observe(card);
    const outside = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-home-navigation]")) return;
      // Pickers and menus the card opens may render outside it (a portal).
      if (event.target instanceof Element && event.target.closest(".modal-overlay, .locus-context-menu, .tb-type-popover, [role='listbox']")) return;
      if (event.target instanceof Node && !card.contains(event.target) && pristine()) props.onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => { observer?.disconnect(); document.removeEventListener("pointerdown", outside, true); };
  });

  async function create() {
    if (!draft.codeName().trim()) { draft.setSaveError("Give the type a name."); nameInput?.focus(); return; }
    const { shape, unnamed } = submission();
    if (unnamed.length) {
      // A field with a chosen type needs a name: its name box says so.
      const boxes = unnamed.flatMap(id => [...card.querySelectorAll<HTMLInputElement>(
        `[data-field-id="${CSS.escape(id)}"] > .field-occurrence__head [data-field-label-input]`)]);
      for (const box of boxes) box.setAttribute("aria-invalid", "true");
      boxes[0]?.focus();
      return;
    }
    if (shape !== draft.typeShape()) { draft.changeTypeShape(shape); flush(); }
    if (await draft.save()) props.onCreated();
  }

  return (
    <div
      ref={card}
      class="type-draft-card"
      style={`left: ${Math.round(at().x)}px; top: ${Math.round(at().y)}px`}
      role="dialog"
      aria-label="New type"
      onInput={(event) => { if (event.target instanceof HTMLElement) event.target.removeAttribute("aria-invalid"); }}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === "Escape") { event.preventDefault(); props.onClose(); }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void create(); }
        if (event.key === "Enter" && event.target === nameInput) { event.preventDefault(); void create(); }
      }}
    >
      <fieldset class="type-draft-card__body" disabled={draft.saving()} inert={draft.saving()}>
        <div class="type-draft-card__head">
          <Show when={props.icon}>{props.icon}</Show>
          <input
            ref={nameInput}
            class={{ "type-draft-card__name": true, mono: !draft.labelName() && !!draft.codeName() }}
            type="text"
            value={draft.labelName() || draft.codeName()}
            placeholder="Person"
            aria-label="Type name"
            spellcheck={false}
            onInput={(event) => props.onNameInput(event.currentTarget.value)}
          />
          <button type="button" class="type-draft-card__icon-btn" onClick={props.onMore}
            data-tooltip="Open the full type editor on this draft">⤢</button>
          <button type="button" class="type-draft-card__icon-btn" onClick={props.onClose} aria-label="Cancel">×</button>
        </div>
        <FieldAuthoringProvider
          facetsByFieldId={draft.fieldFacets()}
          onFieldFacetsChange={draft.changeFieldFacet}
          onFieldFacetsHydrate={draft.hydrateFieldFacet}
          onFieldFacetsForget={draft.forgetFieldFacet}
          ownerKey={`type:${draft.typeId}`}
          owner={persistedRootFieldOwner("type", draft.typeId)}
          resurrectFieldIds={draft.fieldResurrections.fieldIds()}
          onFieldResurrectionChange={draft.fieldResurrections.onChange}
          onFieldCreated={remember}
          isMintedField={(id) => minted().has(id)}
        >
          <div class="type-draft-card__fields">
            <TypeBuilder presentation="simple" lensSwitch={false} lockKind="record" value={draft.typeShape()} genericScheme={draft.typeScheme()}
              beforeChange={draft.guardTypeShape} onChange={draft.changeTypeShape} />
          </div>
        </FieldAuthoringProvider>
      </fieldset>
      <Show when={draft.saveError()}>
        <div class="type-draft-card__error" role="alert">{draft.saveError()}</div>
      </Show>
      {/* The data form's Create button (New Person): its status dot is ready
          once the type has a name and every field it keeps has one. */}
      <div class="type-draft-card__actions">
        <span class="home-composer-modal__create-status">
          <button type="button" class="btn home-action-button home-composer-modal__create" disabled={draft.saving()}
            data-validation-state={ready() ? "HintPass" : "HintNotYet"} onClick={() => void create()}>
            <MembershipHintsView hints={{ state: { $tag: ready() ? "HintPass" : "HintNotYet" }, rules: [] }} compact embedded />
            {draft.checking() ? "Checking…" : draft.saving() ? "Creating…" : "Create"}
          </button>
        </span>
      </div>
    </div>
  );
}

function fieldCount(shape: unknown): number {
  const fields = shape && typeof shape === "object" ? (shape as { $record?: { fields?: unknown } }).$record?.fields : undefined;
  return Array.isArray(fields) ? fields.length : 0;
}
