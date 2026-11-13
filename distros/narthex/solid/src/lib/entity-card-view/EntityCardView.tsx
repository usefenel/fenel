// ---------------------------------------------------------------------------
// EntityCardView — generic card-grid renderer for a TypeView with
// `listDisplay.style: "cards"`.
//
// Per the architectural decision: cards are always rendered via a registered
// `readComponent` on the TypeView. There's no declarative `cardConfig`
// shorthand; if you need a card for an entity, you register a SolidJS
// component by name in the web registry and reference it from the
// TypeView's `readComponent` (or `component` for full-mode override).
//
// The card component receives the whole row plus the resolved TypeView.
// ---------------------------------------------------------------------------

import { For, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dynamic } from "@solidjs/web";
import type { TypeView } from "@fenel/engine/types";
import type { TemplateRegistry } from "@fenel/engine/template-registry";
import "./entity-card-view.css";

/** Contract for components registered as TypeView card renderers.
 *  Receives one row + the resolving template + an optional href so the
 *  component can wrap itself in a link if it wants navigation. */
export type CardComponentProps<T = Record<string, unknown>> = {
  item: T;
  template: TypeView;
  href?: string;
};

export type EntityCardViewProps<T = Record<string, unknown>> = {
  items: T[];
  template: TypeView;
  registry: TemplateRegistry;
  /** Optional href builder per item — passed through to the card component
   *  via `props.href` for components that want to render their own link;
   *  also used as a fallback wrapping `<a>` when the component doesn't. */
  rowHref?: (row: T) => string;
  emptyMessage?: string;
};

export function EntityCardView<T extends Record<string, unknown>>(
  props: EntityCardViewProps<T>,
) {
  const compName = () => props.template.readComponent ?? props.template.component;
  const Comp = () => {
    const name = compName();
    if (!name) return null;
    return props.registry.getComponent(name) as Component<CardComponentProps<T>> | null;
  };

  return (
    <Show
      when={Comp()}
      fallback={
        <p class="text-muted">
          No card component registered for this view (template.readComponent: {compName() ?? "(unset)"}).
          Register one with <code>webRegistry.registerComponent(name, component)</code>.
        </p>
      }
    >
      {(C) => (
        <Show
          when={props.items.length > 0}
          fallback={<p class="empty">{props.emptyMessage ?? "No data"}</p>}
        >
          <div class="entity-card-grid">
            <For each={props.items}>
              {(item) => {
                const href = props.rowHref?.(item);
                const card = (
                  <Dynamic
                    component={C()}
                    item={item}
                    template={props.template}
                    href={href}
                  />
                );
                return href ? (
                  <a
                    href={href}
                    class="entity-card-link"
                    style="text-decoration: none; color: inherit; display: block;"
                  >
                    {card}
                  </a>
                ) : (
                  card
                );
              }}
            </For>
          </div>
        </Show>
      )}
    </Show>
  );
}
