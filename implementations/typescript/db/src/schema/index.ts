export * from "./enums";
export * from "./accounts";
export * from "./events";
export * from "./plans";
// ts-elimination-completion Phase 2b — `form_definitions` + `form_submissions`
// (`./forms`) and `channels` (`./channels`) tables collapsed into
// `entity_instances` (entity_type 'form' / 'form_submission' / 'channel');
// migration 0073 moves the rows + drops the tables. The schema files are
// deleted; reads/writes go through the generic state.* IO primitives + the
// entity_instances-backed db/queries/forms.ts readers.
export * from "./types";
export * from "./views";
export * from "./functions";
export * from "./function-triggers";
// Phase 10a-5d-followup-4 — `dispatch_registry` table retired (migration
// 0064). Spec-record instances now live in `entity_instances` rows under
// `entity_type = <ClassName>`; the `typeclassInstances` drizzle schema file +
// back-compat alias were deleted here at 0064. The PHYSICAL `typeclass_instances`
// Postgres table lingered as an orphan (read by nothing) until migration 0077
// (typed-function-references Phase 9a-4 follow-up) relocated its well-formed rows
// into `entity_instances` and DROPped it.
export * from "./entity-instances";
export * from "./countries";
// storage-as-effect Phase 3b (migration 0079) — the `currencies` + `languages`
// reference tables were dropped (orphans: empty, no FK, superseded by the
// Phase-3a `.fenel` register; their `reference-data.ts` array views remain). The
// schema files were deleted here. `countries` + the `geographical_sets` pair stay
// (a live FK target + a per-account geo-grouping feature; KEPT pending a later
// register-migration slice).
export * from "./integrations";
// `conversations` table deleted — Conversation is a system entity
// (entity_instances rows of entityType "Conversation") declared in
// engine/src/system-entities.ts; reads/writes use the generic state.*
// IO primitives, see fenel/modules/telegram/conversation.fenel.
export * from "./pages";
export * from "./saved-queries";
export * from "./query-categories";
export * from "./locus-views";
export * from "./registries";
export * from "./auth";
export * from "./webhook-events";
export * from "./fenel-email-quota";
export * from "./subscriptions";
