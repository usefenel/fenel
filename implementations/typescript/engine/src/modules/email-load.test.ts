// ---------------------------------------------------------------------------
// email-load.test.ts — conformance test for the email module entity flip
// + Phase 5b1 pure-helper port (address / formatAddress to Fenel bodies).
//
// Phase 5a extracted the inline `EMAIL_SRC` template literal at
// engine/src/modules/email.ts (40 LOC, 14 entities, 0 inline user-Fenel
// functions) into a real `.fenel` file at
// `fenel/modules/email/types.fenel`. The inline pattern-match-only
// `bodyText` / `bodyHtml` accessors landed alongside in their separate
// body files (body-text.fenel / body-html.fenel).
//
// Phase 5b1 ports the 2 remaining pure TS natives (`addressNative` /
// `formatAddressNative`) to dedicated `.fenel` bodies (address.fenel /
// format-address.fenel) and drops the natives. `parseAddressNative`
// stays TS — regex-bound, awaits Phase 6.
//
// Each assertion covers one tier of the recipe:
//
//   1. 14-entity roster lock — Address / Body / AssetRef / Attachment /
//      Header / Email / MessageId / SendError / SendResult / BounceKind /
//      EmailEvent / DnsRecord / DomainStatus / SendingDomain.
//   2. Email 11-field record-shape spot-check — confirms single-line
//      record parsing for the widest record in the module.
//   3. SendError 5-case variant shape — variant-with-multi-line
//      continuation parses correctly.
//   4. Module-tier totals — entities.length matches post-flip surface.
//   5. Catalog surfacing post-`getSystemRegistry()`.
//   6. Phase 5b1 — `email:address` + `email:formatAddress` carry Fenel
//      bodies post-flip (replacing the TS natives).
//   7. Phase 5b1 — semantic regression smoke covering the 3 fixtures
//      from the brief: no-displayName / with-displayName / empty-local.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
// module-substrate Phase 3k consolidated the 5 email `.fenel` files into one
// `module email where` file; this *-load test now reads the module file (the
// path/events reframe precedent). The 14 `data` decls are unchanged — the
// roster lock + record/variant-shape assertions hold byte-for-byte.
import emailSrc from "../../../../../fenel/modules/email/email.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { stripEmptyVariantFields } from "../type-foundation";
import { emailModule } from "./email";
import { stdModule } from "./std";
import { createRegistry } from "../registry";
import { evaluate } from "../json-logic";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import type { FenelType } from "../types";

const EMAIL_MOD = loadFenelModule(emailSrc, "email");

function rawEntity(id: string): FenelType {
  const entity = (EMAIL_MOD.entities ?? []).find((e) => e.id === id);
  if (!entity) throw new Error(`email module missing entity ${id}`);
  return stripEmptyVariantFields(entity.type);
}

test("email/email.fenel parses to exactly 14 entities (canonical roster lock)", () => {
  expect((EMAIL_MOD.entities ?? []).length).toBe(14);
  const ids = (EMAIL_MOD.entities ?? []).map((e) => e.id);
  for (const id of [
    "Address", "Body", "AssetRef", "Attachment", "Header", "Email",
    "MessageId", "SendError", "SendResult", "BounceKind", "EmailEvent",
    "DnsRecord", "DomainStatus", "SendingDomain",
  ]) {
    expect(ids).toContain(id);
  }
});

test("Email record carries all 11 fields in declared order", () => {
  // Widest single-line record in the module — locks the parser's
  // single-line record field collection on a record big enough that
  // any column-tracking regression would surface. Field types are
  // checked structurally below; here we lock the names + order.
  const email = rawEntity("Email") as {
    $record: { fields: Array<{ name: string; type: FenelType }> };
  };
  expect(email.$record.fields.map((f) => f.name)).toEqual([
    "from", "to", "cc", "bcc", "replyTo",
    "subject", "body", "attachments", "headers",
    "inReplyTo", "references",
  ]);
});

test("SendError parses as a 5-case variant with multi-line continuation", () => {
  // Variant tolerates multi-line `|` continuation — the SendError
  // body spans 5 lines. The ProviderError case carries two named
  // fields (code / message); the other four cases carry single
  // positional payloads (`InvalidAddress String`, etc.).
  const sendError = rawEntity("SendError") as {
    $variant: { cases: Array<{ name: string }> };
  };
  expect(sendError.$variant.cases.map((c) => c.name)).toEqual([
    "InvalidAddress", "DomainNotVerified", "RateLimited",
    "Suppressed", "ProviderError",
  ]);
});

test("emailModule.entities carries all 14 parsed entities post-flip", () => {
  // ids-via-toContain rather than strict-equality-by-index so the
  // test doesn't couple to author order in the .fenel file (matches
  // 4g convention).
  const ids = (emailModule.entities ?? []).map((e) => e.id);
  expect(ids.length).toBe(14);
  for (const id of ["Address", "Email", "SendResult", "SendingDomain", "EmailEvent"]) {
    expect(ids).toContain(id);
  }
});

test("getSystemRegistry surfaces entity:Email / entity:SendResult / entity:DomainStatus", () => {
  // emailModule is in SYSTEM_MODULES (system-registry.ts:58) — catalog
  // lookups via getCatalogEntry resolve all 14 entities post-flip.
  getSystemRegistry();
  for (const id of ["entity:Email", "entity:SendResult", "entity:DomainStatus", "entity:Address", "entity:EmailEvent"]) {
    expect(getCatalogEntry(id)).toBeDefined();
  }
});

test("Phase 5b1 — email:address + email:formatAddress carry Fenel bodies post-flip", () => {
  // Phase 5b1 replaces the TS natives `addressNative` /
  // `formatAddressNative` with Fenel bodies in dedicated `.fenel` files
  // (address.fenel / format-address.fenel). The body-slot wiring on the
  // `defineFunction` specs picks the loaded body up so the spec is
  // executable through the engine evaluator. `email:parseAddress`
  // remains TS-native — regex-bound, awaiting Phase 6 — so this test
  // explicitly excludes it.
  const addr = (emailModule.functions ?? []).find((f) => f.id === "email:address");
  const fmt = (emailModule.functions ?? []).find((f) => f.id === "email:formatAddress");
  const parse = (emailModule.functions ?? []).find((f) => f.id === "email:parseAddress");
  expect(addr).toBeDefined();
  expect(fmt).toBeDefined();
  expect(parse).toBeDefined();
  expect(addr!.body).toBeDefined();
  expect(fmt!.body).toBeDefined();
  // parseAddress stays TS-native — no Fenel body.
  expect(parse!.body).toBeUndefined();
});

test("Phase 5b1 — address + formatAddress semantic regression smoke", () => {
  // Invokes both Fenel bodies through the engine evaluator with a
  // registry containing stdModule (for `concat` / `eq`) + emailModule
  // (for the `Address` `construct` op's field-name mapping via
  // `_constructors`). Fixtures cover the 3 brief cases:
  //   - address: typed construction with Just / Nothing displayName.
  //   - formatAddress: Just-displayName / Nothing-displayName / empty-
  //     local fallback.
  // Note the brief's deliberate behavioural trade-off: formatAddress
  // no longer strips embedded `"` from displayName (the TS native did
  // via .replace(/"/g, "") — defense-in-depth against hostile internal
  // input; awaits Phase 6 regex support). The fixtures avoid embedded
  // quotes so the assertion remains green.
  const registry = createRegistry([stdModule, emailModule]);
  const ctx = registry.evaluateContext();

  const addrFn = (emailModule.functions ?? []).find((f) => f.id === "email:address")!;
  const fmtFn = (emailModule.functions ?? []).find((f) => f.id === "email:formatAddress")!;

  // address: Nothing-displayName fixture.
  const noDn = evaluate(addrFn.body, {
    local: "rom",
    domain: "usefenel.com",
    displayName: { $tag: "Nothing" },
  }, ctx) as { $tag: string; local: string; domain: string; displayName: unknown };
  expect(noDn.$tag).toBe("Address");
  expect(noDn.local).toBe("rom");
  expect(noDn.domain).toBe("usefenel.com");
  expect(noDn.displayName).toEqual({ $tag: "Nothing" });

  // address: Just-displayName fixture.
  const withDn = evaluate(addrFn.body, {
    local: "rom",
    domain: "usefenel.com",
    displayName: { $tag: "Just", _0: "Romain" },
  }, ctx) as { $tag: string; displayName: { $tag: string; _0: string } };
  expect(withDn.$tag).toBe("Address");
  expect(withDn.displayName).toEqual({ $tag: "Just", _0: "Romain" });

  // formatAddress: Nothing-displayName fixture — bare `local@domain`.
  expect(evaluate(fmtFn.body, { addr: noDn }, ctx)).toBe("rom@usefenel.com");

  // formatAddress: Just-displayName fixture — quoted + bracketed.
  expect(evaluate(fmtFn.body, { addr: withDn }, ctx)).toBe('"Romain" <rom@usefenel.com>');

  // formatAddress: empty-local fixture — defensive fallback returns "".
  const emptyLocal = {
    $tag: "Address",
    local: "",
    domain: "usefenel.com",
    displayName: { $tag: "Nothing" },
  };
  expect(evaluate(fmtFn.body, { addr: emptyLocal }, ctx)).toBe("");
});
