// ---------------------------------------------------------------------------
// ProfileCard — registered as the readComponent for profile-card-view.
//
// Renders one profile as a card. Uses the entity-card-grid CSS classes
// (`.entity-card`, `.entity-card__header`, etc.) for styling.
// ---------------------------------------------------------------------------

import { Show, For } from "solid-js";
import type { CardComponentProps } from "~/lib/entity-card-view";

function profileDisplayName(p: any): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "Unnamed";
}

function typeLabel(type: string): string {
  if (type === "ai_agent") return "AI Agent";
  return type;
}

function typeBadgeVariant(type: string): string {
  if (type === "group") return "yellow";
  if (type === "ai_agent") return "purple";
  return "blue";
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function initialsColor(name: string): string {
  const colors = ["#1565c0", "#1e7e34", "#f57f17", "#6a1b9a", "#00838f", "#ef6c00", "#283593", "#ad1457"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length] ?? colors[0]!;
}

export function ProfileCard(props: CardComponentProps<any>) {
  const title = () => profileDisplayName(props.item);
  const subtitle = () => {
    const e = props.item.email;
    return e && e !== title() ? e : undefined;
  };
  const initials = () => getInitials(title()) || "?";
  const color = () => initialsColor(title());
  const tags = () => (props.item.tags ?? []) as string[];

  return (
    <div class="entity-card">
      <div class="entity-card__header">
        <Show
          when={props.item.avatar}
          fallback={
            <div class="entity-card__initials" style={`background: ${color()}`}>
              {initials()}
            </div>
          }
        >
          <img class="entity-card__avatar" src={props.item.avatar} alt="" />
        </Show>
        <div class="entity-card__identity">
          <div class="entity-card__title">{title()}</div>
          <Show when={subtitle()}>
            <div class="entity-card__subtitle">{subtitle()}</div>
          </Show>
        </div>
      </div>

      <div class="entity-card__badges">
        <span class={`badge badge-${typeBadgeVariant(props.item.type)}`}>
          {typeLabel(props.item.type)}
        </span>
        <Show when={props.item.archivedAt}>
          <span class="badge badge-gray">Archived</span>
        </Show>
      </div>

      <Show when={tags().length > 0}>
        <div class="entity-card__chips">
          <For each={tags()}>{(t) => <span class="entity-card__chip">{t}</span>}</For>
        </div>
      </Show>

      <div class="entity-card__meta">
        <Show when={props.item.phone}>
          <div class="entity-card__meta-row">
            <span class="entity-card__meta-label">Phone</span>
            <span class="entity-card__meta-value">{props.item.phone}</span>
          </div>
        </Show>
        <Show when={props.item.handleCount > 0}>
          <div class="entity-card__meta-row">
            <span class="entity-card__meta-label">Handles</span>
            <span class="entity-card__meta-value">{props.item.handleCount}</span>
          </div>
        </Show>
        <Show when={props.item.createdAt}>
          <div class="entity-card__meta-row">
            <span class="entity-card__meta-label">Created</span>
            <span class="entity-card__meta-value">
              {new Date(props.item.createdAt).toLocaleDateString()}
            </span>
          </div>
        </Show>
      </div>
    </div>
  );
}
