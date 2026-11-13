// ---------------------------------------------------------------------------
// module-manifest — the ONE role-tagged enumeration of the engine's modules.
//
// registry-unification Phase 1. Before this file, the set of Fenel modules that
// make up "the registry" was enumerated in THREE hand-maintained lists that had
// to stay consistent but drifted — causing two production-down bugs in a single
// session (2026-07-05): `dashboard:*` never seeded ("Function not found"), and an
// engine representation fn unreachable from the durable path ("Unknown action").
//
// The three consumers, by ROLE:
//   A · seed + catalog  — `type-catalog.ts` `ALL_MODULES` → `getCatalog()` →
//                         `seedSystemFunctions` (upserts every fn into the
//                         `functions` table) + the `/types` / FN_INDEX surfaces.
//   B · durable execute — `runtime/evaluator.ts` `loadRegistry` — what the
//                         durable evaluator can EXECUTE.
//   C · engine harness  — `engine-bodies-dispatch.ts` `getHarness` — engine-
//                         internal pure-body dispatch (parser / checker / decide).
//
// This manifest is the single source of truth for A + B. **C is deliberately NOT
// manifest-derived** — its modules (`engineModule` etc.) are resolved via lazy
// `engineRequire` to preserve browser eval order (browser-engine-compat Phase
// 1b); static-importing them into an eager manifest array would reintroduce the
// `/app` blank-screen cascade. C is also engine-internal, was never part of the
// drift bugs, and sits outside the `execute ⊆ seed` invariant the guard enforces.
// See `workstreams/registry-unification/notes/phase-0-module-role-matrix.md`.
//
// ORDER: the array is anchored to list-B (execute) order, because execute order
// is DISPATCH-SEMANTIC (`createRegistry`'s `codeNameToIdMap` is LAST-WINS on a
// bare-codeName collision, `registry.ts:180`) — so `modulesFor("execute")`
// preserves list B as an unchanged prefix. Pure media/presentation modules are
// appended in their existing seed order so editor and runtime both receive
// their definitions. The engine declaration projection remains seed-only;
// seed/catalog order is NON-semantic (`buildFunctions` dedups by unique
// `fn.id`; `seedSystemFunctions` upserts in an id-keyed loop), so their placement
// is free.
//
// THE INVARIANT (enforced by `module-manifest.test.ts`, wired into CI):
//   every module tagged `execute` is also tagged `seed`
// so `seedSystemFunctions` covers everything a seeded durable body can reach via
// `callUserFunction`. The sole sanctioned gap is the 6 engine representation fns,
// covered by `runtime/evaluator.ts`'s `representationBridgeModule` native shim.
// ---------------------------------------------------------------------------

import type { FenelModule } from "./types";

// --- execute-tagged modules (list B order — DISPATCH-SEMANTIC, do not reorder) --
import { stdModule } from "./modules/std";
import { controlModule } from "./modules/control";
import { ioModule } from "./modules/io";
import { timeModule } from "./modules/time";
import { emailModule } from "./modules/email";
import { ecomModule } from "./modules/ecom";
import { twitterModule } from "./modules/twitter";
import { socialModule } from "./modules/social";
import { licenseModule } from "./modules/license";
import { templateModule } from "./modules/templates";
import { aiModule } from "./modules/ai";
import { telegramModule } from "./modules/telegram";
import { notionModule } from "./modules/notion";
import { stateModule } from "./modules/state";
import { storageModule } from "./modules/storage";
import { cryptoModule } from "./modules/crypto";
import { dispatchModule } from "./modules/dispatch";
import { codecModule } from "./modules/codec";
import { emailWebhooksModule } from "./modules/email-webhooks";
import { notifyModule } from "./modules/notify";
import { dashboardModule } from "./modules/dashboard";
import { webhooksModule } from "./modules/webhooks";
import { subscriptionsModule } from "./modules/subscriptions";
import { proxyLinksModule } from "./modules/proxyLinks";
import { pagesModule } from "./modules/pages";
import { receiptModule } from "./modules/receipt";
import { inventoryModule } from "./modules/inventory";
import { purchasesModule } from "./modules/purchases";
import { paymentsModule } from "./modules/payments";
import { profilesModule } from "./modules/profiles";
import { importsModule } from "./modules/imports";
import { itemsModule } from "./modules/items";
import { typesModule } from "./modules/types";
import { plansModule } from "./modules/plans";
import { entitlementsModule } from "./modules/entitlements";
import { channelsModule } from "./modules/channels";
import { actionResultModule } from "./modules/action-result";
import { authModule } from "./modules/auth";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { proverModule } from "./modules/prover";
import { compileJsModule } from "./modules/compile-js";
import { evaluatorStrategiesModule } from "./modules/evaluator-strategies";
import { queryModule } from "./modules/query";
// --- media/presentation modules, then the seed-only declaration projection ----
import { pictureModule } from "./modules/picture";
import { soundModule } from "./modules/sound";
import { animationModule } from "./modules/animation";
import { movieModule } from "./modules/movie";
import { trackModule } from "./modules/track";
import { eventsModule } from "./modules/events";
import { gamesModule } from "./modules/games";
import { crossmodalModule } from "./modules/crossmodal";
import { pathModule } from "./modules/path";
import { viewModule } from "./modules/view";
import { setExprEntityModule } from "./modules/set-expr-entities";
import { PUBLIC_DEMO_MODULES } from "./modules/public-demos";
import { localeModule } from "./modules/locale";
import { unitsModule } from "./modules/units";

/** The roles a module participates in. `harness` is intentionally absent — the C
 *  list is not manifest-derived (see the file header). */
export type ModuleRole = "seed" | "execute";

export interface ManifestEntry {
  module: FenelModule;
  roles: ModuleRole[];
}

const SEED_AND_EXECUTE: ModuleRole[] = ["seed", "execute"];
const SEED_ONLY: ModuleRole[] = ["seed"];

/** The canonical role-tagged module manifest. Order = list-B (execute) order for
 *  the execute modules, then the seed-only modules. */
export const MODULE_MANIFEST: ManifestEntry[] = [
  // execute-tagged (also seeded) — list-B order, DISPATCH-SEMANTIC.
  { module: stdModule, roles: SEED_AND_EXECUTE },
  { module: controlModule, roles: SEED_AND_EXECUTE },
  { module: ioModule, roles: SEED_AND_EXECUTE },
  { module: timeModule, roles: SEED_AND_EXECUTE },
  { module: emailModule, roles: SEED_AND_EXECUTE },
  { module: ecomModule, roles: SEED_AND_EXECUTE },
  { module: twitterModule, roles: SEED_AND_EXECUTE },
  { module: socialModule, roles: SEED_AND_EXECUTE },
  { module: licenseModule, roles: SEED_AND_EXECUTE },
  { module: templateModule, roles: SEED_AND_EXECUTE },
  { module: aiModule, roles: SEED_AND_EXECUTE },
  { module: telegramModule, roles: SEED_AND_EXECUTE },
  { module: notionModule, roles: SEED_AND_EXECUTE },
  { module: stateModule, roles: SEED_AND_EXECUTE },
  { module: storageModule, roles: SEED_AND_EXECUTE },
  { module: cryptoModule, roles: SEED_AND_EXECUTE },
  { module: dispatchModule, roles: SEED_AND_EXECUTE },
  { module: codecModule, roles: SEED_AND_EXECUTE },
  { module: emailWebhooksModule, roles: SEED_AND_EXECUTE },
  { module: notifyModule, roles: SEED_AND_EXECUTE },
  { module: dashboardModule, roles: SEED_AND_EXECUTE },
  { module: webhooksModule, roles: SEED_AND_EXECUTE },
  { module: subscriptionsModule, roles: SEED_AND_EXECUTE },
  { module: proxyLinksModule, roles: SEED_AND_EXECUTE },
  { module: pagesModule, roles: SEED_AND_EXECUTE },
  { module: receiptModule, roles: SEED_AND_EXECUTE },
  { module: inventoryModule, roles: SEED_AND_EXECUTE },
  { module: purchasesModule, roles: SEED_AND_EXECUTE },
  { module: paymentsModule, roles: SEED_AND_EXECUTE },
  { module: profilesModule, roles: SEED_AND_EXECUTE },
  { module: importsModule, roles: SEED_AND_EXECUTE },
  { module: itemsModule, roles: SEED_AND_EXECUTE },
  { module: typesModule, roles: SEED_AND_EXECUTE },
  { module: plansModule, roles: SEED_AND_EXECUTE },
  { module: entitlementsModule, roles: SEED_AND_EXECUTE },
  { module: channelsModule, roles: SEED_AND_EXECUTE },
  { module: actionResultModule, roles: SEED_AND_EXECUTE },
  { module: authModule, roles: SEED_AND_EXECUTE },
  { module: decidableMembershipModule, roles: SEED_AND_EXECUTE },
  { module: proverModule, roles: SEED_AND_EXECUTE },
  { module: compileJsModule, roles: SEED_AND_EXECUTE },
  { module: evaluatorStrategiesModule, roles: SEED_AND_EXECUTE },
  { module: queryModule, roles: SEED_AND_EXECUTE },
  // Pure media definitions must agree in preview, source authoring and execution.
  // Keeping this existing seed order also makes install namespace reservations
  // cover exactly the same media names as the runtime registry.
  { module: pictureModule, roles: SEED_AND_EXECUTE },
  { module: soundModule, roles: SEED_AND_EXECUTE },
  { module: animationModule, roles: SEED_AND_EXECUTE },
  { module: movieModule, roles: SEED_AND_EXECUTE },
  { module: trackModule, roles: SEED_AND_EXECUTE },
  { module: eventsModule, roles: SEED_AND_EXECUTE },
  { module: gamesModule, roles: SEED_AND_EXECUTE },
  { module: crossmodalModule, roles: SEED_AND_EXECUTE },
  { module: pathModule, roles: SEED_AND_EXECUTE },
  // The locus authors ordinary view:placeAll expressions. Its account editor
  // and evaluator must receive their definitions in both profiles, not only
  // the system harness or browser seed registry.
  { module: viewModule, roles: SEED_AND_EXECUTE },
  // Declaration dependency of the `authority` module, whose envelope rows are
  // typed over `SetExpr` and whose member envelope CONSTRUCTS `SeEnum`. Keep
  // the full engine executable surface out of seed/execute while exposing the
  // exact source-owned data graph and ReflectionValue's sole Type helper to
  // the authoritative seed profile. (It arrived here for the retired permissions helpers; rights R2a
  // deleted those and inherited the dependency.)
  { module: setExprEntityModule, roles: SEED_ONLY },
  // Authored examples share exact callable/type identities in the public
  // reader and retain their definitions when an ordinary call is saved.
  ...PUBLIC_DEMO_MODULES.map(candidate => ({ module: candidate, roles: SEED_AND_EXECUTE })),
  // Public language projections call the existing pure locale bodies. Retain
  // the established execute order and append their shared dependency once.
  { module: localeModule, roles: SEED_AND_EXECUTE },
  { module: unitsModule, roles: SEED_AND_EXECUTE },
];

/** The modules that participate in `role`, in manifest order. Each consumer
 *  filters by its role instead of hand-maintaining a parallel list. */
export function modulesFor(role: ModuleRole): FenelModule[] {
  return MODULE_MANIFEST.filter((e) => e.roles.includes(role)).map((e) => e.module);
}
