// Existing Solid/browser tooling exception. The builder supplies the actual
// universal editor and records only outcomes from real source APIs.
import { createSignal, For, Show } from "solid-js";
import { render } from "@solidjs/web";
// @ts-expect-error The focused builder supplies the production editor body.
import { NativeRepresentationEditor, RecordEditor, VariantEditor } from "fixture:representation-controls";
// @ts-expect-error The focused builder supplies the actual private main controls.
import { MainRecordEditor, MainUnionEditor } from "fixture:representation-fields";
// @ts-expect-error The focused builder supplies reviewed source outcomes.
import { FixtureReaderContext, fixtureReader, sourceFacts, sourceInvocations, sourceBoundaryErrors, fixtureGetterValue, fixtureGetterReads, fixtureMainGetterValue, fixtureVariantGetterValue, fixtureAncestorGetterValue, fixtureAncestorGetterReads } from "fixture:representation-boundary";

function AncestorGetterCase(props: { variant?: boolean }) {
  const name = props.variant ? "ancestor-variant-getter" : "ancestor-record-getter";
  const [value, setValue] = createSignal<unknown>(props.variant ? sourceFacts.values.positionalPayload : sourceFacts.values.thirdPure);
  let changes = 0;
  sourceFacts.fixtureCases[name] = {
    state: () => ({ value: value(), changes, ancestorGetterReads: fixtureAncestorGetterReads() }),
    replace: (next: unknown) => setValue(() => next),
  };
  const change = (next: unknown) => { changes++; setValue(() => next); };
  return <section data-representation-case={name}><h2>Readable child · unreadable ancestor {props.variant ? "variant" : "record"}</h2>
    <Show when={props.variant} fallback={<RecordEditor type={sourceFacts.getterType} fields={sourceFacts.getterType.$record.fields}
      path={[]} recordValues={fixtureAncestorGetterValue} value={value()} onChange={change} />}>
      <VariantEditor type={sourceFacts.mainVariantType} view={sourceFacts.mainVariantView} path={[]}
        recordValues={fixtureAncestorGetterValue} value={value()} onChange={change} />
    </Show>
  </section>;
}

function MainLeafCase(props: { name: string; label: string; variant?: boolean; initial: unknown; getter?: boolean }) {
  const [value, setValue] = createSignal<unknown>(props.initial);
  let changes = 0;
  sourceFacts.fixtureCases[props.name] = {
    state: () => props.getter ? { changes, getterReads: fixtureGetterReads(), originalRetained: value() === props.initial }
      : { value: value(), changes },
    replace: (next: unknown) => setValue(() => next),
  };
  return <section data-representation-case={props.name}><h2>{props.label}</h2>
    <Show when={props.variant} fallback={<MainRecordEditor fields={sourceFacts.mainRecordFields} value={value()}
      onChange={(next: unknown) => { changes++; setValue(() => next); }} />}>
      <MainUnionEditor discriminator={sourceFacts.mainUnionPlan.discriminator} cases={sourceFacts.mainUnionPlan.cases}
        toggle={sourceFacts.mainUnionPlan.toggle} value={value()} onChange={(next: unknown) => { changes++; setValue(() => next); }} />
    </Show>
    <Show when={!props.getter}><p class="representation-fixture-state" data-model>Model: {JSON.stringify(value())}</p></Show>
  </section>;
}

function GetterCase() {
  const [value, setValue] = createSignal<unknown>(fixtureGetterValue);
  let changes = 0;
  sourceFacts.fixtureCases.getter = {
    state: () => ({ changes, getterReads: fixtureGetterReads(), originalRetained: value() === fixtureGetterValue }),
    replace: (next: unknown) => setValue(() => next),
  };
  return <section data-representation-case="getter"><h2>Unreadable record field</h2>
    <RecordEditor type={sourceFacts.getterType} fields={sourceFacts.getterType.$record.fields}
      path={[]} value={value()} onChange={(next: unknown) => { changes++; setValue(() => next); }} />
    <p class="representation-fixture-state">Getter calls: {fixtureGetterReads()}</p>
  </section>;
}

function RepresentationCase(props: { name: string; label: string; typeName: string; initial: unknown }) {
  const [value, setValue] = createSignal<unknown>(props.initial);
  let changes = 0;
  const state = () => ({ value: value(), changes });
  sourceFacts.fixtureCases[props.name] = { state, replace: (next: unknown) => setValue(() => next) };
  return <section data-representation-case={props.name}>
    <h2>{props.label}</h2>
    <NativeRepresentationEditor type={{ $ref: props.typeName }} typeName={props.typeName}
      path={[]} value={value()} onChange={(next: unknown) => { changes++; setValue(() => next); }} />
    <p class="representation-fixture-state" data-model>Model: {JSON.stringify(value()) ?? "Incomplete"}</p>
  </section>;
}

function RepresentationFixture() {
  const examples = sourceFacts.mode === "before" ? sourceFacts.baselineValues : sourceFacts.values;
  sourceFacts.fixtureCases = {};
  Object.assign(globalThis, { representationModesFixture: {
    state: () => Object.fromEntries(Object.entries(sourceFacts.fixtureCases).map(([name, item]) => [name, (item as { state: () => unknown }).state()])),
    replace: (name: string, next: unknown) => sourceFacts.fixtureCases[name].replace(next),
    invocations: () => sourceInvocations,
    boundaryErrors: () => sourceBoundaryErrors,
  } });
  return <FixtureReaderContext value={fixtureReader}>
    <main class="representation-fixture">
      <header><h1>Number representations</h1><p>The same data, through the shared typed editor.</p></header>
      <div class="representation-fixture-grid">
        <RepresentationCase name="third" label="One third · Rational" typeName="Rational" initial={examples.third} />
        <RepresentationCase name="huge" label="Large exact fraction · Rational" typeName="Rational" initial={examples.huge} />
        <div class="representation-fixture-extra">
          <RepresentationCase name="empty" label="Create Rational data" typeName="Rational" initial={undefined} />
          <RepresentationCase name="int" label="Large negative integer · Int" typeName="Int" initial={examples.intHuge} />
          <RepresentationCase name="nat" label="Large natural number · Nat" typeName="Nat" initial={examples.natHuge} />
          <RepresentationCase name="int-small" label="Small integer · Int" typeName="Int" initial={examples.intSmall} />
          <RepresentationCase name="nat-small" label="Small natural number · Nat" typeName="Nat" initial={examples.natSmall} />
          <RepresentationCase name="int-union-replace" label="Integer representation follows replaced data" typeName="Int" initial={examples.intHuge} />
          <RepresentationCase name="nat-union-replace" label="Natural representation follows replaced data" typeName="Nat" initial={examples.natHuge} />
          <RepresentationCase name="pos-rational" label="Source positional Rational" typeName="Rational" initial={examples.positionalRational} />
          <RepresentationCase name="pos-int" label="Source positional Int" typeName="Int" initial={examples.positionalInt} />
          <RepresentationCase name="pos-nat" label="Source positional Nat Succ" typeName="Nat" initial={examples.positionalNat} />
          <MainLeafCase name="main-record" label="Main field record · positional Int" initial={examples.positionalInt} />
          <MainLeafCase name="main-variant" label="Main field variant · positional Payload" variant initial={examples.positionalPayload} />
          <Show when={sourceFacts.mode === "after"}>
            <RepresentationCase name="duplicate" label="Conflicting physical record slots" typeName="Rational" initial={examples.duplicateRational} />
            <RepresentationCase name="unknown-slots" label="Unknown constructor slots" typeName="Rational" initial={examples.unknownRational} />
            <GetterCase />
            <MainLeafCase name="main-record-duplicate" label="Main field record · duplicate slots" initial={examples.duplicateInt} />
            <MainLeafCase name="main-variant-duplicate" label="Main field variant · duplicate slots" variant initial={examples.duplicatePayload} />
            <MainLeafCase name="main-record-getter" label="Main field record · unreadable descriptor" getter initial={fixtureMainGetterValue} />
            <MainLeafCase name="main-variant-getter" label="Main field variant · unreadable descriptor" variant getter initial={fixtureVariantGetterValue} />
            <AncestorGetterCase />
            <AncestorGetterCase variant />
          </Show>
          <For each={["missing", "conflict", "unreadable"]}>{(scenario) =>
            <FixtureReaderContext value={fixtureReader.forScenario(scenario)}>
              <RepresentationCase name={scenario} label={`Unavailable representation · ${scenario}`} typeName="Rational" initial={examples.third} />
            </FixtureReaderContext>
          }</For>
        </div>
      </div>
      <footer>Focused fixture · actual production editor · {sourceFacts.mode === "before" ? "historical floating model and two original modes" : "exact source data and three representation modes"} · recorded source outcomes · repository acquisition held</footer>
    </main>
  </FixtureReaderContext>;
}

render(() => <RepresentationFixture />, document.body);
