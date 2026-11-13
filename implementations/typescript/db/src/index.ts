export { getDb, closeDb, type Database } from "./client";
export {
  appendEvent,
  queryEvents,
  type EventInput,
} from "./event-store";
export * from "./schema/index";
export * from "./queries/profiles";
export * from "./queries/items";
export * from "./queries/plans";
export * from "./queries/entitlements";
export * from "./queries/inventory";
export * from "./queries/purchases";
// forms-collapse Phase 4 Stage 3 — ./queries/forms RETIRED (the forms surface
// is gone; findFormBySlug was its last caller-free helper).
export * from "./queries/email-templates";
export * from "./queries/types";
export * from "./queries/views";
export * from "./queries/functions";
export * from "./queries/catalog-revision";
// Phase 10a-5d-followup-4 — `dispatch_registry` table retired (migration
// 0064). The queries file now wraps `entity_instances` rows under
// `entity_type = <ClassName>Spec`; the legacy `listInstances` /
// `createDispatchInstance` / etc. names survive as projection wrappers
// for caller compatibility.
export * from "./queries/dispatch-instances";
export * from "./queries/entity-instances";
export * from "./queries/field-control-plane";
export * from "./queries/field-definition-bundles";
export * from "./queries/entity-query";
export * from "./queries/saved-queries";
export * from "./queries/function-tracking";
export * from "./queries/traces";
export * from "./queries/pages";
export * from "./queries/registries";
export * from "./queries/source-modules";
export * from "./queries/users";
export * from "./queries/sessions";
export * from "./queries/bots";
// Conversation queries moved into queries/entity-instances.ts (the
// Conversation system entity lives in entity_instances now — no
// dedicated table). cancelStaleConversations + cancelInFlightConversationsByBot
// are re-exported via the entity-instances export above.
export * from "./queries/webhook-events";
export * from "./queries/fenel-email-quota";
export * from "./queries/subscriptions";
export * from "./queries/locus-view-values";
export * from "./queries/locus-root";
export * from "./queries/locus-root-model";
export { setExprToSQL, columnRef, jsonbRef, entityColumnRef, toSnakeCase } from "./set-expr-sql";
