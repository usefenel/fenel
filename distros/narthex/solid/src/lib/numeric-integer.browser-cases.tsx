// Existing Solid/browser tooling exception. These cases compose the extracted
// production controls; admitted data and text decisions remain source-owned.
import { createSignal, Show } from "solid-js";
// @ts-expect-error The focused builder supplies production component bodies.
import { NumberEditor, AtomicEditor, VariantValueRenderer } from "fixture:numeric-controls";
// @ts-expect-error The focused builder supplies reviewed source call results.
import { sourceFacts } from "fixture:numeric-boundary";

type IntegerSlot = "int" | "nat" | "intAtomic" | "natAtomic" | "aliasInt" | "aliasNat"
  | "aliasAtomicInt" | "aliasAtomicNat" | "empty";

/** Mounted inside the main fixture's captured FixtureReaderContext. */
export function NumericIntegerCases() {
  const cases = sourceFacts.integerCases;
  const examples = sourceFacts.mode === "before" ? cases.baselineValues : cases.values;
  const initial = {
    int: examples.intInitial,
    nat: examples.natInitial,
    intAtomic: examples.intHuge,
    natAtomic: examples.natHuge,
    aliasInt: examples.intHuge,
    aliasNat: examples.natHuge,
    aliasAtomicInt: examples.intHuge,
    aliasAtomicNat: examples.natHuge,
    empty: undefined,
  };
  const [int, setInt] = createSignal<unknown>(initial.int);
  const [nat, setNat] = createSignal<unknown>(initial.nat);
  const [intAtomic, setIntAtomic] = createSignal<unknown>(initial.intAtomic);
  const [natAtomic, setNatAtomic] = createSignal<unknown>(initial.natAtomic);
  const [aliasInt, setAliasInt] = createSignal<unknown>(initial.aliasInt);
  const [aliasNat, setAliasNat] = createSignal<unknown>(initial.aliasNat);
  const [aliasAtomicInt, setAliasAtomicInt] = createSignal<unknown>(initial.aliasAtomicInt);
  const [aliasAtomicNat, setAliasAtomicNat] = createSignal<unknown>(initial.aliasAtomicNat);
  const [empty, setEmpty] = createSignal<unknown>(undefined);
  const [visible, setVisible] = createSignal(false);
  const slots = {
    int: { read: int, set: setInt },
    nat: { read: nat, set: setNat },
    intAtomic: { read: intAtomic, set: setIntAtomic },
    natAtomic: { read: natAtomic, set: setNatAtomic },
    aliasInt: { read: aliasInt, set: setAliasInt },
    aliasNat: { read: aliasNat, set: setAliasNat },
    aliasAtomicInt: { read: aliasAtomicInt, set: setAliasAtomicInt },
    aliasAtomicNat: { read: aliasAtomicNat, set: setAliasAtomicNat },
    empty: { read: empty, set: setEmpty },
  };
  const changes: Record<IntegerSlot, number> = {
    int: 0, nat: 0, intAtomic: 0, natAtomic: 0, aliasInt: 0, aliasNat: 0,
    aliasAtomicInt: 0, aliasAtomicNat: 0, empty: 0,
  };
  let saved: unknown;
  let savedKey: IntegerSlot | undefined;
  let copied: string | undefined;
  let copiedKey: IntegerSlot | undefined;
  const cloned = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const replace = (key: IntegerSlot, value: unknown) => slots[key].set(() => value);
  const changed = (key: IntegerSlot, value: unknown) => { changes[key]++; replace(key, value); };
  const api = {
    state: () => ({
      int: int(), nat: nat(), intAtomic: intAtomic(), natAtomic: natAtomic(),
      aliasInt: aliasInt(), aliasNat: aliasNat(),
      aliasAtomicInt: aliasAtomicInt(), aliasAtomicNat: aliasAtomicNat(), empty: empty(),
      intChanges: changes.int, natChanges: changes.nat,
      intAtomicChanges: changes.intAtomic, natAtomicChanges: changes.natAtomic,
      aliasIntChanges: changes.aliasInt, aliasNatChanges: changes.aliasNat,
      aliasAtomicIntChanges: changes.aliasAtomicInt, aliasAtomicNatChanges: changes.aliasAtomicNat,
      emptyChanges: changes.empty,
      saved, savedKey, copied, copiedKey, sourceResults: cases.sourceResults,
    }),
    show: () => setVisible(true),
    replace,
    copiedEcho: (key: IntegerSlot = "int") => replace(key, cloned(slots[key].read())),
    reset: (key?: IntegerSlot) => {
      if (key) replace(key, initial[key]);
      else for (const slot of Object.keys(slots) as IntegerSlot[]) replace(slot, initial[slot]);
    },
    save: (key: IntegerSlot = "int") => { savedKey = key; saved = cloned(slots[key].read()); return saved; },
    restore: () => { if (savedKey) replace(savedKey, cloned(saved)); },
    copy: (key: IntegerSlot = "int") => { copiedKey = key; copied = JSON.stringify(slots[key].read()); return copied; },
    facts: () => cases,
  };
  Object.assign(globalThis, { numericIntegerFixture: api });

  return <Show when={visible()}>
    <section data-integer-proof>
      <h2>Exact integers and natural numbers</h2>
      <div class="numeric-fixture-grid">
        <section data-integer-case="int">
          <h2>Integer data</h2><label id="integer-int-label">Int</label>
          <NumberEditor plan={cases.plans.int} name="integer-int" labelId="integer-int-label" required
            value={int()} onChange={(value: unknown) => changed("int", value)} />
          <p>Data: <span data-integer-read="int"><VariantValueRenderer type={cases.types.int} value={int()} /></span></p>
        </section>
        <section data-integer-case="nat">
          <h2>Natural number data</h2><label id="integer-nat-label">Nat</label>
          <NumberEditor plan={cases.plans.nat} name="integer-nat" labelId="integer-nat-label" required
            value={nat()} onChange={(value: unknown) => changed("nat", value)} />
          <p>Data: <span data-integer-read="nat"><VariantValueRenderer type={cases.types.nat} value={nat()} /></span></p>
        </section>
        <section data-integer-case="int-atomic">
          <h2>Large integer literal</h2><label>Int</label>
          <AtomicEditor type={cases.types.int} typeName="Int" value={intAtomic()}
            onChange={(value: unknown) => changed("intAtomic", value)} />
          <p>Data: <span data-integer-read="int-atomic"><VariantValueRenderer type={cases.types.int} value={intAtomic()} /></span></p>
        </section>
        <section data-integer-case="nat-atomic">
          <h2>Large natural number literal</h2><label>Nat</label>
          <AtomicEditor type={cases.types.nat} typeName="Nat" value={natAtomic()}
            onChange={(value: unknown) => changed("natAtomic", value)} />
          <p>Data: <span data-integer-read="nat-atomic"><VariantValueRenderer type={cases.types.nat} value={natAtomic()} /></span></p>
        </section>
        <section data-integer-case="int-alias">
          <h2>Integer alias</h2><label id="integer-int-alias-label">ℤ</label>
          <NumberEditor plan={cases.plans.intAlias} name="integer-int-alias" labelId="integer-int-alias-label"
            value={aliasInt()} onChange={(value: unknown) => changed("aliasInt", value)} />
          <p>Data: <span data-integer-read="int-alias"><VariantValueRenderer type={cases.types.intAlias} value={aliasInt()} /></span></p>
        </section>
        <section data-integer-case="nat-alias">
          <h2>Natural number alias</h2><label id="integer-nat-alias-label">ℕ</label>
          <NumberEditor plan={cases.plans.natAlias} name="integer-nat-alias" labelId="integer-nat-alias-label"
            value={aliasNat()} onChange={(value: unknown) => changed("aliasNat", value)} />
          <p>Data: <span data-integer-read="nat-alias"><VariantValueRenderer type={cases.types.natAlias} value={aliasNat()} /></span></p>
        </section>
        <section data-integer-case="int-atomic-alias">
          <h2>Integer alias literal</h2><label>ℤ</label>
          <AtomicEditor type={cases.types.intAlias} typeName="ℤ" value={aliasAtomicInt()}
            onChange={(value: unknown) => changed("aliasAtomicInt", value)} />
          <p>Data: <span data-integer-read="int-atomic-alias"><VariantValueRenderer type={cases.types.intAlias} value={aliasAtomicInt()} /></span></p>
        </section>
        <section data-integer-case="nat-atomic-alias">
          <h2>Natural number alias literal</h2><label>ℕ</label>
          <AtomicEditor type={cases.types.natAlias} typeName="ℕ" value={aliasAtomicNat()}
            onChange={(value: unknown) => changed("aliasAtomicNat", value)} />
          <p>Data: <span data-integer-read="nat-atomic-alias"><VariantValueRenderer type={cases.types.natAlias} value={aliasAtomicNat()} /></span></p>
        </section>
        <section data-integer-case="empty">
          <h2>An incomplete integer</h2><label id="integer-empty-label">Int</label>
          <NumberEditor plan={cases.plans.int} name="integer-empty" labelId="integer-empty-label"
            value={empty()} onChange={(value: unknown) => changed("empty", value)} />
          <p data-integer-empty-state>{empty() === undefined ? "Incomplete" : JSON.stringify(empty())}</p>
        </section>
      </div>
    </section>
  </Show>;
}
