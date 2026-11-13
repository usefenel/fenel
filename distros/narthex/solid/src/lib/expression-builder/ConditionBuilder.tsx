// ---------------------------------------------------------------------------
// ConditionBuilder — generic AND/OR condition tree editor
//
// Domain-agnostic: the caller provides leaf rendering and factory functions.
// Used by the flow editor (BranchLeaf, WaitLeaf) and any other context that
// needs expression building (ref filters, visibility conditions, template rules).
// ---------------------------------------------------------------------------

import { Show, For, createSignal } from "solid-js";
import { IconPlus, IconTrash } from "~/lib/icons";
import { cloneDraftValue } from "~/lib/native-draft";
import { LocusSelect } from "~/lib/locus-select";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TreeDnD = {
  source: () => { path: number[]; condition: any } | null;
  setSource: (v: { path: number[]; condition: any } | null) => void;
  dropTarget: () => { parentPath: number[]; index: number } | null;
  setDropTarget: (v: { parentPath: number[]; index: number } | null) => void;
  performDrop: () => void;
};

export type VariableHint = {
  name: string;
  type?: import("@fenel/engine/types").FenelType;
  label?: string;
  source?: string;
};

export type LeafRenderProps = {
  condition: any;
  onChange: (c: any) => void;
  removable: boolean;
  onRemove?: () => void;
  /** Available variables for autocomplete */
  variables?: VariableHint[];
};

// ---------------------------------------------------------------------------
// Comparison operators — universal defaults
// ---------------------------------------------------------------------------

export const CMP_OPTIONS = [
  { value: "==", label: "equals" },
  { value: "!=", label: "not equals" },
  { value: ">", label: "greater than" },
  { value: "<", label: "less than" },
  { value: ">=", label: "at least" },
  { value: "<=", label: "at most" },
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
  { value: "in", label: "in" },
];

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

export function isDescendantOrSelf(ancestor: number[], path: number[]): boolean {
  if (path.length < ancestor.length) return false;
  return ancestor.every((v, i) => v === path[i]);
}

export function arrEq(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function adjustPathAfterRemoval(target: number[], removedParent: number[], removedIdx: number): number[] {
  if (target.length <= removedParent.length) return target;
  if (!removedParent.every((v, i) => target[i] === v)) return target;
  const d = removedParent.length;
  if (target[d] > removedIdx) { const r = [...target]; r[d]--; return r; }
  return target;
}

export function cleanupGroups(node: any, createBlank: () => any): any {
  if (!node || typeof node !== "object" || (node.op !== "and" && node.op !== "or")) return node;
  const children = node.children.map((c: any) => cleanupGroups(c, createBlank));
  if (children.length === 0) return createBlank();
  if (children.length === 1) return children[0];
  return { ...node, children };
}

// ---------------------------------------------------------------------------
// ConditionBuilder — inline AND/OR tree with pluggable leaf renderer
// ---------------------------------------------------------------------------

export function ConditionBuilder(props: {
  condition: any;
  onChange: (c: any) => void;
  depth: number;
  removable: boolean;
  onRemove?: () => void;
  renderLeaf: (lp: LeafRenderProps) => any;
  createBlank: () => any;
  variables?: VariableHint[];
}) {
  const isGroup = () => props.condition.op === "and" || props.condition.op === "or";

  function toggleGroupOp() {
    props.onChange({ ...props.condition, op: props.condition.op === "and" ? "or" : "and" });
  }

  function addChild() {
    props.onChange({ ...props.condition, children: [...props.condition.children, props.createBlank()] });
  }

  function addNestedGroup(op: "and" | "or") {
    props.onChange({ ...props.condition, children: [...props.condition.children, { op, children: [props.createBlank()] }] });
  }

  function updateChild(index: number, child: any) {
    const children = [...props.condition.children];
    children[index] = child;
    props.onChange({ ...props.condition, children });
  }

  function removeChild(index: number) {
    const children = props.condition.children.filter((_: any, i: number) => i !== index);
    if (children.length === 0) {
      props.onChange(props.createBlank());
    } else if (children.length === 1) {
      props.onChange(children[0]);
    } else {
      props.onChange({ ...props.condition, children });
    }
  }

  return (
    <div class={`fe-cond ${isGroup() ? `fe-cond--group fe-cond--${props.condition.op}` : "fe-cond--leaf"}`}>
      <Show when={!isGroup()}>
        {props.renderLeaf({
          condition: props.condition,
          onChange: props.onChange,
          removable: props.removable,
          onRemove: props.onRemove,
          variables: props.variables,
        })}
      </Show>
      <Show when={isGroup()}>
        <div class="fe-cond-header">
          <button
            class={`fe-cond-group-toggle fe-cond-group-toggle--${props.condition.op}`}
            onClick={toggleGroupOp}
            data-tooltip="Click to switch AND / OR"
          >
            {props.condition.op === "and" ? "ALL match" : "ANY match"}
          </button>
          <Show when={props.removable}>
            <button class="fe-cond-remove" data-tooltip="Remove group" onClick={() => props.onRemove?.()}>
              <IconTrash size={13} />
            </button>
          </Show>
        </div>
        <div class="fe-cond-children">
          <For each={props.condition.children}>
            {(child: any, i: () => number) => (
              <ConditionBuilder
                condition={child}
                onChange={(c) => updateChild(i(), c)}
                depth={props.depth + 1}
                removable={true}
                onRemove={() => removeChild(i())}
                renderLeaf={props.renderLeaf}
                createBlank={props.createBlank}
                variables={props.variables}
              />
            )}
          </For>
          <div class="fe-cond-add-row">
            <button class="fe-cond-add" onClick={addChild}>
              <IconPlus size={12} /> Add condition
            </button>
            <button class="fe-cond-compose-btn fe-cond-compose-btn--and" onClick={() => addNestedGroup("and")}>
              + AND group
            </button>
            <button class="fe-cond-compose-btn fe-cond-compose-btn--or" onClick={() => addNestedGroup("or")}>
              + OR group
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConditionTreeNode — interactive tree visualization with DnD
// ---------------------------------------------------------------------------

export function ConditionTreeNode(props: {
  condition: any;
  path: number[];
  labelFn: (c: any) => string;
  createBlank: () => any;
  onChange: (c: any) => void;
  removable: boolean;
  onRemove?: () => void;
  siblingCount: number;
  onMove?: (from: number, to: number) => void;
  dnd: TreeDnD;
}) {
  const isGroup = () => props.condition.op === "and" || props.condition.op === "or";
  const idx = () => props.path.length > 0 ? props.path[props.path.length - 1] : -1;

  function toggleOp() {
    props.onChange({ ...props.condition, op: props.condition.op === "and" ? "or" : "and" });
  }
  function addChild() {
    props.onChange({ ...props.condition, children: [...props.condition.children, props.createBlank()] });
  }
  function addNestedGroup(op: "and" | "or") {
    props.onChange({ ...props.condition, children: [...props.condition.children, { op, children: [props.createBlank()] }] });
  }
  function updateChild(i: number, child: any) {
    const children = [...props.condition.children];
    children[i] = child;
    props.onChange({ ...props.condition, children });
  }
  function removeChild(i: number) {
    const children = props.condition.children.filter((_: any, ci: number) => ci !== i);
    if (children.length === 0) props.onChange(props.createBlank());
    else if (children.length === 1) props.onChange(children[0]);
    else props.onChange({ ...props.condition, children });
  }
  function moveChild(from: number, to: number) {
    const children = [...props.condition.children];
    const [moved] = children.splice(from, 1);
    children.splice(to, 0, moved);
    props.onChange({ ...props.condition, children });
  }

  function handleDragStart(e: DragEvent) {
    e.stopPropagation();
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", "");
    props.dnd.setSource({ path: [...props.path], condition: cloneDraftValue(props.condition) });
  }
  function handleDragEnd() {
    props.dnd.setSource(null);
    props.dnd.setDropTarget(null);
  }
  function handleChildrenDragOver(e: DragEvent) {
    const src = props.dnd.source();
    if (!src || isDescendantOrSelf(src.path, props.path)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    const childEls = Array.from((e.currentTarget as HTMLElement).querySelectorAll(":scope > .fe-ctree-child"));
    let insertIdx = props.condition.children.length;
    for (let ci = 0; ci < childEls.length; ci++) {
      const r = childEls[ci].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { insertIdx = ci; break; }
    }
    props.dnd.setDropTarget({ parentPath: [...props.path], index: insertIdx });
  }
  function handleChildrenDragLeave(e: DragEvent) {
    const container = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as Node | null;
    if (!related || !container.contains(related)) props.dnd.setDropTarget(null);
  }

  function getDropClass(ci: number): { before: boolean; after: boolean } {
    const dt = props.dnd.dropTarget();
    if (!dt || dt.parentPath.join(",") !== props.path.join(",")) return { before: false, after: false };
    return {
      before: dt.index === ci,
      after: dt.index === ci + 1 && ci === props.condition.children.length - 1,
    };
  }

  const isDragging = () => {
    const src = props.dnd.source();
    return src !== null && src.path.join(",") === props.path.join(",");
  };

  return (
    <Show when={isGroup()} fallback={
      <div class={["fe-ctree-leaf", { "fe-ctree-dragging": !!(isDragging()) }]}
        draggable={props.removable ? "true" : "false"} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <span class="fe-ctree-leaf-text">{props.labelFn(props.condition)}</span>
        <div class="fe-ctree-node-actions">
          <Show when={idx() > 0 && props.onMove}>
            <button class="fe-ctree-act-btn" onClick={() => props.onMove!(idx(), idx() - 1)} data-tooltip="Move left">{"\u2190"}</button>
          </Show>
          <Show when={idx() >= 0 && idx() < props.siblingCount - 1 && props.onMove}>
            <button class="fe-ctree-act-btn" onClick={() => props.onMove!(idx(), idx() + 1)} data-tooltip="Move right">{"\u2192"}</button>
          </Show>
          <Show when={props.removable}>
            <button class="fe-ctree-act-btn fe-ctree-act-btn--remove" onClick={() => props.onRemove?.()}>{"\u00d7"}</button>
          </Show>
        </div>
      </div>
    }>
      <div class={["fe-ctree-group", { "fe-ctree-dragging": !!(isDragging()) }]}
        draggable={props.removable ? "true" : "false"} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div class="fe-ctree-op-row">
          <button class={`fe-ctree-op fe-ctree-op--${props.condition.op}`} onClick={toggleOp} data-tooltip="Click to toggle AND/OR">
            {props.condition.op === "and" ? "AND" : "OR"}
          </button>
          <div class="fe-ctree-node-actions">
            <Show when={idx() > 0 && props.onMove}>
              <button class="fe-ctree-act-btn" onClick={() => props.onMove!(idx(), idx() - 1)} data-tooltip="Move left">{"\u2190"}</button>
            </Show>
            <Show when={idx() >= 0 && idx() < props.siblingCount - 1 && props.onMove}>
              <button class="fe-ctree-act-btn" onClick={() => props.onMove!(idx(), idx() + 1)} data-tooltip="Move right">{"\u2192"}</button>
            </Show>
            <button class="fe-ctree-act-btn" onClick={addChild} data-tooltip="Add condition">+</button>
            <button class="fe-ctree-act-btn" onClick={() => addNestedGroup(props.condition.op === "and" ? "or" : "and")}
              data-tooltip={`Add ${props.condition.op === "and" ? "OR" : "AND"} group`}>
              {props.condition.op === "and" ? "\u2228" : "\u2227"}
            </button>
            <Show when={props.removable}>
              <button class="fe-ctree-act-btn fe-ctree-act-btn--remove" onClick={() => props.onRemove?.()}>{"\u00d7"}</button>
            </Show>
          </div>
        </div>
        <div class="fe-ctree-vline" />
        <div class="fe-ctree-children"
          onDragOver={handleChildrenDragOver}
          onDragLeave={handleChildrenDragLeave}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); props.dnd.performDrop(); }}
        >
          <For each={props.condition.children}>
            {(child: any, i: () => number) => {
              const dc = () => getDropClass(i());
              return (
                <div class={["fe-ctree-child", {
                  "fe-ctree-child--first": i() === 0,
                  "fe-ctree-child--last": i() === props.condition.children.length - 1,
                  "fe-ctree-child--only": props.condition.children.length === 1,
                  "fe-ctree-child--drop-before": dc().before,
                  "fe-ctree-child--drop-after": dc().after,
                }]}>
                  <div class="fe-ctree-stem" />
                  <ConditionTreeNode
                    condition={child}
                    path={[...props.path, i()]}
                    onChange={(c) => updateChild(i(), c)}
                    labelFn={props.labelFn}
                    createBlank={props.createBlank}
                    removable={true}
                    onRemove={() => removeChild(i())}
                    siblingCount={props.condition.children.length}
                    onMove={moveChild}
                    dnd={props.dnd}
                  />
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// ConditionTreeModal — modal wrapper with DnD state management
// ---------------------------------------------------------------------------

export function ConditionTreeModal(props: {
  condition: any;
  onChange: (c: any) => void;
  labelFn: (c: any) => string;
  createBlank: () => any;
  open: boolean;
  onClose: () => void;
}) {
  const [dragSource, setDragSource] = createSignal<{ path: number[]; condition: any } | null>(null);
  const [dropTarget, setDropTarget] = createSignal<{ parentPath: number[]; index: number } | null>(null);

  function performDrop() {
    const src = dragSource();
    const tgt = dropTarget();
    if (!src || !tgt || src.path.length === 0) { setDragSource(null); setDropTarget(null); return; }

    const srcParent = src.path.slice(0, -1);
    const srcIdx = src.path[src.path.length - 1];

    if (arrEq(srcParent, tgt.parentPath) && (srcIdx === tgt.index || srcIdx + 1 === tgt.index)) {
      setDragSource(null); setDropTarget(null); return;
    }

    const tree = cloneDraftValue(props.condition);
    let sp: any = tree;
    for (const p of srcParent) sp = sp.children[p];
    const [moved] = sp.children.splice(srcIdx, 1);

    const adjParent = adjustPathAfterRemoval(tgt.parentPath, srcParent, srcIdx);
    let adjIdx = tgt.index;
    if (arrEq(srcParent, tgt.parentPath) && srcIdx < tgt.index) adjIdx--;

    let tp: any = tree;
    for (const p of adjParent) tp = tp.children[p];
    tp.children.splice(adjIdx, 0, moved);

    props.onChange(cleanupGroups(tree, props.createBlank));
    setDragSource(null); setDropTarget(null);
  }

  const dnd: TreeDnD = { source: dragSource, setSource: setDragSource, dropTarget, setDropTarget, performDrop };

  return (
    <Show when={props.open}>
      <div class="fe-ctree-backdrop" onClick={props.onClose}>
        <div class="fe-ctree-modal" onClick={(e) => e.stopPropagation()}>
          <div class="fe-ctree-modal-header">
            <span class="fe-ctree-modal-title">Condition Tree</span>
            <button class="fe-ctree-modal-close" onClick={props.onClose}>{"\u00d7"}</button>
          </div>
          <div class="fe-ctree-modal-body">
            <ConditionTreeNode
              condition={props.condition}
              path={[]}
              onChange={props.onChange}
              labelFn={props.labelFn}
              createBlank={props.createBlank}
              removable={false}
              siblingCount={1}
              dnd={dnd}
            />
          </div>
        </div>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// CompareLeaf — general-purpose comparison leaf (field op value)
//
// Suitable for visibleIf, templateRules, ref filters, or any context
// where you need "field == value" style conditions.
// ---------------------------------------------------------------------------

export function CompareLeaf(props: LeafRenderProps) {
  const isExpr = () => props.condition.op === "expr";
  const listId = `var-hints-${Math.random().toString(36).slice(2, 8)}`;

  function changeType(t: string) {
    if (t === "compare") props.onChange({ op: "compare", field: "", cmp: "==", value: "" });
    else props.onChange({ op: "expr", expression: "" });
  }

  return (
    <>
      <div class="fe-cond-header">
        <LocusSelect label="Condition kind" value={isExpr() ? "expr" : "compare"} onChange={changeType}
          options={[{ value: "compare", label: "Compare" }, { value: "expr", label: "Expression" }]} />
        <Show when={props.removable}>
          <button class="fe-cond-remove" data-tooltip="Remove" onClick={() => props.onRemove?.()}>
            <IconTrash size={13} />
          </button>
        </Show>
      </div>

      <Show when={props.condition.op === "compare"}>
        <div class="fe-compare-row">
          <input class="fe-input fe-input--sm" value={props.condition.field} placeholder="field"
            list={props.variables?.length ? listId : undefined}
            onInput={(e) => props.onChange({ ...props.condition, field: e.currentTarget.value })} />
          <LocusSelect label="Comparison" value={props.condition.cmp} options={CMP_OPTIONS}
            onChange={(cmp) => props.onChange({ ...props.condition, cmp })} />
          <input class="fe-input fe-input--sm" value={props.condition.value} placeholder="value"
            onInput={(e) => props.onChange({ ...props.condition, value: e.currentTarget.value })} />
        </div>
        <Show when={props.variables?.length}>
          <datalist id={listId}>
            <For each={props.variables!}>
              {(v) => <option value={v.name}>{v.label ?? v.name}</option>}
            </For>
          </datalist>
        </Show>
      </Show>

      <Show when={isExpr()}>
        <input class="fe-input" value={props.condition.expression}
          placeholder='e.g. { "==": [{"var": "field"}, "value"] }'
          onInput={(e) => props.onChange({ op: "expr", expression: e.currentTarget.value })} />
      </Show>
    </>
  );
}

/** Default blank condition for compare-style builders */
export function createBlankCompare() {
  return { op: "compare" as const, field: "", cmp: "==", value: "" };
}

/** Generate a human-readable label for a compare/expr condition */
export function compareLabel(c: any): string {
  if (c.op === "and" || c.op === "or") return c.op.toUpperCase();
  if (c.op === "expr") return c.expression || "(empty)";
  if (c.op === "compare") return `${c.field || "?"} ${c.cmp} ${c.value || "?"}`;
  return "?";
}
