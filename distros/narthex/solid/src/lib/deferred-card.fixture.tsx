import { For, Show, createContext, createSignal, flush, onSettled, untrack, useContext } from "solid-js";
import { render } from "@solidjs/web";
import { DeferredCard } from "./deferred-card";

const Reader = createContext("fixture-reader");
const mounts: { id: number; frame: number; reader: string }[] = [];
let frame = 0;
let frameId = 0;
function tick() { frame++; frameId = requestAnimationFrame(tick); }
frameId = requestAnimationFrame(tick);
const [open, setOpen] = createSignal(true);
function Card(props: { id: number }) {
  mounts.push({ id: untrack(() => props.id), frame, reader: useContext(Reader) });
  return <article data-rendered-card={props.id}><input aria-label={`Draft ${props.id}`} value="initial" /></article>;
}
function Fixture() {
  onSettled(() => () => cancelAnimationFrame(frameId));
  return <><style>{`
    .scroll { width: 340px; height: 240px; overflow: auto; }
    .home-card-slot { height: 120px; }
    article, .home-item--preparing { height: 120px; border: 1px solid silver; }
  `}</style><Show when={open()}><div class="scroll" data-scroll>
    <For each={Array.from({ length: 100 }, (_, index) => index)}>{id =>
      <DeferredCard label={`Card ${id}`} render={() => <Card id={id} />} />
    }</For>
  </div></Show></>;
}
const dispose = render(() => <Fixture />, document.body);
const fixture = {
  state: () => [...mounts],
  close: () => { setOpen(false); flush(); },
  dispose,
};
declare global { var deferredCardFixture: typeof fixture; }
globalThis.deferredCardFixture = fixture;
