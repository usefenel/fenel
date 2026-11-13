// ---------------------------------------------------------------------------
// MarkupEditor — visual + generic editor for Markup values
//
// Two views over the same underlying Markup AST:
//   visual   — WYSIWYG: rendered HTML with click-to-select, plus an inspector
//              for the selected node's tag/attrs/children
//   generic  — VariantValueEditor against the Markup FenelType
//   split    — both panes side-by-side, sharing selection
//
// Both views drive the same mutation ops (from variant-value/ops). Selecting
// a node in one view highlights it in the other.
// ---------------------------------------------------------------------------

import { Show, For, createSignal, createMemo } from "solid-js";
import { Dynamic } from "@solidjs/web";
import { browserPreviewElement } from "./browser-preview";
import {
  Markup,
  type MarkupValue,
  text as makeText,
  elem as makeElem,
  compatibleSubsets,
  offendingTags,
} from "@fenel/engine/markup";
import {
  VariantValueEditor,
  type Path,
  getAtPath,
  setAtPath,
  insertAtIndex,
  removeAtIndex,
} from "~/lib/variant-value";
import "./markup-editor.css";

export type ViewMode = "visual" | "generic" | "split";

export type MarkupEditorProps = {
  value: MarkupValue;
  onChange: (next: MarkupValue) => void;
  /** Initial layout (default: "split"). */
  initialMode?: ViewMode;
  /**
   * Optional target subset name (e.g. "markup:html-email:universal"). Drives
   * the compatibility badge and offending-tag warnings.
   */
  targetSubset?: string;
};

export function MarkupEditor(props: MarkupEditorProps) {
  const [mode, setMode] = createSignal<ViewMode>(props.initialMode ?? "split");
  const [selectedPath, setSelectedPath] = createSignal<Path>([]);

  function updateAtSelection(updater: (cur: MarkupValue) => MarkupValue) {
    const cur = getAtPath(props.value, selectedPath()) as MarkupValue | undefined;
    if (!cur) return;
    const next = updater(cur);
    if (selectedPath().length === 0) {
      props.onChange(next);
    } else {
      props.onChange(setAtPath(props.value, selectedPath(), next));
    }
  }

  function insertChild(template: MarkupValue) {
    const sel = getAtPath(props.value, selectedPath()) as MarkupValue | undefined;
    if (!sel || sel.$tag !== "Element") return;
    const childrenPath: Path = [...selectedPath(), "children"];
    const next = insertAtIndex(props.value, childrenPath, template);
    props.onChange(next);
    // Select the newly inserted child
    setSelectedPath([...childrenPath, sel.children.length]);
  }

  function deleteSelected() {
    if (selectedPath().length === 0) return; // never delete root
    const parentPath = selectedPath().slice(0, -2);
    const lastIdx = selectedPath()[selectedPath().length - 1];
    if (typeof lastIdx !== "number") return;
    const childrenPath = selectedPath().slice(0, -1);
    const next = removeAtIndex(props.value, childrenPath, lastIdx);
    props.onChange(next);
    setSelectedPath(parentPath);
  }

  return (
    <div class="me-root">
      <div class="me-toolbar">
        <div class="me-mode-switch">
          <button
            type="button"

            class={["me-mode-btn", { "me-mode-btn--active": !!(mode() === "visual") }]}
            onClick={() => setMode("visual")}
          >Visual</button>
          <button
            type="button"

            class={["me-mode-btn", { "me-mode-btn--active": !!(mode() === "generic") }]}
            onClick={() => setMode("generic")}
          >Generic</button>
          <button
            type="button"

            class={["me-mode-btn", { "me-mode-btn--active": !!(mode() === "split") }]}
            onClick={() => setMode("split")}
          >Side-by-side</button>
        </div>
        <CompatibilityBadge value={props.value} subset={props.targetSubset} />
      </div>

      <div

        class={["me-body", {
          "me-body--split":   mode() === "split",
          "me-body--visual":  mode() === "visual",
          "me-body--generic": mode() === "generic",
        }]}
      >
        <Show when={mode() === "visual" || mode() === "split"}>
          <div class="me-pane me-pane--visual">
            <Palette
              onPick={insertChild}
              disabled={!isElementAtPath(props.value, selectedPath())}
            />
            <div
              class="me-canvas"
              onClick={() => setSelectedPath([])}
            >
              <VisualNode
                node={props.value}
                path={[]}
                selectedPath={selectedPath()}
                onSelect={setSelectedPath}
              />
            </div>
            <Inspector
              value={props.value}
              path={selectedPath()}
              onUpdate={updateAtSelection}
              onDelete={deleteSelected}
              canDelete={selectedPath().length > 0}
            />
          </div>
        </Show>
        <Show when={mode() === "generic" || mode() === "split"}>
          <div class="me-pane me-pane--generic">
            <VariantValueEditor
              type={Markup}
              value={props.value}
              onChange={(v) => props.onChange(v as MarkupValue)}
              selectedPath={selectedPath()}
              onSelectPath={setSelectedPath}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VisualNode — render a Markup value as actual HTML, click to select
// ---------------------------------------------------------------------------

function VisualNode(props: {
  node: MarkupValue;
  path: Path;
  selectedPath: Path;
  onSelect: (path: Path) => void;
}) {
  const isSelected = () => pathEquals(props.path, props.selectedPath);

  return (
    <Show when={props.node.$tag === "Element"} fallback={
      <span

        class={["me-node me-node--text", { "me-node--selected": !!(isSelected()) }]}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onSelect(props.path); }}
      >
        <Show when={(props.node as Extract<MarkupValue, { $tag: "Text" }>).value} fallback={<span class="me-empty">∅ empty text</span>}>
          {(props.node as Extract<MarkupValue, { $tag: "Text" }>).value}
        </Show>
      </span>
    }>
      <ElementVisual node={props.node as Extract<MarkupValue, { $tag: "Element" }>}
        path={props.path} selectedPath={props.selectedPath} onSelect={props.onSelect} />
    </Show>
  );
}

function ElementVisual(props: {
  node: Extract<MarkupValue, { $tag: "Element" }>;
  path: Path;
  selectedPath: Path;
  onSelect: (path: Path) => void;
}) {
  const isSelected = () => pathEquals(props.path, props.selectedPath);

  const node = () => props.node as Extract<MarkupValue, { $tag: "Element" }>;
  const preview = createMemo(() => browserPreviewElement(node().tag, node().attrs));

  return (
    <Dynamic
      {...preview().attrs}
      component={preview().tag}
      class={`${preview().attrs.class ?? ""} me-node me-node--element ${isSelected() ? "me-node--selected" : ""}`}
      onClick={(e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); props.onSelect(props.path); }}
      onSubmit={(e: SubmitEvent) => e.preventDefault()}
      onAuxClick={(e: MouseEvent) => e.preventDefault()}
    >
      <Show
        when={node().children.length > 0}
        fallback={isVoidTag(preview().tag) ? null : <span class="me-empty">∅ empty</span>}
      >
        <For each={node().children}>
          {(child, i) => (
            <VisualNode
              node={child}
              path={[...props.path, "children", i()]}
              selectedPath={props.selectedPath}
              onSelect={props.onSelect}
            />
          )}
        </For>
      </Show>
    </Dynamic>
  );
}

// ---------------------------------------------------------------------------
// Palette — preset blocks the user can insert
// ---------------------------------------------------------------------------

const PALETTE: Array<{ label: string; build: () => MarkupValue }> = [
  { label: "Paragraph",  build: () => makeElem("p",  {}, [makeText("New paragraph.")]) },
  { label: "Heading",    build: () => makeElem("h2", {}, [makeText("Heading")]) },
  { label: "Link",       build: () => makeElem("a",  { href: "https://example.com" }, [makeText("link text")]) },
  { label: "Image",      build: () => makeElem("img", { src: "https://placehold.co/400x200", alt: "" }, []) },
  { label: "Divider",    build: () => makeElem("hr", {}, []) },
  { label: "List",       build: () => makeElem("ul", {}, [makeElem("li", {}, [makeText("item")])]) },
  { label: "Container",  build: () => makeElem("div", {}, [makeText("…")]) },
  { label: "Text",       build: () => makeText("text") },
];

function Palette(props: { onPick: (v: MarkupValue) => void; disabled: boolean }) {
  return (
    <div class="me-palette">
      <For each={PALETTE}>
        {(item) => (
          <button
            type="button"
            class="me-palette-btn"
            disabled={props.disabled}
            onClick={() => props.onPick(item.build())}
            data-tooltip={props.disabled ? "Select an Element node first" : `Insert ${item.label}`}
          >
            + {item.label}
          </button>
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector — properties panel for the selected node
// ---------------------------------------------------------------------------

function Inspector(props: {
  value: MarkupValue;
  path: Path;
  onUpdate: (updater: (cur: MarkupValue) => MarkupValue) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const selected = createMemo(() => getAtPath(props.value, props.path) as MarkupValue | undefined);

  return (
    <div class="me-inspector">
      <Show when={selected()} fallback={<div class="me-inspector-empty">Click a node to inspect</div>}>
        {(s) => (
          <Show
            when={s().$tag === "Element"}
            fallback={
              <TextInspector
                value={s() as Extract<MarkupValue, { $tag: "Text" }>}
                onUpdate={props.onUpdate}
                onDelete={props.onDelete}
                canDelete={props.canDelete}
              />
            }
          >
            <ElementInspector
              value={s() as Extract<MarkupValue, { $tag: "Element" }>}
              onUpdate={props.onUpdate}
              onDelete={props.onDelete}
              canDelete={props.canDelete}
            />
          </Show>
        )}
      </Show>
    </div>
  );
}

function ElementInspector(props: {
  value: Extract<MarkupValue, { $tag: "Element" }>;
  onUpdate: (updater: (cur: MarkupValue) => MarkupValue) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  function setTag(tag: string) {
    props.onUpdate((cur) => cur.$tag === "Element" ? { ...cur, tag } : cur);
  }
  function setAttr(i: number, key: string, value: string) {
    props.onUpdate((cur) => {
      if (cur.$tag !== "Element") return cur;
      const attrs = cur.attrs.slice();
      attrs[i] = { key, value };
      return { ...cur, attrs };
    });
  }
  function addAttr() {
    props.onUpdate((cur) => cur.$tag === "Element"
      ? { ...cur, attrs: [...cur.attrs, { key: "", value: "" }] }
      : cur);
  }
  function removeAttr(i: number) {
    props.onUpdate((cur) => {
      if (cur.$tag !== "Element") return cur;
      const attrs = cur.attrs.slice();
      attrs.splice(i, 1);
      return { ...cur, attrs };
    });
  }

  return (
    <div class="me-inspector-body">
      <div class="me-inspector-row">
        <label class="me-inspector-label">tag</label>
        <input
          class="me-inspector-input"
          value={props.value.tag}
          onInput={(e) => setTag(e.currentTarget.value)}
        />
      </div>
      <div class="me-inspector-section">
        <div class="me-inspector-section-header">
          <span>attrs</span>
          <button type="button" class="me-inspector-btn-add" onClick={addAttr}>+ attr</button>
        </div>
        <For each={props.value.attrs}>
          {(a, i) => (
            <div class="me-inspector-attr">
              <input
                class="me-inspector-input me-inspector-input--key"
                placeholder="key"
                value={a.key}
                onInput={(e) => setAttr(i(), e.currentTarget.value, a.value)}
              />
              <input
                class="me-inspector-input me-inspector-input--value"
                placeholder="value"
                value={a.value}
                onInput={(e) => setAttr(i(), a.key, e.currentTarget.value)}
              />
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
  value: Extract<MarkupValue, { $tag: "Text" }>;
  onUpdate: (updater: (cur: MarkupValue) => MarkupValue) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  function setText(value: string) {
    props.onUpdate((cur) => cur.$tag === "Text" ? { ...cur, value } : cur);
  }
  return (
    <div class="me-inspector-body">
      <div class="me-inspector-row">
        <label class="me-inspector-label">text</label>
        <textarea
          class="me-inspector-textarea"
          rows={3}
          value={props.value.value}
          onInput={(e) => setText(e.currentTarget.value)}
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
// CompatibilityBadge — shows which target subsets accept this tree
// ---------------------------------------------------------------------------

function CompatibilityBadge(props: { value: MarkupValue; subset?: string }) {
  const compatible = createMemo(() => compatibleSubsets(props.value));
  const offending = createMemo(() => props.subset ? offendingTags(props.value, props.subset) : []);

  return (
    <div class="me-compat">
      <Show when={props.subset}>
        <Show
          when={offending().length === 0}
          fallback={
            <span class="me-compat-bad" data-tooltip={`Tags not allowed in ${props.subset}: ${offending().join(", ")}`}>
              ✗ {props.subset} ({offending().length} offending tag{offending().length === 1 ? "" : "s"})
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

function isElementAtPath(root: MarkupValue, path: Path): boolean {
  const v = getAtPath(root, path) as MarkupValue | undefined;
  return v?.$tag === "Element";
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function isVoidTag(tag: string): boolean {
  return VOID_TAGS.has(tag.toLowerCase());
}
