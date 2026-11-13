// ---------------------------------------------------------------------------
// Field validation public boundary.
//
// TypeScript owns only the FenelType dollar-key codec and host facts installed
// by engine-bodies-dispatch. Identity planning, recursive validation,
// strict/optional policy, paths, coercion decisions, and result assembly live
// in fenel/modules/engine/validate.fenel.
// ---------------------------------------------------------------------------

import type {
  EditDisplay,
  FenelType,
  FieldDef,
  FormDefinition,
  LocaleString,
  SetExpr,
} from "./types";
import { fieldType, formDefinitionFields } from "./field-meta";
import { engineRequire } from "./engine-require";
import { pureEvaluateContext, type EvaluateContext } from "./json-logic";
import { getSystemEvaluateContext } from "./system-registry";
import type { ModuleRegistry } from "./registry";
import { resolveIdentifiedFieldView } from "./identified-field-view";
import { canonical } from "./locale";
import "./input-parsers";

// browser-engine-compat: the dispatch surface is reached lazily (engineRequire)
// rather than by a static import — this module participates in eval-order-
// sensitive browser bundles (the historical /app blank-page class), and the
// engine harness must not be forced to initialize when validate.ts loads.
type EngineBodiesDispatch = typeof import("./engine-bodies-dispatch");
function bodiesDispatch(): EngineBodiesDispatch {
  return engineRequire<EngineBodiesDispatch>("engine-bodies-dispatch");
}

export type FieldError = {
  path: string;
  message: LocaleString;
};

export type ValidationResult = {
  valid: boolean;
  errors: FieldError[];
  data: Record<string, unknown>;
};

export type StrictMode = {
  rejectOmitted?: boolean;
  rejectAdded?: boolean;
  /** Require primitive value carriers/domains instead of form-style coercion.
   * Applied recursively; callers accepting parsed input should also disable
   * the separate input-parser option with `coerce: false`. */
  primitiveTypes?: boolean;
  /** Require a positive decision from the supported recursive data fragment.
   * Unresolved dependent/variable/cyclic/higher forms refuse instead of using
   * permissive authoring compatibility. */
  membership?: boolean;
};

export type ValidateOptions = {
  registry?: ModuleRegistry;
  strict?: StrictMode;
  coerce?: boolean;
  coerceContext?: Record<string, unknown>;
  functions?: EvaluateContext;
  /** Transport unchanged scalar membership decisions selected by the existing
   * Fenel runtime. Validation errors and projected values are not evidence. */
  observeMembership?: (verdict: { $tag: "Nothing" } | { $tag: "Just"; _0: boolean }, path: string) => void;
  /** Display only: the same checked occurrence, set, sibling scope and reader
   * frame selected by recursive validation, passed to membershipHints. */
  observeHints?: (path: string, hints: import("./validation-hints").MembershipHints) => void;
  observeAdmission?: (observation: ValidationAdmissionObservation) => void;
};

export type ValidationAdmissionObservation =
  | { $tag: "ValidationAdmissionNode"; supported: boolean; refutation: boolean }
  | { $tag: "ValidationAdmissionExact" | "ValidationAdmissionMember"; verdict: { $tag: "Nothing" } | { $tag: "Just"; _0: boolean } };

type FieldResult = {
  errors: FieldError[];
  value: unknown;
};

function validationEvalContext(
  functions?: EvaluateContext,
  registry?: ModuleRegistry,
): EvaluateContext {
  // ⚠ THE REGISTRY IS A CALLER-SUPPLIED AUTHORITY TOO (review round 9). The
  // PRODUCTION callers pass `{registry}`, not `{functions}` —
  // `AdminForm.tsx`'s `validateForm(..., { registry: fieldRegistry() })` and
  // `handlers/state.ts`'s `validate(t, raw, { coerce: true, registry })`. This
  // door read only `functions` and fell to the SYSTEM context, so `$refined`
  // membership resolved an account field's wire through an authority that does
  // not know it: measured from public API, `{registry: accountReg}` called the
  // account's own current spelling INVALID and its stale persisted one VALID,
  // which is `fi.wire.snapshot`'s original polarity on the door its own product
  // argument names. (`$record` validation was already correct, because the
  // projection natives close over `opts.registry` directly — so the defect was
  // confined to the one read the row is about, which is why it survived nine
  // rounds.) A survivor from the parent, not a regression.
  //
  // ⚠ AND WHEN BOTH ARE GIVEN, ONE CALL MUST NOT USE TWO AUTHORITIES (review
  // round 10). `functions` winning outright discarded the registry's field
  // index while the `$record` projections went on closing over that same
  // registry — so `validate(refined, …, {functions: systemCtx, registry:
  // accountReg})` read its RECORD fields from the account and its REFINEMENT
  // membership from the system, and answered the account's current spelling
  // invalid and its stale one valid. Two spellings of one call are not two
  // configurations; they are one judgment contradicting itself.
  //
  // `functions` still wins as the EVALUATE context — an explicit one is the
  // more specific statement of "evaluate under this". But **where a registry is
  // supplied it is the FIELD authority**, because the `$record` projections
  // structurally close over `opts.registry` and cannot be redirected: making
  // the wire read follow `functions` is the only way the two can disagree, and
  // the only way to keep them agreeing is to send the wire read to the same
  // place. A first cut of this fix only carried the registry index when
  // `functions` had NO index of its own, which is too weak by exactly the
  // measured case — `getSystemEvaluateContext()` HAS an index (4903 fields), it
  // simply does not carry the ACCOUNT's key, so the guard passed and the
  // contradiction survived.
  const base = functions ?? registry?.evaluateContext() ?? getSystemEvaluateContext();
  const pure = pureEvaluateContext(base);
  if (registry === undefined) return pure;
  const fromRegistry = registry.evaluateContext();
  return {
    ...pure,
    _fieldCurrentWire: fromRegistry._fieldCurrentWire,
    _fieldCurrentWireAmbiguous: fromRegistry._fieldCurrentWireAmbiguous,
  };
}

/** Validate a value through the single Fenel-owned recursive runtime. */
/** ⚠ rights R3a — `requestAccount` IS REQUIRED AND HAS NO DEFAULT.
 *
 *  Which account's named sets may decide a `$named` membership inside this
 *  validation. It used to be read out of the VALUE: this function passed the
 *  value itself as `formData`, the decider door stored `formData` as its
 *  request ctx, and `dispatchedNamedContains` read `accountId` off it — so a
 *  record with an `accountId` field chose whose set decided its own validity.
 *
 *  `null` means "no request account": global named sets only. Requiredness is
 *  what makes a caller that HOLDS an account and forgets to pass it a compile
 *  error, because the failure mode of an absent account is not a refusal — A's
 *  set is skipped and the global set answers, possibly the other way. */
export function validate(
  type: FenelType,
  value: unknown,
  requestAccount: string | null,
  opts?: ValidateOptions & { $defs?: Record<string, FenelType> },
): ValidationResult {
  const result = validateValue(type, value, requestAccount, opts);
  return { valid: result.valid, errors: result.errors, data: isRecord(result.value) ? result.value : {} };
}

/** Universal value result. The legacy validate/form API retains its record
 * `data` projection; generic named-type instances need the actual value. */
/** ⚠ rights R3a — `requestAccount` IS REQUIRED AND HAS NO DEFAULT.
 *
 *  Which account's named sets may decide a `$named` membership inside this
 *  validation. It used to be read out of the VALUE: this function passed the
 *  value itself as `formData`, the decider door stored `formData` as its
 *  request ctx, and `dispatchedNamedContains` read `accountId` off it — so a
 *  record with an `accountId` field chose whose set decided its own validity.
 *
 *  `null` means "no request account": global named sets only. Requiredness is
 *  what makes a caller that HOLDS an account and forgets to pass it a compile
 *  error, because the failure mode of an absent account is not a refusal — A's
 *  set is skipped and the global set answers, possibly the other way. */
export function validateValue(
  type: FenelType,
  value: unknown,
  requestAccount: string | null,
  opts?: ValidateOptions & { $defs?: Record<string, FenelType> },
): { valid: boolean; errors: FieldError[]; value: unknown } {
  const evalCtx = validationEvalContext(opts?.functions, opts?.registry);
  const result = bodiesDispatch().dispatchedValidationRuntime(type, value, {
    registry: opts?.registry,
    defs: opts?.$defs,
    evalCtx: evalCtx,
    coerce: opts?.coerce,
    coerceContext: opts?.coerceContext,
    strict: opts?.strict,
    formData: isRecord(value) ? value : {},
    requestAccount,
    observeMembership: opts?.observeMembership,
    observeHints: opts?.observeHints,
    observeAdmission: opts?.observeAdmission,
  });
  // The form-specialized validator intentionally has a smaller former set
  // than the language judgment. Unsupported plans ask that same judgment;
  // degraded projections answer Nothing and must never become acceptance.
  if (result.errors.length > 0 && result.errors.every((error) => canonical(error.message) === "Unknown field type")) {
    const { typeToSetExpr } = engineRequire("fenel-check") as typeof import("./fenel-check");
    const { contains } = engineRequire("set-algebra") as typeof import("./set-algebra");
    // rights R3a — the `contains` FALLBACK is a separate entry into the same
    // judgment, so it carries the request account too; without this the
    // degraded-plan lane would answer from global named sets while the ordinary
    // lane answered from the account's.
    const verdict = contains(
      typeToSetExpr(type), value, requestAccount, isRecord(value) ? value : {}, evalCtx,
    );
    opts?.observeAdmission?.({ $tag: "ValidationAdmissionExact", verdict });
    if (verdict.$tag === "Just") return { valid: verdict._0, errors: verdict._0 ? [] : [{ path: "", message: "Value does not inhabit this type" }], value };
    return { valid: false, errors: [{ path: "", message: "The engine could not decide membership for this type and value" }], value };
  }
  return {
    valid: result.errors.length === 0,
    errors: result.errors,
    value: result.value,
  };
}

/** FormDefinition compatibility boundary over the universal validator. */
export function validateForm(
  definition: FormDefinition,
  data: Record<string, unknown>,
  /** rights R3a — see `validateValue`. Required, no default. */
  requestAccount: string | null,
  opts?: ValidateOptions,
): ValidationResult {
  const recordType: FenelType = {
    $record: { fields: formDefinitionFields(definition) },
  };
  return validate(recordType, data, requestAccount, { ...opts, $defs: definition.$defs });
}

/**
 * Compatibility boundary for callers validating one field.
 *
 * The singleton record is deliberate: the Fenel access plan must audit the
 * field key and derive its wire/diagnostic path before value validation.
 */
export function validateFormFieldShim(
  field: FieldDef,
  value: unknown,
  path: string,
  formData: Record<string, unknown>,
  defs: Record<string, FenelType>,
  /** rights R3a — see `validateValue`. Required, no default. */
  requestAccount: string | null,
  evalCtx?: EvaluateContext,
  _display?: Partial<EditDisplay>,
  registry?: ModuleRegistry,
): FieldResult {
  const normalizedEvalContext = validationEvalContext(evalCtx, registry);
  const accessPlan = bodiesDispatch().dispatchedValidationAccessPlan([field], {
    registry,
    defs,
    evalCtx: normalizedEvalContext,
  });
  // A registry rename can make the declaration-era `field.name` stale.  The
  // singleton compatibility boundary must seed and extract through exactly
  // the same current Codeable projection as the Fenel validation plan.
  const currentWireName = accessPlan.ok
    ? accessPlan.fields[0]?.wireName ?? field.name
    : field.name;
  const suffix = "." + currentWireName;
  const parentPath = path === currentWireName
    ? ""
    : path.endsWith(suffix)
      ? path.slice(0, -suffix.length)
      : "";
  const result = bodiesDispatch().dispatchedValidationRuntime(
    { $record: { fields: [field] } },
    { [currentWireName]: value },
    {
      registry,
      defs,
      evalCtx: normalizedEvalContext,
      path: parentPath,
      formData,
      requestAccount,
    },
  );
  const record = isRecord(result.value) ? result.value : {};
  return {
    errors: result.errors,
    value: Object.prototype.hasOwnProperty.call(record, currentWireName)
      ? record[currentWireName]
      : value,
  };
}

export function formatSetErrorShim(set: SetExpr): string {
  return bodiesDispatch().dispatchedFormatSetError(set);
}

export { fieldType as fieldTypeShim };

/** Compatibility fact used by non-validation presentation boundaries. */
export function fieldPresentationLabelShim(
  field: FieldDef,
  registry: ModuleRegistry,
): string {
  if (field.key?.$tag === "PositionalField") return field.name;
  return canonical(resolveIdentifiedFieldView(registry, field).presentation.label);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// browser-engine-compat: self-register the live module namespace.
import * as __self_validate from "./validate";
import { registerEngineModule as __reg_validate } from "./engine-require";
__reg_validate("validate", __self_validate);
