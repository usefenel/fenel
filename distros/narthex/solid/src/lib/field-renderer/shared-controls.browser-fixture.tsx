// C1: production composite-control bodies run in Solid's browser runtime.
// The smoke builder extracts the private controls without the unrelated full
// repository acquisition. Only their nested scalar/metadata boundary is held.
import { For, createSignal } from "solid-js";
import { render } from "@solidjs/web";
import type { FenelType, Pattern, SelectOption } from "@fenel/engine/types";
// @ts-expect-error The focused smoke builder supplies the production bodies.
import { ListEditor, FreeformRecordEditor, UnionEditor, SelectEditor, SelectOptionsEditor, SegmentedInput, MaskedTextInput } from "fixture:shared-field-controls";
import { LocaleStringEditor } from "../representations/LocaleStringEditor";

type SegmentedFixtureData = { values: Record<string, string>; fields: { name: string; label: string; pattern: Pattern }[] };
const segmentedData = (globalThis as typeof globalThis & { sharedControlsSegmentedData?: SegmentedFixtureData }).sharedControlsSegmentedData;
const maskData = (globalThis as typeof globalThis & { sharedControlsMaskData?: SegmentedFixtureData & { phase: string; sourceHash: string } }).sharedControlsMaskData;

type ChipsAction = { $tag: "FieldListAppendChoice" | "FieldListRemoveOccurrence" | "FieldListToggleChoice"; index: number; expected: unknown };
type ChipsSelection = { occurrences: ({ $tag: "Nothing" } | { $tag: "Just"; _0: number })[]; selected: boolean[] };
type ChipsFixtureData = {
  value: unknown[];
  editor: { itemType: FenelType; itemTypeLabel: string; itemDefault?: unknown; choices: SelectOption[]; canonical: boolean };
  selection: ChipsSelection;
};
type ChipsSourceReply = ChipsSelection & { result: { $tag: "Ok"; _0: unknown[] } | { $tag: "Err"; _0: string }; sourceCall: number };
const chipsHost = globalThis as typeof globalThis & {
  sharedControlsChipsData?: ChipsFixtureData;
  sharedControlsChipsSource?: (value: unknown[], action?: ChipsAction) => Promise<ChipsSourceReply>;
};
const chipsData = chipsHost.sharedControlsChipsData;

function ChipsControlsFixture() {
  const data = chipsData!;
  const [value, setValue] = createSignal(data.value);
  const [selection, setSelection] = createSignal(data.selection);
  const [error, setError] = createSignal<string>();
  const [pending, setPending] = createSignal(false);
  const [changes, setChanges] = createSignal(0);
  const [submissions, setSubmissions] = createSignal(0);
  const [sourceCall, setSourceCall] = createSignal(0);
  async function sourceEdit(next: unknown[], action?: ChipsAction) {
    if (pending()) return;
    setPending(true);
    try {
      // C1 transport only: the real source boundary returns the whole candidate
      // and all ordinal facts. No browser list mutation or equality policy.
      const reply = await chipsHost.sharedControlsChipsSource!(next, action);
      setSourceCall(reply.sourceCall);
      if (reply.result.$tag === "Err") setError(reply.result._0);
      else {
        setValue(reply.result._0);
        setSelection({ occurrences: reply.occurrences, selected: reply.selected });
        setChanges(count => count + 1);
        setError(undefined);
      }
    } catch (issue) { setError(String(issue)); }
    finally { setPending(false); }
  }
  Object.assign(globalThis, { sharedControlsChipsFixture: {
    state: () => ({ value: value(), changes: changes(), submissions: submissions(), pending: pending(),
      error: error(), sourceCall: sourceCall(), selection: selection() }),
  } });
  return <main class="shared-controls-fixture">
    <header><h1>Every list item keeps its place</h1><p>Choose chips or rows while keeping the same ordered data, including repeated items.</p></header>
    <form onSubmit={event => { event.preventDefault(); setSubmissions(count => count + 1); }}>
      <section data-list-chips><h2>Food list</h2>
        <ListEditor innerType={data.editor.itemType} itemTypeLabel={data.editor.itemTypeLabel}
          itemDefault={data.editor.itemDefault} choices={data.editor.choices} canonical={data.editor.canonical}
          occurrences={selection().occurrences} selected={selection().selected} chipError={error()}
          value={value()} onChange={(next: unknown[]) => { void sourceEdit(next); }}
          onChipEdit={(action: ChipsAction) => { void sourceEdit(value(), action); }} />
        <p>Stored order: <strong data-chip-order>{value().map(item => (item as { $tag?: string })?.$tag ?? "Incomplete").join(" → ")}</strong></p>
        <p>Stored items: <strong data-chip-count>{value().length}</strong></p>
        <p>Data changes: <strong data-chip-changes>{changes()}</strong></p>
        <p>Unexpected form submissions: <strong>{submissions()}</strong></p>
      </section>
    </form>
  </main>;
}

function MaskedControlsFixture() {
  const data = maskData!;
  const [values, setValues] = createSignal<Record<string, string>>(data.values);
  let changes = 0;
  Object.assign(globalThis, { sharedControlsMaskFixture: {
    state: () => ({ values: values(), changes, phase: data.phase, sourceHash: data.sourceHash }),
  } });
  return <main class="shared-controls-fixture">
    <header><h1>Text masks keep complete separators</h1><p>Type digits and let the shared field editor supply required punctuation.</p></header>
    <form onSubmit={event => event.preventDefault()}>
      <For each={data.fields}>{field =>
        <section data-mask={field.name}><h2>{field.label}</h2>
          <MaskedTextInput pattern={field.pattern} value={values()[field.name]}
            onChange={(next: string) => { changes++; setValues(previous => ({ ...previous, [field.name]: next })); }} />
          <p>Stored data: <code>{values()[field.name] || "Empty text"}</code></p>
        </section>
      }</For>
    </form>
  </main>;
}

function SegmentedControlsFixture() {
  const data = segmentedData!;
  const [values, setValues] = createSignal<Record<string, string>>(data.values);
  let changes = 0;
  Object.assign(globalThis, { sharedControlsSegmentedFixture: {
    replace: (name: string, value: string) => setValues(previous => ({ ...previous, [name]: value })),
    state: () => ({ values: values(), changes }),
  } });
  return <main class="shared-controls-fixture">
    <header><h1>Grouped text keeps every character</h1><p>The shared field editor preserves symbols, letters and optional parts.</p></header>
    <form onSubmit={event => event.preventDefault()}>
      <For each={data.fields}>{field =>
        <section data-segmented={field.name}><h2>{field.label}</h2>
          <SegmentedInput pattern={field.pattern} value={values()[field.name]}
            onChange={(next: string) => { changes++; setValues(previous => ({ ...previous, [field.name]: next })); }} />
          <p>Stored data: <code>{values()[field.name]}</code></p>
        </section>
      }</For>
    </form>
  </main>;
}

function SharedControlsFixture() {
  // C1 fixture data is emitted from the real source-policy run. This contains
  // no browser comparison rule and does not change the production controls.
  const choiceData = (globalThis as typeof globalThis & {
    sharedControlsChoiceData?: {
      options: SelectOption[];
      selected: unknown;
      copiedUnit: unknown;
      normalizedUnit?: unknown;
      differentUnit?: unknown;
      summary: string;
    };
  }).sharedControlsChoiceData;
  const variantCapture = (globalThis as typeof globalThis & { sharedControlsVariantCapture?: boolean }).sharedControlsVariantCapture;
  const [list, setList] = createSignal<unknown[]>([12]);
  const [record, setRecord] = createSignal<Record<string, unknown>>({ count: 12 });
  const [variant, setVariant] = createSignal<{ $tag: string; amount?: number } | undefined | null>({ $tag: "Present", amount: 42 });
  const [variantToggle, setVariantToggle] = createSignal(true);
  const [variantScenario, setVariantScenario] = createSignal("");
  const [first, setFirst] = createSignal("Yes");
  const [second, setSecond] = createSignal("No");
  const [locales, setLocales] = createSignal<string | Record<string, string>>({ en: "Hello", fr: "Bonjour" });
  const [submissions, setSubmissions] = createSignal(0);
  const initialChoices = choiceData?.options ?? [
    { value: 1, label: "Number 1" },
    { value: "1", label: "Text 1" },
    { value: false, label: "Boolean false" },
    { value: "false", label: "Text false" },
    { value: [1, 2], label: "Number list" },
    { value: "1,2", label: "Text list" },
    { value: { $tag: "Unit", scale: 1, origin: 273.15 }, label: "Celsius" },
    { value: { $tag: "Unit", scale: 1, origin: 0 }, label: "Kelvin" },
    { value: { $tag: "Ready" }, label: "Ready constructor" },
    { value: "", label: "Empty text" },
  ];
  const [typedOptions, setTypedOptions] = createSignal<SelectOption[]>(initialChoices);
  const [typedChoice, setTypedChoice] = createSignal<unknown>(choiceData?.selected ?? { $tag: "Unit", scale: 1, origin: 273.15 });
  const [typedRadio, setTypedRadio] = createSignal<unknown>(choiceData?.selected ?? false);
  const [optionDraft, setOptionDraft] = createSignal<SelectOption[]>([{ value: 2, label: "Two" }]);
  const [optionTargetType, setOptionTargetType] = createSignal<FenelType | undefined>({ $ref: "Number" });
  let typedChanges = 0;
  let radioChanges = 0;
  const [variantChanges, setVariantChanges] = createSignal(0);
  let localeChanges = 0;
  const options = [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }];
  Object.assign(globalThis, { sharedControlsFixture: {
    replaceVariant: setVariant,
    setVariantToggle,
    setVariantScenario,
    resetVariantChanges: () => setVariantChanges(0),
    replaceTypedOptions: setTypedOptions,
    replaceTypedChoice: (next: unknown) => setTypedChoice(() => next),
    replaceTypedRadio: (next: unknown) => setTypedRadio(() => next),
    replaceOptionTargetType: setOptionTargetType,
    copiedUnit: choiceData?.copiedUnit,
    normalizedUnit: choiceData?.normalizedUnit,
    differentUnit: choiceData?.differentUnit,
    state: () => ({ list: list(), record: record(), variant: variant(), variantChanges: variantChanges(),
      first: first(), second: second(), locales: locales(), localeChanges, submissions: submissions(),
      typedOptions: typedOptions(), typedChoice: typedChoice(), typedRadio: typedRadio(), typedChanges, radioChanges,
      optionDraft: optionDraft() }),
  } });
  return <main class="shared-controls-fixture">
    <header><h1>{variantCapture ? "Choose the first constructor" : "Shared typed data controls"}</h1><p>{variantCapture ? "Choose Empty in an empty field." : "Editing data preserves the other fields and submits only when requested."}</p></header>
    <form onSubmit={event => { event.preventDefault(); setSubmissions(count => count + 1); }}>
      <section data-list><h2>List and open record</h2>
        <ListEditor innerType={{ $ref: "Number" }} itemTypeLabel="Number" itemDefault={0}
          value={list()} onChange={setList} />
        <div data-record><FreeformRecordEditor value={record()} onChange={setRecord} /></div>
        <p data-submissions>Unexpected form submissions: <strong>{submissions()}</strong></p>
      </section>
      <section data-variant><h2>{variantCapture ? variantScenario() : "Keep the selected case's data"}</h2>
        <UnionEditor discriminator="$tag" toggle={variantToggle()} value={variant()}
          cases={[
            { name: "Empty", fields: [], defaultValue: { $tag: "Empty" } },
            { name: "Present", fields: [{ name: "amount", type: { $ref: "Number" } }], defaultValue: { $tag: "Present", amount: 0 } },
          ]}
          onChange={(next: { $tag: string; amount?: number }) => { setVariantChanges(count => count + 1); setVariant(next); }} />
        <p>Stored amount: <strong data-amount>{variant()?.amount}</strong></p>
        {variantCapture && <>
          <p>Stored data: <code data-variant-stored>{variant() === undefined || variant() === null ? "Incomplete" : JSON.stringify(variant())}</code></p>
          <p>Data changes from choosing: <strong data-variant-changes>{variantChanges()}</strong></p>
        </>}
      </section>
      <section data-radios><h2>Independent questions</h2>
        <div data-radio-first><h3>First answer</h3><SelectEditor options={options} value={first()} onChange={setFirst} radio={true} /></div>
        <div data-radio-second><h3>Second answer</h3><SelectEditor options={options} value={second()} onChange={setSecond} radio={true} /></div>
        <p>Stored answers: <strong>{first()} / {second()}</strong></p>
      </section>
      <section data-locales><h2>Cancel an unadded locale</h2>
        <LocaleStringEditor value={locales()} onChange={next => { localeChanges++; setLocales(next); }} methodName="Greeting" />
        <p data-locale-count>Stored languages: <strong>{Object.keys(typeof locales() === "string" ? { en: locales() } : locales()).join(", ")}</strong></p>
      </section>
      <section data-typed-choice><h2>Choose typed data</h2>
        <SelectEditor options={typedOptions()} value={typedChoice()}
          onChange={(next: unknown) => { typedChanges++; setTypedChoice(() => next); }} radio={false} />
        <p>{choiceData?.summary ?? "Stored data:"} <code data-typed-choice-value>{choiceData ? "Independent typed copy" : JSON.stringify(typedChoice()) ?? "Incomplete"}</code></p>
      </section>
      <section data-typed-radio><h2>Typed radio choices</h2>
        <SelectEditor options={typedOptions()} value={typedRadio()}
          onChange={(next: unknown) => { radioChanges++; setTypedRadio(() => next); }} radio={true} />
        <p>{choiceData ? "The selected unit has exact Rational fields." : "Stored data:"} <code>{choiceData ? "Copied typed data" : JSON.stringify(typedRadio()) ?? "Incomplete"}</code></p>
      </section>
      <section data-choice-options><h2>Author numeric choices</h2>
        <SelectOptionsEditor value={optionDraft()} targetType={optionTargetType()} onChange={setOptionDraft} />
        <p>Stored options: <code>{JSON.stringify(optionDraft())}</code></p>
      </section>
    </form>
  </main>;
}

render(() => chipsData ? <ChipsControlsFixture /> : maskData ? <MaskedControlsFixture /> : segmentedData
  ? <SegmentedControlsFixture /> : <SharedControlsFixture />, document.body);
