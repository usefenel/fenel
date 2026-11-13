import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyResendSignatureWithBody,
  resendEventToEmailEvent,
  resendEventRecipient,
} from "./resend-webhook";

const SECRET_PLAIN = "test-secret-bytes-for-svix-hmac-verification";
const SECRET_PREFIXED = `whsec_${Buffer.from(SECRET_PLAIN).toString("base64")}`;

function sign(svixId: string, ts: string, body: string, secretBase64: string): string {
  const secretBytes = Buffer.from(secretBase64, "base64");
  return createHmac("sha256", secretBytes).update(`${svixId}.${ts}.${body}`).digest("base64");
}

describe("verifyResendSignatureWithBody", () => {
  const id = "msg_2";
  const ts = "1700000000";
  const body = '{"type":"email.delivered"}';

  it("accepts a correct v1 signature", () => {
    const secretBase64 = SECRET_PREFIXED.replace("whsec_", "");
    const sig = sign(id, ts, body, secretBase64);
    expect(verifyResendSignatureWithBody(id, ts, `v1,${sig}`, SECRET_PREFIXED, body)).toBe(true);
  });

  it("accepts when one of multiple v1 entries matches", () => {
    const secretBase64 = SECRET_PREFIXED.replace("whsec_", "");
    const goodSig = sign(id, ts, body, secretBase64);
    const headerValue = `v1,wrong-sig v1,${goodSig}`;
    expect(verifyResendSignatureWithBody(id, ts, headerValue, SECRET_PREFIXED, body)).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(verifyResendSignatureWithBody(id, ts, "v1,wrong", SECRET_PREFIXED, body)).toBe(false);
  });

  it("rejects when body has been tampered with", () => {
    const secretBase64 = SECRET_PREFIXED.replace("whsec_", "");
    const sig = sign(id, ts, body, secretBase64);
    expect(
      verifyResendSignatureWithBody(id, ts, `v1,${sig}`, SECRET_PREFIXED, body + "X"),
    ).toBe(false);
  });

  it("rejects empty inputs", () => {
    expect(verifyResendSignatureWithBody("", ts, "v1,x", SECRET_PREFIXED, body)).toBe(false);
    expect(verifyResendSignatureWithBody(id, "", "v1,x", SECRET_PREFIXED, body)).toBe(false);
    expect(verifyResendSignatureWithBody(id, ts, "", SECRET_PREFIXED, body)).toBe(false);
    expect(verifyResendSignatureWithBody(id, ts, "v1,x", "", body)).toBe(false);
  });

  it("rejects malformed signature header (no v1, prefix)", () => {
    expect(verifyResendSignatureWithBody(id, ts, "abcd", SECRET_PREFIXED, body)).toBe(false);
  });

  it("works without the whsec_ prefix on the secret", () => {
    const secretBase64 = SECRET_PREFIXED.replace("whsec_", "");
    const sig = sign(id, ts, body, secretBase64);
    expect(verifyResendSignatureWithBody(id, ts, `v1,${sig}`, secretBase64, body)).toBe(true);
  });
});

describe("resendEventToEmailEvent", () => {
  const baseTs = "2024-01-01T00:00:00Z";

  it("email.sent → Queued", () => {
    const ev = resendEventToEmailEvent({
      type: "email.sent",
      created_at: baseTs,
      data: { email_id: "id-1" },
    });
    expect(ev).toMatchObject({ $tag: "Queued", id: { _0: "id-1" } });
  });

  it("email.delivered → Delivered", () => {
    const ev = resendEventToEmailEvent({
      type: "email.delivered",
      created_at: baseTs,
      data: { email_id: "id-1" },
    });
    expect(ev).toMatchObject({ $tag: "Delivered" });
  });

  it("email.bounced hard → Bounced HardBounce with reason", () => {
    const ev = resendEventToEmailEvent({
      type: "email.bounced",
      created_at: baseTs,
      data: {
        email_id: "id-1",
        bounce: { type: "hard", subType: "general", message: "user not found" },
      },
    });
    expect(ev).toMatchObject({
      $tag: "Bounced",
      kind: { $tag: "HardBounce" },
      reason: "user not found",
    });
  });

  it("email.bounced soft → Bounced SoftBounce", () => {
    const ev = resendEventToEmailEvent({
      type: "email.bounced",
      created_at: baseTs,
      data: { email_id: "id-1", bounce: { type: "soft", message: "deferred" } },
    });
    expect(ev).toMatchObject({ $tag: "Bounced", kind: { $tag: "SoftBounce" } });
  });

  it("email.complained → Complained", () => {
    const ev = resendEventToEmailEvent({
      type: "email.complained",
      created_at: baseTs,
      data: { email_id: "id-1" },
    });
    expect(ev).toMatchObject({ $tag: "Complained" });
  });

  it("email.opened → Opened with userAgent", () => {
    const ev = resendEventToEmailEvent({
      type: "email.opened",
      created_at: baseTs,
      data: { email_id: "id-1", user_agent: "Gmail/iOS" },
    });
    expect(ev).toMatchObject({ $tag: "Opened", userAgent: "Gmail/iOS" });
  });

  it("email.clicked → Clicked with url", () => {
    const ev = resendEventToEmailEvent({
      type: "email.clicked",
      created_at: baseTs,
      data: { email_id: "id-1", link: "https://example.com" },
    });
    expect(ev).toMatchObject({ $tag: "Clicked", url: "https://example.com" });
  });

  it("email.failed → Failed with reason", () => {
    const ev = resendEventToEmailEvent({
      type: "email.failed",
      created_at: baseTs,
      data: { email_id: "id-1", message: "smtp error" },
    });
    expect(ev).toMatchObject({ $tag: "Failed", reason: "smtp error" });
  });

  it("unknown type → null", () => {
    expect(resendEventToEmailEvent({
      type: "email.weird", created_at: baseTs, data: {},
    })).toBeNull();
  });
});

describe("resendEventRecipient", () => {
  it("extracts first address from data.to array", () => {
    expect(resendEventRecipient({
      type: "email.bounced",
      data: { email_id: "x", to: ["alice@example.com", "bob@example.com"] },
    })).toEqual({
      local: "alice", domain: "example.com", displayName: null,
    });
  });

  it("handles single string in data.to", () => {
    expect(resendEventRecipient({
      type: "email.bounced",
      data: { email_id: "x", to: "alice@example.com" },
    })).toEqual({
      local: "alice", domain: "example.com", displayName: null,
    });
  });

  it("returns null when data.to is missing", () => {
    expect(resendEventRecipient({ type: "x", data: {} })).toBeNull();
  });
});
