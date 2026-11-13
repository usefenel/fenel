// ---------------------------------------------------------------------------
// Plan queries — read through `entity_instances` (entity_type='plan').
// FenelType-driven storage; flatten() restores the legacy PlanRow shape so
// downstream callers (purchase flow, payment-step generation, etc.) keep
// working through the transition.
// ---------------------------------------------------------------------------

import { eq, and } from "drizzle-orm";
import { getDb } from "../client";
import { entityInstances } from "../schema/entity-instances";
import type { PlanGrant, PlanStep } from "../schema/plans";

type PlanRow = {
  id: string;
  accountId: string;
  slug: string;
  name: string;
  amount: number | null;
  currency: string | null;
  duration: string | null;
  providers: string[];
  onRefund: string;
  grants: PlanGrant[];
  steps: PlanStep[] | null;
  terms: Record<string, unknown> | null;
  config: Record<string, unknown>;
  createdAt: Date;
};

function flatten(row: typeof entityInstances.$inferSelect): PlanRow {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const {
    slug, name, amount, currency, duration, providers, onRefund,
    grants, steps, terms,
    ...rest
  } = data as any;
  return {
    id: row.id,
    accountId: row.accountId,
    slug: (slug as string) ?? "",
    name: (name as string) ?? "",
    amount: (amount as number | null) ?? null,
    currency: (currency as string | null) ?? "USD",
    duration: (duration as string | null) ?? null,
    providers: (providers as string[]) ?? [],
    onRefund: (onRefund as string) ?? "manual",
    grants: (grants as PlanGrant[]) ?? [],
    steps: (steps as PlanStep[] | null) ?? null,
    terms: (terms as Record<string, unknown> | null) ?? null,
    config: rest as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

export async function findPlanBySlug(accountId: string, slug: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "plan"),
      ),
    );
  const match = rows.find((r) => (r.data as { slug?: string })?.slug === slug);
  return match ? flatten(match) : null;
}

export async function findPlanById(accountId: string, planId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.id, planId),
        eq(entityInstances.entityType, "plan"),
      ),
    )
    .limit(1);
  return row ? flatten(row) : null;
}

export async function listPlansByAccount(accountId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "plan"),
      ),
    );
  return rows.map(flatten);
}
