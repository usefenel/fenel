// Phase 2.5 of typeclass-substrate-completion — conformance tests for the
// lowercase-named module capability typeclass rename.
//
// Pins the Phase 2.5 outcomes: the 20 lowercase typeclasses are renamed to
// their PascalCase counterparts in the in-memory registry; matching spec
// entities are present; no lowercase residue survives in either the spec
// registry or the spec entity set; specEntities.length === 85.

import { describe, it, expect } from "bun:test";
import { specEntities, dispatchRegistry } from "./system-entities";

// The locked rename table for Phase 2.5. Lowercase → PascalCase.
const RENAMES: Array<[string, string]> = [
  ["messaging",              "Messaging"],
  ["payment",                "Payment"],
  ["ai",                     "AI"],
  // Phase 2.5 renamed `email` -> `Email`; Phase 3.4b then renamed the
  // capability class `Email` -> `EmailService` (the suffix-free `Email`
  // would collide with the data entity `Email`). The net registered class
  // name is `EmailService`.
  ["email",                  "EmailService"],
  ["telegram_lifecycle",     "TelegramLifecycle"],
  ["telegram_webhooks",      "TelegramWebhooks"],
  ["telegram_messages",      "TelegramMessages"],
  ["telegram_callbacks",     "TelegramCallbacks"],
  ["telegram_media",         "TelegramMedia"],
  ["telegram_files",         "TelegramFiles"],
  ["telegram_chat_admin",    "TelegramChatAdmin"],
  ["telegram_bot_config",    "TelegramBotConfig"],
  ["telegram_payments",      "TelegramPayments"],
  ["telegram_inline_mode",   "TelegramInlineMode"],
  ["telegram_stickers",      "TelegramStickers"],
  ["telegram_passport",      "TelegramPassport"],
  ["telegram_games",         "TelegramGames"],
  ["telegram_polls",         "TelegramPolls"],
  ["telegram_forum_topics",  "TelegramForumTopics"],
  ["telegram_business",      "TelegramBusiness"],
];

describe("Phase 2.5 — lowercase capability rename", () => {
  it("rename table has exactly 20 entries", () => {
    expect(RENAMES.length).toBe(20);
  });

  it("every renamed typeclass is registered under its PascalCase name", () => {
    for (const [_, upper] of RENAMES) {
      expect(dispatchRegistry.getClass(upper), upper).toBeTruthy();
    }
  });

  it("no class in dispatchRegistry has a lowercase first letter (zero residue)", () => {
    const registered = dispatchRegistry.listClasses();
    const lowercaseResidue = registered.filter((c) => /^[a-z]/.test(c.name));
    expect(lowercaseResidue.map((c) => c.name)).toEqual([]);
  });

  it("every renamed typeclass has a matching spec entity (suffix-free — Phase 3.4b)", () => {
    const ids = new Set(specEntities.map((e) => e.id));
    for (const [_, upper] of RENAMES) {
      // Phase 3.4b dropped the `Spec` suffix: the entity id IS the class name.
      expect(ids.has(upper), `${upper} missing`).toBe(true);
    }
  });

  it("no lowercase-named SpecEntity survives in specEntities", () => {
    const lowercaseSpecs = specEntities.filter((e) => /^[a-z]/.test(e.id));
    expect(lowercaseSpecs.map((e) => e.id)).toEqual([]);
  });

  it("specEntities.length === 108 (the exact-roster twin owns membership; this pins the count)", () => {
    // Phase 5 of typeclass-substrate-completion added the FP-trinity spec
    // records (Functor / Monad / Monoid) as catalog spec entities via
    // fenel/std/algebra.fenel → 85 + 3 = 88.
    // Phase 8a of typed-function-references added the OPEN `Identifiable h`
    // handle class (declared inertly) via fenel/std/typeclass-specs.fenel → 89.
    // FM-retire-E1 Step 5 added the per-field UI-hint facet class `Displayable`
    // (law-free) via fenel/std/typeclass-specs.fenel → 90.
    // storage-as-effect Phase 1b added the `StorageHandler` backend class via
    // fenel/std/typeclass-specs.fenel → 91.
    // unified-static-analysis Phase 6c added the `Foldable` class (the 4th FP
    // algebra spec record) via fenel/std/algebra.fenel → 92.
    // unified-static-analysis Phase 6d added the `Applicative` + `Traversable`
    // classes (completing the derivable FP hierarchy) via fenel/std/algebra.fenel → 94.
    // (STALE-PIN REPAIR, signature-substrate P4-prep: thirteen later phases —
    // Eq/Ord/Numeric/Enumerable, Representable/Lift/Sequential/Containable,
    // Reprable, and the post-trinity families recorded in
    // phase-2-spec-record-migration.test.ts's exact roster — landed without
    // touching this count; it read 94 while the roster held 107, and this
    // test was failing at HEAD before the P4-prep landing. The EXACT roster
    // test owns membership; this count now tracks it.) → 107.
    // signature-substrate P4-prep (D0b) added `Submittable` via the
    // Representational-marker registration closure → 108.
    expect(specEntities.length).toBe(108);
  });

  it("Phase 2 KNOWN_UNADDRESSED_LOWERCASE list is fully closed", () => {
    // Mirror the Phase 2 conformance test's deferred-list arm — every
    // lowercase name should now resolve to its uppercase Fenel-authored
    // spec entity. Pinning here as a regression-guard against future
    // re-introduction of lowercase typeclass names.
    const ids = new Set(specEntities.map((e) => e.id));
    for (const [lower, upper] of RENAMES) {
      // Phase 3.4b — entity ids are suffix-free; the lowercase form never
      // exists, the PascalCase class name IS the entity id.
      expect(ids.has(lower), `${lower} should NOT exist`).toBe(false);
      expect(ids.has(upper), `${upper} should exist`).toBe(true);
    }
  });
});
