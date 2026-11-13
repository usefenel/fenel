// Function runtime — expression-based evaluator for Fenel
//
// The runtime evaluates function programs (Expression trees) as durable
// state machines against the Layer 1 action API. Functions are data, not
// code. Long-lived, IO-suspending functions (formerly called "flows") are
// the same FenelFunction concept — durability is a property of the runtime,
// not a kind of function.

// Parser — raw def → FunctionDef { program: Expression }
export { parseDocument, extractFunctions, normalizeFunction } from "./parser";

// Evaluator — turn-based expression evaluator
export {
  executeInstance,
  resumeWaitingInstance,
  selectChoice,
  handleTimeout,
  turn,
  resumeAfterIO,
  invokeIOActionAs,
  permitsIOActionAs,
  mintLaneAuthorityFor,
  // rights R4a — the acquisition realm: one ephemeral, base-registry, partition-
  // scoped door for everything an ingress route performs BEFORE it can mint a
  // product grant.
  invokeIOActionEphemeral,
  mintAcquisitionAuthorityFor,
  AUTHORITY_REFUSED_ERROR_KIND,
  loadRegistry,
  loadAccountExecutionRegistryForRequest,
  // rights R1 — privileged-realm door. ONLY `core/src/auth.ts` may call this.
  invokeIOActionPrivileged,
} from "./evaluator";
// rights R2a — the mint sites. `audit-effects.ts`'s `authority-minter-sites`
// rule allowlists the issuer literals to `authority-mint.ts`; re-exporting the
// helpers is what lets every lane name itself at its OWN call site.
export {
  mintRequestAuthority,
  mintAnonymousAuthority,
  mintAcquisitionAuthority,
  mintInterimWorkerAuthority,
  announcedInterimLanes,
  type InterimWorkerLane,
} from "./authority-mint";

export type { Frame, EvalState, IORequest, TurnResult } from "./evaluator";
// Host failure carrier, owned by the engine so no consumer needs `@fenel/db`
// to recognise it (ts-elimination Phase 1 gate).
export { FunctionStartUnavailable } from "@fenel/engine/result";

// Triggers — event → new instances + wake waiting instances
export {
  processEvent,
  startFunctionInstance,
  startFunctionInstanceByName,
  checkTimeouts,
  checkAllTimeouts,
} from "./triggers";

// Types
export type {
  FunctionDocument,
  RawFunctionDef,
  FunctionDef,
  FunctionTrigger,
  StepPath,
} from "./types";

// Telegram — codec helpers exposed for webhook intake routes
export {
  toTelegramWire,
  fromTelegramWire,
  camelToSnake,
  snakeToCamel,
} from "./handlers/telegram-codec";

// Telegram — type-driven collector ("read(T) at telegram"). The
// form-fill orchestration exports (startTelegramForm / routeTelegramMessage
// / routeConfirmation) were retired in Phase 3b — the Fenel bodies are the
// live path; startCollectorEntry is internal to the collector handler.
export { registerCollectorHandlers } from "./handlers/telegram-collector";
export {
  getRuntimeAccountFieldRegistry,
  clearRuntimeAccountFieldRegistry,
  type RuntimeAccountFieldRegistryDependencies,
} from "./account-field-registry";

// Hook runner — ephemeral function execution for hooks
export { runEphemeralFunction } from "./hook-runner";

// Mailgun — webhook signature + payload mapping (consumed by the API
// route that intakes Mailgun events and inbound mail).
export {
  verifyMailgunSignature,
  mailgunEventToEmailEvent,
  mailgunInboundToEmail,
  type EmailValue,
  type EmailEventValue,
  type AddressValue as MailgunAddressValue,
  type BodyValue as MailgunBodyValue,
  type HeaderValue as MailgunHeaderValue,
  type AttachmentValue as MailgunAttachmentValue,
  type TimestampValue as MailgunTimestampValue,
} from "./handlers/mailgun-webhook";

// Postmark webhook mappers
export {
  postmarkEventToEmailEvent,
  postmarkEventRecipient,
  postmarkEventDedupeKey,
  postmarkInboundToEmail,
} from "./handlers/postmark-webhook";

// Resend webhook mappers + Svix signature verifier
export {
  verifyResendSignatureWithBody,
  resendEventToEmailEvent,
  resendEventRecipient,
} from "./handlers/resend-webhook";

// SES (via SNS) webhook mappers
export {
  sesEventToEmailEvent,
  sesEventRecipient,
  type SnsEnvelope,
  type SesEventInner,
} from "./handlers/ses-webhook";

// Auto-suppression — webhook handlers call this after emitting a typed
// EmailEvent so hard bounces / spam complaints land on the provider's
// suppression list without requiring a user-defined flow.
export { autoSuppressIfBadEvent } from "./handlers/auto-suppress";
