import { Show, For, createSignal, createMemo } from "solid-js";
import type { FieldDef, LayoutDef, SlideConfig } from "@fenel/engine/types";
import "./slide-renderer.css";
import type { TemplateRegistry } from "@fenel/engine/template-registry";
import type { ModuleRegistry } from "@fenel/engine/registry";
import { formRecordDrillPlan, formSlidePlan, type FormSlide, type FormSlideFieldPlan } from "@fenel/engine/authoring/form-runtime";
import { FieldRenderer } from "~/lib/field-renderer";
import { IconChevronRight } from "~/lib/icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SlideRendererProps = {
  layout: LayoutDef;
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
  registry: TemplateRegistry;
  /** Explicit repository/account field presentation context. */
  fieldRegistry?: ModuleRegistry;
  config: SlideConfig;
  /** Called when the user completes the last slide */
  onComplete?: () => void;
};

type DepthFrame = {
  /** Label for breadcrumb */
  label: string;
  /** Field path prefix (e.g. "address" or "address.country") */
  prefix: string;
  /** Slide index within this depth level */
  slideIndex: number;
  /** The record field being drilled into */
  field: FieldDef;
};

// ---------------------------------------------------------------------------
// Slide Renderer
// ---------------------------------------------------------------------------

export function SlideRenderer(props: SlideRendererProps) {
  const topSlides = createMemo(() => formSlidePlan({
    registry: props.fieldRegistry,
    layout: props.layout,
    fields: props.fields,
    values: props.values,
    config: props.config,
  }).slides);

  // Depth stack for navigating into complex fields
  const [depthStack, setDepthStack] = createSignal<DepthFrame[]>([]);
  const [currentIndex, setCurrentIndex] = createSignal(0);

  // Current depth frame (top of stack, or root)
  const currentFrame = createMemo(() => {
    const stack = depthStack();
    if (stack.length > 0) return stack[stack.length - 1];
    return null;
  });

  const slides = createMemo<FormSlide[]>(() => {
    const frame = currentFrame();
    return frame
      ? formRecordDrillPlan(frame.field, {
          registry: props.fieldRegistry,
          values: props.values,
        }).slides
      : topSlides();
  });
  const slideIndex = createMemo(() => currentFrame()?.slideIndex ?? currentIndex());
  const currentSlide = createMemo(() => slides()[slideIndex()]);
  const totalSlides = createMemo(() => slides().length);
  const depth = createMemo(() => depthStack().length);

  // Breadcrumb path
  const breadcrumb = createMemo(() => {
    const items = [{ label: "Form", prefix: "" }];
    for (const frame of depthStack()) {
      items.push({ label: frame.label, prefix: frame.prefix });
    }
    return items;
  });

  // Navigation
  function goTo(index: number) {
    if (index < 0 || index >= totalSlides()) return;
    const stack = depthStack();
    if (stack.length > 0) {
      setDepthStack(
        stack.map((f, i) =>
          i === stack.length - 1 ? { ...f, slideIndex: index } : f,
        ),
      );
    } else {
      setCurrentIndex(index);
    }
  }

  function next() {
    if (slideIndex() < totalSlides() - 1) {
      goTo(slideIndex() + 1);
    } else if (depth() > 0) {
      // Pop depth level and advance parent
      popDepth();
    } else {
      props.onComplete?.();
    }
  }

  function prev() {
    if (slideIndex() > 0) {
      goTo(slideIndex() - 1);
    } else if (depth() > 0) {
      popDepth();
    }
  }

  // Drill into a complex record field
  function drillInto(fieldPlan: FormSlideFieldPlan) {
    if (!fieldPlan.drillable) return;
    const frame: DepthFrame = {
      label: fieldPlan.label,
      prefix: fieldPlan.name,
      slideIndex: 0,
      field: fieldPlan.field,
    };

    setDepthStack([...depthStack(), frame]);
  }

  function popDepth() {
    const stack = depthStack();
    if (stack.length === 0) return;
    setDepthStack(stack.slice(0, -1));
  }

  function goToBreadcrumb(index: number) {
    if (index === 0) {
      setDepthStack([]);
    } else {
      setDepthStack(depthStack().slice(0, index));
    }
  }

  // Keyboard navigation
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      next();
    } else if ((e.key === "Enter" && e.shiftKey) || e.key === "ArrowLeft" || e.key === "ArrowUp") {
      // Only ArrowLeft/ArrowUp when not in an input
      if (e.key === "Enter" || !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        prev();
      }
    }
  }

  // Progress fraction
  const progressText = createMemo(() => `${slideIndex() + 1} / ${totalSlides()}`);
  const progressPct = createMemo(() => ((slideIndex() + 1) / Math.max(totalSlides(), 1)) * 100);

  const transition = () => props.config.transition ?? "slide-h";

  return (
    <div class="slide-renderer" onKeyDown={handleKeyDown} tabindex={-1}>
      {/* Depth breadcrumb */}
      <Show when={depth() > 0}>
        <nav class="slide-breadcrumb">
          <For each={breadcrumb()}>
            {(item, i) => (
              <>
                <Show when={i() > 0}>
                  <IconChevronRight size={12} />
                </Show>
                <button
                  class={`slide-breadcrumb-item ${i() === breadcrumb().length - 1 ? "slide-breadcrumb-item--active" : ""}`}
                  onClick={() => goToBreadcrumb(i())}
                >
                  {item.label}
                </button>
              </>
            )}
          </For>
        </nav>
      </Show>

      {/* Progress indicator */}
      <Show when={props.config.progress !== "none"}>
        <div class="slide-progress">
          <Show when={props.config.progress === "bar" || !props.config.progress}>
            <div class="slide-progress-bar">
              <div
                class="slide-progress-fill"
                style={{ width: `${progressPct()}%` }}
              />
            </div>
          </Show>
          <Show when={props.config.progress === "dots"}>
            <div class="slide-progress-dots">
              <For each={slides()}>
                {(_, i) => (
                  <button
                    class={`slide-dot ${i() === slideIndex() ? "slide-dot--active" : ""} ${i() < slideIndex() ? "slide-dot--done" : ""}`}
                    onClick={() => goTo(i())}
                  />
                )}
              </For>
            </div>
          </Show>
          <Show when={props.config.progress === "fraction"}>
            <div class="slide-progress-fraction">{progressText()}</div>
          </Show>
        </div>
      </Show>

      {/* Slide content */}
      <div class={`slide-viewport slide-transition-${transition()}`}>
        <Show when={currentSlide()}>
          <div class="slide-content" data-slide={slideIndex()}>
            <Show when={currentSlide()!.title}>
              <h3 class="slide-title">{currentSlide()!.title}</h3>
            </Show>
            <div class="slide-fields">
              <For each={currentSlide()!.fields}>
                {(fieldPlan) => (
                  <div class="slide-field">
                    <FieldRenderer
                      registry={props.fieldRegistry}
                      field={fieldPlan.field}
                      value={fieldPlan.value}
                      onChange={(v) => props.onChange(fieldPlan.name, v)}
                    />
                    <Show when={fieldPlan.drillable}>
                      <button
                        class="slide-drill-btn"
                        onClick={() => drillInto(fieldPlan)}
                      >
                        Edit details
                        <IconChevronRight size={14} />
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>

      {/* Navigation */}
      <div class="slide-nav">
        <button
          class="slide-nav-btn slide-nav-btn--prev"
          onClick={prev}
          disabled={slideIndex() === 0 && depth() === 0}
        >
          Back
        </button>
        <Show
          when={slideIndex() < totalSlides() - 1 || depth() > 0}
          fallback={
            <button class="slide-nav-btn slide-nav-btn--submit" onClick={() => props.onComplete?.()}>
              Submit
            </button>
          }
        >
          <button class="slide-nav-btn slide-nav-btn--next" onClick={next}>
            Next
          </button>
        </Show>
      </div>
    </div>
  );
}
