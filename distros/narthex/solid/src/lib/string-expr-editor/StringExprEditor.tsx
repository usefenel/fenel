// ---------------------------------------------------------------------------
// StringExprEditor — edit a Fenel Expression that evaluates to a string
//
// Most common uses:
//   - email subject:               "Re: order " ++ order.id
//   - email plaintext-body line:   "Hi " ++ recipient.firstName ++ ","
//   - text node value inside Markup template body
//
// Decomposes the expression into chunks where possible:
//   literal       → plain text input
//   { var: ... }  → typed-ref chip
//   { cat: [...] } / { call: ["concat", ...] } → row of chunks
//   anything else → inline FenelCode editor (fallback)
//
// Round-trips: parsing concat-shaped expressions back from chunk edits.
// Param refs are picked from a typed param list passed in by the surrounding
// FunctionSpecEditor; the picker shows name + type.
// ---------------------------------------------------------------------------

import { Show, For, createSignal, createMemo } from "solid-js";
import type { Expression, FieldDef } from "@fenel/engine/types";
import { InlineCodeEditor } from "~/lib/function-editor/FenelCodeEditor";
import "./string-expr-editor.css";

export type StringExprEditorProps = {
  /** Current value: an Expression that evaluates to a string. */
  value: Expression | string | undefined;
  onChange: (next: Expression | string) => void;
  /** Available typed params for the var-ref picker. */
  params?: FieldDef[];
  /** Placeholder for empty literal-only state. */
  placeholder?: string;
};

// ---------------------------------------------------------------------------
// Chunk model — internal flat representation of a string-typed expression
// ---------------------------------------------------------------------------

type Chunk =
  | { kind: "lit"; text: string }
  | { kind: "ref"; path: string };

/**
 * Try to decompose `value` into a flat list of literal/ref chunks.
 * Returns null if the shape isn't recognized (caller falls back to code editor).
 */
function decompose(value: unknown): Chunk[] | null {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return value === "" ? [] : [{ kind: "lit", text: value }];
  if (typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  // { var: "path" } or { var: ["path", default] }
  if ("var" in v) {
    const arg = (v as { var: unknown }).var;
    const path = typeof arg === "string"
      ? arg
      : Array.isArray(arg) && typeof arg[0] === "string" ? arg[0] : null;
    return path ? [{ kind: "ref", path }] : null;
  }

  // String concatenation — we recognize { cat: [...] } and { call: ["concat", ...] }.
  const concatArgs = extractConcatArgs(v);
  if (concatArgs) {
    const chunks: Chunk[] = [];
    for (const a of concatArgs) {
      const sub = decompose(a);
      if (!sub) return null;
      chunks.push(...sub);
    }
    return mergeAdjacentLiterals(chunks);
  }

  return null;
}

function extractConcatArgs(v: Record<string, unknown>): unknown[] | null {
  if ("cat" in v && Array.isArray(v.cat)) return v.cat;
  if ("concat" in v && Array.isArray(v.concat)) return v.concat;
  if ("call" in v && Array.isArray(v.call) && v.call[0] === "concat") return v.call.slice(1);
  return null;
}

function mergeAdjacentLiterals(chunks: Chunk[]): Chunk[] {
  const out: Chunk[] = [];
  for (const c of chunks) {
    const prev = out[out.length - 1];
    if (c.kind === "lit" && prev && prev.kind === "lit") {
      prev.text = prev.text + c.text;
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

/** Build a value (Expression | string) from chunks. */
function compose(chunks: Chunk[]): Expression | string {
  const merged = mergeAdjacentLiterals(chunks);
  if (merged.length === 0) return "";
  if (merged.length === 1) {
    const c = merged[0]!;
    return c.kind === "lit" ? c.text : { var: c.path };
  }
  // Multi-chunk → concat call. Use `cat` op (engine convention) for brevity.
  const args = merged.map<Expression | string>((c) =>
    c.kind === "lit" ? c.text : { var: c.path },
  );
  return { cat: args } as unknown as Expression;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StringExprEditor(props: StringExprEditorProps) {
  const [showPicker, setShowPicker] = createSignal<number | null>(null);

  const chunks = createMemo<Chunk[] | null>(() => decompose(props.value));

  function setChunks(next: Chunk[]) {
    props.onChange(compose(next));
  }

  function setLit(i: number, text: string) {
    const cs = chunks();
    if (!cs) return;
    const next = cs.slice();
    next[i] = { kind: "lit", text };
    setChunks(next);
  }

  function setRef(i: number, path: string) {
    const cs = chunks();
    if (!cs) return;
    const next = cs.slice();
    next[i] = { kind: "ref", path };
    setChunks(next);
  }

  function removeAt(i: number) {
    const cs = chunks();
    if (!cs) return;
    const next = cs.slice();
    next.splice(i, 1);
    setChunks(next);
  }

  function appendLit() {
    const cs = chunks() ?? [];
    setChunks([...cs, { kind: "lit", text: "" }]);
  }

  function insertRefAt(i: number, path: string) {
    const cs = chunks() ?? [];
    const next = cs.slice();
    next.splice(i, 0, { kind: "ref", path });
    setChunks(next);
    setShowPicker(null);
  }

  function paramTypeOf(path: string): string {
    const top = path.split(".")[0];
    const p = (props.params ?? []).find((q) => q.name === top);
    if (!p?.type) return "?";
    if ("$ref" in p.type) return p.type.$ref;
    return Object.keys(p.type)[0] ?? "?";
  }

  return (
    <div class="se-root">
      <Show
        when={chunks() !== null}
        fallback={
          <div class="se-fallback">
            <div class="se-fallback-label">Expression (Fenel code)</div>
            <InlineCodeEditor
              value={typeof props.value === "string" ? props.value : JSON.stringify(props.value)}
              onChange={(text) => {
                try { props.onChange(JSON.parse(text)); }
                catch { props.onChange(text); }
              }}
              placeholder={props.placeholder}
            />
          </div>
        }
      >
        <div class="se-chunks">
          <For each={chunks()!}>
            {(c, i) => (
              <>
                <InsertButton
                  onClickRef={() => setShowPicker(i())}
                  isOpen={showPicker() === i()}
                  params={props.params ?? []}
                  onPick={(path) => insertRefAt(i(), path)}
                  onClose={() => setShowPicker(null)}
                />
                <Show when={c.kind === "lit"}>
                  <input
                    class="se-lit"
                    type="text"
                    value={(c as Extract<Chunk, { kind: "lit" }>).text}
                    placeholder={i() === 0 ? props.placeholder : ""}
                    onInput={(e) => setLit(i(), e.currentTarget.value)}
                  />
                </Show>
                <Show when={c.kind === "ref"}>
                  <span
                    class="se-ref"
                    data-tooltip={`${(c as Extract<Chunk, { kind: "ref" }>).path} : ${paramTypeOf((c as Extract<Chunk, { kind: "ref" }>).path)}`}
                  >
                    <span class="se-ref-icon">@</span>
                    <input
                      class="se-ref-path"
                      type="text"
                      value={(c as Extract<Chunk, { kind: "ref" }>).path}
                      onInput={(e) => setRef(i(), e.currentTarget.value)}
                    />
                    <span class="se-ref-type">: {paramTypeOf((c as Extract<Chunk, { kind: "ref" }>).path)}</span>
                    <button
                      type="button"
                      class="se-chunk-remove"
                      onClick={() => removeAt(i())}
                      data-tooltip="Remove"
                    >×</button>
                  </span>
                </Show>
              </>
            )}
          </For>
          {/* Trailing insert position */}
          <InsertButton
            onClickRef={() => setShowPicker(chunks()!.length)}
            isOpen={showPicker() === chunks()!.length}
            params={props.params ?? []}
            onPick={(path) => insertRefAt(chunks()!.length, path)}
            onClose={() => setShowPicker(null)}
          />
          <Show when={(chunks()?.length ?? 0) === 0}>
            <button type="button" class="se-add-text" onClick={appendLit}>
              + text
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InsertButton — small "+ ref" affordance, opens a typed-param picker
// ---------------------------------------------------------------------------

function InsertButton(props: {
  onClickRef: () => void;
  isOpen: boolean;
  params: FieldDef[];
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = createSignal("");

  // Expand each top-level param into pickable paths. For records, list one
  // entry per field; for scalars, just the name.
  const options = createMemo(() => {
    const out: Array<{ path: string; type: string }> = [];
    for (const p of props.params) {
      const t = p.type;
      if (!t) {
        out.push({ path: p.name, type: "?" });
        continue;
      }
      if ("$record" in t) {
        out.push({ path: p.name, type: "record" });
        for (const sub of t.$record.fields) {
          const subTag = "$ref" in sub.type ? sub.type.$ref : Object.keys(sub.type)[0] ?? "?";
          out.push({ path: `${p.name}.${sub.name}`, type: subTag });
        }
      } else {
        const tag = "$ref" in t ? t.$ref : Object.keys(t)[0] ?? "?";
        out.push({ path: p.name, type: tag });
      }
    }
    const q = search().toLowerCase();
    return q ? out.filter((o) => o.path.toLowerCase().includes(q)) : out;
  });

  return (
    <span class="se-insert">
      <button
        type="button"
        class="se-insert-btn"
        onClick={props.onClickRef}
        data-tooltip="Insert ref"
      >+</button>
      <Show when={props.isOpen}>
        <div class="se-picker" onClick={(e) => e.stopPropagation()}>
          <input
            class="se-picker-search"
            type="text"
            placeholder="param.path…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            autofocus
          />
          <div class="se-picker-list">
            <Show
              when={options().length > 0}
              fallback={<div class="se-picker-empty">No params</div>}
            >
              <For each={options()}>
                {(o) => (
                  <button
                    type="button"
                    class="se-picker-item"
                    onClick={() => props.onPick(o.path)}
                  >
                    <span class="se-picker-path">{o.path}</span>
                    <span class="se-picker-type">: {o.type}</span>
                  </button>
                )}
              </For>
              {/* Free-form path entry */}
              <Show when={search() && !options().some((o) => o.path === search())}>
                <button
                  type="button"
                  class="se-picker-item se-picker-item--custom"
                  onClick={() => props.onPick(search())}
                >
                  Use "{search()}"
                </button>
              </Show>
            </Show>
          </div>
          <button
            type="button"
            class="se-picker-close"
            onClick={props.onClose}
          >Cancel</button>
        </div>
      </Show>
    </span>
  );
}
