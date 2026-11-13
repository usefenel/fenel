// ---------------------------------------------------------------------------
// Email-template queries — read through entity_instances (entity_type='email_template').
// ---------------------------------------------------------------------------

import { eq, and } from "drizzle-orm";
import { getDb } from "../client";
import { entityInstances } from "../schema/entity-instances";

type EmailTemplateRow = {
  id: string;
  accountId: string;
  slug: string;
  subject: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

function flatten(row: typeof entityInstances.$inferSelect): EmailTemplateRow {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    accountId: row.accountId,
    slug: (data.slug as string) ?? "",
    subject: (data.subject as string) ?? "",
    body: (data.body as string) ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findEmailTemplateBySlug(accountId: string, slug: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "email_template"),
      ),
    );
  const match = rows.find((r) => (r.data as { slug?: string })?.slug === slug);
  return match ? flatten(match) : null;
}
