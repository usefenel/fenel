// ---------------------------------------------------------------------------
// ecom-load.test.ts — conformance test for the ecom module entity pilot.
// Phase 4d of the ts-elimination workstream flipped two inline `FenelType`
// `$record` literals (profile + asset, ~34 LOC) to a `.fenel`-sourced
// module file loaded via `loadFenelModule(TYPES_FENEL, "ecom")`. Fifth
// per-module flip (license 4a / ai 4b / templates 4c / notion 4e / ecom
// 4d) and the first one carrying a real codename collision requiring
// rename: ecom's lowercase `profile` codename collided with the system-
// tier `profile` (Phase 3d's rich 10-field identity) — renamed to
// `EcomProfile` for catalog-collision avoidance. `asset` PascalCase-
// normalized to `Asset` in the same flip.
//
// Each assertion covers one tier of the recipe:
//
//   1. 2-entity canonical roster (EcomProfile + Asset) — count drift
//      trips the gate.
//   2. EcomProfile raw `$record` parse shape — 5 fields with EmailStr /
//      PhoneStr refined-String atom refs preserved (resolve through
//      profile.fenel's foundation-tier registration at load time) and
//      `customData: { $record: { fields: [] } }` empty-record
//      placeholder bug-compatibly carried from the pre-flip shape.
//   3. Asset raw `$record` parse shape — 9 fields including the 4
//      `Maybe<Number>` optionals (width / height / duration / pages)
//      and the UrlStr ref (resolves through proxy_link.fenel's
//      foundation-tier registration).
//   4. `ecomModule.entities` carries both parsed entities — module
//      registration smoke.
//   5. Catalog surfacing post-`getSystemRegistry()`: probe
//      `entity:EcomProfile` and `entity:Asset` resolve. Gap-close — the
//      old lowercase codenames were never reachable through the catalog
//      because system entities register first and `entity:profile` is
//      already taken.
//   6. Collision-resolution audit: `entity:profile` (lowercase, system-
//      tier) resolves to the system profile (10 fields, firstName etc);
//      `entity:EcomProfile` (PascalCase, module-tier) resolves to the
//      ecom profile (5 fields, email etc); the two are distinct entries.
//      Confirms the prefix rename is doing its job.
// ---------------------------------------------------------------------------

import { test, expect } from "bun:test";
import ecomSrc from "../../../../../fenel/modules/ecom/types.fenel?raw";
import { loadFenelModule } from "../fenel-module";
import { stripEmptyVariantFields, List, Maybe, Nothing } from "../type-foundation";
import { ecomModule } from "./ecom";
import { getSystemRegistry } from "../system-registry";
import { getCatalogEntry } from "../type-catalog";
import type { FenelType } from "../types";

const ECOM_MOD = loadFenelModule(ecomSrc, "ecom");

function rawEntity(id: string): FenelType {
  const entity = (ECOM_MOD.entities ?? []).find((e) => e.id === id);
  if (!entity) throw new Error(`ecom module missing entity ${id}`);
  return stripEmptyVariantFields(entity.type);
}

test("ecom/types.fenel parses to exactly 2 entities (EcomProfile + Asset)", () => {
  // Canonical roster lock — count drift is intentional + loud. Any
  // future entity addition (Customer / Order / Cart / …) must bump
  // this assertion and document the change.
  const ids = (ECOM_MOD.entities ?? []).map((e) => e.id);
  expect(ids.length).toBe(2);
  expect(ids).toEqual(["EcomProfile", "Asset"]);
});

test("ecom/types.fenel parses EcomProfile to the expected 5-field $record", () => {
  expect(rawEntity("EcomProfile")).toEqual({
    $record: {
      fields: [
        { name: "email", label: Nothing, type: { $ref: "EmailStr" }, meta: {}, ui: Nothing },
        { name: "phone", label: Nothing, type: { $ref: "PhoneStr" }, meta: {}, ui: Nothing },
        { name: "name", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
        { name: "tags", label: Nothing, type: List({ $ref: "String" }), meta: {}, ui: Nothing },
        { name: "customData", label: Nothing, type: { $record: { fields: [] } }, meta: {}, ui: Nothing },
      ],
    },
  });
});

test("ecom/types.fenel parses Asset to the expected 9-field $record with 4 Maybe<Number> optionals", () => {
  expect(rawEntity("Asset")).toEqual({
    $record: {
      fields: [
        { name: "hash", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
        { name: "url", label: Nothing, type: { $ref: "UrlStr" }, meta: {}, ui: Nothing },
        { name: "name", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
        { name: "size", label: Nothing, type: { $ref: "Number" }, meta: {}, ui: Nothing },
        { name: "mimeType", label: Nothing, type: { $ref: "String" }, meta: {}, ui: Nothing },
        { name: "width", label: Nothing, type: Maybe({ $ref: "Number" }), meta: {}, ui: Nothing },
        { name: "height", label: Nothing, type: Maybe({ $ref: "Number" }), meta: {}, ui: Nothing },
        { name: "duration", label: Nothing, type: Maybe({ $ref: "Number" }), meta: {}, ui: Nothing },
        { name: "pages", label: Nothing, type: Maybe({ $ref: "Number" }), meta: {}, ui: Nothing },
      ],
    },
  });
});

test("ecomModule.entities carries both parsed entities", () => {
  // ids-via-toContain rather than strict-equality-by-index so the test
  // doesn't couple to author order in the .fenel file (matches 4b/4c/4e
  // convention).
  const ids = (ecomModule.entities ?? []).map((e) => e.id);
  expect(ids.length).toBe(2);
  expect(ids).toContain("EcomProfile");
  expect(ids).toContain("Asset");
});

test("getSystemRegistry surfaces entity:EcomProfile and entity:Asset (gap-close)", () => {
  // Pre-4d ecom registered lowercase codenames (`profile` / `asset`),
  // which were shadowed by the system-tier `profile` registration
  // (first-write-wins on collision). Post-4d the PascalCase codenames
  // surface for the first time through the catalog.
  getSystemRegistry();
  expect(getCatalogEntry("entity:EcomProfile")).toBeDefined();
  expect(getCatalogEntry("entity:Asset")).toBeDefined();
});

test("collision-resolution audit: entity:profile → system (10 fields); entity:EcomProfile → ecom (5 fields); distinct entries", () => {
  // The 4d-unique assertion: the system-tier `profile` (lowercase
  // codename — Phase 3d kept the existing convention, never normalized
  // to PascalCase) coexists with ecom's `EcomProfile` (PascalCase) as
  // separate catalog entries with distinct shapes. The prefix rename
  // resolves the pre-4d shadowing where ecom's `profile` was
  // unreachable.
  getSystemRegistry();
  const systemProfile = getCatalogEntry("entity:profile") as
    | { entity?: { type?: FenelType } }
    | undefined;
  const ecomProfile = getCatalogEntry("entity:EcomProfile") as
    | { entity?: { type?: FenelType } }
    | undefined;
  expect(systemProfile).toBeDefined();
  expect(ecomProfile).toBeDefined();
  expect(systemProfile).not.toBe(ecomProfile);
  const systemFields =
    (systemProfile!.entity!.type as { $record?: { fields?: unknown[] } })
      .$record?.fields ?? [];
  const ecomFields =
    (ecomProfile!.entity!.type as { $record?: { fields?: unknown[] } })
      .$record?.fields ?? [];
  expect(systemFields.length).toBe(10);
  expect(ecomFields.length).toBe(5);
});

// ---------------------------------------------------------------------------
// signature-substrate Phase 4-prep (D0b) — the capability/provider/credential
// consolidation proof. The duplicate ecom AI capability + Anthropic/OpenAI
// provider rows + AI ProviderCredentials are DELETED (the `ai` module owns
// them); Messaging/Payment/Storage/HasPreview are `.fenel`-sourced through
// `seedFromType`; the provider payload-shape delta on the surviving AI rows
// (the ecom method-record rows previously won the equal-priority stable
// order) is pinned as the review's authorized delta.
// ---------------------------------------------------------------------------

test("P4-prep — ecom exports exactly Messaging + Payment capabilities (AI deleted)", () => {
  const { ecomCapabilities } = require("./ecom") as typeof import("./ecom");
  expect(ecomCapabilities.map((c) => c.name).sort()).toEqual(["Messaging", "Payment"]);
  const messaging = ecomCapabilities.find((c) => c.name === "Messaging")!;
  expect(messaging.methods.map((m) => m.name)).toEqual(["send"]);
  const payment = ecomCapabilities.find((c) => c.name === "Payment")!;
  expect(payment.methods.map((m) => m.name)).toEqual(["create_checkout", "verify", "refund"]);
});

test("P4-prep — ecom providers are exactly the 4 Messaging/Payment rows (string-method model)", () => {
  const { ecomProviders } = require("./ecom") as typeof import("./ecom");
  expect(
    ecomProviders.map((p) => ({ t: p.typeName, a: p.args, pr: p.priority, l: p.label })),
  ).toEqual([
    { t: "Messaging", a: ["sms"], pr: 5, l: "SMS (Twilio)" },
    { t: "Messaging", a: ["telegram"], pr: 3, l: "Telegram" },
    { t: "Payment", a: ["stripe"], pr: 10, l: "Stripe" },
    { t: "Payment", a: ["nowpayments"], pr: 5, l: "NOWPayments (Crypto)" },
  ]);
  // The string-method model (the codec/email/ai port precedent): the
  // qualified dispatch names ARE the routing payload.
  const stripe = ecomProviders.find((p) => p.args[0] === "stripe")!;
  expect(stripe.methods).toEqual({
    create_checkout: "Payment.stripe.create_checkout",
    verify: "Payment.stripe.verify",
    refund: "Payment.stripe.refund",
  });
});

test("P4-prep — credentialRequirements carries exactly the 4 ecom-owned rows (AI rows deleted)", () => {
  expect(ecomModule.credentialRequirements).toEqual([
    { capability: "Messaging", provider: "sms", envVars: ["TWILIO_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"] },
    { capability: "Messaging", provider: "telegram", envVars: ["TELEGRAM_BOT_TOKEN"] },
    { capability: "Payment", provider: "stripe", envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] },
    { capability: "Payment", provider: "nowpayments", envVars: ["NOWPAYMENTS_API_KEY"] },
  ]);
});

test("P4-prep — storage instances ride the module with their handler codeNames verbatim", () => {
  const storage = (ecomModule.instances ?? []).filter((i) => i.typeName === "Storage");
  expect(storage.map((i) => i.args[0])).toEqual(["s3", "r2", "local"]);
  expect(storage[0]!.methods).toEqual({
    store: "s3_store", retrieve: "s3_retrieve", delete: "s3_delete", publicUrl: "s3_url",
  });
});

test("P4-prep — Storage/HasPreview derive from the module-local .fenel source (live contracts)", () => {
  const { ecomTypeclasses } = require("./ecom") as typeof import("./ecom");
  const storage = ecomTypeclasses.find((c) => c.name === "Storage")!;
  expect(storage.params?.map((p) => p.name)).toEqual(["backend"]);
  expect(storage.methods.map((m) => m.name)).toEqual(["store", "retrieve", "delete", "publicUrl"]);
  const hasPreview = ecomTypeclasses.find((c) => c.name === "HasPreview")!;
  expect(hasPreview.params?.map((p) => p.name)).toEqual(["a"]);
  expect(hasPreview.methods.map((m) => m.name)).toEqual(["thumbnail", "preview"]);
});

test("P4-prep — the live AI provider set is exactly the ai-module pair (the payload-shape delta pinned)", () => {
  // Before this cleanup the dispatch index held FOUR AI rows (ecom's two
  // method-record rows + the ai module's two string-method rows), and ecom's
  // Anthropic row won the equal-priority-10 stable order by registration
  // order. Route-equivalent at dispatch (`provider.args[0]` + method name);
  // the payload shape flip (method-record → fnId string) is the authorized
  // delta recorded in the phase-4 entry audit.
  const { dispatchRegistry } = require("../system-entities") as typeof import("../system-entities");
  const rows = dispatchRegistry.listInstances("AI");
  expect(rows.map((p) => ({ a: p.args[0], pr: p.priority }))).toEqual([
    { a: "anthropic", pr: 10 },
    { a: "openai", pr: 20 },
  ]);
  const anthropic = rows.find((p) => p.args[0] === "anthropic")!;
  expect(anthropic.methods).toEqual({ complete: "AI.anthropic.complete" });
});
