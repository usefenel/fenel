import { Show } from "solid-js";
import { IconBolt } from "~/lib/icons";
import { ValueTypeCaption } from "../value-card";

export type FieldLabelSurfaceProps = {
  readonly id?: string;
  readonly name?: string;
  readonly typeName?: string;
  readonly required?: boolean;
  readonly helpText?: string;
  readonly isArrow?: boolean;
  readonly typePresentation?: "badge" | "data";
  readonly typeIcon?: string;
};

/** The canonical field-label DOM, using an already resolved presentation. */
export function FieldLabelSurface(props: FieldLabelSurfaceProps) {
  return (
    <Show when={props.name || props.typeName}>
      <div class="fr-label" id={props.id}>
        <Show when={props.name}>
          <span class="fr-label__name">{props.name}</span>
          <Show when={props.required}>
            <span class="fr-req">*</span>
          </Show>
        </Show>
        <Show
          when={props.typePresentation === "data"}
          fallback={
            <Show when={props.typeName && props.isArrow} fallback={<Show when={props.typeName}>
              <span class="fr-type-badge mono">{props.typeName}</span>
            </Show>}>
              <div class="fr-label__type-stack">
                <span class="fr-kind-badge"><IconBolt size={11} />Function</span>
                <span class="fr-type-badge mono">{props.typeName}</span>
              </div>
            </Show>
          }
        >
          <Show when={props.typeName}><span class="home-item__type-tag fr-label__data-type"><ValueTypeCaption label={props.typeName} icon={props.typeIcon ?? (props.isArrow ? "function" : "type")} /></span></Show>
        </Show>
      </div>
      <Show when={props.helpText}>
        <div class="fr-help">{props.helpText}</div>
      </Show>
    </Show>
  );
}
