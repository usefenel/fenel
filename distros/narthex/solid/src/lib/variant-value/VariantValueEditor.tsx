// ---------------------------------------------------------------------------
// VariantValueEditor — generic editor for any recursive ADT value
//
// Editable counterpart of VariantValueRenderer. Walks the FenelType, renders
// inputs for each field, and cascades onChange up the tree.
//
// Dispatch by type shape:
//   $variant / $mu → case picker + fields of the selected case (recursive)
//   $list          → array editor with insert/remove/move + per-item editor
//   $record        → field editors stacked
//   $named         → primitive input (string / number / boolean / json)
//   $var           → resolved against the surrounding μ binding
//
// Mutation is purely functional: each control receives an `onChange(next)`
// that propagates a new value up. All actual mutations live in `ops.ts` so
// other surfaces (e.g. MarkupEditor) can drive the same operations.
//
// Selection: pass `selectedPath` to highlight a node, `onSelectPath` to be
// notified when the user clicks one. Used to coordinate side-by-side views.
// ---------------------------------------------------------------------------

import { Show, For, Switch, Match, createMemo, createSignal, createEffect, onSettled, latest, untrack } from "solid-js";
import { structuralView } from "@fenel/engine";
import type { FenelType, FieldDef, Expression } from "@fenel/engine/types";
import { peelListForAuthoring as peelList, variantValueDiscriminator, isNativeValueRepresentation } from "@fenel/engine/authoring/type";
import { unfold } from "@fenel/engine/set-algebra";
import { TypeBuilder } from "../type-builder/TypeBuilder";
import { ExpressionEditor, logicToExprNode, toLogic, LambdaParamsContext } from "../expression-runner";
import { useAuthoringSession } from "../expression-runner/authoring-session";
import type { AuthoringSession } from "../expression-runner/account-authoring-session";
import { FieldRenderer, resolveElInType, createReaderRecordOperations, createReaderInteractionGuard } from "../field-renderer/FieldRenderer";
import { useFieldPresentationRegistry } from "../field-renderer/field-presentation-context";
import { StringInputSurface } from "../field-renderer/string-input-surface";
import { Nothing, refHandle } from "@fenel/engine/type-foundation";
import { runtimeRepresentationNativeContext, type EvaluateContext } from "../../../../../../implementations/typescript/engine/src/json-logic";
import { exactTransportKey } from "../../../../../../implementations/typescript/engine/src/registry-transport";
import { validateValue } from "@fenel/engine/validation";
import { frameAccount } from "@fenel/engine/authority";
import { fieldTypeLabelPlan, fieldUnionBranchSelectionPlan } from "@fenel/engine/authoring/field-render";
import { NumberInput } from "../number-input";
import { numericTextCodec } from "../numeric-text-codec";
import { fieldNumericTextCodecPlan } from "@fenel/engine/authoring/field-render";
import { useReaderRuntime } from "../reader-runtime";
import { LocusSelect } from "../locus-select";
import { createAsyncValue } from "../async-value";
import { authoringWorkerReplacementPending, preparedReaderWorkerForSession, runPreparedReaderWorker, type PreparedReaderWorker } from "../expression-runner/authoring-catalog-worker";
import { localGuidanceCapture, localGuidanceCurrent, sameLocalGuidanceCapture } from "../expression-runner/live-guidance-local";
import { createLocalDependentType, createLocalUnionBranch } from "../expression-runner/local-editor-reads";
import type { NativeRepresentationQuery, NativeRepresentationResultOf } from "../expression-runner/authoring-worker-reader-extensions";
import { createNativeRepresentation, editNativeRepresentation, projectNativeRepresentation, NATIVE_REPRESENTATION_CREATE_REFUSED,
  NATIVE_REPRESENTATION_EDIT_REFUSED, NATIVE_REPRESENTATION_UNAVAILABLE, NATIVE_REPRESENTATION_CHANGED,
  NATIVE_REPRESENTATION_TOOLS_UNAVAILABLE, type NativeRepresentationFrame,
  type NativeRepresentationMode } from "./native-representation";
import type { AuthoringReaderNumericCodec } from "../expression-runner/authoring-worker-protocol";
import {
  defaultValueFor,
  nativeValueTypeName,
  resolveValueType,
  insertAtIndex,
  removeAtIndex,
  moveItem,
  type Path,
} from "./ops";
import "./variant-value-editor.css";

export type VariantValueEditorProps = {
  type: FenelType;
  value: unknown;
  onChange: (next: unknown) => void;
  /** Absolute path of this editor in the surrounding tree. Defaults to []. */
  path?: Path;
  /** Currently selected path (for highlighting + side-by-side coordination). */
  selectedPath?: Path;
  /** Called when the user clicks a node header. */
  onSelectPath?: (path: Path) => void;
  /** Optional label rendered above the editor. */
  label?: string;
};

/**
 * Top-level editor — accepts the absolute root type and value. Internally
 * delegates to ValueEditor which handles the type-shape dispatch.
 */
export function VariantValueEditor(props: VariantValueEditorProps) {
  const path = () => props.path ?? [];
  return (
    <div class="vve-root">
      <Show when={props.label}>
        <div class="vve-label">{props.label}</div>
      </Show>
      <ValueEditor
        type={props.type}
        value={props.value}
        onChange={props.onChange}
        path={path()}
        selectedPath={props.selectedPath}
        onSelectPath={props.onSelectPath}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type binding — substitute $var references against a surrounding μ
// ---------------------------------------------------------------------------

function bindVar(t: FenelType, varName: string, mu: FenelType): FenelType {
  if ("$var" in t) return t.$var === varName ? mu : t;
  if ("$map" in t) return { $map: { keys: t.$map.keys, values: bindVar(t.$map.values, varName, mu) } };
  if ("$tuple" in t) return { $tuple: t.$tuple.map((x) => bindVar(x, varName, mu)) };
  if ("$record" in t) {
    return {
      $record: {
        fields: t.$record.fields.map((f) => ({ ...f, type: bindVar(f.type, varName, mu) })),
      },
    };
  }
  if ("$variant" in t) {
    return {
      $variant: {
        cases: t.$variant.cases.map((c) => ({
          ...c,
          fields: c.fields?.map((f) => ({ ...f, type: bindVar(f.type, varName, mu) })),
        })),
      },
    };
  }
  if ("$mu" in t && t.$mu.var === varName) return t; // shadowed binding wins
  if ("$mu" in t) return { $mu: { ...t.$mu, body: bindVar(t.$mu.body, varName, mu) } };
  // $el (the unified dependent-type substrate) carries an Expression — its
  // sub-types live inside JSON-Logic AST nodes (e.g. literal branches of an
  // `if`), which `bindVar` doesn't traverse. Same posture as the legacy
  // `$depend` / `$dep` / `$apply` / `$app` constructors that collapsed into `$el`.
  if ("$refined" in t) return { $refined: { ...t.$refined, base: bindVar(t.$refined.base, varName, mu) } };
  if ("$tagged" in t) return { $tagged: { value: bindVar(t.$tagged.value, varName, mu), phantom: t.$tagged.phantom } };
  if ("$opaque" in t && t.$opaque.pure) return { $opaque: { ...t.$opaque, pure: bindVar(t.$opaque.pure, varName, mu) } };
  if ("$union" in t) return { $union: t.$union.map((branch) => bindVar(branch, varName, mu)) };
  if ("$intersect" in t) return { $intersect: t.$intersect.map((branch) => bindVar(branch, varName, mu)) };
  if ("$complement" in t) return { $complement: bindVar(t.$complement, varName, mu) };
  if ("$arrow" in t) return { $arrow: { ...t.$arrow, params: t.$arrow.params.map((field) => ({ ...field, type: bindVar(field.type, varName, mu) })), returns: bindVar(t.$arrow.returns, varName, mu) } };
  return t;
}

// ---------------------------------------------------------------------------
// ValueEditor — dispatches on the resolved type shape
// ---------------------------------------------------------------------------

type ValueEditorProps = {
  raw?: boolean;
  recursiveOwner?: FenelType;
  evaluateContext?: EvaluateContext;
  /** Host-only provenance for the existing native lexical frame. Only its
   * inert type name can enter a worker request, after exact context matching.
   * Without `evaluateContext` (a Local reader, B4 wave 1 lane B), the frame is
   * selected by name in the reader's worker and matches only while no
   * explicit `evaluateContext` is in force. */
  nativeRecordContext?: { representationTypeName: string; evaluateContext?: EvaluateContext };
  recordValues?: Record<string, unknown>;
  type: FenelType;
  value: unknown;
  onChange: (next: unknown) => void;
  path: Path;
  selectedPath?: Path;
  onSelectPath?: (path: Path) => void;
};

function ValueEditor(props: ValueEditorProps) {
  const authoring = useAuthoringSession();
  const reader = useReaderRuntime();
  const frame = () => reader?.session() ?? authoring;
  const raw = () => props.raw || "$ref" in props.type && (props.type.$ref === "Any" || props.type.$ref === "Value");
  const dependent = () => !raw() && !(props.value instanceof Uint8Array) && "$el" in props.type && !!props.recordValues;
  // B4 wave 4 lane E: a Local reader's own session resolves a `$el` type in
  // its worker (`resolve-reader-dependent-type`); its page frame is never read.
  // Until answered the type stays unresolved (no guessed type).
  const localDependent = reader?.kind === "local" ? createLocalDependentType(() => reader, frame,
    () => dependent() ? { type: props.type, values: props.recordValues! } : undefined) : undefined;
  const dependentPending = () => !!localDependent && dependent() && !localDependent.answer() && !localDependent.failure();
  const type = createMemo(() => {
    if (raw() || props.value instanceof Uint8Array) return props.type;
    const resolved = "$el" in props.type && props.recordValues
      ? localDependent ? localDependent.answer()?.resolved ?? props.type : resolveElInType(props.type, props.recordValues, frame())
      : props.type;
    return resolveValueType(resolved, (name) => frame().environment.resolveNamedType?.(name));
  });
  const native = createMemo(() => raw() ? undefined : nativeValueTypeName(type()));
  const list = createMemo(() => raw() || native() ? null : peelList(type()));
  const view = createMemo(() => raw() || native() || list() ? null : structuralView(type()));
  return (
    <>
    <Show when={"$el" in type()}><p class="text-muted" role="status">{dependentPending() ? "Preparing this data's type…"
      : "This data's type could not be resolved for this reader. Choose its type data before editing this field."}</p></Show>
    <Show when={raw()} fallback={
    <Show
      when={view()}
      fallback={<NonVariantEditor {...props} type={type()} />}
    >
      {(v) => (
        <VariantBody
          view={v()}
          type={type()}
          value={props.value}
          onChange={props.onChange}
          path={props.path}
          selectedPath={props.selectedPath}
          onSelectPath={props.onSelectPath}
          recursiveOwner={props.recursiveOwner}
          evaluateContext={props.evaluateContext}
          nativeRecordContext={props.nativeRecordContext}
        />
      )}
    </Show>
    }><RawValueBody {...props} /></Show>
    </>
  );
}

// ---------------------------------------------------------------------------
// VariantBody — case picker + fields of the selected case
// ---------------------------------------------------------------------------

type VariantBodyProps = ValueEditorProps & {
  view: ReturnType<typeof structuralView> & object;
};

function VariantBody(props: VariantBodyProps) {
  const authoring = useAuthoringSession();
  const reader = useReaderRuntime();
  const frame = () => reader?.session() ?? authoring;
  // B4 F1: a Local reader's own record frame is its worker's; only an
  // explicitly supplied frame travels, and the page session is never read.
  const context = () => props.evaluateContext ?? (reader?.kind === "local" ? undefined : frame().evaluateContext);
  const [editError, setEditError] = createSignal<string>();
  const discriminator = () => variantValueDiscriminator(props.type);
  const obj = () => props.value && typeof props.value === "object" ? props.value as Record<string, unknown> : {};
  const publication = createMemo(() => ({ callback: props.onChange }));
  const record = createReaderRecordOperations(() => ({ value: obj(),
    fields: [discriminator(), ...props.view.cases.flatMap(entry => entry.fields.map(field => field.name))],
    ...(props.nativeRecordContext && (props.nativeRecordContext.evaluateContext === undefined
      ? props.evaluateContext === undefined : props.nativeRecordContext.evaluateContext === context())
      ? { representationTypeName: props.nativeRecordContext.representationTypeName } : {}),
  }), { evaluateContext: context, coordinate: () => ({ view: props.view, type: props.type,
    discriminator: discriminator(), sourceValue: props.value, path: props.path }), publication });
  const paintedCoordinate = () => record.paint()?.coordinate ?? { view: props.view, type: props.type,
    discriminator: discriminator(), sourceValue: props.value };
  const paintedValue = () => record.paint()?.value as Record<string, unknown> | undefined;
  const recordError = () => {
    const issue = record.error();
    return issue instanceof Error ? issue.message : typeof issue === "string" ? issue : issue ? "This constructor's fields are unavailable." : undefined;
  };
  const tagSlot = () => paintedCoordinate().sourceValue === null || paintedCoordinate().sourceValue === undefined
    ? undefined : record.paint()?.recordSlots.find(entry => entry.field === paintedCoordinate().discriminator)?.slot;
  const tagError = () => { const current = tagSlot(); return current?.$tag === "Err" ? current._0 : undefined; };
  const currentCase = () => {
    const v = paintedCoordinate().sourceValue;
    if (v !== null && v !== undefined) {
      const slot = tagSlot();
      return slot?.$tag === "Ok" && slot._0.value.$tag === "Just" && typeof slot._0.value._0 === "string" ? slot._0.value._0 : "";
    }
    return paintedCoordinate().view.cases[0]?.name ?? "";
  };

  const caseShape = () => paintedCoordinate().view.cases.find((c) => c.name === currentCase());

  const isSelected = () =>
    props.selectedPath !== undefined && pathEquals(props.path, props.selectedPath);

  function onPickCase(caseName: string) {
    if (!latest(record.ready)) return;
    // setCase operates against the root — but we have a sub-value here. We
    // run the equivalent inline: build a new variant value with defaults from
    // the new case's fields, carrying over matching field names.
    const target = props.view.cases.find((c) => c.name === caseName);
    if (!target) return;
    if (tagError()) { setEditError(tagError()); return; }
    const next: Record<string, unknown> = { [discriminator()]: caseName };
    try {
      for (const f of target.fields) {
        const slot = record.paint()?.recordSlots.find(entry => entry.field === f.name)?.slot;
        if (!slot) { setEditError("This constructor cannot be read safely."); return; }
        if (slot.$tag === "Err") { setEditError(slot._0); return; }
        next[f.name] = slot._0.value.$tag === "Just" ? slot._0.value._0
          : (f.isRecursive ? defaultValueFor(props.recursiveOwner ?? props.view.selfRef) : defaultValueFor(f.type));
      }
      props.onChange(next);
      setEditError(undefined);
    } catch {
      setEditError("This constructor cannot accept the edited data.");
    }
  }

  function setField(fieldName: string, value: unknown, publish: (value: unknown) => void) {
    record.edit(fieldName, value, publish);
  }

  return (
    <div

      class={["vve-variant", { "vve-selected": !!(isSelected()) }]}
      aria-busy={record.loading() ? "true" : "false"}
    >
      <Show when={record.paint()}>
      <div ref={record.guardElement} style={{ display: "contents" }} aria-disabled={record.ready() ? "false" : "true"}>
      <div
        class="vve-variant-header"
        onClick={(e) => {
          e.stopPropagation();
          props.onSelectPath?.(props.path);
        }}
      >
        <span onClick={(event) => event.stopPropagation()}>
          <LocusSelect
            class="vve-case-picker"
            label="Data case"
            value={currentCase()}
            options={paintedCoordinate().view.cases.map((entry) => ({ value: entry.name, label: entry.name }))}
            onChange={(value) => { if (value !== currentCase()) onPickCase(value); }}
          />
        </span>
      </div>
      <Show when={paintedCoordinate().sourceValue === null || paintedCoordinate().sourceValue === undefined}>
        <button type="button" class="vve-btn-add" onClick={() => onPickCase(currentCase())}>Create {currentCase()}</button>
      </Show>
      <Show when={paintedCoordinate().sourceValue !== null && paintedCoordinate().sourceValue !== undefined && caseShape() && caseShape()!.fields.length > 0}>
        <div class="vve-variant-fields">
          <For keyed={false} each={caseShape()!.fields}>
            {(field) => {
              const slot = () => record.paint()?.recordSlots.find(entry => entry.field === field().name)?.slot;
              const admitted = () => { const current = slot(); return current?.$tag === "Ok" ? current._0 : undefined; };
              const value = () => { const current = admitted(); return current?.value.$tag === "Just" ? current.value._0 : undefined; };
              const publishField = createMemo(() => {
                const publish = props.onChange, currentField = field(), name = currentField.name;
                const publication = { field: currentField, parent: props.value, view: props.view, selectedCase: currentCase(), callback: (value: unknown): void => {
                  if (latest(publishField) !== publication) return;
                  setField(name, value, publish);
                } };
                return publication;
              });
              return <Show when={admitted()} fallback={<p class="text-muted" role="status">{(() => { const current = slot(); return current?.$tag === "Err" ? current._0 : "This constructor cannot be read safely."; })()}</p>}>
                {(stored) =>
              <FieldEditor
                field={field()}
                selfRef={paintedCoordinate().view.selfRef}
                recursiveOwner={props.recursiveOwner}
                evaluateContext={props.evaluateContext}
                nativeRecordContext={props.nativeRecordContext}
                recordValues={Object.create(null, {
                  ...Object.getOwnPropertyDescriptors(props.recordValues ?? {}),
                  ...Object.getOwnPropertyDescriptors(paintedValue() ?? {}),
                })}
                value={value()}
                onChange={publishField().callback}
                path={[...props.path, stored().wire]}
                selectedPath={props.selectedPath}
                onSelectPath={props.onSelectPath}
              />
                }
              </Show>;
            }}
          </For>
        </div>
      </Show>
      </div>
      </Show>
      <Show when={tagError()}>{(error) => <p class="text-muted" role="status">{error()}</p>}</Show>
      <Show when={editError()}>{(error) => <p class="text-muted" role="alert">{error()}</p>}</Show>
      <Show when={!record.ready() && !recordError()}><span class="text-muted" role="status">Preparing constructor fields…</span></Show>
      <Show when={recordError()}>{issue => <><p class="text-muted" role="alert">{issue()}</p>
        <button type="button" class="expr-form__btn" onClick={() => { void record.retry(); }}>Retry</button></>}</Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldEditor — one field of a record / variant case
// ---------------------------------------------------------------------------

type FieldEditorProps = {
  recordValues?: Record<string, unknown>;
  field: { name: string; type: FenelType; isRecursive: boolean };
  selfRef: FenelType;
  recursiveOwner?: FenelType;
  evaluateContext?: EvaluateContext;
  nativeRecordContext?: ValueEditorProps["nativeRecordContext"];
  value: unknown;
  onChange: (next: unknown) => void;
  path: Path;
  selectedPath?: Path;
  onSelectPath?: (path: Path) => void;
};

function FieldEditor(props: FieldEditorProps) {
  // Substitute $var references for the surrounding μ var (if any).
  const resolvedType = createMemo(() => {
    const ref = props.selfRef;
    if ("$mu" in ref) return bindVar(props.field.type, ref.$mu.var, props.recursiveOwner ?? ref);
    return props.field.type;
  });

  return (
    <div class="vve-field">
      <div class="vve-field-name">{props.field.name}</div>
      <div class="vve-field-value">
        <ValueEditor
          recordValues={props.recordValues}
          evaluateContext={props.evaluateContext}
          nativeRecordContext={props.nativeRecordContext}
          type={resolvedType()}
          value={props.value}
          onChange={props.onChange}
          path={props.path}
          selectedPath={props.selectedPath}
          onSelectPath={props.onSelectPath}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NonVariantEditor — list / record / atom dispatch
// ---------------------------------------------------------------------------

function NonVariantEditor(props: ValueEditorProps) {
  const t = () => props.type;
  const native = createMemo(() => nativeValueTypeName(t()));
  const list = createMemo(() => peelList(t()));
  return <Switch fallback={<RawValueBody {...props} />}>
    <Match when={props.value instanceof Uint8Array || "$ref" in t() && (t() as { $ref: string }).$ref === "Bytes" || "$opaque" in t() && (t() as Extract<FenelType, { $opaque: unknown }>).$opaque.name === "Bytes"}><BytesEditor value={props.value} onChange={props.onChange} /></Match>
    <Match when={native()}>{(name) => <NativeRepresentationEditor {...props} typeName={name()} />}</Match>
    <Match when={list()}>{(shape) => <NativeRepresentationEditor {...props} typeName="List" elementType={shape().elem} />}</Match>
    <Match when={"$unit" in t()}><span class="vve-unit">Unit <button type="button" onClick={() => props.onChange(null)}>Set unit</button></span></Match>
    <Match when={"$void" in t()}><span class="vve-empty">This type has no values.</span></Match>
    <Match when={"$record" in t() && (t() as Extract<FenelType, { $record: unknown }>).$record}>{(record) => <RecordEditor {...props} fields={record().fields} />}</Match>
    <Match when={"$tuple" in t() && (t() as Extract<FenelType, { $tuple: unknown }>).$tuple}>{(tuple) => <TupleEditor {...props} elements={tuple()} />}</Match>
    <Match when={"$map" in t() && (t() as Extract<FenelType, { $map: unknown }>).$map}>{(map) => <MapEditor {...props} valueType={map().values} />}</Match>
    <Match when={"$arrow" in t()}><ArrowEditor {...props} /></Match>
    <Match when={"$type" in t()}><TypeBuilder value={props.value as FenelType} onChange={props.onChange} /></Match>
    <Match when={"$union" in t() && (t() as Extract<FenelType, { $union: unknown }>).$union}>{(branches) => <UnionValueEditor {...props} branches={branches()} />}</Match>
    <Match when={"$intersect" in t()}><RawValueBody {...props} raw /></Match>
    <Match when={"$opaque" in t() && (t() as Extract<FenelType, { $opaque: unknown }>).$opaque.pure}>{(pure) => <ValueEditor {...props} type={pure()} />}</Match>
    <Match when={"$mu" in t()}><RecursiveValueEditor {...props} /></Match>
  </Switch>;
}

function NativeRepresentationEditor(props: ValueEditorProps & { typeName: string; elementType?: FenelType }) {
  const session = useAuthoringSession();
  const reader = useReaderRuntime();
  const presentationRegistry = useFieldPresentationRegistry();
  const frame = () => reader?.session() ?? session;
  const [selected, setSelected] = createSignal<"native" | "representation" | "structural">();
  const [editError, setEditError] = createSignal<string>();
  const mode = () => selected() ?? (isNativeValueRepresentation(props.typeName, props.value) ? "native" : "structural");
  // B4 wave 1 lane B: the field owner of a Local reader's own session switches
  // representations in that reader's worker, never with the page registry.
  // Its native lexical frame is then selected by name in the worker; children
  // receive the inert name only (see `nativeRecordContext` on ValueEditorProps).
  const local = createMemo(() => reader?.kind === "local"
    && (!presentationRegistry() || presentationRegistry() === reader.session().registry));
  const nativeRecordContext = createMemo((): NonNullable<ValueEditorProps["nativeRecordContext"]> => local()
    ? { representationTypeName: props.typeName }
    : { representationTypeName: props.typeName,
      evaluateContext: runtimeRepresentationNativeContext(frame().evaluateContext, props.typeName) });
  const pageFrame = (): NativeRepresentationFrame => ({ evaluateContext: frame().evaluateContext, registry: frame().registry,
    resolveNamedType: (name) => frame().environment.resolveNamedType?.(name), nativeContext: () => nativeRecordContext().evaluateContext! });
  const projection = createMemo(() => {
    if (mode() === "native" || local()) return { type: undefined, value: props.value, error: undefined, evaluateContext: undefined };
    try {
      const current = mode() as NativeRepresentationMode, page = pageFrame();
      const projected = projectNativeRepresentation(current, props.typeName, props.type, props.value, page);
      return { ...projected, error: undefined,
        evaluateContext: current === "representation" ? nativeRecordContext().evaluateContext : props.evaluateContext ?? page.evaluateContext };
    } catch {
      return { type: undefined, value: props.value, error: NATIVE_REPRESENTATION_UNAVAILABLE, evaluateContext: undefined };
    }
  });

  // ---- Local reader: closed worker operations (`*-reader-representation`) ----
  type LocalRequest = { kind: "request"; session: AuthoringSession; worker: PreparedReaderWorker; mode: NativeRepresentationMode;
    typeName: string; type: FenelType; typeKey: string | undefined; value: unknown };
  type LocalInput = LocalRequest | { kind: "pending" } | { kind: "error"; error: unknown; notReady?: true };
  type LocalProjection = { input: LocalRequest; projection: NativeRepresentationResultOf<{ type: FenelType; value: unknown }> };
  const localInput = createMemo((): LocalInput | undefined => {
    if (!local()) return undefined;
    const current = mode();
    if (current === "native") return undefined;
    const readerSession = reader!.session(), typeName = props.typeName, type = props.type, value = props.value;
    try {
      const worker = preparedReaderWorkerForSession(readerSession);
      // Read for its reactive coordinates (epoch, reader revision, worker
      // snapshot); every send takes, and after its reply asserts, its own.
      // As the record operations: no worker is a refusal unless a replacement
      // is known to be coming (then the existing preparing state shows).
      if (!worker) return authoringWorkerReplacementPending(readerSession) ? { kind: "pending" }
        : { kind: "error", error: new Error(NATIVE_REPRESENTATION_TOOLS_UNAVAILABLE), notReady: true };
      if (!localGuidanceCapture(reader, () => readerSession)) return { kind: "pending" };
      return { kind: "request", session: readerSession, worker, mode: current, typeName, type, typeKey: exactTransportKey(type), value };
    } catch (error) { return { kind: "error", error }; }
  });
  let alive = true, projectionFlight: AbortController | undefined, localFlight: AbortController | undefined;
  const [localBusy, setLocalBusy] = createSignal(false);
  onSettled(() => () => { alive = false; projectionFlight?.abort(); localFlight?.abort(); });
  /** One closed request. A reply computed under a capture that no longer
   * holds is dropped and asked again; a superseded request settles nothing. */
  async function askLocal(input: LocalRequest, payload: NativeRepresentationQuery, signal: AbortSignal,
    current: () => boolean = () => latest(localInput) === input): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const capture = untrack(() => localGuidanceCapture(reader, () => input.session));
      if (!capture) throw new Error(NATIVE_REPRESENTATION_UNAVAILABLE);
      const reply = await runPreparedReaderWorker(input.worker, payload, signal);
      signal.throwIfAborted();
      if (!alive || !current()) throw new Error(NATIVE_REPRESENTATION_CHANGED);
      let sameWorker = false;
      try { sameWorker = preparedReaderWorkerForSession(input.session) === input.worker; } catch { sameWorker = false; }
      // A replaced worker is not asked again through the old handle.
      if (!sameWorker) throw new Error(NATIVE_REPRESENTATION_TOOLS_UNAVAILABLE);
      if (localGuidanceCurrent(capture, reader, () => input.session)) return reply;
    }
    throw new Error(NATIVE_REPRESENTATION_UNAVAILABLE);
  }
  const localSlot = (reply: unknown, key: "projection" | "changed" | "created"): NativeRepresentationResultOf<unknown> => {
    const slot = reply && typeof reply === "object" && !Array.isArray(reply) && Object.hasOwn(reply, key)
      ? (reply as Record<string, unknown>)[key] as NativeRepresentationResultOf<unknown> : undefined;
    if (!slot || typeof slot !== "object" || (slot.$tag !== "Ok" && slot.$tag !== "Err") || !Object.hasOwn(slot, "_0")
      || (slot.$tag === "Err" && typeof slot._0 !== "string"))
      throw new Error("This representation's answer could not be read.");
    return slot;
  };
  const localProjection = createAsyncValue(() => ({ input: localInput() }), ({ input }): Promise<LocalProjection> | undefined => {
    projectionFlight?.abort(); projectionFlight = undefined;
    if (!input || input.kind === "pending") return undefined;
    if (input.kind === "error") throw input.error;
    const controller = new AbortController(); projectionFlight = controller;
    return askLocal(input, { method: "project-reader-representation", typeName: input.typeName, type: input.type,
      mode: input.mode, value: input.value }, controller.signal).then(reply => {
      const slot = localSlot(reply, "projection") as LocalProjection["projection"];
      if (slot.$tag === "Ok" && (!slot._0 || typeof slot._0 !== "object" || !slot._0.type || typeof slot._0.type !== "object"
        || !Object.hasOwn(slot._0, "value"))) throw new Error("This representation's answer could not be read.");
      return { input, projection: slot };
    }).finally(() => { if (projectionFlight === controller) projectionFlight = undefined; });
  });
  let retainedProjection: LocalProjection | undefined;
  /** The projection painted for the current owner: the exact answer for the
   * current request, or the previous answer of the same session, worker,
   * mode and type while the next one prepares. */
  const localPaint = createMemo(() => {
    const input = localInput();
    const projected = localProjection.loading ? latest(localProjection) : localProjection();
    if (!input || input.kind !== "request") return undefined;
    if (projected && projected.input === input && retainedProjection?.input !== input) {
      const previous = retainedProjection;
      // Keep the projected type's identity across answers of an equal type,
      // so the nested editors keep their own state.
      retainedProjection = previous?.projection.$tag === "Ok" && projected.projection.$tag === "Ok"
        && sameNativeRepresentationOwner(previous.input, input)
        && exactTransportKey(previous.projection._0.type) === exactTransportKey(projected.projection._0.type)
        ? { input, projection: { $tag: "Ok", _0: { type: previous.projection._0.type, value: projected.projection._0.value } } } : projected;
    }
    const kept = retainedProjection;
    if (!kept || !sameNativeRepresentationOwner(kept.input, input)) return undefined;
    return { projection: kept.projection, current: kept.input === input };
  });

  // An edit chain: the user's successive edits of one view, sent one at a
  // time. While it runs, the view shows the latest edited data (exactly what
  // the nested editor published, so the next edit builds on it). An edit
  // made while another is answered waits, the latest replacing an older
  // waiting one, and is sent as soon as that answer lands: each edit maps its
  // data to the owner value in the chain's own mode, so it needs neither the
  // next view nor the mode in force. The chain holds while its session and
  // owner type are the same and the parent still holds what the chain started
  // from or last published (identity, or an equal copy); otherwise it ends,
  // and an edit made on a view that is not the current data's is refused
  // visibly, never dropped. A failed answer keeps the latest edit for Retry.
  // Its display and its part of the input guard read only plain signals, so
  // they are never pending while a re-projection is in flight.
  type EditChain = { session: AuthoringSession; typeName: string; type: FenelType; typeKey: string | undefined;
    mode: NativeRepresentationMode; viewType: FenelType; shown: unknown; accepted: Array<{ value: unknown; key: string | undefined }>;
    published?: true; admitted?: { value: unknown }; waiting?: { value: unknown }; unsent?: { value: unknown } };
  let editChain: EditChain | undefined;
  const [chainShown, setChainShown] = createSignal<EditChain>();
  const [chainVersion, setChainVersion] = createSignal(0);
  const touchChain = () => setChainVersion(version => version + 1);
  const transportKey = (value: unknown) => { try { return exactTransportKey(value); } catch { return undefined; } };
  const chainHolds = (chain: EditChain): boolean => alive && untrack(() => {
    if (reader?.session() !== chain.session || props.typeName !== chain.typeName) return false;
    if (props.type !== chain.type && (chain.typeKey === undefined || transportKey(props.type) !== chain.typeKey)) return false;
    const parent = props.value;
    if (chain.accepted.some(entry => entry.value === parent)) return true;
    const key = transportKey(parent);
    return key !== undefined && chain.accepted.some(entry => entry.key === key);
  });
  const endChain = (chain: EditChain) => {
    if (editChain !== chain) return;
    editChain = undefined; setChainShown(undefined); touchChain();
  };
  /** The chain shown for the mode in force (plain signals only). */
  const chainView = () => {
    chainVersion();
    const chain = chainShown();
    return chain && chain.mode === mode() ? chain : undefined;
  };
  function failChain(chain: EditChain, value: unknown, message: string) {
    chain.waiting = undefined; chain.unsent = { value };
    setEditError(message); setLocalBusy(false); touchChain();
  }
  function sendEdit(chain: EditChain, edited: unknown) {
    let worker: PreparedReaderWorker | undefined;
    try { worker = preparedReaderWorkerForSession(chain.session); } catch { worker = undefined; }
    if (!worker) { failChain(chain, edited, NATIVE_REPRESENTATION_TOOLS_UNAVAILABLE); return; }
    const controller = new AbortController(); localFlight = controller; setLocalBusy(true);
    chain.waiting = undefined; chain.unsent = undefined; touchChain();
    const parentAtSend = untrack(() => props.value);
    const holds = () => alive && !controller.signal.aborted && editChain === chain && chainHolds(chain);
    const target = { session: chain.session, worker } as LocalRequest;
    void askLocal(target, { method: "edit-reader-representation", typeName: chain.typeName, type: chain.type,
      mode: chain.mode, edited }, controller.signal, holds).then(reply => {
      const slot = localSlot(reply, "changed");
      if (!holds()) throw new Error(NATIVE_REPRESENTATION_CHANGED);
      if (localFlight === controller) localFlight = undefined;
      if (slot.$tag === "Err") {
        setEditError(NATIVE_REPRESENTATION_EDIT_REFUSED);
        // Show again the last admitted data (or the view itself), unless a later edit waits.
        if (!chain.waiting) {
          if (chain.admitted) chain.shown = chain.admitted.value;
          else { endChain(chain); setLocalBusy(false); return; }
        }
      } else {
        chain.admitted = { value: edited }; chain.published = true;
        chain.accepted = [{ value: parentAtSend, key: transportKey(parentAtSend) }, { value: slot._0, key: transportKey(slot._0) }];
        latest(publishStructure).publish(slot._0);
        setEditError(undefined);
      }
      const waiting = chain.waiting;
      if (waiting && alive && editChain === chain) { sendEdit(chain, waiting.value); return; }
      if (alive) { setLocalBusy(false); touchChain(); }
    }).catch(error => {
      if (localFlight === controller) localFlight = undefined;
      if (!alive) return;
      if (error instanceof Error && error.message === NATIVE_REPRESENTATION_CHANGED || editChain !== chain || !chainHolds(chain)) {
        endChain(chain); setEditError(NATIVE_REPRESENTATION_CHANGED); setLocalBusy(false);
        return;
      }
      // The data still holds: a worker or transport failure. Keep the latest
      // edit for Retry (or the next edit), with an accurate message.
      let now: PreparedReaderWorker | undefined;
      try { now = preparedReaderWorkerForSession(chain.session); } catch { now = undefined; }
      failChain(chain, chain.waiting?.value ?? edited, now === worker ? NATIVE_REPRESENTATION_UNAVAILABLE : NATIVE_REPRESENTATION_TOOLS_UNAVAILABLE);
    });
  }
  function editLocal(value: unknown) {
    let chain = editChain;
    if (chain && !chainHolds(chain)) { endChain(chain); setEditError(NATIVE_REPRESENTATION_CHANGED); return; }
    if (chain && chain.mode !== untrack(mode)) {
      // An earlier mode's chain still finishing: the guard blocks this view meanwhile.
      if (localFlight || chain.waiting) { setEditError(NATIVE_REPRESENTATION_CHANGED); return; }
      endChain(chain); chain = undefined;
    }
    if (!chain) {
      const input = latest(localInput), paint = latest(localPaint);
      if (localFlight || !input || input.kind !== "request" || !paint?.current || paint.projection.$tag !== "Ok") {
        setEditError(NATIVE_REPRESENTATION_CHANGED);
        return;
      }
      const parent = untrack(() => props.value);
      chain = editChain = { session: input.session, typeName: input.typeName, type: input.type, typeKey: input.typeKey,
        mode: input.mode, viewType: paint.projection._0.type, shown: value, accepted: [{ value: parent, key: transportKey(parent) }] };
      setChainShown(chain);
    } else chain.shown = value;
    if (localFlight) { chain.waiting = { value }; touchChain(); return; }
    setEditError(undefined);
    sendEdit(chain, value);
  }
  function retryEdit() {
    const chain = editChain;
    if (!chain?.unsent || localFlight) return;
    if (!chainHolds(chain)) { endChain(chain); setEditError(NATIVE_REPRESENTATION_CHANGED); return; }
    setEditError(undefined);
    sendEdit(chain, chain.unsent.value);
  }
  const editRetry = () => { chainVersion(); return !!chainShown()?.unsent; };
  // A chain whose session, owner type or parent changed outside this editor
  // ends: its view is no longer the data's. A kept edit says so.
  createEffect(() => { chainVersion(); const chain = chainShown(); void props.value; void props.type; void props.typeName; reader?.session(); return chain; },
    chain => {
      if (!chain || chainHolds(chain)) return;
      const kept = !localFlight && (chain.waiting || chain.unsent);
      endChain(chain);
      if (kept) setEditError(NATIVE_REPRESENTATION_CHANGED);
    });
  // A settled chain ends once the exact view of what it last published (or
  // of the data it started from) has arrived, or once its mode is left.
  createEffect(() => {
    chainVersion(); localBusy();
    const chain = chainShown();
    if (!chain) return undefined;
    const paint = localPaint();
    return { chain, current: !!paint?.current, left: chain.mode !== mode() };
  }, state => {
    if (!state || editChain !== state.chain || localFlight || state.chain.waiting || state.chain.unsent) return;
    if (state.left) { endChain(state.chain); return; }
    if (!state.current) return;
    const published = state.chain.accepted[state.chain.accepted.length - 1]!;
    const parent = untrack(() => props.value);
    if (!state.chain.published || parent === published.value || published.key !== undefined && transportKey(parent) === published.key)
      endChain(state.chain);
  });
  /** Edits are taken while this editor's own chain is shown (read first, from
   * plain signals: never pending), or while the exact view of the current
   * data is painted; otherwise input is blocked. */
  const localEditable = () => {
    if (chainView()) return true;
    const paint = localPaint();
    return !!paint?.current && paint.projection.$tag === "Ok" && !localBusy();
  };
  const localGuardElement = createReaderInteractionGuard(() => !local() || localEditable());
  const localView = () => {
    const chain = chainView();
    // Representation fields read the worker's native frame by name; the
    // structural view keeps the frame its parent supplied (none for Local).
    if (chain) return { type: chain.viewType, value: chain.shown, error: undefined,
      evaluateContext: chain.mode === "representation" ? undefined : props.evaluateContext, pending: false, retry: false };
    const input = localInput(), paint = localPaint();
    const failed = input?.kind === "error" || !localProjection.loading && localProjection.error !== undefined;
    // A failed request (a worker failure, or a capture that kept moving under
    // untracked source metadata) offers the record operations' Retry.
    if (failed || paint?.projection.$tag === "Err")
      return { type: undefined, value: props.value, evaluateContext: undefined, pending: false,
        retry: input?.kind === "request" && !localProjection.loading && localProjection.error !== undefined,
        error: input?.kind === "error" && input.notReady ? NATIVE_REPRESENTATION_TOOLS_UNAVAILABLE : NATIVE_REPRESENTATION_UNAVAILABLE };
    if (!paint || paint.projection.$tag !== "Ok")
      return { type: undefined, value: props.value, error: undefined, evaluateContext: undefined, pending: !!input, retry: false };
    return { type: paint.projection._0.type, value: paint.projection._0.value, error: undefined,
      evaluateContext: mode() === "representation" ? undefined : props.evaluateContext, pending: !paint.current, retry: false };
  };
  /** A Local default: refused with the page's copy, never published after its owner changed. */
  function createLocal() {
    const input = latest(localInput), publish = props.onChange;
    if (!input || input.kind !== "request" || localFlight || input.value != null) return;
    const controller = new AbortController(); localFlight = controller; setLocalBusy(true);
    const current = () => alive && !controller.signal.aborted && latest(localInput) === input;
    void askLocal(input, { method: "create-reader-representation", typeName: input.typeName, type: input.type, mode: input.mode },
      controller.signal).then(reply => {
      const slot = localSlot(reply, "created");
      if (!current()) return;
      if (slot.$tag === "Err") { setEditError(NATIVE_REPRESENTATION_CREATE_REFUSED); return; }
      publish(slot._0);
      setEditError(undefined);
    }).catch(() => { if (current()) setEditError(NATIVE_REPRESENTATION_CREATE_REFUSED); }).finally(() => {
      if (localFlight === controller) { localFlight = undefined; if (alive) setLocalBusy(false); }
    });
  }

  function changeStructure(value: unknown, publish: (value: unknown) => void) {
    if (latest(local)) { editLocal(value); return; }
    try {
      publish(editNativeRepresentation(mode() as NativeRepresentationMode, props.typeName, props.type, value, pageFrame()));
      setEditError(undefined);
    } catch {
      setEditError(NATIVE_REPRESENTATION_EDIT_REFUSED);
    }
  }
  const publishStructure = createMemo(() => {
    const publish = props.onChange;
    const publication = { parent: props.value, type: props.type, typeName: props.typeName,
      selectedMode: mode(), session: frame(), publish, callback: (value: unknown): void => {
      if (latest(publishStructure) !== publication) return;
      changeStructure(value, publish);
    } };
    return publication;
  });
  function createStructure() {
    if (latest(local)) { createLocal(); return; }
    try {
      props.onChange(createNativeRepresentation(mode() as NativeRepresentationMode, props.typeName, props.type, pageFrame()));
      setEditError(undefined);
    } catch {
      setEditError(NATIVE_REPRESENTATION_CREATE_REFUSED);
    }
  }
  const shown = () => local() ? localView() : projection();
  const busy = () => local() && (localView().pending || localBusy());
  const retryProjection = () => { void localProjection.refetch(); };
  return <div class="vve-representation" aria-busy={busy() ? "true" : undefined}>
    <LocusSelect label="Data representation" value={mode()}
      options={[{ value: "native", label: "Native data" }, { value: "representation", label: "Representation fields" }, { value: "structural", label: "Constructors" }]}
      onChange={(value) => { setSelected(value as "native" | "representation" | "structural"); setEditError(undefined); }} />
    <Show when={mode() !== "native"} fallback={
      <Show when={props.elementType} fallback={<AtomicEditor {...props} typeName={props.typeName} />}>
        {(element) => <ListEditor {...props} elementType={element()} />}
      </Show>
    }>
      <Show when={shown().type}>
        {(type) => <>
          <Show when={props.value == null}>
            <button type="button" class="vve-btn-add" onClick={createStructure}>Create data</button>
          </Show>
          <Show when={props.value !== null && props.value !== undefined}>
            <div ref={localGuardElement} style={{ display: "contents" }} aria-disabled={local() && !localEditable() ? "true" : "false"}>
              <ValueEditor {...props} type={type()} evaluateContext={shown().evaluateContext}
                nativeRecordContext={mode() === "representation" ? nativeRecordContext() : props.nativeRecordContext}
                recursiveOwner={mode() === "structural" ? props.type : undefined} value={shown().value} onChange={publishStructure().callback} />
            </div>
          </Show>
        </>}
      </Show>
      <Show when={local() && !shown().type && localView().pending}>
        <span class="home-new-button__spinner" style="display:inline-block;width:12px;height:12px;position:static;vertical-align:middle" role="status" aria-label="Loading" />
      </Show>
      <Show when={shown().error}>{(error) => <p class="text-muted" role="status">{error()}</p>}</Show>
      <Show when={local() && localView().retry}>
        <button type="button" class="expr-form__btn" onClick={retryProjection}>Retry</button>
      </Show>
    </Show>
    <Show when={editError()}>{(error) => <p class="text-muted" role="alert">{error()}</p>}</Show>
    <Show when={local() && editRetry()}>
      <button type="button" class="expr-form__btn" onClick={retryEdit}>Retry</button>
    </Show>
  </div>;
}

/** The same Local owner coordinates (the value aside) an answer was asked under. */
function sameNativeRepresentationOwner(a: { session: unknown; worker: unknown; mode: string; typeName: string; type: FenelType; typeKey: string | undefined },
  b: { session: unknown; worker: unknown; mode: string; typeName: string; type: FenelType; typeKey: string | undefined }): boolean {
  return a.session === b.session && a.worker === b.worker && a.mode === b.mode && a.typeName === b.typeName
    && (a.type === b.type || a.typeKey !== undefined && a.typeKey === b.typeKey);
}

function RecursiveValueEditor(props: ValueEditorProps) {
  return <Show when={props.value != null} fallback={<button type="button" class="vve-btn-add" onClick={() => props.onChange(defaultValueFor(unfold(props.type as Extract<FenelType, { $mu: unknown }>)))}>Create data</button>}>
    <ValueEditor {...props} type={unfold(props.type as Extract<FenelType, { $mu: unknown }>)} />
  </Show>;
}

function UnionValueEditor(props: ValueEditorProps & { branches: FenelType[] }) {
  // Selecting an alternate view never replaces the authored value. Its editor
  // performs an explicit value change, just as selecting a type does elsewhere.
  const authoring = useAuthoringSession();
  const reader = useReaderRuntime();
  const frame = () => reader?.session() ?? authoring;
  // A Local representation passes its native frame by name only (B4 wave 1
  // lane B); this page-side branch admission derives that same frame here.
  // B4 wave 4 lane E: without an explicitly supplied frame, a Local reader
  // admits the branches, selects one and captions them in its worker
  // (`select-reader-union-branch`, its native frame selected there by name);
  // the page frame is never read. Until answered no branch is claimed.
  const workerRoute = () => reader?.kind === "local" && props.evaluateContext === undefined
    && (!props.nativeRecordContext || props.nativeRecordContext.evaluateContext === undefined);
  const localUnion = reader?.kind === "local" ? createLocalUnionBranch(() => reader, frame, () => workerRoute()
    ? { branches: props.branches, value: props.value, recordValues: props.recordValues,
      representationTypeName: props.nativeRecordContext?.representationTypeName } : undefined) : undefined;
  const context = createMemo(() => workerRoute() ? undefined : props.evaluateContext ?? (props.nativeRecordContext && props.nativeRecordContext.evaluateContext === undefined
    ? runtimeRepresentationNativeContext(frame().evaluateContext, props.nativeRecordContext.representationTypeName) : frame().evaluateContext));
  const [selected, setSelected] = createSignal<{ index: number; value: unknown; branches: FenelType[]; context: unknown;
    capture?: ReturnType<typeof localGuidanceCapture>; representationTypeName?: string }>();
  const initial = createMemo(() => {
    if (workerRoute()) return localUnion!.answer()?.selected;
    const captured = context();
    const account = frameAccount(captured);
    const options = { registry: frame().registry, functions: captured, coerce: false, strict: { primitiveTypes: true, membership: true } };
    const admitted = props.branches.map((branch) => {
      try { return validateValue(branch, props.value, account, options).valid; }
      catch { return false; }
    });
    return fieldUnionBranchSelectionPlan(admitted, captured);
  });
  const current = () => {
    const explicit = selected();
    // A Local frame is intentionally absent on the page. Retain the same
    // reader capture as its worker answer, including a native selector change.
    const capture = workerRoute() ? localGuidanceCapture(reader, frame) : undefined;
    const sameOwner = !workerRoute() || !!explicit?.capture && !!capture
      && sameLocalGuidanceCapture(explicit.capture, capture)
      && explicit.representationTypeName === props.nativeRecordContext?.representationTypeName;
    return explicit && explicit.value === props.value && explicit.branches === props.branches && explicit.context === context() && sameOwner
      ? explicit.index : initial();
  };
  const selectBranch = (index: number) => setSelected({ index, value: props.value, branches: props.branches, context: context(),
    ...(workerRoute() ? { capture: localGuidanceCapture(reader, frame), representationTypeName: props.nativeRecordContext?.representationTypeName } : {}) });
  const branch = () => {
    const index = current();
    return index === undefined ? undefined : props.branches[index];
  };
  /** A Local caption is the worker's; until it lands, the frameless caption. */
  const branchLabel = (type: FenelType, index: number) => {
    if (!workerRoute()) return fieldTypeLabelPlan(type, props.recordValues, context());
    const answered = localUnion!.answer()?.labels[index];
    if (answered !== undefined) return answered;
    try { return fieldTypeLabelPlan(type); } catch { return "Type"; }
  };
  return <div class="vve-union">
    <LocusSelect label="Data type branch" value={current() === undefined ? "" : String(current())}
      busy={workerRoute() && !localUnion!.answer() && !localUnion!.failure()}
      fallbackOption={{ value: "", label: "Choose a type branch" }}
      options={props.branches.map((type, index) => ({ value: String(index), label: `${branchLabel(type, index)} (${index + 1})` }))}
      onChange={(value) => selectBranch(Number(value))} />
    <Show when={branch()}>{(chosen) => <ValueEditor {...props} type={chosen()} />}</Show>
    <Show when={!branch()}><p class="text-muted" role="status">Choose a type branch for this data.</p></Show>
  </div>;
}

// ---------------------------------------------------------------------------
// ListEditor — insert / remove / move + per-item editor
// ---------------------------------------------------------------------------

function ListEditor(props: ValueEditorProps & { elementType: FenelType }) {
  const items = () => Array.isArray(props.value) ? props.value : [];

  function add() {
    props.onChange(insertAtIndex(items(), [], props.raw ? null : defaultValueFor(props.elementType)));
  }
  function removeAt(i: number) {
    props.onChange(removeAtIndex(items(), [], i));
  }
  function move(from: number, to: number) {
    props.onChange(moveItem(items(), [], from, to));
  }
  function setItem(i: number, v: unknown, publish: (value: unknown) => void) {
    const arr = items().slice();
    arr[i] = v;
    publish(arr);
  }

  return (
    <div class="vve-list">
      <For keyed={false} each={items()}>
        {(item, i) => {
          const publishItem = createMemo(() => {
            const publish = props.onChange;
            const publication = { parent: props.value, type: props.elementType, callback: (value: unknown): void => {
              if (latest(publishItem) !== publication) return;
              setItem(i, value, publish);
            } };
            return publication;
          });
          return (
          <div class="vve-list-item">
            <div class="vve-list-controls">
              <button
                type="button"
                class="vve-btn-icon"
                data-tooltip="Move up"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              >▲</button>
              <button
                type="button"
                class="vve-btn-icon"
                data-tooltip="Move down"
                disabled={i === items().length - 1}
                onClick={() => move(i, i + 1)}
              >▼</button>
              <button
                type="button"
                class="vve-btn-icon vve-btn-remove"
                data-tooltip="Remove"
                onClick={() => removeAt(i)}
              >×</button>
            </div>
            <div class="vve-list-item-body">
              <ValueEditor
                raw={props.raw}
                recordValues={props.recordValues}
                evaluateContext={props.evaluateContext}
                nativeRecordContext={props.nativeRecordContext}
                type={props.elementType}
                value={item()}
                onChange={publishItem().callback}
                path={[...props.path, i]}
                selectedPath={props.selectedPath}
                onSelectPath={props.onSelectPath}
              />
            </div>
          </div>
        ); }}
      </For>
      <button type="button" class="vve-btn-add" onClick={add}>+ Add item</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RecordEditor — fields stacked vertically
// ---------------------------------------------------------------------------

function RecordEditor(props: ValueEditorProps & { fields: FieldDef[] }) {
  const authoring = useAuthoringSession();
  const reader = useReaderRuntime();
  const frame = () => reader?.session() ?? authoring;
  // B4 F1: a Local reader's own record frame is its worker's; only an
  // explicitly supplied frame travels, and the page session is never read.
  const context = () => props.evaluateContext ?? (reader?.kind === "local" ? undefined : frame().evaluateContext);
  const obj = () => (props.value && typeof props.value === "object" && !Array.isArray(props.value))
    ? props.value as Record<string, unknown>
    : {};
  const publication = createMemo(() => ({ callback: props.onChange }));
  const record = createReaderRecordOperations(() => ({ value: obj(), fields: props.fields.map(field => field.name),
    ...(props.nativeRecordContext && (props.nativeRecordContext.evaluateContext === undefined
      ? props.evaluateContext === undefined : props.nativeRecordContext.evaluateContext === context())
      ? { representationTypeName: props.nativeRecordContext.representationTypeName } : {}),
  }), { evaluateContext: context, coordinate: () => ({ fields: props.fields, type: props.type, path: props.path }), publication });
  const paintedFields = () => record.paint()?.coordinate?.fields ?? props.fields;
  const paintedValue = () => record.paint()?.value as Record<string, unknown> | undefined;
  const recordError = () => {
    const issue = record.error();
    return issue instanceof Error ? issue.message : typeof issue === "string" ? issue : issue ? "This record's fields are unavailable." : undefined;
  };

  function setField(name: string, v: unknown, publish: (value: unknown) => void) {
    record.edit(name, v, publish);
  }

  return (
    <div class="vve-record" aria-busy={record.loading() ? "true" : "false"}>
      <Show when={record.paint()}>
      <div ref={record.guardElement} style={{ display: "contents" }} aria-disabled={record.ready() ? "false" : "true"}>
      <For keyed={false} each={paintedFields()}>
        {(field) => {
          const slot = () => record.paint()?.recordSlots.find(entry => entry.field === field().name)?.slot;
          const admitted = () => { const current = slot(); return current?.$tag === "Ok" ? current._0 : undefined; };
          const storedValue = () => { const current = admitted(); return current?.value.$tag === "Just" ? current.value._0 : undefined; };
          const publishField = createMemo(() => {
            const publish = props.onChange, currentField = field(), name = currentField.name;
            const publication = { field: currentField, parent: props.value, fields: props.fields, callback: (value: unknown): void => {
              if (latest(publishField) !== publication) return;
              setField(name, value, publish);
            } };
            return publication;
          });
          return (
          <div class="vve-field">
            <div class="vve-field-name">{field().name}</div>
            <div class="vve-field-value">
              <Show when={admitted()} fallback={<p class="text-muted" role="status">{(() => { const current = slot(); return current?.$tag === "Err" ? current._0 : "This record cannot be read safely."; })()}</p>}>
                {(stored) =>
              <ValueEditor
                type={field().type}
                evaluateContext={props.evaluateContext}
                nativeRecordContext={props.nativeRecordContext}
                recordValues={Object.create(null, {
                  ...Object.getOwnPropertyDescriptors(props.recordValues ?? {}),
                  ...Object.getOwnPropertyDescriptors(paintedValue() ?? {}),
                })}
                value={storedValue()}
                onChange={publishField().callback}
                path={[...props.path, stored().wire]}
                selectedPath={props.selectedPath}
                onSelectPath={props.onSelectPath}
              />
                }
              </Show>
            </div>
          </div>
          );
        }}
      </For>
      </div>
      </Show>
      <Show when={!record.ready() && !recordError()}><span class="text-muted" role="status">Preparing record fields…</span></Show>
      <Show when={recordError()}>{issue => <><p class="text-muted" role="alert">{issue()}</p>
        <button type="button" class="expr-form__btn" onClick={() => { void record.retry(); }}>Retry</button></>}</Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TupleEditor — fixed-arity positional record
// ---------------------------------------------------------------------------

function TupleEditor(props: ValueEditorProps & { elements: FenelType[] }) {
  const arr = () => Array.isArray(props.value) ? props.value : [];

  function setIndex(i: number, v: unknown, publish: (value: unknown) => void) {
    const next = arr().slice();
    while (next.length < props.elements.length) next.push(defaultValueFor(props.elements[next.length]!));
    next[i] = v;
    publish(next);
  }

  return (
    <div class="vve-tuple">
      <For each={props.elements}>
        {(t, i) => {
          const publishIndex = createMemo(() => {
            const publish = props.onChange, index = i();
            const publication = { parent: props.value, elements: props.elements, index, callback: (value: unknown): void => {
              if (latest(publishIndex) !== publication) return;
              setIndex(index, value, publish);
            } };
            return publication;
          });
          return (
          <div class="vve-field">
            <div class="vve-field-name">[{i()}]</div>
            <div class="vve-field-value">
              <ValueEditor
                type={t}
                recordValues={props.recordValues}
                evaluateContext={props.evaluateContext}
                nativeRecordContext={props.nativeRecordContext}
                value={arr()[i()]}
                onChange={publishIndex().callback}
                path={[...props.path, i()]}
                selectedPath={props.selectedPath}
                onSelectPath={props.onSelectPath}
              />
            </div>
          </div>
        ); }}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MapEditor — runtime-keyed dictionary: list of (key, value) entries with
// add / remove. Keys are free-form strings; values use the shared ValueEditor
// against the map's value type. Key-set constraints are NOT enforced here —
// validation surfaces (validate.ts / fenel-check.ts) own that, the editor is
// just a structural surface.
// ---------------------------------------------------------------------------

function MapEditor(props: ValueEditorProps & { valueType: FenelType }) {
  const [error, setError] = createSignal("");
  const obj = () =>
    props.value && typeof props.value === "object" && !Array.isArray(props.value)
      ? (props.value as Record<string, unknown>)
      : {};
  const entries = () => Object.entries(obj());

  function setKey(oldKey: string, newKey: string) {
    if (oldKey === newKey) return;
    if (Object.hasOwn(obj(), newKey)) { setError(`An entry named "${newKey}" already exists.`); return; }
    setError("");
    const next: Record<string, unknown> = {};
    for (const [k, v] of entries()) {
      Object.defineProperty(next, k === oldKey ? newKey : k, { value: v, enumerable: true, writable: true, configurable: true });
    }
    props.onChange(next);
  }
  function setValue(key: string, v: unknown, publish: (value: unknown) => void) {
    publish({ ...obj(), [key]: v });
  }
  function remove(key: string) {
    const next = { ...obj() };
    delete next[key];
    props.onChange(next);
  }
  function add() {
    const current = obj();
    let key = "key";
    let n = 1;
    while (key in current) key = `key${++n}`;
    props.onChange({ ...current, [key]: props.raw ? null : defaultValueFor(props.valueType) });
  }

  return (
    <div class="vve-map">
      <Show when={error()}><div role="alert">{error()}</div></Show>
      <For each={Object.keys(obj())}>
        {(k) => {
          const publishValue = createMemo(() => {
            const publish = props.onChange;
            const publication = { parent: props.value, type: props.valueType, callback: (value: unknown): void => {
              if (latest(publishValue) !== publication) return;
              setValue(k, value, publish);
            } };
            return publication;
          });
          return (
          <div class="vve-map-entry">
            <input
              type="text"
              class="vve-map-key"
              value={k}
              onChange={(e) => setKey(k, e.currentTarget.value)}
            />
            <span class="vve-map-arrow">→</span>
            <div class="vve-map-value">
              <ValueEditor
                raw={props.raw}
                recordValues={props.recordValues}
                evaluateContext={props.evaluateContext}
                nativeRecordContext={props.nativeRecordContext}
                type={props.valueType}
                value={obj()[k]}
                onChange={publishValue().callback}
                path={[...props.path, k]}
                selectedPath={props.selectedPath}
                onSelectPath={props.onSelectPath}
              />
            </div>
            <button
              type="button"
              class="vve-btn-icon vve-btn-remove"
              data-tooltip="Remove entry"
              onClick={() => remove(k)}
            >×</button>
          </div>
        ); }}
      </For>
      <button type="button" class="vve-btn-add" onClick={add}>+ Add entry</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AtomicEditor — string / number / boolean primitives
// ---------------------------------------------------------------------------

function AtomicEditor(props: ValueEditorProps & { typeName: string }) {
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const registry = useFieldPresentationRegistry();
  const local = () => reader?.kind === "local" && (!registry() || registry() === reader.session().registry);
  const planInput = createMemo(() => {
    if (!local()) return undefined;
    const session = reader!.session(), typeName = props.typeName;
    try {
      const worker = preparedReaderWorkerForSession(session);
      if (!worker) throw new Error("This number's editing tools are not ready.");
      return { session, typeName, worker };
    } catch (error) { return { session, typeName, error }; }
  });
  let planRequest: AbortController | undefined;
  let planAlive = true;
  onSettled(() => () => { planAlive = false; planRequest?.abort(); });
  const projectedPlan = createAsyncValue(() => ({ input: planInput() }), ({ input }) => {
    planRequest?.abort(); planRequest = undefined;
    if (!input) return undefined;
    if ("error" in input) throw input.error;
    const controller = new AbortController(); planRequest = controller;
    return runPreparedReaderWorker(input.worker, { method: "project-reader-numeric-codec", typeName: input.typeName }, controller.signal)
      .then(reply => {
        controller.signal.throwIfAborted();
        if (preparedReaderWorkerForSession(input.session) !== input.worker)
          throw new Error("This number's reader was replaced. Try again.");
        const result = reply as AuthoringReaderNumericCodec;
        if (!reply || typeof reply !== "object" || Array.isArray(reply) || !Object.hasOwn(reply, "codec")
          || result.codec !== undefined && (!result.codec || typeof result.codec !== "object"
            || Array.isArray(result.codec) || !Object.hasOwn(result.codec, "decode") || !Object.hasOwn(result.codec, "encode")))
          throw new Error("This number's text representation could not be read.");
        return { input, methods: result.codec };
      }).finally(() => { if (planRequest === controller) planRequest = undefined; });
  });
  const retainedPlan = createMemo(() => {
    const input = planInput();
    // Keep the settled projection as a tracked dependency. A latest-only read
    // can lose its wake-up when the outer Show switches to its pending branch.
    const projected = projectedPlan.loading ? latest(projectedPlan) : projectedPlan();
    return input && "worker" in input && projected?.input.session === input.session
      && projected.input.worker === input.worker && projected.input.typeName === input.typeName ? projected : undefined;
  });
  const ready = () => {
    if (!planAlive) return false;
    if (!local()) return true;
    const input = planInput();
    // An ancestor edit can retain its pending graph after this own lookup has
    // settled. Gate the native control on its actual request and exact packet.
    if (!input || !("worker" in input) || planRequest || !retainedPlan()) return false;
    try { return preparedReaderWorkerForSession(input.session) === input.worker; }
    catch { return false; }
  };
  const displayedName = () => local() ? retainedPlan()?.input.typeName ?? props.typeName : props.typeName;
  const binding = createMemo(() => {
    const projected = retainedPlan();
    return projected ? { session: projected.input.session, worker: projected.input.worker,
      typeName: projected.input.typeName, hasCodec: projected.methods !== undefined } : undefined;
  }, { equals: (left, right) => left?.session === right?.session && left?.worker === right?.worker
    && left?.typeName === right?.typeName && left?.hasCodec === right?.hasCodec });
  const codec = createMemo(() => {
    if (local()) {
      const current = binding();
      return current?.hasCodec ? numericTextCodec(current.session,
        { typeName: current.typeName }, { remote: true }) : undefined;
    }
    const session = reader?.session() ?? authoring;
    const methods = fieldNumericTextCodecPlan(props.typeName, session.evaluateContext);
    return methods ? numericTextCodec(session, { methods }) : undefined;
  });
  const change = createMemo(() => {
    const onChange = props.onChange;
    const publication = { owner: planInput(), callback: (value: unknown): void => {
      if (latest(change) !== publication) return;
      if (!latest(ready)) return;
      onChange(value);
    } };
    return publication;
  });
  return <Show when={!local() || !!retainedPlan()} fallback={
    <Show when={!projectedPlan.loading && projectedPlan.error}
      fallback={<span class="home-new-button__spinner" style="display:inline-block;width:12px;height:12px;position:static;vertical-align:middle" role="status" aria-label="Loading" />}>
      <span class="field-error" role="alert">This data's text representation is unavailable.</span>
    </Show>
  }><span aria-busy={!ready() ? "true" : undefined}><Switch fallback={
    <StringInputSurface inputType="text" class="vve-input" readonly={!ready()}
      value={typeof props.value === "string" ? props.value : ""} onChange={(value) => latest(change).callback(value)} />
  }>
    <Match when={displayedName() === "Unit"}><span>Unit <button type="button" aria-disabled={!ready() ? "true" : "false"} onClick={() => latest(change).callback(null)}>Set unit</button></span></Match>
    <Match when={displayedName() === "Bool" || displayedName() === "Boolean"}>
      <input
        type="checkbox"
        class="vve-input"
        aria-disabled={!ready() ? "true" : "false"}
        checked={props.value === true}
        onClick={(event) => { if (!latest(ready)) event.preventDefault(); }}
        onChange={(e) => latest(change).callback(e.currentTarget.checked)}
      />
    </Match>
    <Match when={!!codec() || ["Int", "Nat", "Rational", "Number", "Real"].includes(displayedName())}>
      <NumberInput
        class="vve-input"
        min={displayedName() === "Nat" ? 0 : undefined}
        step={displayedName() === "Int" || displayedName() === "Nat" ? 1 : "any"}
        value={props.value}
        textCodec={codec()}
        readonly={!ready()}
        onChange={change().callback}
      />
    </Match>
  </Switch></span></Show>;
}

// ---------------------------------------------------------------------------
// ArrowEditor — editor for $arrow values (callables)
//
// A callable value can be one of:
//   - { $ref: id } function reference            — a registered fn (the form
//                                                   FunctionPicker writes)
//   - function-name string ("add")               — legacy spelling of the same,
//                                                   still read
//   - { call: [name, ...args] } expression       — full call OR partial app
//   - { fn: [params, body] } lambda expression   — anonymous closure
//
// We render the FunctionCallEditor for the picker + per-param inputs (with
// the partial-application "Open" button to under-supply args). Two extra
// modes wrap the underlying editor:
//   "name"  — user picks a function and we store the bare codeName string
//             (the simplest callable: "use this function as-is")
//   "expr"  — user constructs a `call` expression via FunctionCallEditor.
//             Full application yields the function's RESULT (e.g. a Number),
//             which means it's only suitable when the field expects that
//             result type. For an $arrow field, only PARTIAL applications
//             make sense — those evaluate to a partial sentinel which IS a
//             callable.
//   "lambda"— anonymous closure: a comma-separated param row plus an
//             ExpressionEditor for the body. Stored as `{ fn: [params, body] }`.
// ---------------------------------------------------------------------------

function ArrowEditor(props: ValueEditorProps) {
  const session = useAuthoringSession();
  const [error, setError] = createSignal("");
  const [composing, setComposing] = createSignal(false);
  const reference = () => props.value == null || typeof props.value === "string"
    || refHandle(props.value) !== undefined;
  const node = createMemo(() => logicToExprNode(
    typeof props.value === "string" && props.value ? { $ref: props.value } : props.value,
    [], session,
  ));
  return <div class="vve-arrow">
    <Show when={props.value && typeof props.value === "object" && ((props.value as Record<string, unknown>).__fenelFn === true || (props.value as Record<string, unknown>).__fenelPartial === true)} fallback={
    <Show when={composing() || !reference()} fallback={<>
      <FieldRenderer identityMode="transient" registry={session.registry} callableRegistry={session.registry} compact
        field={{ name: "Callable", type: props.type, label: Nothing, ui: Nothing, meta: {} }}
        value={props.value} onChange={props.onChange} />
      <button type="button" class="vve-btn-add" onClick={() => setComposing(true)}>Compose callable</button>
    </>}><ExpressionEditor
      expr={node()}
      authoringSession={session}
      deferFunctionChoices
      fieldDef={{ name: "callable", type: props.type, label: Nothing, ui: Nothing, meta: {} }}
      paramName="Callable"
      onChange={(next) => {
        try { props.onChange(toLogic(next, undefined, session)); setError(""); }
        catch (error) { setError(error instanceof Error ? error.message : String(error)); }
      }}
    /></Show>
    }><RuntimeCallableEditor {...props} /></Show>
    <Show when={error()}><div role="alert">{error()}</div></Show>
  </div>;
}

function RuntimeCallableEditor(props: ValueEditorProps) {
  const session = useAuthoringSession();
  const value = () => props.value as Record<string, unknown>;
  const params = () => Array.isArray(value().params) ? (value().params as unknown[]).filter((name): name is string => typeof name === "string") : [];
  const hints = () => params().map((name) => ({ name, type: { $ref: "Value" } as FenelType }));
  const change = (key: string, next: unknown) => props.onChange({ ...value(), [key]: next });
  return <Show when={value().__fenelFn === true} fallback={
    <div class="vve-partial">
      <div>Partial application ({Array.isArray(value().collected) ? (value().collected as unknown[]).length : 0}/{String(value().arity)})</div>
      <ArrowEditor {...props} value={value().fn} onChange={(next) => change("fn", next)} />
      <ListEditor {...props} raw elementType={{ $ref: "Any" }} value={value().collected} onChange={(next) => change("collected", next)} />
    </div>
  }>
    <label>Closure parameters</label>
    <input type="text" aria-label="Closure parameters" value={params().join(", ")} onChange={(event) => change("params", event.currentTarget.value.split(",").map((name) => name.trim()).filter(Boolean))} />
    <LambdaParamsContext value={hints}>
      <ExpressionEditor expr={logicToExprNode(value().body, params(), session)} authoringSession={session} paramName="Closure body"
        onChange={(next) => change("body", toLogic(next, undefined, session))} />
    </LambdaParamsContext>
    <details><summary>Captured values</summary>
      <MapEditor {...props} raw valueType={{ $ref: "Any" }} value={value().closure} onChange={(next) => change("closure", next)} />
    </details>
  </Show>;
}
// ---------------------------------------------------------------------------
// Untyped values — recursive controls for every serializable value shape.
// ---------------------------------------------------------------------------

export function RawValueEditor(props: Omit<VariantValueEditorProps, "type">) {
  return <div class="vve-root">
    <Show when={props.label}><div class="vve-label">{props.label}</div></Show>
    <RawValueBody {...props} type={{ $ref: "Any" }} path={props.path ?? []} raw />
  </div>;
}

function RawValueBody(props: ValueEditorProps) {
  const kind = () => props.value instanceof Uint8Array || props.value instanceof ArrayBuffer ? "bytes" : props.value == null ? "null" : Array.isArray(props.value) ? "list"
    : typeof props.value === "object" && Object.getPrototypeOf(props.value) !== Object.prototype && Object.getPrototypeOf(props.value) !== null ? "host" : typeof props.value;
  const defaults: Record<string, unknown> = { null: null, string: "", number: 0, boolean: false, list: [], object: {} };
  return <div class="vve-raw">
    <LocusSelect label="Data kind" value={kind()}
      options={Object.keys(defaults).map((key) => ({ value: key, label: key === "object" ? "record" : key }))}
      fallbackOption={{ value: kind(), label: kind() }}
      onChange={(value) => { if (value !== kind()) props.onChange(defaults[value]); }} />
    <Switch>
      <Match when={kind() === "string"}><AtomicEditor {...props} typeName="String" /></Match>
      <Match when={kind() === "number"}><AtomicEditor {...props} typeName="Number" /></Match>
      <Match when={kind() === "boolean"}><AtomicEditor {...props} typeName="Bool" /></Match>
      <Match when={kind() === "list"}><ListEditor {...props} raw elementType={{ $ref: "Any" }} /></Match>
      <Match when={kind() === "object"}><MapEditor {...props} raw valueType={{ $ref: "Any" }} /></Match>
      <Match when={kind() === "null"}><span class="vve-unit">null</span></Match>
      <Match when={kind() === "bytes"}><BytesEditor value={props.value} onChange={props.onChange} /></Match>
      <Match when={kind() === "bigint" || kind() === "host"}><span>{typeof props.value === "bigint" ? `${props.value}n` : Object.prototype.toString.call(props.value)} — this host value has no declared JSON carrier.</span></Match>
    </Switch>
  </div>;
}

function BytesEditor(props: { value: unknown; onChange: (value: unknown) => void }) {
  const [draft, setDraft] = createSignal<{ source: unknown; text: string }>();
  const [error, setError] = createSignal("");
  const bytes = () => props.value instanceof Uint8Array ? props.value : props.value instanceof ArrayBuffer ? new Uint8Array(props.value)
    : Array.isArray(props.value) && props.value.every((byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255) ? props.value as number[] : [];
  const text = () => draft()?.source === props.value ? draft()!.text : Array.from(bytes(), (byte) => byte.toString(16).padStart(2, "0")).join(" ");
  return <div class="vve-bytes">
    <label>Bytes (hex)</label>
    <input type="text" aria-label="Bytes (hex)" value={text()} placeholder="00 ff 2a"
      onInput={(event) => {
        const next = event.currentTarget.value;
        setDraft({ source: props.value, text: next });
        const hex = next.replace(/\s+/g, "");
        if (hex.length % 2 || !/^[0-9a-f]*$/i.test(hex)) { setError("Enter two hexadecimal digits per byte."); return; }
        const changed = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
        const value = props.value instanceof ArrayBuffer ? changed.buffer : Array.isArray(props.value) ? Array.from(changed) : changed;
        props.onChange(value); setDraft({ source: value, text: next }); setError("");
      }} />
    <span>{bytes().length} bytes</span>
    <Show when={error()}><div role="alert">{error()}</div></Show>
  </div>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pathEquals(a: Path, b: Path): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
