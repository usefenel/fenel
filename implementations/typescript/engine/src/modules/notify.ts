// ---------------------------------------------------------------------------
// Notify — module-substrate seam (typed-function-references Phase FM-retire-7
// Step 2, 2026-06-06).
//
// FULLY Fenel-authored, thin `loadFenelModule` (the email-webhooks precedent).
// Source of truth is `fenel/modules/notify/tg-dm.fenel` — a `module notify
// where` file carrying `sendTgDm`'s signature + identity facets (@label/
// @description/@tags) + `@ioAction "notify.send_tg_dm"` + `@requires
// "HasStateIO"` + the body, plus its 5 `notify:*` Codeable-only helpers.
//
// Spun out of telegram.ts, where `notify:sendTgDm` was the lone surviving
// `defineFunction` — a `notify:`-prefixed fn hand-hosted in the telegram module.
// The header name `notify` makes the fn id `notify:sendTgDm` byte-identical to
// the retired spec id, so the consumer (core/src/actions/notifications.ts →
// `invokeIOAction(..., "notify:sendTgDm", ...)`) needs 0 edits. The module is
// wired into the SAME registries email-webhooks rides — SYSTEM_MODULES
// (system-entities.ts), ALL_MODULES (type-catalog.ts), the runtime
// `loadRegistry` (runtime/evaluator.ts, where the auto-dispatcher registers the
// `notify.send_tg_dm` IO handler), and the self-host matrix list — but NOT
// `getSystemRegistry` (validation/dependent-type contexts don't resolve it),
// mirroring email-webhooks exactly. 0 `defineFunction`.
// ---------------------------------------------------------------------------

import type { FenelModule } from "../types";
import { loadFenelModule } from "../fenel-module";
import TG_DM_FENEL from "../../../../../fenel/modules/notify/tg-dm.fenel?raw";

export const notifyModule: FenelModule = loadFenelModule(TG_DM_FENEL, "notify");
