import { describe, it, expect } from "vitest";
import { evaluate } from "../json-logic";
import { createRegistry } from "../registry";
import { stdModule } from "./std";
import { timeModule } from "./time";
import { emailModule } from "./email";
import { Maybe, Nothing } from "../type-foundation";
const reg = createRegistry([stdModule, timeModule, emailModule]);
const ctx = reg.evaluateContext();

function call(name: string, ...args: unknown[]): unknown {
  return evaluate({ call: [name, ...args] }, {}, ctx);
}

describe("email module — entity registration", () => {
  it("registers Address as a record", () => {
    const ent = reg.getEntity("Address");
    expect(ent?.type).toMatchObject({
      $record: {
        fields: [
          { name: "local", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "domain", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "displayName", label: Nothing, type: Maybe({ $ref: "String" }), meta: {}, ui: Nothing },
        ],
      },
    });
  });

  it("registers Body as a variant with three cases", () => {
    const ent = reg.getEntity("Body");
    const cases = (ent!.type as any)?.$variant?.cases;
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.map((c: any) => c.name)).toEqual(["Text", "Html", "Multipart"]);
  });

  it("registers Email as a record with all 11 fields", () => {
    const ent = reg.getEntity("Email");
    const fields = (ent!.type as any)?.$record?.fields;
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.map((f: any) => f.name)).toEqual([
      "from", "to", "cc", "bcc", "replyTo",
      "subject", "body", "attachments", "headers",
      "inReplyTo", "references",
    ]);
  });

  it("registers AssetRef as a record (url + name + mimeType)", () => {
    const ent = reg.getEntity("AssetRef");
    expect(ent?.type).toMatchObject({
      $record: {
        fields: [
          { name: "url", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "name", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
          { name: "mimeType", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
        ],
      },
    });
  });

  it("Attachment carries an AssetRef, not a raw URL string", () => {
    const ent = reg.getEntity("Attachment");
    const fields = (ent!.type as any).$record.fields;
    const assetField = fields.find((f: any) => f.name === "asset");
    expect(assetField.type).toEqual({ $ref: "AssetRef" });
  });

  it("registers MessageId as a single-case variant", () => {
    const ent = reg.getEntity("MessageId");
    expect(ent?.type).toMatchObject({
      $variant: { cases: [{ name: "MessageId", label: Nothing, fields: [{ name: "_0" }] }] },
    });
  });

  it("registers SendResult as a variant with Sent | Rejected", () => {
    const ent = reg.getEntity("SendResult");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual(["Sent", "Rejected"]);
  });

  it("registers SendError with five constructors", () => {
    const ent = reg.getEntity("SendError");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual([
      "InvalidAddress", "DomainNotVerified", "RateLimited",
      "Suppressed", "ProviderError",
    ]);
  });

  it("registers BounceKind with three cases", () => {
    const ent = reg.getEntity("BounceKind");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual(["HardBounce", "SoftBounce", "BlockBounce"]);
  });

  it("registers EmailEvent with all eight lifecycle constructors", () => {
    const ent = reg.getEntity("EmailEvent");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual([
      "Queued", "Delivered", "Bounced", "Complained",
      "Opened", "Clicked", "Unsubscribed", "Failed",
    ]);
  });

  it("registers DomainStatus with three cases", () => {
    const ent = reg.getEntity("DomainStatus");
    const cases = (ent!.type as any).$variant.cases.map((c: any) => c.name);
    expect(cases).toEqual(["DomainPending", "DomainVerified", "DomainFailed"]);
  });

  it("registers SendingDomain as a record with six fields", () => {
    const ent = reg.getEntity("SendingDomain");
    const fields = (ent!.type as any).$record.fields.map((f: any) => f.name);
    expect(fields).toEqual([
      "name", "status", "dkimRecords", "spfRecord",
      "returnPathRecord", "inboundMxRecord",
    ]);
  });
});

describe("email module — capability registration", () => {
  it("registers the email capability with all six methods", () => {
    const cap = reg.getCapability("EmailService");
    expect(cap).toBeTruthy();
    const methods = cap!.methods.map((m) => m.name);
    expect(methods).toEqual([
      "send", "send_batch", "suppress",
      "domainAdd", "domainVerify", "domainList",
    ]);
  });

  it("registers five providers in priority order", () => {
    const provs = reg.listProviders("EmailService");
    expect(provs.map((p) => p.args[0])).toEqual([
      "fenel", "mailgun", "postmark", "ses", "resend",
    ]);
  });

  it("the highest-priority provider is fenel", () => {
    const top = reg.getProvider("EmailService");
    expect(top?.args[0]).toBe("fenel");
  });

  it("each provider exposes all six methods with prefixed function ids", () => {
    for (const provName of ["fenel", "mailgun", "postmark", "ses", "resend"]) {
      const prov = reg.getProvider("EmailService", provName);
      expect(prov).toBeTruthy();
      const methodKeys = Object.keys(prov!.methods);
      expect(methodKeys).toEqual([
        "send", "send_batch", "suppress",
        "domainAdd", "domainVerify", "domainList",
      ]);
      // Provider methods are now fnId STRINGS (the qualified dispatch name) —
      // the codec instance model, authored in `instances.fenel`.
      expect(prov!.methods.send).toBe(`EmailService.${provName}.send`);
    }
  });

  it("resolveCapabilityMethod resolves a domain method (plain-ident name)", () => {
    const resolved = reg.resolveCapabilityMethod("EmailService.domainAdd");
    expect(resolved?.provider.args[0]).toBe("fenel");
    // spec is the fnId string (the qualified dispatch name), not a record.
    expect(resolved?.spec).toBe("EmailService.fenel.domainAdd");
  });

  it("resolveCapabilityMethod resolves simple method names", () => {
    const resolved = reg.resolveCapabilityMethod("EmailService.send");
    expect(resolved?.provider.args[0]).toBe("fenel");
  });
});

describe("email module — natives", () => {
  it("address constructs an Address record", () => {
    // address Fenel body is `Address { local, domain, displayName }` —
    // it stores displayName as-passed, no Maybe wrap, since the body
    // doesn't pattern-match on it. Tests pass raw null and read it
    // back; parseAddress is the codec that wraps for Fenel-side
    // consumption.
    expect(call("address", "rom", "usefenel.com", null)).toEqual({
      $tag: "Address",
      local: "rom",
      domain: "usefenel.com",
      displayName: null,
    });
  });

  it("address with displayName", () => {
    expect(call("address", "rom", "usefenel.com", "Romain")).toEqual({
      $tag: "Address",
      local: "rom",
      domain: "usefenel.com",
      displayName: "Romain",
    });
  });

  // parseAddress / bodyText / bodyHtml are all declared `returns: Maybe …`.
  // The Fenel-callable view wraps results in `{$tag: "Just"|"Nothing"}`;
  // host-language null only lives in the TS-internal `*Native` helpers
  // exposed for runtime handlers.
  it("parseAddress handles bare addresses", () => {
    expect(call("parseAddress", "rom@usefenel.com")).toEqual({
      $tag: "Just",
      _0: { local: "rom", domain: "usefenel.com", displayName: { $tag: "Nothing" } },
    });
  });

  it("parseAddress handles RFC 5322 form", () => {
    expect(call("parseAddress", "Romain <rom@usefenel.com>")).toEqual({
      $tag: "Just",
      _0: { local: "rom", domain: "usefenel.com", displayName: { $tag: "Just", _0: "Romain" } },
    });
  });

  it("parseAddress handles quoted display names", () => {
    expect(call("parseAddress", '"Romain L." <rom@usefenel.com>')).toEqual({
      $tag: "Just",
      _0: { local: "rom", domain: "usefenel.com", displayName: { $tag: "Just", _0: "Romain L." } },
    });
  });

  it("parseAddress is Nothing for garbage", () => {
    expect(call("parseAddress", "not an email")).toEqual({ $tag: "Nothing" });
  });

  it("formatAddress round-trips with parseAddress for bare", () => {
    const r = call("parseAddress", "rom@usefenel.com") as {
      $tag: "Just";
      _0: unknown;
    };
    expect(r.$tag).toBe("Just");
    expect(call("formatAddress", r._0)).toBe("rom@usefenel.com");
  });

  it("formatAddress round-trips with parseAddress for RFC 5322", () => {
    const r = call("parseAddress", "Romain <rom@usefenel.com>") as {
      $tag: "Just";
      _0: unknown;
    };
    expect(r.$tag).toBe("Just");
    expect(call("formatAddress", r._0)).toBe('"Romain" <rom@usefenel.com>');
  });

  it("bodyText extracts text from a Text body", () => {
    const b = { $tag: "Text", _0: "hello" };
    expect(call("bodyText", b)).toEqual({ $tag: "Just", _0: "hello" });
  });

  it("bodyText extracts text from a Multipart body", () => {
    const b = { $tag: "Multipart", text: "hello", html: "<p>hello</p>" };
    expect(call("bodyText", b)).toEqual({ $tag: "Just", _0: "hello" });
  });

  it("bodyText is Nothing for an Html body", () => {
    const b = { $tag: "Html", _0: "<p>hi</p>" };
    expect(call("bodyText", b)).toEqual({ $tag: "Nothing" });
  });

  it("bodyHtml extracts html from an Html body", () => {
    const b = { $tag: "Html", _0: "<p>hi</p>" };
    expect(call("bodyHtml", b)).toEqual({ $tag: "Just", _0: "<p>hi</p>" });
  });

  it("bodyHtml extracts html from a Multipart body", () => {
    const b = { $tag: "Multipart", text: "hello", html: "<p>hello</p>" };
    expect(call("bodyHtml", b)).toEqual({ $tag: "Just", _0: "<p>hello</p>" });
  });

  it("bodyHtml is Nothing for a Text body", () => {
    const b = { $tag: "Text", _0: "hello" };
    expect(call("bodyHtml", b)).toEqual({ $tag: "Nothing" });
  });
});
