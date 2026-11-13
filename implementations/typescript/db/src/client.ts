import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

let client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;

  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL environment variable is required");

  client = postgres(url);
  _db = drizzle(client, { schema });
  return _db;
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    _db = null;
  }
}

export type Database = ReturnType<typeof getDb>;
