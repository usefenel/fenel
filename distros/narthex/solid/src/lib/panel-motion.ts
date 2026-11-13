// Panels arrive smoothly (Nov 12, Rom: "When we click a panel, it's a bit rough:
// the panel appears, there is no transition. There should be a slide: the
// other elements that are moved by the panel slide, and the panel fades in").
// The inspection panels sit in one grid whose column count follows the visible
// panels, so a toggle re-lays them out at once. After that layout, each panel
// that stayed visible is played from its previous place to its new one
// (a transform only: no layout per frame), and a newly shown panel fades and
// slides in from its side. Nothing moves under `prefers-reduced-motion`.
// Solid/browser renderer allowance — presentation adapter (motion only).

export const PANEL_MOTION_MS = 200;
export const PANEL_MOTION_EASING = "cubic-bezier(0.2, 0, 0, 1)";
/** How far a newly shown panel travels while it fades in. */
export const PANEL_ENTRY_OFFSET_PX = 16;

export type PanelBox = { x: number; y: number };
export type PanelMotion =
  | { kind: "slide"; dx: number; dy: number }
  | { kind: "enter"; dx: number };

/** What each panel visible after the toggle plays: a panel that was visible
 * slides from its previous box (when it moved at all); a new one enters from
 * the left when it is the first panel, else from the right. */
export function panelMotions<K>(before: ReadonlyMap<K, PanelBox>, after: readonly (readonly [K, PanelBox])[]): Map<K, PanelMotion> {
  const motions = new Map<K, PanelMotion>();
  // The first render (nothing measured yet) plays nothing.
  if (before.size === 0) return motions;
  after.forEach(([key, box], index) => {
    const was = before.get(key);
    if (!was) { motions.set(key, { kind: "enter", dx: index === 0 ? -PANEL_ENTRY_OFFSET_PX : PANEL_ENTRY_OFFSET_PX }); return; }
    const dx = Math.round(was.x - box.x), dy = Math.round(was.y - box.y);
    if (dx !== 0 || dy !== 0) motions.set(key, { kind: "slide", dx, dy });
  });
  return motions;
}

/** The keyframes of one motion: transform and opacity only. */
export function panelKeyframes(motion: PanelMotion): Keyframe[] {
  return motion.kind === "slide"
    ? [{ transform: `translate(${motion.dx}px, ${motion.dy}px)` }, { transform: "none" }]
    : [{ opacity: 0, transform: `translateX(${motion.dx}px)` }, { opacity: 1, transform: "none" }];
}

export function prefersReducedMotion(): boolean {
  try { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}

/** A panel's layout box relative to its grid, unaffected by transforms (a
 * running slide) and by scrolling. */
export function panelBox(panel: HTMLElement, root: HTMLElement): PanelBox {
  return panel.offsetParent === root
    ? { x: panel.offsetLeft, y: panel.offsetTop }
    : { x: panel.offsetLeft - root.offsetLeft, y: panel.offsetTop - root.offsetTop };
}

/** Follows one panel grid: `settle` after each toggle's layout plays the
 * motions from the previous boxes; `measure` refreshes the boxes (a resize
 * between toggles must not play as a slide). */
export function createPanelMotion(root: () => HTMLElement | undefined) {
  let boxes = new Map<HTMLElement, PanelBox>();
  const visible = (grid: HTMLElement) => [...grid.children].filter((child): child is HTMLElement =>
    child instanceof HTMLElement && !child.hidden && child.offsetParent !== null);
  const measure = () => {
    const grid = root();
    boxes = new Map<HTMLElement, PanelBox>(grid ? visible(grid).map(panel => [panel, panelBox(panel, grid)] as const) : []);
  };
  const settle = () => {
    const grid = root();
    if (!grid) return;
    const before = boxes;
    const after = visible(grid).map(panel => [panel, panelBox(panel, grid)] as const);
    boxes = new Map<HTMLElement, PanelBox>(after);
    if (prefersReducedMotion()) return;
    for (const [panel, motion] of panelMotions(before, after)) {
      if (typeof panel.animate !== "function") continue;
      panel.animate(panelKeyframes(motion), { duration: PANEL_MOTION_MS, easing: PANEL_MOTION_EASING });
    }
  };
  return { measure, settle };
}
