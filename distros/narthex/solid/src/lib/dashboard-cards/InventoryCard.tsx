// ---------------------------------------------------------------------------
// InventoryCard — replaces the bespoke `dashboard/inventory.tsx` stat-card
// grid via the generic EntityCardView dispatch. Receives one inventory row
// (slug, capacity, available, reserved, enforce) and renders a stat card.
// ---------------------------------------------------------------------------

import { Show } from "solid-js";
import type { CardComponentProps } from "~/lib/entity-card-view";

export function InventoryCard(props: CardComponentProps<any>) {
  const row = () => props.item;
  const cap = () => Number(row().capacity ?? 0);
  const avail = () => Number(row().available ?? 0);
  const reserved = () => Number(row().reserved ?? 0);
  const enforce = () => row().enforce as string | undefined;
  const enforceClass = () => (enforce() === "hard" ? "badge-red" : "badge-yellow");

  return (
    <div class="card" style="display: flex; flex-direction: column; gap: 0.5rem;">
      <div class="card-title">{row().slug}</div>
      <div class="card-value">
        {avail()}
        <Show when={cap() > 0}>
          <span style="font-size: 1rem; color: #999"> / {cap()}</span>
        </Show>
      </div>
      <div style="font-size: 0.8rem; color: #999; display: flex; gap: 0.5rem; align-items: center;">
        <span>{reserved()} reserved</span>
        <Show when={enforce()}>
          <span class={`badge ${enforceClass()}`}>{enforce()}</span>
        </Show>
      </div>
    </div>
  );
}
