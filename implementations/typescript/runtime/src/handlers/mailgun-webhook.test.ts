import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyMailgunSignature,
  mailgunEventToEmailEvent,
  mailgunInboundToEmail,
} from "./mailgun-webhook";

function sign(timestamp: string, token: string, key: string): string {
  return createHmac("sha256", key).update(timestamp + token).digest("hex");
}

describe("verifyMailgunSignature", () => {
  const KEY = "test-signing-key";

  it("accepts a correct signature", () => {
    const ts = "1700000000";
    const token = "abc";
    const sig = sign(ts, token, KEY);
    expect(verifyMailgunSignature(ts, token, sig, KEY)).toBe(true);
  });

  it("rejects a wrong signature", () => {
    const sig = sign("1700000000", "abc", KEY);
    expect(verifyMailgunSignature("1700000001", "abc", sig, KEY)).toBe(false);
  });

  it("rejects empty inputs", () => {
    expect(verifyMailgunSignature("", "x", "x", KEY)).toBe(false);
    expect(verifyMailgunSignature("x", "", "x", KEY)).toBe(false);
    expect(verifyMailgunSignature("x", "x", "", KEY)).toBe(false);
    expect(verifyMailgunSignature("x", "x", "x", "")).toBe(false);
  });

  it("rejects malformed hex", () => {
    expect(verifyMailgunSignature("ts", "tok", "not-hex!!!", KEY)).toBe(false);
  });

  it("rejects mismatched length", () => {
    expect(verifyMailgunSignature("ts", "tok", "abcd", KEY)).toBe(false);
  });
});

describe("mailgunEventToEmailEvent", () => {
  const baseHeaders = { "message-id": "<msg-1@mg.example.com>" };

  it("accepted → Queued", () => {
    const ev = mailgunEventToEmailEvent({
      event: "accepted",
      timestamp: 1700000000.5,
      message: { headers: baseHeaders },
    });
    expect(ev).toEqual({
      $tag: "Queued",
      id: { $tag: "MessageId", _0: "msg-1@mg.example.com" },
      at: { $tag: "Timestamp", epochMs: 1700000000500 },
    });
  });

  it("delivered → Delivered", () => {
    const ev = mailgunEventToEmailEvent({
      event: "delivered",
      timestamp: 1700000000,
      message: { headers: baseHeaders },
    });
    expect(ev).toMatchObject({ $tag: "Delivered" });
  });

  it("failed permanent → Bounced HardBounce", () => {
    const ev = mailgunEventToEmailEvent({
      event: "failed",
      timestamp: 1700000000,
      severity: "permanent",
      reason: "user not found",
      message: { headers: baseHeaders },
    });
    expect(ev).toMatchObject({
      $tag: "Bounced",
      kind: { $tag: "HardBounce" },
      reason: "user not found",
    });
  });

  it("failed temporary → Bounced SoftBounce", () => {
    const ev = mailgunEventToEmailEvent({
      event: "failed",
      timestamp: 1700000000,
      severity: "temporary",
      reason: "deferred",
      message: { headers: baseHeaders },
    });
    expect(ev).toMatchObject({ $tag: "Bounced", kind: { $tag: "SoftBounce" } });
  });

  it("complained → Complained", () => {
    const ev = mailgunEventToEmailEvent({
      event: "complained",
      timestamp: 1700000000,
      message: { headers: baseHeaders },
    });
    expect(ev).toMatchObject({ $tag: "Complained" });
  });

  it("opened → Opened with userAgent", () => {
    const ev = mailgunEventToEmailEvent({
      event: "opened",
      timestamp: 1700000000,
      "client-info": { "user-agent": "Gmail/iOS" },
      message: { headers: baseHeaders },
    });
    expect(ev).toMatchObject({ $tag: "Opened", userAgent: "Gmail/iOS" });
  });

  it("opened with no client-info → userAgent null", () => {
    const ev = mailgunEventToEmailEvent({
      event: "opened",
      timestamp: 1700000000,
      message: { headers: baseHeaders },
    });
    expect(ev).toMatchObject({ $tag: "Opened", userAgent: null });
  });

  it("clicked → Clicked with url", () => {
    const ev = mailgunEventToEmailEvent({
      event: "clicked",
      timestamp: 1700000000,
      url: "https://example.com/promo",
      message: { headers: baseHeaders },
    });
    expect(ev).toMatchObject({ $tag: "Clicked", url: "https://example.com/promo" });
  });

  it("unsubscribed → Unsubscribed", () => {
    const ev = mailgunEventToEmailEvent({
      event: "unsubscribed",
      timestamp: 1700000000,
      message: { headers: baseHeaders },
    });
    expect(ev).toMatchObject({ $tag: "Unsubscribed" });
  });

  it("unknown event → null", () => {
    expect(mailgunEventToEmailEvent({ event: "stored", timestamp: 1 })).toBeNull();
  });

  it("falls back to id when message-id header is absent", () => {
    const ev = mailgunEventToEmailEvent({
      event: "delivered",
      timestamp: 1700000000,
      id: "<fallback-id>",
    });
    expect(ev?.id._0).toBe("fallback-id");
  });
});

describe("mailgunInboundToEmail", () => {
  it("parses sender, recipient, subject, text body", () => {
    const e = mailgunInboundToEmail({
      sender: "alice@example.com",
      recipient: "support@usefenel.com",
      subject: "Help me",
      "body-plain": "I need assistance",
    });
    expect(e.from).toEqual({ local: "alice", domain: "example.com", displayName: null });
    expect(e.to).toEqual([{ local: "support", domain: "usefenel.com", displayName: null }]);
    expect(e.subject).toBe("Help me");
    expect(e.body).toEqual({ $tag: "Text", _0: "I need assistance" });
  });

  it("Multipart body when both text and html present", () => {
    const e = mailgunInboundToEmail({
      sender: "a@x.com",
      recipient: "b@y.com",
      "body-plain": "hi",
      "body-html": "<p>hi</p>",
    });
    expect(e.body).toEqual({ $tag: "Multipart", text: "hi", html: "<p>hi</p>" });
  });

  it("Html body when only html present", () => {
    const e = mailgunInboundToEmail({
      sender: "a@x.com",
      recipient: "b@y.com",
      "body-html": "<p>hi</p>",
    });
    expect(e.body).toEqual({ $tag: "Html", _0: "<p>hi</p>" });
  });

  it("parses Cc from message-headers", () => {
    const e = mailgunInboundToEmail({
      sender: "a@x.com",
      recipient: "b@y.com",
      "message-headers": JSON.stringify([
        ["Cc", "cc1@x.com, cc2@x.com"],
        ["X-Custom", "yes"],
      ]),
    });
    expect(e.cc.map((a) => `${a.local}@${a.domain}`)).toEqual(["cc1@x.com", "cc2@x.com"]);
    expect(e.headers).toEqual([
      { name: "Cc", value: "cc1@x.com, cc2@x.com" },
      { name: "X-Custom", value: "yes" },
    ]);
  });

  it("parses Reply-To", () => {
    const e = mailgunInboundToEmail({
      sender: "a@x.com",
      recipient: "b@y.com",
      "message-headers": JSON.stringify([["Reply-To", "rep@x.com"]]),
    });
    expect(e.replyTo).toEqual({ local: "rep", domain: "x.com", displayName: null });
  });

  it("parses In-Reply-To and References (strips brackets)", () => {
    const e = mailgunInboundToEmail({
      sender: "a@x.com",
      recipient: "b@y.com",
      "In-Reply-To": "<msg-1@x.com>",
      References: "<msg-1@x.com> <msg-2@x.com>",
    });
    expect(e.inReplyTo).toBe("msg-1@x.com");
    expect(e.references).toEqual(["msg-1@x.com", "msg-2@x.com"]);
  });

  it("handles malformed message-headers gracefully", () => {
    const e = mailgunInboundToEmail({
      sender: "a@x.com",
      recipient: "b@y.com",
      "message-headers": "not json",
    });
    expect(e.headers).toEqual([]);
    expect(e.cc).toEqual([]);
  });

  it("uses fallback fields when sender/recipient missing", () => {
    const e = mailgunInboundToEmail({
      from: "Bob <bob@example.com>",
      To: "alice@example.com",
      Subject: "fallback test",
    });
    expect(e.from).toEqual({ local: "bob", domain: "example.com", displayName: "Bob" });
    expect(e.to[0]).toEqual({ local: "alice", domain: "example.com", displayName: null });
    expect(e.subject).toBe("fallback test");
  });
});
