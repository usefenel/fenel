import { Match, Show, Switch, createMemo, createSignal, For } from "solid-js";
import type { FenelType, FieldDef, SetExpr } from "@fenel/engine/types";
import { contains, type MaybeBool } from "@fenel/engine/set-algebra";
import { pureEvaluateContext } from "@fenel/engine/expressions";
import { resolveAuthoringTypeRef } from "@fenel/engine/authoring/environment";
import { Nothing } from "@fenel/engine/type-foundation";
import { FieldRenderer, ExprFieldContext } from "~/lib/field-renderer";
import { RecordValuesContext } from "~/lib/field-renderer/record-values-context";
import { useAuthoringSession } from "~/lib/expression-runner/authoring-session";
import { evaluateWithTrace } from "@fenel/engine";
import { ExpressionTrace, type ExpressionTraceSnapshot } from "~/lib/expression-runner";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { createAsyncValue } from "~/lib/async-value";
import { preparedReaderWorkerForSession, runPreparedReaderWorker, type PreparedReaderWorker } from "~/lib/expression-runner/authoring-catalog-worker";
import type { AuthoringSetMembership } from "~/lib/expression-runner/authoring-worker-protocol";

type Example = { id: number; value: unknown };

/** Browser-owned sample drafts. Membership and its undecided result belong to
 * the existing engine judgment; opening/editing the panel never runs it. */
export function SetExprExamples(props: { set: SetExpr; baseType: FenelType }) {
  const session = useAuthoringSession();
  const reader = useReaderRuntime();
  // B3: a Local reader decides membership in its worker frame (a `$where`
  // predicate may call Local functions); the page never evaluates it.
  const localWorker = (): PreparedReaderWorker | undefined => {
    if (reader?.kind !== "local") return undefined;
    try { return preparedReaderWorkerForSession(session); } catch { return undefined; }
  };
  const [checking, setChecking] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  let nextId = 2;
  const [examples, setExamples] = createSignal<Example[]>([{ id: 1, value: undefined }]);
  const [run, setRun] = createSignal<{
    set: SetExpr;
    baseType: FenelType;
    examples: Example[];
    results: Map<number, MaybeBool>;
  }>();
  const currentRun = () => {
    const last = run();
    return last?.set === props.set && last.baseType === props.baseType && last.examples === examples()
      ? last : undefined;
  };
  const [inspection, setInspection] = createSignal<{
    run: NonNullable<ReturnType<typeof run>>;
    exampleId: number;
    snapshot: ExpressionTraceSnapshot;
  }>();
  function inspectExample(example: Example) {
    const last = currentRun();
    if (!last || last.set.$tag !== "SeWhere") return;
    if (reader?.kind === "local") {
      const worker = localWorker();
      const unavailable = { result: undefined, trace: [], error: "This predicate cannot be inspected until the data tools are ready." };
      if (!worker) { setInspection({ run: last, exampleId: example.id, snapshot: unavailable }); return; }
      void runPreparedReaderWorker(worker, { method: "check-set-membership", set: last.set, values: [], trace: { value: example.value } })
        .then(reply => (reply as AuthoringSetMembership).trace as ExpressionTraceSnapshot | undefined ?? unavailable, () => unavailable)
        .then(snapshot => { if (currentRun() === last) setInspection({ run: last, exampleId: example.id, snapshot }); });
      return;
    }
    let snapshot: ExpressionTraceSnapshot;
    try {
      snapshot = evaluateWithTrace(last.set.pred, { value: example.value }, pureEvaluateContext(session.evaluateContext));
    } catch (error) {
      snapshot = { result: undefined, trace: [], error: error instanceof Error ? error.message : String(error) };
    }
    setInspection({ run: last, exampleId: example.id, snapshot });
  }
  // B4 F1: a Local reader resolves its base type in its worker with the
  // page's own `resolveAuthoringTypeRef` (`resolve-reader-type-ref`); the
  // example field is then planned there too. Until that answer the field is
  // not shown; the page environment is never read.
  const localBaseType = createAsyncValue(() => reader?.kind === "local" ? { baseType: props.baseType, worker: localWorker() } : undefined,
    async input => {
      if (!input.worker) throw new Error("This reader's editing tools are not ready.");
      const reply = await runPreparedReaderWorker(input.worker, { method: "resolve-reader-type-ref", type: input.baseType });
      const answer = (reply as { typeRef?: { resolved?: FenelType } }).typeRef;
      if (!answer || typeof answer !== "object") throw new Error("This field's editor is unavailable.");
      return { input, type: answer.resolved ?? input.baseType };
    });
  const field = createMemo<FieldDef | undefined>(() => {
    let type: FenelType;
    if (reader?.kind === "local") {
      const answer = localBaseType.loading ? undefined : localBaseType();
      if (!answer || answer.input.baseType !== props.baseType) return undefined;
      type = answer.type;
    } else type = resolveAuthoringTypeRef(session.environment, props.baseType) ?? props.baseType;
    return { name: "example", label: Nothing, type, meta: {}, ui: Nothing };
  });
  function runExamples() {
    const set = props.set;
    const baseType = props.baseType;
    const snapshot = examples();
    if (reader?.kind === "local") {
      const filled = snapshot.filter(example => example.value !== undefined);
      const worker = localWorker();
      const settle = (verdicts: readonly MaybeBool[] | undefined) => {
        const results = new Map<number, MaybeBool>();
        filled.forEach((example, index) => results.set(example.id, verdicts?.[index] ?? Nothing));
        setRun({ set, baseType, examples: snapshot, results });
      };
      if (!worker) { settle(undefined); return; }
      setChecking(true);
      void runPreparedReaderWorker(worker, { method: "check-set-membership", set, values: filled.map(example => example.value) })
        .then(reply => settle((reply as AuthoringSetMembership).verdicts), () => settle(undefined))
        .finally(() => setChecking(false));
      return;
    }
    const context = pureEvaluateContext(session.evaluateContext);
    const results = new Map<number, MaybeBool>();
    for (const example of snapshot) {
      if (example.value === undefined) continue;
      try {
        results.set(example.id, contains(set, example.value, null, undefined, context));
      } catch {
        results.set(example.id, Nothing);
      }
    }
    setRun({ set, baseType, examples: snapshot, results });
  }
  return (
    <section class="sev-examples" aria-label="Constraint examples">
      <button type="button" class="sev-add" aria-expanded={open() ? "true" : "false"} onClick={() => setOpen(!open())}>
        {open() ? "Hide examples" : "Try examples"}
      </button>
      <Show when={open()}>
        <p class="sev-hint">Try values against this constraint. Each result applies only to its example.</p>
        <div class="sev-examples__rows">
          <For keyed={false} each={examples()}>
            {(example, index) => {
              const result = () => currentRun()?.results.get(example().id);
              return (
                <div class="sev-examples__row" role="group" aria-label={`Example ${index + 1}`}>
                  <span class="sev-examples__number">{index + 1}</span>
                  <div class="sev-examples__value">
                    <ExprFieldContext value={null}>
                    <RecordValuesContext value={() => ({})}>
                    <Show when={field()} fallback={<span class="text-muted" role={localBaseType.error ? "alert" : "status"}>
                      {localBaseType.error ? "This field's editor is unavailable." : "Preparing field…"}</span>}>{exampleField =>
                    <FieldRenderer
                      identityMode="transient"
                      field={exampleField()}
                      value={example().value}
                      compact
                      onChange={(value) => setExamples((rows) => rows.map((row) => row.id === example().id ? { ...row, value } : row))}
                    />}</Show>
                    </RecordValuesContext>
                    </ExprFieldContext>
                  </div>
                  <div class="sev-examples__result" aria-live="polite">
                    <Switch fallback={<span class="sev-examples__pending">{example().value === undefined ? "Enter a value" : run() ? "Run again" : "Not run"}</span>}>
                      <Match when={checking() && example().value !== undefined}>
                        <span class="sev-examples__pending" role="status">Checking…</span>
                      </Match>
                      <Match when={result()?.$tag === "Nothing"}>
                        <span class="sev-examples__unknown" data-tooltip="The engine could not decide membership for this example.">Undetermined</span>
                      </Match>
                      <Match when={result()?.$tag === "Just"}>
                        <Show when={(result() as { _0: boolean })._0} fallback={<span class="sev-fail">Does not match</span>}>
                          <span class="sev-pass">Matches</span>
                        </Show>
                      </Match>
                    </Switch>
                  </div>
                  <Show when={examples().length > 1}>
                    <button type="button" class="sev-x" aria-label={`Remove example ${index + 1}`}
                      onClick={() => setExamples((rows) => rows.filter((row) => row.id !== example().id))}>&times;</button>
                  </Show>
                  <Show when={currentRun()?.set.$tag === "SeWhere" && example().value !== undefined}>
                    <button type="button" class="sev-add" onClick={() => inspectExample(example())}>
                      Inspect predicate
                    </button>
                  </Show>
                  <Show when={inspection()?.run === currentRun() && inspection()?.exampleId === example().id && inspection()}>
                    {(trace) => <div class="sev-examples__trace">
                      <p class="sev-hint">Predicate execution for example {index + 1}. Membership is shown separately above.</p>
                      <ExpressionTrace snapshot={trace().snapshot} authoringSession={session} />
                    </div>}
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
        <div class="sev-examples__actions">
          <button type="button" class="sev-add" onClick={() => setExamples((rows) => [...rows, { id: nextId++, value: undefined }])}>Add example</button>
          <button type="button" class="sev-chip sev-chip--active" disabled={examples().every((row) => row.value === undefined)} onClick={runExamples}>Run examples</button>
        </div>
      </Show>
    </section>
  );
}
