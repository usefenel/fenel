// The remaining inputs of a suggested function, as its Suggestions row shows
// them (Rom, Nov 11: "the same UX as for records when we add new data"; Nov 12:
// "function parameters are a bit like a record"): every input other than the
// data being looked at is one row of the New data simple form (its label
// beside the editor its type calls for). The input bound to the data is not
// shown at all: it is the current data, not an input.
// Pure decisions only; `related-data-panels.tsx` renders them.

import type { FenelType, FieldDef } from "@fenel/engine/types";
import { Just, Nothing, peelMaybeValue } from "@fenel/engine/maybe-value";

/** One open input of an action: its name, the inline scalar editor's type
 * when the existing literal widget policy offers one (else the expression owns
 * it), and the function's own declaration of that input when it is known. */
export type SuggestionArgument = { name: string; type?: FenelType; field?: FieldDef };
/** Every input of a multi-input action in declaration order: the selected
 * data's own position, or the index of one open input. */
export type SuggestionParameter = { name: string; subject: true } | { name: string; subject: false; open: number };

export type SuggestionInputsLayout = {
  /** Every input but the data's own, in declaration order, with its open slot. */
  fields: readonly { name: string; open: number }[];
};

/** A row with no open input shows no form. */
export function suggestionInputsLayout(parameters: readonly SuggestionParameter[], openCount: number): SuggestionInputsLayout {
  if (!(openCount > 0)) return { fields: [] };
  return { fields: parameters.flatMap(parameter => parameter.subject ? [] : [{ name: parameter.name, open: parameter.open }]) };
}

/** An input's label: its authored label, else its name read as words, the
 * same default the engine gives a field or a function without a label
 * (`humanizeCodeName` in the engine's module loader, which this mirrors: that
 * module is the parser and is not loaded on the page). */
export function parameterLabel(argument: SuggestionArgument): string {
  const authored = argument.field ? peelMaybeValue(argument.field.label) : null;
  const text = typeof authored === "string" ? authored
    : authored && typeof authored === "object" ? authored.en ?? Object.values(authored)[0] : undefined;
  if (typeof text === "string" && text.trim()) return text;
  return humanizeName(argument.name);
}

function humanizeName(name: string): string {
  const spaced = name.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.split(" ").filter(word => word.length > 0)
    .map(word => word === word.toUpperCase() ? word : word[0]!.toUpperCase() + word.slice(1)).join(" ") || name;
}

/** The function's declared inputs for its open slots (the data's own slot
 * skipped), aligned with the operation's input names; a declaration that does
 * not match those names supplies nothing. */
export function openParameterFields(paramNames: readonly string[], inputIndex: number,
  declared: readonly FieldDef[] | undefined): (FieldDef | undefined)[] {
  const open = paramNames.flatMap((name, index) => index === inputIndex ? [] : [{ name, index }]);
  const matches = !!declared && declared.length === paramNames.length
    && declared.every((field, index) => field?.name === paramNames[index]);
  return open.map(slot => matches ? declared![slot.index] : undefined);
}

/** The field one open input is edited as: its declaration (authored label,
 * description) with the inline editor's type, else a field named by the
 * input's name. No inline editor: no field (the expression owns the input). */
export function suggestionInputField(argument: SuggestionArgument): FieldDef | undefined {
  if (!argument.type) return undefined;
  const label = Just(parameterLabel(argument));
  return argument.field
    ? { ...argument.field, name: argument.name, type: argument.type, label }
    : { name: argument.name, type: argument.type, label, meta: {}, ui: Nothing } as FieldDef;
}
