// ---------------------------------------------------------------------------
// Postmark webhook payload → typed Fenel events
//
// Postmark fires one webhook per event with `RecordType` discriminating
// the kind. Inbound mail arrives as parsed JSON (one of the cleanest
// inbound APIs of any provider — no MIME parsing needed).
//
// Authentication: Postmark recommends Basic Auth or a signed URL token.
// We embed the integration id in the URL path; the unguessable UUID
// gates access. (Optional: Postmark also signs payloads via
// X-Postmark-Signature when configured; we don't currently require it.)
// ---------------------------------------------------------------------------

import { parseAddressNative } from "@fenel/engine/modules/email";
import type {
  AddressValue,
  AssetRefValue,
  AttachmentValue,
  BodyValue,
  BounceKindValue,
  EmailValue,
  EmailEventValue,
  HeaderValue,
  MessageIdValue,
  TimestampValue,
} from "./mailgun-webhook";

const EMPTY_ADDRESS: AddressValue = { local: "", domain: "", displayName: null };

function safeParse(s: string): AddressValue {
  return parseAddressNative(s) ?? EMPTY_ADDRESS;
}

function tsFromIso(iso: unknown): TimestampValue {
  const ms = Date.parse(String(iso ?? ""));
  return { $tag: "Timestamp", epochMs: Number.isNaN(ms) ? Date.now() : ms };
}

// ---------------------------------------------------------------------------
// Outbound event mapping
// ---------------------------------------------------------------------------

/** Translate a Postmark webhook payload into the typed EmailEvent ADT.
 *  Returns null for record types we don't model (e.g. `SubscriptionChange`
 *  in some flows). */
export function postmarkEventToEmailEvent(
  payload: Record<string, unknown>,
): EmailEventValue | null {
  const recordType = String(payload.RecordType ?? "");
  const id: MessageIdValue = {
    $tag: "MessageId",
    _0: String(payload.MessageID ?? ""),
  };
  // Postmark uses different timestamp field names per record type.
  const at = tsFromIso(
    payload.DeliveredAt ?? payload.BouncedAt ?? payload.ReceivedAt ?? payload.OpenedAt ?? payload.ClickedAt ?? payload.ChangedAt,
  );

  switch (recordType) {
    case "Delivery":
      return { $tag: "Delivered", id, at };
    case "Bounce": {
      const type = String(payload.Type ?? "");
      const reason = String(payload.Description ?? payload.Details ?? "");
      const kind: BounceKindValue =
        type === "HardBounce"
          ? { $tag: "HardBounce" }
          : type === "SoftBounce" || type === "Transient"
            ? { $tag: "SoftBounce" }
            : { $tag: "BlockBounce" };
      return { $tag: "Bounced", id, at, kind, reason };
    }
    case "SpamComplaint":
      return { $tag: "Complained", id, at };
    case "Open": {
      const userAgent = payload.UserAgent ? String(payload.UserAgent) : null;
      return { $tag: "Opened", id, at, userAgent };
    }
    case "Click":
      return { $tag: "Clicked", id, at, url: String(payload.OriginalLink ?? payload.Link ?? "") };
    case "SubscriptionChange":
      // Postmark fires this when a recipient unsubscribes or is added to
      // suppression. Only treat the "suppress" direction as Unsubscribed.
      if (payload.SuppressSending === true) {
        return { $tag: "Unsubscribed", id, at };
      }
      return null;
    default:
      return null;
  }
}

/** Extract the recipient address from a Postmark event payload. Used
 *  by the webhook handler to drive auto-suppression. */
export function postmarkEventRecipient(payload: Record<string, unknown>): AddressValue | null {
  const raw = String(payload.Recipient ?? payload.Email ?? "");
  return parseAddressNative(raw);
}

/** Pull a stable per-event identifier for idempotency. Postmark uses
 *  (MessageID, RecordType) — same MessageID can produce many records
 *  (one Delivery, multiple Opens, etc.) so we must combine them. */
export function postmarkEventDedupeKey(payload: Record<string, unknown>): string {
  const recordType = String(payload.RecordType ?? "unknown");
  const messageId = String(payload.MessageID ?? "");
  // Click and Open events can fire repeatedly for the same MessageID;
  // include the timestamp to distinguish them.
  const time = String(
    payload.ReceivedAt ?? payload.ClickedAt ?? payload.OpenedAt ?? payload.DeliveredAt ?? payload.BouncedAt ?? "",
  );
  return `${recordType}:${messageId}:${time}`;
}

// ---------------------------------------------------------------------------
// Inbound mapping
// ---------------------------------------------------------------------------

type PostmarkInboundAttachment = {
  Name?: string;
  Content?: string;       // base64
  ContentType?: string;
  ContentLength?: number;
  ContentID?: string;
};

/** Convert a Postmark inbound webhook payload to the typed Email ADT.
 *  Postmark gives us already-parsed JSON: addresses are formatted
 *  strings, body is split into TextBody / HtmlBody, headers are an
 *  array of {Name, Value} pairs.
 *
 *  Attachments are inline base64. We decode and stash them as data:
 *  URLs in `AssetRef.url` — the storage capability isn't yet wired
 *  through the inbound path. Future: upload to content-addressable
 *  storage and produce an asset entity URL instead. */
export function postmarkInboundToEmail(
  payload: Record<string, unknown>,
): EmailValue {
  const from = safeParse(String(payload.From ?? payload.FromFull ?? ""));
  const toRaw = String(payload.To ?? "");
  const to = toRaw
    .split(",")
    .map((s) => parseAddressNative(s.trim()))
    .filter((a): a is AddressValue => a !== null);
  if (to.length === 0) to.push(EMPTY_ADDRESS);

  const ccRaw = String(payload.Cc ?? "");
  const cc = ccRaw
    ? ccRaw.split(",").map((s) => parseAddressNative(s.trim())).filter((a): a is AddressValue => a !== null)
    : [];

  const headersRaw = (payload.Headers as Array<{ Name?: string; Value?: string }>) ?? [];
  const headers: HeaderValue[] = headersRaw.map((h) => ({
    name: String(h.Name ?? ""),
    value: String(h.Value ?? ""),
  }));

  const replyToHeader = headersRaw.find((h) => String(h.Name ?? "").toLowerCase() === "reply-to");
  const replyTo = replyToHeader?.Value ? parseAddressNative(String(replyToHeader.Value)) : null;

  const text = String(payload.TextBody ?? "");
  const html = String(payload.HtmlBody ?? "");
  const body: BodyValue =
    text && html
      ? { $tag: "Multipart", text, html }
      : html
        ? { $tag: "Html", _0: html }
        : { $tag: "Text", _0: text };

  const attachmentsRaw = (payload.Attachments as PostmarkInboundAttachment[]) ?? [];
  const attachments: AttachmentValue[] = attachmentsRaw.map((a) => {
    const asset: AssetRefValue = {
      url: a.Content ? `data:${a.ContentType ?? "application/octet-stream"};base64,${a.Content}` : "",
      name: String(a.Name ?? ""),
      mimeType: String(a.ContentType ?? "application/octet-stream"),
    };
    return {
      asset,
      contentId: a.ContentID ? String(a.ContentID).replace(/^cid:/, "") : null,
    };
  });

  const inReplyToHeader = headersRaw.find((h) => String(h.Name ?? "").toLowerCase() === "in-reply-to");
  const inReplyTo = inReplyToHeader?.Value
    ? String(inReplyToHeader.Value).replace(/^<|>$/g, "")
    : null;

  const referencesHeader = headersRaw.find((h) => String(h.Name ?? "").toLowerCase() === "references");
  const references = referencesHeader?.Value
    ? String(referencesHeader.Value).split(/\s+/).filter(Boolean).map((s) => s.replace(/^<|>$/g, ""))
    : [];

  return {
    from,
    to,
    cc,
    bcc: [],
    replyTo,
    subject: String(payload.Subject ?? ""),
    body,
    attachments,
    headers,
    inReplyTo,
    references,
  };
}
