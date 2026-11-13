// ---------------------------------------------------------------------------
// new-item-picker — the "+ New" first step, deliberately ENGINE-FREE.
//
// This modal is five static buttons: it asks WHICH KIND of thing you want to
// create and routes to the surface that creates it. It has no registry, no
// catalog, no type and no expression dependency, so it must not live inside
// `routes/app/home.tsx` — that module is the lazy `HomeWorkspace` entry, whose
// graph is the whole engine (parse cache, repository catalogs, every module).
//
// Keeping the picker here lets the lightweight Home shell open it on the FIRST
// click, while the workspace that answers the chosen branch keeps loading in
// the background. The chosen branch, not the question, is what needs the engine.
// Styles live in `routes/app.css` (`.picker-*`), already loaded by the shell.
// ---------------------------------------------------------------------------

import { ModalOverlay } from "./confirm-modal";
import { IconArrowDown, IconByName, IconCode, IconPlayerPlay, IconRoute, IconX, TYPE_ICON_FALLBACKS } from "~/lib/icons";

export type NewItemPickerProps = {
  onClose: () => void;
  onPickValue: () => void;
  onPickType: () => void;
  onPickFunction: () => void;
  onPickFunctionCall: () => void;
  onPickExpression: () => void;
};

export function NewItemPickerModal(props: NewItemPickerProps) {
  return (
    <ModalOverlay
      class="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        class="modal-box new-item-picker"
        style="max-width: 560px; padding: 1.25rem 1.5rem 1.5rem;"
      >
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.85rem;">
          <h2 style="font-size: 1rem; margin: 0;">What do you want to create?</h2>
          <button class="btn" type="button" onClick={props.onClose} style="padding: 0.15rem 0.5rem;" aria-label="Close">
            <IconX size={16} />
          </button>
        </div>

        <div class="picker-section-label">Definitions</div>
        <div class="picker-grid">
          <button
            type="button"
            class="picker-chip picker-chip--type"
            onClick={props.onPickType}
            data-tooltip="Define a Fenel type: a record, a variant or a refinement"
          >
            <span class="picker-chip__icon" aria-hidden="true"><IconByName name={TYPE_ICON_FALLBACKS.Type} size={22} /></span>
            <span class="picker-chip__title">Create a type</span>
            <span class="picker-chip__desc">
              A reusable shape: named fields, a choice of cases, or a rule on data.
            </span>
          </button>
          <button
            type="button"
            class="picker-chip picker-chip--function"
            onClick={props.onPickFunction}
            data-tooltip="Define a Fenel function: typed parameters, a return type and a body"
          >
            <span class="picker-chip__icon" aria-hidden="true"><IconRoute size={22} /></span>
            <span class="picker-chip__title">Create a function</span>
            <span class="picker-chip__desc">
              Typed inputs, a result type and a body.
            </span>
          </button>
        </div>

        {/* Down arrows aligned with each column centre to signal the
            type→value and function→function-call instantiation link. */}
        <div class="picker-arrows" aria-hidden="true">
          <span class="picker-arrows__item"><IconArrowDown size={16} /></span>
          <span class="picker-arrows__item"><IconArrowDown size={16} /></span>
        </div>

        <div class="picker-section-label" data-tooltip="Data of a type, or the result of a function">Data and results</div>
        <div class="picker-grid">
          <button
            type="button"
            class="picker-chip picker-chip--value"
            onClick={props.onPickValue}
            data-tooltip="A literal or an expression, added to the data you are in"
          >
            <span class="picker-chip__icon" aria-hidden="true"><IconByName name={TYPE_ICON_FALLBACKS.Data} size={22} /></span>
            <span class="picker-chip__title">Create data</span>
            <span class="picker-chip__desc">
              A number, some text, a record, or anything you compute.
            </span>
          </button>
          <button
            type="button"
            class="picker-chip picker-chip--call"
            onClick={props.onPickFunctionCall}
            data-tooltip="Run a function — pick one and supply its inputs"
          >
            <span class="picker-chip__icon" aria-hidden="true"><IconPlayerPlay size={22} /></span>
            <span class="picker-chip__title">Create a function call</span>
            <span class="picker-chip__desc">
              Pick a function, give it inputs, keep its result.
            </span>
          </button>
        </div>
        <button
          type="button"
          class="picker-chip picker-chip--expression"
          onClick={props.onPickExpression}
        >
          <span class="picker-chip__icon" aria-hidden="true"><IconCode size={22} /></span>
          <span class="picker-chip__title">Create an expression</span>
          <span class="picker-chip__desc">Start from any expression. Its type follows from what you build.</span>
        </button>
      </div>
    </ModalOverlay>
  );
}
