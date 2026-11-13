/** A name as shown to the reader. A human label (`Labelable`) reads as text;
 * a code name (`Codeable`) shown only because no label exists is marked
 * `code`, and every surface renders it in the code (monospace) face
 * (`display-name-text.tsx`) so it is
 * visibly a name from the source, not a label. Never re-case a code name into
 * a fake label: the code name is shown as written. */
export type DisplayName = { readonly text: string; readonly code: boolean };
/** Plain strings remain human text (labels, placeholders such as "Input 2"). */
export type DisplayNameInput = string | DisplayName | undefined;

/** The shared card's existing LocaleString wire projection. */
export function valueCardLabel(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["en"] === "string") return o["en"];
    for (const k of Object.keys(o)) {
      if (typeof o[k] === "string") return o[k] as string;
    }
  }
  return undefined;
}

export function humanName(text: string): DisplayName { return { text, code: false }; }
export function codeName(text: string): DisplayName { return { text, code: true }; }

/** The one label → code-name fallback. A label equal to the code name is
 * a projection that already fell back to the code name, so it stays code. */
export function pickDisplayName(label: string | undefined, code: string | undefined): DisplayName | undefined {
  const trimmedLabel = label?.trim();
  const trimmedCode = code?.trim();
  if (trimmedLabel && trimmedLabel !== trimmedCode) return humanName(label!);
  if (trimmedCode) return codeName(code!);
  return undefined;
}

export function asDisplayName(name: DisplayNameInput): DisplayName | undefined {
  return typeof name === "string" ? humanName(name) : name;
}

/** A reader's presented name. A label taken from a Labelable instance was
 * authored (the engine emits one only for an authored label; a name typed in
 * the app is stored as one): it reads as a label even when it equals the
 * code name ("Transaction" typed, "Transaction" derived). Any other label
 * goes through `pickDisplayName` (a projected label equal to the code name is
 * that code name), and with no label the code name keeps the code face. */
export function presentedDisplayName(presentation: { label?: unknown; codeName?: string; labelAuthored?: boolean } | undefined): DisplayName | undefined {
  const label = valueCardLabel(presentation?.label);
  if (presentation?.labelAuthored && label?.trim()) return humanName(label);
  return pickDisplayName(label, presentation?.codeName);
}

/** Plain text for attributes (aria labels, dialog names, search). */
export function displayNameText(name: DisplayNameInput): string | undefined {
  return typeof name === "string" ? name : name?.text;
}

export function isCodeName(name: DisplayNameInput): boolean {
  return typeof name === "object" && !!name?.code;
}

/** The `data-tooltip-code` marker: the tooltip layer renders this substring
 * of the tooltip text in the code face. */
export function displayNameTooltipCode(name: DisplayNameInput): string | undefined {
  return isCodeName(name) ? displayNameText(name) : undefined;
}

/** Splits `text` around the first occurrence of `code` so the code part can
 * use the code face. Used by the tooltip layer and menu labels. */
export function splitCodeText(text: string, code: string | undefined): readonly [string, string, string] | undefined {
  if (!code) return undefined;
  const at = text.indexOf(code);
  return at < 0 ? undefined : [text.slice(0, at), code, text.slice(at + code.length)];
}

/** A layout item's `caption` is human text; a code name travels as the
 * item's `Codeable` occurrence representation, which card headings read
 * after labels and captions. */
export function displayNameItemFields(name: DisplayNameInput): {
  caption?: string; representations?: Record<string, Record<string, unknown>>;
} {
  if (isCodeName(name)) return { representations: { Codeable: { codeName: displayNameText(name)! } } };
  const caption = displayNameText(name);
  return caption === undefined ? {} : { caption };
}
