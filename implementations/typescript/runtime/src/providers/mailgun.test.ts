import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mailgunBaseUrl,
  formatAddress,
  bodyText,
  bodyHtml,
  buildMailgunFormData,
  mapMailgunSendError,
  mapMailgunDomain,
  mailgunSend,
  mailgunAddDomain,
  mailgunVerifyDomain,
  mailgunListDomains,
  type EmailValue,
  type AddressValue,
  type BodyValue,
} from "./mailgun";

const RAW_CREDS = { MAILGUN_API_KEY: "key-test", MAILGUN_REGION: "us" };
const EU_CREDS = { MAILGUN_API_KEY: "key-test", MAILGUN_REGION: "eu" };

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

describe("mailgunBaseUrl", () => {
  it("defaults to US", () => {
    expect(mailgunBaseUrl({} as Record<string, string>)).toBe("https://api.mailgun.net");
    expect(mailgunBaseUrl(RAW_CREDS)).toBe("https://api.mailgun.net");
  });

  it("picks EU when MAILGUN_REGION=eu", () => {
    expect(mailgunBaseUrl(EU_CREDS)).toBe("https://api.eu.mailgun.net");
  });
});

describe("formatAddress", () => {
  it("bare local@domain", () => {
    expect(formatAddress(addr("rom", "usefenel.com"))).toBe("rom@usefenel.com");
  });

  it("RFC 5322 with display name", () => {
    expect(formatAddress(addr("rom", "usefenel.com", "Romain"))).toBe('"Romain" <rom@usefenel.com>');
  });

  it("strips embedded quotes from display name", () => {
    expect(formatAddress(addr("rom", "usefenel.com", 'Hi "Rom"'))).toBe('"Hi Rom" <rom@usefenel.com>');
  });

  it("returns empty for invalid input", () => {
    expect(formatAddress(null)).toBe("");
    expect(formatAddress(addr("", "usefenel.com"))).toBe("");
    expect(formatAddress(addr("rom", ""))).toBe("");
  });
});

describe("bodyText / bodyHtml", () => {
  it("Text body has text only", () => {
    const b: BodyValue = { $tag: "Text", _0: "hi" };
    expect(bodyText(b)).toBe("hi");
    expect(bodyHtml(b)).toBeNull();
  });

  it("Html body has html only", () => {
    const b: BodyValue = { $tag: "Html", _0: "<p>hi</p>" };
    expect(bodyText(b)).toBeNull();
    expect(bodyHtml(b)).toBe("<p>hi</p>");
  });

  it("Multipart has both", () => {
    const b: BodyValue = { $tag: "Multipart", text: "hi", html: "<p>hi</p>" };
    expect(bodyText(b)).toBe("hi");
    expect(bodyHtml(b)).toBe("<p>hi</p>");
  });
});

describe("buildMailgunFormData", () => {
  it("sets from / to / subject / text", async () => {
    const form = await buildMailgunFormData(makeEmail());
    expect(form.get("from")).toBe("rom@usefenel.com");
    expect(form.get("to")).toBe("alice@example.com");
    expect(form.get("subject")).toBe("Hello");
    expect(form.get("text")).toBe("hi there");
  });

  it("appends multiple to / cc / bcc", async () => {
    const form = await buildMailgunFormData(makeEmail({
      to: [addr("a", "x.com"), addr("b", "x.com")],
      cc: [addr("c", "x.com")],
      bcc: [addr("d", "x.com")],
    }));
    expect(form.getAll("to")).toEqual(["a@x.com", "b@x.com"]);
    expect(form.getAll("cc")).toEqual(["c@x.com"]);
    expect(form.getAll("bcc")).toEqual(["d@x.com"]);
  });

  it("sets text and html for Multipart body", async () => {
    const form = await buildMailgunFormData(makeEmail({
      body: { $tag: "Multipart", text: "T", html: "<h1>H</h1>" },
    }));
    expect(form.get("text")).toBe("T");
    expect(form.get("html")).toBe("<h1>H</h1>");
  });

  it("emits Reply-To and threading headers", async () => {
    const form = await buildMailgunFormData(makeEmail({
      replyTo: addr("rep", "x.com"),
      inReplyTo: "<msg-1@x.com>",
      references: ["<msg-1@x.com>", "<msg-2@x.com>"],
    }));
    expect(form.get("h:Reply-To")).toBe("rep@x.com");
    expect(form.get("h:In-Reply-To")).toBe("<msg-1@x.com>");
    expect(form.get("h:References")).toBe("<msg-1@x.com> <msg-2@x.com>");
  });

  it("forwards custom headers with h: prefix", async () => {
    const form = await buildMailgunFormData(makeEmail({
      headers: [{ name: "X-Campaign", value: "spring-2026" }],
    }));
    expect(form.get("h:X-Campaign")).toBe("spring-2026");
  });
});

describe("mapMailgunSendError", () => {
  it("401 → ProviderError", async () => {
    const r = new Response("auth failed", { status: 401 });
    expect(await mapMailgunSendError(r)).toMatchObject({ $tag: "ProviderError", code: "401" });
  });

  it("429 → RateLimited with retry-after", async () => {
    const r = new Response("slow down", { status: 429, headers: { "retry-after": "120" } });
    expect(await mapMailgunSendError(r)).toEqual({ $tag: "RateLimited", _0: 120 });
  });

  it("400 with 'not a valid' → InvalidAddress", async () => {
    const r = new Response("'not-an-email' is not a valid address", { status: 400 });
    expect(await mapMailgunSendError(r)).toMatchObject({ $tag: "InvalidAddress" });
  });

  it("500 → ProviderError", async () => {
    const r = new Response("oops", { status: 500 });
    expect(await mapMailgunSendError(r)).toMatchObject({ $tag: "ProviderError", code: "500" });
  });
});

describe("mapMailgunDomain", () => {
  it("verified domain", () => {
    const result = mapMailgunDomain({
      domain: { name: "acme.com", state: "active" },
      sending_dns_records: [],
      receiving_dns_records: [],
    });
    expect(result.name).toBe("acme.com");
    expect(result.status).toEqual({ $tag: "DomainVerified" });
  });

  it("unverified domain", () => {
    const result = mapMailgunDomain({
      domain: { name: "acme.com", state: "unverified" },
    });
    expect(result.status).toEqual({ $tag: "DomainPending" });
  });

  it("failed state with reason", () => {
    const result = mapMailgunDomain({
      domain: { name: "acme.com", state: "failed" },
    });
    expect(result.status).toMatchObject({ $tag: "DomainFailed", reason: "failed" });
  });

  it("populates inboundMxRecord when receiving records exist", () => {
    const result = mapMailgunDomain({
      domain: { name: "acme.com", state: "active" },
      receiving_dns_records: [{ record_type: "MX", value: "mxa.mailgun.org", valid: "valid" }],
    });
    expect(result.inboundMxRecord).toMatchObject({ kind: "MX", verified: true });
  });
});

// ---------------------------------------------------------------------------
// Handler-level tests with mocked fetch
// ---------------------------------------------------------------------------

describe("mailgunSend (mocked fetch)", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns Sent with the message id on 200", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "<abc123@mg.example.com>", message: "Queued" }), { status: 200 }),
    );
    const result = await mailgunSend({ email: makeEmail() }, RAW_CREDS);
    expect(result).toEqual({ $tag: "Sent", id: { $tag: "MessageId", _0: "abc123@mg.example.com" } });
  });

  it("returns Rejected on 401", async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response("nope", { status: 401 }));
    const result = await mailgunSend({ email: makeEmail() }, RAW_CREDS);
    expect(result).toMatchObject({ $tag: "Rejected", reason: { $tag: "ProviderError" } });
  });

  it("hits the EU base URL when region=eu", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "id" }), { status: 200 }),
    );
    await mailgunSend({ email: makeEmail() }, EU_CREDS);
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url.startsWith("https://api.eu.mailgun.net/v3/")).toBe(true);
  });

  it("rejects when from.domain is missing", async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response("{}", { status: 200 }));
    const email = makeEmail({ from: { local: "rom", domain: "", displayName: null } });
    const result = await mailgunSend({ email }, RAW_CREDS);
    expect(result).toMatchObject({ $tag: "Rejected", reason: { $tag: "InvalidAddress" } });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("domain handlers (mocked fetch)", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("mailgunAddDomain POSTs and maps the response", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({
        domain: { name: "acme.com", state: "unverified" },
        sending_dns_records: [],
      }), { status: 200 }),
    );
    const result = await mailgunAddDomain({ name: "acme.com" }, RAW_CREDS);
    expect(result.name).toBe("acme.com");
    expect(result.status).toEqual({ $tag: "DomainPending" });
    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://api.mailgun.net/v4/domains");
    expect(opts.method).toBe("POST");
  });

  it("mailgunVerifyDomain PUTs the verify endpoint", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ domain: { name: "acme.com", state: "active" } }), { status: 200 }),
    );
    const result = await mailgunVerifyDomain({ name: "acme.com" }, RAW_CREDS);
    expect(result.status).toEqual({ $tag: "DomainVerified" });
    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://api.mailgun.net/v4/domains/acme.com/verify");
    expect(opts.method).toBe("PUT");
  });

  it("mailgunListDomains returns all items mapped", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({
        items: [
          { name: "a.com", state: "active" },
          { name: "b.com", state: "unverified" },
        ],
      }), { status: 200 }),
    );
    const list = await mailgunListDomains({}, RAW_CREDS);
    expect(list.length).toBe(2);
    expect(list[0]!.name).toBe("a.com");
    expect(list[0]!.status).toEqual({ $tag: "DomainVerified" });
    expect(list[1]!.status).toEqual({ $tag: "DomainPending" });
  });
});
