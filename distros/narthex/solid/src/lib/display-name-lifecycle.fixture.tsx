import { render } from "@solidjs/web";
import { Errored, Loading, createMemo, createSignal } from "solid-js";
import { TooltipLayer } from "./tooltip";
import { DisplayNameText, TextWithCodeName } from "./display-name-text";
import { codeName, type DisplayName } from "./display-name";

// Lightweight entry for the existing display-name browser runner. The static
// card/menu screenshot fixture also loads the engine; these lifetime controls
// need only the real shared readonly renderers and document tooltip layer.
type LifecycleControls = {
  setText: (text: string) => void;
  setCode: (code: string | undefined) => void;
  setName: (name: DisplayName | undefined) => void;
  startPending: () => void;
  releasePending: () => void;
  dispose: () => void;
};
const dispose = render(() => {
  const [text, setText] = createSignal("s: missing data");
  const [code, setCode] = createSignal<string | undefined>("s");
  const [name, setName] = createSignal<DisplayName | undefined>(codeName("s"));
  const [pending, setPending] = createSignal(false);
  let release: (() => void) | undefined;
  const ready = createMemo(() => pending() ? new Promise<string>(resolve => { release = () => resolve("Ready"); }) : "Ready");
  (globalThis as { displayNameLifecycle?: LifecycleControls }).displayNameLifecycle = {
    setText, setCode, setName, startPending: () => setPending(true), releasePending: () => release?.(), dispose: () => dispose(),
  };
  return <Errored fallback={error => <pre data-lifecycle-error>{String(error())}</pre>}>
    <Loading fallback={<span data-lifecycle-pending>Pending</span>}>
      <main style="padding:24px;display:grid;gap:24px;">
        <button data-lifecycle-target="first" data-tooltip="s: missing data" data-tooltip-code="s">First</button>
        <button data-lifecycle-target="next" data-tooltip="next: missing data" data-tooltip-code="next">Next</button>
        <button data-lifecycle-target="same" data-tooltip="s: missing data" data-tooltip-code="missing">Same label, different code</button>
        <button data-lifecycle-dismiss>Outside</button>
        <span data-lifecycle-text><TextWithCodeName text={text()} code={code()} /></span>
        <span data-lifecycle-name><DisplayNameText name={name()} fallback="Unnamed" /></span>
        <span data-lifecycle-ready>{ready()}</span>
      </main>
      <TooltipLayer />
    </Loading>
  </Errored>;
}, document.body.appendChild(document.createElement("div")));
