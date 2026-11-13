// ---------------------------------------------------------------------------
// Mailgun provider — concrete implementation of the `email` capability.
//
// Two shapes of work:
//   1. Pure mappings (Email ADT ↔ Mailgun multipart form, Mailgun domain
//      JSON ↔ SendingDomain ADT, error → SendError ADT). These are
//      independently testable without HTTP.
//   2. Handlers — async functions matching the runtime ProviderFn
//      signature, registered into PROVIDER_IMPLS as `email.mailgun.*`.
//
// Mailgun has two regions; the API base URL is picked from creds.
// Outbound endpoint expects multipart/form-data; domain endpoints take
// urlencoded form bodies. Auth is HTTP Basic with `api:<key>`.
//
// Attachments: an `Attachment.asset` is the URL of an asset blob. We
// fetch the bytes at send time and append them as multipart parts. If the
// fetch fails, we drop that attachment and continue (logged in stderr).
// Future: route through the engine's storage capability instead of HTTP.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AddressValue = {
  local: string;
  domain: string;
  displayName: string | null;
};

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

export type HeaderValue = { name: string; value: string };

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

export type SendResultValue =
  | { $tag: "Sent"; id: MessageIdValue }
  | { $tag: "Rejected"; reason: SendErrorValue };

export type SendErrorValue =
  | { $tag: "InvalidAddress"; _0: string }
  | { $tag: "DomainNotVerified"; _0: string }
  | { $tag: "RateLimited"; _0: number }
  | { $tag: "Suppressed"; _0: string }
  | { $tag: "ProviderError"; code: string; message: string };

export type DnsRecordValue = {
  kind: string;
  host: string;
  value: string;
  verified: boolean;
};

export type DomainStatusValue =
  | { $tag: "DomainPending" }
  | { $tag: "DomainVerified" }
  | { $tag: "DomainFailed"; reason: string };

export type SendingDomainValue = {
  name: string;
  status: DomainStatusValue;
  dkimRecords: DnsRecordValue[];
  spfRecord: DnsRecordValue;
  returnPathRecord: DnsRecordValue;
  inboundMxRecord: DnsRecordValue | null;
};

type Credentials = Record<string, string>;

// ---------------------------------------------------------------------------
// Pure helpers — testable without HTTP
// ---------------------------------------------------------------------------

/** Pick the Mailgun API base URL based on the region credential. */
export function mailgunBaseUrl(creds: Credentials): string {
  return creds.MAILGUN_REGION === "eu"
    ? "https://api.eu.mailgun.net"
    : "https://api.mailgun.net";
}

/** Render an Address as an RFC 5322 string (the Mailgun wire format). */
export function formatAddress(a: AddressValue | null | undefined): string {
  if (!a || !a.local || !a.domain) return "";
  const addr = `${a.local}@${a.domain}`;
  if (a.displayName) return `"${a.displayName.replace(/"/g, "")}" <${addr}>`;
  return addr;
}

/** Extract text body, if any. */
export function bodyText(b: BodyValue | null | undefined): string | null {
  if (!b) return null;
  if (b.$tag === "Text") return b._0;
  if (b.$tag === "Multipart") return b.text;
  return null;
}

/** Extract HTML body, if any. */
export function bodyHtml(b: BodyValue | null | undefined): string | null {
  if (!b) return null;
  if (b.$tag === "Html") return b._0;
  if (b.$tag === "Multipart") return b.html;
  return null;
}

/** Build the multipart FormData body for POST /messages.
 *
 *  Async because attachments are fetched from their `asset` URLs. Any
 *  attachment whose fetch fails is dropped (warned, not thrown) so a
 *  single bad asset doesn't block the whole send. */
export async function buildMailgunFormData(email: EmailValue): Promise<FormData> {
  const form = new FormData();
  form.set("from", formatAddress(email.from));
  for (const a of email.to) form.append("to", formatAddress(a));
  for (const a of email.cc) form.append("cc", formatAddress(a));
  for (const a of email.bcc) form.append("bcc", formatAddress(a));
  if (email.replyTo) form.set("h:Reply-To", formatAddress(email.replyTo));
  form.set("subject", email.subject);

  const text = bodyText(email.body);
  const html = bodyHtml(email.body);
  if (text !== null) form.set("text", text);
  if (html !== null) form.set("html", html);

  for (const h of email.headers) form.set(`h:${h.name}`, h.value);
  if (email.inReplyTo) form.set("h:In-Reply-To", email.inReplyTo);
  if (email.references.length > 0) {
    form.set("h:References", email.references.join(" "));
  }

  for (const att of email.attachments) {
    try {
      const resp = await fetch(att.asset.url);
      if (!resp.ok) {
        console.warn(`[mailgun] attachment fetch failed (${resp.status}): ${att.asset.url}`);
        continue;
      }
      const blob = await resp.blob();
      const field = att.contentId ? "inline" : "attachment";
      form.append(field, blob, att.asset.name);
    } catch (err) {
      console.warn(`[mailgun] attachment fetch error: ${att.asset.url}`, err);
    }
  }

  return form;
}

/** Map a non-2xx fetch response into a typed SendError. */
export async function mapMailgunSendError(resp: Response): Promise<SendErrorValue> {
  const status = resp.status;
  const text = await resp.text().catch(() => "");
  if (status === 401 || status === 403) {
    return { $tag: "ProviderError", code: String(status), message: text || "Authentication failed" };
  }
  if (status === 429) {
    const retry = parseInt(resp.headers.get("retry-after") ?? "60", 10);
    return { $tag: "RateLimited", _0: Number.isFinite(retry) ? retry : 60 };
  }
  if (status === 400) {
    // Mailgun wraps errors as { message: "..." } — try to detect specifics.
    const lower = text.toLowerCase();
    if (lower.includes("not a valid")) {
      return { $tag: "InvalidAddress", _0: text };
    }
    if (lower.includes("domain") && lower.includes("not")) {
      const domainMatch = /([a-z0-9.-]+\.[a-z]{2,})/i.exec(text);
      return { $tag: "DomainNotVerified", _0: domainMatch?.[1] ?? "" };
    }
  }
  return { $tag: "ProviderError", code: String(status), message: text || `HTTP ${status}` };
}

/** Convert the JSON shape Mailgun returns from /v4/domains/* endpoints
 *  into the typed SendingDomain ADT. Mailgun's responses vary slightly
 *  between create / verify / list — this helper accepts the most general
 *  superset and fills missing fields with sensible defaults. */
export function mapMailgunDomain(payload: unknown): SendingDomainValue {
  const obj = (payload as Record<string, unknown>) ?? {};
  const domainObj = (obj.domain as Record<string, unknown>) ?? obj;
  const name = String(domainObj.name ?? "");
  const state = String(domainObj.state ?? "unverified").toLowerCase();
  const status: DomainStatusValue =
    state === "active" || state === "verified"
      ? { $tag: "DomainVerified" }
      : state === "failed" || state === "disabled"
        ? { $tag: "DomainFailed", reason: state }
        : { $tag: "DomainPending" };

  const sending = (obj.sending_dns_records as Array<Record<string, unknown>>) ?? [];
  const receiving = (obj.receiving_dns_records as Array<Record<string, unknown>>) ?? [];

  const dkimRecords: DnsRecordValue[] = [];
  let spfRecord: DnsRecordValue = { kind: "TXT", host: name, value: "", verified: false };
  let returnPathRecord: DnsRecordValue = { kind: "CNAME", host: `email.${name}`, value: "", verified: false };

  for (const r of sending) {
    const kind = String(r.record_type ?? "TXT");
    const host = String(r.name ?? "");
    const value = String(r.value ?? "");
    const verified = String(r.valid ?? "unknown") === "valid";
    if (kind === "TXT" && host.startsWith("k=") || /._domainkey/.test(host)) {
      dkimRecords.push({ kind, host, value, verified });
    } else if (kind === "TXT") {
      spfRecord = { kind, host, value, verified };
    } else if (kind === "CNAME") {
      returnPathRecord = { kind, host, value, verified };
    }
  }

  let inboundMxRecord: DnsRecordValue | null = null;
  if (receiving.length > 0) {
    const r = receiving[0]!;
    inboundMxRecord = {
      kind: String(r.record_type ?? "MX"),
      host: name,
      value: String(r.value ?? ""),
      verified: String(r.valid ?? "unknown") === "valid",
    };
  }

  return { name, status, dkimRecords, spfRecord, returnPathRecord, inboundMxRecord };
}

// ---------------------------------------------------------------------------
// Handlers — async ProviderFn-shaped functions
// ---------------------------------------------------------------------------

/** Send one email via Mailgun. Returns a typed SendResult. */
export async function mailgunSend(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendResultValue> {
  const email = params.email as EmailValue;
  if (!email?.from?.domain) {
    return { $tag: "Rejected", reason: { $tag: "InvalidAddress", _0: "missing from.domain" } };
  }
  // Use the from-domain when sending; fall back to the configured default.
  const sendingDomain = email.from.domain || creds.MAILGUN_DOMAIN || "";
  if (!sendingDomain) {
    return { $tag: "Rejected", reason: { $tag: "DomainNotVerified", _0: "" } };
  }

  const form = await buildMailgunFormData(email);
  const auth = `Basic ${btoa(`api:${creds.MAILGUN_API_KEY}`)}`;
  const resp = await fetch(`${mailgunBaseUrl(creds)}/v3/${encodeURIComponent(sendingDomain)}/messages`, {
    method: "POST",
    headers: { Authorization: auth },
    body: form,
  });
  if (!resp.ok) {
    return { $tag: "Rejected", reason: await mapMailgunSendError(resp) };
  }
  const data = (await resp.json()) as { id?: string };
  const id = String(data.id ?? "").replace(/^<|>$/g, "");
  return { $tag: "Sent", id: { $tag: "MessageId", _0: id } };
}

/** Send a batch — Mailgun's batch endpoint requires recipient-variables
 *  setup, which complicates the mapping. For the v1 implementation we
 *  just iterate. Throughput will be lower than true batching but the
 *  external surface stays identical. Future: switch to recipient-variables. */
export async function mailgunSendBatch(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendResultValue[]> {
  const emails = (params.emails as EmailValue[]) ?? [];
  const results: SendResultValue[] = [];
  for (const email of emails) {
    results.push(await mailgunSend({ email }, creds));
  }
  return results;
}

/** Suppress an address — adds it to the per-domain unsubscribe list. */
export async function mailgunSuppress(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<Record<string, never>> {
  const address = params.address as AddressValue;
  const reason = String(params.reason ?? "");
  const sendingDomain = address?.domain || creds.MAILGUN_DOMAIN;
  if (!sendingDomain) return {};
  const auth = `Basic ${btoa(`api:${creds.MAILGUN_API_KEY}`)}`;
  await fetch(`${mailgunBaseUrl(creds)}/v3/${encodeURIComponent(sendingDomain)}/unsubscribes`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      address: `${address.local}@${address.domain}`,
      tag: "*",
      ...(reason ? { reason } : {}),
    }),
  });
  return {};
}

/** Add a sending domain. Returns a SendingDomain with the DNS records the
 *  customer should publish at their registrar. */
export async function mailgunAddDomain(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue> {
  const name = String(params.name ?? "");
  const auth = `Basic ${btoa(`api:${creds.MAILGUN_API_KEY}`)}`;
  const resp = await fetch(`${mailgunBaseUrl(creds)}/v4/domains`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ name }),
  });
  const json = await resp.json().catch(() => ({}));
  return mapMailgunDomain(json);
}

/** Trigger DNS verification for an existing domain. Mailgun re-checks the
 *  records and returns the updated state. */
export async function mailgunVerifyDomain(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue> {
  const name = String(params.name ?? "");
  const auth = `Basic ${btoa(`api:${creds.MAILGUN_API_KEY}`)}`;
  const resp = await fetch(
    `${mailgunBaseUrl(creds)}/v4/domains/${encodeURIComponent(name)}/verify`,
    { method: "PUT", headers: { Authorization: auth } },
  );
  const json = await resp.json().catch(() => ({}));
  return mapMailgunDomain(json);
}

/** List all sending domains owned by this Mailgun account. */
export async function mailgunListDomains(
  _params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue[]> {
  const auth = `Basic ${btoa(`api:${creds.MAILGUN_API_KEY}`)}`;
  const resp = await fetch(`${mailgunBaseUrl(creds)}/v4/domains?limit=1000`, {
    headers: { Authorization: auth },
  });
  if (!resp.ok) return [];
  const data = (await resp.json()) as { items?: unknown[] };
  return (data.items ?? []).map(mapMailgunDomain);
}
