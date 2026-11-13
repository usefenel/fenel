// ---------------------------------------------------------------------------
// LocaleStringEditor — input(s) for a LocaleString value. LocaleString =
// `string | { [locale]: string }`; the editor tracks the current shape
// transparently:
//
//   - Single locale (default English) → plain text input
//   - Multiple locales → list of (locale, text) pairs with add/remove
//
// "+ Add locale" expands a string-shaped value into the object form,
// preserving the existing text under "en" and adding a blank entry for
// the chosen locale. Removing all but one locale collapses back to the
// string form.
//
// Used by instance/representation surfaces for interface methods whose return type
// is `{$ref: "LocaleString"}` — Labelable.label, Describable.description,
// Codeable.codeName.
// ---------------------------------------------------------------------------

import { createMemo, createSignal, For, Show } from "solid-js";
import type { LocaleString } from "@fenel/engine/types";
import { LocusSelect } from "~/lib/locus-select";

export type LocaleStringEditorProps = {
  value: LocaleString | undefined;
  onChange: (next: LocaleString) => void;
  /** Method name shown above the editor — e.g. "label". */
  methodName?: string;
};

/** Common locale options. User can also type a custom code (free-form). */
const LOCALE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
  { code: "nl", label: "Nederlands" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
  { code: "ru", label: "Русский" },
];

function toRecord(v: LocaleString | undefined): Record<string, string> {
  if (v === undefined || v === null) return { en: "" };
  if (typeof v === "string") return { en: v };
  return { ...v };
}

/** When the record collapses to a single English entry, store as string. */
function fromRecord(rec: Record<string, string>): LocaleString {
  const keys = Object.keys(rec);
  if (keys.length === 1 && keys[0] === "en") return rec.en ?? "";
  return rec;
}

export function LocaleStringEditor(props: LocaleStringEditorProps) {
  const record = () => toRecord(props.value);
  const [adding, setAdding] = createSignal(false);
  const [pendingLocale, setPendingLocale] = createSignal("");
  const [customLocale, setCustomLocale] = createSignal("");

  const usedLocales = createMemo(() => new Set(Object.keys(record())));
  const availableLocales = createMemo(() =>
    LOCALE_OPTIONS.filter((o) => !usedLocales().has(o.code)),
  );

  function update(locale: string, text: string): void {
    const next = { ...record(), [locale]: text };
    props.onChange(fromRecord(next));
  }

  function remove(locale: string): void {
    const next = { ...record() };
    delete next[locale];
    if (Object.keys(next).length === 0) next.en = "";
    props.onChange(fromRecord(next));
  }

  function addLocale(code: string): void {
    const trimmed = code.trim();
    if (!trimmed || usedLocales().has(trimmed)) return;
    const next = { ...record(), [trimmed]: "" };
    props.onChange(fromRecord(next));
    setAdding(false);
    setPendingLocale("");
    setCustomLocale("");
  }

  function localeLabel(code: string): string {
    return LOCALE_OPTIONS.find((o) => o.code === code)?.label ?? code;
  }

  return (
    <div class="locale-string-editor">
      <For keyed={false} each={Object.entries(record())}>
        {(entry) => (
          <div class="locale-string-editor__row">
            <span class="locale-string-editor__locale" data-tooltip={localeLabel(entry()[0])}>
              {entry()[0]}
            </span>
            <input
              class="locale-string-editor__input"
              type="text"
              value={entry()[1]}
              onInput={(e) => update(entry()[0], e.currentTarget.value)}
              placeholder={props.methodName ? `${props.methodName} (${entry()[0]})` : entry()[0]}
            />
            <Show when={Object.keys(record()).length > 1}>
              <button
                type="button"
                class="locale-string-editor__remove"
                onClick={() => remove(entry()[0])}
                data-tooltip={`Remove ${localeLabel(entry()[0])}`}
              >
                ×
              </button>
            </Show>
          </div>
        )}
      </For>
      <Show
        when={adding()}
        fallback={
          <button
            type="button"
            class="locale-string-editor__add"
            onClick={() => setAdding(true)}
          >
            + Add locale
          </button>
        }
      >
        <div class="locale-string-editor__add-row">
          <LocusSelect
            label="Locale"
            value={pendingLocale()}
            options={[
              ...availableLocales().map((o) => ({ value: o.code, label: `${o.code} (${o.label})` })),
              { value: "custom", label: "Type your own" },
            ]}
            // The prompt labels the trigger until a locale is picked.
            fallbackOption={{ value: "", label: "Pick a locale" }}
            onChange={code => {
              setPendingLocale(code);
              setCustomLocale("");
            }}
          />
          <Show when={pendingLocale() === "custom"}>
            <input
              class="locale-string-editor__custom"
              type="text"
              placeholder="locale code"
              value={customLocale()}
              onInput={(e) => setCustomLocale(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addLocale(e.currentTarget.value);
              }}
            />
          </Show>
          <Show when={pendingLocale()}>
            <button
              type="button"
              class="locale-string-editor__add"
              onClick={() => addLocale(pendingLocale() === "custom" ? customLocale() : pendingLocale())}
            >
              Add
            </button>
          </Show>
          <button
            type="button"
            class="locale-string-editor__cancel"
            onClick={() => {
              setAdding(false);
              setPendingLocale("");
              setCustomLocale("");
            }}
          >
            Cancel
          </button>
        </div>
      </Show>
    </div>
  );
}
