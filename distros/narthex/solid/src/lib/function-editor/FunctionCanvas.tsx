import { Show, For, createEffect, createSignal, createMemo, latest, onSettled } from "solid-js";
import { closeModalDialog, openModalDialog } from "../confirm-modal";
import { IconX, IconBinaryTree, IconList, IconInfoCircle, IconAlertTriangle, IconClock, IconVariable, IconPlus, IconChevronDown, IconChevronRight, IconArrowRight, IconArrowDown, IconArrowUp, IconArrowLeft } from "~/lib/icons";
import { functionStore } from "./store";
import { StepList } from "./StepNode";
import { TreeStepList } from "./TreeView";
import { StepEditor } from "./StepEditor";
import { FenelCodeEditor, InlineCodeEditor } from "./FenelCodeEditor";
import { createBlankStep, FUNCTION_DIRECTIONS } from "./types";
import type { FunctionStep, FunctionDirection } from "./types";
// The TS printer moved to engine-bodies-dispatch (the `fenel-printer.ts` file
// is gone — the printer is Fenel-bodied now); it's re-exported as `printFenel`.
import { printFenel as print } from "@fenel/engine";
import { parse, ParseError } from "@fenel/engine/fenel-parser";
import type { Expression } from "@fenel/engine/types";
import {
  FieldAuthoringProvider,
  createNewNamedFieldOccurrence,
  persistedRootFieldOwner,
} from "~/lib/field-occurrence";
import { FieldOccurrenceEditor } from "~/lib/field-occurrence/FieldOccurrenceEditor";
import { TypeBuilder } from "~/lib/type-builder/TypeBuilder";
import { ConstraintsEditor } from "~/lib/instances/ConstraintsEditor";
import type { CaptureTypePickerTarget } from "~/lib/type-builder/TypePicker";
import { draftValueFingerprint } from "~/lib/native-draft";
import { sessionEpoch } from "~/lib/browser-session";
import { ExpressionEditor, logicToExprNode, toLogic, LambdaParamsContext, expandParamPaths } from "~/lib/expression-runner";
import { authoringSessionForFunction, useAuthoringSession, concreteAuthoringSession, DETACHED_AUTHORING_SESSION } from "~/lib/expression-runner/authoring-session";
import { subject } from "~/lib/auth";
import { userFunctions } from "~/lib/user-registries";

type ViewMode = "graph" | "tree" | "expression" | "code";
const [viewMode, setViewMode] = createSignal<ViewMode>("graph");
const effectiveViewMode = () => functionStore.bodyRequiresCode && (viewMode() === "graph" || viewMode() === "tree") ? "expression" : viewMode();

const DIR_ICONS: Record<FunctionDirection, typeof IconArrowRight> = {
  LR: IconArrowRight,
  RL: IconArrowLeft,
  TB: IconArrowDown,
  BT: IconArrowUp,
};

// ---------------------------------------------------------------------------
// Header bar — function name + active toggle + view toggle
// ---------------------------------------------------------------------------

function HeaderBar() {
  return (
    <div class="fe-header">
      <input
        class="fe-header-name"
        value={functionStore.state.name}
        placeholder="Untitled Function"
        onInput={(e) => functionStore.setName(e.currentTarget.value)}
      />
      <Show when={functionStore.state.id}>
        <span class="fe-header-id">{functionStore.state.id}</span>
      </Show>
      <div class="fe-header-right">
        <label class="fe-active-toggle">
          <input
            type="checkbox"
            checked={functionStore.state.active}
            onChange={(e) => functionStore.setActive(e.currentTarget.checked)}
          />
          <span class="fe-active-label">{functionStore.state.active ? "Active" : "Inactive"}</span>
        </label>
        <div class="fe-view-toggle">
          <button class={`fe-view-btn ${effectiveViewMode() === "expression" ? "fe-view-btn--active" : ""}`} onClick={() => setViewMode("expression")} data-tooltip="Expression lens">Expression</button>
          <button
            class={`fe-view-btn ${effectiveViewMode() === "graph" ? "fe-view-btn--active" : ""}`}
            disabled={functionStore.bodyRequiresCode}
            onClick={() => setViewMode("graph")}
            data-tooltip="Graph lens"
          >
            <IconBinaryTree size={16} />
          </button>
          <button
            class={`fe-view-btn ${effectiveViewMode() === "tree" ? "fe-view-btn--active" : ""}`}
            disabled={functionStore.bodyRequiresCode}
            onClick={() => setViewMode("tree")}
            data-tooltip="Tree lens"
          >
            <IconList size={16} />
          </button>
          <button
            class={`fe-view-btn ${effectiveViewMode() === "code" ? "fe-view-btn--active" : ""}`}
            onClick={() => setViewMode("code")}
            data-tooltip="Code lens"
          >
            {"</>"}
          </button>
        </div>
        <Show when={effectiveViewMode() === "graph"}>
          <div class="fe-dir-toggle">
            <For each={FUNCTION_DIRECTIONS}>
              {(d) => {
                const Icon = DIR_ICONS[d.value];
                return (
                  <button
                    class={`fe-view-btn ${functionStore.direction === d.value ? "fe-view-btn--active" : ""}`}
                    onClick={() => functionStore.setDirection(d.value)}
                    data-tooltip={d.label}
                  >
                    <Icon size={14} />
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm delete dialog
// ---------------------------------------------------------------------------

function ConfirmDeleteDialog() {
  let ref: HTMLDialogElement | undefined;

  createEffect(
    () => functionStore.pendingDelete,
    (pendingDelete) => {
      if (pendingDelete) {
        if (ref) openModalDialog(ref);
      } else {
        if (ref) closeModalDialog(ref);
      }
    },
  );

  return (
    <dialog ref={ref} class="fe-dialog" onClose={() => functionStore.cancelDelete()}
      onCancel={event => { event.preventDefault(); functionStore.cancelDelete(); }}>
      <div class="fe-dialog-body">
        <p>Delete this step? This cannot be undone.</p>
        <div class="fe-dialog-actions">
          <button class="fe-btn" onClick={() => functionStore.cancelDelete()}>
            Cancel
          </button>
          <button
            class="fe-btn fe-btn--danger"
            onClick={() => functionStore.confirmDelete()}
          >
            Delete
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Variables section
// ---------------------------------------------------------------------------

function VarsSection() {
  const [open, setOpen] = createSignal(false);
  const entries = () => Object.entries(functionStore.state.vars);
  const count = () => entries().length;

  function addVar() {
    functionStore.setVar("", "");
    setOpen(true);
  }

  return (
    <div class="fe-vars">
      <button class="fe-vars-toggle" onClick={() => setOpen(!open())}>
        <IconVariable size={14} />
        <span class="fe-vars-title">Parameters</span>
        <Show when={count() > 0}>
          <span class="fe-vars-count">{count()}</span>
        </Show>
        <span class="fe-vars-chevron">
          <Show when={open()} fallback={<IconChevronRight size={14} />}>
            <IconChevronDown size={14} />
          </Show>
        </span>
      </button>
      <Show when={open()}>
        <div class="fe-vars-body">
          <For keyed={false} each={entries()}>
            {(entry) => (
              <div class="fe-vars-row">
                <input
                  class="fe-input fe-input--sm fe-vars-key"
                  value={entry()[0]}
                  placeholder="name"
                  onInput={(e) => functionStore.renameVar(entry()[0], e.currentTarget.value)}
                />
                <span class="fe-vars-eq">=</span>
                <InlineCodeEditor
                  value={entry()[1]}
                  documentKey={JSON.stringify([functionStore.nativeDocumentKey, "parameter-default", entry()[0]])}
                  placeholder="default value"
                  onChange={(v) => functionStore.setVar(entry()[0], v)}
                />
                <button
                  class="fe-btn-danger-sm"
                  onClick={() => functionStore.removeVar(entry()[0])}
                >
                  &times;
                </button>
              </div>
            )}
          </For>
          <button class="fe-vars-add" onClick={addVar}>
            <IconPlus size={11} /> Add parameter
          </button>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signature section — the same field occurrence model used by every other
// type/function authoring surface. Params retain their explicit UUIDs through
// visual edits and serialize with the function store.
// ---------------------------------------------------------------------------

function SignatureSection() {
  const [open, setOpen] = createSignal(false);
  const session = useAuthoringSession();
  let alive = true;
  onSettled(() => () => { alive = false; });
  const requirementsDraft = () => ({ definition: functionStore.serialize(),
    storageId: functionStore.state.id, name: functionStore.state.name, active: functionStore.state.active,
    facets: functionStore.fieldFacets, resurrectFieldIds: functionStore.fieldResurrectionIds,
    source: functionStore.bodySourceDraft, issue: functionStore.bodyEditIssue });
  const captureRequirementsTarget: CaptureTypePickerTarget = () => latest(() => {
    if (!alive || !open()) return undefined;
    const document = functionStore.nativeDocumentKey, rows = functionStore.requires;
    const fingerprint = draftValueFingerprint(requirementsDraft());
    const concrete = concreteAuthoringSession(session), epoch = sessionEpoch();
    // The canvas remains editable during its owner's snapshot-based Save.
    // Bind the current document/draft; the Save owner retains its own guard.
    return () => latest(() => alive && open() && document === functionStore.nativeDocumentKey
      && rows === functionStore.requires && fingerprint === draftValueFingerprint(requirementsDraft())
      && concrete === concreteAuthoringSession(session) && epoch === sessionEpoch());
  });
  function changeRequirements(next: typeof functionStore.requires) {
    if (alive && open()) functionStore.setRequires(next);
  }

  function addParam() {
    const index = functionStore.params.length + 1;
    functionStore.addParam(createNewNamedFieldOccurrence(`arg${index}`));
    setOpen(true);
  }

  return (
    <div class="fe-vars">
      <button class="fe-vars-toggle" onClick={() => setOpen(!open())}>
        <IconVariable size={14} />
        <span class="fe-vars-title">Signature</span>
        <Show when={functionStore.params.length > 0}>
          <span class="fe-vars-count">{functionStore.params.length}</span>
        </Show>
        <span class="fe-vars-chevron">
          <Show when={open()} fallback={<IconChevronRight size={14} />}>
            <IconChevronDown size={14} />
          </Show>
        </span>
      </button>
      <Show when={open()}>
        <div class="fe-vars-body">
          <For keyed={false} each={functionStore.params}>
            {(field, index) => (
              <FieldOccurrenceEditor
                field={field()}
                onChange={(next) => functionStore.setParam(index, next)}
                onRemove={() => functionStore.removeParam(index)}
                compact
              />
            )}
          </For>
          <button class="fe-vars-add" onClick={addParam}>
            <IconPlus size={11} /> Add param
          </button>
          <div class="field-occurrence__section-label">Returns</div>
          <TypeBuilder value={functionStore.state.returns} onChange={(next) => functionStore.setReturns(next)} />
          <div class="field-occurrence__section-label">Required interfaces</div>
          <ConstraintsEditor value={functionStore.requires ?? []} captureTarget={captureRequirementsTarget}
            onChange={changeRequirements} label="Required interfaces" />
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orphan function banner
// ---------------------------------------------------------------------------

function OrphanBanner() {
  const [collapsed, setCollapsed] = createSignal(false);

  function addWaitAtStart() {
    const step = createBlankStep("wait_event");
    functionStore.insertStep([], 0, step);
  }

  return (
    <div class="fe-banner fe-banner--warn">
      <button class="fe-banner-toggle" onClick={() => setCollapsed(!collapsed())}>
        <IconInfoCircle size={14} />
        <span class="fe-banner-title">Orphan function</span>
        <span class="fe-banner-chevron">{collapsed() ? "›" : "‹"}</span>
      </button>
      <Show when={!collapsed()}>
        <div class="fe-banner-body">
          <span class="fe-banner-text">
            No Wait step — won't trigger automatically. Only runs via <strong>Call Sub-function</strong>.
          </span>
          <button class="fe-banner-action" onClick={addWaitAtStart}>
            <IconClock size={14} />
            Add Wait
          </button>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recursion warning banner
// ---------------------------------------------------------------------------

/** Check if any top-level step is an unguarded self-call */
function hasUnguardedRecursion(steps: FunctionStep[]): boolean {
  return steps.some(
    (s) => s.type === "call_function" && s.flow === "self",
  );
}

/** Check if any step (recursively) calls self */
function hasSelfCall(steps: FunctionStep[]): boolean {
  for (const s of steps) {
    if (s.type === "call_function" && s.flow === "self") return true;
    if (s.type === "branch") {
      for (const arm of s.arms) {
        if (hasSelfCall(arm.steps)) return true;
      }
    }
    if (s.type === "choose") {
      for (const opt of s.options) {
        if (hasSelfCall(opt.steps)) return true;
      }
    }
    if (s.type === "scope") {
      if (hasSelfCall(s.steps)) return true;
    }
  }
  return false;
}

function RecursionBanner(props: { unguarded: boolean }) {
  const [collapsed, setCollapsed] = createSignal(false);

  return (
    <div class={`fe-banner ${props.unguarded ? "fe-banner--danger" : "fe-banner--warn"}`}>
      <button class="fe-banner-toggle" onClick={() => setCollapsed(!collapsed())}>
        <IconAlertTriangle size={14} />
        <span class="fe-banner-title">
          {props.unguarded ? "Infinite loop risk" : "Recursive function"}
        </span>
        <span class="fe-banner-chevron">{collapsed() ? "›" : "‹"}</span>
      </button>
      <Show when={!collapsed()}>
        <div class="fe-banner-body">
          <span class="fe-banner-text">
            <Show
              when={props.unguarded}
              fallback="Calls itself — ensure at least one branch exits without recursing."
            >
              Unguarded <strong>Recurse</strong> at top level — infinite loop. Add a Branch with exit condition.
            </Show>
          </span>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FunctionCodeView — whole-function Fenel code editing
// ---------------------------------------------------------------------------

function FunctionCodeView() {
  const codeError = () => functionStore.bodySourceDraft?.issue;

  const functionCode = createMemo(() => {
    const body = functionStore.body;
    return print((body === undefined ? { do: [] } : body) as Expression);
  });

  function handleCodeChange(code: string) {
    try {
      const ast = parse(code) as Expression;
      functionStore.replaceBody(ast);
      functionStore.setBodySourceDraft(code, undefined, ast);
    } catch (e) {
      functionStore.setBodySourceDraft(code, e instanceof ParseError ? e.message : e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div class="fe-code-view">
      <FenelCodeEditor value={functionStore.bodySourceDraft?.text ?? functionCode()}
        documentKey={functionStore.nativeDocumentKey} onChange={handleCodeChange} />
      <Show when={codeError()}>
        <div class="fe-code-error">
          <IconAlertTriangle size={14} />
          <span>{codeError()}</span>
        </div>
      </Show>
    </div>
  );
}

/** The function owner exposes the complete expression language, including
 * bodies that have no step projection. Signature changes update variable hints. */
export function FunctionExpressionView() {
  const inherited = useAuthoringSession();
  const session = createMemo(() => {
    if (inherited !== DETACHED_AUTHORING_SESSION) return inherited;
    const account = subject();
    const scope = account?.$tag === "User" || account?.$tag === "Bot"
      ? { accountId: account.accountId, functions: userFunctions(), draft: functionStore.serialize() }
      : undefined;
    return authoringSessionForFunction(functionStore.serialize().id, scope);
  });
  const params = createMemo(() => expandParamPaths(functionStore.params, session()));
  const node = createMemo(() => logicToExprNode(functionStore.body ?? null, params().map((param) => param.name), session()));
  const [error, setError] = createSignal("");
  return <div class="fe-expression-view">
    <LambdaParamsContext value={params}>
      <ExpressionEditor expr={node()} authoringSession={session()} paramName="Function body"
        onChange={(next) => {
          try { functionStore.replaceBody(toLogic(next, undefined, session()) as import("@fenel/engine/types").FunctionBody); setError(""); }
          catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        }} />
    </LambdaParamsContext>
    <Show when={error()}><div class="fe-code-error" role="alert">{error()}</div></Show>
  </div>;
}

// ---------------------------------------------------------------------------
// FunctionCanvas — main editor layout
// ---------------------------------------------------------------------------

export function FunctionCanvas() {
  const isOrphan = createMemo(() => {
    const steps = functionStore.state.steps;
    if (steps.length === 0) return false;
    return steps[0].type !== "wait";
  });

  const recursion = createMemo(() => {
    const steps = functionStore.state.steps;
    if (!hasSelfCall(steps)) return null;
    return hasUnguardedRecursion(steps) ? "unguarded" : "guarded";
  });

  return (
    <div
      class={`fe-canvas fe-scroll-${functionStore.direction.toLowerCase()}`}
      onClick={() => functionStore.select(null)}
    >
      <div class="fe-settings-bar">
        <HeaderBar />
        <FieldAuthoringProvider
          facetsByFieldId={functionStore.fieldFacets}
          onFieldFacetsChange={(fieldId, next) => functionStore.setFieldFacets(fieldId, next)}
          onFieldFacetsHydrate={(fieldId, next) => functionStore.hydrateFieldFacets(fieldId, next)}
          onFieldFacetsForget={(fieldId) => functionStore.forgetFieldFacets(fieldId)}
          ownerKey={functionStore.state.name.trim()
            ? `function:${functionStore.state.name.trim()}`
            : undefined}
          owner={functionStore.state.name.trim()
            ? persistedRootFieldOwner("function", functionStore.state.name.trim())
            : undefined}
          resurrectFieldIds={functionStore.fieldResurrectionIds}
          onFieldResurrectionChange={(fieldId, active) => functionStore.setFieldResurrection(fieldId, active)}
        >
          <SignatureSection />
        </FieldAuthoringProvider>
        <VarsSection />
        <Show when={!functionStore.bodyRequiresCode && isOrphan()}>
          <OrphanBanner />
        </Show>
        <Show when={!functionStore.bodyRequiresCode && recursion()}>
          <RecursionBanner unguarded={recursion() === "unguarded"} />
        </Show>
      </div>
      <div class="fe-main">
        <Show when={effectiveViewMode() === "expression"} fallback={
        <Show when={effectiveViewMode() === "code"} fallback={
          <div class={`fe-steps-area fe-dir-${functionStore.direction.toLowerCase()}`}>
            <Show
              when={effectiveViewMode() === "tree"}
              fallback={<StepList steps={functionStore.state.steps} basePath={[]} />}
            >
              <TreeStepList steps={functionStore.state.steps} basePath={[]} />
            </Show>
          </div>
        }>
          <FunctionCodeView />
        </Show>
        }><FunctionExpressionView /></Show>
      </div>

      {/* Slide-in editor panel */}
      <Show when={functionStore.selectedPath}>
        <div class="fe-panel-backdrop" onClick={() => functionStore.select(null)} />
        <aside class="fe-panel" onClick={(e) => e.stopPropagation()}>
          <div class="fe-panel-header">
            <span class="fe-panel-title">Edit Step</span>
            <button
              class="fe-panel-close"
              onClick={() => functionStore.select(null)}
            >
              <IconX size={18} />
            </button>
          </div>
          <div class="fe-panel-body">
            <StepEditor />
          </div>
        </aside>
      </Show>

      <ConfirmDeleteDialog />
    </div>
  );
}
