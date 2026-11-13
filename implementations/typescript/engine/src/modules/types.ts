// ---------------------------------------------------------------------------
// Types — forms-collapse Phase 1 generic-loader seam.
//
// NEW module (no `.fenel` source before forms-collapse). The source of truth is
// `fenel/modules/types/register.fenel`, which carries the `module types where`
// header, the `registerType : String -> Type -> ActionResult` sig, and the
// `@label` / `@description` / `@tags` / `@ioAction` facet directives the loader
// lifts into the SAME Codeable / Labelable / Describable / Categorizable /
// Taggable / IOInvokable `Instance`s a `defineFunction` spec would emit.
//
// This file is the thin SEAM (mirror of `items.ts`): it loads that `.fenel`
// into a `FenelModule` and is registered at the same four boot surfaces — engine
// `SYSTEM_MODULES` (system-entities.ts), `type-catalog.ts`, runtime
// `loadRegistry` (evaluator.ts), and the self-host matrix generator.
//
// `register_type` is exposed as a public action in core/src/actions/types.ts
// (fnRef = "types:registerType"); dispatch validates {name, schema} against
// paramRecordOf(fn) (D2) and injects `adapter` (D4). `requires: [HasStateIO]` is
// supplied by createRegistry's `attachInferredRequires` pass (transitive from
// the `state:*` calls), as on items. This is D-REG=B (forms-collapse): the
// FenelType-as-action-param action that replaces create_form — see
// fenel/modules/types/register.fenel + design/forms-collapse.md.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import TYPES_FENEL from "../../../../../fenel/modules/types/register.fenel?raw";
import SUBMIT_FENEL from "../../../../../fenel/modules/types/submit.fenel?raw";
import BEHAVIOR_FENEL from "../../../../../fenel/modules/types/behavior.fenel?raw";
import RESOLVE_FENEL from "../../../../../fenel/modules/types/resolve.fenel?raw";

// The `"types"` arg is a fallback only — the `module types where` header in each
// `.fenel` is authoritative (overrides it). `label` preserves the display label.
//
// forms-collapse Phase 3a — the seam now loads THREE `module types where` files
// and merges them (mirror of the forms multi-file merge): register.fenel (the
// register_type substrate, Phase 1) + submit.fenel (the submit dispatcher
// — `submit`, invoked directly by /forms/:slug/submit; storage-as-effect
// Phase 4c renamed the submitFunnel* family → submit*) + behavior.fenel
// (the dissolved `onSubmit` — the `funnelRedirect`/`funnelPage` R1 helpers + the
// re-homed `cfApplication` demo; Phase 3a).
const registerModule = loadFenelModule(TYPES_FENEL, "types", { label: "Types" });
const submitModule = loadFenelModule(SUBMIT_FENEL, "types");
const behaviorModule = loadFenelModule(BEHAVIOR_FENEL, "types");
// storage-as-effect Phase 4e — the public-slug → type resolution + the form
// VIEW (resolveType / formView), composing existing state:* IO leaves. Fixes
// the post-4d slug break (cf_application → CFApplication) in both the GET schema
// (formView) and the canonical pre-validation submit path.
const resolveModule = loadFenelModule(RESOLVE_FENEL, "types");

export const typesModule: FenelModule = {
  name: "types",
  label: registerModule.label ?? "Types",
  functions: [
    ...(registerModule.functions ?? []),
    ...(submitModule.functions ?? []),
    ...(behaviorModule.functions ?? []),
    ...(resolveModule.functions ?? []),
  ],
  instances: [
    ...(registerModule.instances ?? []),
    ...(submitModule.instances ?? []),
    ...(behaviorModule.instances ?? []),
    ...(resolveModule.instances ?? []),
  ],
  entities: [
    ...(registerModule.entities ?? []),
    ...(submitModule.entities ?? []),
    ...(behaviorModule.entities ?? []),
    ...(resolveModule.entities ?? []),
  ],
};
