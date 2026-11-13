// ---------------------------------------------------------------------------
// Social — typed-function-references FenelModule-retirement Phase FM-retire-3
// seam.
//
// The 2 `defineFunction` specs (`crosspost` + `engagement_score`), the 3
// hand-written `Interface`s (`Social` / `Conversational` / `Discoverable`), the 4
// hand-written `Instance` consts (twitter/telegram/instagram), and the
// `socialMethods` / `*PostConstraints` / `_engagement` scaffolding (~262 LOC) are
// RETIRED. Source of truth is three `module social where` `.fenel` files:
//
//   - `social.fenel`      — `crosspost` (bodyless `@native` + the no-corner-cut
//     `CrosspostResult` return, fixing the empty-record placeholder) +
//     `engagement_score` (body unchanged; `@category` dropped) + the
//     `SocialTarget` / `CrosspostResult` entities. Consolidates the former
//     standalone `engagement-score.fenel` (now DELETED).
//   - `typeclasses.fenel` — the 3 capability classes, super-as-FIELD (the
//     `HasSocialMedia` shape). Derived to `Interface`s here via `seedFromType`
//     so the existing `MODULE_TYPECLASSES` registration path in
//     `system-entities.ts` is UNCHANGED (the `socialTypeclasses` export name +
//     `Interface[]` type are preserved → 0 consumer edits).
//   - `instances.fenel`   — the 4 dispatch instances (dangling method handles
//     kept INERT; the `_constraints`/`_engagement` non-method metadata DROPPED
//     as provably-inert retired-form demo data — see the file header).
//
// 0 `defineFunction`. Export names `socialModule` + `socialTypeclasses`
// preserved.
// ---------------------------------------------------------------------------

import type { FenelModule, Interface } from "../types";
import { loadFenelModule } from "../fenel-module";
import { seedFromType } from "../effect-dispatch";
import SOCIAL_FENEL from "../../../../../fenel/modules/social/social.fenel?raw";
import TYPECLASSES_FENEL from "../../../../../fenel/modules/social/interfaces.fenel?raw";
import INSTANCES_FENEL from "../../../../../fenel/modules/social/instances.fenel?raw";

// Functions (`engagement_score` body + `crosspost` bodyless `@native`) + identity
// facets + the `SocialTarget` / `CrosspostResult` entities.
const loaded = loadFenelModule(SOCIAL_FENEL, "social", { label: "Social Platforms" });

// The 4 Social/Conversational dispatch instances (dangling handles, inert).
const socialInstances =
  loadFenelModule(INSTANCES_FENEL, "social", { dispatchInstanceFile: true }).instances ?? [];

// The capability HIERARCHY — derived from the `.fenel` class records via
// `seedFromType` (the `HasSocialMedia`/`HasTelegramBot` super-as-field path,
// effect-dispatch.ts). The registry is not built at module-eval time, so the
// super-recognizer is a module-local class-name oracle (`isSocialClass`) instead
// of `reg.getClass` — equivalent here (the only class referenced in a super
// position is `Social`). `seedFromType` erases the super FIELD and stamps
// `seed.supers` in the `{class: Id<Social>, args:[{$var:"platform"}]}` shape the
// deleted hand-written `supers:[]` arrays carried. ORDER-SENSITIVE: `Social`
// (no super) is first in the array → `MODULE_TYPECLASSES` `defineClass`'s it
// before `Conversational` / `Discoverable` (super = `Social`), so
// `dispatch-registry.ts:resolve` finds the super registered (Decision #4).
const socialClassSource = loadFenelModule(TYPECLASSES_FENEL, "social");
const socialClassEntities = socialClassSource.entities ?? [];
const socialClassNames = new Set(socialClassEntities.map((e) => e.id));
const isSocialClass = (n: string) => socialClassNames.has(n);

/** Exported for direct registration into the shared `dispatchRegistry` from
 *  system-entities.ts (`MODULE_TYPECLASSES`). Social-first ordering preserved. */
export const socialTypeclasses: Interface[] = ["Social", "Conversational", "Discoverable"].map(
  (name) => {
    const entity = socialClassEntities.find((e) => e.id === name);
    if (!entity?.type) {
      throw new Error(`social.ts: fenel/modules/social/typeclasses.fenel is missing class ${name}`);
    }
    return seedFromType(name, entity.type, "platform", {
      isRegisteredClass: isSocialClass,
      ...(entity.typeScheme === undefined ? {} : { typeScheme: entity.typeScheme }),
      sourceModule: socialClassSource,
    });
  },
);

export const socialModule: FenelModule = {
  name: "social",
  label: loaded.label,
  functions: loaded.functions,
  instances: [
    ...socialInstances,
    ...(loaded.instances ?? []),
  ],
  entities: loaded.entities ?? [],
};
