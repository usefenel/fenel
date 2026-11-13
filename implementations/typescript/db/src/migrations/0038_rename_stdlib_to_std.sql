-- Rename `stdlib:*` function ids to `std:*` per design/naming.md A1.
--
-- All standard-library function ids gain the new `std:` namespace prefix.
-- Source-code rename done in a sibling commit; this migration sweeps any
-- persisted references in JSONB / text columns. Pure text replace of the
-- literal `stdlib:` substring — distinctive enough that user content is
-- vanishingly unlikely to collide.
--
-- Tables touched:
--   functions               -- name (text) + function (jsonb)
--   function_instances      -- variables, trigger_event (jsonb)
--   typeclass_instances     -- args, instance (jsonb)
--   function_triggers       -- trigger, cancel_when, args (jsonb)
--   entity_instances        -- data (jsonb)
--   views                   -- view (jsonb)
--   locus_views             -- view (jsonb)
--   saved_queries           -- query (jsonb)
--   form_definitions        -- type, on_submit, config (jsonb)
--   form_submissions        -- data (jsonb)
--   page_submissions        -- data (jsonb)
--   events                  -- payload (jsonb)
--   subscriptions           -- metadata (text holding json)
--   traces                  -- name (text), input/output/meta (jsonb)
--   registries              -- module (jsonb), source (text)
--
-- Each UPDATE is gated on a `LIKE '%stdlib:%'` predicate so the migration
-- is idempotent and a no-op on already-migrated rows.

BEGIN;

-- functions: rename id-shaped column AND the embedded id inside the JSONB.
-- The unique index is (account_id, name, version); pre-migration only
-- `stdlib:*` rows exist so the rename can't collide with `std:*` rows.
UPDATE functions
SET name     = REPLACE(name, 'stdlib:', 'std:'),
    function = REPLACE(function::text, 'stdlib:', 'std:')::jsonb,
    updated_at = NOW()
WHERE name LIKE 'stdlib:%' OR function::text LIKE '%stdlib:%';

UPDATE function_instances
SET variables     = REPLACE(variables::text,     'stdlib:', 'std:')::jsonb
WHERE variables::text LIKE '%stdlib:%';

UPDATE function_instances
SET trigger_event = REPLACE(trigger_event::text, 'stdlib:', 'std:')::jsonb
WHERE trigger_event::text LIKE '%stdlib:%';

-- typeclass_instances: args (jsonb array of TypeExpr) and instance JSONB
-- both can carry function ids in the args[0] slot for fn-keyed instances
-- (Codeable, Labelable, Categorizable, Storyboardable, …).
UPDATE typeclass_instances
SET args       = REPLACE(args::text,     'stdlib:', 'std:')::jsonb,
    instance   = REPLACE(instance::text, 'stdlib:', 'std:')::jsonb,
    updated_at = NOW()
WHERE args::text LIKE '%stdlib:%' OR instance::text LIKE '%stdlib:%';

UPDATE function_triggers
SET trigger      = REPLACE(trigger::text,      'stdlib:', 'std:')::jsonb,
    cancel_when  = CASE WHEN cancel_when IS NOT NULL
                        THEN REPLACE(cancel_when::text, 'stdlib:', 'std:')::jsonb
                        ELSE cancel_when END,
    args         = CASE WHEN args IS NOT NULL
                        THEN REPLACE(args::text,        'stdlib:', 'std:')::jsonb
                        ELSE args END
WHERE trigger::text     LIKE '%stdlib:%'
   OR cancel_when::text LIKE '%stdlib:%'
   OR args::text        LIKE '%stdlib:%';

UPDATE entity_instances
SET data       = REPLACE(data::text, 'stdlib:', 'std:')::jsonb,
    updated_at = NOW()
WHERE data::text LIKE '%stdlib:%';

UPDATE views
SET view       = REPLACE(view::text, 'stdlib:', 'std:')::jsonb,
    updated_at = NOW()
WHERE view::text LIKE '%stdlib:%';

UPDATE locus_views
SET view       = REPLACE(view::text, 'stdlib:', 'std:')::jsonb,
    updated_at = NOW()
WHERE view::text LIKE '%stdlib:%';

UPDATE saved_queries
SET query      = REPLACE(query::text, 'stdlib:', 'std:')::jsonb,
    updated_at = NOW()
WHERE query::text LIKE '%stdlib:%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL
                     THEN REPLACE(type::text,      'stdlib:', 'std:')::jsonb
                     ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL
                     THEN REPLACE(on_submit::text, 'stdlib:', 'std:')::jsonb
                     ELSE on_submit END,
    config    = CASE WHEN config IS NOT NULL
                     THEN REPLACE(config::text,    'stdlib:', 'std:')::jsonb
                     ELSE config END
WHERE type::text      LIKE '%stdlib:%'
   OR on_submit::text LIKE '%stdlib:%'
   OR config::text    LIKE '%stdlib:%';

UPDATE form_submissions
SET data = REPLACE(data::text, 'stdlib:', 'std:')::jsonb
WHERE data::text LIKE '%stdlib:%';

UPDATE page_submissions
SET data = REPLACE(data::text, 'stdlib:', 'std:')::jsonb
WHERE data::text LIKE '%stdlib:%';

UPDATE events
SET payload = REPLACE(payload::text, 'stdlib:', 'std:')::jsonb
WHERE payload::text LIKE '%stdlib:%';

UPDATE subscriptions
SET metadata = REPLACE(metadata, 'stdlib:', 'std:')
WHERE metadata LIKE '%stdlib:%';

-- traces are append-only execution records; rewriting historical traces
-- keeps the type detail page's "latest activity" panel aligned with the
-- current id namespace.
UPDATE traces
SET name = REPLACE(name, 'stdlib:', 'std:')
WHERE name LIKE '%stdlib:%';

UPDATE traces
SET input = REPLACE(input::text, 'stdlib:', 'std:')::jsonb
WHERE input::text LIKE '%stdlib:%';

UPDATE traces
SET output = REPLACE(output::text, 'stdlib:', 'std:')::jsonb
WHERE output::text LIKE '%stdlib:%';

UPDATE traces
SET meta = REPLACE(meta::text, 'stdlib:', 'std:')::jsonb
WHERE meta::text LIKE '%stdlib:%';

-- registries: source is the canonical .fenel text and module is the parsed
-- cache. fenel/stdlib slugs (registry coordinate) and stdlib: ids inside
-- module bodies both get rewritten.
UPDATE registries
SET slug = REPLACE(slug, 'fenel/stdlib', 'fenel/std')
WHERE slug LIKE '%fenel/stdlib%';

UPDATE registries
SET source = REPLACE(source, 'stdlib:', 'std:')
WHERE source LIKE '%stdlib:%';

UPDATE registries
SET module = REPLACE(module::text, 'stdlib:', 'std:')::jsonb,
    updated_at = NOW()
WHERE module::text LIKE '%stdlib:%';

COMMIT;
