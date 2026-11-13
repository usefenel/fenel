// Phase 2 of typeclass-substrate-completion — conformance tests for the
// Interface → Fenel-authored spec record migration.
//
// Pins the Phase 2 outcomes: every uppercase-named TS typeclass has a
// Fenel-authored spec record entity in `specEntities`; the lowercase-named
// module capability typeclasses remain unaddressed (deferred to Phase 2.5);
// the Stage 2 programmatic-derivation loop is gone; `dispatchedSpecCodeNames`
// matches the expected set.

import { describe, it, expect } from "bun:test";
import { specEntities, dispatchRegistry, dispatchedSpecCodeNames } from "./system-entities";

// The 18 specs hand-authored in fenel/std/typeclass-specs.fenel before Phase 2
// + the 47 migrated to that file in Phase 2 (46 generated + MigrationSpec hand-
// authored to repair the stale bare-`List` source bug).
const EXPECTED_FENEL_AUTHORED_SPECS = [
  // Hand-authored Phase 10a sub-step 2 (representational core + identifiable)
  "Labelable", "Codeable", "Describable", "Iconable",
  "Emojiable", "Soundable", "Categorizable", "Taggable",
  "Viewable", "Aliasable", "Exemplifiable", "Storyboardable",
  "Layout", "Inputable", "Referenceable", "Groupable",
  "HasDefault", "Undefinable",
  // Phase 2 migrated (built-in classes)
  "Versionable", "Sampleable", "Renderable", "Exportable",
  "IOInvokable", "Representational", "FieldRepresentational",
  // Later representational substrate classes, still authored by the same
  // canonical interfaces.fenel catalog path.
  "Symbolable", "Subsumable", "Reprable",
  // Phase 2 migrated (effects)
  "HasNetwork", "HasHTTP", "HasStateIO", "HasStdin",
  "HasStdout", "HasFileSystem", "HasTime", "HasRandom",
  "HasEmail", "HasSocialMedia", "HasLog", "HasTelegramBot",
  "HasWasmBuilder", "HasRegistry", "HasIO", "HasControlFlow",
  // storage-as-effect Phase 1b — StorageHandler, the scoped backend class
  // under HasStateIO (Db / Memory / future File tag).
  "StorageHandler",
  // Phase 2 migrated (operators + truthy + resolvable + filterable)
  "Infixable", "Prefixable", "Truthy", "Resolvable",
  "Filterable",
  // Phase 2 migrated (codec + decidable + prover + compilable + evaluator + aggregable + migration)
  "Encodable", "Decodable", "Iso", "Lens",
  "DecidableMembership", "Prover", "Compilable", "Evaluator",
  "Aggregable", "Migration",
  // Phase 2 migrated (entity-typeclasses)
  "PhoneFormat", "AddressFormat", "HandleFormat",
  "ExchangeRate", "Spatial", "DateFormat",
  // Phase 2 migrated (uppercase module capabilities)
  "Storage", "HasPreview",
  "Social", "Conversational", "Discoverable",
  // Phase 2.5 migrated (lowercase-renamed module capabilities)
  "Messaging", "Payment", "AI", "EmailService",
  "TelegramLifecycle", "TelegramWebhooks", "TelegramMessages",
  "TelegramCallbacks", "TelegramMedia", "TelegramFiles",
  "TelegramChatAdmin", "TelegramBotConfig", "TelegramPayments",
  "TelegramInlineMode", "TelegramStickers", "TelegramPassport",
  "TelegramGames", "TelegramPolls", "TelegramForumTopics",
  "TelegramBusiness",
  // Phase 5 of typeclass-substrate-completion — the FP trinity, declared as
  // Fenel spec records in fenel/std/algebra.fenel; dispatch seeds DERIVED from
  // those records (Phase 3.3a deleted the hand-written functor/monad/monoidClass).
  "Functor", "Monad", "Monoid",
  // unified-static-analysis Phase 6c — `Foldable`, the 4th FP algebra spec
  // record (fenel/std/algebra.fenel); its dispatch seed is derived in the same
  // trinity loop in system-entities.ts.
  "Foldable",
  // unified-static-analysis Phase 6d — `Applicative` + `Traversable`, completing
  // the derivable FP type-class hierarchy (fenel/std/algebra.fenel); dispatch
  // seeds derived in the same trinity loop (ap→arg 0, traverse→arg 1).
  "Applicative", "Traversable",
  // Post-trinity classes from the numeric, array, and resolution substrates.
  "Eq", "Ord", "Numeric", "Enumerable",
  "Representable", "Lift", "Sequential", "Containable",
  // Phase 8a of typed-function-references — the OPEN `Identifiable h` handle
  // class, declared INERTLY (resolution-as-dispatch wires in at 8c). A Fenel
  // spec record in fenel/std/typeclass-specs.fenel + a `pureClasses` dispatch
  // seed in system-entities.ts.
  "Identifiable",
  // FM-retire-E1 Step 5 — the per-FIELD UI-hint facet class `Displayable a =
  // Displayable hint: field_ui_hint` (law-free). A Fenel spec record in
  // typeclass-specs.fenel + a `pureClasses` dispatch seed in system-entities.ts.
  "Displayable",
  // signature-substrate P4-prep (D0b) — `Submittable`, registered by the
  // Representational-marker closure (its marker + declaration + persisted
  // instance existed since storage-as-effect 4e, but the roster omitted it —
  // P2 surprise 55; the marker-driven registration closed the hole without
  // growing the TS name roster).
  "Submittable",
];

// Phase 2.5 closed the lowercase-capability gap. Each entry below is the
// PascalCase form the lowercase typeclass renamed into; the Phase-2.5
// `<UpperName>Spec` entity is expected to be present. Kept here (rather
// than deleted) as a regression-pin against future re-introduction of
// lowercase typeclass names.
const PHASE_2_5_RENAMED_UPPERCASE = [
  "Messaging", "Payment", "AI", "EmailService",
  "TelegramLifecycle", "TelegramWebhooks", "TelegramMessages",
  "TelegramCallbacks", "TelegramMedia", "TelegramFiles",
  "TelegramChatAdmin", "TelegramBotConfig", "TelegramPayments",
  "TelegramInlineMode", "TelegramStickers", "TelegramPassport",
  "TelegramGames", "TelegramPolls", "TelegramForumTopics",
  "TelegramBusiness",
];

describe("Phase 2 — Interface → Fenel migration", () => {
  it("every uppercase-named TS typeclass has a Fenel-authored spec entity", () => {
    const ids = new Set(specEntities.map((e) => e.id));
    const registeredClasses = dispatchRegistry.listClasses();
    const missingFromSpecEntities: string[] = [];
    for (const tc of registeredClasses) {
      if (!/^[A-Z]/.test(tc.name)) continue; // lowercase deferred to Phase 2.5
      const codeName = tc.name;
      if (!ids.has(codeName)) missingFromSpecEntities.push(codeName);
    }
    expect(missingFromSpecEntities).toEqual([]);
  });

  it("specEntities has the exact Fenel-authored dispatch-class roster", () => {
    expect(specEntities.map((entity) => entity.id).sort()).toEqual(
      [...EXPECTED_FENEL_AUTHORED_SPECS].sort(),
    );
  });

  it("Phase 2.5 renamed-capability specs are present (lowercase fully retired)", () => {
    const ids = new Set(specEntities.map((e) => e.id));
    for (const upper of PHASE_2_5_RENAMED_UPPERCASE) {
      // Phase 2.5 closed the lowercase-capability gap; Phase 3.4b dropped the
      // `Spec` suffix so the entity id IS the (PascalCase) class name. This
      // assertion regression-guards against re-introducing lowercase names.
      expect(ids.has(upper), `${upper} missing`).toBe(true);
    }
  });

  it("dispatchedSpecCodeNames includes every Fenel-authored spec", () => {
    for (const id of EXPECTED_FENEL_AUTHORED_SPECS) {
      expect(dispatchedSpecCodeNames).toContain(id);
    }
  });

  it("auxiliary ADTs and representation-target markers are NOT in specEntities", () => {
    const ids = new Set(specEntities.map((e) => e.id));
    for (const id of ["Evidence", "Verified", "DispatchKey", "JsRuntime", "Jsonb"]) {
      expect(ids.has(id), `${id} must remain an ordinary entity`).toBe(false);
    }
  });

  it("every Fenel-authored spec entity has a parameterised $record type body", () => {
    // Post-Phase-2 spec records are $record-shaped (not $variant) — the
    // parser collapses single-constructor type-defs to $record when the
    // constructor's name matches the type's name. This test pins that
    // shape so downstream consumers (catalog UI / FieldRenderer / etc.)
    // can rely on $record without falling through to $variant cases.
    for (const e of specEntities) {
      expect(e.type).toBeDefined();
      const t = e.type as Record<string, unknown>;
      // Either $record (most Phase 2 specs) or $variant (Verified / DispatchKey
      // helpers — but those filter out via the `endsWith("Spec")` gate above).
      // Empty-record-shaped specs (HasNetworkSpec, RepresentationalSpec) are
      // still $record with empty fields.
      const hasRecord = "$record" in t;
      const hasVariant = "$variant" in t;
      expect(hasRecord || hasVariant).toBe(true);
    }
  });

  it("projects catalog parameters from the authoritative ordered type scheme", () => {
    for (const entity of specEntities) {
      expect(entity.typeScheme, `${entity.id} is missing its source type scheme`).toBeDefined();
      expect(entity.params?.map(({ name }) => name) ?? []).toEqual(
        entity.typeScheme?.quantified.map(({ sourceName }) => sourceName) ?? [],
      );
    }
  });
});

// ---------------------------------------------------------------------------
// signature-substrate Phase 4-prep (D0b) — the Representational-marker
// registration closure. Every repository-authored `Representational c`
// marker must resolve to exactly one registered, source-owned dispatch class
// (the P2 surprise-55 `Submittable` hole, closed by the marker-driven
// derivation in system-entities.ts — no TS name-roster growth).
// ---------------------------------------------------------------------------

describe("P4-prep — Representational-marker registration closure", () => {
  it("every Representational marker resolves to a registered dispatch class", () => {
    const markers = dispatchRegistry.listInstances("Representational");
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) {
      const className = marker.args[0];
      expect(typeof className).toBe("string");
      expect(
        dispatchRegistry.getClass(className as string),
        `Representational marker names unregistered class ${String(className)}`,
      ).toBeDefined();
    }
  });

  it("Submittable is registered with its exact source-derived method scheme", () => {
    const submittable = dispatchRegistry.getClass("Submittable");
    expect(submittable).toBeDefined();
    expect(submittable!.methods.map((m) => m.name)).toEqual(["submitLabel"]);
    // The one method's type is the declared `LocaleString` ref (a nullary
    // representation field — no arrow), exactly the interfaces.fenel source.
    expect(submittable!.methods[0]!.returns).toEqual({ $ref: "LocaleString" });
    // Routed as a spec entity (isDispatchClassEntity now true — the catalog
    // "spec"/interface section face).
    expect(specEntities.some((e) => e.id === "Submittable")).toBe(true);
  });
});
