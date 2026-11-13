// ---------------------------------------------------------------------------
// CountrySelect — searchable dropdown with flag emoji
//
// Registered as a component under "country-select". Used when a ref field
// points to an entity whose defaultTemplate has editComponent: "country-select".
//
// Generic enough for any entity with staticData that has _flag + name fields.
// ---------------------------------------------------------------------------

import { createSignal, createMemo, For, Show, onCleanup } from "solid-js";
import type { RefOption } from "@fenel/engine/types";
import { canonical } from "@fenel/engine/locale";

type Props = {
  options: RefOption[];
  value: unknown;
  onChange: (v: unknown) => void;
  placeholder?: string;
};

export function CountrySelect(props: Props) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal("");
  let containerRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  const selected = createMemo(() => {
    const val = props.value;
    if (!val) return null;
    return props.options.find((o) => o.value === val) ?? null;
  });

  const filtered = createMemo(() => {
    const q = search().toLowerCase().trim();
    if (!q) return props.options;
    return props.options.filter((o) => {
      const d = o.data as Record<string, unknown> | undefined;
      const name = canonical(o.label).toLowerCase();
      const code = String(o.value).toLowerCase();
      const dial = d?.dialCode ? String(d.dialCode) : "";
      return name.includes(q) || code.includes(q) || dial.includes(q);
    });
  });

  function getFlag(opt: RefOption): string {
    const d = opt.data as Record<string, unknown> | undefined;
    return (d?._flag as string) ?? "";
  }

  function handleSelect(val: string) {
    props.onChange(val || null);
    setOpen(false);
    setSearch("");
  }

  function handleToggle() {
    const next = !open();
    setOpen(next);
    if (next) {
      setSearch("");
      requestAnimationFrame(() => inputRef?.focus());
    }
  }

  // Close on click outside
  function handleClickOutside(e: MouseEvent) {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      setOpen(false);
      setSearch("");
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("mousedown", handleClickOutside);
    onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      setSearch("");
    }
  }

  return (
    <div class="cs-container" ref={containerRef} onKeyDown={handleKeyDown}>
      <button type="button" class="cs-trigger fe-input" onClick={handleToggle}>
        <Show when={selected()} fallback={
          <span class="cs-placeholder">{props.placeholder ?? "Select country..."}</span>
        }>
          {(sel) => (
            <span class="cs-selected">
              <span class="cs-flag">{getFlag(sel())}</span>
              {canonical(sel().label)}
            </span>
          )}
        </Show>
        <span class="cs-chevron">{open() ? "\u25B4" : "\u25BE"}</span>
      </button>

      <Show when={open()}>
        <div class="cs-dropdown">
          <input
            ref={inputRef}
            class="cs-search fe-input"
            type="text"
            placeholder="Search..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <div class="cs-options">
            <Show when={filtered().length > 0}>
              <For each={filtered()}>
                {(opt) => {
                  const d = opt.data as Record<string, unknown> | undefined;
                  return (
                    <button
                      type="button"

                      class={["cs-option", { "cs-option--selected": !!(opt.value === props.value) }]}
                      onClick={() => handleSelect(opt.value)}
                    >
                      <span class="cs-flag">{getFlag(opt)}</span>
                      <span class="cs-option-label">{canonical(opt.label)}</span>
                      <Show when={d?.dialCode}>
                        <span class="cs-option-meta">{String(d!.dialCode)}</span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
