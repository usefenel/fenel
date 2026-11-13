import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const types = pgTable(
  "types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(), // slug: "profile", "item", "plan", ...
    // label + description columns dropped Phase 6 of unified-dispatch.
    // Read via Labelable / Describable typeclass instances:
    //   getLabel(name)        // → LocaleString | undefined
    //   getDescription(name)  // → LocaleString | undefined
    /** Canonical FenelType ($record) shape. */
    type: jsonb("type").$type<Record<string, unknown>>(),
    /** Generic declaration sidecar, saved with the type by the definition bundle. */
    declaration: jsonb("declaration").$type<Record<string, unknown>>(),
    defaultTemplate: text("default_template"), // TypeView name
    defaultTemplateInline: text("default_template_inline"), // TypeView name for inline/ref display
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("types_account_name_idx").on(table.accountId, table.name),
    index("types_account_idx").on(table.accountId),
  ],
);
