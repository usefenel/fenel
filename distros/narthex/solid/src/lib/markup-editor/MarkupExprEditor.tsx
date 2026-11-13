// ---------------------------------------------------------------------------
// MarkupExprEditor — visual editor for Expression-evaluating-to-Markup
//
// Markup is pure data; templating happens at the function level. The body of
// a Markup-returning function is an Expression that, when evaluated against
// the function's params, produces a pure MarkupValue. This editor surfaces
// that Expression visually:
//
//   call("element", tag, attrs, children) → block, recurse on children
//   call("text", value)                    → text block; value uses StringExprEditor
//   anything else                          → opaque, fall back to FenelCodeEditor
//
// Attr values + text values are themselves string-typed expressions, so they
// hand off to StringExprEditor (literal | var-chip | code-fallback).
//
// Modes: visual / code (FenelCodeEditor over the whole expression) / split.
// ---------------------------------------------------------------------------

import { Show, For, createSignal, createMemo } from "solid-js";
import { Dynamic } from "@solidjs/web";
import { browserPreviewElement } from "./browser-preview";
import type { Expression, FieldDef } from "@fenel/engine/types";
import { MARKUP_SUBSETS } from "@fenel/engine/markup";
import {
  shapeOf,
  elementExpr,
  textExpr,
  collectLiteralTags,
  type AttrExpr,
  type ExprOrLit,
} from "./expr-shape";
import {
  type Path,
  getAtPath,
  setAtPath,
  insertAtIndex,
  removeAtIndex,
} from "~/lib/variant-value";
import { StringExprEditor } from "~/lib/string-expr-editor";
import { InlineCodeEditor } from "~/lib/function-editor/FenelCodeEditor";
import "./markup-editor.css";

export type ExprViewMode = "visual" | "code" | "split";

export type MarkupExprEditorProps = {
  /** Current value: an Expression evaluating to Markup. */
  value: Expression;
  onChange: (next: Expression) => void;
  /** Function params in scope (for var-ref pickers). */
  params?: FieldDef[];
  /** Initial layout (default: "split"). */
  initialMode?: ExprViewMode;
  /** Optional target subset (e.g. "markup:html-email:universal"). */
  targetSubset?: string;
};

export function MarkupExprEditor(props: MarkupExprEditorProps) {
  const [mode, setMode] = createSignal<ExprViewMode>(props.initialMode ?? "split");
  const [selectedPath, setSelectedPath] = createSignal<Path>([]);

  // Path navigation operates on the raw JSON Logic structure. To make the
  // editor's life sane, child paths within an element's children list are
  // ["call", 3, idx, ...] in raw form. Helpers below abstract that.
  function elementChildrenPath(elementPath: Path): Path {
    return [...elementPath, "call", 3];
  }
  function isElementAt(path: Path): boolean {
    const v = getAtPath(props.value, path);
    return shapeOf(v).kind === "element";
  }

  function insertChild(template: Expression) {
    const sel = selectedPath();
    if (!isElementAt(sel)) return;
    const childrenPath = elementChildrenPath(sel);
    const cur = (getAtPath(props.value, childrenPath) as Expression[] | undefined) ?? [];
    const next = insertAtIndex(props.value, childrenPath, template, cur.length);
    props.onChange(next as Expression);
    setSelectedPath([...childrenPath, cur.length]);
  }

  function deleteSelected() {
    const sel = selectedPath();
    if (sel.length === 0) return;
    const lastIdx = sel[sel.length - 1];
    if (typeof lastIdx !== "number") return;
    const listPath = sel.slice(0, -1);
    const next = removeAtIndex(props.value, listPath, lastIdx);
    props.onChange(next as Expression);
    setSelectedPath(listPath.slice(0, -2)); // pop the parent's "call"+3
  }

  function setAt(path: Path, next: unknown) {
    if (path.length === 0) {
      props.onChange(next as Expression);
    } else {
      props.onChange(setAtPath(props.value, path, next) as Expression);
    }
  }

  return (
    <div class="me-root">
      <div class="me-toolbar">
        <div class="me-mode-switch">
          <button type="button"
            class={["me-mode-btn", { "me-mode-btn--active": !!(mode() === "visual") }]}
            onClick={() => setMode("visual")}>Visual</button>
          <button type="button"
            class={["me-mode-btn", { "me-mode-btn--active": !!(mode() === "code") }]}
            onClick={() => setMode("code")}>Code</button>
          <button type="button"
            class={["me-mode-btn", { "me-mode-btn--active": !!(mode() === "split") }]}
            onClick={() => setMode("split")}>Side-by-side</button>
        </div>
        <CompatibilityBadge expr={props.value} subset={props.targetSubset} />
      </div>

      <div

        class={["me-body", {
          "me-body--split":  mode() === "split",
          "me-body--visual": mode() === "visual",
          "me-body--generic": mode() === "code",
        }]}
      >
        <Show when={mode() === "visual" || mode() === "split"}>
          <div class="me-pane me-pane--visual">
            <Palette
              onPick={insertChild}
              disabled={!isElementAt(selectedPath())}
            />
            <div class="me-canvas" onClick={() => setSelectedPath([])}>
              <VisualNode
                expr={props.value}
                path={[]}
                selectedPath={selectedPath()}
                onSelect={setSelectedPath}
              />
            </div>
            <Inspector
              value={props.value}
              path={selectedPath()}
              params={props.params ?? []}
              onSetAt={setAt}
              onDelete={deleteSelected}
              canDelete={selectedPath().length > 0}
            />
          </div>
        </Show>
        <Show when={mode() === "code" || mode() === "split"}>
          <div class="me-pane me-pane--generic">
            <CodePane value={props.value} onChange={props.onChange} />
          </div>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VisualNode — renders an Expression as the markup it constructs
// ---------------------------------------------------------------------------

function VisualNode(props: {
  expr: unknown;
  path: Path;
  selectedPath: Path;
  onSelect: (p: Path) => void;
}) {
  const shape = createMemo(() => shapeOf(props.expr));
  const isSelected = () => pathEquals(props.path, props.selectedPath);

  return (
    <Show when={shape().kind === "element"} fallback={
      <Show when={shape().kind === "text"} fallback={
        <OpaqueNode
          path={props.path}
          isSelected={isSelected()}
          onSelect={props.onSelect}
        />
      }>
        <TextVisual
          value={(shape() as Extract<ReturnType<typeof shapeOf>, { kind: "text" }>).value}
          path={props.path}
          isSelected={isSelected()}
          onSelect={props.onSelect}
        />
      </Show>
    }>
      <ElementVisual
        elementShape={shape() as Extract<ReturnType<typeof shapeOf>, { kind: "element" }>}
        path={props.path}
        selectedPath={props.selectedPath}
        isSelected={isSelected()}
        onSelect={props.onSelect}
      />
    </Show>
  );
}

function ElementVisual(props: {
  elementShape: Extract<ReturnType<typeof shapeOf>, { kind: "element" }>;
  path: Path;
  selectedPath: Path;
  isSelected: boolean;
  onSelect: (p: Path) => void;
}) {
  // Best-effort attrs — only literal string values are passed to the Dynamic
  // host element. Computed attrs render visually as "?" placeholders only in
  // the inspector; the canvas just shows the literal-string ones.
  const preview = createMemo(() => browserPreviewElement(props.elementShape.tag, props.elementShape.attrs));

  return (
    <Dynamic
      {...preview().attrs}
      component={preview().tag}
      class={`${preview().attrs.class ?? ""} me-node me-node--element ${props.isSelected ? "me-node--selected" : ""}`}
      onClick={(e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); props.onSelect(props.path); }}
      onSubmit={(e: SubmitEvent) => e.preventDefault()}
      onAuxClick={(e: MouseEvent) => e.preventDefault()}
    >
      <Show
        when={props.elementShape.children.length > 0}
        fallback={isVoidTag(preview().tag) ? null : <span class="me-empty">∅ empty</span>}
      >
        <For each={props.elementShape.children}>
          {(child, i) => (
            <VisualNode
              expr={child}
              path={[...props.path, "call", 3, i()]}
              selectedPath={props.selectedPath}
              onSelect={props.onSelect}
            />
          )}
        </For>
      </Show>
    </Dynamic>
  );
}

function TextVisual(props: {
  value: ExprOrLit;
  path: Path;
  isSelected: boolean;
  onSelect: (p: Path) => void;
}) {
  return (
    <span

      class={["me-node me-node--text", { "me-node--selected": !!(props.isSelected) }]}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onSelect(props.path); }}
    >
      <Show
        when={typeof props.value === "string" && props.value !== ""}
        fallback={
          <Show when={typeof props.value === "string"} fallback={<span class="me-ref-inline">{exprPreview(props.value)}</span>}>
            <span class="me-empty">∅ empty text</span>
          </Show>
        }
      >
        {props.value as string}
      </Show>
    </span>
  );
}

function OpaqueNode(props: {
  path: Path;
  isSelected: boolean;
  onSelect: (p: Path) => void;
}) {
  return (
    <span

      class={["me-node me-node--opaque", { "me-node--selected": !!(props.isSelected) }]}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onSelect(props.path); }}
      data-tooltip="Opaque expression — edit in the inspector or code pane"
    >⟨expr⟩</span>
  );
}

function exprPreview(e: unknown): string {
  if (e && typeof e === "object" && "var" in e) {
    const v = (e as { var: unknown }).var;
    if (typeof v === "string") return `@${v}`;
    if (Array.isArray(v) && typeof v[0] === "string") return `@${v[0]}`;
  }
  return "⟨expr⟩";
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const PALETTE: Array<{ label: string; build: () => Expression }> = [
  { label: "Paragraph", build: () => elementExpr("p", [], [textExpr("New paragraph.")]) },
  { label: "Heading",   build: () => elementExpr("h2", [], [textExpr("Heading")]) },
  { label: "Link",      build: () => elementExpr("a", [{ key: "href", value: "https://example.com" }], [textExpr("link text")]) },
  { label: "Image",     build: () => elementExpr("img", [{ key: "src", value: "https://placehold.co/400x200" }, { key: "alt", value: "" }], []) },
  { label: "Divider",   build: () => elementExpr("hr", [], []) },
  { label: "List",      build: () => elementExpr("ul", [], [elementExpr("li", [], [textExpr("item")])]) },
  { label: "Container", build: () => elementExpr("div", [], [textExpr("…")]) },
  { label: "Text",      build: () => textExpr("text") },
];

function Palette(props: { onPick: (v: Expression) => void; disabled: boolean }) {
  return (
    <div class="me-palette">
      <For each={PALETTE}>
        {(item) => (
          <button
            type="button"
            class="me-palette-btn"
            disabled={props.disabled}
            onClick={() => props.onPick(item.build())}
            data-tooltip={props.disabled ? "Select an Element first" : `Insert ${item.label}`}
          >+ {item.label}</button>
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function Inspector(props: {
  value: Expression;
  path: Path;
  params: FieldDef[];
  onSetAt: (path: Path, next: unknown) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const subValue = createMemo(() => getAtPath(props.value, props.path));
  const subShape = createMemo(() => shapeOf(subValue()));

  return (
    <div class="me-inspector">
      <Show
        when={subValue() !== undefined}
        fallback={<div class="me-inspector-empty">Click a node to inspect</div>}
      >
        <Show when={subShape().kind === "element"}>
          <ElementInspector
            shape={subShape() as Extract<ReturnType<typeof shapeOf>, { kind: "element" }>}
            path={props.path}
            params={props.params}
            onSetAt={props.onSetAt}
            onDelete={props.onDelete}
            canDelete={props.canDelete}
          />
        </Show>
        <Show when={subShape().kind === "text"}>
          <TextInspector
            value={(subShape() as Extract<ReturnType<typeof shapeOf>, { kind: "text" }>).value}
            path={props.path}
            params={props.params}
            onSetAt={props.onSetAt}
            onDelete={props.onDelete}
            canDelete={props.canDelete}
          />
        </Show>
        <Show when={subShape().kind === "opaque"}>
          <OpaqueInspector
            value={subValue() as Expression}
            path={props.path}
            onSetAt={props.onSetAt}
            onDelete={props.onDelete}
            canDelete={props.canDelete}
          />
        </Show>
      </Show>
    </div>
  );
}

function ElementInspector(props: {
  shape: Extract<ReturnType<typeof shapeOf>, { kind: "element" }>;
  path: Path;
  params: FieldDef[];
  onSetAt: (path: Path, next: unknown) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  // tag is ["call", 1] off the element call
  const tagPath = () => [...props.path, "call", 1];
  const attrsPath = () => [...props.path, "call", 2];

  function setTag(tag: string) {
    props.onSetAt(tagPath(), tag);
  }

  function setAttr(i: number, next: AttrExpr) {
    // attrs are stored as [{call: ["attr", k, v]}, ...]
    const newCall: Expression = { call: ["attr", next.key as Expression, next.value as Expression] } as unknown as Expression;
    props.onSetAt([...attrsPath(), i], newCall);
  }

  function addAttr() {
    const cur = (getAtPath(props.shape, []) as { attrs: AttrExpr[] }).attrs;
    const idx = cur.length;
    const newCall: Expression = { call: ["attr", "", ""] } as unknown as Expression;
    props.onSetAt([...attrsPath(), idx], newCall);
  }

  function removeAttr(i: number) {
    const cur = (getAtPath(props.shape, []) as { attrs: AttrExpr[] }).attrs.slice();
    cur.splice(i, 1);
    // Re-encode all attrs as constructor calls and overwrite
    const re = cur.map((a) => ({ call: ["attr", a.key, a.value] }));
    props.onSetAt(attrsPath(), re);
  }

  return (
    <div class="me-inspector-body">
      <div class="me-inspector-row">
        <label class="me-inspector-label">tag</label>
        <input
          class="me-inspector-input"
          value={typeof props.shape.tag === "string" ? props.shape.tag : ""}
          onInput={(e) => setTag(e.currentTarget.value)}
          placeholder={typeof props.shape.tag !== "string" ? "(computed tag)" : ""}
        />
      </div>
      <div class="me-inspector-section">
        <div class="me-inspector-section-header">
          <span>attrs</span>
          <button type="button" class="me-inspector-btn-add" onClick={addAttr}>+ attr</button>
        </div>
        <For each={props.shape.attrs}>
          {(a, i) => (
            <div class="me-inspector-attr">
              <input
                class="me-inspector-input me-inspector-input--key"
                placeholder="key"
                value={typeof a.key === "string" ? a.key : ""}
                onInput={(e) => setAttr(i(), { key: e.currentTarget.value, value: a.value })}
              />
              <div class="me-inspector-attr-value">
                <StringExprEditor
                  value={a.value as Expression | string | undefined}
                  onChange={(v) => setAttr(i(), { key: a.key, value: v })}
                  params={props.params}
                  placeholder="value"
                />
              </div>
              <button
                type="button"
                class="me-inspector-btn-remove"
                onClick={() => removeAttr(i())}
                data-tooltip="Remove"
              >×</button>
            </div>
          )}
        </For>
      </div>
      <div class="me-inspector-actions">
        <button
          type="button"
          class="me-inspector-btn-danger"
          disabled={!props.canDelete}
          onClick={props.onDelete}
        >Delete node</button>
      </div>
    </div>
  );
}

function TextInspector(props: {
  value: ExprOrLit;
  path: Path;
  params: FieldDef[];
  onSetAt: (path: Path, next: unknown) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  // value is at ["call", 1] of the text call
  const valuePath = () => [...props.path, "call", 1];

  return (
    <div class="me-inspector-body">
      <div class="me-inspector-row me-inspector-row--column">
        <label class="me-inspector-label">text</label>
        <StringExprEditor
          value={props.value as Expression | string | undefined}
          onChange={(v) => props.onSetAt(valuePath(), v)}
          params={props.params}
          placeholder="text content (use + to insert refs)"
        />
      </div>
      <div class="me-inspector-actions">
        <button
          type="button"
          class="me-inspector-btn-danger"
          disabled={!props.canDelete}
          onClick={props.onDelete}
        >Delete node</button>
      </div>
    </div>
  );
}

function OpaqueInspector(props: {
  value: Expression;
  path: Path;
  onSetAt: (path: Path, next: unknown) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  return (
    <div class="me-inspector-body">
      <div class="me-inspector-row me-inspector-row--column">
        <label class="me-inspector-label">expression</label>
        <InlineCodeEditor
          value={JSON.stringify(props.value)}
          onChange={(text) => {
            try { props.onSetAt(props.path, JSON.parse(text)); }
            catch { /* keep typing */ }
          }}
          placeholder="Fenel expression"
        />
      </div>
      <div class="me-inspector-actions">
        <button
          type="button"
          class="me-inspector-btn-danger"
          disabled={!props.canDelete}
          onClick={props.onDelete}
        >Delete node</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CodePane — full-expression code editor (FenelCodeEditor variant)
// ---------------------------------------------------------------------------

function CodePane(props: { value: Expression; onChange: (next: Expression) => void }) {
  const text = createMemo(() => JSON.stringify(props.value, null, 2));
  return (
    <div class="me-code">
      <textarea
        class="me-code-textarea"
        value={text()}
        spellcheck={false}
        onInput={(e) => {
          try {
            const parsed = JSON.parse(e.currentTarget.value);
            props.onChange(parsed);
          } catch { /* swallow until valid */ }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compatibility badge — works on literal tags only
// ---------------------------------------------------------------------------

function CompatibilityBadge(props: { expr: Expression; subset?: string }) {
  const tags = createMemo(() => collectLiteralTags(props.expr));
  const compatible = createMemo(() => {
    const out: string[] = [];
    for (const [name, allowed] of Object.entries(MARKUP_SUBSETS)) {
      let ok = true;
      for (const t of tags()) if (!allowed.has(t)) { ok = false; break; }
      if (ok) out.push(name);
    }
    return out;
  });
  const offending = createMemo(() => {
    if (!props.subset) return [];
    const allowed = MARKUP_SUBSETS[props.subset];
    if (!allowed) return [];
    const out: string[] = [];
    for (const t of tags()) if (!allowed.has(t)) out.push(t);
    return out;
  });

  return (
    <div class="me-compat">
      <Show when={props.subset}>
        <Show
          when={offending().length === 0}
          fallback={
            <span class="me-compat-bad" data-tooltip={`Tags not allowed in ${props.subset}: ${offending().join(", ")}`}>
              ✗ {props.subset} ({offending().length} offending)
            </span>
          }
        >
          <span class="me-compat-ok">✓ {props.subset}</span>
        </Show>
      </Show>
      <Show when={compatible().length > 0}>
        <span class="me-compat-fade" data-tooltip={"Compatible with: " + compatible().join(", ")}>
          renders to: {compatible().length} target{compatible().length === 1 ? "" : "s"}
        </span>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pathEquals(a: Path, b: Path): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function isVoidTag(tag: string): boolean {
  return VOID_TAGS.has(tag.toLowerCase());
}
