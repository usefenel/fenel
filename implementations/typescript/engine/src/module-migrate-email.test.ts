// ---------------------------------------------------------------------------
// module-migrate-email.test.ts — module-substrate Phase 3k parity proof.
//
// email is the capability+creds REPRESENTATIVE: the first capability module
// whose FUNCTIONS + TYPES + NATIVE + CREDS + CAPABILITY + PROVIDERS are ALL
// authored Fenel-first. The ~442-LOC hand-assembled `engine/src/modules/
// email.ts` was replaced by `email.fenel` (header + 14 data decls + 5 fns) +
// `ffi/email-ffi.ts` (the regex native) + `capability.fenel` (the EmailService
// record-of-methods type → seedFromType) + `instances.fenel` (the 5 providers
// as Fenel typed values) + `credentials.fenel` (the 4 ProviderCredentials) + a
// thin seam, with NOTHING dropped.
//
// The 3 dotted capability method names (`domain.add`/`verify`/`list`) were a
// cosmetic faux-namespace — renamed to plain idents (`domainAdd`/…) across the
// capability + providers + the runtime `PROVIDER_IMPLS` map + the tests, since
// the dotted strings were internal-only (no quoted-field parser feature needed;
// the earlier Wrinkle-1 TS-const fallback was retired). This test asserts the
// Fenel-authored functions/types/native/creds AND the Fenel-authored
// capability seed + provider instances (+ the EmailService-vs-Email naming).
// ---------------------------------------------------------------------------

import { test, expect, describe } from "bun:test";
import { emailModule, emailCapabilities, emailProviders } from "./modules/email";
import { stdModule } from "./modules/std";
import { timeModule } from "./modules/time";
import { createRegistry } from "./registry";
import { invokeCallable } from "./json-logic";
import type { Instance } from "./types";

// --- Snapshot of the retired defineFunction identity (the parity baseline) ---
// All 5 functions carried rich `defineFunction` identity (codeName + label +
// description + category="email" + tags). The `module email where` header
// supplies the `email` category at READ time (Phase 3j — no stored
// Categorizable); @label/@description/@tags reproduce the rest. `native: true`
// == the function is the `parseAddress` ffi foreign declaration; `native:
// false` == a Fenel-bodied function (4: address / formatAddress / bodyText /
// bodyHtml).
type Expected = { label: string; tags: string[]; description: string; native: boolean };
const RICH: Record<string, Expected> = {
  address: {
    label: "Address",
    tags: ["email", "constructor"],
    description: "Build an Address record. displayName is optional (pass Nothing to omit).",
    native: false,
  },
  parseAddress: {
    label: "Parse address",
    tags: ["email", "parser"],
    description:
      'Parse an RFC 5322 address string. Accepts "local@domain" and "Display <local@domain>" forms.',
    native: true,
  },
  formatAddress: {
    label: "Format address",
    tags: ["email", "format"],
    description: "Format an Address as an RFC 5322 string.",
    native: false,
  },
  bodyText: {
    label: "Body text",
    tags: ["email", "accessor"],
    description: "Extract the text portion of a Body. Nothing if the Body is Html-only.",
    native: false,
  },
  bodyHtml: {
    label: "Body HTML",
    tags: ["email", "accessor"],
    description: "Extract the HTML portion of a Body. Nothing if the Body is Text-only.",
    native: false,
  },
  // action-subsumption Phase N (2026-06-10) — the send_email action port. The
  // 2 rich-facet additions: `sendEmail` (the public action body) + `providerSend`
  // (the bodyless foreign-decl HTTP send leaf). The orchestration helpers ride
  // along as BARE functions (no identity facets, like notify/tg-dm's helpers) —
  // see BARE_NAMES below.
  sendEmail: {
    label: "Send email",
    tags: ["email", "send", "action", "phase-N"],
    description:
      "action-subsumption Phase N (2026-06-10) — the public send_email action, now a typed Fenel function (the last legacy registerAction handler retired). Emits email_queued, resolves the profile (no email → ActionOk delivered=False), looks up the email_template by slug, builds the typed Email (interpolating {{vars}} from include), picks the account's configured provider (state:listIntegrations, mailgun>postmark>ses>resend priority, else the fenel managed default), sends via email:providerSend, and maps the SendResult to ActionOk.",
    native: false,
  },
  providerSend: {
    label: "Provider send",
    tags: ["email", "io", "send"],
    description:
      "Send a typed Email through the named provider (mailgun / postmark / ses / resend / fenel). The runtime leaf re-fetches that provider's per-account integration credentials and calls the existing provider impl; the fenel managed default uses Fenel's master credentials. Returns the typed SendResult.",
    native: true,
  },
};

// Bare orchestration helpers from the Phase-N send_email port — registered
// functions (so they appear in the id roster) but carrying NO identity facets,
// exactly like notify/tg-dm's helpers. They are NOT in RICH (no facet checks).
const BARE_NAMES = [
  "interpolate",
  "buildEmail",
  "hasEnabledProvider",
  "pickProvider",
  "emailNotDelivered",
  "messageIdValue",
  "emailResultToAction",
  "deliverToAddress",
  "deliverToProfile",
];

const ALL_NAMES = Object.keys(RICH);
// `providerSend` is a bodyless foreign decl BUT (unlike parseAddress) its impl
// is a runtime IO handler (email.provider_send), NOT an engine ffi native — so
// it is bodyless yet absent from emailModule.nativeImpls.
const NATIVE_IMPL_NAMES = ["parseAddress"];
const ids = [...ALL_NAMES, ...BARE_NAMES].map((n) => `email:${n}`);
const NATIVE_NAMES = ALL_NAMES.filter((n) => RICH[n]!.native);
const BODIED_NAMES = ALL_NAMES.filter((n) => !RICH[n]!.native);

const ENTITY_IDS = [
  "Address", "Body", "AssetRef", "Attachment", "Header", "Email",
  "MessageId", "SendError", "SendResult", "BounceKind", "EmailEvent",
  "DnsRecord", "DomainStatus", "SendingDomain",
];

function methodOf(insts: Instance[], typeName: string, id: string): Record<string, unknown> | undefined {
  return insts.find((i) => i.typeName === typeName && i.args[0] === id)?.methods;
}

describe("email migration — header-driven identity + consolidation", () => {
  test("the `module email where` header is authoritative (lowercase prefix preserved)", () => {
    expect(emailModule.name).toBe("email");
  });

  test("all functions registered under the legacy `email:` id-prefix (5 migrated + the Phase-N send_email port)", () => {
    expect((emailModule.functions ?? []).map((f) => f.id).sort()).toEqual([...ids].sort());
  });

  test("all 14 data entities ride along from the consolidated `.fenel`", () => {
    expect((emailModule.entities ?? []).map((e) => e.id).sort()).toEqual([...ENTITY_IDS].sort());
  });

  test("module label preserved", () => {
    expect(JSON.stringify(emailModule.label)).toContain("Email");
  });
});

describe("email migration — the `ffi/` split (foreign declaration + native map)", () => {
  test("the BODYLESS foreign declarations are `parseAddress` + `providerSend`", () => {
    const bodyless = (emailModule.functions ?? []).filter((f) => !f.body).map((f) => f.id).sort();
    expect(bodyless).toEqual(NATIVE_NAMES.map((n) => `email:${n}`).sort());
  });

  test("every Fenel-bodied rich function carries its `.fenel` body", () => {
    for (const n of BODIED_NAMES) {
      const f = (emailModule.functions ?? []).find((f) => f.id === `email:${n}`);
      expect(f?.body, `${n} should have a body`).toBeDefined();
    }
  });

  test("nativeImpls (the ffi/ leaf map) is rekeyed to the `email:` id-namespace, one ffi native (parseAddress; providerSend is a runtime IO handler, not an ffi native)", () => {
    expect(Object.keys(emailModule.nativeImpls ?? {}).sort()).toEqual(
      NATIVE_IMPL_NAMES.map((n) => `email:${n}`).sort(),
    );
  });

  test("no nativeImplsCtx / ioHandlers (plain-nativeImpls + creds module)", () => {
    expect(emailModule.nativeImplsCtx).toBeUndefined();
    expect(emailModule.ioHandlers).toBeUndefined();
  });
});

describe("email migration — creds-as-data (the credentials.fenel sidecar)", () => {
  test("credentialRequirements round-trips byte-identically from the `.fenel` values", () => {
    expect(emailModule.credentialRequirements).toEqual([
      { capability: "EmailService", provider: "mailgun", envVars: ["MAILGUN_API_KEY", "MAILGUN_REGION"] },
      { capability: "EmailService", provider: "postmark", envVars: ["POSTMARK_SERVER_TOKEN"] },
      { capability: "EmailService", provider: "ses", envVars: ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] },
      { capability: "EmailService", provider: "resend", envVars: ["RESEND_API_KEY"] },
    ]);
  });

  test("the creds value-decls do NOT leak into emailModule.instances (no registry/law footprint)", () => {
    const insts = emailModule.instances ?? [];
    expect(insts.some((i) => i.typeName === "ProviderCredentials")).toBe(false);
  });
});

describe("email migration — identity-facet parity (directives → ClassInstances)", () => {
  const insts = emailModule.instances ?? [];

  test("Codeable: codeName is the unprefixed name for every function", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Codeable", `email:${n}`)).toEqual({ codeName: n });
    }
  });

  // Phase 3j (identity-as-fallback): email declares no @category, so NONE carry
  // a stored Categorizable — the `email` category derives at read time
  // (displayCategory → the id's `email:` module-prefix).
  test("Categorizable: NONE stored — email declares no @category (category derives at read time)", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Categorizable", `email:${n}`)).toBeUndefined();
    }
  });

  test("Labelable: explicit @label preserved for all 5 functions", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Labelable", `email:${n}`)).toEqual({ label: RICH[n]!.label });
    }
  });

  test("Describable + Taggable: present & byte-identical for all 5 functions", () => {
    for (const n of ALL_NAMES) {
      expect(methodOf(insts, "Describable", `email:${n}`)).toEqual({ description: RICH[n]!.description });
      expect(methodOf(insts, "Taggable", `email:${n}`)).toEqual({ tags: RICH[n]!.tags });
    }
  });
});

describe("email migration — registry resolution + body execution", () => {
  const reg = createRegistry([stdModule, timeModule, emailModule]);

  test("every function resolves by id and by codeName through createRegistry", () => {
    for (const n of ALL_NAMES) {
      expect(reg.getFunction(`email:${n}`), `${n} by id`).toBeDefined();
      expect(reg.getFunctionByCodeName(n), `${n} by codeName`).toBeDefined();
    }
  });

  test("the parseAddress native resolves through the rekeyed nativeImpls", () => {
    expect((emailModule.nativeImpls ?? {})["email:parseAddress"]).toBeTypeOf("function");
  });
});

describe("email migration — Fenel-authored capability + providers", () => {
  test("the EmailService capability seed (seedFromType over capability.fenel) has the 6 plain-ident methods", () => {
    expect(emailCapabilities).toHaveLength(1);
    expect(emailCapabilities[0]!.name).toBe("EmailService");
    expect(emailCapabilities[0]!.methods.map((m) => m.name)).toEqual([
      "send", "send_batch", "suppress", "domainAdd", "domainVerify", "domainList",
    ]);
  });

  test("the 5 providers (projected from instances.fenel) carry priority order + fnId-string methods", () => {
    expect(emailProviders.map((p) => p.args[0])).toEqual(["fenel", "mailgun", "postmark", "ses", "resend"]);
    expect(emailProviders.every((p) => p.typeName === "EmailService")).toBe(true);
    const fenel = emailProviders.find((p) => p.args[0] === "fenel")!;
    expect(fenel.priority).toBe(100);
    // methods are fnId strings (codec model); `priority` is lifted out, not a method key.
    expect(Object.keys(fenel.methods)).toEqual([
      "send", "send_batch", "suppress", "domainAdd", "domainVerify", "domainList",
    ]);
    expect(fenel.methods.domainAdd).toBe("EmailService.fenel.domainAdd");
  });

  test("EmailService-vs-Email naming subtlety holds: capability is EmailService, data Email has no class", () => {
    const reg = createRegistry([stdModule, timeModule, emailModule]);
    expect(reg.getCapability("EmailService")).toBeTruthy();
    // `getClass("Email")` must stay undefined so the data `Email` routes to the
    // catalog "entity" section, not "spec" (Phase 3.4b).
    expect(reg.getCapability("Email")).toBeUndefined();
    expect(reg.getEntity("Email")).toBeTruthy();
  });

  test("resolveCapabilityMethod resolves a domain method (renamed plain ident); spec is the fnId string", () => {
    const reg = createRegistry([stdModule, timeModule, emailModule]);
    const resolved = reg.resolveCapabilityMethod("EmailService.domainAdd");
    expect(resolved?.provider.args[0]).toBe("fenel");
    expect(resolved?.spec).toBe("EmailService.fenel.domainAdd");
  });
});

// ---------------------------------------------------------------------------
// action-subsumption Phase N (2026-06-10) — the send_email port: the pure arms
// of `email:sendEmail` exercised through the registry (invokeCallable, no DB).
// The IO arms (appendEvent / profile lookup / template lookup / providerSend)
// are the prod-proven leaves; the in-process proof here pins the composable
// logic that moved out of the retired TS handler.
// ---------------------------------------------------------------------------
describe("email migration — Phase-N send_email port (pure-arm behavior)", () => {
  const reg = createRegistry([stdModule, timeModule, emailModule]);
  const ctx = reg.evaluateContext();

  test("interpolate substitutes known {{vars}} from the include map", () => {
    expect(invokeCallable("email:interpolate", ["Hi {{name}}", { name: "Alice" }], ctx)).toBe("Hi Alice");
  });

  test("interpolate leaves UNKNOWN placeholders literal (the documented no-regex divergence from TS strip-to-empty)", () => {
    expect(invokeCallable("email:interpolate", ["Hi {{name}} {{missing}}", { name: "Alice" }], ctx)).toBe(
      "Hi Alice {{missing}}",
    );
  });

  test("pickProvider honors mailgun>postmark>ses>resend priority over enabled integrations, else fenel", () => {
    expect(invokeCallable("email:pickProvider", [[]], ctx)).toBe("fenel");
    expect(invokeCallable("email:pickProvider", [[{ type: "postmark", enabled: true }]], ctx)).toBe("postmark");
    // a disabled higher-priority integration is skipped
    expect(
      invokeCallable("email:pickProvider", [[{ type: "mailgun", enabled: false }, { type: "postmark", enabled: true }]], ctx),
    ).toBe("postmark");
    // both enabled → the higher-priority one wins
    expect(
      invokeCallable("email:pickProvider", [[{ type: "mailgun", enabled: true }, { type: "postmark", enabled: true }]], ctx),
    ).toBe("mailgun");
  });

  test("emailNotDelivered produces the ActionOk delivered=False shape with profileId provenance", () => {
    const r = invokeCallable("email:emailNotDelivered", ["p1", "welcome", "profile has no email"], ctx) as {
      $tag: string;
      data: Record<string, unknown>;
      profileId: unknown;
      aggregateType: unknown;
    };
    expect(r.$tag).toBe("ActionOk");
    expect(r.data).toEqual({ profileId: "p1", template: "welcome", delivered: false, reason: "profile has no email" });
    expect(r.profileId).toEqual({ $tag: "Just", _0: "p1" });
    expect(r.aggregateType).toEqual({ $tag: "Nothing" });
  });

  test("emailResultToAction maps Sent → delivered=True + messageId, Rejected → delivered=False", () => {
    const sent = invokeCallable(
      "email:emailResultToAction",
      ["p1", "welcome", { $tag: "Sent", id: { $tag: "MessageId", _0: "m1" } }],
      ctx,
    ) as { data: Record<string, unknown> };
    expect(sent.data).toEqual({ profileId: "p1", template: "welcome", delivered: true, messageId: "m1" });

    const rejected = invokeCallable(
      "email:emailResultToAction",
      ["p1", "welcome", { $tag: "Rejected", reason: { $tag: "ProviderError", code: "x", message: "boom" } }],
      ctx,
    ) as { data: Record<string, unknown> };
    expect(rejected.data).toEqual({ profileId: "p1", template: "welcome", delivered: false });
  });

  test("the public sendEmail + the providerSend leaf resolve in the registry", () => {
    expect(reg.getFunction("email:sendEmail")).toBeDefined();
    expect(reg.getFunction("email:providerSend")).toBeDefined();
    expect(reg.getFunctionByCodeName("sendEmail")).toBeDefined();
  });
});
