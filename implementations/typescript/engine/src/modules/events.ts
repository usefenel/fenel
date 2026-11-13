// ---------------------------------------------------------------------------
// Events — module-substrate Phase 3i seam (DISJOINT plain/ctx).
//
// events is FRP for Fenel: `Event<a>` (a list of timestamped payloads),
// `Behavior<a>` (a function from time to a value), and the bridges between
// them (`step` / `accum`) and into the media cluster (`behaviorToAnim` /
// `behaviorToSound`). It is a DISJOINT plain/ctx module (= picture's 3f
// shape): `_stepLookup` is a plain native (a pure most-recent scan), the
// other 6 natives (`step` / `accum` / `_accumFold` / `sampleBehavior` /
// `behaviorToAnim` / `behaviorToSound`) are ctx natives (they build Behavior
// closures + re-enter the evaluator), and `event` / `eventEntry` /
// `sampleEvent` / `constant` are Fenel-bodied.
//
// The ~494-LOC hand-assembled module (10 `defineFunction` specs + inline
// native impls + the 3 sub-`.fenel` body merges) is RETIRED. The source of
// truth is now:
//   - `fenel/modules/events/types.fenel` — the `module events where` header,
//     the 3 entities (EventEntry / Event / Behavior), the 3 Fenel-bodied
//     constructors (CONSOLIDATED from the former event.fenel /
//     event-entry.fenel / sample-event.fenel sidecars, now DELETED), the
//     `constant` helper, and the 7 `@native` foreign declarations;
//   - `fenel/modules/events/ffi/events-ffi.ts` — the 7 native impls split
//     into `eventsNatives` (plain: _stepLookup) + `eventsNativesCtx` (ctx).
//
// Thin seam: load the declarative `.fenel`, import the ffi leaf, route both
// native maps via `rekeyNativesById`, add the 2 Sampleable instances (seam
// consts — Behavior / Event), re-export the `*Native` fns. No `@nativeCtx`
// marker (seam-routing suffices — axis #4).
//
// module-substrate Phase 3p (2026-05-31) — the MERGE-INTO-AN-EXISTING-MODULE op.
// `fenel/modules/events/ingress.fenel` (formerly part of the retired `mixed-
// ingress` bundle) carries the 2 generic-ingress fns `events:emitEvent` +
// `events:eventsInbound`. As the aggregation frontier closed, those MERGED into
// THIS already-migrated module: `ingress.fenel` now carries `module events where`
// and is UNIONed with `types.fenel` via `loadFenelModuleUnion` (both → the
// `events` group). The two files are disjoint (constructors/natives vs the 2
// ingress fns), so the union has 0 id collision; both merged fns infer
// `HasStateIO` at registry build. No new boot-list entry — `eventsModule` was
// already booted; it simply grows by 2 fns.
// ---------------------------------------------------------------------------

import type { FenelModule, Instance } from "../types";
import { rekeyNativesById } from "../function-builder";
import { loadFenelModule, loadFenelModuleUnion } from "../fenel-module";
import {
  eventsNatives,
  eventsNativesCtx,
  stepNative,
  accumNative,
  sampleBehaviorNative,
  behaviorToAnimNative,
  behaviorToSoundNative,
} from "../../../../../fenel/modules/events/ffi/events-ffi";
import EVENTS_SRC from "../../../../../fenel/modules/events/types.fenel?raw";
import EVENTS_INGRESS_FENEL from "../../../../../fenel/modules/events/ingress.fenel?raw";
import EVENTS_INSTANCES_SRC from "../../../../../fenel/modules/events/instances.fenel?raw";

// Declarative half — the UNION of `types.fenel` (header + 3 entities + the 3
// Fenel-bodied constructors + constant + the 7 `@native` foreign declarations)
// and `ingress.fenel` (the 2 merged `events:*` ingress fns). Both carry
// `module events where`, so they group into one `events` module.
// `loaded.instances` holds the per-function identity ClassInstances for ALL of
// them; `loaded.functions` carries constructors + natives + the 2 ingress fns.
const eventsGroups = loadFenelModuleUnion(
  [
    { src: EVENTS_SRC, name: "events" },
    { src: EVENTS_INGRESS_FENEL, name: "events" },
  ],
  { labels: { events: "Events" } },
);
const loaded = eventsGroups.find((m) => m.name === "events");
if (!loaded) {
  throw new Error(
    "events: loadFenelModuleUnion did not yield the `events` group — Fenel sources out of sync with the seam (events/types.fenel + events/ingress.fenel must both carry `module events where`)",
  );
}

const allInstances: Instance[] = [
  ...(loaded.instances ?? []),
  // Sampleable: Behavior → sampleBehavior, Event → sampleEvent. Authored as
  // `.fenel` value-decls in the per-module instances sidecar (typed-function-
  // references Phase 10c — the loader flip lowers the point-free method ref to a
  // dispatch-ready `{$ref}` codeName handle; the registry resolves it
  // id-or-codeName to the canonical fnId).
  ...(loadFenelModule(EVENTS_INSTANCES_SRC, "events", { dispatchInstanceFile: true }).instances ?? []),
];

export const eventsModule: FenelModule = {
  ...loaded,
  instances: allInstances,
  // Plain native (_stepLookup) → `nativeImpls`; ctx natives → `nativeImplsCtx`.
  // Both rekeyed codeName → `events:codeName`.
  nativeImpls: rekeyNativesById(eventsNatives, "events"),
  nativeImplsCtx: rekeyNativesById(eventsNativesCtx, "events") as Record<
    string,
    (ctx: unknown, ...args: unknown[]) => unknown
  >,
};

// Re-export the native impls — preserved byte-for-byte from the retired seam,
// so no consumer needs an edit.
export {
  stepNative,
  accumNative,
  sampleBehaviorNative,
  behaviorToAnimNative,
  behaviorToSoundNative,
};
