// Existing Solid host-renderer boundary: read the shared card result owner.
// Loading the optional editor UI is independent of this checked reader.
import { createEffect, createSignal, Show } from "solid-js";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType } from "@fenel/engine/types";
import { ReaderRuntimeContext, type ReaderRuntime } from "./reader-runtime";
import { sessionEpoch } from "./browser-session";
import { createLocusCardEvaluation } from "./locus-card-evaluation";
import { CardLoadingIndicator, DataUnavailable } from "./value-card";
import { TypedReadValue } from "./layout-renderer/TypedReadValue";
import type { ContainedValuePreview } from "./data-transfer/DataValueSurface";
import type { DataOccurrenceSource } from "./data-occurrence";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import type { CardRead } from "./card-type-source";
import { linkedKind } from "./linked-data-graph-facts";

export default function EarlyReadValue(props: {
  runtime: ReaderRuntime;
  /** Source-owned facade; its async preparation belongs to the caller's Loading boundary. */
  sourceSession?: () => AuthoringSession;
  node: ExprNode;
  saved: ReadonlyMap<string, ExprNode>;
  type?: FenelType;
  compact?: boolean;
  /** Current occurrence metadata stays live through the shared read body. */
  valueIcon?: string;
  /** An already checked read uses the same body without starting another run. */
  value?: { value: unknown };
  onOpenData?: (data: ContainedValuePreview) => void;
  onDataContext?: (event: MouseEvent, data: ContainedValuePreview) => void;
  occurrence?: DataOccurrenceSource;
  onOpenType?: (type: FenelType) => void;
  /** The value once read, with its own type constructor (the linked-data
   * graph's card kind): the card's caption names an undecided type by it. */
  onRead?: (read: CardRead) => void;
}) {
  const [closed, setClosed] = createSignal(false);
  createEffect(() => props.runtime.client.signal, signal => {
    const hide = () => setClosed(true);
    setClosed(signal?.aborted === true);
    signal?.addEventListener("abort", hide, { once: true });
    return () => signal?.removeEventListener("abort", hide);
  });
  const evaluation = createLocusCardEvaluation(() => {
    const base = props.runtime.session();
    const session = props.sourceSession ? props.sourceSession() : base;
    if (!props.sourceSession && (props.runtime.captureSourceMetadata || base.captureSourceMetadata))
      throw new Error("This data's source tools are still preparing.");
    return { expr: props.node, saved: props.saved, session, evaluated: props.value };
  });
  const current = () => !closed() && props.runtime.epoch === sessionEpoch();
  createEffect(() => {
    if (!props.onRead || !current() || evaluation.loading()) return undefined;
    const read = evaluation.value();
    return read.error ? undefined : read;
  }, read => {
    if (!read) return;
    let kind: string | undefined;
    try { kind = linkedKind(props.sourceSession ? props.sourceSession() : props.runtime.session(), undefined, read.result); }
    catch { kind = undefined; }
    props.onRead?.({ value: read.result, ...(kind ? { kind } : {}) });
  });
  return <Show when={current()} fallback={<CardLoadingIndicator label="Preparing data reader…" />}>
    <Show when={!evaluation.loading()} fallback={<CardLoadingIndicator label="Computing data…" />}>
      <Show when={!evaluation.value().error} fallback={<DataUnavailable label={evaluation.value().error!} />}>
        <ReaderRuntimeContext value={props.runtime}>
          <TypedReadValue value={evaluation.value().result} type={props.type} compact={props.compact} valueIcon={props.valueIcon}
            onOpenData={props.onOpenData} onOpenType={props.onOpenType} onDataContext={props.onDataContext} occurrence={props.occurrence} />
        </ReaderRuntimeContext>
      </Show>
    </Show>
  </Show>;
}
