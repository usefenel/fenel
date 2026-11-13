import {
  pgTable,
  uuid,
  timestamp,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { functions } from "./functions";

// ---------------------------------------------------------------------------
// Function triggers — bindings that say "when event X fires, invoke
// function f with these args, with this cancel predicate".
//
// Many-to-one with functions: one function can have zero or many triggers;
// one trigger fires one function. Kept separate from the function spec
// itself because triggers are a registration concern (when-to-call), not
// a property of the function (what-it-does).
// ---------------------------------------------------------------------------

export const functionTriggers = pgTable(
  "function_triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    /** The function to invoke when the trigger fires. */
    functionId: uuid("function_id")
      .notNull()
      .references(() => functions.id, { onDelete: "cascade" }),
    /** Trigger spec — shape depends on `type`. The runtime knows how to
     *  dispatch based on `type` (e.g. "event:order_placed", "schedule",
     *  "webhook"). Carries event-specific filter params. */
    trigger: jsonb("trigger").$type<Record<string, unknown>>().notNull(),
    /** Optional cancellation predicate — evaluated against the running
     *  instance's context; if true, the instance is cancelled. */
    cancelWhen: jsonb("cancel_when").$type<Record<string, unknown>>(),
    /** Optional argument mapping from the trigger event to the function's
     *  params. When omitted, the runtime passes the full event payload. */
    args: jsonb("args").$type<Record<string, unknown>>(),
    /** Whether this binding is active. Defaults to true. */
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("function_triggers_account_function_idx").on(
      table.accountId,
      table.functionId,
    ),
    index("function_triggers_account_active_idx").on(
      table.accountId,
      table.active,
    ),
  ],
);
