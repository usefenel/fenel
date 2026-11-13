// Nov 12 (Rom: "When we click a panel, it's a bit rough ... the other elements that are moved by the panel slide, and
// the panel fades in, whether it is Suggestions, Code, Expression, Dependencies"). The inspection panels' grid plays
// each toggle: panels that stayed slide from their previous boxes, a new one fades and slides in; transform and
// opacity only, about 200 ms, ease-out, nothing under prefers-reduced-motion. No browser, no registry.
//   bun test ./distros/narthex/solid/src/lib/panel-motion.test.ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { PANEL_ENTRY_OFFSET_PX, PANEL_MOTION_EASING, PANEL_MOTION_MS, panelKeyframes, panelMotions, type PanelBox } from "./panel-motion";

const boxes = (...entries: [string, number, number][]) => entries.map(([key, x, y]) => [key, { x, y }] as const);

describe("what a panel toggle plays", () => {
  test("opening Suggestions on the left: it enters from the left, Data and Expression slide right", () => {
    const before = new Map<string, PanelBox>(boxes(["data", 0, 0], ["expression", 600, 0]));
    const motions = panelMotions(before, boxes(["suggestions", 0, 0], ["data", 320, 0], ["expression", 800, 0]));
    expect(motions.get("suggestions")).toEqual({ kind: "enter", dx: -PANEL_ENTRY_OFFSET_PX });
    expect(motions.get("data")).toEqual({ kind: "slide", dx: -320, dy: 0 });
    expect(motions.get("expression")).toEqual({ kind: "slide", dx: -200, dy: 0 });
  });

  test("opening Code on the right enters from the right; closing a panel slides the others back", () => {
    const opened = panelMotions(new Map<string, PanelBox>(boxes(["data", 0, 0])), boxes(["data", 0, 0], ["code", 600, 0]));
    expect(opened.get("code")).toEqual({ kind: "enter", dx: PANEL_ENTRY_OFFSET_PX });
    expect(opened.has("data")).toBe(false);
    const closed = panelMotions(new Map<string, PanelBox>(boxes(["suggestions", 0, 0], ["data", 320, 0])), boxes(["data", 0, 0]));
    expect([...closed]).toEqual([["data", { kind: "slide", dx: 320, dy: 0 }]]);
  });

  test("a stacked (narrow) layout slides vertically; the first render plays nothing", () => {
    const motions = panelMotions(new Map<string, PanelBox>(boxes(["data", 0, 0])), boxes(["suggestions", 0, 0], ["data", 0, 412.4]));
    expect(motions.get("data")).toEqual({ kind: "slide", dx: 0, dy: -412 });
    expect(panelMotions(new Map(), boxes(["data", 0, 0], ["code", 600, 0])).size).toBe(0);
  });

  test("keyframes animate transform and opacity only, for about 200 ms with an ease-out curve", () => {
    for (const frames of [panelKeyframes({ kind: "slide", dx: 3, dy: 4 }), panelKeyframes({ kind: "enter", dx: 16 })]) {
      for (const frame of frames) for (const key of Object.keys(frame)) expect(["transform", "opacity"]).toContain(key);
      expect(frames.at(-1)!.transform).toBe("none");
    }
    expect(PANEL_MOTION_MS).toBeGreaterThanOrEqual(160);
    expect(PANEL_MOTION_MS).toBeLessThanOrEqual(220);
    expect(PANEL_MOTION_EASING).toBe("cubic-bezier(0.2, 0, 0, 1)");
  });
});

describe("the panels' grid uses it", () => {
  test("every toggle settles the motion after layout; reduced motion plays nothing", async () => {
    const dialog = (await readFile(new URL("./DataInspectionDialog.tsx", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    const panels = dialog.slice(dialog.indexOf("export function DataInspectionPanels"), dialog.indexOf("function RetainedInspectionPanel"));
    expect(panels).toContain("createPanelMotion(() => root)");
    expect(panels).toContain("createEffect(visiblePanels, () => { queueMicrotask(motion.settle); });");
    const motion = (await readFile(new URL("./panel-motion.ts", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    expect(motion).toContain("if (prefersReducedMotion()) return;");
    expect(motion).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
  });
});
