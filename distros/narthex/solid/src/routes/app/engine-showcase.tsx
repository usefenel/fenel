// ---------------------------------------------------------------------------
// Engine Showcase — demonstrate recent foundation evolutions in the UI
//
//   1. Recursive ADT picker (ADTBuilder) → live FenelType
//   2. VariantValueRenderer over hand-crafted values of that FenelType
//   3. Structural ops (head / length / map / fold) wired to the same value
//   4. Pattern builder + matcher: build a pattern, type events, see if matches
//   5. isSubset / patternSubset between two SetExprs / Patterns
// ---------------------------------------------------------------------------

import { Show, createSignal, createMemo, For } from "solid-js";
import {
  structuralHead,
  structuralLength,
  structuralFold,
  structuralView,
  isSubset,
  getNamedPattern,
  regexStringToPattern,
} from "@fenel/engine";
import {
  match,
  seq,
  star,
  rep,
  patternMatch,
  patternSubset,
  longestMatch,
  nullable,
  deriv,
  type Pattern,
} from "@fenel/engine/pattern";
import type { FenelType, SetExpr } from "@fenel/engine/types";

import { ADTBuilder } from "~/lib/adt-builder/ADTBuilder";
import { VariantValueRenderer } from "~/lib/variant-value/VariantValueRenderer";
import { PatternBuilder } from "~/lib/pattern-builder/PatternBuilder";

import "~/lib/adt-builder/adt-builder.css";
import "~/lib/variant-value/variant-value.css";
import "~/lib/pattern-builder/pattern-builder.css";
import "./engine-showcase.css";
import { Just, Nothing } from "@fenel/engine/type-foundation";

function regexSet(re: string): SetExpr {
  const p = regexStringToPattern(re);
  if (!p) throw new Error(`Invalid regex /${re}/`);
  return { $tag: "SePattern", pattern: p };
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

const INITIAL_TREE_TYPE: FenelType = {
  $mu: {
    var: "X",
    body: {
      $variant: {
        cases: [
          { name: "Leaf", label: Nothing },
          {
            name: "Node",
            label: Nothing,
            fields: [
              { name: "value", label: Nothing, type: { $ref: "Int" }, meta: {}, ui: Nothing },
              { name: "left", label: Nothing, type: { $var: "X" }, meta: {}, ui: Nothing },
              { name: "right", label: Nothing, type: { $var: "X" }, meta: {}, ui: Nothing },
            ],
          },
        ],
      },
    },
  },
};

const INITIAL_TREE_VALUE = {
  $tag: "Node",
  value: 10,
  left: {
    $tag: "Node",
    value: 5,
    left: { $tag: "Leaf" },
    right: { $tag: "Leaf" },
  },
  right: {
    $tag: "Node",
    value: 20,
    left: { $tag: "Leaf" },
    right: {
      $tag: "Node",
      value: 30,
      left: { $tag: "Leaf" },
      right: { $tag: "Leaf" },
    },
  },
};

const INITIAL_PATTERN: Pattern = seq(
  match({ $tag: "SeWhere", pred: { "==": [{ var: "type" }, "page_view"] } }),
  star(match({ $tag: "SeAll" })),
  match({ $tag: "SeWhere", pred: { "==": [{ var: "type" }, "purchase"] } }),
);

const INITIAL_EVENTS = [
  { type: "page_view", url: "/landing" },
  { type: "click", button: "cta" },
  { type: "scroll", position: 800 },
  { type: "purchase", amount: 99 },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EngineShowcase() {
  return (
    <div class="es-page">
      <header class="es-header">
        <h1>Engine Showcase</h1>
        <p>
          Foundation pieces from the recent type-system work, made visible:
          recursive ADT structure, structural traversal, generic pattern
          matching, and subset reasoning across set expressions.
        </p>
      </header>

      <RecursiveADTSection />
      <PatternSection />
      <SubsetSection />
      <MaskInputSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recursive ADT section — ADTBuilder + VariantValueRenderer + structural ops
// ---------------------------------------------------------------------------

function RecursiveADTSection() {
  const [type, setType] = createSignal<FenelType>(INITIAL_TREE_TYPE);
  const [valueJson, setValueJson] = createSignal(JSON.stringify(INITIAL_TREE_VALUE, null, 2));
  const parsedValue = createMemo(() => {
    try {
      return { value: JSON.parse(valueJson()), error: null };
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const value = () => parsedValue().value;
  const valueError = () => parsedValue().error;

  const view = createMemo(() => structuralView(type()));

  const ops = createMemo(() => {
    const v = value();
    if (v == null) return null;
    return {
      head: structuralHead(type(), v),
      length: structuralLength(type(), v),
      sumIfNumeric: structuralFold(type(), v, (acc, x) => {
        if (typeof acc === "number" && typeof x === "number") return acc + x;
        return acc;
      }, 0),
    };
  });

  return (
    <section class="es-section">
      <h2>1. Recursive ADTs — types as data</h2>
      <p class="es-blurb">
        Pick a preset or paste a μ/variant FenelType. Every recursive ADT
        participates in the same structural algebra — the engine derives
        head/length/fold from the type's shape, no per-type instance needed.
      </p>

      <div class="es-grid-2">
        <div class="es-pane">
          <h3>FenelType</h3>
          <ADTBuilder value={type()} onChange={setType} />
        </div>

        <div class="es-pane">
          <h3>Value of this type</h3>
          <textarea
            class="es-json-input"
            value={valueJson()}
            onInput={(e) => setValueJson(e.currentTarget.value)}
            rows={12}
            spellcheck={false}
          />
          <Show when={valueError()}>
            <div class="es-error">{valueError()}</div>
          </Show>
        </div>
      </div>

      <div class="es-results">
        <h3>Structural lens of the type</h3>
        <Show
          when={view()}
          fallback={<div class="es-muted">Type is not a variant — not foldable.</div>}
        >
          <ul class="es-case-list">
            <For each={view()!.cases}>
              {(c) => (
                <li>
                  <span class="es-case-name">{c.name}</span>
                  <Show when={c.fields.length > 0}>
                    <span class="es-paren">(</span>
                    <For each={c.fields}>
                      {(f, i) => (
                        <>
                          <Show when={i() > 0}>, </Show>
                          <span class="es-field-name">{f.name}</span>
                          <span class="es-fade">
                            : {f.isRecursive ? "self" : "element"}
                          </span>
                        </>
                      )}
                    </For>
                    <span class="es-paren">)</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>

          <h3>Rendered value</h3>
          <Show when={value() !== null}>
            <div class="es-rendered">
              <VariantValueRenderer type={type()} value={value()} />
            </div>
          </Show>

          <h3>Structural operations</h3>
          <Show when={ops()}>
            <table class="es-ops">
              <tbody>
                <tr>
                  <td><code>structuralHead</code></td>
                  <td><code>{JSON.stringify(ops()!.head)}</code></td>
                </tr>
                <tr>
                  <td><code>structuralLength</code></td>
                  <td><code>{ops()!.length}</code></td>
                </tr>
                <tr>
                  <td><code>structuralFold (+)</code></td>
                  <td><code>{JSON.stringify(ops()!.sumIfNumeric)}</code></td>
                </tr>
              </tbody>
            </table>
          </Show>
        </Show>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pattern section — PatternBuilder + sequence matcher
// ---------------------------------------------------------------------------

function PatternSection() {
  const [pattern, setPattern] = createSignal<Pattern>(INITIAL_PATTERN);
  const [eventsJson, setEventsJson] = createSignal(
    JSON.stringify(INITIAL_EVENTS, null, 2),
  );
  const parsedEvents = createMemo(() => {
    try {
      const parsed = JSON.parse(eventsJson());
      if (!Array.isArray(parsed)) {
        return { value: [], error: "Expected an array of events" };
      }
      return { value: parsed as unknown[], error: null };
    } catch (e) {
      return { value: [], error: e instanceof Error ? e.message : String(e) };
    }
  });
  const events = () => parsedEvents().value;
  const eventsError = () => parsedEvents().error;

  const result = createMemo(() => ({
    matches: patternMatch(pattern(), events()),
    longestPrefix: longestMatch(pattern(), events()),
  }));

  return (
    <section class="es-section">
      <h2>2. Pattern engine — regex over List&lt;a&gt;</h2>
      <p class="es-blurb">
        Compose a Pattern AST with seq / alt / rep / match. Each match node
        carries a SetExpr predicate over the element type, so the same
        algebra describes char regex, funnel sequences, numeric patterns —
        anything indexable by a typed predicate.
      </p>

      <div class="es-grid-2">
        <div class="es-pane">
          <h3>Pattern</h3>
          <PatternBuilder value={pattern()} onChange={setPattern} />
        </div>

        <div class="es-pane">
          <h3>Input sequence</h3>
          <textarea
            class="es-json-input"
            value={eventsJson()}
            onInput={(e) => setEventsJson(e.currentTarget.value)}
            rows={10}
            spellcheck={false}
          />
          <Show when={eventsError()}>
            <div class="es-error">{eventsError()}</div>
          </Show>
        </div>
      </div>

      <div class="es-results">
        <h3>Match result</h3>
        <table class="es-ops">
          <tbody>
            <tr>
              <td><code>patternMatch</code></td>
              <td>
                <span class={{
                  "es-pass": result().matches,
                  "es-fail": !result().matches,
                }}>
                  {result().matches ? "✓ match" : "✗ no match"}
                </span>
              </td>
            </tr>
            <tr>
              <td><code>longestMatch</code></td>
              <td><code>{result().longestPrefix}</code> of <code>{events().length}</code></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Subset section — isSubset on SetExpr, patternSubset on Pattern
// ---------------------------------------------------------------------------

function SubsetSection() {
  const setExamples: { name: string; a: SetExpr; b: SetExpr }[] = [
    {
      name: "regex: ^[a-c]$ ⊆ ^[a-z]$",
      a: regexSet("^[a-c]$"),
      b: regexSet("^[a-z]$"),
    },
    {
      name: "regex: ^a+$ ⊆ ^a*$",
      a: regexSet("^a+$"),
      b: regexSet("^a*$"),
    },
    {
      name: "regex: ^a*$ ⊄ ^a+$ (a* allows empty, a+ does not)",
      a: regexSet("^a*$"),
      b: regexSet("^a+$"),
    },
    {
      name: "interval: [0, 10] ⊆ [0, 100]",
      a: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 10, inclusive: true }) } },
      b: { $tag: "SeInterval", interval: { lo: Just({ value: 0, inclusive: true }), hi: Just({ value: 100, inclusive: true }) } },
    },
    {
      name: "enum ⊆ pattern: {foo, bar} ⊆ ^(foo|bar)$",
      a: { $tag: "SeEnum", values: ["foo", "bar"] },
      b: regexSet("^(foo|bar)$"),
    },
    {
      name: "named: Nat ⊆ Int",
      a: { $tag: "SeRef", handle: "Nat" },
      b: { $tag: "SeRef", handle: "Int" },
    },
  ];

  const patternExamples: { name: string; a: Pattern; b: Pattern }[] = [
    {
      name: "plus(num) ⊆ star(num)",
      a: rep(match({ $tag: "SeAll" }), 1, Infinity),
      b: rep(match({ $tag: "SeAll" }), 0, Infinity),
    },
    {
      name: "page_view → purchase ⊆ page_view → any* → purchase",
      a: seq(
        match({ $tag: "SeWhere", pred: { "==": [{ var: "type" }, "page_view"] } }),
        match({ $tag: "SeWhere", pred: { "==": [{ var: "type" }, "purchase"] } }),
      ),
      b: INITIAL_PATTERN,
    },
    {
      name: "rep(p, 3) ⊆ rep(p, 2, ∞)",
      a: rep(match({ $tag: "SeAll" }), 3, 3),
      b: rep(match({ $tag: "SeAll" }), 2, Infinity),
    },
  ];

  return (
    <section class="es-section">
      <h2>3. Subset reasoning — proof, not just equality</h2>
      <p class="es-blurb">
        isSubset over SetExpr now reasons about regex patterns via Brzozowski
        derivatives, and patternSubset does the same for arbitrary Pattern
        languages over List&lt;a&gt;. Both go beyond syntactic equality.
      </p>

      <div class="es-results">
        <h3>SetExpr — isSubset</h3>
        <table class="es-ops">
          <thead>
            <tr><th>example</th><th>result</th></tr>
          </thead>
          <tbody>
            <For each={setExamples}>
              {(ex) => {
                const r = isSubset(ex.a, ex.b);
                return (
                  <tr>
                    <td>{ex.name}</td>
                    <td>
                      <span
                        class={{
                          "es-pass": r.$tag === "Just" && r._0,
                          "es-fail": r.$tag === "Just" && !r._0,
                          "es-unknown": r.$tag === "Nothing",
                        }}
                        title={r.$tag === "Nothing" ? "Unknown: subset could not be decided" : undefined}
                      >
                        {r.$tag === "Just" ? (r._0 ? "✓ true" : "✗ false") : "? unknown"}
                      </span>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>

        <h3>Pattern — patternSubset</h3>
        <table class="es-ops">
          <thead>
            <tr><th>example</th><th>result</th></tr>
          </thead>
          <tbody>
            <For each={patternExamples}>
              {(ex) => {
                const r = patternSubset(ex.a, ex.b);
                return (
                  <tr>
                    <td>{ex.name}</td>
                    <td>
                      <span class={{ "es-pass": r, "es-fail": !r }}>
                        {r ? "✓ true" : "✗ false"}
                      </span>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// MaskInput section — Brzozowski derivatives over named formats, live in the
// browser. Each keystroke runs `deriv(p, c)`; if the residual is `empty`, the
// keystroke is rejected; if `nullable`, the value is complete. The set of
// "next valid characters" is computed by probing the residual with a fixed
// alphabet — same answer the residual's frontier would give analytically,
// without enumerating the Pattern AST.
// ---------------------------------------------------------------------------

const MASK_DEMOS: { format: string; template: string; label: string }[] = [
  { label: "US date",       format: "format:date:us",        template: "MM/dd/yyyy" },
  { label: "EU date",       format: "format:date:eu",        template: "dd/MM/yyyy" },
  { label: "ISO date",      format: "format:date:iso",       template: "yyyy-MM-dd" },
  { label: "DE date",       format: "format:date:eu-dot",    template: "dd.MM.yyyy" },
  { label: "Time (24h)",    format: "format:time:24h",       template: "HH:mm" },
  { label: "Datetime ISO",  format: "format:datetime:iso-t", template: "yyyy-MM-ddTHH:mm:ss" },
  { label: "HEX color",     format: "format:hex-color",      template: "#XXXXXX" },
  { label: "MAC address",   format: "format:mac",            template: "XX:XX:XX:XX:XX:XX" },
  { label: "Credit card",   format: "format:credit-card",    template: "0000 0000 0000 0000" },
];

// Probe alphabet — wide enough for digits, hex, ASCII letters, common
// separators. The deriv probe accepts any of these; rendering trims whitespace.
const PROBE_ALPHABET =
  "0123456789abcdefABCDEF" +
  "ghijklmnopqrstuvwxyzGHIJKLMNOPQRSTUVWXYZ" +
  "/-.: T#";

function MaskInputSection() {
  return (
    <section class="es-section">
      <h2>4. Live input masks — Brzozowski derivatives in the UI</h2>
      <p class="es-blurb">
        Each input below holds a named format Pattern from the engine. Every
        keystroke calls <code>deriv(pattern, char)</code>; if the residual is
        empty the keystroke is rejected; if nullable, the value is complete.
        The "next" hint enumerates which characters the residual currently
        accepts — the autocomplete frontier, derived for free.
      </p>

      <div class="es-mask-list">
        <For each={MASK_DEMOS}>
          {(demo) => (
            <MaskedInput
              label={demo.label}
              format={demo.format}
              template={demo.template}
            />
          )}
        </For>
      </div>
    </section>
  );
}

function MaskedInput(props: {
  label: string;
  format: string;
  template: string;
}) {
  const [typed, setTyped] = createSignal("");

  const basePattern = createMemo(() => getNamedPattern(props.format) ?? null);

  // Residual after consuming `typed()`. Returns null if the typed string
  // ever derives to empty (shouldn't normally happen, since we reject
  // invalid input on the way in — defensive only).
  const residual = createMemo(() => {
    const base = basePattern();
    if (!base) return null;
    let cur: Pattern = base;
    for (const c of typed()) {
      cur = deriv(cur, c);
      if (cur.t === "empty") return null;
    }
    return cur;
  });

  const status = createMemo<"empty" | "incomplete" | "complete" | "missing">(() => {
    if (!basePattern()) return "missing";
    const r = residual();
    if (r === null) return "incomplete";
    if (typed().length === 0) return "empty";
    if (nullable(r)) return "complete";
    return "incomplete";
  });

  const nextChars = createMemo<string[]>(() => {
    const r = residual();
    if (!r || r.t === "empty") return [];
    const accepted: string[] = [];
    for (const c of PROBE_ALPHABET) {
      if (deriv(r, c).t !== "empty") accepted.push(c);
    }
    return accepted;
  });

  function handleInput(e: InputEvent & { currentTarget: HTMLInputElement }) {
    const proposed = e.currentTarget.value;
    const base = basePattern();
    if (!base) {
      setTyped(proposed);
      return;
    }
    let cur: Pattern = base;
    for (const c of proposed) {
      cur = deriv(cur, c);
      if (cur.t === "empty") {
        // Reject — restore last valid value
        e.currentTarget.value = typed();
        return;
      }
    }
    setTyped(proposed);
  }

  const remaining = createMemo(() => props.template.slice(typed().length));

  return (
    <div class="es-mask-row">
      <label class="es-mask-label">{props.label}</label>

      <div class="es-mask-input-wrap" data-status={status()}>
        <div class="es-mask-overlay" aria-hidden="true">
          <span class="es-mask-typed">{typed()}</span>
          <span class="es-mask-remaining">{remaining()}</span>
        </div>
        <input
          class="es-mask-input"
          type="text"
          value={typed()}
          onInput={handleInput}
          autocomplete="off"
          spellcheck={false}
          placeholder={props.template}
        />
      </div>

      <div class="es-mask-meta">
        <span class={`es-mask-status es-mask-status--${status()}`}>
          <Show when={status() === "complete"}>complete</Show>
          <Show when={status() === "incomplete"}>incomplete</Show>
          <Show when={status() === "empty"}>empty</Show>
          <Show when={status() === "missing"}>format not registered</Show>
        </span>
        <Show when={status() === "incomplete" || status() === "empty"}>
          <span class="es-mask-hint">
            next:{" "}
            <Show
              when={nextChars().length > 0}
              fallback={<span class="es-muted">(no valid chars)</span>}
            >
              <code>
                {nextChars()
                  .map((c) => (c === " " ? "␠" : c))
                  .join(" ")}
              </code>
            </Show>
          </span>
        </Show>
      </div>
    </div>
  );
}
