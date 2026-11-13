import { createContext, createSignal, snapshot, useContext } from "solid-js";
import { createStore } from "solid-js";
import type { FunctionStep, StepPath, FunctionDirection } from "./types";
import type { Expression, FenelFunction, FenelType, FieldDef } from "@fenel/engine/types";
import { migrateSteps, stepsToProgram, programToSteps } from "./types";
import type { InstanceDraft } from "~/lib/instances";
import { forgetFieldFacetDrafts } from "~/lib/field-occurrence/model";
import { draftValueFingerprint } from "~/lib/native-draft";

// ---------------------------------------------------------------------------
// Editor state
// ---------------------------------------------------------------------------

export type EditorState = {
  id: string | null; // null = new function
  name: string;
  params: FieldDef[];
  returns: FenelType;
  vars: Record<string, string>;
  steps: FunctionStep[];
  active: boolean;
};

const emptyState: EditorState = {
  id: null,
  name: "",
  params: [],
  returns: { $ref: "Unit" },
  vars: {},
  steps: [],
  active: true,
};

/** Keep every step lens on the existing native-aware IR round-trip boundary. */
export function projectBodyToSteps(body: FenelFunction["body"], legacySteps?: FunctionStep[]) {
  let steps = legacySteps ?? [];
  let lossless = body === undefined;
  if (body !== undefined) {
    try {
      steps = programToSteps(body as Expression);
      const projected = stepsToProgram(steps);
      const wrapped = body !== null && typeof body === "object" && "do" in body
        ? body : { do: [body] };
      lossless = draftValueFingerprint(projected) === draftValueFingerprint(wrapped);
    } catch {
      steps = [];
    }
  }
  return { steps, lossless };
}

/** The page keeps its singleton; each composer owns an independent draft. */
export function createFunctionEditorStore() {
const [state, setState] = createStore<EditorState>({ ...emptyState, params: [], vars: {}, steps: [], returns: { $ref: "Unit" } });
const [selectedPath, setSelectedPath] = createSignal<StepPath | null>(null);
const [dirty, setDirty] = createSignal(false);
const [pendingDeletePath, setPendingDeletePath] = createSignal<StepPath | null>(null);
const [direction, setDirection] = createSignal<FunctionDirection>("BT");
const [fieldFacets, setFieldFacets] = createSignal<Record<string, Record<string, InstanceDraft>>>({});
const [fieldResurrectionIds, setFieldResurrectionIds] = createSignal<readonly string[]>([]);
// Keep the authored expression until an actual body edit. The step projection
// supports a subset of Expression; metadata edits must never round-trip through it.
const [authoredBody, setAuthoredBody] = createSignal<FenelFunction["body"]>({ do: [] });
const [loadedSteps, setLoadedSteps] = createSignal("[]");
const [bodyRequiresCode, setBodyRequiresCode] = createSignal(false);
const [bodyEditIssue, setBodyEditIssue] = createSignal<string>();
const [bodySourceDraft, setBodySourceDraft] = createSignal<{
  text: string;
  admittedBodyFingerprint: string;
  issue?: string;
}>();
const [requires, setRequires] = createSignal<FenelFunction["requires"]>();
const [definitionId, setDefinitionId] = createSignal<string>();
const [nativeDocumentRevision, setNativeDocumentRevision] = createSignal(0);
let nextStepDocumentKey = 0;
// Only the selected native document has an owner; row data carries no editor IDs.
let selectedStepDocument: { row: FunctionStep; path: string; key: string } | undefined;
let pendingStepDocument: { row: FunctionStep; key: string } | undefined;

function releaseSelectedStepDocument() {
  selectedStepDocument = undefined;
  pendingStepDocument = undefined;
}

function mutateStepState(change: (draft: EditorState) => void) {
  // Read the pending draft here; pre-setter reads miss queued body changes.
  setState((draft) => {
    const before = draftValueFingerprint(draft.steps);
    change(draft);
    if (draftValueFingerprint(draft.steps) !== before) setBodySourceDraft(undefined);
  });
}

function installBody(body: FenelFunction["body"], legacySteps?: FunctionStep[], preserveMatchingSource = false) {
  const { steps, lossless } = projectBodyToSteps(body, legacySteps);
  releaseSelectedStepDocument();
  setBodyEditIssue(undefined);
  if (preserveMatchingSource) {
    const fingerprint = draftValueFingerprint(body);
    setBodySourceDraft((current) => current?.admittedBodyFingerprint === fingerprint ? current : undefined);
  } else setBodySourceDraft(undefined);
  setState((s) => { s.steps = steps; });
  setLoadedSteps(draftValueFingerprint(steps));
  setAuthoredBody(() => body);
  setBodyRequiresCode(!lossless);
}

// ---------------------------------------------------------------------------
// Path helpers — resolve a StepPath to a mutable location in the store
// ---------------------------------------------------------------------------

function getStepsAtParentPath(
  steps: FunctionStep[],
  path: StepPath,
): FunctionStep[] | null {
  if (path.length <= 1) return steps;

  const idx = path[0] as number;
  const step = steps[idx];
  if (!step) return null;

  const scope = path[1] as string;
  const armIdx = path[2] as number;
  const rest = path.slice(3);

  if (scope === "b" && step.type === "branch") {
    const arm = step.arms[armIdx];
    if (!arm) return null;
    if (rest.length <= 1) return arm.steps;
    return getStepsAtParentPath(arm.steps, rest);
  }
  if (scope === "c" && step.type === "choose") {
    const opt = step.options[armIdx];
    if (!opt) return null;
    if (rest.length <= 1) return opt.steps;
    return getStepsAtParentPath(opt.steps, rest);
  }
  if (scope === "s" && step.type === "scope") {
    // scope path: [idx, "s", childIdx, ...]
    const childRest = path.slice(2);
    if (childRest.length <= 1) return step.steps;
    return getStepsAtParentPath(step.steps, childRest);
  }
  return null;
}

function getStepIndex(path: StepPath): number {
  return path[path.length - 1] as number;
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

const store = {
  get state() {
    return state;
  },
  get selectedPath() {
    return selectedPath();
  },
  get nativeDocumentKey() { return `function-document:${nativeDocumentRevision()}`; },
  /** Scope native undo/redo to the current logical step, including equal source. */
  get selectedStepDocumentKey(): string | undefined {
    const path = selectedPath();
    const row = path ? this.getStep(path) : null;
    if (!row) {
      releaseSelectedStepDocument();
      return undefined;
    }
    const rawRow = snapshot(row);
    const pathKey = draftValueFingerprint(path);
    if (selectedStepDocument?.path === pathKey) {
      if (selectedStepDocument.row === rawRow) return selectedStepDocument.key;
      if (pendingStepDocument?.key === selectedStepDocument.key && pendingStepDocument.row === rawRow) {
        selectedStepDocument = { ...selectedStepDocument, row: rawRow };
        pendingStepDocument = undefined;
        return selectedStepDocument.key;
      }
    }
    selectedStepDocument = { row: rawRow, path: pathKey, key: `step-document:${++nextStepDocumentKey}` };
    pendingStepDocument = undefined;
    return selectedStepDocument.key;
  },
  get dirty() {
    return dirty();
  },
  get bodyRequiresCode() {
    return bodyRequiresCode();
  },
  get bodyEditIssue() { return bodySourceDraft()?.issue ?? bodyEditIssue(); },
  get stepBodyEditIssue() { return bodyEditIssue(); },
  get bodySourceDraft() { return bodySourceDraft(); },
  setBodySourceDraft(text: string, issue?: string, admittedBody?: FenelFunction["body"]) {
    const fingerprint = admittedBody === undefined ? undefined : draftValueFingerprint(admittedBody);
    const fallback = fingerprint ?? draftValueFingerprint(this.body);
    setBodySourceDraft((current) => ({ text, issue,
      admittedBodyFingerprint: fingerprint ?? current?.admittedBodyFingerprint ?? fallback }));
    setDirty(true);
  },
  setBodyEditIssue(issue: string | undefined) {
    setBodyEditIssue(issue);
    if (issue) setDirty(true);
  },
  get body(): FenelFunction["body"] {
    return draftValueFingerprint(state.steps) === loadedSteps()
      ? authoredBody()
      : stepsToProgram(state.steps) as FenelFunction["body"];
  },
  get pendingDelete() {
    return pendingDeletePath();
  },
  get direction(): FunctionDirection {
    return direction();
  },
  get params() {
    return state.params;
  },
  get fieldFacets() {
    return fieldFacets();
  },
  get fieldResurrectionIds() {
    return fieldResurrectionIds();
  },
  setFieldResurrection(fieldId: string, active: boolean) {
    setFieldResurrectionIds((current) => active
      ? current.includes(fieldId) ? current : [...current, fieldId]
      : current.filter((candidate) => candidate !== fieldId));
    setDirty(true);
  },
  setFieldFacets(fieldId: string, next: Record<string, InstanceDraft>) {
    setFieldFacets((current) => ({ ...current, [fieldId]: next }));
    setDirty(true);
  },
  hydrateFieldFacets(fieldId: string, next: Record<string, InstanceDraft>) {
    setFieldFacets((current) => Object.prototype.hasOwnProperty.call(current, fieldId)
      ? current
      : { ...current, [fieldId]: next });
  },
  forgetFieldFacets(fieldId: string) {
    setFieldFacets((current) => forgetFieldFacetDrafts(current, fieldId));
  },

  /** Load a function from the API into the editor */
  load(data: {
    id: string;
    functionId?: string;
    name?: string;
    slug?: string;
    params?: FieldDef[];
    returns?: FenelType;
    vars?: Record<string, string>;
    steps?: FunctionStep[];
    program?: Expression;
    body?: FenelFunction["body"];
    requires?: FenelFunction["requires"];
    active: boolean;
  }) {
    setNativeDocumentRevision((revision) => revision + 1);
    const program = data.program !== undefined ? data.program : data.body;
    const legacySteps = migrateSteps(data.steps ?? []);
    setState((s) => {
      s.id = data.id;
      s.name = data.name ?? data.slug ?? "";
      s.params = data.params ?? [];
      s.returns = data.returns ?? { $ref: "Unit" };
      s.vars = data.vars ?? {};
      s.steps = [];
      s.active = data.active;
    });
    installBody(program !== undefined ? program as FenelFunction["body"]
      : data.steps !== undefined ? stepsToProgram(legacySteps) as FenelFunction["body"] : undefined);
    setRequires(data.requires);
    setDefinitionId(data.functionId);
    setSelectedPath(null);
    setPendingDeletePath(null);
    setFieldFacets({});
    setFieldResurrectionIds([]);
    setDirty(false);
  },

  /** Reset to empty state for creating a new function */
  reset() {
    setNativeDocumentRevision((revision) => revision + 1);
    setState(() => ({ ...emptyState, params: [], vars: {}, steps: [], returns: { $ref: "Unit" } }));
    installBody({ do: [] });
    setRequires(undefined);
    setDefinitionId(undefined);
    setSelectedPath(null);
    setPendingDeletePath(null);
    setFieldFacets({});
    setFieldResurrectionIds([]);
    setDirty(false);
  },

  /** Select a step by path */
  select(path: StepPath | null) {
    setSelectedPath(path);
    if (path === null) {
      releaseSelectedStepDocument();
      setBodyEditIssue(undefined);
    }
  },

  /** Get the step at a path */
  getStep(path: StepPath): FunctionStep | null {
    const parent = getStepsAtParentPath(state.steps, path);
    if (!parent) return null;
    const idx = getStepIndex(path);
    return parent[idx] ?? null;
  },

  // ---- Metadata ----

  setName(name: string) {
    setState((s) => { s.name = name; });
    setDirty(true);
  },

  setActive(active: boolean) {
    setState((s) => { s.active = active; });
    setDirty(true);
  },

  setParam(index: number, field: FieldDef) {
    setState((current) => { current.params[index] = field; });
    setDirty(true);
  },

  setParams(params: FieldDef[]) {
    setState((current) => { current.params = params; });
    setDirty(true);
  },

  addParam(field: FieldDef) {
    setState((s) => { s.params = [...s.params, field]; });
    setDirty(true);
  },

  removeParam(index: number) {
    const field = state.params[index];
    if (field?.key?.$tag === "NamedField") {
      const fieldId = field.key.ref.$ref;
      setFieldFacets((current) => forgetFieldFacetDrafts(current, fieldId));
    }
    setState((s) => { s.params = s.params.filter((_, i) => i !== index); });
    setDirty(true);
  },

  setReturns(returns: FenelType) {
    setState((current) => { current.returns = returns; });
    setDirty(true);
  },

  // ---- Variables ----

  setVar(key: string, value: string) {
    setState((s) => { s.vars[key] = value; });
    setDirty(true);
  },

  removeVar(key: string) {
    setState(
      (s) => {
        delete s.vars[key];
      },
    );
    setDirty(true);
  },

  renameVar(oldKey: string, newKey: string) {
    setState(
      (s) => {
        const rebuilt: Record<string, string> = {};
        for (const [k, v] of Object.entries(s.vars)) {
          rebuilt[k === oldKey ? newKey : k] = v;
        }
        // Clear and repopulate to preserve order
        for (const k of Object.keys(s.vars)) delete s.vars[k];
        Object.assign(s.vars, rebuilt);
      },
    );
    setDirty(true);
  },

  // ---- Step mutations ----

  /** Add a step at a given position in a step list */
  addStep(parentPath: StepPath, index: number, step: FunctionStep) {
    mutateStepState(
      (s) => {
        const list = parentPath.length === 0
          ? s.steps
          : getStepsAtParentPath(s.steps, [...parentPath, index]);
        // We actually need the parent list, not at index
        const parent = parentPath.length === 0
          ? s.steps
          : getStepsAtParentPath(s.steps, [...parentPath, 0]);
        if (parent) {
          parent.splice(index, 0, step);
        }
      },
    );
    setDirty(true);
  },

  /** Insert a step into the top-level steps array or a nested container */
  insertStep(containerPath: StepPath, index: number, step: FunctionStep) {
    mutateStepState(
      (s) => {
        let list: FunctionStep[];
        if (containerPath.length === 0) {
          list = s.steps;
        } else {
          // containerPath points to the parent container's step list
          const parent = getStepsAtContainerPath(s.steps, containerPath);
          if (!parent) return;
          list = parent;
        }
        list.splice(index, 0, step);
      },
    );
    setDirty(true);
  },

  /** Remove the step at the given path */
  removeStep(path: StepPath) {
    mutateStepState(
      (s) => {
        if (path.length === 1) {
          s.steps.splice(path[0] as number, 1);
          return;
        }
        const parentList = getStepsAtParentPath(s.steps, path);
        if (parentList) {
          parentList.splice(getStepIndex(path), 1);
        }
      },
    );
    setSelectedPath(null);
    releaseSelectedStepDocument();
    setBodyEditIssue(undefined);
    setDirty(true);
  },

  /** Update the step at the given path */
  updateStep(path: StepPath, step: FunctionStep) {
    mutateStepState(
      (s) => {
        const parentList = getStepsAtParentPath(s.steps, path);
        if (!parentList) return;
        const index = getStepIndex(path);
        if (index < 0 || index >= parentList.length) return;
        const previous = parentList[index];
        parentList[index] = step;
        if (selectedStepDocument?.path === draftValueFingerprint(path) && previous) {
          const previousRow = snapshot(previous);
          if (selectedStepDocument.row === previousRow
            || pendingStepDocument?.key === selectedStepDocument.key && pendingStepDocument.row === previousRow) {
            // Setters queue their commit. Keep the committed owner while further
            // queued updates can continue from this replacement's draft row.
            pendingStepDocument = { row: snapshot(parentList[index]!), key: selectedStepDocument.key };
          }
        }
      },
    );
    setDirty(true);
  },

  replaceSteps(steps: FunctionStep[]) {
    mutateStepState((s) => { s.steps = steps; });
    setDirty(true);
  },
  get requires() { return requires(); },
  setRequires(next: FenelFunction["requires"]) {
    setRequires(next);
    setDirty(true);
  },

  /** Identity acknowledged by a committed save, including a partially saved new function. */
  setStorageId(id: string, functionId?: string) {
    setState((s) => { s.id = id; });
    if (functionId !== undefined) setDefinitionId(functionId);
  },

  replaceBody(body: FenelFunction["body"]) {
    installBody(body as FenelFunction["body"], undefined, true);
    setSelectedPath(null);
    setDirty(true);
  },

  /** Add a branch arm */
  addBranchArm(path: StepPath, label: string) {
    mutateStepState(
      (s) => {
        const parentList = getStepsAtParentPath(s.steps, path);
        if (!parentList) return;
        const step = parentList[getStepIndex(path)];
        if (step?.type === "branch") {
          step.arms.push({ id: crypto.randomUUID(), label, when: { op: "compare", field: "", cmp: "==", value: "" }, steps: [] });
        }
      },
    );
    setDirty(true);
  },

  /** Add a choose option */
  addChooseOption(path: StepPath, label: string) {
    mutateStepState(
      (s) => {
        const parentList = getStepsAtParentPath(s.steps, path);
        if (!parentList) return;
        const step = parentList[getStepIndex(path)];
        if (step?.type === "choose") {
          step.options.push({ id: crypto.randomUUID(), label, steps: [] });
        }
      },
    );
    setDirty(true);
  },

  /** Serialize the current state for saving to API */
  serialize() {
    return {
      id: definitionId() ?? state.name,
      params: state.params,
      returns: state.returns,
      ...(this.body === undefined ? {} : { body: this.body }),
      ...(requires() === undefined ? {} : { requires: requires() }),
    };
  },

  setDirection(dir: FunctionDirection) {
    setDirection(dir);
  },

  markClean() {
    setFieldResurrectionIds([]);
    setDirty(false);
  },

  requestDelete(path: StepPath) {
    setPendingDeletePath(path);
  },

  confirmDelete() {
    const path = pendingDeletePath();
    if (path) this.removeStep(path);
    setPendingDeletePath(null);
  },

  cancelDelete() {
    setPendingDeletePath(null);
  },
};
return store;
}

export type FunctionEditorStore = ReturnType<typeof createFunctionEditorStore>;
export const functionStore = createFunctionEditorStore();
export const FunctionEditorContext = createContext<FunctionEditorStore | null>(null);
export function useFunctionEditorStore(): FunctionEditorStore {
  return useContext(FunctionEditorContext) ?? functionStore;
}

/** Resolve a container path to its step list (for branch arms, choose options, etc.) */
function getStepsAtContainerPath(
  steps: FunctionStep[],
  path: StepPath,
): FunctionStep[] | null {
  if (path.length === 0) return steps;
  if (path.length === 1) return steps;

  const idx = path[0] as number;
  const step = steps[idx];
  if (!step) return null;

  if (path.length === 1) return steps;

  const scope = path[1] as string;
  const armIdx = path[2] as number;
  const rest = path.slice(3);

  if (scope === "b" && step.type === "branch") {
    const arm = step.arms[armIdx];
    if (!arm) return null;
    if (rest.length === 0) return arm.steps;
    return getStepsAtContainerPath(arm.steps, rest);
  }
  if (scope === "c" && step.type === "choose") {
    const opt = step.options[armIdx];
    if (!opt) return null;
    if (rest.length === 0) return opt.steps;
    return getStepsAtContainerPath(opt.steps, rest);
  }
  if (scope === "s" && step.type === "scope") {
    const childRest = path.slice(2);
    if (childRest.length === 0) return step.steps;
    return getStepsAtContainerPath(step.steps, childRest);
  }
  return null;
}
