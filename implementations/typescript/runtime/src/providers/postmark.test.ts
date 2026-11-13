import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildPostmarkBody,
  mapPostmarkSendError,
  mapPostmarkDomain,
  postmarkSend,
} from "./postmark";
import type { EmailValue, AddressValue, BodyValue } from "./mailgun";

const CREDS = { POSTMARK_SERVER_TOKEN: "tok-test" };

function addr(local: string, domain: string, displayName: string | null = null): AddressValue {
  return { local, domain, displayName };
}

function makeEmail(overrides: Partial<EmailValue> = {}): EmailValue {
  return {
    from: addr("rom", "usefenel.com"),
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

describe("buildPostmarkBody", () => {
  it("uses the canonical Postmark capitalized field names", async () => {
    const body = await buildPostmarkBody(makeEmail());
    expect(body).toMatchObject({
      From: "rom@usefenel.com",
      To: "alice@example.com",
      Subject: "Hello",
      TextBody: "hi there",
      MessageStream: "outbound",
    });
  });

  it("comma-joins multi-recipient lists", async () => {
    const body = await buildPostmarkBody(makeEmail({
      to: [addr("a", "x.com"), addr("b", "x.com")],
      cc: [addr("c", "x.com")],
    }));
    expect(body.To).toBe("a@x.com, b@x.com");
    expect(body.Cc).toBe("c@x.com");
  });

  it("Multipart body produces both TextBody and HtmlBody", async () => {
    const body = await buildPostmarkBody(makeEmail({
      body: { $tag: "Multipart", text: "T", html: "<p>H</p>" },
    }));
    expect(body.TextBody).toBe("T");
    expect(body.HtmlBody).toBe("<p>H</p>");
  });

  it("threading headers are appended to Headers", async () => {
    const body = await buildPostmarkBody(makeEmail({
      inReplyTo: "msg-1@x.com",
      references: ["msg-1@x.com", "msg-2@x.com"],
    }));
    const headers = body.Headers as Array<{ Name: string; Value: string }>;
    expect(headers).toContainEqual({ Name: "In-Reply-To", Value: "<msg-1@x.com>" });
    expect(headers).toContainEqual({
      Name: "References",
      Value: "<msg-1@x.com> <msg-2@x.com>",
    });
  });

  it("strips undefined fields", async () => {
    const body = await buildPostmarkBody(makeEmail());
    expect("Cc" in body).toBe(false);
    expect("Bcc" in body).toBe(false);
    expect("ReplyTo" in body).toBe(false);
  });
});

describe("mapPostmarkSendError", () => {
  it("ErrorCode 406 → Suppressed", async () => {
    const r = new Response(JSON.stringify({ ErrorCode: 406, Message: "inactive" }), { status: 422 });
    expect(await mapPostmarkSendError(r)).toMatchObject({ $tag: "Suppressed" });
  });

  it("ErrorCode 300 → InvalidAddress", async () => {
    const r = new Response(JSON.stringify({ ErrorCode: 300, Message: "bad" }), { status: 422 });
    expect(await mapPostmarkSendError(r)).toMatchObject({ $tag: "InvalidAddress" });
  });

  it("ErrorCode 412 → DomainNotVerified", async () => {
    const r = new Response(JSON.stringify({ ErrorCode: 412, Message: "domain" }), { status: 422 });
    expect(await mapPostmarkSendError(r)).toMatchObject({ $tag: "DomainNotVerified" });
  });

  it("401 → ProviderError with Postmark code", async () => {
    const r = new Response(JSON.stringify({ ErrorCode: 10, Message: "auth" }), { status: 401 });
    expect(await mapPostmarkSendError(r)).toMatchObject({
      $tag: "ProviderError",
      code: "10",
    });
  });

  it("429 → RateLimited", async () => {
    const r = new Response("{}", { status: 429, headers: { "retry-after": "30" } });
    expect(await mapPostmarkSendError(r)).toMatchObject({ $tag: "RateLimited", _0: 30 });
  });
});

describe("mapPostmarkDomain", () => {
  it("verified when both DKIM and ReturnPath are verified", () => {
    const result = mapPostmarkDomain({
      Name: "acme.com",
      DKIMVerified: true,
      ReturnPathDomainVerified: true,
      DKIMHost: "20240101._domainkey.acme.com",
      DKIMTextValue: "k=rsa; p=ABC...",
    });
    expect(result.name).toBe("acme.com");
    expect(result.status).toEqual({ $tag: "DomainVerified" });
    expect(result.dkimRecords).toHaveLength(1);
    expect(result.dkimRecords[0]).toMatchObject({ verified: true });
  });

  it("pending when not yet verified", () => {
    const result = mapPostmarkDomain({
      Name: "acme.com",
      DKIMVerified: false,
      ReturnPathDomainVerified: false,
    });
    expect(result.status).toEqual({ $tag: "DomainPending" });
  });
});

describe("postmarkSend (mocked fetch)", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns Sent on success", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ MessageID: "abc-123" }), { status: 200 }),
    );
    const result = await postmarkSend({ email: makeEmail() }, CREDS);
    expect(result).toMatchObject({ $tag: "Sent", id: { _0: "abc-123" } });
  });

  it("hits the Postmark email endpoint with the server token", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ MessageID: "id" }), { status: 200 }),
    );
    await postmarkSend({ email: makeEmail() }, CREDS);
    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://api.postmarkapp.com/email");
    expect(opts.headers["X-Postmark-Server-Token"]).toBe("tok-test");
  });
});
