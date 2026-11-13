-- Phase 2.5 of typeclass-substrate-completion — rename 20 lowercase-named
-- module capability typeclasses to uppercase. Idempotent.
--
-- Pre-execution probe against staging (2026-05-28) returned zero rows
-- across all 4 carrier shapes for the 20 lowercase names; on production
-- the same is expected. The migration is defensive — it must still ship
-- so any row that does exist gets correctly renamed.
--
-- Carrier shapes handled:
--   1. entity_instances.data->>'class'        — canonical post-0064 SpecInstance shape
--   2. entity_instances.entity_type           — `<lower>Spec` row type marker
--   3. entity_instances.data->>'className'    — pre-canonicalization Shape A header
--   4. typeclass_instances.class_name         — canonical post-Phase-10a SpecInstance column
--   5. Constraint.class.entityId (nested)     — post-0062 typed-Id form — defensive walker
--
-- Renames (locked Phase 2.5 table):
--   messaging              -> Messaging
--   payment                -> Payment
--   ai                     -> AI
--   email                  -> Email
--   telegram_lifecycle     -> TelegramLifecycle
--   telegram_webhooks      -> TelegramWebhooks
--   telegram_messages      -> TelegramMessages
--   telegram_callbacks     -> TelegramCallbacks
--   telegram_media         -> TelegramMedia
--   telegram_files         -> TelegramFiles
--   telegram_chat_admin    -> TelegramChatAdmin
--   telegram_bot_config    -> TelegramBotConfig
--   telegram_payments      -> TelegramPayments
--   telegram_inline_mode   -> TelegramInlineMode
--   telegram_stickers      -> TelegramStickers
--   telegram_passport      -> TelegramPassport
--   telegram_games         -> TelegramGames
--   telegram_polls         -> TelegramPolls
--   telegram_forum_topics  -> TelegramForumTopics
--   telegram_business      -> TelegramBusiness

BEGIN;

-- Build the rename mapping as a temp table so each UPDATE just joins it.
CREATE TEMP TABLE phase2_5_renames (lower text PRIMARY KEY, upper text NOT NULL) ON COMMIT DROP;
INSERT INTO phase2_5_renames (lower, upper) VALUES
  ('messaging',              'Messaging'),
  ('payment',                'Payment'),
  ('ai',                     'AI'),
  ('email',                  'Email'),
  ('telegram_lifecycle',     'TelegramLifecycle'),
  ('telegram_webhooks',      'TelegramWebhooks'),
  ('telegram_messages',      'TelegramMessages'),
  ('telegram_callbacks',     'TelegramCallbacks'),
  ('telegram_media',         'TelegramMedia'),
  ('telegram_files',         'TelegramFiles'),
  ('telegram_chat_admin',    'TelegramChatAdmin'),
  ('telegram_bot_config',    'TelegramBotConfig'),
  ('telegram_payments',      'TelegramPayments'),
  ('telegram_inline_mode',   'TelegramInlineMode'),
  ('telegram_stickers',      'TelegramStickers'),
  ('telegram_passport',      'TelegramPassport'),
  ('telegram_games',         'TelegramGames'),
  ('telegram_polls',         'TelegramPolls'),
  ('telegram_forum_topics',  'TelegramForumTopics'),
  ('telegram_business',      'TelegramBusiness');

-- Shape 1: entity_instances.data->>'class' — flip class field + entity_type.
UPDATE entity_instances ei
SET data        = jsonb_set(ei.data, '{class}', to_jsonb(r.upper)),
    entity_type = r.upper || 'Spec'
FROM phase2_5_renames r
WHERE ei.data->>'class' = r.lower;

-- Shape 2: entity_instances.entity_type matches `<lower>Spec` (rows where
-- the spec entity itself was persisted under the lowercase form). The
-- Shape-1 UPDATE already covers rows where data.class is set; this clause
-- catches rows where only entity_type carries the lowercase name.
UPDATE entity_instances ei
SET entity_type = r.upper || 'Spec'
FROM phase2_5_renames r
WHERE ei.entity_type = r.lower || 'Spec'
  AND (ei.data->>'class' IS NULL OR ei.data->>'class' = r.upper);

-- Shape 3: entity_instances.data->>'className' — pre-canonicalization
-- Shape A. Defensive — staging probe showed zero rows.
UPDATE entity_instances ei
SET data = jsonb_set(ei.data, '{className}', to_jsonb(r.upper))
FROM phase2_5_renames r
WHERE ei.data->>'className' = r.lower;

-- Shape 4: typeclass_instances.class_name — canonical post-Phase-10a
-- SpecInstance column.
UPDATE typeclass_instances ti
SET class_name = r.upper,
    updated_at = NOW()
FROM phase2_5_renames r
WHERE ti.class_name = r.lower;

-- Shape 5 (defensive): nested Constraint class refs in JSONB — post-0062
-- typed-Id form `{class: {$tag: "Id", entityId: "<lower>Spec"}}`. Walker
-- modeled on 0062_constraint_class_to_typed_id.sql but targets the inner
-- entityId field. Idempotent — only rewrites when entityId is in the
-- lowercase-Spec set.

CREATE OR REPLACE FUNCTION pg_temp.phase2_5_walk(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  ent_id text;
  upper_name text;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.phase2_5_walk(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Post-order: recurse children first.
  result := (
    SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.phase2_5_walk(x.v)), '{}'::jsonb)
    FROM jsonb_each(j) AS x(k, v)
  );

  -- Typed-Id Constraint class shape: `{$tag: "Id", entityId: "<X>Spec"}`.
  -- Look up the lowercase form (minus the `Spec` suffix) against the
  -- rename table; rewrite when matched.
  IF result ? '$tag' AND (result ->> '$tag') = 'Id' AND result ? 'entityId' THEN
    ent_id := result ->> 'entityId';
    IF ent_id LIKE '%Spec' THEN
      SELECT r.upper INTO upper_name FROM phase2_5_renames r
        WHERE r.lower = substring(ent_id from 1 for length(ent_id) - 4);
      IF upper_name IS NOT NULL THEN
        result := result || jsonb_build_object('entityId', upper_name || 'Spec');
      END IF;
    END IF;
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply the walker to every JSONB column that historically carries
-- Constraint refs (same 9-column sweep as 0062). LIKE-filter narrows the
-- row scan; walker is idempotent so over-filtering only costs scan time.

UPDATE types
SET type = pg_temp.phase2_5_walk(type),
    updated_at = NOW()
WHERE type::text LIKE '%"$tag":"Id"%';

UPDATE functions
SET function = pg_temp.phase2_5_walk(function),
    updated_at = NOW()
WHERE function::text LIKE '%"$tag":"Id"%';

UPDATE function_instances
SET variables = pg_temp.phase2_5_walk(variables)
WHERE variables::text LIKE '%"$tag":"Id"%';

UPDATE typeclass_instances
SET instance = pg_temp.phase2_5_walk(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"$tag":"Id"%';

UPDATE views
SET view = pg_temp.phase2_5_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"$tag":"Id"%';

UPDATE locus_views
SET view = pg_temp.phase2_5_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"$tag":"Id"%';

UPDATE saved_queries
SET query = pg_temp.phase2_5_walk(query),
    updated_at = NOW()
WHERE query::text LIKE '%"$tag":"Id"%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.phase2_5_walk(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.phase2_5_walk(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"$tag":"Id"%'
   OR on_submit::text LIKE '%"$tag":"Id"%';

UPDATE registries
SET module = pg_temp.phase2_5_walk(module),
    updated_at = NOW()
WHERE module::text LIKE '%"$tag":"Id"%';

COMMIT;
