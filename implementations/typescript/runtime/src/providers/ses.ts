// ---------------------------------------------------------------------------
// AWS SES provider — concrete implementation of the `email` capability.
//
// Uses SESv2 via @aws-sdk/client-sesv2. Each handler builds a fresh
// SESv2Client per call from the provided credentials (no module-level
// shared client because credentials are per-account).
//
// Domain identity is the SESv2 concept that maps to our `SendingDomain`
// ADT. Adding an identity returns DKIM tokens; the customer publishes
// three CNAME records of the form `<token>._domainkey.<domain>` →
// `<token>.dkim.amazonses.com`. SES then auto-verifies asynchronously.
//
// Attachments require Raw content (MIME-encoded body). For the v1
// implementation we only support Simple content (no attachments). Emails
// arriving with attachments are rejected with InvalidAddress until the
// MIME builder lands. Customers needing attachments through the typed
// engine should select Mailgun or Postmark instead.
// ---------------------------------------------------------------------------

import {
  SESv2Client,
  SendEmailCommand,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  ListEmailIdentitiesCommand,
  PutSuppressedDestinationCommand,
  type CreateEmailIdentityCommandOutput,
  type GetEmailIdentityCommandOutput,
} from "@aws-sdk/client-sesv2";
import type {
  AddressValue,
  EmailValue,
  MessageIdValue,
  SendErrorValue,
  SendResultValue,
  SendingDomainValue,
  DomainStatusValue,
  DnsRecordValue,
} from "./mailgun";
import { buildMime, fetchAttachments } from "./mime";

type Credentials = Record<string, string>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(creds: Credentials): SESv2Client {
  return new SESv2Client({
    region: creds.AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: creds.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: creds.AWS_SECRET_ACCESS_KEY ?? "",
    },
  });
}

function formatAddress(a: AddressValue | null | undefined): string {
  if (!a || !a.local || !a.domain) return "";
  const addr = `${a.local}@${a.domain}`;
  if (a.displayName) return `"${a.displayName.replace(/"/g, "")}" <${addr}>`;
  return addr;
}

function classifySesError(err: unknown): SendErrorValue {
  const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const status = e.$metadata?.httpStatusCode;
  const name = e.name ?? "";
  const message = e.message ?? String(err);
  if (name === "MessageRejected" || name === "MailFromDomainNotVerifiedException") {
    return { $tag: "DomainNotVerified", _0: message };
  }
  if (name === "AccountSendingPausedException" || name === "ConfigurationSetSendingPausedException") {
    return { $tag: "ProviderError", code: name, message };
  }
  if (name === "TooManyRequestsException" || status === 429) {
    return { $tag: "RateLimited", _0: 60 };
  }
  if (name === "InvalidEmailAddressException" || name === "InvalidParameterValue") {
    return { $tag: "InvalidAddress", _0: message };
  }
  return { $tag: "ProviderError", code: name || String(status ?? "unknown"), message };
}

function dkimTokensToRecords(domain: string, tokens: string[] | undefined, verified: boolean): DnsRecordValue[] {
  return (tokens ?? []).map((token) => ({
    kind: "CNAME",
    host: `${token}._domainkey.${domain}`,
    value: `${token}.dkim.amazonses.com`,
    verified,
  }));
}

function mapSesIdentityToDomain(
  name: string,
  result: GetEmailIdentityCommandOutput | CreateEmailIdentityCommandOutput,
  region: string,
): SendingDomainValue {
  const dkim = result.DkimAttributes;
  const verifiedForSending = (result as GetEmailIdentityCommandOutput).VerifiedForSendingStatus === true;
  const dkimVerified = dkim?.Status === "SUCCESS";
  const status: DomainStatusValue =
    verifiedForSending && dkimVerified
      ? { $tag: "DomainVerified" }
      : dkim?.Status === "FAILED"
        ? { $tag: "DomainFailed", reason: "DKIM verification failed" }
        : { $tag: "DomainPending" };

  const dkimRecords = dkimTokensToRecords(name, dkim?.Tokens, dkimVerified);
  return {
    name,
    status,
    dkimRecords,
    spfRecord: {
      kind: "TXT",
      host: name,
      value: "v=spf1 include:amazonses.com ~all",
      verified: false,
    },
    returnPathRecord: {
      kind: "CNAME",
      host: `feedback-smtp.${region}.amazonses.com`,
      value: "",
      verified: false,
    },
    inboundMxRecord: null,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function sesSend(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendResultValue> {
  const email = params.email as EmailValue;
  if (!email?.from?.domain) {
    return { $tag: "Rejected", reason: { $tag: "InvalidAddress", _0: "missing from.domain" } };
  }

  const client = makeClient(creds);

  try {
    // Attachments → Raw content with multipart MIME body. Without
    // attachments we use Simple content (smaller, simpler, slightly
    // cheaper) and let SES synthesise the MIME envelope.
    if (email.attachments.length > 0) {
      const fetched = await fetchAttachments(email.attachments);
      const raw = buildMime(email, fetched);
      const result = await client.send(new SendEmailCommand({
        FromEmailAddress: formatAddress(email.from),
        Destination: {
          ToAddresses: email.to.map(formatAddress).filter(Boolean),
          CcAddresses: email.cc.length > 0 ? email.cc.map(formatAddress).filter(Boolean) : undefined,
          BccAddresses: email.bcc.length > 0 ? email.bcc.map(formatAddress).filter(Boolean) : undefined,
        },
        Content: { Raw: { Data: raw } },
      }));
      const id: MessageIdValue = { $tag: "MessageId", _0: String(result.MessageId ?? "") };
      return { $tag: "Sent", id };
    }

    const text = email.body.$tag === "Text" ? email.body._0
      : email.body.$tag === "Multipart" ? email.body.text
      : undefined;
    const html = email.body.$tag === "Html" ? email.body._0
      : email.body.$tag === "Multipart" ? email.body.html
      : undefined;

    const result = await client.send(new SendEmailCommand({
      FromEmailAddress: formatAddress(email.from),
      Destination: {
        ToAddresses: email.to.map(formatAddress).filter(Boolean),
        CcAddresses: email.cc.length > 0 ? email.cc.map(formatAddress).filter(Boolean) : undefined,
        BccAddresses: email.bcc.length > 0 ? email.bcc.map(formatAddress).filter(Boolean) : undefined,
      },
      ReplyToAddresses: email.replyTo ? [formatAddress(email.replyTo)] : undefined,
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: "UTF-8" },
          Body: {
            Text: text != null ? { Data: text, Charset: "UTF-8" } : undefined,
            Html: html != null ? { Data: html, Charset: "UTF-8" } : undefined,
          },
          Headers: email.headers.length > 0
            ? email.headers.map((h) => ({ Name: h.name, Value: h.value }))
            : undefined,
        },
      },
    }));
    const id: MessageIdValue = { $tag: "MessageId", _0: String(result.MessageId ?? "") };
    return { $tag: "Sent", id };
  } catch (err) {
    return { $tag: "Rejected", reason: classifySesError(err) };
  }
}

export async function sesSendBatch(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendResultValue[]> {
  // SES has no native batch endpoint that maps cleanly to per-recipient
  // results; we iterate one-by-one. (Bulk templated email is a separate
  // SDK call with a different shape — out of scope for v1.)
  const emails = (params.emails as EmailValue[]) ?? [];
  const results: SendResultValue[] = [];
  for (const email of emails) {
    results.push(await sesSend({ email }, creds));
  }
  return results;
}

export async function sesSuppress(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<Record<string, never>> {
  const address = params.address as AddressValue;
  const reason = String(params.reason ?? "BOUNCE").toUpperCase();
  const sesReason = (reason === "COMPLAINT" || reason === "BOUNCE") ? reason : "BOUNCE";
  const client = makeClient(creds);
  try {
    await client.send(new PutSuppressedDestinationCommand({
      EmailAddress: `${address.local}@${address.domain}`,
      Reason: sesReason,
    }));
  } catch {
    // Idempotent — best-effort, ignore failures.
  }
  return {};
}

export async function sesAddDomain(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue> {
  const name = String(params.name ?? "");
  const client = makeClient(creds);
  try {
    const result = await client.send(new CreateEmailIdentityCommand({
      EmailIdentity: name,
    }));
    return mapSesIdentityToDomain(name, result, creds.AWS_REGION ?? "us-east-1");
  } catch (err) {
    // If the identity already exists, try to GET it instead so we can
    // return its current verification state. AlreadyExistsException is
    // the documented error for re-creating an existing identity.
    const e = err as { name?: string };
    if (e.name === "AlreadyExistsException") {
      return sesVerifyDomain({ name }, creds);
    }
    return {
      name,
      status: { $tag: "DomainFailed", reason: String((err as Error).message ?? "create failed") },
      dkimRecords: [],
      spfRecord: { kind: "TXT", host: name, value: "", verified: false },
      returnPathRecord: { kind: "CNAME", host: "", value: "", verified: false },
      inboundMxRecord: null,
    };
  }
}

export async function sesVerifyDomain(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue> {
  const name = String(params.name ?? "");
  const client = makeClient(creds);
  try {
    const result = await client.send(new GetEmailIdentityCommand({
      EmailIdentity: name,
    }));
    return mapSesIdentityToDomain(name, result, creds.AWS_REGION ?? "us-east-1");
  } catch {
    return {
      name,
      status: { $tag: "DomainFailed", reason: "Identity not found" },
      dkimRecords: [],
      spfRecord: { kind: "TXT", host: name, value: "", verified: false },
      returnPathRecord: { kind: "CNAME", host: "", value: "", verified: false },
      inboundMxRecord: null,
    };
  }
}

export async function sesListDomains(
  _params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue[]> {
  const client = makeClient(creds);
  try {
    const result = await client.send(new ListEmailIdentitiesCommand({
      PageSize: 100,
    }));
    const identities = (result.EmailIdentities ?? []).filter(
      (i) => i.IdentityType === "DOMAIN" && typeof i.IdentityName === "string",
    );
    // For each domain we'd need a separate Get call to populate DKIM
    // tokens, which is N+1 — only do it if the list is short. Otherwise
    // return name + status only and let a follow-up domain.verify call
    // hydrate the DNS records.
    const out: SendingDomainValue[] = [];
    for (const i of identities) {
      const name = i.IdentityName!;
      out.push({
        name,
        status: i.SendingEnabled ? { $tag: "DomainVerified" } : { $tag: "DomainPending" },
        dkimRecords: [],
        spfRecord: { kind: "TXT", host: name, value: "v=spf1 include:amazonses.com ~all", verified: false },
        returnPathRecord: { kind: "CNAME", host: `feedback-smtp.${creds.AWS_REGION ?? "us-east-1"}.amazonses.com`, value: "", verified: false },
        inboundMxRecord: null,
      });
    }
    return out;
  } catch {
    return [];
  }
}
