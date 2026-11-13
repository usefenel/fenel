import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { CornerMenu, createCornerMenu } from "../corner-menu";
import { IconByName, IconEllipsis } from "../icons";
import type { LocusMenuItem } from "../locus-context-menu";
import { ValueTypeCaption } from "../value-card";
import "./structural-surfaces.css";
import "./type-contract.css";

/** A requirement that comes from outside the occurrence: the place that
 * consumes its result, named in plain words ("Reverse › Items"). */
export type TypeContractRequirement = { label: string; source?: string };

/** Where a signature slot's type comes from: written in the source, or
 * inferred from the function's body. */
export type TypeContractOrigin = "declared" | "inferred";

/** One slot of a function's signature: a named parameter, or its result. */
export type TypeContractSlot = {
  /** The parameter's name as the reader shows it; the result has none. */
  name?: JSX.Element;
  /** The settled type's label. Undefined when the engine did not settle a
   * type: then nothing is shown (never "Anything"). */
  type?: string;
  /** The type's icon (the reader's type presentation). */
  icon?: string;
  /** Unknown origin reads as the admitted type, plainly. */
  origin?: TypeContractOrigin;
};

/** A function's signature: its parameters, then what it gives back. */
export type TypeContractSignature = { params: readonly TypeContractSlot[]; returns?: TypeContractSlot };

/** A type in the cards' type face (its icon and label, as a card's header
 * shows it), followed by a quiet "inferred" when it was inferred. */
export function TypeContractType(props: { type?: string; icon?: string; origin?: TypeContractOrigin }) {
  return <Show when={props.type}>{type => <span class="type-contract__type-face">
    <span class="home-item__type-tag type-contract__type-tag"><ValueTypeCaption label={type()} icon={props.icon} /></span>
    <Show when={props.origin === "inferred"}>
      <span class="type-contract__inferred" data-tooltip="Inferred from the body: not written in the source">inferred</span>
    </Show>
  </span>}</Show>;
}

/** The signature as two record rows: "Parameters", then "Returns". Each slot
 * is ONE badge, the graph's own input chip (`.expr-function-input`): the
 * parameter's name, then its type in the cards' type face; Returns holds the
 * type alone. A parameter without a settled type keeps its name; a result
 * without one has no row. */
function TypeContractSignatureRows(props: { signature: TypeContractSignature; class?: string }) {
  return <div class={["type-contract", "type-contract--signature", props.class]} role="group" aria-label="Signature">
    <div class="type-contract__slots" role="list">
      <Show when={props.signature.params.length > 0}>
        <div class="type-contract__slot type-contract__slot--parameter" role="listitem">
          <span class="type-contract__slot-label">Parameters</span>
          <span class="type-contract__slot-badges">
            <For each={props.signature.params}>{slot =>
              <span class="type-contract__badge expr-function-input">
                <Show when={slot.name !== undefined}><span class="expr-form__name">{slot.name}</span></Show>
                <TypeContractType type={slot.type} icon={slot.icon} origin={slot.origin} />
              </span>}</For>
          </span>
        </div>
      </Show>
      <Show when={props.signature.returns?.type ? props.signature.returns : undefined}>{returns =>
        <div class="type-contract__slot type-contract__slot--returns" role="listitem">
          <span class="type-contract__slot-label">Returns</span>
          <span class="type-contract__slot-badges">
            <span class="type-contract__badge expr-function-input">
              <TypeContractType type={returns().type} icon={returns().icon} origin={returns().origin} />
            </span>
          </span>
        </div>}</Show>
    </div>
  </div>;
}

/** One shared display of an occurrence's type contract
 * (design/expression-authoring-and-reuse.md, "One typed authoring model"):
 * the inferred type is an observation; a declared type is the occurrence's
 * own constraint, persisted by its existing owner (an expression annotation,
 * a binding's type, a function's result, a data item's type); a required type
 * is a constraint with a source outside the occurrence. Every label and every
 * verdict arrives from the caller's existing inference and compatibility
 * judgment: this component compares nothing. */
export function TypeContract(props: {
  /** The inferred type's label, when inference produced one. */
  inferred?: string;
  /** Declared constraint label. */
  declared?: string;
  /** Why the declared type is not editable here; shown as its tooltip. */
  declaredReadonly?: string;
  required?: TypeContractRequirement;
  /** What a function chosen here receives (an insertion's input). */
  receives?: string;
  /** A neutral status when nothing is inferred yet (e.g. an incomplete body). */
  note?: string;
  /** The caller's existing mismatch or invalid-expression message. */
  mismatch?: string;
  /** Use the inferred type as the declared type (lock it in). */
  onUseInferred?: () => void;
  onRemoveDeclared?: () => void;
  /** The existing TypeBuilder configured by the declared type's owner. */
  editor?: () => JSX.Element;
  /** Further actions of this occurrence's type (e.g. explore the type). */
  menuItems?: readonly LocusMenuItem[];
  /** The declared type's icon and catalogue description, when its owner
   * knows them (e.g. a data item's chosen type). */
  declaredIcon?: string;
  declaredDescription?: string;
  /** The owner's own type chooser (e.g. the New data dialog's type step).
   * When supplied, choosing or changing the declared type opens it instead
   * of the inline TypeBuilder, and the action stays visible in the row. */
  onChooseDeclared?: () => void;
  class?: string;
  /** A function's whole signature: one row per parameter, then Returns,
   * each slot with its own origin. The one place a signature is stated. */
  signature?: TypeContractSignature;
}) {
  const [editing, setEditing] = createSignal(false);
  const menu = createCornerMenu();
  const chooser = () => props.declaredReadonly ? undefined : props.onChooseDeclared;
  const editable = () => !chooser() && !!props.editor && !props.declaredReadonly;
  const chooseLabel = () => props.declared !== undefined ? "Change type" : "Choose a type";
  const items = (): LocusMenuItem[] => [
    ...(props.onUseInferred && props.inferred ? [{ id: "use-inferred", label: props.declared ? "Declare the inferred type" : "Declare this type",
      icon: "lock", tooltip: "Keep the inferred type as this expression's declared type", onSelect: () => props.onUseInferred?.() }] : []),
    ...(editable() ? [{ id: "choose-declared", label: props.declared ? "Change declared type…" : "Choose a declared type…", icon: "pencil",
      onSelect: () => setEditing(true) }] : []),
    ...(chooser() ? [{ id: "choose-declared", label: `${chooseLabel()}…`, icon: "pencil", onSelect: () => chooser()?.() }] : []),
    ...(props.onRemoveDeclared && props.declared && !props.declaredReadonly ? [{ id: "remove-declared", label: "Remove declared type",
      icon: "trash", tooltip: "Let the type be inferred again", onSelect: () => { setEditing(false); props.onRemoveDeclared?.(); } }] : []),
    ...(props.menuItems ?? []),
  ];
  const visible = () => props.inferred !== undefined || props.declared !== undefined || props.required !== undefined
    || props.receives !== undefined || props.note !== undefined || props.mismatch !== undefined || items().length > 0;
  return <Show when={props.signature} fallback={single()}>{signature =>
    <TypeContractSignatureRows signature={signature()} class={props.class} />}</Show>;
  function single() { return <Show when={visible()}>
    <div class={["type-contract", props.class, { "type-contract--mismatch": !!props.mismatch }]} role="group" aria-label="Type"
      data-corner-menu-owner={items().length > 0 ? "true" : undefined} onContextMenu={event => { if (items().length > 0) menu.open(event); }}>
      <div class="type-contract__row">
        <Show when={props.receives !== undefined}>
          <span class="type-contract__part" data-tooltip="The data the chosen function receives">
            <span class="type-contract__key">Receives</span><code class="type-contract__type">{props.receives}</code>
          </span>
        </Show>
        <Show when={props.inferred !== undefined}>
          <span class="type-contract__part type-contract__part--inferred" data-tooltip="Inferred from the expression">
            <span class="type-contract__key">Inferred</span><code class="type-contract__type">{props.inferred}</code>
            <Show when={props.onUseInferred && props.declared === undefined}>
              <button type="button" class="type-contract__lock" aria-label={`Declare ${props.inferred} as the type`}
                data-tooltip="Keep the inferred type as this expression's declared type"
                onClick={() => props.onUseInferred?.()}>↩</button>
            </Show>
          </span>
        </Show>
        <Show when={props.note}>{note => <span class="type-contract__note">{note()}</span>}</Show>
        <Show when={props.declared !== undefined}>
          <span class="type-contract__part type-contract__part--declared"
            data-tooltip={props.declaredReadonly ?? "The type this expression must have"}>
            <span class="type-contract__key">Declared</span>
            <Show when={props.declaredIcon}>{icon => <span class="type-contract__icon" aria-hidden="true"><IconByName name={icon()} size={14} /></span>}</Show>
            <Show when={editable() || chooser()} fallback={<code class="type-contract__type">{props.declared}</code>}>
              <button type="button" class="type-contract__type type-contract__type--editable" aria-expanded={editing() ? "true" : "false"}
                aria-label={`Edit declared type ${props.declared}`}
                onClick={() => { const choose = chooser(); if (choose) choose(); else setEditing(!editing()); }}>{props.declared}</button>
            </Show>
          </span>
        </Show>
        <Show when={props.required}>{required => <span class="type-contract__part type-contract__part--required"
          data-tooltip="A requirement of the place that uses this result">
          <span class="type-contract__key">{required().source ? `Required by ${required().source}` : "Required"}</span>
          <code class="type-contract__type">{required().label}</code>
        </span>}</Show>
        <Show when={items().length > 0}>
          <span class="type-contract__menu">
            <Show when={!!chooser()}><button type="button" class="type-contract__choose" onClick={() => chooser()?.()}>{chooseLabel()}</button></Show>
            <button type="button" class="type-contract__actions" ref={menu.attach} data-corner-menu-trigger="true"
              aria-label="Type actions" aria-haspopup="menu" aria-expanded={menu.isOpen() ? "true" : "false"} data-tooltip="Type actions"
              onClick={event => { event.stopPropagation(); menu.open(event); }}><IconEllipsis size={14} /></button>
            <CornerMenu menu={menu} items={items()} label="Type actions" trigger={false} /></span>
        </Show>
      </div>
      <Show when={props.declared !== undefined && props.declaredDescription}>{description =>
        <div class="type-contract__description">{description()}</div>}</Show>
      <Show when={props.mismatch}>{message => <div class="type-contract__issue" role="status">{message()}</div>}</Show>
      <Show when={editing() && editable()}>
        <div class="type-contract__editor">
          {props.editor?.()}
          <div class="type-contract__editor-actions">
            <Show when={props.onRemoveDeclared && props.declared !== undefined}>
              <button type="button" class="expr-form__btn" onClick={() => { setEditing(false); props.onRemoveDeclared?.(); }}>Remove declared type</button>
            </Show>
            <button type="button" class="expr-form__btn" onClick={() => setEditing(false)}>Done</button>
          </div>
        </div>
      </Show>
    </div>
  </Show>; }
}
