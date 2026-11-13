import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accounts } from "./accounts";

export const entityInstances = pgTable(
  "entity_instances",
  {
    // DEFAULT dropped (storage-as-effect D3, migration 0087) — the id is always
    // supplied app-side now (`state:*` mints via Fenel `crypto:uuidV4`; the direct
    // `bots` / `dispatch-registry` / `createEntityInstance` inserters mint
    // `crypto.randomUUID()`). No insert relies on `gen_random_uuid()`.
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    entityType: text("entity_type").notNull(), // matches entityDefinitions.name
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    // Null identifies legacy plain JSON. Only explicitly encoded rows may
    // interpret the schema-directed value transport envelope.
    dataEncoding: text("data_encoding"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("entity_instances_account_type_idx").on(table.accountId, table.entityType),
    index("entity_instances_account_idx").on(table.accountId),
    // A canonical Field facet has one logical identity per account, interface,
    // target, and scope. Do not impose this on general dispatch instances:
    // those legitimately admit multiple priority-ranked candidates.
    uniqueIndex("entity_instances_dispatch_logical_idx")
      .on(
        table.accountId,
        table.entityType,
        sql`(${table.data}->'args'->>0)`,
        sql`(case
          when ${table.data}->'scope' is null
            or ${table.data}->'scope' = 'null'::jsonb
            or ${table.data}->'scope' = '{"kind":"account"}'::jsonb
          then '"account"'::jsonb
          else ${table.data}->'scope'
        end)`,
      )
      .where(sql`
        ${table.data}->>'targetEntityType' = 'Field'
        AND ${table.data}->>'type' = ${table.entityType}
        AND jsonb_typeof(${table.data}->'methods') = 'object'
        AND CASE
          WHEN jsonb_typeof(${table.data}->'args') = 'array'
          THEN jsonb_array_length(${table.data}->'args') = 1
            AND jsonb_typeof(${table.data}->'args'->0) = 'string'
          ELSE false
        END
      `),
  ],
);
