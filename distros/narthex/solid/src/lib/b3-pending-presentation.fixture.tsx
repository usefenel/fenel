import { render } from "@solidjs/web";
import { createMemo, createSignal, Show } from "solid-js";
import * as cards from "./value-card";
import { CardLoadingIndicator, ValueCard, ValueCardCaption } from "./value-card";
import { humanName } from "./display-name";

// Controlled failed/pending/answered presentation states, rendered by the
// actual card chrome. The smoke runner also extracts Home's actual Call footer.
// The optional first-B3 baseline keeps the historical row-size comparison.
const legacyBaseline = !!(globalThis as { b3LegacyBaseline?: boolean }).b3LegacyBaseline;
const [pending, setPending] = createSignal(true);
const [typeFailed, setTypeFailed] = createSignal(true);
const [typeReady, setTypeReady] = createSignal(false);
(globalThis as { b3Complete?: () => void }).b3Complete = () => setPending(false);
(globalThis as { b3TypeComplete?: () => void }).b3TypeComplete = () => setTypeReady(true);
let typeRetries = 0;
(globalThis as { b3TypeRetries?: () => number }).b3TypeRetries = () => typeRetries;
// The baseline card module (the first B3 cut) has no RowPending export.
const RowPending = (cards as { RowPending?: () => unknown }).RowPending as (() => never) | undefined ?? (() => null as never);
const pendingRow = () => legacyBaseline
  ? <CardLoadingIndicator /> /* the first B3 cut: a card-sized loader that grew the row */
  : <RowPending />;

render(() => <main style="padding:24px;font-family:Arial,sans-serif;max-width:860px;margin:auto;display:grid;gap:24px;">
  <section style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
    <div data-card="named" style="height:120px"><ValueCard heading={<ValueCardCaption caption={pending() ? "" : humanName("Reversed words") as never}
      captionPending={pending()} typePending={pending()} typeLabel="String" typeIcon="type" />}>
      <span>{pending() ? <CardLoadingIndicator /> : "fox brown quick the"}</span></ValueCard></div>
    <div data-card="failed" style="height:120px"><ValueCard heading={<ValueCardCaption caption={pending() ? "" : "Double"}
      captionPending={pending()} onCaptionRetry={pending() && !legacyBaseline ? () => {} : undefined} typeLabel="Function" typeIcon="function-square" />}>
      <span>Number → Number</span></ValueCard></div>
    <div data-card="ready" style="height:120px"><ValueCard heading={<ValueCardCaption caption={humanName("Reversed words") as never}
      typeLabel="String" typeIcon="type" />}>
      <span>fox brown quick the</span></ValueCard></div>
    <div data-card="failed-type" style="height:120px"><ValueCard heading={<ValueCardCaption caption="Answer"
      typePending={!typeReady()} onTypeRetry={typeFailed() ? () => { typeRetries++; setTypeFailed(false); } : undefined}
      typeLabel="Number" typeIcon="hash" />}>
      <span>42</span></ValueCard></div>
  </section>
  <section>
    <table class="virtual-table__table" style="width:100%;border-collapse:collapse"><tbody>
      <tr data-row="first" class="virtual-table__row"><th scope="row" class="virtual-table__row-header"><span class="virtual-table__caption">Row 1</span></th>
        <td><div class="virtual-table__cell"><Show when={!pending()} fallback={pendingRow()}>42</Show></div></td></tr>
      <tr data-row="second" class="virtual-table__row"><th scope="row" class="virtual-table__row-header"><span class="virtual-table__caption">Row 2</span></th>
        <td><div class="virtual-table__cell">17</div></td></tr>
    </tbody></table>
  </section>
  <section data-calendar style="display:flex;gap:8px;">
    <div class="home-calendar__item" data-item="pending" style="border:1px solid #e2e8f0;padding:6px;border-radius:6px;min-width:140px">
      <div class="home-calendar__item-body"><Show when={!pending()} fallback={legacyBaseline ? <em>(none)</em> : <RowPending />}>12:30</Show></div></div>
  </section>
  <section id="b3-call-footer" aria-label="Call result" />
</main>, document.body.appendChild(document.createElement("div")));
(globalThis as { b3Fixture?: boolean }).b3Fixture = true;
