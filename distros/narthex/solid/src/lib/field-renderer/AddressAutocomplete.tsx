// ---------------------------------------------------------------------------
// Address Autocomplete — remote input strategy for address fields
//
// Types in an input → debounced fetch to /api/input/address/autocomplete →
// shows dropdown of suggestions → user selects → fetches full details →
// emits structured Address object via onChange.
// ---------------------------------------------------------------------------

import { createEffect, createSignal, createUniqueId, onSettled, untrack, Show, For } from "solid-js";
import { createListboxKeys } from "../listbox-keys";
import type { TextChannel } from "@fenel/engine";
import type { Address, AddressSuggestion } from "../../../../../../implementations/typescript/api/src/google-places";

type Props = {
  value: unknown;
  onChange: (value: unknown) => void;
  placeholder?: string;
  config?: TextChannel;
  labelId?: string;
};

const API_BASE = "/api";

export function AddressAutocomplete(props: Props) {
  const debounceMs = () =>
    (typeof props.config === "object" ? props.config?.debounceMs : undefined) ?? 300;
  const minLength = () =>
    (typeof props.config === "object" ? props.config?.minLength : undefined) ?? 3;

  const [inputText, setInputText] = createSignal(untrack(() => displayValue(props.value)));
  const [suggestions, setSuggestions] = createSignal<AddressSuggestion[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const [lookupError, setLookupError] = createSignal<string>();
  const sessionToken = crypto.randomUUID();
  const listId = createUniqueId();

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let generation = 0;
  let disposed = false;
  let focused = false;
  let inputElement: HTMLInputElement | undefined;
  let observedValue = untrack(() => props.value);
  let ownChange: { value: unknown } | undefined;
  let availableSuggestions: AddressSuggestion[] = [];
  let selectableOpen = false;
  let pendingReset: { request: number; event: Event } | undefined;

  function setRows(rows: AddressSuggestion[]) {
    availableSuggestions = rows;
    setSuggestions(rows);
  }

  function setDropdownOpen(value: boolean) {
    selectableOpen = value;
    setOpen(value);
  }

  // Signals commit on the next microtask. Request ownership must change in the
  // input/reset/selection event itself, before even an already-resolved await.
  function invalidateRequests() {
    generation += 1;
    pendingReset = undefined;
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    controller?.abort();
    controller = undefined;
    setLoading(false);
    setRows([]);
    setDropdownOpen(false);
    setLookupError(undefined);
    return generation;
  }

  const current = (request: number) => !disposed && request === generation
    && (!pendingReset || pendingReset.event.defaultPrevented);

  function emit(value: unknown) {
    ownChange = { value };
    props.onChange(value);
  }

  createEffect(() => props.value, value => {
    if (Object.is(value, observedValue)) return;
    observedValue = value;
    if (ownChange && Object.is(value, ownChange.value)) {
      ownChange = undefined;
      return;
    }
    ownChange = undefined;
    invalidateRequests();
    setInputText(displayValue(value));
  });

  const keys = createListboxKeys<AddressSuggestion>({
    rows: () => open() && selectableOpen && current(generation) && suggestions() === availableSuggestions ? availableSuggestions : [],
    id: suggestion => suggestion.placeId,
    domPrefix: `${listId}-option`,
    pick: suggestion => { void selectSuggestion(suggestion); },
    close: invalidateRequests,
    resetOn: suggestions,
  });

  onSettled(() => {
    const form = inputElement?.form;
    const reset = (event: Event) => {
      // Later listeners may cancel this reset. Fence continuations now, then
      // cancel work only after dispatch confirms that the reset took place.
      const attempt = { request: generation, event };
      pendingReset = attempt;
      // Native reset runs after listeners. Restore the admitted prop after its
      // default action even if the signal already contains this same text.
      queueMicrotask(() => {
        if (pendingReset !== attempt) return;
        pendingReset = undefined;
        if (event.defaultPrevented || !current(attempt.request)) return;
        ownChange = undefined;
        invalidateRequests();
        const text = displayValue(props.value);
        setInputText(text);
        if (inputElement) inputElement.value = text;
      });
    };
    form?.addEventListener("reset", reset);
    return () => {
      disposed = true;
      generation += 1;
      pendingReset = undefined;
      availableSuggestions = [];
      selectableOpen = false;
      clearTimeout(debounceTimer);
      controller?.abort();
      form?.removeEventListener("reset", reset);
    };
  });

  function displayValue(val: unknown): string {
    if (!val) return "";
    if (typeof val === "string") return val;
    if (typeof val === "object" && "formatted" in (val as Record<string, unknown>)) {
      return (val as Address).formatted;
    }
    return String(val);
  }

  async function fetchSuggestions(input: string, request: number) {
    if (!current(request)) return;
    if (input.length < minLength()) {
      setRows([]);
      setDropdownOpen(false);
      return;
    }

    setLoading(true);
    controller = new AbortController();
    const signal = controller.signal;
    try {
      const res = await fetch(`${API_BASE}/input/address/autocomplete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          input,
          sessionToken,
        }),
      });
      if (!current(request)) return;
      if (!res.ok) {
        setRows([]);
        setLookupError("Address search failed. Try typing again.");
        return;
      }
      const data = await res.json() as { suggestions: AddressSuggestion[] };
      if (!current(request)) return;
      setRows(data.suggestions);
      setDropdownOpen(focused && data.suggestions.length > 0);
    } catch {
      if (current(request)) {
        setRows([]);
        setLookupError("Address search failed. Try typing again.");
      }
    } finally {
      if (current(request)) {
        controller = undefined;
        setLoading(false);
      }
    }
  }

  async function selectSuggestion(suggestion: AddressSuggestion) {
    // A queued signal clear can leave the old DOM visible until the next
    // microtask. Its pointer/Enter handlers may only select the current rows.
    if (!current(generation) || !selectableOpen || !availableSuggestions.includes(suggestion)) return;
    const request = invalidateRequests();
    setInputText(suggestion.label);
    setLoading(true);
    controller = new AbortController();
    const signal = controller.signal;

    try {
      const res = await fetch(`${API_BASE}/input/address/details`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({ placeId: suggestion.placeId }),
      });
      if (!current(request)) return;
      if (res.ok) {
        const address = await res.json() as Address;
        if (!current(request)) return;
        setInputText(address.formatted);
        emit(address);
      } else {
        setLookupError("Could not load this address. Search again and choose a suggestion.");
      }
    } catch {
      if (current(request)) setLookupError("Could not load this address. Search again and choose a suggestion.");
    } finally {
      if (current(request)) {
        controller = undefined;
        setLoading(false);
      }
    }
  }

  function onInput(text: string) {
    if (disposed) return;
    const request = invalidateRequests();
    setInputText(text);
    debounceTimer = setTimeout(() => { void fetchSuggestions(text, request); }, debounceMs());
    // Text is a browser draft, not a newly selected structured address. Clear
    // the previous admitted data immediately; its parent echo keeps this draft.
    emit(undefined);
  }

  return (
    <div class="fr-autocomplete">
      <div class="fr-input-wrap">
        <input
          ref={element => { inputElement = element; }}
          class="fe-input"
          type="text"
          value={inputText()}
          placeholder={props.placeholder ?? "Start typing an address..."}
          role="combobox"
          aria-labelledby={props.labelId}
          aria-label={props.labelId ? undefined : "Address"}
          aria-expanded={open() ? "true" : "false"}
          aria-controls={open() ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={keys.activeDescendant()}
          aria-busy={loading() ? "true" : "false"}
          autocomplete="off"
          onInput={(e) => onInput(e.currentTarget.value)}
          onFocus={() => { focused = true; if (availableSuggestions.length > 0) setDropdownOpen(true); }}
          onBlur={() => { focused = false; setDropdownOpen(false); }}
          onKeyDown={event => { if (open()) keys.keyDown(event); else if (event.key === "Escape") invalidateRequests(); }}
        />
        <Show when={loading()}>
          <span class="fr-autocomplete__spinner" />
        </Show>
      </div>
      <Show when={open() && suggestions().length > 0}>
        <ul id={listId} class="fr-autocomplete__list" role="listbox" aria-label="Address suggestions">
          <For each={suggestions()}>
            {(s) => (
              <li
                id={keys.optionDomId(s.placeId)}
                class={["fr-autocomplete__item", { "fr-autocomplete__item--active": keys.isActive(s) }]}
                role="option"
                aria-selected={keys.isActive(s) ? "true" : "false"}
                onMouseMove={() => keys.hover(s)}
                onPointerDown={event => event.preventDefault()}
                onClick={() => { void selectSuggestion(s); }}
              >
                <span class="fr-autocomplete__label">{s.label}</span>
                <Show when={s.secondary}>
                  <span class="fr-autocomplete__secondary">{s.secondary}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={lookupError()}>
        <p class="fr-autocomplete__error" role="alert">{lookupError()}</p>
      </Show>
    </div>
  );
}
