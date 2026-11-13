// ---------------------------------------------------------------------------
// locale — pure LocaleString projections: canonical first-entry text and
// reader-language selection with exact/base/English/canonical fallback.
//
// The body lives in `fenel/modules/core/locale.fenel`. The `module locale
// where` header overrides the `loadFenelModule` name arg, so the function's
// fnId is `locale:canonical` (NOT `core-locale:canonical`); the name arg is
// the source-of-truth fallback only when no header is present.
//
// Why a separate module (not folded into engineModule)? Two reasons:
//
//   1. The fnId carries the `locale:` prefix — embedding it under
//      `engineModule` (name `"engine"`) would require either renaming the
//      fnId to `engine:canonical` (breaks every existing caller) or special-
//      casing the loader to ignore the module header (breaks the
//      header-driven identity invariant in `loadFenelModule`).
//
//   2. design/module-system.md treats locale as its own substrate tier —
//      cleaner to surface that boundary in the module set than to bury it
//      inside engine's mixed-concerns roster.
//
// The canonical manifest supplies these bodies to seed and execute registries;
// the internal engine harness also includes them for identifiable projections.
// Isolated registries calling these bodies must include this module explicitly.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import LOCALE_FENEL from "../../../../../fenel/modules/core/locale.fenel?raw";

export const localeModule: FenelModule = loadFenelModule(LOCALE_FENEL, "locale");

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("modules/locale") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_modules_locale from "./locale";
import { registerEngineModule as __reg_modules_locale } from "../engine-require";
__reg_modules_locale("modules/locale", __self_modules_locale);
