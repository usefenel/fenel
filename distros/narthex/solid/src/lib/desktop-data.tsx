import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { IconByName, LUCIDE_BY_NAME, TYPE_ICON_FALLBACKS } from "./icons";
import "./desktop-data.css";

/** Icon-sized presentation of any data. The caller supplies its existing
 * reader-owned media or bounded collection preview; this shell neither
 * evaluates the data nor invents another type/representation resolver. */
export function DesktopDataPreview(props: {
  label: string;
  icon?: string;
  preview?: JSX.Element;
  collection?: JSX.Element;
  onOpen?: () => void;
}) {
  const icon = () => <IconByName name={props.icon && LUCIDE_BY_NAME[props.icon] ? props.icon : TYPE_ICON_FALLBACKS.Data} size={56} />;
  const content = () => <span class="desktop-data__visual" inert aria-hidden="true">
    <Show when={props.collection} fallback={
      <Show when={props.preview} fallback={icon()}>
        <span class="desktop-data__media">{props.preview}</span>
        <span class="desktop-data__fallback">{icon()}</span>
      </Show>
    }>
      <span class="desktop-data__folder">
        <IconByName name="folder" size={68} />
        <span class="desktop-data__folder-preview">{props.collection}</span>
      </span>
    </Show>
  </span>;
  return <span class="desktop-data__preview">
    {content()}
    <Show when={props.onOpen}>
      <button type="button" class="desktop-data__open"
        aria-label={`Open ${props.label}`} data-tooltip={`Open ${props.label}`}
        onClick={event => { event.stopPropagation(); props.onOpen?.(); }} />
    </Show>
  </span>;
}
