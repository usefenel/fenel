// ---------------------------------------------------------------------------
// /app/view-lab — the view substrate's first live surface
// (design/view-substrate.md; fenel/modules/view/types.fenel).
//
// The whole pipeline on one screen, with every decision made in Fenel:
//   1. this route MEASURES its container (a ResizeObserver — the one browser
//      fact Fenel cannot know) and hands `{ width, height }` to
//   2. `view:demoPlan : Viewport -> RenderPlan`, evaluated CLIENT-SIDE by the
//      engine (the same in-browser evaluator the expression editor uses) —
//      responsivity is just a function; the CSS-vs-canvas split, the outline
//      flattening of Formula edges, and the motion wrap all happen in Fenel;
//   3. `PlanView` (~/lib/fenel-surface) interprets the returned plan 1:1 —
//      flex for Columns/Rows, clip-path for straight-edge shapes, canvas for
//      formula-edge shapes, the universal value renderer for data.
//
// Resize the window (or the panel) across 700px to watch the layout function
// change its answer.
// ---------------------------------------------------------------------------

import { Show, createSignal, onSettled } from "solid-js";
import { PlanView, type RenderPlanValue } from "~/lib/fenel-surface";
import { evaluateAuthoringExpression } from "~/lib/expression-runner";

export default function ViewLab() {
  let host!: HTMLDivElement;
  const [plan, setPlan] = createSignal<RenderPlanValue | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
  const [showPlan, setShowPlan] = createSignal(false);
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const replan = (width: number, height: number) => {
    try {
      const out = evaluateAuthoringExpression({
        kind: "call",
        fnId: "view:demoPlan",
        args: [{ kind: "literal", value: { width, height } }],
      });
      const result = out.result as RenderPlanValue | null;
      if (!result || typeof result !== "object" || !("$tag" in result)) {
        setError(`view:demoPlan returned an unexpected value: ${JSON.stringify(result)?.slice(0, 300)}`);
        return;
      }
      setPlan(result);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  onSettled(() => {
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const width = Math.round(rect.width);
      const height = Math.round(rect.height) || 600;
      setViewport({ width, height });
      if (debounce !== undefined) clearTimeout(debounce);
      debounce = setTimeout(() => replan(width, height), 120);
    });
    ro.observe(host);
    return () => {
      if (debounce !== undefined) clearTimeout(debounce);
      ro.disconnect();
    };
  });

  return (
    <div style={{ padding: "16px", display: "flex", "flex-direction": "column", gap: "12px" }}>
      <div>
        <h1 style={{ margin: "0 0 4px" }}>Lens lab</h1>
        <p style={{ margin: 0, opacity: 0.75 }}>
          <code>view:demoPlan</code> (Fenel, evaluated in this browser) turns the measured
          viewport into a render plan — Columns wide, Rows under 700px; straight edges as CSS
          clip-path, formula edges flattened to canvas; <code>Moving 0.4</code> as CSS
          transitions. This page only measures and obeys.
        </p>
        <p style={{ margin: "4px 0 0", "font-size": "12px", opacity: 0.6 }}>
          viewport: {viewport().width} × {viewport().height}
          {" · "}
          <button onClick={() => setShowPlan(!showPlan())} style={{ font: "inherit" }}>
            {showPlan() ? "hide" : "show"} the plan value
          </button>
        </p>
      </div>

      <div ref={host} style={{ width: "100%" }}>
        <Show when={error()}>
          <pre style={{ color: "#f87171", "white-space": "pre-wrap" }}>{error()}</pre>
        </Show>
        <Show when={plan()}>{(p) => <PlanView plan={p()} />}</Show>
      </div>

      <Show when={showPlan() && plan()}>
        <pre
          style={{
            "font-size": "11px",
            background: "rgba(127,127,127,0.08)",
            padding: "8px",
            "border-radius": "6px",
            overflow: "auto",
            "max-height": "300px",
          }}
        >
          {JSON.stringify(plan(), null, 2)}
        </pre>
      </Show>
    </div>
  );
}
