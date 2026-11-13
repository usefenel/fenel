// ---------------------------------------------------------------------------
// FunctionCallEditor — build {"call": ["name", arg1, arg2]} expressions
//
// Provides function autocomplete from the registry and recursive
// expression inputs for each parameter.
// ---------------------------------------------------------------------------

import { Show, For, createSignal, createMemo } from "solid-js";
import type { Expression, FenelFunction, FenelType } from "@fenel/engine/types";
import { stdModule, getCodeName, getLabel, getCategory, List, Maybe, peelMaybe, peelList } from "@fenel/engine";
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

/** Top-level FenelType tag for input/dispatch — `$named "Number"` returns
 *  `"Number"`; List / Maybe (canonical) return the synthetic tags
 *  `"List"` / `"Maybe"` so downstream defaults / coercion don't need to
 *  peel the `$opaque` / `$variant` wrapper themselves; everything else
 *  returns the first `$`-prefixed key. */
function paramTag(t: FenelType | undefined): string | undefined {
  if (!t) return undefined;
  if ("$ref" in t) return t.$ref;
  if (peelList(t)) return "List";
  if (peelMaybe(t)) return "Maybe";
  return Object.keys(t)[0];
}

/** Render a FenelType into a compact one-line form for inline signature
 *  display. Mirrors the engine's formatTypeShort and recurses into `$arrow`
 *  so partial-application readouts print as `(a) → b` instead of `$arrow`. */
function formatTypeShort(t: FenelType | undefined): string {
  if (!t) return "?";
  if ("$ref" in t) return t.$ref;
  if ("$var" in t) return t.$var;
  // Maybe / List recognised in either shorthand or canonical form.
  {
    const list = peelList(t);
    if (list) return `List(${formatTypeShort(list.elem)})`;
    const maybe = peelMaybe(t);
    if (maybe) return `Maybe(${formatTypeShort(maybe.value)})`;
  }
  if ("$arrow" in t) {
    const ps = t.$arrow.params.map((p) => formatTypeShort(p.type)).join(", ");
    return `(${ps}) → ${formatTypeShort(t.$arrow.returns)}`;
  }
  if ("$tuple" in t) return `(${t.$tuple.map(formatTypeShort).join(", ")})`;
  if ("$record" in t) return "Record";
  if ("$variant" in t) return "Variant";
  return Object.keys(t)[0] ?? "?";
}

export type FunctionCallEditorProps = {
  /** Current call expression, e.g. {"call": ["add", 1, 2]} */
  value: Expression | undefined;
  /** Called when expression changes */
  onChange: (expr: Expression | undefined) => void;
  /** Optional label */
  label?: string;
};

let pickerRegistry: ReturnType<typeof createRepositoryRegistry> | undefined;

export function FunctionCallEditor(props: FunctionCallEditorProps) {
  // Importing the shared editor barrel must not build a dormant picker's registry.
  const registry = accountFieldRegistry() ?? (pickerRegistry ??= createRepositoryRegistry([stdModule]));
  const allFunctions = registry.listFunctions();
  const categories = [...new Set(allFunctions.map((f) => getCategory(f.id)).filter(Boolean))] as string[];
  const [search, setSearch] = createSignal("");
  const [selectedCategory, setSelectedCategory] = createSignal<string | "all">("all");

  // Parse current value
  const current = () => {
    const v = props.value;
    if (!v || typeof v !== "object" || !("call" in v)) return null;
    const args = (v as { call: unknown[] }).call;
    if (!Array.isArray(args) || args.length === 0) return null;
    return {
      name: args[0] as string,
      args: args.slice(1) as unknown[],
    };
  };

  const selectedFn = () => {
    const c = current();
    return c ? registry.getFunction(c.name) : undefined;
  };

  const filteredFunctions = createMemo(() => {
    let fns = allFunctions;
    const cat = selectedCategory();
    if (cat !== "all") fns = fns.filter((f) => getCategory(f.id) === cat);
    const q = search().toLowerCase();
    if (q) fns = fns.filter((f) => fnName(f).toLowerCase().includes(q) || fnLabel(f).toLowerCase().includes(q));
    return fns;
  });

  // FM-retire-Z — no per-param `default` slot; the open-arg placeholder is
  // type-driven (defaults are type-level via `HasDefault`).
  function defaultArg(p: { type: FenelType }): unknown {
    const tag = paramTag(p.type);
    if (tag === "Number") return 0;
    if (tag === "Boolean") return false;
    if (tag === "List") return [];
    return "";
  }

  function selectFunction(fn: FenelFunction) {
    const defaults = fn.params.map(defaultArg);
    props.onChange({ call: [fnName(fn), ...defaults] } as unknown as Expression);
  }

  function updateArg(index: number, value: string) {
    const c = current();
    if (!c) return;
    const fn = selectedFn();
    if (!fn) return;
    // Pad args with defaults up to `index` so we don't lose previously-open
    // earlier slots when the user fills a later one.
    const newArgs = [...c.args];
    while (newArgs.length <= index) {
      newArgs.push(defaultArg(fn.params[newArgs.length]!));
    }
    const tag = paramTag(fn.params[index]?.type);
    if (tag === "Number") {
      newArgs[index] = Number(value) || 0;
    } else if (tag === "Boolean") {
      newArgs[index] = value === "true";
    } else if (tag === "$var" || tag === "List") {
      // Polymorphic / list — try parsing as JSON to support arrays/objects, else string
      try {
        newArgs[index] = JSON.parse(value);
      } catch {
        newArgs[index] = value;
      }
    } else {
      newArgs[index] = value;
    }
    props.onChange({ call: [c.name, ...newArgs] } as unknown as Expression);
  }

  /** Drop trailing args from `index` onward — produces a partial application
   *  by under-supplying. The runtime materializes a partial sentinel when the
   *  call is invoked. */
  function leaveOpenFrom(index: number) {
    const c = current();
    if (!c) return;
    const trimmed = c.args.slice(0, index);
    props.onChange({ call: [c.name, ...trimmed] } as unknown as Expression);
  }

  /** Re-fill all currently-open trailing slots with their defaults. */
  function fillAll() {
    const c = current();
    const fn = selectedFn();
    if (!c || !fn) return;
    const filled = [...c.args];
    while (filled.length < fn.params.length) {
      filled.push(defaultArg(fn.params[filled.length]!));
    }
    props.onChange({ call: [c.name, ...filled] } as unknown as Expression);
  }

  function paramPlaceholder(schema: unknown): string {
    if (!schema || typeof schema !== "object") return "";
    const s = schema as { type: string; name?: string; of?: { type: string; name?: string } };
    if (s.type === "var") return `any (${s.name ?? "a"})`;
    if (s.type === "list") {
      const inner = s.of;
      if (inner?.type === "var") return `List<${inner.name ?? "a"}> — JSON or var`;
      return `List<${inner?.type ?? "?"}>`;
    }
    if (s.type === "maybe") {
      const inner = s.of;
      const innerStr = inner?.type === "var" ? (inner.name ?? "a") : inner?.type ?? "";
      return `Maybe<${innerStr}>`;
    }
    return s.type;
  }

  function clearSelection() {
    props.onChange(undefined);
  }

  return (
    <div class="fe-fn-call-editor">
      <Show when={props.label}>
        <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.5rem;">{props.label}</div>
      </Show>

      <Show when={!selectedFn()} fallback={
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          {/* Selected function header */}
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-weight: 600; color: #7c3aed;">{fnLabel(selectedFn()!)}</span>
            <Show when={selectedFn()!.body}>
              <span class="badge badge-green" style="font-size: 0.65rem;">pure</span>
            </Show>
            <Show when={(current()?.args.length ?? 0) < selectedFn()!.params.length}>
              {(() => {
                const filled = current()?.args.length ?? 0;
                const remaining = selectedFn()!.params.slice(filled);
                const inferredArrow: FenelType = {
                  $arrow: { params: remaining, returns: selectedFn()!.returns },
                };
                return (
                  <>
                    <span
                      class="badge badge-amber"
                      style="font-size: 0.65rem;"
                      data-tooltip="Some params are open — calling this expression yields a partial application waiting for the remaining args."
                    >
                      partial · {remaining.length} open
                    </span>
                    <span
                      style="font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 0.7rem; color: #b8860b; background: #fff8e1; border: 1px dashed #d4af37; border-radius: 3px; padding: 0.1rem 0.35rem;"
                      data-tooltip="Inferred type of the resulting partial application — invoke it with the remaining arg(s) to fully apply."
                    >
                      : {formatTypeShort(inferredArrow)}
                    </span>
                  </>
                );
              })()}
            </Show>
            <button
              type="button"
              onClick={clearSelection}
              style="margin-left: auto; padding: 0.15rem 0.4rem; border: 1px solid #ddd; border-radius: 3px; background: #fff; cursor: pointer; font-size: 0.7rem; color: #666;"
            >
              Change
            </button>
          </div>

          {/* Parameter inputs */}
          <For each={selectedFn()!.params}>
            {(param, i) => {
              const isOpen = () => i() >= (current()?.args.length ?? 0);
              return (
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <label style="min-width: 80px; font-size: 0.8rem; color: #555;">{param.name}</label>
                  <Show when={!isOpen()} fallback={
                    <>
                      <span style="flex: 1; padding: 0.3rem 0.5rem; border: 1px dashed #d4af37; border-radius: 4px; font-size: 0.8rem; color: #b8860b; font-style: italic; background: #fff8e1;">
                        open — supplied at call time
                      </span>
                      <button
                        type="button"
                        onClick={fillAll}
                        data-tooltip="Re-fill open params with defaults"
                        style="padding: 0.15rem 0.4rem; border: 1px solid #ddd; border-radius: 3px; background: #fff; cursor: pointer; font-size: 0.7rem; color: #666;"
                      >
                        Fill
                      </button>
                    </>
                  }>
                    <input
                      type={paramTag(param.type) === "Number" ? "number" : "text"}
                      placeholder={paramTag(param.type) ?? "?"}
                      value={(() => {
                        const v = current()?.args[i()];
                        if (v == null) return "";
                        if (typeof v === "object") return JSON.stringify(v);
                        return String(v);
                      })()}
                      onInput={(e) => updateArg(i(), e.currentTarget.value)}
                      style="flex: 1; padding: 0.3rem 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.8rem;"
                    />
                    <button
                      type="button"
                      onClick={() => leaveOpenFrom(i())}
                      data-tooltip="Leave this param (and all after it) open — produces a partial application"
                      style="padding: 0.15rem 0.4rem; border: 1px solid #ddd; border-radius: 3px; background: #fff; cursor: pointer; font-size: 0.7rem; color: #b8860b;"
                    >
                      Open
                    </button>
                  </Show>
                </div>
              );
            }}
          </For>

          {/* Preview */}
          <Show when={props.value}>
            <div style="margin-top: 0.25rem;">
              <ExpressionDisplay expr={props.value} mode="logic" showRawToggle={false} compact />
            </div>
          </Show>
        </div>
      }>
        {/* Function picker */}
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <input
            type="text"
            placeholder="Search functions..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            style="padding: 0.35rem 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.8rem;"
          />

          {/* Category tabs */}
          <div style="display: flex; gap: 0.25rem; flex-wrap: wrap;">
            <button
              type="button"
              class={{ "badge": true, "badge-blue": selectedCategory() === "all", "badge-gray": selectedCategory() !== "all" }}
              onClick={() => setSelectedCategory("all")}
              style="cursor: pointer; border: none; font-size: 0.7rem;"
            >
              All
            </button>
            <For each={categories}>
              {(cat) => (
                <button
                  type="button"
                  class={{ "badge": true, "badge-blue": selectedCategory() === cat, "badge-gray": selectedCategory() !== cat }}
                  onClick={() => setSelectedCategory(cat)}
                  style="cursor: pointer; border: none; font-size: 0.7rem;"
                >
                  {cat}
                </button>
              )}
            </For>
          </div>

          {/* Function list */}
          <div style="max-height: 200px; overflow-y: auto; border: 1px solid #eee; border-radius: 4px;">
            <For each={filteredFunctions()}>
              {(fn) => (
                <button
                  type="button"
                  onClick={() => selectFunction(fn)}
                  style="display: block; width: 100%; text-align: left; padding: 0.35rem 0.5rem; border: none; border-bottom: 1px solid #f0f0f0; background: #fff; cursor: pointer; font-size: 0.8rem;"
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5ff")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                >
                  <span style="font-weight: 500; color: #7c3aed;">{fnName(fn)}</span>
                  <span style="color: #999; margin-left: 0.5rem;">
                    ({fn.params.map((p) => p.name).join(", ")}) → {paramTag(fn.returns) ?? "?"}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
