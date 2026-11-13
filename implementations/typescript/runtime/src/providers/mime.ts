// ---------------------------------------------------------------------------
// Minimal MIME builder for outbound email with attachments.
//
// SES SendEmail (Simple content) can't carry attachments — only Raw
// content can. Raw content is a full RFC 5322 message: headers, then
// `multipart/mixed` containing `multipart/alternative` (text + html)
// followed by one part per attachment.
//
// Phase 11b sub-step 3 — the pure helpers (quotedPrintable / formatAddress
// / joinAddrs / bodyText / bodyHtml / guessContentType / wrapBase64) are
// now Fenel-bodied; this file's locally-defined helpers collapse to thin
// shims that route through the dispatched wrappers in
// `../runtime-bodies-dispatch.ts`. The non-pure helpers (`makeBoundary` /
// `rfc822Date`), the substrate-deferred `base64Encode`, the async IO
// (`fetchAttachments`), and the orchestrator (`buildMime`) stay TS-side.
//
// Layout:
//
//   From: ...
//   To: ...
//   Subject: ...
//   MIME-Version: 1.0
//   Content-Type: multipart/mixed; boundary="OUTER"
//
//   --OUTER
//   Content-Type: multipart/alternative; boundary="INNER"
//
//   --INNER
//   Content-Type: text/plain; charset=UTF-8
//   Content-Transfer-Encoding: quoted-printable
//
//   <text body>
//
//   --INNER
//   Content-Type: text/html; charset=UTF-8
//   Content-Transfer-Encoding: quoted-printable
//
//   <html body>
//
//   --INNER--
//   --OUTER
//   Content-Type: <type>; name="<filename>"
//   Content-Transfer-Encoding: base64
//   Content-Disposition: attachment; filename="<filename>"
//
//   <base64 bytes>
//
//   --OUTER--
//
// We deliberately use `quoted-printable` for body parts (so 8-bit and
// long lines survive transit) and `base64` for binary attachments.
// ---------------------------------------------------------------------------

import type {
  AddressValue,
  AttachmentValue,
  EmailValue,
  HeaderValue,
} from "./mailgun";
import {
  dispatchedQuotedPrintable,
  dispatchedFormatAddress,
  dispatchedJoinAddrs,
  dispatchedBodyText,
  dispatchedBodyHtml,
  dispatchedGuessContentType,
  dispatchedWrapBase64,
} from "../runtime-bodies-dispatch";

/** Encode a string as quoted-printable per RFC 2045. Plain ASCII passes
 *  through; bytes outside `33-126` (and `=`) are encoded as `=XX`.
 *  Lines are wrapped at 76 chars with a soft line break (`=\r\n`).
 *  Phase 11b sub-step 3: dispatches through `runtime:quotedPrintable`. */
export function quotedPrintable(input: string): string {
  return dispatchedQuotedPrintable(input);
}

/** Encode raw bytes as base64 (browser/Bun-native btoa over a binary string).
 *  DEFER per Phase 11b sub-step 3 — needs `std:base64Encode` substrate
 *  primitive. `codec:base64Encode` exists but its Result<EncErr, String>
 *  signature differs from this String-returning shape. */
export function base64Encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function makeBoundary(prefix: string): string {
  // 16 random bytes is plenty to make collision negligible. We use
  // crypto.getRandomValues so this works in both Bun and Node. Non-pure
  // — stays TS-side. Could route through a future `io:random_hex` IO
  // primitive.
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let hex = "";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return `=_${prefix}_${hex}`;
}

function rfc822Date(d = new Date()): string {
  // SES doesn't strictly require a Date header (it'll add one), but
  // including it keeps the message canonical for archive / diff.
  // Non-pure (wall-clock time) — stays TS-side.
  return d.toUTCString();
}

export type FetchedAttachment = {
  filename: string;
  contentType: string;
  contentId: string | null;
  bytes: Uint8Array;
};

/** Resolve all attachments in parallel by fetching their asset URLs.
 *  Returns the successfully-fetched ones; logs and drops failures.
 *  Caller decides whether to abort the whole send or proceed without.
 *  Prefers `att.asset.mimeType` over the network-returned Content-Type
 *  when both are available — the AssetRef is the source of truth.
 *  IO leaf (async HTTP) — stays TS-side. */
export async function fetchAttachments(
  attachments: AttachmentValue[],
): Promise<FetchedAttachment[]> {
  const results = await Promise.all(
    attachments.map(async (att): Promise<FetchedAttachment | null> => {
      try {
        const resp = await fetch(att.asset.url);
        if (!resp.ok) {
          console.warn(`[mime] attachment fetch ${resp.status}: ${att.asset.url}`);
          return null;
        }
        const ct =
          att.asset.mimeType
          || resp.headers.get("content-type")
          || dispatchedGuessContentType(att.asset.name);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        return {
          filename: att.asset.name,
          contentType: ct,
          contentId: att.contentId,
          bytes,
        };
      } catch (err) {
        console.warn(`[mime] attachment fetch error: ${att.asset.url}`, err);
        return null;
      }
    }),
  );
  return results.filter((r): r is FetchedAttachment => r !== null);
}

/** Build a complete RFC 5322 / MIME message from an Email value plus
 *  pre-fetched attachments. Returns the message as a Uint8Array (raw
 *  bytes — line endings are CRLF as MIME requires).
 *
 *  When the email has no attachments we still emit `multipart/mixed`
 *  with a single `multipart/alternative` part — keeps the layout
 *  uniform and lets callers always pass the result to SES Raw without
 *  branching. (For SES, callers should keep using Simple content when
 *  there are no attachments — it's slightly cheaper. Use `buildMime`
 *  only when you need attachments.)
 *
 *  Phase 11b sub-step 3: orchestrator stays TS-side; the pure helpers
 *  it composes (quotedPrintable / formatAddress / joinAddrs / bodyText
 *  / bodyHtml / wrapBase64) are dispatched through Fenel bodies. */
export function buildMime(
  email: EmailValue,
  fetched: FetchedAttachment[],
): Uint8Array {
  const outer = makeBoundary("OUTER");
  const inner = makeBoundary("INNER");

  const headers: string[] = [];
  headers.push(`From: ${dispatchedFormatAddress(email.from)}`);
  if (email.to.length > 0) headers.push(`To: ${dispatchedJoinAddrs(email.to)}`);
  if (email.cc.length > 0) headers.push(`Cc: ${dispatchedJoinAddrs(email.cc)}`);
  // BCC is intentionally omitted from the visible headers — the SES
  // envelope still routes to those recipients via the Destination
  // BccAddresses field at the SDK call site.
  if (email.replyTo) headers.push(`Reply-To: ${dispatchedFormatAddress(email.replyTo)}`);
  headers.push(`Subject: ${email.subject}`);
  headers.push(`Date: ${rfc822Date()}`);
  headers.push(`MIME-Version: 1.0`);
  headers.push(`Content-Type: multipart/mixed; boundary="${outer}"`);
  for (const h of email.headers) headers.push(`${h.name}: ${h.value}`);
  if (email.inReplyTo) headers.push(`In-Reply-To: <${email.inReplyTo}>`);
  if (email.references.length > 0) {
    headers.push(`References: ${email.references.map((r) => `<${r}>`).join(" ")}`);
  }

  const text = dispatchedBodyText(email.body);
  const html = dispatchedBodyHtml(email.body);

  const parts: string[] = [];
  parts.push(headers.join("\r\n") + "\r\n");

  // multipart/mixed inner: alternative + each attachment
  parts.push(`--${outer}\r\n`);
  parts.push(`Content-Type: multipart/alternative; boundary="${inner}"\r\n\r\n`);

  if (text !== null) {
    parts.push(`--${inner}\r\n`);
    parts.push(`Content-Type: text/plain; charset=UTF-8\r\n`);
    parts.push(`Content-Transfer-Encoding: quoted-printable\r\n\r\n`);
    parts.push(dispatchedQuotedPrintable(text) + "\r\n");
  }
  if (html !== null) {
    parts.push(`--${inner}\r\n`);
    parts.push(`Content-Type: text/html; charset=UTF-8\r\n`);
    parts.push(`Content-Transfer-Encoding: quoted-printable\r\n\r\n`);
    parts.push(dispatchedQuotedPrintable(html) + "\r\n");
  }
  parts.push(`--${inner}--\r\n`);

  for (const att of fetched) {
    parts.push(`--${outer}\r\n`);
    parts.push(`Content-Type: ${att.contentType}; name="${att.filename.replace(/"/g, "")}"\r\n`);
    parts.push(`Content-Transfer-Encoding: base64\r\n`);
    const disposition = att.contentId ? "inline" : "attachment";
    parts.push(`Content-Disposition: ${disposition}; filename="${att.filename.replace(/"/g, "")}"\r\n`);
    if (att.contentId) parts.push(`Content-ID: <${att.contentId}>\r\n`);
    parts.push(`\r\n`);
    parts.push(dispatchedWrapBase64(base64Encode(att.bytes)) + "\r\n");
  }
  parts.push(`--${outer}--\r\n`);

  return new TextEncoder().encode(parts.join(""));
}

// Re-exported helpers for callers that want to construct attachments by
// hand without going through `fetchAttachments` (e.g. tests).
//
// Phase 11b sub-step 3: `formatAddressForMime` was a re-export of the
// local `formatAddress`. With the local definition removed, callers
// should import `dispatchedFormatAddress` directly from
// `../runtime-bodies-dispatch`. The re-export is kept (as a 1-line
// shim around the dispatched form) for backwards-compatibility with
// any external caller; the runtime tree itself has no users — confirmed
// via repo-wide grep at port time.
export function formatAddressForMime(
  a: AddressValue | null | undefined,
): string {
  return dispatchedFormatAddress(a);
}

export type { HeaderValue };
