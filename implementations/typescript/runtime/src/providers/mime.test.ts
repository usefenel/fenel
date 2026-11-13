import { describe, it, expect } from "vitest";
import {
  quotedPrintable,
  base64Encode,
  buildMime,
  type FetchedAttachment,
} from "./mime";
import type { EmailValue, AddressValue, BodyValue } from "./mailgun";

function addr(local: string, domain: string, displayName: string | null = null): AddressValue {
  return { local, domain, displayName };
}

function makeEmail(overrides: Partial<EmailValue> = {}): EmailValue {
  return {
    from: addr("rom", "usefenel.com", "Rom"),
    to: [addr("alice", "example.com")],
    cc: [],
    bcc: [],
    replyTo: null,
    subject: "Hello",
    body: { $tag: "Text", _0: "hi there" } as BodyValue,
    attachments: [],
    headers: [],
    inReplyTo: null,
    references: [],
    ...overrides,
  };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("quotedPrintable", () => {
  it("passes through plain ASCII unchanged", () => {
    expect(quotedPrintable("Hello, World!")).toBe("Hello, World!");
  });

  it("encodes high-bit bytes as =XX", () => {
    expect(quotedPrintable("café")).toBe("caf=C3=A9");
  });

  it("encodes the literal `=` sign", () => {
    expect(quotedPrintable("a=b")).toBe("a=3Db");
  });

  it("preserves CRLF line breaks as hard breaks", () => {
    expect(quotedPrintable("line one\r\nline two")).toBe("line one\r\nline two");
  });

  it("preserves bare LF as hard breaks", () => {
    expect(quotedPrintable("a\nb")).toBe("a\r\nb");
  });

  it("wraps long lines at 76 chars with soft breaks", () => {
    const long = "a".repeat(200);
    const encoded = quotedPrintable(long);
    for (const line of encoded.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });
});

describe("base64Encode", () => {
  it("encodes binary bytes correctly", () => {
    expect(base64Encode(new Uint8Array([0, 1, 2, 3]))).toBe("AAECAw==");
  });

  it("round-trips through atob", () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]);
    const b64 = base64Encode(data);
    expect(b64).toBe("SGVsbG8=");
    expect(atob(b64)).toBe("Hello");
  });
});

describe("buildMime", () => {
  it("emits a multipart/mixed message with multipart/alternative inside", () => {
    const out = decode(buildMime(makeEmail(), []));
    expect(out).toMatch(/Content-Type: multipart\/mixed; boundary="=_OUTER_/);
    expect(out).toMatch(/Content-Type: multipart\/alternative; boundary="=_INNER_/);
    expect(out).toMatch(/--=_OUTER_[a-f0-9]+--/);
    expect(out).toMatch(/--=_INNER_[a-f0-9]+--/);
  });

  it("includes From / To / Subject / Date / MIME-Version headers", () => {
    const out = decode(buildMime(makeEmail(), []));
    expect(out).toMatch(/From: "Rom" <rom@usefenel\.com>/);
    expect(out).toMatch(/To: alice@example\.com/);
    expect(out).toMatch(/Subject: Hello/);
    expect(out).toMatch(/Date: /);
    expect(out).toMatch(/MIME-Version: 1\.0/);
  });

  it("emits Cc when present, omits it otherwise", () => {
    const withCc = decode(buildMime(makeEmail({ cc: [addr("c", "x.com")] }), []));
    expect(withCc).toMatch(/Cc: c@x\.com/);
    const withoutCc = decode(buildMime(makeEmail(), []));
    expect(withoutCc).not.toMatch(/Cc:/);
  });

  it("never emits Bcc — it's the SES envelope's job", () => {
    const out = decode(buildMime(makeEmail({ bcc: [addr("b", "x.com")] }), []));
    expect(out).not.toMatch(/Bcc:/);
  });

  it("encodes the text body as quoted-printable", () => {
    const out = decode(buildMime(makeEmail({
      body: { $tag: "Text", _0: "café" },
    }), []));
    expect(out).toMatch(/Content-Transfer-Encoding: quoted-printable/);
    expect(out).toMatch(/caf=C3=A9/);
  });

  it("includes both text and html parts for Multipart body", () => {
    const out = decode(buildMime(makeEmail({
      body: { $tag: "Multipart", text: "T", html: "<p>H</p>" },
    }), []));
    expect(out).toMatch(/Content-Type: text\/plain; charset=UTF-8/);
    expect(out).toMatch(/Content-Type: text\/html; charset=UTF-8/);
    expect(out).toMatch(/<p>H<\/p>|<p>H=3C\/p>/); // either literal or QP-encoded
  });

  it("attaches a binary file as base64", () => {
    const att: FetchedAttachment = {
      filename: "doc.pdf",
      contentType: "application/pdf",
      contentId: null,
      bytes: new Uint8Array([1, 2, 3, 4]),
    };
    const out = decode(buildMime(makeEmail(), [att]));
    expect(out).toMatch(/Content-Type: application\/pdf; name="doc\.pdf"/);
    expect(out).toMatch(/Content-Transfer-Encoding: base64/);
    expect(out).toMatch(/Content-Disposition: attachment; filename="doc\.pdf"/);
    expect(out).toMatch(/AQIDBA==/); // base64 of [1,2,3,4]
  });

  it("uses inline disposition + Content-ID for attachments with contentId", () => {
    const att: FetchedAttachment = {
      filename: "logo.png",
      contentType: "image/png",
      contentId: "logo@cid",
      bytes: new Uint8Array([0xff, 0xd8]),
    };
    const out = decode(buildMime(makeEmail(), [att]));
    expect(out).toMatch(/Content-Disposition: inline; filename="logo\.png"/);
    expect(out).toMatch(/Content-ID: <logo@cid>/);
  });

  it("includes In-Reply-To and References when set", () => {
    const out = decode(buildMime(makeEmail({
      inReplyTo: "msg-1@x.com",
      references: ["msg-1@x.com", "msg-2@x.com"],
    }), []));
    expect(out).toMatch(/In-Reply-To: <msg-1@x\.com>/);
    expect(out).toMatch(/References: <msg-1@x\.com> <msg-2@x\.com>/);
  });

  it("forwards custom headers", () => {
    const out = decode(buildMime(makeEmail({
      headers: [{ name: "X-Campaign", value: "spring" }],
    }), []));
    expect(out).toMatch(/X-Campaign: spring/);
  });
});
