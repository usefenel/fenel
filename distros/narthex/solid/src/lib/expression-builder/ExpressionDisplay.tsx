// ---------------------------------------------------------------------------
// ExpressionDisplay — visual renderer for SetExpr + JSON Logic
//
// Replaces raw JSON with readable, color-coded, recursive token rendering.
// Each SetExpr/Expression variant gets its own visual treatment.
//
// Read-only. For editing, see SetExprEditor / ExpressionEditor.
// ---------------------------------------------------------------------------

import { Show, For, createSignal, createMemo } from "solid-js";
import type { SetExpr, Expression, Pattern } from "@fenel/engine/types";
import { contains, validateWithHints, patternToRegex, getSymbol } from "@fenel/engine";
import { Nothing } from "@fenel/engine/type-foundation";
import { pureEvaluateContext, type EvaluateContext } from "@fenel/engine/expressions";
import { formatSetExpr } from "@fenel/engine/set-syntax";
import { peelSetExpr, setExprToTag, type SetExprView } from "@fenel/engine/set-marker";
import { IconCircleCheck, IconCircleX } from "~/lib/icons";
import { useReaderRuntime } from "~/lib/reader-runtime";
import { useAuthoringSession } from "~/lib/expression-runner/authoring-session";
import { preparedReaderWorkerForSession, runPreparedReaderWorker } from "~/lib/expression-runner/authoring-catalog-worker";
import type { AuthoringSetMembership } from "~/lib/expression-runner/authoring-worker-protocol";
import { createAsyncValue } from "~/lib/async-value";
import "./expression-display.css";

// containment-substrate Phase 2 Step 3 (design §10.3) — the SetExpr former glyphs
// (`∪`/`∩`/`¬`/`\`) are resolved through the `Symbolable` projection, NOT hardcoded
// here. This is the SECOND emit surface (the engine `set-syntax.fenel:formatSetExpr`
// is the first) — both now source the ONE glyph fact (the `Symbolable` `.fenel`
// instances), the kill-2-birds the brief calls for. `getSymbol` resolves
// synchronously from the in-browser global dispatchRegistry (built at engine import);
// the `?? former` degrades to the former NAME on a miss — NOT a re-inlined parallel
// glyph table (the subsumption fence).
const sym = (former: string): string => getSymbol(former) ?? former;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type DisplayProps = {
  /** The expression to render */
  expr: SetExpr | Expression | unknown;
  /** Render as SetExpr (default) or JSON Logic */
  mode?: "set" | "logic";
  /** Allow toggling raw JSON view */
  showRawToggle?: boolean;
  /** Show inline tester for SetExpr */
  showTester?: boolean;
  /** Diagnose an existing typed candidate without introducing another input
   * or interpreting text as a number/JSON value. The owner keeps its editor. */
  candidate?: { value: unknown; cursorPosition?: number };
  /** The reader's captured function/scope context for pure membership feedback. */
  evaluateContext?: EvaluateContext;
  /** Compact mode — single line, no nesting indent */
  compact?: boolean;
};

/** Visual expression renderer — the main component */
export function ExpressionDisplay(props: DisplayProps) {
  const [viewMode, setViewMode] = createSignal<"visual" | "text" | "json">("visual");
  const [jsonEdit, setJsonEdit] = createSignal("");
  const [jsonError, setJsonError] = createSignal<string | null>(null);
  const [editMode, setEditMode] = createSignal(false);
  const mode = () => props.mode ?? "set";

  const canonicalSet = createMemo<SetExpr | null>(() => {
    if (mode() !== "set" || !peelSetExpr(props.expr)) return null;
    try {
      return setExprToTag(props.expr);
    } catch {
      return null;
    }
  });

  const textRepr = createMemo(() => {
    try {
      const set = canonicalSet();
      if (set) return formatSetExpr(set);
    } catch { /* fall through */ }
    return null;
  });

  const rawJson = createMemo(() => {
    try {
      return JSON.stringify(props.expr, null, 2);
    } catch {
      return "{}";
    }
  });

  function startEdit() {
    setJsonEdit(rawJson());
    setJsonError(null);
    setEditMode(true);
  }

  function validateJson(text: string) {
    setJsonEdit(text);
    try {
      JSON.parse(text);
      setJsonError(null);
    } catch (e: any) {
      setJsonError(e.message);
    }
  }

  return (
    <div class={["expr-display", { "expr-display--compact": !!(props.compact) }]}>
      {/* Visual rendering */}
      <Show when={viewMode() === "visual"}>
        <div class="expr-visual">
          <Show when={mode() === "set"} fallback={<LogicNode expr={props.expr as Expression} />}>
            <SetNode set={props.expr} compact={props.compact} />
          </Show>
        </div>
      </Show>

      {/* Text (set syntax) view */}
      <Show when={viewMode() === "text"}>
        <pre class="expr-text">{textRepr() ?? "—"}</pre>
      </Show>

      {/* Raw JSON view */}
      <Show when={viewMode() === "json"}>
        <Show when={!editMode()} fallback={
          <div class="expr-raw-editor">
            <textarea

              class={["expr-raw-textarea", { "expr-raw-textarea--error": !!jsonError() }]}
              value={jsonEdit()}
              onInput={(e) => validateJson(e.currentTarget.value)}
              rows={Math.min(jsonEdit().split("\n").length + 1, 15)}
            />
            <Show when={jsonError()}>
              <div class="expr-raw-error">{jsonError()}</div>
            </Show>
          </div>
        }>
          <pre class="expr-raw">{rawJson()}</pre>
        </Show>
      </Show>

      {/* Controls */}
      <Show when={props.showRawToggle !== false}>
        <div class="expr-controls">
          <Show when={mode() === "set" && textRepr()}>
            <button

              class={["expr-toggle-btn", { "expr-toggle-btn--active": !!(viewMode() === "text") }]}
              onClick={() => { setViewMode(viewMode() === "text" ? "visual" : "text"); setEditMode(false); }}
              type="button"
            >
              Text
            </button>
          </Show>
          <button

            class={["expr-toggle-btn", { "expr-toggle-btn--active": !!(viewMode() === "json") }]}
            onClick={() => { setViewMode(viewMode() === "json" ? "visual" : "json"); setEditMode(false); }}
            type="button"
          >
            JSON
          </button>
          <Show when={viewMode() === "json" && !editMode()}>
            <button class="expr-toggle-btn" onClick={startEdit} type="button">Edit</button>
          </Show>
        </div>
      </Show>

      {/* Inline tester */}
      <Show when={props.showTester && mode() === "set" && canonicalSet()}>
        <InlineTester set={canonicalSet()!} candidate={props.candidate} evaluateContext={props.evaluateContext} />
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SetExpr visual nodes — recursive rendering
// ---------------------------------------------------------------------------

function SetNode(props: { set: unknown; compact?: boolean; operand?: boolean }) {
  // Canonicalize at every recursive reader boundary. This preserves legacy
  // child tolerance while giving Pattern's mutually-recursive SetExpr slots
  // their honest canonical type before patternToRegex consumes them.
  const canonical = createMemo<SetExpr | null>(() => {
    if (peelSetExpr(props.set) === null) return null;
    try { return setExprToTag(props.set); } catch { return null; }
  });
  const view = createMemo<SetExprView<SetExpr> | null>(() => {
    const set = canonical();
    return set === null ? null : peelSetExpr(set);
  });
  const as = <K extends SetExprView<SetExpr>["kind"]>(_k: K) =>
    view() as Extract<SetExprView<SetExpr>, { kind: K }>;
  const grouped = createMemo(() => !!props.operand && ["SeUnion", "SeIntersect", "SeDiff", "SeMu", "SeArrow"].includes(view()?.kind ?? ""));

  return (
    <span class="expr-group" data-set-kind={view()?.kind}>
      <Show when={grouped()}><span class="expr-paren">(</span></Show>
      <Show when={view()?.kind === "SeAll"}>
        <span class="expr-token expr-token--named">*</span>
      </Show>

      <Show when={view()?.kind === "SeNone"}>
        <span class="expr-token expr-token--named">∅</span>
      </Show>

      <Show when={view()?.kind === "SeEnum"}>
        <EnumNode values={as("SeEnum").values} />
      </Show>

      <Show when={view()?.kind === "SeInterval"}>
        <IntervalNode interval={as("SeInterval").interval as { lo: any; hi: any }} />
      </Show>

      <Show when={view()?.kind === "SeRef"}>
        <span class="expr-token expr-token--named">{as("SeRef").handle}</span>
      </Show>

      <Show when={view()?.kind === "SePattern"}>
        <span class="expr-token expr-token--pattern">
          /{patternToRegex(as("SePattern").pattern) ?? "[unprintable pattern]"}/
        </span>
      </Show>

      <Show when={view()?.kind === "SeWhere"}>
        <span class="expr-token expr-token--op">where</span>
        <span class="expr-paren">(</span>
        <LogicNode expr={as("SeWhere").pred} />
        <span class="expr-paren">)</span>
      </Show>

      <Show when={view()?.kind === "SeUnion"}>
        <CompoundNode
          op={sym("union")}
          opClass="expr-token--union"
          children={as("SeUnion").branches}
          compact={props.compact}
        />
      </Show>

      <Show when={view()?.kind === "SeIntersect"}>
        <CompoundNode
          op={sym("intersect")}
          opClass="expr-token--intersect"
          children={as("SeIntersect").branches}
          compact={props.compact}
        />
      </Show>

      <Show when={view()?.kind === "SeDiff"}>
        <span class="expr-group">
          <SetNode set={as("SeDiff").left} compact={props.compact} operand />
          <span class="expr-token expr-token--op"> {sym("diff")} </span>
          <SetNode set={as("SeDiff").right} compact={props.compact} operand />
        </span>
      </Show>

      <Show when={view()?.kind === "SeComplement"}>
        <span class="expr-group">
          <span class="expr-token expr-token--op">{sym("complement")}</span>
          <SetNode set={as("SeComplement").inner} compact={props.compact} operand />
        </span>
      </Show>

      <Show when={view()?.kind === "SeCtor"}>
        <span class="expr-group">
          <Show when={as("SeCtor").ctor}>
            <span class="expr-token expr-token--named">{as("SeCtor").ctor} </span>
          </Show>
          <span class="expr-paren">{"{ "}</span>
          <span class={["expr-group", { "expr-group--block": !!(!props.compact && as("SeCtor").fields.length) }]}>
            <For each={as("SeCtor").fields}>{(field, index) =>
              <span class="expr-group">
                <span class="expr-token expr-token--var">{field.wireName}</span>
                <span class="expr-token expr-token--sep">: </span>
                <SetNode set={field.set} compact={props.compact} operand />
                <Show when={index() < as("SeCtor").fields.length - 1}>
                  <span class="expr-token expr-token--sep">, </span>
                </Show>
              </span>
            }</For>
          </span>
          <span class="expr-paren">{" }"}</span>
        </span>
      </Show>

      <Show when={view()?.kind === "SeMu"}>
        <span class="expr-group">
          <span class="expr-token expr-token--op">rec </span>
          <span class="expr-token expr-token--var">{as("SeMu").var}</span>
          <span class="expr-token expr-token--sep">. </span>
          <SetNode set={as("SeMu").body} compact={props.compact} operand />
        </span>
      </Show>

      <Show when={view()?.kind === "SeArrow"}>
        <span class="expr-group">
          <span class="expr-paren">(</span>
          <span class={["expr-group", { "expr-group--block": !!(!props.compact && as("SeArrow").params.length > 1) }]}>
            <For each={as("SeArrow").params}>{(param, index) =>
              <span class="expr-group">
                <span class="expr-token expr-token--var">{param.wireName}</span>
                <span class="expr-token expr-token--sep">: </span>
                <SetNode set={param.set} compact={props.compact} operand />
                <Show when={index() < as("SeArrow").params.length - 1}>
                  <span class="expr-token expr-token--sep">, </span>
                </Show>
              </span>
            }</For>
          </span>
          <span class="expr-paren">)</span>
          <span class="expr-token expr-token--op"> {sym("arrow")} </span>
          <SetNode set={as("SeArrow").returns} compact={props.compact} operand />
        </span>
      </Show>

      <Show when={!view()}>
        <span class="expr-token expr-token--named">unrecognized set</span>
      </Show>
      <Show when={grouped()}><span class="expr-paren">)</span></Show>
    </span>
  );
}

/** Render enum values as pill chips */
function EnumNode(props: { values: unknown[] }) {
  return (
    <span class="expr-enum">
      <For each={props.values}>
        {(v, i) => (
          <>
            <span class="expr-chip">{formatValue(v)}</span>
            <Show when={i() < props.values.length - 1}>
              <span class="expr-token expr-token--sep"> | </span>
            </Show>
          </>
        )}
      </For>
    </span>
  );
}

/** Render interval in math notation: [0, 100], (0, ∞), etc. */
function IntervalNode(props: { interval: { lo: any; hi: any } }) {
  const iv = () => props.interval;
  const loB = () => iv().lo?.$tag === "Just" ? iv().lo._0 : undefined;
  const hiB = () => iv().hi?.$tag === "Just" ? iv().hi._0 : undefined;
  const loVal = () => loB() ? formatBound(loB()!.value) : "-∞";
  const hiVal = () => hiB() ? formatBound(hiB()!.value) : "∞";
  const loBracket = () => loB()?.inclusive ? "[" : "(";
  const hiBracket = () => hiB()?.inclusive ? "]" : ")";

  return (
    <span class="expr-token expr-token--interval">
      {loBracket()}{loVal()}, {hiVal()}{hiBracket()}
    </span>
  );
}

/** Render compound (union/intersection) with operator between children */
function CompoundNode(props: { op: string; opClass: string; children: unknown[]; compact?: boolean }) {
  return (
    <span class={["expr-group", { "expr-group--block": !!(!props.compact && props.children.length > 2) }]}>
      <For each={props.children}>
        {(child, i) => (
          <>
            <SetNode set={child} compact={props.compact} operand />
            <Show when={i() < props.children.length - 1}>
              <span class={`expr-token ${props.opClass}`}> {props.op} </span>
            </Show>
          </>
        )}
      </For>
    </span>
  );
}

// ---------------------------------------------------------------------------
// JSON Logic visual nodes
// ---------------------------------------------------------------------------

function LogicNode(props: { expr: Expression }) {
  const e = () => props.expr;

  // Variable reference
  if (typeof e() === "object" && e() !== null && "var" in e()) {
    const varName = (e() as { var: string }).var;
    return <span class="expr-token expr-token--var">{varName || "value"}</span>;
  }

  // Literal value
  if (typeof e() !== "object" || e() === null) {
    return <span class="expr-token expr-token--literal">{formatValue(e())}</span>;
  }

  const keys = Object.keys(e());
  if (keys.length === 0) return <span class="expr-token expr-token--literal">{"{}"}</span>;

  const op = keys[0]!;
  const args = (e() as Record<string, unknown>)[op];

  // Comparison operators
  if (["==", "===", "!=", "!==", ">", ">=", "<", "<="].includes(op) && Array.isArray(args) && args.length === 2) {
    return (
      <span class="expr-group">
        <LogicNode expr={args[0] as Expression} />
        <span class="expr-token expr-token--op"> {formatOp(op)} </span>
        <LogicNode expr={args[1] as Expression} />
      </span>
    );
  }

  // Logical operators
  if ((op === "and" || op === "or") && Array.isArray(args)) {
    const opLabel = op.toUpperCase();
    return (
      <span class="expr-group">
        <For each={args as Expression[]}>
          {(arg, i) => (
            <>
              <LogicNode expr={arg} />
              <Show when={i() < (args as Expression[]).length - 1}>
                <span class="expr-token expr-token--logic"> {opLabel} </span>
              </Show>
            </>
          )}
        </For>
      </span>
    );
  }

  // Not
  if (op === "!" && !Array.isArray(args)) {
    return (
      <span class="expr-group">
        <span class="expr-token expr-token--op">NOT </span>
        <LogicNode expr={args as Expression} />
      </span>
    );
  }

  // "in" operator
  if (op === "in" && Array.isArray(args) && args.length === 2) {
    return (
      <span class="expr-group">
        <LogicNode expr={args[0] as Expression} />
        <span class="expr-token expr-token--op"> in </span>
        <Show when={Array.isArray(args[1])} fallback={<LogicNode expr={args[1] as Expression} />}>
          <EnumNode values={args[1] as unknown[]} />
        </Show>
      </span>
    );
  }

  // If-then-else
  if (op === "if" && Array.isArray(args) && args.length >= 2) {
    return (
      <span class="expr-group expr-group--block">
        <span class="expr-token expr-token--logic">IF </span>
        <LogicNode expr={args[0] as Expression} />
        <span class="expr-token expr-token--logic"> THEN </span>
        <LogicNode expr={args[1] as Expression} />
        <Show when={args.length >= 3}>
          <span class="expr-token expr-token--logic"> ELSE </span>
          <LogicNode expr={args[2] as Expression} />
        </Show>
      </span>
    );
  }

  // Arithmetic
  if (["+", "-", "*", "/", "%"].includes(op) && Array.isArray(args) && args.length === 2) {
    return (
      <span class="expr-group">
        <LogicNode expr={args[0] as Expression} />
        <span class="expr-token expr-token--op"> {op} </span>
        <LogicNode expr={args[1] as Expression} />
      </span>
    );
  }

  // Function call: {"call": ["name", arg1, arg2]}
  if (op === "call" && Array.isArray(args) && args.length >= 1) {
    const fnName = args[0];
    const fnArgs = args.slice(1);
    return (
      <span class="expr-group">
        <span class="expr-token expr-token--fn">{typeof fnName === "string" ? fnName : <LogicNode expr={fnName as Expression} />}</span>
        <span class="expr-paren">(</span>
        <For each={fnArgs as unknown[]}>
          {(arg, i) => (
            <>
              <LogicNode expr={arg as Expression} />
              <Show when={i() < fnArgs.length - 1}>
                <span class="expr-token expr-token--sep">, </span>
              </Show>
            </>
          )}
        </For>
        <span class="expr-paren">)</span>
      </span>
    );
  }

  // Pipe: {"pipe": [value, "fn1", "fn2", ["fn3", extra]]}
  if (op === "pipe" && Array.isArray(args) && args.length >= 2) {
    return (
      <span class="expr-group">
        <LogicNode expr={args[0] as Expression} />
        <For each={args.slice(1) as unknown[]}>
          {(step) => (
            <>
              <span class="expr-token expr-token--pipe"> | </span>
              <Show when={typeof step === "string"}>
                <span class="expr-token expr-token--fn">{step as string}</span>
              </Show>
              <Show when={Array.isArray(step)}>
                <span class="expr-token expr-token--fn">{(step as unknown[])[0] as string}</span>
                <Show when={(step as unknown[]).length > 1}>
                  <span class="expr-paren">(</span>
                  <For each={(step as unknown[]).slice(1)}>
                    {(arg, i) => (
                      <>
                        <LogicNode expr={arg as Expression} />
                        <Show when={i() < (step as unknown[]).length - 2}>
                          <span class="expr-token expr-token--sep">, </span>
                        </Show>
                      </>
                    )}
                  </For>
                  <span class="expr-paren">)</span>
                </Show>
              </Show>
            </>
          )}
        </For>
      </span>
    );
  }

  // Lambda: {"fn": [["x", "y"], body]}
  if (op === "fn" && Array.isArray(args) && args.length === 2) {
    const params = Array.isArray(args[0]) ? args[0] : [];
    return (
      <span class="expr-group">
        <span class="expr-paren">(</span>
        <span class="expr-token expr-token--var">{params.join(", ")}</span>
        <span class="expr-paren">)</span>
        <span class="expr-token expr-token--op">{" => "}</span>
        <LogicNode expr={args[1] as Expression} />
      </span>
    );
  }

  // Fallback: render as function call
  return (
    <span class="expr-group">
      <span class="expr-token expr-token--fn">{op}</span>
      <span class="expr-paren">(</span>
      <Show when={Array.isArray(args)}>
        <For each={args as unknown[]}>
          {(arg, i) => (
            <>
              <LogicNode expr={arg as Expression} />
              <Show when={i() < (args as unknown[]).length - 1}>
                <span class="expr-token expr-token--sep">, </span>
              </Show>
            </>
          )}
        </For>
      </Show>
      <Show when={!Array.isArray(args)}>
        <LogicNode expr={args as Expression} />
      </Show>
      <span class="expr-paren">)</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline tester — type a value, see green/red live
// ---------------------------------------------------------------------------

function InlineTester(props: { set: SetExpr; candidate?: DisplayProps["candidate"]; evaluateContext?: EvaluateContext }) {
  const [testValue, setTestValue] = createSignal("");
  const [cursorPos, setCursorPos] = createSignal(0);
  const [showPassed, setShowPassed] = createSignal(false);
  const context = createMemo(() => props.evaluateContext === undefined
    ? undefined : pureEvaluateContext(props.evaluateContext));

  const parsedValue = createMemo(() => {
    if (props.candidate) return props.candidate.value;
    const v = testValue();
    if (!v) return undefined;
    const trimmed = v.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try { return JSON.parse(trimmed); } catch { return v; }
    }
    const num = Number(v);
    return !isNaN(num) && trimmed !== "" ? num : v;
  });

  // B3: a Local reader checks membership and hints in its worker frame.
  const reader = useReaderRuntime();
  const authoring = useAuthoringSession();
  // Each input is one object; an answer is shown only for the input it was
  // computed for, so a running check never shows the previous verdict.
  const localInput = createMemo(() => reader?.kind === "local" ? {
    set: props.set, candidate: props.candidate?.value, test: parsedValue(),
    cursor: props.candidate ? props.candidate.cursorPosition ?? (typeof parsedValue() === "string" ? String(parsedValue()).length : 0) : cursorPos(),
  } : undefined);
  const localCheck = createAsyncValue(() => localInput(), async input => {
    let worker;
    try { worker = preparedReaderWorkerForSession(authoring); } catch { worker = undefined; }
    if (!worker) return { input, verdict: Nothing as ReturnType<typeof contains>, hints: null };
    const reply = await runPreparedReaderWorker(worker, { method: "check-set-membership", set: input.set,
      values: input.candidate === undefined ? [] : [input.candidate],
      ...(input.test === undefined ? {} : { hints: { value: input.test, cursor: input.cursor } }) }) as AuthoringSetMembership;
    return { input, verdict: (input.candidate === undefined ? Nothing : reply.verdicts[0] ?? Nothing) as ReturnType<typeof contains>,
      hints: (reply.hints ?? null) as ReturnType<typeof validateWithHints> | null };
  });
  const localResult = () => {
    const result = localCheck();
    return !localCheck.loading && result && result.input === localInput() ? result : undefined;
  };
  const candidateVerdict = createMemo(() => {
    if (reader?.kind === "local") return localResult()?.verdict ?? Nothing;
    if (!props.candidate || props.candidate.value === undefined) return Nothing;
    // GLOBAL_ONLY — browser feedback has no request account. The captured
    // pure context supplies the same source functions/scope as the input gate;
    // this presentation verdict never authorizes a write or effect.
    try { return contains(props.set, props.candidate.value, null, undefined, context()); }
    catch { return Nothing; }
  });
  const candidateDecision = createMemo(() => {
    const verdict = candidateVerdict();
    return verdict.$tag === "Just" ? verdict._0 : undefined;
  });
  const hints = createMemo(() => {
    const testVal = parsedValue();
    if (testVal === undefined) return null;
    // The historical hint schema has Boolean summaries. Do not present its
    // conservative false fallback as a failure when membership abstains.
    if (props.candidate && candidateDecision() === undefined) return null;
    if (reader?.kind === "local") return localResult()?.hints ?? null;
    try {
      return validateWithHints(testVal, props.set, props.candidate
        ? props.candidate.cursorPosition ?? (typeof testVal === "string" ? testVal.length : 0)
        : cursorPos(), undefined, context());
    } catch {
      return null;
    }
  });

  const failed = createMemo(() => hints()?.constraints.filter((c) => !c.passed) ?? []);
  const passed = createMemo(() => hints()?.constraints.filter((c) => c.passed) ?? []);
  const displayedCursor = createMemo(() => {
    const cursor = hints()?.cursor;
    // The helper's older hint pattern may disagree with the declared set.
    // Exact accepted membership cannot be presented as a cursor failure.
    if (props.candidate && candidateDecision() === true
      && (cursor?.failedAt || cursor?.canMatch === false)) return undefined;
    return cursor;
  });

  const isPartial = createMemo(() => {
    const h = hints();
    if (!h || h.valid) return false;
    const cur = displayedCursor();
    return cur ? cur.canMatch && !cur.failedAt : false;
  });

  function trackCursor(el: HTMLInputElement) {
    setCursorPos(el.selectionStart ?? el.value.length);
  }

  return (
    <div class="expr-tester" aria-live={props.candidate ? "polite" : undefined}>
      <Show when={!props.candidate}>
      <div class="expr-tester__input-row">
        <input
          class="expr-tester__input"
          type="text"
          placeholder="Test a value..."
          value={testValue()}
          onInput={(e) => { setTestValue(e.currentTarget.value); trackCursor(e.currentTarget); }}
          onClick={(e) => trackCursor(e.currentTarget)}
          onKeyUp={(e) => trackCursor(e.currentTarget)}
        />
        <Show when={hints()}>
          {(h) => (
            <span class={["expr-tester__result", {
              "expr-tester__result--pass": h().valid,
              "expr-tester__result--partial": !h().valid && isPartial(),
              "expr-tester__result--fail": !h().valid && !isPartial(),
            }]}>
              {h().valid ? <IconCircleCheck size={16} class="icon-pass" /> : isPartial() ? "⋯" : <IconCircleX size={16} class="icon-fail" />}
            </span>
          )}
        </Show>
      </div>
      </Show>

      <Show when={props.candidate}>
        <div class={["expr-tester__candidate-status", {
          "expr-tester__candidate-status--pass": candidateDecision() === true,
          "expr-tester__candidate-status--partial": candidateDecision() === false && isPartial(),
          "expr-tester__candidate-status--fail": candidateDecision() === false && !isPartial(),
        }]}>
          {candidateDecision() === undefined ? "Membership undecided"
            : candidateDecision() ? "Constraint accepted" : isPartial() ? "Incomplete text" : "Constraint not satisfied"}
        </div>
      </Show>

      <Show when={hints()}>
        {(h) => (
          <div class="expr-tester__details">
            {/* Failure position */}
            <Show when={displayedCursor()?.failedAt}>
              {(f) => (
                <div class="expr-tester__failure">
                  <span class="expr-tester__failure-pos">
                    Failed at position {f().position + 1}:
                  </span>
                  {" "}expected <strong>{f().expected}</strong>, got <strong>'{f().got}'</strong>
                  <Show when={(displayedCursor()?.matchedCount ?? 0) > 0}>
                    <span class="expr-tester__matched-prefix">
                      {" "}— matched first {displayedCursor()!.matchedCount} chars
                    </span>
                  </Show>
                </div>
              )}
            </Show>

            {/* Cursor hint (when not failed) */}
            <Show when={!displayedCursor()?.failedAt && displayedCursor()}>
              {(cur) => (
                <div class="expr-tester__cursor-hint">
                  <span class="expr-tester__cursor-label">Next:</span>
                  {cur().humanLabel}
                  <Show when={cur().canEnd}>
                    <span class="expr-tester__can-end">(or end here)</span>
                  </Show>
                </div>
              )}
            </Show>

            {/* Failed constraints */}
            <Show when={h().constraints.length > 1 && failed().length > 0}>
              <ul class="expr-tester__constraints">
                <For each={failed()}>
                  {(c) => (
                    <li class="expr-tester__constraint expr-tester__constraint--fail">
                      <span class="expr-tester__check"><IconCircleX size={13} class="icon-fail" /></span>
                      {c.label}
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            {/* Passed constraints (collapsed) */}
            <Show when={passed().length > 0}>
              <button
                class="expr-tester__toggle-passed"
                onClick={() => setShowPassed(!showPassed())}
                type="button"
              >
                {showPassed() ? "▾" : "▸"} {passed().length} passed
              </button>
              <Show when={showPassed()}>
                <ul class="expr-tester__constraints">
                  <For each={passed()}>
                    {(c) => (
                      <li class="expr-tester__constraint expr-tester__constraint--pass">
                        <span class="expr-tester__check"><IconCircleCheck size={13} class="icon-pass" /></span>
                        {c.label}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>

            {/* Segment visualization */}
            <Show when={displayedCursor()?.segments && displayedCursor()!.segments.length > 0}>
              <SegmentView value={props.candidate && typeof props.candidate.value === "string" ? props.candidate.value : testValue()} segments={displayedCursor()!.segments} activeGroup={displayedCursor()?.activeGroup} />
            </Show>

            {/* List hints */}
            <Show when={h().listHint}>
              {(lh) => (
                <div class="expr-tester__list-hint">
                  <span class="expr-tester__list-count">{lh().elementCount} element{lh().elementCount !== 1 ? "s" : ""}</span>
                  <Show when={lh().minRemaining !== undefined && lh().minRemaining! > 0}>
                    <span class="expr-tester__list-remaining expr-tester__list-remaining--need">
                      need {lh().minRemaining} more
                    </span>
                  </Show>
                  <Show when={lh().maxRemaining !== undefined}>
                    <span class="expr-tester__list-remaining">
                      {lh().maxRemaining === 0 ? "at max" : `${lh().maxRemaining} more allowed`}
                    </span>
                  </Show>
                  <Show when={lh().nextLabel}>
                    <div class="expr-tester__next-constraint">
                      <span class="expr-tester__cursor-label">Next:</span>
                      {lh().nextLabel}
                    </div>
                  </Show>
                </div>
              )}
            </Show>

            {/* Field hints (objects) */}
            <Show when={h().fieldHints && h().fieldHints!.length > 0}>
              <ul class="expr-tester__field-hints">
                <For each={h().fieldHints!}>
                  {(fh) => (
                    <li class={["expr-tester__field-hint", {
                      "expr-tester__field-hint--pass": fh.filled && fh.valid,
                      "expr-tester__field-hint--fail": fh.filled && !fh.valid,
                      "expr-tester__field-hint--empty": !fh.filled,
                      "expr-tester__field-hint--dead": !!fh.deadEnd,
                    }]}>
                      <span class="expr-tester__check">
                        {fh.filled ? (fh.valid ? <IconCircleCheck size={13} class="icon-pass" /> : <IconCircleX size={13} class="icon-fail" />) : "○"}
                      </span>
                      <span class="expr-tester__field-name">{fh.fieldId}</span>
                      <Show when={fh.narrowedLabel}>
                        <span class="expr-tester__field-narrowed">{fh.narrowedLabel}</span>
                      </Show>
                      <Show when={fh.deadEnd}>
                        <span class="expr-tester__field-dead">impossible</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

const SEGMENT_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#06b6d4", "#6366f1", "#f43f5e",
];

type SegSeg = { name: string; start: number; end: number; depth?: number };

function SegmentView(props: { value: string; segments: SegSeg[]; activeGroup?: string }) {
  const depth0 = createMemo(() => props.segments.filter(s => (s.depth ?? 0) === 0));
  const depth1 = createMemo(() => props.segments.filter(s => s.depth === 1));
  const hasDepth1 = createMemo(() => depth1().length > 0);

  const colorMap = createMemo(() => {
    const map = new Map<string, string>();
    let i = 0;
    for (const seg of props.segments) {
      if (!map.has(seg.name)) {
        map.set(seg.name, SEGMENT_COLORS[i % SEGMENT_COLORS.length]!);
        i++;
      }
    }
    return map;
  });

  function charsForDepth(segs: SegSeg[]) {
    const val = props.value;
    const result: { char: string; group?: string; color?: string }[] = [];
    for (let i = 0; i < val.length; i++) {
      let match: string | undefined;
      for (const seg of segs) {
        if (i >= seg.start && i < seg.end) match = seg.name;
      }
      result.push({
        char: val.charAt(i),
        group: match,
        color: match ? colorMap().get(match) : undefined,
      });
    }
    return result;
  }

  const innerChars = createMemo(() => {
    const d1 = depth1();
    return charsForDepth(d1.length > 0 ? d1 : depth0());
  });

  const parentChars = createMemo(() => charsForDepth(depth0()));

  return (
    <div class="expr-tester__segments">
      {/* Characters colored by innermost segments */}
      <div class="expr-tester__segment-chars">
        <For each={innerChars()}>
          {(c) => (
            <span
              class="expr-tester__segment-char"
              style={c.color ? { "border-bottom": `2px solid ${c.color}`, color: c.color } : undefined}
              data-tooltip={c.group}
            >
              {c.char === " " ? "\u00A0" : c.char}
            </span>
          )}
        </For>
      </div>

      {/* Parent group bars (depth 0) when depth 1 exists */}
      <Show when={hasDepth1()}>
        <div class="expr-tester__segment-bars">
          <For each={parentChars()}>
            {(c) => (
              <span
                class="expr-tester__segment-bar"
                style={c.color ? { "border-bottom": `2px solid ${c.color}` } : undefined}
                data-tooltip={c.group}
              >
                {c.char === " " ? "\u00A0" : "\u2003"}
              </span>
            )}
          </For>
        </div>
      </Show>

      {/* Labels — depth 1 (detail) then depth 0 (groups) */}
      <div class="expr-tester__segment-labels">
        <Show when={hasDepth1()}>
          <div class="expr-tester__segment-label-row">
            <For each={depth1()}>
              {(seg) => (
                <span

                  class={["expr-tester__segment-label", { "expr-tester__segment-label--active": !!(seg.name === props.activeGroup) }]}
                  style={{ color: colorMap().get(seg.name) }}
                >
                  {seg.name}
                </span>
              )}
            </For>
          </div>
        </Show>
        <div class="expr-tester__segment-label-row expr-tester__segment-label-row--parent">
          <For each={depth0()}>
            {(seg) => (
              <span

                class={["expr-tester__segment-label", { "expr-tester__segment-label--active": !!(seg.name === props.activeGroup) }]}
                style={{ color: colorMap().get(seg.name) }}
              >
                {seg.name}
              </span>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function formatBound(v: unknown): string {
  if (typeof v === "object" && v !== null && "$expr" in (v as Record<string, unknown>)) {
    return "expr(…)";
  }
  return String(v);
}

function formatOp(op: string): string {
  switch (op) {
    case "==": case "===": return "=";
    case "!=": case "!==": return "≠";
    case ">=": return "≥";
    case "<=": return "≤";
    default: return op;
  }
}
