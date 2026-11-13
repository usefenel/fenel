import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "./crypto";

function signStripe(rawBody: string, timestamp: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

describe("verifyStripeSignature", () => {
  const SECRET = "whsec_test_secret";
  const PAYLOAD = JSON.stringify({
    id: "evt_test_123",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_abc" } },
  });

  it("accepts a known-good signed payload and returns the parsed event", () => {
    const ts = 1_700_000_000;
    const sig = signStripe(PAYLOAD, ts, SECRET);
    const header = `t=${ts},v1=${sig}`;
    const event = verifyStripeSignature(PAYLOAD, header, SECRET, 300, ts);
    expect(event).not.toBeNull();
    expect(event?.["id"]).toBe("evt_test_123");
    expect(event?.["type"]).toBe("checkout.session.completed");
  });

  it("rejects a tampered payload (one byte changed)", () => {
    const ts = 1_700_000_000;
    const sig = signStripe(PAYLOAD, ts, SECRET);
    const header = `t=${ts},v1=${sig}`;
    const tampered = PAYLOAD.replace("evt_test_123", "evt_test_124");
    expect(verifyStripeSignature(tampered, header, SECRET, 300, ts)).toBeNull();
  });

  it("rejects a tampered signature (one byte changed)", () => {
    const ts = 1_700_000_000;
    const sig = signStripe(PAYLOAD, ts, SECRET);
    const lastChar = sig[sig.length - 1];
    const flipped = lastChar === "0" ? "1" : "0";
    const bad = sig.slice(0, -1) + flipped;
    const header = `t=${ts},v1=${bad}`;
    expect(verifyStripeSignature(PAYLOAD, header, SECRET, 300, ts)).toBeNull();
  });

  it("rejects a stale timestamp (outside tolerance)", () => {
    const ts = 1_700_000_000;
    const sig = signStripe(PAYLOAD, ts, SECRET);
    const header = `t=${ts},v1=${sig}`;
    const now = ts + 301;
    expect(verifyStripeSignature(PAYLOAD, header, SECRET, 300, now)).toBeNull();
  });

  it("accepts multi-v1 when the SECOND v1 matches (key rotation)", () => {
    const ts = 1_700_000_000;
    const sig = signStripe(PAYLOAD, ts, SECRET);
    const wrongSig = signStripe(PAYLOAD, ts, "wrong-secret");
    const header = `t=${ts},v1=${wrongSig},v1=${sig}`;
    const event = verifyStripeSignature(PAYLOAD, header, SECRET, 300, ts);
    expect(event).not.toBeNull();
    expect(event?.["id"]).toBe("evt_test_123");
  });

  it("rejects when no v1 entries match", () => {
    const ts = 1_700_000_000;
    const wrongSig = signStripe(PAYLOAD, ts, "wrong-secret");
    const header = `t=${ts},v1=${wrongSig}`;
    expect(verifyStripeSignature(PAYLOAD, header, SECRET, 300, ts)).toBeNull();
  });

  it("rejects malformed header (no t=)", () => {
    const ts = 1_700_000_000;
    const sig = signStripe(PAYLOAD, ts, SECRET);
    const header = `v1=${sig}`;
    expect(verifyStripeSignature(PAYLOAD, header, SECRET, 300, ts)).toBeNull();
  });

  it("rejects malformed header (no v1=)", () => {
    const ts = 1_700_000_000;
    const header = `t=${ts}`;
    expect(verifyStripeSignature(PAYLOAD, header, SECRET, 300, ts)).toBeNull();
  });

  it("rejects empty inputs", () => {
    expect(verifyStripeSignature(undefined, "t=1,v1=abc", SECRET)).toBeNull();
    expect(verifyStripeSignature(PAYLOAD, undefined, SECRET)).toBeNull();
    expect(verifyStripeSignature(PAYLOAD, "t=1,v1=abc", undefined)).toBeNull();
    expect(verifyStripeSignature(PAYLOAD, "", SECRET)).toBeNull();
    expect(verifyStripeSignature(PAYLOAD, "t=1,v1=abc", "")).toBeNull();
  });

  it("rejects a valid signature with invalid JSON payload", () => {
    const garbage = "not-json{";
    const ts = 1_700_000_000;
    const sig = signStripe(garbage, ts, SECRET);
    const header = `t=${ts},v1=${sig}`;
    expect(verifyStripeSignature(garbage, header, SECRET, 300, ts)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stripe form-encoding (PHP-style bracket nesting) — R1 mitigation
// ---------------------------------------------------------------------------

import { stripeFormEncode } from "./payments";

describe("stripeFormEncode", () => {
  it("encodes a flat object", () => {
    const params = stripeFormEncode({ mode: "payment", currency: "usd" });
    expect(params.get("mode")).toBe("payment");
    expect(params.get("currency")).toBe("usd");
  });

  it("encodes a nested array of nested objects (Stripe line_items shape)", () => {
    const params = stripeFormEncode({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: 1000,
            product_data: { name: "Payment" },
          },
          quantity: 1,
        },
      ],
      success_url: "https://example.com/ok",
      cancel_url: "https://example.com/cancel",
      metadata: { purchaseId: "p_123" },
    });
    expect(params.get("mode")).toBe("payment");
    expect(params.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("1000");
    expect(params.get("line_items[0][price_data][product_data][name]")).toBe(
      "Payment",
    );
    expect(params.get("line_items[0][quantity]")).toBe("1");
    expect(params.get("success_url")).toBe("https://example.com/ok");
    expect(params.get("cancel_url")).toBe("https://example.com/cancel");
    expect(params.get("metadata[purchaseId]")).toBe("p_123");
  });

  it("skips undefined and null values", () => {
    const params = stripeFormEncode({
      mode: "payment",
      customer_email: undefined,
      description: null,
    });
    expect(params.get("mode")).toBe("payment");
    expect(params.has("customer_email")).toBe(false);
    expect(params.has("description")).toBe(false);
  });

  it("URL-encodes special characters in values", () => {
    const params = stripeFormEncode({ name: "Hello World & Friends" });
    expect(params.toString()).toContain(
      "name=Hello+World+%26+Friends",
    );
  });
});

