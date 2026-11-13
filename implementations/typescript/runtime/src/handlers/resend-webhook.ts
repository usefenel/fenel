// ---------------------------------------------------------------------------
// Resend webhook payload → typed Fenel events
//
// Resend uses Svix for webhook delivery. Every request carries:
//   svix-id         — unique webhook attempt id (use for idempotency)
//   svix-timestamp  — unix seconds the webhook was generated
//   svix-signature  — `v1,<base64-hmac>` over `${svix-id}.${svix-timestamp}.${body}`
//
// Verification: HMAC-SHA256 with the per-account `whsec_…` signing
// secret, then base64-compare against the v1 signature line.
//
// Resend does not currently offer parsed inbound — we only ingest
// outbound lifecycle events (delivered, bounced, complained, opened,
// clicked, etc.).
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  EmailEventValue,
  MessageIdValue,
  TimestampValue,
} from "./mailgun-webhook";

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/** Verify a Svix-style Resend webhook signature in constant time.
 *
 *  `secret` is the Svix `whsec_...` signing secret (the prefix is
 *  stripped and the remainder base64-decoded). The signature header
 *  may contain multiple v1 entries separated by spaces — we accept if
 *  any one matches. */
export function verifyResendSignature(
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  signingSecret: string,
): boolean {
  if (!svixId || !svixTimestamp || !svixSignature || !signingSecret) return false;

  // Strip the `whsec_` prefix and base64-decode the secret bytes.
  const rawSecret = signingSecret.startsWith("whsec_")
    ? signingSecret.slice("whsec_".length)
    : signingSecret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(rawSecret, "base64");
  } catch {
    return false;
  }
  if (secretBytes.length === 0) return false;

  // The body is the third arg to verify — the caller passes it via
  // `verifyResendSignatureWithBody`. This signature-only fn is a stub
  // for shape; real callers use the body-aware variant below.
  return false;
}

/** Body-aware variant — the actual entry point for the webhook route.
 *  Pass the raw request body string; we HMAC over `${id}.${ts}.${body}`. */
export function verifyResendSignatureWithBody(
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  signingSecret: string,
  body: string,
): boolean {
  if (!svixId || !svixTimestamp || !svixSignature || !signingSecret) return false;
  const rawSecret = signingSecret.startsWith("whsec_")
    ? signingSecret.slice("whsec_".length)
    : signingSecret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(rawSecret, "base64");
  } catch {
    return false;
  }
  if (secretBytes.length === 0) return false;

  const expected = createHmac("sha256", secretBytes)
    .update(`${svixId}.${svixTimestamp}.${body}`)
    .digest("base64");

  // The header may contain multiple v1 entries: "v1,a v1,b v1,c"
  for (const entry of svixSignature.split(/\s+/)) {
    const [scheme, sig] = entry.split(",", 2);
    if (scheme !== "v1" || !sig) continue;
    const a = Buffer.from(expected, "base64");
    const b = Buffer.from(sig, "base64");
    if (a.length === b.length && a.length > 0 && timingSafeEqual(a, b)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Event mapping
// ---------------------------------------------------------------------------

function tsFromIso(iso: unknown): TimestampValue {
  const ms = Date.parse(String(iso ?? ""));
  return { $tag: "Timestamp", epochMs: Number.isNaN(ms) ? Date.now() : ms };
}

/** Translate a Resend event JSON into the typed EmailEvent ADT.
 *  Returns null for event types we don't model. */
export function resendEventToEmailEvent(
  payload: Record<string, unknown>,
): EmailEventValue | null {
  const type = String(payload.type ?? "");
  const data = (payload.data as Record<string, unknown>) ?? {};
  const id: MessageIdValue = {
    $tag: "MessageId",
    _0: String(data.email_id ?? data.id ?? ""),
  };
  const at = tsFromIso(payload.created_at ?? data.created_at);

  switch (type) {
    case "email.sent":
    case "email.delivery_delayed":
      return { $tag: "Queued", id, at };
    case "email.delivered":
      return { $tag: "Delivered", id, at };
    case "email.bounced": {
      const bounce = (data.bounce as { type?: string; subType?: string; message?: string }) ?? {};
      const kind: { $tag: "HardBounce" } | { $tag: "SoftBounce" } | { $tag: "BlockBounce" } =
        bounce.type === "hard"
          ? { $tag: "HardBounce" }
          : bounce.type === "soft"
            ? { $tag: "SoftBounce" }
            : { $tag: "BlockBounce" };
      return {
        $tag: "Bounced",
        id,
        at,
        kind,
        reason: String(bounce.message ?? bounce.subType ?? ""),
      };
    }
    case "email.complained":
      return { $tag: "Complained", id, at };
    case "email.opened": {
      const userAgent = (data.user_agent as string | undefined) ?? null;
      return { $tag: "Opened", id, at, userAgent };
    }
    case "email.clicked":
      return { $tag: "Clicked", id, at, url: String(data.link ?? data.url ?? "") };
    case "email.failed":
      return { $tag: "Failed", id, at, reason: String(data.reason ?? data.message ?? "failed") };
    default:
      return null;
  }
}

/** Pull the recipient address from a Resend event payload. Resend's
 *  `data.to` is an array; we take the first entry. */
export function resendEventRecipient(
  payload: Record<string, unknown>,
): { local: string; domain: string; displayName: null } | null {
  const data = (payload.data as Record<string, unknown>) ?? {};
  const toRaw = data.to as string[] | string | undefined;
  const first = Array.isArray(toRaw) ? toRaw[0] : toRaw;
  if (!first) return null;
  const at = first.indexOf("@");
  if (at < 0) return null;
  return {
    local: first.slice(0, at),
    domain: first.slice(at + 1),
    displayName: null,
  };
}
