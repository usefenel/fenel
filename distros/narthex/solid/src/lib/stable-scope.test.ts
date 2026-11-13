import { expect, test } from "bun:test";
import { createMemo, createRoot, createSignal, flush } from "solid-js";
import { createScopeMemo, sameScope } from "./stable-scope";
import { scopeFromWorkspace } from "./workspace-wire";
import type { WorkspaceFocus } from "./workspace-wire";

const treeOfLife = (itemId = "tree-of-life"): WorkspaceFocus => ({ $tag: "ValueFocus", listId: "tree", itemId,
  path: [], rootItem: false, passThrough: [] }) as unknown as WorkspaceFocus;

test("a scope is the same scope by value, and differs by list, item, path or entry", () => {
  const base = scopeFromWorkspace(treeOfLife());
  expect(sameScope(base, scopeFromWorkspace(treeOfLife()))).toBe(true);
  expect(sameScope(base, scopeFromWorkspace(treeOfLife("foods-by-kind")))).toBe(false);
  expect(sameScope(base, { ...base, path: ["sets"] } as typeof base)).toBe(false);
  expect(sameScope(base, { ...base, rootItem: true } as typeof base)).toBe(false);
  expect(sameScope(base, { ...base, passThrough: [1] } as typeof base)).toBe(false);
  expect(sameScope({ kind: "root" }, { kind: "root" })).toBe(true);
  expect(sameScope({ kind: "view", viewId: "a" }, { kind: "view", viewId: "b" })).toBe(false);
  // A field named "a.b" is not the path a → b.
  expect(sameScope({ ...base, path: ["a.b"] } as typeof base, { ...base, path: ["a", "b"] } as typeof base)).toBe(false);
});

test("a publication that hands the pane a new lens object with the same focus keeps the focused card", () => {
  // The pane reads its focus from the published lens (workspace-surface.tsx).
  const [lens, setLens] = createSignal({ id: "lens-1", focus: treeOfLife() });
  let builds = 0;
  const { item, dispose } = createRoot(dispose => {
    const displayFocus = createScopeMemo(() => scopeFromWorkspace(lens().focus));
    // Home builds the focused card's item from the focus (home-entry.tsx
    // focusedPreview) and `<For>` keys the card by that item's identity.
    const item = createMemo(() => { builds += 1; return { focus: displayFocus() }; });
    return { item, dispose };
  });
  flush();
  const first = item();
  expect(builds).toBe(1);

  // A resize: the store publishes a new packet, every lens object is new.
  setLens({ id: "lens-1", focus: treeOfLife() });
  flush();
  expect(item()).toBe(first);
  expect(builds).toBe(1);

  // Another focus is another card.
  setLens({ id: "lens-1", focus: treeOfLife("foods-by-kind") });
  flush();
  expect(item()).not.toBe(first);
  expect(builds).toBe(2);
  dispose();
});
