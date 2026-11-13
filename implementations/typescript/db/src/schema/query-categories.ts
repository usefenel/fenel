import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const queryCategories = pgTable(
  "query_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    parentId: uuid("parent_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("query_categories_account_idx").on(table.accountId),
    index("query_categories_parent_idx").on(table.parentId),
  ],
);

export const queryCategoryMembers = pgTable(
  "query_category_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => queryCategories.id, { onDelete: "cascade" }),
    queryId: uuid("query_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("qcm_category_idx").on(table.categoryId),
    index("qcm_query_idx").on(table.queryId),
  ],
);
