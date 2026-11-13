// ---------------------------------------------------------------------------
// fenel-surface — the web egress of the view substrate's first coded slice
// (design/view-substrate.md; fenel/modules/view/types.fenel).
//
// This component is a DUMB INTERPRETER: it renders a `view:RenderPlan` value
// 1:1 and decides NOTHING. The CSS-vs-canvas split, the outline flattening,
// the responsive branch, the motion seconds — all were decided in Fenel by
// `view:plan` / `view:demoPlan`. Plan constructors map to the web surface as:
//
//   PlanColumns / PlanRows  → flex row / column with gap        (CSS)
//   PlanLayers              → single-area grid stack            (CSS)
//   PlanMoving s inner      → CSS `transition: all s` threaded to descendants
//   PlanShapeCss            → div + clip-path: polygon(…%)      (CSS)
//   PlanShapePath           → <canvas>, connect the pre-flattened points
//   PlanValue               → the universal value renderer (storybook)
//
// Shape points arrive NORMALIZED to [0,1]×[0,1] (the module's convention):
// clip-path scales them to percentages, the canvas to device pixels.
//
// Honest motion fence (view-substrate.md §3.4): `Moving` maps to CSS
// transitions, so continuous property changes tween while structural flips
// (Columns ↔ Rows) cut — interpolation across structure is later work.
// ---------------------------------------------------------------------------

import { For, Match, Switch, createEffect, onSettled } from "solid-js";
import { ValueDisplay } from "~/lib/storybook";

export type PlanPoint = { x: number; y: number };
export type PlanRgbaPixel = { r: number; g: number; b: number; a: number };

/** The wire shape of a `view:RenderPlan` value ({$tag}-discriminated). */
export type RenderPlanValue = {
  $tag: string;
  gap?: number;
  seconds?: number;
  cells?: RenderPlanValue[];
  inner?: RenderPlanValue;
  points?: PlanPoint[];
  fill?: PlanRgbaPixel;
  value?: unknown;
};

function cssColor(c?: PlanRgbaPixel): string {
  if (!c) return "transparent";
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${(c.a ?? 255) / 255})`;
}

function clipPolygon(pts: PlanPoint[]): string {
  const coords = pts
    .map((p) => `${(p.x * 100).toFixed(2)}% ${(p.y * 100).toFixed(2)}%`)
    .join(", ");
  return `polygon(${coords})`;
}

/** Canvas leaf for PlanShapePath: connect the Fenel-flattened outline points
 * and fill. The math already ran in the evaluator (view:outlinePoints); this
 * only scales normalized points to device pixels. */
function ShapeCanvas(props: { points: PlanPoint[]; fill: string }) {
  let el!: HTMLCanvasElement;

  const draw = () => {
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    const cx = el.getContext("2d");
    if (!cx) return;
    cx.scale(dpr, dpr);
    cx.clearRect(0, 0, w, h);
    const pts = props.points;
    if (pts.length === 0) return;
    cx.beginPath();
    cx.moveTo(pts[0]!.x * w, pts[0]!.y * h);
    for (let i = 1; i < pts.length; i++) cx.lineTo(pts[i]!.x * w, pts[i]!.y * h);
    cx.closePath();
    cx.fillStyle = props.fill;
    cx.fill();
  };

  createEffect(
    // Track plan changes (new points/fill) → repaint.
    () => [props.points, props.fill] as const,
    () => draw(),
  );
  onSettled(() => {
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  });

  return <canvas ref={el} style={{ width: "100%", height: "100%", display: "block" }} />;
}

/** Render a `view:RenderPlan` value. `motionSeconds` is threaded from the
 * nearest enclosing PlanMoving and applied as a CSS transition wherever the
 * surface supports interpolation. */
export function PlanView(props: { plan: RenderPlanValue; motionSeconds?: number }) {
  const transition = () =>
    props.motionSeconds ? `all ${props.motionSeconds}s ease` : undefined;
  const isFlex = () => props.plan.$tag === "PlanColumns" || props.plan.$tag === "PlanRows";

  return (
    <Switch
      fallback={
        <pre style={{ color: "#f87171", "white-space": "pre-wrap" }}>
          fenel-surface: unknown plan node {JSON.stringify(props.plan?.$tag)}
        </pre>
      }
    >
      <Match when={props.plan.$tag === "PlanMoving" && props.plan.inner}>
        <PlanView plan={props.plan.inner!} motionSeconds={props.plan.seconds} />
      </Match>
      <Match when={isFlex()}>
        <div
          style={{
            display: "flex",
            "flex-direction": props.plan.$tag === "PlanColumns" ? "row" : "column",
            gap: `${props.plan.gap ?? 0}px`,
            width: "100%",
            transition: transition(),
          }}
        >
          <For each={props.plan.cells ?? []}>
            {(cell) => (
              <div
                style={{
                  flex: "1 1 0",
                  "min-width": "0",
                  display: "grid",
                  "min-height": "220px",
                  transition: transition(),
                }}
              >
                <PlanView plan={cell} motionSeconds={props.motionSeconds} />
              </div>
            )}
          </For>
        </div>
      </Match>
      <Match when={props.plan.$tag === "PlanLayers"}>
        <div style={{ display: "grid", width: "100%", "min-height": "220px", transition: transition() }}>
          <For each={props.plan.cells ?? []}>
            {(cell) => (
              <div style={{ "grid-area": "1 / 1", display: "grid", transition: transition() }}>
                <PlanView plan={cell} motionSeconds={props.motionSeconds} />
              </div>
            )}
          </For>
        </div>
      </Match>
      <Match when={props.plan.$tag === "PlanShapeCss"}>
        <div
          style={{
            width: "100%",
            height: "100%",
            "min-height": "220px",
            background: cssColor(props.plan.fill),
            "clip-path": clipPolygon(props.plan.points ?? []),
            transition: transition(),
          }}
        />
      </Match>
      <Match when={props.plan.$tag === "PlanShapePath"}>
        <div style={{ width: "100%", height: "100%", "min-height": "220px" }}>
          <ShapeCanvas points={props.plan.points ?? []} fill={cssColor(props.plan.fill)} />
        </div>
      </Match>
      <Match when={props.plan.$tag === "PlanValue"}>
        <div style={{ overflow: "auto" }}>
          <ValueDisplay value={props.plan.value} />
        </div>
      </Match>
    </Switch>
  );
}
