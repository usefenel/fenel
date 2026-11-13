// ---------------------------------------------------------------------------
// Email — module-substrate Phase 3k seam (the capability+creds REPRESENTATIVE,
// now FULLY Fenel-authored).
//
// email is the first capability module whose FUNCTIONS + TYPES + NATIVE + CREDS
// + CAPABILITY + PROVIDERS are ALL authored Fenel-first — the complete
// "typeclasses are types" cash-out on a real capability. The ~442-LOC
// hand-assembled module (5 `defineFunction` specs + inline natives + a TS
// `Interface` capability const + 5 TS provider-instance consts + inline creds)
// is RETIRED. Source of truth:
//   - `fenel/modules/email/email.fenel`        — `module email where` header,
//     14 `data` decls, 5 fns (4 Fenel-bodied + `parseAddress` @native), facets;
//   - `fenel/modules/email/ffi/email-ffi.ts`   — the `parseAddress` regex
//     native + addressToFenelView + AddressValue/BodyValue + `emailNatives`;
//   - `fenel/modules/email/capability.fenel`   — the `EmailService` capability
//     as a Fenel record-of-methods type → `seedFromType` → the dispatch seed;
//   - `fenel/modules/email/instances.fenel`    — the 5 provider instances as
//     Fenel typed values (codec string-method model);
//   - `fenel/modules/email/credentials.fenel`  — the 4 ProviderCredentials as
//     typed values.
//
// The 3 dotted capability method names (`domain.add`/`verify`/`list`) were a
// cosmetic faux-namespace — renamed to plain idents (`domainAdd`/…) across the
// capability + providers + the runtime `PROVIDER_IMPLS` map + the tests, since
// the dotted strings were internal-only (capability method name → IO-handler
// key → provider lookup, all self-derived). No quoted-field parser feature was
// needed; the earlier Wrinkle-1 TS-const fallback was retired.
//
// The capability NAME is `EmailService`, NOT `Email`: `getClass("Email")` stays
// undefined so the data `Email` routes to the catalog "entity" section (Phase
// 3.4b). The seam re-exports `emailModule` + `emailCapabilities` +
// `emailProviders` + `parseAddressNative` by name → 0 consumer edits
// (system-entities.ts imports the capability/provider values DIRECTLY).
// ---------------------------------------------------------------------------

import type {
  FenelModule,
  ProviderCredentials,
  Interface,
  Instance,
} from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule } from "../fenel-module";
import { seedFromType } from "../effect-dispatch";
import {
  emailNatives,
  parseAddressNative,
  type AddressValue,
  type BodyValue,
} from "../../../../../fenel/modules/email/ffi/email-ffi";
import EMAIL_FENEL from "../../../../../fenel/modules/email/email.fenel?raw";
import EMAIL_CAPABILITY_FENEL from "../../../../../fenel/modules/email/capability.fenel?raw";
import EMAIL_INSTANCES_FENEL from "../../../../../fenel/modules/email/instances.fenel?raw";
import EMAIL_CREDS_FENEL from "../../../../../fenel/modules/email/credentials.fenel?raw";

// Declarative half — header + 14 entities + 5 fns (4 Fenel-bodied + the
// `parseAddress` @native foreign decl) + their identity facets.
const loaded = loadFenelModule(EMAIL_FENEL, "email", { label: "Email" });

// ---------------------------------------------------------------------------
// Capability — derive the `EmailService` dispatch seed from the `.fenel`
// record-of-methods type (the algebra.fenel `seedFromType` precedent). Loaded
// SEPARATELY from `email.fenel` so the `EmailService` type does NOT enter
// `emailModule.entities` (the 14-data-type roster). `EmailService` is nominal
// (dispatched by provider name via `resolveCapabilityMethod`), so the seed
// needs only the method NAMES + signatures; the classParam is vestigial.
// Re-exported by name — `system-entities.ts` `defineClass`s it directly.
// ---------------------------------------------------------------------------

// Exported for the spec-entity routing in system-entities.ts (signature-
// substrate P4-prep D0b): the deleted fenel/std/interfaces.fenel EmailService
// copy re-sources its spec-entity face from this module-local owner.
export const emailCapabilitySource = loadFenelModule(EMAIL_CAPABILITY_FENEL, "email");
const emailServiceEntity = emailCapabilitySource.entities?.find(
  (e) => e.id === "EmailService",
);
if (!emailServiceEntity?.type || !emailServiceEntity.typeScheme) {
  throw new Error("email: capability.fenel is missing the EmailService type");
}

export const emailCapabilities: Interface[] = [
  seedFromType("EmailService", emailServiceEntity.type, "a", {
    typeScheme: emailServiceEntity.typeScheme,
    sourceModule: emailCapabilitySource,
  }),
];

// ---------------------------------------------------------------------------
// Providers — the 5 `EmailService` instances projected from `instances.fenel`
// (codec sidecar pattern). Methods are fnId strings (the qualified dispatch
// name); `priority` + `label` are lifted to the instance slots. Re-exported by
// name — `system-entities.ts` registers them via `addInstance` directly.
// ---------------------------------------------------------------------------

export const emailProviders: Instance[] = (
  loadFenelModule(EMAIL_INSTANCES_FENEL, "email", { dispatchInstanceFile: true }).instances ?? []
).filter((i) => i.typeName === "EmailService");

// ---------------------------------------------------------------------------
// Provider credential requirements — read back from the `.fenel` sidecar.
//
// The 4 `ProviderCredentials { capability, provider, envVars }` value-decls in
// `credentials.fenel` project (via {dispatchInstanceFile:true}) to
// `{typeName:"ProviderCredentials", methods:{capability, provider, envVars}}`.
// Reassemble the byte-identical `ProviderCredentials[]` in source order
// (mailgun / postmark / ses / resend). NOT merged into `emailModule.instances`
// — pure data, no registry / law footprint.
// ---------------------------------------------------------------------------

const credentialRequirements: ProviderCredentials[] = (
  loadFenelModule(EMAIL_CREDS_FENEL, "email", { dispatchInstanceFile: true }).instances ?? []
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
// Module export — `loaded` carries the header (name="email", label), the 14
// entities, the 5 functions (4 Fenel-bodied + the `parseAddress` bodyless
// @native foreign decl), and their identity facets (Codeable / Labelable /
// Describable / Taggable — NO stored Categorizable; the `email` category
// derives at read time from the `email:` id prefix, Phase 3j). The ffi
// `emailNatives` map is rekeyed to the `email:` id-namespace; the creds ride
// the `credentialRequirements` field. The capability seed + provider instances
// are exported separately (above) for direct registration by
// `system-entities.ts`.
// ---------------------------------------------------------------------------

export const emailModule: FenelModule = {
  ...loaded,
  credentialRequirements,
  nativeImpls: rekeyNativesById(emailNatives, "email"),
};

// Re-export the ffi leaf's value types + the `parseAddressNative` helper the
// runtime webhook parsers (`mailgun-webhook.ts` / `postmark-webhook.ts`) import
// by name from `@fenel/engine/modules/email`.
export { parseAddressNative };
export type { AddressValue, BodyValue };

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("modules/email") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_modules_email from "./email";
import { registerEngineModule as __reg_modules_email } from "../engine-require";
__reg_modules_email("modules/email", __self_modules_email);
