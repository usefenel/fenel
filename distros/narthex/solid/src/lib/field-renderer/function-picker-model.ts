// FunctionPicker's model (`$arrow` fields outside an expression editor): what
// a stored value names, the option list and labels of a registry, and the
// signature hint. Shared by the page's FunctionPicker (Account and public
// readers, and a foreign registry) and, for a Local reader, by the worker's
// `project-reader-function-options` (B4 F1), so both run this same code.
//
// The helpers from `functionPickerHandle` up to `functionOptionLabel` are plain
// TypeScript with no imports: `function-picker.test.ts` runs them straight
// from this source.
import { displayLabel, getCategory, getCodeName } from "@fenel/engine";
import { canonical } from "@fenel/engine/locale";

/** What a stored `$arrow` value names, as far as the picker can show it. A
 *  resolved function is keyed by its canonical id; an unresolved handle is
 *  kept verbatim so the user sees what is stored instead of an unset field. */
export type FunctionPickerSelection =
  | { kind: "none" }
  | { kind: "function"; id: string }
  | { kind: "unresolved"; handle: string };

/** The handle a stored `$arrow` value names. The canonical form is the typed
 *  reference `{ $ref: handle }`, where the handle is a function id, UUID,
 *  codeName or dotted `bundle.member`. `$ref` counts only as an OWN DATA
 *  property holding a non-empty string: an inherited or accessor `$ref` names
 *  nothing. A bare string is the legacy spelling (codeName or id): read, never
 *  written. */
export function functionPickerHandle(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, "$ref");
  return descriptor !== undefined && "value" in descriptor
    && typeof descriptor.value === "string" && descriptor.value !== ""
    ? descriptor.value
    : undefined;
}

/** Resolve a stored value through the registry the options come from; its
 *  `getFunction` bridges every handle spelling to one function, whose id is
 *  the option key. */
export function functionPickerSelection(
  value: unknown,
  registry: { getFunction(handle: string): { readonly id: string } | undefined },
): FunctionPickerSelection {
  const handle = functionPickerHandle(value);
  if (handle === undefined) return { kind: "none" };
  const fn = registry.getFunction(handle);
  return fn === undefined ? { kind: "unresolved", handle } : { kind: "function", id: fn.id };
}

/** The select key for a selection: the function id, the raw unresolved handle
 *  (no function id equals it, since the id would have resolved), or "" for
 *  the prompt option. */
export function functionPickerKey(selection: FunctionPickerSelection): string {
  if (selection.kind === "function") return selection.id;
  if (selection.kind === "unresolved") return selection.handle;
  return "";
}

/** The value a picked key writes: the typed reference to the function id, or
 *  `null` for the prompt option, which clears the field. */
export function functionPickerValue(key: string): { $ref: string } | null {
  return key === "" ? null : { $ref: key };
}

/** The registry the picker lists and resolves through: the callable registry
 *  in scope first (a transient field keeps it; it carries no field identity),
 *  else the inherited field registry, else std, built only for a surface with
 *  no registry at all. */
export function functionPickerRegistry<R>(callable: R | undefined, inherited: R | undefined, std: () => R): R {
  return callable ?? inherited ?? std();
}

/** Option lists by registry object. Labelling runs the dispatched label
 *  lookups, about 0.4 ms a function under Bun (measured 2026-09-25: 0.7-0.9 s
 *  for an account registry's ~1650 functions), so each registry is labelled
 *  once and every picker over it (one per arrow field) reuses the list. A
 *  registry is an immutable snapshot and a newly committed one is a new key;
 *  the labels are untracked process-global reads either way. */
const functionPickerOptionsByRegistry = new WeakMap<object, readonly { value: string; label: string }[]>();

/** The options for a registry: each function keyed by its id, the key a pick
 *  writes, with its label. */
export function functionPickerOptions(
  registry: { listFunctions(): readonly { readonly id: string }[] },
  label: (id: string) => string,
  /** The labels' owner: the frame they were resolved in (B4 wave 4), else the registry. */
  cacheKey: object = registry,
): readonly { value: string; label: string }[] {
  let options = functionPickerOptionsByRegistry.get(cacheKey);
  if (options === undefined) {
    options = registry.listFunctions().map((fn) => ({ value: fn.id, label: label(fn.id) }));
    functionPickerOptionsByRegistry.set(cacheKey, options);
  }
  return options;
}

/** Shape checks for a transported answer (B4 F1): an option is two strings;
 * a selection is one of the three kinds with its string. */
export function functionPickerOptionReadable(option: unknown): boolean {
  return option !== null && typeof option === "object" && typeof (option as { value?: unknown }).value === "string"
    && typeof (option as { label?: unknown }).label === "string";
}
export function functionPickerSelectionReadable(selection: unknown): selection is FunctionPickerSelection {
  if (selection === null || typeof selection !== "object") return false;
  const candidate = selection as { kind?: unknown; id?: unknown; handle?: unknown };
  return candidate.kind === "none" || candidate.kind === "function" && typeof candidate.id === "string"
    || candidate.kind === "unresolved" && typeof candidate.handle === "string";
}

/** `functionPickerOptions` built in resumable steps, for the Local reader's
 * worker (B4 F1), which must yield between slices: the same list, in the same
 * order, with the same labels, shared with that cache once complete. Before
 * each label `next()` decides whether to go on (it may pause first); a `false`
 * keeps the labelled prefix for the next call and answers `undefined`. */
const functionPickerPartialOptions = new WeakMap<object, {
  functions: readonly { readonly id: string }[]; options: { value: string; label: string }[] }>();
export async function functionPickerOptionsInSteps(
  registry: { listFunctions(): readonly { readonly id: string }[] },
  label: (id: string) => string,
  next: () => boolean | Promise<boolean>,
  cacheKey: object = registry,
): Promise<readonly { value: string; label: string }[] | undefined> {
  const complete = functionPickerOptionsByRegistry.get(cacheKey);
  if (complete !== undefined) return complete;
  let partial = functionPickerPartialOptions.get(cacheKey);
  if (partial === undefined) {
    partial = { functions: registry.listFunctions(), options: [] };
    functionPickerPartialOptions.set(cacheKey, partial);
  }
  while (partial.options.length < partial.functions.length) {
    const go = next();
    if (!(typeof go === "boolean" ? go : await go)) return undefined;
    const fn = partial.functions[partial.options.length]!;
    partial.options.push({ value: fn.id, label: label(fn.id) });
  }
  functionPickerPartialOptions.delete(cacheKey);
  functionPickerOptionsByRegistry.set(cacheKey, partial.options);
  return partial.options;
}

/** The signature a picked function must have: the field's arrow type as Fenel
 *  text, e.g. `String -> Result String Bytes` for the `decode` field of an
 *  `Iso String Bytes` instance, whose method types arrive instantiated with the
 *  instance's arguments. `print` is the engine's printer. Nothing is shown for
 *  a non-arrow type, a printer failure, or a print that fell back to a JSON
 *  dump of a `$`-keyed type. */
export function functionPickerSignature(arrowType: unknown, print: (type: unknown) => string): string | undefined {
  if (arrowType === null || typeof arrowType !== "object" || Array.isArray(arrowType) || !("$arrow" in arrowType)) return undefined;
  let text: string;
  try {
    text = print(arrowType);
  } catch {
    return undefined;
  }
  return typeof text === "string" && text.trim() !== "" && !/\{\s*"\$[A-Za-z_]/.test(text) ? text.trim() : undefined;
}

/** Option label: the function's display label plus its category hint. */
export function functionOptionLabel(id: string): string {
  const label = canonical(displayLabel(id) ?? getCodeName(id) ?? id);
  const category = getCategory(id);
  return category ? `${label} (${category})` : label;
}

/** B4 wave 4: an option's label when the reader's own frame is known. The
 * global label lookups above dispatch with no frame (GLOBAL_ONLY), so a
 * tab-scoped or account-owned Labelable/Codeable row is invisible to them and
 * such a function showed its UUID. A function the global lookups label keeps
 * that label (`functionOptionLabel`, unchanged); only one they do not know is
 * asked of the reader presentation over the frame (`presented`, lazily: its
 * scoped lookups cost several dispatches per function), which shows its
 * scoped label, else its scoped code name; the id only when neither exists. */
export function functionOptionLabelIn(presented: () => { label?: unknown; codeName?: string } | undefined, id: string): string {
  // `displayLabel` falls back to the id itself when no global row names it.
  const global = canonical(displayLabel(id) ?? getCodeName(id) ?? id);
  let label: string;
  if (global !== id) label = global;
  else {
    let shown: { label?: unknown; codeName?: string } | undefined;
    try { shown = presented(); } catch { shown = undefined; }
    label = (shown?.label === undefined ? "" : canonical(shown.label as Parameters<typeof canonical>[0])) || shown?.codeName || id;
  }
  const category = getCategory(id);
  return category ? `${label} (${category})` : label;
}
