// ---------------------------------------------------------------------------
// Ecom Module — CRM/ecommerce entities, capabilities, and providers.
//
// signature-substrate Phase 4-prep (D0b) seam: the hand-written `Interface`
// capability consts (Messaging / Payment / a third duplicate AI), the
// provider-instance consts, the Storage/HasPreview typeclass consts, the
// storage instances, and the credential rows are RETIRED as TS literals.
// Source of truth (the ai/email playbook):
//   - `fenel/modules/ecom/types.fenel`       — EcomProfile + Asset entities;
//   - `fenel/modules/ecom/capability.fenel`  — Messaging + Payment as Fenel
//     record-of-methods types → `seedFromType` → the dispatch seeds;
//   - `fenel/modules/ecom/typeclasses.fenel` — Storage + HasPreview class
//     types (moved off `fenel/std/interfaces.fenel`) → `seedFromType`;
//   - `fenel/modules/ecom/instances.fenel`   — the 4 provider instances +
//     3 storage instances as Fenel typed values (string-method model);
//   - `fenel/modules/ecom/credentials.fenel` — the 4 ecom-owned
//     ProviderCredentials value-decls.
// The duplicate AI capability/embedding literals, Anthropic/OpenAI provider
// rows, and AI credential rows are DELETED — the `ai` module
// (`fenel/modules/ai/`) owns that capability (the live interface already
// won last-registration before this cleanup; the ecom AI rows were dead
// shadow state, `embed` had no interface method and no handler).
// Exports keep their names → 0 consumer edits in system-entities.ts.
// ---------------------------------------------------------------------------

import type {
  FenelModule,
  ProviderCredentials, Interface,
  Instance,
} from "../types";
import { loadFenelModule } from "../fenel-module";
import { seedFromType } from "../effect-dispatch";
import TYPES_FENEL from "../../../../../fenel/modules/ecom/types.fenel?raw";
import CAPABILITY_FENEL from "../../../../../fenel/modules/ecom/capability.fenel?raw";
import TYPECLASSES_FENEL from "../../../../../fenel/modules/ecom/typeclasses.fenel?raw";
import INSTANCES_FENEL from "../../../../../fenel/modules/ecom/instances.fenel?raw";
import CREDS_FENEL from "../../../../../fenel/modules/ecom/credentials.fenel?raw";

const typesModule = loadFenelModule(TYPES_FENEL, "ecom");

// Identity (label/description) for ecom-module entities — registered as
// Labelable/Describable typeclass instances by the module loader. The
// `args` codenames track the .fenel entity ids (EcomProfile / Asset);
// the user-facing `label` keeps "Profile" since the UI display
// convention for this lightweight CRM contact is unchanged.
const ecomIdentity: Instance[] = [
  { typeName: "Labelable", args: ["EcomProfile"], methods: { label: "Profile" } },
  { typeName: "Describable", args: ["EcomProfile"], methods: { description: "A person or identity in the system" } },
  { typeName: "Labelable", args: ["Asset"], methods: { label: "Asset" } },
  { typeName: "Describable", args: ["Asset"], methods: { description: "A file stored in the system — content-addressable blob with metadata" } },
];

// ---------------------------------------------------------------------------
// Capabilities — derived from the `.fenel` record-of-methods types (the
// ai/email `seedFromType` precedent). Loaded SEPARATELY from `types.fenel`
// so the capability types do NOT enter `ecomModule.entities`. Both are
// nominal (dispatched by provider name via `resolveCapabilityMethod`), so
// each seed needs only the method NAMEs + signatures; the classParam is
// vestigial. Re-exported by name — `system-entities.ts` `defineClass`s them
// directly.
// ---------------------------------------------------------------------------

// Exported for the spec-entity routing in system-entities.ts (P4-prep D0b):
// Messaging/Payment spec-entity faces re-source from this module-local owner.
export const ecomCapabilitySource = loadFenelModule(CAPABILITY_FENEL, "ecom");
const capabilitySource = ecomCapabilitySource;

function capabilityEntity(name: string) {
  const entity = capabilitySource.entities?.find((e) => e.id === name);
  if (!entity?.type || !entity.typeScheme) {
    throw new Error(`ecom: capability.fenel is missing the ${name} type`);
  }
  return entity;
}

export const ecomCapabilities: Interface[] = ["Messaging", "Payment"].map((name) => {
  const entity = capabilityEntity(name);
  return seedFromType(name, entity.type, "a", {
    typeScheme: entity.typeScheme,
    sourceModule: capabilitySource,
  });
});

// ---------------------------------------------------------------------------
// Typeclasses — Storage + HasPreview, derived from the module-local
// `.fenel` class declarations (moved off `fenel/std/interfaces.fenel`; the
// social `interfaces.fenel` precedent). The dispatch param comes from the
// declared head binder (`Storage backend` / `HasPreview a`).
// ---------------------------------------------------------------------------

// Exported for the spec-entity routing (P4-prep D0b): Storage/HasPreview
// spec-entity faces re-source from this module-local owner (moved off
// fenel/std/interfaces.fenel).
export const ecomTypeclassSource = loadFenelModule(TYPECLASSES_FENEL, "ecom");
const typeclassSource = ecomTypeclassSource;

export const ecomTypeclasses: Interface[] = ["Storage", "HasPreview"].map((name) => {
  const entity = typeclassSource.entities?.find((e) => e.id === name);
  if (!entity?.type || !entity.typeScheme) {
    throw new Error(`ecom: typeclasses.fenel is missing the ${name} type`);
  }
  const classParam = entity.params?.[0];
  if (!classParam) {
    throw new Error(`ecom: typeclasses.fenel class ${name} declares no type parameter`);
  }
  return seedFromType(name, entity.type, classParam, {
    typeScheme: entity.typeScheme,
    sourceModule: typeclassSource,
  });
});

// ---------------------------------------------------------------------------
// Providers + storage instances — projected from `instances.fenel` (codec
// sidecar pattern). Methods are fnId strings (the qualified dispatch
// names); `priority` + `label` lift to the instance slots. Messaging /
// Payment rows are the exported providers (registered via
// MODULE_PROVIDER_INSTANCES); Storage rows ride `ecomModule.instances`
// exactly as the retired `storageInstances` const did.
// ---------------------------------------------------------------------------

const instanceRows: Instance[] = (
  loadFenelModule(INSTANCES_FENEL, "ecom", { dispatchInstanceFile: true }).instances ?? []
);

export const ecomProviders: Instance[] = instanceRows.filter(
  (i) => i.typeName === "Messaging" || i.typeName === "Payment",
);

const storageInstances: Instance[] = instanceRows.filter((i) => i.typeName === "Storage");

// ---------------------------------------------------------------------------
// Provider credential requirements — read back from the `.fenel` sidecar
// (the ai/email model). The AI rows are owned by the `ai` module.
// ---------------------------------------------------------------------------

const credentialRequirements: ProviderCredentials[] = (
  loadFenelModule(CREDS_FENEL, "ecom", { dispatchInstanceFile: true }).instances ?? []
)
  .filter((i) => i.typeName === "ProviderCredentials")
  .map((i) => {
    const m = i.methods as { capability: unknown; provider: unknown; envVars: unknown };
    return {
      capability: String(m.capability),
      provider: String(m.provider),
      envVars: (m.envVars as unknown[]).map((v) => String(v)),
    };
  });

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

export const ecomModule: FenelModule = {
  name: "ecom",
  label: "E-Commerce & CRM",
  entities: typesModule.entities,
  instances: [...storageInstances, ...ecomIdentity],
  credentialRequirements,
};
