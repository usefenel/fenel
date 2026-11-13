import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { displayNameText, isCodeName, splitCodeText, type DisplayNameInput } from "./display-name";
import "./display-name.css";

/** Renders a display name; a code name gets the shared code face. */
export function DisplayNameText(props: { name: DisplayNameInput; fallback?: JSX.Element }) {
  return <Show when={displayNameText(props.name)} fallback={props.fallback}>{text =>
    <Show when={isCodeName(props.name)} fallback={text()}>
      <code class="display-name--code" data-display-name="code">{text()}</code>
    </Show>}</Show>;
}

/** Text with an optional code-name segment in the code face. */
export function TextWithCodeName(props: { text: string; code?: string }) {
  return <Show when={splitCodeText(props.text, props.code)} fallback={props.text}>{parts =>
    <>{parts()[0]}<code class="display-name--code" data-display-name="code">{parts()[1]}</code>{parts()[2]}</>}</Show>;
}
