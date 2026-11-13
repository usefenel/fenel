import { Show, For, createEffect, createMemo, createSignal, untrack } from "solid-js";
import {
  IconClock,
  IconBell,
  IconCalendar,
  IconPlus,
  IconTrash,
  IconChevronDown,
  IconBolt,
  IconPencil,
  ACTION_STEP_ICONS,
  EVENT_STEP_ICONS,
} from "~/lib/icons";
import {
  ConditionBuilder,
  ConditionTreeModal,
  CompareLeaf,
  ExpressionEditor,
  cleanupGroups,
} from "~/lib/expression-builder";
import type { LeafRenderProps, VariableHint } from "~/lib/expression-builder";
import type {
  FunctionStep,
  ActionStep,
  WaitStep,
  WaitCondition,
  BranchCondition,
  SetStep,
  ScopeStep,
  BranchStep,
  ChooseStep,
  CallFunctionStep,
} from "./types";
import { migrateBranchWhen } from "./types";
import { projectBodyToSteps, useFunctionEditorStore, type FunctionEditorStore } from "./store";
import { draftValueFingerprint } from "~/lib/native-draft";
import type { ModuleRegistry } from "@fenel/engine/registry";
import {
  createRepositoryRegistry,
} from "@fenel/engine/repository-registry";
import { resolveIdentifiedFieldView } from "@fenel/engine/identified-field-view";
import { dispatchRegistry, List, peelMaybe, peelList } from "@fenel/engine";
import { ecomModule } from "@fenel/engine/modules/ecom";
import { twitterModule } from "@fenel/engine/modules/twitter";
import { socialModule } from "@fenel/engine/modules/social";
import { licenseModule } from "@fenel/engine/modules/license";
import { templateModule } from "@fenel/engine/modules/templates";
import type { FieldDef, FenelType } from "@fenel/engine/types";
import { canonical } from "@fenel/engine/locale";
import { FieldRenderer } from "~/lib/field-renderer";
import { FenelCodeEditor, InlineCodeEditor } from "./FenelCodeEditor";
import { LocusSelect } from "~/lib/locus-select";
import { stepToExpr } from "./types";
// The TS printer moved to engine-bodies-dispatch (the `fenel-printer.ts` file
// is gone — the printer is Fenel-bodied now); it's re-exported as `printFenel`.
import { printFenel as print } from "@fenel/engine";
import { parse, ParseError } from "@fenel/engine/fenel-parser";
import type { Expression } from "@fenel/engine/types";
import { ensureUserRegistriesLoaded, userFunctions } from "~/lib/user-registries";
import { accountFieldRegistry } from "~/lib/account-field-registry";
import { Just, Nothing, peelMaybeValue } from "@fenel/engine/type-foundation";
import { useAuthoringSession, DETACHED_AUTHORING_SESSION, type AuthoringSession } from "~/lib/expression-runner/authoring-session";
import { createLocalFieldLabel } from "~/lib/field-renderer/FieldRenderer";
import type { FenelFunction } from "@fenel/engine/types";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { localEditorSession } from "~/lib/expression-runner/local-editor-reads";
import { createLocalReaderAnswer, runLocalReaderAction } from "~/lib/expression-runner/local-reader-actions";

// ---------------------------------------------------------------------------
// Module registry — data-driven action & event definitions
//
// Built-in modules are static; user functions are pulled in via
// `userFunctions()` (loaded by ensureUserRegistriesLoaded). Wrapping in a
// memo means the registry rebuilds whenever the user-functions signal
// updates — so user-authored functions show up in ACTION_PRESETS and
// resolve via registry().getFunction without a page reload.
// ---------------------------------------------------------------------------

const builtInModules = [ecomModule, twitterModule, socialModule, licenseModule, templateModule];
let builtInRegistry: ModuleRegistry | undefined;

function getRegistry(session?: AuthoringSession): ModuleRegistry {
  if (session && session !== DETACHED_AUTHORING_SESSION) return session.registry;
  return accountFieldRegistry() ?? (builtInRegistry ??= createRepositoryRegistry(builtInModules, { dispatchRegistry }));
}

function productFieldLabel(field: FieldDef, session?: AuthoringSession): string {
  return canonical(resolveIdentifiedFieldView(getRegistry(session), field).presentation.label);
}

// B4 wave 4 lane E: a Local reader's Steps lens reads its action functions
// (`project-reader-references` with `definitions`: the registry's own
// `getIdentifiedFunction` answer) and its parameter labels (the worker's
// field plans) in its worker; the page registry is never read. Until
// answered, an action shows no parameter specs and a parameter its own name.
type StepActionLookup = { fn?: FenelFunction };
function readActionDefinition(reply: unknown): StepActionLookup {
  const rows = reply && typeof reply === "object" ? (reply as { references?: unknown }).references : undefined;
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] as { reference?: { definition?: { fn?: unknown } } } : undefined;
  if (!row || typeof row !== "object") throw new Error("The authoring worker response could not be read.");
  const fn = row.reference?.definition?.fn;
  if (fn !== undefined && (!fn || typeof fn !== "object" || !Array.isArray((fn as FenelFunction).params)))
    throw new Error("The authoring worker response could not be read.");
  return fn ? { fn: fn as FenelFunction } : {};
}
const actionDefinitionQuery = (name: string) => ({ method: "project-reader-references" as const, targets: [name], definitions: true as const });

/** The identified function an action step names, on the page or in a Local
 * reader's worker. */
function createStepActionSpec(session: AuthoringSession, name: () => string) {
  const reader = useReaderRuntime();
  if (!localEditorSession(reader, session)) return () => name() ? getRegistry(session).getIdentifiedFunction(name()) : undefined;
  const answer = createLocalReaderAnswer(() => reader, () => session, () => name() ? actionDefinitionQuery(name()) : undefined,
    readActionDefinition);
  return () => name() ? answer.answer()?.fn : undefined;
}

/** A parameter's shown label: its identified field view's label, or, for a
 * Local reader, its worker field plan's label (its own name until answered). */
function ProductFieldLabel(props: { field: FieldDef; session: AuthoringSession }) {
  const reader = useReaderRuntime();
  if (!localEditorSession(reader, props.session)) return <>{productFieldLabel(props.field, props.session)}</>;
  const label = createLocalFieldLabel(() => props.field, () => getRegistry(props.session));
  return <>{label() ?? props.field.name}</>;
}

function getActionPresets(session?: AuthoringSession) {
  if (session && session !== DETACHED_AUTHORING_SESSION) return session.catalog.functions
    .filter((entry) => entry.kind === "function")
    .map((entry) => ({ value: entry.targetId ?? entry.id, label: entry.label }));
  const visibleIds = new Set([
    ...builtInModules.flatMap((entry) => entry.functions ?? []).map((fn) => fn.id),
    ...userFunctions().map((fn) => fn.id),
  ]);
  return getRegistry().functionOptions()
    .filter((option) => visibleIds.has(option.value))
    .map((o) => ({ ...o, label: canonical(o.label) }));
}
// Events are typed ADT values now (not registered specs) — no preset list. The
// step editor renders the event step as a free-text "event name" input;
// callers that want an enumerated list can pass it via a separate channel.
const EVENT_PRESETS: { value: string; label: string; category?: string }[] = [];

/** Collect all available variables for autocomplete in condition editors */
const SYSTEM_VARS: VariableHint[] = [
  { name: "_lastResult", label: "Last action result", source: "system" },
  { name: "_profileId", label: "Profile ID", source: "system" },
];

function getFunctionVariables(functionStore: FunctionEditorStore): VariableHint[] {
  const rootVars = Object.keys(functionStore.state.vars).map((name) => ({
    name,
    label: name,
    source: "root" as const,
  }));
  // Form fields as variables — behavioral nodes reference form data via { "var": "fieldId" }
  const fieldVars = functionStore.params.map((f) => ({
    name: f.name,
    label: f.name,
    source: "form" as const,
  }));
  return [...rootVars, ...fieldVars, ...SYSTEM_VARS];
}

// ---------------------------------------------------------------------------
// FieldDef → editor type mapping
// ---------------------------------------------------------------------------

function defaultValueForType(type: FenelType | undefined): unknown {
  if (!type) return "";
  if ("$record" in type) return {};
  if (peelList(type)) return [];
  return "";
}

/** Infer a FieldDef from a custom (unregistered) param's key and current value */
function inferFieldFromValue(key: string, value: unknown): FieldDef {
  if (Array.isArray(value)) {
    const sample = value[0];
    const itemType = sample !== undefined ? inferFieldFromValue("item", sample).type ?? { $ref: "String" } : { $ref: "String" };
    return { name: key, label: Nothing, type: List(itemType), meta: {}, ui: Nothing };
  }
  if (typeof value === "object" && value !== null) {
    return { name: key, label: Nothing, type: { $record: { fields: [] } }, meta: {}, ui: Nothing };
  }
  if (typeof value === "boolean") {
    return { name: key, label: Nothing, type: { $ref: "Boolean" }, meta: {}, ui: Nothing };
  }
  if (typeof value === "number") {
    return { name: key, label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing };
  }
  return { name: key, label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing };
}

/** Serialize any value to a display string (used by event filter editor) */
function stringifyValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Parse user input: JSON for structures/numbers/booleans, otherwise string */
function parseValue(s: string): unknown {
  const t = s.trim();
  if (t === "") return "";
  if (/^[\[{]/.test(t) || t === "true" || t === "false" || t === "null") {
    try { return JSON.parse(t); } catch { /* fall through */ }
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return s;
}

// ---------------------------------------------------------------------------
// Custom icon select dropdown
// ---------------------------------------------------------------------------

function IconSelect(props: {
  value: string;
  options: { value: string; label: string }[];
  iconMap: Record<string, (p: { size?: number }) => any>;
  defaultIcon: (p: { size?: number }) => any;
  placeholder?: string;
  hasCustom?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const selected = () => props.options.find((o) => o.value === props.value);
  const isCustom = () =>
    props.value === "__custom__" || (props.value !== "" && !selected());
  const getIcon = (value: string) => props.iconMap[value] ?? props.defaultIcon;

  return (
    <div class="fe-icon-select">
      <button
        type="button"
        class="fe-icon-select-trigger"
        onClick={() => setOpen(!open())}
      >
        <Show
          when={selected()}
          fallback={
            <Show
              when={isCustom()}
              fallback={
                <span class="fe-icon-select-ph">
                  {props.placeholder ?? "Select..."}
                </span>
              }
            >
              <IconPencil size={16} />
              <span>Custom</span>
            </Show>
          }
        >
          {(sel) => (
            <>
              {getIcon(sel().value)({ size: 16 })}
              <span>{sel().label}</span>
            </>
          )}
        </Show>
        <IconChevronDown size={14} class="fe-icon-select-arrow" />
      </button>
      <Show when={open()}>
        <div class="fe-icon-select-backdrop" onClick={() => setOpen(false)} />
        <div class="fe-icon-select-menu">
          <For each={props.options}>
            {(opt) => (
              <button
                type="button"
                class={`fe-icon-select-item ${
                  opt.value === props.value ? "fe-icon-select-item--active" : ""
                }`}
                onClick={() => {
                  props.onChange(opt.value);
                  setOpen(false);
                }}
              >
                {getIcon(opt.value)({ size: 16 })}
                <span>{opt.label}</span>
              </button>
            )}
          </For>
          <Show when={props.hasCustom}>
            <div class="fe-icon-select-divider" />
            <button
              type="button"
              class={`fe-icon-select-item ${
                isCustom() ? "fe-icon-select-item--active" : ""
              }`}
              onClick={() => {
                props.onChange("__custom__");
                setOpen(false);
              }}
            >
              <IconPencil size={16} />
              <span>Custom...</span>
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main StepEditor
// ---------------------------------------------------------------------------

export function StepEditor() {
  const functionStore = useFunctionEditorStore();
  const session = useAuthoringSession();
  // Trigger the user-registries fetch so user functions show up in the
  // action picker. ACTION_PRESETS are reactive (memo over userFunctions()),
  // so any newly-loaded functions appear without a remount.
  if (session === DETACHED_AUTHORING_SESSION) void ensureUserRegistriesLoaded();

  const [codeView, setCodeView] = createSignal(false);
  const [codeDraft, setCodeDraft] = createSignal("");
  const [codeDocumentKey, setCodeDocumentKey] = createSignal<string>();
  const codeError = () => functionStore.stepBodyEditIssue ?? null;
  const setCodeError = (issue: string | null) => functionStore.setBodyEditIssue(issue ?? undefined);
  let installedCodePath: string | undefined;
  let installedCodeStep: string | undefined;
  let installedCodeDocument: string | undefined;
  let locallyAppliedStep: string | undefined;

  const step = createMemo(() => {
    const path = functionStore.selectedPath;
    if (!path) return null;
    return functionStore.getStep(path);
  });

  const path = () => functionStore.selectedPath;

  const codeText = createMemo(() => {
    const s = step();
    if (!s) return "";
    try {
      return print(stepToExpr(s) as Expression);
    } catch {
      return "-- (cannot represent as Fenel syntax)";
    }
  });

  createEffect(
    () => ({ path: draftValueFingerprint(path()), step: draftValueFingerprint(step()),
      document: functionStore.selectedStepDocumentKey, text: codeText() }),
    (next) => {
      const samePath = installedCodePath === next.path;
      const sameStep = installedCodeStep === next.step;
      const sameDocument = installedCodeDocument === next.document;
      const localEcho = sameDocument && samePath && locallyAppliedStep === next.step;
      installedCodePath = next.path;
      installedCodeStep = next.step;
      installedCodeDocument = next.document;
      locallyAppliedStep = undefined;
      if (localEcho || sameDocument && samePath && sameStep) return;
      setCodeDraft(next.text);
      setCodeDocumentKey(next.document);
      setCodeError(null);
    },
  );

  const handleCodeChange = (code: string) => {
    setCodeDraft(code);
    try {
      const ast = parse(code) as Expression;
      const p = path();
      if (!p) return;
      const { steps, lossless } = projectBodyToSteps(ast);
      if (!lossless || steps.length !== 1) {
        setCodeError("This code does not represent one step. Keep editing here, or use the expression lens.");
        return;
      }
      locallyAppliedStep = draftValueFingerprint(steps[0]);
      functionStore.updateStep(p, steps[0]!);
      setCodeError(null);
    } catch (e) {
      setCodeError(e instanceof ParseError ? e.message : e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div class="fe-editor">
      <Show when={step()} fallback={<p class="fe-editor-empty">No step selected</p>}>
        {(s) => (
          <>
            <div class="fe-editor-toolbar">
              <button
                class={`fe-editor-toggle ${codeView() ? "fe-editor-toggle--active" : ""}`}
                onClick={() => setCodeView(!codeView())}
                data-tooltip={codeView() ? "Switch to visual editor" : "Switch to code editor"}
              >
                {codeView() ? "Visual" : "Code"}
              </button>
            </div>

            <Show when={codeView()} fallback={
              <>
                <Show when={s().type === "action"}>
                  <ActionEditor step={s() as ActionStep} path={path()!} />
                </Show>
                <Show when={s().type === "wait"}>
                  <WaitEditor step={s() as WaitStep} path={path()!} />
                </Show>
                <Show when={s().type === "set"}>
                  <SetEditor step={s() as SetStep} path={path()!} />
                </Show>
                <Show when={s().type === "scope"}>
                  <ScopeEditor step={s() as ScopeStep} path={path()!} />
                </Show>
                <Show when={s().type === "branch"}>
                  <BranchEditor step={s() as BranchStep} path={path()!} />
                </Show>
                <Show when={s().type === "choose"}>
                  <ChooseEditor step={s() as ChooseStep} path={path()!} />
                </Show>
                <Show when={s().type === "call_function"}>
                  <CallFunctionEditor step={s() as CallFunctionStep} path={path()!} />
                </Show>
              </>
            }>
              <FenelCodeEditor
                value={codeDraft()}
                documentKey={codeDocumentKey()}
                onChange={handleCodeChange}
                minHeight="200px"
              />
              <Show when={codeError()}>
                <p class="fe-editor-error">{codeError()}</p>
              </Show>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parameter picker — schema-aware dropdown (reads from module registry)
// ---------------------------------------------------------------------------

function ParamPicker(props: {
  actionName: string;
  existingKeys: string[];
  onAdd: (key: string, defaultValue: unknown) => void;
}) {
  const session = useAuthoringSession();
  const spec = createStepActionSpec(session, () => props.actionName);
  const available = () => (spec()?.params ?? []).filter((p) => !props.existingKeys.includes(p.name));
  const [open, setOpen] = createSignal(false);

  function addParam(param: FieldDef) {
    props.onAdd(param.name, defaultValueForType(param.type));
    setOpen(false);
  }

  function addCustom() {
    props.onAdd("", "");
    setOpen(false);
  }

  return (
    <div class="fe-param-picker">
      <button class="fe-btn-add" onClick={() => setOpen(!open())}>
        <IconPlus size={12} /> Add parameter <IconChevronDown size={12} />
      </button>
      <Show when={open()}>
        <div class="fe-icon-select-backdrop" onClick={() => setOpen(false)} />
        <div class="fe-param-picker-menu">
          <For each={available()}>
            {(param) => (
              <button class="fe-param-picker-item" onClick={() => addParam(param)}>
                <span><ProductFieldLabel field={param} session={session} /></span>
                <Show when={!peelMaybe(param.type ?? { $void: true })}>
                  <span class="fe-param-req-badge">required</span>
                </Show>
              </button>
            )}
          </For>
          <Show when={available().length > 0}>
            <div class="fe-icon-select-divider" />
          </Show>
          <button class="fe-param-picker-item" onClick={addCustom}>
            <IconPencil size={13} />
            <span>Custom...</span>
          </button>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-editors
// ---------------------------------------------------------------------------

function ActionEditor(props: { step: ActionStep; path: (number | string)[] }) {
  const session = useAuthoringSession();
  const functionStore = useFunctionEditorStore();
  const isKnown = () => getActionPresets(session).some((p) => p.value === props.step.name);
  const [forceCustom, setForceCustom] = createSignal(untrack(() =>
    props.step.name !== "" && !getActionPresets(session).some((p) => p.value === props.step.name),
  ));
  const showCustom = () => forceCustom() || (props.step.name !== "" && !isKnown());
  const selectValue = () => {
    if (showCustom()) return "__custom__";
    if (props.step.name === "") return "";
    return props.step.name;
  };
  const paramEntries = () => Object.entries(props.step.params);
  const actionSpec = createStepActionSpec(session, () => props.step.name);
  const reader = useReaderRuntime();
  const local = localEditorSession(reader, session);
  const [actionIssue, setActionIssue] = createSignal<string>();

  function getParamSpec(key: string): FieldDef | undefined {
    return actionSpec()?.params.find((p) => p.name === key);
  }

  /** Project the param spec to a FieldDef shape for FieldRenderer.
   *  FunctionParam = FieldDef now, so this is essentially identity —
   *  keep the wrapper for explicitness at the call site. */
  function paramToField(p: FieldDef): FieldDef {
    return p;
  }

  /** The step's params with the action's missing required params added. */
  function withRequiredParams(params: Record<string, unknown>, spec: FenelFunction | undefined) {
    const newParams = { ...params };
    if (spec) {
      for (const param of spec.params) {
        const isRequired = !peelMaybe(param.type ?? { $void: true });
        if (isRequired && !(param.name in newParams)) {
          newParams[param.name] = defaultValueForType(param.type);
        }
      }
    }
    return newParams;
  }

  function setName(name: string) {
    setActionIssue(undefined);
    if (!local) {
      // Auto-populate required params for the new action type
      const spec = getRegistry(session).getIdentifiedFunction(name);
      functionStore.updateStep(props.path, { ...props.step, name, params: withRequiredParams(props.step.params, spec) });
      return;
    }
    // A Local reader applies the name at once; its worker then supplies the
    // action's required params, added only while the step still names it.
    functionStore.updateStep(props.path, { ...props.step, name });
    if (!name) return;
    const path = props.path, at = JSON.stringify(path);
    const still = () => JSON.stringify(props.path) === at && props.step.name === name;
    void runLocalReaderAction(reader, () => session, actionDefinitionQuery(name), readActionDefinition).then(lookup => {
      if (!still()) return;
      const params = withRequiredParams(props.step.params, lookup.fn);
      if (Object.keys(params).length !== Object.keys(props.step.params).length)
        functionStore.updateStep(path, { ...props.step, params });
    }, (error: unknown) => {
      if (!still()) return;
      setActionIssue(error instanceof Error ? `This action's parameters could not be prepared: ${error.message}`
        : "This action's parameters could not be prepared.");
    });
  }

  function setParam(key: string, value: unknown) {
    functionStore.updateStep(props.path, {
      ...props.step,
      params: { ...props.step.params, [key]: value },
    });
  }

  function removeParam(key: string) {
    const params = { ...props.step.params };
    delete params[key];
    functionStore.updateStep(props.path, { ...props.step, params });
  }

  function renameParamKey(oldKey: string, newKey: string) {
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props.step.params)) {
      params[k === oldKey ? newKey : k] = v;
    }
    functionStore.updateStep(props.path, { ...props.step, params });
  }

  function addParam(key: string, defaultValue: unknown) {
    functionStore.updateStep(props.path, {
      ...props.step,
      params: { ...props.step.params, [key]: defaultValue },
    });
  }

  return (
    <div class="fe-fields">
      <div class="fe-label">Action</div>
      <IconSelect
        value={selectValue()}
        options={getActionPresets(session)}
        iconMap={ACTION_STEP_ICONS}
        defaultIcon={IconBolt}
        placeholder="Select an action..."
        hasCustom
        onChange={(v) => {
          if (v === "__custom__") {
            setForceCustom(true);
            if (isKnown()) setName("");
          } else {
            setForceCustom(false);
            setName(v);
          }
        }}
      />
      <Show when={showCustom()}>
        <label class="fe-label">
          Custom action name
          <input
            class="fe-input"
            value={props.step.name}
            placeholder="e.g. my_custom_action"
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
      </Show>

      <Show when={actionIssue()}>{issue => <p class="text-muted" role="alert">{issue()}</p>}</Show>
      <div class="fe-sub-label">Parameters</div>
      <For keyed={false} each={paramEntries()}>
        {(entry) => {
          const key = () => entry()[0];
          const value = () => entry()[1];
          const spec = () => getParamSpec(key());
          const field = () => {
            const s = spec();
            return s ? paramToField(s) : inferFieldFromValue(key(), value());
          };
          const isKnown = () => spec() !== undefined;

          return (
            <div class="fe-param-card">
              <div class="fe-param-header">
                <Show
                  when={isKnown()}
                  fallback={
                    <input
                      class="fe-input fe-input--sm fe-param-key-input"
                      value={key()}
                      placeholder="param name"
                      onInput={(e) => renameParamKey(key(), e.currentTarget.value)}
                    />
                  }
                >
                  <span class="fe-param-name">
                    <ProductFieldLabel field={field()} session={session} />
                    <Show when={!peelMaybe(field().type ?? { $void: true })}>
                      <span class="fe-param-req">*</span>
                    </Show>
                  </span>
                </Show>
                <button class="fe-btn-danger-sm" onClick={() => removeParam(key())}>
                  &times;
                </button>
              </div>
              <FieldRenderer
                registry={getRegistry(session)}
                identityMode={isKnown() ? "identified" : "transient"}
                field={field()}
                value={value()}
                onChange={(v) => setParam(key(), v)}
                compact
              />
            </div>
          );
        }}
      </For>
      <ParamPicker
        actionName={props.step.name}
        existingKeys={paramEntries().map((e) => e[0])}
        onAdd={addParam}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Set (variable assignment) editor
// ---------------------------------------------------------------------------

function SetEditor(props: { step: SetStep; path: (number | string)[] }) {
  const functionStore = useFunctionEditorStore();
  const entries = () => Object.entries(props.step.assignments);

  function update(assignments: Record<string, string>) {
    functionStore.updateStep(props.path, { ...props.step, assignments });
  }

  function setEntry(key: string, value: string) {
    update({ ...props.step.assignments, [key]: value });
  }

  function removeEntry(key: string) {
    const a = { ...props.step.assignments };
    delete a[key];
    update(a);
  }

  function renameKey(oldKey: string, newKey: string) {
    const a: Record<string, string> = {};
    for (const [k, v] of Object.entries(props.step.assignments)) {
      a[k === oldKey ? newKey : k] = v;
    }
    update(a);
  }

  function addEntry() {
    update({ ...props.step.assignments, "": "" });
  }

  return (
    <div class="fe-fields">
      <div class="fe-sub-label">Assignments</div>
      <div class="fe-set-hint">
        Use <code>$vars.name</code> to reference function variables in expressions.
      </div>
      <For keyed={false} each={entries()}>
        {(entry) => (
          <div class="fe-set-row">
            <input
              class="fe-input fe-input--sm fe-set-key"
              value={entry()[0]}
              placeholder="variable"
              onInput={(e) => renameKey(entry()[0], e.currentTarget.value)}
            />
            <span class="fe-set-eq">=</span>
            <InlineCodeEditor
              value={entry()[1]}
              documentKey={JSON.stringify([functionStore.selectedStepDocumentKey, "assignment", entry()[0]])}
              placeholder="expression"
              onChange={(v) => setEntry(entry()[0] || v, v)}
            />
            <button
              class="fe-btn-danger-sm"
              onClick={() => removeEntry(entry()[0])}
            >
              &times;
            </button>
          </div>
        )}
      </For>
      <button class="fe-btn-add" onClick={addEntry}>
        <IconPlus size={12} /> Add assignment
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scope (local variable block) editor
// ---------------------------------------------------------------------------

function ScopeEditor(props: { step: ScopeStep; path: (number | string)[] }) {
  const functionStore = useFunctionEditorStore();
  const entries = () => Object.entries(props.step.vars);

  function updateVars(vars: Record<string, string>) {
    functionStore.updateStep(props.path, { ...props.step, vars });
  }

  function setEntry(key: string, value: string) {
    updateVars({ ...props.step.vars, [key]: value });
  }

  function removeEntry(key: string) {
    const v = { ...props.step.vars };
    delete v[key];
    updateVars(v);
  }

  function renameKey(oldKey: string, newKey: string) {
    const v: Record<string, string> = {};
    for (const [k, val] of Object.entries(props.step.vars)) {
      v[k === oldKey ? newKey : k] = val;
    }
    updateVars(v);
  }

  function addEntry() {
    updateVars({ ...props.step.vars, "": "" });
  }

  return (
    <div class="fe-fields">
      <div class="fe-sub-label">Local Variables</div>
      <div class="fe-set-hint">
        Variables declared here are local to this scope block.
        Child steps can read parent variables, but <code>set</code> writes to the nearest scope.
        Use <code>$flow.varName</code> to write to the root function scope.
      </div>
      <For keyed={false} each={entries()}>
        {(entry) => (
          <div class="fe-set-row">
            <input
              class="fe-input fe-input--sm fe-set-key"
              value={entry()[0]}
              placeholder="variable"
              onInput={(e) => renameKey(entry()[0], e.currentTarget.value)}
            />
            <span class="fe-set-eq">=</span>
            <InlineCodeEditor
              value={entry()[1]}
              documentKey={JSON.stringify([functionStore.selectedStepDocumentKey, "local", entry()[0]])}
              placeholder="initial value"
              onChange={(v) => setEntry(entry()[0], v)}
            />
            <button
              class="fe-btn-danger-sm"
              onClick={() => removeEntry(entry()[0])}
            >
              &times;
            </button>
          </div>
        )}
      </For>
      <button class="fe-btn-add" onClick={addEntry}>
        <IconPlus size={12} /> Add local variable
      </button>
    </div>
  );
}

// ConditionBuilder, ConditionTreeModal, CompareLeaf imported from ~/lib/expression-builder

// ---------------------------------------------------------------------------
// Wait leaf — Duration / Event / Date
// ---------------------------------------------------------------------------

function WaitLeaf(props: { condition: any; onChange: (c: any) => void; removable: boolean; onRemove?: () => void }) {
  const functionStore = useFunctionEditorStore();
  function changeOp(newOp: string) {
    switch (newOp) {
      case "duration": props.onChange({ op: "duration", value: "1h" }); break;
      case "event": props.onChange({ op: "event", event: "", filters: {} }); break;
      case "date": props.onChange({ op: "date", expression: "" }); break;
    }
  }

  return (
    <>
      <div class="fe-cond-header">
        <LocusSelect label="Wait until" value={props.condition.op} onChange={changeOp}
          options={[{ value: "duration", label: "Duration" }, { value: "event", label: "Event" }, { value: "date", label: "Date" }]} />
        <Show when={props.removable}>
          <button class="fe-cond-remove" data-tooltip="Remove" onClick={() => props.onRemove?.()}>
            <IconTrash size={13} />
          </button>
        </Show>
      </div>

      <Show when={props.condition.op === "duration"}>
        <label class="fe-label">
          Wait for
          <input class="fe-input" value={props.condition.value} placeholder="e.g. 5m, 2h, 1d"
            onInput={(e) => props.onChange({ ...props.condition, op: "duration", value: e.currentTarget.value })} />
        </label>
        <label class="fe-label fe-label--inline">
          <input type="checkbox" checked={props.condition.repeat ?? false}
            onChange={(e) => props.onChange({ ...props.condition, repeat: e.currentTarget.checked || undefined })} />
          Repeat
        </label>
      </Show>

      <Show when={props.condition.op === "event"}>
        <EventConditionEditor condition={props.condition} onChange={props.onChange} />
      </Show>

      <Show when={props.condition.op === "date"}>
        <label class="fe-label">
          Date expression
          <InlineCodeEditor
            value={props.condition.expression ?? ""}
            documentKey={JSON.stringify([functionStore.selectedStepDocumentKey, "wait-date"])}
            placeholder="e.g. $entitlement.expiresAt - 14_days"
            onChange={(v) => props.onChange({ ...props.condition, op: "date", expression: v })}
          />
        </label>
        <label class="fe-label fe-label--inline">
          <input type="checkbox" checked={props.condition.repeat ?? false}
            onChange={(e) => props.onChange({ ...props.condition, repeat: e.currentTarget.checked || undefined })} />
          Repeat (recurring schedule)
        </label>
      </Show>
    </>
  );
}

function EventConditionEditor(props: {
  condition: { op: "event"; event: string; filters?: Record<string, unknown>; repeat?: boolean };
  onChange: (c: WaitCondition) => void;
}) {
  const functionStore = useFunctionEditorStore();
  const isKnownEvent = () => EVENT_PRESETS.some((p) => p.value === props.condition.event);
  const [forceCustom, setForceCustom] = createSignal(
    props.condition.event !== "" && !EVENT_PRESETS.some((p) => p.value === props.condition.event),
  );
  const showCustom = () => forceCustom() || (props.condition.event !== "" && !isKnownEvent());
  const selectValue = () => {
    if (showCustom()) return "__custom__";
    if (props.condition.event === "") return "";
    return props.condition.event;
  };
  const filterEntries = () => Object.entries(props.condition.filters ?? {});

  function setEvent(event: string) { props.onChange({ ...props.condition, event }); }
  function setFilter(key: string, value: unknown) {
    props.onChange({ ...props.condition, filters: { ...(props.condition.filters ?? {}), [key]: value } });
  }
  function removeFilter(key: string) {
    const f = { ...(props.condition.filters ?? {}) }; delete f[key];
    props.onChange({ ...props.condition, filters: f });
  }
  function renameFilterKey(oldKey: string, newKey: string) {
    const f: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props.condition.filters ?? {})) { f[k === oldKey ? newKey : k] = v; }
    props.onChange({ ...props.condition, filters: f });
  }
  function addFilter() {
    props.onChange({ ...props.condition, filters: { ...(props.condition.filters ?? {}), "": "" } });
  }

  return (
    <>
      <div class="fe-label">Event type</div>
      <IconSelect value={selectValue()} options={EVENT_PRESETS} iconMap={EVENT_STEP_ICONS} defaultIcon={IconBell}
        placeholder="Select an event..." hasCustom
        onChange={(v) => {
          if (v === "__custom__") { setForceCustom(true); if (isKnownEvent()) setEvent(""); }
          else { setForceCustom(false); setEvent(v); }
        }}
      />
      <Show when={showCustom()}>
        <label class="fe-label">Custom event name
          <input class="fe-input" value={props.condition.event} placeholder="e.g. my_custom_event" onInput={(e) => setEvent(e.currentTarget.value)} />
        </label>
      </Show>
      <div class="fe-sub-label">Filters</div>
      <div class="fe-set-hint">Match events where these fields equal the given values.</div>
      <For keyed={false} each={filterEntries()}>
        {(entry) => (
          <div class="fe-set-row">
            <input class="fe-input fe-input--sm fe-set-key" value={entry()[0]} placeholder="field" onInput={(e) => renameFilterKey(entry()[0], e.currentTarget.value)} />
            <span class="fe-set-eq">=</span>
            <InlineCodeEditor
              value={stringifyValue(entry()[1])}
              documentKey={JSON.stringify([functionStore.selectedStepDocumentKey, "event-filter", entry()[0]])}
              placeholder="value"
              onChange={(v) => setFilter(entry()[0], parseValue(v))}
            />
            <button class="fe-btn-danger-sm" onClick={() => removeFilter(entry()[0])}>&times;</button>
          </div>
        )}
      </For>
      <button class="fe-btn-add" onClick={addFilter}><IconPlus size={12} /> Add filter</button>
      <label class="fe-label fe-label--inline">
        <input type="checkbox" checked={props.condition.repeat ?? false}
          onChange={(e) => props.onChange({ ...props.condition, repeat: e.currentTarget.checked || undefined } as WaitCondition)} />
        Repeat (fire every occurrence)
      </label>
    </>
  );
}

// BranchLeaf is now CompareLeaf from ~/lib/expression-builder
const BranchLeaf = (props: LeafRenderProps) => CompareLeaf(props);

// ---------------------------------------------------------------------------
// Wait condition editor
// ---------------------------------------------------------------------------

function waitConditionLabel(c: WaitCondition): string {
  switch (c.op) {
    case "duration": return `Duration: ${c.value || "..."}`;
    case "event": return `Event: ${c.event || "..."}`;
    case "date": return `Date: ${c.expression || "..."}`;
    default: return "...";
  }
}

function WaitEditor(props: { step: WaitStep; path: (number | string)[] }) {
  const functionStore = useFunctionEditorStore();
  const isGroup = () => props.step.condition.op === "and" || props.step.condition.op === "or";
  const [treeOpen, setTreeOpen] = createSignal(false);

  function updateCondition(condition: WaitCondition) {
    functionStore.updateStep(props.path, { ...props.step, condition });
  }

  function wrapInGroup(op: "and" | "or") {
    updateCondition({ op, children: [props.step.condition, { op: "duration", value: "1h" }] } as WaitCondition);
  }

  return (
    <div class="fe-fields">
      <div class="fe-cond-editor-header">
        <div class="fe-sub-label">Condition</div>
        <Show when={isGroup()}>
          <button class="fe-tree-view-btn" onClick={() => setTreeOpen(true)}>Show tree</button>
        </Show>
      </div>
      <ConditionBuilder
        condition={props.step.condition}
        onChange={updateCondition}
        depth={0}
        removable={false}
        renderLeaf={(lp) => <WaitLeaf {...lp} />}
        createBlank={() => ({ op: "duration", value: "1h" })}
      />
      <Show when={!isGroup()}>
        <div class="fe-cond-compose">
          <button class="fe-cond-compose-btn fe-cond-compose-btn--and" onClick={() => wrapInGroup("and")}>+ AND</button>
          <button class="fe-cond-compose-btn fe-cond-compose-btn--or" onClick={() => wrapInGroup("or")}>+ OR</button>
        </div>
      </Show>
      <ConditionTreeModal condition={props.step.condition} onChange={updateCondition} labelFn={waitConditionLabel} createBlank={() => ({ op: "duration", value: "1h" })} open={treeOpen()} onClose={() => setTreeOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Branch / Choose / Call Function editors
// ---------------------------------------------------------------------------

function branchLeafLabel(c: BranchCondition): string {
  switch (c.op) {
    case "compare": {
      if (!c.field && !c.value) return "...";
      return `${c.field || "?"} ${c.cmp} ${c.value || "?"}`;
    }
    case "expr": return c.expression || "...";
    default: return "...";
  }
}

function BranchEditor(props: { step: BranchStep; path: (number | string)[] }) {
  const functionStore = useFunctionEditorStore();
  function updateArm(index: number, updates: Partial<BranchStep["arms"][0]>) {
    const arms = [...props.step.arms];
    arms[index] = { ...arms[index], ...updates };
    functionStore.updateStep(props.path, { ...props.step, arms });
  }

  function removeArm(index: number) {
    const arms = props.step.arms.filter((_, idx) => idx !== index);
    functionStore.updateStep(props.path, { ...props.step, arms });
  }

  function wrapArmCondition(index: number, op: "and" | "or") {
    const arm = props.step.arms[index];
    const cond = typeof arm.when === "string" ? migrateBranchWhen(arm.when) : arm.when;
    updateArm(index, { when: { op, children: [cond, { op: "compare", field: "", cmp: "==", value: "" }] } as BranchCondition });
  }

  return (
    <div class="fe-fields">
      <div class="fe-sub-label">Arms</div>
      <For each={props.step.arms}>
        {(arm, i) => {
          const cond = () => typeof arm.when === "string" ? migrateBranchWhen(arm.when) : arm.when;
          const isGroup = () => cond().op === "and" || cond().op === "or";
          const [treeOpen, setTreeOpen] = createSignal(false);

          return (
            <div class="fe-branch-arm-editor">
              <div class="fe-branch-arm-header">
                <input class="fe-input fe-input--sm" value={arm.label ?? ""} placeholder="Arm name"
                  onInput={(e) => updateArm(i(), { label: e.currentTarget.value })} />
                <button class="fe-btn-danger-sm" onClick={() => removeArm(i())}>&times;</button>
              </div>
              <div class="fe-branch-arm-condition">
                <div class="fe-cond-editor-header">
                  <div class="fe-sub-label" style="margin-bottom: 0">Condition</div>
                  <Show when={isGroup()}>
                    <button class="fe-tree-view-btn" onClick={() => setTreeOpen(true)}>Show tree</button>
                  </Show>
                </div>
                <ConditionBuilder
                  condition={cond()}
                  onChange={(c) => updateArm(i(), { when: c })}
                  depth={0}
                  removable={false}
                  renderLeaf={(lp) => <BranchLeaf {...lp} />}
                  createBlank={() => ({ op: "compare", field: "", cmp: "==", value: "" })}
                  variables={getFunctionVariables(functionStore)}
                />
                <Show when={!isGroup()}>
                  <div class="fe-cond-compose">
                    <button class="fe-cond-compose-btn fe-cond-compose-btn--and" onClick={() => wrapArmCondition(i(), "and")}>+ AND</button>
                    <button class="fe-cond-compose-btn fe-cond-compose-btn--or" onClick={() => wrapArmCondition(i(), "or")}>+ OR</button>
                  </div>
                </Show>
                <ConditionTreeModal condition={cond()} onChange={(c) => updateArm(i(), { when: c })} labelFn={branchLeafLabel} createBlank={() => ({ op: "compare", field: "", cmp: "==", value: "" })} open={treeOpen()} onClose={() => setTreeOpen(false)} />
              </div>
            </div>
          );
        }}
      </For>
      <button class="fe-btn-add" onClick={() => functionStore.addBranchArm(props.path, `Arm ${props.step.arms.length + 1}`)}>
        + Add arm
      </button>
    </div>
  );
}

function ChooseEditor(props: { step: ChooseStep; path: (number | string)[] }) {
  const functionStore = useFunctionEditorStore();
  return (
    <div class="fe-fields">
      <label class="fe-label">
        Notify channel
        <input
          class="fe-input"
          value={props.step.notify.channel}
          placeholder="channel slug"
          onInput={(e) =>
            functionStore.updateStep(props.path, {
              ...props.step,
              notify: { ...props.step.notify, channel: e.currentTarget.value },
            })
          }
        />
      </label>
      <label class="fe-label">
        Message
        <textarea
          class="fe-textarea"
          rows={2}
          value={props.step.notify.message}
          placeholder="Message shown with options"
          onInput={(e) =>
            functionStore.updateStep(props.path, {
              ...props.step,
              notify: { ...props.step.notify, message: e.currentTarget.value },
            })
          }
        />
      </label>
      <div class="fe-sub-label">Options</div>
      <For each={props.step.options}>
        {(opt, i) => (
          <div class="fe-arm-row">
            <input
              class="fe-input fe-input--sm"
              value={opt.label}
              placeholder="Option label"
              onInput={(e) => {
                const options = [...props.step.options];
                options[i()] = { ...opt, label: e.currentTarget.value };
                functionStore.updateStep(props.path, { ...props.step, options });
              }}
            />
            <button
              class="fe-btn-danger-sm"
              onClick={() => {
                const options = props.step.options.filter(
                  (_, idx) => idx !== i(),
                );
                functionStore.updateStep(props.path, { ...props.step, options });
              }}
            >
              &times;
            </button>
          </div>
        )}
      </For>
      <button
        class="fe-btn-add"
        onClick={() =>
          functionStore.addChooseOption(
            props.path,
            `Option ${props.step.options.length + 1}`,
          )
        }
      >
        + Add option
      </button>
    </div>
  );
}

function CallFunctionEditor(props: { step: CallFunctionStep; path: (number | string)[] }) {
  const functionStore = useFunctionEditorStore();
  const isSelf = () => props.step.flow === "self";
  const paramNames = () => Object.keys(functionStore.state.vars);
  const argEntries = () => Object.entries(props.step.args);

  function setFlow(flow: string) {
    functionStore.updateStep(props.path, { ...props.step, flow });
  }

  function setArg(key: string, value: string) {
    functionStore.updateStep(props.path, {
      ...props.step,
      args: { ...props.step.args, [key]: value },
    });
  }

  function removeArg(key: string) {
    const args = { ...props.step.args };
    delete args[key];
    functionStore.updateStep(props.path, { ...props.step, args });
  }

  function renameArgKey(oldKey: string, newKey: string) {
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props.step.args)) {
      args[k === oldKey ? newKey : k] = v;
    }
    functionStore.updateStep(props.path, { ...props.step, args });
  }

  function addArg() {
    functionStore.updateStep(props.path, {
      ...props.step,
      args: { ...props.step.args, "": "" },
    });
  }

  /** Pre-fill args with current function's param names */
  function populateFromParams() {
    const args = { ...props.step.args };
    for (const name of paramNames()) {
      if (!(name in args)) args[name] = "";
    }
    functionStore.updateStep(props.path, { ...props.step, args });
  }

  return (
    <div class="fe-fields">
      {/* Target: self or other function */}
      <div class="fe-sub-label">Target</div>
      <div class="fe-call-target">
        <label class="fe-call-radio">
          <input
            type="radio"
            name="call-target"
            checked={isSelf()}
            onChange={() => {
              setFlow("self");
              functionStore.updateStep(props.path, {
                ...props.step,
                flow: "self",
                max_depth: props.step.max_depth ?? 100,
              });
            }}
          />
          <span class="fe-call-radio-label">Self (recursive)</span>
        </label>
        <label class="fe-call-radio">
          <input
            type="radio"
            name="call-target"
            checked={!isSelf()}
            onChange={() => setFlow("")}
          />
          <span class="fe-call-radio-label">Other function</span>
        </label>
      </div>

      {/* Function name (only for external calls) */}
      <Show when={!isSelf()}>
        <label class="fe-label">
          Function name
          <input
            class="fe-input"
            value={props.step.flow}
            placeholder="e.g. onboarding_sequence"
            onInput={(e) => setFlow(e.currentTarget.value)}
          />
        </label>
      </Show>

      {/* Max depth (only for self-calls) */}
      <Show when={isSelf()}>
        <label class="fe-label">
          Max recursion depth
          <input
            class="fe-input"
            type="number"
            min="1"
            max="10000"
            value={props.step.max_depth ?? 100}
            onInput={(e) =>
              functionStore.updateStep(props.path, {
                ...props.step,
                max_depth: parseInt(e.currentTarget.value) || 100,
              })
            }
          />
        </label>
      </Show>

      {/* Arguments */}
      <div class="fe-sub-label">
        Arguments
        <Show when={isSelf() && paramNames().length > 0}>
          <button class="fe-call-populate" onClick={populateFromParams}>
            Fill from parameters
          </button>
        </Show>
      </div>
      <Show when={isSelf()}>
        <div class="fe-set-hint">
          Override the function's parameters for the recursive call.
          Unset args keep their current value from the parent call.
        </div>
      </Show>
      <div class="fe-set-rows">
        <For keyed={false} each={argEntries()}>
          {(entry) => (
            <div class="fe-set-row">
              <input
                class="fe-input fe-input--sm fe-set-key"
                value={entry()[0]}
                placeholder={isSelf() && paramNames().length > 0 ? "param name" : "key"}
                list={isSelf() ? "param-hints" : undefined}
                onInput={(e) => renameArgKey(entry()[0], e.currentTarget.value)}
              />
              <span class="fe-set-eq">=</span>
              <InlineCodeEditor
                value={String(entry()[1] ?? "")}
                documentKey={JSON.stringify([functionStore.selectedStepDocumentKey, "argument", entry()[0]])}
                placeholder="value"
                onChange={(v) => setArg(entry()[0] || v, v)}
              />
              <button
                class="fe-btn-danger-sm"
                onClick={() => removeArg(entry()[0])}
              >
                &times;
              </button>
            </div>
          )}
        </For>
      </div>
      <button class="fe-btn-add" onClick={addArg}>
        <IconPlus size={12} /> Add argument
      </button>

      {/* Datalist for param name hints */}
      <Show when={isSelf() && paramNames().length > 0}>
        <datalist id="param-hints">
          <For each={paramNames()}>
            {(name) => <option value={name} />}
          </For>
        </datalist>
      </Show>
    </div>
  );
}
