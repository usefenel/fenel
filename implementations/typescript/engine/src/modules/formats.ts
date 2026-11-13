// ---------------------------------------------------------------------------
// formats — derived format-family factories (Fenel-bodied).
//
// Phase 3.3d (typeclass-substrate-completion, 2026-05-29). The three DERIVED
// typeclass-instance families — HandleFormat(platform) / PhoneFormat(country) /
// DateFormat(locale) — moved off TS, Fenel-first. Their factory LOGIC + rules
// DATA now live in `fenel/modules/formats/factories.fenel`; this module is the
// thin TS surface that
//   1. exposes the parsed Fenel functions as `formatsModule` so the engine's
//      pure-body dispatch harness (engine-bodies-dispatch.ts) can run them, and
//   2. provides memoised TS wrappers — same names + signatures as the retired
//      `entity-typeclasses.ts` factories — that invoke the bodies via
//      `dispatchEngineBody`. The `regexSet` leaf throws LOUD at boot on a
//      malformed curated regex (unreachable for real input), so the wrappers
//      need no unwrap — the bodies yield `List Instance` directly.
//
// The bodies CANNOT run during `buildRegistry` (the harness pulls in the
// system-entities registry, which is mid-initialisation there — accessing it
// would hit the TDZ on `systemEntities`). The wrappers are therefore invoked
// lazily, after module init: the catalog (`type-catalog.ts`) reads them when
// `/types` is built, and dispatch registration happens at the runtime post-boot
// stage (`system-entities.ts:ensureDerivedFormatInstancesRegistered`, called
// from `runtime/src/evaluator.ts:loadRegistry`). See the roadmap's Phase 3.3d
// notes for the full boot-ordering rationale.
//
// `regexSet` (the one new substrate leaf) lives in `std.ts`; this module never
// touches regex parsing itself. ExchangeRate stays a TS factory in
// entity-typeclasses.ts (deferred live feed — design/reactivity.md).
// ---------------------------------------------------------------------------

import type { FenelModule, SetExpr } from "../types";
import type { Instance } from "../class-types";
import { loadFenelModule } from "../fenel-module";
import { dispatchEngineBody } from "../engine-bodies-dispatch";
import { countries, platforms, type Country, type Platform } from "../reference-data";
import FACTORIES_FENEL from "../../../../../fenel/modules/formats/factories.fenel?raw";

// The parsed factory functions, exposed as a module so the engine-pure body
// dispatch harness can resolve `formats:deriveHandleInstances` etc. (+ their
// intra-module calls to `sequenceResult` / the rule lookups).
const factoriesModule = loadFenelModule(FACTORIES_FENEL, "formats");

export const formatsModule: FenelModule = {
  name: "formats",
  label: "Formats",
  functions: factoriesModule.functions ?? [],
  instances: factoriesModule.instances ?? [],
  entities: factoriesModule.entities ?? [],
};

// ---------------------------------------------------------------------------
// Memoised wrappers. The factories return `List Instance` directly (the
// `regexSet` leaf throws on a malformed regex, so there's no Result to unwrap).
// The canonical-list case (the only one any caller uses) is memoised so
// repeated catalog builds / boot calls don't re-run the body; a non-canonical
// list (never happens in practice) recomputes.
// ---------------------------------------------------------------------------

let _handle: Instance[] | undefined;
let _phone: Instance[] | undefined;
let _date: Instance[] | undefined;

/** Derive HandleFormat instances from Platform entity data. */
export function deriveHandleInstances(platformList: Platform[] = platforms): Instance[] {
  if (platformList === platforms) {
    if (!_handle) _handle = dispatchEngineBody("formats:deriveHandleInstances", [platformList]) as Instance[];
    return _handle;
  }
  return dispatchEngineBody("formats:deriveHandleInstances", [platformList]) as Instance[];
}

/** Derive PhoneFormat instances from Country entity data. */
export function derivePhoneInstances(countryList: Country[] = countries): Instance[] {
  if (countryList === countries) {
    if (!_phone) _phone = dispatchEngineBody("formats:derivePhoneInstances", [countryList]) as Instance[];
    return _phone;
  }
  return dispatchEngineBody("formats:derivePhoneInstances", [countryList]) as Instance[];
}

/** Build DateFormat instances for all known locales (ISO fallback included).
 *  Date's patterns are total named-set refs (no regex), so the body returns the
 *  `List Instance` directly — no Result wrapper, no `unwrap`. */
export function deriveDateFormatInstances(): Instance[] {
  if (!_date) _date = dispatchEngineBody("formats:deriveDateFormatInstances", []) as Instance[];
  return _date;
}

/** The DateFormat rule (= the instance `methods` record) for a locale. Tries an
 *  exact match, then the base language ("pt-BR" → "pt"), then ISO as the
 *  universal fallback. A thin reader over the Fenel-built instances — the rules
 *  DATA + factory are Fenel; this is the same instance-reader category as
 *  `phoneSetExpr` (no consumers today; preserved for API parity). */
export function dateFormatFor(locale: string): Record<string, unknown> {
  const insts = deriveDateFormatInstances();
  const exact = insts.find((i) => i.args[0] === locale);
  if (exact) return exact.methods;
  const base = locale.split("-")[0]!;
  const baseMatch = base !== locale ? insts.find((i) => i.args[0] === base) : undefined;
  if (baseMatch) return baseMatch.methods;
  return insts.find((i) => i.args[0] === "iso")!.methods;
}

/** Pull the SetExpr out of a DateFormat instance — the validator side.
 *  One-field instance reader (cf. `phoneSetExpr`). */
export function dateSetExpr(instance: Instance): SetExpr {
  return (instance.methods as { pattern: SetExpr }).pattern;
}

// browser-engine-compat Phase 1b: self-register this module's live namespace so
// engineRequire("modules/formats") resolves even at EVAL-TIME (a caller that statically imports
// this module runs its own eval-time builder calls AFTER this module is fully loaded,
// i.e. before the index.ts aggregator runs). See engine-require.ts.
import * as __self_modules_formats from "./formats";
import { registerEngineModule as __reg_modules_formats } from "../engine-require";
__reg_modules_formats("modules/formats", __self_modules_formats);
