// ---------------------------------------------------------------------------
// Purchase + payment_step queries — both entity types live in
// entity_instances. As of 9b-R the bespoke payment_steps table is gone.
// ---------------------------------------------------------------------------

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../client";
import { entityInstances } from "../schema/entity-instances";

type PurchaseRow = {
  id: string;
  accountId: string;
  profileId: string;
  planId: string;
  status: string;
  data: Record<string, unknown>;
  createdAt: Date;
};

function flattenPurchase(row: typeof entityInstances.$inferSelect): PurchaseRow {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const { profileId, planId, status, ...rest } = data as any;
  return {
    id: row.id,
    accountId: row.accountId,
    profileId: (profileId as string) ?? "",
    planId: (planId as string) ?? "",
    status: (status as string) ?? "pending",
    data: rest as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

type PaymentStepRow = {
  id: string;
  purchaseId: string;
  stepSlug: string;
  amount: number;
  currency: string;
  provider: string | null;
  providerRef: string | null;
  status: string;
  paidAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
};

function flattenPaymentStep(row: typeof entityInstances.$inferSelect): PaymentStepRow {
  const d = (row.data ?? {}) as Record<string, unknown>;
  const dateOr = (k: string) => (d[k] ? new Date(d[k] as string) : null);
  return {
    id: row.id,
    purchaseId: (d.purchaseId as string) ?? "",
    stepSlug: (d.stepSlug as string) ?? "",
    amount: Number(d.amount ?? 0),
    currency: (d.currency as string) ?? "USD",
    provider: (d.provider as string | null) ?? null,
    providerRef: (d.providerRef as string | null) ?? null,
    status: (d.status as string) ?? "pending",
    paidAt: dateOr("paidAt"),
    refundedAt: dateOr("refundedAt"),
    createdAt: row.createdAt,
  };
}

export async function findPurchaseById(
  accountId: string,
  purchaseId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.id, purchaseId),
        eq(entityInstances.entityType, "purchase"),
      ),
    )
    .limit(1);
  return row ? flattenPurchase(row) : null;
}

export async function getPurchaseSteps(accountId: string, purchaseId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "payment_step"),
        sql`${entityInstances.data}->>'purchaseId' = ${purchaseId}`,
      ),
    );
  return rows.map(flattenPaymentStep);
}

export async function findPaymentStep(
  accountId: string,
  purchaseId: string,
  stepSlug: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "payment_step"),
        sql`${entityInstances.data}->>'purchaseId' = ${purchaseId}`,
        sql`${entityInstances.data}->>'stepSlug' = ${stepSlug}`,
      ),
    )
    .limit(1);
  return row ? flattenPaymentStep(row) : null;
}
