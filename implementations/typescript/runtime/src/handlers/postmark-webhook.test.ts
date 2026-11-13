import { describe, it, expect } from "vitest";
import {
  postmarkEventToEmailEvent,
  postmarkEventRecipient,
  postmarkEventDedupeKey,
  postmarkInboundToEmail,
} from "./postmark-webhook";

describe("postmarkEventToEmailEvent", () => {
  it("Delivery → Delivered", () => {
    const ev = postmarkEventToEmailEvent({
      RecordType: "Delivery",
      MessageID: "msg-1",
      DeliveredAt: "2024-01-01T00:00:00Z",
      Recipient: "alice@example.com",
    });
    expect(ev).toEqual({
      $tag: "Delivered",
      id: { $tag: "MessageId", _0: "msg-1" },
      at: { $tag: "Timestamp", epochMs: Date.parse("2024-01-01T00:00:00Z") },
    });
  });

  it("Bounce HardBounce → Bounced HardBounce with reason", () => {
    const ev = postmarkEventToEmailEvent({
      RecordType: "Bounce",
      MessageID: "msg-2",
      Type: "HardBounce",
      Description: "user not found",
      BouncedAt: "2024-01-01T00:00:00Z",
    });
    expect(ev).toMatchObject({
      $tag: "Bounced",
      kind: { $tag: "HardBounce" },
      reason: "user not found",
    });
  });

  it("Bounce SoftBounce → Bounced SoftBounce", () => {
    const ev = postmarkEventToEmailEvent({
      RecordType: "Bounce",
      MessageID: "m",
      Type: "SoftBounce",
      Description: "deferred",
      BouncedAt: "2024-01-01T00:00:00Z",
    });
    expect(ev).toMatchObject({ $tag: "Bounced", kind: { $tag: "SoftBounce" } });
  });

  it("Bounce Transient → SoftBounce", () => {
    const ev = postmarkEventToEmailEvent({
      RecordType: "Bounce", MessageID: "m", Type: "Transient",
      BouncedAt: "2024-01-01T00:00:00Z",
    });
    expect(ev).toMatchObject({ $tag: "Bounced", kind: { $tag: "SoftBounce" } });
  });

  it("SpamComplaint → Complained", () => {
    const ev = postmarkEventToEmailEvent({
      RecordType: "SpamComplaint",
      MessageID: "m",
      BouncedAt: "2024-01-01T00:00:00Z",
    });
    expect(ev).toMatchObject({ $tag: "Complained" });
  });

  it("Open → Opened with UserAgent", () => {
    const ev = postmarkEventToEmailEvent({
      RecordType: "Open",
      MessageID: "m",
      UserAgent: "Gmail/iOS",
      ReceivedAt: "2024-01-01T00:00:00Z",
    });
    expect(ev).toMatchObject({ $tag: "Opened", userAgent: "Gmail/iOS" });
  });

  it("Click → Clicked with OriginalLink", () => {
    const ev = postmarkEventToEmailEvent({
      RecordType: "Click",
      MessageID: "m",
      OriginalLink: "https://example.com/x",
      ReceivedAt: "2024-01-01T00:00:00Z",
    });
    expect(ev).toMatchObject({ $tag: "Clicked", url: "https://example.com/x" });
  });

  it("SubscriptionChange with SuppressSending=true → Unsubscribed", () => {
    const ev = postmarkEventToEmailEvent({
      RecordType: "SubscriptionChange",
      MessageID: "m",
      SuppressSending: true,
      ChangedAt: "2024-01-01T00:00:00Z",
    });
    expect(ev).toMatchObject({ $tag: "Unsubscribed" });
  });

  it("SubscriptionChange with SuppressSending=false → null", () => {
    expect(postmarkEventToEmailEvent({
      RecordType: "SubscriptionChange",
      MessageID: "m",
      SuppressSending: false,
    })).toBeNull();
  });

  it("unknown record type → null", () => {
    expect(postmarkEventToEmailEvent({ RecordType: "Unknown" })).toBeNull();
  });
});

describe("postmarkEventRecipient", () => {
  it("parses bare address from Recipient", () => {
    expect(postmarkEventRecipient({ Recipient: "alice@example.com" })).toEqual({
      local: "alice", domain: "example.com", displayName: null,
    });
  });

  it("falls back to Email field", () => {
    expect(postmarkEventRecipient({ Email: "bob@example.com" })).toEqual({
      local: "bob", domain: "example.com", displayName: null,
    });
  });

  it("returns null when no recipient field", () => {
    expect(postmarkEventRecipient({})).toBeNull();
  });
});

describe("postmarkEventDedupeKey", () => {
  it("combines record type, message id, and timestamp", () => {
    const key = postmarkEventDedupeKey({
      RecordType: "Delivery",
      MessageID: "msg-1",
      DeliveredAt: "2024-01-01T00:00:00Z",
    });
    expect(key).toBe("Delivery:msg-1:2024-01-01T00:00:00Z");
  });

  it("differentiates multiple Opens for same MessageID", () => {
    const k1 = postmarkEventDedupeKey({ RecordType: "Open", MessageID: "m", ReceivedAt: "T1" });
    const k2 = postmarkEventDedupeKey({ RecordType: "Open", MessageID: "m", ReceivedAt: "T2" });
    expect(k1).not.toBe(k2);
  });
});

describe("postmarkInboundToEmail", () => {
  it("parses a basic inbound JSON", () => {
    const e = postmarkInboundToEmail({
      From: "alice@example.com",
      To: "support@usefenel.com",
      Subject: "Help",
      TextBody: "I need help",
      Headers: [],
      Attachments: [],
    });
    expect(e.from).toEqual({ local: "alice", domain: "example.com", displayName: null });
    expect(e.to).toEqual([{ local: "support", domain: "usefenel.com", displayName: null }]);
    expect(e.subject).toBe("Help");
    expect(e.body).toEqual({ $tag: "Text", _0: "I need help" });
  });

  it("emits Multipart when both TextBody and HtmlBody present", () => {
    const e = postmarkInboundToEmail({
      From: "a@x.com", To: "b@y.com",
      TextBody: "hi", HtmlBody: "<p>hi</p>",
      Headers: [],
    });
    expect(e.body).toEqual({ $tag: "Multipart", text: "hi", html: "<p>hi</p>" });
  });

  it("parses Cc into structured addresses", () => {
    const e = postmarkInboundToEmail({
      From: "a@x.com", To: "b@y.com",
      Cc: "c@x.com, d@x.com",
      TextBody: "", Headers: [],
    });
    expect(e.cc.map((a) => `${a.local}@${a.domain}`)).toEqual(["c@x.com", "d@x.com"]);
  });

  it("populates Reply-To from Headers", () => {
    const e = postmarkInboundToEmail({
      From: "a@x.com", To: "b@y.com",
      TextBody: "",
      Headers: [{ Name: "Reply-To", Value: "rep@x.com" }],
    });
    expect(e.replyTo).toEqual({ local: "rep", domain: "x.com", displayName: null });
  });

  it("parses In-Reply-To and References from Headers", () => {
    const e = postmarkInboundToEmail({
      From: "a@x.com", To: "b@y.com",
      TextBody: "",
      Headers: [
        { Name: "In-Reply-To", Value: "<msg-1@x.com>" },
        { Name: "References", Value: "<msg-1@x.com> <msg-2@x.com>" },
      ],
    });
    expect(e.inReplyTo).toBe("msg-1@x.com");
    expect(e.references).toEqual(["msg-1@x.com", "msg-2@x.com"]);
  });

  it("encodes attachments as data: URLs in the AssetRef", () => {
    const e = postmarkInboundToEmail({
      From: "a@x.com", To: "b@y.com",
      TextBody: "",
      Headers: [],
      Attachments: [
        { Name: "logo.png", Content: "iVBORw0KGgo=", ContentType: "image/png", ContentID: "cid:logo" },
      ],
    });
    expect(e.attachments).toHaveLength(1);
    expect(e.attachments[0]).toEqual({
      asset: {
        url: "data:image/png;base64,iVBORw0KGgo=",
        name: "logo.png",
        mimeType: "image/png",
      },
      contentId: "logo",
    });
  });
});
