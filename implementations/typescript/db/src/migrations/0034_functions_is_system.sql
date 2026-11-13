-- Add is_system flag to functions so the dashboard can distinguish
-- engine-module functions (stdlib, telegram, …) from user-defined
-- ones without a name-prefix heuristic. The api seeds every module
-- function on boot with is_system = true (idempotent upsert).

ALTER TABLE functions
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;
