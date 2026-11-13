import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const savedQueries = pgTable(
  "saved_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    slug: text("slug").notNull(),
    /** Denormalised mirror of this value's `Labelable` / `Describable`
     *  instances, kept for ORDER BY and ILIKE search. The instance is the
     *  definition; these are the index. NULL means "not named", which a value
     *  is allowed to be — it has an id. */
    name: text("name"),
    description: text("description"),
    query: jsonb("query").$type<Record<string, unknown>>().notNull(),
    /** Native JSON value format for the query record; null is legacy plain JSON. */
    queryEncoding: text("query_encoding"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("saved_queries_account_idx").on(table.accountId),
    index("saved_queries_slug_idx").on(table.accountId, table.slug),
  ],
);
