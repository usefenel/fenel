import {
  pgTable,
  text,
  uuid,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// ---- Countries (global, not per-account) ----

export const countries = pgTable("countries", {
  code: text("code").primaryKey(),             // ISO 3166-1 alpha-2 ("US")
  alpha3: text("alpha3").notNull().unique(),    // ISO 3166-1 alpha-3 ("USA")
  name: text("name").notNull(),                 // "United States"
  dialCode: text("dial_code").notNull(),        // "+1"
  currency: text("currency").notNull(),         // ISO 4217 ("USD")
  language: text("language").notNull(),         // ISO 639-1 ("en")
});

// ---- Geographical Sets (per-account arbitrary groupings) ----

export const geographicalSets = pgTable(
  "geographical_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("geographical_sets_account_name_idx").on(table.accountId, table.name),
  ],
);

export const geographicalSetCountries = pgTable(
  "geographical_set_countries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id")
      .notNull()
      .references(() => geographicalSets.id, { onDelete: "cascade" }),
    countryCode: text("country_code")
      .notNull()
      .references(() => countries.code),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("geo_set_countries_unique_idx").on(table.setId, table.countryCode),
    index("geo_set_countries_set_idx").on(table.setId),
  ],
);
