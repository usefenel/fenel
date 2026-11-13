-- Field identity Phase 2b: physical serialization/uniqueness backstops for
-- atomic definition bundles. Semantic planning remains Fenel-owned.

BEGIN;

-- Fail loudly instead of silently choosing one historical/current function
-- row when account authoring loads the current graph.
DROP INDEX IF EXISTS functions_account_active_user_name_idx;

CREATE UNIQUE INDEX functions_account_active_user_name_idx
  ON functions (account_id, name)
  WHERE active AND NOT is_system;

-- Canonical Field facets have the logical key (account, interface, target,
-- scope). General dispatch permits multiple priority-ranked candidates, so the
-- backstop is intentionally limited to targetEntityType='Field'.
-- DROP is intentional: the first pre-release application used this same name
-- with an over-broad all-dispatch predicate, so IF NOT EXISTS would preserve a
-- semantically wrong index.
DROP INDEX IF EXISTS entity_instances_dispatch_logical_idx;

CREATE UNIQUE INDEX entity_instances_dispatch_logical_idx
  ON entity_instances (
    account_id,
    entity_type,
    ((data->'args'->>0)),
    (CASE
      WHEN data->'scope' IS NULL
        OR data->'scope' = 'null'::jsonb
        OR data->'scope' = '{"kind":"account"}'::jsonb
      THEN '"account"'::jsonb
      ELSE data->'scope'
    END)
  )
  WHERE data->>'targetEntityType' = 'Field'
    AND data->>'type' = entity_type
    AND jsonb_typeof(data->'methods') = 'object'
    AND CASE
      WHEN jsonb_typeof(data->'args') = 'array'
      THEN jsonb_array_length(data->'args') = 1
        AND jsonb_typeof(data->'args'->0) = 'string'
      ELSE false
    END;

COMMIT;
