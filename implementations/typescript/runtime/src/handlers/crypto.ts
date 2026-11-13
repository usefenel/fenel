// ---------------------------------------------------------------------------
// Crypto IO handlers — irreducible-IO leaves used by the mixed-ingress
// substrate (Phase 12c-routes sub-step 2).
//
//   crypto.sha256_hex(input)
//       -> hex sha256 digest of the input string. Used by the redirect
//          route for visitor-IP hashing.
//
//   crypto.verify_calendly_signature(signature, rawBody, secret)
//       -> Boolean. Parses calendly's t=...,v1=... envelope, HMAC-SHA256
//          over rawBody with secret, constant-time compares the v1 part.
//
//   crypto.verify_telegram_secret(sentToken, expectedToken)
//       -> Boolean. Constant-time string compare. Telegram's contract
//          is that the bot stores a `secret_token` and Telegram echoes
//          it verbatim in the X-Telegram-Bot-Api-Secret-Token header.
//          NOT an HMAC (Risk 6 — common mis-implementation).
//
// All three are 3-15-line wrappers around node:crypto. Their Fenel
// specs live in implementations/typescript/engine/src/modules/state.ts
// alongside the other state primitives (the brief proposes a separate
// crypto module; this sub-step inlines them as state-adjacent IO leaves
// to keep the substrate touch concentrated — a future sub-step can
// promote the crypto:* prefix to its own module if a third use-case
// surfaces).
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ModuleRegistry } from "@fenel/engine/registry";

export function registerCryptoHandlers(reg: ModuleRegistry): void {
  reg.registerIOHandler("crypto.sha256_hex", async (params) => {
    const input = params["input"] as string | undefined;
    if (input == null) return { action: "continue", value: "" };
    const { createHash } = await import("crypto");
    const digest = createHash("sha256").update(input).digest("hex");
    return { action: "continue", value: digest };
  });

  reg.registerIOHandler("crypto.verify_calendly_signature", async (params) => {
    const signature = params["signature"] as string | undefined;
    const rawBody = params["rawBody"] as string | undefined;
    const secret = params["secret"] as string | undefined;
    if (!signature || rawBody == null || !secret) {
      return { action: "continue", value: false };
    }
    const { createHmac, timingSafeEqual } = await import("crypto");
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const parts = signature.split(",");
    const v1Part = parts.find((p) => p.startsWith("v1="));
    const received = v1Part?.slice(3) ?? "";
    if (received.length !== expected.length) {
      return { action: "continue", value: false };
    }
    try {
      const ok = timingSafeEqual(Buffer.from(received), Buffer.from(expected));
      return { action: "continue", value: ok };
    } catch {
      return { action: "continue", value: false };
    }
  });

  reg.registerIOHandler("crypto.verify_telegram_secret", async (params) => {
    const sentToken = params["sentToken"] as string | undefined;
    const expectedToken = params["expectedToken"] as string | undefined;
    if (!sentToken || !expectedToken) {
      return { action: "continue", value: false };
    }
    if (sentToken.length !== expectedToken.length) {
      return { action: "continue", value: false };
    }
    const { timingSafeEqual } = await import("crypto");
    try {
      const ok = timingSafeEqual(
        Buffer.from(sentToken),
        Buffer.from(expectedToken),
      );
      return { action: "continue", value: ok };
    } catch {
      return { action: "continue", value: false };
    }
  });

  reg.registerIOHandler("crypto.verify_stripe_signature", async (params) => {
    const rawBody = params["rawBody"] as string | undefined;
    const signature = params["signature"] as string | undefined;
    const secret = params["secret"] as string | undefined;
    const event = verifyStripeSignature(rawBody, signature, secret);
    if (event === null) {
      return { action: "continue", value: { $tag: "Nothing" } };
    }
    return {
      action: "continue",
      value: { $tag: "Just", _0: event },
    };
  });
}

// Stripe webhook signature verification — native HMAC-SHA256 over
// `<timestamp>.<payload>` (per https://docs.stripe.com/webhooks/signature).
// Header `Stripe-Signature` shape: `t=<ts>,v1=<sig1>,v1=<sig2>,...`.
// Multi-v1 supported (key rotation); any matching v1 accepts. Returns
// the parsed JSON event on success, null on any failure (bad signature,
// stale timestamp, malformed header, bad JSON). Default tolerance 300s.
export function verifyStripeSignature(
  rawBody: string | undefined,
  signature: string | undefined,
  secret: string | undefined,
  toleranceSeconds: number = 300,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Record<string, unknown> | null {
  if (rawBody == null || !signature || !secret) return null;

  const parts = signature.split(",");
  let timestamp: string | null = null;
  const v1Signatures: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (k === "t") timestamp = v;
    else if (k === "v1") v1Signatures.push(v);
  }
  if (!timestamp || v1Signatures.length === 0) return null;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return null;
  if (Math.abs(nowSeconds - ts) > toleranceSeconds) return null;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");

  let matched = false;
  for (const sig of v1Signatures) {
    let sigBuf: Buffer;
    try {
      sigBuf = Buffer.from(sig, "hex");
    } catch {
      continue;
    }
    if (sigBuf.length !== expectedBuf.length || sigBuf.length === 0) continue;
    try {
      if (timingSafeEqual(sigBuf, expectedBuf)) {
        matched = true;
        break;
      }
    } catch {
      continue;
    }
  }
  if (!matched) return null;

  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
}
