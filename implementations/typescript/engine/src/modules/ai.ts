// ---------------------------------------------------------------------------
// AI — module-substrate Phase 3l seam (the capability+creds CARBON-COPY that
// confirms the email Phase 3k playbook generalizes).
//
// ai is the SECOND capability module whose FUNCTION + TYPES + CREDS +
// CAPABILITY + PROVIDERS are ALL authored Fenel-first — the clean repeat that
// cashes out "email was a true representative". The ~128-LOC hand-assembled
// module (1 `defineFunction` spec + a TS `Interface` capability const + 2 TS
// provider-instance consts + inline creds) is RETIRED. Source of truth:
//   - `fenel/modules/ai/ai.fenel`         — `module ai where` header, 2 `data`
//     decls, the lone `callLLM` @native foreign decl, facets;
//   - `fenel/modules/ai/capability.fenel` — the `AI` capability as a Fenel
//     record-of-methods type → `seedFromType` → the dispatch seed;
//   - `fenel/modules/ai/instances.fenel`  — the 2 provider instances
//     (anthropic / openai) as Fenel typed values (codec string-method model);
//   - `fenel/modules/ai/credentials.fenel` — the 2 ProviderCredentials as
//     typed values.
//
// SIMPLER than email on every axis: NO `ffi/` leaf, NO `nativeImpls` map, NO
// dotted-name rename. `callLLM` is a BODYLESS substrate primitive backed by a
// runtime IO handler (the `payments:createStripeCheckoutSession` precedent —
// a `@native` foreign decl, NO `nativeImpls` on the module; the runtime
// handler stays as-is, a different surface). The `AI.complete` capability
// method is a plain ident, so unlike email this seam touches NO runtime file.
//
// The capability NAME is `AI` (kept byte-identical). The seam re-exports
// `aiModule` + `aiCapabilities` + `aiProviders` by name → 0 consumer edits
// (system-entities.ts imports the capability/provider values DIRECTLY).
// ---------------------------------------------------------------------------

import type {
  FenelModule,
  ProviderCredentials,
  Interface,
  Instance,
} from "../types";
import { loadFenelModule } from "../fenel-module";
import { seedFromType } from "../effect-dispatch";
import AI_FENEL from "../../../../../fenel/modules/ai/ai.fenel?raw";
import AI_CAPABILITY_FENEL from "../../../../../fenel/modules/ai/capability.fenel?raw";
import AI_INSTANCES_FENEL from "../../../../../fenel/modules/ai/instances.fenel?raw";
import AI_CREDS_FENEL from "../../../../../fenel/modules/ai/credentials.fenel?raw";

// Declarative half — header + 2 entities (AIResponse / AIError) + the bodyless
// `callLLM` @native foreign decl + its identity facets.
const loaded = loadFenelModule(AI_FENEL, "ai", { label: "AI" });

// ---------------------------------------------------------------------------
// Capability — derive the `AI` dispatch seed from the `.fenel`
// record-of-methods type (the email `seedFromType` precedent). Loaded
// SEPARATELY from `ai.fenel` so the `AI` capability type does NOT enter
// `aiModule.entities` (the 2-data-type roster). `AI` is nominal (dispatched by
// provider name via `resolveCapabilityMethod`), so the seed needs only the
// method NAME + signature; the classParam is vestigial. Re-exported by name —
// `system-entities.ts` `defineClass`s it directly.
// ---------------------------------------------------------------------------

// Exported for the spec-entity routing in system-entities.ts (signature-
// substrate P4-prep D0b): the deleted fenel/std/interfaces.fenel AI copy
// re-sources its spec-entity face from this module-local owner.
export const aiCapabilitySource = loadFenelModule(AI_CAPABILITY_FENEL, "ai");
const aiEntity = aiCapabilitySource.entities?.find(
  (e) => e.id === "AI",
);
if (!aiEntity?.type || !aiEntity.typeScheme) {
  throw new Error("ai: capability.fenel is missing the AI type");
}

export const aiCapabilities: Interface[] = [
  seedFromType("AI", aiEntity.type, "a", {
    typeScheme: aiEntity.typeScheme,
    sourceModule: aiCapabilitySource,
  }),
];

// ---------------------------------------------------------------------------
// Providers — the 2 `AI` instances projected from `instances.fenel` (codec
// sidecar pattern). Methods are fnId strings (the qualified dispatch name);
// `priority` + `label` are lifted to the instance slots. Source order
// (anthropic / openai) matches the retired const; `listProvidersSorted` ranks
// the higher `priority` (openai 20) first. Re-exported by name —
// `system-entities.ts` registers them via `addInstance` directly.
// ---------------------------------------------------------------------------

export const aiProviders: Instance[] = (
  loadFenelModule(AI_INSTANCES_FENEL, "ai", { dispatchInstanceFile: true }).instances ?? []
).filter((i) => i.typeName === "AI");

// ---------------------------------------------------------------------------
// Provider credential requirements — read back from the `.fenel` sidecar.
//
// The 2 `ProviderCredentials { capability, provider, envVars }` value-decls in
// `credentials.fenel` project (via {dispatchInstanceFile:true}) to
// `{typeName:"ProviderCredentials", methods:{capability, provider, envVars}}`.
// Reassemble the byte-identical `ProviderCredentials[]` in source order
// (anthropic / openai). NOT merged into `aiModule.instances` — pure data, no
// registry / law footprint.
// ---------------------------------------------------------------------------

const credentialRequirements: ProviderCredentials[] = (
  loadFenelModule(AI_CREDS_FENEL, "ai", { dispatchInstanceFile: true }).instances ?? []
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
// Module export — `loaded` carries the header (name="ai", label), the 2
// entities, the 1 bodyless `callLLM` @native foreign decl, and its identity
// facets (Codeable / Labelable / Describable / Taggable — NO stored
// Categorizable; the `ai` category derives at read time from the `ai:` id
// prefix, Phase 3j). The creds ride the `credentialRequirements` field. NO
// `nativeImpls` / `ffi/` leaf — `callLLM` is the bodyless IO-handler-backed
// `@native`. The capability seed + provider instances are exported separately
// (above) for direct registration by `system-entities.ts`.
// ---------------------------------------------------------------------------

export const aiModule: FenelModule = {
  ...loaded,
  credentialRequirements,
};
