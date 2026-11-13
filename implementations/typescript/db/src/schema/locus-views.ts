import { pgTable, uuid, text, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// ---------------------------------------------------------------------------
// Historical storage carrier for an account's one typed root value.
//
// The row whose id equals accountId stores LocusRootValue ($locusRoot: 1):
// a genuine List Anything expression plus occurrence identities. The first
// authorized mutation migrates legacy rows in one locked transaction; those
// original rows stay archived and are never merged back into the root. Their
// old layout/list API is a projection of the root expression, not another
// authoritative copy. See queries/locus-root.ts and locus-root-model.ts.
// ---------------------------------------------------------------------------

export const locusViews = pgTable(
  "locus_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Typed root carrier, or an unchanged archived legacy layout record. */
    view: jsonb("view").$type<Record<string, unknown>>().notNull(),
    /** Explicit native-value provenance; legacy rows remain ordinary JSON. */
    viewEncoding: text("view_encoding"),
    /** Legacy selection flag. The root row is never active; its compatibility
     * child selection lives in the root carrier. */
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("locus_views_account_idx").on(table.accountId),
  ],
);
