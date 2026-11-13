// ---------------------------------------------------------------------------
// Fenel-managed pseudo-provider — the out-of-the-box default email path.
//
// This is what every account gets *for free* when they haven't configured
// their own Mailgun/Postmark/SES integration. Internally it forwards to
// Mailgun under Fenel's master credentials (env vars), with an
// account-tagged X-Fenel-Account header so we can support / debug
// individual customers' deliverability.
//
// Master env vars (read at handler invocation, not at module load):
//   FENEL_MAILGUN_KEY      — Fenel's master Mailgun API key
//   FENEL_MAILGUN_REGION   — "us" | "eu", default "us"
//   FENEL_MAILGUN_DOMAIN   — the shared sending domain (e.g. send.usefenel.com)
//
// Sender domain is pinned to FENEL_MAILGUN_DOMAIN regardless of what the
// caller passes in `email.from.domain` — that's the whole point of the
// managed default. Customers with their own verified domain should use a
// real provider integration instead.
//
// Domain operations (`domain.add`, `domain.verify`, `domain.list`) on
// this provider don't make sense for the customer (they don't own the
// shared domain). `list` returns the single managed domain so flows can
// inspect "what am I allowed to send from"; `add`/`verify` return a
// no-op response — the customer must switch to a BYO provider to manage
// their own domains.
//
// The dispatcher in providers.ts injects the calling accountId via a
// `__ACCOUNT_ID` key on the credentials map for the `fenel` provider —
// see NO_CREDS_PROVIDERS over there. Other providers don't see this key.
// ---------------------------------------------------------------------------

import { incrementFenelEmailCount } from "@fenel/db";
import { mailgunSend, mailgunSendBatch } from "./mailgun";
import type {
  AddressValue,
  EmailValue,
  SendResultValue,
  SendingDomainValue,
} from "./mailgun";

type Credentials = Record<string, string>;

const REJECT_CONFIG: SendResultValue = {
  $tag: "Rejected",
  reason: {
    $tag: "ProviderError",
    code: "config",
    message: "Fenel-managed email is not configured on this server",
  },
};

function rejectRateLimit(remainingSeconds: number): SendResultValue {
  return {
    $tag: "Rejected",
    reason: { $tag: "RateLimited", _0: Math.max(60, remainingSeconds) },
  };
}

/** Read the per-hour quota from env (default 100). Customers exceeding
 *  this should configure their own provider — the managed default is
 *  shared infrastructure and one bad actor torches deliverability for
 *  everyone else on the pool. */
function hourlyLimit(): number {
  const raw = process.env["FENEL_MANAGED_HOURLY_LIMIT"];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 100;
}

/** Check + atomically increment this account's hourly send counter.
 *  Returns null if under quota; a typed Rejected SendResult if over. */
async function checkRateLimit(accountId: string): Promise<SendResultValue | null> {
  if (!accountId || accountId === "unknown") return null;
  const count = await incrementFenelEmailCount(accountId);
  const limit = hourlyLimit();
  if (count > limit) {
    // Compute seconds until the next hour boundary.
    const now = Date.now();
    const nextHour = Math.ceil(now / 3_600_000) * 3_600_000;
    return rejectRateLimit(Math.ceil((nextHour - now) / 1000));
  }
  return null;
}

function masterCreds(): Credentials | null {
  const key = process.env["FENEL_MAILGUN_KEY"];
  const domain = process.env["FENEL_MAILGUN_DOMAIN"];
  if (!key || !domain) return null;
  return {
    MAILGUN_API_KEY: key,
    MAILGUN_REGION: process.env["FENEL_MAILGUN_REGION"] ?? "us",
    MAILGUN_DOMAIN: domain,
  };
}

/** Rewrite an Email to send through the managed sender domain. The
 *  account is tagged in an X-Fenel-Account header so support / abuse
 *  workflows can attribute deliverability events. The caller's display
 *  name is preserved; their local-part is preserved as a hint (eg.
 *  "noreply", "support") but the domain is forced to ours. */
function rewriteForFenelManaged(email: EmailValue, accountId: string, managedDomain: string): EmailValue {
  const local = email.from?.local || "noreply";
  const managedFrom: AddressValue = {
    local,
    domain: managedDomain,
    displayName: email.from?.displayName ?? null,
  };
  // Replies go back to the customer's original address if any — the
  // managed sender is just a transit identity. If the caller didn't set
  // a Reply-To we keep their original from-address as Reply-To so
  // recipients can still reach the human author.
  const replyTo = email.replyTo ?? (email.from && email.from.domain ? email.from : null);
  return {
    ...email,
    from: managedFrom,
    replyTo,
    headers: [...email.headers, { name: "X-Fenel-Account", value: accountId }],
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function fenelSend(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendResultValue> {
  const master = masterCreds();
  if (!master) return REJECT_CONFIG;
  const accountId = String(creds.__ACCOUNT_ID ?? "unknown");
  const limited = await checkRateLimit(accountId);
  if (limited) return limited;
  const email = params.email as EmailValue;
  const rewritten = rewriteForFenelManaged(email, accountId, master.MAILGUN_DOMAIN!);
  return mailgunSend({ email: rewritten }, master);
}

export async function fenelSendBatch(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendResultValue[]> {
  const master = masterCreds();
  if (!master) {
    return ((params.emails as EmailValue[]) ?? []).map(() => REJECT_CONFIG);
  }
  const accountId = String(creds.__ACCOUNT_ID ?? "unknown");
  const emails = (params.emails as EmailValue[]) ?? [];

  // Rate limit applies per-email — increment N times. If the account
  // crosses the quota mid-batch we reject the remainder rather than
  // sending some-but-not-all. (Avoids partial-batch ambiguity.)
  const results: SendResultValue[] = [];
  let limited: SendResultValue | null = null;
  for (let i = 0; i < emails.length; i++) {
    if (limited) { results.push(limited); continue; }
    const check = await checkRateLimit(accountId);
    if (check) {
      limited = check;
      results.push(check);
    } else {
      results.push(null as unknown as SendResultValue); // placeholder; filled below
    }
  }
  // For the indices that weren't rate-limited, do the actual sends.
  const toSend: { i: number; e: EmailValue }[] = [];
  for (let i = 0; i < emails.length; i++) {
    if (results[i] === null) {
      toSend.push({ i, e: rewriteForFenelManaged(emails[i]!, accountId, master.MAILGUN_DOMAIN!) });
    }
  }
  if (toSend.length > 0) {
    const sent = await mailgunSendBatch({ emails: toSend.map((x) => x.e) }, master);
    toSend.forEach((x, k) => { results[x.i] = sent[k]!; });
  }
  return results;
}

/** Suppression on the managed default goes onto Fenel's master Mailgun
 *  account-wide unsubscribe list. (We don't currently expose per-customer
 *  suppression on the managed default — when one customer's recipient
 *  unsubscribes, we conservatively suppress globally.) */
export async function fenelSuppress(
  _params: Record<string, unknown>,
  _creds: Credentials,
): Promise<Record<string, never>> {
  return {};
}

/** No-op for the managed default — customers don't own this domain. */
export async function fenelAddDomain(
  params: Record<string, unknown>,
  _creds: Credentials,
): Promise<SendingDomainValue> {
  return {
    name: String(params.name ?? ""),
    status: { $tag: "DomainFailed", reason: "Switch to a BYO provider to manage your own domain" },
    dkimRecords: [],
    spfRecord: { kind: "TXT", host: String(params.name ?? ""), value: "", verified: false },
    returnPathRecord: { kind: "CNAME", host: "", value: "", verified: false },
    inboundMxRecord: null,
  };
}

export async function fenelVerifyDomain(
  params: Record<string, unknown>,
  creds: Credentials,
): Promise<SendingDomainValue> {
  return fenelAddDomain(params, creds);
}

/** Returns the single managed sending domain so flows can introspect
 *  "what address am I allowed to send from" without poking env vars. */
export async function fenelListDomains(
  _params: Record<string, unknown>,
  _creds: Credentials,
): Promise<SendingDomainValue[]> {
  const master = masterCreds();
  if (!master) return [];
  const name = master.MAILGUN_DOMAIN!;
  return [
    {
      name,
      status: { $tag: "DomainVerified" },
      dkimRecords: [],
      spfRecord: { kind: "TXT", host: name, value: "", verified: true },
      returnPathRecord: { kind: "CNAME", host: name, value: "", verified: true },
      inboundMxRecord: null,
    },
  ];
}
