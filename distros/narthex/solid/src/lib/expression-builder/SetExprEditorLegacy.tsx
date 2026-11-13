// ---------------------------------------------------------------------------
// SetExprEditorLegacy — FROZEN copy of the original bespoke SetExpr editor.
//
// set-algebra-to-fenel Phase 7 Step 1c: a presentation-frozen copy of the
// pre-refactor `SetExprEditor` (the template-based builder: one-of / between / matches /
// named set / any / none + union/intersection compounds), kept ONLY as a
// side-by-side STYLE-COMPARISON fixture on the `ui-showcase` component gallery.
// It is NOT imported by any production surface — the new `SetExprEditor.tsx`
// (the registered-ADT constructor editor) drives all real consumers. This file
// shares no mutable state with the new component and is deletable in one `rm`
// once Rom signs off on the new editor's style. Transport-only changes are
// mirrored here so even the fixture obeys the canonical SetExpr boundary.
//
// For display-only, see ExpressionDisplay.
// ---------------------------------------------------------------------------

import { Show, For, Switch, Match, createSignal } from "solid-js";
import type { SetExpr, Bound, Interval } from "@fenel/engine/types";
import { parseSetExpr, formatSetExpr } from "@fenel/engine/set-syntax";
import { regexStringToPattern, patternToRegex } from "@fenel/engine";
import type { Pattern } from "@fenel/engine/types";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { buildSetExpr, peelSetExpr, type SetExprView } from "@fenel/engine/set-marker";
import "./set-expr-editor.css";

function regexSet(re: string): SetExpr {
  const p = regexStringToPattern(re);
  if (!p) throw new Error(`Invalid regex /${re}/`);
  return buildSetExpr.pattern(p);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type SetExprEditorLegacyProps = {
  /** Current SetExpr value */
  value: SetExpr | undefined;
  /** Called when expression changes */
  onChange: (expr: SetExpr | undefined) => void;
  /** Hint about the value domain — affects which templates are shown */
  valueType?: "string" | "number" | "date" | "any";
  /** Compact mode — no section headers */
  compact?: boolean;
};

/** Visual SetExpr editor (FROZEN legacy copy — comparison fixture only). */
export function SetExprEditorLegacy(props: SetExprEditorLegacyProps) {
  const kind = () => detectKind(props.value);
  // Dual-read the current value via the ONE engine recognizer (3b-1). The
  // sub-editor payload extractions below switch on `kind()` then read the view;
  // even this frozen comparison fixture emits canonical `$tag` values.
  const view = (): SetExprView<SetExpr> | null =>
    props.value ? peelSetExpr(props.value) : null;
  const asView = <K extends SetExprView["kind"]>(_k: K) =>
    view() as Extract<SetExprView<SetExpr>, { kind: K }>;
  const vtype = () => props.valueType ?? "any";
  const [textMode, setTextMode] = createSignal(false);
  const [textInput, setTextInput] = createSignal("");
  const [textError, setTextError] = createSignal<string | null>(null);

  function setKind(k: ExprKind) {
    props.onChange(blankForKind(k));
  }

  function enterTextMode() {
    setTextInput(props.value ? formatSetExpr(props.value) : "");
    setTextError(null);
    setTextMode(true);
  }

  function applyText() {
    const src = textInput().trim();
    if (!src) { props.onChange(undefined); setTextMode(false); return; }
    try {
      const parsed = parseSetExpr(src);
      props.onChange(parsed);
      setTextError(null);
      setTextMode(false);
    } catch (e: any) {
      setTextError(e.message);
    }
  }

  function onTextKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); applyText(); }
    if (e.key === "Escape") { setTextMode(false); }
  }

  return (
    <div class={["se-editor", { "se-editor--compact": !!(props.compact) }]}>
      {/* Text syntax input */}
      <Show when={textMode()}>
        <div class="se-text-input">
          <input
            type="text"

            class={["se-text-field", { "se-text-field--error": !!textError() }]}
            value={textInput()}
            onInput={(e) => { setTextInput(e.currentTarget.value); setTextError(null); }}
            onKeyDown={onTextKeyDown}
            onBlur={applyText}
            placeholder='e.g. ℝ[0..100] u ℤ[-10..0]'
            autofocus
          />
          <Show when={textError()}>
            <div class="se-text-error">{textError()}</div>
          </Show>
        </div>
      </Show>

      {/* Template picker — simple constraints */}
      <Show when={!textMode()}>
      <div class="se-templates">
        <For each={templatesFor(vtype()).filter((t) => t.kind !== "union" && t.kind !== "intersect")}>
          {(tpl) => (
            <button
              type="button"

              class={["se-tpl-btn", { "se-tpl-btn--active": !!(kind() === tpl.kind) }]}
              onClick={() => setKind(tpl.kind)}
              data-tooltip={tpl.description}
            >
              <span class="se-tpl-icon">{tpl.icon}</span>
              <span class="se-tpl-label">{tpl.label}</span>
            </button>
          )}
        </For>
        <span class="se-tpl-sep">|</span>
        <For each={templatesFor(vtype()).filter((t) => t.kind === "union" || t.kind === "intersect")}>
          {(tpl) => (
            <button
              type="button"

              class={["se-tpl-btn se-tpl-btn--combine", { "se-tpl-btn--active": !!(kind() === tpl.kind) }]}
              onClick={() => setKind(tpl.kind)}
              data-tooltip={tpl.description}
            >
              <span class="se-tpl-icon">{tpl.icon}</span>
              <span class="se-tpl-label">{tpl.label}</span>
            </button>
          )}
        </For>
        <span class="se-tpl-sep">|</span>
        <button type="button" class="se-tpl-btn" onClick={enterTextMode} data-tooltip="Type set expression as text">
          <span class="se-tpl-icon">✎</span>
          <span class="se-tpl-label">Text</span>
        </button>
      </div>
      </Show>

      {/* Editor for current kind */}
      <Show when={props.value}>
        <div class="se-body">
          <Switch>
            <Match when={kind() === "enum"}>
              <EnumEditor
                values={asView("SeEnum").values}
                onChange={(vals) => props.onChange(buildSetExpr.enum(vals))}
                valueType={vtype()}
              />
            </Match>
            <Match when={kind() === "interval"}>
              <IntervalEditor
                interval={asView("SeInterval").interval}
                onChange={(iv) => props.onChange(buildSetExpr.interval(iv))}
                valueType={vtype()}
              />
            </Match>
            <Match when={kind() === "pattern"}>
              <PatternEditor
                pattern={patternToRegex(asView("SePattern").pattern) ?? ""}
                onChange={(p) => {
                  const parsed = regexStringToPattern(p);
                  if (parsed) props.onChange(buildSetExpr.pattern(parsed));
                }}
              />
            </Match>
            <Match when={kind() === "named"}>
              <NamedEditor
                name={asView("SeRef").handle}
                onChange={(n) => props.onChange(buildSetExpr.ref(n))}
              />
            </Match>
            <Match when={kind() === "union"}>
              <CompoundEditor
                op="union"
                children={asView("SeUnion").branches}
                onChange={(kids) => props.onChange(buildSetExpr.union(kids))}
                valueType={vtype()}
              />
            </Match>
            <Match when={kind() === "intersect"}>
              <CompoundEditor
                op="intersect"
                children={asView("SeIntersect").branches}
                onChange={(kids) => props.onChange(buildSetExpr.intersect(kids))}
                valueType={vtype()}
              />
            </Match>
          </Switch>
        </div>
      </Show>

      {/* Clear button */}
      <Show when={props.value}>
        <div class="se-footer">
          <button
            type="button"
            class="se-clear-btn"
            onClick={() => props.onChange(undefined)}
          >
            Clear constraint
          </button>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates — define which kinds are available for which value types
// ---------------------------------------------------------------------------

type ExprKind = "enum" | "interval" | "pattern" | "named" | "union" | "intersect";

type ValueType = "string" | "number" | "date" | "any";

type Template = {
  kind: ExprKind;
  label: string;
  icon: string;
  description: string;
  types: ValueType[];
};

const ALL_TEMPLATES: Template[] = [
  { kind: "enum", label: "One of", icon: "{ }", description: "Value must be one of a list", types: ["string", "number", "date", "any"] },
  { kind: "interval", label: "Between", icon: "[·]", description: "Value must be in a range", types: ["number", "date", "any"] },
  { kind: "pattern", label: "Matches", icon: "/·/", description: "Value must match a regex pattern", types: ["string", "any"] },
  { kind: "named", label: "Named set", icon: "N", description: "Reference a named set from the type system", types: ["string", "number", "any"] },
  { kind: "union", label: "OR", icon: "", description: "Value matches any of these constraints", types: ["string", "number", "date", "any"] },
  { kind: "intersect", label: "AND", icon: "", description: "Value matches all of these constraints", types: ["string", "number", "date", "any"] },
];

function templatesFor(vtype: ValueType): Template[] {
  return ALL_TEMPLATES.filter((t) => t.types.includes(vtype));
}

function blankForKind(kind: ExprKind): SetExpr {
  switch (kind) {
    case "enum": return buildSetExpr.enum([""]);
    case "interval": return buildSetExpr.interval({ lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) });
    case "pattern": return regexSet("");
    case "named": return buildSetExpr.ref("");
    case "union": return buildSetExpr.union([buildSetExpr.enum([""])]);
    case "intersect": return buildSetExpr.intersect([buildSetExpr.enum([""])]);
  }
}

function detectKind(expr: SetExpr | undefined): ExprKind | null {
  // Dual-read via the ONE engine recognizer (set-algebra-to-fenel 3b-1).
  const view = peelSetExpr(expr);
  if (!view) return null;
  switch (view.kind) {
    case "SeEnum": return "enum";
    case "SeInterval": return "interval";
    case "SePattern": return "pattern";
    case "SeRef": return "named";
    case "SeUnion": return "union";
    case "SeIntersect": return "intersect";
    case "SeDiff": return "union"; // approximate
    case "SeComplement": return "intersect"; // approximate
    default: return null; // SeAll / SeNone / SeWhere have no editor kind
  }
}

// ---------------------------------------------------------------------------
// Sub-editors
// ---------------------------------------------------------------------------

/** Enum editor — add/remove values from a list */
function EnumEditor(props: { values: unknown[]; onChange: (vals: unknown[]) => void; valueType: ValueType }) {
  const placeholder = () => {
    switch (props.valueType) {
      case "number": return "0";
      case "date": return "2025, 2025-05, or 2025-05-02";
      case "string": return "Text...";
      default: return "Value...";
    }
  };

  function updateValue(index: number, val: string) {
    const next = [...props.values];
    if (props.valueType === "date") {
      next[index] = val; // keep as-is — any resolution is valid
    } else {
      const num = Number(val);
      next[index] = val !== "" && !isNaN(num) ? num : val;
    }
    props.onChange(next);
  }

  function addValue() {
    props.onChange([...props.values, ""]);
  }

  function removeValue(index: number) {
    const next = props.values.filter((_, i) => i !== index);
    props.onChange(next.length > 0 ? next : [""]);
  }

  return (
    <div class="se-enum">
      <For keyed={false} each={props.values}>
        {(val, i) => (
          <div class="se-enum-row">
            <input
              class="se-input"
              type="text"
              value={String(val())}
              placeholder={placeholder()}
              onInput={(e) => updateValue(i, e.currentTarget.value)}
            />
            <button
              type="button"
              class="se-remove-btn"
              onClick={() => removeValue(i)}
              data-tooltip="Remove"
            >
              &times;
            </button>
          </div>
        )}
      </For>
      <button type="button" class="se-add-btn" onClick={addValue}>
        + Add value
      </button>
    </div>
  );
}

/** Interval editor — lo/hi bounds with inclusive toggles */
function IntervalEditor(props: { interval: Interval; onChange: (iv: Interval) => void; valueType: ValueType }) {
  const lo = (): Bound | undefined =>
    props.interval.lo.$tag === "Just" ? props.interval.lo._0 : undefined;
  const hi = (): Bound | undefined =>
    props.interval.hi.$tag === "Just" ? props.interval.hi._0 : undefined;
  const isDate = () => props.valueType === "date";

  const loLabel = () => isDate() ? "From" : "Min";
  const hiLabel = () => isDate() ? "Until" : "Max";
  const loPlaceholder = () => {
    if (isDate()) return "2025, 2025-05, ...";
    if (props.valueType === "number") return "-∞";
    return "-∞";
  };
  const hiPlaceholder = () => {
    if (isDate()) return "2026, 2026-12, ...";
    if (props.valueType === "number") return "∞";
    return "∞";
  };

  function parseBoundValue(value: string): string | number {
    if (isDate()) return value;
    const num = Number(value);
    return isNaN(num) ? value : num;
  }

  function setLo(value: string, inclusive: boolean) {
    if (value === "" || value === "-∞") {
      props.onChange({ ...props.interval, lo: Nothing });
    } else {
      props.onChange({
        ...props.interval,
        lo: Just({ value: parseBoundValue(value), inclusive }),
      });
    }
  }

  function setHi(value: string, inclusive: boolean) {
    if (value === "" || value === "∞") {
      props.onChange({ ...props.interval, hi: Nothing });
    } else {
      props.onChange({
        ...props.interval,
        hi: Just({ value: parseBoundValue(value), inclusive }),
      });
    }
  }

  return (
    <div class="se-interval">
      <div class="se-interval-bound">
        <label class="se-bound-label">{loLabel()}</label>
        <input
          class="se-input se-input--sm"
          type="text"
          value={lo() ? String(lo()!.value) : ""}
          placeholder={loPlaceholder()}
          onInput={(e) => setLo(e.currentTarget.value, lo()?.inclusive ?? true)}
        />
        <label class="se-checkbox">
          <input
            type="checkbox"
            checked={lo()?.inclusive ?? true}
            onChange={(e) => {
              if (lo()) setLo(String(lo()!.value), e.currentTarget.checked);
            }}
          />
          inclusive
        </label>
      </div>
      <span class="se-interval-sep">to</span>
      <div class="se-interval-bound">
        <label class="se-bound-label">{hiLabel()}</label>
        <input
          class="se-input se-input--sm"
          type="text"
          value={hi() ? String(hi()!.value) : ""}
          placeholder={hiPlaceholder()}
          onInput={(e) => setHi(e.currentTarget.value, hi()?.inclusive ?? true)}
        />
        <label class="se-checkbox">
          <input
            type="checkbox"
            checked={hi()?.inclusive ?? true}
            onChange={(e) => {
              if (hi()) setHi(String(hi()!.value), e.currentTarget.checked);
            }}
          />
          inclusive
        </label>
      </div>
    </div>
  );
}

/** Pattern editor — regex input with live test */
function PatternEditor(props: { pattern: string; onChange: (p: string) => void }) {
  const [testVal, setTestVal] = createSignal("");
  const testResult = () => {
    const v = testVal();
    if (!v || !props.pattern) return null;
    try {
      return new RegExp(props.pattern).test(v);
    } catch {
      return null;
    }
  };
  const valid = () => {
    if (!props.pattern) return true;
    try { new RegExp(props.pattern); return true; } catch { return false; }
  };

  return (
    <div class="se-pattern">
      <div class="se-pattern-input">
        <span class="se-pattern-slash">/</span>
        <input

          class={["se-input", { "se-input--error": !!(!valid()) }]}
          type="text"
          value={props.pattern}
          placeholder="regex pattern..."
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
        <span class="se-pattern-slash">/</span>
      </div>
      <Show when={!valid()}>
        <div class="se-error">Invalid regex</div>
      </Show>
      <div class="se-pattern-test">
        <input
          class="se-input se-input--sm"
          type="text"
          value={testVal()}
          placeholder="Test value..."
          onInput={(e) => setTestVal(e.currentTarget.value)}
        />
        <Show when={testResult() !== null}>
          <span class={testResult() ? "se-pass" : "se-fail"}>
            {testResult() ? "✓" : "✗"}
          </span>
        </Show>
      </div>
    </div>
  );
}

/** Named set editor — text input for named set reference */
function NamedEditor(props: { name: string; onChange: (n: string) => void }) {
  return (
    <div class="se-named">
      <input
        class="se-input"
        type="text"
        value={props.name}
        placeholder="Set name (e.g. ISO-3166-alpha2)"
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
      <div class="se-hint">
        Reference a named set from the type catalog
      </div>
    </div>
  );
}

/** Compound editor — union/intersection with nested SetExprEditors */
function CompoundEditor(props: {
  op: "union" | "intersect";
  children: SetExpr[];
  onChange: (kids: SetExpr[]) => void;
  valueType: ValueType;
}) {
  function updateChild(index: number, expr: SetExpr | undefined) {
    const next = [...props.children];
    if (expr) {
      next[index] = expr;
    } else {
      next.splice(index, 1);
    }
    props.onChange(next.length > 0 ? next : [buildSetExpr.enum([""])]);
  }

  function addChild() {
    props.onChange([...props.children, buildSetExpr.enum([""])]);
  }

  return (
    <div class="se-compound">
      <div class="se-compound-label">
        {props.op === "union" ? "Match ANY of:" : "Match ALL of:"}
      </div>
      <For keyed={false} each={props.children}>
        {(child, i) => (
          <div class="se-compound-item">
            <div class="se-compound-item-header">
              <span class="se-compound-item-index">#{i + 1}</span>
              <Show when={props.children.length > 1}>
                <button
                  type="button"
                  class="se-remove-btn"
                  onClick={() => updateChild(i, undefined)}
                >
                  &times;
                </button>
              </Show>
            </div>
            <SetExprEditorLegacy
              value={child()}
              onChange={(expr) => { if (expr) updateChild(i, expr); }}
              valueType={props.valueType}
              compact={true}
            />
            <Show when={i < props.children.length - 1}>
              <div class="se-compound-sep">
                {props.op === "union" ? "OR" : "AND"}
              </div>
            </Show>
          </div>
        )}
      </For>
      <button type="button" class="se-add-btn" onClick={addChild}>
        + Add constraint
      </button>
    </div>
  );
}
