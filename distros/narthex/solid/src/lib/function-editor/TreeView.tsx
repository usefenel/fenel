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
  IconChevronRight,
  ACTION_STEP_ICONS,
} from "~/lib/icons";
import type { FunctionStep, StepPath, BranchStep, ChooseStep, WaitStep, SetStep, ScopeStep, CallFunctionStep } from "./types";
import { useFunctionEditorStore } from "./store";
import { createBlankStep, STEP_TYPE_GROUPS, conditionLabel, branchConditionLabel } from "./types";
import type { WaitCondition } from "./types";

// ---------------------------------------------------------------------------
// Helpers (shared with StepNode — could extract later)
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
      return conditionLabel(step.condition);
    case "branch":
      return `${step.arms.length} paths`;
    case "choose":
      return `${step.options.length} options`;
    case "set": {
      const keys = Object.keys(step.assignments);
      if (keys.length === 0) return "Set · ...";
      return keys.map((k) => `${k} = ${step.assignments[k]}`).join(", ");
    }
    case "scope": {
      const varNames = Object.keys(step.vars);
      return varNames.length > 0 ? `{ ${varNames.join(", ")} }` : "{ }";
    }
    case "call_function":
      if (step.flow === "self") {
        const depth = step.max_depth;
        return depth ? `Recurse (max ${depth})` : "Recurse";
      }
      return step.flow ? humanize(step.flow) : "Sub-function";
  }
}

const STEP_ICONS: Record<string, (s: number) => any> = {
  action:    (s) => <IconBolt size={s} />,
  wait:      (s) => <IconClock size={s} />,
  branch:    (s) => <IconGitBranch size={s} />,
  set:       (s) => <IconVariable size={s} />,
  scope:     (s) => <IconBraces size={s} />,
  choose:    (s) => <IconListCheck size={s} />,
  call_function: (s) => <IconPlayerPlay size={s} />,
  call_self: (s) => <IconRepeat size={s} />,
};

const STEP_ACCENT: Record<string, string> = {
  action:    "#3b82f6",
  wait:      "#eab308",
  branch:    "#22c55e",
  choose:    "#06b6d4",
  scope:     "#64748b",
  call_function: "#8b5cf6",
  call_self: "#f97316",
};

// ---------------------------------------------------------------------------
// Inline add-step menu (compact, for tree rows)
// ---------------------------------------------------------------------------

function TreeAddButton(props: { containerPath: StepPath; index: number }) {
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
    <div
      class="tv-add-wrap"
      ref={wrapperRef}
      style={{ "z-index": open() ? "50" : undefined }}
    >
      <button
        class="tv-add-btn"
        onClick={(e) => { e.stopPropagation(); setOpen(!open()); }}
        data-tooltip="Add step"
      >
        <IconPlus size={11} />
      </button>
      <Show when={open()}>
        <div class="tv-add-menu">
          <For each={STEP_TYPE_GROUPS}>
            {(group) => (
              <>
                <Show when={group.title}>
                  <div class="tv-add-group-title">{group.title}</div>
                </Show>
                <For each={group.items}>
                  {(t) => (
                    <button
                      class="tv-add-option"
                      onClick={(e) => { e.stopPropagation(); handleAdd(t.value); }}
                    >
                      {t.label}
                    </button>
                  )}
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
// Tree row for a single step
// ---------------------------------------------------------------------------

function TreeRow(props: {
  step: FunctionStep;
  path: StepPath;
  isLast: boolean;
  depth: number;
}) {
  const functionStore = useFunctionEditorStore();
  const [collapsed, setCollapsed] = createSignal(false);

  const isSelected = () => {
    const sel = functionStore.selectedPath;
    if (!sel) return false;
    return JSON.stringify(sel) === JSON.stringify(props.path);
  };

  const hasChildren = () => {
    const s = props.step;
    if (s.type === "branch") return s.arms.length > 0;
    if (s.type === "choose") return s.options.length > 0;
    if (s.type === "scope") return true;
    if (s.type === "wait" && (s.condition.op === "and" || s.condition.op === "or"))
      return true;
    return false;
  };

  const effectiveType = () => {
    if (props.step.type === "call_function" && (props.step as CallFunctionStep).flow === "self") return "call_self";
    return props.step.type;
  };
  const accent = () => STEP_ACCENT[effectiveType()] ?? "#3b82f6";
  const icon = () => {
    if (effectiveType() === "action" && props.step.type === "action" && (props.step as any).name) {
      const Icon = ACTION_STEP_ICONS[(props.step as any).name];
      if (Icon) return <Icon size={15} />;
    }
    return (STEP_ICONS[effectiveType()] ?? STEP_ICONS.action)(15);
  };

  return (
    <div class="tv-node">
      {/* The row itself */}
      <div
        class={`tv-row ${isSelected() ? "tv-row--selected" : ""}`}
        onClick={(e) => { e.stopPropagation(); functionStore.select(props.path); }}
      >
        {/* Collapse toggle */}
        <Show
          when={hasChildren()}
          fallback={<span class="tv-toggle tv-toggle--leaf" />}
        >
          <button
            class="tv-toggle"
            onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed()); }}
          >
            <Show when={collapsed()} fallback={<IconChevronDown size={13} />}>
              <IconChevronRight size={13} />
            </Show>
          </button>
        </Show>

        {/* Icon */}
        <span class="tv-icon" style={{ color: accent() }}>{icon()}</span>

        {/* Type badge */}
        <span class="tv-type" style={{ color: accent() }}>
          {effectiveType() === "call_self" ? "Recurse" : humanize(props.step.type)}
        </span>

        {/* Label */}
        <span class="tv-label">{stepLabel(props.step)}</span>

        {/* Delete */}
        <button
          class="tv-delete"
          data-tooltip="Delete step"
          onClick={(e) => { e.stopPropagation(); functionStore.requestDelete(props.path); }}
        >
          <IconTrash size={12} />
        </button>
      </div>

      {/* Children (branch arms, choose options, wait condition children) */}
      <Show when={hasChildren() && !collapsed()}>
        <div class="tv-children">
          {/* Branch arms */}
          <Show when={props.step.type === "branch"}>
            <For each={(props.step as BranchStep).arms}>
              {(arm, i) => (
                <div class="tv-arm">
                  <div class="tv-arm-label">
                    <span class="tv-arm-name">{arm.label || humanize(arm.id)}</span>
                    <span class="tv-arm-cond">{typeof arm.when === "string" ? arm.when : branchConditionLabel(arm.when)}</span>
                  </div>
                  <TreeStepList
                    steps={arm.steps}
                    basePath={[...props.path, "b", i()]}
                    depth={props.depth + 2}
                  />
                </div>
              )}
            </For>
          </Show>

          {/* Choose options */}
          <Show when={props.step.type === "choose"}>
            <For each={(props.step as ChooseStep).options}>
              {(opt, i) => (
                <div class="tv-arm">
                  <div class="tv-arm-label">
                    <span class="tv-arm-name">{opt.label}</span>
                  </div>
                  <TreeStepList
                    steps={opt.steps}
                    basePath={[...props.path, "c", i()]}
                    depth={props.depth + 2}
                  />
                </div>
              )}
            </For>
          </Show>

          {/* Scope children */}
          <Show when={props.step.type === "scope"}>
            <TreeStepList
              steps={(props.step as ScopeStep).steps}
              basePath={[...props.path, "s"]}
              depth={props.depth + 1}
            />
          </Show>

          {/* Wait condition children (AND/OR groups) */}
          <Show when={props.step.type === "wait"}>
            <WaitConditionTree
              condition={(props.step as WaitStep).condition}
              depth={props.depth + 1}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wait condition subtree (read-only tree display, editing in panel)
// ---------------------------------------------------------------------------

function WaitConditionTree(props: { condition: WaitCondition; depth: number }) {
  const isGroup = () => props.condition.op === "and" || props.condition.op === "or";

  return (
    <Show when={isGroup()}>
      <For each={(props.condition as { op: "and" | "or"; children: WaitCondition[] }).children}>
        {(child, i) => (
          <div class="tv-cond-row">
            <Show when={i() > 0}>
              <span class="tv-cond-op">{props.condition.op.toUpperCase()}</span>
            </Show>
            <span class="tv-cond-leaf">
              <Show when={child.op === "duration"}>
                <IconClock size={12} /> {(child as any).value}
              </Show>
              <Show when={child.op === "event"}>
                <IconBell size={12} /> {(child as any).event || "event"}
              </Show>
              <Show when={child.op === "date"}>
                <IconCalendar size={12} /> {(child as any).expression || "date"}
              </Show>
              <Show when={child.op === "and" || child.op === "or"}>
                ({child.op.toUpperCase()} group)
              </Show>
            </span>
            <Show when={child.op === "and" || child.op === "or"}>
              <WaitConditionTree condition={child} depth={props.depth + 1} />
            </Show>
          </div>
        )}
      </For>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Tree step list (recursive)
// ---------------------------------------------------------------------------

export function TreeStepList(props: {
  steps: FunctionStep[];
  basePath: StepPath;
  depth?: number;
}) {
  const depth = () => props.depth ?? 0;

  return (
    <div class="tv-list">
      <Show when={props.steps.length === 0}>
        <div class="tv-empty-row">
          <TreeAddButton containerPath={props.basePath} index={0} />
          <span class="tv-empty-hint">No steps</span>
        </div>
      </Show>
      <For each={props.steps}>
        {(step, i) => {
          const stepPath = (): StepPath => {
            if (props.basePath.length === 0) return [i()];
            return [...props.basePath, i()];
          };
          const isLast = () => i() === props.steps.length - 1;
          return (
            <>
              {/* Insert-above add button */}
              <Show when={i() === 0}>
                <div class="tv-insert-line">
                  <TreeAddButton containerPath={props.basePath} index={0} />
                </div>
              </Show>

              <TreeRow
                step={step}
                path={stepPath()}
                isLast={isLast()}
                depth={depth()}
              />

              {/* Insert-below add button */}
              <div class="tv-insert-line">
                <TreeAddButton containerPath={props.basePath} index={i() + 1} />
              </div>
            </>
          );
        }}
      </For>
    </div>
  );
}
