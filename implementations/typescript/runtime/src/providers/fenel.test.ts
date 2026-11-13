import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the rate-limit DB call so unit tests don't need a live database.
// We expose the mock and let individual tests set its return value to
// simulate over-quota scenarios.
vi.mock("@fenel/db", () => ({
  incrementFenelEmailCount: vi.fn().mockResolvedValue(1),
}));

import { incrementFenelEmailCount } from "@fenel/db";
import { fenelSend, fenelListDomains, fenelAddDomain } from "./fenel";
import type { EmailValue, AddressValue, BodyValue } from "./mailgun";

function addr(local: string, domain: string, displayName: string | null = null): AddressValue {
  return { local, domain, displayName };
}

function makeEmail(overrides: Partial<EmailValue> = {}): EmailValue {
  return {
    from: addr("noreply", "customer-domain.com", "Customer"),
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

const ACCOUNT_CREDS = { __ACCOUNT_ID: "acct-abc" };

describe("fenelSend", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
    process.env.FENEL_MAILGUN_KEY = "master-key";
    process.env.FENEL_MAILGUN_DOMAIN = "send.usefenel.com";
    process.env.FENEL_MAILGUN_REGION = "us";
    // Default: under quota (count = 1).
    (incrementFenelEmailCount as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  });
  afterEach(() => {
    delete process.env.FENEL_MAILGUN_KEY;
    delete process.env.FENEL_MAILGUN_DOMAIN;
    delete process.env.FENEL_MAILGUN_REGION;
    delete process.env.FENEL_MANAGED_HOURLY_LIMIT;
    vi.clearAllMocks();
  });

  it("rejects with a config error when FENEL_MAILGUN_KEY is unset", async () => {
    delete process.env.FENEL_MAILGUN_KEY;
    const result = await fenelSend({ email: makeEmail() }, ACCOUNT_CREDS);
    expect(result).toMatchObject({
      $tag: "Rejected",
      reason: { $tag: "ProviderError", code: "config" },
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("forwards through Mailgun under master credentials", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "<mid@send.usefenel.com>" }), { status: 200 }),
    );
    const result = await fenelSend({ email: makeEmail() }, ACCOUNT_CREDS);
    expect(result).toMatchObject({ $tag: "Sent" });

    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    // URL uses the managed domain, NOT the customer's customer-domain.com
    expect(url).toContain("/v3/send.usefenel.com/messages");
    // Auth uses master key
    expect(opts.headers.Authorization).toBe(`Basic ${btoa("api:master-key")}`);
  });

  it("rewrites the from address to the managed domain", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "<id>" }), { status: 200 }),
    );
    await fenelSend({ email: makeEmail() }, ACCOUNT_CREDS);
    const formData = (globalThis.fetch as any).mock.calls[0][1].body as FormData;
    expect(formData.get("from")).toBe('"Customer" <noreply@send.usefenel.com>');
  });

  it("preserves the customer's address as Reply-To when none is set", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "<id>" }), { status: 200 }),
    );
    await fenelSend({ email: makeEmail() }, ACCOUNT_CREDS);
    const formData = (globalThis.fetch as any).mock.calls[0][1].body as FormData;
    expect(formData.get("h:Reply-To")).toBe('"Customer" <noreply@customer-domain.com>');
  });

  it("tags every send with X-Fenel-Account header", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "<id>" }), { status: 200 }),
    );
    await fenelSend({ email: makeEmail() }, ACCOUNT_CREDS);
    const formData = (globalThis.fetch as any).mock.calls[0][1].body as FormData;
    expect(formData.get("h:X-Fenel-Account")).toBe("acct-abc");
  });

  it("falls back to 'unknown' when __ACCOUNT_ID is missing", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "<id>" }), { status: 200 }),
    );
    await fenelSend({ email: makeEmail() }, {});
    const formData = (globalThis.fetch as any).mock.calls[0][1].body as FormData;
    expect(formData.get("h:X-Fenel-Account")).toBe("unknown");
  });

  it("rejects with RateLimited when over the hourly quota", async () => {
    process.env.FENEL_MANAGED_HOURLY_LIMIT = "10";
    (incrementFenelEmailCount as ReturnType<typeof vi.fn>).mockResolvedValue(11);
    const result = await fenelSend({ email: makeEmail() }, ACCOUNT_CREDS);
    expect(result).toMatchObject({
      $tag: "Rejected",
      reason: { $tag: "RateLimited" },
    });
    // Retry-after should be at least 60s and at most 1h.
    if (result.$tag === "Rejected" && result.reason.$tag === "RateLimited") {
      expect(result.reason._0).toBeGreaterThanOrEqual(60);
      expect(result.reason._0).toBeLessThanOrEqual(3600);
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not consult quota when account is unknown", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "<id>" }), { status: 200 }),
    );
    await fenelSend({ email: makeEmail() }, {});
    expect(incrementFenelEmailCount).not.toHaveBeenCalled();
  });

  it("uses default 100/hour limit when FENEL_MANAGED_HOURLY_LIMIT is unset", async () => {
    (incrementFenelEmailCount as ReturnType<typeof vi.fn>).mockResolvedValue(101);
    const result = await fenelSend({ email: makeEmail() }, ACCOUNT_CREDS);
    expect(result).toMatchObject({ $tag: "Rejected", reason: { $tag: "RateLimited" } });
  });
});

describe("fenelListDomains", () => {
  beforeEach(() => {
    process.env.FENEL_MAILGUN_KEY = "master-key";
    process.env.FENEL_MAILGUN_DOMAIN = "send.usefenel.com";
  });
  afterEach(() => {
    delete process.env.FENEL_MAILGUN_KEY;
    delete process.env.FENEL_MAILGUN_DOMAIN;
  });

  it("returns the single managed domain as Verified", async () => {
    const result = await fenelListDomains({}, {});
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "send.usefenel.com",
      status: { $tag: "DomainVerified" },
    });
  });

  it("returns empty when not configured", async () => {
    delete process.env.FENEL_MAILGUN_KEY;
    const result = await fenelListDomains({}, {});
    expect(result).toEqual([]);
  });
});

describe("fenelAddDomain", () => {
  it("returns a DomainFailed status with a hint to switch providers", async () => {
    const result = await fenelAddDomain({ name: "acme.com" }, {});
    expect(result.name).toBe("acme.com");
    expect(result.status).toMatchObject({
      $tag: "DomainFailed",
      reason: expect.stringContaining("BYO provider"),
    });
  });
});
