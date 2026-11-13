// ---------------------------------------------------------------------------
// PipeBuilder — visual chain builder for {"pipe": [value, "fn1", "fn2"]}
//
// Renders as: value | fn1 | fn2(extra) — with add/remove controls per step.
// ---------------------------------------------------------------------------

import { Show, For, createSignal } from "solid-js";
import type { Expression, FenelFunction } from "@fenel/engine/types";
import { stdModule, getCodeName, getLabel } from "@fenel/engine";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { canonical } from "@fenel/engine/locale";
import { ExpressionDisplay } from "./ExpressionDisplay";
import { accountFieldRegistry } from "~/lib/account-field-registry";

/** Resolve a function's dispatch key (codeName) as a plain string. */
function fnName(fn: FenelFunction): string {
  return canonical(getCodeName(fn.id) ?? fn.id);
}

/** Resolve a function's display label as a plain string, falling back to codeName/id. */
function fnLabel(fn: FenelFunction): string {
  return canonical(getLabel(fn.id) ?? getCodeName(fn.id) ?? fn.id);
}

export type PipeBuilderProps = {
  /** Current pipe expression, e.g. {"pipe": [" hello ", "trim", "upper"]} */
  value: Expression | undefined;
  /** Called when expression changes */
  onChange: (expr: Expression | undefined) => void;
  /** Optional label */
  label?: string;
};

let pickerRegistry: ReturnType<typeof createRepositoryRegistry> | undefined;

type PipeStep = string | [string, ...unknown[]];

export function PipeBuilder(props: PipeBuilderProps) {
  const registry = accountFieldRegistry() ?? (pickerRegistry ??= createRepositoryRegistry([stdModule]));
  const allFunctions = registry.listFunctions().filter((f) => f.params.length >= 1);
  const [showPicker, setShowPicker] = createSignal<number | null>(null);
  const [fnSearch, setFnSearch] = createSignal("");

  // Parse current pipe value
  const steps = (): { input: unknown; chain: PipeStep[] } => {
    const v = props.value;
    if (!v || typeof v !== "object" || !("pipe" in v)) {
      return { input: "", chain: [] };
    }
    const args = (v as { pipe: unknown[] }).pipe;
    if (!Array.isArray(args) || args.length === 0) return { input: "", chain: [] };
    return {
      input: args[0],
      chain: args.slice(1) as PipeStep[],
    };
  };

  function emit(input: unknown, chain: PipeStep[]) {
    if (chain.length === 0) {
      props.onChange(undefined);
    } else {
      props.onChange({ pipe: [input, ...chain] } as unknown as Expression);
    }
  }

  function updateInput(value: string) {
    const s = steps();
    // Try to parse as number
    const num = Number(value);
    const parsed = !isNaN(num) && value.trim() !== "" ? num : value;
    emit(parsed, s.chain);
  }

  function addStep(fn: FenelFunction, afterIndex: number) {
    const s = steps();
    const newChain = [...s.chain];
    // If function has >1 param, use array form with defaults for extra params
    if (fn.params.length > 1) {
      const extras = fn.params.slice(1).map((p) => {
        // FM-retire-Z — no per-param `default` slot; fall back to a type-driven
        // placeholder for the extra args.
        const tag = p.type && "$ref" in p.type ? p.type.$ref : undefined;
        return tag === "Number" ? 0 : "";
      });
      newChain.splice(afterIndex + 1, 0, [fnName(fn), ...extras]);
    } else {
      newChain.splice(afterIndex + 1, 0, fnName(fn));
    }
    emit(s.input || "", newChain);
    setShowPicker(null);
    setFnSearch("");
  }

  function removeStep(index: number) {
    const s = steps();
    const newChain = [...s.chain];
    newChain.splice(index, 1);
    emit(s.input, newChain);
  }

  function updateStepExtra(stepIndex: number, extraIndex: number, value: string) {
    const s = steps();
    const newChain = [...s.chain];
    const step = newChain[stepIndex];
    if (!Array.isArray(step)) return;
    const newStep = [...step];
    const num = Number(value);
    newStep[extraIndex + 1] = !isNaN(num) && value.trim() !== "" ? num : value;
    newChain[stepIndex] = newStep as PipeStep;
    emit(s.input, newChain);
  }

  const stepName = (step: PipeStep): string =>
    typeof step === "string" ? step : (step[0] as string);

  const stepExtras = (step: PipeStep): unknown[] =>
    Array.isArray(step) ? step.slice(1) : [];

  const filteredFunctions = () => {
    const q = fnSearch().toLowerCase();
    if (!q) return allFunctions.slice(0, 15);
    return allFunctions.filter((f) =>
      fnName(f).toLowerCase().includes(q) || fnLabel(f).toLowerCase().includes(q)
    ).slice(0, 15);
  };

  return (
    <div class="fe-pipe-builder">
      <Show when={props.label}>
        <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.5rem;">{props.label}</div>
      </Show>

      {/* Input value */}
      <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
        <label style="font-size: 0.8rem; color: #555; min-width: 40px;">Input</label>
        <input
          type="text"
          placeholder="Starting value..."
          value={String(typeof steps().input === "object" ? JSON.stringify(steps().input) : steps().input)}
          onInput={(e) => updateInput(e.currentTarget.value)}
          style="flex: 1; padding: 0.3rem 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.8rem; font-family: 'SF Mono', monospace;"
        />
      </div>

      {/* Chain steps */}
      <div style="display: flex; flex-direction: column; gap: 0.25rem;">
        <For each={steps().chain}>
          {(step, i) => {
            const fn = () => registry.getFunction(stepName(step));
            const extras = () => stepExtras(step);
            return (
              <div style="display: flex; align-items: center; gap: 0.35rem; padding: 0.3rem 0.5rem; background: #f9f9ff; border: 1px solid #e8e8f0; border-radius: 4px;">
                <span style="color: #0891b2; font-weight: 600; font-size: 0.8rem;">|</span>
                <span style="color: #7c3aed; font-weight: 500; font-size: 0.8rem;">{stepName(step)}</span>

                {/* Extra arguments for partial application */}
                <For each={extras()}>
                  {(extra, ei) => (
                    <input
                      type="text"
                      value={String(extra)}
                      onInput={(e) => updateStepExtra(i(), ei(), e.currentTarget.value)}
                      style="width: 60px; padding: 0.15rem 0.3rem; border: 1px solid #ddd; border-radius: 3px; font-size: 0.75rem; font-family: 'SF Mono', monospace;"
                    />
                  )}
                </For>

                {/* Return type hint */}
                <Show when={fn()}>
                  <span style="color: #aaa; font-size: 0.7rem; margin-left: auto;">→ {(() => { const r = fn()!.returns; return "$ref" in r ? r.$ref : Object.keys(r)[0]; })()}</span>
                </Show>

                <button
                  type="button"
                  onClick={() => removeStep(i())}
                  style="padding: 0.1rem 0.3rem; border: none; background: none; color: #ccc; cursor: pointer; font-size: 0.8rem;"
                  data-tooltip="Remove step"
                >
                  &times;
                </button>
              </div>
            );
          }}
        </For>
      </div>

      {/* Add step button + picker */}
      <div style="margin-top: 0.35rem; position: relative;">
        <button
          type="button"
          onClick={() => setShowPicker(showPicker() === null ? steps().chain.length - 1 : null)}
          style="padding: 0.25rem 0.6rem; border: 1px dashed #ccc; border-radius: 4px; background: #fff; cursor: pointer; font-size: 0.75rem; color: #888;"
        >
          + Add step
        </button>

        <Show when={showPicker() !== null}>
          <div style="position: absolute; top: 100%; left: 0; margin-top: 0.25rem; width: 280px; background: #fff; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 10; padding: 0.35rem;">
            <input
              type="text"
              placeholder="Search functions..."
              value={fnSearch()}
              onInput={(e) => setFnSearch(e.currentTarget.value)}
              style="width: 100%; padding: 0.3rem 0.5rem; border: 1px solid #eee; border-radius: 4px; font-size: 0.78rem; margin-bottom: 0.25rem; box-sizing: border-box;"
            />
            <div style="max-height: 180px; overflow-y: auto;">
              <For each={filteredFunctions()}>
                {(fn) => (
                  <button
                    type="button"
                    onClick={() => addStep(fn, showPicker()!)}
                    style="display: block; width: 100%; text-align: left; padding: 0.3rem 0.4rem; border: none; border-radius: 3px; background: #fff; cursor: pointer; font-size: 0.78rem;"
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5ff")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                  >
                    <span style="color: #7c3aed; font-weight: 500;">{fnName(fn)}</span>
                    <span style="color: #aaa; margin-left: 0.3rem; font-size: 0.72rem;">→ {"$ref" in fn.returns ? fn.returns.$ref : Object.keys(fn.returns)[0]}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>

      {/* Preview */}
      <Show when={props.value}>
        <div style="margin-top: 0.5rem;">
          <ExpressionDisplay expr={props.value} mode="logic" showRawToggle={false} compact />
        </div>
      </Show>
    </div>
  );
}
