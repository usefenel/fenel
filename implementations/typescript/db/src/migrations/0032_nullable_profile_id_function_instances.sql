-- Function instances may now be started without a profile id —
-- specifically by dashboard-driven /io/invoke calls where the
-- caller is a logged-in account rather than an end-user profile.
-- Suspending fns (e.g. `read(Boolean, "ui:confirm")`) need a row
-- to attach to; the profile association isn't relevant for those
-- runs.

ALTER TABLE "function_instances"
  ALTER COLUMN "profile_id" DROP NOT NULL;
