// ---------------------------------------------------------------------------
// Postmark provider — concrete implementation of the `email` capability.
//
// Postmark splits its API by token type:
//   - server token (POSTMARK_SERVER_TOKEN) for outbound + suppressions
//   - account token (POSTMARK_ACCOUNT_TOKEN) for domain management
//
// JSON in / JSON out — the cleanest of the three providers. Multi-recipient
// fields are comma-joined strings, not arrays. Attachments are base64-
// encoded inline in the request body.
//
// Postmark is opinionated about list quality — `MessageStream` defaults to
// `"outbound"` (transactional). For marketing volumes the stream must be
// configured to `"broadcast"`. We pass it through from a custom header
// or default to outbound; flows that send marketing should set it
// explicitly.
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

const POSTMARK_BASE = "https://api.postmarkapp.com";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function formatAddress(a: AddressValue | null | undefined): string {
  if (!a || !a.local || !a.domain) return "";
  const addr = `${a.local}@${a.domain}`;
  if (a.displayName) return `"${a.displayName.replace(/"/g, "")}" <${addr}>`;
  return addr;
}

function joinAddresses(list: AddressValue[]): string | undefined {
  if (list.length === 0) return undefined;
  return list.map(formatAddress).filter(Boolean).join(", ");
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

async function fetchAttachmentAsBase64(att: AttachmentValue): Promise<{
  Name: string;
  Content: string;
  ContentType: string;
  ContentID?: string;
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
    const Content = btoa(bin);
    const part: { Name: string; Content: string; ContentType: string; ContentID?: string } = {
      Name: att.asset.name,
      Content,
      ContentType: ct,
    };
    if (att.contentId) part.ContentID = `cid:${att.contentId}`;
    return part;
  } catch {
    return null;
  }
}

/** Build the JSON body for POST /email. Async because attachments must
 *  be downloaded and base64-encoded inline. */
export async function buildPostmarkBody(
  email: EmailValue,
  messageStream = "outbound",
): Promise<Record<string, unknown>> {
  const attachments = await Promise.all(
    email.attachments.map(fetchAttachmentAsBase64),
  );
  const Headers: Array<{ Name: string; Value: string }> = email.headers.map(
    (h: HeaderValue) => ({ Name: h.name, Value: h.value }),
  );
  if (email.inReplyTo) {
    Headers.push({ Name: "In-Reply-To", Value: `<${email.inReplyTo}>` });
  }
  if (email.references.length > 0) {
    Headers.push({
      Name: "References",
      Value: email.references.map((r) => `<${r}>`).join(" "),
    });
  }
  const body: Record<string, unknown> = {
    From: formatAddress(email.from),
    To: joinAddresses(email.to),
    Cc: joinAddresses(email.cc),
    Bcc: joinAddresses(email.bcc),
    ReplyTo: email.replyTo ? formatAddress(email.replyTo) : undefined,
    Subject: email.subject,
    TextBody: bodyText(email.body),
    HtmlBody: bodyHtml(email.body),
    Headers: Headers.length > 0 ? Headers : undefined,
    Attachments: attachments.filter(Boolean),
    MessageStream: messageStream,
    TrackOpens: true,
    TrackLinks: "HtmlAndText",
  };
  // Strip undefined keys — Postmark rejects unknown null fields in some cases.
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return body;
}

/** Map a Postmark error response into a typed SendError. Postmark uses
 *  ErrorCode (a numeric enum) plus a Message string. */
export async function mapPostmarkSendError(resp: Response): Promise<SendErrorValue> {
  const status = resp.status;
  let body: { ErrorCode?: number; Message?: string } = {};
  try {
    body = (await resp.json()) as typeof body;
  } catch {
    /* fall through */
  }
  const code = body.ErrorCode != null ? String(body.ErrorCode) : String(status);
  const message = body.Message ?? `HTTP ${status}`;
  if (status === 401 || status === 403) {
    return { $tag: "ProviderError", code, message };
  }
  if (status === 422 && body.ErrorCode === 406) {
    // 406 = "InactiveRecipientsError" — treat as suppression
    return { $tag: "Suppressed", _0: message };
  }
  if (status === 422 && body.ErrorCode === 300) {
    return { $tag: "InvalidAddress", _0: message };
  }
  if (status === 422 && body.ErrorCode === 412) {
    return { $tag: "DomainNotVerified", _0: message };
  }
  if (status === 429) {
    const retry = parseInt(resp.headers.get("retry-after") ?? "60", 10);
    return { $tag: "RateLimited", _0: Number.isFinite(retry) ? retry : 60 };
  }
  return { $tag: "ProviderError", code, message };
}

/** Convert a Postmark domain JSON into the typed SendingDomain ADT. */
export function mapPostmarkDomain(payload: unknown): SendingDomainValue {
  const obj = (payload as Record<string, unknown>) ?? {};
  const name = String(obj.Name ?? "");
  const dkimVerified = Boolean(obj.DKIMVerified);
  const returnPathVerified = Boolean(obj.ReturnPathDomainVerified);
  const status: DomainStatusValue =
    dkimVerified && returnPathVerified
      ? { $tag: "DomainVerified" }
      : { $tag: "DomainPending" };

  const dkimRecords: DnsRecordValue[] = [];
  if (obj.DKIMHost && obj.DKIMTextValue) {
    dkimRecords.push({
      kind: "TXT",
      host: String(obj.DKIMHost),
      value: String(obj.DKIMTextValue),
      verified: dkimVerified,
    });
  }
  const spfRecord: DnsRecordValue = {
    kind: "TXT",
    host: name,
    value: String(obj.SPFTextValue ?? "v=spf1 include:spf.mtasv.net ~all"),
    verified: false,
  };
  const returnPathRecord: DnsRecordValue = {
    kind: "CNAME",
    host: String(obj.ReturnPathDomain ?? `pm-bounces.${name}`),
    value: String(obj.ReturnPathDomainCNAMEValue ?? "pm.mtasv.net"),
    verified: returnPathVerified,
  };

  return {
    name,
    status,
    dkimRecords,
    spfRecord,
    returnPathRecord,
    inboundMxRecord: null,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function postmarkSend(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendResultValue> {
  const email = params.email as EmailValue;
  if (!email?.from?.domain) {
    return { $tag: "Rejected", reason: { $tag: "InvalidAddress", _0: "missing from.domain" } };
  }
  const body = await buildPostmarkBody(email);
  const resp = await fetch(`${POSTMARK_BASE}/email`, {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": creds.POSTMARK_SERVER_TOKEN!,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    return { $tag: "Rejected", reason: await mapPostmarkSendError(resp) };
  }
  const data = (await resp.json()) as { MessageID?: string };
  const id: MessageIdValue = { $tag: "MessageId", _0: String(data.MessageID ?? "") };
  return { $tag: "Sent", id };
}

export async function postmarkSendBatch(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendResultValue[]> {
  const emails = (params.emails as EmailValue[]) ?? [];
  if (emails.length === 0) return [];
  const bodies = await Promise.all(emails.map((e) => buildPostmarkBody(e)));
  const resp = await fetch(`${POSTMARK_BASE}/email/batch`, {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": creds.POSTMARK_SERVER_TOKEN!,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodies),
  });
  if (!resp.ok) {
    const err = await mapPostmarkSendError(resp);
    return emails.map(() => ({ $tag: "Rejected", reason: err }));
  }
  const arr = (await resp.json()) as Array<{ ErrorCode?: number; MessageID?: string; Message?: string }>;
  return arr.map((r) => {
    if (r.ErrorCode && r.ErrorCode !== 0) {
      return {
        $tag: "Rejected" as const,
        reason: { $tag: "ProviderError" as const, code: String(r.ErrorCode), message: r.Message ?? "" },
      };
    }
    return {
      $tag: "Sent" as const,
      id: { $tag: "MessageId" as const, _0: String(r.MessageID ?? "") },
    };
  });
}

export async function postmarkSuppress(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<Record<string, never>> {
  const address = params.address as AddressValue;
  const stream = "outbound";
  await fetch(`${POSTMARK_BASE}/message-streams/${stream}/suppressions`, {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": creds.POSTMARK_SERVER_TOKEN!,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Suppressions: [
        {
          EmailAddress: `${address.local}@${address.domain}`,
          Origin: "Customer",
        },
      ],
    }),
  });
  return {};
}

export async function postmarkAddDomain(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue> {
  const accountToken = creds.POSTMARK_ACCOUNT_TOKEN;
  if (!accountToken) {
    return mapPostmarkDomain({ Name: String(params.name ?? "") });
  }
  const resp = await fetch(`${POSTMARK_BASE}/domains`, {
    method: "POST",
    headers: {
      "X-Postmark-Account-Token": accountToken,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ Name: String(params.name ?? "") }),
  });
  const data = await resp.json().catch(() => ({}));
  return mapPostmarkDomain(data);
}

export async function postmarkVerifyDomain(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue> {
  const accountToken = creds.POSTMARK_ACCOUNT_TOKEN;
  const targetName = String(params.name ?? "");
  if (!accountToken) {
    return mapPostmarkDomain({ Name: targetName });
  }
  // Postmark needs a numeric domain ID for verifyDkim, not a name. Fetch
  // the list once (includes IDs), find the matching domain, then verify
  // — two API calls total, no redundant intermediate `mapPostmarkDomain`.
  const listResp = await fetch(`${POSTMARK_BASE}/domains?count=500&offset=0`, {
    headers: {
      "X-Postmark-Account-Token": accountToken,
      "Accept": "application/json",
    },
  });
  const listData = (await listResp.json().catch(() => ({}))) as {
    Domains?: Array<{ ID: number; Name: string }>;
  };
  const found = listData.Domains?.find((d) => d.Name === targetName);
  if (!found) return mapPostmarkDomain({ Name: targetName });
  const verifyResp = await fetch(`${POSTMARK_BASE}/domains/${found.ID}/verifyDkim`, {
    method: "PUT",
    headers: {
      "X-Postmark-Account-Token": accountToken,
      "Accept": "application/json",
    },
  });
  const data = await verifyResp.json().catch(() => ({}));
  return mapPostmarkDomain(data);
}

export async function postmarkListDomains(
  _params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue[]> {
  const accountToken = creds.POSTMARK_ACCOUNT_TOKEN;
  if (!accountToken) return [];
  const resp = await fetch(`${POSTMARK_BASE}/domains?count=500&offset=0`, {
    headers: {
      "X-Postmark-Account-Token": accountToken,
      "Accept": "application/json",
    },
  });
  if (!resp.ok) return [];
  const data = (await resp.json()) as { Domains?: unknown[] };
  return (data.Domains ?? []).map(mapPostmarkDomain);
}
