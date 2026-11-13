-- v1 remains readable without interpreting raw marker-shaped data. New v2
-- writes add one native-atom transport layer over schema-directed value slots.
ALTER TABLE entity_instances
  DROP CONSTRAINT IF EXISTS entity_instances_data_encoding_supported;

ALTER TABLE entity_instances
  ADD CONSTRAINT entity_instances_data_encoding_supported
  CHECK (data_encoding IS NULL OR data_encoding IN (
    'fenel-value-json-v1', 'fenel-instance-json-v1',
    'fenel-value-json-v2', 'fenel-instance-json-v2'
  ));
