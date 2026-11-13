import { pgEnum } from "drizzle-orm/pg-core";

export const profileType = pgEnum("profile_type", ["person", "group", "ai_agent"]);

export const profileGender = pgEnum("profile_gender", [
  "male",
  "female",
  "other",
  "unknown",
]);

export const itemType = pgEnum("item_type", [
  "digital_file",
  "telegram_group_access",
  "telegram_group_dynamic",
  "subscription",
]);

export const enforceType = pgEnum("enforce_type", ["soft", "hard"]);

export const refundPolicy = pgEnum("refund_policy", [
  "revoke_and_kick",
  "manual",
]);

export const purchaseStatus = pgEnum("purchase_status", [
  "pending",
  "active",
  "completed",
  "refunded",
  "cancelled",
]);

export const paymentStepStatus = pgEnum("payment_step_status", [
  "pending",
  "paid",
  "refunded",
  "failed",
]);

export const functionInstanceStatus = pgEnum("function_instance_status", [
  "running",
  "waiting_timer",
  "waiting_event",
  "awaiting_choice",
  "completed",
  "cancelled",
  "failed",
]);
