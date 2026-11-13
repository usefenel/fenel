-- floor-kernel Phase 4 — close the permission-policy SetExpr at-rest lane.
--
-- Migration 0085 lifted the then-measured SetExpr-bearing JSONB columns, but
-- `permission_policies` was absent from that footprint. The default-policy
-- bootstrap continued to write legacy `$all` / `$enum` / `$where` values.
-- Read-only evidence on 2026-07-11 found 40/40 policy rows with a legacy key
-- and 0/40 fully tagged rows, so the Phase-4 scope fence requires this narrow
-- migration rather than leaving the stale data behind a permanent read shim.
--
-- The walker is SetExpr-aware, not a blind JSON rewrite: point values in enum,
-- interval, and where payloads are preserved byte-for-byte. Pattern structure
-- is preserved while its match.pred and group.type SetExpr slots recurse. Only
-- the eleven supported legacy constructors and recursive SetExpr child slots
-- are lifted. Canonical ctor/mu/arrow nodes are retained while any nested
-- legacy children are normalized. Idempotent: a second run finds no legacy node.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_permission_value(j jsonb, value_kind text)
RETURNS jsonb AS $body$
DECLARE
  key_count integer;
  lifted jsonb;
BEGIN
  IF j IS NULL OR jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Pattern is mutually recursive with SetExpr. Preserve its regex structure
  -- and recurse only through the two typed SetExpr slots.
  IF value_kind = 'pattern' THEN
    IF j->>'t' = 'match' AND j ? 'pred' THEN
      RETURN jsonb_set(
        j, '{pred}', pg_temp.lift_permission_value(j->'pred', 'set'), false
      );
    ELSIF j->>'t' IN ('seq', 'alt') AND j ? 'a' AND j ? 'b' THEN
      RETURN jsonb_set(
        jsonb_set(
          j, '{a}', pg_temp.lift_permission_value(j->'a', 'pattern'), false
        ),
        '{b}', pg_temp.lift_permission_value(j->'b', 'pattern'), false
      );
    ELSIF j->>'t' = 'rep' AND j ? 'child' THEN
      RETURN jsonb_set(
        j, '{child}', pg_temp.lift_permission_value(j->'child', 'pattern'), false
      );
    ELSIF j->>'t' = 'group' AND j ? 'child' THEN
      lifted := jsonb_set(
        j, '{child}', pg_temp.lift_permission_value(j->'child', 'pattern'), false
      );
      IF j ? 'type' THEN
        lifted := jsonb_set(
          lifted, '{type}', pg_temp.lift_permission_value(j->'type', 'set'), false
        );
      END IF;
      RETURN lifted;
    END IF;
    RETURN j;
  END IF;

  IF value_kind <> 'set' THEN RETURN j; END IF;

  SELECT count(*) INTO key_count FROM jsonb_object_keys(j);

  -- The eleven legacy constructors are valid only as exact one-key objects.
  IF key_count = 1 THEN
    IF j ? '$all' AND j->'$all' = 'true'::jsonb THEN
      RETURN jsonb_build_object('$tag', 'SeAll');
    ELSIF j ? '$none' AND j->'$none' = 'true'::jsonb THEN
      RETURN jsonb_build_object('$tag', 'SeNone');
    ELSIF j ? '$enum' AND jsonb_typeof(j->'$enum') = 'array' THEN
      RETURN jsonb_build_object('$tag', 'SeEnum', 'values', j->'$enum');
    ELSIF j ? '$interval' AND jsonb_typeof(j->'$interval') = 'object' THEN
      RETURN jsonb_build_object('$tag', 'SeInterval', 'interval', j->'$interval');
    ELSIF j ? '$ref' AND jsonb_typeof(j->'$ref') = 'string' THEN
      RETURN jsonb_build_object('$tag', 'SeRef', 'handle', j->'$ref');
    ELSIF j ? '$pattern' AND jsonb_typeof(j->'$pattern') = 'object' THEN
      RETURN jsonb_build_object(
        '$tag', 'SePattern',
        'pattern', pg_temp.lift_permission_value(j->'$pattern', 'pattern')
      );
    ELSIF j ? '$where' AND jsonb_typeof(j->'$where') = 'object' THEN
      RETURN jsonb_build_object('$tag', 'SeWhere', 'pred', j->'$where');
    ELSIF j ? '$union' AND jsonb_typeof(j->'$union') = 'array' THEN
      SELECT COALESCE(
        jsonb_agg(pg_temp.lift_permission_value(elem, 'set') ORDER BY ord),
        '[]'::jsonb
      ) INTO lifted
      FROM jsonb_array_elements(j->'$union') WITH ORDINALITY AS a(elem, ord);
      RETURN jsonb_build_object('$tag', 'SeUnion', 'branches', lifted);
    ELSIF j ? '$intersect' AND jsonb_typeof(j->'$intersect') = 'array' THEN
      SELECT COALESCE(
        jsonb_agg(pg_temp.lift_permission_value(elem, 'set') ORDER BY ord),
        '[]'::jsonb
      ) INTO lifted
      FROM jsonb_array_elements(j->'$intersect') WITH ORDINALITY AS a(elem, ord);
      RETURN jsonb_build_object('$tag', 'SeIntersect', 'branches', lifted);
    ELSIF j ? '$diff'
      AND jsonb_typeof(j->'$diff') = 'array'
      AND jsonb_array_length(j->'$diff') = 2 THEN
      RETURN jsonb_build_object(
        '$tag', 'SeDiff',
        'left', pg_temp.lift_permission_value(j->'$diff'->0, 'set'),
        'right', pg_temp.lift_permission_value(j->'$diff'->1, 'set')
      );
    ELSIF j ? '$complement' THEN
      RETURN jsonb_build_object(
        '$tag', 'SeComplement',
        'inner', pg_temp.lift_permission_value(j->'$complement', 'set')
      );
    END IF;
  END IF;

  -- Canonical recursive nodes can still contain a legacy child in mixed data.
  IF j->>'$tag' IN ('SeUnion', 'SeIntersect')
    AND jsonb_typeof(j->'branches') = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(pg_temp.lift_permission_value(elem, 'set') ORDER BY ord),
      '[]'::jsonb
    ) INTO lifted
    FROM jsonb_array_elements(j->'branches') WITH ORDINALITY AS a(elem, ord);
    RETURN jsonb_set(j, '{branches}', lifted, false);
  ELSIF j->>'$tag' = 'SeDiff' AND j ? 'left' AND j ? 'right' THEN
    RETURN jsonb_set(
      jsonb_set(j, '{left}', pg_temp.lift_permission_value(j->'left', 'set'), false),
      '{right}', pg_temp.lift_permission_value(j->'right', 'set'), false
    );
  ELSIF j->>'$tag' = 'SeComplement' AND j ? 'inner' THEN
    RETURN jsonb_set(j, '{inner}', pg_temp.lift_permission_value(j->'inner', 'set'), false);
  ELSIF j->>'$tag' = 'SePattern' AND jsonb_typeof(j->'pattern') = 'object' THEN
    RETURN jsonb_set(
      j, '{pattern}', pg_temp.lift_permission_value(j->'pattern', 'pattern'), false
    );
  ELSIF j->>'$tag' = 'SeMu' AND j ? 'body' THEN
    RETURN jsonb_set(j, '{body}', pg_temp.lift_permission_value(j->'body', 'set'), false);
  ELSIF j->>'$tag' = 'SeCtor' AND jsonb_typeof(j->'fields') = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN jsonb_typeof(field) = 'object'
            AND field->>'$tag' = 'SetCtorField'
            AND field ? 'set'
          THEN jsonb_set(
            field, '{set}', pg_temp.lift_permission_value(field->'set', 'set'), false
          )
          ELSE field
        END
        ORDER BY ord
      ),
      '[]'::jsonb
    ) INTO lifted
    FROM jsonb_array_elements(j->'fields') WITH ORDINALITY AS a(field, ord);
    RETURN jsonb_set(j, '{fields}', lifted, false);
  ELSIF j->>'$tag' = 'SeArrow'
    AND jsonb_typeof(j->'params') = 'array'
    AND j ? 'returns' THEN
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN jsonb_typeof(param) = 'object'
            AND param->>'$tag' = 'SetArrowParam'
            AND param ? 'set'
          THEN jsonb_set(
            param, '{set}', pg_temp.lift_permission_value(param->'set', 'set'), false
          )
          ELSE param
        END
        ORDER BY ord
      ),
      '[]'::jsonb
    ) INTO lifted
    FROM jsonb_array_elements(j->'params') WITH ORDINALITY AS a(param, ord);
    RETURN jsonb_set(
      jsonb_set(j, '{params}', lifted, false),
      '{returns}', pg_temp.lift_permission_value(j->'returns', 'set'), false
    );
  END IF;

  RETURN j;
END;
$body$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION pg_temp.lift_permission_setexpr(j jsonb)
RETURNS jsonb AS $body$
  SELECT pg_temp.lift_permission_value(j, 'set');
$body$ LANGUAGE sql IMMUTABLE;

WITH normalized AS (
  SELECT
    id,
    pg_temp.lift_permission_setexpr(subjects) AS subjects,
    pg_temp.lift_permission_setexpr(actions) AS actions,
    pg_temp.lift_permission_setexpr(resources) AS resources,
    pg_temp.lift_permission_setexpr(predicate) AS predicate
  FROM permission_policies
)
UPDATE permission_policies AS policy
SET
  subjects = normalized.subjects,
  actions = normalized.actions,
  resources = normalized.resources,
  predicate = normalized.predicate,
  updated_at = NOW()
FROM normalized
WHERE policy.id = normalized.id
  AND (
    policy.subjects IS DISTINCT FROM normalized.subjects
    OR policy.actions IS DISTINCT FROM normalized.actions
    OR policy.resources IS DISTINCT FROM normalized.resources
    OR policy.predicate IS DISTINCT FROM normalized.predicate
  );

COMMIT;
