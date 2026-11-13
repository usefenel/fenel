// Existing Solid/browser tooling exception. Production numeric controls and
// recursive read rendering are compiled by the smoke builder. Repository
// acquisition is held; all source decisions come from recorded real calls.
import { createSignal, Show } from "solid-js";
import { render } from "@solidjs/web";
// @ts-expect-error The focused builder supplies production component bodies.
import { NumberEditor, AtomicEditor, VariantValueRenderer } from "fixture:numeric-controls";
// @ts-expect-error The focused builder supplies reviewed source call results.
import { FixtureReaderContext, fixtureReader, sourceFacts, sourceInvocations, sourceBoundaryFailures } from "fixture:numeric-boundary";
import { NumberInput } from "./number-input";
import { NumericIntegerCases } from "./numeric-integer.browser-cases";

function NumericFixture() {
  const examples = sourceFacts.mode === "before" ? sourceFacts.baselineValues : sourceFacts.values;
  const [value, setValue] = createSignal<unknown>(examples.third);
  const [atomic, setAtomic] = createSignal<unknown>(examples.huge);
  const [empty, setEmpty] = createSignal<unknown>(undefined);
  const [finite, setFinite] = createSignal<unknown>(42);
  const [deepVisible, setDeepVisible] = createSignal(false);
  let changes = 0;
  let atomicChanges = 0;
  let emptyChanges = 0;
  let finiteChanges = 0;
  let saved: unknown;
  let copied: string | undefined;
  const api = {
    state: () => ({ value: value(), atomic: atomic(), empty: empty(), finite: finite(),
      changes, atomicChanges, emptyChanges, finiteChanges, saved, copied,
      invocations: sourceInvocations.map((call: { id: string; args: unknown; reader: string; throws?: unknown }) => ({
        id: call.id, argsJson: JSON.stringify(call.args), reader: call.reader, throws: call.throws,
      })), boundaryFailures: [...sourceBoundaryFailures] }),
    replace: (next: unknown) => setValue(() => next),
    reset: () => setValue(() => examples.third),
    echo: () => setValue(current => current && typeof current === "object" ? { ...current } : current),
    replaceFinite: (next: unknown) => setFinite(() => next),
    completeness: () => sourceFacts.readCases,
    showDeep: () => setDeepVisible(true),
    save: () => { saved = JSON.parse(JSON.stringify(value())); copied = JSON.stringify(value()); },
  };
  Object.assign(globalThis, { numericTextFixture: api });
  return <FixtureReaderContext value={fixtureReader}>
    <main class="numeric-fixture">
      <header><h1>Exact numbers</h1><p>Shared typed number controls and recursive data rendering.</p></header>
      <div class="numeric-fixture-grid">
        <section data-exact><h2>A fraction</h2><label id="exact-label">Rational</label>
          <NumberEditor plan={sourceFacts.plan} name="exact" labelId="exact-label" required
            value={value()} onChange={(next: unknown) => { changes++; setValue(() => next); }} />
          <p>Data: <span data-exact-read><VariantValueRenderer type={sourceFacts.types.rational} value={value()} /></span></p>
          <div class="numeric-fixture-actions"><button type="button" onClick={api.save}>Save and copy JSON</button>
            <button type="button" onClick={api.reset}>Reset</button></div>
        </section>
        <section data-atomic><h2>Large exact fraction</h2><label>Rational literal</label>
          <AtomicEditor type={sourceFacts.types.rational} typeName="Rational" value={atomic()}
            onChange={(next: unknown) => { atomicChanges++; setAtomic(() => next); }} />
          <p>Data: <span data-atomic-read><VariantValueRenderer type={sourceFacts.types.rational} value={atomic()} /></span></p>
        </section>
        <section data-arithmetic><h2>Exact arithmetic</h2><p>0.1 + 0.2</p>
          <p class="numeric-fixture-result"><VariantValueRenderer type={sourceFacts.types.rational} value={examples.sum} /></p>
          <p>Shared recursive data:</p><div data-recursive-read><VariantValueRenderer type={sourceFacts.types.record} value={examples.record} /></div>
          <p>List of anything:</p><div data-any-read><VariantValueRenderer type={sourceFacts.types.anyList} value={examples.anyList} /></div>
        </section>
        <section data-empty><h2>An incomplete number</h2><label>Rational</label>
          <NumberEditor plan={sourceFacts.plan} value={empty()}
            onChange={(next: unknown) => { emptyChanges++; setEmpty(() => next); }} />
          <p data-empty-state>{empty() === undefined ? "Incomplete" : JSON.stringify(empty())}</p>
        </section>
        <section data-finite><h2>Floating Number</h2>
          <NumberInput class="fe-input" ariaLabel="Finite Number" value={finite()}
            onChange={(next: unknown) => { finiteChanges++; setFinite(() => next); }} />
        </section>
        <Show when={sourceFacts.mode === "after"}><section data-completeness><h2>All admitted representations</h2>
          <div data-read-case="native-five"><VariantValueRenderer type={sourceFacts.types.rational} value={sourceFacts.readCases.nativeFive} /></div>
          <div data-read-case="hybrid-five"><VariantValueRenderer type={sourceFacts.types.rational} value={sourceFacts.readCases.hybridFive} /></div>
          <div data-read-case="pure-five"><VariantValueRenderer type={sourceFacts.types.rational} value={sourceFacts.readCases.pureFive} /></div>
          <div data-read-case="literal-false-five"><VariantValueRenderer type={sourceFacts.types.rational} value={sourceFacts.readCases.literalFalseFive} /></div>
          <div data-read-case="numeric-sixty"><VariantValueRenderer type={sourceFacts.types.rational} value={sourceFacts.readCases.numericSixty} /></div>
          <div data-read-case="pure-sixty"><VariantValueRenderer type={sourceFacts.types.rational} value={sourceFacts.readCases.pureSixty} /></div>
          <div data-read-case="any-representations"><VariantValueRenderer type={sourceFacts.types.anyList} value={sourceFacts.readCases.anyRepresentations} /></div>
          <div data-read-case="pure-zero"><VariantValueRenderer type={sourceFacts.types.rational} value={sourceFacts.readCases.pureZero} /></div>
          <Show when={deepVisible()}>
            <div data-read-case="deep-pure"><VariantValueRenderer type={sourceFacts.types.rational} value={sourceFacts.readCases.deepPure} /></div>
            <div data-read-case="compact-deep"><VariantValueRenderer compact type={sourceFacts.types.rational} value={sourceFacts.readCases.deepPure} /></div>
          </Show>
          <div data-read-case="incomplete-pure"><VariantValueRenderer type={sourceFacts.types.rational} value={sourceFacts.readCases.incompletePure} /></div>
          <div data-read-case="record-no-tag"><VariantValueRenderer type={sourceFacts.types.unlabelledRecord} value={sourceFacts.readCases.taggedRecord} /></div>
          <div data-read-case="record-declared-tag"><VariantValueRenderer type={sourceFacts.types.taggedRecord} value={sourceFacts.readCases.taggedRecord} /></div>
        </section></Show>
        <Show when={sourceFacts.integerCases}><NumericIntegerCases /></Show>
      </div>
      <footer>Focused browser fixture · production components · {sourceFacts.mode === "before" ? "historical floating Number data" : "exact numeric data"} · recorded source results · repository acquisition held</footer>
    </main>
  </FixtureReaderContext>;
}

render(() => <NumericFixture />, document.body);
