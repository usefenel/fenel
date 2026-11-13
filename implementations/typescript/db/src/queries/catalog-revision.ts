import { sql } from "drizzle-orm";
import { getDb, type Database } from "../client";
import { functions } from "../schema/functions";
import { types } from "../schema/types";

/** Opaque cache revision over the exact rows visible to the list IO leaves.
 * PostgreSQL hashes its own lossless JSON representation. xmin also changes
 * when identical values are rewritten, detecting intervening ABA updates.
 * No schema migration or cache invalidation writes are needed. */
export async function catalogReadRevision(accountId: string, catalog: "types" | "functions", connection?: Pick<Database, "execute">): Promise<string> {
  if (!accountId) throw new Error("Catalog revision requires an account");
  if (catalog !== "types" && catalog !== "functions") throw new Error("Unknown catalog revision");
  const table = catalog === "types" ? types : functions;
  const rows = await (connection ?? getDb()).execute(sql`
    select encode(sha256(convert_to(coalesce(
      jsonb_agg(jsonb_build_array(catalog_row.xmin::text, to_jsonb(catalog_row)) order by catalog_row.id)::text,
      '[]'
    ), 'UTF8')), 'hex') as revision
    from ${table} as catalog_row
    where catalog_row.account_id = ${accountId}
      ${catalog === "types" ? sql`or catalog_row.is_system = true` : sql``}
  `);
  const revision = rows[0]?.revision;
  if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid catalog revision");
  return revision;
}
