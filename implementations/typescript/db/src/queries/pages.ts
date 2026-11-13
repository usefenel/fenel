// ---------------------------------------------------------------------------
// Page queries — read/write through entity_instances (entity_type='page').
// storage-as-effect Phase 4a — the page_submissions table is retired; page
// submissions are now instances of the form's type (state:tryCreateInstanceByName).
// ---------------------------------------------------------------------------

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../client";
import { entityInstances } from "../schema/entity-instances";
import { accounts } from "../schema";
import type { PageBlock, PageConfig } from "../schema/pages";
import {
  createEntityInstance,
  updateEntityInstance,
  getEntityInstance,
  deleteEntityInstance,
  listEntityInstances,
} from "./entity-instances";

type PageRow = {
  id: string;
  accountId: string;
  slug: string;
  name: string;
  published: boolean;
  blocks: PageBlock[];
  config: PageConfig;
  createdAt: Date;
  updatedAt: Date;
};

function flatten(row: typeof entityInstances.$inferSelect): PageRow {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    accountId: row.accountId,
    slug: (data.slug as string) ?? "",
    name: (data.name as string) ?? "",
    published: (data.published as boolean) ?? false,
    blocks: (data.blocks as PageBlock[]) ?? [],
    config: (data.config as PageConfig) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listPages(accountId: string) {
  const rows = await listEntityInstances(accountId, "page");
  return rows
    .map(flatten)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function getPage(accountId: string, id: string) {
  const row = await getEntityInstance(accountId, id);
  if (!row || row.entityType !== "page") return null;
  return flatten(row);
}

export async function getPageBySlug(accountSlug: string, pageSlug: string) {
  const db = getDb();
  // JSONB-aware query: find a row where entity_type='page', data->>'slug'
  // matches, data->>'published'='true', and the account's slug matches.
  const rows = await db
    .select({ instance: entityInstances })
    .from(entityInstances)
    .innerJoin(accounts, eq(entityInstances.accountId, accounts.id))
    .where(
      and(
        eq(accounts.slug, accountSlug),
        eq(entityInstances.entityType, "page"),
        sql`${entityInstances.data}->>'slug' = ${pageSlug}`,
        sql`${entityInstances.data}->>'published' = 'true'`,
      ),
    )
    .limit(1);
  return rows[0] ? flatten(rows[0].instance) : null;
}

export async function createPage(accountId: string, data: {
  slug: string;
  name: string;
  blocks: PageBlock[];
  config?: PageConfig;
  published?: boolean;
}) {
  const inst = await createEntityInstance(accountId, "page", {
    slug: data.slug,
    name: data.name,
    blocks: data.blocks,
    config: data.config ?? {},
    published: data.published ?? false,
  });
  return flatten(inst);
}

export async function updatePage(accountId: string, id: string, data: {
  slug?: string;
  name?: string;
  blocks?: PageBlock[];
  config?: PageConfig;
  published?: boolean;
}) {
  const existing = await getEntityInstance(accountId, id);
  if (!existing || existing.entityType !== "page") return null;
  const merged = { ...(existing.data as Record<string, unknown>), ...data };
  const updated = await updateEntityInstance(accountId, id, merged);
  return updated ? flatten(updated) : null;
}

export async function deletePage(accountId: string, id: string) {
  await deleteEntityInstance(accountId, id);
}
