// ---------------------------------------------------------------------------
// PatternBuilder — compose Pattern values for List<a> sequences
//
// Builds Pattern AST nodes (from @fenel/engine) via UI: choose a constructor
// (match / seq / alt / rep / star / plus / optional / eps), recursively edit
// children. The match() leaf takes a SetExpr predicate, edited via the
// existing SetExprEditor.
//
// Use cases:
//   - Funnel: seq(match(type=page_view), star(any), match(type=purchase))
//   - Engagement: rep(match(type=page_view), 3, ∞)
//   - Numeric sequences: seq(match(positive), match(positive))
// ---------------------------------------------------------------------------

import { Show, For, createMemo, createContext, useContext } from "solid-js";
import { SetExprEditor } from "~/lib/expression-builder";
import type { Pattern } from "@fenel/engine/pattern";
import type { FenelType, SetExpr } from "@fenel/engine/types";
import { buildSetExpr } from "@fenel/engine/set-marker";
import { LocusSelect } from "~/lib/locus-select";

export type PatternBuilderProps = {
  value: Pattern;
  onChange: (p: Pattern) => void;
  elementType?: FenelType;
};

const PatternElementContext = createContext<() => FenelType>(() => ({ $ref: "Any" }));

const KINDS = [
  { kind: "match", label: "match", description: "Match a single element by predicate" },
  { kind: "seq", label: "seq", description: "Concatenation: a then b" },
  { kind: "alt", label: "alt", description: "Alternation: a OR b" },
  { kind: "rep", label: "rep", description: "Bounded repetition: between min and max times" },
  { kind: "group", label: "capture", description: "Named capture with an optional constraint on the captured sequence" },
  { kind: "eps", label: "eps", description: "Empty sequence (matches nothing)" },
  { kind: "empty", label: "empty", description: "Failure (matches no input)" },
] as const;

type Kind = typeof KINDS[number]["kind"];

const SHORTHANDS = [
  { kind: "star", label: "star", description: "rep(child, 0, ∞)" },
  { kind: "plus", label: "plus", description: "rep(child, 1, ∞)" },
  { kind: "optional", label: "optional", description: "rep(child, 0, 1)" },
] as const;

export function PatternBuilder(props: PatternBuilderProps) {
  return <PatternElementContext value={() => props.elementType ?? { $ref: "Any" }}>
    <PatternNode value={props.value} onChange={props.onChange} depth={0} />
  </PatternElementContext>;
}

// ---------------------------------------------------------------------------
// Internal recursive node
// ---------------------------------------------------------------------------

function PatternNode(props: {
  value: Pattern;
  onChange: (p: Pattern) => void;
  depth: number;
}) {
  const indent = () => `${props.depth * 0.5}rem`;

  const setKind = (kind: Kind) => {
    if (kind === props.value.t) return;
    if (kind === "eps") props.onChange({ t: "eps" });
    else if (kind === "empty") props.onChange({ t: "empty" });
    else if (kind === "match") props.onChange({ t: "match", pred: buildSetExpr.all() });
    else if (kind === "seq")
      props.onChange({ t: "seq", a: { t: "eps" }, b: { t: "eps" } });
    else if (kind === "alt")
      props.onChange({ t: "alt", a: { t: "eps" }, b: { t: "eps" } });
    else if (kind === "rep")
      props.onChange({ t: "rep", child: { t: "eps" }, min: 0, max: Infinity });
    else if (kind === "group")
      props.onChange({ t: "group", name: "capture", child: props.value });
  };

  const setShorthand = (kind: "star" | "plus" | "optional") => {
    const inner: Pattern = props.value.t === "rep" ? props.value.child : { t: "match", pred: buildSetExpr.all() };
    if (kind === "star") props.onChange({ t: "rep", child: inner, min: 0, max: Infinity });
    else if (kind === "plus") props.onChange({ t: "rep", child: inner, min: 1, max: Infinity });
    else if (kind === "optional") props.onChange({ t: "rep", child: inner, min: 0, max: 1 });
  };

  return (
    <div class="pb-node" style={`margin-left: ${indent()};`}>
      <div class="pb-node-header">
        <LocusSelect
          label="Pattern kind"
          class="pb-kind-select"
          value={props.value.t}
          options={KINDS.map((k) => ({ value: k.kind, label: k.label, tooltip: k.description }))}
          onChange={(kind) => setKind(kind as Kind)}
        />
        <Show when={props.value.t === "rep"}>
          <For each={SHORTHANDS}>
            {(s) => (
              <button
                type="button"
                class="pb-shorthand"
                data-tooltip={s.description}
                onClick={() => setShorthand(s.kind)}
              >
                {s.label}
              </button>
            )}
          </For>
        </Show>
      </div>

      <Show when={props.value.t === "match"}>
        <MatchEditor
          value={(props.value as { t: "match"; pred: SetExpr }).pred}
          onChange={(pred) => props.onChange({ t: "match", pred })}
        />
      </Show>

      <Show when={props.value.t === "seq" || props.value.t === "alt"}>
        <BinaryEditor
          value={props.value as { t: "seq" | "alt"; a: Pattern; b: Pattern }}
          onChange={props.onChange}
          depth={props.depth + 1}
        />
      </Show>

      <Show when={props.value.t === "rep"}>
        <RepEditor
          value={props.value as { t: "rep"; child: Pattern; min: number; max: number }}
          onChange={props.onChange}
          depth={props.depth + 1}
        />
      </Show>
      <Show when={props.value.t === "group"}>
        <GroupEditor value={props.value as Extract<Pattern, { t: "group" }>} onChange={props.onChange} depth={props.depth + 1} />
      </Show>
    </div>
  );
}

function MatchEditor(props: { value: SetExpr; onChange: (s: SetExpr) => void }) {
  const elementType = useContext(PatternElementContext);
  return (
    <div class="pb-match-pred">
      <span class="pb-label">predicate:</span>
      <SetExprEditor
        compact
        baseType={elementType()}
        value={props.value}
        onChange={(v) => props.onChange(v ?? buildSetExpr.all())}
      />
    </div>
  );
}

function GroupEditor(props: { value: Extract<Pattern, { t: "group" }>; onChange: (p: Pattern) => void; depth: number }) {
  return <div class="pb-group">
    <label class="pb-label">Capture name <input aria-label="Capture name" value={props.value.name}
      onInput={(e) => props.onChange({ ...props.value, name: e.currentTarget.value })} /></label>
    <PatternNode value={props.value.child} onChange={(child) => props.onChange({ ...props.value, child })} depth={props.depth} />
    <label class="pb-label"><input type="checkbox" aria-label="Constrain capture" checked={props.value.type !== undefined}
      onChange={(e) => {
        if (e.currentTarget.checked) props.onChange({ ...props.value, type: buildSetExpr.all() });
        else { const { type, ...value } = props.value; props.onChange(value); }
      }} /> Constrain captured sequence</label>
    <Show when={props.value.type}>
      <SetExprEditor compact value={props.value.type} onChange={(type) => {
        if (type) props.onChange({ ...props.value, type });
        else { const { type: removed, ...value } = props.value; props.onChange(value); }
      }} />
    </Show>
  </div>;
}

function BinaryEditor(props: {
  value: { t: "seq" | "alt"; a: Pattern; b: Pattern };
  onChange: (p: Pattern) => void;
  depth: number;
}) {
  return (
    <div class="pb-binary">
      <div class="pb-binary-side">
        <div class="pb-side-label">{props.value.t === "seq" ? "first" : "left"}</div>
        <PatternNode
          value={props.value.a}
          onChange={(a) => props.onChange({ ...props.value, a })}
          depth={props.depth}
        />
      </div>
      <div class="pb-binary-side">
        <div class="pb-side-label">{props.value.t === "seq" ? "then" : "or"}</div>
        <PatternNode
          value={props.value.b}
          onChange={(b) => props.onChange({ ...props.value, b })}
          depth={props.depth}
        />
      </div>
    </div>
  );
}

function RepEditor(props: {
  value: { t: "rep"; child: Pattern; min: number; max: number };
  onChange: (p: Pattern) => void;
  depth: number;
}) {
  const minInput = createMemo(() => String(props.value.min));
  const maxInput = createMemo(() =>
    props.value.max === Infinity ? "∞" : String(props.value.max)
  );

  return (
    <div class="pb-rep">
      <div class="pb-rep-bounds">
        <span class="pb-label">min:</span>
        <input
          type="number"
          min="0"
          value={minInput()}
          onInput={(e) => {
            const min = Math.max(0, Number(e.currentTarget.value) || 0);
            props.onChange({ ...props.value, min });
          }}
        />
        <span class="pb-label">max:</span>
        <input
          type="text"
          value={maxInput()}
          onInput={(e) => {
            const v = e.currentTarget.value.trim();
            const max = v === "∞" || v === "" || v.toLowerCase() === "inf" ? Infinity : Number(v);
            if (!isNaN(max as number)) props.onChange({ ...props.value, max });
          }}
        />
      </div>
      <div class="pb-rep-child">
        <div class="pb-side-label">child</div>
        <PatternNode
          value={props.value.child}
          onChange={(child) => props.onChange({ ...props.value, child })}
          depth={props.depth}
        />
      </div>
    </div>
  );
}
