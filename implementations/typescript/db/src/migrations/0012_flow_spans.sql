-- Flow spans table for observability / inspector
DO $$ BEGIN
  CREATE TYPE span_kind AS ENUM ('call', 'read', 'wait', 'io', 'pure');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE span_status AS ENUM ('running', 'completed', 'failed', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS flow_spans (
  id TEXT PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
  parent_id TEXT,
  name TEXT NOT NULL,
  kind span_kind NOT NULL,
  status span_status NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  input JSONB,
  output JSONB,
  error TEXT,
  capability TEXT,
  provider TEXT,
  effects JSONB,
  meta JSONB
);

CREATE INDEX IF NOT EXISTS flow_spans_instance_idx ON flow_spans(instance_id);
CREATE INDEX IF NOT EXISTS flow_spans_parent_idx ON flow_spans(parent_id);
CREATE INDEX IF NOT EXISTS flow_spans_kind_idx ON flow_spans(instance_id, kind);
