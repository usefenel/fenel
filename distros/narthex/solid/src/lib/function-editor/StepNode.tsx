import { For, Show, createSignal, onSettled, onCleanup } from "solid-js";
import {
  IconBolt,
  IconClock,
  IconBell,
  IconCalendar,
  IconGitBranch,
  IconListCheck,
  IconPlayerPlay,
  IconRepeat,
  IconVariable,
  IconBraces,
  IconPlus,
  IconTrash,
  IconChevronDown,
  ACTION_STEP_ICONS,
} from "~/lib/icons";
import type { FunctionStep, StepPath, BranchStep, ChooseStep, CallFunctionStep, ScopeStep, ActionStep } from "./types";
import { useFunctionEditorStore } from "./store";
import { createBlankStep, STEP_TYPE_GROUPS, conditionLabel, branchConditionLabel } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WAIT_COLOR = { bg: "#fefce8", accent: "#eab308", icon: "#b45309" };

const STEP_COLORS: Record<string, { bg: string; accent: string; icon: string }> = {
  action:        { bg: "#eff6ff", accent: "#3b82f6", icon: "#2563eb" },
  wait:          WAIT_COLOR,
  wait_duration: WAIT_COLOR,
  wait_event:    WAIT_COLOR,
  wait_date:     WAIT_COLOR,
  set:           { bg: "#fdf2f8", accent: "#ec4899", icon: "#be185d" },
  scope:         { bg: "#f8fafc", accent: "#64748b", icon: "#475569" },
  branch:        { bg: "#f0fdf4", accent: "#22c55e", icon: "#15803d" },
  choose:        { bg: "#ecfeff", accent: "#06b6d4", icon: "#0e7490" },
  call_function:     { bg: "#f5f3ff", accent: "#8b5cf6", icon: "#6d28d9" },
  call_self:     { bg: "#fff7ed", accent: "#f97316", icon: "#c2410c" },
  // Behavioral nodes — warm amber palette (distinct from routing green / wait yellow)
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanize(s: string): string {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function stepLabel(step: FunctionStep): string {
  switch (step.type) {
    case "action":
      return step.name ? humanize(step.name) : "Unnamed Action";
    case "wait":
      return `Wait · ${conditionLabel(step.condition)}`;
    case "set": {
      const keys = Object.keys(step.assignments);
      if (keys.length === 0) return "Set · ...";
      return keys.map((k) => `${k} = ${step.assignments[k]}`).join(", ");
    }
    case "scope": {
      const varCount = Object.keys(step.vars).length;
      const stepCount = step.steps.length;
      return `Scope · ${varCount} var${varCount !== 1 ? "s" : ""}, ${stepCount} step${stepCount !== 1 ? "s" : ""}`;
    }
    case "branch":
      return `Branch \u00b7 ${step.arms.length} paths`;
    case "choose":
      return `Choice \u00b7 ${step.options.length} options`;
    case "call_function":
      if (step.flow === "self") {
        const depth = step.max_depth;
        return depth ? `Recurse (max ${depth})` : "Recurse";
      }
      return step.flow ? `Run ${humanize(step.flow)}` : "Call Sub-function";
  }
}

function StepTypeIcon(props: { type: string; actionName?: string; size?: number }) {
  const s = () => props.size ?? 20;
  if (props.type === "action" && props.actionName) {
    const Icon = ACTION_STEP_ICONS[props.actionName];
    if (Icon) return <Icon size={s()} />;
  }
  switch (props.type) {
    case "action":        return <IconBolt size={s()} />;
    case "wait":          return <IconClock size={s()} />;
    case "wait_duration": return <IconClock size={s()} />;
    case "wait_event":    return <IconBell size={s()} />;
    case "wait_date":     return <IconCalendar size={s()} />;
    case "set":           return <IconVariable size={s()} />;
    case "scope":         return <IconBraces size={s()} />;
    case "branch":        return <IconGitBranch size={s()} />;
    case "choose":        return <IconListCheck size={s()} />;
    case "call_function":     return <IconPlayerPlay size={s()} />;
    case "call_self":     return <IconRepeat size={s()} />;
    default:              return <IconBolt size={s()} />;
  }
}

// ---------------------------------------------------------------------------
// Connector arrow between steps
// ---------------------------------------------------------------------------

function Connector() {
  return (
    <div class="fe-connector">
      <div class="fe-connector-line" />
      <div class="fe-connector-arrow" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add step dropdown
// ---------------------------------------------------------------------------

function AddStepButton(props: { containerPath: StepPath; index: number }) {
  const functionStore = useFunctionEditorStore();
  const [open, setOpen] = createSignal(false);
  let wrapperRef: HTMLDivElement | undefined;

  function handleAdd(type: string) {
    const step = createBlankStep(type);
    functionStore.insertStep(props.containerPath, props.index, step);
    setOpen(false);
  }

  function onDocClick(e: MouseEvent) {
    if (wrapperRef && !wrapperRef.contains(e.target as Node)) setOpen(false);
  }

  onSettled(() => document.addEventListener("mousedown", onDocClick));
  onCleanup(() => document.removeEventListener("mousedown", onDocClick));

  return (
    <div class="fe-add-step" ref={wrapperRef} style={{ "z-index": open() ? "50" : undefined }}>
      <button
        class="fe-add-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open());
        }}
        data-tooltip="Add step"
      >
        <IconPlus size={14} />
        <span>Add step</span>
        <IconChevronDown size={12} />
      </button>
      <Show when={open()}>
        <div class="fe-add-menu">
          <For each={STEP_TYPE_GROUPS}>
            {(group) => (
              <>
                <Show when={group.title}>
                  <div class="fe-add-group-title">{group.title}</div>
                </Show>
                <For each={group.items}>
                  {(t) => {
                    const colors = STEP_COLORS[t.value] ?? STEP_COLORS.action;
                    return (
                      <button
                        class="fe-add-option"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAdd(t.value);
                        }}
                      >
                        <span
                          class="fe-add-option-icon"
                          style={{ color: colors.icon }}
                        >
                          <StepTypeIcon type={t.value} size={16} />
                        </span>
                        <span>{t.label}</span>
                      </button>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step list (recursive)
// ---------------------------------------------------------------------------

export function StepList(props: { steps: FunctionStep[]; basePath: StepPath; nested?: boolean }) {
  return (
    <div class="fe-step-list">
      <Show when={props.steps.length === 0}>
        <AddStepButton containerPath={props.basePath} index={0} />
      </Show>
      {/* Leading add button before first step */}
      <Show when={props.steps.length > 0}>
        <div class="fe-between-connector fe-between-connector--head">
          <AddStepButton containerPath={props.basePath} index={0} />
          <div class="fe-connector-arrow" />
        </div>
      </Show>
      <For each={props.steps}>
        {(step, i) => {
          const stepPath = (): StepPath => {
            if (props.basePath.length === 0) return [i()];
            return [...props.basePath, i()];
          };
          const isLast = () => i() === props.steps.length - 1;
          const isRouting = () => step.type === "branch" || step.type === "choose";
          return (
            <>
              <StepNode step={step} path={stepPath()} />
              {/* No trailing connector after routing steps — arms are the continuation */}
              <Show when={!(isLast() && isRouting())}>
                <div class={`fe-between-connector ${isLast() ? "fe-between-connector--tail" : ""}`}>
                  <AddStepButton containerPath={props.basePath} index={i() + 1} />
                  <Show when={!isLast()}>
                    <div class="fe-connector-arrow" />
                  </Show>
                </div>
              </Show>
            </>
          );
        }}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single step node
// ---------------------------------------------------------------------------

function StepNode(props: { step: FunctionStep; path: StepPath }) {
  const functionStore = useFunctionEditorStore();
  const isSelected = () => {
    const sel = functionStore.selectedPath;
    if (!sel) return false;
    return JSON.stringify(sel) === JSON.stringify(props.path);
  };

  const effectiveType = () => {
    if (props.step.type === "call_function" && (props.step as CallFunctionStep).flow === "self") return "call_self";
    return props.step.type;
  };
  const colors = () => STEP_COLORS[effectiveType()] ?? STEP_COLORS.action;
  const isRouting = () => props.step.type === "branch" || props.step.type === "choose" || props.step.type === "scope";

  return (
    <>
      {/* Regular step card (not for branch/choose — those render inside their arms) */}
      <Show when={!isRouting()}>
        <div
          class={`fe-step ${isSelected() ? "fe-step--selected" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            functionStore.select(props.path);
          }}
        >
          <div class="fe-step-header">
            <span class="fe-step-icon" style={{ color: colors().icon }}>
              <StepTypeIcon type={effectiveType()} actionName={props.step.type === "action" ? (props.step as ActionStep).name : undefined} size={20} />
            </span>
            <div class="fe-step-info">
              <span class="fe-step-type" style={{ color: colors().icon }}>
                {effectiveType() === "call_self" ? "Recurse" : humanize(props.step.type)}
              </span>
              <span class="fe-step-label">{stepLabel(props.step)}</span>
            </div>
            <button
              class="fe-step-delete"
              data-tooltip="Delete step"
              onClick={(e) => {
                e.stopPropagation();
                functionStore.requestDelete(props.path);
              }}
            >
              <IconTrash size={14} />
            </button>
          </div>
        </div>
      </Show>

      {/* Branch arms — pill renders on horizontal bar inside */}
      <Show when={props.step.type === "branch"}>
        <BranchArms step={props.step as BranchStep} path={props.path} selected={isSelected()} />
      </Show>

      {/* Choose options — pill renders on horizontal bar inside */}
      <Show when={props.step.type === "choose"}>
        <ChooseArms step={props.step as ChooseStep} path={props.path} selected={isSelected()} />
      </Show>

      {/* Scope — container block with child steps */}
      <Show when={props.step.type === "scope"}>
        <ScopeBlock step={props.step as ScopeStep} path={props.path} selected={isSelected()} />
      </Show>

    </>
  );
}

// ---------------------------------------------------------------------------
// Branch arms with splitting visuals
// ---------------------------------------------------------------------------

function RoutingPill(props: {
  step: FunctionStep;
  path: StepPath;
  selected: boolean;
}) {
  const functionStore = useFunctionEditorStore();
  const colors = () => STEP_COLORS[props.step.type] ?? STEP_COLORS.action;
  return (
    <div
      class={`fe-routing-pill ${props.selected ? "fe-routing-pill--selected" : ""}`}
      onClick={(e) => { e.stopPropagation(); functionStore.select(props.path); }}
    >
      <span class="fe-routing-icon" style={{ color: colors().icon }}>
        <StepTypeIcon type={props.step.type} size={16} />
      </span>
      <span class="fe-routing-label">{stepLabel(props.step)}</span>
      <button
        class="fe-step-delete"
        data-tooltip="Delete step"
        onClick={(e) => {
          e.stopPropagation();
          functionStore.requestDelete(props.path);
        }}
      >
        <IconTrash size={14} />
      </button>
    </div>
  );
}

function BranchArms(props: { step: BranchStep; path: StepPath; selected: boolean }) {
  return (
    <div class="fe-split">
      <RoutingPill step={props.step} path={props.path} selected={props.selected} />
      <div class="fe-split-arms">
        <For each={props.step.arms}>
          {(arm, i) => (
            <div class="fe-arm">
              <div class="fe-arm-connector" />
              <div class="fe-arm-header">
                <span class="fe-arm-label">{arm.label || humanize(arm.id)}</span>
                <span class="fe-arm-condition">{typeof arm.when === "string" ? arm.when : branchConditionLabel(arm.when)}</span>
              </div>
              <StepList
                steps={arm.steps}
                basePath={[...props.path, "b", i()]}
                nested
              />
              <div class="fe-arm-merge-connector" />
            </div>
          )}
        </For>
      </div>
      <div class="fe-merge-line" />
    </div>
  );
}

function ChooseArms(props: { step: ChooseStep; path: StepPath; selected: boolean }) {
  return (
    <div class="fe-split">
      <RoutingPill step={props.step} path={props.path} selected={props.selected} />
      <div class="fe-split-arms">
        <For each={props.step.options}>
          {(opt, i) => (
            <div class="fe-arm">
              <div class="fe-arm-connector" />
              <div class="fe-arm-header">
                <span class="fe-arm-label">{opt.label}</span>
              </div>
              <StepList
                steps={opt.steps}
                basePath={[...props.path, "c", i()]}
                nested
              />
              <div class="fe-arm-merge-connector" />
            </div>
          )}
        </For>
      </div>
      <div class="fe-merge-line" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scope block — container with local vars and child steps
// ---------------------------------------------------------------------------

function ScopeBlock(props: { step: ScopeStep; path: StepPath; selected: boolean }) {
  const functionStore = useFunctionEditorStore();
  const varNames = () => Object.keys(props.step.vars);
  return (
    <div
      class={`fe-scope ${props.selected ? "fe-scope--selected" : ""}`}
      onClick={(e) => { e.stopPropagation(); functionStore.select(props.path); }}
    >
      <div class="fe-scope-header">
        <span class="fe-scope-icon"><IconBraces size={16} /></span>
        <span class="fe-scope-title">Scope</span>
        <Show when={varNames().length > 0}>
          <span class="fe-scope-vars">
            {varNames().join(", ")}
          </span>
        </Show>
        <button
          class="fe-step-delete"
          data-tooltip="Delete step"
          onClick={(e) => {
            e.stopPropagation();
            functionStore.requestDelete(props.path);
          }}
        >
          <IconTrash size={14} />
        </button>
      </div>
      <div class="fe-scope-body">
        <StepList
          steps={props.step.steps}
          basePath={[...props.path, "s"]}
          nested
        />
      </div>
    </div>
  );
}

