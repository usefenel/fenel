// ---------------------------------------------------------------------------
// Resend provider — concrete implementation of the `email` capability.
//
// Resend's API is similar to Postmark's: JSON in, JSON out, single-token
// auth (Bearer). The `from` field accepts both bare addresses and the
// RFC 5322 form. Tags + scheduled-at are supported but we don't expose
// them in the typed Email — flows can attach via custom Headers if
// needed (Resend forwards X-* headers).
//
// Domain management is supported via a separate API surface; we expose
// `domain.add`, `domain.verify`, and `domain.list`. Resend returns
// records to publish (DKIM, SPF, MX) with a `status` field that maps
// cleanly to our DomainStatus.
// ---------------------------------------------------------------------------

import type {
  AddressValue,
  AttachmentValue,
  BodyValue,
  EmailValue,
  HeaderValue,
  MessageIdValue,
  SendErrorValue,
  SendResultValue,
  SendingDomainValue,
  DomainStatusValue,
  DnsRecordValue,
} from "./mailgun";

type Credentials = Record<string, string>;

const RESEND_BASE = "https://api.resend.com";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAddress(a: AddressValue | null | undefined): string {
  if (!a || !a.local || !a.domain) return "";
  const addr = `${a.local}@${a.domain}`;
  if (a.displayName) return `"${a.displayName.replace(/"/g, "")}" <${addr}>`;
  return addr;
}

function bodyText(b: BodyValue): string | undefined {
  if (b.$tag === "Text") return b._0;
  if (b.$tag === "Multipart") return b.text;
  return undefined;
}

function bodyHtml(b: BodyValue): string | undefined {
  if (b.$tag === "Html") return b._0;
  if (b.$tag === "Multipart") return b.html;
  return undefined;
}

async function fetchAttachmentForResend(att: AttachmentValue): Promise<{
  filename: string;
  content: string;  // base64
  content_type?: string;
  content_id?: string;
} | null> {
  try {
    const resp = await fetch(att.asset.url);
    if (!resp.ok) return null;
    const ct = att.asset.mimeType
      || resp.headers.get("content-type")
      || "application/octet-stream";
    const buf = new Uint8Array(await resp.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
    const out: { filename: string; content: string; content_type?: string; content_id?: string } = {
      filename: att.asset.name,
      content: btoa(bin),
      content_type: ct,
    };
    if (att.contentId) out.content_id = att.contentId;
    return out;
  } catch {
    return null;
  }
}

export async function buildResendBody(email: EmailValue): Promise<Record<string, unknown>> {
  const attachments = (await Promise.all(email.attachments.map(fetchAttachmentForResend)))
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const headers: Record<string, string> = {};
  for (const h of email.headers as HeaderValue[]) headers[h.name] = h.value;
  if (email.inReplyTo) headers["In-Reply-To"] = `<${email.inReplyTo}>`;
  if (email.references.length > 0) {
    headers["References"] = email.references.map((r) => `<${r}>`).join(" ");
  }

  const body: Record<string, unknown> = {
    from: formatAddress(email.from),
    to: email.to.map(formatAddress).filter(Boolean),
    cc: email.cc.length > 0 ? email.cc.map(formatAddress).filter(Boolean) : undefined,
    bcc: email.bcc.length > 0 ? email.bcc.map(formatAddress).filter(Boolean) : undefined,
    reply_to: email.replyTo ? formatAddress(email.replyTo) : undefined,
    subject: email.subject,
    text: bodyText(email.body),
    html: bodyHtml(email.body),
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return body;
}

export async function mapResendSendError(resp: Response): Promise<SendErrorValue> {
  const status = resp.status;
  let parsed: { name?: string; message?: string } = {};
  try {
    parsed = (await resp.json()) as typeof parsed;
  } catch {
    /* ignore */
  }
  const name = parsed.name ?? "";
  const message = parsed.message ?? `HTTP ${status}`;
  if (status === 401 || status === 403) {
    return { $tag: "ProviderError", code: name || String(status), message };
  }
  if (status === 429) {
    const retry = parseInt(resp.headers.get("retry-after") ?? "60", 10);
    return { $tag: "RateLimited", _0: Number.isFinite(retry) ? retry : 60 };
  }
  if (status === 422 && /address|recipient/i.test(message)) {
    return { $tag: "InvalidAddress", _0: message };
  }
  if (status === 422 && /domain/i.test(message)) {
    return { $tag: "DomainNotVerified", _0: message };
  }
  return { $tag: "ProviderError", code: name || String(status), message };
}

export function mapResendDomain(payload: unknown): SendingDomainValue {
  const obj = (payload as Record<string, unknown>) ?? {};
  const name = String(obj.name ?? "");
  const state = String(obj.status ?? "pending").toLowerCase();
  const status: DomainStatusValue =
    state === "verified"
      ? { $tag: "DomainVerified" }
      : state === "failed"
        ? { $tag: "DomainFailed", reason: state }
        : { $tag: "DomainPending" };

  const records = (obj.records as Array<Record<string, unknown>>) ?? [];
  const dkimRecords: DnsRecordValue[] = [];
  let spfRecord: DnsRecordValue = { kind: "TXT", host: name, value: "", verified: false };

  for (const r of records) {
    const kind = String(r.type ?? "TXT");
    const host = String(r.name ?? r.record ?? "");
    const value = String(r.value ?? "");
    const verified = String(r.status ?? "pending") === "verified";
    if (host.includes("_domainkey")) {
      dkimRecords.push({ kind, host, value, verified });
    } else if (kind === "TXT" && /spf|v=spf1/i.test(value)) {
      spfRecord = { kind, host, value, verified };
    }
  }

  return {
    name,
    status,
    dkimRecords,
    spfRecord,
    returnPathRecord: { kind: "CNAME", host: "", value: "", verified: false },
    inboundMxRecord: null,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function resendSend(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendResultValue> {
  const email = params.email as EmailValue;
  if (!email?.from?.domain) {
    return { $tag: "Rejected", reason: { $tag: "InvalidAddress", _0: "missing from.domain" } };
  }
  const body = await buildResendBody(email);
  const resp = await fetch(`${RESEND_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    return { $tag: "Rejected", reason: await mapResendSendError(resp) };
  }
  const data = (await resp.json()) as { id?: string };
  const id: MessageIdValue = { $tag: "MessageId", _0: String(data.id ?? "") };
  return { $tag: "Sent", id };
}

export async function resendSendBatch(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendResultValue[]> {
  const emails = (params.emails as EmailValue[]) ?? [];
  if (emails.length === 0) return [];
  const bodies = await Promise.all(emails.map(buildResendBody));
  const resp = await fetch(`${RESEND_BASE}/emails/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodies),
  });
  if (!resp.ok) {
    const err = await mapResendSendError(resp);
    return emails.map(() => ({ $tag: "Rejected", reason: err }));
  }
  const data = (await resp.json()) as { data?: Array<{ id?: string }> };
  return (data.data ?? []).map((r) => ({
    $tag: "Sent" as const,
    id: { $tag: "MessageId" as const, _0: String(r.id ?? "") },
  }));
}

export async function resendSuppress(
  _params: Record<string, unknown>,
  _creds: Credentials,
): Promise<Record<string, never>> {
  // Resend manages suppressions internally based on bounce / complaint
  // events — there is no public API to add an address manually. We
  // accept the call and no-op so callers don't error.
  return {};
}

export async function resendAddDomain(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue> {
  const resp = await fetch(`${RESEND_BASE}/domains`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: String(params.name ?? "") }),
  });
  const data = await resp.json().catch(() => ({}));
  return mapResendDomain(data);
}

export async function resendVerifyDomain(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue> {
  // Resend's verify endpoint uses the domain id, not the name. Look up
  // the id by listing first. (Common pattern with their API; future
  // optimisation: cache name → id in the integration config.)
  const list = await fetch(`${RESEND_BASE}/domains`, {
    headers: { Authorization: `Bearer ${creds.RESEND_API_KEY}` },
  });
  const listData = (await list.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
  const found = listData.data?.find((d) => d.name === String(params.name ?? ""));
  if (!found) return mapResendDomain({ name: String(params.name ?? ""), status: "pending" });
  const verifyResp = await fetch(`${RESEND_BASE}/domains/${found.id}/verify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.RESEND_API_KEY}` },
  });
  const data = await verifyResp.json().catch(() => ({}));
  return mapResendDomain(data);
}

export async function resendListDomains(
  _params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue[]> {
  const resp = await fetch(`${RESEND_BASE}/domains`, {
    headers: { Authorization: `Bearer ${creds.RESEND_API_KEY}` },
  });
  if (!resp.ok) return [];
  const data = (await resp.json()) as { data?: unknown[] };
  return (data.data ?? []).map(mapResendDomain);
}
