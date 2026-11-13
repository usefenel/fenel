import { registerAction } from "./registry";

// ===========================================================================
// Payments actions — action-subsumption Phase 3b (the IO-bearing wrinkle wave,
// 2026-06-08).
//
// The public actions ARE typed Fenel functions now (D1 COLLAPSE):
//   create_payment_link → payments:createPaymentLink  (fenel/modules/payments/payments.fenel)
//   send_payment_link   → payments:sendPaymentLink
//
// Both TS handlers (+ their `toMaybe*` marshalling, the `DEFAULT_SUCCESS_URL` /
// `DEFAULT_CANCEL_URL` `process.env` consts, and the `via ?? "email"` default)
// are DELETED. Dispatch resolves them by name → fnRef, validates the incoming
// params against the function's own param-record (`paramRecordOf(fnRef)`, D2 — no
// `*_params` mirror entity), injects `adapter` (D4) + `accountId`, invokes the
// body, and maps the returned `ActionResult` ADT at the boundary.
//
// The two wrinkle deltas moved INTO the bodies (Fenel-first):
//   - create_payment_link's env-default URLs — `successUrl ?? process.env
//     PAYMENT_SUCCESS_URL` became `successUrl ?? io:envGet "PAYMENT_SUCCESS_URL"
//     ?? literal` (the existing `io:envGet` leaf — no new substrate). The public
//     params are `Maybe UrlStr`; the Stripe SDK call stays in
//     payments:createStripeCheckoutSession (F-permanent).
//   - send_payment_link's `via ?? "email"` default (now over the public `via :
//     Maybe ViaMode`); the create_payment_link + send_email/tg_dm fan-out already
//     lives in the body.
//
// This file is now just the explicit `name → fnRef` exposure list (D3).
// ===========================================================================

export function registerPaymentActions() {
  registerAction({
    name: "create_payment_link",
    description: "Create a checkout session and return the payment URL",
    fnRef: "payments:createPaymentLink",
  });

  registerAction({
    name: "send_payment_link",
    description: "Create a payment link and send it to the profile via email/TG",
    fnRef: "payments:sendPaymentLink",
  });
}
