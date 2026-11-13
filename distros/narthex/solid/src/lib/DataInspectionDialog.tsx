import { createEffect, createMemo, createSignal, Errored, For, Show, Loading, onSettled, lazy } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import { IconByName } from "./icons";
import { openModalDialog, closeModalDialog } from "./confirm-modal";
import { loadPublicBootstrap } from "./public-bootstrap";
import { peelMaybeValue } from "@fenel/engine/maybe-value";
import type { LensShortcut } from "./lens-shortcuts";
import { LocusContextMenu, type LocusMenuItem } from "./locus-context-menu";
import type { DataSuggestion, DataSuggestionBatch, DataSuggestionInput, SuggestionDisposition } from "./data-suggestions";
import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { AuthoringSession } from "./expression-runner/account-authoring-session";
import "./data-inspection-dialog.css";
import { createPanelMotion } from "./panel-motion";
import { LocusLoadFailure } from "./locus-notifications";
import { CardLoadingIndicator } from "./value-card";
import { nextPreviewIndex } from "./suggestion-settle";
import type { DataOccurrenceSource } from "./data-occurrence";

const SuggestionReadPanel = lazy(() => import("./related-data-panels").then(module => ({ default: module.SuggestionReadPanel })));

export type DataInspectionPanel = "suggestions" | "data" | "expression" | "code" | "dependencies";
type LegacyDataInspectionMode = "data" | "expression" | "both" | "code" | "data-code" | "expression-code" | "all";
/** Visibility is transient browser chrome. Saved lens/data/placement owners
 * remain unchanged; existing callers keep all seven original identifiers. */
export type DataInspectionMode = LegacyDataInspectionMode | { panels: readonly DataInspectionPanel[] };

export type DataInspectionSuggestions = {
  items: () => readonly LocusMenuItem[];
  open: () => void;
  close: () => void;
  invalidate: () => void;
  /** Shared query lifetime while an ordinary related-data panel is mounted. */
  hold: () => () => void;
  warm: () => void;
  pending: () => boolean;
  issue: () => string | undefined;
  read: () => { session: AuthoringSession; batch: DataSuggestionBatch;
    /** Producer of the rendered presentation list, including its Fenel
     * projection; neither a raw batch nor a candidate result is that list. */
    source: DataOccurrenceSource;
    /** The data the suggestions are for, when its value was captured (a
     * suggestion row shows it small beside the input it fills). */
    subject?: { value: unknown; type?: DataSuggestionInput["type"] } } | undefined;
  /** Apply through the captured source's own port. `evaluate` asks that port
   * to show the computed result at once; `arguments` fill the recipe's open
   * input slots in order (an inline argument editor's typed literals). */
  select: (suggestion: DataSuggestion, options?: SuggestionSelectOptions) => void;
  /** The destinations the captured source supports (the first is its fallback). */
  dispositions?: () => readonly SuggestionDisposition[];
  /** An action's default destination for this source. */
  defaultDisposition?: (suggestion: DataSuggestion) => SuggestionDisposition;
  /** The computed result of a retained confirmed suggestion, in the reduced
   * pure frame, while a panel holds this query. Absent: no preview requested. */
  preview?: (suggestion: DataSuggestion, args?: readonly ExprNode[]) => SuggestionPreview | undefined;
};

/** `disposition`: apply the action at once, replacing the selected data in
 * place (ApplyToDraft) or making new data from it (CreateDerivedData); without
 * it the action opens as a draft in the New data composer. */
export type SuggestionSelectOptions = { evaluate?: boolean; arguments?: readonly ExprNode[]; disposition?: SuggestionDisposition };
export type SuggestionPreview = { state: "pending" } | { state: "ready"; value: unknown }
  | { state: "unavailable"; issue?: string };

/** Menu lifecycle only. The captured reader's existing inference and Fenel
 * policy own discovery, applicability, ranking and expression admission. */
export function createDataInspectionSuggestions(capture: () => {
  session: AuthoringSession;
  input: DataSuggestionInput;
  /** The destinations this source supports (review S4), the first being its
   * fallback; absent: both. The expression editor only replaces in place. */
  dispositions?: readonly SuggestionDisposition[];
  current: () => boolean;
  select: (node: ExprNode, suggestion: DataSuggestion, options?: { evaluate?: boolean; disposition?: SuggestionDisposition }) => void;
  reportIssue?: (message: string) => void;
}): DataInspectionSuggestions {
  const [batch, setBatch] = createSignal<DataSuggestionBatch>();
  const [pending, setPending] = createSignal(false);
  const [issue, setIssue] = createSignal<string>();
  let controller: AbortController | undefined;
  let captured: ReturnType<typeof capture> | undefined;
  let worker: object | undefined;
  let workerApi: typeof import("./expression-runner/authoring-catalog-worker") | undefined;
  let preparation: AbortController | undefined;
  // The first check covers the 32 best-fitting operations (the catalogue
  // prefix is ordered by type fit); More operations widens to 128/512/1024.
  // Each plan is a full inference in the shared worker: 128 relevant plans for
  // a list outlived the worker's 180 s job allowance on a loaded host.
  let activeLimit = 32;
  let disposed = false;
  let holders = 0;
  let completed: { source: ReturnType<typeof capture>; revision: string; worker: object;
    maxOperations: number; batch: DataSuggestionBatch } | undefined;
  // Previews: one sequential lane per completed batch, cancelled with it and
  // run only while a panel holds this query (a menu never evaluates).
  const [previews, setPreviews] = createSignal<ReadonlyMap<string, SuggestionPreview>>(new Map());
  let previewRun: { batch: DataSuggestionBatch; controller: AbortController; queue: Array<{ key: string; suggestion: DataSuggestion;
    args?: readonly ExprNode[] }>; running: boolean; known: Map<string, SuggestionPreview> } | undefined;
  function stopPreviews() { if (!previewRun) return; previewRun.controller.abort(); previewRun = undefined; setPreviews(new Map()); }
  function previewKey(suggestion: DataSuggestion, args?: readonly ExprNode[]) {
    return args?.length ? `${suggestion.identity}|${JSON.stringify(args)}` : suggestion.identity;
  }
  function publishPreview(run: NonNullable<typeof previewRun>, key: string, value: SuggestionPreview) {
    if (previewRun !== run) return;
    run.known.set(key, value); setPreviews(new Map(run.known));
  }
  /** A lane paused by a passing state (its reader momentarily not current)
   * tries again while it is still this batch's lane; a new batch, a release
   * or a cancel replaces it and the retries stop. */
  function retryPreviews(run: NonNullable<typeof previewRun>) {
    if (previewRun === run && !run.controller.signal.aborted && completed?.batch === run.batch)
      setTimeout(() => { if (previewRun === run && !run.running) void drainPreviews(run); }, 1_000);
  }
  async function drainPreviews(run: NonNullable<typeof previewRun>) {
    if (run.running) return;
    run.running = true;
    try {
      while (previewRun === run && !run.controller.signal.aborted && run.queue.length) {
        const source = completed?.source;
        const api = workerApi;
        // A lane that cannot run now keeps its jobs: the next read resumes it
        // (minichart: a dropped job left every later row without its result).
        if (!source || completed?.batch !== run.batch || !current() || !api?.evaluateExpressionInWorker) { retryPreviews(run); return; }
        // Calendar and chart rows first (suggestion-settle.ts).
        const job = run.queue.splice(nextPreviewIndex(run.queue.map(queued => queued.suggestion)), 1)[0]!;
        try {
          const prepared = await api.prepareDataSuggestionInWorker(source.session, job.suggestion, source.input, run.controller.signal);
          if (!prepared || !prepared.ok) { publishPreview(run, job.key, { state: "unavailable", ...(prepared ? { issue: prepared.issue } : {}) }); continue; }
          const node = job.args ? fillSuggestionArguments(prepared.node, job.args) : prepared.node;
          if (!node) { publishPreview(run, job.key, { state: "unavailable" }); continue; }
          // The reduced pure frame: a function only an IO handler implements
          // does not resolve. Guidance priority yields to every other job.
          const evaluated = await api.evaluateExpressionInWorker(source.session, node, new Map(source.input.savedExpressions ?? []),
            run.controller.signal, undefined, { pure: true, priority: "guidance", trace: false });
          if (previewRun !== run) return;
          if (!current()) { run.queue.unshift(job); retryPreviews(run); return; }
          const value = evaluated?.result;
          const failed = value === undefined || value === null || (typeof value === "object"
            && Object.keys(value).length === 1 && "error" in value);
          publishPreview(run, job.key, failed ? { state: "unavailable" } : { state: "ready", value });
        } catch (error) {
          if (run.controller.signal.aborted || previewRun !== run) return;
          publishPreview(run, job.key, { state: "unavailable", issue: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally { run.running = false; }
  }
  function previewFor(suggestion: DataSuggestion, args?: readonly ExprNode[]): SuggestionPreview | undefined {
    const result = batch();
    if (!result || !holders || !completed || completed.batch !== result) return undefined;
    if (suggestion.applicability.$tag !== "Just" || !suggestion.applicability._0) return undefined;
    if (suggestion.missingArguments > 0 && (args?.length ?? 0) !== suggestion.missingArguments) return undefined;
    const key = previewKey(suggestion, args);
    const known = previews().get(key);
    if (known) return known;
    if (!previewRun || previewRun.batch !== result) {
      previewRun?.controller.abort();
      previewRun = { batch: result, controller: new AbortController(), queue: [], running: false, known: new Map() };
    }
    const run = previewRun;
    if (!run.known.has(key) && !run.queue.some(job => job.key === key)) {
      run.queue.push({ key, suggestion, ...(args ? { args } : {}) });
      queueMicrotask(() => { void drainPreviews(run); });
    } else if (!run.running && run.queue.length) queueMicrotask(() => { void drainPreviews(run); });
    return { state: "pending" };
  }
  function sourceCurrent() {
    try { return !!captured?.current(); } catch { return false; }
  }
  function current() {
    if (!captured || !controller || controller.signal.aborted || !sourceCurrent()) return false;
    try { return !!worker && worker === workerApi?.authoringWorkerSnapshot(captured.session); } catch { return false; }
  }
  function cancel() { controller?.abort(); controller = undefined; captured = undefined; worker = undefined; stopPreviews(); }
  function close() { if (!holders) cancel(); }
  onSettled(() => () => { disposed = true; completed = undefined; cancel(); preparation?.abort(); preparation = undefined; });
  function open(maxOperations = 32) {
    if (disposed) return;
    try {
      const nextSource = capture();
      // Warming, a menu and a visible panel ask the same captured question.
      // Join its in-flight discovery or completed value instead of restarting.
      if (captured && controller && !controller.signal.aborted && sourceCurrent()
        && captured.session === nextSource.session && captured.input.revision === nextSource.input.revision
        && nextSource.current() && activeLimit === maxOperations
        && (pending() && (!worker || current()) || current() && !!batch())) {
        if (!pending()) setIssue(undefined);
        return;
      }
      activeLimit = maxOperations;
      preparation?.abort(); preparation = undefined;
      cancel(); setBatch(undefined); setIssue(undefined); setPending(true);
      captured = nextSource;
      const request = new AbortController(); controller = request;
      const input = captured.input;
      const session = captured.session;
      const source = captured;
      const retained = completed; completed = undefined;
      let reuse = false;
      try {
        reuse = !!retained && retained.source.session === session && retained.revision === input.revision
          && retained.maxOperations === maxOperations && retained.source.current() && sourceCurrent()
          && retained.worker === workerApi?.authoringWorkerSnapshot(session);
      } catch { /* An unreadable old reader is a miss, never a shared projection. */ }
      if (retained && reuse) {
        worker = retained.worker;
        completed = { ...retained, source };
        setBatch(retained.batch); setPending(false); return;
      }
      const options = { maxOperations, maxSuggestions: 20 };
      // Early-reader controls retain their lightweight shell. Complete
      // authoring tools activate only when this menu is explicitly opened.
      const discovering = (async () => {
        const loadedWorker = await import("./expression-runner/authoring-catalog-worker");
        if (controller !== request || request.signal.aborted || !sourceCurrent()) throw new DOMException("Cancelled", "AbortError");
        workerApi = loadedWorker;
        worker = workerApi.authoringWorkerSnapshot(session);
        const job = workerApi.discoverDataSuggestionsInWorker(session, input, options, request.signal);
        if (!job) throw new Error("Suggestions are not ready yet. Try again.");
        return job;
      })();
      void discovering.then(result => {
        if (controller !== request || request.signal.aborted) return;
        if (!current() || result.revision !== input.revision) {
          setIssue("This data changed. Open Suggestions again."); setPending(false); return;
        }
        completed = { source, revision: input.revision, worker: worker!, maxOperations, batch: result };
        setBatch(result); setPending(false);
      }).catch(error => {
        if (controller !== request || request.signal.aborted) return;
        if (!sourceCurrent()) { setIssue("This data changed. Open Suggestions again."); setPending(false); return; }
        setIssue(error instanceof Error ? error.message : String(error)); setPending(false);
      });
    } catch (error) { completed = undefined; cancel(); setBatch(undefined); setIssue(error instanceof Error ? error.message : String(error)); setPending(false); }
  }
  async function select(suggestion: DataSuggestion, source: ReturnType<typeof capture> | undefined, selectedWorker: object | undefined,
    options?: SuggestionSelectOptions) {
    // LocusContextMenu closes before invoking a selected row. Retain only
    // that row's source snapshot; closing still cancels pending discovery.
    const valid = () => {
      try { return !disposed && !!source && source === completed?.source && source.current()
        && suggestion.revision === source.input.revision && !!selectedWorker
        && selectedWorker === workerApi?.authoringWorkerSnapshot(source.session); } catch { return false; }
    };
    if (!valid() || !source) {
      const message = "This data changed. Open Suggestions again.";
      setIssue(message); source?.reportIssue?.(message); return;
    }
    preparation?.abort();
    const request = new AbortController(); preparation = request;
    // Apply here rewrites the data's own authored expression: prepare the
    // recipe over that copy, never over the reference to the data itself
    // (which would refer to its own result). New data reads the reference.
    const supported = source.dispositions ?? BOTH_DISPOSITIONS;
    const disposition = options?.disposition && !supported.includes(options.disposition) ? supported[0] : options?.disposition;
    const input = disposition === "ApplyToDraft" ? { ...source.input, reference: undefined } : source.input;
    try {
      const job = workerApi?.prepareDataSuggestionInWorker(source.session, suggestion, input, request.signal);
      if (!job) throw new Error("Suggestions are not ready yet. Try again.");
      const prepared = await job;
      if (preparation !== request || request.signal.aborted) return;
      if (!valid()) throw new Error("This data changed. Open Suggestions again.");
      if (!prepared.ok) throw new Error(prepared.issue);
      const node = options?.arguments ? fillSuggestionArguments(prepared.node, options.arguments) : prepared.node;
      if (!node) throw new Error("Fill this action's inputs, or open its expression.");
      if (options?.evaluate || disposition) source.select(node, suggestion, { ...(options?.evaluate ? { evaluate: true } : {}),
        ...(disposition ? { disposition } : {}) });
      else source.select(node, suggestion);
    } catch (error) {
      if (preparation !== request || request.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      setIssue(message); source.reportIssue?.(message);
    } finally { if (preparation === request) preparation = undefined; }
  }
  function actionChoices(suggestion: DataSuggestion, source: ReturnType<typeof capture> | undefined, selectedWorker: object | undefined): LocusMenuItem[] {
    const preferred = defaultDisposition(suggestion, source);
    const other: SuggestionDisposition = preferred === "ApplyToDraft" ? "CreateDerivedData" : "ApplyToDraft";
    const supported = source?.dispositions ?? BOTH_DISPOSITIONS;
    return [
      ...(supported.includes(other) ? [{ id: `data-suggestion-choice:${suggestion.identity}:${other}`,
        label: other === "ApplyToDraft" ? "Apply here" : "New data from this", icon: other === "ApplyToDraft" ? "check" : "plus",
        onSelect: () => select(suggestion, source, selectedWorker, { evaluate: true, disposition: other }) }] : []),
      { id: `data-suggestion-choice:${suggestion.identity}:draft`, label: "Open expression", icon: "code",
        onSelect: () => select(suggestion, source, selectedWorker) },
    ];
  }
  const items = createMemo<LocusMenuItem[]>(() => {
    const result = batch();
    if (issue()) return [{ id: "data-suggestions-issue", label: issue()!, icon: "alert-circle", disabled: true, separatorBefore: true }];
    if (pending()) return [{ id: "data-suggestions-pending", label: "Checking suggestions…", icon: "loader-circle", disabled: true, separatorBefore: true }];
    if (!result) return [];
    const selectedSource = captured;
    const selectedWorker = worker;
    const rows: LocusMenuItem[] = [
      ...result.suggestions.map(suggestion => ({ id: `data-suggestion:${suggestion.identity}`, label: suggestion.label,
        icon: suggestion.icon, shortcut: suggestion.missingArguments ? `Needs arguments (${suggestion.missingArguments})` : undefined,
        tooltip: suggestion.missingArguments ? "Open an expression draft and fill its remaining arguments."
          : defaultDisposition(suggestion, selectedSource) === "ApplyToDraft" ? "Apply here: replace this data with the result."
          : "New data from this, kept up to date.",
        // A complete action applies at once by its default destination (demo 1);
        // its submenu offers the other supported destination and its draft.
        onSelect: () => select(suggestion, selectedSource, selectedWorker, suggestion.missingArguments ? undefined
          : { evaluate: true, disposition: defaultDisposition(suggestion, selectedSource) }),
        ...(suggestion.missingArguments ? {} : { children: actionChoices(suggestion, selectedSource, selectedWorker) }) })),
      ...result.undecided.map(suggestion => ({ id: `data-suggestion-unresolved:${suggestion.identity}`, label: suggestion.label,
        icon: suggestion.icon, shortcut: "Check unresolved", tooltip: "The type check could not confirm this operation for the current data.", disabled: true })),
    ];
    if (!rows.length) rows.push({ id: "data-suggestions-empty", label: "No confirmed suggestions in this check", disabled: true });
    const coverage = result.coverage;
    // Keep partial coverage visible without developer operation counts,
    // including skipped/omitted results and when the expansion limit is reached.
    if (coverage.truncated || coverage.skipped || result.omittedConfirmed || result.omittedUndecided) rows.push({
      id: "data-suggestions-coverage", label: "Some operations or suggestions are not shown yet.",
      tooltip: "This list reflects a partial check.", disabled: true, separatorBefore: true,
    });
    const checkedLimit = activeLimit;
    if (coverage.truncated && checkedLimit < 1024 && coverage.operationsChecked < (coverage.operationsAvailable ?? coverage.operationsSeen)) rows.push({
      id: "data-suggestions-more", label: "More operations", icon: "search", keepOpen: true, separatorBefore: true,
      tooltip: "Look for more operations that fit this data.", onSelect: () => {
        if (!current() || captured !== selectedSource) { setIssue("This data changed. Open Suggestions again."); return; }
        open(checkedLimit < 128 ? 128 : checkedLimit < 512 ? 512 : 1024);
      },
    });
    if (rows[0]) rows[0].separatorBefore = true;
    return rows;
  });
  return { items, open, close, pending, issue,
    dispositions: () => completed?.source.dispositions ?? captured?.dispositions ?? BOTH_DISPOSITIONS,
    defaultDisposition: suggestion => defaultDisposition(suggestion, completed?.source ?? captured),
    read: () => {
      const result = batch();
      return result && captured && current() && result.revision === captured.input.revision
        ? { session: captured.session, batch: result, source: { state: "unavailable",
          issue: "No reusable source for this Suggestions list." },
          ...(captured.input.value !== undefined ? { subject: { value: captured.input.value, type: captured.input.type ?? captured.input.scheme?.body } } : {}) }
        : undefined;
    },
    select: (suggestion, options) => { void select(suggestion, completed?.source, completed?.worker, options); },
    preview: previewFor,
    warm: () => { if (!disposed) open(); },
    hold: () => {
      holders += 1;
      if (!current()) open();
      let released = false;
      return () => { if (released) return; released = true; holders -= 1; if (!holders) stopPreviews(); close(); };
    },
    invalidate: () => {
    completed = undefined; cancel(); preparation?.abort(); preparation = undefined;
    setBatch(undefined); setPending(false); setIssue("This data changed. Open Suggestions again.");
    if (holders) queueMicrotask(() => { if (!disposed && holders) open(); });
  } };
}

const BOTH_DISPOSITIONS: readonly SuggestionDisposition[] = ["CreateDerivedData", "ApplyToDraft"];
/** The Fenel default destination of a ranked action, within what its source supports. */
function defaultDisposition(suggestion: DataSuggestion, source: { dispositions?: readonly SuggestionDisposition[] } | undefined): SuggestionDisposition {
  const supported = source?.dispositions ?? BOTH_DISPOSITIONS;
  const preferred = suggestion.disposition ?? "CreateDerivedData";
  return supported.includes(preferred) ? preferred : supported[0]!;
}

/** Fill a prepared recipe's open input slots (incomplete `undefined` literals,
 * in source order) with the given argument expressions. A recipe whose open
 * slots do not match the arguments one for one is refused (`undefined`). */
function fillSuggestionArguments(node: ExprNode, args: readonly ExprNode[]): ExprNode | undefined {
  let next = 0;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (record.kind === "literal" && Object.hasOwn(record, "value") && record.value === undefined && Object.keys(record).length === 2) {
      const filled = args[next++];
      return filled ?? value;
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, visit(child)]));
  };
  const filled = visit(node) as ExprNode;
  return next === args.length ? filled : undefined;
}

const panelOrder: readonly DataInspectionPanel[] = ["suggestions", "data", "expression", "code", "dependencies"];
const legacyPanels: Record<LegacyDataInspectionMode, readonly DataInspectionPanel[]> = {
  data: ["data"], expression: ["expression"], both: ["data", "expression"], code: ["code"],
  "data-code": ["data", "code"], "expression-code": ["expression", "code"], all: ["data", "expression", "code"],
};
function visiblePanels(mode: DataInspectionMode): readonly DataInspectionPanel[] {
  return typeof mode === "string" ? legacyPanels[mode] : mode.panels;
}

export function dataInspectionPanelVisible(mode: DataInspectionMode, panel: DataInspectionPanel): boolean {
  return visiblePanels(mode).includes(panel);
}

export function toggleDataInspectionPanel(mode: DataInspectionMode, panel: DataInspectionPanel): DataInspectionMode {
  const current = visiblePanels(mode);
  const next = panelOrder.filter(candidate => candidate === panel ? !current.includes(candidate) : current.includes(candidate));
  if (!next.length) return panel === "data" ? "expression" : "data";
  for (const [legacy, panels] of Object.entries(legacyPanels)) {
    if (panels.length === next.length && panels.every(candidate => next.includes(candidate))) return legacy as LegacyDataInspectionMode;
  }
  return { panels: next };
}

export function DataInspectionControls(props: { mode: DataInspectionMode; onModeChange: (mode: DataInspectionMode) => void;
  code?: boolean; dependencies?: boolean; shortcuts?: readonly LensShortcut[]; onShortcut?: (shortcut: LensShortcut) => void;
  suggestionOwner?: DataInspectionSuggestions }) {
  const [suggestionsAt, setSuggestionsAt] = createSignal<{ x: number; y: number }>();
  let suggestionsTrigger: HTMLButtonElement | undefined;
  const defaults = createMemo(async () => {
    const bootstrap = await loadPublicBootstrap();
    const seeded = peelMaybeValue(bootstrap.workspace.value.lenses[0]?.shortcuts);
    if (seeded != null) return seeded;
    const { loadWorkspaceModel } = await import("./workspace-model-loader");
    return (await loadWorkspaceModel({ projected: true })).workspaceCall<LensShortcut[]>("defaultLensShortcuts");
  }, { loadingValue: [] as LensShortcut[], lazy: true });
  const panel = (shortcut: LensShortcut): DataInspectionPanel | undefined => {
    if (shortcut.operation.$tag !== "PresentLensSubject") return undefined;
    const presentation = peelMaybeValue(shortcut.presentation);
    if (shortcut.operation.subject.$tag === "CurrentDataSubject") return presentation == null ? "data" : undefined;
    return presentation == null ? "expression" : presentation.$tag === "CodePresentation" ? "code" : undefined;
  };
  const shortcuts = createMemo(() => (props.shortcuts ?? defaults()).filter(shortcut =>
    (props.code !== false || panel(shortcut) !== "code") && (!!props.onShortcut || !!panel(shortcut))));
  const presentations = createMemo(() => shortcuts().filter(shortcut => !!panel(shortcut)));
  const shown = (shortcut: LensShortcut) => {
    const selected = panel(shortcut);
    return !!selected && dataInspectionPanelVisible(props.mode, selected);
  };
  function select(shortcut: LensShortcut) {
    const selected = panel(shortcut);
    if (selected) props.onModeChange(toggleDataInspectionPanel(props.mode, selected));
    else props.onShortcut?.(shortcut);
  }
  const suggestions = createMemo<LocusMenuItem[]>(() => [...shortcuts().map(shortcut => ({
    id: `lens-shortcut-${shortcut.id}`, label: shortcut.label, icon: shortcut.icon,
    tooltip: panel(shortcut) ? `${shown(shortcut) ? "Hide" : "Show"} ${shortcut.label.toLocaleLowerCase()}` : undefined,
    onSelect: () => { select(shortcut); suggestionsTrigger?.focus({ preventScroll: true }); },
  })), ...(props.dependencies === false ? [] : [{
    id: "lens-dependencies", label: "Dependencies", icon: "share-2",
    tooltip: `${dataInspectionPanelVisible(props.mode, "dependencies") ? "Hide" : "Show"} dependencies`,
    onSelect: () => {
      props.onModeChange(toggleDataInspectionPanel(props.mode, "dependencies"));
      suggestionsTrigger?.focus({ preventScroll: true });
    },
  }]), {
    id: "lens-suggestions-panel",
    label: `${dataInspectionPanelVisible(props.mode, "suggestions") ? "Hide" : "Show"} Suggestions panel`,
    icon: "lightbulb",
    onSelect: () => {
      props.onModeChange(toggleDataInspectionPanel(props.mode, "suggestions"));
      suggestionsTrigger?.focus({ preventScroll: true });
    },
  }, ...(props.suggestionOwner?.items() ?? [])]);
  function closeSuggestions() { props.suggestionOwner?.close(); setSuggestionsAt(undefined); }
  onSettled(() => () => props.suggestionOwner?.close());
  function openSuggestions() {
    if (suggestionsAt()) { closeSuggestions(); return; }
    props.suggestionOwner?.open();
    const rect = suggestionsTrigger?.getBoundingClientRect();
    setSuggestionsAt(rect ? { x: rect.left, y: rect.bottom + 4 } : { x: 0, y: 0 });
  }
  return <>
    <div class="data-inspection-dialog__controls" role="group" aria-label="Data shortcuts">
      <div class="data-inspection-dialog__presentations" role="group" aria-label="Visible panels">
        <For each={presentations()}>{shortcut =>
          <button type="button" class="btn" aria-label={shortcut.label} aria-pressed={shown(shortcut) ? "true" : "false"}
            onClick={() => select(shortcut)}><IconByName name={shortcut.icon} size={14} /><span>{shortcut.label}</span></button>
        }</For>
      </div>
      <Show when={props.dependencies !== false}><button type="button" class="btn data-inspection-dialog__dependencies" aria-label="Dependencies"
        aria-pressed={dataInspectionPanelVisible(props.mode, "dependencies") ? "true" : "false"}
        onClick={() => props.onModeChange(toggleDataInspectionPanel(props.mode, "dependencies"))}>
        <IconByName name="share-2" size={14} /><span>Dependencies</span>
      </button></Show>
      <div class="data-inspection-dialog__suggestion-controls">
      <button type="button" class="btn data-inspection-dialog__suggestions" aria-label="Suggestions panel"
        aria-pressed={dataInspectionPanelVisible(props.mode, "suggestions") ? "true" : "false"}
        onClick={() => props.onModeChange(toggleDataInspectionPanel(props.mode, "suggestions"))}>
        <IconByName name="lightbulb" size={14} /><span>Suggestions</span>
      </button>
      <button type="button" ref={element => { suggestionsTrigger = element; }} class="btn data-inspection-dialog__suggestion-menu"
        aria-label="Suggestions" aria-haspopup="menu" aria-expanded={suggestionsAt() ? "true" : "false"}
        onClick={openSuggestions}
        onKeyDown={event => {
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.ctrlKey && !event.metaKey) {
            event.preventDefault(); if (!suggestionsAt()) openSuggestions();
          }
        }}><span class="data-inspection-dialog__compact-suggestions"><IconByName name="lightbulb" size={14} />Suggestions</span><IconByName name="chevron-down" size={12} /></button>
      </div>
    </div>
    <Show when={suggestionsAt()}>{position =>
      <LocusContextMenu x={position().x} y={position().y} items={suggestions()} label="Suggestions"
        opener={suggestionsTrigger} onClose={closeSuggestions} />
    }</Show>
  </>;
}

/** One query supplies the menu and this ordinary typed related-data lens. */
export function DataInspectionSuggestionsPanel(props: { owner?: DataInspectionSuggestions;
  /** False while the retained panel is hidden. A hidden panel holds no query:
   * closing it cancels its discovery and previews in the worker, and a later
   * change of subject or data does not start them again. Absent: visible. */
  visible?: boolean }) {
  createEffect(() => props.visible === false ? undefined : props.owner, owner => owner?.hold());
  return <Errored fallback={(error, reset) => <LocusLoadFailure message="Could not prepare suggestions."
    detail={String(error())} retry={() => { props.owner?.open(); reset(); }} />}>
    <Loading fallback={<CardLoadingIndicator label="Preparing suggestions…" />}>
      <Show when={props.owner} fallback={<CardLoadingIndicator label="Preparing suggestions…" />}>
        <SuggestionReadPanel owner={props.owner!} />
      </Show>
    </Loading>
  </Errored>;
}

/** The same universal data and expression slots can occupy an ordinary lens
 * or the existing temporary authoring dialog. */
export function DataInspectionPanels(props: { mode: DataInspectionMode; data: () => JSX.Element; expression: () => JSX.Element;
  code?: () => JSX.Element; suggestions?: () => JSX.Element; dependencies?: () => JSX.Element; inline?: boolean;
  /** The subject shown (a lens's focus). The retained panels keep their
   * scroll position across a change of subject unless told: a new subject
   * opens at its top, as a newly opened lens does. */
  subjectKey?: unknown }) {
  let root: HTMLDivElement | undefined;
  // Panels arrive smoothly (panel-motion.ts): after a toggle's layout, the
  // panels that stayed slide from their previous places and a new one fades in.
  const motion = createPanelMotion(() => root);
  const visiblePanels = () => (["suggestions", "data", "expression", "code", "dependencies"] as const)
    .filter(panel => (panel === "data" || panel === "expression" || !!props[panel]) && dataInspectionPanelVisible(props.mode, panel)).join(" ");
  createEffect(visiblePanels, () => { queueMicrotask(motion.settle); });
  onSettled(() => {
    if (!root || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => motion.measure());
    observer.observe(root);
    return () => observer.disconnect();
  });
  createEffect(() => props.subjectKey, () => {
    if (!root) return;
    for (const panel of root.children) panel.scrollTop = 0;
    // A narrow inline lens stacks its panels and scrolls its own body instead.
    if (props.inline && root.parentElement) root.parentElement.scrollTop = 0;
  });
  return <div ref={element => { root = element; }} class={["data-inspection-dialog__panels", { "data-inspection-dialog__panels--inline": !!props.inline }]}
    data-panels={typeof props.mode === "string" ? props.mode : props.mode.panels.join(" ")}
    data-panel-count={Number(dataInspectionPanelVisible(props.mode, "data")) + Number(dataInspectionPanelVisible(props.mode, "expression"))
      + Number(!!props.code && dataInspectionPanelVisible(props.mode, "code"))
      + Number(!!props.suggestions && dataInspectionPanelVisible(props.mode, "suggestions"))
      + Number(!!props.dependencies && dataInspectionPanelVisible(props.mode, "dependencies"))}>
    <RetainedInspectionPanel visible={!!props.suggestions && dataInspectionPanelVisible(props.mode, "suggestions")}
      label="Suggestions" inline={props.inline} render={() => props.suggestions?.()} />
    <RetainedInspectionPanel visible={dataInspectionPanelVisible(props.mode, "data")}
      label="Data" inline={props.inline} render={props.data} />
    <RetainedInspectionPanel visible={dataInspectionPanelVisible(props.mode, "expression")}
      label="Expression" inline={props.inline} render={props.expression} />
    <RetainedInspectionPanel visible={!!props.code && dataInspectionPanelVisible(props.mode, "code")}
      label="Code" inline={props.inline} render={() => props.code?.()} />
    <RetainedInspectionPanel visible={!!props.dependencies && dataInspectionPanelVisible(props.mode, "dependencies")}
      label="Dependencies" inline={props.inline} render={() => props.dependencies?.()} />
  </div>;
}

/** Mount on first use, then hide without disposing the editor/graph owner. */
function RetainedInspectionPanel(props: { visible: boolean; label: string; inline?: boolean; render: () => JSX.Element }) {
  const [mounted, setMounted] = createSignal(false);
  createEffect(() => props.visible, visible => { if (visible) setMounted(true); });
  return <Show when={props.visible || mounted()}><section class="data-inspection-dialog__panel"
    aria-label={`${props.label} panel`} hidden={!props.visible} inert={!props.visible}>
    <Show when={!props.inline}><h3>{props.label}</h3></Show>
    <Loading fallback={<CardLoadingIndicator label={`Preparing ${props.label.toLowerCase()}…`} />}>{props.render()}</Loading>
  </section></Show>;
}

/** Browser chrome around the existing data and expression renderers. The
 * early reader supplies its checked projection while the editor prepares. */
export function DataInspectionDialog(props: {
  label: string;
  mode: DataInspectionMode;
  onModeChange: (mode: DataInspectionMode) => void;
  data: () => JSX.Element;
  expression: () => JSX.Element;
  code?: () => JSX.Element;
  onClose: () => void;
  suggestionOwner?: DataInspectionSuggestions;
  actions?: () => JSX.Element;
}) {
  let dialog!: HTMLDialogElement;
  onSettled(() => {
    const previous = document.activeElement;
    const opening = requestAnimationFrame(() => { if (dialog.isConnected) openModalDialog(dialog); });
    return () => {
      cancelAnimationFrame(opening);
      closeModalDialog(dialog);
      requestAnimationFrame(() => {
        if (previous instanceof HTMLElement && previous.isConnected && !document.querySelector("dialog[open]")) previous.focus();
      });
    };
  });
  return <Portal><dialog ref={dialog} class="value-expression-dialog data-inspection-dialog"
    role="dialog" aria-label={`Open data: ${props.label}`} onCancel={event => { event.preventDefault(); props.onClose(); }}
    onClick={event => { if (event.target === dialog) props.onClose(); }}>
    <div class="value-expression-dialog__content">
      <header class="value-expression-dialog__header"><h2>{props.label}</h2>
        {props.actions?.()}
        <button type="button" class="btn" onClick={props.onClose}>Close</button></header>
      <DataInspectionControls mode={props.mode} onModeChange={props.onModeChange} code={!!props.code} dependencies={false} suggestionOwner={props.suggestionOwner} />
      <DataInspectionPanels mode={props.mode} data={props.data} expression={props.expression} code={props.code}
        suggestions={props.suggestionOwner ? () => <DataInspectionSuggestionsPanel owner={props.suggestionOwner}
          visible={dataInspectionPanelVisible(props.mode, "suggestions")} /> : undefined} />
    </div>
  </dialog></Portal>;
}
