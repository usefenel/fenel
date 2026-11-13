// ---------------------------------------------------------------------------
// StepsViewer — read-only renderer for a function's step tree, used by the
// instance drill-in to show "where this instance is right now".
//
// The full FunctionCanvas is editor-only and tied to the global functionStore;
// retrofitting it for view mode is a bigger refactor. This component takes a
// program (Expression) + a currentStepPath as props and renders an indented
// tree with the active step highlighted. No store, no mutation.
// ---------------------------------------------------------------------------

import { For, Show } from "solid-js";
import type { Expression } from "@fenel/engine/types";
import { programToSteps } from "./types";
import type {
  FunctionStep,
  ActionStep,
  WaitStep,
  SetStep,
  ScopeStep,
  BranchStep,
  ChooseStep,
  CallFunctionStep,
  StepPath,
} from "./types";
import { branchConditionLabel } from "./types";

type Props = {
  /** Function body — the runtime Expression that the editor compiles to. */
  program: Expression | null | undefined;
  /** Current execution position, encoded as a `.`-joined path
   *  ("0", "0.arms.0.steps.1", etc). */
  currentStepPath?: string | null;
};

export function StepsViewer(props: Props) {
  const steps = () => {
    if (!props.program) return [];
    try { return programToSteps(props.program); } catch { return []; }
  };
  const activeKey = () => normalizePath(props.currentStepPath);

  return (
    <Show when={steps().length > 0} fallback={<p class="text-muted" style="font-size: 0.8rem">No steps.</p>}>
      <div class="sv-root">
        <For each={steps()}>
          {(s, i) => <StepRow step={s} path={[i()]} activeKey={activeKey()} />}
        </For>
      </div>
      <style>{CSS}</style>
    </Show>
  );
}

function StepRow(props: { step: FunctionStep; path: StepPath; activeKey: string | null }) {
  const key = pathKey(props.path);
  const isActive = () => props.activeKey === key || (props.activeKey?.startsWith(key + ".") ?? false);
  const isCurrent = () => props.activeKey === key;

  return (
    <div class={["sv-row", { "sv-row--active": isActive(), "sv-row--current": isCurrent() }]}>
      <div class="sv-line">
        <span class="sv-bullet" />
        <span class="sv-kind">{kindLabel(props.step)}</span>
        <span class="sv-detail">{stepSummary(props.step)}</span>
        <Show when={isCurrent()}>
          <span class="sv-now">⏵ here</span>
        </Show>
      </div>
      {/* Recurse for composite step types */}
      <Show when={props.step.type === "branch"}>
        <For each={(props.step as BranchStep).arms}>
          {(arm, ai) => (
            <div class="sv-nest">
              <div class="sv-arm-label">if {branchConditionLabel(arm.when)}</div>
              <For each={arm.steps}>
                {(s, si) => (
                  <StepRow
                    step={s}
                    path={[...props.path, "arms", ai(), "steps", si()]}
                    activeKey={props.activeKey}
                  />
                )}
              </For>
            </div>
          )}
        </For>
      </Show>
      <Show when={props.step.type === "choose"}>
        <For each={(props.step as ChooseStep).options}>
          {(opt, oi) => (
            <div class="sv-nest">
              <div class="sv-arm-label">option: {opt.label}</div>
              <For each={opt.steps}>
                {(s, si) => (
                  <StepRow
                    step={s}
                    path={[...props.path, "options", oi(), "steps", si()]}
                    activeKey={props.activeKey}
                  />
                )}
              </For>
            </div>
          )}
        </For>
      </Show>
      <Show when={props.step.type === "scope"}>
        <div class="sv-nest">
          <For each={(props.step as ScopeStep).steps}>
            {(s, si) => (
              <StepRow
                step={s}
                path={[...props.path, "steps", si()]}
                activeKey={props.activeKey}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function pathKey(p: StepPath): string {
  return p.join(".");
}

function normalizePath(p: string | null | undefined): string | null {
  if (!p) return null;
  return String(p);
}

function kindLabel(s: FunctionStep): string {
  switch (s.type) {
    case "action": return "action";
    case "wait": return "wait";
    case "set": return "set";
    case "scope": return "scope";
    case "branch": return "branch";
    case "choose": return "choose";
    case "call_function": return "call";
  }
}

function stepSummary(s: FunctionStep): string {
  switch (s.type) {
    case "action":
      return (s as ActionStep).name || "(no action)";
    case "wait": {
      const c = (s as WaitStep).condition;
      switch (c.op) {
        case "duration": return `wait ${c.value}`;
        case "event": return `wait for event ${c.event ?? ""}`;
        case "date": return `wait until ${c.expression ?? ""}`;
      }
      return "wait";
    }
    case "set": {
      const a = (s as SetStep).assignments;
      const keys = Object.keys(a);
      return keys.length ? `${keys.join(", ")} = …` : "(no assignments)";
    }
    case "scope": {
      const v = Object.keys((s as ScopeStep).vars);
      return v.length ? `vars: ${v.join(", ")}` : "scope";
    }
    case "branch":
      return `${(s as BranchStep).arms.length} arm(s)`;
    case "choose":
      return `${(s as ChooseStep).options.length} option(s)`;
    case "call_function": {
      const f = (s as CallFunctionStep).flow;
      return f ? `→ ${f}` : "(no target)";
    }
  }
}

const CSS = `
.sv-root { font-size: 0.8rem; line-height: 1.4; }
.sv-row { padding: 0.15rem 0; border-radius: 4px; }
.sv-row--active > .sv-line { color: #1e293b; }
.sv-row--current > .sv-line { background: #fef3c7; padding-left: 0.4rem; border-left: 3px solid #f59e0b; }
.sv-line { display: flex; gap: 0.5rem; align-items: center; padding: 0.2rem 0; }
.sv-bullet { width: 6px; height: 6px; background: #cbd5e1; border-radius: 50%; flex-shrink: 0; }
.sv-row--active > .sv-line .sv-bullet { background: #4f46e5; }
.sv-row--current > .sv-line .sv-bullet { background: #f59e0b; }
.sv-kind { font-family: ui-monospace, monospace; font-size: 0.7rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; min-width: 56px; }
.sv-detail { color: #334155; }
.sv-now { font-size: 0.7rem; color: #b45309; font-weight: 600; margin-left: auto; }
.sv-nest { margin-left: 1.25rem; border-left: 1px solid #e2e8f0; padding-left: 0.5rem; margin-top: 0.15rem; }
.sv-arm-label { font-size: 0.7rem; color: #64748b; font-style: italic; margin-top: 0.25rem; }
`;
