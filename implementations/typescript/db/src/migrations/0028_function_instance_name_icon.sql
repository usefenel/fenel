-- Per-instance name and icon overrides for running functions.
--
-- Until now a function instance was identified only by uuid + function_id +
-- profile_id, surfacing in the dashboard as opaque short ids. Names and
-- icons are now first-class on the *value* (the running instance), not just
-- on the *definition* (the function). When null, dashboard rendering falls
-- through to the function's own Labelable/Iconable instance — see
-- `labelOfValue` / `iconOfValue` in `packages/engine/src/identifiable.ts`.
--
-- Idempotent.

ALTER TABLE "function_instances" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "function_instances" ADD COLUMN IF NOT EXISTS "icon" text;
