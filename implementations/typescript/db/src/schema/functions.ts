import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accounts } from "./accounts";
import { functionInstanceStatus } from "./enums";
import { registries } from "./registries";

// ---------------------------------------------------------------------------
// Functions — unified per-account FenelFunction storage.
//
// One table holds ALL functions: pure library callables AND durable
// trigger-bearing functions. The distinction lives entirely in the JSONB:
// a function with a `trigger` field is durable and produces instances when
// the trigger fires; one without is just a callable invoked explicitly.
//
// Identity is `id` (UUID); `(account_id, name, version)` is unique so a
// function can have multiple versions and only one active per name.
// ---------------------------------------------------------------------------

export const functions = pgTable(
  "functions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    /** Version — durable functions may have multiple versions; library
     *  functions default to 1. */
    version: integer("version").notNull().default(1),
    /** Active flag — false means the function exists but cannot be
     *  triggered/called. Defaults to true. */
    active: boolean("active").notNull().default(true),
    /** Marks engine-module functions (std, telegram, …) seeded
     *  on api boot. User-defined functions stay false. */
    isSystem: boolean("is_system").notNull().default(false),
    /** Immutable source owner, written only by source-module installation.
     * Cached function JSON supplies display slots; source remains authority. */
    sourceRegistryId: uuid("source_registry_id").references(() => registries.id),
    /** Full FenelFunction record as JSONB — name, params, returns, body,
     *  optional trigger, optional cancelWhen, optional version/active
     *  (which mirror the columns above for in-payload querying). */
    function: jsonb("function").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("functions_account_name_version_idx").on(
      table.accountId,
      table.name,
      table.version,
    ),
    // The authoring command must see exactly one current user root per name.
    // Historical/inactive versions remain versioning-owned and unconstrained.
    uniqueIndex("functions_account_active_user_name_idx")
      .on(table.accountId, table.name)
      .where(sql`${table.active} AND NOT ${table.isSystem}`),
  ],
);

// One row per running invocation of a function. Holds the suspendable
// evaluator state (current step, env, wait filter, …). References the
// unified `functions` table by `function_id`.
export const functionInstances = pgTable(
  "function_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    functionId: uuid("function_id")
      .notNull()
      .references(() => functions.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    // FenelType ref — app-layer (entity_type='profile' Id). Nullable
    // so dashboard-driven io invocations (`/io/invoke`) can create
    // function instances without an associated end-user profile.
    profileId: uuid("profile_id"),
    /** Optional user-supplied name for THIS instance — the value-level
     *  Labelable override. Falls back to the function's own label when null. */
    name: text("name"),
    /** Optional user-supplied icon for THIS instance — the value-level
     *  Iconable override. Falls back to the function's own icon when null. */
    icon: text("icon"),
    status: functionInstanceStatus("status").notNull().default("running"),
    currentStepPath: text("current_step_path"),
    variables: jsonb("variables")
      .$type<Record<string, unknown>>()
      .default({}),
    /** Physical transport provenance; never inferred from user variable keys. */
    variablesEncoding: text("variables_encoding"),
    triggerEvent: jsonb("trigger_event").$type<Record<string, unknown>>(),
    triggerEventEncoding: text("trigger_event_encoding"),
    parentInstanceId: uuid("parent_instance_id"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("function_instances_account_profile_idx").on(
      table.accountId,
      table.profileId,
    ),
    index("function_instances_status_idx").on(table.accountId, table.status),
  ],
);

export const traceKind = pgEnum("span_kind", ["call", "read", "wait", "io", "pure", "let"]);
export const traceStatus = pgEnum("span_status", ["running", "completed", "failed", "suspended"]);

// Execution traces — one row per function call inside a running instance.
export const functionTraces = pgTable(
  "traces",
  {
    id: text("id").primaryKey(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => functionInstances.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    kind: traceKind("kind").notNull(),
    status: traceStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    input: jsonb("input").$type<Record<string, unknown>>(),
    output: jsonb("output"),
    /** Physical provenance for input/output/meta native-atom transport. */
    valuesEncoding: text("values_encoding"),
    error: text("error"),
    capability: text("capability"),
    provider: text("provider"),
    effects: jsonb("effects").$type<string[]>(),
    meta: jsonb("meta"),
    /** Type names referenced by this trace's params/returns (the function's
     *  signature, walked). Powers the type detail page's "Latest activity"
     *  panel: "all traces touching values of type T". GIN-indexed below. */
    valueTypes: jsonb("value_types").$type<string[]>(),
    /** Position of this trace within the body's expression tree (dotted
     *  frame-index path — see `Trace.stepPath` in engine types). Lets the
     *  function-editor overlay map each trace back to the expression node
     *  that produced it. Nullable for backwards-compat. */
    stepPath: text("step_path"),
  },
  (table) => [
    index("traces_instance_idx").on(table.instanceId),
    index("traces_parent_idx").on(table.parentId),
    index("traces_kind_idx").on(table.instanceId, table.kind),
    index("traces_value_types_idx").using("gin", table.valueTypes),
    index("traces_step_path_idx").on(table.instanceId, table.stepPath),
  ],
);
