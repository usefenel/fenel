// ---------------------------------------------------------------------------
// VariantValueRenderer — display a runtime value of a recursive ADT
//
// Given a FenelType and a value, walks the structure (using structuralView from
// the engine) and renders each constructor + its fields. Element-typed fields
// render as values; recursive fields recurse with the same FenelType.
//
// Falls back to JS-array / JS-string fast paths for List and String, since
// those are the conventional repr — same as the structural ops in the engine.
// Exact numeric text is supplied by source codecs in the captured reader.
// ---------------------------------------------------------------------------

import { Show, For, NotReadyError, createMemo, onSettled } from "solid-js";
import { structuralView, isVariantValue, caseTag } from "@fenel/engine";
import { typeConstructorOf } from "../../../../../../implementations/typescript/engine/src/effect-dispatch";
import type { FenelType } from "@fenel/engine/types";
import { peelListForAuthoring as peelList, resolveValueType, nativeValueTypeName } from "@fenel/engine/authoring/type";
import { formatRuntimeValue } from "~/lib/runtime-value-display";
import { useAuthoringSession } from "~/lib/expression-runner/authoring-session";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { numericTextCodec } from "~/lib/numeric-text-codec";
import { fieldNumericTextCodecPlan } from "@fenel/engine/authoring/field-render";
import { DelimitedText } from "~/lib/data-transfer/DataPreview";
import { createAsyncValue } from "~/lib/async-value";
import { localReaderReadSession, preparedReaderWorkerForSession, runPreparedReaderWorker } from "~/lib/expression-runner/authoring-catalog-worker";
import type { AuthoringReaderNumericEncode, AuthoringReaderValueReads } from "~/lib/expression-runner/authoring-worker-protocol";
import { registryTransportSnapshot } from "../../../../../../implementations/typescript/engine/src/registry";
import { ConstructorGlyph, useItemPresentation } from "~/lib/item-glyph";

export type VariantValueRendererProps = {
  type: FenelType;
  value: unknown;
  depth?: number;
  /** The owning reader resolves names; a sibling account's catalog is never
   * a fallback when that reader supplies this callback. */
  resolveType?: (name: string) => FenelType | undefined;
  /** Optional presentation from the owning reader; never replaces a handle. */
  callableName?: (handle: string) => string | undefined;
  /** Bound nested DOM for thumbnails while retaining the same type walk. */
  compact?: boolean;
};
type RenderOptions = Pick<VariantValueRendererProps, "resolveType" | "compact" | "callableName">;

export function VariantValueRenderer(props: VariantValueRendererProps) {
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  const depth = () => props.depth ?? 0;
  const binary = () => props.value instanceof Uint8Array || props.value instanceof ArrayBuffer;
  const type = createMemo(() => binary() ? props.type : resolveValueType(props.type, props.resolveType));
  // B3: a Local reader reflects values and encodes numeric text in its worker;
  // the page never reflects or runs a codec for Local data. Recursive slots
  // use $void as an absent hint; their concrete type comes from the same
  // function/draft session as the enclosing read, never the committed base.
  const local = () => reader?.kind === "local";
  const generic = (candidate: FenelType) => "$void" in candidate || "$var" in candidate || "$complement" in candidate && "$void" in candidate.$complement;
  const nativeName = createMemo(() => {
    const declared = nativeValueTypeName(type());
    if (declared) return declared;
    if (local()) return undefined;
    return typeConstructorOf(props.value, (reader?.session() ?? authoring).evaluateContext);
  });
  const localNumericInput = createMemo(() => {
    if (!local() || binary() || depth() >= (props.compact ? 2 : 16)
      || props.value === null || props.value === undefined) return undefined;
    const name = nativeName();
    if (!name && !generic(type()) || name && !fieldNumericTextCodecPlan(name)) return undefined;
    try {
      const session = localReaderReadSession(reader!.session(), authoring, reader!.registry());
      const worker = session && preparedReaderWorkerForSession(session);
      if (!worker) throw new Error("This reader's display tools are not ready.");
      return { name, worker, value: registryTransportSnapshot(props.value, "recursive reader numeric value", "value-read", Reflect.get) };
    } catch (error) {
      if (error instanceof NotReadyError) throw error;
      return { error };
    }
  });
  let numericRequest: AbortController | undefined;
  onSettled(() => () => numericRequest?.abort());
  const localNumeric = createAsyncValue(() => ({ input: localNumericInput() }), async ({ input }) => {
    numericRequest?.abort(); numericRequest = undefined;
    if (!input) return undefined;
    if ("error" in input) throw input.error;
    const controller = new AbortController(); numericRequest = controller;
    const { worker, value } = input;
    let name = input.name;
    if (!name) {
      const reply = await runPreparedReaderWorker(worker, { method: "project-reader-values", knownIcons: [],
        inputs: [{ value, compact: true, typeLookup: "session", views: [], componentNames: [] }] }, controller.signal);
      controller.signal.throwIfAborted();
      const packets = (reply as AuthoringReaderValueReads).valueReads;
      if (!Array.isArray(packets) || packets.length !== 1 || !packets[0]?.root
        || typeof packets[0].root !== "object" || Array.isArray(packets[0].root)) throw new Error("This data's display is unavailable.");
      const observed = packets[0].root.valueType ?? packets[0].root.displayType;
      if (observed !== undefined && (!observed || typeof observed !== "object" || Array.isArray(observed))) throw new Error("This data's display type is unavailable.");
      name = observed ? nativeValueTypeName(resolveValueType(observed, props.resolveType)) : undefined;
    }
    if (!name || !fieldNumericTextCodecPlan(name)) return { input, text: undefined };
    const reply = await runPreparedReaderWorker(worker, { method: "encode-reader-numeric-text", codec: { typeName: name }, value }, controller.signal);
    controller.signal.throwIfAborted();
    const encoded = (reply as AuthoringReaderNumericEncode).encoded;
    if (!encoded || typeof encoded.ok !== "boolean" || encoded.ok && typeof encoded.value !== "string") throw new Error("This data's numeric text is unavailable.");
    return { input, text: encoded.ok ? encoded.value : undefined };
  });
  const localNumericPending = () => {
    const input = localNumericInput();
    if (!input) return false;
    if (localNumeric.error) return false;
    const result = localNumeric();
    return localNumeric.loading || result?.input !== input;
  };
  const numericText = createMemo(() => {
    if (local()) {
      const result = localNumeric();
      return !localNumeric.loading && result?.input === localNumericInput() ? result?.text : undefined;
    }
    const name = nativeName();
    const methods = name ? fieldNumericTextCodecPlan(name) : undefined;
    if (!methods) return undefined;
    const text = numericTextCodec(reader?.session() ?? authoring, methods).encode(props.value);
    return text.ok ? text.value : undefined;
  });

  return (
    <Show when={depth() < (props.compact ? 2 : 16)} fallback={<span class="vvr-fade" data-tooltip="The complete data is retained">…</span>}>
    <Show when={!localNumericInput() || !localNumeric.error} fallback={<span><span class="text-muted" role="alert">Display unavailable.</span>{" "}
      <button type="button" class="expr-form__btn" onClick={() => { void localNumeric.refetch(); }}>Retry</button></span>}>
    <Show when={!localNumericPending()} fallback={<span class="vvr-fade" role="status" aria-label="Loading">…</span>}>
    <Show when={numericText() !== undefined} fallback={
    <Show when={binary()} fallback={
    <Show when={"$arrow" in type()} fallback={
    <Show when={"$record" in type() && props.value !== null && typeof props.value === "object" && !Array.isArray(props.value)} fallback={
    <Show
      when={isVariantValue(props.value)}
      fallback={<PrimitiveRender type={type()} value={props.value} depth={depth()} resolveType={props.resolveType} compact={props.compact} callableName={props.callableName} />}
    >
      <VariantRender type={type()} value={props.value as Record<string, unknown>} depth={depth()} resolveType={props.resolveType} compact={props.compact} callableName={props.callableName} />
    </Show>
    }><ObjectRender type={type()} value={props.value as Record<string, unknown>} depth={depth()} resolveType={props.resolveType} compact={props.compact} callableName={props.callableName} /></Show>
    }><ArrowRender value={props.value} callableName={props.callableName} /></Show>
    }><span class="vvr-bytes">{formatRuntimeValue(props.value)}</span></Show>
    }><span class="vvr-prim" style="white-space: nowrap;">{numericText()}</span></Show>
    </Show>
    </Show>
    </Show>
  );
}

function ArrowRender(props: { value: unknown; callableName?: (handle: string) => string | undefined }) {
  const display = (handle: string) => props.callableName?.(handle) ?? handle;
  const nameOf = (value: unknown): string => typeof value === "string" ? display(value)
    : value && typeof value === "object" && "$ref" in value ? display(String(value.$ref)) : "λ";
  const summary = createMemo(() => {
    const value = props.value;
    if (typeof value === "string") return value ? `ƒ ${display(value)}` : "(no callable)";
    if (!value || typeof value !== "object") return "(no callable)";
    if ("$ref" in value) return `ƒ ${display(String(value.$ref))}`;
    if ("fn" in value && Array.isArray(value.fn)) {
      const args = value.fn;
      const params = Array.isArray(args[0]) ? args[0] : args.slice(0, -1);
      return `λ(${params.join(", ")}) → ${formatScalar(args.at(-1))}`;
    }
    if ("__fenelPartial" in value) {
      const partial = value as { fn?: unknown; collected?: unknown[]; arity?: number };
      return `ƒ ${nameOf(partial.fn)}(${(partial.collected ?? []).map(formatScalar).join(", ")}, …)`;
    }
    if ("__fenelFn" in value || "__fenelClosure" in value) {
      const closure = value as { params?: string[] };
      return `λ(${(closure.params ?? []).join(", ")})`;
    }
    if ("call" in value && Array.isArray(value.call)) return `ƒ ${nameOf(value.call[0])}(${value.call.slice(1).map(formatScalar).join(", ")})`;
    return formatScalar(value);
  });
  return <span class="vvr-fn-name" style="color: #6b7280; font-weight: 500;">{summary()}</span>;
}
// ---------------------------------------------------------------------------
// Primitive / fast-path rendering
// ---------------------------------------------------------------------------

function PrimitiveRender(props: { type: FenelType; value: unknown; depth: number } & RenderOptions) {
  const v = () => props.value;
  return (
    <Show
      when={Array.isArray(v())}
      fallback={
        <Show when={typeof v() === "string"} fallback={
          <Show when={v() !== null && typeof v() === "object"} fallback={<span class="vvr-prim">{formatScalar(v())}</span>}>
            <ObjectRender type={props.type} value={v() as Record<string, unknown>} depth={props.depth} resolveType={props.resolveType} compact={props.compact} callableName={props.callableName} />
          </Show>
        }>
          <StringRender value={v() as string} type={props.type} resolveType={props.resolveType} />
        </Show>
      }
    >
      <ArrayRender type={props.type} value={v() as unknown[]} depth={props.depth} resolveType={props.resolveType} compact={props.compact} callableName={props.callableName} />
    </Show>
  );
}

function ObjectRender(props: { type: FenelType; value: Record<string, unknown>; depth: number } & RenderOptions) {
  function fieldType(name: string): FenelType {
    if ("$record" in props.type) return props.type.$record.fields.find((field) => field.name === name)?.type ?? { $void: true };
    if ("$map" in props.type) return props.type.$map.values;
    return { $void: true };
  }
  const entries = createMemo(() => Object.entries(props.value).filter(([name]) => name !== "$tag"
    || !("$record" in props.type) || props.type.$record.fields.some(field => field.name === name)));
  return <span class="vvr-record">{"{"}<For each={props.compact ? entries().slice(0, 3) : entries()}>{([name, value], index) => <>
    <Show when={index() > 0}>, </Show><span class="vvr-field-name">{name}: </span>
    <VariantValueRenderer type={fieldType(name)} value={value} depth={props.depth + 1} resolveType={props.resolveType} compact={props.compact} callableName={props.callableName} />
  </>}</For><Show when={props.compact && entries().length > 3}>, …</Show>{"}"}</span>;
}

function StringRender(props: { value: string; type?: FenelType; resolveType?: (name: string) => FenelType | undefined }) {
  return <DelimitedText value={props.value} type={props.type} resolveType={props.resolveType} />;
}

function ArrayRender(props: { type: FenelType; value: unknown[]; depth: number } & RenderOptions) {
  // For List<a>, a is the inner element type — try to extract from the FenelType
  const elemType = createMemo(() => extractListElement(props.type));
  return (
    <span class="vvr-array">
      <span class="vvr-bracket">[</span>
      <For each={props.compact ? props.value.slice(0, 3) : props.value}>
        {(item, i) => (
          <>
            <Show when={i() > 0}><span class="vvr-comma">, </span></Show>
            <VariantValueRenderer type={"$tuple" in props.type ? props.type.$tuple[i()] ?? { $void: true } : elemType() ?? { $void: true }} value={item} depth={props.depth + 1} resolveType={props.resolveType} compact={props.compact} callableName={props.callableName} />
          </>
        )}
      </For>
      <Show when={props.compact && props.value.length > 3}>, …</Show>
      <span class="vvr-bracket">]</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Variant rendering — uses structuralView to classify cases and fields
// ---------------------------------------------------------------------------

function VariantRender(props: {
  type: FenelType;
  value: Record<string, unknown>;
  depth: number;
} & RenderOptions) {
  const view = createMemo(() => structuralView(props.type));
  // case-to-tag-discriminator Step 1: read the discriminator via caseTag so a
  // value carrying either `$tag` (canonical) or the legacy `__case` renders.
  const tag = () => caseTag(props.value);
  const caseInfo = createMemo(() =>
    view()?.cases.find((c) => c.name === tag())
  );
  const hasFields = () => Object.keys(props.value).some((key) => key !== "$tag" && key !== "__case");
  // A nullary constructor reads as its own Labelable (`_ : Labelable "SevenCatYear"`),
  // keyed by its tag as its glyph is, and shows its own picture or emoji before
  // it (a project's logo). A Local reader answers both from its worker.
  const presentation = useItemPresentation();
  const shownName = createMemo(() => {
    const name = tag();
    if (typeof name !== "string" || hasFields()) return name;
    return presentation.name(props.value) ?? name;
  });
  const glyph = () => hasFields() ? null : <ConstructorGlyph value={props.value} presentation={presentation} />;

  return (
    <Show
      when={caseInfo()}
      fallback={
        <Show when={tag()} fallback={
          <span class="vvr-unknown" data-tooltip="No matching case in FenelType">
            <ObjectRender type={props.type} value={props.value} depth={props.depth} resolveType={props.resolveType} compact={props.compact} callableName={props.callableName} />
          </span>
        }>{(_name) => <span class="vvr-unknown" data-tooltip="No matching case in FenelType">
          <span class="vvr-variant">
            {glyph()}
            <span class="vvr-case-name">{shownName()}</span>
            <Show when={hasFields()}>
              <ObjectRender type={props.type} value={props.value} depth={props.depth} resolveType={props.resolveType} compact={props.compact} callableName={props.callableName} />
            </Show>
          </span>
        </span>}</Show>
      }
    >
      <span class="vvr-variant">
        {glyph()}
        <span class="vvr-case-name">{shownName()}</span>
        <Show when={caseInfo()!.fields.length > 0}>
          <span class="vvr-paren">(</span>
          <For each={props.compact ? caseInfo()!.fields.slice(0, 3) : caseInfo()!.fields}>
            {(field, i) => (
              <>
                <Show when={i() > 0}><span class="vvr-comma">, </span></Show>
                <span class="vvr-field-name">{field.name}: </span>
                <Show
                  when={field.isRecursive}
                  fallback={<VariantValueRenderer type={field.type} value={props.value[field.name]} depth={props.depth + 1} resolveType={props.resolveType} compact={props.compact} callableName={props.callableName} />}
                >
                  <VariantValueRenderer
                    type={props.type}
                    value={props.value[field.name]}
                    depth={props.depth + 1}
                    resolveType={props.resolveType}
                    compact={props.compact} callableName={props.callableName}
                  />
                </Show>
              </>
            )}
          </For>
          <Show when={props.compact && caseInfo()!.fields.length > 3}>, …</Show>
          <span class="vvr-paren">)</span>
        </Show>
      </span>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return formatRuntimeValue(v);
  if (typeof v === "string") return JSON.stringify(v);
  return formatRuntimeValue(v);
}

/** Best-effort extraction of element type from a List-shaped FenelType.
 *  Recognises both shorthand `List(T)` and canonical
 *  `$opaque { repr: "array", pure: μX. Nil | Cons … }`. */
function extractListElement(t: FenelType): FenelType | undefined {
  const list = peelList(t);
  if (list) return list.elem;
  // See through other $opaque layers (non-List-shaped) for legacy paths.
  let core = t;
  while ("$opaque" in core && core.$opaque.pure) {
    const inner = peelList(core);
    if (inner) return inner.elem;
    core = core.$opaque.pure;
  }
  return undefined;
}
