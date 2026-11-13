// ---------------------------------------------------------------------------
// Telegram Form Renderer — step-by-step conversational form rendering
//
// Pure data function. Takes a FormDefinition and produces a sequence of
// conversational steps. Each step describes what to ask, how to accept input,
// and what buttons to show. The bot package consumes these steps.
//
// Handles: field visibility (JSON Logic), skip logic, enum→buttons conversion,
// list collection, record sub-steps.
// ---------------------------------------------------------------------------

import type {
  FenelType,
  FormDefinition,
  FieldDef,
  SelectOption,
  LocaleString,
  EditDisplay,
} from "./types";
import { canonical } from "./locale";
import { fieldType, fieldMeta, subFieldDefs, formDefinitionFields, type FieldMetadata } from "./field-meta";
import { parseInput, type ParseContext } from "./input-layer";
import "./input-parsers"; // side-effect: registers built-in parsers
import { peelMaybe, peelList } from "./set-algebra";
import { peelSetExpr } from "./set-marker";
import { refHandle } from "./type-foundation";
import type { ModuleRegistry } from "./registry";
import { resolveIdentifiedFieldView } from "./identified-field-view";
import { dispatchEngineBody, print } from "./engine-bodies-dispatch";

// ---------------------------------------------------------------------------
// Step types
// ---------------------------------------------------------------------------

export type TelegramButton = {
  label: LocaleString;
  value: string;
};

export type TelegramFormStep = {
  fieldId: string;
  label: LocaleString;
  message: string; // HTML-formatted question
  /** UI dispatch hint — picks the keyboard / input affordance shown to the user. */
  inputType: "text" | "number" | "buttons" | "date" | "boolean" | "skip";
  /** The FenelType driving parsing — fed to parseInput in parseStepReply. */
  type?: FenelType;
  buttons?: TelegramButton[];
  optional?: boolean;
  /** For list fields: collect multiple values until user says "done" */
  isList?: boolean;
  listItemSteps?: TelegramFormStep[];
  /** For record fields: nested sub-steps */
  subSteps?: TelegramFormStep[];
};

export type TelegramFormResult = {
  steps: TelegramFormStep[];
  /** Fields that were skipped due to visibility conditions */
  skippedFields: string[];
};

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Build conversational steps from a FormDefinition.
 *
 * @param definition - The form definition
 * @returns Steps for the bot to iterate through
 */
export function buildTelegramFormSteps(
  registry: ModuleRegistry,
  definition: FormDefinition,
): TelegramFormResult {
  const steps: TelegramFormStep[] = [];
  const skippedFields: string[] = [];

  for (const field of formDefinitionFields(definition)) {
    const step = fieldToStep(registry, field);
    if (step) steps.push(step);
  }

  return { steps, skippedFields };
}

/**
 * Format a step's message as Telegram HTML.
 */
export function formatStepMessage(step: TelegramFormStep): string {
  let msg = `<b>${escapeHtml(canonical(step.label))}</b>`;
  if (step.optional) msg += " <i>(optional — send /skip to skip)</i>";
  return msg;
}

/**
 * Parse a user's text reply for a given step.
 *
 * Uses the step's FenelType (if present) with `parseInput` for unified
 * coercion across channels — the same email/phone normalization that
 * web/API parsing gets. Falls back to inputType-driven parsing when
 * `type` is missing (legacy steps; new code populates it).
 *
 * Buttons stay channel-specific: matching by value or label is a Telegram
 * UX concern, not a type-system one.
 */
export function parseStepReply(
  step: TelegramFormStep,
  text: string,
  ctx?: ParseContext,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();

  if (trimmed === "/skip" && step.optional) {
    return { ok: true, value: undefined };
  }

  if (step.inputType === "skip") {
    return { ok: true, value: undefined };
  }

  if (step.inputType === "buttons" && step.buttons) {
    const match = step.buttons.find(
      (b) => b.value === trimmed || canonical(b.label).toLowerCase() === trimmed.toLowerCase(),
    );
    if (match) return { ok: true, value: match.value };
    return { ok: false, error: "Please choose one of the options." };
  }

  // Type-driven parsing — refined types pick up specific parsers
  // (e.g. format:email → parseEmail).
  if (step.type) {
    const result = parseInput(trimmed, step.type, ctx);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: result.value };
  }

  // No type attached — fall back on the UI hint.
  switch (step.inputType) {
    case "number": {
      const n = Number(trimmed);
      if (isNaN(n)) return { ok: false, error: "Please enter a valid number." };
      return { ok: true, value: n };
    }
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        return { ok: false, error: "Please enter a date in YYYY-MM-DD format." };
      }
      return { ok: true, value: trimmed };
    case "boolean":
      if (["yes", "true", "1"].includes(trimmed.toLowerCase())) return { ok: true, value: true };
      if (["no", "false", "0"].includes(trimmed.toLowerCase())) return { ok: true, value: false };
      return { ok: false, error: "Please reply Yes or No." };
    default:
      return { ok: true, value: trimmed };
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function fieldToStep(registry: ModuleRegistry, field: FieldDef): TelegramFormStep | null {
  const type = fieldType(field);
  const meta = fieldMeta(field);
  const optional = peelMaybe(type) !== null;
  const view = resolveIdentifiedFieldView(registry, field);
  const base = {
    fieldId: field.name,
    label: view.presentation.label,
    optional,
  };

  return typeToStep(base, type, meta, field, registry, view.display);
}

/** Extract options from a field — checks ui.options, then set.$enum */
type TextChoiceOption = { value: string; label: LocaleString };

function textChoiceOptions(options: SelectOption[]): TextChoiceOption[] {
  const result = dispatchEngineBody("engine:fieldTextChoiceOptionsPlan", [options]) as
    | { $tag: "Ok"; _0: TextChoiceOption[] }
    | { $tag: "Err"; _0: string };
  if (result.$tag === "Err") throw new TypeError(result._0);
  return result._0;
}

function getFieldOptions(display: Partial<EditDisplay> | undefined, type: FenelType): TextChoiceOption[] | null {
  // UI options take priority (have labels)
  if (display?.options?.$tag === "Just" && display.options._0.length > 0) return textChoiceOptions(display.options._0);
  // Fall back to set.$enum on the FenelType's $refined wrapper
  if ("$refined" in type) {
    // 3b-0: route the SetExpr read through the canonical dual-read recognizer.
    const sv = peelSetExpr(type.$refined.set);
    if (sv?.kind === "SeEnum") {
      return textChoiceOptions(sv.values.map((value) => ({ value, label: typeof value === "string" ? value : print(value) })));
    }
  }
  return null;
}

function typeToStep(
  base: { fieldId: string; label: LocaleString; optional: boolean },
  type: FenelType,
  meta: FieldMetadata,
  field?: FieldDef,
  registry?: ModuleRegistry,
  display?: Partial<EditDisplay>,
): TelegramFormStep | null {
  // Peel $refined for atomic dispatch but keep the original `type` for option lookup
  // and parseInput dispatch.
  const peeled = "$refined" in type ? type.$refined.base : type;

  {
    const maybe = peelMaybe(peeled);
    if (maybe) {
      // Render the inner type's step, with optional=true.
      return typeToStep({ ...base, optional: true }, maybe.value, meta, field, registry, display);
    }
  }

  // 7g-retire-2c fold: dispatch on the name-handle of `{$named}` OR its `{$ref}`
  // twin (the atom field type may be declared either way).
  const namedAtom = refHandle(peeled);
  if (namedAtom !== undefined) {
    switch (namedAtom) {
      case "String": {
        const options = getFieldOptions(display, type);
        if (options) {
          return {
            ...base,
            message: formatStepMessage(base as TelegramFormStep),
            inputType: "buttons",
            type,
            buttons: options.map((opt) => ({ label: opt.label, value: opt.value })),
          };
        }
        return {
          ...base,
          message: formatStepMessage(base as TelegramFormStep),
          inputType: "text",
          type,
        };
      }
      case "Number":
        return {
          ...base,
          message: formatStepMessage(base as TelegramFormStep),
          inputType: "number",
          type,
        };
      case "Boolean":
        return {
          ...base,
          message: formatStepMessage(base as TelegramFormStep),
          inputType: "boolean",
          type,
          buttons: [
            { label: "Yes", value: "true" },
            { label: "No", value: "false" },
          ],
        };
      case "Date":
        return {
          ...base,
          message: formatStepMessage(base as TelegramFormStep),
          inputType: "date",
          type,
        };
      case "File":
      case "Markup":
        return {
          ...base,
          message: formatStepMessage(base as TelegramFormStep),
          inputType: "text",
          type,
        };
    }
    // Unknown $named — fall through to text.
    return {
      ...base,
      message: formatStepMessage(base as TelegramFormStep),
      inputType: "text",
      type,
    };
  }

  // $tagged (ref) — render as plain text (entity ID) in Telegram.
  if ("$tagged" in peeled) {
    return {
      ...base,
      message: formatStepMessage(base as TelegramFormStep),
      inputType: "text",
      type,
    };
  }

  // List — recurse on the element. Sub-field metadata is synthesized
  // from the inner FenelType structure.
  {
    const list = peelList(peeled);
    if (list) {
      const inner = list.elem;
      const itemStep = typeToStep(
        { fieldId: `${base.fieldId}[]`, label: `${base.label} item`, optional: false },
        inner,
        {},
        undefined,
      );
      if (!itemStep) return null;
      return {
        ...base,
        message: formatStepMessage(base as TelegramFormStep),
        inputType: "text",
        isList: true,
        listItemSteps: [itemStep],
      };
    }
  }

  // $record — recurse over the FieldDef[] from the type body.
  if ("$record" in peeled) {
    const subSteps: TelegramFormStep[] = [];
    const subs = field ? subFieldDefs(field) : [];
    for (const f of subs) {
      if (!registry) return null;
      const sub = fieldToStep(registry, f);
      if (sub) subSteps.push(sub);
    }
    if (subSteps.length === 0) return null;
    return {
      ...base,
      message: formatStepMessage(base as TelegramFormStep),
      inputType: "skip",
      subSteps,
    };
  }

  // $variant — render the discriminator selection as buttons.
  if ("$variant" in peeled) {
    return {
      ...base,
      message: formatStepMessage(base as TelegramFormStep),
      inputType: "buttons",
      buttons: peeled.$variant.cases.map((c) => ({ label: c.name, value: c.name })),
    };
  }

  // $map — locale-string falls through to plain text input; matrix not yet supported.
  if ("$map" in peeled) {
    return {
      ...base,
      message: formatStepMessage(base as TelegramFormStep),
      inputType: "text",
    };
  }

  void meta; // reserved for richer rendering driven by metadata in future
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
