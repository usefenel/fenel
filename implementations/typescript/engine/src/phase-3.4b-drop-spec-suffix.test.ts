// Phase 3.4b of typeclass-substrate-completion — conformance for the `Spec`
// suffix retirement.
//
// Pins, on the LIVE boot registry + catalog (read-only — audit-neutral):
//   (a) a renamed class resolves end-to-end + lands in the catalog "spec"
//       section by the `getClass` predicate (not the retired name suffix);
//   (b) the `Email` collision is resolved — the data entity `Email` is in
//       "entity", the capability `EmailService` is in "spec";
//   (c) the codeName-to-class map is identity and a Constraint references its
//       class directly — Phase 3.4c renamed the 162 Constraint entityIds
//       suffix-free and deleted every suffix-strip bridge (clean break);
//   (d) the persistence key is suffix-free — the read-key set is suffix-free
//       and a constructed spec value's head (the `$tag` the runtime derives
//       `entity_type` from) is the suffix-free class name.
//
// `design/unified-dispatch.md` § "Method resolution (model locked 2026-05-29)":
// no `Spec` suffix — types are named directly.

import { describe, it, expect } from "bun:test";
import {
  dispatchRegistry,
  specEntities,
  dispatchedSpecCodeNames,
  interfaceCodeNameToName,
  isDispatchClassEntity,
} from "./system-entities";
import { getCatalog } from "./type-catalog";
import { loadFenelModule } from "./fenel-module";
import { GLOBAL_ONLY } from "./dispatch-registry";

const catalog = () => getCatalog();
const sectionEntryIds = (id: string) =>
  catalog().find((s) => s.id === id)?.entries.map((e) => e.id) ?? [];

// ---------------------------------------------------------------------------
// (a) A renamed class resolves end-to-end + sits in "spec" by getClass.
// ---------------------------------------------------------------------------

describe("Phase 3.4b (a) — a suffix-free class resolves + is catalog-placed by getClass", () => {
  it("the class name IS the entity id (suffix-free); getClass recognises it", () => {
    // `Labelable`, not `LabelableSpec`.
    expect(specEntities.some((e) => e.id === "Labelable")).toBe(true);
    expect(specEntities.some((e) => e.id === "LabelableSpec")).toBe(false);
    expect(dispatchRegistry.getClass("Labelable")).toBeDefined();
    expect(isDispatchClassEntity("Labelable")).toBe(true);
  });

  it("a renamed-class instance resolves end-to-end through the live registry", () => {
    // `profileReferenceable : Referenceable profile` (NOT `ReferenceableSpec`)
    // resolves by type-query — the substrate never needed the suffix.
    expect(dispatchRegistry.satisfies("profile", "Referenceable", GLOBAL_ONLY)).toBe(true);
    expect(dispatchRegistry.resolve("profile", "Referenceable", GLOBAL_ONLY)).toBeDefined();
  });

  it("the catalog 'spec' section carries the suffix-free id, not the `Spec` form", () => {
    const specIds = sectionEntryIds("interface");
    expect(specIds).toContain("spec:Labelable");
    expect(specIds).not.toContain("spec:LabelableSpec");
  });
});

// ---------------------------------------------------------------------------
// (b) The `Email` collision is resolved.
// ---------------------------------------------------------------------------

describe("Phase 3.4b (b) — Email (data) vs EmailService (capability) collision resolved", () => {
  it("getClass distinguishes the data entity from the capability", () => {
    // The data entity `Email` (the message record) has NO class → not a
    // dispatch class. The capability class is `EmailService`.
    expect(dispatchRegistry.getClass("Email")).toBeUndefined();
    expect(dispatchRegistry.getClass("EmailService")).toBeDefined();
    expect(isDispatchClassEntity("Email")).toBe(false);
    expect(isDispatchClassEntity("EmailService")).toBe(true);
  });

  it("the catalog routes the data `Email` to 'entity' and `EmailService` to 'spec'", () => {
    expect(sectionEntryIds("entity")).toContain("entity:Email");
    expect(sectionEntryIds("interface")).toContain("spec:EmailService");
    // The data `Email` must NOT leak into the spec section (the 3.4a regression).
    expect(sectionEntryIds("interface")).not.toContain("spec:Email");
  });
});

// ---------------------------------------------------------------------------
// (c) The clean break (Phase 3.4c): codeName-to-class is identity and a
// Constraint references its class directly — no suffix, no strip bridge.
// ---------------------------------------------------------------------------

describe("Phase 3.4c — class names written directly (no `Spec` suffix, no bridge)", () => {
  it("interfaceCodeNameToName is an identity map for the renamed corpus (no-op strip)", () => {
    for (const [codeName, typeName] of interfaceCodeNameToName) {
      expect(typeName).toBe(codeName);
      expect(codeName.endsWith("Spec")).toBe(false);
    }
  });

  it("a Constraint entityId IS its class name — resolves directly, no suffix shim", () => {
    // Phase 3.4c — the 162 Constraint `entityId`s were renamed suffix-free and
    // every suffix-strip bridge deleted. The class is registered under the bare
    // name; the old suffixed form is registered nowhere.
    expect(dispatchRegistry.getClass("HasStateIO")).toBeDefined();
    expect(dispatchRegistry.getClass("HasStateIOSpec")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (d) The persistence key is suffix-free.
// ---------------------------------------------------------------------------

describe("Phase 3.4b (d) — persisted entity_type is suffix-free", () => {
  it("the db scan/read-key set (dispatchedSpecCodeNames) is entirely suffix-free", () => {
    // `dispatch-registry.ts` keys reads on these (via interfaceCodeNameToName);
    // `state.try_create_instance` derives entity_type from the value's $tag.
    // Both must be suffix-free for the two write paths to agree.
    expect(dispatchedSpecCodeNames.length).toBeGreaterThan(0);
    for (const id of dispatchedSpecCodeNames) {
      expect(id.endsWith("Spec"), `${id} should be suffix-free`).toBe(false);
    }
  });

  it("a constructed spec value's head (= the runtime $tag = entity_type) is suffix-free", () => {
    // The runtime derives `entity_type` from the constructor head ($tag). After
    // the rename, authoring `Labelable { … }` constructs head `Labelable` — the
    // same suffix-free string `dispatch-registry.createDispatchInstance` writes as
    // `entity_type = def.typeName`. The body-only loader path surfaces that
    // head as the projected instance's typeName.
    const mod = loadFenelModule(
      `x = Labelable { label = "Hi" }`,
      "t",
      { dispatchInstanceFile: true },
    );
    const inst = (mod.instances ?? [])[0];
    expect(inst).toBeDefined();
    expect(inst!.typeName).toBe("Labelable");
    expect(inst!.typeName.endsWith("Spec")).toBe(false);
  });
});
