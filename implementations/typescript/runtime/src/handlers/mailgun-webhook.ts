// ---------------------------------------------------------------------------
// Mailgun webhook payload → typed Fenel events
//
// Two ingestion paths:
//   - /events: lifecycle webhooks (delivered, failed, complained, opened,
//     clicked, unsubscribed, accepted, rejected). JSON body envelope.
//   - /inbound: parsed inbound mail (Routes "store and notify"). multipart
//     form body — caller must pre-parse to a fields dict before calling.
//
// Both signed: HMAC-SHA256 over `timestamp + token` with the per-account
// MAILGUN_WEBHOOK_SIGNING_KEY. We verify in constant time; mismatched
// length and unparseable hex both fail closed.
//
// Mapping is pure: the route handler verifies the signature, extracts
// fields, and calls these functions. The result is a typed value matching
// the email module's ADTs. The route then `appendEvent`s the typed value
// to the event log under the right event type and `processEvent`s it so
// triggers can fire.
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from "node:crypto";
import { parseAddressNative } from "@fenel/engine/modules/email";

// ---------------------------------------------------------------------------
// Type mirrors of the email module's ADTs (runtime representation)
// ---------------------------------------------------------------------------

export type AddressValue = {
  local: string;
  domain: string;
  displayName: string | null;
};

export type HeaderValue = { name: string; value: string };

export type BodyValue =
  | { $tag: "Text"; _0: string }
  | { $tag: "Html"; _0: string }
  | { $tag: "Multipart"; text: string; html: string };

export type AssetRefValue = {
  url: string;
  name: string;
  mimeType: string;
};

export type AttachmentValue = {
  asset: AssetRefValue;
  contentId: string | null;
};

export type EmailValue = {
  from: AddressValue;
  to: AddressValue[];
  cc: AddressValue[];
  bcc: AddressValue[];
  replyTo: AddressValue | null;
  subject: string;
  body: BodyValue;
  attachments: AttachmentValue[];
  headers: HeaderValue[];
  inReplyTo: string | null;
  references: string[];
};

export type MessageIdValue = { $tag: "MessageId"; _0: string };
export type TimestampValue = { $tag: "Timestamp"; epochMs: number };

export type BounceKindValue =
  | { $tag: "HardBounce" }
  | { $tag: "SoftBounce" }
  | { $tag: "BlockBounce" };

export type EmailEventValue =
  | { $tag: "Queued"; id: MessageIdValue; at: TimestampValue }
  | { $tag: "Delivered"; id: MessageIdValue; at: TimestampValue }
  | { $tag: "Bounced"; id: MessageIdValue; at: TimestampValue; kind: BounceKindValue; reason: string }
  | { $tag: "Complained"; id: MessageIdValue; at: TimestampValue }
  | { $tag: "Opened"; id: MessageIdValue; at: TimestampValue; userAgent: string | null }
  | { $tag: "Clicked"; id: MessageIdValue; at: TimestampValue; url: string }
  | { $tag: "Unsubscribed"; id: MessageIdValue; at: TimestampValue }
  | { $tag: "Failed"; id: MessageIdValue; at: TimestampValue; reason: string };

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/** Verify a Mailgun webhook signature in constant time. Returns false for
 *  any malformed input — never throws. */
export function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string,
  signingKey: string,
): boolean {
  if (!timestamp || !token || !signature || !signingKey) return false;
  const expected = createHmac("sha256", signingKey)
    .update(timestamp + token)
    .digest("hex");
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expected, "hex");
    b = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Event mapping
// ---------------------------------------------------------------------------

function stripBrackets(s: string): string {
  return s.replace(/^<|>$/g, "");
}

function extractMessageId(ev: Record<string, unknown>): string {
  const message = ev.message as { headers?: Record<string, unknown> } | undefined;
  const headers = message?.headers;
  if (headers && typeof headers["message-id"] === "string") {
    return stripBrackets(headers["message-id"] as string);
  }
  return stripBrackets(String(ev.id ?? ""));
}

/** Translate a Mailgun event-data record into the typed EmailEvent ADT.
 *  Returns null for event names we don't model (informational logs etc.). */
export function mailgunEventToEmailEvent(
  eventData: Record<string, unknown>,
): EmailEventValue | null {
  const event = String(eventData.event ?? "");
  const tsSec = Number(eventData.timestamp ?? 0);
  const at: TimestampValue = { $tag: "Timestamp", epochMs: Math.floor(tsSec * 1000) };
  const id: MessageIdValue = { $tag: "MessageId", _0: extractMessageId(eventData) };

  switch (event) {
    case "accepted":
      return { $tag: "Queued", id, at };
    case "delivered":
      return { $tag: "Delivered", id, at };
    case "failed": {
      const severity = String(eventData.severity ?? "");
      const reason = String(eventData.reason ?? "");
      const kind: BounceKindValue =
        severity === "permanent"
          ? { $tag: "HardBounce" }
          : severity === "temporary"
            ? { $tag: "SoftBounce" }
            : { $tag: "BlockBounce" };
      return { $tag: "Bounced", id, at, kind, reason };
    }
    case "rejected": {
      const reason = String(
        ((eventData.reject as { reason?: string })?.reason)
          ?? eventData.reason
          ?? "rejected",
      );
      return { $tag: "Failed", id, at, reason };
    }
    case "complained":
      return { $tag: "Complained", id, at };
    case "opened": {
      const clientInfo = eventData["client-info"] as { "user-agent"?: string } | undefined;
      const userAgent = clientInfo?.["user-agent"] ?? null;
      return { $tag: "Opened", id, at, userAgent };
    }
    case "clicked":
      return { $tag: "Clicked", id, at, url: String(eventData.url ?? "") };
    case "unsubscribed":
      return { $tag: "Unsubscribed", id, at };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Inbound mapping
// ---------------------------------------------------------------------------

const EMPTY_ADDRESS: AddressValue = { local: "", domain: "", displayName: null };

function safeParse(s: string): AddressValue {
  return parseAddressNative(s) ?? EMPTY_ADDRESS;
}

/** Convert a parsed Mailgun inbound (Routes) form-data record into the
 *  typed Email ADT. Multi-recipient `to`/`cc` are split on commas.
 *  Attachments are NOT downloaded here — the caller is responsible for
 *  pulling Mailgun's attachment URLs and persisting them through the
 *  storage capability before / after calling this mapper. */
export function mailgunInboundToEmail(
  fields: Record<string, string>,
): EmailValue {
  const from = safeParse(fields.sender ?? fields.from ?? fields.From ?? "");
  const recipient = String(fields.recipient ?? fields.To ?? "");
  const to: AddressValue[] = recipient
    .split(",")
    .map((s) => parseAddressNative(s.trim()))
    .filter((a): a is AddressValue => a !== null);
  if (to.length === 0) to.push(EMPTY_ADDRESS);

  const headers: HeaderValue[] = [];
  let cc: AddressValue[] = [];
  let replyTo: AddressValue | null = null;
  try {
    const parsed = JSON.parse(fields["message-headers"] ?? "[]");
    if (Array.isArray(parsed)) {
      for (const pair of parsed) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        const [k, v] = pair as [string, string];
        const name = String(k);
        const value = String(v);
        headers.push({ name, value });
        const lower = name.toLowerCase();
        if (lower === "cc") {
          cc = value
            .split(",")
            .map((s) => parseAddressNative(s.trim()))
            .filter((a): a is AddressValue => a !== null);
        } else if (lower === "reply-to") {
          replyTo = parseAddressNative(value);
        }
      }
    }
  } catch {
    // malformed headers — ignore, fall back to top-level fields
  }

  const text = String(fields["body-plain"] ?? "");
  const html = String(fields["body-html"] ?? "");
  const body: BodyValue =
    text && html
      ? { $tag: "Multipart", text, html }
      : html
        ? { $tag: "Html", _0: html }
        : { $tag: "Text", _0: text };

  const refsRaw = String(fields.References ?? "").trim();
  const references = refsRaw
    ? refsRaw.split(/\s+/).filter(Boolean).map(stripBrackets)
    : [];

  const inReplyToRaw = fields["In-Reply-To"];
  const inReplyTo = inReplyToRaw ? stripBrackets(String(inReplyToRaw)) : null;

  return {
    from,
    to,
    cc,
    bcc: [],
    replyTo,
    subject: String(fields.subject ?? fields.Subject ?? ""),
    body,
    attachments: [],
    headers,
    inReplyTo,
    references,
  };
}
