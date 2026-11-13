// SetExpr constructor UI follows the registered language ADT. All 14 public
// constructors author canonical values; validation-only SeRigid remains inert.
// Recursive formers share this editor and predicates share ExpressionEditor.

import { Show, For, createMemo, createSignal, createContext, useContext } from "solid-js";
import type { SetExpr, FenelType, Bound, Interval, Expression } from "@fenel/engine/types";
import { getSystemEntity, regexStringToPattern, patternToRegex } from "@fenel/engine";
import { parseSetExpr, formatSetExpr } from "@fenel/engine/set-syntax";
import { peelSetExpr, buildSetExpr, type SetExprView } from "@fenel/engine/set-marker";
import { Just, Nothing } from "@fenel/engine/type-foundation";
import { WherePredicate } from "./WherePredicate";
import { SetExprExamples } from "./SetExprExamples";
import { PatternBuilder } from "~/lib/pattern-builder/PatternBuilder";
import { SetConstructorFields, SetRecursiveBody, SetArrowBody } from "./SetExprStructure";
import { ExpressionEditor, logicToExprNode, toLogic } from "~/lib/expression-runner";
import { useAuthoringSession } from "~/lib/expression-runner/authoring-session";
import { FieldRenderer, ExprFieldContext } from "~/lib/field-renderer";
import { resolveAuthoringTypeRef } from "@fenel/engine/authoring/environment";
import { defaultValueForAuthoring, peelListForAuthoring } from "@fenel/engine/authoring/type";
import { contains, type MaybeBool } from "@fenel/engine/set-algebra";
import { LocusSelect } from "~/lib/locus-select";
import "./set-expr-builder.css";

// ---------------------------------------------------------------------------
// Public API (unchanged from the legacy editor — a drop-in replacement)
// ---------------------------------------------------------------------------

export type SetExprEditorProps = {
  /** Current SetExpr value */
  value: SetExpr | undefined;
  /** Called when expression changes */
  onChange: (expr: SetExpr | undefined) => void;
  /** Hint about the value domain — drives scalar parsing + interval defaults */
  valueType?: "string" | "number" | "date" | "any";
  /** Actual input type, shared by predicates and their example editors. */
  baseType?: FenelType;
  /** Compact mode — no section labels, tighter layout (used by nested branches) */
  compact?: boolean;
};

type ValueType = "string" | "number" | "date" | "any";
type CaseKind = SetExprView["kind"];
type AuthorableCaseKind = Exclude<CaseKind, "SeRigid">;

export const SetBindersContext = createContext<() => readonly string[]>(() => []);

const AUTHORABLE_CASES: ReadonlySet<CaseKind> = new Set([
  "SeAll", "SeNone", "SeEnum", "SeInterval", "SeRef", "SePattern",
  "SeWhere", "SeUnion", "SeIntersect", "SeDiff", "SeComplement",
  "SeCtor", "SeMu", "SeArrow",
]);

function isAuthorableCase(kind: CaseKind): kind is AuthorableCaseKind {
  return AUTHORABLE_CASES.has(kind);
}

/** Friendly labels for the authorable registered cases. (The principled home
 *  for these is a `Labelable` instance per SetExpr case — the Step-1c probe Q3
 *  override arc; this local map is the interim.) */
const CASE_LABEL: Partial<Record<CaseKind, string>> = {
  SeAll: "Any value",
  SeNone: "No value",
  SeEnum: "One of",
  SeInterval: "Between",
  SeRef: "Named set",
  SePattern: "Matches",
  SeWhere: "Where",
  SeUnion: "Any of  ∪",
  SeIntersect: "All of  ∩",
  SeDiff: "Difference  ∖",
  SeComplement: "Not  ¬",
  SeCtor: "Constructor",
  SeMu: "Recursive  μ",
  SeArrow: "Function  →",
};

/** Plain-word hints for the case chips' tooltips. The internal case names
 *  (`SeEnum` and the like) stay out of the interface; the precise spelling is
 *  one step away, in the "text" view. */
const CASE_HINT: Partial<Record<CaseKind, string>> = {
  SeAll: "Every value of the base type",
  SeNone: "No value at all (the empty set)",
  SeEnum: "Only the values you list",
  SeInterval: "Values between two bounds",
  SeRef: "A set defined elsewhere, by its name",
  SePattern: "Text that matches a pattern",
  SeWhere: "Values for which a condition holds",
  SeUnion: "Values in at least one of the sets (union)",
  SeIntersect: "Values in every one of the sets (intersection)",
  SeDiff: "Values in the first set but not in the second (difference)",
  SeComplement: "Values not in the set (complement)",
  SeCtor: "Values built by one constructor, with conditions on its fields",
  SeMu: "A set defined in terms of itself (recursive)",
  SeArrow: "Functions from one set to another",
};

/** Stable fallback case order, used when the catalog has not loaded the
 *  `SetExpr` entity (SSR / pre-mount). The live picker order comes from the
 *  registered ADT. */
const FALLBACK_CASES: AuthorableCaseKind[] = [
  "SeEnum", "SeInterval", "SePattern", "SeRef",
  "SeUnion", "SeIntersect", "SeDiff", "SeComplement",
  "SeAll", "SeNone", "SeWhere",
  "SeCtor", "SeMu", "SeArrow",
];

/** The supported authoring slice of the registered `SetExpr` `$variant` ADT. */
function registeredSetExprCases(): AuthorableCaseKind[] {
  // This is the repository's fixed language ADT, so reading its registered
  // type does not need to materialize the complete function authoring catalog.
  const t = getSystemEntity("SetExpr")?.type as Record<string, any> | undefined;
  const variant = t?.$variant ?? t?.$opaque?.pure?.$variant;
  const cases: { name: string }[] | undefined = variant?.cases;
  if (!cases?.length) return FALLBACK_CASES;
  const authorable = cases
    .map((c) => c.name as CaseKind)
    .filter(isAuthorableCase);
  return authorable.length ? authorable : FALLBACK_CASES;
}

// ---------------------------------------------------------------------------
// Scalar parsing + blank constructors
// ---------------------------------------------------------------------------

function defaultWherePredicate(vtype: ValueType): Expression {
  if (vtype === "number") return { call: ["std:gt", { var: "value" }, 0] };
  return { call: ["std:neq", { var: "value" }, ""] };
}

/** A sensible blank value for a freshly-picked case, in `$tag` form. */
function blankFor(kind: AuthorableCaseKind, vtype: ValueType, baseType?: FenelType): SetExpr {
  switch (kind) {
    case "SeAll": return buildSetExpr.all();
    case "SeNone": return buildSetExpr.none();
    case "SeEnum": return buildSetExpr.enum([baseType ? defaultValueForAuthoring(baseType) : vtype === "number" ? 0 : ""]);
    case "SeInterval": return buildSetExpr.interval(
      vtype === "number"
        ? { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) }
        : { lo: Nothing, hi: Nothing },
    );
    case "SeRef": return buildSetExpr.ref("");
    case "SePattern": return buildSetExpr.pattern({ t: "eps" });
    case "SeUnion": return buildSetExpr.union([blankFor("SeEnum", vtype, baseType)]);
    case "SeIntersect": return buildSetExpr.intersect([blankFor("SeEnum", vtype, baseType)]);
    case "SeDiff": return buildSetExpr.diff(blankFor("SeEnum", vtype, baseType), blankFor("SeEnum", vtype, baseType));
    case "SeComplement": return buildSetExpr.complement(blankFor("SeEnum", vtype, baseType));
    case "SeWhere": return buildSetExpr.where(defaultWherePredicate(vtype));
    case "SeCtor": return buildSetExpr.ctor("", []);
    case "SeMu": return buildSetExpr.mu("X", buildSetExpr.none());
    case "SeArrow": return buildSetExpr.arrow([], buildSetExpr.all());
  }
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export function SetExprEditor(props: SetExprEditorProps) {
  const vtype = (): ValueType => props.valueType ?? "any";
  const baseType = createMemo<FenelType>(() => props.baseType ?? {
    $ref: vtype() === "number" ? "Number" : vtype() === "date" ? "Date" : vtype() === "string" ? "String" : "Value",
  });
  const view = createMemo<SetExprView<SetExpr> | null>(() =>
    props.value ? peelSetExpr(props.value) : null,
  );
  const kind = (): CaseKind | null => view()?.kind ?? null;
  const asView = <K extends CaseKind>(_k: K) =>
    view() as Extract<SetExprView<SetExpr>, { kind: K }>;

  const emit = (se: SetExpr) => props.onChange(se);

  const cases = createMemo(() => registeredSetExprCases());
  const [regexOpen, setRegexOpen] = createSignal(false);

  // Text-syntax escape hatch (parity with the legacy editor).
  const [textMode, setTextMode] = createSignal(false);
  const [textInput, setTextInput] = createSignal("");
  const [textError, setTextError] = createSignal<string | null>(null);
  let initialText = "";

  function enterTextMode() {
    initialText = props.value ? formatSetExpr(props.value) : "";
    setTextInput(initialText);
    setTextError(null);
    setTextMode(true);
  }
  function applyText() {
    if (!textMode()) return;
    if (textInput() === initialText) { setTextMode(false); return; }
    const src = textInput().trim();
    if (!src) { props.onChange(undefined); setTextMode(false); return; }
    try {
      emit(parseSetExpr(src));
      setTextError(null);
      setTextMode(false);
    } catch (e: any) {
      setTextError(e?.message ?? String(e));
    }
  }

  return (
    <div class={["sev", { "sev--compact": !!(props.compact) }]}>
      {/* Case picker — driven by the registered SetExpr ADT */}
      <div class="sev-cases">
        <For each={cases()}>
          {(c) => (
            <button
              type="button"

              class={["sev-chip", { "sev-chip--active": !!(kind() === c) }]}
              data-tooltip={CASE_HINT[c] ?? CASE_LABEL[c] ?? c}
              onClick={() => { if (kind() !== c) emit(blankFor(c, vtype(), baseType())); }}
            >
              {CASE_LABEL[c] ?? c}
            </button>
          )}
        </For>
        <span class="sev-sep">|</span>
        <button type="button" class="sev-chip sev-chip--text" onClick={enterTextMode} data-tooltip="Edit as text">
          ✎ text
        </button>
      </div>

      {/* Text-syntax input */}
      <Show when={textMode()}>
        <div class="sev-text">
          <input
            type="text"

            class={["sev-text-field", { "sev-text-field--error": !!textError() }]}
            value={textInput()}
            onInput={(e) => { setTextInput(e.currentTarget.value); setTextError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyText(); } if (e.key === "Escape") setTextMode(false); }}
            onBlur={applyText}
            placeholder="e.g. ℝ[0..100] u ℤ[-10..0]"
            autofocus
          />
          <Show when={textError()}>
            <div class="sev-text-error">{textError()}</div>
          </Show>
        </div>
      </Show>

      {/* Payload editor for the current case */}
      <Show when={!textMode() && view()}>
        <div class="sev-body">
          <Show when={kind() === "SeAll"}>
            <div class="sev-note">Matches <b>any</b> value of the base type.</div>
          </Show>
          <Show when={kind() === "SeNone"}>
            <div class="sev-note">Matches <b>no</b> value (the empty set).</div>
          </Show>
          <Show when={kind() === "SeEnum"}>
            <EnumValues values={asView("SeEnum").values} vtype={vtype()} baseType={baseType()} onChange={(vals) => emit(buildSetExpr.enum(vals))} />
          </Show>
          <Show when={kind() === "SeInterval"}>
            <IntervalBounds interval={asView("SeInterval").interval} vtype={vtype()} onChange={(iv) => emit(buildSetExpr.interval(iv))} />
          </Show>
          <Show when={kind() === "SeRef"}>
            <RefHandle handle={asView("SeRef").handle} onChange={(h) => emit(buildSetExpr.ref(h))} />
          </Show>
          <Show when={kind() === "SePattern"}>
            <PatternBuilder value={asView("SePattern").pattern}
              elementType={vtype() === "string" || ("$ref" in baseType() && ["String", "Char"].includes((baseType() as { $ref: string }).$ref)) ? { $ref: "Char" } : peelListForAuthoring(baseType())?.elem}
              onChange={(p) => emit(buildSetExpr.pattern(p))} />
            <details onToggle={(e) => setRegexOpen(e.currentTarget.open)}><summary>Replace with regular expression</summary>
              <Show when={regexOpen()}>
              <PatternRegex pattern={patternToRegex(asView("SePattern").pattern) ?? ""} onChange={(re) => {
                const p = regexStringToPattern(re);
                if (p) emit(buildSetExpr.pattern(p));
              }} />
              </Show>
            </details>
          </Show>
          <Show when={kind() === "SeUnion"}>
            <Compound op="union" branches={asView("SeUnion").branches} vtype={vtype()} baseType={baseType()} onChange={(bs) => emit(buildSetExpr.union(bs))} />
          </Show>
          <Show when={kind() === "SeIntersect"}>
            <Compound op="intersect" branches={asView("SeIntersect").branches} vtype={vtype()} baseType={baseType()} onChange={(bs) => emit(buildSetExpr.intersect(bs))} />
          </Show>
          <Show when={kind() === "SeDiff"}>
            <Diff left={asView("SeDiff").left} right={asView("SeDiff").right} vtype={vtype()} baseType={baseType()}
              onChange={(l, r) => emit(buildSetExpr.diff(l, r))} />
          </Show>
          <Show when={kind() === "SeComplement"}>
            <div class="sev-unary">
              <span class="sev-unary__label">complement of:</span>
              <SetExprEditor value={asView("SeComplement").inner} valueType={vtype()} baseType={baseType()} compact
                onChange={(inner) => { if (inner) emit(buildSetExpr.complement(inner)); }} />
            </div>
          </Show>
          <Show when={kind() === "SeWhere"}>
            <WherePredicate
              pred={asView("SeWhere").pred}
              baseType={baseType()}
              onChange={(pred) => emit(buildSetExpr.where(pred))}
            />
          </Show>
          <Show when={kind() === "SeCtor"}>
            <SetConstructorFields value={asView("SeCtor")} onChange={emit} />
          </Show>
          <Show when={kind() === "SeMu"}>
            <SetRecursiveBody value={asView("SeMu")} onChange={emit} />
          </Show>
          <Show when={kind() === "SeArrow"}>
            <SetArrowBody value={asView("SeArrow")} onChange={emit} />
          </Show>
          <Show when={kind() === "SeRigid"}>
            <div class="sev-note">This validation-only atom cannot be authored or exported.</div>
          </Show>
        </div>
      </Show>

      <Show when={!textMode() && props.value}>
        <Show when={!props.compact}>
          <SetExprExamples set={props.value!} baseType={baseType()} />
        </Show>
        <div class="sev-footer">
          <button type="button" class="sev-clear" onClick={() => props.onChange(undefined)}>Clear constraint</button>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaf payload sub-editors
// ---------------------------------------------------------------------------

function EnumValues(props: { values: unknown[]; vtype: ValueType; baseType: FenelType; onChange: (vals: unknown[]) => void }) {
  const session = useAuthoringSession();

  function update(i: number, value: unknown) {
    const next = [...props.values];
    next[i] = value;
    props.onChange(next);
  }
  function add() { props.onChange([...props.values, defaultValueForAuthoring(props.baseType)]); }
  function remove(i: number) {
    const next = props.values.filter((_, j) => j !== i);
    props.onChange(next);
  }

  return (
    <div class="sev-enum">
      <For keyed={false} each={props.values}>
        {(val, i) => (
          <div class="sev-enum-row">
            <ExprFieldContext value={null}>
              <FieldRenderer identityMode="transient" compact
                field={{ name: `value${i + 1}`, label: Nothing, ui: Nothing, meta: {}, type: resolveAuthoringTypeRef(session.environment, props.baseType) ?? props.baseType }}
                value={val()} onChange={(next) => update(i, next)} />
            </ExprFieldContext>
            <button type="button" class="sev-x" data-tooltip="Remove" onClick={() => remove(i)}>&times;</button>
          </div>
        )}
      </For>
      <button type="button" class="sev-add" onClick={add}>+ value</button>
    </div>
  );
}

function IntervalBounds(props: { interval: Interval; vtype: ValueType; onChange: (iv: Interval) => void }) {
  return (
    <div class="sev-interval">
      <For keyed={false} each={["lo", "hi"] as const}>{(side) => (
        <IntervalBound label={side() === "lo" ? "Minimum" : "Maximum"} vtype={props.vtype}
          value={props.interval[side()].$tag === "Just" ? (props.interval[side()] as { _0: Bound })._0 : undefined}
          onChange={(value) => props.onChange({ ...props.interval, [side()]: value ? Just(value) : Nothing })} />
      )}</For>
    </div>
  );
}

function IntervalBound(props: { label: string; value: Bound | undefined; vtype: ValueType; onChange: (bound: Bound | undefined) => void }) {
  const session = useAuthoringSession();
  const mode = () => !props.value ? "unbounded" : typeof props.value.value === "object" ? "expression" : typeof props.value.value;
  return <div class="sev-bound" role="group" aria-label={props.label}>
    <label class="sev-bound__label">{props.label}</label>
    <LocusSelect label={`${props.label} kind`} value={mode()}
      options={[
        { value: "unbounded", label: "Unbounded" }, { value: "number", label: "Number" },
        { value: "string", label: "Text / date" }, { value: "expression", label: "Expression" },
      ]}
      onChange={(kind) => props.onChange(kind === "unbounded" ? undefined : {
        inclusive: props.value?.inclusive ?? true,
        value: kind === "expression" ? { $expr: { var: "limit" } } : kind === "number" ? 0 : "",
      })} />
    <Show when={props.value}>
      <Show when={mode() === "expression"} fallback={
        <input class="sev-input sev-input--sm" aria-label={`${props.label} value`} type={mode() === "number" ? "number" : "text"}
          value={typeof props.value?.value === "object" ? "" : props.value?.value ?? ""}
          onInput={(e) => {
            const value = mode() === "number" ? e.currentTarget.valueAsNumber : e.currentTarget.value;
            if (typeof value === "number" && !Number.isFinite(value)) return;
            props.onChange({ ...props.value!, value });
          }} />
      }>
        <ExpressionEditor expr={logicToExprNode((props.value?.value as { $expr: Expression }).$expr, [], session)} authoringSession={session}
          paramName={`${props.label} expression`} onChange={(next) => props.onChange({ ...props.value!, value: { $expr: toLogic(next, undefined, session) as Expression } })} />
      </Show>
      <label class="sev-check"><input type="checkbox" checked={props.value?.inclusive ?? true}
        onChange={(e) => props.onChange({ ...props.value!, inclusive: e.currentTarget.checked })} /> inclusive</label>
    </Show>
  </div>;
}

function RefHandle(props: { handle: string; onChange: (h: string) => void }) {
  const binders = useContext(SetBindersContext);
  return (
    <div class="sev-ref">
      <input class="sev-input" type="text" value={props.handle}
        placeholder="Named set (e.g. ISO-3166-alpha2)" onInput={(e) => props.onChange(e.currentTarget.value)} />
      <div class="sev-hint">Reference a named set from the type catalog.</div>
      <For each={binders()}>{(name) => <button type="button" class="sev-add" onClick={() => props.onChange(name)}>Use recursive {name}</button>}</For>
    </div>
  );
}

function PatternRegex(props: { pattern: string; onChange: (re: string) => void }) {
  const [draft, setDraft] = createSignal<{ source: string; text: string }>();
  const text = () => draft()?.source === props.pattern ? draft()!.text : props.pattern;
  const [test, setTest] = createSignal("");
  const parsed = createMemo(() => { try { return regexStringToPattern(text()); } catch { return null; } });
  const valid = () => parsed() != null;
  const [run, setRun] = createSignal<{ source: string; input: string; result: MaybeBool }>();
  const result = () => run()?.source === text() && run()?.input === test() ? run()?.result : undefined;
  return (
    <div class="sev-pattern">
      <div class="sev-pattern__row">
        <span class="sev-slash">/</span>
        <input class={["sev-input", { "sev-input--error": !!(!valid()) }]} type="text" value={text()}
          placeholder="regex pattern…"
          onInput={(e) => {
            const next = e.currentTarget.value;
            setDraft({ source: props.pattern, text: next });
            if (next !== props.pattern) props.onChange(next);
          }} />
        <span class="sev-slash">/</span>
      </div>
      <Show when={!valid()}><div class="sev-err">Invalid regex</div></Show>
      <div class="sev-pattern__test">
        <input class="sev-input sev-input--sm" type="text" value={test()} placeholder="test value…"
          onInput={(e) => setTest(e.currentTarget.value)} />
        <button type="button" class="sev-add" disabled={!valid()} onClick={() => {
          const pattern = parsed();
          if (pattern) setRun({ source: text(), input: test(), result: contains(buildSetExpr.pattern(pattern), test(), null) });
        }}>Test regex</button>
        <Show when={result()}>
          <span class={result()?.$tag === "Just" && (result() as { _0: boolean })._0 ? "sev-pass" : "sev-fail"}>
            {result()?.$tag === "Just" ? (result() as { _0: boolean })._0 ? "Matches" : "Does not match" : "Undetermined"}
          </span>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compound / recursive sub-editors — each recurses <SetExprEditor>
// ---------------------------------------------------------------------------

function Compound(props: { op: "union" | "intersect"; branches: SetExpr[]; vtype: ValueType; baseType: FenelType; onChange: (bs: SetExpr[]) => void }) {
  function updateBranch(i: number, expr: SetExpr | undefined) {
    const next = [...props.branches];
    if (expr) next[i] = expr; else next.splice(i, 1);
    props.onChange(next);
  }
  function add() { props.onChange([...props.branches, blankFor("SeEnum", props.vtype, props.baseType)]); }

  return (
    <div class="sev-compound">
      <div class="sev-compound__label">{props.op === "union" ? "Match ANY of:" : "Match ALL of:"}</div>
      <For keyed={false} each={props.branches}>
        {(branch, i) => (
          <div class="sev-branch">
            <div class="sev-branch__head">
              <span class="sev-branch__n">#{i + 1}</span>
              <Show when={props.branches.length > 0}>
                <button type="button" class="sev-x" onClick={() => updateBranch(i, undefined)}>&times;</button>
              </Show>
            </div>
            <SetExprEditor value={branch()} valueType={props.vtype} baseType={props.baseType} compact
              onChange={(expr) => { if (expr) updateBranch(i, expr); }} />
            <Show when={i < props.branches.length - 1}>
              <div class="sev-branch__sep">{props.op === "union" ? "OR" : "AND"}</div>
            </Show>
          </div>
        )}
      </For>
      <button type="button" class="sev-add" onClick={add}>+ constraint</button>
    </div>
  );
}

function Diff(props: { left: SetExpr; right: SetExpr; vtype: ValueType; baseType: FenelType; onChange: (l: SetExpr, r: SetExpr) => void }) {
  return (
    <div class="sev-diff">
      <div class="sev-diff__side">
        <span class="sev-diff__label">in:</span>
        <SetExprEditor value={props.left} valueType={props.vtype} baseType={props.baseType} compact
          onChange={(l) => { if (l) props.onChange(l, props.right); }} />
      </div>
      <div class="sev-diff__side">
        <span class="sev-diff__label">but not:</span>
        <SetExprEditor value={props.right} valueType={props.vtype} baseType={props.baseType} compact
          onChange={(r) => { if (r) props.onChange(props.left, r); }} />
      </div>
    </div>
  );
}
