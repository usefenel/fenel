// ---------------------------------------------------------------------------
// Core error types
//
// Phase 13b sub-step 1 (2026-05-25) — `ValidationError` introduced as the
// canonical wrapper-side validation throw. The api/src/routes/actions.ts route
// catches this error specifically and returns a 422 with the structured
// errors array. Plain `Error`s continue to map to 422 with a message-only
// body via the existing catch-all path.
//
// action-subsumption Phase N (2026-06-10) — `validateActionParams` (the
// `<action>_params`-entity validator the legacy `registerAction({handler})`
// path used) is DELETED: its last caller was `send_email`'s TS handler, which
// became the typed Fenel function `email:sendEmail`. The generic fnRef dispatch
// path (core/dispatch.ts) now validates every action against its function's own
// param-record via `state.validate_function_args`, throwing this same
// `ValidationError` on failure. `ValidationError` itself stays — dispatch +
// the actions route still use it.
// ---------------------------------------------------------------------------

export type ValidationIssue = {
  path: string;
  message: string;
};

export class ValidationError extends Error {
  constructor(public readonly errors: ValidationIssue[]) {
    const summary = errors[0]?.message ?? "Validation failed";
    super(summary);
    this.name = "ValidationError";
  }
}
