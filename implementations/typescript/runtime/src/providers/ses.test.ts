import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { sesSend, sesAddDomain, sesVerifyDomain, sesListDomains } from "./ses";
import * as mime from "./mime";
import type { EmailValue, AddressValue, BodyValue } from "./mailgun";

const CREDS = {
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "AKIA-test",
  AWS_SECRET_ACCESS_KEY: "secret-test",
};

afterEach(() => { vi.restoreAllMocks(); });

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

function mockSesSend(impl: (cmd: any) => any) {
  return vi.spyOn(SESv2Client.prototype, "send").mockImplementation(impl as any);
}

describe("sesSend", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns Sent on success", async () => {
    mockSesSend(() => Promise.resolve({ MessageId: "ses-msg-1" }));
    const result = await sesSend({ email: makeEmail() }, CREDS);
    expect(result).toEqual({ $tag: "Sent", id: { $tag: "MessageId", _0: "ses-msg-1" } });
  });

  it("rejects when from-domain is missing", async () => {
    const result = await sesSend(
      { email: makeEmail({ from: { local: "rom", domain: "", displayName: null } }) },
      CREDS,
    );
    expect(result).toMatchObject({ $tag: "Rejected", reason: { $tag: "InvalidAddress" } });
  });

  it("uses Raw MIME content when attachments are present", async () => {
    // MIME rendering has its own suite. Keep this provider adapter test at
    // that boundary: its Fenel engine uses Bun's native TypeScript require.
    const raw = new TextEncoder().encode("MIME-Version: 1.0\r\n\r\nattachment fixture");
    const buildMime = vi.spyOn(mime, "buildMime").mockReturnValue(raw);
    // Mock fetch for the attachment URL.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    let capturedInput: any;
    mockSesSend((cmd: any) => {
      capturedInput = cmd.input;
      return Promise.resolve({ MessageId: "raw-id" });
    });
    const email = makeEmail({ attachments: [{ asset: { url: "https://example.com/doc.pdf", name: "doc.pdf", mimeType: "application/pdf" }, contentId: null }] });
    const result = await sesSend({ email }, CREDS);
    expect(result).toEqual({ $tag: "Sent", id: { $tag: "MessageId", _0: "raw-id" } });
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith("https://example.com/doc.pdf");
    expect(buildMime).toHaveBeenCalledExactlyOnceWith(email, [{
      filename: "doc.pdf",
      contentType: "application/pdf",
      contentId: null,
      bytes: new Uint8Array([1, 2, 3, 4]),
    }]);
    expect(capturedInput.Content?.Raw?.Data).toBe(raw);
    expect(capturedInput.Content?.Simple).toBeUndefined();
  });

  it("maps MessageRejected → DomainNotVerified", async () => {
    mockSesSend(() => Promise.reject(Object.assign(new Error("not verified"), { name: "MessageRejected" })));
    const result = await sesSend({ email: makeEmail() }, CREDS);
    expect(result).toMatchObject({ $tag: "Rejected", reason: { $tag: "DomainNotVerified" } });
  });

  it("maps TooManyRequestsException → RateLimited", async () => {
    mockSesSend(() => Promise.reject(Object.assign(new Error("slow down"), { name: "TooManyRequestsException" })));
    const result = await sesSend({ email: makeEmail() }, CREDS);
    expect(result).toMatchObject({ $tag: "Rejected", reason: { $tag: "RateLimited" } });
  });

  it("uses Simple content with subject + text body", async () => {
    let capturedInput: any;
    mockSesSend((cmd: any) => {
      capturedInput = cmd.input;
      return Promise.resolve({ MessageId: "id" });
    });
    await sesSend({ email: makeEmail() }, CREDS);
    expect(capturedInput.Content?.Simple?.Subject?.Data).toBe("Hello");
    expect(capturedInput.Content?.Simple?.Body?.Text?.Data).toBe("hi");
    expect(capturedInput.FromEmailAddress).toBe("rom@usefenel.com");
    expect(capturedInput.Destination?.ToAddresses).toEqual(["alice@example.com"]);
  });
});

describe("sesAddDomain", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns SendingDomain with DKIM tokens", async () => {
    mockSesSend(() => Promise.resolve({
      DkimAttributes: {
        Status: "PENDING",
        Tokens: ["tok1", "tok2", "tok3"],
      },
    }));
    const result = await sesAddDomain({ name: "acme.com" }, CREDS);
    expect(result.name).toBe("acme.com");
    expect(result.status).toEqual({ $tag: "DomainPending" });
    expect(result.dkimRecords).toHaveLength(3);
    expect(result.dkimRecords[0]).toEqual({
      kind: "CNAME",
      host: "tok1._domainkey.acme.com",
      value: "tok1.dkim.amazonses.com",
      verified: false,
    });
  });

  it("falls back to verify on AlreadyExistsException", async () => {
    let callCount = 0;
    mockSesSend(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(Object.assign(new Error("exists"), { name: "AlreadyExistsException" }));
      }
      return Promise.resolve({
        DkimAttributes: { Status: "SUCCESS", Tokens: ["t1"] },
        VerifiedForSendingStatus: true,
      });
    });
    const result = await sesAddDomain({ name: "acme.com" }, CREDS);
    expect(result.status).toEqual({ $tag: "DomainVerified" });
    expect(callCount).toBe(2);
  });
});

describe("sesVerifyDomain", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns DomainVerified when DKIM SUCCESS and sending enabled", async () => {
    mockSesSend(() => Promise.resolve({
      DkimAttributes: { Status: "SUCCESS", Tokens: ["t"] },
      VerifiedForSendingStatus: true,
    }));
    const result = await sesVerifyDomain({ name: "acme.com" }, CREDS);
    expect(result.status).toEqual({ $tag: "DomainVerified" });
  });

  it("returns DomainFailed on DKIM FAILED", async () => {
    mockSesSend(() => Promise.resolve({
      DkimAttributes: { Status: "FAILED", Tokens: [] },
      VerifiedForSendingStatus: false,
    }));
    const result = await sesVerifyDomain({ name: "acme.com" }, CREDS);
    expect(result.status).toMatchObject({ $tag: "DomainFailed" });
  });
});

describe("sesListDomains", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("filters to DOMAIN identities and maps verification state", async () => {
    mockSesSend(() => Promise.resolve({
      EmailIdentities: [
        { IdentityName: "verified.com", IdentityType: "DOMAIN", SendingEnabled: true },
        { IdentityName: "pending.com", IdentityType: "DOMAIN", SendingEnabled: false },
        { IdentityName: "rom@x.com", IdentityType: "EMAIL_ADDRESS", SendingEnabled: true },
      ],
    }));
    const result = await sesListDomains({}, CREDS);
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.name)).toEqual(["verified.com", "pending.com"]);
    expect(result[0]!.status).toEqual({ $tag: "DomainVerified" });
    expect(result[1]!.status).toEqual({ $tag: "DomainPending" });
  });

  it("returns empty on error", async () => {
    mockSesSend(() => Promise.reject(new Error("network")));
    const result = await sesListDomains({}, CREDS);
    expect(result).toEqual([]);
  });
});
