// ---------------------------------------------------------------------------
// SES → SNS webhook payload → typed Fenel events
//
// SES doesn't push event webhooks directly; it publishes to an SNS
// topic, and SNS HTTP-subscriptions deliver to our endpoint. Two
// inbound shapes:
//
//   1. SubscriptionConfirmation — AWS asks us to GET the SubscribeURL
//      to confirm. The API verifies the signature and requires TopicArn to
//      match the account's configured SES_SNS_TOPIC_ARN before confirming.
//   2. Notification — the actual SES event, JSON-stringified inside
//      the `Message` field of the SNS envelope.
//
// The API ingress verifies SNS v1/v2 signatures before these mappers run.
// api/src/sns-signature.ts binds certificate retrieval to the configured
// topic's exact regional HTTPS SNS endpoint and checks canonical signed
// fields. The TopicArn is public routing data, never an authentication secret.
//
// Inbound mail is NOT handled here. SES inbound writes raw MIME to S3
// and requires Lambda processing — that's out of scope for v1.
// ---------------------------------------------------------------------------

import type { ModuleRegistry } from "@fenel/engine/registry";
import type {
  AddressValue,
  BounceKindValue,
  EmailEventValue,
  MessageIdValue,
  TimestampValue,
} from "./mailgun-webhook";

// ---------------------------------------------------------------------------
// SNS envelope types
// ---------------------------------------------------------------------------

export type SnsEnvelope = {
  Type?: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  TopicArn?: string;
  Message?: string;
  MessageId?: string;
  Timestamp?: string;
  Subject?: string;
  /** Present on SubscriptionConfirmation — fetch this URL to confirm. */
  SubscribeURL?: string;
  /** Present on SubscriptionConfirmation. */
  Token?: string;
  /** Cryptographic fields checked by the API's SNS verification boundary. */
  Signature?: string;
  SigningCertURL?: string;
  SignatureVersion?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tsFromIso(iso: unknown): TimestampValue {
  const ms = Date.parse(String(iso ?? ""));
  return { $tag: "Timestamp", epochMs: Number.isNaN(ms) ? Date.now() : ms };
}

function parseAddrSimple(s: string): AddressValue | null {
  const at = s.indexOf("@");
  if (at < 0) return null;
  return { local: s.slice(0, at), domain: s.slice(at + 1), displayName: null };
}

// ---------------------------------------------------------------------------
// SES event mapping (the JSON inside `Message`)
// ---------------------------------------------------------------------------

type SesMail = {
  timestamp?: string;
  messageId?: string;
  source?: string;
  destination?: string[];
  headers?: Array<{ name?: string; value?: string }>;
};

type SesBounce = {
  bounceType?: "Permanent" | "Transient" | "Undetermined";
  bounceSubType?: string;
  bouncedRecipients?: Array<{ emailAddress?: string; diagnosticCode?: string }>;
  timestamp?: string;
  feedbackId?: string;
};

type SesComplaint = {
  complainedRecipients?: Array<{ emailAddress?: string }>;
  timestamp?: string;
  feedbackId?: string;
};

type SesDelivery = {
  timestamp?: string;
  recipients?: string[];
  smtpResponse?: string;
};

type SesOpen = { timestamp?: string; userAgent?: string };
type SesClick = { timestamp?: string; link?: string; userAgent?: string };

export type SesEventInner = {
  eventType?: string;
  mail?: SesMail;
  bounce?: SesBounce;
  complaint?: SesComplaint;
  delivery?: SesDelivery;
  open?: SesOpen;
  click?: SesClick;
};

/** Translate a parsed SES event (the inner JSON from SNS Message) into
 *  the typed EmailEvent ADT. Returns null for event types we don't
 *  model (e.g. "Rendering Failure" with empty mail, or "Subscription"). */
export function sesEventToEmailEvent(payload: SesEventInner): EmailEventValue | null {
  const eventType = String(payload.eventType ?? "");
  const id: MessageIdValue = {
    $tag: "MessageId",
    _0: String(payload.mail?.messageId ?? ""),
  };

  switch (eventType) {
    case "Send":
      return { $tag: "Queued", id, at: tsFromIso(payload.mail?.timestamp) };
    case "Delivery":
      return { $tag: "Delivered", id, at: tsFromIso(payload.delivery?.timestamp ?? payload.mail?.timestamp) };
    case "Bounce": {
      const b = payload.bounce ?? {};
      const kind: BounceKindValue =
        b.bounceType === "Permanent"
          ? { $tag: "HardBounce" }
          : b.bounceType === "Transient"
            ? { $tag: "SoftBounce" }
            : { $tag: "BlockBounce" };
      const reason =
        b.bouncedRecipients?.[0]?.diagnosticCode
        ?? b.bounceSubType
        ?? "";
      return { $tag: "Bounced", id, at: tsFromIso(b.timestamp), kind, reason };
    }
    case "Complaint":
      return { $tag: "Complained", id, at: tsFromIso(payload.complaint?.timestamp) };
    case "Open":
      return {
        $tag: "Opened",
        id,
        at: tsFromIso(payload.open?.timestamp ?? payload.mail?.timestamp),
        userAgent: payload.open?.userAgent ?? null,
      };
    case "Click":
      return {
        $tag: "Clicked",
        id,
        at: tsFromIso(payload.click?.timestamp ?? payload.mail?.timestamp),
        url: String(payload.click?.link ?? ""),
      };
    case "Reject":
    case "RenderingFailure":
    case "Rendering Failure":
      return {
        $tag: "Failed",
        id,
        at: tsFromIso(payload.mail?.timestamp),
        reason: eventType,
      };
    default:
      return null;
  }
}

/** Pull the recipient address from an SES event payload. Different event
 *  types carry it under different shapes. */
export function sesEventRecipient(payload: SesEventInner): AddressValue | null {
  const eventType = String(payload.eventType ?? "");
  let raw: string | undefined;
  if (eventType === "Bounce") {
    raw = payload.bounce?.bouncedRecipients?.[0]?.emailAddress;
  } else if (eventType === "Complaint") {
    raw = payload.complaint?.complainedRecipients?.[0]?.emailAddress;
  } else if (eventType === "Delivery") {
    raw = payload.delivery?.recipients?.[0];
  } else {
    raw = payload.mail?.destination?.[0];
  }
  return raw ? parseAddrSimple(raw) : null;
}

// ---------------------------------------------------------------------------
// rights R4a C1a — THE TWO SNS OUTBOUND SITES, AS MEDIATED IO LEAVES.
//
// Both were bare `fetch` calls in `api/src/sns-signature.ts`, outside `perform`:
// no envelope judged them and no gate saw them. There are TWO, and the first is
// easy to miss because it lives inside the VERIFIER — a cold certificate cache
// makes `verifySnsEnvelope` reach the network before anything has been verified.
//
// Each leaf is one irreducible host act (a single bounded HTTPS GET), which is
// the ledger's existing "IO leaves" exception. Everything that is NOT
// irreducible IO stays in `api/src/sns-signature.ts`: the URL constraint to the
// configured topic's exact regional endpoint, the X509 parse, the signature
// check and the `VerifiedSnsEnvelope` brand — a host-private symbol no value can
// forge, by the same argument `design/authority.md` makes for the authority
// table itself.
// ---------------------------------------------------------------------------

/** A bounded read of a response body. AWS certificates are a few KB; anything
 *  larger is a malformed or hostile response, not a certificate. */
async function boundedText(response: Response, limit: number): Promise<string> {
  if (!response.ok || response.redirected) throw new Error("unexpected response");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > limit) throw new Error("response too large");
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

export function registerSesIngressHandlers(reg: ModuleRegistry): void {
  reg.registerIOHandler("email_webhooks.sns_fetch_signing_certificate", async (params) => {
    const url = params["url"] as string | undefined;
    if (!url) return { action: "continue", value: { $tag: "Nothing" } };
    try {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
      // 16 KiB — the SAME bound `api/src/sns-signature.ts`'s `boundedCertificate`
      // enforces. Two different limits would mean a body this leaf accepted and
      // the verifier then rejected, which reads as a verification failure rather
      // than as the size refusal it is.
      return { action: "continue", value: { $tag: "Just", _0: await boundedText(response, 16_384) } };
    } catch {
      // ⚠ Nothing, never a throw. A transport failure is an OUTAGE, and the
      // caller answers 503 so SNS retries; conflating it with a verification
      // failure would answer 403 and drop the event permanently.
      return { action: "continue", value: { $tag: "Nothing" } };
    }
  });

  reg.registerIOHandler("email_webhooks.sns_confirm_subscription", async (params) => {
    const url = params["url"] as string | undefined;
    if (!url) return { action: "continue", value: false };
    try {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
      await response.body?.cancel();
      return { action: "continue", value: response.ok && !response.redirected };
    } catch {
      return { action: "continue", value: false };
    }
  });
}
