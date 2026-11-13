import { describe, it, expect } from "vitest";
import {
  sesEventToEmailEvent,
  sesEventRecipient,
  type SesEventInner,
} from "./ses-webhook";

const baseMail = { messageId: "ses-msg-1", timestamp: "2024-01-01T00:00:00Z" };

describe("sesEventToEmailEvent", () => {
  it("Send → Queued", () => {
    const ev = sesEventToEmailEvent({ eventType: "Send", mail: baseMail });
    expect(ev).toEqual({
      $tag: "Queued",
      id: { $tag: "MessageId", _0: "ses-msg-1" },
      at: { epochMs: Date.parse("2024-01-01T00:00:00Z") },
    });
  });

  it("Delivery → Delivered", () => {
    const ev = sesEventToEmailEvent({
      eventType: "Delivery",
      mail: baseMail,
      delivery: { timestamp: "2024-01-01T00:00:01Z" },
    });
    expect(ev).toMatchObject({ $tag: "Delivered" });
  });

  it("Bounce Permanent → HardBounce with diagnosticCode", () => {
    const ev = sesEventToEmailEvent({
      eventType: "Bounce",
      mail: baseMail,
      bounce: {
        bounceType: "Permanent",
        bounceSubType: "General",
        bouncedRecipients: [{ emailAddress: "alice@x.com", diagnosticCode: "smtp; 550 user not found" }],
        timestamp: "2024-01-01T00:00:00Z",
      },
    } as SesEventInner);
    expect(ev).toMatchObject({
      $tag: "Bounced",
      kind: { $tag: "HardBounce" },
      reason: "smtp; 550 user not found",
    });
  });

  it("Bounce Transient → SoftBounce", () => {
    const ev = sesEventToEmailEvent({
      eventType: "Bounce",
      mail: baseMail,
      bounce: { bounceType: "Transient", bounceSubType: "MailboxFull", timestamp: "2024-01-01T00:00:00Z" },
    });
    expect(ev).toMatchObject({ $tag: "Bounced", kind: { $tag: "SoftBounce" } });
  });

  it("Bounce Undetermined → BlockBounce", () => {
    const ev = sesEventToEmailEvent({
      eventType: "Bounce",
      mail: baseMail,
      bounce: { bounceType: "Undetermined", timestamp: "2024-01-01T00:00:00Z" },
    });
    expect(ev).toMatchObject({ $tag: "Bounced", kind: { $tag: "BlockBounce" } });
  });

  it("Complaint → Complained", () => {
    const ev = sesEventToEmailEvent({
      eventType: "Complaint",
      mail: baseMail,
      complaint: { timestamp: "2024-01-01T00:00:00Z" },
    });
    expect(ev).toMatchObject({ $tag: "Complained" });
  });

  it("Open → Opened with userAgent", () => {
    const ev = sesEventToEmailEvent({
      eventType: "Open",
      mail: baseMail,
      open: { userAgent: "Gmail/iOS", timestamp: "2024-01-01T00:00:00Z" },
    });
    expect(ev).toMatchObject({ $tag: "Opened", userAgent: "Gmail/iOS" });
  });

  it("Click → Clicked with link", () => {
    const ev = sesEventToEmailEvent({
      eventType: "Click",
      mail: baseMail,
      click: { link: "https://example.com", timestamp: "2024-01-01T00:00:00Z" },
    });
    expect(ev).toMatchObject({ $tag: "Clicked", url: "https://example.com" });
  });

  it("Reject → Failed", () => {
    const ev = sesEventToEmailEvent({ eventType: "Reject", mail: baseMail });
    expect(ev).toMatchObject({ $tag: "Failed", reason: "Reject" });
  });

  it("RenderingFailure → Failed", () => {
    const ev = sesEventToEmailEvent({ eventType: "Rendering Failure", mail: baseMail });
    expect(ev).toMatchObject({ $tag: "Failed", reason: "Rendering Failure" });
  });

  it("unknown eventType → null", () => {
    expect(sesEventToEmailEvent({ eventType: "Subscription", mail: baseMail })).toBeNull();
  });
});

describe("sesEventRecipient", () => {
  it("Bounce → first bouncedRecipient.emailAddress", () => {
    expect(sesEventRecipient({
      eventType: "Bounce",
      mail: baseMail,
      bounce: { bouncedRecipients: [{ emailAddress: "alice@x.com" }] },
    })).toEqual({ local: "alice", domain: "x.com", displayName: null });
  });

  it("Complaint → first complainedRecipient.emailAddress", () => {
    expect(sesEventRecipient({
      eventType: "Complaint",
      mail: baseMail,
      complaint: { complainedRecipients: [{ emailAddress: "bob@x.com" }] },
    })).toEqual({ local: "bob", domain: "x.com", displayName: null });
  });

  it("Delivery → first delivery.recipients", () => {
    expect(sesEventRecipient({
      eventType: "Delivery",
      mail: baseMail,
      delivery: { recipients: ["carol@x.com"] },
    })).toEqual({ local: "carol", domain: "x.com", displayName: null });
  });

  it("default → first mail.destination", () => {
    expect(sesEventRecipient({
      eventType: "Open",
      mail: { ...baseMail, destination: ["dave@x.com"] },
    })).toEqual({ local: "dave", domain: "x.com", displayName: null });
  });

  it("returns null when no recipient anywhere", () => {
    expect(sesEventRecipient({ eventType: "Open", mail: baseMail })).toBeNull();
  });
});
