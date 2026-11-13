// LAUNCH-PLAN row 9: a function card's sampled plot. Two worker requests, no
// language fact decided here: `judge-reader-function-graph` asks the Fenel
// `engine:functionGraphDomain` whether the card's arrow is a pure
// one-parameter numeric function and over which x range to sample; then the
// worker evaluates `DrawingDemo.functionGraph` (in the reduced pure frame,
// under the worker's existing deadline) and the shared LineChart draws the
// plan. A function that is not sampled, a pending reader and a failed run all
// leave the card as it was.

import { Show, createEffect, createSignal, untrack } from "solid-js";
import type { FenelType, FieldDef } from "@fenel/engine/types";
import { authoringSessionAccountScope, type AuthoringSession } from "./expression-runner/authoring-session";
import { authoringWorkerSnapshot, evaluateExpressionInWorker, runAuthoringWorker } from "./expression-runner/authoring-catalog-worker";
import { sessionEpoch } from "./browser-session";
import { LineChart, type PointLineChartValue } from "./charts";
import { useReaderRuntime } from "./reader-runtime";
import { drawableFunctionGraph, functionGraphNode, graphHandles, judgedRange } from "./function-graph-plan";
import "./function-graph.css";

export function FunctionGraph(props: {
  pinId: string;
  arrow: { params: readonly FieldDef[]; returns: FenelType } | undefined;
  session: () => AuthoringSession;
}) {
  const [chart, setChart] = createSignal<PointLineChartValue | undefined>(undefined);
  const reader = useReaderRuntime();
  createEffect(() => {
    // Track the arrow, the reader's handles and the worker; not the session's
    // function list (a list change must not restart the sampling).
    const session = untrack(() => props.session());
    const arrow = props.arrow;
    const worker = authoringWorkerSnapshot(session);
    const handles = arrow && arrow.params.length === 1 ? graphHandles(reader, session, props.pinId) : undefined;
    return { arrow, worker, handles, epoch: sessionEpoch() };
  }, (key) => {
    setChart(undefined);
    if (!key.arrow || !key.worker || !key.handles) return;
    const { arrow, handles } = key;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      const session = props.session();
      const judged = runAuthoringWorker(session, { method: "judge-reader-function-graph", functionId: handles.fn,
        params: [...arrow.params], returns: arrow.returns }, controller.signal, authoringSessionAccountScope(session));
      const range = judgedRange(await judged);
      if (cancelled || !range) return;
      const evaluation = await evaluateExpressionInWorker(session, functionGraphNode(handles, range), new Map(), controller.signal,
        authoringSessionAccountScope(session), { admitInvocations: true, pure: true, priority: "guidance" });
      if (!cancelled) setChart(drawableFunctionGraph(evaluation?.result));
    })().catch(() => { /* not drawn: the card stays as it was */ });
    return () => {
      cancelled = true;
      controller.abort();
    };
  });
  return <Show when={chart()}>{value => <div class="function-graph" data-function-graph="true" aria-label="Sampled plot">
    <LineChart value={value()} />
  </div>}</Show>;
}
