-- Migration: 0007_plan_terms_expression
-- Adds `terms` jsonb column to plans table for JSON Logic expression model.
-- Plans can now define their entire offer as a single expression:
--   context (profile, time, choice) → Term[] (payment, subscription, grant, revoke, ...)
-- The old columns (amount, currency, duration, providers, grants, steps) remain
-- for backward compatibility and 1-step plan shorthand.

ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "terms" jsonb;
