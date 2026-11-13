// SNS's signed wire envelope and its HTTPS certificate/confirmation boundary.
// This extends the existing crypto/HTTP host leaves; event decisions remain
// Fenel-bodied. Canonical byte order, including the final newline:
// https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message-verify-message-signature.html
import { verify, X509Certificate } from "node:crypto";

const VERIFIED = Symbol("verified SNS envelope");
export type VerifiedSnsEnvelope = Readonly<{
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  Message: string;
  MessageId: string;
  Timestamp: string;
  TopicArn: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
  [VERIFIED]: true;
}>;

export class InvalidSnsMessageError extends Error {}
export class SnsCertificateUnavailableError extends Error {}
export type SnsFetch = (url: string, init: RequestInit) => Promise<Response>;

function snsHost(topicArn: string): string {
  const match = /^arn:(aws|aws-cn|aws-us-gov|aws-eusc):sns:([a-z0-9-]+):([0-9]{12}):([a-zA-Z0-9_-]+(?:\.fifo)?)$/.exec(topicArn);
  if (!match) throw new InvalidSnsMessageError("SNS topic ARN is not configured or is invalid");
  const [, partition, region] = match;
  if (!region || !/^(?:[a-z]{2}(?:-gov)?|eusc-de)-[a-z]+-[0-9]+$/.test(region) ||
    (partition === "aws-cn") !== region.startsWith("cn-") ||
    (partition === "aws-us-gov") !== region.startsWith("us-gov-") ||
    (partition === "aws-eusc") !== region.startsWith("eusc-de-")) {
    throw new InvalidSnsMessageError("SNS topic partition and region do not match");
  }
  return `sns.${region}.${partition === "aws-eusc" ? "amazonaws.eu" : `amazonaws.com${partition === "aws-cn" ? ".cn" : ""}`}`;
}

function snsHttpsUrl(value: string, topicArn: string): URL {
  const host = snsHost(topicArn);
  let url: URL;
  try { url = new URL(value); }
  catch { throw new InvalidSnsMessageError("Invalid SNS URL"); }
  if (value.length > 8192 || /[\\\u0000-\u0020]/.test(value) ||
    url.protocol !== "https:" || url.hostname !== host || url.username || url.password ||
    url.port || url.hash || !value.startsWith(`https://${host}/`)) {
    throw new InvalidSnsMessageError("SNS URL must use the topic's exact regional HTTPS endpoint");
  }
  return url;
}

function signingCertificateUrl(value: string, topicArn: string): string {
  const url = snsHttpsUrl(value, topicArn);
  if (url.search || !/^\/SimpleNotificationService-[a-fA-F0-9]{32}\.pem$/.test(url.pathname) ||
    value !== `${url.origin}${url.pathname}`) {
    throw new InvalidSnsMessageError("Invalid SNS signing certificate path");
  }
  return url.href;
}

/** Check the action AND its signed arguments, not merely an AWS hostname. */
export function snsSubscriptionUrl(env: VerifiedSnsEnvelope): string {
  if (env[VERIFIED] !== true || env.Type !== "SubscriptionConfirmation" || !env.SubscribeURL || !env.Token) {
    throw new InvalidSnsMessageError("No verified SNS subscription confirmation");
  }
  const url = snsHttpsUrl(env.SubscribeURL, env.TopicArn);
  const query = url.searchParams;
  if (url.pathname !== "/" || !env.SubscribeURL.startsWith(`${url.origin}/?`) ||
    query.getAll("Action").length !== 1 || query.get("Action") !== "ConfirmSubscription" ||
    query.getAll("TopicArn").length !== 1 || query.get("TopicArn") !== env.TopicArn ||
    query.getAll("Token").length !== 1 || query.get("Token") !== env.Token ||
    [...query.keys()].some((key) => !["Action", "TopicArn", "Token", "Version"].includes(key)) ||
    query.getAll("Version").length > 1 || (query.has("Version") && query.get("Version") !== "2010-03-31")) {
    throw new InvalidSnsMessageError("SNS subscription URL does not match the signed confirmation");
  }
  return env.SubscribeURL;
}

async function boundedCertificate(response: Response): Promise<string> {
  const limit = 16_384;
  if (!response.ok || response.redirected || Number(response.headers.get("content-length")) > limit || !response.body) {
    await response.body?.cancel();
    throw new SnsCertificateUnavailableError("SNS signing certificate is unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new SnsCertificateUnavailableError("SNS signing certificate exceeds the size limit");
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

export function createSnsVerifier(options: { fetch?: SnsFetch; now?: () => number } = {}) {
  const fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const certificates = new Map<string, { certificate: X509Certificate; expires: number }>();
  const pending = new Map<string, Promise<X509Certificate>>();

  async function certificateFor(url: string): Promise<X509Certificate> {
    const cached = certificates.get(url);
    if (cached && cached.expires > now()) return cached.certificate;
    certificates.delete(url);
    const existing = pending.get(url);
    if (existing) return existing;
    if (pending.size >= 8) throw new SnsCertificateUnavailableError("SNS certificate fetch capacity reached");
    const request = (async () => {
      try {
        const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
        // HTTPS with normal host trust validation plus the exact SNS-owned
        // certificate path authenticates the PEM's provenance. Never accept a
        // certificate embedded in the message or supplied by an arbitrary URL.
        const certificate = new X509Certificate(await boundedCertificate(response));
        if (certificate.publicKey.asymmetricKeyType !== "rsa") {
          throw new SnsCertificateUnavailableError("SNS signing certificate must contain an RSA key");
        }
        if (certificates.size >= 32) certificates.delete(certificates.keys().next().value!);
        certificates.set(url, { certificate, expires: now() + 60 * 60 * 1000 });
        return certificate;
      } catch (error) {
        if (error instanceof SnsCertificateUnavailableError) throw error;
        throw new SnsCertificateUnavailableError("Unable to retrieve SNS signing certificate");
      }
    })();
    pending.set(url, request);
    try { return await request; }
    finally { if (pending.get(url) === request) pending.delete(url); }
  }

  return async function verifySnsEnvelope(raw: unknown, expectedTopicArn: string): Promise<VerifiedSnsEnvelope> {
    snsHost(expectedTopicArn);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InvalidSnsMessageError("Invalid SNS envelope");
    const wire = raw as Record<string, unknown>;
    const type = wire.Type;
    if (!["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"].includes(String(type))) {
      throw new InvalidSnsMessageError("Unsupported SNS envelope type");
    }
    // Snapshot the signed fields before the asynchronous certificate lookup.
    const fields = type === "Notification"
      ? ["Message", "MessageId", ...(Object.hasOwn(wire, "Subject") ? ["Subject"] : []), "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
    const snapshot: Record<string, string> = {};
    for (const key of [...fields, "SignatureVersion", "Signature", "SigningCertURL"]) {
      const value = wire[key];
      if (typeof value !== "string" || (value.length === 0 && key !== "Subject")) {
        throw new InvalidSnsMessageError(`Invalid SNS ${key}`);
      }
      snapshot[key] = value;
    }
    if (snapshot.TopicArn !== expectedTopicArn || !["1", "2"].includes(snapshot.SignatureVersion!)) {
      throw new InvalidSnsMessageError("Unexpected SNS topic or signature version");
    }
    // AWS supplies a UUID here. Refuse embedded field separators so an
    // attacker cannot move a suffix of Message into a forged MessageId while
    // preserving the same newline-delimited signature bytes.
    if (!/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(snapshot.MessageId!)) {
      throw new InvalidSnsMessageError("Invalid SNS message ID");
    }
    const signature = snapshot.Signature!;
    if (signature.length > 8192 || signature.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) {
      throw new InvalidSnsMessageError("Invalid SNS signature encoding");
    }
    const timestamp = Date.parse(snapshot.Timestamp!);
    if (!Number.isFinite(timestamp)) throw new InvalidSnsMessageError("Invalid SNS timestamp");
    const url = signingCertificateUrl(snapshot.SigningCertURL!, expectedTopicArn);
    const certificate = await certificateFor(url);
    // Check the certificate at the signed timestamp, not an arbitrary delivery
    // freshness cutoff: SNS may retry or deliver a throttled backlog later.
    const validFrom = Date.parse(certificate.validFrom);
    const validTo = Date.parse(certificate.validTo);
    if (!Number.isFinite(validFrom) || !Number.isFinite(validTo)) {
      throw new SnsCertificateUnavailableError("SNS certificate validity dates cannot be read");
    }
    if (timestamp < validFrom || timestamp > validTo) {
      throw new InvalidSnsMessageError("SNS timestamp is outside the signing certificate's validity");
    }
    const canonical = fields.map((key) => `${key}\n${snapshot[key]}\n`).join("");
    if (!verify(snapshot.SignatureVersion === "1" ? "RSA-SHA1" : "RSA-SHA256", Buffer.from(canonical, "utf8"), certificate.publicKey, Buffer.from(signature, "base64"))) {
      throw new InvalidSnsMessageError("Invalid SNS signature");
    }
    const envelope = Object.freeze({ ...snapshot, [VERIFIED]: true }) as VerifiedSnsEnvelope;
    if (envelope.Type === "SubscriptionConfirmation") snsSubscriptionUrl(envelope);
    return envelope;
  };
}

export const verifySnsEnvelope = createSnsVerifier();

export async function confirmSnsSubscription(env: VerifiedSnsEnvelope, fetcher: SnsFetch = fetch): Promise<void> {
  const url = snsSubscriptionUrl(env);
  const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  await response.body?.cancel();
  if (!response.ok || response.redirected) throw new Error("SNS subscription confirmation failed");
}
