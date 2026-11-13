import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { FenelType, FieldDef, TypeScheme } from "@fenel/engine/types";
import { typePhrase, type ExprNode } from "@fenel/engine/authoring/expression";
import { ValueTypeCaption, valueCardLabel, valueCardTypeLabel } from "./value-card";
import { displayTypeLabel } from "./field-renderer/FieldRenderer";
import { Just, Nothing, List, peelMaybeValue, type Maybe } from "@fenel/engine/type-foundation";
import type { DataReadOccurrenceProps, TemplateComponentProps } from "./layout-renderer/LayoutRenderer";
import { TypedReadValue, typedReadTypePresentation } from "./layout-renderer/TypedReadValue";
import { webRegistry } from "./web-template-registry";
import { lensPolicyData } from "./lens-shortcuts";
import { policyCandidate } from "./data-suggestions";
import type { DataInspectionSuggestions, SuggestionPreview } from "./DataInspectionDialog";
import type { DataSuggestion, SuggestionDisposition } from "./data-suggestions";
import { LocusLoadFailure } from "./locus-notifications";
import { DataOccurrenceBoundary, type DataOccurrenceSource } from "./data-occurrence";
import { useReaderRuntime, type ReaderRuntime } from "./reader-runtime";
import { IconByName, LUCIDE_BY_NAME } from "./icons";
import { suggestionRowMark } from "./suggestion-row-mark";
import { createGroupingPresentation } from "./grouping-read";
import { suggestionLensChip } from "./grouping-lens";
import { FieldLabel, FieldRenderer, PlainFieldsContext } from "./field-renderer/FieldRenderer";
import { FieldPresentationRegistryProvider } from "./field-renderer/field-presentation-context";
import { inlineWidgetFor } from "./expression-runner/inline-widgets";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import { createLocalLensPolicy, localEditorSession } from "./expression-runner/local-editor-reads";
import type { DataSuggestionBatch } from "./data-suggestions";
import { sentenceRepeatsLabel } from "./suggestion-wording";
import { openParameterFields, parameterLabel, suggestionInputField, suggestionInputsLayout,
  type SuggestionArgument, type SuggestionParameter } from "./suggestion-inputs";
import { SUGGESTION_PATIENCE_MS, presentationCandidate, settledRowCount, type RowWait } from "./suggestion-settle";
import "./expression-runner/simple-data-form.css";

type SuggestionPresentation = { $tag: "SuggestionPresentation"; identity: string; label: string;
  resultType: Maybe<FenelType>; remainingArguments: number; detail: string; reasons: string[]; confirmed: boolean };


/** Browser row state, owned by the row chrome. (A context does not reach the
 * registered body: the typed list renders that body in its own owner.) */
type SuggestionRowState = {
  arguments: () => readonly SuggestionArgument[];
  parameters: () => readonly SuggestionParameter[];
  values: () => readonly (ExprNode | undefined)[];
  setValue: (index: number, node: ExprNode | undefined) => void;
  preview: () => SuggestionPreview | undefined;
  reasonsOpen: () => boolean;
};

const previewOccurrence: DataOccurrenceSource = { state: "unavailable", issue: "Apply this action to use its result." };

/** The result: the actual computed value when its pure preview is ready, else
 * the result type's own caption, which stays inspectable data at its path.
 * A row that already says what it computes (its sentence) shows no type
 * caption while the preview is computed (polish lane B item 6). */
function SuggestionResult(props: { value: SuggestionPresentation; pending?: boolean; ready?: { value: unknown };
  occurrence?: DataOccurrenceSource; dataPath?: readonly (string | number)[]; sentence?: boolean;
  /** A Suggestions row names the result type beside its title (owner review,
   * Nov 11): its result shows only the computed value, never a pending mark
   * (Rom, Nov 12: the panel shows a row once it is final; see suggestion-settle.ts). */
  typeInTitle?: boolean;
  onDataContext?: DataReadOccurrenceProps["onDataContext"] }) {
  const resultType = createMemo(() => props.sentence ? undefined : peelMaybeValue<FenelType>(props.value.resultType));
  return <div class="suggestion-card-body__result" aria-live="polite">
    <Show when={props.ready} fallback={props.typeInTitle ? undefined : <Show when={resultType()}>{type =>
      <DataOccurrenceBoundary value={type()} type={{ $type: true }} label="Result type" occurrence={props.occurrence}
        dataPath={[...(props.dataPath ?? []), "resultType", "_0"]} onDataContext={props.onDataContext}>
        <ResultTypeCaption type={type()} pending={props.pending} />
      </DataOccurrenceBoundary>}</Show>}>
      {ready => <TypedReadValue value={ready().value} type={resultType() ?? undefined} compact occurrence={previewOccurrence} dataPath={[]} />}
    </Show>
  </div>;
}

/** The registered read presentation of one suggestion: its result type and
 * reasons as ordinary data. A Suggestions row shows its own live result,
 * inputs and reasons beside it (see SuggestionRowExtras). */
function SuggestionCardBody(props: DataReadOccurrenceProps & { value: SuggestionPresentation }) {
  return <div class="suggestion-card-body">
    <SuggestionResult value={props.value} occurrence={props.occurrence} dataPath={props.dataPath} onDataContext={props.onDataContext} />
    <Show when={props.value.detail}><p class={["suggestion-card-body__detail", { "suggestion-card-body__detail--sentence": props.value.confirmed }]}>{props.value.detail}</p></Show>
    <Show when={props.value.reasons.length}><details class="suggestion-card-body__why"><summary>Why suggested</summary>
      <For each={props.value.reasons}>{reason => <p>{reason}</p>}</For>
    </details></Show>
  </div>;
}

/** A row's live parts: the computed result, inline inputs and reasons. */
function SuggestionRowExtras(props: { state: SuggestionRowState; value: SuggestionPresentation;
  occurrence?: DataOccurrenceSource; dataPath?: readonly (string | number)[] }) {
  const ready = createMemo(() => { const preview = props.state.preview(); return preview?.state === "ready" ? preview : undefined; });
  // The sentence, then the live result below it once ready (Rom, Q9). A
  // sentence that only repeats the row's title is not shown (Rom, Nov 11);
  // the row still counts as "says what it computes" for the result caption.
  const sentence = () => props.value.confirmed && props.value.detail ? props.value.detail : undefined;
  const shownSentence = () => { const text = sentence(); return text && !sentenceRepeatsLabel(text, props.value.label) ? text : undefined; };
  const inputs = createMemo(() => suggestionInputsLayout(props.state.parameters(), props.state.arguments().length));
  return <div class="suggestion-card-body">
    <Show when={shownSentence()}>{text => <p class="suggestion-card-body__sentence">{text()}</p>}</Show>
    <SuggestionResult value={props.value} ready={ready()} pending={props.state.preview()?.state === "pending"}
      occurrence={props.occurrence} dataPath={props.dataPath} sentence={!!sentence()} typeInTitle />
    <Show when={inputs().fields.length ? inputs() : undefined}>{layout =>
      <SuggestionInputsForm fields={layout().fields} state={props.state} />}
    </Show>
    <Show when={props.state.reasonsOpen() && props.value.reasons.length}>
      <div class="suggestion-card-body__reasons"><For each={props.value.reasons}>{reason => <p>{reason}</p>}</For></div>
    </Show>
  </div>;
}

/** A suggested function's remaining inputs as a record's fields (Rom, Nov 12:
 * "function parameters are a bit like a record"): the rows of the New data
 * simple form (`simple-data-form.css`), each input's label beside the editor
 * its type calls for (FieldRenderer, with its own hint), in the plain form's
 * context (no type pills, no representation toggle). The data the suggestion
 * applies to is not an input and is not shown. An input with no inline editor
 * stays with the expression editor. One form for every suggestion. */
function SuggestionInputsForm(props: { fields: readonly { name: string; open: number }[]; state: SuggestionRowState }) {
  return <PlainFieldsContext value={true}><div class="simple-data-form suggestion-inputs-form" role="group" aria-label="Inputs">
    <For each={props.fields}>{open => {
      const index = () => open.open;
      const argument = createMemo(() => props.state.arguments()[index()]);
      const field = createMemo(() => { const current = argument(); return current ? suggestionInputField(current) : undefined; });
      const label = () => { const current = argument(); return current ? parameterLabel(current) : parameterLabel({ name: open.name }); };
      // The label is transient like its field: it never reads account field identity.
      return <div class="simple-data-form__row" data-field={open.name}>
        <div class="simple-data-form__label">
          <Show when={field()} fallback={<span class="fr-label"><span class="fr-label__name">{label()}</span></span>}>
            {declared => <FieldPresentationRegistryProvider registry={undefined}><FieldLabel field={declared()} name={label()} typeName="" /></FieldPresentationRegistryProvider>}
          </Show>
        </div>
        <div class="simple-data-form__input">
          <Show when={field()} fallback={<span class="suggestion-card-body__argument-open">Open the expression to fill this</span>}>
            {declared => <FieldPresentationRegistryProvider registry={undefined}>
              <FieldRenderer identityMode="transient" compact field={declared()}
                value={(props.state.values()[index()] as { value?: unknown } | undefined)?.value}
                onChange={value => props.state.setValue(index(), value === undefined || value === "" ? undefined : { kind: "literal", value } as ExprNode)} />
            </FieldPresentationRegistryProvider>}
          </Show>
        </div>
      </div>;
    }}</For>
  </div></PlainFieldsContext>;
}

/** The result type's own caption (the reader's type presentation), shown
 * while the computed result is pending or when no preview is available. */
function ResultTypeCaption(props: { type: FenelType; pending?: boolean }) {
  const reader = useReaderRuntime();
  const presented = createMemo(() => resultTypePresentation(props.type, reader));
  const label = () => presented().label;
  return <span class={["suggestion-card-body__type", { "suggestion-card-body__type--pending": !!props.pending }]}
    role={props.pending ? "status" : undefined} aria-label={props.pending ? `Computing: ${valueCardTypeLabel(label())}` : undefined}>
    <ValueTypeCaption label={label()} icon={presented().icon} />
  </span>;
}

/** The result type as the app presents a value of that type: its label, and
 * its icon (a Local reader's from its worker, undefined while pending; other
 * readers' from the same typed-read presentation their cards use, when the
 * row's session is given). */
function resultTypePresentation(type: FenelType, reader: ReaderRuntime | undefined, session?: AuthoringSession): { label: string; icon?: string } {
  const local = reader?.kind === "local" ? reader.typePresentation?.(type) : undefined;
  let icon = local?.icon;
  if (reader?.kind !== "local" && session) {
    try { icon = typedReadTypePresentation(type, session, reader).icon; } catch { icon = undefined; }
  }
  const label = local?.label || typePhrase(type, handle => valueCardLabel(reader?.presentation(handle)?.label)
    || reader?.presentation(handle)?.codeName || handle) || displayTypeLabel(type);
  return { label, icon };
}

webRegistry.registerComponent("suggestion-card", (props: TemplateComponentProps) =>
  <SuggestionCardBody value={props.value as SuggestionPresentation}
    occurrence={props.occurrence} dataPath={props.dataPath} onDataContext={props.onDataContext} />);

/** A direct plan's open inputs in slot order, with the instantiated types the
 * whole-expression check inferred for them. Only scalar literal widgets are
 * offered inline; any other input stays with the expression editor. */
function suggestionArguments(candidate: DataSuggestion | undefined, session: AuthoringSession | undefined): SuggestionArgument[] {
  if (!candidate || !(candidate.missingArguments > 0)) return [];
  const plan = candidate.plan as { $tag: string; operation?: { paramNames?: string[]; payload?: { functionId?: string } };
    inputIndex?: number; missingNames?: string[] };
  const names = plan.$tag === "SuggestionPlan" && plan.operation?.paramNames
    ? plan.operation.paramNames.filter((_, index) => index !== plan.inputIndex) : plan.missingNames ?? [];
  const schemes: readonly (TypeScheme | undefined)[] = candidate.argumentSchemes ?? [];
  // The function's own declaration of each open input (its authored label).
  let declared: (FieldDef | undefined)[] = [];
  if (plan.$tag === "SuggestionPlan" && plan.operation?.paramNames && plan.inputIndex !== undefined && session) {
    const functionId = plan.operation.payload?.functionId;
    try {
      const entry = functionId ? session.environment.getFunctionEntry?.(functionId) as { params?: readonly FieldDef[] } | undefined : undefined;
      declared = openParameterFields(plan.operation.paramNames, plan.inputIndex, entry?.params);
    } catch { declared = []; }
  }
  return Array.from({ length: candidate.missingArguments }, (_, index) => {
    const raw = names[index];
    const name = !raw || raw === "_" || /^_\d+$/.test(raw) || /^argument\d+$/.test(raw) ? `input ${index + 1}` : raw;
    const scheme = schemes[index];
    let type: FenelType | undefined;
    try {
      const widget = scheme && scheme.quantified.length === 0 && session ? inlineWidgetFor(scheme.body, undefined, session.environment) : undefined;
      type = widget?.kind === "scalar" ? widget.type : undefined;
    } catch { type = undefined; }
    const field = declared[index];
    return { name, ...(type ? { type } : {}), ...(field ? { field } : {}) };
  });
}

/** A direct plan's inputs in order, marking the selected data's own slot, so
 * `+` on 42 reads "a: this data, b: [ ]" rather than "+ (a)". */
function suggestionParameters(candidate: DataSuggestion | undefined, open: readonly SuggestionArgument[]): SuggestionParameter[] {
  if (!candidate || !open.length) return [];
  const plan = candidate.plan as { $tag: string; operation?: { paramNames?: string[] }; inputIndex?: number };
  if (plan.$tag !== "SuggestionPlan" || !plan.operation?.paramNames || plan.operation.paramNames.length !== open.length + 1)
    return open.map((argument, index) => ({ name: argument.name, subject: false, open: index }));
  let next = 0;
  return plan.operation.paramNames.map((raw, index) => index === plan.inputIndex
    ? { name: !raw || raw === "_" || /^_\d+$/.test(raw) ? "input" : raw, subject: true as const }
    : { name: open[next]!.name, subject: false as const, open: next++ });
}

/** Shared list/body owners supply the UX. A row applies its checked action
 * through the owner's existing selection port in one click; Open expression
 * opens the same recipe for editing; Why keeps the checker's reasons. */
export function SuggestionReadPanel(props: { owner: DataInspectionSuggestions }) {
  const reader = useReaderRuntime();
  const input = (candidate: DataSuggestion) => ({ $tag: "SuggestionPresentationInput", candidate: presentationCandidate(policyCandidate(candidate)),
    resultType: candidate.resultScheme ? Just(candidate.resultScheme.body) : Nothing, sentence: candidate.sentence ?? "" });
  const batchInput = (batch: DataSuggestionBatch) => ({ $tag: "SuggestionPresentationBatch",
    suggestions: batch.suggestions.map(input), undecided: batch.undecided.map(input) });
  // B4 wave 4 lane E: a Local reader's rows and their declaration come from
  // its worker (`project-reader-lens-policy`); its page registry and frame are
  // never read. A spinner shows while they are asked.
  const localRead = () => { const read = props.owner.read(); return read && localEditorSession(reader, read.session) ? read : undefined; };
  const localRows = reader?.kind === "local" ? createLocalLensPolicy(() => reader, () => localRead()?.session ?? reader.session(), () => {
    const read = localRead();
    return read ? { policy: "suggestionPanelRows", args: [batchInput(read.batch)] } : undefined;
  }) : undefined;
  const projection = createMemo(() => {
    const read = props.owner.read();
    if (!read) return undefined;
    if (localRows && localRead()) {
      const answer = localRows.answer();
      if (!answer) return undefined;
      if (answer.$tag === "Err") throw new Error(answer._0);
      return { ...read, rows: answer._0.value as SuggestionPresentation[], type: List({ $ref: answer._0.declarationId }) };
    }
    const declaration = read.session.registry.getIdentifiedEntity("view.SuggestionPresentation")
      ?? read.session.registry.getIdentifiedEntity("SuggestionPresentation");
    if (!declaration) throw new Error("Suggestion data is unavailable in this reader. Retry after preparing its current tools.");
    const rows = lensPolicyData<SuggestionPresentation[]>(read.session, "suggestionPanelRows", batchInput(read.batch));
    return { ...read, rows, type: List({ $ref: declaration.id }) };
  });
  const candidateFor = (identity: string) => props.owner.read()?.batch.suggestions.find(candidate => candidate.identity === identity);
  // The settle rule (Rom, Nov 12; suggestion-settle.ts): the panel asks every
  // row's preview itself, in ranked order, and shows a row once it and every
  // row above it are final. Past the patience every row shows, without a
  // spinner. A row's own filled-in inputs never hide it again.
  const [patienceOver, setPatienceOver] = createSignal<object>();
  createEffect(() => props.owner.read()?.batch, batch => {
    if (!batch) return;
    const timer = setTimeout(() => setPatienceOver(batch), SUGGESTION_PATIENCE_MS);
    return () => clearTimeout(timer);
  });
  let shown: { batch: object; count: number } | undefined;
  const shownCount = createMemo(() => {
    const read = projection();
    if (!read) return 0;
    const waits = read.rows.map((row): RowWait => {
      const candidate = candidateFor(row.identity);
      if (!candidate || !props.owner.preview || candidate.missingArguments > 0) return "settled";
      return props.owner.preview(candidate)?.state === "pending" ? "waiting" : "settled";
    });
    const count = settledRowCount(waits, { patienceOver: patienceOver() === read.batch,
      shownBefore: shown?.batch === read.batch ? shown.count : 0 });
    shown = { batch: read.batch, count };
    return count;
  });
  const shownRows = createMemo(() => { const read = projection(); return read ? read.rows.slice(0, shownCount()) : []; });
  // One quiet line while nothing is final yet: no spinner beside finished rows.
  const checking = () => props.owner.pending() || !!(localRows && localRead() && !localRows.answer() && !localRows.failure())
    || !!projection()?.rows.length && shownCount() === 0;
  return <div class="related-data-panel related-data-panel--actions">
    <Show when={checking()}><p class="related-data-panel__status" role="status">Checking suggestions…</p></Show>
    <Show when={localRows && localRead() ? localRows.failure() : undefined}>{failure => <LocusLoadFailure
      message="Could not prepare suggestions." detail={failure()} retry={() => localRows!.retry()} />}</Show>
    <Show when={props.owner.issue()}>{issue => <LocusLoadFailure message="Could not prepare suggestions." detail={issue()}
      retry={() => props.owner.open()} />}</Show>
    <Show when={projection()}>{read => <>
      <Show when={shownRows().length > 0}>
      <TypedReadValue detail value={shownRows()} type={read().type} occurrence={read().source} dataPath={[]}
        renderChild={(child, render) => {
          const row = () => child.value as SuggestionPresentation;
          if (child.path.length !== 1) return render();
          const candidate = createMemo(() => candidateFor(row().identity));
          const argumentsOf = createMemo(() => suggestionArguments(candidate(), props.owner.read()?.session));
          const [values, setValues] = createSignal<readonly (ExprNode | undefined)[]>([]);
          const [reasonsOpen, setReasonsOpen] = createSignal(false);
          const filled = createMemo(() => {
            const count = argumentsOf().length;
            const current = values();
            return count > 0 && argumentsOf().every(argument => !!argument.type)
              && Array.from({ length: count }, (_, index) => current[index]).every(Boolean)
              ? current.slice(0, count) as ExprNode[] : undefined;
          });
          const parametersOf = createMemo(() => suggestionParameters(candidate(), argumentsOf()));
          const state: SuggestionRowState = {
            arguments: argumentsOf, parameters: parametersOf, values,
            setValue: (index, node) => setValues(previous => { const next = [...previous]; next[index] = node; return next; }),
            preview: () => {
              const selected = candidate();
              if (!selected || !props.owner.preview) return undefined;
              if (selected.missingArguments > 0) { const args = filled(); return args ? props.owner.preview(selected, args) : undefined; }
              return props.owner.preview(selected);
            },
            reasonsOpen,
          };
          // One click applies a complete recipe (or one whose inline inputs are
          // filled) by its default destination (demo 1): Apply here when its
          // result fits this data's type, else New data from this. Any other
          // opens its expression.
          const complete = () => { const selected = candidate(); return !!selected && (selected.missingArguments === 0 || !!filled()); };
          const applyAs = (disposition: SuggestionDisposition) => {
            const selected = candidate();
            if (!selected) return;
            if (selected.missingArguments === 0) props.owner.select(selected, { evaluate: true, disposition });
            else { const args = filled(); props.owner.select(selected, args ? { evaluate: true, arguments: args, disposition } : undefined); }
          };
          const defaultOf = () => { const selected = candidate(); return selected && props.owner.defaultDisposition
            ? props.owner.defaultDisposition(selected) : selected?.disposition ?? "CreateDerivedData"; };
          const apply = () => applyAs(defaultOf());
          // The other destination of an Apply-here row stays one click away
          // where the source supports both (not in the expression editor).
          const appliesHere = () => defaultOf() === "ApplyToDraft" && complete();
          const offersNewData = () => appliesHere() && (props.owner.dispositions?.() ?? ["CreateDerivedData"]).includes("CreateDerivedData");
          const open = () => { const selected = candidate(); if (selected) props.owner.select(selected); };
          // Owner review (Nov 11): the row leads with the icon of the type the
          // function returns for this data, never a function glyph nor the
          // function's own @icon; that type's name is a quiet chip by the title.
          const mark = createMemo(() => {
            const type = peelMaybeValue<FenelType>(row().resultType) ?? undefined;
            return suggestionRowMark(type, type ? resultTypePresentation(type, reader, props.owner.read()?.session) : undefined, LUCIDE_BY_NAME);
          });
          // The lens the result opens in, when it says more than its type
          // (owner review, Nov 11): the same view.groupingPresentation answer
          // and GROUPING_LAYOUT table Home opens derived data by.
          const grouping = createGroupingPresentation(() => { const preview = state.preview(); return preview?.state === "ready" ? preview.value : undefined; });
          const lens = createMemo(() => suggestionLensChip(grouping()));
          const title = () => {
            const plan = candidate()?.plan as { $tag?: string; operation?: { label?: string; paramNames?: string[] } } | undefined;
            // Inline inputs name the open slots, so a direct plan shows its operation's own label.
            return plan?.$tag === "SuggestionPlan" && plan.operation?.label && argumentsOf().every(argument => !!argument.type)
              ? plan.operation.label : row().label;
          };
          return <DataOccurrenceBoundary value={row()} type={child.getType()} label={row().label}
            occurrence={read().source} dataPath={child.path}>
            <div class={["suggestion-row", { "suggestion-row--unconfirmed": !row().confirmed }]} data-suggestion-identity={row().identity}>
                <button type="button" class="suggestion-row__apply" disabled={!row().confirmed}
                  aria-label={argumentsOf().length && !filled() ? `${title()}: open its expression` : `Apply ${title()}`}
                  data-tooltip={!complete() ? undefined : appliesHere() ? "Apply here: replace this data with the result" : "New data from this, kept up to date"}
                  onClick={apply}>
                  <span class={["suggestion-row__glyph", { "suggestion-row__glyph--none": !mark().icon }]} aria-hidden="true">
                    <Show when={mark().icon}>{icon => <IconByName name={icon()} size={14} />}</Show>
                  </span>
                  <span class="suggestion-row__label">{title()}</span>
                  <Show when={mark().typeLabel}>{label => <span class="suggestion-row__type">{valueCardTypeLabel(label())}</span>}</Show>
                  <Show when={lens()}>{option => <>
                    <span class="suggestion-row__lens-separator" aria-hidden="true">·</span>
                    <span class="suggestion-row__lens"><IconByName name={option().icon} size={12} /><span>{option().label}</span></span>
                  </>}</Show>
                </button>
                <span class="suggestion-row__tools">
                  <Show when={row().reasons.length}>
                    <button type="button" class="suggestion-row__tool" aria-label="Why suggested" data-tooltip="Why suggested"
                      aria-expanded={reasonsOpen() ? "true" : "false"} onClick={() => setReasonsOpen(open => !open)}>
                      <IconByName name="info" size={13} />
                    </button>
                  </Show>
                  <Show when={offersNewData()}>
                    <button type="button" class="suggestion-row__tool" aria-label="New data from this" data-tooltip="New data from this (keeps this data)"
                      disabled={!row().confirmed} onClick={() => applyAs("CreateDerivedData")}><IconByName name="plus" size={13} /></button>
                  </Show>
                  <button type="button" class="suggestion-row__tool" aria-label="Open expression" data-tooltip="Open expression"
                    disabled={!row().confirmed} onClick={open}><IconByName name="code" size={13} /></button>
                </span>
                <div class="suggestion-row__body">
                  <SuggestionRowExtras state={state} value={row()} occurrence={read().source} dataPath={child.path} />
                  {render()}
                </div>
              </div>
          </DataOccurrenceBoundary>;
        }} />
      </Show>
      <Show when={!read().rows.length}><p class="related-data-panel__status">No confirmed suggestions in this check.</p></Show>
      {/* Polish lane 2 (Nov 9): no operation counts (developer text); a
          partial check is said in people's words only when it happened. */}
      <Show when={shownCount() === read().rows.length && (read().batch.coverage.truncated || read().batch.coverage.skipped
        || read().batch.omittedConfirmed || read().batch.omittedUndecided)}>
        <p class="related-data-panel__status related-data-panel__coverage">Some operations or suggestions are not shown yet.</p>
      </Show>
    </>}</Show>
  </div>;
}
