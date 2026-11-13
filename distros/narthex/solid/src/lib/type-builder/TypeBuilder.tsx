// ---------------------------------------------------------------------------
// TypeBuilder — universal, recursive editor for any FenelType value.
//
// One component, one kind picker, recursive bodies for every constructor
// the engine knows about. No per-type editors, no compromises:
// nesting `$record` fields, `$variant` cases, `$arrow` params/returns,
// `$mu` recursive bodies, `$tagged` value+phantom, etc., all flow through
// the same TypeBuilder again. The kind picker is a row of grouped buttons;
// for refinement constraints we delegate to SetExprEditor.
//
// Storage is the canonical FenelType JSON — exactly what the engine
// consumes. The empty (un-picked) state is `null`, which renders just
// the kind picker until the user chooses a constructor.
// ---------------------------------------------------------------------------

import { For, Match, Show, Switch, createContext, createMemo, createSignal, latest, onSettled, untrack, useContext } from "solid-js";
import { Portal } from "@solidjs/web";
import type { CaseDef, Expression, FenelType, FieldDef, SetExpr, TypeScheme } from "@fenel/engine/types";
import { authoringGenericTypeBindings, projectAuthoringGenericTypeApplication, type GenericTypeScope } from "@fenel/engine/authoring/generic-type-application";
import { deepEqual } from "@fenel/engine";
import { SetExprEditor } from "~/lib/expression-builder";
import { WherePredicate } from "~/lib/expression-builder/WherePredicate";
import { inspectTypePredicateSugar, editTypePredicateSugar, type TypePredicateSugarEdit, type TypePredicateSugarProjection } from "@fenel/engine/authoring/type-predicate-sugar";
import { IconByName, IconPlus, IconTrash } from "~/lib/icons";
import { TypePicker, typeIconName, type CaptureTypePickerTarget, type TypePickerSelection } from "./TypePicker";
import { draftValueFingerprint } from "~/lib/native-draft";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { readerTypeLabelInSession } from "~/lib/reader-presentation";
import { valueCardTypeLabel } from "~/lib/value-card";
import { isInertAuthoringSession } from "~/lib/expression-runner/account-authoring-session";
import { LocusSelect, locusSelectOptions } from "~/lib/locus-select";
import { RecordValuesContext } from "~/lib/field-renderer/record-values-context";
import { typePositionRefHandle } from "@fenel/engine/authoring/environment";
import "./type-builder.css";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { LocaleStringEditor } from "~/lib/representations/LocaleStringEditor";
import { buildSetExpr, peelSetExpr } from "@fenel/engine/set-marker";
import {
  ExpressionEditor as RunnerExpressionEditor,
  LambdaParamsContext,
  logicToExprNode,
  toLogic,
} from "~/lib/expression-runner";
import type { ExprNode } from "~/lib/expression-runner";
import {
  AuthoringSessionContext,
  useAuthoringSession,
  type AuthoringSession,
} from "~/lib/expression-runner/authoring-session";
import {
  KIND_GROUPS,
  KIND_LABELS,
  PARAMETERIZED_BY_NAME,
  PICKABLE_TYPE_KINDS,
  defaultElExpressionForMode,
  defaultTypeForKind,
  detectElMode,
  detectTypeKind,
  peelResultForAuthoring,
  peelMaybeForAuthoring as peelMaybe,
  peelListForAuthoring as peelList,
  replaceTypeSugarArgument,
  newPositionalTypeField,
  reindexPositionalTypeFields,
  type ElMode,
  type TypeKind,
} from "./type-builder-model";
import {
  FieldOccurrenceEditorBase,
} from "~/lib/field-occurrence/FieldOccurrenceEditorBase";
import { caseCodeNameFromLabel, createNewNamedFieldOccurrence, loadFieldNaming } from "~/lib/field-occurrence/model";
import { useFieldAuthoringContext } from "~/lib/field-occurrence/context";
import { valueCardLabel } from "~/lib/display-name";
export type { TypeKind } from "./type-builder-model";

export type TypeBuilderPresentation = "simple" | "full";
const TypeBuilderPresentationContext = createContext<(() => TypeBuilderPresentation) | null>(null);
const TypeBuilderTargetContext = createContext<CaptureTypePickerTarget | null>(null);
export const GenericTypeScopeContext = createContext<(() => GenericTypeScope | undefined)>(() => undefined);

// ---------------------------------------------------------------------------
// TypeBuilder — the public entry point
// ---------------------------------------------------------------------------

export type TypeBuilderProps = {
  value: FenelType | null | undefined;
  onChange: (t: FenelType) => void;
  /** Validate the complete proposed type before nested occurrence cleanup. */
  beforeChange?: (next: FenelType) => boolean;
  /** Presentation only: both lenses edit the same canonical type. Recursive
   * builders inherit the selected lens unless explicitly overridden. */
  presentation?: TypeBuilderPresentation;
  /** Authoring owner guard for this record's rows. Refusal precedes occurrence
   * cleanup; nested type edits arrive as a change to their containing row. */
  beforeFieldsChange?: (next: readonly FieldDef[]) => boolean;
  /** When set, the kind picker is hidden and TypeBuilder renders only the
   *  body for that kind. Used by callers that already know what kind of
   *  type they're editing — e.g. a function-signature editor that's
   *  always an `arrow`, where letting the user change the kind would
   *  corrupt the function spec. */
  lockKind?: TypeKind;
  /** Import/source authority for dependent `$el` expressions nested in this
   * type. Omit for detached, exact-ID-only drafts. */
  authoringSession?: AuthoringSession;
  /** Explicit declaration binders; inherited by recursive type editors. */
  genericScheme?: TypeScheme;
  /** Lexical recursive binders hide equally named declaration parameters. */
  genericShadowed?: string;
  /** Set by a field row that has its own options control: that control opens
   *  this type's options too, so the type shows no second one. */
  optionsOpen?: boolean;
  /** Show the Simple | Full lens switch (default). A surface that offers the
   *  full editor elsewhere (the type card's expand icon) hides it. */
  lensSwitch?: boolean;
};

export function TypeBuilder(props: TypeBuilderProps) {
  const inheritedSession = useAuthoringSession();
  const inheritedGenericScope = useContext(GenericTypeScopeContext);
  const genericScope = createMemo(() => {
    const scope: GenericTypeScope | undefined = props.genericScheme ? { scheme: props.genericScheme } : inheritedGenericScope();
    return scope && props.genericShadowed ? { ...scope, shadowed: [...(scope.shadowed ?? []), props.genericShadowed] } : scope;
  });
  const session = () => props.authoringSession ?? inheritedSession;
  const inheritedPresentation = useContext(TypeBuilderPresentationContext);
  const inheritedTarget = useContext(TypeBuilderTargetContext);
  let alive = true;
  let editRevision = 0;
  onSettled(() => () => { alive = false; editRevision += 1; });
  // A nested picker belongs to the complete containing type draft as well as
  // its leaf. Replacing or moving a field that shares the same String object
  // must not let an old reply write into the new occurrence.
  const captureTarget: CaptureTypePickerTarget = () => latest(() => {
    const parentCurrent = inheritedTarget?.();
    if (!alive || (inheritedTarget && !parentCurrent)) return undefined;
    const value = props.value;
    const fingerprint = draftValueFingerprint(value);
    const revision = editRevision;
    const owner = session();
    const lock = props.lockKind;
    const check = () => latest(() => alive && revision === editRevision && props.value === value
      && draftValueFingerprint(props.value) === fingerprint && session() === owner
      && props.lockKind === lock && (parentCurrent?.() ?? true));
    // The content of the whole chain, root first: an unchanged occurrence of
    // an unchanged draft has the same key even after a reconciled copy.
    return Object.assign(check, { draft: `${parentCurrent?.draft ?? ""}/${lock ?? ""}:${fingerprint}` });
  });
  const [selectedPresentation, setSelectedPresentation] = createSignal<TypeBuilderPresentation>();
  const presentation = () => selectedPresentation() ?? props.presentation ?? inheritedPresentation?.() ?? "full";
  const simple = () => presentation() === "simple";
  const [ownOptionsOpen, setTypeOptionsOpen] = createSignal(false);
  const typeOptionsOpen = () => props.optionsOpen ?? ownOptionsOpen();
  const [structure, setStructure] = createSignal(false);
  const [predicateError, setPredicateError] = createSignal("");
  const predicates = createMemo(() => {
    if (!simple() || structure() || props.lockKind || !props.value) return undefined;
    const projection = inspectTypePredicateSugar(props.value);
    if (!projection.ok) return undefined;
    const baseKind = detectTypeKind(projection.base);
    return baseKind === "named" || baseKind === "record" || baseKind === "variant" ? projection : undefined;
  });
  const editorValue = () => predicates()?.base ?? props.value;
  const kind = createMemo(() => props.lockKind ?? (structure() && editorValue()
    ? "$refined" in editorValue()! ? "refined" : "$opaque" in editorValue()! ? "opaque" : "$mu" in editorValue()! ? "mu" : "$variant" in editorValue()! ? "variant" : detectTypeKind(editorValue())
    : detectTypeKind(editorValue())));

  let approved: { source: TypeBuilderProps["value"]; input: FenelType; output: FenelType } | undefined;

  function changePredicate(edit: TypePredicateSugarEdit) {
    if (!props.value) return;
    const result = editTypePredicateSugar(props.value, edit);
    if (!result.ok) { setPredicateError(result.message); return; }
    if (props.beforeChange?.(result.type) === false) return;
    editRevision += 1;
    setPredicateError("");
    props.onChange(result.type);
  }
  function beforeBodyChange(type: FenelType) {
    // Match exact callback draft data within one event, not type equivalence.
    if (approved && approved.source === props.value && deepEqual(approved.input, type)) return true;
    approved = undefined;
    const result = predicates() && props.value
      ? editTypePredicateSugar(props.value, { kind: "base", base: type })
      : { ok: true as const, type };
    if (!result.ok) { setPredicateError(result.message); return false; }
    if (props.beforeChange?.(result.type) === false) return false;
    setPredicateError("");
    const current = { source: props.value, input: type, output: result.type };
    approved = current;
    queueMicrotask(() => { if (approved === current) approved = undefined; });
    return true;
  }
  function changeBody(type: FenelType) {
    if (!beforeBodyChange(type)) return false;
    const next = approved!.output;
    approved = undefined;
    editRevision += 1;
    props.onChange(next);
    return true;
  }

  function changeKind(next: TypeKind) {
    if (props.lockKind) return;
    if (kind() !== next) { setStructure(false); changeBody(defaultTypeForKind(next)); }
  }

  // Surface the current kind in the picker even if a newer constructor reaches
  // the editor before the grouped picker list is updated.
  const visibleKindGroups = createMemo(() => {
    const groups = KIND_GROUPS.map((g) => ({ ...g, kinds: [...g.kinds] }));
    const k = kind();
    if (k && !PICKABLE_TYPE_KINDS.has(k)) {
      groups.push({ label: "current", kinds: [k] });
    }
    return groups;
  });

  return (
    <AuthoringSessionContext value={session()}>
    <GenericTypeScopeContext value={genericScope}>
    <TypeBuilderPresentationContext value={presentation}>
    <TypeBuilderTargetContext value={captureTarget}>
    <div class={["tb", { "tb--simple": simple() }]} data-type-lens={presentation()}>
      <Show when={(!inheritedPresentation || props.presentation !== undefined) && props.lensSwitch !== false}>
        <div class="tb__lens" role="group" aria-label="Type lens">
          <span class="tb__lens-label">Type lens</span>
          <button type="button" class="tb-tab" aria-pressed={simple() ? "true" : "false"} onClick={() => setSelectedPresentation("simple")}>Simple</button>
          <button type="button" class="tb-tab" aria-pressed={!simple() ? "true" : "false"} onClick={() => setSelectedPresentation("full")}>Full</button>
        </div>
      </Show>
      <Show when={!props.lockKind && simple() && (!inheritedPresentation || kind() !== "named" || typeOptionsOpen())}>
        <div class="tb__simple-kind">
          <LocusSelect label="Type shape" value={kind() ?? ""}
            fallbackOption={{ value: kind() ?? "", label: kind() ? KIND_LABELS[kind()!] : "Choose a type" }}
            options={[
              { value: "named", label: "Existing type" },
              { value: "record", label: "Fields" },
              { value: "variant", label: "Choices" },
              { value: "other", label: "Other type…" },
            ]}
            onChange={(next) => next === "other" ? setSelectedPresentation("full") : changeKind(next as TypeKind)} />
        </div>
      </Show>
      <Show when={!!inheritedPresentation && !simple() && inheritedPresentation?.() === "simple"}>
        <button type="button" class="tb-add-btn" onClick={() => setSelectedPresentation("simple")}>Simple lens</button>
      </Show>
      <Show when={!props.lockKind && !simple()}>
        <div class="tb__kind">
          <span class="tb__kind-label">kind</span>
          <div class="tb__kind-groups">
            <For each={visibleKindGroups()}>
              {(g) => (
                <div class="tb__kind-group" data-tooltip={g.label}>
                  <For each={g.kinds}>
                    {(k) => (
                      <button
                        type="button"
                        class={{
                          "tb__kind-btn": true,
                          "tb__kind-btn--active": kind() === k,
                        }}
                        onClick={() => changeKind(k)}
                      >
                        {KIND_LABELS[k]}
                      </button>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
      <div class="tb__body">
        <Show when={!props.lockKind && (structure() || kind() === "list" || kind() === "maybe" || kind() === "result")}>
          <button type="button" class="tb-add-btn" onClick={() => setStructure(!structure())}>{structure() ? "Show type shorthand" : "Show full type structure"}</button>
        </Show>
        <Show when={kind() === "void"}>
          <div class="tb-leaf tb-leaf--inert">∅ — the empty type, no inhabitants</div>
        </Show>
        <Show when={kind() === "unit"}>
          <div class="tb-leaf tb-leaf--inert">() — single value, no fields</div>
        </Show>
        <Show when={kind() === "named"}>
          <NamedBody value={editorValue() as { $ref?: string }} onChange={changeBody}
            compact={simple() && !!inheritedPresentation} optionsOpen={typeOptionsOpen()}
            onToggleOptions={props.optionsOpen === undefined ? () => setTypeOptionsOpen(!ownOptionsOpen()) : undefined} />
        </Show>
        <Show when={kind() === "var"}>
          <VarBody value={editorValue() as { $var: string }} onChange={changeBody} />
        </Show>
        <Show when={kind() === "record"}>
          <RecordBody
            value={editorValue() as { $record: { fields: FieldDef[] } }}
            onChange={changeBody}
            beforeFieldsChange={(fields) => beforeBodyChange({ $record: { ...(editorValue() as { $record: { fields: FieldDef[] } }).$record, fields: [...fields] } })
              && props.beforeFieldsChange?.(fields) !== false}
          />
        </Show>
        <Show when={kind() === "variant"}>
          <VariantBody
            value={editorValue() as { $variant: { cases: CaseDef[]; discriminator?: string } }}
            onChange={changeBody}
            beforeChange={beforeBodyChange}
            predicateCases={predicates()?.cases}
            onPredicateChange={(index, predicate) => changePredicate({ kind: "case", index, predicate })}
          />
        </Show>
        <Show when={kind() === "tuple"}>
          <TupleBody beforeChange={beforeBodyChange} value={editorValue() as { $tuple: FenelType[] }} onChange={changeBody} />
        </Show>
        <Show when={kind() === "map"}>
          <MapBody
            beforeChange={beforeBodyChange}
            value={editorValue() as { $map: { keys: SetExpr; values: FenelType } }}
            onChange={changeBody}
          />
        </Show>
        <Show when={kind() === "union"}>
          <LatticeListBody
            beforeChange={beforeBodyChange}
            op="union"
            value={editorValue() as { $union: FenelType[] }}
            onChange={changeBody}
          />
        </Show>
        <Show when={kind() === "intersect"}>
          <LatticeListBody
            beforeChange={beforeBodyChange}
            op="intersect"
            value={editorValue() as { $intersect: FenelType[] }}
            onChange={changeBody}
          />
        </Show>
        <Show when={kind() === "complement"}>
          <ComplementBody
            beforeChange={beforeBodyChange}
            value={editorValue() as { $complement: FenelType }}
            onChange={changeBody}
          />
        </Show>
        <Show when={kind() === "list"}>
          <UnaryWrapBody
            beforeChange={beforeBodyChange}
            label="element"
            inner={(editorValue() ? peelList(editorValue()!)?.elem : undefined) ?? { $ref: "String" }}
            wrap={(t) => replaceTypeSugarArgument(editorValue()!, "element", t)}
            onChange={changeBody}
          />
        </Show>
        <Show when={kind() === "maybe"}>
          <UnaryWrapBody
            beforeChange={beforeBodyChange}
            label="inner"
            inner={(editorValue() ? peelMaybe(editorValue()!)?.value : undefined) ?? { $ref: "String" }}
            wrap={(t) => replaceTypeSugarArgument(editorValue()!, "inner", t)}
            onChange={changeBody}
          />
        </Show>
        <Show when={kind() === "result"}>
          <ResultBody
            beforeChange={beforeBodyChange}
            original={editorValue()!}
            value={(editorValue() ? peelResultForAuthoring(editorValue()!) : null) ?? { err: { $ref: "String" }, ok: { $ref: "String" } }}
            onChange={changeBody}
          />
        </Show>
        <Show when={kind() === "el-call"}>
          <ElBody
            value={editorValue() as { $el: Expression }}
            onChange={changeBody}
            preferredMode="call"
          />
        </Show>
        <Show when={kind() === "refined"}>
          <RefinedBody
            beforeChange={beforeBodyChange}
            value={editorValue() as { $refined: { base: FenelType; set: SetExpr } }}
            onChange={changeBody}
          />
        </Show>
        <Show when={kind() === "mu"}>
          <MuBody
            beforeChange={beforeBodyChange}
            value={editorValue() as { $mu: { var: string; body: FenelType } }}
            onChange={changeBody}
          />
        </Show>
        <Show when={kind() === "tagged"}>
          <TaggedBody
            beforeChange={beforeBodyChange}
            value={editorValue() as { $tagged: { value: FenelType; phantom: FenelType } }}
            onChange={changeBody}
          />
        </Show>
        <Show when={kind() === "opaque"}>
          <OpaqueBody
            beforeChange={beforeBodyChange}
            value={editorValue() as { $opaque: { name: string; pure?: FenelType } }}
            onChange={changeBody}
          />
        </Show>
        <Show when={kind() === "arrow"}>
          <ArrowBody
            beforeChange={beforeBodyChange}
            value={editorValue() as { $arrow: { params: FieldDef[]; returns: FenelType } }}
            onChange={changeBody}
          />
        </Show>
        <Show when={kind() === "type"}>
          <div class="tb-leaf tb-leaf--inert">Type — the universe; values are themselves types</div>
        </Show>
        <Show when={kind() === "el"}>
          <ElBody value={editorValue() as { $el: Expression }} onChange={changeBody} />
        </Show>
        <Show when={predicates() && (!inheritedPresentation || kind() !== "named" || typeOptionsOpen() || predicates()?.global !== undefined)}>
          <TypeCondition label="all data" baseType={predicates()!.base} predicate={predicates()?.global}
            onChange={(predicate) => changePredicate({ kind: "global", predicate })} />
        </Show>
        <Show when={predicateError()}><div class="tb-condition-error" role="alert">{predicateError()}</div></Show>
      </div>
    </div>
    </TypeBuilderTargetContext>
    </TypeBuilderPresentationContext>
    </GenericTypeScopeContext>
    </AuthoringSessionContext>
  );
}

// ---------------------------------------------------------------------------
// Bodies — atoms
// ---------------------------------------------------------------------------

function TypeCondition(props: {
  label: string;
  baseType: FenelType;
  predicate?: Expression;
  onChange: (predicate?: Expression) => void;
}) {
  const session = useAuthoringSession();
  const [draft, setDraft] = createSignal<Expression>();
  // Source projection creates fresh containers for a narrowed case. Retain
  // the same DOM scope when that exact data shape has not changed; this is
  // representation equality, not a type-equivalence or subtype judgment.
  const scope = createMemo(() => props.baseType, { equals: deepEqual });
  return <section class="tb-condition" aria-label={`Condition for ${props.label}`}>
    <Show when={props.predicate !== undefined || draft() !== undefined} fallback={
      <button type="button" class="tb-add-btn tb-condition-add" onClick={() => {
        setDraft(toLogic({ kind: "literal", value: true }, undefined, session) as Expression);
      }}><IconPlus size={11} /> Add condition for {props.label}</button>
    }>
      <div class="tb-condition__head">
        <span>Condition for {props.label}</span><span class="tb-condition__result">Boolean</span>
        <button type="button" class="tb-remove-btn" aria-label={`Remove condition for ${props.label}`} onClick={() => {
          if (props.predicate !== undefined) props.onChange(undefined);
          setDraft(undefined);
        }}>×</button>
      </div>
      <WherePredicate pred={props.predicate !== undefined ? props.predicate : draft()!} baseType={scope()}
        onChange={predicate => { props.onChange(predicate); setDraft(undefined); }} />
    </Show>
  </section>;
}

function NamedBody(props: {
  value: { $ref?: string }; onChange: (t: FenelType) => boolean;
  compact?: boolean; optionsOpen?: boolean; onToggleOptions?: () => void;
}) {
  const [picking, setPicking] = createSignal(false);
  const presentation = useContext(TypeBuilderPresentationContext);
  const target = useContext(TypeBuilderTargetContext);
  const session = useAuthoringSession();
  const reader = useReaderRuntime();
  const [referenceOpen, setReferenceOpen] = createSignal(false);
  const caption = () => {
    const handle = props.value?.$ref;
    if (!handle) return "(none)";
    const type: FenelType = { $ref: handle };
    // Local owns presentation in its worker. A missing answer stays a miss;
    // never evaluate its page frame or retain a label from an earlier pick.
    if (reader?.kind === "local" || isInertAuthoringSession(session)) {
      return valueCardTypeLabel(reader?.typePresentation?.(type)?.label)
        ?? (reader?.typePresentationPending?.(type) ? "Loading type…" : handle);
    }
    return valueCardTypeLabel(readerTypeLabelInSession(type, session, reader)) ?? handle;
  };
  // The type reads as on a data card's type line: its icon, then its label,
  // or its code name in the code face when it has no label.
  const icon = () => {
    const handle = props.value?.$ref;
    return handle ? typeIconName(handle, reader?.kind === "local" ? reader.typePresentation?.({ $ref: handle })?.icon : undefined) : undefined;
  };
  function pickType(selection: TypePickerSelection) {
    if (selection.kind === "auto") return;
    // Keep the existing constructor shorthand only for its actual checked
    // system declaration. A user type with the same Labelable label remains
    // that user's exact reference; presentation never dispatches a factory.
    const factory = selection.ownership === "reader-checked" && selection.row.category === "constructor"
      && selection.declarationOwner?.module === "system"
      ? PARAMETERIZED_BY_NAME[selection.declarationOwner.id] : undefined;
    if (props.onChange(factory ? factory() : { $ref: selection.reference })) close();
  }
  // The list opens at a readable width under the type button, portalled like
  // the app's menus so neither the row nor a card clips it, inside the window.
  let trigger: HTMLButtonElement | undefined;
  // A press on the button while the list is open closes it (its outside
  // press), and the click that follows must not open it again.
  let closingClick = false;
  const [at, setAt] = createSignal<{ left: number; top: number; above: number; width: number }>();
  function open() {
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    let host = trigger.closest(".tb");
    for (let up = host?.parentElement?.closest(".tb"); up; up = up.parentElement?.closest(".tb")) host = up;
    const width = Math.min(window.innerWidth - 16, Math.max(336, Math.min(512, host?.getBoundingClientRect().width ?? 0)));
    setAt({ left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)), top: box.bottom + 4, above: box.top - 4, width });
    setPicking(true);
  }
  function close() { setPicking(false); trigger?.focus(); }
  const popoverStyle = () => {
    const place = at();
    return place ? `left: ${Math.round(place.left)}px; top: ${Math.round(place.top)}px; width: ${Math.round(place.width)}px` : "visibility: hidden";
  };
  function fit(popover: HTMLDivElement) {
    requestAnimationFrame(() => {
      const place = at();
      const height = popover.getBoundingClientRect().height;
      if (place && place.top + height > window.innerHeight - 8 && place.above - height >= 8) setAt({ ...place, top: place.above - height });
    });
  }

  return (
    <div class="tb-body tb-named-body">
      <Show when={presentation?.() !== "simple" || referenceOpen()}>
      <label class="tb-body__label">Type name or ID
        <input class="tb-name-input mono" aria-label="Type name or ID" value={props.value?.$ref ?? ""}
          placeholder="ForwardType or MyModule.Type"
          onInput={(event) => props.onChange({ $ref: event.currentTarget.value })} />
      </label>
      </Show>
      <button
        ref={(element) => { trigger = element; }}
        type="button"
        class="tb-named-btn"
        aria-haspopup="listbox"
        aria-expanded={picking() ? "true" : "false"}
        onPointerDown={() => { closingClick = picking(); }}
        onClick={() => { if (closingClick) closingClick = false; else open(); }}
      >
        <Show when={icon()} keyed>{(name) => <IconByName name={name} size={14} />}</Show>
        <span class={{ "tb-named-btn__name": true, mono: caption() === props.value?.$ref }}>{caption()}</span>
      </button>
      <Show when={picking()}>
        <Portal>
          <div ref={fit} class="tb-type-popover" style={popoverStyle()}>
            <TypePicker onPick={pickType} captureTarget={() => picking() ? target?.() : undefined}
              onCancel={close} closeOnOutsideClick />
          </div>
        </Portal>
      </Show>
      <Show when={props.compact && props.onToggleOptions}>
        <button type="button" class="tb-named-reference" aria-label="Type options" aria-expanded={props.optionsOpen ? "true" : "false"}
          onClick={() => props.onToggleOptions?.()}>•••</button>
      </Show>
      <Show when={presentation?.() === "simple" && (!props.compact || props.optionsOpen)}>
        <button type="button" class="tb-named-reference" aria-label="Type name or ID" aria-expanded={referenceOpen() ? "true" : "false"}
          onClick={() => setReferenceOpen(!referenceOpen())}>Name or ID</button>
      </Show>
    </div>
  );
}

function VarBody(props: { value: { $var: string }; onChange: (t: FenelType) => void }) {
  return (
    <div class="tb-body tb-body--inline">
      <span class="tb-body__label">name:</span>
      <input
        class="tb-name-input mono"
        type="text"
        value={props.value.$var}
        placeholder="a"
        onInput={(e) => props.onChange({ $var: e.currentTarget.value })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bodies — composites
// ---------------------------------------------------------------------------

function RecordBody(props: {
  value: { $record: { fields: FieldDef[] } };
  onChange: (t: FenelType) => void;
  beforeFieldsChange?: (next: readonly FieldDef[]) => boolean;
}) {
  const authoring = useFieldAuthoringContext();
  const presentation = useContext(TypeBuilderPresentationContext);
  const fields = () => props.value.$record.fields ?? [];

  function acceptFields(next: FieldDef[]) {
    return props.beforeFieldsChange?.(reindexPositionalTypeFields(next)) !== false;
  }
  function setFields(next: FieldDef[], accepted = false) {
    if (!accepted && !acceptFields(next)) return false;
    props.onChange({ $record: { ...props.value.$record, fields: reindexPositionalTypeFields(next) } });
    return true;
  }
  function addField() {
    const n = fields().length + 1;
    const field = createNewNamedFieldOccurrence(`field${n}`);
    if (setFields([...fields(), field])) authoring?.onFieldCreated?.(field);
  }

  return (
    <div class="tb-body tb-body--block">
      <For keyed={false} each={fields()}>
        {(field, i) => (
          <FieldRow
            value={field()}
            beforeChange={(f) => acceptFields(fields().map((x, j) => (j === i ? f : x)))}
            beforeRemove={() => acceptFields(fields().filter((_, j) => j !== i))}
            onChange={(f) => setFields(fields().map((x, j) => (j === i ? f : x)), true)}
            onRemove={() => setFields(fields().filter((_, j) => j !== i), true)}
            onMoveUp={i > 0 ? () => setFields(moveTypeField(fields(), i, i - 1)) : undefined}
            onMoveDown={i < fields().length - 1 ? () => setFields(moveTypeField(fields(), i, i + 1)) : undefined}
          />
        )}
      </For>
      <button type="button" class="tb-add-btn" onClick={addField}>
        <IconPlus size={11} /> add field
      </button>
      <Show when={presentation?.() !== "simple"}>
      <details class="tb-advanced" open>
        <summary>Advanced fields</summary>
        <button type="button" class="tb-add-btn" onClick={() => setFields([...fields(), newPositionalTypeField(fields().length)])}>add positional field</button>
      </details>
      </Show>
    </div>
  );
}

function VariantBody(props: {
  value: { $variant: { cases: CaseDef[]; discriminator?: string } };
  onChange: (t: FenelType) => void;
  beforeChange?: (t: FenelType) => boolean;
  predicateCases?: Extract<TypePredicateSugarProjection, { ok: true }>["cases"];
  onPredicateChange?: (index: number, predicate?: Expression) => void;
}) {
  const cases = () => props.value.$variant.cases ?? [];
  const presentation = useContext(TypeBuilderPresentationContext);
  const discriminator = () => props.value.$variant.discriminator;

  function acceptCases(next: CaseDef[]) {
    return props.beforeChange?.({ $variant: { ...props.value.$variant, cases: next } }) !== false;
  }
  function setCases(next: CaseDef[], accepted = false) {
    if (!accepted && !acceptCases(next)) return;
    props.onChange({ $variant: { ...props.value.$variant, cases: next } });
  }
  function setDiscriminator(name: string | undefined) {
    const out: { $variant: { cases: CaseDef[]; discriminator?: string } } = {
      $variant: { cases: cases() },
    };
    if (name) out.$variant.discriminator = name;
    if (props.beforeChange?.(out) === false) return false;
    props.onChange(out);
    return true;
  }
  function addCase() {
    const n = cases().length + 1;
    setCases([...cases(), { name: `Case${n}`, label: Nothing, fields: [] }]);
  }

  return (
    <div class="tb-body tb-body--block">
      <details class="tb-advanced" open={presentation?.() !== "simple" || !!discriminator()}>
        <summary>Choice tag{discriminator() ? ` · ${discriminator()}` : ""}</summary>
      <div class="tb-body--inline">
        <span class="tb-body__label">discriminator:</span>
        <input
          class="tb-name-input mono"
          type="text"
          value={discriminator() ?? ""}
          placeholder="$tag (default)"
          onInput={(e) => { if (!setDiscriminator(e.currentTarget.value || undefined)) e.currentTarget.value = discriminator() ?? ""; }}
        />
      </div>
      </details>
      <For keyed={false} each={cases()}>
        {(c, i) => (
          <CaseRow
            value={c()}
            beforeChange={(next) => acceptCases(cases().map((x, j) => (j === i ? next : x)))}
            beforeRemove={() => acceptCases(cases().filter((_, j) => j !== i))}
            onChange={(next) => setCases(cases().map((x, j) => (j === i ? next : x)), true)}
            onRemove={() => setCases(cases().filter((_, j) => j !== i), true)}
            predicateCase={props.predicateCases?.[i]}
            onPredicateChange={(predicate) => props.onPredicateChange?.(i, predicate)}
          />
        )}
      </For>
      <button type="button" class="tb-add-btn" onClick={addCase}>
        <IconPlus size={11} /> {presentation?.() === "simple" ? "add choice" : "add case"}
      </button>
    </div>
  );
}

function CaseRow(props: {
  value: CaseDef;
  onChange: (next: CaseDef) => void;
  onRemove: () => void;
  beforeChange?: (next: CaseDef) => boolean;
  beforeRemove?: () => boolean;
  predicateCase?: Extract<TypePredicateSugarProjection, { ok: true }>["cases"][number];
  onPredicateChange?: (predicate?: Expression) => void;
}) {
  const authoring = useFieldAuthoringContext();
  const presentation = useContext(TypeBuilderPresentationContext);
  const fields = () => props.value.fields ?? [];

  function changeCase(next: CaseDef, accepted = false) {
    if (!accepted && props.beforeChange?.(next) === false) return false;
    props.onChange(next);
    return true;
  }
  function acceptFields(next: FieldDef[]) {
    return props.beforeChange?.({ ...props.value, fields: reindexPositionalTypeFields(next) }) !== false;
  }
  function setFields(next: FieldDef[], accepted = false) {
    return changeCase({ ...props.value, fields: reindexPositionalTypeFields(next) }, accepted);
  }
  function addField() {
    const n = fields().length + 1;
    const field = createNewNamedFieldOccurrence(`field${n}`);
    if (setFields([...fields(), field])) authoring?.onFieldCreated?.(field);
  }
  // In the simple lens what a person types as a choice's name is its label;
  // the constructor's code name follows it only for a choice added here (its
  // default `Case<n>` name, no label yet) until the code name is edited on its
  // own. An existing case keeps its code name: stored data carries it as `$tag`.
  const simple = () => presentation?.() === "simple";
  void loadFieldNaming();
  const caseLabelText = () => props.value.label.$tag === "Just" ? valueCardLabel(props.value.label._0) : undefined;
  let codeFollows = untrack(() => props.value.label.$tag === "Nothing" && /^Case\d+$/.test(props.value.name));
  function changeCaseLabel(text: string) {
    const previous = caseLabelText();
    const follows = codeFollows && (!previous?.trim() || props.value.name === caseCodeNameFromLabel(previous));
    const label = text.trim() === "" ? Nothing : Just(text);
    const name = follows ? caseCodeNameFromLabel(text) : undefined;
    return changeCase({ ...props.value, label, ...(name !== undefined ? { name } : {}) });
  }
  function changeCaseCodeName(name: string) {
    if (!changeCase({ ...props.value, name })) return false;
    codeFollows = false;
    return true;
  }

  return (
    <div class="tb-row">
      <div class="tb-row__head">
        <Show when={simple()} fallback={
          <input
            class="tb-row__name mono"
            aria-label="Choice name"
            type="text"
            value={props.value.name}
            placeholder="CaseName"
            onInput={(e) => { if (!changeCaseCodeName(e.currentTarget.value)) e.currentTarget.value = props.value.name; }}
          />
        }>
          <input
            class={{ "tb-row__name": true, mono: caseLabelText() === undefined }}
            aria-label="Choice name"
            data-case-label-input=""
            type="text"
            value={caseLabelText() ?? props.value.name}
            placeholder="Choice name"
            onInput={(e) => { if (!changeCaseLabel(e.currentTarget.value)) e.currentTarget.value = caseLabelText() ?? props.value.name; }}
          />
        </Show>
        <button type="button" class="tb-remove-btn" aria-label="Remove choice" onClick={() => { if (props.beforeRemove?.() !== false) props.onRemove(); }}>
          <IconTrash size={11} />
        </button>
      </div>
      <div class="tb-row__body">
        <Show when={simple()}>
          <details class="tb-case-label"><summary>Code name</summary>
            <input
              class="tb-row__name mono"
              aria-label="Choice code name"
              data-case-code-input=""
              type="text"
              value={props.value.name}
              placeholder="CaseName"
              onInput={(e) => { if (!changeCaseCodeName(e.currentTarget.value)) e.currentTarget.value = props.value.name; }}
            />
          </details>
        </Show>
        <Show when={!simple()}>
        <details class="tb-case-label" open={props.value.label.$tag === "Just"}><summary>Choice label</summary>
          <LocaleStringEditor value={props.value.label.$tag === "Just" ? props.value.label._0 : undefined}
            methodName="label" onChange={(label) => changeCase({ ...props.value, label: Just(label) })} />
          <Show when={props.value.label.$tag === "Just"}><button type="button" class="tb-add-btn" onClick={() => changeCase({ ...props.value, label: Nothing })}>Use case name</button></Show>
        </details>
        </Show>
        <For keyed={false} each={fields()}>
          {(f, i) => (
            <FieldRow
              value={f()}
              beforeChange={(next) => acceptFields(fields().map((x, j) => (j === i ? next : x)))}
              beforeRemove={() => acceptFields(fields().filter((_, j) => j !== i))}
              onChange={(next) => setFields(fields().map((x, j) => (j === i ? next : x)), true)}
              onRemove={() => setFields(fields().filter((_, j) => j !== i), true)}
              onMoveUp={i > 0 ? () => setFields(moveTypeField(fields(), i, i - 1)) : undefined}
              onMoveDown={i < fields().length - 1 ? () => setFields(moveTypeField(fields(), i, i + 1)) : undefined}
            />
          )}
        </For>
        <button type="button" class="tb-add-btn tb-add-btn--sub" onClick={addField}>
          <IconPlus size={10} /> add field
        </button>
        <Show when={!simple()}>
        <details class="tb-advanced" open>
          <summary>Advanced fields</summary>
          <button type="button" class="tb-add-btn tb-add-btn--sub" onClick={() => setFields([...fields(), newPositionalTypeField(fields().length)])}>add positional field</button>
        </details>
        </Show>
        <Show when={props.predicateCase}>
          <TypeCondition label={props.value.name} baseType={props.predicateCase!.type} predicate={props.predicateCase?.predicate}
            onChange={predicate => props.onPredicateChange?.(predicate)} />
        </Show>
      </div>
    </div>
  );
}

function FieldRow(props: {
  value: FieldDef;
  onChange: (f: FieldDef) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  beforeChange?: (next: FieldDef) => boolean;
  beforeRemove?: () => boolean;
}) {
  const presentation = useContext(TypeBuilderPresentationContext);
  return (
    <div class="tb-field-row">
    <FieldOccurrenceEditorBase
      field={props.value}
      onChange={props.onChange}
      onRemove={props.onRemove}
      beforeChange={props.beforeChange}
      beforeRemove={props.beforeRemove}
      onMoveUp={props.onMoveUp}
      onMoveDown={props.onMoveDown}
      simple={presentation?.() === "simple"}
      compact
      renderTypeEditor={(editor) => (
        <TypeBuilder value={editor.value} beforeChange={editor.beforeChange} onChange={editor.onChange} optionsOpen={editor.optionsOpen} />
      )}
    />
    </div>
  );
}

function moveTypeField(fields: FieldDef[], from: number, to: number): FieldDef[] {
  const next = [...fields];
  const [field] = next.splice(from, 1);
  next.splice(to, 0, field!);
  return next;
}

function TupleBody(props: {
  value: { $tuple: FenelType[] };
  onChange: (t: FenelType) => void;
  beforeChange?: (next: FenelType) => boolean;
}) {
  const items = () => props.value.$tuple ?? [];

  function setItems(next: FenelType[]) {
    props.onChange({ $tuple: next });
  }
  function addItem() {
    setItems([...items(), { $ref: "String" }]);
  }

  return (
    <div class="tb-body tb-body--block">
      <For keyed={false} each={items()}>
        {(t, i) => (
          <div class="tb-row">
            <div class="tb-row__head">
              <span class="tb-row__index mono">[{i}]</span>
              <button
                type="button"
                class="tb-remove-btn"
                onClick={() => setItems(items().filter((_, j) => j !== i))}
              >
                <IconTrash size={11} />
              </button>
            </div>
            <div class="tb-row__body">
              <TypeBuilder
                value={t()}
                beforeChange={(next) => props.beforeChange?.({ $tuple: items().map((x, j) => (j === i ? next : x)) }) !== false}
                onChange={(next) => setItems(items().map((x, j) => (j === i ? next : x)))}
              />
            </div>
          </div>
        )}
      </For>
      <button type="button" class="tb-add-btn" onClick={addItem}>
        <IconPlus size={11} /> add element
      </button>
    </div>
  );
}

function MapBody(props: {
  value: { $map: { keys: SetExpr; values: FenelType } };
  onChange: (t: FenelType) => void;
  beforeChange?: (next: FenelType) => boolean;
}) {
  return (
    <div class="tb-body tb-body--block">
      <span class="tb-body__label">keys (set):</span>
      <SetExprEditor
        value={props.value.$map.keys}
        onChange={(s) =>
          props.onChange({ $map: { ...props.value.$map, keys: s ?? buildSetExpr.ref("String") } })
        }
        valueType="string"
        baseType={{ $ref: "String" }}
      />
      <span class="tb-body__label">values:</span>
      <TypeBuilder
        value={props.value.$map.values}
        beforeChange={(t) => props.beforeChange?.({ $map: { ...props.value.$map, values: t } }) !== false}
        onChange={(t) => props.onChange({ $map: { ...props.value.$map, values: t } })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bodies — set lattice formers
// ---------------------------------------------------------------------------

type SetExprValueType = "string" | "number" | "date" | "any";

function isTopSet(set: SetExpr | undefined): boolean {
  return !!set && peelSetExpr(set)?.kind === "SeAll";
}

function splitConstrainedOperand(type: FenelType): { base: FenelType; set: SetExpr | undefined } {
  if ("$refined" in type) return { base: type.$refined.base, set: type.$refined.set };
  return { base: type, set: undefined };
}

function joinConstrainedOperand(base: FenelType, set: SetExpr | undefined): FenelType {
  if (!set || isTopSet(set)) return base;
  return { $refined: { base, set } };
}

function valueTypeForOperandBase(base: FenelType): SetExprValueType {
  const handle = typePositionRefHandle(base) ?? ("$ref" in base ? base.$ref : "");
  const name = handle.toLowerCase();
  if (name.includes("date") || name.includes("time")) return "date";
  if (
    name.includes("number") ||
    name.includes("int") ||
    name.includes("nat") ||
    name.includes("real") ||
    name.includes("rational")
  ) {
    return "number";
  }
  if (
    name.includes("string") ||
    name.includes("str") ||
    name.includes("email") ||
    name.includes("url") ||
    name.includes("slug")
  ) {
    return "string";
  }
  return "any";
}

function LatticeListBody(props: {
  op: "union" | "intersect";
  value: { $union: FenelType[] } | { $intersect: FenelType[] };
  onChange: (t: FenelType) => void;
  beforeChange?: (next: FenelType) => boolean;
}) {
  const branches = () => (
    props.op === "union"
      ? (props.value as { $union: FenelType[] }).$union
      : (props.value as { $intersect: FenelType[] }).$intersect
  );
  const symbol = () => props.op === "union" ? "∪" : "∩";
  const connective = () => props.op === "union" ? "OR" : "AND";

  function setBranches(next: FenelType[]) {
    props.onChange(props.op === "union" ? { $union: next } : { $intersect: next });
  }
  function addBranch() {
    setBranches([...branches(), { $ref: "String" }]);
  }

  return (
    <div class="tb-body tb-body--block tb-lattice">
      <div class="tb-lattice__head">
        <span class="tb-body__label">
          {props.op === "union" ? "any operand matches" : "all operands match"}
        </span>
        <span class="tb-lattice__formula mono">A {symbol()} B</span>
      </div>
      <For keyed={false} each={branches()}>
        {(operand, i) => (
          <>
            <ConstrainedOperandEditor
              index={i}
              operand={operand()}
              beforeChange={(next) => props.beforeChange?.(props.op === "union"
                ? { $union: branches().map((branch, j) => j === i ? next : branch) }
                : { $intersect: branches().map((branch, j) => j === i ? next : branch) }) !== false}
              onChange={(next) =>
                setBranches(branches().map((branch, j) => (j === i ? next : branch)))
              }
              onRemove={() => setBranches(branches().filter((_, j) => j !== i))}
              removable={branches().length > 1}
            />
            <Show when={i < branches().length - 1}>
              <div class="tb-lattice__join mono">{connective()} · {symbol()}</div>
            </Show>
          </>
        )}
      </For>
      <button type="button" class="tb-add-btn" onClick={addBranch}>
        <IconPlus size={11} /> add operand
      </button>
    </div>
  );
}

function ComplementBody(props: {
  value: { $complement: FenelType };
  onChange: (t: FenelType) => void;
  beforeChange?: (next: FenelType) => boolean;
}) {
  return (
    <div class="tb-body tb-body--block tb-lattice">
      <div class="tb-lattice__head">
        <span class="tb-body__label">not this type</span>
        <span class="tb-lattice__formula mono">¬A</span>
      </div>
      <ConstrainedOperandEditor
        index={() => "¬"}
        operand={props.value.$complement}
        beforeChange={(next) => props.beforeChange?.({ $complement: next }) !== false}
        onChange={(next) => props.onChange({ $complement: next })}
      />
    </div>
  );
}

function ConstrainedOperandEditor(props: {
  index: number | (() => string);
  operand: FenelType;
  onChange: (t: FenelType) => void;
  beforeChange?: (next: FenelType) => boolean;
  onRemove?: () => void;
  removable?: boolean;
}) {
  const parts = createMemo(() => splitConstrainedOperand(props.operand));
  const indexLabel = () => typeof props.index === "function" ? props.index() : `#${props.index + 1}`;

  function setBase(base: FenelType) {
    props.onChange(joinConstrainedOperand(base, parts().set));
  }
  function setConstraint(set: SetExpr | undefined) {
    props.onChange(joinConstrainedOperand(parts().base, set));
  }

  return (
    <div class="tb-row tb-lattice-operand">
      <div class="tb-row__head">
        <span class="tb-row__index mono">{indexLabel()}</span>
        <Show when={props.removable && props.onRemove}>
          <button type="button" class="tb-remove-btn" onClick={() => props.onRemove?.()}>
            <IconTrash size={11} />
          </button>
        </Show>
      </div>
      <div class="tb-row__body">
        <span class="tb-body__label">base:</span>
        <TypeBuilder value={parts().base} beforeChange={(next) => props.beforeChange?.(joinConstrainedOperand(next, parts().set)) !== false} onChange={setBase} />
        <span class="tb-body__label">constraint:</span>
        <SetExprEditor
          value={parts().set}
          valueType={valueTypeForOperandBase(parts().base)}
          baseType={parts().base}
          onChange={setConstraint}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bodies — sugars (single inner type)
// ---------------------------------------------------------------------------

function UnaryWrapBody(props: {
  label: string;
  inner: FenelType;
  wrap: (t: FenelType) => FenelType;
  onChange: (t: FenelType) => void;
  beforeChange?: (next: FenelType) => boolean;
}) {
  return (
    <div class="tb-body tb-body--block">
      <span class="tb-body__label">{props.label}:</span>
      <TypeBuilder value={props.inner} beforeChange={(t) => props.beforeChange?.(props.wrap(t)) !== false} onChange={(t) => props.onChange(props.wrap(t))} />
    </div>
  );
}

function ResultBody(props: {
  original: FenelType;
  value: { err: FenelType; ok: FenelType };
  onChange: (t: FenelType) => void;
  beforeChange?: (next: FenelType) => boolean;
}) {
  return (
    <div class="tb-body tb-body--block">
      <span class="tb-body__label">err:</span>
      <TypeBuilder
        value={props.value.err}
        beforeChange={(t) => props.beforeChange?.(replaceTypeSugarArgument(props.original, "err", t)) !== false}
        onChange={(t) => props.onChange(replaceTypeSugarArgument(props.original, "err", t))}
      />
      <span class="tb-body__label">ok:</span>
      <TypeBuilder
        value={props.value.ok}
        beforeChange={(t) => props.beforeChange?.(replaceTypeSugarArgument(props.original, "ok", t)) !== false}
        onChange={(t) => props.onChange(replaceTypeSugarArgument(props.original, "ok", t))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bodies — wrappers
// ---------------------------------------------------------------------------

function RefinedBody(props: {
  value: { $refined: { base: FenelType; set: SetExpr } };
  onChange: (t: FenelType) => void;
  beforeChange?: (next: FenelType) => boolean;
}) {
  return (
    <div class="tb-body tb-body--block">
      <span class="tb-body__label">base:</span>
      <TypeBuilder
        value={props.value.$refined.base}
        beforeChange={(t) => props.beforeChange?.({ $refined: { ...props.value.$refined, base: t } }) !== false}
        onChange={(t) =>
          props.onChange({ $refined: { ...props.value.$refined, base: t } })
        }
      />
      <span class="tb-body__label">constraint:</span>
      <SetExprEditor
        value={props.value.$refined.set}
        baseType={props.value.$refined.base}
        valueType={valueTypeForOperandBase(props.value.$refined.base)}
        onChange={(s) =>
          props.onChange({ $refined: { ...props.value.$refined, set: s ?? buildSetExpr.enum([]) } })
        }
      />
    </div>
  );
}

function TaggedBody(props: {
  value: { $tagged: { value: FenelType; phantom: FenelType } };
  onChange: (t: FenelType) => void;
  beforeChange?: (next: FenelType) => boolean;
}) {
  return (
    <div class="tb-body tb-body--block">
      <span class="tb-body__label">runtime value:</span>
      <TypeBuilder
        value={props.value.$tagged.value}
        beforeChange={(t) => props.beforeChange?.({ $tagged: { ...props.value.$tagged, value: t } }) !== false}
        onChange={(t) =>
          props.onChange({ $tagged: { ...props.value.$tagged, value: t } })
        }
      />
      <span class="tb-body__label">phantom type tag:</span>
      <TypeBuilder
        value={props.value.$tagged.phantom}
        beforeChange={(t) => props.beforeChange?.({ $tagged: { ...props.value.$tagged, phantom: t } }) !== false}
        onChange={(t) =>
          props.onChange({ $tagged: { ...props.value.$tagged, phantom: t } })
        }
      />
    </div>
  );
}

// representation-substrate Phase 5b-final — `$opaque` is the NOMINAL-NEWTYPE
// marker: a NAME (nominal identity — distinguishes e.g. `String` from its
// structurally-identical `List Char` representation) + its pure-ADT definition.
// The decorative `repr` STRING was retired from the type in Phase 5a, so the
// `repr` input here wrote a field nothing read since then — dropped. The wrapper
// itself STAYS (it carries nominal identity, a language fact, not a perf rep).
function OpaqueBody(props: {
  value: { $opaque: { name: string; pure?: FenelType } };
  onChange: (t: FenelType) => void;
  beforeChange?: (next: FenelType) => boolean;
}) {
  function setField<K extends keyof typeof props.value.$opaque>(
    k: K,
    v: (typeof props.value.$opaque)[K],
  ) {
    props.onChange({ $opaque: { ...props.value.$opaque, [k]: v } });
  }

  return (
    <div class="tb-body tb-body--block">
      <div class="tb-body--inline">
        <span class="tb-body__label">nominal name:</span>
        <input
          class="tb-name-input mono"
          type="text"
          value={props.value.$opaque.name}
          placeholder="MyType"
          onInput={(e) => setField("name", e.currentTarget.value)}
        />
      </div>
      <label class="tb-body__label"><input type="checkbox" checked={props.value.$opaque.pure !== undefined} onChange={(e) => {
        if (e.currentTarget.checked) setField("pure", { $ref: "String" });
        else { const { pure, ...opaque } = props.value.$opaque; props.onChange({ $opaque: opaque }); }
      }} /> pure definition</label>
      <Show when={props.value.$opaque.pure}>
        <TypeBuilder value={props.value.$opaque.pure!} beforeChange={(t) => props.beforeChange?.({ $opaque: { ...props.value.$opaque, pure: t } }) !== false} onChange={(t) => setField("pure", t)} />
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bodies — recursive (μ)
// ---------------------------------------------------------------------------

function MuBody(props: {
  value: { $mu: { var: string; body: FenelType } };
  onChange: (t: FenelType) => void;
  beforeChange?: (next: FenelType) => boolean;
}) {
  return (
    <div class="tb-body tb-body--block">
      <div class="tb-body--inline">
        <span class="tb-body__label">recursion variable:</span>
        <input
          class="tb-name-input mono"
          type="text"
          value={props.value.$mu.var}
          placeholder="X"
          onInput={(e) =>
            props.onChange({ $mu: { ...props.value.$mu, var: e.currentTarget.value } })
          }
        />
        <button
          type="button"
          class="tb-add-btn tb-add-btn--sub"
          onClick={() =>
            props.onChange({ $mu: { ...props.value.$mu, body: { $var: props.value.$mu.var } } })
          }
        >
          insert recursive reference
        </button>
      </div>
      <span class="tb-body__label">body:</span>
      <TypeBuilder
        value={props.value.$mu.body}
        genericShadowed={props.value.$mu.var}
        beforeChange={(t) => props.beforeChange?.({ $mu: { ...props.value.$mu, body: t } }) !== false}
        onChange={(t) => props.onChange({ $mu: { ...props.value.$mu, body: t } })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bodies — function
// ---------------------------------------------------------------------------

const EL_MODES: { mode: ElMode; label: string }[] = [
  { mode: "sibling", label: "sibling" },
  { mode: "call", label: "call" },
  { mode: "if", label: "if" },
  { mode: "match", label: "match" },
  { mode: "expression", label: "expr" },
];

function ElBody(props: {
  value: { $el: Expression };
  onChange: (t: FenelType) => void;
  preferredMode?: ElMode;
}) {
  const [selectedMode, setSelectedMode] = createSignal<ElMode | null>(props.preferredMode ?? null);
  const currentMode = createMemo(() => detectElMode(props.value.$el));
  const mode = () => selectedMode() ?? currentMode();

  function setExpression(expr: unknown) {
    if (!expr || typeof expr !== "object" || Array.isArray(expr)) return;
    props.onChange({ $el: expr as Expression });
  }

  function chooseMode(next: ElMode) {
    if (next === mode()) return;
    setSelectedMode(next);
    if (next !== "expression") setExpression(defaultElExpressionForMode(next));
  }

  return (
    <div class="tb-body tb-body--block tb-el">
      <div class="tb-tabs" role="tablist" aria-label="dependent type expression mode">
        <For each={EL_MODES}>
          {(item) => (
            <button
              type="button"
              class={{
                "tb-tab": true,
                "tb-tab--active": mode() === item.mode,
              }}
              onClick={() => chooseMode(item.mode)}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
      <Switch>
        <Match when={mode() === "sibling"}>
          <ElSiblingBody value={props.value.$el} onChange={setExpression} />
        </Match>
        <Match when={mode() === "call"}>
          <LogicExprEditor value={props.value.$el} typeName="Type" paramName="type application" onChange={setExpression} />
        </Match>
        <Match when={mode() === "if"}>
          <LogicExprEditor value={props.value.$el} typeName="Type" paramName="conditional type" onChange={setExpression} />
        </Match>
        <Match when={mode() === "match"}>
          <LogicExprEditor value={props.value.$el} typeName="Type" paramName="matched type" onChange={setExpression} />
        </Match>
        <Match when={mode() === "expression"}>
          <div class="tb-el-panel">
            <span class="tb-body__label">expression returning Type:</span>
            <LogicExprEditor
              value={props.value.$el}
              typeName="Type"
              paramName="type expr"
              onChange={setExpression}
            />
          </div>
        </Match>
      </Switch>
      <ElShapeLens value={props.value.$el} onChange={setExpression} />
    </div>
  );
}

function ElSiblingBody(props: {
  value: Expression;
  onChange: (expr: Expression) => void;
}) {
  const recordValues = useContext(RecordValuesContext);
  const siblingNames = createMemo(() => Object.keys(recordValues()));
  const currentVar = createMemo(() => {
    if (props.value && typeof props.value === "object" && !Array.isArray(props.value)) {
      const v = (props.value as { var?: unknown }).var;
      if (typeof v === "string") return v;
    }
    return "";
  });

  function setVar(name: string) {
    props.onChange({ var: name });
  }

  return (
    <div class="tb-el-panel">
      <div class="tb-body--inline">
        <span class="tb-body__label">sibling type value:</span>
        <Show when={siblingNames().length > 0}>
          <LocusSelect
            class="mono"
            label="Sibling field"
            value={currentVar()}
            // Labels the trigger while the name is empty or typed by hand.
            fallbackOption={{ value: currentVar(), label: "pick sibling" }}
            options={locusSelectOptions(siblingNames())}
            minWidth="6rem"
            onChange={setVar}
          />
        </Show>
        <input
          class="tb-name-input mono"
          type="text"
          value={currentVar()}
          placeholder="type"
          onInput={(e) => setVar(e.currentTarget.value)}
        />
      </div>
    </div>
  );
}

function logicNode(value: unknown, session: AuthoringSession, names: string[] = []): ExprNode {
  try { return logicToExprNode(value ?? null, names, session); }
  catch { return { kind: "literal", value: value ?? null }; }
}

function LogicExprEditor(props: {
  value: unknown;
  onChange: (expr: unknown) => void;
  typeName?: string;
  paramName?: string;
}) {
  const session = useAuthoringSession();
  const genericScope = useContext(GenericTypeScopeContext);
  const inheritedParams = useContext(LambdaParamsContext);
  const [issue, setIssue] = createSignal("");
  const scopeProjection = createMemo(() => {
    try {
      const scope = genericScope();
      return { bindings: scope ? authoringGenericTypeBindings(scope).map(binding => ({ ...binding, bindingId: binding.id })) : [], issue: "" };
    } catch (error) {
      return { bindings: [], issue: error instanceof Error ? error.message : "Type parameter scope is unavailable." };
    }
  });
  const bindings = () => scopeProjection().bindings;
  const params = () => [...inheritedParams().filter(param => !bindings().some(binding => binding.name === param.name)), ...bindings()];
  const projectedNode = createMemo(() => {
    try {
      const scope = genericScope();
      const value = scope ? projectAuthoringGenericTypeApplication(scope, props.value, "editor") : props.value;
      return { node: logicNode(value, session, params().map(param => param.name)), issue: "" };
    } catch (error) {
      return { node: logicNode(props.value, session), issue: error instanceof Error ? error.message : "Type application is unavailable." };
    }
  });
  return (
    <LambdaParamsContext value={params}>
    <RunnerExpressionEditor
      expr={projectedNode().node}
      onChange={(next) => {
        try {
          const expression = toLogic(next, undefined, session);
          const scope = genericScope();
          const projected = scope ? projectAuthoringGenericTypeApplication(scope, expression, "type") : expression;
          setIssue("");
          props.onChange(projected);
        } catch (error) { setIssue(error instanceof Error ? error.message : "Type application is unavailable."); }
      }}
      typeName={props.typeName}
      paramName={props.paramName}
      authoringSession={session}
    />
    <Show when={issue() || scopeProjection().issue || projectedNode().issue}>
      <div class="tb-code-lens__error" role="alert">{issue() || scopeProjection().issue || projectedNode().issue}</div>
    </Show>
    </LambdaParamsContext>
  );
}

function ElShapeLens(props: {
  value: Expression;
  onChange: (expr: Expression) => void;
}) {
  const [err, setErr] = createSignal<string | null>(null);

  function apply(text: string) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setErr("shape must be an object");
        return;
      }
      setErr(null);
      props.onChange(parsed as Expression);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <details class="tb-code-lens">
      <summary>shape/code</summary>
      <textarea
        class="tb-code-lens__textarea mono"
        value={JSON.stringify(props.value ?? {}, null, 2)}
        spellcheck={false}
        onInput={(e) => apply(e.currentTarget.value)}
      />
      <Show when={err()}>
        <div class="tb-code-lens__error">{err()}</div>
      </Show>
    </details>
  );
}

// signature-substrate Phase 1 — the arrow face no longer authors `requires`:
// the `$arrow.requires` slot is RETIRED from the type constructor
// (`design/signatures-and-contracts.md` §6 — capability constraints are
// contract judgment 2, a property of `(function, scope)`, never part of the
// arrow VALUE type; values authored with the old editor arm were silently
// dropped by the loader, the exact capability-loss path the retirement
// closes). The capability-requirements editing surface re-homes on the
// function-spec/contract face (ux-parity item (4)/(5) + the P6 contract
// surface); the Constraint draft vocabulary stays in `type-builder-model.ts`.
function ArrowBody(props: {
  value: { $arrow: { params: FieldDef[]; returns: FenelType } };
  onChange: (t: FenelType) => void;
  beforeChange?: (next: FenelType) => boolean;
}) {
  const authoring = useFieldAuthoringContext();
  const params = () => props.value.$arrow.params ?? [];

  function setArrow(next: { params?: FieldDef[]; returns?: FenelType }) {
    props.onChange({ $arrow: { ...props.value.$arrow, ...next } });
  }

  function acceptParams(next: FieldDef[]) {
    return props.beforeChange?.({ $arrow: { ...props.value.$arrow, params: reindexPositionalTypeFields(next) } }) !== false;
  }
  function setParams(next: FieldDef[], accepted = false) {
    if (!accepted && !acceptParams(next)) return false;
    setArrow({ params: reindexPositionalTypeFields(next) });
    return true;
  }
  function addParam() {
    const n = params().length + 1;
    const field = createNewNamedFieldOccurrence(`arg${n}`);
    if (setParams([...params(), field])) authoring?.onFieldCreated?.(field);
  }

  return (
    <div class="tb-body tb-body--block">
      <span class="tb-body__label">params:</span>
      <For keyed={false} each={params()}>
        {(p, i) => (
          <FieldRow
            value={p()}
            beforeChange={(next) => acceptParams(params().map((x, j) => (j === i ? next : x)))}
            beforeRemove={() => acceptParams(params().filter((_, j) => j !== i))}
            onChange={(next) => setParams(params().map((x, j) => (j === i ? next : x)), true)}
            onRemove={() => setParams(params().filter((_, j) => j !== i), true)}
            onMoveUp={i > 0 ? () => setParams(moveTypeField(params(), i, i - 1)) : undefined}
            onMoveDown={i < params().length - 1 ? () => setParams(moveTypeField(params(), i, i + 1)) : undefined}
          />
        )}
      </For>
      <button type="button" class="tb-add-btn" onClick={addParam}>
        <IconPlus size={11} /> add param
      </button>
      <button type="button" class="tb-add-btn" onClick={() => setParams([...params(), newPositionalTypeField(params().length)])}>add positional param</button>
      <span class="tb-body__label">returns:</span>
      <TypeBuilder
        value={props.value.$arrow.returns}
        beforeChange={(t) => props.beforeChange?.({ $arrow: { ...props.value.$arrow, returns: t } }) !== false}
        onChange={(t) => setArrow({ returns: t })}
      />
    </div>
  );
}
