import { For, Show, createMemo } from "solid-js";
import { Dynamic } from "@solidjs/web";
import type { MarkupValue } from "@fenel/engine/markup";
import { browserPreviewElement } from "./browser-preview";

/** Read-only browser projection of authored Markup. DOM admission is shared
 * with the existing visual editor; text is bound as text, never innerHTML. */
export function MarkupRead(props: { value: MarkupValue }) {
  return <Show when={props.value.$tag === "Element"} fallback={
    (props.value as Extract<MarkupValue, { $tag: "Text" }>).value
  }><MarkupElement value={props.value as Extract<MarkupValue, { $tag: "Element" }>} /></Show>;
}

function MarkupElement(props: { value: Extract<MarkupValue, { $tag: "Element" }> }) {
  const preview = createMemo(() => browserPreviewElement(props.value.tag, props.value.attrs));
  return <Dynamic {...preview().attrs} component={preview().tag}
    onClick={(event: MouseEvent) => event.preventDefault()}
    onAuxClick={(event: MouseEvent) => event.preventDefault()}
    onSubmit={(event: SubmitEvent) => event.preventDefault()}>
    <For each={props.value.children}>{node => <MarkupRead value={node} />}</For>
  </Dynamic>;
}
