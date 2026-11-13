import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildResendBody,
  mapResendSendError,
  mapResendDomain,
  resendSend,
  resendSendBatch,
  resendListDomains,
  resendVerifyDomain,
} from "./resend";
import type { EmailValue, AddressValue, BodyValue } from "./mailgun";

const CREDS = { RESEND_API_KEY: "re_test" };

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
    body: { $tag: "Text", _0: "hi" } as BodyValue,
    attachments: [],
    headers: [],
    inReplyTo: null,
    references: [],
    ...overrides,
  };
}

describe("buildResendBody", () => {
  it("uses Resend's lowercase JSON field names", async () => {
    const body = await buildResendBody(makeEmail());
    expect(body).toMatchObject({
      from: "rom@usefenel.com",
      to: ["alice@example.com"],
      subject: "Hello",
      text: "hi",
    });
  });

  it("emits to/cc/bcc as arrays of strings", async () => {
    const body = await buildResendBody(makeEmail({
      to: [addr("a", "x.com"), addr("b", "x.com")],
      cc: [addr("c", "x.com")],
      bcc: [addr("d", "x.com")],
    }));
    expect(body.to).toEqual(["a@x.com", "b@x.com"]);
    expect(body.cc).toEqual(["c@x.com"]);
    expect(body.bcc).toEqual(["d@x.com"]);
  });

  it("Multipart body produces both text and html", async () => {
    const body = await buildResendBody(makeEmail({
      body: { $tag: "Multipart", text: "T", html: "<p>H</p>" },
    }));
    expect(body.text).toBe("T");
    expect(body.html).toBe("<p>H</p>");
  });

  it("threading headers fold into the headers map", async () => {
    const body = await buildResendBody(makeEmail({
      inReplyTo: "msg-1@x.com",
      references: ["msg-1@x.com", "msg-2@x.com"],
    }));
    const headers = body.headers as Record<string, string>;
    expect(headers["In-Reply-To"]).toBe("<msg-1@x.com>");
    expect(headers["References"]).toBe("<msg-1@x.com> <msg-2@x.com>");
  });

  it("strips undefined fields", async () => {
    const body = await buildResendBody(makeEmail());
    expect("cc" in body).toBe(false);
    expect("bcc" in body).toBe(false);
    expect("reply_to" in body).toBe(false);
  });
});

describe("mapResendSendError", () => {
  it("422 with /address/ → InvalidAddress", async () => {
    const r = new Response(
      JSON.stringify({ message: "invalid recipient address" }),
      { status: 422 },
    );
    expect(await mapResendSendError(r)).toMatchObject({ $tag: "InvalidAddress" });
  });

  it("422 with /domain/ → DomainNotVerified", async () => {
    const r = new Response(
      JSON.stringify({ message: "domain not verified" }),
      { status: 422 },
    );
    expect(await mapResendSendError(r)).toMatchObject({ $tag: "DomainNotVerified" });
  });

  it("401 → ProviderError", async () => {
    const r = new Response(JSON.stringify({ name: "auth" }), { status: 401 });
    expect(await mapResendSendError(r)).toMatchObject({
      $tag: "ProviderError",
    });
  });

  it("429 → RateLimited with retry-after", async () => {
    const r = new Response("{}", {
      status: 429,
      headers: { "retry-after": "30" },
    });
    expect(await mapResendSendError(r)).toMatchObject({
      $tag: "RateLimited",
      _0: 30,
    });
  });
});

describe("mapResendDomain", () => {
  it("verified status maps to DomainVerified", () => {
    const result = mapResendDomain({
      name: "acme.com",
      status: "verified",
      records: [],
    });
    expect(result.name).toBe("acme.com");
    expect(result.status).toEqual({ $tag: "DomainVerified" });
  });

  it("pending status maps to DomainPending", () => {
    const result = mapResendDomain({ name: "acme.com", status: "pending" });
    expect(result.status).toEqual({ $tag: "DomainPending" });
  });

  it("populates DKIM records from _domainkey hosts", () => {
    const result = mapResendDomain({
      name: "acme.com",
      status: "verified",
      records: [
        {
          type: "TXT",
          name: "resend._domainkey.acme.com",
          value: "v=DKIM1; ...",
          status: "verified",
        },
        {
          type: "TXT",
          name: "acme.com",
          value: "v=spf1 include:resend.com ~all",
          status: "verified",
        },
      ],
    });
    expect(result.dkimRecords).toHaveLength(1);
    expect(result.dkimRecords[0]).toMatchObject({
      kind: "TXT",
      verified: true,
    });
    expect(result.spfRecord.value).toContain("v=spf1");
  });
});

describe("resendSend (mocked fetch)", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns Sent on success", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "re_msg_1" }), { status: 200 }),
    );
    const result = await resendSend({ email: makeEmail() }, CREDS);
    expect(result).toMatchObject({
      $tag: "Sent",
      id: { $tag: "MessageId", _0: "re_msg_1" },
    });
  });

  it("hits the Resend emails endpoint with Bearer auth", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "id" }), { status: 200 }),
    );
    await resendSend({ email: makeEmail() }, CREDS);
    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(opts.headers.Authorization).toBe("Bearer re_test");
  });

  it("rejects when from-domain is missing", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const result = await resendSend(
      { email: makeEmail({ from: { local: "rom", domain: "", displayName: null } }) },
      CREDS,
    );
    expect(result).toMatchObject({
      $tag: "Rejected",
      reason: { $tag: "InvalidAddress" },
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("propagates RateLimited error from 429", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response("{}", { status: 429, headers: { "retry-after": "45" } }),
    );
    const result = await resendSend({ email: makeEmail() }, CREDS);
    expect(result).toMatchObject({
      $tag: "Rejected",
      reason: { $tag: "RateLimited", _0: 45 },
    });
  });
});

describe("resendSendBatch (mocked fetch)", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("hits the batch endpoint and returns Sent for each email", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "id-1" }, { id: "id-2" }] }),
        { status: 200 },
      ),
    );
    const results = await resendSendBatch(
      { emails: [makeEmail(), makeEmail()] },
      CREDS,
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ $tag: "Sent", id: { _0: "id-1" } });
    expect(results[1]).toMatchObject({ $tag: "Sent", id: { _0: "id-2" } });
    const url = (globalThis.fetch as any).mock.calls[0][0];
    expect(url).toBe("https://api.resend.com/emails/batch");
  });

  it("returns Rejected for every email when the batch call fails", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response("{}", { status: 401 }),
    );
    const results = await resendSendBatch(
      { emails: [makeEmail(), makeEmail()] },
      CREDS,
    );
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.$tag === "Rejected")).toBe(true);
  });

  it("returns empty array for empty input", async () => {
    const results = await resendSendBatch({ emails: [] }, CREDS);
    expect(results).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("resendListDomains / resendVerifyDomain (mocked fetch)", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("listDomains maps each result", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          { name: "a.com", status: "verified" },
          { name: "b.com", status: "pending" },
        ],
      }), { status: 200 }),
    );
    const list = await resendListDomains({}, CREDS);
    expect(list.map((d) => d.name)).toEqual(["a.com", "b.com"]);
    expect(list[0]!.status).toEqual({ $tag: "DomainVerified" });
    expect(list[1]!.status).toEqual({ $tag: "DomainPending" });
  });

  it("verifyDomain finds the id from list, then POSTs to /verify", async () => {
    let call = 0;
    (globalThis.fetch as any).mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve(new Response(JSON.stringify({
          data: [{ id: "dom_abc", name: "acme.com", status: "pending" }],
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        name: "acme.com",
        status: "verified",
      }), { status: 200 }));
    });
    const result = await resendVerifyDomain({ name: "acme.com" }, CREDS);
    expect(result.status).toEqual({ $tag: "DomainVerified" });
    const [, opts] = (globalThis.fetch as any).mock.calls[1];
    expect(opts.method).toBe("POST");
    expect((globalThis.fetch as any).mock.calls[1][0]).toContain("/domains/dom_abc/verify");
  });
});
