-- Additive provenance for schema-directed JSON value transport. Existing rows
-- deliberately remain NULL: a payload that resembles a codec envelope is still
-- ordinary legacy user data until an explicit typed write replaces it.
ALTER TABLE entity_instances
  ADD COLUMN IF NOT EXISTS data_encoding text;

ALTER TABLE entity_instances
  ADD CONSTRAINT entity_instances_data_encoding_supported
  CHECK (data_encoding IS NULL OR data_encoding IN ('fenel-value-json-v1', 'fenel-instance-json-v1'));
