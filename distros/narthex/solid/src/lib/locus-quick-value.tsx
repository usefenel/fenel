// ---------------------------------------------------------------------------
// locus-quick-value — the small card that appears WHERE YOU RIGHT-CLICKED.
//
// Right-click -> New -> Text -> String used to open the full-width composer:
// a Label field, a type summary, an expression mode picker, representation
// panels and local bindings, for a value whose whole content is a line of
// text. Rom asked for the other end of the spectrum — "a small box literally
// where we click... the expression block but in a small version" — with the
// full modal kept for anything that needs `use` mode.
//
// This is the specialised end of the general-editor/UX-sugar spectrum, not a
// second editor: it handles ONLY types with a direct inline shape, and every
// other type still routes to the composer. The escape hatch out of it is
// always one click away.
// ---------------------------------------------------------------------------

// The typed in-place editor lives behind TypedReadValue's existing lazy import.
import { Show, createSignal, onCleanup, onSettled } from "solid-js";
import "./locus-quick-value.css";

/** The inline shapes this card knows how to author directly. Anything else is
 *  the full composer's job — a constructor pick, a record, a lambda. */
export type QuickValueShape = "text" | "number" | "date" | "boolean";

/** Which shape (if any) a type can be typed straight into. Deliberately a
 *  small, explicit table rather than a guess: offering a text box for a type
 *  whose values are constructor picks would be worse than not offering one. */
export function quickValueShape(typeName: string | undefined): QuickValueShape | undefined {
  switch (typeName) {
    case "String": case "Text": case "Char": case "Url": case "URL": case "Slug": case "Identifier":
      return "text";
    case "Number": case "Int": case "Nat": case "PositiveNat": case "NonNegInt": case "Real": case "Rational":
      return "number";
    case "Date":
      return "date";
    case "Boolean": case "Bool":
      return "boolean";
    default:
      return undefined;
  }
}

/** Parse what was typed into the value the type denotes. Returns `undefined`
 *  when the text is not a value of that shape, so the card can refuse rather
 *  than save something the type does not contain. */
function readValue(shape: QuickValueShape, raw: string): unknown {
  if (shape === "text") return raw;
  if (shape === "boolean") return raw === "true";
  if (shape === "date") return raw.length > 0 ? raw : undefined;
  const n = Number(raw.trim());
  return raw.trim().length > 0 && Number.isFinite(n) ? n : undefined;
}

export function LocusQuickValue(props: {
  typeName: string;
  shape: QuickValueShape;
  /** Viewport position of the click that opened it. */
  x: number;
  y: number;
  onCommit: (value: unknown) => void | Promise<void>;
  /** "I need the real editor after all" — always one click away. */
  onOpenFull: () => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = createSignal(props.shape === "boolean" ? "true" : "");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let card!: HTMLDivElement;
  let input!: HTMLInputElement;

  onSettled(() => {
    input?.focus();
    const outside = (event: Event) => {
      // Home's leave guard must see the draft before the click reaches it.
      if (event.target instanceof Element && event.target.closest("[data-home-navigation]")) return;
      if (event.target instanceof Node && !card.contains(event.target)) props.onClose();
    };
    // Pointer-down rather than click: a click that starts inside and ends
    // outside is a drag, not a dismissal.
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  });
  onCleanup(() => setBusy(false));

  async function commit() {
    if (busy()) return;
    const value = readValue(props.shape, raw());
    if (value === undefined) {
      setError(`That is not a ${props.typeName}.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await props.onCommit(value);
      props.onClose();
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof Error ? failure.message : "Could not save this value.");
    }
  }

  return (
    <div
      ref={card}
      class="locus-quick-value"
      style={`left: ${Math.round(props.x)}px; top: ${Math.round(props.y)}px`}
      role="dialog"
      aria-label={`New ${props.typeName}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); props.onClose(); }
        if (event.key === "Enter" && props.shape !== "boolean") { event.preventDefault(); void commit(); }
      }}
    >
      <div class="locus-quick-value__head">
        <span class="locus-quick-value__type mono">{props.typeName}</span>
        <button type="button" class="locus-quick-value__full" onClick={props.onOpenFull}
          data-tooltip="Open the full editor for this value">⤢</button>
        <button type="button" class="locus-quick-value__close" onClick={props.onClose}
          aria-label="Cancel">×</button>
      </div>
      <Show when={props.shape === "boolean"} fallback={
        <input
          ref={input}
          class="locus-quick-value__input"
          type={props.shape === "number" ? "number" : props.shape === "date" ? "date" : "text"}
          value={raw()}
          disabled={busy()}
          placeholder={props.shape === "number" ? "0" : props.shape === "date" ? "" : `a ${props.typeName}…`}
          onInput={(event) => { setRaw(event.currentTarget.value); setError(undefined); }}
        />
      }>
        {/* A Boolean's values are its two constructors, so they are offered as
            the two constructors and not as a text box. */}
        <div class="locus-quick-value__choices">
          <button type="button" class={["locus-quick-value__choice", { "locus-quick-value__choice--on": raw() === "true" }]}
            onClick={() => { setRaw("true"); }}>True</button>
          <button type="button" class={["locus-quick-value__choice", { "locus-quick-value__choice--on": raw() === "false" }]}
            onClick={() => { setRaw("false"); }}>False</button>
        </div>
      </Show>
      <Show when={error()}><div class="locus-quick-value__error" role="alert">{error()}</div></Show>
      <div class="locus-quick-value__actions">
        <button type="button" class="btn btn-primary locus-quick-value__save" disabled={busy()}
          onClick={() => void commit()}>{busy() ? "Adding…" : "Add"}</button>
      </div>
    </div>
  );
}
