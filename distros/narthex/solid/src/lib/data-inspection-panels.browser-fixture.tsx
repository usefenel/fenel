// C2 browser harness: real panel JSX/lazy boundary, controlled unavailable
// source declaration. The other panels are lifetime markers, not data renderers.
import { createSignal, Errored, flush, onSettled, untrack } from "solid-js";
import { render } from "@solidjs/web";
import { Just, Nothing } from "@fenel/engine/maybe-value";
import { decodeReplayValue, encodeReplayValue } from "../../../../../implementations/typescript/engine/src/engine-body-value-transport";
import type { LensShortcut } from "./lens-shortcuts";
import type { DataSuggestionBatch, DataSuggestionInput, DataSuggestionOptions } from "./data-suggestions";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import {
  createDataInspectionSuggestions,
  DataInspectionControls,
  DataInspectionPanels,
  DataInspectionSuggestionsPanel,
  type DataInspectionMode,
  type DataInspectionSuggestions,
} from "./DataInspectionDialog";

type Marker = "data" | "expression" | "code" | "dependencies";
type Counts = Record<Marker, { mounts: number; cleanups: number }>;
const emptyCounts = (): Counts => ({ data: { mounts: 0, cleanups: 0 },
  expression: { mounts: 0, cleanups: 0 }, code: { mounts: 0, cleanups: 0 },
  dependencies: { mounts: 0, cleanups: 0 } });
let counts = emptyCounts();
let holds = 0, releases = 0, retries = 0;
let declarationLookups: string[] = [], escapedErrors: string[] = [];
let dispose: (() => void) | undefined;
let controlsState: { mode: DataInspectionMode; opens: number; closes: number; selections: number } = {
  mode: "data", opens: 0, closes: 0, selections: 0,
};
let changeMode: (mode: DataInspectionMode) => void = () => {
  throw new Error("Mount the panel fixture first.");
};

type SuggestionRecording = {
  schema: "fenel.suggestions-ui-recording.v1";
  encoding: "fenel.engine-body-value-transport";
  provenance: { beforeCommit: string; beforeSourceSha256: string; afterCommit: string; afterSourceSha256: string; sameReaderProcess: true;
    context: { sourceId: string; sourceFunction?: string; activeTags: string[]; numberHandle: string; catalogueFunctionIds: string[] } };
  inputText: string;
  options: { maxOperations: number; maxSuggestions: number; reuse: false };
  before: { batchText: string; sha256: string };
  after: { batchText: string; sha256: string };
};
type RecordedSuggestionState = {
  recording: SuggestionRecording; side: "before" | "after"; input: DataSuggestionInput;
  session: AuthoringSession; worker: object; owner?: DataInspectionSuggestions;
  calls: number; preparations: number; requestInputText?: string; requestOptions?: DataSuggestionOptions;
};
let recorded: RecordedSuggestionState | undefined;
function recordedSource(session: AuthoringSession): RecordedSuggestionState {
  if (!recorded || recorded.session !== session) throw new Error("No recorded Suggestions transport belongs to this reader.");
  return recorded;
}

function LifetimeMarker(props: { kind: Marker }) {
  const kind = untrack(() => props.kind);
  const lifetime = ++counts[kind].mounts;
  const [clicks, setClicks] = createSignal(0);
  onSettled(() => () => { counts[kind].cleanups += 1; });
  return <div data-fixture-marker={kind} data-lifetime={lifetime}>
    <p>Fixture {kind} owner</p>
    <input aria-label={`Fixture ${kind} draft`} value={`Retained ${kind} draft`} />
    <button type="button" aria-label={`Fixture ${kind} local state`}
      onClick={() => setClicks(value => value + 1)}>Local count: {clicks()}</button>
  </div>;
}

// No declaration is admitted, and no policy/inference/body renderer is called.
// This intentionally incomplete acquisition tests the real source's refusal.
function unavailableSuggestionOwner(): DataInspectionSuggestions {
  return {
    items: () => [], pending: () => false, issue: () => undefined,
    read: () => ({ session: { registry: {
      getIdentifiedEntity(name: string) { declarationLookups.push(name); return undefined; },
    } }, batch: { suggestions: [], undecided: [], revision: "unavailable-source" },
      source: { state: "unavailable", issue: "This fixture query has no reusable source expression." } }) as
      unknown as ReturnType<DataInspectionSuggestions["read"]>,
    hold: () => { holds += 1; return () => { releases += 1; }; },
    open: () => { retries += 1; },
    close: () => {}, invalidate: () => {}, warm: () => {},
    select: () => { throw new Error("The absent source cannot select a suggestion."); },
  };
}

const fixture = {
  mountRecordedSuggestions(recording: SuggestionRecording, side: "before" | "after", width = 900) {
    fixture.dispose();
    if (recording.schema !== "fenel.suggestions-ui-recording.v1" || recording.encoding !== "fenel.engine-body-value-transport") {
      throw new Error("Unsupported Suggestions recording.");
    }
    if (side !== "before" && side !== "after") throw new Error("Choose the before or after checker recording.");
    const input = decodeReplayValue(recording.inputText) as DataSuggestionInput;
    const batch = decodeReplayValue(recording[side].batchText) as DataSuggestionBatch;
    if (input.expression?.kind !== "literal" || input.expression.value !== 5 || input.value !== 5
      || !input.type || !("$ref" in input.type) || input.type.$ref !== recording.provenance.context.numberHandle) {
      throw new Error("This capture requires the recorded value 5 with its Number identity.");
    }
    if (batch.$tag !== "RankedSuggestions" || batch.revision !== input.revision
      || [...batch.suggestions, ...batch.undecided].some(candidate => candidate.revision !== input.revision)) {
      throw new Error("The recorded Suggestions batch does not belong to its captured input.");
    }
    if (recording.options.reuse !== false) throw new Error("The checker recording must retain its uncached provenance.");
    const state: RecordedSuggestionState = { recording, side, input, calls: 0, preparations: 0,
      session: Object.freeze({ recordedReader: recording.provenance.context.sourceId }) as unknown as AuthoringSession,
      worker: Object.freeze({ recordedWorker: side }) };
    recorded = state;
    const host = document.getElementById("fixture");
    if (!host) throw new Error("The browser fixture requires #fixture.");
    dispose = render(() => {
      const [mode, setMode] = createSignal<DataInspectionMode>("data");
      const owner = createDataInspectionSuggestions(() => ({
        session: state.session, input: state.input, current: () => recorded === state,
        select: () => { throw new Error("A recorded checker reply cannot authorize expression preparation."); },
      }));
      state.owner = owner;
      return <section data-fixture-recorded-suggestions style={{ width: `${width}px`, "max-width": "100%" }}>
        <h1>Recorded checker replies — {side === "before" ? "before" : "after"}</h1>
        <p>Value: 5 · Number UUID: <code>{recording.provenance.context.numberHandle}</code></p>
        <p>Actual Suggestions menu. Replies come from a recorded, uncached check; this is not a live worker run.</p>
        <div style={{ "container-type": "inline-size", "container-name": "lens-toolbar" }}>
          <DataInspectionControls mode={mode()} onModeChange={setMode} shortcuts={[]} suggestionOwner={owner}
            code={false} dependencies={false} />
        </div>
      </section>;
    }, host);
    flush();
  },
  recordedWorkerSnapshot(session: AuthoringSession) { return recordedSource(session).worker; },
  async discoverRecordedSuggestions(session: AuthoringSession, input: DataSuggestionInput,
    options: DataSuggestionOptions, signal?: AbortSignal): Promise<DataSuggestionBatch> {
    const state = recordedSource(session);
    signal?.throwIfAborted();
    const inputText = encodeReplayValue(input);
    if (inputText !== state.recording.inputText) throw new Error("The UI asked a different question from the checker recording.");
    // `reuse:false` records the uncached checker. The production UI supplies
    // only its window; compare those exact options without claiming cache timing.
    const { reuse: _reuse, ...window } = state.recording.options;
    if (Object.keys(options).length !== Object.keys(window).length
      || Object.entries(window).some(([key, value]) => options[key as keyof DataSuggestionOptions] !== value)) {
      throw new Error("The UI requested a different operation window from the checker recording.");
    }
    state.calls++; state.requestInputText = inputText; state.requestOptions = { ...options };
    return decodeReplayValue(state.recording[state.side].batchText) as DataSuggestionBatch;
  },
  prepareRecordedSuggestion(session: AuthoringSession): never {
    recordedSource(session).preparations++;
    throw new Error("Recorded Suggestions cannot prepare an expression; use the live reader checker.");
  },
  recordedSuggestionsState() {
    const state = recorded;
    if (!state) throw new Error("Mount the recorded Suggestions fixture first.");
    const published = state.owner?.read()?.batch;
    return { side: state.side, calls: state.calls, preparations: state.preparations,
      inputText: state.requestInputText, recordedInputText: state.recording.inputText,
      options: state.requestOptions, recordedOptions: state.recording.options,
      batchText: state.recording[state.side].batchText, publishedBatchText: published && encodeReplayValue(published),
      confirmed: published?.suggestions.map(({ identity, label, missingArguments }) => ({ identity, label, missingArguments })) ?? [],
      undecided: published?.undecided.map(({ identity, label }) => ({ identity, label })) ?? [],
      coverage: published?.coverage, pending: state.owner?.pending(), issue: state.owner?.issue() };
  },
  mountControls(width = 390, options: { code?: boolean; dependencies?: boolean } = {}) {
    fixture.dispose();
    controlsState = { mode: "data", opens: 0, closes: 0, selections: 0 };
    const shortcuts: LensShortcut[] = [
      { $tag: "LensShortcut", id: "data", label: "Data", icon: "box",
        operation: { $tag: "PresentLensSubject", subject: { $tag: "CurrentDataSubject" } },
        disposition: { $tag: "PresentExistingData" }, presentation: Nothing },
      { $tag: "LensShortcut", id: "expression", label: "Expression", icon: "git-branch",
        operation: { $tag: "PresentLensSubject", subject: { $tag: "ProducerExpressionSubject" } },
        disposition: { $tag: "PresentExistingData" }, presentation: Nothing },
      { $tag: "LensShortcut", id: "code", label: "Code", icon: "code",
        operation: { $tag: "PresentLensSubject", subject: { $tag: "ProducerExpressionSubject" } },
        disposition: { $tag: "PresentExistingData" }, presentation: Just({ $tag: "CodePresentation" }) },
    ];
    const host = document.getElementById("fixture");
    if (!host) throw new Error("The browser fixture requires #fixture.");
    dispose = render(() => {
      const [mode, setMode] = createSignal<DataInspectionMode>("data");
      const owner: DataInspectionSuggestions = {
        ...unavailableSuggestionOwner(),
        open: () => { controlsState.opens += 1; }, close: () => { controlsState.closes += 1; },
        items: () => [{ id: "fixture-dynamic-suggestion", label: "Reverse text", icon: "arrow-left-right",
          separatorBefore: true, onSelect: () => { controlsState.selections += 1; } }],
      };
      return <section data-fixture-controls style={{ width: `${width}px`, "max-width": "100%",
        "container-type": "inline-size", "container-name": "lens-toolbar" }}>
        <DataInspectionControls mode={mode()} onModeChange={next => { controlsState.mode = next; setMode(next); }}
          shortcuts={shortcuts} suggestionOwner={owner} code={options.code} dependencies={options.dependencies} />
      </section>;
    }, host);
    flush();
  },
  controlsState() { return structuredClone(controlsState); },
  mount(initial: DataInspectionMode = "data") {
    fixture.dispose();
    counts = emptyCounts(); holds = 0; releases = 0; retries = 0;
    declarationLookups = []; escapedErrors = [];
    const host = document.getElementById("fixture");
    if (!host) throw new Error("The browser fixture requires #fixture.");
    dispose = render(() => {
      const [mode, setMode] = createSignal<DataInspectionMode>(initial);
      changeMode = next => { setMode(next); flush(); };
      const owner = unavailableSuggestionOwner();
      return <Errored fallback={error => {
        escapedErrors.push(String(error()));
        return <pre data-fixture-escaped-error>{String(error())}</pre>;
      }}>
        <DataInspectionPanels mode={mode()}
          data={() => <LifetimeMarker kind="data" />}
          expression={() => <LifetimeMarker kind="expression" />}
          code={() => <LifetimeMarker kind="code" />}
          dependencies={() => <LifetimeMarker kind="dependencies" />}
          suggestions={() => <DataInspectionSuggestionsPanel owner={owner} />} />
      </Errored>;
    }, host);
    flush();
  },
  mode(next: DataInspectionMode) { changeMode(next); },
  state() { return { counts: structuredClone(counts), holds, releases, retries,
    bodyAcquisitions: globalThis.__relatedDataPanelAcquisitions ?? 0,
    declarationLookups: [...declarationLookups], escapedErrors: [...escapedErrors] }; },
  dispose() {
    dispose?.(); dispose = undefined;
    recorded = undefined;
    document.getElementById("fixture")?.replaceChildren();
    flush();
  },
};

declare global { var dataInspectionPanelsFixture: typeof fixture; var __relatedDataPanelAcquisitions: number | undefined; }
globalThis.dataInspectionPanelsFixture = fixture;
